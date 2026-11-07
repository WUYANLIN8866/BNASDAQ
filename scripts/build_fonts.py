#!/usr/bin/env python3
"""本站精簡字型產生器：BN Sans（內文 400／500／700）、BN Serif（標題 600／700）。

為什麼：原本向 Google Fonts 載入完整的 Noto Sans TC／Noto Serif TC，第一次開站每頁要下載 1.2–1.8MB 字型；
改成只放網站用到的字，整站約 0.3MB，而且字形與 Google Fonts 版本完全相同（同一套字型檔切出來）。

步驟（在網站根目錄執行）：
  1) python3 -m http.server 8765 &   （開本機伺服器）
  2) node scripts/fonts/collect_chars.js http://127.0.0.1:8765/   → scripts/fonts/observed.json（各字重實際畫面用字）
  3) python3 scripts/build_fonts.py                               → assets/fonts/bn-*.woff2、assets/fonts/cover.json
需要：pip install fonttools brotli；npm（第一次會下載 @fontsource 字型套件到 ~/.cache/bnasdaq-fonts）。

字型沒收錄的字（例如使用者新加入的個股名稱）：site.js 的「字型補字」會向 Google Fonts 只下載那幾個字，外觀一樣；
改了網頁文字後重跑本腳本，就能把新字收進來、少一次外部下載。
"""
import glob, io, json, os, re, subprocess, sys, tarfile, tempfile, unicodedata
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.merge import Merger, Options as MergeOptions

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('BN_FONT_CACHE', os.path.expanduser('~/.cache/bnasdaq-fonts'))
PKG = {'noto-sans-tc': '5.3.1', 'noto-serif-tc': '5.3.1'}
FACES = [('n4', 'noto-sans-tc', 400, 'bn-sans-400', 'sans400'), ('n5', 'noto-sans-tc', 500, 'bn-sans-500', 'sans500'), ('n7', 'noto-sans-tc', 700, 'bn-sans-700', 'sans700'),
         ('s6', 'noto-serif-tc', 600, 'bn-serif-600', 'serif600'), ('s7', 'noto-serif-tc', 700, 'bn-serif-700', 'serif700')]
ASCII = {chr(c) for c in range(0x20, 0x7f)}
PUNCT = set('，。、；：？！「」『』（）《》〈〉【】〔〕—–…～·•％＋－×÷＝／＼＆＊＃＠＄￥€£°′″‰※→←↑↓↗↘●○◆◇■□▲△▼▽◀▶★☆✓✔✕✗±≈≠≤≥∞√｜︱‧・＿①②③④⑤')

def src_dir(fam):
    d = os.path.join(CACHE, fam + '-' + PKG[fam])
    if os.path.isfile(os.path.join(d, '400.css')): return d
    os.makedirs(CACHE, exist_ok=True)
    out = subprocess.run(['npm', 'pack', '@fontsource/%s@%s' % (fam, PKG[fam]), '--silent'], cwd=CACHE, check=True, capture_output=True, text=True).stdout.strip().splitlines()[-1]
    tmp = tempfile.mkdtemp(dir=CACHE)
    with tarfile.open(os.path.join(CACHE, out)) as t:
        t.extractall(tmp, members=[m for m in t.getmembers() if m.name.endswith(('.css', '.woff2'))], filter='data')
    os.rename(os.path.join(tmp, 'package'), d); os.rmdir(tmp); os.remove(os.path.join(CACHE, out))
    return d

def slice_map(d, fam, w):
    """unicode → Google Fonts 切片編號（來自 fontsource 的 CSS unicode-range）"""
    css = open(os.path.join(d, '%d.css' % w), encoding='utf-8').read(); m = {}
    for g in re.finditer(r'/\* ' + fam + r'-\[(\d+)\]-' + str(w) + r'-normal \*/.*?unicode-range: ([^;]+);', css, re.S):
        for part in g.group(2).split(','):
            a, _, b = part.strip()[2:].partition('-'); a = int(a, 16); b = int(b, 16) if b else a
            for cp in range(a, b + 1): m.setdefault(cp, g.group(1))
    return m

def sub_ttf(path, chars, tmpdir, tag):
    o = subset.Options(); o.layout_features = ['*']; o.name_IDs = ['*']; o.notdef_outline = True; o.flavor = None
    f = TTFont(path); s = subset.Subsetter(o); s.populate(text=''.join(chars)); s.subset(f); f.flavor = None
    p = os.path.join(tmpdir, tag + '.ttf'); f.save(p); return p

