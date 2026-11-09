#!/usr/bin/env python3
"""BNASDAQ｜QQQ 每日報酬與日內高低的「標準化殘差」資料（公開市場資料，不含任何策略規則）→ data/qqq_fhs.json
用途：會員專區估計「月底前剩下的交易日」可能的價格路徑（濾波歷史模擬，FHS）。
口徑
  還原：U＝還原收盤；日高／日低 × （還原收盤 ÷ 原始收盤）
  l＝ln(U_t／U_t−1)、h＝ln(日高_t／U_t−1)、o＝ln(日低_t／U_t−1)（並保證 o ≤ l ≤ h）
  波動：EWMA，λ＝0.94；前 30 天的 l² 平均當起始；z＝l／σ_t、zh＝h／σ_t、zo＝o／σ_t（σ_t 只用 t−1 以前的資料）
  sig_next＝最後一個交易日之後那一天的 σ
來源：Yahoo Finance chart API（同 fetch_market.py）；失敗就保留原檔。
"""
import json, os, sys, math, datetime as dt, importlib.util
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'qqq_fhs.json')
LAM, SCALE, START = 0.94, 10000, dt.date(1999, 3, 10)


def fhs(rows, lam=LAM):
    rows = sorted(rows, key=lambda r: r['date'])
    L, Hx, Ox, dates = [], [], [], []
    for a, b in zip(rows, rows[1:]):
        f = b['adjclose'] / b['close']; u0 = a['adjclose']
        l = math.log(b['adjclose'] / u0)
        h = math.log(b['high'] * f / u0) if b.get('high') else l
        o = math.log(b['low'] * f / u0) if b.get('low') else l
        L.append(l); Hx.append(max(h, l)); Ox.append(min(o, l)); dates.append(b['date'])
    if len(L) < 300:
        raise ValueError('資料太少：%d 天' % len(L))
    v = sum(x * x for x in L[:30]) / 30
    z, zh, zo = [], [], []
    for t in range(30, len(L)):
        s = math.sqrt(v)
        z.append(round(L[t] / s * SCALE)); zh.append(round(Hx[t] / s * SCALE)); zo.append(round(Ox[t] / s * SCALE))
        v = lam * v + (1 - lam) * L[t] * L[t]
    return dict(asof=dates[-1], frm=dates[30], n=len(z), sig_next=math.sqrt(v), z=z, zh=zh, zo=zo)


def main():
    spec = importlib.util.spec_from_file_location('fm', os.path.join(ROOT, 'scripts', 'fetch_market.py')); fm = importlib.util.module_from_spec(spec); spec.loader.exec_module(fm)
    last = None
    for fn in (fm.src_yahoo_chart, fm.src_yfinance):
        try:
            rows, source = fn(START)
            d = fhs(rows)
            out = {'schema': 'bnasdaq-fhs/1', 'asof': d['asof'], 'source': source, 'note': 'QQQ 每日報酬與日內高低的標準化殘差（EWMA λ＝0.94）；公開市場資料，不含任何策略規則。',
                   'updated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'lambda': LAM, 'scale': SCALE, 'from': d['frm'], 'n': d['n'],
                   'sig_next': d['sig_next'], 'z': d['z'], 'zh': d['zh'], 'zo': d['zo']}
            with open(OUT, 'w', encoding='utf-8') as f:
                json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
            print('[fetch_fhs] ok', out['asof'], 'n', out['n'], 'sig_next %.5f' % out['sig_next'], source)
            return 0
        except Exception as e:  # noqa
            last = e; print('[fetch_fhs]', getattr(fn, '__name__', fn), 'failed:', repr(e)[:200])
    print('[fetch_fhs] 全部來源失敗，保留原檔：', repr(last)[:200]); return 0


if __name__ == '__main__':
    sys.exit(main())
