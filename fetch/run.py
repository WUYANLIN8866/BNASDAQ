#!/usr/bin/env python3
"""data-26114｜抓公開資料 → 加密存檔（沒有任何策略規則、沒有任何金鑰）。

由 .github/workflows/data-26114.yml 執行；要跑哪些工作寫在 request/run.json 的 jobs。
加密寫法比照 main 分支 scripts/fetch_macro.py 的 write_enc：
  明文 → 一次性 AES-256-GCM 金鑰加密 → 金鑰用 RSA-OAEP-3072-SHA256（main 分支 data/macro-key.json 的公鑰）包裝。
  明文是 tar.xz 位元組（不是 JSON 文字）；單一加密檔不超過 24 MiB 明文（base64 後約 32 MB），超過就分段。
status/*.json 只有摘要（時間、HTTP 狀態、筆數、起訖日、雜湊），不含資料值、不含任何金鑰。
"""
import os, sys, re, io, json, time, base64, hashlib, tarfile, lzma, zipfile, html, subprocess, tempfile, datetime as dt
import urllib.request, urllib.error, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data'); STAT = os.path.join(ROOT, 'status')
UA = 'Mozilla/5.0 (BNASDAQ data fetch)'      # 與 main 分支 scripts/fetch_macro.py 相同寫法（已知在 GitHub Actions 上可用）
PART = 24 * 1024 * 1024
T0 = time.time()


def log(*a):
    print('[d26114 %6.0fs]' % (time.time() - T0), *a, flush=True)


def utc():
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def write_json(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + '.tmp'
    open(tmp, 'w', encoding='utf-8').write(json.dumps(obj, ensure_ascii=False, indent=1) + '\n')
    os.replace(tmp, p)


def load_json(p):
    try:
        return json.load(open(p, encoding='utf-8'))
    except Exception:  # noqa
        return None


# ------------------------------------------------------------------ http（不輸出網址的查詢字串）
def _urllib(url, timeout, hdr):
    try:
        req = urllib.request.Request(url, headers=hdr)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, b'', {}
    except Exception as e:  # noqa
        return -1, type(e).__name__.encode(), {}


def _curl(url, timeout, hdr):
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, 'o'); hf = os.path.join(td, 'h')
        cmd = ['curl', '-sS', '-L', '--compressed', '--max-time', str(int(timeout)), '-o', out, '-D', hf, '-w', '%{http_code}']
        for k, v in hdr.items():
            cmd += ['-H', '%s: %s' % (k, v)]
        cmd.append(url)
        try:
            p = subprocess.run(cmd, capture_output=True, timeout=timeout + 30)
            code = int((p.stdout or b'0').decode().strip()[-3:] or 0)
            body = open(out, 'rb').read() if os.path.exists(out) else b''
            rh = {}
            if os.path.exists(hf):
                for line in open(hf, 'rb').read().decode('latin-1').splitlines():
                    if ':' in line:
                        k, v = line.split(':', 1); rh[k.strip().lower()] = v.strip()
            return code, body, rh
        except Exception as e:  # noqa
            return -2, type(e).__name__.encode(), {}


FAILS = [0]          # 連續失敗次數（給各工作做「連續失敗就停」用）


def get(url, timeout=40, tries=2, hdr=None, pause=2.0, curl=True):
    """回傳 (狀態碼, 內容, 回應標頭)。先用 urllib；失敗（非 404）再用 curl；都失敗就重試。逾時短、不死等。"""
    h = {'User-Agent': UA}
    if hdr:
        h.update(hdr)
    last = (0, b'', {})
    for k in range(tries):
        for fn in ((_urllib, _curl) if curl else (_urllib,)):
            st, body, rh = fn(url, timeout, h)
            if st == 200 and body:
                FAILS[0] = 0
                return st, body, rh
            last = (st, b'', rh)
            if st == 404:
                break
        if last[0] == 404 or k == tries - 1:
            break
        time.sleep(pause * (k + 1))
    FAILS[0] += 1
    return last


