#!/usr/bin/env python3
"""BNASDAQ｜個股對比資料：台股（上市／上櫃股票與 ETF）與美股（S&P 500、Nasdaq-100、常見 ETF 與熱門個股），
為每一檔預先算好本站兩段對比期間的結果，存成 data/tw/<代號>.json（目錄名沿用）。

兩段期間（都讀 assets/data.js 的 SITE）：
  W13（個股對比頁）：SITE.six.window，台幣含息（例 2013-12-31 → 2026-09-30）→ JSON 頂層欄位（與舊版相容）
  W26（研究與回測頁）：SITE.window，美元含息（例 2000-05-31 → 2026-09-30）→ JSON 的 w26 區塊
匯率：FRED DEXTAUS（每日，台幣／美元；備援 Yahoo TWD=X），缺日向前補；台股→美元 ＝ ÷ 匯率、美股→台幣 ＝ × 匯率。
價格：Yahoo Finance 還原收盤（股息再投入、分割還原）；Yahoo 台股歷史的三類已知錯誤自動修正並記錄在 adj_fixes。
指標：單筆 100 萬期末與年化（年數＝日數÷365.25）、逐年報酬、最深跌幅＋回本倍數、各段大跌區間報酬、
      月底序列（W26 對齊 SITE.window.months）、W26 另有各區間年化（SITE.periods）。上市較晚者自第一個交易日起算並標 partial。

用法：
  python3 scripts/fetch_stocks.py --codes 0050,2330,QQQ,AAPL
  python3 scripts/fetch_stocks.py --all [--budget-sec N] [--force]
"""
import json, os, re, sys, time, math, csv, io, datetime as dt, urllib.request, urllib.error, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'data', 'tw')
DATA_JS = os.path.join(ROOT, 'assets', 'data.js')
UA = {'User-Agent': 'Mozilla/5.0 (BNASDAQ stocks fetch)'}
TPE = dt.timezone(dt.timedelta(hours=8))
NYT = dt.timezone(dt.timedelta(hours=-4))
BASE_TW = {'0050': 'tw', '2330': 'tsmc'}   # 本站原本就有的兩檔（證交所資料），用來核對口徑
US_ETFS = ['SPY', 'VOO', 'IVV', 'VTI', 'QQQ', 'QQQM', 'QLD', 'TQQQ', 'SSO', 'UPRO', 'DIA', 'IWM', 'VGT', 'XLK', 'SMH', 'SOXX', 'SOXL',
           'ARKK', 'ARKW', 'ARKG', 'VYM', 'SCHD', 'JEPI', 'JEPQ', 'VNQ', 'GLD', 'IAU', 'SLV', 'TLT', 'IEF', 'SHV', 'BIL', 'SGOV', 'AGG', 'BND',
           'VXUS', 'VEA', 'VWO', 'EEM', 'EFA', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC', 'VUG', 'VTV', 'IWF',
           'IWD', 'MTUM', 'QUAL', 'USMV', 'SPLG', 'RSP', 'ITOT', 'SCHX', 'SCHG', 'SCHB', 'VOOG', 'VOOV', 'IBIT', 'KWEB', 'FXI', 'EWT', 'EWJ',
           'INDA', 'BOTZ', 'COWZ', 'DGRO', 'DVY', 'HDV', 'SPYD', 'SPHD', 'NOBL', 'VIG', 'VB', 'VO', 'IJR', 'IJH', 'MDY', 'QYLD', 'XYLD',
           'TSLL', 'NVDL', 'SPXL', 'TECL', 'FNGU', 'VT', 'ACWI', 'IEMG', 'BRK-B']
