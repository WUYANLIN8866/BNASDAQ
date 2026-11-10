/* BNASDAQ｜會員專區「我的持有資產」：會員輸入目前持有 → 客製化分析（市值與損益、配置、透視到公司與產業、與策略本月目標的差額）
   資料只存在會員自己的瀏覽器：用「會員主金鑰＋帳號」導出的金鑰以 AES-GCM 加密後存 localStorage，不上傳任何地方；
   換裝置用「匯出備份／匯入備份」（備份檔同樣是加密的，只有同一個帳號登入後匯得進來）。
   價格：投資組合透視的每日價格檔（data/lt/px.json）；美股大型股若熱力圖（data/heatmap/latest.json）的收盤較新就用較新的；QQQ 用 data/market.json。
   計算交給 assets/lt-engine.js（股數模式），每一步都可手算。 */
(function () {
  'use strict';
  const root = document.getElementById('mh'); if (!root || !window.BN || !BN.auth || !BN.lt) return;
  const LT = BN.lt, $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (x, d) => (+x).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const twd = x => (x < 0 ? '−' : '') + nf(Math.abs(Math.round(x))) + ' 元';
  const wan = x => Math.abs(x) >= 1e8 ? nf(x / 1e8, 2) + ' 億' : Math.abs(x) >= 1e4 ? nf(x / 1e4, Math.abs(x) >= 1e6 ? 0 : 1) + ' 萬' : nf(x);
  const pc = (x, d) => (x * 100).toFixed(d == null ? 1 : d) + '%';
  const sg = (x, d) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(d == null ? 2 : d) + '%';
  const qty = v => Number.isInteger(+v) ? nf(v) : nf(v, 4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');   // 100000 → 100,000；1.2500 → 1.25
  const MK = { TW: '上市', TWO: '上櫃', US: '美股' };
  const LONG = { QLD: 'QLD', '00670L': '00670L' }, HEDGE = { SHV: 'SHV' };   // 策略部位：多方＝2 倍那斯達克 100（QLD；台股 00670L 視同）、避險＝SHV
  const sess = BN.auth.session(); if (!sess) return;
  const STORE = 'bn-mh-v1:' + sess.user;
  let U = null, E = new Map(), ALIAS = {}, FX = null, PXD = {}, ASOF = {}, VER = '';
  let st = { rows: [], saved: '' }, targets = window.BN && BN.memberTargets || null, timer = 0;

  // ---------- 加密存取（每個帳號各自的金鑰：SHA-256(用途字串＋帳號＋會員主金鑰)）----------
  async function ukey() {
    const ck = BN.auth.b64.dec(sess.ck), pre = new TextEncoder().encode('bnasdaq-holdings-v1|' + sess.user + '|');
    const buf = new Uint8Array(pre.length + ck.length); buf.set(pre); buf.set(ck, pre.length);
    return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  }
  async function seal(obj) { const e = await BN.auth.aesEnc(await ukey(), new TextEncoder().encode(JSON.stringify(obj))); return { schema: 'bnasdaq-holdings/1', user: sess.user, saved: obj.saved, iv: e.iv, ct: e.ct }; }
  async function open(env) { if (!env || env.schema !== 'bnasdaq-holdings/1') throw new Error('不是持有資產備份檔'); if (env.user !== sess.user) throw new Error('這份備份屬於帳號「' + env.user + '」，請用該帳號登入後匯入'); return JSON.parse(new TextDecoder().decode(await BN.auth.aesDec(await ukey(), env.iv, env.ct))); }
  async function save() {
    st.saved = new Date().toISOString();
    try { localStorage.setItem(STORE, JSON.stringify(await seal({ rows: st.rows.filter(r => String(r.code || '').trim() || +r.v), saved: st.saved }))); $('mh-saved').textContent = '已加密儲存在這個瀏覽器（' + st.saved.replace('T', ' ').slice(0, 16) + ' UTC）'; }
    catch (e) { $('mh-saved').textContent = '這個瀏覽器無法儲存（可能是無痕模式）；請用「匯出備份」保存'; }
  }
  async function restore() {
    try { const raw = localStorage.getItem(STORE); if (raw) { const o = await open(JSON.parse(raw)); st.rows = o.rows || []; st.saved = o.saved || ''; } } catch (e) { $('mh-saved').textContent = '讀取已存的持有失敗：' + (e.message || e); }
    if (!st.rows.length) st.rows = [{ code: '', v: '', cost: '' }, { code: '', v: '', cost: '' }, { code: '', v: '', cost: '' }];
    if (st.saved) $('mh-saved').textContent = '已載入你上次儲存的持有（' + st.saved.replace('T', ' ').slice(0, 16) + ' UTC）';
  }

  // ---------- 資料（與投資組合透視同一份）----------
  async function loadData() {
    if (U) return;
    const [r, q] = await Promise.all([fetch('data/lt/universe.json', { cache: 'no-cache' }), fetch('data/lt/px.json', { cache: 'no-cache' })]);
    if (!r.ok) throw new Error('證券總表讀取失敗（' + r.status + '）');
    const UNI = await r.json(), P = q.ok ? await q.json() : { px: {} };
    VER = P.updated || ''; ASOF = P.asof || {}; FX = (P.fx || {}).USDTWD; ALIAS = UNI.alias || {};
    U = new Map(); UNI.list.forEach(x => U.set(x[0], { n: x[1], m: x[2], k: x[3], s: x[4], lt: x[5], p: (P.px || {})[x[0]] || null }));
    U.forEach((u, c) => { PXD[c] = u.m === 'US' ? (ASOF.US || '') : (ASOF[u.m] || ''); });
    // 較新的美股收盤：熱力圖（指數成分股）、市場資料（QQQ）
    try { const h = await (await fetch('data/heatmap/latest.json', { cache: 'no-cache' })).json(); const seen = new Set();
      Object.values(h.sets || {}).forEach(S => S.tiles.forEach(t => { if (seen.has(t[0]) || t[5] == null) return; seen.add(t[0]); const u = U.get(t[0]); if (u && u.m === 'US' && h.session > (PXD[t[0]] || '')) { u.p = t[5]; PXD[t[0]] = h.session; } })); } catch (e) { /* 沒有就用每日價格檔 */ }
    try { const m = await (await fetch('data/market.json', { cache: 'no-cache' })).json(); const u = U.get('QQQ'); if (u && m.current && m.asof > (PXD.QQQ || '')) { u.p = m.current.c; PXD.QQQ = m.asof; } } catch (e) { }
  }
  async function loadETF(code, depth) {
    if (E.has(code) || (depth || 0) > 2) return;
    const u = U.get(code); if (!u || u.k !== 'E' || !u.lt) { E.set(code, null); return; }
    try { const r = await fetch('data/lt/etf/' + encodeURIComponent(code) + '.json?d=' + encodeURIComponent(VER)); const d = r.ok ? await r.json() : null; E.set(code, d); if (d && d.base) await loadETF(d.base, (depth || 0) + 1); } catch (e) { E.set(code, null); }
  }
  function suggest(q) {
    const s = LT.norm(q), low = String(q || '').trim().toLowerCase(), out = [];
    if (!U || !low) return out;
    if (U.get(s)) out.push([s, U.get(s)]);
    if (/現|金|台幣|美元|美金/.test(low)) Object.entries(LT.CASH).forEach(([c, u]) => out.push([c, u]));
    for (const [c, u] of U) { if (out.length >= 12) break; if (c !== s && c.startsWith(s)) out.push([c, u]); }
    for (const [c, u] of U) { if (out.length >= 30) break; if (!c.startsWith(s) && u.n && u.n.toLowerCase().includes(low)) out.push([c, u]); }
    return out;
  }

  // ---------- 輸入表 ----------
  function drawRows() {
    $('mh-rows').innerHTML = st.rows.map((r, i) => '<tr data-i="' + i + '"><td class="l"><label class="sr-only" for="mc' + i + '">第 ' + (i + 1) + ' 列代號</label><input id="mc' + i + '" class="code" list="mh-list" autocomplete="off" spellcheck="false" placeholder="例：QLD、0050、2330、現金" value="' + esc(r.code) + '"></td>' +
      '<td><label class="sr-only" for="mv' + i + '">股數或金額</label><input id="mv' + i + '" class="v" type="number" inputmode="decimal" min="0" step="any" placeholder="股數（現金填金額）" value="' + esc(r.v) + '"></td>' +
      '<td><label class="sr-only" for="mk' + i + '">平均成本</label><input id="mk' + i + '" class="cost" type="number" inputmode="decimal" min="0" step="any" placeholder="平均成本（選填）" value="' + esc(r.cost || '') + '"></td>' +
      '<td class="l info" id="mi' + i + '"></td><td class="c"><button type="button" class="sm danger del" aria-label="刪除第 ' + (i + 1) + ' 列">刪除</button></td></tr>').join('');
    st.rows.forEach((r, i) => info(i));
  }
  function info(i) {
    const r = st.rows[i], cell = $('mi' + i); if (!cell) return;
    if (!U) { cell.textContent = '載入中…'; return; }
    if (!String(r.code || '').trim()) { cell.textContent = ''; return; }
    const u = LT.resolve(r.code, U);
    if (!u) { cell.innerHTML = '<span class="neg">找不到這個代號</span>'; return; }
    if (u.k === 'C') { cell.innerHTML = '<b>' + esc(u.n) + '</b> <small>填金額' + (u.cur === 'USD' ? '（美元，依匯率 ' + (FX ? nf(FX, 3) : '—') + ' 換算）' : '（元）') + '</small>'; return; }
    cell.innerHTML = '<b>' + esc(u.n) + '</b> <small>' + esc((MK[u.m] || u.m) + (u.k === 'E' ? ' ETF' : '') + '｜' + (u.p ? nf(u.p, u.p < 10 ? 3 : 2) + (u.m === 'US' ? ' 美元' : ' 元') + '（' + (PXD[u.code] || '') + '）' : '沒有價格')) + '</small>';
  }

  // ---------- 分析 ----------
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 300); }
  async function run() {
    await save();
    if (!U) return;
    const rows = st.rows.map(r => ({ code: r.code, v: r.v }));
    const codes = [...new Set(rows.map(r => LT.norm(r.code)).filter(c => U.has(c)))];
    await Promise.all(codes.map(c => loadETF(c)));
    const R = LT.compute(rows, { mode: 'shares', U, E, fx: FX, alias: ALIAS });
    render(R);
  }
  function bars(items, fmt) { // items: [[label, value(0~1), note]]
    const mx = Math.max(1e-9, ...items.map(x => Math.abs(x[1])));
    return '<div class="mh-bars">' + items.map(x => '<div class="mh-bar"><span class="lb">' + esc(x[0]) + '</span><span class="tr"><i style="width:' + (Math.abs(x[1]) / mx * 100).toFixed(1) + '%"></i></span><span class="vv">' + (fmt ? fmt(x[1]) : pc(x[1])) + (x[2] ? ' <small>' + esc(x[2]) + '</small>' : '') + '</span></div>').join('') + '</div>';
  }
  function render(R) {
    const out = $('mh-out');
    const errs = R.errors.map(e => '<p class="msg err">第 ' + (e.row + 1) + ' 列：' + esc(e.msg) + '</p>').join('');
    if (!R.assets.length) { out.innerHTML = errs + '<p class="small">輸入代號與股數後，這裡會出現你的資產分析。</p>'; return; }
    const tot = R.total;
    // 損益（有填平均成本的列）
    let cost = 0, val = 0;
    const lines = R.assets.map(a => {
      const r = st.rows[a.row], c = +r.cost, usd = a.cur === 'USD';
      const pl = a.kind !== 'C' && c > 0 ? (a.px - c) * a.v * (usd ? FX : 1) : null;
      if (pl != null) { cost += c * a.v * (usd ? FX : 1); val += a.value; }
      return { a, c, pl, plp: pl != null ? a.px / c - 1 : null };
    }).sort((p, q) => q.a.value - p.a.value);
    const usdW = R.assets.filter(a => a.cur === 'USD').reduce((t, a) => t + a.w, 0);
    let h = errs + '<div class="kv mh-kv">' +
      '<div class="tile"><div class="k">總市值（台幣）</div><div class="v">' + wan(tot) + '</div><div class="s">' + twd(tot) + '</div></div>' +
      '<div class="tile"><div class="k">未實現損益</div><div class="v ' + (val - cost < 0 ? 'neg' : '') + '">' + (cost ? (val - cost >= 0 ? '+' : '−') + wan(Math.abs(val - cost)) : '—') + '</div><div class="s">' + (cost ? sg(val / cost - 1) + '（有填成本的 ' + lines.filter(x => x.pl != null).length + ' 檔）' : '填平均成本就會計算') + '</div></div>' +
      '<div class="tile"><div class="k">美元資產占比</div><div class="v">' + pc(usdW) + '</div><div class="s">匯率 ' + (FX ? nf(FX, 3) : '—') + ' 元／美元</div></div>' +
      '<div class="tile"><div class="k">現金占比</div><div class="v">' + pc(R.cash) + '</div><div class="s">股票曝險 ' + pc(R.stockExp) + (R.levExtra > 0.0005 ? '（含槓桿額外 ' + pc(R.levExtra) + '）' : '') + '</div></div></div>';
    // 明細
    h += '<h3>持有明細</h3><div class="tblwrap"><table class="tbl"><thead><tr><th class="l">代號</th><th class="l">名稱</th><th>股數／金額</th><th>價格（日期）</th><th>市值（台幣）</th><th>占比</th><th>平均成本</th><th>未實現損益</th></tr></thead><tbody>' +
      lines.map(x => { const a = x.a; return '<tr><td class="l"><b>' + esc(a.code) + '</b></td><td class="l">' + esc(a.name) + '</td><td>' + qty(a.v) + '</td><td>' + (a.kind === 'C' ? '—' : nf(a.px, a.px < 10 ? 3 : 2) + (a.cur === 'USD' ? ' 美元' : ' 元') + '<br><small>' + esc(PXD[a.code] || '') + '</small>') + '</td><td>' + twd(a.value) + '</td><td>' + pc(a.w) + '</td><td>' + (x.c > 0 ? nf(x.c, 2) : '—') + '</td><td class="' + (x.pl > 0 ? 'pos' : x.pl < 0 ? 'neg' : '') + '">' + (x.pl == null ? '—' : (x.pl >= 0 ? '+' : '−') + nf(Math.abs(Math.round(x.pl))) + '<br><small>' + sg(x.plp) + '</small>') + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
    // 配置
    h += '<div class="mh-two"><div><h3>資產配置</h3>' + bars(lines.map(x => [x.a.code, x.a.w, ''])) + '</div>';
    // 透視
    const top = R.cos.filter(c => c.w > 0).slice(0, 10);
    h += '<div><h3>透視：實際持有的前 10 大公司</h3>' + (top.length ? bars(top.map(c => [c.key + ' ' + (c.name || ''), c.w, ''])) : '<p class="small">沒有可拆解的股票部位。</p>') + '</div></div>';
    h += '<div class="mh-two"><div><h3>產業分布（股票曝險）</h3>' + (R.sectors.length ? bars(R.sectors.slice(0, 11).map(s => [s[0], s[1], ''])) : '<p class="small">—</p>') + '</div>';
    // 策略對照
    h += '<div><h3>' + (targets && targets.list && targets.list.length ? '和 ' + targets.list.map(t => esc(t.id)).join('、') + ' 本月目標比較' : '和策略本月目標比較') + '</h3>' + strategy(R) + '</div></div>';
    h += '<p class="small">說明：價格為各市場最近收盤（美股大型股用最新交易日收盤，其餘用每日價格檔），日期列在價格下方；ETF 依發行商公布的持股拆解，槓桿 ETF 依倍數放大。以上為依你輸入的數字所做的計算，不構成投資建議。</p>';
    out.innerHTML = h;
  }
  function strategy(R) {
    const L = R.assets.filter(a => LONG[a.code]), H = R.assets.filter(a => HEDGE[a.code]);
    const lv = L.reduce((t, a) => t + a.value, 0), hv = H.reduce((t, a) => t + a.value, 0), sl = lv + hv;
    if (!sl) return '<p class="small">你的持有中沒有策略使用的商品（多方 QLD 或台股 00670L、避險 SHV），所以不計算差額。</p>';
    if (!targets) return '<p class="small">策略部位（' + [...L, ...H].map(a => a.code).join('、') + '）共 ' + twd(sl) + '，其中多方 ' + pc(lv / sl) + '。會員規則載入後，這裡會算出和本月目標的差額。</p>';
    const ref = L.find(a => a.code === 'QLD') || L[0] || null, refPx = ref ? ref.px * (ref.cur === 'USD' ? FX : 1) : (U.get('QLD') && U.get('QLD').p ? U.get('QLD').p * FX : null), refCode = ref ? ref.code : 'QLD';
    let h = '<p class="small">策略部位＝' + [...L, ...H].map(a => a.code).join('＋') + '，共 ' + twd(sl) + '；目前多方 ' + pc(lv / sl) + '、避險 ' + pc(hv / sl) + '（' + esc(targets.month) + ' 持有）。</p><div class="tblwrap"><table class="tbl"><thead><tr><th class="l">策略</th><th class="l">本月目標</th><th>多方應有</th><th>多方目前</th><th>差額</th></tr></thead><tbody>';
    targets.list.forEach(t => { const want = t.w * sl, d = want - lv, sh = refPx ? d / refPx : null;
      h += '<tr><td class="l"><b>' + esc(t.id) + '</b></td><td class="l">' + esc(t.text) + '</td><td>' + twd(want) + '</td><td>' + twd(lv) + '</td><td class="' + (Math.abs(d) < 1 ? '' : d > 0 ? 'pos' : 'neg') + '">' + (Math.abs(d) < 1 ? '已一致' : (d > 0 ? '多方增加 ' : '多方減少 ') + twd(Math.abs(d)) + (sh ? '<br><small>約 ' + nf(Math.abs(sh), 1) + ' 股 ' + esc(refCode) + '</small>' : '')) + '</td></tr>'; });
    return h + '</tbody></table></div><p class="small">差額＝本月目標多方比例 × 策略部位總額 − 目前多方市值；只是依策略規則的數學換算，不是投資建議。</p>';
  }

  // ---------- 事件 ----------
  function bind() {
    $('mh-rows').addEventListener('input', e => { const tr = e.target.closest('tr'); if (!tr) return; const i = +tr.dataset.i, r = st.rows[i];
      if (e.target.classList.contains('code')) { r.code = e.target.value; const dl = $('mh-list'); dl.innerHTML = suggest(e.target.value).map(([c, u]) => '<option value="' + esc(c) + '">' + esc(u.n + '｜' + (u.k === 'C' ? '現金' : (MK[u.m] || u.m) + (u.k === 'E' ? ' ETF' : ''))) + '</option>').join(''); info(i); }
      else if (e.target.classList.contains('v')) r.v = e.target.value; else if (e.target.classList.contains('cost')) r.cost = e.target.value;
      schedule(); });
    $('mh-rows').addEventListener('click', e => { const b = e.target.closest('.del'); if (!b) return; st.rows.splice(+b.closest('tr').dataset.i, 1); if (!st.rows.length) st.rows.push({ code: '', v: '', cost: '' }); drawRows(); schedule(); });
    $('mh-add').addEventListener('click', () => { st.rows.push({ code: '', v: '', cost: '' }); drawRows(); const c = $('mc' + (st.rows.length - 1)); if (c) c.focus(); });
    $('mh-clear').addEventListener('click', () => { if (!confirm('清空這個瀏覽器裡儲存的持有資產？（建議先匯出備份）')) return; st.rows = [{ code: '', v: '', cost: '' }]; try { localStorage.removeItem(STORE); } catch (e) { } drawRows(); run(); });
    $('mh-export').addEventListener('click', async () => { const env = await seal({ rows: st.rows.filter(r => String(r.code || '').trim()), saved: new Date().toISOString() });
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(env)], { type: 'application/json' })); a.download = 'BNASDAQ-holdings-' + sess.user.replace(/[^A-Za-z0-9_.-]/g, '_') + '-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); });
    $('mh-import').addEventListener('change', async e => { const f = e.target.files && e.target.files[0]; if (!f) return;
      try { const o = await open(JSON.parse(await f.text())); st.rows = o.rows && o.rows.length ? o.rows : st.rows; drawRows(); await run(); $('mh-saved').textContent = '已匯入備份（' + (o.saved || '').replace('T', ' ').slice(0, 16) + ' UTC 的版本）並加密儲存'; }
      catch (err) { alert('匯入失敗：' + (err.message || err)); } e.target.value = ''; });
    document.addEventListener('bn:targets', e => { targets = e.detail; run(); });
  }
  (async function init() {
    await restore(); drawRows(); bind();
    try { await loadData(); st.rows.forEach((r, i) => info(i)); await run(); }
    catch (e) { $('mh-out').innerHTML = '<p class="msg err">資料載入失敗：' + esc(e.message || e) + '</p>'; }
  })();
})();
