"""暫時性探測：新的美股抓法（5 日線取前收＋每輪不同參數）在真的 runner 上的結果。連跑 4 輪、間隔 60 秒。"""
import importlib.util, json, time
spec = importlib.util.spec_from_file_location('hl', 'scripts/heatmap_live.py'); hl = importlib.util.module_from_spec(spec); spec.loader.exec_module(hl)
base = json.load(open('data/heatmap/latest.json')); close = {}
for k in ('ndx', 'spx', 'sox'):
    for t in base['sets'][k]['tiles']: close[t[0]] = t[5]
syms = hl.universe('US'); print('universe', len(syms), 'base session', base['session'])
for rnd in range(4):
    t0 = time.time(); got, stat = hl.fetch_us(syms, int(t0)); sec = time.time() - t0; now = time.time()
    ages = sorted(now - v[2] for v in got.values()); n = len(ages)
    diffs = sorted(((abs((p / prev - 1) * 100 - (p / close[s] - 1) * 100), s, p, prev, close[s]) for s, (p, prev, t, per) in got.items() if close.get(s)), reverse=True)
    big = [d for d in diffs if d[0] > 0.02]
    print(time.strftime('%H:%M:%S', time.gmtime(t0 + 8 * 3600)), 'stat', stat, '%.2fs' % sec, 'got', n, '| 報價秒數 中位 %.0f p90 %.0f p99 %.0f 最大 %.0f' % (ages[n // 2], ages[int(n * .9)], ages[int(n * .99)], ages[-1]),
          '| 前收和正式資料收盤不同（漲跌差>0.02）', len(big), [(d[1], d[3], d[4]) for d in big[:6]], flush=True)
    for s in ('UPS', 'XOM', 'AAPL', 'NVDA'):
        if s in got and rnd == 0: p, prev, t, per = got[s]; print('   ', s, '現價', p, '前收', prev, '正式收盤', close.get(s), '漲跌 %.2f%%' % ((p / prev - 1) * 100), '報價 %d 秒前' % (now - t))
    time.sleep(max(0, 60 - (time.time() - t0)))
