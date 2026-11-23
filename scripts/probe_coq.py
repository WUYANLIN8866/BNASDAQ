# 暫時性實測：兆元企業個別新聞的 Google 新聞搜尋字串（現行 vs intitle）哪個比較相關
import importlib.util, urllib.parse, time, json, datetime as dt
from zoneinfo import ZoneInfo
spec = importlib.util.spec_from_file_location('hm', 'scripts/heatmap_live.py'); hm = importlib.util.module_from_spec(spec); spec.loader.exec_module(hm)
V = {
 'AAPL': ['蘋果 OR Apple', 'intitle:蘋果 OR intitle:Apple'],
 'MSFT': ['微軟', 'intitle:微軟 OR intitle:Microsoft'],
 'GOOGL': ['Alphabet OR Google OR 谷歌', 'intitle:Google OR intitle:谷歌 OR intitle:Alphabet'],
 'NVDA': ['輝達', 'intitle:輝達 OR intitle:Nvidia'],
 'AMZN': ['亞馬遜', 'intitle:亞馬遜 OR intitle:Amazon'],
 'SPCX': ['SpaceX', 'intitle:SpaceX'],
 'TSM': ['台積電', 'intitle:台積電 股', 'intitle:台積電 (ADR OR 股價 OR 營收 OR 法說 OR 美股)'],
 'AVGO': ['博通', 'intitle:博通 OR intitle:Broadcom'],
 'META': ['Meta', 'intitle:Meta'],
 'TSLA': ['特斯拉', 'intitle:特斯拉 OR intitle:Tesla'],
 'LLY': ['禮來', 'intitle:禮來', '"禮來" 藥'],
 'BRK.B': ['波克夏', 'intitle:波克夏'],
 'ANT': ['Anthropic', 'intitle:Anthropic'],
 'WMT': ['沃爾瑪', 'intitle:沃爾瑪 OR intitle:Walmart'],
 '2222.SR': ['沙烏地阿美', 'intitle:沙烏地阿美 OR intitle:阿美石油 OR intitle:Aramco'],
}
now = time.time()
for tk, qs in V.items():
    for q in qs:
        url = 'https://news.google.com/rss/search?' + urllib.parse.urlencode({'q': q + ' when:2d', 'hl': 'zh-TW', 'gl': 'TW', 'ceid': 'TW:zh-Hant'})
        try:
            st, body = hm.http(url, timeout=12); items = sorted(hm.news_items('rss', 'Google 新聞', body), key=lambda x: -x['at'])
            items = [x for x in items if now - x['at'] < 48 * 3600]
        except Exception as e:
            print(tk, q, 'ERR', repr(e)[:80]); continue
        print(f'{tk}｜{q}｜{len(items)} 則')
        for x in items[:4]:
            print('     ', dt.datetime.fromtimestamp(x['at'], ZoneInfo('Asia/Taipei')).strftime('%m-%d %H:%M'), x['s'][:10], '｜', x['t'][:58])
