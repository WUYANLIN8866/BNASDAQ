#!/usr/bin/env python3
"""BNASDAQ｜首頁回測每月延伸（每月初由排程任務執行；也可手動執行）。
產生器（含策略規則 B.2／B.3 與基礎資料）放在私人 repo WUYANLIN8866/BNASDAQ-engine，不放在本公開 repo。
1) 套件版本不符時安裝產生器 requirements.txt 指定的版本（scikit-learn 1.9.1、statsmodels 0.15.0）
2) 執行產生器：assets/bt.js、assets/bt-sat.js 延伸到上個月最後一個交易日；歷史部分必須與現有檔案逐值相同，否則不寫檔；
   只輸出到上個月底，當月持倉不計算、不輸出
3) 有更新時：同步首頁靜態備用數字（patch_home.js）與資源版本號（stamp_assets.py）
結束碼：0＝已更新或已是最新；2＝公開資料還沒齊（稍後再跑）；1＝錯誤
用法：python3 scripts/bt_live/run_monthly.py --gen /path/to/BNASDAQ-engine"""
import os, sys, argparse, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


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
    ap = argparse.ArgumentParser(); ap.add_argument('--gen', required=True, help='私人 repo BNASDAQ-engine 的資料夾')
    gen = os.path.abspath(ap.parse_args().gen)
    if not os.path.exists(os.path.join(gen, 'gen_live.py')):
        print('找不到產生器：', gen); return 1
    ensure_versions(os.path.join(gen, 'requirements.txt'))
    bt = os.path.join(ROOT, 'assets', 'bt.js'); before = open(bt, 'rb').read() if os.path.exists(bt) else b''
    rc = subprocess.call([sys.executable, os.path.join(gen, 'gen_live.py'), '--repo', ROOT])
    if rc not in (0, 2):
        return 1
    if open(bt, 'rb').read() != before:
        subprocess.check_call(['node', os.path.join(ROOT, 'scripts', 'bt_live', 'patch_home.js')])
        subprocess.check_call([sys.executable, os.path.join(ROOT, 'scripts', 'stamp_assets.py')])
        print('首頁回測已更新')
    return rc


if __name__ == '__main__':
    sys.exit(main())
