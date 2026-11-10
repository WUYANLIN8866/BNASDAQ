// 站內搜尋索引產生器：以瀏覽器實際渲染的文字（含程式算出的數字）建立 assets/search-index.js。
// 用法：在 repo 根目錄啟動靜態伺服器（python3 -m http.server 8765），再執行
//   node scripts/build_search_index.js [http://127.0.0.1:8765/]
// 每頁一筆頁首（標題＋導言），每個有 id 的 h2 一筆（該段文字，最多 1200 字）。頁面文字有改就重跑。
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const PAGES = ['index', 'about', 'research', 'dca', 'taiwan', 'calculator', 'valuation', 'lookthrough', 'risk', 'news', 'faq', 'data'];
const MAX = 1200;
(async () => {
  const b = await chromium.launch(), out = [];
  for (const pg of PAGES) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + pg + '.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
    if (errs.length) throw new Error(pg + '.html 有錯誤：' + errs.join('；'));
    const rows = await p.evaluate(({ pg, MAX }) => {
      const clean = s => (s || '').replace(/\s+/g, ' ').trim();
      document.querySelectorAll('main details').forEach(d => { d.open = true; });   // 展開「常見問題」等摺疊段落，答案也要能搜尋
      const name = pg === 'index' ? '首頁' : clean(document.title.split('｜')[0]);
      const res = [];
      const head = document.querySelector('.pagehead') || document.querySelector('.hero');
      if (head) res.push({ page: name, title: name, url: pg + '.html', text: clean(head.innerText).slice(0, MAX) });
      document.querySelectorAll('main h2').forEach(h => {
        if (h.closest('aside')) return;
        const sec = h.closest('section'), title = clean(h.innerText);
        if (sec && sec.querySelector('h2') === h) {   // 首頁：每個 section 一筆（隱藏的會員區塊不收）
          if (sec.hidden || sec.closest('[hidden]')) return;
          const id = sec.id || h.id;
          res.push({ page: name, title, url: pg + '.html' + (id ? '#' + id : ''), text: clean(clean(sec.innerText).replace(title, '')).slice(0, MAX) });
          return;
        }
        if (!h.id) return;
        let t = [], n = h.nextElementSibling;
        while (n && n.tagName !== 'H2' && !n.matches('aside')) { if (!n.hidden) t.push(clean(n.innerText)); n = n.nextElementSibling; }
        res.push({ page: name, title, url: pg + '.html#' + h.id, text: t.filter(Boolean).join(' ').slice(0, MAX) });
      });
      return res;
    }, { pg, MAX });
    out.push(...rows); await p.close();
    console.log(pg + '.html：' + rows.length + ' 筆');
  }
  await b.close();
  const f = path.join(__dirname, '..', 'assets', 'search-index.js');
  fs.writeFileSync(f, 'window.SEARCH_INDEX=' + JSON.stringify(out) + ';\n');
  console.log('寫入 assets/search-index.js：' + out.length + ' 筆');
})().catch(e => { console.error(e.message); process.exit(1); });
