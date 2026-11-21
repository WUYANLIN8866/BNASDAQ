#!/usr/bin/env python3
"""BNASDAQ｜FRED 月資料 → 加密檔（會員專區與私人回測產生器每月更新策略用的金融環境數據）。

抓哪些：FRED-MD 月資料庫（聖路易聯邦準備銀行）裡可在 FRED 直接下載的數列，加上幾個同來源的補充數列，整組一起抓、一起加密；
        檔案裡看不出哪個策略用了哪一個。數列本身都是 FRED 的公開資料，本程式不含任何策略規則。
輸出：
  data/macro.enc.json            第 1 版（利率與匯率 19 個數列、2023-01 起；格式不變，既有程式照舊使用）
  data/macro2.enc.json           第 2 版（全部數列、最近 KEEP_MONTHS 個月；月份軸＋各數列的數值陣列）
  data/macro2/asof-YYYY-MM.enc.json  月底定案檔：每個月（美東時間）結束後第一次執行時，先把「上個月最後留下的」第 2 版檔原封不動複製一份，
                                 之後永不改寫。用途：已經依月底資料做出的判斷，不會因為官方事後修正數字而改變。
  data/macro2/index.json         已有哪些月底定案檔（公開清單）
  data/macro-status.json         這次抓取的結果（公開；只有時間、成功與否、失敗的數列代號），給自動監控用
加密：整份 JSON 用一次性 AES-256-GCM 金鑰加密；資料金鑰再用 RSA-OAEP-3072-SHA256 分別包裝給兩把公鑰：
      member＝data/rules-key.json（會員瀏覽器用同一把會員規則私鑰解開）、gen＝data/macro-key.json（私人回測產生器）。
      不需要任何秘密就能產生；只有持有私鑰的一方解得開。
來源：https://fred.stlouisfed.org/graph/fredgraph.csv?id=<數列>（失敗改用 https://fred.stlouisfed.org/data/<數列>.txt）。
規則：舊檔是加密的、沿用不了舊值，所以「全部數列都抓到」才寫檔；內容（明文雜湊）沒變不重寫。
      為了不對 FRED 造成負擔：距離上次成功抓取不到 20 小時、而且不是排程或手動啟動時，不重抓（月底定案檔的複製照做）。
      月底凍結：本月最後一個交易日收盤後（data/market.json 的最新收盤日之後，到月底都沒有交易日），到換月之前不再重抓。
      這樣「月底收盤那一刻網站上的資料」就是月底定案檔的內容，月底的判斷從第一次顯示起就不會再變。
用法：python3 scripts/fetch_macro.py [--force]
"""
import os, sys, json, csv, io, time, base64, hashlib, shutil, urllib.request, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT1 = os.path.join(ROOT, 'data', 'macro.enc.json')
OUT2 = os.path.join(ROOT, 'data', 'macro2.enc.json')
SNAP = os.path.join(ROOT, 'data', 'macro2')
STATUS = os.path.join(ROOT, 'data', 'macro-status.json')
KEYS = {'member': os.path.join(ROOT, 'data', 'rules-key.json'), 'gen': os.path.join(ROOT, 'data', 'macro-key.json')}
KEEP_FROM = '2023-01'      # 第 1 版
KEEP_MONTHS = 96           # 第 2 版：最近幾個月
MIN_GAP_H = 20
RETRY_GAP_H = 2
# 紐約證交所整日休市日（公開資訊；只用來判斷「本月還有沒有交易日」。清單以外的年份只看週一到週五）
NYSE_HOLIDAYS = set((
    '2026-01-01 2026-01-19 2026-02-16 2026-04-03 2026-05-25 2026-06-19 2026-07-03 2026-09-07 2026-11-26 2026-12-25 '
    '2027-01-01 2027-01-18 2027-02-15 2027-03-26 2027-05-31 2027-06-18 2027-07-05 2027-09-06 2027-11-25 2027-12-24 '
    '2028-01-17 2028-02-21 2028-04-14 2028-05-29 2028-06-19 2028-07-04 2028-09-04 2028-11-23 2028-12-25 2029-01-01 '
    '2029-01-15 2029-02-19 2029-03-30 2029-05-28 2029-06-19 2029-07-04 2029-09-03 2029-11-22 2029-12-25 2030-01-01 '
    '2030-01-21 2030-02-18 2030-04-19 2030-05-27 2030-06-19 2030-07-04 2030-09-02 2030-11-28 2030-12-25 2031-01-01 '
    '2031-01-20 2031-02-17 2031-04-11 2031-05-26 2031-06-19 2031-07-04 2031-09-01 2031-11-27 2031-12-25 '
).split())
# 第 1 版：FRED-MD 第 6 組（利率與匯率）可直接下載的數列（FRED-MD 的 EXSZUSx、EXJPUSx、EXUSUKx、EXCAUSx＝FRED 的 EXSZUS、EXJPUS、EXUSUK、EXCAUS）
SERIES1 = ['FEDFUNDS', 'TB3MS', 'TB6MS', 'GS1', 'GS5', 'GS10', 'AAA', 'BAA', 'TB3SMFFM', 'TB6SMFFM', 'T1YFFM', 'T5YFFM', 'T10YFFM',
           'AAAFFM', 'BAAFFM', 'EXSZUS', 'EXJPUS', 'EXUSUK', 'EXCAUS']
