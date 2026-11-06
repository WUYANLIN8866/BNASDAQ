#!/usr/bin/env python3
"""把每個 HTML 引用的 assets/*.css、*.js 版本號（?v=）改成「檔案內容的雜湊」。
好處：只有內容變了的檔案版本號才會變，訪客瀏覽器裡沒變的檔案（例如 bt.js）可以繼續用快取，不必重新下載。
用法：改完 assets 裡的檔案後，在網站根目錄執行  python3 scripts/stamp_assets.py
"""
import glob, hashlib, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAT = re.compile(r'(assets/[A-Za-z0-9_./-]+\.(?:css|js))\?v=[A-Za-z0-9]+')
cache = {}
def h(p):
    if p not in cache:
        with open(os.path.join(ROOT, p), 'rb') as f: cache[p] = hashlib.sha256(f.read()).hexdigest()[:10]
    return cache[p]
changed = 0
for f in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
    s = open(f, encoding='utf-8').read()
    t = PAT.sub(lambda m: m.group(1) + '?v=' + h(m.group(1)) if os.path.isfile(os.path.join(ROOT, m.group(1))) else m.group(0), s)
    if t != s: open(f, 'w', encoding='utf-8').write(t); changed += 1
print('更新 %d 個 HTML；版本號：%s' % (changed, '、'.join('%s=%s' % (os.path.basename(k), v) for k, v in sorted(cache.items()))))
