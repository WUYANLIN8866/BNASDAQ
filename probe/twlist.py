"""暫時：列出證交所 OpenAPI 全部資料集，抽樣 ESG、內部人、外資、股利、庫藏股、法說會等（台積電那幾列）。"""
import json, re, urllib.request, os
UA = 'BNASDAQ company fetch (+https://github.com/WUYANLIN8866/BNASDAQ)'
def get(u, t=120):
    req = urllib.request.Request(u, headers={'User-Agent': UA, 'Accept': 'application/json'})
    return urllib.request.urlopen(req, timeout=t).read()
os.makedirs('out', exist_ok=True)
sw = json.loads(get('https://openapi.twse.com.tw/v1/swagger.json'))
rows = []
for p, v in (sw.get('paths') or {}).items():
    for meth, op in v.items():
        rows.append([p, op.get('summary') or op.get('description') or '', ','.join(op.get('tags') or [])])
print('資料集', len(rows))
pat = r'ESG|永續|內部人|外資|陸資|法人|持股|股東|董事|治理|溫室|能源|水資源|廢棄|人力|供應|資安|產品|客戶|法說|股利|分派|除權|庫藏|買回|背書|資金貸|轉讓|質押|設質|員工|薪|檢舉|功能性|會計師|處置|注意|變更'
want = [r for r in rows if re.search(pat, r[1] + r[2])]
print('抽樣', len(want))
samp = {}
for p, s, t in want:
    try:
        j = json.loads(get('https://openapi.twse.com.tw/v1' + p))
        lst = j if isinstance(j, list) else [j]
        ts = [r for r in lst if isinstance(r, dict) and any(str(v).strip() == '2330' for v in r.values())]
        samp[p] = {'s': s, 'n': len(lst), 'keys': list(lst[0].keys()) if lst and isinstance(lst[0], dict) else None, 'first': lst[0] if lst else None, 'tsmc': ts[:3]}
    except Exception as e:
        samp[p] = {'s': s, 'err': repr(e)[:200]}
json.dump({'paths': rows, 'samples': samp}, open('out/twlist.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for p, s, t in rows:
    print(p, '|', s)
