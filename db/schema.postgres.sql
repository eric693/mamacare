-- MamaCare PostgreSQL schema（由 SQLite 自動轉譯，請人工複核）
-- 產生時間：2026-06-29T14:39:41.584Z

BEGIN;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'nurse' CHECK (role IN ('admin','nurse')),
    phone TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , permissions TEXT NOT NULL DEFAULT '');

CREATE TABLE rooms (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    room_type TEXT NOT NULL DEFAULT '標準房',
    price_per_day INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  );

CREATE TABLE mothers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    birth_date TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    delivery_date TEXT DEFAULT '',
    delivery_type TEXT DEFAULT '' ,
    diet_notes TEXT DEFAULT '',
    medical_notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','checked_in','checked_out')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , points INTEGER NOT NULL DEFAULT 0, member_no TEXT DEFAULT '', meal_diet TEXT NOT NULL DEFAULT '一般');

CREATE TABLE babies (
    id SERIAL PRIMARY KEY,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    name TEXT NOT NULL,
    gender TEXT DEFAULT '' CHECK (gender IN ('','male','female')),
    birth_date TEXT DEFAULT '',
    birth_weight_g INTEGER,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , location TEXT NOT NULL DEFAULT 'nursery');

CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    deposit INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','checked_in','checked_out','cancelled')),
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , dunned_at TEXT DEFAULT '');

CREATE TABLE handovers (
    id SERIAL PRIMARY KEY,
    nurse_id INTEGER NOT NULL REFERENCES users(id),
    shift_type TEXT NOT NULL CHECK (shift_type IN ('day','evening','night')),
    handover_date TEXT NOT NULL,
    situation TEXT DEFAULT '',
    background TEXT DEFAULT '',
    assessment TEXT DEFAULT '',
    recommendation TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , follow_up TEXT DEFAULT '', resolved INTEGER NOT NULL DEFAULT 0, resolved_by INTEGER, resolved_at TEXT DEFAULT '');

CREATE TABLE shifts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    shift_date TEXT NOT NULL,
    shift_type TEXT NOT NULL CHECK (shift_type IN ('day','evening','night')),
    UNIQUE(user_id, shift_date, shift_type)
  );

CREATE TABLE family_members (
    id SERIAL PRIMARY KEY,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    name TEXT NOT NULL,
    relation TEXT DEFAULT '',
    access_code TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , line_user_id TEXT NOT NULL DEFAULT '');

