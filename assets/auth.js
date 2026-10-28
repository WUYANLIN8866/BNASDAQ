/* BNASDAQ 帳號／加密／GitHub 寫入（純前端；帳號檔 data/accounts.json 只存雜湊與包裝後的金鑰）
   - 密碼驗證：PBKDF2-SHA256（310,000 次）→ 32 bytes → base64 與 accounts.json 的 auth.hash 比對
   - 規則金鑰 CK：以「密碼派生金鑰（另一個 salt）」用 AES-GCM 包裝，存在每個帳號的 wrap 欄位；登入後解開 CK → 解密 data/rules.enc.json → 在瀏覽器執行規則
   - 管理員寫入：GitHub Contents API（fine-grained PAT，只存在管理員自己的瀏覽器，且以 CK 加密） */
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
    const sess = { user: rec.user, role: rec.role, ck: b64.enc(ck), ts: Date.now() };
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
    const src = dec.decode(await aesDec(b64.dec(sess.ck), j.iv, j.ct));
    (new Function(src))();
    if (!window.BN_RULES) throw new Error('規則載入失敗');
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
  function genPassword() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; const u = rnd(14); return Array.from(u, x => A[x % A.length]).join(''); }

  // ---------- GitHub writes (admin PAT) ----------
  async function savePAT(sess, pat) { const e = await aesEnc(b64.dec(sess.ck), enc.encode(pat)); localStorage.setItem('bn-pat', JSON.stringify(e)); }
  async function loadPAT(sess) { try { const e = JSON.parse(localStorage.getItem('bn-pat') || 'null'); if (!e) return null; return dec.decode(await aesDec(b64.dec(sess.ck), e.iv, e.ct)); } catch (err) { return null; } }
  function clearPAT() { localStorage.removeItem('bn-pat'); }
  async function ghGet(pat, path) { const r = await fetch(API + path + '?ref=main&t=' + Date.now(), { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + pat } }); if (r.status === 404) return null; if (!r.ok) throw new Error('GitHub 讀取失敗（' + r.status + '）'); return await r.json(); }
  async function ghPut(pat, path, text, message) {
    const cur = await ghGet(pat, path);
    const body = { message, content: b64utf8.enc(text), branch: 'main' }; if (cur && cur.sha) body.sha = cur.sha;
    const r = await fetch(API + path, { method: 'PUT', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + pat, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch (e) { } throw new Error('GitHub 寫入失敗（' + r.status + '）' + (m ? '：' + m : '')); }
    return await r.json();
  }
  async function ghTest(pat) { const r = await fetch('https://api.github.com/repos/' + REPO, { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + pat } }); if (!r.ok) throw new Error('PAT 無法讀取 repo（' + r.status + '）'); const j = await r.json(); if (!j.permissions || !j.permissions.push) throw new Error('PAT 沒有寫入權限（Contents: Read and write）'); return j; }
  async function ghDispatch(pat) { const r = await fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/site.yml/dispatches', { method: 'POST', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + pat, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) }); if (r.status !== 204) throw new Error('無法觸發更新（' + r.status + '）；PAT 需要 Actions: Read and write'); }

  window.BN = window.BN || {};
  BN.auth = { REPO, ITER, login, session, logout, require, loadRules, fetchJSON, fetchAccounts, makeRecord, genPassword, savePAT, loadPAT, clearPAT, ghGet, ghPut, ghTest, ghDispatch, aesEnc, aesDec, pbkdf2, b64, rnd };
})();
