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

美股盤前／盤後（2026-11-23 使用者：美股盤前開盤時顯示盤前股價，盤後開盤時顯示盤後股價）：
  美股的時段延長為 盤前 04:00 → 正規 09:30～16:00 → 盤後 16:00～20:00（美東時間；提早收盤日依行情來源改成 13:00、盤後到 17:00）。
  盤前、盤後每 60 秒抓一次 Yahoo Finance spark（range=1d、interval=5m、includePrePost=true；當天含盤前盤後的 5 分 K），
  最後一點＝最新成交（時間是那筆成交的時間，不是 K 棒開始時間）；基準價＝同一份回應的 regularMarketPrice（盤前＝前一個交易日收盤、盤後＝當天收盤）。
  2026-11-23 03:50～04:13 美東從 GitHub runner 實測（scripts 外的暫時性實測，紀錄在專案文件 claude/heatmap-extended-hours-20261123.md）：
    · 04:00 一過就回當天的盤前 K 棒（04:13 時 522 檔已有 297 檔有盤前成交）；04:00 以前回的是前一個交易日的整天（含盤後），所以一定要用時段過濾。
    · regularMarketPrice 盤前＝前一交易日收盤（AAPL 342.56，和正式收盤檔一致）、regularMarketTime＝前一交易日 16:00。
    · 1 分 K 與 5 分 K 的最後一點完全相同（20/20 檔）；522 檔一輪 27 個請求約 0.6 秒，5 分 K 整天約 1.7 MB、1 分 K 約 4.9 MB → 用 5 分 K。
    · v7/finance/quote（有 preMarketPrice 欄位）不帶 crumb 回 401、取 crumb 回 429 → 不用。
  盤前漲跌＝盤前價 ÷ 前一交易日收盤 − 1；盤後漲跌＝盤後價 ÷ 當天收盤 − 1（和 Yahoo、券商 App 的盤前盤後漲跌同一個算法）。
  快照另外放 ext（'pre'／'post'）、xstate（'open'／'closed'）、x（{代號: [盤前或盤後價, 漲跌%, 報價幾秒前]}）、
  xopen／xclose（該時段起訖）、xps／xpn／xpp（該時段每 15 分鐘一點的走勢）。盤前那幾份的 state＝'pre'（正規時段還沒開始，q 是空的）。
  正規時段的欄位（q、pp、state）意義不變；舊版網頁看不懂 'pre' 會直接改顯示正式收盤，不會出錯。
  一個交易日 16 小時要 4 棒（320 分鐘交棒）；盤後還在跑時台股可能已經開始準備，所以兩個市場可以同時各跑一個 session（job 名稱帶市場代碼）。

放哪裡（heatmap-live 分支，只留最新一筆 commit，不會越積越多）：
  tw.json、us.json                 各市場「最新一份」；收盤後就是收盤那一份
  tw-<時間格>.json、us-<時間格>.json   時間格＝UNIX 秒 ÷ 該市場的間隔（台股 30、美股 60）取整數；每個時間格一個不會再變的檔名，只留最近 8 個。
  為什麼要時間格檔：raw.githubusercontent.com 同一個網址會被快取 5 分鐘（網址加參數也沒用，2026-11-16 實測），
  檔名每一格換一個，網頁才讀得到最新的資料；新檔名推上去後立刻讀得到（實測 0.2～0.3 秒）。
  間隔為什麼不能更短：每次發布要對 GitHub 寫 3 次（tree、commit、ref），GitHub 文件規定寫入類請求每小時不超過 500 次、
  每分鐘不超過 80 次（secondary rate limit）；30 秒一次＝每小時 360 次，20 秒一次＝540 次就超過了。

怎麼啟動（.github/workflows/heatmap-live.yml）：
  gate     判斷現在要不要跑：90 分鐘內有開盤（美股從盤前 04:00 算、120 分鐘內）或正在交易時段內、而且「這個市場」沒有別的 run 正在跑 → go
           兩個市場都需要、又都沒有人在跑時：這個 run 跑第一個，另外啟動一個 run 專跑第二個。
  session  美股：等到盤前 04:00 → 盤前每分鐘更新 → 09:30 起正規時段（同以前）→ 收盤後多抓幾分鐘、標成 closed
                 → 盤後每分鐘更新到 20:00 → 再多抓幾分鐘，標成盤後結束（xstate＝closed）。
           台股：等到開盤 → 每一格更新一次 → 收盤後多抓幾分鐘（收盤價到齊）→ 標成 closed 結束。
           一個 job 最多跑 320 分鐘，超過就自己啟動下一棒接手（美股含盤前盤後約 16 小時，要四棒）。
  開盤後 25 分鐘都沒有當天的報價＝休市，直接結束、不發布。美股從盤前算：盤前開始 25 分鐘，Yahoo 有回應、卻沒有任何一檔有當天的盤前成交＝休市。
  收盤後（台股 +150 秒、美股 +10 分鐘）session 會啟動 tw-latest.yml，把全站的最新收盤價更新到當天並重新部署；
  gate 被外部準時啟動時另外檢查一次：有市場已收盤但收盤價還落後，就補啟動 tw-latest.yml。

每日市場分析頁的即時報價與新聞（2026-11-23 使用者：「每日即時資訊頁面的所有指數跟個股報價還有新聞都要用最新的新聞跟盤前盤後價格及指數點位」、
「新聞一個小時更新一次就好」）：
  美股 session 每一格另外抓報價板（指數、VIX、美元指數、殖利率、匯率、原油、黃金、比特幣、推估指數用的 ETF、熱力圖沒有的大型股），
  放在 us.json 的 mb 欄位（說明見 BOARD）；網頁的指數用 ETF 的盤前盤後漲跌推估點位，個股直接用盤前盤後成交價。
  新聞（鉅亨網美股、Google 新聞「美股」、CNBC、MarketWatch 的標題與連結）一小時抓一次，寫成分支上的 news.json：
  交易時段內由兩個市場的 session 順便做（和快照同一個 commit），其餘時間由 .github/workflows/news.yml（每小時）補。

用法：
  python3 scripts/heatmap_live.py gate
  python3 scripts/heatmap_live.py run [--market TW|US]
  python3 scripts/heatmap_live.py once --market TW        # 抓一次、印摘要，不發布（檢查來源用）
  python3 scripts/heatmap_live.py once --market US --board [pre|post]   # 檢查報價板
  python3 scripts/heatmap_live.py news [--force|--print]  # 更新新聞（一小時內更新過就不重抓）
環境變數：GITHUB_TOKEN、GITHUB_REPOSITORY、GITHUB_RUN_ID、GITHUB_OUTPUT、GITHUB_REF_NAME；RELAY（上一棒的 run 編號）、MARKET（指定市場）、
          HM_BUDGET（測試交棒用：一個 job 最多跑幾秒，預設 19200）。
