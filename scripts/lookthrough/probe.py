"""暫時用：第 11 輪——原始回應：群益 buyback 全文、國泰 CN 指數權重與持股"""
import urllib.request, json, sys, http.cookiejar, datetime as dt
sys.stdout.reconfigure(line_buffering=True)
B = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(url, data=None, headers=None):
    h = {'User-Agent': B, 'Accept': 'application/json, text/plain, */*'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, data=data, headers=h), timeout=60) as r: return r.read().decode('utf-8', 'replace')
CH = {'Content-Type': 'application/json', 'Origin': 'https://www.capitalfund.com.tw', 'Referer': 'https://www.capitalfund.com.tw/etf/product/detail/00919/buyback'}
t = get('https://www.capitalfund.com.tw/CFWeb/api/etf/buyback', json.dumps({'fundId': '195', 'date': '2026/11/06'}).encode(), CH)
j = json.loads(t); d = j.get('data') or {}; print('群益 data keys', list(d)); i = t.find('"pcf"'); print('群益 非 pcf 部分：', t[t.find('}', i) + 1:][:1500] if i >= 0 else t[:1500])
H = {'Origin': 'https://www.cathaysite.com.tw', 'Referer': 'https://www.cathaysite.com.tw/'}
for u in ['api/ETF/GetIndexStockWeights?fundCode=CN', 'api/BuySale/GetStocksList?fundCode=CN&date=2026/11/05', 'api/BuySale/GetBuySale?fundCode=CN', 'api/ETF/GetETFDetailStockList?stockCode=00878', 'api/ETF/GetEtf?fundCode=CN']:
    try: print('\n國泰', u, '→', get('https://cwapi.cathaysite.com.tw/' + u, headers=H)[:900])
    except Exception as e: print('\n國泰', u, 'ERR', repr(e)[:120])
