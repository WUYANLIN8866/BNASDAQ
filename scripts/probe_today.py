#!/usr/bin/env python3
"""暫時性實測（不是網站的一部分）：2026-11-27 盤前 Yahoo 沒有當天 K 棒 → 看 CNBC／鉅亨網／Nasdaq 現在有沒有盤前報價，以及 Yahoo 補上了沒。"""
import concurrent.futures as cf, datetime as dt, json, time, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York')
UA = 'Mozilla/5.0 (BNASDAQ heatmap fetch)'
BUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
et = lambda x: dt.datetime.fromtimestamp(int(x), ET).strftime('%m-%d %H:%M:%S') if x else None
D = json.load(open('main/data/heatmap/latest.json', encoding='utf-8'))
ALL = []
for k in ('ndx', 'spx', 'sox'):
    for t in D['sets'][k]['tiles']:
        if t and t[0] not in ALL:
            ALL.append(t[0])
print('now ET', et(time.time()), 'epoch', int(time.time()), 'symbols', len(ALL))


def get(url, ua=UA, h=None):
    t0 = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': ua, **(h or {})}), timeout=20)
        return r.status, r.read(), time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300], time.time() - t0
    except Exception as e:  # noqa
        return 0, repr(e).encode(), time.time() - t0


# 1. Yahoo 補上了沒
st, b, el = get(f'https://query2.finance.yahoo.com/v7/finance/spark?symbols=AAPL,NVDA,QQQ,SPY,TSLA&range=1d&interval=5m&includePrePost=true&_={int(time.time())}')
print('== Yahoo spark 1d 5m prepost →', st)
if st == 200:
    for r in (json.loads(b).get('spark') or {}).get('result') or []:
        resp = r['response'][0]; ts = resp.get('timestamp') or []
        print('  ', r['symbol'], 'rmt', et(resp['meta'].get('regularMarketTime')), 'bars', len(ts), 'first', et(ts[0]) if ts else None, 'last', et(ts[-1]) if ts else None)

# 2. CNBC：批次大小、涵蓋率、盤前欄位
CN = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&symbols='
csym = lambda s: s.replace('-', '.')


def cnbc(batch, ua=UA):
    st, b, el = get(CN + urllib.parse.quote('|'.join(csym(s) for s in batch), safe='|'), ua=ua)
    out = []
    if st == 200:
        try:
            q = (json.loads(b).get('FormattedQuoteResult') or {}).get('FormattedQuote') or []
            out = q if isinstance(q, list) else [q]
        except Exception as e:  # noqa
            st = -1; b = repr(e).encode()
    return st, out, el, len(b), b[:200] if st != 200 else b''


for ua, name in ((UA, 'UA=BNASDAQ'), (BUA, 'UA=Chrome')):
    st, q, el, n, err = cnbc(['AAPL', 'NVDA', 'QQQ', 'BRK-B', 'SPY'], ua)
    print(f'== CNBC 5 檔 {name} → {st} {n} bytes {el:.2f}s', err)
    for a in q:
        x = a.get('ExtendedMktQuote') or {}
        print('  ', a.get('symbol'), 'code', a.get('code'), 'status', a.get('curmktstatus'), 'last', a.get('last'), 'last_time', a.get('last_time'), 'prev', a.get('previous_day_closing'), 'realTime', a.get('realTime'),
              '| ext', x.get('type'), x.get('last'), x.get('change'), x.get('change_pct'), x.get('last_time'), x.get('last_timedate'), 'vol', x.get('volume'))
    if q:
        print('   keys', sorted(q[0].keys()))
        print('   ext keys', sorted((q[0].get('ExtendedMktQuote') or {}).keys()))
for size in (20, 50, 100, 200):
    st, q, el, n, err = cnbc(ALL[:size])
    print(f'== CNBC 一次 {size} 檔 → {st} 回 {len(q)} 檔 {n} bytes {el:.2f}s', err)
    time.sleep(1)
t0 = time.time(); res = {}; stats = {}
bs = [ALL[i:i + 50] for i in range(0, len(ALL), 50)]
with cf.ThreadPoolExecutor(4) as ex:
    for st, q, el, n, err in ex.map(cnbc, bs):
        stats[st] = stats.get(st, 0) + 1
        for a in q:
            res[str(a.get('symbol'))] = a
print(f'== CNBC 全部 {len(ALL)} 檔（每批 50、4 線）→ 狀態 {stats} 回 {len(res)} 檔 {time.time() - t0:.2f}s')
miss = [s for s in ALL if csym(s) not in res]
print('   沒回的代號', miss[:40])
typ, fresh, stat = {}, 0, {}
day0 = int(dt.datetime.now(ET).replace(hour=4, minute=0, second=0, microsecond=0).timestamp())
ages = []
for s, a in res.items():
    x = a.get('ExtendedMktQuote') or {}
    typ[x.get('type')] = typ.get(x.get('type'), 0) + 1
    stat[a.get('curmktstatus')] = stat.get(a.get('curmktstatus'), 0) + 1
    try:
        t = dt.datetime.fromisoformat(str(x.get('last_time')).replace('Z', '+00:00')).timestamp()
        if t >= day0:
            fresh += 1; ages.append(time.time() - t)
    except Exception:
        pass
ages.sort()
print('   curmktstatus', stat, '| ext type', typ, '| 盤前成交時間在今天 04:00 之後的', fresh, '| 幾秒前 min/med/max', [round(ages[0]), round(ages[len(ages) // 2]), round(ages[-1])] if ages else None)
# 連打 6 輪看會不會被擋
for i in range(6):
    t0 = time.time(); stats = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for st, q, el, n, err in ex.map(cnbc, bs):
            stats[st] = stats.get(st, 0) + 1
    print(f'   第 {i + 1} 輪 狀態 {stats} {time.time() - t0:.2f}s'); time.sleep(5)

# 3. 鉅亨網、Nasdaq
for s in ('AAPL', 'QQQ'):
    st, b, el = get(f'https://ws.api.cnyes.com/ws/api/v1/quote/quotes/USS:{s}:STOCK?column=G,QUOTES,K,KEY,B,M,FORMAT')
    print(f'== 鉅亨網 {s} → {st}')
    if st == 200:
        try:
            d = (json.loads(b).get('data') or [{}])[0]
            print('   6', d.get('6'), '21', d.get('21'), '200007', et(d.get('200007')), '800003', d.get('800003'), {k: v for k, v in d.items() if 'pre' in str(k).lower() or 'ext' in str(k).lower()})
        except Exception as e:  # noqa
            print('   ERR', repr(e)[:200])
    st, b, el = get(f'https://api.nasdaq.com/api/quote/{s}/info?assetclass={"etf" if s == "QQQ" else "stocks"}', ua=BUA, h={'Accept': 'application/json'})
    print(f'== Nasdaq {s} → {st}', b[:500])
