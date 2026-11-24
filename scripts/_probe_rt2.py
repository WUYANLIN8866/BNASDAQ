#!/usr/bin/env python3
"""暫時性實測第 2 輪（只在 probe 分支）：鉅亨網 API（瀏覽器可直接讀，ACAO *）有哪些端點與欄位；Yahoo奇摩股市指數、圖表多檔；CNBC 欄位。"""
import gzip, json, re, sys, time, urllib.error, urllib.request
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
def get(url, headers=None, timeout=20, origin='https://bnasdaq.com'):
    h = {'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}
    if origin: h['Origin'] = origin
    h.update(headers or {})
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout); st, hd, body = r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        st, hd, body = e.code, e.headers, e.read()
    except Exception as e:
        return 0, {}, repr(e).encode()
    if (hd.get('Content-Encoding') or '') == 'gzip':
        try: body = gzip.decompress(body)
        except Exception: pass
    return st, hd, body
def T(s): return time.strftime('%m-%d %H:%M:%S', time.gmtime(s + 8 * 3600))
def one(name, url, n=700, **kw):
    st, hd, body = get(url, **kw)
    acao = hd.get('Access-Control-Allow-Origin') if hd else None
    print(f'\n== {name}\n   {url[:200]}\n   status {st} len {len(body)} ACAO={acao}\n   {body[:n].decode("utf8", "replace")}')
    try: return json.loads(body)
    except Exception: return None
part = sys.argv[1] if len(sys.argv) > 1 else 'all'
now = int(time.time()); print('time', T(now), 'Taipei')
W = 'https://ws.api.cnyes.com/ws/api/v1/'
if part in ('all', 'cnyes'):
    j = one('cnyes quote 全欄位 2330', W + 'quote/quotes/TWS:2330:STOCK?column=G,QUOTES', n=3000)
    for col in ['K', 'E', 'KEY', 'M', 'AI', 'I', 'B', 'F', 'FORMAT', 'T', 'D', 'O', 'BIDASK', 'FIVE', 'TICK', 'G,QUOTES,K,E,KEY,M,AI,I,B,F']:
        one('cnyes quote column=' + col, W + f'quote/quotes/TWS:2330:STOCK?column={col}', n=1500)
    for res, back in [('1', 86400 * 5), ('5', 86400 * 10), ('60', 86400 * 60), ('D', 86400 * 365 * 12), ('W', 86400 * 365 * 30), ('M', 86400 * 365 * 40)]:
        j = one(f'cnyes charting resolution={res}', W + f'charting/history?resolution={res}&symbol=TWS:2330:STOCK&quote=1&from={now}&to={now - back}', n=200)
        d = (j or {}).get('data') or {}
        t = d.get('t') or []
        print('   keys', list(d), 'n', len(t), 'first(newest)', t[:1] and T(t[0]), 'last(oldest)', t[-1:] and T(t[-1]), '| o h l c v newest', [(d.get(k) or [None])[0] for k in 'ohlcv'], '| quote', json.dumps(d.get('quote'), ensure_ascii=False)[:600])
    for u in ['charting/tick?symbol=TWS:2330:STOCK', 'charting/ticks?symbol=TWS:2330:STOCK', 'quote/ticks/TWS:2330:STOCK', 'quote/tick/TWS:2330:STOCK', 'quote/detail/TWS:2330:STOCK', 'quote/bidask/TWS:2330:STOCK',
              'quote/intraday/TWS:2330:STOCK', 'quote/trades/TWS:2330:STOCK', 'quote/quotes/TWS:2330:STOCK/ticks', 'charting/history?resolution=T&symbol=TWS:2330:STOCK&from=%d&to=%d' % (now, now - 3600),
              'charting/history?resolution=1S&symbol=TWS:2330:STOCK&from=%d&to=%d' % (now, now - 600), 'quote/quotes/TWS:TSE01:INDEX?column=G,QUOTES', 'quote/quotes/TWS:2330:STOCK,TWS:6488:STOCK,TWS:0050:STOCK,TWS:00679B:STOCK?column=G,QUOTES',
              'quote/quotes/USS:AAPL:STOCK,USS:NVDA:STOCK,USS:QQQ:STOCK?column=G,QUOTES', 'charting/history?resolution=1&symbol=USS:AAPL:STOCK&quote=1&from=%d&to=%d' % (now, now - 86400)]:
        j = one('cnyes try ' + u.split('?')[0], W + u, n=900)
        d = (j or {}).get('data')
        if isinstance(d, dict) and d.get('t'): print('   n', len(d['t']), 'newest', T(d['t'][0]), 'oldest', T(d['t'][-1]), 'session?', d.get('session'), 'nextTime', d.get('nextTime'))
    for u in ['https://marketinfo.api.cnyes.com/mi/api/v1/TWS:2330:STOCK/tickDetail', 'https://marketinfo.api.cnyes.com/mi/api/v1/TWS:2330:STOCK/ticks', 'https://marketinfo.api.cnyes.com/mi/api/v1/investors/buysell/TWS:2330:STOCK?from=%d&to=%d' % (now, now - 86400 * 20),
              'https://marketinfo.api.cnyes.com/mi/api/v1/TWS:2330:STOCK/marginTrading?from=%d&to=%d' % (now, now - 86400 * 20), 'https://marketinfo.api.cnyes.com/mi/api/v2/TWS:2330:STOCK/tickDetail']:
        one('cnyes mi try', u, n=600)
