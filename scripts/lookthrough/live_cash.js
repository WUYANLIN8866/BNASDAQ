// 現金功能頁面測試：node cash_test.js <網站根網址> <截圖資料夾>
const { chromium, devices } = require('playwright');
const base = process.argv[2], out = process.argv[3];
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if (!cond) process.exitCode = 1; };
  for (const [tag, ctxOpt] of [['desk', { viewport: { width: 1280, height: 900 } }], ['mob', devices['iPhone 13']]]) {
    const ctx = await b.newContext(ctxOpt); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(tag + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts\.g/.test(m.text())) errs.push(tag + ' console ' + m.text()); });
    await p.goto(base + 'lookthrough.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    const kv = () => p.$eval('#ltKv', e => e.innerText.replace(/\n/g, ' | '));
    // 1) 比例模式：預設例子（40/40/20）再按「＋ 現金」填 25 → 現金占 25/125＝20%
    await p.click('#ltCash'); const n = await p.$$eval('#rows tr', t => t.length) - 1;
    ok(await p.$eval('#c' + n, e => e.value) === '現金', tag + '：按「＋ 現金」新增一列「現金」');
    await p.fill('#v' + n, '25'); await p.waitForTimeout(900);
    const info = await p.$eval('#i' + n, e => e.innerText);
    ok(info.includes('現金（台幣）') && info.includes('現金'), tag + '：資產欄顯示「' + info.replace(/\n/g, ' ') + '」');
    const k1 = await kv(); ok(k1.includes('含你輸入的現金 20.0%'), tag + '：摘要「非股票資產」含現金 20.0%｜' + k1.split(' | ').slice(9, 12).join(' '));
    const tb = await p.$eval('#ltTbl', e => e.innerText); ok(/現金（台幣）（自行輸入）\s+現金\s+20\.000%/.test(tb), tag + '：明細另列「現金（台幣）（自行輸入） 20.000%」');
    const src = await p.$eval('#ltSrc', e => e.innerText.replace(/\n/g, ' ')); ok(src.includes('現金（不拆解）') && src.includes('自行輸入'), tag + '：來源表顯示「現金（不拆解）／自行輸入」');
    const tsmc = await p.$eval('#ltTbl', e => { const r = [...e.querySelectorAll('tbody tr')].find(t => t.innerText.includes('2330')); return r ? r.children[4].innerText : ''; });
    ok(tsmc === '18.832%', tag + '：台積電＝0.4×58.85%×(100/125)＝18.832%，頁面顯示 ' + tsmc);
    if (tag === 'desk') {
      // 2) 股數模式：0050 1000 股＋現金 100,000 元＋美元現金 1,000 美元；現金列不能改價格
      await p.click('[data-mode="shares"]'); await p.waitForTimeout(300);
      await p.click('#ltClear'); await p.fill('#c0', '0050'); await p.fill('#v0', '1000');
      await p.click('#ltCash'); await p.fill('#v1', '100000');
      await p.click('#ltAdd'); await p.fill('#c2', '美金'); await p.fill('#v2', '1000'); await p.waitForTimeout(1000);
      ok(await p.$eval('#p1', e => e.disabled) && await p.$eval('#p2', e => e.disabled) && !(await p.$eval('#p0', e => e.disabled)), tag + '：現金列價格欄鎖住、0050 可改');
      ok((await p.$eval('#v1', e => e.placeholder)) === '金額' && (await p.$eval('#v0', e => e.placeholder)) === '股數', tag + '：數值欄提示「股數／金額」');
      const fx = await p.evaluate(async () => (await (await fetch('data/lt/px.json')).json()));
      const want = 1000 * fx.px['0050'] + 100000 + 1000 * fx.fx.USDTWD;
      const amt = await p.$eval('#ltTbl', e => [...e.querySelectorAll('tbody tr')].filter(t => t.innerText.includes('自行輸入')).map(t => t.children[5].innerText));
      ok(amt[0] === '100,000' && amt[1] === Math.round(1000 * fx.fx.USDTWD).toLocaleString('en-US'), tag + '：現金金額 ' + amt.join('、') + '（美元 1,000 × ' + fx.fx.USDTWD.toFixed(3) + '）');
      const k2 = await kv(); ok(k2.includes((want / 1e4).toFixed(1) + ' 萬') && k2.includes('＋現金'), tag + '：總金額＝1000×' + fx.px['0050'] + '＋100,000＋1000×' + fx.fx.USDTWD.toFixed(3) + '＝' + Math.round(want).toLocaleString('en-US') + '｜' + k2.split(' | ').slice(-3).join(' '));
      ok((await p.$eval('#i2', e => e.innerText)).includes('現金（美元）'), tag + '：輸入「美金」→ 現金（美元）');
      // 3) 真實代號不會變成現金
      await p.fill('#c2', 'USD'); await p.waitForTimeout(700); ok((await p.$eval('#i2', e => e.innerText)).includes('ProShares Ultra Semiconductors'), tag + '：輸入 USD 仍是 ProShares 2 倍半導體 ETF');
      await p.fill('#c2', 'CASH'); await p.waitForTimeout(700); ok((await p.$eval('#i2', e => e.innerText)).includes('Pathward'), tag + '：輸入 CASH 仍是 Pathward Financial 股票');
      // 4) 分享連結還原
      await p.fill('#c2', '美元現金'); await p.waitForTimeout(800); const url = p.url();
      const p2 = await ctx.newPage(); await p2.goto(url, { waitUntil: 'networkidle' }); await p2.waitForTimeout(800);
      const codes = await p2.$$eval('#rows .code', e => e.map(x => x.value)); ok(codes.join(',') === '0050,現金,美元現金', tag + '：分享連結還原 ' + codes.join('、'));
      await p2.close();
      // 5) 建議清單：打「現」會列出兩種現金
      await p.fill('#c0', '現'); await p.waitForTimeout(300); const opts = await p.$$eval('#ltlist option', o => o.slice(0, 3).map(x => x.value)); ok(opts.includes('現金') && opts.includes('美元現金'), tag + '：建議清單 ' + opts.join('、'));
      // 6) 範例「含現金」
      await p.click('[data-mode="pct"]'); const chips = await p.$$('[data-ex]'); await chips[chips.length - 1].click(); await p.waitForTimeout(1000);
      ok((await kv()).includes('含你輸入的現金 20.0%'), tag + '：範例「含現金」現金 20.0%');
    }
    await p.screenshot({ path: out + '/cash_' + tag + '.png', fullPage: true }); await ctx.close();
  }
  ok(!errs.length, '頁面錯誤：' + (errs.length ? errs.join('；') : '無'));
  await b.close();
})();
