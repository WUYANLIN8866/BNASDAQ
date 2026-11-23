/* BNASDAQ｜更改密碼（2026-11-23 站主：在會員「登出」的旁邊新增「更改密碼」）
   本站沒有伺服器：帳號檔 data/accounts.json 只有管理員的寫入權杖（PAT）寫得進去，會員的瀏覽器寫不了。所以分兩條路——
   管理員：在自己的瀏覽器直接改（步驟和管理後台「更改管理員密碼」相同），立即生效。
   會員：瀏覽器先驗證目前的密碼，在本機用新密碼算好新的驗證資料，連同「知道目前密碼」的證明加密成一份申請，放到同步用的私人 repo（pw1/<檔名>.json；
     和會員資產跨裝置同步共用 data/sync-key.json 那把 token，會員手上沒有任何寫得進網站 repo 的東西）。
     管理員下次以管理員身分開啟管理後台、會員專區或每日市場分析時，由管理員的瀏覽器自動驗證並寫進帳號檔（applyPending），之後所有裝置都用新密碼。
     送出的那台裝置另外把新的驗證資料記在 localStorage 'bn-pwc:' + 帳號，生效前在那台裝置就能用新密碼登入（assets/auth.js 的 pendingCred）。
   申請的加密：內容用隨機 AES-256-GCM 金鑰加密，該金鑰再用「管理員查看密碼」的 RSA 公鑰（accounts.json 的 view.pub）包起來——只有管理員的個人金鑰解得開。
     其他會員雖然讀得到那個私人 repo，但看不到內容，也偽造不了（偽造必須拿得出那個帳號目前密碼導出的金鑰）；最多只能刪掉別人的申請（對方會看到「沒有生效」，重送即可）。
   申請內容：{ v: 1, user, proof, salt, rec: { auth, wrap, pv }, at }
     proof＝用目前密碼導出的包裝金鑰：管理員端用它解開帳號檔裡這個帳號的主金鑰包裝，解得開而且是同一把主金鑰＝對方知道目前的密碼
     salt ＝送出當時帳號檔的 auth.salt：帳號檔一變（已套用、或管理員另外重設）舊申請就對不上，不能重放
     rec  ＝新的驗證資料（密碼雜湊、用新密碼包裝的主金鑰、給管理員查看的密碼副本 pv——沿用站上既有設計）
   管理員端套用前逐項檢查（review）：帳號存在、啟用中、不是管理員；沒過期；salt 相符；proof 成立；格式正確；
     用 pv 解出新密碼後重算一次——雜湊相符、包裝的是同一把主金鑰、符合密碼規則、和目前的密碼不同。全部通過才換掉該帳號的 auth／wrap／pv，其餘欄位（身分、模型權限、備註…）不動。
   帳號檔的寫入一律帶版本（BN.auth.ghPutAt）：和管理後台的其他修改撞在一起時，後寫的一方會被 GitHub 拒絕、重新讀取再來，不會互相覆蓋。 */
