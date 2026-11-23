/* BNASDAQ｜全站即時報價（2026-11-24 站主：「所有的股價計算在網站上都是用最新的即時價格跟即時消息」）
   來源：scripts/heatmap_live.py 在 heatmap-live 分支發布的快照——台股開盤期間每 30 秒、美股每 60 秒（含盤前 04:00～09:30、盤後 16:00～20:00 美東時間）。
     tw.json／us.json＝最新一份；tw-<時間格>.json／us-<時間格>.json＝每一格一個新檔名（時間格＝UNIX 秒÷間隔；raw.githubusercontent.com 對同一網址快取 5 分鐘，換檔名才讀得到最新）
   快照欄位（scripts/heatmap_live.py 檔頭）：
     q[代號]＝[現價, 漲跌%, 報價距快照幾秒]：正規時段；收盤後是收盤價。漲跌是對前一交易日收盤
     x[代號]＝[最新成交, 漲跌%, 幾秒前]：美股盤前（ext＝'pre'，對前一交易日收盤）／盤後（ext＝'post'，對當天收盤）
     mb.q[代號]＝[價格, 前收, 報價時間]：報價板（美股時段：指數、匯率、原油…；台股時段：美元兌台幣 TWD=X、加權指數 ^TWII）
   涵蓋：熱力圖全部成分股＋網站價格表 data/tw/latest.json 的全部代號（台股 ETF、QLD、SHV…）＋ANT、BOXX。沒涵蓋的代號 get() 回 null，頁面照舊用收盤價。
   規則（和每日市場分析的熱力圖相同）：
     只用「這個交易時段開盤後」的成交（報價時間早於開盤＝前一天的價格，不算即時）
     美股盤前／盤後：時段進行中、或結束 15 分鐘內才用盤前／盤後成交；快照停更超過 90 分鐘也不用；之後回到正規時段的收盤價
   用法：
     BN.liveq.want(['TW','US'])  開始讀這些市場（重複呼叫沒關係）
     BN.liveq.get(代號)          → {code, mk, p 現價, ref 前一交易日收盤, chg 漲跌（小數）, t 成交時間（秒）, at 快照時間, ses 交易日（交易所當地）, ph 'pre'|'open'|'post'|'close', src, close 當天收盤（盤後才有）, xchg 盤後對收盤漲跌}，沒有就 null
     BN.liveq.fx()               → {rate 美元兌台幣, prev 前收, t, date 台北日期, src}，沒有就 null
     BN.liveq.codes()            → 快照裡全部代號
     BN.liveq.tag(q)             → 給畫面用的短說明，例「盤中 10:15」「盤前 17:42」「盤後 05:30」「收盤」（台北時間）
     BN.liveq.on(fn)             → 有新快照時呼叫 fn({mk})
   每日市場分析頁（daily.html）自己就在讀快照（window.BN.live、bn-live 事件；BN.liveOwn＝true）：這裡不重複讀，直接跟著它，
   需要的市場透過 BN.liveWant／BN.liveKick 請它一起讀。 */
