"""暫時用：第 7 輪——國泰、群益、復華的持股 API 細節；Vanguard 換主機分頁"""
import urllib.request, urllib.error, urllib.parse, re, json, sys, io, http.cookiejar
sys.stdout.reconfigure(line_buffering=True)
B = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
cj = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def get(url, data=None, headers=None, method=None):
    h = {'User-Agent': B, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-TW,zh;q=0.9'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, data=data, headers=h, method=method), timeout=60) as r: return r.status, r.headers.get('Content-Type', ''), r.read()
def fetch(name, url, show=600, **kw):
    print('\n======', name, '|', url[:170], ('POST ' + kw['data'][:120].decode()) if kw.get('data') else '')
    try:
        st, ct, b = get(url, **kw); print('status', st, ct, len(b))
        if b[:2] == b'PK':
            import openpyxl; wb = openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True)
            for i, r in enumerate(wb.worksheets[0].iter_rows(values_only=True)):
                if i > 14: break
                print('  ', list(r)[:8])
        elif show: print(b[:show].decode('utf-8', 'replace'))
        return b
    except urllib.error.HTTPError as e: print('HTTP', e.code, re.sub(r'\s+', ' ', (e.read(250) or b'').decode('utf-8', 'replace'))[:250])
    except Exception as e: print('ERR', repr(e)[:200])
J = {'Content-Type': 'application/json;charset=UTF-8', 'Origin': 'https://www.cathaysite.com.tw', 'Referer': 'https://www.cathaysite.com.tw/ETF/purchase'}
st, ct, b = get('https://www.cathaysite.com.tw/main.bfc4bcc4530458b1ddfa.js'); t = b.decode('utf-8', 'replace')
for w in ['GetPromise(', 'apiUrl', 'baseUrl']:
    for m in list(re.finditer(re.escape(w), t))[:4]:
        s = re.sub(r'\s+', ' ', t[max(0, m.start() - 120):m.start() + 380])
        if 'http' in s or 'post' in s.lower(): print(w, '…', s)
for m in list(re.finditer(r'GetStocksList\(\{[^}]{0,200}\}', t))[:3]: print('call', m.group(0))
for m in list(re.finditer(r'BuySale\.GetBuySale\(\{[^}]{0,200}\}', t))[:3]: print('call', m.group(0))
for body in ['{"fundCode":"00878"}', '{"FundCode":"00878"}', '{"stockCode":"00878"}']:
    fetch('國泰 GetStocksList', 'https://www.cathaysite.com.tw/api/BuySale/GetStocksList', data=body.encode(), headers=J)
fetch('國泰 GetETFInfoMain', 'https://www.cathaysite.com.tw/api/ETF/GetETFInfoMain', data=b'{"fundCode":"00878"}', headers=J)
st, ct, b = get('https://www.capitalfund.com.tw/main.0561897939fdc9f2.js'); t = b.decode('utf-8', 'replace')
for w in ['/api/etf/buyback', '/api/etf/delivery', '/api/etf/items']:
    for m in list(re.finditer(re.escape(w), t))[:2]: print(w, '…', re.sub(r'\s+', ' ', t[max(0, m.start() - 300):m.start() + 300]))
b = fetch('復華 ETF 清單', 'https://www.fhtrust.com.tw/ETF/etf_list', show=0)
if b:
    s = b.decode('utf-8', 'replace'); print(sorted(set(re.findall(r'etf_detail/(ETF\d+)', s)))[:60]); print(re.findall(r'(ETF\d+)[^<]{0,200}?(00\d{2,4}[A-Z]?)', s)[:30])
fetch('復華 00929 Excel', 'https://www.fhtrust.com.tw/api/assetsExcel/ETF23/20261105')
fetch('復華 00929 Excel 1106', 'https://www.fhtrust.com.tw/api/assetsExcel/ETF23/20261106')
for u in ['https://investor.vanguard.com/vmf/api/VXUS/portfolio-holding/stock.json', 'https://investor.vanguard.com/vmf/api/VXUS/portfolio-holding/stock.json?start=501&count=500', 'https://api.vanguard.com/rs/ire/01/ind/fund/VXUS/portfolio-holding/stock?start=501&count=500']:
    bb = fetch('Vanguard', u, show=0)
    if bb:
        try:
            j = json.loads(bb); e = (j.get('fund') or {}).get('entity') or []; print('size', j.get('size'), 'n', len(e), 'first', e[0].get('longName') if e else None, 'next', (j.get('next') or {}).get('href'))
        except Exception as ex: print('parse', repr(ex)[:100], bb[:200])
