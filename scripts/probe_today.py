#!/usr/bin/env python3
"""暫時性實測（不是網站的一部分）：新版 heatmap_live.py 的 CNBC 備援，用真實資料跑一輪盤前。"""
import json, subprocess, sys, time
r = subprocess.run([sys.executable, 'scripts/heatmap_live.py', 'once', '--market', 'US', '--ext', 'pre'], capture_output=True, text=True, cwd='main')
print(r.stderr[-1500:]); print(r.stdout[-3000:])
r = subprocess.run([sys.executable, 'scripts/heatmap_live.py', 'once', '--market', 'US', '--board', 'pre'], capture_output=True, text=True, cwd='main')
print(r.stderr[-800:])
try:
    j = json.loads(r.stdout.strip().splitlines()[-1]); print('board ok', j['ok'], 'q', j['q'], 'x', j['x'], json.dumps(j['mb']['x']))
except Exception as e:
    print('board parse', repr(e), r.stdout[-500:])
sys.path.insert(0, 'main/scripts')
import heatmap_live as hm
t0 = time.time(); syms = hm.universe('US'); got, ok = hm.fetch_cnbc(syms, int(time.time()))
pre = {s: v for s, v in got.items() if v[4] == 'pre'}
print(f'fetch_cnbc {len(syms)} 檔 → 回 {len(got)}、OK 批數 {ok}、盤前有成交 {len(pre)}、{time.time() - t0:.2f}s；沒回的', [s for s in syms if s not in got][:60])
for s in ('AAPL', 'NVDA', 'QQQ', 'BRK-B', 'QLD', 'SHV', 'TSLA', 'SPCX', 'ANT', 'BOXX'):
    print('  ', s, got.get(s))
