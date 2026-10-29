#!/usr/bin/env python3
"""BNASDAQ｜10 個國際股市指數的月底收盤 → data/indices.json（首頁「報酬率走勢」用；公開資料，不含任何策略規則）。

指數為價格指數（不含息、當地幣別）；月份對齊 assets/data.js 的 SITE.window.months（例 2000-05～2026-09）。
來源：Yahoo Finance chart API（沿用 fetch_stocks.fetch_yahoo）。任何一檔失敗只記錄，不影響其他檔。
"""
import json, os, sys, datetime as dt, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import fetch_stocks as fs  # noqa: E402

OUT = os.path.join(ROOT, 'data', 'indices.json')
INDICES = [
    ('^GSPC', 'S&P 500', '美國'), ('^DJI', '道瓊工業', '美國'), ('^IXIC', '那斯達克綜合', '美國'),
    ('^N225', '日經 225', '日本'), ('^HSI', '恒生', '香港'), ('^FTSE', '富時 100', '英國'),
    ('^GDAXI', 'DAX', '德國'), ('^FCHI', 'CAC 40', '法國'), ('^KS11', 'KOSPI', '韓國'), ('^TWII', '台灣加權', '台灣'),
]


def log(*a):
    print('[fetch_indices]', *a, flush=True)


def main():
    site = fs.load_site()
    months = site['window']['months']
    start = dt.date.fromisoformat(site['window']['start']); end = dt.date.fromisoformat(site['window']['end'])
    out = dict(schema='bnasdaq-indices/1', updated=dt.date.today().isoformat(), window=[site['window']['start'], site['window']['end']],
               months=months, note='價格指數、當地幣別、不含息；月底收盤。', source='Yahoo Finance', series={}, errors={})
    for sym, name, region in INDICES:
        try:
            rows, _ = fs.fetch_yahoo(sym, 'US', start, end)
            bym = {}
            for d, c, a in rows:
                if d <= end:
                    bym[d.strftime('%Y-%m')] = c
            vals = [round(bym[m], 2) if m in bym else None for m in months]
            if sum(v is not None for v in vals) < 24:
                raise RuntimeError('too few months')
            out['series'][sym] = dict(name=name, region=region, values=vals, asof=rows[-1][0].isoformat())
            log('OK', sym, name, sum(v is not None for v in vals), 'months')
        except Exception as e:  # noqa
            out['errors'][sym] = repr(e)[:200]; log('FAIL', sym, repr(e))
        time.sleep(0.5)
    if not out['series']:
        log('nothing fetched; keeping existing'); return 1
    old = None
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            old = None
    if old and old.get('series') == out['series']:
        log('unchanged'); return 0
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    log('written', OUT, len(out['series']), 'indices')
    return 0


if __name__ == '__main__':
    sys.exit(main())
