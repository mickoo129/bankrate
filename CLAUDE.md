# 定存息口通：香港銀行定期息口比較

MKPA 工具之一。呢個 repo 只放呢一個工具，獨立部署去 Netlify。

## ⚠️ 開始改之前

- **一定用 GitHub 上最新版本做底**。先 pull／重新讀取 repo 入面嘅檔案，唔好用對話記憶或者之前貼過嘅舊代碼覆蓋，否則會將新設計改返做舊樣。
- 2026 年 10 月已經套用咗 MKPA 統一設計（宏利綠、Noto Sans HK、電子名片、「列印 / 存 PDF」）。見到呢啲係正常，唔好改返轉頭。

## 設計標準

完整標準喺 **`mickoo129/mkpa-tools`** 嘅 `CLAUDE.md` 同 `_standard/`（`mkpa.css`、`snippets.html`）。做設計相關改動之前先讀嗰度；如果讀唔到，先問我，唔好自己估。

重點：
- 主色宏利綠 `#00A758`；白底上嘅綠色文字用 `#00753E`；深色（頁頭、大標題）用深青綠 `#0E5E57`。
- 字體：內文 Noto Sans HK，數字 Barlow；唔用襯線字。
- 聯絡資料**只用電子名片連結**（`https://api.portfoplus.com/api/v1/adviser/5e41564ab3b1bc00153394db?m=link&r=adviser`），唔好加電話、WhatsApp 號碼、電郵或顧問資料輸入欄。
- 一定要有「列印 / 存 PDF」掣；列印版有工具名、列印日期、電子名片二維碼同版權行。
- 唔做深色模式。
- 版面：內容最闊 1320px，兩邊留白 `clamp(16px, 3vw, 32px)`；平板、手機唔可以橫向捲動。
- Icon：用 `mkpa-tools/_standard/make-icons.py` 產生（宏利綠圓角方塊 + 白色線條），標題旁、瀏覽器分頁、加至主畫面都用同一個；唔好自己換第二個風格。
- 版權行：© 年份 Michael Koo Protection Alliance (MKPA). 版權所有。
- 介面用繁體中文（香港用語）；手機闊度 375px 唔可以橫向捲動。

## 呢個工具嘅特別嘢

- 網頁喺 `public/`（Netlify publish 目錄），純 HTML/CSS/JS，唔使 build。
- GitHub Actions（`.github/workflows/scrape.yml`）每 2 小時抓息口，自動 commit 落 `public/data/` 同 `debug/`。呢啲數據檔唔好手動改。
- 網頁直接由 `raw.githubusercontent.com/mickoo129/bankrate/main/public/data/` 讀數據，所以 repo 名同路徑唔好改。
