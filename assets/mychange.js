/* BNASDAQ｜每日市場分析最上面的「你的資產變化」：只有登入的會員看得到。
   讀會員在「會員持有資產」加密保存的持有（只在這個瀏覽器解密計算，不上傳），用每檔最新收盤與前一個交易日收盤算出：
     今日資產變化（金額與 %）、每一檔的變化、影響最大的公司（透視後的曝險 × 該公司當日漲跌，估算），並和那斯達克 100 當日漲跌對照。
   「不列入計算」的持有不算；價格來源、日期與前一日收盤都依 assets/mh-core.js（每檔取日期最新的來源）。
   美元資產：用最新匯率與前一天匯率分別換算台幣（兩天的匯率都有時，變化含匯率影響）。 */
(function () {
  'use strict';
  const box = document.getElementById('mychg'); if (!box) return;
  let sess = null; try { sess = JSON.parse(sessionStorage.getItem('bn-session') || 'null'); } catch (e) { /* 沒登入 */ }
  if (!sess || !sess.user || !window.BN || !BN.mh || !BN.lt) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (x, d) => (+x).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const amt = x => (x > 0 ? '+' : x < 0 ? '−' : '') + nf(Math.abs(Math.round(x))) + ' 元';
  const wan = x => { const a = Math.abs(x); return (x < 0 ? '−' : x > 0 ? '+' : '') + (a >= 1e8 ? nf(a / 1e8, 2) + ' 億' : a >= 1e4 ? nf(a / 1e4, a >= 1e6 ? 0 : 1) + ' 萬' : nf(a)); };
  const sg = (x, d) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(d == null ? 2 : d) + '%';
  const cls = x => x > 0 ? 'pos' : x < 0 ? 'neg' : '';
  const SUF = /[,\s]+(Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Company|Ltd\.?|Limited|plc|PLC|N\.?V\.?|S\.?A\.?|AG|SE|Holdings?|Group|Class [A-C]|ADR|The)$/i;
  const short = (s, n) => { s = String(s || '').trim(); let t; do { t = s; s = s.replace(SUF, '').trim(); } while (s !== t && s.length > 3); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const H = '<h2 id="mychg-h">你的資產變化</h2>';
  const put = h => { box.hidden = false; box.querySelector('.wrap').innerHTML = h; };

  (async function () {
    put(H + '<p class="small">正在用最新收盤計算你的資產變化…</p>');
    let saved = null;
    try { saved = await BN.mh.load(sess); } catch (e) { put(H + '<p class="msg err">讀取你的持有資料失敗：' + esc(e.message || e) + '</p>'); return; }
    const rows = (saved && saved.rows) || [], used = rows.filter(r => String(r.code || '').trim() && +r.v && !r.off);
    if (!used.length) { put(H + '<p>還沒有持有資料。到 <a href="member.html#mine">會員專區・會員持有資產</a> 輸入後，這裡每天都會先分析你的資產變化。</p>'); return; }
    let D, R;
    try { D = await BN.mh.data(); R = await BN.mh.compute(rows); } catch (e) { put(H + '<p class="msg err">資料載入失敗：' + esc(e.message || e) + '</p>'); return; }
    const fx = D.FX.rate, fxp = D.FX.prev;
    // 每一檔：今天市值、前一個交易日市值
    const its = R.assets.map(a => {
      const u = D.U.get(a.code) || {}, usd = a.cur === 'USD';
      if (a.kind === 'C') { const prev = usd ? (fxp ? a.v * fxp : null) : a.value; return { a, u, now: a.value, prev, d: usd ? D.FX.date : '', pct: prev ? a.value / prev - 1 : 0 }; }
      if (!(u.pp > 0)) return { a, u, now: a.value, prev: null, d: u.d };
      const prev = a.v * u.pp * (usd ? (fxp || fx) : 1);
      return { a, u, now: a.value, prev, d: u.d, pct: a.px / u.pp - 1 };
    });
    const ok = its.filter(x => x.prev != null), miss = its.filter(x => x.prev == null);
    const now = ok.reduce((t, x) => t + x.now, 0), prev = ok.reduce((t, x) => t + x.prev, 0), chg = now - prev, pct = prev ? chg / prev : 0;
    // 透視：影響最大的公司（曝險 × 當日漲跌，估算）
    let cov = 0, all = 0;
    const con = R.cos.filter(c => Math.abs(c.w) > 1e-9).map(c => { const u = D.U.get(c.key); all += Math.abs(c.w);
      if (!u || !(u.pp > 0) || !(u.p > 0)) return null; cov += Math.abs(c.w); const r = u.p / u.pp - 1; return { c, r, k: c.w * r }; }).filter(Boolean)
      .sort((p, q) => Math.abs(q.k) - Math.abs(p.k)).slice(0, 8);
    // 市場對照：最新一份每日報告的那斯達克 100
    let ndx = null, rep = '';
    try { const ix = await (await fetch('data/daily/index.json', { cache: 'no-store' })).json(); const d = await (await fetch('data/daily/' + ix.latest + '.json', { cache: 'no-store' })).json();
      ndx = (d.indices || []).find(x => x.key === 'NDX') || null; rep = d.session || ''; } catch (e) { /* 沒有就不對照 */ }
    const dates = {}; its.forEach(x => { if (x.a.kind !== 'C' && x.d) { const m = x.a.market === 'US' ? '美股' : '台股'; dates[m] = dates[m] && dates[m] > x.d ? dates[m] : x.d; } });
    const dTxt = Object.entries(dates).map(([m, d]) => m + ' ' + d).join('、');
    // ---------- 版面 ----------
    let h = H + '<p class="small">依你在會員專區保存的持有' + (rows.some(r => r.off && String(r.code || '').trim()) ? '（不含設為「不列入計算」的項目）' : '') + '，用每檔最新收盤和前一個交易日收盤計算' + (dTxt ? '（' + esc(dTxt) + ' 收盤）' : '') + '。只在你的瀏覽器計算，不上傳。</p>';
    h += '<div class="kv">' +
      '<div class="tile"><div class="k">今日資產變化</div><div class="v ' + cls(chg) + '">' + wan(chg) + '</div><div class="s ' + cls(chg) + '">' + sg(pct) + '（' + amt(chg) + '）</div></div>' +
      '<div class="tile"><div class="k">目前總市值</div><div class="v">' + wan(now).replace(/^\+/, '') + '</div><div class="s">前一交易日 ' + nf(Math.round(prev)) + ' 元</div></div>' +
      (ndx ? '<div class="tile"><div class="k">對照：那斯達克 100</div><div class="v ' + cls(ndx.chg) + '">' + (ndx.chg > 0 ? '+' : ndx.chg < 0 ? '−' : '') + Math.abs(ndx.chg).toFixed(2) + '%</div><div class="s">美股 ' + esc(rep) + ' 收盤（台股持有的日期可能不同，見下表）</div></div>' : '') +
      '</div>';
    // 每一檔
    h += '<div class="mychg-grid"><div><h3>每一檔的變化</h3><div class="tblwrap"><table class="tbl"><thead><tr><th class="l">持有</th><th>收盤（日期）</th><th>當日漲跌</th><th>市值變化</th></tr></thead><tbody>' +
      its.slice().sort((p, q) => Math.abs((q.now - (q.prev == null ? q.now : q.prev))) - Math.abs((p.now - (p.prev == null ? p.now : p.prev)))).map(x => {
        const a = x.a, dd = x.prev == null ? null : x.now - x.prev;
        return '<tr><td class="l"><b>' + esc(a.code) + '</b> <small>' + esc(short(a.name, 16)) + '</small></td><td>' + (a.kind === 'C' ? (a.cur === 'USD' ? '匯率 ' + nf(fx, 3) : '—') : nf(a.px, a.px < 10 ? 3 : 2) + (a.cur === 'USD' ? ' 美元' : ' 元') + '<br><small>' + esc(x.d || '') + '</small>') + '</td>' +
          '<td class="' + cls(x.pct || 0) + '">' + (x.prev == null ? '—' : a.kind === 'C' && a.cur !== 'USD' ? '0.00%' : sg(x.pct)) + '</td><td class="' + cls(dd || 0) + '">' + (dd == null ? '<small>沒有前一日收盤</small>' : amt(dd)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (miss.length ? '<p class="small muted">' + esc(miss.map(x => x.a.code).join('、')) + ' 沒有前一個交易日收盤，未計入今日變化。</p>' : '') + '</div>';
    // 影響最大的公司
    if (con.length) {
      const mx = Math.max(...con.map(x => Math.abs(x.k)));
      const cd = Object.entries(con.reduce((m, x) => { const d = (D.U.get(x.c.key) || {}).d || ''; m[d] = (m[d] || 0) + 1; return m; }, {})).sort((p, q) => q[1] - p[1])[0][0];
      h += '<div><h3>影響最大的公司（透視估算）</h3><div class="mychg-bars">' + con.map(x => '<div class="mb"><span class="lb"><b>' + esc(x.c.key) + '</b> ' + esc(short(x.c.name, 14)) + ' <small>' + sg(x.r) + '</small></span>' +
        '<span class="tr"><i class="' + (x.k >= 0 ? 'up' : 'dn') + '" style="width:' + (Math.abs(x.k) / mx * 50).toFixed(1) + '%"></i></span><span class="vv ' + cls(x.k) + '">' + sg(x.k) + '</span></div>').join('') + '</div>' +
        '<p class="small muted">貢獻＝該公司占你總資產的曝險（槓桿 ETF 依倍數放大）× 該公司最新一個交易日的漲跌（多數為 ' + esc(cd) + ' 收盤）；漲跌資料涵蓋 ' + (all ? Math.round(cov / all * 100) : 0) + '% 的股票曝險。這是估算：台股掛牌的海外 ETF（例如 00670L）要到下一個台股交易日才反映這些漲跌，所以和左邊的實際變化不一定是同一天，也會因費用、追蹤誤差略有差異。</p></div>';
    }
    h += '</div><p class="small"><a href="member.html#mine">到會員專區看完整分析（配置、透視、產業、策略差額）→</a></p>';
    put(h);
  })();
})();
