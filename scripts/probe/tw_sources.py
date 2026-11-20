#!/usr/bin/env python3
"""一次性探測（2026-11-20）：台股全上市／全上櫃熱力圖要用的公開資料來源，記錄欄位與樣本，結果存成 artifact。用完即刪。"""
import json, re, urllib.request, sys, os, time, threading, concurrent.futures as cf
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
out = {}
os.makedirs('probe_out', exist_ok=True)
LK = threading.Lock()
def save():
    with LK:
        json.dump(out, open('probe_out/tw_sources.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
def get(url, headers=None, raw=False):
    h = {'User-Agent': UA, 'Accept': '*/*'}; h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
        b = r.read(); return (r.status, b) if raw else (r.status, json.loads(b))
def probe(name, url, headers=None):
    t0 = time.time()
    try:
        st, j = get(url, headers)
        rows = j if isinstance(j, list) else (j.get('data') or j.get('aaData') or j.get('tables') or j)
        info = {'status': st, 'type': type(j).__name__}
        if isinstance(j, dict): info['top_keys'] = list(j.keys())[:20]
        if isinstance(rows, list):
            info['n'] = len(rows); info['sample'] = rows[:3]
            if rows and isinstance(rows[0], dict): info['keys'] = list(rows[0].keys())
        else:
            info['sample'] = str(j)[:3000]
        if isinstance(j, dict):
            for k in ('fields', 'date', 'stat', 'title'):
                if k in j: info[k] = j[k]
            if 'tables' in j and isinstance(j['tables'], list):
                info['tables'] = [{'title': t.get('title'), 'fields': t.get('fields'), 'n': len(t.get('data') or []), 'sample': (t.get('data') or [])[:3], 'date': t.get('date')} for t in j['tables'][:3]]
        info['sec'] = round(time.time() - t0, 1); out[name] = info
    except Exception as e:
        out[name] = {'error': repr(e)[:300], 'sec': round(time.time() - t0, 1)}
    save()
JOBS = []
def job(f, *a): JOBS.append((f, a))
def isin(mode):
    t0 = time.time()
    try:
        st, b = get(f'https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}', raw=True)
        t = b.decode('cp950', 'replace')
        rows = re.findall(r'<tr><td bgcolor=#FAFAD2>(.*?)</tr>', t, re.S)
        cells = [re.findall(r'<td[^>]*>(.*?)</td>', '<td>' + r, re.S) for r in rows]
        stocks = [c for c in cells if c and re.match(r'^\d{4}\u3000', c[0].strip())]
        out['isin_' + mode] = {'status': st, 'bytes': len(b), 'rows': len(cells), 'four_digit': len(stocks), 'sample': cells[:3] + stocks[:3],
                               'industries': sorted({(c[4] if len(c) > 4 else '').strip() for c in stocks}), 'sec': round(time.time() - t0, 1)}
    except Exception as e:
        out['isin_' + mode] = {'error': repr(e)[:300], 'sec': round(time.time() - t0, 1)}
    save()
probe = (lambda f: (lambda *a: job(f, *a)))(probe)
probe('twse_t187ap03_L', 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L')
probe('twse_day_all_rwd', 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?response=json')
probe('tpex_t187ap03_O', 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O')
probe('tpex_daily_close', 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes')
probe('tpex_rwd_daily', 'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?response=json')
job(isin, '2'); job(isin, '4')
probe('yahoo_tw_mixed', 'https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;symbols=2330.TW,6488.TWO,8299.TWO,5347.TWO',
      {'Referer': 'https://tw.stock.yahoo.com/', 'Accept-Language': 'zh-TW,zh;q=0.9'})
ex = cf.ThreadPoolExecutor(len(JOBS)); fs = [ex.submit(f, *a) for f, a in JOBS]
cf.wait(fs, timeout=240)
for (f, a), x in zip(JOBS, fs):
    if not x.done(): out.setdefault(a[0] if f is not isin else 'isin_' + a[0], {'error': 'timeout 240s'})
save()
print({k: (v.get('n') or v.get('four_digit') or v.get('error') or v.get('status'), v.get('sec')) for k, v in out.items()}, flush=True)
os._exit(0)
