#!/usr/bin/env python3
"""暫時性實測第 4 輪（只在 probe 分支）：把鉅亨網／CNBC／Yahoo奇摩股市的實際回應存成檔（測試用），並列出欄位對照。"""
import gzip, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
OUT = 'fx'; os.makedirs(OUT, exist_ok=True); INDEX = []
def get(url, headers=None, timeout=15, origin='https://bnasdaq.com'):
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
P = lambda *a: print(*a, flush=True)
T = lambda s: time.strftime('%m-%d %H:%M:%S', time.gmtime(s + 8 * 3600))
def save(name, url, n=0, **kw):
    st, hd, body = get(url, **kw)
    acao = hd.get('Access-Control-Allow-Origin') if hd else None
    open(os.path.join(OUT, name + '.json'), 'wb').write(body)
    INDEX.append({'name': name, 'url': url, 'status': st, 'acao': acao, 'len': len(body), 'at': int(time.time())})
    P(f'== {name} | status {st} len {len(body)} ACAO={acao}' + (f' | {body[:n].decode("utf8", "replace")}' if n else ''))
    try: return json.loads(body)
    except Exception: return None
now = int(time.time()); P('time', T(now), 'Taipei')
W = 'https://ws.api.cnyes.com/ws/api/v1/'; MI = 'https://marketinfo.api.cnyes.com/mi/api/v1/'
Y = 'https://tw.stock.yahoo.com/_td-stock/api/resource/'; RH = {'Referer': 'https://tw.stock.yahoo.com/'}
COLS = 'G,QUOTES,K,E,KEY,M,AI,I,B,F,FORMAT,D'
TW = [('2330', '.TW'), ('1216', '.TW'), ('2412', '.TW'), ('2603', '.TW'), ('6488', '.TWO'), ('0050', '.TW'), ('00679B', '.TWO')]
raw = lambda v: (v.get('raw') if isinstance(v, dict) else v)
for c, suf in TW:
    j = save(f'cnyes_quote_{c}', W + f'quote/quotes/TWS:{c}:STOCK?column={COLS}')
    y = save(f'ytw_stock_{c}', Y + f'StockServices.stockList;symbols={c}{suf}', headers=RH)
    try:
        q = j['data'][0]; a = y[0]
        yv = {'price': raw(a['price']), 'chg': raw(a['change']), 'open': raw(a['regularMarketOpen']), 'high': raw(a['regularMarketDayHigh']), 'low': raw(a['regularMarketDayLow']), 'prev': raw(a['regularMarketPreviousClose']),
              'volK': a.get('volumeK'), 'turnM': a.get('turnoverM'), 'avg': a.get('avgPrice'), 'in': a.get('inMarket'), 'out': a.get('outMarket'), 'up': raw(a['limitUpPrice']), 'dn': raw(a['limitDownPrice']), 'prevVolK': a.get('previousVolumeK'),
              'single': a.get('singleVolumeK'), 'time': a.get('regularMarketTime'), 'ob': [(o['bid'], o['bidVolK'], o['ask'], o['askVolK']) for o in a.get('orderbook') or []]}
        P('   YAHOO', json.dumps(yv, ensure_ascii=False))
        P('   CNYES', json.dumps({k: q[k] for k in sorted(q, key=lambda x: (len(x), x))}, ensure_ascii=False)[:2400], '| time', T(q.get('200007') or 0))
    except Exception as e:
        P('   compare fail', repr(e)[:120])
for c in ['2330', '1216']:
    for res, back in [('1', 86400 * 4), ('5', 86400 * 12), ('10', 86400 * 12), ('15', 86400 * 20), ('30', 86400 * 40), ('D', 86400 * 365 * 12), ('W', 86400 * 365 * 30), ('M', 86400 * 365 * 40)]:
        j = save(f'cnyes_chart_{c}_{res}', W + f'charting/history?resolution={res}&symbol=TWS:{c}:STOCK&quote=1&from={now}&to={now - back}')
        d = (j or {}).get('data') or {}; t = d.get('t') or []
        P('   n', len(t), 'newest', t[:1] and T(t[0]), 'oldest', t[-1:] and T(t[-1]), 'session', d.get('session'), 'nextTime', d.get('nextTime'), 'vwap', (d.get('vwap') or [None])[:2])
    for nm, u in [('pd1', W + f'priceDistribution/TWS:{c}:STOCK'), ('pd2', W + f'priceDistribution?symbol=TWS:{c}:STOCK'), ('pd3', W + f'priceDistribution/{c}'), ('pd4', W + f'priceDistribution/TWS:{c}:STOCK?limit=100'),
                  ('buysell', MI + f'investors/buysell/TWS:{c}:STOCK?from={now}&to={now - 86400 * 45}'), ('margin', MI + f'TWS:{c}:STOCK/marginTrading?from={now}&to={now - 86400 * 45}'),
                  ('main10', MI + f'chipsObserve/10mainForce/TWS:{c}:STOCK'), ('main10d', MI + f'chipsObserve/daily10mainForce/TWS:{c}:STOCK'), ('main10b', MI + f'chipsObserve/10mainForce/{c}'),
                  ('event', MI + f'recentEvent?symbol=TWS:{c}:STOCK'), ('target', MI + f'financialIndicator/targetPrice/TWS:{c}:STOCK'), ('histories', W + f'charting/histories?resolution=D&symbols=TWS:{c}:STOCK&from={now}&to={now - 86400 * 10}')]:
        save(f'cnyes_{nm}_{c}', u, n=420)
j = save('cnyes_index_TSE01', W + f'quote/quotes/TWS:TSE01:INDEX,TWS:OTC01:INDEX?column={COLS}', n=300)
save('cnyes_chart_TSE01_1', W + f'charting/history?resolution=1&symbol=TWS:TSE01:INDEX&quote=1&from={now}&to={now - 86400}', n=120)
US = ['AAPL', 'NVDA', 'QQQ', 'BRK.B', 'BRK-B', 'BRK/B', 'TSM', 'SPCX']
for c in US:
    save('cnyes_quote_US_' + re.sub(r'\W', '_', c), W + f'quote/quotes/USS:{urllib.parse.quote(c, safe="")}:STOCK?column={COLS}', n=260)
for c in ['AAPL', 'QQQ']:
    for res, back in [('1', 86400 * 4), ('5', 86400 * 12), ('D', 86400 * 365 * 12), ('W', 86400 * 365 * 30), ('M', 86400 * 365 * 40)]:
        j = save(f'cnyes_chart_US_{c}_{res}', W + f'charting/history?resolution={res}&symbol=USS:{c}:STOCK&quote=1&from={now}&to={now - back}')
        d = (j or {}).get('data') or {}; t = d.get('t') or []
        P('   n', len(t), 'newest', t[:1] and T(t[0]), 'oldest', t[-1:] and T(t[-1]), 'session', d.get('session'))
save('cnbc_us', 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' + urllib.parse.quote('AAPL|NVDA|QQQ|BRK.B|BRK-B|TSM|SPCX|.IXIC|.SPX|.NDX|.SOX', safe='') + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1', n=200)
save('ytw_index', Y + 'StockServices.stockList;symbols=%5ETWII,%5ETWOII', headers=RH)
json.dump(INDEX, open(os.path.join(OUT, '_index.json'), 'w'), ensure_ascii=False, indent=1)
P('saved', len(INDEX))
