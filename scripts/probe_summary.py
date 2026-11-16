import json, collections
j = json.load(open('data/tw/latest.json'))
print('LATEST asof', j['asof'], '| prelim', j.get('prelim'), '| changed', j.get('changed'), '| updated', j['updated'])
print('notes', j.get('notes')); print('errors', j.get('errors')); print('source', j.get('source'))
print('items by market', dict(collections.Counter(v[3] for v in j['items'].values())))
for c in ('2330', '0050', '00670L', '009800', '6488', '8069', 'QLD', 'SHV', 'TSLA', 'QQQ'):
    print('  ', c, j['items'].get(c))
print('fx', j.get('fx'))
try:
    u = json.load(open('data/lt/us-close.json'))
    print('US-ALL asof', u['asof'], 'n', u['n'], 'of', u['of'], 'updated', u['updated'])
    for c in ('SPCX', 'QLD', 'AAPL', 'BRK-B', 'SPY', 'VOO'):
        print('  ', c, u['px'].get(c))
    uni = json.load(open('data/lt/universe.json'))['list']
    miss = [x[0] for x in uni if x[2] == 'US' and x[0] not in u['px']]
    kinds = collections.Counter(x[3] for x in uni if x[2] == 'US' and x[0] not in u['px'])
    print('missing', len(miss), dict(kinds), 'sample', miss[:40])
except Exception as e:
    print('us-close.json:', repr(e))
