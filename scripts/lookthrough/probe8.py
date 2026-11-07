"""暫時用：第 8 輪——JPMorgan、Invesco CUSIP、TWSE e添富、富邦／統一／中信／野村／大華／凱基／台新 端點探測"""
import urllib.request, urllib.error, urllib.parse, re, json, sys, http.cookiejar, io
sys.stdout.reconfigure(line_buffering=True)
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
cj = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def get(url, method='GET', data=None, headers=None):
    h = {'User-Agent': BROWSER, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, method=method, data=data, headers=h), timeout=45) as r:
        return r.status, r.headers.get('Content-Type', ''), r.read()
def fetch(name, url, show=0, **kw):
    print('\n======', name, '|', url[:180])
    try:
        st, ct, b = get(url, **kw); print('status', st, '|', ct, '|', len(b))
        if show: print(repr(b[:show])[:show + 40])
        return b
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, re.sub(r'\s+', ' ', (e.read(200) or b'').decode('utf-8', 'replace'))[:200])
    except Exception as e:
        print('ERR', repr(e)[:200])
    return None
def plain(h):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', ' ', h, flags=re.S)))
PAT = re.compile(r'''["'`]((?:https?://[^"'`\s]{3,120})?/?[A-Za-z0-9_./-]{0,80}(?:api|Api|API|ajax|Ajax|asmx|ashx|Pcf|PCF|pcf|Hold|hold|Stock|Portfolio|portfolio|Basket|basket)[A-Za-z0-9_./?=&{}-]{0,80})["'`]''')
def discover(name, url, words=('成分', '持股', '權重', '台積電')):
    b = fetch(name, url)
    if not b: return
    t = b.decode('utf-8', 'replace'); p = plain(t)
    print('words', {w: t.count(w) for w in words})
    srcs = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', t); print('scripts', srcs[:12])
    hits = sorted(set(m.group(1) for m in PAT.finditer(t)))[:40]; print('inline api-ish', hits)
    base = urllib.parse.urlsplit(url)
    for s in srcs:
        full = urllib.parse.urljoin(url, s); sp = urllib.parse.urlsplit(full)
        if sp.netloc != base.netloc or re.search(r'jquery|bootstrap|gtag|polyfill|vendor|chunk-vendors|runtime', s): continue
        jb = fetch(' js', full)
        if not jb: continue
        js = jb.decode('utf-8', 'replace')
        hs = sorted(set(m.group(1) for m in PAT.finditer(js)))
        print('  js api-ish', len(hs), hs[:60])
# 1) JPMorgan 每日持股 Excel（JEPI、JEPQ）
for c, cus in (('JEPI', '46641Q332'), ('JEPQ', '46654Q203')):
    b = fetch('JPM ' + c, 'https://am.jpmorgan.com/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=%s&country=us&role=adv&locale=en-US' % cus, show=120)
    if b and b[:2] == b'PK':
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(b), read_only=True); ws = wb.active
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i < 12: print('  row', i, [x for x in row if x is not None][:10])
            else: break
# 2) Invesco 用 CUSIP（RSP 46137V357、QQQM 46138G649）
for t, cus in (('RSP', '46137V357'), ('QQQM', '46138G649')):
    for q in ('idType=cusip&interval=monthly&productType=ETF', 'idType=cusip&productType=ETF', 'idType=cusip'):
        fetch('Invesco ' + t + ' ' + q, 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/%s/holdings/fund?%s' % (cus, q), show=200)
# 3) TWSE e添富
discover('TWSE e添富 00939', 'https://www.twse.com.tw/zh/ETFortune/etfInfo/00939')
# 4) 富邦 PCF 頁的 AJAX
b = fetch('富邦 00900', 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx?stkId=00900')
if b:
    t = b.decode('utf-8', 'replace')
    for w in ('$.ajax', 'ajax(', '.asmx', '.ashx', 'WebMethod', 'url:', 'GetPcf', 'Pcf'):
        for mm in list(re.finditer(re.escape(w), t))[:3]: print(w, '…', re.sub(r'\s+', ' ', t[max(0, mm.start() - 160):mm.start() + 260]))
    print('scripts', re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', t)[:15])
# 5) 其他投信 ETF 頁
discover('統一 00981A', 'https://www.ezmoney.com.tw/ETF/Fund/Info?FundCode=49YTW')
discover('統一 ETF 首頁', 'https://www.ezmoney.com.tw/ETF/')
discover('中信 00934', 'https://www.ctbcinvestments.com/Etf/00934/Combination')
discover('野村 00980A', 'https://www.nomurafunds.com.tw/ETFWEB/product-description?fundNo=00980A&tab=Shareholding')
discover('大華 00918', 'https://www.dwsit.com.tw/ETF/product/00918')
discover('凱基 00915', 'https://www.kgifund.com.tw/Fund/Detail?fundID=J013')
discover('台新 00936', 'https://www.tsit.com.tw/ETF/Home/ETFSeriesDetail/00936')
