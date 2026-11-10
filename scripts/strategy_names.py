#!/usr/bin/env python3
"""策略代號檢查與全站改名（公開頁一律顯示最新的策略代號）。

網站公開頁顯示的策略代號登記在 data/strategies.json（角色 fund＝核心〔專案 B.2〕、sat＝衛星〔專案 B.3〕）。

  python3 scripts/strategy_names.py --check
      部署前檢查（site.yml 每次執行；不通過就不部署）：
      A. 頁面上的 BNASDAQ-五位數代號都必須登記在 data/strategies.json（擋下舊代號、打錯的代號）
      B. 任何頁面只要出現一個登記的代號，就必須同時出現全部登記的代號（只要有 26110 就要有 26111）
      C. 不得用「BNASDAQ」「本策略」「半倉煞車版」「B42」等泛稱或舊名稱指稱策略；品牌用法（網站名稱、邀請制、研究站…）列在 BRAND
      另外比對 data/rules-status.json（會員規則同步排程依專案 B 區寫入）：代號不同只發警告、不擋部署
      （代號改了通常代表規則改了，公開回測需要重算，不能只換字）。

  python3 scripts/strategy_names.py --rename fund=BNASDAQ-26120 [sat=…]
      規則沒變、只是代號改名時使用：把全站公開檔案的舊代號換成新代號，並更新 data/strategies.json。

只讀寫公開檔案；不含任何規則、門檻或持倉。
"""
import argparse, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG = os.path.join(ROOT, 'data', 'strategies.json')
STATUS = os.path.join(ROOT, 'data', 'rules-status.json')
CODE = re.compile(r'BNASDAQ-(?:<wbr>)?(\d{5})')

# 品牌用法（不是指某一個策略）：網站名稱、導覽、頁尾、邀請制、研究站、AI 交易說明、程式識別字串等
BRAND = [
    r'｜BNASDAQ', r'BNASDAQ｜', r'關於 BNASDAQ', r'BNASDAQ 首頁', r'© 2026 BNASDAQ', r'B<b>NASDAQ', r'BEST NASDAQ',
    r'BNASDAQ 研究站', r'BNASDAQ 採邀請制', r'BNASDAQ 是什麼', r'BNASDAQ 統一依', r'BNASDAQ 依照這套規則', r'BNASDAQ 的交易規則',
    r'BNASDAQ 會員', r'BNASDAQ 管理後台', r'BNASDAQ 每日市場分析', r'BNASDAQ 回測資料來源', r'BNASDAQ 最新策略探索進度',
    r'BNASDAQ 常見問題', r'BNASDAQ 公告', r'搜尋 BNASDAQ', r"'BNASDAQ-' \+", r'BNASDAQ-holdings-', r'BNASDAQ company fetch',
    r'BNASDAQ market fetch', r'T\.BNASDAQ\b', r'WUYANLIN8866/BNASDAQ', r'/BNASDAQ/', r'bnasdaq-bot', r'只選 <b>BNASDAQ</b>',
]
OLD = [(r'本策略', '「本策略」'), (r'半倉煞車版', '舊名稱「半倉煞車版」'), (r'\bB42\b', '舊代號「B42」')]


def public_pages():
    return sorted(glob.glob(os.path.join(ROOT, '*.html')))


def strip_comments(s):
    s = re.sub(r'<!--.*?-->', ' ', s, flags=re.S)
    s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)
    return re.sub(r'(?m)(^|[;{}\s])//[^\n]*', r'\1', s)


def load_reg():
    j = json.load(open(REG, encoding='utf-8'))
    return j, [x['code'] for x in j['strategies']]


