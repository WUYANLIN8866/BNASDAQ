/* BNASDAQ｜個股「即時資訊」（2026-11-24 站主：「我點進個股後我要看到一個名叫『即時資訊』新增頁面，其頁面跟 Yahoo 股市功能 100% 相同，甚至更好」）
   放在個股頁（valuation.html#code=代號）上方橫列的第一個、預設頁。這個檔案是公開的，只有行情與畫圖，不含任何策略內容。

   做什麼（對照 Yahoo奇摩股市個股頁 2026-11-24 09:19 實際的分頁：走勢圖｜技術分析｜成交彙整｜籌碼…）
     走勢圖     當日每分鐘走勢＋成交量；台股可看 1／5／10 分 K（當日）
     技術分析   日 K（約 5 年）／週 K（約 5 年）／月 K（約 10 年）；均線 5／10／20／60／120／240、布林通道；KD、MACD、RSI、乖離率、威廉指標（全部在瀏覽器用 K 線算，算法寫在頁面下方）
     即時報價   成交、開盤、最高、最低、均價、成交值、昨收、漲跌、漲跌幅、總量、昨量、振幅、漲跌停價、52 週高低、本益比、市值
     內外盤、五檔委買委賣（台股）
     成交彙整   成交明細（開著頁面時每次報價更新記一筆；更早的用每分鐘彙總）、分價量表
     籌碼       法人買賣超、融資融券、主力進出（買超、賣超前 10 大券商）
     美股       即時價（含盤前盤後）、走勢、K 線與技術指標、基本數據；美股沒有公開的五檔與分價量

   資料來源（2026-11-24 09:19～09:45 台股盤中，從 GitHub runner 帶 Origin: https://bnasdaq.com 實測；紀錄在專案文件 claude/realtime-page-20261124.md）
     鉅亨網 ws.api.cnyes.com、marketinfo.api.cnyes.com：回應帶 Access-Control-Allow-Origin: *，瀏覽器可以直接讀（不必經過本站的快照）
       quote/quotes/TWS:2330:STOCK?column=…  報價＋五檔＋內外盤（欄位代號對照見 normCnyes；用 1216、2412、2603 等 7 檔和 Yahoo奇摩股市同一時刻的值逐欄對過）
       charting/history?resolution=1|5|10|D|W|M  K 線（1／5／10 分只有當日；D 約 1,211 根、W 約 258 根、M 約 121 根；回傳由新到舊）
       priceDistribution/TWS:2330:STOCK  分價量表
       investors/buysell、marginTrading、chipsObserve/daily10mainForce  法人、資券、主力
     CNBC quote.cnbc.com：美股即時價（Nasdaq Last Sale）與盤前盤後，同樣帶 ACAO *
     Yahoo奇摩股市、證交所 MIS、Yahoo Finance、Nasdaq 的 API 都不帶 ACAO，瀏覽器不能直接讀（Yahoo奇摩股市由本站的報價伺服器讀，見 scripts/heatmap_live.py）
   備援：鉅亨網讀不到時，價格改用本站快照（assets/liveq.js；台股每 30 秒、美股每 60 秒），其餘區塊顯示「暫時無法取得」。

   用法：BN.rt.open(容器, { code, name })；BN.rt.close()（離開這一頁時停止更新）；BN.rt.active() 是否開著。 */
