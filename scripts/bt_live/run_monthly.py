#!/usr/bin/env python3
"""BNASDAQ｜首頁回測每月延伸（每月初由排程任務執行；也可手動執行）。
1) 用環境變數 BT_GEN_KEY 解密 private/bt-gen.enc.json 到暫存資料夾（不寫進 repo，結束後刪除）
2) 套件版本不符時安裝 requirements.txt 指定版本（scikit-learn 1.9.1、statsmodels 0.15.0）
3) 執行產生器：assets/bt.js、assets/bt-sat.js 延伸到上個月最後一個交易日；歷史部分必須與現有檔案逐值相同，否則不寫檔
4) 有更新時：同步首頁靜態備用數字（patch_home.js）與資源版本號（stamp_assets.py）
結束碼：0＝已更新或已是最新；2＝公開資料還沒齊（稍後再跑）；1＝錯誤。金鑰只從環境變數讀，不印出。
用法：BT_GEN_KEY=… python3 scripts/bt_live/run_monthly.py"""
import os, sys, io, json, base64, hashlib, tarfile, tempfile, shutil, subprocess
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENC = os.path.join(ROOT, 'private', 'bt-gen.enc.json')


def decrypt(dst):
    k = os.environ.get('BT_GEN_KEY', '').strip()
    if len(k) != 64:
        print('缺少 BT_GEN_KEY（64 位十六進位）'); sys.exit(1)
    j = json.load(open(ENC))
    raw = AESGCM(bytes.fromhex(k)).decrypt(base64.b64decode(j['iv']), base64.b64decode(j['ct']), j['aad'].encode())
    assert hashlib.sha256(raw).hexdigest() == j['plain_sha256']
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as tf:
        for m in tf.getmembers():
            assert m.isfile() and '/' not in m.name and not m.name.startswith('.'), m.name
        tf.extractall(dst, filter='data')


def ensure_versions(req):
    want = {l.split('==')[0].strip(): l.split('==')[1].strip() for l in open(req) if '==' in l}
    bad = []
    for pkg, ver in want.items():
        mod = {'scikit-learn': 'sklearn'}.get(pkg, pkg)
        try:
            got = __import__(mod).__version__
        except Exception:
            got = None
        if got != ver:
            bad.append('%s==%s' % (pkg, ver))
    if bad:
        print('安裝指定版本：', bad)
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', '--break-system-packages'] + bad)


def main():
    tmp = tempfile.mkdtemp(prefix='btgen_')
    try:
        decrypt(tmp)
        ensure_versions(os.path.join(tmp, 'requirements.txt'))
        bt = os.path.join(ROOT, 'assets', 'bt.js'); before = open(bt, 'rb').read() if os.path.exists(bt) else b''
        rc = subprocess.call([sys.executable, os.path.join(tmp, 'gen_live.py'), '--repo', ROOT])
        if rc not in (0, 2):
            return 1
        if open(bt, 'rb').read() != before:
            subprocess.check_call(['node', os.path.join(ROOT, 'scripts', 'bt_live', 'patch_home.js')])
            subprocess.check_call([sys.executable, os.path.join(ROOT, 'scripts', 'stamp_assets.py')])
            print('首頁回測已更新')
        return rc
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
