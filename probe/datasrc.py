"""資料來源可行性探測（暫時）：SEC、Nasdaq、證交所 OpenAPI、集保。只印出結構與少量樣本。"""
import json, re, sys, time, urllib.request, gzip, io, zipfile
UA_SEC = 'BNASDAQ research (https://github.com/WUYANLIN8866/BNASDAQ) bnasdaq-research@users.noreply.github.com'
UA_WEB = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
def get(url, ua=UA_WEB, extra=None, timeout=60):
    h = {'User-Agent': ua, 'Accept': 'application/json, text/plain, */*', 'Accept-Encoding': 'gzip'}
    h.update(extra or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        b = r.read()
        if r.headers.get('Content-Encoding') == 'gzip': b = gzip.decompress(b)
        return r.status, b
def show(tag, fn):
    t = time.time()
    try:
        out = fn(); print(f'OK {tag} ({time.time()-t:.1f}s):', out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)[:1500])
    except Exception as e:
        print(f'FAIL {tag} ({time.time()-t:.1f}s): {e!r}'[:400])
    sys.stdout.flush()

# ---------------- SEC ----------------
def sec_tickers():
    s, b = get('https://www.sec.gov/files/company_tickers.json', UA_SEC); j = json.loads(b)
    m = {v['ticker']: v['cik_str'] for v in j.values()}
    return {'n': len(m), 'NVDA': m.get('NVDA'), 'BRK-B': m.get('BRK-B'), 'GOOGL': m.get('GOOGL'), 'TSM': m.get('TSM')}