(function () {
  'use strict';
  const BN = window.BN = window.BN || {};
  if (BN.rt) return;
  const W = 'https://ws.api.cnyes.com/ws/api/v1/', MI = 'https://marketinfo.api.cnyes.com/mi/api/v1/';
  const CNBC = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1&symbols=';
  const COLS = 'G,QUOTES,K,KEY,B,M,FORMAT';
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isTW = c => /^[0-9][0-9A-Z]{3,5}$/.test(c);
  const num = v => typeof v === 'number' ? (isFinite(v) ? v : null) : (typeof v === 'string' && v.trim() !== '' && isFinite(+v.replace(/[,%]/g, '')) ? +v.replace(/[,%]/g, '') : null);
  const p2 = v => String(v).padStart(2, '0');
  const f2 = (v, d) => v == null || !isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  const fi = v => v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US');
  const sg = v => v > 0 ? '+' : v < 0 ? '−' : '';
  const fchg = (v, d) => v == null || !isFinite(v) ? '—' : sg(v) + f2(Math.abs(v), d);
  const fpct = v => v == null || !isFinite(v) ? '—' : sg(v) + Math.abs(v).toFixed(2) + '%';
  const cls = v => v > 0 ? 'up' : v < 0 ? 'dn' : 'eq';
  const big = v => v == null || !isFinite(v) ? '—' : Math.abs(v) >= 1e12 ? f2(v / 1e12) + ' 兆' : Math.abs(v) >= 1e8 ? f2(v / 1e8) + ' 億' : Math.abs(v) >= 1e4 ? f2(v / 1e4) + ' 萬' : fi(v);
  const tpe = (sec, ss) => { const z = new Date(sec * 1000 + 8 * 36e5); return p2(z.getUTCHours()) + ':' + p2(z.getUTCMinutes()) + (ss ? ':' + p2(z.getUTCSeconds()) : ''); };   // 台北時間
  const tpeDate = sec => new Date(sec * 1000 + 8 * 36e5).toISOString().slice(0, 10);
  const mdT = sec => { const z = new Date(sec * 1000 + 8 * 36e5); return (z.getUTCMonth() + 1) + '/' + z.getUTCDate(); };
  const now = () => Date.now() / 1000;
  async function getJSON(url, ms) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 9000);
    try { const r = await fetch(url, { cache: 'no-store', signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); }
  }

  // ---------- 來源 → 統一格式 ----------
  // 鉅亨網報價欄位（2026-11-24 09:33 與 Yahoo奇摩股市同時刻逐欄核對：1216 統一、2412 中華電、2603 長榮、2330、6488、0050、00679B）
  //   6 成交價、11 漲跌、56 漲跌幅%、19 開盤、12 最高、13 最低、21 昨收、22 買價、25 賣價、75 漲停價、76 跌停價、3404 均價
  //   200013 總量（台股：張；美股：股）、32741 成交金額（元）、200007 報價時間（UNIX 秒）
  //   436～440 委買價一～五檔、441～445 委賣價一～五檔、200014～200018 委買量、200019～200023 委賣量（上市：張；上櫃：股 → 這裡換成張）
  //   200054 內盤量、200055 外盤量（張；鉅亨網的分類：成交在委買價＝內盤、在委賣價＝外盤，所以漲停鎖住時全部算內盤；30 檔對照 Yahoo：未漲跌停的 22 檔方向一致、數量略少）
  //   200192／200193 52 週最高與日期、200196／200197 52 週最低與日期、36 本益比、700006 股價淨值比、700005 市值（台股：元；美股：百萬美元）、200226 發行股數
  //   800003 [[開盤, 收盤]]（UNIX 秒）、200011 交易所（TSE／OTC／NASDAQ…）、200222 上市／上櫃、200087 產業、200061 種類（COMMON／ETF）
  function normCnyes(q, mk) {
    if (!q) return null;
    const n = k => num(q[k]), p = n('6'), prev = n('21');
    if (!(p > 0)) return null;
    const o = { src: '鉅亨網', mk, t: n('200007'), p, chg: n('11'), pct: n('56'), open: n('19'), high: n('12'), low: n('13'), prev, bid: n('22'), ask: n('25'), vol: n('200013'),
      amt: n('32741') != null ? n('32741') : n('200067'), avg: n('3404'), up: n('75'), dn: n('76'), hi52: n('200192') != null ? n('200192') : n('3265'), lo52: n('200196') != null ? n('200196') : n('3266'),
      hi52d: q['200193'] || '', lo52d: q['200197'] || '', pe: n('36'), pb: n('700006'), cap: n('700005'), shares: n('200226'), name: q['200009'] || '', ex: q['200011'] || '', type: q['200061'] || '',
      ind: q['200087'] || '', board: q['200222'] || '', ses: Array.isArray(q['800003']) && Array.isArray(q['800003'][0]) && q['800003'][0].length === 2 ? q['800003'][0].map(Number) : null };
    if (o.chg == null && prev > 0) o.chg = p - prev;
    if (o.pct == null && prev > 0) o.pct = (p / prev - 1) * 100;
    if (mk === 'US') { if (o.cap != null) o.cap *= 1e6; return o; }
    const bp = ['436', '437', '438', '439', '440'].map(n), ap = ['441', '442', '443', '444', '445'].map(n);
    let bv = ['200014', '200015', '200016', '200017', '200018'].map(n), av = ['200019', '200020', '200021', '200022', '200023'].map(n);
    const all = bv.concat(av).filter(v => v != null && v > 0);
    if (o.ex === 'OTC' && all.length && all.every(v => v % 1000 === 0)) { bv = bv.map(v => v == null ? null : v / 1000); av = av.map(v => v == null ? null : v / 1000); }
    o.book = { bids: bp.map((x, i) => [x, bv[i]]), asks: ap.map((x, i) => [x, av[i]]) };
    o.inn = n('200054'); o.out = n('200055');
    return o;
  }
  // CNBC：last 成交、change、change_pct、open／high／low、volume（股）、previous_day_closing、last_time（ISO）、curmktstatus（REG_MKT／PRE_MKT／POST_MKT…）
  //   ExtendedMktQuote：盤前（PRE_MKT）／盤後（POST_MKT）的 last、change（盤前對前一交易日收盤、盤後對當天收盤）、last_time、volume
  const usCapLike = s => { const m = String(s || '').replace(/,/g, '').match(/^([0-9.]+)\s*([TBMK])?$/i); return m && isFinite(+m[1]) ? +m[1] * ({ T: 1e12, B: 1e9, M: 1e6, K: 1e3 }[(m[2] || '').toUpperCase()] || 1) : null; };
  function normCnbc(a) {
    if (!a || +a.code !== 0) return null;
    const n = k => num(a[k]), p = n('last'), ev = a.EventData || {};
    if (!(p > 0)) return null;
    const o = { src: 'CNBC', mk: 'US', t: Date.parse(a.last_time) / 1000 || null, p, chg: n('change'), pct: n('change_pct'), open: n('open'), high: n('high'), low: n('low'), prev: n('previous_day_closing'), vol: n('volume'),
      hi52: n('yrhiprice'), lo52: n('yrloprice'), hi52d: a.yrhidate || '', lo52d: a.yrlodate || '', pe: n('pe'), eps: n('eps'), capTxt: a.mktcapView || '', div: n('dividend'), yld: a.dividendyield || '', beta: n('beta'),
      fpe: n('fpe'), name: a.name || '', ex: a.exchange || '', status: a.curmktstatus || '', source: a.source || '', avg10: usCapLike(a.tendayavgvol), real: a.realTime === 'true', earn: ev.next_earnings_date || '', exdiv: ev.div_ex_date || '', divAmt: num(ev.div_amount) };
    const x = a.ExtendedMktQuote;
    if (x && num(x.last) > 0) o.ext = { type: x.type === 'PRE_MKT' ? 'pre' : 'post', p: num(x.last), chg: num(x.change), pct: num(x.change_pct), t: Date.parse(x.last_time) / 1000 || null, vol: num(x.volume) };
    return o;
  }
  // K 線：鉅亨網回傳由新到舊 → 轉成由舊到新；D／W／M 的時間是該日（週、月的第一個交易日）台北 08:00
  function normHist(d) {
    if (!d || d.s !== 'ok' || !Array.isArray(d.t) || !d.t.length) return null;
    const o = { t: [], o: [], h: [], l: [], c: [], v: [], ses: Array.isArray(d.session) && Array.isArray(d.session[0]) ? d.session[0].map(Number) : null };
    for (let i = d.t.length - 1; i >= 0; i--) {
      const c = num(d.c[i]); if (c == null || !(c > 0)) continue;
      const op = num(d.o[i]), hi = num(d.h[i]), lo = num(d.l[i]);
      o.t.push(+d.t[i]); o.c.push(c); o.o.push(op != null ? op : c); o.h.push(hi != null ? Math.max(hi, c) : c); o.l.push(lo != null ? Math.min(lo, c) : c); o.v.push(num(d.v[i]) || 0);
    }
    return o.t.length ? o : null;
  }

  // ---------- 技術指標（輸入：由舊到新的陣列；資料不足的位置是 null）----------
  function sma(a, n) { const out = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
  function ema(a, n) { const out = new Array(a.length).fill(null), k = 2 / (n + 1); let e = null; for (let i = 0; i < a.length; i++) { if (a[i] == null) continue; e = e == null ? a[i] : a[i] * k + e * (1 - k); out[i] = e; } return out; }
  function boll(c, n, m) { const mid = sma(c, n), up = new Array(c.length).fill(null), dn = new Array(c.length).fill(null); for (let i = n - 1; i < c.length; i++) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += (c[j] - mid[i]) * (c[j] - mid[i]); const sd = Math.sqrt(s / n); up[i] = mid[i] + m * sd; dn[i] = mid[i] - m * sd; } return { mid, up, dn }; }
  function kd(K, n) {   // RSV＝(收盤−n 日最低)÷(n 日最高−n 日最低)×100；K＝前一日 K×2/3＋RSV×1/3；D＝前一日 D×2/3＋K×1/3；起始 K＝D＝50
    const k = new Array(K.c.length).fill(null), d = new Array(K.c.length).fill(null); let pk = 50, pd = 50;
    for (let i = n - 1; i < K.c.length; i++) { let hi = -Infinity, lo = Infinity; for (let j = i - n + 1; j <= i; j++) { if (K.h[j] > hi) hi = K.h[j]; if (K.l[j] < lo) lo = K.l[j]; } const rsv = hi > lo ? (K.c[i] - lo) / (hi - lo) * 100 : 50; pk = pk * 2 / 3 + rsv / 3; pd = pd * 2 / 3 + pk / 3; k[i] = pk; d[i] = pd; }
    return { k, d };
  }
  function macd(c) { const e12 = ema(c, 12), e26 = ema(c, 26), dif = c.map((_, i) => i >= 25 ? e12[i] - e26[i] : null), sig = ema(dif, 9).map((v, i) => i >= 33 ? v : null); return { dif, sig, osc: dif.map((v, i) => v != null && sig[i] != null ? v - sig[i] : null) }; }
  function rsi(c, n) {   // Wilder：平均漲幅÷(平均漲幅＋平均跌幅)×100；起始取前 n 次漲跌的算術平均，之後遞迴
    const out = new Array(c.length).fill(null); let au = 0, ad = 0;
    for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], u = Math.max(ch, 0), dd = Math.max(-ch, 0); if (i <= n) { au += u / n; ad += dd / n; if (i === n) out[i] = au + ad > 0 ? au / (au + ad) * 100 : 50; } else { au = (au * (n - 1) + u) / n; ad = (ad * (n - 1) + dd) / n; out[i] = au + ad > 0 ? au / (au + ad) * 100 : 50; } }
    return out;
  }
  function bias(c, n) { const m = sma(c, n); return c.map((v, i) => m[i] ? (v - m[i]) / m[i] * 100 : null); }
  function wr(K, n) { const out = new Array(K.c.length).fill(null); for (let i = n - 1; i < K.c.length; i++) { let hi = -Infinity, lo = Infinity; for (let j = i - n + 1; j <= i; j++) { if (K.h[j] > hi) hi = K.h[j]; if (K.l[j] < lo) lo = K.l[j]; } out[i] = hi > lo ? (hi - K.c[i]) / (hi - lo) * -100 : -50; } return out; }
  const IND = { sma, ema, boll, kd, macd, rsi, bias, wr };

  // ---------- 畫圖（canvas）----------
  function theme(el) {
    const s = getComputedStyle(el), g = (k, d) => (s.getPropertyValue(k) || '').trim() || d;
    return { ink: g('--ink', '#111'), ink2: g('--ink-2', '#444'), mut: g('--muted', '#777'), line: g('--line', '#ddd'), grid: g('--line-2', '#eee'), paper: g('--paper', '#fff'), up: g('--rt-up', '#1f7a3a'), dn: g('--rt-dn', '#b3261e'),
      gold: g('--gold-hi', '#b8975a'), font: g('--sans', 'sans-serif'), ma: [g('--pc-1', '#2a78d6'), g('--pc-2', '#eb6834'), g('--pc-7', '#6250d6'), g('--pc-3', '#1baf7a'), g('--pc-5', '#e87ba4'), g('--pc-4', '#eda100')] };
  }
  function prep(cv) {
    const w = cv.clientWidth, h = cv.clientHeight, d = Math.min(2.5, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); return { g, w, h };
  }
  function ticks(lo, hi, n) { const span = hi - lo; if (!(span > 0)) return [lo]; const s0 = span / (n || 4), p = Math.pow(10, Math.floor(Math.log10(s0))), f = s0 / p, st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-6; v += st) out.push(+v.toFixed(10)); return out; }
  const dec = v => Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2;

  // 當日走勢：x＝交易時段（台股 09:00～13:30、美股 09:30～16:00 美東）；y 以昨收為中線上下對稱；下方每分鐘成交量
  function drawDay(cv, D, q, hov) {
    const T = theme(cv), { g, w, h } = prep(cv), L = 56, R = 52, top = 8, xh = 18, volH = Math.round((h - top - xh) * 0.22), gap = 8, ph = h - top - xh - volH - gap, pw = w - L - R;
    g.font = '11px ' + T.font; g.textBaseline = 'middle';
    if (!D || !D.t.length || !q || !(q.prev > 0)) { g.fillStyle = T.mut; g.textAlign = 'center'; g.fillText(D === false ? '走勢資料暫時無法取得' : '今天還沒有成交（或走勢資料載入中）', w / 2, h / 2); return null; }
    let s0 = D.ses ? D.ses[0] : D.t[0], s1 = D.ses ? D.ses[1] : D.t[D.t.length - 1]; s1 -= (s1 - s0) % 1800;   // 台股來源的收盤寫 13:35（含最後撮合），走勢只到 13:30
    if (!(s1 > s0)) s1 = s0 + 3600;
    const prev = q.prev; let hi = Math.max.apply(null, D.h), lo = Math.min.apply(null, D.l);
    if (q.high > 0) hi = Math.max(hi, q.high); if (q.low > 0) lo = Math.min(lo, q.low);
    let d = Math.max(Math.abs(hi - prev), Math.abs(lo - prev), prev * 0.004) * 1.12;
    if (q.up > 0 && q.dn > 0) d = Math.min(d, Math.max(q.up - prev, prev - q.dn) * 1.02);
    const X = t => L + (t - s0) / (s1 - s0) * pw, Y = p => top + (prev + d - p) / (2 * d) * ph, vmax = Math.max.apply(null, D.v) || 1, vy0 = top + ph + gap + volH;
    // 格線與座標
    g.lineWidth = 1; g.strokeStyle = T.grid;
    [-1, -0.5, 0, 0.5, 1].forEach(k => { const y = Math.round(Y(prev + d * k)) + 0.5; g.beginPath(); if (k === 0) g.setLineDash([4, 3]); g.strokeStyle = k === 0 ? T.mut : T.grid; g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = k > 0 ? T.up : k < 0 ? T.dn : T.ink2; g.textAlign = 'right'; g.fillText(f2(prev + d * k, dec(prev)), L - 6, y); g.textAlign = 'left'; g.fillText(fpct(d * k / prev * 100), L + pw + 6, y); });
    g.strokeStyle = T.line; g.strokeRect(L + 0.5, top + 0.5, pw, ph); g.strokeRect(L + 0.5, top + ph + gap + 0.5, pw, volH);
    g.fillStyle = T.mut; g.textAlign = 'center'; g.textBaseline = 'top';
    const odd = (s1 - s0) % 3600 > 0, lw = g.measureText('00:00').width + 8;   // 收盤不在整點（台股 13:30）：最後另外標一個；離它太近的整點標籤不寫（窄螢幕會疊在一起）
    for (let t = s0; t <= s1 + 1; t += 3600) { const x = X(t), lx = Math.max(L + 14, Math.min(L + pw - 14, x)); if (!(odd && lx + lw > L + pw - 14)) g.fillText(tpe(t), lx, h - xh + 4); if (t > s0 && t < s1) { g.strokeStyle = T.grid; g.beginPath(); g.moveTo(Math.round(x) + 0.5, top); g.lineTo(Math.round(x) + 0.5, top + ph); g.stroke(); } }
    if (odd) g.fillText(tpe(s1), L + pw - 14, h - xh + 4);
    g.textBaseline = 'middle'; g.textAlign = 'right'; g.fillText(fi(vmax), L - 6, top + ph + gap + 6);
    // 成交量
    const bw = Math.max(1, pw / ((s1 - s0) / 60) - 0.6);
    for (let i = 0; i < D.t.length; i++) { const up = D.c[i] >= (i ? D.c[i - 1] : (q.open > 0 ? q.open : prev)); g.fillStyle = up ? T.up : T.dn; const bh = Math.max(D.v[i] > 0 ? 1 : 0, D.v[i] / vmax * (volH - 2)); g.fillRect(X(D.t[i]) - bw / 2, vy0 - bh, bw, bh); }
    // 價格線：昨收以上、以下分別上色
    const path = () => { g.beginPath(); for (let i = 0; i < D.t.length; i++) { const x = X(D.t[i]), y = Y(D.c[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); } };
    [[top, Y(prev) - top, T.up], [Y(prev), top + ph - Y(prev), T.dn]].forEach(([y0, hh, col]) => { if (hh <= 0) return; g.save(); g.beginPath(); g.rect(L, y0, pw, hh); g.clip();
      path(); g.lineTo(X(D.t[D.t.length - 1]), Y(prev)); g.lineTo(X(D.t[0]), Y(prev)); g.closePath(); g.globalAlpha = 0.12; g.fillStyle = col; g.fill(); g.globalAlpha = 1; path(); g.strokeStyle = col; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke(); g.restore(); });
    const li = D.t.length - 1; g.fillStyle = D.c[li] >= prev ? T.up : T.dn; g.beginPath(); g.arc(X(D.t[li]), Y(D.c[li]), 3, 0, 6.3); g.fill();
    // 十字線
    if (hov != null && hov >= 0 && hov < D.t.length) { const x = Math.round(X(D.t[hov])) + 0.5, y = Math.round(Y(D.c[hov])) + 0.5; g.strokeStyle = T.ink2; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, top); g.lineTo(x, vy0); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = T.paper; g.strokeStyle = T.ink; g.beginPath(); g.arc(x, y, 4, 0, 6.3); g.fill(); g.stroke(); }
    return { L, pw, s0, s1, idx: px => { const t = s0 + (px - L) / pw * (s1 - s0); let b = 0, bd = Infinity; for (let i = 0; i < D.t.length; i++) { const dd = Math.abs(D.t[i] - t); if (dd < bd) { bd = dd; b = i; } } return b; } };
  }

  // K 線：主圖（K 棒＋均線＋布林）、成交量、指標；view＝[第一根, 最後一根＋1]
  function drawK(cv, K, V, o, hov) {
    const T = theme(cv), { g, w, h } = prep(cv), L = 8, R = 58, top = 6, xh = 18, gap = 6, indOn = !!(o.ind && o.ind !== 'none' && o.calc && o.calc.kd);
    g.font = '11px ' + T.font; g.textBaseline = 'middle';
    if (!K || !K.t.length) { g.fillStyle = T.mut; g.textAlign = 'center'; g.fillText(K === false ? 'K 線資料暫時無法取得' : 'K 線資料載入中…', w / 2, h / 2); return null; }
    const body = h - top - xh, volH = Math.round(body * 0.15), indH = indOn ? Math.round(body * 0.22) : 0, ph = body - volH - gap - (indOn ? indH + gap : 0), pw = w - L - R;
    const i0 = Math.max(0, V[0]), i1 = Math.min(K.t.length, V[1]), n = Math.max(1, i1 - i0), cw = pw / n, bw = Math.max(1, Math.min(18, cw * 0.72));
    const X = i => L + (i - i0 + 0.5) * cw, C = o.calc;
    let hi = -Infinity, lo = Infinity, vmax = 0;
    for (let i = i0; i < i1; i++) { if (K.h[i] > hi) hi = K.h[i]; if (K.l[i] < lo) lo = K.l[i]; if (K.v[i] > vmax) vmax = K.v[i]; }
    const lines = [], MASX = [5, 10, 20, 60, 120, 240]; (o.ma || []).forEach(m => { if (C.ma[m]) lines.push([C.ma[m], T.ma[Math.max(0, MASX.indexOf(m)) % T.ma.length], 1.2]); });   // 均線顏色照固定順序（勾掉一條，其他條顏色不變）
    if (o.boll && C.boll) { lines.push([C.boll.up, T.mut, 1, [4, 3]]); lines.push([C.boll.dn, T.mut, 1, [4, 3]]); }
    lines.forEach(ln => { for (let i = i0; i < i1; i++) { const v = ln[0][i]; if (v != null) { if (v > hi) hi = v; if (v < lo) lo = v; } } });
    const pad = (hi - lo) * 0.06 || hi * 0.01; hi += pad; lo -= pad;
    const Y = p => top + (hi - p) / (hi - lo) * ph, vy0 = top + ph + gap + volH, iy0 = vy0 + gap;
    g.lineWidth = 1; g.strokeStyle = T.line; g.strokeRect(L + 0.5, top + 0.5, pw, ph); g.strokeRect(L + 0.5, top + ph + gap + 0.5, pw, volH); if (indOn) g.strokeRect(L + 0.5, iy0 + 0.5, pw, indH);
    g.textAlign = 'left';
    ticks(lo, hi, 5).forEach(v => { const y = Math.round(Y(v)) + 0.5; if (y < top + 6 || y > top + ph - 4) return; g.strokeStyle = T.grid; g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.fillStyle = T.mut; g.fillText(f2(v, dec(v)), L + pw + 6, y); });
    // x 軸：月／年的第一根標日期（分 K 標整點）
    g.textAlign = 'center'; g.textBaseline = 'top'; let lastX = -99, lastKey = '';
    for (let i = i0; i < i1; i++) { const z = new Date(K.t[i] * 1000 + 8 * 36e5), key = o.res === 'M' || o.res === 'W' ? '' + z.getUTCFullYear() : o.intra ? '' + z.getUTCHours() : z.getUTCFullYear() + '/' + p2(z.getUTCMonth() + 1);
      if (key !== lastKey) { const x = X(i); if (i > i0 && x - lastX > (o.intra ? 44 : 58)) { g.fillStyle = T.mut; g.fillText(o.intra ? p2(z.getUTCHours()) + ':00' : key, x, h - xh + 4); g.strokeStyle = T.grid; g.beginPath(); g.moveTo(Math.round(x) + 0.5, top); g.lineTo(Math.round(x) + 0.5, top + ph); g.stroke(); lastX = x; } lastKey = key; } }
    g.textBaseline = 'middle';
    // K 棒與成交量
    for (let i = i0; i < i1; i++) { const up = K.c[i] >= K.o[i], x = X(i), col = up ? T.up : T.dn; g.strokeStyle = col; g.fillStyle = col; g.beginPath(); g.moveTo(Math.round(x) + 0.5, Y(K.h[i])); g.lineTo(Math.round(x) + 0.5, Y(K.l[i])); g.stroke();
      const y1 = Y(Math.max(K.o[i], K.c[i])), y2 = Y(Math.min(K.o[i], K.c[i])); g.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      const bh = vmax > 0 ? Math.max(K.v[i] > 0 ? 1 : 0, K.v[i] / vmax * (volH - 3)) : 0; g.fillRect(x - bw / 2, vy0 - bh, bw, bh); }
    const plot = (arr, col, lw, dash, yf, y0, hh) => { g.save(); g.beginPath(); g.rect(L, y0, pw, hh); g.clip(); g.beginPath(); let on = false; for (let i = i0; i < i1; i++) { const v = arr[i]; if (v == null) { on = false; continue; } const x = X(i), y = yf(v); if (on) g.lineTo(x, y); else { g.moveTo(x, y); on = true; } } g.strokeStyle = col; g.lineWidth = lw || 1.2; g.setLineDash(dash || []); g.stroke(); g.restore(); };
    lines.forEach(ln => plot(ln[0], ln[1], ln[2], ln[3], Y, top, ph));
    g.fillStyle = T.mut; g.textAlign = 'left'; g.fillText(fi(vmax), L + pw + 6, top + ph + gap + 7);
    // 指標
    if (indOn) {
      const P = o.ind, set = P === 'kd' ? [[C.kd.k, T.ma[0]], [C.kd.d, T.ma[1]]] : P === 'macd' ? [[C.macd.dif, T.ma[0]], [C.macd.sig, T.ma[1]]] : P === 'rsi' ? [[C.rsi5, T.ma[0]], [C.rsi10, T.ma[1]]] : P === 'bias' ? [[C.bias10, T.ma[0]], [C.bias20, T.ma[1]]] : [[C.wr, T.ma[0]]];
      let a = Infinity, b = -Infinity;
      if (P === 'kd' || P === 'rsi') { a = 0; b = 100; } else if (P === 'wr') { a = -100; b = 0; } else { set.concat(P === 'macd' ? [[C.macd.osc]] : []).forEach(s => { for (let i = i0; i < i1; i++) { const v = s[0][i]; if (v != null) { if (v < a) a = v; if (v > b) b = v; } } }); if (!(b > a)) { a = -1; b = 1; } const m = Math.max(Math.abs(a), Math.abs(b)) * 1.08; a = -m; b = m; }
      const YI = v => iy0 + (b - v) / (b - a) * indH;
      (P === 'kd' || P === 'rsi' ? [20, 50, 80] : P === 'wr' ? [-80, -50, -20] : [0]).forEach(v => { const y = Math.round(YI(v)) + 0.5; g.strokeStyle = T.grid; g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.fillStyle = T.mut; g.fillText(String(v), L + pw + 6, y); });
      if (P === 'macd') for (let i = i0; i < i1; i++) { const v = C.macd.osc[i]; if (v == null) continue; g.fillStyle = v >= 0 ? T.up : T.dn; const y = YI(v), z = YI(0); g.fillRect(X(i) - bw / 2, Math.min(y, z), bw, Math.max(1, Math.abs(y - z))); }
      set.forEach(s => plot(s[0], s[1], 1.2, null, YI, iy0, indH));
    }
    if (hov != null && hov >= i0 && hov < i1) { const x = Math.round(X(hov)) + 0.5, y = Math.round(Y(K.c[hov])) + 0.5; g.strokeStyle = T.ink2; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, top); g.lineTo(x, indOn ? iy0 + indH : vy0); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = T.ink; g.fillRect(L + pw + 1, y - 8, R - 2, 16); g.fillStyle = T.paper; g.textAlign = 'left'; g.fillText(f2(K.c[hov], dec(K.c[hov])), L + pw + 6, y); }
    return { L, pw, cw, i0, i1, idx: px => Math.max(i0, Math.min(i1 - 1, i0 + Math.floor((px - L) / cw))) };
  }

  BN.rtlib = { normCnyes, normCnbc, normHist, IND, drawDay, drawK, theme, f2, fi, fchg, fpct, big, cls, tpe, tpeDate, mdT, num, esc, getJSON, isTW, W, MI, CNBC, COLS, now, p2, usCapLike };
})();

