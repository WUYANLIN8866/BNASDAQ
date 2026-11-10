#!/usr/bin/env python3
"""台股內部人持股轉讓事前申報：證交所開放資料每天只公布「當天」的申報，這裡每天累積成歷史。

來源（臺灣證券交易所 OpenAPI，公開資料）：
  /opendata/t187ap12_L  上市公司每日內部人持股轉讓事前申報表－持股轉讓日報表
  /opendata/t187ap13_L  上市公司每日內部人持股轉讓事前申報表－持股未轉讓日報表
輸出：data/company/_tw_insider.json（全部上市公司，只留最近 400 天；同一筆申報不重複記）
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'company', '_tw_insider.json')
UA = 'BNASDAQ company fetch (+https://github.com/WUYANLIN8866/BNASDAQ)'


def log(*a):
    print('[tw-insider]', *a, flush=True)


def get(path, tries=3):
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request('https://openapi.twse.com.tw/v1' + path, headers={'User-Agent': UA, 'Accept': 'application/json'})
            return json.loads(urllib.request.urlopen(req, timeout=120).read())
        except Exception as e:  # noqa
            err = e
            time.sleep(3 * (k + 1))
    raise err


def num(x):
    try:
        s = str(x).replace(',', '').strip()
        return float(s) if s not in ('', '-', '--') else None
    except Exception:
        return None


def s_(x):
    return str(x or '').strip()


def main():
    old = {}
    if os.path.isfile(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            old = {}
    rows = old.get('rows') or []
    keys = {r.get('k') for r in rows}
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))
    today_roc = f'{now.year - 1911:03d}{now.month:02d}{now.day:02d}'
    added = 0
    for path, kind in (('/opendata/t187ap12_L', '轉讓'), ('/opendata/t187ap13_L', '未轉讓')):
        try:
            data = get(path)
        except Exception as e:  # noqa
            log('讀取失敗', path, repr(e)[:120])
            continue
        for r in data if isinstance(data, list) else []:
            c = s_(r.get('公司代號'))
            if not c:
                continue
            if kind == '轉讓':
                rec = {'d': s_(r.get('出表日期')), 'c': c, 'n': s_(r.get('公司名稱')), 'kind': kind, 'who': s_(r.get('申報人身分')), 'name': s_(r.get('姓名')),
                       'how': s_(r.get('預定轉讓方式及股數-轉讓方式')), 'sh': (num(r.get('預定轉讓總股數-自有持股')) or 0) + (num(r.get('預定轉讓總股數-保留運用決定權信託股數')) or 0),
                       'hold': (num(r.get('目前持有股數-自有持股')) or 0) + (num(r.get('目前持有股數-保留運用決定權信託股數')) or 0),
                       'after': (num(r.get('預定轉讓後持股-自有持股')) or 0) + (num(r.get('預定轉讓後持股-保留運用決定權信託股數')) or 0),
                       'to': s_(r.get('受讓人')), 'period': s_(r.get('有效轉讓期間'))}
            else:
                rec = {'d': s_(r.get('出表日期')), 'c': c, 'n': s_(r.get('公司名稱')), 'kind': kind, 'who': s_(r.get('申報人身分')), 'name': s_(r.get('姓名')),
                       'sh': (num(r.get('未轉讓股數-自有持股')) or 0) + (num(r.get('未轉讓股數-保留運用決定權信託股數')) or 0),
                       'plan': (num(r.get('原申報預定轉讓股數-自有持股')) or 0) + (num(r.get('原申報預定轉讓股數-保留運用決定權信託股數')) or 0),
                       'hold': (num(r.get('目前持股-自有持股')) or 0) + (num(r.get('目前持股-保留運用決定權信託股數')) or 0), 'why': s_(r.get('未轉讓理由'))}
            if not rec['d'] or not rec['name']:
                continue
            k = '|'.join([rec['d'], c, rec['name'], kind, str(rec['sh']), rec.get('period', '')])
            if k in keys:
                continue
            rec['k'] = k
            rows.append(rec)
            keys.add(k)
            added += 1
    cut = now - dt.timedelta(days=400)
    cut_roc = f'{cut.year - 1911:03d}{cut.month:02d}{cut.day:02d}'
    rows = sorted([r for r in rows if r.get('d', '') >= cut_roc], key=lambda r: (r['d'], r['c'], r['name']), reverse=True)
    out = {'schema': 'bnasdaq-tw-insider/1', 'since': old.get('since') or today_roc, 'updated': now.strftime('%Y-%m-%dT%H:%M:%S+08:00'), 'rows': rows,
           'src': [{'t': '臺灣證券交易所 OpenAPI：上市公司每日內部人持股轉讓事前申報表（持股轉讓日報表、持股未轉讓日報表）', 'u': 'https://openapi.twse.com.tw/'}]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    log('新增', added, '筆；累積', len(rows), '筆（自', out['since'], '起）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
