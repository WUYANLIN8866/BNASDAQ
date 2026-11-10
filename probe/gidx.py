"""暫時：找有 2000 年以前月線的全球股票指數（Yahoo chart API；誠實 UA）。"""
import json, urllib.request, urllib.parse, datetime as dt
UA = 'Mozilla/5.0 (BNASDAQ market fetch)'
for sym in ['^990100-USD-STRD', '^892400-USD-STRD', '^991000-USD-STRD', '^MIWO00000PUS', 'ACWI', 'VT', 'URTH', '^SPG1200', '^W1DOW']:
    u = 'https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=504921600&period2=%d&interval=1mo' % (urllib.parse.quote(sym), int(dt.datetime.now().timestamp()))
    try:
        j = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=40).read())
        r = j['chart']['result'][0]; ts = r.get('timestamp') or []; cl = r['indicators']['quote'][0]['close']; meta = r['meta']
        pts = [(dt.datetime.utcfromtimestamp(t).strftime('%Y-%m'), c) for t, c in zip(ts, cl) if c is not None]
        d = dict(pts)
        print('CHK', sym, meta.get('longName') or meta.get('shortName'), meta.get('currency'), meta.get('instrumentType'), 'n', len(pts), 'first', pts[0] if pts else None, 'last', pts[-1] if pts else None, '2000-05', d.get('2000-05'), '2026-10', d.get('2026-10'))
    except Exception as e:
        print('CHK', sym, 'ERR', repr(e)[:150])
