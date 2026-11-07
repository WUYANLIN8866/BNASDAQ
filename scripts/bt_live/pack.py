#!/usr/bin/env python3
"""把首頁回測產生器資料夾（含策略規則與基礎資料）加密成 private/bt-gen.enc.json（AES-256-GCM）。
金鑰只從環境變數 BT_GEN_KEY（64 位十六進位）讀取，不印出、不寫檔。公開 repo 只放加密結果。
用法：BT_GEN_KEY=… python3 scripts/bt_live/pack.py /path/to/generator_dir"""
import os, sys, io, json, base64, hashlib, tarfile, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'private', 'bt-gen.enc.json')
FILES = ['gen_live.py', 'engine.py', 'search.py', 'hedge2.py', 'sat.py', 'base_daily.csv', 'base_monthly.csv', 'tb3ms_fred.txt', 'requirements.txt', 'README.txt']


def main():
    src = os.path.abspath(sys.argv[1]); key = bytes.fromhex(os.environ['BT_GEN_KEY'].strip()); assert len(key) == 32
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz', compresslevel=9) as tf:
        for f in FILES:
            info = tf.gettarinfo(os.path.join(src, f), arcname=f); info.mtime = 0; info.uid = info.gid = 0; info.uname = info.gname = ''
            with open(os.path.join(src, f), 'rb') as fh:
                tf.addfile(info, fh)
    raw = buf.getvalue(); iv = secrets.token_bytes(12)
    ct = AESGCM(key).encrypt(iv, raw, b'bnasdaq-bt-gen/1')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(dict(v=1, alg='AES-256-GCM', aad='bnasdaq-bt-gen/1', iv=base64.b64encode(iv).decode(), ct=base64.b64encode(ct).decode(),
                   plain_sha256=hashlib.sha256(raw).hexdigest(), note='加密的首頁回測產生器（含策略規則）；金鑰不在 repo。由 scripts/bt_live/run_monthly.py 解密執行。'),
              open(OUT, 'w'), separators=(',', ':'))
    print('已加密', len(FILES), '個檔 →', OUT, len(raw), 'bytes（壓縮後明文）')


if __name__ == '__main__':
    main()
