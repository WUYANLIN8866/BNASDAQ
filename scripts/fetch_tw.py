#!/usr/bin/env python3
"""BNASDAQ｜台股對比資料：為每一檔台股／ETF 預先算好「與本站台股對比同一段期間」的結果，存成 data/tw/<代號>.json。

口徑（與 taiwan.html 的六種做法同一段）：
  期間      ＝ assets/data.js 的 SITE.six.window（例 2013-12-31 → 2026-09-30）；上市較晚者自第一個交易日起算並標註 partial
  價格      ＝ Yahoo Finance 還原收盤（adjclose：股息再投入、分割還原），台幣
  單筆 100 萬 ＝ 1,000,000 × adj(期末) ÷ adj(期初)；年化 ＝ 比值^(1/年數) − 1，年數＝日數 ÷ 365.25
  逐年報酬  ＝ 各年最後交易日 adj ÷ 前一年最後交易日 adj − 1（最後一年到期末為止）
  最深跌幅  ＝ 期間內日收盤（含息）由高點到低點的最大跌幅；回本要漲 ＝ 1 ÷ (1 + 跌幅)
  大跌區間  ＝ SITE.crises 的各段（QQQ 高點→低點日），取該日或之前最近一個交易日的 adj
清單來源：證交所 ISIN 公開資訊（上市 strMode=2、上櫃 strMode=4）的「股票」與「ETF」。

用法：
  python3 scripts/fetch_tw.py --codes 0050,2330          只抓指定代號
  python3 scripts/fetch_tw.py --all [--budget-sec N]     抓全部（有時間預算，下次執行會接續未完成者）
  python3 scripts/fetch_tw.py --all --force              全部重抓
任何一檔失敗只記錄到 data/tw/_errors.json，不影響其他檔。
"""
import json, os, re, sys, time, math, datetime as dt, urllib.request, urllib.error, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'data', 'tw')
DATA_JS = os.path.join(ROOT, 'assets', 'data.js')
UA = {'User-Agent': 'Mozilla/5.0 (BNASDAQ tw fetch)'}
TPE = dt.timezone(dt.timedelta(hours=8))
BASE_CODES = {'0050': 'tw', '2330': 'tsmc'}   # 本站原本就有的兩檔（用證交所資料），用來核對口徑


def log(*a):
    print('[fetch_tw]', *a, flush=True)


def _get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ------------------------------------------------------------------ site window
def load_site():
    s = open(DATA_JS, encoding='utf-8').read()
    m = re.search(r'window\.SITE\s*=\s*(\{.*\});?\s*$', s, re.S)
    return json.loads(m.group(1))


# ------------------------------------------------------------------ universe
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


def fetch_universe():
    allrows = []
    for mode, market in ((2, 'TW'), (4, 'TWO')):
        url = f'https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}'
        raw = _get(url, timeout=90)
        text = raw.decode('cp950', errors='replace')
        rows = parse_isin(text, market)
        log('isin', market, len(rows), 'rows')
        allrows += rows
    seen, uniq = set(), []
    for r in allrows:
        if r[0] in seen:
            continue
        seen.add(r[0]); uniq.append(r)
    return uniq


# ------------------------------------------------------------------ yahoo
def fetch_yahoo(code, market, start, end):
    p1 = int(dt.datetime.combine(start - dt.timedelta(days=95), dt.time(), tzinfo=TPE).timestamp())
    p2 = int(dt.datetime.combine(end + dt.timedelta(days=1), dt.time(), tzinfo=TPE).timestamp())
    sym = f'{code}.{market}'
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
    ts = res.get('timestamp') or []
    q = res['indicators']['quote'][0]
    adj = res['indicators'].get('adjclose', [{}])[0].get('adjclose') or [None] * len(ts)
    rows = []
    for i, t in enumerate(ts):
        c, a = q['close'][i], adj[i]
        if c is None or a is None or c <= 0 or a <= 0:
            continue
        d = dt.datetime.fromtimestamp(t, tz=TPE).date()
        rows.append((d, float(c), float(a)))
    rows.sort()
    splits = []
    for ev in (res.get('events') or {}).get('splits', {}).values():
        try:
            num, den = float(ev.get('numerator')), float(ev.get('denominator'))
            if num > 0 and den > 0:
                splits.append((dt.datetime.fromtimestamp(int(ev['date']), tz=TPE).date(), den / num))
        except Exception:
            pass
    return rows, splits


