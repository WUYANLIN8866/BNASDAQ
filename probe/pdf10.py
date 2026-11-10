import json, re, urllib.request, os
UA = 'BNASDAQ company fetch (+https://github.com/WUYANLIN8866/BNASDAQ)'
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=120) as r: return r.read()
j = json.loads(get('https://openapi.twse.com.tw/v1/opendata/t187ap46_L_18'))
links = {r['公司代號']: r['前10大股東持股情形'] for r in j}
os.makedirs('out', exist_ok=True)
for c in ['2330', '2317', '2454', '2881']:
    u = links.get(c); print('LINK', c, u, flush=True)
    try:
        h = get(u).decode('big5', 'replace'); m = re.search(r"href='(/pdf/[^']+\.pdf)'", h)
        pdf = get('https://doc.twse.com.tw' + m.group(1)); open(f'out/top10_{c}.pdf', 'wb').write(pdf); print('PDF', c, len(pdf), flush=True)
    except Exception as e:
        print('ERR', c, repr(e), flush=True)
