#!/usr/bin/env python3
"""BNASDAQ｜公司分析資料：data/company/<代號>.json（每家一檔）＋ data/company/_universe.json（全部公司的指標與分數）。

公開市場資料，不含任何策略規則。只用公開 API／開放資料，單一誠實 User-Agent，不繞過任何網站的驗證。
來源：
  財報    Yahoo Finance fundamentals-timeseries：年度近 4～5 年、季度近 5 季、近四季合計（美股、台股 .TW 同一來源）
  股價    Yahoo Finance chart：近 1 年日線（1 年報酬、52 週高低、年化波動、Beta）
  台股    證交所 OpenAPI：董監事持股餘額 t187ap11_L、持股逾 10% 大股東 t187ap02_L、每月營收 t187ap05_L、
          前 10 大股東持股情形（ESG 揭露 t187ap46_L_18 → 證交所文件伺服器 PDF）；集保股權分散表（opendata 1-5）
  宇宙    data/heatmap/latest.json 四個指數（那斯達克 100、標普 500、費城半導體、台灣 50）的成分股
  產業    data/fund/<代號>.json 的 industry（美股 Yahoo 產業、台股證交所產業別）
衍生指標與分數全部在本程式計算（公式見 METHOD），網頁直接顯示；同業比較在同一市場（美股／台股）內做百分位。
用法：python3 scripts/fetch_company.py [--codes NVDA,2330] [--limit N]
"""
import concurrent.futures as cf, datetime as dt, io, json, math, os, re, statistics as st, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'company')
UA = 'BNASDAQ company fetch (+https://github.com/WUYANLIN8866/BNASDAQ)'
NOW = dt.datetime.now(dt.timezone.utc)


def log(*a):
    print('[company]', *a, flush=True)


def get(url, timeout=60, tries=3):
    err = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'}), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 401, 403, 404):
                break
            time.sleep((5 if e.code == 429 else 2) * (k + 1))
        except Exception as e:  # noqa
            err = e; time.sleep(2 * (k + 1))
    raise err


def num(x):
    try:
        s = str(x).replace(',', '').replace('%', '').strip()
        return float(s) if s not in ('', '-', '--', 'NA', 'N/A', 'None') else None
    except Exception:
        return None


# ------------------------------------------------------------------ 財報（Yahoo timeseries）
ANNUAL = ['TotalRevenue', 'CostOfRevenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'EBITDA', 'EBIT', 'ResearchAndDevelopment', 'SellingGeneralAndAdministration',
          'DilutedEPS', 'DilutedAverageShares', 'OrdinarySharesNumber', 'TotalAssets', 'TotalLiabilitiesNetMinorityInterest', 'StockholdersEquity', 'TotalDebt',
          'CashAndCashEquivalents', 'CurrentAssets', 'CurrentLiabilities', 'WorkingCapital', 'RetainedEarnings', 'Inventory', 'AccountsReceivable', 'InvestedCapital', 'Goodwill',
          'OperatingCashFlow', 'CapitalExpenditure', 'FreeCashFlow', 'RepurchaseOfCapitalStock', 'CashDividendsPaid', 'InterestExpense', 'TaxProvision', 'PretaxIncome', 'StockBasedCompensation']
