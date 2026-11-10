const { chromium } = require('playwright');
(async () => {
  const B = process.argv[2]; const b = await chromium.launch(); const errs = [];
  for (const [c, w] of [['NVDA', 1600], ['2330', 1600], ['2881', 1600], ['AAPL', 400], ['TSM', 1600]]) {
    const p = await b.newPage({ viewport: { width: w, height: 1000 } }); p.on('pageerror', e => errs.push(c + ': ' + e.message));
    await p.goto(B + 'valuation.html?t=' + Date.now() + '#code=' + c, { waitUntil: 'networkidle' });
    await p.waitForSelector('#co-dl', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({
      ver: ((document.querySelector('script[src*="company.js"]') || {}).src || '').split('?')[1],
      ids: [...document.querySelectorAll('#dCo h3')].map(h => h.id.replace('co-', '')).join(','),
      px: (document.querySelector('#pxFig .fnote') || {}).textContent,
      river: (document.querySelector('#co-river + p') || {}).textContent,
      esgCards: document.querySelectorAll('.esg > div').length,
      caps: [...document.querySelectorAll('#dCo caption, #dCo p.small')].map(x => x.textContent).filter(t => /官方數字核對|股利分派|內部人/.test(t)).map(t => t.slice(0, 60)).join(' | '),
      cross: [...document.querySelectorAll('#dCo table')].filter(t => /官方數字核對/.test(t.textContent)).map(t => t.innerText.split('\n').slice(1, 4).join(' / ')).join(''),
      peers: document.querySelectorAll('.ptb tbody tr').length,
      glos: document.querySelectorAll('.glos tbody tr').length,
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    }));
    const bt = await p.$('.pxsel button[data-p="5y"]'); if (bt) { await bt.scrollIntoViewIfNeeded(); await bt.click(); await p.waitForTimeout(300); r.px5 = await p.evaluate(() => (document.querySelector('#pxFig .fnote') || {}).textContent); }
    console.log('CHK', c, w, JSON.stringify(r));
    await p.close();
  }
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } }); p.on('pageerror', e => errs.push('daily: ' + e.message));
  await p.goto(B + 'daily.html?t=' + Date.now(), { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  console.log('CHK daily 熱力圖方塊', await p.evaluate(() => document.querySelectorAll('#hm-box .tl').length));
  console.log('CHK 頁面錯誤', errs.length ? JSON.stringify(errs) : '無'); await b.close();
})();
