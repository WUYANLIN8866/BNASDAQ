// 同步首頁的靜態備用數字（第一次畫面就是最新值；頁面載入後仍以 bt.js 即時計算為準）：頂部兩個策略的定期定額、資料終點、配置調整次數
// 用法：node scripts/bt_live/patch_home.js
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), A = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ctx = { console, URL, URLSearchParams, location: { search: '', href: 'http://x/index.html' }, history: { replaceState() { } }, document: { dispatchEvent() { }, getElementById() { return null; }, addEventListener() { } } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['assets/data.js', 'assets/bt.js', 'assets/bt-sat.js', 'assets/bt-sat30.js']) vm.runInContext(A(f), ctx);
ctx.BT_LIVE = true; vm.runInContext(A('assets/period.js'), ctx);
const B = ctx.BN.bt, END = B.END, e = END.slice(0, 7), t = +e.slice(0, 4) * 12 + +e.slice(5, 7) - 1 - 360;
const s = Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'), D = B.dca('fund', s), sw = (B.T.sw || {}).fund;
const nf = x => x.toLocaleString('zh-Hant-TW');
const big = (D.end / 1e8).toFixed(1) + ' 億', sub = 'IRR 年化 ' + (D.irr * 100).toFixed(1) + '%｜本金 ' + nf(D.principal / 1e4) + ' 萬｜本金的 ' + nf(Math.round(D.mult)) + ' 倍';
let h = A('index.html'); const h0 = h;
const set = (re, val, all) => { const n = (h.match(new RegExp(re.source, 'g')) || []).length; if (!n || (!all && n !== 1)) throw new Error('找不到 ' + re); h = h.replace(new RegExp(re.source, all ? 'g' : ''), '$1' + val + '$2'); };
set(/(id="hero-big">)[^<]*(<)/, big); set(/(id="hero-sub">)[^<]*(<)/, sub); set(/(id="hero-end">)[^<]*(<)/, END); set(/(id="bt-end">)[^<]*(<)/, END); set(/(data-k="end">)[^<]*(<)/, END, true);
if (sw) { set(/(id="ind-sw">)[^<]*(<)/, sw[0] + ' 次'); set(/(id="ind-sw-s">)[^<]*(<)/, '平均每年 ' + (sw[0] / B.yrs('2000-05-31', END)).toFixed(2) + ' 次；' + sw[1] + ' 次全進全出、' + (sw[0] - sw[1]) + ' 次半倉進出（涉及逐月持倉，不隨起點重算）'); }
// BNASDAQ-26111：和 BNASDAQ-26110 同一個 30 年起點的定期定額（2000-03 前接 bt-sat30.js 延伸前段）與配置調整次數
const D2 = B.dca('sat30', s), sw2 = (B.T.sw || {}).sat;
set(/(id="hero-big2">)[^<]*(<)/, (D2.end / 1e8).toFixed(1) + ' 億');
set(/(id="hero-sub2">)[^<]*(<)/, 'IRR 年化 ' + (D2.irr * 100).toFixed(1) + '%｜本金 ' + nf(D2.principal / 1e4) + ' 萬｜本金的 ' + nf(Math.round(D2.mult)) + ' 倍');
if (sw2) { set(/(id="ind-sw2">)[^<]*(<)/, sw2[0] + ' 次'); set(/(id="ind-sw2-s">)[^<]*(<)/, 'BNASDAQ-26111 平均每年 ' + (sw2[0] / B.yrs('2000-05-31', END)).toFixed(2) + ' 次，皆為全進全出（不設半倉）'); }
if (h !== h0) fs.writeFileSync(path.join(ROOT, 'index.html'), h);
console.log('首頁靜態數字：終點 ' + END + '｜' + big + '｜' + sub + (h !== h0 ? '（已更新）' : '（不需更新）'));
