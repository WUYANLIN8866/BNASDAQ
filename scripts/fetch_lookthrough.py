#!/usr/bin/env python3
"""BNASDAQ｜投資組合透視資料 → data/lt/（公開市場資料，不含任何策略規則）

輸出
  data/lt/universe.json：全部台股（上市＋上櫃，含 ETF；沿用 data/tw/latest.json 的官方收盤）＋全部美股
                         （Nasdaq 篩選器：股票與 ETF，含最新收盤與產業）＋美元兌台幣匯率
  data/lt/etf/<代號>.json：可拆解 ETF 的成分股（發行商官方持股檔）；槓桿／反向 ETF＝基準 ETF × 倍數；債券型＝非股票
  data/lt/meta.json：各來源抓取結果、涵蓋率、資料日期
來源（全部官方）
  美股清單與價格：Nasdaq 股票／ETF 篩選器（api.nasdaq.com）
  美股 ETF 持股：State Street SPDR（每日 xlsx）、iShares（每日 csv）、Vanguard（月底 json）、Invesco（每日 json）、VanEck（每日 xlsx）
  台股 ETF 持股：元大投信（持股權重）、富邦投信（申購買回清單）
口徑
  權重＝占基金淨資產 %（發行商公布值）；只保留股票類持股，其餘（現金、債券、期貨、交換合約）計入「非股票」
  公司代號：美股用股票代號；台股用 4 碼代號（ISIN 為 TW000xxxx… 或美國存託憑證 TSM、UMC 等對照表）；其他國家用 ISIN
用法：python3 scripts/fetch_lookthrough.py [--only universe,us,tw] [--codes SPY,0050] [--max N]
"""
import os, re, io, sys, csv, json, time, argparse, datetime as dt, urllib.request, urllib.error, urllib.parse, http.cookiejar, subprocess, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'lt')
ETF_DIR = os.path.join(OUT, 'etf')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
CJ = http.cookiejar.CookieJar()
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CJ))
TODAY = dt.date.today().isoformat()


def log(*a):
    print('[lt]', *a, flush=True)


