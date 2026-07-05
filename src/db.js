const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// 預設正式資料庫；測試／其他環境可用 MAMACARE_DB 覆寫，不影響線上預設
const DB_PATH = process.env.MAMACARE_DB || path.join(__dirname, '..', 'data', 'mamacare.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

function init() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'nurse' CHECK (role IN ('admin','nurse')),
    phone TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    room_type TEXT NOT NULL DEFAULT '標準房',
    price_per_day INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS mothers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    birth_date TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    delivery_date TEXT DEFAULT '',
    delivery_type TEXT DEFAULT '' ,
    diet_notes TEXT DEFAULT '',
    medical_notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','checked_in','checked_out')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS babies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    name TEXT NOT NULL,
    gender TEXT DEFAULT '' CHECK (gender IN ('','male','female')),
    birth_date TEXT DEFAULT '',
    birth_weight_g INTEGER,
    notes TEXT DEFAULT '',
    location TEXT NOT NULL DEFAULT 'nursery' CHECK (location IN ('nursery','rooming','isolation','out')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    deposit INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','checked_in','checked_out','cancelled')),
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS baby_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    nurse_id INTEGER REFERENCES users(id),
    record_type TEXT NOT NULL CHECK (record_type IN
      ('feeding','diaper','temperature','weight','jaundice','bath','sleep','photo','note')),
    feed_method TEXT DEFAULT '',
    amount_ml INTEGER,
    diaper_kind TEXT DEFAULT '',
    diaper_rash TEXT DEFAULT '',
    value_num REAL,
    photo_file TEXT DEFAULT '',
    note TEXT DEFAULT '',
    location TEXT DEFAULT '' CHECK (location IN ('','nursery','rooming','isolation','out')),
    recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_baby_records_baby ON baby_records(baby_id, recorded_at);

  -- 寶寶位置異動紀錄（抱去給媽媽／抱回嬰兒室）
  CREATE TABLE IF NOT EXISTS baby_location_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    nurse_id INTEGER REFERENCES users(id),
    location TEXT NOT NULL CHECK (location IN ('nursery','rooming','isolation','out')),
    note TEXT DEFAULT '',
    moved_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_baby_location_logs_baby ON baby_location_logs(baby_id, moved_at);

  CREATE TABLE IF NOT EXISTS mother_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    nurse_id INTEGER REFERENCES users(id),
    record_type TEXT NOT NULL CHECK (record_type IN
      ('vital','wound','uterus','breast','lochia','mood','education','note')),
    value_text TEXT DEFAULT '',
    note TEXT DEFAULT '',
    recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_mother_records_mother ON mother_records(mother_id, recorded_at);

  CREATE TABLE IF NOT EXISTS handovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nurse_id INTEGER NOT NULL REFERENCES users(id),
    shift_type TEXT NOT NULL CHECK (shift_type IN ('day','evening','night')),
    handover_date TEXT NOT NULL,
    situation TEXT DEFAULT '',
    background TEXT DEFAULT '',
    assessment TEXT DEFAULT '',
    recommendation TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    shift_date TEXT NOT NULL,
    shift_type TEXT NOT NULL CHECK (shift_type IN ('day','evening','night')),
    UNIQUE(user_id, shift_date, shift_type)
  );

  CREATE TABLE IF NOT EXISTS family_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    name TEXT NOT NULL,
    relation TEXT DEFAULT '',
    access_code TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS push_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    report_date TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'portal',
    sent_by INTEGER REFERENCES users(id),
    sent_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS charge_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    item_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    charged_on TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_charge_items_booking ON charge_items(booking_id);

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    amount INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT '現金',
    paid_on TEXT NOT NULL,
    note TEXT DEFAULT '',
    received_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);

  CREATE TABLE IF NOT EXISTS meal_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    meal_date TEXT NOT NULL,
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner')),
    choice TEXT NOT NULL DEFAULT '',
    note TEXT DEFAULT '',
    UNIQUE(mother_id, meal_date, meal_type)
  );

  CREATE TABLE IF NOT EXISTS tours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    tour_at TEXT NOT NULL,
    source TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','visited','signed','lost')),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 參觀預約的追蹤備註 log（追加式，含時間與經手人，不覆蓋歷史）
  CREATE TABLE IF NOT EXISTS tour_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    body TEXT NOT NULL DEFAULT '',
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 房務清潔工作：客服／清潔共用的清潔與備品任務，可排定與完成打卡
  CREATE TABLE IF NOT EXISTS housekeeping_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER REFERENCES rooms(id),
    mother_id INTEGER REFERENCES mothers(id),
    task TEXT NOT NULL DEFAULT '',
    scheduled_for TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
    note TEXT DEFAULT '',
    created_by INTEGER,
    done_by INTEGER,
    done_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 電子合約範本（含 {{占位符}}，建立合約時以訂房資料帶入並凍結）
  CREATE TABLE IF NOT EXISTS contract_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 已產生的合約：body 為建立當下凍結的全文，簽署後鎖定不可改，僅管理員可作廢
  CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER REFERENCES bookings(id),
    template_id INTEGER,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    sign_token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','void')),
    signer_name TEXT DEFAULT '',
    signer_relation TEXT DEFAULT '',
    signer_id_last4 TEXT DEFAULT '',
    signature_data TEXT DEFAULT '',
    signed_at TEXT DEFAULT '',
    signed_ip TEXT DEFAULT '',
    signed_ua TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    voided_by INTEGER REFERENCES users(id),
    voided_at TEXT DEFAULT '',
    void_reason TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_contracts_booking ON contracts(booking_id);

  -- 稽核軌跡：誰在何時對哪筆資料做了什麼（醫療/個資合規佐證）
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT DEFAULT '',
    role TEXT DEFAULT '',
    action TEXT NOT NULL,                 -- create/update/delete/login/logout/sign/void/restore...
    method TEXT DEFAULT '',
    entity TEXT DEFAULT '',               -- 資料表/資源名稱
    entity_id TEXT DEFAULT '',
    path TEXT DEFAULT '',
    summary TEXT DEFAULT '',              -- 變更摘要（不含敏感大欄位）
    ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

  -- 異常／不良事件通報（跌倒、給藥錯誤、嬰兒辨識錯誤、感染、燙傷…）
  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,               -- fall/med_error/baby_id_error/infection/burn/equipment/other
    severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('near_miss','minor','moderate','severe','sentinel')),
    occurred_at TEXT NOT NULL,
    location TEXT DEFAULT '',
    mother_id INTEGER REFERENCES mothers(id),
    baby_id INTEGER REFERENCES babies(id),
    subject TEXT DEFAULT '',              -- 對象（媽媽/寶寶/員工/訪客）自由描述
    description TEXT DEFAULT '',
    immediate_action TEXT DEFAULT '',     -- 立即處置
    cause_analysis TEXT DEFAULT '',       -- 原因分析
    follow_up TEXT DEFAULT '',            -- 後續追蹤／改善措施
    outcome TEXT DEFAULT '',              -- 結果
    physician_notified INTEGER NOT NULL DEFAULT 0,
    family_notified INTEGER NOT NULL DEFAULT 0,
    reported_to_authority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','processing','closed')),
    reported_by INTEGER REFERENCES users(id),
    closed_by INTEGER REFERENCES users(id),
    closed_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_incidents_occurred ON incidents(occurred_at);

  -- 感染管制：洗手稽核
  CREATE TABLE IF NOT EXISTS hand_hygiene_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_date TEXT NOT NULL,
    area TEXT DEFAULT '',                 -- 嬰兒室/護理站/月子房…
    observed_role TEXT DEFAULT '',        -- 受稽核對象（護理師/清潔/訪客…）
    opportunities INTEGER NOT NULL DEFAULT 0,  -- 觀察手部衛生時機數
    compliant INTEGER NOT NULL DEFAULT 0,      -- 確實執行數
    observer_id INTEGER REFERENCES users(id),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_hh_date ON hand_hygiene_audits(audit_date);

  -- 感染管制：環境清潔消毒簽核
  CREATE TABLE IF NOT EXISTS disinfection_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    disinfect_date TEXT NOT NULL,
    area TEXT NOT NULL,                   -- 區域/設備
    agent TEXT DEFAULT '',               -- 消毒劑/方法
    operator_id INTEGER REFERENCES users(id),   -- 執行人
    verified_by INTEGER REFERENCES users(id),   -- 覆核簽核人
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_disinfect_date ON disinfection_logs(disinfect_date);

  -- 感染管制：群聚事件通報
  CREATE TABLE IF NOT EXISTS cluster_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pathogen TEXT DEFAULT '',            -- 病原/疾病
    onset_date TEXT NOT NULL,
    affected_count INTEGER NOT NULL DEFAULT 0,
    affected_detail TEXT DEFAULT '',
    description TEXT DEFAULT '',
    control_action TEXT DEFAULT '',      -- 防治措施
    reported_to_authority INTEGER NOT NULL DEFAULT 0,
    reported_at TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','monitoring','closed')),
    created_by INTEGER REFERENCES users(id),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 新生兒給藥紀錄（MAR：Medication Administration Record）
  CREATE TABLE IF NOT EXISTS med_administrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    drug_name TEXT NOT NULL,
    dose TEXT DEFAULT '',
    route TEXT DEFAULT '',               -- 口服/IM/IV/外用…
    ordered_by TEXT DEFAULT '',          -- 醫囑醫師
    scheduled_at TEXT DEFAULT '',
    administered_at TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'given' CHECK (status IN ('given','held','refused','missed')),
    nurse_id INTEGER REFERENCES users(id),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_mar_baby ON med_administrations(baby_id, administered_at);

  -- 新生兒疫苗接種（B型肝炎、卡介苗…）
  CREATE TABLE IF NOT EXISTS vaccinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    vaccine TEXT NOT NULL,               -- hepb_immunoglobulin/hepb/bcg/other
    dose_no TEXT DEFAULT '',
    administered_at TEXT DEFAULT '',
    lot_no TEXT DEFAULT '',
    site TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('scheduled','done','deferred','refused')),
    nurse_id INTEGER REFERENCES users(id),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_vacc_baby ON vaccinations(baby_id);

  -- 新生兒篩檢追蹤（聽力、代謝、心臟血氧 CCHD）
  CREATE TABLE IF NOT EXISTS newborn_screenings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    screen_type TEXT NOT NULL,           -- hearing/metabolic/cchd/other
    screened_at TEXT DEFAULT '',
    result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','pass','refer','abnormal')),
    follow_up TEXT DEFAULT '',           -- 複篩/轉介追蹤
    follow_up_done INTEGER NOT NULL DEFAULT 0,
    nurse_id INTEGER REFERENCES users(id),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_screen_baby ON newborn_screenings(baby_id);

  -- 新生兒光照治療紀錄
  CREATE TABLE IF NOT EXISTS phototherapy_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    start_at TEXT NOT NULL,
    end_at TEXT DEFAULT '',
    bilirubin_before REAL,
    bilirubin_after REAL,
    device TEXT DEFAULT '',
    nurse_id INTEGER REFERENCES users(id),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_photo_baby ON phototherapy_logs(baby_id);

  -- 醫師巡診就醫紀錄（小兒科／婦產科）：以 SOAP 格式記錄特約醫師到院巡診
  CREATE TABLE IF NOT EXISTS physician_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_type TEXT NOT NULL DEFAULT 'baby' CHECK (subject_type IN ('baby','mother')),
    baby_id INTEGER REFERENCES babies(id),
    mother_id INTEGER REFERENCES mothers(id),
    specialty TEXT NOT NULL DEFAULT 'pediatrics',   -- pediatrics/obgyn/other 小兒科/婦產科/其他
    physician TEXT DEFAULT '',                       -- 巡診醫師
    visit_at TEXT NOT NULL,                          -- 巡診時間
    visit_type TEXT NOT NULL DEFAULT 'routine' CHECK (visit_type IN ('routine','follow_up','acute','discharge')),
    subjective TEXT DEFAULT '',                      -- S 主訴／護理或家屬反映
    objective TEXT DEFAULT '',                       -- O 理學檢查所見
    assessment TEXT DEFAULT '',                      -- A 診斷／評估
    plan TEXT DEFAULT '',                            -- P 處置／醫囑
    follow_up TEXT DEFAULT '',                       -- 追蹤／回診安排
    referral TEXT DEFAULT '',                        -- 轉診／建議就醫院所（有值代表需轉診）
    recorded_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_pv_baby ON physician_visits(baby_id, visit_at);
  CREATE INDEX IF NOT EXISTS idx_pv_mother ON physician_visits(mother_id, visit_at);

  -- 電子發票／收據（欄位對齊財政部電子發票 MIG 3.2；實際上傳大平台需加值中心 API）
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER REFERENCES bookings(id),
    doc_type TEXT NOT NULL DEFAULT 'invoice' CHECK (doc_type IN ('invoice','receipt')),
    invoice_number TEXT DEFAULT '',      -- 發票號碼 2碼英文+8碼數字
    random_number TEXT DEFAULT '',       -- 隨機碼 4 碼
    invoice_date TEXT NOT NULL,
    invoice_time TEXT DEFAULT '',
    buyer_name TEXT DEFAULT '',
    buyer_tax_id TEXT DEFAULT '',        -- 統一編號（B2B），空為 B2C
    carrier_type TEXT DEFAULT '',        -- 載具類別
    carrier_id TEXT DEFAULT '',          -- 載具號碼
    npoban TEXT DEFAULT '',              -- 捐贈碼
    items TEXT NOT NULL DEFAULT '[]',    -- JSON: [{name,qty,price,amount}]
    sales_amount INTEGER NOT NULL DEFAULT 0,   -- 銷售額（未稅，含免稅情形）
    tax_type TEXT NOT NULL DEFAULT '3' CHECK (tax_type IN ('1','2','3','9')), -- 1應稅 2零稅 3免稅 9混合
    tax_amount INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL DEFAULT 0,    -- 總計
    status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','void','allowance')),
    allowance_amount INTEGER NOT NULL DEFAULT 0,
    void_reason TEXT DEFAULT '',
    upload_status TEXT NOT NULL DEFAULT 'local' CHECK (upload_status IN ('local','uploaded','failed')),
    upload_note TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    voided_by INTEGER REFERENCES users(id),
    voided_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);

  -- 家屬留言（家屬端 ←→ 員工端雙向；員工可回覆，含已讀狀態）
  CREATE TABLE IF NOT EXISTS family_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    family_id INTEGER REFERENCES family_members(id),
    sender TEXT NOT NULL CHECK (sender IN ('family','staff')),
    sender_name TEXT DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    staff_id INTEGER REFERENCES users(id),
    read_by_staff INTEGER NOT NULL DEFAULT 0,
    read_by_family INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_family_msg_baby ON family_messages(baby_id, created_at);

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    cost INTEGER NOT NULL DEFAULT 0,
    image TEXT DEFAULT '',
    description TEXT DEFAULT '',
    track_stock INTEGER NOT NULL DEFAULT 0,    -- 是否管控庫存
    stock INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,         -- 1=上架 0=下架
    sort INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_products_active ON products(active, sort);

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER REFERENCES bookings(id),
    mother_id INTEGER REFERENCES mothers(id),
    placed_by TEXT NOT NULL DEFAULT 'staff' CHECK (placed_by IN ('family','staff')),
    family_id INTEGER REFERENCES family_members(id),
    created_by INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
    total_amount INTEGER NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    confirmed_by INTEGER REFERENCES users(id),
    confirmed_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    item_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    amount INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

  -- 耗材進銷存（內部物料，與商城銷售商品分開）
  CREATE TABLE IF NOT EXISTS supplies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    unit TEXT DEFAULT '',                       -- 單位：包/罐/箱…
    stock INTEGER NOT NULL DEFAULT 0,
    safety_stock INTEGER NOT NULL DEFAULT 0,    -- 安全庫存，低於此值提醒
    note TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS supply_txns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supply_id INTEGER NOT NULL REFERENCES supplies(id),
    txn_type TEXT NOT NULL CHECK (txn_type IN ('in','out','adjust')), -- 進貨/領用/盤點
    quantity INTEGER NOT NULL,                  -- 異動數量（in 正、out 正數代表領出、adjust 為調整後差值）
    balance_after INTEGER NOT NULL DEFAULT 0,
    reason TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_supply_txns ON supply_txns(supply_id, created_at);

  -- 課程／活動與加購服務
  CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'course' CHECK (kind IN ('course','service')), -- 課程/服務
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    capacity INTEGER NOT NULL DEFAULT 0,        -- 0=不限名額
    scheduled_at TEXT DEFAULT '',               -- 課程時段（服務可留空，採預約）
    location TEXT DEFAULT '',
    description TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS program_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES programs(id),
    mother_id INTEGER REFERENCES mothers(id),
    booking_id INTEGER REFERENCES bookings(id),
    family_id INTEGER REFERENCES family_members(id),
    placed_by TEXT NOT NULL DEFAULT 'staff' CHECK (placed_by IN ('family','staff')),
    quantity INTEGER NOT NULL DEFAULT 1,
    preferred_at TEXT DEFAULT '',               -- 服務類偏好時段
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
    note TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    confirmed_by INTEGER REFERENCES users(id),
    confirmed_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_signups_status ON program_signups(status, created_at);

  -- 優惠券
  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT DEFAULT '',
    discount_type TEXT NOT NULL DEFAULT 'amount' CHECK (discount_type IN ('amount','percent')),
    discount_value INTEGER NOT NULL DEFAULT 0,  -- amount=元；percent=百分比
    min_spend INTEGER NOT NULL DEFAULT 0,
    max_discount INTEGER NOT NULL DEFAULT 0,    -- percent 折扣上限，0=不限
    usage_limit INTEGER NOT NULL DEFAULT 0,     -- 0=不限次數
    used_count INTEGER NOT NULL DEFAULT 0,
    valid_from TEXT DEFAULT '',
    valid_to TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 月子餐每日菜單（依日期＋餐別＋階段＋飲食類型）
  CREATE TABLE IF NOT EXISTS meal_menu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_date TEXT NOT NULL,
    slot TEXT NOT NULL,                 -- 餐別（早餐/午點/晚餐…）
    stage TEXT NOT NULL DEFAULT '',     -- 餐期階段名稱，''=不分階段
    diet TEXT NOT NULL DEFAULT '',      -- 飲食類型（一般/素食…），''=通用
    staple TEXT DEFAULT '',             -- 主食
    main TEXT DEFAULT '',               -- 主菜
    soup TEXT DEFAULT '',               -- 藥膳湯品
    veggie TEXT DEFAULT '',             -- 鮮蔬
    dessert TEXT DEFAULT '',            -- 甜品
    drink TEXT DEFAULT '',              -- 飲品
    note TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(menu_date, slot, stage, diet)
  );
  CREATE INDEX IF NOT EXISTS idx_meal_menu_date ON meal_menu(menu_date, slot);

  -- 衛福部表單通報上傳（與電子發票相同模式：未設定介接則僅本地產生）
  CREATE TABLE IF NOT EXISTS gov_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_type TEXT NOT NULL,                 -- 表單類型（monthly_report…）
    period TEXT NOT NULL DEFAULT '',         -- 期間 YYYY-MM
    title TEXT DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',      -- 上傳內容快照（JSON）
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT DEFAULT '',
    uploaded_at TEXT DEFAULT '',
    ack_no TEXT DEFAULT '',                  -- 主管機關回執編號
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(form_type, period)
  );

  -- 員工證照（到期提醒）
  CREATE TABLE IF NOT EXISTS staff_certifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    staff_name TEXT DEFAULT '',              -- 非系統帳號者可手填姓名
    cert_name TEXT NOT NULL,
    cert_no TEXT DEFAULT '',
    issuer TEXT DEFAULT '',
    issued_on TEXT DEFAULT '',
    expires_on TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_cert_expires ON staff_certifications(expires_on);

  -- 電子問卷／滿意度調查
  CREATE TABLE IF NOT EXISTS surveys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    questions TEXT NOT NULL DEFAULT '[]',    -- JSON [{type:'rating'|'choice'|'text', label, options?}]
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS survey_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id INTEGER NOT NULL REFERENCES surveys(id),
    family_id INTEGER REFERENCES family_members(id),
    mother_id INTEGER REFERENCES mothers(id),
    answers TEXT NOT NULL DEFAULT '{}',      -- JSON { 題序: 答案 }
    submitted_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_survey_resp ON survey_responses(survey_id);

  -- LINE／Facebook 雙向訊息 CRM
  CREATE TABLE IF NOT EXISTS crm_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL CHECK (channel IN ('line','facebook')),
    channel_user_id TEXT NOT NULL,        -- LINE userId / FB PSID
    display_name TEXT DEFAULT '',
    picture_url TEXT DEFAULT '',
    mother_id INTEGER REFERENCES mothers(id),     -- 自動／手動對應住戶
    family_id INTEGER REFERENCES family_members(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    last_message_at TEXT DEFAULT '',
    last_text TEXT DEFAULT '',
    unread INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(channel, channel_user_id)
  );
  CREATE TABLE IF NOT EXISTS crm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL REFERENCES crm_contacts(id),
    direction TEXT NOT NULL CHECK (direction IN ('in','out')),
    text TEXT DEFAULT '',
    msg_type TEXT NOT NULL DEFAULT 'text',
    staff_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_crm_msg ON crm_messages(contact_id, id);

  -- 線上金流付款意圖（ECPay 綠界等）
  CREATE TABLE IF NOT EXISTS payment_intents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    amount INTEGER NOT NULL,
    provider TEXT NOT NULL DEFAULT 'ecpay',
    merchant_trade_no TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
    trade_no TEXT DEFAULT '',
    payment_type TEXT DEFAULT '',
    paid_at TEXT DEFAULT '',
    raw TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 寶寶護理每日評估（中衛必要欄位－嬰兒日常評估）
  CREATE TABLE IF NOT EXISTS baby_nursing_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    nurse_id INTEGER REFERENCES users(id),
    assess_date TEXT NOT NULL,
    assess_time TEXT NOT NULL DEFAULT '',
    weight_g REAL,
    temperature REAL,
    data TEXT NOT NULL DEFAULT '{}',   -- 其餘評估欄位（JSON：洗澡／心跳／呼吸／臍帶／奶量／皮膚／紅臀／大小便／親子同室…）
    special_note TEXT DEFAULT '',      -- 特殊情況及處理
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_bna_baby ON baby_nursing_assessments(baby_id, assess_date);

  -- 寶寶親子同室護理紀錄（推出／返室、奶量、大小便、敍述性紀錄）
  CREATE TABLE IF NOT EXISTS baby_rooming_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    nurse_id INTEGER REFERENCES users(id),
    log_date TEXT NOT NULL,
    log_time TEXT NOT NULL DEFAULT '',
    breastfeed_min INTEGER,            -- 親餵分鐘（未親餵為 NULL）
    breast_milk_ml INTEGER,            -- 母乳 ml
    formula_ml INTEGER,                -- 配方奶 ml
    stool TEXT DEFAULT '',
    urine TEXT DEFAULT '',
    out_time TEXT DEFAULT '',          -- 推出時間
    return_time TEXT DEFAULT '',       -- 返室時間
    note TEXT DEFAULT '',              -- 敍述性護理紀錄（限 300 字）
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_brl_baby ON baby_rooming_logs(baby_id, log_date);

  -- 母乳哺育評估表（BREAST 觀察評估；各列勾選存 JSON）
  CREATE TABLE IF NOT EXISTS breastfeeding_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    nurse_id INTEGER REFERENCES users(id),
    assess_date TEXT NOT NULL,
    current_weight_g REAL,             -- 目前體重
    parity TEXT DEFAULT '',            -- 胎次
    feed_type TEXT DEFAULT '',         -- 純母乳／混合哺餵／配方奶
    avg_pump_ml TEXT DEFAULT '',       -- 平均每次擠奶量
    milk_brand TEXT DEFAULT '',        -- 奶品
    milk_amount TEXT DEFAULT '',       -- 奶量
    items TEXT NOT NULL DEFAULT '{}',  -- 各評估列勾選與附加欄（JSON）
    other_note TEXT DEFAULT '',        -- 12.其它
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_bfa_baby ON breastfeeding_assessments(baby_id, assess_date);

  -- 寶寶評估單（中衛必要欄位－嬰兒個案基本資料；每寶寶一筆，覆寫更新）
  CREATE TABLE IF NOT EXISTS baby_case_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL UNIQUE REFERENCES babies(id),
    nurse_id INTEGER REFERENCES users(id),
    data TEXT NOT NULL DEFAULT '{}',   -- 個案基本資料欄位（JSON：入住／出生／APGAR／生產方式／體重身長／篩檢注射／症狀…）
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 寶寶評估單（中衛必要欄位－嬰兒入住評估；保留歷次紀錄）
  CREATE TABLE IF NOT EXISTS baby_intake_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    nurse_id INTEGER REFERENCES users(id),
    assess_date TEXT NOT NULL,
    assess_time TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',   -- 入住評估欄位（JSON：生命徵象／頭眼耳鼻口頸／皮膚紅臀／胸腹呼吸心跳…）
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_bia_baby ON baby_intake_assessments(baby_id, assess_date);

  -- 兒科醫師診視紀錄（醫師巡診；房況卡片進入，逐筆可修改/刪除）
  CREATE TABLE IF NOT EXISTS baby_doctor_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    recorded_by INTEGER REFERENCES users(id),
    visit_date TEXT NOT NULL,
    visit_time TEXT NOT NULL DEFAULT '',
    weight_g REAL,                     -- 診視當日體重（gm）
    data TEXT NOT NULL DEFAULT '{}',   -- 各部位檢查勾選（JSON：皮膚／頭囟眼口頸鎖骨／心肺臍生殖器臀…）
    note TEXT DEFAULT '',              -- 敍述性紀錄（限 600 字）
    edited_at TEXT DEFAULT '',
    edited_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_bdv_baby ON baby_doctor_visits(baby_id, visit_date);

  -- 產科醫師診視紀錄（醫師巡診；媽媽房況卡片進入，逐筆可修改/刪除）
  CREATE TABLE IF NOT EXISTS mother_doctor_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    recorded_by INTEGER REFERENCES users(id),
    visit_date TEXT NOT NULL,
    visit_time TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',   -- 各項評估勾選（JSON：精神情緒／哺乳／乳房／EP傷口／宮縮／惡露／二便／痔瘡／水腫…）
    note TEXT DEFAULT '',              -- 敍述性紀錄（限 600 字）
    edited_at TEXT DEFAULT '',
    edited_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_mdv_mother ON mother_doctor_visits(mother_id, visit_date);

  -- 產婦交班單（媽媽房況卡片進入；逐筆可修改/刪除。飲食禁忌存 mothers.diet_notes、
  -- 重要備註/特殊飲品餐存 mother_intake_assessments.data）
  CREATE TABLE IF NOT EXISTS mother_handovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    nurse_id INTEGER REFERENCES users(id),
    handover_date TEXT NOT NULL,
    handover_time TEXT NOT NULL DEFAULT '',
    fundus TEXT DEFAULT '',            -- 宮底高度
    lochia TEXT DEFAULT '',            -- 惡露（量/顏色描述）
    note TEXT DEFAULT '',              -- 交班事項（限 600 字）
    edited_at TEXT DEFAULT '',
    edited_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_mho_mother ON mother_handovers(mother_id, handover_date);

  -- 客戶管理：潛在客戶擴充資料（掛在 mothers 上，每媽媽一筆；建潛客＝mothers status='reserved'＋本表）
  CREATE TABLE IF NOT EXISTS customer_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL UNIQUE REFERENCES mothers(id),
    data TEXT NOT NULL DEFAULT '{}',   -- 身份/來源/生產醫院/喜好房型/聯絡人/介紹人…（JSON 白名單）
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 房間資料管理：房型設定（房型主檔，rooms.room_type 對應 name）
  CREATE TABLE IF NOT EXISTS room_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    price INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 房間資料管理：房價折扣設定（依房型/客戶分類/住宿天數的折扣專案）
  CREATE TABLE IF NOT EXISTS room_discounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_type TEXT NOT NULL DEFAULT '',
    customer_class TEXT DEFAULT '一般客戶',
    plan_name TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    end_date TEXT DEFAULT '',
    stay_days INTEGER NOT NULL DEFAULT 0,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 100,
    bonus_days INTEGER NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 房間資料管理：嬰兒床位設定（床號＋分區）
  CREATE TABLE IF NOT EXISTS baby_beds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bed_no TEXT NOT NULL UNIQUE,
    zone TEXT DEFAULT 'A',
    note TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 後台：公佈欄及交辦事項（notice=公告、task=交辦；交辦可指派與結案）
  CREATE TABLE IF NOT EXISTS bulletins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'notice' CHECK (kind IN ('notice','task')),
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    assigned_to INTEGER REFERENCES users(id),
    due_date TEXT DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT DEFAULT '',
    done_by INTEGER REFERENCES users(id),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 後台：文件上傳下載區
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT DEFAULT '',
    filename TEXT NOT NULL,
    orig_name TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    uploaded_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 客戶合約資料（每媽媽一筆；合約編號 YYYYMM+3碼流水；items=銷售房型明細 JSON 陣列）
  CREATE TABLE IF NOT EXISTS customer_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL UNIQUE REFERENCES mothers(id),
    contract_no TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',   -- 簽約日/經手人/胎次/寶寶人數/產檢醫院醫生/小管家/備註/定型化簽回/住房卡/分享卡/產前諮詢（JSON 白名單）
    items TEXT NOT NULL DEFAULT '[]',  -- [{name,qty,price,by,at}]（合約總額＝Σ qty*price）
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 客戶互動紀錄（追加式，不覆蓋歷史；掛 mothers）
  CREATE TABLE IF NOT EXISTS customer_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    body TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_clog_mother ON customer_logs(mother_id);

  -- 產婦結案（每媽媽一筆；解除結案＝admin DELETE）
  CREATE TABLE IF NOT EXISTS mother_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL UNIQUE REFERENCES mothers(id),
    nurse_id INTEGER REFERENCES users(id),
    close_date TEXT NOT NULL,
    close_time TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',   -- 原因/去向/衛教清單/追蹤事項（JSON 白名單）
    note TEXT DEFAULT '',              -- 結案摘要（限 600 字）
    edited_at TEXT DEFAULT '',
    edited_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 新生兒交班單（房況卡片進入；逐筆可修改/刪除）
  CREATE TABLE IF NOT EXISTS baby_handovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    nurse_id INTEGER REFERENCES users(id),
    handover_date TEXT NOT NULL,
    handover_time TEXT NOT NULL DEFAULT '',
    feed_method TEXT DEFAULT '',          -- 餵奶方式：瓶／針／杯
    pacifier TEXT DEFAULT '',             -- 安撫奶嘴：可吃／禁嘴／必要時可吃
    isolation TEXT NOT NULL DEFAULT '[]', -- 隔離（JSON 陣列：寶寶隔離／奶瓶隔離）
    weight_g REAL,                        -- 體重（gm）
    jaundice REAL,                        -- 黃疸值（mg/dl）
    cord TEXT DEFAULT '',                 -- 臍帶
    sleep TEXT DEFAULT '',                -- 睡眠狀況：安穩／安撫可睡著／哭鬧
    note TEXT DEFAULT '',                 -- 交班事項
    edited_at TEXT DEFAULT '',
    edited_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_bho_baby ON baby_handovers(baby_id, handover_date);

  -- 產後嬰兒結案（每寶寶一筆，可更新；解除結案＝管理員刪除）
  CREATE TABLE IF NOT EXISTS baby_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL UNIQUE REFERENCES babies(id),
    nurse_id INTEGER REFERENCES users(id),
    close_date TEXT NOT NULL,
    close_time TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',   -- 結案欄位（JSON：原因／去向／結案體重黃疸臍帶餵食／衛教清單／追蹤轉介）
    note TEXT DEFAULT '',              -- 結案摘要（限 600 字）
    edited_at TEXT DEFAULT '',
    edited_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 媽媽護理（中衛日常評估欄位；房況卡片進入）
  CREATE TABLE IF NOT EXISTS mother_nursing_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    nurse_id INTEGER REFERENCES users(id),
    assess_date TEXT NOT NULL,
    assess_time TEXT NOT NULL DEFAULT '',
    temperature REAL,                  -- 體溫（>=37.5 視為發燒）
    pulse REAL, respiration REAL,      -- 脈搏／呼吸（bpm）
    systolic REAL, diastolic REAL,     -- 收縮壓／舒張壓（mmHg）
    data TEXT NOT NULL DEFAULT '{}',   -- 其餘評估欄位（JSON：疼痛／排便／子宮復舊／惡露／傷口／乳房／精神活動力…）
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_mna_mother ON mother_nursing_assessments(mother_id, assess_date);

  -- 媽媽健康問題列表（開始／結案）
  CREATE TABLE IF NOT EXISTS mother_health_problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    nurse_id INTEGER REFERENCES users(id),
    item TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT DEFAULT '',          -- 空字串＝未結案
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_mhp_mother ON mother_health_problems(mother_id);

  -- 媽媽量表評估（apgar=家庭功能／epds=愛丁堡憂鬱／bf_awareness=母乳認知與支持）
  CREATE TABLE IF NOT EXISTS mother_scales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    nurse_id INTEGER REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('apgar','epds','bf_awareness')),
    fill_date TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '[]',  -- 各題答案（JSON 陣列）
    total INTEGER,                       -- 總分（bf_awareness 無總分可為 NULL）
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_msc_mother ON mother_scales(mother_id, kind, fill_date);

  -- 護理指導單執行紀錄（care=產婦護理指導單／breastfeeding=母乳哺育指導單）
  CREATE TABLE IF NOT EXISTS mother_guidance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    nurse_id INTEGER REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('care','breastfeeding')),
    done_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_mgl_mother ON mother_guidance_logs(mother_id, done_date);

  -- 產婦入住護理評估表（中衛必要欄位＋入住評估；每媽媽一筆，覆寫更新）
  CREATE TABLE IF NOT EXISTS mother_intake_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL UNIQUE REFERENCES mothers(id),
    nurse_id INTEGER REFERENCES users(id),
    data TEXT NOT NULL DEFAULT '{}',   -- 全部評估欄位（JSON 白名單）
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 乳房圖示（每日照片）
  CREATE TABLE IF NOT EXISTS mother_breast_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    nurse_id INTEGER REFERENCES users(id),
    taken_date TEXT NOT NULL,
    photo_file TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_mbp_mother ON mother_breast_photos(mother_id, taken_date);

  -- 名人／顧客推薦牆（對外行銷內容）
  CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    title TEXT DEFAULT '',          -- 稱號（明星夫妻／資深音樂人…）
    quote TEXT DEFAULT '',          -- 推薦語
    photo TEXT DEFAULT '',          -- /uploads/xxx
    source_url TEXT DEFAULT '',     -- FB／IG 來源連結
    video_url TEXT DEFAULT '',      -- 影片連結
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  `);

  // 既有資料庫的欄位遷移
  const roomCols = db.prepare('PRAGMA table_info(rooms)').all().map(c => c.name);
  if (!roomCols.includes('call_ext')) {
    // 呼叫分機／客服分機／排序（房間資料管理）
    db.exec("ALTER TABLE rooms ADD COLUMN call_ext TEXT DEFAULT ''");
    db.exec("ALTER TABLE rooms ADD COLUMN service_ext TEXT DEFAULT ''");
    db.exec("ALTER TABLE rooms ADD COLUMN sort INTEGER NOT NULL DEFAULT 0");
  }
  const bkoCols = db.prepare('PRAGMA table_info(bookings)').all().map(c => c.name);
  if (!bkoCols.includes('actual_check_out')) {
    // 實際退房日（退房操作時寫入；早於預退日即為提前退房）＋提前退房原因
    db.exec("ALTER TABLE bookings ADD COLUMN actual_check_out TEXT DEFAULT ''");
    db.exec("ALTER TABLE bookings ADD COLUMN early_reason TEXT DEFAULT ''");
  }
  const ccCols = db.prepare('PRAGMA table_info(customer_contracts)').all().map(c => c.name);
  if (!ccCols.includes('status')) {
    // 合約狀態：active=有效、cancelled=退訂（退訂原因/退訂人/日期存 data JSON cancel_*）
    db.exec("ALTER TABLE customer_contracts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('id_no')) {
    // 照護人員身分證字號（寶寶評估單等中衛欄位自動帶入用）
    db.exec("ALTER TABLE users ADD COLUMN id_no TEXT DEFAULT ''");
  }
  const famCols = db.prepare('PRAGMA table_info(family_members)').all().map(c => c.name);
  if (!famCols.includes('line_user_id')) {
    db.exec("ALTER TABLE family_members ADD COLUMN line_user_id TEXT NOT NULL DEFAULT ''");
  }
  const babyCols = db.prepare('PRAGMA table_info(babies)').all().map(c => c.name);
  if (!babyCols.includes('location')) {
    db.exec("ALTER TABLE babies ADD COLUMN location TEXT NOT NULL DEFAULT 'nursery'");
  }
  const brCols = db.prepare('PRAGMA table_info(baby_records)').all().map(c => c.name);
  if (!brCols.includes('location')) {
    db.exec("ALTER TABLE baby_records ADD COLUMN location TEXT DEFAULT ''");
  }
  if (!brCols.includes('diaper_rash')) {
    db.exec("ALTER TABLE baby_records ADD COLUMN diaper_rash TEXT DEFAULT ''");
  }

  // 會員：媽媽自動為會員，掛點數與會員編號
  const mCols = db.prepare('PRAGMA table_info(mothers)').all().map(c => c.name);
  if (!mCols.includes('points')) db.exec('ALTER TABLE mothers ADD COLUMN points INTEGER NOT NULL DEFAULT 0');
  // 媽媽身分證號（媽媽護理中衛欄位帶入用）
  if (!mCols.includes('id_no')) db.exec("ALTER TABLE mothers ADD COLUMN id_no TEXT DEFAULT ''");
  if (!mCols.includes('member_no')) {
    db.exec("ALTER TABLE mothers ADD COLUMN member_no TEXT DEFAULT ''");
    // 既有媽媽補編會員編號 M + 5 碼
    const rows = db.prepare("SELECT id FROM mothers WHERE member_no = '' OR member_no IS NULL").all();
    const upd = db.prepare('UPDATE mothers SET member_no = ? WHERE id = ?');
    for (const r of rows) upd.run('M' + String(r.id).padStart(5, '0'), r.id);
  }

  // 月子餐：每位媽媽的飲食類型
  if (!mCols.includes('meal_diet')) db.exec("ALTER TABLE mothers ADD COLUMN meal_diet TEXT NOT NULL DEFAULT '一般'");
  // 房務清潔：住客需求（勿擾時間／哺乳衣／定時清垃圾等），供客服與清潔同步
  if (!mCols.includes('hk_dnd')) db.exec("ALTER TABLE mothers ADD COLUMN hk_dnd TEXT DEFAULT ''");
  if (!mCols.includes('hk_needs')) db.exec("ALTER TABLE mothers ADD COLUMN hk_needs TEXT DEFAULT ''");
  if (!mCols.includes('hk_notes')) db.exec("ALTER TABLE mothers ADD COLUMN hk_notes TEXT DEFAULT ''");

  // 合約重簽：記錄取代來源（版本鏈）
  const ctCols = db.prepare('PRAGMA table_info(contracts)').all().map(c => c.name);
  if (!ctCols.includes('replaces_id')) db.exec('ALTER TABLE contracts ADD COLUMN replaces_id INTEGER');
  if (!ctCols.includes('handler')) db.exec("ALTER TABLE contracts ADD COLUMN handler TEXT DEFAULT ''");

  // 應收帳款催收：記錄最後催收時間
  const bkCols = db.prepare('PRAGMA table_info(bookings)').all().map(c => c.name);
  if (!bkCols.includes('dunned_at')) db.exec("ALTER TABLE bookings ADD COLUMN dunned_at TEXT DEFAULT ''");
  // 寶寶入住日（媽媽入住但寶寶較晚到院時，用於計算未入住扣抵）
  if (!bkCols.includes('baby_check_in')) db.exec("ALTER TABLE bookings ADD COLUMN baby_check_in TEXT DEFAULT ''");

  // 參觀預約：下次跟進日（到期併入待辦提醒）；歡迎訊息是否已發（避免重複）
  const tourCols = db.prepare('PRAGMA table_info(tours)').all().map(c => c.name);
  if (!tourCols.includes('follow_up_date')) db.exec("ALTER TABLE tours ADD COLUMN follow_up_date TEXT DEFAULT ''");
  // 預約參觀管理：胎次／是否出席／生產醫院／取消明細（原因・時間・取消人）
  if (!tourCols.includes('parity')) db.exec("ALTER TABLE tours ADD COLUMN parity TEXT DEFAULT ''");
  if (!tourCols.includes('attended')) db.exec("ALTER TABLE tours ADD COLUMN attended TEXT DEFAULT ''");   // ''/是/否
  if (!tourCols.includes('birth_hospital')) db.exec("ALTER TABLE tours ADD COLUMN birth_hospital TEXT DEFAULT ''");
  if (!tourCols.includes('cancel_reason')) db.exec("ALTER TABLE tours ADD COLUMN cancel_reason TEXT DEFAULT ''");
  if (!tourCols.includes('cancel_at')) db.exec("ALTER TABLE tours ADD COLUMN cancel_at TEXT DEFAULT ''");
  if (!tourCols.includes('cancel_by')) db.exec('ALTER TABLE tours ADD COLUMN cancel_by INTEGER');
  if (!tourCols.includes('created_by')) db.exec('ALTER TABLE tours ADD COLUMN created_by INTEGER');
  // 預約參觀時段設定：指定日期時段／不開放參觀日
  db.exec(`CREATE TABLE IF NOT EXISTS tour_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_date TEXT NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0,
    open_from TEXT DEFAULT '',
    open_to TEXT DEFAULT '',
    slot_minutes INTEGER NOT NULL DEFAULT 60,
    capacity INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  const bkCols2 = db.prepare('PRAGMA table_info(bookings)').all().map(c => c.name);
  if (!bkCols2.includes('welcomed_at')) db.exec("ALTER TABLE bookings ADD COLUMN welcomed_at TEXT DEFAULT ''");

  // 交班未結項目轉待辦
  const hoCols = db.prepare('PRAGMA table_info(handovers)').all().map(c => c.name);
  if (!hoCols.includes('follow_up')) db.exec("ALTER TABLE handovers ADD COLUMN follow_up TEXT DEFAULT ''");
  if (!hoCols.includes('resolved')) db.exec('ALTER TABLE handovers ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0');
  if (!hoCols.includes('resolved_by')) db.exec('ALTER TABLE handovers ADD COLUMN resolved_by INTEGER');
  if (!hoCols.includes('resolved_at')) db.exec("ALTER TABLE handovers ADD COLUMN resolved_at TEXT DEFAULT ''");

  // 耗材：目標補貨量（叫貨單用，0=用安全庫存兩倍估算）
  const supCols = db.prepare('PRAGMA table_info(supplies)').all().map(c => c.name);
  if (!supCols.includes('restock_level')) db.exec('ALTER TABLE supplies ADD COLUMN restock_level INTEGER NOT NULL DEFAULT 0');

  // 擴充寶寶照護紀錄：新增生命徵象（呼吸/心跳/血氧）、生長（身長/頭圍）、
  // 觀察（膚色/臍帶/溢吐奶/活動力/大便性狀）等型別，並加 value_text 存類別型觀察值
  const brSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='baby_records'").get() || {}).sql || '';
  if (!brSql.includes("'respiration'")) {
    const tx = db.transaction(() => {
      db.exec(`CREATE TABLE baby_records_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        baby_id INTEGER NOT NULL REFERENCES babies(id),
        nurse_id INTEGER REFERENCES users(id),
        record_type TEXT NOT NULL CHECK (record_type IN
          ('feeding','diaper','temperature','weight','jaundice','bath','sleep','photo','note',
           'respiration','heart_rate','spo2','length','head_circ','skin','cord','vomit','activity','stool')),
        feed_method TEXT DEFAULT '',
        amount_ml INTEGER,
        diaper_kind TEXT DEFAULT '',
        value_num REAL,
        value_text TEXT DEFAULT '',
        photo_file TEXT DEFAULT '',
        note TEXT DEFAULT '',
        recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        location TEXT DEFAULT '',
        diaper_rash TEXT DEFAULT ''
      )`);
      db.exec(`INSERT INTO baby_records_new
        (id, baby_id, nurse_id, record_type, feed_method, amount_ml, diaper_kind, value_num, photo_file, note, recorded_at, location, diaper_rash)
        SELECT id, baby_id, nurse_id, record_type, feed_method, amount_ml, diaper_kind, value_num, photo_file, note, recorded_at, location, diaper_rash
        FROM baby_records`);
      db.exec('DROP TABLE baby_records');
      db.exec('ALTER TABLE baby_records_new RENAME TO baby_records');
      db.exec('CREATE INDEX IF NOT EXISTS idx_baby_records_baby ON baby_records(baby_id, recorded_at)');
    });
    db.pragma('foreign_keys = OFF');
    tx();
    db.pragma('foreign_keys = ON');
  }

  // 擴充媽媽照護紀錄：血壓、脈搏、排泄、泌乳指導、用藥
  const mrSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='mother_records'").get() || {}).sql || '';
  if (!mrSql.includes("'lactation'")) {
    const tx = db.transaction(() => {
      db.exec(`CREATE TABLE mother_records_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mother_id INTEGER NOT NULL REFERENCES mothers(id),
        nurse_id INTEGER REFERENCES users(id),
        record_type TEXT NOT NULL CHECK (record_type IN
          ('vital','wound','uterus','breast','lochia','mood','education','note',
           'bp','pulse','elimination','lactation','medication')),
        value_text TEXT DEFAULT '',
        note TEXT DEFAULT '',
        recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`);
      db.exec(`INSERT INTO mother_records_new (id, mother_id, nurse_id, record_type, value_text, note, recorded_at)
        SELECT id, mother_id, nurse_id, record_type, value_text, note, recorded_at FROM mother_records`);
      db.exec('DROP TABLE mother_records');
      db.exec('ALTER TABLE mother_records_new RENAME TO mother_records');
    });
    db.pragma('foreign_keys = OFF');
    tx();
    db.pragma('foreign_keys = ON');
  }

  // 寶寶位置狀態擴充：新增 隔離室(isolation)／不在館內(out)（放寬既有 CHECK 需重建表）
  const babySql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='babies'").get() || {}).sql || '';
  if (!babySql.includes("'isolation'")) {
    const tx = db.transaction(() => {
      db.exec(`CREATE TABLE babies_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mother_id INTEGER NOT NULL REFERENCES mothers(id),
        name TEXT NOT NULL,
        gender TEXT DEFAULT '' CHECK (gender IN ('','male','female')),
        birth_date TEXT DEFAULT '',
        birth_weight_g INTEGER,
        notes TEXT DEFAULT '',
        location TEXT NOT NULL DEFAULT 'nursery' CHECK (location IN ('nursery','rooming','isolation','out')),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`);
      db.exec(`INSERT INTO babies_new (id, mother_id, name, gender, birth_date, birth_weight_g, notes, location, created_at)
        SELECT id, mother_id, name, gender, birth_date, birth_weight_g, notes, location, created_at FROM babies`);
      db.exec('DROP TABLE babies');
      db.exec('ALTER TABLE babies_new RENAME TO babies');
    });
    db.pragma('foreign_keys = OFF');
    tx();
    db.pragma('foreign_keys = ON');
  }
  const bllSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='baby_location_logs'").get() || {}).sql || '';
  if (!bllSql.includes("'isolation'")) {
    const tx = db.transaction(() => {
      db.exec(`CREATE TABLE baby_location_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        baby_id INTEGER NOT NULL REFERENCES babies(id),
        nurse_id INTEGER REFERENCES users(id),
        location TEXT NOT NULL CHECK (location IN ('nursery','rooming','isolation','out')),
        note TEXT DEFAULT '',
        moved_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`);
      db.exec(`INSERT INTO baby_location_logs_new (id, baby_id, nurse_id, location, note, moved_at)
        SELECT id, baby_id, nurse_id, location, note, moved_at FROM baby_location_logs`);
      db.exec('DROP TABLE baby_location_logs');
      db.exec('ALTER TABLE baby_location_logs_new RENAME TO baby_location_logs');
      db.exec('CREATE INDEX IF NOT EXISTS idx_baby_location_logs_baby ON baby_location_logs(baby_id, moved_at)');
    });
    db.pragma('foreign_keys = OFF');
    tx();
    db.pragma('foreign_keys = ON');
  }

  // 照護紀錄可編輯：最後修改者／時間（明細變更另由 audit_logs 留軌跡）。須在上述重建之後執行
  for (const t of ['baby_records', 'mother_records']) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    if (!cols.includes('edited_at')) db.exec(`ALTER TABLE ${t} ADD COLUMN edited_at TEXT DEFAULT ''`);
    if (!cols.includes('edited_by')) db.exec(`ALTER TABLE ${t} ADD COLUMN edited_by INTEGER`);
  }

  // 帳號權限：非管理員帳號可分模組授權（admin 角色恆為全權）
  const uCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!uCols.includes('permissions')) {
    db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT ''");
    // 既有護理師沿用原有可存取範圍，避免升級後被鎖權限
    const defaultStaff = JSON.stringify(['baby_care', 'newborn_medical', 'mother_care', 'handover',
      'incidents', 'infection', 'residents', 'rooms', 'billing', 'shop', 'supplies', 'programs',
      'members', 'meals', 'invoices', 'contracts', 'tours', 'shifts', 'family']);
    db.prepare("UPDATE users SET permissions = ? WHERE role = 'nurse' AND permissions = ''").run(defaultStaff);
  }

  // 訂單：折扣與點數欄位（商城結帳）
  const oCols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (oCols.length) {
    if (!oCols.includes('subtotal')) db.exec('ALTER TABLE orders ADD COLUMN subtotal INTEGER NOT NULL DEFAULT 0');
    if (!oCols.includes('discount')) db.exec('ALTER TABLE orders ADD COLUMN discount INTEGER NOT NULL DEFAULT 0');
    if (!oCols.includes('points_used')) db.exec('ALTER TABLE orders ADD COLUMN points_used INTEGER NOT NULL DEFAULT 0');
    if (!oCols.includes('points_earned')) db.exec('ALTER TABLE orders ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0');
    if (!oCols.includes('coupon_code')) db.exec("ALTER TABLE orders ADD COLUMN coupon_code TEXT DEFAULT ''");
  }

  // 房型主檔回填：既有部署由現有房間去重帶入（首次上線 room_types 為空時）
  if (db.prepare('SELECT COUNT(*) c FROM room_types').get().c === 0) {
    const rows = db.prepare(`SELECT room_type, MIN(price_per_day) price FROM rooms
      WHERE active = 1 GROUP BY room_type ORDER BY price DESC`).all();
    const ins = db.prepare('INSERT OR IGNORE INTO room_types (name, price, sort) VALUES (?,?,?)');
    rows.forEach((r, i) => ins.run(r.room_type, r.price || 0, i));
  }

  ensureSettings();
  ensureContractTemplate();
}

