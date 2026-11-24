// 圖表名稱檢查（2026-11-24）：每一張「兩條以上序列」的圖都必須看得到名稱（圖例，或線尾／右欄名稱）。
// 起因：首頁「定期定額」「個股對比」兩張卡片的線加到 7、8 條後，超過 charts.js 直接標名稱的 6 條上限，名稱整個不見，又沒放圖例。
// 用法：node scripts/tests/chart_names/check.js      （自己開本機伺服器，不需要先開；BN_PLAYWRIGHT＝Playwright 模組路徑、BN_CHROME＝本機 Chrome）
// 內容：【1】全站稽核 【2】首頁兩張卡片的右欄名稱（名稱↔顏色↔線尾、不重疊、不出界） 【3】動態走勢播放中與播完 【4】charts.js 的保底與邊界情況
const { chromium } = require(process.env.BN_PLAYWRIGHT || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const serve = () => new Promise(res => { const s = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT)) { r.writeHead(403); return r.end(); } fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end('404'); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(d); }); }).listen(0, '127.0.0.1', () => res(s)); });
const PUBLIC = ['index', 'about', 'daily', 'research', 'dca', 'taiwan', 'valuation', 'lookthrough', 'calculator', 'explore', 'risk', 'faq', 'data', 'news', 'plans', 'search', '404'];
// 顏色變數 → 應該對到的名稱（26113 沒登入時顯示「會員專屬」）
const EXPECT = { '--s-fund': ['BNASDAQ-26110'], '--s-sat': ['BNASDAQ-26111'], '--s-sat2': ['BNASDAQ-26112'], '--s-sat3': ['BNASDAQ-26113', '會員專屬'], '--s-qld': ['QLD'], '--s-qqq': ['QQQ'], '--s-save': ['本金'], '--s-tsmc': ['台積電'], '--s-tw': ['0050'] };
// 接在 charts.js 尾端的記錄器：每次畫圖記下序列數與畫面上實際出現的名稱數
const TAIL = `;(function(){ window.__calls = window.__calls || []; var c = window.BN && BN.charts; if (!c) return;
  ['line','bars','hbars','hist','ring'].forEach(function(k){ var f = c[k]; if (typeof f !== 'function' || f.__w) return;
    var g = function(host, o){ var svg = f.apply(this, arguments); try {
      var n = o && o.series ? o.series.length : 0, s = host && host.querySelector ? host.querySelector('svg') : null;
      window.__calls.push({ kind: k, id: (host && host.id) || '(無 id)', title: (o && o.title) || '', n: n,
        legend: host && host.querySelectorAll ? host.querySelectorAll('.legend > span').length : 0,
        endNames: s ? s.querySelectorAll('g.viz-endnames text').length : 0, endVals: s ? s.querySelectorAll('g.viz-endvals text').length : 0,
        direct: s ? Array.prototype.filter.call(s.children, function(e){ return e.tagName === 'text' && e.getAttribute('class') === 'viz-txt'; }).length : 0 });
    } catch (e) {} return svg; }; g.__w = 1; c[k] = g; }); })();`;

