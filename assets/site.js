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
    yi: (v, d) => { d = d == null ? 2 : d; return (v / 1e8).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' 億'; },
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
    const b = $('.nav .burger'), uls = $$('.nav ul');
    if (b && uls.length) b.addEventListener('click', () => { const o = !uls[0].classList.contains('open'); uls.forEach(u => u.classList.toggle('open', o)); b.setAttribute('aria-expanded', o ? 'true' : 'false'); });
    const here = location.pathname.split('/').pop() || 'index.html';
    // 登入後：在「關於 BNASDAQ」前加入「會員專區」
    try {
      const ss = JSON.parse(sessionStorage.getItem('bn-session') || 'null'), ab = $('#mainmenu a[href="about.html"]');
      if (ss && ss.user && ab && !$('#mainmenu a.mlink')) { const li = document.createElement('li'); li.innerHTML = '<a class="mlink" href="member.html">會員專區</a>'; ab.parentNode.parentNode.insertBefore(li, ab.parentNode); }
    } catch (e) { }
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
    if (asofEls.length) fetch('data/market.json').then(r => r.json()).then(m => { asofEls.forEach(el => el.textContent = m.asof); }).catch(() => { asofEls.forEach(el => el.textContent = '—'); });
    // TOC highlighting
    const toc = $$('.toc a[href^="#"]');
    if (toc.length && 'IntersectionObserver' in window) {
      const map = new Map(toc.map(a => [a.getAttribute('href').slice(1), a]));
      const io = new IntersectionObserver(es => { es.forEach(e => { if (e.isIntersecting) { toc.forEach(a => a.removeAttribute('aria-current')); const a = map.get(e.target.id); if (a) a.setAttribute('aria-current', 'true'); } }); }, { rootMargin: '-20% 0px -70% 0px' });
      map.forEach((a, id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    }
    // 網址帶 #id 且目標是 <details>（或在 <details> 裡）時自動展開，例如 faq.html#account
    const openHash = () => { try { const id = decodeURIComponent(location.hash.slice(1)); if (!id) return; const t = document.getElementById(id); const d = t && (t.tagName === 'DETAILS' ? t : t.closest('details')); if (d) { d.open = true; t.scrollIntoView(); } } catch (e) { } };
    openHash(); window.addEventListener('hashchange', openHash);
    // fill data-site="path" spans from window.SITE
    if (window.SITE) $$('[data-site]').forEach(el => { try { const v = el.getAttribute('data-site').split('.').reduce((o, k) => o[k], window.SITE); const f = el.getAttribute('data-fmt'); el.textContent = f ? BN.fmt[f](v) : v; } catch (e) { } });
  });

  // ---- 策略代號不拆行：瀏覽器可能把「BNASDAQ-26110」在連字號後拆成兩行；畫面上（含程式後來畫出的標題、註解）
  //      出現的代號一律包成不換行。SVG 圖內文字與手機對比表欄名（.mth，刻意允許換行）不處理 ----
  (function () {
    const RE = /BNASDAQ-\d{5}/, REG = /BNASDAQ-\d{5}/g;
    const ok = n => { const p = n.parentElement; return !!p && !p.closest('svg,script,style,textarea,.bn-code,.mth'); };
    function wrap(t) {
      const s = t.nodeValue, f = document.createDocumentFragment(); let i = 0, m; REG.lastIndex = 0;
      while ((m = REG.exec(s))) { if (m.index > i) f.appendChild(document.createTextNode(s.slice(i, m.index))); const sp = document.createElement('span'); sp.className = 'bn-code'; sp.textContent = m[0]; f.appendChild(sp); i = m.index + m[0].length; }
      if (i < s.length) f.appendChild(document.createTextNode(s.slice(i)));
      t.parentNode.replaceChild(f, t);
    }
    function fix(r) {
      if (!r) return;
      if (r.nodeType === 3) { if (RE.test(r.nodeValue) && ok(r)) wrap(r); return; }
      if (r.nodeType !== 1 || r.closest('svg') || !RE.test(r.textContent)) return;
      const tw = document.createTreeWalker(r, NodeFilter.SHOW_TEXT), list = []; let n;
      while ((n = tw.nextNode())) if (RE.test(n.nodeValue) && ok(n)) list.push(n);
      list.forEach(wrap);
    }
    document.addEventListener('DOMContentLoaded', () => { fix(document.body); new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(fix))).observe(document.body, { childList: true, subtree: true }); });
  })();

  // ---- 切頁加速：滑鼠停在站內連結上（手機：手指按下）就先在背景準備下一頁；登入、會員、後台頁不預先載入 ----
  (function () {
    const NOPE = 'a[data-acct], a[target], a[download], a[href^="admin"], a[href^="member"], a[href^="login"], a[href^="http"], a[href^="mailto"]';
    try {
      if (window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
        const s = document.createElement('script'); s.type = 'speculationrules';
        s.textContent = JSON.stringify({ prerender: [{ where: { and: [{ href_matches: '*.html', relative_to: 'document' }, { not: { selector_matches: NOPE } }] }, eagerness: 'moderate' }] });
        document.head.appendChild(s); return;
      }
    } catch (e) { }
    const done = new Set();
    const go = e => { const a = e.target && e.target.closest && e.target.closest('a[href]'); if (!a || a.matches(NOPE) || a.origin !== location.origin || !/\.html$/.test(a.pathname) || a.pathname === location.pathname || done.has(a.pathname)) return; done.add(a.pathname); const l = document.createElement('link'); l.rel = 'prefetch'; l.href = a.pathname; document.head.appendChild(l); };
    document.addEventListener('mouseover', go, { passive: true }); document.addEventListener('touchstart', go, { passive: true });
  })();

  // ---- 字型補字：本站字型只含網站用到的字；畫面出現沒收錄的字（例如新加入的個股名稱）時，
  //      只向 Google Fonts 下載那幾個字（同一套 Noto 字形），外觀不變。閒置時才檢查，不影響操作 ----
  (function () {
    if (!window.fetch || !window.MutationObserver) return;
    const GF = 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@600;700&display=swap&text=';
    const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE)$/, WIDE = /[^\x00-\x7e\s]/;
    const idle = window.requestIdleCallback ? (f => requestIdleCallback(f, { timeout: 3000 })) : (f => setTimeout(() => f({ timeRemaining: () => 8 }), 300));
    let COV = null, asked = '', link = null, busy = false; const roots = new Set();
    const faceOf = el => { const cs = getComputedStyle(el), fam = cs.fontFamily, w = parseInt(cs.fontWeight, 10) || 400;
      if (/^"?BN Serif/.test(fam)) return w > 600 ? 's7' : 's6'; if (/^"?BN Sans/.test(fam)) return w > 500 ? 'n7' : w > 400 ? 'n5' : 'n4'; return null; };
    function ask(miss) {
      let add = ''; miss.forEach(c => { if (asked.indexOf(c) < 0) add += c; }); if (!add) return; asked += add;
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = GF + encodeURIComponent(asked);
      l.onload = () => { if (link && link !== l) link.remove(); link = l; }; document.head.appendChild(l);
    }
    function work(dl) {
      const miss = new Set(), memo = new Map();
      while (roots.size && dl.timeRemaining() > 2) {
        const r = roots.values().next().value; roots.delete(r); if (!r.isConnected) continue;
        const tw = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); let n = r.nodeType === 3 ? r : tw.nextNode();
        for (; n; n = tw.nextNode()) {
          const s = n.nodeValue, el = n.parentElement; if (!el || !WIDE.test(s) || SKIP.test(el.tagName)) continue;
          let f = memo.get(el); if (f === undefined) { f = faceOf(el); memo.set(el, f); } if (!f || !COV[f]) continue;
          for (const c of s) if (c > '\x7e' && !COV[f].has(c) && !/\s/.test(c)) miss.add(c);
        }
      }
      if (miss.size) ask(miss);
      if (roots.size) idle(work); else busy = false;
    }
    const queue = r => { if (!r) return; roots.add(r); if (!busy && COV) { busy = true; idle(work); } };
    const start = () => fetch('assets/fonts/cover.json').then(r => r.json()).then(j => {
      COV = {}; for (const k in j) COV[k] = new Set(Array.from(j[k]));
      queue(document.body);
      new MutationObserver(ms => ms.forEach(m => queue(m.type === 'characterData' ? m.target.parentNode : m.target))).observe(document.body, { childList: true, subtree: true, characterData: true });
    }).catch(() => { });
    if (document.readyState === 'complete') idle(start); else window.addEventListener('load', () => idle(start));
  })();

  // ---- tooltip ----
  let tip;
  BN.tip = {
    show(html, x, y) { if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip); } tip.innerHTML = html; tip.style.display = 'block'; const w = tip.offsetWidth, h = tip.offsetHeight; let L = x + 14, T = y + 14; if (L + w > innerWidth - 8) L = x - w - 14; if (T + h > innerHeight - 8) T = y - h - 14; tip.style.left = L + 'px'; tip.style.top = T + 'px'; },
    hide() { if (tip) tip.style.display = 'none'; }
  };
})();
