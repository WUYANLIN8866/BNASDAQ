// 安全：偽造、過期、重放、弱密碼、動到管理員／停用帳號…的申請一律不套用；合法的照常套用
const L = require('./lib'); const { check } = L; const crypto = require('crypto');
(async () => {
  const srv = await L.serve(L.SITE, L.PORT), E = await L.boot(), gh = E.gh, PW = L.SEC.pw;
  const acc = () => gh.json(L.MAIN, 'data/accounts.json'), rec = u => acc().accounts.find(a => a.user === u);
  const put = (fid, text) => gh.put(L.PRIV, 'pw1/' + fid + '.json', text, 'pwreq');
  const mainWrites = () => gh.calls.filter(c => c.m !== 'GET' && c.path.startsWith('/repos/' + L.MAIN + '/')).length;
  const hex40 = () => crypto.randomBytes(20).toString('hex');
  try {
    const db0 = acc(), snap0 = gh.get(L.MAIN, 'data/accounts.json');
    const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    // ---- 第一輪：全部都不該套用 ----
    const cases = {
      wrongpw: ['M_DEF', L.makeReq(db0, 'M_DEF', 'x', 'Forged#Pass123', { proof: crypto.randomBytes(32) })],                       // 別的會員偽造：拿不出目前密碼導出的金鑰
      weak: ['M_TWO', L.makeReq(db0, 'M_TWO', PW.M_TWO, 'short1A')],                                                              // 繞過網頁直接送弱密碼
      badck: ['M_ALL', L.makeReq(db0, 'M_ALL', PW.M_ALL, 'Decent#Pass123', { ck: crypto.randomBytes(32) })],                      // 包裝的不是同一把主金鑰
      admin: ['ADMIN_2', L.makeReq(db0, 'ADMIN_2', PW.ADMIN_2, 'Decent#Pass123')],                                                // 目標是管理員帳號
      inactive: ['M_OFF', L.makeReq(db0, 'M_OFF', PW.M_OFF, 'Decent#Pass123')],                                                   // 停用的帳號
      badhash: ['Mixed.Case-1', L.makeReq(db0, 'Mixed.Case-1', PW['Mixed.Case-1'], 'Decent#Pass123', { rec: r => { r.auth.hash = L.b64(crypto.randomBytes(32)); } })],   // 雜湊和密碼對不上
    };
    for (const k in cases) put(L.fidOf(cases[k][0]), cases[k][1]);
    put(hex40(), 'this is not json');                                                                                              // 垃圾檔
    put(hex40(), L.makeReq(Object.assign({}, db0), 'M_DEF', PW.M_DEF, 'Decent#Pass123', { view: { pub: otherKey } }));            // 用別把金鑰加密（管理員解不開）
    put(hex40(), JSON.stringify({ schema: 'bnasdaq-pwreq/1', ek: 'A'.repeat(512), iv: 'AAAAAAAAAAAAAAAA', ct: 'B'.repeat(20000) }));   // 過大
    put(L.fidOf('GHOST'), L.makeReq({ view: db0.view, accounts: [Object.assign({}, db0.accounts[2], { user: 'GHOST' })] }, 'GHOST', PW.M_DEF, 'Decent#Pass123'));   // 不存在的帳號
    put(L.fidOf('nobody-else'), L.makeReq(db0, 'M_DEF', PW.M_DEF, 'Decent#Pass123'));                                              // 合法內容但放在別的檔名
    const n0 = gh.list(L.PRIV, 'pw1').length;
    const cAd = await E.ctx(), pAd = await E.page(cAd, 'ADMIN_T');
    await E.login(pAd, 'ADMIN_T', PW.ADMIN_T);
    const settle = async () => { await pAd.waitForFunction(() => !/檢查中/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 60000 }); return pAd.textContent('#pwcp-status'); };
    const st1 = await settle();
    check('第一輪放了 ' + n0 + ' 份有問題的申請', n0 === 11, n0);
    check('第一輪：帳號檔一個字都沒變', gh.get(L.MAIN, 'data/accounts.json') === snap0);
    check('第一輪：沒有任何寫入網站 repo 的動作', mainWrites() === 0, mainWrites());
    check('第一輪：有問題的申請全部清掉', gh.list(L.PRIV, 'pw1').length === 0, gh.list(L.PRIV, 'pw1'));
    check('第一輪：後台顯示「沒有通過驗證，已略過」', /11 筆沒有通過驗證/.test(st1), st1);
    const log1 = await pAd.evaluate(() => BN.pwc.log().map(x => x.user + ':' + x.res));
    const want = ['M_DEF:wrongpw', 'M_TWO:weak', 'M_ALL:badrec', 'ADMIN_2:admin', 'M_OFF:inactive', 'Mixed.Case-1:badrec', ':unreadable', ':unreadable', ':unreadable', 'GHOST:nouser', 'M_DEF:badrec'];
    check('第一輪：每一份的原因都判對', JSON.stringify(log1.slice().sort()) === JSON.stringify(want.slice().sort()), log1);
    check('第一輪：原本的密碼都還能登入（Node 驗算）', ['M_DEF', 'M_TWO', 'M_ALL', 'ADMIN_2', 'Mixed.Case-1'].every(u => L.canLogin(rec(u), PW[u])));

    // ---- 第二輪：過期、對不上目前帳號檔、和目前密碼相同、給管理員的副本和雜湊不一致、格式不對 ----
    put(L.fidOf('M_DEF'), L.makeReq(db0, 'M_DEF', PW.M_DEF, 'Decent#Pass123', { q: { at: new Date(Date.now() - 40 * 864e5).toISOString() } }));
    put(L.fidOf('M_TWO'), L.makeReq(db0, 'M_TWO', PW.M_TWO, 'Decent#Pass123', { q: { salt: L.b64(crypto.randomBytes(16)) } }));
    put(L.fidOf('M_ALL'), L.makeReq(db0, 'M_ALL', PW.M_ALL, PW.M_ALL));
    put(L.fidOf('Mixed.Case-1'), L.makeReq(db0, 'Mixed.Case-1', PW['Mixed.Case-1'], 'Decent#Pass123', { pvPw: 'Different#Pass999' }));
    await pAd.evaluate(() => localStorage.removeItem('bn-pwc-log'));
    await pAd.click('#pwcp-run'); await pAd.waitForFunction(() => /4 筆沒有通過驗證/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 60000 });
    const log2 = await pAd.evaluate(() => BN.pwc.log().map(x => x.user + ':' + x.res));
    check('第二輪：過期／對不上／相同／副本不一致 都判對', JSON.stringify(log2.slice().sort()) === JSON.stringify(['M_DEF:expired', 'M_TWO:stale', 'M_ALL:same', 'Mixed.Case-1:badrec'].sort()), log2);
    check('第二輪：帳號檔仍然一個字都沒變、沒有寫入', gh.get(L.MAIN, 'data/accounts.json') === snap0 && mainWrites() === 0 && gh.list(L.PRIV, 'pw1').length === 0);
    for (const [name, mut] of [['iter 被改小', r => { r.auth.iter = 1000; }], ['salt 長度不對', r => { r.wrap.salt = L.b64(crypto.randomBytes(8)); }], ['少了 pv', r => { delete r.pv; }], ['多帶 role 想升級成管理員', r => { r.role = 'admin'; r.models = ['fund', 'sat', 'sat2', 'sat3']; }]]) {
      put(L.fidOf('M_DEF'), L.makeReq(db0, 'M_DEF', PW.M_DEF, 'Decent#Pass123', { rec: mut }));
      await pAd.evaluate(() => localStorage.removeItem('bn-pwc-log')); await pAd.click('#pwcp-run');
      await pAd.waitForFunction(() => BN.pwc.log().length > 0 && !/檢查中/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 60000 });
      const lg = await pAd.evaluate(() => BN.pwc.log().map(x => x.user + ':' + x.res));
      if (name.startsWith('多帶')) {   // 多帶的欄位不會被採用：通過（合法申請），但只換驗證資料
        const a = rec('M_DEF'); check('申請裡多帶 role／models：照常套用，但身分與權限不變', lg[0] === 'M_DEF:applied' && a.role === 'member' && a.models === undefined && L.canLogin(a, 'Decent#Pass123') && JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(db0.accounts.find(x => x.user === 'M_DEF'))), [lg, Object.keys(a)]);
      } else check('格式不對（' + name + '）→ 不套用', lg[0] === 'M_DEF:badrec' && gh.get(L.MAIN, 'data/accounts.json') === snap0, lg);
    }

    // ---- 第三輪：重放 ----
    const db1 = acc(), good = L.makeReq(db1, 'M_TWO', PW.M_TWO, 'Proper#Change77'), older = L.makeReq(db1, 'M_TWO', PW.M_TWO, 'Earlier#Choice55');
    put(L.fidOf('M_TWO'), good); await pAd.click('#pwcp-run'); await pAd.waitForFunction(() => /剛套用了 M_TWO/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 60000 });
    const snap1 = gh.get(L.MAIN, 'data/accounts.json');
    check('合法申請照常套用', L.canLogin(rec('M_TWO'), 'Proper#Change77') && !L.canLogin(rec('M_TWO'), PW.M_TWO));
    await pAd.evaluate(() => localStorage.removeItem('bn-pwc-log'));
    put(L.fidOf('M_TWO'), good); await pAd.click('#pwcp-run'); await pAd.waitForFunction(() => /運作中/.test(document.getElementById('pwcp-status').textContent) && !/剛套用/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 60000 });
    check('把已套用的同一份再放回去（重放）→ 帳號檔不變、檔案清掉、不記成錯誤', gh.get(L.MAIN, 'data/accounts.json') === snap1 && gh.list(L.PRIV, 'pw1').length === 0 && (await pAd.evaluate(() => BN.pwc.log().length)) === 0);
    put(L.fidOf('M_TWO'), older); await pAd.click('#pwcp-run'); await pAd.waitForFunction(() => /1 筆沒有通過驗證/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 60000 });
    check('把更早做好的另一份放回去 → 判定「送出後密碼已被改過」，不套用', gh.get(L.MAIN, 'data/accounts.json') === snap1 && (await pAd.evaluate(() => BN.pwc.log()[0].res)) === 'stale');
    // 管理員在後台另外重設某會員密碼 → 那位會員先前送的申請作廢，會員端顯示作廢
    const cM = await E.ctx(), pM = await E.page(cM, 'M_ALL');
    await E.login(pM, 'M_ALL', PW.M_ALL); await pM.click('#pwc-open'); await pM.waitForSelector('#pwc[open]');
    await pM.fill('#pwc-cur', PW.M_ALL); await pM.fill('#pwc-new', 'Member#Wanted88'); await pM.fill('#pwc-new2', 'Member#Wanted88'); await pM.click('#pwc-go'); await pM.waitForFunction(() => !document.getElementById('pwc').open, null, { timeout: 30000 });
    // 管理員在套用之前先手動改掉（編輯對話框）：這時後台頁面上的資料是舊的，存檔 → 不衝突（還沒人改帳號檔）
    await pAd.locator('#acct-body tr', { hasText: 'M_ALL' }).locator('button[data-act="edit"]').click(); await pAd.waitForSelector('#acct-edit[open]');
    await pAd.fill('#ae-pw', 'AdminReset#4321'); await pAd.click('#ae-save'); await pAd.waitForFunction(() => !document.getElementById('acct-edit').open, null, { timeout: 30000 });
    check('管理員手動重設成功', L.canLogin(rec('M_ALL'), 'AdminReset#4321'));
    await pAd.evaluate(() => localStorage.removeItem('bn-pwc-log')); await pAd.click('#pwcp-run'); await pAd.waitForFunction(() => /1 筆沒有通過驗證/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 60000 });
    check('會員先前送的申請 → 作廢（stale），密碼維持管理員設的', (await pAd.evaluate(() => BN.pwc.log()[0].res)) === 'stale' && L.canLogin(rec('M_ALL'), 'AdminReset#4321') && !L.canLogin(rec('M_ALL'), 'Member#Wanted88'));
    await pM.reload(); await pM.waitForFunction(() => !document.getElementById('pwc-status').hidden);
    check('會員端顯示「已由管理員另行更改…作廢」', /已由管理員另行更改/.test(await pM.textContent('#pwc-status')), await pM.textContent('#pwc-status'));
    await pM.evaluate(() => sessionStorage.removeItem('bn-session'));
    check('作廢後：會員送出的那組在那台裝置也不能登入', /帳號或密碼錯誤/.test(await E.login(pM, 'M_ALL', 'Member#Wanted88', true)));
    // 申請被別的會員刪掉（只能搗亂、不能冒用）→ 送出的人看到「沒有生效」，那組密碼在那台裝置也失效
    const cD = await E.ctx(), pD = await E.page(cD, 'Mixed');
    await E.login(pD, 'Mixed.Case-1', PW['Mixed.Case-1']); await pD.click('#pwc-open'); await pD.waitForSelector('#pwc[open]');
    await pD.fill('#pwc-cur', PW['Mixed.Case-1']); await pD.fill('#pwc-new', 'Deleted#ByOther1'); await pD.fill('#pwc-new2', 'Deleted#ByOther1'); await pD.click('#pwc-go'); await pD.waitForFunction(() => !document.getElementById('pwc').open, null, { timeout: 30000 });
    delete gh.repos[L.PRIV.toLowerCase()].files['pw1/' + L.fidOf('Mixed.Case-1') + '.json'];
    await pD.reload(); await pD.waitForFunction(() => !document.getElementById('pwc-status').hidden);
    check('申請被刪掉 → 會員端顯示「沒有生效…請重新送出」', /沒有生效/.test(await pD.textContent('#pwc-status')), await pD.textContent('#pwc-status'));
    await pD.evaluate(() => sessionStorage.removeItem('bn-session'));
    check('　那組密碼不能登入、原本的可以', /帳號或密碼錯誤/.test(await E.login(pD, 'Mixed.Case-1', 'Deleted#ByOther1', true)) && /member\.html/.test(await E.login(pD, 'Mixed.Case-1', PW['Mixed.Case-1'])));

    // ---- 登入頁：等待生效的資料被竄改、不屬於目前帳號檔、管理員帳號 → 都不採用 ----
    const cT = await E.ctx(), pT = await E.page(cT, 'tamper');
    await pT.goto(L.BASE + 'login.html');
    const cur = rec('M_DEF'), other = L.makeReq(acc(), 'M_DEF', 'x', 'Planted#Pass123', { proof: crypto.randomBytes(32), ck: crypto.randomBytes(32) });
    const plant = async (user, base, rec2) => pT.evaluate(([u, b, r]) => localStorage.setItem('bn-pwc:' + u, JSON.stringify({ base: b, at: new Date().toISOString(), rec: r })), [user, base, rec2]);
    const mk = (pw, ck) => { const sa = crypto.randomBytes(16), sw = crypto.randomBytes(16); return { auth: { salt: L.b64(sa), iter: L.ITER, hash: L.b64(L.pb(pw, L.b64(sa))) }, wrap: Object.assign({ salt: L.b64(sw), iter: L.ITER }, L.gcmEnc(L.pb(pw, L.b64(sw)), ck)) }; };
    await plant('M_DEF', cur.auth.salt, mk('Planted#Pass123', crypto.randomBytes(32)));   // 不知道主金鑰的人在這台瀏覽器塞一筆自己做的
    await E.login(pT, 'M_DEF', 'Planted#Pass123');
    const fake = await pT.evaluate(async () => { const s = JSON.parse(sessionStorage.getItem('bn-session')); let rules = 'no'; try { await BN.auth.loadRules(s); rules = 'yes'; } catch (e) { } const b = document.getElementById('pwc-open'); b.click(); await new Promise(r => setTimeout(r, 1500)); return { ck: s.ck, rules, msg: document.getElementById('pwc-msg').textContent, dis: document.getElementById('pwc-go').disabled }; });
    check('不知道主金鑰的人自己塞資料 → 拿不到真的主金鑰、解不開規則、也送不出改密碼申請（和直接竄改瀏覽器的登入狀態一樣沒有用）', fake.ck !== L.SEC.ck && fake.rules === 'no' && /請聯絡管理員/.test(fake.msg) && fake.dis, { rules: fake.rules, msg: fake.msg });
    await pT.evaluate(() => { sessionStorage.removeItem('bn-session'); });
    await plant('M_DEF', 'not-the-current-salt', mk('Planted#Pass123', L.CK));
    check('base 對不上目前帳號檔 → 不採用', /帳號或密碼錯誤/.test(await E.login(pT, 'M_DEF', 'Planted#Pass123', true)));
    await plant('ADMIN_T', rec('ADMIN_T').auth.salt, mk('Planted#Pass123', L.CK));
    check('管理員帳號不採用等待生效的資料', /帳號或密碼錯誤/.test(await E.login(pT, 'ADMIN_T', 'Planted#Pass123', true)));
    await plant('M_OFF', rec('M_OFF').auth.salt, mk('Planted#Pass123', L.CK));
    check('停用的帳號不採用', /已停用/.test(await E.login(pT, 'M_OFF', 'Planted#Pass123', true)));
    const bad = mk('Planted#Pass123', L.CK); bad.wrap.ct = L.b64(crypto.randomBytes(48));
    await plant('M_DEF', cur.auth.salt, bad);
    check('包裝被竄改 → 一般的「帳號或密碼錯誤」，並清掉那筆資料', /帳號或密碼錯誤/.test(await E.login(pT, 'M_DEF', 'Planted#Pass123', true)) && await pT.evaluate(() => localStorage.getItem('bn-pwc:M_DEF') === null));
    check('全程沒有網頁錯誤', E.errors.length === 0, E.errors.slice(0, 6));
  } catch (e) { check('測試腳本執行完成', false, String(e && e.stack || e).slice(0, 700)); }
  await E.close(); srv.close(); process.exit(L.summary() ? 1 : 0);
})();
