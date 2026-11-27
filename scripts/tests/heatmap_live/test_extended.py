#!/usr/bin/env python3
"""scripts/heatmap_live.py 的模擬測試（不連網路、不碰 GitHub）：用假時鐘與假行情跑完整個交易日。

  python3 scripts/tests/heatmap_live/test_extended.py

測的事（2026-11-23 加美股盤前／盤後時一起寫的）：
  1. 美股一整天：02:10 啟動（排程台北 15:10＝冬令美東 02:10） → 盤前 04:00～09:30 → 正規 09:30～16:00 → 盤後 16:00～20:00；中間每 320 分鐘交棒（交棒後走勢、收盤報價接得上）。
     盤前漲跌＝盤前最後成交 ÷ 前一交易日收盤 − 1；盤後漲跌＝盤後最後成交 ÷ 當天收盤 − 1；沒成交的不出現；走勢每 15 分鐘一點。
  2. 休市日（感恩節）：盤前開始 25 分鐘沒有當天成交 → 結束、不發布。
  3. 提早收盤日（感恩節隔天）：依行情來源改成 13:00 收盤、盤後到 17:00。
  4. 回歸：台股整個時段、美股正規時段的快照（q、pp、state…）和加盤前盤後之前的程式（commit c2ce227 的版本，或 --old 指定的檔案）逐份相同。
  5. 每日市場分析頁（2026-11-23 加）：美股快照的報價板 mb（盤前／盤後 ETF 成交對前收／當天收盤、正規時段指數現價）、
     新聞 news.json 一小時更新一次（和快照同一個 commit；台股 session 也會更新；來源全掛時 10 分鐘後重試）。
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
import urllib.parse
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ET, TPE = ZoneInfo('America/New_York'), ZoneInfo('Asia/Taipei')


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    if hasattr(m, 'cnbc_ext'):
        m.cnbc_ext_real = m.cnbc_ext
        m.cnbc_ext = lambda b, nonce=None: (0, {})   # 備援來源 CNBC（2026-11-27）：測試預設「讀不到」，要測的案例自己換成假的
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
        self.puts = []   # (時間, {檔名: 內容}) 和快照一起或單獨寫的其他檔案（news.json）

    def sha(self, c):
        return hashlib.sha1(c.encode()).hexdigest()

    def load(self):
        self.keep = {p: self.sha(c) for p, c in self.files.items()}; return 200

    def publish(self, mk, slot, text, message, extra=None):
        f = self.hm.MARKETS[mk]['file']
        self.files[f + '.json'] = text; self.files[f'{f}-{slot}.json'] = text; self.blobs[self.sha(text)] = text
        for p in sorted(p for p in self.files if p.startswith(f + '-'))[:-self.hm.KEEP]:
            del self.files[p]
        self.log.append((self.clock(), json.loads(text)))
        return self.put(extra or {}, message)

    def put(self, files, message):
        for p, c in files.items():
            self.files[p] = c; self.blobs[self.sha(c)] = c
        if files:
            self.puts.append((self.clock(), dict(files)))
        self.keep = {p: self.sha(c) for p, c in self.files.items()}
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
    def __init__(self, day, syms, early=False, holiday=False, ystale=False, ypost=None):
        self.day, self.syms, self.early, self.holiday = day, syms, early, holiday
        self.ystale = ystale   # 2026-11-27 的實況：Yahoo 走勢 API 沒有當天的 K 棒、regularMarketPrice 停在前一個交易日（交易時段仍是當天）
        self.ypost = ypost     # Yahoo 回報的盤後結束時間（2026-11-27 提早收盤日 Yahoo 給 20:00）
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
        if self.holiday or self.ystale or now < self.open:
            return self.P0[s], self.prev_t
        if now < self.close:
            return self.px(s, now), int(now)
        return self.px(s, self.close), self.close

    def batch(self, clock):
        def f(b, nonce=None):
            out = {}
            for s in map(urllib.parse.unquote, b):
                if s not in self.P0:
                    continue   # 報價板的代號：不在假行情裡就當作抓不到
                p, t = self.reg(s, clock())
                out[s] = (p, self.P0[s] * 0.99, t, (self.open, self.close))
            return 200, out
        return f

    def ext(self, clock):
        def f(b, nonce=None):
            now, out = clock(), {}
            for s in map(urllib.parse.unquote, b):
                if s not in self.P0:
                    continue
                p, t = self.reg(s, now)
                bars = [] if (self.holiday or self.ystale) else [(m, self.px(s, m)) for m in range(self.pre, int(now) // 60 * 60 + 1, 60) if self.traded(s, m) and m <= now]
                out[s] = (p, t, (self.pre, self.open, self.close, self.ypost or self.post), bars)
            return 200, out
        return f

    def cnbc(self, clock, down=lambda now: False):
        """假的 CNBC（欄位同 heatmap_live.cnbc_ext 的回傳）：只有最新一筆；down(now)＝這一刻讀不到。"""
        def f(b, nonce=None):
            now, out = clock(), {}
            if down(now):
                return 0, {}
            for s in b:
                if s not in self.P0:
                    continue
                if self.holiday or now < self.open:
                    last, lt, status = self.P0[s], None, 'PRE_MKT'
                elif now < self.close:
                    last, lt, status = self.px(s, now), int(now), 'REG_MKT'
                else:
                    last, lt, status = self.px(s, self.close), self.close, 'POST_MKT'
                kind = xp = xt = None
                if not self.holiday:
                    for k, lo, hi in (('pre', self.pre, self.open), ('post', self.close, self.post)):
                        if lo <= now < hi + 600:
                            r = self.last_trade(s, now, lo, hi)
                            if r:
                                kind, xt, xp = k, r[0], r[1]
                out[s] = (last, lt, self.P0[s] * 0.99, status, kind, xp, xt)
            return 200, out
        return f


def fake_news(clock, fail_until=0):
    """假新聞來源：每次呼叫回一份帶時間的新聞；clock() < fail_until 時模擬全部來源失敗。"""
    calls = []

    def f(now=None):
        now = now or clock()
        calls.append(now)
        if now < fail_until:
            return None
        return {'schema': 'bnasdaq-news/1', 'at': int(now), 'zh': [{'t': f'測試新聞 {int(now)}', 'u': 'https://example.com/a', 's': '測試', 'at': int(now) - 60}], 'en': [], 'src': [{'n': '測試', 'ok': True, 'k': 1}]}
    f.calls = calls
    return f


def run_day(hm, fake, start, syms, budget=None, news=None, cnbc=None):
    clock = Clock(start)
    pub = MemPub(hm, clock)
    hm.PATHSET = None
    hm.yahoo_batch = fake.batch(clock); hm.yahoo_ext = fake.ext(clock); hm.yahoo_intraday = lambda b, ysym=None: {}
    if cnbc:
        hm.cnbc_ext = cnbc(clock)
    hm.fetch_news = news(clock) if news else (lambda now=None: None)
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
    # 2026-11-24：盤前、盤後另留一份（網頁切換 盤前／盤中／盤後 用；過了那個時段還讀得到）
    xp, xq = json.loads(pub.files.get('us_pre.json') or 'null'), json.loads(pub.files.get('us_post.json') or 'null')
    check(xp and xp['ext'] == 'pre' and xp['xstate'] == 'closed' and xp['x'] == pre[-1][1]['x'], 'us_pre.json＝盤前最後一份（xstate＝closed），盤中、盤後都還在', fails)
    check(xq and xq['ext'] == 'post' and xq['x'] == lp['x'], 'us_post.json＝盤後最後一份', fails)
    return snaps


def test_holiday(hm, fails):
    print('【2】休市日（2026-11-26 感恩節）：盤前沒有當天成交 → 結束、不發布')
    day = dt.date(2026, 11, 26)
    syms = [f'S{i:02d}' for i in range(30)]
    fake = FakeUS(day, syms, holiday=True)
    res, runs, pub = run_day(hm, fake, ts(day, 2, 45), syms, cnbc=fake.cnbc)   # CNBC 也有回應、也沒有當天成交
    check(res == 'holiday' and not pub.log, f'應為 holiday 且不發布，實際 {res}、{len(pub.log)} 份', fails)
    check(pub.clock() < fake.pre + 40 * 60, f'盤前開始 25 分鐘左右就結束（實際 {(pub.clock() - fake.pre) / 60:.0f} 分鐘）', fails)


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


def test_cnbc_backup(mk, fails):
    """2026-11-27 的實況：Yahoo 走勢 API 整天沒有當天的 K 棒（交易時段是當天、提早收盤 13:00、盤後到 20:00），CNBC 有。"""
    day = dt.date(2026, 11, 27)
    syms = [f'S{i:02d}' for i in range(30)]
    print('【9a】Yahoo 沒有當天資料、CNBC 正常：盤前照常發布（不可判成休市），正規時段與盤後用 CNBC')
    hm = mk('hm_c1')
    fake = FakeUS(day, syms, early=True, ystale=True, ypost=ts(day, 20, 0))
    res, runs, pub = run_day(hm, fake, ts(day, 2, 10), syms, budget=3 * 3600, cnbc=fake.cnbc)
    pre = [(t, s) for t, s in pub.log if s.get('ext') == 'pre']
    reg = [(t, s) for t, s in pub.log if 'ext' not in s]
    post = [(t, s) for t, s in pub.log if s.get('ext') == 'post']
    check(res == 'done', f'結果 {res}', fails)
    check(pre and pre[0][0] < fake.pre + 120, f'盤前 04:00 起 2 分鐘內就有第一份（實際 {(pre[0][0] - fake.pre) / 60 if pre else None} 分鐘）', fails)
    check(pre and all(s['xsrc'] == 'CNBC' for t, s in pre), '盤前來源標示 CNBC', fails)
    check(pre and pre[-1][1]['close'] == fake.close, '盤前就依 Yahoo 的交易時段把收盤改成 13:00（盤後到 20:00 也要採用）', fails)
    bad = 0
    for t, s in pre[:: max(1, len(pre) // 40)]:
        for sym, (p, c, age) in s['x'].items():
            r = fake.last_trade(sym, t, fake.pre, fake.open)
            if not r or abs(p - r[1]) > 1e-3 or abs(c - round((r[1] / fake.P0[sym] - 1) * 100, 2)) > 0.011 or abs((t - age) - r[0]) > 1:
                bad += 1
    check(bad == 0, f'盤前價、漲跌（對前一交易日收盤）、成交時間逐檔逆算，{bad} 筆不符', fails)
    liq = sum(1 for s_ in syms if fake.liq[s_] > 0)
    check(pre and pre[-1][1]['xn'] == liq, f'盤前最後一份 {pre[-1][1]["xn"] if pre else None} 檔有成交（應 {liq}）', fails)
    lastp = pre[-1][1]['xpp'] if pre else {}
    full = [sym for sym in syms if fake.liq[sym] == 2]
    check(full and all(len([v for v in lastp.get(sym, []) if v is not None]) >= 20 for sym in full), '整段都有成交的代號：盤前走勢 22 格幾乎都有點（跨交棒接回）', fails)
    check(runs >= 3, f'有交棒（{runs} 棒）', fails)
    check(reg and all(s['src'] == 'CNBC' for t, s in reg if s['state'] == 'open'), '正規時段來源標示 CNBC', fails)
    opens = [(t, s) for t, s in reg if s['state'] == 'open']
    check(opens and opens[0][0] < fake.open + 180 and opens[0][1]['have'] == len(syms), f'開盤 3 分鐘內就有 {len(syms)} 檔', fails)
    bad = 0
    for t, s in opens[:: max(1, len(opens) // 30)]:
        for sym, (p, c, age) in s['q'].items():
            if abs(c - round((p / (fake.P0[sym] * 0.99) - 1) * 100, 2)) > 0.011 or age > 200:
                bad += 1
    check(bad == 0, f'正規時段漲跌（對前收）逐檔逆算，{bad} 筆不符', fails)
    closed = [t for t, s in reg if s['state'] == 'closed']
    check(closed and abs(closed[0] - (fake.close + 600)) < 61, '13:10 發布正規時段 closed', fails)
    check(post and all(s['xsrc'] == 'CNBC' for t, s in post) and post[-1][1]['xn'] > 0, '盤後用 CNBC', fails)
    bad = 0
    for t, s in post[:: max(1, len(post) // 30)]:
        for sym, (p, c, age) in s['x'].items():
            if abs(c - round((p / fake.px(sym, fake.close) - 1) * 100, 2)) > 0.011:
                bad += 1
    check(bad == 0, f'盤後漲跌（對當天收盤）逐檔逆算，{bad} 筆不符', fails)

    print('【9b】Yahoo 沒有當天資料、CNBC 盤前也讀不到（開盤後恢復）：Yahoo 的交易時段是今天 → 不判休市，等到開盤')
    hm = mk('hm_c2')
    fake = FakeUS(day, syms, early=True, ystale=True, ypost=ts(day, 20, 0))
    res, runs, pub = run_day(hm, fake, ts(day, 3, 30), syms, cnbc=lambda clock: fake.cnbc(clock, down=lambda now: now < fake.open))
    reg = [(t, s) for t, s in pub.log if 'ext' not in s and s['state'] == 'open']
    check(res == 'done' and reg and reg[0][0] < fake.open + 180, f'沒有判成休市，開盤後用 CNBC 發布（結果 {res}、正規時段 {len(reg)} 份）', fails)
    check(not [1 for t, s in pub.log if s.get('ext') == 'pre'], '盤前沒有資料就不發布', fails)

    print('【9c】兩個來源都正常：同一檔用成交時間較新的，一樣新用 Yahoo → 和只有 Yahoo 時逐份相同')
    hm_a, hm_b = mk('hm_c3'), mk('hm_c4')
    fa, fb = FakeUS(day, syms), FakeUS(day, syms)
    ra = run_day(hm_a, fa, ts(day, 3, 30), syms)
    rb = run_day(hm_b, fb, ts(day, 3, 30), syms, cnbc=fb.cnbc)
    same = len(ra[2].log) == len(rb[2].log) and all(a[1] == b[1] for a, b in zip(ra[2].log, rb[2].log))
    check(ra[0] == rb[0] == 'done' and same, f'快照逐份相同（{len(ra[2].log)} 對 {len(rb[2].log)} 份）', fails)

    print('【9d】CNBC 欄位解析（2026-11-27 06:54 美東從 GitHub runner 抓到的實際值）')
    hm = mk('hm_c5')
    check(hm.cnbc_time('2026-11-27T06:53:26.627-0500') == ts(day, 6, 53) + 26, 'last_time 轉成 UNIX 秒', fails)
    check(hm.cnbc_time('2026-11-25') is None and hm.cnbc_time(None) is None, '只有日期＝不是當天的成交', fails)
    check(hm.cnbc_num('7,598,856') == 7598856 and hm.cnbc_num('+1.62') == 1.62 and hm.cnbc_num('+0.46%') == 0.46 and hm.cnbc_num('UNCH') is None, '數字欄位', fails)
    body = json.dumps({'FormattedQuoteResult': {'FormattedQuote': [
        {'symbol': 'AAPL', 'code': 0, 'curmktstatus': 'PRE_MKT', 'last': '355.58', 'last_time': '2026-11-25', 'previous_day_closing': '355.58',
         'ExtendedMktQuote': {'type': 'PRE_MKT', 'last': '357.20', 'change': '+1.62', 'change_pct': '+0.46%', 'last_time': '2026-11-27T06:53:26.627-0500', 'volume': '215,447'}},
        {'symbol': 'BRK.B', 'code': 0, 'curmktstatus': 'PRE_MKT', 'last': '579.32', 'last_time': '2026-11-25', 'previous_day_closing': '579.32',
         'ExtendedMktQuote': {'type': 'PRE_MKT', 'last': '580.00', 'last_time': '2026-11-27T06:35:51.124-0500'}},
        {'symbol': 'XYZ', 'code': 0, 'curmktstatus': 'REG_MKT', 'last': '10.00', 'last_time': '2026-11-25', 'previous_day_closing': '10.00',
         'ExtendedMktQuote': {'type': 'POST_MKT_PREV', 'last': '10.10', 'last_time': '2026-11-25T19:55:00.000-0500'}}]}})
    seen = {}
    def fake_http(url, **kw):
        seen['url'] = url
        return 200, body
    hm.http = fake_http
    st, out = hm.__dict__['cnbc_ext_real'](['AAPL', 'BRK-B', 'XYZ'], 5)
    check(st == 200 and 'AAPL|BRK.B|XYZ' in seen['url'], f'代號用 | 串、BRK-B 改 BRK.B（{seen.get("url", "")[-40:]}）', fails)
    check(out.get('AAPL') == (355.58, None, 355.58, 'PRE_MKT', 'pre', 357.2, ts(day, 6, 53) + 26), f'AAPL {out.get("AAPL")}', fails)
    check(out.get('BRK-B', (None,) * 7)[4:] == ('pre', 580.0, ts(day, 6, 35) + 51), f'BRK-B 對回本站代號 {out.get("BRK-B")}', fails)
    check(out.get('XYZ', (0,) * 7)[4:] == (None, None, None), 'POST_MKT_PREV（今天還沒有盤前成交）不算', fails)


def test_board_news(hm, fails):
    print('【5】每日市場分析頁：報價板 mb、每小時新聞（含交棒、來源失敗重試）')
    day = dt.date(2026, 11, 23)
    stocks = [f'S{i:02d}' for i in range(20)]
    board = ['QQQ', 'SPY', '^NDX', 'TSM']   # 假行情裡也有的報價板代號（第 20～23 個：QQQ 流動性 2、SPY 流動性 0、^NDX 流動性 2、TSM 流動性 1）
    fake = FakeUS(day, stocks + board)
    fake.liq['^NDX'] = 0   # 指數沒有盤前盤後成交
    res, runs, pub = run_day(hm, fake, ts(day, 2, 10), stocks, news=lambda clock: fake_news(clock, fail_until=ts(day, 4, 25)))
    snaps = pub.log
    pre = [(t, s) for t, s in snaps if s.get('ext') == 'pre']
    reg = [(t, s) for t, s in snaps if 'ext' not in s and s['state'] == 'open']
    post = [(t, s) for t, s in snaps if s.get('ext') == 'post']
    check(all('mb' in s for _, s in snaps), '美股每一份快照都有報價板 mb', fails)
    t1, s1 = next((t, s) for t, s in pre if t >= ts(day, 8, 0))
    qx, qq = s1['mb']['x'].get('QQQ'), s1['mb']['q'].get('^NDX')
    lt = fake.last_trade('QQQ', t1, fake.pre, fake.open)
    check(qx is not None and abs(qx[0] - lt[1]) < 1e-9 and abs(qx[1] - fake.P0['QQQ']) < 1e-9, f'08:00 盤前：QQQ 成交 {qx and qx[0]}（應 {lt[1]}）、基準＝前收 {fake.P0["QQQ"]}', fails)
    check(qq is not None and abs(qq[0] - fake.P0['^NDX']) < 1e-9 and qq[2] == fake.prev_t, '盤前：^NDX 還是前一交易日收盤（時間是前一天 16:00）', fails)
    check('SPY' not in s1['mb']['x'] and '^NDX' not in s1['mb']['x'], '沒有盤前成交的（SPY 流動性 0）與指數不出現在 mb.x', fails)
    t2, s2 = next((t, s) for t, s in reg if t >= ts(day, 11, 0))
    qq = s2['mb']['q']['^NDX']
    check(abs(qq[0] - fake.px('^NDX', t2)) < 1e-6 and not s2['mb']['x'], f'11:00 正規時段：^NDX＝當下價、mb.x 是空的', fails)
    t3, s3 = next((t, s) for t, s in post if t >= ts(day, 18, 0))
    qx, lt = s3['mb']['x'].get('QQQ'), fake.last_trade('QQQ', t3, fake.close, fake.post)
    check(qx is not None and abs(qx[0] - lt[1]) < 1e-9 and abs(qx[1] - fake.px('QQQ', fake.close)) < 1e-9, '18:00 盤後：QQQ 成交對當天收盤', fails)
    check(abs(s3['mb']['q']['^NDX'][0] - fake.px('^NDX', fake.close)) < 1e-6, '盤後：^NDX＝當天收盤', fails)
    nt = [t for t, f in pub.puts if hm.NEWS_FILE in f]
    gaps = [b - a for a, b in zip(nt, nt[1:])]
    print('  新聞發布', len(nt), '次：', [dt.datetime.fromtimestamp(t, ET).strftime('%H:%M') for t in nt])
    check(nt and abs(nt[0] - ts(day, 4, 30)) < 61, f'來源失敗時 10 分鐘重試：04:00、04:10、04:20 失敗，04:30 才發布第一份（實際 {dt.datetime.fromtimestamp(nt[0], ET).strftime("%H:%M") if nt else "無"}）', fails)
    check(all(3600 <= g <= 3600 + 61 for g in gaps), f'之後每小時一次（間隔 {sorted(set(int(g) for g in gaps))} 秒，含交棒）', fails)
    check(15 <= len(nt) <= 17, f'04:30～20:06 約 16 次，實際 {len(nt)}', fails)
    n0 = json.loads(pub.files[hm.NEWS_FILE])
    check(n0.get('schema') == 'bnasdaq-news/1' and n0['at'] == int(nt[-1]), '分支上的 news.json 是最後一次抓的', fails)
    # 台股 session 也更新新聞
    hm2 = load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_tw_news')
    dtw = dt.date(2026, 11, 24)
    o = ts(dtw, 9, 0, TPE)
    clock = Clock(ts(dtw, 8, 10, TPE)); pub2 = MemPub(hm2, clock)
    hm2.PATHSET = None; hm2.yahoo_intraday = lambda b, ysym=None: {}; hm2.fetch_news = fake_news(clock); hm2.BOARDS = {'US': hm2.BOARD}
    hm2.fetch_tw = lambda codes: ({c: (100.0 + (clock() - o) / 1e4, 100.0, int(min(clock(), ts(dtw, 13, 30, TPE)))) for c in codes} if clock() >= o else {}, 'Yahoo奇摩股市')
    hm2.Session('TW', hm2.session('TW', clock()), ['2330', '2317'], pub2, clock=clock, sleep=clock.sleep, t0=clock()).run()
    nt2 = [dt.datetime.fromtimestamp(t, TPE).strftime('%H:%M') for t, f in pub2.puts if hm2.NEWS_FILE in f]
    check(nt2 == ['09:00', '10:00', '11:00', '12:00', '13:00'], f'台股 session 每小時更新新聞，實際 {nt2}', fails)
    check(all('mb' not in s for _, s in pub2.log), '台股快照沒有報價板', fails)


def test_extras(hm, fails):
    print('【6】全站即時報價：網站價格表的代號一起抓（不記走勢）、台股報價板（匯率、加權指數）')
    u = hm.universe('US')
    check(all(s in u for s in ('QLD', 'SHV', 'ANT', 'BOXX', 'AAPL')) and hm.PATHSET is not None and 'AAPL' in hm.PATHSET and 'QLD' not in hm.PATHSET,
          f'美股 {len(u)} 檔含 QLD、SHV、ANT、BOXX；當日走勢只記熱力圖成分股（{len(hm.PATHSET)} 檔）', fails)
    t = hm.universe('TW')
    tl = json.load(open(os.path.join(ROOT, 'data', 'tw', 'latest.json'), encoding='utf-8'))['items']
    two = [c for c in t if (tl.get(c) or [0, 0, 0, ''])[3] == 'TWO']
    check(all(s in t for s in ('0050', '00631L', '00670L', '2330')) and two and all(hm.SUFFIX.get(c) == '.TWO' for c in two) and '0050' not in hm.PATHSET,
          f'台股 {len(t)} 檔含 0050、00631L、00670L；上櫃 {len(two)} 檔都用 .TWO；0050 不記走勢', fails)
    # 台股 session：ETF 有報價、快照有 mb（美元兌台幣、加權指數）
    day = dt.date(2026, 11, 24); o = ts(day, 9, 0, TPE)
    clock = Clock(ts(day, 8, 50, TPE)); pub = MemPub(hm, clock)
    hm.yahoo_intraday = lambda b, ysym=None: {}; hm.fetch_news = lambda now=None: None
    hm.fetch_tw = lambda codes: ({c: (100.0, 99.0, int(min(clock(), ts(day, 13, 30, TPE)))) for c in codes} if clock() >= o else {}, 'Yahoo奇摩股市')
    asked = []
    def fake_us(syms, nonce=None, f=None):
        asked.append(list(syms))
        return {'TWD=X': (32.5, 32.6, int(clock()) - 30)}, {'ok': 1, '429': 0, 'fail': 0}
    hm.fetch_us = fake_us
    real_index = hm.tw_index; hm.tw_index = lambda: {'^TWII': (23000.0, 22800.0, int(clock()) - 5)}
    hm.Session('TW', hm.session('TW', clock()), ['2330', '0050', '6488'], pub, clock=clock, sleep=clock.sleep, t0=clock()).run()
    s1 = [s for t_, s in pub.log if s['state'] == 'open'][5]
    check(s1['q'].get('0050', [0])[0] == 100.0 and s1.get('mb', {}).get('q', {}).get('TWD=X', [0])[0] == 32.5 and s1['mb']['q'].get('^TWII', [0, 0])[:2] == [23000.0, 22800.0],
          '台股盤中快照：0050 有報價、mb.q 有 TWD=X 與 ^TWII（加權指數來自 tw_index）', fails)
    check(asked and all(a == ['TWD%3DX'] for a in asked), f'台股報價板向 Yahoo Finance 只問匯率（{len(asked)} 輪）；加權指數不再向它問', fails)
    # 加權指數的來源（2026-11-24）：Yahoo奇摩股市 → 鉅亨網；用當天 09:34 實際抓到的回應格式
    hm.tw_index = real_index
    ytw_body = json.dumps([{'symbol': '^TWII', 'price': {'raw': '40143.85'}, 'change': {'raw': '3331.96'}, 'regularMarketPreviousClose': {'raw': '36811.89'}, 'regularMarketTime': '2026-11-24T01:34:50Z'},
                           {'symbol': '^TWOII', 'price': {'raw': '293.21'}, 'change': {'raw': '22.31'}, 'regularMarketPreviousClose': {'raw': '270.9'}, 'regularMarketTime': '2026-11-24T01:34:50Z'}])
    cny_body = json.dumps({'data': [{'200010': 'TSE01', '6': 40145.33, '11': 3333.44, '21': 36811.89, '200007': 1795484085}]})
    calls = []
    def fake_http(mode):
        def f(url, **kw):
            calls.append(url)
            if 'tw.stock.yahoo.com' in url:
                if mode == 'yahoo': return 200, ytw_body
                raise RuntimeError('HTTP 503')
            if 'ws.api.cnyes.com' in url:
                if mode != 'none': return 200, cny_body
                raise RuntimeError('timeout')
            raise RuntimeError('unexpected ' + url)
        return f
    old_http = hm.http
    try:
        hm.http = fake_http('yahoo'); a = hm.tw_index()
        check(list(a) == ['^TWII'] and abs(a['^TWII'][0] - 40143.85) < 1e-9 and abs(a['^TWII'][1] - 36811.89) < 1e-6 and a['^TWII'][2] == 1795484090 and len(calls) == 1 and '%5ETWII' in calls[0],
              f'加權指數：Yahoo奇摩股市 40143.85、昨收 36811.89（＝現價−漲跌）、報價時間 09:34:50；只讀一次', fails)
        calls.clear(); hm.http = fake_http('cnyes'); b = hm.tw_index()
        check(abs(b['^TWII'][0] - 40145.33) < 1e-9 and abs(b['^TWII'][1] - 36811.89) < 1e-6 and b['^TWII'][2] == 1795484085 and len(calls) == 2 and 'TWS:TSE01:INDEX' in calls[1],
              '加權指數：Yahoo奇摩股市讀不到 → 鉅亨網 40145.33、昨收 36811.89', fails)
        hm.http = fake_http('none'); check(hm.tw_index() == {}, '加權指數：兩個來源都讀不到 → 回空的（保留上一輪的值）', fails)
    finally:
        hm.http = old_http
    # 美股盤前：多抓的代號有盤前成交（x），但沒有盤前走勢（xpp）
    hm2 = load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_ex2')
    syms = [f'S{i:02d}' for i in range(12)] + ['QLD']
    fake = FakeUS(day, syms); fake.liq['QLD'] = 2
    clock2 = Clock(ts(day, 4, 0)); pub2 = MemPub(hm2, clock2)
    hm2.PATHSET = set(syms[:-1]); hm2.yahoo_batch = fake.batch(clock2); hm2.yahoo_ext = fake.ext(clock2); hm2.yahoo_intraday = lambda b, ysym=None: {}; hm2.fetch_news = lambda now=None: None
    S = hm2.Session('US', hm2.session('US', clock2()), syms, pub2, clock=clock2, sleep=clock2.sleep, t0=clock2())
    S.xkind = 'pre'; clock2.t = ts(day, 8, 0); S.poll_ext('pre')
    snap = S.snapshot('pre', int(clock2()) // S.step, clock2())
    check('QLD' in snap['x'] and 'QLD' not in snap['xpp'] and any(k in snap['xpp'] for k in syms[:-1]), '美股盤前：QLD 有成交、沒有走勢；熱力圖成分股照舊有走勢', fails)


def test_news_co(hm, fails):
    print('【7】個股頁即時新聞：那斯達克 100、台灣 50 成分股另寫 news-co.json；標題比對')
    wl = hm.watch_list(skip=[m[0] for m in hm.mega_list()])
    check(len(wl) > 100 and any(m == 'TW' for _, _, m in wl) and any(m == 'US' for _, _, m in wl), f'成分股 {len(wl)} 家（兆元企業另外抓）', fails)
    n = {'schema': 'bnasdaq-news/1', 'at': 100, 'zh': [], 'en': [], 'co': {'NVDA': [{'t': 'a', 'u': 'https://x', 's': 's', 'at': 90}]}, 'src': [], '_cx': {'AMD': [{'t': 'b', 'u': 'https://y', 's': 's', 'at': 95}]}}
    f = hm.news_files(n)
    a, b = json.loads(f[hm.NEWS_FILE]), json.loads(f[hm.NEWS_CO_FILE])
    check('_cx' not in a and set(a['co']) == {'NVDA'} and b['schema'] == 'bnasdaq-news-co/1' and set(b['co']) == {'NVDA', 'AMD'} and b['at'] == 100, 'news.json 不含成分股那一份；news-co.json＝兆元企業＋成分股', fails)
    f2 = hm.news_files({k: v for k, v in n.items() if k != '_cx'})
    check(set(f2) == {hm.NEWS_FILE}, '沒有成分股資料（舊格式）時只寫 news.json', fails)
    # 標題比對：模擬 Google 新聞回應
    rss = lambda titles: ('<rss><channel>' + ''.join(f'<item><title>{x} - 媒體</title><link>https://n/{i}</link><pubDate>Mon, 23 Nov 2026 12:00:00 GMT</pubDate><source url="https://m">媒體</source></item>' for i, x in enumerate(titles)) + '</channel></rss>').encode()
    pages = {'KLAC': ['KLA beats estimates', 'Oklahoma weather update', 'KLA-Tencor history'], 'AMD': ['AMD unveils MI500', 'Advanced Micro Devices raises guidance', 'Lamda news'], '3665': ['貿聯-KY 營收創高', '貿聯 擴產', '其他公司新聞', '貿聯合作社年度活動', '3665 貿聯- 明天會漲嗎- 股市爆料同學會']}
    def fake_http(url, **kw):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)['q'][0]
        key = 'KLAC' if 'KLA' in qs else 'AMD' if 'AMD' in qs else '3665' if '貿聯' in qs else None
        return 200, rss(pages.get(key, []))
    old = hm.http; hm.http = fake_http
    hm.watch_list = lambda skip=(): [('KLAC', 'KLA Corporation', 'US'), ('AMD', 'Advanced Micro Devices Inc.', 'US'), ('3665', '貿聯-KY', 'TW')]
    hm.mega_list = lambda: []
    try:
        co, more = hm.fetch_co_news(dt.datetime(2026, 11, 23, 13, tzinfo=dt.timezone.utc).timestamp(), extra=True)
    finally:
        hm.http = old
    got = {k: [x['t'] for x in v] for k, v in more.items()}
    check(got.get('KLAC') == ['KLA beats estimates', 'KLA-Tencor history'] and got.get('AMD') == ['AMD unveils MI500', 'Advanced Micro Devices raises guidance'] and got.get('3665') == ['貿聯-KY 營收創高', '貿聯 擴產'],
          f'標題比對：{got}', fails)


def test_post_base(hm, fails):
    print('【8】盤後基準＝當天收盤（正規時段最後報價）；走勢 API 的 regularMarketPrice 還停在收盤前也不受影響')
    day = dt.date(2026, 11, 23); syms = [f'S{i:02d}' for i in range(10)]
    fake = FakeUS(day, syms); fake.liq = {s: 2 for s in syms}
    stale = set(syms[:5])
    clock = Clock(ts(day, 16, 20)); pub = MemPub(hm, clock)
    hm.PATHSET = None; hm.yahoo_batch = fake.batch(clock); hm.yahoo_intraday = lambda b, ysym=None: {}; hm.fetch_news = lambda now=None: None
    ext = fake.ext(clock)
    def ext2(b, nonce=None):   # 一半的代號：regularMarketPrice 還是收盤前一分鐘的成交（2026-11-23 實測 HPE 這樣）
        st, out = ext(b, nonce)
        for s in list(out):
            if s in stale:
                p, t, per, bars = out[s]; out[s] = (fake.px(s, fake.close - 60), t, per, bars)
        return st, out
    hm.yahoo_ext = ext2
    S = hm.Session('US', hm.session('US', clock()), syms, pub, clock=clock, sleep=clock.sleep, t0=clock())
    S.poll(); S.xkind = 'post'; S.poll_ext('post')
    bad = [s for s in syms if not (s in S.x and abs(S.x[s][1] - fake.px(s, fake.close)) < 1e-9 and S.q[s][0] == fake.px(s, fake.close))]
    check(len(S.x) == len(syms) and not bad, f'盤後 {len(S.x)} 檔的基準都是當天收盤（含 {len(stale)} 檔走勢 API 還沒更新的）；不符 {bad}', fails)
    snap = S.snapshot('post', int(clock()) // S.step, clock())
    off = [s for s in syms if abs((snap['x'][s][0] / fake.px(s, fake.close) - 1) * 100 - snap['x'][s][1]) > 0.006]
    check(not off, f'快照的盤後漲跌＝盤後價 ÷ 當天收盤 − 1（逐檔逆算，容許 0.006 個百分點的四捨五入）；不符 {off}', fails)


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
        hm.PATHSET = None; hm.fetch_tw = fake_tw(clock); hm.yahoo_intraday = lambda b, ysym=None: {}; hm.fetch_news = lambda now=None: None
        if hasattr(hm, 'BOARDS'):
            hm.BOARDS = {'US': hm.BOARD}   # 舊版台股沒有報價板（2026-11-24 起台股多抓匯率與加權指數，另由【6】測）
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
        hm.PATHSET = None; hm.yahoo_batch = fake.batch(clock); hm.yahoo_intraday = lambda b, ysym=None: {}; hm.fetch_news = lambda now=None: None
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
        src = subprocess.run(['git', '-C', ROOT, 'show', 'c2ce227:scripts/heatmap_live.py'], capture_output=True, text=True, check=True).stdout   # 加盤前盤後之前的最後一版（淺 clone 讀不到時用 --old 指定）
        open(old_path, 'w', encoding='utf-8').write(src)
    fails = []
    test_full_day(hm, fails)
    test_holiday(load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new2'), fails)
    test_early_close(load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new3'), fails)
    test_board_news(load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new6'), fails)
    test_extras(load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new7'), fails)
    test_news_co(load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new8'), fails)
    test_post_base(load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), 'hm_new9'), fails)
    test_cnbc_backup(lambda name: load(os.path.join(ROOT, 'scripts', 'heatmap_live.py'), name), fails)
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
