# BNASDAQ 研究站

公開網址：https://wuyanlin8866.github.io/BNASDAQ/

以 AI 模型探勘、驗證、回測 QQQ 月線策略（QLD／SHV）的研究站。版面參考聯準會網站結構；所有績效數字為歷史回測。

## 結構
- `*.html`：靜態多分頁（首頁、關於、研究與回測、定期定額與退休、個股對比、目標試算器、估值試算器、風險與代價、最新發布、常見問題、資料口徑、搜尋、登入、會員專區、管理後台）
- `assets/data.js`：公開數字（由回測計算檔產生；不含持倉與買賣規則）
- `assets/charts.js`：內嵌 SVG 圖表；`assets/auth.js`：登入／加密／GitHub 寫入
- `data/market_base.json`、`data/market.json`：公開市場資料（QQQ 還原收盤、月高低），每個交易日由 GitHub Actions 自動更新
- `data/treasury.json`：美國公債各年期殖利率（財政部 par yield curve；備援 Yahoo ^IRX/^FVX/^TNX/^TYX），供估值試算器折現用，同樣每個交易日自動更新
- `data/rules.enc.json`：加密後的策略規則（會員登入後在瀏覽器解密執行）
- `data/accounts.json`：帳號（只有密碼雜湊與包裝後的金鑰）；`data/site.json`：公告
- `data/tw/<代號>.json`、`data/tw/index.json`：個股對比頁與研究與回測頁「加入台股／美股」用的預算結果（Yahoo 還原收盤；台股上市上櫃全部、美股 S&P 500／Nasdaq-100／常見 ETF；每檔含台幣 2013 起與美元 2000 起兩段；FRED 每日匯率），由 `.github/workflows/tw-data.yml` 每月重算（可手動觸發、可指定代號）；`data/tw/latest.json`：台股官方最新收盤＋美股 Yahoo 收盤＋匯率，`.github/workflows/tw-latest.yml` 每個交易日 15:10 更新
- `scripts/fetch_market.py`、`scripts/fetch_treasury.py`、`scripts/fetch_stocks.py`、`scripts/fetch_latest.py`：市場資料更新腳本；`.github/workflows/site.yml`：每日更新＋部署 Pages
- `.github/workflows/tw-latest.yml`（`scripts/fetch_latest.py`）：各市場收盤後更新最新收盤價——`data/tw/latest.json`（台灣上市／上櫃、美股比較清單、匯率）與 `data/lt/us-close.json`（美股總表全部代號），更新完自動重新部署。由熱力圖盤中更新的工作在每個市場收盤後啟動（台股 13:30 後約 2.5 分鐘、美股收盤後 10 分鐘）；GitHub 排程只當備援，因為它在這個 repo 實測會晚 7～10 小時。台股收盤後官方檔案還沒出來時先用 Yahoo奇摩股市的收盤價（檔內 `prelim` 標明），官方檔案出來後換掉
- `scripts/heatmap_live.py`、`.github/workflows/heatmap-live.yml`：每日市場分析頁「市值熱力圖」的盤中更新。開盤期間定時（台股每 30 秒、美股每 60 秒）把成分股最新價寫到 `heatmap-live` 分支（只留最新一筆 commit；不部署網站、不動 main），`daily.html` 用同樣的間隔讀；收盤後的正式資料仍是 `scripts/fetch_heatmap.py` 產生的 `data/heatmap/latest.json`。啟動方式、資料來源與實測紀錄寫在腳本檔頭

## 管理
管理員登入後台後，貼一次 fine-grained PAT（Contents: Read and write；Actions: Read and write 可手動觸發更新）即可新增／停用／刪除帳號、重設密碼、發布公告。

### 模型權限（2026-11-22）
- 管理後台「模型權限」設定每個帳號可以看到哪些模型：勾選後按「儲存模型權限」一次寫回 `data/accounts.json`；新增會員時也可以勾選。管理員固定可以看全部。
- 資料：每個帳號的 `models`＝可看的模型，存 `data/strategies.json` 的 `role`（fund、sat、sat2、sat3…，不是策略代號，代號改名不影響授權）。沒有 `models` 欄位＝預設只有 `fund`（入門模型）；預設值在 `assets/auth.js` 的 `DEFAULT_MODELS`。
- 範圍：會員登入後才看得到的資訊——會員專區（本月持有、下月持有機率、翻轉價位、策略差額）、每日市場分析的「模型影響」、會員專屬模型的名稱與數字（`BN.canSee`，`assets/site.js`）。公開頁面上對所有訪客公開的回測不受影響。
- 生效：登入時記在 session；會員專區、每日市場分析、管理後台每次開啟都重讀帳號檔（`BN.auth.grants`），權限、身分有變或帳號被停用，重新整理就生效。
- 這是顯示權限；會員規則 `data/rules.enc.json` 仍以全體會員共用的主金鑰加密（每個模型各自加密尚未實作）。
- 新增模型：在 `data/strategies.json` 登記新的 role 後，後台會自動多一欄；沒有勾選的帳號看不到新模型。

