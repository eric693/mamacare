# MamaCare 產後護理之家管理系統

月子中心／產後護理之家的全端管理系統：寶寶照護紀錄、媽媽照護、寶寶日報與家屬透明化、護理交班（SBAR）、排班與法定人力比檢核、房務與訂房管理。介面支援手機（響應式設計），全站不使用 emoji。

## 技術架構

| 層 | 技術 |
|---|---|
| 後端 | Node.js + Express，Session 認證，multer 圖片上傳 |
| 資料庫 | SQLite（better-sqlite3，WAL 模式），檔案位於 `data/mamacare.db` |
| 前端 | 無建置工具的原生 HTML/CSS/JS 單頁應用，手機優先 RWD |

## 啟動方式

```bash
npm install
npm start          # 預設 http://localhost:3000
```

第一次啟動會自動建立資料表與示範資料（已有資料則略過）。

## 入口與測試帳號

| 入口 | 網址 | 帳號 |
|---|---|---|
| 員工端 | `/` | admin / admin123（管理員）、nurse1 nurse2 nurse3 / nurse123（護理師） |
| 家屬入口 | `/family.html` | 通行碼 `DEMO1234`（小寶的爸爸） |

## 功能模組

- 總覽：入住率、在住媽媽寶寶數、今日照護筆數、未結帳款總額、本月已收款、在住寶寶今日照護狀態（最後餵食／餵食次數／尿布／最後體溫）、今日膳食訂餐彙總（未訂提醒）、異常警示（門檻可設定）、人力比檢核、近 7 日退房、近期預約入住與待參觀名單、近 30 天入住率趨勢圖。
- 寶寶照護：餵食（方式選項可設定）、換尿布（含紅臀／尿布疹評估：無／輕度／中度／重度）、體溫、體重、黃疸值、沐浴、睡眠紀錄；一鍵快速記錄（濕尿布／大便／沐浴）；照片上傳；寶寶日報自動彙整（含當日紅臀狀況、體重、黃疸趨勢圖）；一鍵發送日報給家屬。
- 媽媽照護：生命徵象、傷口、子宮、乳房、惡露、情緒評估、衛教紀錄。
- 護理交班：SBAR 格式（現況、背景、評估、建議），依日期與班別檢視。
- 住客管理：媽媽（預產期、生產方式、飲食禁忌、醫療注意）與寶寶基本資料，皆可編輯。
- 房務與訂房：房型房價、空房狀態、訂房（自動檢查檔期衝突、依天數試算總額）、入住／退房／取消流程。
- 收費帳務：每筆訂房的應收（合約總額＋加購消費）、已收（訂金＋繳費紀錄）、未結餘額；加購消費（常用項目可設定）與分期繳費（繳費方式可設定）皆記錄經手人，刪除限管理員。
- 電子合約與簽署：合約範本管理（管理員，支援 `{{占位符}}` 自動帶入訂房資料）；由訂房一鍵產生合約並凍結全文，產生不可猜測的簽署連結；客人於平板／手機開啟連結，閱讀後手寫簽名即完成簽署（canvas 簽名，無外部套件）；簽署後鎖定不可改，並記錄簽署人、關係、身分證末四碼、簽署時間、來源 IP 與裝置作為存證；員工可檢視並列印／另存 PDF；管理員可作廢（保留紀錄），未簽署者方可刪除。簽名 PNG 經後端驗證（PNG 魔術位元組與最小尺寸）防偽簽。
- 膳食管理：依訂房推算每日在住媽媽，早／午／晚三餐點選即存（餐點選項可設定），自動帶入飲食禁忌，可列印廚房備餐單（含各餐份數彙總）。
- 參觀預約：潛在客戶登記（參觀時間、預產期、來源）與狀態追蹤（待參觀／已參觀／已簽約／未成交），本月參觀數與簽約率統計。
- 排班與人力：三班七日班表；在住嬰兒數依訂房推算（過去、今日、未來日期皆正確），依設定的人力比自動檢核。
- 家屬帳號：每位家屬一組 8 碼通行碼，可綁定 LINE User ID；家屬入口提供今日摘要、完整照護時間軸、照片牆、成長趨勢圖；家屬端不揭露內部護理人員資訊。
- 評鑑月報（管理員）：月住房率、照護與交班紀錄統計、紅臀發生率（當月曾發生紅臀的寶寶數 ÷ 受照護寶寶數）、逐日人力比合規檢核（標示不合規日期）、逐日紅臀筆數、異常事件清單（含中度／重度紅臀）；支援列印與 CSV 匯出，可直接作為衛福部產後護理機構評鑑佐證。
- 資料匯出與備份（管理員）：媽媽、寶寶、訂房、帳務、繳費、加購、寶寶照護、媽媽照護、合約、參觀、排班、交班、家屬等各資料集皆可匯出 Excel（.xlsx，內建無相依產生器）與 PDF（列印頁另存）；資料庫每日凌晨 3 點自動線上備份（WAL 安全）、保留最近 N 份（預設 30），可手動立即備份與下載備份檔。
- 系統設定（管理員）：機構名稱、人力比、體溫／黃疸警示門檻、餵食與生產方式選項、繳費方式、加購常用項目、餐點選項、LINE Channel Access Token。所有營運參數存於 settings 表，程式內無硬編碼業務數值。

