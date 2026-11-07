"""暫時用：第 20 輪——篩選器價格快照是否與第 5 次試跑相同"""
import urllib.request, json, sys
sys.stdout.reconfigure(line_buffering=True)
H = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
def j(u): return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=90).read())
st = j('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&download=true'); d = st['data']
print('stocks asof', d.get('asof'), '| rows', len(d.get('rows') or []))
P = {r['symbol']: r['lastsale'] for r in d.get('rows') or []}
print('stocks', {k: P.get(k) for k in ('AAPL', 'NVDA', 'MSFT', 'TSM')})
et = j('https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=25&download=true'); e = et['data']
rows = e.get('rows') or (e.get('data') or {}).get('rows') or []
print('etf keys', list(e.keys()), '| rows', len(rows), '| sample keys', list(rows[0].keys()) if rows else None)
Q = {r['symbol']: r.get('lastSalePrice') for r in rows}
print('etf', {k: Q.get(k) for k in ('SPY', 'QQQ', 'VOO', 'QLD')})
