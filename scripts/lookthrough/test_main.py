#!/usr/bin/env python3
"""不連網跑一次 main()：網路來源換成本機資料，確認收尾（清單、價格、涵蓋率、紀錄）不會出錯。用法：python3 scripts/lookthrough/test_main.py"""
import importlib.util, os, sys, json, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location('flt', os.path.join(ROOT, 'scripts', 'fetch_lookthrough.py')); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
tmp = tempfile.mkdtemp(); m.OUT = os.path.join(tmp, 'lt'); m.ETF_DIR = os.path.join(m.OUT, 'etf'); os.makedirs(m.ETF_DIR)
U = {'0050': ['0050', '元大台灣50', 'TW', 'E', 97.15, ''], '006208': ['006208', '富邦台50', 'TW', 'E', 160, ''], '00679B': ['00679B', '元大美債20年', 'TW', 'E', 28, ''], '00635U': ['00635U', '期元大S&P黃金', 'TW', 'E', 40, ''],
     '2330': ['2330', '台積電', 'TW', 'S', 1450, '資訊科技'], 'QQQ': ['QQQ', 'Invesco QQQ Trust', 'US', 'E', 656.1, ''], 'QLD': ['QLD', 'ProShares Ultra QQQ', 'US', 'E', 120, ''], 'GLD': ['GLD', 'SPDR Gold Shares', 'US', 'E', 300, ''],
     'GDX': ['GDX', 'VanEck Gold Miners ETF', 'US', 'E', 50, ''], 'AAPL': ['AAPL', 'Apple Inc.', 'US', 'S', 344, '資訊科技']}
m.build_universe = lambda: (U, {'USDTWD': 32.769, 'date': '2026-11-05'}, {'TW': '2026-11-06', 'TWO': '2026-11-06', 'US': '2026-11-06'})
def fake_us(U_, codes, maxn, report):
    m.finalize('QQQ', [dict(t='AAPL', name='Apple', isin='', country='', w=8.7, sec='')], '2026-11-05', 'Invesco 每日持股', U_); report['ok']['QQQ'] = ['Invesco', '2026-11-05', 1, 8.7]
def fake_tw(U_, codes, report):
    m.finalize('0050', [dict(t='2330', name='台積電', isin='', country='Taiwan', w=58.85, sec='')], '2026-11-06', '元大投信 持股權重', U_); report['ok']['0050'] = ['元大', '2026-11-06', 1, 58.85]
m.run_us, m.run_tw = fake_us, fake_tw
sys.argv = ['x']; rc = m.main(); assert rc == 0
u = json.load(open(os.path.join(m.OUT, 'universe.json'), encoding='utf-8')); px = json.load(open(os.path.join(m.OUT, 'px.json'), encoding='utf-8')); meta = json.load(open(os.path.join(m.OUT, 'meta.json'), encoding='utf-8'))
L = {x[0]: x for x in u['list']}
assert L['QQQ'][5] == 1 and L['QLD'][5] == 1 and L['006208'][5] == 1 and L['00679B'][5] == 1 and L['GLD'][5] == 1 and L['00635U'][5] == 1 and L['GDX'][5] == 0, L
assert px['px']['QQQ'] == 656.1 and meta['coverage']['TW'][0] == 4 and meta['sources']['元大'] == 1, (meta['coverage'], meta['sources'])
d = json.load(open(os.path.join(m.ETF_DIR, 'QLD.json'), encoding='utf-8')); assert d['base'] == 'QQQ' and d['lev'] == 2
sys.argv = ['x', '--only', 'universe']; m.main(); assert json.load(open(os.path.join(m.OUT, 'meta.json'), encoding='utf-8')) == meta, '只更新價格時不該改寫成分股紀錄'
shutil.rmtree(tmp); print('main() 收尾：全部通過（涵蓋率', meta['coverage'], '）')
