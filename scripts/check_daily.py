#!/usr/bin/env python3
"""每日市場分析資料檢查（data/daily；daily.html 讀這些檔渲染）。

  python3 scripts/check_daily.py [--today] [--base origin/main]

  1. index.json：latest＝items 第一筆的 date；items 依 date 由新到舊排列、日期不重複；session 不得比較舊的報告還舊
  2. 每一筆 items 都有 data/daily/<date>.json，檔內 date、session 與 index 相同；session（美股交易日）不晚於 date
  3. date 一律是台北日期：檔內 generated（UTC）換成台北時間後的日期必須等於 date
     （排程在台北 06:46 執行＝UTC 前一天 22:46；用 UTC 日期會把前一天的報告蓋掉，2026-11-11 發生過）
  4. --today：最新一份必須是現在的台北日期（排程推送前、推送後用）
  5. --base REF：REF（例 origin/main）已發布的日期不得消失；session 不得改變
     （唯一例外：今天的報告換成更新的交易日）——防止新內容蓋掉舊報告

台北時間一律用固定 UTC+8 計算（台灣沒有夏令時間），不依賴系統時區設定。
不通過時結束碼 1 並列出問題。只讀公開資料，不含任何策略規則。
"""
import argparse, datetime as dt, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'data', 'daily')
INDEX = os.path.join(DIR, 'index.json')
TPE = dt.timezone(dt.timedelta(hours=8))
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def parse_time(iso):
    t = dt.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def taipei_date(when):
    t = parse_time(when) if isinstance(when, str) else when
    return t.astimezone(TPE).date().isoformat()


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def check(today=False, base=None, now=None):
    """回傳 (問題清單, index, items)。now：現在時間（datetime，預設系統時間；測試用）。"""
    now = now or dt.datetime.now(dt.timezone.utc)
    tday = taipei_date(now)
    errs = []
    idx = load(INDEX)
    items = idx.get('items') or []
    if not items:
        return ['index.json 沒有任何報告'], idx, items
    dates = [i.get('date') or '' for i in items]
    if idx.get('latest') != dates[0]:
        errs.append(f'index.json：latest＝{idx.get("latest")}，但 items 第一筆是 {dates[0]}')
    dup = sorted({d for d in dates if dates.count(d) > 1})
    if dup:
        errs.append('index.json：日期重複 ' + '、'.join(dup))
    if dates != sorted(dates, reverse=True):
        errs.append('index.json：items 沒有依日期由新到舊排列')
    for a, b in zip(items, items[1:]):
        if (a.get('session') or '') < (b.get('session') or ''):
            errs.append(f'{a.get("date")}：美股 {a.get("session")} 比前一份 {b.get("date")} 的美股 {b.get("session")} 還舊')
    for it in items:
        d, s = it.get('date'), it.get('session')
        if not (d and DATE.match(d) and s and DATE.match(s)):
            errs.append(f'index.json：日期格式錯誤 {it}')
            continue
        if s > d:
            errs.append(f'{d}：美股交易日 {s} 晚於報告日期')
        p = os.path.join(DIR, d + '.json')
        if not os.path.exists(p):
            errs.append(f'{d}：找不到 data/daily/{d}.json')
            continue
        r = load(p)
        if r.get('date') != d or r.get('session') != s:
            errs.append(f'{d}.json：檔內 date／session＝{r.get("date")}／{r.get("session")}，index.json 是 {d}／{s}')
        g = r.get('generated')
        if not g:
            errs.append(f'{d}.json：缺少 generated')
            continue
        try:
            tp = taipei_date(g)
        except ValueError:
            errs.append(f'{d}.json：generated 格式錯誤 {g}')
            continue
        if tp != d:
            errs.append(f'{d}.json：generated {g} 是台北 {tp}，報告日期卻是 {d}（日期要用台北日期，請改用 scripts/publish_daily.py 發布）')
    if today and dates[0] != tday:
        errs.append(f'最新一份是 {dates[0]}，今天（台北）是 {tday}')
    if base:
        try:
            out = subprocess.run(['git', '-C', ROOT, 'show', f'{base}:data/daily/index.json'],
                                 capture_output=True, text=True, check=True).stdout
            old = json.loads(out)
        except Exception as e:  # 讀不到就要求先 git fetch，不默默跳過
            errs.append(f'讀不到 {base} 的 data/daily/index.json（先 git fetch origin）：{e}')
        else:
            cur = {i.get('date'): i.get('session') for i in items}
            for i in old.get('items') or []:
                d, s = i.get('date'), i.get('session')
                if d not in cur:
                    errs.append(f'{d}：{base} 已發布的報告從 index.json 消失')
                elif cur[d] != s and not (d == tday and (cur[d] or '') > (s or '')):
                    errs.append(f'{d}：{base} 已發布美股 {s} 的報告，現在被改成美股 {cur[d]}（不得覆蓋舊報告；新報告用今天的台北日期另存）')
    return errs, idx, items


def main():
    ap = argparse.ArgumentParser(description='每日市場分析資料檢查')
    ap.add_argument('--today', action='store_true', help='最新一份必須是今天（台北日期）')
    ap.add_argument('--base', metavar='REF', help='與已發布版本比對（例 origin/main）')
    ap.add_argument('--now', help='模擬現在時間（ISO，例 2026-11-11T22:46:00Z；測試用）')
    a = ap.parse_args()
    now = parse_time(a.now) if a.now else None
    errs, idx, items = check(a.today, a.base, now)
    head = f'{items[0].get("date")}（美股 {items[0].get("session")}）' if items else '無'
    print(f'每日市場分析檢查：最新 {head}；今天台北日期 {taipei_date(now or dt.datetime.now(dt.timezone.utc))}；問題 {len(errs)} 項')
    for e in errs:
        print('  ❌ ' + e)
    sys.exit(1 if errs else 0)


if __name__ == '__main__':
    main()