def get(url, headers=None, timeout=60, tries=3, data=None):
    h = {'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}
    h.update(headers or {})
    err = None
    for k in range(tries):
        try:
            with OP.open(urllib.request.Request(url, headers=h, data=data), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 401, 403, 404, 410) or (e.code >= 500 and k >= 1):
                break
        except Exception as e:  # noqa
            err = e
        time.sleep(1.5 * (k + 1))
    raise err


# ---------------------------------------------------------------- 產業（統一成中文大類）
SECTOR = {
    # GICS（iShares／SSGA）與 Yahoo
    'information technology': '資訊科技', 'technology': '資訊科技', 'communication': '通訊服務', 'communication services': '通訊服務', 'telecommunications': '通訊服務',
    'consumer discretionary': '非必需消費', 'consumer cyclical': '非必需消費', 'consumer staples': '必需消費', 'consumer defensive': '必需消費',
    'health care': '醫療保健', 'healthcare': '醫療保健', 'financials': '金融', 'financial services': '金融', 'finance': '金融',
    'industrials': '工業', 'energy': '能源', 'materials': '原物料', 'basic materials': '原物料', 'utilities': '公用事業', 'real estate': '房地產',
}


def sector_zh(s):
    return SECTOR.get(str(s or '').strip().lower(), '')


# 台股產業別（證交所分類）→ 同一套大類
TW_IND = {'半導體業': '資訊科技', '電子零組件業': '資訊科技', '電腦及週邊設備業': '資訊科技', '光電業': '資訊科技', '其他電子業': '資訊科技', '電子通路業': '資訊科技', '資訊服務業': '資訊科技',
          '通信網路業': '資訊科技', '數位雲端': '資訊科技', '金融保險業': '金融', '生技醫療業': '醫療保健', '電機機械': '工業', '電器電纜': '工業', '航運業': '工業', '綠能環保': '工業',
          '建材營造業': '房地產', '鋼鐵工業': '原物料', '化學工業': '原物料', '塑膠工業': '原物料', '水泥工業': '原物料', '造紙工業': '原物料', '玻璃陶瓷': '原物料',
          '紡織纖維': '非必需消費', '汽車工業': '非必需消費', '觀光餐旅': '非必需消費', '居家生活': '非必需消費', '運動休閒': '非必需消費', '貿易百貨業': '非必需消費', '橡膠工業': '非必需消費',
          '食品工業': '必需消費', '農業科技業': '必需消費', '油電燃氣業': '公用事業', '文化創意業': '通訊服務', '其他業': '其他'}
TELCO_TW = {'2412': '通訊服務', '3045': '通訊服務', '4904': '通訊服務'}


def fund_sector(code, market):
    """站上「個股目標價試算」已有的產業資料：台股用證交所產業別、美股用 Yahoo 產業"""
    p = os.path.join(ROOT, 'data', 'fund', code + '.json')
    if not os.path.exists(p):
        return ''
    try:
        d = json.load(open(p, encoding='utf-8'))
    except Exception:  # noqa
        return ''
    if market in ('TW', 'TWO'):
        return TELCO_TW.get(code) or TW_IND.get(d.get('industry') or '', '')
    return sector_zh(d.get('sector'))


# 美國存託憑證 → 台股代號（同一家公司合併）
ADR_TW = {'TSM': '2330', 'UMC': '2303', 'ASX': '3711', 'CHT': '2412'}
# 同公司不同股票類別 → 合併到一個代號（前端也用這張表）
ALIAS = {'GOOG': 'GOOGL', 'BRK-A': 'BRK-B', 'FOX': 'FOXA', 'NWS': 'NWSA', 'UA': 'UAA', 'LEN-B': 'LEN', 'HEI-A': 'HEI', 'BF-A': 'BF-B', 'MOG-B': 'MOG-A', 'ZG': 'Z', 'LBRDA': 'LBRDK', 'LSXMA': 'LSXMK', 'FWONA': 'FWONK', 'GEF-B': 'GEF', 'CWEN-A': 'CWEN', 'BIO-B': 'BIO', 'TSM': '2330', 'UMC': '2303', 'ASX': '3711', 'CHT': '2412'}

# 槓桿／反向 ETF：代號 → (基準 ETF, 倍數, 說明)
LEVER = {
    'QLD': ('QQQ', 2, 'ProShares 2 倍那斯達克 100'), 'TQQQ': ('QQQ', 3, 'ProShares 3 倍那斯達克 100'), 'PSQ': ('QQQ', -1, '反向 1 倍'), 'QID': ('QQQ', -2, '反向 2 倍'), 'SQQQ': ('QQQ', -3, '反向 3 倍'),
    'QQQM': ('QQQ', 1, '與 QQQ 追蹤同一指數'), 'QQQU': None,
    'SSO': ('SPY', 2, '2 倍標普 500'), 'UPRO': ('SPY', 3, '3 倍標普 500'), 'SPXL': ('SPY', 3, '3 倍標普 500'), 'SH': ('SPY', -1, '反向 1 倍'), 'SDS': ('SPY', -2, '反向 2 倍'), 'SPXU': ('SPY', -3, '反向 3 倍'), 'SPXS': ('SPY', -3, '反向 3 倍'),
    'DDM': ('DIA', 2, '2 倍道瓊'), 'UDOW': ('DIA', 3, '3 倍道瓊'), 'DOG': ('DIA', -1, '反向 1 倍'), 'DXD': ('DIA', -2, '反向 2 倍'), 'SDOW': ('DIA', -3, '反向 3 倍'),
    'SOXL': ('SOXX', 3, '3 倍半導體（以 SOXX 成分股近似）'), 'SOXS': ('SOXX', -3, '反向 3 倍半導體（以 SOXX 近似）'),
    'TECL': ('XLK', 3, '3 倍科技類股（以 XLK 近似）'), 'TECS': ('XLK', -3, '反向 3 倍科技（以 XLK 近似）'), 'FAS': ('XLF', 3, '3 倍金融類股（以 XLF 近似）'), 'FAZ': ('XLF', -3, '反向 3 倍金融（以 XLF 近似）'),
    'TNA': ('IWM', 3, '3 倍羅素 2000（以 IWM 近似）'), 'TZA': ('IWM', -3, '反向 3 倍羅素 2000'), 'UWM': ('IWM', 2, '2 倍羅素 2000'), 'URTY': ('IWM', 3, '3 倍羅素 2000'), 'RWM': ('IWM', -1, '反向 1 倍羅素 2000'),
    'SPLG': ('SPY', 1, '與 SPY 追蹤同一指數'), 'SPYM': ('SPY', 1, '與 SPY 追蹤同一指數'),
    # 台股
    '00631L': ('0050', 2, '元大台灣 50 正 2（以 0050 成分股 × 2）'), '00632R': ('0050', -1, '元大台灣 50 反 1（以 0050 × −1）'),
    '00670L': ('QQQ', 2, '富邦 NASDAQ 正 2（以 QQQ 成分股 × 2）'), '00671R': ('QQQ', -1, '富邦 NASDAQ 反 1'),
    '00647L': ('SPY', 2, '元大 S&P500 正 2（以 SPY × 2）'), '00648R': ('SPY', -1, '元大 S&P500 反 1'),
    '00663L': ('006204', 2, '國泰臺灣加權正 2（以永豐臺灣加權 006204 × 2 近似）'), '00675L': ('006204', 2, '富邦臺灣加權正 2（以 006204 × 2 近似）'),
    '00685L': ('006204', 2, '群益臺灣加權正 2（以 006204 × 2 近似）'), '00664R': ('006204', -1, '國泰臺灣加權反 1'), '00676R': ('006204', -1, '富邦臺灣加權反 1'), '00686R': ('006204', -1, '群益臺灣加權反 1'),
    '00669R': ('DIA', -1, '國泰美國道瓊反 1（以 DIA × −1）'), '00852L': ('DIA', 2, '國泰美國道瓊正 2（以 DIA × 2）'),
}
COMMODITY_RE = re.compile(r'\b(Gold|Silver|Platinum|Palladium|Bitcoin|Ether|Ethereum|Crypto|Solana|XRP|Oil|Natural Gas|Commodity|Commodities|VIX|Volatility|Futures|Copper)\b', re.I)
EQUITY_WORDS = re.compile(r'\b(Miners?|Mining|Producers|Exploration|Equity|Equities|Stock|Stocks|Companies|Industry|Sector|Infrastructure|Royalty|Electrification)\b', re.I)
BOND_RE = re.compile(r'\b(Treasury|T-?Bill|Bond|Municipal|Muni|Aggregate|Fixed Income|MBS|TIPS|Mortgage-Backed|Floating Rate Note|Money Market|Corporate Bond|High Yield)\b', re.I)


def norm_us(t):
    t = str(t or '').strip().upper().replace('/', '-').replace('.', '-')
    t = re.sub(r'\s+(UQ|UN|UW|UA|UP|UF|US|UR)$', '', t)
    return t


def key_of(ticker, isin, country, name):
    """持股 → 公司代號；回傳 (key, market)"""
    isin = str(isin or '').strip().upper(); country = str(country or '').strip()
    t = str(ticker or '').strip().upper()
    m = re.match(r'^TW000(\d{4})\d{2}\d$', isin)
    if m:
        return m.group(1), 'TW'
    if country in ('Taiwan', 'TW', '台灣') and re.match(r'^\d{4}$', t):
        return t, 'TW'
    tu = norm_us(t)
    if tu in ADR_TW:
        return ADR_TW[tu], 'TW'
    if isin.startswith('US') or country in ('United States', 'US', 'USA', '') and re.match(r'^[A-Z][A-Z0-9-]{0,6}$', tu):
        if tu:
            return tu, 'US'
    if isin:
        return 'X:' + isin, 'X'
    if tu:
        return 'X:' + (country or 'NA') + ':' + tu, 'X'
    return 'N:' + re.sub(r'\s+', ' ', str(name or '').strip().upper())[:60], 'X'


def clean_name(n):
    n = re.sub(r'\s+', ' ', str(n or '')).strip()
    n = re.sub(r'\s+(Common Stock|Ordinary Shares|Class [A-C] (Common Stock|Ordinary Shares)|American Depositary Shares.*|Common Shares)$', '', n, flags=re.I)
    return n.strip(' -,')


def num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).replace(',', '').replace('$', '').replace('%', '').strip()
    try:
        return float(s)
    except ValueError:
        return None


