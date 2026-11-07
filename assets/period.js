/* BNASDAQ｜回測起點：讓每一張回測圖表都能自由改起點（年／月），同一頁的圖表、表格與關鍵數字同步重算。
   資料：assets/bt.js（window.BT）＝同一套引擎產出的月底權益與日權益（1986-09 起）：核心策略 fund（專案規則 B.2）、
   衛星策略 sat（B.3；2000-03 起才有訊號，之前為 null——用 first('sat') 取得最早可用月份）。
   口徑與本站主回測完全相同：月底收盤為起點、2026-09-30 收盤為終點；年數＝日曆日 ÷ 365.25；
   定期定額＝每月底扣款、每筆成本 0.1%、最後一個月底估值、IRR 以實際日期折算；最大回撤以日收盤計。
   QQQ 1999-03-10 前為 NDX 代理（價格指數）、QLD 2006-06 前為合成序列、SHV 為合成短期美債——起點早於這些日期時自動標註。 */
(function () {
  'use strict';
  const T = window.BT;
  window.BN = window.BN || {};
  if (!T) { BN.bt = null; return; }
  const M = T.m, MED = T.med, N = M.length, IDX = new Map(M.map((m, i) => [m, i]));
  const DAY = 86400000;
  // ---- 日期還原 ----
  const DD = [], DIDX = new Map();
  { let t = Date.parse(T.d0 + 'T00:00:00Z'); T.dd.forEach((x, j) => { if (j > 0) t += x * DAY; const s = new Date(t).toISOString().slice(0, 10); DD.push(s); DIDX.set(s, j); }); }
  const END = T.end, LAST = N - 1;
  const yrs = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY / 365.25;
  const clamp = ym => { if (!/^\d{4}-\d{2}$/.test(String(ym))) return T.official; if (!IDX.has(ym)) { ym = ym < T.min_start ? T.min_start : (ym > T.max_start ? T.max_start : T.official); } return ym < T.min_start ? T.min_start : (ym > T.max_start ? T.max_start : ym); };
  const KEYS = ['fund', 'sat', 'qqq', 'qld', 'shv'];
  const NAME = { fund: 'BNASDAQ', sat: 'BNASDAQ 衛星策略', qqq: 'QQQ', qld: 'QLD', shv: 'SHV' };
  // 各序列最早可用的月份（衛星策略的模型自 2000-03 起才有訊號）；起點早於此月時，比較區塊自動改從此月開始
  const first = key => (T.first && T.first[key]) || T.min_start;

  // ---- 月線 ----
  function i0Of(ym) { return IDX.get(clamp(ym)); }
  function monthly(key, ym) { const i0 = i0Of(ym), a = T.eq[key], b = a[i0]; return { months: M.slice(i0), dates: MED.slice(i0), values: a.slice(i0).map(v => v / b) }; }
  function lump(key, ym) { // 單筆 100 萬：期末價值含期初買進成本 0.1%（同本站主回測）；年化報酬用序列本身
    const i0 = i0Of(ym), a = T.eq[key]; const ratio = a[LAST] / a[i0], y = yrs(MED[i0], END); return { ratio, end: 1e6 * 0.999 * ratio, cagr: Math.pow(ratio, 1 / y) - 1, years: y, start: MED[i0], doubling: Math.log(2) / Math.log(Math.pow(ratio, 1 / y)) }; }

  // ---- 日線 ----
  function dIdx(ym) { return DIDX.get(MED[i0Of(ym)]); }
  function daily(key, ym) { const j0 = dIdx(ym), a = T.daily[key], b = a[j0]; return { dates: DD.slice(j0), values: a.slice(j0).map(v => v / b) }; }
  function drawdown(key, ym) {
    const j0 = dIdx(ym), a = T.daily[key]; let pk = a[j0], pkj = j0, mdd = 0, P = j0, Tr = j0; const dd = [];
    for (let j = j0; j < a.length; j++) { if (a[j] > pk) { pk = a[j]; pkj = j; } const x = a[j] / pk - 1; dd.push(x); if (x < mdd) { mdd = x; P = pkj; Tr = j; } }
    let R = null; for (let j = Tr + 1; j < a.length; j++) if (a[j] >= a[P]) { R = j; break; }
    // 回撤段：從前高跌下來、到回到前高為止；計算跌幅超過 20% 的段數
    let n20 = 0, pv = a[j0], low = pv, open = false;
    for (let j = j0 + 1; j < a.length; j++) { const v = a[j]; if (v >= pv) { if (open && low / pv - 1 <= -0.2) n20++; pv = v; low = v; open = false; } else { open = true; if (v < low) low = v; } }
    if (open && low / pv - 1 <= -0.2) n20++;
    return { dates: DD.slice(j0), dd, mdd, peak: DD[P], trough: DD[Tr], recover: R == null ? null : DD[R], recover_years: R == null ? null : yrs(DD[P], DD[R]), trough_to_recover_months: R == null ? null : (Date.parse(DD[R]) - Date.parse(DD[Tr])) / DAY / 30.4375, episodes_gt20: n20, need: 1 / (1 + mdd) };
  }
  function maxDDInside(key, d0, d1) { const a = T.daily[key], j0 = DIDX.get(d0), j1 = DIDX.get(d1); let pk = a[j0], m = 0; for (let j = j0; j <= j1; j++) { if (a[j] > pk) pk = a[j]; m = Math.min(m, a[j] / pk - 1); } return m; }
  function vol(key, ym) { // 年化波動＝日對數報酬的樣本標準差 × √252（同本站主回測）
    const j0 = dIdx(ym), a = T.daily[key]; let s = 0, n = 0; const r = []; for (let j = j0 + 1; j < a.length; j++) { const x = Math.log(a[j] / a[j - 1]); r.push(x); s += x; n++; } const mu = s / n; let v = 0; r.forEach(x => { v += (x - mu) * (x - mu); }); return Math.sqrt(v / (n - 1) * 252); }
  function sample(dates, vals, every) { // 抽樣畫圖用：每 every 天取一點，並保留每段的最低點
    const xs = [], ys = []; let lo = 0;
    for (let j = 0; j < vals.length; j++) { if (vals[j] < vals[lo]) lo = j; if (j % every === 0 || j === vals.length - 1) { if (lo !== j && (!xs.length || xs[xs.length - 1] !== dates[lo])) { xs.push(dates[lo]); ys.push(vals[lo]); } xs.push(dates[j]); ys.push(vals[j]); lo = j + 1 < vals.length ? j + 1 : j; } }
    return { x: xs, y: ys };
  }

  // ---- 定期定額 ----
  // IRR（二分法）：每筆扣款到終點的年數先算好（與逐次計算的算式相同，所以結果逐位元相同）；
  // 區間已無法再縮小時提早結束（之後的迭代不會改變 lo、hi）；同樣輸入的結果記下來重用。
  const IRR_MEMO = new Map();
  function irrDays(cdates, amt, endDate, value) {
    const key = cdates.join(',') + '|' + amt + '|' + endDate + '|' + value;
    if (IRR_MEMO.has(key)) return IRR_MEMO.get(key);
    const tE = Date.parse(endDate), ts = cdates.map(d => (tE - Date.parse(d)) / DAY / 365.25), n = ts.length;
    const f = r => { const b = 1 + r; let s = 0; for (let i = 0; i < n; i++) s = s + amt * Math.pow(b, ts[i]); return s - value; };
    let lo = -0.99, hi = 3;
    for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (mid === lo || mid === hi) break; if (f(mid) < 0) lo = mid; else hi = mid; }
    const out = (lo + hi) / 2; IRR_MEMO.set(key, out); return out;
  }
  function dca(key, ym, amt) {
    amt = amt || 1e4; const i0 = i0Of(ym), a = key === 'inv' ? null : T.eq[key]; let u = 0, n = 0; const series = [], cd = [];
    for (let i = i0; i <= LAST; i++) {
      if (i < LAST) { n++; cd.push(MED[i]); if (a) u += amt * 0.999 / a[i]; }
      series.push(a ? u * a[i] : amt * n);
    }
    const end = series[series.length - 1];
    return { months: M.slice(i0), series, n, principal: amt * n, end, mult: end / (amt * n), irr: a ? irrDays(cd, amt, END, end) : 0, first: MED[i0], last: cd[cd.length - 1] };
  }

  // ---- 年度 ----
  function cal(ym, keys) {
    keys = keys || ['fund', 'qqq', 'qld']; const i0 = i0Of(ym), out = [];
    const y0 = +M[i0].slice(0, 4) + (M[i0].slice(5) === '12' ? 1 : 1), y1 = +M[LAST].slice(0, 4);
    for (let y = y0; y <= y1; y++) {
      const ib = IDX.get((y - 1) + '-12'); if (ib == null || ib < i0) continue;
      const ie = IDX.has(y + '-12') ? IDX.get(y + '-12') : LAST; const partial = !IDX.has(y + '-12');
      const row = { y, partial }; keys.forEach(k => { row[k] = T.eq[k][ie] / T.eq[k][ib] - 1; }); out.push(row);
    }
    const full = out.filter(r => !r.partial);
    const down = full.filter(r => r.qqq < 0);
    const best = full.reduce((b, r) => (!b || r.fund > b.fund) ? r : b, null);
    return { list: out, stats: { n: full.length, fund_pos: full.filter(r => r.fund > 0).length, beat_qqq: full.filter(r => r.fund > r.qqq).length, qqq_down: down.length, fund_pos_when_qqq_down: down.filter(r => r.fund > 0).length, qqq_down_years: down.map(r => r.y), best: best ? { y: best.y, fund: best.fund, qqq: best.qqq } : null, first: out.length ? out[0].y : null, last: out.length ? out[out.length - 1].y : null } };
  }

  // ---- 近 N 年（終點固定 2026-09-30）----
  function periods(ym, keys) {
    keys = keys || ['fund', 'qqq', 'qld']; const i0 = i0Of(ym), out = [];
    [1, 3, 5, 10, 15, 20, 30, 40].forEach(n => { const j = LAST - 12 * n; if (j < i0) return; const y = yrs(MED[j], END); const row = { name: '近 ' + n + ' 年', start: MED[j], years: y }; keys.forEach(k => { row[k] = Math.pow(T.eq[k][LAST] / T.eq[k][j], 1 / y) - 1; }); out.push(row); });
    return out;
  }

  // ---- 大跌（QQQ 從起點後的前高跌超過 20% 的每一段）----
  function crises(ym) { const i0 = i0Of(ym); return (T.crisis_by_start[i0] || []).map(j => T.crises[j]); }

  // ---- 代理區間標註 ----
  function proxyNote(ym) {
    const s = MED[i0Of(ym)], parts = [];
    if (s < '1999-03-11') parts.push('QQQ 於 1999-03 上市前以 NDX 指數代理（價格指數，不含息）');
    if (s.slice(0, 7) < T.proxy.qld_until) parts.push('QLD 於 2006-06 上市前以合成序列代理（2 × QQQ 日報酬 − 前月 T-bill − 以真實 QLD 重疊期校準的費用）');
    return parts.length ? '代理區間：' + parts.join('；') + '。' : '';
  }

  // ---- 狀態：起點；可有多個獨立頻道（例：同頁美元段 2000-05、台幣段 2013-12）。網址 ?start=YYYY-MM（主頻道）、?start_<id>=（其他頻道）可分享 ----
  function makeChannel(id, def0) {
    const param = id ? 'start_' + id : 'start'; let CUR = null, DEF = def0 || T.official, PEND = null; const LS = [], UI = [];
    const ch = {
      id, param,
      def(ym) { DEF = clamp(ym || DEF); CUR = null; return ch.get(); },
      getDef() { return DEF; },
      get() { if (!CUR) { let q = null; try { q = new URLSearchParams(location.search).get(param); } catch (e) { } CUR = clamp(q && /^\d{4}-\d{2}$/.test(q) ? q : DEF); } if (ch.min && CUR < ch.min) CUR = ch.min; return CUR; },
      set(ym) {
        CUR = clamp(ym); if (ch.min && CUR < ch.min) CUR = ch.min;
        try { const u = new URL(location.href); if (CUR === DEF) u.searchParams.delete(param); else u.searchParams.set(param, CUR); history.replaceState(null, '', u.pathname.split('/').pop() + u.search + u.hash); } catch (e) { }
        // 起點選擇列（按鈕、下拉選單）立刻更新，下一個畫面就看得到；圖表與表格排到這個畫面之後再重算，連續點選時只算最後一次
        UI.forEach(f => { try { f(CUR); } catch (err) { console.error(err); } });
        if (PEND) return; PEND = LS.slice();
        const run = () => { const fs = PEND, v = ch.get(); PEND = null; fs.forEach(f => { try { f(v); } catch (err) { console.error(err); } }); document.dispatchEvent(new CustomEvent('bt-start', { detail: { ym: v, channel: id || '' } })); };
        if (document.hidden || typeof requestAnimationFrame !== 'function') setTimeout(run, 0); else requestAnimationFrame(() => setTimeout(run, 0));
      },
      on(f, now) { LS.push(f); if (now !== false) { try { f(ch.get()); } catch (err) { console.error(err); } } },
      onUI(f, now) { UI.push(f); if (now !== false) { try { f(ch.get()); } catch (err) { console.error(err); } } },
      picker(host, o) { return picker(ch, host, o); }
    };
    return ch;
  }
  const MAIN = makeChannel('', T.official), CH = { '': MAIN };
  function channel(id, def) { if (!id) { if (def) MAIN.def(def); return MAIN; } if (!CH[id]) CH[id] = makeChannel(id, def); else if (def) CH[id].def(def); return CH[id]; }

  // ---- UI：起點選擇列 ----
  let NP = 0;
  function picker(ch, host, o) {
    o = o || {}; if (typeof host === 'string') host = document.getElementById(host); if (!host) return;
    const min = o.min && o.min > T.min_start ? o.min : T.min_start, max = T.max_start; if (o.min) ch.min = min;
    const presets = (o.presets || [['1986-09', '最早 1986'], ['1996-09', '近 30 年'], ['2000-05', '正式回測'], ['2009-01', '2009 起'], ['2013-12', '2013 年底'], ['2020-12', '2020 年底']]).filter(p => p[0] >= min && p[0] <= max);
    const Y0 = +min.slice(0, 4), Y1 = +max.slice(0, 4), n = ++NP;
    const wrap = document.createElement('div'); wrap.className = 'btbar'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', o.label || '回測起點');
    let ys = ''; for (let y = Y1; y >= Y0; y--) ys += '<option value="' + y + '">' + y + ' 年</option>';
    let ms = ''; for (let m = 1; m <= 12; m++) ms += '<option value="' + String(m).padStart(2, '0') + '">' + m + ' 月底</option>';
    wrap.innerHTML = '<div class="bt-main"><span class="bt-k">' + (o.label || '回測起點') + '</span><label class="sr-only" for="bty-' + n + '">起始年份</label><select class="bt-y" id="bty-' + n + '">' + ys + '</select><label class="sr-only" for="btm-' + n + '">起始月份</label><select class="bt-m" id="btm-' + n + '">' + ms + '</select><button type="button" class="bt-reset">重設</button></div>'
      + (presets.length ? '<div class="bt-pre" aria-label="快速選擇">' + presets.map(p => '<button type="button" data-ym="' + p[0] + '">' + p[1] + '</button>').join('') + '</div>' : '')
      + '<div class="bt-info" aria-live="polite"></div>';
    host.innerHTML = ''; host.appendChild(wrap);
    const sy = wrap.querySelector('.bt-y'), sm = wrap.querySelector('.bt-m'), info = wrap.querySelector('.bt-info');
    const apply = () => { let ym = sy.value + '-' + sm.value; if (ym < min) ym = min; if (ym > max) ym = max; ch.set(ym); };
    sy.addEventListener('change', apply); sm.addEventListener('change', apply);
    wrap.querySelector('.bt-reset').addEventListener('click', () => ch.set(ch.getDef()));
    wrap.querySelectorAll('.bt-pre [data-ym]').forEach(b => b.addEventListener('click', () => ch.set(b.dataset.ym)));
    ch.onUI(ym => {
      if (ym < min) ym = min;
      sy.value = ym.slice(0, 4); sm.value = ym.slice(5, 7);
      [...sm.options].forEach(op => { const v = sy.value + '-' + op.value; op.disabled = v < min || v > max; });
      wrap.querySelectorAll('.bt-pre [data-ym]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ym === ym)));
      const i0 = i0Of(ym), y = yrs(MED[i0], END);
      info.innerHTML = '<b>' + MED[i0] + '</b> → <b>' + END + '</b>，共 ' + y.toFixed(1) + ' 年' + (ym === ch.getDef() ? '（預設）' : '') + (o.extra ? o.extra(ym) : '');
    });
    return wrap;
  }

  BN.bt = { T, M, MED, DD, END, KEYS, NAME, first, yrs, clamp, i0Of, monthly, lump, daily, drawdown, maxDDInside, vol, sample, dca, irrDays, cal, periods, crises, proxyNote,
    channel, def: ym => MAIN.def(ym), get: () => MAIN.get(), set: ym => MAIN.set(ym), on: (f, now) => MAIN.on(f, now), picker: (host, o) => picker(MAIN, host, o),
    min: T.min_start, max: T.max_start, official: T.official };
})();
