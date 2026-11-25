#!/usr/bin/env python3
"""官方數據剛公布了嗎？（給 site.yml 的 gate 用）
讀 data/release-calendar.json：有任何一筆官方公布時間落在「現在往前 10 分鐘～160 分鐘」之間 → 結束碼 0（要跑：抓 FRED 最新值並重新部署）；否則結束碼 1（不跑）。
公布後留 10 分鐘讓 FRED 更新；視窗 160 分鐘讓後面一、兩個排程時段當作重試（GitHub 排程可能延遲）。
用法：python3 scripts/release_due.py [現在的 UTC 時間，例 2026-11-25T13:50Z，測試用]
"""
import os, sys, json, datetime as dt
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def parse(s): return dt.datetime.strptime(s, '%Y-%m-%dT%H:%MZ').replace(tzinfo=dt.timezone.utc)
def main():
    now = parse(sys.argv[1]) if len(sys.argv) > 1 else dt.datetime.now(dt.timezone.utc)
    try: cal = json.load(open(os.path.join(ROOT, 'data', 'release-calendar.json'), encoding='utf-8'))
    except Exception as e: print('release calendar unreadable -> run anyway:', repr(e)); return 0
    hit = [(k, t) for k, r in (cal.get('releases') or {}).items() for t in r.get('times', [])
           if dt.timedelta(minutes=10) <= now - parse(t) <= dt.timedelta(minutes=160)]
    print('now', now.strftime('%Y-%m-%dT%H:%MZ'), 'due:', hit or 'none')
    return 0 if hit else 1
if __name__ == '__main__': sys.exit(main())
