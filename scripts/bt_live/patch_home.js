// 同步首頁的靜態備用數字（第一次畫面就是最新值；頁面載入後仍以 bt.js 即時計算為準）：頂部四個策略的定期定額、資料終點、配置調整次數
// 2026-11-24 首頁上半部改成方案 D：多了「只存不投資／改放 QQQ／四個模型的區間與最低倍數」幾個靜態欄位，一併同步
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
// 2026-11-26 站主圈改：首頁金框拿掉「年化／回撤／本金倍數」一欄（hero-irr、hero-mult、hero-mdd 已不在頁面上），每個模型只同步期末價值；
// BNASDAQ-26113（第 4 張卡）的期末價值不公開：靜態值固定寫「會員專屬」（原為 ????，同日 10:57 站主改），開通這個模型的會員與管理員由首頁程式填入數字（index.html 的 BN.canSee）
const MOV = k => k === '4';
const HF = (k, X) => { set(new RegExp('(id="hero-big' + k + '">)[^<]*(<)'), MOV(k) ? '會員專屬' : (X.end / 1e8).toFixed(1)); };
HF('', D); set(/(id="hero-save">)[^<]*(<)/, nf(D.principal / 1e4));
// 改放 QQQ（同一筆定期定額放 QQQ 長抱）：金額不到 1 億用「萬」，否則用「億」；倍數不到 100 取一位小數（和首頁程式同一套寫法）
const Q = B.dca('qqq', s), MX = X => { const v = X.end / X.principal; return (v >= 100 ? nf(Math.round(v)) : v.toFixed(1)) + ' 倍'; }, qa = Q.end >= 1e8 ? [(Q.end / 1e8).toFixed(2), '億'] : [nf(Math.round(Q.end / 1e4)), '萬'];
set(/(id="hero-qqq">)[^<]*(<)/, qa[0]); set(/(id="hero-qqq-u">)[^<]*(<)/, qa[1]); set(/(id="hero-qmult">)[^<]*(<)/, MX(Q)); set(/(id="hero-qirr">)[^<]*(<)/, (Q.irr * 100).toFixed(1) + '%'); set(/(id="bt-end">)[^<]*(<)/, END); set(/(data-k="end">)[^<]*(<)/, END, true);
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
// 2026-11-26 站主圈改：首頁「主要指標」旗艦模型這一欄與小字說明不公開，靜態值固定寫「會員專屬」、說明留空（開通的會員由首頁程式填入）
if (sw4) { set(/(id="ind-sw4">)[^<]*(<)/, '會員專屬'); set(/(id="ind-sw4-s">)[\s\S]*?(<\/small>)/, ''); }
// 四個模型的區間：期末價值最小～最大；「倍起」＝最小的本金倍數
const ES = [D, D2, D3, D4].sort((p, q) => p.end - q.end);
set(/(id="hero-lo">)[^<]*(<)/, (ES[0].end / 1e8).toFixed(1)); set(/(id="hero-hi">)[^<]*(<)/, (Math.max(D.end, D2.end, D3.end) / 1e8).toFixed(1));   // 2026-11-26 站主：區間上限＝不含旗艦模型（D4）的最高期末價值（開通旗艦模型的會員由首頁程式改成含旗艦的最高值） set(/(id="hero-lomult">)[^<]*(<)/, MX(ES[0]));
if (h !== h0) fs.writeFileSync(path.join(ROOT, 'index.html'), h);
console.log('首頁靜態數字：終點 ' + END + '｜' + big + '｜' + sub + (h !== h0 ? '（已更新）' : '（不需更新）'));
