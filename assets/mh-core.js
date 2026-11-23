/* BNASDAQ｜持有資產共用核心：會員專區（assets/mh.js）、每日市場分析「你的資產變化」（assets/mychange.js）、
   公開的投資組合透視（assets/lt-ui.js，只用價格部分）共用同一套。
   本機那份（只有會員頁用，需要 assets/auth.js）：每個帳號的金鑰＝SHA-256('bnasdaq-holdings-v1|' + 帳號 + '|' + 會員主金鑰)，AES-GCM，存在 localStorage 'bn-mh-v1:' + 帳號。
   跨裝置同步（站方啟用後才有；見下方「跨裝置同步」）：同一份資料另外用「個人金鑰」加密後放到站方的私人 GitHub repo，會員在任何裝置登入都看到同一份。
   價格：每一檔取「日期最新」的來源，並記下同一來源的前一個交易日收盤（算每日變化用）——
     data/lt/px.json（投資組合透視每日價格，只有最新價；Nasdaq 擋線時美股會停在舊日期，例如 11/11 起停在 11/06）
     data/tw/latest.json（台股官方收盤，證交所延遲時 Yahoo 補位；美股 Yahoo；只收已收盤的交易日；附漲跌。台股收盤後幾分鐘先放 Yahoo奇摩股市的收盤，檔內 prelim 標明，官方檔案出來後換掉）
     data/lt/us-close.json（美股總表全部代號的最新收盤＋漲跌，美股收盤後更新；上面那個檔的美股只有比較頁清單六百多檔）
     data/heatmap/latest.json（指數成分股收盤＋漲跌%）、data/market.json（QQQ 本月每日收盤）
   各市場收盤後由 heatmap-live.yml 的 session 啟動 tw-latest.yml 更新上面兩個檔並重新部署（GitHub 自己的排程在這個 repo 會晚 7～10 小時）。
   「不列入計算」的列（row.off）在 rows() 會換成空白列：引擎略過它，列號不變。計算交給 assets/lt-engine.js（股數模式）。
   即時價（2026-11-24）：有載入 assets/liveq.js 的頁面，盤中／盤前／盤後的最新成交與即時匯率會蓋在上面的收盤價上（C.applyLive，規則見下方）。 */
