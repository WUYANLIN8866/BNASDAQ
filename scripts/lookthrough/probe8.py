"""暫時用：第 19 輪——Nasdaq 收盤價的日期欄位"""
import urllib.request, json, sys
sys.stdout.reconfigure(line_buffering=True)
H = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
def j(u): return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=60).read())
for u in ['https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=5', 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=5']:
    d = j(u); dd = d.get('data') or {}
    print(u, '| data keys', list(dd.keys()), '| asof-ish', {k: dd.get(k) for k in dd if 'as' in k.lower() or 'date' in k.lower() or 'time' in k.lower()})
    inner = dd.get('data') if isinstance(dd.get('data'), dict) else {}
    print('   inner keys', list(inner.keys())[:10], {k: inner.get(k) for k in inner if 'as' in k.lower() or 'date' in k.lower()})
for u in ['https://api.nasdaq.com/api/quote/SPY/info?assetclass=etf', 'https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks']:
    d = j(u); p = ((d.get('data') or {}).get('primaryData')) or {}
    print(u, '| primaryData', json.dumps(p)[:400], '| marketStatus', (d.get('data') or {}).get('marketStatus'))
