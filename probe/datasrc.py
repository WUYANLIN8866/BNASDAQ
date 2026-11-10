"""探測 4（暫時）：證交所 OpenAPI 的三大法人、融資融券、公司基本資料、重大訊息、內部人持股轉讓資料集。公開資料、單一 UA。"""
import json, re, sys, time, urllib.request
UA = 'BNASDAQ company fetch (+https://github.com/WUYANLIN8866/BNASDAQ)'
def get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'}), timeout=timeout) as r: return r.read()
def show(tag, fn):
    try: out = fn(); print('OK', tag, json.dumps(out, ensure_ascii=False)[:1600], flush=True)
    except Exception as e: print('FAIL', tag, repr(e)[:200], flush=True)
sw = json.loads(get('https://openapi.twse.com.tw/v1/swagger.json'))
paths = [(p, (d.get('summary') or '')[:50]) for p, v in sw.get('paths', {}).items() for m, d in v.items() if re.search('法人|外資|投信|自營|融資|融券|基本資料|重大訊息|轉讓|庫藏', (d.get('summary') or '') + (d.get('description') or ''))]
print('PATHS', json.dumps(paths, ensure_ascii=False))
for p, _ in paths[:14]:
    def f(p=p):
        j = json.loads(get('https://openapi.twse.com.tw/v1' + p)); rows = j if isinstance(j, list) else []
        hit = [r for r in rows if '2330' in json.dumps(r, ensure_ascii=False)][:2]
        return {'n': len(rows), 'keys': list(rows[0].keys()) if rows else None, 'r2330': hit}
    show(p, f)
