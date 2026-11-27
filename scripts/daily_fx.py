#!/usr/bin/env python3
"""每日市場分析「美元與台幣視角」的數字（2026-11-27 站主要求；寫法說明見 scripts/daily_fx.md）。

數字一律由這支程式從本站即時快照現抓、現算，不交給人或 AI 填：
  來源＝heatmap-live 分支的 us.json、tw.json 的報價板 mb（scripts/heatmap_live.py 每分鐘更新；行情來源 Yahoo Finance，加權指數為 Yahoo奇摩股市）
    mb.q[代號]＝[最新價, 前一交易日收盤, 報價時間]；mb.w[代號]＝上週最後一個交易日的收盤
  兩個檔都有同一個代號時用報價時間較新的；抓不到就留空（網頁顯示「資料暫缺」），不用估計值代替。
  單日漲跌＝最新價÷前一交易日收盤−1；近一週漲跌＝最新價÷上週最後一個交易日收盤−1；殖利率用相減（百分點）。

用法：
  python3 scripts/daily_fx.py            # 印出現在的數字（寫報告前先看這個再判斷情境）
  python3 scripts/daily_fx.py --json     # 印 JSON
環境變數 BN_FX_DIR：改從這個資料夾讀 us.json、tw.json（測試用）。只用標準函式庫。
"""
import datetime as dt, json, os, subprocess, sys, urllib.request

REPO = 'WUYANLIN8866/BNASDAQ'
# 鍵 → (快照代號, 名稱, 類型)；類型 pct＝漲跌用百分比，yld＝殖利率（變動用百分點）
ITEMS = [('dxy', 'DX-Y.NYB', '美元指數', 'pct'), ('usdtwd', 'TWD=X', '美元兌台幣', 'pct'), ('us10y', '^TNX', '美國 10 年期公債殖利率', 'yld'),
         ('gold', 'GC=F', '黃金', 'pct'), ('wti', 'CL=F', '西德州原油', 'pct'), ('ndx', '^NDX', '那斯達克 100', 'pct'),
         ('spx', '^GSPC', '標普 500', 'pct'), ('sox', '^SOX', '費城半導體', 'pct'), ('twii', '^TWII', '台股加權指數', 'pct')]
SCENARIOS = {'usd_spike': '美元急拉', 'cash_panic': '恐慌搶現金', 'usd_exit': '資金撤離美元資產', 'none': '無明顯訊號'}
BAN = ('BNASDAQ', '模型', '策略', '持倉', '訊號', '2611')   # 本節不得提到本站模型的任何判斷指標或條件


def _fetch(name):
    d = os.environ.get('BN_FX_DIR')
    if d:
        try:
            return json.load(open(os.path.join(d, name), encoding='utf-8'))
        except Exception:
            return None
    try:   # gh 讀得到最新的一份（raw 網址會被快取 5 分鐘）
        r = subprocess.run(['gh', 'api', f'repos/{REPO}/contents/{name}?ref=heatmap-live', '-H', 'Accept: application/vnd.github.raw+json'],
                           capture_output=True, timeout=40)
        if r.returncode == 0 and r.stdout.strip().startswith(b'{'):
            return json.loads(r.stdout)
    except Exception:
        pass
    try:
        with urllib.request.urlopen(urllib.request.Request(f'https://raw.githubusercontent.com/{REPO}/heatmap-live/{name}', headers={'User-Agent': 'bnasdaq-daily-fx'}), timeout=25) as r:
            return json.loads(r.read())
    except Exception:
        return None


