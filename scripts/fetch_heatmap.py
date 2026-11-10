#!/usr/bin/env python3
"""BNASDAQ｜市值熱力圖資料 data/heatmap/latest.json（公開市場資料，不含任何策略規則）。

成分股與產業：data/lt/etf/QQQ.json（Invesco QQQ 每日持股＝那斯達克 100）、IVV.json（iShares IVV＝標普 500）、SOXQ.json（Invesco SOXQ＝費城半導體）、
            0050.json（元大台灣50＝台灣 50；台股另用證交所資料，見下）
            （投資組合透視每天抓的同一份檔；同一家公司的多種股別已合併成一個代號，例如 GOOGL＝Alphabet A＋C）
市值：Nasdaq 股票篩選器 marketCap（api.nasdaq.com）；同一家公司多種股別時依篩選器數值判斷是公司層級還是個別股別再合併
漲跌：Yahoo Finance 日線，最新「已收盤」交易日收盤 ÷ 前一交易日收盤 − 1（未收盤的當天不算）
台灣 50：收盤與漲跌用證交所 STOCK_DAY_ALL（漲跌＝相對除權息參考價），市值＝證交所「上市公司基本資料」已發行普通股數 × 收盤（台幣）；
         台股有自己的交易日（sets.tw50.session），與美股分開判斷是否要重抓；台股抓失敗時保留舊的台灣 50 分頁。
同一個交易日已經有完整檔案就不重抓；美股抓失敗或覆蓋率不足 90% 時保留舊檔、結束碼 1。
"""
import concurrent.futures as cf, datetime as dt, json, os, re, sys, time, urllib.error, urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'heatmap', 'latest.json')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
SETS = [('ndx', '那斯達克 100', ['QQQ']), ('spx', '標普 500', ['IVV', 'SPY']), ('sox', '費城半導體', ['SOXQ'])]   # 標普 500 用 iShares IVV（產業齊全）；費半用 Invesco SOXQ（追蹤 PHLX 費城半導體指數）
TW = ('tw50', '台灣 50', '0050')   # 元大台灣50 持股＝臺灣 50 指數成分股


def log(*a):
    print('[heatmap]', *a, flush=True)


def get(url, headers=None, timeout=40, tries=4, ua=None):
    h = {'User-Agent': ua or UA, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9'}
    h.update(headers or {})
    err = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 401, 403, 404):
                break
            time.sleep((4 if e.code == 429 else 1.5) * (2 ** k))   # 429 太多請求：等久一點再試
            continue
        except Exception as e:  # noqa
            err = e
        time.sleep(1.5 * (k + 1))
    raise err


YUA = 'Mozilla/5.0 (BNASDAQ heatmap fetch)'   # 與 fetch_market.py 相同風格；瀏覽器 UA 會被 Yahoo 回 429
ET = ZoneInfo('America/New_York')


def _bars(ts, closes, meta=None):
    """[(美東日期, 收盤)]。Yahoo 當天日線收盤常常還是空值，這時用 meta 的 regularMarketPrice（時間要在美東 16:00 之後）補上；
    還沒收盤的今天（美東 16:15 前）不算。"""
    raw = [(dt.datetime.fromtimestamp(t, ET).date().isoformat(), c) for t, c in zip(ts or [], closes or [])]
    if raw and raw[-1][1] is None and meta and meta.get('regularMarketPrice') and meta.get('regularMarketTime'):
        mt = dt.datetime.fromtimestamp(meta['regularMarketTime'], ET)
        if mt.date().isoformat() == raw[-1][0] and (mt.hour, mt.minute) >= (16, 0):
            raw[-1] = (raw[-1][0], float(meta['regularMarketPrice']))
    bars = [(d, c) for d, c in raw if c is not None]
    now = dt.datetime.now(ET)
    if bars and bars[-1][0] == now.date().isoformat() and (now.hour, now.minute) < (16, 15):
        bars = bars[:-1]
    return bars


def yahoo_bars(sym):
    j = json.loads(get(f'https://query2.finance.yahoo.com/v8/finance/chart/{sym}?range=10d&interval=1d', ua=YUA))
    r = j['chart']['result'][0]
    return _bars(r.get('timestamp'), r['indicators']['quote'][0].get('close'), r.get('meta'))


