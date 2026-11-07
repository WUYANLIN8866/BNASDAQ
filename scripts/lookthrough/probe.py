"""暫時用：從 GitHub Actions 測試「投資組合透視」資料來源能否抓到（只印摘要，不寫檔）"""
import urllib.request, urllib.error, re, json, io, sys, time
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
SEC_UA = 'BNASDAQ research site https://github.com/WUYANLIN8866/BNASDAQ'


def get(url, ua=BROWSER, method='GET', limit=8_000_000):
    req = urllib.request.Request(url, method=method, headers={'User-Agent': ua, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.status, r.headers.get('Content-Type', ''), r.headers.get('Content-Length'), (b'' if method == 'HEAD' else r.read(limit)), r.geturl()


def show(name, url, ua=BROWSER, method='GET'):
    print('\n======', name, '|', url, flush=True)
    try:
        st, ct, cl, body, final = get(url, ua, method)
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.reason); return None
    except Exception as e:
        print('ERR', repr(e)[:200]); return None
    print('status', st, '| type', ct, '| length', cl or len(body), '| final', final if final != url else '(same)')
    if method == 'HEAD':
        return None
    if 'pdf' in ct or body[:4] == b'%PDF':
        from pypdf import PdfReader
        txt = '\n'.join((p.extract_text() or '') for p in PdfReader(io.BytesIO(body)).pages)
        print('PDF pages text (first 6000 chars):\n' + txt[:6000]); return body
    if body[:2] == b'PK':
        print('ZIP/XLSX bytes', len(body)); return body
    text = body.decode('utf-8', 'replace')
    if 'json' in ct or text.lstrip()[:1] in '[{':
        print('JSON head:', text[:1500]); return body
    if 'html' in ct or '<html' in text[:2000].lower():
        t = re.search(r'<title[^>]*>(.*?)</title>', text, re.S | re.I)
        print('title:', (t.group(1).strip() if t else '')[:120])
        hits = sorted(set(re.findall(r'["\']([^"\'\s<>]*(?:api|Api|API|json|Json|ajax|Ajax|pcf|Pcf|PCF|Weight|weight|holding|Holding|ratio)[^"\'\s<>]*)["\']', text)))
        print('api-like strings:', hits[:60])
        scripts = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', text)
        print('scripts:', scripts[:25])
        forms = re.findall(r'<(?:select|input)[^>]+name=["\']([^"\']+)["\']', text)
        print('form fields:', sorted(set(forms))[:40])
        body_txt = re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', ' ', text, flags=re.S))
        print('text sample:', re.sub(r'\s+', ' ', body_txt)[:1500])
        return body
    print('TEXT head:', text[:1500]); return body


# ---- 美股 ----
show('SEC 基金代號對照', 'https://www.sec.gov/files/company_tickers_mf.json', SEC_UA)
show('SEC N-PORT 2026Q3 大小', 'https://www.sec.gov/files/dera/data/form-n-port-data-sets/2026q3_nport.zip', SEC_UA, 'HEAD')
show('Nasdaq 上市清單', 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt')
show('其他交易所上市清單', 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt')
show('SSGA SPY 每日持股', 'https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx')
show('iShares IVV 每日持股', 'https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf/1467271812596.ajax?fileType=csv&fileName=IVV_holdings&dataType=fund')
# ---- 台股 ----
show('TWSE 申贖揭露專區規格', 'https://dsp.twse.com.tw/public/static/downloads/tradingDepartment/ETF%20%E7%94%B3%E8%B4%96%E8%B3%87%E8%A8%8A%E5%8F%8A%E5%8D%B3%E6%99%82%E6%B7%A8%E5%80%BC%E6%8F%AD%E9%9C%B2%E5%B0%88%E5%8D%80%E4%BB%8B%E6%8E%A5%E6%A0%BC%E5%BC%8F%E8%AA%AA%E6%98%8E_20250109142554.pdf')
show('TWSE 國內成分股 ETF', 'https://www.twse.com.tw/zh/ETF/domestic')
show('TWSE 宅在家學習網 ETF 查詢管道', 'https://shl.twse.com.tw/newsArticle/detail/8a8221129265cb8b0194ca8033dd0046?type=HotKnowledge')
show('元大 0050 PCF', 'https://www.yuantaetfs.com/tradeInfo/pcf/0050')
show('元大 0050 持股權重', 'https://www.yuantaetfs.com/product/detail/0050/ratio')
show('國泰 PCF', 'https://www.cathaysite.com.tw/funds/etf/pcf.aspx')
show('富邦 PCF', 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx')
show('永豐 PCF', 'https://sitc.sinopac.com/SinopacEtfs/Etfs/Pcf')
show('玉山 PCF', 'https://www.esunam.com/ETF/etf-pcf')
show('投信投顧公會 明細資料', 'https://www.sitca.org.tw/ROC/Industry/IN2002.aspx?PGMID=IN0202')
