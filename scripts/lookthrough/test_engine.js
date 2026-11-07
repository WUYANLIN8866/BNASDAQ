const LT = require(require('path').join(__dirname, '..', '..', 'assets', 'lt-engine.js'));
const assert = require('assert');
const U = new Map(Object.entries({
  QQQ: { n: 'Invesco QQQ', m: 'US', k: 'E', p: 600 }, SPY: { n: 'SPDR S&P 500', m: 'US', k: 'E', p: 650 },
  QLD: { n: 'ProShares Ultra QQQ', m: 'US', k: 'E', p: 120 }, SHV: { n: 'iShares Short Treasury', m: 'US', k: 'E', p: 110 },
  XYZ: { n: 'Unknown ETF', m: 'US', k: 'E', p: 10 }, AAPL: { n: 'Apple', m: 'US', k: 'S', p: 200 }, GOOG: { n: 'Alphabet C', m: 'US', k: 'S', p: 150 },
  GOOGL: { n: 'Alphabet', m: 'US', k: 'S', p: 150 }, TSM: { n: 'TSMC ADR', m: 'US', k: 'S', p: 250 }, '2330': { n: '台積電', m: 'TW', k: 'S', p: 1000 },
  '0050': { n: '元大台灣50', m: 'TW', k: 'E', p: 60 }, PSQ: { n: 'ProShares Short QQQ', m: 'US', k: 'E', p: 30 }
}));
const E = new Map(Object.entries({
  QQQ: { h: [['AAPL', 10, 'Apple', '科技'], ['NVDA', 9, 'NVIDIA', '科技'], ['GOOGL', 3, 'Alphabet A', '通訊服務'], ['GOOG', 2.8, 'Alphabet C', '通訊服務'], ['2330', 0, '台積電', '科技']].filter(x => x[1] > 0), eq: 24.8, asof: '2026-11-05', src: 'Invesco' },
  SPY: { h: [['AAPL', 7, 'Apple', '科技'], ['NVDA', 7.5, 'NVIDIA', '科技'], ['GOOGL', 2, 'Alphabet A', '通訊服務'], ['GOOG', 1.6, 'Alphabet C', '通訊服務']], eq: 18.1, asof: '2026-11-06', src: 'SSGA' },
  QLD: { base: 'QQQ', lev: 2 }, PSQ: { base: 'QQQ', lev: -1 }, SHV: { h: [], eq: 0, asof: '2026-11-06', src: 'iShares' },
  '0050': { h: [['2330', 58.85, '台積電', '科技'], ['2317', 5, '鴻海', '科技']], eq: 63.85, asof: '2026-11-06', src: '元大' }
}));
const alias = { GOOG: 'GOOGL', TSM: '2330' };
const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-9, msg + ': ' + a + ' vs ' + b);
const get = (r, k) => (r.cos.find(c => c.key === k) || { w: 0 }).w;
// 1) 100% QQQ：每家公司＝QQQ 權重；GOOGL＋GOOG 合併
let r = LT.compute([{ code: 'qqq', v: 100 }], { mode: 'pct', U, E, fx: 32, alias });
near(get(r, 'AAPL'), 0.10, '100%QQQ AAPL'); near(get(r, 'GOOGL'), 0.058, 'GOOGL+GOOG 合併'); assert(!r.cos.find(c => c.key === 'GOOG'), 'GOOG 不應單獨出現');
near(r.nonEq, 1 - 0.248, '非股票'); near(r.stockExp + r.nonEq - r.levExtra, 1, '恆等式');
// 2) 50/50 QQQ+SPY：AAPL＝(10+7)/2＝8.5%
r = LT.compute([{ code: 'QQQ', v: 50 }, { code: 'SPY', v: 50 }], { mode: 'pct', U, E, fx: 32, alias });
near(get(r, 'AAPL'), 0.085, '各半 AAPL'); near(r.cos.find(c => c.key === 'AAPL').src.QQQ, 0.05, '來源拆分 QQQ'); near(r.cos.find(c => c.key === 'AAPL').src.SPY, 0.035, '來源拆分 SPY');
const ov = r.overlap[0]; near(ov[2], (7 + 7.5 + 2 + 1.6) / 100, '重疊度＝各家最小權重加總');
// 3) 股數模式：10 股 QQQ（600 美元）＋ 1000 股 0050（60 台幣），匯率 32 → 192000 vs 60000
r = LT.compute([{ code: 'QQQ', v: 10 }, { code: '0050', v: 1000 }], { mode: 'shares', U, E, fx: 32, alias });
near(r.total, 252000, '總市值'); near(r.assets[0].w, 192000 / 252000, 'QQQ 占比'); near(get(r, '2330'), 60000 / 252000 * 0.5885, '台積電');
// 4) QLD＝2 倍 QQQ；槓桿額外曝險＝(2−1)×24.8%
r = LT.compute([{ code: 'QLD', v: 100 }], { mode: 'pct', U, E, fx: 32, alias });
near(get(r, 'AAPL'), 0.20, 'QLD AAPL'); near(r.levExtra, 0.248, '槓桿額外'); near(r.stockExp + r.nonEq - r.levExtra, 1, '恆等式（槓桿）');
// 5) PSQ＝−1 倍：AAPL −10%
r = LT.compute([{ code: 'PSQ', v: 100 }], { mode: 'pct', U, E, fx: 32, alias }); near(get(r, 'AAPL'), -0.10, '反向');
// 6) SHV 全部非股票；未知 ETF 列未拆解；比例不足 100 自動換算
r = LT.compute([{ code: 'SHV', v: 30 }, { code: 'XYZ', v: 10 }, { code: 'AAPL', v: 40 }], { mode: 'pct', U, E, fx: 32, alias });
near(r.nonEq, 30 / 80, 'SHV 非股票'); near(r.undec[0].w, 10 / 80, '未拆解'); near(get(r, 'AAPL'), 40 / 80, '個股'); assert(r.warnings.length === 1, '提示換算');
// 7) 直接輸入 TSM 與 0050：TSM 併入 2330
r = LT.compute([{ code: 'TSM', v: 50 }, { code: '0050', v: 50 }], { mode: 'pct', U, E, fx: 32, alias });
near(get(r, '2330'), 0.5 + 0.5 * 0.5885, 'TSM 併入台積電');
// 8) 錯誤處理：找不到代號、比例 0、無價格
r = LT.compute([{ code: 'NOPE', v: 10 }, { code: 'QQQ', v: 0 }], { mode: 'pct', U, E, fx: 32, alias }); assert(r.errors.length === 2);
r = LT.compute([{ code: 'XYZ', v: 1, px: 0 }], { mode: 'shares', U: new Map([['XYZ', { n: 'x', m: 'US', k: 'E', p: null }]]), E, fx: 32, alias }); assert(r.errors[0].msg.includes('手動輸入價格'));
// 9) 正規化
assert(LT.norm(' brk.b ') === 'BRK-B' && LT.norm('2330.TW') === '2330' && LT.norm('00631l') === '00631L');
// 10) CSV
r = LT.compute([{ code: 'QQQ', v: 60 }, { code: 'SHV', v: 40 }], { mode: 'pct', U, E, fx: 32, alias, total: 1000000 });
const csv = LT.csv(r); assert(csv.startsWith('﻿') && csv.includes('非股票資產') && csv.split('\r\n').length === 1 + r.cos.length + 1);
console.log('計算核心：10 組測試全部通過');
