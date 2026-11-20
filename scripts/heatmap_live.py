#!/usr/bin/env python3
"""BNASDAQ｜市值熱力圖盤中更新（每日市場分析頁最上方那張圖）。

做什麼：開盤期間定時（台股每 30 秒、美股每 60 秒）抓一次成分股的最新價，算出「相對前一交易日收盤（台股為來源的參考價）」的漲跌，
       寫成一個小 JSON 放到 heatmap-live 分支；網頁（daily.html）盤中用同樣的間隔讀、重畫方塊顏色與大小。
       收盤後的正式資料仍由 scripts/fetch_heatmap.py 產生（data/heatmap/latest.json），這支程式不會動它。

資料來源（都是公開報價；2026-11-16 09:00～09:07 從 GitHub runner 實測）：
  台股  Yahoo奇摩股市前端用的報價 API（一次 50 檔、約 0.5 秒、報價時間只落後 4 秒）；失敗時改用鉅亨網報價 API（每批 10 檔）。
        不用證交所「基本市況報導」mis.twse.com.tw：從 GitHub 的機器讀，同一份資料會重複回 1～2 分鐘，而且成交價欄位多半是空的（實測 13 次輪詢都是同一份）。
        不用 Yahoo 國際版的 .TW 報價：開盤 7 分鐘後仍是前一個交易日的價格（延遲報價）。
  美股  Yahoo Finance spark（每批最多 20 檔、27 批、4 條連線約 0.7 秒；現價＝regularMarketPrice、前收＝上一根日 K 的收盤）。
        盤中實測（11-16 22:40～22:53）：522 檔全有報價、沒有被限流；同一網址會被快取 5 分鐘，所以每輪要帶不同的參數（見 yahoo_batch）。
        不用 Nasdaq 篩選器：實測回的是前一天的價格，而且會擋雲端主機。

放哪裡（heatmap-live 分支，只留最新一筆 commit，不會越積越多）：
  tw.json、us.json                 各市場「最新一份」；收盤後就是收盤那一份
  tw-<時間格>.json、us-<時間格>.json   時間格＝UNIX 秒 ÷ 該市場的間隔（台股 30、美股 60）取整數；每個時間格一個不會再變的檔名，只留最近 8 個。
  為什麼要時間格檔：raw.githubusercontent.com 同一個網址會被快取 5 分鐘（網址加參數也沒用，2026-11-16 實測），
  檔名每一格換一個，網頁才讀得到最新的資料；新檔名推上去後立刻讀得到（實測 0.2～0.3 秒）。
  間隔為什麼不能更短：每次發布要對 GitHub 寫 3 次（tree、commit、ref），GitHub 文件規定寫入類請求每小時不超過 500 次、
  每分鐘不超過 80 次（secondary rate limit）；30 秒一次＝每小時 360 次，20 秒一次＝540 次就超過了。

怎麼啟動（.github/workflows/heatmap-live.yml）：
  gate     判斷現在要不要跑：90 分鐘內有開盤（或正在盤中）、而且沒有別的 run 正在跑 → go
  session  等到開盤 → 每一格更新一次 → 收盤後多抓幾分鐘（收盤價到齊）→ 標成 closed 結束。
           一個 job 最多跑 320 分鐘，超過就自己啟動下一棒接手（美股一個交易日 6.5 小時，要兩棒）。
  開盤後 25 分鐘都沒有當天的報價＝休市，直接結束、不發布。
  收盤後（台股 +150 秒、美股 +10 分鐘）session 會啟動 tw-latest.yml，把全站的最新收盤價更新到當天並重新部署；
  gate 被外部準時啟動時另外檢查一次：有市場已收盤但收盤價還落後，就補啟動 tw-latest.yml。

用法：
  python3 scripts/heatmap_live.py gate
  python3 scripts/heatmap_live.py run [--market TW|US]
  python3 scripts/heatmap_live.py once --market TW        # 抓一次、印摘要，不發布（檢查來源用）
環境變數：GITHUB_TOKEN、GITHUB_REPOSITORY、GITHUB_RUN_ID、GITHUB_OUTPUT、GITHUB_REF_NAME；RELAY（上一棒的 run 編號）、MARKET（指定市場）、
          HM_BUDGET（測試交棒用：一個 job 最多跑幾秒，預設 19200）。
只用 Python 標準函式庫。"""
import base64
import concurrent.futures as cf
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'data', 'heatmap', 'latest.json')
BRANCH = 'heatmap-live'
WORKFLOW = 'heatmap-live.yml'
AFTER = 'tw-latest.yml'   # 每個市場收盤後要啟動的工作流程：更新全站的最新收盤價（scripts/fetch_latest.py）並重新部署
SCHEMA = 'bnasdaq-heatmap-live/1'
KEEP = 8             # 時間格檔留最近幾個（每個市場多久發布一次寫在 MARKETS 的 step）
LEAD = 90 * 60       # 開盤前最多提早多久進場等
BUDGET = 320 * 60    # 一個 job 最多跑多久；之後交棒（GitHub 單一 job 上限 6 小時）
HOLIDAY = 25 * 60    # 開盤後這麼久都沒有當天報價＝休市
FREEZE = 25 * 60     # 盤中連續這麼久「抓得到資料、但最新報價時間沒有前進」＝提早收盤（熔斷暫停 15 分鐘不算）
YUA = 'Mozilla/5.0 (BNASDAQ heatmap fetch)'   # Yahoo：瀏覽器 UA 會被回 429（實測）
BUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
MARKETS = {
    # after＝收盤後幾秒啟動「最新收盤價更新」：台股 13:30 集合競價撮合完就是收盤價，等 150 秒；美股等 10 分鐘（fetch_latest.py 只收 16:10 美東之後的當天 K 棒）
    # pstep＝當日走勢（2026-11-20 使用者：熱力圖每格加當日走勢圖）幾秒一點；美股 6.5 小時 26 點、台股 4.5 小時 27 點，快照多約 60 KB
    'TW': dict(tz='Asia/Taipei', open=(9, 0), close=(13, 30), tail=6 * 60, after=150, sets=('tw50', 'twse', 'tpex'), file='tw', step=30, pstep=600, src='Yahoo奇摩股市'),
    # step＝一個時間格幾秒（＝多久發布一次）。美股一輪要對 Yahoo 發 27 個請求，先維持 60 秒
    'US': dict(tz='America/New_York', open=(9, 30), close=(16, 0), tail=10 * 60, after=10 * 60, sets=('ndx', 'spx', 'sox'), file='us', step=60, pstep=900, src='Yahoo Finance'),
}
README = ('# heatmap-live\n\n這個分支由 `.github/workflows/heatmap-live.yml` 在開盤期間定時自動覆寫（只留最新一筆 commit），'
          '內容是市值熱力圖的盤中報價。請勿手動修改；程式在 main 分支的 `scripts/heatmap_live.py`。\n')


