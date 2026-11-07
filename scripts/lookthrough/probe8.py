"""暫時用：第 17 輪——用新版程式實抓 VanEck、iShares 債券型"""
import importlib.util, os, sys
sys.stdout.reconfigure(line_buffering=True)
spec = importlib.util.spec_from_file_location('flt', os.path.join(os.path.dirname(__file__), '..', 'fetch_lookthrough.py')); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for fn, codes in ((m.src_vaneck, ['ESPO', 'REMX', 'DURA', 'BIZD', 'NLR', 'MORT', 'SMH', 'HYD', 'ANGL', 'PFXF', 'TRUC', 'VEEM', 'GENZ']), (m.src_ishares, ['IBDR', 'BCLO', 'TLTW', 'IVV'])):
    for c in codes:
        try:
            rows, asof, src = fn(c)
            print(c, '| rows', len(rows), '| eq %.2f' % sum(r['w'] for r in rows), '| asof', asof, '| no_stock', c in m.NO_STOCK, '| top', [(r['t'], round(r['w'], 2)) for r in rows[:3]])
        except Exception as e:
            print(c, 'ERR', repr(e)[:160])