US_EXTRA = ['TSM', 'BABA', 'ASML', 'ARM', 'COIN', 'MSTR', 'SMCI', 'RIVN', 'NIO', 'PDD', 'JD', 'BIDU', 'SHOP', 'SPOT', 'SNOW', 'DDOG', 'NET',
            'MDB', 'ZS', 'RBLX', 'U', 'SOFI', 'HOOD', 'DKNG', 'LCID', 'PLUG', 'ENPH', 'SEDG', 'TTD', 'ROKU', 'XYZ', 'AFRM', 'UPST', 'CELH',
            'ELF', 'ONON', 'NVO', 'SAP', 'UMC', 'ASX', 'APP', 'DELL', 'HPE', 'WDC', 'STX', 'PSTG', 'MRVL', 'LRCX', 'AMAT', 'KLAC', 'ARM',
            'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'AVGO', 'AMD', 'INTC', 'MU', 'QCOM', 'TXN', 'ADBE', 'CRM',
            'ORCL', 'NFLX', 'COST', 'WMT', 'JPM', 'V', 'MA', 'LLY', 'UNH', 'XOM', 'CVX', 'PLTR', 'CRWD', 'PANW', 'ANET', 'VRT', 'GEV']


def log(*a):
    print('[fetch_stocks]', *a, flush=True)


def _get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def load_site():
    s = open(DATA_JS, encoding='utf-8').read()
    m = re.search(r'window\.SITE\s*=\s*(\{.*\});?\s*$', s, re.S)
    return json.loads(m.group(1))


# ------------------------------------------------------------------ universe：台股
SECTION_RE = re.compile(r'<tr><td[^>]*colspan=7[^>]*><B>\s*([^<]+?)\s*<B?>?', re.I)
ROW_RE = re.compile(r'<tr><td[^>]*>([0-9A-Z]{4,6})　([^<]+)</td><td[^>]*>[^<]*</td><td[^>]*>(\d{4}/\d{2}/\d{2})</td><td[^>]*>([^<]*)</td>', re.I)


def parse_isin(html_text, market):
    """回傳 [(code, name, market, listdate)]，只取「股票」與「ETF」區段。"""
    out, section = [], None
    for m in re.finditer(r'<tr>.*?</tr>', html_text, re.S):
        row = m.group(0)
        sm = SECTION_RE.search(row)
        if sm:
            section = sm.group(1).strip(); continue
        if section not in ('股票', 'ETF'):
            continue
        rm = ROW_RE.search(row)
        if not rm:
            continue
        code, name, listdate = rm.group(1).strip(), rm.group(2).strip(), rm.group(3).replace('/', '-')
        out.append((code, name, market, listdate))
    return out


def fetch_universe_tw():
    allrows = []
    for mode, market in ((2, 'TW'), (4, 'TWO')):
        url = f'https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}'
        text = _get(url, timeout=90).decode('cp950', errors='replace')
        rows = parse_isin(text, market)
        log('isin', market, len(rows), 'rows')
        allrows += rows
    seen, uniq = set(), []
    for r in allrows:
        if r[0] in seen:
            continue
        seen.add(r[0]); uniq.append(r)
    return uniq


# ------------------------------------------------------------------ universe：美股
TD_RE = re.compile(r'<td[^>]*>(.*?)</td>', re.S)
TAG_RE = re.compile(r'<[^>]+>')


def _cells(row_html):
    return [TAG_RE.sub('', c).replace('&amp;', '&').strip() for c in TD_RE.findall(row_html)]


def parse_wiki_table(html_text, sym_col, name_col, must_header):
    """找第一個表頭含 must_header 的表格，回傳 [(symbol, name)]"""
    out = []
    for tbl in re.findall(r'<table[^>]*>.*?</table>', html_text, re.S):
        if must_header not in tbl:
            continue
        for tr in re.findall(r'<tr>.*?</tr>', tbl, re.S):
            cells = _cells(tr)
            if len(cells) <= max(sym_col, name_col):
                continue
            sym = cells[sym_col].strip().upper().replace('.', '-')
            if re.fullmatch(r'[A-Z]{1,5}(-[A-Z])?', sym):
                out.append((sym, cells[name_col].strip()))
        if out:
            break
    return out


