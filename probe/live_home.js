const { chromium } = require('playwright');
(async () => {
  const B = process.argv[2]; const b = await chromium.launch();
  for (const [w, tag] of [[1440, 'desk'], [390, 'phone']]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } }); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(B + 'index.html?t=' + Date.now(), { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
    const r = await p.evaluate(() => ({
      eyebrow: document.querySelector('.hero .eyebrow').innerText,
      stat: document.querySelector('.hero .stat').innerText.replace(/\n/g, ' | '),
      invite: [...document.querySelectorAll('p')].map(x => x.innerText).filter(t => /採邀請制/.test(t)).map(t => t.slice(0, 40)),
      world: [...document.querySelectorAll('#t-world tbody tr')].map(tr => tr.innerText.replace(/\t/g, ' ')),
      note: (document.getElementById('world-note') || {}).innerText,
      ind: [...document.querySelectorAll('#ind li')].map(li => li.innerText.replace(/\n/g, ' ')),
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    }));
    console.log('CHK ' + tag + ' errors=' + JSON.stringify(errs) + ' overflow=' + r.overflow);
    console.log('CHK ' + tag + ' eyebrow=' + r.eyebrow);
    console.log('CHK ' + tag + ' stat=' + r.stat);
    console.log('CHK ' + tag + ' invite=' + JSON.stringify(r.invite));
    if (tag === 'desk') { r.world.forEach(x => console.log('CHK world ' + x)); console.log('CHK note ' + r.note); r.ind.forEach(x => console.log('CHK ind ' + x)); }
    await p.close();
  }
  await b.close();
})();
