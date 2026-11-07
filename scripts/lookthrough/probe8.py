"""暫時用：第 18 輪——用修正後的程式重抓 JEPI、JEPQ（資料日），輸出完整 json"""
import importlib.util, os, sys, json, tempfile, base64, gzip
sys.stdout.reconfigure(line_buffering=True)
spec = importlib.util.spec_from_file_location('flt', os.path.join(os.path.dirname(__file__), '..', 'fetch_lookthrough.py')); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.ETF_DIR = tempfile.mkdtemp()
U, fx, asof = m.build_universe()
for c in ('JEPI', 'JEPQ'):
    rows, a, src = m.src_jpm(c); eq = m.finalize(c, rows, a, src, U)
    s = open(os.path.join(m.ETF_DIR, c + '.json'), encoding='utf-8').read()
    print('FILE', c, a, eq, base64.b64encode(gzip.compress(s.encode())).decode())
