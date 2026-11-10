#!/usr/bin/env python3
"""BNASDAQ｜每日更新美國公債殖利率 data/treasury.json（公開資料，供估值試算器折現用）。

來源順序：
  1. 美國財政部 Daily Treasury Par Yield Curve（XML feed）：1 個月～30 年全部期別
  2. Yahoo Finance chart API：^IRX(13 週)、^FVX(5 年)、^TNX(10 年)、^TYX(30 年) 四個期別（備援）
任何一步失敗就保留原本的 data/treasury.json（不覆蓋）。

另寫 data/treasury_curve.json：財政部各天期每日曲線（本月＋前兩個月，與舊檔合併，保留最近 300 個交易日），
  每日市場分析「債市」畫短中長期殖利率曲線用。

輸出格式：
  {"schema":"bnasdaq-treasury/1","asof":"YYYY-MM-DD","source":"...","updated":"...Z",
   "tenors":{"1m":4.2,"2m":...,"1y":...,"2y":...,"30y":...}}   # 單位：%（年化）
"""
import json, os, sys, datetime as dt, urllib.request, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'treasury.json')
CURVE_OUT = os.path.join(ROOT, 'data', 'treasury_curve.json')   # 各天期殖利率曲線的每日歷史（每日市場分析「債市」畫曲線用）
CURVE_TENORS = ['1m', '2m', '3m', '4m', '6m', '1y', '2y', '3y', '5y', '7y', '10y', '20y', '30y']
CURVE_KEEP = 300   # 保留最近 300 個交易日（約 14 個月），舊的每日報告也畫得出當天曲線
UA = {'User-Agent': 'Mozilla/5.0 (BNASDAQ treasury fetch)'}

# 財政部欄位 → 本站期別代號（年數）
TREASURY_FIELDS = {
    'BC_1MONTH': '1m', 'BC_2MONTH': '2m', 'BC_3MONTH': '3m', 'BC_4MONTH': '4m', 'BC_6MONTH': '6m',
    'BC_1YEAR': '1y', 'BC_2YEAR': '2y', 'BC_3YEAR': '3y', 'BC_5YEAR': '5y', 'BC_7YEAR': '7y',
    'BC_10YEAR': '10y', 'BC_20YEAR': '20y', 'BC_30YEAR': '30y',
}


def log(*a):
    print('[fetch_treasury]', *a, flush=True)


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ------------------------------------------------------------------ sources
def parse_treasury_xml(raw):
    """回傳 (asof, tenors)；取 feed 裡日期最新的一筆。"""
    root = ET.fromstring(raw)
    best = None
    for props in root.iter():
        if not props.tag.endswith('}properties'):
            continue
        rec = {}
        date = None
        for ch in props:
            tag = ch.tag.split('}')[-1]
            val = (ch.text or '').strip()
            if tag == 'NEW_DATE':
                date = val[:10]
            elif tag in TREASURY_FIELDS and val:
                try:
                    rec[TREASURY_FIELDS[tag]] = float(val)
                except ValueError:
                    pass
        if date and rec and (best is None or date > best[0]):
            best = (date, rec)
    if not best:
        raise RuntimeError('no yield rows in treasury xml')
    return best


def parse_treasury_rows(raw):
    """回傳 {日期: {期別: 殖利率}}（feed 裡的每一天；期別少於 8 個的列不要）。"""
    root = ET.fromstring(raw)
    rows = {}
    for props in root.iter():
        if not props.tag.endswith('}properties'):
            continue
        rec, date = {}, None
        for ch in props:
            tag = ch.tag.split('}')[-1]
            val = (ch.text or '').strip()
            if tag == 'NEW_DATE':
                date = val[:10]
            elif tag in TREASURY_FIELDS and val:
                try:
                    rec[TREASURY_FIELDS[tag]] = float(val)
                except ValueError:
                    pass
        if date and len(rec) >= 8 and all(-1.0 < v < 25.0 for v in rec.values()):
            rows[date] = rec
    return rows


