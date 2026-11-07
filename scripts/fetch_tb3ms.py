#!/usr/bin/env python3
"""BNASDAQ｜FRED TB3MS（3 個月期美國國庫券次級市場利率，月平均，%）→ data/tb3ms.json（公開資料，不含任何策略規則）。

用途：首頁回測每月延伸時，新月份的無風險利率＝前一個月 TB3MS ÷ 100（同專案規則的 SHV 代理口徑）。
來源：https://fred.stlouisfed.org/graph/fredgraph.csv?id=TB3MS（備援 https://fred.stlouisfed.org/data/TB3MS.txt）。保留 2020-01 起。
失敗、數值超出合理範圍或月份變少時保留原檔；內容沒變不重寫。
用法：python3 scripts/fetch_tb3ms.py
"""
import os, sys, json, csv, io, urllib.request, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'tb3ms.json')
KEEP_FROM = '2020-01'


def log(*a):
    print('[fetch_tb3ms]', *a, flush=True)


def _get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (BNASDAQ data fetch)'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode('utf-8', 'replace')


def parse_csv(txt):
    out = {}
    for row in csv.reader(io.StringIO(txt)):
        if len(row) < 2 or not row[0][:4].isdigit():
            continue
        try:
            out[row[0][:7]] = float(row[1])
        except ValueError:
            pass
    return out


def parse_txt(txt):
    out = {}
    for line in txt.splitlines():
        p = line.split()
        if len(p) == 2 and len(p[0]) == 10 and p[0][:4].isdigit():
            try:
                out[p[0][:7]] = float(p[1])
            except ValueError:
                pass
    return out


def main():
    data, src = {}, ''
    for url, parse in (('https://fred.stlouisfed.org/graph/fredgraph.csv?id=TB3MS', parse_csv), ('https://fred.stlouisfed.org/data/TB3MS.txt', parse_txt)):
        try:
            data = parse(_get(url)); src = url
            if len(data) > 100:
                break
            log('too few rows from', url, len(data))
        except Exception as e:  # noqa
            log('failed', url, repr(e))
    data = {m: v for m, v in data.items() if m >= KEEP_FROM}
    if len(data) < 12 or any(not (-1 <= v <= 25) for v in data.values()):
        log('no usable data; keeping existing'); return 1
    old = None
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            old = None
    if old and max(old.get('monthly', {'0': 0})) > max(data):
        log('fetched data older than existing; keeping existing'); return 1
    out = dict(schema='bnasdaq-tb3ms/1', updated=dt.date.today().isoformat(), source='FRED TB3MS（' + src + '）', unit='%（年率，月平均）',
               note='3-Month Treasury Bill Secondary Market Rate, Discount Basis；首頁回測新月份的無風險利率＝前一個月值 ÷ 100。',
               monthly=dict(sorted(data.items())))
    if old and old.get('monthly') == out['monthly']:
        log('unchanged; last', max(data)); return 0
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    log('written', OUT, len(data), 'months, last', max(data), data[max(data)])
    return 0


if __name__ == '__main__':
    sys.exit(main())
