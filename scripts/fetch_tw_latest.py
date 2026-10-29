#!/usr/bin/env python3
"""BNASDAQ｜台股最新收盤 data/tw/latest.json（每個交易日收盤後更新；公開資料，不含任何策略規則）。

來源（官方）：
  上市：證交所 https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?response=json（含日期、全部上市證券含 ETF）
  上櫃：櫃買中心 https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes（含日期）
輸出：{"asof": {"TW": "YYYY-MM-DD", "TWO": "YYYY-MM-DD"}, "updated": "...Z",
       "items": {"2330": [收盤, 漲跌, "名稱"], ...}}
日期沒有前進（例如假日重跑）就不覆蓋原檔。
"""
import json, os, sys, datetime as dt, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'tw', 'latest.json')
UA = {'User-Agent': 'Mozilla/5.0 (BNASDAQ tw latest fetch)', 'Accept': 'application/json'}


def log(*a):
    print('[fetch_tw_latest]', *a, flush=True)


def _get_json(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def _num(s):
    try:
        s = str(s).replace(',', '').strip()
        if s in ('', '--', '---', 'X', 'N/A'):
            return None
        return float(s)
    except Exception:
        return None


def roc_to_iso(s):
    """民國 1150629 / 115/06/29 → 2026-06-29；西元格式原樣回傳"""
    s = str(s).strip().replace('/', '')
    if len(s) == 7 and s.isdigit():
        return f'{int(s[:3]) + 1911}-{s[3:5]}-{s[5:7]}'
    if len(s) == 8 and s.isdigit():
        return f'{s[:4]}-{s[4:6]}-{s[6:8]}'
    return s


def fetch_twse():
    j = _get_json('https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?response=json')
    date = roc_to_iso(j.get('date', ''))
    fields = j.get('fields') or []
    rows = j.get('data') or []
    idx = {f: i for i, f in enumerate(fields)}
    ci = idx.get('證券代號', 0); ni = idx.get('證券名稱', 1); pi = idx.get('收盤價', 7); di = idx.get('漲跌價差', 8)
    items = {}
    for r in rows:
        try:
            code = str(r[ci]).strip(); close = _num(r[pi]); chg = _num(r[di])
            if code and close is not None:
                items[code] = [close, chg, str(r[ni]).strip()]
        except Exception:
            continue
    return date, items


def fetch_tpex():
    j = _get_json('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes')
    items, date = {}, ''
    for r in j:
        code = str(r.get('SecuritiesCompanyCode', '')).strip()
        close = _num(r.get('Close')); chg = _num(r.get('Change'))
        if not date and r.get('Date'):
            date = roc_to_iso(r['Date'])
        if code and close is not None:
            items[code] = [close, chg, str(r.get('CompanyName', '')).strip()]
    return date, items


def main():
    old = None
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            old = None
    asof, items = {}, {}
    for name, fn in (('TW', fetch_twse), ('TWO', fetch_tpex)):
        try:
            d, it = fn()
            if not it:
                raise RuntimeError('empty')
            asof[name] = d; items.update(it)
            log(name, d, len(it), 'items')
        except Exception as e:  # noqa
            log(name, 'failed:', repr(e))
            if old and old.get('asof', {}).get(name):
                asof[name] = old['asof'][name]
                items.update({k: v for k, v in old.get('items', {}).items() if (v[3] if len(v) > 3 else None) == name})
    if not items:
        log('nothing fetched; keeping existing'); return 1
    # 日期沒前進就不覆蓋
    if old and old.get('asof') and all(asof.get(k, '') <= old['asof'].get(k, '') for k in asof) and old.get('items'):
        log('no newer date than existing', old['asof'], '; not rewriting'); return 0
    out = dict(schema='bnasdaq-tw-latest/1', asof=asof, updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               source='證交所 STOCK_DAY_ALL（上市）、櫃買中心 OpenAPI（上櫃）', items=items)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    log('written', OUT, asof, len(items), 'items')
    return 0


if __name__ == '__main__':
    sys.exit(main())