// 一張用 endNames 的圖：名稱、圓點、引線、線尾互相對得上，且不重疊、不出界
const checkCard = (page, id) => page.evaluate(({ id, EXPECT }) => {
  const h = document.getElementById(id), svg = h.querySelector('svg'), vb = svg.viewBox.baseVal, P = [], W = vb.width, H = vb.height;
  const g = svg.querySelector('g.viz-endnames'); if (!g) return ['沒有右欄名稱'];
  const key = s => (String(s).match(/--s-[a-z0-9]+/) || [String(s)])[0];
  const pts = d => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(m => [+m[1], +m[2]]);
  const series = [...svg.children].filter(e => e.tagName === 'path' && e.getAttribute('fill') === 'none').map(p => { const q = pts(p.getAttribute('d')); return { c: key(p.getAttribute('stroke')), end: q[q.length - 1] }; }).filter(s => s.end);
  const leaders = [...g.querySelectorAll('path')].map(p => { const q = pts(p.getAttribute('d')); return { c: key(p.getAttribute('stroke')), a: q[0], b: q[q.length - 1] }; });
  const dots = [...g.querySelectorAll('circle')].map(c => ({ c: key(c.getAttribute('fill')), x: +c.getAttribute('cx'), y: +c.getAttribute('cy') }));
  const texts = [...g.querySelectorAll('text')].map(t => { const b = t.getBBox(); return { t: t.textContent, x: +t.getAttribute('x'), y: +t.getAttribute('y'), bb: [b.x, b.y, b.x + b.width, b.y + b.height], fs: parseFloat(getComputedStyle(t).fontSize) }; });
  if (series.length !== leaders.length || leaders.length !== dots.length || dots.length !== texts.length) P.push(`數量不一致：線 ${series.length}、引線 ${leaders.length}、圓點 ${dots.length}、名稱 ${texts.length}`);
  leaders.forEach((l, i) => {
    const s = series.find(s => s.c === l.c), d = dots[i]; if (!s) return P.push('引線找不到同色的線：' + l.c); if (!d || d.c !== l.c) return P.push('圓點顏色和引線不同：' + l.c);
    const t = texts.slice().sort((p, q) => Math.abs(p.y - (d.y + p.fs * .35)) - Math.abs(q.y - (d.y + q.fs * .35)))[0];
    if (Math.abs(l.a[0] - (s.end[0] + 2)) > .21 || Math.abs(l.a[1] - s.end[1]) > .11) P.push('引線起點沒有接在線尾：' + l.c);
    if (Math.abs(l.b[0] - d.x) > .11 || Math.abs(l.b[1] - d.y) > .11) P.push('引線終點沒有接到圓點：' + l.c);
    if (!t || Math.abs(t.y - (d.y + t.fs * .35)) > .11 || Math.abs(t.x - (d.x + 6)) > .01) return P.push('圓點右邊沒有對齊的名稱：' + l.c);
    if (!(EXPECT[l.c] || []).includes(t.t)) P.push(`名稱和顏色對不上：${l.c} → ${t.t}`);
  });
  const ends = Object.fromEntries(series.map(s => [s.c, s.end[1]])), lab = dots.slice().sort((a, b) => a.y - b.y);
  for (let i = 1; i < lab.length; i++) if (ends[lab[i].c] < ends[lab[i - 1].c] - .05) P.push(`名稱上下順序和線尾高低不一致：${lab[i - 1].c}／${lab[i].c}`);
  const T = texts.slice().sort((a, b) => a.y - b.y);
  for (let i = 1; i < T.length; i++) if (T[i].y - T[i - 1].y < T[i].fs - .01) P.push(`名稱重疊：${T[i - 1].t}／${T[i].t}`);
  T.forEach(t => { if (t.bb[2] > W - .5) P.push(`名稱超出右邊：${t.t}（${t.bb[2].toFixed(1)}／${W}）`); if (t.bb[1] < 0 || t.bb[3] > H) P.push('名稱超出上下：' + t.t); });
  const ticks = [...svg.querySelectorAll('text.viz-lbl')].map(t => { const b = t.getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height, t.textContent]; });
  T.forEach(t => ticks.forEach(k => { if (t.bb[0] < k[2] && k[0] < t.bb[2] && t.bb[1] < k[3] && k[1] < t.bb[3]) P.push(`名稱壓到刻度文字：${t.t}／${k[4]}`); }));
  return P;
}, { id, EXPECT });

