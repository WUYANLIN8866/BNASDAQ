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
# ---- 新來源解析（用 2026-11-07 探測到的真實格式做成的離線樣本）----
import io, openpyxl
PAGES = {}
m.get = lambda url, headers=None, timeout=60, tries=3, data=None: PAGES[url] if url in PAGES else (_ for _ in ()).throw(RuntimeError('unexpected url ' + url))
# 統一：首頁連結 → 內部代號；基金頁內嵌資產明細（HTML 跳脫的 JSON）
q = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':')).replace('"', '&quot;')   # 官網是緊湊 JSON（逗號、冒號後沒有空白）
PAGES['https://www.ezmoney.com.tw/ETF/'] = '<a title="x" href="/ETF/Fund/Info?fundCode=49YTW">00981A 主動統一台股增長</a><a href="/ETF/Fund/Info?fundCode=36YTW">00757 統一FANG+</a><a href="/ETF/Fund/Info?fundCode=65YTW">00987D 主動統一美債量化</a>'.encode()
def uni_page(fc, short, groups):
    meta = q({'sFundCode': fc, 'sFundName': 'x', 'sFundShortName': short})
    return ('<div data-x="' + meta + '"></div><fund-assets :assets="' + q(groups) + '"></fund-assets>').encode()
PAGES['https://www.ezmoney.com.tw/ETF/Fund/Info?FundCode=49YTW'] = uni_page('49YTW', '00981A 主動統一台股增長', [
    {'FundCode': '49YTW', 'AssetCode': 'NAV', 'Value': 233295466896.0},
    {'FundCode': '49YTW', 'AssetCode': 'GD', 'Details': [{'DetailCode': 'TX', 'DetailName': '台指期貨', 'Position': 'B', 'Amount': 6875656800.0, 'NavRate': 2.95, 'TranDate': '2026-11-06T00:00:00', 'MoneyType': 'NTD'}]},
    {'FundCode': '49YTW', 'AssetCode': 'ST', 'Details': [{'DetailCode': '2330', 'DetailName': '台積電', 'Amount': 35398300000.0, 'NavRate': 15.17, 'TranDate': '2026-11-06T00:00:00', 'MoneyType': 'NTD'},
                                                          {'DetailCode': '2481', 'DetailName': '強茂', 'Amount': 9331000.0, 'NavRate': 0.0, 'TranDate': '2026-11-06T00:00:00', 'MoneyType': 'NTD'}]},
    {'FundCode': '49YTW', 'AssetCode': 'CASH', 'Value': 14133496396.0}])
PAGES['https://www.ezmoney.com.tw/ETF/Fund/Info?FundCode=36YTW'] = uni_page('36YTW', '00757 統一FANG+', [
    {'FundCode': '36YTW', 'AssetCode': 'NAV', 'Value': 34711681368.0},
    {'FundCode': '36YTW', 'AssetCode': 'ST', 'Details': [{'DetailCode': 'MSFT US', 'DetailName': 'MICROSOFT CORP(微軟公司)', 'Amount': 120069221.27, 'NavRate': 11.38, 'TranDate': '2026-11-05T00:00:00', 'MoneyType': 'USD'}]}])
PAGES['https://www.ezmoney.com.tw/ETF/Fund/Info?FundCode=65YTW'] = uni_page('65YTW', '00987D 主動統一美債量化', [{'FundCode': '65YTW', 'AssetCode': 'NAV', 'Value': 1.0}, {'FundCode': '65YTW', 'AssetCode': 'BD', 'Details': [{'DetailCode': 'T 4 1/2', 'NavRate': 97.0, 'TranDate': '2026-11-06T00:00:00'}]}])
assert m.uni_list() == {'00981A': '49YTW', '00757': '36YTW', '00987D': '65YTW'}, m.UNI
rows, asof, src = m.src_uni('00981A')
assert asof == '2026-11-06' and [r['t'] for r in rows] == ['2330', '2481'] and abs(rows[0]['w'] - 35398300000 / 233295466896 * 100) < 1e-9 and 0 < rows[1]['w'] < 0.005, rows
assert '台指期貨多單 2.95%' in m.EXTRA['00981A']['note']
rows, asof, src = m.src_uni('00757'); assert rows[0]['t'] == 'MSFT' and rows[0]['country'] == 'United States' and rows[0]['w'] == 11.38 and m.key_of(rows[0]['t'], '', rows[0]['country'], '') == ('MSFT', 'US')
rows, asof, src = m.src_uni('00987D'); assert rows == [] and '00987D' in m.NO_STOCK
PAGES['https://www.ezmoney.com.tw/ETF/Fund/Info?FundCode=49YTW'] = uni_page('49YTW', '00939 統一台灣高息動能', [{'FundCode': '49YTW', 'AssetCode': 'NAV', 'Value': 1.0}])
try:
    m.src_uni('00981A'); sys.exit('統一代號比對失效')
