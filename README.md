# data-26114

獨立分支（orphan），只放「抓公開資料」的程式與結果，和網站（main 分支）沒有任何共用歷史。

- 觸發：只有 push 到這個分支、而且 `request/` 有變動時才執行 `.github/workflows/data-26114.yml`。
- 內容：公開資料（聖路易聯邦準備銀行 FRED-MD／FRED、Yahoo Finance、Cboe）的原始檔，沒有任何策略規則。
- 加密：`data/*.enc.json` 用 main 分支 `data/macro-key.json` 的公鑰加密（AES-256-GCM 一次性金鑰＋RSA-OAEP-3072-SHA256 包裝，寫法同 main 的 `scripts/fetch_macro.py`）；只有持有私鑰的一方解得開。
- `status/*.json`：每次抓取的結果摘要（時間、成功與否、筆數、起訖日），不含資料值、不含任何金鑰。
- 這個分支不含任何私鑰或 API key；FRED API key 只從 repo Secret `FRED_API_KEY` 讀取，不寫檔、不輸出。