def fetch_universe_us():
    names = {}
    try:
        t = _get('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', timeout=60).decode('utf-8', errors='replace')
        for s, n in parse_wiki_table(t, 0, 1, 'Symbol'):
            names.setdefault(s, n)
        log('wiki sp500', len(names))
    except Exception as e:  # noqa
        log('wiki sp500 failed:', repr(e))
    try:
        t = _get('https://en.wikipedia.org/wiki/Nasdaq-100', timeout=60).decode('utf-8', errors='replace')
        n0 = len(names)
        for s, n in parse_wiki_table(t, 1, 0, 'Ticker'):
            names.setdefault(s, n)
        log('wiki ndx100 +', len(names) - n0)
    except Exception as e:  # noqa
        log('wiki ndx100 failed:', repr(e))
    for s in US_ETFS + US_EXTRA:
        names.setdefault(s, '')
    return [(s, n, 'US', '') for s, n in sorted(names.items())]


# ------------------------------------------------------------------ 匯率（台幣／美元，每日）
def load_fx():
    """回傳排序好的 [(date, rate)]；FRED DEXTAUS 優先，備援 Yahoo TWD=X。"""
    try:
        raw = _get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXTAUS', timeout=60).decode('utf-8')
        out = []
        for rec in csv.DictReader(io.StringIO(raw)):
            d = rec.get('observation_date') or rec.get('DATE'); v = rec.get('DEXTAUS')
            try:
                if d and v and v != '.':
                    out.append((dt.date.fromisoformat(d), float(v)))
            except Exception:
                pass
        if len(out) > 1000:
            log('fx FRED', len(out), out[0], out[-1]); return out, 'FRED DEXTAUS（每日）'
    except Exception as e:  # noqa
        log('fx FRED failed:', repr(e))
    rows, _ = fetch_yahoo('TWD=X', None, dt.date(1999, 1, 1), dt.date.today())
    out = [(d, c) for d, c, a in rows]
    log('fx Yahoo TWD=X', len(out)); return out, 'Yahoo TWD=X（每日）'


def fx_lookup(fx, d):
    lo, hi = 0, len(fx)
    while lo < hi:
        mid = (lo + hi) // 2
        if fx[mid][0] <= d:
            lo = mid + 1
        else:
            hi = mid
    i = max(0, lo - 1)
    return fx[i][1]


# ------------------------------------------------------------------ yahoo
def fetch_yahoo(code, market, start, end):
    p1 = int(dt.datetime.combine(start - dt.timedelta(days=95), dt.time(), tzinfo=TPE).timestamp())
    p2 = int(dt.datetime.combine(end + dt.timedelta(days=1), dt.time(), tzinfo=TPE).timestamp())
    sym = code if market in (None, 'US') else f'{code}.{market}'
    url = (f'https://query2.finance.yahoo.com/v8/finance/chart/{urllib.request.quote(sym)}?period1={p1}&period2={p2}'
           f'&interval=1d&events=div%2Csplit&includeAdjustedClose=true')
    for attempt in range(4):
        try:
            j = json.loads(_get(url))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise RuntimeError('yahoo 404 (no such symbol)')
            if e.code == 429 or e.code >= 500:
                time.sleep(30 * (attempt + 1)); continue
            raise
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    else:
        raise RuntimeError('yahoo retries exhausted')
    res = j.get('chart', {}).get('result')
    if not res:
        raise RuntimeError('yahoo empty result: ' + str(j.get('chart', {}).get('error')))
    res = res[0]
    tz = NYT if market in (None, 'US') else TPE
    ts = res.get('timestamp') or []
    q = res['indicators']['quote'][0]
    adj = res['indicators'].get('adjclose', [{}])[0].get('adjclose') or [None] * len(ts)
    rows = []
    for i, t in enumerate(ts):
        c, a = q['close'][i], adj[i]
        if c is None or a is None or c <= 0 or a <= 0:
            continue
        d = dt.datetime.fromtimestamp(t, tz=tz).date()
        rows.append((d, float(c), float(a)))
    rows.sort()
    splits = []
    for ev in (res.get('events') or {}).get('splits', {}).values():
        try:
            num, den = float(ev.get('numerator')), float(ev.get('denominator'))
            if num > 0 and den > 0:
                splits.append((dt.datetime.fromtimestamp(int(ev['date']), tz=tz).date(), den / num))
        except Exception:
            pass
    return rows, splits


