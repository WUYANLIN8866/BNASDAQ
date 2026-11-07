const { chromium } = require('playwright');
(async () => {
  const base = process.argv[2], out = process.argv[3];
  const b = await chromium.launch(); const errs = [];
  { const p0 = await b.newPage(); const r = await p0.goto(base + 'lookthrough.html'); const html = await r.text();
    console.log('HTTP', r.status(), '| 版本號', (html.match(/lt-[a-z]+\.js\?v=[0-9a-z]+|site\.css\?v=[0-9a-z]+/g) || []).join(' '), '| 含 J.P. Morgan：', html.includes('J.P. Morgan'));
    const m = await (await p0.goto(base + 'data/lt/meta.json')).json(); console.log('meta', JSON.stringify(m.coverage), JSON.stringify(m.sources));
    const px = await (await p0.goto(base + 'data/lt/px.json')).json(); console.log('px asof', JSON.stringify(px.asof));
    await p0.close(); }
  for (const vp of [{ width: 1366, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'mob' }]) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
    p.on('console', m => { if (m.type() === 'error') errs.push(vp.n + ' console: ' + m.text()); });
    p.on('pageerror', e => errs.push(vp.n + ' pageerror: ' + e.message));
    await p.goto(base + 'lookthrough.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    const kv = await p.$$eval('#ltKv .tile', ts => ts.map(t => t.innerText.replace(/\n/g, ' | ')));
    console.log(vp.n, '摘要卡：', kv.join(' ‖ '));
    console.log(vp.n, '明細前 5：', (await p.$$eval('.lt-tbl tbody tr', trs => trs.slice(0, 5).map(t => t.innerText.replace(/\t/g, ' ').replace(/\n/g, ' '))) ).join(' ‖ '));
    await p.screenshot({ path: out + '/lt_' + vp.n + '.png', fullPage: true });
    if (vp.n === 'desk') {
      await p.click('[data-mode="shares"]'); await p.fill('#v0', '1000'); await p.fill('#v1', '10'); await p.fill('#v2', '5'); await p.waitForTimeout(800);
      console.log('股數模式：', (await p.$$eval('#ltKv .tile', ts => ts.map(t => t.innerText.replace(/\n/g, ' | ')))).join(' ‖ '));
      await p.click('[data-ex="4"]'); await p.waitForTimeout(800);
      console.log('槓桿範例：', (await p.$$eval('#ltKv .tile', ts => ts.map(t => t.innerText.replace(/\n/g, ' | ')))).join(' ‖ '));
      for (const [code, want] of [['SCHD', '暫不支援'], ['00981A', '期貨'], ['JEPI', 'J.P. Morgan'], ['RSP', 'Invesco'], ['00757', '統一'], ['VXUS', 'Vanguard']]) {
        await p.fill('#c0', code); await p.waitForTimeout(900);
        const info = await p.$eval('#i0', e => e.innerText.replace(/\n/g, ' '));
        const src = await p.$eval('#ltSrc', e => e.innerText.replace(/\n/g, ' ').replace(/\t/g, ' '));
        const row = src.split(code)[1] || '';
        console.log(code, '｜', info, '｜來源列含「' + want + '」：', (row + info).includes(want), '｜', row.slice(0, 150));
      }
      console.log('網址：', decodeURIComponent(p.url().split('#')[1]));
    }
    await p.close();
  }
  console.log('錯誤：', errs.length ? errs : '無');
  await b.close();
})();