except RuntimeError:
    pass
# J.P. Morgan：Excel 標題列（基金名稱 - CUSIP）、表頭、權重欄可能是小數
def jpm_xlsx(title, frac):
    wb = openpyxl.Workbook(); ws = wb.active
    for _ in range(5): ws.append([])
    ws.append(['Holdings', title, 'As of Date: 11/06/2026']); ws.append([])
    H = ['Ticker', 'Security Description', 'Security Type', 'Method', 'Shares/Par', 'Market Value (USD)', 'Country', 'Currency', 'Sector', 'Industry', 'Coupon', 'Maturity Date', 'Effective Date', 'Contract Size', 'Strike Price', '% of Market Value', '% of Net Assets']
    ws.append(H)
    k = 0.01 if frac else 1
    for t, d, ty, sec, w in [('MA', 'MASTERCARD INC COMMON', 'DOMESTIC COMMON STOCK', 'Financials', 2.04), ('O', 'REALTY INCOME', 'REIT', 'Real Estate', 1.0), ('ELN1', 'BNP ELN', 'Equity Linked Notes', '', 13.78), ('', 'CASH', 'CURRENCIES', '', -0.13), ('MMF', 'JPM MMF', 'MONEY MARKET', '', 83.31)]:
        ws.append([t, d, ty, 'Physical', '1', 1.0, 'United States', 'USD', sec, '', None, None, None, None, None, w * k, w * k])
    ws.append(['Holdings are subject to change.'])
    b = io.BytesIO(); wb.save(b); return b.getvalue()
U_JEPI = 'https://am.jpmorgan.com/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=46641Q332&country=us&role=adv&locale=en-US'
for frac in (False, True):
    PAGES[U_JEPI] = jpm_xlsx('JPMorgan Equity Premium Income ETF - 46641Q332', frac)
    rows, asof, src = m.src_jpm('JEPI')
    assert asof == '2026-11-06' and [(r['t'], round(r['w'], 6), r['sec']) for r in rows] == [('MA', 2.04, '金融'), ('O', 1.0, '房地產')], rows
PAGES[U_JEPI] = jpm_xlsx('JPMorgan Nasdaq Equity Premium Income ETF - 46654Q203', False)
try:
    m.src_jpm('JEPI'); sys.exit('J.P. Morgan 標題比對失效')
except RuntimeError:
    pass
# Invesco：產品頁 meta（代號、CUSIP）→ 以 CUSIP 查持股；只收股票類
PAGES['https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker=RSP'] = b'<meta name="ticker" content="RSP"/> <meta name="cusip" content="46137V357"/>'
PAGES['https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46137V357/holdings/fund?idType=cusip&productType=ETF'] = json.dumps({'effectiveDate': '2026-11-05', 'holdings': [
    {'ticker': 'MRNA', 'issuerName': 'Moderna Inc', 'percentageOfTotalNetAssets': 0.351404, 'securityTypeCode': 'COM', 'cusip': '60770K107'},
    {'ticker': 'ESH6', 'issuerName': 'S&P 500 future', 'percentageOfTotalNetAssets': 0.1, 'securityTypeCode': 'FUT', 'cusip': ''}]}).encode()
rows, asof, src = m.src_invesco('RSP'); assert asof == '2026-11-05' and [(r['t'], r['w'], r['isin']) for r in rows] == [('MRNA', 0.351404, 'US60770K107')], rows
PAGES['https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker=SPLV'] = b'<meta name="ticker" content="RSP"/> <meta name="cusip" content="46137V357"/>'
try:
    m.src_invesco('SPLV'); sys.exit('Invesco 代號比對失效')
except RuntimeError:
    pass
print('資料管線規則：全部通過')
