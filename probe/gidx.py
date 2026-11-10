"""暫時：MSCI ACWI 月底收盤（2000-05 起），印成 JSON 供本機測試與驗算。"""
import json, urllib.request, urllib.parse, datetime as dt
UA = 'Mozilla/5.0 (BNASDAQ market fetch)'
u = 'https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=946684800&period2=%d&interval=1d' % (urllib.parse.quote('^892400-USD-STRD'), int(dt.datetime.now().timestamp()))
j = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=60).read())
r = j['chart']['result'][0]; ts = r['timestamp']; cl = r['indicators']['quote'][0]['close']
bym = {}
for t, c in zip(ts, cl):
    if c is not None:
        bym[dt.datetime.utcfromtimestamp(t).strftime('%Y-%m')] = round(c, 2)
print('ACWIJSON', json.dumps(bym))
