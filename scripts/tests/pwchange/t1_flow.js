// 主流程：會員送出 → 這台裝置可先用新密碼 → 管理員登入後台自動套用 → 所有裝置生效
const L = require('./lib'); const { check } = L; const fs = require('fs');
(async () => {
  const srv = await L.serve(L.SITE, L.PORT), E = await L.boot(), gh = E.gh, PW = L.SEC.pw;
  const acc = () => gh.json(L.MAIN, 'data/accounts.json'), rec = u => acc().accounts.find(a => a.user === u);
  const shot = (p, n) => p.screenshot({ path: L.SHOTS + n + '.png' });
  
  try {
    // ---- 1. 按鈕位置與對話框 ----
    const cA = await E.ctx(), pA = await E.page(cA, 'M_DEF devA');
    await E.login(pA, 'M_DEF', PW.M_DEF);
    await pA.waitForSelector('#pwc-open');
    const order = await pA.evaluate(() => { const b = document.getElementById('pwc-open'), n = b.nextElementSibling; return { label: b.textContent, next: n && n.textContent, sameRow: b.parentElement === n.parentElement, visible: b.offsetParent !== null }; });
    check('「更改密碼」按鈕在「登出」旁邊（同一列、緊鄰在前）', order.label === '更改密碼' && order.next === '登出' && order.sameRow && order.visible, order);
    check('還沒送出時狀態列隱藏', await pA.evaluate(() => document.getElementById('pwc-status').hidden));
    await shot(pA, '01-member-panel');
    await pA.click('#pwc-open'); await pA.waitForSelector('#pwc[open]');
    check('會員的對話框說明：等管理端更新才生效', /等管理端完成更新才會在所有裝置生效/.test(await pA.textContent('#pwc-intro')));
    await shot(pA, '02-dialog');
    const tryIt = async (cur, n1, n2) => { await pA.fill('#pwc-cur', cur); await pA.fill('#pwc-new', n1); await pA.fill('#pwc-new2', n2 == null ? n1 : n2); await pA.click('#pwc-go'); await pA.waitForFunction(() => { const m = document.querySelector('#pwc-msg .msg'); return !document.getElementById('pwc').open || (m && !/處理中/.test(m.textContent)); }, null, { timeout: 30000 }); return (await pA.textContent('#pwc-msg')).trim(); };
    const NEW = 'Sunrise#Lake42';
    check('擋：太短', /至少要 10 碼/.test(await tryIt(PW.M_DEF, 'Ab1#xyz')));
    check('擋：只有一種字元', /至少兩種/.test(await tryIt(PW.M_DEF, 'abcdefghijkl')));
    check('擋：包含帳號名稱', /不能包含帳號名稱/.test(await tryIt(PW.M_DEF, 'xxm_defXX99')));
    check('擋：常見字串', /太容易被猜到/.test(await tryIt(PW.M_DEF, 'MyPassword99')));
    check('擋：連續重複的字', /太容易被猜到/.test(await tryIt(PW.M_DEF, 'Zzzzzz9Kq#t')));
    check('擋：兩次輸入不同', /兩次輸入的新密碼不一樣/.test(await tryIt(PW.M_DEF, NEW, NEW + 'x')));
    check('擋：和目前的密碼相同', /不能和目前的密碼相同/.test(await tryIt(PW.M_DEF, PW.M_DEF)));
    const before = gh.calls.filter(c => c.m !== 'GET').length;
    check('擋：目前的密碼不正確', /目前的密碼不正確/.test(await tryIt('WrongPass#123', NEW)));
    check('以上都沒有送出任何寫入', gh.calls.filter(c => c.m !== 'GET').length === before && gh.list(L.PRIV, 'pw1').length === 0);
    // 產生
    await pA.click('#pwc-gen');
    const gen = await pA.evaluate(() => ({ a: document.getElementById('pwc-new').value, b: document.getElementById('pwc-new2').value, type: document.getElementById('pwc-new').type }));
    check('「產生」：填入兩欄、顯示成明碼、符合規則', gen.a.length >= 10 && gen.a === gen.b && gen.type === 'text' && await pA.evaluate(p => BN.pwc.policy(p, 'M_DEF') === null, gen.a), gen);
    await pA.click('#pwc-show'); check('「隱藏」切回密碼欄位', await pA.evaluate(() => document.getElementById('pwc-new').type === 'password'));

    // ---- 2. 送出 ----
    const snap0 = gh.get(L.MAIN, 'data/accounts.json'), salt0 = rec('M_DEF').auth.salt;
    const r = await tryIt(PW.M_DEF, NEW);
    check('送出成功後對話框關閉', !(await pA.evaluate(() => document.getElementById('pwc').open)), r);
    await pA.waitForFunction(() => !document.getElementById('pwc-status').hidden);
    const bar = await pA.textContent('#pwc-status');
    check('狀態列：已送出、這台裝置現在就能用新密碼', /新密碼已於 .+ 送出/.test(bar) && /等待管理端完成更新後生效/.test(bar) && /這台裝置現在就能用新密碼登入/.test(bar) && /取消申請/.test(bar), bar);
    await shot(pA, '03-pending');
    const files = gh.list(L.PRIV, 'pw1'), fid = L.fidOf('M_DEF');
    check('私人 repo 多了一份申請（檔名由帳號算出）', files.length === 1 && files[0] === 'pw1/' + fid + '.json', files);
    const raw = gh.get(L.PRIV, files[0]), env = JSON.parse(raw);
    check('申請檔只有密文：看不到帳號、舊密碼、新密碼', env.schema === 'bnasdaq-pwreq/1' && !raw.includes('M_DEF') && !raw.includes(NEW) && !raw.includes(PW.M_DEF) && Object.keys(env).sort().join() === 'at,ct,ek,iv,schema', Object.keys(env));
    check('網站 repo 的帳號檔沒有被會員端動到', gh.get(L.MAIN, 'data/accounts.json') === snap0);
    check('會員端的寫入只用同步用的 token、只寫私人 repo', gh.calls.filter(c => c.m !== 'GET').every(c => c.auth === 'SYNC' && c.path.startsWith('/repos/' + L.PRIV + '/')), gh.calls.filter(c => c.m !== 'GET'));
    const mark = await pA.evaluate(() => JSON.parse(localStorage.getItem('bn-pwc:M_DEF')));
    check('這台裝置記下等待生效的驗證資料（只有雜湊與包裝後的金鑰，沒有密碼）', mark && mark.base === salt0 && mark.rec.auth.hash && mark.rec.wrap.ct && !JSON.stringify(mark).includes(NEW), mark && Object.keys(mark));

    // ---- 3. 生效前：這台裝置新舊密碼都能登入；別台只有舊密碼 ----
    await pA.evaluate(() => sessionStorage.removeItem('bn-session'));
    check('生效前｜送出的裝置：新密碼可登入', /member\.html/.test(await E.login(pA, 'M_DEF', NEW)));
    const s1 = await pA.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('bn-session')); return { user: s.user, role: s.role, models: s.models, ck: s.ck }; });
    check('　用新密碼登入拿到的是同一把主金鑰、同樣的身分與權限', s1.ck === L.SEC.ck && s1.user === 'M_DEF' && s1.role === 'member' && JSON.stringify(s1.models) === '["fund"]', { user: s1.user, role: s1.role, models: s1.models });
    await pA.waitForFunction(() => !document.getElementById('pwc-status').hidden); check('　重新登入後仍顯示等待生效', /等待管理端完成更新後生效/.test(await pA.textContent('#pwc-status')));
    // 用新密碼登入時再開對話框、把新密碼當成「目前的密碼」→ 要提示輸入原本那一組
    await pA.click('#pwc-open'); await pA.waitForSelector('#pwc[open]');
    check('　把還沒生效的新密碼當成目前密碼 → 提示輸入原本那一組', /還在等待生效.*原本那一組/.test(await tryIt(NEW, 'Another#Pass77')));
    await pA.click('#pwc-cancel');
    await pA.evaluate(() => sessionStorage.removeItem('bn-session'));
    check('生效前｜送出的裝置：舊密碼仍可登入', /member\.html/.test(await E.login(pA, 'M_DEF', PW.M_DEF)));
    const cB = await E.ctx(), pB = await E.page(cB, 'M_DEF devB');
    check('生效前｜另一台裝置：新密碼不能登入', /帳號或密碼錯誤/.test(await E.login(pB, 'M_DEF', NEW, true)));
    check('生效前｜另一台裝置：舊密碼可登入', /member\.html/.test(await E.login(pB, 'M_DEF', PW.M_DEF)));
    await pB.waitForFunction(() => !document.getElementById('pwc-status').hidden);
    const barB = await pB.textContent('#pwc-status');
    check('　另一台裝置也看得到「等待生效」，但不會說這台可用新密碼', /等待管理端完成更新後生效/.test(barB) && !/這台裝置現在就能用/.test(barB), barB);

    // ---- 4. 管理員登入後台 → 自動套用 ----
    const old = acc();
    const cAd = await E.ctx(), pAd = await E.page(cAd, 'ADMIN_T');
    await E.login(pAd, 'ADMIN_T', PW.ADMIN_T);
    await pAd.waitForFunction(() => /剛套用了|運作中|待套用|無法|失效|錯誤/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 30000 });
    const st = await pAd.textContent('#pwcp-status');
    check('後台狀態：剛套用了 M_DEF', /剛套用了 M_DEF 的密碼變更/.test(st), st);
    const now = acc(), a1 = now.accounts.find(a => a.user === 'M_DEF'), a0 = old.accounts.find(a => a.user === 'M_DEF');
    check('帳號檔：M_DEF 的驗證資料換成申請裡的那一份', a1.auth.salt === mark.rec.auth.salt && a1.auth.hash === mark.rec.auth.hash && a1.wrap.ct === mark.rec.wrap.ct && a1.auth.salt !== a0.auth.salt);
    check('帳號檔：M_DEF 其餘欄位不變', ['user', 'role', 'created', 'active', 'note'].every(k => a1[k] === a0[k]) && JSON.stringify(Object.keys(a1)) === JSON.stringify(Object.keys(a0)), [Object.keys(a0), Object.keys(a1)]);
    check('帳號檔：其他帳號逐字相同', JSON.stringify(now.accounts.filter(a => a.user !== 'M_DEF')) === JSON.stringify(old.accounts.filter(a => a.user !== 'M_DEF')));
    check('帳號檔：頂層結構與查看密碼金鑰不變、更新時間往後', JSON.stringify(Object.keys(now)) === JSON.stringify(Object.keys(old)) && JSON.stringify(now.view) === JSON.stringify(old.view) && now.updated > old.updated, Object.keys(now));
    check('獨立驗算（Node）：新密碼登得進、舊密碼登不進', L.canLogin(a1, NEW) && !L.canLogin(a1, PW.M_DEF));
    check('提交訊息', gh.repos[L.MAIN.toLowerCase()].files['data/accounts.json'].message === 'member: change password M_DEF', gh.repos[L.MAIN.toLowerCase()].files['data/accounts.json'].message);
    check('申請已從私人 repo 刪除', gh.list(L.PRIV, 'pw1').length === 0);
    check('後台紀錄表有一筆「已套用」', /M_DEF/.test(await pAd.textContent('#pwcp-log')) && /已套用/.test(await pAd.textContent('#pwcp-log')));
    // 管理員查看密碼：顯示的是新密碼
    const row = pAd.locator('#acct-body tr', { hasText: 'M_DEF' });
    await row.locator('button[data-act="show"]').click(); await pAd.waitForFunction(() => { const el = document.querySelector('#acct-table .pw[data-u="M_DEF"]'); return el && !/•/.test(el.textContent); });
    check('後台帳號清單「顯示」→ 是會員自己設的新密碼', (await pAd.textContent('#acct-table .pw[data-u="M_DEF"]')) === NEW);
    await pAd.evaluate(() => document.getElementById('pwcp').scrollIntoView()); await shot(pAd, '04-admin-panel');

    // ---- 5. 生效後 ----
    const cC = await E.ctx(), pC = await E.page(cC, 'M_DEF devC');
    check('生效後｜全新裝置：舊密碼不能登入', /帳號或密碼錯誤/.test(await E.login(pC, 'M_DEF', PW.M_DEF, true)));
    check('生效後｜全新裝置：新密碼可登入', /member\.html/.test(await E.login(pC, 'M_DEF', NEW)));
    check('　全新裝置沒有多餘的狀態列', await pC.evaluate(async () => { await new Promise(r => setTimeout(r, 2500)); return document.getElementById('pwc-status').hidden; }));
    // 送出的裝置（目前用舊密碼登入中，session 還在）：重新整理 → 不被登出、顯示「已生效」
    await pA.reload(); await pA.waitForFunction(() => !document.getElementById('pwc-status').hidden);
    check('生效後｜送出的裝置：原本的登入不受影響，顯示「已生效」', /密碼變更已生效/.test(await pA.textContent('#pwc-status')) && /member\.html/.test(pA.url()), await pA.textContent('#pwc-status'));
    await shot(pA, '05-applied');
    check('　等待生效的資料已清掉', await pA.evaluate(() => localStorage.getItem('bn-pwc:M_DEF') === null));
    await pA.click('#pwc-status button'); check('　「知道了」收起通知', await pA.evaluate(() => document.getElementById('pwc-status').hidden));
    await pA.evaluate(() => sessionStorage.removeItem('bn-session'));
    check('生效後｜送出的裝置：舊密碼不能登入', /帳號或密碼錯誤/.test(await E.login(pA, 'M_DEF', PW.M_DEF, true)));
    check('生效後｜送出的裝置：新密碼可登入', /member\.html/.test(await E.login(pA, 'M_DEF', NEW)));

    // ---- 6. 模型權限保留（M_TWO：fund＋sat2）----
    const cT = await E.ctx(), pT = await E.page(cT, 'M_TWO');
    await E.login(pT, 'M_TWO', PW.M_TWO); await pT.click('#pwc-open'); await pT.waitForSelector('#pwc[open]');
    await pT.fill('#pwc-cur', PW.M_TWO); await pT.fill('#pwc-new', 'Violet-Canyon88'); await pT.fill('#pwc-new2', 'Violet-Canyon88'); await pT.click('#pwc-go');
    await pT.waitForFunction(() => !document.getElementById('pwc').open, null, { timeout: 30000 });
    await pAd.click('#pwcp-run'); await pAd.waitForFunction(() => /剛套用了 M_TWO/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 30000 });
    const t1 = rec('M_TWO');
    check('M_TWO 套用後模型權限仍是 fund＋sat2', JSON.stringify(t1.models) === '["fund","sat2"]' && L.canLogin(t1, 'Violet-Canyon88'), t1.models);
    const cT2 = await E.ctx(), pT2 = await E.page(cT2, 'M_TWO new');
    await E.login(pT2, 'M_TWO', 'Violet-Canyon88');
    check('M_TWO 用新密碼登入：session 的模型權限正確', await pT2.evaluate(() => JSON.stringify(JSON.parse(sessionStorage.getItem('bn-session')).models)) === '["fund","sat2"]');

    // ---- 7. 取消申請 ----
    const cL = await E.ctx(), pL = await E.page(cL, 'M_ALL');
    await E.login(pL, 'M_ALL', PW.M_ALL); await pL.click('#pwc-open'); await pL.waitForSelector('#pwc[open]');
    await pL.fill('#pwc-cur', PW.M_ALL); await pL.fill('#pwc-new', 'Harbor+Maple315'); await pL.fill('#pwc-new2', 'Harbor+Maple315'); await pL.click('#pwc-go');
    await pL.waitForFunction(() => !document.getElementById('pwc').open, null, { timeout: 30000 }); await pL.waitForFunction(() => /取消申請/.test(document.getElementById('pwc-status').textContent));
    check('取消前：私人 repo 有 M_ALL 的申請', gh.list(L.PRIV, 'pw1').includes('pw1/' + L.fidOf('M_ALL') + '.json'));
    await pL.click('#pwc-status button'); await pL.waitForFunction(() => /已取消/.test(document.getElementById('pwc-status').textContent));
    check('取消後：申請刪除、這台的等待資料清掉', gh.list(L.PRIV, 'pw1').length === 0 && await pL.evaluate(() => localStorage.getItem('bn-pwc:M_ALL') === null));
    await pL.evaluate(() => sessionStorage.removeItem('bn-session'));
    check('取消後：那組新密碼不能登入、原本的密碼可以', /帳號或密碼錯誤/.test(await E.login(pL, 'M_ALL', 'Harbor+Maple315', true)) && /member\.html/.test(await E.login(pL, 'M_ALL', PW.M_ALL)));

    // ---- 8. 重送取代上一份；帳號名稱大小寫混用 ----
    const cX = await E.ctx(), pX = await E.page(cX, 'Mixed');
    await E.login(pX, 'mixed.case-1', PW['Mixed.Case-1']);   // 登入時大小寫不拘
    for (const p of ['First#Choice123', 'Second#Choice456']) { await pX.click('#pwc-open'); await pX.waitForSelector('#pwc[open]'); await pX.fill('#pwc-cur', PW['Mixed.Case-1']); await pX.fill('#pwc-new', p); await pX.fill('#pwc-new2', p); await pX.click('#pwc-go'); await pX.waitForFunction(() => !document.getElementById('pwc').open, null, { timeout: 30000 }); }
    check('同一帳號送兩次：私人 repo 只留一份（後送的取代前一份）', gh.list(L.PRIV, 'pw1').length === 1 && gh.list(L.PRIV, 'pw1')[0] === 'pw1/' + L.fidOf('Mixed.Case-1') + '.json', gh.list(L.PRIV, 'pw1'));
    await pAd.click('#pwcp-run'); await pAd.waitForFunction(() => /剛套用了 Mixed\.Case-1/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 30000 });
    check('套用的是第二次送的密碼', L.canLogin(rec('Mixed.Case-1'), 'Second#Choice456') && !L.canLogin(rec('Mixed.Case-1'), 'First#Choice123'));
    check('沒有待套用時再按「立即檢查」→ 運作中、沒有多餘寫入', await (async () => { const n = gh.calls.filter(c => c.m !== 'GET').length; await pAd.click('#pwcp-run'); await pAd.waitForFunction(() => /目前沒有待套用/.test(document.getElementById('pwcp-status').textContent)); return gh.calls.filter(c => c.m !== 'GET').length === n; })());
    check('全程沒有網頁錯誤', E.errors.length === 0, E.errors.slice(0, 6));
  } catch (e) { check('測試腳本執行完成', false, String(e && e.stack || e).slice(0, 600)); }
  await E.close(); srv.close(); process.exit(L.summary() ? 1 : 0);
})();
