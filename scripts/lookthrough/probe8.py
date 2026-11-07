"""暫時用：第 10 輪——統一持股結構、台新 alink、中信 Combination、Invesco 搜尋"""
import urllib.request, urllib.error, urllib.parse, re, json, sys, http.cookiejar, html
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
def balanced(s, i):
    """從 s[i]（[ 或 {）取出對稱的 JSON 片段"""
    o = s[i]; c = ']' if o == '[' else '}'; d = 0; q = False; e = False
    for j in range(i, len(s)):
        ch = s[j]
        if q:
            if e: e = False
            elif ch == '\\': e = True
            elif ch == '"': q = False
        elif ch == '"': q = True
        elif ch in '[{': d += 1
        elif ch in ']}':
            d -= 1
            if d == 0: return s[i:j + 1]
    return None
# 1) 統一：00981A 與 00939 的持股 JSON
for fc in ('49YTW', '44YTW'):
    t = fetch('統一 ' + fc, 'https://www.ezmoney.com.tw/ETF/Fund/Info?FundCode=' + fc)
    if not t: continue
    u = html.unescape(html.unescape(t))
    m = re.search(r'"sFundCode":"%s","sFundName":"([^"]+)","sFundShortName":"([^"]+)"' % fc, u); print('fund', m and m.groups())
    attrs = re.findall(r'(?:data-[a-z-]+|:[a-zA-Z-]+|[a-zA-Z-]+)="(\[\{&quot;FundCode[^"]{0,80})', t)[:3]; print('attr samples', attrs)
    i = u.find('"AssetCode":"ST"')
    if i > 0:
        k = u.rfind('[', 0, i); arr = balanced(u, k)
        try:
            A = json.loads(arr); print('asset groups', [(a.get('AssetCode'), a.get('AssetName'), a.get('Value'), len(a.get('Details') or [])) for a in A])
            for a in A:
                if a.get('Details'): print(' sample', a['AssetCode'], json.dumps(a['Details'][0], ensure_ascii=False)[:700])
            st = [a for a in A if a.get('AssetCode') == 'ST'][0]['Details']
            ks = list(st[0].keys()); print(' keys', ks)
            for wk in [k for k in ks if re.search(r'(?i)weight|ratio|percent|NavRate|rate', k)]: print(' sum', wk, sum(float(x.get(wk) or 0) for x in st))
        except Exception as ex:
            print('parse fail', repr(ex)[:200], (arr or '')[:300])
t = fetch('統一 首頁', 'https://www.ezmoney.com.tw/ETF/')
if t:
    u = html.unescape(html.unescape(t)); print('map', sorted(set(re.findall(r'"sFundCode":"(\w+)","sFundName":"[^"]*","sFundShortName":"([^"]*)"', u)))[:40])
    print('href map', sorted(set(re.findall(r'fundCode=(\w+)"[^>]*>\s*([0-9A-Z]{4,7})\s', t, re.I)))[:40])
# 2) 台新 alink
t = fetch('台新 JS', 'https://www.tsit.com.tw/ETF/JS/ETFSeriesDetail.js?rnd=1056382')
if t:
    around(t, 'alink', 6, 120, 200)
t = fetch('台新 00936 頁', 'https://www.tsit.com.tw/ETF/Home/ETFSeriesDetail/00936')
if t:
    around(t, 'navdate', 3, 100, 200); around(t, 'alink', 3, 100, 200); print('ETF urls', sorted(set(re.findall(r'["\'](/ETF/[A-Za-z/]+)["\']', t)))[:40])
for path in ('/ETF/Home/GetFundAssets', '/ETF/Home/PartialSeriesDetailDiv'):
    fetch('台新 POST ' + path, 'https://www.tsit.com.tw' + path, show=400, method='POST', data=json.dumps({'id': '00936', 'datadate': ''}).encode(), headers={'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest'})
fetch('台新 PCF', 'https://www.tsit.com.tw/ETF/Home/Pcf', show=0)
# 3) 中信 Combination chunk
for js in ('Combination-B8hBMoLG.js', 'ShareHolding-Dy24lbhK.js'):
    t = fetch('中信 ' + js, 'https://www.ctbcinvestments.com/assets/' + js)
    if t:
        print(' strs', sorted(set(re.findall(r'["\'`]([A-Za-z0-9_/{}.$:-]*(?:/|Api|API|api)[A-Za-z0-9_/{}.$-]*)["\'`]', t)))[:50])
        around(t, 'get(', 3, 150, 200); around(t, 'post(', 3, 150, 200)
t = fetch('中信 index', 'https://www.ctbcinvestments.com/assets/index-CWcOqYfT.js')
if t:
    for w in ('/API/', '/api/', 'apiUrl', 'VITE_', '.create({'): around(t, w, 3, 150, 250)
# 4) Invesco 搜尋
for u, kw in [('https://dng-api.invesco.com/product/search?country=US&language=en&productType=ETF', {}),
              ('https://dng-api.invesco.com/product/search', dict(method='POST', data=json.dumps({'country': 'US', 'locale': 'en_US', 'productType': 'ETF'}).encode(), headers={'Content-Type': 'application/json'}))]:
    fetch('Invesco search', u, show=500, **kw)