show('SEC tickers', sec_tickers)
def sec_facts():
    s, b = get('https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json', UA_SEC); j = json.loads(b)
    g = j['facts'].get('us-gaap', {})
    keys = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'GrossProfit', 'CostOfRevenue', 'OperatingIncomeLoss', 'NetIncomeLoss', 'ResearchAndDevelopmentExpense',
            'Assets', 'StockholdersEquity', 'LongTermDebt', 'LongTermDebtNoncurrent', 'CashAndCashEquivalentsAtCarryingValue', 'NetCashProvidedByUsedInOperatingActivities',
            'PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsForRepurchaseOfCommonStock', 'PaymentsOfDividends', 'InventoryNet', 'AccountsReceivableNetCurrent', 'AssetsCurrent', 'LiabilitiesCurrent', 'InterestExpense', 'IncomeTaxExpenseBenefit', 'ShareBasedCompensation', 'WeightedAverageNumberOfDilutedSharesOutstanding']
    out = {'size_kb': len(b) // 1024, 'n_concepts': len(g), 'dei': list(j['facts'].get('dei', {}).keys())[:6]}
    for k in keys:
        if k in g:
            u = list(g[k]['units'].values())[0]
            fy = [x for x in u if x.get('form') == '10-K' and x.get('fp') == 'FY' and (x.get('frame') or '').startswith('CY') and len(x.get('frame', '')) == 6]
            out[k] = [(x['frame'], x['val']) for x in fy][-4:]
        else:
            out[k] = 'MISSING'
    return out
show('SEC companyfacts NVDA', sec_facts)
def sec_segments():
    s, b = get('https://data.sec.gov/submissions/CIK0001045810.json', UA_SEC); j = json.loads(b)
    r = j['filings']['recent']; i = r['form'].index('10-K'); acc = r['accessionNumber'][i]; doc = r['primaryDocument'][i]
    base = f'https://www.sec.gov/Archives/edgar/data/1045810/{acc.replace("-", "")}/'
    s, b = get(base + 'index.json', UA_SEC); idx = json.loads(b)
    files = [f['name'] for f in idx['directory']['item']]
    inst = [f for f in files if f.endswith('_htm.xml')]
    out = {'acc': acc, 'doc': doc, 'period': r['reportDate'][i], 'files': [f for f in files if f.endswith(('.xml', '.json', '.xsd'))][:12], 'inst': inst}
    if inst:
        s, b = get(base + inst[0], UA_SEC); x = b.decode('utf-8', 'replace'); out['inst_kb'] = len(b) // 1024
        # contexts with explicit members
        ctx = {}
        for m in re.finditer(r'<xbrli:context id="([^"]+)">(.*?)</xbrli:context>', x, re.S):
            cid, body = m.group(1), m.group(2)
            dims = re.findall(r'<xbrldi:explicitMember dimension="([^"]+)">([^<]+)</xbrldi:explicitMember>', body)
            per = re.findall(r'<xbrli:(?:startDate|endDate|instant)>([^<]+)<', body)
            ctx[cid] = (dims, per)
        rev = []
        for m in re.finditer(r'<us-gaap:(RevenueFromContractWithCustomerExcludingAssessedTax|Revenues)\b[^>]*contextRef="([^"]+)"[^>]*>([^<]+)<', x):
            dims, per = ctx.get(m.group(2), ([], []))
            if len(dims) == 1: rev.append((dims[0][0].split(':')[-1], dims[0][1].split(':')[-1], per, m.group(3)))
        out['seg_rev'] = rev[:40]
    return out
show('SEC 10-K segments NVDA', sec_segments)

# ---------------- Nasdaq ----------------
NH = {'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
def nq(path):
    s, b = get('https://api.nasdaq.com' + path, UA_WEB, NH); j = json.loads(b); return j
show('Nasdaq inst holders', lambda: (lambda j: {'keys': list((j.get('data') or {}).keys()), 'summary': (j['data'] or {}).get('ownershipSummary'), 'rows': ((j['data'].get('holdingsTransactions') or {}).get('table') or {}).get('rows', [])[:10], 'headers': ((j['data'].get('holdingsTransactions') or {}).get('table') or {}).get('headers')})(nq('/api/company/NVDA/institutional-holdings?limit=10&type=TOTAL&sortColumn=marketValue&sortOrder=DESC')))
show('Nasdaq insider', lambda: (lambda j: {'keys': list((j.get('data') or {}).keys()), 'sample': json.dumps(j.get('data'), ensure_ascii=False)[:700]})(nq('/api/company/NVDA/insider-trades?limit=5&type=ALL&sortColumn=lastDate&sortOrder=DESC')))
show('Nasdaq profile', lambda: (lambda j: {'keys': list((j.get('data') or {}).keys()), 'sample': json.dumps(j.get('data'), ensure_ascii=False)[:900]})(nq('/api/company/NVDA/company-profile')))
show('Nasdaq target', lambda: json.dumps(nq('/api/analyst/NVDA/targetprice').get('data'), ensure_ascii=False)[:800])
show('Nasdaq ratings', lambda: json.dumps(nq('/api/analyst/NVDA/ratings').get('data'), ensure_ascii=False)[:800])
show('Nasdaq earnings forecast', lambda: json.dumps(nq('/api/analyst/NVDA/earnings-forecast').get('data'), ensure_ascii=False)[:900])
show('Nasdaq summary', lambda: json.dumps(nq('/api/quote/NVDA/summary?assetclass=stocks').get('data'), ensure_ascii=False)[:1200])
show('Nasdaq short interest', lambda: json.dumps(nq('/api/quote/NVDA/short-interest?assetClass=stocks').get('data'), ensure_ascii=False)[:500])
show('Nasdaq earnings surprise', lambda: json.dumps(nq('/api/company/NVDA/earnings-surprise').get('data'), ensure_ascii=False)[:600])

# ---------------- 證交所 OpenAPI ----------------
def twse_paths():
    s, b = get('https://openapi.twse.com.tw/v1/swagger.json'); j = json.loads(b)
    out = []
    for p, v in j.get('paths', {}).items():
        for m, d in v.items():
            sm = (d.get('summary') or '') + ' ' + (d.get('description') or '')
            if re.search('董|監|持股|股東|營收|損益|資產負債|現金流|外資|投信|自營|股利|財務|產品', sm): out.append((p, sm.strip()[:60]))
    return out
show('TWSE swagger', twse_paths)
# ---------------- 集保 ----------------
def tdcc():
    s, b = get('https://opendata.tdcc.com.tw/getOD.ashx?id=1-5', UA_WEB, timeout=120)
    t = b.decode('utf-8-sig', 'replace').splitlines()
    rows = [l for l in t if ',2330,' in l]
    return {'n_lines': len(t), 'header': t[0][:200], 'rows2330': rows[:17]}
show('TDCC 1-5', tdcc)
