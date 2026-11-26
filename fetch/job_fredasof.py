#!/usr/bin/env python3
"""data-26114｜驗收用：指定日期當天 ALFRED 看得到的版本（FRED API realtime_start=realtime_end=那一天）。
用來和「由全部歷史版本重建的當日可用值」互相核對。金鑰只從環境變數讀取；不輸出網址。
輸出：data/fredasof-<批次>.pNN.enc.json（每個日期一個 JSON：{代號: {status, obs:[[觀測日, 值], …最近 36 筆]}}）；status/fredasof-<批次>.json"""
import os, io, json, time, lzma, tarfile
import run as R
import job_fredapi as F


def run(opts):
    if not (os.environ.get('FRED_API_KEY') or '').strip():
        R.write_json(os.path.join(R.STAT, 'fredasof.json'), dict(checked=R.utc(), fred_api_key_present=False)); return
    batch = str(opts.get('fredapi_batch', 'a')); dates = list(opts.get('fredasof_dates') or [])
    ids = [ln.strip() for ln in open(os.path.join(R.ROOT, 'fetch', 'fredapi_ids_%s.txt' % batch), encoding='utf-8').read().splitlines() if ln.strip() and not ln.strip().startswith('#')]
    t0 = time.time(); items = []; summ_dates = []
    for d in dates:
        out = {}; n_ok = 0
        for sid in ids:
            st, j = F.api('series/observations', series_id=sid, realtime_start=d, realtime_end=d, sort_order='desc', limit=36)
            obs = [[o.get('date'), o.get('value')] for o in ((j or {}).get('observations') or [])]
            out[sid] = dict(status=st, obs=obs); n_ok += int(st == 200 and len(obs) > 0)
        items.append(('fredasof/%s.json' % d, json.dumps(out).encode())); summ_dates.append(dict(date=d, n_ids=len(ids), n_ok=n_ok))
        R.log('fredasof', d, 'ok', n_ok, '/', len(ids), 'requests', F.N_REQ[0])
    summ = None
    if items:
        bio = io.BytesIO()
        with tarfile.open(fileobj=bio, mode='w', format=tarfile.PAX_FORMAT) as tf:
            for name, body in sorted(items):
                ti = tarfile.TarInfo(name); ti.size = len(body); ti.mtime = 0; ti.mode = 0o644
                tf.addfile(ti, io.BytesIO(body))
        summ = R.write_enc('fredasof-' + batch, lzma.compress(bio.getvalue(), preset=1), 'ALFRED as-of snapshots for acceptance test')
    R.write_json(os.path.join(R.STAT, 'fredasof-%s.json' % batch), dict(checked=R.utc(), batch=batch, dates=summ_dates, requests=F.N_REQ[0], seconds=round(time.time() - t0), enc=summ))
