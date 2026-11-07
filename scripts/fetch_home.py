#!/usr/bin/env python3
"""BNASDAQ｜首頁「累積報酬比較」用的月底序列 data/home.json（公開市場資料，不含任何策略規則）。

月份：2000-05 起至「最後一個完整月」（由 data/market.json 判斷：QQQ 已出現下一個月的交易日的月份），
      與首頁回測（assets/bt.js，每月初延伸到上個月底）同一個終點。
序列：SPY、BRK-B（Yahoo 還原收盤，美元）；0050、2330（Yahoo 還原收盤，台幣，沿用 fetch_stocks.py 的台股資料錯誤修正）；
      10 個國際指數（Yahoo 收盤，價格指數、當地幣別，清單同 fetch_indices.py）。
月底值＝該月最後一個交易日；個股以第一個有效月＝1 正規化（首頁只看同一起點的相對變化）。
任何一檔失敗只略過該檔；全部失敗、或終點比現有檔案舊時，保留原檔不覆蓋；內容沒變不重寫。
用法：python3 scripts/fetch_home.py
"""
import os, sys, json, time, calendar, datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_stocks as fs  # noqa: E402
from fetch_indices import INDICES  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'home.json')
MARKET = os.path.join(ROOT, 'data', 'market.json')
START = '2000-05'
STOCKS = [('SPY', 'US', 'SPY'), ('BRK-B', 'US', '波克夏 BRK-B'), ('0050', 'TW', '0050'), ('2330', 'TW', '台積電 2330')]


def log(*a):
    print('[fetch_home]', *a, flush=True)


def last_complete_month():
    mk = json.load(open(MARKET, encoding='utf-8'))
    ext = mk.get('ext') or []
    return ext[-1]['m'] if ext else mk['base_last']


def month_list(a, b):
    out, y, m = [], int(a[:4]), int(a[5:7])
    while '%04d-%02d' % (y, m) <= b:
        out.append('%04d-%02d' % (y, m)); m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def month_end(rows, months, end, col):
    """rows：[(date, close, adj)] 由舊到新；回傳每個月最後一個交易日的值（col=1 收盤、2 還原收盤）"""
    bym = {}
    for r in rows:
        if r[0] <= end:
            bym[r[0].strftime('%Y-%m')] = r[col]
    return [bym.get(m) for m in months]


def stock_series(code, market, months, start, end):
    rows, splits = fs.fetch_yahoo(code, market, start, end)
    rows, fixes_raw = fs.clean_raw(rows, list(splits))
    rows, _ = fs.clean_adj(rows)
    rows, _ = fs.clean_div(rows, [f[2] for f in fixes_raw] + [f for _, f in splits])
    vals = month_end(rows, months, end, 2)
    base = next((v for v in vals if v is not None), None)
    if base is None or vals[-1] is None:
        raise RuntimeError('no value for the last month' if base else 'no data')
    return [None if v is None else round(v / base, 6) for v in vals], rows[-1][0].isoformat()


def main():
    end_m = last_complete_month()
    months = month_list(START, end_m)
    y, m = int(end_m[:4]), int(end_m[5:7])
    start, end = dt.date(2000, 5, 1), dt.date(y, m, calendar.monthrange(y, m)[1])
    out = dict(schema='bnasdaq-home/1', updated=dt.date.today().isoformat(), end=end_m, months=months, series={}, indices={}, errors={},
               source='Yahoo Finance（個股：還原收盤；指數：收盤）', note='公開市場資料；個股為還原收盤（含息），以第一個有效月＝1；指數為價格指數（不含息、當地幣別）。')
    for code, market, name in STOCKS:
        try:
            vals, asof = stock_series(code, market, months, start, end)
            out['series'][code] = dict(name=name, values=vals, asof=asof)
            log('OK', code, sum(v is not None for v in vals), 'months')
        except Exception as e:  # noqa
            out['errors'][code] = repr(e)[:200]; log('FAIL', code, repr(e))
        time.sleep(0.5)
    for sym, name, region in INDICES:
        try:
            rows, _ = fs.fetch_yahoo(sym, 'US', start, end)
            vals = month_end(rows, months, end, 1)
            if sum(v is not None for v in vals) < 24 or vals[-1] is None:
                raise RuntimeError('too few months or no value for the last month')
            out['indices'][sym] = dict(name=name, region=region, values=[None if v is None else round(v, 2) for v in vals], asof=rows[-1][0].isoformat())
            log('OK', sym, name)
        except Exception as e:  # noqa
            out['errors'][sym] = repr(e)[:200]; log('FAIL', sym, repr(e))
        time.sleep(0.5)
    if not out['series'] and not out['indices']:
        log('nothing fetched; keeping existing'); return 1
    old = None
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            old = None
    if old and old.get('end', '') > end_m:
        log('existing file is newer (', old.get('end'), '>', end_m, '); keeping existing'); return 1
    if old and {k: v for k, v in old.items() if k != 'updated'} == {k: v for k, v in out.items() if k != 'updated'}:
        log('unchanged'); return 0
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    log('written', OUT, 'end', end_m, len(out['series']), 'stocks', len(out['indices']), 'indices', 'errors', list(out['errors']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
