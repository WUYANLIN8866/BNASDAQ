/* BNASDAQ｜管理員訊號明細的圓餅圖
   2026-11-24 站主：「管理員模式的訊號明細要改成用圓餅圖呈現，藍色是符合條件，反之灰色，並且每個區塊都要用文字說明其數字如何判斷及下次更新時間」。
   每條策略一個圓餅：每一塊＝一項判斷條件（等分），藍色＝成立、灰色＝不成立；中間寫成立幾項與結論。
   圓餅旁每一塊都有一段文字：條件、目前數值、怎麼判斷、距門檻、下次更新時間。
   「怎麼判斷」只從條件名稱裡的比較符號與門檻讀出來（條件名稱、數值、門檻都來自解密後的會員規則）：這個檔案是公開的，不寫任何策略內容。
   滑鼠移到（或鍵盤選到、點）某一塊，旁邊對應的文字會標出來；反過來也一樣。
   2026-11-24 站主：「管理後台的訊號明細的每個條件都要在『下次更新』下方新增一欄『白話說明』」。
     白話說明的文字由呼叫端提供（管理後台解開 data/explain.enc.json 之後傳進來）；這個檔案只負責對到每一列、排版，不寫任何策略內容。
   用法：
     BN.sigpie.html(list, ctx) → HTML
       list：[{ id, ref, d: { rows: [[條件, 數值, 成立, 距門檻], …], votes, of, summary }, topics: [每一列的主題文字], plain: [每一列的白話說明] }]
         plain 有給才會多出「白話說明」那一欄（在「下次更新」下方）；每一列可以是一段文字，或 [這一項在看什麼, 現在代表什麼]（第二段另起一行）；空的就不顯示
     BN.sigpie.plainRows(entries, rows) → [每一列的 [在看什麼, 現在代表什麼] 或 null]：entries＝[{ key, what, on, off, offLo, offHi }]（見下方說明）
     BN.sigpie.side(條件, 數值)         區間條件「… 在 (a, b)」：目前數值在下限以下 'lo'、上限以上 'hi'、其餘 ''
       ctx：{ kind: 'official'｜'prov'｜'custom', next: { price, macro }（下次更新的文字）, isMacro: (條件, 第幾列) => 是否為金融環境數列 }
       ctx.fold（選填）：每個模型的區塊可以收合，狀態記在這台瀏覽器（管理後台用）
     BN.sigpie.bind(root)               掛上滑鼠／鍵盤連動與收合
     BN.sigpie.foldAll(root, 收合?)     全部收合／展開
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

  // ---------- 白話說明（文字由呼叫端提供；這裡只負責替每一列挑出對應的那一筆）----------
  // side：條件名稱是區間「… 在 (a, b)」時，目前數值落在區間的哪一邊（讀不出數字、或數值在區間內就回傳 ''）
  const num = s => { const m = String(s == null ? '' : s).replace(/−/g, '-').match(/-?\d+(?:\.\d+)?/); return m ? +m[0] : NaN; };
  function side(label, val) {
    const m = String(label).match(/在\s*([(\[])\s*([^,，]+?)\s*[,，]\s*([^)\]]+?)\s*([)\]])/); if (!m) return '';
    const v = num(val), lo = num(m[2]), hi = num(m[3]); if (!(v === v) || !(lo === lo) || !(hi === hi)) return '';
    return (m[1] === '[' ? v < lo : v <= lo) ? 'lo' : (m[4] === ']' ? v > hi : v >= hi) ? 'hi' : '';
  }
  // plainRows：entries＝某一個模型的白話說明 [{ key, what, on, off, offLo, offHi }]，rows＝規則算出來的條件列。
  //   key＝條件名稱裡一定會出現的字；先看同一個位置的那一筆，對不上再找名稱含有 key 的第一筆；都對不上＝null（由呼叫端決定要顯示什麼）。
  //   回傳 [what（這一項在看什麼）, 現在代表什麼]：成立時用 on；不成立時用 off（區間條件看數值在哪一邊，有 offLo／offHi 就用它）。
  function plainRows(entries, rows) {
    const E = Array.isArray(entries) ? entries : [], hit = (e, L) => !!(e && typeof e.key === 'string' && e.key && L.indexOf(e.key) >= 0);
    return (rows || []).map((r, j) => {
      const L = String(r[0]), e = hit(E[j], L) ? E[j] : E.find(x => hit(x, L)); if (!e) return null;
      const sd = r[2] ? '' : side(L, r[1]), tail = r[2] ? e.on : (sd === 'lo' && e.offLo) || (sd === 'hi' && e.offHi) || e.off;
      const out = [e.what, tail].filter(x => typeof x === 'string' && x); return out.length ? out : null;
    });
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
  function pie(k, its, texts, c, cls, tag) {
    const n = its.length, step = 2 * Math.PI / Math.max(1, n), fs = n <= 8 ? 15 : n <= 12 ? 13 : 11;
    let s = '<svg class="sp-pie' + (cls ? ' ' + cls : '') + '" viewBox="-108 -108 216 216" role="img" aria-label="' + esc('成立 ' + c.a + '／' + c.b + ' 項' + (c.hold ? '，' + c.hold : '') + '；' + its.map(o => (o.j + 1) + ' ' + (o.r[2] ? '成立' : '不成立')).join('，')) + '">';
    its.forEach((o, q) => {
      const a0 = -Math.PI / 2 + q * step, a1 = a0 + step, am = (a0 + a1) / 2, on = !!o.r[2];
      s += '<g class="sp-sl ' + (on ? 'on' : 'off') + (tag ? tag(o.j) : '') + '" data-k="' + k + '" data-i="' + o.j + '" tabindex="0" role="button" aria-label="' + esc((o.j + 1) + '. ' + o.r[0] + '：' + (on ? '成立' : '不成立')) + '">'
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

  // ---------- 每個模型的區塊可以收合（ctx.fold＝狀態的分類名稱；記在這台瀏覽器 localStorage bn-sp-fold）----------
  const FK = 'bn-sp-fold'; let FS = null;
  const fload = () => { if (!FS) { try { FS = JSON.parse(localStorage.getItem(FK) || '{}') || {}; } catch (e) { FS = {}; } } return FS; };
  const fget = k => !!fload()[k];
  const fset = (k, off) => { const s = fload(); if (off) s[k] = 1; else delete s[k]; try { localStorage.setItem(FK, JSON.stringify(s)); } catch (e) { } };
  function foldOne(one, off, keep) {
    const b = one.querySelector(':scope > .sp-h .sp-ft'); if (!b) return;
    one.classList.toggle('sp-off', off); b.setAttribute('aria-expanded', String(!off)); if (!keep) fset(b.getAttribute('data-fold'), off);
  }
  function foldAll(root, off) { (root || document).querySelectorAll('.sp-one').forEach(o => foldOne(o, off)); }

  let seq = 0;
  const FLT = {};   // 每個模型區塊目前的篩選（all 不存）；畫面每分鐘重畫時保持
  function html(list, ctx) {
    ctx = ctx || {};
    const nx = ctx.next || {}, isMacro = ctx.isMacro || (() => false);
    return '<div class="sp-wrap">' + list.map(x => {
      const d = x.d, k = 'sp' + (++seq), rows = (d && d.rows) || [];
      const hold = d ? String(d.summary || '').split('→').pop().trim() : '';
      const brief = !d ? '沒有可用模型' : d.votes + '／' + d.of + ' 項成立' + (hold ? ' → ' + hold : '');
      const name = esc(x.id) + (x.ref ? '<small>（專案 ' + esc(x.ref) + '）</small>' : '');
      const fk = ctx.fold ? ctx.fold + '|' + x.id : '', off = fk && fget(fk);
      const head = fk ? '<h4 class="sp-h"><button type="button" class="sp-ft" data-fold="' + esc(fk) + '" aria-expanded="' + !off + '" title="點一下收合／展開"><span class="sp-fx" aria-hidden="true"></span><span class="sp-fn">' + name + '</span><span class="sp-hs">' + esc(brief) + '</span></button></h4>'
        : '<h4 class="sp-h">' + name + '</h4>';
      const open = '<div class="sp-one' + (off ? ' sp-off' : '') + (FLT[(ctx.fold || ctx.kind || '') + '|' + x.id] ? ' sp-f-' + FLT[(ctx.fold || ctx.kind || '') + '|' + x.id] : '') + '">';
      if (!d) return open + head + '<p class="small sp-sum">這個月份沒有可用模型，無法計算。</p></div>';
      if (!rows.length) return open + head + '<div class="sp-body sp-body1"><p class="small">' + esc(d.summary || '') + '</p><p class="small">這個月份只有定案紀錄（成立 ' + esc(d.votes) + '／' + esc(d.of) + ' 項），沒有逐項數值。</p></div></div>';
      // 計分的是前 of 列；多出來的列（不計入成立數、另外判斷的條件）畫成第二個小圓餅，顏色規則一樣
      const of = +d.of > 0 && +d.of < rows.length ? +d.of : rows.length;
      const all = rows.map((r, j) => ({ r, j })), main = all.slice(0, of), extra = all.slice(of);
      const onMain = main.filter(o => o.r[2]).length, onAll = all.filter(o => o.r[2]).length, onX = onAll - onMain;
      const nextOf = j => ctx.kind === 'custom' ? (nx.custom || '無（不會自動更新）') : isMacro(rows[j][0], j) ? ((nx.macroOf && nx.macroOf(rows[j][0])) || nx.macro || nx.price || '') : (nx.price || '');
      // 2026-11-25 站主：圓餅下方新增「全數條件／僅 QLD 條件／僅 SHV 條件／本月判斷確定條件（本月確定不再更新）」。
      //   QLD 條件＝這一項目前把票投給 QLD：計分條件成立；另外判斷的條件（成立會減碼）不成立。SHV 條件＝其餘。
      //   本月確定＝月底判斷前不會再變：正式訊號全部都是；推算裡只有「下一次官方公布在月底收盤之後」的金融環境數列（nx.fixedOf）；跟著 QQQ 價格算的都不是。
      const sideOf = j => (j < of ? !!rows[j][2] : !rows[j][2]) ? 'q' : 's';
      const fixOf = j => ctx.kind === 'official' ? true : !!(isMacro(rows[j][0], j) && nx.fixedOf && nx.fixedOf(rows[j][0]));
      const pdOf = j => ctx.kind === 'official' ? false : !!(isMacro(rows[j][0], j) && nx.pendOf && nx.pendOf(rows[j][0]));
      const tag = j => ' sd-' + sideOf(j) + (fixOf(j) ? ' fx' : '') + (pdOf(j) ? ' pd' : '');
      const cnt = { all: rows.length, q: rows.filter((r, j) => sideOf(j) === 'q').length, fx: rows.filter((r, j) => fixOf(j)).length, pd: rows.filter((r, j) => pdOf(j)).length };
      const fkey = (ctx.fold || ctx.kind || '') + '|' + x.id, fcur = FLT[fkey] || 'all';
      const fbtn = (f, t, n) => '<button type="button" class="sp-fb' + (fcur === f ? ' cur' : '') + '" data-f="' + f + '" aria-pressed="' + (fcur === f) + '">' + t + '<b>' + n + '</b></button>';
      const flt = '<div class="sp-flt" role="group" aria-label="篩選條件" data-fk="' + esc(fkey) + '">' + fbtn('all', '全數條件', cnt.all) + fbtn('q', '僅 QLD 條件', cnt.q) + fbtn('s', '僅 SHV 條件', cnt.all - cnt.q) + fbtn('fx', '本月判斷確定條件', cnt.fx) + fbtn('pd', '本月未定案', cnt.pd)
        + '<p class="sp-fnote">QLD 條件＝目前把票投給 QLD 的；本月判斷確定＝月底判斷前不會再變的（官方下一次公布在月底之後）；本月未定案＝官方公布時間在現在到月底判斷之間的官方數據。</p></div>';
      const plainOf = j => { const t = x.plain && x.plain[j]; return (Array.isArray(t) ? t : [t]).filter(s => typeof s === 'string' && s); };   // 白話說明（呼叫端有給才有）：一段或兩段文字
      const texts = rows.map((r, j) => r[0] + '｜數值 ' + r[1] + '｜' + (r[2] ? '成立（藍）' : '不成立（灰）') + '｜怎麼判斷：' + how(r[0], r[1], r[2], r[3]) + '｜下次更新：' + nextOf(j) + (plainOf(j).length ? '｜白話說明：' + plainOf(j).join('') : ''));
      const items = rows.map((r, j) => {
        const on = !!r[2], tp = x.topics && x.topics[j], pl = plainOf(j);
        return (j === of && extra.length ? '<li class="sp-gap">另外判斷的條件（' + (of + 1) + (rows.length > of + 1 ? '～' + rows.length : '') + '，不算在上面的 ' + of + ' 項裡）</li>' : '')
          + '<li class="sp-it ' + (on ? 'on' : 'off') + tag(j) + '" data-k="' + k + '" data-i="' + j + '" tabindex="-1">'
          + '<div class="sp-t"><span class="sp-n" aria-hidden="true">' + (j + 1) + '</span><b>' + esc(r[0]) + '</b><span class="sp-st">' + (on ? '✓ 成立' : '✕ 不成立') + '</span></div>'
          + '<div class="sp-l"><span class="sp-k">目前數值</span>' + esc(r[1]) + (r[3] !== '' && r[3] != null ? '<span class="sp-k sp-k2">距門檻</span>' + esc(r[3]) : '') + '</div>'
          + '<div class="sp-l"><span class="sp-k">怎麼判斷</span>' + esc(how(r[0], r[1], r[2], r[3])) + '</div>'
          + '<div class="sp-l"><span class="sp-k">下次更新</span>' + esc(nextOf(j)) + '</div>'
          + (pl.length ? '<div class="sp-l sp-pl"><span class="sp-k">白話說明</span>' + pl.map((t, q) => q ? '<span class="sp-p2">' + esc(t) + '</span>' : esc(t)).join('') + '</div>' : '')
          + (tp ? '<div class="sp-l"><span class="sp-k">消息主題</span>' + esc(tp) + '</div>' : '')
          + '</li>';
      }).join('');
      const fig = pie(k, main, texts, { a: d.votes, b: d.of, hold }, '', tag)
        + (onMain !== +d.votes ? '<p class="small sp-note">中間的成立數以定案紀錄為準（見下方說明）；各塊是重算的逐項結果。</p>' : '')
        + (extra.length ? '<p class="sp-x">另外判斷的條件（不算在 ' + of + ' 項裡）</p>' + pie(k, extra, texts, { a: onX, b: extra.length }, 'sp-mini', tag) : '')
        + '<p class="sp-leg"><span class="sp-sw on"></span>成立 ' + onAll + '<span class="sp-sw off"></span>不成立 ' + (rows.length - onAll) + '</p>' + flt;
      return open + head
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
    root.addEventListener('click', e => {
      const fb = e.target && e.target.closest && e.target.closest('.sp-fb');
      if (fb) {
        const g = fb.closest('.sp-flt'), one = fb.closest('.sp-one'), f = fb.getAttribute('data-f'); if (!g || !one) return;
        if (f === 'all') delete FLT[g.getAttribute('data-fk')]; else FLT[g.getAttribute('data-fk')] = f;
        ['q', 's', 'fx', 'pd'].forEach(c => one.classList.toggle('sp-f-' + c, f === c));
        g.querySelectorAll('.sp-fb').forEach(b => { const c = b === fb; b.classList.toggle('cur', c); b.setAttribute('aria-pressed', String(c)); });
        return;
      }
      const f = e.target && e.target.closest && e.target.closest('.sp-ft');
      if (f) { const one = f.closest('.sp-one'); if (one) foldOne(one, !one.classList.contains('sp-off')); return; }
      const t = e.target && e.target.closest && e.target.closest('.sp-sl'); if (t) { root.querySelectorAll('.hl').forEach(x => x.classList.remove('hl')); pick(t, true, true); }
    });
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
    // 2026-11-25 站主：「所有的下次更新時間只要有台北時間幾號的幾點幾分」「我要的更新時間是官方數據公布時間」
    //   價格條件＝月底最後一個交易日美股收盤（美東 16:00）的台北時間；
    //   金融環境數列＝那一類數據下一次官方公布的台北時間（opt.cal＝data/release-calendar.json、opt.topics＝data/daily-topics.json 的 topics；
    //   條件名稱對到哪個主題就用哪個時間表）。時間表裡找不到（沒有對應的時間表或日期已用完）才退回網站下一次排程抓資料的時間。
    //   approx＝官方沒有公告日期、依過去規律推定的，前面加「約」。
    let fin = '—';
    if (T) { const [y, mo, dd] = T.split('-').map(Number), g = Date.UTC(y, mo - 1, dd, 16); fin = '台北 ' + tpe(g + etOffset(g) * 36e5); }
    const cal = opt.cal || null, tps = (opt.topics || []).filter(t => t && t.rule && cal && cal.topics && cal.topics[t.code]).map(t => ({ re: new RegExp(t.rule), rel: cal.topics[t.code] }));
    const macro = cron ? '台北 ' + cron : fin;
    const relNext = code => { const r = cal && cal.releases && cal.releases[code]; if (!r) return ''; const t = (r.times || []).map(x => Date.parse(x.replace('Z', ':00Z'))).filter(x => x > now).sort((a, b) => a - b)[0]; return t ? (r.approx ? '約 ' : '') + '台北 ' + tpe(t) : ''; };
    const macroOf = label => { for (const t of tps) if (t.re.test(label)) { const v = relNext(t.rel); if (v) return v; } return macro; };
    // 本月確定：那一類數據下一次官方公布在月底收盤之後，而且上一次公布已經過了 3 小時（網站已經抓到）
    const closeMs = T ? (() => { const [y, mo, dd] = T.split('-').map(Number), g = Date.UTC(y, mo - 1, dd, 16); return g + etOffset(g) * 36e5; })() : 0;
    const relFixed = code => { const r = cal && cal.releases && cal.releases[code]; if (!r || !closeMs) return false; const ts = (r.times || []).map(x => Date.parse(x.replace('Z', ':00Z'))); const nx = ts.filter(x => x > now).sort((a, b) => a - b)[0], pv = ts.filter(x => x <= now).sort((a, b) => b - a)[0]; return !!nx && nx > closeMs && !(pv && now - pv < 3 * 36e5); };
    // 本月未定案（2026-11-25 站主）：官方公布時間介於現在和月底判斷時間之間的官方數據（剛公布未滿 3 小時、網站可能還沒抓到的也算）
    const relPend = code => { const r = cal && cal.releases && cal.releases[code]; if (!r || !closeMs) return false; const ts = (r.times || []).map(x => Date.parse(x.replace('Z', ':00Z'))); const nx = ts.filter(x => x > now).sort((a, b) => a - b)[0], pv = ts.filter(x => x <= now).sort((a, b) => b - a)[0]; return (!!nx && nx <= closeMs) || !!(pv && now - pv < 3 * 36e5); };
    const pendOf = label => { for (const t of tps) if (t.re.test(label)) return relPend(t.rel); return false; };
    const fixedOf = label => { for (const t of tps) if (t.re.test(label)) return relFixed(t.rel); return false; };
    return { official: fin, price: fin, macro, macroOf, fixedOf, pendOf, custom: '無（不會自動更新）' };
  }

  BN.sigpie = { html, bind, how, next, foldAll, side, plainRows };
})();
