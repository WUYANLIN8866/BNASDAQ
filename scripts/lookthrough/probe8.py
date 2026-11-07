"""暫時用：第 11 輪——統一完整解析驗證、中信 token 與參數、Invesco 搜尋參數"""
import urllib.request, urllib.error, urllib.parse, re, json, sys, http.cookiejar, html
sys.stdout.reconfigure(line_buffering=True)
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
cj = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def get(url, method='GET', data=None, headers=None):
    h = {'User-Agent': BROWSER, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, method=method, data=data, headers=h), timeout=45) as r:
        return r.status, r.headers.get('Content-Type', ''), r.read()
def fetch(name, url, show=0, **kw):
    print('\n======', name, '|', url[:200])
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
# 1) 統一：完整解析
for fc in ('49YTW', '46YTW', '36YTW', '50YTW'):
    t = fetch('統一 ' + fc, 'https://www.ezmoney.com.tw/ETF/Fund/Info?FundCode=' + fc)
    if not t: continue
    m = re.search(r'="(\[\{&quot;FundCode&quot;:&quot;%s&quot;,&quot;AssetCode&quot;:&quot;NAV&quot;.*?\])"' % fc, t, re.S)
    if not m: print('no asset attr'); continue
    A = json.loads(html.unescape(m.group(1)))
    print('groups', [(a.get('AssetCode'), a.get('AssetName'), a.get('Value'), len(a.get('Details') or []), round(sum(float(d.get('NavRate') or 0) for d in (a.get('Details') or [])), 4)) for a in A])
    for a in A:
        D = a.get('Details') or []
        if D: print(' ', a.get('AssetCode'), 'first', json.dumps({k: D[0].get(k) for k in ('DetailCode', 'DetailName', 'Position', 'Share', 'Amount', 'NavRate', 'TranDate', 'MoneyType', 'IssuserCname')}, ensure_ascii=False), '| last', D[-1].get('DetailCode'), D[-1].get('DetailName'), D[-1].get('NavRate'))
    u = html.unescape(t); mm = re.search(r'"sFundCode":"%s","sFundName":"([^"]+)","sFundShortName":"([^"]+)"' % fc, u); print('fund', mm and mm.groups())
# 2) 中信：token 與 ETFHoldingWeight 參數
t = fetch('中信 Combination', 'https://www.ctbcinvestments.com/assets/Combination-B8hBMoLG.js')
if t:
    around(t, 'ETFHoldingWeight', 3, 400, 300)
t = fetch('中信 index', 'https://www.ctbcinvestments.com/assets/index-CWcOqYfT.js')
if t:
    for w in ('token:', '.token=', 'token=', 'GetToken', 'getToken', 'Token"', 'setToken'): around(t, w, 2, 200, 300)
# 3) Invesco 搜尋參數
t = fetch('Invesco 清單頁', 'https://www.invesco.com/us/financial-products/etfs/product-list')
if t:
    u = html.unescape(t)
    for w in ('product/search', 'searchApi', 'productListApi', 'plpApi'): around(u, w, 2, 300, 300)