CREATE TABLE push_logs (
    id SERIAL PRIMARY KEY,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    report_date TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'portal',
    sent_by INTEGER REFERENCES users(id),
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

CREATE TABLE charge_items (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    item_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    charged_on TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    amount INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT '現金',
    paid_on TEXT NOT NULL,
    note TEXT DEFAULT '',
    received_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE meal_orders (
    id SERIAL PRIMARY KEY,
    mother_id INTEGER NOT NULL REFERENCES mothers(id),
    meal_date TEXT NOT NULL,
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner')),
    choice TEXT NOT NULL DEFAULT '',
    note TEXT DEFAULT '',
    UNIQUE(mother_id, meal_date, meal_type)
  );

CREATE TABLE tours (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    tour_at TEXT NOT NULL,
    source TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','visited','signed','lost')),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE baby_location_logs (
    id SERIAL PRIMARY KEY,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    nurse_id INTEGER REFERENCES users(id),
    location TEXT NOT NULL CHECK (location IN ('nursery','rooming')),
    note TEXT DEFAULT '',
    moved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE contract_templates (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE contracts (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    voided_by INTEGER REFERENCES users(id),
    voided_at TEXT DEFAULT '',
    void_reason TEXT DEFAULT ''
  , replaces_id INTEGER);

CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE incidents (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE hand_hygiene_audits (
    id SERIAL PRIMARY KEY,
    audit_date TEXT NOT NULL,
    area TEXT DEFAULT '',                 -- 嬰兒室/護理站/月子房…
    observed_role TEXT DEFAULT '',        -- 受稽核對象（護理師/清潔/訪客…）
    opportunities INTEGER NOT NULL DEFAULT 0,  -- 觀察手部衛生時機數
    compliant INTEGER NOT NULL DEFAULT 0,      -- 確實執行數
    observer_id INTEGER REFERENCES users(id),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE disinfection_logs (
    id SERIAL PRIMARY KEY,
    disinfect_date TEXT NOT NULL,
    area TEXT NOT NULL,                   -- 區域/設備
    agent TEXT DEFAULT '',               -- 消毒劑/方法
    operator_id INTEGER REFERENCES users(id),   -- 執行人
    verified_by INTEGER REFERENCES users(id),   -- 覆核簽核人
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE cluster_events (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE med_administrations (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE vaccinations (
    id SERIAL PRIMARY KEY,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    vaccine TEXT NOT NULL,               -- hepb_immunoglobulin/hepb/bcg/other
    dose_no TEXT DEFAULT '',
    administered_at TEXT DEFAULT '',
    lot_no TEXT DEFAULT '',
    site TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('scheduled','done','deferred','refused')),
    nurse_id INTEGER REFERENCES users(id),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE newborn_screenings (
    id SERIAL PRIMARY KEY,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    screen_type TEXT NOT NULL,           -- hearing/metabolic/cchd/other
    screened_at TEXT DEFAULT '',
    result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','pass','refer','abnormal')),
    follow_up TEXT DEFAULT '',           -- 複篩/轉介追蹤
    follow_up_done INTEGER NOT NULL DEFAULT 0,
    nurse_id INTEGER REFERENCES users(id),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE phototherapy_logs (
    id SERIAL PRIMARY KEY,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    start_at TEXT NOT NULL,
    end_at TEXT DEFAULT '',
    bilirubin_before DOUBLE PRECISION,
    bilirubin_after DOUBLE PRECISION,
    device TEXT DEFAULT '',
    nurse_id INTEGER REFERENCES users(id),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE invoices (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE family_messages (
    id SERIAL PRIMARY KEY,
    baby_id INTEGER NOT NULL REFERENCES babies(id),
    family_id INTEGER REFERENCES family_members(id),
    sender TEXT NOT NULL CHECK (sender IN ('family','staff')),
    sender_name TEXT DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    staff_id INTEGER REFERENCES users(id),
    read_by_staff INTEGER NOT NULL DEFAULT 0,
    read_by_family INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE products (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , subtotal INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0, points_used INTEGER NOT NULL DEFAULT 0, points_earned INTEGER NOT NULL DEFAULT 0, coupon_code TEXT DEFAULT '');

CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    item_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    amount INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE supplies (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    unit TEXT DEFAULT '',                       -- 單位：包/罐/箱…
    stock INTEGER NOT NULL DEFAULT 0,
    safety_stock INTEGER NOT NULL DEFAULT 0,    -- 安全庫存，低於此值提醒
    note TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , restock_level INTEGER NOT NULL DEFAULT 0);

CREATE TABLE supply_txns (
    id SERIAL PRIMARY KEY,
    supply_id INTEGER NOT NULL REFERENCES supplies(id),
    txn_type TEXT NOT NULL CHECK (txn_type IN ('in','out','adjust')), -- 進貨/領用/盤點
    quantity INTEGER NOT NULL,                  -- 異動數量（in 正、out 正數代表領出、adjust 為調整後差值）
    balance_after INTEGER NOT NULL DEFAULT 0,
    reason TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE programs (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE program_signups (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE coupons (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE meal_menu (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(menu_date, slot, stage, diet)
  );

CREATE TABLE gov_submissions (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(form_type, period)
  );

CREATE TABLE staff_certifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    staff_name TEXT DEFAULT '',              -- 非系統帳號者可手填姓名
    cert_name TEXT NOT NULL,
    cert_no TEXT DEFAULT '',
    issuer TEXT DEFAULT '',
    issued_on TEXT DEFAULT '',
    expires_on TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE surveys (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    questions TEXT NOT NULL DEFAULT '[]',    -- JSON [{type:'rating'|'choice'|'text', label, options?}]
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE survey_responses (
    id SERIAL PRIMARY KEY,
    survey_id INTEGER NOT NULL REFERENCES surveys(id),
    family_id INTEGER REFERENCES family_members(id),
    mother_id INTEGER REFERENCES mothers(id),
    answers TEXT NOT NULL DEFAULT '{}',      -- JSON { 題序: 答案 }
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE crm_contacts (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel, channel_user_id)
  );

CREATE TABLE crm_messages (
    id SERIAL PRIMARY KEY,
    contact_id INTEGER NOT NULL REFERENCES crm_contacts(id),
    direction TEXT NOT NULL CHECK (direction IN ('in','out')),
    text TEXT DEFAULT '',
    msg_type TEXT NOT NULL DEFAULT 'text',
    staff_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE "baby_records" (
        id SERIAL PRIMARY KEY,
        baby_id INTEGER NOT NULL REFERENCES babies(id),
        nurse_id INTEGER REFERENCES users(id),
        record_type TEXT NOT NULL CHECK (record_type IN
          ('feeding','diaper','temperature','weight','jaundice','bath','sleep','photo','note',
           'respiration','heart_rate','spo2','length','head_circ','skin','cord','vomit','activity','stool')),
        feed_method TEXT DEFAULT '',
        amount_ml INTEGER,
        diaper_kind TEXT DEFAULT '',
        value_num DOUBLE PRECISION,
        value_text TEXT DEFAULT '',
        photo_file TEXT DEFAULT '',
        note TEXT DEFAULT '',
        recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        location TEXT DEFAULT '',
        diaper_rash TEXT DEFAULT ''
      );

CREATE TABLE "mother_records" (
        id SERIAL PRIMARY KEY,
        mother_id INTEGER NOT NULL REFERENCES mothers(id),
        nurse_id INTEGER REFERENCES users(id),
        record_type TEXT NOT NULL CHECK (record_type IN
          ('vital','wound','uterus','breast','lochia','mood','education','note',
           'bp','pulse','elimination','lactation','medication')),
        value_text TEXT DEFAULT '',
        note TEXT DEFAULT '',
        recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE testimonials (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT DEFAULT '',          -- 稱號（明星夫妻／資深音樂人…）
    quote TEXT DEFAULT '',          -- 推薦語
    photo TEXT DEFAULT '',          -- /uploads/xxx
    source_url TEXT DEFAULT '',     -- FB／IG 來源連結
    video_url TEXT DEFAULT '',      -- 影片連結
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE payment_intents (
    id SERIAL PRIMARY KEY,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE INDEX idx_charge_items_booking ON charge_items(booking_id);
CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE INDEX idx_baby_location_logs_baby ON baby_location_logs(baby_id, moved_at);
CREATE INDEX idx_contracts_booking ON contracts(booking_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX idx_incidents_occurred ON incidents(occurred_at);
CREATE INDEX idx_hh_date ON hand_hygiene_audits(audit_date);
CREATE INDEX idx_disinfect_date ON disinfection_logs(disinfect_date);
CREATE INDEX idx_mar_baby ON med_administrations(baby_id, administered_at);
CREATE INDEX idx_vacc_baby ON vaccinations(baby_id);
CREATE INDEX idx_screen_baby ON newborn_screenings(baby_id);
CREATE INDEX idx_photo_baby ON phototherapy_logs(baby_id);
CREATE INDEX idx_invoices_booking ON invoices(booking_id);
CREATE INDEX idx_family_msg_baby ON family_messages(baby_id, created_at);
CREATE INDEX idx_products_active ON products(active, sort);
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_supply_txns ON supply_txns(supply_id, created_at);
CREATE INDEX idx_signups_status ON program_signups(status, created_at);
CREATE INDEX idx_meal_menu_date ON meal_menu(menu_date, slot);
CREATE INDEX idx_cert_expires ON staff_certifications(expires_on);
CREATE INDEX idx_survey_resp ON survey_responses(survey_id);
CREATE INDEX idx_crm_msg ON crm_messages(contact_id, id);
CREATE INDEX idx_baby_records_baby ON baby_records(baby_id, recorded_at);
CREATE INDEX idx_mother_records_mother ON mother_records(mother_id, recorded_at);

COMMIT;
