/* BNASDAQ｜持有資產共用核心：會員專區（assets/mh.js）、每日市場分析「你的資產變化」（assets/mychange.js）、
   公開的投資組合透視（assets/lt-ui.js，只用價格部分）共用同一套。
   加密（只有會員頁用，需要 assets/auth.js）：每個帳號的金鑰＝SHA-256('bnasdaq-holdings-v1|' + 帳號 + '|' + 會員主金鑰)，AES-GCM；只存在這個瀏覽器（localStorage 'bn-mh-v1:' + 帳號），不上傳。
   價格：每一檔取「日期最新」的來源，並記下同一來源的前一個交易日收盤（算每日變化用）——
     data/lt/px.json（投資組合透視每日價格，只有最新價；Nasdaq 擋線時美股會停在舊日期，例如 11/11 起停在 11/06）
     data/tw/latest.json（台股官方收盤，證交所延遲時 Yahoo 補位；美股 Yahoo；只收已收盤的交易日；附漲跌）
     data/heatmap/latest.json（指數成分股收盤＋漲跌%）、data/market.json（QQQ 本月每日收盤）
   「不列入計算」的列（row.off）在 rows() 會換成空白列：引擎略過它，列號不變。計算交給 assets/lt-engine.js（股數模式）。 */
(function () {
  'use strict';
  if (!window.BN || !BN.lt) return;   // BN.auth 只有加密函式用到（會員頁才載入）
  const LT = BN.lt, C = {}, enc = new TextEncoder(), dec = new TextDecoder();
  C.store = user => 'bn-mh-v1:' + user;
  C.ukey = async sess => {
    const ck = BN.auth.b64.dec(sess.ck), pre = enc.encode('bnasdaq-holdings-v1|' + sess.user + '|');
    const buf = new Uint8Array(pre.length + ck.length); buf.set(pre); buf.set(ck, pre.length);
    return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  };
  C.seal = async (sess, obj) => { const e = await BN.auth.aesEnc(await C.ukey(sess), enc.encode(JSON.stringify(obj))); return { schema: 'bnasdaq-holdings/1', user: sess.user, saved: obj.saved, iv: e.iv, ct: e.ct }; };
  C.open = async (sess, env) => {
    if (!env || env.schema !== 'bnasdaq-holdings/1') throw new Error('不是持有資產備份檔');
    if (env.user !== sess.user) throw new Error('這份備份屬於帳號「' + env.user + '」，請用該帳號登入後匯入');
    return JSON.parse(dec.decode(await BN.auth.aesDec(await C.ukey(sess), env.iv, env.ct)));
  };
  C.load = async sess => { const raw = localStorage.getItem(C.store(sess.user)); return raw ? C.open(sess, JSON.parse(raw)) : null; };

  // ---------- 價格（每檔取日期最新的來源）----------
  let D = null;
  const getJ = async u => { try { const r = await fetch(u, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  C.data = async () => {
    if (D) return D;
    const [UNI, P, L, H, M] = await Promise.all(['data/lt/universe.json', 'data/lt/px.json', 'data/tw/latest.json', 'data/heatmap/latest.json', 'data/market.json'].map(getJ));
    if (!UNI) throw new Error('證券總表讀取失敗');
    const U = new Map(), A = (P && P.asof) || {}, PX = (P && P.px) || {};
    UNI.list.forEach(x => U.set(x[0], { code: x[0], n: x[1], m: x[2], k: x[3], s: x[4], lt: x[5], p: PX[x[0]] || null,
      d: x[2] === 'US' ? (x[3] === 'E' ? String(A.USETF || A.US || '').slice(0, 10) : (A.US || '')) : (A[x[2]] || ''), pp: null,
      src: x[2] === 'US' ? 'Nasdaq 篩選器快照價' : '證交所／櫃買中心收盤', pr: 0 }));
    // 日期較新才換；同一天時換成可信度較高的來源（熱力圖、QQQ 檔是收盤後才抓的正式收盤 > 最新收盤檔 > 價格檔）
    const take = (code, d, p, pp, src, pr) => {
      const u = U.get(code); if (!u || !(p > 0) || !d) return;
      if (d > (u.d || '') || (d === u.d && pr > (u.pr || 0))) { u.p = p; u.d = d; u.pp = pp > 0 ? pp : null; u.src = src; u.pr = pr; }
    };
    // 最新收盤檔：舊版程式曾在美股盤中抓價（11/11 台北 23:05），更新時間早於該日美股收盤（約 21:10 UTC）的美股資料不用
    const usOk = L && L.asof && L.asof.US && L.updated && Date.parse(L.updated) >= Date.parse(L.asof.US + 'T21:10:00Z');
    if (L && L.items) Object.entries(L.items).forEach(([c, v]) => { const mk = v[3] || 'TW'; if (mk === 'US' && !usOk) return; take(c, (L.asof || {})[mk], v[0], v[1] != null ? v[0] - v[1] : null, mk === 'US' ? 'Yahoo 收盤' : '證交所／櫃買中心收盤', 1); });
    if (H && H.sets) Object.values(H.sets).forEach(S => (S.tiles || []).forEach(t => { if (t[5] != null) take(t[0], S.session || H.session, t[5], t[4] != null ? t[5] / (1 + t[4] / 100) : null, '收盤（熱力圖）', 2); }));
    if (M && M.current && M.current.daily && M.current.daily.length) { const dd = M.current.daily, a = dd[dd.length - 1], b = dd[dd.length - 2]; take('QQQ', a.d, a.c, b ? b.c : null, 'Yahoo 收盤', 2); }
    // 匯率：取日期最新；前一日匯率（算美元資產的台幣變化）只有最新收盤檔有
    const fp = (P && P.fx) || {}, fl = (L && L.fx) || {};
    const FX = (fl.date || '') >= (fp.date || '') && fl.rate ? { rate: fl.rate, date: fl.date, prev: fl.chg != null ? fl.rate - fl.chg : null, src: fl.source || 'Yahoo' }
      : { rate: fp.USDTWD, date: fp.date, prev: null, src: fp.source || '' };
    D = { U, ALIAS: UNI.alias || {}, FX, E: new Map(), VER: (P && P.updated) || '', UNI, PX: P || {} };
    return D;
  };
  C.etf = async function etf(code, depth) {
    const d = await C.data();
    if (d.E.has(code) || (depth || 0) > 2) return;
    const u = d.U.get(code); if (!u || u.k !== 'E' || !u.lt) { d.E.set(code, null); return; }
    try { const r = await fetch('data/lt/etf/' + encodeURIComponent(code) + '.json?d=' + encodeURIComponent(d.VER)); const j = r.ok ? await r.json() : null; d.E.set(code, j); if (j && j.base) await etf(j.base, (depth || 0) + 1); }
    catch (e) { d.E.set(code, null); }
  };
  // 輸入列 → 引擎用的列（不列入計算的換成空白列，列號不變）
  C.rows = rows => (rows || []).map(r => r.off ? { code: '', v: '' } : { code: r.code, v: r.v });
  C.compute = async rows => {
    const d = await C.data(), rs = C.rows(rows);
    const codes = [...new Set(rs.map(r => LT.norm(r.code)).filter(c => d.U.has(c)))];
    await Promise.all(codes.map(c => C.etf(c)));
    return LT.compute(rs, { mode: 'shares', U: d.U, E: d.E, fx: d.FX.rate, alias: d.ALIAS });
  };
  window.BN.mh = C;
})();
