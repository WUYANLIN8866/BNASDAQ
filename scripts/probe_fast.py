"""暫時性探測：台股「收盤後報價」（Yahoo奇摩股市）對全部上市櫃代號的涵蓋率、速度，以及和官方收盤是否一致。"""
import importlib.util, json, time, datetime as dt, collections
spec = importlib.util.spec_from_file_location('fl', 'scripts/fetch_latest.py'); fl = importlib.util.module_from_spec(spec); spec.loader.exec_module(fl)
L = json.load(open('data/tw/latest.json'))
by = {m: [k for k, v in L['items'].items() if v[3] == m] for m in ('TW', 'TWO')}
today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat()
print('today', today, 'file asof', L['asof'], 'sources', L.get('sources'))
t0 = time.time(); fast = fl.fetch_tw_fast(by, today); sec = time.time() - t0
print('fetch_tw_fast seconds %.1f' % sec, 'requests', sum((len(v) + 49) // 50 for v in by.values()))
for m in ('TW', 'TWO'):
    got, n = fast[m], len(by[m])
    eq = [c for c, (p, ch) in got.items() if abs(p - L['items'][c][0]) < 1e-6]
    ne = [(c, got[c][0], L['items'][c][0]) for c in got if abs(got[c][0] - L['items'][c][0]) >= 1e-6]
    ceq = sum(1 for c, (p, ch) in got.items() if L['items'][c][1] is not None and ch is not None and abs(ch - L['items'][c][1]) < 0.011)
    cne = [(c, got[c][1], L['items'][c][1]) for c in got if not (L['items'][c][1] is not None and got[c][1] is not None and abs(got[c][1] - L['items'][c][1]) < 0.011)]
    print(m, '今天有成交', len(got), '/', n, '(%.1f%%)' % (100 * len(got) / n), '| 價格與官方相同', len(eq), '不同', len(ne), ne[:12], '| 漲跌相同', ceq, '不同', len(cne), cne[:12])
    print('   沒有今天成交的代號（前 40）', [c for c in by[m] if c not in got][:40])