def yahoo_spark(batch):
    """一次抓多檔（每批 ≤20）；兩種回應格式都處理，失敗回傳空 dict 讓呼叫端改用單檔。"""
    for url in (f'https://query2.finance.yahoo.com/v7/finance/spark?symbols={",".join(batch)}&range=10d&interval=1d',
                f'https://query2.finance.yahoo.com/v8/finance/spark?symbols={",".join(batch)}&range=10d&interval=1d'):
        try:
            j = json.loads(get(url, ua=YUA, tries=2))
        except Exception:
            continue
        out = {}
        if isinstance(j, dict) and 'spark' in j:
            for r in ((j.get('spark') or {}).get('result') or []):
                try:
                    resp = r['response'][0]
                    out[norm(r['symbol'])] = _bars(resp.get('timestamp'), resp['indicators']['quote'][0].get('close'), resp.get('meta'))
                except Exception:
                    pass
        elif isinstance(j, dict):
            for k, v in j.items():
                if isinstance(v, dict) and v.get('timestamp') and v.get('close') and (v.get('dataGranularity') in (None, 86400, '1d')):
                    out[norm(k)] = _bars(v['timestamp'], v['close'])
        if out:
            yahoo_spark.fmt = url.split('/finance/')[0][-2:] + ('-meta' if isinstance(j, dict) and 'spark' in j else '')
            return out
    return {}


def num(s):
    try:
        s = str(s).replace(',', '').replace('$', '').strip()
        return float(s) if s not in ('', 'NA', 'N/A', '--') else None
    except Exception:
        return None


def norm(sym):
    return (sym or '').strip().upper().replace('/', '-').replace('.', '-').replace('^', '-')


def clean(name):
    """名稱去掉股別、上市地等尾巴：Accenture plc Class A Ordinary Shares (Ireland) → Accenture plc"""
    n = name or ''
    if n.isupper():
        n = n.title().replace(' Inc', ' Inc.').replace('..', '.')
    n = re.sub(r'\s*\((?:Ireland|Jersey|Bermuda|Netherlands|Switzerland|United Kingdom|Canada)\)\s*$', '', n)
    n = re.sub(r'\s+(?:Class [A-Z]\b.*|Common Stock.*|Ordinary Shares.*|Registered Shares.*|Capital Stock.*)$', '', n, flags=re.I)
    return n.strip()


SECT = {'technology': '資訊科技', 'telecommunications': '通訊服務', 'health care': '醫療保健', 'finance': '金融', 'real estate': '房地產',
        'consumer discretionary': '非必需消費', 'consumer staples': '必需消費', 'industrials': '工業', 'basic materials': '原物料',
        'energy': '能源', 'utilities': '公用事業'}


def stem(name):
    """公司名稱主幹（去掉股別字樣），用來找同一家公司的多種股別。"""
    n = re.split(r'\s+(?:Class|Series)\s+[A-Z]\b|\s+Common Stock|\s+Capital Stock|\s+Ordinary Shares|\s+American Depositary', name or '')[0]
    return re.sub(r'[^a-z0-9]+', ' ', n.lower()).strip()


def roc_iso(s):
    """民國 1151109 / 115/11/09 → 2026-11-09；西元 20261109 → 2026-11-09"""
    s = str(s or '').strip().replace('/', '')
    if len(s) == 7 and s.isdigit():
        return f'{int(s[:3]) + 1911}-{s[3:5]}-{s[5:7]}'
    if len(s) == 8 and s.isdigit():
        return f'{s[:4]}-{s[4:6]}-{s[6:8]}'
    return s