def check():
    j, codes = load_reg()
    errs, warns = [], []
    want = set(c.split('-')[1] for c in codes)
    files = public_pages() + [os.path.join(ROOT, 'data', 'site.json')]
    for f in files:
        rel = os.path.relpath(f, ROOT)
        s = strip_comments(open(f, encoding='utf-8').read())
        found = set(CODE.findall(s))
        for c in sorted(found - want):
            errs.append(f'{rel}：代號 BNASDAQ-{c} 不在 data/strategies.json（舊代號或打錯）')
        if found & want and not want <= found:
            miss = '、'.join('BNASDAQ-' + c for c in sorted(want - found))
            errs.append(f'{rel}：出現 {"、".join("BNASDAQ-" + c for c in sorted(found & want))}，但缺少 {miss}（每個策略代號都要同時出現）')
        for m in re.finditer(r'BNASDAQ(?!-(?:<wbr>)?\d{5})', s):
            win = s[max(0, m.start() - 40):m.end() + 40]
            if any(re.search(p, win) for p in BRAND):
                continue
            line = s.count('\n', 0, m.start()) + 1
            errs.append(f'{rel}:{line}：「{s[max(0, m.start() - 20):m.end() + 20].strip()}」用 BNASDAQ 泛稱策略，請改成策略代號（品牌用法請加進 BRAND）')
        for pat, what in OLD:
            for m in re.finditer(pat, s):
                line = s.count('\n', 0, m.start()) + 1
                errs.append(f'{rel}:{line}：{what}，請改成策略代號')
    # 與專案 B 區（會員規則同步排程寫入的 rules-status.json）比對：不同只警告
    if os.path.exists(STATUS):
        try:
            st = json.load(open(STATUS, encoding='utf-8')).get('strategies') or []
        except Exception:
            st = []
        if st and st != codes:
            warns.append('專案 B 區的策略代號為 ' + '、'.join(st) + '，網站公開頁仍是 ' + '、'.join(codes)
                         + '：只是改名就執行 python3 scripts/strategy_names.py --rename 角色=新代號；規則有改則需先重算公開回測。')
    return errs, warns, codes


def rename(pairs):
    j, codes = load_reg()
    roles = {x['role']: x for x in j['strategies']}
    mp = {}
    for p in pairs:
        role, new = p.split('=', 1)
        if role not in roles:
            sys.exit(f'沒有角色 {role}（可用：{", ".join(roles)}）')
        if not re.fullmatch(r'BNASDAQ-\d{5}', new):
            sys.exit(f'新代號格式應為 BNASDAQ-五位數：{new}')
        old = roles[role]['code']
        if old != new:
            mp[old] = new
            roles[role]['code'] = new
    if not mp:
        print('代號沒有變動'); return
    files = public_pages() + glob.glob(os.path.join(ROOT, 'assets', '*.js')) + [os.path.join(ROOT, 'data', 'site.json')]
    n = 0
    for f in files:
        s = open(f, encoding='utf-8').read()
        t = re.sub(r'(BNASDAQ-(?:<wbr>)?)(\d{5})', lambda m: m.group(1) + (mp.get('BNASDAQ-' + m.group(2), 'BNASDAQ-' + m.group(2)).split('-')[1]), s)
        if t != s:
            open(f, 'w', encoding='utf-8').write(t); n += 1
            print('改名：', os.path.relpath(f, ROOT))
    json.dump(j, open(REG, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open(REG, 'a', encoding='utf-8').write('\n')
    print(f'完成：{len(mp)} 個代號、{n} 個檔案；接著執行 --check')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--rename', nargs='+', metavar='ROLE=CODE')
    a = ap.parse_args()
    if a.rename:
        rename(a.rename)
    errs, warns, codes = check()
    summ = os.environ.get('GITHUB_STEP_SUMMARY')
    lines = [f'策略代號檢查：網站代號 {"、".join(codes)}；問題 {len(errs)} 項、警告 {len(warns)} 項']
    for w in warns:
        print('::warning::' + w); lines.append('- ⚠️ ' + w)
    for e in errs:
        print('::error::' + e); lines.append('- ❌ ' + e)
    print(lines[0])
    if summ:
        open(summ, 'a', encoding='utf-8').write('\n'.join(lines) + '\n')
    sys.exit(1 if errs and (a.check or a.rename) else 0)


if __name__ == '__main__':
    main()
