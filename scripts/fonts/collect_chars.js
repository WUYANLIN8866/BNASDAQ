// 收集網站各頁「實際畫在畫面上」的字，依字型與字重分組，寫到 scripts/fonts/observed.json，給 build_fonts.py 產生精簡字型用。
// 用法：先在網站根目錄開本機伺服器（例：python3 -m http.server 8765），再執行 node scripts/fonts/collect_chars.js http://127.0.0.1:8765/
// 每頁都會：桌機與手機寬度各看一次、點過每個回測起點與分頁、展開所有 <details>。
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const PAGES = ['index', 'about', 'daily', 'research', 'dca', 'taiwan', 'valuation', 'calculator', 'explore', 'risk', 'faq', 'data', 'news', 'search', 'login', 'member', 'admin', '404'];
(async () => {
  const b = await chromium.launch(); const sets = {};
  const merge = o => { for (const [k, v] of Object.entries(o)) { sets[k] = sets[k] || new Set(); for (const ch of v) sets[k].add(ch); } };
  for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
    const grab = () => p.evaluate(() => {
      const out = {};
      const face = (el, ps) => { const cs = getComputedStyle(el, ps); const fam = cs.fontFamily.toLowerCase(); const w = parseInt(cs.fontWeight, 10) || 400;
        if (/^"?(bn serif|noto serif tc)/.test(fam)) return 'serif' + (w > 600 ? 700 : 600);
        if (/^"?(bn sans|noto sans tc)/.test(fam)) return 'sans' + (w > 500 ? 700 : w > 400 ? 500 : 400);
        return 'other'; };
      const add = (k, s) => { if (s) out[k] = (out[k] || '') + s; };
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = tw.nextNode())) { const el = n.parentElement; if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue; add(face(el), n.nodeValue); }
      document.querySelectorAll('input,textarea').forEach(el => { add(face(el), el.placeholder); add(face(el), el.value); });
      document.querySelectorAll('body *').forEach(el => { for (const ps of ['::before', '::after']) { const c = getComputedStyle(el, ps).content; if (c && /^".*"$/.test(c)) add(face(el, ps), c.slice(1, -1)); } });
      return out;
    });
    for (const pg of PAGES) {
      await p.goto(BASE + pg + '.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(400); merge(await grab());
      for (const ym of ['1986-09', '1996-09', '2009-01', '2013-12', '2016-09', '2020-12', '2021-09', '2000-05']) { const bt = await p.$$('.bt-pre [data-ym="' + ym + '"]'); for (const x of bt) await x.click().catch(() => { }); if (bt.length) { await p.waitForTimeout(250); merge(await grab()); } }
      for (const t of await p.$$('[data-tab]')) { await t.click().catch(() => { }); await p.waitForTimeout(120); merge(await grab()); }
      await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); merge(await grab());
    }
    await ctx.close();
  }
  await b.close();
  const res = {}; for (const [k, s] of Object.entries(sets)) if (k !== 'other') res[k] = [...s].filter(c => c.codePointAt(0) > 32).sort().join('');
  const out = path.join(__dirname, 'observed.json'); fs.writeFileSync(out, JSON.stringify(res, null, 1));
  for (const [k, v] of Object.entries(res)) console.log(k.padEnd(9), '字數', [...v].length);
  console.log('已寫入', out);
})();