# 第 2 版：FRED-MD 八組裡在 FRED 有同名月資料的數列（FRED-MD 代號帶 x 的，用 FRED 的原始代號：CMRMTSPLx→CMRMTSPL、RETAILx→RSAFS、
# AMDMNOx→DGORDER、ANDENOx→ANDENO、AMDMUOx→AMDMUO、BUSINVx→BUSINV、ISRATIOx→ISRATIO、UMCSENTx→UMCSENT、CP3Mx→CPF3M、
# TWEXAFEGSMTHx→TWEXAFEGSMTH、OILPRICEx→MCOILWTICO、匯率四個同上），再加同來源的補充數列
SERIES2 = SERIES1 + [
    # 產出與所得
    'RPI', 'W875RX1', 'INDPRO', 'IPFPNSS', 'IPFINAL', 'IPCONGD', 'IPDCONGD', 'IPNCONGD', 'IPBUSEQ', 'IPMAT', 'IPDMAT', 'IPNMAT', 'IPMANSICS',
    'IPB51222S', 'IPFUELS', 'CUMFNS',
    # 就業
    'CLF16OV', 'CE16OV', 'UNRATE', 'UEMPMEAN', 'UEMPLT5', 'UEMP5TO14', 'UEMP15OV', 'UEMP15T26', 'UEMP27OV', 'PAYEMS', 'USGOOD', 'CES1021000001',
    'USCONS', 'MANEMP', 'DMANEMP', 'NDMANEMP', 'SRVPRD', 'USTPU', 'USWTRADE', 'USTRADE', 'USFIRE', 'USGOVT', 'CES0600000007', 'AWOTMAN', 'AWHMAN',
    'CES0600000008', 'CES2000000008', 'CES3000000008',
    # 房市
    'HOUST', 'HOUSTNE', 'HOUSTMW', 'HOUSTS', 'HOUSTW', 'PERMIT', 'PERMITNE', 'PERMITMW', 'PERMITS', 'PERMITW',
    # 消費、訂單與存貨
    'DPCERA3M086SBEA', 'CMRMTSPL', 'RSAFS', 'ACOGNO', 'DGORDER', 'ANDENO', 'AMDMUO', 'BUSINV', 'ISRATIO', 'UMCSENT',
    # 貨幣與信用
    'M1SL', 'M2SL', 'M2REAL', 'BOGMBASE', 'TOTRESNS', 'NONBORRES', 'BUSLOANS', 'REALLN', 'NONREVSL', 'DTCOLNVHFNM', 'DTCTHFNM', 'INVEST',
    # 利率與匯率（第 1 版以外的）
    'CPF3M', 'TWEXAFEGSMTH',
    # 物價
    'WPSFD49207', 'WPSFD49502', 'WPSID61', 'WPSID62', 'MCOILWTICO', 'PPICMM', 'CPIAUCSL', 'CPIAPPSL', 'CPITRNSL', 'CPIMEDSL', 'CUSR0000SAC',
    'CUSR0000SAD', 'CUSR0000SAS', 'CPIULFSL', 'CUSR0000SA0L2', 'CUSR0000SA0L5', 'PCEPI', 'DDURRG3M086SBEA', 'DNDGRG3M086SBEA', 'DSERRG3M086SBEA',
    # 補充數列
    'CPIAUCNS', 'CPILFESL', 'CPILFENS', 'PCEPILFE', 'GS2', 'T10Y2YM', 'SAHMREALTIME', 'USEPUINDXM', 'MICH',
]
assert len(set(SERIES2)) == len(SERIES2)


