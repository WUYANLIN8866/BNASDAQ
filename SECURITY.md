# BNASDAQ 網站安全說明

本文件記錄本站的資安強化措施、設計取捨，以及尚待站方決定的事項。
最後更新：2026-11-15（安全強化第一批）。

---

## 一、這批強化做了什麼（非破壞性）

| 項目 | 作用（白話） |
|---|---|
| **Content-Security-Policy（CSP）** | 每一頁加入 CSP，限制資源只能從本站與少數白名單網域載入 |
| **`connect-src` 鎖定** | 瀏覽器只允許把資料送到 `api.github.com` 與 `raw.githubusercontent.com`；**即使頁面被注入惡意程式碼，也無法把密碼、PAT、持倉送到其他網址** |
| **referrer 政策** | 點外部連結時不洩漏完整網址路徑 |
| **公告／搜尋輸出跳脫** | 將原本「只移除 `<>`」的脆弱寫法升級為完整 HTML 跳脫（`esc()`），修補公告「日期」欄位先前未過濾的潛在 XSS |

CSP 白名單（最終值）：

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'none';
form-action 'self'; img-src 'self' data:; media-src 'self';
font-src 'self' https://fonts.gstatic.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
script-src 'self' 'unsafe-inline' 'unsafe-eval';
connect-src 'self' https://api.github.com https://raw.githubusercontent.com
```

### 為什麼 `script-src` 保留 `unsafe-inline` / `unsafe-eval`
本站大量使用行內 `<script>` 與 `onclick`，且會員規則引擎以 `new Function()` 執行解密後的規則，因此必須保留這兩項，否則既有功能會壞。
**真正擋外洩的是 `connect-src`**：就算有人塞進行內程式碼，資料也送不出去。規則本身以 AES-256-GCM 認證加密，無金鑰無法竄改。

---

## 二、驗證方式（可重現）

以 headless Chrome（puppeteer）實測，全部通過：

- 19 個頁面：CSP 存在、無 CSP 違規、無 JS 錯誤、版面正常。
- 餵入「惡意公告／惡意搜尋字串」：確認被跳脫成純文字，XSS 未觸發。
- 會員／管理頁未登入時正確導回登入頁。
- CSP 探針：確認 `new Function()` 可執行（規則引擎正常）、跨網域 `fetch` 被 `connect-src` 擋下。
- 以真實 `auth.js` 加密流程建測試帳號＋測試規則，實跑「登入→AES-GCM 解密→執行規則」在 CSP 下全程無誤。

---

## 三、本站既有的良好設計（未更動）

- 帳號檔 `data/accounts.json` 僅存 PBKDF2-SHA256（310,000 次）雜湊與「密碼派生金鑰包裝後的規則金鑰」，無明文密碼。
- 規則以 AES-256-GCM 加密（具完整性驗證）；v2 以 RSA-OAEP 包裝，發布規則只需公鑰。
- 管理員 PAT 以登入金鑰加密後才存在瀏覽器 `localStorage`，不進 repo。
- 登入轉址的 `next` 參數已用白名單 `^[a-z]+\.html$` 驗證，無開放轉址。
- repo 內無明文秘密（已掃描確認）。

---

## 四、尚待站方決定或自行處理（本批未做，因會影響現有會員或需人工憑證）

1. **更換曾在文件中出現過的管理員預設密碼** — 請登入後台自行更改（我不經手密碼）。
2. **會員密碼強度** — `accounts.json` 為公開檔，弱密碼可被離線暴力破解。建議要求會員密碼 ≥ 12 碼；可評估提高 PBKDF2 次數或改用 scrypt/argon2（會讓舊帳號需重設，屬破壞性）。
3. **規則金鑰輪替** — 可讓「已被某會員解過的舊規則」失效，但需所有會員重設密碼（破壞性，需站方決定）。
4. **GitHub 設定**（需站方在 repo 設定開啟）：Secret scanning、Dependabot。

## 五、建議的後續強化（可選，非必要）

- **真正的 HTTP 安全標頭**：GitHub Pages 無法自訂 HTTP 標頭，故 `X-Frame-Options`、`HSTS`、`X-Content-Type-Options`、CSP `frame-ancestors`（防點擊劫持）皆無法設定。若在前面加一層 Cloudflare，即可補上這些標頭並真正防止網站被嵌入 iframe。
- **GitHub Actions**：workflow_dispatch 的輸入目前直接內插進 shell（僅具 repo 寫入權者可觸發，風險限於帳號被盜情境）；可改以 `env:` 傳遞。官方 action 可再以 commit SHA 釘選版本。此批未改，以免影響每日資料管線。