(function () {
  'use strict';
  if (!window.BN || !BN.lt) return;   // BN.auth 只有加密函式用到（會員頁才載入）
  const LT = BN.lt, C = {}, enc = new TextEncoder(), dec = new TextDecoder();
  C.store = user => 'bn-mh-v1:' + user;
  C.ukey = async sess => {
    const ck = BN.auth.b64.dec(sess.ck), pre = enc.encode('bnasdaq-holdings-v1|' + sess.user + '|');
    const buf = new Uint8Array(pre.length + ck.length); buf.set(pre); buf.set(ck, pre.length);
    return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  };
  C.seal = async (sess, obj) => { const e = await BN.auth.aesEnc(await C.ukey(sess), enc.encode(JSON.stringify(obj))); return { schema: 'bnasdaq-holdings/1', user: sess.user, saved: obj.saved, iv: e.iv, ct: e.ct }; };
  C.open = async (sess, env) => {
    if (!env || env.schema !== 'bnasdaq-holdings/1') throw new Error('不是持有資產備份檔');
    if (env.user !== sess.user) throw new Error('這份備份屬於帳號「' + env.user + '」，請用該帳號登入後匯入');
    return JSON.parse(dec.decode(await BN.auth.aesDec(await C.ukey(sess), env.iv, env.ct)));
  };
  C.load = async sess => { const raw = localStorage.getItem(C.store(sess.user)); return raw ? C.open(sess, JSON.parse(raw)) : null; };
  C.saveLocal = async (sess, obj) => { localStorage.setItem(C.store(sess.user), JSON.stringify(await C.seal(sess, obj))); };

  // ---------- 跨裝置同步 ----------
  // 本站沒有伺服器：同步資料放在站方另一個「私人」GitHub repo，瀏覽器經 GitHub Contents API 讀寫（只連 api.github.com）。
  //   data/sync-key.json＝{iv, ct}：用會員主金鑰 CK 加密的 {repo, token}，登入的會員才解得開；token 只能讀寫那個私人 repo。
  //   沒有這個檔＝站方沒啟用，一切照舊只存本機。
  //   每位會員一個檔 v1/<檔名>.json，內容是 AES-GCM 密文。檔名與內容金鑰都由個人金鑰 UK 算出（UK 由登入密碼導出，見 auth.js），
  //   所以其他會員看不出哪個檔是誰的，也解不開；repo 裡沒有帳號、沒有明文。
  //   密文裡的文件＝{user, rev, saved, device, rows}；rev 每上傳一次加 1。
  //   這台的同步紀錄存在 localStorage 'bn-mh-sync:' + 帳號＝{fid, rev, hash, sha, etag}（上次同步時雲端的版本、內容雜湊、檔案 sha）。
  //   本機那份照舊保留：離線也能用；密碼被重設後 UK 換了、雲端舊檔解不開，就靠任何一台還有本機資料的裝置重新上傳。
  //   規則（once）：
  //     兩邊內容相同 → 只更新紀錄
  //     雲端沒被別的裝置改過（rev 和上次同步一樣）→ 這台有改就上傳
  //     雲端被改過、這台沒改 → 採用雲端
  //     兩邊都改過（或這台第一次同步而兩邊內容不同）→ 取儲存時間較新的一份；另一份留在這台當備份（'bn-mh-bak:' + 帳號），畫面上可以還原
  //     雲端的 rev 比上次同步還小（被換回舊檔，或檔案被刪後由別台重傳）→ 一樣取儲存時間較新的一份，另一份留作備份
  //     雲端那份解不開（損毀、被竄改）或不見了 → 這台有資料就重新上傳（rev 接著往上加）
  const hex = u8 => Array.from(u8, x => x.toString(16).padStart(2, '0')).join('');
  const sha256 = async (label, u8) => { const l = enc.encode(label), buf = new Uint8Array(l.length + u8.length); buf.set(l); buf.set(u8, l.length); return new Uint8Array(await crypto.subtle.digest('SHA-256', buf)); };
  const LS = {
    get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: k => { try { localStorage.removeItem(k); } catch (e) { /* 略過 */ } }
  };
  const memMeta = {};   // localStorage 不能用（無痕模式）時，同步紀錄只留在這一頁
  const getMeta = user => memMeta[user] || LS.get('bn-mh-sync:' + user) || {};
  const setMeta = (user, m) => { memMeta[user] = m; LS.set('bn-mh-sync:' + user, m); };
  const deviceId = () => { let d = ''; try { d = localStorage.getItem('bn-device') || ''; if (!d) { d = hex(crypto.getRandomValues(new Uint8Array(6))); localStorage.setItem('bn-device', d); } } catch (e) { d = d || 'nostore'; } return d; };
  // 內容比對用的標準寫法：只留有代號或數量的列，欄位一律轉成字串（和會員頁儲存時的篩選一致）
  C.canon = rows => JSON.stringify((rows || []).map(r => { const o = { code: String(r.code == null ? '' : r.code).trim(), v: String(r.v == null ? '' : r.v).trim(), cost: String(r.cost == null ? '' : r.cost).trim() }; if (r.off) o.off = true; return o; }).filter(o => o.code || +o.v));
  const rowsHash = async rows => hex(await sha256('bnasdaq-rows|', enc.encode(C.canon(rows))));

  let CFG, repoSeen = false, KEYS = null;
  // 讀同步設定：cfg｜null（沒啟用或解不開）｜'offline'（連不上，之後再試）
  C.syncConfig = async sess => {
    if (CFG !== undefined) return CFG;
    let r; try { r = await tfetch('data/sync-key.json?t=' + Date.now(), { cache: 'no-store' }, 8000); } catch (e) { return 'offline'; }
    CFG = null;
    try {
      const j = r.ok ? await r.json() : null;
      if (j && j.iv && j.ct) { const o = JSON.parse(dec.decode(await BN.auth.aesDec(BN.auth.b64.dec(sess.ck), j.iv, j.ct)));
        if (o && /^[\w.-]+\/[\w.-]+$/.test(o.repo || '') && o.token) CFG = { repo: o.repo, token: o.token, api: 'https://api.github.com/repos/' + o.repo }; }
    } catch (e) { CFG = null; }
    return CFG;
  };
  const keys = async sess => {
    if (KEYS && KEYS.uk === sess.uk) return KEYS;
    const uk = BN.auth.b64.dec(sess.uk);
    KEYS = { uk: sess.uk, fid: hex(await sha256('bnasdaq-sync-file-v1|', uk)).slice(0, 40), key: await sha256('bnasdaq-sync-data-v1|', uk) };
    return KEYS;
  };
  // 每個請求都有時限：連線卡住時當作連不上，下一輪再試（否則同步會永遠卡在那一次）
  const tfetch = (url, opt, ms) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 12000); return fetch(url, Object.assign({}, opt, { signal: c.signal })).finally(() => clearTimeout(t)); };
  const ghHead = (cfg, more) => Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + cfg.token }, more);
  const limited = r => (r.status === 403 || r.status === 429) && (r.headers.get('x-ratelimit-remaining') === '0' || r.headers.get('retry-after'));
  async function rGet(cfg, fid, etag) {
    let r; try { r = await tfetch(cfg.api + '/contents/v1/' + fid + '.json', { headers: ghHead(cfg, etag ? { 'If-None-Match': etag } : null), cache: 'no-store' }); } catch (e) { return { st: 'offline' }; }
    if (r.status === 304) return { st: 'same' };
    if (r.status === 404) return { st: 'none' };
    if (r.status === 401) return { st: 'auth' };
    if (r.status === 403 || r.status === 429) return { st: limited(r) ? 'busy' : 'auth' };
    if (!r.ok) return { st: 'error', why: 'GitHub ' + r.status };
    try { const j = await r.json(); return { st: 'ok', sha: j.sha, etag: r.headers.get('ETag') || '', text: atob(String(j.content || '').replace(/\s/g, '')) }; } catch (e) { return { st: 'error', why: '回應格式不對' }; }
  }
  async function rPut(cfg, fid, text, sha, keepalive) {
    const body = { message: 'sync', content: btoa(text) }; if (sha) body.sha = sha;
    let r; try { r = await tfetch(cfg.api + '/contents/v1/' + fid + '.json', { method: 'PUT', headers: ghHead(cfg, { 'Content-Type': 'application/json' }), body: JSON.stringify(body), keepalive: !!keepalive }, 15000); } catch (e) { return { st: 'offline' }; }
    if (r.status === 200 || r.status === 201) { try { const j = await r.json(); return { st: 'ok', sha: (j.content && j.content.sha) || '' }; } catch (e) { return { st: 'ok', sha: '' }; } }
    if (r.status === 409 || r.status === 422 || (r.status === 404 && sha)) return { st: 'conflict' };   // 雲端那份已經不是我們以為的版本（或被刪了）→ 重新讀再決定
    if (r.status === 401 || r.status === 404) return { st: 'auth' };
    if (r.status === 403 || r.status === 429) return { st: limited(r) ? 'busy' : 'auth' };
    return { st: 'error', why: 'GitHub ' + r.status };
  }
  // 檔案讀不到時，分清楚是「這位會員還沒有資料」還是「整個 repo 讀不到（金鑰失效或沒權限）」
  async function repoReachable(cfg) { if (repoSeen) return true; try { const r = await tfetch(cfg.api, { headers: ghHead(cfg), cache: 'no-store' }); repoSeen = r.ok; } catch (e) { return false; } return repoSeen; }
  async function sealDoc(sess, K, d) {
    const e = await BN.auth.aesEnc(K.key, enc.encode(JSON.stringify({ schema: 'bnasdaq-holdings-sync/1', user: sess.user, rev: d.rev, saved: d.saved, device: deviceId(), rows: d.rows })));
    return JSON.stringify({ schema: 'bnasdaq-sync/1', iv: e.iv, ct: e.ct });
  }
  async function openDoc(sess, K, text) {
    const j = JSON.parse(text); if (!j || j.schema !== 'bnasdaq-sync/1') throw new Error('schema');
    const d = JSON.parse(dec.decode(await BN.auth.aesDec(K.key, j.iv, j.ct)));
    if (String(d.user || '').toLowerCase() !== String(sess.user).toLowerCase()) throw new Error('user');
    return { rev: +d.rev || 0, saved: String(d.saved || ''), rows: Array.isArray(d.rows) ? d.rows : [] };
  }
  const keepBackup = async (sess, doc, why) => { try { LS.set('bn-mh-bak:' + sess.user, { at: new Date().toISOString(), why, env: await C.seal(sess, { rows: doc.rows, saved: doc.saved }) }); } catch (e) { /* 略過 */ } };
  C.syncBackup = async sess => { const b = LS.get('bn-mh-bak:' + sess.user); if (!b || !b.env) return null; try { return { at: b.at, why: b.why, doc: await C.open(sess, b.env) }; } catch (e) { return null; } };
  C.syncBackupDrop = sess => LS.del('bn-mh-bak:' + sess.user);

  let HOOK = null, SESS = null, chain = Promise.resolve(), pushTimer = 0, wired = false, last = { state: 'init' };
  async function localDoc(sess) {
    if (HOOK && HOOK.getDoc && SESS === sess) { const d = HOOK.getDoc(); if (d) return { rows: d.rows || [], saved: d.saved || '' }; }
    try { const o = await C.load(sess); return { rows: (o && o.rows) || [], saved: (o && o.saved) || '' }; } catch (e) { return { rows: [], saved: '' }; }   // 本機那份解不開就當作沒有，改用雲端
  }
  // 同步一輪。回傳 {state, …}：state＝off｜relogin｜synced｜offline｜auth｜busy｜error；changed＝這台改用了雲端的資料（doc）；notice＝兩邊都改過時的說明
  async function once(sess, opt) {
    opt = opt || {};
    const cfg = await C.syncConfig(sess);
    if (cfg === 'offline') return { state: 'offline' };
    if (!cfg) return { state: 'off' };
    if (!sess.uk) return { state: 'relogin' };
    const K = await keys(sess), user = sess.user, now = new Date().toISOString();
    for (let turn = 0; turn < 4; turn++) {
      let meta = getMeta(user); if (meta.fid !== K.fid) meta = { fid: K.fid };   // 密碼改過 → 檔名換了 → 當作第一次同步
      const L = await localDoc(sess), lhash = await rowsHash(L.rows), hasLocal = C.canon(L.rows) !== '[]';
      const dirty = meta.hash ? lhash !== meta.hash : hasLocal;
      const put = async (rev, sha, extra) => {
        const p = await rPut(cfg, K.fid, await sealDoc(sess, K, { rev, saved: L.saved || now, rows: JSON.parse(C.canon(L.rows)) }), sha, opt.keepalive);
        if (p.st === 'ok') { setMeta(user, { fid: K.fid, rev, hash: lhash, sha: p.sha }); return Object.assign({ state: 'synced', rev, pushed: true }, extra); }
        return p.st === 'conflict' ? null : { state: p.st, why: p.why, dirty: true };
      };
      // 捷徑：這台有改、而且知道上次同步時雲端那份的 sha → 直接上傳；雲端若被別的裝置改過，GitHub 會拒絕（409），再走完整流程
      // 其他任何結果（包含意料之外的錯誤）→ 接著走下面的完整流程，重新讀雲端再決定
      if (dirty && meta.hash && meta.sha && turn === 0) { const r = await put((meta.rev || 0) + 1, meta.sha); if (r && ['synced', 'offline', 'auth', 'busy'].includes(r.state)) return r; }
      const g = await rGet(cfg, K.fid, opt.poll && !dirty ? meta.etag : null);
      if (g.st === 'same') return { state: 'synced', rev: meta.rev };
      if (g.st !== 'ok' && g.st !== 'none') return { state: g.st, why: g.why, dirty };
      if (g.st === 'none' && !(await repoReachable(cfg))) return { state: 'auth', dirty };
      let R = null, bad = false;
      if (g.st === 'ok') { try { R = await openDoc(sess, K, g.text); } catch (e) { bad = true; } }
      if (!R) {   // 雲端沒有這位會員的檔（還沒傳過、或被刪了），或那份解不開（損毀、被竄改）
        if (!hasLocal) { if (bad) return { state: 'error', why: '雲端那份資料無法解讀' }; setMeta(user, { fid: K.fid, rev: meta.rev || 0, hash: lhash }); return { state: 'synced', rev: meta.rev || 0 }; }
        // 版本號接著這台上次同步的往上加（不從 1 重來），別台才不會把它當成「被換回舊檔」
        const r = await put((meta.rev || 0) + 1, bad ? g.sha : null, bad ? { repaired: true } : null); if (r) return r; continue;
      }
      const rhash = await rowsHash(R.rows);
      if (rhash === lhash) { setMeta(user, { fid: K.fid, rev: R.rev, hash: lhash, sha: g.sha, etag: g.etag }); return { state: 'synced', rev: R.rev }; }
      const moved = !(meta.hash && meta.rev === R.rev);            // 雲端被別的裝置改過（或這台第一次同步）
      const older = !!meta.hash && R.rev < (meta.rev || 0);        // 雲端版本號倒退：被換回舊檔，或檔案被刪後由別台重傳
      if (!moved) { const r = await put(R.rev + 1, g.sha); if (r) return r; continue; }   // 雲端沒動、這台有改 → 上傳
      const adopt = async notice => {
        // 讀雲端的這段時間，這台又被改了（會員正在打字）→ 重來一輪，不要蓋掉剛打的
        if ((await rowsHash((await localDoc(sess)).rows)) !== lhash) return null;
        const doc = { rows: R.rows, saved: R.saved || now };
        try { await C.saveLocal(sess, doc); } catch (e) { /* 這台存不了（無痕模式）：資料仍顯示在畫面上 */ }
        setMeta(user, { fid: K.fid, rev: R.rev, hash: rhash, sha: g.sha, etag: g.etag });
        return { state: 'synced', rev: R.rev, changed: true, doc, notice };
      };
      if (!dirty && !older) { const r = await adopt(null); if (r) return r; continue; }   // 一般情況：別台改了、這台沒改 → 採用雲端
      // 兩邊都改過，或雲端版本號倒退：取儲存時間較新的一份，另一份留在這台當備份
      if (L.saved > R.saved) {
        await keepBackup(sess, R, 'local-won');
        const r = await put(Math.max(R.rev, meta.rev || 0) + 1, g.sha, { notice: { type: 'local-won', mine: L.saved, other: R.saved } }); if (r) return r; continue;
      }
      const r = await adopt(hasLocal ? { type: 'remote-won', mine: L.saved, other: R.saved } : null);
      if (r) { if (hasLocal) await keepBackup(sess, L, 'remote-won'); return r; }   // 這台原本那份（L）留作備份；這台本來就沒資料就不用留
    }
    return { state: 'busy', dirty: true };
  }
  const say = s => { last = Object.assign({ at: new Date().toISOString() }, s); if (HOOK && HOOK.onStatus) { try { HOOK.onStatus(last); } catch (e) { /* 略過 */ } } return last; };
  // 只同步一輪、不掛任何事件（每日市場分析用）
  C.syncOnce = async sess => { try { return await once(sess, {}); } catch (e) { return { state: 'error', why: String((e && e.message) || e) }; } };
  // 會員頁：hook＝{getDoc() 目前畫面上的資料, onRemote(doc, result) 改用雲端資料時, onStatus(status)}
  C.syncNow = opt => {
    chain = chain.then(async () => {
      if (!SESS) return last;
      clearTimeout(pushTimer); pushTimer = 0;
      if (!(opt && opt.quiet)) say({ state: 'syncing' });
      let r; try { r = await once(SESS, opt); } catch (e) { r = { state: 'error', why: String((e && e.message) || e) }; }
      if (r.changed && HOOK && HOOK.onRemote) { try { await HOOK.onRemote(r.doc, r); } catch (e) { /* 略過 */ } }
      return say(r);
    });
    return chain;
  };
  C.syncTouch = () => { if (!SESS) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => C.syncNow(), 1500); };
  C.syncStart = (sess, hook) => {
    SESS = sess; HOOK = hook || {};
    if (!wired) { wired = true;
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') C.syncNow({ poll: true, quiet: true }); else if (pushTimer) C.syncNow({ keepalive: true, quiet: true }); });
      window.addEventListener('online', () => C.syncNow({ quiet: true }));
      setInterval(() => { if (document.visibilityState === 'visible' && !pushTimer && last.state !== 'off' && last.state !== 'relogin') C.syncNow({ poll: true, quiet: true }); }, 60000);
    }
    return C.syncNow();
  };
  C.syncStatus = () => last;

  // ---------- 價格（每檔取日期最新的來源）----------
  let D = null;
  const getJ = async u => { try { const r = await fetch(u, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  C.data = async () => {
    if (D) return D;
    const [UNI, P, L, H, M, UC] = await Promise.all(['data/lt/universe.json', 'data/lt/px.json', 'data/tw/latest.json', 'data/heatmap/latest.json', 'data/market.json', 'data/lt/us-close.json'].map(getJ));
    if (!UNI) throw new Error('證券總表讀取失敗');
    const U = new Map(), A = (P && P.asof) || {}, PX = (P && P.px) || {};
    UNI.list.forEach(x => U.set(x[0], { code: x[0], n: x[1], m: x[2], k: x[3], s: x[4], lt: x[5], p: PX[x[0]] || null,
      d: x[2] === 'US' ? (x[3] === 'E' ? String(A.USETF || A.US || '').slice(0, 10) : (A.US || '')) : (A[x[2]] || ''), pp: null,
      src: x[2] === 'US' ? 'Nasdaq 篩選器快照價' : '證交所／櫃買中心收盤', pr: 0 }));
    // 日期較新才換；同一天時換成可信度較高的來源（熱力圖、QQQ 檔是收盤後才抓的正式收盤 > 最新收盤檔 > 價格檔）
    const take = (code, d, p, pp, src, pr) => {
      const u = U.get(code); if (!u || !(p > 0) || !d) return;
      if (d > (u.d || '') || (d === u.d && pr > (u.pr || 0))) { u.p = p; u.d = d; u.pp = pp > 0 ? pp : null; u.src = src; u.pr = pr; }
    };
    // 最新收盤檔：舊版程式曾在美股盤中抓價（11/11 台北 23:05），所以更新時間早於該日美股收盤的美股資料不用。
    // 美股收盤＝夏令 20:00 UTC、冬令 21:00 UTC；現在的程式只收已收盤的交易日，這裡用較早的 20:00 當門檻（用 21:10 的話，夏令收盤後 10 分鐘那一次會被誤擋）
    const usOk = L && L.asof && L.asof.US && L.updated && Date.parse(L.updated) >= Date.parse(L.asof.US + 'T20:00:00Z');
    // 台股收盤後幾分鐘內先放 Yahoo奇摩股市的收盤（prelim＝初值），官方檔案出來後同一天的資料會換成官方的
    const pre = new Set((L && L.prelim) || []);
    if (L && L.items) Object.entries(L.items).forEach(([c, v]) => { const mk = v[3] || 'TW'; if (mk === 'US' && !usOk) return; take(c, (L.asof || {})[mk], v[0], v[1] != null ? v[0] - v[1] : null, mk === 'US' ? 'Yahoo 收盤' : pre.has(mk) ? 'Yahoo奇摩股市收盤（官方檔案出來後更新）' : '證交所／櫃買中心收盤', 1); });
    // 美股總表全部代號的最新收盤（data/lt/us-close.json，美股收盤後更新）：上面那個檔只有比較頁清單的六百多檔，其餘一萬多檔靠這個
    if (UC && UC.px && /^\d{4}-\d{2}-\d{2}$/.test(UC.asof || '')) Object.entries(UC.px).forEach(([c, v]) => { if (Array.isArray(v)) take(c, UC.asof, v[0], v[1] != null ? v[0] - v[1] : null, 'Yahoo 收盤', 1); });
    if (H && H.sets) Object.values(H.sets).forEach(S => (S.tiles || []).forEach(t => { if (t[5] != null) take(t[0], S.session || H.session, t[5], t[4] != null ? t[5] / (1 + t[4] / 100) : null, '收盤（熱力圖）', 2); }));
    if (M && M.current && M.current.daily && M.current.daily.length) { const dd = M.current.daily, a = dd[dd.length - 1], b = dd[dd.length - 2]; take('QQQ', a.d, a.c, b ? b.c : null, 'Yahoo 收盤', 2); }
    // 匯率：取日期最新；前一日匯率（算美元資產的台幣變化）只有最新收盤檔有
    const fp = (P && P.fx) || {}, fl = (L && L.fx) || {};
    const FX = (fl.date || '') >= (fp.date || '') && fl.rate ? { rate: fl.rate, date: fl.date, prev: fl.chg != null ? fl.rate - fl.chg : null, src: fl.source || 'Yahoo' }
      : { rate: fp.USDTWD, date: fp.date, prev: null, src: fp.source || '' };
    D = { U, ALIAS: UNI.alias || {}, FX, FX0: FX, E: new Map(), VER: (P && P.updated) || '', UNI, PX: P || {} };
    C.applyLive();
    return D;
  };
  // ---------- 即時價（2026-11-24 站主：所有股價計算都用最新的即時價格）----------
  // assets/liveq.js 讀到的盤中／盤前／盤後最新成交蓋在上面的收盤價上：
  //   交易日比收盤資料新才蓋；同一天時收盤資料優先（官方收盤），只有美股盤後例外（盤後成交比當天收盤新）
  //   前一交易日收盤 pp 換成即時資料的前收（算今日變化用）；盤後的今日變化＝正規時段＋盤後
  //   每次先把上次蓋過的還原，所以即時資料過期（例如美股盤後結束 15 分鐘後）就自動回到收盤價
  // 匯率：即時 TWD=X（美股時段的報價板；台股時段的報價板也有）日期不早於收盤檔就用即時的
  const LVB = new Map();   // 代號 → 蓋之前的 {p, d, pp, src, pr}
  C.applyLive = () => {
    if (!D) return 0;
    LVB.forEach((b, c) => { const u = D.U.get(c); if (u) { Object.assign(u, b); delete u.live; } });
    LVB.clear(); D.FX = D.FX0;
    const Q = window.BN && BN.liveq; if (!Q) return 0;
    let n = 0;
    Q.codes().forEach(c => {
      const u = D.U.get(c); if (!u || u.k === 'C') return;
      const q = Q.get(c, u.m); if (!q || !(q.p > 0) || !q.ses) return;
      const d0 = u.d || '', same = q.ses === d0;
      if (!(q.ses > d0 || (same && q.ph === 'post') || !(u.p > 0))) return;
      LVB.set(c, { p: u.p, d: u.d, pp: u.pp, src: u.src, pr: u.pr });
      u.p = q.p; u.d = q.ses; u.pp = q.ref > 0 ? q.ref : null; u.src = q.src; u.pr = 9; u.live = q; n++;
    });
    const f = Q.fx(), b = D.FX0 || {};
    if (f && f.rate > 0 && f.date >= (b.date || '')) D.FX = { rate: f.rate, date: f.date, prev: f.prev > 0 ? f.prev : b.prev, src: f.src, live: f };
    return n;
  };
  // 頁面用：開始讀即時快照，有新報價時先套用再呼叫 fn（會員專區、投資組合透視、每日市場分析「你的資產變化」）
  C.onLive = fn => {
    const Q = window.BN && BN.liveq; if (!Q) return false;
    Q.want(['TW', 'US']);
    const go = () => { if (!D) return; C.applyLive(); try { fn(); } catch (e) { /* 畫面元件自己處理 */ } };
    Q.on(go);
    if (Q.codes().length) setTimeout(go, 0);   // 頁面算完之前就已經讀到的即時報價：馬上套用一次
    return true;
  };
  // 價格旁的日期說明：收盤只寫日期；即時寫「日期 盤中 10:15」之類（台北時間）
  C.when = u => !u ? '' : (u.d || '') + (u.live && window.BN && BN.liveq ? ' ' + BN.liveq.tag(u.live) : '');
  C.fxWhen = () => !D || !D.FX ? '' : (D.FX.date || '') + (D.FX.live && window.BN && BN.liveq ? ' ' + BN.liveq.hhmm(D.FX.live.t) + ' 即時' : '');
  C.etf = async function etf(code, depth) {
    const d = await C.data();
    if (d.E.has(code) || (depth || 0) > 2) return;
    const u = d.U.get(code); if (!u || u.k !== 'E' || !u.lt) { d.E.set(code, null); return; }
    try { const r = await fetch('data/lt/etf/' + encodeURIComponent(code) + '.json?d=' + encodeURIComponent(d.VER)); const j = r.ok ? await r.json() : null; d.E.set(code, j); if (j && j.base) await etf(j.base, (depth || 0) + 1); }
    catch (e) { d.E.set(code, null); }
  };
  // 輸入列 → 引擎用的列（不列入計算的換成空白列，列號不變）
  C.rows = rows => (rows || []).map(r => r.off ? { code: '', v: '' } : { code: r.code, v: r.v });
  C.compute = async rows => {
    const d = await C.data(), rs = C.rows(rows);
    const codes = [...new Set(rs.map(r => LT.norm(r.code)).filter(c => d.U.has(c)))];
    await Promise.all(codes.map(c => C.etf(c)));
    C.applyLive();
    return LT.compute(rs, { mode: 'shares', U: d.U, E: d.E, fx: d.FX.rate, alias: d.ALIAS });
  };
  window.BN.mh = C;
})();
