#!/usr/bin/env python3
"""scripts/heatmap_live.py 的模擬測試（不連網路、不碰 GitHub）：用假時鐘與假行情跑完整個交易日。

  python3 scripts/tests/heatmap_live/test_extended.py

測的事（2026-11-23 加美股盤前／盤後時一起寫的）：
  1. 美股一整天：02:10 啟動（排程台北 15:10＝冬令美東 02:10） → 盤前 04:00～09:30 → 正規 09:30～16:00 → 盤後 16:00～20:00；中間每 320 分鐘交棒（交棒後走勢、收盤報價接得上）。
     盤前漲跌＝盤前最後成交 ÷ 前一交易日收盤 − 1；盤後漲跌＝盤後最後成交 ÷ 當天收盤 − 1；沒成交的不出現；走勢每 15 分鐘一點。
  2. 休市日（感恩節）：盤前開始 25 分鐘沒有當天成交 → 結束、不發布。
  3. 提早收盤日（感恩節隔天）：依行情來源改成 13:00 收盤、盤後到 17:00。
  4. 回歸：台股整個時段、美股正規時段的快照（q、pp、state…）和改版前的程式（git HEAD 版或 --old 指定的檔案）逐份相同。
"""
import base64
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ET, TPE = ZoneInfo('America/New_York'), ZoneInfo('Asia/Taipei')


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def ts(day, h, m, tz=ET):
    return int(dt.datetime(day.year, day.month, day.day, h, m, tzinfo=tz).timestamp())


class Clock:
    def __init__(self, t):
        self.t = float(t)

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += max(0.2, s)


class MemPub:
    """記憶體裡的 heatmap-live 分支：發布、讀 blob（交棒接續用）、啟動下一棒都記下來。"""
    def __init__(self, hm, clock):
        self.hm, self.clock, self.files, self.blobs, self.keep, self.log, self.dispatches = hm, clock, {}, {}, {}, [], []

    def sha(self, c):
        return hashlib.sha1(c.encode()).hexdigest()

    def load(self):
        self.keep = {p: self.sha(c) for p, c in self.files.items()}; return 200

    def publish(self, mk, slot, text, message):
        f = self.hm.MARKETS[mk]['file']
        self.files[f + '.json'] = text; self.files[f'{f}-{slot}.json'] = text; self.blobs[self.sha(text)] = text
        for p in sorted(p for p in self.files if p.startswith(f + '-'))[:-self.hm.KEEP]:
            del self.files[p]
        self.keep = {p: self.sha(c) for p, c in self.files.items()}
        self.log.append((self.clock(), json.loads(text)))
        return True

    def call(self, method, path, body=None, tries=2):
        if method == 'GET' and path.startswith('/git/blobs/'):
            c = self.blobs.get(path.rsplit('/', 1)[1])
            return (200, {'content': base64.b64encode(c.encode()).decode()}) if c else (404, {})
        return 404, {}

    def dispatch(self, ref, inputs, workflow=None):
        self.dispatches.append((self.clock(), dict(inputs), workflow)); return True, 204, {}

    def others(self, me):
        return []


