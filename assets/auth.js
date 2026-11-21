/* BNASDAQ 帳號／加密／GitHub 寫入（純前端；帳號檔 data/accounts.json 只存雜湊與包裝後的金鑰）
   - 密碼驗證：PBKDF2-SHA256（310,000 次）→ 32 bytes → base64 與 accounts.json 的 auth.hash 比對
   - 規則金鑰 CK：以「密碼派生金鑰（另一個 salt）」用 AES-GCM 包裝，存在每個帳號的 wrap 欄位；登入後解開 CK → 解密 data/rules.enc.json → 在瀏覽器執行規則
  - 第 2 版規則（rules.enc.json 有 ek 欄位）：CK 先解開 data/rules-key.json 的 RSA 私鑰，再解開規則的一次性金鑰；發布規則只需要公鑰
   - 管理員寫入：GitHub Contents API（fine-grained PAT，只存在管理員自己的瀏覽器，且以 CK 加密）
   - 個人金鑰 UK：登入時由密碼導出、只放在這次登入的 session；會員持有資產跨裝置同步用它加密（assets/mh-core.js） */
(function () {
  'use strict';
  const REPO = 'WUYANLIN8866/BNASDAQ';
  const API = 'https://api.github.com/repos/' + REPO + '/contents/';
  const ITER = 310000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = { enc: u8 => btoa(String.fromCharCode(...u8)), dec: s => Uint8Array.from(atob(s), c => c.charCodeAt(0)) };
  const b64utf8 = { enc: str => { const u = enc.encode(str); let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(bin); }, dec: s => dec.decode(b64.dec(s.replace(/\n/g, ''))) };
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));

  async function pbkdf2(password, saltU8, iter, bits) {
    const km = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltU8, iterations: iter }, km, bits));
  }
  async function aesKey(raw, usages) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages || ['encrypt', 'decrypt']); }
  async function aesEnc(raw, dataU8) { const iv = rnd(12); const k = await aesKey(raw, ['encrypt']); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, dataU8)); return { iv: b64.enc(iv), ct: b64.enc(ct) }; }
  async function aesDec(raw, ivB64, ctB64) { const k = await aesKey(raw, ['decrypt']); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(ivB64) }, k, b64.dec(ctB64))); }

  // ---------- accounts file ----------
  async function fetchJSON(path) {
    try { const r = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) { }
    // fallback: GitHub API (immediately after the admin writes, Pages may still be deploying)
    const r = await fetch(API + path + '?ref=main&t=' + Date.now(), { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('無法讀取 ' + path);
    const j = await r.json(); return JSON.parse(b64utf8.dec(j.content));
  }
  async function fetchAccounts() {
    // prefer the API copy when it is newer (the Pages copy may lag a deploy)
    let site = null, api = null;
    try { const r = await fetch('data/accounts.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) site = await r.json(); } catch (e) { }
    try { const r = await fetch(API + 'data/accounts.json?ref=main&t=' + Date.now(), { headers: { Accept: 'application/vnd.github+json' } }); if (r.ok) { const j = await r.json(); api = JSON.parse(b64utf8.dec(j.content)); api._sha = j.sha; } } catch (e) { }
    if (site && api) return (api.updated || '') >= (site.updated || '') ? api : Object.assign(site, { _sha: api._sha });
    if (api) return api; if (site) return site; throw new Error('無法讀取帳號資料，請稍後再試。');
  }

  // ---------- login ----------
  async function login(user, password) {
    const db = await fetchAccounts();
    const rec = (db.accounts || []).find(a => a.user.toLowerCase() === user.trim().toLowerCase());
    if (!rec) throw new Error('帳號或密碼錯誤。');
    if (rec.active === false) throw new Error('此帳號已停用，請聯絡管理員。');
    const h = b64.enc(await pbkdf2(password, b64.dec(rec.auth.salt), rec.auth.iter || ITER, 256));
    if (h !== rec.auth.hash) throw new Error('帳號或密碼錯誤。');
    const wk = await pbkdf2(password, b64.dec(rec.wrap.salt), rec.wrap.iter || ITER, 256);
    const ck = await aesDec(wk, rec.wrap.iv, rec.wrap.ct);
    // 個人金鑰 UK＝SHA-256('bnasdaq-user-key-v1|' ‖ 包裝金鑰)：只能由這個帳號的密碼導出，其他會員算不出來（CK 是全體會員共用的，UK 不是）。
    // 用途：加密要跨裝置同步的個人資料（會員持有資產，見 assets/mh-core.js）。密碼被重設或更改後，UK 會換一把。
    const lab = enc.encode('bnasdaq-user-key-v1|'), buf = new Uint8Array(lab.length + wk.length); buf.set(lab); buf.set(wk, lab.length);
    const uk = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    const sess = { user: rec.user, role: rec.role, ck: b64.enc(ck), uk: b64.enc(uk), ts: Date.now() };
    sessionStorage.setItem('bn-session', JSON.stringify(sess));
    return sess;
  }
  function session() { try { return JSON.parse(sessionStorage.getItem('bn-session') || 'null'); } catch (e) { return null; } }
  function logout() { sessionStorage.removeItem('bn-session'); location.href = 'login.html'; }
  function require(role) { const s = session(); if (!s || (role && s.role !== role && s.role !== 'admin')) { location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop())); return null; } return s; }

  // ---------- rules ----------
  async function loadRules(sess) {
    if (window.BN_RULES) return window.BN_RULES;
    const r = await fetch('data/rules.enc.json?t=' + Date.now(), { cache: 'no-store' }); const j = await r.json();
    let src, pk = null;
    if (j.ek) {
      // 第 2 版：規則用一次性 AES 金鑰加密，該金鑰再用「會員規則公鑰」（RSA-OAEP-SHA256）包裝；
      // 對應的私鑰以會員主金鑰（CK）加密後存在 data/rules-key.json，所以只有登入的會員能解開，而發布規則的一方不需要任何秘密
      const kf = await (await fetch('data/rules-key.json?t=' + Date.now(), { cache: 'no-store' })).json();
      pk = await crypto.subtle.importKey('pkcs8', await aesDec(b64.dec(sess.ck), kf.priv.iv, kf.priv.ct), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
      const dk = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pk, b64.dec(j.ek)));
      src = dec.decode(await aesDec(dk, j.iv, j.ct));
      // 規則用到的金融環境月資料（data/macro.enc.json，GitHub Actions 每天由 FRED 公開資料產生、用同一把會員規則公鑰加密）；
      // 沒有或解不開時設為 null，由規則自己決定怎麼處理（例如沿用規則內建的歷史資料）
      try {
        const mj = await (await fetch('data/macro.enc.json?t=' + Date.now(), { cache: 'no-store' })).json();
        const mk = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pk, b64.dec(mj.ek.member)));
        window.BN_MACRO = JSON.parse(dec.decode(await aesDec(mk, mj.iv, mj.ct)));
      } catch (e) { window.BN_MACRO = null; }
    } else {
      src = dec.decode(await aesDec(b64.dec(sess.ck), j.iv, j.ct));
    }
    (new Function(src))();
    if (!window.BN_RULES) throw new Error('規則載入失敗');
    // 第 2 版金融環境月資料（規則表示需要時才載入；同樣由 GitHub Actions 每天由 FRED 公開資料產生、用會員規則公鑰加密）：
    //   data/macro2.enc.json＝最新；data/macro2/asof-YYYY-MM.enc.json＝各月月底定案檔（寫一次不再改，所以可以讓瀏覽器快取），清單在 data/macro2/index.json。
    // 結果放在 window.BN_MACRO2＝{ ready, latest, asof }；某一份讀不到就是 null，清單讀不到 ready＝false，由規則決定怎麼處理（不會拿別的月份的資料頂替）
    if (pk && window.BN_RULES.macroAfter) {
      const dec2 = async (url, opt) => { const mj = await (await fetch(url, opt)).json(); const mk = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pk, b64.dec(mj.ek.member))); return JSON.parse(dec.decode(await aesDec(mk, mj.iv, mj.ct))); };
      const M2 = { ready: false, latest: null, asof: {} };
      try { M2.latest = await dec2('data/macro2.enc.json?t=' + Date.now(), { cache: 'no-store' }); } catch (e) { M2.latest = null; }
      try {
        const r2 = await fetch('data/macro2/index.json?t=' + Date.now(), { cache: 'no-store' });
        const months = r2.status === 404 ? [] : ((await r2.json()).months || []);
        if (r2.status !== 404 && !r2.ok) throw new Error('index ' + r2.status);
        await Promise.all(months.filter(m => m > window.BN_RULES.macroAfter).map(async m => { try { M2.asof[m] = await dec2('data/macro2/asof-' + m + '.enc.json'); } catch (e) { M2.asof[m] = null; } }));
        M2.ready = true;
      } catch (e) { M2.ready = false; }
      window.BN_MACRO2 = M2;
    }
    window.BN_RULES._src = src;
    return window.BN_RULES;
  }

  // ---------- account records (admin) ----------
  async function makeRecord(user, password, role, ckRaw, note) {
    const sa = rnd(16), sw = rnd(16);
    const hash = b64.enc(await pbkdf2(password, sa, ITER, 256));
    const wk = await pbkdf2(password, sw, ITER, 256);
    const w = await aesEnc(wk, ckRaw);
    return { user, role, created: new Date().toISOString().slice(0, 10), active: true, note: note || '', auth: { salt: b64.enc(sa), iter: ITER, hash }, wrap: { salt: b64.enc(sw), iter: ITER, iv: w.iv, ct: w.ct } };
  }
  // ---------- 管理員查看密碼（2026-11-19 使用者要求：管理員要能看到、編輯、刪除所有帳號的帳號密碼） ----------
  // 密碼驗證仍只用雜湊（auth.hash）；另外為管理員存一份「只有管理員解得開」的密碼副本：
  //   accounts.json 頂層 view＝{ pub：RSA-OAEP-3072 公鑰, owner：管理員帳號, priv：私鑰（pkcs8）用管理員的個人金鑰 UK 以 AES-GCM 包裝 }
  //   每個帳號 pv＝用 view.pub 加密的密碼（RSA-OAEP-SHA256）。會員只有共用的 CK，沒有管理員的 UK，所以解不開別人的密碼。
  //   管理員改自己的密碼時，UK 會換，私鑰要用新 UK 重新包裝（rewrapView）。
  const OAEP = { name: 'RSA-OAEP', hash: 'SHA-256' };
  async function ukFrom(password, wrap) {
    const wk = await pbkdf2(password, b64.dec(wrap.salt), wrap.iter || ITER, 256);
    const lab = enc.encode('bnasdaq-user-key-v1|'), buf = new Uint8Array(lab.length + wk.length); buf.set(lab); buf.set(wk, lab.length);
    return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  }
  async function viewSetup(sess) {
    const kp = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    const pub = b64.enc(new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey)));
    const pk8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    const w = await aesEnc(b64.dec(sess.uk), pk8);
    return { schema: 'bnasdaq-pwview/1', alg: 'RSA-OAEP-3072-SHA256', owner: sess.user, created: new Date().toISOString().slice(0, 10), pub, priv: w };
  }
  async function sealPw(view, password) {
    const k = await crypto.subtle.importKey('spki', b64.dec(view.pub), OAEP, false, ['encrypt']);
    return b64.enc(new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, k, enc.encode(password))));
  }
  let VIEWKEY = null;
  async function openPw(view, sess, pv) {
    if (!view || !pv) return null;
    if (!VIEWKEY || VIEWKEY.pub !== view.pub) {
      const pk8 = await aesDec(b64.dec(sess.uk), view.priv.iv, view.priv.ct);
      VIEWKEY = { pub: view.pub, key: await crypto.subtle.importKey('pkcs8', pk8, OAEP, false, ['decrypt']) };
    }
    return dec.decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, VIEWKEY.key, b64.dec(pv)));
  }
  async function rewrapView(view, sess, newPassword, newRec) {   // 管理員自己的密碼改了：用新 UK 重新包裝私鑰
    const pk8 = await aesDec(b64.dec(sess.uk), view.priv.iv, view.priv.ct);
    return Object.assign({}, view, { priv: await aesEnc(await ukFrom(newPassword, newRec.wrap), pk8) });
  }
  function genPassword() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; const u = rnd(14); return Array.from(u, x => A[x % A.length]).join(''); }

  // ---------- GitHub writes (admin PAT) ----------
  async function savePAT(sess, pat) { const e = await aesEnc(b64.dec(sess.ck), enc.encode(pat)); localStorage.setItem('bn-pat', JSON.stringify(e)); }
  // 2026-11-19 使用者：「用管理員權限在網頁新增刪除修改帳號，不用特別需要跑 GitHub」→ PAT 另存一份在 accounts.json 的 adminPat
  // （用管理員的個人金鑰 UK 加密，只有管理員解得開）；任何裝置登入管理員後自動取用，不必每台瀏覽器重新貼。
  async function patBox(ukB64OrU8, pat, owner) { const k = typeof ukB64OrU8 === 'string' ? b64.dec(ukB64OrU8) : ukB64OrU8; return Object.assign({ owner, saved: new Date().toISOString().slice(0, 10) }, await aesEnc(k, enc.encode(pat))); }
  async function loadPAT(sess) {
    try { const e = JSON.parse(localStorage.getItem('bn-pat') || 'null'); if (e) return dec.decode(await aesDec(b64.dec(sess.ck), e.iv, e.ct)); } catch (err) { }
    try {
      if (sess.role !== 'admin' || !sess.uk) return null;
      const db = await fetchAccounts(), box = db.adminPat;
      if (!box || box.owner !== sess.user) return null;
      const pat = dec.decode(await aesDec(b64.dec(sess.uk), box.iv, box.ct));
      try { await savePAT(sess, pat); } catch (e) { }
      return pat;
    } catch (err) { return null; }
  }
  function clearPAT() { localStorage.removeItem('bn-pat'); }
  async function ghGet(pat, path) { const r = await fetch(API + path + '?ref=main&t=' + Date.now(), { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + pat } }); if (r.status === 404) return null; if (!r.ok) throw new Error('GitHub 讀取失敗（' + r.status + '）'); return await r.json(); }
  async function ghPut(pat, path, text, message) {
    const cur = await ghGet(pat, path);
    const body = { message, content: b64utf8.enc(text), branch: 'main' }; if (cur && cur.sha) body.sha = cur.sha;
    const r = await fetch(API + path, { method: 'PUT', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + pat, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch (e) { } throw new Error('GitHub 寫入失敗（' + r.status + '）' + (m ? '：' + m : '')); }
    return await r.json();
  }
  // 二進位檔（圖片）：content 為 base64（不經 UTF-8 轉換）
  async function ghPutB64(pat, path, b64content, message) {
    const cur = await ghGet(pat, path);
    const body = { message, content: b64content, branch: 'main' }; if (cur && cur.sha) body.sha = cur.sha;
    const r = await fetch(API + path, { method: 'PUT', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + pat, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch (e) { } throw new Error('GitHub 上傳失敗（' + r.status + '）' + (m ? '：' + m : '')); }
    return await r.json();
  }
  async function ghDelete(pat, path, message) {
    const cur = await ghGet(pat, path); if (!cur || !cur.sha) return null;
    const r = await fetch(API + path, { method: 'DELETE', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + pat, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sha: cur.sha, branch: 'main' }) });
    if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch (e) { } throw new Error('GitHub 刪除失敗（' + r.status + '）' + (m ? '：' + m : '')); }
    return await r.json();
  }
  async function ghTest(pat) { const r = await fetch('https://api.github.com/repos/' + REPO, { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + pat } }); if (!r.ok) throw new Error('PAT 無法讀取 repo（' + r.status + '）'); const j = await r.json(); if (!j.permissions || !j.permissions.push) throw new Error('PAT 沒有寫入權限（Contents: Read and write）'); return j; }
  async function ghDispatch(pat) { const r = await fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/site.yml/dispatches', { method: 'POST', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + pat, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) }); if (r.status !== 204) throw new Error('無法觸發更新（' + r.status + '）；PAT 需要 Actions: Read and write'); }

  window.BN = window.BN || {};
  BN.auth = { REPO, ITER, patBox, ukFrom, viewSetup, sealPw, openPw, rewrapView, login, session, logout, require, loadRules, fetchJSON, fetchAccounts, makeRecord, genPassword, savePAT, loadPAT, clearPAT, ghGet, ghPut, ghPutB64, ghDelete, ghTest, ghDispatch, aesEnc, aesDec, pbkdf2, b64, rnd };
})();
