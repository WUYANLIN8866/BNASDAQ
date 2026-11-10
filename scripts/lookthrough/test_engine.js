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
// 11) 發行商只列出部分持股：沒列出的部分算「未逐一列出的小額持股」，不算非股票
E.set('VXUS', { h: [['2330', 4.24, '台積電', '資訊科技'], ['X:KR7005930003', 2.02, 'Samsung', '資訊科技']], eq: 6.26, partial: 1 });
U.set('VXUS', { n: 'Vanguard Total Intl', m: 'US', k: 'E', p: 70 });
r = LT.compute([{ code: 'VXUS', v: 100 }], { mode: 'pct', U, E, fx: 32, alias });
near(r.unlisted, 1 - 0.0626, '未列出'); near(r.nonEq, 0, '不算非股票'); near(r.stockExp + r.unlisted + r.nonEq - r.levExtra, 1, '恆等式（部分）');
// 12) 現金（比例模式）：QQQ 70%＋現金 30% → AAPL＝0.7×10%；現金 30% 不算任何公司；恆等式含現金
r = LT.compute([{ code: 'QQQ', v: 70 }, { code: '現金', v: 30 }], { mode: 'pct', U, E, fx: 32, alias });
near(get(r, 'AAPL'), 0.07, '含現金 AAPL'); near(r.cash, 0.30, '現金占比'); near(r.cashBy['現金'], 0.30, '台幣現金'); near(r.nonEq, 0.7 * (1 - 0.248), 'ETF 內非股票不含現金');
near(r.stockExp + r.unlisted + r.nonEq + r.cash - r.levExtra, 1, '恆等式（含現金）'); assert(!r.cos.find(c => c.key === '現金'), '現金不應出現在公司明細');
near(LT.summary(r).cash, 0.30, '摘要的現金');
// 13) 現金（股數模式）：台幣現金 100,000 元＋美元現金 1,000 美元（匯率 32）＋10 股 QQQ（600 美元）；手動價格對現金無效
r = LT.compute([{ code: '台幣現金', v: 100000, px: 5 }, { code: '美金', v: 1000 }, { code: 'QQQ', v: 10 }], { mode: 'shares', U, E, fx: 32, alias });
near(r.total, 100000 + 1000 * 32 + 10 * 600 * 32, '總額含現金'); near(r.cashBy['現金'], 100000 / r.total, '台幣現金占比'); near(r.cashBy['美元現金'], 32000 / r.total, '美元現金占比');
assert(r.assets[0].code === '現金' && r.assets[1].code === '美元現金' && r.assets[0].px === 1, '別名對應與價格固定 1');
// 14) 真實代號不被當成現金：USD（ProShares 2 倍半導體）、CASH（Pathward Financial）
const U2 = new Map([...U, ['USD', { n: 'ProShares Ultra Semiconductors', m: 'US', k: 'E', p: 100 }], ['CASH', { n: 'Pathward Financial', m: 'US', k: 'S', p: 70 }]]);
assert(LT.resolve('USD', U2).k === 'E' && LT.resolve('cash', U2).k === 'S' && LT.resolve('現金', U2).k === 'C' && LT.resolve(' 現金 USD ', U2).code === '美元現金', '代號優先、現金別名只用中文組合');
assert(LT.resolve('USD', U) === null, '沒有 USD 代號時也不會變成現金');
// 15) CSV 有現金列；只有現金時沒有公司
r = LT.compute([{ code: '現金', v: 100 }], { mode: 'pct', U, E, fx: 32, alias, total: 500000 });
assert(r.cos.length === 0 && LT.summary(r).n === 0 && LT.csv(r).includes('現金（台幣）（自行輸入）') && LT.csv(r).includes('500000'), '只有現金');
// 16) 美元現金沒有匯率 → 提示
r = LT.compute([{ code: '美元現金', v: 100 }], { mode: 'shares', U, E, fx: 0, alias }); assert(r.errors[0].msg.includes('匯率'), '缺匯率');
// 17) 資產全貌（3D 圓餅）：投入資金計、槓桿不放大、合計 100%
const msum = m => m.slices.reduce((t, x) => t + x.w, 0);
const mget = (m, k) => (m.slices.find(x => x.key === k) || { w: 0 }).w;
let m = LT.mix(LT.compute([{ code: 'QQQ', v: 100 }], { mode: 'pct', U, E, fx: 32, alias }));
near(msum(m), 1, '全貌合計（QQQ）'); near(mget(m, 'AAPL'), 0.10, '全貌 AAPL'); near(mget(m, '_etfcash'), 0.752, 'ETF 內非股票'); near(m.cls.stock, 0.248, '股票類');
m = LT.mix(LT.compute([{ code: 'QLD', v: 100 }], { mode: 'pct', U, E, fx: 32, alias }));
near(msum(m), 1, '全貌合計（QLD）'); near(mget(m, 'AAPL'), 0.10, 'QLD 以投入資金計不放大'); near(m.levExtra, 0.248, '槓桿額外曝險另列');
m = LT.mix(LT.compute([{ code: 'PSQ', v: 50 }, { code: 'QQQ', v: 50 }], { mode: 'pct', U, E, fx: 32, alias }));
near(msum(m), 1, '全貌合計（反向）'); near(mget(m, '_inverse'), 0.5, '反向 ETF 整檔'); assert(m.slices.find(x => x.key === '_inverse').codes[0] === 'PSQ', '反向 ETF 代號'); near(mget(m, 'AAPL'), 0.05, '反向不扣公司投入資金'); assert(m.slices.every(x => x.w > 0), '切片皆為正');
// 18) 債券、商品、現金、未拆解分類（台股 B 尾碼＝債券、依名稱判定的商品）
U.set('00679B', { n: '元大美債20年', m: 'TW', k: 'E', p: 28 }); E.set('00679B', { h: [], eq: 0, src: '債券型 ETF（依名稱或代號判定）：不持有股票' });
U.set('GLD', { n: 'SPDR Gold Shares', m: 'US', k: 'E', p: 380 }); E.set('GLD', { h: [], eq: 0, src: '商品、期貨或加密資產型 ETF（依名稱或代號判定）：不持有股票' });
r = LT.compute([{ code: 'SHV', v: 20 }, { code: '00679B', v: 20 }, { code: 'GLD', v: 10 }, { code: '現金', v: 15 }, { code: '美元現金', v: 5 }, { code: 'XYZ', v: 10 }, { code: 'AAPL', v: 20 }], { mode: 'pct', U, E, fx: 32, alias });
m = LT.mix(r);
near(msum(m), 1, '全貌合計（混合）'); near(m.cls.bond, 0.40, '債券類'); near(m.cls.commodity, 0.10, '商品類'); near(m.cls.cash, 0.20, '現金類'); near(m.cls.undec, 0.10, '未拆解'); near(m.cls.stock, 0.20, '股票類');
assert(m.slices.find(x => x.key === 'SHV').short === true && m.slices.find(x => x.key === '00679B').short === false, '短天期公債標記');
assert(m.slices.map(x => x.cls).join(',') === 'stock,bond,bond,cash,cash,commodity,undec', '切片順序：股票→債券→現金→商品→未拆解');
assert(LT.kindOf({ code: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', src: 'iShares 每日持股（無股票持股：債券、商品或現金型）' }) === 'bond', '發行商字串不誤判為商品');
assert(LT.kindOf({ code: '00635U', name: '期元大S&P黃金', src: '' }) === 'commodity' && LT.kindOf({ code: 'VIXY', name: 'ProShares VIX Short-Term Futures', src: '' }) === 'other', '期貨與其他');
// 19) 小額合併：占比低於門檻的公司併入「其他股票」，合計仍 100%
m = LT.mix(LT.compute([{ code: 'SPY', v: 100 }], { mode: 'pct', U, E, fx: 32, alias }), { top: 1, min: 0.02 });
near(msum(m), 1, '全貌合計（合併）'); assert(m.slices.filter(x => x.cls === 'stock').length === 2, '前 1 大＋其他股票');
console.log('計算核心：19 組測試全部通過');
