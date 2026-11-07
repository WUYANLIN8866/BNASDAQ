/* BNASDAQ｜投資組合透視：頁面互動（讀 data/lt/*.json；計算交給 assets/lt-engine.js）
   全部在瀏覽器計算，持有資料不上傳；瀏覽器只記住上次輸入（localStorage，可清除）。 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const LT = BN.lt;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x, d) => (x * 100).toFixed(d == null ? 2 : d) + '%';
  const nf = (x, d) => (+x).toLocaleString('zh-Hant-TW', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const money = x => Math.abs(x) >= 1e8 ? nf(x / 1e8, 2) + ' 億' : Math.abs(x) >= 1e4 ? nf(x / 1e4, Math.abs(x) >= 1e6 ? 0 : 1) + ' 萬' : nf(x);
  const MK = { TW: '上市', TWO: '上櫃', US: '美股' };
  const KEY = 'bn-lt-v1';
  const EX = [
    { t: '台美核心', m: 'pct', r: [['0050', 40], ['VOO', 40], ['QQQ', 20]] },
    { t: '0050＋QQQ 各半', m: 'pct', r: [['0050', 50], ['QQQ', 50]] },
    { t: '半導體雙雄', m: 'pct', r: [['SOXX', 50], ['SMH', 50]] },
    { t: '全球一檔', m: 'pct', r: [['VT', 100]] },
    { t: '槓桿＋短債', m: 'pct', r: [['QLD', 50], ['SHV', 50]] }
  ];
  let U = null, UNI = null, ALIAS = {}, FX = null, META = null, VER = '';
  const E = new Map();
  let st = { mode: 'pct', rows: [], total: '' }, last = null, showAll = false;

  // ---------------- 資料 ----------------
  async function loadUniverse() {
    if (U) return;
    const r = await fetch('data/lt/universe.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('證券總表讀取失敗（' + r.status + '）');
    UNI = await r.json();
    const q = await fetch('data/lt/px.json', { cache: 'no-cache' }); const P = q.ok ? await q.json() : { px: {} };
    VER = P.updated || ''; UNI.asof = P.asof || {}; UNI.fx = P.fx || {};
    U = new Map(); ALIAS = UNI.alias || {}; FX = UNI.fx && UNI.fx.USDTWD;
    UNI.list.forEach(x => U.set(x[0], { n: x[1], m: x[2], k: x[3], s: x[4], lt: x[5], p: (P.px || {})[x[0]] || null }));
    try { const m = await fetch('data/lt/meta.json?d=' + encodeURIComponent(VER)); if (m.ok) META = await m.json(); } catch (e) { META = null; }
  }
  async function loadETF(code, depth) {
    if (E.has(code) || (depth || 0) > 2) return;
    const u = U.get(code);
    if (!u || u.k !== 'E' || !u.lt) { E.set(code, null); return; }
    try {
      const r = await fetch('data/lt/etf/' + encodeURIComponent(code) + '.json?d=' + encodeURIComponent(VER));
      const d = r.ok ? await r.json() : null; E.set(code, d);
      if (d && d.base) await loadETF(d.base, (depth || 0) + 1);
    } catch (e) { E.set(code, null); }
  }

  // ---------------- 搜尋建議 ----------------
  function suggest(q) {
    const s = LT.norm(q), low = String(q || '').trim().toLowerCase(), out = [];
    if (!U || !low) return out;
    const exact = U.get(s); if (exact) out.push([s, exact]);
    for (const [c, u] of U) { if (out.length >= 12) break; if (c !== s && c.startsWith(s)) out.push([c, u]); }
    if (out.length < 30 && low.length >= 1) for (const [c, u] of U) { if (out.length >= 30) break; if (!c.startsWith(s) && u.n && u.n.toLowerCase().includes(low)) out.push([c, u]); }
    return out;
  }
  function fillList(q) {
    const dl = $('ltlist'); dl.innerHTML = suggest(q).map(([c, u]) => '<option value="' + esc(c) + '">' + esc(u.n + '｜' + (MK[u.m] || u.m) + (u.k === 'E' ? ' ETF' : '') + (u.k === 'E' ? (u.lt ? '' : '（暫不支援拆解）') : '')) + '</option>').join('');
  }

  // ---------------- 狀態保存 ----------------
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 無痕模式等情況略過 */ }
    const p = st.rows.filter(r => r.code).map(r => LT.norm(r.code) + ':' + (+r.v || 0) + (r.px ? '@' + r.px : '')).join(',');
    history.replaceState(null, '', '#p=' + encodeURIComponent(p) + '&m=' + st.mode + (st.total ? '&t=' + st.total : ''));
  }
  function restore() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('p')) {
      st.mode = h.get('m') === 'shares' ? 'shares' : 'pct'; st.total = h.get('t') || '';
      st.rows = decodeURIComponent(h.get('p')).split(',').filter(Boolean).map(x => { const m = x.match(/^([^:]+):([\d.]+)(?:@([\d.]+))?$/); return m ? { code: m[1], v: m[2], px: m[3] || '' } : null; }).filter(Boolean);
      if (st.rows.length) return;
    }
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.rows && s.rows.length) { st = Object.assign(st, s); return; } } catch (e) { /* 略過 */ }
    st.rows = EX[0].r.map(([c, v]) => ({ code: c, v: String(v), px: '' }));
  }

  // ---------------- 輸入表 ----------------
  function drawRows() {
    $('vHead').textContent = st.mode === 'shares' ? '股數' : '比例（%）';
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === st.mode)));
    $('ltTotalWrap').hidden = st.mode === 'shares';
    $('ltRows').classList.toggle('shares', st.mode === 'shares');
    $('rows').innerHTML = st.rows.map((r, i) => '<tr data-i="' + i + '"><td class="l"><label class="sr-only" for="c' + i + '">第 ' + (i + 1) + ' 列代號</label><input id="c' + i + '" class="code" list="ltlist" autocomplete="off" spellcheck="false" placeholder="例：0050、QQQ、台積電" value="' + esc(r.code) + '"></td>' +
      '<td><label class="sr-only" for="v' + i + '">' + (st.mode === 'shares' ? '股數' : '比例') + '</label><input id="v' + i + '" class="v" type="number" inputmode="decimal" min="0" step="any" value="' + esc(r.v) + '"></td>' +
      '<td class="pxc"><label class="sr-only" for="p' + i + '">價格</label><input id="p' + i + '" class="px" type="number" inputmode="decimal" min="0" step="any" placeholder="自動" value="' + esc(r.px || '') + '"></td>' +
      '<td class="l info" id="i' + i + '"></td><td class="c"><button type="button" class="sm danger del" aria-label="刪除第 ' + (i + 1) + ' 列">刪除</button></td></tr>').join('');
    st.rows.forEach((r, i) => info(i));
  }
  function info(i) {
    const r = st.rows[i], cell = $('i' + i); if (!cell) return;
    if (!U) { cell.textContent = '載入中…'; return; }
    if (!String(r.code || '').trim()) { cell.textContent = ''; return; }
    const c = LT.norm(r.code), u = U.get(c);
    if (!u) { cell.innerHTML = '<span class="neg">找不到這個代號</span>'; return; }
    const tag = u.k === 'E' ? (u.lt ? '<span class="lt-tag ok">可拆解</span>' : '<span class="lt-tag">暫不支援拆解</span>') : '<span class="lt-tag">個股</span>';
    const px = u.p ? (u.m === 'US' ? '快照價 ' : '收盤 ') + nf(u.p, u.p < 10 ? 3 : 2) + (u.m === 'US' ? ' 美元' : ' 元') : '無價格';
    cell.innerHTML = '<b>' + esc(u.n) + '</b> <small>' + esc((MK[u.m] || u.m) + (u.k === 'E' ? ' ETF' : '') + '｜' + px) + '</small> ' + tag;
  }

  // ---------------- 計算與輸出 ----------------
  let timer = 0;
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 250); }
  async function run() {
    save();
    if (!U) return;
    const codes = [...new Set(st.rows.map(r => LT.norm(r.code)).filter(c => U.has(c)))];
    await Promise.all(codes.map(c => loadETF(c)));
    const r = LT.compute(st.rows, { mode: st.mode, U, E, fx: FX, alias: ALIAS, total: st.mode === 'pct' ? +st.total || 0 : 0 });
    last = r; render(r);
  }
  function render(r) {
    const msgs = r.errors.map(e => '<p class="msg err">第 ' + (e.row + 1) + ' 列：' + esc(e.msg) + '</p>').concat(r.warnings.map(w => '<p class="msg info">' + esc(w) + '</p>'));
    $('ltMsg').innerHTML = msgs.join('');
    const out = $('ltOut');
    if (!r.assets.length) { out.hidden = true; return; }
    out.hidden = false;
    const S = LT.summary(r);
    let k = '<div class="kv">' +
      tile('公司家數', nf(S.n) + ' 家', '拆解後實際持有的公司') +
      tile('前十大合計', pct(S.top10, 1), '前 10 家公司占總資產') +
      tile('最大單一公司', S.top ? pct(S.top.w, 1) : '—', S.top ? S.top.name + '（' + S.top.key + '）' : '') +
      tile('非股票資產', pct(S.nonEq, 1), '現金、債券等不屬於任何公司的部分');
    if (Math.abs(S.levExtra) > 1e-9) k += tile('股票曝險合計', pct(S.stockExp, 1), '含槓桿 ETF 多出的 ' + pct(S.levExtra, 1) + '（反向 ETF 為負）');
    if (S.unlisted > 1e-9) k += tile('其他小額持股', pct(S.unlisted, 1), '發行商資料未逐一列出的小額股票');
    if (S.undec > 0) k += tile('未拆解資產', pct(S.undec, 1), '成分股資料暫缺的 ETF，以整檔列出');
    if (r.total) k += tile('總金額（台幣）', money(r.total), st.mode === 'shares' ? '股數 × 價格' + (FX ? '（美元 × ' + nf(FX, 3) + '）' : '') : '依輸入的總金額');
    $('ltKv').innerHTML = k + '</div>';
    const top = r.cos.filter(c => c.w > 0).slice(0, 15);
    $('fTop').innerHTML = ''; $('fSec').innerHTML = '';
    const W = Math.max(340, Math.min(820, ($('fTop').clientWidth || 820) - 34)), narrow = W < 560;
    if (top.length) BN.charts.hbars($('fTop'), { title: '前 15 大公司（占總資產）', sub: '同一家公司在不同 ETF 與個股的持有已合併', items: top.map(c => ({ name: short(c.name, narrow ? 12 : 22), value: c.w * 100, color: 'var(--s-fund)' })), fmt: v => v.toFixed(2) + '%', labelW: narrow ? 118 : 170, padR: narrow ? 64 : 120, rowH: narrow ? 30 : 34, W });
    const secs = r.sectors.filter(s => s[1] > 0).slice(0, 12);
    if (secs.length) BN.charts.hbars($('fSec'), { title: '產業分布（占總資產）', sub: '依各公司所屬產業加總；非股票資產不列入', items: secs.map(s => ({ name: s[0], value: s[1] * 100, color: 'var(--s-qld)' })), fmt: v => v.toFixed(1) + '%', labelW: narrow ? 80 : 110, padR: narrow ? 56 : 120, rowH: narrow ? 30 : 34, W });
    table(r); overlap(r); sources(r);
  }
  const SUF = /[,\s]+(Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Company|Ltd\.?|Limited|plc|PLC|N\.?V\.?|S\.?A\.?|AG|SE|Holdings?|Group|Class [A-C]|Cl [A-C]|CL [A-C]|ADR|The)$/i;
  const short = (s, n) => { s = String(s || '').trim(); let t; do { t = s; s = s.replace(SUF, '').trim(); } while (s !== t && s.length > 3); n = n || 22; return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const tile = (k, v, s) => '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>';
  function table(r) {
    const list = showAll ? r.cos : r.cos.slice(0, 50);
    let h = '<div class="tblwrap"><table class="tbl lt-tbl"><caption>完整明細：共 ' + nf(r.cos.length) + ' 家公司' + (r.cos.length > 50 && !showAll ? '（先列前 50 家）' : '') + '</caption><thead><tr><th class="c">排名</th><th class="l">公司</th><th class="l">代號</th><th class="l">產業</th><th>占總資產</th>' + (r.total ? '<th>金額（台幣）</th>' : '') + '<th class="l">來源（各自貢獻）</th></tr></thead><tbody>';
    list.forEach((c, i) => {
      const src = Object.entries(c.src).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).map(([k, w]) => esc(k) + ' ' + pct(w, 2)).join('、');
      h += '<tr><td class="c">' + (i + 1) + '</td><td class="l">' + esc(c.name) + '</td><td class="l">' + esc(c.key.startsWith('X:') ? c.key.slice(2) : c.key) + '</td><td class="l">' + esc(c.sector || '未分類') + '</td><td' + (c.w < 0 ? ' class="neg"' : '') + '>' + pct(c.w, 3) + '</td>' + (r.total ? '<td>' + nf(Math.round(c.w * r.total)) + '</td>' : '') + '<td class="l small">' + src + '</td></tr>';
    });
    if (r.unlisted) h += '<tr class="hl"><td></td><td class="l">其他小額持股（發行商未逐一列出）</td><td></td><td></td><td>' + pct(r.unlisted, 3) + '</td>' + (r.total ? '<td>' + nf(Math.round(r.unlisted * r.total)) + '</td>' : '') + '<td></td></tr>';
    if (r.nonEq) h += '<tr class="hl"><td></td><td class="l">非股票資產（現金、債券等）</td><td></td><td></td><td>' + pct(r.nonEq, 3) + '</td>' + (r.total ? '<td>' + nf(Math.round(r.nonEq * r.total)) + '</td>' : '') + '<td></td></tr>';
    r.undec.forEach(u => { h += '<tr class="hl"><td></td><td class="l">未拆解：' + esc(u.name) + '</td><td class="l">' + esc(u.code) + '</td><td></td><td>' + pct(u.w, 3) + '</td>' + (r.total ? '<td>' + nf(Math.round(u.w * r.total)) + '</td>' : '') + '<td class="l small">成分股資料暫缺</td></tr>'; });
    h += '</tbody></table></div>';
    if (r.cos.length > 50) h += '<p><button type="button" class="btn line" id="ltAll">' + (showAll ? '只看前 50 家' : '顯示全部 ' + nf(r.cos.length) + ' 家') + '</button></p>';
    $('ltTbl').innerHTML = h;
    const b = $('ltAll'); if (b) b.onclick = () => { showAll = !showAll; table(last); };
  }
  function overlap(r) {
    const box = $('ltOv');
    if (!r.overlap.length) { box.innerHTML = '<p class="small muted">輸入兩檔以上可拆解的 ETF，才會計算重疊度。</p>'; return; }
    const rows = r.overlap.slice().sort((p, q) => q[2] - p[2]);
    box.innerHTML = '<div class="tblwrap"><table class="tbl"><thead><tr><th class="l">ETF 組合</th><th>重疊度</th><th class="l">意思</th></tr></thead><tbody>' + rows.map(o => '<tr><td class="l">' + esc(o[0]) + ' × ' + esc(o[1]) + '</td><td>' + pct(o[2], 1) + '</td><td class="l small">兩檔各自的持股權重，取同一家公司較小者加總</td></tr>').join('') + '</tbody></table></div>';
  }
  function sources(r) {
    const how = a => a.status === 'stock' ? '個股本身' : a.status === 'none' ? '暫不支援拆解（以整檔列出）' : a.status === 'nonEq' ? '非股票（債券／現金）' : a.base ? '以 ' + a.base + ' 成分股 × ' + a.lev + ' 推算' : '發行商公布的成分股';
    const etfs = r.assets.map(a => { const d = E.get(a.code); return '<tr><td class="l">' + esc(a.code) + '</td><td class="l">' + esc(a.name) + '</td><td>' + pct(a.w, 2) + '</td><td class="l">' + esc(how(a)) + '</td><td class="l">' + esc(a.asof || (d && d.asof) || '—') + '</td><td class="l small">' + esc((d && (d.note || d.src)) || (a.status === 'stock' ? (a.market === 'US' ? 'Nasdaq 篩選器快照價' : '證交所／櫃買中心收盤價') : '—')) + '</td></tr>'; }).join('');
    $('ltSrc').innerHTML = '<div class="tblwrap"><table class="tbl"><thead><tr><th class="l">代號</th><th class="l">名稱</th><th>資產占比</th><th class="l">拆解方式</th><th class="l">成分股資料日</th><th class="l">來源</th></tr></thead><tbody>' + etfs + '</tbody></table></div>' +
      '<p class="small">價格日期：台股上市 ' + esc((UNI.asof || {}).TW || '—') + '、上櫃 ' + esc((UNI.asof || {}).TWO || '—') + '（證交所／櫃買中心收盤價）；美股 ' + esc((UNI.asof || {}).US || '—') + '（Nasdaq 篩選器快照價' + ((UNI.asof || {}).USETF ? '，ETF 為美東時間 ' + esc(UNI.asof.USETF) : '') + '；接近收盤，不一定是正式收盤價）；美元兌台幣 ' + (FX ? nf(FX, 3) : '—') + '（' + esc((UNI.fx || {}).date || '') + '）。資料更新：' + esc(VER) + '。</p>';
  }
  function csv() {
    if (!last) return;
    const b = new Blob([LT.csv(last)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = '投資組合透視_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------------- 事件 ----------------
  function bind() {
    $('rows').addEventListener('input', e => {
      const tr = e.target.closest('tr'); if (!tr) return; const i = +tr.dataset.i, r = st.rows[i];
      if (e.target.classList.contains('code')) { r.code = e.target.value; fillList(e.target.value); info(i); }
      else if (e.target.classList.contains('v')) r.v = e.target.value;
      else if (e.target.classList.contains('px')) r.px = e.target.value;
      schedule();
    });
    $('rows').addEventListener('focusin', e => { if (e.target.classList.contains('code')) fillList(e.target.value); });
    $('rows').addEventListener('click', e => { if (!e.target.classList.contains('del')) return; st.rows.splice(+e.target.closest('tr').dataset.i, 1); if (!st.rows.length) st.rows.push({ code: '', v: '', px: '' }); drawRows(); schedule(); });
    $('ltAdd').onclick = () => { st.rows.push({ code: '', v: '', px: '' }); drawRows(); const n = $('c' + (st.rows.length - 1)); if (n) n.focus(); };
    $('ltClear').onclick = () => { st.rows = [{ code: '', v: '', px: '' }]; st.total = ''; $('ltTotal').value = ''; drawRows(); schedule(); };
    document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (st.mode === b.dataset.mode) return; st.mode = b.dataset.mode; drawRows(); schedule(); });
    $('ltTotal').addEventListener('input', e => { st.total = e.target.value; schedule(); });
    $('ltCsv').onclick = csv;
    $('ltShare').onclick = async () => { save(); try { await navigator.clipboard.writeText(location.href); $('ltShare').textContent = '已複製連結'; } catch (e) { $('ltShare').textContent = '請複製網址列'; } setTimeout(() => { $('ltShare').textContent = '複製分享連結'; }, 2000); };
    $('ltEx').innerHTML = EX.map((x, i) => '<button type="button" class="chip-btn" data-ex="' + i + '">' + esc(x.t) + '</button>').join('');
    $('ltEx').onclick = e => { const b = e.target.closest('[data-ex]'); if (!b) return; const x = EX[+b.dataset.ex]; st.mode = x.m; st.rows = x.r.map(([c, v]) => ({ code: c, v: String(v), px: '' })); drawRows(); run(); };
  }

  async function init() {
    restore(); $('ltTotal').value = st.total || ''; drawRows(); bind();
    try {
      await loadUniverse(); st.rows.forEach((r, i) => info(i));
      if (META && META.coverage) $('ltCov').textContent = '目前可拆解：美股 ETF ' + nf(META.coverage.US[0]) + ' 檔、台股 ETF ' + nf(META.coverage.TW[0]) + ' 檔（含槓桿／同指數推算與債券型）；全部 ' + nf(UNI.list.length) + ' 檔台美股票與 ETF 都能輸入。';
      await run();
    } catch (e) { $('ltMsg').innerHTML = '<p class="msg err">' + esc(e.message || e) + '</p>'; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
