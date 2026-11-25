import sys, json, datetime as dt
import os; ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))); sys.path.insert(0,os.path.join(ROOT,'scripts'))
import release_due as rd
cal=json.load(open(ROOT+'/data/release-calendar.json')); tp=json.load(open(ROOT+'/data/daily-topics.json'))['topics']
SER='FEDFUNDS TB3MS T1YFFM TB3SMFFM GS1 GS10 AAA AAAFFM EXJPUS TWEXAFEGSMTH MCOILWTICO WPSFD49207 CPILFESL CPILFENS DPCERA3M086SBEA W875RX1 RPI PCEPI CUMFNS INDPRO'.split()
P=rd.parse
def st(checked, since, last_ok=None, **kw):
    d=dict(checked=checked,last_ok=last_ok or checked,obs={s:['2026-10',since.get(s,since.get('*'))] for s in SER}); d.update(kw); return d
f=lambda r:[c for c,_ in r]
g=rd.groups(cal,tp,{s:1 for s in SER}); print({k:v for k,v in g.items()})
# 1. 今晚的情況：13:30Z 公布、上次抓 05:35Z（舊 status 沒 obs）
old=dict(checked='2026-11-25T05:35:42Z',last_ok='2026-11-25T05:35:42Z')
for now in ('2026-11-25T13:35Z','2026-11-25T13:50Z','2026-11-25T19:00Z','2026-11-26T04:00Z'):
    go,w=rd.due(P(now),cal,tp,old); print(now,'old-status go',f(go),'wait',f(w))
assert f(rd.due(P('2026-11-25T13:35Z'),cal,tp,old)[0])==[] and f(rd.due(P('2026-11-25T19:00Z'),cal,tp,old)[0])==['pio']
# 2. 抓到了（bootstrap 15:50Z）
s=st('2026-11-25T15:50:00Z',{'*':'2026-11-25T15:50:00Z'})
assert rd.due(P('2026-11-25T16:00Z'),cal,tp,s)==([],[]) , rd.due(P('2026-11-25T16:00Z'),cal,tp,s)
# 3. 12/23 公布，FRED 晚更新：13:45 抓過但月份沒變
s=st('2026-12-23T13:45:00Z',{'*':'2026-11-25T15:50:00Z'})
assert 'pio' in f(rd.due(P('2026-12-23T13:50Z'),cal,tp,s)[1]) and 'pio' in f(rd.due(P('2026-12-23T14:06Z'),cal,tp,s)[0])
s2=st('2026-12-23T14:06:00Z',{'*':'2026-11-25T15:50:00Z','DPCERA3M086SBEA':'2026-12-23T14:06:00Z','W875RX1':'2026-12-23T14:06:00Z','RPI':'2026-12-23T14:06:00Z','PCEPI':'2026-12-23T14:06:00Z'})
r=rd.due(P('2026-12-23T14:30Z'),cal,tp,s2); assert 'pio' not in f(r[0])+f(r[1]), r
# 4. 推定時間（g5 12/01 21:15Z）：FRED 提早 5 小時更新也算抓到；晚 2 天才更新 → 期間每 2 小時重試
s=st('2026-12-01T16:00:00Z',{'*':'2026-11-25T15:50:00Z','TWEXAFEGSMTH':'2026-12-01T16:00:00Z','EXJPUS':'2026-12-01T16:00:00Z'})
r=rd.pending(P('2026-12-01T21:30Z'),cal,tp,s); assert 'g5' not in f(r), r
s=st('2026-12-02T10:00:00Z',{'*':'2026-11-25T15:50:00Z'})
go,w=rd.due(P('2026-12-02T11:00Z'),cal,tp,s); assert 'g5' in f(w) and 'g5' not in f(go); go,w=rd.due(P('2026-12-02T12:01Z'),cal,tp,s); assert 'g5' in f(go)
# 5. 月底凍結、滿 7 天
s=st('2026-12-23T13:00:00Z',{'*':'2026-11-25T15:50:00Z'},frozen='2026-12'); assert rd.due(P('2026-12-24T14:00Z'),cal,tp,s)[0]==[]
s=st('2026-12-23T13:00:00Z',{'*':'2026-11-25T15:50:00Z'}); assert 'pio' not in f(rd.pending(P('2026-12-31T14:00Z'),cal,tp,s))
# 6. 抓取失敗（last_ok 舊、checked 新）→ 20 分鐘後再試
s=st('2026-12-23T13:45:00Z',{'*':'2026-11-25T15:50:00Z'},last_ok='2026-12-22T23:00:00Z'); assert 'pio' in f(rd.due(P('2026-12-23T14:06Z'),cal,tp,s)[0])
print('python logic OK')

