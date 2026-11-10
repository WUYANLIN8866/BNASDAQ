/* BNASDAQ｜投資組合透視：計算核心（純函式，瀏覽器與 Node 共用；不讀網路、不碰畫面）
   輸入：持有清單（代號＋比例或股數）、證券總表、ETF 成分股、匯率、同公司對照表
   輸出：每家公司占總資產的比重（含來源 ETF 拆分）、非股票資產、槓桿額外曝險、未拆解資產、產業分布、ETF 兩兩重疊度
   公式（每一步都可手算）：
     股數模式：市值＝股數 × 價格（台股最近收盤價；美股 Nasdaq 快照價；美股再 × 美元兌台幣匯率）；資產占比＝市值 ÷ 全部市值
     比例模式：資產占比＝輸入比例 ÷ 全部比例合計（合計不是 100 時等比例換算並提示）
     公司占總資產＝Σ（資產占比 × 該公司在這檔 ETF 的權重 × 槓桿倍數）；個股本身權重＝100%
     非股票資產＝Σ（資產占比 × ETF 內非股票部分）；槓桿額外曝險＝Σ（資產占比 ×（倍數－1）× ETF 股票權重合計）
     現金（自行輸入）：比例模式直接用比例；股數模式填金額（台幣現金＝金額，美元現金＝金額 × 匯率），不拆解、不算任何公司
     恆等式：股票曝險合計＋其他小額持股＋非股票資產＋現金－槓桿額外曝險＝100%
     資產全貌（LT.mix，3D 圓餅用）：改以「投入資金」計，槓桿 ETF 不放大（公司投入資金＝資產占比 × 權重），反向 ETF 整檔另列；
       股票（依公司）＋債券＋商品＋現金＋ETF 內現金等＋反向 ETF＋未拆解＋其他＝100% */
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

  /** 現金：固定兩種幣別（k＝'C'；p＝每 1 單位的價格，台幣 1 元、美元 1 美元，股數模式的「股數」就是金額）
      別名只用中文組合：USD（ProShares 2 倍半導體 ETF）、CASH（Pathward Financial）是真實美股代號，不能拿來當現金 */
  LT.CASH = {
    '現金': { n: '現金（台幣）', m: 'TW', k: 'C', cur: 'TWD', p: 1, s: '' },
    '美元現金': { n: '現金（美元）', m: 'US', k: 'C', cur: 'USD', p: 1, s: '' }
  };
  LT.CASH_ALIAS = {
    '台幣': '現金', '台幣現金': '現金', '現金台幣': '現金', '新台幣': '現金', '新台幣現金': '現金', '現金(台幣)': '現金', '現金（台幣）': '現金', '現金TWD': '現金', 'TWD現金': '現金',
    '美元': '美元現金', '美金': '美元現金', '美金現金': '美元現金', '現金美元': '美元現金', '現金美金': '美元現金', '現金(美元)': '美元現金', '現金（美元）': '美元現金', '現金USD': '美元現金', 'USD現金': '美元現金'
  };

  /** 把一筆持有解析成證券資訊（先查證券總表，再查現金）；找不到回傳 null */
  LT.resolve = function (code, U) {
    const c = LT.norm(code);
    if (U.get(c)) return Object.assign({ code: c }, U.get(c));
    const k = LT.CASH[c] ? c : LT.CASH_ALIAS[c];
    return k ? Object.assign({ code: k }, LT.CASH[k]) : null;
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
    const out = { errors: [], warnings: [], assets: [], cos: [], undec: [], nonEq: 0, unlisted: 0, levExtra: 0, stockExp: 0, cash: 0, cashBy: {}, total: null, sumPct: null, overlap: [], sectors: [] };
    const A = [];
    rows.forEach((r, i) => {
      const raw = String(r.code || '').trim();
      if (!raw && !(+r.v)) return;
      const s = LT.resolve(raw, U);
      const v = +r.v;
      if (!s) { out.errors.push({ row: i, msg: '找不到代號「' + raw + '」' }); return; }
      if (!(v > 0)) { out.errors.push({ row: i, msg: s.code + ' 的' + (o.mode === 'shares' ? (s.k === 'C' ? '金額' : '股數') : '比例') + '需大於 0' }); return; }
      const a = { row: i, code: s.code, name: s.n, kind: s.k, market: s.m, v };
      if (o.mode === 'shares') {
        const px = s.k === 'C' ? 1 : +r.px > 0 ? +r.px : +s.p;   // 現金不吃手動價格：填的就是金額
        if (!(px > 0)) { out.errors.push({ row: i, msg: s.code + ' 沒有價格資料，請手動輸入價格' }); return; }
        const usd = s.m === 'US';
        if (usd && !(fx > 0)) { out.errors.push({ row: i, msg: '缺少美元兌台幣匯率' }); return; }
        a.px = px; a.cur = usd ? 'USD' : 'TWD'; a.value = v * px * (usd ? fx : 1);
        if (s.k === 'C') a.fx = usd ? fx : 1;
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
    const add = (key, name, sector, w, from, cw) => {   // w＝曝險（含槓桿）；cw＝投入資金（不含槓桿，反向 ETF 為 0）
      const k = alias[key] || key;
      let c = C.get(k);
      if (!c) { c = { key: k, name, sector: sector || '', w: 0, cw: 0, src: {} }; C.set(k, c); }
      if (!c.name && name) c.name = name;
      if (!c.sector && sector) c.sector = sector;
      c.w += w; c.cw += cw || 0; c.src[from] = (c.src[from] || 0) + w;
    };
    const HB = new Map();
    A.forEach(a => {
      if (a.kind === 'C') {   // 現金：不拆解、不算任何公司
        a.status = 'cash'; out.cash += a.w; out.cashBy[a.code] = (out.cashBy[a.code] || 0) + a.w;
        return;
      }
      if (a.kind === 'E') {
        const H = LT.holdings(a.code, E);
        if (!H) { a.status = 'none'; out.undec.push({ code: a.code, name: a.name, w: a.w }); return; }
        a.status = H.h.length ? 'lt' : 'nonEq'; a.lev = H.lev; a.base = H.base; a.asof = H.asof; a.src = H.src;
        let eqSum = 0;
        H.h.forEach(x => { eqSum += x[1]; add(x[0], x[2], x[3], a.w * H.lev * x[1] / 100, a.code, H.lev > 0 ? a.w * x[1] / 100 : 0); });
        a.eqSum = eqSum;
        // 發行商只列出部分持股（例如 Vanguard 分頁未抓齊）：沒列出的部分仍是股票，記為「未逐一列出的小額持股」，不算非股票
        if (H.partial) out.unlisted += a.w * H.lev * (1 - eqSum / 100); else out.nonEq += a.w * (1 - eqSum / 100);
        out.levExtra += a.w * (H.lev - 1) * (H.partial ? 1 : eqSum / 100);
        a.partial = H.partial;
        HB.set(a.code, H);
      } else {
        a.status = 'stock';
        add(a.code, a.name, a.sector || '', a.w, a.code, a.w);
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

  /** 不持有股票的 ETF 分類：commodity（商品、期貨、加密資產）、bond（債券）、other；先看名稱與代號（台股 B 尾碼＝債券、U 尾碼＝期貨），
      發行商資料只寫「債券、商品或現金型」時不足以判斷，只採用「依名稱或代號判定」的來源字串 */
  LT.kindOf = function (a) {
    const nm = String(a.name || ''), src = String(a.src || ''), c = String(a.code || '');
    if (/^商品/.test(src) || /^\d{4,5}U$/.test(c) || /Gold|Silver|Platinum|Palladium|Crude|\bOil\b|Natural Gas|Commodit|Precious|Bitcoin|\bEther\b|Ethereum|Crypto|Copper|Agricultur|黃金|白銀|原油|期貨|比特幣|以太幣|商品/i.test(nm)) return 'commodity';
    if (/^債券型/.test(src) || /^\d{4,5}B$/.test(c) || /債|Bond|Treasury|Treas\b|T-?Bill|Govt|Government|Municipal|\bMuni\b|Aggregate|Corporate|Credit|Fixed Income|TIPS|Floating Rate|Mortgage|\bMBS\b|Duration/i.test(nm)) return 'bond';
    return 'other';
  };
  /** 短天期公債（類現金）：例 SHV、SGOV、BIL */
  LT.isShort = function (a) { return /0-1 Year|0-3 Month|1-3 Month|T-?Bill|Ultra[- ]?Short|Short[- ]Term Treasury|Short Treasury|短期|短天期|0-1年/i.test(String(a.name || '')); };

  /**
   * 資產全貌（3D 圓餅用）：r＝LT.compute 的結果；o：{top: 個別列出的公司數（預設 5）, min: 個別列出的最小占比（預設 0.02）}
   * 回傳 {slices:[{key, name, cls, w, short?, codes?}], cls:{stock,bond,commodity,cash,etfcash,inverse,undec,other}, sum, levExtra}；反向、未拆解、其他各合成一片（codes 列出代號）
   * cls：stock 股票（依公司，投入資金不含槓桿）、bond 債券 ETF、commodity 商品、cash 你輸入的現金、etfcash ETF 內現金等非股票、
   *      inverse 反向 ETF（整檔）、undec 未拆解 ETF、other 其他非股票 ETF
   */
  LT.mix = function (r, o) {
    o = o || {};
    const top = o.top == null ? 5 : o.top, min = o.min == null ? 0.02 : o.min;
    const G = { bond: new Map(), commodity: new Map(), cash: new Map(), inverse: new Map(), undec: new Map(), other: new Map() };
    const put = (g, key, name, w, extra) => { const m = G[g]; const x = m.get(key) || Object.assign({ key, name, w: 0 }, extra || {}); x.w += w; m.set(key, x); };
    let unl = 0, etf = 0;
    (r.assets || []).forEach(a => {
      if (a.status === 'cash') put('cash', a.code, (LT.CASH[a.code] || {}).n || a.name, a.w);
      else if (a.status === 'none') put('undec', a.code, a.name, a.w);
      else if (a.lev < 0) put('inverse', a.code, a.name, a.w);
      else if (a.status === 'nonEq') { const k = LT.kindOf(a); put(k, a.code, a.name, a.w, k === 'bond' ? { short: LT.isShort(a) } : null); }
      else if (a.status === 'lt') { const ne = a.w * (1 - (a.eqSum || 0) / 100); if (a.partial) unl += ne; else etf += ne; }
    });
    const cos = (r.cos || []).filter(c => c.cw > 1e-15).sort((p, q) => q.cw - p.cw || (p.key < q.key ? -1 : 1));
    const slices = [];
    let rest = unl;
    cos.forEach((c, i) => { if (i < top && c.cw >= min) slices.push({ key: c.key, name: c.name || c.key, cls: 'stock', w: c.cw }); else rest += c.cw; });
    if (rest > 1e-12) slices.push({ key: '_stock', name: '其他股票', cls: 'stock', w: rest });
    // 切片順序（相鄰顏色已用色盲模擬驗證）：股票 → 債券 → 現金 → 反向 ETF → ETF 內現金等 → 商品、期貨 → 未拆解 → 其他
    const LBL = { bond: '其他債券', commodity: '其他商品、期貨', cash: '其他現金' };
    const sum = m => [...m.values()].reduce((t, x) => t + x.w, 0);
    const each = g => {   // 債券、現金、商品：2% 以上個別列出，其餘合併
      let small = 0;
      [...G[g].values()].sort((p, q) => q.w - p.w).forEach(x => { if (x.w >= min || g === 'cash') slices.push(Object.assign({ cls: g }, x)); else small += x.w; });
      if (small > 1e-12) slices.push({ key: '_' + g, name: LBL[g], cls: g, w: small });
    };
    const one = (g, name) => { const xs = [...G[g].values()].sort((p, q) => q.w - p.w); if (xs.length) slices.push({ key: '_' + g, name, cls: g, w: sum(G[g]), codes: xs.map(x => x.key) }); };   // 整類一片
    each('bond'); each('cash'); one('inverse', '反向 ETF');
    if (etf > 1e-12) slices.push({ key: '_etfcash', name: 'ETF 內現金等非股票', cls: 'etfcash', w: etf });
    each('commodity'); one('undec', '未拆解 ETF'); one('other', '其他非股票 ETF');
    const cls = { stock: cos.reduce((t, c) => t + c.cw, 0) + unl, bond: sum(G.bond), commodity: sum(G.commodity), cash: sum(G.cash), etfcash: etf, inverse: sum(G.inverse), undec: sum(G.undec), other: sum(G.other) };
    return { slices, cls, sum: slices.reduce((t, x) => t + x.w, 0), levExtra: r.levExtra || 0 };
  };

  /** 摘要：公司家數、前十大合計、最大單一公司 */
  LT.summary = function (r) {
    const pos = r.cos.filter(c => c.w > 0);
    return { n: pos.length, top10: pos.slice(0, 10).reduce((t, c) => t + c.w, 0), top: pos[0] || null, nonEq: r.nonEq, cash: r.cash || 0, unlisted: r.unlisted, levExtra: r.levExtra, stockExp: r.stockExp, undec: r.undec.reduce((t, u) => t + u.w, 0) };
  };

  /** 匯出 CSV（UTF-8 BOM，Excel 開啟不亂碼） */
  LT.csv = function (r) {
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const lines = [['排名', '公司', '代號', '產業', '占總資產(%)', '金額(台幣)', '來源'].map(q).join(',')];
    r.cos.forEach((c, i) => lines.push([i + 1, c.name, c.key, c.sector, (c.w * 100).toFixed(4), r.total ? Math.round(c.w * r.total) : '', Object.entries(c.src).map(([k, w]) => k + ' ' + (w * 100).toFixed(3) + '%').join('；')].map(q).join(',')));
    if (r.unlisted) lines.push(['', '其他小額持股（發行商未逐一列出）', '', '', (r.unlisted * 100).toFixed(4), r.total ? Math.round(r.unlisted * r.total) : '', ''].map(q).join(','));
    Object.entries(r.cashBy || {}).forEach(([k, w]) => lines.push(['', LT.CASH[k].n + '（自行輸入）', k, '', (w * 100).toFixed(4), r.total ? Math.round(w * r.total) : '', '現金不拆解'].map(q).join(',')));
    if (r.nonEq) lines.push(['', '非股票資產（ETF 內的現金、債券等）', '', '', (r.nonEq * 100).toFixed(4), r.total ? Math.round(r.nonEq * r.total) : '', ''].map(q).join(','));
    r.undec.forEach(u => lines.push(['', '未拆解：' + u.name, u.code, '', (u.w * 100).toFixed(4), r.total ? Math.round(u.w * r.total) : '', '成分股資料暫缺'].map(q).join(',')));
    return '﻿' + lines.join('\r\n');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LT;
  else { root.BN = root.BN || {}; root.BN.lt = LT; }
})(typeof window !== 'undefined' ? window : globalThis);
