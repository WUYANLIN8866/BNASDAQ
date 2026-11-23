// 管理員：在會員專區／每日市場分析背景自動套用、直接更改自己的密碼、後台既有功能回歸、存檔撞版不互相覆蓋
const L = require('./lib'); const { check } = L; const crypto = require('crypto'); const fs = require('fs');
(async () => {
  const srv = await L.serve(L.SITE, L.PORT), E = await L.boot(), gh = E.gh, PW = Object.assign({}, L.SEC.pw);
  const acc = () => gh.json(L.MAIN, 'data/accounts.json'), rec = u => acc().accounts.find(a => a.user === u), fileMain = () => gh.repos[L.MAIN.toLowerCase()].files['data/accounts.json'];
  const put = (user, text) => gh.put(L.PRIV, 'pw1/' + L.fidOf(user) + '.json', text, 'pwreq');
  const others = (db, u) => JSON.stringify(db.accounts.filter(a => a.user !== u));
  const shot = (p, n) => p.screenshot({ path: L.SHOTS + n + '.png' });
  const loginTo = async (p, user, pw, next) => { await p.goto(L.BASE + 'login.html?next=' + next); await p.fill('#u', user); await p.fill('#p', pw); await p.click('#go'); await p.waitForURL(u => u.pathname.endsWith('/' + next)); await p.waitForLoadState('domcontentloaded'); };
  try {
    // ---- A. 管理員開著「會員專區」：背景自動套用 ----
    put('M_DEF', L.makeReq(acc(), 'M_DEF', PW.M_DEF, 'Standalone#Mem1')); PW.M_DEF = 'Standalone#Mem1';
    let before = acc();
    const cA = await E.ctx(), pA = await E.page(cA, 'ADMIN_T member.html');
    await loginTo(pA, 'ADMIN_T', PW.ADMIN_T, 'member.html');
    await pA.waitForFunction(() => /已自動套用會員的密碼變更：M_DEF/.test(document.getElementById('pwc-status').textContent), null, { timeout: 40000 });
    check('會員專區（管理員）：背景自動套用並顯示一行通知', L.canLogin(rec('M_DEF'), PW.M_DEF) && others(acc(), 'M_DEF') === others(before, 'M_DEF') && gh.list(L.PRIV, 'pw1').length === 0);
    check('　寫入帶著讀取時的版本（沒有先查再寫）', gh.calls.filter(c => c.m === 'PUT' && c.path.endsWith('data/accounts.json')).length === 1);
    check('　紀錄也進了這台裝置的處理紀錄', await pA.evaluate(() => BN.pwc.log()[0].user === 'M_DEF' && BN.pwc.log()[0].res === 'applied'));
    // ---- B. 管理員開著「每日市場分析」：背景自動套用；第一次寫入撞版 → 重新讀取、重新驗證後成功 ----
    put('M_TWO', L.makeReq(acc(), 'M_TWO', PW.M_TWO, 'Standalone#Day2')); PW.M_TWO = 'Standalone#Day2';
    before = acc(); let hit = 0;
    gh.hooks.push(({ m, u }) => { if (m === 'PUT' && u.pathname.endsWith('data/accounts.json') && hit++ === 0) { const d = acc(); d.accounts.find(a => a.user === 'M_ALL').note = '別處同時改的備註'; d.updated = new Date().toISOString(); gh.put(L.MAIN, 'data/accounts.json', JSON.stringify(d, null, 1), 'elsewhere'); return { status: 409, body: { message: 'does not match' } }; } });
    await pA.goto(L.BASE + 'daily.html');
    const t0 = Date.now(); while (Date.now() - t0 < 40000 && !L.canLogin(rec('M_TWO'), PW.M_TWO)) await new Promise(r => setTimeout(r, 500));
    gh.hooks.length = 0;
    const d2 = acc();
    check('每日市場分析（管理員）：背景自動套用', L.canLogin(rec('M_TWO'), PW.M_TWO) && JSON.stringify(rec('M_TWO').models) === '["fund","sat2"]');
    check('　撞版時不覆蓋別處的修改：別處改的備註還在、M_TWO 的新密碼也寫進去了', hit >= 2 && d2.accounts.find(a => a.user === 'M_ALL').note === '別處同時改的備註', { hit, note: d2.accounts.find(a => a.user === 'M_ALL').note });
    // ---- C. 沒有寫入權杖的管理員（ADMIN_2）：不動任何東西、不出錯 ----
    put('M_ALL', L.makeReq(acc(), 'M_ALL', PW.M_ALL, 'Waiting#Chief3x'));
    const cB = await E.ctx(), pB = await E.page(cB, 'ADMIN_2'); const snapC = gh.get(L.MAIN, 'data/accounts.json');
    await loginTo(pB, 'ADMIN_2', PW.ADMIN_2, 'member.html'); await pB.waitForTimeout(7000);
    check('沒有寫入權杖的管理員開會員專區：帳號檔不變、申請留著等能處理的人', gh.get(L.MAIN, 'data/accounts.json') === snapC && gh.list(L.PRIV, 'pw1').length === 1);
    await pB.click('#pwc-open'); await pB.waitForSelector('#pwc[open]');
    check('　他的對話框說明是管理員版', /管理員密碼更改後立即生效/.test(await pB.textContent('#pwc-intro')));
    await pB.fill('#pwc-cur', PW.ADMIN_2); await pB.fill('#pwc-new', 'NoToken#Chief22'); await pB.fill('#pwc-new2', 'NoToken#Chief22'); await pB.click('#pwc-go');
    await pB.waitForFunction(() => /還沒設定網站寫入權限/.test(document.getElementById('pwc-msg').textContent), null, { timeout: 30000 });
    check('　他自己改密碼 → 提示先設定寫入權限，帳號檔不變', gh.get(L.MAIN, 'data/accounts.json') === snapC);
    await pB.goto(L.BASE + 'admin.html'); await pB.waitForFunction(() => !/檢查中/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 40000 });
    check('　他的後台顯示「有 1 筆申請待套用，但還沒設定網站寫入權限」', /有 1 筆申請待套用，但還沒設定網站寫入權限/.test(await pB.textContent('#pwcp-status')), await pB.textContent('#pwcp-status'));

    // ---- D. 管理員直接更改自己的密碼（會員專區的「更改密碼」）----
    await pA.goto(L.BASE + 'member.html'); await pA.waitForSelector('#pwc-open');
    await pA.waitForFunction(() => /M_ALL/.test(document.getElementById('pwc-status').textContent), null, { timeout: 40000 });   // 順便套用了 C 留下的那一份
    PW.M_ALL = 'Waiting#Chief3x'; check('（C 留下的申請由有權限的管理員套用）', L.canLogin(rec('M_ALL'), PW.M_ALL));
    before = acc();
    await pA.click('#pwc-open'); await pA.waitForSelector('#pwc[open]');
    check('管理員的對話框說明：立即生效並自動登出', /管理員密碼更改後立即生效/.test(await pA.textContent('#pwc-intro')));
    await shot(pA, '06-admin-dialog');
    const tryIt = async (cur, n1) => { await pA.fill('#pwc-cur', cur); await pA.fill('#pwc-new', n1); await pA.fill('#pwc-new2', n1); await pA.click('#pwc-go'); await pA.waitForFunction(() => { const m = document.querySelector('#pwc-msg .msg'); return m && !/處理中/.test(m.textContent); }, null, { timeout: 40000 }); return (await pA.textContent('#pwc-msg')).trim(); };
    check('管理員：目前密碼打錯 → 不更改', /目前的密碼不正確/.test(await tryIt('Wrong#Chief000', 'NewChief#2026zz')) && gh.get(L.MAIN, 'data/accounts.json') === JSON.stringify(before, null, 1));
    let hitD = 0; gh.hooks.push(({ m, u }) => { if (m === 'PUT' && u.pathname.endsWith('data/accounts.json') && hitD++ === 0) { const d = acc(); d.accounts.find(a => a.user === 'M_OFF').note = '撞版測試'; d.updated = new Date().toISOString(); gh.put(L.MAIN, 'data/accounts.json', JSON.stringify(d, null, 1), 'elsewhere'); return { status: 409, body: { message: 'does not match' } }; } });
    const NEWAD = 'NewChief#2026zz', okMsg = await tryIt(PW.ADMIN_T, NEWAD); gh.hooks.length = 0;
    check('管理員：更改成功訊息', /管理員密碼已更改/.test(okMsg), okMsg);
    await pA.waitForURL(/login\.html/, { timeout: 15000 });
    check('　自動登出並回到登入頁', await pA.evaluate(() => sessionStorage.getItem('bn-session') === null));
    const now = acc(), a1 = now.accounts.find(a => a.user === 'ADMIN_T'), a0 = before.accounts.find(a => a.user === 'ADMIN_T');
    check('　帳號檔：管理員驗證資料更新，其他帳號不變（撞版時別處改的備註也保留）', L.canLogin(a1, NEWAD) && !L.canLogin(a1, PW.ADMIN_T) && now.accounts.find(a => a.user === 'M_OFF').note === '撞版測試' && hitD >= 2 && JSON.stringify(now.accounts.filter(a => !['ADMIN_T', 'M_OFF'].includes(a.user))) === JSON.stringify(before.accounts.filter(a => !['ADMIN_T', 'M_OFF'].includes(a.user))));
    check('　帳號檔：其餘欄位不變', ['user', 'role', 'created', 'active', 'note'].every(k => a1[k] === a0[k]));
    // Node 獨立驗算：新的個人金鑰解得開「查看密碼」私鑰、寫入權杖
    const uk = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('bnasdaq-user-key-v1|'), L.pb(NEWAD, a1.wrap.salt)])).digest();
    let pk = null, patBack = ''; try { pk = crypto.createPrivateKey({ key: L.gcmDec(uk, now.view.priv.iv, now.view.priv.ct), format: 'der', type: 'pkcs8' }); patBack = L.gcmDec(uk, now.adminPat.iv, now.adminPat.ct).toString(); } catch (e) { }
    const openPv = pv => crypto.privateDecrypt({ key: pk, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(pv, 'base64')).toString();
    check('　Node 驗算：查看密碼的公鑰不變、私鑰改用新個人金鑰包裝且解得開；每個帳號的密碼副本都解得出來', pk && now.view.pub === before.view.pub && now.view.priv.ct !== before.view.priv.ct && openPv(a1.pv) === NEWAD && openPv(rec('M_DEF').pv) === PW.M_DEF && openPv(rec('M_TWO').pv) === PW.M_TWO);
    check('　Node 驗算：寫入權杖改用新個人金鑰加密且解得回原值', patBack === L.SEC.pat && now.adminPat.owner === 'ADMIN_T');
    PW.ADMIN_T = NEWAD;
    const cA2 = await E.ctx(), pA2 = await E.page(cA2, 'ADMIN_T new device');
    check('　全新裝置：舊管理員密碼不能登入', /帳號或密碼錯誤/.test(await E.login(pA2, 'ADMIN_T', L.SEC.pw.ADMIN_T, true)));
    await E.login(pA2, 'ADMIN_T', NEWAD);
    await pA2.waitForFunction(() => /已設定/.test(document.getElementById('pat-status').textContent), null, { timeout: 30000 });
    check('　全新裝置用新密碼登入：寫入權杖自動帶出（已設定）', true);
    await pA2.waitForSelector('#acct-body button[data-act="show"]');
    await pA2.locator('#acct-body tr', { hasText: 'M_DEF' }).locator('button[data-act="show"]').click();
    await pA2.waitForFunction(() => { const el = document.querySelector('#acct-table .pw[data-u="M_DEF"]'); return el && !/•/.test(el.textContent); });
    check('　全新裝置：仍可查看會員密碼', (await pA2.textContent('#acct-table .pw[data-u="M_DEF"]')) === PW.M_DEF);

    // ---- E. 後台既有功能回歸（存檔改成帶版本寫入後）----
    const P = pA2, accMsg = () => P.textContent('#acct-msg');
    const saved = async re => P.waitForFunction(r => new RegExp(r).test(document.getElementById('acct-msg').textContent), re.source, { timeout: 40000 });
    P._dialogs = [];
    await P.fill('#nu', 'NewGuy'); await P.fill('#np', 'NewGuy#Pass123'); await P.fill('#nn', '回歸測試'); await P.click('#add button[type="submit"]'); await saved(/已儲存（admin: add account NewGuy）/);
    check('新增會員：寫入成功、預設只開通 fund、可登入', L.canLogin(rec('NewGuy'), 'NewGuy#Pass123') && JSON.stringify(rec('NewGuy').models) === '["fund"]' && /NewGuy \/ NewGuy#Pass123/.test((P._dialogs || []).join('|')), P._dialogs);
    const row = u => P.locator('#acct-body tr', { hasText: u });
    await row('NewGuy').locator('button[data-act="edit"]').click(); await P.waitForSelector('#acct-edit[open]'); await P.fill('#ae-note', '改過備註'); await P.click('#ae-save'); await saved(/edit account NewGuy/);
    check('編輯（只改備註）：密碼不變', rec('NewGuy').note === '改過備註' && L.canLogin(rec('NewGuy'), 'NewGuy#Pass123'));
    await row('NewGuy').locator('button[data-act="edit"]').click(); await P.waitForSelector('#acct-edit[open]'); await P.fill('#ae-pw', 'Edited#Pass456'); await P.click('#ae-save'); await saved(/密碼更新/);
    check('編輯（改密碼）：新密碼可登入、模型權限保留', L.canLogin(rec('NewGuy'), 'Edited#Pass456') && JSON.stringify(rec('NewGuy').models) === '["fund"]');
    await row('NewGuy').locator('button[data-act="toggle"]').click(); await saved(/disable NewGuy/); check('停用', rec('NewGuy').active === false);
    await row('NewGuy').locator('button[data-act="toggle"]').click(); await saved(/enable NewGuy/); check('啟用', rec('NewGuy').active === true);
    await P.locator('#mp-list .mp-row', { hasText: 'NewGuy' }).locator('input[data-r="sat"]').check(); await P.click('#mp-save'); await saved(/model access NewGuy=fund\+sat/);
    check('模型權限儲存', JSON.stringify(rec('NewGuy').models) === '["fund","sat"]');
    // 撞版：頁面載入後，帳號檔被別處改了（例：另一個分頁套用了會員的密碼變更）→ 這次存檔被擋下、重新載入，不覆蓋
    put('M_DEF', L.makeReq(acc(), 'M_DEF', PW.M_DEF, 'Elsewhere#Tab99'));
    const d = acc(); const ext = JSON.parse(JSON.stringify(d)); const rq = d.accounts.find(a => a.user === 'M_OFF'); ext.accounts.find(a => a.user === 'M_OFF').note = '另一個分頁改的'; ext.updated = new Date().toISOString();
    gh.put(L.MAIN, 'data/accounts.json', JSON.stringify(ext, null, 1), 'other tab'); const snapExt = gh.get(L.MAIN, 'data/accounts.json');
    await row('NewGuy').locator('button[data-act="del"]').click();
    await saved(/帳號資料剛被其他地方更新過/);
    check('撞版：這次刪除沒有存入、別處的修改沒有被蓋掉', acc().accounts.some(a => a.user === 'NewGuy') && acc().accounts.find(a => a.user === 'M_OFF').note === '另一個分頁改的', await accMsg());
    await P.waitForFunction(() => /另一個分頁改的/.test(document.getElementById('acct-body').textContent), null, { timeout: 30000 });
    check('　頁面自動重新載入最新資料（看得到別處改的備註、NewGuy 還在）', /NewGuy/.test(await P.textContent('#acct-body')));
    await P.waitForFunction(() => /剛套用了 M_DEF/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 40000 }); PW.M_DEF = 'Elsewhere#Tab99';
    check('　重新載入後順便套用了等待中的申請', L.canLogin(rec('M_DEF'), PW.M_DEF) && acc().accounts.find(a => a.user === 'M_OFF').note === '另一個分頁改的');
    await row('NewGuy').locator('button[data-act="del"]').click(); await saved(/delete account NewGuy/);
    check('再操作一次 → 刪除成功，其他修改都還在', !acc().accounts.some(a => a.user === 'NewGuy') && L.canLogin(rec('M_DEF'), PW.M_DEF) && acc().accounts.find(a => a.user === 'M_OFF').note === '另一個分頁改的');
    // 編輯對話框開著時撞版 → 對話框關閉、不存
    await row('M_OFF').locator('button[data-act="edit"]').click(); await P.waitForSelector('#acct-edit[open]'); await P.fill('#ae-note', '要被擋下的修改');
    const e2 = acc(); e2.accounts.find(a => a.user === 'M_ALL').note = '第二次別處修改'; e2.updated = new Date().toISOString(); gh.put(L.MAIN, 'data/accounts.json', JSON.stringify(e2, null, 1), 'other tab 2');
    await P.click('#ae-save'); await P.waitForFunction(() => !document.getElementById('acct-edit').open && /帳號資料剛被其他地方更新過/.test(document.getElementById('acct-msg').textContent), null, { timeout: 30000 });
    await P.waitForFunction(() => /第二次別處修改/.test(document.getElementById('acct-body').textContent), null, { timeout: 30000 });
    check('編輯時撞版：對話框關閉、沒有存入、畫面換成最新資料', acc().accounts.find(a => a.user === 'M_OFF').note === '另一個分頁改的' && acc().accounts.find(a => a.user === 'M_ALL').note === '第二次別處修改');
    // 後台原本的「更改管理員密碼」表單
    await P.fill('#pw1', 'FormChief#5566x'); await P.fill('#pw2', 'FormChief#5566x'); await P.click('#chpw button[type="submit"]'); await P.waitForURL(/login\.html/, { timeout: 40000 });
    check('後台原本的「更改管理員密碼」照常運作', L.canLogin(rec('ADMIN_T'), 'FormChief#5566x') && !L.canLogin(rec('ADMIN_T'), NEWAD));
    PW.ADMIN_T = 'FormChief#5566x';
    await E.login(P, 'ADMIN_T', PW.ADMIN_T); await P.waitForFunction(() => /已設定/.test(document.getElementById('pat-status').textContent), null, { timeout: 30000 });
    check('　之後用新密碼登入，寫入權杖與密碼查看都正常', true);

    // ---- F. 不是「密碼查看」擁有者的管理員（有權杖）→ 解不開申請，顯示原因，不動帳號檔 ----
    await pB.goto(L.BASE + 'admin.html'); await pB.waitForSelector('#pat');
    await pB.fill('#pat', L.SEC.pat); await pB.click('#pat-save'); await pB.waitForFunction(() => /權杖可用/.test(document.getElementById('pat-msg').textContent), null, { timeout: 30000 });
    await pB.waitForFunction(() => /store write token/.test(document.getElementById('acct-msg').textContent), null, { timeout: 30000 });
    put('M_TWO', L.makeReq(acc(), 'M_TWO', PW.M_TWO, 'NotOwner#Try77')); const snapF = gh.get(L.MAIN, 'data/accounts.json');
    await pB.click('#pwcp-run'); await pB.waitForFunction(() => /這個管理員帳號解不開/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 30000 });
    check('非擁有者管理員：顯示「解不開」，帳號檔不變、申請留著', gh.get(L.MAIN, 'data/accounts.json') === snapF && gh.list(L.PRIV, 'pw1').length === 1);
    // ---- G. 同步用的 token 失效／沒啟用同步 ----
    gh.repos[L.PRIV.toLowerCase()].write = []; gh.repos[L.PRIV.toLowerCase()].read = [];
    await pB.click('#pwcp-run'); await pB.waitForFunction(() => !/檢查中|解不開/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 30000 });
    check('同步用的 token 讀不到 repo：後台不出錯、不動帳號檔', gh.get(L.MAIN, 'data/accounts.json') === snapF, await pB.textContent('#pwcp-status'));
    gh.repos[L.PRIV.toLowerCase()].write = [L.SEC.sync];
    const cOff = await E.ctx(); await cOff.route(L.BASE + 'data/sync-key.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schema: 'bnasdaq-sync-key/1', enabled: false }) }));
    const pOff = await E.page(cOff, 'sync off member');
    await E.login(pOff, 'M_TWO', PW.M_TWO); await pOff.click('#pwc-open'); await pOff.waitForSelector('#pwc[open]');
    await pOff.waitForFunction(() => /請聯絡管理員協助更改/.test(document.getElementById('pwc-msg').textContent), null, { timeout: 15000 });
    check('站方沒啟用同步：會員看到「請聯絡管理員協助更改」，送出鍵停用', await pOff.evaluate(() => document.getElementById('pwc-go').disabled));
    const pOffA = await E.page(cOff, 'sync off admin'); await pOffA.evaluate(() => 0).catch(() => 0);
    const cOff2 = await E.ctx(); await cOff2.route(L.BASE + 'data/sync-key.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schema: 'bnasdaq-sync-key/1', enabled: false }) }));
    const pOff2 = await E.page(cOff2, 'sync off admin'); await E.login(pOff2, 'ADMIN_T', PW.ADMIN_T);
    await pOff2.waitForFunction(() => /會員目前無法送出申請/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 40000 });
    check('站方沒啟用同步：後台說明「會員目前無法送出申請…請先啟用」', true);
    check('全程沒有網頁錯誤', E.errors.length === 0, E.errors.slice(0, 6));
  } catch (e) { check('測試腳本執行完成', false, String(e && e.stack || e).slice(0, 900)); }
  await E.close(); srv.close(); process.exit(L.summary() ? 1 : 0);
})();
