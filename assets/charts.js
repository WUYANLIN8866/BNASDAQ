/* BNASDAQ 內嵌 SVG 圖表（無外部函式庫）：折線（含對數）、分組直條、橫條、直方圖、回撤面積。
   設計規則：細線 2px、資料端圓角 4px、網格退後、≥2 條序列一定有圖例（小圖可改用 endNames：名稱排在圖右邊、引線接到線尾）、滑鼠十字線＋提示框、深淺色用 CSS 變數。 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function text(parent, x, y, s, attrs) { const t = el('text', Object.assign({ x, y }, attrs || {}), parent); t.textContent = s; return t; }
  const fmtDef = v => (Math.abs(v) >= 1e8 ? (+(v / 1e8).toFixed(2)).toLocaleString('zh-Hant-TW') + ' 億' : Math.abs(v) >= 1e4 ? (+(v / 1e4).toFixed(Math.abs(v) < 1e5 ? 1 : 0)).toLocaleString('zh-Hant-TW') + ' 萬' : v.toLocaleString('zh-Hant-TW'));
  function niceTicks(lo, hi, n) { const span = hi - lo; if (span <= 0) return [lo]; const step0 = span / (n || 5); const p = Math.pow(10, Math.floor(Math.log10(step0))); const f = step0 / p; const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10)); return out; }
  function logTicks(lo, hi) { const out = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) { const v = Math.pow(10, e); if (v >= lo / 1.0001 && v <= hi * 1.0001) out.push(v); } return out; }
  function frame(host, W, H) { host.innerHTML = ''; const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, host); return svg; }
  function wrapFig(host, o) {
    const fig = document.createElement('div'); fig.className = 'fig';
    if (o.title) { const t = document.createElement('p'); t.className = 'ftitle'; t.textContent = o.title; fig.appendChild(t); }
    if (o.sub) { const s = document.createElement('p'); s.className = 'fsub'; s.textContent = o.sub; fig.appendChild(s); }
    const body = document.createElement('div'); fig.appendChild(body);
    if (o.series && o.series.length > 1 && !o.noLegend) { const lg = document.createElement('div'); lg.className = 'legend'; o.series.forEach(s => { const sp = document.createElement('span'); sp.style.setProperty('--c', s.color); if (s.dash) sp.className = 'dash'; sp.textContent = s.name; lg.appendChild(sp); }); fig.appendChild(lg); }
    if (o.note) { const n = document.createElement('p'); n.className = 'fnote'; n.textContent = o.note; fig.appendChild(n); }
    host.appendChild(fig); return body;
  }
  function hover(svg, pad, W, H, xOf, n, onIdx, onLeave) {
    const line = el('line', { y1: pad.t, y2: H - pad.b, stroke: 'var(--axis)', 'stroke-width': 1, 'stroke-dasharray': '3 3', style: 'display:none' }, svg);
    function pos(ev) { const r = svg.getBoundingClientRect(); const sx = W / r.width; return { x: (ev.clientX - r.left) * sx, cx: ev.clientX, cy: ev.clientY }; }
    svg.addEventListener('mousemove', ev => { const p = pos(ev); if (p.x < pad.l - 6 || p.x > W - pad.r + 6) { line.style.display = 'none'; BN.tip.hide(); onLeave && onLeave(); return; } let best = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = Math.abs(xOf(i) - p.x); if (d < bd) { bd = d; best = i; } } line.setAttribute('x1', xOf(best)); line.setAttribute('x2', xOf(best)); line.style.display = ''; onIdx(best, p.cx, p.cy); });
    svg.addEventListener('mouseleave', () => { line.style.display = 'none'; BN.tip.hide(); onLeave && onLeave(); });
  }

  // 右欄名稱的上下位置：維持線尾由高到低的順序、彼此至少相隔 gap、不超出 [top, bot]，在這些條件下讓每個名稱離自己的線尾最近
  // （保序迴歸：擠在一起的名稱當成一組，整組以平均位置為中心上下排開，不是一路往下推）。全部排不下時才縮小間距。
  function spread(L, gap, top, bot) {
    const n = L.length; if (!n) return L;
    L.sort((a, b) => a.y0 - b.y0);
    const g = n > 1 ? Math.min(gap, Math.max(0, bot - top) / (n - 1)) : gap, B = [];
    L.forEach((l, i) => { B.push({ s: l.y0 - i * g, c: 1 }); while (B.length > 1 && B[B.length - 2].s / B[B.length - 2].c > B[B.length - 1].s / B[B.length - 1].c) { const b = B.pop(), a = B[B.length - 1]; a.s += b.s; a.c += b.c; } });
    let k = 0; B.forEach(b => { for (let j = 0; j < b.c; j++, k++) L[k].y = b.s / b.c + k * g; });
    if (L[0].y < top) L[0].y = top; for (let i = 1; i < n; i++) if (L[i].y < L[i - 1].y + g) L[i].y = L[i - 1].y + g;
    if (L[n - 1].y > bot) { L[n - 1].y = bot; for (let i = n - 2; i >= 0; i--) if (L[i].y > L[i + 1].y - g) L[i].y = L[i + 1].y - g; }
    return L;
  }

  // ---------------- line chart ----------------
  function line(host, o) {
    // 保底（2026-11-24）：兩條以上的序列，卻不放圖例（noLegend）、線尾也標不出名稱（超過 6 條或 noEndLabels，又沒用 endNames／endVals）時，
    // 自動把圖例放回來——圖上不能沒有名稱。動態走勢的每一格（_frame）只取 svg，不需要。
    const bare = !o._frame && o.noLegend && o.series && o.series.length > 1 && !o.endNames && !o.endVals && (o.series.length > 6 || o.noEndLabels);
    const body = wrapFig(host, bare ? Object.assign({}, o, { noLegend: false }) : o);
    // o.endVals＝{ fmt, W, height, padR, minWidth }：游標不在圖上時，每條線的終點標出最新值（數值＋名稱，上下錯開不重疊）；游標移入時隱藏、改看提示框。
    // 畫面寬度小於 minWidth（預設 700px）時字會太小，不畫，改看圖下表格。
    const EV = o.endVals && !(typeof window !== 'undefined' && window.innerWidth < (o.endVals.minWidth || 700)) ? o.endVals : null;
    const W = (EV && EV.W) || o.W || 820, H = (EV && EV.height) || o.height || 360, pad = { l: o.padL || 64, r: EV ? (EV.padR || 200) : (o.padR || 16), t: 14, b: 34 };
    // o.endNames＝true 或 { gap, weight, leader, leaderDash }：不放圖例的小圖用（首頁特色卡）；和 endVals 擇一。每條線的名稱固定排在圖右邊留白那一欄（欄寬＝padR），
    // 名稱前一個同色圓點、一條同色細引線接到線尾；依線尾高低排序，上下錯開不重疊、不超出繪圖區，並盡量貼近自己的線尾（spread）。
    // 不受下面「6 條以內才直接標名稱」的限制（2026-11-24：首頁兩張卡片加到 7、8 條線後名稱整個不見，又沒放圖例）。
    // 名稱用文字色、不用線的顏色（淺色線當文字看不清楚）；放不下欄寬時縮小字級，不裁切。動態走勢播放時名稱留在右欄、引線跟著線頭走。
    const EN = o.endNames ? (typeof o.endNames === 'object' ? o.endNames : {}) : null;
    const svg = frame(body, W, H);
    const n = o.x.length;
    // X 位置：預設一點一格（月線、日線本來就等距）。給 o.xPos（每點的數值位置，例如時間毫秒）就依實際間距排，
    // 資料時密時疏或中斷（例如運算暫停兩天）也不會把不同日期擠在一起；刻度改用 o.xTicksAt＝[[位置, 標籤], …]。
    const P = o.xPos && o.xPos.length === n && o.xPos.every(isFinite) ? o.xPos : null, p0 = P ? P[0] : 0, p1 = P ? P[n - 1] : 0;
    const xAt = v => pad.l + (W - pad.l - pad.r) * (p1 > p0 ? (v - p0) / (p1 - p0) : 0);
    const xOf = P ? i => xAt(P[i]) : i => pad.l + (W - pad.l - pad.r) * (n > 1 ? i / (n - 1) : 0);
    let lo = Infinity, hi = -Infinity;
    o.series.forEach(s => s.values.forEach(v => { if (v != null && isFinite(v) && (!o.log || v > 0)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    if (o.yMin != null) lo = o.yMin; if (o.yMax != null) hi = o.yMax;
    if (!o.log) { const pd = (hi - lo) * 0.06; if (o.zero) lo = Math.min(lo, 0); hi += pd; if (!o.zero) lo -= pd; }
    const yOf = o.log ? v => H - pad.b - (H - pad.t - pad.b) * (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : v => H - pad.b - (H - pad.t - pad.b) * (v - lo) / (hi - lo);
    const g = el('g', { class: 'viz-grid' }, svg); const ticks = o.yTicks ? o.yTicks.filter(v => v >= lo / 1.0001 && v <= hi * 1.0001) : o.log ? logTicks(lo, hi) : niceTicks(lo, hi, 5);
    const yfmt = o.yfmt || fmtDef;
    ticks.forEach(v => { const y = yOf(v); el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y }, g); text(svg, pad.l - 8, y + 4, yfmt(v), { 'text-anchor': 'end', class: 'viz-lbl' }); });
    // x ticks
    const xt = o.xTicks || (() => { const out = []; let last = null; o.x.forEach((s, i) => { const y = String(s).slice(0, 4); if (y !== last) { out.push([i, y]); last = y; } }); const every = Math.ceil(out.length / 13); return out.filter((_, k) => k % every === 0); })();
    const ax = el('g', { class: 'viz-axis' }, svg);
    el('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b }, ax);
    // 刻度標籤不重疊：量實際字寬（圖表還沒顯示量不到時，用字級估計：數字與英文 0.6 字寬、中文 1 字寬），
    // 和前一個保留的標籤重疊（間距不到 4）就拿掉這個標籤
    const tk = P && o.xTicksAt ? o.xTicksAt.filter(([v]) => v >= p0 && v <= p1).map(([v, l]) => [xAt(v), l]) : xt.map(([i, l]) => [xOf(i), l]);
    let lastR = -Infinity;
    tk.forEach(([x, lbl]) => {
      const t = text(svg, x, H - pad.b + 18, lbl, { 'text-anchor': 'middle', class: 'viz-lbl' });
      let w = 0; try { w = t.getComputedTextLength(); } catch (e) { /* 量不到就估計 */ }
      if (!(w > 0)) { const fs = parseFloat(getComputedStyle(t).fontSize) || 13; w = [...String(lbl)].reduce((s, c) => s + (/[⺀-￿]/.test(c) ? 1 : 0.6), 0) * fs; }
      if (x - w / 2 < lastR + 4) { t.remove(); return; }
      lastR = x + w / 2;
    });
    if (o.yTitle) text(svg, 10, pad.t + 2, o.yTitle, { class: 'viz-lbl' });
    // bands (e.g., shaded ranges)
    (o.bands || []).forEach(b => { el('rect', { x: xOf(b.from), y: pad.t, width: Math.max(1, xOf(b.to) - xOf(b.from)), height: H - pad.t - pad.b, fill: b.color || 'rgba(183,121,31,.12)' }, svg); });
    // series
    const dots = [], endLabels = [];
    o.series.forEach(s => {
      let d = '', pen = false;
      s.values.forEach((v, i) => { if (v == null || !isFinite(v) || (o.log && v <= 0)) { pen = false; return; } d += (pen ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1); pen = true; });
      if (s.fill) { let a = '', f0 = -1, f1 = -1; s.values.forEach((v, i) => { if (v == null) return; if (f0 < 0) f0 = i; f1 = i; a += (a ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1); }); if (a) { a += 'L' + xOf(f1).toFixed(1) + ' ' + yOf(o.zero ? 0 : lo).toFixed(1) + 'L' + xOf(f0).toFixed(1) + ' ' + yOf(o.zero ? 0 : lo).toFixed(1) + 'Z'; el('path', { d: a, fill: s.color, 'fill-opacity': .14, stroke: 'none' }, svg); } }   // 面積收在第一／最後一個有值的點（動態走勢播到一半時不會拉一條斜線到圖尾）
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash || null }, svg);
      const dot = el('circle', { r: 4, fill: s.color, stroke: 'var(--paper)', 'stroke-width': 2, style: 'display:none' }, svg); dots.push(dot);
      // direct label at the end (collected, then pushed apart)
      if (!EN && o.series.length <= 6 && !o.noEndLabels) { let li = s.values.length - 1; while (li >= 0 && (s.values[li] == null || !isFinite(s.values[li]))) li--; if (li >= 0) endLabels.push({ x: xOf(li), y: yOf(s.values[li]), t: s.short || s.name, c: s.color }); }
    });
    endLabels.sort((a, b) => a.y - b.y); for (let i = 1; i < endLabels.length; i++) if (endLabels[i].y - endLabels[i - 1].y < 13) endLabels[i].y = endLabels[i - 1].y + 13;
    endLabels.forEach(l => text(svg, Math.min(l.x + 4, W - 2), l.y + 4, l.t, { class: 'viz-txt', 'font-weight': 600, 'text-anchor': (W - l.x) < 70 ? 'end' : 'start', fill: l.c }));
    if (EN) {
      const L = [];
      o.series.forEach(s => { let li = s.values.length - 1; while (li >= 0 && (s.values[li] == null || !isFinite(s.values[li]) || (o.log && s.values[li] <= 0))) li--; if (li >= 0) L.push({ s, x0: xOf(li), y0: yOf(s.values[li]) }); });
      if (L.length) {
        const eng = el('g', { class: 'viz-endnames' }, svg), xe = W - pad.r, bx = xe + 11, lx = bx + 6;
        L.forEach(l => { l.t = text(eng, lx, 0, l.s.short || l.s.name, { class: 'viz-txt', 'font-weight': EN.weight || 600 }); });
        let fs = 12; try { fs = parseFloat(getComputedStyle(L[0].t).fontSize) || 12; } catch (e) { /* 量不到就用預設字級 */ }
        spread(L, EN.gap || fs * 1.08, pad.t + fs * .4, H - pad.b - fs * .3);
        L.forEach(l => {
          el('path', { d: 'M' + (l.x0 + 2).toFixed(1) + ' ' + l.y0.toFixed(1) + 'L' + (xe + 2).toFixed(1) + ' ' + l.y0.toFixed(1) + 'L' + bx.toFixed(1) + ' ' + l.y.toFixed(1), fill: 'none', stroke: l.s.color, 'stroke-width': 1, 'stroke-linejoin': 'round', 'stroke-opacity': EN.leader != null ? EN.leader : .8, 'stroke-dasharray': EN.leaderDash || null }, eng);   // 線尾 → 圓點（圓點後畫，蓋住引線末端）
          el('circle', { cx: bx, cy: l.y.toFixed(1), r: 3, fill: l.s.color }, eng);
          l.t.setAttribute('y', (l.y + fs * .35).toFixed(1));
          let w = 0; try { w = l.t.getComputedTextLength(); } catch (e) { /* 量不到就不縮 */ }
          const room = W - 2 - lx; if (w > room && room > 0) l.t.style.fontSize = (fs * room / w).toFixed(2) + 'px';
        });
      }
    }
    let evg = null;
    if (EV) {
      evg = el('g', { class: 'viz-endvals' }, svg);
      const gap = EV.gap || 15, top = pad.t + 6, bot = H - pad.b - 4, lx = W - pad.r + 22;
      const L = [];
      o.series.forEach(s => { let li = s.values.length - 1; while (li >= 0 && (s.values[li] == null || !isFinite(s.values[li]) || (o.log && s.values[li] <= 0))) li--; if (li >= 0) L.push({ s, x0: xOf(li), y0: yOf(s.values[li]), v: s.values[li] }); });
      L.sort((a, b) => a.y0 - b.y0); L.forEach(l => { l.y = Math.min(Math.max(l.y0, top), bot); });
      for (let i = 1; i < L.length; i++) if (L[i].y < L[i - 1].y + gap) L[i].y = L[i - 1].y + gap;           // 往下推開
      if (L.length && L[L.length - 1].y > bot) { L[L.length - 1].y = bot; for (let i = L.length - 2; i >= 0; i--) if (L[i].y > L[i + 1].y - gap) L[i].y = L[i + 1].y - gap; }   // 超出底部就整串往上收
      L.forEach(l => {
        el('circle', { cx: l.x0, cy: l.y0, r: 3, fill: l.s.color, stroke: 'var(--paper)', 'stroke-width': 1.5 }, evg);
        el('path', { d: 'M' + (l.x0 + 4).toFixed(1) + ' ' + l.y0.toFixed(1) + 'L' + (lx - 12).toFixed(1) + ' ' + l.y0.toFixed(1) + 'L' + (lx - 4).toFixed(1) + ' ' + l.y.toFixed(1), fill: 'none', stroke: l.s.color, 'stroke-width': 1, 'stroke-opacity': EV.leader != null ? EV.leader : .55, 'stroke-dasharray': EV.leaderDash || null }, evg);   // EV.leader／leaderDash：引線透明度與虛線（首頁動態走勢用淡虛線）
        const t = text(evg, lx, l.y + 4, '', { class: 'viz-txt' });
        const a = el('tspan', { fill: l.s.color, 'font-weight': 700 }, t); a.textContent = l.s.mask || EV.fmt(l.v);   // s.mask：不顯示數值、只顯示這段文字（例：會員專屬）
        const b = el('tspan', { dx: 6, class: 'viz-endname' }, t); b.textContent = l.s.mask ? '' : (l.s.short || l.s.name);
      });
    }
    (o.marks || []).forEach(m => { const x = xOf(m.i), y = yOf(m.v); el('circle', { cx: x, cy: y, r: 5, fill: 'var(--paper)', stroke: m.color || 'var(--ink)', 'stroke-width': 2 }, svg); if (m.label) text(svg, x + (m.dx || 8), y + (m.dy || -8), m.label, { class: 'viz-txt', 'font-weight': 600 }); });
    hover(svg, pad, W, H, xOf, n, (i, cx, cy) => {
      let h = '<b>' + (o.xLabel ? o.xLabel(o.x[i]) : o.x[i]) + '</b>';
      const items = o.series.map((s, k) => ({ s, k, v: s.values[i] }));
      items.forEach(({ k, v }) => { if (v == null || !isFinite(v)) { dots[k].style.display = 'none'; return; } dots[k].setAttribute('cx', xOf(i)); dots[k].setAttribute('cy', yOf(v)); dots[k].style.display = ''; });
      // 提示框依該點數值由高到低排列（tipSort:false 可改回序列順序）
      const order = o.tipSort === false ? items : items.slice().sort((a, b) => ((b.v == null || !isFinite(b.v)) ? -Infinity : b.v) - ((a.v == null || !isFinite(a.v)) ? -Infinity : a.v));
      order.forEach(({ s, v }) => { if (v == null || !isFinite(v)) return; h += '<br><span style="color:' + s.color + '">●</span> ' + s.name + '：' + (s.mask || (o.tipfmt || yfmt)(v)); });
      BN.tip.show(h, cx, cy); if (evg) evg.style.display = 'none';
    }, () => { dots.forEach(d => d.style.display = 'none'); if (evg) evg.style.display = ''; });
    return svg;
  }

  // ---------------- grouped vertical bars ----------------
  function bars(host, o) {
    const body = wrapFig(host, o);
    const W = 820, H = o.height || 340, pad = { l: 58, r: 12, t: 16, b: 40 };
    const svg = frame(body, W, H);
    const G = o.groups.length, S = o.series.length;
    let lo = 0, hi = 0; o.series.forEach(s => s.values.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    if (o.yRange) { lo = o.yRange[0]; hi = o.yRange[1]; }   // 動態走勢：座標軸固定為完整資料的範圍
    const span = hi - lo || 1; hi += span * 0.1; if (lo < 0) lo -= span * 0.08;
    const yOf = v => H - pad.b - (H - pad.t - pad.b) * (v - lo) / (hi - lo);
    const g = el('g', { class: 'viz-grid' }, svg); const yfmt = o.yfmt || (v => (v * 100).toFixed(0) + '%');
    niceTicks(lo, hi, 5).forEach(v => { const y = yOf(v); el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y }, g); text(svg, pad.l - 8, y + 4, yfmt(v), { 'text-anchor': 'end', class: 'viz-lbl' }); });
    const ax = el('g', { class: 'viz-axis' }, svg); el('line', { x1: pad.l, x2: W - pad.r, y1: yOf(0), y2: yOf(0) }, ax);
    const gw = (W - pad.l - pad.r) / G, inner = gw * 0.78, bw = Math.max(2, (inner - 2 * (S - 1)) / S);
    const showVal = o.labels !== false && G * S <= 24;
    o.groups.forEach((lbl, gi) => {
      const gx = pad.l + gw * gi + (gw - inner) / 2;
      o.series.forEach((s, si) => {
        const v = s.values[gi]; if (v == null) return; const x = gx + si * (bw + 2); const y0 = yOf(0), y1 = yOf(v); const top = Math.min(y0, y1), h = Math.abs(y1 - y0); const r = Math.min(4, bw / 2, h);
        const d = v >= 0 ? `M${x} ${y0}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + bw - r}Q${x + bw} ${top} ${x + bw} ${top + r}V${y0}Z` : `M${x} ${y0}V${y0 + h - r}Q${x} ${y0 + h} ${x + r} ${y0 + h}H${x + bw - r}Q${x + bw} ${y0 + h} ${x + bw} ${y0 + h - r}V${y0}Z`;
        const p = el('path', { d, fill: s.color }, svg);
        p.addEventListener('mousemove', ev => BN.tip.show('<b>' + lbl + '</b><br>' + s.name + '：' + (o.tipfmt || yfmt)(v), ev.clientX, ev.clientY)); p.addEventListener('mouseleave', BN.tip.hide);
        if (showVal) text(svg, x + bw / 2, v >= 0 ? top - 4 : y0 + h + 12, (o.valfmt || yfmt)(v), { 'text-anchor': 'middle', class: 'viz-lbl', 'font-size': S > 2 ? 10 : 11 });
      });
      text(svg, gx + inner / 2, H - pad.b + 16, lbl, { 'text-anchor': 'middle', class: 'viz-lbl', 'font-size': G > 14 ? 10 : 11.5 });
    });
    return svg;
  }

  // ---------------- horizontal bars (direct labels) ----------------
  function hbars(host, o) {
    const body = wrapFig(host, Object.assign({}, o, { series: null }));
    const n = o.items.length, rowH = o.rowH || 34, W = o.W || 820, pad = { l: o.labelW || 110, r: o.padR || 120, t: 8, b: 8 }, H = pad.t + pad.b + n * rowH;
    const svg = frame(body, W, H);
    const max = o.max != null ? o.max : Math.max(...o.items.map(i => i.value)); const log = !!o.log; const minv = log ? (o.minv != null ? o.minv : Math.min(...o.items.map(i => i.value)) / 1.5) : 0;   // o.max／o.minv：動態走勢固定刻度
    const xOf = v => pad.l + (W - pad.l - pad.r) * (log ? (Math.log10(v) - Math.log10(minv)) / (Math.log10(max) - Math.log10(minv)) : v / max);
    o.items.forEach((it, i) => {
      const y = pad.t + i * rowH + 6, h = rowH - 12, x1 = xOf(it.value), r = Math.min(4, h / 2, x1 - pad.l);
      text(svg, pad.l - 10, y + h / 2 + 4, it.name, { 'text-anchor': 'end', class: 'viz-txt', 'font-weight': it.hl ? 700 : 500 });
      if (it._hide) return;   // 動態走勢：還沒輪到的項目只顯示名稱
      if (it.value > 0) { const d = `M${pad.l} ${y}H${x1 - r}Q${x1} ${y} ${x1} ${y + r}V${y + h - r}Q${x1} ${y + h} ${x1 - r} ${y + h}H${pad.l}Z`; const p = el('path', { d, fill: it.color }, svg); p.addEventListener('mousemove', ev => BN.tip.show('<b>' + it.name + '</b><br>' + (o.tipfmt || o.fmt || fmtDef)(it.value), ev.clientX, ev.clientY)); p.addEventListener('mouseleave', BN.tip.hide); }
      text(svg, x1 + 8, y + h / 2 + 4, (o.fmt || fmtDef)(it.value), { class: 'viz-txt', 'font-weight': 600 });
      if (it.sub) text(svg, pad.l + 6, y + h / 2 + 4, it.sub, { class: 'viz-lbl', fill: '#fff', 'font-size': 11 });
    });
    return svg;
  }

  // ---------------- histogram ----------------
  function hist(host, o) {
    const body = wrapFig(host, o);
    const W = 820, H = o.height || 300, pad = { l: 56, r: 12, t: 20, b: 40 };
    const svg = frame(body, W, H);
    const n = o.counts.length, max = o.maxCount != null ? o.maxCount : Math.max(...o.counts);   // o.maxCount：動態走勢固定縱軸
    // 橫軸範圍：分布的兩端；標記線（例如主回測）落在分布之外時，把橫軸延伸到看得到那條線（2026-11-21：之前線與標籤會被切在圖外）
    const mx = (o.marks || []).map(m => m.x).filter(v => v != null && isFinite(v)), e0 = o.edges[0], e1 = o.edges[n], span = Math.max(e1, ...mx) - Math.min(e0, ...mx);
    const x0 = Math.min(e0, ...mx) < e0 ? Math.min(e0, ...mx) - span * 0.012 : e0, x1 = Math.max(e1, ...mx) > e1 ? Math.max(e1, ...mx) + span * 0.012 : e1;
    const xOf = v => pad.l + (W - pad.l - pad.r) * (v - x0) / (x1 - x0), yOf = c => H - pad.b - (H - pad.t - pad.b) * c / (max * 1.08);
    const g = el('g', { class: 'viz-grid' }, svg); niceTicks(0, max * 1.08, 4).forEach(c => { el('line', { x1: pad.l, x2: W - pad.r, y1: yOf(c), y2: yOf(c) }, g); text(svg, pad.l - 8, yOf(c) + 4, c.toLocaleString(), { 'text-anchor': 'end', class: 'viz-lbl' }); });
    const ax = el('g', { class: 'viz-axis' }, svg); el('line', { x1: pad.l, x2: W - pad.r, y1: yOf(0), y2: yOf(0) }, ax);
    niceTicks(x0, x1, 8).forEach(v => text(svg, xOf(v), H - pad.b + 16, (v * 100).toFixed(0) + '%', { 'text-anchor': 'middle', class: 'viz-lbl' }));
    o.counts.forEach((c, i) => { const a = xOf(o.edges[i]), b = xOf(o.edges[i + 1]); const x = a + 1, w = Math.max(1, b - a - 2), y = yOf(c), h = yOf(0) - y; const r = Math.min(3, w / 2, h); const p = el('path', { d: `M${x} ${yOf(0)}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${yOf(0)}Z`, fill: o.color || 'var(--s-fund)' }, svg); p.addEventListener('mousemove', ev => BN.tip.show('年化 ' + (o.edges[i] * 100).toFixed(1) + '%～' + (o.edges[i + 1] * 100).toFixed(1) + '%<br>' + c.toLocaleString() + ' 組', ev.clientX, ev.clientY)); p.addEventListener('mouseleave', BN.tip.hide); });
    (o.marks || []).forEach(m => { const x = xOf(m.x); el('line', { x1: x, x2: x, y1: pad.t, y2: yOf(0), stroke: m.color || 'var(--ink)', 'stroke-width': 1.5, 'stroke-dasharray': m.dash || '4 3' }, svg); text(svg, x + (m.dx || 4), pad.t + 10 + (m.dy || 0), m.label, { class: 'viz-txt', 'font-weight': 600, 'text-anchor': m.anchor || 'start' }); });
    return svg;
  }

  // ---------------- ring diagram (AI loop) ----------------
  function ring(host, o) {
    const W = 760, H = 420, cx = W / 2, cy = H / 2 + 6, R = 150;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title || '' }, host);
    const n = o.steps.length;
    el('circle', { cx, cy, r: R, fill: 'none', stroke: 'var(--line)', 'stroke-width': 2, 'stroke-dasharray': '6 6' }, svg);
    const pts = o.steps.map((s, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a }; });
    // arrows between steps along the circle
    const A = o.active, on = i => A == null || i === A;   // o.active：動態走勢目前這一步（其他步驟變淡）
    for (let i = 0; i < n; i++) { const a0 = pts[i].a + 0.5, a1 = pts[(i + 1) % n].a - 0.5; const p0 = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)], p1 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)]; el('path', { d: `M${p0[0]} ${p0[1]}A${R} ${R} 0 0 1 ${p1[0]} ${p1[1]}`, fill: 'none', stroke: A === i ? 'var(--gold)' : 'var(--navy-ink)', 'stroke-width': A === i ? 3.5 : 2.5, opacity: on(i) ? null : .35, 'marker-end': 'url(#arr)' }, svg); }
    const defs = el('defs', {}, svg); const mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs); el('path', { d: 'M0 0L10 5L0 10z', fill: 'var(--navy-ink)' }, mk);
    pts.forEach((p, i) => { const s = o.steps[i]; const w = 150, h = 56, g = el('g', { opacity: on(i) ? null : .38 }, svg); el('rect', { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, rx: 4, fill: 'var(--paper)', stroke: A === i ? 'var(--gold)' : 'var(--navy-ink)', 'stroke-width': A === i ? 3.5 : 2 }, g); el('circle', { cx: p.x - w / 2 + 16, cy: p.y - h / 2 + 2, r: 11, fill: 'var(--gold)' }, g); text(g, p.x - w / 2 + 16, p.y - h / 2 + 6, String(i + 1), { 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#1a1300' }); text(g, p.x, p.y - 4, s.t, { 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: 'var(--navy-ink)' }); text(g, p.x, p.y + 15, s.s, { 'text-anchor': 'middle', 'font-size': 11.5, fill: 'var(--ink-2)' }); });
    text(svg, cx, cy - 8, o.center || '', { 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 700, fill: 'var(--navy-ink)', 'font-family': 'var(--serif)' });
    text(svg, cx, cy + 16, o.center2 || '', { 'text-anchor': 'middle', 'font-size': 12.5, fill: 'var(--ink-2)' });
    return svg;
  }

  // ---------------- 動態走勢（2026-11-21 22:23 站主：網頁上所有圖表都要能像首頁走勢圖一樣播放） ----------------
  // 每張圖畫好後，圖框右上角放「動態走勢」按鈕（site.js 的 BN.play）。各種圖的播法：
  //   折線：同首頁走勢圖，從第一筆一格一格畫到最後一筆，座標軸固定為整段範圍；日線太長時每格跳幾天，約 20 秒播完
  //   直條：一組一組依序長出來（逐年報酬就是一年一年）；橫條：由小到大逐一長出來
  //   直方圖：依隨機順序（固定種子，每次一樣）把每一組結果加進分布；循環圖：依序亮起每一步
  //   o.noPlay 或 o.play === false：不放按鈕；o.play = { unit, labels, count:false }：自訂進度單位、每一格的名稱、不顯示「第幾格」
  const RAW = { line, bars, hbars, hist, ring };
  const nf = v => v.toLocaleString('zh-Hant-TW'), ease = t => 1 - Math.pow(1 - t, 3);
  function frameSvg(kind, fig, o) {   // 在原圖框內的隱藏區畫一格（樣式、字寬量法都和原圖相同），取出 svg
    let tmp = fig._bnTmp;
    if (!tmp || !tmp.isConnected) { tmp = document.createElement('div'); tmp.setAttribute('aria-hidden', 'true'); tmp.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:0;overflow:hidden;visibility:hidden;pointer-events:none'; fig.appendChild(tmp); fig._bnTmp = tmp; }
    tmp.innerHTML = ''; RAW[kind](tmp, Object.assign({}, o, { noPlay: true, title: null, sub: null, note: null, noLegend: true, _frame: true }));
    const s = tmp.querySelector('svg'); if (s) s.remove(); tmp.innerHTML = ''; return s;
  }
  function lineSpec(fig, o) {
    const n = o.x.length; if (n < 3 || !o.series || !o.series.length) return null;
    const ok = v => v != null && isFinite(v) && (!o.log || v > 0);
    let lo = Infinity, hi = -Infinity, i0 = n;
    o.series.forEach(s => s.values.forEach((v, i) => { if (ok(v)) { if (v < lo) lo = v; if (v > hi) hi = v; if (i < i0) i0 = i; } }));
    if (!(hi >= lo) || i0 >= n - 1) return null;
    const yMin = o.yMin != null ? o.yMin : lo, yMax = o.yMax != null ? o.yMax : hi;
    const K = Math.max(1, Math.ceil((n - 1 - i0) / 560)), idx = [];
    for (let i = i0; i < n - 1; i += K) idx.push(i); idx.push(n - 1);
    const P = o.play || {}, U = P.unit ? { u: P.unit } : BN.play.unit(o.x), lab = i => { const s = P.labels ? P.labels[i] : o.xLabel ? o.xLabel(o.x[i]) : String(o.x[i]); return U && U.u === '年' && /^\d{4}$/.test(s) ? s + ' 年' : s; };
    const T = U && U.t ? (U.t[n - 1] - U.t[i0]) / U.k : 0, d1 = v => v.toFixed(U && U.w === '年' || T < 10 ? 1 : 0);
    const cnt = i => P.count === false ? '' : U && U.u ? '（第 ' + nf(i - i0 + 1) + '／' + nf(n - i0) + ' ' + U.u + '）' : U && U.t ? '（已播 ' + d1((U.t[i] - U.t[i0]) / U.k) + '／' + d1(T) + ' ' + U.w + '）' : '（' + Math.round((i - i0) / (n - 1 - i0) * 100) + '%）';
    const EV = o.endVals ? Object.assign({}, o.endVals, { leader: .22, leaderDash: '2 4' }) : o.endVals;
    const ENp = o.endNames ? Object.assign({}, typeof o.endNames === 'object' ? o.endNames : {}, { leader: .35, leaderDash: '2 4' }) : o.endNames;   // 右欄名稱：播放時引線改淡虛線（線頭還沒走到右邊）
    return {
      n: idx.length,
      frame: f => { const i = idx[f]; return frameSvg('line', fig, Object.assign({}, o, { yMin, yMax, endVals: EV, endNames: ENp, marks: (o.marks || []).filter(m => m.i <= i), series: o.series.map(s => Object.assign({}, s, { values: s.values.map((v, j) => j <= i ? v : null) })) })); },
      label: f => (idx[f] > i0 ? lab(i0) + ' → ' : '') + lab(idx[f]) + cnt(idx[f])
    };
  }
  function barsSpec(fig, o) {
    const G = o.groups.length; if (G < 2 || !o.series || !o.series.length) return null;
    let lo = 0, hi = 0; o.series.forEach(s => s.values.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    const SG = G <= 8 ? 10 : G <= 16 ? 6 : 4, N = G * SG, P = o.play || {}, labs = P.labels || o.groups, u = P.unit || '項', span = P.range != null ? P.range : u === '年';   // 依時間排的（逐年）顯示「起點 → 目前」，分類只顯示目前這一項
    return {
      n: N, ms: Math.max(30, Math.min(110, Math.round(Math.min(16000, Math.max(3600, G * 650)) / N))),
      frame: f => { const g = Math.floor(f / SG), t = ease((f % SG + 1) / SG); return frameSvg('bars', fig, Object.assign({}, o, { yRange: [lo, hi], series: o.series.map(s => Object.assign({}, s, { values: s.values.map((v, j) => v == null ? null : j < g ? v : j === g ? v * t : null) })) })); },
      label: f => { const g = Math.floor(f / SG); return (span && g ? labs[0] + ' → ' : '') + labs[g] + '（第 ' + (g + 1) + '／' + G + ' ' + u + '）'; }
    };
  }
  function hbarsSpec(fig, o) {
    const n = o.items.length; if (n < 2) return null;
    const vals = o.items.map(i => i.value), max = Math.max(...vals), log = !!o.log, minv = log ? Math.min(...vals) / 1.5 : 0;
    const desc = vals.every((v, i) => i === 0 || vals[i - 1] >= v), order = vals.map((_, i) => desc ? n - 1 - i : i), rank = new Map(order.map((i, r) => [i, r]));
    const SG = 8, N = n * SG, part = (v, t) => log ? Math.exp(Math.log(minv) + (Math.log(v) - Math.log(minv)) * t) : v * t;
    return {
      n: N, ms: Math.max(30, Math.min(90, Math.round(Math.min(12000, Math.max(3200, n * 700)) / N))),
      frame: f => { const k = Math.floor(f / SG), t = ease((f % SG + 1) / SG);
        return frameSvg('hbars', fig, Object.assign({}, o, { max, minv, items: o.items.map((it, i) => { const r = rank.get(i); return r < k ? it : r === k ? Object.assign({}, it, { value: it.value > 0 ? part(it.value, t) : it.value }) : Object.assign({}, it, { _hide: true }); }) })); },
      label: f => { const k = Math.floor(f / SG); return (desc ? '由低到高逐一畫出' : '逐一畫出') + '（第 ' + (k + 1) + '／' + n + ' 項：' + o.items[order[k]].name + '）'; }
    };
  }
  function histSpec(fig, o) {
    const B = o.counts.length, N = o.counts.reduce((a, b) => a + b, 0); if (B < 2 || N < 2) return null;
    const ord = new Int32Array(N); let p = 0; o.counts.forEach((c, b) => { for (let k = 0; k < c; k++) ord[p++] = b; });
    const R = BN.play.rng(20261121); for (let i = N - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)), t = ord[i]; ord[i] = ord[j]; ord[j] = t; }
    const F = Math.min(N, 200), kOf = f => Math.round(N * (f + 1) / F), mx = Math.max(...o.counts);
    let cur = new Array(B).fill(0), at = 0;
    const upto = k => { if (k < at) { cur = new Array(B).fill(0); at = 0; } for (; at < k; at++) cur[ord[at]]++; return cur.slice(); };
    return {
      n: F, ms: 60,
      frame: f => frameSvg('hist', fig, Object.assign({}, o, { counts: upto(kOf(f)), maxCount: mx })),
      label: f => '依隨機順序把 ' + nf(N) + ' 組結果逐一加進分布（第 ' + nf(kOf(f)) + '／' + nf(N) + ' 組）'
    };
  }
  function ringSpec(fig, o) {
    const n = o.steps.length; if (n < 2) return null;
    return { n, ms: 1100, frame: i => frameSvg('ring', fig, Object.assign({}, o, { active: i })), label: i => '第 ' + (i + 1) + '／' + n + ' 步：' + o.steps[i].t + '（' + o.steps[i].s + '）' };
  }
  const SPEC = { line: lineSpec, bars: barsSpec, hbars: hbarsSpec, hist: histSpec, ring: ringSpec };
  function playable(kind) {
    return function (host, o) {
      const svg = RAW[kind](host, o);
      if (svg && o && !o.noPlay && o.play !== false && window.BN && BN.play) {
        try {
          const fig = kind === 'ring' ? host : svg.closest('.fig'), sp = fig && SPEC[kind](fig, o);
          if (sp) BN.play.attach(fig, Object.assign({ target: svg, onEnd: () => { if (fig._bnTmp) { fig._bnTmp.remove(); fig._bnTmp = null; } } }, sp));
        } catch (e) { /* 播放功能出錯不影響原圖 */ }
      }
      return svg;
    };
  }
  window.BN = window.BN || {}; BN.charts = Object.assign(BN.charts || {}, { line: playable('line'), bars: playable('bars'), hbars: playable('hbars'), hist: playable('hist'), ring: playable('ring') });
})();
