"""暫時用：第 16 輪——Vanguard VXUS 回應內容、國泰清單分頁參數、VanEck 下載連結"""
import urllib.request, urllib.error, re, json, sys, http.cookiejar
sys.stdout.reconfigure(line_buffering=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(url, headers=None, data=None):
    h = {'User-Agent': UA, 'Accept': '*/*'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, headers=h, data=data), timeout=60) as r:
        return r.read(), r.geturl(), r.headers.get('Content-Type', '')
for t in ('VXUS', 'VT', 'VOO'):
    try:
        b, fin, ct = get('https://investor.vanguard.com/vmf/api/%s/portfolio-holding/stock.json' % t)
        j = json.loads(b); print('\n== Vanguard', t, 'keys', list(j.keys())[:15], '| size', j.get('size'), '| asOf', j.get('asOfDate'))
        f = j.get('fund'); print('  fund keys', list(f.keys())[:15] if isinstance(f, dict) else type(f).__name__, '| body head', b[:400])
    except Exception as e:
        print('Vanguard', t, 'ERR', repr(e)[:200])
CT = {'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.cathaysite.com.tw', 'Referer': 'https://www.cathaysite.com.tw/'}
for q in ['', '?pageIndex=2', '?PageIndex=2', '?page=2', '?pageNo=2', '?currentPage=2', '?pageNumber=2', '?PageNumber=2', '?pageSize=50', '?PageSize=50', '?size=50', '?limit=50', '?pageIndex=2&pageSize=10', '?page=2&size=10']:
    try:
        b, fin, ct = get('https://cwapi.cathaysite.com.tw/api/ETF/GetETFList' + q, CT); j = json.loads(b)
        print('國泰', q or '(none)', 'total', j.get('totalCount'), 'pages', j.get('totalPage'), 'codes', [x.get('stockCode') for x in j.get('result') or []])
    except Exception as e:
        print('國泰', q, 'ERR', repr(e)[:150])
for t in ('remx', 'dura', 'espo', 'nlr', 'mort', 'smh'):
    try:
        b, fin, ct = get('https://www.vaneck.com/us/en/investments/%s/holdings/' % t); s = b.decode('utf-8', 'replace')
        links = sorted(set(re.findall(r'href="(/us/en/(?:investments/[a-z0-9-]+/downloads/holdings/|etf/[a-z-]+/%s/holdings/download/xlsx/))"' % t, s)))
        print('\n== VanEck', t, 'final', fin[:120], 'links', links)
        for l in links:
            try:
                b2, fin2, ct2 = get('https://www.vaneck.com' + l); print('   ', l, '→', ct2[:60], len(b2), b2[:2] == b'PK', fin2[:100])
            except Exception as e:
                print('   ', l, 'ERR', repr(e)[:120])
    except Exception as e:
        print('VanEck', t, 'ERR', repr(e)[:150])