# ---------------------------------------------------------------- 證券總表
def build_universe():
    tw_idx = json.load(open(os.path.join(ROOT, 'data', 'tw', 'index.json'), encoding='utf-8'))
    tw_lt = json.load(open(os.path.join(ROOT, 'data', 'tw', 'latest.json'), encoding='utf-8'))
    items = tw_lt.get('items', {})
    U = {}
    for code, name, mkt, *_ in tw_idx['list']:
        if mkt not in ('TW', 'TWO'):
            continue
        px = (items.get(code) or [None])[0]
        kind = 'E' if code.startswith('00') else 'S'
        U[code] = [code, name, mkt, kind, px, fund_sector(code, mkt) if kind == 'S' else '']
    for code, v in items.items():
        if code not in U and len(v) >= 4 and v[3] in ('TW', 'TWO'):
            U[code] = [code, v[2] or code, v[3], 'E' if code.startswith('00') else 'S', v[0], '']
    hdr = {'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
    st = json.loads(get('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&download=true', hdr))
    rows = (st.get('data') or {}).get('rows') or []
    for r in rows:
        c = norm_us(r.get('symbol'))
        if not re.match(r'^[A-Z][A-Z0-9-]{0,7}$', c):
            continue
        U[c] = [c, clean_name(r.get('name')), 'US', 'S', num(r.get('lastsale')), fund_sector(c, 'US') or sector_zh(r.get('sector'))]
    et = json.loads(get('https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=25&download=true', hdr))
    d = et.get('data') or {}
    erows = d.get('rows') or (d.get('data') or {}).get('rows') or []
    for r in erows:
        c = norm_us(r.get('symbol'))
        if not re.match(r'^[A-Z][A-Z0-9-]{0,7}$', c):
            continue
        U[c] = [c, re.sub(r'\s+', ' ', str(r.get('companyName') or c)).strip(), 'US', 'E', num(r.get('lastSalePrice')), '']
    fx = tw_lt.get('fx') or {}
    log('universe: TW', sum(1 for v in U.values() if v[2] != 'US'), 'US stocks', len(rows), 'US ETFs', len(erows))
    return U, {'USDTWD': fx.get('rate'), 'date': fx.get('date'), 'source': fx.get('source')}, {'TW': (tw_lt.get('asof') or {}).get('TW'), 'TWO': (tw_lt.get('asof') or {}).get('TWO'), 'US': TODAY}


# ---------------------------------------------------------------- 美股 ETF 持股
def xlsx_rows(b):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True)
    return [list(r) for r in wb.worksheets[0].iter_rows(values_only=True)]