if part in ('all', 'cnyesjs'):
    names = set()
    for page in ['https://www.cnyes.com/twstock/2330', 'https://www.cnyes.com/twstock/2330/realtime/tick', 'https://invest.cnyes.com/twstock/TWS/2330', 'https://invest.cnyes.com/twstock/TWS/2330/tick']:
        st, hd, body = get(page, headers={'Accept': 'text/html'}, origin=None); t = body.decode('utf8', 'replace')
        print(f'\n== page {page} status {st} len {len(body)} title {re.findall(r"<title>([^<]*)", t)[:1]}')
        pat = r'(?:https?:)?//[a-z0-9.\-]*api\.cnyes\.com/[A-Za-z0-9_/:\-.$\{\}]+|/(?:ws|mi)/api/v\d/[A-Za-z0-9_/:\-.$\{\}]+'
        names |= set(re.findall(pat, t))
        srcs = sorted(set(re.findall(r'(?:src|href)="([^"]+\.js)"', t)))
        print('   scripts', len(srcs), srcs[:3])
        for s in srcs[:60]:
            if s.startswith('//'): s = 'https:' + s
            elif s.startswith('/'): s = re.match(r'https://[^/]+', page).group(0) + s
            st2, hd2, b2 = get(s, origin=None)
            names |= set(re.findall(pat, b2.decode('utf8', 'replace')))
    print('\n== cnyes api paths found:'); [print('  ', n) for n in sorted(names)]
if part in ('all', 'misc'):
    Y = 'https://tw.stock.yahoo.com/_td-stock/api/resource/'; RH = {'Referer': 'https://tw.stock.yahoo.com/'}
    one('ytw 指數 ^TWII ^TWOII', Y + 'StockServices.stockList;symbols=%5ETWII,%5ETWOII', headers=RH, n=1500)
    j = one('ytw chart tick 3 檔', Y + 'FinanceChartService.ApacLibraCharts;symbols=%5B%222330.TW%22%2C%222317.TW%22%2C%226488.TWO%22%5D;type=tick', headers=RH, n=150)
    print('   charts', len(j) if isinstance(j, list) else j and list(j)[:5], [(x.get('symbol'), len(((x.get('chart') or {}).get('timestamp')) or [])) for x in (j if isinstance(j, list) else [])])
    for per in ['w', 'm', '5m', '60m']:
        j = one('ytw chart k period=' + per, Y + f'FinanceChartService.ApacLibraCharts;period={per};symbols=%5B%222330.TW%22%5D;type=k', headers=RH, n=100)
        try:
            c = j[0]['chart']; ts = c['timestamp']; print('   gran', c['meta'].get('dataGranularity'), 'n', len(ts), T(ts[0]), T(ts[-1]))
        except Exception as e: print('   parse', repr(e)[:80])
    one('cnbc AAPL 全欄位', 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=AAPL&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1', n=3500)
    one('cnbc 指數與台股？', 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=.IXIC%7C.SPX%7C2330-TW%7CTSM&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1', n=1800)
