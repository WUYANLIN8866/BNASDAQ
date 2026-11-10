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
  const GLOS = [
    ['同業', '同一市場（美股／台股）、同一產業中市值最大的 5 家；不足 5 家時用同一大類補足。'],
    ['市占率、相對市占、HHI', '市占率＝最新年度營收 ÷ 本站涵蓋同產業公司營收合計；相對市占＝本公司營收 ÷ 同產業另一家最大公司的營收；HHI＝各公司營收占比（%）平方和（0～10,000，> 1,800 為高度集中，美國司法部與聯邦貿易委員會 2023 年合併指引）。'],
    ['毛利率、營業利益率、淨利率', '毛利、營業利益、淨利各自 ÷ 營收；超過 ±150% 視為資料異常不畫。'],
    ['ROE、ROA', '淨利 ÷ 最近兩個年度平均股東權益（ROA 用平均總資產）。'],
    ['ROIC', 'EBIT ×（1 − 有效稅率）÷ 投入資本；有效稅率＝所得稅 ÷ 稅前淨利，限制在 0～35%，算不出時用 21%。'],
    ['營收 3 年年化成長', '（最新年度營收 ÷ 3 年前營收）^(1/3) − 1。'],
    ['自由現金流率、現金轉換、應計比率', '自由現金流 ÷ 營收；營業現金流 ÷ 淨利；（淨利 − 營業現金流）÷ 平均總資產。'],
    ['負債權益比、流動比、利息保障', '借款 ÷ 股東權益；流動資產 ÷ 流動負債；EBIT ÷ 利息費用。'],
    ['淨負債 ÷ EBITDA', '（借款 − 現金及短期投資）÷ EBITDA；財報沒有短期投資合計時用現金及約當現金。'],
    ['Altman Z', '1.2 × 營運資金 ÷ 總資產 ＋ 1.4 × 保留盈餘 ÷ 總資產 ＋ 3.3 × EBIT ÷ 總資產 ＋ 0.6 × 市值 ÷ 總負債 ＋ 1.0 × 營收 ÷ 總資產；金融業不適用。> 2.99 安全區、< 1.81 危險區。'],
    ['Piotroski F', '9 項各 1 分：ROA 為正、營業現金流為正、ROA 提升、現金流大於淨利、負債比下降、流動比提升、沒有增發股數（增加 ≤ 0.5%）、毛利率提升、資產周轉提升；用最近兩個年度比較。'],
    ['本益比、股價營收比、股價淨值比', '市值 ÷ 近四季淨利；市值 ÷ 近四季營收；市值 ÷ 最新股東權益。'],
    ['EV/EBITDA、FCF 殖利率', '（市值 ＋ 借款 − 現金及短期投資）÷ 近四季 EBITDA；近四季自由現金流 ÷ 市值。'],
    ['股東回饋率', '（最新年度股票買回 ＋ 現金股利）÷ 市值；占淨利＝同一金額 ÷ 淨利。'],
    ['報酬、波動、Beta', '近 1 年報酬用還原權息收盤；年化波動＝日對數報酬標準差 × √252；Beta＝個股與基準（美股 SPY、台股 0050）日報酬的共變異數 ÷ 基準變異數。'],
    ['技術指標', '50／200 日均線為原始收盤簡單平均；RSI(14) 用 Wilder 平滑；MACD＝12 日 EMA − 26 日 EMA，訊號線＝MACD 的 9 日 EMA。'],
    ['本益比河流圖', '月收盤 ÷ 當時已公布 EPS：年度 EPS 在會計年度結束 3 個月後、近四季 EPS 在季度結束 2 個月後才採用；倍數取月本益比第 10、30、50、70、90 百分位。'],
    ['護城河分類', 'ROIC 近年平均 ≥ 15% 且營業利益率標準差 < 8 個百分點＝寬護城河；ROIC 平均 ≥ 8%＝窄護城河；其餘＝沒有明顯護城河。'],
    ['14 面向分數', '每個指標在同一市場所有公司中排百分位（越低越好的指標先取負號），面向分數＝所屬指標百分位的平均，0～100。'],
    ['幣別', '財報幣別與股價幣別不同時（例：TSM 財報為台幣），估值與跨公司比較先用最新匯率換成股價幣別；財報表格保留原始幣別。']
  ];
  const roc = x => String(x || '').trim().replace(/^(\d{3})(\d{2})(\d{2})$/, (_, y, m, d) => (+y + 1911) + '-' + m + '-' + d);
  const nz = x => { const v = parseFloat(String(x == null ? '' : x).replace(/[,%+\s]/g, '')); return isFinite(v) ? v : null; };

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
    let lo = o.nozero ? Math.min(...all) : Math.min(0, ...all), hi = Math.max(...all); if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.08; lo = (lo < 0 || o.nozero) ? lo - pad : lo; hi += pad;
    const X = i => pl + (W - pl - pr) * i / (n - 1), Y = v => pt + (H - pt - pb) * (hi - v) / (hi - lo);
    let s = '<svg class="viz" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc((o.title || '') + '：' + series.map(se => se.name + ' ' + se.v.filter(v => v != null && isFinite(v)).map(v => o.fmt(v)).join('、')).join('；')) + '">';
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); s += '<line class="gl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="viz-lbl" x="' + (pl - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11.5">' + esc(o.fmt(v)) + '</text>'; }
    if (lo < 0 && hi > 0) s += '<line class="ax" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '"/>';
    xs.forEach((x, i) => { s += '<text class="viz-lbl" x="' + X(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="11.5">' + esc(x) + '</text>'; });
    series.slice().reverse().forEach(se => { const pts = se.v.map((v, i) => v == null || !isFinite(v) ? null : X(i).toFixed(1) + ',' + Y(v).toFixed(1)).filter(Boolean);
      if (pts.length > 1) s += '<polyline fill="none" stroke-linejoin="round" stroke-linecap="round" style="stroke:' + se.c + ';stroke-width:' + (se.me ? 3 : 1.8) + '" points="' + pts.join(' ') + '"/>';
      if (!o.nodots) se.v.forEach((v, i) => { if (v != null && isFinite(v)) s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (se.me ? 3.6 : 2.6) + '" style="fill:' + se.c + '"><title>' + esc(se.name + '｜' + xs[i] + '｜' + o.fmt(v)) + '</title></circle>'; }); });
    s += '</svg><div class="legend">' + series.map(se => '<span><i style="background:' + se.c + '"></i>' + esc(se.name) + '</span>').join('') + '</div>';
    return s;
  }
  function vbars(xs, vals, opt) { // 直條（營收、季營收）
    const o = opt || {}, W = 760, H = 230, pl = 74, pr = 12, pt = 18, pb = 30, n = xs.length, mx = Math.max(...vals.filter(v => v != null), 1e-9), bw = (W - pl - pr) / n * 0.62;
    const X = i => pl + (W - pl - pr) * (i + 0.5) / n, Y = v => pt + (H - pt - pb) * (1 - v / mx);
    let s = '<svg class="viz" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc((o.title || '') + '：' + xs.map((x, i) => x + ' ' + (vals[i] == null ? '—' : o.fmt(vals[i]))).join('、')) + '">';
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
  function pxChart(days, closes, mas, cur, mon) { // mas: [{v, name, c, w, dash}]；mon＝月線
    const W = 760, H = 260, pl = 56, pr = 64, pt = 12, pb = 28, n = closes.length;
    const all = closes.concat(...mas.map(a => a.v.filter(v => v != null))), lo = Math.min(...all) * 0.97, hi = Math.max(...all) * 1.03;
    const X = i => pl + (W - pl - pr) * i / Math.max(1, n - 1), Y = v => pt + (H - pt - pb) * (hi - v) / (hi - lo);
    const path = a => a.map((v, i) => v == null ? null : X(i).toFixed(1) + ',' + Y(v).toFixed(1)).filter(Boolean).join(' ');
    let s = '<svg class="viz" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="股價走勢：' + esc(days[0] + ' ' + closes[0].toFixed(2) + ' → ' + days[n - 1] + ' ' + closes[n - 1].toFixed(2)) + '">';
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); s += '<line class="gl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="viz-lbl" x="' + (pl - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11">' + v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) + '</text>'; }
    const lab = d => !mon && n <= 70 ? d.slice(5).replace('-', '/') : d.slice(2, 7).replace('-', '/');
    [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1])].forEach(i => { s += '<text class="viz-lbl" x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11">' + esc(lab(days[i])) + '</text>'; });
    mas.forEach(a => { const p = path(a.v); if (p.indexOf(' ') > 0) s += '<polyline fill="none" style="stroke:' + a.c + ';stroke-width:' + a.w + (a.dash ? ';stroke-dasharray:5 4' : '') + '" points="' + p + '"/>'; });
    s += '<polyline fill="none" style="stroke:var(--s-fund);stroke-width:2.2" points="' + path(closes) + '"/>';
    const lv = closes[n - 1]; s += '<circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(lv).toFixed(1) + '" r="3.5" style="fill:var(--s-fund)"/><text class="viz-lbl" x="' + (X(n - 1) + 6).toFixed(1) + '" y="' + (Y(lv) + 4).toFixed(1) + '" font-size="12" font-weight="700">' + lv.toFixed(2) + '</text>';
    return s + '</svg><div class="legend"><span><i style="background:var(--s-fund)"></i>收盤（' + esc(cur) + '）</span>' + mas.filter(a => a.v.some(v => v != null)).map(a => '<span><i style="background:' + a.c + '"></i>' + esc(a.name) + '</span>').join('') + '</div>';
  }
  function river(rows, mults, cur) { // 本益比河流圖：rows [{m, px, e}]；mults 由小到大
    const W = 760, H = 290, pl = 56, pr = 70, pt = 12, pb = 28, n = rows.length;
    const bands = mults.map(k => rows.map(r => r.e > 0 ? r.e * k : null));
    const pxs = rows.map(r => r.px), lo = Math.max(0, Math.min(...pxs) * 0.55), hi = Math.max(...pxs) * 1.5;   // 縱軸以股價為準，超出範圍的河道裁掉
    const X = i => pl + (W - pl - pr) * i / Math.max(1, n - 1), Y = v => pt + (H - pt - pb) * (hi - v) / (hi - lo);
    let s = '<svg class="viz" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="本益比河流圖：' + esc(rows[0].m + '～' + rows[n - 1].m + '，股價與 ' + mults.join('、') + ' 倍本益比') + '">' +
      '<defs><clipPath id="rvclip"><rect x="' + pl + '" y="' + pt + '" width="' + (W - pl - pr) + '" height="' + (H - pt - pb) + '"/></clipPath></defs>';
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); s += '<line class="gl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="viz-lbl" x="' + (pl - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11">' + v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) + '</text>'; }
    [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1])].forEach(i => { s += '<text class="viz-lbl" x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11">' + esc(rows[i].m.slice(2, 7).replace('-', '/')) + '</text>'; });
    const runs = ok => { const out = []; let seg = []; rows.forEach((_, i) => { if (ok(i)) seg.push(i); else { if (seg.length > 1) out.push(seg); seg = []; } }); if (seg.length > 1) out.push(seg); return out; };
    s += '<g clip-path="url(#rvclip)">';
    for (let j = 0; j < bands.length - 1; j++) runs(i => bands[j][i] != null && bands[j + 1][i] != null).forEach(seg => {
      const up = seg.map(i => X(i).toFixed(1) + ',' + Y(bands[j + 1][i]).toFixed(1)), dn = seg.slice().reverse().map(i => X(i).toFixed(1) + ',' + Y(bands[j][i]).toFixed(1));
      s += '<polygon points="' + up.concat(dn).join(' ') + '" style="fill:var(--s-qld);fill-opacity:' + (0.06 + 0.06 * j).toFixed(2) + ';stroke:none"/>'; });
    const labs = [], above = [], below = [];
    bands.forEach((b, j) => { runs(i => b[i] != null).forEach(seg => { s += '<polyline fill="none" style="stroke:var(--s-qld);stroke-width:1;stroke-opacity:.75" points="' + seg.map(i => X(i).toFixed(1) + ',' + Y(b[i]).toFixed(1)).join(' ') + '"/>'; });
      const e = b[n - 1]; if (e == null) return; if (e > hi) above.push(mults[j]); else if (e < lo) below.push(mults[j]); else labs.push([Y(e), mults[j] + ' 倍']); });
    s += '</g>';
    if (above.length) s += '<text class="viz-lbl" x="' + (W - pr - 6) + '" y="' + (pt + 14) + '" text-anchor="end" font-size="11">↑ 超出圖表：' + esc(above.join('、')) + ' 倍</text>';
    if (below.length) s += '<text class="viz-lbl" x="' + (W - pr - 6) + '" y="' + (H - pb - 6) + '" text-anchor="end" font-size="11">↓ 低於圖表：' + esc(below.join('、')) + ' 倍</text>';
    labs.sort((a, b) => a[0] - b[0]); for (let k = 1; k < labs.length; k++) if (labs[k][0] - labs[k - 1][0] < 12) labs[k][0] = labs[k - 1][0] + 12;
    labs.forEach(([y, t]) => { s += '<text class="viz-lbl" x="' + (W - pr + 6) + '" y="' + (y + 4).toFixed(1) + '" font-size="11">' + esc(t) + '</text>'; });
    s += '<polyline fill="none" style="stroke:var(--s-fund);stroke-width:2.2" points="' + rows.map((r, i) => X(i).toFixed(1) + ',' + Y(r.px).toFixed(1)).join(' ') + '"/>';
    rows.forEach((r, i) => { s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(r.px).toFixed(1) + '" r="' + (i === n - 1 ? 3.6 : 2.2) + '" style="fill:var(--s-fund)"><title>' + esc(r.m + '｜收盤 ' + r.px.toFixed(2) + ' ' + cur + '｜EPS ' + r.e.toFixed(2) + '（' + r.src + '）｜本益比 ' + (r.e > 0 ? (r.px / r.e).toFixed(1) + ' 倍' : '—（EPS 為負）')) + '</title></circle>'; });
    return s + '</svg><div class="legend"><span><i style="background:var(--s-fund)"></i>月收盤（' + esc(cur) + '）</span><span><i style="background:var(--s-qld)"></i>EPS × 本益比倍數（顏色越深倍數越高）</span></div>';
  }

  // ---------------------------------------------------------------- 主程式
  async function render(code, ctx) {
    const host = document.getElementById('dCo'); if (!host) return;
    host.innerHTML = '<p class="small" style="color:var(--muted)">公司分析資料載入中…</p>';
    const D = await getJ('data/company/' + encodeURIComponent(code) + '.json');
    if (!D) { host.innerHTML = '<p class="small">' + esc(code) + ' 尚未納入公司分析資料（每週更新熱力圖四個指數的成分股）。</p>'; return; }
    const P = (await Promise.all((D.peers || []).map(c => getJ('data/company/' + encodeURIComponent(c) + '.json')))).filter(Boolean);
    const INS = D.market === 'TW' ? await getJ('data/company/_tw_insider.json') : null;   // 台股內部人轉讓申報（本站每日累積）
    const cur = D.cur, m = D.m || {}, S = D.s || {}, nm = D.name, A = D.A || {}, ds = A.d || [], fxNote = D.fin_cur && D.fin_cur !== D.cur ? '（原始財報幣別 ' + D.fin_cur + '，以匯率 ' + (D.fx ? D.fx.toPrecision(4) : '—') + ' 換算 ' + D.cur + '）' : '';
    let h = '';
    // ---- 公司資料 ----
    {
      const pf = (D.tw || {}).profile, rocD = x => String(x || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
      const rowsP = [['市場／幣別', (D.market === 'TW' ? '台灣上市' : '美國上市') + '，股價 ' + D.cur + (D.fin_cur && D.fin_cur !== D.cur ? '、財報 ' + D.fin_cur : '')], ['產業', (D.sector || '—') + (D.industry ? '／' + D.industry : '')], ['市值', money((D.cap_bn || 0) * 1e9, D.cur)], ['最新財報年度', yr(last(ds) || '')]];
      if (pf) rowsP.unshift(['公司全名', pf.full + (pf.en ? '（' + pf.en + '）' : '')]), rowsP.push(['董事長／總經理', pf.chair + '／' + pf.ceo], ['發言人', pf.spokes], ['成立／上市', rocD(pf.est) + '／' + rocD(pf.listed)], ['實收資本額', money(pf.capital, 'TWD')], ['簽證會計師', pf.auditor], ['地址', pf.addr], ['網站', pf.url ? '<a href="' + esc(/^https?:/.test(pf.url) ? pf.url : 'https://' + pf.url) + '" target="_blank" rel="noopener">' + esc(pf.url) + '</a>' : '—']);
      const gv = (D.tw || {}).gov, ag = (D.tw || {}).agm;
      if (gv && gv.dual) rowsP.push(['董事長兼任總經理', gv.dual]);
      if (ag && ag.d) rowsP.push(['最近一次股東會', roc(ag.d) + (ag.type ? '（' + ag.type + '）' : '')]);
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
      ((D.tw || {}).alert || []).forEach(a => cons.push('證交所公布為' + (a.kind === 'punish' ? '處置' : '注意') + '股票（' + roc(a.d) + (a.period ? '，處置期間 ' + a.period : '') + '）'));
      ((D.tw || {}).fsc || []).forEach(a => cons.push('金管會證期局裁罰（' + roc(a.d) + '）：' + a.act));
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
    // ---- 同業關鍵數據對照（實際數值）----
    const ALL = [D].concat(P), dy = x => (x.m || {}).div_ttm && (x.m || {}).last_px ? x.m.div_ttm / x.m.last_px : null;
    const RW = [['市值', x => (x.cap_bn || 0) * 1e9 || null, 0, v => money(v, cur)], ['本益比（近四季）', 'pe', -1], ['股價營收比', 'ps', -1], ['EV/EBITDA', 'ev_ebitda', -1], ['股價淨值比', 'pb', -1],
      ['營收年增', 'rev_yoy', 1], ['營收 3 年年化', 'rev_cagr3', 1], ['毛利率', 'gm', 1], ['營業利益率', 'om', 1], ['淨利率', 'nm', 1], ['ROE', 'roe', 1], ['ROIC', 'roic', 1], ['FCF 殖利率', 'fcf_yield', 1],
      ['負債權益比', 'de', -1], ['現金殖利率', dy, 1, v => (v * 100).toFixed(2) + '%'], ['近 1 年報酬', 'ret_1y', 1], ['年化波動', 'vol_1y', -1], ['Beta', 'beta_1y', 0]];
    const rv0 = (r, x) => { const v = typeof r[1] === 'function' ? r[1](x) : (x.m || {})[r[1]]; return v == null || !isFinite(v) ? null : v; };
    const rf = (r, v) => v == null ? '—' : r[3] ? r[3](v) : fmtM(r[1], v);
    const med = a => { const v = a.filter(x => x != null).sort((p, q) => p - q); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
    const peerTbl = RW.map(r => { const vs = ALL.map(x => rv0(r, x)), ok = vs.map((v, i) => v != null && !(r[1] === 'pe' && v <= 0) ? i : -1).filter(i => i >= 0);
      const best = r[2] && ok.length > 1 ? ok.reduce((b, i) => (r[2] > 0 ? vs[i] > vs[b] : vs[i] < vs[b]) ? i : b, ok[0]) : -1; return { r, vs, best, md: med(vs.slice(1)) }; }).filter(x => x.vs.some(v => v != null));
    if (P.length) h += '<h3 id="co-peers">同業關鍵數據對照</h3><div class="tblwrap"><table class="tbl ptb"><caption>' + esc(nm) + ' 與 ' + P.length + ' 家主要對手的實際數值（粗體＝該列最好；中位數不含本公司）</caption><thead><tr><th class="l">項目</th>' + ALL.map((x, i) => '<th' + (i ? '' : ' class="me"') + '>' + esc(x.code) + '</th>').join('') + '<th>同業中位數</th></tr></thead><tbody>' +
      peerTbl.map(t => '<tr><td class="l">' + esc(t.r[0]) + '</td>' + t.vs.map((v, i) => '<td' + (i ? '' : ' class="me"') + '>' + (i === t.best ? '<b>' + rf(t.r, v) + '</b>' : rf(t.r, v)) + '</td>').join('') + '<td>' + rf(t.r, t.md) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="small">估值與報酬用各公司資料更新日的股價；財報比率用最新年度（本益比、股價營收比、FCF 殖利率用近四季）。「最好」只是數字方向（例如本益比越低越好），不代表投資建議。</p>';
    // ---- 股價走勢與技術面 ----
    let pxDraw = null;
    const p1 = (D.p1y || []).filter(x => x[1] != null);
    if (p1.length > 60) {
      const days = p1.map(x => x[0]), cl = p1.map(x => x[1]), m50 = sma(cl, 50), m200 = sma(cl, 200), lv = cl[cl.length - 1];
      const r14 = rsi(cl, 14), e12 = ema(cl, 12), e26 = ema(cl, 26), macd = e12.map((v, i) => v - e26[i]), sig = ema(macd, 9), mh = macd[macd.length - 1] - sig[sig.length - 1];
      const a50 = last(m50), a200 = last(m200), hi = Math.max(...cl), lo = Math.min(...cl);
      const pos = hi > lo ? (lv - lo) / (hi - lo) * 100 : 50;
      const r52 = '<div class="r52" role="img" aria-label="' + esc('52 週收盤區間 ' + lo.toFixed(2) + '～' + hi.toFixed(2) + '，目前 ' + lv.toFixed(2)) + '"><span>52 週低 ' + lo.toFixed(2) + '</span><div class="r52b"><i style="left:' + pos.toFixed(1) + '%"></i></div><span>52 週高 ' + hi.toFixed(2) + '</span></div>';
      const PER = [['1m', '1 個月'], ['3m', '3 個月'], ['6m', '6 個月'], ['ytd', '今年以來'], ['1y', '1 年'], ['5y', '5 年（月線）']];
      pxDraw = key => {
        const box = document.getElementById('pxFig'); if (!box) return;
        const tail = (d0, p0, d1, pv) => '<p class="fnote">期間報酬 <b>' + (pv / p0 - 1 >= 0 ? '+' : '') + ((pv / p0 - 1) * 100).toFixed(1) + '%</b>（' + esc(d0) + ' 收盤 ' + p0.toFixed(2) + ' → ' + esc(d1) + ' ' + pv.toFixed(2) + '；原始收盤，未含股利）</p>';
        if (key === '5y') {
          const mp = new Map(); (D.p5y || []).forEach(x => { if (x[1] != null) mp.set(x[0], x[1]); });
          const mk = [...mp.keys()], mc = mk.map(k => mp.get(k));
          box.innerHTML = mc.length < 13 ? '<p class="small">5 年月線資料將在下一次資料更新後顯示。</p>' : '<p class="ftitle">近 5 年月收盤（' + esc(cur) + '；最後一點為本月至今）</p>' + pxChart(mk, mc, [{ v: sma(mc, 10), name: '10 個月均線（約 200 日）', c: 'var(--s-shv)', w: 1.4, dash: true }], cur, true) + tail(mk[0], mc[0], mk[mk.length - 1], mc[mc.length - 1]);
        } else {
          const N = cl.length; let i0 = key === '1m' ? N - 21 : key === '3m' ? N - 63 : key === '6m' ? N - 126 : key === 'ytd' ? days.findIndex(d => d >= days[N - 1].slice(0, 4) + '-01-01') : 0;
          i0 = Math.min(Math.max(0, i0), N - 2);
          const sl = a => a.slice(i0);
          box.innerHTML = '<p class="ftitle">' + esc(PER.find(p => p[0] === key)[1]) + '日收盤（' + esc(cur) + '）</p>' + pxChart(sl(days), sl(cl), [{ v: sl(m50), name: '50 日均線', c: 'var(--s-qqq)', w: 1.6 }, { v: sl(m200), name: '200 日均線（虛線）', c: 'var(--s-shv)', w: 1.4, dash: true }], cur) + tail(days[i0], cl[i0], days[N - 1], cl[N - 1]);
        }
        host.querySelectorAll('.pxsel button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === key)));
      };
      const trend = a50 && a200 ? (lv > a50 && a50 > a200 ? '多頭排列（股價 > 50 日線 > 200 日線）' : lv < a50 && a50 < a200 ? '空頭排列（股價 < 50 日線 < 200 日線）' : '盤整（均線交錯）') : '資料不足';
      h += '<h3 id="co-tech">股價走勢與技術面</h3><p>近 1 年 ' + (m.ret_1y >= 0 ? '+' : '') + fmtM('ret_1y', m.ret_1y) + '（還原權息）；距 52 週高點 ' + ((lv / hi - 1) * 100).toFixed(1) + '%、距低點 +' + ((lv / lo - 1) * 100).toFixed(1) + '%。趨勢：<b>' + trend + '</b>。</p>' +
        r52 + '<div class="pxsel" role="group" aria-label="股價走勢期間">' + PER.map(p => '<button type="button" data-p="' + p[0] + '" aria-pressed="' + (p[0] === '1y') + '">' + p[1] + '</button>').join('') + '</div><div class="fig" id="pxFig"></div>' +
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
      // 與對手的相對走勢：每週取一點，起點＝100
      const wk = days.filter((_, i) => i % 5 === 0 || i === days.length - 1), base = new Map(p1);
      const relS = [{ name: D.code, m: base, c: COL[0], me: true }].concat(P.slice(0, 4).map((x, k) => ({ name: x.code, m: new Map((x.p1y || []).filter(y => y[1] != null)), c: COL[k + 1] })));
      const relV = relS.map(se => { let b0 = null; return { name: se.name, c: se.c, me: se.me, v: wk.map(d => { const v = se.m.get(d); if (v == null) return null; if (b0 == null) b0 = v; return v / b0 * 100; }) }; });
      if (relV.filter(x => x.v.filter(v => v != null).length > 10).length >= 2) h += '<div class="fig"><p class="ftitle">近 1 年相對走勢（起點＝100，原始收盤、未含股利）</p>' + lines(wk.map(d => d.slice(2, 7).replace('-', '/')).map((x, i, a) => (i % Math.ceil(a.length / 6) === 0 || i === a.length - 1) ? x : ''), relV, { fmt: v => v.toFixed(0), title: '近 1 年相對走勢', nozero: true, nodots: true }) + '</div>';
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
      if (INS) { const ir = (INS.rows || []).filter(r => r.c === D.code).slice(0, 10), since = roc(INS.since);
        h += ir.length ? '<div class="tblwrap"><table class="tbl"><caption>內部人持股轉讓申報（證交所每日公布；本站自 ' + esc(since) + ' 起累積，最近 ' + ir.length + ' 筆）</caption><thead><tr><th class="l">申報日</th><th class="l">身分</th><th class="l">姓名</th><th class="l">類別</th><th>股數</th><th class="l">方式／理由</th><th class="l">有效期間</th></tr></thead><tbody>' +
          ir.map(r => '<tr><td class="l">' + esc(roc(r.d)) + '</td><td class="l">' + esc(r.who) + '</td><td class="l">' + esc(r.name) + '</td><td class="l">' + (r.kind === '轉讓' ? '預定轉讓' : '申報後未轉讓') + '</td><td>' + Math.round(r.sh || 0).toLocaleString('en-US') + '</td><td class="l">' + esc(r.kind === '轉讓' ? (r.how || '—') + (r.to ? ' → ' + r.to : '') : (r.why || '—')) + '</td><td class="l">' + esc(r.period ? r.period.split('~').map(roc).join('～') : '—') + '</td></tr>').join('') + '</tbody></table></div>'
          : '<p class="small">內部人持股轉讓申報：證交所每天只公布當天的申報，本站自 ' + esc(since) + ' 起每日累積，目前沒有 ' + esc(D.code) + ' 的紀錄。</p>'; }
      if (tw.qfii && tw.qfii.pct != null) h += '<p>外資及陸資持股 <b>' + tw.qfii.pct.toFixed(2) + '%</b>（集中市場外資持股比率前 20 名中第 ' + tw.qfii.rank + ' 名；投資上限 ' + (tw.qfii.limit == null ? '—' : tw.qfii.limit + '%') + '，證交所）。</p>';
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
      if ((Q.eps || []).filter(v => v != null).length >= 3 && Q.eps.every(v => v == null || v > 0)) h += '<div class="fig"><p class="ftitle">最近 ' + Q.eps.length + ' 季每股盈餘（EPS，' + esc(D.fin_cur || cur) + '）</p>' + vbars((Q.d || []).map(d => d.slice(0, 7)), Q.eps, { fmt: v => v.toFixed(2), axis: v => v.toFixed(v < 10 ? 1 : 0), title: '季 EPS' }) + '</div>';
    }
    if (D.market === 'TW' && tw.monthly) { const mo = tw.monthly, ym = String(mo.ym || '').replace(/^(\d{3})(\d{2})$/, (_, y, x) => (+y + 1911) + ' 年 ' + (+x) + ' 月');
      h += '<p><b>最新月營收（' + esc(ym) + '）</b>：' + money(mo.rev * 1000, 'TWD') + '，月增 ' + (mo.mom >= 0 ? '+' : '') + (mo.mom || 0).toFixed(1) + '%、年增 ' + (mo.yoy >= 0 ? '+' : '') + (mo.yoy || 0).toFixed(1) + '%；今年累計年增 ' + (mo.ytd_yoy >= 0 ? '+' : '') + (mo.ytd_yoy || 0).toFixed(1) + '%。' + (mo.note && mo.note !== '-' ? '公司說明：「' + esc(mo.note) + '」' : '') + '（證交所每月營收彙總）</p>'; }
    h += '<div class="note"><p><b>產品別／地區別營收占比：</b>' + (D.market === 'TW' ? '台股公司的產品別營收只在年報揭露，沒有開放資料可自動更新；上方以年度、季度與月營收呈現營收結構的變化。' : '來源是公司年報（10-K）中的分部資訊，同樣需要 SEC 資料開通後才能自動帶入。') + '</p></div>';
    // ---- 財報三率 ----
    {
      let drop = 0;
      const rate = (X, k) => (X.d || []).map((_, i) => { if (!(X[k] && X.rev && X[k][i] != null && X.rev[i])) return null; const v = X[k][i] / X.rev[i]; if (Math.abs(v) > 1.5) { drop++; return null; } return v; });
      const RS = [['毛利率', 'gp', COL[0]], ['營業利益率', 'opi', COL[1]], ['淨利率', 'ni', COL[2]]], Q = D.Q || {};
      const serA = RS.map(([n, k, c], j) => ({ name: n, v: rate(A, k), c, me: j === 0 })).filter(se => se.v.filter(v => v != null).length >= 2);
      const serQ = RS.map(([n, k, c], j) => ({ name: n, v: rate(Q, k), c, me: j === 0 })).filter(se => se.v.filter(v => v != null).length >= 2);
      if (serA.length) {
        const two = se => { const v = se.v.filter(x => x != null); return [v[v.length - 1], v.length >= 2 ? v[v.length - 1] - v[v.length - 2] : null]; };
        const pp = d => d == null ? '—' : (d >= 0 ? '+' : '−') + Math.abs(d * 100).toFixed(1) + ' 個百分點';
        const ch = serA.map(se => two(se)[1]), dir = serA.length < 3 ? '' : ch.every(x => x > 0) ? '三率同步上升' : ch.every(x => x < 0) ? '三率同步下降' : '三率互有升降';
        h += '<h3 id="co-rates">財報三率</h3><p>最新年度 ' + serA.map(se => { const [v, d] = two(se); return se.name + ' <b>' + (v * 100).toFixed(1) + '%</b>（較前一年 ' + pp(d) + '）'; }).join('、') + (dir ? '：<b>' + dir + '</b>' : '') + '。毛利率反映產品與訂價；營業利益率再扣掉研發、管銷；淨利率再扣掉利息、稅與業外損益。</p>' +
          '<div class="fig"><p class="ftitle">年度財報三率</p>' + lines(ds.map(yr), serA, { fmt: v => (v * 100).toFixed(0) + '%', title: '年度財報三率' }) + '</div>' +
          (serQ.length ? '<div class="fig"><p class="ftitle">最近 ' + (Q.d || []).length + ' 季財報三率</p>' + lines((Q.d || []).map(d => d.slice(0, 7)), serQ, { fmt: v => (v * 100).toFixed(0) + '%', title: '季度財報三率' }) + '</div>' : '') +
          (drop ? '<p class="fnote">有 ' + drop + ' 個數值超過 ±150%（多半是該期營收資料異常），圖中不畫。</p>' : '');
      }
    }
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
    // ---- 財務安全 ----
    {
      const g = (k, i) => (A[k] || [])[i];
      let tlFb = false, sti = false;
      const rowsS = ds.map((d, i) => { const ca = g('ca', i), cl = g('cl', i), debt = g('debt', i), eq = g('eq', i), ta = g('ta', i), eb = g('ebitda', i);
        let tl = g('tl', i); if (tl == null && ta != null && eq != null) { tl = ta - eq; tlFb = true; }
        let cash = g('cash_sti', i); if (cash != null) sti = true; else cash = g('cash', i);
        const ie = g('intexp', i), ebit = g('ebit', i) != null ? g('ebit', i) : g('opi', i);
        return { y: yr(d), cr: ca != null && cl ? ca / cl : null, dr: tl != null && ta ? tl / ta : null, de: debt != null && eq > 0 ? debt / eq : null, nc: cash != null && debt != null ? cash - debt : null, ic: ebit != null && ie ? ebit / Math.abs(ie) : null, nd: debt != null && cash != null && eb > 0 ? (debt - cash) / eb : null }; })
        .filter(r => [r.cr, r.dr, r.de, r.ic, r.nd].some(v => v != null));
      if (rowsS.length) {
        const f2 = (v, u) => v == null ? '—' : v.toFixed(2) + (u || ''), L = rowsS[rowsS.length - 1], fc = D.fin_cur || cur;
        h += '<h3 id="co-safe">財務安全</h3><p>最新年度（' + esc(L.y) + '）：流動比 <b>' + f2(L.cr, ' 倍') + '</b>、負債比 <b>' + (L.dr == null ? '—' : (L.dr * 100).toFixed(1) + '%') + '</b>、' + (L.nc == null ? '' : L.nc >= 0 ? '現金比借款多 <b>' + money(L.nc, fc) + '</b>（淨現金）' : '借款比現金多 <b>' + money(-L.nc, fc) + '</b>（淨負債）') + (L.ic == null ? '' : '、利息保障 <b>' + (L.ic >= 100 ? Math.round(L.ic) : L.ic.toFixed(1)) + ' 倍</b>') + '。</p>' +
          '<div class="tblwrap"><table class="tbl"><thead><tr><th class="l">年度</th><th>流動比</th><th>負債比</th><th>借款 ÷ 權益</th><th>淨現金（現金 − 借款）</th><th>利息保障倍數</th><th>淨負債 ÷ EBITDA</th></tr></thead><tbody>' +
          rowsS.map(r => '<tr><td class="l">' + esc(r.y) + '</td><td>' + f2(r.cr, ' 倍') + '</td><td>' + (r.dr == null ? '—' : (r.dr * 100).toFixed(1) + '%') + '</td><td>' + f2(r.de, ' 倍') + '</td><td>' + (r.nc == null ? '—' : money(r.nc, fc)) + '</td><td>' + (r.ic == null ? '—' : (r.ic >= 100 ? Math.round(r.ic) : r.ic.toFixed(1)) + ' 倍') + '</td><td>' + (r.nd == null ? '—' : r.nd.toFixed(2) + ' 倍') + '</td></tr>').join('') + '</tbody></table></div>' +
          '<p class="small">現金＝' + (sti ? '現金、約當現金與短期投資' : '現金及約當現金（財報沒有提供短期投資合計）') + (tlFb ? '；財報沒有總負債時，負債比用（總資產 − 股東權益）÷ 總資產' : '') + '。流動比＝流動資產 ÷ 流動負債；負債比＝總負債 ÷ 總資產；利息保障倍數＝EBIT ÷ 利息費用；淨負債 ÷ EBITDA 為負代表現金多於借款。銀行、保險的資產負債結構不同，這些比率不適合跨產業比較。</p>';
      }
    }
    // ---- 現金流與盈餘品質 ----
    {
      const fc = D.fin_cur || cur, col = k => ds.map((_, i) => { const v = (A[k] || [])[i]; return v == null ? null : v; });
      const serC = [{ name: '營業現金流', v: col('ocf'), c: COL[0], me: true }, { name: '自由現金流', v: col('fcf'), c: COL[2] }, { name: '淨利', v: col('ni'), c: COL[1] }].filter(se => se.v.filter(v => v != null).length >= 2);
      if (serC.length >= 2) {
        const both = ds.map((_, i) => (A.fcf || [])[i] != null && (A.ni || [])[i] != null ? [A.fcf[i], A.ni[i]] : null).filter(Boolean), sf = both.reduce((t, x) => t + x[0], 0), sn = both.reduce((t, x) => t + x[1], 0);
        const cx = last(A.capex), r0 = last(A.rev);
        h += '<h3 id="co-cash">現金流與盈餘品質</h3><p>' + (both.length ? '近 ' + both.length + ' 個年度累計自由現金流 ' + money(sf, fc) + '，' + (sn > 0 ? '是同期累計淨利的 <b>' + (sf / sn * 100).toFixed(0) + '%</b>' : '同期累計淨利為負') + '。' : '') +
          (cx != null && r0 ? '最新年度資本支出占營收 <b>' + (Math.abs(cx) / r0 * 100).toFixed(1) + '%</b>。' : '') + '自由現金流＝營業現金流 − 資本支出；長期接近或高於淨利，代表帳上獲利有真的收到現金。</p>' +
          '<div class="fig"><p class="ftitle">營業現金流、自由現金流與淨利（' + esc(fc) + '）</p>' + lines(ds.map(yr), serC, { fmt: axM, title: '現金流與淨利' }) + '</div>';
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
    // ---- 本益比河流圖 ----
    if ((!D.fin_cur || D.fin_cur === D.cur) && (D.p5y || []).length >= 24) {
      const ymI = t => +String(t).slice(0, 4) * 12 + (+String(t).slice(5, 7) - 1), ev = [];
      ds.forEach((d, i) => { const e = (A.eps || [])[i]; if (e != null) ev.push([ymI(d) + 3, e, yr(d) + ' 年度']); });
      const Q = D.Q || {}, qd = Q.d || [], qe = Q.eps || [];
      for (let i = 3; i < qd.length; i++) { const w = [i - 3, i - 2, i - 1, i];
        if (w.every(j => qe[j] != null) && w.slice(1).every((j, k) => { const gap = ymI(qd[j]) - ymI(qd[w[k]]); return gap >= 2 && gap <= 4; })) ev.push([ymI(qd[i]) + 2, w.reduce((t, j) => t + qe[j], 0), '近四季至 ' + qd[i].slice(0, 7)]); }
      ev.sort((a, b) => a[0] - b[0]);
      const mp = new Map(); D.p5y.forEach(x => { if (x[1] != null) mp.set(x[0], x[1]); });
      const at = t => { let r = null; ev.forEach(x => { if (x[0] <= t) r = x; }); return r; };
      const rowsR = [...mp.entries()].map(([mo, px]) => { const e = at(ymI(mo)); return e ? { m: mo, px, e: e[1], src: e[2] } : null; }).filter(Boolean);
      const pes = rowsR.filter(r => r.e > 0).map(r => r.px / r.e).sort((a, b) => a - b);
      if (rowsR.length >= 18 && pes.length >= 18) {
        const q = p => pes[Math.round(p * (pes.length - 1))], rd = v => v >= 20 ? Math.round(v) : Math.round(v * 10) / 10;
        const mults = [...new Set([0.1, 0.3, 0.5, 0.7, 0.9].map(q).map(rd))];
        const L = rowsR[rowsR.length - 1], cpe = L.e > 0 ? L.px / L.e : null, rank = cpe == null ? null : pes.filter(v => v <= cpe).length / pes.length;
        h += '<h3 id="co-river">本益比河流圖</h3><p>近 ' + rowsR.length + ' 個月，股價 ÷ 當時已公布的每股盈餘（EPS）大多落在 <b>' + mults[0] + '～' + mults[mults.length - 1] + ' 倍</b>（第 10～90 百分位）。' +
          (cpe == null ? '目前 EPS 為負，不計算本益比。' : '最新月約 <b>' + cpe.toFixed(1) + ' 倍</b>（用 ' + esc(L.src) + ' EPS ' + L.e.toFixed(2) + '），這段期間有 <b>' + Math.round((1 - rank) * 100) + '%</b> 的月份本益比比現在高。') + '</p>' +
          '<div class="fig">' + river(rowsR, mults, cur) + '<p class="fnote">縱軸範圍以股價為準，超出範圍的河道以 ↑／↓ 標示。每條河道線＝當時 EPS × 固定倍數；倍數取這段期間月本益比的第 10、30、50、70、90 百分位。EPS 的採用時間模擬財報公布：年度 EPS 在會計年度結束 3 個月後、近四季 EPS 在季度結束 2 個月後才採用，避免用到當時還不知道的數字。股價為月收盤（已調整分割、未含股利）；與上方「近四季本益比」的計算時點不同，數字可能略有差異。</p></div>';
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
    if (D.market === 'TW' && ((D.tw || {}).divpol || []).length) {
      const dp = D.tw.divpol.slice().sort((a, b) => (String(b.span) + b.bd).localeCompare(String(a.span) + a.bd)).slice(0, 6), sp = x => String(x || '').split('~').map(roc).join('～');
      h += '<div class="tblwrap"><table class="tbl"><caption>股利分派決議（證交所彙總，最近 ' + dp.length + ' 筆）</caption><thead><tr><th class="l">股利所屬期間</th><th class="l">進度</th><th>董事會日期</th><th>現金股利（元／股）</th><th>股票股利（元／股）</th><th>現金股利總額</th></tr></thead><tbody>' +
        dp.map(x => '<tr><td class="l">' + esc(sp(x.span) || (x.yr + ' ' + x.per)) + '</td><td class="l">' + esc(x.stage) + '</td><td>' + esc(roc(x.bd) || '—') + '</td><td>' + (x.cash ? x.cash.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : '0') + '</td><td>' + (x.stock ? x.stock.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : '0') + '</td><td>' + (x.total ? money(x.total, 'TWD') : '—') + '</td></tr>').join('') + '</tbody></table></div>';
    }
    if (D.market === 'TW' && ((D.tw || {}).exdiv || []).length) h += '<p><b>即將除權息（證交所預告）</b>：' + D.tw.exdiv.map(x => esc(roc(x.d)) + ' 除' + esc(x.type) + (x.cash ? '，現金股利 ' + x.cash + ' 元' : '') + (x.stock ? '，配股率 ' + x.stock : '')).join('；') + '。</p>';
    // ---- ESG 與公司治理 ----
    h += '<h3 id="co-esg">ESG 與公司治理</h3>';
    const E = (D.tw || {}).esg;
    if (D.market === 'TW' && E) {
      const g = (o, k) => (o || {})[k], fmtN = (v, u) => v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 }) + (u || '');
      const repY = (E.ghg || E.board || E.people || {})['報告年度'], yTxt = repY ? (+repY + 1911) + ' 年度（民國 ' + repY + ' 年）' : '最近一年';
      const ver = v => v ? '（取得驗證：' + v + '）' : '';
      const pS = v => { const x = nz(v); return x == null ? (v || '—') : (+x.toFixed(2)) + '%'; };
      const env = [], soc = [], gov = [];
      if (E.ghg) { const x = E.ghg; env.push(['溫室氣體 範疇一', fmtN(nz(g(x, '範疇一排放量(噸CO2e)')), ' 噸 CO₂e') + (g(x, '範疇一取得驗證') === '是' ? '（已驗證）' : '')], ['範疇二（外購電力等）', fmtN(nz(g(x, '範疇二排放量(噸CO2e)')), ' 噸 CO₂e')], ['範疇三（價值鏈）', fmtN(nz(g(x, '範疇三排放量(噸CO2e)')), ' 噸 CO₂e')], ['排放密集度', fmtN(nz(g(x, '溫室氣體排放密集度(噸CO2e/單位)')), '')]); }
      if (E.energy) env.push(['再生能源使用率', pS(g(E.energy, '使用率(再生能源/總能源)')) + ver(g(E.energy, '取得驗證'))]);
      if (E.water) env.push(['用水量', fmtN(nz(g(E.water, '用水量(公噸)')), ' 公噸')], ['用水密集度', fmtN(nz(g(E.water, '用水密集度-密集度(公噸/單位)')), ' ' + (g(E.water, '用水密集度-單位') || ''))]);
      if (E.waste) env.push(['廢棄物（有害／非有害）', fmtN(nz(g(E.waste, '有害廢棄物量-數據(公噸)')), '') + '／' + fmtN(nz(g(E.waste, '非有害廢棄物量-數據(公噸)')), ' 公噸')]);
      if (E.people) { const x = E.people; soc.push(['員工薪資平均數', fmtN(nz(g(x, '員工薪資平均數(仟元/人)')), ' 千元')], ['非主管全時員工薪資中位數', fmtN(nz(g(x, '非擔任主管之全時員工薪資中位數(仟元/人)')), ' 千元') + (g(x, '非擔任主管職務之全時員工薪資中位數變動百分比') ? '（年變動 ' + pS(g(x, '非擔任主管職務之全時員工薪資中位數變動百分比')) + '）' : '')], ['女性主管占比', pS(g(x, '管理職女性主管佔比'))]); }
      if (E.safety) soc.push(['職業災害', fmtN(nz(g(E.safety, '職業災害人數及比率-人數')), ' 人') + '（' + pS(g(E.safety, '職業災害人數及比率-比率')) + '）']);
      if (E.infosec && g(E.infosec, '資訊外洩事件數量') && g(E.infosec, '資訊外洩事件數量') !== 'N/A') soc.push(['資訊外洩事件', g(E.infosec, '資訊外洩事件數量')]);
      if (E.board) { const x = E.board; gov.push(['董事席次', fmtN(nz(g(x, '董事席次(含獨立董事)(席)')), ' 席') + '（獨立董事 ' + fmtN(nz(g(x, '獨立董事席次(席)')), ' 席') + '、女性 ' + fmtN(nz(g(x, '女性董事席次及比率-席')), ' 席') + '）'], ['董事會出席率', pS(g(x, '董事出席董事會出席率'))]); }
      if (E.comm) gov.push(['審計委員會', fmtN(nz(g(E.comm, '審計委員會席次')), ' 席') + '，出席率 ' + pS(g(E.comm, '審計委員會出席率'))], ['薪酬委員會', fmtN(nz(g(E.comm, '薪酬委員會席次')), ' 席') + '（獨立董事 ' + fmtN(nz(g(E.comm, '薪酬委員會獨立董事席次')), ' 席') + '）']);
      if (E.ir) gov.push(['一年召開法說會', fmtN(nz(g(E.ir, '公司年度召開法說會次數(次)')), ' 次')]);
      const gv = (D.tw || {}).gov || {};
      if (gv.dual) gov.push(['董事長兼任總經理', gv.dual]);
      if (gv.pay && gv.pay.pct != null) gov.push(['董事酬金占稅後淨利', gv.pay.pct.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + '%' + (gv.pay.pct2 != null ? '（含兼任員工酬金 ' + gv.pay.pct2.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + '%）' : '')], ['平均每位董事酬金', gv.pay.avg == null ? '—' : money(gv.pay.avg, 'TWD')]);
      if (E.anti && nz(g(E.anti, '因與反競爭行為條例相關的法律訴訟而造成的金錢損失總額(仟元)')) != null) gov.push(['反競爭訴訟損失', fmtN(nz(g(E.anti, '因與反競爭行為條例相關的法律訴訟而造成的金錢損失總額(仟元)')), ' 千元')]);
      const card = (t, rows) => '<div><b>' + t + '</b><dl>' + (rows.length ? rows.map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') : '<dt>—</dt><dd>公司未揭露</dd>') + '</dl></div>';
      h += '<p>公司依證交所規定揭露的 ' + esc(yTxt) + ' ESG 資料（原始數字，未經本站評分）。不同產業的排放、用水規模差很大，請和同產業比較。</p><div class="esg">' + card('環境（E）', env) + card('社會（S）', soc) + card('治理（G）', gov) + '</div>';
    } else if (D.market === 'TW') h += '<p class="small">ESG 資料將在下一次資料更新後顯示。</p>';
    else h += '<div class="note"><p><b>美股 ESG 與公司治理：</b>美國沒有像證交所這樣免費、可自動更新的官方 ESG 彙總資料；常見的 ESG 評分（MSCI、Sustainalytics 等）是付費授權資料，本站不提供評分。董事會組成與高階主管薪酬在公司向 SEC 申報的委託書（DEF 14A），需 SEC 資料開通後才能自動帶入。</p></div>';
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
    // ---- 官方數字核對（台股：證交所公布值 vs 本站計算值）----
    if (D.market === 'TW' && ((D.tw || {}).twse_val || (D.tw || {}).twse_margin)) {
      const tv = D.tw.twse_val || {}, tm = D.tw.twse_margin, Q = D.Q || {}, qn = (Q.d || []).length - 1;
      const qr = k => qn >= 0 && Q[k] && Q.rev && Q[k][qn] != null && Q.rev[qn] ? Q[k][qn] / Q.rev[qn] * 100 : null;
      const dyUs = m.div_ttm && m.last_px ? m.div_ttm / m.last_px * 100 : null, rowsV = [];
      if (tv.pe != null || m.pe != null) rowsV.push(['本益比', tv.pe == null ? '—（虧損或未公布）' : tv.pe.toFixed(2) + ' 倍', fmtM('pe', m.pe), '證交所＝收盤 ÷ 已申報財報的近四季 EPS；本站＝市值 ÷ Yahoo 近四季淨利' + (D.T_d ? '（截至 ' + D.T_d + '）' : '') + '；兩邊採用的季度或淨利口徑不同就會有差異']);
      if (tv.dy != null || dyUs != null) rowsV.push(['殖利率', tv.dy == null ? '—' : tv.dy.toFixed(2) + '%', dyUs == null ? '—' : dyUs.toFixed(2) + '%', '證交所依公司公告的股利計算；本站＝近 12 個月已除息現金股利 ÷ 收盤']);
      if (tv.pb != null || m.pb != null) rowsV.push(['股價淨值比', tv.pb == null ? '—' : tv.pb.toFixed(2) + ' 倍', fmtM('pb', m.pb), '證交所用最新一季淨值；本站用最新年度股東權益']);
      if (tm && tm.y) { const lab = (+tm.y + 1911) + ' 年第 ' + tm.q + ' 季', qd = String((Q.d || [])[qn] || '').slice(0, 7);
        [['毛利率', 'gm', 'gp'], ['營業利益率', 'om', 'opi'], ['稅後純益率', 'nm', 'ni']].forEach(([n, k1, k2]) => { if (tm[k1] != null) rowsV.push([n + '（' + lab + '）', tm[k1].toFixed(2) + '%', qr(k2) == null ? '—' : qr(k2).toFixed(2) + '%（' + qd + ' 季）', '證交所營益分析（公司已申報才有）；本站為 Yahoo 季報數字，季別不同時不能直接比']); }); }
      if (rowsV.length) h += '<div class="tblwrap"><table class="tbl"><caption>官方數字核對：證交所公布值 vs 本站計算值' + (tv.d ? '（證交所 ' + esc(roc(tv.d)) + '）' : '') + '</caption><thead><tr><th class="l">項目</th><th>證交所</th><th>本站</th><th class="l">差異原因</th></tr></thead><tbody>' +
        rowsV.map(r => '<tr><td class="l">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td><td class="l small">' + esc(r[3]) + '</td></tr>').join('') + '</tbody></table></div>';
    }
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
      '';
    h += '<h3 id="co-dl">資料下載（CSV）</h3><p class="dlrow">' + [['fin', '年度財報'], ['q', '季度財報'], ['px', '近 1 年日收盤'], ['m5', '近 5 年月收盤'], ['div', '現金股利紀錄'], ['peer', '同業關鍵數據'], ['score', '14 面向分數']]
      .map(k => '<a href="#" class="csvdl btn ghost" data-kind="' + k[0] + '">' + k[1] + '</a>').join('') + '</p><p class="small">檔案在你的瀏覽器裡產生（UTF-8，Excel 可直接開啟），數字與本頁相同，可自行驗算；財報金額為原始報表幣別（' + esc(D.fin_cur || cur) + '），股價為 ' + esc(cur) + '。</p>';
    // ---- 資料來源與算法（放在整個分析的最後：#dCoSrc）----
    let src = '<h3 id="co-src">資料來源與算法</h3><ul class="small">' + (D.src || []).map(s => '<li><a href="' + esc(s.u) + '" target="_blank" rel="noopener">' + esc(s.t) + '</a></li>').join('') +
      '<li>分數：每個面向由 1～4 個指標組成；每個指標先在同一市場的所有公司中排百分位（方向相反的指標先取負號），再取平均。資料更新：' + esc(String(D.updated).slice(0, 10)) + fxNote + '。</li></ul>' +
      '<details class="glos"><summary>算法總表：本頁每個指標怎麼算</summary><div class="tblwrap"><table class="tbl"><thead><tr><th class="l">指標</th><th class="l">公式與規則</th></tr></thead><tbody>' + GLOS.map(g => '<tr><td class="l"><b>' + esc(g[0]) + '</b></td><td class="l">' + esc(g[1]) + '</td></tr>').join('') + '</tbody></table></div></details>';
    host.innerHTML = h;
    if (pxDraw) { pxDraw('1y'); host.querySelectorAll('.pxsel button').forEach(b => b.addEventListener('click', () => pxDraw(b.dataset.p))); }
    const sh = document.getElementById('dCoSrc'); if (sh) sh.innerHTML = src;
    // CSV 下載（在瀏覽器產生，不經伺服器）
    host.querySelectorAll('.csvdl').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const k = a.dataset.kind; let rowsC = [];
      if (k === 'fin') { const keys = Object.keys(A).filter(x => x !== 'd'); rowsC = [['項目（' + (D.fin_cur || cur) + '）'].concat(ds)].concat(keys.map(x => [x].concat(ds.map((_, i) => (A[x] || [])[i] ?? '')))); }
      else if (k === 'px') rowsC = [['日期', '收盤（' + cur + '）']].concat((D.p1y || []).map(x => [x[0], x[1]]));
      else if (k === 'q') { const Q = D.Q || {}, qk = Object.keys(Q).filter(x => x !== 'd'); rowsC = [['項目（' + (D.fin_cur || cur) + '）'].concat(Q.d || [])].concat(qk.map(x => [x].concat((Q.d || []).map((_, i) => (Q[x] || [])[i] ?? '')))); }
      else if (k === 'm5') { const mp = new Map(); (D.p5y || []).forEach(x => mp.set(x[0], x[1])); rowsC = [['月份', '月收盤（' + cur + '，已調整分割、未含股利）']].concat([...mp.entries()]); }
      else if (k === 'div') rowsC = [['除息日', '每股現金股利（' + cur + '）']].concat(D.divs || []);
      else if (k === 'peer') rowsC = [['項目'].concat(ALL.map(x => x.code)).concat(['同業中位數'])].concat(peerTbl.map(t => [t.r[0]].concat(t.vs.map(v => v ?? '')).concat([t.md ?? ''])));
      else rowsC = [['面向'].concat(ser.map(se => se.code))].concat(Object.keys(DN).map(d => [DN[d]].concat(ser.map((se, kk) => { const x = kk ? P[kk - 1] : D; return (x.s || {})[d] ?? ''; }))));
      const csv = '\ufeff' + rowsC.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), dl = document.createElement('a'); dl.href = url; dl.download = 'BNASDAQ-' + D.code + '-' + k + '.csv'; document.body.appendChild(dl); dl.click(); dl.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }));
    // 雷達圖勾選
    host.querySelectorAll('.rleg input[data-k]').forEach(cb => cb.addEventListener('change', () => { const k = cb.dataset.k; host.querySelectorAll('.radar [data-k="' + k + '"]').forEach(el => { el.style.display = cb.checked ? '' : 'none'; }); }));
    if (ctx && ctx.toc) ctx.toc();
  }
  BN.company = { render };
})();
