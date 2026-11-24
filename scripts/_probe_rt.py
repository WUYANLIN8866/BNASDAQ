#!/usr/bin/env python3
"""暫時性實測（只在 probe 分支）：個股即時資訊頁的資料來源——欄位、CORS 標頭、Yahoo奇摩股市個股頁的功能分頁。"""
import gzip, json, re, sys, time, urllib.error, urllib.parse, urllib.request
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
def head(name, url, **kw):
    st, hd, body = get(url, **kw)
    cors = {k: hd.get(k) for k in ('Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials', 'Vary', 'Content-Type', 'Cache-Control') if hd and hd.get(k)}
    print(f'\n== {name}\n   {url[:230]}\n   status {st} len {len(body)} {json.dumps(cors, ensure_ascii=False)}')
    return st, hd, body
def js(body):
    try: return json.loads(body)
    except Exception: return None
def show(o, ind=3, depth=0, maxd=3, maxk=80):
    sp = ' ' * ind
    if isinstance(o, dict):
        for k, v in list(o.items())[:maxk]:
            if isinstance(v, (dict, list)) and depth < maxd and v:
                print(f'{sp}{k}: {type(v).__name__}[{len(v)}]'); show(v, ind + 2, depth + 1, maxd, maxk)
            else:
                print(f'{sp}{k}: {json.dumps(v, ensure_ascii=False)[:150]}')
    elif isinstance(o, list) and o:
        if isinstance(o[0], (dict, list)) and depth < maxd:
            print(f'{sp}[0]:'); show(o[0], ind + 2, depth + 1, maxd, maxk)
            if len(o) > 1: print(f'{sp}[-1]: {json.dumps(o[-1], ensure_ascii=False)[:300]}')
        else:
            print(f'{sp}{json.dumps(o[:12], ensure_ascii=False)[:300]} … n={len(o)}')
Y = 'https://tw.stock.yahoo.com/_td-stock/api/resource/'
RH = {'Referer': 'https://tw.stock.yahoo.com/'}
part = sys.argv[1] if len(sys.argv) > 1 else 'all'
print('time', time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(time.time() + 8 * 3600)), 'Taipei')

if part in ('all', 'tw'):
    for nm, u in [('ytw stockList 預設', Y + 'StockServices.stockList;symbols=2330.TW,6488.TWO'),
                  ('ytw stockList fields=avgPrice,orderbook', Y + 'StockServices.stockList;fields=avgPrice%2Corderbook;symbols=2330.TW,6488.TWO'),
                  ('ytw stockList 50 檔 fields=orderbook（一次多檔行不行）', Y + 'StockServices.stockList;fields=avgPrice%2Corderbook;symbols=' + ','.join(f'{c}.TW' for c in '2330 2317 2454 2308 2382 2881 2882 2412 2891 3711 2303 2886 2884 1216 2357 3231 2885 2892 3034 2890 2345 5880 2327 2880 3008 2002 2379 2883 1303 2887 4938 2207 1301 2301 3017 2603 3037 3661 2059 5871 2395 1101 2912 5876 6669 3045 4904 2615 1326 6505'.split())),
                  ('ytw chart tick', Y + 'FinanceChartService.ApacLibraCharts;symbols=%5B%222330.TW%22%5D;type=tick'),
                  ('ytw chart k d', Y + 'FinanceChartService.ApacLibraCharts;period=d;symbols=%5B%222330.TW%22%5D;type=k'),
                  ('ytw chart k 1m?', Y + 'FinanceChartService.ApacLibraCharts;period=1m;symbols=%5B%222330.TW%22%5D;type=k'),
                  ('ytw US AAPL stockList', Y + 'StockServices.stockList;fields=avgPrice%2Corderbook;symbols=AAPL,NVDA'),
                  ('ytw US AAPL tick', Y + 'FinanceChartService.ApacLibraCharts;symbols=%5B%22AAPL%22%5D;type=tick')]:
        st, hd, body = head(nm, u, headers=RH); j = js(body)
        if j is None: print('   body:', body[:300]); continue
        if isinstance(j, list) and j and isinstance(j[0], dict) and 'chart' in j[0]:
            c = j[0]['chart']; print('   meta:'); show(c.get('meta') or {}, 5, 0, 1)
            ts = c.get('timestamp') or []; q = ((c.get('indicators') or {}).get('quote') or [{}])[0]
            print('   n ts', len(ts), 'first', ts[:2], 'last', ts[-2:], 'quote keys', {k: (len(v), v[-3:]) for k, v in q.items() if isinstance(v, list)})
        elif isinstance(j, list):
            print('   items', len(j)); show(j[0] if j else {}, 5, 0, 2)
        else:
            show(j, 5, 0, 2)

