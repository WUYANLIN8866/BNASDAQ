"""暫時用：第 10 輪——群益 00919 PCF 結構、國泰 00878 內部代號與持股 API"""
import urllib.request, urllib.error, re, json, sys, http.cookiejar, datetime as dt
sys.stdout.reconfigure(line_buffering=True)
B = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(url, data=None, headers=None):
    h = {'User-Agent': B, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-TW,zh;q=0.9'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, data=data, headers=h), timeout=60) as r: return r.read()
def shape(o, p='', d=0):
    if d > 4: return
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, (dict, list)): shape(v, p + '.' + k, d + 1)
            elif d <= 1: print('  ', p + '.' + k, '=', str(v)[:60])
    elif isinstance(o, list):
        print('  LIST', p, len(o), json.dumps(o[0], ensure_ascii=False)[:400] if o else '')
        if o and isinstance(o[0], (dict, list)): shape(o[0], p + '[0]', d + 1)
CH = {'Content-Type': 'application/json', 'Origin': 'https://www.capitalfund.com.tw', 'Referer': 'https://www.capitalfund.com.tw/etf/product/detail/00919/buyback'}
day = (dt.date.today() - dt.timedelta(days=1)).strftime('%Y/%m/%d')
print('\n====== 群益 00919 buyback', day)
try:
    j = json.loads(get('https://www.capitalfund.com.tw/CFWeb/api/etf/buyback', json.dumps({'fundId': '195', 'date': day}).encode(), CH)); print('code', j.get('code'), j.get('message')); shape(j.get('data'), 'data')
except Exception as e: print('ERR', repr(e)[:200])
H = {'Origin': 'https://www.cathaysite.com.tw', 'Referer': 'https://www.cathaysite.com.tw/'}
code = None
for pg in range(1, 6):
    try:
        j = json.loads(get('https://cwapi.cathaysite.com.tw/api/ETF/GetETFList?page=%d&pageSize=10&pageIndex=%d' % (pg, pg), headers=H))
        for x in j.get('result') or []:
            if x.get('stockCode') in ('00878', '00881', '00830', '00929'): print('國泰', x.get('stockCode'), x.get('fundCode'))
            if x.get('stockCode') == '00878': code = x.get('fundCode')
        print('page', pg, [x.get('stockCode') + ':' + str(x.get('fundCode')) for x in (j.get('result') or [])][:12])
    except Exception as e: print('ERR list', repr(e)[:150])
for fc in [code or 'CN', 'EA']:
    for api in ['api/ETF/GetETFDetailStockList', 'api/BuySale/GetStocksList', 'api/ETF/GetETFAssets']:
        for q in ['fundCode=%s' % fc, 'fundCode=%s&date=%s' % (fc, day)]:
            print('\n====== 國泰', api, q)
            try:
                j = json.loads(get('https://cwapi.cathaysite.com.tw/%s?%s' % (api, q), headers=H)); print('code', j.get('returnCode'), j.get('returnMessage')); shape(j.get('result'), 'result')
            except Exception as e: print('ERR', repr(e)[:150])