// 預設定型化合約範本（參考衛福部產後護理機構定型化契約應記載事項精神，可於系統內自由編修）
const DEFAULT_CONTRACT_TEMPLATE = `{{center_name}}　入住服務契約

立契約人
　甲方（服務人）：{{center_name}}
　乙方（消費者）：{{mother_name}}　聯絡電話：{{mother_phone}}

第一條　服務期間與房型
　房型房間：{{room_type}} {{room_name}} 房
　入住日期：{{check_in}}
　退房日期：{{check_out}}
　住宿天數：共 {{days}} 天

第二條　費用與付款
　契約總金額：新臺幣 {{total_amount}} 元整。
　已收訂金：新臺幣 {{deposit}} 元整。
　應補餘額：新臺幣 {{balance}} 元整，乙方應於入住時或雙方約定期日前繳清。

第三條　服務內容
　甲方依產後護理機構相關法令，提供乙方及其新生兒之護理照護、膳食、房務及家屬探視等服務，並依法配置護理人員與遵守人力比規定。

第四條　退費約定
　乙方於入住前或入住期間因故終止契約者，雙方同意依消費者保護法及產後護理機構定型化契約相關規定辦理退費。

第五條　個人資料保護
　甲方為提供服務之必要，於服務期間蒐集、處理及利用乙方與新生兒之個人資料，並依個人資料保護法規定保護之；乙方同意甲方於家屬入口提供照護紀錄予乙方指定之家屬查閱。

第六條　其他約定
　本契約如有未盡事宜，依相關法令及誠信原則辦理。本契約一式二份，雙方各執一份為憑。

簽約日期：{{today}}`;