# ------------------------------------------------------------------ 清理與指標（純函式）
def _at_or_before(rows, d):
    """index of last row with date <= d, or -1"""
    lo, hi = 0, len(rows)
    while lo < hi:
        mid = (lo + hi) // 2
        if rows[mid][0] <= d:
            lo = mid + 1
        else:
            hi = mid
    return lo - 1


def clean_raw(rows, splits):
    """Yahoo 台股歷史常見錯誤：原始收盤與還原收盤在同一天同時跳 1/4、1/2、2、4 倍，但那天並沒有分割事件
    （例 0050 的 2013-12-31 → 2014-01-02）。處理：那天之前的原始收盤與還原收盤整段乘上 k，使序列連續；
    k 取事件清單中最接近的分割倍率（15% 內），否則取當天原始收盤比值。真正的分割日（±5 日內有事件）不處理。"""
    rows = [list(r) for r in rows]
    split_days = [d for d, _ in splits]
    cands = set()
    for _, f in splits:
        cands.add(f); cands.add(1 / f)
    fixes = []
    for i in range(len(rows) - 1, 0, -1):
        d, c, a = rows[i]; d0, c0, a0 = rows[i - 1]
        if c0 <= 0 or c <= 0:
            continue
        r_close = c / c0
        if 0.5 <= r_close <= 2.0:
            continue
        if any(abs((d - sd).days) <= 5 for sd in split_days):
            continue
        k = r_close
        for f in cands:
            if abs(r_close / f - 1) <= 0.15:
                k = f; break
        for j in range(i):
            rows[j][1] *= k; rows[j][2] *= k
        fixes.append(('raw', d.isoformat(), round(k, 6)))
    return [tuple(r) for r in rows], fixes


def clean_div(rows, factors):
    """Yahoo 的除息還原偶爾把「分割前單位」的股息套在「分割後單位」的價格上（例 0050 2014-10 把 1.55 元套在 ÷4 後的 16 元價格，
    變成 9.4% 的除息還原，實際只有 2.3%）。偵測：某天還原報酬÷原始報酬換算出的「股息率」> 6%，但當天原始收盤只跌不到
    該股息率 − 4pp（除息日參考價會直接扣掉股息，原始收盤理應跌差不多）；若股息率乘上某個分割倍率（0.5／0.25／0.2／0.1
    （只用 clean_raw 或分割事件實際出現過的倍率）後與當天實際跌幅相差 ≤ 1.5pp，就改用那個數字重算之前的還原值。"""
    rows = [list(r) for r in rows]
    cands = set(f for f in factors if 0 < f < 1)   # 只用這檔實際出現過的單位倍率，避免誤修真正的高股息
    fixes = []
    for i in range(len(rows) - 1, 0, -1):
        d, c, a = rows[i]; d0, c0, a0 = rows[i - 1]
        if c0 <= 0 or a0 <= 0 or c <= 0:
            continue
        q = (a / a0) / (c / c0)
        if q <= 1:
            continue
        d_claim = 1 - 1 / q
        observed = 1 - c / c0
        if d_claim < 0.05 or d_claim - observed < 0.04:
            continue
        best = None
        for f in cands:
            dn = d_claim * f
            if abs(dn - observed) <= 0.015 and (best is None or abs(dn - observed) < abs(best - observed)):
                best = dn
        if best is None:
            continue
        k = (1 - best) / (1 - d_claim)
        for j in range(i):
            rows[j][2] *= k
        fixes.append(('div', d.isoformat(), round(d_claim, 4), round(best, 4)))
    return [tuple(r) for r in rows], fixes


