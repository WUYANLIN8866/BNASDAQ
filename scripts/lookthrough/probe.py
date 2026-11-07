"""暫時用：第 6 輪——Vanguard 分頁、國泰／群益／復華 API、Invesco 參數、ARK、JPMorgan"""
import urllib.request, urllib.error, urllib.parse, re, json, sys, http.cookiejar
sys.stdout.reconfigure(line_buffering=True)
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
cj = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def get(url, data=None, headers=None):
    h = {'User-Agent': BROWSER, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, data=data, headers=h), timeout=60) as r: return r.status, r.headers.get('Content-Type', ''), r.read()
def fetch(name, url, **kw):
    print('\n======', name, '|', url[:180])
    try: st, ct, b = get(url, **kw); print('status', st, ct, len(b)); return b.decode('utf-8', 'replace')
    except urllib.error.HTTPError as e: print('HTTP', e.code, re.sub(r'\s+', ' ', (e.read(300) or b'').decode('utf-8', 'replace'))[:300])
    except Exception as e: print('ERR', repr(e)[:200])
# Vanguard 分頁
tot = 0; seen = set()
for start in range(1, 9500, 500):
    t = fetch('Vanguard VXUS page', 'https://investor.vanguard.com/vmf/api/VXUS/portfolio-holding/stock.json?start=%d&count=500' % start)
    if not t: break
    j = json.loads(t); ents = (j.get('fund') or {}).get('entity') or []
    w = sum(float(e.get('percentWeight') or 0) for e in ents); tot += w
    ids = [e.get('isin') or e.get('longName') for e in ents]; dup = sum(1 for i in ids if i in seen); seen.update(ids)
    print('start', start, 'size', j.get('size'), 'n', len(ents), 'w', round(w, 3), 'dup', dup, 'cum', round(tot, 2))
    if not ents: break
# 國泰：找呼叫 GetStocksList 的元件參數
t = fetch('國泰 main.js', 'https://www.cathaysite.com.tw/main.bfc4bcc4530458b1ddfa.js')
if t:
    for w in ['BuySale.GetStocksList(', 'BuySale.GetBuySale(', 'GetStocksList({', 'FundCode', 'fundCode', 'GetPromise(t,']:
        for m in list(re.finditer(re.escape(w), t))[:2]: print(w, '…', re.sub(r'\s+', ' ', t[max(0, m.start() - 250):m.start() + 350]))
    m = re.search(r'GetPromise\([a-z],[a-z]\)\{.{0,600}', t); print('GetPromise impl', m.group(0)[:700] if m else None)
    for u in re.findall(r'https://[a-z0-9.\-]*cathaysite[a-z0-9./\-]*', t)[:10]: print('host', u)
# 群益：main.js 端點
t = fetch('群益 首頁', 'https://www.capitalfund.com.tw/etf/product/detail/00919/portfolio')
if t:
    js = re.findall(r'src="(main\.[0-9a-f]+\.js)"', t); print('main', js)
    if js:
        t2 = fetch('群益 main.js', 'https://www.capitalfund.com.tw/' + js[0])
        if t2: print(sorted(set(re.findall(r'["\'`](/?(?:CFWeb/)?api/[A-Za-z0-9/_\-]{3,80})["\'`]', t2)))[:80])
# 復華
t = fetch('復華 00929 頁', 'https://www.fhtrust.com.tw/ETF/etf_detail/ETF23')
if t: print('台積電', t.count('台積電'), sorted(set(re.findall(r'["\'`](/?[A-Za-z0-9/_\-]{0,40}(?:api|Api|API|ajax|Ajax)[A-Za-z0-9/_\-?=&.]{0,80})["\'`]', t)))[:40])
# Invesco 參數
for q in ['idType=ticker&interval=daily&productType=ETF', 'idType=ticker&productType=ETF', 'idType=ticker']:
    t = fetch('Invesco RSP ' + q, 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/RSP/holdings/fund?' + q)
    if t: print(t[:200])
# ARK、JPMorgan
t = fetch('ARK ARKK csv', 'https://assets.ark-funds.com/fund-documents/funds-etf-csv/ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv')
if t: print(t[:400])
t = fetch('JPMorgan JEPI 頁', 'https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-etf-shares-46641q332')
if t: print(sorted(set(re.findall(r'["\'](https?://[^"\']{0,120}(?:holding|Holding|xlsx|csv)[^"\']{0,80})["\']', t)))[:15])
