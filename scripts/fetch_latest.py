#!/usr/bin/env python3
"""BNASDAQ｜最新收盤 data/tw/latest.json（每個交易日收盤後更新；公開資料，不含任何策略規則）。
台股：證交所／櫃買中心官方；美股：Yahoo Finance（index.json 裡 market=US 的代號）；匯率：Yahoo TWD=X。

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
UA = {'User-Agent': 'Mozilla/5.0 (BNASDAQ latest fetch)', 'Accept': 'application/json'}


def log(*a):
    print('[fetch_latest]', *a, flush=True)


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


RWD_NOTE = []


def fetch_twse():
    """先用 rwd 端點（含日期），失敗或沒資料再用 OpenAPI（日期取自 MI_INDEX）。"""
    try:
        j = _get_json('https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?response=json')
        date = roc_to_iso(j.get('date', ''))
        fields = j.get('fields') or []
        rows = j.get('data') or []
        if rows:
            idx = {f: i for i, f in enumerate(fields)}
            ci = idx.get('證券代號', 0); ni = idx.get('證券名稱', 1); pi = idx.get('收盤價', 7); di = idx.get('漲跌價差', 8)
            items = {}
            for r in rows:
                try:
                    code = str(r[ci]).strip(); close = _num(r[pi]); chg = _num(r[di])
                    if code and close is not None:
                        items[code] = [close, chg, str(r[ni]).strip(), 'TW']
                except Exception:
                    continue
            if items:
                return date, items
        log('twse rwd: no rows (stat=%s)' % j.get('stat')); RWD_NOTE.append('rwd stat=%s' % j.get('stat'))
    except Exception as e:  # noqa
        log('twse rwd failed:', repr(e)); RWD_NOTE.append('rwd ' + repr(e)[:200])
    j = _get_json('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL')
    date = ''
    try:   # 日期：FMTQIK（每日市場成交資訊）最後一列的 Date 就是最近一個有收盤資料的交易日
        fm = _get_json('https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK')
        if fm and isinstance(fm, list):
            ds = [roc_to_iso(r.get('Date', '')) for r in fm if r.get('Date')]
            if ds:
                date = max(ds)
    except Exception as e:  # noqa
        log('twse FMTQIK failed:', repr(e))
    items = {}
    for r in j:
        code = str(r.get('Code', '')).strip(); close = _num(r.get('ClosingPrice')); chg = _num(r.get('Change'))
        if code and close is not None:
            items[code] = [close, chg, str(r.get('Name', '')).strip(), 'TW']
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
            items[code] = [close, chg, str(r.get('CompanyName', '')).strip(), 'TWO']
    return date, items


def _yahoo_chart_last(sym, rng='5d'):
    j = _get_json(f'https://query2.finance.yahoo.com/v8/finance/chart/{urllib.request.quote(sym)}?range={rng}&interval=1d')
    res = j['chart']['result'][0]
    ts = res.get('timestamp') or []; cl = res['indicators']['quote'][0]['close']
    pairs = [(t, c) for t, c in zip(ts, cl) if c is not None]
    if not pairs:
        raise RuntimeError('no closes')
    t, c = pairs[-1]; prev = pairs[-2][1] if len(pairs) > 1 else None
    d = dt.datetime.fromtimestamp(t, tz=dt.timezone(dt.timedelta(hours=-4))).date().isoformat()
    return d, float(c), (round(float(c) - prev, 4) if prev is not None else None)


def fetch_us(codes, sleep=0.25):
    """美股最新收盤：先用 spark 批次（每批 20），失敗的用單檔 chart。回傳 (date, items)"""
    import time
    items, date = {}, ''
    todo = list(codes)
    for i in range(0, len(todo), 20):
        batch = todo[i:i + 20]
        try:
            j = _get_json('https://query1.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(urllib.request.quote(c) for c in batch) + '&range=5d&interval=1d')
            for r in (j.get('spark', {}).get('result') or []):
                sym = r.get('symbol'); resp = (r.get('response') or [{}])[0]
                ts = resp.get('timestamp') or []; cl = (resp.get('indicators', {}).get('quote') or [{}])[0].get('close') or []
                pairs = [(t, c) for t, c in zip(ts, cl) if c is not None]
                if not sym or not pairs:
                    continue
                t, c = pairs[-1]; prev = pairs[-2][1] if len(pairs) > 1 else None
                d = dt.datetime.fromtimestamp(t, tz=dt.timezone(dt.timedelta(hours=-4))).date().isoformat()
                items[sym] = [float(c), (round(float(c) - prev, 4) if prev is not None else None), '', 'US']
                date = max(date, d)
        except Exception as e:  # noqa
            log('spark batch failed:', repr(e)[:120])
        time.sleep(sleep)
    missing = [c for c in todo if c not in items]
    for c in missing[:400]:
        try:
            d, close, chg = _yahoo_chart_last(c); items[c] = [close, chg, '', 'US']; date = max(date, d)
        except Exception as e:  # noqa
            log('us', c, 'failed:', repr(e)[:100])
        time.sleep(sleep)
    return date, items


def fetch_fx():
    d, close, chg = _yahoo_chart_last('TWD=X')
    return dict(rate=close, date=d, source='Yahoo TWD=X')


def build_fx_monthly():
    """月底匯率（台幣／美元）：FRED DEXTAUS 每日 → 每月最後一個有值的日子；備援 Yahoo TWD=X。寫到 data/tw/_fx.json。"""
    import csv, io
    out_path = os.path.join(ROOT, 'data', 'tw', '_fx.json')
    months, source = {}, ''
    try:
        req = urllib.request.Request('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXTAUS', headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode('utf-8')
        for rec in csv.DictReader(io.StringIO(raw)):
            d = rec.get('observation_date') or rec.get('DATE'); v = rec.get('DEXTAUS')
            if d and v and v != '.':
                months[d[:7]] = float(v)      # 依日期遞增覆寫 → 留下月底最後一筆
        source = 'FRED DEXTAUS（每日，取每月最後一筆）'
    except Exception as e:  # noqa
        log('fx FRED failed:', repr(e))
    if len(months) < 100:
        try:
            j = _get_json('https://query2.finance.yahoo.com/v8/finance/chart/TWD%3DX?period1=915148800&period2=' + str(int(dt.datetime.now().timestamp()) + 86400) + '&interval=1mo')
            res = j['chart']['result'][0]; ts = res['timestamp']; cl = res['indicators']['quote'][0]['close']
            months = {}
            for t, c in zip(ts, cl):
                if c is not None:
                    months[dt.datetime.fromtimestamp(t, tz=dt.timezone.utc).strftime('%Y-%m')] = float(c)
            source = 'Yahoo TWD=X（月線收盤）'
        except Exception as e:  # noqa
            log('fx Yahoo failed:', repr(e))
    if len(months) < 100:
        log('fx monthly: too few; keeping existing'); return
    old = None
    if os.path.exists(out_path):
        try:
            old = json.load(open(out_path, encoding='utf-8'))
        except Exception:
            old = None
    if old and old.get('months') == months:
        log('fx monthly unchanged'); return
    json.dump(dict(schema='bnasdaq-fx-monthly/1', source=source, updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), unit='台幣／美元，月底', months=months),
              open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    log('fx monthly written', len(months), 'months', min(months), max(months))


def load_keep():
    """只保留股票與 ETF：以 data/tw/index.json 的清單為準；沒有清單時用代號型式判斷（4 碼、或 00 開頭的 ETF）。"""
    import re
    p = os.path.join(ROOT, 'data', 'tw', 'index.json')
    try:
        lst = json.load(open(p, encoding='utf-8')).get('list') or []
        keep = set(r[0] for r in lst)
        if keep:
            return lambda c: c in keep
    except Exception:
        pass
    pat = re.compile(r'^\d{4}$|^00\d{2,3}[A-Z]?$')
    return lambda c: bool(pat.match(c))


def main():
    try:
        build_fx_monthly()
    except Exception as e:  # noqa
        log('fx monthly error:', repr(e))
    old = None
    keep = load_keep()
    errors = {}
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            old = None
    asof, items = {}, {}
    for name, fn in (('TW', fetch_twse), ('TWO', fetch_tpex)):
        try:
            d, it = fn()
            it = {k: v for k, v in it.items() if keep(k)}
            if not it:
                raise RuntimeError('empty after filter')
            asof[name] = d; items.update(it)
            log(name, d, len(it), 'items')
        except Exception as e:  # noqa
            log(name, 'failed:', repr(e)); errors[name] = repr(e)[:300]
            if old and old.get('asof', {}).get(name):
                asof[name] = old['asof'][name]
                items.update({k: v for k, v in old.get('items', {}).items() if (v[3] if len(v) > 3 else None) == name})
    # 美股 + 匯率
    try:
        us_codes = [r[0] for r in (json.load(open(os.path.join(ROOT, 'data', 'tw', 'index.json'), encoding='utf-8')).get('list') or []) if r[2] == 'US']
    except Exception:
        us_codes = []
    if us_codes:
        try:
            d, it = fetch_us(us_codes)
            if it:
                asof['US'] = d; items.update(it); log('US', d, len(it), 'items of', len(us_codes))
        except Exception as e:  # noqa
            log('US failed:', repr(e)); errors['US'] = repr(e)[:300]
    fx = None
    try:
        fx = fetch_fx(); log('fx', fx)
    except Exception as e:  # noqa
        log('fx failed:', repr(e)); errors['FX'] = repr(e)[:300]
        if old and old.get('fx'):
            fx = old['fx']
    if not items:
        log('nothing fetched; keeping existing'); return 1
    if 'TW' in asof and not asof['TW']:
        now_tpe = dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))
        asof['TW'] = asof.get('TWO') or (now_tpe.date().isoformat() if now_tpe.hour * 60 + now_tpe.minute >= 14 * 60 + 30 else '')
        RWD_NOTE.append('TW date fallback=' + asof['TW'])
    # 日期沒前進就不覆蓋
    if old and old.get('asof') and set(asof) == set(old['asof']) and all(asof.get(k, '') <= old['asof'].get(k, '') for k in asof) and old.get('items'):
        log('no newer date than existing', old['asof'], '; not rewriting'); return 0
    out = dict(schema='bnasdaq-tw-latest/1', asof=asof, updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               source='證交所 STOCK_DAY_ALL（上市）、櫃買中心 OpenAPI（上櫃）、Yahoo Finance（美股、匯率）', errors=errors, notes=RWD_NOTE, fx=fx, items=items)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    log('written', OUT, asof, len(items), 'items')
    return 0


if __name__ == '__main__':
    sys.exit(main())
