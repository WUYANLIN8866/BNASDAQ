#!/usr/bin/env node
/* BNASDAQ｜產生「安裝成應用程式」用的圖示（PNG）。圖案和 assets/favicon.svg 一樣：深藍底、金色圓環、白色 B。
   為什麼需要：Chrome 要有 web app manifest（manifest.webmanifest）和 192、512 像素的 PNG 圖示才允許「安裝」；
   只有 SVG 網站圖示時，手機上只會出現「建立捷徑」，「安裝」會顯示「無法安裝這個應用程式」。
   產出（都在 assets/）：
     icon-192.png、icon-512.png                    一般圖示（圓形、四角透明）
     icon-maskable-192.png、icon-maskable-512.png  可裁切圖示（整張深藍底；圓環外緣在中央 80% 安全區內，被裁成圓形或圓角都完整）
     apple-touch-icon.png（180）                   iPhone／iPad「加入主畫面」用（不能透明，所以也是整張深藍底）
   用法：node scripts/make_app_icons.js   （需要 Playwright 的 Chromium，以及系統字型 Noto Serif CJK TC；沒有這個字型會直接停止，不會用別的字型硬畫）
   B 的位置依實際筆畫範圍置中（不是用字框），換字型時不會偏。 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'assets');
const FONT = 'Noto Serif CJK TC', NAVY = '#0b2a4a', GOLD = '#b7791f';
const JOBS = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-192.png', 192, true], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await p.setContent('<body style="margin:0"><span style="font:700 30px \'' + FONT + '\'">B</span></body>');
  // 字型要真的存在（document.fonts.check 對沒安裝的字型也可能回 true，所以比對「指定字型」和「一定不存在的字型」的字寬）
  const m = await p.evaluate(async (FONT) => {
    await document.fonts.ready;
    const c0 = document.createElement('canvas').getContext('2d');
    c0.font = '700 30px "' + FONT + '", monospace'; const a = c0.measureText('B');
    c0.font = '700 30px "no-such-font-bnasdaq", monospace'; const z = c0.measureText('B');
    // 筆畫範圍：放大 16 倍畫到畫布上，直接掃像素（measureText 的範圍在這個版本只到整數像素，不夠準）
    const K = 16, W = 64 * K, cv = document.createElement('canvas'); cv.width = cv.height = W;
    const c = cv.getContext('2d'); c.font = '700 ' + 30 * K + 'px "' + FONT + '"'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#000';
    c.fillText('B', 32 * K, 44 * K);
    const d = c.getImageData(0, 0, W, W).data; let x0 = W, y0 = W, x1 = -1, y1 = -1;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    // 以「x=32 置中、基線 y=44」畫出來時，筆畫中心在 (cx, cy)；要移到 (32, 32)
    return { ok: Math.abs(a.width - z.width) > 0.01 && x1 >= 0, cx: (x0 + x1 + 1) / 2 / K, cy: (y0 + y1 + 1) / 2 / K, w: (x1 - x0 + 1) / K, h: (y1 - y0 + 1) / K };
  }, FONT);
  if (!m.ok) { console.error('找不到字型「' + FONT + '」，停止（不用別的字型代替）'); await b.close(); process.exit(1); }
  const x = 32 + (32 - m.cx), y = 44 + (32 - m.cy);   // 讓 B 的筆畫範圍正中心落在 (32, 32)
  const svg = full => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%" style="display:block">' +
    (full ? '<rect width="64" height="64" fill="' + NAVY + '"/>' : '<circle cx="32" cy="32" r="30" fill="' + NAVY + '"/>') +
    '<circle cx="32" cy="32" r="24" fill="none" stroke="' + GOLD + '" stroke-width="2"/>' +
    '<text x="' + x.toFixed(3) + '" y="' + y.toFixed(3) + '" text-anchor="middle" font-family="\'' + FONT + '\'" font-weight="700" font-size="30" fill="#fff">B</text></svg>';
  for (const [name, n, full] of JOBS) {
    await p.setViewportSize({ width: n, height: n });
    await p.setContent('<body style="margin:0;background:transparent;width:' + n + 'px;height:' + n + 'px;overflow:hidden">' + svg(full) + '</body>');
    await p.screenshot({ path: path.join(OUT, name), omitBackground: true, clip: { x: 0, y: 0, width: n, height: n } });
    console.log('寫入 assets/' + name + '：' + n + '×' + n + '，' + fs.statSync(path.join(OUT, name)).size + ' bytes');
  }
  console.log('B 的位置：x=' + x.toFixed(3) + '、基線 y=' + y.toFixed(3) + '（筆畫寬 ' + m.w.toFixed(2) + '、高 ' + m.h.toFixed(2) + '，單位＝64 格座標）');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
