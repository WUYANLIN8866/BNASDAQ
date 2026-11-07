"""暫時用：第 8 輪——國泰 apiUrl、群益 buyback 參數、復華清單對照"""
import urllib.request, urllib.error, re, json, sys, io, http.cookiejar
sys.stdout.reconfigure(line_buffering=True)
B = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(url, data=None, headers=None):
    h = {'User-Agent': B, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-TW,zh;q=0.9'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, data=data, headers=h), timeout=60) as r: return r.status, r.headers.get('Content-Type', ''), r.read()
def fetch(name, url, show=500, **kw):
    print('\n======', name, '|', url[:160], ('POST ' + kw['data'][:150].decode()) if kw.get('data') else '')
    try:
        st, ct, b = get(url, **kw); print('status', st, ct, len(b)); print(b[:show].decode('utf-8', 'replace')); return b
    except urllib.error.HTTPError as e: print('HTTP', e.code, re.sub(r'\s+', ' ', (e.read(200) or b'').decode('utf-8', 'replace'))[:200])
    except Exception as e: print('ERR', repr(e)[:200])
st, ct, b = get('https://www.cathaysite.com.tw/main.bfc4bcc4530458b1ddfa.js'); t = b.decode('utf-8', 'replace')
for m in list(re.finditer(r'apiUrl:"([^"]+)"', t))[:5]: print('apiUrl', m.group(1))
for m in list(re.finditer(r'rootUrl:"([^"]+)"', t))[:3]: print('rootUrl', m.group(1))
m = re.search(r'GetPromise\(t,n\)\{.{0,500}', t); print('GetPromise', m.group(0)[:500] if m else None)
for m in list(re.finditer(r'GetStocksList\(', t))[:4]: print('use', re.sub(r'\s+', ' ', t[max(0, m.start() - 300):m.start() + 200]))
st, ct, b = get('https://www.capitalfund.com.tw/main.0561897939fdc9f2.js'); t = b.decode('utf-8', 'replace')
for m in list(re.finditer(r'getBuyback\(', t))[:4]: print('群益 use', re.sub(r'\s+', ' ', t[max(0, m.start() - 400):m.start() + 250]))
m = re.search(r'baseURL|apiBase|environment\s*=\s*\{[^}]{0,300}', t); print('群益 env', m.group(0)[:300] if m else None)
for base in ['https://www.capitalfund.com.tw/CFWeb', 'https://www.capitalfund.com.tw']:
    for body in ['{"fundId":"00919"}', '{"FundId":"00919","Date":""}', '{"stockNo":"00919"}']:
        fetch('群益 buyback', base + '/api/etf/buyback', data=body.encode(), headers={'Content-Type': 'application/json', 'Origin': 'https://www.capitalfund.com.tw', 'Referer': 'https://www.capitalfund.com.tw/etf/product/detail/00919/buyback'}, show=300)
b = fetch('復華 ETF 清單 JSON', 'https://www.fhtrust.com.tw/ETF/etf_list', show=1500)
