#!/usr/bin/env python3
"""每日市場分析發布：排程「每日 BNASDAQ 財經報告」寫入 data/daily 的唯一方式。

  python3 scripts/publish_daily.py 報告.json

報告.json＝schema「bnasdaq-daily/1」的報告內容（session、headline、summary、indices、sources…，欄位照最新一份 data/daily/*.json）。
date、generated 不用填，填了也會被覆寫——日期由本程式決定，不交給人或 AI 判斷：
  date      ＝現在的台北日期（固定 UTC+8 計算，不依賴系統時區；排程台北 06:46 執行時 UTC 還是前一天）
  generated ＝現在時間（UTC）
寫入 data/daily/<date>.json，更新 index.json（今天這筆已存在就更新，否則加在最前面；latest＝date），
最後跑 scripts/check_daily.py 的全部檢查（含 --today）；任何一項不通過就還原、不留下半套檔案。

拒絕發布（結束碼 1，檔案不變）：
  - 缺少必要欄位、schema 不對，或 session 不是 YYYY-MM-DD、晚於今天、早於前一份報告的 session
  - data/daily/<今天>.json 已存在但不是今天（台北）產出的，或它的 session 比這次新
--now 只給測試用（模擬執行時間，例 2026-11-11T22:46:00Z）。

主題標記（2026-11-22 起；網頁每一則消息後面的「模型影響」用）：每一則消息標上 data/daily-topics.json 的主題代碼——
  big_move.causes[] 每一項加 "tags": ["代碼", …]
  events[] 每一組加 "tags": [[…], […], …]（和 items 一一對應，第 i 個是第 i 則的代碼）
  mega.rows[] 每一列加 "tags": ["代碼", …]
本程式只檢查、不擋發布：沒標、代碼不在表內、或 events 的 tags 和 items 數目對不上，都會列出 ⚠️（對不上的那一組標記會被拿掉，免得標到別則消息），
報告照樣發布成功；修正後重跑一次本程式即可更新。沒有標記的消息，網頁改用關鍵字比對。
"""
import argparse, datetime as dt, json, os, sys

sys.dont_write_bytecode = True  # 不產生 scripts/__pycache__，排程提交前「只能有 data/daily 變更」的檢查才不會被擋
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_daily as cd  # noqa: E402
import daily_fx as dfx  # noqa: E402

SCHEMA = 'bnasdaq-daily/1'
REQUIRED = ['session', 'headline', 'summary', 'indices', 'sources']


TOPICS = os.path.join(cd.ROOT, 'data', 'daily-topics.json')


def check_tags(rep):
    """主題標記檢查（不擋發布）。回傳 (消息總數, 有標記的則數, 問題清單)；events 的 tags 和 items 對不上時，直接拿掉那一組的 tags。"""
    try:
        codes = {t['code'] for t in cd.load(TOPICS)['topics']}
    except Exception as e:  # 讀不到代碼表：不檢查
        return 0, 0, [f'讀不到主題代碼表 data/daily-topics.json（{e}），這次不檢查主題標記']
    warns, total, tagged = [], 0, 0

    def one(where, tags):
        nonlocal total, tagged
        total += 1
        if tags is None:
            warns.append(f'{where}：沒有主題標記')
            return
        if not (isinstance(tags, list) and tags and all(isinstance(x, str) for x in tags)):
            warns.append(f'{where}：tags 應為代碼陣列（例 ["rate", "bond"]），收到 {tags!r}')
            return
        bad = [x for x in tags if x not in codes]
        if bad:
            warns.append(f'{where}：代碼 {"、".join(bad)} 不在 data/daily-topics.json')
        if len(bad) < len(tags):
            tagged += 1

    bm = rep.get('big_move') if isinstance(rep.get('big_move'), dict) else {}
    for i, c in enumerate(bm.get('causes') or []):
        if isinstance(c, dict):
            one(f'big_move.causes[{i}]', c.get('tags'))
    for gi, g in enumerate(rep.get('events') or []):
        if not isinstance(g, dict):
            continue
        items, tags = g.get('items') or [], g.get('tags')
        if tags is not None and not (isinstance(tags, list) and len(tags) == len(items)):
            warns.append(f'events[{gi}]（{g.get("cat")}）：tags 要和 items 一一對應（{len(items)} 則），收到 {len(tags) if isinstance(tags, list) else type(tags).__name__}；這一組的標記已拿掉')
            del g['tags']
            tags = None
        for i in range(len(items)):
            one(f'events[{gi}].tags[{i}]', None if tags is None else tags[i])
    mega = rep.get('mega') if isinstance(rep.get('mega'), dict) else {}
    for r in mega.get('rows') or []:
        if isinstance(r, dict):
            one(f'mega.rows[{r.get("t")}]', r.get('tags'))
    return total, tagged, warns


def dump(obj, path, indent):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(obj, ensure_ascii=False, indent=indent) + '\n')