(function () {
  'use strict';
  const BN = window.BN = window.BN || {};
  if (BN.liveq) return;
  const RAW = 'https://raw.githubusercontent.com/WUYANLIN8866/BNASDAQ/heatmap-live/';
  // open／close／pre／post＝交易所當地時間的第幾分鐘；step＝發布間隔秒數（以快照裡的 step 為準）；margin＝時間格開始後幾秒才讀（太早讀到 404 會被快取 60 秒）
  const MKT = { TW: { file: 'tw', tz: 'Asia/Taipei', open: 540, close: 810, step: 30, margin: 8 },
    US: { file: 'us', tz: 'America/New_York', open: 570, close: 960, pre: 240, post: 1200, step: 60, margin: 15 } };
  let LIVE = {}, skew = 0, timer = 0, follow = null, inited = false;
  const WANT = new Set(), MISS = { TW: 0, US: 0 }, FIXED = { TW: 0, US: 0 }, LAST = { TW: 0, US: 0 }, BUSY = {}, AGAIN = {}, SUBS = [];
  const now = () => Date.now() + skew;   // skew＝伺服器時間−本機時間
  const isTW = c => /^[0-9][0-9A-Z]{3,5}$/.test(c);
  const p2 = v => String(v).padStart(2, '0');
  const hhmm = sec => { const z = new Date(sec * 1000 + 8 * 36e5); return p2(z.getUTCHours()) + ':' + p2(z.getUTCMinutes()); };   // 台北時間
  const tpeDate = sec => new Date(sec * 1000 + 8 * 36e5).toISOString().slice(0, 10);
  const stepOf = mk => { const L = LIVE[mk]; return (L && L.step >= 15 && L.step <= 600) ? L.step : MKT[mk].step; };
  function phase(mk) {   // off 週末、pre 開盤前、xpre 美股盤前、open 盤中（到收盤後 12 分鐘）、xpost 美股盤後（到 20:00 後 12 分鐘）、post 收盤後
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: MKT[mk].tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now())), g = k => (p.find(x => x.type === k) || {}).value;
      const wd = g('weekday'), m = (+g('hour') % 24) * 60 + (+g('minute')), M = MKT[mk];
      if (wd === 'Sat' || wd === 'Sun') return 'off';
      if (m < M.open) return M.pre != null && m >= M.pre ? 'xpre' : 'pre';
      if (m < M.close + 12) return 'open';
      return M.post != null && m < M.post + 12 ? 'xpost' : 'post';
    } catch (e) { return 'open'; }
  }
  const hot = ph => ph === 'open' || ph === 'xpre' || ph === 'xpost';
  const liveOn = L => !!L && (L.state !== 'closed' || L.xstate === 'open');
  const okSnap = (L, mk) => !!L && L.schema === 'bnasdaq-heatmap-live/1' && L.market === mk && typeof L.at === 'number' && isFinite(L.at) && /^\d{4}-\d{2}-\d{2}$/.test(L.session || '') && !!L.q && typeof L.q === 'object'
    && ['pre', 'open', 'settling', 'closed'].includes(L.state) && (!L.ext || (['pre', 'post'].includes(L.ext) && !!L.x && typeof L.x === 'object' && isFinite(L.xopen) && isFinite(L.xclose)));
  const getJ = async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); };
  const emit = mk => SUBS.slice().forEach(fn => { try { fn({ mk }); } catch (e) { /* 單一頁面元件出錯不影響其他 */ } });

  // ---------- 讀快照（每日市場分析頁以外）----------
  async function tick(mk) {
    if (document.hidden) return;
    if (BUSY[mk]) { AGAIN[mk] = true; return; }
    BUSY[mk] = true;
    try {
      const M = MKT[mk], had = LIVE[mk], ph = phase(mk), step = stepOf(mk), t = now() / 1000, slow = Math.max(3, Math.ceil(180 / step));   // slow：連續約 3 分鐘找不到時間格檔，改成慢慢讀
      const done = had && had.state === 'closed' && (M.post == null || (had.ext === 'post' && had.xstate === 'closed')) && t - had.at < 6 * 3600;   // 今天已收盤（美股：盤後也結束）
      let got = null;
      if (hot(ph) && !done && MISS[mk] < slow && !(had && had.every > step && t - had.at < 600)) {   // 交易時段：讀最新的時間格檔，沒有就往前找兩格
        const s0 = Math.floor((t - M.margin) / step);
        if (had && LAST[mk] === s0) return;   // 這一格已經讀過
        for (let k = 0; k < 3 && !got; k++) { try { const j = await getJ(RAW + M.file + '-' + (s0 - k) + '.json'); if (okSnap(j, mk)) { got = j; LAST[mk] = s0 - k; } } catch (e) { /* 下一格 */ } }
        MISS[mk] = got ? 0 : MISS[mk] + 1;
      }
      if (!got && !done && Date.now() - FIXED[mk] > (!hot(ph) ? 600 : MISS[mk] >= slow ? 300 : 55) * 1000) {   // 最新一份：非交易時段 10 分鐘一次
        FIXED[mk] = Date.now();
        try { const j = await getJ(RAW + M.file + '.json'); if (okSnap(j, mk)) { got = j; if (liveOn(j) && now() / 1000 - j.at < 360) MISS[mk] = 0; } } catch (e) { /* 照舊 */ }
      }
      if (got && liveOn(got) && got.at * 1000 > now()) skew += got.at * 1000 - now();   // 本機時鐘比資料慢：往前校正
      if (got && (!had || got.at > had.at)) { LIVE[mk] = got; emit(mk); }
    } finally { BUSY[mk] = false; if (AGAIN[mk]) { AGAIN[mk] = false; tick(mk); } }
  }
  async function all() { for (const mk of WANT) { try { await tick(mk); } catch (e) { /* 照舊 */ } } }
  function loop() {   // 下一次讀的時間：交易時段用它的間隔，其他時候每分鐘看一次；兩個市場取較早的
    clearTimeout(timer); if (!WANT.size) return;
    const t = now() / 1000; let nb = Infinity;
    WANT.forEach(mk => { const M = MKT[mk], st = hot(phase(mk)) ? stepOf(mk) : 60; nb = Math.min(nb, (Math.floor((t - M.margin) / st) + 1) * st + M.margin); });
    timer = setTimeout(() => { all().then(loop); }, Math.max(3, nb - t) * 1000 + Math.random() * 2000);
  }
  function init() {
    if (inited) return; inited = true;
    if (BN.liveOwn && BN.live) {   // 每日市場分析頁：跟著它讀
      follow = true; LIVE = BN.live;
      window.addEventListener('bn-live', e => emit((e.detail && e.detail.mk) || 'US'));
      const w = BN.liveWant = BN.liveWant || new Set(); WANT.forEach(mk => w.add(mk)); if (BN.liveKick) BN.liveKick();
      return;
    }
    follow = false;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) all().then(loop); });
    all().then(loop);
  }
  function want(mks) {
    (Array.isArray(mks) ? mks : [mks]).forEach(mk => { if (MKT[mk]) WANT.add(mk); });
    if (!inited) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else setTimeout(init, 0); return; }
    if (follow) { const w = BN.liveWant = BN.liveWant || new Set(); let add = false; WANT.forEach(mk => { if (!w.has(mk)) { w.add(mk); add = true; } }); if (add && BN.liveKick) BN.liveKick(); }
    else all().then(loop);
  }

  // ---------- 取值 ----------
  function fromQ(L, code, mk) {   // 正規時段（或收盤後）的價格
    const v = L.q && L.q[code], p = Array.isArray(v) ? +v[0] : NaN, c = Array.isArray(v) ? +v[1] : NaN, age = Array.isArray(v) ? +v[2] : NaN;
    if (!(p > 0) || !isFinite(c) || Math.abs(c) >= 100) return null;
    const t = L.at - (isFinite(age) && age >= 0 ? age : 0);
    if (isFinite(L.open) && t < L.open - 600) return null;   // 開盤前的報價＝前一天的價格
    const closed = L.state === 'closed';
    return { code, mk, p, ref: p / (1 + c / 100), chg: c / 100, t, at: L.at, ses: L.session, ph: closed ? 'close' : 'open', settling: L.state === 'settling',
      src: (L.src || (mk === 'TW' ? 'Yahoo奇摩股市' : 'Yahoo Finance')) + (closed ? ' 收盤' : ' 即時'), stale: !closed && now() / 1000 - L.at > 600 };
  }
  function get(code, mkHint) {
    code = String(code || '').trim().toUpperCase(); if (!code) return null;
    const mk = mkHint === 'TW' || mkHint === 'TWO' ? 'TW' : mkHint === 'US' ? 'US' : isTW(code) ? 'TW' : 'US';
    const L = LIVE[mk]; if (!okSnap(L, mk)) return null;
    const t = now() / 1000;
    if (mk === 'US' && L.ext && L.x && Array.isArray(L.x[code]) && (L.xstate === 'closed' ? t <= L.xclose + 900 : t - L.at <= 5400)) {
      const v = L.x[code], p = +v[0], c = +v[1], age = +v[2];
      if (p > 0 && isFinite(c) && Math.abs(c) < 100) {
        const qt = fromQ(L, code, mk), base = p / (1 + c / 100), qx = L.at - (isFinite(age) && age >= 0 ? age : 0);
        if (L.ext === 'pre') return { code, mk, p, ref: base, chg: c / 100, t: qx, at: L.at, ses: L.session, ph: 'pre', src: (L.src || 'Yahoo Finance') + ' 盤前', stale: L.xstate !== 'closed' && t - L.at > 600 };
        const ref = qt && qt.ref > 0 ? qt.ref : base;   // 盤後：漲跌對前一交易日收盤（含正規時段＋盤後）；另附當天收盤與盤後漲跌
        return { code, mk, p, ref, chg: p / ref - 1, t: qx, at: L.at, ses: L.session, ph: 'post', close: base, xchg: c / 100, src: (L.src || 'Yahoo Finance') + ' 盤後', stale: L.xstate !== 'closed' && t - L.at > 600 };
      }
    }
    return fromQ(L, code, mk);
  }
  function fx() {
    let best = null;
    ['US', 'TW'].forEach(mk => { const L = LIVE[mk], v = L && L.mb && L.mb.q && L.mb.q['TWD=X'];
      if (Array.isArray(v) && +v[0] > 0 && +v[2] > 0 && (!best || +v[2] > best.t)) best = { rate: +v[0], prev: +v[1] > 0 ? +v[1] : null, t: +v[2] }; });
    if (!best || now() / 1000 - best.t > 4 * 86400) return null;
    best.date = tpeDate(best.t); best.src = 'Yahoo TWD=X 即時'; return best;
  }
  function codes() { const s = new Set(); ['TW', 'US'].forEach(mk => { const L = LIVE[mk]; if (!L) return; Object.keys(L.q || {}).forEach(c => s.add(c)); Object.keys(L.x || {}).forEach(c => s.add(c)); }); return [...s]; }
  function tag(q) {
    if (!q) return '';
    if (q.ph === 'close') return '收盤';
    const w = q.ph === 'pre' ? '盤前' : q.ph === 'post' ? '盤後' : q.settling ? '剛收盤' : '盤中';
    return w + ' ' + hhmm(q.t) + (q.stale ? '（更新中斷）' : '');
  }
  BN.liveq = { want, get, fx, codes, tag, hhmm, phase, snap: mk => LIVE[mk] || null, on: fn => { if (typeof fn === 'function') SUBS.push(fn); } };
})();
