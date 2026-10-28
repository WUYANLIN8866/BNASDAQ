#!/usr/bin/env python3
"""BNASDAQ｜每日更新公開市場資料 data/market.json（只有 QQQ 價格資料，沒有任何策略規則）。

口徑（與專案資料檔一致）：
  U(t)  = 還原股息與分割的收盤價，接在專案檔最後一個完整月（base.last_complete）之後：
          k = U_base(末月最後交易日) ÷ AdjClose_yahoo(同一天)；U(t) = k × AdjClose(t)
  H / L = k × High(t) × AdjClose(t) ÷ Close(t)（低價同理），再彙整成月線最高／最低
  完整月 = 資料裡已出現下一個月的交易日；最後一個月為「進行中」(current)，記錄到目前為止的 U／H／L 與最新收盤
來源順序：Yahoo chart API → yfinance → stooq（stooq 無還原價，只在沒有除息時可用；用後標註）。
任何一步失敗就保留原本的 data/market.json（不覆蓋）。

用法：python3 scripts/fetch_market.py            （自動抓資料）
      python3 scripts/fetch_market.py --manual rows.csv   （手動提供 date,open,high,low,close,adjclose 列，供初次建站）
"""
import json, os, sys, datetime as dt, urllib.request, io, csv, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'data', 'market_base.json')
OUT = os.path.join(ROOT, 'data', 'market.json')
TICKER = 'QQQ'


def log(*a):
    print('[fetch_market]', *a, flush=True)


def load_base():
    with open(BASE, encoding='utf-8') as f:
        return json.load(f)


# ------------------------------------------------------------------ sources
def src_yahoo_chart(start):
    p1 = int(dt.datetime(start.year, start.month, start.day, tzinfo=dt.timezone.utc).timestamp())
    p2 = int(dt.datetime.now(dt.timezone.utc).timestamp()) + 86400
    url = (f'https://query2.finance.yahoo.com/v8/finance/chart/{TICKER}?period1={p1}&period2={p2}'
           f'&interval=1d&events=div%2Csplit&includeAdjustedClose=true')
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (BNASDAQ market fetch)'})
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.load(r)
    res = j['chart']['result'][0]
    ts = res['timestamp']; q = res['indicators']['quote'][0]; adj = res['indicators']['adjclose'][0]['adjclose']
    rows = []
    for i, t in enumerate(ts):
        if q['close'][i] is None or adj[i] is None:
            continue
        d = dt.datetime.fromtimestamp(t, tz=dt.timezone(dt.timedelta(hours=-4))).date()  # NY date
        rows.append(dict(date=d.isoformat(), open=q['open'][i], high=q['high'][i], low=q['low'][i], close=q['close'][i], adjclose=adj[i]))
    return rows, 'Yahoo Finance chart API（還原收盤）'


def src_yfinance(start):
    import yfinance as yf
    df = yf.Ticker(TICKER).history(start=start.isoformat(), auto_adjust=False, actions=False)
    rows = []
    for idx, r in df.iterrows():
        rows.append(dict(date=idx.date().isoformat(), open=float(r['Open']), high=float(r['High']), low=float(r['Low']),
                         close=float(r['Close']), adjclose=float(r['Adj Close'])))
    return rows, 'yfinance（還原收盤）'


def src_stooq(start):
    url = f'https://stooq.com/q/d/l/?s={TICKER.lower()}.us&i=d'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        txt = r.read().decode('utf-8')
    rows = []
    for rec in csv.DictReader(io.StringIO(txt)):
        if rec['Date'] >= start.isoformat():
            rows.append(dict(date=rec['Date'], open=float(rec['Open']), high=float(rec['High']), low=float(rec['Low']),
                             close=float(rec['Close']), adjclose=float(rec['Close'])))
    return rows, 'stooq（原始收盤，未還原股息；僅在期間無除息時等同）'


def src_manual(path):
    rows = []
    for rec in csv.DictReader(open(path, encoding='utf-8')):
        rows.append(dict(date=rec['date'], open=float(rec['open']), high=float(rec['high']), low=float(rec['low']),
                         close=float(rec['close']), adjclose=float(rec.get('adjclose') or rec['close'])))
    return rows, '手動提供（stockanalysis.com 歷史價格表）'


# ------------------------------------------------------------------ build
def build(base, rows, source):
    last = base['last_complete']                    # e.g. 2026-09
    lastrow = base['months'][-1]
    assert lastrow['m'] == last
    rows = sorted(rows, key=lambda r: r['date'])
    # anchor day = last trading day of the base month present in the fetched rows
    anchor = [r for r in rows if r['date'][:7] == last]
    if not anchor:
        raise RuntimeError(f'fetched rows do not cover the base month {last}; cannot scale')
    a = anchor[-1]
    if abs(a['close'] - lastrow['c']) > 0.011:
        raise RuntimeError(f'raw close mismatch on {a["date"]}: fetched {a["close"]} vs project {lastrow["c"]}')
    k = lastrow['U'] / a['adjclose']
    after = [r for r in rows if r['date'][:7] > last]
    if not after:
        raise RuntimeError('no rows after the base month')
    months = {}
    for r in after:
        months.setdefault(r['date'][:7], []).append(r)
    keys = sorted(months)
    ext, current = [], None
    for i, m in enumerate(keys):
        rs = months[m]
        f = [r['adjclose'] / r['close'] for r in rs]
        U = k * rs[-1]['adjclose']
        Hh = max(k * r['high'] * fi for r, fi in zip(rs, f)); Ll = min(k * r['low'] * fi for r, fi in zip(rs, f))
        rec = dict(m=m, U=U, H=Hh, L=Ll, o=rs[0]['open'], c=rs[-1]['close'], src='Qy', days=len(rs))
        if i < len(keys) - 1:
            ext.append(rec)
        else:
            rec['asof'] = rs[-1]['date']
            rec['daily'] = [dict(d=r['date'], c=r['close'], U=k * r['adjclose']) for r in rs]
            current = rec
    out = dict(schema='bnasdaq-market/1', base_last=last, k=k, ext=ext, current=current, asof=current['asof'],
               updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), source=source,
               note='公開市場資料（QQQ 還原收盤、月高低），不含任何策略規則。', months=base['months'])
    return out


def main():
    base = load_base()
    y, mth = map(int, base['last_complete'].split('-'))
    start = dt.date(y, mth, 1)
    rows = None; source = None
    if len(sys.argv) >= 3 and sys.argv[1] == '--manual':
        rows, source = src_manual(sys.argv[2])
    else:
        for fn in (src_yahoo_chart, src_yfinance, src_stooq):
            try:
                rows, source = fn(start)
                if rows and len(rows) > 5:
                    log('source OK:', fn.__name__, len(rows), 'rows', rows[-1]['date'])
                    break
                log('source empty:', fn.__name__)
                rows = None
            except Exception as e:  # noqa
                log('source failed:', fn.__name__, repr(e)); rows = None
    if not rows:
        log('all sources failed; keeping existing market.json'); return 1
    try:
        out = build(base, rows, source)
    except Exception as e:  # noqa
        log('build failed; keeping existing market.json:', repr(e)); return 1
    # sanity: do not go backwards in time
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
            if old.get('asof', '') > out['asof']:
                log('fetched data older than existing (', old.get('asof'), '>', out['asof'], '); keeping existing'); return 1
        except Exception:
            pass
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    log('written', OUT, 'asof', out['asof'], 'ext months', [e['m'] for e in out['ext']], 'current', out['current']['m'], 'U', round(out['current']['U'], 4))
    return 0


if __name__ == '__main__':
    sys.exit(main())