只用 Python 標準函式庫。"""
import base64
import concurrent.futures as cf
import datetime as dt
import email.utils
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as XET
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
    # pre／post＝盤前開始、盤後結束（2026-11-23 起美股加盤前盤後）；xtail＝盤後結束後再抓幾秒（最後幾筆成交到齊）；xpstep＝盤前盤後走勢幾秒一點
    # lead＝最多提早多久進場等（沒寫用 LEAD）：排程固定台北 15:10 啟動，冬令是美東 02:10、離盤前 04:00 有 110 分鐘
    'US': dict(tz='America/New_York', open=(9, 30), close=(16, 0), tail=10 * 60, after=10 * 60, sets=('ndx', 'spx', 'sox'), file='us', step=60, pstep=900, src='Yahoo Finance',
               pre=(4, 0), post=(20, 0), xtail=6 * 60, xpstep=900, lead=120 * 60),
}
README = ('# heatmap-live\n\n這個分支由 `.github/workflows/heatmap-live.yml` 在開盤期間定時自動覆寫（只留最新一筆 commit），'
          '內容是市值熱力圖的盤中報價、每日市場分析頁的報價板（us.json 的 mb）與每小時更新的新聞標題（news.json）。'
          '請勿手動修改；程式在 main 分支的 `scripts/heatmap_live.py`。\n')


def log(*a):
    print(dt.datetime.now(ZoneInfo('Asia/Taipei')).strftime('%H:%M:%S'), *a, flush=True)


def note(*a):
    """重要的結果另外寫成 GitHub 的 notice 註記（用 API 就查得到，不必下載整份紀錄）。"""
    log(*a)
    if os.environ.get('GITHUB_ACTIONS'):
        print('::notice title=heatmap-live::' + ' '.join(str(x) for x in a).replace('%', '%25').replace('\r', ' ').replace('\n', ' '), flush=True)


# ---------- 交易時段 ----------
def session(mk, now):
    """now 所在的當地日期那一天的交易時段（週一到週五）；週末回 None。休市日由「開盤後沒有當天報價」判斷。
    美股另外有 pre（盤前開始）、post（盤後結束）。"""
    c = MARKETS[mk]
    d = dt.datetime.fromtimestamp(now, ZoneInfo(c['tz']))
    if d.weekday() >= 5:
        return None
    at = lambda hm: int(d.replace(hour=hm[0], minute=hm[1], second=0, microsecond=0).timestamp())
    s = {'date': d.strftime('%Y-%m-%d'), 'open': at(c['open']), 'close': at(c['close'])}
    if c.get('pre'):
        s['pre'], s['post'] = at(c['pre']), at(c['post'])
    return s


def span(mk, s):
    """這個時段要跑的範圍：(開始, 結束)。開始＝盤前開始（沒有盤前就是開盤）；結束＝盤後結束＋xtail（沒有盤後就是收盤＋tail）。"""
    c = MARKETS[mk]
    return s.get('pre', s['open']), (s['post'] + c['xtail']) if 'post' in s else (s['close'] + c['tail'])


def active(mk, now):
    """開始前 lead（沒寫用 LEAD）秒到結束之間 → 回傳時段；否則 None。"""
    s = session(mk, now)
    if not s:
        return None
    a, b = span(mk, s)
    return s if a - MARKETS[mk].get('lead', LEAD) <= now < b else None


# ---------- HTTP ----------
def http(url, ua=YUA, headers=None, timeout=12, data=None, method=None):
    h = {'User-Agent': ua, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9'}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h, data=data, method=method), timeout=timeout) as r:
        return r.status, r.read()


SUFFIX = {}      # 台股代號 → Yahoo奇摩股市的後綴（上市 .TW、上櫃 .TWO）
PATHSET = None   # 要記當日走勢的代號；None＝全部。台股全上市／全上櫃近兩千檔，只記方塊大到畫得下走勢圖的那些（台灣 50＋兩個分頁各前 150 大）
# 2026-11-24 使用者：「所有的股價計算在網站上都是用最新的即時價格」→ 除了熱力圖成分股，網站價格表 data/tw/latest.json
# （個股對比、會員專區持有資產、投資組合透視、每日市場分析「你的資產變化」、目標價試算用的最新價）裡的代號也一起抓：
# 台股多 0050、00631L 等 ETF 約 355 檔，美股多 QLD、SHV、ETF 與熱門個股約 126 檔；這些只進快照的 q／x，不記當日走勢。
EXTRAS = True
EXTRA_US = ['ANT', 'BOXX']   # 價格表沒有、但網站用得到的美股代號
LATEST = os.path.join(ROOT, 'data', 'tw', 'latest.json')


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
    if EXTRAS:
        more = extras(mk, seen)
        if more and PATHSET is None:
            PATHSET = set(out)   # 熱力圖成分股照舊記當日走勢，多抓的代號不記
        out += more
    return out


def latest_items():
    """網站價格表的 items。session 的 checkout 只有 scripts、data/heatmap、data/daily（不抓 data/tw 整個資料夾約 30 MB），
    本機沒有這個檔時從 main 分支的原始檔讀（公開 repo，raw.githubusercontent.com）。"""
    try:
        return json.load(open(LATEST, encoding='utf-8')).get('items') or {}
    except Exception:
        pass
    repo = os.environ.get('GITHUB_REPOSITORY')
    if repo:
        try:
            st, body = http(f'https://raw.githubusercontent.com/{repo}/main/data/tw/latest.json', ua='bnasdaq-heatmap-live', timeout=20)
            if st == 200:
                return json.loads(body).get('items') or {}
        except Exception as e:  # noqa
            log('網站價格表讀取失敗', repr(e)[:100])
    return {}


def extras(mk, have):
    """網站價格表（data/tw/latest.json 的 items：{代號: [收盤, 漲跌, 名稱, 市場 TW／TWO／US]}）裡、熱力圖沒有的代號（保留順序）。
    上櫃（TWO）設 Yahoo奇摩股市後綴 .TWO。讀不到價格表就只回固定清單。"""
    items = latest_items()
    out = []
    for c, v in items.items():
        m = v[3] if isinstance(v, list) and len(v) > 3 else ''
        if c in have or not ((mk == 'TW' and m in ('TW', 'TWO')) or (mk == 'US' and m == 'US')):
            continue
        if m == 'TWO':
            SUFFIX[c] = '.TWO'
        have.add(c); out.append(c)
    for c in (EXTRA_US if mk == 'US' else []):
        if c not in have:
            have.add(c); out.append(c)
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


def fetch_us(syms, nonce=None, f=None):
    batches = [syms[i:i + 20] for i in range(0, len(syms), 20)]
    out, stat = {}, {'ok': 0, '429': 0, 'fail': 0}
    with cf.ThreadPoolExecutor(4) as ex:
        for st, got in ex.map(lambda b: (f or yahoo_batch)(b, nonce), batches):
            stat['ok' if st == 200 else '429' if st == 429 else 'fail'] += 1
            out.update(got)
    return out, stat


EXT_IV = '5m'   # 盤前盤後用幾分 K：最後一點就是最新成交、時間是成交時間（見檔頭；2026-11-23 從 GitHub runner 實測，5 分 K 與 1 分 K 最後一點相同、資料量約 1/3）


def yahoo_ext(batch, nonce=None):
    """美股盤前／盤後：回傳 (狀態碼, {代號: (regularMarketPrice, regularMarketTime, 交易時段 (盤前開始, 正規開始, 正規結束, 盤後結束) 或 None, [(時間, 收盤), …])})。
    regularMarketPrice 在盤前是前一個交易日的收盤、盤後是當天收盤（正規時段的最後價格，盤前盤後的成交不會改它）；K 棒只留有收盤價的。"""
    last = 0
    for host in ('query2', 'query1'):
        url = f'https://{host}.finance.yahoo.com/v7/finance/spark?symbols={",".join(batch)}&range=1d&interval={EXT_IV}&includePrePost=true' + (f'&_={nonce}' if nonce else '')
        try:
            st, body = http(url, timeout=12)
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
                ctp = m.get('currentTradingPeriod') or {}
                g = lambda k, e: num((ctp.get(k) or {}).get(e))
                per = (int(g('pre', 'start')), int(g('regular', 'start')), int(g('regular', 'end')), int(g('post', 'end'))) \
                    if all(g(k, e) for k, e in (('pre', 'start'), ('regular', 'start'), ('regular', 'end'), ('post', 'end'))) else None
                ts = resp.get('timestamp') or []
                cl = (((resp.get('indicators') or {}).get('quote') or [{}])[0].get('close')) or []
                bars = [(int(e), float(c)) for e, c in zip(ts, cl) if c is not None and num(e) is not None and num(c) and num(c) > 0]
                out[str(r['symbol']).upper()] = (p, int(t), per, bars)
            except Exception:
                pass
        return 200, out
    return last, {}


# ---------- 每日市場分析頁：報價板與新聞（2026-11-23） ----------
# 使用者：「每日即時資訊頁面的所有指數跟個股報價還有新聞都要用最新的新聞跟盤前盤後價格及指數點位」；「新聞一個小時更新一次就好」。
# 報價板跟著美股時段（盤前、正規、盤後）每一格抓一次，放在 us.json 的 mb 欄位：
#   mb.q＝{代號: [現價, 前一交易日收盤, 報價時間]}（同 yahoo_batch，5 日日 K）
#   mb.x＝{代號: [盤前或盤後成交價, 基準價, 成交時間]}（只在盤前、盤後；算法同 poll_ext：盤前基準＝前收、盤後基準＝當天收盤）
# 指數本身沒有盤前盤後（Yahoo 的 ^NDX 等只在正規時段更新），網頁用追蹤它的 ETF 的盤前盤後漲跌推估點位：
#   那斯達克 100→QQQ、費城半導體→SOXQ（成交稀少時改 SOXX）、標普 500→SPY、道瓊→DIA、羅素 2000→IWM、那斯達克綜合→ONEQ（成交稀少時改 QQQ）。
# 2026-11-23 08:25 美東從 GitHub runner 實測（專案文件 claude/daily-live-quotes-20261123.md）：指數 rmt 停在 11/20 收盤後；
#   VIX、美元指數、匯率、期貨、比特幣 rmt 是當下；QQQ／SPY／SOXX／IWM 每根 5 分 K 都有盤前成交，SOXQ 25 分鐘內有 20 根、ONEQ 只有 4 根；
#   ^TNX／^TYX 只在芝加哥選擇權交易所時段更新（沒有盤前）；2 年期沒有可用的即時來源。
BOARD = ['^NDX', '^SOX', '^GSPC', '^DJI', '^RUT', '^IXIC', '^VIX', 'DX-Y.NYB', '^TNX', '^TYX', '^FVX', 'JPY=X', 'EURUSD=X', 'TWD=X',
         'CL=F', 'BZ=F', 'GC=F', 'BTC-USD', 'QQQ', 'SPY', 'DIA', 'IWM', 'SOXQ', 'SOXX', 'ONEQ', 'TSM', 'ANT', '2222.SR']
BOARD_EXT = ['QQQ', 'SPY', 'DIA', 'IWM', 'SOXQ', 'SOXX', 'ONEQ', 'TSM', 'ANT']
BOARDS = {'US': BOARD, 'TW': ['TWD=X']}   # 台股 session 也抓美元兌台幣（全站台幣換算用）；加權指數另外用 tw_index() 讀（見該函式）；2026-11-24 起   # 盤前盤後要看成交的：推估指數用的 ETF、熱力圖裡沒有的大型股
NEWS_FILE, NEWS_EVERY = 'news.json', 3600   # 新聞一小時更新一次（交易時段內由 session 順便做；其他時間由 news.yml 補）
NEWS_SRC = [   # (語言, 來源名稱, 格式, 網址)；2026-11-23 從 GitHub runner 實測都回 200
    ('zh', '鉅亨網', 'cnyes', 'https://api.cnyes.com/media/api/v1/newslist/category/us_stock?limit=30'),
    ('zh', 'Google 新聞', 'rss', 'https://news.google.com/rss/search?q=%E7%BE%8E%E8%82%A1%20when%3A1d&hl=zh-TW&gl=TW&ceid=TW%3Azh-Hant'),
    ('en', 'CNBC', 'rss', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114'),
    ('en', 'MarketWatch', 'rss', 'https://feeds.content.dowjones.io/public/rss/mw_topstories'),
]

# 兆元企業各自的最新新聞（每日市場分析第 5 節的卡片）：Google 新聞（繁中）搜尋，近 2 天、每家最多 3 則。
# 公司清單＝最新一份每日報告的 mega.rows（data/daily）；報告上的公司不在這張表裡就用報告上的名稱搜尋。
NEWS_CO_Q = {   # 代號: (Google 新聞搜尋字串, 標題必須含其中一個詞, 標題含這些詞就不要)；2026-11-23 在 GitHub runner 比較過「名稱」與「intitle:名稱」，intitle 版相關度較高
    'AAPL': ('intitle:蘋果 OR intitle:Apple', ('蘋果', 'apple', 'aapl', 'iphone'), ('蘋果糖', '蘋果日報', '蘋果派', '蘋果汁')),
    'MSFT': ('intitle:微軟 OR intitle:Microsoft', ('微軟', 'microsoft', 'msft'), ()),
    'GOOGL': ('intitle:Google OR intitle:谷歌 OR intitle:Alphabet', ('google', '谷歌', 'alphabet', 'googl'), ()),
    'NVDA': ('intitle:輝達 OR intitle:Nvidia', ('輝達', 'nvidia', 'nvda'), ()),
    'AMZN': ('intitle:亞馬遜 OR intitle:Amazon', ('亞馬遜', 'amazon', 'amzn'), ()),
    'SPCX': ('intitle:SpaceX', ('spacex', 'spcx'), ()),
    'TSM': ('intitle:台積電 (ADR OR 股價 OR 營收 OR 法說 OR 美股)', ('台積電', 'tsmc', 'tsm'), ()),
    'AVGO': ('intitle:博通 OR intitle:Broadcom', ('博通', 'broadcom', 'avgo'), ()),
    'META': ('intitle:Meta', ('meta',), ()),
    'TSLA': ('intitle:特斯拉 OR intitle:Tesla', ('特斯拉', 'tesla', 'tsla'), ()),
    'LLY': ('intitle:禮來', ('禮來', 'lilly', 'lly'), ()),
    'BRK.B': ('intitle:波克夏', ('波克夏', 'berkshire', '巴菲特'), ()),
    'ANT': ('intitle:Anthropic', ('anthropic',), ()),
    'WMT': ('intitle:沃爾瑪 OR intitle:Walmart', ('沃爾瑪', 'walmart', 'wmt'), ()),
    '2222.SR': ('沙烏地阿美 OR 阿美石油 OR Aramco', ('沙烏地', '沙國', '阿美', 'aramco'), ()),   # intitle 版 0 則
}
NEWS_CO_MAX, NEWS_CO_AGE = 3, 48 * 3600
# 2026-11-24 使用者：「所有的股價計算在網站上都是用最新的即時價格跟即時消息」→ 個股頁（個股目標價試算）也要即時新聞：
# 兆元企業之外，熱力圖的那斯達克 100、台灣 50 成分股每小時各抓最多 3 則（48 小時內），寫到 news-co.json（每日市場分析頁照舊只讀較小的 news.json）。
# 台股用中文名稱搜中文新聞；美股用英文公司名稱（去掉 Inc.、Corporation 等法律字尾）搜英文新聞，標題必須含整個名稱，避免同名誤判。
NEWS_CO_FILE, NEWS_WATCH = 'news-co.json', ('ndx', 'tw50')
# 不收的來源與標題（2026-11-24 實際抓一輪檢查：CMoney「股市爆料同學會」與 LINE TODAY「討論牆」是網友討論串，247Sports 是運動新聞的同名誤判）
NEWS_BAD_SRC = ('CMoney', '247Sports')
NEWS_BAD_TITLE = ('股市爆料同學', '討論牆', 'Stock Price Prediction')
NEWS_CTX = ('股', '營收', '法說', '董事', '漲', '跌', '獲利', 'EPS', '目標價', '公司', '集團', '企業', '財報', '訂單', '外資', '投信', '法人', '擴產', '產能', '出貨', '接單', '市值', '併購', '新廠', '配息', '除息', '增資')   # 兩個字的台股名稱（統一、南亞…）還要有這些字才算
NEWS_SUFFIX = re.compile(r'[,\s]+(Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Company|Ltd\.?|Limited|plc|PLC|N\.?V\.?|S\.?A\.?|AG|SE|ADR|Class [A-C]|Cl [A-C]|\(The\)|\(DE\)|Holdings|Group|Wholesale)$')
# 新聞標題常用的簡稱（標題要出現這些字之一才算；英文字以整個單字比對，避免 KLA 對到 Oklahoma 之類）
NEWS_ALIAS = {'AMD': ('AMD', 'Advanced Micro Devices'), 'MU': ('Micron',), 'CSCO': ('Cisco',), 'PLTR': ('Palantir',), 'TMUS': ('T-Mobile',), 'QCOM': ('Qualcomm',),
              'MRVL': ('Marvell',), 'STX': ('Seagate',), 'MAR': ('Marriott',), 'CDNS': ('Cadence Design', 'Cadence Design Systems'), 'HON': ('Honeywell',), 'NXPI': ('NXP',),
              'MPWR': ('Monolithic Power',), 'TTWO': ('Take-Two',), 'GEHC': ('GE HealthCare',), 'MSTR': ('MicroStrategy', 'Strategy Inc'), 'NBIS': ('Nebius',), 'ADP': ('ADP',),
              'PDD': ('PDD', 'Temu'), 'ARM': ('Arm Holdings',), 'CRWD': ('CrowdStrike',), 'PYPL': ('PayPal',), 'LITE': ('Lumentum',), 'MDLZ': ('Mondelez',), 'CMCSA': ('Comcast',),
              'BKNG': ('Booking Holdings',), 'KDP': ('Keurig Dr Pepper',), 'CCEP': ('Coca-Cola Europacific',), 'ODFL': ('Old Dominion',), 'REGN': ('Regeneron',), 'GILD': ('Gilead',),
              'VRTX': ('Vertex Pharmaceuticals',), 'ALNY': ('Alnylam',), 'IDXX': ('IDEXX',), 'DXCM': ('DexCom',), 'ISRG': ('Intuitive Surgical',), 'FANG': ('Diamondback Energy',),
              'CEG': ('Constellation Energy',), 'AEP': ('American Electric Power',), 'XEL': ('Xcel Energy',), 'ALAB': ('Astera Labs',), 'RKLB': ('Rocket Lab',), 'AXON': ('Axon',)}


def q_sym(s):
    """Yahoo 代號放進網址：^、= 要編碼（回應裡的代號是原樣）。"""
    return urllib.parse.quote(s, safe='-.')


def news_items(kind, name, body):
    """一個來源的回應 → [{'t': 標題, 'u': 網址, 's': 來源, 'at': UNIX 秒}]。只留標題與連結，不轉載內文。"""
    out = []
    if kind == 'cnyes':
        j = json.loads(body)
        for a in ((j.get('items') or {}).get('data') or []):
            t, nid, at = str(a.get('title') or '').strip(), a.get('newsId'), num(a.get('publishAt'))
            if t and nid and at:
                out.append({'t': t, 'u': f'https://news.cnyes.com/news/id/{int(nid)}', 's': name, 'at': int(at)})
        return out
    root = XET.fromstring(body)
    for it in root.iter('item'):
        t, u, pd = (it.findtext('title') or '').strip(), (it.findtext('link') or '').strip(), it.findtext('pubDate')
        src = it.find('source')
        s = (src.text or '').strip() if src is not None and src.text else name
        if s != name and t.endswith(' - ' + s):   # Google 新聞的標題後面帶「 - 媒體名稱」
            t = t[:-(len(s) + 3)].strip()
        try:
            at = int(email.utils.parsedate_to_datetime(pd).timestamp())
        except Exception:
            continue
        if t and u.startswith('https://'):
            out.append({'t': t, 'u': u, 's': s, 'at': at})
    return out


def news_key(t):
    return re.sub(r'\W+', '', t).lower()[:48]


def mega_list():
    """最新一份每日市場分析報告列的兆元企業 [(代號, 名稱)]；讀不到報告就用 NEWS_CO_Q 的公司。"""
    try:
        d = os.path.join(ROOT, 'data', 'daily')
        latest = json.load(open(os.path.join(d, 'index.json'), encoding='utf-8'))['latest']
        rows = json.load(open(os.path.join(d, latest + '.json'), encoding='utf-8'))['mega']['rows']
        out = [(str(r['t']), str(r.get('n') or r['t'])) for r in rows if r.get('t')]
        if out:
            return out[:20]
    except Exception:
        pass
    return [(k, k) for k in NEWS_CO_Q]


TWNAMES = []   # 台股成分股名稱（fetch_co_news 每次重抓）


def watch_list(skip=()):
    """個股頁即時新聞的公司 [(代號, 名稱, 'TW'｜'US')]：熱力圖 NEWS_WATCH 分頁的成分股（skip＝已經另外抓的兆元企業）。"""
    try:
        d = json.load(open(BASE, encoding='utf-8'))
    except Exception:
        return []
    out, seen = [], set(skip)
    for k in NEWS_WATCH:
        S = (d.get('sets') or {}).get(k) or {}
        mk = 'TW' if S.get('market') == 'TW' else 'US'
        for t in S.get('tiles') or []:
            c, n = str(t[0]), str(t[1]).strip()
            if c and n and c not in seen:
                seen.add(c); out.append((c, n, mk))
    return out


def co_short(n):
    """美股公司名稱去掉法律字尾：'NVIDIA Corporation' → 'NVIDIA'、'Booking Holdings Inc.' → 'Booking Holdings'。"""
    s = n.strip()
    while True:
        s2 = NEWS_SUFFIX.sub('', s).strip().rstrip(',').strip()
        if s2 == s or len(s2) < 2:
            return s
        s = s2


def fetch_co_news(now, extra=False):
    """{代號: [最多 3 則]}；某家抓不到或沒有新聞就不放。extra＝True 時另外回傳個股頁用的那斯達克 100、台灣 50 成分股（watch_list）。"""
    def one(tn):
        tk, nm = tn[0], tn[1]
        lang = 'en' if len(tn) > 2 and tn[2] == 'US' else 'zh'
        wre = None
        if tk in NEWS_CO_Q:
            q, need, bad = NEWS_CO_Q[tk]
        elif len(tn) > 2:   # 那斯達克 100、台灣 50 成分股（watch_list）
            if lang == 'en':
                names = NEWS_ALIAS.get(tk) or (co_short(nm),)
                q = ' OR '.join('intitle:"' + x + '"' for x in names)
                wre = re.compile('|'.join(r'(?<![a-z0-9])' + re.escape(x.lower()) + r'(?![a-z0-9])' for x in names))
            else:
                nm = re.sub(r'[-－]?KY$|\*', '', nm).strip()
                names = [nm] + ([nm[:-2]] if nm.endswith('投控') and len(nm) > 3 else []) + ([nm[:-1]] if nm.endswith('電子') and len(nm) > 3 else [])
                q = ' OR '.join('intitle:' + x for x in names)
                longer = [x for x in TWNAMES if any(n in x and n != x for n in names)]   # 名稱是別家公司名稱的一部分（南亞→南亞科、台塑→台塑化）：先把別家拿掉再比對
                wre = (names, longer)
            need, bad = (), ()
        else:
            q, need, bad = 'intitle:' + nm, (nm.lower(),), ()
        loc = {'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'} if lang == 'en' else {'hl': 'zh-TW', 'gl': 'TW', 'ceid': 'TW:zh-Hant'}
        url = 'https://news.google.com/rss/search?' + urllib.parse.urlencode(dict({'q': q + ' when:2d'}, **loc))
        try:
            st, body = http(url, headers={'Accept': 'application/rss+xml, application/xml, text/xml, */*', 'Accept-Language': 'zh-TW,zh;q=0.9'}, timeout=12)
            items = news_items('rss', 'Google 新聞', body)
        except Exception:
            return tk, None
        def hit(title, low):
            if wre is None:
                return any(w in low for w in need)
            if not isinstance(wre, tuple):
                return bool(wre.search(low))
            names, longer = wre
            t2 = title
            for x in sorted(longer, key=len, reverse=True):
                t2 = t2.replace(x, '')
            if tk in t2:
                return True
            return any(n in t2 and (len(n) > 2 or any(c in t2 for c in NEWS_CTX)) for n in names)
        seen, keep = set(), []
        for it in sorted(items, key=lambda x: -x['at']):
            k, low = news_key(it['t']), it['t'].lower()
            if k in seen or now - it['at'] > NEWS_CO_AGE or it['at'] > now + 600 or it['s'] in NEWS_BAD_SRC or any(w in it['t'] for w in NEWS_BAD_TITLE) \
                    or not hit(it['t'], low) or any(w in low for w in bad):
                continue
            seen.add(k); keep.append(it)
        return tk, keep[:NEWS_CO_MAX]
    global TWNAMES
    out, more = {}, {}
    mega = mega_list()
    TWNAMES = [re.sub(r'[-－]?KY$|\*', '', n).strip() for _, n, m in watch_list() if m == 'TW']
    with cf.ThreadPoolExecutor(4) as ex:
        for tk, items in ex.map(one, mega):
            if items:
                out[tk] = items
        if extra:
            wl, fail = watch_list(skip=[m[0] for m in mega]), []
            for tn, (tk, items) in zip(wl, ex.map(one, wl)):
                if items:
                    more[tk] = items
                elif items is None:
                    fail.append(tn)
            if fail:   # 讀取失敗（多半是來源一時限流）：等 2 秒、慢一點再試一次；沒有新聞（空的）不重試
                time.sleep(2)
                with cf.ThreadPoolExecutor(2) as ex2:
                    for tk, items in ex2.map(one, fail[:24]):
                        if items:
                            more[tk] = items
    return (out, more) if extra else out


def fetch_news(now=None):
    """抓全部新聞來源，合併成 {'schema','at','zh':[…],'en':[…],'co':{代號:[…]},'src':[…]}；綜合新聞全部失敗回 None。
    依時間新到舊，標題相同的只留一則，只留 36 小時內；中文最多 30 則、英文最多 20 則；co＝兆元企業各自最多 3 則（fetch_co_news）。"""
    now = now or time.time()
    out, srcs = {'zh': [], 'en': []}, []
    for lang, name, kind, url in NEWS_SRC:
        try:
            st, body = http(url, headers={'Accept': 'application/json, application/rss+xml, application/xml, text/xml, */*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'}, timeout=15)
            items = news_items(kind, name, body)
            out[lang] += items
            srcs.append({'n': name, 'ok': True, 'k': len(items)})
        except Exception as e:  # noqa
            srcs.append({'n': name, 'ok': False, 'e': repr(e)[:100]})
    if not out['zh'] and not out['en']:
        return None
    for lang, cap in (('zh', 30), ('en', 20)):
        seen, keep = set(), []
        for it in sorted(out[lang], key=lambda x: -x['at']):
            k = news_key(it['t'])
            if k in seen or now - it['at'] > 36 * 3600 or it['at'] > now + 600:
                continue
            seen.add(k); keep.append(it)
        out[lang] = keep[:cap]
    try:
        co, more = fetch_co_news(now, extra=True)
    except Exception as e:  # noqa
        co, more = {}, {}
    srcs.append({'n': 'Google 新聞（兆元企業）', 'ok': bool(co), 'k': sum(len(v) for v in co.values()), 'co': len(co)})
    srcs.append({'n': 'Google 新聞（那斯達克 100、台灣 50 成分股）', 'ok': bool(more), 'k': sum(len(v) for v in more.values()), 'co': len(more)})
    return {'schema': 'bnasdaq-news/1', 'at': int(now), 'zh': out['zh'], 'en': out['en'], 'co': co, 'src': srcs, '_cx': more}


def news_files(n):
    """fetch_news 的結果 → 要寫的檔案：news.json（每日市場分析頁；不含個股頁那一大份）、news-co.json（個股頁：兆元企業＋那斯達克 100、台灣 50 成分股）。"""
    n = dict(n); cx = n.pop('_cx', None)
    files = {NEWS_FILE: json.dumps(n, ensure_ascii=False, separators=(',', ':'))}
    if cx is not None:
        co = dict(cx); co.update(n.get('co') or {})
        files[NEWS_CO_FILE] = json.dumps({'schema': 'bnasdaq-news-co/1', 'at': n['at'], 'co': co}, ensure_ascii=False, separators=(',', ':'))
    return files


def branch_news_at(pub):
    """heatmap-live 分支上現有 news.json 的抓取時間（讀不到回 0）。pub 要先 load() 過。"""
    sha = (getattr(pub, 'keep', None) or {}).get(NEWS_FILE)
    if not sha or not hasattr(pub, 'call'):
        return 0
    try:
        st, b = pub.call('GET', f'/git/blobs/{sha}')
        return int(json.loads(base64.b64decode(b.get('content') or '').decode('utf-8')).get('at') or 0) if st == 200 else 0
    except Exception:
        return 0


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


def tw_index():
    """加權指數 {'^TWII': (現價, 昨收, 報價時間)}，放進台股快照的 mb.q。
    來源：Yahoo奇摩股市 stockList（symbols=^TWII）；讀不到改鉅亨網 TWS:TSE01:INDEX。兩個都讀不到就回空的（呼叫端保留上一輪的值）。
    不用 Yahoo Finance 國際版的 ^TWII：2026-11-24 09:20 實測它給 [39148.91, 36033.29, 09:00:05]——報價停在 20 分鐘前、昨收也不對；
    同一時間 Yahoo奇摩股市是 40143.85（09:34:50，昨收 36811.89）、鉅亨網 40145.33（09:34:45，昨收 36811.89）。"""
    raw = lambda v: num(v.get('raw')) if isinstance(v, dict) else num(v)
    try:
        st, body = http('https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;symbols=%5ETWII', ua=BUA,
                        headers={'Referer': 'https://tw.stock.yahoo.com/', 'Accept-Language': 'zh-TW,zh;q=0.9'}, timeout=10)
        j = json.loads(body)
        for a in (j if isinstance(j, list) else []):
            if str(a.get('symbol') or '') != '^TWII':
                continue
            p, ch, prev, t = raw(a.get('price')), raw(a.get('change')), raw(a.get('regularMarketPreviousClose')), iso_ts(a.get('regularMarketTime'))
            ref = (p - ch) if (p is not None and ch is not None) else prev
            if p and ref and t and p > 0 and ref > 0:
                return {'^TWII': (p, ref, t)}
    except Exception as e:  # noqa
        log('加權指數（Yahoo奇摩股市）讀取失敗', repr(e)[:80])
    try:
        st, body = http('https://ws.api.cnyes.com/ws/api/v1/quote/quotes/TWS:TSE01:INDEX?column=G,QUOTES', ua=BUA,
                        headers={'Origin': 'https://www.cnyes.com', 'Referer': 'https://www.cnyes.com/'}, timeout=8)
        for a in json.loads(body).get('data') or []:
            p, ch, prev, t = num(a.get('6')), num(a.get('11')), num(a.get('21')), num(a.get('200007'))
            ref = (p - ch) if (p is not None and ch is not None) else prev
            if p and ref and t and p > 0 and ref > 0:
                return {'^TWII': (p, ref, int(t))}
    except Exception as e:  # noqa
        log('加權指數（鉅亨網）讀取失敗', repr(e)[:80])
    return {}


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
        if st == 200:
            self.keep = {e['path']: e['sha'] for e in (j.get('tree') or []) if e.get('type') == 'blob'}
        elif st == 404:   # 分支還不存在
            self.keep = {}
        # 其他錯誤（暫時讀不到）：沿用上一次記得的檔案清單，不要因為一次讀取失敗就把另一個市場的檔案從分支上拿掉
        return st

    def publish(self, mk, slot, text, message, extra=None):
        """寫 <file>.json 與 <file>-<slot>.json（extra＝同一個 commit 一起寫的其他檔案，例如 news.json）；其餘檔案沿用分支上現有的 blob。成功回 True。
        2026-11-23 起美股盤後（到台北 08:00／09:00）和台股的準備時間會重疊、兩個市場可能同時在發布：
        每次發布前重讀分支（另一個市場剛發布的檔案才不會被這裡記得的舊版本蓋回去），別的市場的時間格檔只刪 10 分鐘以前的。"""
        if self.load() != 200 and not self.keep:
            log('讀不到 heatmap-live 分支（第一次發布或暫時讀不到），照樣發布')
        f = MARKETS[mk]['file']
        mine = sorted((p for p in self.keep if p.startswith(f + '-')), key=lambda p: p)   # 這個市場的時間格檔
        now = time.time()

        def old(p):   # 別的市場的時間格檔是不是 10 分鐘以前的（時間格＝UNIX 秒 ÷ 該市場的間隔）
            for m in MARKETS:
                if m != mk and p.startswith(MARKETS[m]['file'] + '-'):
                    try:
                        return now - int(p[len(MARKETS[m]['file']) + 1:].split('.')[0]) * MARKETS[m]['step'] > 600
                    except ValueError:
                        return True
            return False
        other = [p for p in self.keep if old(p)]
        drop = set(other) | set(mine[:-(KEEP - 1)] if KEEP > 1 else mine)
        files = {f + '.json': text, f'{f}-{slot}.json': text}
        files.update(extra or {})
        return self.commit(files, drop, message)

    def put(self, files, message):
        """只寫指定的檔案（news.yml 更新新聞用），其餘照舊。成功回 True。"""
        self.load()
        return self.commit(files, set(), message)

    def commit(self, files, drop, message):
        tree = [{'path': p, 'mode': '100644', 'type': 'blob', 'content': c} for p, c in files.items()]
        if 'README.md' not in self.keep and 'README.md' not in files:
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
        """別的 run 的狀況：回傳 [(run 編號, session job 狀態, gate job 狀態, session 跑哪個市場)]（只看還沒結束的 run）。
        session job 的名稱是「session TW」／「session US」（2026-11-23 起）；舊格式「session」或名稱還沒決定的，市場回 None（當成兩個市場都可能）。"""
        st, j = self.call('GET', f'/actions/workflows/{WORKFLOW}/runs?per_page=30')
        out = []
        for r in (j.get('workflow_runs') or []) if st == 200 else []:
            if str(r.get('id')) == str(me) or r.get('status') == 'completed':
                continue
            st2, jj = self.call('GET', f'/actions/runs/{r["id"]}/jobs?per_page=20')
            sess, gate_st, mk = None, None, None
            for x in (jj.get('jobs') or []) if st2 == 200 else []:
                nm = str(x.get('name') or '')
                if nm == 'gate':
                    gate_st = x.get('status')
                elif nm.startswith('session'):
                    sess = x.get('status'); tail = nm[len('session'):].strip().upper()
                    mk = tail if tail in MARKETS else None
            out.append((int(r['id']), sess, gate_st, mk))
        return out


class FilePub:
    """本機測試用：把檔案寫到資料夾，不碰 GitHub。"""
    def __init__(self, out):
        self.out = out; os.makedirs(out, exist_ok=True)

    def load(self):
        return 200

    def publish(self, mk, slot, text, message, extra=None):
        f = MARKETS[mk]['file']
        for name in (f + '.json', f'{f}-{slot}.json'):
            open(os.path.join(self.out, name), 'w', encoding='utf-8').write(text)
        mine = sorted(p for p in os.listdir(self.out) if p.startswith(f + '-'))
        for p in mine[:-KEEP]:
            os.remove(os.path.join(self.out, p))
        return self.put(extra or {}, message)

    def put(self, files, message):
        for name, text in files.items():
            open(os.path.join(self.out, name), 'w', encoding='utf-8').write(text)
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
        # 美股盤前／盤後（2026-11-23）
        self.ext = 'pre' in self.sess        # 這個市場有沒有盤前盤後
        self.xkind = None    # 目前在哪個延長時段：'pre'／'post'；None＝正規時段
        self.xstate = 'open'
        self.x = {}          # 代號 → [盤前或盤後價, 基準價（盤前＝前收、盤後＝當天收盤）, 報價時間]
        self.xpath = {}      # 代號 → {時間格: 漲跌（0.01%）}；時間格＝(K 棒時間 − 該時段開始) ÷ xpstep
        self.xpstep = MARKETS[mk].get('xpstep') or 900
        self.xok = 0         # 盤前盤後抓到 Yahoo 正常回應的輪數（判斷休市用：有回應卻沒有當天成交＝休市）
        # 每日市場分析頁（2026-11-23）：報價板（只有美股）與新聞（兩個市場的 session 都會順便更新，一小時一次）
        self.mb_q, self.mb_x = {}, {}   # 代號 → [現價, 前收, 時間]；盤前盤後 → [成交價, 基準價, 成交時間]
        self.news_at = 0     # 分支上的新聞是什麼時候抓的（UNIX 秒）
        self.extra = {}      # 下一次發布要一起寫的其他檔案（news.json）

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
            # 美股盤後交棒：正規時段的收盤報價也接著用（盤後那幾份快照的 q 仍是當天收盤；前收由漲跌反推，誤差在四捨五入以內）
            if self.ext and isinstance(j.get('q'), dict) and isinstance(j.get('at'), (int, float)):
                for s_, v in j['q'].items():
                    try:
                        p, c, age = float(v[0]), float(v[1]), float(v[2])
                        if p > 0 and c > -100:
                            self.q[s_] = [p, p / (1 + c / 100), int(j['at'] - age)]
                    except Exception:
                        pass
                if self.q:
                    log('接續當天正規時段報價：', len(self.q), '檔')
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
        self.pace(stat)
        return stat['ok'] > 0

    def pace(self, stat):
        """Yahoo 回 429 → 發布間隔加倍（最多 5 分鐘）；連續 10 輪正常 → 減半，回到原本的間隔。"""
        if stat['429']:
            self.every, self.clean = min(300, self.every * 2), 0
            log('Yahoo 回 429，更新間隔拉長到', self.every, '秒')
        else:
            self.clean += 1
            if self.clean >= 10 and self.every > self.step:
                self.every, self.clean = max(self.step, self.every // 2), 0
                log('更新間隔縮回', self.every, '秒')

    def poll_ext(self, kind):
        """美股盤前（kind='pre'）／盤後（'post'）抓一輪。每一檔：該時段內最後一根有成交的 K 棒＝最新價；
        基準＝regularMarketPrice（盤前必須是前一個交易日的收盤、盤後必須是當天的收盤，不符就不收）；
        同一份回應順便算出該時段每 xpstep 秒一點的走勢（每輪整段重算，交棒或重啟都不會缺前段）。回傳 Yahoo 有沒有正常回應。"""
        self.poll_n += 1
        got, stat = fetch_us(self.syms, int(self.clock()), f=yahoo_ext)   # 每一輪不同的參數：避開 Yahoo 的 5 分鐘快取
        s = self.sess
        votes = {}
        for p, t, per, bars in got.values():   # 當天實際的時段（提早收盤日：正規到 13:00、盤後到 17:00）；正規開盤時間對得上才算，多數決
            if per and per[1] == s['open'] and s['open'] - 6 * 3600 <= per[0] <= s['open'] and s['open'] + 3600 <= per[2] < per[3] <= per[2] + 5 * 3600:
                votes[per] = votes.get(per, 0) + 1
        if votes:
            per, n = max(votes.items(), key=lambda kv: kv[1])
            if n >= 20:
                for k, v in (('pre', per[0]), ('close', per[2]), ('post', per[3])):
                    if s.get(k) != v:
                        log('依行情來源調整', {'pre': '盤前開始', 'close': '收盤', 'post': '盤後結束'}[k], s.get(k), '→', v)
                        s[k] = v
        lo, hi = (s['pre'], s['open']) if kind == 'pre' else (s['close'], s['post'])
        for sym, (p, t, per, bars) in got.items():
            if (kind == 'pre' and t >= s['pre']) or (kind == 'post' and t < s['open'] - 60):
                continue   # 盤前：基準不是前一個交易日的收盤；盤後：今天正規時段沒有成交（停牌等），沒有盤後的基準
            pts = [(e, c) for e, c in bars if lo <= e < hi]
            if not pts:
                continue   # 這個時段還沒有成交
            p = self.close_of(sym, self.q, kind, p)
            e, c = pts[-1]
            self.x[sym] = [c, p, e]
            if PATHSET is not None and sym not in PATHSET:
                continue   # 多抓的代號（網站價格表）只要最新成交，不記走勢
            d = {}
            for e2, c2 in pts:
                d[int((e2 - lo) // self.xpstep)] = int(round((c2 / p - 1) * 10000))
            self.xpath[sym] = d
        if stat['ok']:
            self.xok += 1
        self.pace(stat)
        return stat['ok'] > 0

    def poll_board(self, kind=None):
        """每日市場分析頁的報價板（見 BOARD 的說明）。kind＝'pre'／'post'：另外抓 BOARD_EXT 的盤前／盤後成交（算法同 poll_ext）。
        美股與台股各自的清單見 BOARDS（台股只有匯率，加權指數另用 tw_index()；沒有盤前盤後）；這一輪沒抓到的代號保留上一輪的值。"""
        bl = BOARDS.get(self.mk) or []
        if not bl:
            return False
        nonce = int(self.clock())
        got, stat = fetch_us([q_sym(s) for s in bl], nonce)
        for s, v in got.items():
            self.mb_q[s] = [v[0], v[1], int(v[2])]
        if self.mk == 'TW':   # 加權指數：Yahoo奇摩股市（備援鉅亨網），即時、昨收正確
            for s, v in tw_index().items():
                self.mb_q[s] = [v[0], v[1], int(v[2])]
        if kind and self.mk == 'US':
            s_ = self.sess
            lo, hi = (s_['pre'], s_['open']) if kind == 'pre' else (s_['close'], s_['post'])
            gx, _ = fetch_us([q_sym(s) for s in BOARD_EXT], nonce, f=yahoo_ext)
            for s, (p, t, per, bars) in gx.items():
                if (kind == 'pre' and t >= s_['pre']) or (kind == 'post' and t < s_['open'] - 60):
                    continue
                pts = [(e, c) for e, c in bars if lo <= e < hi]
                if pts:
                    self.mb_x[s] = [pts[-1][1], self.close_of(s, self.mb_q, kind, p), pts[-1][0]]
        return stat['ok'] > 0

    def close_of(self, sym, qmap, kind, p):
        """盤後的基準（當天收盤）：正規時段的最後報價（收盤後抓到、報價時間在收盤前 1 分鐘以後）優先，
        沒有才用走勢 API 的 regularMarketPrice。2026-11-23 實測走勢 API 的 regularMarketPrice 收盤後半小時有一半的代號
        還停在收盤前的成交（HPE 48.018，正規時段最後報價＝收盤 48.31，盤後漲跌差 0.58 個百分點）。盤前不動（基準＝前一個交易日收盤）。"""
        if kind != 'post':
            return p
        v = qmap.get(sym)
        if v and v[0] and v[0] > 0 and v[2] and v[2] >= self.sess['close'] - 60:
            return v[0]
        return p

    def maybe_news(self):
        """新聞一小時更新一次：到時間就抓，放進下一次發布（同一個 commit）；全部來源都失敗就 10 分鐘後再試。"""
        now = self.clock()
        if now - self.news_at < NEWS_EVERY:
            return
        n = fetch_news(now)
        if n:
            self.extra.update(news_files(n))
            self.news_at = now
            log('新聞更新：中文', len(n['zh']), '則、英文', len(n['en']), '則；', '、'.join(f"{x['n']} {'OK ' + str(x.get('k')) if x['ok'] else '失敗'}" for x in n['src']))
        else:
            self.news_at = now - NEWS_EVERY + 600
            log('新聞來源全部失敗，10 分鐘後再試')

    def branch_news_at(self):
        return branch_news_at(self.pub)

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
        snap = {'schema': SCHEMA, 'market': self.mk, 'session': self.sess['date'], 'state': state, 'at': int(now), 'slot': slot, 'every': self.every,
                'step': self.step, 'open': self.sess['open'], 'close': self.sess['close'], 'src': self.src, 'n': len(self.syms), 'have': len(q), 'q': q,
                'ps': self.pstep, 'pn': pn, 'pp': pp}
        if self.xkind:   # 美股盤前／盤後
            s = self.sess
            lo, hi = (s['pre'], s['open']) if self.xkind == 'pre' else (s['close'], s['post'])
            x = {}
            for sym in self.syms:
                v = self.x.get(sym)
                if v:
                    x[sym] = [round(v[0], 4), round((v[0] / v[1] - 1) * 100, 2), max(0, int(now - v[2]))]
            xpp = {sym: [d.get(k) for k in range(0, max(d) + 1)] for sym, d in self.xpath.items() if d and sym in x}
            snap.update({'ext': self.xkind, 'xstate': self.xstate, 'xopen': lo, 'xclose': hi, 'xsrc': 'Yahoo Finance', 'xn': len(x), 'x': x,
                         'xps': self.xpstep, 'xpn': max(1, int(-(-(hi - lo) // self.xpstep))), 'xpp': xpp})
        if self.mb_q:   # 每日市場分析頁的報價板（見 BOARD）
            r = lambda v: [round(v[0], 6), round(v[1], 6), int(v[2])]
            snap['mb'] = {'q': {s: r(v) for s, v in self.mb_q.items()}, 'x': {s: r(v) for s, v in self.mb_x.items()}}
        return snap

    def publish(self, state, slot, now):
        snap = self.snapshot(state, slot, now)
        hm = dt.datetime.fromtimestamp(now, ZoneInfo(MARKETS[self.mk]['tz'])).strftime('%Y-%m-%d %H:%M')
        ext = f' {snap["ext"]}-{snap["xstate"]} {snap["xn"]}/{snap["n"]}' if snap.get('ext') else ''   # 盤前盤後：另外寫有成交的檔數
        msg = f'heatmap live {self.mk} {hm} {state} {snap["have"]}/{snap["n"]}{ext}' + (' +news' if self.extra else '') + f' run={os.environ.get("GITHUB_RUN_ID", "local")}'
        text = json.dumps(snap, ensure_ascii=False, separators=(',', ':'))
        # 2026-11-24 站主：熱力圖要能切換 盤前／盤中／盤後 → 盤前、盤後的快照另外留一份 us_pre.json／us_post.json
        # （檔名用底線，不會被時間格檔的清理規則 us-* 刪掉）；過了那個時段還是讀得到當天最後一份
        extra = dict(self.extra)
        if snap.get('ext'):
            extra[f'{MARKETS[self.mk]["file"]}_{snap["ext"]}.json'] = text
        ok = self.pub.publish(self.mk, slot, text, msg, extra=extra) if extra else self.pub.publish(self.mk, slot, text, msg)
        if ok:
            self.extra = {}
        return ok, snap

    # --- 主迴圈 ---
    def run(self):
        """台股：正規時段。美股：盤前 → 正規時段 → 盤後。回傳 'closed'／'done'／'relay'／'holiday'／'failed'。"""
        s = self.sess
        log(f'{self.mk} 時段 {s["date"]}：' + (f'盤前 {s["pre"]}、' if self.ext else '') + f'開盤 {s["open"]}、收盤 {s["close"]}' +
            (f'、盤後到 {s["post"]}' if self.ext else '') + f'；{len(self.syms)} 檔')
        self.pub.load()
        self.resume()
        self.news_at = self.branch_news_at()
        if self.ext:
            r = self.run_ext('pre')
            if r != 'done':
                return r
        r = self.run_regular()
        if not self.ext or r != 'closed':
            return r
        return self.run_ext('post')

    def relay(self):
        """這個 job 跑滿了：啟動下一棒（同一個市場）。成功回 True；失敗 10 分鐘後再試（離 6 小時上限還有餘裕）。"""
        ok2, st, r = self.pub.dispatch(os.environ.get('GITHUB_REF_NAME') or 'main', {'relay': str(os.environ.get('GITHUB_RUN_ID') or '1'), 'market': self.mk})
        log('這個 job 跑滿了，交棒給下一個 run：', '已啟動' if ok2 else f'啟動失敗 {st} {str((r or {}).get("message"))[:100]}')
        if not ok2:
            self.t0 += 600
        return ok2

    def run_ext(self, kind):
        """美股盤前（kind='pre'：盤前開始 → 開盤，之後交給正規時段）或盤後（'post'：收盤 → 盤後結束＋xtail）。
        每一格抓一次、發布一次；回傳 'done'（這個時段結束）／'relay'／'holiday'／'failed'。"""
        s, step, xtail, name = self.sess, self.step, MARKETS[self.mk]['xtail'], '盤前' if kind == 'pre' else '盤後'
        stop = lambda: s['open'] if kind == 'pre' else s['post'] + xtail   # 行情來源可能調整時段（提早收盤日），每次重算
        if self.clock() >= stop():
            return 'done'
        self.xkind, self.xstate, self.x, self.xpath, self.xok, self.mb_x, fails = kind, 'open', {}, {}, 0, {}, 0
        if kind == 'post':
            self.every = step
            if self.poll_us():   # 正規時段的收盤價再抓一次：交棒、或上一棒沒發布到收盤那一份時，快照的 q 才會是當天收盤
                self.track()
        lo = lambda: s['pre'] if kind == 'pre' else s['close']
        wait = lo() - self.clock()
        if wait > 0:
            log(f'離{name}開始還有 {wait / 60:.1f} 分鐘，等待中')
        while lo() - self.clock() > 0:
            self.sleep(min(30, max(0.5, lo() - self.clock())))
        nxt = (int(self.clock()) // step) * step   # 現在這一格立刻做
        while True:
            now = self.clock()
            if now < nxt:
                self.sleep(min(30, max(0.2, nxt - now))); continue
            slot = nxt // step
            ok = self.poll_ext(kind)
            self.poll_board(kind)
            self.maybe_news()
            now = self.clock()
            if kind == 'pre' and now >= s['open']:   # 開盤了：盤前最後一份標成結束，交給正規時段（正規時段同一格馬上會再發布一份）
                self.xstate = 'closed'
                if self.x:
                    done, snap = self.publish('pre', slot, now)
                    log(f'盤前結束：{snap["xn"]}/{snap["n"]} 檔有盤前成交，發布{"成功" if done else "失敗"}；交給正規時段')
                return 'done'
            fin = now >= stop()
            if not self.x:
                if kind == 'pre' and now - lo() > HOLIDAY and self.xok >= 3:
                    log('盤前開始後一直沒有任何一檔有當天的盤前成交（Yahoo 有正常回應）：休市，結束（不發布）'); return 'holiday'
                if fin:
                    log(f'{name}一直沒有抓到成交，結束（不發布）'); return 'done'
                if self.poll_n % 10 == 1:
                    log(f'{name}這一輪還沒有任何成交' if ok else '這一輪抓不到資料，跳過')
            elif ok or fin:
                self.xstate = 'closed' if fin else 'open'
                done, snap = self.publish('pre' if kind == 'pre' else 'closed', slot, now)
                fails = 0 if done else fails + 1
                if self.poll_n % 10 == 1 or fin or not done:
                    log(f'{name} 第 {slot} 格：{snap["xn"]}/{snap["n"]} 檔有成交，來源 Yahoo Finance，發布{"成功" if done else "失敗"}')
                if fin and done:
                    log(f'{name}結束'); return 'done'
                if fin and fails >= 5:
                    log(f'{name}最後一份發布不出去，放棄'); return 'failed'
            elif self.poll_n % 10 == 1:
                log('這一輪抓不到資料，跳過')
            if now - self.t0 > self.budget and now < stop() - 180 and self.relay():
                return 'relay'
            nxt = (int(now) // step) * step + max(step, (self.every // step) * step)

    def run_regular(self):
        mk, tail, step = self.mk, MARKETS[self.mk]['tail'], self.step
        if self.ext and self.clock() >= self.sess['close'] + tail:
            return 'closed'   # 美股交棒時已經過了正規時段：收盤那一份與收盤後更新由上一棒做過，直接進盤後
        self.xkind, self.mb_x = None, {}
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
            self.poll_board()   # 報價板：美股（每日市場分析頁）、台股（匯率與加權指數），見 BOARDS
            self.maybe_news()
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
                        log(('提早收盤（報價不再更新）' if frozen else '收盤') + ('，接著盤後' if self.ext else '，結束')); return 'closed'
                    if state == 'closed' and self.fails >= 5:
                        log('收盤那一份發布不出去，放棄'); return 'failed'
                elif self.poll_n % 10 == 1:
                    log('這一輪抓不到資料，跳過')
                if now >= self.sess['close'] + MARKETS[mk]['after']:   # 收盤後過了這麼久（收盤價到齊）→ 更新全站的最新收盤價
                    self.after_close()
            if now - self.t0 > self.budget and now < self.sess['close'] - 180 and self.relay():
                return 'relay'
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
        note('gate：90 分鐘內（美股盤前 120 分鐘內）沒有要開始或正在進行的交易時段（週末或時間還沒到）→ 不跑'); out(go='false', market=''); return 0
    if relay:
        note(f'gate：接力，接手 run {relay} 的 {cands[0]} 時段'); out(go='true', market=cands[0]); return 0
    # 2026-11-23 起美股盤後（到台北 08:00／09:00）和台股的準備時間重疊：兩個市場各自最多一個 session，看的是「這個市場」有沒有人在跑
    me = os.environ.get('GITHUB_RUN_ID') or '0'
    pub = Pub(os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_TOKEN'])
    others, busy = pub.others(me), set()
    for rid, sess_st, gate_st, omk in others:
        if not want and rid < int(me) and gate_st != 'completed':   # 指定市場的 run（手動或下面另外啟動的）不必等
            note(f'gate：較早的 run {rid} 還在判斷中，讓它先 → 不跑'); out(go='false', market=''); return 0
        if sess_st in ('queued', 'in_progress', 'waiting', 'pending', 'requested'):
            busy |= {omk} if omk else set(MARKETS)   # 舊格式（job 名稱沒有市場）：當成兩個市場都在跑
            note(f'gate：run {rid} 已經在跑 {omk or "（市場不明）"} 時段')
    free = [m for m in cands if m not in busy]
    if not free:
        note(f'gate：{"、".join(cands)} 都已經有 run 在跑 → 不重複跑'); out(go='false', market=''); return 0
    if len(free) > 1:   # 兩個市場都需要、又都沒有人跑：這個 run 跑第一個，另外啟動一個 run 專跑第二個
        ok, st, r = pub.dispatch(os.environ.get('GITHUB_REF_NAME') or 'main', {'market': free[1]})
        note(f'gate：{free[1]} 也需要 → 另外啟動一個 run：', '已啟動' if ok else f'啟動失敗 {st} {str((r or {}).get("message"))[:100]}')
    note(f'gate：啟動 {free[0]} 時段'); out(go='true', market=free[0]); return 0


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
            if '--board' in a:   # 檢查每日市場分析頁的報價板：once --market US --board [pre｜post]
                i = a.index('--board'); kind = a[i + 1] if len(a) > i + 1 and a[i + 1] in ('pre', 'post') else None
                ok = s.poll_board(kind); snap = s.snapshot('open', int(time.time()) // s.step, time.time())
                print(json.dumps({'ok': ok, 'q': len(snap.get('mb', {}).get('q', {})), 'x': len(snap.get('mb', {}).get('x', {})), 'mb': snap.get('mb')}, ensure_ascii=False))
                return 0
            kind = a[a.index('--ext') + 1] if '--ext' in a else ''   # 檢查盤前盤後來源：once --market US --ext pre｜post
            if kind in ('pre', 'post') and s.ext:
                s.xkind = kind; ok = s.poll_ext(kind); snap = s.snapshot('pre' if kind == 'pre' else 'closed', int(time.time()) // s.step, time.time())
                ages = sorted(v[2] for v in snap['x'].values())
                print(json.dumps({'ok': ok, 'ext': kind, 'xn': snap['xn'], 'n': snap['n'], 'window': [snap['xopen'], snap['xclose']],
                                  'quote_age_sec_min_med_max': [ages[0], ages[len(ages) // 2], ages[-1]] if ages else None,
                                  'path_points_max': max((len(v) for v in snap['xpp'].values()), default=0), 'sample': dict(list(snap['x'].items())[:5])}, ensure_ascii=False))
                return 0
            ok = s.poll(); snap = s.snapshot('open', int(time.time()) // s.step, time.time())
            ages = sorted(v[2] for v in snap['q'].values())
            print(json.dumps({'ok': ok, 'src': s.src, 'have': snap['have'], 'n': snap['n'], 'quote_age_sec_min_med_max': [ages[0], ages[len(ages) // 2], ages[-1]] if ages else None,
                              'sample': dict(list(snap['q'].items())[:5])}, ensure_ascii=False))
            return 0
        if now >= span(mk, sess)[1]:
            log(mk, '今天的時段已經結束'); return 0
        pub = Pub(os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_TOKEN'])
        res = Session(mk, sess, syms, pub).run()
        note(f'session：{mk} {sess["date"]} 結果', res)
        return 0
    if cmd == 'news':
        # 新聞一小時更新一次（2026-11-23 使用者）：交易時段內 session 會順便做；其他時間（台股收盤到美股盤前的空檔、週末）由 .github/workflows/news.yml 呼叫這裡補。
        # --print：只抓、印出來，不發布（測試用）；--force：不管上次多久前更新都重抓
        if '--print' in a:
            n = fetch_news()
            if not n:
                print('None'); return 1
            hh = lambda x: dt.datetime.fromtimestamp(x['at'], ZoneInfo('Asia/Taipei')).strftime('%m-%d %H:%M')
            print('來源：', json.dumps(n['src'], ensure_ascii=False))
            for lang in ('zh', 'en'):
                print(f'{lang} {len(n[lang])} 則；最新 5 則：'); [print('  ', hh(x), x['s'], '｜', x['t'][:70], '｜', x['u'][:60]) for x in n[lang][:5]]
            print(f'兆元企業 {len(n["co"])} 家：'); [print('  ', k, len(v), '則；', hh(v[0]), v[0]['s'], '｜', v[0]['t'][:60]) for k, v in n['co'].items()]
            cx = n.get('_cx') or {}; wl = watch_list(skip=n['co'])
            print(f'那斯達克 100、台灣 50 成分股 {len(cx)}／{len(wl)} 家有新聞：'); [print('  ', k, len(v), '則；', hh(v[0]), v[0]['s'], '｜', v[0]['t'][:60]) for k, v in list(cx.items())[:40]]
            print('沒有新聞：', ' '.join(c for c, _, _ in wl if c not in cx)[:600])
            for f, s in news_files(n).items():
                print(f, '大小', len(s.encode()), 'bytes')
            print('news.json 大小', len(json.dumps(n, ensure_ascii=False, separators=(',', ':')).encode()), 'bytes')
            return 0
        pub = Pub(os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_TOKEN']); pub.load()
        age = time.time() - branch_news_at(pub)
        if age < NEWS_EVERY - 300 and '--force' not in a:
            note(f'新聞 {age / 60:.0f} 分鐘前才更新過，這次不重抓'); return 0
        n = fetch_news()
        if not n:
            note('新聞來源全部失敗，這次沒有更新'); return 1
        ok = pub.put(news_files(n), f'news zh={len(n["zh"])} en={len(n["en"])} co={len(n.get("co") or {})} cx={len(n.get("_cx") or {})} run={os.environ.get("GITHUB_RUN_ID", "local")}')
        note(f'新聞更新：中文 {len(n["zh"])} 則、英文 {len(n["en"])} 則、兆元企業 {len(n.get("co") or {})} 家，發布{"成功" if ok else "失敗"}；' + '、'.join(f"{x['n']} {'OK ' + str(x.get('k')) if x['ok'] else '失敗'}" for x in n['src']))
        return 0 if ok else 1
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
