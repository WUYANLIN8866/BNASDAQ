const fs=require('fs'), ROOT=require('path').resolve(__dirname,'../../..'); global.window={}; new Function('window',fs.readFileSync(ROOT+'/assets/sigpie.js','utf8'))(global.window);
const BN=global.window.BN, cal=JSON.parse(fs.readFileSync(ROOT+'/data/release-calendar.json')), topics=JSON.parse(fs.readFileSync(ROOT+'/data/daily-topics.json')).topics;
const rules={tradingDaysLeft(){throw 0}}, market={asof:'2026-11-25',current:{m:'2026-11',asof:'2026-11-25'}};
const SER='FEDFUNDS TB3MS T1YFFM TB3SMFFM GS1 GS10 AAA AAAFFM EXJPUS TWEXAFEGSMTH MCOILWTICO WPSFD49207 CPILFESL CPILFENS DPCERA3M086SBEA W875RX1 RPI PCEPI CUMFNS INDPRO'.split();
const st=(last_ok,since,x)=>Object.assign({checked:last_ok,last_ok,obs:Object.fromEntries(SER.map(s=>[s,['2026-10',since[s]||since['*']]]))},x||{});
const L16='⑯實質消費成長加速度 在 (-0.5425567%, 1.001528%)', L18='⑱實質所得對 24 個月均值偏離 在 (0.7448696%, 3.135697%)', L17='⑰產能利用率 3 個月變動 > -0.32212', L11='⑪美元指數對 60 個月均值偏離 < 6.795815%';
const run=(nowS,status)=>{const N=BN.sigpie.next(rules,market,{now:Date.parse(nowS),cal,topics,status});return [L16,L18,L17,L11].map(l=>[N.macroOf(l),N.fixedOf(l)?'確定':'',N.pendOf(l)?'未定案':''].join(' | '));};
const eq=(a,b,m)=>{if(JSON.stringify(a)!==JSON.stringify(b)){console.log('FAIL',m,'\n got',a,'\n exp',b);process.exitCode=1;}else console.log('ok  ',m,'→',a[0]);};
// A. 使用者截圖的時刻（台北 23:09＝15:09Z）、舊 status（05:35Z 抓的、沒有 obs）→ 已公布、抓取中、未定案
let r=run('2026-11-25T15:09:00Z',{checked:'2026-11-25T05:35:42Z',last_ok:'2026-11-25T05:35:42Z'});
eq(r.slice(0,2),['台北 11/25（三）21:30 已公布，網站抓取中 |  | 未定案','台北 11/25（三）21:30 已公布，網站抓取中 |  | 未定案'],'A 公布後還沒抓到');
// B. 抓到之後（obs 的時間在公布之後）→ 立刻確定，下次更新＝12/23
r=run('2026-11-25T16:00:00Z',st('2026-11-25T15:50:00Z',{'*':'2026-11-25T15:50:00Z'}));
eq(r,['台北 12/23（三）21:30 | 確定 | ','台北 12/23（三）21:30 | 確定 | ','台北 12/16（三）22:15 | 確定 | ','約 台北 12/2（三）05:15 | 確定 | '],'B 抓到了 → 馬上確定（不必等 3 小時）');
// C. 12 月：12/23 公布前 → 未定案（公布在月底前）；公布後還沒抓到 → 抓取中；抓到 → 確定、下次 1/28
market.asof='2026-12-22';market.current={m:'2026-12',asof:'2026-12-22'};
const dec=st('2026-12-22T23:00:00Z',{'*':'2026-12-17T00:00:00Z','DPCERA3M086SBEA':'2026-11-25T15:50:00Z','W875RX1':'2026-11-25T15:50:00Z','RPI':'2026-11-25T15:50:00Z','PCEPI':'2026-11-25T15:50:00Z'});
r=run('2026-12-23T01:00:00Z',dec); eq([r[0],r[2]],['台北 12/23（三）21:30 |  | 未定案','台北 1/15（五）22:15 | 確定 | '],'C1 公布前');
r=run('2026-12-23T13:40:00Z',dec); eq([r[0]],['台北 12/23（三）21:30 已公布，網站抓取中 |  | 未定案'],'C2 公布後 10 分鐘');
r=run('2026-12-23T19:40:00Z',dec); eq([r[0]],['台北 12/23（三）21:30 已公布，網站抓取中 |  | 未定案'],'C3 過了 6 小時還沒抓到（舊版這時會誤標成確定）');
const got=JSON.parse(JSON.stringify(dec)); got.last_ok=got.checked='2026-12-23T13:52:00Z'; ['DPCERA3M086SBEA','W875RX1','RPI','PCEPI'].forEach(k=>got.obs[k]=['2026-11','2026-12-23T13:52:00Z']);
r=run('2026-12-23T13:55:00Z',got); eq([r[0],r[1]],['台北 1/28（四）21:30 | 確定 | ','台北 1/28（四）21:30 | 確定 | '],'C4 抓到');
// D. 推定時間（美元指數 12/1 約 05:15 台北）：過了推定時間、來源還沒更新 → 等待來源更新、未定案
market.asof='2026-12-01';market.current={m:'2026-12',asof:'2026-12-01'};
r=run('2026-12-02T03:00:00Z',st('2026-12-02T02:50:00Z',{'*':'2026-11-25T15:50:00Z'})); eq([r[3]],['約 台北 12/2（三）05:15，等待來源更新 |  | 未定案'],'D 推定時間已過、來源未更新');
// E. 沒有 status 檔 → 退回時鐘規則（3 小時）
market.asof='2026-11-25';market.current={m:'2026-11',asof:'2026-11-25'};
r=run('2026-11-25T15:09:00Z',null); eq([r[0]],['台北 11/25（三）21:30 已公布，網站抓取中 |  | 未定案'],'E1 無 status、3 小時內');
r=run('2026-11-25T17:09:00Z',null); eq([r[0]],['台北 12/23（三）21:30 | 確定 | '],'E2 無 status、3 小時後');
// F. 月底凍結
r=run('2026-12-24T03:00:00Z',Object.assign({},dec,{frozen:'2026-12'})); eq([r[0]],['台北 12/23（三）21:30 已公布，換月後更新 |  | 未定案'],'F 凍結');
