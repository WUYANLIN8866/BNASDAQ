# BNASDAQ 研究站

公開網址：https://wuyanlin8866.github.io/BNASDAQ/

以 AI 模型探勘、驗證、回測 QQQ 月線策略（QLD／SHV）的研究站。版面參考聯準會網站結構；所有績效數字為歷史回測。

## 結構
- `*.html`：靜態多分頁（首頁、關於、研究與回測、定期定額與退休、台股對比、目標試算器、估值試算器、風險與代價、最新發布、常見問題、資料口徑、搜尋、登入、會員專區、管理後台）
- `assets/data.js`：公開數字（由回測計算檔產生；不含持倉與買賣規則）
- `assets/charts.js`：內嵌 SVG 圖表；`assets/auth.js`：登入／加密／GitHub 寫入
- `data/market_base.json`、`data/market.json`：公開市場資料（QQQ 還原收盤、月高低），每個交易日由 GitHub Actions 自動更新
- `data/treasury.json`：美國公債各年期殖利率（財政部 par yield curve；備援 Yahoo ^IRX/^FVX/^TNX/^TYX），供估值試算器折現用，同樣每個交易日自動更新
- `data/rules.enc.json`：加密後的策略規則（會員登入後在瀏覽器解密執行）
- `data/accounts.json`：帳號（只有密碼雜湊與包裝後的金鑰）；`data/site.json`：公告
- `data/tw/<代號>.json`、`data/tw/index.json`：台股對比頁「加入其他台股」用的預算結果（Yahoo 還原收盤、與六種做法同一段期間），由 `.github/workflows/tw-data.yml` 每月重算（可手動觸發、可指定代號）；`data/tw/latest.json`：全部上市上櫃最新收盤（證交所／櫃買中心官方），`.github/workflows/tw-latest.yml` 每個交易日 15:10 更新
- `scripts/fetch_market.py`、`scripts/fetch_treasury.py`、`scripts/fetch_tw.py`、`scripts/fetch_tw_latest.py`：市場資料更新腳本；`.github/workflows/site.yml`：每日更新＋部署 Pages

## 管理
管理員登入後台後，貼一次 fine-grained PAT（Contents: Read and write；Actions: Read and write 可手動觸發更新）即可新增／停用／刪除帳號、重設密碼、發布公告。