// 入住同意書
const TPL_ADMISSION = `{{center_name}}　入住同意書

立同意書人（消費者）：{{mother_name}}　聯絡電話：{{mother_phone}}
房型房間：{{room_type}} {{room_name}} 房　入住：{{check_in}}　退房：{{check_out}}

一、本人同意入住{{center_name}}接受產後護理照護服務，並已充分了解服務內容、收費標準與各項規範。
二、本人同意於住宿期間遵守機構各項管理規定，配合護理作業、感染管制與門禁安全措施。
三、本人了解新生兒之照護、餵食、沐浴及醫療協助等，將由合格護理人員依專業判斷執行，必要時協助轉診就醫。
四、本人同意機構於緊急狀況下，為保障母嬰安全得先行必要處置並儘速通知本人或指定家屬。

立同意書人簽名：　　　　　　　　　日期：{{today}}`;

// 個人資料蒐集、處理及利用同意書
const TPL_PRIVACY = `{{center_name}}　個人資料蒐集處理利用同意書

依個人資料保護法第8條規定告知下列事項：

一、蒐集目的：產後護理照護、契約管理、帳務收費、家屬照護資訊揭露、醫療聯繫及法令遵循。
二、個資類別：姓名、聯絡方式、生產與健康相關紀錄、新生兒照護紀錄及影像等。
三、利用期間：自蒐集日起至服務結束後依醫療及相關法令規定之保存期限屆滿為止。
四、利用對象與地區：限{{center_name}}及其委外協力單位於我國境內利用。
五、當事人權利：得向本機構請求查詢、閱覽、複製、補正、停止蒐集處理利用或刪除個人資料。
六、本人同意機構於家屬入口，提供新生兒照護紀錄予本人指定之家屬查閱。

立同意書人：{{mother_name}}　簽名：　　　　　　　　　日期：{{today}}`;

