#!/usr/bin/env python3
"""官方數據公布了、網站抓到了沒？（site.yml 的 gate、scripts/heatmap_live.py 的盤中檢查共用）

2026-11-25 站主：「數據都公布了為何還未定案，請更新，並確保所有模型條件狀態都可以在新數據公布後更新所有條件」。
原因：舊版只看時鐘——「公布後 10～160 分鐘內剛好有排程啟動」才抓。GitHub 的排程在這個 repo 會晚 3～10 小時才啟動，
      11/25 13:30 UTC 的個人所得與支出公布後，13:50、14:50 那兩班都沒有準時啟動；等它們啟動時已經超過 160 分鐘，又會被擋掉。
新版改看「狀態」，不看時鐘：
  data/macro-status.json 的 obs＝{數列代號: [最新一筆觀測值的月份, 這個月份第一次被抓到的時間]}（scripts/fetch_macro.py 每次抓完寫入）。
  一次官方公布「已經抓到」＝那一類數列裡過半數的最新月份，是在公布時間之後（官方有公告時間的往前留 1 小時、推定時間的往前留 3 天）才第一次被抓到的。
  還沒抓到的公布（公布滿 10 分鐘、未滿 7 天）＝待抓。待抓的時候，依「上一次抓取時間」決定現在要不要再抓一次：
    公布後 3 小時內每 20 分鐘、48 小時內每 2 小時、之後每 6 小時；滿 7 天不再追（每天收盤後那一次照常抓全部數列）。
  這樣不管排程晚多久啟動、FRED 晚多久更新，只要啟動時還有沒抓到的公布就會抓；抓到之後就不再多跑。
哪一類數列屬於哪一次公布：data/daily-topics.json 各主題的 rule（公開資料庫的數列代號）× data/release-calendar.json 的 topics（主題 → 時間表）。
  都是通用的對照表，和任何策略用了哪些資料無關。
月底凍結（fetch_macro.py：本月最後一個交易日收盤後到換月之前不重抓）期間不追（status 的 frozen＝被凍結的月份）。

用法：python3 scripts/release_due.py [現在的 UTC 時間，例 2026-11-25T13:50Z，測試用]
      結束碼 0＝要跑（抓 FRED 最新值並重新部署）；1＝不用跑。
"""
import os, re, sys, json, datetime as dt
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UTC = dt.timezone.utc
SETTLE = dt.timedelta(minutes=10)      # 公布後留 10 分鐘讓 FRED 更新
EXPIRE = dt.timedelta(days=7)          # 公布滿 7 天還對不上就不再追（例如政府關門、那一次其實沒有公布）
MARGIN = {False: dt.timedelta(hours=1), True: dt.timedelta(days=3)}   # 新月份最早可以比時間表早多久出現：官方公告時間／推定時間


def parse(s):
    """'2026-11-25T13:30Z' 或 '2026-11-25T13:30:05Z' → datetime（UTC）；讀不懂回 None"""
    for f in ('%Y-%m-%dT%H:%MZ', '%Y-%m-%dT%H:%M:%SZ'):
        try: return dt.datetime.strptime(str(s), f).replace(tzinfo=UTC)
        except ValueError: pass
    return None


def month_et(t):
    try:
        from zoneinfo import ZoneInfo
        return t.astimezone(ZoneInfo('America/New_York')).strftime('%Y-%m')
    except Exception:  # noqa
        return (t - dt.timedelta(hours=5)).strftime('%Y-%m')


def groups(cal, topics, obs):
    """{時間表代號: [那一類的數列清單, …]}（一個主題一組；obs 裡沒有的數列不算）"""
    out = {}
    for tp in topics or []:
        rel = ((cal or {}).get('topics') or {}).get(tp.get('code'))
        if not rel or not tp.get('rule'):
            continue
        try: rx = re.compile(tp['rule'])
        except re.error: continue
        ser = sorted(s for s in (obs or {}) if rx.search(s))
        if ser:
            out.setdefault(rel, []).append(ser)
    return out


def caught(t, approx, ser, st):
    """t 那一次公布，ser 這一組數列抓到了沒"""
    obs, last_ok = (st or {}).get('obs') or {}, parse((st or {}).get('last_ok') or '')
    if last_ok is None or last_ok < t - MARGIN[bool(approx)]:
        return False
    have = [parse((obs.get(s) or [None, None])[1] or '') for s in ser if s in obs]
    if not have:   # 舊版 status（沒有 obs）：只能看「公布後有沒有成功抓過」
        return last_ok >= t + SETTLE
    return 2 * sum(1 for x in have if x is not None and x >= t - MARGIN[bool(approx)]) > len(have)


def pending(now, cal, topics, st):
    """還沒抓到的官方公布：[(時間表代號, 公布時間)]"""
    st = st or {}
    grp, out = groups(cal, topics, st.get('obs')), []
    for code, r in ((cal or {}).get('releases') or {}).items():
        ts = sorted(x for x in (parse(v) for v in r.get('times', [])) if x is not None and x + SETTLE <= now)
        if not ts or now - ts[-1] > EXPIRE:
            continue
        t = ts[-1]   # 只看最近一次：更早的已經被這一次蓋過
        sets = grp.get(code) or [[]]
        if not all(caught(t, r.get('approx'), ser, st) for ser in sets):
            out.append((code, t))
    return out


def due(now, cal, topics, st):
    """現在該不該抓：回傳 (要抓的 [(代號, 公布時間)], 還沒抓到但還不到重試時間的 [(代號, 公布時間)])"""
    st = st or {}
    pend = pending(now, cal, topics, st)
    if st.get('frozen') and st.get('frozen') == month_et(now):
        return [], pend
    chk = parse(st.get('checked') or '')
    go, wait = [], []
    for code, t in pend:
        age = now - t
        gap = dt.timedelta(minutes=20) if age < dt.timedelta(hours=3) else dt.timedelta(hours=2) if age < dt.timedelta(hours=48) else dt.timedelta(hours=6)
        (go if chk is None or chk < t + SETTLE or now - chk >= gap else wait).append((code, t))
    return go, wait


def load(name):
    try: return json.load(open(os.path.join(ROOT, 'data', name), encoding='utf-8'))
    except Exception: return None  # noqa


def main():
    now = parse(sys.argv[1]) if len(sys.argv) > 1 else dt.datetime.now(UTC)
    cal = load('release-calendar.json')
    if cal is None:
        print('release calendar unreadable -> run anyway'); return 0
    go, wait = due(now, cal, (load('daily-topics.json') or {}).get('topics') or [], load('macro-status.json') or {})
    f = lambda xs: [(c, t.strftime('%Y-%m-%dT%H:%MZ')) for c, t in xs] or 'none'
    print('now', now.strftime('%Y-%m-%dT%H:%MZ'), 'due:', f(go), '| not caught yet, retry later:', f(wait))
    return 0 if go else 1


if __name__ == '__main__':
    sys.exit(main())