/* ---------- 即時資訊頁（畫面與更新）---------- */
(function () {
  'use strict';
  const BN = window.BN, Lb = BN && BN.rtlib; if (!Lb || BN.rt) return;
  const { normCnyes, normCnbc, normHist, IND, drawDay, drawK, f2, fi, fchg, fpct, big, cls, tpe, tpeDate, mdT, num, esc, getJSON, isTW, W, MI, CNBC, COLS, now, p2 } = Lb;
  let S = null;
  const $ = (sel, r) => (r || S.root).querySelector(sel);
  const KRES = { D: ['日 K', { '3 月': 66, '6 月': 132, '1 年': 250, '3 年': 750, '全部': 1e9 }, '6 月'], W: ['週 K', { '1 年': 52, '3 年': 156, '全部': 1e9 }, '3 年'], M: ['月 K', { '5 年': 60, '全部': 1e9 }, '全部'],
    1: ['1 分 K', { '當日': 1e9 }, '當日'], 5: ['5 分 K', { '當日': 1e9 }, '當日'], 10: ['10 分 K', { '當日': 1e9 }, '當日'] };
  const INDS = [['none', '不顯示'], ['kd', 'KD（9,3,3）'], ['macd', 'MACD（12,26,9）'], ['rsi', 'RSI（5、10）'], ['bias', '乖離率（10、20）'], ['wr', '威廉指標（14）']];
  const MAS = [5, 10, 20, 60, 120, 240];
  const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } } };
  const unit = () => S.mk === 'TW' ? '張' : '股';
  const src1 = () => '鉅亨網';
  const volTxt = v => v == null ? '—' : S.mk === 'TW' ? fi(v) + ' 張' : big(v) + ' 股';
  // CNBC 的日期（11/13/26、01/27/2027(est)）→ 2026/11/13、2027/01/27（預估）；市值（5.073T、845.1B、32.5M）→ 美元金額
  const usDate = s => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\s*(\(est\))?/i); return m ? (m[3].length === 2 ? '20' + m[3] : m[3]) + '/' + p2(+m[1]) + '/' + p2(+m[2]) + (m[4] ? '（預估）' : '') : String(s || ''); };
  const usCap = Lb.usCapLike;

  // ---------- 時段：決定多久讀一次 ----------
  function usClock() { try { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()), g = k => (p.find(x => x.type === k) || {}).value; return { wd: g('weekday'), m: (+g('hour') % 24) * 60 + (+g('minute')) }; } catch (e) { return { wd: 'Mon', m: 600 }; } }
  function phase() {   // load｜pre 開盤前｜open 盤中｜xpre 美股盤前｜xpost 美股盤後｜closed
    const q = S.q, t = now(); if (!q) return 'load';
    if (S.mk === 'TW') { const ses = q.ses; if (ses && t >= ses[0] - 1800 && t <= ses[1] + 90) return t < ses[0] ? 'pre' : 'open'; return 'closed'; }
    const c = usClock(); if (c.wd === 'Sat' || c.wd === 'Sun') return 'closed';
    const ph = c.m >= 570 && c.m < 961 ? 'open' : c.m >= 240 && c.m < 570 ? 'xpre' : c.m >= 961 && c.m < 1201 ? 'xpost' : 'closed';
    return ph === 'open' && q.status && q.status !== 'REG_MKT' && q.t && t - q.t > 1800 ? 'closed' : ph;   // 時鐘在正規時段，但來源說不是正規時段、最後成交也超過 30 分鐘（休市日）
  }
  const every = () => {   // 幾秒後再讀報價：還沒讀到（或正在用備援）→ 5、10、20、40、60 秒逐次拉長重試；盤中 5 秒；開盤前、美股盤前盤後 15 秒；其餘 60 秒
    if (!S.q || S.q.fallback || S.q.stale) return Math.min(60, 5 * Math.pow(2, Math.min(4, Math.max(0, S.fails - 1))));
    const ph = phase(); return ph === 'open' ? 5 : ph === 'pre' || ph === 'xpre' || ph === 'xpost' ? 15 : 60; };

  // ---------- 讀資料 ----------
  async function loadQuote() {
    let q = null, err = '';
    try {
      if (S.mk === 'TW') { const j = await getJSON(W + 'quote/quotes/' + S.sym + '?column=' + COLS); q = normCnyes(j && j.data && j.data[0], 'TW'); }
      else {
        const [a, b] = await Promise.allSettled([getJSON(CNBC + encodeURIComponent(S.csym)), getJSON(W + 'quote/quotes/' + S.sym + '?column=' + COLS)]);
        const qa = a.status === 'fulfilled' ? normCnbc(((a.value.FormattedQuoteResult || {}).FormattedQuote || [])[0]) : null;
        const qb = b.status === 'fulfilled' ? normCnyes(b.value && b.value.data && b.value.data[0], 'US') : null;
        q = qa || qb;
        if (qa && qb) { ['avg', 'amt', 'cap', 'ses'].forEach(k => { if (qa[k] == null && qb[k] != null) qa[k] = qb[k]; }); if (qb.name) qa.zh = qb.name; qa.src = 'CNBC＋鉅亨網'; }
      }
    } catch (e) { err = e && e.message || String(e); }
    if (!S) return;
    if (!q) {   // 備援：本站快照
      S.fails++;
      const l = BN.liveq && BN.liveq.get(S.code, S.mk);
      if (l && l.p > 0) { let ses = S.q && S.q.ses; if (!ses && S.mk === 'TW') { const z = new Date(now() * 1000 + 8 * 36e5), base = Date.UTC(z.getUTCFullYear(), z.getUTCMonth(), z.getUTCDate()) / 1000 - 8 * 3600; ses = [base + 9 * 3600, base + 13 * 3600 + 35 * 60]; }
        q = { src: '本站快照（' + (l.src || '') + '）', mk: S.mk, t: l.t, p: l.p, prev: l.ref, chg: l.ref > 0 ? l.p - l.ref : null, pct: l.chg != null ? l.chg * 100 : null, fallback: true, ses }; }
      else if (S.q) q = Object.assign({}, S.q, { stale: true });
      S.err = err || '來源沒有回應';
    } else { S.fails = 0; S.err = ''; }
    if (!q) { renderHead(); return; }
    // 成交明細：總量增加就記一筆（單量＝這次比上次多的量）
    if (q.vol != null && !q.fallback && !q.stale) { if (S.lastVol != null && q.vol > S.lastVol && q.t) { S.tape.unshift({ t: q.t, p: q.p, dv: q.vol - S.lastVol, vol: q.vol }); if (S.tape.length > 400) S.tape.length = 400; } S.lastVol = q.vol; }
    S.q = q; if (!S.how1 && !q.fallback) { S.how1 = 1; const hw = $('.rt-how .ans'); if (hw) hw.innerHTML = howHtml(); }
    patchK(); renderHead(); renderStats(); renderBook(); if (S.tab === 'day' || S.tab === 'D') drawChart(); if (S.pane === 'tape') renderPane();
  }
  async function loadDay() {
    try { const j = await getJSON(W + 'charting/history?resolution=1&symbol=' + S.sym + '&quote=1&from=' + Math.floor(now() + 60) + '&to=' + Math.floor(now() - 86400 * 4)); if (!S) return; const d = normHist(j && j.data);
      S.day = fitSession(d); }
    catch (e) { if (S && !S.day) S.day = false; }
    if (!S) return; if (S.tab === 'day') drawChart(); if (S.pane === 'tape') renderPane();
  }
  // 只留最近一個交易時段：最後一根在今天的時段內就用來源給的時段；否則把時段往前移到包含最後一根的那一天（開盤前、假日看到的是上一個交易日）
  function fitSession(d) {
    if (!d || !d.t.length) return d || null; const tl = d.t[d.t.length - 1]; let ses = d.ses;
    if (!ses) { const z = new Date(tl * 1000 + 8 * 36e5), base = Date.UTC(z.getUTCFullYear(), z.getUTCMonth(), z.getUTCDate()) / 1000 - 8 * 3600; ses = S.mk === 'TW' ? [base + 9 * 3600, base + 13.5 * 3600] : [d.t[0], d.t[0] + 6.5 * 3600]; }
    let k = 0; while (ses[0] - k * 86400 > tl && k < 10) k++; ses = [ses[0] - k * 86400, ses[1] - k * 86400];
    const o = { t: [], o: [], h: [], l: [], c: [], v: [], ses }; for (let i = 0; i < d.t.length; i++) if (d.t[i] >= ses[0] - 60 && d.t[i] <= ses[1] + 60) ['t', 'o', 'h', 'l', 'c', 'v'].forEach(x => o[x].push(d[x][i]));
    return o.t.length ? o : null;
  }
  // 報價的交易日（台股：台北日期；美股：美東日期），和日 K 的日期比
  function qDate(q) { if (!q || !q.t) return ''; if (S.mk === 'TW') return tpeDate(q.t); try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(q.t * 1000)); } catch (e) { return new Date((q.t - 5 * 3600) * 1000).toISOString().slice(0, 10); } }
  async function loadK(res) {
    const back = res === 'D' ? 86400 * 366 * 12 : res === 'W' ? 86400 * 366 * 30 : res === 'M' ? 86400 * 366 * 40 : 86400 * 4;
    try { const j = await getJSON(W + 'charting/history?resolution=' + res + '&symbol=' + S.sym + '&quote=1&from=' + Math.floor(now() + 60) + '&to=' + Math.floor(now() - back), 12000); if (!S) return; S.K[res] = normHist(j && j.data) || false; }
    catch (e) { if (S && !S.K[res]) S.K[res] = false; }
    if (!S) return; S.KAT[res] = now(); calc(res); if (res === 'D') { renderStats(); } if (S.tab === String(res)) { fitView(); drawChart(); }
  }
  // 日 K 最後一根跟著即時報價更新（同一個交易日就改這一根；新的交易日就加一根）
  function patchK() {
    const K = S.K.D, q = S.q; if (!K || !q || q.fallback || q.stale || !(q.p > 0) || !q.t) return;
    const day = qDate(q), i = K.t.length - 1, last = tpeDate(K.t[i]);
    const o = q.open > 0 ? q.open : q.p, h = Math.max(q.high > 0 ? q.high : q.p, q.p), l = Math.min(q.low > 0 ? q.low : q.p, q.p);
    if (day === last) { K.c[i] = q.p; K.o[i] = o; K.h[i] = h; K.l[i] = l; if (q.vol != null) K.v[i] = q.vol; }
    else if (day > last && phase() !== 'pre') { K.t.push(Date.parse(day + 'T00:00:00Z') / 1000); K.o.push(o); K.h.push(h); K.l.push(l); K.c.push(q.p); K.v.push(q.vol || 0); if (S.tab === 'D') fitView(); }
    else return;
    calc('D');
  }
  function calc(res) {
    const K = S.K[res]; if (!K) return; const c = K.c, ma = {}; MAS.forEach(n => { ma[n] = IND.sma(c, n); });
    S.calc[res] = { ma, boll: IND.boll(c, 20, 2), kd: IND.kd(K, 9), macd: IND.macd(c), rsi5: IND.rsi(c, 5), rsi10: IND.rsi(c, 10), bias10: IND.bias(c, 10), bias20: IND.bias(c, 20), wr: IND.wr(K, 14) };
  }
  function fitView() { const K = S.K[S.tab]; if (!K) return; const n = K.t.length, want = KRES[S.tab][1][S.range[S.tab]] || 1e9; S.view = [Math.max(0, n - Math.min(n, want)), n]; }

  // ---------- 畫面 ----------
  function skeleton() {
    const tw = S.mk === 'TW';
    S.root.innerHTML = '<div class="rt' + (S.color === 'tw' ? ' rt-twc' : '') + '">'
      + '<div class="rt-top"><div class="rt-id"><h2><span class="rt-name">' + esc(S.name || S.code) + '</span><small class="rt-code">' + esc(S.code) + '</small></h2><span class="rt-tags"></span></div>'
      + '<form class="rt-find" autocomplete="off"><label class="sr" for="rt-code">換一檔</label><input id="rt-code" list="codelist" placeholder="換一檔：2330 或 NVDA" inputmode="latin"><button type="submit" class="btn">查詢</button></form></div>'
      + '<div class="rt-pxrow"><div class="rt-px"><span class="rt-last">—</span><span class="rt-chg"></span><span class="rt-flag" hidden></span></div><div class="rt-ext" hidden></div>'
      + '<div class="rt-status"><span class="rt-dot"></span><span class="rt-st">讀取即時報價…</span><button type="button" class="rt-color" title="切換漲跌顏色">' + (S.color === 'tw' ? '紅漲綠跌' : '綠漲紅跌') + '</button></div></div>'
      + '<div class="rt-grid"><div class="rt-main"><section class="rt-card rt-chart"><div class="rt-tabs" role="tablist" aria-label="圖表">'
      + [['day', '走勢圖']].concat(['D', 'W', 'M'].map(k => [k, KRES[k][0]])).concat(tw ? ['1', '5', '10'].map(k => [k, KRES[k][0]]) : []).map(x => '<button type="button" role="tab" data-tab="' + x[0] + '" aria-selected="' + (S.tab === x[0]) + '">' + x[1] + '</button>').join('')
      + '</div><div class="rt-tools" hidden></div><div class="rt-read" aria-live="off"></div><div class="rt-cv"><canvas aria-label="走勢圖"></canvas></div><p class="small rt-cnote"></p></section>'
      + '<section class="rt-card rt-more"><div class="rt-tabs rt-tabs2" role="tablist" aria-label="成交與籌碼">'
      + [['tape', '成交明細']].concat(tw ? [['pd', '分價量表'], ['inst', '法人買賣'], ['margin', '融資融券'], ['main', '主力進出']] : []).map(x => '<button type="button" role="tab" data-pane="' + x[0] + '" aria-selected="' + (S.pane === x[0]) + '">' + x[1] + '</button>').join('')
      + '</div><div class="rt-pane"></div></section></div>'
      + '<aside class="rt-side"><section class="rt-card rt-stats"><h3>即時報價</h3><dl class="rt-dl"></dl></section>'
      + (tw ? '<section class="rt-card rt-bookc"><h3>內外盤與五檔</h3><div class="rt-io"></div><div class="rt-book"></div></section>' : '<section class="rt-card rt-bookc"><h3>基本數據</h3><dl class="rt-dl rt-fund"></dl></section>')
      + '</aside></div>'
      + '<details class="rt-how"><summary>資料來源與算法</summary><div class="ans">' + howHtml() + '</div></details></div>';
  }
  function howHtml() {
    const tw = S.mk === 'TW', q = S.q || {};
    return '<ul>' + (tw
      ? '<li><b>報價、五檔、內外盤、分價量、法人、資券、主力：</b>鉅亨網的公開報價，由你的瀏覽器直接讀取；盤中每 5 秒讀一次、開盤前每 15 秒、收盤後每 60 秒。成交價、總量、成交值、均價、五檔在 2026-11-24 盤中和 Yahoo 股市逐項比對相同。</li>'
        + '<li><b>內外盤：</b>成交在委買價算內盤、在委賣價算外盤，是資料商自己統計的，各家數字不同（例：2026-11-24 09:34 統一 1216，鉅亨網內盤 871／外盤 1,682 張，Yahoo 股市 1,057／1,832 張）。漲停鎖住時鉅亨網全部記為內盤，Yahoo 股市記為外盤。</li>'
        + '<li><b>昨量：</b>鉅亨網日 K 前一根的成交量，和 Yahoo 股市的昨量可能差一點（例：統一 1216 是 20,573 對 20,518 張）。</li>'
      : '<li><b>報價：</b>CNBC 的公開報價，由你的瀏覽器直接讀取' + (q.source ? '（CNBC 標示的來源：' + esc(q.source) + '）' : '') + '；含盤前（美東 04:00～09:30）與盤後（16:00～20:00）。正規時段每 5 秒讀一次、盤前盤後每 15 秒、其餘每 60 秒。<b>走勢與 K 線：</b>鉅亨網。兩個來源的成交量算法不同，所以「總量」只用 CNBC 的數字，走勢圖與 K 線下方的成交量是鉅亨網的數字。美股沒有公開的五檔與內外盤。</li>')
      + '<li>即時來源讀不到時，價格改用本站的報價快照（' + (tw ? '每 30 秒' : '每 60 秒') + '更新），其餘區塊顯示「暫時無法取得」，連線恢復後自動回到即時來源。</li>'
      + '<li><b>漲跌</b>＝成交價−昨收；<b>振幅</b>＝（最高−最低）÷昨收' + (tw ? '；<b>均價</b>＝成交值÷總量（來源提供）' : '') + '。</li>'
      + '<li><b>成交明細：</b>開著這一頁時，每次讀到總量增加就記一筆（單量＝和上一次讀到的總量相差的量），不是交易所的逐筆資料；開啟本頁之前的部分是每分鐘一列。' + (tw ? '<b>分價量表</b>與每分鐘成交量是鉅亨網整理的資料，加總會比即時總量少（例：2026-11-24 09:34 統一 1216 每分鐘量加總 2,847 張、分價量加總 3,003 張，總量 3,200 張）。' : '') + '</li>'
      + '<li><b>K 線與指標</b>（全部在瀏覽器用 K 線計算）：均線＝近 N 根收盤的平均；布林通道＝20 根均線 ± 2 倍標準差；KD（9,3,3）：RSV＝（收盤−9 根最低）÷（9 根最高−9 根最低）×100，K＝前一根 K×2/3＋RSV×1/3，D＝前一根 D×2/3＋K×1/3，起始 50；'
      + 'MACD：DIF＝EMA12−EMA26，MACD＝DIF 的 EMA9，柱狀＝DIF−MACD；RSI（Wilder）：平均漲幅÷（平均漲幅＋平均跌幅）×100；乖離率＝（收盤−均線）÷均線；威廉指標＝（14 根最高−收盤）÷（14 根最高−14 根最低）×−100。日 K 最後一根跟著即時報價更新。K 線價格是實際成交價（未還原權息）。</li>'
      + '<li>時間都是台北時間。鉅亨網' + (tw ? '' : '、CNBC') + '的報價是公開網頁用的資料，沒有另外簽授權；來源改版或擋下瀏覽器直接讀取時，這一頁會退回本站快照。本頁資訊僅供參考，不構成投資建議；下單前請以券商報價為準。</li></ul>';
  }
  function renderHead() {
    const q = S.q, r = S.root; if (!r) return;
    if (!q) { $('.rt-st').textContent = S.fails ? '即時來源暫時無法連線（' + (S.err || '') + '），稍後自動重試' : '讀取即時報價…'; $('.rt-dot').className = 'rt-dot' + (S.fails ? ' bad' : ''); return; }
    const nm = S.mk === 'US' ? (q.zh || S.name || q.name || S.code) : (S.name || q.name || S.code);   // 美股：有中文名稱就用中文，英文名稱放在旁邊的標籤
    if ($('.rt-name').textContent !== nm) $('.rt-name').textContent = nm;
    if (!S.name && (q.zh || q.name)) { S.name = q.zh || q.name; if (S.onName) try { S.onName(S.name); } catch (e) { } }   // 頁面沒有這檔的名稱（例如 ETF）：把來源給的名稱交回頁面
    const c = cls(q.chg), ph = phase(), lim = q.up > 0 && q.p >= q.up ? '漲停' : q.dn > 0 && q.p <= q.dn ? '跌停' : '';
    $('.rt-last').textContent = f2(q.p); $('.rt-last').className = 'rt-last ' + c;
    $('.rt-chg').innerHTML = q.chg == null ? '' : (q.chg > 0 ? '▲' : q.chg < 0 ? '▼' : '') + f2(Math.abs(q.chg)) + '<span>（' + fpct(q.pct) + '）</span>'; $('.rt-chg').className = 'rt-chg ' + c;
    const fl = $('.rt-flag'); fl.hidden = !lim; fl.textContent = lim; fl.className = 'rt-flag ' + c;
    $('.rt-tags').innerHTML = (S.mk === 'US' ? [q.ex, (S.name || q.name) !== nm ? (S.name || q.name) : ''] : [q.board, q.ind, q.type === 'ETF' ? 'ETF' : '']).filter(Boolean).map(x => '<span class="rt-tag">' + esc(x) + '</span>').join('');
    const x = $('.rt-ext'), e = q.ext, live = e && e.t && now() - e.t < 1200 && (ph === 'xpre' || ph === 'xpost');
    if (e && (live || ph === 'closed' || ph === 'xpre' || ph === 'xpost')) { x.hidden = false; x.innerHTML = '<span class="rt-tag">' + (e.type === 'pre' ? '盤前' : '盤後') + '</span><b class="' + cls(e.chg) + '">' + f2(e.p) + '</b><span class="' + cls(e.chg) + '">' + fchg(e.chg) + '（' + fpct(e.pct) + '）</span><small>' + (e.t ? '台北 ' + mdT(e.t) + ' ' + tpe(e.t) : '') + '｜' + (e.type === 'pre' ? '對前一交易日收盤' : '對當天收盤') + '</small>'; } else x.hidden = true;
    const age = q.t ? now() - q.t : null, on = ph === 'open' && !q.fallback && !q.stale;
    const what = q.stale ? '連線中斷，顯示最後一次報價' : ph === 'open' ? (age != null && age < 180 ? '盤中即時' : '盤中（最後成交 ' + (q.t ? tpe(q.t, true) : '—') + '）') : ph === 'pre' ? '開盤前（顯示前一交易日收盤）' : ph === 'xpre' ? '美股盤前時段' : ph === 'xpost' ? '美股盤後時段' : '已收盤';
    $('.rt-st').textContent = what + '｜' + (q.t ? (S.mk === 'US' ? '台北 ' : '') + mdT(q.t) + ' ' + tpe(q.t, true) : '') + '｜' + q.src + (on ? '｜每 ' + every() + ' 秒更新' : '') + (q.fallback ? '｜即時來源暫時讀不到，改用快照' : '');
    $('.rt-dot').className = 'rt-dot' + (q.stale || q.fallback ? ' bad' : on ? ' live' : '');
  }
  const dd = (k, v, c) => '<div><dt>' + k + '</dt><dd' + (c ? ' class="' + c + '"' : '') + '>' + v + '</dd></div>';
  function renderStats() {
    const q = S.q; if (!q) return; const pc = v => v == null || !(q.prev > 0) ? '' : cls(v - q.prev), K = S.K.D;
    let pv = null; if (K && K.t.length > 1 && q.t) { const i = K.t.length - 1; pv = tpeDate(K.t[i]) >= qDate(q) ? K.v[i - 1] : K.v[i]; }   // 昨量：日 K 最後一根是今天就取前一根
    const amp = q.high > 0 && q.low > 0 && q.prev > 0 ? (q.high - q.low) / q.prev * 100 : null;
    const tw = S.mk === 'TW';
    let h = dd('成交', f2(q.p), cls(q.chg)) + dd('開盤', f2(q.open), pc(q.open)) + dd('最高', f2(q.high), pc(q.high)) + dd('最低', f2(q.low), pc(q.low))
      + (tw ? dd('均價', f2(q.avg), pc(q.avg)) + dd('成交值', q.amt != null ? big(q.amt) + ' 元' : '—') : '') + dd('昨收', f2(q.prev)) + dd('漲跌幅', fpct(q.pct), cls(q.chg))
      + dd('漲跌', fchg(q.chg), cls(q.chg)) + dd('總量', volTxt(q.vol)) + (tw ? dd('昨量', volTxt(pv)) : dd('10 日均量', volTxt(q.avg10))) + dd('振幅', amp == null ? '—' : amp.toFixed(2) + '%');
    if (S.mk === 'TW') h += dd('漲停價', f2(q.up), 'up') + dd('跌停價', f2(q.dn), 'dn') + dd('52 週最高', f2(q.hi52) + (q.hi52d ? '<small>' + esc(String(q.hi52d).replace(/-/g, '/')) + '</small>' : '')) + dd('52 週最低', f2(q.lo52) + (q.lo52d ? '<small>' + esc(String(q.lo52d).replace(/-/g, '/')) + '</small>' : ''))
      + dd('本益比', q.pe != null ? f2(q.pe) : '—') + dd('市值', q.cap != null ? big(q.cap) + ' 元' : '—');
    $('.rt-stats .rt-dl').innerHTML = h;
    if (S.mk === 'US') { const f = $('.rt-fund'); if (f) f.innerHTML = dd('52 週最高', f2(q.hi52) + (q.hi52d ? '<small>' + esc(usDate(q.hi52d)) + '</small>' : '')) + dd('52 週最低', f2(q.lo52) + (q.lo52d ? '<small>' + esc(usDate(q.lo52d)) + '</small>' : ''))
      + dd('本益比', q.pe != null ? f2(q.pe) : '—') + dd('預估本益比', q.fpe != null ? f2(q.fpe) : '—') + dd('每股盈餘', q.eps != null ? f2(q.eps) : '—') + dd('市值', usCap(q.capTxt) != null ? big(usCap(q.capTxt)) + ' 美元' : q.cap != null ? big(q.cap) + ' 美元' : '—')
      + dd('每股股利', q.div != null ? f2(q.div) : '—') + dd('殖利率', q.yld ? esc(q.yld) : '—') + dd('Beta', q.beta != null ? f2(q.beta) : '—') + dd('下次財報', q.earn ? esc(usDate(q.earn)) : '—') + dd('最近除息日', q.exdiv ? esc(usDate(q.exdiv)) : '—'); }
  }
  function renderBook() {
    const q = S.q; if (!q || S.mk !== 'TW') return; const io = $('.rt-io'), bk = $('.rt-book'); if (!io || !bk) return;
    if (q.fallback || !q.book) { io.innerHTML = ''; bk.innerHTML = '<p class="small">五檔與內外盤暫時無法取得（即時來源讀不到）。</p>'; return; }
    const tot = (q.inn || 0) + (q.out || 0), ip = tot > 0 ? q.inn / tot * 100 : null;
    io.innerHTML = tot > 0 ? '<div class="rt-iobar" role="img" aria-label="內盤 ' + ip.toFixed(1) + '%、外盤 ' + (100 - ip).toFixed(1) + '%"><i class="dn" style="width:' + ip.toFixed(2) + '%"></i><i class="up" style="width:' + (100 - ip).toFixed(2) + '%"></i></div><div class="rt-iotxt"><span class="dn">內盤 ' + fi(q.inn) + ' 張（' + ip.toFixed(1) + '%）</span><span class="up">外盤 ' + fi(q.out) + ' 張（' + (100 - ip).toFixed(1) + '%）</span></div>'
      + (q.up > 0 && q.p >= q.up && !(q.out > 0) ? '<p class="small rt-ionote">漲停鎖住：成交都在委買價，鉅亨網全部記為內盤；Yahoo 股市等網站把漲停價成交記為外盤，數字會相反。</p>' : q.dn > 0 && q.p <= q.dn && !(q.inn > 0) ? '<p class="small rt-ionote">跌停鎖住：成交都在委賣價，鉅亨網全部記為外盤；Yahoo 股市等網站把跌停價成交記為內盤，數字會相反。</p>' : '') : '<p class="small">今天還沒有內外盤資料。</p>';
    const B = q.book.bids, A = q.book.asks, mx = Math.max.apply(null, B.concat(A).map(x => x[1] || 0)) || 1, sb = B.reduce((s, x) => s + (x[1] || 0), 0), sa = A.reduce((s, x) => s + (x[1] || 0), 0);
    const px = (x, side) => x[0] != null ? '<b class="' + (q.prev > 0 ? cls(x[0] - q.prev) : '') + '">' + f2(x[0]) + '</b>' : x[1] > 0 ? '<b>市價</b>' : '<b>—</b>';
    let h = '<table class="rt-bk"><thead><tr><th>委買量</th><th>委買價</th><th>委賣價</th><th>委賣量</th></tr></thead><tbody>';
    for (let i = 0; i < 5; i++) h += '<tr><td class="bv"><i class="up" style="width:' + ((B[i][1] || 0) / mx * 100).toFixed(1) + '%"></i><span>' + (B[i][1] != null ? fi(B[i][1]) : '—') + '</span></td><td>' + px(B[i]) + '</td><td>' + px(A[i]) + '</td><td class="av"><i class="dn" style="width:' + ((A[i][1] || 0) / mx * 100).toFixed(1) + '%"></i><span>' + (A[i][1] != null ? fi(A[i][1]) : '—') + '</span></td></tr>';
    h += '</tbody><tfoot><tr><td>' + fi(sb) + '</td><td colspan="2">小計（張）</td><td>' + fi(sa) + '</td></tr></tfoot></table>';
    bk.innerHTML = h;
  }
  function tools() {
    const el = $('.rt-tools'), k = S.tab; if (k === 'day') { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false; const R = KRES[k][1];
    el.innerHTML = '<span class="rt-tl">範圍</span>' + Object.keys(R).map(n => '<button type="button" data-range="' + esc(n) + '" aria-pressed="' + (S.range[k] === n) + '">' + esc(n) + '</button>').join('')
      + '<span class="rt-tl">均線</span>' + MAS.map(n => '<label><input type="checkbox" data-ma="' + n + '"' + (S.ma.indexOf(n) >= 0 ? ' checked' : '') + '>' + n + '</label>').join('') + '<label><input type="checkbox" data-boll' + (S.boll ? ' checked' : '') + '>布林</label>'
      + '<span class="rt-tl">指標</span><select data-ind aria-label="技術指標">' + INDS.map(x => '<option value="' + x[0] + '"' + (S.ind === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select>';
  }
  function readout() {
    const el = $('.rt-read'), q = S.q; if (!el) return;
    if (S.tab === 'day') { const D = S.day; if (!D || !q) { el.innerHTML = '&nbsp;'; return; } const i = S.hov != null ? S.hov : D.t.length - 1, c = D.c[i], ch = q.prev > 0 ? c - q.prev : null;
      el.innerHTML = '<b>' + mdT(D.t[i]) + ' ' + tpe(D.t[i]) + '</b><span class="' + cls(ch) + '">' + f2(c) + '　' + fchg(ch) + '（' + fpct(ch != null ? ch / q.prev * 100 : null) + '）</span><span>量 ' + fi(D.v[i]) + ' ' + unit() + '</span>' + (S.hov == null ? '<span class="mut">滑鼠（或手指）移到圖上看每一分鐘</span>' : ''); return; }
    const K = S.K[S.tab], C = S.calc[S.tab]; if (!K || !C) { el.innerHTML = '&nbsp;'; return; }
    const i = S.hov != null ? S.hov : K.t.length - 1, pc = i > 0 ? K.c[i - 1] : null, ch = pc ? K.c[i] - pc : null, z = new Date(K.t[i] * 1000 + 8 * 36e5), intra = +S.tab > 0;
    const date = intra ? p2(z.getUTCHours()) + ':' + p2(z.getUTCMinutes()) : z.getUTCFullYear() + '/' + p2(z.getUTCMonth() + 1) + (S.tab === 'M' ? '' : '/' + p2(z.getUTCDate()) + (S.tab === 'W' ? ' 當週' : ''));
    const T = Lb.theme(S.root.firstChild), v = x => x == null ? '—' : f2(x), P = S.ind;
    let h = '<b>' + date + '</b><span>開 ' + f2(K.o[i]) + '　高 ' + f2(K.h[i]) + '　低 ' + f2(K.l[i]) + '　收 <b class="' + cls(ch) + '">' + f2(K.c[i]) + '</b></span><span class="' + cls(ch) + '">' + fchg(ch) + '（' + fpct(ch != null ? ch / pc * 100 : null) + '）</span><span>量 ' + fi(K.v[i]) + ' ' + unit() + '</span>';
    h += S.ma.map((n, k) => '<span style="color:' + T.ma[MAS.indexOf(n) % T.ma.length] + '">MA' + n + ' ' + v(C.ma[n][i]) + '</span>').join('');
    if (S.boll) h += '<span class="mut">布林 ' + v(C.boll.up[i]) + '／' + v(C.boll.dn[i]) + '</span>';
    if (P === 'kd') h += '<span style="color:' + T.ma[0] + '">K ' + v(C.kd.k[i]) + '</span><span style="color:' + T.ma[1] + '">D ' + v(C.kd.d[i]) + '</span>';
    else if (P === 'macd') h += '<span style="color:' + T.ma[0] + '">DIF ' + v(C.macd.dif[i]) + '</span><span style="color:' + T.ma[1] + '">MACD ' + v(C.macd.sig[i]) + '</span><span class="mut">柱 ' + v(C.macd.osc[i]) + '</span>';
    else if (P === 'rsi') h += '<span style="color:' + T.ma[0] + '">RSI5 ' + v(C.rsi5[i]) + '</span><span style="color:' + T.ma[1] + '">RSI10 ' + v(C.rsi10[i]) + '</span>';
    else if (P === 'bias') h += '<span style="color:' + T.ma[0] + '">乖離10 ' + v(C.bias10[i]) + '%</span><span style="color:' + T.ma[1] + '">乖離20 ' + v(C.bias20[i]) + '%</span>';
    else if (P === 'wr') h += '<span style="color:' + T.ma[0] + '">威廉 ' + v(C.wr[i]) + '</span>';
    el.innerHTML = h;
  }
  function drawChart() {
    if (!S || !S.root) return; const cv = $('.rt-cv canvas'); if (!cv || !cv.clientWidth) return;
    const note = $('.rt-cnote');
    if (S.tab === 'day') { S.geo = drawDay(cv, S.day, S.q, S.hov); note.textContent = '當日走勢：每分鐘一點（台北時間）；虛線＝昨收，右側是相對昨收的漲跌幅；下方是每分鐘成交量（' + unit() + '）。' + (S.mk === 'US' ? '只畫正規時段（美東 09:30～16:00），盤前盤後看上方的盤前／盤後報價。' : ''); }
    else { const K = S.K[S.tab]; if (K && !S.view) fitView(); S.geo = drawK(cv, K, S.view || [0, 0], { ma: S.ma.map(n => n), boll: S.boll, ind: S.ind, calc: remap(S.calc[S.tab]), res: S.tab, intra: +S.tab > 0 }, S.hov);
      note.textContent = (+S.tab > 0 ? KRES[S.tab][0] + '只有當天的資料。' : '') + '滑鼠滾輪縮放、按住左右拖曳移動；手機用上方的「範圍」。K 線是實際成交價（未還原權息）' + (S.tab === 'D' ? '，最後一根跟著即時報價更新。' : '。'); }
    readout();
  }
  // drawK 的均線顏色照 MAS 的固定順序（勾掉一條，其他條顏色不變）
  function remap(C) { if (!C) return { ma: {} }; return C; }
  function renderPane() {
    const el = $('.rt-pane'), q = S.q; if (!el) return; const P = S.pane;
    if (P === 'tape') {
      const D = S.day, rows = [], first = S.tape.length ? S.tape[S.tape.length - 1].t : null;
      S.tape.forEach(x => rows.push('<tr><td>' + tpe(x.t, true) + '</td><td class="' + (q && q.prev > 0 ? cls(x.p - q.prev) : '') + '">' + f2(x.p) + '</td><td class="' + (q && q.prev > 0 ? cls(x.p - q.prev) : '') + '">' + (q && q.prev > 0 ? fchg(x.p - q.prev) : '—') + '</td><td>' + fi(x.dv) + '</td><td>' + fi(x.vol) + '</td></tr>'));
      if (D && D.t.length) { const mrows = [], msum = D.v.reduce((s, v) => s + v, 0); for (let i = D.t.length - 1; i >= 0; i--) { if (first != null && D.t[i] + 60 > first) continue; const c = q && q.prev > 0 ? cls(D.c[i] - q.prev) : '';
          mrows.push('<tr class="min"><td>' + tpe(D.t[i]) + '</td><td class="' + c + '">' + f2(D.c[i]) + '</td><td class="' + c + '">' + (q && q.prev > 0 ? fchg(D.c[i] - q.prev) : '—') + '</td><td>' + fi(D.v[i]) + '</td><td class="mut">—</td></tr>'); }
        if (mrows.length) rows.push('<tr class="sep"><td colspan="5">' + (S.tape.length ? '以下是開啟本頁之前：' : '') + '每分鐘一列（成交價＝該分鐘最後一筆；單量＝該分鐘成交量，' + src1() + '整理，全部加總 ' + fi(msum) + ' ' + unit() + '，會比即時總量少）' + (S.tape.length ? '' : '。開著這一頁時，上方會逐次記錄每次報價更新的成交') + '</td></tr>'); rows.push.apply(rows, mrows.slice(0, 400)); }
      el.innerHTML = rows.length ? '<div class="tblwrap rt-scroll"><table class="tbl rt-tape"><thead><tr><th>時間</th><th>成交價</th><th>漲跌</th><th>單量（' + unit() + '）</th><th>總量（' + unit() + '）</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : '<p class="small">' + (D === false ? '成交明細暫時無法取得。' : '今天還沒有成交（或資料載入中）。') + '</p>';
      return;
    }
    const d = S.pd[P];
    if (d === undefined) { el.innerHTML = '<p class="small">載入中…</p>'; loadPane(P); return; }
    if (!d) { el.innerHTML = '<p class="small">這項資料暫時無法取得（來源沒有回應，或這檔沒有這項資料）。</p>'; return; }
    if (P === 'pd') { const mx = Math.max.apply(null, d.map(x => x.volume)) || 1, tot = d.reduce((s, x) => s + x.volume, 0);
      el.innerHTML = '<p class="small">今天各成交價的成交量（張）；最長的一條是成交最集中的價位。合計 ' + fi(tot) + ' 張' + (q && q.vol != null ? '；即時總量 ' + fi(q.vol) + ' 張（兩個數字來自鉅亨網不同的資料表，更新時間不同，會有差距）' : '') + '。</p><div class="tblwrap rt-scroll"><table class="tbl rt-pd"><thead><tr><th>成交價</th><th>成交量（張）</th><th>占比</th><th class="l">分布</th></tr></thead><tbody>'
        + d.map(x => '<tr' + (q && x.price === q.p ? ' class="now"' : '') + '><td class="' + (q && q.prev > 0 ? cls(x.price - q.prev) : '') + '">' + f2(x.price) + '</td><td>' + fi(x.volume) + '</td><td>' + (tot > 0 ? (x.volume / tot * 100).toFixed(2) : '—') + '%</td><td class="l"><i class="rt-bar' + (x.volume === mx ? ' top' : '') + '" style="width:' + (x.volume / mx * 100).toFixed(1) + '%"></i></td></tr>').join('') + '</tbody></table></div>'; return; }
    const net = v => '<td class="' + cls(v) + '">' + (v == null ? '—' : sgn(v) + fi(Math.abs(v))) + '</td>';
    if (P === 'inst') { el.innerHTML = '<p class="small">三大法人每日買賣超（張；正＝買超、負＝賣超）；每個交易日收盤後更新。</p><div class="tblwrap rt-scroll"><table class="tbl"><thead><tr><th class="l">日期</th><th>外資</th><th>投信</th><th>自營商</th><th>三大法人合計</th></tr></thead><tbody>'
      + d.map(x => '<tr><td class="l">' + esc(x.date) + '</td>' + net(x.foreignNetBuySellVolume) + net(x.domesticNetBuySellVolume) + net(x.dealerNetBuySellVolume) + net(x.totalNetBuySellVolume) + '</tr>').join('') + '</tbody></table></div>'; return; }
    if (P === 'margin') { el.innerHTML = '<p class="small">融資融券每日變化（張）；每個交易日收盤後更新。</p><div class="tblwrap rt-scroll"><table class="tbl"><thead><tr><th class="l">日期</th><th>融資買進</th><th>融資賣出</th><th>融資餘額</th><th>融資使用率</th><th>融券賣出</th><th>融券買進</th><th>融券餘額</th><th>券資比</th></tr></thead><tbody>'
      + d.map(x => '<tr><td class="l">' + esc(x.date) + '</td><td>' + fi(x.marginBuy) + '</td><td>' + fi(x.marginSell) + '</td><td>' + fi(x.marginRemaining) + '</td><td>' + (x.marginUsedPercent != null ? x.marginUsedPercent + '%' : '—') + '</td><td>' + fi(x.shortSell) + '</td><td>' + fi(x.shortBuy) + '</td><td>' + fi(x.shortRemaining) + '</td><td>' + (x.shortMarginPercent != null ? x.shortMarginPercent + '%' : '—') + '</td></tr>').join('') + '</tbody></table></div>'; return; }
    if (P === 'main') { const side = (rows, ttl) => '<div><h4>' + ttl + '</h4><div class="tblwrap"><table class="tbl"><thead><tr><th class="l">券商</th><th>買進</th><th>賣出</th><th>買賣超</th></tr></thead><tbody>' + (rows || []).map(x => '<tr><td class="l">' + esc(x.name || '（來源未提供名稱）') + '</td><td>' + fi(x.buyVolume) + '</td><td>' + fi(x.sellVolume) + '</td>' + net(x.netBuySellVol) + '</tr>').join('') + '</tbody></table></div></div>';
      const a = d.acc; el.innerHTML = '<p class="small">主力進出：' + esc(((d.day.netBuyTop || [])[0] || (d.day.netSellTop || [])[0] || {}).date || '') + ' 買超、賣超最多的各 10 家券商（張）；每個交易日收盤後更新。' + (a ? '主力買賣超（買超前 10 大合計減賣超前 10 大合計）：最近一個交易日 <b class="' + cls(a.preVolume) + '">' + sgn(a.preVolume) + fi(Math.abs(a.preVolume)) + '</b>、近 3 日 <b class="' + cls(a.accVolume3D) + '">' + sgn(a.accVolume3D) + fi(Math.abs(a.accVolume3D)) + '</b>、近 5 日 <b class="' + cls(a.accVolume5D) + '">' + sgn(a.accVolume5D) + fi(Math.abs(a.accVolume5D)) + '</b>、近 10 日 <b class="' + cls(a.accVolume10D) + '">' + sgn(a.accVolume10D) + fi(Math.abs(a.accVolume10D)) + '</b>、近 20 日 <b class="' + cls(a.accVolume20D) + '">' + sgn(a.accVolume20D) + fi(Math.abs(a.accVolume20D)) + '</b> 張。' : '') + '</p><div class="rt-two">' + side(d.day.netBuyTop, '買超前 10 大') + side(d.day.netSellTop, '賣超前 10 大') + '</div>'; return; }
  }
  const sgn = v => v > 0 ? '+' : v < 0 ? '−' : '';
  async function loadPane(P) {
    const t1 = Math.floor(now()), t0 = t1 - 86400 * 90; let d = null;
    try {
      if (P === 'pd') { const j = await getJSON(W + 'priceDistribution/' + S.sym); const a = j && j.data && j.data[0] && j.data[0].distribution; d = Array.isArray(a) && a.length ? a.filter(x => x && x.price > 0 && x.volume > 0).sort((x, y) => y.price - x.price) : null; }
      else if (P === 'inst') { const j = await getJSON(MI + 'investors/buysell/' + S.sym + '?from=' + t1 + '&to=' + t0); d = j && Array.isArray(j.data) && j.data.length ? j.data.slice().sort((a, b) => a.date < b.date ? 1 : -1) : null; }
      else if (P === 'margin') { const j = await getJSON(MI + S.sym + '/marginTrading?from=' + t1 + '&to=' + t0); d = j && Array.isArray(j.data) && j.data.length ? j.data.slice().sort((a, b) => a.date < b.date ? 1 : -1) : null; }
      else if (P === 'main') { const [a, b] = await Promise.allSettled([getJSON(MI + 'chipsObserve/daily10mainForce/' + S.sym), getJSON(MI + 'chipsObserve/10mainForce/' + S.sym)]);
        const day = a.status === 'fulfilled' && a.value && a.value.data; d = day && (day.netBuyTop || day.netSellTop) ? { day, acc: b.status === 'fulfilled' && b.value && Array.isArray(b.value.data) ? b.value.data[0] : null } : null; }
    } catch (e) { d = null; }
    if (!S) return; S.pd[P] = d || null; S.pdAt[P] = now(); if (S.pane === P) renderPane();
  }

  // ---------- 事件 ----------
  function bind() {
    const r = S.root;
    r.addEventListener('click', e => {
      const t = e.target.closest('[data-tab]'); if (t) { S.tab = t.dataset.tab; S.hov = null; S.view = null; store.set('bn-rt-tab', S.tab); r.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b === t))); tools(); if (S.tab !== 'day' && !S.K[S.tab]) { drawChart(); loadK(S.tab); } else { fitView(); drawChart(); } return; }
      const p = e.target.closest('[data-pane]'); if (p) { S.pane = p.dataset.pane; r.querySelectorAll('[data-pane]').forEach(b => b.setAttribute('aria-selected', String(b === p))); if (S.pane !== 'tape' && S.pd[S.pane] !== undefined && now() - (S.pdAt[S.pane] || 0) > (S.pane === 'pd' ? 20 : 600)) delete S.pd[S.pane]; renderPane(); return; }
      const g = e.target.closest('[data-range]'); if (g) { S.range[S.tab] = g.dataset.range; fitView(); tools(); drawChart(); return; }
      if (e.target.closest('.rt-color')) { S.color = S.color === 'tw' ? 'us' : 'tw'; store.set('bn-rt-color', S.color); r.firstChild.classList.toggle('rt-twc', S.color === 'tw'); e.target.closest('.rt-color').textContent = S.color === 'tw' ? '紅漲綠跌' : '綠漲紅跌'; drawChart(); }
    });
    r.addEventListener('change', e => { const t = e.target; if (t.matches('[data-ma]')) { const n = +t.dataset.ma; S.ma = MAS.filter(m => m === n ? t.checked : S.ma.indexOf(m) >= 0); store.set('bn-rt-ma', S.ma.join(',')); drawChart(); } else if (t.matches('[data-boll]')) { S.boll = t.checked; drawChart(); } else if (t.matches('[data-ind]')) { S.ind = t.value; store.set('bn-rt-ind', S.ind); drawChart(); } });
    r.addEventListener('submit', e => { if (!e.target.closest('.rt-find')) return; e.preventDefault(); const v = $('#rt-code').value.trim(); if (v && S.onCode) S.onCode(v); });
    const cv = $('.rt-cv canvas'); let drag = null;
    const xOf = e => e.clientX - cv.getBoundingClientRect().left;
    cv.addEventListener('pointermove', e => { if (!S || !S.geo) return;
      if (drag && S.tab !== 'day') { const K = S.K[S.tab]; if (!K) return; const dx = Math.round((e.clientX - drag.x) / S.geo.cw); if (dx) { const n = drag.v[1] - drag.v[0]; let a = Math.max(0, Math.min(K.t.length - n, drag.v[0] - dx)); S.view = [a, a + n]; S.hov = null; drawChart(); } return; }
      const i = S.geo.idx(xOf(e)); if (i !== S.hov) { S.hov = i; drawChart(); } });
    cv.addEventListener('pointerleave', () => { if (S && S.hov != null && !drag) { S.hov = null; drawChart(); } });
    cv.addEventListener('pointerdown', e => { if (!S || S.tab === 'day' || !S.view || e.pointerType === 'touch') return; drag = { x: e.clientX, v: S.view.slice() }; try { cv.setPointerCapture(e.pointerId); } catch (x) { } });
    const up = () => { drag = null; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { if (!S || S.tab === 'day' || !S.view || !S.geo) return; const K = S.K[S.tab]; if (!K) return; e.preventDefault(); const n = S.view[1] - S.view[0], k = e.deltaY > 0 ? 1.18 : 1 / 1.18, nn = Math.max(20, Math.min(K.t.length, Math.round(n * k))); if (nn === n) return;
      const at = S.geo.idx(xOf(e)), f = (at - S.view[0]) / n; let a = Math.round(at - f * nn); a = Math.max(0, Math.min(K.t.length - nn, a)); S.view = [a, a + nn]; S.range[S.tab] = ''; tools(); drawChart(); }, { passive: false });
    if ('ResizeObserver' in window) { S.ro = new ResizeObserver(() => { clearTimeout(S.rz); S.rz = setTimeout(drawChart, 80); }); S.ro.observe($('.rt-cv')); }
    S.mo = new MutationObserver(() => setTimeout(drawChart, 30)); S.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    S.vis = () => { if (!document.hidden && S && !S.paused) kick(); }; document.addEventListener('visibilitychange', S.vis);
  }
  // ---------- 排程 ----------
  function kick() { clearTimeout(S.tq); clearTimeout(S.td); tickQ(); tickD(); }
  async function tickQ() { if (!S) return; const me = S; if (!document.hidden) await loadQuote(); if (S !== me || S.paused) return; clearTimeout(S.tq); S.tq = setTimeout(tickQ, every() * 1000); }
  async function tickD() { if (!S) return; const me = S; if (!document.hidden) { await loadDay(); if (S !== me) return; const ph = phase();
      if (S.tab !== 'day' && S.tab !== 'D' && now() - (S.KAT[S.tab] || 0) > (ph === 'open' ? 60 : 900)) loadK(S.tab);
      if (S.pane === 'pd' && ph === 'open' && now() - (S.pdAt.pd || 0) > 25) loadPane('pd'); }
    if (S !== me || S.paused) return; clearTimeout(S.td); S.td = setTimeout(tickD, (!S.day ? 20 : phase() === 'open' ? 30 : 300) * 1000); }

  function open(root, o) {
    close(); const code = String(o.code || '').toUpperCase(), mk = isTW(code) ? 'TW' : 'US';
    const tab0 = store.get('bn-rt-tab', 'day');
    S = { root, code, mk, name: o.name || '', sym: mk === 'TW' ? 'TWS:' + code + ':STOCK' : 'USS:' + code.replace('-', '.') + ':STOCK', csym: code.replace('-', '.'), q: null, day: null, K: {}, KAT: {}, calc: {}, tab: KRES[tab0] && (mk === 'TW' || !(+tab0 > 0)) ? tab0 : 'day', view: null,
      range: { D: KRES.D[2], W: KRES.W[2], M: KRES.M[2], 1: '當日', 5: '當日', 10: '當日' }, ma: store.get('bn-rt-ma', '5,20,60').split(',').map(Number).filter(n => MAS.indexOf(n) >= 0), boll: false, ind: store.get('bn-rt-ind', 'kd'), hov: null, geo: null,
      tape: [], lastVol: null, pane: 'tape', pd: {}, pdAt: {}, fails: 0, err: '', color: store.get('bn-rt-color', 'us'), onCode: o.onCode || null, onName: o.onName || null };
    if (!INDS.some(x => x[0] === S.ind)) S.ind = 'kd';
    skeleton(); bind(); tools(); renderHead(); renderPane(); drawChart();
    if (BN.liveq) { try { BN.liveq.want([mk]); } catch (e) { } }
    kick(); loadK('D'); if (S.tab !== 'day' && S.tab !== 'D') loadK(S.tab);
  }
  function close() { if (!S) return; clearTimeout(S.tq); clearTimeout(S.td); clearTimeout(S.rz); if (S.ro) S.ro.disconnect(); if (S.mo) S.mo.disconnect(); if (S.vis) document.removeEventListener('visibilitychange', S.vis); if (S.root) S.root.innerHTML = ''; S = null; }
  function pause() { if (!S || S.paused) return; S.paused = true; clearTimeout(S.tq); clearTimeout(S.td); }
  function resume() { if (!S || !S.paused) return; S.paused = false; S.tape = []; S.lastVol = null; kick(); drawChart(); }   // 暫停期間的成交沒有記到，回來後成交明細重新開始記
  function setName(n) { if (S && n && S.name !== n) { S.name = n; renderHead(); } }   // 頁面晚一點才拿到公司名稱時補上
  BN.rt = { open, close, pause, resume, setName, active: () => !!S, state: () => S, redraw: () => { if (S) drawChart(); } };
})();