def clean_adj(rows):
    """修掉 Yahoo 還原收盤在分割／除權邊界常見的錯誤：某一天還原序列暴跌或暴漲（|還原日報酬| > 50%），
    但原始收盤當天幾乎沒動（在 0.7～1.4 之間）→ 這天之前的還原值整段乘上修正倍率，使還原日報酬等於原始日報酬。
    台股有 10% 漲跌幅限制，真正的還原日報酬不可能超過 ±50%；真正的分割是原始收盤跳、還原值不跳，不會被誤判。
    回傳 (new_rows, fixes)；fixes 為修正日期與倍率清單。"""
    rows = [list(r) for r in rows]
    fixes = []
    for i in range(len(rows) - 1, 0, -1):
        d, c, a = rows[i]; d0, c0, a0 = rows[i - 1]
        if c0 <= 0 or a0 <= 0:
            continue
        r_adj, r_close = a / a0, c / c0
        if (r_adj < 0.5 or r_adj > 2.0) and 0.7 <= r_close <= 1.4:
            k = r_adj / r_close            # 之前的還原值要乘上 k
            for j in range(i):
                rows[j][2] *= k
            fixes.append((d.isoformat(), round(k, 6)))
    return [tuple(r) for r in rows], fixes



def convert(rows, fx, mode):
    """mode 'to_usd'：adj ÷ 匯率；'to_twd'：adj × 匯率；close 保持原幣。"""
    out = []
    for d, c, a in rows:
        r = fx_lookup(fx, d)
        out.append((d, c, a / r if mode == 'to_usd' else a * r))
    return out


def compute_block(rows, start, end, crises, periods=None, months=None):
    """rows 已是目標幣別且已清理：[(date, close_native, adj_target)]。"""
    rows = [r for r in rows if r[0] <= end]
    if len(rows) < 20:
        raise RuntimeError(f'too few rows ({len(rows)})')
    i0 = _at_or_before(rows, start)
    partial = False
    if i0 < 0:
        i0 = 0; partial = True
    i1 = len(rows) - 1
    d0, a0 = rows[i0][0], rows[i0][2]
    d1, a1 = rows[i1][0], rows[i1][2]
    partial_end = d1 < end - dt.timedelta(days=35)
    years = (d1 - d0).days / 365.25
    if years <= 0:
        raise RuntimeError('window too short')
    ratio = a1 / a0
    lump = 1_000_000 * ratio
    cagr = ratio ** (1 / years) - 1
    annual = {}
    for y in range(d0.year + 1, d1.year + 1):
        ib = _at_or_before(rows, dt.date(y - 1, 12, 31))
        if ib < i0 or rows[ib][0] < d0:
            annual[str(y)] = None; continue
        ie = i1 if y == d1.year else _at_or_before(rows, dt.date(y, 12, 31))
        annual[str(y)] = round(rows[ie][2] / rows[ib][2] - 1, 6)
    runmax, runmax_d, mdd, peak_d, trough_d = -1.0, None, 0.0, None, None
    for d, c, a in rows[i0:i1 + 1]:
        if a > runmax:
            runmax, runmax_d = a, d
        dd = a / runmax - 1
        if dd < mdd:
            mdd, peak_d, trough_d = dd, runmax_d, d
    # 回本日：低點後第一次回到前高
    recover_d = None
    if trough_d:
        it = _at_or_before(rows, trough_d); pk = max(a for d, c, a in rows[i0:it + 1])
        for d, c, a in rows[it + 1:i1 + 1]:
            if a >= pk:
                recover_d = d; break
    need = 1 / (1 + mdd) if mdd > -1 else None
    cr = {}
    for c in crises:
        p, t = dt.date.fromisoformat(c['peak']), dt.date.fromisoformat(c['trough'])
        ip, it = _at_or_before(rows, p), _at_or_before(rows, t)
        if ip < i0 or it < i0 or ip < 0 or rows[ip][0] < p - dt.timedelta(days=7) or p < d0:
            cr[c['name']] = None
        else:
            cr[c['name']] = round(rows[it][2] / rows[ip][2] - 1, 6)
    per = {}
    for pdef in (periods or []):
        ps = dt.date.fromisoformat(pdef['start'])
        ip = _at_or_before(rows, ps)
        if ps < d0 or ip < i0 or rows[ip][0] < ps - dt.timedelta(days=7):
            per[pdef['name']] = None; continue
        yrs = (d1 - rows[ip][0]).days / 365.25
        per[pdef['name']] = round((a1 / rows[ip][2]) ** (1 / yrs) - 1, 6) if yrs > 0 else None
    if months:   # 對齊固定月份清單
        bym = {}
        for d, c, a in rows[i0:i1 + 1]:
            bym[d.strftime('%Y-%m')] = a / a0
        monthly = [round(bym[m], 5) if m in bym else None for m in months]
    else:
        monthly, lastm = [], None
        for d, c, a in rows[i0:i1 + 1]:
            key = d.strftime('%Y-%m')
            if lastm != key:
                monthly.append([key, round(a / a0, 5)]); lastm = key
            else:
                monthly[-1][1] = round(a / a0, 5)
    return dict(start_used=d0.isoformat(), end_used=d1.isoformat(), partial=partial, partial_end=partial_end,
                years=round(years, 4), lump=round(lump, 0), cagr=round(cagr, 6), annual=annual,
                mdd=dict(mdd=round(mdd, 6), peak=peak_d.isoformat() if peak_d else None, trough=trough_d.isoformat() if trough_d else None,
                         recover=recover_d.isoformat() if recover_d else None, need=round(need, 4) if need else None),
                crises=cr, periods=per, monthly=monthly, last_close=rows[i1][1], n_days=i1 - i0 + 1)