## LINE 推播

在「系統設定」填入 LINE Messaging API 的 Channel Access Token，並在「家屬帳號」為家屬綁定 LINE User ID 後，「發送日報給家屬」會對已綁定者推播日報文字訊息（`src/notify.js`），未綁定者仍可由家屬入口查看；每次發送寫入 `push_logs`（區分 line / portal 通道）。未設定 token 時系統完全離線可用。

## API 一覽（皆在 `/api` 之下）

- 公開：`GET /meta`（機構名稱）
- 認證：`POST /login`、`POST /logout`、`GET /me`
- 設定：`GET /settings`（員工；非管理員遮罩 token）、`PUT /settings`（限管理員）
- 總覽：`GET /dashboard`
- 媽媽：`GET/POST /mothers`、`GET/PUT /mothers/:id`、`GET/POST /mothers/:id/records`
- 寶寶：`GET/POST /babies`、`PUT /babies/:id`、`GET/POST /babies/:id/records`、`POST /babies/:id/photos`、`GET /babies/:id/report`、`GET /babies/:id/trends`、`POST /babies/:id/report/send`、`DELETE /baby-records/:id`（限管理員）
- 房務：`GET/POST /rooms`、`GET/POST /bookings`、`PUT /bookings/:id/status`
- 帳務：`GET /billing`（全部訂房帳務彙總）、`GET /bookings/:id/billing`（明細）、`POST /bookings/:id/charges`、`POST /bookings/:id/payments`、`DELETE /charges/:id`、`DELETE /payments/:id`（刪除限管理員）
- 合約範本：`GET /contract-templates`（員工）、`POST/PUT/DELETE /contract-templates/:id`（限管理員）
- 合約：`GET /contracts`（可加 `?booking_id=`）、`POST /bookings/:id/contracts`（由範本產生並凍結）、`GET /contracts/:id`、`POST /contracts/:id/void`（限管理員）、`DELETE /contracts/:id`（限管理員，僅未簽署）
- 公開簽署（免登入，持簽署 token）：`GET /sign/:token`（取合約供簽署／已簽署唯讀）、`POST /sign/:token`（提交手寫簽名，鎖定並存證）
- 膳食：`GET /meals?date=`（在住媽媽與當日訂餐）、`POST /meals`（upsert，choice 留空即取消）
- 參觀：`GET/POST /tours`、`PUT /tours/:id`、`DELETE /tours/:id`（限管理員）
- 排班：`GET/POST /shifts`、`DELETE /shifts/:id`、`GET /staffing-check`
- 交班：`GET/POST /handovers`
- 評鑑：`GET /reports/monthly?month=YYYY-MM`
- 匯出：`GET /export/datasets`（可匯出資料集清單）、`GET /export/:key`（`?format=xlsx` 下載 Excel，否則回傳 `{label,columns,rows}` 供前端列印 PDF）
- 備份（限管理員）：`GET /backups`（清單與最近一次）、`POST /backups`（立即備份）、`GET /backups/:name`（下載；檔名白名單防路徑穿越）
- 員工：`GET /users`、`POST /users`（限管理員）
- 家屬管理：`GET/POST /family-members`、`PUT /family-members/:id`（LINE 綁定）、`DELETE /family-members/:id`
- 家屬入口：`POST /family/login`、`POST /family/logout`、`GET /family/me`、`GET /family/report`、`GET /family/trends`、`GET /family/photos`

## 目錄結構

```
mamacare/
  src/
    db.js        資料庫 schema、種子資料、密碼雜湊（scrypt）
    server.js    Express API 與靜態檔案伺服
    xlsx.js      無相依 .xlsx 產生器（資料匯出）
    backup.js    每日／手動 SQLite 線上備份
  public/
    index.html   員工端 SPA
    family.html  家屬入口
    sign.html    合約簽署頁（免登入，持簽署連結）
    css/style.css
    js/api.js    共用 fetch 與工具
    js/app.js    員工端邏輯
    js/family.js 家屬入口邏輯
    js/sign.js   合約簽署頁邏輯（canvas 手寫簽名）
  data/          SQLite 資料庫檔（執行時建立）
  uploads/       寶寶照片（執行時寫入）
  backups/       每日／手動資料庫備份（執行時建立）
```

## 部署注意

- 正式部署請設定環境變數 `SESSION_SECRET`（未設定時每次重啟會產生新密鑰，所有登入 session 失效），並以 HTTPS 反向代理（cookie 可加上 `secure`）。
- 連接埠以 `PORT` 環境變數覆寫，預設 3000。
- 每日備份檔寫入 `backups/`，保留份數以 `BACKUP_RETAIN` 覆寫（預設 30）；建議定期將 `backups/` 另存至異地（如雲端或外接儲存）以防主機故障。反向代理已設定 `X-Forwarded-For`，後端 `trust proxy` 以記錄簽署來源 IP。