def src_ssga(code):
    b = get('https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-%s.xlsx' % code.lower())
    rows = xlsx_rows(b)
    asof = ''
    for r in rows[:6]:
        if r and str(r[0] or '').startswith('Holdings'):
            m = re.search(r'(\d{2})-([A-Za-z]{3})-(\d{4})', str(r[1]))
            if m:
                asof = dt.datetime.strptime(m.group(0), '%d-%b-%Y').date().isoformat()
    hi = next((i for i, r in enumerate(rows) if r and r[0] == 'Name' and 'Weight' in r), None)
    if hi is None or 'Ticker' not in rows[hi]:
        return [], asof, 'State Street SPDR 每日持股'   # 債券型等沒有股票代號欄的檔案：視為沒有股票持股
    H = rows[hi]; ix = {k: H.index(k) for k in H if k}
    out = []
    for r in rows[hi + 1:]:
        if not r or r[0] in (None, ''):
            break
        w = num(r[ix['Weight']]); t = r[ix['Ticker']]; cus = str(r[ix.get('Identifier', 2)] or '')
        if w is None or not t or str(t).strip() in ('-', 'CASH_USD', 'USD'):
            continue
        out.append(dict(t=t, name=r[0], isin='US' + cus if re.match(r'^[0-9][0-9A-Z]{8}$', cus) else '', country='' if re.match(r'^[0-9]', cus) else 'Intl', w=w, sec=sector_zh(r[ix['Sector']]) if 'Sector' in ix else ''))
    return out, asof, 'State Street SPDR 每日持股'


ISHARES = {}


def ishares_list():
    if ISHARES:
        return ISHARES
    j = json.loads(get('https://www.ishares.com/us/product-screener/product-screener-v3.1.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/us-ishares/ishares-product-screener-backend-config&siteEntryPassthrough=true'))
    for pid, p in j.items():
        t = norm_us(p.get('localExchangeTicker'))
        if t:
            ISHARES[t] = (pid, p.get('productPageUrl') or '', p.get('fundName') or '', p.get('aladdinAssetClass') or '')
    return ISHARES


def src_ishares(code):
    pid, page, name, ac = ishares_list()[code]
    slug = page.rstrip('/').split('/')[-1] if page else re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    t = get('https://www.ishares.com/us/products/%s/%s/latest-holdings.csv' % (pid, slug)).decode('utf-8-sig', 'replace')
    lines = t.splitlines()
    asof = ''
    m = re.search(r'Fund Holdings as of,"?([A-Za-z]{3} \d{1,2}, \d{4})', t)
    if m:
        asof = dt.datetime.strptime(m.group(1), '%b %d, %Y').date().isoformat()
    hi = next((i for i, l in enumerate(lines) if l.startswith('Ticker,') or l.startswith('"Ticker"')), None)
    if hi is None:
        return [], asof, 'iShares 每日持股'
    out = []
    for r in csv.DictReader(lines[hi:]):
        if (r.get('Asset Class') or '').strip() != 'Equity':
            continue
        w = num(r.get('Weight (%)') or r.get('Market Weight'))
        if w is None:
            continue
        out.append(dict(t=r.get('Ticker'), name=r.get('Name'), isin=r.get('ISIN') or '', country=(r.get('Location') or '').strip(), w=w, sec=sector_zh(r.get('Sector'))))
    return out, asof, 'iShares 每日持股'


VG_META = {}


def src_vanguard(code):
    """Vanguard 只列股票類持股；分頁抓到不齊時，標記 partial（未列出的部分是小額股票，不算非股票）"""
    out, seen, asof, size, start = [], set(), '', 0, 1
    while start <= max(size, 1) and start <= 20000:
        url = 'https://investor.vanguard.com/vmf/api/%s/portfolio-holding/stock.json' % code + ('' if start == 1 else '?start=%d&count=500' % start)
        try:
            j = json.loads(get(url, tries=2))
        except Exception:  # noqa
            if start == 1:
                raise
            break
        ents = ((j.get('fund') or {}).get('entity')) or []
        asof = (j.get('asOfDate') or '')[:10] or asof
        size = max(size, int(j.get('size') or 0))
        new = 0
        for e in ents:
            idk = (e.get('isin') or '') + '|' + (e.get('ticker') or '') + '|' + (e.get('longName') or '')
            w = num(e.get('percentWeight'))
            if w is None or idk in seen:
                continue
            seen.add(idk); new += 1
            out.append(dict(t=e.get('ticker'), name=e.get('longName') or e.get('shortName'), isin=e.get('isin') or '', country='', w=w, sec=''))
        if not ents or not new:
            break
        start += 500
        time.sleep(0.3)
    VG_META[code] = (len(out), size)
    return out, asof, 'Vanguard 月底持股'


