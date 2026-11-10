const { chromium } = require('playwright');
(async () => {
  const base = process.argv[2], pages = ['index', 'about', 'research', 'dca', 'taiwan', 'calculator', 'valuation', 'lookthrough', 'risk', 'news', 'faq', 'data', 'login', 'member', 'admin', 'explore', 'daily', 'search', '404'];
  const b = await chromium.launch(); const out = [];
  for (const pg of pages) for (const w of [1440, 390]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } }); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/TUNNEL|ERR_|favicon/.test(m.text())) errs.push('console:' + m.text().slice(0, 140)); });
    try { await p.goto(base + pg + '.html' + (pg === 'search' ? '?q=26111' : ''), { waitUntil: 'networkidle', timeout: 45000 }); await p.waitForTimeout(1200); } catch (e) { errs.push('goto:' + e.message.slice(0, 80)); }
    const r = await p.evaluate(() => ({ of: document.documentElement.scrollWidth > innerWidth + 1, n110: (document.body.innerText.match(/BNASDAQ-26110/g) || []).length, n111: (document.body.innerText.match(/BNASDAQ-26111/g) || []).length, hits: document.querySelectorAll('#results li, .results li, #res li').length }));
    out.push(pg + '@' + w + ' errs=' + errs.length + (errs.length ? ' ' + JSON.stringify(errs) : '') + ' overflow=' + r.of + ' 26110=' + r.n110 + ' 26111=' + r.n111 + (pg === 'search' ? ' hits=' + r.hits : ''));
    await p.close();
  }
  console.log(out.join('\n')); await b.close();
})();
