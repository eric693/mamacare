# PostgreSQL 遷移計畫

目前系統以 **SQLite（better-sqlite3，同步 API）** 運作，穩定且零設定，適合單機構。
要往「高併發、多節點、可水平擴展」走，建議遷移到 **PostgreSQL**。本文件記錄已完成的部分與剩餘步驟。

## 為什麼不是一次改完
程式中有 **約 520 處同步 DB 呼叫**（`db.prepare(...).get()/.all()/.run()`）。
`better-sqlite3` 是**同步**、`pg` 是**非同步**，等於每條路由都要改成 `async/await`。
在沒有測試保護、又是線上系統的情況下一次盲改風險極高，因此採「**先建安全網 → 再分階段切換**」。

## 已完成（本次）
- ✅ **自動化測試套件**：`test/`（`npm test`，整合＋單元，17 項通過）— 切換 DB 後可用它確認沒壞。
- ✅ **CI**：`.github/workflows/ci.yml`（push/PR 自動跑 `npm test`，Node 20/22）。
- ✅ **PG 結構 DDL**：`scripts/pg_schema.js` 由現行 SQLite 結構**自動轉譯**並依 FK 拓樸排序，已**實測載入 PostgreSQL 16 成功（47 張表）**；輸出在 `db/schema.postgres.sql`。
- ✅ **資料搬遷腳本**：`scripts/pg_migrate.js`（SQLite → PostgreSQL，含序列重設）。
- ✅ **DB 路徑可覆寫**：`MAMACARE_DB` 環境變數（測試已用）。

## 剩餘步驟（建議排程）
1. **建立資料存取層（DAL）**：新增 `src/dal.js`，封裝 `query/get/all/run/transaction` 成 **async** 介面；兩種後端（sqlite/pg）都實作。
2. **逐模組改寫**：把 `db.prepare(...).xxx()` 換成 `await dal.xxx(sql, params)`，**一個路由群組一個 PR**，每次 `npm test` 綠燈才合併。
3. **SQL 方言調整**：`?` → `$1`、`datetime('now','localtime')` → `now()`、`strftime/substr` → `to_char`、`ON CONFLICT`、`INSERT ... RETURNING id` 取代 `lastInsertRowid`。
4. **切換與驗證**：`node scripts/pg_schema.js | psql` 建表 → `pg_migrate.js` 搬資料 → 設定 `PG_URL` → 全套測試 → 影子運行 → 正式切換。
5. **上線後**：啟用連線池、備份改 `pg_dump`／PITR、主從複製。

## 指令速查
```bash
# 產生 PG 結構
node scripts/pg_schema.js > db/schema.postgres.sql
# 建庫 + 建表
createdb mamacare && psql -d mamacare -f db/schema.postgres.sql
# 搬資料
npm install pg
PG_URL=postgres://postgres@127.0.0.1:5432/mamacare node scripts/pg_migrate.js
# 驗證
npm test
```