def src_invesco(code):
    j = json.loads(get('https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/%s/holdings/fund?idType=ticker&interval=monthly&productType=ETF' % code))
    out = []
    for h in j.get('holdings') or []:
        w = num(h.get('percentageOfTotalNetAssets'))
        if w is None or (h.get('securityTypeCode') or 'COM') not in ('COM', 'ADR', 'REIT', 'PFD', 'MLP', 'ETF', 'GDR', 'UNT', 'CS'):
            continue
        cus = str(h.get('cusip') or '')
        out.append(dict(t=h.get('ticker'), name=h.get('issuerName'), isin='US' + cus if re.match(r'^[0-9][0-9A-Z]{8}$', cus) else '', country='', w=w, sec=''))
    return out, (j.get('effectiveDate') or '')[:10], 'Invesco 每日持股'


def src_vaneck(code):
    b = get('https://www.vaneck.com/us/en/etf/equity/%s/holdings/download/xlsx/' % code.lower())
    if b[:2] != b'PK':
        return [], '', 'VanEck 每日持股'
    rows = xlsx_rows(b)
    asof = ''
    m = re.search(r'(\d{2})/(\d{2})/(\d{4})', str(rows[0][0] if rows and rows[0] else ''))
    if m:
        asof = '%s-%s-%s' % (m.group(3), m.group(1), m.group(2))
    hi = next(i for i, r in enumerate(rows) if r and 'Ticker' in r and '% of Net Assets' in r)
    H = rows[hi]; ix = {k: H.index(k) for k in H if k}
    out = []
    for r in rows[hi + 1:]:
        if not r or r[ix['Ticker']] in (None, ''):
            continue
        if str(r[ix.get('Asset Class', 5)] or '').strip() not in ('Stock', 'Equity'):
            continue
        w = num(r[ix['% of Net Assets']])
        if w is None:
            continue
        out.append(dict(t=r[ix['Ticker']], name=r[ix['Holding Name']], isin='', country='', w=w, sec=''))
    return out, asof, 'VanEck 每日持股'


ARK = {'ARKK': 'ARK_INNOVATION_ETF_ARKK', 'ARKW': 'ARK_NEXT_GENERATION_INTERNET_ETF_ARKW', 'ARKQ': 'ARK_AUTONOMOUS_TECH._&_ROBOTICS_ETF_ARKQ',
       'ARKG': 'ARK_GENOMIC_REVOLUTION_ETF_ARKG', 'ARKF': 'ARK_BLOCKCHAIN_&_FINTECH_INNOVATION_ETF_ARKF', 'ARKX': 'ARK_SPACE_EXPLORATION_&_INNOVATION_ETF_ARKX'}


def src_ark(code):
    t = get('https://assets.ark-funds.com/fund-documents/funds-etf-csv/%s_HOLDINGS.csv' % urllib.parse.quote(ARK[code], safe='_.')).decode('utf-8-sig', 'replace')
    out, asof = [], ''
    for r in csv.DictReader(t.splitlines()):
        w = num(r.get('weight (%)')); tk = (r.get('ticker') or '').strip()
        if w is None or not (r.get('company') or '').strip():
            continue
        if not asof and r.get('date'):
            m = re.match(r'(\d{2})/(\d{2})/(\d{4})', r['date'])
            if m:
                asof = '%s-%s-%s' % (m.group(3), m.group(1), m.group(2))
        cus = (r.get('cusip') or '').strip()
        out.append(dict(t=tk, name=r.get('company'), isin='US' + cus if re.match(r'^[0-9][0-9A-Z]{8}$', cus) else '', country='', w=w, sec=''))
    return out, asof, 'ARK Invest 每日持股'


# ---------------------------------------------------------------- 寫檔
def finalize(code, rows, asof, src, U, extra=None):
    """rows → 合併同公司、排序、寫 data/lt/etf/<code>.json；回傳股票權重合計"""
    agg = {}
    for r in rows:
        k, mk = key_of(r.get('t'), r.get('isin'), r.get('country'), r.get('name'))
        k = ALIAS.get(k, k)
        u = U.get(k)
        name = (u[1] if u and u[3] == 'S' else '') or clean_name(r.get('name')) or k
        sec = (u[5] if u and u[5] else '') or r.get('sec') or ''
        a = agg.setdefault(k, [k, 0.0, name, sec])
        a[1] += float(r['w'])
        if not a[3] and sec:
            a[3] = sec
    h = sorted(agg.values(), key=lambda x: -x[1])
    h = [[x[0], round(x[1], 4), x[2], x[3]] for x in h if abs(x[1]) >= 0.00005]
    eq = round(sum(x[1] for x in h), 4)
    if eq > 102 or any(x[1] < -0.5 for x in h):
        raise ValueError('權重加總 %.2f%% 不合理，不發布（保留前一版）' % eq)
    d = dict(code=code, name=(U.get(code) or [code, code])[1], asof=asof or TODAY, src=src, eq=eq, n=len(h), h=h)
    if extra:
        d.update(extra)
    write_json(os.path.join(ETF_DIR, code + '.json'), d)
    return eq


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    if os.path.exists(path) and open(path, encoding='utf-8').read() == s:
        return False
    open(path, 'w', encoding='utf-8').write(s)
    return True