if part in ('all', 'page'):
    names = set()
    for path in ['quote/2330.TW', 'quote/2330.TW/time-sales', 'quote/2330.TW/technical-analysis', 'quote/AAPL']:
        st, hd, body = head('yahoo page ' + path, 'https://tw.stock.yahoo.com/' + path, headers={'Accept': 'text/html'}, origin=None)
        t = body.decode('utf8', 'replace')
        tabs = re.findall(r'href="(/quote/[^"]+)"[^>]*>(?:<[^>]+>)*([^<]{1,12})<', t)
        seen, out = set(), []
        for h_, l_ in tabs:
            if (h_, l_) not in seen: seen.add((h_, l_)); out.append(f'{l_}→{h_}')
        print('   links:', ' | '.join(out)[:1500])
        names |= set(re.findall(r'\b([A-Z][A-Za-z]+(?:Services?|Service)\.[A-Za-z]+)', t))
        m = re.search(r'root\.App\.main\s*=\s*(\{.*?\});\s*\n', t, re.S)
        if m:
            try:
                A = json.loads(m.group(1)); stores = A['context']['dispatcher']['stores']; print('   stores:', list(stores)[:60])
                for k in stores:
                    if re.search(r'TimeSales|PriceVolume|Trade|Quote|Chart', k):
                        s = json.dumps(stores[k], ensure_ascii=False); print(f'   store {k} len {len(s)}: {s[:700]}')
            except Exception as e:
                print('   App.main parse fail', repr(e)[:100])
        srcs = re.findall(r'src="(https://s\.yimg\.com/[^"]+\.js)"', t)
        print('   scripts', len(srcs))
        for s in srcs[:40]:
            st2, hd2, b2 = get(s, origin=None)
            names |= set(re.findall(r'\b([A-Z][A-Za-z]+(?:Services?|Service)\.[A-Za-z]+)', b2.decode('utf8', 'replace')))
    print('\n== resource names found:', sorted(names))
    for n in sorted(names):
        if not re.search(r'(?i)trade|tick|pricevol|volume|order|timesale|quote|stat', n): continue
        for suf in (';limit=30;period=day;symbol=2330.TW', ';symbol=2330.TW', ';symbols=2330.TW'):
            st, hd, body = get(Y + n + suf, headers=RH)
            if st == 200 and len(body) > 5:
                print(f'\n== try {n}{suf} → {st} len {len(body)}: {body[:600].decode("utf8", "replace")}'); break
        else:
            print(f'   try {n}: no 200')

if part in ('all', 'cors'):
    t1 = int(time.time()); t0 = t1 - 6 * 3600
    for nm, u, hh in [
        ('cnyes quote', 'https://ws.api.cnyes.com/ws/api/v1/quote/quotes/TWS:2330:STOCK?column=G,QUOTES', {}),
        ('cnyes quote (cnyes origin)', 'https://ws.api.cnyes.com/ws/api/v1/quote/quotes/TWS:2330:STOCK?column=G,QUOTES', {'Origin': 'https://www.cnyes.com', 'Referer': 'https://www.cnyes.com/'}),
        ('cnyes charting 1m', f'https://ws.api.cnyes.com/ws/api/v1/charting/history?resolution=1&symbol=TWS:2330:STOCK&quote=1&from={t1}&to={t0}', {}),
        ('cnyes US quote', 'https://ws.api.cnyes.com/ws/api/v1/quote/quotes/USS:AAPL:STOCK?column=G,QUOTES', {}),
        ('twse mis', 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw&json=1&delay=0', {}),
        ('yahoo v8 chart AAPL', 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1m&range=1d&includePrePost=true', {}),
        ('yahoo v8 chart 2330.TW', 'https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1m&range=1d', {}),
        ('cnbc quote', 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=AAPL%7CNVDA&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1', {}),
        ('nasdaq info', 'https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks', {}),
        ('ytw stockList CORS', Y + 'StockServices.stockList;symbols=2330.TW', {}),
        ('twse openapi', 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL', {}),
    ]:
        st, hd, body = head(nm, u, headers=hh)
        print('   body:', body[:500].decode('utf8', 'replace').replace('\n', ' '))