// 母嬰同室同意書
const TPL_ROOMING = `{{center_name}}　母嬰同室同意書

立同意書人（母親）：{{mother_name}}

一、本人了解母嬰同室有助於親子依附關係建立與母乳哺育，亦了解同室期間新生兒主要照護責任由本人承擔，護理人員從旁協助與指導。
二、母嬰同室期間，本人同意遵守安全守則：不與新生兒同床睡眠、避免於疲累時抱餵、注意口鼻不受遮蔽、離房時須將新生兒送回或通知嬰兒室。
三、本人了解可依自身狀況隨時調整母嬰同室時段，夜間或休息需要時得將新生兒送回嬰兒室照護。
四、嬰兒室與母嬰同室之轉換，將由護理人員核對身分辨識並登錄交接時間。

立同意書人簽名：　　　　　　　　　日期：{{today}}`;

// 訪客規範同意書
const TPL_VISITOR = `{{center_name}}　訪客探視規範

為維護產婦休養與新生兒健康安全，敬請訪客配合下列規範：

一、探視時間依機構公告為準，請於規定時段內探視，並於櫃台完成登記與量測體溫。
二、有發燒、咳嗽、腹瀉、皮疹或其他疑似感染症狀者，請勿入內探視。
三、進入嬰兒室及月子房前請依指示落實手部衛生；嬰兒室探視人數與資格依機構規定辦理。
四、請勿任意抱離新生兒、餵食或拍攝他人母嬰；禁止攜帶寵物及未經許可之食品入內。
五、為防範嬰兒辨識錯誤與抱錯事件，新生兒交付一律由護理人員核對身分後辦理。

本人（{{mother_name}}及其家屬）已閱讀並同意遵守上述訪客規範。
簽名：　　　　　　　　　日期：{{today}}`;

