"""暫時用：從 GitHub Actions 測試「投資組合透視」資料來源——第 4 輪（確認格式）"""
import urllib.request, urllib.error, urllib.parse, re, json, io, sys, http.cookiejar
sys.stdout.reconfigure(line_buffering=True)
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
cj = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def get(url, method='GET', data=None, headers=None, limit=20_000_000):
    h = {'User-Agent': BROWSER, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, method=method, data=data, headers=h), timeout=60) as r:
        return r.status, r.headers.get('Content-Type', ''), r.read(limit)


def fetch(name, url, **kw):
    print('\n======', name, '|', url[:200])
    try:
        st, ct, body = get(url, **kw); print('status', st, '| type', ct, '| length', len(body)); return ct, body
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.reason, '|', re.sub(r'\s+', ' ', (e.read(300) or b'').decode('utf-8', 'replace'))[:300])
    except Exception as e:
        print('ERR', repr(e)[:300])
    return None, None


def plain(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', ' ', html, flags=re.S)))


def xlsx_rows(b, n=14):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True)
    for ws in wb.worksheets[:2]:
        print('sheet', ws.title)
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i >= n: break
            print('  ', [c for c in row][:9])


ct, b = fetch('SSGA SPY xlsx', 'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx')
if b: xlsx_rows(b)
ct, b = fetch('iShares IVV latest-holdings.csv', 'https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv')
if b: print(b[:1200].decode('utf-8', 'replace'))
ct, b = fetch('iShares 產品清單', 'https://www.ishares.com/us/product-screener/product-screener-v3.1.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/us-ishares/ishares-product-screener-backend-config&siteEntryPassthrough=true')
if b:
    t = b.decode('utf-8', 'replace'); print(t[:800])
ct, b = fetch('VanEck SMH xlsx', 'https://www.vaneck.com/us/en/etf/equity/smh/holdings/download/xlsx/')
if b and b[:2] == b'PK': xlsx_rows(b)
elif b: print(b[:400])
ct, b = fetch('Vanguard VXUS（國際股）', 'https://investor.vanguard.com/vmf/api/VXUS/portfolio-holding/stock.json')
if b:
    j = json.loads(b); print('size', j.get('size'), 'asOf', j.get('asOfDate')); print([{k: e.get(k) for k in ('longName', 'ticker', 'isin', 'percentWeight')} for e in j['fund']['entity'][:3]])
ct, b = fetch('Invesco QQQM', 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQM/holdings/fund?idType=ticker&interval=monthly&productType=ETF')
if b: j = json.loads(b); print(j.get('effectiveDate'), j.get('totalNumberOfHoldings'), [h.get('ticker') for h in j['holdings'][:5]], 'sum%', round(sum(h.get('percentageOfTotalNetAssets') or 0 for h in j['holdings']), 3))
ct, b = fetch('國泰 main.js（根目錄）', 'https://www.cathaysite.com.tw/main.bfc4bcc4530458b1ddfa.js')
if b:
    t = b.decode('utf-8', 'replace'); print('len', len(t)); print(sorted(set(re.findall(r'["\'`]((?:https?:)?//[^"\'`\s]{0,80}|/api/[^"\'`\s]{0,100}|api/[^"\'`\s]{0,100})["\'`]', t)))[:80])
    for w in ('Pcf', 'pcf', 'Holding', 'Stock'):
        i = t.find(w); print(w, '…', re.sub(r'\s+', ' ', t[max(0, i - 200):i + 200]) if i >= 0 else '無')
# 富邦 postback：006208
ct, b = fetch('富邦 PCF 首頁', 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx')
if b:
    t = b.decode('utf-8', 'replace'); f = dict(re.findall(r'<input[^>]+name="([^"]+)"[^>]*value="([^"]*)"', t))
    f['ctl00$ctl00$mainContent$subMainContent$hidStkId'] = '006208'
    btn = 'ctl00$ctl00$mainContent$subMainContent$btnSearch'; f[btn] = f.get(btn, '查詢')
    print('sDate', f.get('ctl00$ctl00$mainContent$subMainContent$sDate'))
    ct2, b2 = fetch('富邦 PCF 006208（postback）', 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx', method='POST', data=urllib.parse.urlencode(f).encode(), headers={'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx'})
    if b2:
        p = plain(b2.decode('utf-8', 'replace')); i = p.find('股票代碼'); print(p[p.find('申購買回清單 選擇其他'):][:300]); print('…', p[i:i + 700])
    ct3, b3 = fetch('富邦 PCF 006208（網址參數）', 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx?stkId=006208')
    if b3:
        p = plain(b3.decode('utf-8', 'replace')); i = p.find('股票代碼'); print(p[p.find('申購買回清單 選擇其他'):][:200]); print('…', p[i:i + 400])
ct, b = fetch('永豐 PCF 00888', 'https://sitc.sinopac.com/SinopacEtfs/Etfs/Pcf/00888')
if b:
    p = plain(b.decode('utf-8', 'replace')); i = p.find('股票代號') if '股票代號' in p else p.find('代號'); print('…', p[i:i + 800])
for nm, u in [('群益 ETF 首頁', 'https://www.capitalfund.com.tw/etf'), ('群益 00919', 'https://www.capitalfund.com.tw/etf/product/detail/00919/portfolio'), ('復華 ETF 首頁', 'https://www.fhtrust.com.tw/ETF/'), ('中信 ETF 00882', 'https://www.ctbcinvestments.com/Etf/00882/Combination'), ('統一 ETF', 'https://www.ezmoney.com.tw/ETF/')]:
    ct, b = fetch(nm, u)
    if b:
        t = b.decode('utf-8', 'replace'); m = re.search(r'<title[^>]*>(.*?)</title>', t, re.S); print('title', (m.group(1).strip() if m else '')[:100])
        print('api-ish', sorted(set(re.findall(r'["\'`]([^"\'`\s<>]{0,100}(?:api|Api|API|ajax|Ajax|json)[^"\'`\s<>]{0,100})["\'`]', t)))[:25])
ct, b = fetch('元大 00646 持股（美股）', 'https://www.yuantaetfs.com/product/detail/00646/ratio')
if b:
    t = b.decode('utf-8', 'replace'); rows = re.findall(r'商品代碼</span> <span[^>]*>([^<]+)</span>.*?商品名稱</span> <span[^>]*>([^<]+)</span>.*?商品數量</span> <span[^>]*>([^<]+)</span>.*?商品權重</span> <span[^>]*>([^<]+)</span>', t, re.S)
    print('rows', len(rows), rows[:6], 'sum', round(sum(float(r[3]) for r in rows if re.match(r'^[\d.]+$', r[3])), 2))
