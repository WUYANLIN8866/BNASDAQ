#!/usr/bin/env python3
"""把管理後台「訊號明細」每個條件的白話說明，加密成 data/explain.enc.json（只有管理員解得開）。

2026-11-24 站主：「管理後台的訊號明細的每個條件都要在『下次更新』下方新增一欄『白話說明』」。
白話說明寫的是每個條件在看什麼、現在代表什麼，屬於策略內容：明文只放在私人位置（不可以放進這個 repo），
網站只放這支程式產生的加密檔。這支程式本身不含任何策略內容。

加密方式（和會員更改密碼的申請 assets/pwchange.js 同一種包法）：
  內容（JSON）用一次性的 AES-256-GCM 金鑰加密；該金鑰轉成 base64 文字後，再用「管理員查看密碼」的 RSA-OAEP-SHA256 公鑰
  （data/accounts.json 的 view.pub）加密成 ek。對應的私鑰只有管理員登入後的個人金鑰解得開，所以訪客與會員都看不到內容；
  產生加密檔只需要公鑰，不需要任何秘密。管理後台（admin.html 的 loadExplain）登入後解開，交給 assets/sigpie.js 排在「下次更新」下方。

用法：
  python3 scripts/build_explain.py --src <白話說明明文.json> [--accounts data/accounts.json] [--status data/rules-status.json] [--out data/explain.enc.json]
  --src 必須放在 repo 外面（放在 repo 裡會被拒絕，避免明文被提交）。

明文格式（bnasdaq-explain-src/1）：
  { "schema": "bnasdaq-explain-src/1", "b_ver": "<撰寫時的專案 B 區版本>", "written": "YYYY-MM-DD",
    "models": [ { "id": "<策略代號>", "ref": "<專案節次>",
                  "rows": [ { "key": "<條件名稱裡一定會出現的字>", "what": "<這一項在看什麼>", "on": "<成立時的說明>", "off": "<不成立時的說明>",
                              "offLo": "<選填：區間條件，數值在下限以下時>", "offHi": "<選填：區間條件，數值在上限以上時>" } ] } ] }
  rows 的順序＝訊號明細裡條件的順序；每一列先對同一個位置的那一筆（條件名稱要含有 key），對不上再找名稱含有 key 的第一筆。

什麼時候要重跑：
  - 專案 B 區的條件有改或新增模型（管理後台會提示「和撰寫時的版本不同」；沒有對應說明的條件會寫「還沒有白話說明」）
  - 管理員重新啟用了密碼查看（公鑰換了；管理後台會提示「金鑰換過了」）。管理員只是改密碼不用重跑（金鑰不變，只是重新包裝）。
"""
import argparse, base64, datetime, hashlib, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
b64 = lambda x: base64.b64encode(x).decode()


def die(msg):
    sys.exit('❌ ' + msg)


def check_src(j):
    if not isinstance(j, dict) or j.get('schema') != 'bnasdaq-explain-src/1':
        die('明文的 schema 必須是 bnasdaq-explain-src/1')
    ms = j.get('models')
    if not isinstance(ms, list) or not ms:
        die('明文沒有 models')
    n = 0
    for m in ms:
        if not isinstance(m, dict) or not isinstance(m.get('id'), str) or not m['id']:
            die('每個模型都要有 id（策略代號）')
        rows = m.get('rows')
        if not isinstance(rows, list) or not rows:
            die('%s 沒有 rows' % m['id'])
        for i, r in enumerate(rows):
            for k in ('key', 'what', 'on', 'off'):
                if not isinstance(r.get(k), str) or not r[k].strip():
                    die('%s 第 %d 列缺少 %s' % (m['id'], i + 1, k))
            for k in ('offLo', 'offHi'):
                if k in r and (not isinstance(r[k], str) or not r[k].strip()):
                    die('%s 第 %d 列的 %s 是空的（不需要就整個欄位拿掉）' % (m['id'], i + 1, k))
            extra = set(r) - {'key', 'what', 'on', 'off', 'offLo', 'offHi'}
            if extra:
                die('%s 第 %d 列有不認得的欄位：%s' % (m['id'], i + 1, '、'.join(sorted(extra))))
            n += 1
    return n