def main():
    ap = argparse.ArgumentParser(description='每日市場分析發布（日期一律由程式決定：台北日期）')
    ap.add_argument('report', help='報告 JSON（放在 repo 外的暫存檔）')
    ap.add_argument('--now', help='模擬現在時間（測試用）')
    a = ap.parse_args()
    now = (cd.parse_time(a.now) if a.now else dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc).replace(microsecond=0)
    day = cd.taipei_date(now)

    rep = cd.load(a.report)
    errs = []
    if rep.get('schema', SCHEMA) != SCHEMA:
        errs.append(f'schema 應為 {SCHEMA}，收到 {rep.get("schema")}')
    miss = [k for k in REQUIRED if k not in rep]
    if miss:
        errs.append('缺少欄位：' + '、'.join(miss))
    s = rep.get('session')
    idx = cd.load(cd.INDEX)
    others = [i for i in idx.get('items') or [] if i.get('date') != day]
    prev = max((i for i in others if (i.get('date') or '') < day), key=lambda i: i['date'], default=None)
    if not (isinstance(s, str) and cd.DATE.match(s)):
        errs.append(f'session 應為美股交易日 YYYY-MM-DD，收到 {s!r}')
    else:
        if s > day:
            errs.append(f'session {s} 晚於今天（台北 {day}）')
        if prev and s < prev.get('session', ''):
            errs.append(f'session {s} 比前一份 {prev["date"]} 的美股 {prev["session"]} 還舊')
    path = os.path.join(cd.DIR, day + '.json')
    old_raw = open(path, encoding='utf-8').read() if os.path.exists(path) else None
    if old_raw is not None:
        old = json.loads(old_raw)
        g = old.get('generated')
        if not g or cd.taipei_date(g) != day:
            errs.append(f'data/daily/{day}.json 已存在但不是今天（台北）產出的（generated {g}），不覆蓋；請人工檢查')
        elif isinstance(s, str) and (old.get('session') or '') > s:
            errs.append(f'data/daily/{day}.json 已是美股 {old.get("session")} 的報告，比這次的 {s} 新，不覆蓋')
    if errs:
        print('不發布：')
        for e in errs:
            print('  ❌ ' + e)
        sys.exit(1)

    # 「美元與台幣視角」（2026-11-27 起每一版都要有；說明見 scripts/daily_fx.md）：數字由程式現抓現算後寫進 fx.asof、fx.data，
    # 報告只提供情境判斷與說明文字；文字不齊或和現在的數字矛盾就不發布。
    fxres = dfx.collect(now)
    ferrs = dfx.validate(rep.get('fx'), fxres['data'])
    if ferrs:
        print('不發布：報告的 fx 欄位（「美元與台幣視角」）要補上或修正——')
        for e in ferrs:
            print('  ❌ ' + e)
        print('做法：先看下面「現在的數字」，再照 scripts/daily_fx.md 在報告 JSON 加上 fx 欄位後重跑本程式。fx 只寫文字，不要自己填數字（asof、data 由本程式寫入）。格式：')
        print('  "fx": {"scenario": "usd_spike｜cash_panic｜usd_exit｜none 四選一", "basis": ["判斷依據的數據 1", "依據 2"],')
        print('         "twd_reasons": ["台幣今天升貶的可能原因（附來源；沒有新聞或數據佐證就給 []）"],')
        print('         "holders": {"etf": "對持有美股 ETF 的人代表什麼（一句話）", "usd": "對美元存款的人（一句話）", "tw": "對持有台股的人（一句話）"},')
        print('         "foreign": null 或 {"net": "賣超 123.4 億元", "date": "11/27", "src": "證交所"}}')
        print(dfx.table(fxres))
        sys.exit(1)
    rep['fx'] = dict(rep['fx'], asof=fxres['asof'], data=fxres['data'])
    n_news, n_tagged, tag_warns = check_tags(rep)   # 可能拿掉對不上的 events tags，所以要在寫檔之前
    out = {'schema': SCHEMA, 'date': day, 'session': s, 'generated': now.strftime('%Y-%m-%dT%H:%M:%SZ')}
    out.update({k: v for k, v in rep.items() if k not in out})
    idx_raw = open(cd.INDEX, encoding='utf-8').read()
    items = [{'date': day, 'session': s, 'headline': rep['headline']}] + others
    items.sort(key=lambda i: i.get('date') or '', reverse=True)
    idx['items'], idx['latest'] = items, items[0]['date']
    dump(out, path, 1)
    dump(idx, cd.INDEX, 2)

    errs, _, _ = cd.check(today=True, now=now)
    if errs:  # 還原，不留下半套檔案
        with open(cd.INDEX, 'w', encoding='utf-8') as f:
            f.write(idx_raw)
        if old_raw is None:
            os.remove(path)
        else:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(old_raw)
        print('檢查不通過，已還原：')
        for e in errs:
            print('  ❌ ' + e)
        sys.exit(1)
    act = '更新' if old_raw is not None else '新增'
    print(f'已{act} data/daily/{day}.json（台北日期 {day}，美股 {s} 收盤，generated {out["generated"]}）；index.json latest＝{day}；檢查 0 問題')
    print('美元與台幣視角：情境「%s」；數字已由程式寫入（%d 項有資料、%d 項資料暫缺）' % (dfx.SCENARIOS[rep['fx']['scenario']], sum(1 for v in fxres['data'].values() if v), sum(1 for v in fxres['data'].values() if not v)))
    print(f'主題標記：{n_tagged}／{n_news} 則消息有標記' + ('' if tag_warns else '，全部在代碼表內'))
    if tag_warns:
        for w in tag_warns[:40]:
            print('  ⚠️ ' + w)
        if len(tag_warns) > 40:
            print(f'  ⚠️ …另有 {len(tag_warns) - 40} 項')
        print('  （主題標記不影響發布；請照 data/daily-topics.json 補上或修正後，重跑一次本程式更新。）')


if __name__ == '__main__':
    main()
