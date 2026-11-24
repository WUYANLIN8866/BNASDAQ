/* BNASDAQ｜管理員訊號明細的圓餅圖
   2026-11-24 站主：「管理員模式的訊號明細要改成用圓餅圖呈現，藍色是符合條件，反之灰色，並且每個區塊都要用文字說明其數字如何判斷及下次更新時間」。
   每條策略一個圓餅：每一塊＝一項判斷條件（等分），藍色＝成立、灰色＝不成立；中間寫成立幾項與結論。
   圓餅旁每一塊都有一段文字：條件、目前數值、怎麼判斷、距門檻、下次更新時間。
   「怎麼判斷」只從條件名稱裡的比較符號與門檻讀出來（條件名稱、數值、門檻都來自解密後的會員規則）：這個檔案是公開的，不寫任何策略內容。
   滑鼠移到（或鍵盤選到、點）某一塊，旁邊對應的文字會標出來；反過來也一樣。
   用法：
     BN.sigpie.html(list, ctx) → HTML
       list：[{ id, ref, d: { rows: [[條件, 數值, 成立, 距門檻], …], votes, of, summary }, topics: [每一列的主題文字] }]
       ctx：{ kind: 'official'｜'prov'｜'custom', next: { price, macro }（下次更新的文字）, isMacro: (條件, 第幾列) => 是否為金融環境數列 }
     BN.sigpie.bind(root)               掛上滑鼠／鍵盤連動
     BN.sigpie.next(rules, market, opt) → { official, price, macro, custom }：依交易日曆（會員規則的 tradingDaysLeft）算下次更新時間的文字 */
