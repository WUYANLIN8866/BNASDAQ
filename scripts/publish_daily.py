#!/usr/bin/env python3
"""每日市場分析發布：排程「每日 BNASDAQ 財經報告」寫入 data/daily 的唯一方式。

  python3 scripts/publish_daily.py 報告.json

報告.json＝schema「bnasdaq-daily/1」的報告內容（session、headline、summary、indices、sources…，欄位照最新一份 data/daily/*.json）。
date、generated 不用填，填了也會被覆寫——日期由本程式決定，不交給人或 AI 判斷：
  date      ＝現在的台北日期（固定 UTC+8 計算，不依賴系統時區；排程台北 06:46 執行時 UTC 還是前一天）
  generated ＝現在時間（UTC）
寫入 data/daily/<date>.json，更新 index.json（今天這筆已存在就更新，否則加在最前面；latest＝date），
最後跑 scripts/check_daily.py 的全部檢查（含 --today）；任何一項不通過就還原、不留下半套檔案。

拒絕發布（結束碼 1，檔案不變）：
  - 缺少必要欄位、schema 不對，或 session 不是 YYYY-MM-DD、晚於今天、早於前一份報告的 session
  - data/daily/<今天>.json 已存在但不是今天（台北）產出的，或它的 session 比這次新
--now 只給測試用（模擬執行時間，例 2026-11-11T22:46:00Z）。
"""
import argparse, datetime as dt, json, os, sys

sys.dont_write_bytecode = True  # 不產生 scripts/__pycache__，排程提交前「只能有 data/daily 變更」的檢查才不會被擋
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_daily as cd  # noqa: E402

SCHEMA = 'bnasdaq-daily/1'
REQUIRED = ['session', 'headline', 'summary', 'indices', 'sources']


def dump(obj, path, indent):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(obj, ensure_ascii=False, indent=indent) + '\n')


def main():
    ap = argparse.ArgumentParser(description='每日市場分析發布（日期一律由程式決定：台北日期）')
    ap.add_argument('report', help='報告 JSON（放在 repo 外的暫存檔）')
    ap.add_argument('--now', help='模擬現在時間（測試用）')
    a = ap.parse_args()
    now = (cd.parse_time(a.now) if a.now else dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc).replace(microsecond=0)
    day = cd.taipei_date(now)

    rep = cd.load(a.report)
    errs = []
    if rep.get('schema', SCHEMA) != SCHEMA:
        errs.append(f'schema 應為 {SCHEMA}，收到 {rep.get("schema")}')
    miss = [k for k in REQUIRED if k not in rep]
    if miss:
        errs.append('缺少欄位：' + '、'.join(miss))
    s = rep.get('session')
    idx = cd.load(cd.INDEX)
    others = [i for i in idx.get('items') or [] if i.get('date') != day]
    prev = max((i for i in others if (i.get('date') or '') < day), key=lambda i: i['date'], default=None)
    if not (isinstance(s, str) and cd.DATE.match(s)):
        errs.append(f'session 應為美股交易日 YYYY-MM-DD，收到 {s!r}')
    else:
        if s > day:
            errs.append(f'session {s} 晚於今天（台北 {day}）')
        if prev and s < prev.get('session', ''):
            errs.append(f'session {s} 比前一份 {prev["date"]} 的美股 {prev["session"]} 還舊')
    path = os.path.join(cd.DIR, day + '.json')
    old_raw = open(path, encoding='utf-8').read() if os.path.exists(path) else None
    if old_raw is not None:
        old = json.loads(old_raw)
        g = old.get('generated')
        if not g or cd.taipei_date(g) != day:
            errs.append(f'data/daily/{day}.json 已存在但不是今天（台北）產出的（generated {g}），不覆蓋；請人工檢查')
        elif isinstance(s, str) and (old.get('session') or '') > s:
            errs.append(f'data/daily/{day}.json 已是美股 {old.get("session")} 的報告，比這次的 {s} 新，不覆蓋')
    if errs:
        print('不發布：')
        for e in errs:
            print('  ❌ ' + e)
        sys.exit(1)

    out = {'schema': SCHEMA, 'date': day, 'session': s, 'generated': now.strftime('%Y-%m-%dT%H:%M:%SZ')}
    out.update({k: v for k, v in rep.items() if k not in out})
    idx_raw = open(cd.INDEX, encoding='utf-8').read()
    items = [{'date': day, 'session': s, 'headline': rep['headline']}] + others
    items.sort(key=lambda i: i.get('date') or '', reverse=True)
    idx['items'], idx['latest'] = items, items[0]['date']
    dump(out, path, 1)
    dump(idx, cd.INDEX, 2)

    errs, _, _ = cd.check(today=True, now=now)
    if errs:  # 還原，不留下半套檔案
        with open(cd.INDEX, 'w', encoding='utf-8') as f:
            f.write(idx_raw)
        if old_raw is None:
            os.remove(path)
        else:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(old_raw)
        print('檢查不通過，已還原：')
        for e in errs:
            print('  ❌ ' + e)
        sys.exit(1)
    act = '更新' if old_raw is not None else '新增'
    print(f'已{act} data/daily/{day}.json（台北日期 {day}，美股 {s} 收盤，generated {out["generated"]}）；index.json latest＝{day}；檢查 0 問題')


if __name__ == '__main__':
    main()
