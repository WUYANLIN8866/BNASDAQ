"""暫時用：第 13 輪——Invesco 產品頁的 CUSIP、JPM Excel 非股票列"""
import urllib.request, urllib.error, urllib.parse, re, json, sys, http.cookiejar, html, io
sys.stdout.reconfigure(line_buffering=True)
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
cj = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def get(url, method='GET', data=None, headers=None):
    h = {'User-Agent': BROWSER, 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, method=method, data=data, headers=h), timeout=45) as r:
        return r.status, r.headers.get('Content-Type', ''), r.read(), r.geturl()
def fetch(name, url, show=0, raw=False, **kw):
    print('\n======', name, '|', url[:220])
    try:
        st, ct, b, fin = get(url, **kw); print('status', st, '|', ct, '|', len(b), '| final', fin[:160])
        if show: print(b[:show].decode('utf-8', 'replace'))
        return b if raw else b.decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, re.sub(r'\s+', ' ', (e.read(300) or b'').decode('utf-8', 'replace'))[:300])
    except Exception as e:
        print('ERR', repr(e)[:200])
    return None
for tk in ('RSP', 'SPLV', 'PGX'):
    for u in ['https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker=' + tk,
              'https://www.invesco.com/us/en/financial-products/etfs/invesco-s-p-500-equal-weight-etf.html' if tk == 'RSP' else None]:
        if not u: continue
        t = fetch('Invesco ' + tk, u)
        if t:
            cus = sorted(set(re.findall(r'\b(46\d{3}[A-Z0-9]{3}\d)\b', t))); print('cusip-like', cus[:10])
            for m in list(re.finditer(r'(?i)cusip', t))[:3]: print('  …', re.sub(r'\s+', ' ', html.unescape(t[max(0, m.start() - 150):m.start() + 200])))
            print('canonical', re.findall(r'<link rel="canonical" href="([^"]+)"', t)[:2])
b = fetch('JPM JEPI', 'https://am.jpmorgan.com/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=46641Q332&country=us&role=adv&locale=en-US', raw=True)
if b:
    import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(b), read_only=True).active
    rows = [r for r in ws.iter_rows(values_only=True)]
    print('rows', len(rows))
    hdr = None; data = []
    for r in rows:
        r = list(r)
        if r and r[0] == 'Ticker': hdr = r; continue
        if hdr and any(x is not None for x in r): data.append(r)
    print('header', hdr)
    types = {}
    for r in data:
        d = dict(zip(hdr, r)); k = d.get('Security Type'); mv = d.get('Market Value (USD)')
        types.setdefault(k, [0, 0.0]); types[k][0] += 1; types[k][1] += mv if isinstance(mv, (int, float)) else 0
    tot = sum(v[1] for v in types.values()); print('total MV', round(tot), {k: (v[0], round(v[1] / tot * 100, 3)) for k, v in types.items()})
    for r in data[-12:]: print(' tail', [x for x in r if x is not None][:9])
