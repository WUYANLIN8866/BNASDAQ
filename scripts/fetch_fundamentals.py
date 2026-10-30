#!/usr/bin/env python3
"""BNASDAQ｜個股目標價試算的自動參數 → data/fund/<代號>.json、data/fund/_industry.json
來源：Yahoo Finance quoteSummary（價格、EPS、分析師成長預估、歷年獲利、本益比、產業）＋ Yahoo 新聞搜尋（最新標題）。
參數規則（全部寫進 JSON 的 why，頁面照抄顯示）：
  EPS＝近 12 個月 EPS；成長率區間＝{分析師明年 EPS 成長、5 年長期成長、近 3 年淨利年化、最近一季獲利年增}的最小～最大（夾在 0～60%）；
  成長年數＝依成長率高低 3～10 年；退出本益比＝同產業（本站清單內）本益比第 25～75 百分位（樣本 < 5 用同類股），夾在 5～60。"""
import json, os, sys, time, re, argparse, statistics, datetime as dt, urllib.request, urllib.parse, http.cookiejar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'fund')
IDX = os.path.join(ROOT, 'data', 'tw', 'index.json')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
MODS = 'price,summaryDetail,defaultKeyStatistics,financialData,earningsTrend,assetProfile,earnings'
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
CRUMB = None


def log(*a): print('[fund]', *a, flush=True)