/* ---------- 即時新聞（個股頁上方橫列的第二個）----------
   2026-11-24 站主：「新增『即時新聞』頁面放在第二個功能，我要根據由新至舊看到最新的新聞，並且可以選擇幾個時間段顯示（2h／1D／1W／1M／1Q／1Y）」
   來源（2026-11-24 09:49 實測）：
     鉅亨網關鍵字新聞 ess.api.cnyes.com/ess/api/v1/news/keyword（帶 ACAO *，瀏覽器直接讀）：由新到舊；startAt／endAt（UNIX 秒）可以指定時間範圍；
       一次查詢最多回 1,000 則（limit×page ≤ 1,000），更舊的把 endAt 往前移再查。用「代號」（例 2330）與「公司名稱」（例 台積電）各查一次後合併。
       名稱查詢會連內文一起比對：標題、摘要或關鍵字有提到公司的才預設顯示，只在內文提到的另外勾選才顯示。兩個字的名稱（例 統一）要求前後不是中文字，避免把「統一證」算進來。
     本站每小時整理的 Google 新聞（heatmap-live 分支 news-co.json：兆元企業＋那斯達克 100、台灣 50 成分股，48 小時內）
     鉅亨網的個股新聞 API（symbolNews）、Google 新聞 RSS、Yahoo 股市 RSS 都不帶 ACAO，瀏覽器不能直接讀。
   用法：BN.rtnews.open(容器, { code, name })；BN.rtnews.close()。 */