def log(*a):
    print(dt.datetime.now(ZoneInfo('Asia/Taipei')).strftime('%H:%M:%S'), *a, flush=True)


def note(*a):
    """重要的結果另外寫成 GitHub 的 notice 註記（用 API 就查得到，不必下載整份紀錄）。"""
    log(*a)
    if os.environ.get('GITHUB_ACTIONS'):
        print('::notice title=heatmap-live::' + ' '.join(str(x) for x in a).replace('%', '%25').replace('\r', ' ').replace('\n', ' '), flush=True)


# ---------- 交易時段 ----------
def session(mk, now):
    """now 所在的當地日期那一天的交易時段（週一到週五）；週末回 None。休市日由「開盤後沒有當天報價」判斷。"""
    c = MARKETS[mk]
    d = dt.datetime.fromtimestamp(now, ZoneInfo(c['tz']))
    if d.weekday() >= 5:
        return None
    o = d.replace(hour=c['open'][0], minute=c['open'][1], second=0, microsecond=0)
    e = d.replace(hour=c['close'][0], minute=c['close'][1], second=0, microsecond=0)
    return {'date': d.strftime('%Y-%m-%d'), 'open': int(o.timestamp()), 'close': int(e.timestamp())}


def active(mk, now):
    """開盤前 LEAD 秒到收盤後 tail 秒之間 → 回傳時段；否則 None。"""
    s = session(mk, now)
    return s if s and s['open'] - LEAD <= now < s['close'] + MARKETS[mk]['tail'] else None


