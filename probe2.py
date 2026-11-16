#!/usr/bin/env python3
"""暫時性探測 2：台股盤中即時來源的行為（MIS 每 5 秒輪詢、有無 cookie、分批；Yahoo 台灣；鉅亨）。"""
import http.cookiejar, json, os, time, urllib.error, urllib.request
BUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
YUA = 'Mozilla/5.0 (BNASDAQ heatmap fetch)'
S = json.load(open('syms.json')); TW = S['tw']
OUT = {'started': time.time(), 'tests': {}}

def fetch(url, ua=BUA, headers=None, timeout=15, opener=None):
    t0 = time.time(); h = {'User-Agent': ua, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}; h.update(headers or {})
    try:
        req = urllib.request.Request(url, headers=h)
        with (opener.open(req, timeout=timeout) if opener else urllib.request.urlopen(req, timeout=timeout)) as r:
            b = r.read(); return {'ok': True, 'status': r.status, 'ms': round((time.time() - t0) * 1000), 'len': len(b), 'body': b}
    except urllib.error.HTTPError as e:
        return {'ok': False, 'status': e.code, 'ms': round((time.time() - t0) * 1000), 'err': e.read()[:200].decode('utf8', 'replace')}
    except Exception as e:  # noqa
        return {'ok': False, 'status': 0, 'ms': round((time.time() - t0) * 1000), 'err': repr(e)[:200]}

def mis_url(codes):
    return 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' + '%7C'.join('tse_%s.tw' % c for c in codes) + '&json=1&delay=0&_=%d' % int(time.time() * 1000)

def mis_poll(codes, opener=None, watch=('2330', '2454', '2317', '2382')):
    r = fetch(mis_url(codes), opener=opener, headers={'Referer': 'https://mis.twse.com.tw/stock/fibest.jsp?stock=2330'})
    o = {'at': round(time.time(), 1), 'status': r['status'], 'ms': r['ms']}
    if not r.get('ok'):
        o['err'] = r.get('err'); return o, []
    try:
        arr = json.loads(r['body']).get('msgArray') or []
    except Exception as e:  # noqa
        o['err'] = repr(e)[:100]; return o, []
    now = time.time(); ag = sorted(now - int(a['tlong']) / 1000 for a in arr if str(a.get('tlong') or '').isdigit())
    o.update(n=len(arr), z=sum(1 for a in arr if a.get('z') not in (None, '-', '')), trade=sum(1 for a in arr if isinstance(a.get('trade'), dict)),
             age=[round(ag[0]), round(ag[len(ag) // 2]), round(ag[-1])] if ag else None)
    o['w'] = {a['c']: [a.get('t'), a.get('z'), (a.get('trade') or {}).get('t'), (a.get('trade') or {}).get('z'), (a.get('b') or '').split('_')[0], (a.get('a') or '').split('_')[0], a.get('v'), a.get('ts')] for a in arr if a.get('c') in watch}
    return o, arr

T = OUT['tests']
# A：50 檔、不帶 cookie、每 5 秒一次，共 13 次
A = []; full = None
for k in range(13):
    o, arr = mis_poll(TW); A.append(o)
    if k == 6: full = arr[:8]
    time.sleep(max(0, 5 - o['ms'] / 1000))
T['A_50_nocookie_5s'] = A; T['A_full_rows'] = full
# B：先拿 cookie
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
pre = {}
for u in ('https://mis.twse.com.tw/stock/fibest.jsp?stock=2330', 'https://mis.twse.com.tw/stock/index?lang=zh_tw', 'https://mis.twse.com.tw/'):
    r = fetch(u, opener=op, headers={'Accept': 'text/html'}); pre[u] = [r['status'], r['ms'], r.get('len')]
T['B_pre'] = {'pages': pre, 'cookies': [c.name for c in cj]}
B = []
for k in range(7):
    o, arr = mis_poll(TW, opener=op); B.append(o); time.sleep(max(0, 5 - o['ms'] / 1000))
T['B_50_cookie_5s'] = B
# C：只問 10 檔
C = []
for k in range(5):
    o, arr = mis_poll(TW[:10]); C.append(o); time.sleep(max(0, 5 - o['ms'] / 1000))
T['C_10_nocookie_5s'] = C
# D：Yahoo 台灣（奇摩股市）前端 API
for name, u in (('ytw_list', 'https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;symbols=' + ','.join(c + '.TW' for c in TW[:10])),
                ('ytw_list_all', 'https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;symbols=' + ','.join(c + '.TW' for c in TW))):
    r = fetch(u, headers={'Referer': 'https://tw.stock.yahoo.com/'}); o = {k: v for k, v in r.items() if k != 'body'}
    if r.get('ok'): o['text'] = r['body'][:2500].decode('utf8', 'replace')
    T[name] = o
# E：鉅亨
u = 'https://ws.api.cnyes.com/ws/api/v1/quote/quotes/' + ','.join('TWS:%s:STOCK' % c for c in TW[:10]) + '?column=G,QUOTES'
r = fetch(u, headers={'Origin': 'https://www.cnyes.com', 'Referer': 'https://www.cnyes.com/'}); o = {k: v for k, v in r.items() if k != 'body'}
if r.get('ok'): o['text'] = r['body'][:3000].decode('utf8', 'replace')
T['cnyes'] = o
# F：Yahoo 國際版 .TW 的延遲
r = fetch('https://query2.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(c + '.TW' for c in TW[:20]) + '&range=1d&interval=1d', ua=YUA)
o = {k: v for k, v in r.items() if k != 'body'}
if r.get('ok'):
    try:
        now = time.time(); res = json.loads(r['body'])['spark']['result']
        o['rmt_age'] = sorted(round(now - x['response'][0]['meta'].get('regularMarketTime', 0)) for x in res)
        o['s0'] = {k: res[0]['response'][0]['meta'].get(k) for k in ('symbol', 'regularMarketPrice', 'regularMarketTime', 'chartPreviousClose', 'currentTradingPeriod')}
    except Exception as e:  # noqa
        o['err2'] = repr(e)[:120]
T['yahoo_intl_tw'] = o
OUT['finished'] = time.time()
os.makedirs('out', exist_ok=True); json.dump(OUT, open('out/probe2.json', 'w'), ensure_ascii=False, indent=1, default=str)
print('done')
