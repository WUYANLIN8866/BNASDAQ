"""暫時用：第 21 輪——篩選器的日期欄位"""
import urllib.request, json, sys
H = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
def j(u): return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=90).read())
e = j('https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=25&download=true')['data']; print('ETF dataAsOf', repr(e.get('dataAsOf')), '| SPY', [r['lastSalePrice'] for r in (e.get('data') or {}).get('rows') or e.get('rows') or [] if r['symbol'] == 'SPY'])
s = j('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=1')['data']; print('STOCK asof', repr(s.get('asof')), '| first', (s.get('table') or {}).get('rows', [])[:1])
s2 = j('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=false')['data']; print('STOCK2 asof', repr(s2.get('asof')))