def run_us(U, only_codes, maxn, report):
    etfs = [c for c, v in U.items() if v[2] == 'US' and v[3] == 'E']
    if only_codes:
        etfs = [c for c in etfs if c in only_codes]
    try:
        ish = ishares_list()
    except Exception as e:  # noqa
        ish = {}; log('iShares list failed', repr(e)[:150])
    plan = []
    for c in sorted(etfs):
        n = U[c][1]
        if c in LEVER:
            continue
        if c in ish:
            plan.append((c, 'iShares', src_ishares))
        elif re.search(r'\bSPDR\b|State Street', n):
            plan.append((c, 'SSGA', src_ssga))
        elif re.search(r'\bVanguard\b', n):
            plan.append((c, 'Vanguard', src_vanguard))
        elif c == 'QQQ':
            plan.append((c, 'Invesco', src_invesco))   # Invesco 的 API 只有 QQQ 可用（其餘回傳 500）；QQQM 沿用 QQQ
        elif c in ARK:
            plan.append((c, 'ARK', src_ark))
        elif re.search(r'\bVanEck\b', n):
            plan.append((c, 'VanEck', src_vaneck))
    if maxn:
        plan = plan[:maxn]
    log('US plan', len(plan), {k: sum(1 for p in plan if p[1] == k) for k in ('iShares', 'SSGA', 'Vanguard', 'Invesco', 'VanEck', 'ARK')})
    for i, (c, who, fn) in enumerate(plan):
        try:
            rows, asof, src = fn(c)
            if rows:
                extra = None
                if who == 'Vanguard' and c in VG_META and VG_META[c][1] > VG_META[c][0]:
                    extra = dict(partial=1, listed=VG_META[c][0], total=VG_META[c][1])
                eq = finalize(c, rows, asof, src, U, extra)
                report['ok'][c] = [who, asof, len(rows), eq]
            elif BOND_RE.search(U[c][1]) or (COMMODITY_RE.search(U[c][1]) and not EQUITY_WORDS.search(U[c][1])):
                write_json(os.path.join(ETF_DIR, c + '.json'), dict(code=c, name=U[c][1], asof=asof or TODAY, src=src + '（無股票持股：債券或現金型）', eq=0, n=0, h=[]))
                report['ok'][c] = [who, asof, 0, 0]
            else:
                report['empty'][c] = who
        except Exception as e:  # noqa
            report['fail'][c] = [who, repr(e)[:120]]
        if i % 50 == 0:
            log('US', i, '/', len(plan), c, who, 'ok', len(report['ok']), 'fail', len(report['fail']))
        time.sleep(0.35)


# ---------------------------------------------------------------- 台股 ETF 持股
YUANTA_LIST = []


