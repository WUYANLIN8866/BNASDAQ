"""暫時用：從 GitHub Actions 測試「投資組合透視」資料來源——第 3 輪"""
import urllib.request, urllib.error, urllib.parse, re, json, sys, http.cookiejar
sys.stdout.reconfigure(line_buffering=True)
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
cj = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def get(url, ua=BROWSER, method='GET', data=None, headers=None, limit=12_000_000):
    h = {'User-Agent': ua, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}; h.update(headers or {})
    req = urllib.request.Request(url, method=method, data=data, headers=h)
    with OP.open(req, timeout=60) as r:
        return r.status, r.headers.get('Content-Type', ''), (b'' if method == 'HEAD' else r.read(limit)), r.headers.get('Content-Length')


def fetch(name, url, **kw):
    print('\n======', name, '|', url[:200])
    try:
        st, ct, body, cl = get(url, **kw); print('status', st, '| type', ct, '| length', cl or len(body)); return ct, body
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.reason, '|', re.sub(r'\s+', ' ', (e.read(400) or b'').decode('utf-8', 'replace'))[:300])
    except Exception as e:
        print('ERR', repr(e)[:300])
    return None, None


def around(text, word, n=3, span=300):
    out, i = [], 0
    while len(out) < n:
        j = text.find(word, i)
        if j < 0: break
        out.append(re.sub(r'\s+', ' ', text[max(0, j - span):j + span])); i = j + len(word)
    return out


def plain(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', ' ', html, flags=re.S)))


# ---- SEC 重試 ----
for ua in ['BNASDAQ Research bnasdaq-bot@users.noreply.github.com', 'Mozilla/5.0 (compatible; BNASDAQ/1.0; +https://github.com/WUYANLIN8866/BNASDAQ) contact bnasdaq-bot@users.noreply.github.com']:
    fetch('SEC 代號對照 UA=' + ua[:30], 'https://www.sec.gov/files/company_tickers_mf.json', ua=ua, headers={'Accept-Encoding': 'identity', 'Host': 'www.sec.gov'})
ct, b = fetch('SEC data.sec.gov submissions（Invesco QQQ Trust）', 'https://data.sec.gov/submissions/CIK0001067839.json', ua='BNASDAQ Research bnasdaq-bot@users.noreply.github.com')
if b: print(b[:300])
# ---- 美股清單與持股 ----
ct, b = fetch('Nasdaq ETF 篩選', 'https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=25&download=true', headers={'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'})
if b:
    try:
        j = json.loads(b); d = j.get('data') or {}; rows = (d.get('rows') or (d.get('data') or {}).get('rows') or []); print('keys', list(d)[:8], 'rows', len(rows)); print('sample', rows[:2])
    except Exception as e: print('parse', repr(e)[:200], b[:300])
ct, b = fetch('Vanguard VOO 持股 JSON', 'https://investor.vanguard.com/vmf/api/VOO/portfolio-holding/stock.json')
if b: print(b[:700])
for nm, u in [('Invesco API a', 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQ/holdings/fund?idType=ticker&interval=monthly&productType=ETF'),
              ('Invesco 下載 b', 'https://www.invesco.com/us/financial-products/etfs/holdings/main/holdings/0?audienceType=Investor&action=download&ticker=QQQ')]:
    ct, b = fetch(nm, u)
    if b: print(b[:600])
ct, b = fetch('Invesco QQQ 產品頁', 'https://www.invesco.com/qqq-etf/en/home.html')
if b:
    t = b.decode('utf-8', 'replace'); print(sorted(set(re.findall(r'https?://[^"\'\s<>]{0,160}(?:holding|Holding|api)[^"\'\s<>]{0,120}', t)))[:20])
ct, b = fetch('iShares IVV 產品頁', 'https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf')
if b:
    t = b.decode('utf-8', 'replace')
    for s in sorted(set(re.findall(r'[^"\'\s<>]{0,160}(?:\.csv|ajax\?fileType|fileType=csv)[^"\'\s<>]{0,160}', t)))[:12]: print('csv-link', s)
ct, b = fetch('VanEck SMH 持股頁', 'https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/holdings/')
if b:
    t = b.decode('utf-8', 'replace'); print(sorted(set(re.findall(r'[^"\'\s<>]{0,160}(?:xlsx|download|Download)[^"\'\s<>]{0,120}', t)))[:15]); print('NVDA', t.count('NVDA'), 'TSM', t.count('TSM'))
ct, b = fetch('Schwab SCHD 全持股', 'https://www.schwabassetmanagement.com/allholdings/SCHD')
if b: print(plain(b.decode('utf-8', 'replace'))[:600])
# ---- 台股 ----
ct, b = fetch('TWSE e添富 00919', 'https://www.twse.com.tw/zh/ETFortune/etfInfo/00919')
if b:
    t = b.decode('utf-8', 'replace'); print('scripts', re.findall(r'<script[^>]+src="([^"]+)"', t)[:15]); print('api-ish', sorted(set(re.findall(r'["\'](/[^"\'\s<>]{0,120}(?:rwd|api|ETFortune|json)[^"\'\s<>]{0,80})["\']', t)))[:30]); print('text', plain(t)[:1200])
ct, b = fetch('國泰 PCF 頁', 'https://www.cathaysite.com.tw/ETF/purchase')
if b:
    t = b.decode('utf-8', 'replace'); js = [s for s in re.findall(r'src="([^"]+\.js)"', t) if 'main' in s]; print('main js', js)
    for s in js[:1]:
        ct2, b2 = fetch('國泰 main.js', urllib.parse.urljoin('https://www.cathaysite.com.tw/ETF/', s))
        if b2:
            t2 = b2.decode('utf-8', 'replace'); print(sorted(set(re.findall(r'["\'`]([^"\'`\s]{0,100}(?:api|Api|API)[^"\'`\s]{0,100})["\'`]', t2)))[:60])
# 富邦：ASP.NET postback 查 006208
ct, b = fetch('富邦 PCF 首頁', 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx')
if b:
    t = b.decode('utf-8', 'replace'); hid = dict(re.findall(r'<input[^>]+name="(__[A-Z]+)"[^>]+value="([^"]*)"', t)); print('hidden', {k: len(v) for k, v in hid.items()})
    print('stock options sample', re.findall(r'(?:data-stkid|data-id|value)="(00[0-9A-Z]{2,4}[A-Z]?)"', t)[:30])
    print('around hidStkId', around(t, 'hidStkId', 2, 250))
# 永豐：資料下載
ct, b = fetch('永豐 PCF', 'https://sitc.sinopac.com/SinopacEtfs/Etfs/Pcf')
if b:
    t = b.decode('utf-8', 'replace'); print('around 資料下載', around(t, '資料下載', 2, 400)); print('fundId options', re.findall(r'<option[^>]+value="([^"]+)"[^>]*>([^<]+)</option>', t)[:20])
