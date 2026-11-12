/* BNASDAQ｜會員專區「會員持有資產」：會員輸入目前持有 → 客製化分析（市值與損益、資產配置、資產全貌、透視到公司與產業、與策略本月目標的差額）
   加密存取、價格（每檔取日期最新的來源，含前一交易日收盤）與計算都在 assets/mh-core.js——每日市場分析的「你的資產變化」用同一套。
   每一列有「不列入計算」開關：打開的列仍加密保存，但下方所有計算（含每日市場分析）都略過它。
   輸入表可收起（<details>），收合狀態記在這個瀏覽器。計算交給 assets/lt-engine.js（股數模式），每一步都可手算。 */
(function () {
  'use strict';
  const root = document.getElementById('mh'); if (!root || !window.BN || !BN.auth || !BN.lt || !BN.mh) return;
  const LT = BN.lt, MH = BN.mh, $ = id => document.getElementById(id);
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
  const STORE = MH.store(sess.user), UIKEY = 'bn-mh-ui:' + sess.user;
  let U = null, FX = null, st = { rows: [], saved: '' }, targets = window.BN && BN.memberTargets || null, timer = 0;
  const blank = () => ({ code: '', v: '', cost: '' });
  const filled = r => !!String(r.code || '').trim();

  // ---------- 加密存取（mh-core.js）----------
  async function save() {
    st.saved = new Date().toISOString();
    try { localStorage.setItem(STORE, JSON.stringify(await MH.seal(sess, { rows: st.rows.filter(r => filled(r) || +r.v), saved: st.saved }))); $('mh-saved').textContent = '已加密儲存在這個瀏覽器（' + st.saved.replace('T', ' ').slice(0, 16) + ' UTC）'; }
    catch (e) { $('mh-saved').textContent = '這個瀏覽器無法儲存（可能是無痕模式）；請用「匯出備份」保存'; }
    sumText();
  }
  async function restore() {
    try { const o = await MH.load(sess); if (o) { st.rows = o.rows || []; st.saved = o.saved || ''; } } catch (e) { $('mh-saved').textContent = '讀取已存的持有失敗：' + (e.message || e); }
    if (!st.rows.length) st.rows = [blank(), blank(), blank()];
    if (st.saved) $('mh-saved').textContent = '已載入你上次儲存的持有（' + st.saved.replace('T', ' ').slice(0, 16) + ' UTC）';
  }
  // 輸入表收合：狀態記在這個瀏覽器；摘要顯示幾筆、幾筆不列入計算
  function fold() {
    const f = $('mh-fold'); if (!f) return;
    try { if ((JSON.parse(localStorage.getItem(UIKEY) || '{}')).fold) f.open = false; } catch (e) { /* 略過 */ }
    f.addEventListener('toggle', () => { try { localStorage.setItem(UIKEY, JSON.stringify({ fold: !f.open })); } catch (e) { /* 略過 */ } });
  }
  function sumText() {
    const s = $('mh-sum'); if (!s) return;
    const n = st.rows.filter(filled).length, k = st.rows.filter(r => filled(r) && r.off).length;
    s.textContent = n ? '｜' + n + ' 筆' + (k ? '，' + k + ' 筆不列入計算' : '') : '';
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
    $('mh-rows').innerHTML = st.rows.map((r, i) => '<tr data-i="' + i + '"' + (r.off ? ' class="off"' : '') + '><td class="l"><label class="sr-only" for="mc' + i + '">第 ' + (i + 1) + ' 列代號</label><input id="mc' + i + '" class="code" list="mh-list" autocomplete="off" spellcheck="false" placeholder="例：QLD、0050、2330、現金" value="' + esc(r.code) + '"></td>' +
      '<td><label class="sr-only" for="mv' + i + '">股數或金額</label><input id="mv' + i + '" class="v" type="number" inputmode="decimal" min="0" step="any" placeholder="股數（現金填金額）" value="' + esc(r.v) + '"></td>' +
      '<td><label class="sr-only" for="mk' + i + '">平均成本</label><input id="mk' + i + '" class="cost" type="number" inputmode="decimal" min="0" step="any" placeholder="平均成本（選填）" value="' + esc(r.cost || '') + '"></td>' +
      '<td class="l info" id="mi' + i + '"></td>' +
      '<td class="c"><label class="tog" title="打開後，這一列在下方所有計算都不算（仍會保存）"><input type="checkbox" class="off"' + (r.off ? ' checked' : '') + '><span class="tr" aria-hidden="true"></span><span class="sr-only">第 ' + (i + 1) + ' 列不列入計算</span></label></td>' +
      '<td class="c"><button type="button" class="sm danger del" aria-label="刪除第 ' + (i + 1) + ' 列">刪除</button></td></tr>').join('');
    st.rows.forEach((r, i) => info(i));
    sumText();
  }
  function info(i) {
    const r = st.rows[i], cell = $('mi' + i); if (!cell) return;
    if (!U) { cell.textContent = '載入中…'; return; }
    if (!filled(r)) { cell.textContent = ''; return; }
    const u = LT.resolve(r.code, U), off = r.off ? ' <small class="muted">｜不列入計算</small>' : '';
    if (!u) { cell.innerHTML = '<span class="neg">找不到這個代號</span>' + off; return; }
    if (u.k === 'C') { cell.innerHTML = '<b>' + esc(u.n) + '</b> <small>填金額' + (u.cur === 'USD' ? '（美元，依匯率 ' + (FX ? nf(FX, 3) : '—') + ' 換算）' : '（元）') + '</small>' + off; return; }
    cell.innerHTML = '<b>' + esc(u.n) + '</b> <small>' + esc((MK[u.m] || u.m) + (u.k === 'E' ? ' ETF' : '') + '｜' + (u.p ? nf(u.p, u.p < 10 ? 3 : 2) + (u.m === 'US' ? ' 美元' : ' 元') + '（' + (u.d || '') + '）' : '沒有價格')) + '</small>' + off;
  }

  // ---------- 分析 ----------
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 300); }
  async function run() {
    await save();
    if (!U) return;
    render(await MH.compute(st.rows));
  }
  // 公司名稱縮短：去掉 Inc.、Corporation、Class A 等尾綴，太長加「…」
  const SUF = /[,\s]+(Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Company|Ltd\.?|Limited|plc|PLC|N\.?V\.?|S\.?A\.?|AG|SE|Holdings?|Group|Class [A-C]|Cl [A-C]|CL [A-C]|ADR|The)$/i;
  const short = (s, n) => { s = String(s || '').trim(); let t; do { t = s; s = s.replace(SUF, '').trim(); } while (s !== t && s.length > 3); n = n || 22; return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  // 每一區都用 3D 圓餅（BN.charts.pie3d；圓餅旁的數字表是完整數字，顏色不是唯一辨識方式）
  function pies(R, lines) {
    const P = window.BN && BN.charts && BN.charts.pie3d; if (!P) return;
    const cos = R.cos.filter(c => c.w > 0), secs = R.sectors.filter(s => s[1] > 0);
    const exp = cos.reduce((t, c) => t + c.w, 0), neg = R.cos.reduce((t, c) => t + Math.min(c.w, 0), 0);
    const negNote = neg < -0.0005 ? '反向 ETF 的放空曝險（' + pc(neg) + '）不能畫成圓餅，未列入。' : null;
    const coItems = cos.map(c => ({ key: c.key, name: c.key + ' ' + short(c.name, 20), w: c.w, d: { t: c.w } }));
    if ($('mh-p-alloc')) P.cat($('mh-p-alloc'), {
      items: lines.map(x => ({ key: x.a.code, name: x.a.kind === 'C' ? x.a.name : x.a.code + ' ' + short(x.a.name, 18), w: x.a.w, d: { v: x.a.value } })),
      head: '資產', share: '占總資產', cols: [{ head: '市值（台幣）', cell: s => twd(s.d.v) }], otherName: '其他資產', otherTag: k => '含 ' + k + ' 項',
      sub: '依你輸入的持有計算；超過 8 項時，其餘併入「其他資產」' });
    // 資產全貌：現金＋透視後的每一家公司（以投入的資金計，合計 100%）；前 8 家和「透視」圓餅同一家同一色
    if ($('mh-p-mix')) {
      const M = LT.mix(R, { top: 0, min: 1 }), K = M.cls, col = P.colorsFor(coItems, 8), cw = new Map(R.cos.map(c => [c.key, c.cw || 0]));
      const slices = [...col.keys()].map(k => { const c = cos.find(x => x.key === k); return { key: k, name: k + ' ' + short(c && c.name, 20), w: cw.get(k) || 0, color: col.get(k) }; });
      const restN = R.cos.filter(c => (c.cw || 0) > 1e-15 && !col.has(c.key)).length, restW = K.stock - slices.reduce((t, s) => t + s.w, 0);
      if (restW > 1e-9) slices.push({ key: '_stock', name: '其他公司', w: restW, color: 'var(--pc-o)', tag: '含 ' + nf(restN) + ' 家' + (R.unlisted > 1e-9 ? '與未逐一列出的小額持股' : '') });
      if (K.cash > 1e-9) slices.push({ key: '_cash', name: '現金', w: K.cash, color: 'var(--pc-cash)' });
      const ne = M.slices.filter(x => ['bond', 'commodity', 'inverse', 'etfcash', 'undec', 'other'].includes(x.cls)), neW = ne.reduce((t, x) => t + x.w, 0);
      if (neW > 1e-9) {
        const only = [...new Set(ne.map(x => x.cls))];
        const nm = only.length === 1 && only[0] === 'etfcash' ? 'ETF 內現金等非股票' : only.length === 1 && only[0] === 'bond' ? '債券' : '債券與其他非股票';
        slices.push({ key: '_ne', name: nm, w: neW, color: 'var(--pc-bond)',
          tag: ne.length === 1 && ne[0].cls === 'etfcash' ? '股票型 ETF 中不屬於任何公司的部分' : ne.map(x => (x.codes ? x.name + '（' + x.codes.join('、') + '）' : x.cls === 'bond' ? x.key : x.name) + ' ' + pc(x.w)).join('、') });
      }
      P($('mh-p-mix'), { slices, head: '資產', share: '占總資產', cols: R.total ? [{ head: '金額（台幣）', cell: s => twd(s.w * R.total) }] : [],
        sub: '以投入的資金計，合計 100%：現金加上 ETF 拆開後的各公司；前 8 家和「透視」圓餅同一家同一色',
        note: R.levExtra > 0.0005 ? '槓桿 ETF 以投入的資金計、不放大；槓桿多出的股票曝險 ' + pc(R.levExtra) + ' 不在這張圓餅裡，見「透視：實際持有的公司」。' : null });
    }
    if ($('mh-p-top')) P.cat($('mh-p-top'), {
      items: coItems, head: '公司', share: '占股票曝險', cols: [{ head: '占總資產', cell: s => pc(s.d.t) }], otherName: '其他公司', otherTag: k => '含 ' + k + ' 家',
      sub: '圓餅＝股票曝險 ' + pc(exp) + ' 拆到各公司；前 8 大個別列出。槓桿 ETF 依倍數放大，所以「占總資產」合計可以超過 100%', note: negNote });
    if ($('mh-p-sec')) P.cat($('mh-p-sec'), {
      items: secs.map(s => ({ key: s[0], name: s[0], w: s[1], d: { t: s[1] }, other: s[0] === '未分類' })),
      head: '產業', share: '占股票曝險', cols: [{ head: '占總資產', cell: s => pc(s.d.t) }], otherName: '其他產業', otherTag: k => '含 ' + k + ' 個產業（或未分類）',
      sub: '圓餅＝股票曝險 ' + pc(exp) + ' 依產業拆分', note: negNote });
    const S = stratParts(R);
    if ($('mh-p-strat') && S.sl) P($('mh-p-strat'), {
      slices: [{ key: 'L', name: '多方（' + (S.L.map(a => a.code).join('、') || '—') + '）', w: S.lv, color: 'var(--s-qld)', d: { v: S.lv } }, { key: 'H', name: '避險（' + (S.H.map(a => a.code).join('、') || 'SHV') + '）', w: S.hv, color: 'var(--s-shv)', d: { v: S.hv } }],
      head: '策略部位（目前）', share: '占策略部位', cols: [{ head: '市值（台幣）', cell: s => twd(s.d.v) }],
      sub: '多方 ' + pc(S.lv / S.sl) + '、避險 ' + pc(S.hv / S.sl) + '；下表是和本月目標的差額' });
  }
  function stratParts(R) {
    const L = R.assets.filter(a => LONG[a.code]), H = R.assets.filter(a => HEDGE[a.code]);
    const lv = L.reduce((t, a) => t + a.value, 0), hv = H.reduce((t, a) => t + a.value, 0);
    return { L, H, lv, hv, sl: lv + hv };
  }
  function render(R) {
    const out = $('mh-out');
    const errs = R.errors.map(e => '<p class="msg err">第 ' + (e.row + 1) + ' 列：' + esc(e.msg) + '</p>').join('');
    const offN = st.rows.filter(r => filled(r) && r.off).length, offTxt = offN ? '<p class="small muted">已有 ' + offN + ' 筆設為「不列入計算」，下方所有數字都不含它們。</p>' : '';
    if (!R.assets.length) { out.innerHTML = errs + offTxt + '<p class="small">輸入代號與股數後，這裡會出現你的資產分析。</p>'; return; }
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
    let h = errs + offTxt + '<div class="kv mh-kv">' +
      '<div class="tile"><div class="k">總市值（台幣）</div><div class="v">' + wan(tot) + '</div><div class="s">' + twd(tot) + '</div></div>' +
      '<div class="tile"><div class="k">未實現損益</div><div class="v ' + (val - cost < 0 ? 'neg' : '') + '">' + (cost ? (val - cost >= 0 ? '+' : '−') + wan(Math.abs(val - cost)) : '—') + '</div><div class="s">' + (cost ? sg(val / cost - 1) + '（有填成本的 ' + lines.filter(x => x.pl != null).length + ' 檔）' : '填平均成本就會計算') + '</div></div>' +
      '<div class="tile"><div class="k">美元資產占比</div><div class="v">' + pc(usdW) + '</div><div class="s">匯率 ' + (FX ? nf(FX, 3) : '—') + ' 元／美元</div></div>' +
      '<div class="tile"><div class="k">現金占比</div><div class="v">' + pc(R.cash) + '</div><div class="s">股票曝險 ' + pc(R.stockExp) + (R.levExtra > 0.0005 ? '（含槓桿額外 ' + pc(R.levExtra) + '）' : '') + '</div></div></div>';
    // 明細
    h += '<h3>持有明細</h3><div class="tblwrap"><table class="tbl"><thead><tr><th class="l">代號</th><th class="l">名稱</th><th>股數／金額</th><th>價格（日期）</th><th>市值（台幣）</th><th>占比</th><th>平均成本</th><th>未實現損益</th></tr></thead><tbody>' +
      lines.map(x => { const a = x.a, u = U.get(a.code) || {}; return '<tr><td class="l"><b>' + esc(a.code) + '</b></td><td class="l">' + esc(a.name) + '</td><td>' + qty(a.v) + '</td><td>' + (a.kind === 'C' ? '—' : nf(a.px, a.px < 10 ? 3 : 2) + (a.cur === 'USD' ? ' 美元' : ' 元') + '<br><small>' + esc(u.d || '') + '</small>') + '</td><td>' + twd(a.value) + '</td><td>' + pc(a.w) + '</td><td>' + (x.c > 0 ? nf(x.c, 2) : '—') + '</td><td class="' + (x.pl > 0 ? 'pos' : x.pl < 0 ? 'neg' : '') + '">' + (x.pl == null ? '—' : (x.pl >= 0 ? '+' : '−') + nf(Math.abs(Math.round(x.pl))) + '<br><small>' + sg(x.plp) + '</small>') + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
    // 左：配置＋透視；右：資產全貌；下一排：產業、策略對照。每一區都是 3D 圓餅（out.innerHTML 之後由 pies() 畫）
    const hasCo = R.cos.some(c => c.w > 0), hasSec = R.sectors.some(s => s[1] > 0);
    h += '<div class="mh-two"><div><h3>資產配置</h3><div id="mh-p-alloc"></div><h3>透視：實際持有的公司</h3>' + (hasCo ? '<div id="mh-p-top"></div>' : '<p class="small">沒有可拆解的股票部位。</p>') + '</div>';
    h += '<div><h3>資產全貌：現金＋透視後的公司</h3><div id="mh-p-mix"></div></div></div>';
    h += '<div class="mh-two"><div><h3>產業分布（股票曝險）</h3>' + (hasSec ? '<div id="mh-p-sec"></div>' : '<p class="small">—</p>') + '</div>';
    h += '<div><h3>' + (targets && targets.list && targets.list.length ? '和 ' + targets.list.map(t => esc(t.id)).join('、') + ' 本月目標比較' : '和策略本月目標比較') + '</h3>' + strategy(R) + '</div></div>';
    h += '<p class="small">說明：價格取各來源中日期最新的收盤（證交所／櫃買中心、Yahoo Finance、熱力圖、投資組合透視價格檔），日期列在價格下方；ETF 依發行商公布的持股拆解，槓桿 ETF 依倍數放大。以上為依你輸入的數字所做的計算，不構成投資建議。</p>';
    out.innerHTML = h;
    pies(R, lines);
  }
  function strategy(R) {
    const { L, H, lv, hv, sl } = stratParts(R);
    if (!sl) return '<p class="small">你的持有中沒有策略使用的商品（多方 QLD 或台股 00670L、避險 SHV），所以不計算差額。</p>';
    if (!targets) return '<div id="mh-p-strat"></div><p class="small">策略部位（' + [...L, ...H].map(a => a.code).join('、') + '）共 ' + twd(sl) + '，其中多方 ' + pc(lv / sl) + '。會員規則載入後，這裡會算出和本月目標的差額。</p>';
    const ref = L.find(a => a.code === 'QLD') || L[0] || null, refPx = ref ? ref.px * (ref.cur === 'USD' ? FX : 1) : (U.get('QLD') && U.get('QLD').p ? U.get('QLD').p * FX : null), refCode = ref ? ref.code : 'QLD';
    let h = '<div id="mh-p-strat"></div><p class="small">策略部位＝' + [...L, ...H].map(a => a.code).join('＋') + '，共 ' + twd(sl) + '；目前多方 ' + pc(lv / sl) + '、避險 ' + pc(hv / sl) + '（' + esc(targets.month) + ' 持有）。</p><div class="tblwrap"><table class="tbl"><thead><tr><th class="l">策略</th><th class="l">本月目標</th><th>多方應有</th><th>多方目前</th><th>差額</th></tr></thead><tbody>';
    targets.list.forEach(t => { const want = t.w * sl, d = want - lv, sh = refPx ? d / refPx : null;
      h += '<tr><td class="l"><b>' + esc(t.id) + '</b></td><td class="l">' + esc(t.text) + '</td><td>' + twd(want) + '</td><td>' + twd(lv) + '</td><td class="' + (Math.abs(d) < 1 ? '' : d > 0 ? 'pos' : 'neg') + '">' + (Math.abs(d) < 1 ? '已一致' : (d > 0 ? '多方增加 ' : '多方減少 ') + twd(Math.abs(d)) + (sh ? '<br><small>約 ' + nf(Math.abs(sh), 1) + ' 股 ' + esc(refCode) + '</small>' : '')) + '</td></tr>'; });
    return h + '</tbody></table></div><p class="small">差額＝本月目標多方比例 × 策略部位總額 − 目前多方市值；只是依策略規則的數學換算，不是投資建議。</p>';
  }

  // ---------- 事件 ----------
  function bind() {
    $('mh-rows').addEventListener('input', e => { const tr = e.target.closest('tr'); if (!tr) return; const i = +tr.dataset.i, r = st.rows[i];
      if (e.target.classList.contains('code')) { r.code = e.target.value; const dl = $('mh-list'); dl.innerHTML = suggest(e.target.value).map(([c, u]) => '<option value="' + esc(c) + '">' + esc(u.n + '｜' + (u.k === 'C' ? '現金' : (MK[u.m] || u.m) + (u.k === 'E' ? ' ETF' : ''))) + '</option>').join(''); info(i); }
      else if (e.target.classList.contains('v')) r.v = e.target.value; else if (e.target.classList.contains('cost')) r.cost = e.target.value;
      else if (e.target.classList.contains('off')) { r.off = e.target.checked; if (!r.off) delete r.off; tr.classList.toggle('off', !!r.off); info(i); sumText(); }
      schedule(); });
    $('mh-rows').addEventListener('click', e => { const b = e.target.closest('.del'); if (!b) return; st.rows.splice(+b.closest('tr').dataset.i, 1); if (!st.rows.length) st.rows.push(blank()); drawRows(); schedule(); });
    $('mh-add').addEventListener('click', () => { st.rows.push(blank()); drawRows(); const c = $('mc' + (st.rows.length - 1)); if (c) c.focus(); });
    $('mh-clear').addEventListener('click', () => { if (!confirm('清空這個瀏覽器裡儲存的持有資產？（建議先匯出備份）')) return; st.rows = [blank()]; try { localStorage.removeItem(STORE); } catch (e) { } drawRows(); run(); });
    $('mh-export').addEventListener('click', async () => { const env = await MH.seal(sess, { rows: st.rows.filter(filled), saved: new Date().toISOString() });
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(env)], { type: 'application/json' })); a.download = 'BNASDAQ-holdings-' + sess.user.replace(/[^A-Za-z0-9_.-]/g, '_') + '-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); });
    $('mh-import').addEventListener('change', async e => { const f = e.target.files && e.target.files[0]; if (!f) return;
      try { const o = await MH.open(sess, JSON.parse(await f.text())); st.rows = o.rows && o.rows.length ? o.rows : st.rows; drawRows(); await run(); $('mh-saved').textContent = '已匯入備份（' + (o.saved || '').replace('T', ' ').slice(0, 16) + ' UTC 的版本）並加密儲存'; }
      catch (err) { alert('匯入失敗：' + (err.message || err)); } e.target.value = ''; });
    document.addEventListener('bn:targets', e => { targets = e.detail; run(); });
  }
  (async function init() {
    fold(); await restore(); drawRows(); bind();
    try { const D = await MH.data(); U = D.U; FX = D.FX.rate; st.rows.forEach((r, i) => info(i)); await run(); }
    catch (e) { $('mh-out').innerHTML = '<p class="msg err">資料載入失敗：' + esc(e.message || e) + '</p>'; }
  })();
})();
