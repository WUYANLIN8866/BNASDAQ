/* BNASDAQ 內嵌 SVG 圖表（無外部函式庫）：折線（含對數）、分組直條、橫條、直方圖、回撤面積。
   設計規則：細線 2px、資料端圓角 4px、網格退後、≥2 條序列一定有圖例、滑鼠十字線＋提示框、深淺色用 CSS 變數。 */
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

  // ---------------- line chart ----------------
  function line(host, o) {
    const body = wrapFig(host, o);
    const W = o.W || 820, H = o.height || 360, pad = { l: o.padL || 64, r: o.padR || 16, t: 14, b: 34 };
    const svg = frame(body, W, H);
    const n = o.x.length; const xOf = i => pad.l + (W - pad.l - pad.r) * (n > 1 ? i / (n - 1) : 0);
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
    xt.forEach(([i, lbl]) => { text(svg, xOf(i), H - pad.b + 18, lbl, { 'text-anchor': 'middle', class: 'viz-lbl' }); });
    if (o.yTitle) text(svg, 10, pad.t + 2, o.yTitle, { class: 'viz-lbl' });
    // bands (e.g., shaded ranges)
    (o.bands || []).forEach(b => { el('rect', { x: xOf(b.from), y: pad.t, width: Math.max(1, xOf(b.to) - xOf(b.from)), height: H - pad.t - pad.b, fill: b.color || 'rgba(183,121,31,.12)' }, svg); });
    // series
    const dots = [], endLabels = [];
    o.series.forEach(s => {
      let d = '', pen = false;
      s.values.forEach((v, i) => { if (v == null || !isFinite(v) || (o.log && v <= 0)) { pen = false; return; } d += (pen ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1); pen = true; });
      if (s.fill) { let a = ''; s.values.forEach((v, i) => { if (v == null) return; a += (a ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1); }); a += 'L' + xOf(n - 1).toFixed(1) + ' ' + yOf(o.zero ? 0 : lo).toFixed(1) + 'L' + xOf(0).toFixed(1) + ' ' + yOf(o.zero ? 0 : lo).toFixed(1) + 'Z'; el('path', { d: a, fill: s.color, 'fill-opacity': .14, stroke: 'none' }, svg); }
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash || null }, svg);
      const dot = el('circle', { r: 4, fill: s.color, stroke: 'var(--paper)', 'stroke-width': 2, style: 'display:none' }, svg); dots.push(dot);
      // direct label at the end (collected, then pushed apart)
      if (o.series.length <= 6 && !o.noEndLabels) { let li = s.values.length - 1; while (li >= 0 && (s.values[li] == null || !isFinite(s.values[li]))) li--; if (li >= 0) endLabels.push({ x: xOf(li), y: yOf(s.values[li]), t: s.short || s.name, c: s.color }); }
    });
    endLabels.sort((a, b) => a.y - b.y); for (let i = 1; i < endLabels.length; i++) if (endLabels[i].y - endLabels[i - 1].y < 13) endLabels[i].y = endLabels[i - 1].y + 13;
    endLabels.forEach(l => text(svg, Math.min(l.x + 4, W - 2), l.y + 4, l.t, { class: 'viz-txt', 'font-weight': 600, 'text-anchor': (W - l.x) < 70 ? 'end' : 'start', fill: l.c }));
    (o.marks || []).forEach(m => { const x = xOf(m.i), y = yOf(m.v); el('circle', { cx: x, cy: y, r: 5, fill: 'var(--paper)', stroke: m.color || 'var(--ink)', 'stroke-width': 2 }, svg); if (m.label) text(svg, x + (m.dx || 8), y + (m.dy || -8), m.label, { class: 'viz-txt', 'font-weight': 600 }); });
    hover(svg, pad, W, H, xOf, n, (i, cx, cy) => {
      let h = '<b>' + (o.xLabel ? o.xLabel(o.x[i]) : o.x[i]) + '</b>';
      o.series.forEach((s, k) => { const v = s.values[i]; if (v == null) { dots[k].style.display = 'none'; return; } dots[k].setAttribute('cx', xOf(i)); dots[k].setAttribute('cy', yOf(v)); dots[k].style.display = ''; h += '<br><span style="color:' + s.color + '">●</span> ' + s.name + '：' + (o.tipfmt || yfmt)(v); });
      BN.tip.show(h, cx, cy);
    }, () => dots.forEach(d => d.style.display = 'none'));
    return svg;
  }

  // ---------------- grouped vertical bars ----------------
  function bars(host, o) {
    const body = wrapFig(host, o);
    const W = 820, H = o.height || 340, pad = { l: 58, r: 12, t: 16, b: 40 };
    const svg = frame(body, W, H);
    const G = o.groups.length, S = o.series.length;
    let lo = 0, hi = 0; o.series.forEach(s => s.values.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
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
    const max = Math.max(...o.items.map(i => i.value)); const log = !!o.log; const minv = log ? Math.min(...o.items.map(i => i.value)) / 1.5 : 0;
    const xOf = v => pad.l + (W - pad.l - pad.r) * (log ? (Math.log10(v) - Math.log10(minv)) / (Math.log10(max) - Math.log10(minv)) : v / max);
    o.items.forEach((it, i) => {
      const y = pad.t + i * rowH + 6, h = rowH - 12, x1 = xOf(it.value), r = Math.min(4, h / 2, x1 - pad.l);
      text(svg, pad.l - 10, y + h / 2 + 4, it.name, { 'text-anchor': 'end', class: 'viz-txt', 'font-weight': it.hl ? 700 : 500 });
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
    const n = o.counts.length, max = Math.max(...o.counts); const x0 = o.edges[0], x1 = o.edges[n];
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
    for (let i = 0; i < n; i++) { const a0 = pts[i].a + 0.5, a1 = pts[(i + 1) % n].a - 0.5; const p0 = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)], p1 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)]; el('path', { d: `M${p0[0]} ${p0[1]}A${R} ${R} 0 0 1 ${p1[0]} ${p1[1]}`, fill: 'none', stroke: 'var(--navy-ink)', 'stroke-width': 2.5, 'marker-end': 'url(#arr)' }, svg); }
    const defs = el('defs', {}, svg); const mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs); el('path', { d: 'M0 0L10 5L0 10z', fill: 'var(--navy-ink)' }, mk);
    pts.forEach((p, i) => { const s = o.steps[i]; const w = 150, h = 56; el('rect', { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, rx: 4, fill: 'var(--paper)', stroke: 'var(--navy-ink)', 'stroke-width': 2 }, svg); el('circle', { cx: p.x - w / 2 + 16, cy: p.y - h / 2 + 2, r: 11, fill: 'var(--gold)' }, svg); text(svg, p.x - w / 2 + 16, p.y - h / 2 + 6, String(i + 1), { 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#1a1300' }); text(svg, p.x, p.y - 4, s.t, { 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: 'var(--navy-ink)' }); text(svg, p.x, p.y + 15, s.s, { 'text-anchor': 'middle', 'font-size': 11.5, fill: 'var(--ink-2)' }); });
    text(svg, cx, cy - 8, o.center || '', { 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 700, fill: 'var(--navy-ink)', 'font-family': 'var(--serif)' });
    text(svg, cx, cy + 16, o.center2 || '', { 'text-anchor': 'middle', 'font-size': 12.5, fill: 'var(--ink-2)' });
    return svg;
  }

  window.BN = window.BN || {}; BN.charts = { line, bars, hbars, hist, ring };
})();
