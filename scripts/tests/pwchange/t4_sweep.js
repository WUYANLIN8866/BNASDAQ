// 全站回歸：20 頁 × 3 種身分 × 2 種寬度——沒有程式錯誤、沒有橫向溢出；另外截圖（手機、深色）檢查新按鈕與對話框
const L = require('./lib'); const { check } = L; const fs = require('fs');
const PAGES = ['index', 'about', 'daily', 'research', 'dca', 'taiwan', 'valuation', 'lookthrough', 'calculator', 'explore', 'risk', 'faq', 'data', 'news', 'plans', 'search', 'login', 'member', 'admin', '404'];
(async () => {
  const srv = await L.serve(L.SITE, L.PORT), E = await L.boot(), PW = L.SEC.pw; let visits = 0; const over = [], errs = [];
  
  try {
    for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) for (const who of ['guest', 'M_DEF', 'ADMIN_T']) {
      const c = await E.ctx({ viewport: vp }), p = await E.page(c, who + '@' + vp.width);
      if (who !== 'guest') await E.login(p, who, PW[who]);
      for (const pg of PAGES) {
        const n0 = E.errors.length;
        await p.goto(L.BASE + pg + '.html', { waitUntil: 'load' }); await p.waitForTimeout(pg === 'member' || pg === 'admin' || pg === 'daily' ? 6500 : 1200); visits++;
        const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, url: location.pathname.split('/').pop() }));
        if (o.sw > o.iw + 1) over.push(who + '@' + vp.width + ' ' + pg + ' ' + o.sw + '>' + o.iw);
        E.errors.slice(n0).forEach(e => errs.push(who + '@' + vp.width + ' ' + pg + ': ' + e.text.slice(0, 160)));
        if (who === 'M_DEF' && pg === 'member') {
          await p.screenshot({ path: L.SHOTS + '10-member-' + vp.width + '.png' });
          await p.click('#pwc-open'); await p.waitForSelector('#pwc[open]'); await p.fill('#pwc-new', 'x'); await p.click('#pwc-gen');
          const d = await p.evaluate(() => { const r = document.getElementById('pwc').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth }; });
          check('對話框完整在畫面內（寬 ' + vp.width + '）', d.l >= 0 && d.r <= d.iw + 0.5 && d.t >= 0 && d.sw <= d.iw + 1, d);
          await p.screenshot({ path: L.SHOTS + '11-dialog-' + vp.width + '.png' });
          await p.evaluate(() => BN.toggleTheme()); await p.waitForTimeout(300);
          await p.screenshot({ path: L.SHOTS + '12-dialog-dark-' + vp.width + '.png' });
          await p.evaluate(() => BN.toggleTheme()); await p.click('#pwc-cancel');
          check('取消後欄位清空（寬 ' + vp.width + '）', await p.evaluate(() => !document.getElementById('pwc').open && document.getElementById('pwc-new').value === '' && document.getElementById('pwc-cur').value === ''));
          // 鍵盤：Esc 關閉、Tab 順序
          await p.click('#pwc-open'); await p.waitForSelector('#pwc[open]'); await p.fill('#pwc-cur', 'abc'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
          check('Esc 關閉並清空（寬 ' + vp.width + '）', await p.evaluate(() => !document.getElementById('pwc').open && document.getElementById('pwc-cur').value === ''));
        }
        if (who === 'guest' && (pg === 'member' || pg === 'admin')) check('訪客開 ' + pg + '.html → 導回登入頁（寬 ' + vp.width + '）', o.url === 'login.html', o.url);
      }
      await c.close();
    }
    check('共 ' + visits + ' 次開頁：0 個程式錯誤', errs.length === 0, errs.slice(0, 8));
    check('0 個橫向溢出', over.length === 0, over);
  } catch (e) { check('測試腳本執行完成', false, String(e && e.stack || e).slice(0, 700)); }
  await E.close(); srv.close(); process.exit(L.summary() ? 1 : 0);
})();
