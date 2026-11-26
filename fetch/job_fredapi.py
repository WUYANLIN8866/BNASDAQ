#!/usr/bin/env python3
"""data-26114｜FRED API（需要 repo Secret FRED_API_KEY）：每條數列的所有歷史版本（real-time period）與公布日。
金鑰只從環境變數讀取；不寫檔、不輸出；錯誤訊息一律不含網址。每分鐘不超過 120 次請求（這裡壓在約 100 次）。
輸出：data/fredapi-<批次>.pNN.enc.json（tar：每條數列一個 .csv.xz＋meta）；status/fredapi-<批次>.json（只有筆數與起訖日）。"""
import os, sys, io, json, time, lzma, tarfile, urllib.request, urllib.error, urllib.parse
import run as R

API = 'https://api.stlouisfed.org/fred/'
MIN_GAP = 0.60          # 兩次請求至少間隔 0.6 秒 → 每分鐘最多 100 次
_last = [0.0]
N_REQ = [0]


def api(path, **q):
    """回傳 (狀態碼, dict 或 None)。不記錄網址。"""
    key = (os.environ.get('FRED_API_KEY') or '').strip()
    q = dict(q, api_key=key, file_type='json')
    url = API + path + '?' + urllib.parse.urlencode(q)
    for k in range(5):
        wait = MIN_GAP - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time(); N_REQ[0] += 1
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'BNASDAQ data-26114 (research; contact via repo)'})
            with urllib.request.urlopen(req, timeout=90) as r:
                return 200, json.loads(r.read().decode('utf-8', 'replace'))
        except urllib.error.HTTPError as e:
            code = e.code
            if code == 429:
                time.sleep(20 * (k + 1)); continue
            if code in (400, 404):
                return code, None
            time.sleep(5 * (k + 1))
        except Exception:  # noqa
            time.sleep(5 * (k + 1))
    return -1, None


def series_all(sid):
    """一條數列：metadata、所有 real-time period 的觀測值、vintage 日期、所屬 release。回傳 (csv 文字, meta dict)"""
    meta = dict(id=sid)
    st, j = api('series', series_id=sid, realtime_start='1776-07-04', realtime_end='9999-12-31')
    meta['series_status'] = st
    if st == 200 and j.get('seriess'):
        s = j['seriess'][-1]
        meta.update({k: s.get(k) for k in ('title', 'frequency_short', 'units_short', 'seasonal_adjustment_short', 'observation_start', 'observation_end', 'last_updated')})
        meta['meta_versions'] = len(j['seriess'])
    st, j = api('series/release', series_id=sid)
    if st == 200 and j.get('releases'):
        meta['release_id'] = j['releases'][0].get('id'); meta['release_name'] = j['releases'][0].get('name')
    st, j = api('series/vintagedates', series_id=sid, realtime_start='1776-07-04', realtime_end='9999-12-31', limit=10000)
    vd = (j or {}).get('vintage_dates') or []
    meta['n_vintages'] = len(vd); meta['first_vintage'] = vd[0] if vd else None; meta['last_vintage'] = vd[-1] if vd else None
    lines = ['date,realtime_start,realtime_end,value']; ok = True

    def pull(rs, re_):
        """抓一段 real-time 區間的全部列（分頁）；回傳 (成功?, 狀態碼)。"""
        off = 0
        while True:
            st, j = api('series/observations', series_id=sid, realtime_start=rs, realtime_end=re_, limit=100000, offset=off, sort_order='asc')
            if st != 200 or j is None:
                return False, st
            obs = j.get('observations') or []; total = j.get('count', len(obs))
            for o in obs:
                lines.append('%s,%s,%s,%s' % (o.get('date'), o.get('realtime_start'), o.get('realtime_end'), o.get('value')))
            off += len(obs)
            if not obs or off >= total:
                return True, 200
    good, st = pull('1776-07-04', '9999-12-31'); meta['mode'] = 'all'
    if not good and vd:
        # 版本太多被拒絕時：把 real-time 區間依版本日期切成數段分別抓（同一筆觀測值會在相鄰區段各出現一次，解析時再合併）
        del lines[1:]; meta['mode'] = 'chunked'; meta['first_status'] = st; step = 1500; good = True
        for i in range(0, len(vd), step):
            rs = vd[i]; re_ = '9999-12-31' if i + step >= len(vd) else vd[i + step - 1]
            g, st = pull(rs, re_)
            if not g:
                good = False; break
    if not good:
        ok = False; meta['obs_status'] = st
    meta['rows'] = len(lines) - 1; meta['ok'] = ok and len(lines) > 1
    return '\n'.join(lines) + '\n', meta, vd