def main():
    ap = argparse.ArgumentParser(description='加密訊號明細的白話說明（只有管理員解得開）')
    ap.add_argument('--src', required=True, help='白話說明明文 JSON（必須在 repo 外面）')
    ap.add_argument('--accounts', default=os.path.join(ROOT, 'data', 'accounts.json'), help='帳號檔（取 view.pub）')
    ap.add_argument('--status', default=os.path.join(ROOT, 'data', 'rules-status.json'), help='會員規則狀態檔（核對 B 區版本；讀不到就略過）')
    ap.add_argument('--out', default=os.path.join(ROOT, 'data', 'explain.enc.json'))
    a = ap.parse_args()

    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        die('需要 cryptography：pip install cryptography')

    src = os.path.realpath(a.src)
    if src == ROOT or src.startswith(ROOT + os.sep):
        die('--src 在 repo 裡面：白話說明明文不可以放進 repo，請放到 repo 外面再執行')
    try:
        j = json.load(open(src, encoding='utf-8'))
    except Exception as e:
        die('讀不到明文 %s：%s' % (a.src, e))
    n = check_src(j)

    try:
        view = json.load(open(a.accounts, encoding='utf-8')).get('view') or {}
        pub_der = base64.b64decode(view['pub'])
        pub = serialization.load_der_public_key(pub_der)
    except Exception as e:
        die('帳號檔沒有可用的管理員查看金鑰（view.pub）：%s。請管理員先在後台啟用密碼查看' % e)

    b_ver = j.get('b_ver') or ''
    try:
        live = json.load(open(a.status, encoding='utf-8')).get('b_ver') or ''
        if live and b_ver and live != b_ver:
            print('⚠️ 明文是依 B 區版本 %s 寫的，網站目前的規則是 %s：管理後台會提示內容可能需要更新' % (b_ver, live))
    except Exception:
        pass

    plain = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    k, iv = AESGCM.generate_key(bit_length=256), os.urandom(12)
    ct = AESGCM(k).encrypt(iv, plain, None)
    oaep = padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
    ek = pub.encrypt(b64(k).encode(), oaep)   # 和 BN.auth.sealPw(view, base64(金鑰)) 相同：加密的是金鑰的 base64 文字
    tpe = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
    out = {'schema': 'bnasdaq-explain/1', 'alg': 'RSA-OAEP-3072-SHA256+AES-256-GCM', 'built': tpe.strftime('%Y-%m-%d'), 'b_ver': b_ver,
           'key': 'accounts.view', 'key_fp': hashlib.sha256(pub_der).hexdigest()[:16], 'key_created': view.get('created') or '',
           'ek': b64(ek), 'iv': b64(iv), 'ct': b64(ct)}
    text = json.dumps(out, ensure_ascii=False, indent=1) + '\n'

    # 自我檢查：解得回來、內容相同；加密檔裡不得出現任何明文片段
    if AESGCM(k).decrypt(base64.b64decode(out['iv']), base64.b64decode(out['ct']), None) != plain:
        die('自我檢查失敗：解密後內容不同')
    frags = [m['id'] for m in j['models']] + [r[f] for m in j['models'] for r in m['rows'] for f in ('key', 'what', 'on', 'off') if len(r[f]) >= 3]
    B64 = set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')
    frags = [f for f in frags if any(c not in B64 for c in f)]   # 只含 base64 字元的短字串可能剛好出現在密文裡，不拿來比對
    leak = [f for f in frags if f in text]
    if leak:
        die('自我檢查失敗：加密檔裡出現明文片段（%d 處），沒有寫檔' % len(leak))

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    open(a.out, 'w', encoding='utf-8').write(text)
    print('✅ %s：%d 個模型、%d 個條件；金鑰指紋 %s；B 區版本 %s；%d bytes' % (os.path.relpath(a.out, ROOT) if os.path.abspath(a.out).startswith(ROOT) else a.out,
                                                                 len(j['models']), n, out['key_fp'], b_ver or '（未填）', len(text)))


if __name__ == '__main__':
    main()
