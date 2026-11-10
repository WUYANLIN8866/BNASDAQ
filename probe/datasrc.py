"""資料來源可行性探測 3（暫時）：台股股東資料、前 10 大股東 PDF、Yahoo 額外財報欄位。公開資料、單一誠實 UA。"""
import json, re, sys, time, urllib.request, gzip, io, subprocess
UA = 'BNASDAQ company fetch (+https://github.com/WUYANLIN8866/BNASDAQ)'
def get(url, extra=None, timeout=90):
    h = {'User-Agent': UA, 'Accept': '*/*'}; h.update(extra or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        b = r.read()
        if r.headers.get('Content-Encoding') == 'gzip': b = gzip.decompress(b)
        return r.status, b, r.headers.get('Content-Type')
def show(tag, fn):
    t = time.time()
    try:
        out = fn(); print(f'OK {tag} ({time.time()-t:.1f}s):', out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)[:2500])
    except Exception as e:
        print(f'FAIL {tag} ({time.time()-t:.1f}s): {e!r}'[:300])
    sys.stdout.flush()
def twse(path):
    s, b, ct = get('https://openapi.twse.com.tw/v1' + path, timeout=120); return json.loads(b)
show('t187ap02_L 大股東', lambda: (lambda j: {'n': len(j), 'keys': list(j[0].keys()), 'r2330': [r for r in j if r.get('公司代號') == '2330'][:5], 'r2317': [r for r in j if r.get('公司代號') == '2317'][:3]})(twse('/opendata/t187ap02_L')))
show('t187ap11_L 董監持股', lambda: (lambda j: {'n': len(j), 'keys': list(j[0].keys()), 'r2330': [r for r in j if r.get('公司代號') == '2330'][:4]})(twse('/opendata/t187ap11_L')))
show('MI_QFIIS_cat', lambda: json.dumps(twse('/fund/MI_QFIIS_cat')[:2], ensure_ascii=False))
def pdf10():
    j = twse('/opendata/t187ap46_L_18'); r = [x for x in j if x.get('公司代號') == '2330'][0]; u = r['前10大股東持股情形']
    s, b, ct = get(u, timeout=120)
    out = {'url': u, 'ct': ct, 'bytes': len(b), 'head': b[:8].decode('latin1')}
    if b[:4] == b'%PDF':
        open('/tmp/t.pdf', 'wb').write(b)
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'pypdf'], check=False)
        from pypdf import PdfReader
        rd = PdfReader('/tmp/t.pdf'); out['pages'] = len(rd.pages); out['text'] = '\n'.join((p.extract_text() or '') for p in rd.pages[:2])[:1800]
    else:
        out['body'] = b[:600].decode('utf-8', 'replace')
    return out
show('前10大股東 PDF 2330', pdf10)
TYPES = ['annualRetainedEarnings', 'annualTotalLiabilitiesNetMinorityInterest', 'annualWorkingCapital', 'annualEBIT', 'annualOrdinarySharesNumber', 'annualSellingGeneralAndAdministration', 'annualStockBasedCompensation', 'annualNetDebt', 'annualTangibleBookValue', 'annualGoodwill',
         'quarterlyOperatingIncome', 'quarterlyDilutedEPS', 'quarterlyFreeCashFlow', 'trailingTotalRevenue', 'trailingNetIncome', 'trailingFreeCashFlow', 'trailingEBITDA']
def yts(sym):
    s, b, ct = get(f'https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{sym}?symbol={sym}&type={",".join(TYPES)}&period1=1420070400&period2={int(time.time())}'); j = json.loads(b)
    return {r['meta']['type'][0]: [(x['asOfDate'], x['reportedValue']['raw']) for x in (r.get(r['meta']['type'][0]) or []) if x and x.get('reportedValue')][-3:] for r in j['timeseries']['result']}
show('Yahoo extra NVDA', lambda: yts('NVDA'))
show('Yahoo extra JPM', lambda: yts('JPM'))
show('Yahoo chart 1y NVDA', lambda: (lambda j: {'n': len(j['chart']['result'][0]['timestamp']), 'meta': {k: j['chart']['result'][0]['meta'].get(k) for k in ('fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'currency', 'longName')}})(json.loads(get('https://query2.finance.yahoo.com/v8/finance/chart/NVDA?range=1y&interval=1d')[1])))