QUARTER = ['TotalRevenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'DilutedEPS', 'FreeCashFlow']
TRAIL = ['TotalRevenue', 'NetIncome', 'FreeCashFlow', 'EBITDA', 'GrossProfit', 'OperatingIncome']
KEY = {  # 欄位短名
    'TotalRevenue': 'rev', 'CostOfRevenue': 'cogs', 'GrossProfit': 'gp', 'OperatingIncome': 'opi', 'NetIncome': 'ni', 'EBITDA': 'ebitda', 'EBIT': 'ebit',
    'ResearchAndDevelopment': 'rnd', 'SellingGeneralAndAdministration': 'sga', 'DilutedEPS': 'eps', 'DilutedAverageShares': 'shs', 'OrdinarySharesNumber': 'shs_out',
    'TotalAssets': 'ta', 'TotalLiabilitiesNetMinorityInterest': 'tl', 'StockholdersEquity': 'eq', 'TotalDebt': 'debt', 'CashAndCashEquivalents': 'cash',
    'CurrentAssets': 'ca', 'CurrentLiabilities': 'cl', 'WorkingCapital': 'wc', 'RetainedEarnings': 're', 'Inventory': 'inv', 'AccountsReceivable': 'ar',
    'InvestedCapital': 'ic', 'Goodwill': 'gw', 'OperatingCashFlow': 'ocf', 'CapitalExpenditure': 'capex', 'FreeCashFlow': 'fcf', 'RepurchaseOfCapitalStock': 'buyback',
    'CashDividendsPaid': 'div', 'InterestExpense': 'intexp', 'TaxProvision': 'tax', 'PretaxIncome': 'pretax', 'StockBasedCompensation': 'sbc'}


def ysym(code, market):
    return code + '.TW' if market == 'TW' else code


def timeseries(sym):
    types = ['annual' + t for t in ANNUAL] + ['quarterly' + t for t in QUARTER] + ['trailing' + t for t in TRAIL]
    out, curs = {}, {}
    for i in range(0, len(types), 24):   # 一次最多 24 個欄位，避免網址過長
        j = json.loads(get(f'https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{sym}?symbol={sym}&type={",".join(types[i:i + 24])}'
                           f'&period1=1420070400&period2={int(time.time())}'))
        for r in (j.get('timeseries') or {}).get('result') or []:
            t = r['meta']['type'][0]
            out[t] = [(x['asOfDate'], x['reportedValue']['raw']) for x in (r.get(t) or []) if x and x.get('reportedValue') and x['reportedValue'].get('raw') is not None]
            for x in (r.get(t) or []):
                if x and x.get('currencyCode') and t.startswith('annualTotalRevenue'):
                    curs[x['currencyCode']] = curs.get(x['currencyCode'], 0) + 1
        time.sleep(0.15)
    return out, (max(curs, key=curs.get) if curs else None)


MONEY_SKIP = {'d', 'shs', 'shs_out'}   # 股數不是金額；EPS 也是報表幣別，一起換算


def conv(t, fx):
    """財報表（{d, 欄位:[...]} 或 {欄位: 值}）的金額欄位乘上匯率，換成上市幣別。"""
    if not t or fx in (None, 1):
        return t
    o = {}
    for k, v in t.items():
        if k in MONEY_SKIP:
            o[k] = v
        elif isinstance(v, list):
            o[k] = [x * fx if isinstance(x, (int, float)) else x for x in v]
        elif isinstance(v, (int, float)):
            o[k] = v * fx
        else:
            o[k] = v
    return o


def fx_rate(fin, lst):
    """1 單位報表幣別 = ? 上市幣別（Yahoo 匯率最近收盤）。"""
    j = json.loads(get(f'https://query2.finance.yahoo.com/v8/finance/chart/{fin}{lst}=X?range=5d&interval=1d'))
    c = [x for x in j['chart']['result'][0]['indicators']['quote'][0]['close'] if x]
    return c[-1] if c else None


def table(ts, prefix, names, keep):
    """把 timeseries 整理成 {d:[日期], 欄位:[值]}，日期取所有欄位的聯集，只留最近 keep 期。"""
    dates = sorted({d for n in names for d, _ in ts.get(prefix + n, [])})[-keep:]
    t = {'d': dates}
    for n in names:
        m = dict(ts.get(prefix + n, []))
        vals = [m.get(d) for d in dates]
        if any(v is not None for v in vals):
            t[KEY[n]] = vals
    return t


CLOSE = {'US': ('America/New_York', (16, 15)), 'TW': ('Asia/Taipei', (13, 45))}   # 收盤（含緩衝）之前，當天的日線還不完整


def price_1y(sym, market='US'):
    """近 1 年日線：還原權息收盤（算報酬、波動、Beta）＋原始收盤（畫股價走勢、技術指標）；還沒收盤的當天不算。"""
    j = json.loads(get(f'https://query2.finance.yahoo.com/v8/finance/chart/{sym}?range=1y&interval=1d'))
    r = j['chart']['result'][0]
    raw = r['indicators']['quote'][0]['close']
    c = [x for x in (r['indicators'].get('adjclose') or [{}])[0].get('adjclose') or raw]
    ts = r.get('timestamp') or []
    pts = [(t, v) for t, v in zip(ts, c) if v is not None]
    from zoneinfo import ZoneInfo
    tz, hm = CLOSE.get(market, CLOSE['US']); z = ZoneInfo(tz); now = dt.datetime.now(z)
    daily = [(dt.datetime.fromtimestamp(t, z).strftime('%Y-%m-%d'), round(v, 4)) for t, v in zip(ts, raw) if v is not None]
    if daily and daily[-1][0] == now.strftime('%Y-%m-%d') and (now.hour, now.minute) < hm:
        daily = daily[:-1]
        if pts and dt.datetime.fromtimestamp(pts[-1][0], z).strftime('%Y-%m-%d') == now.strftime('%Y-%m-%d'):
            pts = pts[:-1]
    return pts, r.get('meta') or {}, daily


def price_5y(sym):
    """近 5 年月線收盤（原始）＋現金股利紀錄（Yahoo chart events=div）。"""
    j = json.loads(get(f'https://query2.finance.yahoo.com/v8/finance/chart/{sym}?range=5y&interval=1mo&events=div'))
    r = j['chart']['result'][0]
    ts, cl = r.get('timestamp') or [], r['indicators']['quote'][0]['close']
    mon = [(dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%Y-%m'), round(v, 4)) for t, v in zip(ts, cl) if v is not None]
    dv = sorted((dt.datetime.fromtimestamp(int(d['date']), dt.timezone.utc).strftime('%Y-%m-%d'), round(d['amount'], 6)) for d in ((r.get('events') or {}).get('dividends') or {}).values())
    return mon, dv


# ------------------------------------------------------------------ 台股：證交所、集保
def twse(path):
    return json.loads(get('https://openapi.twse.com.tw/v1' + path, timeout=120))


def tw_sources(codes):
    out = {c: {} for c in codes}
    try:
        for r in twse('/opendata/t187ap11_L'):
            c = str(r.get('公司代號', '')).strip()
            if c in out:
                out[c].setdefault('directors', []).append({'title': (r.get('職稱') or '').strip(), 'name': (r.get('姓名') or '').strip(), 'shares': num(r.get('目前持股')),
                                                           'pledge_pct': (r.get('設質股數佔持股比例') or '').strip(), 'related': num(r.get('內部人關係人目前持股合計')), 'ym': r.get('資料年月')})
        log('證交所董監持股 OK')
    except Exception as e:  # noqa
        log('證交所董監持股失敗', repr(e)[:120])
    try:
        for r in twse('/opendata/t187ap02_L'):
            c = str(r.get('公司代號', '')).strip()
            if c in out:
                out[c].setdefault('major10', []).append((r.get('大股東名稱') or '').strip())
        log('證交所逾 10% 大股東 OK')
    except Exception as e:  # noqa
        log('證交所大股東失敗', repr(e)[:120])
    try:
        for r in twse('/opendata/t187ap05_L'):
            c = str(r.get('公司代號', '')).strip()
            if c in out:
                out[c]['monthly'] = {'ym': r.get('資料年月'), 'rev': num(r.get('營業收入-當月營收')), 'mom': num(r.get('營業收入-上月比較增減(%)')), 'yoy': num(r.get('營業收入-去年同月增減(%)')),
                                     'ytd': num(r.get('累計營業收入-當月累計營收')), 'ytd_yoy': num(r.get('累計營業收入-前期比較增減(%)')), 'note': (r.get('備註') or '').strip(), 'industry': r.get('產業別')}
        log('證交所月營收 OK')
    except Exception as e:  # noqa
        log('證交所月營收失敗', repr(e)[:120])
    try:
        for r in twse('/opendata/t187ap03_L'):
            c = str(r.get('公司代號', '')).strip()
            if c in out:
                out[c]['profile'] = {'full': (r.get('公司名稱') or '').strip(), 'chair': (r.get('董事長') or '').strip(), 'ceo': (r.get('總經理') or '').strip(), 'spokes': (r.get('發言人') or '').strip(),
                                     'est': (r.get('成立日期') or '').strip(), 'listed': (r.get('上市日期') or '').strip(), 'capital': num(r.get('實收資本額')), 'url': (r.get('網址') or '').strip(),
                                     'addr': (r.get('住址') or '').strip(), 'auditor': (r.get('簽證會計師事務所') or '').strip(), 'en': (r.get('英文簡稱') or '').strip()}
        log('證交所公司基本資料 OK')
    except Exception as e:  # noqa
        log('證交所公司基本資料失敗', repr(e)[:120])
    try:
        for r in twse('/exchangeReport/MI_MARGN'):
            c = str(r.get('股票代號', '')).strip()
            if c in out:
                out[c]['margin'] = {'fin': num(r.get('融資今日餘額')), 'fin_prev': num(r.get('融資前日餘額')), 'fin_lim': num(r.get('融資限額')), 'short': num(r.get('融券今日餘額')), 'short_prev': num(r.get('融券前日餘額'))}
        log('證交所融資融券 OK')
    except Exception as e:  # noqa
        log('證交所融資融券失敗', repr(e)[:120])
    try:
        for r in twse('/opendata/t187ap04_L'):
            c = str(r.get('公司代號', '')).strip()
            if c in out:
                out[c].setdefault('ann', []).append({'d': (r.get('發言日期') or '').strip(), 't': (r.get('主旨 ') or r.get('主旨') or '').strip(), 'body': (r.get('說明') or '').strip()[:600]})
        log('證交所重大訊息 OK')
    except Exception as e:  # noqa
        log('證交所重大訊息失敗', repr(e)[:120])
    try:
        rows = get('https://opendata.tdcc.com.tw/getOD.ashx?id=1-5', timeout=180).decode('utf-8-sig', 'replace').splitlines()
        for l in rows[1:]:
            p = l.split(',')
            if len(p) >= 6 and p[1].strip() in out:
                out[p[1].strip()].setdefault('dist', {'date': p[0], 'lv': {}})['lv'][p[2].strip()] = [num(p[3]), num(p[4]), num(p[5])]
        log('集保股權分散 OK')
    except Exception as e:  # noqa
        log('集保股權分散失敗', repr(e)[:120])
    try:
        links = {str(r.get('公司代號', '')).strip(): (r.get('前10大股東持股情形') or '').strip() for r in twse('/opendata/t187ap46_L_18')}
        for c in codes:
            u = links.get(c)
            if u:
                out[c]['top10_src'] = u
                try:
                    out[c]['top10'] = top10_pdf(u)
                except Exception as e:  # noqa
                    log('前10大股東 PDF 失敗', c, repr(e)[:120])
                time.sleep(0.3)
        log('前10大股東 PDF：', sum(1 for c in codes if out[c].get('top10')), '/', len(codes))
    except Exception as e:  # noqa
        log('前10大股東清單失敗', repr(e)[:120])
    return out


HDRW = {'股數', '持股比率', '持股比例', '持股', '比率', '比例', '名稱', '關係', '(%)', '股', '數', '名', '稱', '關', '係', '備', '註', '姓名', '姓', '備註', '%'}


def _is_hdr(line):
    toks = line.replace('\u3000', ' ').split()
    return (toks and all(t in HDRW for t in toks)) or bool(re.search(r'持有股份|相互間|親屬|配偶|名義|單位|其名稱|姓名及關係|^\(?%\)?$|年\s*\d+\s*月\s*\d+\s*日', line))


def parse_top10(text):
    """「前十大股東相互間關係表」：名稱可能跨好幾行，數字（股數、持股比例%）在名稱之後；表頭與換頁表頭略過。"""
    rows, buf = [], []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = re.match(r'^(.*?)\s*([\d,]{5,})\s+(\d+(?:\.\d+)?)\s*%', line)
        if m:
            name = re.sub(r'\s+', ' ', ''.join(buf) + m.group(1)).strip()
            ok = len(re.findall(r'[\u4e00-\u9fffA-Za-z0-9()（）&.,\- ]', name)) >= 0.8 * max(1, len(name))   # 字型沒有對照表的 PDF 會解出亂碼：整列不要
            if name and ok and re.search(r'[\u4e00-\u9fffA-Za-z]', name):
                rows.append({'name': name, 'shares': num(m.group(2)), 'pct': num(m.group(3))})
            buf = []
            if len(rows) >= 10:
                break
            continue
        if _is_hdr(line):
            buf = []
            continue
        buf.append(line)
    return rows


def top10_pdf(u):
    """證交所文件伺服器：先回一頁 HTML（內含真正 PDF 的連結），再下載 PDF 取文字。掃描圖檔或字型沒有對照表的 PDF 取不到文字，就只留連結。"""
    html = get(u, timeout=90).decode('big5', 'replace')
    m = re.search(r"href='(/pdf/[^']+\.pdf)'", html)
    if not m:
        return None
    pdf = get('https://doc.twse.com.tw' + m.group(1), timeout=120)
    from pypdf import PdfReader
    text = '\n'.join((p.extract_text() or '') for p in PdfReader(io.BytesIO(pdf)).pages)
    rows = parse_top10(text)
    asof = re.search(r'(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', text)
    return {'rows': rows, 'asof': f'{int(asof.group(1)) + 1911}-{int(asof.group(2)):02d}-{int(asof.group(3)):02d}' if asof else None, 'pdf': 'https://doc.twse.com.tw' + m.group(1)}


# ------------------------------------------------------------------ 指標
def last(a, k=1):
    v = [x for x in (a or []) if x is not None]
    return v[-k] if len(v) >= k else None


def sdiv(a, b):
    return a / b if (a is not None and b not in (None, 0)) else None


def avg2(a):
    v = [x for x in (a or [])[-2:] if x is not None]
    return sum(v) / len(v) if v else None


def series_ratio(A, k1, k2):
    return [sdiv(x, y) for x, y in zip(A.get(k1) or [], A.get(k2) or [])] if A.get(k1) and A.get(k2) else []


def metrics(A, T, px, cap, sector):
    """A＝年度表、T＝近四季、px＝價格統計、cap＝市值（報表幣別）。所有比率以小數表示。"""
    m = {}
    rev, ni, gp, opi = A.get('rev'), A.get('ni'), A.get('gp'), A.get('opi')
    r0, r1 = last(rev), last(rev, 2)
    m['rev_yoy'] = sdiv(r0, r1) - 1 if sdiv(r0, r1) else None
    rv = [x for x in (rev or []) if x]
    if len(rv) >= 4 and rv[-4] > 0 and rv[-1] > 0:
        m['rev_cagr3'] = (rv[-1] / rv[-4]) ** (1 / 3) - 1
    e0, e1 = last(A.get('eps')), last(A.get('eps'), 2)
    m['eps_yoy'] = (e0 / e1 - 1) if (e0 is not None and e1 and e1 > 0) else None
    gms = [x for x in series_ratio(A, 'gp', 'rev') if x is not None]
    oms = [x for x in series_ratio(A, 'opi', 'rev') if x is not None]
    m['gm'] = gms[-1] if gms else None
    m['gm_std'] = st.pstdev(gms) if len(gms) >= 3 else None
    m['gm_chg'] = gms[-1] - gms[0] if len(gms) >= 2 else None
    m['om'] = oms[-1] if oms else None
    m['om_std'] = st.pstdev(oms) if len(oms) >= 3 else None
    m['nm'] = sdiv(last(ni), r0)
    m['roe'] = sdiv(last(ni), avg2(A.get('eq'))) if (avg2(A.get('eq')) or 0) > 0 else None
    m['roa'] = sdiv(last(ni), avg2(A.get('ta')))
    # ROIC＝EBIT ×（1－有效稅率）÷ 投入資本；有效稅率＝所得稅 ÷ 稅前淨利，限制在 0～35%，算不出時用 21%
    roics = []
    for i in range(len(A.get('d') or [])):
        ebit = (A.get('ebit') or [None] * 99)[i] if A.get('ebit') else None
        if ebit is None and A.get('opi'):
            ebit = A['opi'][i]
        ic = (A.get('ic') or [None] * 99)[i] if A.get('ic') else None
        tax, pre = (A.get('tax') or [None] * 99)[i] if A.get('tax') else None, (A.get('pretax') or [None] * 99)[i] if A.get('pretax') else None
        tr = min(max(tax / pre, 0), 0.35) if (tax is not None and pre and pre > 0) else 0.21
        roics.append(ebit * (1 - tr) / ic if (ebit is not None and ic and ic > 0) else None)
    rr = [x for x in roics if x is not None]
    m['roic'] = rr[-1] if rr else None
    m['roic_avg'] = sum(rr) / len(rr) if rr else None
    m['fcf_margin'] = sdiv(last(A.get('fcf')), r0)
    m['cash_conv'] = sdiv(last(A.get('ocf')), last(ni)) if (last(ni) or 0) > 0 else None
    m['de'] = sdiv(last(A.get('debt')), last(A.get('eq'))) if (last(A.get('eq')) or 0) > 0 else None
    m['current'] = sdiv(last(A.get('ca')), last(A.get('cl')))
    ebit0 = last(A.get('ebit')) if A.get('ebit') else last(opi)
    ie = last(A.get('intexp'))
    m['int_cov'] = sdiv(ebit0, abs(ie)) if ie else None
    m['nd_ebitda'] = sdiv((last(A.get('debt')) or 0) - (last(A.get('cash')) or 0), last(A.get('ebitda'))) if (last(A.get('ebitda')) or 0) > 0 else None
    m['asset_turn'] = sdiv(r0, avg2(A.get('ta')))
    cogs = last(A.get('cogs'))
    m['inv_turn'] = sdiv(cogs, avg2(A.get('inv'))) if cogs and (avg2(A.get('inv')) or 0) > 0 else None
    m['dso'] = sdiv(last(A.get('ar')), r0) * 365 if sdiv(last(A.get('ar')), r0) is not None else None
    m['rnd_int'] = sdiv(last(A.get('rnd')), r0)
    m['sbc_int'] = sdiv(last(A.get('sbc')), r0)
    m['accruals'] = sdiv((last(ni) or 0) - (last(A.get('ocf')) or 0), avg2(A.get('ta'))) if last(A.get('ocf')) is not None and last(ni) is not None else None
    ret = -((last(A.get('buyback')) or 0) + (last(A.get('div')) or 0))   # 現金流量表的買回、股利是負數
    m['payout'] = sdiv(ret, last(ni)) if (last(ni) or 0) > 0 else None
    m['sh_yield'] = sdiv(ret, cap) if cap else None
    sh = [x for x in (A.get('shs') or []) if x]
    m['shs_chg'] = (sh[-1] / sh[-2] - 1) if len(sh) >= 2 else None
    # 估值（近四季）
    ni_t, rev_t, fcf_t, ebitda_t = T.get('ni'), T.get('rev'), T.get('fcf'), T.get('ebitda')
    m['pe'] = sdiv(cap, ni_t) if (ni_t or 0) > 0 else None
    m['ps'] = sdiv(cap, rev_t)
    ev = cap + (last(A.get('debt')) or 0) - (last(A.get('cash')) or 0) if cap else None
    m['ev_ebitda'] = sdiv(ev, ebitda_t) if (ebitda_t or 0) > 0 else None
    m['fcf_yield'] = sdiv(fcf_t, cap)
    m['pb'] = sdiv(cap, last(A.get('eq'))) if (last(A.get('eq')) or 0) > 0 else None
    # Piotroski F 分數（9 項，用最近兩個年度）
    f = []
    def two(k):
        v = A.get(k) or []
        return (v[-1], v[-2]) if len(v) >= 2 and v[-1] is not None and v[-2] is not None else (None, None)
    n1, n0 = two('ni'); t1, t0 = two('ta'); o1, _ = two('ocf'); d1, d0 = two('debt'); c1, c0 = two('ca'); l1, l0 = two('cl'); s1, s0 = two('shs'); g1, g0 = two('gp'); v1, v0 = two('rev')
    if n1 is not None and t1:
        f.append(('ROA 為正', n1 > 0))
    if o1 is not None:
        f.append(('營業現金流為正', o1 > 0))
    if None not in (n1, n0, t1, t0) and t1 and t0:
        f.append(('ROA 提升', n1 / t1 > n0 / t0))
    if None not in (o1, n1):
        f.append(('現金流大於淨利', o1 > n1))
    if None not in (d1, d0, t1, t0) and t1 and t0:
        f.append(('負債比下降', d1 / t1 <= d0 / t0))
    if None not in (c1, c0, l1, l0) and l1 and l0:
        f.append(('流動比提升', c1 / l1 > c0 / l0))
    if None not in (s1, s0):
        f.append(('沒有增發股數', s1 <= s0 * 1.005))
    if None not in (g1, g0, v1, v0) and v1 and v0:
        f.append(('毛利率提升', g1 / v1 > g0 / v0))
    if None not in (v1, v0, t1, t0) and t1 and t0:
        f.append(('資產周轉提升', v1 / t1 > v0 / t0))
    m['f_items'] = f
    m['f_score'] = sum(1 for _, ok in f if ok) if len(f) >= 7 else None
    # Altman Z（上市製造業版本；金融業不適用）
    if not re.search(r'金融|Financ|Bank|Insur', sector or '') and cap:
        ta, tl = last(A.get('ta')), last(A.get('tl'))
        wc = last(A.get('wc')) if A.get('wc') else ((last(A.get('ca')) or 0) - (last(A.get('cl')) or 0) if last(A.get('ca')) is not None else None)
        re_ = last(A.get('re'))
        if ta and tl and None not in (wc, re_, ebit0, r0):
            m['altman_z'] = 1.2 * wc / ta + 1.4 * re_ / ta + 3.3 * ebit0 / ta + 0.6 * cap / tl + 1.0 * r0 / ta
    m.update(px or {})
    return m


def px_stats(pts, bench):
    if len(pts) < 60:
        return {}
    c = [v for _, v in pts]
    lr = [math.log(c[i] / c[i - 1]) for i in range(1, len(c)) if c[i - 1] > 0 and c[i] > 0]
    out = {'ret_1y': c[-1] / c[0] - 1, 'vol_1y': st.pstdev(lr) * math.sqrt(252) if len(lr) > 20 else None, 'hi52': max(c), 'lo52': min(c), 'last_px': c[-1]}
    out['pos52'] = (c[-1] - out['lo52']) / (out['hi52'] - out['lo52']) if out['hi52'] > out['lo52'] else None
    out['dd52'] = c[-1] / out['hi52'] - 1
    if bench:
        bm = {dt.datetime.fromtimestamp(t, dt.timezone.utc).date(): v for t, v in bench[0]}
        pairs = [(bm.get(dt.datetime.fromtimestamp(t, dt.timezone.utc).date()), v) for t, v in pts]
        pairs = [(b, v) for b, v in pairs if b]
        if len(pairs) > 60:
            xs = [math.log(pairs[i][0] / pairs[i - 1][0]) for i in range(1, len(pairs))]
            ys = [math.log(pairs[i][1] / pairs[i - 1][1]) for i in range(1, len(pairs))]
            mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
            vx = sum((x - mx) ** 2 for x in xs)
            out['beta_1y'] = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / vx if vx else None
    return out


# ------------------------------------------------------------------ 分數（同一市場內百分位，0～100，越高越好）
DIMS = [  # (鍵, 名稱, [(指標, 方向)], 說明)
    ('share', '市占率', [('share', 1)], '本站涵蓋同產業公司營收合計中的占比'),
    ('monopoly', '壟斷性', [('rel_share', 1), ('share', 1)], '相對市占（本公司 ÷ 第二大）與市占率'),
    ('pricing', '訂價權', [('gm', 1), ('gm_std', -1), ('gm_chg', 1)], '毛利率水準、近年毛利率穩定度與變化'),
    ('moat', '護城河', [('roic_avg', 1), ('om', 1), ('om_std', -1)], '投入資本報酬率（近年平均）、營業利益率與穩定度'),
    ('growth', '成長性', [('rev_cagr3', 1), ('rev_yoy', 1), ('eps_yoy', 1)], '營收三年年化成長、營收與 EPS 年增'),
    ('profit', '獲利能力', [('om', 1), ('nm', 1), ('roe', 1)], '營業利益率、淨利率、ROE'),
    ('health', '財務體質', [('de', -1), ('current', 1), ('int_cov', 1), ('altman_z', 1)], '負債權益比、流動比、利息保障倍數、Altman Z'),
    ('cash', '現金流品質', [('fcf_margin', 1), ('cash_conv', 1), ('accruals', -1)], '自由現金流率、現金轉換、應計比率'),
    ('value', '估值吸引力', [('pe', -1), ('ps', -1), ('ev_ebitda', -1), ('fcf_yield', 1)], '本益比、股價營收比、EV/EBITDA 越低越好；自由現金流殖利率越高越好'),
    ('momentum', '股價動能', [('ret_1y', 1), ('pos52', 1)], '近 1 年報酬、目前價位在 52 週區間的位置'),
    ('risk', '低波動', [('vol_1y', -1), ('beta_1y', -1)], '年化波動、Beta 越低分數越高'),
    ('payback', '股東回饋', [('sh_yield', 1)], '（買回＋現金股利）÷ 市值'),
    ('innov', '研發投入', [('rnd_int', 1)], '研發費用 ÷ 營收'),
    ('eff', '營運效率', [('asset_turn', 1), ('inv_turn', 1)], '資產周轉率、存貨周轉率'),
]


def pct_rank(vals):
    """{code: v} → {code: 0～100 百分位}（同值取平均名次）。"""
    items = sorted((v, c) for c, v in vals.items() if v is not None and isinstance(v, (int, float)) and math.isfinite(v))
    n = len(items)
    out = {}
    if n < 2:
        return {c: 50.0 for _, c in items}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and items[j + 1][0] == items[i][0]:
            j += 1
        p = ((i + j) / 2) / (n - 1) * 100
        for k in range(i, j + 1):
            out[items[k][1]] = p
        i = j + 1
    return out


def main():
    args = sys.argv[1:]
    only = set(x.strip().upper() for x in (args[args.index('--codes') + 1] if '--codes' in args else '').split(',') if x.strip())
    limit = int(args[args.index('--limit') + 1]) if '--limit' in args else 0
    hm = json.load(open(os.path.join(ROOT, 'data', 'heatmap', 'latest.json'), encoding='utf-8'))
    uni = {}
    for key, S in hm['sets'].items():
        mk = S.get('market') or ('TW' if key == 'tw50' else 'US')
        for t in S['tiles']:
            u = uni.setdefault(t[0], {'code': t[0], 'name': t[1], 'sector': t[2], 'cap_bn': t[3], 'market': mk, 'sets': []})
            u['sets'].append(key)
    codes = [c for c in uni if (not only or c in only)]
    if limit:
        codes = codes[:limit]
    log('公司數', len(codes), '（宇宙', len(uni), '）')
    for c in uni:
        f = os.path.join(ROOT, 'data', 'fund', c + '.json')
        if os.path.isfile(f):
            try:
                d = json.load(open(f, encoding='utf-8'))
                uni[c]['industry'] = d.get('industry') or ''
                uni[c]['fund_name'] = d.get('name') or ''
            except Exception:
                pass
    # 基準指數（Beta 用）
    bench = {}
    for mk, sym in (('US', 'SPY'), ('TW', '0050.TW')):
        try:
            bench[mk] = price_1y(sym, mk)
        except Exception as e:  # noqa
            log('基準價失敗', sym, repr(e)[:100])

    def one(c):
        u = uni[c]
        sym = ysym(c, u['market'])
        rec = {'code': c}
        try:
            ts, rec['fin_cur'] = timeseries(sym)
            rec['A'] = table(ts, 'annual', ANNUAL, 5)
            rec['Q'] = table(ts, 'quarterly', QUARTER, 5)
            rec['T'] = {KEY[n]: (ts.get('trailing' + n) or [(None, None)])[-1][1] for n in TRAIL}
            rec['T_d'] = (ts.get('trailingTotalRevenue') or [(None, None)])[-1][0]
        except Exception as e:  # noqa
            rec['err_fin'] = repr(e)[:120]
        try:
            pts, meta, rec['p1y'] = price_1y(sym, u['market'])
            rec['px'] = px_stats(pts, bench.get(u['market']))
            rec['px_meta'] = {k: meta.get(k) for k in ('currency', 'longName', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow')}
        except Exception as e:  # noqa
            rec['err_px'] = repr(e)[:120]
        try:
            rec['p5y'], rec['divs'] = price_5y(sym)
        except Exception as e:  # noqa
            rec['err_p5y'] = repr(e)[:120]
        return c, rec

    got = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for c, rec in ex.map(one, codes):
            got[c] = rec
    log('財報取得', sum(1 for r in got.values() if r.get('A', {}).get('d')), '/', len(got), '；股價', sum(1 for r in got.values() if r.get('px')), '/', len(got))
    tw = tw_sources([c for c in codes if uni[c]['market'] == 'TW']) if any(uni[c]['market'] == 'TW' for c in codes) else {}
    # 報表幣別 ≠ 上市幣別（例：TSM 美國 ADR 的財報是台幣）→ 換算成上市幣別再算估值與跨公司比較
    LST = {'US': 'USD', 'TW': 'TWD'}
    pairs = {(r.get('fin_cur'), LST[uni[c]['market']]) for c, r in got.items() if r.get('fin_cur') and r.get('fin_cur') != LST[uni[c]['market']]}
    FX = {}
    for fin, lst in pairs:
        try:
            FX[(fin, lst)] = fx_rate(fin, lst)
        except Exception as e:  # noqa
            log('匯率失敗', fin, lst, repr(e)[:100])
    log('匯率', {f'{a}→{b}': v for (a, b), v in FX.items()})
    for c, r in got.items():
        lst = LST[uni[c]['market']]
        r['fx'] = 1.0 if (not r.get('fin_cur') or r['fin_cur'] == lst) else FX.get((r['fin_cur'], lst))

    # 持有本股的 ETF（投資組合透視每日持股檔反查；台積電 ADR 在美國 ETF 持股檔記為 2330）
    etf_by = {}
    try:
        alias = json.load(open(os.path.join(ROOT, 'data', 'lt', 'universe.json'), encoding='utf-8')).get('alias') or {}
    except Exception:
        alias = {}
    tw2adr = {v: k for k, v in alias.items() if re.fullmatch(r'\d{4,6}', v) and re.fullmatch(r'[A-Z]{1,5}', k)}
    for f in sorted(os.listdir(os.path.join(ROOT, 'data', 'lt', 'etf'))):
        if not f.endswith('.json'):
            continue
        try:
            j = json.load(open(os.path.join(ROOT, 'data', 'lt', 'etf', f), encoding='utf-8'))
        except Exception:
            continue
        ecode = j.get('code') or f[:-5]
        emk = 'TW' if re.match(r'^\d', ecode) else 'US'
        for h in j.get('h') or []:
            try:
                hc = re.sub(r'^X:[^:]+:', '', str(h[0] or '')).replace(' ', '-').upper(); w = float(h[1])
            except Exception:
                continue
            if emk == 'US':
                hc = tw2adr.get(hc, hc)
            if hc in got and uni[hc]['market'] == emk and w > 0:
                etf_by.setdefault(hc, []).append([ecode, j.get('name') or '', round(w, 4), j.get('asof')])
    for c in etf_by:
        etf_by[c].sort(key=lambda x: -x[2])
    log('ETF 反查：', sum(1 for c in got if c in etf_by), '家公司有 ETF 持有')
    # 指標
    M = {}
    for c, r in got.items():
        u = uni[c]
        cap = (u['cap_bn'] or 0) * 1e9
        dv = r.get('divs') or []
        if dv and (r.get('px') or {}).get('last_px'):
            cut = (NOW - dt.timedelta(days=365)).strftime('%Y-%m-%d')
            r.setdefault('px', {})['div_ttm'] = sum(a for d, a in dv if d > cut)
        if r.get('fx') is None:   # 換不了匯率：只算與幣別無關的比率
            M[c] = metrics(r.get('A') or {}, {}, r.get('px') or {}, None, u['sector'] + ' ' + u.get('industry', ''))
        else:
            M[c] = metrics(conv(r.get('A') or {}, r['fx']), conv(r.get('T') or {}, r['fx']), r.get('px') or {}, cap, u['sector'] + ' ' + u.get('industry', ''))
    # 產業市占（同一市場、同一產業；最新年度營收）
    groups = {}
    for c in got:
        u = uni[c]
        g = (u['market'], u.get('industry') or u['sector'])
        rv = last((got[c].get('A') or {}).get('rev'))
        rv = rv * got[c]['fx'] if (rv and got[c].get('fx')) else None
        if rv and rv > 0:
            groups.setdefault(g, []).append((c, rv))
    for g, lst in groups.items():
        tot = sum(v for _, v in lst)
        lst.sort(key=lambda x: -x[1])
        hhi = sum((v / tot * 100) ** 2 for _, v in lst)
        for i, (c, v) in enumerate(lst):
            oth = [x for x in lst if x[0] != c]
            M[c]['share'] = v / tot
            M[c]['rel_share'] = v / oth[0][1] if oth else None
            M[c]['ind'] = {'group': g[1], 'n': len(lst), 'rank': i + 1, 'hhi': round(hhi), 'top': [[x, uni[x]['name'], round(y / tot, 4)] for x, y in lst[:8]]}
    # 分數：同一市場內百分位
    S = {c: {} for c in got}
    for mk in ('US', 'TW'):
        cs = [c for c in got if uni[c]['market'] == mk]
        for key, _, comps, _ in DIMS:
            parts = []
            for metric, sign in comps:
                pr = pct_rank({c: (M[c].get(metric) * sign if M[c].get(metric) is not None else None) for c in cs})
                parts.append(pr)
            for c in cs:
                v = [p[c] for p in parts if c in p]
                S[c][key] = round(sum(v) / len(v), 1) if v else None
    # 同業（同一市場、同一產業，市值最大的 5 家；不足用同一大類補）
    os.makedirs(OUT, exist_ok=True)
    U = []
    for c, r in got.items():
        u = uni[c]
        g = u.get('industry') or u['sector']
        same = sorted([x for x in got if x != c and uni[x]['market'] == u['market'] and (uni[x].get('industry') or uni[x]['sector']) == g], key=lambda x: -(uni[x]['cap_bn'] or 0))
        if len(same) < 5:
            same += sorted([x for x in got if x != c and x not in same and uni[x]['market'] == u['market'] and uni[x]['sector'] == u['sector']], key=lambda x: -(uni[x]['cap_bn'] or 0))
        peers = same[:5]
        m = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in M[c].items()}
        out = {'schema': 'bnasdaq-company/1', 'code': c, 'name': u['name'], 'market': u['market'], 'cur': 'TWD' if u['market'] == 'TW' else 'USD', 'sector': u['sector'], 'industry': u.get('industry') or '',
               'updated': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'), 'cap_bn': u['cap_bn'], 'fin_cur': r.get('fin_cur'), 'fx': r.get('fx'), 'A': r.get('A'), 'Q': r.get('Q'), 'T': r.get('T'), 'T_d': r.get('T_d'), 'm': m, 's': S[c], 'peers': peers,
               'tw': tw.get(c) or None, 'err': {k: v for k, v in r.items() if k.startswith('err_')} or None,
               'p1y': r.get('p1y'), 'p5y': r.get('p5y'), 'divs': r.get('divs'), 'bench': 'SPY' if u['market'] == 'US' else '0050',
               'etfs': (etf_by.get(c) or [])[:15], 'etf_n': len(etf_by.get(c) or []),
               'src': [{'t': '財報：Yahoo Finance（fundamentals-timeseries，年度、季度、近四季）', 'u': f'https://finance.yahoo.com/quote/{ysym(c, u["market"])}/financials'},
                       {'t': '股價：Yahoo Finance 近 1 年日線（還原權息）', 'u': f'https://finance.yahoo.com/quote/{ysym(c, u["market"])}/history'}]}
        if u['market'] == 'TW':
            out['src'] += [{'t': '董監事持股、逾 10% 大股東、每月營收、前 10 大股東持股情形：臺灣證券交易所 OpenAPI', 'u': 'https://openapi.twse.com.tw/'},
                           {'t': '股權分散（千張大戶）：臺灣集中保管結算所 開放資料', 'u': 'https://opendata.tdcc.com.tw/'}]
        json.dump(out, open(os.path.join(OUT, c + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        U.append([c, u['name'], u['market'], g, u['cap_bn'], S[c], {k: m.get(k) for k in ('share', 'rel_share', 'gm', 'om', 'roic_avg', 'rev_cagr3', 'pe', 'ret_1y')}])
    if not only:
        json.dump({'schema': 'bnasdaq-company-universe/1', 'updated': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'), 'dims': [[k, n, d] for k, n, _, d in DIMS], 'list': U},
                  open(os.path.join(OUT, '_universe.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    log('寫入', len(got), '家；', OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
