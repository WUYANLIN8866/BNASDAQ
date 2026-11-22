// 收集網站各頁「實際畫在畫面上」的字，依字型與字重分組，寫到 scripts/fonts/observed.json，給 build_fonts.py 產生精簡字型用。
// 用法：先在網站根目錄開本機伺服器（例：python3 -m http.server 8765），再執行 node scripts/fonts/collect_chars.js http://127.0.0.1:8765/
// 每頁都會：桌機與手機寬度各看一次、點過每個回測起點與分頁、展開所有 <details>。
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const PAGES = ['index', 'about', 'daily', 'research', 'dca', 'taiwan', 'valuation', 'lookthrough', 'calculator', 'explore', 'risk', 'faq', 'data', 'news', 'plans', 'search', 'login', 'member', 'admin', '404'];
(async () => {
  const b = await chromium.launch(); const sets = {};
  const merge = o => { for (const [k, v] of Object.entries(o)) { sets[k] = sets[k] || new Set(); for (const ch of v) sets[k].add(ch); } };
  for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
    const grab = () => p.evaluate(() => {
      const out = {};
      const face = (el, ps) => { const cs = getComputedStyle(el, ps); const fam = cs.fontFamily.toLowerCase(); const w = parseInt(cs.fontWeight, 10) || 400;
        if (/^"?(bn serif|noto serif tc)/.test(fam)) return 'serif' + (w > 600 ? 700 : 600);
        if (/^"?(bn sans|noto sans tc)/.test(fam)) return 'sans' + (w > 500 ? 700 : w > 400 ? 500 : 400);
        return 'other'; };
      const add = (k, s) => { if (s) out[k] = (out[k] || '') + s; };
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = tw.nextNode())) { const el = n.parentElement; if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue; add(face(el), n.nodeValue); }
      document.querySelectorAll('input,textarea').forEach(el => { add(face(el), el.placeholder); add(face(el), el.value); });
      document.querySelectorAll('body *').forEach(el => { for (const ps of ['::before', '::after']) { const c = getComputedStyle(el, ps).content; if (c && /^".*"$/.test(c)) add(face(el, ps), c.slice(1, -1)); } });
      return out;
    });
    for (const pg of PAGES) {
      await p.goto(BASE + pg + '.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(400); merge(await grab());
      for (const ym of ['1986-09', '1996-09', '2009-01', '2013-12', '2016-09', '2020-12', '2021-09', '2000-05']) { const bt = await p.$$('.bt-pre [data-ym="' + ym + '"]'); for (const x of bt) await x.click().catch(() => { }); if (bt.length) { await p.waitForTimeout(250); merge(await grab()); } }
      for (const t of await p.$$('[data-tab]')) { await t.click().catch(() => { }); await p.waitForTimeout(120); merge(await grab()); }
      await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); merge(await grab());
    }
    await ctx.close();
  }
  await b.close();
  // 搜尋結果以粗體（sans700）顯示段落標題，任何段落都可能出現：把搜尋索引裡全部的段落標題補進 sans700
  try { const w = {}; new Function('window', fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'search-index.js'), 'utf8'))(w); merge({ sans700: w.SEARCH_INDEX.map(e => e.title).join('') }); }
  catch (e) { console.log('（略過搜尋索引：' + e.message + '）'); }
  // 互動後才出現、爬頁時看不到的字（2026-11-21 首頁「動態走勢」：按鈕的暫停／繼續播放、播放時的當月持有列；持有文字只有會員看得到）
  merge({ sans400: '動態走勢暫停繼續播放當月持有起點尚無訊號各半會員專屬', sans500: '動態走勢暫停繼續播放', sans700: '動態走勢暫停繼續播放當月持有起點尚無訊號各半會員專屬QLDSHV%0123456789—' });
  // 每日市場分析「模型影響」（2026-11-22；assets/daily-models.js）：登入後才出現的字（會員的一句說明與四個步驟；管理員專區的標題與欄名）
  merge({ sans400: '模型影響四大模型能力已可自動處理此訊息造成的影響本頁每一則消息後面都標示不需要人工解讀在每月最後個交易日收盤後完成判斷次開盤執行其餘操作怎麼步驟國際大事與企業新聞各目前持有下機率請看會員專區管理員判斷條件主題直接對應沒有只經價格數據關鍵字比對可能準合計推算翻轉位距最新',
    sans500: '模型怎麼處理消息四個步驟', sans700: '模型影響消息發生自動處理月底判斷次日開盤執行判斷條件管理員直接對應成立不數據價格只經', serif600: '消息對模型的影響管理員專區四大判斷條件1234' });
  // 模型權限（2026-11-22；管理後台 admin.html 的「模型權限」、會員專區與每日市場分析依帳號開通的模型顯示）：登入後才出現的字
  merge({ sans400: '這個帳號已開通其他模型的開通方式請見會員方案或聯絡管理員目前沒有開通任何模型需要所以不計算和策略目標的差額暫時無法確認稍後重新整理兩大三大模型尚未開通'
      + '勾選登入後看得到該模型的本月持有下月持有機率翻轉價位策略差額以及每日市場分析的模型影響新帳號和還沒設定過的帳號預設只開通管理員固定可以看全部儲存後立即生效會員重新整理頁面就會套用'
      + '這裡設定的是顯示權限公開頁面上對所有訪客公開的回測不受影響已停用尚未儲存還原成上次儲存的設定沒有存成功維持原狀勾選的內容還在可以再按一次讀不到模型清單可以看的模型',
    sans500: '儲存模型權限個帳號有變更還原', sans700: '儲存模型權限個帳號有變更還原尚未儲存模型權限', serif600: '模型權限每個帳號可以看到哪些模型（）' });
  const res = {}; for (const [k, s] of Object.entries(sets)) if (k !== 'other') res[k] = [...s].filter(c => c.codePointAt(0) > 32).sort().join('');
  const out = path.join(__dirname, 'observed.json'); fs.writeFileSync(out, JSON.stringify(res, null, 1));
  for (const [k, v] of Object.entries(res)) console.log(k.padEnd(9), '字數', [...v].length);
  console.log('已寫入', out);
})();