# ---------- HTTP ----------
def http(url, ua=YUA, headers=None, timeout=12, data=None, method=None):
    h = {'User-Agent': ua, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9'}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h, data=data, method=method), timeout=timeout) as r:
        return r.status, r.read()


SUFFIX = {}      # 台股代號 → Yahoo奇摩股市的後綴（上市 .TW、上櫃 .TWO）
PATHSET = None   # 要記當日走勢的代號；None＝全部。台股全上市／全上櫃近兩千檔，只記方塊大到畫得下走勢圖的那些（台灣 50＋兩個分頁各前 150 大）


def universe(mk):
    """要抓哪些代號：正式熱力圖檔裡這個市場所有分頁的成分股（去重、保留順序）。"""
    global PATHSET
    d = json.load(open(BASE, encoding='utf-8'))
    out, seen, ps = [], set(), set()
    for k in MARKETS[mk]['sets']:
        tiles = (d.get('sets', {}).get(k) or {}).get('tiles') or []
        for i, t in enumerate(tiles):
            if not t:
                continue
            c = str(t[0])
            if k == 'tpex':
                SUFFIX[c] = '.TWO'
            if k not in ('twse', 'tpex') or i < 150:
                ps.add(c)
            if c not in seen:
                seen.add(c); out.append(c)
    PATHSET = ps if mk == 'TW' and any(k in ('twse', 'tpex') for k in MARKETS[mk]['sets']) else None
    return out


def num(x):
    try:
        v = float(str(x).replace(',', ''))
        return v if v == v and abs(v) != float('inf') else None
    except Exception:
        return None


# ---------- 美股：Yahoo spark ----------
def yahoo_batch(batch, nonce=None):
    """回傳 (狀態碼, {代號: (現價, 上一個交易日收盤, 報價時間, (正規時段開始, 結束) 或 None)})

    兩件 2026-11-16 美股盤中實測才發現的事：
    1. 前收要用「上一根日 K 的收盤」（所以抓 range=5d）。meta 的 chartPreviousClose 在除息日是扣掉股息後的價格
       （UPS：chartPreviousClose 110.76，實際上一日收盤 112.40），regularMarketChangePercent 也是用它算的；
       用它算出來的漲跌會和一般報價、以及收盤後的正式資料不一樣（當天 522 檔裡有 21 檔差 0.1 個百分點以上）。
    2. 同一個網址的回應會被快取 5 分鐘（回應標頭 cache-control: max-age=300）：同一批每分鐘問一次，拿到的常常是 1～5 分鐘前的那一份。
       每一輪帶一個不同的參數（nonce）才拿得到當下的報價（實測 6 輪都在 4 秒內）。"""
    last = 0
    for host in ('query2', 'query1'):
        url = f'https://{host}.finance.yahoo.com/v7/finance/spark?symbols={",".join(batch)}&range=5d&interval=1d' + (f'&_={nonce}' if nonce else '')
        try:
            st, body = http(url, timeout=10)
            j = json.loads(body)
        except urllib.error.HTTPError as e:
            last = e.code
            if e.code == 429:
                return 429, {}
            continue
        except Exception:
            continue
        out = {}
        for r in ((j.get('spark') or {}).get('result') or []):
            try:
                resp = r['response'][0]; m = resp['meta']
                p, t = num(m.get('regularMarketPrice')), num(m.get('regularMarketTime'))
                if not (p and t and p > 0):
                    continue
                off = num(m.get('gmtoffset')); off = -18000 if off is None else off
                day = lambda e: int((e + off) // 86400)   # 交易所當地的日期（第幾天）
                ts = resp.get('timestamp') or []
                cl = (((resp.get('indicators') or {}).get('quote') or [{}])[0].get('close')) or []
                prev = None
                for e, c in zip(reversed(ts), reversed(cl)):   # 從最新往回找：日期早於「報價那一天」、而且有收盤價的第一根
                    if c is not None and num(e) is not None and day(e) < day(t):
                        prev = num(c); break
                if prev and prev > 0:
                    reg = (m.get('currentTradingPeriod') or {}).get('regular') or {}
                    per = (int(reg['start']), int(reg['end'])) if num(reg.get('start')) and num(reg.get('end')) else None
                    out[str(r['symbol']).upper()] = (p, prev, int(t), per)
            except Exception:
                pass
        return 200, out
    return last, {}


def yahoo_intraday(batch, ysym=lambda s: s):
    """當日 5 分鐘線（補當日走勢用）：回傳 {代號: [(時間, 收盤), …]}。和 yahoo_batch 同一個 spark 端點、同一種回應格式，只是 range=1d&interval=5m。
    2026-11-20 使用者：熱力圖當日走勢在盤中更新晚開始時前段是空的 → 開始時先把開盤到現在補齊。台股用 <代號>.TW（Yahoo 國際版有延遲，補「過去」的格子沒關係）。"""
    ys = [ysym(s_) for s_ in batch]; back = {y.upper(): s_ for y, s_ in zip(ys, batch)}
    for host in ('query2', 'query1'):
        url = f'https://{host}.finance.yahoo.com/v7/finance/spark?symbols={",".join(ys)}&range=1d&interval=5m&_={int(time.time())}'
        try:
            st, body = http(url, timeout=12)
            j = json.loads(body)
        except Exception:
            continue
        out = {}
        for r in ((j.get('spark') or {}).get('result') or []):
            try:
                resp = r['response'][0]
                ts = resp.get('timestamp') or []
                cl = (((resp.get('indicators') or {}).get('quote') or [{}])[0].get('close')) or []
                pts = [(int(e), float(c)) for e, c in zip(ts, cl) if c is not None and num(e) is not None and num(c)]
                if pts:
                    out[back.get(str(r['symbol']).upper(), str(r['symbol']))] = pts
            except Exception:
                pass
        return out
    return {}


def fetch_us(syms, nonce=None):
    batches = [syms[i:i + 20] for i in range(0, len(syms), 20)]
    out, stat = {}, {'ok': 0, '429': 0, 'fail': 0}
    with cf.ThreadPoolExecutor(4) as ex:
        for st, got in ex.map(lambda b: yahoo_batch(b, nonce), batches):
            stat['ok' if st == 200 else '429' if st == 429 else 'fail'] += 1
            out.update(got)
    return out, stat


# ---------- 台股：Yahoo奇摩股市（主要）、鉅亨網（備援）----------
def iso_ts(x):
    try:
        return int(dt.datetime.fromisoformat(str(x).replace('Z', '+00:00')).timestamp())
    except Exception:
        return None


def ytw(codes):
    """回傳 {代號: (現價, 參考價, 報價時間)}。參考價＝現價−漲跌（用來源給的漲跌，漲跌幅才會和來源顯示的一致）；沒有漲跌欄位時用來源的昨收。
    一次最多 50 檔；台股全上市＋全上櫃約兩千檔時分批、4 條連線一起抓（上櫃用 .TWO，2026-11-20 從 GitHub runner 實測可用）。"""
    if len(codes) > 50:
        out = {}
        with cf.ThreadPoolExecutor(4) as ex:
            for got in ex.map(lambda b: _try(ytw, b), [codes[i:i + 50] for i in range(0, len(codes), 50)]):
                out.update(got)
        return out
    url = 'https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;symbols=' + ','.join(c + SUFFIX.get(c, '.TW') for c in codes)
    st, body = http(url, ua=BUA, headers={'Referer': 'https://tw.stock.yahoo.com/', 'Accept-Language': 'zh-TW,zh;q=0.9'}, timeout=10)
    j = json.loads(body)
    raw = lambda v: num(v.get('raw')) if isinstance(v, dict) else num(v)
    out = {}
    for a in (j if isinstance(j, list) else []):
        try:
            c = str(a.get('symbol') or '').split('.')[0]
            p, ch, prev, t = raw(a.get('price')), raw(a.get('change')), raw(a.get('regularMarketPreviousClose')), iso_ts(a.get('regularMarketTime'))
            ref = (p - ch) if (p is not None and ch is not None) else prev
            if c and p and ref and t and p > 0 and ref > 0:
                out[c] = (p, ref, t)
        except Exception:
            pass
    return out


def _try(f, b):
    try:
        return f(b)
    except Exception as e:  # noqa
        log('一批報價讀取失敗', repr(e)[:80]); return {}


def cnyes(codes):
    """鉅亨網報價（欄位代號：6＝成交價、11＝漲跌、200007＝時間、200010＝代號；2026-11-16 用 2330／2454／2317 對過證交所參考價）。"""
    out = {}
    for i in range(0, len(codes), 10):
        url = 'https://ws.api.cnyes.com/ws/api/v1/quote/quotes/' + ','.join(f'TWS:{c}:STOCK' for c in codes[i:i + 10]) + '?column=G,QUOTES'
        try:
            st, body = http(url, ua=BUA, headers={'Origin': 'https://www.cnyes.com', 'Referer': 'https://www.cnyes.com/'}, timeout=8)
            for a in json.loads(body).get('data') or []:
                c, p, ch, t = str(a.get('200010') or ''), num(a.get('6')), num(a.get('11')), num(a.get('200007'))
                if c and p and ch is not None and t and p > 0 and p - ch > 0:
                    out[c] = (p, p - ch, int(t))
        except Exception:
            pass
    return out


def fetch_tw(codes):
    src = 'Yahoo奇摩股市'
    try:
        got = ytw(codes)
    except Exception as e:  # noqa
        got = {}
        log('Yahoo奇摩股市讀取失敗', repr(e)[:100])
    if len(got) < len(codes) * 0.5:
        alt = cnyes(codes)
        if len(alt) > len(got):
            got, src = alt, '鉅亨網'
    return got, src


# ---------- 發布（GitHub Git Data API；只留最新一筆 commit）----------
class Pub:
    def __init__(self, repo, token, branch=BRANCH):
        self.api, self.token, self.branch = 'https://api.github.com/repos/' + repo, token, branch
        self.keep = {}   # 路徑 → blob sha：分支上要原樣保留的檔案（另一個市場的最新檔、最近幾個時間格檔、README）

    def call(self, method, path, body=None, tries=2):
        err = None
        for k in range(tries):
            try:
                st, raw = http(self.api + path, ua='bnasdaq-heatmap-live', method=method, timeout=20,
                               data=(json.dumps(body).encode() if body is not None else None),
                               headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
                return st, (json.loads(raw) if raw else {})
            except urllib.error.HTTPError as e:
                msg = e.read()[:300].decode('utf8', 'replace')
                if e.code < 500 and e.code != 429:
                    return e.code, {'message': msg}
                err = (e.code, {'message': msg})
            except Exception as e:  # noqa
                err = (0, {'message': repr(e)[:200]})
            time.sleep(1 + k)
        return err

    def load(self):
        st, j = self.call('GET', f'/git/trees/{self.branch}')
        self.keep = {e['path']: e['sha'] for e in (j.get('tree') or []) if e.get('type') == 'blob'} if st == 200 else {}
        return st

    def publish(self, mk, slot, text, message):
        """寫 <file>.json 與 <file>-<slot>.json；其餘檔案沿用舊的 blob。成功回 True。"""
        f = MARKETS[mk]['file']
        mine = sorted((p for p in self.keep if p.startswith(f + '-')), key=lambda p: p)   # 這個市場的時間格檔
        other = [p for p in self.keep if any(p.startswith(MARKETS[m]['file'] + '-') for m in MARKETS if m != mk)]   # 別的市場的時間格檔：早就過期
        drop = set(other) | set(mine[:-(KEEP - 1)] if KEEP > 1 else mine)
        tree = [{'path': p, 'mode': '100644', 'type': 'blob', 'content': c} for p, c in ((f + '.json', text), (f'{f}-{slot}.json', text))]
        if 'README.md' not in self.keep:
            tree.append({'path': 'README.md', 'mode': '100644', 'type': 'blob', 'content': README})
        new = {x['path'] for x in tree}
        tree += [{'path': p, 'mode': '100644', 'type': 'blob', 'sha': s} for p, s in self.keep.items() if p not in new and p not in drop]
        st, t = self.call('POST', '/git/trees', {'tree': tree})
        if st != 201:
            log('發布失敗（tree）', st, str(t.get('message'))[:120]); return False
        st, c = self.call('POST', '/git/commits', {'message': message, 'tree': t['sha'], 'parents': []})
        if st != 201:
            log('發布失敗（commit）', st, str(c.get('message'))[:120]); return False
        st, r = self.call('PATCH', f'/git/refs/heads/{self.branch}', {'sha': c['sha'], 'force': True})
        if st in (404, 422):
            st, r = self.call('POST', '/git/refs', {'ref': f'refs/heads/{self.branch}', 'sha': c['sha']})
        if st not in (200, 201):
            log('發布失敗（ref）', st, str(r.get('message'))[:120]); return False
        self.keep = {e['path']: e['sha'] for e in (t.get('tree') or []) if e.get('type') == 'blob'}
        return True

    def dispatch(self, ref, inputs, workflow=WORKFLOW):
        st, r = self.call('POST', f'/actions/workflows/{workflow}/dispatches', {'ref': ref, 'inputs': inputs})
        return st in (200, 204), st, r

    def others(self, me):
        """別的 run 的狀況：回傳 [(run 編號, session job 狀態, gate job 狀態)]（只看還沒結束的 run）。"""
        st, j = self.call('GET', f'/actions/workflows/{WORKFLOW}/runs?per_page=30')
        out = []
        for r in (j.get('workflow_runs') or []) if st == 200 else []:
            if str(r.get('id')) == str(me) or r.get('status') == 'completed':
                continue
            st2, jj = self.call('GET', f'/actions/runs/{r["id"]}/jobs?per_page=20')
            names = {x.get('name'): x.get('status') for x in (jj.get('jobs') or [])} if st2 == 200 else {}
            out.append((int(r['id']), names.get('session'), names.get('gate')))
        return out


class FilePub:
    """本機測試用：把檔案寫到資料夾，不碰 GitHub。"""
    def __init__(self, out):
        self.out = out; os.makedirs(out, exist_ok=True)

    def load(self):
        return 200

    def publish(self, mk, slot, text, message):
        f = MARKETS[mk]['file']
        for name in (f + '.json', f'{f}-{slot}.json'):
            open(os.path.join(self.out, name), 'w', encoding='utf-8').write(text)
        mine = sorted(p for p in os.listdir(self.out) if p.startswith(f + '-'))
        for p in mine[:-KEEP]:
            os.remove(os.path.join(self.out, p))
        return True

    def dispatch(self, ref, inputs, workflow=WORKFLOW):
        open(os.path.join(self.out, 'dispatch.json'), 'w').write(json.dumps({'ref': ref, 'inputs': inputs, 'workflow': workflow})); return True, 204, {}

    def others(self, me):
        return []


# ---------- 一個交易時段 ----------
class Session:
    def __init__(self, mk, sess, syms, pub, clock=time.time, sleep=time.sleep, t0=None):
        self.mk, self.sess, self.syms, self.pub, self.clock, self.sleep = mk, dict(sess), list(syms), pub, clock, sleep
        self.t0 = t0 if t0 is not None else clock()
        self.q = {}          # 代號 → [現價, 前收（或參考價）, 報價時間]
        self.step = MARKETS[mk]['step']
        self.every = self.step   # 目前多久發布一次（Yahoo 回 429 時會拉長）
        self.clean = 0       # 連續幾輪沒有 429
        self.maxt = 0        # 目前看到的最新報價時間
        self.still = 0       # 連續幾輪抓得到資料、但最新報價時間沒有前進
        self.fails = 0
        self.poll_n = 0
        self.src = MARKETS[mk]['src']
        self.budget = int(os.environ.get('HM_BUDGET') or BUDGET)
        self.after_tries = 0  # 收盤後啟動「最新收盤價更新」試了幾次
        self.after_done = False
        self.pstep = MARKETS[mk]['pstep']
        self.path = {}       # 代號 → {時間格: 漲跌（0.01%）}；時間格＝(報價時間 − 開盤) ÷ pstep，同一格留最後一筆

    def track(self):
        """把這一輪的報價記進當日走勢（只收開盤後到收盤前的報價）。"""
        o, c = self.sess['open'], self.sess['close']
        for s_, v in self.q.items():
            if PATHSET is not None and s_ not in PATHSET:
                continue
            p, prev, t = v
            if not (o <= t <= c + 60) or not (p > 0 and prev > 0):
                continue
            k = min(int((t - o) // self.pstep), max(0, int((c - o - 1) // self.pstep)))
            self.path.setdefault(s_, {})[k] = int(round((p / prev - 1) * 10000))

    def path_out(self):
        n = max(1, int(-(-(self.sess['close'] - self.sess['open']) // self.pstep)))
        out = {}
        for s_, d in self.path.items():
            if d:
                last = max(d)
                out[s_] = [d.get(k) for k in range(0, last + 1)]
        return n, out

    def backfill(self):
        """盤中更新晚開始（排程延遲、交棒、重啟）時，開盤到第一次記錄之間的格子用 Yahoo 當日 5 分鐘線補上；已經有的格子不動。
        前收用這一輪報價的前收（和方塊上的漲跌同一個基準）。只做一次，失敗就算了（走勢照常從現在開始）。"""
        if getattr(self, 'filled', False):
            return
        self.filled = True
        o, c = self.sess['open'], self.sess['close']
        if self.clock() - o < self.pstep:
            return
        ysym = (lambda s_: s_ + SUFFIX.get(s_, '.TW')) if self.mk == 'TW' else (lambda s_: s_.replace('.', '-'))
        need = [s_ for s_ in self.syms if s_ in self.q and (PATHSET is None or s_ in PATHSET) and len(self.path.get(s_) or {}) <= max(1, int((self.clock() - o) // self.pstep) - 1)]
        if not need:
            return
        n = 0
        try:
            batches = [need[i:i + 20] for i in range(0, len(need), 20)]
            with cf.ThreadPoolExecutor(4) as ex:
                for got in ex.map(lambda b: yahoo_intraday(b, ysym), batches):
                    for s_, pts in got.items():
                        prev = (self.q.get(s_) or [None, None])[1]
                        if not prev or prev <= 0:
                            continue
                        d = self.path.setdefault(s_, {}); first = min(d) if d else 10 ** 9; add = {}
                        for t, px in pts:
                            if o <= t < c and px > 0:
                                k = int((t - o) // self.pstep)
                                if k < first:
                                    add[k] = int(round((px / prev - 1) * 10000))
                        if add:
                            d.update(add); n += 1
        except Exception as e:  # noqa
            log('補當日走勢失敗', repr(e)[:100]); return
        log('補當日走勢：', n, '/', len(need), '檔')

    def resume(self):
        """交棒或重啟時：同一個交易日已發布過的走勢接著用（從分支上的最新檔讀回來）。"""
        try:
            f = MARKETS[self.mk]['file'] + '.json'
            sha = (getattr(self.pub, 'keep', {}) or {}).get(f)
            if not sha or not hasattr(self.pub, 'call'):
                return
            st, b = self.pub.call('GET', f'/git/blobs/{sha}')
            if st != 200:
                return
            j = json.loads(base64.b64decode(b.get('content') or '').decode('utf-8'))
            if j.get('session') != self.sess['date'] or j.get('ps') != self.pstep or not isinstance(j.get('pp'), dict):
                return
            for s_, arr in j['pp'].items():
                if isinstance(arr, list):
                    self.path[s_] = {k: int(v) for k, v in enumerate(arr) if isinstance(v, (int, float))}
            log('接續當日走勢：', len(self.path), '檔')
        except Exception as e:  # noqa
            log('接續當日走勢失敗（從這一刻開始記）', repr(e)[:100])

    def after_close(self):
        """收盤後啟動 tw-latest.yml（更新全站的最新收盤價，更新完它會自己重新部署網站）。一個時段只做一次；啟動失敗下一輪再試，最多 3 次。
        為什麼由這裡啟動：GitHub 的排程在這個 repo 會晚 7～10 小時才跑，而這個 job 剛好在收盤那一刻醒著。"""
        if self.after_done or self.after_tries >= 3:
            return
        self.after_tries += 1
        try:
            ok, st, r = self.pub.dispatch(os.environ.get('GITHUB_REF_NAME') or 'main', {}, workflow=AFTER)
        except Exception as e:  # noqa
            ok, st, r = False, 0, {'message': repr(e)[:100]}
        self.after_done = bool(ok)
        note('收盤後更新最新收盤價（' + AFTER + '）：', '已啟動' if ok else f'啟動失敗 {st} {str((r or {}).get("message"))[:100]}')

    # --- 抓一輪 ---
    def poll_us(self):
        got, stat = fetch_us(self.syms, int(self.clock()))   # 每一輪不同的參數：避開 Yahoo 的 5 分鐘快取
        lo, per = self.sess['open'] - 60, {}
        for s, (p, prev, t, reg) in got.items():
            if t >= lo and t <= self.clock() + 300:
                self.q[s] = [p, prev, t]
                if reg and reg[0] >= lo - 3600:
                    per[reg] = per.get(reg, 0) + 1
        if per:   # 當天實際的正規時段（提早收盤日 Yahoo 會給 13:00）；多數決
            (start, end), n = max(per.items(), key=lambda kv: kv[1])
            if n >= 20 and end != self.sess['close'] and 3600 <= end - start <= 8 * 3600:
                log('依行情來源調整收盤時間', self.sess['close'], '→', end)
                self.sess['close'] = end
        if stat['429']:
            self.every, self.clean = min(300, self.every * 2), 0
            log('Yahoo 回 429，更新間隔拉長到', self.every, '秒')
        else:
            self.clean += 1
            if self.clean >= 10 and self.every > self.step:
                self.every, self.clean = max(self.step, self.every // 2), 0
                log('更新間隔縮回', self.every, '秒')
        return stat['ok'] > 0

    def poll_tw(self):
        got, src = fetch_tw(self.syms)
        lo = self.sess['open']
        for c, (p, ref, t) in got.items():
            if lo <= t <= self.clock() + 300:   # 只收今天開盤後的報價（開盤前的試撮、前一天的收盤價都不算）
                self.q[c] = [p, ref, t]
        if got:
            self.src = src
        return bool(got)

    def poll(self):
        self.poll_n += 1
        ok = self.poll_us() if self.mk == 'US' else self.poll_tw()
        if ok:
            self.track()
            self.backfill()
        m = max((v[2] for v in self.q.values()), default=0)
        if m > self.maxt:
            self.maxt, self.still = m, 0
        elif ok:
            self.still += 1
        return ok

    def snapshot(self, state, slot, now):
        pn, pp = self.path_out()
        q = {}
        for s in self.syms:
            v = self.q.get(s)
            if v:
                q[s] = [round(v[0], 4), round((v[0] / v[1] - 1) * 100, 2), max(0, int(now - v[2]))]
        return {'schema': SCHEMA, 'market': self.mk, 'session': self.sess['date'], 'state': state, 'at': int(now), 'slot': slot, 'every': self.every,
                'step': self.step, 'open': self.sess['open'], 'close': self.sess['close'], 'src': self.src, 'n': len(self.syms), 'have': len(q), 'q': q,
                'ps': self.pstep, 'pn': pn, 'pp': pp}

    def publish(self, state, slot, now):
        snap = self.snapshot(state, slot, now)
        hm = dt.datetime.fromtimestamp(now, ZoneInfo(MARKETS[self.mk]['tz'])).strftime('%Y-%m-%d %H:%M')
        ok = self.pub.publish(self.mk, slot, json.dumps(snap, ensure_ascii=False, separators=(',', ':')),
                              f'heatmap live {self.mk} {hm} {state} {snap["have"]}/{snap["n"]} run={os.environ.get("GITHUB_RUN_ID", "local")}')
        return ok, snap

    # --- 主迴圈 ---
    def run(self):
        mk, tail, step = self.mk, MARKETS[self.mk]['tail'], self.step
        log(f'{mk} 時段 {self.sess["date"]}：開盤', self.sess['open'], '收盤', self.sess['close'], f'；{len(self.syms)} 檔')
        self.pub.load()
        self.resume()
        wait = self.sess['open'] - self.clock()
        if wait > 0:
            log(f'離開盤還有 {wait / 60:.1f} 分鐘，等待中')
        while self.sess['open'] - self.clock() > 0:
            self.sleep(min(30, max(0.5, self.sess['open'] - self.clock())))
        nxt = (int(self.clock()) // step) * step   # 現在這一格立刻做
        while True:
            now = self.clock()
            if now < nxt:
                self.sleep(min(30, max(0.2, nxt - now))); continue
            slot = nxt // step
            ok = self.poll()
            now = self.clock()
            over = now >= self.sess['close'] + tail
            frozen = bool(self.q) and self.still >= max(10, FREEZE // self.every) and now < self.sess['close']
            if not self.q:
                if now - self.sess['open'] > HOLIDAY:
                    log('開盤後一直沒有當天的報價：休市或來源異常，結束（不發布）'); return 'holiday'
            else:
                state = 'closed' if (over or frozen) else ('settling' if now >= self.sess['close'] else 'open')
                if ok or state == 'closed':
                    done, snap = self.publish(state, slot, now)
                    self.fails = 0 if done else self.fails + 1
                    if self.poll_n % 10 == 1 or state != 'open' or not done:
                        log(f'{state} 第 {slot} 格：{snap["have"]}/{snap["n"]} 檔，來源 {self.src}，發布{"成功" if done else "失敗"}')
                    if state == 'closed' and (done or self.fails >= 5):
                        self.after_close()
                    if state == 'closed' and done:
                        log('提早收盤（報價不再更新），結束' if frozen else '收盤，結束'); return 'closed'
                    if state == 'closed' and self.fails >= 5:
                        log('收盤那一份發布不出去，放棄'); return 'failed'
                elif self.poll_n % 10 == 1:
                    log('這一輪抓不到資料，跳過')
                if now >= self.sess['close'] + MARKETS[mk]['after']:   # 收盤後過了這麼久（收盤價到齊）→ 更新全站的最新收盤價
                    self.after_close()
            if now - self.t0 > self.budget and now < self.sess['close'] - 180:
                ok2, st, r = self.pub.dispatch(os.environ.get('GITHUB_REF_NAME') or 'main', {'relay': str(os.environ.get('GITHUB_RUN_ID') or '1'), 'market': mk})
                log('這個 job 跑滿了，交棒給下一個 run：', '已啟動' if ok2 else f'啟動失敗 {st} {str((r or {}).get("message"))[:100]}')
                if ok2:
                    return 'relay'
                self.t0 += 600   # 啟動失敗：10 分鐘後再試（離 6 小時上限還有餘裕）
            every = self.every if now < self.sess['close'] else step
            nxt = (int(now) // step) * step + max(step, (every // step) * step)


# ---------- 入口 ----------
def out(**kv):
    p = os.environ.get('GITHUB_OUTPUT')
    for k, v in kv.items():
        print(f'{k}={v}')
        if p:
            open(p, 'a').write(f'{k}={v}\n')


def last_closed(mk, now):
    """最近一個「已經收盤、而且過了 after 秒」的平日（交易所當地日期）。這裡不知道休市日，休市日會被當成交易日。"""
    c = MARKETS[mk]
    d = dt.datetime.fromtimestamp(now, ZoneInfo(c['tz']))
    for back in range(8):
        day = d - dt.timedelta(days=back)
        if day.weekday() < 5 and day.replace(hour=c['close'][0], minute=c['close'][1], second=0, microsecond=0).timestamp() + c['after'] <= now:
            return day.strftime('%Y-%m-%d')
    return ''


def catch_up(pub, now):
    """補救：某個市場已經收盤，網站的最新收盤檔卻還停在更早的日期（代表收盤當下沒有 session 在跑，例如那天沒被啟動或中途掛掉）
    → 啟動 tw-latest.yml 補抓。只在外部準時啟動（workflow_dispatch，一天兩次）時檢查。
    休市日會被誤判成落後而多跑一次，那一次抓不到新資料、不會改任何檔案。回傳落後的市場清單（讀不到檔案回 None）。"""
    ref = os.environ.get('GITHUB_REF_NAME') or 'main'
    st, j = pub.call('GET', '/contents/data/tw/latest.json?ref=' + ref)
    if st != 200 or not j.get('content'):
        note('補救檢查：讀不到最新收盤檔', st); return None
    asof = json.loads(base64.b64decode(j['content']).decode('utf-8')).get('asof') or {}
    stale = [mk for mk in MARKETS if (asof.get(mk) or '') < last_closed(mk, now)]
    if not stale:
        note('補救檢查：最新收盤檔不落後', asof); return []
    st, r = pub.call('GET', f'/actions/workflows/{AFTER}/runs?per_page=5')
    if st == 200 and any(x.get('status') != 'completed' for x in (r.get('workflow_runs') or [])):
        note('補救檢查：', stale, '的收盤價落後，但已經有更新在跑'); return stale
    ok, st, r = pub.dispatch(ref, {}, workflow=AFTER)
    note('補救檢查：', stale, '的收盤價落後', {m: asof.get(m) for m in stale}, '→', ('已啟動 ' + AFTER) if ok else f'啟動失敗 {st}')
    return stale


def gate():
    now = time.time()
    want, relay = (os.environ.get('MARKET') or '').strip().upper(), (os.environ.get('RELAY') or '').strip()
    if os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and not relay:
        try:
            catch_up(Pub(os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_TOKEN']), now)
        except Exception as e:  # noqa：補救檢查失敗不能影響盤中更新
            note('補救檢查失敗：', repr(e)[:120])
    cands = [m for m in MARKETS if (not want or m == want) and active(m, now)]
    if not cands:
        note('gate：90 分鐘內沒有要開盤或正在進行的交易時段（週末或時間還沒到）→ 不跑'); out(go='false', market=''); return 0
    mk = cands[0]
    if relay:
        note(f'gate：接力，接手 run {relay} 的 {mk} 時段'); out(go='true', market=mk); return 0
    me = os.environ.get('GITHUB_RUN_ID') or '0'
    pub = Pub(os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_TOKEN'])
    for rid, sess_st, gate_st in pub.others(me):
        if sess_st in ('queued', 'in_progress', 'waiting', 'pending', 'requested'):
            note(f'gate：run {rid} 已經在跑這個時段 → 不重複跑'); out(go='false', market=mk); return 0
        if rid < int(me) and gate_st != 'completed':
            note(f'gate：較早的 run {rid} 還在判斷中，讓它先 → 不跑'); out(go='false', market=mk); return 0
    note(f'gate：啟動 {mk} 時段'); out(go='true', market=mk); return 0


def main():
    a = sys.argv[1:]
    cmd = a[0] if a else ''
    mk = (a[a.index('--market') + 1] if '--market' in a else os.environ.get('MARKET') or '').strip().upper()
    if cmd == 'gate':
        return gate()
    if cmd in ('run', 'once'):
        now = time.time()
        if not mk:
            c = [m for m in MARKETS if active(m, now)]
            mk = c[0] if c else ''
        if mk not in MARKETS:
            log('現在沒有交易時段；用 --market TW 或 US 指定'); return 0 if cmd == 'run' else 2
        sess = active(mk, now) or session(mk, now)
        if not sess:
            log(mk, '今天不是交易日'); return 0
        syms = universe(mk)
        if cmd == 'once':
            s = Session(mk, sess, syms, None)
            ok = s.poll(); snap = s.snapshot('open', int(time.time()) // s.step, time.time())
            ages = sorted(v[2] for v in snap['q'].values())
            print(json.dumps({'ok': ok, 'src': s.src, 'have': snap['have'], 'n': snap['n'], 'quote_age_sec_min_med_max': [ages[0], ages[len(ages) // 2], ages[-1]] if ages else None,
                              'sample': dict(list(snap['q'].items())[:5])}, ensure_ascii=False))
            return 0
        if now >= sess['close'] + MARKETS[mk]['tail']:
            log(mk, '今天的時段已經結束'); return 0
        pub = Pub(os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_TOKEN'])
        res = Session(mk, sess, syms, pub).run()
        note(f'session：{mk} {sess["date"]} 結果', res)
        return 0
    if cmd == 'close':
        # 2026-11-20：盤中程式是在新分頁（台股全上市／全上櫃）上線前啟動的，收盤快照只有台灣 50 → 同一家公司在不同分頁顯示不同日期的股價。
        # 補救：收盤後抓一次全部代號的收盤報價，發布成當天的 closed 快照（已有的當日走勢保留，缺的用 Yahoo 5 分鐘線補）。已完整就不動。
        now = time.time()
        mk = mk or 'TW'
        sess = session(mk, now)
        if not sess or now < sess['close'] + 120:
            log(mk, '今天還沒收盤或不是交易日，不做'); return 0
        syms = universe(mk)
        pub = Pub(os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_TOKEN'])
        pub.load()
        s = Session(mk, sess, syms, pub)
        try:
            f = MARKETS[mk]['file'] + '.json'; sha = (getattr(pub, 'keep', {}) or {}).get(f)
            st, b = pub.call('GET', f'/git/blobs/{sha}') if sha else (0, None)
            j = json.loads(base64.b64decode(b.get('content') or '').decode('utf-8')) if st == 200 else {}
            if j.get('session') == sess['date'] and j.get('state') == 'closed' and j.get('have', 0) >= 0.95 * len(syms) and '--force' not in a:
                log(mk, sess['date'], '收盤快照已完整（', j.get('have'), '/', len(syms), '），不用補'); return 0
        except Exception as e:  # noqa
            log('讀現有快照失敗（照樣補）', repr(e)[:100])
        s.resume()
        ok = s.poll()
        if not s.q:
            log('抓不到報價，不發布'); return 1
        done, snap = s.publish('closed', int(now) // s.step, now)
        note(f'收盤快照補發：{mk} {sess["date"]} {snap["have"]}/{snap["n"]} 檔，走勢 {len(snap["pp"])} 檔，發布{"成功" if done else "失敗"}')
        return 0 if done else 1
    print(__doc__); return 2


if __name__ == '__main__':
    sys.exit(main())