(function () {
  'use strict';
  const BN = window.BN = window.BN || {};
  if (BN.sigpie) return;
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  const WD = '日一二三四五六';

  // ---------- 怎麼判斷（從條件名稱讀出比較方式）----------
  const sgn = s => /^[-−]/.test(String(s).trim()) ? -1 : /^[+]?0*\.?0*(%)?$/.test(String(s).trim()) ? 0 : 1;
  const mag = s => String(s).trim().replace(/^[-−+]/, '');
  function how(label, val, ok, dist) {
    const L = String(label).replace(new RegExp('^[' + CIRC + ']\\s*'), ''), V = String(val == null ? '' : val), res = ok ? '成立' : '不成立';
    let m;
    // 區間：「… 在 (a, b)」「… 在 [a, b) 且…」
    if ((m = L.match(/在\s*([(\[])\s*([^,，]+?)\s*[,，]\s*([^)\]]+?)\s*([)\]])\s*(.*)$/))) {
      const lo = m[2], hi = m[3], incL = m[1] === '[', incH = m[4] === ']', extra = m[5].replace(/^且\s*/, '').trim();
      const eq = [!incL ? lo : null, !incH ? hi : null].filter(x => x != null);
      return '數值要' + (incL ? '大於或等於 ' : '大於 ') + lo + '，而且' + (incH ? '小於或等於 ' : '小於 ') + hi + ' 才成立'
        + (eq.length ? '（剛好等於 ' + eq.join(' 或 ') + ' 不算）' : '') + (extra ? '；另外還要「' + extra + '」' : '')
        + '。目前 ' + V + ' → ' + res + '。';
    }
    // 兩個數比較：名稱「…：A > B」、數值「x vs y」
    if (/\svs\s/.test(V) && (m = L.match(/[：:]\s*(.+?)\s*([<>≤≥])\s*(.+)$/))) {
      const xy = V.split(/\s+vs\s+/), d = String(dist || '').trim();
      return '要「' + m[1] + '」' + (m[2] === '>' ? '高於' : m[2] === '<' ? '低於' : m[2]) + '「' + m[3] + '」才成立（相等不算）。目前 ' + xy[0] + ' 對 ' + (xy[1] || '—')
        + (d ? '（' + (sgn(d) < 0 ? '低 ' : sgn(d) > 0 ? '高 ' : '差 ') + mag(d) + '）' : '') + ' → ' + res + '。';
    }
    // 單一門檻：「… < t」「… > t」
    if ((m = L.match(/([<>≤≥])\s*([-−]?[\d.]+%?)\s*$/))) {
      const op = m[1], t = m[2], d = String(dist || '').trim(), word = op === '<' ? '小於' : op === '>' ? '大於' : op === '≤' ? '小於或等於' : '大於或等於';
      return '數值要' + word + ' ' + t + ' 才成立' + (op === '<' || op === '>' ? '（剛好等於 ' + t + ' 不算）' : '') + '。目前 ' + V
        + (d ? '，' + (sgn(d) < 0 ? '比門檻低 ' : sgn(d) > 0 ? '比門檻高 ' : '和門檻相差 ') + mag(d) : '') + ' → ' + res + '。';
    }
    if (V && !/\d/.test(V)) return '這一項不比大小，看狀態：目前「' + V + '」→ ' + res + '。';
    return '依條件名稱的規則判斷：目前 ' + (V || '—') + ' → ' + res + '。';
  }

  // ---------- 圓餅 ----------
  const R0 = 100, R1 = 58;   // 外半徑、內半徑（甜甜圈）
  const pt = (r, a) => (r * Math.cos(a)).toFixed(2) + ' ' + (r * Math.sin(a)).toFixed(2);
  function arc(a0, a1) {
    const big = a1 - a0 > Math.PI ? 1 : 0;
    return 'M' + pt(R0, a0) + 'A' + R0 + ' ' + R0 + ' 0 ' + big + ' 1 ' + pt(R0, a1) + 'L' + pt(R1, a1) + 'A' + R1 + ' ' + R1 + ' 0 ' + big + ' 0 ' + pt(R1, a0) + 'Z';
  }
  const RING = 'M0 -' + R0 + 'A' + R0 + ' ' + R0 + ' 0 1 1 0 ' + R0 + 'A' + R0 + ' ' + R0 + ' 0 1 1 0 -' + R0 + 'ZM0 -' + R1 + 'A' + R1 + ' ' + R1 + ' 0 1 0 0 ' + R1 + 'A' + R1 + ' ' + R1 + ' 0 1 0 0 -' + R1 + 'Z';
  // its：[{ r: 一列, j: 這一列在整張表的序號 }]；c：中間的字 { a: 成立數, b: 總數, hold: 結論（可省略） }
  function pie(k, its, texts, c, cls) {
    const n = its.length, step = 2 * Math.PI / Math.max(1, n), fs = n <= 8 ? 15 : n <= 12 ? 13 : 11;
    let s = '<svg class="sp-pie' + (cls ? ' ' + cls : '') + '" viewBox="-108 -108 216 216" role="img" aria-label="' + esc('成立 ' + c.a + '／' + c.b + ' 項' + (c.hold ? '，' + c.hold : '') + '；' + its.map(o => (o.j + 1) + ' ' + (o.r[2] ? '成立' : '不成立')).join('，')) + '">';
    its.forEach((o, q) => {
      const a0 = -Math.PI / 2 + q * step, a1 = a0 + step, am = (a0 + a1) / 2, on = !!o.r[2];
      s += '<g class="sp-sl ' + (on ? 'on' : 'off') + '" data-k="' + k + '" data-i="' + o.j + '" tabindex="0" role="button" aria-label="' + esc((o.j + 1) + '. ' + o.r[0] + '：' + (on ? '成立' : '不成立')) + '">'
        + '<title>' + esc((o.j + 1) + '. ' + texts[o.j]) + '</title><path d="' + (n === 1 ? RING : arc(a0, a1)) + '" fill-rule="evenodd"/>'
        + '<text x="' + ((R0 + R1) / 2 * Math.cos(am)).toFixed(2) + '" y="' + ((R0 + R1) / 2 * Math.sin(am)).toFixed(2) + '" font-size="' + fs + '" text-anchor="middle" dominant-baseline="central">' + (o.j + 1) + '</text></g>';
    });
    // 中間：成立數／總數、「項成立」、結論（結論太長、中間有「＋」時拆成兩行，免得超出內圈）
    const h = String(c.hold || ''), hl = h.length > 9 && h.indexOf('＋') > 0 ? [h.slice(0, h.indexOf('＋')), h.slice(h.indexOf('＋'))] : h ? [h] : [];
    const y0 = hl.length > 1 ? -18 : hl.length ? -12 : -4;
    s += '<text class="sp-c1" x="0" y="' + y0 + '" text-anchor="middle" font-size="26">' + c.a + '<tspan font-size="15">／' + c.b + '</tspan></text>'
      + '<text class="sp-c2" x="0" y="' + (y0 + 21) + '" text-anchor="middle" font-size="11.5">項成立</text>'
      + hl.map((x, q) => '<text class="sp-c3" x="0" y="' + (y0 + 39 + q * 14) + '" text-anchor="middle" font-size="11.5">' + esc(x) + '</text>').join('') + '</svg>';
    return s;
  }

  let seq = 0;
  function html(list, ctx) {
    ctx = ctx || {};
    const nx = ctx.next || {}, isMacro = ctx.isMacro || (() => false);
    return '<div class="sp-wrap">' + list.map(x => {
      const d = x.d, k = 'sp' + (++seq);
      const head = '<h4 class="sp-h">' + esc(x.id) + (x.ref ? '<small>（專案 ' + esc(x.ref) + '）</small>' : '') + '</h4>';
      if (!d) return '<div class="sp-one">' + head + '<p class="small">這個月份沒有可用模型，無法計算。</p></div>';
      const rows = d.rows || [];
      if (!rows.length) return '<div class="sp-one">' + head + '<p class="small">' + esc(d.summary || '') + '</p><p class="small">這個月份只有定案紀錄（成立 ' + esc(d.votes) + '／' + esc(d.of) + ' 項），沒有逐項數值。</p></div>';
      const hold = String(d.summary || '').split('→').pop().trim();
      // 計分的是前 of 列；多出來的列（不計入成立數、另外判斷的條件）畫成第二個小圓餅，顏色規則一樣
      const of = +d.of > 0 && +d.of < rows.length ? +d.of : rows.length;
      const all = rows.map((r, j) => ({ r, j })), main = all.slice(0, of), extra = all.slice(of);
      const onMain = main.filter(o => o.r[2]).length, onAll = all.filter(o => o.r[2]).length, onX = onAll - onMain;
      const nextOf = j => ctx.kind === 'custom' ? (nx.custom || '自訂收盤價的試算，不會自動更新。') : isMacro(rows[j][0], j) ? (nx.macro || nx.price || '') : (nx.price || '');
      const texts = rows.map((r, j) => r[0] + '｜數值 ' + r[1] + '｜' + (r[2] ? '成立（藍）' : '不成立（灰）') + '｜怎麼判斷：' + how(r[0], r[1], r[2], r[3]) + '｜下次更新：' + nextOf(j));
      const items = rows.map((r, j) => {
        const on = !!r[2], tp = x.topics && x.topics[j];
        return (j === of && extra.length ? '<li class="sp-gap">另外判斷的條件（' + (of + 1) + (rows.length > of + 1 ? '～' + rows.length : '') + '，不算在上面的 ' + of + ' 項裡）</li>' : '')
          + '<li class="sp-it ' + (on ? 'on' : 'off') + '" data-k="' + k + '" data-i="' + j + '" tabindex="-1">'
          + '<div class="sp-t"><span class="sp-n" aria-hidden="true">' + (j + 1) + '</span><b>' + esc(r[0]) + '</b><span class="sp-st">' + (on ? '✓ 成立' : '✕ 不成立') + '</span></div>'
          + '<div class="sp-l"><span class="sp-k">目前數值</span>' + esc(r[1]) + (r[3] !== '' && r[3] != null ? '<span class="sp-k sp-k2">距門檻</span>' + esc(r[3]) : '') + '</div>'
          + '<div class="sp-l"><span class="sp-k">怎麼判斷</span>' + esc(how(r[0], r[1], r[2], r[3])) + '</div>'
          + '<div class="sp-l"><span class="sp-k">下次更新</span>' + esc(nextOf(j)) + '</div>'
          + (tp ? '<div class="sp-l"><span class="sp-k">消息主題</span>' + esc(tp) + '</div>' : '')
          + '</li>';
      }).join('');
      const fig = pie(k, main, texts, { a: d.votes, b: d.of, hold })
        + (onMain !== +d.votes ? '<p class="small sp-note">中間的成立數以定案紀錄為準（見下方說明）；各塊是重算的逐項結果。</p>' : '')
        + (extra.length ? '<p class="sp-x">另外判斷的條件（不算在 ' + of + ' 項裡）</p>' + pie(k, extra, texts, { a: onX, b: extra.length }, 'sp-mini') : '')
        + '<p class="sp-leg"><span class="sp-sw on"></span>成立 ' + onAll + '<span class="sp-sw off"></span>不成立 ' + (rows.length - onAll) + '</p>';
      return '<div class="sp-one">' + head
        + '<div class="sp-body"><div class="sp-fig">' + fig + '</div>'
        + '<ol class="sp-list">' + items + '</ol></div>'
        + '<p class="small sp-sum">' + esc(d.summary || '') + '</p></div>';
    }).join('') + '</div>';
  }

  // ---------- 連動：圓餅的某一塊 ↔ 旁邊的文字 ----------
  function bind(root) {
    if (!root || root.__sp) return; root.__sp = true;
    const pick = (el, on, scroll) => {
      const k = el.getAttribute('data-k'), i = el.getAttribute('data-i');
      root.querySelectorAll('[data-k="' + k + '"][data-i="' + i + '"]').forEach(x => {
        x.classList.toggle('hl', on);
        if (on && scroll && x.classList.contains('sp-it')) { try { x.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { x.scrollIntoView(); } }
      });
    };
    const tgt = e => e.target && e.target.closest && e.target.closest('.sp-sl,.sp-it');
    root.addEventListener('mouseover', e => { const t = tgt(e); if (t) pick(t, true, false); });
    root.addEventListener('mouseout', e => { const t = tgt(e); if (t) pick(t, false, false); });
    root.addEventListener('focusin', e => { const t = tgt(e); if (t) pick(t, true, true); });
    root.addEventListener('focusout', e => { const t = tgt(e); if (t) pick(t, false, false); });
    root.addEventListener('click', e => { const t = e.target && e.target.closest && e.target.closest('.sp-sl'); if (t) { root.querySelectorAll('.hl').forEach(x => x.classList.remove('hl')); pick(t, true, true); } });
  }

  // ---------- 下次更新時間（台北時間）----------
  const p2 = v => String(v).padStart(2, '0');
  const addDay = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const tpe = ms => { const z = new Date(ms + 8 * 36e5); return (z.getUTCMonth() + 1) + '/' + z.getUTCDate() + '（' + WD[z.getUTCDay()] + '）' + p2(z.getUTCHours()) + ':' + p2(z.getUTCMinutes()); };
  const md = s => { const [, m, d] = s.split('-').map(Number); return m + '/' + d + '（' + WD[new Date(s + 'T00:00:00Z').getUTCDay()] + '）'; };
  function etOffset(ms) {   // 美東時間比 UTC 慢幾小時（冬令 5、夏令 4）
    try { const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(ms)).find(p => p.type === 'timeZoneName').value; const m = s.match(/GMT([+-]\d+)/); return m ? -(+m[1]) : 5; } catch (e) { return 5; }
  }
  function next(rules, market, opt) {
    opt = opt || {};
    const now = opt.now || Date.now(), cur = (market && market.current) || {}, asof = (market && market.asof) || '';
    const isTD = s => { const wd = new Date(s + 'T00:00:00Z').getUTCDay(); if (wd === 0 || wd === 6) return false; try { return rules.tradingDaysLeft(addDay(s, -1), s.slice(0, 7)) - rules.tradingDaysLeft(s, s.slice(0, 7)) === 1; } catch (e) { return true; } };
    const lastTD = m => { const [y, mm] = m.split('-').map(Number); let s = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10); for (let k = 0; k < 10 && !isTD(s); k++) s = addDay(s, -1); return s; };
    const etDay = ms => new Date(ms - etOffset(ms) * 36e5).toISOString().slice(0, 10);
    // 本月（市場資料的月份）最後一個交易日；那一天已收盤就換下個月
    let m = cur.m || asof.slice(0, 7), T = m ? lastTD(m) : '';
    if (T && T <= asof && market && market.current && cur.asof === T) { m = rules.nextMonth ? rules.nextMonth(m) : m; T = lastTD(m); }
    // 下一次美股盤前開盤（美東 04:00）
    let nxt = '';
    for (let k = 0, d = etDay(now); k < 12; k++, d = addDay(d, 1)) {
      if (!isTD(d)) continue;
      const [y, mo, dd] = d.split('-').map(Number), guess = Date.UTC(y, mo - 1, dd, 4), ms = guess + etOffset(guess) * 36e5;
      const close = Date.UTC(y, mo - 1, dd, 20) + etOffset(guess) * 36e5;   // 盤後 20:00 結束
      if (close > now) { nxt = ms <= now ? 'now' : tpe(ms); break; }
    }
    // 下一次網站排程更新（UTC 週一～五 22:45＝台北週二～六 06:45）
    let cron = '';
    for (let k = 0; k < 8; k++) { const d = new Date(now + k * 864e5), wd = d.getUTCDay(), ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22, 45); if (wd >= 1 && wd <= 5 && ms > now) { cron = tpe(ms); break; } }
    const liveOn = opt.live === true || nxt === 'now';
    const fin = T ? md(T) + ' 美股收盤後定案（台北 ' + md(addDay(T, 1)) + ' 06:45 前後更新）' : '';
    return {
      official: '月底定案，不會再變。下次判斷：' + (T ? md(T) + ' 美股收盤後（台北 ' + md(addDay(T, 1)) + ' 06:45 前後更新）' : '—') + '。',
      price: (liveOn ? '美股交易中（含盤前盤後）：跟著 QQQ 即時價約每分鐘重算' : '美股休市中：' + (nxt ? '台北 ' + nxt + '（美股盤前開盤）' : '下次開盤') + '起跟著 QQQ 即時價約每分鐘重算')
        + (fin ? '；' + fin : '') + '。',
      macro: '要等 FRED 公布新的月份數字才會變；網站在台北每個交易日 06:45 抓最新值（下次 ' + (cron || '—') + '）' + (fin ? '；' + fin.replace('定案', '用月底定案檔定案') : '') + '。',
      custom: '自訂收盤價的試算，不會自動更新。'
    };
  }

  BN.sigpie = { html, bind, how, next };
})();
