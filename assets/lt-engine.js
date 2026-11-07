/* BNASDAQ｜投資組合透視：計算核心（純函式，瀏覽器與 Node 共用；不讀網路、不碰畫面）
   輸入：持有清單（代號＋比例或股數）、證券總表、ETF 成分股、匯率、同公司對照表
   輸出：每家公司占總資產的比重（含來源 ETF 拆分）、非股票資產、槓桿額外曝險、未拆解資產、產業分布、ETF 兩兩重疊度
   公式（每一步都可手算）：
     股數模式：市值＝股數 × 最新收盤價（美股再 × 美元兌台幣匯率）；資產占比＝市值 ÷ 全部市值
     比例模式：資產占比＝輸入比例 ÷ 全部比例合計（合計不是 100 時等比例換算並提示）
     公司占總資產＝Σ（資產占比 × 該公司在這檔 ETF 的權重 × 槓桿倍數）；個股本身權重＝100%
     非股票資產＝Σ（資產占比 × ETF 內非股票部分）；槓桿額外曝險＝Σ（資產占比 ×（倍數－1）× ETF 股票權重合計） */
(function (root) {
  'use strict';
  const LT = {};

  /** 代號正規化：去空白、轉大寫、BRK.B → BRK-B、去掉 .TW／.TWO 後綴 */
  LT.norm = function (s) {
    let c = String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
    c = c.replace(/\.(TW|TWO)$/, '');
    c = c.replace(/^([A-Z]{1,5})[./]([A-Z])$/, '$1-$2');
    return c;
  };

  /** 把一筆持有解析成證券資訊；找不到回傳 null */
  LT.resolve = function (code, U) {
    const c = LT.norm(code);
    return U.get(c) ? Object.assign({ code: c }, U.get(c)) : null;
  };

  /** 取得 ETF 的成分股（槓桿／反向 ETF 用基準 ETF × 倍數）；回傳 {h, lev, eq, base, asof, src} 或 null */
  LT.holdings = function (code, E) {
    const d = E.get(code);
    if (!d) return null;
    if (d.base) {
      const b = E.get(d.base);
      if (!b || !b.h) return null;
      return { h: b.h, lev: (d.lev || 1) * (b.lev || 1), eq: b.eq, base: d.base, asof: b.asof, src: b.src, partial: !!b.partial };
    }
    if (!d.h) return null;
    return { h: d.h, lev: d.lev || 1, eq: d.eq, base: null, asof: d.asof, src: d.src, partial: !!d.partial };
  };

  /**
   * rows：[{code, v, px}]（v＝比例或股數；px＝手動輸入價格，可省略）
   * o：{mode:'pct'|'shares', U:Map, E:Map, fx:number, alias:Object, total:number(比例模式可選，台幣總額)}
   */
  LT.compute = function (rows, o) {
    const U = o.U, E = o.E, alias = o.alias || {}, fx = +o.fx || 0;
    const out = { errors: [], warnings: [], assets: [], cos: [], undec: [], nonEq: 0, unlisted: 0, levExtra: 0, stockExp: 0, total: null, sumPct: null, overlap: [], sectors: [] };
    const A = [];
    rows.forEach((r, i) => {
      const raw = String(r.code || '').trim();
      if (!raw && !(+r.v)) return;
      const s = LT.resolve(raw, U);
      const v = +r.v;
      if (!s) { out.errors.push({ row: i, msg: '找不到代號「' + raw + '」' }); return; }
      if (!(v > 0)) { out.errors.push({ row: i, msg: s.code + ' 的' + (o.mode === 'shares' ? '股數' : '比例') + '需大於 0' }); return; }
      const a = { row: i, code: s.code, name: s.n, kind: s.k, market: s.m, v };
      if (o.mode === 'shares') {
        const px = +r.px > 0 ? +r.px : +s.p;
        if (!(px > 0)) { out.errors.push({ row: i, msg: s.code + ' 沒有收盤價，請手動輸入價格' }); return; }
        const usd = s.m === 'US';
        if (usd && !(fx > 0)) { out.errors.push({ row: i, msg: '缺少美元兌台幣匯率' }); return; }
        a.px = px; a.cur = usd ? 'USD' : 'TWD'; a.value = v * px * (usd ? fx : 1);
      }
      A.push(a);
    });
    if (!A.length) return out;
    // ---- 資產占比 ----
    if (o.mode === 'shares') {
      const tot = A.reduce((t, a) => t + a.value, 0);
      A.forEach(a => { a.w = a.value / tot; });
      out.total = tot;
    } else {
      const sum = A.reduce((t, a) => t + a.v, 0);
      out.sumPct = sum;
      if (Math.abs(sum - 100) > 1e-9) out.warnings.push('比例合計 ' + (+sum.toFixed(4)) + '%，已等比例換算成 100%');
      A.forEach(a => { a.w = a.v / sum; });
      if (+o.total > 0) { out.total = +o.total; A.forEach(a => { a.value = a.w * out.total; }); }
    }
    // ---- 拆解 ----
    const C = new Map();
    const add = (key, name, sector, w, from) => {
      const k = alias[key] || key;
      let c = C.get(k);
      if (!c) { c = { key: k, name, sector: sector || '', w: 0, src: {} }; C.set(k, c); }
      if (!c.name && name) c.name = name;
      if (!c.sector && sector) c.sector = sector;
      c.w += w; c.src[from] = (c.src[from] || 0) + w;
    };
    const HB = new Map();
    A.forEach(a => {
      if (a.kind === 'E') {
        const H = LT.holdings(a.code, E);
        if (!H) { a.status = 'none'; out.undec.push({ code: a.code, name: a.name, w: a.w }); return; }
        a.status = H.h.length ? 'lt' : 'nonEq'; a.lev = H.lev; a.base = H.base; a.asof = H.asof; a.src = H.src;
        let eqSum = 0;
        H.h.forEach(x => { eqSum += x[1]; add(x[0], x[2], x[3], a.w * H.lev * x[1] / 100, a.code); });
        // 發行商只列出部分持股（例如 Vanguard 分頁未抓齊）：沒列出的部分仍是股票，記為「未逐一列出的小額持股」，不算非股票
        if (H.partial) out.unlisted += a.w * H.lev * (1 - eqSum / 100); else out.nonEq += a.w * (1 - eqSum / 100);
        out.levExtra += a.w * (H.lev - 1) * (H.partial ? 1 : eqSum / 100);
        a.partial = H.partial;
        HB.set(a.code, H);
      } else {
        a.status = 'stock';
        add(a.code, a.name, a.sector || '', a.w, a.code);
      }
    });
    out.assets = A;
    // ---- 公司排序與名稱 ----
    out.cos = [...C.values()].map(c => {
      const u = U.get(c.key);
      if (u && u.k === 'S' && u.n) c.name = u.n;
      if (u && !c.sector && u.s) c.sector = u.s;
      return c;
    }).sort((p, q) => Math.abs(q.w) - Math.abs(p.w) || (p.key < q.key ? -1 : 1));
    out.stockExp = out.cos.reduce((t, c) => t + c.w, 0);
    // ---- 產業 ----
    const S = new Map();
    out.cos.forEach(c => { const s = c.sector || '未分類'; S.set(s, (S.get(s) || 0) + c.w); });
    out.sectors = [...S.entries()].sort((p, q) => q[1] - p[1]);
    // ---- ETF 兩兩重疊度（以各自權重取最小值加總；只看有成分股的 ETF）----
    const codes = [...HB.keys()];
    const vec = code => { const m = new Map(); HB.get(code).h.forEach(x => { const k = alias[x[0]] || x[0]; m.set(k, (m.get(k) || 0) + x[1]); }); return m; };
    const V = new Map(codes.map(c => [c, vec(c)]));
    for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) {
      const a = V.get(codes[i]), b = V.get(codes[j]); let ov = 0;
      a.forEach((w, k) => { if (b.has(k)) ov += Math.min(w, b.get(k)); });
      out.overlap.push([codes[i], codes[j], ov / 100]);
    }
    return out;
  };

  /** 摘要：公司家數、前十大合計、最大單一公司 */
  LT.summary = function (r) {
    const pos = r.cos.filter(c => c.w > 0);
    return { n: pos.length, top10: pos.slice(0, 10).reduce((t, c) => t + c.w, 0), top: pos[0] || null, nonEq: r.nonEq, unlisted: r.unlisted, levExtra: r.levExtra, stockExp: r.stockExp, undec: r.undec.reduce((t, u) => t + u.w, 0) };
  };

  /** 匯出 CSV（UTF-8 BOM，Excel 開啟不亂碼） */
  LT.csv = function (r) {
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const lines = [['排名', '公司', '代號', '產業', '占總資產(%)', '金額(台幣)', '來源'].map(q).join(',')];
    r.cos.forEach((c, i) => lines.push([i + 1, c.name, c.key, c.sector, (c.w * 100).toFixed(4), r.total ? Math.round(c.w * r.total) : '', Object.entries(c.src).map(([k, w]) => k + ' ' + (w * 100).toFixed(3) + '%').join('；')].map(q).join(',')));
    if (r.unlisted) lines.push(['', '其他小額持股（發行商未逐一列出）', '', '', (r.unlisted * 100).toFixed(4), r.total ? Math.round(r.unlisted * r.total) : '', ''].map(q).join(','));
    if (r.nonEq) lines.push(['', '非股票資產（現金、債券等）', '', '', (r.nonEq * 100).toFixed(4), r.total ? Math.round(r.nonEq * r.total) : '', ''].map(q).join(','));
    r.undec.forEach(u => lines.push(['', '未拆解：' + u.name, u.code, '', (u.w * 100).toFixed(4), r.total ? Math.round(u.w * r.total) : '', '成分股資料暫缺'].map(q).join(',')));
    return '﻿' + lines.join('\r\n');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LT;
  else { root.BN = root.BN || {}; root.BN.lt = LT; }
})(typeof window !== 'undefined' ? window : globalThis);