const DEFAULT_TEMPLATES = [
  ['入住服務契約（預設範本）', DEFAULT_CONTRACT_TEMPLATE],
  ['入住同意書', TPL_ADMISSION],
  ['個人資料同意書', TPL_PRIVACY],
  ['母嬰同室同意書', TPL_ROOMING],
  ['訪客規範同意書', TPL_VISITOR]
];

function ensureContractTemplate() {
  const ins = db.prepare('INSERT INTO contract_templates (name, body) VALUES (?,?)');
  const has = db.prepare('SELECT COUNT(*) c FROM contract_templates WHERE name = ?');
  for (const [name, body] of DEFAULT_TEMPLATES) {
    if (has.get(name).c === 0) ins.run(name, body);
  }
}

// 營運參數一律存 settings，程式內不得寫死業務數值
const DEFAULT_SETTINGS = {
  center_name: 'MamaCare 產後護理之家',
  nurse_baby_ratio: '5',
  temp_high: '37.5',
  temp_low: '36.0',
  jaundice_alert: '13',
  feed_methods: '親餵,瓶餵母奶,瓶餵配方,混合',
  delivery_types: '自然產,剖腹產',
  // 新生兒觀察類別選項（可自訂）
  skin_options: '紅潤,蒼白,發紺,黃染,紅疹',
  cord_options: '乾燥,滲液,紅腫,異味,已脫落',
  vomit_options: '溢奶,吐奶,噴射狀',
  activity_options: '活躍,正常,嗜睡,虛弱',
  stool_options: '胎便,轉移便,黃稠便,綠便,水樣便,有血絲',
  // 產婦照護評估類別選項（一頁式快速評估用，可自訂）
  wound_options: '乾燥癒合,輕微滲液,紅腫,有分泌物,裂開,無傷口',
  uterus_options: '收縮良好,收縮不良,子宮底壓痛,硬如球',
  breast_options: '柔軟,脹奶,硬塊,乳頭破損,乳腺阻塞,泌乳順暢',
  lochia_options: '紅惡露,漿液性惡露,白惡露,量多,有異味,有血塊',
  mood_options: '穩定愉快,輕微焦慮,情緒低落,易哭泣,睡眠障礙,需轉介',
  elimination_options: '正常,排尿困難,頻尿,便秘,腹瀉,血尿',
  lactation_options: '親餵順利,含乳姿勢需指導,泌乳量不足,塞奶,使用擠乳器,瓶餵',
  education_options: '母乳哺育,新生兒照護,傷口照護,營養衛教,產後運動,情緒支持,返家準備',
  payment_methods: '現金,匯款轉帳,信用卡',
  charge_presets: '月子餐加購,營養品,嬰兒用品,尿布加購,訪客餐',
  meal_choices: '一般餐,素食餐,不需供餐',
  line_channel_access_token: '',
  // 感染管制目標：手部衛生遵從率門檻（%），低於此值於月報標示
  hand_hygiene_target: '85',
  // 電子發票／收據（MIG 3.2）— 實際上傳大平台需加值中心 API
  einvoice_seller_name: 'MamaCare 產後護理之家',
  einvoice_seller_tax_id: '',
  einvoice_tax_type: '3',            // 預設免稅（醫療/護理服務）
  einvoice_tax_rate: '5',
  einvoice_provider: '',             // 加值中心名稱（ecpay/tradevan…），空=僅本地收據
  einvoice_api_url: '',
  einvoice_api_key: '',
  // 收據自動採番：前綴 + 年月 + 流水號（流水號由系統遞增，可隨時重設起始值）
  receipt_prefix: 'R',
  receipt_next_seq: '1',
  // 退費試算參數（依機構定型化契約調整；單位：%）
  refund_handling_fee_pct: '0',      // 退費作業手續費（占已繳金額）
  refund_penalty_pct: '20',          // 未使用天數之違約金上限（占未使用期間費用）
  // 寶寶尚未入住扣抵：媽媽已入住但寶寶尚未到院，每日扣抵金額（元）
  baby_absence_daily_deduct: '1000',
  // 房務清潔：住客需求項目選項、清潔常用任務（逗號分隔）
  hk_need_options: '哺乳衣,定時清垃圾,加床被,補充衛生紙,免洗餐具,訪客接待,勿擾',
  hk_task_presets: '全室清潔,更換床單,浴廁清潔,倒垃圾,補充備品,消毒',
  // 新生兒醫療：常用藥品、給藥途徑、接種部位（快選建議，仍可自行輸入；逗號分隔）
  med_drug_options: '維生素D3,維生素K1,B型肝炎免疫球蛋白,益生菌',
  med_route_options: '口服,肌肉注射(IM),靜脈注射(IV),皮下注射(SC),外用',
  vaccine_site_options: '右大腿,左大腿,右上臂,左上臂',
  // 異常事件：常見發生地點（快選建議）
  incident_location_options: '嬰兒室,母嬰同室房,護理站,浴室,走廊,大廳',
  // 感染管制快選（逗號分隔）
  hh_area_options: '嬰兒室,母嬰同室房,護理站,配奶室,沐浴室',
  hh_role_options: '護理師,護理長,照服員,清潔人員,月嫂',
  disinfect_area_options: '嬰兒室,保溫箱,配奶室,沐浴室,母嬰同室房,公共區域',
  disinfect_agent_options: '1:100漂白水,1:10漂白水,75%酒精,含氯消毒錠,四級銨消毒液',
  // 員工證照快選（逗號分隔）
  cert_name_options: '護理師執照,護士執照,BLS基本救命術,NRP新生兒高級救命術,保母技術士,食品衛生講習',
  cert_issuer_options: '衛生福利部,中華民國護理師護士公會,美國心臟協會(AHA),勞動部勞動力發展署',
  // 醫師巡診快選（逗號分隔）：巡診醫師姓名
  visit_physician_options: '',
  // 會員點數（商城）：每滿 points_earn_per 元回饋 1 點，1 點折抵 points_value 元
  points_enabled: '1',
  points_earn_per: '100',
  points_value: '1',
  // 月子餐：一日餐別、飲食類型、餐期階段（依產後天數）
  meal_slots: '早餐,早點,午餐,午點,晚餐,宵夜',
  meal_diets: '一般,素食',
  meal_stages: '[{"name":"第一階段·排惡露","from":1,"to":7},{"name":"第二階段·補氣血","from":8,"to":14},{"name":"第三階段·健脾胃","from":15,"to":21},{"name":"第四階段·養氣補身","from":22,"to":40}]',
  // 衛福部表單通報介接（空=僅本地產生／匯出，不實際上傳）
  gov_api_url: '',
  gov_api_key: '',
  gov_org_code: '',
  gov_auto_upload: '0',              // 1=產生後自動上傳並於失敗時自動重試補送
  // 員工證照到期提醒天數
  cert_alert_days: '60',
  // 智能照護提醒：距上次餵奶超過幾小時就提醒該餵奶
  feed_interval_hours: '3',
  // 異常即時 LINE 通知值班的目標（LINE userId 或 group/room id；需同時設 line_channel_access_token）
  line_staff_alert_id: '',
  // 退房時自動推滿意度問卷給家屬（需有啟用中的問卷）
  survey_on_checkout: '1',
  // 線上金流（ECPay 綠界）：未設定 merchant_id 則停用
  payment_provider: '',            // 'ecpay' 啟用
  ecpay_merchant_id: '',
  ecpay_hash_key: '',
  ecpay_hash_iv: '',
  ecpay_stage: '1',                // 1=測試環境(stage)，0=正式
  public_base_url: '',             // 對外網址（產生 ReturnURL/ClientBackURL），如 https://mamacare.crownai.ink
  // LINE Webhook 驗簽（雙向訊息 CRM）；line_channel_access_token 共用於推播
  line_channel_secret: '',
  // Facebook Messenger 介接（粉專雙向訊息）
  fb_page_access_token: '',
  fb_app_secret: '',
  fb_verify_token: '',
  // 產後系統其他設定（各選項清單逗號分隔）
  tour_source_options: '親友介紹,員工,產檢得知,網路,路過,官網,FB,友人介紹,其他',
  tour_visit_limit: '1',                 // 每時段預約參觀人數上限
  tour_open_from: '11:00',               // 一般開放參觀時間（起）
  tour_open_to: '19:00',                 // 一般開放參觀時間（迄）
  tour_slot_minutes: '60',               // 每時段分鐘數
  formula_brand_options: '優生A＋,能恩HA,亞培,S-26,雪印,明治,諾貝兒,卡洛塔妮,雀巢無乳,wakodo,亞培親護,新安琪兒,亞培早產兒,A+水解,亞培經典,優生水解,桂格,啟賦,優生奶水,貝比卡兒,固力果,S26水解,韓國奶粉,佑爾康,雀巢寶兒,優生早產,金可貝可,能恩NAN,森永,S26早產兒,Enspire,德國奶粉,瑞士奶粉,好敏瑞,Holle,Hipp,諾優貝,新諾兒,啟賦水解,超級能恩水解,哺力美,啟賦生機,能恩早產兒,美強生純睿,能恩全護',
  // 門燈控制設定：房況狀態 → 色碼（JSON）
  door_light_options: '{"空房":"#057505","入住準備":"#409fff","媽媽入住":"#ff244a","母嬰同室":"#8c0fff","出住打掃":"#e0e070","等待檢查":"#ff9f40","保留":"#f53bd6","維修":"#9e9e9e"}',
  referral_hospital_options: '台大,國泰', // 護理後送醫院清單
  contact_class_options: '配偶,朋友,同事,好朋友,姊妹,父女,母女,婆媳,其他,父母',
  // 出院帶藥藥品設定：藥品種類＋藥品名稱（JSON 陣列）
  discharge_med_options: '[{"cat":"軟便劑","name":"MgO"},{"cat":"止痛劑","name":"Acetaminophen"},{"cat":"抗生素","name":"Amoxicilline"}]',
  discount_class_options: '一般客戶,VIP,舊客回住,員工親友,其他',  // 房價折扣客戶分類
  // 打掃定期工作設定：媽媽房間每 N 天換床單／每 N 天更新備品
  hk_sheet_days: '7',
  hk_supply_days: '1',
  hk_updated_by: '',                     // 打掃定期工作最後異動人
  hk_updated_at: ''                      // 打掃定期工作最後異動時間
};

