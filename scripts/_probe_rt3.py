#!/usr/bin/env python3
"""暫時性實測第 3 輪（只在 probe 分支）：鉅亨網個股頁用哪些 API（成交明細、分價量）。"""
import gzip, json, re, sys, time, urllib.error, urllib.request
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
def get(url, headers=None, timeout=10, origin=None):
    h = {'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}
    if origin: h['Origin'] = origin
    h.update(headers or {})
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
names, ctx = set(), set()
pat = r'(?:https?:)?//[a-z0-9.\-]*cnyes\.com/[A-Za-z0-9_/:\-.$\{\}]*api[A-Za-z0-9_/:\-.$\{\}]*|/(?:ws|mi)/api/v\d/[A-Za-z0-9_/:\-.$\{\}]+|["\'`]/?api/v\d/[A-Za-z0-9_/:\-.$\{\}]+'
t_end = time.time() + 200
for page in ['https://www.cnyes.com/twstock/2330', 'https://invest.cnyes.com/twstock/TWS/2330', 'https://www.cnyes.com/twstock/2330/realtime/tick']:
    st, hd, body = get(page, headers={'Accept': 'text/html'}); t = body.decode('utf8', 'replace')
    P(f'\n== page {page} status {st} len {len(body)} title {re.findall(r"<title>([^<]*)", t)[:1]}')
    names |= set(re.findall(pat, t))
    srcs = sorted(set(re.findall(r'(?:src|href)="([^"]+\.js[^"]*)"', t)))
    P('   scripts', len(srcs))
    for s in srcs:
        if time.time() > t_end: P('   time up'); break
        if s.startswith('//'): s = 'https:' + s
        elif s.startswith('/'): s = re.match(r'https://[^/]+', page).group(0) + s
        st2, hd2, b2 = get(s); b = b2.decode('utf8', 'replace')
        found = set(re.findall(pat, b)); names |= found
        for m in re.finditer(r'(?i)tick|priceVolume|pricevol|dealDetail|分價', b):
            ctx.add(b[max(0, m.start() - 70):m.end() + 90].replace('\n', ' '))
        P('   ', st2, len(b2), s[-70:], '| api', len(found))
P('\n== api paths found:')
for n in sorted(names): P('  ', n[:200])
P('\n== contexts (tick / priceVolume):', len(ctx))
for c in sorted(ctx)[:120]: P('  ', c[:260])
