/* 最新策略探索進度：讀取最新的探索進度快照並每 2 分鐘重繪（純前端，無伺服器）。
   資料來源依序：live 分支的 explore-live.json（raw → GitHub API）→ 本站部署的 data/explore-live.json。 */
(function () {
  'use strict';
  const REPO = 'WUYANLIN8866/BNASDAQ', BRANCH = 'live', FILE = 'explore-live.json';
  const LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
  const POLL_MS = 120 * 1000, STALE_MIN = 10;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = new Intl.NumberFormat('zh-Hant-TW');
  const pct = (v, d) => v == null ? '—' : (v * 100).toFixed(d == null ? 2 : d) + '%';
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const UNITS = [[1e16, '京'], [1e12, '兆'], [1e8, '億'], [1e4, '萬']];
  // 萬／億／兆／京；10^20 以上改用科學記號（之後每輪組合數約 ×10）
  const big = (v, d) => {
    if (v == null) return '—';
    const a = Math.abs(v), dd = d == null ? 1 : d;
    if (a >= 1e20) { const e = Math.floor(Math.log10(a)); return (v / Math.pow(10, e)).toFixed(2) + '×10' + String(e).split('').map(c => SUP[+c]).join(''); }
    for (const [u, s] of UNITS) if (a >= u) return (v / u).toLocaleString('en-US', { minimumFractionDigits: u === 1e4 ? 0 : dd, maximumFractionDigits: u === 1e4 ? 0 : dd }) + ' ' + s;
    return nf.format(v);
  };
  const count = v => big(v, 2);
  const full = v => v == null ? '—' : nf.format(v);   // plain number, no 萬／億／兆 unit (user request 2026-11-07)
  const tpe = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || ''); return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : '—'; };
  const ageMin = iso => (Date.now() - Date.parse(iso)) / 60000;
  let DATA = null, lastKey = '';

  // 時間刻度（台北時間；台灣沒有夏令時間，固定 UTC+8）：每天 00:00 一個「月/日」；起點離第一個 00:00 超過半天時，起點也標日期；
  // 不到兩個刻度（資料不滿一天）改成每 6 小時；最多約 8 個標籤。charts.js 另有防重疊。
  const HOUR = 36e5, DAY = 24 * HOUR, TZ = 8 * HOUR, GAP_MS = 2 * HOUR;
  const p2 = v => String(v).padStart(2, '0');
  function timeTicks(t0, t1) {
    if (!(t1 > t0)) return [];
    const lab = (t, hm) => { const z = new Date(t + TZ), md = p2(z.getUTCMonth() + 1) + '/' + p2(z.getUTCDate()); return hm ? md + ' ' + p2(z.getUTCHours()) + ':00' : md; };
    let out = [];
    for (let t = Math.ceil((t0 + TZ) / DAY) * DAY - TZ; t <= t1; t += DAY) out.push([t, lab(t)]);
    if (out.length && out[0][0] - t0 >= DAY / 2) out.unshift([t0, lab(t0)]);
    if (out.length < 2) { out = []; for (let t = Math.ceil((t0 + TZ) / (6 * HOUR)) * 6 * HOUR - TZ; t <= t1; t += 6 * HOUR) out.push([t, lab(t, true)]); }
    const every = Math.max(1, Math.ceil(out.length / 8));
    return out.filter((_, k) => k % every === 0);
  }

  // GitHub API first (fresh within ~1 minute; the browser revalidates with ETag, and unchanged 304 replies do not
  // use up the 60-per-hour anonymous quota), then raw.githubusercontent.com (CDN copy, up to 5 minutes old),
  // then the copy deployed with the site.
  function sources() {
    const local = { url: 'data/' + FILE + '?t=' + Date.now(), cache: 'no-store' };
    if (LOCAL) return [local];
    return [
      { url: `https://api.github.com/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`, headers: { Accept: 'application/vnd.github.raw+json' } },
      { url: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}` },
      local,
    ];
  }

  async function load() {
    let best = null;
    for (const s of sources()) {
      try {
        const r = await fetch(s.url, { cache: s.cache || 'no-cache', headers: s.headers || {} });
        if (!r.ok) continue;
        const d = await r.json();
        if (d && d.v === 1 && d.updated_at && (!best || Date.parse(d.updated_at) > Date.parse(best.updated_at))) best = d;
        if (best && ageMin(best.updated_at) < 3) break;          // fresh enough: skip the slower sources
      } catch (e) { /* try the next source */ }
    }
    return best;
  }

  function statusInfo(d) {
    const age = ageMin(d.updated_at);
    if (d.status === 'found') return { cls: 'found', text: '找到通過全部門檻的候選，正在做最終驗證' };
    if (d.status === 'done') return { cls: 'done', text: '本輪搜尋已完成' };
    if (d.status === 'paused') return { cls: 'paused', text: '運算暫停中，恢復後本頁自動更新' };
    if (age > STALE_MIN) return { cls: 'stale', text: '暫時未收到新進度' };
    return { cls: 'live', text: '運算進行中' };
  }

  function renderStatus() {
    const d = DATA; if (!d) return;
    const st = statusInfo(d), age = Math.max(0, Math.round(ageMin(d.updated_at)));
    $('xp-status').className = 'xp-status ' + st.cls;
    $('xp-status').innerHTML = `<span class="xp-dot" aria-hidden="true"></span><b>${esc(st.text)}</b>` +
      `<span class="xp-meta">${d.machines > 1 ? d.machines + ' 台 AI Server 同時運算・' : ''}最後更新 ${tpe(d.updated_at)}（台北時間）・${age < 1 ? '不到 1 分鐘前' : age + ' 分鐘前'}・本頁每 2 分鐘自動更新</span>`;
  }

  // a long plain number stays on one line and shrinks only when its tile is too narrow (cqi = 1% of the tile's inner
  // width; 0.567 em per digit, 0.332 em per comma, measured on the page's serif figures) -- 2026-11-07
  const fitStyle = v => { const t = String(v), em = 0.567 * (t.match(/\d/g) || []).length + 0.332 * (t.match(/[,.]/g) || []).length + 0.05;
    return ` style="font-size:min(26px, calc(98cqi / ${em.toFixed(3)}))"`; };
  function tile(k, v, s, cls) { return `<div class="tile"><div class="k">${k}</div><div class="v${cls ? ' ' + cls : ''}"${cls === 'fit' ? fitStyle(v) : ''}>${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`; }

  function render() {
    const d = DATA; if (!d) return;
    renderStatus();
    const key = d.updated_at + '|' + d.status + '|' + d.tested;
    if (key === lastKey) return;          // same snapshot: only the relative time above needs refreshing
    lastKey = key;
    const gap = d.gap_pp == null ? null : d.gap_pp;
    $('xp-kv').innerHTML = [
      tile('本階段進度', pct(d.stage_pct, 1), d.stage ? esc(d.stage) : '—'),
      tile('累計已回測組數', full(d.tested), `涵蓋 ${full(d.types_tested)} 種方法組合`, 'fit'),
      tile('目前最佳候選年化報酬', pct(d.best), `目標 ${pct(d.target)}${gap != null ? `，還差 ${gap.toFixed(2)} 個百分點` : ''}`),
      // 2026-11-13: pass count as a 5-tuple, one figure per gate in the order of the list at the foot of the page
      // (cumulative: the k-th figure = candidates that passed gates 1..k, so the last one = passed everything)
      Array.isArray(d.gates) && d.gates.length === 5
        ? tile('過關數（第 1 → 5 關）', '(' + d.gates.map(g => nf.format(g || 0)).join(',') + ')', '依序為報酬、回撤、各時間窗、不使用未來資訊、參數穩健；每一格是連續通過到該關的候選數，最後一格才是全部通過')
        : tile('通過全部門檻', nf.format(d.passed || 0) + ' 組', '需同時通過報酬、回撤、穩健性與時間窗檢驗'),
      // tokens used by the AI session that runs the search on machine 1 (user request 2026-11-07), plain numbers
      d.tokens && d.tokens.total != null ? `<div class="tile xp-tok"><div class="k">AI 已使用 token 數量（所有 AI Server 合計）</div>` +
        `<div class="v">${full(d.tokens.total)}</div></div>` : '',          // total only (user 12:30: no per-machine figures)
    ].join('');
    // progress bar of the active stage
    const p = d.stage_pct || 0;
    $('xp-stage').textContent = d.stage || '—';
    $('xp-pct').textContent = pct(d.stage_pct, 1);
    $('xp-fill').style.width = Math.min(100, Math.max(0, p * 100)).toFixed(2) + '%';
    $('xp-track').setAttribute('aria-valuenow', (p * 100).toFixed(1));
    const eta = d.eta_min != null && d.status === 'running' ? `；以目前速度，本階段約還需 ${(d.eta_min / 60).toFixed(1)} 小時運算` : '';
    $('xp-sub').textContent = d.stage_types_done != null ? `已完成 ${full(d.stage_types_done)}／${full(d.stage_types_total)} 種方法組合${eta}` : '';
    // charts
    const H = d.history || [];
    const x = H.map(h => h[0]);
    // X 軸依實際時間（2026-11-11：運算暫停 57 小時後恢復，一點一格的軸把 11/09、11/11 擠在一起）
    const xPos = H.map(h => Date.parse(h[0]));
    const xTicksAt = timeTicks(xPos[0], xPos[xPos.length - 1]);
    const bands = [];          // 超過 2 小時沒有進度回報的區段（暫停或關機）標成灰色
    for (let i = 1; i < H.length; i++) if (xPos[i] - xPos[i - 1] > GAP_MS) bands.push({ from: i - 1, to: i, color: 'rgba(128,128,128,.14)' });
    const gapNote = bands.length ? '灰色區塊＝超過 2 小時沒有進度回報（運算暫停或機器關閉）' : '';
    const xLabel = s => tpe(s);
    $('c-best').innerHTML = ''; $('c-tested').innerHTML = '';
    if (H.length > 1 && window.BN && BN.charts) {
      BN.charts.line($('c-best'), {
        title: '目前最佳候選的年化報酬率', sub: '每次發現更好的組合就上升；虛線為新策略必須超過的門檻' + (gapNote ? '；' + gapNote : ''), x, xPos, xTicksAt, bands, xLabel, height: 300,
        yfmt: v => v.toFixed(1) + '%', tipfmt: v => v.toFixed(2) + '%',
        series: [
          { name: '目前最佳候選', short: '最佳候選', values: H.map(h => h[2] == null ? null : h[2] * 100), color: 'var(--s-fund)', width: 2.5 },
          { name: '門檻（現行最佳模型＋5 個百分點）', short: '門檻', values: H.map(() => d.target * 100), color: 'var(--bad)', dash: '6 4' },
          { name: '現行最佳模型', short: '現行', values: H.map(() => d.base * 100), color: 'var(--s-shv)', dash: '2 4' },
        ],
      });
      BN.charts.line($('c-tested'), {   // plain numbers on the axis and in the tooltip (user request 2026-11-07)
        title: '累計已回測的參數組數', sub: gapNote || null, x, xPos, xTicksAt, bands, xLabel, height: 240, zero: true, padL: 124,
        yfmt: v => nf.format(Math.round(v)), tipfmt: v => nf.format(Math.round(v)),
        series: [{ name: '累計已回測', values: H.map(h => h[1]), color: 'var(--s-qld)', fill: true }],
      });
    }
    // stage table
    const badge = s => `<span class="badge xp-${s === '完成' ? 'done' : s === '進行中' ? 'run' : s === '暫停' ? 'pause' : 'wait'}">${esc(s)}</span>`;
    $('xp-stages').innerHTML = '<thead><tr><th class="l">階段</th><th class="l">狀態</th><th>進度</th><th>已回測組數</th><th>階段最佳年化</th></tr></thead><tbody>' +
      (d.stages || []).map(s => `<tr><td class="l">${esc(s.name)}</td><td class="l">${badge(s.status)}</td><td>${pct(s.pct, 1)}<div class="xp-mini"><i style="width:${Math.min(100, (s.pct || 0) * 100).toFixed(1)}%"></i></div></td><td>${full(s.tested)}</td><td>${s.best == null ? '—' : pct(s.best)}</td></tr>`).join('') + '</tbody>';
    // candidates that passed gate 1 (return above the bar): result of each of the 5 gates and why a gate failed.
    // Only gate results and their figures are published; methods, parameters and rules stay private. -- 2026-11-13
    const C = Array.isArray(d.cands) ? d.cands : [];
    const GW = { pass: ['done', '通過'], fail: ['bad', '未通過'], pending: ['run', '驗證中'], skip: ['wait', '未驗'] };
    const gb = g => { const w = GW[g] || ['wait', '—']; return `<span class="badge xp-${w[0]}">${w[1]}</span>`; };
    if ($('xp-cands')) {
      const open = new Set([...document.querySelectorAll('#xp-cand-notes details[open]')].map(e => e.getAttribute('data-id')));
      $('xp-cands-none').hidden = C.length > 0;
      $('xp-cands').innerHTML = !C.length ? '' : '<thead><tr><th class="l">編號</th><th>年化報酬率</th><th>1 報酬</th><th>2 回撤</th><th>3 時間窗</th><th>4 未來資訊</th><th>5 穩健</th><th class="l">結論</th></tr></thead><tbody>' +
        C.map(c => `<tr><td class="l">${esc(c.id)}</td><td>${pct(c.cagr)}</td>${[0, 1, 2, 3, 4].map(k => `<td>${gb((c.g || [])[k])}</td>`).join('')}<td class="l">${esc(c.verdict)}</td></tr>`).join('') + '</tbody>';
      $('xp-cand-notes').innerHTML = C.map(c => `<details class="xp-cand" data-id="${esc(c.id)}"${open.has(String(c.id)) ? ' open' : ''}><summary><b>${esc(c.id)}</b>　年化 ${pct(c.cagr)}　${esc(c.verdict)}</summary>` +
        `<div class="ans"><p><b>原因：</b>${esc(c.reason).replace(/\n/g, '<br>')}</p><ol>${(c.nums || []).map(n => `<li>${esc(n)}</li>`).join('')}</ol></div></details>`).join('');
    }
    // top candidates (combination contents are trading rules and stay private)
    $('xp-top').innerHTML = '<thead><tr><th>名次</th><th>年化報酬率</th><th>與門檻差距</th><th class="l">來源階段</th></tr></thead><tbody>' +
      (d.top || []).map(t => `<tr><td>${t.rank}</td><td>${pct(t.best)}</td><td>${((t.best - d.target) * 100).toFixed(2)} 個百分點</td><td class="l">${esc(t.stage)}</td></tr>`).join('') + '</tbody>';
  }

  async function tick() {
    const d = await load();
    if (d) { DATA = d; render(); $('xp-err').hidden = true; }
    else if (!DATA) { $('xp-err').hidden = false; }
  }

  function start() {
    tick();
    setInterval(() => { if (!document.hidden) tick(); }, POLL_MS);
    setInterval(renderStatus, 15 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
