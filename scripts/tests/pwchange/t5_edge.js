// 邊界：管理員密碼在別處改過之後，還開著的舊登入不會亂刪申請；很長的密碼；同一份申請兩個分頁同時處理
const L = require('./lib'); const { check } = L;
(async () => {
  const srv = await L.serve(L.SITE, L.PORT), E = await L.boot(), gh = E.gh, PW = Object.assign({}, L.SEC.pw);
  const acc = () => gh.json(L.MAIN, 'data/accounts.json'), rec = u => acc().accounts.find(a => a.user === u);
  const put = (user, text) => gh.put(L.PRIV, 'pw1/' + L.fidOf(user) + '.json', text, 'pwreq');
  const loginTo = async (p, user, pw, next) => { await p.goto(L.BASE + 'login.html?next=' + next); await p.fill('#u', user); await p.fill('#p', pw); await p.click('#go'); await p.waitForURL(u => u.pathname.endsWith('/' + next)); await p.waitForLoadState('domcontentloaded'); };
  try {
    // 裝置 2：管理員先登入後台（寫入權杖會記在這台），之後一直開著
    const c2 = await E.ctx(), p2 = await E.page(c2, 'admin dev2 (stale)');
    await E.login(p2, 'ADMIN_T', PW.ADMIN_T); await p2.waitForFunction(() => /已設定/.test(document.getElementById('pat-status').textContent), null, { timeout: 30000 });
    await p2.waitForFunction(() => /目前沒有待套用/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 30000 });
    // 裝置 1：管理員在會員專區改自己的密碼
    const c1 = await E.ctx(), p1 = await E.page(c1, 'admin dev1');
    await loginTo(p1, 'ADMIN_T', PW.ADMIN_T, 'member.html'); await p1.click('#pwc-open'); await p1.waitForSelector('#pwc[open]');
    await p1.fill('#pwc-cur', PW.ADMIN_T); await p1.fill('#pwc-new', 'Rotated#Chief2026'); await p1.fill('#pwc-new2', 'Rotated#Chief2026'); await p1.click('#pwc-go'); await p1.waitForURL(/login\.html/, { timeout: 40000 });
    check('管理員在裝置 1 改了密碼', L.canLogin(rec('ADMIN_T'), 'Rotated#Chief2026'));
    // 會員送出申請 → 裝置 2（舊登入）檢查：不能套用，但也不能刪
    put('M_DEF', L.makeReq(acc(), 'M_DEF', PW.M_DEF, 'Patient#Member55'));
    const snap = gh.get(L.MAIN, 'data/accounts.json');
    await p2.click('#pwcp-run'); await p2.waitForFunction(() => /解不開/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 40000 });
    check('舊登入的後台：顯示解不開並提示重新登入；申請留著、帳號檔不變', /重新登入/.test(await p2.textContent('#pwcp-status')) && gh.list(L.PRIV, 'pw1').length === 1 && gh.get(L.MAIN, 'data/accounts.json') === snap, await p2.textContent('#pwcp-status'));
    await p2.goto(L.BASE + 'member.html'); await p2.waitForTimeout(8000);
    check('舊登入開會員專區（背景檢查）：申請留著、帳號檔不變', gh.list(L.PRIV, 'pw1').length === 1 && gh.get(L.MAIN, 'data/accounts.json') === snap);
    // 用新密碼重新登入 → 正常套用
    const c3 = await E.ctx(), p3 = await E.page(c3, 'admin relogin');
    await E.login(p3, 'ADMIN_T', 'Rotated#Chief2026'); await p3.waitForFunction(() => /剛套用了 M_DEF/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 40000 });
    check('用新密碼重新登入後：申請正常套用', L.canLogin(rec('M_DEF'), 'Patient#Member55') && gh.list(L.PRIV, 'pw1').length === 0);
    // 兩個分頁同時處理同一份申請：只會寫一次，另一邊不留下錯誤紀錄
    const p4 = await E.page(c3, 'admin tab2'); await E.login(p4, 'ADMIN_T', 'Rotated#Chief2026'); await p4.waitForFunction(() => /目前沒有待套用/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 40000 });
    put('M_TWO', L.makeReq(acc(), 'M_TWO', PW.M_TWO, 'TwoTabs#Race777'));
    await p3.evaluate(() => localStorage.removeItem('bn-pwc-log'));
    const w0 = gh.calls.filter(c => c.m === 'PUT' && c.path.endsWith('data/accounts.json') && c.status < 300).length;
    await Promise.all([p3.click('#pwcp-run'), p4.click('#pwcp-run')]); await p3.waitForTimeout(9000);
    const w1 = gh.calls.filter(c => c.m === 'PUT' && c.path.endsWith('data/accounts.json') && c.status < 300).length, lg = await p3.evaluate(() => BN.pwc.log().map(x => x.user + ':' + x.res));
    check('兩個分頁同時處理：套用成功、帳號檔只因這份申請寫入一次、紀錄只有一筆「已套用」', L.canLogin(rec('M_TWO'), 'TwoTabs#Race777') && w1 - w0 === 1 && JSON.stringify(lg) === '["M_TWO:applied"]', { writes: w1 - w0, lg });
    check('　模型權限仍在', JSON.stringify(rec('M_TWO').models) === '["fund","sat2"]');
    // 很長的中文密碼（超過加密副本的容量）→ 在送出前就擋下
    const cM = await E.ctx(), pM = await E.page(cM, 'M_ALL');
    await E.login(pM, 'M_ALL', PW.M_ALL);
    const long = await pM.evaluate(() => [BN.pwc.policy('密碼'.repeat(60) + 'A1', 'M_ALL'), BN.pwc.policy('我的密碼很安全Xy7#kQ', 'M_ALL'), BN.pwc.policy('BNasdaq#2026xx', 'M_ALL')]);
    check('過長的密碼被擋；一般中英混合密碼可以；含本站名稱被擋', /太長/.test(long[0]) && long[1] === null && /本站名稱/.test(long[2]), long);
    await pM.click('#pwc-open'); await pM.waitForSelector('#pwc[open]'); await pM.fill('#pwc-cur', PW.M_ALL); await pM.fill('#pwc-new', '我的密碼很安全Xy7#kQ'); await pM.fill('#pwc-new2', '我的密碼很安全Xy7#kQ'); await pM.click('#pwc-go');
    await pM.waitForFunction(() => !document.getElementById('pwc').open, null, { timeout: 30000 });
    await p3.click('#pwcp-run'); await p3.waitForFunction(() => /剛套用了 M_ALL/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 40000 });
    check('中英混合密碼：送出、套用、可登入', L.canLogin(rec('M_ALL'), '我的密碼很安全Xy7#kQ'));
    const cN = await E.ctx(), pN = await E.page(cN, 'M_ALL new'); check('　全新裝置用中英混合密碼登入', /member\.html/.test(await E.login(pN, 'M_ALL', '我的密碼很安全Xy7#kQ')));
    check('全程沒有網頁錯誤', E.errors.length === 0, E.errors.slice(0, 6));
  } catch (e) { check('測試腳本執行完成', false, String(e && e.stack || e).slice(0, 900)); }
  await E.close(); srv.close(); process.exit(L.summary() ? 1 : 0);
})();