class FakeUS:
    """假的美股行情：價格是時間的確定函數；流動性 0＝盤前盤後都沒成交、1＝盤前 07:00 後與盤後前 2 小時才有、2＝整段都有。"""
    def __init__(self, day, syms, early=False, holiday=False):
        self.day, self.syms, self.early, self.holiday = day, syms, early, holiday
        self.pre, self.open = ts(day, 4, 0), ts(day, 9, 30)
        self.close, self.post = (ts(day, 13, 0), ts(day, 17, 0)) if early else (ts(day, 16, 0), ts(day, 20, 0))
        prev = day - dt.timedelta(days=3 if day.weekday() == 0 else 1)
        self.prev_t = ts(prev, 16, 0)
        self.P0 = {s: 50.0 + 7 * i for i, s in enumerate(syms)}
        self.liq = {s: 0 if i % 7 == 0 else 1 if i % 3 == 0 else 2 for i, s in enumerate(syms)}

    def px(self, s, t):
        i = self.syms.index(s)
        return round(self.P0[s] * (1 + 0.03 * math.sin((t - self.pre) / 5400.0 + i)), 4)

    def traded(self, s, m):
        if self.open <= m < self.close:
            return True
        if self.holiday:
            return False
        lq = self.liq[s]
        if lq == 0:
            return False
        if lq == 1:
            return self.pre + 3 * 3600 <= m < self.open or self.close <= m < self.close + 2 * 3600
        return self.pre <= m < self.post

    def last_trade(self, s, now, lo, hi):
        m = min(int(now) // 60 * 60, hi - 60)
        while m >= lo:
            if self.traded(s, m) and m <= now:
                return m, self.px(s, m)
            m -= 60
        return None

    def reg(self, s, now):   # (regularMarketPrice, regularMarketTime)
        if self.holiday or now < self.open:
            return self.P0[s], self.prev_t
        if now < self.close:
            return self.px(s, now), int(now)
        return self.px(s, self.close), self.close

    def batch(self, clock):
        def f(b, nonce=None):
            out = {}
            for s in b:
                p, t = self.reg(s, clock())
                out[s] = (p, self.P0[s] * 0.99, t, (self.open, self.close))
            return 200, out
        return f

    def ext(self, clock):
        def f(b, nonce=None):
            now, out = clock(), {}
            for s in b:
                p, t = self.reg(s, now)
                bars = [] if self.holiday else [(m, self.px(s, m)) for m in range(self.pre, int(now) // 60 * 60 + 1, 60) if self.traded(s, m) and m <= now]
                out[s] = (p, t, (self.pre, self.open, self.close, self.post), bars)
            return 200, out
        return f


def run_day(hm, fake, start, syms, budget=None):
    clock = Clock(start)
    pub = MemPub(hm, clock)
    hm.PATHSET = None
    hm.yahoo_batch = fake.batch(clock); hm.yahoo_ext = fake.ext(clock); hm.yahoo_intraday = lambda b, ysym=None: {}
    if budget:
        os.environ['HM_BUDGET'] = str(budget)
    res, runs = None, 0
    while True:
        runs += 1
        now = clock()
        sess = hm.active('US', now) or hm.session('US', now)
        if not sess or now >= hm.span('US', sess)[1]:
            break
        S = hm.Session('US', sess, syms, pub, clock=clock, sleep=clock.sleep, t0=now)
        res = S.run()
        if res != 'relay':
            break
        clock.t += 25   # 下一棒啟動要一點時間
    os.environ.pop('HM_BUDGET', None)
    return res, runs, pub


def check(cond, msg, fails):
    if not cond:
        fails.append(msg); print('  ❌', msg)


def test_full_day(hm, fails):
    print('【1】美股一整天（2026-11-23 週一）：盤前 → 正規 → 盤後，含交棒')
    day = dt.date(2026, 11, 23)
    syms = [f'S{i:02d}' for i in range(30)]
    fake = FakeUS(day, syms)
    res, runs, pub = run_day(hm, fake, ts(day, 2, 10), syms)
    snaps = pub.log
    pre = [(t, s) for t, s in snaps if s.get('ext') == 'pre']
    reg = [(t, s) for t, s in snaps if 'ext' not in s]
    post = [(t, s) for t, s in snaps if s.get('ext') == 'post']
    rel = [d for d in pub.dispatches if d[2] in (None, hm.WORKFLOW)]
    aft = [d for d in pub.dispatches if d[2] == hm.AFTER]
    print(f'  結果 {res}；{runs} 棒（交棒 {len(rel)} 次：', [dt.datetime.fromtimestamp(t, ET).strftime('%H:%M') for t, *_ in rel], '；收盤後更新',
          [dt.datetime.fromtimestamp(t, ET).strftime('%H:%M') for t, *_ in aft], '）；快照 盤前', len(pre), '正規', len(reg), '盤後', len(post))
    check(res == 'done', f'結果應為 done，實際 {res}', fails)
    check(runs == 4 and len(rel) == 3, f'應交棒 3 次、共 4 棒，實際 {runs} 棒、{len(rel)} 次', fails)
    check(all(d[1].get('market') == 'US' and d[1].get('relay') for d in rel), '交棒參數要帶 relay 與 market=US', fails)
    check(len(aft) == 1 and abs(aft[0][0] - (fake.close + 600)) < 61, '收盤 10 分鐘後啟動一次 tw-latest.yml（只一次，交棒後不重複）', fails)
    check(not any(t < fake.pre for t, _ in snaps), '盤前 04:00 以前不應發布', fails)
    check(pre and all(s['state'] == 'pre' and not s['q'] for _, s in pre), '盤前快照 state＝pre、q 是空的', fails)
    check(pre and pre[-1][1]['xstate'] == 'closed' and all(s['xstate'] == 'open' for _, s in pre[:-1]), '盤前最後一份 xstate＝closed，其餘 open', fails)
    check(5 * 60 * 0.9 <= len(pre) <= 5.5 * 60 + 2, f'盤前約每分鐘一份（應約 330 份），實際 {len(pre)}', fails)
    # 盤前數字逐檔驗算
    bad = 0
    for t, s in pre[::17] + pre[-1:]:
        for sym in syms:
            lt = fake.last_trade(sym, t, fake.pre, fake.open)
            v = s['x'].get(sym)
            if lt is None:
                bad += v is not None
            else:
                want = [round(lt[1], 4), round((lt[1] / fake.P0[sym] - 1) * 100, 2)]
                bad += v is None or v[:2] != want
    check(bad == 0, f'盤前價格／漲跌（對前一交易日收盤）逐檔驗算不符 {bad} 筆', fails)
    s7 = next(s for t, s in pre if t >= ts(day, 6, 0))
    check(all(sym not in s7['x'] for sym in syms if fake.liq[sym] != 2), '06:00 時只有整段都有成交的才出現（流動性 0、1 的還沒有）', fails)
    s8 = next(s for t, s in pre if t >= ts(day, 7, 5))
    check(all((sym in s8['x']) == (fake.liq[sym] > 0) for sym in syms), '07:05 起流動性 1 也出現、流動性 0 一直沒有', fails)
    last = pre[-1][1]
    check(last['xpn'] == 22 and max(len(v) for v in last['xpp'].values()) == 22, f'盤前走勢 22 點（15 分鐘一點），實際 pn={last["xpn"]} 最長={max(len(v) for v in last["xpp"].values())}', fails)
    sym = syms[1]
    exp = [int(round((fake.px(sym, fake.pre + k * 900 + 840) / fake.P0[sym] - 1) * 10000)) for k in range(22)]
    check(last['xpp'][sym] == exp, f'盤前走勢逐點驗算（{sym}）', fails)
    check(last['xopen'] == fake.pre and last['xclose'] == fake.open, '盤前起訖＝04:00～09:30', fails)
    # 正規時段
    check(reg and reg[0][1]['state'] == 'open' and reg[0][0] >= fake.open, '09:30 起正規時段 state＝open', fails)
    closed = [s for t, s in reg if s['state'] == 'closed']
    check(len(closed) == 1 and abs(next(t for t, s in reg if s['state'] == 'closed') - (fake.close + 600)) < 61, '收盤 10 分鐘後發布一份 closed（正規）', fails)
    # 盤後
    check(post and all(s['state'] == 'closed' for _, s in post), '盤後快照 state 維持 closed（舊版網頁顯示收盤）', fails)
    check(post and post[-1][1]['xstate'] == 'closed' and post[-1][0] >= fake.post + hm.MARKETS['US']['xtail'], '盤後結束（20:00＋xtail）後最後一份 xstate＝closed', fails)
    bad = 0
    for t, s in post[::13] + post[-1:]:
        for sym in syms:
            lt = fake.last_trade(sym, t, fake.close, fake.post)
            v, base = s['x'].get(sym), fake.px(sym, fake.close)
            if lt is None:
                bad += v is not None
            else:
                bad += v is None or v[:2] != [round(lt[1], 4), round((lt[1] / base - 1) * 100, 2)]
    check(bad == 0, f'盤後價格／漲跌（對當天收盤）逐檔驗算不符 {bad} 筆', fails)
    check(all(len(s['q']) == len(syms) and len(s['pp']) == len(syms) for _, s in post), '盤後（含交棒後）每一份都還帶著當天收盤 q 與正規時段走勢 pp', fails)
    qok = all(abs(post[-1][1]['q'][sym][0] - fake.px(sym, fake.close)) < 1e-6 for sym in syms)
    check(qok, '盤後快照的 q＝當天收盤價', fails)
    lp = post[-1][1]
    check(lp['xpn'] == 16 and lp['xopen'] == fake.close and lp['xclose'] == fake.post, f'盤後走勢 16 點、起訖 16:00～20:00，實際 {lp["xpn"]}', fails)
    check(max(len(v) for v in lp['pp'].values()) == 26, '正規時段走勢 26 點（交棒後接得上）', fails)
    return snaps


def test_holiday(hm, fails):
    print('【2】休市日（2026-11-26 感恩節）：盤前沒有當天成交 → 結束、不發布')
    day = dt.date(2026, 11, 26)
    syms = [f'S{i:02d}' for i in range(30)]
    fake = FakeUS(day, syms, holiday=True)
    res, runs, pub = run_day(hm, fake, ts(day, 2, 45), syms)
    check(res == 'holiday' and not pub.log, f'應為 holiday 且不發布，實際 {res}、{len(pub.log)} 份', fails)


def test_early_close(hm, fails):
    print('【3】提早收盤日（2026-11-27）：依行情來源 13:00 收盤、盤後到 17:00')
    day = dt.date(2026, 11, 27)
    syms = [f'S{i:02d}' for i in range(30)]
    fake = FakeUS(day, syms, early=True)
    res, runs, pub = run_day(hm, fake, ts(day, 3, 30), syms)
    post = [(t, s) for t, s in pub.log if s.get('ext') == 'post']
    closed_reg = [t for t, s in pub.log if s['state'] == 'closed' and 'ext' not in s]
    check(res == 'done', f'結果 {res}', fails)
    check(closed_reg and abs(closed_reg[0] - (fake.close + 600)) < 61, '13:10 發布正規時段 closed', fails)
    check(post and post[-1][1]['xclose'] == fake.post and post[-1][0] < fake.post + 600, '盤後到 17:00（加 xtail）結束', fails)
    check(post and post[-1][1]['xpn'] == 16, '盤後走勢 16 點', fails)
    pre = [s for t, s in pub.log if s.get('ext') == 'pre']
    check(pre and pre[-1]['close'] == fake.close, '盤前就依行情來源把收盤改成 13:00', fails)


def tw_regression(hm_new, hm_old, fails):
    print('【4a】回歸：台股一整個時段，新舊程式的快照逐份相同')
    day = dt.date(2026, 11, 24)
    syms = [str(2300 + i) for i in range(40)]
    o, c = ts(day, 9, 0, TPE), ts(day, 13, 30, TPE)

    def fake_tw(clock):
        def f(codes):
            now = clock(); out = {}
            for i, s in enumerate(syms):
                if now < o:
                    continue
                t = min(int(now), c)
                p = round(100 * (1 + 0.05 * math.sin((t - o) / 3000 + i)), 2)
                out[s] = (p, 100.0, t)
            return out, 'Yahoo奇摩股市'
        return f
    logs = []
    for hm in (hm_new, hm_old):
        clock = Clock(ts(day, 8, 10, TPE)); pub = MemPub(hm, clock)
        hm.PATHSET = None; hm.fetch_tw = fake_tw(clock); hm.yahoo_intraday = lambda b, ysym=None: {}
        S = hm.Session('TW', hm.session('TW', clock()), syms, pub, clock=clock, sleep=clock.sleep, t0=clock())
        r = S.run(); logs.append((r, [(t, s) for t, s in pub.log], pub.dispatches))
    (rn, ln, dn), (ro, lo, do) = logs
    check(rn == ro == 'closed', f'結果 新 {rn}／舊 {ro}', fails)
    check(len(ln) == len(lo) and all(a == b for a, b in zip(ln, lo)), f'快照 新 {len(ln)} 份／舊 {len(lo)} 份，逐份{"相同" if ln == lo else "不同"}', fails)
    check(dn == do, '收盤後啟動 tw-latest.yml 的時間與參數相同', fails)


def us_regular_regression(hm_new, hm_old, fails):
    print('【4b】回歸：美股正規時段（09:30～收盤 closed）新舊程式的快照相同')
    day = dt.date(2026, 11, 24)
    syms = [f'S{i:02d}' for i in range(30)]
    out = []
    for hm in (hm_new, hm_old):
        fake = FakeUS(day, syms)
        clock = Clock(ts(day, 8, 10)); pub = MemPub(hm, clock)
        hm.PATHSET = None; hm.yahoo_batch = fake.batch(clock); hm.yahoo_intraday = lambda b, ysym=None: {}
        if hasattr(hm, 'yahoo_ext'):
            hm.yahoo_ext = fake.ext(clock)
        S = hm.Session('US', hm.session('US', clock()), syms, pub, clock=clock, sleep=clock.sleep, t0=clock())
        S.run()
        keys = ('state', 'session', 'q', 'pp', 'pn', 'ps', 'have', 'n', 'open', 'close', 'every', 'step', 'src', 'schema', 'market')
        out.append([(t, {k: s.get(k) for k in keys}) for t, s in pub.log if 'ext' not in s])
    new, old = out
    check(len(new) == len(old) and new == old, f'正規時段快照 新 {len(new)} 份／舊 {len(old)} 份，{"相同" if new == old else "不同"}', fails)


def main():
    a = sys.argv[1:]
    hm = load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new')
    if '--old' in a:
        old_path = a[a.index('--old') + 1]
    else:
        old_path = os.path.join(tempfile.mkdtemp(), 'heatmap_live_old.py')
        src = subprocess.run(['git', '-C', ROOT, 'show', 'HEAD:scripts/heatmap_live.py'], capture_output=True, text=True, check=True).stdout
        open(old_path, 'w', encoding='utf-8').write(src)
    fails = []
    test_full_day(hm, fails)
    test_holiday(load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new2'), fails)
    test_early_close(load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new3'), fails)
    old = load(old_path, 'hm_old')
    if hasattr(old, 'yahoo_ext'):
        print('（--old 指的檔案已經是盤前盤後版，略過回歸比對）')
    else:
        tw_regression(load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new4'), old, fails)
        us_regular_regression(load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new5'), load(old_path, 'hm_old2'), fails)
    print('\n全部通過 ✅' if not fails else f'\n{len(fails)} 項不通過 ❌')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
