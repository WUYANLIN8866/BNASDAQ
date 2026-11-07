"""暫時用：第 12 輪——中信 AuthToken 與 etf API、Invesco 清單參數"""
import urllib.request, urllib.error, urllib.parse, re, json, sys, http.cookiejar, html
sys.stdout.reconfigure(line_buffering=True)
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
cj = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def get(url, method='GET', data=None, headers=None):
    h = {'User-Agent': BROWSER, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, method=method, data=data, headers=h), timeout=45) as r:
        return r.status, r.headers.get('Content-Type', ''), r.read()
def fetch(name, url, show=0, **kw):
    print('\n======', name, '|', url[:220])
    try:
        st, ct, b = get(url, **kw); print('status', st, '|', ct, '|', len(b))
        if show: print(b[:show].decode('utf-8', 'replace'))
        return b.decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, re.sub(r'\s+', ' ', (e.read(300) or b'').decode('utf-8', 'replace'))[:300])
    except Exception as e:
        print('ERR', repr(e)[:200])
    return None
def around(t, w, n=2, a=200, b=400):
    for mm in list(re.finditer(re.escape(w), t))[:n]: print('  [' + w + '] …', re.sub(r'\s+', ' ', t[max(0, mm.start() - a):mm.start() + b]))
CT = 'https://www.ctbcinvestments.com.tw/API/'
H = {'Content-Type': 'application/json; charset=utf-8', 'Origin': 'https://www.ctbcinvestments.com', 'Referer': 'https://www.ctbcinvestments.com/'}
def ct_post(w, tok, body=None, show=800):
    q = urllib.parse.urlencode({'token': tok}); d = dict(token=tok); d.update(body or {})
    return fetch('中信 ' + w, CT + w + '?' + q, show=show, method='POST', data=json.dumps(d, ensure_ascii=False).encode(), headers=H)
t = ct_post('home/AuthToken', 'www.ctbcinvestments.com', show=300)
tok = None
try: tok = json.loads(t)['Data']['token']
except Exception as e: print('token fail', repr(e)[:100])
print('token len', len(tok or ''))
js = fetch('中信 index', 'https://www.ctbcinvestments.com/assets/index-CWcOqYfT.js')
names = sorted(set(re.findall(r'["\'`]((?:etf|fund|Etf|Fund)/[A-Za-z]+)["\'`]', js or '')))
print('api names', names)
for w in names:
    if re.search(r'(?i)list|detail|info|holding', w): around(js, '"' + w + '"', 1, 150, 250)
if tok:
    for w, body in [('etf/ETFList', {}), ('etf/FundList', {}), ('etf/ETFDetail', {'ETF_ID': '00934'}), ('etf/FundDetail', {'ETF_ID': '00934'})]:
        if w in names: ct_post(w, tok, body, show=600)
# Invesco：清單 API 參數
t = fetch('Invesco 清單頁', 'https://www.invesco.com/us/financial-products/etfs/product-list')
if t:
    u = html.unescape(t)
    for w in ('searchFrequency', 'returnType', 'variationType', 'uniqueIdentifier'):
        print(w, sorted(set(re.findall(r'"%s"\s*:\s*"([^"]{0,40})"' % w, u)))[:10])
    around(u, 'solrQuery', 2, 100, 400); around(u, '"fq"', 2, 100, 300); around(u, 'facet.pivot', 1, 600, 50)
for q in ['idType=cusip&productType=ETF&searchFrequency=daily&returnType=json&variationType=etf', 'idType=ticker&productType=ETF&searchFrequency=daily']:
    fetch('Invesco list', 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses?' + q, show=400)
for q in ['q=*:*&rows=5&wt=json', 'q=*%3A*&fq=productType%3AETF&rows=5', 'country=US&locale=en_US&rows=5&q=RSP']:
    fetch('Invesco solr', 'https://dng-api.invesco.com/product/search?' + q, show=400)
