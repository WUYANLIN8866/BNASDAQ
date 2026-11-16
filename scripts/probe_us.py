"""暫時性探測（美股盤中）：(1) spark 的 meta 有哪些「前收」欄位、除息日哪個才是沒調整的；(2) 回應被快取多久、換主機或加參數會不會比較新。"""
import json, time, urllib.request, urllib.error
UA = 'Mozilla/5.0 (BNASDAQ heatmap fetch)'
base = json.load(open('data/heatmap/latest.json')); order = []; close = {}
for k in ('ndx', 'spx', 'sox'):
    for t in base['sets'][k]['tiles']:
        if t[0] not in close: order.append(t[0])
        close[t[0]] = t[5]

def get(url):
    t0 = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'}), timeout=12) as r:
            b = r.read(); h = {k.lower(): v for k, v in r.headers.items()}
            return r.status, json.loads(b), h, round((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, None, {}, round((time.time() - t0) * 1000)
    except Exception as e:  # noqa
        return 0, None, {'err': repr(e)[:80]}, round((time.time() - t0) * 1000)

def metas(j):
    out = {}
    for r in ((j or {}).get('spark') or {}).get('result') or []:
        try: out[r['symbol']] = r['response'][0]
        except Exception: pass
    return out

# ---- (1) 前收欄位 ----
syms = ['UPS', 'XOM', 'HSY', 'IP', 'AAPL', 'NVDA', 'JPM', 'SKYD', 'KLAC']
st, j, h, ms = get('https://query2.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(syms) + '&range=1d&interval=1d')
M1 = metas(j); print('range=1d status', st, 'headers', {k: h[k] for k in h if k in ('age', 'cache-control', 'expires', 'x-yahoo-request-id', 'via', 'x-cache', 'date')})
st5, j5, h5, ms5 = get('https://query2.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(syms) + '&range=5d&interval=1d')
M5 = metas(j5)
if M1:
    any_ = next(iter(M1.values())); print('meta keys:', sorted(any_.get('meta', {}).keys()))
for s in syms:
    m = (M1.get(s) or {}).get('meta') or {}; r5 = M5.get(s) or {}
    cl = (((r5.get('indicators') or {}).get('quote') or [{}])[0].get('close') or []); ts = r5.get('timestamp') or []
    bars = [(time.strftime('%m-%d', time.gmtime(t - 5 * 3600)), None if c is None else round(c, 3)) for t, c in zip(ts, cl)][-3:]
    p = m.get('regularMarketPrice')
    print(s, 'price', p, '| chartPreviousClose', m.get('chartPreviousClose'), '| previousClose', m.get('previousClose'), '| regularMarketPreviousClose', m.get('regularMarketPreviousClose'),
          '| regularMarketChangePercent', m.get('regularMarketChangePercent'), '| 5d meta chartPreviousClose', ((r5.get('meta') or {}).get('chartPreviousClose')), '| 5d bars', bars, '| base close', close.get(s),
          '| chg via cpc', None if not p or not m.get('chartPreviousClose') else round((p / m['chartPreviousClose'] - 1) * 100, 2), '| chg via base close', None if not p or not close.get(s) else round((p / close[s] - 1) * 100, 2))

# ---- (2) 回應的新鮮度：同一批用不同方式問 ----
B = [order[i:i + 20] for i in range(0, 60, 20)]
def age(j, now):
    ts = [((v.get('meta') or {}).get('regularMarketTime') or 0) for v in metas(j).values()]
    return round(now - max(ts)) if ts else None
variants = [('q2', lambda b: 'https://query2.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(b) + '&range=1d&interval=1d'),
            ('q1', lambda b: 'https://query1.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(b) + '&range=1d&interval=1d'),
            ('q2+nonce', lambda b: 'https://query2.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(b) + '&range=1d&interval=1d&_=%d' % int(time.time() * 1000)),
            ('q2 1m', lambda b: 'https://query2.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(b) + '&range=1d&interval=1m'),
            ('q2 rev', lambda b: 'https://query2.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(reversed(b)) + '&range=1d&interval=1d'),
            ('q2 again', lambda b: 'https://query2.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(b) + '&range=1d&interval=1d')]
print('\n新鮮度（最新一筆報價距現在幾秒；每輪間隔 60 秒，和正式程式同一個節奏）')
for rnd in range(6):
    t_round = time.time(); line = []
    for name, mk in variants:
        ages = []; codes = []; hdr = ''
        for b in B:
            st, j, h, ms = get(mk(b)); now = time.time(); ages.append(age(j, now) if st == 200 else 'E%d' % st); codes.append(st)
            hdr = h.get('age', '') or hdr
        line.append('%s %s%s' % (name, ages, (' age-hdr ' + hdr) if hdr else ''))
    print(time.strftime('%H:%M:%S', time.gmtime(t_round + 8 * 3600)), ' | '.join(line), flush=True)
    time.sleep(max(0, 60 - (time.time() - t_round)))
