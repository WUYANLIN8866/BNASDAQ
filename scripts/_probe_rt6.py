#!/usr/bin/env python3
"""暫時性實測第 6 輪（只在 probe 分支）：鉅亨網關鍵字新聞 API（ACAO *）的分頁上限、時間範圍參數、用代號查的效果。"""
import gzip, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
OUT = 'fx'; os.makedirs(OUT, exist_ok=True)
def get(url, timeout=15):
    h = {'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8', 'Origin': 'https://bnasdaq.com'}
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout); st, hd, body = r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        st, hd, body = e.code, e.headers, e.read()
    except Exception as e:
        return 0, {}, repr(e).encode()
    if (hd.get('Content-Encoding') or '') == 'gzip':
        try: body = gzip.decompress(body)
        except Exception: pass
    return st, hd, body
P = lambda *a: print(*a, flush=True)
T = lambda s: time.strftime('%Y-%m-%d %H:%M', time.gmtime(s + 8 * 3600))
E = 'https://ess.api.cnyes.com/ess/api/v1/news/keyword?'
now = int(time.time()); P('time', T(now))
def kw(name, params, save=False):
    u = E + urllib.parse.urlencode(params)
    st, hd, body = get(u)
    if save: open(os.path.join(OUT, name + '.json'), 'wb').write(body)
    try:
        d = json.loads(body)['data']; it = d.get('items') or []
        ts = [x.get('publishAt') or 0 for x in it]
        srt = all(ts[i] >= ts[i + 1] for i in range(len(ts) - 1))
        P(f'== {name} | {st} ACAO={hd.get("Access-Control-Allow-Origin")} total {d.get("total")} lastPage {d.get("lastPage")} n {len(it)} | newest {T(ts[0]) if ts else None} oldest {T(ts[-1]) if ts else None} | 由新到舊 {srt} | {[re.sub("<[^>]+>", "", x.get("title") or "")[:26] for x in it[:3]]}')
    except Exception as e:
        P(f'== {name} | {st} len {len(body)} | {body[:200].decode("utf8", "replace")} | {repr(e)[:60]}')
kw('kw_tsmc_30_p1', {'q': '台積電', 'limit': 30, 'page': 1}, save=True)
kw('kw_tsmc_30_p34', {'q': '台積電', 'limit': 30, 'page': 34})
kw('kw_tsmc_30_p50', {'q': '台積電', 'limit': 30, 'page': 50})
kw('kw_tsmc_100_p1', {'q': '台積電', 'limit': 100, 'page': 1})
kw('kw_tsmc_100_p10', {'q': '台積電', 'limit': 100, 'page': 10})
for a, b in [('startAt', 'endAt'), ('from', 'to'), ('start', 'end'), ('since', 'until'), ('publishAtStart', 'publishAtEnd')]:
    kw(f'kw_range_{a}', {'q': '台積電', 'limit': 5, 'page': 1, a: now - 86400 * 200, b: now - 86400 * 180})
kw('kw_code_tw', {'q': '2330-TW', 'limit': 30, 'page': 1}, save=True)
kw('kw_code_tw2', {'q': '2330', 'limit': 30, 'page': 1})
kw('kw_code_tw3', {'q': '(2330-TW)', 'limit': 5, 'page': 1})
kw('kw_1216', {'q': '統一', 'limit': 30, 'page': 1})
kw('kw_1216_code', {'q': '1216-TW', 'limit': 30, 'page': 1}, save=True)
kw('kw_1216_code_p2', {'q': '1216-TW', 'limit': 30, 'page': 2})
kw('kw_1216_code_last', {'q': '1216-TW', 'limit': 30, 'page': 30})
kw('kw_6488_code', {'q': '6488-TW', 'limit': 30, 'page': 1})
kw('kw_aapl_code', {'q': 'AAPL-US', 'limit': 30, 'page': 1}, save=True)
kw('kw_aapl_code_p20', {'q': 'AAPL-US', 'limit': 30, 'page': 20})
kw('kw_aapl_name', {'q': '蘋果', 'limit': 30, 'page': 1})
kw('kw_nvda_code', {'q': 'NVDA-US', 'limit': 30, 'page': 1})
kw('kw_brk', {'q': 'BRK.B-US', 'limit': 30, 'page': 1})
kw('kw_sort', {'q': '台積電', 'limit': 5, 'page': 1, 'sort': 'publishAt'})
# 其他可能有 ACAO 的鉅亨新聞端點
for nm, u in [('news_ws_sym', 'https://ws.api.cnyes.com/ws/api/v1/news/TWS:2330:STOCK?limit=5'), ('news_mi', 'https://marketinfo.api.cnyes.com/mi/api/v1/news/TWS:2330:STOCK'),
              ('news_api_v1', 'https://api.cnyes.com/media/api/v1/newslist/TWS:2330:STOCK/symbolNews?page=1&limit=5'), ('news_api_opt', 'https://news.cnyes.com/api/v1/newslist/TWS:2330:STOCK/symbolNews?page=1&limit=5')]:
    st, hd, body = get(u); P(f'== {nm} | {st} ACAO={hd.get("Access-Control-Allow-Origin") if hd else None} len {len(body)} | {body[:160].decode("utf8", "replace")}')
