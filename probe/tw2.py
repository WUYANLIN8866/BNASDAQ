"""暫時：證交所個股本益比／殖利率／股價淨值比、營益分析的欄位與台積電那一列。"""
import json, urllib.request, os
UA = 'BNASDAQ company fetch (+https://github.com/WUYANLIN8866/BNASDAQ)'
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA, 'Accept': 'application/json'}), timeout=120).read()
os.makedirs('out', exist_ok=True)
res = {}
for p in ['/exchangeReport/BWIBBU_ALL', '/opendata/t187ap17_L', '/opendata/t187ap14_L', '/exchangeReport/STOCK_DAY_AVG_ALL']:
    try:
        j = json.loads(get('https://openapi.twse.com.tw/v1' + p)); lst = j if isinstance(j, list) else [j]
        res[p] = {'n': len(lst), 'keys': list(lst[0].keys()) if lst else None, 'tsmc': [r for r in lst if any(str(v).strip() == '2330' for v in r.values())][:2], 'first': lst[0] if lst else None}
    except Exception as e:
        res[p] = {'err': repr(e)[:200]}
print(json.dumps(res, ensure_ascii=False, indent=1)[:6000])
