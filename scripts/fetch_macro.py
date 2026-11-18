#!/usr/bin/env python3
"""BNASDAQ｜FRED 利率與匯率月資料（FRED-MD 第 6 組「Interest and Exchange Rates」中可直接下載的數列）→ data/macro.enc.json（加密）。

用途：會員專區與私人回測產生器每月更新策略用的金融環境數據。整組數列一起抓、一起加密，檔案裡看不出哪個策略用了哪一個；
      數列本身都是 FRED 的公開資料，本程式不含任何策略規則。
加密：整份 JSON 用一次性 AES-256-GCM 金鑰加密；資料金鑰再用 RSA-OAEP-3072-SHA256 分別包裝給兩把公鑰：
      member＝data/rules-key.json（會員瀏覽器用同一把會員規則私鑰解開）、gen＝data/macro-key.json（私人回測產生器）。
      不需要任何秘密就能產生；只有持有私鑰的一方解得開。
來源：https://fred.stlouisfed.org/graph/fredgraph.csv?id=<數列>（失敗改用 https://fred.stlouisfed.org/data/<數列>.txt）；保留 KEEP_FROM 起的月份。
規則：任一數列抓不到就沿用不了舊值（檔案是加密的），所以「全部數列都抓到」才寫檔；內容（明文雜湊）沒變不重寫。
用法：python3 scripts/fetch_macro.py
"""
import os, sys, json, csv, io, base64, hashlib, urllib.request, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'macro.enc.json')
KEYS = {'member': os.path.join(ROOT, 'data', 'rules-key.json'), 'gen': os.path.join(ROOT, 'data', 'macro-key.json')}
KEEP_FROM = '2023-01'
# FRED-MD 第 6 組（利率與匯率）：可在 FRED 直接下載的數列（FRED-MD 的 EXSZUSx、EXJPUSx、EXUSUKx、EXCAUSx＝FRED 的 EXSZUS、EXJPUS、EXUSUK、EXCAUS）
SERIES = ['FEDFUNDS', 'TB3MS', 'TB6MS', 'GS1', 'GS5', 'GS10', 'AAA', 'BAA', 'TB3SMFFM', 'TB6SMFFM', 'T1YFFM', 'T5YFFM', 'T10YFFM',
          'AAAFFM', 'BAAFFM', 'EXSZUS', 'EXJPUS', 'EXUSUK', 'EXCAUS']


def log(*a):
    print('[fetch_macro]', *a, flush=True)


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
    for url, parse in (('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + sid, parse_csv), ('https://fred.stlouisfed.org/data/%s.txt' % sid, parse_txt)):
        try:
            d = parse(_get(url))
            d = {m: v for m, v in d.items() if m >= KEEP_FROM}
            if len(d) >= 12:
                return d
            log(sid, 'too few rows from', url, len(d))
        except Exception as e:  # noqa
            log(sid, 'failed', url, repr(e))
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


def main():
    pubs = {}
    for name, p in KEYS.items():
        try:
            pubs[name] = json.load(open(p, encoding='utf-8'))['pub']
        except Exception as e:  # noqa
            log('no public key', p, repr(e)); return 0
    series = {}
    for sid in SERIES:
        d = fetch(sid)
        if d is None:
            log('missing', sid, '; keeping the existing file'); return 0
        series[sid] = {m: d[m] for m in sorted(d)}
    last = {k: max(v) for k, v in series.items()}
    payload = dict(schema='bnasdaq-macro-plain/1', source='FRED（https://fred.stlouisfed.org/graph/fredgraph.csv?id=…；月平均）', keep_from=KEEP_FROM, series=series)
    plain = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    sha = hashlib.sha256(plain).hexdigest()
    try:
        old = json.load(open(OUT, encoding='utf-8'))
    except Exception:
        old = None
    if old and old.get('pt_sha') == sha and set((old.get('ek') or {})) == set(pubs):
        log('unchanged', sha[:12]); return 0
    ek, iv, ct = encrypt(plain, pubs)
    out = dict(schema='bnasdaq-macro/1', alg='RSA-OAEP-3072-SHA256+AES-256-GCM', updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               n_series=len(series), last_month=max(last.values()), pt_sha=sha, ek=ek, iv=iv, ct=ct)
    open(OUT, 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    log('written', OUT, len(series), 'series; last months', sorted(set(last.values())), 'sha', sha[:12])
    return 0


if __name__ == '__main__':
    sys.exit(main())
