"""暫時用：第 15 輪——VanEck 抓不到的股票型、Vanguard VXUS、國泰清單分頁"""
import urllib.request, urllib.error, re, json, sys, io, http.cookiejar
sys.stdout.reconfigure(line_buffering=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(url, headers=None):
    h = {'User-Agent': UA, 'Accept': '*/*'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, headers=h), timeout=60) as r:
        return r.status, r.headers.get('Content-Type', ''), r.read(), r.geturl()
def fetch(name, url, headers=None):
    print('\n======', name, '|', url[:200])
    try:
        st, ct, b, fin = get(url, headers); print('status', st, '|', ct, '|', len(b), '| final', fin[:150]); return b
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, re.sub(r'\s+', ' ', (e.read(200) or b'').decode('utf-8', 'replace'))[:200])
    except Exception as e:
        print('ERR', repr(e)[:200])
import openpyxl
for t in ('ESPO', 'REMX', 'DURA', 'BIZD', 'VEEM', 'SMH'):
    b = fetch('VanEck ' + t, 'https://www.vaneck.com/us/en/etf/equity/%s/holdings/download/xlsx/' % t.lower())
    if b and b[:2] == b'PK':
        rows = [list(r) for r in openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True)]
        for i, r in enumerate(rows[:5]): print('  row', i, [x for x in r if x is not None][:12])
        hi = next((i for i, r in enumerate(rows) if r and 'Ticker' in r), None); print('  header', hi, rows[hi] if hi is not None else None)
        if hi is not None and 'Asset Class' in rows[hi]:
            k = rows[hi].index('Asset Class'); import collections; print('  asset classes', collections.Counter(str(r[k]) for r in rows[hi + 1:] if r and len(r) > k))
    elif b:
        print('  head', b[:300])
        page = fetch('VanEck page ' + t, 'https://www.vaneck.com/us/en/investments/%s/holdings/' % t.lower())
        if page:
            s = page.decode('utf-8', 'replace'); print('  download links', sorted(set(re.findall(r'(/us/en/etf/[a-z-]+/%s/holdings/download/[a-z]+/?)' % t.lower(), s)))[:6], sorted(set(re.findall(r'href="([^"]*download[^"]*)"', s)))[:8])
for u in ['https://investor.vanguard.com/vmf/api/VXUS/portfolio-holding/stock.json', 'https://investor.vanguard.com/vmf/api/VXUS/portfolio-holding/stock.json?start=1&count=500']:
    b = fetch('Vanguard VXUS', u)
    if b:
        try:
            j = json.loads(b); print('  size', j.get('size'), 'asOf', j.get('asOfDate'), 'entities', len(((j.get('fund') or {}).get('entity')) or []))
        except Exception as e:
            print('  not json', b[:200])
CT = {'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.cathaysite.com.tw', 'Referer': 'https://www.cathaysite.com.tw/'}
b = fetch('國泰 清單', 'https://cwapi.cathaysite.com.tw/api/ETF/GetETFList', CT)
if b:
    j = json.loads(b); r = j.get('result'); print('  keys', list(j.keys()), 'type', type(r).__name__, 'len', len(r) if isinstance(r, list) else None)
    if isinstance(r, list) and r: print('  item keys', list(r[0].keys())); print('  codes', sorted(str(x.get('stockCode')) for x in r))
for c in ('00830', '00881', '00733', '00922'):
    for fc in ('', ):
        pass
