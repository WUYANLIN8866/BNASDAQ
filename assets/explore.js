/* 最新策略探索進度：讀取最新的探索進度快照並每 60 秒重繪（純前端，無伺服器）。
   資料來源依序：live 分支的 explore-live.json（raw → GitHub API）→ 本站部署的 data/explore-live.json。 */
(function () {
  'use strict';
  const REPO = 'WUYANLIN8866/BNASDAQ', BRANCH = 'live', FILE = 'explore-live.json';
  const LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
  const POLL_MS = 60 * 1000, STALE_MIN = 10;
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
      `<span class="xp-meta">${d.machines > 1 ? d.machines + ' 台 AI Server 同時運算・' : ''}最後更新 ${tpe(d.updated_at)}（台北時間）・${age < 1 ? '不到 1 分鐘前' : age + ' 分鐘前'}・本頁每 60 秒自動更新</span>`;
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
      tile('通過全部門檻', nf.format(d.passed || 0) + ' 組', '需同時通過報酬、回撤、穩健性與時間窗檢驗'),
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
    const days = []; let last = null; x.forEach((s, i) => { const k = s.slice(5, 10); if (k !== last) { days.push([i, k.replace('-', '/')]); last = k; } });
    const every = Math.max(1, Math.ceil(days.length / 8));
    const xTicks = days.filter((_, k) => k % every === 0);
    const xLabel = s => tpe(s);
    $('c-best').innerHTML = ''; $('c-tested').innerHTML = '';
    if (H.length > 1 && window.BN && BN.charts) {
      BN.charts.line($('c-best'), {
        title: '目前最佳候選的年化報酬率', sub: '每次發現更好的組合就上升；虛線為新策略必須超過的門檻', x, xTicks, xLabel, height: 300,
        yfmt: v => v.toFixed(1) + '%', tipfmt: v => v.toFixed(2) + '%',
        series: [
          { name: '目前最佳候選', short: '最佳候選', values: H.map(h => h[2] == null ? null : h[2] * 100), color: 'var(--s-fund)', width: 2.5 },
          { name: '門檻（現行最佳模型＋5 個百分點）', short: '門檻', values: H.map(() => d.target * 100), color: 'var(--bad)', dash: '6 4' },
          { name: '現行最佳模型', short: '現行', values: H.map(() => d.base * 100), color: 'var(--s-shv)', dash: '2 4' },
        ],
      });
      BN.charts.line($('c-tested'), {   // plain numbers on the axis and in the tooltip (user request 2026-11-07)
        title: '累計已回測的參數組數', x, xTicks, xLabel, height: 240, zero: true, padL: 124,
        yfmt: v => nf.format(Math.round(v)), tipfmt: v => nf.format(Math.round(v)),
        series: [{ name: '累計已回測', values: H.map(h => h[1]), color: 'var(--s-qld)', fill: true }],
      });
    }
    // stage table
    const badge = s => `<span class="badge xp-${s === '完成' ? 'done' : s === '進行中' ? 'run' : s === '暫停' ? 'pause' : 'wait'}">${esc(s)}</span>`;
    $('xp-stages').innerHTML = '<thead><tr><th class="l">階段</th><th class="l">狀態</th><th>進度</th><th>已回測組數</th><th>階段最佳年化</th></tr></thead><tbody>' +
      (d.stages || []).map(s => `<tr><td class="l">${esc(s.name)}</td><td class="l">${badge(s.status)}</td><td>${pct(s.pct, 1)}<div class="xp-mini"><i style="width:${Math.min(100, (s.pct || 0) * 100).toFixed(1)}%"></i></div></td><td>${full(s.tested)}</td><td>${s.best == null ? '—' : pct(s.best)}</td></tr>`).join('') + '</tbody>';
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