(function () {
  'use strict';
  if (!window.BN || !BN.auth) return;
  const A = BN.auth, enc = new TextEncoder(), dec = new TextDecoder(), P = {};
  const MIN = 10, MAX = 128, DIR = 'pw1', TTL = 30 * 864e5, KEY = u => 'bn-pwc:' + u, LOGKEY = 'bn-pwc-log';
  const E_CONTACT = '目前無法在線上更改密碼，請聯絡管理員協助更改。', E_NET = '暫時連不上，請稍後再試。';
  const hex = u8 => Array.from(u8, x => x.toString(16).padStart(2, '0')).join('');
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const nf = s => String(s == null ? '' : s).normalize('NFKC');
  const LS = {
    get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: k => { try { localStorage.removeItem(k); } catch (e) { /* 略過 */ } }
  };
  const isB64 = (s, n) => { if (typeof s !== 'string' || !s || s.length % 4 || s.length > 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false; if (n == null) return true; try { return A.b64.dec(s).length === n; } catch (e) { return false; } };

  // ---------- 密碼規則（會員端先檢查；管理員端套用前用解出的新密碼再檢查一次）----------
  // 帳號檔是公開檔案（只有雜湊），太短或太好猜的密碼可以被離線猜出來，所以會員自己設的密碼要有基本強度
  const WEAK = ['password', 'passw0rd', 'qwerty', 'asdfgh', 'zxcvbn', '123456', '654321', '111111', '000000', 'abcdef', 'abc123', 'iloveyou', 'letmein', 'welcome', 'admin'];
  P.MIN = MIN;
  P.policy = function (pw, user) {
    const s = nf(pw);
    if (s.length < MIN) return '新密碼至少要 ' + MIN + ' 碼。';
    if (s.length > MAX || enc.encode(String(pw)).length > 300) return '新密碼太長（最長 ' + MAX + ' 碼；中文等文字每個字算 3 碼左右）。';
    if (s !== s.trim()) return '新密碼的開頭和結尾不能是空白。';
    if ([/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(s)).length < 2) return '新密碼要包含大寫英文、小寫英文、數字、符號其中至少兩種。';
    const low = s.toLowerCase(), u = String(user || '').toLowerCase();
    if (u.length >= 3 && low.indexOf(u) >= 0) return '新密碼不能包含帳號名稱。';
    if (low.indexOf('nasdaq') >= 0) return '新密碼不能包含本站名稱（NASDAQ）。';   // 針對本站猜密碼時最先試的字
    if (WEAK.some(w => low.indexOf(w) >= 0) || /(.)\1{4,}/.test(s)) return '新密碼太容易被猜到（含常見字串或連續重複的字），請換一組，或按「產生」。';
    return null;
  };
  P.gen = function (user) { for (let i = 0; i < 50; i++) { const p = A.genPassword(); if (!P.policy(p, user)) return p; } return A.genPassword() + '7k'; };

  // ---------- 同步用的私人 repo（申請放在 pw1/；設定與 token 和會員資產跨裝置同步共用）----------
  const tfetch = (url, opt, ms) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 12000); return fetch(url, Object.assign({}, opt, { signal: c.signal })).finally(() => clearTimeout(t)); };
  let CFGP = null;
  // 回傳 { api, token }｜{ off: true }（站方沒啟用同步，或設定解不開）｜{ offline: true }（暫時連不上，下次再試）
  function syncCfg(sess) {
    if (CFGP) return CFGP;
    const p = (async () => {
      let r; try { r = await tfetch('data/sync-key.json?t=' + Date.now(), { cache: 'no-store' }, 8000); } catch (e) { return { offline: true }; }
      try {
        const j = r.ok ? await r.json() : null;
        if (j && j.iv && j.ct) { const o = JSON.parse(dec.decode(await A.aesDec(A.b64.dec(sess.ck), j.iv, j.ct))); if (o && /^[\w.-]+\/[\w.-]+$/.test(o.repo || '') && o.token) return { api: 'https://api.github.com/repos/' + o.repo, token: o.token }; }
      } catch (e) { /* 解不開＝當作沒啟用 */ }
      return { off: true };
    })();
    CFGP = p; p.then(c => { if (c.offline) CFGP = null; });
    return p;
  }
  const head = (cfg, more) => Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + cfg.token }, more);
  const stOf = r => r.status === 401 ? 'auth' : (r.status === 403 || r.status === 429) ? ((r.headers.get('x-ratelimit-remaining') === '0' || r.headers.get('retry-after')) ? 'busy' : 'auth') : 'error';
  const url = (cfg, fid) => cfg.api + '/contents/' + DIR + (fid ? '/' + fid + '.json' : '');
  async function rGet(cfg, fid) {
    let r; try { r = await tfetch(url(cfg, fid) + '?t=' + Date.now(), { headers: head(cfg), cache: 'no-store' }); } catch (e) { return { st: 'offline' }; }
    if (r.status === 404) return { st: 'none' };
    if (!r.ok) return { st: stOf(r) };
    try { const j = await r.json(); return { st: 'ok', sha: j.sha, text: atob(String(j.content || '').replace(/\s/g, '')) }; } catch (e) { return { st: 'error' }; }
  }
  async function rPut(cfg, fid, text, sha) {
    const body = { message: 'pwreq', content: btoa(text) }; if (sha) body.sha = sha;
    let r; try { r = await tfetch(url(cfg, fid), { method: 'PUT', headers: head(cfg, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) }, 15000); } catch (e) { return { st: 'offline' }; }
    if (r.status === 200 || r.status === 201) return { st: 'ok' };
    if (r.status === 409 || r.status === 422) return { st: 'conflict' };
    return { st: r.status === 404 ? 'auth' : stOf(r) };
  }
  async function rDel(cfg, fid, sha) {
    let r; try { r = await tfetch(url(cfg, fid), { method: 'DELETE', headers: head(cfg, { 'Content-Type': 'application/json' }), body: JSON.stringify({ message: 'pwreq done', sha }) }, 15000); } catch (e) { return { st: 'offline' }; }
    return { st: r.ok ? 'ok' : (r.status === 404 || r.status === 409 || r.status === 422) ? 'gone' : stOf(r) };
  }
  async function rList(cfg) {
    let r; try { r = await tfetch(url(cfg) + '?t=' + Date.now(), { headers: head(cfg), cache: 'no-store' }); } catch (e) { return { st: 'offline' }; }
    if (r.status === 404) return { st: 'ok', items: [] };   // 還沒有人送過申請
    if (!r.ok) return { st: stOf(r) };
    try { const a = await r.json(); return { st: 'ok', items: (Array.isArray(a) ? a : []).filter(x => x && x.type === 'file' && /^[0-9a-f]{40}\.json$/.test(x.name)) }; } catch (e) { return { st: 'error' }; }
  }
  const netMsg = st => st === 'auth' ? E_CONTACT : E_NET;
  // 每個帳號一個檔名（由帳號名稱算出）：同一個帳號再送一次會取代上一份
  P.fid = async user => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('bnasdaq-pwreq-file-v1|' + String(user).toLowerCase())))).slice(0, 40);

  // ---------- 申請的加密與解密 ----------
  async function seal(view, obj) {
    const k = A.rnd(32), e = await A.aesEnc(k, enc.encode(JSON.stringify(obj)));
    return { schema: 'bnasdaq-pwreq/1', at: obj.at, ek: await A.sealPw(view, A.b64.enc(k)), iv: e.iv, ct: e.ct };
  }
  async function open(view, sess, env) {
    const k = A.b64.dec(await A.openPw(view, sess, env.ek));
    return JSON.parse(dec.decode(await A.aesDec(k, env.iv, env.ct)));
  }

  // ---------- 共用步驟 ----------
  // 驗證目前的密碼（和帳號檔的雜湊比對）；通過後回傳用它導出的包裝金鑰
  async function checkCur(a, cur) {
    const h = A.b64.enc(await A.pbkdf2(cur, A.b64.dec(a.auth.salt), a.auth.iter || A.ITER, 256));
    if (h !== a.auth.hash) {
      // 這台裝置剛送出的新密碼還沒生效，而使用者輸入的是那一組新的 → 說清楚要輸入哪一組
      const m = LS.get(KEY(a.user)), pa = m && m.base === a.auth.salt && m.rec && m.rec.auth;
      if (pa && typeof pa.salt === 'string' && A.b64.enc(await A.pbkdf2(cur, A.b64.dec(pa.salt), A.ITER, 256)) === pa.hash) throw new Error('你上次送出的新密碼還在等待生效；要再改一次，「目前的密碼」請輸入原本那一組。');
      throw new Error('目前的密碼不正確。');
    }
    return A.pbkdf2(cur, A.b64.dec(a.wrap.salt), a.wrap.iter || A.ITER, 256);
  }
  // 用新密碼算出新的驗證資料，並自我檢查（雜湊算得回來、包裝的主金鑰解得回來）才回傳
  async function newCred(user, pw, role, ck, note) {
    const r = await A.makeRecord(user, pw, role, ck, note);
    const h = A.b64.enc(await A.pbkdf2(pw, A.b64.dec(r.auth.salt), A.ITER, 256));
    const back = await A.aesDec(await A.pbkdf2(pw, A.b64.dec(r.wrap.salt), A.ITER, 256), r.wrap.iv, r.wrap.ct);
    if (h !== r.auth.hash || !eq(back, ck)) throw new Error('自我檢查沒有通過，沒有送出；請再試一次。');
    return { auth: r.auth, wrap: r.wrap };
  }
  function precheck(cur, next, user) {
    if (!cur) return '請輸入目前的密碼。';
    return P.policy(next, user) || (nf(next) === nf(cur) ? '新密碼不能和目前的密碼相同。' : null);
  }

  // ---------- 會員：送出申請 ----------
  P.submit = async function (sess, cur, next) {
    const bad = precheck(cur, next, sess.user); if (bad) throw new Error(bad);
    const cfg = await syncCfg(sess); if (!cfg.token) throw new Error(cfg.offline ? E_NET : E_CONTACT);
    let db; try { db = await A.fetchAccounts(); } catch (e) { throw new Error(E_NET); }
    const a = (db.accounts || []).find(x => x.user === sess.user);
    if (!a || a.active === false) throw new Error('找不到這個帳號，請重新登入後再試。');
    if (a.role === 'admin') throw new Error('管理員帳號請重新登入後再更改。');   // 畫面依身分分流，正常不會走到
    if (!db.view || !db.view.pub) throw new Error(E_CONTACT);
    const wkOld = await checkCur(a, cur), ck = A.b64.dec(sess.ck);
    let same = false; try { same = eq(await A.aesDec(wkOld, a.wrap.iv, a.wrap.ct), ck); } catch (e) { same = false; }
    if (!same) throw new Error('這次登入的資料已經過期，請登出後重新登入再更改密碼。');
    const n = await newCred(a.user, next, a.role, ck, a.note), at = new Date().toISOString();
    const env = await seal(db.view, { v: 1, user: a.user, proof: A.b64.enc(wkOld), salt: a.auth.salt, rec: { auth: n.auth, wrap: n.wrap, pv: await A.sealPw(db.view, next) }, at });
    const fid = await P.fid(a.user), text = JSON.stringify(env);
    for (let i = 0; ; i++) {   // 已經有一份（上次送的還沒生效）就取代它
      const g = await rGet(cfg, fid); if (g.st !== 'ok' && g.st !== 'none') throw new Error(netMsg(g.st));
      const p = await rPut(cfg, fid, text, g.st === 'ok' ? g.sha : null);
      if (p.st === 'ok') break;
      if (p.st !== 'conflict' || i >= 2) throw new Error(netMsg(p.st));
    }
    return { at, here: LS.set(KEY(a.user), { base: a.auth.salt, at, rec: { auth: n.auth, wrap: n.wrap } }) };
  };
  // 這個帳號的申請狀態：none｜pending（等待生效）｜applied（這台送出的新密碼已生效）｜replaced（送出後帳號密碼被管理員另外改了）｜gone（申請不見了也沒生效）
  P.status = async function (sess) {
    const m = LS.get(KEY(sess.user)), mark = !!(m && m.base);
    let fresh = false;   // 帳號檔是不是直接讀 GitHub 那一份（網站那一份在部署完成前可能還是舊的，不能據以判斷「沒生效」）
    if (mark) {
      let a = null; try { const db = await A.fetchAccounts(); fresh = !!db._sha; a = (db.accounts || []).find(x => x.user === sess.user); } catch (e) { /* 連不上：先當作還在等 */ }
      if (a && a.auth.salt !== m.base) { LS.del(KEY(sess.user)); return { state: m.rec && m.rec.auth && a.auth.salt === m.rec.auth.salt ? 'applied' : 'replaced', at: m.at }; }
    }
    const here = !!(mark && m.rec), wait = mark ? { state: 'pending', at: m.at, here } : { state: 'none' };
    const cfg = await syncCfg(sess); if (!cfg.token) return wait;
    const g = await rGet(cfg, await P.fid(sess.user));
    if (g.st === 'ok') { let at = mark ? m.at : ''; try { at = JSON.parse(g.text).at || at; } catch (e) { /* 略過 */ } return { state: 'pending', at, here }; }
    if (g.st === 'none' && mark && fresh) { LS.del(KEY(sess.user)); return { state: 'gone', at: m.at }; }
    return wait;
  };
  P.cancel = async function (sess) {
    const cfg = await syncCfg(sess); if (!cfg.token) throw new Error(cfg.offline ? E_NET : E_CONTACT);
    const fid = await P.fid(sess.user), g = await rGet(cfg, fid);
    if (g.st === 'ok') { const d = await rDel(cfg, fid, g.sha); if (d.st !== 'ok' && d.st !== 'gone') throw new Error(netMsg(d.st)); }
    else if (g.st !== 'none') throw new Error(netMsg(g.st));
    LS.del(KEY(sess.user));
  };

  // ---------- 帳號檔的讀寫（帶版本）----------
  async function readDB(pat) {
    const j = await A.ghGet(pat, 'data/accounts.json'); if (!j || !j.sha || !j.content) throw new Error('讀不到帳號資料，請稍後再試。');
    return { sha: j.sha, db: JSON.parse(dec.decode(A.b64.dec(String(j.content).replace(/\s/g, '')))) };
  }
  const text = db => JSON.stringify(db, null, 1);   // 和管理後台存檔的格式一致

  // ---------- 管理員：直接更改自己的密碼（立即生效）----------
  // 步驟同管理後台「更改管理員密碼」：重建驗證資料、查看密碼用的私鑰與寫入權杖改用新的個人金鑰重新加密。寫入前把每一樣都解回來核對一次，任何一項不對就不寫。
  P.changeAdmin = async function (sess, cur, next) {
    const bad = precheck(cur, next, sess.user); if (bad) throw new Error(bad);
    const pat = await A.loadPAT(sess); if (!pat) throw new Error('還沒設定網站寫入權限：請先到管理後台的「網站寫入權限」貼上權杖。');
    if (!sess.uk) throw new Error('這次登入的資料是舊版的，請登出後重新登入再更改密碼。');
    const ck = A.b64.dec(sess.ck);
    for (let i = 0; ; i++) {
      const got = await readDB(pat), db = got.db, k = (db.accounts || []).findIndex(x => x.user === sess.user), a = db.accounts && db.accounts[k];
      if (!a || a.role !== 'admin') throw new Error('找不到這個管理員帳號，請重新登入後再試。');
      await checkCur(a, cur);
      const n = await newCred(a.user, next, a.role, ck, a.note), neu = Object.assign({}, a, { auth: n.auth, wrap: n.wrap }), uk = await A.ukFrom(next, neu.wrap);
      delete neu.pv; if (db.view) neu.pv = await A.sealPw(db.view, next);
      const mine = !!(db.view && db.view.owner === sess.user);
      if (mine) db.view = await A.rewrapView(db.view, sess, next, neu);
      if (!db.adminPat || db.adminPat.owner === sess.user) db.adminPat = await A.patBox(uk, pat, sess.user);
      // 寫入前核對：新的個人金鑰解得開查看密碼的私鑰（而且解得出剛存的密碼副本）、解得回寫入權杖
      let ok = true;
      try {
        if (mine) { const key = await crypto.subtle.importKey('pkcs8', await A.aesDec(uk, db.view.priv.iv, db.view.priv.ct), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
          ok = dec.decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, A.b64.dec(neu.pv))) === next; }
        if (ok && db.adminPat.owner === sess.user) ok = dec.decode(await A.aesDec(uk, db.adminPat.iv, db.adminPat.ct)) === pat;
      } catch (e) { ok = false; }
      if (!ok) throw new Error('寫入前的核對沒有通過，沒有更改任何資料；請再試一次。');
      db.accounts[k] = neu; db.updated = new Date().toISOString();
      const r = await A.ghPutAt(pat, 'data/accounts.json', text(db), 'admin: change admin password', got.sha);
      if (!r.conflict) return true;
      if (i >= 2) throw new Error('帳號資料正被其他地方更新，這次沒有改成；請稍後再試。');
    }
  };

  // ---------- 管理員：驗證並套用會員送出的申請 ----------
  const no = (why, user) => ({ ok: false, why, user });
  // 通過 → { ok: true, old：帳號檔裡原本那筆紀錄, user, neu：換上新驗證資料後的紀錄 }；不通過 → { ok: false, why, user }
  async function review(raw, fid, db, sess) {
    let env, q;
    try { env = JSON.parse(raw); } catch (e) { return no('unreadable'); }
    if (!env || env.schema !== 'bnasdaq-pwreq/1' || !isB64(env.ek) || !isB64(env.iv, 12) || typeof env.ct !== 'string') return no('unreadable');
    try { q = await open(db.view, sess, env); } catch (e) { return no('unreadable'); }
    if (!q || q.v !== 1 || typeof q.user !== 'string' || !q.rec || typeof q.rec !== 'object') return no('badrec');
    const i = (db.accounts || []).findIndex(x => x.user.toLowerCase() === q.user.toLowerCase()), a = db.accounts[i];
    if (!a) return no('nouser', q.user.slice(0, 40));
    const user = a.user, r = q.rec, ck = A.b64.dec(sess.ck);
    if (fid !== await P.fid(user)) return no('badrec', user);
    if (a.role === 'admin') return no('admin', user);
    if (a.active === false) return no('inactive', user);
    if (q.salt !== a.auth.salt) return no(r.auth && r.auth.salt === a.auth.salt && r.auth.hash === a.auth.hash ? 'already' : 'stale', user);   // already＝這份已經套用過（另一個分頁先做了）
    if (!(Date.now() - Date.parse(q.at) < TTL)) return no('expired', user);
    // 1) 知道目前的密碼：proof 解得開帳號檔裡這個帳號的主金鑰包裝，而且解出來的是同一把主金鑰
    try { if (!isB64(q.proof, 32) || !eq(await A.aesDec(A.b64.dec(q.proof), a.wrap.iv, a.wrap.ct), ck)) return no('wrongpw', user); } catch (e) { return no('wrongpw', user); }
    // 2) 新的驗證資料格式
    if (!r.auth || !r.wrap || r.auth.iter !== A.ITER || r.wrap.iter !== A.ITER || !isB64(r.auth.salt, 16) || !isB64(r.auth.hash, 32) || !isB64(r.wrap.salt, 16) || !isB64(r.wrap.iv, 12) || !isB64(r.wrap.ct, 48) || !isB64(r.pv)) return no('badrec', user);
    // 3) 用給管理員的那份副本解出新密碼，自己重算一次
    let pw = null; try { pw = await A.openPw(db.view, sess, r.pv); } catch (e) { pw = null; }
    if (typeof pw !== 'string') return no('badrec', user);
    if (P.policy(pw, user)) return no('weak', user);
    if (A.b64.enc(await A.pbkdf2(pw, A.b64.dec(r.auth.salt), A.ITER, 256)) !== r.auth.hash) return no('badrec', user);
    try { if (!eq(await A.aesDec(await A.pbkdf2(pw, A.b64.dec(r.wrap.salt), A.ITER, 256), r.wrap.iv, r.wrap.ct), ck)) return no('badrec', user); } catch (e) { return no('badrec', user); }
    if (A.b64.enc(await A.pbkdf2(pw, A.b64.dec(a.auth.salt), a.auth.iter || A.ITER, 256)) === a.auth.hash) return no('same', user);
    return { ok: true, old: a, user, neu: Object.assign({}, a, { auth: { salt: r.auth.salt, iter: A.ITER, hash: r.auth.hash }, wrap: { salt: r.wrap.salt, iter: A.ITER, iv: r.wrap.iv, ct: r.wrap.ct }, pv: r.pv }) };
  }
  P.RES = { applied: '已套用（新密碼生效）', wrongpw: '未套用：對方沒有通過「目前密碼」的驗證', stale: '未套用：送出之後這個帳號的密碼已經被改過', weak: '未套用：新密碼不符合密碼規則', badrec: '未套用：申請內容不完整或前後不一致',
    admin: '未套用：管理員帳號不走申請', inactive: '未套用：帳號已停用', nouser: '未套用：找不到這個帳號', unreadable: '未套用：無法解讀（不是用目前的密碼查看金鑰加密的）', expired: '未套用：送出超過 30 天', same: '未套用：新密碼和目前的密碼相同' };
  const logGet = () => { const a = LS.get(LOGKEY); return Array.isArray(a) ? a : []; };
  function logAdd(list) { if (!list.length) return; const at = new Date().toISOString(); LS.set(LOGKEY, list.map(o => ({ at, user: o.user || '', res: o.res })).concat(logGet()).slice(0, 30)); }
  P.log = logGet;
  // 直接讀寫 GitHub 上那一份（會員專區、每日市場分析用）；管理後台改用頁面上那一份資料與它自己的存檔函式（opt.store）
  function gitStore(pat) {
    let sha = null;
    return { again: true,
      load: async () => { const r = await readDB(pat); sha = r.sha; return r.db; },
      save: async (db, message) => { db.updated = new Date().toISOString(); const r = await A.ghPutAt(pat, 'data/accounts.json', text(db), message, sha); if (r.conflict) return 'conflict'; sha = r.sha; return 'ok'; } };
  }
  let busy = false;
  // 回傳 { state }：skip｜off｜offline｜auth｜busy｜error｜idle（沒有申請）｜nopat｜noview（有申請但這個管理員套用不了；pending＝筆數）｜conflict｜savefail｜done（results＝每一筆的結果）
  P.applyPending = async function (sess, opt) {
    opt = opt || {};
    if (!sess || sess.role !== 'admin' || busy) return { state: 'skip' };
    busy = true;
    try {
      const cfg = await syncCfg(sess); if (!cfg.token) return { state: cfg.offline ? 'offline' : 'off' };
      const L = await rList(cfg); if (L.st !== 'ok') return { state: L.st };
      const files = L.items.slice(0, 20), pending = files.length; if (!pending) return { state: 'idle' };
      const pat = opt.pat ? opt.pat() : await A.loadPAT(sess); if (!pat) return { state: 'nopat', pending };
      const store = opt.store || gitStore(pat);
      for (let turn = 0; turn < 3; turn++) {
        const db = await store.load();
        if (!db || !db.view || db.view.owner !== sess.user || !sess.uk) return { state: 'noview', pending };
        // 這次登入的個人金鑰要真的解得開「查看密碼」的私鑰才往下做。管理員密碼在別處改過之後，還開著的舊登入解不開：
        //   這時什麼都不動——不然每一份申請都會被當成「無法解讀」而刪掉
        try { await A.aesDec(A.b64.dec(sess.uk), db.view.priv.iv, db.view.priv.ct); } catch (e) { return { state: 'noview', pending }; }
        const out = [], staged = [];
        for (const f of files) {
          const fid = f.name.slice(0, 40);
          if (f.size > 16384) { out.push({ fid, sha: f.sha, res: 'unreadable' }); continue; }
          const g = await rGet(cfg, fid);
          if (g.st === 'none') continue;                                   // 剛被對方取消，或另一個分頁已經處理掉
          if (g.st !== 'ok') { out.push({ fid, res: 'later' }); continue; }  // 暫時讀不到：留著下次再試
          const v = await review(g.text, fid, db, sess);
          if (v.ok) {
            // 驗證要一兩秒；管理後台用的是畫面上那份資料，這段時間清單可能被動過（例如剛刪了別的帳號）→ 用「同一筆紀錄」找位置，找不到就留到下次
            const k = db.accounts.indexOf(v.old);
            if (k < 0) { out.push({ fid, res: 'later' }); continue; }
            staged.push({ fid, sha: g.sha, user: v.user, old: v.old, neu: v.neu }); db.accounts[k] = v.neu;
          } else out.push({ fid, sha: g.sha, res: v.why, user: v.user });
        }
        if (staged.length) {
          const s = await store.save(db, 'member: change password ' + staged.map(x => x.user).join(', '));
          if (s !== 'ok') {
            staged.forEach(x => { const k = db.accounts.indexOf(x.neu); if (k >= 0) db.accounts[k] = x.old; });   // 沒存成功：把畫面上那份資料還原
            if (s === 'conflict' && store.again) continue;   // 帳號檔剛被別處改過：重新讀取、重新驗證
            return { state: s === 'conflict' ? 'conflict' : 'savefail', pending };
          }
          staged.forEach(x => { out.push({ fid: x.fid, sha: x.sha, res: 'applied', user: x.user }); if (opt.onApplied) opt.onApplied(x.user); });
        }
        // 處理完的申請從私人 repo 刪掉（已套用的、確定不會成立的）；刪不掉也沒關係，下次會因為 salt 對不上而作廢
        const done = out.filter(o => o.res !== 'later');
        for (const o of done) if (o.sha) await rDel(cfg, o.fid, o.sha);
        const shown = done.filter(o => o.res !== 'already'); logAdd(shown);
        return { state: 'done', results: shown, later: out.length - done.length };
      }
      return { state: 'conflict', pending };
    } catch (e) { return { state: 'error', why: String((e && e.message) || e) }; }
    finally { busy = false; }
  };
  // 管理員開著會員專區、每日市場分析時在背景檢查（管理後台由 admin.html 自己呼叫，用頁面上那份帳號資料）
  P.auto = function () {
    const sess = A.session(); if (!sess || sess.role !== 'admin' || /(^|\/)admin\.html$/.test(location.pathname)) return;
    const run = async () => { if (document.visibilityState !== 'visible') return; const r = await P.applyPending(sess); document.dispatchEvent(new CustomEvent('bn:pwc', { detail: r })); };
    setTimeout(run, 4000); setInterval(run, 600000);
  };

  // ---------- 會員專區的畫面：「更改密碼」按鈕、對話框、狀態列 ----------
  const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); };
  P.mount = function () {
    const $ = id => document.getElementById(id), sess = A.session(), btn = $('pwc-open'), dlg = $('pwc'), f = $('pwc-form'), bar = $('pwc-status');
    if (!sess || !btn || !dlg || !f) return;
    const admin = sess.role === 'admin', cur = $('pwc-cur'), n1 = $('pwc-new'), n2 = $('pwc-new2'), go = $('pwc-go'), show = $('pwc-show');
    const el = (tag, cls, t) => { const x = document.createElement(tag); if (cls) x.className = cls; if (t != null) x.textContent = t; return x; };
    const msg = (t, cls) => { const box = $('pwc-msg'); box.textContent = ''; if (t) box.appendChild(el('p', 'msg ' + (cls || 'info'), t)); };
    let going = false, ready = true;
    const reveal = on => { n1.type = n2.type = on ? 'text' : 'password'; show.textContent = on ? '隱藏' : '顯示'; show.setAttribute('aria-pressed', String(on)); };
    const close = () => { cur.value = n1.value = n2.value = ''; reveal(false); msg(''); if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); };
    $('pwc-user').value = sess.user;
    $('pwc-intro').textContent = admin ? '管理員密碼更改後立即生效，並會自動登出；請用新密碼重新登入。'
      : '送出後，新密碼要等管理端完成更新才會在所有裝置生效；在那之前，這台裝置可以先用新密碼登入，其他裝置請繼續使用原本的密碼。生效後本頁會顯示通知。';
    $('pwc-help').textContent = '至少 ' + MIN + ' 碼，並包含大寫英文、小寫英文、數字、符號其中至少兩種。請使用本站專用的密碼，不要和其他網站共用' + (admin ? '。' : '（管理員可協助查詢與重設）。');
    btn.addEventListener('click', async () => {
      msg(''); ready = true; go.disabled = false;
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      cur.focus();
      if (!admin) { const cfg = await syncCfg(sess); if (!cfg.token) { ready = !!cfg.offline; go.disabled = !ready; msg(cfg.offline ? E_NET : E_CONTACT, 'err'); } }
    });
    $('pwc-cancel').addEventListener('click', () => { if (!going) close(); });   // 處理中不關：關掉就看不到結果了
    dlg.addEventListener('cancel', e => { if (going) e.preventDefault(); else setTimeout(close, 0); });   // Esc：處理中不關；其餘照常關閉並清掉輸入
    show.addEventListener('click', () => reveal(n1.type === 'password'));
    $('pwc-gen').addEventListener('click', () => { n1.value = n2.value = P.gen(sess.user); reveal(true); msg('已產生一組隨機密碼並填入兩個欄位；送出前請先把它存好（例如存進密碼管理員）。'); });
    f.addEventListener('submit', async e => {
      e.preventDefault(); if (going || !ready) return;
      const bad = precheck(cur.value, n1.value, sess.user) || (n1.value !== n2.value ? '兩次輸入的新密碼不一樣。' : null);
      if (bad) { msg(bad, 'err'); return; }
      going = true; go.disabled = true; msg('處理中（約幾秒，請不要關閉視窗）…');
      try {
        if (admin) {
          await P.changeAdmin(sess, cur.value, n1.value);
          msg('管理員密碼已更改，即將登出；請用新密碼重新登入。', 'ok');
          setTimeout(() => { try { sessionStorage.removeItem('bn-session'); } catch (err) { /* 略過 */ } location.href = 'login.html'; }, 2200);
          return;   // 不再開放按鈕：等待轉到登入頁
        }
        await P.submit(sess, cur.value, n1.value);
        close(); await paint();
      } catch (err) { const t = err && !(window.DOMException && err instanceof DOMException) && err.message; msg(t && /[\u4e00-\u9fff]/.test(t) ? t : '沒有成功，請稍後再試；一直不行的話請聯絡管理員。', 'err'); }
      going = false; go.disabled = false;
    });
    // 狀態列（會員）：等待生效／已生效／作廢
    function line(t, ok, acts) {
      bar.textContent = ''; bar.className = 'msg ' + (ok ? 'ok' : 'info');
      bar.appendChild(document.createTextNode(t));
      (acts || []).forEach(([label, fn]) => { const b = el('button', null, label); b.type = 'button'; b.addEventListener('click', fn); bar.appendChild(b); });
      bar.hidden = false;
    }
    const hide = () => { bar.hidden = true; bar.textContent = ''; };
    async function paint() {
      if (!bar || admin) return;
      let s; try { s = await P.status(sess); } catch (e) { return; }
      if (s.state === 'pending') line('新密碼已' + (s.at ? '於 ' + when(s.at) + ' ' : '') + '送出，等待管理端完成更新後生效。' + (s.here ? '這台裝置現在就能用新密碼登入；其他裝置在生效前請繼續使用原本的密碼。' : '生效前請繼續使用原本的密碼登入。') + '需要盡快生效時請通知管理員。', false,
        [['取消申請', async () => { if (!confirm('取消這次的密碼變更？取消後請繼續使用原本的密碼。')) return; try { await P.cancel(sess); line('已取消這次的密碼變更，請繼續使用原本的密碼。', false, [['知道了', hide]]); } catch (e) { alert((e && e.message) || E_NET); } }]]);
      else if (s.state === 'applied') line('密碼變更已生效：之後所有裝置請使用新密碼登入。', true, [['知道了', hide]]);
      else if (s.state === 'replaced') line('這個帳號的密碼已由管理員另行更改，你先前送出的密碼變更已作廢；請以管理員提供的密碼為準。', false, [['知道了', hide]]);
      else if (s.state === 'gone') line('先前送出的密碼變更沒有生效（可能已被取消）；需要的話請重新送出。', false, [['知道了', hide]]);
      else hide();
    }
    paint();
    // 管理員開著會員專區時，背景自動套用了會員的密碼變更 → 在同一個位置顯示一行
    if (admin && bar) document.addEventListener('bn:pwc', e => { const r = e.detail || {}, ok = (r.results || []).filter(x => x.res === 'applied').map(x => x.user);
      if (ok.length) line('已自動套用會員的密碼變更：' + ok.join('、') + '（立即生效；紀錄在管理後台）。', true, [['知道了', hide]]); });
  };

  window.BN.pwc = P;
  const start = () => { try { P.mount(); } catch (e) { /* 畫面元件出錯不影響頁面其他功能 */ } try { P.auto(); } catch (e) { /* 略過 */ } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
