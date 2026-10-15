# 定存息口通

自動比較香港各銀行（包括虛擬銀行）港元、美元、人民幣、澳元、英鎊、日圓嘅定期存款息口同匯價。

## 點樣運作

- **GitHub Actions** 每 2 小時自動打開各銀行公開網頁，讀取息口表同匯價表（`scraper/`）
- 讀到嘅數據存喺 `public/data/latest.json`，每日最高息記錄喺 `public/data/history.json`
- 網站（`public/`）係純 HTML／JS，直接由 GitHub 讀最新數據，所以 Netlify 唔使每次重新部署
- 讀唔到嘅銀行會保留最後一次成功嘅數據，並喺網站標示

## 第一次放上 Netlify

1. 登入 [app.netlify.com](https://app.netlify.com)，撳 **Add new site → Import an existing project**
2. 揀 **GitHub**，授權後揀 `bankrate` 呢個 repo
3. 設定頁全部唔使改（已由 `netlify.toml` 設定好：Publish directory = `public`，冇 build command），撳 **Deploy**
4. 完成後喺 **Site configuration → Change site name** 改個易記嘅網址

## 手動即時更新數據

GitHub repo → **Actions** → 左邊揀「更新息口及匯價」→ **Run workflow**。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `scraper/banks.js` | 銀行名單同起始網頁 |
| `scraper/extract.js` | 喺網頁入面讀取所有表格 |
| `scraper/parse.js` | 將表格變成息口／匯價數據 |
| `scraper/run.js` | 主程式 |
| `public/` | 網站 |
| `.github/workflows/scrape.yml` | 自動更新排程 |

## 免責聲明

所有息口只供參考，以銀行公布為準。本網站唔提供任何投資建議。