# ------------------------------------------------------------------ 加密（比照 write_enc）
def pubkey():
    return json.load(open(os.environ['PUBKEY_JSON'], encoding='utf-8'))['pub']


def encrypt(plain, pub_b64):
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    dk = AESGCM.generate_key(bit_length=256); iv = os.urandom(12)
    ct = AESGCM(dk).encrypt(iv, plain, None)
    assert AESGCM(dk).decrypt(iv, ct, None) == plain
    pub = serialization.load_der_public_key(base64.b64decode(pub_b64))
    assert pub.key_size == 3072, pub.key_size
    ek = pub.encrypt(dk, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    b = lambda x: base64.b64encode(x).decode()
    return {'gen': b(ek)}, b(iv), b(ct)


def write_enc(name, plain, note):
    """明文位元組 → data/<name>.pNN.enc.json；內容（明文雜湊）沒變就不重寫。回傳摘要 dict。"""
    all_sha = sha(plain); n = max(1, -(-len(plain) // PART))
    os.makedirs(DATA, exist_ok=True)
    old = sorted(f for f in os.listdir(DATA) if f.startswith(name + '.p') and f.endswith('.enc.json'))
    if old:
        o = load_json(os.path.join(DATA, old[0])) or {}
        if o.get('all_sha') == all_sha and o.get('parts') == len(old) == n:
            log('unchanged', name, all_sha[:12]); return dict(name=name, parts=n, bytes=len(plain), all_sha=all_sha, changed=False)
        for f in old:
            os.remove(os.path.join(DATA, f))
    pub = pubkey(); files = []
    for i in range(n):
        chunk = plain[i * PART:(i + 1) * PART]
        ek, iv, ct = encrypt(chunk, pub)
        fn = '%s.p%02d.enc.json' % (name, i)
        obj = dict(schema='bnasdaq-d26114/1', alg='RSA-OAEP-3072-SHA256+AES-256-GCM', fmt='tar.xz', note=note, updated=utc(), part=i, parts=n,
                   pt_sha=sha(chunk), pt_bytes=len(chunk), all_sha=all_sha, all_bytes=len(plain), ek=ek, iv=iv, ct=ct)
        p = os.path.join(DATA, fn)
        open(p, 'w', encoding='utf-8').write(json.dumps(obj, separators=(',', ':')) + '\n')
        assert os.path.getsize(p) < 40 * 1000 * 1000, (fn, os.path.getsize(p))
        files.append(dict(file=fn, bytes=os.path.getsize(p)))
    log('written', name, n, 'part(s)', len(plain), 'bytes', all_sha[:12])
    return dict(name=name, parts=n, bytes=len(plain), all_sha=all_sha, changed=True, files=files)


def pack(items):
    """[(路徑, 位元組)] → tar.xz 位元組（固定 mtime，內容相同就逐位元相同）"""
    bio = io.BytesIO()
    with tarfile.open(fileobj=bio, mode='w', format=tarfile.PAX_FORMAT) as tf:
        for name, body in items:
            ti = tarfile.TarInfo(name); ti.size = len(body); ti.mtime = 0; ti.mode = 0o644
            tf.addfile(ti, io.BytesIO(body))
    raw = bio.getvalue()
    xz = lzma.compress(raw, format=lzma.FORMAT_XZ, preset=9)
    log('pack', len(items), 'files', len(raw), '->', len(xz))
    return xz


# ------------------------------------------------------------------ 工作：FRED API key 是否存在（只記有或沒有）
def job_key(opts):
    present = bool((os.environ.get('FRED_API_KEY') or '').strip())
    write_json(os.path.join(STAT, 'key.json'), dict(checked=utc(), fred_api_key_present=present))
    log('FRED_API_KEY present:', present)


# ------------------------------------------------------------------ 工作：FRED-MD／FRED-QD（最新檔＋歷史版本）
BASE = 'https://www.stlouisfed.org'
LANDING = BASE + '/research/economists/mccracken/fred-databases'
MEDIA = '/-/media/project/frbstl/stlouisfed/research/fred-md/'
KNOWN = [
    MEDIA + 'historical_fred-md.zip?sc_lang=en&hash=8A23C5FAF7A0D743A353D77DF4704028',
    MEDIA + 'historical-vintages-of-fred-md-2015-01-to-2025-12.zip',
    MEDIA + 'historical-vintages-of-fred-qd-2018-05-to-2025-12.zip',
    MEDIA + 'fred-md_appendix0324.zip?sc_lang=en&hash=C8B84CF979313F21D9034FE68134E8EF',
    MEDIA + 'fred-qd_appendix0324.zip?sc_lang=en&hash=B237B1AB6F9AC21A5686190C60DE22AA',
    MEDIA + 'fredmdchanges0324.pdf?sc_lang=en&hash=4CC75807566F1F6F1BCC7FB312484BA0',
    MEDIA + 'fredqdchanges0324.pdf?sc_lang=en&hash=53AE5EB0E6F06527265BF3916C46B179',
] + [MEDIA + 'monthly/2026-%02d-md.csv' % m for m in range(1, 13)] + [MEDIA + 'monthly/2026-rev-%02d-md.csv' % m for m in range(1, 13)] \
  + [MEDIA + 'quarterly/2026-%02d-qd.csv' % m for m in range(1, 13)] + [MEDIA + 'quarterly/2026-rev-%02d-qd.csv' % m for m in range(1, 13)] \
  + [MEDIA + 'monthly/current.csv', MEDIA + 'quarterly/current.csv']


def job_fredmd(opts):
    items, meta = [], dict(fetched=utc(), landing=None, files=[])
    st, body, rh = get(LANDING, timeout=45)
    log('landing', st, len(body))
    meta['landing'] = dict(status=st, bytes=len(body))
    links = []
    if st == 200:
        items.append(('fredmd/landing.html', body))
        for h in re.findall(r'href="([^"]+)"', body.decode('utf-8', 'replace')):
            h = html.unescape(h)
            if 'fred-md/' in h.lower() and re.search(r'\.(csv|zip|pdf)(\?|$)', h, re.I):
                links.append(h if h.startswith('/') else h.replace(BASE, ''))
    seen, order = set(), []
    for h in links + KNOWN:
        k = h.split('?')[0].lower()
        if k not in seen:
            seen.add(k); order.append(h)
    log('fredmd links', len(links), 'from page;', len(order), 'to try')
    nfail_known = 0
    for h in order:
        fn = h.split('?')[0].rsplit('/', 1)[-1]
        guess = (h not in links)
        if guess and nfail_known >= 6:
            continue                                         # 猜測網址連續失敗 → 不再試
        big = fn.lower().endswith('.zip')
        st, body, rh = get(BASE + h if h.startswith('/') else h, timeout=(240 if big else 45) if not guess or big else 20, tries=1 if guess else 2)
        nfail_known = 0 if st == 200 else nfail_known + (1 if guess else 0)
        log('fredmd', fn, st, len(body))
        rec = dict(name=fn, status=st, bytes=len(body) if st == 200 else 0, from_page=not guess, last_modified=rh.get('last-modified'))
        if st != 200:
            if not guess:
                meta['files'].append(rec)
            continue
        rec['sha'] = sha(body)[:16]
        kind = 'qd' if ('quarterly/' in h or '-qd' in fn.lower() or 'fred-qd' in fn.lower() or 'fredqd' in fn.lower()) else 'md'
        if fn.lower().endswith('.zip'):
            try:
                zf = zipfile.ZipFile(io.BytesIO(body)); mem = []
                for zi in zf.infolist():
                    if zi.is_dir():
                        continue
                    items.append(('fred%s/zip/%s/%s' % (kind, fn, zi.filename), zf.read(zi)))
                    mem.append([zi.filename, '%04d-%02d-%02d %02d:%02d:%02d' % zi.date_time, zi.file_size])
                rec['members'] = len(mem); rec['member_list'] = mem
            except Exception as e:  # noqa
                rec['zip_error'] = type(e).__name__; items.append(('fred%s/raw/%s' % (kind, fn), body))
        else:
            sub = 'monthly' if '/monthly/' in h else ('quarterly' if '/quarterly/' in h else 'doc')
            items.append(('fred%s/%s/%s' % (kind, sub, fn), body))
        meta['files'].append(rec)
        time.sleep(0.5)
    ok = [f for f in meta['files'] if f['status'] == 200]
    items.sort(key=lambda x: x[0])
    summ = None
    if ok:
        items.append(('fredmd/meta.json', json.dumps(meta, ensure_ascii=False, indent=1).encode()))
        summ = write_enc('fredmd', pack(items), 'FRED-MD/FRED-QD current + historical vintages (raw files)')
    pub = dict(fetched=meta['fetched'], landing=meta['landing'], n_ok=len(ok), n_items=len(items), enc=summ,
               files=[{k: v for k, v in f.items() if k != 'member_list'} for f in meta['files']])
    write_json(os.path.join(STAT, 'fredmd.json'), pub)


# ------------------------------------------------------------------ 工作：Yahoo 日線（開高低收量＋還原收盤＋股息分割）
YAHOO = {
    'core': ['QQQ', 'QLD', 'SHV', '^NDX', 'TQQQ', 'SPY', 'IWM', 'DIA', 'BIL'],
    'us_index': ['^GSPC', '^DJI', '^IXIC', '^RUT', '^SOX', '^NYA', '^W5000', '^OEX', '^MID'],
    'vol': ['^VIX', '^VXN', '^VVIX', '^VIX3M', '^VIX9D', '^VIX6M', '^SKEW', '^VXO', '^MOVE', '^GVZ', '^OVX', '^RVX', '^VXD'],
    'rates': ['^IRX', '^FVX', '^TNX', '^TYX'],
    'bond_etf': ['TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'JNK', 'TIP', 'AGG', 'EMB', 'MUB'],
    'fx': ['DX-Y.NYB', 'EURUSD=X', 'JPY=X', 'GBPUSD=X', 'TWD=X', 'CNY=X', 'KRW=X', 'AUDUSD=X', 'CHF=X', 'CAD=X', 'MXN=X', 'HKD=X', 'SGD=X', 'INR=X'],
    'commodity': ['CL=F', 'BZ=F', 'NG=F', 'GC=F', 'SI=F', 'HG=F', 'PL=F', 'ZC=F', 'ZS=F', 'ZW=F', 'GLD', 'USO', 'DBC'],
    'sector': ['XLB', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XLRE', 'XLC', 'SMH', 'SOXX', 'IBB', 'KRE', 'XHB', 'IYR', 'RSP', 'QQEW', 'MDY',
               'IWD', 'IWF', 'IJR', 'VTV', 'VUG'],
    'global': ['^N225', '^HSI', '^FTSE', '^GDAXI', '^FCHI', '^KS11', '^TWII', '^STOXX50E', '000001.SS', '^BSESN', '^AXJO', '^GSPTSE', '^BVSP', '^MXX',
               '^STI', '^JKSE', '^KLSE', '^NZ50', '^SSMI', '^AEX', '^IBEX', 'EEM', 'EFA', 'VGK', 'EWJ', 'EWT', 'FXI', 'EWY', 'EWZ', 'INDA', 'ACWI', 'VEU'],
    'tw': ['0050.TW', '^TWOII', '2330.TW'],
}


def job_yahoo(opts):
    items, rows, p2 = [], [], int(time.time()) + 86400
    stop = False; nbad = 0
    hosts = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']
    for grp, tks in YAHOO.items():
        for tk in tks:
            rec = dict(ticker=tk, group=grp, status=0, n=0)
            if stop:
                rows.append(rec); continue
            for a in range(3):
                url = 'https://%s/v8/finance/chart/%s?period1=0&period2=%d&interval=1d&events=div%%2Csplit&includeAdjustedClose=true' % (
                    hosts[a % 2], urllib.parse.quote(tk, safe=''), p2)
                st, body, rh = get(url, timeout=40, tries=1, hdr={'User-Agent': 'Mozilla/5.0 (BNASDAQ market fetch)'})
                rec['status'] = st
                if st == 200:
                    try:
                        j = json.loads(body); r = j['chart']['result'][0]; ts = r.get('timestamp') or []
                        cl = r['indicators']['quote'][0].get('close') or []
                        good = [i for i, c in enumerate(cl) if c is not None]
                        if good:
                            f = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%Y-%m-%d')
                            rec.update(n=len(good), first=f(ts[good[0]]), last=f(ts[good[-1]]), tz=r.get('meta', {}).get('exchangeTimezoneName'),
                                       has_open=sum(1 for o in (r['indicators']['quote'][0].get('open') or []) if o is not None))
                            items.append(('yahoo/%s.json' % re.sub(r'[^A-Za-z0-9._-]', '_', tk), body))
                            break
                        rec['status'] = 204
                    except Exception as e:  # noqa
                        rec['status'] = 599; rec['err'] = type(e).__name__
                if st == 404:
                    break
                time.sleep(3 + 3 * a)
            nbad = 0 if rec['n'] else nbad + 1
            if nbad >= 8 and not items:
                stop = True; log('yahoo: 8 consecutive failures at start -> stop')
            log('yahoo', tk, rec['status'], rec['n'], rec.get('first'))
            rows.append(rec); time.sleep(0.8)
    ok = [r for r in rows if r['n'] > 0]
    summ = None
    if ok:
        items.append(('yahoo/meta.json', json.dumps(dict(fetched=utc(), rows=rows), ensure_ascii=False).encode()))
        summ = write_enc('yahoo', pack(sorted(items)), 'Yahoo Finance chart API daily OHLCV + adjclose + events (raw JSON)')
    write_json(os.path.join(STAT, 'yahoo.json'), dict(fetched=utc(), n_ok=len(ok), n_all=len(rows), enc=summ, rows=rows))


# ------------------------------------------------------------------ 工作：FRED 圖表下載（免金鑰；只有最新版本的值）
FREDG = {
    'rates': ['DFF', 'DTB4WK', 'DTB3', 'DTB6', 'DTB1YR', 'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30',
              'DFII5', 'DFII10', 'DFII30', 'T5YIE', 'T10YIE', 'T5YIFR', 'T10Y2Y', 'T10Y3M', 'T10YFF', 'T5YFF', 'T1YFF', 'T3MFF', 'T6MFF', 'DPRIME',
              'SOFR', 'EFFR', 'OBFR', 'DCPF3M', 'DCPN3M', 'MORTGAGE30US', 'MORTGAGE15US'],
    'credit': ['DAAA', 'DBAA', 'AAA10Y', 'BAA10Y', 'AAAFF', 'BAAFF', 'BAMLH0A0HYM2', 'BAMLH0A1HYBB', 'BAMLH0A2HYB', 'BAMLH0A3HYC', 'BAMLC0A0CM',
               'BAMLC0A1CAAA', 'BAMLC0A4CBBB', 'BAMLEMCBPIOAS', 'BAMLH0A0HYM2EY', 'BAMLC0A0CMEY', 'TEDRATE'],
    'fx': ['DTWEXBGS', 'DTWEXAFEGS', 'DTWEXEMEGS', 'DTWEXM', 'DTWEXB', 'DTWEXO', 'DEXUSEU', 'DEXJPUS', 'DEXUSUK', 'DEXCAUS', 'DEXSZUS', 'DEXCHUS', 'DEXKOUS',
           'DEXTAUS', 'DEXMXUS', 'DEXUSAL', 'DEXINUS', 'DEXBZUS', 'DEXSIUS', 'DEXHKUS', 'DEXSDUS', 'DEXNOUS', 'DEXTHUS', 'DEXMAUS', 'DEXSFUS', 'DEXUSNZ'],
    'commodity': ['DCOILWTICO', 'DCOILBRENTEU', 'DHHNGSP', 'DGASNYH', 'DGASUSGULF', 'DHOILNYH', 'DDFUELUSGULF', 'DJFUELUSGULF', 'DPROPANEMBTX',
                  'GOLDAMGBD228NLBM', 'GOLDPMGBD228NLBM', 'GASREGW'],
    'psych': ['VIXCLS', 'VXNCLS', 'VXDCLS', 'RVXCLS', 'VXVCLS', 'VXOCLS', 'OVXCLS', 'GVZCLS', 'EVZCLS', 'VXEEMCLS', 'USEPUINDXD', 'WLEMUINDXD'],
    'equity': ['NASDAQCOM', 'NASDAQ100', 'SP500', 'DJIA', 'WILL5000IND', 'WILL5000PR', 'NIKKEI225'],
    'weekly_revised': ['ICSA', 'CCSA', 'IC4WSA', 'NFCI', 'ANFCI', 'NFCILEVERAGE', 'NFCICREDIT', 'NFCIRISK', 'STLFSI4', 'WALCL', 'WRESBAL', 'WTREGEN',
                       'RRPONTSYD', 'WM2NS', 'TOTBKCR', 'WEI'],
    'monthly_extra': ['TB3MS', 'FEDFUNDS', 'UMCSENT', 'MICH', 'USREC', 'SAHMREALTIME', 'CFNAI', 'CFNAIMA3', 'CPIAUCNS', 'CPILFENS', 'CPILFESL', 'PCEPILFE',
                      'T10Y2YM', 'USEPUINDXM', 'KCFSI', 'GS2', 'GS3', 'GS7', 'GS20', 'GS30', 'TB1YR', 'MORTGAGE30US'],
}


def job_fredgraph(opts):
    items, rows, done = [], [], set()
    FAILS[0] = 0
    for grp, ids in FREDG.items():
        for sid in ids:
            if sid in done:
                continue
            done.add(sid)
            if FAILS[0] >= 8:
                rows.append(dict(id=sid, group=grp, status=-9, n=0)); continue           # 連續 8 次失敗 → 其餘略過
            st, body, rh = get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + sid, timeout=40, tries=2, curl=False)
            if st != 200:
                st2, body2, _ = get('https://fred.stlouisfed.org/data/%s.txt' % sid, timeout=40, tries=1, curl=False)
                if st2 == 200:
                    conv = ['DATE,' + sid] + ['%s,%s' % tuple(x.split()) for x in body2.decode('utf-8', 'replace').splitlines()
                                              if len(x.split()) == 2 and len(x.split()[0]) == 10 and x[:4].isdigit()]
                    st, body = 200, ('\n'.join(conv) + '\n').encode()
            rec = dict(id=sid, group=grp, status=st, n=0)
            if st == 200:
                ls = [x for x in body.decode('utf-8', 'replace').splitlines() if x[:4].isdigit()]
                vals = [x for x in ls if x.split(',')[-1] not in ('', '.')]
                if vals:
                    rec.update(n=len(vals), first=vals[0][:10], last=vals[-1][:10])
                    items.append(('fredgraph/%s.csv' % sid, body))
            if len(rows) % 10 == 0:
                log('fredgraph', sid, st, rec['n'])
            rows.append(rec); time.sleep(0.35)
    ok = [r for r in rows if r['n'] > 0]
    summ = None
    if ok:
        items.append(('fredgraph/meta.json', json.dumps(dict(fetched=utc(), rows=rows), ensure_ascii=False).encode()))
        summ = write_enc('fredgraph', pack(sorted(items)), 'FRED fredgraph.csv (latest vintage only, no API key)')
    write_json(os.path.join(STAT, 'fredgraph.json'), dict(fetched=utc(), n_ok=len(ok), n_all=len(rows), enc=summ, rows=rows))


# ------------------------------------------------------------------ 工作：Cboe 選擇權買賣權比
CBOE_ARCH = ['totalpc.csv', 'equitypc.csv', 'indexpc.csv', 'etppc.csv', 'vixpc.csv', 'spxpc.csv', 'pcratioarchive.csv', 'totalpcarchive.csv',
             'equitypcarchive.csv', 'indexpcarchive.csv']


def job_cboe(opts):
    items, rows = [], []
    for fn in CBOE_ARCH:
        st, body, rh = get('https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/' + fn, timeout=40, tries=1)
        log('cboe', fn, st, len(body))
        rec = dict(name=fn, status=st, bytes=len(body) if st == 200 else 0)
        if st == 200:
            items.append(('cboe/arch/' + fn, body)); rec['lines'] = body.count(b'\n')
        rows.append(rec); time.sleep(0.5)
    d = dt.date.fromisoformat(opts.get('cboe_from', '2019-09-30')); end = dt.datetime.now(dt.timezone.utc).date()
    budget = float(opts.get('cboe_budget_s', 1500)); t0 = time.time(); n_ok = n_try = 0; daily = {}; codes = {}
    while d <= end and time.time() - t0 < budget:
        if d.weekday() < 5:
            n_try += 1
            st, body, rh = get('https://cdn.cboe.com/data/us/options/market_statistics/daily/%s_daily_options' % d.isoformat(), timeout=20, tries=1, curl=False)
            if n_try == 40 and n_ok == 0:
                log('cboe daily: first 40 all failed -> stop', codes); break
            codes[str(st)] = codes.get(str(st), 0) + 1
            if st == 200:
                try:
                    j = json.loads(body); daily[d.isoformat()] = j.get('ratios', j); n_ok += 1
                except Exception:  # noqa
                    codes['parse'] = codes.get('parse', 0) + 1
            time.sleep(0.05)
        d += dt.timedelta(days=1)
    if daily:
        items.append(('cboe/daily_ratios.json', json.dumps(daily, separators=(',', ':')).encode()))
    summ = None
    if items:
        items.append(('cboe/meta.json', json.dumps(dict(fetched=utc(), arch=rows, daily=dict(tried=n_try, ok=n_ok, codes=codes, stopped_at=d.isoformat())), ensure_ascii=False).encode()))
        summ = write_enc('cboe', pack(sorted(items)), 'Cboe put/call ratio archives + daily market statistics (ratios)')
    write_json(os.path.join(STAT, 'cboe.json'), dict(fetched=utc(), arch=rows, daily=dict(tried=n_try, ok=n_ok, codes=codes, first=min(daily) if daily else None,
                                                                                         last=max(daily) if daily else None, stopped_at=d.isoformat()), enc=summ))


JOBS = dict(key=job_key, fredmd=job_fredmd, yahoo=job_yahoo, fredgraph=job_fredgraph, cboe=job_cboe)


def main():
    req = load_json(os.path.join(ROOT, 'request', 'run.json')) or {}
    opts = req.get('opts') or {}
    if len(sys.argv) < 2:
        print(' '.join(req.get('jobs') or [])); return 0           # 沒給工作名稱：印出要跑的工作清單（給 workflow 用）
    jn = sys.argv[1]
    log('request', req.get('id'), 'job', jn)
    fn = JOBS.get(jn); t = time.time()
    try:
        if fn is None:
            fn = __import__('job_' + jn).run
        fn(opts); res = 'ok %.0fs' % (time.time() - t)
    except Exception as e:  # noqa
        import traceback
        tb = traceback.extract_tb(e.__traceback__)[-1]
        res = 'error %s at %s:%d' % (type(e).__name__, os.path.basename(tb.filename), tb.lineno)
    log('job', jn, res)
    st = load_json(os.path.join(STAT, 'run.json')) or {}
    if st.get('request') != req.get('id'):
        st = dict(request=req.get('id'), jobs={})
    st['jobs'][jn] = res; st['finished'] = utc()
    write_json(os.path.join(STAT, 'run.json'), st)
    return 0


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main())
