/* BNASDAQ 共用腳本：導覽、主題、數字格式、提示框、搜尋、資料日期 */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ---- theme ----
  const root = document.documentElement;
  function setTheme(t) { if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme'); try { if (t) localStorage.setItem('bn-theme', t); else localStorage.removeItem('bn-theme'); } catch (e) { } }
  try { const t = localStorage.getItem('bn-theme'); if (t) root.setAttribute('data-theme', t); } catch (e) { }
  window.BN = window.BN || {};
  BN.toggleTheme = function () {
    const cur = root.getAttribute('data-theme');
    const osDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = cur ? cur === 'dark' : osDark;
    setTheme(isDark ? 'light' : 'dark');
    $$('[data-theme-label]').forEach(b => b.textContent = isDark ? '深色模式' : '淺色模式');
    document.dispatchEvent(new CustomEvent('bn-theme'));
  };

  // ---- formatting ----
  const nf0 = new Intl.NumberFormat('zh-Hant-TW', { maximumFractionDigits: 0 });
  BN.fmt = {
    wan: v => (Math.abs(v) < 1e5 ? (v / 1e4).toFixed(1) : nf0.format(Math.round(v / 1e4))) + ' 萬',
    yi: (v, d) => (v / 1e8).toFixed(d == null ? 2 : d) + ' 億',
    big: v => Math.abs(v) >= 1e8 ? BN.fmt.yi(v) : BN.fmt.wan(v),
    money: v => 'NT$ ' + nf0.format(Math.round(v)),
    pct: (x, d) => (x * 100).toFixed(d == null ? 1 : d) + '%',
    pctS: (x, d) => (x >= 0 ? '+' : '−') + (Math.abs(x) * 100).toFixed(d == null ? 1 : d) + '%',
    yrs: (y, d) => y.toFixed(d == null ? 1 : d) + ' 年',
    x: (m, d) => m.toFixed(d == null ? 1 : d) + ' 倍',
    n: v => nf0.format(v)
  };

  // ---- nav ----
  document.addEventListener('DOMContentLoaded', () => {
    const b = $('.nav .burger'), ul = $('.nav ul');
    if (b && ul) b.addEventListener('click', () => { const o = ul.classList.toggle('open'); b.setAttribute('aria-expanded', o ? 'true' : 'false'); });
    const here = location.pathname.split('/').pop() || 'index.html';
    $$('.nav a').forEach(a => { const h = a.getAttribute('href'); if (h === here || (here === '' && h === 'index.html')) a.setAttribute('aria-current', 'page'); });
    // theme label
    const osDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const cur = root.getAttribute('data-theme'); const isDark = cur ? cur === 'dark' : osDark;
    $$('[data-theme-label]').forEach(el => el.textContent = isDark ? '淺色模式' : '深色模式');
    // search
    $$('form.search').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); const q = $('input', f).value.trim(); location.href = 'search.html?q=' + encodeURIComponent(q); }));
    // account link
    try {
      const s = JSON.parse(sessionStorage.getItem('bn-session') || 'null');
      $$('[data-acct]').forEach(a => { if (s && s.user) { a.textContent = (s.role === 'admin' ? '管理後台' : '會員專區') + '（' + s.user + '）'; a.href = s.role === 'admin' ? 'admin.html' : 'member.html'; } });
    } catch (e) { }
    // data as-of from market.json
    const asofEls = $$('[data-asof]');
    if (asofEls.length) fetch('data/market.json', { cache: 'no-store' }).then(r => r.json()).then(m => { asofEls.forEach(el => el.textContent = m.asof); }).catch(() => { asofEls.forEach(el => el.textContent = '—'); });
    // TOC highlighting
    const toc = $$('.toc a[href^="#"]');
    if (toc.length && 'IntersectionObserver' in window) {
      const map = new Map(toc.map(a => [a.getAttribute('href').slice(1), a]));
      const io = new IntersectionObserver(es => { es.forEach(e => { if (e.isIntersecting) { toc.forEach(a => a.removeAttribute('aria-current')); const a = map.get(e.target.id); if (a) a.setAttribute('aria-current', 'true'); } }); }, { rootMargin: '-20% 0px -70% 0px' });
      map.forEach((a, id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    }
    // fill data-site="path" spans from window.SITE
    if (window.SITE) $$('[data-site]').forEach(el => { try { const v = el.getAttribute('data-site').split('.').reduce((o, k) => o[k], window.SITE); const f = el.getAttribute('data-fmt'); el.textContent = f ? BN.fmt[f](v) : v; } catch (e) { } });
  });

  // ---- tooltip ----
  let tip;
  BN.tip = {
    show(html, x, y) { if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip); } tip.innerHTML = html; tip.style.display = 'block'; const w = tip.offsetWidth, h = tip.offsetHeight; let L = x + 14, T = y + 14; if (L + w > innerWidth - 8) L = x - w - 14; if (T + h > innerHeight - 8) T = y - h - 14; tip.style.left = L + 'px'; tip.style.top = T + 'px'; },
    hide() { if (tip) tip.style.display = 'none'; }
  };
})();