def twse_day_all():
    """證交所全部上市證券的最近一個交易日收盤與漲跌 → (日期, {代號: (收盤, 漲跌)}, 來源)。先 rwd（含日期），失敗再 OpenAPI。"""
    try:
        j = json.loads(get('https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?response=json', timeout=60, tries=3))
        idx = {f: i for i, f in enumerate(j.get('fields') or [])}
        ci, pi, di = idx.get('證券代號', 0), idx.get('收盤價', 7), idx.get('漲跌價差', 8)
        out = {}
        for r in j.get('data') or []:
            c, close, chg = str(r[ci]).strip(), num(r[pi]), num(r[di])
            if c and close:
                out[c] = (close, chg)
        neg = sum(1 for v in out.values() if v[1] is not None and v[1] < 0)
        if len(out) > 500 and neg > 0:
            return roc_iso(j.get('date')), out, 'rwd'
        log('TWSE rwd 不可用：列數', len(out), '下跌家數', neg, 'stat', j.get('stat'))
    except Exception as e:  # noqa
        log('TWSE rwd 失敗', repr(e)[:160])
    j = json.loads(get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', timeout=60, tries=3))
    date = ''
    try:   # OpenAPI 沒有日期：用 FMTQIK（每日市場成交資訊）最後一天
        fm = json.loads(get('https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK', timeout=60, tries=3))
        ds = [roc_iso(r.get('Date')) for r in fm if r.get('Date')]
        date = max(ds) if ds else ''
    except Exception as e:  # noqa
        log('TWSE FMTQIK 失敗', repr(e)[:160])
    out = {}
    for r in j:
        c, close, chg = str(r.get('Code', '')).strip(), num(r.get('ClosingPrice')), num(r.get('Change'))
        if c and close:
            out[c] = (close, chg)
    return date, out, 'openapi'


def twse_shares():
    """證交所上市公司基本資料 → {代號: 已發行普通股數}；沒有該欄時用 實收資本額 ÷ 普通股每股面額。"""
    j = json.loads(get('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', timeout=90, tries=3))
    if j:
        log('TWSE 基本資料欄位', [k for k in j[0].keys() if re.search('股|資本|面額', k)])
    out, via = {}, {'已發行': 0, '資本額÷面額': 0}
    for r in j:
        c = str(r.get('公司代號', '')).strip()
        sh = next((num(v) for k, v in r.items() if '已發行普通股數' in k), None)
        if sh:
            via['已發行'] += 1
        else:
            cap = num(r.get('實收資本額'))
            par = num(re.sub(r'[^0-9.]', '', str(r.get('普通股每股面額') or '')) or None)
            if cap and par:
                sh = cap / par; via['資本額÷面額'] += 1
        if c and sh:
            out[c] = sh
    log('TWSE 股數', len(out), via)
    return out


def build_tw(day=None):
    """台灣 50 分頁；任何一步失敗回傳 None（呼叫端保留舊分頁）。"""
    key, label, etf = TW
    try:
        j = json.load(open(os.path.join(ROOT, 'data', 'lt', 'etf', etf + '.json'), encoding='utf-8'))
        hs = [(str(h[0]).strip(), float(h[1]), str(h[2]).strip(), h[3] or '') for h in j['h'] if h[0] and float(h[1]) > 0]
        date, px, src = day or twse_day_all()
        sh = twse_shares()
    except Exception as e:  # noqa
        log('台灣 50 失敗', repr(e)[:200]); return None
    ratio = sorted(sh[c] * px[c][0] / w for c, w, *_ in hs if c in sh and c in px)
    mid = ratio[len(ratio) // 2] if ratio else None
    tiles, est, have = [], 0, 0
    for c, w, name, sec in hs:
        close, chg = px.get(c, (None, None))
        cap, e = (sh[c] * close, 0) if (c in sh and close) else ((w * mid, 1) if mid else (None, 1))
        est += e
        pct = None
        if close and chg is not None and close - chg > 0:
            pct = round(chg / (close - chg) * 100, 2); have += 1
        tiles.append([c, name, sec or '其他', round(cap / 1e9, 2) if cap else 0, pct, close, e])
    cover = have / len(hs) if hs else 0
    log(label, '交易日', date, '來源', src, '方塊', len(tiles), '有漲跌', have, '市值估算', est, '覆蓋率 %.1f%%' % (cover * 100))
    if cover < 0.9 or not date:
        log(label, '覆蓋率不足 90% 或沒有日期，保留舊分頁'); return None
    tiles.sort(key=lambda t: -t[3])
    return dict(name=label, etf=etf, holdings_asof=j.get('asof'), n=len(tiles), cap_total_bn=round(sum(t[3] for t in tiles), 1), tiles=tiles,
                session=date, market='TW', cur='TWD', cap_unit='十億台幣',
                sources=[dict(t='成分股與產業：元大台灣50（0050）持股', u='https://www.yuantaetfs.com/product/detail/0050/ratio'),
                         dict(t='收盤與漲跌：臺灣證券交易所（漲跌相對除權息參考價）', u='https://www.twse.com.tw/zh/trading/historical/stock-day-all.html'),
                         dict(t='市值：證交所上市公司基本資料（已發行普通股數）× 收盤', u='https://openapi.twse.com.tw/')])



def main():
    sess_bars = yahoo_bars('SPY')
    if len(sess_bars) < 2:
        log('SPY 日線不足'); return 1
    session = sess_bars[-1][0]
    if '--debug' in sys.argv:
        j = json.loads(get('https://query2.finance.yahoo.com/v8/finance/chart/SPY?range=10d&interval=1d', ua=YUA)); r = j['chart']['result'][0]
        log('DEBUG now ET', dt.datetime.now(ET).isoformat(), 'ts', [(t, dt.datetime.fromtimestamp(t, ET).isoformat()) for t in r.get('timestamp', [])][-3:],
            'close', r['indicators']['quote'][0].get('close', [])[-3:], 'meta', {k: r['meta'].get(k) for k in ('regularMarketTime', 'regularMarketPrice', 'currentTradingPeriod')})
    old = None
    if os.path.isfile(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            old = None
    force = '--force' in sys.argv
    try:
        tw_day = twse_day_all()
    except Exception as e:  # noqa
        log('TWSE 收盤失敗', repr(e)[:160]); tw_day = None
    osets = (old or {}).get('sets') or {}
    us_fresh = bool(old) and old.get('session') == session and all(k in osets for k, _, _ in SETS) and not force
    tw_fresh = bool(old) and TW[0] in osets and (tw_day is None or osets[TW[0]].get('session') == tw_day[0]) and not force
    if us_fresh and tw_fresh:
        log('已是最新交易日', session, '台股', osets[TW[0]].get('session'), '不重抓'); return 0
    if us_fresh:                                  # 只有台股換日：美股分頁沿用舊檔
        tw = build_tw(tw_day)
        if not tw:
            return 1
        old['sets'][TW[0]] = tw
        old['updated'] = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        tmp = OUT + '.tmp'
        json.dump(old, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, OUT)
        log('只更新台灣 50', tw['session']); return 0
    log('交易日', session)

    # 成分股（投資組合透視每日持股檔）
    # 台股代號 → 美國 ADR（持股檔把台積電 ADR 記成 2330；熱力圖要用美股代號 TSM 抓收盤與市值）
    try:
        alias = json.load(open(os.path.join(ROOT, 'data', 'lt', 'universe.json'), encoding='utf-8')).get('alias') or {}
    except Exception:
        alias = {}
    adr = {v: k for k, v in alias.items() if re.fullmatch(r'\d{4,6}', v) and re.fullmatch(r'[A-Z]{1,5}', k)}
    hold = {}
    for key, _, etfs in SETS:
        for etf in etfs:
            f = os.path.join(ROOT, 'data', 'lt', 'etf', etf + '.json')
            if os.path.isfile(f):
                break
        j = json.load(open(f, encoding='utf-8'))
        hs = []
        for h in j['h']:
            code = re.sub(r'^X:[^:]+:', '', h[0] or '').replace(' ', '-')   # iShares／SSGA 的「X:United States:BRK B」「X:Intl:LIN」→ BRK-B、LIN
            code = adr.get(code, code)
            if code and float(h[1]) > 0:
                hs.append((norm(code), float(h[1]), clean(h[2]), h[3] or ''))
        hold[key] = (j.get('asof'), etf, hs)
        log(etf, '成分股', len(hs), '持股日', j.get('asof'), '沒有產業', sum(1 for x in hs if not x[3]))

    # 市值（Nasdaq 篩選器）
    hdr = {'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
    rows = ((json.loads(get('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&download=true', hdr, timeout=90)).get('data') or {}).get('rows') or [])
    scr = {}
    groups = {}
    for r in rows:
        s, c = norm(r.get('symbol')), num(r.get('marketCap'))
        nm = r.get('name') or ''
        if s and c and c > 0:
            scr[s] = (c, nm, SECT.get((r.get('sector') or '').strip().lower(), ''), num(r.get('lastsale')))
            if not re.search(r'Preferred|Depositary|Notes|Warrant|Rights?\b|Units?\b|Debentures', nm, re.I):   # 特別股、票據不算股別
                groups.setdefault(stem(nm), []).append(s)
    log('Nasdaq 篩選器', len(rows), '列，有市值', len(scr))

    def cap_of(sym):
        if sym not in scr:
            return None, ''
        c, name, _, _ = scr[sym]
        sib = [x for x in groups.get(stem(name), []) if x != sym]
        if not sib:
            return c, ''
        caps = [scr[x][0] for x in sib]
        if all(abs(x - c) / c < 0.02 for x in caps):     # 各股別顯示同一個數字＝公司層級市值
            return c, '公司層級市值（' + '、'.join([sym] + sib) + '）'
        return c + sum(caps), '股別合計（' + '、'.join([sym] + sib) + '）'

    # 漲跌（Yahoo 日線）
    syms = sorted({s for k in hold for s, *_ in hold[k][2]})
    px, fail = {}, []

    def pick(b):
        ds = [d for d, _ in b]
        if session in ds and ds.index(session) >= 1:
            i = ds.index(session); return (b[i][1], b[i - 1][1])
        return None

    for i in range(0, len(syms), 20):                      # 先用 spark 一次 20 檔
        got = yahoo_spark(syms[i:i + 20])
        for s, b in got.items():
            v = pick(b)
            if v:
                px[s] = v
        time.sleep(0.4)
    log('spark 取得', len(px), '/', len(syms), '格式', getattr(yahoo_spark, 'fmt', '—'))

    def one(s):
        try:
            return s, pick(yahoo_bars(s))
        except Exception as e:  # noqa
            return s, ('ERR', repr(e)[:80])

    rest = [s for s in syms if s not in px]
    with cf.ThreadPoolExecutor(3) as ex:                   # 剩下的單檔補抓（慢慢來，避免 429）
        for s, v in ex.map(one, rest):
            if v is None or v[0] == 'ERR':
                fail.append((s, v[1] if v else '沒有該交易日'))
            else:
                px[s] = v
    log('Yahoo 日線', len(px), '/', len(syms), '失敗', len(fail), fail[:8])

    sets, notes = {}, set()
    for key, label, _ in SETS:
        asof, etf, hs = hold[key]
        ratio = [cap_of(s)[0] / w for s, w, *_ in hs if cap_of(s)[0]]
        ratio.sort()
        mid = ratio[len(ratio) // 2] if ratio else None
        tiles, est, have = [], 0, 0
        for s, w, name, sec in hs:
            if not sec and s in scr:
                sec = scr[s][2]
            sec = sec or '其他'
            c, note = cap_of(s)
            e = 0
            if not c and mid:
                c, e = w * mid, 1; est += 1
            if note:
                notes.add(s + '：' + note)
            if s in px and s in scr and scr[s][3] and not e:
                c = c * px[s][0] / scr[s][3]          # 篩選器市值是它當下價格算的 → 換算成該交易日收盤的市值
            if s in px:
                close, prev = px[s]
                chg = round((close / prev - 1) * 100, 2); have += 1
                tiles.append([s, name, sec, round(c / 1e9, 2), chg, round(close, 2), e])
            else:
                tiles.append([s, name, sec, round(c / 1e9, 2), None, None, e])
        cover = have / len(hs) if hs else 0
        log(label, '方塊', len(tiles), '有漲跌', have, '市值估算', est, '覆蓋率 %.1f%%' % (cover * 100))
        if cover < 0.9:
            log(label, '覆蓋率不足 90%，保留舊檔'); return 1
        tiles.sort(key=lambda t: -t[3])
        sets[key] = dict(name=label, etf=etf, holdings_asof=asof, n=len(tiles), cap_total_bn=round(sum(t[3] for t in tiles), 1), tiles=tiles,
                         session=session, market='US', cur='USD', cap_unit='十億美元')
    tw = build_tw(tw_day) if tw_day else None
    if tw:
        sets[TW[0]] = tw
    elif TW[0] in osets:
        sets[TW[0]] = osets[TW[0]]; log('台灣 50 沿用舊分頁', osets[TW[0]].get('session'))

    out = dict(schema='bnasdaq-heatmap/1', session=session, updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               cols=['代號', '名稱', '產業', '市值（十億，幣別見各分頁 cur）', '單日漲跌%', '收盤', '市值為估算'],
               method='方塊面積＝市值（美股：Nasdaq 篩選器市值依該交易日收盤換算；台股：已發行普通股數×收盤）；顏色＝該交易日收盤相對前一交易日收盤（台股為除權息參考價）的漲跌。',
               sources=[dict(t='成分股與產業：Invesco QQQ、iShares IVV、Invesco SOXQ（費城半導體）每日持股', u='https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf'),
                        dict(t='市值：Nasdaq 股票篩選器', u='https://www.nasdaq.com/market-activity/stocks/screener'),
                        dict(t='收盤價：Yahoo Finance', u='https://finance.yahoo.com/')],
               notes=sorted(notes), sets=sets)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    json.dump(out, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, OUT)
    log('寫入', OUT, os.path.getsize(OUT), 'bytes')
    for key in sets:
        t = sets[key]['tiles'][:5]
        log(key, '前五大：', [(x[0], x[3], x[4]) for x in t])
    return 0


if __name__ == '__main__':
    sys.exit(main())