def site_chars():
    wide = lambda s: {c for c in s if ord(c) > 0x7e and not c.isspace()}
    out = set()
    for f in glob.glob(os.path.join(ROOT, '*.html')) + glob.glob(os.path.join(ROOT, 'assets', '*.js')) + glob.glob(os.path.join(ROOT, 'data', '*.json')) + glob.glob(os.path.join(ROOT, 'data', 'daily', '*.json')):
        if os.path.basename(f) in ('bt.js', 'bt-sat.js'): continue  # 回測數字資料檔
        out |= wide(open(f, encoding='utf-8').read())
    return out

def is_punct(c):
    """會影響標點擠壓（text-spacing-trim）的全形標點與引號"""
    o = ord(c)
    return 0x2010 <= o <= 0x2027 or 0x3000 <= o <= 0x303F or 0xFF00 <= o <= 0xFF65 or 0xFE10 <= o <= 0xFE1F or 0xFE30 <= o <= 0xFE4F

def parse_ranges(r):
    out = []
    for part in r.split(','):
        a, _, b = part.strip()[2:].partition('-'); a = int(a, 16); b = int(b, 16) if b else a; out.append((a, b))
    return out

def fmt_ranges(rs):
    rs = sorted(rs); m = []
    for a, b in rs:
        if m and a <= m[-1][1] + 1: m[-1] = (m[-1][0], max(m[-1][1], b))
        else: m.append((a, b))
    return ','.join('U+%x' % a if a == b else 'U+%x-%x' % (a, b) for a, b in m)

def complement(rs, lo=0, hi=0x10FFFF):
    out, cur = [], lo
    for a, b in sorted(rs):
        if a > cur: out.append((cur, a - 1))
        cur = max(cur, b + 1)
    if cur <= hi: out.append((cur, hi))
    return out

def copy_metrics(font, ref):
    for k in ('xAvgCharWidth', 'yStrikeoutSize', 'yStrikeoutPosition', 'ySubscriptXSize', 'ySubscriptYSize', 'ySubscriptXOffset', 'ySubscriptYOffset',
              'ySuperscriptXSize', 'ySuperscriptYSize', 'ySuperscriptXOffset', 'ySuperscriptYOffset', 'sTypoAscender', 'sTypoDescender', 'sTypoLineGap', 'usWinAscent', 'usWinDescent', 'sxHeight', 'sCapHeight', 'fsSelection'):
        if hasattr(ref['OS/2'], k): setattr(font['OS/2'], k, getattr(ref['OS/2'], k))
    for k in ('ascent', 'descent', 'lineGap'): setattr(font['hhea'], k, getattr(ref['hhea'], k))
    for k in ('underlinePosition', 'underlineThickness'): setattr(font['post'], k, getattr(ref['post'], k))

