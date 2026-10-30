#!/usr/bin/env python3
"""BNASDAQ｜個股目標價試算的自動參數 → data/fund/<代號>.json、data/fund/_industry.json
來源：Yahoo Finance quoteSummary（價格、EPS、分析師成長預估、歷年獲利、本益比、產業）＋ Yahoo 新聞搜尋（最新標題）。
參數規則（全部寫進 JSON 的 why，頁面照抄顯示）：
  EPS＝近 12 個月 EPS；成長率區間＝{分析師明年 EPS 成長、5 年長期成長、近 3 年淨利年化、最近一季獲利年增}的最小～最大（夾在 0～60%）；
  成長年數＝依成長率高低 3～10 年；退出本益比＝同產業（本站清單內）本益比第 25～75 百分位（樣本 < 5 用同類股），夾在 5～60。"""
import json, os, sys, time, re, argparse, statistics, datetime as dt, urllib.request, urllib.parse, http.cookiejar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'fund')
IDX = os.path.join(ROOT, 'data', 'tw', 'index.json')
UA = 'Mozilla/5.0 (BNASDAQ stocks fetch)'
MODS = 'price,summaryDetail,defaultKeyStatistics,financialData,earningsTrend,assetProfile,earnings'
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener()
CRUMB = None


def log(*a): print('[fund]', *a, flush=True)


