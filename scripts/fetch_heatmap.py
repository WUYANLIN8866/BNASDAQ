#!/usr/bin/env python3
"""BNASDAQ｜市值熱力圖資料 data/heatmap/latest.json（公開市場資料，不含任何策略規則）。

成分股與產業：data/lt/etf/QQQ.json（Invesco QQQ 每日持股＝那斯達克 100）、data/lt/etf/SPY.json（SSGA SPY 每日持股＝標普 500）
            （投資組合透視每天抓的同一份檔；同一家公司的多種股別已合併成一個代號，例如 GOOGL＝Alphabet A＋C）
市值：Nasdaq 股票篩選器 marketCap（api.nasdaq.com）；同一家公司多種股別時依篩選器數值判斷是公司層級還是個別股別再合併
漲跌：Yahoo Finance 日線，最新「已收盤」交易日收盤 ÷ 前一交易日收盤 − 1（未收盤的當天不算）
同一個交易日已經有完整檔案就不重抓；抓失敗或覆蓋率不足 90% 時保留舊檔、結束碼 1。
"""
import concurrent.futures as cf, datetime as dt, json, os, re, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'heatmap', 'latest.json')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
SETS = [('ndx', '那斯達克 100', 'QQQ'), ('spx', '標普 500', 'SPY')]


def log(*a):
    print('[heatmap]', *a, flush=True)


def get(url, headers=None, timeout=40, tries=3):
    h = {'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9'}
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
        except Exception as e:  # noqa
            err = e
        time.sleep(1.5 * (k + 1))
    raise err


def yahoo_bars(sym):
    """回傳 [(日期, 收盤)]，只含已收盤的交易日（美東日期）。"""
    j = json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=10d&interval=1d&includePrePost=false'))
    r = j['chart']['result'][0]
    meta, ts = r['meta'], r.get('timestamp') or []
    closes = r['indicators']['quote'][0].get('close') or []
    off = meta.get('gmtoffset', -18000)
    bars = [(dt.datetime.fromtimestamp(t + off, dt.timezone.utc).date().isoformat(), c) for t, c in zip(ts, closes) if c is not None]
    now = time.time()
    today = dt.datetime.fromtimestamp(now + off, dt.timezone.utc).date().isoformat()
    end = ((meta.get('currentTradingPeriod') or {}).get('regular') or {}).get('end') or 0
    if bars and bars[-1][0] == today and now < end + 15 * 60:   # 今天還沒收盤（或剛收盤 15 分鐘內）→ 不用
        bars = bars[:-1]
    return bars


def num(s):
    try:
        s = str(s).replace(',', '').replace('$', '').strip()
        return float(s) if s not in ('', 'NA', 'N/A', '--') else None
    except Exception:
        return None


def norm(sym):
    return (sym or '').strip().upper().replace('/', '-').replace('.', '-').replace('^', '-')


def stem(name):
    """公司名稱主幹（去掉股別字樣），用來找同一家公司的多種股別。"""
    n = re.split(r'\s+(?:Class|Series)\s+[A-Z]\b|\s+Common Stock|\s+Capital Stock|\s+Ordinary Shares|\s+American Depositary', name or '')[0]
    return re.sub(r'[^a-z0-9]+', ' ', n.lower()).strip()


def main():
    sess_bars = yahoo_bars('SPY')
    if len(sess_bars) < 2:
        log('SPY 日線不足'); return 1
    session = sess_bars[-1][0]
    old = None
    if os.path.isfile(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            old = None
    if old and old.get('session') == session and all(k in (old.get('sets') or {}) for k, _, _ in SETS) and '--force' not in sys.argv:
        log('已是最新交易日', session, '不重抓'); return 0
    log('交易日', session)

    # 成分股（投資組合透視每日持股檔）
    hold = {}
    for key, _, etf in SETS:
        f = os.path.join(ROOT, 'data', 'lt', 'etf', etf + '.json')
        j = json.load(open(f, encoding='utf-8'))
        hold[key] = (j.get('asof'), [(norm(h[0]), float(h[1]), h[2], h[3] or '其他') for h in j['h'] if h[0] and float(h[1]) > 0])
        log(etf, '成分股', len(hold[key][1]), '持股日', j.get('asof'))

    # 市值（Nasdaq 篩選器）
    hdr = {'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
    rows = ((json.loads(get('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&download=true', hdr, timeout=90)).get('data') or {}).get('rows') or [])
    scr = {}
    groups = {}
    for r in rows:
        s, c = norm(r.get('symbol')), num(r.get('marketCap'))
        if s and c and c > 0:
            scr[s] = (c, r.get('name') or '')
            groups.setdefault(stem(r.get('name')), []).append(s)
    log('Nasdaq 篩選器', len(rows), '列，有市值', len(scr))

    def cap_of(sym):
        if sym not in scr:
            return None, ''
        c, name = scr[sym]
        sib = [x for x in groups.get(stem(name), []) if x != sym]
        if not sib:
            return c, ''
        caps = [scr[x][0] for x in sib]
        if all(abs(x - c) / c < 0.02 for x in caps):     # 各股別顯示同一個數字＝公司層級市值
            return c, '公司層級市值（' + '、'.join([sym] + sib) + '）'
        return c + sum(caps), '股別合計（' + '、'.join([sym] + sib) + '）'

    # 漲跌（Yahoo 日線）
    syms = sorted({s for k in hold for s, *_ in hold[k][1]})
    px, fail = {}, []

    def one(s):
        try:
            b = yahoo_bars(s)
            m = {d: c for d, c in b}
            ds = [d for d, _ in b]
            if session in m and ds.index(session) >= 1:
                return s, (m[session], b[ds.index(session) - 1][1])
            return s, None
        except Exception as e:  # noqa
            return s, ('ERR', repr(e)[:80])

    with cf.ThreadPoolExecutor(8) as ex:
        for s, v in ex.map(one, syms):
            if v is None or v[0] == 'ERR':
                fail.append((s, v[1] if v else '沒有該交易日'))
            else:
                px[s] = v
    log('Yahoo 日線', len(px), '/', len(syms), '失敗', len(fail), fail[:8])

    sets, notes = {}, set()
    for key, label, etf in SETS:
        asof, hs = hold[key]
        ratio = [cap_of(s)[0] / w for s, w, *_ in hs if cap_of(s)[0]]
        ratio.sort()
        mid = ratio[len(ratio) // 2] if ratio else None
        tiles, est, have = [], 0, 0
        for s, w, name, sec in hs:
            c, note = cap_of(s)
            e = 0
            if not c and mid:
                c, e = w * mid, 1; est += 1
            if note:
                notes.add(s + '：' + note)
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
        sets[key] = dict(name=label, etf=etf, holdings_asof=asof, n=len(tiles), cap_total_bn=round(sum(t[3] for t in tiles), 1), tiles=tiles)

    out = dict(schema='bnasdaq-heatmap/1', session=session, updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               cols=['代號', '名稱', '產業', '市值（十億美元）', '單日漲跌%', '收盤', '市值為估算'],
               method='方塊面積＝市值；顏色＝該交易日收盤相對前一交易日收盤的漲跌。',
               sources=[dict(t='成分股與產業：Invesco QQQ、SSGA SPY 每日持股', u='https://www.invesco.com/qqq-etf/en/home.html'),
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