def yuanta_nuxt(code):
    """元大產品頁 → 執行頁面內的 window.__NUXT__（Node）→ 股票權重與元大 ETF 清單"""
    t = get('https://www.yuantaetfs.com/product/detail/%s/ratio' % code).decode('utf-8', 'replace')
    m = re.search(r'<script>(window\.__NUXT__=.*?)</script>', t, re.S)
    if not m:
        raise RuntimeError('no __NUXT__')
    js = ('const window={};' + m.group(1) + '\nconst N=window.__NUXT__;let W=null,info=null;'
          'for(const d of (N.data||[])){if(d&&d.weightData&&d.weightData.FundWeights){W=d.weightData.FundWeights;}}'
          'info=(N.state&&N.state.etfInfo)||[];'
          'process.stdout.write(JSON.stringify({W:W,info:info.map(x=>[x.STK_CD,x.STK_NAME])}));')
    f = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8'); f.write(js); f.close()
    try:
        r = subprocess.run(['node', f.name], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(f.name)
    if r.returncode != 0:
        raise RuntimeError('node: ' + r.stderr[:200])
    return json.loads(r.stdout)


def src_yuanta(code):
    j = yuanta_nuxt(code)
    if not YUANTA_LIST and j.get('info'):
        YUANTA_LIST.extend(j['info'])
    W = j.get('W') or {}
    out = []
    for s in W.get('StockWeights') or []:
        w = num(s.get('weights'))
        if w is None:
            continue
        c = str(s.get('code') or '').strip()
        tw = re.match(r'^\d{4}$', c)
        out.append(dict(t=c if tw else c, name=s.get('name') or s.get('ename'), isin='', country='Taiwan' if tw else '', w=w, sec=''))
    asof = ''
    for k in ('TranDate', 'Date', 'date', 'tranDate'):
        if W.get(k):
            asof = str(W[k])[:10].replace('/', '-'); break
    return out, asof, '元大投信 持股權重'


def src_sinopac(code):
    t = get('https://sitc.sinopac.com/SinopacEtfs/Etfs/Pcf/%s' % code).decode('utf-8', 'replace')
    asof = ''
    m = re.search(r'資料日期：\s*(\d{4})/(\d{2})/(\d{2})', t)
    if m:
        asof = '%s-%s-%s' % m.groups()
    out = []
    for tb in re.findall(r'<table.*?</table>', t, re.S):
        if '佔基金淨資產之權重' not in tb:
            continue
        for tr in re.findall(r'<tr.*?</tr>', tb, re.S):
            td = [re.sub(r'<[^>]+>|&nbsp;', ' ', x).strip() for x in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
            if len(td) >= 4 and num(td[3]) is not None:
                c = re.sub(r'\s+', ' ', td[0]).strip()
                out.append(dict(t=c, name=td[1], isin='', country='Taiwan' if re.match(r'^\d{4}$', c) else '', w=num(td[3]), sec=''))
        break
    return out, asof, '永豐投信 申購買回清單'


FH = {}


def fh_scan():
    """復華：內部代號 ETF01～ETF40 逐一下載最近一個有資料的交易日持股 Excel，從標題讀出證券代號"""
    if FH:
        return FH
    import openpyxl
    days = [(dt.date.today() - dt.timedelta(days=k)).strftime('%Y%m%d') for k in range(0, 8)]
    for i in range(1, 41):
        fid = 'ETF%02d' % i
        for d in days:
            try:
                b = get('https://www.fhtrust.com.tw/api/assetsExcel/%s/%s' % (fid, d), tries=1)
            except Exception:  # noqa
                continue
            if b[:2] != b'PK':
                continue
            rows = [list(r) for r in openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True)]
            m = re.search(r'證[劵券]代碼：\s*([0-9A-Z]{4,7})', str(rows[0][0] if rows and rows[0] else ''))
            if m:
                FH[m.group(1)] = (fid, d, rows)
            break
        time.sleep(0.2)
    log('復華', len(FH), sorted(FH))
    return FH


def src_fuhhwa(code):
    fid, d, rows = fh_scan()[code]
    asof = '%s-%s-%s' % (d[:4], d[4:6], d[6:])
    for r in rows[:6]:
        m = re.search(r'(\d{4})/(\d{2})/(\d{2})', str(r[0] or ''))
        if m:
            asof = '-'.join(m.groups()); break
    hi = next((i for i, r in enumerate(rows) if r and r[0] == '證券代號'), None)
    out = []
    if hi is None:
        return out, asof, '復華投信 基金資產明細'
    H = rows[hi]
    wi = next((j for j, h in enumerate(H) if h and '權重' in str(h)), 4)
    for r in rows[hi + 1:]:
        if not r or not r[0]:
            continue
        w = num(r[wi]); c = str(r[0]).strip()
        if w is None:
            continue
        out.append(dict(t=c, name=r[1], isin='', country='Taiwan' if re.match(r'^\d{4}$', c) else '', w=w, sec=''))
    return out, asof, '復華投信 基金資產明細'


SINOPAC = ['00930', '00907', '00901', '00888', '00887', '00886', '00858', '006204', '00410A']


def run_tw(U, only_codes, report):
    plan = []
    try:
        if not YUANTA_LIST:
            src_yuanta('0050')
    except Exception as e:  # noqa
        log('yuanta list failed', repr(e)[:150])
    for c, nm in YUANTA_LIST or [['0050', '']]:
        if c in U and not c.endswith('B') and c not in LEVER:
            plan.append((c, '元大', src_yuanta))
    for c in SINOPAC:
        if c in U and c not in LEVER:
            plan.append((c, '永豐', src_sinopac))
    try:
        for c in sorted(fh_scan()):
            if c in U and c not in LEVER and not c.endswith('B'):
                plan.append((c, '復華', src_fuhhwa))
    except Exception as e:  # noqa
        log('復華 scan failed', repr(e)[:150])
    if only_codes:
        plan = [p for p in plan if p[0] in only_codes]
    log('TW plan', len(plan))
    for c, who, fn in plan:
        try:
            rows, asof, src = fn(c)
            if rows:
                eq = finalize(c, rows, asof, src, U)
                report['ok'][c] = [who, asof, len(rows), eq]
            else:
                report['empty'][c] = who
        except Exception as e:  # noqa
            report['fail'][c] = [who, repr(e)[:120]]
        time.sleep(0.5)


# 同指數的 ETF：直接用另一檔的成分股（倍數 1）
SAME_INDEX = {'006208': ('0050', '富邦台 50 與 0050 追蹤同一指數（臺灣 50 指數）'), '00662': ('QQQ', '富邦 NASDAQ 與 QQQ 追蹤同一指數（那斯達克 100）'),
              'IVV': None, 'VOO': None}


def run_derived(U, report):
    """槓桿／反向與同指數 ETF：寫成 {base, lev}；債券型 ETF（台股代號結尾 B、美股名稱含債券字樣）且沒有持股檔：寫成非股票"""
    have = lambda c: os.path.exists(os.path.join(ETF_DIR, c + '.json'))
    for c, v in list(LEVER.items()) + [(k, (v[0], 1, v[1])) for k, v in SAME_INDEX.items() if v]:
        if not v or c not in U:
            continue
        base, lev, note = v
        if not have(base) or json.load(open(os.path.join(ETF_DIR, base + '.json'), encoding='utf-8')).get('base'):
            report['derived_missing'][c] = base; continue
        write_json(os.path.join(ETF_DIR, c + '.json'), dict(code=c, name=U[c][1], base=base, lev=lev, note=note, src='以 %s 成分股 × %s 推算' % (base, lev)))
        report['derived'][c] = [base, lev]
    for c, v in U.items():
        if v[3] != 'E' or have(c):
            continue
        nm = v[1] or ''
        if (v[2] in ('TW', 'TWO') and c.endswith('B')) or (v[2] == 'US' and BOND_RE.search(nm)):
            write_json(os.path.join(ETF_DIR, c + '.json'), dict(code=c, name=nm, asof=TODAY, src='債券型 ETF（依名稱或代號判定）：不持有股票', eq=0, n=0, h=[], guess=1))
            report['bond_guess'].append(c)
        elif (v[2] in ('TW', 'TWO') and c.endswith('U')) or (v[2] == 'US' and COMMODITY_RE.search(nm) and not EQUITY_WORDS.search(nm)):
            write_json(os.path.join(ETF_DIR, c + '.json'), dict(code=c, name=nm, asof=TODAY, src='商品、期貨或加密資產型 ETF（依名稱或代號判定）：不持有股票', eq=0, n=0, h=[], guess=1))
            report['bond_guess'].append(c)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='universe,us,tw')
    ap.add_argument('--codes', default='')
    ap.add_argument('--max', type=int, default=0)
    a = ap.parse_args()
    only = set(x.strip() for x in a.only.split(',') if x.strip())
    codes = set(x.strip().upper() for x in a.codes.split(',') if x.strip())
    U, fx, asof = build_universe()
    report = dict(ok={}, fail={}, empty={}, derived={}, derived_missing={}, bond_guess=[])
    if 'us' in only:
        run_us(U, codes, a.max, report)
    if 'tw' in only:
        run_tw(U, codes, report)
    run_derived(U, report)
    files = {f[:-5] for f in os.listdir(ETF_DIR)} if os.path.isdir(ETF_DIR) else set()
    lst = []
    for c in sorted(U):
        v = U[c]
        lst.append([c, v[1], v[2], v[3], v[5], 1 if c in files else 0])
    # 名稱、類別、產業、可否拆解（每週變動）與價格（每日變動）分開存，避免每天重寫大檔
    write_json(os.path.join(OUT, 'universe.json'), dict(schema='bnasdaq-lt-universe/2', alias=ALIAS, cols=['code', 'name', 'market', 'kind', 'sector', 'lt'], list=lst))
    write_json(os.path.join(OUT, 'px.json'), dict(schema='bnasdaq-lt-px/1', updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), fx=fx, asof=asof,
                                                 px={c: (round(v[4], 4) if isinstance(v[4], (int, float)) else None) for c, v in U.items() if v[4]}))
    cov = lambda mk: (sum(1 for x in lst if x[3] == 'E' and (x[2] == 'US') == (mk == 'US') and x[6]), sum(1 for x in lst if x[3] == 'E' and (x[2] == 'US') == (mk == 'US')))
    meta = dict(updated=TODAY, coverage={'US': cov('US'), 'TW': cov('TW')}, ok=len(report['ok']), fail=report['fail'], empty=report['empty'], derived=report['derived'],
                derived_missing=report['derived_missing'], bond_guess=len(report['bond_guess']),
                sources={k: sum(1 for v in report['ok'].values() if v[0] == k) for k in ('iShares', 'SSGA', 'Vanguard', 'Invesco', 'VanEck', 'ARK', '元大', '永豐', '復華', '國泰', '群益')})
    if only & {'us', 'tw'}:
        write_json(os.path.join(OUT, 'meta.json'), meta)   # 只更新價格時保留上一次成分股的抓取紀錄
    log('done: ETF files', len(files), 'coverage', meta['coverage'], 'sources', meta['sources'], 'fail', len(report['fail']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
