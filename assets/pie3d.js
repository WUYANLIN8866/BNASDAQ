/* BNASDAQ｜立體圓餅圖（內嵌 SVG，無外部函式庫）
   BN.charts.pie3d(host, {title, sub, note, slices:[{key, name, w, color, cls, tag}], value: w => 金額文字（可省略）, label: 圓餅上標百分比的最小占比（預設 0.05）})
   - slices 的 w 為占比（合計 1）；順時針、自 12 點鐘方向開始；切片之間留 1.5px 底色縫隙
   - 立體側面只畫朝向讀者的半圈（0～180 度），以同色加 22% 黑色覆蓋表示陰影；淺色與深色主題都適用
   - 滑過切片或圖例：切片外移並顯示提示框；圖例同時是完整數字表（顏色不是唯一辨識方式） */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pctTxt = w => (w * 100 >= 10 ? (w * 100).toFixed(1) : (w * 100).toFixed(2)) + '%';
  // 切片顏色的明暗：決定圓餅上百分比文字用白字或黑字
  function lum(c, node) {
    const probe = document.createElement('span'); probe.style.color = c; probe.style.display = 'none'; node.appendChild(probe);
    const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g); node.removeChild(probe);
    if (!m) return 0.5;
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(+m[0]) + 0.7152 * f(+m[1]) + 0.0722 * f(+m[2]);
  }
  function pie3d(host, o) {
    if (typeof host === 'string') host = document.getElementById(host);
    if (!host) return;
    const S = (o.slices || []).filter(s => s.w > 0);
    const tot = S.reduce((t, s) => t + s.w, 0) || 1;
    const fig = document.createElement('div'); fig.className = 'fig pie3d';   // 同 charts.js 的圖框：標題、副標、圖、註
    fig.innerHTML = (o.title ? '<p class="ftitle">' + esc(o.title) + '</p>' : '') + (o.sub ? '<p class="fsub">' + esc(o.sub) + '</p>' : '') + '<div class="p3-wrap"><div class="p3-svg"></div><div class="p3-leg tblwrap"></div></div>' + (o.note ? '<p class="fnote">' + esc(o.note) + '</p>' : '');
    host.innerHTML = ''; host.appendChild(fig);
    const W = 440, H = 290, cx = W / 2, cy = 124, rx = 196, ry = 104, dep = 28;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': (o.title || '圓餅圖') + '：' + S.slice(0, 8).map(s => s.name + ' ' + pctTxt(s.w / tot)).join('、') }, fig.querySelector('.p3-svg'));
    const P = (a, dy) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a) + (dy || 0)];
    const f2 = v => v.toFixed(2);
    let a = -Math.PI / 2;
    const parts = S.map((s, i) => { const a0 = a, a1 = a + 2 * Math.PI * s.w / tot; a = a1; return { s, i, a0, a1, mid: (a0 + a1) / 2 }; });
    const gWall = el('g', {}, svg), gTop = el('g', {}, svg), gLbl = el('g', { 'pointer-events': 'none' }, svg);
    const G = parts.map(p => {
      const g = { wall: el('g', {}, gWall), top: el('g', {}, gTop), lbl: el('g', {}, gLbl) };
      // 側面：朝向讀者的半圈（0～π）與本切片角度的交集
      const s0 = Math.max(p.a0, 0), s1 = Math.min(p.a1, Math.PI);
      if (s1 > s0) {
        const [x0, y0] = P(s0), [x1, y1] = P(s1), [x2, y2] = P(s1, dep), [x3, y3] = P(s0, dep);
        const d = 'M' + f2(x0) + ' ' + f2(y0) + 'A' + rx + ' ' + ry + ' 0 0 1 ' + f2(x1) + ' ' + f2(y1) + 'L' + f2(x2) + ' ' + f2(y2) + 'A' + rx + ' ' + ry + ' 0 0 0 ' + f2(x3) + ' ' + f2(y3) + 'Z';
        el('path', { d, fill: p.s.color }, g.wall);
        el('path', { d, fill: '#000', 'fill-opacity': '0.22', stroke: 'var(--paper)', 'stroke-width': '1.5', 'stroke-linejoin': 'round' }, g.wall);
      }
      // 頂面
      const full = p.a1 - p.a0 >= 2 * Math.PI - 1e-9;
      const [x0, y0] = P(p.a0), [x1, y1] = P(p.a1);
      const d = full ? 'M' + (cx - rx) + ' ' + cy + 'A' + rx + ' ' + ry + ' 0 1 1 ' + (cx + rx) + ' ' + cy + 'A' + rx + ' ' + ry + ' 0 1 1 ' + (cx - rx) + ' ' + cy + 'Z'
        : 'M' + cx + ' ' + cy + 'L' + f2(x0) + ' ' + f2(y0) + 'A' + rx + ' ' + ry + ' 0 ' + (p.a1 - p.a0 > Math.PI ? 1 : 0) + ' 1 ' + f2(x1) + ' ' + f2(y1) + 'Z';
      const top = el('path', { d, fill: p.s.color, stroke: 'var(--paper)', 'stroke-width': '1.5', 'stroke-linejoin': 'round', tabindex: '0', 'aria-label': p.s.name + ' ' + pctTxt(p.s.w / tot) }, g.top);
      top.style.cursor = 'pointer';
      // 百分比標籤：占比夠大才標
      if (p.s.w / tot >= (o.label == null ? 0.05 : o.label)) {
        const [lx, ly] = [cx + rx * 0.62 * Math.cos(p.mid), cy + ry * 0.62 * Math.sin(p.mid)];
        const t = el('text', { x: f2(lx), y: f2(ly + 4), 'text-anchor': 'middle', 'font-size': '12.5', 'font-weight': '600', fill: lum(p.s.color, host) > 0.42 ? '#0b0b0b' : '#ffffff' }, g.lbl);
        t.textContent = pctTxt(p.s.w / tot);
      }
      return g;
    });
    // 圖例＝完整數字表
    const hasV = typeof o.value === 'function';
    const rows = parts.map(p => '<tr data-i="' + p.i + '"><td class="l"><span class="sw" style="background:' + p.s.color + '"></span>' + esc(p.s.name) + (p.s.tag && (p.i === 0 || parts[p.i - 1].s.tag !== p.s.tag) ? ' <small class="muted">' + esc(p.s.tag) + '</small>' : '') + '</td><td>' + pctTxt(p.s.w / tot) + '</td>' + (hasV ? '<td>' + esc(o.value(p.s.w)) + '</td>' : '') + '</tr>').join('');
    fig.querySelector('.p3-leg').innerHTML = '<table class="tbl p3-tbl"><thead><tr><th class="l">項目</th><th>占總資產</th>' + (hasV ? '<th>金額（台幣）</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table>';
    const trs = [...fig.querySelectorAll('.p3-tbl tbody tr')];
    let cur = -1;
    const on = (i, ev) => {
      if (cur !== i) {
        if (cur >= 0) { ['wall', 'top', 'lbl'].forEach(k => G[cur][k].removeAttribute('transform')); trs[cur].classList.remove('on'); }
        cur = i;
        if (i >= 0) { const m = parts[i].mid, dx = 10 * Math.cos(m), dy = 10 * Math.sin(m) * ry / rx; ['wall', 'top', 'lbl'].forEach(k => G[i][k].setAttribute('transform', 'translate(' + f2(dx) + ' ' + f2(dy) + ')')); trs[i].classList.add('on'); }
      }
      if (i >= 0 && ev && BN.tip) { const s = parts[i].s; BN.tip.show('<b>' + esc(s.name) + '</b><br>占總資產 ' + pctTxt(s.w / tot) + (hasV ? '<br>' + esc(o.value(s.w)) : '') + (s.tag ? '<br>' + esc(s.tag) : ''), ev.clientX, ev.clientY); }
    };
    const off = () => { on(-1); if (BN.tip) BN.tip.hide(); };
    G.forEach((g, i) => { [g.top, g.wall].forEach(n => { n.addEventListener('mousemove', ev => on(i, ev)); n.addEventListener('mouseleave', off); }); g.top.firstChild.addEventListener('focus', () => on(i)); g.top.firstChild.addEventListener('blur', off); });
    trs.forEach((tr, i) => { tr.addEventListener('mouseenter', () => on(i)); tr.addEventListener('mouseleave', off); });
    return fig;
  }
  window.BN = window.BN || {}; BN.charts = BN.charts || {}; BN.charts.pie3d = pie3d;
})();
