#!/usr/bin/env python3
"""BNASDAQ｜首頁回測每月延伸（每月初由排程任務執行；也可手動執行）。
產生器（含 BNASDAQ-26110／26111 的規則與基礎資料）存放在私人位置，不放在本公開 repo；排程任務執行前先下載到暫存資料夾。
1) 套件版本不符時安裝產生器 requirements.txt 指定的版本（scikit-learn 1.9.1、statsmodels 0.15.0）
2) 執行產生器：assets/bt.js、assets/bt-sat.js 延伸到上個月最後一個交易日；歷史部分必須與現有檔案逐值相同，否則不寫檔；
   只輸出到上個月底，當月持倉不計算、不輸出
3) 有更新時：同步首頁靜態備用數字（patch_home.js）與資源版本號（stamp_assets.py）
結束碼：0＝已更新或已是最新；2＝公開資料還沒齊（稍後再跑）；1＝錯誤
用法：python3 scripts/bt_live/run_monthly.py --gen /path/to/generator_dir"""
import os, sys, argparse, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def ensure_versions(req):
    """產生器 requirements.txt 列的套件：沒裝或版本不符就安裝指定版本。
    安裝失敗只警告、用目前版本繼續——產生器的歷史逐值比對會擋下任何因版本造成的數值差異（不符就不寫檔）。"""
    bad = []
    for line in open(req, encoding='utf-8'):
        line = line.split('#')[0].strip()
        if not line:
            continue
        pkg, _, ver = line.partition('==')
        pkg, ver = pkg.strip(), ver.strip()
        try:
            got = __import__({'scikit-learn': 'sklearn'}.get(pkg, pkg)).__version__
        except Exception:
            got = None
        if got is None or (ver and got != ver):
            bad.append(line)
    if bad:
        print('安裝套件：', '、'.join(bad), flush=True)
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', '--break-system-packages'] + bad)
        except subprocess.CalledProcessError as e:
            print('警告：套件安裝失敗（%s），改用目前已安裝的版本繼續' % e, flush=True)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--gen', required=True, help='產生器檔案所在資料夾（私人，不在本 repo）')
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
