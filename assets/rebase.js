/* BNASDAQ｜共同區間重算：當加入的標的上市比對比期間晚，所有做法自動改從「最晚上市者」的第一個月底起算。
   全部用月底資料：美元序列來自 data.js 的 SITE.eq（BNASDAQ／QQQ／QLD）與 SITE.dca_series.shv 反推（SHV），
   台幣序列＝美元序列 × 月底匯率（data/tw/_fx.json，FRED DEXTAUS）；0050、台積電用 data/tw/0050.json、2330.json 的月底序列。
   指標：單筆（期末÷期初）、年化（日數÷365.25，月底日期）、逐年、最深跌幅（月底收盤）、定期定額（月底扣款、每筆 0.1%、最後一個月底估值）、IRR。 */
(function () {
  'use strict';
  window.BN = window.BN || {};
  const S = window.SITE;
  const CONTRIB = 10000 * 0.999;

  // ---- 月份工具 ----
  function monthList(startYM, endYM) { const out = []; let [y, m] = startYM.split('-').map(Number); const [ey, em] = endYM.split('-').map(Number); while (y < ey || (y === ey && m <= em)) { out.push(y + '-' + String(m).padStart(2, '0')); m++; if (m > 12) { m = 1; y++; } } return out; }
  function monthEnd(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)); }   // 該月最後一個日曆日
  function yearsBetween(ymA, ymB) { return (monthEnd(ymB) - monthEnd(ymA)) / 86400000 / 365.25; }
  const ymd = ym => { const d = monthEnd(ym); return d.toISOString().slice(0, 10); };

  // ---- 從定期定額序列反推月報酬（SHV 用）----
  function reconstruct(dcaSeries, nContrib) { const eq = [1]; for (let m = 1; m < dcaSeries.length; m++) { const c = m < nContrib ? CONTRIB : 0; const r = (dcaSeries[m] - c) / dcaSeries[m - 1] - 1; eq.push(eq[eq.length - 1] * (1 + r)); } return eq; }

  // ---- 基礎序列 ----
  function baseUSD() { return { fund: S.eq.fund, qqq: S.eq.qqq, qld: S.eq.qld, shv: reconstruct(S.dca_series.shv, S.window.n_contrib) }; }
  // 台幣：W13 月份清單（例 2013-12～2026-09），美元序列 × 月底匯率；0050／2330 由 JSON 月底序列對齊
  function baseTWD(fx, basej) {
    const months13 = monthList(S.six.window[0].slice(0, 7), S.six.window[1].slice(0, 7));
    const off = S.window.months.indexOf(months13[0]);
    const conv = arr => months13.map((ym, i) => { const v = arr[off + i], r = fx && fx[ym]; return (v == null || r == null) ? null : v * r; });
    const fromJson = j => { if (!j || !j.monthly) return months13.map(() => null); const map = {}; j.monthly.forEach(x => { map[x[0]] = x[1]; }); return months13.map(ym => map[ym] == null ? null : map[ym]); };
    return { months: months13, series: { fund: conv(S.eq.fund), qqq: conv(S.eq.qqq), qld: conv(S.eq.qld), tw: fromJson(basej && basej['0050']), tsmc: fromJson(basej && basej['2330']), save: months13.map(() => 1) } };
  }

  // ---- 指標（series 為對齊 months 的陣列，可含 null；i0..i1 為共同區間）----
  function firstValid(arr) { for (let i = 0; i < arr.length; i++) if (arr[i] != null) return i; return -1; }
  function metrics(series, months, i0, i1) {
    const a0 = series[i0], a1 = series[i1];
    if (a0 == null || a1 == null) return null;
    const ratio = a1 / a0, yrs = yearsBetween(months[i0], months[i1]);
    const cagr = Math.pow(ratio, 1 / yrs) - 1;
    const annual = [];   // [{y, label, ret, partial}]
    const y0 = +months[i0].slice(0, 4), y1 = +months[i1].slice(0, 4), m0 = +months[i0].slice(5, 7), m1 = +months[i1].slice(5, 7);
    for (let y = (m0 === 12 ? y0 + 1 : y0); y <= y1; y++) {
      const ib = (y === y0) ? i0 : months.indexOf((y - 1) + '-12');
      const ie = (y === y1) ? i1 : months.indexOf(y + '-12');
      if (ib < i0 || ie < 0 || ie > i1 || series[ib] == null || series[ie] == null) continue;
      const partialStart = (y === y0 && m0 !== 12), partialEnd = (y === y1 && m1 !== 12);
      annual.push({ y, label: y + (partialStart ? '（自 ' + m0 + ' 月底）' : '') + (partialEnd ? '（至 ' + m1 + ' 月底）' : ''), ret: series[ie] / series[ib] - 1, partial: partialStart || partialEnd });
    }
    let runmax = -1, runmaxM = null, mdd = 0, peak = null, trough = null;
    for (let i = i0; i <= i1; i++) { const v = series[i]; if (v == null) continue; if (v > runmax) { runmax = v; runmaxM = months[i]; } const dd = v / runmax - 1; if (dd < mdd) { mdd = dd; peak = runmaxM; trough = months[i]; } }
    return { ratio, lump: 1e6 * ratio, cagr, years: yrs, annual, mdd: { mdd, peak: peak ? ymd(peak) : null, trough: trough ? ymd(trough) : null, need: mdd > -1 ? 1 / (1 + mdd) : null }, norm: series.map((v, i) => (i < i0 || i > i1 || v == null) ? null : v / a0) };
  }
  function dca(series, i0, i1, amt) {
    let u = 0, n = 0; const out = series.map(() => null);
    for (let m = i0; m <= i1; m++) { const p = series[m]; if (p == null) { continue; } if (m < i1) { u += amt * 0.999 / p; n++; } out[m] = u * p; }
    const end = out[i1]; return { series: out, n, end, principal: amt * n, irr: n ? irr(n, i0, i1, end, amt) : null };
  }
  function irr(n, i0, i1, value, amt) { let lo = -0.5, hi = 1; const g = r => { let s = 0; for (let m = i0; m < i0 + n; m++) s += amt * Math.pow(1 + r, i1 - m); return s - value; }; for (let k = 0; k < 120; k++) { const mid = (lo + hi) / 2; if (g(mid) > 0) hi = mid; else lo = mid; } return Math.pow(1 + (lo + hi) / 2, 12) - 1; }
  function periodCagr(series, months, startYMD, i1) { const ym = startYMD.slice(0, 7); const i = months.indexOf(ym); if (i < 0 || series[i] == null || series[i1] == null || i >= i1) return null; return Math.pow(series[i1] / series[i], 1 / yearsBetween(months[i], months[i1])) - 1; }

  let FX = null;
  async function loadFX() { if (FX) return FX; try { const r = await fetch('data/tw/_fx.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); FX = j.months || null; } } catch (e) { } return FX; }

  BN.rebase = { monthList, monthEnd, yearsBetween, ymd, reconstruct, baseUSD, baseTWD, firstValid, metrics, dca, irr, periodCagr, loadFX, fx: () => FX };
})();
