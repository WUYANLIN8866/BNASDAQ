#!/usr/bin/env python3
"""暫時性實測（不是網站的一部分）：從 GitHub runner 測 Yahoo 美股盤前／盤後報價的取得方式。"""
import concurrent.futures as cf
import datetime as dt
import http.cookiejar
import json
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
UA = 'Mozilla/5.0 (BNASDAQ heatmap fetch)'
BUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
D = json.load(open('data/heatmap/latest.json', encoding='utf-8'))
OFF, ALL = {}, []
for k in ('ndx', 'spx', 'sox'):
    for t in D['sets'][k]['tiles']:
        if t[0] not in OFF:
            OFF[t[0]] = t[5]; ALL.append(t[0])
A = ALL[:20]


def get(url, ua=UA, opener=None, timeout=20):
    h = {'User-Agent': ua, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9'}
    req = urllib.request.Request(url, headers=h)
    t0 = time.time()
    try:
        r = (opener.open if opener else urllib.request.urlopen)(req, timeout=timeout)
        return r.status, r.read(), time.time() - t0, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:400], time.time() - t0, {k.lower(): v for k, v in (e.headers or {}).items()}
    except Exception as e:  # noqa
        return 0, repr(e).encode()[:300], time.time() - t0, {}


def et(x):
    try:
        return dt.datetime.fromtimestamp(int(x), ET).strftime('%m-%d %H:%M:%S')
    except Exception:
        return None


def spark(syms, rng, iv, prepost, host='query2'):
    url = f'https://{host}.finance.yahoo.com/v7/finance/spark?symbols={",".join(syms)}&range={rng}&interval={iv}' + ('&includePrePost=true' if prepost else '') + f'&_={time.time():.0f}'
    st, b, el, h = get(url)
    info = {'url': url.split('?')[1][:90], 'status': st, 'bytes': len(b), 'sec': round(el, 2), 'cache': h.get('cache-control')}
    res = {}
    if st != 200:
        info['body'] = b[:200].decode('utf8', 'replace'); return info, res
    j = json.loads(b)
    for r in (j.get('spark') or {}).get('result') or []:
        try:
            resp = r['response'][0]; m = resp['meta']
            ts = resp.get('timestamp') or []
            cl = (((resp.get('indicators') or {}).get('quote') or [{}])[0].get('close')) or []
            bars = [(int(t), c) for t, c in zip(ts, cl) if c is not None]
            ctp = m.get('currentTradingPeriod') or {}
            g = lambda k: ((ctp.get(k) or {}).get('start'), (ctp.get(k) or {}).get('end'))
            res[r['symbol']] = dict(rmp=m.get('regularMarketPrice'), rmt=m.get('regularMarketTime'), cpc=m.get('chartPreviousClose'), pc=m.get('previousClose'),
                                    pre=g('pre'), reg=g('regular'), post=g('post'), nts=len(ts), nbar=len(bars),
                                    first=bars[0] if bars else None, last=bars[-1] if bars else None, keys=sorted(m.keys()), bars=bars)
        except Exception as e:  # noqa
            res[str(r.get('symbol'))] = {'err': repr(e)[:120]}
    return info, res


def crumb():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    s1 = get('https://fc.yahoo.com', ua=BUA, opener=op)
    s2 = get('https://query2.finance.yahoo.com/v1/test/getcrumb', ua=BUA, opener=op)
    c = s2[1].decode('utf8', 'replace').strip() if s2[0] == 200 else None
    return op, c, {'fc.yahoo.com': s1[0], 'cookies': [x.name for x in cj], 'getcrumb': s2[0], 'crumb': (c[:3] + '…' + str(len(c))) if c else s2[1][:120].decode('utf8', 'replace')}


QF = ['marketState', 'regularMarketPrice', 'regularMarketTime', 'regularMarketPreviousClose', 'preMarketPrice', 'preMarketChangePercent', 'preMarketTime',
      'postMarketPrice', 'postMarketChangePercent', 'postMarketTime']


def quote(syms, op=None, c=None, ua=UA):
    url = 'https://query2.finance.yahoo.com/v7/finance/quote?symbols=' + ','.join(syms) + (f'&crumb={c}' if c else '')
    st, b, el, h = get(url, ua=ua, opener=op)
    info = {'status': st, 'bytes': len(b), 'sec': round(el, 2), 'crumb': bool(c)}
    if st != 200:
        info['body'] = b[:200].decode('utf8', 'replace'); return info, {}
    out = {}
    for q in ((json.loads(b).get('quoteResponse') or {}).get('result') or []):
        out[q.get('symbol')] = {k: q.get(k) for k in QF}
    return info, out


