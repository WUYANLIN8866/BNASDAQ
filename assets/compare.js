/* BNASDAQ｜個股對比共用：輸入台股／美股代號 → 讀 data/tw/<代號>.json → 交給頁面重繪。
   台股代號：4～6 碼、數字開頭（例 2330、0050、00631L）；美股：1～5 個英文字母（例 NVDA、BRK-B；BRK.B 會自動轉成 BRK-B）。 */
(function () {
  'use strict';
  window.BN = window.BN || {};
  const EXTRA = ['#7b3fa0', '#0e8f80', '#c85a17', '#4a6fa5', '#b02a2a', '#5c8a2e'];
  let INDEX = null, ADDED = [], O = {};
  const $ = id => document.getElementById(id);

  function norm(v) {
    v = String(v || '').trim().toUpperCase().replace(/\.TWO?$/, '').replace(/\s.*$/, '');
    if (/^[A-Z]+\.[A-Z]$/.test(v)) v = v.replace('.', '-');
    return v;
  }
  const isTW = c => /^[0-9][0-9A-Z]{3,5}$/.test(c);
  const isUS = c => /^[A-Z]{1,5}(-[A-Z])?$/.test(c);
  function label(code, name, market) { return market === 'US' ? code : (name ? name + ' ' + code : code); }
  function msg(t, kind) { const el = $(O.msg); if (el) el.innerHTML = t ? '<p class="msg ' + (kind || 'info') + '">' + t + '</p>' : ''; }

  async function loadIndex() {
    if (INDEX) return INDEX;
    try {
      const r = await fetch('data/tw/index.json', { cache: 'no-store' });
      if (!r.ok) return null;
      INDEX = await r.json();
      const dl = $(O.list);
      if (dl && !dl.children.length) {
        const frag = document.createDocumentFragment();
        (INDEX.list || []).forEach(x => {
          if (!x[4]) return;
          const o = document.createElement('option'); o.value = x[0];
          o.label = (x[1] || '') + (x[2] === 'US' ? '（美股）' : x[2] === 'TWO' ? '（上櫃）' : '（上市）');
          frag.appendChild(o);
        });
        dl.appendChild(frag);
      }
      return INDEX;
    } catch (e) { return null; }
  }

  function sync() {
    const chips = $(O.chips);
    if (chips) {
      chips.innerHTML = ADDED.map(a => '<span class="chip" title="' + (a.name || '') + '"><span class="sw" style="background:' + a.color + '"></span>' + a.label + ' <button type="button" aria-label="移除 ' + a.label + '" data-rm="' + a.code + '">✕</button></span>').join('');
      chips.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => remove(b.getAttribute('data-rm'))));
    }
    const url = new URL(location.href);
    const h = ADDED.length ? 'add=' + ADDED.map(a => a.code).join(',') : '';
    history.replaceState(null, '', url.pathname + url.search + (h ? '#' + h : ''));
    if (O.onChange) O.onChange(ADDED);
  }

  function remove(code) { ADDED = ADDED.filter(a => a.code !== code); sync(); }

  async function add(raw, silent) {
    const code = norm(raw);
    if (!code) return;
    if (!isTW(code) && !isUS(code)) { msg('代號格式不對：台股 4～6 碼（例 2454、00631L），美股 1～5 個英文字母（例 NVDA、BRK-B）。', 'err'); return; }
    if (O.baseCodes && O.baseCodes[code]) { msg(O.baseCodes[code] + ' 本來就在比較裡。', 'info'); return; }
    if (ADDED.some(a => a.code === code)) { msg(code + ' 已經加入了。', 'info'); return; }
    const max = O.max || 6;
    if (ADDED.length >= max) { msg('最多同時比 ' + max + ' 檔，請先移除一檔。', 'err'); return; }
    const btn = $(O.btn); if (btn) btn.disabled = true;
    msg('讀取 ' + code + '…', 'info');
    try {
      const idx = await loadIndex();
      const known = idx && (idx.list || []).find(x => x[0] === code);
      const r = await fetch('data/tw/' + encodeURIComponent(code) + '.json' + (idx && idx.updated ? '?v=' + idx.updated : ''), { cache: 'no-store' });
      if (r.status === 404) {
        msg(known ? ((known[1] || code) + '（' + code + '）資料尚未建好，通常是上市日晚於對比期末或資料來源沒有這檔；下次自動更新會再試。')
          : '找不到代號 ' + code + '：可能打錯、已下市，或尚未收錄（美股目前收錄 S&P 500、Nasdaq-100、常見 ETF 與熱門個股）。', 'err');
        return;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const name = d.name || (known && known[1]) || '';
      const market = d.market || (known && known[2]) || (isUS(code) ? 'US' : 'TW');
      if (O.validate) { const why = O.validate(d); if (why) { msg(why, 'err'); return; } }
      ADDED.push({ code, name, market, label: label(code, name, market), data: d, color: EXTRA[ADDED.length % EXTRA.length] });
      sync();
      msg(silent ? '' : '已加入 ' + label(code, name, market) + (O.addedNote ? O.addedNote(d) : ''), 'ok');
      const inp = $(O.input); if (inp) inp.value = '';
    } catch (e) { msg('讀取失敗：' + (e && e.message || e), 'err'); }
    finally { if (btn) btn.disabled = false; }
  }

  function init(opts) {
    O = opts || {};
    const form = $(O.form), inp = $(O.input);
    if (form) form.addEventListener('submit', e => { e.preventDefault(); add(inp ? inp.value : ''); });
    if (inp) inp.addEventListener('focus', loadIndex, { once: true });
    const m = (O.hash || location.hash).match(/add=([0-9A-Za-z,.-]+)/);
    const codes = m ? m[1].split(',') : [];
    (async () => { for (const c of codes) await add(c, true); })();
  }

  BN.compare = { init, add, remove, norm, label, loadIndex, list: () => ADDED, index: () => INDEX, EXTRA };
})();
