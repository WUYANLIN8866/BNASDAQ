#!/usr/bin/env python3
"""暫時性探測：從 GitHub runner 實測盤中行情來源（回應、欄位、延遲、速度）。結果寫到 out/probe.json。用完整個分支會刪掉。"""
import concurrent.futures as cf, http.cookiejar, json, os, sys, time, urllib.error, urllib.request

YUA = 'Mozilla/5.0 (BNASDAQ heatmap fetch)'
BUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
S = json.load(open('syms.json'))
OUT = {'started': time.time(), 'tests': {}}


def fetch(url, ua=YUA, headers=None, timeout=20, opener=None):
    t0 = time.time()
    h = {'User-Agent': ua, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9'}
    h.update(headers or {})
    try:
        req = urllib.request.Request(url, headers=h)
        with (opener.open(req, timeout=timeout) if opener else urllib.request.urlopen(req, timeout=timeout)) as r:
            b = r.read()
            return {'ok': True, 'status': r.status, 'ms': round((time.time() - t0) * 1000), 'len': len(b), 'body': b}
    except urllib.error.HTTPError as e:
        return {'ok': False, 'status': e.code, 'ms': round((time.time() - t0) * 1000), 'err': e.read()[:300].decode('utf8', 'replace')}
    except Exception as e:  # noqa
        return {'ok': False, 'status': 0, 'ms': round((time.time() - t0) * 1000), 'err': repr(e)[:200]}


def brief(r, keep=0):
    o = {k: v for k, v in r.items() if k != 'body'}
    if keep and r.get('body') is not None:
        o['text'] = r['body'][:keep].decode('utf8', 'replace')
    return o


def spark_url(syms, host='query2', ver='v7', rng='1d', itv='1d'):
    return f'https://{host}.finance.yahoo.com/{ver}/finance/spark?symbols={",".join(syms)}&range={rng}&interval={itv}'


def parse_spark(body):
    """回傳 {sym: {p, t, prev, cpc, ts_last, c_last, c_prev, n}}（兩種格式都處理）"""
    out = {}
    try:
        j = json.loads(body)
    except Exception:
        return out
    if isinstance(j, dict) and 'spark' in j:
        for r in ((j.get('spark') or {}).get('result') or []):
            try:
                resp = r['response'][0]; m = resp.get('meta') or {}
                ts = resp.get('timestamp') or []; cl = ((resp.get('indicators') or {}).get('quote') or [{}])[0].get('close') or []
                out[r['symbol']] = {'p': m.get('regularMarketPrice'), 't': m.get('regularMarketTime'), 'prev': m.get('previousClose'), 'cpc': m.get('chartPreviousClose'),
                                    'ts_last': ts[-1] if ts else None, 'c_last': cl[-1] if cl else None, 'c_prev': cl[-2] if len(cl) > 1 else None, 'n': len(ts)}
            except Exception as e:  # noqa
                out[r.get('symbol', '?')] = {'err': repr(e)[:80]}
    elif isinstance(j, dict):
        for k, v in j.items():
            if isinstance(v, dict):
                ts = v.get('timestamp') or []; cl = v.get('close') or []
                out[k] = {'p': None, 't': None, 'prev': v.get('previousClose'), 'cpc': v.get('chartPreviousClose'), 'ts_last': ts[-1] if ts else None,
                          'c_last': cl[-1] if cl else None, 'c_prev': cl[-2] if len(cl) > 1 else None, 'n': len(ts)}
    return out


def ages(parsed, now):
    a = sorted(now - v['t'] for v in parsed.values() if isinstance(v.get('t'), (int, float)))
    b = sorted(now - v['ts_last'] for v in parsed.values() if isinstance(v.get('ts_last'), (int, float)))
    q = lambda x, p: (round(x[min(len(x) - 1, int(len(x) * p))]) if x else None)
    return {'n': len(parsed), 'rmt_age_s': {'n': len(a), 'min': q(a, 0), 'p50': q(a, .5), 'p90': q(a, .9), 'max': q(a, .999)},
            'bar_age_s': {'n': len(b), 'min': q(b, 0), 'p50': q(b, .5), 'p90': q(b, .9), 'max': q(b, .999)}}


def t_yahoo_samples():
    T = {}
    mix = ['AAPL', 'NVDA', 'BRK-B', '2330.TW', '2317.TW', '0050.TW']
    for name, kw in (('v7_1d', {}), ('v7_5d', {'rng': '5d'}), ('v8_1d', {'ver': 'v8'}), ('v7_1d_1m', {'itv': '1m'}), ('q1_v7_1d', {'host': 'query1'})):
        r = fetch(spark_url(mix, **kw))
        T[name] = brief(r, keep=(6000 if name != 'v7_1d_1m' else 1500))
        if r.get('ok'):
            T[name]['parsed'] = parse_spark(r['body'])
    for n in (20, 21, 40, 100):
        r = fetch(spark_url(S['us'][:n]))
        T['batch_%d' % n] = dict(brief(r, keep=200), got=len(parse_spark(r['body'])) if r.get('ok') else 0)
    # 瀏覽器 UA 會不會被擋
    r = fetch(spark_url(mix), ua=BUA); T['browser_ua'] = brief(r, keep=120)
    return T


def t_yahoo_full(syms, label, workers):
    batches = [syms[i:i + 20] for i in range(0, len(syms), 20)]
    t0 = time.time(); res = {}; stat = {}
    def one(b):
        r = fetch(spark_url(b), timeout=15)
        return b, r
    with cf.ThreadPoolExecutor(workers) as ex:
        for b, r in ex.map(one, batches):
            stat[str(r['status'])] = stat.get(str(r['status']), 0) + 1
            if r.get('ok'):
                res.update(parse_spark(r['body']))
    now = time.time()
    miss = [s for s in syms if s not in res]
    return {'label': label, 'workers': workers, 'batches': len(batches), 'status': stat, 'sec': round(now - t0, 2), 'missing': miss[:30], 'n_missing': len(miss), 'ages': ages(res, now),
            'sample': {k: res[k] for k in list(res)[:4]}}


def t_mis(cookie):
    codes = S['tw']
    url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' + '%7C'.join('tse_%s.tw' % c for c in codes) + '&json=1&delay=0&_=%d' % int(time.time() * 1000)
    opener = None; pre = None
    if cookie:
        cj = http.cookiejar.CookieJar(); opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        pre = brief(fetch('https://mis.twse.com.tw/stock/index.jsp', ua=BUA, opener=opener, headers={'Accept': 'text/html'}), keep=0)
        pre['cookies'] = [c.name for c in cj]
    r = fetch(url, ua=BUA, opener=opener, headers={'Referer': 'https://mis.twse.com.tw/stock/index.jsp'})
    o = brief(r, keep=0); o['pre'] = pre
    if r.get('ok'):
        try:
            j = json.loads(r['body']); arr = j.get('msgArray') or []
            now = time.time()
            o['top'] = {k: v for k, v in j.items() if k != 'msgArray'}
            o['n'] = len(arr); o['row0'] = arr[0] if arr else None; o['row_last'] = arr[-1] if arr else None
            o['rows'] = [{k: a.get(k) for k in ('c', 'z', 'y', 'o', 'pz', 'oz', 'ot', 't', 'd', 'tlong', 'ts', 'ip', 'i', 'it', 'v', 'tv', 's')} | {'a1': (a.get('a') or '').split('_')[0], 'b1': (a.get('b') or '').split('_')[0]} for a in arr]
            ag = sorted(now - int(a['tlong']) / 1000 for a in arr if str(a.get('tlong') or '').isdigit())
            o['age_s'] = {'n': len(ag), 'min': round(ag[0]) if ag else None, 'p50': round(ag[len(ag) // 2]) if ag else None, 'max': round(ag[-1]) if ag else None}
            o['z_dash'] = sum(1 for a in arr if a.get('z') in (None, '-', ''))
        except Exception as e:  # noqa
            o['parse_err'] = repr(e)[:200]; o['text'] = r['body'][:400].decode('utf8', 'replace')
    return o


def t_screener():
    r = fetch('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&download=true', ua=BUA, headers={'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}, timeout=60)
    o = brief(r)
    if r.get('ok'):
        try:
            rows = (json.loads(r['body']).get('data') or {}).get('rows') or []
            o['n'] = len(rows); o['sample'] = [x for x in rows if x.get('symbol') in ('AAPL', 'NVDA', 'MSFT')]
        except Exception as e:  # noqa
            o['parse_err'] = repr(e)[:200]
    return o


def t_publish():
    """Git Data API：用工作流程自己的權杖，把一個小檔案放到測試分支（只留最新一筆）。量時間、確認權限。"""
    tok = os.environ.get('GITHUB_TOKEN'); repo = os.environ.get('GITHUB_REPOSITORY')
    if not tok or not repo:
        return {'skip': 'no token'}
    api = 'https://api.github.com/repos/' + repo
    def call(method, path, body=None):
        t0 = time.time()
        req = urllib.request.Request(api + path, method=method, data=(json.dumps(body).encode() if body is not None else None),
                                     headers={'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'bnasdaq-probe'})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, json.loads(r.read() or b'{}'), round((time.time() - t0) * 1000), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, {'message': e.read()[:200].decode('utf8', 'replace')}, round((time.time() - t0) * 1000), dict(e.headers)
    out = {'steps': []}
    for k in range(3):
        t0 = time.time()
        payload = json.dumps({'probe': k, 'at': time.time(), 'pad': 'x' * 14000})
        s1, tree, ms1, _ = call('POST', '/git/trees', {'tree': [{'path': 'us.json', 'mode': '100644', 'type': 'blob', 'content': payload}]})
        s2, com, ms2, _ = call('POST', '/git/commits', {'message': 'probe %d' % k, 'tree': tree.get('sha'), 'parents': []})
        s3, ref, ms3, h3 = call('PATCH', '/git/refs/heads/hm-probe-data', {'sha': com.get('sha'), 'force': True})
        if s3 in (404, 422):
            s3, ref, ms3, h3 = call('POST', '/git/refs', {'ref': 'refs/heads/hm-probe-data', 'sha': com.get('sha')})
        out['steps'].append({'tree': [s1, ms1], 'commit': [s2, ms2], 'ref': [s3, ms3, ref.get('message')], 'total_ms': round((time.time() - t0) * 1000), 'remaining': h3.get('X-RateLimit-Remaining') or h3.get('x-ratelimit-remaining'), 'limit': h3.get('X-RateLimit-Limit') or h3.get('x-ratelimit-limit')})
        time.sleep(1)
    s, runs, ms, _ = call('GET', '/actions/runs?status=in_progress&per_page=5')
    out['list_runs'] = [s, ms, [(r.get('id'), r.get('name'), r.get('status')) for r in (runs.get('workflow_runs') or [])]]
    return out


def main():
    T = OUT['tests']
    T['yahoo_samples'] = t_yahoo_samples()
    T['mis_nocookie'] = t_mis(False)
    T['mis_cookie'] = t_mis(True)
    T['yahoo_tw'] = t_yahoo_full([c + '.TW' for c in S['tw']], 'tw50', 3)
    T['yahoo_us_seq'] = t_yahoo_full(S['us'], 'us522', 1)
    T['yahoo_us_par4'] = t_yahoo_full(S['us'], 'us522', 4)
    T['yahoo_us_par8'] = t_yahoo_full(S['us'], 'us522', 8)
    T['screener'] = t_screener()
    T['publish'] = t_publish()
    # 再量兩輪台股，看時間戳有沒有往前走
    T['repeat'] = []
    for k in range(2):
        time.sleep(25)
        T['repeat'].append({'at': time.time(), 'mis': {k2: v for k2, v in t_mis(False).items() if k2 in ('status', 'ms', 'age_s', 'z_dash', 'n')}, 'yahoo_tw': t_yahoo_full([c + '.TW' for c in S['tw']], 'tw50', 3)['ages']})
    OUT['finished'] = time.time()
    os.makedirs('out', exist_ok=True)
    json.dump(OUT, open('out/probe.json', 'w'), ensure_ascii=False, indent=1, default=str)
    print(json.dumps({k: (v.get('status') if isinstance(v, dict) else None) for k, v in T.items()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