def log(*a):
    print('[fetch_macro]', *a, flush=True)


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def month_et(t):
    """美東時間的月份（YYYY-MM）；沒有時區資料庫時退回 UTC−5"""
    try:
        from zoneinfo import ZoneInfo
        return t.astimezone(ZoneInfo('America/New_York')).strftime('%Y-%m')
    except Exception:  # noqa
        return (t - dt.timedelta(hours=5)).strftime('%Y-%m')


def ym_add(m, k):
    y, mo = int(m[:4]), int(m[5:7]); t = y * 12 + mo - 1 + k
    return '%04d-%02d' % (t // 12, t % 12 + 1)


def load_json(p):
    try:
        return json.load(open(p, encoding='utf-8'))
    except Exception:  # noqa
        return None


def write_json(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + '.tmp'
    open(tmp, 'w', encoding='utf-8').write(json.dumps(obj, ensure_ascii=False, indent=1) + '\n')
    os.replace(tmp, p)


def parse_ts(s):
    try:
        return dt.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
    except Exception:  # noqa
        return None


def _get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (BNASDAQ data fetch)'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode('utf-8', 'replace')


def parse_csv(txt):
    out = {}
    for row in csv.reader(io.StringIO(txt)):
        if len(row) < 2 or not row[0][:4].isdigit():
            continue
        try:
            out[row[0][:7]] = float(row[1])
        except ValueError:
            pass
    return out


def parse_txt(txt):
    out = {}
    for line in txt.splitlines():
        p = line.split()
        if len(p) == 2 and len(p[0]) == 10 and p[0][:4].isdigit():
            try:
                out[p[0][:7]] = float(p[1])
            except ValueError:
                pass
    return out


def fetch(sid):
    """回傳 {YYYY-MM: 值}（全部月份）；抓不到回傳 None"""
    for attempt in range(3):
        for url, parse in (('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + sid, parse_csv), ('https://fred.stlouisfed.org/data/%s.txt' % sid, parse_txt)):
            try:
                d = parse(_get(url))
                if len(d) >= 12:
                    return d
                log(sid, 'too few rows from', url, len(d))
            except Exception as e:  # noqa
                log(sid, 'failed', url, repr(e))
        time.sleep(3 * (attempt + 1))
    return None


def encrypt(plain, pubs):
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    dk = AESGCM.generate_key(bit_length=256); iv = os.urandom(12)
    ct = AESGCM(dk).encrypt(iv, plain, None)
    assert AESGCM(dk).decrypt(iv, ct, None) == plain
    b = lambda x: base64.b64encode(x).decode()
    ek = {}
    for name, pub_b64 in pubs.items():
        pub = serialization.load_der_public_key(base64.b64decode(pub_b64))
        assert pub.key_size == 3072, (name, pub.key_size)
        ek[name] = b(pub.encrypt(dk, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)))
    return ek, b(iv), b(ct)


def write_enc(path, schema, payload, pubs, n_series, last_month):
    plain = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    sha = hashlib.sha256(plain).hexdigest()
    old = load_json(path)
    if old and old.get('pt_sha') == sha and set((old.get('ek') or {})) == set(pubs):
        log('unchanged', os.path.basename(path), sha[:12]); return False
    ek, iv, ct = encrypt(plain, pubs)
    write_json(path, dict(schema=schema, alg='RSA-OAEP-3072-SHA256+AES-256-GCM', updated=now_utc().strftime('%Y-%m-%dT%H:%M:%SZ'),
                          n_series=n_series, last_month=last_month, pt_sha=sha, ek=ek, iv=iv, ct=ct))
    log('written', os.path.basename(path), n_series, 'series; last month', last_month, 'sha', sha[:12], 'bytes', os.path.getsize(path))
    return True


def snapshot(now):
    """月底定案檔：本月（美東）第一次執行時，把上個月最後留下的第 2 版檔原封不動複製成 asof-<上個月>；已存在就不動。"""
    cur = month_et(now); prev = ym_add(cur, -1)
    dst = os.path.join(SNAP, 'asof-%s.enc.json' % prev)
    old = load_json(OUT2)
    if old and not os.path.exists(dst):
        t = parse_ts(old.get('updated') or '')
        if t is not None and month_et(t) < cur:
            os.makedirs(SNAP, exist_ok=True)
            shutil.copyfile(OUT2, dst)
            log('month-end snapshot', os.path.basename(dst), '<- macro2.enc.json written', old.get('updated'))
    months = sorted(f[5:12] for f in (os.listdir(SNAP) if os.path.isdir(SNAP) else []) if f.startswith('asof-') and f.endswith('.enc.json'))
    idx = dict(schema='bnasdaq-macro-index/1', months=months)
    if months and load_json(os.path.join(SNAP, 'index.json')) != idx:
        write_json(os.path.join(SNAP, 'index.json'), idx)


def month_closed(now):
    """本月最後一個交易日已經收盤 → True（依 data/market.json 的最新收盤日；讀不到就當作還沒）"""
    try:
        asof = (load_json(os.path.join(ROOT, 'data', 'market.json')) or {}).get('asof') or ''
        if asof[:7] != month_et(now):
            return False
        d = dt.date.fromisoformat(asof); nd = d + dt.timedelta(days=1)
        while nd.month == d.month:
            if nd.weekday() < 5 and nd.isoformat() not in NYSE_HOLIDAYS:
                return False
            nd += dt.timedelta(days=1)
        return True
    except Exception as e:  # noqa
        log('month_closed check failed', repr(e)); return False


def status(now, ok, failed, note):
    old = load_json(STATUS) or {}
    ts = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    write_json(STATUS, dict(schema='bnasdaq-macro-status/1', checked=ts, ok=bool(ok), n_series=len(SERIES2), failed=sorted(failed),
                            last_ok=(ts if ok else old.get('last_ok')), note=note))


def main():
    now = now_utc()
    force = '--force' in sys.argv or os.environ.get('GITHUB_EVENT_NAME') in ('schedule', 'workflow_dispatch')
    try:
        snapshot(now)
    except Exception as e:  # noqa
        log('snapshot step failed', repr(e))
    pubs = {}
    for name, p in KEYS.items():
        try:
            pubs[name] = json.load(open(p, encoding='utf-8'))['pub']
        except Exception as e:  # noqa
            log('no public key', p, repr(e)); return 0
    if os.path.exists(OUT1) and os.path.exists(OUT2) and month_closed(now) and '--force' not in sys.argv:
        log('month-end close is in: data stay frozen until the month rolls over'); return 0
    st = load_json(STATUS) or {}
    chk = parse_ts(st.get('checked') or '')
    gap = MIN_GAP_H if st.get('ok') else RETRY_GAP_H     # 上次失敗：隔 RETRY_GAP_H 小時就再試
    if not force and chk and (now - chk).total_seconds() < gap * 3600 and os.path.exists(OUT1) and (os.path.exists(OUT2) or not st.get('ok')):
        log('checked %.1f h ago (ok=%s); skip' % ((now - chk).total_seconds() / 3600, st.get('ok'))); return 0
    raw, failed = {}, []
    for sid in SERIES2:
        d = fetch(sid)
        if d is None:
            failed.append(sid)
        else:
            raw[sid] = d
        time.sleep(0.15)
    if failed:
        log('missing', len(failed), 'series:', ' '.join(failed), '; keeping the existing files')
        status(now, False, failed, '有數列抓不到，沿用舊檔'); return 0
    # 第 1 版（格式不變）
    s1 = {sid: {m: raw[sid][m] for m in sorted(raw[sid]) if m >= KEEP_FROM} for sid in SERIES1}
    short = [sid for sid, d in s1.items() if len(d) < 12]
    if short:
        log('too short in v1 window:', short); status(now, False, short, '第 1 版視窗內資料太少'); return 0
    last1 = {k: max(v) for k, v in s1.items()}
    write_enc(OUT1, 'bnasdaq-macro/1', dict(schema='bnasdaq-macro-plain/1', source='FRED（https://fred.stlouisfed.org/graph/fredgraph.csv?id=…；月平均）',
                                            keep_from=KEEP_FROM, series=s1), pubs, len(s1), max(last1.values()))
    # 第 2 版：月份軸＝最近 KEEP_MONTHS 個月（到所有數列最新的月份為止）；沒有觀測值的月份是 null
    last = min(max(max(d) for d in raw.values()), now.strftime('%Y-%m'))
    months = [ym_add(last, -k) for k in range(KEEP_MONTHS - 1, -1, -1)]
    s2 = {sid: [raw[sid].get(m) for m in months] for sid in SERIES2}
    empty = [sid for sid, v in s2.items() if sum(x is not None for x in v) < 12]
    if empty:
        log('too short in v2 window:', empty); status(now, False, empty, '第 2 版視窗內資料太少'); return 0
    write_enc(OUT2, 'bnasdaq-macro/2', dict(schema='bnasdaq-macro-plain/2', source='FRED（https://fred.stlouisfed.org/graph/fredgraph.csv?id=…；月資料）',
                                            months=months, series=s2), pubs, len(s2), last)
    status(now, True, [], '')
    return 0


if __name__ == '__main__':
    sys.exit(main())
