# 更改密碼功能的測試（2026-11-23）

對象：`assets/pwchange.js`、`assets/auth.js`（`ghPutAt`、`pendingCred`、`fetchAccounts`）、`member.html` 的對話框、`admin.html` 的自動套用與帶版本存檔。

做法：`make_test_site.py` 把 repo 複製成本機測試站，換上隨機產生的測試金鑰與 7 個測試帳號（真的 PBKDF2 雜湊，走真實登入）；
`lib.js` 用 Playwright 攔截 `api.github.com`，模擬網站 repo 與同步用私人 repo 的 contents API（含版本不符回 409）。
測試金鑰、帳號、權杖都是假的，和正式網站無關；測試站與金鑰寫在 repo 外面（預設 `/home/claude/site_test`、`/home/claude/priv/T`，可用 `BN_SITE`、`BN_T` 改）。
會員規則沿用 repo 內的密文（測試金鑰解不開），頁面會走「規則暫時無法解密」的既有分支；這組測試不涵蓋規則計算。

```
cd scripts/tests/pwchange
for t in t1_flow t2_reject t3_admin t4_sweep t5_edge t6_race; do python3 make_test_site.py && node $t.js; done
```
每支腳本都要先重建測試站（上一支會改掉帳號）。需要 Node、Playwright（`BN_PLAYWRIGHT` 指定模組路徑）與 Python `cryptography`。

| 腳本 | 內容 | 項數 |
|---|---|---|
| t1_flow | 按鈕位置、對話框、密碼規則、送出、生效前後各裝置的登入、後台自動套用、取消、重送 | 56 |
| t2_reject | 偽造、弱密碼、錯的主金鑰、管理員／停用帳號、垃圾檔、過期、重放、作廢、登入頁的等待資料被竄改 | 28 |
| t3_admin | 會員專區／每日市場分析背景套用、撞版不覆蓋、管理員改自己的密碼、後台既有功能回歸、非擁有者、同步未啟用 | 39 |
| t4_sweep | 20 頁 × 3 種身分 × 2 種寬度：0 錯誤、0 橫向溢出；對話框在手機與深色模式 | 12 |
| t5_edge | 管理員密碼在別處改過後的舊登入不會刪申請、兩個分頁同時處理、很長與中英混合的密碼 | 10 |
| t6_race | 自動套用驗證中同時刪除別的帳號：兩件事都完成、其他帳號不變 | 10 |
