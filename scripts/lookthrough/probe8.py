"""暫時用：第 9 輪——Invesco 代號↔CUSIP、統一、台新、中信 細節"""
import urllib.request, urllib.error, urllib.parse, re, json, sys, http.cookiejar
sys.stdout.reconfigure(line_buffering=True)
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
cj = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def get(url, method='GET', data=None, headers=None):
    h = {'User-Agent': BROWSER, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, method=method, data=data, headers=h), timeout=45) as r:
        return r.status, r.headers.get('Content-Type', ''), r.read()
def fetch(name, url, show=0, **kw):
    print('\n======', name, '|', url[:180])
    try:
        st, ct, b = get(url, **kw); print('status', st, '|', ct, '|', len(b))
        if show: print(b[:show].decode('utf-8', 'replace'))
        return b.decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, re.sub(r'\s+', ' ', (e.read(200) or b'').decode('utf-8', 'replace'))[:200])
    except Exception as e:
        print('ERR', repr(e)[:200])
    return None
def around(t, w, n=2, a=200, b=400):
    for mm in list(re.finditer(re.escape(w), t))[:n]: print('  [' + w + '] …', re.sub(r'\s+', ' ', t[max(0, mm.start() - a):mm.start() + b]))
IV = 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses'
t = fetch('Invesco RSP holdings keys', IV + '/46137V357/holdings/fund?idType=cusip&productType=ETF')
if t:
    d = json.loads(t); print('top keys', list(d.keys())); print('holding keys', list(d['holdings'][0].keys())); print('first', d['holdings'][0]); print('sum pct', sum(float(h.get('percentageOfTotalNetAssets') or 0) for h in d['holdings']))
    print('types', sorted({h.get('securityTypeName') for h in d['holdings']}))
for u in [IV + '/46137V357?idType=cusip&productType=ETF', IV + '/RSP?idType=ticker&productType=ETF', IV + '?productType=ETF', IV + '?idType=ticker&productType=ETF',
          'https://dng-api.invesco.com/cache/v1/accounts/en_US/products?productType=ETF', IV + '/RSP/performance/standard?idType=ticker&performanceSubType=cumulative&productType=ETF']:
    fetch('Invesco meta', u, show=600)
t = fetch('Invesco ETF 清單頁', 'https://www.invesco.com/us/financial-products/etfs/product-list')
if t:
    print('dng urls', sorted(set(re.findall(r'https://dng-api\.invesco\.com[^"\'\s]{0,160}', t)))[:20]); print('RSP', t.count('RSP'), '46137V357', t.count('46137V357'))
# 統一
t = fetch('統一 49YTW', 'https://www.ezmoney.com.tw/ETF/Fund/Info?FundCode=49YTW')
if t:
    m = re.search(r'<title>(.*?)</title>', t, re.S); print('title', m and m.group(1).strip())
    around(t, 'sStockNo', 3); around(t, '台積電', 1, 600, 300); around(t, '00981A', 2, 100, 150)
t = fetch('統一 ETF 首頁', 'https://www.ezmoney.com.tw/ETF/')
if t:
    links = sorted(set(re.findall(r'FundCode=([A-Za-z0-9]+)[^>]*>([^<]{0,40})<', t))); print('fund links', len(links), links[:60])
t = fetch('統一 PCF', 'https://www.ezmoney.com.tw/ETF/Transaction/PCF')
if t:
    around(t, 'PCFInfo', 3, 200, 500); around(t, 'sStockNo', 2)
# 台新
t = fetch('台新 00936', 'https://www.tsit.com.tw/ETF/Home/ETFSeriesDetail/00936')
if t:
    around(t, '成分股', 3, 100, 600); around(t, '權重', 2, 300, 300)
t = fetch('台新 JS', 'https://www.tsit.com.tw/ETF/JS/ETFSeriesDetail.js?rnd=1056382')
if t:
    print(sorted(set(re.findall(r'url\s*:\s*["\']([^"\']+)', t)))[:30]); around(t, 'ajax', 4, 50, 300)
# 中信
t = fetch('中信 ShareHolding js', 'https://www.ctbcinvestments.com/assets/ShareHolding-Dy24lbhK.js')
if t:
    print('strings', sorted(set(re.findall(r'["\'`](/[A-Za-z0-9_/{}.$-]{3,80})["\'`]', t)))[:40])
t = fetch('中信 index js', 'https://www.ctbcinvestments.com/assets/index-CWcOqYfT.js')
if t:
    print('api paths', sorted(set(re.findall(r'["\'`](/?(?:API|api|Api)[A-Za-z0-9_/{}.$-]{2,80})["\'`]', t)))[:60])
    for w in ('baseURL', 'FundShareHolding', 'ShareHolding"', 'Combination'): around(t, w, 2, 200, 300)
