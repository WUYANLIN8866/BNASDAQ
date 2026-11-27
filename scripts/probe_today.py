#!/usr/bin/env python3
"""暫時性實測（不是網站的一部分）：2026-11-27 盤前熱力圖沒更新 → 看 Yahoo 現在實際回什麼。"""
import datetime as dt, json, time, urllib.error, urllib.request
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York')
UA = 'Mozilla/5.0 (BNASDAQ heatmap fetch)'
SY = ['AAPL', 'NVDA', 'QQQ', 'TSLA', 'SPY', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AVGO']
et = lambda x: dt.datetime.fromtimestamp(int(x), ET).strftime('%m-%d %H:%M:%S') if x else None


def get(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=20)
        return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300], {}
    except Exception as e:  # noqa
        return 0, repr(e).encode(), {}


def show(tag, m, ts, cl):
    bars = [(int(t), c) for t, c in zip(ts or [], cl or []) if c is not None]
    ctp = m.get('currentTradingPeriod') or {}
    per = {k: (et((ctp.get(k) or {}).get('start')), et((ctp.get(k) or {}).get('end'))) for k in ('pre', 'regular', 'post')}
    print(' ', tag, 'rmp', m.get('regularMarketPrice'), 'rmt', et(m.get('regularMarketTime')), 'cpc', m.get('chartPreviousClose'), 'pc', m.get('previousClose'),
          '| bars', len(bars), 'first', et(bars[0][0]) if bars else None, 'last', et(bars[-1][0]) if bars else None, bars[-1][1] if bars else None,
          '| ctp', per, '| range', m.get('range'), 'gran', m.get('dataGranularity'), 'hasPrePost', m.get('hasPrePostMarketData'))


print('now ET', et(time.time()), 'epoch', int(time.time()))
for host in ('query2', 'query1'):
    for q in ('range=1d&interval=5m&includePrePost=true', 'range=1d&interval=1m&includePrePost=true', 'range=2d&interval=5m&includePrePost=true',
              'range=5d&interval=5m&includePrePost=true', 'range=1d&interval=5m', 'range=5d&interval=1d'):
        url = f'https://{host}.finance.yahoo.com/v7/finance/spark?symbols={",".join(SY)}&{q}&_={int(time.time())}'
        st, b, h = get(url)
        print(f'== spark {host} {q} → {st} {len(b)} bytes cache={h.get("cache-control")} age={h.get("age")}')
        if st != 200:
            print('  ', b[:200]); continue
        for r in (json.loads(b).get('spark') or {}).get('result') or []:
            try:
                resp = r['response'][0]
                show(r['symbol'], resp['meta'], resp.get('timestamp'), ((resp.get('indicators') or {}).get('quote') or [{}])[0].get('close'))
            except Exception as e:  # noqa
                print('  ', r.get('symbol'), 'ERR', repr(e)[:100])
        time.sleep(1)
for host in ('query2', 'query1'):
    for s in ('AAPL', 'QQQ'):
        for q in ('range=1d&interval=5m&includePrePost=true', 'range=2d&interval=5m&includePrePost=true'):
            st, b, h = get(f'https://{host}.finance.yahoo.com/v8/finance/chart/{s}?{q}&_={int(time.time())}')
            print(f'== chart {host} {s} {q} → {st} {len(b)} bytes')
            if st != 200:
                print('  ', b[:200]); continue
            try:
                res = json.loads(b)['chart']['result'][0]
                show(s, res['meta'], res.get('timestamp'), ((res.get('indicators') or {}).get('quote') or [{}])[0].get('close'))
                tp = res['meta'].get('tradingPeriods')
                print('   tradingPeriods', json.dumps(tp)[:600] if tp else None)
            except Exception as e:  # noqa
                print('   ERR', repr(e)[:200])
            time.sleep(1)