function ensureSettings() {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
}

function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function setSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) return false;
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(value), key);
  return true;
}

// 紅臀（尿布疹）程度，依序由輕到重；空字串代表未評估／不適用。
// 「輕度」以上視為發生紅臀（計入紅臀率），「中度」以上列入異常事件。
const DIAPER_RASH_LEVELS = ['無', '輕度', '中度', '重度'];
const RASH_OCCURRED = ['輕度', '中度', '重度'];
const RASH_SEVERE = ['中度', '重度'];

function genAccessCode() {
  // 8 碼大寫英數，排除易混淆字元
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

function dateStr(offsetDays = 0) {
  // 以本地時間為準，與 server 端 today() 一致，避免 UTC+8 跨日錯位
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) return false;

  const insUser = db.prepare(
    'INSERT INTO users (username, password_hash, name, role, phone) VALUES (?,?,?,?,?)');
  const adminId = insUser.run('admin', hashPassword('admin123'), '王主任', 'admin', '0912000001').lastInsertRowid;
  const nurse1 = insUser.run('nurse1', hashPassword('nurse123'), '林佳慧', 'nurse', '0912000002').lastInsertRowid;
  const nurse2 = insUser.run('nurse2', hashPassword('nurse123'), '陳怡君', 'nurse', '0912000003').lastInsertRowid;
  const nurse3 = insUser.run('nurse3', hashPassword('nurse123'), '張雅婷', 'nurse', '0912000004').lastInsertRowid;

  const insRoom = db.prepare(
    'INSERT INTO rooms (name, room_type, price_per_day, notes) VALUES (?,?,?,?)');
  const roomIds = [];
  roomIds.push(insRoom.run('101', '標準房', 6800, '').lastInsertRowid);
  roomIds.push(insRoom.run('102', '標準房', 6800, '').lastInsertRowid);
  roomIds.push(insRoom.run('201', '豪華房', 8800, '含客廳').lastInsertRowid);
  roomIds.push(insRoom.run('202', '豪華房', 8800, '含客廳').lastInsertRowid);
  roomIds.push(insRoom.run('301', '總統套房', 12800, '雙陽台').lastInsertRowid);

  const insMother = db.prepare(`INSERT INTO mothers
    (name, phone, due_date, delivery_date, delivery_type, diet_notes, status)
    VALUES (?,?,?,?,?,?,?)`);
  const m1 = insMother.run('李美玲', '0933111222', dateStr(-12), dateStr(-10), '自然產', '不吃牛肉', 'checked_in').lastInsertRowid;
  const m2 = insMother.run('黃淑芬', '0933333444', dateStr(-6), dateStr(-5), '剖腹產', '素食', 'checked_in').lastInsertRowid;
  const m3 = insMother.run('吳佩珊', '0933555666', dateStr(20), '', '', '', 'reserved').lastInsertRowid;

  const insBaby = db.prepare(`INSERT INTO babies
    (mother_id, name, gender, birth_date, birth_weight_g, notes) VALUES (?,?,?,?,?,?)`);
  const b1 = insBaby.run(m1, '小寶', 'male', dateStr(-10), 3120, '').lastInsertRowid;
  const b2 = insBaby.run(m2, '安安', 'female', dateStr(-5), 2980, '輕微黃疸觀察中').lastInsertRowid;

  const insBooking = db.prepare(`INSERT INTO bookings
    (mother_id, room_id, check_in, check_out, deposit, total_amount, status) VALUES (?,?,?,?,?,?,?)`);
  const bk1 = insBooking.run(m1, roomIds[2], dateStr(-8), dateStr(22), 30000, 264000, 'checked_in').lastInsertRowid;
  const bk2 = insBooking.run(m2, roomIds[0], dateStr(-3), dateStr(27), 20000, 204000, 'checked_in').lastInsertRowid;
  insBooking.run(m3, roomIds[4], dateStr(22), dateStr(52), 50000, 384000, 'reserved');

  const insCharge = db.prepare(`INSERT INTO charge_items
    (booking_id, item_name, unit_price, quantity, charged_on, note, created_by) VALUES (?,?,?,?,?,?,?)`);
  insCharge.run(bk1, '營養品', 1200, 2, dateStr(-2), '', adminId);
  insCharge.run(bk1, '訪客餐', 350, 3, dateStr(-1), '家屬探視', nurse1);
  insCharge.run(bk2, '尿布加購', 450, 1, dateStr(-1), '', nurse2);

  const insPay = db.prepare(`INSERT INTO payments
    (booking_id, amount, method, paid_on, note, received_by) VALUES (?,?,?,?,?,?)`);
  insPay.run(bk1, 120000, '匯款轉帳', dateStr(-8), '第一期款', adminId);
  insPay.run(bk2, 100000, '信用卡', dateStr(-3), '第一期款', adminId);

  const insBR = db.prepare(`INSERT INTO baby_records
    (baby_id, nurse_id, record_type, feed_method, amount_ml, diaper_kind, value_num, note, recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const today = dateStr(0);
  const yesterday = dateStr(-1);
  // 今日紀錄（demo 用）
  insBR.run(b1, nurse1, 'feeding', '瓶餵母奶', 90, '', null, '', `${today} 06:10:00`);
  insBR.run(b1, nurse1, 'diaper', '', null, '濕', null, '', `${today} 06:30:00`);
  insBR.run(b1, nurse1, 'temperature', '', null, '', 36.8, '', `${today} 07:00:00`);
  insBR.run(b1, nurse2, 'feeding', '瓶餵母奶', 100, '', null, '', `${today} 09:15:00`);
  insBR.run(b1, nurse2, 'diaper', '', null, '便', null, '黃色軟便', `${today} 09:40:00`);
  insBR.run(b1, nurse2, 'weight', '', null, '', 3260, '', `${today} 10:00:00`);
  insBR.run(b1, nurse2, 'bath', '', null, '', null, '臍帶乾燥', `${today} 10:30:00`);
  insBR.run(b2, nurse1, 'feeding', '親餵', null, '', null, '含乳良好', `${today} 07:20:00`);
  insBR.run(b2, nurse1, 'jaundice', '', null, '', 11.2, '持續觀察', `${today} 08:00:00`);
  insBR.run(b2, nurse1, 'temperature', '', null, '', 37.1, '', `${today} 08:05:00`);
  insBR.run(b2, nurse2, 'feeding', '瓶餵配方', 80, '', null, '', `${today} 11:00:00`);
  // 昨日紀錄
  insBR.run(b1, nurse3, 'feeding', '瓶餵母奶', 90, '', null, '', `${yesterday} 21:00:00`);
  insBR.run(b1, nurse3, 'temperature', '', null, '', 36.9, '', `${yesterday} 22:00:00`);
  insBR.run(b2, nurse3, 'feeding', '瓶餵配方', 70, '', null, '', `${yesterday} 20:30:00`);
  insBR.run(b2, nurse3, 'jaundice', '', null, '', 12.0, '', `${yesterday} 09:00:00`);

  // 紅臀（尿布疹）評估示範：安安昨日輕度、今日中度（中度列入異常事件）
  const insRash = db.prepare(`INSERT INTO baby_records
    (baby_id, nurse_id, record_type, diaper_kind, diaper_rash, note, recorded_at)
    VALUES (?,?,?,?,?,?,?)`);
  insRash.run(b1, nurse1, 'diaper', '便', '無', '', `${today} 13:30:00`);
  insRash.run(b2, nurse3, 'diaper', '濕', '輕度', '臀部微紅，已塗護膚膏', `${yesterday} 14:00:00`);
  insRash.run(b2, nurse1, 'diaper', '便', '中度', '臀部紅疹擴大，加強護理並通知醫師', `${today} 13:50:00`);

  // 寶寶位置：小寶目前抱在媽媽身邊（母嬰同室），安安在嬰兒室
  db.prepare('UPDATE babies SET location = ? WHERE id = ?').run('rooming', b1);
  const insLoc = db.prepare(`INSERT INTO baby_location_logs
    (baby_id, nurse_id, location, note, moved_at) VALUES (?,?,?,?,?)`);
  insLoc.run(b1, nurse1, 'rooming', '媽媽親餵練習', `${today} 09:10:00`);
  insLoc.run(b1, nurse2, 'nursery', '餵食後抱回嬰兒室休息', `${yesterday} 23:00:00`);
  insLoc.run(b1, nurse1, 'rooming', '日間母嬰同室', `${yesterday} 10:00:00`);

  const insMR = db.prepare(`INSERT INTO mother_records
    (mother_id, nurse_id, record_type, value_text, note, recorded_at) VALUES (?,?,?,?,?,?)`);
  insMR.run(m1, nurse1, 'vital', 'BP 112/70, HR 76, T 36.6', '', `${today} 08:00:00`);
  insMR.run(m1, nurse1, 'uterus', '子宮底臍下三指，收縮良好', '', `${today} 08:10:00`);
  insMR.run(m2, nurse1, 'wound', '剖腹傷口乾燥無滲液', '', `${today} 08:30:00`);
  insMR.run(m2, nurse2, 'breast', '雙側乳房柔軟，泌乳順暢', '', `${today} 10:30:00`);

  const insShift = db.prepare(
    'INSERT OR IGNORE INTO shifts (user_id, shift_date, shift_type) VALUES (?,?,?)');
  for (let d = -1; d <= 6; d++) {
    insShift.run(nurse1, dateStr(d), 'day');
    insShift.run(nurse2, dateStr(d), 'evening');
    insShift.run(nurse3, dateStr(d), 'night');
  }
  insShift.run(adminId, dateStr(0), 'day');

  const insHandover = db.prepare(`INSERT INTO handovers
    (nurse_id, shift_type, handover_date, situation, background, assessment, recommendation)
    VALUES (?,?,?,?,?,?,?)`);
  insHandover.run(nurse3, 'night', today,
    '安安夜間哭鬧兩次，餵食後安撫入睡。',
    '出生第五天，黃疸觀察中，昨日經皮黃疸值 12.0。',
    '今晨黃疸值 11.2，呈下降趨勢，進食量正常。',
    '白班續測黃疸值，若超過 13 通知小兒科醫師。');

  const insMeal = db.prepare(
    'INSERT OR IGNORE INTO meal_orders (mother_id, meal_date, meal_type, choice) VALUES (?,?,?,?)');
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    insMeal.run(m1, today, meal, '一般餐');
    insMeal.run(m2, today, meal, '素食餐');
  }

  const insTour = db.prepare(`INSERT INTO tours
    (name, phone, due_date, tour_at, source, status, note) VALUES (?,?,?,?,?,?,?)`);
  insTour.run('林小姐', '0955123456', dateStr(60), `${dateStr(2)} 14:00`, '官網表單', 'scheduled', '想參觀豪華房');
  insTour.run('周小姐', '0966789012', dateStr(45), `${dateStr(-3)} 10:30`, '朋友介紹', 'signed', '已簽約 30 天方案');
  insTour.run('鄭小姐', '0977345678', dateStr(90), `${dateStr(-7)} 15:00`, '網路搜尋', 'lost', '價格考量');

  const insFam = db.prepare(
    'INSERT INTO family_members (baby_id, name, relation, access_code) VALUES (?,?,?,?)');
  insFam.run(b1, '張志明', '爸爸', 'DEMO1234');
  insFam.run(b1, '張王秀蘭', '阿嬤', genAccessCode());
  insFam.run(b2, '劉建宏', '爸爸', genAccessCode());

  // ---- 評鑑相關示範資料：異常事件、感染管制、新生兒醫療、發票 ----
  db.prepare(`INSERT INTO incidents
    (category, severity, occurred_at, location, baby_id, subject, description,
     immediate_action, follow_up, physician_notified, family_notified, status, reported_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'infection', 'minor', `${yesterday} 14:30`, '嬰兒室', b2, '安安（新生兒）',
    '尿布部位紅疹擴大，疑似念珠菌感染。', '清潔患部、塗抹護膚藥膏並通知小兒科醫師評估。',
    '每班觀察並記錄變化，三日後複評。', 1, 1, 'processing', nurse1);

  const insHH = db.prepare(`INSERT INTO hand_hygiene_audits
    (audit_date, area, observed_role, opportunities, compliant, observer_id, note)
    VALUES (?,?,?,?,?,?,?)`);
  insHH.run(yesterday, '嬰兒室', '護理師', 20, 18, adminId, '接觸新生兒前後稽核');
  insHH.run(today, '護理站', '護理師', 15, 14, adminId, '');

  const insDis = db.prepare(`INSERT INTO disinfection_logs
    (disinfect_date, area, agent, operator_id, verified_by, note) VALUES (?,?,?,?,?,?)`);
  insDis.run(today, '嬰兒室環境與保溫箱', '1:100 漂白水擦拭', nurse2, adminId, '每日例行清消');
  insDis.run(yesterday, '月子餐備餐區', '75% 酒精', nurse3, adminId, '');

  const insMar = db.prepare(`INSERT INTO med_administrations
    (baby_id, drug_name, dose, route, ordered_by, scheduled_at, administered_at, status, nurse_id, note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insMar.run(b2, '口服維生素D3', '400 IU', '口服', '林小兒科醫師',
    `${today} 09:00`, `${today} 09:05`, 'given', nurse1, '每日一次');

  const insVac = db.prepare(`INSERT INTO vaccinations
    (baby_id, vaccine, dose_no, administered_at, lot_no, site, status, nurse_id, note)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  insVac.run(b1, 'hepb', '第1劑', `${dateStr(-10)} 12:00`, 'HB2026A', '右大腿', 'done', nurse1, '出生時接種');
  insVac.run(b1, 'bcg', '', '', '', '', 'scheduled', null, '滿月後評估接種');
  insVac.run(b2, 'hepb', '第1劑', `${dateStr(-5)} 10:00`, 'HB2026A', '左大腿', 'done', nurse2, '');

  const insScr = db.prepare(`INSERT INTO newborn_screenings
    (baby_id, screen_type, screened_at, result, follow_up, follow_up_done, nurse_id, note)
    VALUES (?,?,?,?,?,?,?,?)`);
  insScr.run(b1, 'hearing', `${dateStr(-9)} 10:00`, 'pass', '', 1, nurse1, '雙耳通過');
  insScr.run(b1, 'metabolic', `${dateStr(-8)} 09:00`, 'pending', '檢體已送驗，待報告', 0, nurse1, '');
  insScr.run(b2, 'cchd', `${dateStr(-4)} 11:00`, 'pass', '', 1, nurse2, '血氧飽和度正常');
  insScr.run(b2, 'hearing', `${dateStr(-4)} 11:30`, 'refer', '右耳未過，安排複篩', 0, nurse2, '');

  db.prepare(`INSERT INTO phototherapy_logs
    (baby_id, start_at, end_at, bilirubin_before, bilirubin_after, device, nurse_id, note)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    b2, `${yesterday} 20:00`, `${today} 08:00`, 13.5, 11.2, '單面藍光燈', nurse3, '黃疸偏高，醫囑光照治療');

  db.prepare(`INSERT INTO invoices
    (booking_id, doc_type, invoice_number, random_number, invoice_date, invoice_time,
     buyer_name, items, sales_amount, tax_type, tax_amount, total_amount, status, created_by, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    bk1, 'receipt', '', '', dateStr(-8), '14:00', '李美玲',
    JSON.stringify([{ name: '產後護理服務訂金', qty: 1, price: 120000, amount: 120000 }]),
    120000, '3', 0, 120000, 'issued', adminId, '第一期款收據');

  return true;
}

init();

if (process.argv.includes('--seed')) {
  const created = seed();
  console.log(created ? '種子資料建立完成' : '資料庫已有資料，略過種子建立');
}

module.exports = {
  db, hashPassword, verifyPassword, genAccessCode, seed,
  getSettings, setSetting, DEFAULT_SETTINGS,
  DIAPER_RASH_LEVELS, RASH_OCCURRED, RASH_SEVERE
};