# ---- fetch_macro.status：obs 的「第一次抓到的時間」只在最新月份改變時更新 ----
import tempfile, importlib.util
spec=importlib.util.spec_from_file_location('fm',os.path.join(ROOT,'scripts','fetch_macro.py')); fm=importlib.util.module_from_spec(spec); spec.loader.exec_module(fm)
d=tempfile.mkdtemp(); fm.STATUS=os.path.join(d,'s.json'); fm.OUT2=os.path.join(d,'m2.json')
json.dump({'updated':'2026-11-25T15:14:58Z'},open(fm.OUT2,'w'))
t1=dt.datetime(2026,11,25,15,50,tzinfo=dt.timezone.utc); t2=dt.datetime(2026,12,23,13,52,tzinfo=dt.timezone.utc)
fm.status(t1,True,[],'',{'A':{'2026-09':1,'2026-10':2},'B':{'2026-10':1}}); s1=json.load(open(fm.STATUS))
assert s1['obs']=={'A':['2026-10','2026-11-25T15:50:00Z'],'B':['2026-10','2026-11-25T15:50:00Z']} and s1['data_at']=='2026-11-25T15:14:58Z' and s1['frozen'] is None
fm.status(t2,True,[],'',{'A':{'2026-10':2,'2026-11':3},'B':{'2026-10':1}}); s2=json.load(open(fm.STATUS))
assert s2['obs']=={'A':['2026-11','2026-12-23T13:52:00Z'],'B':['2026-10','2026-11-25T15:50:00Z']}
fm.status(t2,False,['B'],'x'); s3=json.load(open(fm.STATUS)); assert s3['obs']==s2['obs'] and s3['last_ok']=='2026-12-23T13:52:00Z' and not s3['ok']
fm.mark_frozen(t2); assert json.load(open(fm.STATUS))['frozen']=='2026-12'
print('fetch_macro status OK')

# ---- heatmap_live.check_release：有沒抓到的公布就啟動 site.yml；已有更新在跑、15 分鐘內啟動過就不重複 ----
import base64
spec=importlib.util.spec_from_file_location('hl',os.path.join(ROOT,'scripts','heatmap_live.py')); hl=importlib.util.module_from_spec(spec); spec.loader.exec_module(hl)
class FakePub:
    def __init__(s, status, runs=()): s.status, s.runs, s.sent = status, list(runs), []
    def call(s, method, path, body=None):
        if path.startswith('/contents/'):
            name=path.split('/contents/')[1].split('?')[0]
            j = s.status if name.endswith('macro-status.json') else json.load(open(os.path.join(ROOT,name)))
            return 200, {'content': base64.b64encode(json.dumps(j).encode()).decode()}
        if '/runs' in path: return 200, {'workflow_runs': s.runs}
        raise AssertionError(path)
    def dispatch(s, ref, inputs, workflow=None): s.sent.append(workflow); return True, 204, {}
ts=lambda x: P(x).timestamp()
old=dict(checked='2026-11-25T05:35:42Z',last_ok='2026-11-25T05:35:42Z')
p=FakePub(old); memo={}; m=hl.check_release(p, ts('2026-11-25T13:35Z'), memo); assert m is None and p.sent==[], m      # 公布未滿 10 分鐘
m=hl.check_release(p, ts('2026-11-25T13:41Z'), memo); assert p.sent==['site.yml'] and '已啟動' in m, m                 # 公布後 11 分鐘 → 啟動
m=hl.check_release(p, ts('2026-11-25T13:46Z'), memo); assert p.sent==['site.yml'] and m is None                        # 15 分鐘內不重複
p2=FakePub(old, runs=[{'status':'in_progress','event':'workflow_dispatch'}]); m=hl.check_release(p2, ts('2026-11-25T13:41Z'), {}); assert p2.sent==[] and '已經有更新在跑' in m
p3=FakePub(st('2026-11-25T15:50:00Z',{'*':'2026-11-25T15:50:00Z'})); assert hl.check_release(p3, ts('2026-11-25T16:00Z'), {}) is None and p3.sent==[]   # 抓到了
print('check_release OK')
