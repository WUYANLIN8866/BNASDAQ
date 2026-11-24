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

  // ---- 會員專屬名稱（2026-11-21 站主）：BNASDAQ-26113 對沒登入的訪客一律顯示「會員專屬」，數字與圖表照常顯示；登入後顯示原名 ----
  // 靜態文字：頁面原始碼就寫「會員專屬」並標 data-mo，登入後在這裡換回原名。
  // 程式產生的文字（圖表、表格、提示框、下拉選單、公告…）：沒登入時由 MutationObserver 即時把原名換成「會員專屬」。
  (function () {
    const CODE = 'BNASDAQ-26113', LABEL = '會員專屬', ATTRS = ['title', 'aria-label', 'alt', 'placeholder'];
    const sessNow = () => { try { const s = JSON.parse(sessionStorage.getItem('bn-session') || 'null'); return s && s.user ? s : null; } catch (e) { return null; } };
    const member = () => !!sessNow();
    // 2026-11-22 站主：每個帳號可以看到哪些模型由管理後台設定（預設只有入門模型）。登入但沒有開通這個模型的會員，和沒登入的訪客看到的一樣（「會員專屬」）。
    // 這次登入可看的策略代號記在 session 的 codes（assets/auth.js「模型權限」）；管理員可以看全部。
    const can = c => { const s = sessNow(); return !!(s && (s.role === 'admin' || (Array.isArray(s.codes) && s.codes.indexOf(c) >= 0))); };
    BN.isMember = member;
    BN.canSee = can;
    BN.mname = c => (c === CODE && !can(CODE)) ? LABEL : c;
    if (can(CODE)) {
      const show = () => document.querySelectorAll('[data-mo]').forEach(el => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) if (n.nodeValue.indexOf(LABEL) >= 0) n.nodeValue = n.nodeValue.split(LABEL).join(CODE);
      });
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
      return;
    }
    const RAW = /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT|TEMPLATE)$/;   // 程式碼本身不動（不然會改到還沒執行的程式）
    const text = n => { const v = n.nodeValue; if (v && v.indexOf(CODE) >= 0 && !(n.parentNode && RAW.test(n.parentNode.nodeName))) n.nodeValue = v.split(CODE).join(LABEL); };
    const attrs = el => { if (!el.getAttribute) return; for (const a of ATTRS) { const v = el.getAttribute(a); if (v && v.indexOf(CODE) >= 0) el.setAttribute(a, v.split(CODE).join(LABEL)); } };
    const sweep = r => {
      if (r.nodeType === 3) { text(r); return; }
      if (r.nodeType !== 1 && r.nodeType !== 9 && r.nodeType !== 11) return;
      if (r.nodeType === 1) { if (RAW.test(r.nodeName)) return; attrs(r); }
      const w = document.createTreeWalker(r, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        { acceptNode: n => (n.nodeType === 1 && RAW.test(n.nodeName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      let n; while ((n = w.nextNode())) { if (n.nodeType === 3) text(n); else attrs(n); }
    };
    // 只給會員看的數字（data-mo-val；2026-11-21 站主：首頁 26113 卡片的 IRR 與倍數）：沒登入時一律顯示「會員專屬」，頁面程式後來填入的數字也立刻換掉
    const lock = el => { if (el.textContent !== LABEL) el.textContent = LABEL; };
    const lockUp = n => { const el = n && (n.nodeType === 1 ? n : n.parentNode), v = el && el.closest && el.closest('[data-mo-val]'); if (v) lock(v); };
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') { text(m.target); lockUp(m.target); }
        else if (m.type === 'attributes') attrs(m.target);
        else { m.addedNodes.forEach(n => { sweep(n); if (n.querySelectorAll) n.querySelectorAll('[data-mo-val]').forEach(lock); }); lockUp(m.target); }
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    sweep(document.documentElement);
    document.querySelectorAll('[data-mo-val]').forEach(lock);
  })();
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
    // 登入後：「會員專區」放在頁首 BNASDAQ 字樣旁（頁首中間那一欄；2026-11-12 從導覽列移過來）
    try {
      const ss = JSON.parse(sessionStorage.getItem('bn-session') || 'null'), slot = $('.brand .wrap > .mark + div');
      if (ss && ss.user && slot && !slot.querySelector('.mlink')) slot.innerHTML = '<a class="mlink" href="member.html"' + (here === 'member.html' ? ' aria-current="page"' : '') + '>會員專區</a>';
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
      // 頁首「會員登入」入口（2026-11-21）：登入後隱藏，頁首改顯示商標旁的「會員專區」
      $$('[data-hlogin]').forEach(a => { a.hidden = !!(s && s.user); });
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
    // 字型清單的網址帶 site.css 的版本號：字型一重建 site.css 的版本號就變，清單與字型檔永遠是同一批（不會拿到舊清單）
    const CV = (() => { const l = document.querySelector('link[rel="stylesheet"][href*="assets/site.css"]'), m = l && /[?&]v=([A-Za-z0-9]+)/.exec(l.getAttribute('href') || ''); return m ? '?v=' + m[1] : ''; })();
    const start = () => fetch('assets/fonts/cover.json' + CV).then(r => r.json()).then(j => {
      COV = {}; for (const k in j) COV[k] = new Set(Array.from(j[k]));
      queue(document.body);
      new MutationObserver(ms => ms.forEach(m => queue(m.type === 'characterData' ? m.target.parentNode : m.target))).observe(document.body, { childList: true, subtree: true, characterData: true });
    }).catch(() => { });
    if (document.readyState === 'complete') idle(start); else window.addEventListener('load', () => idle(start));
  })();

  // ---- 動態走勢（2026-11-21 22:23 站主：網頁上所有圖表、所有功能都要能像首頁走勢圖一樣「動態走勢」） ----
  // BN.play.attach(fig, spec)：在圖框右上角放「動態走勢」按鈕（同首頁：按一下播放、再按暫停、播完回到原圖）。
  //   spec.n            幾格（至少 2 格）
  //   spec.frame(i)     第 i 格要顯示的圖（SVG 節點或字串）；回傳 null＝這一格自己改畫面（例：滑桿），不換圖
  //   spec.label(i)     副標題顯示的進度（例：2000-05 → 2013-04（第 156／317 個月））
  //   spec.ms           每格毫秒（預設約 20 秒播完，每格 35～700 毫秒）
  //   spec.target       要被換掉的圖（預設：圖框內第一個 svg）
  //   spec.sub          放進度文字的元素（預設：圖框的副標題；沒有就暫時加一行）；false＝不顯示進度文字
  //   spec.onFrame(i)／spec.onEnd()：每格畫完／回到原圖之後
  // 同一時間只播一張圖：開始播另一張時，正在播的那張先回到原圖。圖被重畫、離開網頁時自動停止。
  // 用字串組 SVG 的圖：<svg' + BN.play.reg(spec) + ' …>，插進網頁後呼叫 BN.play.scan(容器) 接上按鈕。
  BN.play = (function () {
    const REG = new Map(); let seq = 0, active = null;
    const toNode = x => { if (x == null || typeof x !== 'string') return x || null; const t = document.createElement('template'); t.innerHTML = x.trim(); return t.content.firstElementChild; };
    const msOf = n => Math.max(35, Math.min(700, Math.round(20000 / n)));
    function text(P) {
      const b = P.btn, on = !!P.t; b.textContent = on ? '暫停' : (P.orig ? '繼續播放' : '動態走勢'); b.setAttribute('aria-pressed', String(on));
    }
    function subEl(P) {
      const s = P.spec.sub; if (s === false) return null; if (s) return s;
      let el = P.fig.querySelector('.fsub');
      if (!el) { el = document.createElement('p'); el.className = 'fsub fsub-play'; const t = P.fig.querySelector('.ftitle'); if (t) t.after(el); else P.btn.after(el); P.subNew = el; }
      return el;
    }
    function draw(P, i) {
      const node = toNode(P.spec.frame(i));
      if (node && P.cur && P.cur.parentNode) { P.cur.replaceWith(node); P.cur = node; }
      if (P.sub && P.spec.label) P.sub.textContent = '動態走勢：' + P.spec.label(i) + '；再按一次可暫停';
      if (P.spec.onFrame) P.spec.onFrame(i);
    }
    function halt(P) { if (P.t) { clearInterval(P.t); P.t = null; } }
    function end(P) {   // 回到原圖
      halt(P);
      if (P.orig && P.cur && P.cur !== P.orig && P.cur.parentNode) P.cur.replaceWith(P.orig);
      if (P.subNew) { P.subNew.remove(); P.subNew = null; } else if (P.sub && P.subTxt != null) P.sub.textContent = P.subTxt;
      P.orig = null; P.cur = null; P.sub = null; P.subTxt = null; P.i = 0; if (active === P) active = null;
      text(P); if (P.spec.onEnd) P.spec.onEnd();
    }
    function tick(P) {
      if (!P.fig.isConnected) { halt(P); if (active === P) active = null; return; }   // 圖已重畫：舊的播放器作廢
      P.i++; if (P.i >= P.spec.n) { end(P); return; }
      draw(P, P.i);
    }
    function toggle(P) {
      if (P.t) { halt(P); if (active === P) active = null; text(P); return; }   // 暫停
      if (active && active !== P) { if (active.fig.isConnected) end(active); else { halt(active); active = null; } }
      if (!P.orig) {   // 從頭開始
        const tg = typeof P.spec.target === 'function' ? P.spec.target() : P.spec.target;
        P.orig = tg || P.fig.querySelector('svg') || P.fig; P.cur = P.orig; P.i = 0;
        P.sub = subEl(P); P.subTxt = P.sub && !P.subNew ? P.sub.textContent : null;
        if (P.spec.onStart) P.spec.onStart();
        draw(P, 0);
      }
      active = P; P.t = setInterval(() => tick(P), P.spec.ms || msOf(P.spec.n)); text(P);
    }
    function attach(fig, spec) {
      if (!fig || !spec || !(spec.n >= 2)) return null;
      const prev = fig._bnPlay; if (prev) { if (prev.t || prev.orig) end(prev); if (prev.btn) prev.btn.remove(); }
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'bt-reset bt-play fig-play' + (spec.place ? ' inl' : '');
      const P = { fig, spec, btn, i: 0, t: null, orig: null, cur: null, sub: null, subTxt: null, subNew: null };
      if (spec.place) spec.place(btn); else fig.insertBefore(btn, fig.firstChild);   // spec.place(btn)：自己決定按鈕放哪裡（例：熱力圖放在分頁按鈕旁）
      btn.addEventListener('click', () => toggle(P)); text(P); fig._bnPlay = P; btn._bnFig = fig;
      return P;
    }
    function detach(fig) { const P = fig && fig._bnPlay; if (!P) return; if (P.t || P.orig) end(P); P.btn.remove(); fig._bnPlay = null; }
    function reg(spec) { const k = 'pk' + (++seq); REG.set(k, spec); if (REG.size > 300) REG.delete(REG.keys().next().value); return ' data-pk="' + k + '"'; }
    function scan(root) {
      (root || document).querySelectorAll('[data-pk]').forEach(el => {
        const k = el.getAttribute('data-pk'), spec = REG.get(k); el.removeAttribute('data-pk'); if (!spec) return; REG.delete(k);
        const fig = (spec.fig && spec.fig(el)) || el.closest('.fig') || el.parentElement;
        try { attach(fig, Object.assign({ target: el }, spec)); } catch (e) { /* 播放功能出錯不影響原圖 */ }
      });
    }
    // 小工具：依「年份格式」判斷進度單位；隨機順序（固定種子，每次播放都一樣）
    function unit(xs) {
      const a = xs.map(String), all = re => a.every(s => re.test(s));
      if (all(/^\d{4}$/)) return { u: '年' };
      if (all(/^\d{4}-\d{2}$/)) {   // 月或季：看相鄰兩點差幾個月
        const m = a.map(x => +x.slice(0, 4) * 12 + +x.slice(5, 7)), g = []; for (let i = 1; i < m.length; i++) g.push(m[i] - m[i - 1]);
        g.sort((p, q) => p - q); const md = g.length ? g[g.length >> 1] : 1; return { u: md >= 12 ? '年' : md >= 3 ? '季' : '個月' };
      }
      if (all(/^\d{4}-\d{2}-\d{2}/)) {
        const t = a.map(s => Date.parse(s.length > 10 ? s : s + 'T00:00:00Z')), g = []; for (let i = 1; i < t.length; i++) g.push((t[i] - t[i - 1]) / 864e5);
        if (!t.every(isFinite)) return null;
        g.sort((p, q) => p - q); const md = g.length ? g[g.length >> 1] : 0, span = (t[t.length - 1] - t[0]) / 864e5;
        if (md >= 25 && md <= 35) return { u: '個月' };
        if (md >= 300) return { u: '年' };
        // 日線、抽樣或盤中紀錄：改用「已播多久」
        return span >= 120 ? { t, k: 365.25 * 864e5, w: '年' } : span >= 3 ? { t, k: 864e5, w: '天' } : { t, k: 36e5, w: '小時' };
      }
      return null;
    }
    function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    return { attach, detach, reg, scan, unit, rng, msOf, stop: () => { if (active) end(active); }, busy: fig => !!(fig && fig._bnPlay && (fig._bnPlay.t || fig._bnPlay.orig)) };
  })();

  // ---- tooltip ----
  let tip;
  BN.tip = {
    show(html, x, y) { if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip); } tip.innerHTML = html; tip.style.display = 'block'; const w = tip.offsetWidth, h = tip.offsetHeight; let L = x + 14, T = y + 14; if (L + w > innerWidth - 8) L = x - w - 14; if (T + h > innerHeight - 8) T = y - h - 14; tip.style.left = L + 'px'; tip.style.top = T + 'px'; },
    hide() { if (tip) tip.style.display = 'none'; }
  };
})();
