"""暫時用：第 5 輪——台股投信細節"""
import urllib.request, urllib.error, urllib.parse, re, json, sys, http.cookiejar, subprocess, os, tempfile
sys.stdout.reconfigure(line_buffering=True)
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
cj = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def get(url, method='GET', data=None, headers=None):
    h = {'User-Agent': BROWSER, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9'}; h.update(headers or {})
    with OP.open(urllib.request.Request(url, method=method, data=data, headers=h), timeout=60) as r:
        return r.status, r.headers.get('Content-Type', ''), r.read()


def fetch(name, url, **kw):
    print('\n======', name, '|', url[:200])
    try:
        st, ct, b = get(url, **kw); print('status', st, '| type', ct, '| length', len(b)); return b.decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, re.sub(r'\s+', ' ', (e.read(300) or b'').decode('utf-8', 'replace'))[:300])
    except Exception as e:
        print('ERR', repr(e)[:300])
    return None


def plain(h):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', ' ', h, flags=re.S)))


# 元大：用 Node 執行 __NUXT__ 取出完整持股
t = fetch('元大 0050 ratio', 'https://www.yuantaetfs.com/product/detail/0050/ratio')
if t:
    m = re.search(r'<script>(window\.__NUXT__=.*?)</script>', t, re.S)
    print('nuxt script', len(m.group(1)) if m else None)
    if m:
        f = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8')
        f.write('const window={};' + m.group(1) + '\nconst seen=new Set();function walk(o,p,d){if(!o||typeof o!=="object"||d>9||seen.has(o))return;seen.add(o);if(Array.isArray(o)&&o.length>=20&&o[0]&&typeof o[0]==="object"){const k=Object.keys(o[0]);console.log("ARRAY",p,o.length,JSON.stringify(k).slice(0,200),JSON.stringify(o[0]).slice(0,300));}for(const k in o)walk(o[k],p+"."+k,d+1);}walk(window.__NUXT__,"N",0);')
        f.close(); r = subprocess.run(['node', f.name], capture_output=True, text=True, timeout=60); print(r.stdout[:3000], r.stderr[:500])
# 富邦：stkId 參數，列出表頭附近
t = fetch('富邦 006208', 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx?stkId=006208')
if t:
    p = plain(t); i = p.find('每受益權單位淨資產價值'); print('…', p[i:i + 1500])
    print('tables', len(re.findall(r'<table', t)), 'th', re.findall(r'<th[^>]*>([^<]{1,20})</th>', t)[:20])
t = fetch('富邦 00662', 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx?stkId=00662')
if t:
    p = plain(t); i = p.find('上一個月之受益人人數'); print('…', p[i:i + 900])
# 永豐
t = fetch('永豐 00888', 'https://sitc.sinopac.com/SinopacEtfs/Etfs/Pcf/00888')
if t:
    p = plain(t); i = p.find('資料日期'); print('…', p[i:i + 1500]); print('th', re.findall(r'<th[^>]*>\s*([^<]{1,20})\s*</th>', t)[:20])
# 國泰：API 參數
t = fetch('國泰 main.js', 'https://www.cathaysite.com.tw/main.bfc4bcc4530458b1ddfa.js')
if t:
    for w in ('GetStocksList', 'GetBuySale"', 'GetBuySale', 'GetETFData', 'apiUrl', 'baseUrl', 'environment'):
        for mm in list(re.finditer(re.escape(w), t))[:2]:
            print(w, '…', re.sub(r'\s+', ' ', t[max(0, mm.start() - 300):mm.start() + 400]))
# 群益 00919：頁面中是否有持股
t = fetch('群益 00919 portfolio', 'https://www.capitalfund.com.tw/etf/product/detail/00919/portfolio')
if t:
    print('台積電', t.count('台積電'), '聯發科', t.count('聯發科'), '長榮', t.count('長榮'))
    print('scripts', re.findall(r'<script[^>]+src="([^"]+)"', t)[:15])
    for w in ('/CFWeb/api', 'api/', 'axios', 'fetch('):
        i = t.find(w); print(w, '…', re.sub(r'\s+', ' ', t[max(0, i - 150):i + 250]) if i >= 0 else '無')
# iShares：網址中的名稱可否省略
for u in ['https://www.ishares.com/us/products/239710/x/latest-holdings.csv', 'https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/latest-holdings.csv']:
    t = fetch('iShares IWM', u)
    if t: print(t[:300])