def rnd(tag, full=False):
    now = time.time()
    print(f'\n=================== ROUND {tag}  ET {et(now)} ===================', flush=True)
    i1, s1 = spark(A, '1d', '1m', True)
    i5, s5 = spark(A, '1d', '5m', True)
    ir, sr = spark(A, '5d', '1d', False)
    i5n, s5n = spark(A, '1d', '5m', False)
    iq0, q0 = quote(A)
    op, c, ci = crumb()
    iq1, q1 = quote(A, op, c, ua=BUA) if c else ({'status': 'no crumb'}, {})
    for nm, i in (('spark 1d/1m prepost', i1), ('spark 1d/5m prepost', i5), ('spark 5d/1d', ir), ('spark 1d/5m regular-only', i5n), ('quote no crumb', iq0), ('crumb', ci), ('quote crumb', iq1)):
        print(f'{nm:26s}', json.dumps(i, ensure_ascii=False), flush=True)
    any1 = next(iter(s1.values()), {}) if s1 else {}
    if any1:
        print('meta keys (1m prepost):', any1.get('keys'))
        print('ctp pre', [et(x) for x in any1.get('pre') or ()], 'reg', [et(x) for x in any1.get('reg') or ()], 'post', [et(x) for x in any1.get('post') or ()])
    print('sym   | off_close | rmp      rmt          cpc      pc       | 1m n/valid first..last(ET,close)            | 5m last           | 5m-noPP last      | quote(crumb) state pre(px,chg,t) post(px,chg,t)')
    for s_ in A:
        a, b5, n5, q = s1.get(s_, {}), s5.get(s_, {}), s5n.get(s_, {}), q1.get(s_) or q0.get(s_) or {}
        f = lambda x: f'{et(x[0])} {x[1]:.4f}' if x else '-'
        print(f'{s_:6s}| {OFF.get(s_)!s:9s} | {a.get("rmp")!s:8s} {et(a.get("rmt"))!s:14s} {a.get("cpc")!s:8s} {a.get("pc")!s:8s} | {a.get("nts")}/{a.get("nbar")} {f(a.get("first"))} .. {f(a.get("last"))} | {f(b5.get("last"))} | {f(n5.get("last"))} | '
              f'{q.get("marketState")} pre({q.get("preMarketPrice")},{q.get("preMarketChangePercent")},{et(q.get("preMarketTime"))}) post({q.get("postMarketPrice")},{q.get("postMarketChangePercent")},{et(q.get("postMarketTime"))}) rmp={q.get("regularMarketPrice")} prev={q.get("regularMarketPreviousClose")}', flush=True)
    # 1m 與 5m 最後一根是否同價（5m 進行中的 K 棒是否即時更新）
    same = sum(1 for s_ in A if s1.get(s_, {}).get('last') and s5.get(s_, {}).get('last') and abs(s1[s_]['last'][1] - s5[s_]['last'][1]) < 1e-9)
    print('1m 與 5m 最後一根收盤相同的檔數：', same, '/', len(A))
    if s1:
        x = s1.get('AAPL') or next(iter(s1.values()))
        bars = x.get('bars') or []
        print('AAPL 1m 最後 6 根：', [(et(t), c) for t, c in bars[-6:]])
    if full:
        bs = [ALL[i:i + 20] for i in range(0, len(ALL), 20)]
        t0 = time.time(); tot = {'ok': 0, 'err': {}, 'bytes': 0, 'syms': 0, 'with_today_pre': 0, 'with_today_post': 0}
        today = dt.datetime.fromtimestamp(now, ET).date()
        with cf.ThreadPoolExecutor(4) as ex:
            for info, res in ex.map(lambda b: spark(b, '1d', '5m', True), bs):
                if info['status'] == 200:
                    tot['ok'] += 1
                else:
                    tot['err'][str(info['status'])] = tot['err'].get(str(info['status']), 0) + 1
                tot['bytes'] += info['bytes']; tot['syms'] += len(res)
                for r in res.values():
                    for t, c in r.get('bars') or []:
                        d_ = dt.datetime.fromtimestamp(t, ET)
                        if d_.date() == today and (d_.hour, d_.minute) < (9, 30):
                            tot['with_today_pre'] += 1; break
                    for t, c in r.get('bars') or []:
                        d_ = dt.datetime.fromtimestamp(t, ET)
                        if d_.date() == today and (d_.hour, d_.minute) >= (16, 0):
                            tot['with_today_post'] += 1; break
        tot['sec'] = round(time.time() - t0, 2); tot['batches'] = len(bs); tot['universe'] = len(ALL)
        print('FULL universe spark 1d/5m prepost:', json.dumps(tot), flush=True)
        t0 = time.time(); tot1 = {'ok': 0, 'err': {}, 'bytes': 0}
        with cf.ThreadPoolExecutor(4) as ex:
            for info, res in ex.map(lambda b: spark(b, '1d', '1m', True), bs):
                if info['status'] == 200:
                    tot1['ok'] += 1
                else:
                    tot1['err'][str(info['status'])] = tot1['err'].get(str(info['status']), 0) + 1
                tot1['bytes'] += info['bytes']
        tot1['sec'] = round(time.time() - t0, 2)
        print('FULL universe spark 1d/1m prepost:', json.dumps(tot1), flush=True)
        if c:
            t0 = time.time(); okq, nq, errq = 0, 0, {}
            for i in range(0, len(ALL), 100):
                info, out = quote(ALL[i:i + 100], op, c, ua=BUA)
                if info['status'] == 200:
                    okq += 1; nq += len(out)
                else:
                    errq[str(info['status'])] = errq.get(str(info['status']), 0) + 1
            print('FULL universe quote(crumb) by 100:', json.dumps({'ok_batches': okq, 'symbols': nq, 'err': errq, 'sec': round(time.time() - t0, 2)}), flush=True)


def wait_until(h, m):
    now = dt.datetime.now(ET)
    tgt = now.replace(hour=h, minute=m, second=0, microsecond=0)
    s = (tgt - now).total_seconds()
    if s > 0:
        print(f'… 等到 ET {h:02d}:{m:02d}（{s:.0f} 秒）', flush=True); time.sleep(s)


if __name__ == '__main__':
    print('universe', len(ALL), 'A', A)
    rnd('0 start', full=True)
    for hh, mm, full in ((4, 2, False), (4, 7, False), (4, 13, True)):
        if dt.datetime.now(ET) < dt.datetime.now(ET).replace(hour=hh, minute=mm):
            wait_until(hh, mm); rnd(f'{hh:02d}:{mm:02d}', full=full)