def main():
    """每個字重拆成：①含空白字元的英數切片、②含本站全形標點的切片（各自保留 Google 原本的切法與 unicode-range，
    讓瀏覽器的主要字型、標點間距處理與原本完全一致）、③其餘所有字合併成一個主檔。"""
    obs = json.load(open(os.path.join(ROOT, 'scripts', 'fonts', 'observed.json'), encoding='utf-8'))
    src = site_chars(); cover = {}; css = []; outdir = os.path.join(ROOT, 'assets', 'fonts'); os.makedirs(outdir, exist_ok=True)
    for f in glob.glob(os.path.join(outdir, 'bn-*.woff2')): os.remove(f)
    fam_css = {'noto-sans-tc': 'BN Sans', 'noto-serif-tc': 'BN Serif'}
    for key, fam, w, name, ok in FACES:
        d = src_dir(fam); base = os.path.join(d, 'files', '%s-chinese-traditional-%d-normal.woff2' % (fam, w))
        want = {c for c in set(obs.get(ok, '')) | ASCII | (src if key == 'n4' else set()) if not c.isspace() or c == ' '}
        smap = slice_map(d, fam, w)
        css_src = open(os.path.join(d, '%d.css' % w), encoding='utf-8').read()
        srange = {g.group(1): g.group(2) for g in re.finditer(r'/\* ' + fam + r'-\[(\d+)\]-' + str(w) + r'-normal \*/.*?unicode-range: ([^;]+);', css_src, re.S)}
        sp_of = lambda i: os.path.join(d, 'files', '%s-%s-%d-normal.woff2' % (fam, i, w))
        seg = {smap[0x20]} | {smap[ord(c)] for c in want if is_punct(c) and ord(c) in smap}
        ref = TTFont(sp_of(smap[0x20])); faces_css = []; got = set()
        with tempfile.TemporaryDirectory() as tmp:
            # ①② 獨立切片（只留本站用到的字）
            for i in sorted(seg, key=int):
                # 本站用到的字＋原切片所有非漢字（標點、符號、英數）：Chrome 判斷要不要收緊相鄰標點時會檢查字型裡有哪些標點，保留完整標點才會與原本一致
                cm = TTFont(sp_of(i)).getBestCmap(); ideo = lambda k: 0x3400 <= k <= 0x9fff or 0xf900 <= k <= 0xfaff or k >= 0x20000
                # 只收 Google CSS 宣告給這個切片的字（切片檔內另有空白等英數字形，但不在宣告範圍內，不能宣告出去）
                cs = {c for c in want | {chr(k) for k in cm if not ideo(k)} if smap.get(ord(c)) == i and ord(c) in cm}
                if not cs: continue
                f = TTFont(sub_ttf(sp_of(i), cs, tmp, 'seg%s' % i)); f.flavor = 'woff2'
                fn = '%s-s%s.woff2' % (name, i); f.save(os.path.join(outdir, fn)); got |= {chr(k) for k in f.getBestCmap()}
                faces_css.append((fn, fmt_ranges([(ord(c), ord(c)) for c in cs])))
            # ③ 主檔：其餘字（繁中完整檔為主，缺的符號從對應切片補進來）
            rest = {c for c in want if smap.get(ord(c)) not in seg}
            bcm = TTFont(base).getBestCmap(); in_base = {c for c in rest if ord(c) in bcm}; by, miss = {}, set()
            for c in sorted(rest - in_base):
                i = smap.get(ord(c))
                if i is None: miss.add(c); continue
                if ord(c) in TTFont(sp_of(i)).getBestCmap(): by.setdefault(i, set()).add(c)
                else: miss.add(c)
            parts = [sub_ttf(base, in_base, tmp, 'base')] + [sub_ttf(sp_of(i), cs, tmp, 'm%s' % i) for i, cs in sorted(by.items())]
            if len(parts) == 1: font = TTFont(parts[0])
            else:
                try: font = Merger(options=MergeOptions(drop_tables=['BASE', 'STAT'])).merge(parts)
                except Exception: font = Merger(options=MergeOptions(drop_tables=['BASE', 'STAT', 'vhea', 'vmtx'])).merge(parts)
            copy_metrics(font, ref); font.flavor = 'woff2'; fn = name + '.woff2'; font.save(os.path.join(outdir, fn))
            got |= {chr(k) for k in TTFont(os.path.join(outdir, fn)).getBestCmap()}
            faces_css.insert(0, (fn, 'U+0-1f,U+21-10ffff'))  # 主檔排除空白字元：主要字型仍是英數切片（同 Google）；同一字被多個區段涵蓋時，瀏覽器先用後定義的切片
        for fn, ur in faces_css:
            css.append('@font-face { font-family: "%s"; src: url(fonts/%s) format("woff2"); font-weight: %d; font-style: normal; font-display: swap; unicode-range: %s; }' % (fam_css[fam], fn, w, ur))
        cover[key] = ''.join(sorted(c for c in got if ord(c) > 0x7e))
        size = sum(os.path.getsize(os.path.join(outdir, fn)) for fn, _ in faces_css)
        print('%-13s %5d 字｜%6.1f KB｜%d 個檔（主檔＋切片 %s）｜原字型沒有：%s' % (name, len(got), size / 1024, len(faces_css), ','.join(sorted(seg, key=int)), ''.join(sorted(miss)) or '—'))
    p = os.path.join(outdir, 'cover.json'); json.dump(cover, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    # 寫回 site.css 的 @font-face 區塊
    cp = os.path.join(ROOT, 'assets', 'site.css'); s = open(cp, encoding='utf-8').read()
    a, b = s.index('/* @fonts-start */'), s.index('/* @fonts-end */')
    s = s[:a] + '/* @fonts-start */\n' + '\n'.join(css) + '\n' + s[b:]
    open(cp, 'w', encoding='utf-8').write(s)
    print('cover.json %d bytes；site.css 字型區塊 %d 行' % (os.path.getsize(p), len(css)))

if __name__ == '__main__': main()