### 更改密碼（2026-11-23）
- 入口：會員專區「登出」旁的「更改密碼」（`member.html`）；流程、加密與驗證規則都在 `assets/pwchange.js`（檔頭有完整說明）。
- 管理員：在自己的瀏覽器直接寫入帳號檔（步驟同後台「更改管理員密碼」：查看密碼的私鑰與寫入權杖改用新的個人金鑰重新加密，寫入前逐項核對），立即生效並登出。
- 會員：本站沒有伺服器，會員寫不進帳號檔，所以瀏覽器把「新的驗證資料＋知道目前密碼的證明」加密成一份申請，放到同步用的私人 repo（`pw1/<檔名>.json`，和會員資產跨裝置同步共用 `data/sync-key.json`）。
  管理員以管理員身分開啟管理後台、會員專區或每日市場分析時，瀏覽器自動驗證並寫進 `data/accounts.json`（後台「會員自行更改密碼」區塊有狀態與紀錄）。
- 申請只有管理員解得開（用 `accounts.json` 的 `view.pub` 加密）；套用前檢查：帳號存在、啟用中、不是管理員、沒過期、對得上目前的帳號檔、對方拿得出目前密碼導出的金鑰，並用解出的新密碼重算一次雜湊與主金鑰包裝。只換 `auth`／`wrap`／`pv`，身分與模型權限不動。
- 生效前：送出的那台裝置把新的驗證資料記在 `localStorage`（`bn-pwc:<帳號>`），`assets/auth.js` 的 `pendingCred` 讓那台裝置先用新密碼登入；帳號檔一變（已生效或管理員另外重設）就作廢。
- 帳號檔一律帶版本寫入（`BN.auth.ghPutAt`）：後台存檔時若帳號檔已被別處改過，這次不存、重新載入，不會互相覆蓋。
- 密碼規則（`BN.pwc.policy`）：至少 10 碼、四種字元至少兩種、不含帳號名稱與本站名稱、不含常見字串；管理員端套用前會再檢查一次。
- 前提：已啟用「會員資產跨裝置同步」與「密碼查看」，管理員已設定寫入權杖；缺任何一項時會員會看到「請聯絡管理員」，後台會寫出缺哪一項。
- 測試：`scripts/tests/pwchange/`（本機測試站＋模擬 GitHub API，6 支腳本共 155 項；用法見該資料夾的 README）。改到 `assets/auth.js`、`assets/pwchange.js`、`admin.html` 的帳號存檔或 `member.html` 的對話框時請重跑。

## 載入速度（2026-11-06）
- **字型**：不再向 Google Fonts 載入完整 Noto Sans TC／Noto Serif TC（每頁 1.2–1.8MB），改用 `assets/fonts/` 的本站精簡版（整站約 0.4MB，字形相同）。
  改了網頁文字後：開本機伺服器 → `node scripts/fonts/collect_chars.js http://127.0.0.1:8765/` → `python3 scripts/build_fonts.py`（需要 `pip install fonttools brotli`）。
  沒收錄的字會由 `site.js` 自動向 Google Fonts 只補那幾個字，外觀不變，所以忘了重跑也不會壞。
- **版本號**：改完 `assets/*.css`、`*.js` 後執行 `python3 scripts/stamp_assets.py`，`?v=` 會變成檔案內容雜湊，沒改的檔案訪客可繼續用快取。
- **腳本位置**：外部腳本放在 `<main>` 第一個內嵌 `<script>` 之前（不放 `<head>`），畫面先出來；`<head>` 只留極小的深色模式設定。
- **資料讀取**：公開頁的 `fetch` 不加 `cache:'no-store'`（GitHub Pages 本身快取 10 分鐘）；會員、後台頁維持不快取。
- **起點切換**：`period.js` 先更新按鈕，圖表排到下一個畫面後重算，連點只算最後一次；IRR 算法逐位元與舊版相同。