(async () => {
  const srv = await serve(), BASE = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch(process.env.BN_CHROME ? { executablePath: process.env.BN_CHROME, args: ['--no-sandbox'] } : {});
  const fake = who => { try { if (who === 'admin') sessionStorage.setItem('bn-session', JSON.stringify({ user: 'test', role: 'admin' })); } catch (e) { } };   // 只影響名稱顯示（BN.canSee），不是真的登入
  let fail = 0; const bad = m => { fail++; console.log('  ✗ ' + m); };

  // 【1】全站稽核
  { let n = 0, before = fail;
    for (const who of ['guest', 'admin']) for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: vp }); await ctx.addInitScript(fake, who);
      await ctx.route('**/assets/charts.js*', async route => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()) + TAIL }); });
      for (const pg of PUBLIC) {
        if (who === 'admin' && pg === 'daily') continue;   // 每日市場分析在登入狀態會走真正的會員流程（假的登入旗標會被導走）；這頁的圖也不是 BN.charts 畫的
        const p = await ctx.newPage();   // 每頁用新分頁：上一頁還沒結束的導頁不會打斷下一頁
        try {
          await p.goto(BASE + pg + '.html', { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(2500);
          for (const t of await p.$$('[data-tab]')) { await t.click({ timeout: 1500 }).catch(() => { }); await p.waitForTimeout(100); }
          for (const ym of ['1986-09', '2013-12', '2000-05']) { const bt = await p.$$('.bt-pre [data-ym="' + ym + '"]'); for (const x of bt) await x.click({ timeout: 1500 }).catch(() => { }); if (bt.length) await p.waitForTimeout(500); }
          const last = new Map(); (await p.evaluate(() => window.__calls || [])).forEach(c => last.set(c.kind + '|' + c.id, c));
          for (const c of last.values()) { n++; if ((c.kind === 'line' || c.kind === 'bars') && c.n > 1 && !(c.legend >= c.n || c.endNames >= c.n || c.endVals >= c.n || c.direct >= c.n)) bad(`${pg}.html #${c.id}（${who}／${vp.width}）：${c.n} 條序列卻沒有名稱 ${c.title}`); }
        } catch (e) { bad(`${pg}.html（${who}／${vp.width}）讀取失敗：${String(e.message).split('\n')[0].slice(0, 80)}`); }
        await p.close().catch(() => { });
      }
      await ctx.close();
    }
    console.log(`【1】全站稽核：${n} 張圖（${PUBLIC.length} 個公開頁 × 訪客／登入 × 桌機／手機）${fail === before ? ' ✓ 每張多序列圖都有名稱' : ''}`);
  }

  // 【2】首頁兩張卡片
  { let n = 0, before = fail;
    for (const theme of ['dark', 'light']) for (const width of [1440, 1024, 820, 390, 360]) for (const who of ['guest', 'admin']) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } }); await ctx.addInitScript(fake, who); await ctx.addInitScript(t => { try { localStorage.setItem('bn-theme', t); } catch (e) { } }, theme);
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.goto(BASE + 'index.html', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#f-dca svg'); await p.waitForSelector('#f-tw svg'); await p.waitForTimeout(1200);
      const starts = theme === 'dark' && (width === 1440 || width === 390) ? ['', '1986-09', '1996-09', '2009-01', '2013-12', '2020-12', '2000-05'] : [''];
      for (const ym of starts) {
        if (ym) { const b = await p.$('.bt-pre [data-ym="' + ym + '"]'); if (!b) continue; await b.click(); await p.waitForTimeout(700); }
        for (const id of ['f-dca', 'f-tw']) { n++; (await checkCard(p, id)).forEach(m => bad(`${id}（${theme}／${width}／${who}／起點 ${ym || '預設'}）：${m}`)); }
      }
      errs.forEach(e => bad(`首頁程式錯誤（${theme}／${width}／${who}）：${e}`));
      await ctx.close();
    }
    console.log(`【2】首頁兩張卡片：${n} 次檢查（深色／淺色 × 5 種寬度 × 訪客／登入 × 各回測起點）${fail === before ? ' ✓' : ''}`);
  }

  // 【3】動態走勢
  { let before = fail;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + 'index.html', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#f-dca svg'); await p.waitForSelector('#f-tw svg'); await p.waitForTimeout(1200);
    for (const id of ['f-dca', 'f-tw']) {
      const len0 = await p.evaluate(id => document.querySelector('#' + id + ' svg').outerHTML.length, id);
      await (await p.$('#' + id)).scrollIntoViewIfNeeded(); await p.click('#' + id + ' .fig-play');
      for (let k = 0; k < 4; k++) { await p.waitForTimeout(k ? 3500 : 600); const st = await p.evaluate(id => ({ btn: document.querySelector('#' + id + ' .fig-play').textContent, dash: (document.querySelector('#' + id + ' g.viz-endnames path') || { getAttribute() { } }).getAttribute('stroke-dasharray') }), id);
        if (st.btn === '暫停' && st.dash !== '2 4') bad(`${id} 播放中引線不是淡虛線`); (await checkCard(p, id)).forEach(m => bad(`${id} 播放中（第 ${k + 1} 次取樣）：${m}`)); }
      await p.waitForFunction(id => document.querySelector('#' + id + ' .fig-play').textContent === '動態走勢', id, { timeout: 40000 });
      const len1 = await p.evaluate(id => document.querySelector('#' + id + ' svg').outerHTML.length, id); if (len1 !== len0) bad(`${id} 播完沒有回到原圖`);
      (await checkCard(p, id)).forEach(m => bad(`${id} 播完：${m}`));
    }
    errs.forEach(e => bad('播放時程式錯誤：' + e)); await ctx.close();
    console.log(`【3】動態走勢：兩張卡片播放中各取樣 4 次＋播完回到原圖${fail === before ? ' ✓' : ''}`);
  }

  // 【4】charts.js 的保底與邊界情況
  { let before = fail;
    const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
    await p.goto(BASE + 'index.html', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#f-tw svg'); await p.waitForTimeout(800);
    const r = await p.evaluate(() => {
      const out = [], host = document.createElement('div'); host.className = 'feature'; const inner = document.createElement('div'); inner.className = 'fig'; inner.style.width = '600px'; host.appendChild(inner); document.body.appendChild(host);
      const x = Array.from({ length: 40 }, (_, i) => String(2000 + Math.floor(i / 12)) + '-' + String(i % 12 + 1).padStart(2, '0'));
      const mk = (n, f) => Array.from({ length: n }, (_, k) => ({ name: 'BNASDAQ-2611' + k, values: x.map((_, i) => f ? f(k, i) : 100 * Math.pow(1 + .01 * (k + 1), i)), color: 'var(--s-fund)' }));
      const draw = o => { inner.innerHTML = ''; BN.charts.line(inner, Object.assign({ W: 396, height: 229, padL: 66, x, log: true }, o)); const svg = inner.querySelector('svg'); return { legend: inner.querySelectorAll('.legend > span').length, direct: [...svg.children].filter(e => e.tagName === 'text' && e.getAttribute('class') === 'viz-txt').length, names: [...svg.querySelectorAll('g.viz-endnames text')] }; };
      const ok = (name, cond) => { if (!cond) out.push(name); }; let d;
      d = draw({ series: mk(7), noLegend: true }); ok('保底：7 條＋noLegend、沒有 endNames 時要自動補圖例', d.legend === 7);
      d = draw({ series: mk(3), noLegend: true }); ok('3 條＋noLegend：維持線尾直接標名稱、不補圖例', d.legend === 0 && d.direct === 3);
      d = draw({ series: mk(3), noLegend: true, noEndLabels: true }); ok('保底：noLegend＋noEndLabels 時要自動補圖例', d.legend === 3);
      d = draw({ series: mk(1), noLegend: true, noEndLabels: true }); ok('單一序列不補圖例', d.legend === 0);
      d = draw({ series: mk(8), noLegend: true, endNames: true, padR: 132 }); ok('endNames：8 條都有名稱、不另外放圖例', d.names.length === 8 && d.legend === 0);
      d = draw({ series: mk(8), noLegend: true, endNames: true, padR: 70 }); ok('欄寬不夠時縮小字級、不超出圖框', Math.max(...d.names.map(t => { const b = t.getBBox(); return b.x + b.width; })) <= 396 - 1.5);
      d = draw({ series: mk(14), noLegend: true, endNames: true, padR: 132 }); { const ys = d.names.map(t => +t.getAttribute('y')).sort((a, b) => a - b); ok('14 條：全部排進繪圖區、不交錯', d.names.length === 14 && ys[0] >= 14 && ys[13] <= 229 - 34 + 6 && Math.min(...ys.slice(1).map((y, i) => y - ys[i])) > 9); }
      d = draw({ series: mk(7, () => 100), noLegend: true, endNames: true, padR: 132, yMin: 50, yMax: 200 }); { const ys = d.names.map(t => +t.getAttribute('y')).sort((a, b) => a - b); ok('線尾完全重疊時以線尾為中心上下排開', Math.min(...ys.slice(1).map((y, i) => y - ys[i])) > 14 && Math.abs((ys[0] + ys[6]) / 2 - ys[3]) < .2); }
      d = draw({ series: mk(4).concat([{ name: '空的', values: x.map(() => null), color: 'var(--s-qqq)' }]), noLegend: true, endNames: true, padR: 132 }); ok('整條沒有值的序列不標名稱', d.names.length === 4);
      host.remove(); return out;
    });
    r.forEach(m => bad('charts.js：' + m));
    console.log(`【4】charts.js 保底與邊界情況：9 項${fail === before ? ' ✓' : ''}`);
  }

  await browser.close(); srv.close();
  console.log(fail ? `\n✗ ${fail} 個問題` : '\n✓ 全部通過'); process.exit(fail ? 1 : 0);
})();