(function () {
  'use strict';
  const BN = window.BN, Lb = BN && BN.rtlib; if (!Lb || BN.rtnews) return;
  const { esc, getJSON, isTW, tpe, tpeDate, now, p2, W } = Lb;
  const ESS = 'https://ess.api.cnyes.com/ess/api/v1/news/keyword', RAWL = 'https://raw.githubusercontent.com/WUYANLIN8866/BNASDAQ/heatmap-live/';
  const RANGES = [['2h', '2 小時', 7200], ['1D', '1 天', 86400], ['1W', '1 週', 7 * 86400], ['1M', '1 個月', 30 * 86400], ['1Q', '1 季', 91 * 86400], ['1Y', '1 年', 365 * 86400]];
  const LIMIT = 50, MAXPAGE = 20, WD = '日一二三四五六';
  let N = null;
  const strip = s => String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/&#10;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  // 這則新聞有沒有明確提到這家公司：標題或摘要出現代號；或關鍵字裡有公司名稱；或標題、摘要出現公司名稱。
  // 兩個字以下的名稱（例 統一）：如果關鍵字裡有「包含這個名稱的另一個詞」（例 統一證、統一投信）而且沒有名稱本身，就當成在講另一家
  function relevant(it) {
    const title = strip(it.title), sum = strip(it.summary), tags = (Array.isArray(it.keywordForTag) ? it.keywordForTag : []).map(String), text = title + ' ' + sum;
    if (new RegExp('(^|[^0-9A-Za-z])' + N.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^0-9A-Za-z])').test(text)) return true;
    return N.names.some(nm => { const low = nm.toLowerCase(); if (tags.some(g => g.toLowerCase() === low)) return true; if (text.toLowerCase().indexOf(low) < 0) return false;
      return nm.length >= 3 || !tags.some(g => g.toLowerCase() !== low && g.toLowerCase().indexOf(low) >= 0); });
  }
  async function fetchPage(Q) {   // Q＝一個查詢的進度 { q, endAt, page, done, total, oldest }
    if (Q.done || Q.busy) return; Q.busy = true;
    try {
      const j = await getJSON(ESS + '?q=' + encodeURIComponent(Q.q) + '&limit=' + LIMIT + '&page=' + Q.page + '&startAt=' + N.start + '&endAt=' + Q.endAt, 12000), d = j && j.data, items = d && Array.isArray(d.items) ? d.items : [];
      if (!N) return;
      if (Q.total == null && d && d.total != null) Q.total = +d.total;
      items.forEach(it => { if (!it || !it.newsId || !(it.publishAt > 0)) return; const id = 'c' + it.newsId, old = N.items.get(id);
        const cat = Array.isArray(it.category) && it.category[0] && it.category[0].name || '';
        const o = old || { id, t: +it.publishAt, title: strip(it.title), sum: strip(it.summary), url: 'https://news.cnyes.com/news/id/' + it.newsId, src: '鉅亨網' + (cat ? '｜' + cat : ''), rel: false };
        if (!old) o.rel = relevant(it); N.items.set(id, o); if (Q.oldest == null || o.t < Q.oldest) Q.oldest = o.t; });
      if (items.length < LIMIT) Q.done = true;
      else if (Q.page >= MAXPAGE) { Q.endAt = Q.oldest - 1; Q.page = 1; if (!(Q.endAt > N.start)) Q.done = true; }   // 一次查詢最多 1,000 則：把結束時間往前移，接著查更舊的
      else Q.page++;
      Q.ok = true;
    } catch (e) { Q.err = (e && e.message) || String(e); Q.fail = (Q.fail || 0) + 1; if (Q.fail >= 2) Q.done = true; }
    Q.busy = false;
  }
  async function loadOwn() {   // 本站每小時整理的 Google 新聞
    try { const j = await getJSON(RAWL + 'news-co.json', 9000); if (!N || !j || j.schema !== 'bnasdaq-news-co/1') return; N.ownAt = j.at;
      (j.co && j.co[N.code] || []).forEach(x => { if (!x || !x.t || !x.u || !(x.at > 0)) return; const id = 'g' + x.u; if (!N.items.has(id)) N.items.set(id, { id, t: +x.at, title: x.t, sum: '', url: x.u, src: 'Google 新聞' + (x.s ? '｜' + x.s : ''), rel: true }); }); } catch (e) { }
  }
  async function load(more) {
    if (!N || N.loading) return; N.loading = true; render();
    const me = N, qs = N.qs.filter(Q => !Q.done);
    await Promise.all(qs.map(fetchPage).concat(more ? [] : [loadOwn()]));
    if (N !== me) return; N.loading = false; N.at = now(); render();
  }
  function setRange(k) {
    const R = RANGES.find(r => r[0] === k) || RANGES[1]; N.range = R[0]; try { localStorage.setItem('bn-news-range', R[0]); } catch (e) { }
    N.start = Math.floor(now() - R[2]); N.items = new Map(); const end = Math.floor(now() + 300);
    N.qs = N.terms.map(x => ({ q: x[0], byCode: x[1], endAt: end, page: 1, done: false, total: null, oldest: null }));
    load();
  }
  function render() {
    if (!N || !N.root) return; const R = RANGES.find(r => r[0] === N.range), all = [...N.items.values()].filter(x => x.t >= N.start).sort((a, b) => b.t - a.t);
    // 還沒查完的查詢只查到某個時間：比那個時間更舊的先不顯示（不然後半段會缺另一個查詢的新聞）
    const pend = N.qs.filter(Q => !Q.done && Q.oldest != null), cut = pend.length ? Math.max.apply(null, pend.map(Q => Q.oldest)) : 0, more = N.qs.some(Q => !Q.done);
    const vis = all.filter(x => x.t >= cut && (N.loose || x.rel)), hid = all.filter(x => x.t >= cut && !x.rel).length;
    let h = '<div class="nw-bar"><div class="nw-rng" role="group" aria-label="時間範圍">' + RANGES.map(r => '<button type="button" data-rng="' + r[0] + '" aria-pressed="' + (N.range === r[0]) + '" title="最近 ' + r[1] + '">' + r[0] + '</button>').join('') + '</div>'
      + '<label class="nw-loose" title="標題、摘要與關鍵字都沒有明確提到這家公司，只在內文出現"><input type="checkbox"' + (N.loose ? ' checked' : '') + '>也顯示只在內文提到 ' + esc(N.names[0] || N.code) + ' 的新聞' + (hid ? '（' + hid + ' 則）' : '') + '</label><button type="button" class="btn line nw-re">重新整理</button></div>';
    const tot = N.qs.filter(Q => Q.total != null).map(Q => '「' + esc(Q.q) + '」' + Q.total.toLocaleString('en-US') + ' 則').join('、');
    h += '<p class="small nw-meta">最近 ' + R[1] + '（' + stamp(N.start) + ' 起）由新到舊：顯示 <b>' + vis.length + '</b> 則' + (more && cut ? '，已查到 ' + stamp(cut) : '') + '。' + (tot ? '鉅亨網這段時間找到：' + tot + '（重複的已合併）。' : '')
      + (N.loading ? '<span class="nw-ld">讀取中…</span>' : N.at ? '更新於台北 ' + tpe(N.at, true) + '，每 3 分鐘自動更新。' : '') + '</p>';
    const bad = N.qs.filter(Q => Q.err && !Q.ok); if (bad.length === N.qs.length && !N.loading) h += '<p class="msg err">鉅亨網新聞暫時讀不到（' + esc(bad[0].err) + '）。' + (vis.length ? '下面只有本站每小時整理的 Google 新聞。' : '') + '</p>';
    if (!vis.length && !N.loading) h += '<p class="small">最近 ' + R[1] + '沒有找到 ' + esc(N.names[0] || N.code) + ' 的新聞' + (hid ? '；有 ' + hid + ' 則只在內文提到，勾選上方選項可以顯示' : '') + '。可以改選更長的時間範圍。</p>';
    let day = '';
    vis.forEach(x => { const d = tpeDate(x.t); if (d !== day) { if (day) h += '</ul>'; day = d; const z = new Date(x.t * 1000 + 8 * 36e5); h += '<h4 class="nw-day">' + d.replace(/-/g, '/') + '（' + WD[z.getUTCDay()] + '）</h4><ul class="nw-list">'; }
      h += '<li' + (x.rel ? '' : ' class="loose"') + '><time>' + tpe(x.t) + '</time><div><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a>' + (x.sum ? '<p>' + esc(x.sum.length > 80 ? x.sum.slice(0, 80) + '…' : x.sum) + '</p>' : '') + '<small>' + esc(x.src) + '｜' + ago(x.t) + '</small></div></li>'; });
    if (day) h += '</ul>';
    if (more && !N.loading) h += '<p><button type="button" class="btn line nw-more">載入更舊的新聞' + (cut ? '（目前到 ' + stamp(cut) + '）' : '') + '</button></p>';
    h += '<p class="small nw-src">來源：鉅亨網新聞（用代號與公司名稱查詢，瀏覽器直接讀取）' + (N.ownAt ? '、本站每小時整理的 Google 新聞（最近一次 ' + stamp(N.ownAt) + '；只有兆元企業與那斯達克 100、台灣 50 成分股）' : '') + '。點標題會開啟原始網站。</p>';
    N.root.innerHTML = '<div class="nw">' + h + '</div>';
  }
  const stamp = s => { const z = new Date(s * 1000 + 8 * 36e5), y0 = new Date(now() * 1000 + 8 * 36e5).getUTCFullYear(); return (z.getUTCFullYear() !== y0 ? z.getUTCFullYear() + '/' : '') + (z.getUTCMonth() + 1) + '/' + z.getUTCDate() + ' ' + p2(z.getUTCHours()) + ':' + p2(z.getUTCMinutes()); };
  const ago = s => { const m = Math.max(0, Math.round((now() - s) / 60)); return m < 60 ? m + ' 分鐘前' : m < 1440 ? Math.floor(m / 60) + ' 小時前' : Math.floor(m / 1440) + ' 天前'; };
  async function open(root, o) {
    close(); const code = String(o.code || '').toUpperCase(), mk = isTW(code) ? 'TW' : 'US'; let r0 = '1D'; try { r0 = localStorage.getItem('bn-news-range') || '1D'; } catch (e) { }
    const me = N = { root, code, mk, names: [], terms: [], range: r0, items: new Map(), qs: [], loose: false, loading: false, at: 0, ownAt: 0, start: 0 };
    root.innerHTML = '<div class="nw"><p class="small">讀取新聞…</p></div>';
    root.onclick = e => { if (!N) return; const b = e.target.closest('[data-rng]'); if (b) { setRange(b.dataset.rng); return; } if (e.target.closest('.nw-more')) { load(true); return; } if (e.target.closest('.nw-re')) { setRange(N.range); } };
    root.onchange = e => { if (N && e.target.closest('.nw-loose')) { N.loose = e.target.checked; render(); } };
    // 公司名稱：台股用簡稱（頁面已知的名稱或鉅亨網的名稱）；美股另外查鉅亨網的中文名稱（例 蘋果、輝達）
    let nm = mk === 'TW' ? String(o.name || '').replace(/\s*[（(].*$/, '').replace(/-KY$|\*$/, '').trim() : '';
    if (mk === 'US' || !nm) { try { const j = await getJSON(W + 'quote/quotes/' + (mk === 'TW' ? 'TWS:' + code : 'USS:' + code.replace('-', '.')) + ':STOCK?column=' + Lb.COLS, 7000); const z = j && j.data && j.data[0] && j.data[0]['200009']; if (z) nm = String(z).replace(/-KY$|\*$/, '').trim(); } catch (e) { } }
    if (N !== me) return;
    N.names = nm && nm.toUpperCase() !== code ? [nm] : []; if (mk === 'US' && o.name) { const en = String(o.name).replace(/,?\s+(Inc\.?|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|plc|N\.V\.|Holdings?|Group|Class [A-C])\b.*$/i, '').trim(); if (en && en.length >= 3 && N.names.indexOf(en) < 0) N.names.push(en); }
    N.terms = [[code, true]].concat(nm && nm.toUpperCase() !== code ? [[nm, false]] : []);
    setRange(N.range);
    N.timer = setInterval(() => { if (!N || document.hidden || N.loading || N.root.hidden) return; const end = Math.floor(now() + 300); N.start = Math.floor(now() - RANGES.find(r => r[0] === N.range)[2]);
      Promise.all(N.terms.map(x => fetchPage({ q: x[0], byCode: x[1], endAt: end, page: 1, done: false, total: 0, oldest: null })).concat([loadOwn()])).then(() => { if (N) { N.at = now(); render(); } }); }, 180000);
  }
  function close() { if (!N) return; clearInterval(N.timer); if (N.root) { N.root.onclick = null; N.root.onchange = null; } N = null; }
  BN.rtnews = { open, close, active: () => !!N, state: () => N, RANGES };
})();
