/* BNASDAQ｜每日市場分析：每一則消息後面的「模型影響」（2026-11-22 站主）
   誰看得到什麼：
     沒登入 → 只顯示「會員專屬」
     會員   → 只有一句簡單說明：模型能力已可自動處理此訊息造成的影響（不提任何模型的判斷指標）；
              只提這個帳號開通的模型（2026-11-22 站主：每個帳號可看的模型由管理後台設定，預設只有入門模型；見 assets/auth.js「模型權限」）
     管理員 → 另外看得到這則消息對應到每個模型的哪些判斷條件（條件、目前數值、是否成立）
   本檔是公開的，不含任何策略規則、門檻，也沒有「哪個模型用哪些資料」的對照表。
   管理員看到的判斷條件全部來自登入後才解得開的會員規則（data/rules.enc.json，在瀏覽器解密、執行）；
   消息主題（data/daily-topics.json，通用的財經新聞分類）是在管理員的瀏覽器裡，和解密後的條件名稱逐一比對出來的。
   用法（daily.html）：BN.dm.ready() → 畫報告時 BN.dm.begin()、BN.dm.line(消息文字, 主題代碼)、BN.dm.sect() → 插進網頁後 BN.dm.mount(容器, 報告) */
(function () {
  'use strict';
  const BN = window.BN = window.BN || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sess = () => { try { const s = JSON.parse(sessionStorage.getItem('bn-session') || 'null'); return s && s.user ? s : null; } catch (e) { return null; } };
  const getJSON = (p, fresh) => fetch(p + (fresh ? '?t=' + Date.now() : ''), fresh ? { cache: 'no-store' } : undefined).then(r => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });
  const NUM = '零一二三四五六七八九十';
  const S0 = sess();
  // who＝這次瀏覽的身分；'admin' 只是「登入身分寫著管理員」，要通過 verifyAdmin 才會顯示判斷條件
  const ST = { who: !S0 ? 'visitor' : S0.role === 'admin' ? 'admin' : 'member', codes: null, items: [], adm: null, session: '' };
  const LOCK = '<a class="dm-mo" href="login.html?next=daily.html" data-mo-val>會員專屬</a>';
  // 這個帳號看得到幾個模型就怎麼稱呼：1 個＝直接寫代號、2 個＝兩大模型、3 個以上＝三大模型、四大模型…
  const group = () => { const n = ST.codes && ST.codes.length; return n === 1 ? ST.codes[0] : n === 2 ? '兩大模型' : n ? (n <= 10 ? NUM[n] : n) + '大模型' : '各模型'; };
  const none = () => !!ST.codes && ST.codes.length === 0;   // 登入了，但這個帳號沒有開通任何模型
  const NONE = '<span class="dm-mo">尚未開通模型</span>';
  const SAY = '模型能力已可自動處理此訊息造成的影響';

  let readyP = null;
  function ready() {   // 畫報告前先知道有幾個模型、叫什麼（只有登入後才需要）
    if (readyP) return readyP;
    if (ST.who === 'visitor') return (readyP = Promise.resolve());
    // 這個帳號開通的模型：每次都重讀帳號檔（管理員改過權限、帳號被停用，重新整理就生效）；讀不到時用登入當時記下的那一份
    return (readyP = (async () => {
      try { ST.codes = (await BN.auth.grants(S0)).codes; }
      catch (e) { ST.codes = Array.isArray(S0.codes) ? S0.codes : null; }
      try { ST.order = await BN.auth.modelOrder(); if (ST.codes) ST.codes = BN.auth.sortModels(ST.codes, ST.order, x => x); } catch (e) { ST.order = []; }   // 管理員設定的模型顯示順序
    })());
  }
  function begin() { ST.items = []; }

  // ---------- 每一則消息後面的那一行 ----------
  function line(text, tags) {
    if (ST.who === 'visitor') return '<div class="dm lock"><b class="dm-k">模型影響</b>' + LOCK + '</div>';
    if (none()) return '<div class="dm lock"><b class="dm-k">模型影響</b>' + NONE + '</div>';
    const i = ST.items.push({ text: String(text || ''), tags: Array.isArray(tags) ? tags : null }) - 1;
    return '<div class="dm ok" data-dm="' + i + '"><b class="dm-k">模型影響</b><span class="dm-s"><i aria-hidden="true">✓</i>' + esc(group()) + '：' + SAY + '</span></div>';
  }

  // ---------- 「消息對模型的影響」這一節 ----------
  const STEPS = [['消息發生', '國際大事與企業新聞'], ['模型自動處理', '不需要人工解讀'], ['月底自動判斷', '每月最後交易日收盤後'], ['次日開盤執行', '其餘交易日不操作']];
  function sect() {
    let h = '<h2 id="models">消息對模型的影響</h2>';
    if (ST.who === 'visitor') return h + '<p class="dm-lockp">' + LOCK + '</p>';
    if (none()) return h + '<p class="dm-lockp">' + NONE + '</p><p class="small">這個帳號目前沒有開通任何模型；需要開通請聯絡管理員。</p>';
    const names = ST.codes && ST.codes.length ? ST.codes.join('、') : '各模型';
    h += '<p class="lead">本頁每一則消息後面都標示「模型影響」。</p>';
    h += '<p>' + esc(names) + ' 都不需要人工解讀消息：每一則消息造成的影響，' + SAY.replace('此訊息造成的影響', '') + '。模型在每月最後一個交易日收盤後自動完成判斷，次一交易日開盤執行，其餘交易日不操作。</p>';
    h += '<div class="fig dm-fig"><div class="fsub">模型怎麼處理消息（四個步驟）</div><ol class="dm-flow">' + STEPS.map((s, i) => '<li><b>' + (i + 1) + '</b><span>' + s[0] + '</span><small>' + s[1] + '</small></li>').join('') + '</ol></div>';
    h += '<p class="small">各模型目前的持有與下個月的機率，請看<a href="member.html">會員專區</a>。</p>';
    if (ST.who === 'admin') h += '<div id="dm-admin" class="dm-admin"><p class="small">管理員專區載入中…</p></div>';
    return h;
  }

  function mount(root, report) {
    if (ST.who === 'visitor' || !root || none()) return;
    ST.session = (report && report.session) || '';
    const fig = root.querySelector('.dm-fig');
    if (fig && BN.play) {   // 動態走勢：四個步驟依序亮起
      const lis = Array.from(fig.querySelectorAll('.dm-flow li')), paint = k => lis.forEach((li, j) => { li.classList.toggle('on', j === k); li.classList.toggle('wait', k >= 0 && j > k); });
      try { BN.play.attach(fig, { n: lis.length, ms: 1100, frame: () => null, label: i => '第 ' + (i + 1) + '／' + lis.length + ' 步：' + STEPS[i][0], onFrame: paint, onEnd: () => paint(-1) }); } catch (e) { /* 播放功能出錯不影響內容 */ }
    }
    if (ST.who === 'admin') setTimeout(() => adminInit(root), 60);
  }

  // ---------- 以下只有管理員會執行 ----------
  // 判斷條件只給管理員看。除了登入身分是管理員，還要用這次登入導出的個人金鑰，解開「只有管理員本人解得開」的那把金鑰（data/accounts.json 的 view；
  // 2026-11-19 管理員查看密碼功能建立的）。會員就算自己把瀏覽器裡的身分改成管理員，也過不了這一關。網站沒有那把金鑰時，退回只核對帳號檔裡的身分。
  async function verifyAdmin(s) {
    const db = await getJSON('data/accounts.json', true);
    const rec = (db.accounts || []).find(a => a.user === s.user);
    if (!rec || rec.role !== 'admin' || rec.active === false) return false;
    const v = db.view;
    if (!v || !v.priv) return true;
    if (v.owner !== s.user || !s.uk) return false;
    try { await BN.auth.aesDec(BN.auth.b64.dec(s.uk), v.priv.iv, v.priv.ct); return true; } catch (e) { return false; }
  }

  async function adminInit(root) {
    const box = root.querySelector('#dm-admin'), s = sess(); if (!box || !s || !BN.auth) return;
    const say = h => { box.innerHTML = h; };
    let ok = false;
    try { ok = await verifyAdmin(s); } catch (e) { say('<p class="msg err">管理員專區：讀不到帳號資料，無法確認管理員身分（' + esc(e.message || e) + '）。請重新整理。</p>'); return; }
    if (!ok) { say('<p class="small">管理員專區：這次登入無法確認是管理員本人，所以不顯示判斷條件。請登出後重新登入管理員帳號。</p>'); return; }
    say('<p class="small">管理員專區：解密規則並計算中…</p>');
    try {
      const [rules, market, tb, rs, tj] = await Promise.all([BN.auth.loadRules(s), getJSON('data/market.json', true), getJSON('data/tb3ms.json', true).catch(() => null),
        getJSON('data/rules-status.json', true).catch(() => null), getJSON('data/daily-topics.json')]);
      if (!(rules.version >= 2)) { say('<p class="msg err">管理員專區：會員規則還是舊版，請先到管理後台完成「會員規則金鑰」設定。</p>'); return; }
      await new Promise(r => setTimeout(r, 30));   // 先讓「計算中」畫出來
      ST.adm = build(rules, rules.latest(market, tb), market, rs, tj);
      box.innerHTML = adminPanel(ST.adm); if (BN.sigpie) BN.sigpie.bind(box);
      root.querySelectorAll('.dm.ok[data-dm]').forEach(adminLine);
      // 即時（2026-11-24 站主：所有股價計算都用最新的即時價格）：開盤期間（含美股盤前盤後）QQQ 有新成交，就用即時價當作本月最新收盤重算
      // （BN.liveq.qqqMarket；至少間隔 1 分鐘，價格變動超過 0.3% 才提早）；已經展開的明細保持展開
      if (BN.liveq) {
        let last = 0, lastPx = 0; BN.liveq.want(['US']);
        const go = () => {
          const mk = BN.liveq.qqqMarket(market); if (!mk || document.hidden) return;
          if (Date.now() - last < 60e3 && Math.abs(mk.current.c / lastPx - 1) < 0.003) return;
          last = Date.now(); lastPx = mk.current.c;
          setTimeout(() => { try {
            const openAll = [...box.querySelectorAll('details.dm-all')].map(d => d.open);
            const openAdm = new Set([...root.querySelectorAll('.dm.ok[data-dm]')].filter(el => { const d = el.querySelector('.dm-adm'); return d && d.open; }).map(el => el.getAttribute('data-dm')));
            ST.adm = build(rules, rules.latest(mk, tb), mk, rs, tj);
            box.innerHTML = adminPanel(ST.adm);
            box.querySelectorAll('details.dm-all').forEach((d, i) => { if (openAll[i]) d.open = true; });
            root.querySelectorAll('.dm-adm').forEach(x => x.remove());
            root.querySelectorAll('.dm.ok[data-dm]').forEach(el => { adminLine(el); if (openAdm.has(el.getAttribute('data-dm'))) { const d = el.querySelector('.dm-adm'); if (d) d.open = true; } });
          } catch (e) { /* 下一次再試 */ } }, 0);
        };
        BN.liveq.on(go); setTimeout(go, 0);
      }
    } catch (e) {
      say('<p class="msg err">管理員專區載入失敗：' + esc(e && e.name === 'OperationError' ? '會員規則暫時無法解密（多半是剛更換金鑰），請稍後再試' : (e && e.message) || e) + '</p>');
    }
  }

  function build(rules, L, market, rs, tj) {
    const tp = (tj.topics || []).map(t => ({ code: t.code, name: t.name, kw: t.kw ? new RegExp(t.kw, 'i') : null, rule: t.rule ? new RegExp(t.rule) : null }));
    const prov = L.provisional || null, base = prov || L.lastComplete;
    const ms = BN.auth.sortModels(rules.STRATEGIES, ST.order || []).map(st => {
      const d = (base.detail && base.detail[st.id]) || null;
      const rows = ((d && d.rows) || []).map(r => { const label = String(r[0]); return { label, val: String(r[1]), ok: !!r[2], topics: tp.filter(t => t.rule && t.rule.test(label)).map(t => t.code) }; });
      return { id: st.id, d, rows, hold: L.lastComplete.w[st.id], next: prov ? prov.w[st.id] : null, flips: (L.flips && L.flips[st.id]) || {} };
    });
    return { rules, L, market, rs, tp, byCode: new Map(tp.map(t => [t.code, t])), ms, c: market.current || null, prov: !!prov, baseMonth: base.month };
  }

  // 這則消息的主題：報告有標記就用標記；沒有（舊報告）才用關鍵字比對
  function topicsOf(it, A) {
    const good = (it.tags || []).filter(x => A.byCode.has(x));
    if (good.length) return { codes: Array.from(new Set(good)), src: 'tag' };
    const hit = A.tp.filter(t => t.kw && t.kw.test(it.text)).map(t => t.code).slice(0, 6);
    return { codes: hit.length ? hit : (A.byCode.has('other') ? ['other'] : []), src: 'kw' };
  }
  const yn = b => b ? '<b class="pos">成立</b>' : '<span class="neg">不成立</span>';
  const pct = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(2) + '%';

  function adminLine(el) {
    const A = ST.adm, it = ST.items[+el.getAttribute('data-dm')]; if (!A || !it || el.querySelector('.dm-adm')) return;
    const tp = topicsOf(it, A), set = new Set(tp.codes);
    const hits = A.ms.map(m => ({ m, rows: m.rows.filter(r => r.topics.some(x => set.has(x))) })), direct = hits.filter(h => h.rows.length);
    const det = document.createElement('details'); det.className = 'dm-adm';
    det.innerHTML = '<summary><span class="dm-ak">判斷條件｜管理員</span><span class="dm-tp">主題：' + esc(tp.codes.map(x => A.byCode.get(x).name).join('、') || '—') + (tp.src === 'kw' ? '（關鍵字比對，可能不準）' : '') + '</span>'
      + '<span class="dm-hit' + (direct.length ? ' on' : '') + '">' + (direct.length ? '直接對應：' + direct.map(h => esc(h.m.id) + '（' + h.rows.length + ' 項）').join('、') : '沒有直接對應的判斷條件') + '</span></summary><div class="dm-body"></div>';
    det.addEventListener('toggle', () => { if (det.open && !det.getAttribute('data-done')) { det.setAttribute('data-done', '1'); det.querySelector('.dm-body').innerHTML = adminBody(hits); } });
    el.appendChild(det);
  }
  function adminBody(hits) {
    return hits.map(h => {
      const m = h.m, n = m.rows.length, sum = m.d ? esc(m.d.summary) : '資料暫時無法取得';
      let s = '<div class="dm-m"><div class="dm-mh"><b>' + esc(m.id) + '</b><span class="dm-path' + (h.rows.length ? ' on' : '') + '">' + (h.rows.length ? '數據＋價格' : '只經價格') + '</span></div>';
      if (h.rows.length) s += '<div class="dm-rows" role="list" aria-label="直接對應的判斷條件">' + h.rows.map(r => '<div class="dm-r" role="listitem"><span class="c">' + esc(r.label) + '</span><span class="v">目前 ' + esc(r.val) + '</span><span class="s">' + yn(r.ok) + '</span></div>').join('') + '</div>';
      s += '<p class="dm-n">' + (h.rows.length ? '其餘 ' + (n - h.rows.length) + ' 項條件和這則消息的主題沒有直接對應。' : (n ? '全部 ' + n + ' 項條件都和這則消息的主題沒有直接對應；消息只會透過 QQQ 月線（月底收盤與當月高低點）影響這個模型。' : ''))
        + '目前合計：' + sum + '</p></div>';
      return s;
    }).join('') + '<p class="dm-n">數值與合計是把最新收盤當作月底來推算的結果，完整條件見上方「管理員專區」。</p>';
  }

  function adminPanel(A) {
    const R = A.rules, L = A.L, c = A.c, T = R.holdingText, cls = w => w == null || w !== w ? '' : w >= 1 ? 'qld' : w <= 0 ? 'shv' : 'half';
    const holdM = L.lastComplete.month ? R.nextMonth(L.lastComplete.month) : '—', nextM = c ? R.nextMonth(c.m) : '—', bv = R.spec && R.spec.b_ver, rs = A.rs, warn = [];
    if (!rs) warn.push('讀不到同步狀態檔'); else if (rs.state !== 'ok') warn.push('會員規則同步中：' + (rs.note || '專案 B 區有更新')); else if (rs.b_ver !== bv) warn.push('規則與專案 B 區最新版本不一致');
    if (R.validUntil && c && c.m > R.validUntil) warn.push('模型已到期，需要重新訓練');
    const badge = w => '<span class="badge ' + cls(w) + '">' + esc(T(w)) + '</span>';
    const flip = m => {
      if (!c) return '—';
      const one = (x, sym) => x ? '月底收盤 ' + sym + ' <b>' + x.raw.toFixed(2) + '</b>（' + pct(x.raw / c.c - 1) + '）→ ' + esc(T(x.w)) : '';
      const p = [one(m.flips.down, '≤'), one(m.flips.up, '≥')].filter(Boolean);
      return p.length ? p.join('<br>') : '±40% 範圍內結論不變';
    };
    let h = '<h3>管理員專區：' + esc(group()) + '的判斷條件</h3>';
    const lv = A.market.live && A.market.live.ph !== 'close' ? A.market.live : null, lvTxt = lv && BN.liveq ? BN.liveq.tag(lv) + ' 即時價' : '收盤';
    h += '<p class="small">只有管理員登入時顯示，會員與訪客看不到這一區。市場資料截至 <b>' + esc(A.market.asof) + '</b>' + (c ? '（QQQ ' + esc(lvTxt) + ' <b>' + c.c.toFixed(2) + '</b>）；下面把' + (lv ? '即時價' : '最新收盤') + '當作 ' + esc(c.m) + ' 月底收盤來推算（決定 ' + esc(nextM) + ' 持有）' + (lv ? '，開盤期間約每分鐘重算' : '') : '') + '。規則版本 ' + esc(R.built) + '。</p>';
    if (ST.session && A.market.asof && ST.session < A.market.asof) h += '<p class="small">你正在看的是美股 ' + esc(ST.session) + ' 的舊報告；下面的數值是目前最新的，不是報告當天的。</p>';
    if (warn.length) h += '<p class="msg err">' + esc(warn.join('；')) + '</p>';
    h += '<div class="tblwrap"><table class="tbl dm-ov"><thead><tr><th class="l">模型</th><th class="l">' + esc(holdM) + ' 持有</th><th class="l">推算 ' + esc(nextM) + ' 持有</th><th>條件成立</th><th class="l">翻轉價位（距最新價格）</th></tr></thead><tbody>'
      + A.ms.map(m => '<tr><td class="l"><b>' + esc(m.id) + '</b></td><td class="l" data-l="' + esc(holdM) + ' 持有">' + badge(m.hold) + '</td><td class="l" data-l="推算 ' + esc(nextM) + ' 持有">' + (A.prov ? badge(m.next) : '—')
        + '</td><td data-l="條件成立">' + (m.d ? m.d.votes + '／' + m.d.of : '—') + '</td><td class="l" data-l="翻轉價位（距最新價格）">' + flip(m) + '</td></tr>').join('')
      + '</tbody></table></div>';
    // 2026-11-24：全部判斷條件改成圓餅（assets/sigpie.js）：每一塊＝一項條件，藍＝成立、灰＝不成立；每塊旁邊寫目前數值、怎麼判斷、下次更新時間、對應的消息主題
    const N = BN.sigpie ? BN.sigpie.next(R, A.market) : null, nx = N ? (A.prov ? { price: N.price, macro: N.macro } : { price: N.official, macro: N.official }) : {};
    h += A.ms.map(m => '<details class="dm-all"><summary><span>' + esc(m.id) + '：全部 ' + m.rows.length + ' 項判斷條件（圓餅：藍＝成立、灰＝不成立）與對應的消息主題</span></summary><div class="ans">'
      + (BN.sigpie ? BN.sigpie.html([{ id: m.id, d: m.d, topics: m.rows.map(r => r.topics.length ? r.topics.map(x => A.byCode.get(x).name).join('、') : '—（依 QQQ 月線計算）') }],
          { kind: A.prov ? 'prov' : 'official', next: nx, isMacro: (l, j) => !!(m.rows[j] && m.rows[j].topics.length) })
        : '<p class="dm-n">' + (m.d ? esc(m.d.summary) : '資料暫時無法取得') + '</p>')
      + '</div></details>').join('');
    h += '<ul class="dm-notes"><li>每則消息下方的「判斷條件｜管理員」：依消息主題列出各模型<b>直接對應</b>的條件（主題和條件用的是同一類公開數據）；沒有對應條件的模型，這則消息只會透過 QQQ 月線影響它。</li>'
      + '<li>消息主題：新的報告由排程逐則標記；沒有標記的舊報告改用關鍵字比對（可能不準），並標示「關鍵字比對」。</li>'
      + '<li>數值是把最新價格（開盤期間是 QQQ 即時成交）當作月底收盤時會採用的數值；之後才公布的月資料，要等公布後的月底才會進到模型。完整訊號與自訂收盤推算在<a href="admin.html">管理後台</a>。</li></ul>';
    return h;
  }

  BN.dm = { ready, begin, line, sect, mount, who: () => ST.who };
})();
