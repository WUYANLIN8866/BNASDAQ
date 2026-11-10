"""資料來源可行性探測 2（暫時）：只用公開 API／開放資料，單一誠實 User-Agent，不繞過任何驗證。"""
import json, re, sys, time, urllib.request, gzip
UA = 'BNASDAQ company fetch (+https://github.com/WUYANLIN8866/BNASDAQ)'
def get(url, extra=None, timeout=90):
    h = {'User-Agent': UA, 'Accept': 'application/json, text/plain, */*'}; h.update(extra or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        b = r.read()
        if r.headers.get('Content-Encoding') == 'gzip': b = gzip.decompress(b)
        return r.status, b
def show(tag, fn):
    t = time.time()
    try:
        out = fn(); print(f'OK {tag} ({time.time()-t:.1f}s):', out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)[:1800])
    except Exception as e:
        print(f'FAIL {tag} ({time.time()-t:.1f}s): {e!r}'[:300])
    sys.stdout.flush()
# ---- Yahoo fundamentals-timeseries（公開端點）----
TYPES = ['annualTotalRevenue', 'annualCostOfRevenue', 'annualGrossProfit', 'annualOperatingIncome', 'annualNetIncome', 'annualEBITDA', 'annualResearchAndDevelopment', 'annualDilutedEPS', 'annualDilutedAverageShares',
         'annualTotalAssets', 'annualStockholdersEquity', 'annualTotalDebt', 'annualCashAndCashEquivalents', 'annualCurrentAssets', 'annualCurrentLiabilities', 'annualInventory', 'annualAccountsReceivable', 'annualInvestedCapital',
         'annualOperatingCashFlow', 'annualCapitalExpenditure', 'annualFreeCashFlow', 'annualRepurchaseOfCapitalStock', 'annualCashDividendsPaid', 'annualInterestExpense', 'annualTaxProvision', 'annualPretaxIncome',
         'quarterlyTotalRevenue', 'quarterlyGrossProfit', 'quarterlyNetIncome']
def yts(sym):
    now = int(time.time())
    s, b = get(f'https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{sym}?symbol={sym}&type={",".join(TYPES)}&period1=1420070400&period2={now}'); j = json.loads(b)
    out = {}
    for r in j['timeseries']['result']:
        t = r['meta']['type'][0]; v = r.get(t) or []
        out[t] = [(x['asOfDate'], x['reportedValue']['raw']) for x in v if x and x.get('reportedValue')][-5:]
    return out
show('Yahoo timeseries NVDA', lambda: yts('NVDA'))
show('Yahoo timeseries 2330.TW', lambda: yts('2330.TW'))
# ---- Nasdaq（公開 API）----
NH = {'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
def nq(path):
    s, b = get('https://api.nasdaq.com' + path, NH); return json.loads(b)
show('Nasdaq holders (誠實 UA)', lambda: list((nq('/api/company/NVDA/institutional-holdings?limit=10&type=TOTAL&sortColumn=marketValue&sortOrder=DESC').get('data') or {}).keys()))
show('Nasdaq financials', lambda: {k: (json.dumps(v, ensure_ascii=False)[:600] if v else v) for k, v in (nq('/api/company/NVDA/financials?frequency=1').get('data') or {}).items()})
# ---- 集保：看格式 ----
def tdcc():
    s, b = get('https://opendata.tdcc.com.tw/getOD.ashx?id=1-5', timeout=120)
    t = b.decode('utf-8-sig', 'replace').splitlines()
    return {'first': t[:3], 'match2330': [l for l in t if '2330' in l][:17]}
show('TDCC 1-5', tdcc)
# ---- 證交所 OpenAPI：董監／股東相關資料集 ----
def twse_paths():
    s, b = get('https://openapi.twse.com.tw/v1/swagger.json'); j = json.loads(b)
    return [(p, (d.get('summary') or '')[:40]) for p, v in j.get('paths', {}).items() for m, d in v.items() if re.search('董事|監察人|大股東|持股|股權|股東|營業收入', (d.get('summary') or '') + (d.get('description') or ''))]
show('TWSE 董監股東資料集', twse_paths)
def twse_ds(path):
    s, b = get('https://openapi.twse.com.tw/v1' + path, timeout=120); j = json.loads(b)
    rows = [r for r in j if '2330' in json.dumps(r, ensure_ascii=False)]
    return {'n': len(j), 'keys': list(j[0].keys()) if j else [], 'r2330': rows[:2]}
for p in ['/opendata/t187ap46_L_18', '/opendata/t187ap06_L_ci', '/opendata/t187ap05_L']:
    show('TWSE ' + p, lambda p=p: twse_ds(p))