def get(url, timeout=30):
    r = op.open(urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'}), timeout=timeout)
    return r.read()


DIAG = []


def crumb():
    global CRUMB
    for u in ('https://fc.yahoo.com', 'https://finance.yahoo.com/quote/AAPL/'):
        try: get(u)
        except Exception as e: DIAG.append(f'cookie {u}: {e!r}'[:200])
    for u in ('https://query1.finance.yahoo.com/v1/test/getcrumb', 'https://query2.finance.yahoo.com/v1/test/getcrumb'):
        try:
            CRUMB = get(u).decode().strip()
            if CRUMB and '<' not in CRUMB: break
        except Exception as e:
            DIAG.append(f'crumb {u}: {e!r}'[:200])
    DIAG.append(f'crumb={bool(CRUMB)} cookies={[c.name for c in cj]}')
    log(DIAG)


def raw(x):
    return x.get('raw') if isinstance(x, dict) else x


def ysym(code, market):
    return code if market == 'US' else code + ('.TWO' if market == 'TWO' else '.TW')


def summary(sym):
    u = f'https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(sym)}?modules={MODS}&crumb={urllib.parse.quote(CRUMB or "")}'
    j = json.loads(get(u))
    r = (j.get('quoteSummary') or {}).get('result') or []
    if not r: raise RuntimeError('no result')
    return r[0]


def news(sym, name):
    try:
        u = 'https://query1.finance.yahoo.com/v1/finance/search?' + urllib.parse.urlencode(dict(q=sym, newsCount=8, quotesCount=0, lang='zh-Hant-TW', region='TW'))
        j = json.loads(get(u))
        return [dict(t=n.get('title'), u=n.get('link'), p=n.get('publisher'), d=dt.datetime.utcfromtimestamp(n.get('providerPublishTime', 0)).date().isoformat())
                for n in (j.get('news') or [])[:8] if n.get('title')]
    except Exception:
        return []


def extract(code, market, s):
    pr, sd, ks, fd, et, ap, ea = (s.get(k) or {} for k in ('price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'earningsTrend', 'assetProfile', 'earnings'))
    o = dict(code=code, market=market, name=pr.get('longName') or pr.get('shortName') or '', currency=pr.get('currency'),
             fin_currency=fd.get('financialCurrency'), price=raw(pr.get('regularMarketPrice')),
             eps_ttm=raw(ks.get('trailingEps')), eps_fwd=raw(ks.get('forwardEps')),
             pe_ttm=raw(sd.get('trailingPE')), pe_fwd=raw(sd.get('forwardPE')) or raw(ks.get('forwardPE')),
             sector=ap.get('sector') or '', industry=ap.get('industry') or '',
             target_mean=raw(fd.get('targetMeanPrice')), target_lo=raw(fd.get('targetLowPrice')), target_hi=raw(fd.get('targetHighPrice')),
             analysts=raw(fd.get('numberOfAnalystOpinions')), rev_growth=raw(fd.get('revenueGrowth')), earn_growth=raw(fd.get('earningsGrowth')))
    g = {}
    for t in et.get('trend') or []:
        v = raw((t.get('growth') or {}))
        if v is None: continue
        if t.get('period') == '+1y': g['analyst_next_year'] = v
        if t.get('period') == '+5y': g['analyst_5y'] = v
        if t.get('period') == '0y': g['analyst_this_year'] = v
    yr = [(y.get('date'), raw(y.get('earnings'))) for y in ((ea.get('financialsChart') or {}).get('yearly') or [])]
    yr = [(d, v) for d, v in yr if v]
    if len(yr) >= 2 and yr[0][1] > 0 and yr[-1][1] > 0:
        g['hist_net_income_cagr'] = (yr[-1][1] / yr[0][1]) ** (1 / (len(yr) - 1)) - 1
        o['hist_years'] = f'{yr[0][0]}→{yr[-1][0]}'
    if o['earn_growth'] is not None: g['latest_quarter_yoy'] = o['earn_growth']
    o['growth_inputs'] = {k: round(v, 4) for k, v in g.items()}
    if o['pe_ttm'] is None and o['price'] and o['eps_ttm'] and o['eps_ttm'] > 0:
        o['pe_ttm'] = o['price'] / o['eps_ttm']
    return o


def pct(a, q):
    a = sorted(a); k = (len(a) - 1) * q; f = int(k); c = min(f + 1, len(a) - 1)
    return a[f] + (a[c] - a[f]) * (k - f)


def params(o, peers):
    why = []
    p = dict()
    p['px'] = o['price']; p['eps'] = o['eps_ttm']
    why.append(f"股價＝最新收盤 {o['price']}；EPS＝近 12 個月每股盈餘 {o['eps_ttm']}")
    if o.get('fin_currency') and o.get('currency') and o['fin_currency'] != o['currency']:
        why.append(f"注意：財報幣別 {o['fin_currency']} 與股價幣別 {o['currency']} 不同（常見於 ADR），EPS 可能需換算")
    gs = [v for v in o['growth_inputs'].values() if v is not None]
    lab = dict(analyst_next_year='分析師明年 EPS 成長', analyst_5y='分析師 5 年長期成長', analyst_this_year='分析師今年 EPS 成長', hist_net_income_cagr='近幾年淨利年化', latest_quarter_yoy='最近一季獲利年增')
    if gs:
        lo, hi = max(0.0, min(gs)), min(0.6, max(gs))
        if hi < lo: hi = lo
        if hi - lo < 0.02: lo, hi = max(0, lo - 0.02), hi + 0.02
        why.append('成長率＝下列數字的最小～最大（夾在 0～60%）：' + '、'.join(f"{lab[k]} {v*100:.1f}%" for k, v in o['growth_inputs'].items()))
    else:
        lo, hi = 0.05, 0.10; why.append('查無成長預估與歷年獲利，成長率先用 5～10%，請自行調整')
    p['gLo'], p['gHi'] = round(lo * 100, 1), round(hi * 100, 1)
    mid = (lo + hi) / 2
    p['nLo'], p['nHi'] = (3, 6) if mid > 0.3 else (5, 8) if mid > 0.15 else (5, 10)
    why.append(f"成長年數 {p['nLo']}～{p['nHi']} 年：成長越快越難持久（中位成長 > 30% 用 3～6 年、15～30% 用 5～8 年、其餘 5～10 年）")
    grp, src = peers.get(('i', o['industry'])), '同產業「' + (o['industry'] or '—') + '」'
    if not grp or len(grp) < 5:
        grp, src = peers.get(('s', o['sector'])), '同類股「' + (o['sector'] or '—') + '」'
    if grp and len(grp) >= 5:
        a, b = max(5, pct(grp, .25)), min(60, pct(grp, .75))
        p['peLo'], p['peHi'] = round(a), round(max(b, a + 1))
        why.append(f"退出本益比＝{src}{len(grp)} 檔本益比的第 25～75 百分位（夾在 5～60）")
    else:
        p['peLo'], p['peHi'] = 12, 20; why.append('同產業樣本不足，退出本益比先用 12～20 倍，請自行調整')
    p['why'] = why
    return p


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--codes', default=''); ap.add_argument('--budget-sec', type=int, default=17000)
    a = ap.parse_args(); os.makedirs(OUT, exist_ok=True)
    idx = json.load(open(IDX, encoding='utf-8'))['list']
    mk = {x[0]: x[2] for x in idx}
    codes = [c.strip().upper() for c in a.codes.split(',') if c.strip()] or [x[0] for x in idx if x[4]]
    try: crumb()
    except Exception as e: DIAG.append(repr(e)[:200])
    t0 = time.time(); ok = fail = 0
    for c in codes:
        if time.time() - t0 > a.budget_sec: log('budget reached'); break
        m = mk.get(c, 'US' if c.isalpha() else 'TW'); sym = ysym(c, m)
        try:
            try: s = summary(sym)
            except urllib.error.HTTPError as e:
                if e.code == 401: crumb(); s = summary(sym)
                elif m == 'TW': sym = c + '.TWO'; s = summary(sym)
                else: raise
            o = extract(c, m, s); o['news'] = news(sym, o['name']); o['updated'] = dt.date.today().isoformat()
            json.dump(o, open(os.path.join(OUT, c + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':')); ok += 1
        except Exception as e:  # noqa
            fail += 1; log('FAIL', c, repr(e)[:120]); DIAG.append(f'{c}: {e!r}'[:200])
        time.sleep(0.35)
    # 第二輪：產業本益比 → 參數
    peers = {}
    files = [f for f in os.listdir(OUT) if f.endswith('.json') and not f.startswith('_')]
    allo = []
    for f in files:
        o = json.load(open(os.path.join(OUT, f), encoding='utf-8')); allo.append((f, o))
        pe = o.get('pe_ttm')
        if pe and 0 < pe < 200:
            for k in (('i', o.get('industry')), ('s', o.get('sector'))):
                if k[1]: peers.setdefault(k, []).append(pe)
    for f, o in allo:
        if o.get('price') and o.get('eps_ttm') and o['eps_ttm'] > 0:
            o['params'] = params(o, peers)
        else:
            o['params'] = None; o['why_none'] = '虧損或查無 EPS（≤ 0），本工具不適用'
        json.dump(o, open(os.path.join(OUT, f), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    ind = {f'{k[0]}:{k[1]}': dict(n=len(v), p25=round(pct(v, .25), 1), p50=round(pct(v, .5), 1), p75=round(pct(v, .75), 1)) for k, v in peers.items()}
    json.dump(dict(diag=DIAG[:40], updated=dt.date.today().isoformat(), ok=ok, fail=fail, files=len(files), industry=ind), open(os.path.join(OUT, '_industry.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    log('done ok', ok, 'fail', fail, 'files', len(files))


if __name__ == '__main__':
    sys.exit(main())