def write_curve(months_back=2):
    """抓本月與前 months_back 個月的財政部每日曲線，與舊檔合併後寫 data/treasury_curve.json；只有資料變了才重寫。"""
    first = dt.date.today().replace(day=1)
    months = [first]
    for _ in range(months_back):
        months.append((months[-1] - dt.timedelta(days=1)).replace(day=1))
    rows = {}
    if os.path.exists(CURVE_OUT):
        try:
            old = json.load(open(CURVE_OUT, encoding='utf-8'))
            if old.get('tenors') == CURVE_TENORS:
                rows = {r[0]: {t: v for t, v in zip(CURVE_TENORS, r[1:]) if v is not None} for r in old.get('rows') or []}
        except Exception:
            old = None
    else:
        old = None
    got = 0
    for m in months:
        url = ('https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml'
               f'?data=daily_treasury_yield_curve&field_tdr_date_value_month={m:%Y%m}')
        try:
            new = parse_treasury_rows(_get(url))
            rows.update(new); got += len(new)
        except Exception as e:  # noqa
            log('curve month', f'{m:%Y%m}', 'failed:', repr(e))
    if not got:
        log('curve: no rows fetched; keeping existing'); return 1
    dates = sorted(rows)[-CURVE_KEEP:]
    out = dict(schema='bnasdaq-treasury-curve/1', source='美國財政部 Daily Treasury Par Yield Curve',
               u='https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve',
               updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), unit='% 年化（par yield）',
               tenors=CURVE_TENORS, rows=[[d] + [rows[d].get(t) for t in CURVE_TENORS] for d in dates],
               note='公開市場資料（美國公債各天期殖利率），供每日市場分析畫殖利率曲線；不含任何策略規則。')
    if old and old.get('rows') == out['rows']:
        log('curve unchanged', dates[-1]); return 0
    with open(CURVE_OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    log('curve written', len(dates), 'rows', dates[0], '~', dates[-1], 'fetched', got)
    return 0


def src_treasury():
    today = dt.date.today()
    months = [today.replace(day=1), (today.replace(day=1) - dt.timedelta(days=1)).replace(day=1)]
    for m in months:
        url = ('https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml'
               f'?data=daily_treasury_yield_curve&field_tdr_date_value_month={m:%Y%m}')
        try:
            asof, tenors = parse_treasury_xml(_get(url))
            if len(tenors) >= 8:
                return asof, tenors, '美國財政部 Daily Treasury Par Yield Curve'
        except Exception as e:  # noqa
            log('treasury month', f'{m:%Y%m}', 'failed:', repr(e))
    raise RuntimeError('treasury feed unavailable')


def src_yahoo():
    tickers = {'^IRX': '3m', '^FVX': '5y', '^TNX': '10y', '^TYX': '30y'}
    tenors, asof = {}, None
    p2 = int(dt.datetime.now(dt.timezone.utc).timestamp()) + 86400
    p1 = p2 - 86400 * 14
    for tk, code in tickers.items():
        url = (f'https://query2.finance.yahoo.com/v8/finance/chart/{urllib.request.quote(tk)}'
               f'?period1={p1}&period2={p2}&interval=1d')
        j = json.loads(_get(url))
        res = j['chart']['result'][0]
        ts, closes = res['timestamp'], res['indicators']['quote'][0]['close']
        pairs = [(t, c) for t, c in zip(ts, closes) if c is not None]
        if not pairs:
            continue
        t, c = pairs[-1]
        d = dt.datetime.fromtimestamp(t, tz=dt.timezone(dt.timedelta(hours=-4))).date().isoformat()
        tenors[code] = float(c)
        asof = max(asof or d, d)
    if len(tenors) < 3:
        raise RuntimeError('yahoo yields incomplete')
    return asof, tenors, 'Yahoo Finance（^IRX／^FVX／^TNX／^TYX，備援來源，僅四個期別）'


# ------------------------------------------------------------------ main
def main():
    rc = main_latest()
    try:
        write_curve()
    except Exception as e:  # noqa   曲線歷史失敗不影響 treasury.json
        log('curve failed:', repr(e))
    return rc


def main_latest():
    got = None
    for fn in (src_treasury, src_yahoo):
        try:
            got = fn()
            log('source OK:', fn.__name__, got[0], got[1])
            break
        except Exception as e:  # noqa
            log('source failed:', fn.__name__, repr(e))
    if not got:
        log('all sources failed; keeping existing treasury.json')
        return 1
    asof, tenors, source = got
    # sanity：殖利率應落在 -1%～25% 之間
    for k, v in list(tenors.items()):
        if not (-1.0 < v < 25.0):
            log('drop implausible value', k, v); tenors.pop(k)
    if len(tenors) < 3:
        log('too few tenors after sanity; keeping existing'); return 1
    out = dict(schema='bnasdaq-treasury/1', asof=asof, source=source,
               updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               unit='% 年化（par yield）', tenors=tenors,
               note='公開市場資料（美國公債殖利率），供估值試算器折現用；不含任何策略規則。')
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
            if (old.get('asof') or '') > asof:
                log('fetched older than existing; keeping existing'); return 1
            if {k: v for k, v in old.items() if k != 'updated'} == {k: v for k, v in out.items() if k != 'updated'}:
                log('unchanged (asof', asof, '); not rewriting'); return 0
        except Exception:
            pass
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    log('written', OUT, 'asof', asof)
    return 0


if __name__ == '__main__':
    sys.exit(main())