def build_record(code, rec, rows, splits, fx, site):
    """rec=[code,name,market,listed]；rows 原幣原始列。回傳整筆 JSON。"""
    start13, end13 = (dt.date.fromisoformat(x) for x in site['six']['window'])
    start26, end26 = dt.date.fromisoformat(site['window']['start']), dt.date.fromisoformat(site['window']['end'])
    crises = [dict(name=c['name'], peak=c['peak'], trough=c['trough']) for c in site['crises']]
    periods = [dict(name=p['name'], start=p['start']) for p in site['periods']]
    market = rec[2]
    raw_rows = rows
    rows, fixes_raw = clean_raw(rows, list(splits))
    rows, fixes = clean_adj(rows)
    rows, fixes_div = clean_div(rows, [f[2] for f in fixes_raw] + [f for _, f in splits])
    fixes = fixes_raw + [('adj',) + f for f in fixes] + fixes_div
    if market == 'US':
        rows13 = convert(rows, fx, 'to_twd'); rows26 = rows; currency = 'USD'
    else:
        rows13 = rows; rows26 = convert(rows, fx, 'to_usd'); currency = 'TWD'
    b13 = compute_block(rows13, start13, end13, crises)
    try:
        b26 = compute_block(rows26, start26, end26, crises, periods, site['window']['months'])
    except Exception as e:  # noqa
        b26 = dict(error=repr(e)[:200])
    k0 = _at_or_before(raw_rows, start13)
    boundary = [[r[0].isoformat(), round(r[1], 3), round(r[2], 4)] for r in raw_rows[max(0, k0 - 3):k0 + 4]]
    fxinfo = dict(start13=fx_lookup(fx, start13), end13=fx_lookup(fx, end13), start26=fx_lookup(fx, start26), end26=fx_lookup(fx, end26))
    out = dict(schema='bnasdaq-stock/2', code=code, name=rec[1] if rec[1] != code else '', market=market, currency=currency,
               listed=rec[3] or None, window=[start13.isoformat(), end13.isoformat()], updated=dt.date.today().isoformat(),
               source='Yahoo Finance 還原收盤（含息、分割還原）' + ('，以 FRED 每日匯率換算台幣' if market == 'US' else ''),
               fx=fxinfo, adj_fixes=fixes, boundary_raw=boundary, **b13)
    out['w26'] = dict(window=[start26.isoformat(), end26.isoformat()], currency='USD', **b26)
    return out


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--codes', default='')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--budget-sec', type=int, default=19000)
    ap.add_argument('--sleep', type=float, default=0.4)
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    site = load_site()
    end13 = site['six']['window'][1]
    log('windows', site['six']['window'], [site['window']['start'], site['window']['end']])

    index_path = os.path.join(OUT_DIR, 'index.json')
    index = json.load(open(index_path, encoding='utf-8')) if os.path.exists(index_path) else dict(list=[])
    names = {r[0]: list(r[:4]) for r in index.get('list', [])}
    if args.all:
        try:
            uni = fetch_universe_tw() + fetch_universe_us()
            names = {r[0]: list(r) for r in uni}
            log('universe', len(names))
        except Exception as e:  # noqa
            log('universe fetch failed, using existing index:', repr(e))
            if not names:
                return 1
    fx, fx_src = load_fx()
    want = [c.strip().upper().replace('.', '-') for c in args.codes.split(',') if c.strip()] if args.codes else list(names.keys())
    for c in want:
        if c not in names:
            names[c] = [c, '', 'US' if re.fullmatch(r'[A-Z]{1,5}(-[A-Z])?', c) else 'TW', '']
    want = [c for c in want if not (names.get(c, ['', '', '', ''])[3] and names[c][3] > end13)]

    errors_path = os.path.join(OUT_DIR, '_errors.json')
    errors = json.load(open(errors_path, encoding='utf-8')) if os.path.exists(errors_path) else {}
    t0 = time.time(); done = skipped = failed = unchanged = 0
    today = dt.date.today().isoformat()
    for n, code in enumerate(want):
        if time.time() - t0 > args.budget_sec:
            log('budget reached; stopping at', n, '/', len(want)); break
        path = os.path.join(OUT_DIR, f'{code}.json')
        old = None
        if os.path.exists(path):
            try:
                old = json.load(open(path, encoding='utf-8'))
            except Exception:
                old = None
        if old and not args.force and old.get('schema') == 'bnasdaq-stock/2' and old.get('window', [None, None])[1] == end13 \
                and (today[:7] == old.get('updated', '')[:7]):
            skipped += 1; continue
        rec = names[code]
        markets = ['US'] if rec[2] == 'US' else [rec[2]] + [m for m in ('TW', 'TWO') if m != rec[2]]
        rows, splits, used_market, err = None, [], None, None
        for mk in markets:
            try:
                rows, splits = fetch_yahoo(code, mk, dt.date.fromisoformat(site['window']['start']), dt.date.fromisoformat(end13)); used_market = mk
                if rows and len(rows) >= 20:
                    break
                rows = None
            except Exception as e:  # noqa
                err = repr(e); rows = None
            time.sleep(args.sleep)
        if not rows:
            errors[code] = dict(error=err or 'no data', when=today); failed += 1
            log('FAIL', code, err); continue
        try:
            rec2 = [code, rec[1], used_market, rec[3]]
            out = build_record(code, rec2, rows, splits, fx, site)
            if code in BASE_TW or code == 'QQQ':
                json.dump(dict(code=code, splits=[[d.isoformat(), f] for d, f in splits],
                               rows=[[r[0].isoformat(), round(r[1], 4), round(r[2], 5)] for r in rows]),
                          open(os.path.join(OUT_DIR, f'_debug_{code}.json'), 'w', encoding='utf-8'), separators=(',', ':'))
        except Exception as e:  # noqa
            errors[code] = dict(error='compute: ' + repr(e), when=today); failed += 1
            log('FAIL compute', code, repr(e)); continue
        if old and {k: v for k, v in old.items() if k != 'updated'} == {k: v for k, v in out.items() if k != 'updated'}:
            unchanged += 1
        else:
            json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
            done += 1
        errors.pop(code, None)
        if (done + unchanged) % 50 == 0:
            log('progress', done, 'written', unchanged, 'unchanged', skipped, 'skipped', failed, 'failed', 'elapsed', int(time.time() - t0), 's')
        time.sleep(args.sleep)
    json.dump(errors, open(errors_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)

    have = sorted(f[:-5] for f in os.listdir(OUT_DIR) if f.endswith('.json') and not f.startswith('_') and f not in ('index.json', 'latest.json'))
    lst = []
    for c in sorted(set(list(names.keys()) + have)):
        r = names.get(c)
        if r is None:
            try:
                j = json.load(open(os.path.join(OUT_DIR, f'{c}.json'), encoding='utf-8'))
                r = [c, j.get('name', ''), j.get('market', 'TW'), j.get('listed') or '']
            except Exception:
                r = [c, '', 'TW', '']
        lst.append([c, r[1], r[2], r[3], c in have])
    json.dump(dict(schema='bnasdaq-stock-index/2', updated=today, window=site['six']['window'], window26=[site['window']['start'], site['window']['end']],
                   fx_source=fx_src, count=len(have), list=lst), open(index_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    # 口徑核對：0050／2330（W13 對 six／tw）、QQQ（W13 對 tw.results.QQQ；W26 對 lump／cal／crises／dd／periods）
    chk = {}
    six = site['six']; tw = site['tw']['results']
    def loadj(c):
        p = os.path.join(OUT_DIR, f'{c}.json')
        return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None
    for code, key in BASE_TW.items():
        j = loadj(code)
        if not j:
            continue
        ann = {str(y): (round(j['annual'][str(y)] - a, 4) if j['annual'].get(str(y)) is not None else None) for y, a in zip(site['tw']['years'], tw[code]['annual'])}
        chk[code] = dict(lump_diff_pct=round((j['lump'] / six['lump'][key] - 1) * 100, 3), cagr_diff_pp=round((j['cagr'] - six['cagr'][key]) * 100, 3),
                         mdd_diff_pp=round((j['mdd']['mdd'] - six['mdd13'][key]['mdd']) * 100, 3), annual_diff=ann, fixes=j['adj_fixes'])
    j = loadj('QQQ')
    if j:
        ann13 = {str(y): (round(j['annual'][str(y)] - a, 4) if j['annual'].get(str(y)) is not None else None) for y, a in zip(site['tw']['years'], tw['QQQ']['annual'])}
        w = j.get('w26', {})
        cal = {str(c['y']): (round(w['annual'][str(c['y'])] - c['qqq'], 4) if w.get('annual', {}).get(str(c['y'])) is not None else None) for c in site['cal']}
        crs = {c['name']: (round(w['crises'][c['name']] - c['qqq'], 4) if w.get('crises', {}).get(c['name']) is not None else None) for c in site['crises']}
        per = {p['name']: (round(w['periods'][p['name']] - p['qqq'], 4) if w.get('periods', {}).get(p['name']) is not None else None) for p in site['periods']}
        chk['QQQ'] = dict(w13_lump_diff_pct=round((j['lump'] / tw['QQQ']['end'] - 1) * 100, 3), w13_cagr_diff_pp=round((j['cagr'] - tw['QQQ']['cagr']) * 100, 3),
                          w13_annual_diff=ann13, fx=j['fx'],
                          w26_lump_diff_pct=round((w.get('lump', 0) / site['lump']['qqq']['end'] - 1) * 100, 3), w26_cagr_diff_pp=round((w.get('cagr', 0) - site['lump']['qqq']['cagr']) * 100, 3),
                          w26_mdd=[w.get('mdd'), site['dd']['qqq']], w26_cal_diff=cal, w26_crises_diff=crs, w26_periods_diff=per)
    json.dump(chk, open(os.path.join(OUT_DIR, '_check.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    log('finished:', done, 'written', unchanged, 'unchanged', skipped, 'skipped', failed, 'failed; index', len(have), 'files')
    return 0


if __name__ == '__main__':
    sys.exit(main())
