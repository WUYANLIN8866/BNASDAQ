"""暫時用：第 9 輪——群益 items＋buyback（含日期）、國泰 cwapi"""
import urllib.request, urllib.error, re, json, sys, http.cookiejar, datetime as dt
sys.stdout.reconfigure(line_buffering=True)
B = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(url, data=None, headers=None):
    h = {'User-Agent': B, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-TW,zh;q=0.9'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, data=data, headers=h), timeout=60) as r: return r.status, r.headers.get('Content-Type', ''), r.read()
def fetch(name, url, show=700, **kw):
    print('\n======', name, '|', url[:170], ('POST ' + kw['data'][:160].decode()) if kw.get('data') else '')
    try:
        st, ct, b = get(url, **kw); print('status', st, ct, len(b)); print(b[:show].decode('utf-8', 'replace')); return b
    except urllib.error.HTTPError as e: print('HTTP', e.code, re.sub(r'\s+', ' ', (e.read(200) or b'').decode('utf-8', 'replace'))[:200])
    except Exception as e: print('ERR', repr(e)[:200])
CH = {'Content-Type': 'application/json', 'Origin': 'https://www.capitalfund.com.tw', 'Referer': 'https://www.capitalfund.com.tw/etf/product/detail/00919/buyback'}
b = fetch('群益 items', 'https://www.capitalfund.com.tw/CFWeb/api/etf/items', data=b'null', headers=CH, show=1500)
fid = None
if b:
    try:
        j = json.loads(b); d = j.get('data') or []
        for x in (d if isinstance(d, list) else []):
            if '00919' in json.dumps(x, ensure_ascii=False): print('00919 item', json.dumps(x, ensure_ascii=False)[:300]); fid = x
    except Exception as e: print('parse', e)
day = (dt.date.today() - dt.timedelta(days=1)).strftime('%Y/%m/%d')
for body in [{'fundId': '399', 'date': day}, {'fundId': '00919', 'date': day}, {'FundID': '00919', 'Date': day.replace('/', '-')}]:
    fetch('群益 buyback', 'https://www.capitalfund.com.tw/CFWeb/api/etf/buyback', data=json.dumps(body).encode(), headers=CH)
if fid:
    for k in ('fundId', 'FundId', 'fundID', 'id', 'value', 'code'):
        if isinstance(fid, dict) and k in fid:
            fetch('群益 buyback by ' + k, 'https://www.capitalfund.com.tw/CFWeb/api/etf/buyback', data=json.dumps({'fundId': fid[k]}).encode(), headers=CH)
            fetch('群益 buyback by ' + k + '+date', 'https://www.capitalfund.com.tw/CFWeb/api/etf/buyback', data=json.dumps({'fundId': fid[k], 'date': day}).encode(), headers=CH)
st, ct, bb = get('https://www.cathaysite.com.tw/main.bfc4bcc4530458b1ddfa.js'); t = bb.decode('utf-8', 'replace')
m = re.search(r'GetPromise\(([a-z]),([a-z])\)\{.{0,600}', t); print('GetPromise', m.group(0)[:600] if m else None)
for m in list(re.finditer(r'api/ETF/Get[A-Za-z]+', t))[:40]: pass
print('ETF apis', sorted(set(re.findall(r'api/ETF/Get[A-Za-z]+', t)))[:40])
H = {'Origin': 'https://www.cathaysite.com.tw', 'Referer': 'https://www.cathaysite.com.tw/'}
for u in ['https://cwapi.cathaysite.com.tw/api/ETF/GetETFInfoMain?fundCode=00878', 'https://cwapi.cathaysite.com.tw/api/ETF/GetETFList', 'https://cwapi.cathaysite.com.tw/api/BuySale/GetStocksList?fundCode=00878',
          'https://cwapi.cathaysite.com.tw/api/BuySale/GetBuySale?fundCode=00878']:
    fetch('國泰', u, headers=H)
