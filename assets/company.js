/* BNASDAQ｜公司分析（valuation.html 的「個股詳細分析」下半部）
   資料：data/company/<代號>.json（scripts/fetch_company.py 每週產生）；同業各自的檔案。
   內容：與主要對手的雷達圖、股東結構、營收結構、市占率與壟斷性、訂價權、護城河、十四個分析方向、關鍵指標、財務摘要、資料來源與算法。
   所有分數＝同一市場（美股／台股）內的百分位（0～100，越高越好），算法寫在頁面上。 */
(function () {
  'use strict';
  const BN = window.BN = window.BN || {};
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const COL = ['var(--s-fund)', 'var(--s-qqq)', 'var(--s-qld)', 'var(--s-tsmc)', 'var(--s-tw)'];
  const RADAR = ['share', 'monopoly', 'pricing', 'moat', 'growth', 'profit', 'health', 'cash', 'value', 'momentum'];
  const DN = { share: '市占率', monopoly: '壟斷性', pricing: '訂價權', moat: '護城河', growth: '成長性', profit: '獲利能力', health: '財務體質', cash: '現金流品質', value: '估值吸引力', momentum: '股價動能', risk: '低波動', payback: '股東回饋', innov: '研發投入', eff: '營運效率' };
  const DD = {
    share: ['本站涵蓋同產業公司最新年度營收合計中的占比', ['share']],
    monopoly: ['相對市占（本公司 ÷ 第二大）與市占率', ['rel_share', 'share']],
    pricing: ['毛利率水準、近年毛利率穩定度（標準差越小越好）與變化', ['gm', 'gm_std', 'gm_chg']],
    moat: ['投入資本報酬率（近年平均）、營業利益率與其穩定度', ['roic_avg', 'om', 'om_std']],
    growth: ['營收三年年化成長、最新年度營收與 EPS 年增', ['rev_cagr3', 'rev_yoy', 'eps_yoy']],
    profit: ['營業利益率、淨利率、股東權益報酬率', ['om', 'nm', 'roe']],
    health: ['負債權益比（越低越好）、流動比、利息保障倍數、Altman Z', ['de', 'current', 'int_cov', 'altman_z']],
    cash: ['自由現金流率、營業現金流 ÷ 淨利、應計比率（越低越好）', ['fcf_margin', 'cash_conv', 'accruals']],
    value: ['本益比、股價營收比、EV/EBITDA（越低越好）與自由現金流殖利率', ['pe', 'ps', 'ev_ebitda', 'fcf_yield']],
    momentum: ['近 1 年報酬、目前價位在 52 週區間的位置', ['ret_1y', 'pos52']],
    risk: ['近 1 年年化波動、Beta（越低分數越高）', ['vol_1y', 'beta_1y']],
    payback: ['（股票買回＋現金股利）÷ 市值', ['sh_yield', 'payout']],
    innov: ['研發費用 ÷ 營收', ['rnd_int']],
    eff: ['資產周轉率、存貨周轉率', ['asset_turn', 'inv_turn']]
  };
  const MN = { share: '市占率', rel_share: '相對市占', gm: '毛利率', gm_std: '毛利率標準差', gm_chg: '毛利率變化', roic_avg: 'ROIC 平均', roic: 'ROIC', om: '營業利益率', om_std: '營益率標準差', nm: '淨利率', roe: 'ROE', roa: 'ROA',
    rev_cagr3: '營收 3 年年化', rev_yoy: '營收年增', eps_yoy: 'EPS 年增', de: '負債權益比', current: '流動比', int_cov: '利息保障', altman_z: 'Altman Z', fcf_margin: '自由現金流率', cash_conv: '現金轉換', accruals: '應計比率',
    pe: '本益比', ps: '股價營收比', ev_ebitda: 'EV/EBITDA', fcf_yield: 'FCF 殖利率', pb: '股價淨值比', ret_1y: '1 年報酬', pos52: '52 週位置', vol_1y: '年化波動', beta_1y: 'Beta', sh_yield: '股東回饋率', payout: '回饋率（÷淨利）',
    rnd_int: '研發強度', asset_turn: '資產周轉', inv_turn: '存貨周轉', nd_ebitda: '淨負債/EBITDA', dso: '應收天數', sbc_int: '股票酬勞/營收', shs_chg: '股數變化' };
  const PCT = new Set(['share', 'gm', 'gm_std', 'gm_chg', 'roic_avg', 'roic', 'om', 'om_std', 'nm', 'roe', 'roa', 'rev_cagr3', 'rev_yoy', 'eps_yoy', 'fcf_margin', 'accruals', 'fcf_yield', 'ret_1y', 'pos52', 'vol_1y', 'sh_yield', 'payout', 'rnd_int', 'sbc_int', 'shs_chg']);
  const fmtM = (k, v) => v == null || !isFinite(v) ? '—' : PCT.has(k) ? (v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 1) + '%' : k === 'dso' ? Math.round(v) + ' 天' : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) + (/(pe|ps|ev_ebitda|pb|int_cov|asset_turn|inv_turn|current|de|rel_share|nd_ebitda)$/.test(k) ? ' 倍' : '');
  const money = (v, cur) => { if (v == null || !isFinite(v)) return '—'; const u = cur === 'TWD' ? '台幣' : cur === 'USD' ? '美元' : (cur || ''); const a = Math.abs(v), s = v < 0 ? '−' : '';
    return a >= 1e12 ? s + (a / 1e12).toFixed(2) + ' 兆' + u : a >= 1e8 ? s + Math.round(a / 1e8).toLocaleString('en-US') + ' 億' + u : a >= 1e4 ? s + Math.round(a / 1e4).toLocaleString('en-US') + ' 萬' + u : s + a.toFixed(2) + ' ' + u; };
  const sc = v => v == null ? '—' : Math.round(v);
  const axM = v => { const a = Math.abs(v); return a >= 1e12 ? (v / 1e12).toFixed(a >= 1e13 ? 0 : 1) + '兆' : a >= 1e8 ? Math.round(v / 1e8).toLocaleString('en-US') + '億' : a >= 1e4 ? Math.round(v / 1e4).toLocaleString('en-US') + '萬' : String(Math.round(v)); };
  const lvl = v => v == null ? '' : v >= 75 ? '前段' : v >= 50 ? '中上' : v >= 25 ? '中下' : '後段';
  const getJ = u => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const last = a => { const v = (a || []).filter(x => x != null); return v.length ? v[v.length - 1] : null; };
  const yr = d => String(d || '').slice(0, 4) + (String(d || '').slice(5, 7) !== '12' ? '/' + String(d || '').slice(5, 7) : '');

  // ---------------------------------------------------------------- 圖
  function radar(axes, series, size) {
    const W = size || 520, C = W / 2, R = C - 95, n = axes.length, ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
    const P = (i, v) => [C + R * (v / 100) * Math.cos(ang(i)), C + R * (v / 100) * Math.sin(ang(i))];
    let s = '<svg class="radar" viewBox="0 0 ' + W + ' ' + W + '" role="img" aria-label="雷達圖：' + esc(series.map(se => se.name + ' ' + axes.map((a, i) => a + ' ' + sc(se.v[i])).join('、')).join('；')) + '">';
    [25, 50, 75, 100].forEach(g => { s += '<polygon class="rg" points="' + axes.map((_, i) => P(i, g).map(x => x.toFixed(1)).join(',')).join(' ') + '"/>'; });
    axes.forEach((a, i) => { const [x, y] = P(i, 100), [lx, ly] = P(i, 118); s += '<line class="ra" x1="' + C + '" y1="' + C + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>' +
      '<text class="rl" x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" text-anchor="' + (Math.abs(lx - C) < 8 ? 'middle' : lx > C ? 'start' : 'end') + '">' + esc(a) + '</text>'; });
    [50, 100].forEach(g => { const [x, y] = P(0, g); s += '<text class="rt" x="' + (x + 4).toFixed(1) + '" y="' + (y + 12).toFixed(1) + '">' + g + '</text>'; });
    series.slice().reverse().forEach(se => { const k = series.indexOf(se); const pts = se.v.map((v, i) => P(i, v == null ? 0 : v).map(x => x.toFixed(1)).join(',')).join(' ');
      s += '<polygon class="rp' + (k ? '' : ' me') + '" data-k="' + k + '" points="' + pts + '" style="stroke:' + se.c + ';fill:' + se.c + '"/>';
      se.v.forEach((v, i) => { if (v != null) { const [x, y] = P(i, v); s += '<circle class="rd" data-k="' + k + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (k ? 2.6 : 3.6) + '" style="fill:' + se.c + '"><title>' + esc(se.name + '｜' + axes[i] + ' ' + sc(v)) + '</title></circle>'; } }); });
    return s + '</svg>';
  }
  function hbars(items, opt) { // items: [{l, v, me, tip}]，v 為 0～1 或任意正數
    const o = opt || {}, W = 760, bh = 26, L = o.L || 210, Rr = 74, H = 8 + items.length * bh, mx = o.max || Math.max(...items.map(i => Math.abs(i.v || 0)), 1e-9), X = v => L + (W - L - Rr) * v / mx;
    let s = '<svg class="hb" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc((o.title || '') + '：' + items.map(i => i.l + ' ' + (o.fmt ? o.fmt(i.v) : i.v)).join('、')) + '">';
    items.forEach((it, i) => { const y = 4 + i * bh, v = Math.max(0, it.v || 0);
      s += '<text class="viz-lbl" x="' + (L - 8) + '" y="' + (y + bh / 2 + 4) + '" text-anchor="end" font-size="12.5"' + (it.me ? ' font-weight="700"' : '') + '>' + esc(it.l) + '</text>' +
        '<rect x="' + L + '" y="' + (y + 5) + '" width="' + Math.max(1.5, X(v) - L).toFixed(1) + '" height="' + (bh - 10) + '" rx="2" style="fill:' + (it.me ? 'var(--gold)' : 'var(--s-shv)') + '"><title>' + esc(it.tip || it.l) + '</title></rect>' +
        '<text class="viz-lbl" x="' + (X(v) + 6).toFixed(1) + '" y="' + (y + bh / 2 + 4) + '" font-size="12.5"' + (it.me ? ' font-weight="700"' : '') + '>' + esc(o.fmt ? o.fmt(it.v) : it.v) + '</text>'; });
    return s + '</svg>';
  }
  function lines(xs, series, opt) { // series: [{name, v:[...], c, me}]
    const o = opt || {}, W = 760, H = 250, pl = 56, pr = 18, pt = 14, pb = 30, n = xs.length;
    const all = series.flatMap(se => se.v.filter(v => v != null && isFinite(v)));
    if (!all.length || n < 2) return '';
    let lo = Math.min(0, ...all), hi = Math.max(...all); if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.08; lo = lo < 0 ? lo - pad : lo; hi += pad;
    const X = i => pl + (W - pl - pr) * i / (n - 1), Y = v => pt + (H - pt - pb) * (hi - v) / (hi - lo);
    let s = '<svg class="viz" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc((o.title || '') + '：' + series.map(se => se.name + ' ' + se.v.map(v => o.fmt(v)).join('、')).join('；')) + '">';
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); s += '<line class="gl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="viz-lbl" x="' + (pl - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11.5">' + esc(o.fmt(v)) + '</text>'; }
    if (lo < 0 && hi > 0) s += '<line class="ax" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '"/>';
    xs.forEach((x, i) => { s += '<text class="viz-lbl" x="' + X(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="11.5">' + esc(x) + '</text>'; });
    series.slice().reverse().forEach(se => { const pts = se.v.map((v, i) => v == null || !isFinite(v) ? null : X(i).toFixed(1) + ',' + Y(v).toFixed(1)).filter(Boolean);
      if (pts.length > 1) s += '<polyline fill="none" stroke-linejoin="round" stroke-linecap="round" style="stroke:' + se.c + ';stroke-width:' + (se.me ? 3 : 1.8) + '" points="' + pts.join(' ') + '"/>';
      se.v.forEach((v, i) => { if (v != null && isFinite(v)) s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (se.me ? 3.6 : 2.6) + '" style="fill:' + se.c + '"><title>' + esc(se.name + '｜' + xs[i] + '｜' + o.fmt(v)) + '</title></circle>'; }); });
    s += '</svg><div class="legend">' + series.map(se => '<span><i style="background:' + se.c + '"></i>' + esc(se.name) + '</span>').join('') + '</div>';
    return s;
  }
  function vbars(xs, vals, opt) { // 直條（營收、季營收）
    const o = opt || {}, W = 760, H = 230, pl = 74, pr = 12, pt = 18, pb = 30, n = xs.length, mx = Math.max(...vals.filter(v => v != null), 1e-9), bw = (W - pl - pr) / n * 0.62;
    const X = i => pl + (W - pl - pr) * (i + 0.5) / n, Y = v => pt + (H - pt - pb) * (1 - v / mx);
    let s = '<svg class="viz" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc((o.title || '') + '：' + xs.map((x, i) => x + ' ' + o.fmt(vals[i])).join('、')) + '">';
    for (let k = 0; k <= 4; k++) { const v = mx * k / 4, y = Y(v); s += '<line class="gl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="viz-lbl" x="' + (pl - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11">' + esc(o.axis(v)) + '</text>'; }
    xs.forEach((x, i) => { const v = vals[i]; if (v != null && v > 0) s += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + Y(v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (H - pb - Y(v)).toFixed(1) + '" rx="3" style="fill:' + (i === n - 1 ? 'var(--s-fund)' : 'var(--s-shv)') + '"><title>' + esc(x + '｜' + o.fmt(v)) + '</title></rect><text class="viz-lbl" x="' + X(i).toFixed(1) + '" y="' + (Y(v) - 5).toFixed(1) + '" text-anchor="middle" font-size="11.5">' + esc(o.lab ? o.lab(i) : o.fmt(v)) + '</text>';
      s += '<text class="viz-lbl" x="' + X(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="11.5">' + esc(x) + '</text>'; });
    return s + '</svg>';
  }

  // ---------------------------------------------------------------- 技術指標
  const sma = (a, n) => a.map((_, i) => i + 1 < n ? null : a.slice(i + 1 - n, i + 1).reduce((t, x) => t + x, 0) / n);
  const ema = (a, n) => { const k = 2 / (n + 1); let e = null; return a.map(x => (e = e == null ? x : x * k + e * (1 - k))); };
  function rsi(a, n) { // Wilder RSI
    if (a.length <= n) return null; let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (let i = n + 1; i < a.length; i++) { const d = a[i] - a[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  function pxChart(days, closes, ma50, ma200, cur) {
    const W = 760, H = 260, pl = 56, pr = 64, pt = 12, pb = 28, n = closes.length;
    const all = closes.concat(ma50.filter(v => v != null), ma200.filter(v => v != null)), lo = Math.min(...all) * 0.97, hi = Math.max(...all) * 1.03;
    const X = i => pl + (W - pl - pr) * i / (n - 1), Y = v => pt + (H - pt - pb) * (hi - v) / (hi - lo);
    const path = a => a.map((v, i) => v == null ? null : X(i).toFixed(1) + ',' + Y(v).toFixed(1)).filter(Boolean).join(' ');
    let s = '<svg class="viz" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="近 1 年股價：' + esc(days[0] + ' ' + closes[0].toFixed(2) + ' → ' + days[n - 1] + ' ' + closes[n - 1].toFixed(2)) + '">';
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); s += '<line class="gl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="viz-lbl" x="' + (pl - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11">' + v.toFixed(v >= 100 ? 0 : 1) + '</text>'; }
    [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1].forEach(i => { s += '<text class="viz-lbl" x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11">' + esc(days[i].slice(2, 7).replace('-', '/')) + '</text>'; });
    s += '<polyline fill="none" style="stroke:var(--s-shv);stroke-width:1.4;stroke-dasharray:5 4" points="' + path(ma200) + '"/><polyline fill="none" style="stroke:var(--s-qqq);stroke-width:1.6" points="' + path(ma50) + '"/>';
    s += '<polyline fill="none" style="stroke:var(--s-fund);stroke-width:2.2" points="' + path(closes) + '"/>';
    const lv = closes[n - 1]; s += '<circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(lv).toFixed(1) + '" r="3.5" style="fill:var(--s-fund)"/><text class="viz-lbl" x="' + (X(n - 1) + 6).toFixed(1) + '" y="' + (Y(lv) + 4).toFixed(1) + '" font-size="12" font-weight="700">' + lv.toFixed(2) + '</text>';
    return s + '</svg><div class="legend"><span><i style="background:var(--s-fund)"></i>收盤（' + esc(cur) + '）</span><span><i style="background:var(--s-qqq)"></i>50 日均線</span><span><i style="background:var(--s-shv)"></i>200 日均線（虛線）</span></div>';
  }

  // ---------------------------------------------------------------- 主程式
  async function render(code, ctx) {
    const host = document.getElementById('dCo'); if (!host) return;
    host.innerHTML = '<p class="small" style="color:var(--muted)">公司分析資料載入中…</p>';
    const D = await getJ('data/company/' + encodeURIComponent(code) + '.json');
    if (!D) { host.innerHTML = '<p class="small">' + esc(code) + ' 尚未納入公司分析資料（每週更新熱力圖四個指數的成分股）。</p>'; return; }
    const P = (await Promise.all((D.peers || []).map(c => getJ('data/company/' + encodeURIComponent(c) + '.json')))).filter(Boolean);
    const cur = D.cur, m = D.m || {}, S = D.s || {}, nm = D.name, A = D.A || {}, ds = A.d || [], fxNote = D.fin_cur && D.fin_cur !== D.cur ? '（原始財報幣別 ' + D.fin_cur + '，以匯率 ' + (D.fx ? D.fx.toPrecision(4) : '—') + ' 換算 ' + D.cur + '）' : '';
    let h = '';
    // ---- 公司資料 ----
    {
      const pf = (D.tw || {}).profile, rocD = x => String(x || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
      const rowsP = [['市場／幣別', (D.market === 'TW' ? '台灣上市' : '美國上市') + '，股價 ' + D.cur + (D.fin_cur && D.fin_cur !== D.cur ? '、財報 ' + D.fin_cur : '')], ['產業', (D.sector || '—') + (D.industry ? '／' + D.industry : '')], ['市值', money((D.cap_bn || 0) * 1e9, D.cur)], ['最新財報年度', yr(last(ds) || '')]];
      if (pf) rowsP.unshift(['公司全名', pf.full + (pf.en ? '（' + pf.en + '）' : '')]), rowsP.push(['董事長／總經理', pf.chair + '／' + pf.ceo], ['發言人', pf.spokes], ['成立／上市', rocD(pf.est) + '／' + rocD(pf.listed)], ['實收資本額', money(pf.capital, 'TWD')], ['簽證會計師', pf.auditor], ['地址', pf.addr], ['網站', pf.url ? '<a href="' + esc(/^https?:/.test(pf.url) ? pf.url : 'https://' + pf.url) + '" target="_blank" rel="noopener">' + esc(pf.url) + '</a>' : '—']);
      h += '<h3 id="co-prof">公司資料</h3><div class="tblwrap"><table class="tbl"><tbody>' + rowsP.map(r => '<tr><td class="l" style="width:140px">' + esc(r[0]) + '</td><td class="l">' + (String(r[1]).startsWith('<a ') ? r[1] : esc(r[1])) + '</td></tr>').join('') + '</tbody></table></div>' +
        (pf ? '<p class="small">來源：證交所上市公司基本資料。</p>' : '');
    }
    // ---- 優勢與風險（自動清單：同市場百分位前 25%／後 25% 的面向＋關鍵指標門檻）----
    {
      const pros = [], cons = [], add = (arr, t) => { if (arr.length < 6) arr.push(t); };
      Object.keys(DN).map(d => [d, S[d]]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1]).forEach(([d, v]) => { if (v >= 75) add(pros, DN[d] + '在同市場前 ' + Math.max(1, Math.round(100 - v)) + '%（' + Math.round(v) + ' 分）'); });
      Object.keys(DN).map(d => [d, S[d]]).filter(x => x[1] != null).sort((a, b) => a[1] - b[1]).forEach(([d, v]) => { if (v <= 25) add(cons, DN[d] + '在同市場後 ' + Math.max(1, Math.round(v)) + '%（' + Math.round(v) + ' 分）'); });
      if (m.f_score != null) (m.f_score >= 7 ? pros : m.f_score <= 3 ? cons : []).push('Piotroski F 分數 ' + m.f_score + '／9');
      if (m.altman_z != null) (m.altman_z > 2.99 ? pros : m.altman_z < 1.81 ? cons : []).push('Altman Z ' + m.altman_z.toFixed(2) + (m.altman_z > 2.99 ? '（安全區）' : m.altman_z < 1.81 ? '（危險區）' : ''));
      if (m.de != null && m.de > 2) cons.push('負債權益比 ' + m.de.toFixed(2) + ' 倍偏高');
      if (m.shs_chg != null && m.shs_chg > 0.03) cons.push('股數一年增加 ' + (m.shs_chg * 100).toFixed(1) + '%（稀釋）');
      if (m.shs_chg != null && m.shs_chg < -0.01) pros.push('股數一年減少 ' + (-m.shs_chg * 100).toFixed(1) + '%（買回）');
      h += '<h3 id="co-pc">優勢與風險（自動清單）</h3><div class="pc"><div class="pc-p"><b>優勢</b><ul>' + (pros.length ? pros.map(t => '<li>' + esc(t) + '</li>').join('') : '<li>沒有特別突出的面向</li>') + '</ul></div><div class="pc-c"><b>風險</b><ul>' + (cons.length ? cons.map(t => '<li>' + esc(t) + '</li>').join('') : '<li>沒有特別落後的面向</li>') + '</ul></div></div>' +
        '<p class="small">規則：14 個面向中分數 ≥ 75（同市場前 25%）列為優勢、≤ 25（後 25%）列為風險，再加上 Piotroski、Altman Z、負債、股數變化等門檻；全部由資料自動產生，不含主觀判斷。</p>';
    }
    // ---- 雷達圖：與主要對手比較 ----
    const ser = [D].concat(P.slice(0, 4)).map((x, k) => ({ name: x.code + (x.market === 'TW' ? ' ' + x.name : ''), code: x.code, v: RADAR.map(d => (x.s || {})[d] == null ? null : x.s[d]), c: COL[k] }));
    h += '<h3 id="co-radar">與主要競爭對手比較（雷達圖）</h3><p>' + esc(nm) + ' 與同產業市值最大的 ' + P.length + ' 家公司（' + esc(P.map(x => x.code).join('、')) + '），在 ' + RADAR.length + ' 個面向的分數。分數＝在' + (D.market === 'TW' ? '台灣 50 成分股' : '美股（那斯達克 100、標普 500、費城半導體成分股）') + '中的百分位，越外圈越好。</p>';
    h += '<div class="rwrap"><div class="rbox">' + radar(RADAR.map(d => DN[d]), ser) + '</div><div class="rleg">' + ser.map((se, k) => '<label><input type="checkbox" data-k="' + k + '" checked' + (k ? '' : ' disabled') + '><i style="background:' + se.c + '"></i>' + esc(se.name) + '</label>').join('') +
      '<p class="small">勾選可隱藏對手；滑過點看分數。少數面向因產業特性沒有資料（例：銀行沒有毛利率）時畫在中心並在下表標「—」。</p></div></div>';
    // 分數表（14 個面向）
    const DIMS = Object.keys(DN);
    h += '<div class="tblwrap"><table class="tbl sct"><caption>十四個分析面向的分數（0～100，同市場百分位）與 ' + esc(D.code) + ' 的代表指標</caption><thead><tr><th class="l">面向</th>' + ser.map(se => '<th>' + esc(se.code) + '</th>').join('') + '<th class="l">' + esc(D.code) + ' 代表指標</th></tr></thead><tbody>' +
      DIMS.map(d => '<tr><td class="l"><b>' + DN[d] + '</b><br><small>' + esc(DD[d][0]) + '</small></td>' + ser.map((se, k) => { const x = k ? P[k - 1] : D, v = (x.s || {})[d]; return '<td class="scc"><span class="sb" style="--w:' + (v == null ? 0 : v) + '%"></span>' + sc(v) + '</td>'; }).join('') +
        '<td class="l small">' + DD[d][1].map(k => MN[k] + ' ' + fmtM(k, m[k])).join('、') + '</td></tr>').join('') + '</tbody></table></div>';
    // ---- 股價走勢與技術面 ----
    const p1 = (D.p1y || []).filter(x => x[1] != null);
    if (p1.length > 60) {
      const days = p1.map(x => x[0]), cl = p1.map(x => x[1]), m50 = sma(cl, 50), m200 = sma(cl, 200), lv = cl[cl.length - 1];
      const r14 = rsi(cl, 14), e12 = ema(cl, 12), e26 = ema(cl, 26), macd = e12.map((v, i) => v - e26[i]), sig = ema(macd, 9), mh = macd[macd.length - 1] - sig[sig.length - 1];
      const a50 = last(m50), a200 = last(m200), hi = Math.max(...cl), lo = Math.min(...cl);
      const trend = a50 && a200 ? (lv > a50 && a50 > a200 ? '多頭排列（股價 > 50 日線 > 200 日線）' : lv < a50 && a50 < a200 ? '空頭排列（股價 < 50 日線 < 200 日線）' : '盤整（均線交錯）') : '資料不足';
      h += '<h3 id="co-tech">股價走勢與技術面</h3><p>近 1 年 ' + (m.ret_1y >= 0 ? '+' : '') + fmtM('ret_1y', m.ret_1y) + '（還原權息）；距 52 週高點 ' + ((lv / hi - 1) * 100).toFixed(1) + '%、距低點 +' + ((lv / lo - 1) * 100).toFixed(1) + '%。趨勢：<b>' + trend + '</b>。</p>' +
        '<div class="fig">' + pxChart(days, cl, m50, m200, cur) + '</div>' +
        '<div class="kp">' + [['RSI(14)', r14 == null ? '—' : r14.toFixed(1), r14 == null ? '' : r14 >= 70 ? '偏熱（≥ 70）' : r14 <= 30 ? '偏冷（≤ 30）' : '中性（30～70）'],
          ['MACD 柱狀（12,26,9）', mh.toFixed(2), mh > 0 ? '多方（MACD 在訊號線上）' : '空方（MACD 在訊號線下）'],
          ['距 50／200 日線', a50 ? ((lv / a50 - 1) * 100).toFixed(1) + '%' : '—', a200 ? '200 日線 ' + ((lv / a200 - 1) * 100).toFixed(1) + '%' : '200 日線資料不足'],
          ['波動與 Beta', fmtM('vol_1y', m.vol_1y), 'Beta ' + fmtM('beta_1y', m.beta_1y) + '（對 ' + esc(D.bench || '') + '）']].map(k => '<div><small>' + k[0] + '</small><b>' + esc(k[1]) + '</b><span>' + esc(k[2]) + '</span></div>').join('') + '</div>' +
        '<p class="small">技術指標以近 1 年原始日收盤在瀏覽器計算；只描述目前狀態，不是買賣訊號。</p>';
      const ret = a => { const mm = new Map(); for (let i = 1; i < a.length; i++) if (a[i][1] && a[i - 1][1]) mm.set(a[i][0], Math.log(a[i][1] / a[i - 1][1])); return mm; };
      const R0 = ret(p1), corr = (A1, B1) => { const ks = [...A1.keys()].filter(k => B1.has(k)); if (ks.length < 60) return null; const xa = ks.map(k => A1.get(k)), xb = ks.map(k => B1.get(k)), ma = xa.reduce((t, v) => t + v, 0) / xa.length, mb = xb.reduce((t, v) => t + v, 0) / xb.length;
        let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < xa.length; i++) { sab += (xa[i] - ma) * (xb[i] - mb); saa += (xa[i] - ma) ** 2; sbb += (xb[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
      const cs = P.map(x => ({ c: x.code, r: corr(R0, ret((x.p1y || []).filter(y => y[1] != null))) })).filter(x => x.r != null);
      if (cs.length) h += '<p>與對手的股價相關係數（近 1 年日報酬）：' + cs.map(x => esc(x.c) + ' <b>' + x.r.toFixed(2) + '</b>').join('、') + '。越接近 1 代表走勢越同步，分散效果越小。</p>';
    }
    // ---- 股東結構 ----
    h += '<h3 id="co-hold">股東結構：前 10 大持有股東</h3>';
    const tw = D.tw || {};
    if (D.market === 'TW') {
      const out = last(A.shs_out) || (tw.dist && tw.dist.lv['17'] ? tw.dist.lv['17'][1] : null);
      if (tw.top10 && (tw.top10.rows || []).length) {
        h += '<div class="tblwrap"><table class="tbl"><caption>前 10 大股東（公司 ESG 揭露，證交所彙總）</caption><thead><tr><th class="l">#</th><th class="l">股東</th><th>持股（股）</th><th>持股比例</th></tr></thead><tbody>' +
          tw.top10.rows.map((r, i) => '<tr><td class="l">' + (i + 1) + '</td><td class="l">' + esc(r.name) + '</td><td>' + (r.shares ? Math.round(r.shares).toLocaleString('en-US') : '—') + '</td><td>' + (r.pct != null ? r.pct.toFixed(2) + '%' : '—') + '</td></tr>').join('') + '</tbody></table></div>';
      } else if (tw.top10_src) h += '<p>前 10 大股東名冊為公司揭露的 PDF：<a href="' + esc(tw.top10_src) + '" target="_blank" rel="noopener">證交所文件（前 10 大股東持股情形）›</a></p>';
      const dirs = (tw.directors || []).filter(x => x.shares).sort((a, b) => b.shares - a.shares).slice(0, 10);
      if (dirs.length) h += '<div class="tblwrap"><table class="tbl"><caption>董事、監察人與大股東持股（證交所 ' + esc(String(dirs[0].ym || '').replace(/^(\d{3})(\d{2})$/, (_, y, mo) => (+y + 1911) + '-' + mo)) + '）</caption><thead><tr><th class="l">職稱</th><th class="l">姓名</th><th>目前持股（股）</th><th>占已發行股數</th><th>設質比例</th></tr></thead><tbody>' +
        dirs.map(x => '<tr><td class="l">' + esc(x.title) + '</td><td class="l">' + esc(x.name) + '</td><td>' + Math.round(x.shares).toLocaleString('en-US') + '</td><td>' + (out ? (x.shares / out * 100).toFixed(2) + '%' : '—') + '</td><td>' + esc(x.pledge_pct || '—') + '</td></tr>').join('') + '</tbody></table></div>';
      if ((tw.major10 || []).length) h += '<p>持股逾 10% 的大股東：<b>' + esc(tw.major10.join('、')) + '</b>（證交所）。</p>';
      if (tw.dist && tw.dist.lv) { const L = tw.dist.lv, g = ks => ks.reduce((t, k) => t + ((L[k] || [])[2] || 0), 0), cnt = ks => ks.reduce((t, k) => t + ((L[k] || [])[0] || 0), 0);
        const grp = [['散戶（50 張以下）', ['1', '2', '3', '4', '5', '6', '7', '8']], ['中實戶（50～400 張）', ['9', '10', '11']], ['大戶（400～1,000 張）', ['12', '13', '14']], ['千張大戶（1,000 張以上）', ['15']]];
        h += '<div class="fig"><p class="ftitle">股權分散（集保 ' + esc(String(tw.dist.date).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')) + '，占集保庫存比例）</p>' + hbars(grp.map(([l, ks], i) => ({ l: l + '｜' + Math.round(cnt(ks)).toLocaleString('en-US') + ' 人', v: g(ks) / 100, me: i === 3, tip: l })), { max: 1, fmt: v => (v * 100).toFixed(2) + '%', title: '股權分散', L: 250 }) +
          '<p class="fnote">千張大戶比例越高，籌碼越集中在大股東與法人手上。</p></div>'; }
    } else {
      h += '<div class="note"><p><b>美股前 10 大持有股東：資料來源待開通。</b>權威來源是美國證管會（SEC）的 13F 申報；SEC 規定程式抓資料必須附聯絡 email，開通後每季自動更新。其他提供此資料的網站都設有防機器人驗證，本站不繞過這類驗證。</p></div>';
    }
    // ---- 融資融券（台股）----
    if (D.market === 'TW' && (D.tw || {}).margin) { const g = D.tw.margin, out2 = last(A.shs_out);
      h += '<p><b>融資融券（證交所，單位：張）</b>：融資餘額 ' + (g.fin == null ? '—' : Math.round(g.fin).toLocaleString('en-US')) + ' 張（前一日 ' + (g.fin_prev == null ? '—' : Math.round(g.fin_prev).toLocaleString('en-US')) + '）' + (out2 && g.fin != null ? '，占流通股數 ' + (g.fin * 1000 / out2 * 100).toFixed(3) + '%' : '') +
        '；融券餘額 ' + (g.short == null ? '—' : Math.round(g.short).toLocaleString('en-US')) + ' 張（前一日 ' + (g.short_prev == null ? '—' : Math.round(g.short_prev).toLocaleString('en-US')) + '）；券資比 ' + (g.fin ? (g.short / g.fin * 100).toFixed(2) + '%' : '—') + '。</p>'; }
    // ---- 持有本股的 ETF ----
    if ((D.etfs || []).length) {
      h += '<div class="tblwrap"><table class="tbl"><caption>持有 ' + esc(D.code) + ' 的 ETF：本站追蹤的 ' + D.etf_n + ' 檔中，權重最高的 ' + D.etfs.length + ' 檔（各 ETF 每日持股檔）</caption><thead><tr><th class="l">ETF</th><th class="l">名稱</th><th>' + esc(D.code) + ' 占該 ETF</th><th>持股日</th></tr></thead><tbody>' +
        D.etfs.map(e => '<tr><td class="l"><a href="lookthrough.html">' + esc(e[0]) + '</a></td><td class="l">' + esc(e[1]) + '</td><td>' + e[2].toFixed(2) + '%</td><td>' + esc(e[3] || '—') + '</td></tr>').join('') + '</tbody></table></div>';
    }
    // ---- 營收結構 ----
    h += '<h3 id="co-rev">營收結構：營收占比與營收來源</h3>';
    const rv = A.rev || [];
    if (rv.filter(v => v != null).length) {
      const yoy = i => i > 0 && rv[i] && rv[i - 1] ? (rv[i] / rv[i - 1] - 1) : null;
      h += '<div class="fig"><p class="ftitle">年度營收（' + esc(D.fin_cur || cur) + '）與年增率</p>' + vbars(ds.map(yr), rv, { fmt: v => money(v, D.fin_cur || cur), axis: axM, lab: i => (yoy(i) == null ? '' : (yoy(i) >= 0 ? '+' : '') + (yoy(i) * 100).toFixed(0) + '%'), title: '年度營收' }) + '</div>';
      const Q = D.Q || {}; if ((Q.rev || []).filter(v => v != null).length >= 3) h += '<div class="fig"><p class="ftitle">最近 ' + Q.rev.length + ' 季營收（' + esc(D.fin_cur || cur) + '）</p>' + vbars((Q.d || []).map(d => d.slice(0, 7)), Q.rev, { fmt: v => money(v, D.fin_cur || cur), axis: axM, title: '季營收' }) + '</div>';
    }
    if (D.market === 'TW' && tw.monthly) { const mo = tw.monthly, ym = String(mo.ym || '').replace(/^(\d{3})(\d{2})$/, (_, y, x) => (+y + 1911) + ' 年 ' + (+x) + ' 月');
      h += '<p><b>最新月營收（' + esc(ym) + '）</b>：' + money(mo.rev * 1000, 'TWD') + '，月增 ' + (mo.mom >= 0 ? '+' : '') + (mo.mom || 0).toFixed(1) + '%、年增 ' + (mo.yoy >= 0 ? '+' : '') + (mo.yoy || 0).toFixed(1) + '%；今年累計年增 ' + (mo.ytd_yoy >= 0 ? '+' : '') + (mo.ytd_yoy || 0).toFixed(1) + '%。' + (mo.note && mo.note !== '-' ? '公司說明：「' + esc(mo.note) + '」' : '') + '（證交所每月營收彙總）</p>'; }
    h += '<div class="note"><p><b>產品別／地區別營收占比：</b>' + (D.market === 'TW' ? '台股公司的產品別營收只在年報揭露，沒有開放資料可自動更新；上方以年度、季度與月營收呈現營收結構的變化。' : '來源是公司年報（10-K）中的分部資訊，同樣需要 SEC 資料開通後才能自動帶入。') + '</p></div>';
    // ---- 市占率與壟斷性 ----
    const ind = m.ind;
    h += '<h3 id="co-share">市占率與壟斷性</h3>';
    if (ind && ind.top) {
      const hhiTxt = ind.hhi > 1800 ? '高度集中' : '未達高度集中標準';
      h += '<p>在本站涵蓋的「' + esc(ind.group) + '」' + ind.n + ' 家公司中，' + esc(nm) + ' 最新年度營收排第 <b>' + ind.rank + '</b>，占合計 <b>' + (m.share * 100).toFixed(1) + '%</b>' + (m.rel_share != null ? '，是第' + (ind.rank === 1 ? '二大' : '一大') + '的 <b>' + m.rel_share.toFixed(2) + ' 倍</b>' : '') + '。產業集中度 HHI＝<b>' + ind.hhi.toLocaleString('en-US') + '</b>（' + hhiTxt + '）。</p>' +
        '<div class="fig"><p class="ftitle">同產業營收占比（本站涵蓋公司，最新年度' + (D.market === 'US' ? '，非美元財報已換算美元' : '') + '）</p>' + hbars(ind.top.map(t => ({ l: t[0] + '｜' + String(t[1]).slice(0, 18), v: t[2], me: t[0] === D.code })), { max: Math.max(...ind.top.map(t => t[2])), fmt: v => (v * 100).toFixed(1) + '%', title: '同產業營收占比' }) +
        '<p class="fnote">注意：這是「本站涵蓋的上市公司」之間的營收占比，不是全球市占率；未上市或不在四個指數內的競爭者沒有算進來。HHI＝各公司占比（%）平方和，0～10,000；超過 1,800 屬高度集中（美國司法部與聯邦貿易委員會 2023 年合併指引 Guideline 1）。</p></div>';
      h += '<p><b>壟斷性分數 ' + sc(S.monopoly) + '</b>（' + lvl(S.monopoly) + '）：相對市占越高、市占率越高，越接近產業中的主導者；市占率分數 ' + sc(S.share) + '。</p>';
    } else h += '<p class="small">沒有足夠的同產業營收資料。</p>';
    // ---- 訂價權 ----
    const gms = ds.map((_, i) => (A.gp && A.rev && A.gp[i] != null && A.rev[i]) ? A.gp[i] / A.rev[i] : null);
    h += '<h3 id="co-price">訂價權</h3>';
    if (gms.some(v => v != null)) {
      const Y4 = d => String(d || '').slice(0, 4), gmOf = a => new Map((a.d || []).map((d, i) => [Y4(d), a.gp && a.rev && a.gp[i] != null && a.rev[i] ? a.gp[i] / a.rev[i] : null]));
      const peerG = P.slice(0, 4).map((x, k) => ({ name: x.code, map: gmOf(x.A || {}), c: COL[k + 1] })), meG = gmOf(A);
      const xs = [...new Set([...meG.keys()].concat(...peerG.map(p => [...p.map.keys()])))].sort().slice(-5);
      h += '<p><b>訂價權分數 ' + sc(S.pricing) + '</b>（' + lvl(S.pricing) + '）：毛利率 ' + fmtM('gm', m.gm) + '，近 ' + gms.filter(v => v != null).length + ' 年毛利率標準差 ' + fmtM('gm_std', m.gm_std) + '、期間變化 ' + (m.gm_chg == null ? '—' : (m.gm_chg >= 0 ? '+' : '') + (m.gm_chg * 100).toFixed(1) + ' 個百分點') + '。毛利率高且穩定，代表能把成本轉嫁給客戶、不必靠降價搶市場。</p>' +
        '<div class="fig"><p class="ftitle">毛利率走勢：' + esc(D.code) + ' 與對手</p>' + lines(xs, [{ name: D.code, v: xs.map(y => meG.get(y) ?? null), c: COL[0], me: true }].concat(peerG.map(p => ({ name: p.name, v: xs.map(y => p.map.get(y) ?? null), c: p.c }))), { fmt: v => (v * 100).toFixed(0) + '%', title: '毛利率走勢' }) + '<p class="fnote">橫軸＝財報年度結束的年份（各公司會計年度不同，例如 NVDA 年度在 1 月結束）；銀行、保險等沒有毛利的公司不畫。</p></div>';
    } else h += '<p class="small">這家公司的財報沒有毛利（例如銀行、保險），訂價權改看淨利率 ' + fmtM('nm', m.nm) + ' 與 ROE ' + fmtM('roe', m.roe) + '。</p>';
    // ---- 護城河 ----
    h += '<h3 id="co-moat">產業護城河</h3>';
    const moatCls = m.roic_avg == null ? null : (m.roic_avg >= 0.15 && (m.om_std == null || m.om_std < 0.08)) ? '寬護城河' : m.roic_avg >= 0.08 ? '窄護城河' : '沒有明顯護城河';
    h += '<p><b>護城河分數 ' + sc(S.moat) + '</b>（' + lvl(S.moat) + '）' + (moatCls ? '；依本站量化規則屬於 <b>' + moatCls + '</b>' : '') + '：投入資本報酬率近年平均 ' + fmtM('roic_avg', m.roic_avg) + '（最新 ' + fmtM('roic', m.roic) + '）、營業利益率 ' + fmtM('om', m.om) + '（標準差 ' + fmtM('om_std', m.om_std) + '）。</p>' +
      '<p class="small">量化規則：ROIC 近年平均 ≥ 15% 且營業利益率標準差 < 8 個百分點＝寬護城河；ROIC 平均 ≥ 8%＝窄護城河；其餘＝沒有明顯護城河。長期賺到明顯高於資金成本的報酬、而且獲利不大起大落，是護城河存在的財務證據；品牌、專利、網路效應、轉換成本等來源會反映在這些數字上。</p>';
    // ---- 杜邦分析與營運週轉 ----
    {
      const at = i => { const a = A.ta || []; return a[i] != null && a[i - 1] != null ? (a[i] + a[i - 1]) / 2 : a[i]; };
      const eqA = i => { const a = A.eq || []; return a[i] != null && a[i - 1] != null ? (a[i] + a[i - 1]) / 2 : a[i]; };
      const rowsD = ds.map((d, i) => { const r = (A.rev || [])[i], n = (A.ni || [])[i], ta = at(i), e = eqA(i); if (!r || n == null || !ta || !e || e <= 0) return null;
        return { y: yr(d), nm: n / r, atn: r / ta, em: ta / e, roe: n / e }; }).filter(Boolean);
      if (rowsD.length) {
        h += '<h3 id="co-dupont">杜邦分析與營運週轉</h3><p>股東權益報酬率（ROE）＝淨利率 × 資產周轉率 × 權益乘數。拆開看，可以知道 ROE 是靠「賺得多」、「轉得快」還是「借得多」。</p><div class="tblwrap"><table class="tbl"><thead><tr><th class="l">年度</th><th>淨利率</th><th>資產周轉率</th><th>權益乘數</th><th>ROE</th></tr></thead><tbody>' +
          rowsD.map(r => '<tr><td class="l">' + esc(r.y) + '</td><td>' + (r.nm * 100).toFixed(1) + '%</td><td>' + r.atn.toFixed(2) + ' 倍</td><td>' + r.em.toFixed(2) + ' 倍</td><td><b>' + (r.roe * 100).toFixed(1) + '%</b></td></tr>').join('') + '</tbody></table></div>';
        const dso = m.dso, dio = m.inv_turn ? 365 / m.inv_turn : null;
        h += '<p>營運週轉：應收帳款約 <b>' + (dso == null ? '—' : Math.round(dso) + ' 天') + '</b>收回、存貨約 <b>' + (dio == null ? '—' : Math.round(dio) + ' 天') + '</b>賣出（最新年度；天數越短，資金卡在營運的時間越少）。</p>';
      }
    }
    // ---- 歷年估值 ----
    const p5 = new Map((D.p5y || []).map(x => [x[0], x[1]]));
    if ((!D.fin_cur || D.fin_cur === D.cur) && (A.eps || []).some(v => v != null) && p5.size) {
      const pts = ds.map((d, i) => { const px = p5.get(String(d).slice(0, 7)), e = (A.eps || [])[i]; return { y: yr(d), px, e, pe: px && e > 0 ? px / e : null }; }).filter(x => x.px != null);
      if (pts.filter(x => x.pe != null).length >= 2) {
        h += '<h3 id="co-val">歷年估值：財報年度結束時的本益比</h3><div class="fig"><p class="ftitle">本益比＝該月收盤 ÷ 該年度 EPS；最右邊是目前（近四季）</p>' +
          vbars(pts.map(x => x.y).concat(['目前']), pts.map(x => x.pe).concat([m.pe]), { fmt: v => v == null ? '—' : v.toFixed(1) + ' 倍', axis: v => v.toFixed(0) + '倍', title: '歷年本益比' }) + '</div>';
        const pbs = ds.map((d, i) => { const px = p5.get(String(d).slice(0, 7)), e = (A.eq || [])[i], sh = (A.shs_out || A.shs || [])[i]; return px && e > 0 && sh ? px / (e / sh) : null; });
        if (pbs.filter(v => v != null).length >= 2) h += '<div class="fig"><p class="ftitle">股價淨值比＝該月收盤 ÷（股東權益 ÷ 流通股數）；最右邊是目前</p>' +
          vbars(ds.map(yr).concat(['目前']), pbs.concat([m.pb]), { fmt: v => v == null ? '—' : v.toFixed(1) + ' 倍', axis: v => v.toFixed(0) + '倍', title: '歷年股價淨值比' }) + '</div>';
        const pv = pts.map(x => x.pe).filter(v => v != null), avg = pv.reduce((t, v) => t + v, 0) / pv.length;
        h += '<p>過去 ' + pv.length + ' 個年度結束時的本益比平均 <b>' + avg.toFixed(1) + ' 倍</b>（' + Math.min(...pv).toFixed(1) + '～' + Math.max(...pv).toFixed(1) + '）；目前 <b>' + fmtM('pe', m.pe) + '</b>，' + (m.pe == null ? '' : m.pe > avg ? '高於' : '低於') + '自己的歷史平均。</p>';
      }
    }
    // ---- 股利與股東回饋 ----
    const dv = D.divs || [];
    h += '<h3 id="co-div">股利與股東回饋</h3>';
    if (D.divs === undefined) h += '<p class="small">股利紀錄將在下一次資料更新後顯示。</p>';
    else if (dv.length) {
      const byY = {}; dv.forEach(([d, a]) => { byY[d.slice(0, 4)] = (byY[d.slice(0, 4)] || 0) + a; });
      const ys = Object.keys(byY).sort().slice(-6), yNow = String(new Date().getFullYear());
      const yld = m.div_ttm && m.last_px ? m.div_ttm / m.last_px : null;
      h += '<p>近 12 個月現金股利 ' + (m.div_ttm ? m.div_ttm.toFixed(m.div_ttm < 1 ? 3 : 2) + ' ' + esc(cur) + '／股' : '—') + '，殖利率 <b>' + (yld == null ? '—' : (yld * 100).toFixed(2) + '%') + '</b>；加上股票買回，股東回饋率（÷ 市值）' + fmtM('sh_yield', m.sh_yield) + '，占淨利 ' + fmtM('payout', m.payout) + '。</p>' +
        '<div class="fig"><p class="ftitle">每年現金股利（每股，' + esc(cur) + '；' + yNow + ' 年為目前已發放）</p>' + vbars(ys, ys.map(y => byY[y]), { fmt: v => v.toFixed(v < 1 ? 3 : 2), axis: v => v.toFixed(v < 1 ? 2 : 1), title: '每年現金股利' }) + '</div>';
    } else h += '<p>近 5 年沒有發放現金股利' + (m.sh_yield ? '；股東回饋主要靠股票買回，回饋率（÷ 市值）' + fmtM('sh_yield', m.sh_yield) : '') + '。</p>';
    // ---- 關鍵指標 ----
    h += '<h3 id="co-kpi">關鍵指標</h3>';
    const fz = m.f_score, az = m.altman_z, peg = (m.pe && m.eps_yoy > 0) ? m.pe / (m.eps_yoy * 100) : null;
    const K = [['Piotroski F 分數', fz == null ? '—' : fz + ' / 9', fz == null ? '資料不足' : fz >= 7 ? '強（≥ 7）' : fz >= 4 ? '普通（4～6）' : '弱（≤ 3）'],
      ['Altman Z 分數', az == null ? '—' : az.toFixed(2), az == null ? '金融業或資料不足不適用' : az > 2.99 ? '安全區（> 2.99）' : az >= 1.81 ? '灰色區（1.81～2.99）' : '危險區（< 1.81）'],
      ['ROIC（投入資本報酬率）', fmtM('roic', m.roic), '近年平均 ' + fmtM('roic_avg', m.roic_avg)],
      ['自由現金流殖利率', fmtM('fcf_yield', m.fcf_yield), '近四季自由現金流 ÷ 市值'],
      ['EV / EBITDA', fmtM('ev_ebitda', m.ev_ebitda), '企業價值 ÷ 近四季 EBITDA'],
      ['本益比（近四季）', fmtM('pe', m.pe), 'PEG ' + (peg == null ? '—' : peg.toFixed(2)) + '（本益比 ÷ EPS 年增%）'],
      ['負債權益比', fmtM('de', m.de), '淨負債／EBITDA ' + fmtM('nd_ebitda', m.nd_ebitda)],
      ['利息保障倍數', fmtM('int_cov', m.int_cov), 'EBIT ÷ 利息費用'],
      ['Beta（近 1 年）', fmtM('beta_1y', m.beta_1y), '年化波動 ' + fmtM('vol_1y', m.vol_1y) + '（對 ' + (D.market === 'TW' ? '0050' : 'SPY') + '）'],
      ['股東回饋率', fmtM('sh_yield', m.sh_yield), '（買回＋股利）÷ 市值；占淨利 ' + fmtM('payout', m.payout)]];
    h += '<div class="kp kp5">' + K.map(k => '<div><small>' + k[0] + '</small><b>' + esc(k[1]) + '</b><span>' + esc(k[2]) + '</span></div>').join('') + '</div>';
    if ((m.f_items || []).length) h += '<details><summary class="small">Piotroski F 分數 9 項檢查明細</summary><ul class="fchk">' + m.f_items.map(([t, ok]) => '<li class="' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓' : '✗') + ' ' + esc(t) + '</li>').join('') + '</ul><p class="small">用最近兩個年度財報比較；滿分 9 分，7 分以上通常代表財務體質在改善。</p></details>';
    // ---- 證交所重大訊息（台股）----
    if (D.market === 'TW' && ((D.tw || {}).ann || []).length) {
      h += '<h3 id="co-ann">最新重大訊息（證交所）</h3><ul class="news">' + D.tw.ann.slice(0, 6).map(a => '<li><b>' + esc(a.t) + '</b><small>' + esc(String(a.d).replace(/^(\d{3})(\d{2})(\d{2})$/, (_, y, mo, dd) => (+y + 1911) + '-' + mo + '-' + dd)) + '</small><details><summary class="small">說明</summary><p class="small" style="white-space:pre-line">' + esc(a.body) + '</p></details></li>').join('') + '</ul>';
    }
    // ---- 財務摘要 ----
    const rows = [['營收', 'rev'], ['毛利', 'gp'], ['營業利益', 'opi'], ['淨利', 'ni'], ['EPS（稀釋）', 'eps'], ['營業現金流', 'ocf'], ['資本支出', 'capex'], ['自由現金流', 'fcf'], ['研發費用', 'rnd'], ['股票買回', 'buyback'], ['現金股利', 'div'], ['總資產', 'ta'], ['股東權益', 'eq'], ['總負債（借款）', 'debt'], ['現金', 'cash']];
    h += '<h3 id="co-fin">財務摘要（年度）</h3><div class="tblwrap"><table class="tbl"><caption>' + esc(D.fin_cur || cur) + '，' + esc(fxNote ? '原始財報幣別' : '') + '資料：Yahoo Finance</caption><thead><tr><th class="l">項目</th>' + ds.map(d => '<th>' + esc(yr(d)) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.filter(r => (A[r[1]] || []).some(v => v != null)).map(r => '<tr><td class="l">' + r[0] + '</td>' + ds.map((_, i) => { const v = (A[r[1]] || [])[i]; return '<td>' + (v == null ? '—' : r[1] === 'eps' ? v.toFixed(2) : money(v, D.fin_cur || cur).replace(/(美元|台幣|[A-Z]{3})$/, '')) + '</td>'; }).join('') + '</tr>').join('') +
      '<tr><td class="l">毛利率</td>' + ds.map((_, i) => '<td>' + (gms[i] == null ? '—' : (gms[i] * 100).toFixed(1) + '%') + '</td>').join('') + '</tr>' +
      '<tr><td class="l">營業利益率</td>' + ds.map((_, i) => { const v = A.opi && A.rev && A.opi[i] != null && A.rev[i] ? A.opi[i] / A.rev[i] : null; return '<td>' + (v == null ? '—' : (v * 100).toFixed(1) + '%') + '</td>'; }).join('') + '</tr></tbody></table></div>' +
      '<p class="small"><a href="#" class="csvdl" data-kind="fin">下載年度財報 CSV</a>　<a href="#" class="csvdl" data-kind="px">下載近 1 年日收盤 CSV</a>　<a href="#" class="csvdl" data-kind="score">下載 14 面向分數 CSV</a></p>';
    // ---- 資料來源與算法（放在整個分析的最後：#dCoSrc）----
    let src = '<h3 id="co-src">資料來源與算法</h3><ul class="small">' + (D.src || []).map(s => '<li><a href="' + esc(s.u) + '" target="_blank" rel="noopener">' + esc(s.t) + '</a></li>').join('') +
      '<li>分數：每個面向由 1～4 個指標組成；每個指標先在同一市場的所有公司中排百分位（方向相反的指標先取負號），再取平均。資料更新：' + esc(String(D.updated).slice(0, 10)) + fxNote + '。</li></ul>';
    host.innerHTML = h;
    const sh = document.getElementById('dCoSrc'); if (sh) sh.innerHTML = src;
    // CSV 下載（在瀏覽器產生，不經伺服器）
    host.querySelectorAll('.csvdl').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const k = a.dataset.kind; let rowsC = [];
      if (k === 'fin') { const keys = Object.keys(A).filter(x => x !== 'd'); rowsC = [['項目（' + (D.fin_cur || cur) + '）'].concat(ds)].concat(keys.map(x => [x].concat(ds.map((_, i) => (A[x] || [])[i] ?? '')))); }
      else if (k === 'px') rowsC = [['日期', '收盤（' + cur + '）']].concat((D.p1y || []).map(x => [x[0], x[1]]));
      else rowsC = [['面向'].concat(ser.map(se => se.code))].concat(Object.keys(DN).map(d => [DN[d]].concat(ser.map((se, kk) => { const x = kk ? P[kk - 1] : D; return (x.s || {})[d] ?? ''; }))));
      const csv = '\ufeff' + rowsC.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), dl = document.createElement('a'); dl.href = url; dl.download = 'BNASDAQ-' + D.code + '-' + k + '.csv'; document.body.appendChild(dl); dl.click(); dl.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }));
    // 雷達圖勾選
    host.querySelectorAll('.rleg input[data-k]').forEach(cb => cb.addEventListener('change', () => { const k = cb.dataset.k; host.querySelectorAll('.radar [data-k="' + k + '"]').forEach(el => { el.style.display = cb.checked ? '' : 'none'; }); }));
    if (ctx && ctx.toc) ctx.toc();
  }
  BN.company = { render };
})();
