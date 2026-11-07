"""暫時用：第 14 輪——元大持股權重的資料日期欄位"""
import urllib.request, re, json, sys, subprocess, tempfile, os
sys.stdout.reconfigure(line_buffering=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
for code in ('0050', '00646', '0056'):
    t = urllib.request.urlopen(urllib.request.Request('https://www.yuantaetfs.com/product/detail/%s/ratio' % code, headers={'User-Agent': UA}), timeout=60).read().decode('utf-8', 'replace')
    m = re.search(r'<script>(window\.__NUXT__=.*?)</script>', t, re.S)
    js = ('const window={};' + m.group(1) + '\nconst N=window.__NUXT__;'
          'for(const d of (N.data||[])){if(d&&d.weightData){const wd=d.weightData;console.log("weightData keys",JSON.stringify(Object.keys(wd)));'
          'for(const k of Object.keys(wd)){const v=wd[k];if(v&&typeof v==="object"&&!Array.isArray(v)){console.log(" ",k,"keys",JSON.stringify(Object.keys(v)).slice(0,400));for(const kk of Object.keys(v)){const x=v[kk];if(typeof x!=="object")console.log("   ",kk,"=",String(x).slice(0,60));else if(Array.isArray(x))console.log("   ",kk,"[",x.length,"]",JSON.stringify(x[0]).slice(0,300));}}else console.log(" ",k,"=",JSON.stringify(v).slice(0,200));}}}')
    f = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8'); f.write(js); f.close()
    r = subprocess.run(['node', f.name], capture_output=True, text=True, timeout=60); os.unlink(f.name)
    print('======', code); print(r.stdout[:3000], r.stderr[:300])
    p = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>', ' ', t, flags=re.S)))
    for w in ('資料日期', '日期', '更新'):
        i = p.find(w); print(w, '…', p[max(0, i - 80):i + 120] if i >= 0 else '無')
