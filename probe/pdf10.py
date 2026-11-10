import json, re, urllib.request, base64
UA = 'BNASDAQ company fetch (+https://github.com/WUYANLIN8866/BNASDAQ)'
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=120) as r: return r.read()
j = json.loads(get('https://openapi.twse.com.tw/v1/opendata/t187ap46_L_18'))
links = {r['公司代號']: r['前10大股東持股情形'] for r in j}
for c in ['2330', '2317', '2454']:
    u = links.get(c); print('LINK', c, u)
    try:
        h = get(u).decode('big5', 'replace'); m = re.search(r"href='(/pdf/[^']+\.pdf)'", h)
        pdf = get('https://doc.twse.com.tw' + m.group(1)); print(f'PDF{c}:' + base64.b64encode(pdf).decode())
    except Exception as e:
        print('ERR', c, repr(e))