# ------------------------------------------------------------------ metrics (pure)
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
    該股息率 − 6.5pp（除息日參考價會直接扣掉股息，原始收盤理應跌差不多）；若股息率乘上某個分割倍率（0.5／0.25／0.2／0.1
    或 clean_raw 用過的倍率）後與當天實際跌幅相差 ≤ 1.5pp，就改用那個數字重算之前的還原值。"""
    rows = [list(r) for r in rows]
    cands = set([0.5, 0.25, 0.2, 0.1]) | set(f for f in factors if 0 < f < 1)
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
        if d_claim < 0.06 or d_claim - observed < 0.065:
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


def compute(rows, start, end, crises, splits=()):
    """rows: [(date, close, adj)] sorted. start/end: date. crises: [{name,peak,trough}]"""
    raw_rows = rows
    rows, fixes_raw = clean_raw(rows, list(splits))
    rows, fixes = clean_adj(rows)
    rows, fixes_div = clean_div(rows, [f[2] for f in fixes_raw] + [f for _, f in splits])
    fixes = fixes_raw + [('adj',) + f for f in fixes] + fixes_div
    rows = [r for r in rows if r[0] <= end]
    k0 = _at_or_before(raw_rows, start)
    boundary = [[r[0].isoformat(), round(r[1], 3), round(r[2], 4)] for r in raw_rows[max(0, k0 - 3):k0 + 4]]
    if len(rows) < 20:
        raise RuntimeError(f'too few rows ({len(rows)})')
    i0 = _at_or_before(rows, start)
    partial = False
    if i0 < 0:
        i0 = 0; partial = True
    i1 = len(rows) - 1
    d0, a0 = rows[i0][0], rows[i0][2]
    d1, a1 = rows[i1][0], rows[i1][2]
    if d1 < end - dt.timedelta(days=35):
        partial_end = True
    else:
        partial_end = False
    years = (d1 - d0).days / 365.25
    if years <= 0:
        raise RuntimeError('window too short')
    ratio = a1 / a0
    lump = 1_000_000 * ratio
    cagr = ratio ** (1 / years) - 1
    # annual
    annual = {}
    for y in range(d0.year + 1, d1.year + 1):
        ib = _at_or_before(rows, dt.date(y - 1, 12, 31))
        if ib < i0 or rows[ib][0] < d0:
            annual[str(y)] = None; continue
        ie = _at_or_before(rows, dt.date(y, 12, 31))
        if y == d1.year:
            ie = i1
        annual[str(y)] = rows[ie][2] / rows[ib][2] - 1
    # mdd
    runmax, runmax_d, mdd, peak_d, trough_d = -1.0, None, 0.0, None, None
    for d, c, a in rows[i0:i1 + 1]:
        if a > runmax:
            runmax, runmax_d = a, d
        dd = a / runmax - 1
        if dd < mdd:
            mdd, peak_d, trough_d = dd, runmax_d, d
    need = 1 / (1 + mdd) if mdd > -1 else None
    # crises
    cr = {}
    for c in crises:
        p, t = dt.date.fromisoformat(c['peak']), dt.date.fromisoformat(c['trough'])
        ip, it = _at_or_before(rows, p), _at_or_before(rows, t)
        if ip < i0 or it < i0 or ip < 0 or rows[ip][0] < p - dt.timedelta(days=7) or p < d0:
            cr[c['name']] = None
        else:
            cr[c['name']] = rows[it][2] / rows[ip][2] - 1
    # monthly (month-end, normalized to start)
    monthly, lastm = [], None
    for d, c, a in rows[i0:i1 + 1]:
        key = d.strftime('%Y-%m')
        if lastm is None or key != lastm[0]:
            monthly.append([key, round(a / a0, 5)]); lastm = [key]
        else:
            monthly[-1][1] = round(a / a0, 5)
    return dict(start_used=d0.isoformat(), end_used=d1.isoformat(), partial=partial, partial_end=partial_end,
                years=round(years, 4), lump=round(lump, 0), cagr=round(cagr, 6), annual={k: (None if v is None else round(v, 6)) for k, v in annual.items()},
                mdd=dict(mdd=round(mdd, 6), peak=peak_d.isoformat() if peak_d else None, trough=trough_d.isoformat() if trough_d else None, need=round(need, 4) if need else None),
                crises={k: (None if v is None else round(v, 6)) for k, v in cr.items()}, monthly=monthly,
                last_close=rows[i1][1], n_days=i1 - i0 + 1, adj_fixes=fixes, boundary_raw=boundary)


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
    start = dt.date.fromisoformat(site['six']['window'][0]); end = dt.date.fromisoformat(site['six']['window'][1])
    crises = [dict(name=c['name'], peak=c['peak'], trough=c['trough']) for c in site['crises']]
    log('window', start, '->', end, '| crises', len(crises))

    index_path = os.path.join(OUT_DIR, 'index.json')
    index = json.load(open(index_path, encoding='utf-8')) if os.path.exists(index_path) else dict(list=[])
    names = {r[0]: r for r in index.get('list', [])}

    if args.all:
        try:
            uni = fetch_universe()
            names = {r[0]: list(r) for r in uni}
            log('universe', len(names))
        except Exception as e:  # noqa
            log('universe fetch failed, using existing index:', repr(e))
            if not names:
                return 1
    want = [c.strip().upper() for c in args.codes.split(',') if c.strip()] if args.codes else list(names.keys())
    if not args.all and args.codes:
        for c in want:
            if c not in names:
                names[c] = [c, c, 'TW', '']      # 未知代號：先當上市試，404 再試上櫃
    # ISIN 清單裡的上市日晚於期末者直接略過
    want = [c for c in want if not (names.get(c, ['', '', '', ''])[3] and names[c][3] > end.isoformat())]

    errors_path = os.path.join(OUT_DIR, '_errors.json')
    errors = json.load(open(errors_path, encoding='utf-8')) if os.path.exists(errors_path) else {}
    t0 = time.time(); done = skipped = failed = 0
    today = dt.date.today().isoformat()
    for n, code in enumerate(want):
        if time.time() - t0 > args.budget_sec:
            log('budget reached; stopping at', n, '/', len(want)); break
        path = os.path.join(OUT_DIR, f'{code}.json')
        if os.path.exists(path) and not args.force:
            try:
                old = json.load(open(path, encoding='utf-8'))
                if old.get('window', [None, None])[1] == end.isoformat() and (today[:7] == old.get('updated', '')[:7]):
                    skipped += 1; continue
            except Exception:
                pass
        rec = names.get(code, [code, code, 'TW', ''])
        markets = [rec[2]] + [m for m in ('TW', 'TWO') if m != rec[2]]
        rows, splits, used_market, err = None, [], None, None
        for mk in markets:
            try:
                rows, splits = fetch_yahoo(code, mk, start, end); used_market = mk
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
            m = compute(rows, start, end, crises, splits)
        except Exception as e:  # noqa
            errors[code] = dict(error='compute: ' + repr(e), when=today); failed += 1
            log('FAIL compute', code, repr(e)); continue
        if code in BASE_CODES:   # 口徑核對用：原始日資料（含 Yahoo 分割事件）
            json.dump(dict(code=code, splits=[[d.isoformat(), f] for d, f in splits],
                           rows=[[r[0].isoformat(), round(r[1], 4), round(r[2], 5)] for r in rows if r[0] <= end]),
                      open(os.path.join(OUT_DIR, f'_debug_{code}.json'), 'w', encoding='utf-8'), separators=(',', ':'))
        out = dict(schema='bnasdaq-tw/1', code=code, name=rec[1] if rec[1] != code else '', market=used_market,
                   listed=rec[3] or None, window=[start.isoformat(), end.isoformat()], updated=today,
                   source='Yahoo Finance 還原收盤（含息、分割還原），台幣', **m)
        json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        errors.pop(code, None); done += 1
        if done % 50 == 0:
            log('progress', done, 'done', skipped, 'skipped', failed, 'failed', 'elapsed', int(time.time() - t0), 's')
        time.sleep(args.sleep)
    json.dump(errors, open(errors_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)

    # index：清單 + 已有檔案者
    have = sorted(f[:-5] for f in os.listdir(OUT_DIR) if f.endswith('.json') and not f.startswith('_') and f != 'index.json')
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
    json.dump(dict(schema='bnasdaq-tw-index/1', updated=today, window=[start.isoformat(), end.isoformat()], count=len(have), list=lst),
              open(index_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    # 口徑核對：0050／2330 與本站證交所資料版本的差距
    chk = {}
    six = site['six']; tw = site['tw']['results']
    for code, key in BASE_CODES.items():
        p = os.path.join(OUT_DIR, f'{code}.json')
        if not os.path.exists(p):
            continue
        j = json.load(open(p, encoding='utf-8'))
        site_lump, site_cagr, site_mdd = six['lump'][key], six['cagr'][key], six['mdd13'][key]['mdd']
        ann_site = tw[code]['annual']; years = site['tw']['years']
        ann_diff = {str(y): (round(j['annual'].get(str(y), float('nan')) - a, 4) if j['annual'].get(str(y)) is not None else None) for y, a in zip(years, ann_site)}
        chk[code] = dict(lump_yahoo=j['lump'], lump_site=site_lump, lump_diff_pct=round((j['lump'] / site_lump - 1) * 100, 3),
                         cagr_yahoo=j['cagr'], cagr_site=site_cagr, cagr_diff_pp=round((j['cagr'] - site_cagr) * 100, 3),
                         mdd_yahoo=j['mdd']['mdd'], mdd_site=site_mdd, mdd_diff_pp=round((j['mdd']['mdd'] - site_mdd) * 100, 3),
                         annual_diff_pp=ann_diff)
    json.dump(chk, open(os.path.join(OUT_DIR, '_check.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    log('finished:', done, 'done', skipped, 'skipped', failed, 'failed; index', len(have), 'files; check', json.dumps(chk, ensure_ascii=False)[:600])
    return 0


if __name__ == '__main__':
    sys.exit(main())
