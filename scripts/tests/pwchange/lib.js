// 測試共用：模擬 GitHub（contents API，含版本衝突）、本機靜態伺服器、登入與密碼學小工具（Node 端，用來製作各種申請檔）
const { chromium } = require(process.env.BN_PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');   // 本機沒有這個路徑時：BN_PLAYWRIGHT=playwright
const crypto = require('crypto'), fs = require('fs'), path = require('path'), http = require('http');
const SITE = process.env.BN_SITE || '/home/claude/site_test', T = process.env.BN_T || '/home/claude/priv/T', PORT = +(process.env.BN_PORT || 8765), BASE = 'http://127.0.0.1:' + PORT + '/';
const SHOTS = (process.env.BN_SHOTS || path.join(__dirname, 'shots')).replace(/\/?$/, '/'); fs.mkdirSync(SHOTS, { recursive: true });
const SEC = JSON.parse(fs.readFileSync(T + '/secrets.json', 'utf8'));
const MAIN = 'WUYANLIN8866/BNASDAQ', PRIV = SEC.syncRepo, ITER = 310000;
const b64 = b => Buffer.from(b).toString('base64'), unb = s => Buffer.from(s, 'base64');

class FakeGH {
  constructor() { this.repos = {}; this.seq = 0; this.calls = []; this.hooks = []; }
  add(name, o) { this.repos[name.toLowerCase()] = Object.assign({ name, files: {}, private: false, read: [], write: [] }, o); return this.repos[name.toLowerCase()]; }
  sha(text) { return crypto.createHash('sha1').update(text + '|' + (++this.seq)).digest('hex'); }
  put(repo, p, text, message) { const r = this.repos[repo.toLowerCase()]; r.files[p] = { text, sha: this.sha(text), message: message || 'seed' }; return r.files[p]; }
  get(repo, p) { const f = this.repos[repo.toLowerCase()].files[p]; return f ? f.text : null; }
  json(repo, p) { const t = this.get(repo, p); return t == null ? null : JSON.parse(t); }
  list(repo, dir) { return Object.keys(this.repos[repo.toLowerCase()].files).filter(k => k.startsWith(dir + '/')); }
  async handle(route) {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const reply = (status, body) => { this.calls.push({ m, path: u.pathname, status, auth: tok ? (tok === SEC.pat ? 'PAT' : tok === SEC.sync ? 'SYNC' : 'OTHER') : '' }); return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }); };
    const auth = req.headers()['authorization'] || '', tok = auth.replace(/^Bearer /, '');
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    for (const h of this.hooks) { const r = h({ m, u, tok }); if (r) { if (r.abort) { this.calls.push({ m, path: u.pathname, status: 0 }); return route.abort(); } return reply(r.status, r.body || {}); } }
    const mm = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/); if (!mm) return reply(404, { message: 'Not Found' });
    const R = this.repos[mm[1].toLowerCase()], rest = mm[2] || '';
    if (!R) return reply(404, { message: 'Not Found' });
    const canRead = !R.private || R.read.includes(tok) || R.write.includes(tok), canWrite = R.write.includes(tok);
    if (tok && tok !== SEC.pat && tok !== SEC.sync) return reply(401, { message: 'Bad credentials' });
    if (!canRead) return reply(404, { message: 'Not Found' });
    if (rest === '') return reply(200, { full_name: R.name, private: R.private, permissions: { push: canWrite, pull: true } });
    const cm = rest.match(/^\/contents\/(.*)$/); if (!cm) return reply(404, { message: 'Not Found' });
    const p = decodeURIComponent(cm[1]).replace(/\/$/, ''), f = R.files[p];
    if (m === 'GET') {
      if (f) return reply(200, { name: path.basename(p), path: p, sha: f.sha, size: Buffer.byteLength(f.text), type: 'file', encoding: 'base64', content: Buffer.from(f.text).toString('base64').replace(/(.{60})/g, '$1\n') });
      const kids = Object.keys(R.files).filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'));
      if (kids.length) return reply(200, kids.map(k => ({ name: path.basename(k), path: k, sha: R.files[k].sha, size: Buffer.byteLength(R.files[k].text), type: 'file' })));
      return reply(404, { message: 'Not Found' });
    }
    if (!canWrite) return reply(tok ? 403 : 401, { message: 'Resource not accessible by personal access token' });
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) { }
    if (m === 'PUT') {
      if (f && !body.sha) return reply(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
      if (f && body.sha !== f.sha) return reply(409, { message: p + ' does not match ' + body.sha });
      if (!f && body.sha) return reply(409, { message: 'not found for sha' });
      const text = Buffer.from(body.content || '', 'base64').toString('utf8'); const n = this.put(R.name, p, text, body.message);
      return reply(f ? 200 : 201, { content: { name: path.basename(p), path: p, sha: n.sha }, commit: { message: body.message } });
    }
    if (m === 'DELETE') {
      if (!f) return reply(404, { message: 'Not Found' });
      if (body.sha !== f.sha) return reply(409, { message: p + ' does not match ' + body.sha });
      delete R.files[p]; return reply(200, { commit: { message: body.message } });
    }
    return reply(404, { message: 'Not Found' });
  }
}

