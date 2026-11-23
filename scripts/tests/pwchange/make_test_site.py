# 本機測試站：網站 repo 的複本＋測試金鑰、測試帳號（真的 PBKDF2 雜湊，可以走真實登入流程）、測試用的同步設定。
# 與正式網站的金鑰、帳號完全無關；只在本機使用。會員規則沿用 repo 內的密文（測試金鑰解不開 → 頁面走「規則暫時無法解密」的既有分支）。
import os, sys, json, base64, hashlib, shutil, unicodedata
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
SRC = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))   # repo 根目錄
DST, T = os.environ.get('BN_SITE', '/home/claude/site_test'), os.environ.get('BN_T', '/home/claude/priv/T')   # 測試站與測試金鑰放 repo 外面
ITER = 310000
b = lambda x: base64.b64encode(x).decode()
oaep = padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
def wrap(key, data):
    iv = os.urandom(12); return {'iv': b(iv), 'ct': b(AESGCM(key).encrypt(iv, data, None))}
def pb(pw, salt): return hashlib.pbkdf2_hmac('sha256', unicodedata.normalize('NFKC', pw).encode(), salt, ITER, 32)
ck = os.urandom(32)
vk = rsa.generate_private_key(public_exponent=65537, key_size=3072)
vpub = vk.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
vpriv = vk.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
PAT = 'github_pat_TEST_ADMIN_not_a_real_token'; SYNC = 'github_pat_TEST_SYNC_not_a_real_token'; SYNC_REPO = 'TESTOWNER/BNASDAQ-sync'
ACCS = [  # user, password, role, active, models（None＝沒有 models 欄位）
    ('ADMIN_T', 'AdminTest#2026x', 'admin', True, None),
    ('ADMIN_2', 'SecondAdmin#77x', 'admin', True, None),
    ('M_DEF', 'MemberDef#1', 'member', True, None),
    ('M_TWO', 'MemberTwo#1', 'member', True, ['fund', 'sat2']),
    ('M_ALL', 'MemberAll#1', 'member', True, ['fund', 'sat', 'sat2', 'sat3']),
    ('M_OFF', 'MemberOff#1', 'member', False, ['fund', 'sat']),
    ('Mixed.Case-1', 'MixedCase#11', 'member', True, ['fund']),
]
accounts, uks, pws = [], {}, {}
for user, pw, role, active, models in ACCS:
    sa, sw = os.urandom(16), os.urandom(16)
    wk = pb(pw, sw); uk = hashlib.sha256(b'bnasdaq-user-key-v1|' + wk).digest(); uks[user] = uk; pws[user] = pw
    rec = {'user': user, 'role': role, 'created': '2026-11-22', 'active': active, 'note': user,
           'auth': {'salt': b(sa), 'iter': ITER, 'hash': b(pb(pw, sa))}, 'wrap': dict({'salt': b(sw), 'iter': ITER}, **wrap(wk, ck)),
           'pv': b(vk.public_key().encrypt(pw.encode(), oaep))}
    if models is not None: rec['models'] = models
    accounts.append(rec)
acc = {'schema': 'bnasdaq-accounts/1', 'updated': '2026-11-22T00:00:00.000Z',
       'view': {'schema': 'bnasdaq-pwview/1', 'alg': 'RSA-OAEP-3072-SHA256', 'owner': 'ADMIN_T', 'created': '2026-11-22', 'pub': b(vpub), 'priv': wrap(uks['ADMIN_T'], vpriv)},
       'adminPat': dict({'owner': 'ADMIN_T', 'saved': '2026-11-22'}, **wrap(uks['ADMIN_T'], PAT.encode())),
       'accounts': accounts}
os.makedirs(T, exist_ok=True)
json.dump(acc, open(T + '/accounts.json', 'w'), indent=1)
json.dump({'pat': PAT, 'sync': SYNC, 'syncRepo': SYNC_REPO, 'ck': b(ck), 'pw': pws}, open(T + '/secrets.json', 'w'), indent=1)
if os.path.isdir(DST): shutil.rmtree(DST)
shutil.copytree(SRC, DST, ignore=shutil.ignore_patterns('.git', '__pycache__', 'shots'))
shutil.copy(T + '/accounts.json', DST + '/data/accounts.json')
json.dump(dict({'schema': 'bnasdaq-sync-key/1', 'created': '2026-11-22', 'note': 'test'}, **wrap(ck, json.dumps({'repo': SYNC_REPO, 'token': SYNC}).encode())), open(DST + '/data/sync-key.json', 'w'), indent=1)
print('test site ready:', DST, '| accounts:', ', '.join(a[0] for a in ACCS))