def run(opts):
    if not (os.environ.get('FRED_API_KEY') or '').strip():
        R.write_json(os.path.join(R.STAT, 'fredapi.json'), dict(checked=R.utc(), fred_api_key_present=False, note='no key; skipped'))
        R.log('fredapi: no key'); return
    batch = str(opts.get('fredapi_batch', 'a'))
    ids = [ln.strip() for ln in open(os.path.join(R.ROOT, 'fetch', 'fredapi_ids_%s.txt' % batch), encoding='utf-8').read().splitlines() if ln.strip() and not ln.strip().startswith('#')]
    budget = float(opts.get('fredapi_budget_s', 18000)); t0 = time.time()
    items, metas, rel_ids = [], [], set()
    for i, sid in enumerate(ids):
        if time.time() - t0 > budget:
            R.log('fredapi budget reached at', i); break
        txt, meta, vd = series_all(sid)
        metas.append(meta)
        if meta.get('ok'):
            items.append(('fredapi/obs/%s.csv.xz' % sid, lzma.compress(txt.encode(), preset=6)))
            items.append(('fredapi/vintagedates/%s.txt' % sid, ('\n'.join(vd) + '\n').encode()))
            if meta.get('release_id') is not None:
                rel_ids.add(meta['release_id'])
        if i % 20 == 0:
            R.log('fredapi', i, '/', len(ids), 'requests', N_REQ[0])
    rels = []
    for rid in sorted(rel_ids):
        dates = []; off = 0
        while True:
            st, j = api('release/dates', release_id=rid, realtime_start='1776-07-04', realtime_end='9999-12-31', limit=10000, offset=off,
                        include_release_dates_with_no_data='false', sort_order='asc')
            if st != 200 or j is None:
                break
            rd = j.get('release_dates') or []
            dates += [x.get('date') for x in rd]; off += len(rd)
            if not rd or off >= j.get('count', 0):
                break
        rels.append(dict(release_id=rid, n=len(dates), first=dates[0] if dates else None, last=dates[-1] if dates else None))
        items.append(('fredapi/release_dates/%s.txt' % rid, ('\n'.join(dates) + '\n').encode()))
    summ = None
    if items:
        items.append(('fredapi/meta_%s.json' % batch, json.dumps(dict(fetched=R.utc(), series=metas, releases=rels), ensure_ascii=False).encode()))
        bio = io.BytesIO()
        with tarfile.open(fileobj=bio, mode='w', format=tarfile.PAX_FORMAT) as tf:
            for name, body in sorted(items):
                ti = tarfile.TarInfo(name); ti.size = len(body); ti.mtime = 0; ti.mode = 0o644
                tf.addfile(ti, io.BytesIO(body))
        raw = bio.getvalue()
        summ = R.write_enc('fredapi-' + batch, lzma.compress(raw, preset=1), 'FRED API all real-time periods (ALFRED) per series + release dates')
    pub = dict(checked=R.utc(), fred_api_key_present=True, batch=batch, n_ids=len(ids), n_done=len(metas), n_ok=sum(1 for m in metas if m.get('ok')),
               requests=N_REQ[0], seconds=round(time.time() - t0), enc=summ, releases=rels,
               series=[{k: m.get(k) for k in ('id', 'ok', 'rows', 'mode', 'first_status', 'n_vintages', 'first_vintage', 'last_vintage', 'frequency_short', 'observation_start',
                                              'observation_end', 'release_id', 'series_status', 'obs_status')} for m in metas])
    R.write_json(os.path.join(R.STAT, 'fredapi-%s.json' % batch), pub)