// 靜態伺服器（no-store，避免快取影響）
function serve(root, port) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  const srv = http.createServer((q, s) => {
    let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p); if (!f.startsWith(root)) { s.writeHead(403); return s.end(); }
    fs.readFile(f, (e, d) => { if (e) { s.writeHead(404, { 'content-type': 'text/plain' }); return s.end('404'); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); s.end(d); });
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}

// ---- Node 端密碼學（和網站相同的演算法，用來獨立驗算與製作申請）----
const pb = (pw, saltB64) => crypto.pbkdf2Sync(Buffer.from(pw.normalize('NFKC')), unb(saltB64), ITER, 32, 'sha256');
const gcmEnc = (key, data) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]); return { iv: b64(iv), ct: b64(ct) }; };
const gcmDec = (key, ivB64, ctB64) => { const ct = unb(ctB64), d = crypto.createDecipheriv('aes-256-gcm', key, unb(ivB64)); d.setAuthTag(ct.subarray(ct.length - 16)); return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]); };
const rsaEnc = (pubB64, data) => b64(crypto.publicEncrypt({ key: crypto.createPublicKey({ key: unb(pubB64), format: 'der', type: 'spki' }), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, data));
const fidOf = user => crypto.createHash('sha256').update('bnasdaq-pwreq-file-v1|' + user.toLowerCase()).digest('hex').slice(0, 40);
const CK = unb(SEC.ck);
// 檢查某組密碼能不能用某筆帳號紀錄登入（雜湊相符、解得出同一把主金鑰）
function canLogin(rec, pw) { try { if (b64(pb(pw, rec.auth.salt)) !== rec.auth.hash) return false; return gcmDec(pb(pw, rec.wrap.salt), rec.wrap.iv, rec.wrap.ct).equals(CK); } catch (e) { return false; } }
// 製作一份申請（o 可以覆寫任何一段，用來做偽造、過期、弱密碼等案例）
function makeReq(db, user, curPw, newPw, o) {
  o = o || {}; const a = db.accounts.find(x => x.user === user), view = o.view || db.view;
  const sa = crypto.randomBytes(16), sw = crypto.randomBytes(16), ck = o.ck || CK;
  const rec = { auth: { salt: b64(sa), iter: ITER, hash: b64(pb(newPw, b64(sa))) }, wrap: Object.assign({ salt: b64(sw), iter: ITER }, gcmEnc(pb(newPw, b64(sw)), ck)), pv: rsaEnc(view.pub, Buffer.from(o.pvPw || newPw)) };
  if (o.rec) o.rec(rec);
  const q = Object.assign({ v: 1, user, proof: b64(o.proof || pb(curPw, a.wrap.salt)), salt: a.auth.salt, rec, at: new Date().toISOString() }, o.q || {});
  const k = crypto.randomBytes(32), e = gcmEnc(k, Buffer.from(JSON.stringify(q)));
  return JSON.stringify({ schema: 'bnasdaq-pwreq/1', at: q.at, ek: rsaEnc(view.pub, Buffer.from(b64(k))), iv: e.iv, ct: e.ct });
}

async function boot(opt) {
  opt = opt || {};
  const gh = new FakeGH();
  gh.add(MAIN, { write: [SEC.pat] }); gh.add(PRIV, { private: true, write: [SEC.sync] });
  gh.put(MAIN, 'data/accounts.json', fs.readFileSync(T + '/accounts.json', 'utf8'));
  gh.put(PRIV, 'v1/README.md', '# sync\n');
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  async function ctx(o) {
    const c = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' }, o || {}));
    await c.route('**/*', route => { const u = route.request().url(); if (u.startsWith(BASE)) return route.continue(); if (u.startsWith('https://api.github.com/')) return gh.handle(route); return route.abort(); });
    return c;
  }
  async function page(c, tag) {
    const p = await c.newPage();
    p.on('pageerror', e => errors.push({ tag, type: 'pageerror', text: e.message }));
    p.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push({ tag, type: 'console', text: m.text() }); });
    p.on('dialog', d => { (p._dialogs = p._dialogs || []).push(d.message()); d.accept().catch(() => { }); });
    return p;
  }
  async function login(p, user, pw, expectFail) {
    await p.goto(BASE + 'login.html'); await p.fill('#u', user); await p.fill('#p', pw); await p.click('#go');
    if (expectFail) { await p.waitForSelector('#m .msg.err'); return (await p.textContent('#m .msg.err')).trim(); }
    await p.waitForURL(/(member|admin)\.html/); return p.url();
  }
  return { gh, browser, ctx, page, login, errors, close: () => browser.close() };
}
const results = [];
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra }); console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond || extra == null ? '' : '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)))); }
function summary() { const bad = results.filter(r => !r.ok); console.log('\n合計 ' + results.length + ' 項，通過 ' + (results.length - bad.length) + '，失敗 ' + bad.length); if (bad.length) bad.forEach(b => console.log('  FAIL', b.name, b.extra == null ? '' : JSON.stringify(b.extra))); return bad.length; }
module.exports = { boot, serve, FakeGH, SEC, MAIN, PRIV, BASE, SITE, PORT, T, SHOTS, b64, unb, pb, gcmEnc, gcmDec, rsaEnc, fidOf, CK, canLogin, makeReq, check, summary, results, ITER };
