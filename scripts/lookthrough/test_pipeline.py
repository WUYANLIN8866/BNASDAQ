#!/usr/bin/env python3
"""投資組合透視資料管線的規則測試（不連網）：代號對照、名稱清理、同公司合併、權重加總防呆。用法：python3 scripts/lookthrough/test_pipeline.py"""
import importlib.util, os, json, tempfile, sys
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('flt', os.path.join(HERE, '..', 'fetch_lookthrough.py')); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cases = [(('AAPL', 'US0378331005', '', 'Apple'), ('AAPL', 'US')), (('2330', 'TW0002330008', '', 'TSMC'), ('2330', 'TW')), (('2330', '', 'Taiwan', 'TSMC'), ('2330', 'TW')),
         (('TSM', '', '', 'TSMC ADR'), ('2330', 'TW')), (('BRK.B', '', '', 'Berkshire'), ('BRK-B', 'US')), (('AAPL UQ', '', '', 'APPLE INC'), ('AAPL', 'US')),
         (('7203', '', 'Japan', 'Toyota'), ('X:Japan:7203', 'X')), (('005930', 'KR7005930003', '', 'Samsung'), ('X:KR7005930003', 'X'))]
for args, want in cases:
    assert m.key_of(*args) == want, (args, m.key_of(*args), want)
assert m.clean_name('Alphabet Inc. Class A Common Stock') == 'Alphabet Inc.'
tmp = tempfile.mkdtemp(); m.ETF_DIR = tmp
U = {'GOOGL': ['GOOGL', 'Alphabet Inc.', 'US', 'S', 300, '通訊服務'], 'XYZ': ['XYZ', 'Test ETF', 'US', 'E', 10, ''], '2330': ['2330', '台積電', 'TW', 'S', 1450, '資訊科技']}
rows = [dict(t='GOOGL', name='A', isin='', country='', w=3.0, sec=''), dict(t='GOOG', name='C', isin='', country='', w=2.5, sec=''), dict(t='TSM', name='ADR', isin='', country='', w=1.0, sec=''), dict(t='2330', name='T', isin='TW0002330008', country='', w=0.5, sec='')]
assert m.finalize('XYZ', rows, '2026-11-06', 'test', U) == 7.0
d = json.load(open(os.path.join(tmp, 'XYZ.json'), encoding='utf-8')); assert d['h'][0][:2] == ['GOOGL', 5.5] and d['h'][1][:3] == ['2330', 1.5, '台積電']
try:
    m.finalize('XYZ', [dict(t='A', name='a', isin='', country='', w=60, sec=''), dict(t='B', name='b', isin='', country='', w=50, sec='')], '', 'x', U); sys.exit('權重加總防呆失效')
except ValueError:
    pass
print('資料管線規則：全部通過')
