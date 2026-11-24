#!/usr/bin/env python3
"""把網站引用的靜態檔案版本號（?v=）改成「檔案內容的雜湊」。
好處：只有內容變了的檔案版本號才會變，訪客瀏覽器裡沒變的檔案（例如 bt.js）可以繼續用快取，不必重新下載。
用法：改完 assets 裡的檔案後，在網站根目錄執行  python3 scripts/stamp_assets.py

蓋版本號的地方：
  1) assets/site.css 裡的字型檔：url(fonts/….woff2?v=…)
  2) 每個 HTML 引用的 assets/*.css、*.js，以及 <link rel="preload"> 的字型檔（必須和 site.css 裡的網址一模一樣，瀏覽器才會共用同一次下載）
順序固定是先 1) 再 2)：字型版本號寫在 site.css 裡，site.css 的版本號要用蓋完之後的內容算。

為什麼字型也要版本號（2026-11-24 站主回報「字型怪怪的沒有統一」）：
  字型重建後檔名不變；瀏覽器或 CDN 還留著舊檔時，新加進去的字在舊檔裡找不到，那幾個字會改用系統字型，
  同一行字就有兩種字型。網址帶內容雜湊後，字型一變網址就變，不會再拿到舊檔。
"""
import glob, hashlib, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAT = re.compile(r'(assets/[A-Za-z0-9_./-]+\.(?:css|js))\?v=[A-Za-z0-9]+')
FONT_CSS = re.compile(r'url\(fonts/([A-Za-z0-9_.-]+\.woff2)(?:\?v=[A-Za-z0-9]+)?\)')
FONT_HTML = re.compile(r'(assets/fonts/[A-Za-z0-9_.-]+\.woff2)(?:\?v=[A-Za-z0-9]+)?')
cache = {}
def h(p):
    if p not in cache:
        with open(os.path.join(ROOT, p), 'rb') as f: cache[p] = hashlib.sha256(f.read()).hexdigest()[:10]
    return cache[p]
have = lambda p: os.path.isfile(os.path.join(ROOT, p))

# 1) site.css 裡的字型檔
cp = os.path.join(ROOT, 'assets', 'site.css'); s = open(cp, encoding='utf-8').read()
t = FONT_CSS.sub(lambda m: 'url(fonts/%s?v=%s)' % (m.group(1), h('assets/fonts/' + m.group(1))) if have('assets/fonts/' + m.group(1)) else m.group(0), s)
if t != s: open(cp, 'w', encoding='utf-8').write(t)
fonts = sorted(k for k in cache if k.startswith('assets/fonts/')); css_changed = t != s

# 2) 每個 HTML
changed = 0
for f in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
    s = open(f, encoding='utf-8').read()
    t = PAT.sub(lambda m: m.group(1) + '?v=' + h(m.group(1)) if have(m.group(1)) else m.group(0), s)
    t = FONT_HTML.sub(lambda m: m.group(1) + '?v=' + h(m.group(1)) if have(m.group(1)) else m.group(0), t)
    if t != s: open(f, 'w', encoding='utf-8').write(t); changed += 1
print('字型檔 %d 個已帶版本號（site.css %s）；更新 %d 個 HTML；版本號：%s' % (len(fonts), '有更新' if css_changed else '不需更新', changed,
      '、'.join('%s=%s' % (os.path.basename(k), v) for k, v in sorted(cache.items()) if not k.startswith('assets/fonts/'))))
