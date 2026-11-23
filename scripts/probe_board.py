#!/usr/bin/env python3
"""暫時性實測（不是網站的一部分）：指數／ETF／期貨／匯率／商品／加密的最新報價，與新聞來源，從 GitHub runner 測。"""
import concurrent.futures as cf, datetime as dt, json, time, urllib.error, urllib.request, xml.etree.ElementTree as ET_
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York')
UA = 'Mozilla/5.0 (BNASDAQ heatmap fetch)'
BOARD = ['^NDX', '^SOX', '^GSPC', '^DJI', '^RUT', '^IXIC', '^VIX', 'DX-Y.NYB', '^TNX', '^TYX', '^FVX', '^IRX', '2YY=F', 'JPY=X', 'EURUSD=X', 'TWD=X',
         'CL=F', 'BZ=F', 'GC=F', 'SI=F', 'BTC-USD', 'NQ=F', 'ES=F', 'YM=F', 'RTY=F', 'QQQ', 'SPY', 'DIA', 'IWM', 'SOXX', 'SOXQ', 'SMH', 'ONEQ', 'TSM', 'ANT', '2222.SR', 'BRK-B']


def get(url, ua=UA, timeout=20, accept='application/json, text/plain, */*'):
    req = urllib.request.Request(url, headers={'User-Agent': ua, 'Accept': accept, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8', 'Origin': 'https://bnasdaq.com'})
    t0 = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        return r.status, r.read(), time.time() - t0, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300], time.time() - t0, {k.lower(): v for k, v in (e.headers or {}).items()}
    except Exception as e:  # noqa
        return 0, repr(e).encode()[:300], time.time() - t0, {}


def et(x):
    try:
        return dt.datetime.fromtimestamp(int(x), ET).strftime('%m-%d %H:%M')
    except Exception:
        return None


def spark(syms, q):
    url = 'https://query2.finance.yahoo.com/v7/finance/spark?symbols=' + ','.join(urllib.request.quote(s) for s in syms) + q + f'&_={int(time.time())}'
    st, b, el, h = get(url)
    out = {}
    if st != 200:
        print('spark', st, b[:200]); return out
    for r in (json.loads(b).get('spark') or {}).get('result') or []:
        try:
            resp = r['response'][0]; m = resp['meta']
            ts = resp.get('timestamp') or []; cl = (((resp.get('indicators') or {}).get('quote') or [{}])[0].get('close')) or []
            bars = [(int(t), c) for t, c in zip(ts, cl) if c is not None]
            out[r['symbol']] = dict(m=m, bars=bars)
        except Exception as e:  # noqa
            out[str(r.get('symbol'))] = {'err': repr(e)[:100]}
    return out


def main():
    now = time.time(); today = dt.datetime.fromtimestamp(now, ET).date()
    print('ET now', et(now))
    reg, ext = {}, {}
    for i in range(0, len(BOARD), 20):
        reg.update(spark(BOARD[i:i + 20], '&range=5d&interval=1d'))
        ext.update(spark(BOARD[i:i + 20], '&range=1d&interval=5m&includePrePost=true'))
    print('sym        | rmp         rmt(ET)      | prevDailyClose  chgVsPrev | cpc       | type tz              | 1d5m-prepost: n today-bars, last(ET,close), pre-bars')
    for s in BOARD:
        r = reg.get(s, {}); m = r.get('m') or {}; bars = r.get('bars') or []
        rmt = m.get('regularMarketTime'); rmp = m.get('regularMarketPrice')
        prev = None
        if rmt:
            d0 = dt.datetime.fromtimestamp(rmt, ET).date()
            pb = [c for t, c in bars if dt.datetime.fromtimestamp(t, ET).date() < d0]
            prev = pb[-1] if pb else None
        chg = (rmp / prev - 1) * 100 if rmp and prev else None
        x = ext.get(s, {}); xb = x.get('bars') or []
        tb = [(t, c) for t, c in xb if dt.datetime.fromtimestamp(t, ET).date() == today]
        pre = [(t, c) for t, c in tb if (dt.datetime.fromtimestamp(t, ET).hour, dt.datetime.fromtimestamp(t, ET).minute) < (9, 30)]
        print(f'{s:10s} | {rmp!s:11s} {et(rmt)!s:12s} | {prev!s:15s} {("%+.2f%%" % chg) if chg is not None else "-":9s} | {m.get("chartPreviousClose")!s:9s} | {m.get("instrumentType")} {m.get("exchangeTimezoneName")} | '
              f'{len(tb)} {(et(tb[-1][0]), round(tb[-1][1], 4)) if tb else "-"} pre={len(pre)} {(et(pre[-1][0]), round(pre[-1][1], 4)) if pre else ""}', flush=True)
    m0 = (reg.get('^NDX') or {}).get('m') or {}
    print('NDX meta keys', sorted(m0.keys()))
    # 新聞來源
    news = [
        ('cnyes wd_stock', 'https://api.cnyes.com/media/api/v1/newslist/category/wd_stock?limit=10'),
        ('cnyes us_stock', 'https://api.cnyes.com/media/api/v1/newslist/category/us_stock?limit=10'),
        ('cnyes headline', 'https://api.cnyes.com/media/api/v1/newslist/category/headline?limit=10'),
        ('google 美股', 'https://news.google.com/rss/search?q=%E7%BE%8E%E8%82%A1%20when%3A1d&hl=zh-TW&gl=TW&ceid=TW%3Azh-Hant'),
        ('cnbc top', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114'),
        ('yahoo rss', 'https://finance.yahoo.com/news/rssindex'),
        ('marketwatch', 'https://feeds.content.dowjones.io/public/rss/mw_topstories'),
    ]
    for nm, u in news:
        st, b, el, h = get(u, accept='application/json, application/rss+xml, application/xml, text/xml, */*')
        info = f'{nm:16s} HTTP {st} {len(b)}B {el:.2f}s CORS={h.get("access-control-allow-origin")} type={h.get("content-type")}'
        items = []
        try:
            if b[:1] in (b'{', b'['):
                j = json.loads(b)
                arr = ((j.get('items') or {}).get('data')) or (j.get('data') or {}).get('items') or []
                if arr:
                    print('  cnyes item keys:', sorted(arr[0].keys())[:40])
                for a in arr[:4]:
                    items.append((a.get('publishAt'), a.get('title'), a.get('newsId'), a.get('categoryName')))
            else:
                root = ET_.fromstring(b)
                for it in root.iter('item'):
                    src = it.find('source')
                    items.append((it.findtext('pubDate'), it.findtext('title'), (it.findtext('link') or '')[:90], src.text if src is not None else None))
                    if len(items) >= 4:
                        break
                info += f' items={sum(1 for _ in root.iter("item"))}'
        except Exception as e:  # noqa
            info += f' parse-error {e!r}'[:120]
        print(info)
        for x in items:
            print('   ', x)


if __name__ == '__main__':
    main()
