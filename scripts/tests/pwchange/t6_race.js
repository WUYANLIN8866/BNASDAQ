// 管理後台：自動套用正在驗證（一兩秒）的同時，管理員刪掉清單裡前面的帳號 → 兩件事最後都要正確，其他帳號不能被動到
const L = require('./lib'); const { check } = L;
(async () => {
  const srv = await L.serve(L.SITE, L.PORT), E = await L.boot(), gh = E.gh, PW = L.SEC.pw;
  const acc = () => gh.json(L.MAIN, 'data/accounts.json'), rec = u => acc().accounts.find(a => a.user === u);
  const put = (user, text) => gh.put(L.PRIV, 'pw1/' + L.fidOf(user) + '.json', text, 'pwreq');
  try {
    const c = await E.ctx(), p = await E.page(c, 'ADMIN_T');
    await E.login(p, 'ADMIN_T', PW.ADMIN_T); await p.waitForFunction(() => /目前沒有待套用/.test(document.getElementById('pwcp-status').textContent), null, { timeout: 40000 });
    for (let round = 0; round < 3; round++) {
      const victim = ['M_DEF', 'M_ALL', 'M_OFF'][round], target = ['Mixed.Case-1', 'Mixed.Case-1', 'M_TWO'][round], np = 'RaceRound#' + round + 'xYz';
      const before = acc(), curPw = before._pw && before._pw[target] || (round === 1 ? 'RaceRound#0xYz' : PW[target]);
      put(target, L.makeReq(before, target, curPw, np));
      const delay = [0, 400, 900][round];
      await p.click('#pwcp-run'); await p.waitForTimeout(delay);
      await p.locator('#acct-body tr', { hasText: victim }).locator('button[data-act="del"]').click();   // confirm 由測試自動按確定
      const t0 = Date.now(); let ok = false;
      while (Date.now() - t0 < 60000) { const d = acc(); if (!d.accounts.some(a => a.user === victim) && L.canLogin(d.accounts.find(a => a.user === target), np) && gh.list(L.PRIV, 'pw1').length === 0) { ok = true; break; } await p.waitForTimeout(700);
        // 刪除被擋下（撞版）時，畫面重新載入後再按一次
        if (acc().accounts.some(a => a.user === victim) && /帳號資料剛被其他地方更新過/.test(await p.textContent('#acct-msg')) && /./.test(await p.textContent('#acct-body'))) { const b = p.locator('#acct-body tr', { hasText: victim }).locator('button[data-act="del"]'); if (await b.count()) { await p.waitForTimeout(1500); await b.click().catch(() => { }); } } }
      const now = acc(), keep = now.accounts.filter(a => a.user !== target).map(a => JSON.stringify(a)), want = before.accounts.filter(a => a.user !== target && a.user !== victim).map(a => JSON.stringify(a));
      check('第 ' + (round + 1) + ' 輪（延遲 ' + delay + 'ms）：刪除 ' + victim + ' 與套用 ' + target + ' 都完成', ok, { users: now.accounts.map(a => a.user), files: gh.list(L.PRIV, 'pw1'), msg: (await p.textContent('#acct-msg')).slice(0, 80), st: (await p.textContent('#pwcp-status')).slice(0, 80) });
      check('　其他帳號逐字不變、沒有重複或錯位', JSON.stringify(keep) === JSON.stringify(want) && new Set(now.accounts.map(a => a.user)).size === now.accounts.length, now.accounts.map(a => a.user));
      const t = now.accounts.find(a => a.user === target), t0r = before.accounts.find(a => a.user === target);
      check('　' + target + ' 只換了驗證資料', t && ['user', 'role', 'created', 'active', 'note'].every(k => t[k] === t0r[k]) && JSON.stringify(t.models) === JSON.stringify(t0r.models));
      await p.waitForTimeout(1500);
    }
    check('全程沒有網頁錯誤', E.errors.length === 0, E.errors.slice(0, 6));
  } catch (e) { check('測試腳本執行完成', false, String(e && e.stack || e).slice(0, 900)); }
  await E.close(); srv.close(); process.exit(L.summary() ? 1 : 0);
})();
