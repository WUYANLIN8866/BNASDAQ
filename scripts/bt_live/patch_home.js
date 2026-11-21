// 同步首頁的靜態備用數字（第一次畫面就是最新值；頁面載入後仍以 bt.js 即時計算為準）：頂部四個策略的定期定額、資料終點、配置調整次數
// 用法：node scripts/bt_live/patch_home.js
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), A = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ctx = { console, URL, URLSearchParams, location: { search: '', href: 'http://x/index.html' }, history: { replaceState() { } }, document: { dispatchEvent() { }, getElementById() { return null; }, addEventListener() { } } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['assets/data.js', 'assets/bt.js', 'assets/bt-sat.js', 'assets/bt-sat30.js', 'assets/bt-sat2.js', 'assets/bt-sat2-30.js', 'assets/bt-sat3.js', 'assets/bt-sat3-30.js']) vm.runInContext(A(f), ctx);
ctx.BT_LIVE = true; vm.runInContext(A('assets/period.js'), ctx);
const B = ctx.BN.bt, END = B.END, e = END.slice(0, 7), t = +e.slice(0, 4) * 12 + +e.slice(5, 7) - 1 - 360;
const s = Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'), D = B.dca('fund', s), sw = (B.T.sw || {}).fund;
const nf = x => x.toLocaleString('zh-Hant-TW');
const big = (D.end / 1e8).toFixed(1) + ' 億', sub = 'IRR 年化 ' + (D.irr * 100).toFixed(1) + '%｜本金 ' + nf(D.principal / 1e4) + ' 萬｜本金的 ' + nf(Math.round(D.mult)) + ' 倍';
let h = A('index.html'); const h0 = h;
const set = (re, val, all) => { const n = (h.match(new RegExp(re.source, 'g')) || []).length; if (!n || (!all && n !== 1)) throw new Error('找不到 ' + re); h = h.replace(new RegExp(re.source, all ? 'g' : ''), '$1' + val + '$2'); };
const HF = (k, X) => { set(new RegExp('(id="hero-big' + k + '">)[^<]*(<)'), (X.end / 1e8).toFixed(1)); set(new RegExp('(id="hero-irr' + k + '">)[^<]*(<)'), (X.irr * 100).toFixed(1) + '%'); set(new RegExp('(id="hero-mult' + k + '">)[^<]*(<)'), nf(Math.round(X.mult)) + ' 倍'); };
HF('', D); set(/(id="hero-prin">)[^<]*(<)/, nf(D.principal / 1e4) + ' 萬'); set(/(id="hero-end">)[^<]*(<)/, END); set(/(id="bt-end">)[^<]*(<)/, END); set(/(data-k="end">)[^<]*(<)/, END, true);
if (sw) { set(/(id="ind-sw">)[^<]*(<)/, sw[0] + ' 次'); set(/(id="ind-sw-s">)[^<]*(<)/, '平均每年 ' + (sw[0] / B.yrs('2000-05-31', END)).toFixed(2) + ' 次；' + sw[1] + ' 次全進全出、' + (sw[0] - sw[1]) + ' 次半倉進出（涉及逐月持倉，不隨起點重算）'); }
// BNASDAQ-26111：和 BNASDAQ-26110 同一個 30 年起點的定期定額（2000-03 前接 bt-sat30.js 延伸前段）與配置調整次數
const D2 = B.dca('sat30', s), sw2 = (B.T.sw || {}).sat;
HF('2', D2);
if (sw2) { set(/(id="ind-sw2">)[^<]*(<)/, sw2[0] + ' 次'); set(/(id="ind-sw2-s">)[^<]*(<)/, 'BNASDAQ-26111 平均每年 ' + (sw2[0] / B.yrs('2000-05-31', END)).toFixed(2) + ' 次，皆為全進全出（不設半倉）'); }
// BNASDAQ-26112：同一個 30 年起點（2000-03 前接 bt-sat2-30.js 延伸前段）
const D3 = B.dca('sat2_30', s), sw3 = (B.T.sw || {}).sat2;
HF('3', D3);
if (sw3) { set(/(id="ind-sw3">)[^<]*(<)/, sw3[0] + ' 次'); set(/(id="ind-sw3-s">)[^<]*(<)/, 'BNASDAQ-26112 平均每年 ' + (sw3[0] / B.yrs('2000-05-31', END)).toFixed(2) + ' 次，皆為全進全出（不設半倉）'); }
// BNASDAQ-26113：同一個 30 年起點（2000-03 前接 bt-sat3-30.js 延伸前段）
const D4 = B.dca('sat3_30', s), sw4 = (B.T.sw || {}).sat3;
HF('4', D4);
if (sw4) { set(/(id="ind-sw4">)[^<]*(<)/, sw4[0] + ' 次'); set(/(id="ind-sw4-s">)[^<]*(<)/, 'BNASDAQ-26113 平均每年 ' + (sw4[0] / B.yrs('2000-05-31', END)).toFixed(2) + ' 次，皆為全進全出（不設半倉）'); }
if (h !== h0) fs.writeFileSync(path.join(ROOT, 'index.html'), h);
console.log('首頁靜態數字：終點 ' + END + '｜' + big + '｜' + sub + (h !== h0 ? '（已更新）' : '（不需更新）'));