def collect(now=None):
    """回傳 {'asof': ISO（UTC）, 'data': {鍵: {'v','d1','w1','t'} 或 None}}。t＝那筆報價的時間（ISO，UTC）。"""
    now = now or dt.datetime.now(dt.timezone.utc)
    snaps = [s for s in (_fetch('us.json'), _fetch('tw.json')) if isinstance(s, dict)]
    data = {}
    for key, sym, name, kind in ITEMS:
        best, wk = None, None
        for s in snaps:
            mb = s.get('mb') or {}
            v = (mb.get('q') or {}).get(sym)
            if isinstance(v, list) and len(v) >= 3 and all(isinstance(x, (int, float)) for x in v[:3]) and v[0] > 0 and v[1] > 0:
                if v[2] <= now.timestamp() + 600 and (best is None or v[2] > best[2]):
                    best, wk = v, (mb.get('w') or {}).get(sym)
        if not best:
            data[key] = None
            continue
        p, prev, t = best[:3]
        ok = isinstance(wk, (int, float)) and wk > 0
        if kind == 'yld':
            d1, w1 = round(p - prev, 3), (round(p - wk, 3) if ok else None)
        else:
            d1, w1 = round((p / prev - 1) * 100, 2), (round((p / wk - 1) * 100, 2) if ok else None)
        data[key] = {'v': round(p, 4), 'prev': round(prev, 4), 'wk': (round(wk, 4) if ok else None), 'd1': d1, 'w1': w1,
                     't': dt.datetime.fromtimestamp(int(t), dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
    # 美股盤前、盤後：指數本身沒有報價（停在最近一個交易日收盤），「今天」的漲跌用追蹤 ETF 的盤前／盤後成交推估（相對前一交易日收盤），
    # 這樣才能和今天的匯率變動配成同一天。ETF 那筆成交超過 30 分鐘前就不用。
    for key, etf in (('ndx_now', 'QQQ'), ('spx_now', 'SPY')):
        data[key] = None
        for s in snaps:
            mb, ext = s.get('mb') or {}, s.get('ext')
            x, q = (mb.get('x') or {}).get(etf), (mb.get('q') or {}).get(etf)
            if s.get('market') != 'US' or ext not in ('pre', 'post') or s.get('xstate') != 'open' or not (isinstance(x, list) and len(x) >= 3):
                continue
            base = x[1] if ext == 'pre' else (q[1] if isinstance(q, list) and len(q) >= 2 else None)   # 盤後：相對前一交易日收盤（含當天正規時段）
            if not base or base <= 0 or x[0] <= 0 or not (now.timestamp() - 1800 <= x[2] <= now.timestamp() + 600):
                continue
            data[key] = {'d1': round((x[0] / base - 1) * 100, 2), 'etf': etf, 'phase': '盤前' if ext == 'pre' else '盤後', 'px': round(x[0], 4), 'base': round(base, 4),
                         't': dt.datetime.fromtimestamp(int(x[2]), dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
    return {'asof': now.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'data': data}


def _texts(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from _texts(v)
    elif isinstance(x, list):
        for v in x:
            yield from _texts(v)


def validate(fx, data):
    """檢查報告裡 fx 的文字欄位（情境、依據、台幣升貶原因、對三種持有人的提醒）。回傳問題清單；空的＝通過。"""
    errs = []
    if not isinstance(fx, dict):
        return ['缺少 fx 欄位（「美元與台幣視角」的情境判斷與說明）']
    sc = fx.get('scenario')
    if sc not in SCENARIOS:
        errs.append(f'fx.scenario 要是 {"／".join(SCENARIOS)} 其中一個，收到 {sc!r}')
    b = fx.get('basis')
    if not (isinstance(b, list) and b and all(isinstance(x, str) and x.strip() for x in b)):
        errs.append('fx.basis 要列出判斷依據是哪幾個數據（字串陣列，至少 1 項）')
    r = fx.get('twd_reasons')
    if not (isinstance(r, list) and all(isinstance(x, str) and x.strip() for x in r)):
        errs.append('fx.twd_reasons 要是字串陣列：台幣當日升貶的可能原因，每一項都要附來源；沒有新聞或數據佐證就給空陣列 []')
    h = fx.get('holders')
    if not (isinstance(h, dict) and all(isinstance(h.get(k), str) and h.get(k).strip() for k in ('etf', 'usd', 'tw'))):
        errs.append('fx.holders 要有 etf（持有美股 ETF）、usd（美元存款）、tw（持有台股）各一句話')
    f = fx.get('foreign')
    if f is not None and not (isinstance(f, dict) and all(isinstance(f.get(k), str) and f.get(k).strip() for k in ('net', 'date', 'src'))):
        errs.append('fx.foreign 沒有資料就給 null；有資料要有 net（例 "賣超 123.4 億元"）、date（例 "11/27"）、src（來源）')
    txt = ' '.join(_texts({k: fx.get(k) for k in ('basis', 'twd_reasons', 'holders', 'foreign', 'lead')}))
    bad = [w for w in BAN if w in txt]
    if bad:
        errs.append('fx 的文字不得提到本站模型、策略、持倉或訊號（出現：' + '、'.join(bad) + '）')
    g = lambda k: (data.get(k) or {}).get('d1')
    dxy, tnx, gold = g('dxy'), g('us10y'), g('gold')
    ndx, spx = (g('ndx_now') if data.get('ndx_now') else g('ndx')), (g('spx_now') if data.get('spx_now') else g('spx'))   # 盤前盤後用 ETF 推估的當下漲跌
    stock_dn = any(x is not None and x < 0 for x in (ndx, spx))
    if sc == 'usd_spike' and ((dxy is not None and dxy <= 0) or (tnx is not None and tnx <= 0) or (None not in (ndx, spx) and not stock_dn)):
        errs.append(f'fx.scenario＝usd_spike（美元急拉）和現在的數字不符：美元指數 {dxy}%、10 年期殖利率變動 {tnx}、那指 {ndx}%、標普 {spx}%（要美元漲、殖利率升、股票跌）')
    if sc == 'cash_panic' and ((dxy is not None and dxy <= 0) or (gold is not None and gold >= 0) or (None not in (ndx, spx) and not stock_dn)):
        errs.append(f'fx.scenario＝cash_panic（恐慌搶現金）和現在的數字不符：美元指數 {dxy}%、黃金 {gold}%、那指 {ndx}%、標普 {spx}%（要美元漲、黃金跌、股票跌）')
    if sc == 'usd_exit' and ((dxy is not None and dxy >= 0) or (None not in (ndx, spx) and not stock_dn)):
        errs.append(f'fx.scenario＝usd_exit（資金撤離美元資產）和現在的數字不符：美元指數 {dxy}%、那指 {ndx}%、標普 {spx}%（要美股跌、美元也跌）')
    return errs


def table(res):
    tpe = dt.timezone(dt.timedelta(hours=8))
    hm = lambda iso: dt.datetime.strptime(iso, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc).astimezone(tpe).strftime('%m/%d %H:%M')
    out = [f'「美元與台幣視角」現在的數字（台北 {hm(res["asof"])} 抓；本站即時快照）：']
    for key, sym, name, kind in ITEMS:
        v = res['data'].get(key)
        if not v:
            out.append(f'  {name}：資料暫缺'); continue
        u = ' 個百分點' if kind == 'yld' else '%'
        f = lambda x: '資料暫缺' if x is None else f'{x:+}{u}'
        out.append(f'  {name}：{v["v"]}｜單日 {f(v["d1"])}｜近一週 {f(v["w1"])}｜報價時間 台北 {hm(v["t"])}')
    for key, name in (('ndx_now', '那斯達克 100'), ('spx_now', '標普 500')):
        v = res['data'].get(key)
        if v:
            out.append(f'  {name} 現在（{v["phase"]}，以 {v["etf"]} 推估）：{v["d1"]:+}%（{v["px"]}÷{v["base"]}−1）｜成交時間 台北 {hm(v["t"])}')
    return '\n'.join(out)


if __name__ == '__main__':
    r = collect()
    print(json.dumps(r, ensure_ascii=False, indent=1) if '--json' in sys.argv else table(r))