def get(url, timeout=30):
    r = op.open(urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'}), timeout=timeout)
    return r.read()


DIAG = []


def crumb():
    global CRUMB
    for u in ('https://fc.yahoo.com', 'https://finance.yahoo.com/quote/AAPL/'):
        try: get(u)
        except Exception as e: DIAG.append(f'cookie {u}: {e!r}'[:200])
    for u in ('https://query1.finance.yahoo.com/v1/test/getcrumb', 'https://query2.finance.yahoo.com/v1/test/getcrumb'):
        try:
            CRUMB = get(u).decode().strip()
            if CRUMB and '<' not in CRUMB: break
        except Exception as e:
            DIAG.append(f'crumb {u}: {e!r}'[:200])
    DIAG.append(f'crumb={bool(CRUMB)} cookies={[c.name for c in cj]}')
    log(DIAG)


def raw(x):
    return x.get('raw') if isinstance(x, dict) else x


def ysym(code, market):
    return code if market == 'US' else code + ('.TWO' if market == 'TWO' else '.TW')


TS_TYPES = 'trailingDilutedEPS,annualDilutedEPS,quarterlyDilutedEPS'


def timeseries(sym):
    """Yahoo fundamentals-timeseries（不需 crumb）：近 12 個月／年度／季度稀釋 EPS。"""
    now = int(time.time())
    u = f'https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{urllib.parse.quote(sym)}?type={TS_TYPES}&period1=1356998400&period2={now}'
    j = None
    for host in ('query2', 'query1'):
        for k in range(3):
            try:
                j = json.loads(get(u.replace('query1', host))); break
            except urllib.error.HTTPError as e:
                if e.code != 429: raise
                time.sleep(3 * (k + 1))
        if j: break
    if j is None: raise RuntimeError('429 on both hosts')
    out = {}
    for r in (j.get('timeseries') or {}).get('result') or []:
        t = (r.get('meta') or {}).get('type', [None])[0]
        rows = [(x.get('asOfDate'), raw(x.get('reportedValue')), x.get('currencyCode')) for x in (r.get(t) or []) if x and x.get('reportedValue')]
        out[t] = sorted(rows)
    if not any(out.values()): raise RuntimeError('no eps data')
    return out


def news(sym, name):
    try:
        u = 'https://query1.finance.yahoo.com/v1/finance/search?' + urllib.parse.urlencode(dict(q=sym, newsCount=8, quotesCount=0))
        j = json.loads(get(u))
        return [dict(t=n.get('title'), u=n.get('link'), p=n.get('publisher'), d=dt.datetime.utcfromtimestamp(n.get('providerPublishTime', 0)).date().isoformat())
                for n in (j.get('news') or [])[:8] if n.get('title')]
    except Exception as e:
        DIAG.append(f'news {sym}: {e!r}'[:120]); return []


def industries():
    """台股：證交所 ISIN 產業別；美股：S&P 500 CSV 的 GICS 類股／子產業。"""
    ind = {}
    for mode in (2, 4):
        try:
            t = get(f'https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}', timeout=60).decode('cp950', errors='replace')
            for tr in re.findall(r'<tr>(.*?)</tr>', t, re.S):
                td = [re.sub(r'<[^>]+>', '', x).strip() for x in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
                if len(td) >= 5 and '\u3000' in td[0]:
                    code = td[0].split('\u3000')[0].strip()
                    if td[4]: ind[code] = ('', td[4])
        except Exception as e: DIAG.append(f'isin {mode}: {e!r}'[:120])
    try:
        import csv, io
        t = get('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv').decode()
        for r in csv.DictReader(io.StringIO(t)):
            ind[r['Symbol'].replace('.', '-')] = (r.get('GICS Sector', ''), r.get('GICS Sub-Industry', ''))
    except Exception as e: DIAG.append(f'sp500 csv: {e!r}'[:120])
    return ind


def extract(code, market, ts, price, cur, ind):
    o = dict(code=code, market=market, currency=cur, price=price)
    sec, sub = ind.get(code, ('', ''))
    o['sector'] = sec or ('台股' if market != 'US' else ''); o['industry'] = sub
    ttm = ts.get('trailingDilutedEPS') or []; ann = ts.get('annualDilutedEPS') or []; q = ts.get('quarterlyDilutedEPS') or []
    if ttm: o['eps_ttm'], o['eps_asof'], o['fin_currency'] = ttm[-1][1], ttm[-1][0], ttm[-1][2]
    elif len(q) >= 4: o['eps_ttm'], o['eps_asof'], o['fin_currency'] = sum(x[1] for x in q[-4:]), q[-1][0], q[-1][2]
    elif ann: o['eps_ttm'], o['eps_asof'], o['fin_currency'] = ann[-1][1], ann[-1][0], ann[-1][2]
    else: o['eps_ttm'] = None
    o['eps_annual'] = [[d, round(v, 4)] for d, v, c in ann[-6:]]
    g = {}
    a = [x for x in ann[-4:]]
    if len(a) >= 2 and a[0][1] > 0 and a[-1][1] > 0:
        g['hist_eps_cagr'] = (a[-1][1] / a[0][1]) ** (1 / (len(a) - 1)) - 1; o['hist_years'] = f'{a[0][0][:4]}→{a[-1][0][:4]}'
    if len(q) >= 5 and q[-5][1] > 0:
        g['latest_quarter_yoy'] = q[-1][1] / q[-5][1] - 1
    if len(q) >= 8 and sum(x[1] for x in q[-8:-4]) > 0:
        g['ttm_yoy'] = sum(x[1] for x in q[-4:]) / sum(x[1] for x in q[-8:-4]) - 1
    o['growth_inputs'] = {k: round(v, 4) for k, v in g.items()}
    o['pe_ttm'] = price / o['eps_ttm'] if price and o.get('eps_ttm') and o['eps_ttm'] > 0 else None
    return o


def pct(a, q):
    a = sorted(a); k = (len(a) - 1) * q; f = int(k); c = min(f + 1, len(a) - 1)
    return a[f] + (a[c] - a[f]) * (k - f)


def params(o, peers):
    why = []
    p = dict()
    p['px'] = o['price']; p['eps'] = o['eps_ttm']
    why.append(f"股價＝最新收盤 {o['price']}；EPS＝近 12 個月稀釋每股盈餘 {round(o['eps_ttm'],2)}（財報截至 {o.get('eps_asof')}）")
    if o.get('fin_currency') and o.get('currency') and o['fin_currency'] != o['currency']:
        why.append(f"注意：財報幣別 {o['fin_currency']} 與股價幣別 {o['currency']} 不同（常見於 ADR），EPS 可能需換算")
    gs = [v for v in o['growth_inputs'].values() if v is not None]
    lab = dict(hist_eps_cagr='近幾年 EPS 年化成長', latest_quarter_yoy='最近一季 EPS 年增', ttm_yoy='近 12 個月 EPS 年增')
    if gs:
        lo, hi = max(0.0, min(gs)), min(0.6, max(gs))
        if hi < lo: hi = lo
        if hi - lo < 0.02: lo, hi = max(0, lo - 0.02), hi + 0.02
        why.append('成長率＝下列數字的最小～最大（夾在 0～60%）：' + '、'.join(f"{lab[k]} {v*100:.1f}%" for k, v in o['growth_inputs'].items()))
    else:
        lo, hi = 0.05, 0.10; why.append('查無成長預估與歷年獲利，成長率先用 5～10%，請自行調整')
    p['gLo'], p['gHi'] = round(lo * 100, 1), round(hi * 100, 1)
    mid = (lo + hi) / 2
    p['nLo'], p['nHi'] = (3, 6) if mid > 0.3 else (5, 8) if mid > 0.15 else (5, 10)
    why.append(f"成長年數 {p['nLo']}～{p['nHi']} 年：成長越快越難持久（中位成長 > 30% 用 3～6 年、15～30% 用 5～8 年、其餘 5～10 年）")
    grp, src = peers.get(('i', o['industry'])), '同產業「' + (o['industry'] or '—') + '」'
    if not grp or len(grp) < 5:
        grp, src = peers.get(('s', o['sector'])), '同類股「' + (o['sector'] or '—') + '」'
    if grp and len(grp) >= 5:
        a, b = max(5, pct(grp, .25)), min(60, pct(grp, .75))
        p['peLo'], p['peHi'] = round(a), round(max(b, a + 1))
        why.append(f"退出本益比＝{src}{len(grp)} 檔本益比的第 25～75 百分位（夾在 5～60）")
    else:
        p['peLo'], p['peHi'] = 12, 20; why.append('同產業樣本不足，退出本益比先用 12～20 倍，請自行調整')
    p['why'] = why
    return p


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--codes', default=''); ap.add_argument('--budget-sec', type=int, default=17000)
    a = ap.parse_args(); os.makedirs(OUT, exist_ok=True)
    idx = json.load(open(IDX, encoding='utf-8'))['list']
    mk = {x[0]: x[2] for x in idx}
    codes = [c.strip().upper() for c in a.codes.split(',') if c.strip()] or [x[0] for x in idx if x[4]]
    latest = {}
    try:
        L = json.load(open(os.path.join(ROOT, 'data', 'tw', 'latest.json'), encoding='utf-8'))
        for k, v in (L.get('items') or {}).items():
            latest[k] = v
    except Exception as e: DIAG.append(f'latest: {e!r}'[:120])
    ind = industries(); t0 = time.time(); ok = fail = 0
    for c in codes:
        if time.time() - t0 > a.budget_sec: log('budget reached'); break
        m = mk.get(c, 'US' if c.isalpha() else 'TW'); sym = ysym(c, m)
        try:
            lq = latest.get(c) or {}
            price = lq.get('close') if isinstance(lq, dict) else (lq[0] if isinstance(lq, list) and lq else None)
            cur = 'USD' if m == 'US' else 'TWD'
            if price is None:
                try:
                    cj_ = json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=5d&interval=1d'))
                    price = cj_['chart']['result'][0]['meta']['regularMarketPrice']
                except Exception: pass
            try: ts = timeseries(sym)
            except Exception:
                if m == 'TW': sym = c + '.TWO'; ts = timeseries(sym)
                else: raise
            o = extract(c, m, ts, price, cur, ind); o['news'] = news(sym, ''); o['updated'] = dt.date.today().isoformat()
            nm = [x for x in idx if x[0] == c]; o['name'] = (nm[0][1] if nm and nm[0][1] else c)
            json.dump(o, open(os.path.join(OUT, c + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':')); ok += 1
        except Exception as e:  # noqa
            fail += 1; log('FAIL', c, repr(e)[:120]); DIAG.append(f'{c}: {e!r}'[:200])
        time.sleep(0.4)
    # 第二輪：產業本益比 → 參數
    peers = {}
    files = [f for f in os.listdir(OUT) if f.endswith('.json') and not f.startswith('_')]
    allo = []
    for f in files:
        o = json.load(open(os.path.join(OUT, f), encoding='utf-8')); allo.append((f, o))
        pe = o.get('pe_ttm')
        if pe and 0 < pe < 200:
            for k in (('i', o.get('industry')), ('s', o.get('sector'))):
                if k[1]: peers.setdefault(k, []).append(pe)
    for f, o in allo:
        if o.get('price') and o.get('eps_ttm') and o['eps_ttm'] > 0 and not (o.get('fin_currency') and o['fin_currency'] != o.get('currency') and o['market'] == 'US'):
            o['params'] = params(o, peers)
        else:
            o['params'] = None; o['why_none'] = ('財報幣別 ' + str(o.get('fin_currency')) + ' 與股價幣別不同（ADR），EPS 需自行換算') if o.get('eps_ttm') and o['eps_ttm'] > 0 else '虧損、ETF 或查無 EPS（≤ 0），本工具不適用'
        json.dump(o, open(os.path.join(OUT, f), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    ind = {f'{k[0]}:{k[1]}': dict(n=len(v), p25=round(pct(v, .25), 1), p50=round(pct(v, .5), 1), p75=round(pct(v, .75), 1)) for k, v in peers.items()}
    json.dump(dict(diag=DIAG[:40], updated=dt.date.today().isoformat(), ok=ok, fail=fail, files=len(files), industry=ind), open(os.path.join(OUT, '_industry.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    log('done ok', ok, 'fail', fail, 'files', len(files))


if __name__ == '__main__':
    sys.exit(main())
