#!/usr/bin/env python3
"""暫時性實測第 5 輪（只在 probe 分支）：個股新聞來源（鉅亨網 symbolNews 等）的 CORS、欄位、可回溯多久；內外盤欄位對照。"""
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
T = lambda s: time.strftime('%Y-%m-%d %H:%M', time.gmtime(s + 8 * 3600))
def save(name, url, n=0, **kw):
    st, hd, body = get(url, **kw)
    acao = hd.get('Access-Control-Allow-Origin') if hd else None
    open(os.path.join(OUT, name + '.json'), 'wb').write(body)
    INDEX.append({'name': name, 'url': url, 'status': st, 'acao': acao, 'len': len(body), 'at': int(time.time())})
    P(f'== {name} | status {st} len {len(body)} ACAO={acao}' + (f' | {body[:n].decode("utf8", "replace")}' if n else ''))
    try: return json.loads(body)
    except Exception: return None
def items_of(j):
    d = (j or {}).get('items') if isinstance(j, dict) else None
    if isinstance(d, dict): return d.get('data') or [], d
    d = (j or {}).get('data') if isinstance(j, dict) else None
    if isinstance(d, dict): return d.get('items') or d.get('data') or [], d
    if isinstance(d, list): return d, {}
    return [], {}
now = int(time.time()); P('time', T(now), 'Taipei')
A = 'https://api.cnyes.com/media/api/v1/newslist/'
for sym in ['TWS:2330:STOCK', 'TWS:1216:STOCK', 'TWS:6488:STOCK', 'TWS:0050:STOCK', 'USS:AAPL:STOCK', 'USS:NVDA:STOCK']:
    tag = re.sub(r'\W', '_', sym)
    j = save(f'news_sym_{tag}_p1', A + f'{sym}/symbolNews?page=1&limit=30', n=500)
    it, meta = items_of(j)
    P('   meta', {k: v for k, v in meta.items() if k not in ('data', 'items')}, '| n', len(it), '| keys', sorted(it[0].keys()) if it else None)
    if it: P('   newest', T(it[0].get('publishAt') or 0), it[0].get('title'), '| oldest', T(it[-1].get('publishAt') or 0))
for nm, u in [('news_sym_2330_range30d', A + f'TWS:2330:STOCK/symbolNews?page=1&limit=30&startAt={now - 86400 * 30}&endAt={now}'),
              ('news_sym_2330_range_1y_old', A + f'TWS:2330:STOCK/symbolNews?page=1&limit=30&startAt={now - 86400 * 365}&endAt={now - 86400 * 300}'),
              ('news_sym_2330_limit100', A + 'TWS:2330:STOCK/symbolNews?page=1&limit=100'),
              ('news_sym_2330_p20', A + 'TWS:2330:STOCK/symbolNews?page=20&limit=30'),
              ('news_sym_2330_p100', A + 'TWS:2330:STOCK/symbolNews?page=100&limit=30'),
              ('news_sym_AAPL_p30', A + 'USS:AAPL:STOCK/symbolNews?page=30&limit=30'),
              ('news_cat_tw', A + 'category/tw_stock?page=1&limit=5'),
              ('news_cat_tw_range', A + f'category/tw_stock?page=1&limit=5&startAt={now - 7200}&endAt={now}'),
              ('news_kw', 'https://ess.api.cnyes.com/ess/api/v1/news/keyword?q=' + urllib.parse.quote('台積電') + '&limit=5&page=1'),
              ('news_v3', 'https://news.cnyes.com/api/v3/news/category/tw_stock?limit=5'),
              ('gnews_rss', 'https://news.google.com/rss/search?q=' + urllib.parse.quote('台積電 when:7d') + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant'),
              ('ytw_rss', 'https://tw.stock.yahoo.com/rss?s=2330.TW')]:
    j = save(nm, u, n=260)
    it, meta = items_of(j)
    if it: P('   meta', {k: v for k, v in meta.items() if k not in ('data', 'items')}, '| n', len(it), 'newest', T(it[0].get('publishAt') or 0), 'oldest', T(it[-1].get('publishAt') or 0))
# 內外盤對照：Yahoo in/out（張）對 cnyes 200054／200055
W = 'https://ws.api.cnyes.com/ws/api/v1/'; Y = 'https://tw.stock.yahoo.com/_td-stock/api/resource/'; RH = {'Referer': 'https://tw.stock.yahoo.com/'}
codes = '2317 2454 2308 2382 2881 2882 2412 2891 2886 2884 1216 2357 3231 2885 2892 3034 2890 2345 5880 2880 2002 2379 2883 1303 2887 2207 1301 2603 1101 2912'.split()
jy = save('io_ytw', Y + 'StockServices.stockList;symbols=' + ','.join(c + '.TW' for c in codes), headers=RH)
jc = save('io_cnyes', W + 'quote/quotes/' + ','.join(f'TWS:{c}:STOCK' for c in codes) + '?column=K,E')
try:
    ym = {str(a['symbol']).split('.')[0]: a for a in jy}; cm = {str(q['200010']): q for q in jc['data']}
    s1 = s2 = n = 0
    for c in codes:
        a, q = ym.get(c), cm.get(c)
        if not a or not q: continue
        yi, yo, c54, c55 = a.get('inMarket'), a.get('outMarket'), q.get('200054'), q.get('200055')
        lim = a.get('limitUp') or a.get('limitDown')
        P(f'   {c} yahoo 內 {yi} 外 {yo} | cnyes 200054 {c54} 200055 {c55} | 漲跌停 {lim} | 價 {q.get("6")} vol {q.get("200013")}')
        if yi and yo and c54 and c55 and not lim:
            n += 1; s1 += abs(c54 - yi) + abs(c55 - yo); s2 += abs(c54 - yo) + abs(c55 - yi)
    P(f'   非漲跌停 {n} 檔：假設 200054＝內盤 的總誤差 {s1:.0f}；假設 200054＝外盤 的總誤差 {s2:.0f}')
except Exception as e:
    P('   compare fail', repr(e)[:200])
json.dump(INDEX, open(os.path.join(OUT, '_index5.json'), 'w'), ensure_ascii=False, indent=1)
