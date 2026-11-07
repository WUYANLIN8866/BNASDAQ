"""暫時用：從 GitHub Actions 測試「投資組合透視」資料來源能否抓到（只印摘要，不寫檔）——第 2 輪"""
import urllib.request, urllib.error, re, json, io, sys
sys.stdout.reconfigure(line_buffering=True)
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
SEC_UA = 'BNASDAQ research site bnasdaq-bot@users.noreply.github.com'


def get(url, ua=BROWSER, method='GET', limit=12_000_000, headers=None):
    h = {'User-Agent': ua, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}
    h.update(headers or {})
    req = urllib.request.Request(url, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.headers.get('Content-Type', ''), r.headers.get('Content-Length'), (b'' if method == 'HEAD' else r.read(limit))


def fetch(name, url, **kw):
    print('\n======', name, '|', url)
    try:
        st, ct, cl, body = get(url, **kw)
        print('status', st, '| type', ct, '| length', cl or len(body)); return ct, body
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.reason, '|', (e.read(300) or b'').decode('utf-8', 'replace').replace('\n', ' ')[:300])
    except Exception as e:
        print('ERR', repr(e)[:300])
    return None, None


def around(text, word, n=3, span=350):
    out, i = [], 0
    for _ in range(n):
        j = text.find(word, i)
        if j < 0: break
        out.append(re.sub(r'\s+', ' ', text[max(0, j - span):j + span])); i = j + len(word)
    return out


def plain(html):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', html, flags=re.S)
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t))


# ---- 美股：SEC 加上 email 格式 User-Agent ----
ct, b = fetch('SEC 基金代號對照', 'https://www.sec.gov/files/company_tickers_mf.json', ua=SEC_UA)
if b:
    j = json.loads(b); print('fields', j.get('fields'), '| rows', len(j.get('data', []))); print('sample', [r for r in j['data'] if r[3] in ('QQQ', 'SPY', 'VOO', 'QLD', 'SOXX', 'SHV')])
fetch('SEC N-PORT 2026Q3', 'https://www.sec.gov/files/dera/data/form-n-port-data-sets/2026q3_nport.zip', ua=SEC_UA, method='HEAD')
ct, b = fetch('Nasdaq 股票篩選（全部股票＋產業）', 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&download=true', headers={'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'})
if b:
    try:
        j = json.loads(b); rows = (j.get('data') or {}).get('rows') or []; print('rows', len(rows)); print('sample', rows[:2])
    except Exception as e: print('parse', repr(e)[:200], b[:300])
# ---- 台股 ----
ct, b = fetch('TWSE 宅在家學習網 ETF 查詢管道（全文）', 'https://shl.twse.com.tw/newsArticle/detail/8a8221129265cb8b0194ca8033dd0046?type=HotKnowledge')
if b: print(plain(b.decode('utf-8', 'replace'))[:7000])
ct, b = fetch('元大 0050 持股權重頁', 'https://www.yuantaetfs.com/product/detail/0050/ratio')
if b:
    t = b.decode('utf-8', 'replace'); print('台積電 出現次數', t.count('台積電'), '| __NUXT__', t.find('__NUXT__'))
    for s in around(t, '台積電', 2): print('...', s)
    for s in around(t, 'api', 6, 120): print('api…', s)
ct, b = fetch('富邦 PCF 頁', 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx')
if b:
    t = b.decode('utf-8', 'replace'); print('forms', sorted(set(re.findall(r'name="([^"]{1,60})"', t)))[:40])
    print('text', plain(t)[:2500])
for name, url in [('永豐 PCF', 'https://sitc.sinopac.com/SinopacEtfs/Etfs/Pcf'), ('玉山 PCF', 'https://www.esunam.com/ETF/etf-pcf'), ('投信投顧公會 明細資料', 'https://www.sitca.org.tw/ROC/Industry/IN2002.aspx?PGMID=IN0202')]:
    ct, b = fetch(name, url)
    if b:
        t = b.decode('utf-8', 'replace'); print('forms', sorted(set(re.findall(r'name="([^"]{1,60})"', t)))[:30]); print('text', plain(t)[:1500])
