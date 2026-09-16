-- ============================================================
-- AI 助理：每一次 AI 呼叫的紀錄
-- 這個檔在 schema.sql 之後載入，各站台共用同一份。
-- ============================================================
--
-- 為什麼要留這張表：
--
-- 1. **AI 產出的是草稿，草稿要能追溯**。使用者按下「採用」把 AI 抽出來的預約寫進系統之後，
--    那張單跟人工開的單長得一模一樣。出錯時要能回答「這是誰打的、還是 AI 猜的」。
-- 2. **成本要看得見**。token 用量逐筆記下來，老闆才知道這個月 AI 花了多少、哪個功能在燒錢。
-- 3. **模擬模式要標示清楚**。simulated=1 的紀錄不是真的呼叫過 AI ——
--    沒有這個欄位，示範資料跟正式資料混在一起就分不出來了。
--
-- 刻意不存的：完整的原始輸入。對話裡有客人姓名電話、證件照片有身分證字號，
-- 留一份在這張表等於多一個外洩面。只留前 200 字當作辨識用的預覽。
CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,               -- intake / askdb / ocr / i18n
  provider TEXT NOT NULL,            -- anthropic / openai / mock
  model TEXT NOT NULL DEFAULT '',
  simulated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok', -- ok / error
  error TEXT NOT NULL DEFAULT '',
  ms INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  input_preview TEXT NOT NULL DEFAULT '',
  output_json TEXT NOT NULL DEFAULT '',
  actor_id INTEGER,
  actor_name TEXT NOT NULL DEFAULT '',
  -- 採用軌跡：使用者把草稿變成真實資料時回填，沒採用的就是空的。
  -- 「AI 提了幾次、被採用幾次」是這個功能到底有沒有用的唯一誠實指標。
  adopted_at TEXT NOT NULL DEFAULT '',
  adopted_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ⚠ 本站專屬：其他站台的 setSetting 可以寫任意鍵，本站的 settings 表有
-- DEFAULT_SETTINGS 白名單（寫不在白名單裡的鍵會被擋掉，這是刻意的設計）。
-- AI 的供應商／模型／思考深度就放這張小表，不去動那份白名單。
-- 金鑰一律只從 .env 讀，永遠不會進資料庫。
CREATE TABLE IF NOT EXISTS ai_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
