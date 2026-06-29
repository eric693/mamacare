const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const {
  db, hashPassword, verifyPassword, genAccessCode, seed,
  getSettings, setSetting, DEFAULT_SETTINGS,
  DIAPER_RASH_LEVELS, RASH_OCCURRED, RASH_SEVERE
} = require('./db');
const notify = require('./notify');
const { buildWorkbook } = require('./xlsx');
const backup = require('./backup');
const payment = require('./payment');
const dal = require('./dal');
// 非同步路由包裝：捕捉 Promise 例外交給錯誤中介層（Express 4 不會自動接）
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

seed();
if (process.env.NODE_ENV !== 'test') backup.scheduleDaily(); // 啟動補當日備份，之後每日 03:00 自動備份

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

app.set('trust proxy', true); // 經 nginx 反向代理，取真實來源 IP 作為簽署存證
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf; } })); // 簽名 PNG／webhook 驗簽需原始 body
app.use(express.urlencoded({ extended: false, limit: '1mb' })); // 綠界等金流回傳為 x-www-form-urlencoded
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- 稽核軌跡（audit log）----------
const AUDIT_REDACT = new Set([
  'password', 'signature_data', 'signature', 'einvoice_api_key',
  'api_key', 'line_channel_access_token'
]);
const insAudit = db.prepare(`INSERT INTO audit_logs
  (user_id, user_name, role, action, method, entity, entity_id, path, summary, ip, user_agent)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

function logAudit(req, { action, entity, entity_id = '', summary = '' }) {
  const u = (req.session && req.session.user) || {};
  const fam = (req.session && req.session.family) || null;
  insAudit.run(
    u.id || null,
    u.name || (fam ? `家屬:${fam.name}` : '訪客'),
    u.role || (fam ? 'family' : ''),
    action, req.method || '', entity, String(entity_id || ''),
    (req.originalUrl || '').slice(0, 300), String(summary || '').slice(0, 1000),
    req.ip || '', (req.headers['user-agent'] || '').slice(0, 300));
}

function bodySummary(body) {
  if (!body || typeof body !== 'object') return '';
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (AUDIT_REDACT.has(k)) { out[k] = '***'; continue; }
    if (typeof v === 'string' && v.length > 120) out[k] = v.slice(0, 120) + '…';
    else out[k] = v;
  }
  try { return JSON.stringify(out).slice(0, 1000); } catch (e) { return ''; }
}

// 自動記錄所有寫入型 API（POST/PUT/PATCH/DELETE），登入/登出/簽署另行語意化記錄
const AUDIT_SKIP = new Set(['/api/login', '/api/logout', '/api/family/login', '/api/family/logout',
  '/api/webhooks/line', '/api/webhooks/facebook', '/api/webhooks/ecpay']);
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (AUDIT_SKIP.has(req.originalUrl.split('?')[0])) return next();
  if (req.originalUrl.startsWith('/api/sign/')) return next(); // 公開簽署於處理常式內記錄
  const bodySnapshot = bodySummary(req.body);
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const parts = req.path.split('/').filter(p => p && p !== 'api'); // e.g. ['bookings','3','contracts']
    const idSeg = [...parts].reverse().find(p => /^\d+$/.test(p)) || '';
    const entity = parts.filter(p => !/^\d+$/.test(p)).join('/');
    const tail = parts[parts.length - 1];
    let action = req.method === 'POST' ? 'create'
      : req.method === 'DELETE' ? 'delete' : 'update';
    if (['void', 'sign', 'restore', 'status', 'send', 'allowance', 'upload', 'close'].includes(tail)) action = tail;
    logAudit(req, { action, entity, entity_id: idSeg, summary: bodySnapshot });
  });
  next();
});

// ---------- 帳號權限（RBAC） ----------
// 模組清單（key 對應前端 nav 與後端路由群組）；admin 角色恆為全權，不受此限。
const MODULES = [
  { key: 'baby_care', label: '寶寶照護' },
  { key: 'newborn_medical', label: '新生兒醫療' },
  { key: 'mother_care', label: '媽媽照護' },
  { key: 'handover', label: '護理交班' },
  { key: 'incidents', label: '異常事件' },
  { key: 'infection', label: '感染管制' },
  { key: 'residents', label: '住客管理' },
  { key: 'rooms', label: '房務與訂房' },
  { key: 'billing', label: '收費帳務' },
  { key: 'shop', label: '商城商品' },
  { key: 'supplies', label: '耗材庫存' },
  { key: 'programs', label: '課程與服務' },
  { key: 'members', label: '會員' },
  { key: 'meals', label: '膳食／月子餐' },
  { key: 'invoices', label: '電子發票' },
  { key: 'contracts', label: '合約簽署' },
  { key: 'tours', label: '參觀預約' },
  { key: 'shifts', label: '排班與人力' },
  { key: 'family', label: '家屬帳號' },
  { key: 'crm', label: 'LINE／FB 客訊' },
  { key: 'testimonials', label: '名人推薦' },
  { key: 'reports', label: '評鑑月報' },
  { key: 'gov', label: '衛福部通報' },
  { key: 'certifications', label: '員工證照' },
  { key: 'surveys', label: '問卷調查' },
  { key: 'coupons', label: '優惠券' },
  { key: 'audit', label: '稽核軌跡' },
  { key: 'export', label: '資料匯出與備份' },
  { key: 'settings', label: '系統設定' },
  { key: 'users', label: '帳號管理' }
];
const MODULE_KEYS = MODULES.map(m => m.key);
// 路由 → 模組對照（依序比對，先精準後一般）；未命中者視為基礎共用端點，任何登入員工皆可存取
const MODULE_RULES = [
  [/^\/api\/mothers\/\d+\/meal-diet/, 'meals'],
  [/^\/api\/mothers\/\d+\/records/, 'mother_care'],
  [/^\/api\/mother-records/, 'mother_care'],
  [/^\/api\/babies\/\d+\/(meds|screenings|vaccinations|phototherapy)/, 'newborn_medical'],
  [/^\/api\/(meds|screenings|vaccinations|phototherapy)/, 'newborn_medical'],
  [/^\/api\/babies\/\d+\/(records|report|location|photos|trends)/, 'baby_care'],
  [/^\/api\/baby-records/, 'baby_care'],
  [/^\/api\/handovers/, 'handover'],
  [/^\/api\/incidents/, 'incidents'],
  [/^\/api\/infection/, 'infection'],
  [/^\/api\/bookings\/\d+\/contracts/, 'contracts'],
  [/^\/api\/(contracts|contract-templates)/, 'contracts'],
  [/^\/api\/bookings\/\d+\/(billing|charges|payments|refund-quote|dun)/, 'billing'],
  [/^\/api\/(billing|payments|charges)/, 'billing'],
  [/^\/api\/invoices/, 'invoices'],
  [/^\/api\/products/, 'shop'],
  [/^\/api\/orders/, 'shop'],
  [/^\/api\/supplies/, 'supplies'],
  [/^\/api\/(programs|signups)/, 'programs'],
  [/^\/api\/members/, 'members'],
  [/^\/api\/coupons/, 'coupons'],
  [/^\/api\/(meals|meal-menu|meal-plan|meal-config)/, 'meals'],
  [/^\/api\/tours/, 'tours'],
  [/^\/api\/(shifts|staffing-check)/, 'shifts'],
  [/^\/api\/family-members/, 'family'],
  [/^\/api\/crm/, 'crm'],
  [/^\/api\/testimonials/, 'testimonials'],
  [/^\/api\/reports/, 'reports'],
  [/^\/api\/gov/, 'gov'],
  [/^\/api\/certifications/, 'certifications'],
  [/^\/api\/surveys/, 'surveys'],
  [/^\/api\/audit-logs/, 'audit'],
  [/^\/api\/(export|backups)/, 'export'],
  [/^\/api\/users/, 'users'],
  // 住客／房務的「異動」才受限，讀取（GET）開放給所有員工以供跨模組顯示
  [/^\/api\/mothers/, 'residents', 'WRITE'],
  [/^\/api\/(rooms|bookings)/, 'rooms', 'WRITE']
];
function moduleForRequest(method, fullPath) {
  for (const [re, mod, scope] of MODULE_RULES) {
    if (re.test(fullPath)) {
      if (scope === 'WRITE' && (method === 'GET' || method === 'HEAD')) return null;
      return mod;
    }
  }
  return null;
}
function userCan(user, mod) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(mod);
}
app.use('/api', (req, res, next) => {
  const u = req.session && req.session.user;
  if (!u) return next();                  // 未登入或家屬 → 由各路由的 requireStaff/requireFamily 處理
  if (u.role === 'admin') return next();
  const fullPath = req.originalUrl.split('?')[0];
  const mod = moduleForRequest(req.method, fullPath);
  if (!mod || userCan(u, mod)) return next();
  return res.status(403).json({ error: '您沒有「' + (MODULES.find(m => m.key === mod) || {}).label + '」的權限' });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype));
  }
});

// 刪除單一上傳檔（接受裸檔名或 /uploads/xxx；以 basename 防路徑穿越）
function removeUploadFile(ref) {
  if (!ref) return;
  const name = path.basename(String(ref));
  if (!name || name === '.' || name === '..') return;
  fs.unlink(path.join(UPLOAD_DIR, name), () => {}); // 不存在則忽略
}
// 排程清理孤兒檔：每日掃 uploads/，移除未被 products.image / baby_records.photo_file 引用且逾 1 天者
function sweepOrphanUploads() {
  try {
    const referenced = new Set();
    for (const r of db.prepare("SELECT photo_file FROM baby_records WHERE photo_file != ''").all()) referenced.add(path.basename(r.photo_file));
    for (const r of db.prepare("SELECT image FROM products WHERE image != ''").all()) referenced.add(path.basename(r.image));
    for (const r of db.prepare("SELECT photo FROM testimonials WHERE photo != ''").all()) referenced.add(path.basename(r.photo));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 僅刪 1 天前，避開上傳途中
    let removed = 0;
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      if (referenced.has(f)) continue;
      const p = path.join(UPLOAD_DIR, f);
      try { const st = fs.statSync(p); if (st.isFile() && st.mtimeMs < cutoff) { fs.unlinkSync(p); removed++; } } catch (e) { /* 略過 */ }
    }
    if (removed) console.log(`[uploads] 清理孤兒檔 ${removed} 個`);
  } catch (e) { /* 忽略掃描錯誤 */ }
}
setInterval(sweepOrphanUploads, 24 * 60 * 60 * 1000); // 每 24 小時一次（首次於啟動 24h 後）

// ---------- 中介層 ----------
function requireStaff(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: '請先登入' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理員權限' });
  }
  next();
}
function requireFamily(req, res, next) {
  if (!req.session.family) return res.status(401).json({ error: '請先輸入家屬通行碼' });
  next();
}
function today() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// ---------- 機構參數（公開：登入頁需要機構名稱） ----------
app.get('/api/meta', (req, res) => {
  const s = getSettings();
  res.json({ center_name: s.center_name });
});

// 機密設定：非管理員一律遮罩（員工端仍需 /api/settings 取一般選項，故不改成 requireAdmin）
const SECRET_SETTING_KEYS = [
  'line_channel_access_token', 'line_channel_secret',
  'fb_page_access_token', 'fb_app_secret', 'fb_verify_token',
  'einvoice_api_key', 'gov_api_key',
  'ecpay_hash_key', 'ecpay_hash_iv'
];
app.get('/api/settings', requireStaff, (req, res) => {
  const s = getSettings();
  if (req.session.user.role !== 'admin') {
    for (const k of SECRET_SETTING_KEYS) s[k] = s[k] ? '(已設定)' : '';
  }
  res.json(s);
});

app.put('/api/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  const ratio = Number(body.nurse_baby_ratio);
  if (body.nurse_baby_ratio !== undefined && (!Number.isInteger(ratio) || ratio < 1 || ratio > 20)) {
    return res.status(400).json({ error: '人力比需為 1 到 20 的整數' });
  }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (body[key] !== undefined) setSetting(key, body[key]);
  }
  res.json({ ok: true, settings: getSettings() });
});

// ---------- 員工登入 ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username || '');
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  req.session.user = {
    id: user.id, name: user.name, role: user.role,
    permissions: parsePermissions(user.permissions),
    modules: user.role === 'admin' ? MODULE_KEYS : parsePermissions(user.permissions)
  };
  logAudit(req, { action: 'login', entity: 'auth', entity_id: user.id, summary: user.username });
  res.json({ user: req.session.user });
});
function parsePermissions(raw) {
  try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a.filter(k => MODULE_KEYS.includes(k)) : []; }
  catch (e) { return []; }
}

app.post('/api/logout', (req, res) => {
  if (req.session.user) logAudit(req, { action: 'logout', entity: 'auth', entity_id: req.session.user.id });
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// ---------- 總覽 ----------
app.get('/api/dashboard', requireStaff, (req, res) => {
  const d = today();
  const totalRooms = db.prepare('SELECT COUNT(*) c FROM rooms WHERE active = 1').get().c;
  const occupied = db.prepare(`SELECT COUNT(DISTINCT room_id) c FROM bookings WHERE status = 'checked_in'`).get().c;
  const mothersIn = db.prepare(`SELECT COUNT(*) c FROM mothers WHERE status = 'checked_in'`).get().c;
  const babiesIn = db.prepare(`
    SELECT COUNT(*) c FROM babies b JOIN mothers m ON m.id = b.mother_id
    WHERE m.status = 'checked_in'`).get().c;
  const todayBabyRecords = db.prepare(
    `SELECT COUNT(*) c FROM baby_records WHERE date(recorded_at) = ?`).get(d).c;
  const todayMotherRecords = db.prepare(
    `SELECT COUNT(*) c FROM mother_records WHERE date(recorded_at) = ?`).get(d).c;
  const staffing = staffingCheck(d);
  const upcoming = db.prepare(`
    SELECT bk.check_in, m.name AS mother_name, r.name AS room_name
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status = 'reserved' AND bk.check_in >= ?
    ORDER BY bk.check_in LIMIT 5`).all(d);
  const alerts = abnormalRecords(d, d);
  // 未結案的異常／不良事件（評鑑追蹤）
  const openIncidents = db.prepare(
    `SELECT COUNT(*) c FROM incidents WHERE status != 'closed'`).get().c;
  // 待追蹤的新生兒篩檢（複篩／轉介尚未完成）
  const pendingScreenings = db.prepare(
    `SELECT COUNT(*) c FROM newborn_screenings
     WHERE follow_up_done = 0 AND result IN ('pending','refer','abnormal')`).get().c;
  // 進行中訂房的未結帳款（應收 = 合約 + 加購；已收 = 訂金 + 繳費）
  const unpaid = db.prepare(`
    SELECT COUNT(*) c, COALESCE(SUM(balance), 0) total FROM (
      SELECT bk.total_amount
        + COALESCE((SELECT SUM(ci.unit_price * ci.quantity) FROM charge_items ci WHERE ci.booking_id = bk.id), 0)
        - bk.deposit
        - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = bk.id), 0) AS balance
      FROM bookings bk WHERE bk.status IN ('reserved','checked_in')
    ) WHERE balance > 0`).get();
  const tours = db.prepare(`
    SELECT tour_at, name, phone, note FROM tours
    WHERE status = 'scheduled' AND date(tour_at) >= ?
    ORDER BY tour_at LIMIT 5`).all(d);
  // 在住寶寶今日照護狀態：最後餵食、餵食次數、尿布、最後體溫
  const babyStatus = db.prepare(`
    SELECT b.id, b.name, b.location,
      (SELECT MAX(recorded_at) FROM baby_records WHERE baby_id = b.id AND record_type = 'feeding'
        AND date(recorded_at) = ?) AS last_feed_at,
      (SELECT COUNT(*) FROM baby_records WHERE baby_id = b.id AND record_type = 'feeding'
        AND date(recorded_at) = ?) AS feed_count,
      (SELECT COUNT(*) FROM baby_records WHERE baby_id = b.id AND record_type = 'diaper'
        AND diaper_kind = '濕' AND date(recorded_at) = ?) AS diaper_wet,
      (SELECT COUNT(*) FROM baby_records WHERE baby_id = b.id AND record_type = 'diaper'
        AND diaper_kind = '便' AND date(recorded_at) = ?) AS diaper_stool,
      (SELECT value_num FROM baby_records WHERE baby_id = b.id AND record_type = 'temperature'
        AND date(recorded_at) = ? ORDER BY recorded_at DESC LIMIT 1) AS last_temp
    FROM babies b JOIN mothers m ON m.id = b.mother_id
    WHERE m.status = 'checked_in' ORDER BY b.name`).all(d, d, d, d, d);
  // 在住寶寶位置彙總：嬰兒室 / 母嬰同室
  const roomingCount = babyStatus.filter(b => b.location === 'rooming').length;
  const nurseryCount = babyStatus.length - roomingCount;
  // 今日膳食彙總：各餐已訂份數與未訂人數（在住媽媽為基數）
  const mothersInHouse = db.prepare(`
    SELECT COUNT(DISTINCT m.id) c FROM mothers m
    JOIN bookings bk ON bk.mother_id = m.id AND bk.status != 'cancelled'
      AND bk.check_in <= ? AND bk.check_out > ?`).get(d, d).c;
  const mealRow = db.prepare(`
    SELECT COUNT(*) c FROM meal_orders mo
    WHERE mo.meal_date = ? AND mo.meal_type = ? AND mo.choice != '' AND mo.choice != '不需供餐'`);
  const mealsToday = ['breakfast', 'lunch', 'dinner'].map(mt =>
    ({ meal_type: mt, ordered: mealRow.get(d, mt).c }));
  // 近 7 日退房名單
  const checkouts = db.prepare(`
    SELECT bk.check_out, m.name AS mother_name, r.name AS room_name
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status = 'checked_in' AND bk.check_out <= date(?, '+7 days')
    ORDER BY bk.check_out`).all(d);
  // 本月已收款（繳費紀錄合計，不含開帳時的訂金）
  const monthPaid = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) total FROM payments
    WHERE strftime('%Y-%m', paid_on) = ?`).get(d.slice(0, 7)).total;
  // 近 30 天入住率趨勢
  const occupiedOnStmt = db.prepare(`
    SELECT COUNT(DISTINCT room_id) c FROM bookings
    WHERE status != 'cancelled' AND check_in <= ? AND check_out > ?`);
  const occupancyTrend = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(new Date(d).getTime() - i * 86400000).toISOString().slice(0, 10);
    occupancyTrend.push({
      date: day,
      value: totalRooms ? Math.round(occupiedOnStmt.get(day, day).c / totalRooms * 100) : 0
    });
  }
  res.json({
    totalRooms, occupied, mothersIn, babiesIn, todayBabyRecords, todayMotherRecords,
    staffing, upcoming, alerts, open_incidents: openIncidents, pending_screenings: pendingScreenings,
    unpaid_count: unpaid.c, unpaid_total: unpaid.total, tours,
    baby_status: babyStatus, baby_nursery: nurseryCount, baby_rooming: roomingCount,
    meals_today: mealsToday, mothers_in_house: mothersInHouse,
    checkouts, month_paid: monthPaid, occupancy_trend: occupancyTrend
  });
});

// ---------- 媽媽 ----------
app.get('/api/mothers', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM babies b WHERE b.mother_id = m.id) AS baby_count,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in')
        ORDER BY bk.check_in DESC LIMIT 1) AS room_name
    FROM mothers m ORDER BY m.status = 'checked_in' DESC, m.id DESC`).all();
  res.json(rows);
});

app.get('/api/mothers/:id', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT * FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到資料' });
  mother.babies = db.prepare('SELECT * FROM babies WHERE mother_id = ?').all(mother.id);
  mother.bookings = db.prepare(`
    SELECT bk.*, r.name AS room_name, r.room_type FROM bookings bk
    JOIN rooms r ON r.id = bk.room_id WHERE bk.mother_id = ? ORDER BY bk.check_in DESC`).all(mother.id);
  res.json(mother);
});

app.post('/api/mothers', requireStaff, (req, res) => {
  const m = req.body || {};
  if (!m.name) return res.status(400).json({ error: '姓名必填' });
  const info = db.prepare(`INSERT INTO mothers
    (name, phone, due_date, delivery_date, delivery_type, diet_notes, medical_notes, status)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    m.name, m.phone || '', m.due_date || '', m.delivery_date || '',
    m.delivery_type || '', m.diet_notes || '', m.medical_notes || '', m.status || 'reserved');
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/mothers/:id', requireStaff, (req, res) => {
  const m = req.body || {};
  const info = db.prepare(`UPDATE mothers SET
    name = ?, phone = ?, due_date = ?, delivery_date = ?, delivery_type = ?,
    diet_notes = ?, medical_notes = ?, status = ? WHERE id = ?`).run(
    m.name, m.phone || '', m.due_date || '', m.delivery_date || '',
    m.delivery_type || '', m.diet_notes || '', m.medical_notes || '',
    m.status || 'reserved', req.params.id);
  if (!info.changes) return res.status(404).json({ error: '找不到資料' });
  res.json({ ok: true });
});

// ---------- 寶寶 ----------
app.get('/api/babies', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, m.name AS mother_name, m.status AS mother_status
    FROM babies b JOIN mothers m ON m.id = b.mother_id
    ORDER BY m.status = 'checked_in' DESC, b.id DESC`).all();
  res.json(rows);
});

app.post('/api/babies', requireStaff, (req, res) => {
  const b = req.body || {};
  if (!b.mother_id || !b.name) return res.status(400).json({ error: '媽媽與姓名必填' });
  const info = db.prepare(`INSERT INTO babies
    (mother_id, name, gender, birth_date, birth_weight_g, notes) VALUES (?,?,?,?,?,?)`).run(
    b.mother_id, b.name, b.gender || '', b.birth_date || '', b.birth_weight_g || null, b.notes || '');
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/babies/:id', requireStaff, (req, res) => {
  const b = req.body || {};
  const info = db.prepare(`UPDATE babies SET
    name = ?, gender = ?, birth_date = ?, birth_weight_g = ?, notes = ? WHERE id = ?`).run(
    b.name, b.gender || '', b.birth_date || '', b.birth_weight_g || null, b.notes || '', req.params.id);
  if (!info.changes) return res.status(404).json({ error: '找不到資料' });
  res.json({ ok: true });
});

// ---------- 寶寶照護紀錄 ----------
app.get('/api/babies/:id/records', requireStaff, (req, res) => {
  const date = req.query.date || today();
  const rows = db.prepare(`
    SELECT br.*, u.name AS nurse_name FROM baby_records br
    LEFT JOIN users u ON u.id = br.nurse_id
    WHERE br.baby_id = ? AND date(br.recorded_at) = ?
    ORDER BY br.recorded_at DESC`).all(req.params.id, date);
  res.json(rows);
});

app.post('/api/babies/:id/records', requireStaff, (req, res) => {
  const r = req.body || {};
  if (!r.record_type) return res.status(400).json({ error: '紀錄類型必填' });
  if (r.recorded_at && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(r.recorded_at)) {
    return res.status(400).json({ error: '時間格式需為 YYYY-MM-DD HH:MM' });
  }
  const recordedAt = r.recorded_at || new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString().slice(0, 19).replace('T', ' ');
  // 地點未指定時，沿用寶寶目前所在位置（嬰兒室／母嬰同室）
  let location = ['nursery', 'rooming'].includes(r.location) ? r.location : '';
  if (!location) {
    const baby = db.prepare('SELECT location FROM babies WHERE id = ?').get(req.params.id);
    location = baby ? baby.location : '';
  }
  // 紅臀程度僅在換尿布紀錄有意義，且須為合法選項，否則存空字串（未評估）
  const rash = (r.record_type === 'diaper' && DIAPER_RASH_LEVELS.includes(r.diaper_rash))
    ? r.diaper_rash : '';
  const info = db.prepare(`INSERT INTO baby_records
    (baby_id, nurse_id, record_type, feed_method, amount_ml, diaper_kind, diaper_rash, value_num, value_text, note, location, recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    req.params.id, req.session.user.id, r.record_type, r.feed_method || '',
    r.amount_ml || null, r.diaper_kind || '', rash, r.value_num ?? null, (r.value_text || '').slice(0, 200), r.note || '', location, recordedAt);
  maybeAlertAbnormal(req.params.id, r.record_type, r.value_num, recordedAt); // 異常即時通知值班
  res.json({ id: info.lastInsertRowid });
});

// 體溫／黃疸超出設定門檻時，即時推播 LINE 給值班（需設定 token 與 line_staff_alert_id）
function abnormalReason(type, value, s) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (type === 'temperature') {
    if (v >= parseFloat(s.temp_high)) return `體溫偏高 ${v}°C（門檻 ${s.temp_high}）`;
    if (v <= parseFloat(s.temp_low)) return `體溫偏低 ${v}°C（門檻 ${s.temp_low}）`;
  }
  if (type === 'jaundice' && v >= parseFloat(s.jaundice_alert)) return `黃疸值偏高 ${v} mg/dL（門檻 ${s.jaundice_alert}）`;
  return null;
}
function maybeAlertAbnormal(babyId, type, value, recordedAt) {
  try {
    const s = getSettings();
    const reason = abnormalReason(type, value, s);
    if (!reason) return;
    const baby = db.prepare('SELECT b.name, m.name AS mother_name FROM babies b JOIN mothers m ON m.id=b.mother_id WHERE b.id=?').get(babyId);
    const text = `⚠️ 異常警示\n${baby ? baby.name : '寶寶'}（媽媽：${baby ? baby.mother_name : '-'}）\n${reason}\n時間：${recordedAt}\n請值班護理人員確認處置。`;
    const token = (s.line_channel_access_token || '').trim();
    if (token && s.line_staff_alert_id) {
      notify.pushText(token, s.line_staff_alert_id, text).catch(() => {});
    }
  } catch (e) { /* 通知失敗不影響紀錄 */ }
}

app.delete('/api/baby-records/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT photo_file FROM baby_records WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM baby_records WHERE id = ?').run(req.params.id);
  if (row && row.photo_file) {
    fs.unlink(path.join(UPLOAD_DIR, row.photo_file), () => {});
  }
  res.json({ ok: info.changes > 0 });
});

// 編輯寶寶照護紀錄（保留修改軌跡：edited_by/at＋audit_logs 記錄前後值；類型不可改）
app.put('/api/baby-records/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM baby_records WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到紀錄' });
  const r = req.body || {};
  if (r.recorded_at && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(r.recorded_at)) {
    return res.status(400).json({ error: '時間格式需為 YYYY-MM-DD HH:MM' });
  }
  const rash = (cur.record_type === 'diaper' && DIAPER_RASH_LEVELS.includes(r.diaper_rash)) ? r.diaper_rash
    : (r.diaper_rash === undefined ? cur.diaper_rash : cur.diaper_rash);
  db.prepare(`UPDATE baby_records SET feed_method=?, amount_ml=?, diaper_kind=?, diaper_rash=?,
    value_num=?, value_text=?, note=?, recorded_at=?, edited_by=?, edited_at=datetime('now','localtime') WHERE id=?`).run(
    r.feed_method ?? cur.feed_method, r.amount_ml === undefined ? cur.amount_ml : (r.amount_ml || null),
    r.diaper_kind ?? cur.diaper_kind, rash,
    r.value_num === undefined ? cur.value_num : (r.value_num ?? null),
    r.value_text === undefined ? cur.value_text : (r.value_text || ''),
    r.note ?? cur.note, r.recorded_at || cur.recorded_at, req.session.user.id, cur.id);
  logAudit(req, { action: 'update', entity: 'baby_records', entity_id: cur.id,
    summary: `修改${BABY_TYPE_TW[cur.record_type] || cur.record_type}：值「${cur.value_num ?? cur.value_text ?? ''}」→「${r.value_num ?? r.value_text ?? ''}」 備註「${(cur.note || '').slice(0, 20)}」→「${(r.note || '').slice(0, 20)}」` });
  res.json({ ok: true });
});

// ---------- 寶寶位置（嬰兒室／母嬰同室）----------
app.put('/api/babies/:id/location', requireStaff, (req, res) => {
  const loc = req.body && req.body.location;
  if (!['nursery', 'rooming'].includes(loc)) {
    return res.status(400).json({ error: '位置須為 nursery 或 rooming' });
  }
  const baby = db.prepare('SELECT location FROM babies WHERE id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  db.prepare('UPDATE babies SET location = ? WHERE id = ?').run(loc, req.params.id);
  db.prepare(`INSERT INTO baby_location_logs (baby_id, nurse_id, location, note)
    VALUES (?,?,?,?)`).run(req.params.id, req.session.user.id, loc,
    (req.body && req.body.note) || '');
  res.json({ ok: true, location: loc });
});

app.get('/api/babies/:id/location-logs', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT ll.*, u.name AS nurse_name FROM baby_location_logs ll
    LEFT JOIN users u ON u.id = ll.nurse_id
    WHERE ll.baby_id = ? ORDER BY ll.moved_at DESC LIMIT 50`).all(req.params.id);
  res.json(rows);
});

app.post('/api/babies/:id/photos', requireStaff, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請選擇圖片檔案' });
  const info = db.prepare(`INSERT INTO baby_records
    (baby_id, nurse_id, record_type, photo_file, note) VALUES (?,?,?,?,?)`).run(
    req.params.id, req.session.user.id, 'photo', req.file.filename, (req.body && req.body.note) || '');
  res.json({ id: info.lastInsertRowid, file: req.file.filename });
});

// ---------- 寶寶日報 ----------
function buildDailyReport(babyId, date) {
  const baby = db.prepare(`
    SELECT b.*, m.name AS mother_name FROM babies b
    JOIN mothers m ON m.id = b.mother_id WHERE b.id = ?`).get(babyId);
  if (!baby) return null;
  const records = db.prepare(`
    SELECT br.*, u.name AS nurse_name FROM baby_records br
    LEFT JOIN users u ON u.id = br.nurse_id
    WHERE br.baby_id = ? AND date(br.recorded_at) = ?
    ORDER BY br.recorded_at`).all(babyId, date);
  const feedings = records.filter(r => r.record_type === 'feeding');
  const diapers = records.filter(r => r.record_type === 'diaper');
  const temps = records.filter(r => r.record_type === 'temperature');
  const weights = records.filter(r => r.record_type === 'weight');
  const jaundices = records.filter(r => r.record_type === 'jaundice');
  const photos = records.filter(r => r.record_type === 'photo');
  // 當日紅臀最嚴重程度（取輕→重排序最大者；無評估則為 null）
  const rashWorst = diapers.reduce((worst, r) => {
    const idx = DIAPER_RASH_LEVELS.indexOf(r.diaper_rash);
    return idx > worst ? idx : worst;
  }, -1);
  return {
    baby, date, records, photos,
    summary: {
      feed_count: feedings.length,
      feed_total_ml: feedings.reduce((s, r) => s + (r.amount_ml || 0), 0),
      diaper_wet: diapers.filter(r => r.diaper_kind === '濕').length,
      diaper_stool: diapers.filter(r => r.diaper_kind === '便').length,
      rash_worst: rashWorst >= 0 ? DIAPER_RASH_LEVELS[rashWorst] : null,
      temp_latest: temps.length ? temps[temps.length - 1].value_num : null,
      weight_latest_g: weights.length ? weights[weights.length - 1].value_num : null,
      jaundice_latest: jaundices.length ? jaundices[jaundices.length - 1].value_num : null,
      bath_done: records.some(r => r.record_type === 'bath')
    }
  };
}

app.get('/api/babies/:id/report', requireStaff, (req, res) => {
  const report = buildDailyReport(req.params.id, req.query.date || today());
  if (!report) return res.status(404).json({ error: '找不到資料' });
  res.json(report);
});

app.post('/api/babies/:id/report/send', requireStaff, ah(async (req, res) => {
  const date = (req.body && req.body.date) || today();
  const report = buildDailyReport(req.params.id, date);
  if (!report) return res.status(404).json({ error: '找不到資料' });
  const fams = db.prepare(
    'SELECT * FROM family_members WHERE baby_id = ? AND active = 1').all(req.params.id);
  const results = await notify.sendReport(report, fams, getSettings());
  const insLog = db.prepare(
    'INSERT INTO push_logs (baby_id, report_date, channel, sent_by) VALUES (?,?,?,?)');
  for (const r of results.filter(r => r.ok)) {
    insLog.run(req.params.id, date, r.channel, req.session.user.id);
  }
  res.json({
    ok: true,
    recipients: results.length,
    line_sent: results.filter(r => r.channel === 'line' && r.ok).length,
    line_failed: results.filter(r => r.channel === 'line' && !r.ok).length
  });
}));

// 寶寶成長趨勢：每日體重、黃疸最後一筆，與每日餵食彙總
function buildTrends(babyId) {
  const daily = db.prepare(`
    SELECT date(recorded_at) AS d, record_type, value_num
    FROM baby_records
    WHERE baby_id = ? AND record_type IN ('weight','jaundice') AND value_num IS NOT NULL
    ORDER BY recorded_at`).all(babyId);
  const lastPerDay = type => {
    const m = new Map();
    for (const r of daily) if (r.record_type === type) m.set(r.d, r.value_num);
    return [...m.entries()].map(([date, value]) => ({ date, value }));
  };
  const feeds = db.prepare(`
    SELECT date(recorded_at) AS date, COUNT(*) AS count,
           COALESCE(SUM(amount_ml), 0) AS total_ml
    FROM baby_records WHERE baby_id = ? AND record_type = 'feeding'
    GROUP BY date(recorded_at) ORDER BY date`).all(babyId);
  return { weight: lastPerDay('weight'), jaundice: lastPerDay('jaundice'), feeds };
}

app.get('/api/babies/:id/trends', requireStaff, (req, res) => {
  res.json(buildTrends(req.params.id));
});

// ---------- 媽媽照護紀錄 ----------
app.get('/api/mothers/:id/records', requireStaff, (req, res) => {
  const date = req.query.date || today();
  const rows = db.prepare(`
    SELECT mr.*, u.name AS nurse_name FROM mother_records mr
    LEFT JOIN users u ON u.id = mr.nurse_id
    WHERE mr.mother_id = ? AND date(mr.recorded_at) = ?
    ORDER BY mr.recorded_at DESC`).all(req.params.id, date);
  res.json(rows);
});

app.post('/api/mothers/:id/records', requireStaff, (req, res) => {
  const r = req.body || {};
  if (!r.record_type) return res.status(400).json({ error: '紀錄類型必填' });
  const info = db.prepare(`INSERT INTO mother_records
    (mother_id, nurse_id, record_type, value_text, note) VALUES (?,?,?,?,?)`).run(
    req.params.id, req.session.user.id, r.record_type, r.value_text || '', r.note || '');
  res.json({ id: info.lastInsertRowid });
});

// 編輯媽媽照護紀錄（保留修改軌跡）
app.put('/api/mother-records/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM mother_records WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到紀錄' });
  const r = req.body || {};
  db.prepare(`UPDATE mother_records SET value_text=?, note=?, edited_by=?, edited_at=datetime('now','localtime') WHERE id=?`).run(
    r.value_text === undefined ? cur.value_text : (r.value_text || ''),
    r.note ?? cur.note, req.session.user.id, cur.id);
  logAudit(req, { action: 'update', entity: 'mother_records', entity_id: cur.id,
    summary: `修改${MOTHER_TYPE_TW[cur.record_type] || cur.record_type}：「${cur.value_text || ''}」→「${r.value_text || ''}」` });
  res.json({ ok: true });
});
app.delete('/api/mother-records/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM mother_records WHERE id = ?').run(req.params.id);
  res.json({ ok: info.changes > 0 });
});

// ---------- 房務與訂房 ----------
app.get('/api/rooms', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*,
      (SELECT m.name FROM bookings bk JOIN mothers m ON m.id = bk.mother_id
        WHERE bk.room_id = r.id AND bk.status = 'checked_in' LIMIT 1) AS occupant,
      (SELECT bk.check_out FROM bookings bk
        WHERE bk.room_id = r.id AND bk.status = 'checked_in' LIMIT 1) AS occupied_until
    FROM rooms r WHERE r.active = 1 ORDER BY r.name`).all();
  res.json(rows);
});

app.post('/api/rooms', requireAdmin, (req, res) => {
  const r = req.body || {};
  if (!r.name) return res.status(400).json({ error: '房號必填' });
  try {
    const info = db.prepare('INSERT INTO rooms (name, room_type, price_per_day, notes) VALUES (?,?,?,?)')
      .run(r.name, r.room_type || '標準房', r.price_per_day || 0, r.notes || '');
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: '房號重複' });
  }
});

app.get('/api/bookings', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT bk.*, m.name AS mother_name, r.name AS room_name, r.room_type
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status != 'cancelled'
    ORDER BY CASE bk.status WHEN 'checked_in' THEN 0 WHEN 'reserved' THEN 1 ELSE 2 END, bk.check_in`).all();
  res.json(rows);
});

app.post('/api/bookings', requireStaff, (req, res) => {
  const b = req.body || {};
  if (!b.mother_id || !b.room_id || !b.check_in || !b.check_out) {
    return res.status(400).json({ error: '媽媽、房間、入住與退房日期必填' });
  }
  if (b.check_out <= b.check_in) return res.status(400).json({ error: '退房日需晚於入住日' });
  const conflict = db.prepare(`
    SELECT COUNT(*) c FROM bookings
    WHERE room_id = ? AND status IN ('reserved','checked_in')
      AND check_in < ? AND check_out > ?`).get(b.room_id, b.check_out, b.check_in).c;
  if (conflict) return res.status(409).json({ error: '該房間此期間已有訂房' });
  const info = db.prepare(`INSERT INTO bookings
    (mother_id, room_id, check_in, check_out, deposit, total_amount, status, notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    b.mother_id, b.room_id, b.check_in, b.check_out,
    b.deposit || 0, b.total_amount || 0, b.status || 'reserved', b.notes || '');
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/bookings/:id/status', requireStaff, (req, res) => {
  const status = (req.body || {}).status;
  if (!['reserved', 'checked_in', 'checked_out', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: '狀態不正確' });
  }
  const bk = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
  if (status === 'checked_in') {
    db.prepare(`UPDATE mothers SET status = 'checked_in' WHERE id = ?`).run(bk.mother_id);
  } else if (status === 'checked_out') {
    db.prepare(`UPDATE mothers SET status = 'checked_out' WHERE id = ?`).run(bk.mother_id);
    if (bk.status !== 'checked_out') pushCheckoutSurvey(bk.mother_id); // 退房時自動推滿意度問卷
  }
  res.json({ ok: true });
});

// 退房自動推滿意度問卷：留言到家屬端，並（已綁定者）LINE 推播
function pushCheckoutSurvey(motherId) {
  try {
    const s = getSettings();
    if (s.survey_on_checkout !== '1') return;
    const survey = db.prepare('SELECT * FROM surveys WHERE active = 1 ORDER BY id DESC LIMIT 1').get();
    if (!survey) return;
    const fams = db.prepare(`SELECT f.* FROM family_members f JOIN babies b ON b.id = f.baby_id
      WHERE b.mother_id = ? AND f.active = 1`).all(motherId);
    const token = (s.line_channel_access_token || '').trim();
    const text = `感謝您入住${s.center_name || '本中心'}！\n誠摯邀請您撥空填寫「${survey.title}」滿意度問卷，您的回饋是我們進步的動力。\n請至家屬入口的「滿意度問卷」分頁填寫。`;
    const insMsg = db.prepare(`INSERT INTO family_messages (baby_id, family_id, sender, sender_name, body)
      VALUES (?,?,?,?,?)`);
    for (const f of fams) {
      insMsg.run(f.baby_id, f.id, 'staff', '系統', text);
      if (token && f.line_user_id) notify.pushText(token, f.line_user_id, text).catch(() => {});
    }
  } catch (e) { /* 不影響退房流程 */ }
}

// ---------- 收費帳務 ----------

// 單筆訂房的帳務彙總：應收 = 合約總額 + 加購消費；已收 = 訂金 + 繳費；餘額 = 應收 - 已收
const BILLING_SUMS = `
  COALESCE((SELECT SUM(ci.unit_price * ci.quantity) FROM charge_items ci WHERE ci.booking_id = bk.id), 0) AS charges_total,
  COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = bk.id), 0) AS payments_total`;

function withBalance(row) {
  row.total_due = row.total_amount + row.charges_total;
  row.total_paid = row.deposit + row.payments_total;
  row.balance = row.total_due - row.total_paid;
  return row;
}

app.get('/api/billing', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT bk.*, m.name AS mother_name, r.name AS room_name, ${BILLING_SUMS}
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status != 'cancelled'
    ORDER BY CASE bk.status WHEN 'checked_in' THEN 0 WHEN 'reserved' THEN 1 ELSE 2 END, bk.check_in`).all();
  res.json(rows.map(withBalance));
});

// 應收帳款帳齡：以退房日為到期基準，逾期分齡（在住者為未到期）
app.get('/api/billing/aging', requireStaff, (req, res) => {
  const d = today();
  const rows = db.prepare(`
    SELECT bk.*, m.name AS mother_name, m.phone, r.name AS room_name, ${BILLING_SUMS}
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status != 'cancelled'`).all().map(withBalance).filter(b => b.balance > 0);
  const buckets = { current: 0, d30: 0, d60: 0, d60p: 0 };
  for (const b of rows) {
    const overdueDays = b.status === 'checked_out' && b.check_out < d
      ? Math.floor((new Date(d) - new Date(b.check_out)) / 86400000) : 0;
    b.overdue_days = overdueDays;
    b.bucket = overdueDays <= 0 ? 'current' : overdueDays <= 30 ? 'd30' : overdueDays <= 60 ? 'd60' : 'd60p';
    buckets[b.bucket] += b.balance;
  }
  rows.sort((a, b) => b.overdue_days - a.overdue_days || b.balance - a.balance);
  res.json({ date: d, total: rows.reduce((s, b) => s + b.balance, 0), buckets, rows });
});

// 一鍵催收：記錄催收時間，並（已綁定者）以家屬留言＋LINE 提醒餘額
app.post('/api/bookings/:id/dun', requireStaff, (req, res) => {
  const bk = db.prepare(`SELECT bk.*, m.name AS mother_name, ${BILLING_SUMS} FROM bookings bk
    JOIN mothers m ON m.id=bk.mother_id WHERE bk.id=?`).get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  withBalance(bk);
  if (bk.balance <= 0) return res.status(400).json({ error: '此訂房已結清' });
  db.prepare("UPDATE bookings SET dunned_at = datetime('now','localtime') WHERE id = ?").run(bk.id);
  // 通知家屬（留言＋LINE）
  const s = getSettings();
  const text = `${s.center_name || '本中心'} 溫馨提醒：${bk.mother_name} 的住房費用尚有未結餘額 NT$${Number(bk.balance).toLocaleString()}，再麻煩您撥空至櫃檯結清，謝謝！`;
  const token = (s.line_channel_access_token || '').trim();
  let notified = 0;
  for (const f of db.prepare(`SELECT f.* FROM family_members f JOIN babies b ON b.id=f.baby_id WHERE b.mother_id=? AND f.active=1`).all(bk.mother_id)) {
    db.prepare(`INSERT INTO family_messages (baby_id, family_id, sender, sender_name, body) VALUES (?,?,?,?,?)`).run(f.baby_id, f.id, 'staff', '系統', text);
    if (token && f.line_user_id) { notify.pushText(token, f.line_user_id, text).catch(() => {}); notified++; }
  }
  logAudit(req, { action: 'update', entity: 'bookings', entity_id: bk.id, summary: '催收' });
  res.json({ ok: true, notified });
});

// ---------- 線上金流（ECPay 綠界） ----------
function payConfigured() {
  const s = getSettings();
  return s.payment_provider === 'ecpay' && s.ecpay_merchant_id && s.ecpay_hash_key && s.ecpay_hash_iv;
}
app.get('/api/pay/config', requireStaff, (req, res) => res.json({ enabled: !!payConfigured(), provider: getSettings().payment_provider || '' }));

// 建立付款意圖（回傳結帳頁網址，前端開新視窗）
app.post('/api/bookings/:id/payment-intent', requireStaff, (req, res) => {
  if (!payConfigured()) return res.status(400).json({ error: '尚未設定線上金流（系統設定→線上金流）' });
  const bk = db.prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  const amount = Math.round(Number((req.body || {}).amount));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: '金額需大於 0' });
  const tradeNo = 'MC' + Date.now() + crypto.randomBytes(2).toString('hex'); // ≤20 碼英數
  const info = db.prepare(`INSERT INTO payment_intents (booking_id, amount, provider, merchant_trade_no, created_by)
    VALUES (?,?,?,?,?)`).run(bk.id, amount, 'ecpay', tradeNo.slice(0, 20), req.session.user.id);
  res.json({ id: info.lastInsertRowid, merchant_trade_no: tradeNo.slice(0, 20), checkout_url: `/api/pay/${info.lastInsertRowid}/checkout` });
});

// 自動送出表單導向綠界結帳頁
app.get('/api/pay/:id/checkout', requireStaff, (req, res) => {
  const intent = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(req.params.id);
  if (!intent) return res.status(404).send('找不到付款單');
  if (intent.status === 'paid') return res.send('<meta charset="utf-8"><p>此筆款項已完成付款。</p>');
  const s = getSettings();
  if (!payConfigured()) return res.status(400).send('未設定線上金流');
  const baseUrl = (s.public_base_url || '').replace(/\/$/, '');
  const fields = payment.ecpayCheckoutFields({
    merchantId: s.ecpay_merchant_id, hashKey: s.ecpay_hash_key, hashIV: s.ecpay_hash_iv,
    tradeNo: intent.merchant_trade_no, amount: intent.amount,
    tradeDesc: '產後護理服務', itemName: '住房／服務費用',
    returnURL: `${baseUrl}/api/webhooks/ecpay`,
    clientBackURL: `${baseUrl}/pay-done.html`
  });
  const inputs = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '&quot;')}">`).join('');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>導向付款…</title></head>
    <body onload="document.forms[0].submit()"><p>正在前往綠界付款頁面…</p>
    <form method="post" action="${payment.ecpayUrl(s.ecpay_stage === '1')}">${inputs}</form></body></html>`);
});

// 綠界付款結果回傳（伺服器對伺服器，公開）
app.post('/api/webhooks/ecpay', (req, res) => {
  const s = getSettings();
  const p = req.body || {};
  const mac = payment.ecpayCheckMac(p, s.ecpay_hash_key, s.ecpay_hash_iv);
  if (mac !== p.CheckMacValue) return res.send('0|CheckMacValue Error');
  const intent = db.prepare('SELECT * FROM payment_intents WHERE merchant_trade_no = ?').get(p.MerchantTradeNo);
  if (!intent) return res.send('0|Order Not Found');
  if (intent.status !== 'paid' && String(p.RtnCode) === '1') {
    const tx = db.transaction(() => {
      db.prepare("UPDATE payment_intents SET status='paid', trade_no=?, payment_type=?, paid_at=datetime('now','localtime'), raw=? WHERE id=?")
        .run(p.TradeNo || '', p.PaymentType || '', JSON.stringify(p).slice(0, 2000), intent.id);
      db.prepare(`INSERT INTO payments (booking_id, amount, method, paid_on, note, received_by)
        VALUES (?,?,?,?,?,?)`).run(intent.booking_id, intent.amount, '線上刷卡(ECPay)', today(), `綠界交易 ${p.TradeNo || ''}`, intent.created_by);
    });
    tx();
  } else if (String(p.RtnCode) !== '1') {
    db.prepare("UPDATE payment_intents SET status='failed', raw=? WHERE id=?").run(JSON.stringify(p).slice(0, 2000), intent.id);
  }
  res.send('1|OK');
});

app.get('/api/bookings/:id/billing', requireStaff, (req, res) => {
  const bk = db.prepare(`
    SELECT bk.*, m.name AS mother_name, r.name AS room_name, ${BILLING_SUMS}
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.id = ?`).get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  withBalance(bk);
  bk.charges = db.prepare(`
    SELECT ci.*, u.name AS staff_name FROM charge_items ci
    LEFT JOIN users u ON u.id = ci.created_by
    WHERE ci.booking_id = ? ORDER BY ci.charged_on DESC, ci.id DESC`).all(bk.id);
  bk.payments = db.prepare(`
    SELECT p.*, u.name AS staff_name FROM payments p
    LEFT JOIN users u ON u.id = p.received_by
    WHERE p.booking_id = ? ORDER BY p.paid_on DESC, p.id DESC`).all(bk.id);
  res.json(bk);
});

app.post('/api/bookings/:id/charges', requireStaff, (req, res) => {
  const c = req.body || {};
  const price = Number(c.unit_price);
  const qty = Number(c.quantity) || 1;
  if (!c.item_name || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: '項目名稱與單價必填' });
  }
  if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: '數量需為正整數' });
  const bk = db.prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  const info = db.prepare(`INSERT INTO charge_items
    (booking_id, item_name, unit_price, quantity, charged_on, note, created_by)
    VALUES (?,?,?,?,?,?,?)`).run(
    bk.id, c.item_name, Math.round(price), qty, c.charged_on || today(), c.note || '', req.session.user.id);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/charges/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM charge_items WHERE id = ?').run(req.params.id);
  res.json({ ok: info.changes > 0 });
});

app.post('/api/bookings/:id/payments', requireStaff, (req, res) => {
  const p = req.body || {};
  const amount = Number(p.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: '金額需大於 0' });
  const bk = db.prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  const info = db.prepare(`INSERT INTO payments
    (booking_id, amount, method, paid_on, note, received_by) VALUES (?,?,?,?,?,?)`).run(
    bk.id, Math.round(amount), p.method || '現金', p.paid_on || today(), p.note || '', req.session.user.id);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/payments/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
  res.json({ ok: info.changes > 0 });
});

// ---------- 商城：商品與訂單 ----------
// 找出某媽媽目前進行中的訂房（供訂單掛帳用）
function activeBookingForMother(motherId) {
  return db.prepare(`SELECT id FROM bookings WHERE mother_id = ?
    ORDER BY CASE status WHEN 'checked_in' THEN 0 WHEN 'reserved' THEN 1 ELSE 2 END, check_in DESC`).get(motherId);
}

// 員工端：商品列表（含下架）
app.get('/api/products', requireStaff, (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY active DESC, sort, id DESC').all());
});

app.post('/api/products', requireAdmin, (req, res) => {
  const p = req.body || {};
  const price = Number(p.price);
  if (!p.name || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: '品名與售價必填' });
  }
  const info = db.prepare(`INSERT INTO products
    (name, category, price, cost, image, description, track_stock, stock, active, sort, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    p.name, p.category || '', Math.round(price), Math.round(Number(p.cost) || 0),
    p.image || '', p.description || '',
    p.track_stock ? 1 : 0, Math.round(Number(p.stock) || 0),
    p.active === undefined ? 1 : (p.active ? 1 : 0), Math.round(Number(p.sort) || 0),
    req.session.user.id);
  logAudit(req, { action: 'create', entity: 'product', entity_id: info.lastInsertRowid, summary: p.name });
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/products/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到商品' });
  const p = req.body || {};
  const price = p.price === undefined ? cur.price : Number(p.price);
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: '售價不正確' });
  db.prepare(`UPDATE products SET name=?, category=?, price=?, cost=?, image=?, description=?,
    track_stock=?, stock=?, active=?, sort=? WHERE id=?`).run(
    p.name ?? cur.name, p.category ?? cur.category, Math.round(price),
    Math.round(p.cost === undefined ? cur.cost : Number(p.cost) || 0),
    p.image ?? cur.image, p.description ?? cur.description,
    (p.track_stock === undefined ? cur.track_stock : (p.track_stock ? 1 : 0)),
    Math.round(p.stock === undefined ? cur.stock : Number(p.stock) || 0),
    (p.active === undefined ? cur.active : (p.active ? 1 : 0)),
    Math.round(p.sort === undefined ? cur.sort : Number(p.sort) || 0),
    cur.id);
  logAudit(req, { action: 'update', entity: 'product', entity_id: cur.id, summary: p.name || cur.name });
  res.json({ ok: true });
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  const used = db.prepare('SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1').get(req.params.id);
  if (used) {
    // 已有訂單引用：改為下架而非刪除，保留歷史
    db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
    return res.json({ ok: true, downshelved: true });
  }
  const prod = db.prepare('SELECT image FROM products WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (info.changes > 0 && prod) removeUploadFile(prod.image); // 一併刪除商品圖片
  res.json({ ok: info.changes > 0 });
});

app.post('/api/products/:id/image', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請選擇圖片' });
  const old = (db.prepare('SELECT image FROM products WHERE id = ?').get(req.params.id) || {}).image;
  const url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE products SET image = ? WHERE id = ?').run(url, req.params.id);
  if (old && old !== url) removeUploadFile(old); // 換圖時刪除舊檔
  res.json({ image: url });
});

// 訂單列表（員工）
function loadOrder(o) {
  o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(o.id);
  return o;
}
app.get('/api/orders', requireStaff, (req, res) => {
  const status = req.query.status;
  const where = status ? 'WHERE o.status = ?' : '';
  const args = status ? [status] : [];
  const rows = db.prepare(`SELECT o.*, m.name AS mother_name, f.name AS family_name,
    u.name AS staff_name, cu.name AS confirmed_name
    FROM orders o
    LEFT JOIN mothers m ON m.id = o.mother_id
    LEFT JOIN family_members f ON f.id = o.family_id
    LEFT JOIN users u ON u.id = o.created_by
    LEFT JOIN users cu ON cu.id = o.confirmed_by
    ${where} ORDER BY CASE o.status WHEN 'pending' THEN 0 ELSE 1 END, o.created_at DESC`).all(...args);
  res.json(rows.map(loadOrder));
});

// 建立訂單（共用）。items: [{product_id, quantity}]，回傳 order id
// 會員點數參數
function pointSettings() {
  const s = getSettings();
  return {
    enabled: s.points_enabled === '1',
    earnPer: Math.max(1, Number(s.points_earn_per) || 100),
    value: Math.max(0, Number(s.points_value) || 1)
  };
}

// 驗證優惠券，回傳 { coupon, discount }；不合法則 throw。subtotal 為折扣前金額
function evalCoupon(code, subtotal) {
  if (!code) return { coupon: null, discount: 0 };
  const c = db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(String(code).trim().toUpperCase());
  if (!c) throw new Error('優惠券無效');
  const d = today();
  if (c.valid_from && d < c.valid_from) throw new Error('優惠券尚未開始');
  if (c.valid_to && d > c.valid_to) throw new Error('優惠券已過期');
  if (c.usage_limit > 0 && c.used_count >= c.usage_limit) throw new Error('優惠券已用罄');
  if (subtotal < c.min_spend) throw new Error(`需消費滿 ${c.min_spend} 元才能使用`);
  let discount = c.discount_type === 'percent'
    ? Math.floor(subtotal * c.discount_value / 100)
    : c.discount_value;
  if (c.discount_type === 'percent' && c.max_discount > 0) discount = Math.min(discount, c.max_discount);
  discount = Math.min(discount, subtotal);
  return { coupon: c, discount };
}

// 計算訂單金額：商品小計、優惠券折扣、點數折抵，回傳明細
function priceOrder({ items, mother_id, coupon_code, points_used }) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('購物車是空的');
  const getProd = db.prepare('SELECT * FROM products WHERE id = ?');
  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const prod = getProd.get(it.product_id);
    const qty = Math.round(Number(it.quantity) || 0);
    if (!prod) throw new Error('商品不存在');
    if (!prod.active) throw new Error(`「${prod.name}」已下架`);
    if (qty < 1) throw new Error('數量需為正整數');
    if (prod.track_stock && prod.stock < qty) throw new Error(`「${prod.name}」庫存不足（剩 ${prod.stock}）`);
    const amount = prod.price * qty;
    subtotal += amount;
    lines.push({ product_id: prod.id, item_name: prod.name, unit_price: prod.price, quantity: qty, amount });
  }
  const { coupon, discount: couponDiscount } = evalCoupon(coupon_code, subtotal);
  // 點數折抵
  const ps = pointSettings();
  let pointsUsed = 0, pointsDiscount = 0;
  const wantPoints = Math.max(0, Math.floor(Number(points_used) || 0));
  if (wantPoints > 0) {
    if (!ps.enabled) throw new Error('未開放點數折抵');
    const mom = mother_id ? db.prepare('SELECT points FROM mothers WHERE id = ?').get(mother_id) : null;
    const balance = mom ? mom.points : 0;
    if (wantPoints > balance) throw new Error(`點數不足（餘額 ${balance}）`);
    const remaining = subtotal - couponDiscount;
    const maxRedeemable = ps.value > 0 ? Math.floor(remaining / ps.value) : 0;
    pointsUsed = Math.min(wantPoints, maxRedeemable);
    pointsDiscount = pointsUsed * ps.value;
  }
  const discount = couponDiscount + pointsDiscount;
  const total = Math.max(0, subtotal - discount);
  const pointsEarned = ps.enabled ? Math.floor(total / ps.earnPer) : 0;
  return { lines, subtotal, couponDiscount, pointsUsed, pointsDiscount, discount, total, pointsEarned, coupon };
}

function createOrder({ items, mother_id, booking_id, placed_by, family_id, created_by, note, coupon_code, points_used }) {
  const calc = priceOrder({ items, mother_id, coupon_code, points_used });
  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO orders
      (booking_id, mother_id, placed_by, family_id, created_by, status, subtotal, discount, points_used, points_earned, coupon_code, total_amount, note)
      VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?,?)`).run(
      booking_id || null, mother_id || null, placed_by, family_id || null, created_by || null,
      calc.subtotal, calc.discount, calc.pointsUsed, calc.pointsEarned,
      calc.coupon ? calc.coupon.code : '', calc.total, note || '');
    const oid = info.lastInsertRowid;
    const insItem = db.prepare(`INSERT INTO order_items
      (order_id, product_id, item_name, unit_price, quantity, amount) VALUES (?,?,?,?,?,?)`);
    for (const l of calc.lines) insItem.run(oid, l.product_id, l.item_name, l.unit_price, l.quantity, l.amount);
    // 立即保留：扣會員點數、增加優惠券使用次數（取消時退回）
    if (calc.pointsUsed > 0) db.prepare('UPDATE mothers SET points = points - ? WHERE id = ?').run(calc.pointsUsed, mother_id);
    if (calc.coupon) db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(calc.coupon.id);
    return oid;
  });
  return tx();
}

// 商城結帳試算（不建立訂單）
app.post('/api/orders/quote', requireStaff, (req, res) => {
  try { res.json(quotePublic(priceOrder(req.body || {}))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
function quotePublic(c) {
  return { subtotal: c.subtotal, coupon_discount: c.couponDiscount, points_used: c.pointsUsed,
    points_discount: c.pointsDiscount, discount: c.discount, total: c.total, points_earned: c.pointsEarned };
}

// 員工代客下單
app.post('/api/orders', requireStaff, (req, res) => {
  const b = req.body || {};
  const mother = b.mother_id ? db.prepare('SELECT id FROM mothers WHERE id = ?').get(b.mother_id) : null;
  if (!mother) return res.status(400).json({ error: '請選擇媽媽' });
  const bk = activeBookingForMother(mother.id);
  try {
    const oid = createOrder({
      items: b.items, mother_id: mother.id, booking_id: bk ? bk.id : null,
      placed_by: 'staff', created_by: req.session.user.id, note: b.note,
      coupon_code: b.coupon_code, points_used: b.points_used
    });
    logAudit(req, { action: 'create', entity: 'order', entity_id: oid, summary: '代客下單' });
    res.json({ id: oid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// 確認訂單：扣庫存 ＋ 寫入訂房加購（charge_items），接上收費帳務
app.post('/api/orders/:id/confirm', requireStaff, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: '找不到訂單' });
  if (o.status !== 'pending') return res.status(400).json({ error: '訂單已處理過' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  const bookingId = o.booking_id || (o.mother_id ? (activeBookingForMother(o.mother_id) || {}).id : null);
  try {
    const tx = db.transaction(() => {
      for (const it of items) {
        if (it.product_id) {
          const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
          if (prod && prod.track_stock) {
            if (prod.stock < it.quantity) throw new Error(`「${prod.name}」庫存不足`);
            db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(it.quantity, prod.id);
          }
        }
        if (bookingId) {
          db.prepare(`INSERT INTO charge_items
            (booking_id, item_name, unit_price, quantity, charged_on, note, created_by)
            VALUES (?,?,?,?,?,?,?)`).run(
            bookingId, it.item_name, it.unit_price, it.quantity, today(),
            `商城訂單#${o.id}`, req.session.user.id);
        }
      }
      // 折扣（優惠券＋點數）以負數加購列入帳
      if (bookingId && o.discount > 0) {
        const parts = [];
        if (o.coupon_code) parts.push(`優惠券 ${o.coupon_code}`);
        if (o.points_used > 0) parts.push(`點數 ${o.points_used} 點`);
        db.prepare(`INSERT INTO charge_items
          (booking_id, item_name, unit_price, quantity, charged_on, note, created_by)
          VALUES (?,?,?,?,?,?,?)`).run(
          bookingId, '商城優惠折抵', -o.discount, 1, today(),
          `商城訂單#${o.id}（${parts.join('、')}）`, req.session.user.id);
      }
      // 回饋點數給會員（媽媽）
      if (o.mother_id && o.points_earned > 0) {
        db.prepare('UPDATE mothers SET points = points + ? WHERE id = ?').run(o.points_earned, o.mother_id);
      }
      db.prepare(`UPDATE orders SET status='confirmed', booking_id=?, confirmed_by=?, confirmed_at=datetime('now','localtime') WHERE id=?`)
        .run(bookingId || null, req.session.user.id, o.id);
    });
    tx();
    logAudit(req, { action: 'update', entity: 'order', entity_id: o.id, summary: '確認訂單' });
    res.json({ ok: true, charged: !!bookingId });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/orders/:id/cancel', requireStaff, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: '找不到訂單' });
  if (o.status !== 'pending') return res.status(400).json({ error: '訂單已處理過，無法取消' });
  const tx = db.transaction(() => {
    // 退回保留的點數與優惠券使用次數
    if (o.mother_id && o.points_used > 0) db.prepare('UPDATE mothers SET points = points + ? WHERE id = ?').run(o.points_used, o.mother_id);
    if (o.coupon_code) db.prepare('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?').run(o.coupon_code);
    db.prepare("UPDATE orders SET status='cancelled', confirmed_by=?, confirmed_at=datetime('now','localtime') WHERE id=?")
      .run(req.session.user.id, o.id);
  });
  tx();
  logAudit(req, { action: 'update', entity: 'order', entity_id: o.id, summary: '取消訂單' });
  res.json({ ok: true });
});

// 家屬端商城：僅顯示上架商品
app.get('/api/family/products', requireFamily, (req, res) => {
  res.json(db.prepare(`SELECT id, name, category, price, image, description, track_stock, stock
    FROM products WHERE active = 1 ORDER BY sort, id DESC`).all());
});

function familyMotherId(fam) {
  const baby = db.prepare('SELECT mother_id FROM babies WHERE id = ?').get(fam.baby_id);
  return baby ? baby.mother_id : null;
}

// 家屬會員資訊（會員編號、點數、回饋規則）
app.get('/api/family/member', requireFamily, (req, res) => {
  const mid = familyMotherId(req.session.family);
  const mom = mid ? db.prepare('SELECT member_no, points FROM mothers WHERE id = ?').get(mid) : null;
  const ps = pointSettings();
  res.json({
    member_no: mom ? mom.member_no : '', points: mom ? mom.points : 0,
    points_enabled: ps.enabled, points_value: ps.value, points_earn_per: ps.earnPer
  });
});

// 家屬結帳試算
app.post('/api/family/orders/quote', requireFamily, (req, res) => {
  const mid = familyMotherId(req.session.family);
  try { res.json(quotePublic(priceOrder({ ...(req.body || {}), mother_id: mid }))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// 家屬下單
app.post('/api/family/orders', requireFamily, (req, res) => {
  const fam = req.session.family;
  const mid = familyMotherId(fam);
  if (!mid) return res.status(400).json({ error: '找不到寶寶資料' });
  const bk = activeBookingForMother(mid);
  const b = req.body || {};
  try {
    const oid = createOrder({
      items: b.items, mother_id: mid, booking_id: bk ? bk.id : null,
      placed_by: 'family', family_id: fam.id, note: b.note,
      coupon_code: b.coupon_code, points_used: b.points_used
    });
    logAudit(req, { action: 'create', entity: 'order', entity_id: oid, summary: `家屬下單:${fam.name}` });
    res.json({ id: oid, message: '訂單已送出，將由護理站確認' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// 家屬查看自己的訂單
app.get('/api/family/orders', requireFamily, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE family_id = ? ORDER BY created_at DESC').all(req.session.family.id);
  res.json(rows.map(loadOrder));
});

// ---------- 耗材進銷存 ----------
app.get('/api/supplies', requireStaff, (req, res) => {
  res.json(db.prepare('SELECT * FROM supplies ORDER BY active DESC, (stock <= safety_stock) DESC, category, name').all());
});
app.post('/api/supplies', requireAdmin, (req, res) => {
  const s = req.body || {};
  if (!s.name) return res.status(400).json({ error: '品名必填' });
  const info = db.prepare(`INSERT INTO supplies (name, category, unit, stock, safety_stock, restock_level, note, active)
    VALUES (?,?,?,?,?,?,?,1)`).run(
    s.name, s.category || '', s.unit || '', Math.round(Number(s.stock) || 0),
    Math.round(Number(s.safety_stock) || 0), Math.round(Number(s.restock_level) || 0), s.note || '');
  logAudit(req, { action: 'create', entity: 'supply', entity_id: info.lastInsertRowid, summary: s.name });
  res.json({ id: info.lastInsertRowid });
});

// 低水位採購（叫貨）單：庫存 ≤ 安全庫存者，建議補到目標補貨量（未設則安全庫存兩倍）
app.get('/api/supplies/purchase-order', requireStaff, (req, res) => {
  const rows = db.prepare('SELECT * FROM supplies WHERE active = 1 AND stock <= safety_stock ORDER BY category, name').all();
  const items = rows.map(s => {
    const target = s.restock_level > 0 ? s.restock_level : s.safety_stock * 2;
    return { id: s.id, name: s.name, category: s.category, unit: s.unit, stock: s.stock,
      safety_stock: s.safety_stock, target, suggest_qty: Math.max(1, target - s.stock) };
  });
  res.json({ date: today(), center_name: getSettings().center_name || '', items });
});
app.put('/api/supplies/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM supplies WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到耗材' });
  const s = req.body || {};
  db.prepare(`UPDATE supplies SET name=?, category=?, unit=?, safety_stock=?, restock_level=?, note=?, active=? WHERE id=?`).run(
    s.name ?? cur.name, s.category ?? cur.category, s.unit ?? cur.unit,
    Math.round(s.safety_stock === undefined ? cur.safety_stock : Number(s.safety_stock) || 0),
    Math.round(s.restock_level === undefined ? cur.restock_level : Number(s.restock_level) || 0),
    s.note ?? cur.note, (s.active === undefined ? cur.active : (s.active ? 1 : 0)), cur.id);
  res.json({ ok: true });
});
app.delete('/api/supplies/:id', requireAdmin, (req, res) => {
  const used = db.prepare('SELECT 1 FROM supply_txns WHERE supply_id = ? LIMIT 1').get(req.params.id);
  if (used) { db.prepare('UPDATE supplies SET active = 0 WHERE id = ?').run(req.params.id); return res.json({ ok: true, deactivated: true }); }
  db.prepare('DELETE FROM supplies WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
// 庫存異動：進貨 in / 領用 out / 盤點 adjust（adjust 時 quantity 為盤點後實際數量）
app.post('/api/supplies/:id/txns', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM supplies WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到耗材' });
  const t = req.body || {};
  const qty = Math.round(Number(t.quantity));
  if (!['in', 'out', 'adjust'].includes(t.txn_type)) return res.status(400).json({ error: '異動類型不正確' });
  if (!Number.isFinite(qty)) return res.status(400).json({ error: '數量不正確' });
  let delta, balance;
  if (t.txn_type === 'in') { if (qty <= 0) return res.status(400).json({ error: '進貨數量需大於 0' }); delta = qty; balance = cur.stock + qty; }
  else if (t.txn_type === 'out') {
    if (qty <= 0) return res.status(400).json({ error: '領用數量需大於 0' });
    if (cur.stock < qty) return res.status(400).json({ error: `庫存不足（剩 ${cur.stock}）` });
    delta = qty; balance = cur.stock - qty;
  } else { if (qty < 0) return res.status(400).json({ error: '盤點數量不可為負' }); balance = qty; delta = qty; }
  const tx = db.transaction(() => {
    db.prepare('UPDATE supplies SET stock = ? WHERE id = ?').run(balance, cur.id);
    db.prepare(`INSERT INTO supply_txns (supply_id, txn_type, quantity, balance_after, reason, note, created_by)
      VALUES (?,?,?,?,?,?,?)`).run(cur.id, t.txn_type, delta, balance, t.reason || '', t.note || '', req.session.user.id);
  });
  tx();
  res.json({ ok: true, stock: balance });
});
app.get('/api/supplies/:id/txns', requireStaff, (req, res) => {
  res.json(db.prepare(`SELECT st.*, u.name AS staff_name FROM supply_txns st
    LEFT JOIN users u ON u.id = st.created_by WHERE st.supply_id = ? ORDER BY st.id DESC LIMIT 100`).all(req.params.id));
});

// ---------- 課程／服務與報名 ----------
app.get('/api/programs', requireStaff, (req, res) => {
  res.json(db.prepare('SELECT * FROM programs ORDER BY active DESC, kind, scheduled_at, id DESC').all());
});
app.post('/api/programs', requireAdmin, (req, res) => {
  const p = req.body || {};
  if (!p.name) return res.status(400).json({ error: '名稱必填' });
  const info = db.prepare(`INSERT INTO programs
    (kind, name, category, price, capacity, scheduled_at, location, description, active, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    p.kind === 'service' ? 'service' : 'course', p.name, p.category || '',
    Math.round(Number(p.price) || 0), Math.round(Number(p.capacity) || 0),
    p.scheduled_at || '', p.location || '', p.description || '',
    p.active === undefined ? 1 : (p.active ? 1 : 0), req.session.user.id);
  logAudit(req, { action: 'create', entity: 'program', entity_id: info.lastInsertRowid, summary: p.name });
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/programs/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM programs WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到項目' });
  const p = req.body || {};
  db.prepare(`UPDATE programs SET kind=?, name=?, category=?, price=?, capacity=?, scheduled_at=?, location=?, description=?, active=? WHERE id=?`).run(
    p.kind === undefined ? cur.kind : (p.kind === 'service' ? 'service' : 'course'),
    p.name ?? cur.name, p.category ?? cur.category,
    Math.round(p.price === undefined ? cur.price : Number(p.price) || 0),
    Math.round(p.capacity === undefined ? cur.capacity : Number(p.capacity) || 0),
    p.scheduled_at ?? cur.scheduled_at, p.location ?? cur.location, p.description ?? cur.description,
    (p.active === undefined ? cur.active : (p.active ? 1 : 0)), cur.id);
  res.json({ ok: true });
});
app.delete('/api/programs/:id', requireAdmin, (req, res) => {
  const used = db.prepare('SELECT 1 FROM program_signups WHERE program_id = ? LIMIT 1').get(req.params.id);
  if (used) { db.prepare('UPDATE programs SET active = 0 WHERE id = ?').run(req.params.id); return res.json({ ok: true, deactivated: true }); }
  db.prepare('DELETE FROM programs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
// 已確認報名人數
function programConfirmedCount(pid) {
  return db.prepare("SELECT COALESCE(SUM(quantity),0) c FROM program_signups WHERE program_id = ? AND status = 'confirmed'").get(pid).c;
}
function loadSignup(s) { return s; }
app.get('/api/signups', requireStaff, (req, res) => {
  const status = req.query.status;
  const where = status ? 'WHERE s.status = ?' : '';
  const args = status ? [status] : [];
  res.json(db.prepare(`SELECT s.*, p.name AS program_name, p.kind, p.scheduled_at, m.name AS mother_name,
    f.name AS family_name, u.name AS staff_name
    FROM program_signups s JOIN programs p ON p.id = s.program_id
    LEFT JOIN mothers m ON m.id = s.mother_id
    LEFT JOIN family_members f ON f.id = s.family_id
    LEFT JOIN users u ON u.id = s.created_by
    ${where} ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC`).all(...args));
});
function createSignup({ program_id, mother_id, booking_id, family_id, placed_by, quantity, preferred_at, note, created_by }) {
  const prog = db.prepare('SELECT * FROM programs WHERE id = ?').get(program_id);
  if (!prog) throw new Error('找不到課程／服務');
  if (!prog.active) throw new Error('此項目已停止報名');
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  if (prog.capacity > 0 && programConfirmedCount(prog.id) + qty > prog.capacity) throw new Error('名額已滿');
  const info = db.prepare(`INSERT INTO program_signups
    (program_id, mother_id, booking_id, family_id, placed_by, quantity, preferred_at, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    prog.id, mother_id || null, booking_id || null, family_id || null, placed_by, qty,
    preferred_at || '', note || '', created_by || null);
  return info.lastInsertRowid;
}
app.post('/api/signups', requireStaff, (req, res) => {
  const b = req.body || {};
  const mother = b.mother_id ? db.prepare('SELECT id FROM mothers WHERE id = ?').get(b.mother_id) : null;
  if (!mother) return res.status(400).json({ error: '請選擇媽媽' });
  const bk = activeBookingForMother(mother.id);
  try {
    const id = createSignup({ ...b, mother_id: mother.id, booking_id: bk ? bk.id : null, placed_by: 'staff', created_by: req.session.user.id });
    logAudit(req, { action: 'create', entity: 'signup', entity_id: id, summary: '代客報名' });
    res.json({ id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/signups/:id/confirm', requireStaff, (req, res) => {
  const s = db.prepare('SELECT * FROM program_signups WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '找不到報名' });
  if (s.status !== 'pending') return res.status(400).json({ error: '已處理過' });
  const prog = db.prepare('SELECT * FROM programs WHERE id = ?').get(s.program_id);
  if (prog.capacity > 0 && programConfirmedCount(prog.id) + s.quantity > prog.capacity) return res.status(400).json({ error: '名額已滿' });
  const bookingId = s.booking_id || (s.mother_id ? (activeBookingForMother(s.mother_id) || {}).id : null);
  const tx = db.transaction(() => {
    if (bookingId && prog.price > 0) {
      db.prepare(`INSERT INTO charge_items (booking_id, item_name, unit_price, quantity, charged_on, note, created_by)
        VALUES (?,?,?,?,?,?,?)`).run(bookingId, `${prog.kind === 'service' ? '服務' : '課程'}：${prog.name}`,
        prog.price, s.quantity, today(), `報名#${s.id}`, req.session.user.id);
    }
    db.prepare("UPDATE program_signups SET status='confirmed', booking_id=?, confirmed_by=?, confirmed_at=datetime('now','localtime') WHERE id=?")
      .run(bookingId || null, req.session.user.id, s.id);
  });
  tx();
  logAudit(req, { action: 'update', entity: 'signup', entity_id: s.id, summary: '確認報名' });
  res.json({ ok: true, charged: !!bookingId });
});
app.post('/api/signups/:id/cancel', requireStaff, (req, res) => {
  const s = db.prepare('SELECT * FROM program_signups WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '找不到報名' });
  if (s.status !== 'pending') return res.status(400).json({ error: '已處理過，無法取消' });
  db.prepare("UPDATE program_signups SET status='cancelled', confirmed_by=?, confirmed_at=datetime('now','localtime') WHERE id=?")
    .run(req.session.user.id, s.id);
  res.json({ ok: true });
});
// 家屬端：課程／服務瀏覽與報名
app.get('/api/family/programs', requireFamily, (req, res) => {
  const rows = db.prepare("SELECT * FROM programs WHERE active = 1 ORDER BY kind, scheduled_at, id DESC").all();
  res.json(rows.map(p => ({
    id: p.id, kind: p.kind, name: p.name, category: p.category, price: p.price,
    scheduled_at: p.scheduled_at, location: p.location, description: p.description,
    capacity: p.capacity, seats_left: p.capacity > 0 ? Math.max(0, p.capacity - programConfirmedCount(p.id)) : null
  })));
});
app.post('/api/family/signups', requireFamily, (req, res) => {
  const fam = req.session.family;
  const mid = familyMotherId(fam);
  if (!mid) return res.status(400).json({ error: '找不到寶寶資料' });
  const bk = activeBookingForMother(mid);
  const b = req.body || {};
  try {
    const id = createSignup({ program_id: b.program_id, mother_id: mid, booking_id: bk ? bk.id : null,
      family_id: fam.id, placed_by: 'family', quantity: b.quantity, preferred_at: b.preferred_at, note: b.note });
    logAudit(req, { action: 'create', entity: 'signup', entity_id: id, summary: `家屬報名:${fam.name}` });
    res.json({ id, message: '已送出報名，將由護理站確認' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/family/signups', requireFamily, (req, res) => {
  res.json(db.prepare(`SELECT s.*, p.name AS program_name, p.kind, p.scheduled_at
    FROM program_signups s JOIN programs p ON p.id = s.program_id
    WHERE s.family_id = ? ORDER BY s.created_at DESC`).all(req.session.family.id));
});

// ---------- 優惠券 ----------
app.get('/api/coupons', requireStaff, (req, res) => {
  res.json(db.prepare('SELECT * FROM coupons ORDER BY active DESC, id DESC').all());
});
app.post('/api/coupons', requireAdmin, (req, res) => {
  const c = req.body || {};
  const code = (c.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: '優惠碼必填' });
  if (db.prepare('SELECT 1 FROM coupons WHERE code = ?').get(code)) return res.status(400).json({ error: '優惠碼已存在' });
  const info = db.prepare(`INSERT INTO coupons
    (code, name, discount_type, discount_value, min_spend, max_discount, usage_limit, valid_from, valid_to, active)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    code, c.name || '', c.discount_type === 'percent' ? 'percent' : 'amount',
    Math.round(Number(c.discount_value) || 0), Math.round(Number(c.min_spend) || 0),
    Math.round(Number(c.max_discount) || 0), Math.round(Number(c.usage_limit) || 0),
    c.valid_from || '', c.valid_to || '', c.active === undefined ? 1 : (c.active ? 1 : 0));
  logAudit(req, { action: 'create', entity: 'coupon', entity_id: info.lastInsertRowid, summary: code });
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/coupons/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到優惠券' });
  const c = req.body || {};
  db.prepare(`UPDATE coupons SET name=?, discount_type=?, discount_value=?, min_spend=?, max_discount=?, usage_limit=?, valid_from=?, valid_to=?, active=? WHERE id=?`).run(
    c.name ?? cur.name, c.discount_type === undefined ? cur.discount_type : (c.discount_type === 'percent' ? 'percent' : 'amount'),
    Math.round(c.discount_value === undefined ? cur.discount_value : Number(c.discount_value) || 0),
    Math.round(c.min_spend === undefined ? cur.min_spend : Number(c.min_spend) || 0),
    Math.round(c.max_discount === undefined ? cur.max_discount : Number(c.max_discount) || 0),
    Math.round(c.usage_limit === undefined ? cur.usage_limit : Number(c.usage_limit) || 0),
    c.valid_from ?? cur.valid_from, c.valid_to ?? cur.valid_to,
    (c.active === undefined ? cur.active : (c.active ? 1 : 0)), cur.id);
  res.json({ ok: true });
});
app.delete('/api/coupons/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT used_count FROM coupons WHERE id = ?').get(req.params.id);
  if (cur && cur.used_count > 0) { db.prepare('UPDATE coupons SET active = 0 WHERE id = ?').run(req.params.id); return res.json({ ok: true, deactivated: true }); }
  db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 會員列表（媽媽即會員）
app.get('/api/members', requireStaff, (req, res) => {
  res.json(db.prepare(`SELECT id, name, phone, member_no, points, status FROM mothers ORDER BY id DESC`).all());
});
// 手動調整點數
app.post('/api/members/:id/points', requireAdmin, (req, res) => {
  const mom = db.prepare('SELECT * FROM mothers WHERE id = ?').get(req.params.id);
  if (!mom) return res.status(404).json({ error: '找不到會員' });
  const delta = Math.round(Number((req.body || {}).delta));
  if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: '請輸入調整點數' });
  const next = Math.max(0, mom.points + delta);
  db.prepare('UPDATE mothers SET points = ? WHERE id = ?').run(next, mom.id);
  logAudit(req, { action: 'update', entity: 'member', entity_id: mom.id, summary: `點數調整 ${delta}` });
  res.json({ ok: true, points: next });
});

// ---------- 膳食管理 ----------

// 指定日期在住的媽媽（依訂房推算）與當日訂餐
app.get('/api/meals', requireStaff, (req, res) => {
  const date = req.query.date || today();
  const mothers = db.prepare(`
    SELECT m.id, m.name, m.diet_notes, r.name AS room_name
    FROM mothers m
    JOIN bookings bk ON bk.mother_id = m.id AND bk.status != 'cancelled'
      AND bk.check_in <= ? AND bk.check_out > ?
    JOIN rooms r ON r.id = bk.room_id
    GROUP BY m.id ORDER BY r.name`).all(date, date);
  const orders = db.prepare('SELECT * FROM meal_orders WHERE meal_date = ?').all(date);
  res.json({ date, mothers, orders });
});

app.post('/api/meals', requireStaff, (req, res) => {
  const o = req.body || {};
  if (!o.mother_id || !o.meal_date || !['breakfast', 'lunch', 'dinner'].includes(o.meal_type)) {
    return res.status(400).json({ error: '媽媽、日期與餐別必填' });
  }
  if (!o.choice) {
    db.prepare('DELETE FROM meal_orders WHERE mother_id = ? AND meal_date = ? AND meal_type = ?')
      .run(o.mother_id, o.meal_date, o.meal_type);
    return res.json({ ok: true });
  }
  db.prepare(`INSERT INTO meal_orders (mother_id, meal_date, meal_type, choice, note)
    VALUES (?,?,?,?,?)
    ON CONFLICT(mother_id, meal_date, meal_type) DO UPDATE SET choice = excluded.choice, note = excluded.note`)
    .run(o.mother_id, o.meal_date, o.meal_type, o.choice, o.note || '');
  res.json({ ok: true });
});

// ---------- 月子餐（餐期階段 + 每日菜單 + 廚房備餐單） ----------
function mealConfig() {
  const s = getSettings();
  const list = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  let stages = [];
  try { stages = JSON.parse(s.meal_stages || '[]'); } catch (e) { stages = []; }
  return { slots: list(s.meal_slots), diets: list(s.meal_diets), stages };
}
// 依產後天數判定餐期階段；起算優先用生產日，無則用入住日
function motherStage(m, date, stages) {
  const base = m.delivery_date || m.check_in || '';
  if (!base) return { day: null, name: '' };
  const day = Math.floor((new Date(date) - new Date(base)) / 86400000) + 1;
  if (day < 1) return { day, name: '' };
  const st = stages.find(s => day >= (s.from || 1) && day <= (s.to || 9999));
  return { day, name: st ? st.name : '' };
}
function mothersInHouseOn(date) {
  return db.prepare(`
    SELECT m.id, m.name, m.diet_notes, m.delivery_date, m.meal_diet, r.name AS room_name, bk.check_in
    FROM mothers m
    JOIN bookings bk ON bk.mother_id = m.id AND bk.status != 'cancelled'
      AND bk.check_in <= ? AND bk.check_out > ?
    JOIN rooms r ON r.id = bk.room_id
    GROUP BY m.id ORDER BY r.name`).all(date, date);
}
// 從候選菜單挑最符合（階段＋飲食類型最精準者）
function pickMenu(menus, stageName, diet) {
  const score = mu => (mu.stage === stageName ? 2 : mu.stage === '' ? 0 : -100)
    + (mu.diet === diet ? 1 : mu.diet === '' ? 0 : -100);
  return menus.filter(mu => score(mu) >= 0).sort((a, b) => score(b) - score(a))[0] || null;
}

app.get('/api/meal-config', requireStaff, (req, res) => res.json(mealConfig()));

// 某日完整菜單（供菜單管理頁編輯）
app.get('/api/meal-menu', requireStaff, (req, res) => {
  const date = req.query.date || today();
  res.json(db.prepare('SELECT * FROM meal_menu WHERE menu_date = ? ORDER BY slot, stage, diet').all(date));
});
app.post('/api/meal-menu', requireStaff, (req, res) => {
  const m = req.body || {};
  if (!m.menu_date || !m.slot) return res.status(400).json({ error: '日期與餐別必填' });
  db.prepare(`INSERT INTO meal_menu (menu_date, slot, stage, diet, staple, main, soup, veggie, dessert, drink, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(menu_date, slot, stage, diet) DO UPDATE SET
      staple=excluded.staple, main=excluded.main, soup=excluded.soup, veggie=excluded.veggie,
      dessert=excluded.dessert, drink=excluded.drink, note=excluded.note`).run(
    m.menu_date, m.slot, m.stage || '', m.diet || '', m.staple || '', m.main || '', m.soup || '',
    m.veggie || '', m.dessert || '', m.drink || '', m.note || '', req.session.user.id);
  res.json({ ok: true });
});
app.delete('/api/meal-menu/:id', requireStaff, (req, res) => {
  db.prepare('DELETE FROM meal_menu WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
// 複製前一天菜單到指定日（快速排餐）
app.post('/api/meal-menu/copy', requireStaff, (req, res) => {
  const { from_date, to_date } = req.body || {};
  if (!from_date || !to_date) return res.status(400).json({ error: '來源與目標日期必填' });
  const src = db.prepare('SELECT * FROM meal_menu WHERE menu_date = ?').all(from_date);
  const ins = db.prepare(`INSERT INTO meal_menu (menu_date, slot, stage, diet, staple, main, soup, veggie, dessert, drink, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(menu_date, slot, stage, diet) DO UPDATE SET
      staple=excluded.staple, main=excluded.main, soup=excluded.soup, veggie=excluded.veggie,
      dessert=excluded.dessert, drink=excluded.drink, note=excluded.note`);
  const tx = db.transaction(() => { for (const r of src) ins.run(to_date, r.slot, r.stage, r.diet, r.staple, r.main, r.soup, r.veggie, r.dessert, r.drink, r.note, req.session.user.id); });
  tx();
  res.json({ ok: true, copied: src.length });
});

// 月子餐供餐總覽 / 廚房備餐單：每位在住媽媽的階段＋飲食類型＋各餐菜色，與份數統計
app.get('/api/meal-plan', requireStaff, (req, res) => {
  const date = req.query.date || today();
  const cfg = mealConfig();
  const menus = db.prepare('SELECT * FROM meal_menu WHERE menu_date = ?').all(date);
  const mothers = mothersInHouseOn(date).map(m => {
    const stage = motherStage(m, date, cfg.stages);
    const diet = m.meal_diet || (cfg.diets[0] || '一般');
    const slots = {};
    for (const slot of cfg.slots) {
      const mu = pickMenu(menus.filter(x => x.slot === slot), stage.name, diet);
      slots[slot] = mu || null;
    }
    return { id: m.id, name: m.name, room_name: m.room_name, diet, diet_notes: m.diet_notes,
      postpartum_day: stage.day, stage: stage.name, slots };
  });
  // 廚房份數：每餐別 × 階段 × 飲食類型 的人數
  const counts = {};
  for (const m of mothers) {
    for (const slot of cfg.slots) {
      const key = `${slot}｜${m.stage || '不分期'}｜${m.diet}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  res.json({ date, config: cfg, mothers, counts });
});

// 設定某位媽媽的飲食類型
app.put('/api/mothers/:id/meal-diet', requireStaff, (req, res) => {
  const diet = (req.body || {}).meal_diet;
  if (!diet) return res.status(400).json({ error: '請選擇飲食類型' });
  const info = db.prepare('UPDATE mothers SET meal_diet = ? WHERE id = ?').run(diet, req.params.id);
  res.json({ ok: info.changes > 0 });
});

// 家屬端：查看自己媽媽今日月子餐
app.get('/api/family/meal-plan', requireFamily, (req, res) => {
  const date = req.query.date || today();
  const mid = familyMotherId(req.session.family);
  const m = mid ? db.prepare('SELECT id, name, delivery_date, meal_diet FROM mothers WHERE id = ?').get(mid) : null;
  if (!m) return res.json({ date, available: false });
  const bk = db.prepare(`SELECT check_in FROM bookings WHERE mother_id = ? AND status != 'cancelled'
    AND check_in <= ? AND check_out > ? ORDER BY check_in DESC`).get(mid, date, date);
  const cfg = mealConfig();
  const stage = motherStage({ ...m, check_in: bk ? bk.check_in : '' }, date, cfg.stages);
  const diet = m.meal_diet || (cfg.diets[0] || '一般');
  const menus = db.prepare('SELECT * FROM meal_menu WHERE menu_date = ?').all(date);
  const slots = cfg.slots.map(slot => ({ slot, menu: pickMenu(menus.filter(x => x.slot === slot), stage.name, diet) }));
  res.json({ date, available: true, mother_name: m.name, postpartum_day: stage.day, stage: stage.name, diet, slots });
});

// ---------- 參觀預約（潛在客戶追蹤） ----------
app.get('/api/tours', requireStaff, (req, res) => {
  const rows = db.prepare('SELECT * FROM tours ORDER BY tour_at DESC LIMIT 300').all();
  res.json(rows);
});

app.post('/api/tours', requireStaff, (req, res) => {
  const t = req.body || {};
  if (!t.name || !t.tour_at) return res.status(400).json({ error: '姓名與參觀時間必填' });
  const info = db.prepare(`INSERT INTO tours (name, phone, due_date, tour_at, source, status, note)
    VALUES (?,?,?,?,?,?,?)`).run(
    t.name, t.phone || '', t.due_date || '', t.tour_at, t.source || '',
    ['scheduled', 'visited', 'signed', 'lost'].includes(t.status) ? t.status : 'scheduled', t.note || '');
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/tours/:id', requireStaff, (req, res) => {
  const t = req.body || {};
  const cur = db.prepare('SELECT * FROM tours WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到參觀預約' });
  const status = ['scheduled', 'visited', 'signed', 'lost'].includes(t.status) ? t.status : cur.status;
  db.prepare(`UPDATE tours SET name = ?, phone = ?, due_date = ?, tour_at = ?, source = ?, status = ?, note = ?
    WHERE id = ?`).run(
    t.name ?? cur.name, t.phone ?? cur.phone, t.due_date ?? cur.due_date, t.tour_at ?? cur.tour_at,
    t.source ?? cur.source, status, t.note ?? cur.note, req.params.id);
  res.json({ ok: true });
});

// 參觀客戶簽約：一次建立媽媽資料 + 訂房，並把參觀紀錄轉為已簽約（單一交易，失敗全回滾）
app.post('/api/tours/:id/sign', requireStaff, (req, res) => {
  const b = req.body || {};
  const tour = db.prepare('SELECT * FROM tours WHERE id = ?').get(req.params.id);
  if (!tour) return res.status(404).json({ error: '找不到參觀預約' });
  const name = (b.name || tour.name || '').trim();
  if (!name) return res.status(400).json({ error: '客戶姓名必填' });
  if (!b.room_id || !b.check_in || !b.check_out) {
    return res.status(400).json({ error: '房間、入住與退房日期必填' });
  }
  if (b.check_out <= b.check_in) return res.status(400).json({ error: '退房日需晚於入住日' });
  const conflict = db.prepare(`
    SELECT COUNT(*) c FROM bookings
    WHERE room_id = ? AND status IN ('reserved','checked_in')
      AND check_in < ? AND check_out > ?`).get(b.room_id, b.check_out, b.check_in).c;
  if (conflict) return res.status(409).json({ error: '該房間此期間已有訂房' });

  const tx = db.transaction(() => {
    const motherId = db.prepare(`INSERT INTO mothers
      (name, phone, due_date, status) VALUES (?,?,?,'reserved')`).run(
      name, b.phone || tour.phone || '', b.due_date || tour.due_date || '').lastInsertRowid;
    const bookingId = db.prepare(`INSERT INTO bookings
      (mother_id, room_id, check_in, check_out, deposit, total_amount, status)
      VALUES (?,?,?,?,?,?,'reserved')`).run(
      motherId, b.room_id, b.check_in, b.check_out,
      b.deposit || 0, b.total_amount || 0).lastInsertRowid;
    db.prepare("UPDATE tours SET status = 'signed' WHERE id = ?").run(req.params.id);
    return { mother_id: motherId, booking_id: bookingId };
  });
  res.json(tx());
});

app.delete('/api/tours/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tours WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 電子合約與簽署 ----------
function genSignToken() {
  return crypto.randomBytes(18).toString('hex'); // 36 碼，不可猜測
}
function money(n) {
  return Number(n || 0).toLocaleString('en-US');
}
// 以訂房資料計算合約占位符對應值
function contractContext(bookingId) {
  const bk = db.prepare(`
    SELECT bk.*, m.name AS mother_name, m.phone AS mother_phone,
           r.name AS room_name, r.room_type
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.id = ?`).get(bookingId);
  if (!bk) return null;
  const days = Math.max(0, Math.round(
    (new Date(bk.check_out) - new Date(bk.check_in)) / 86400000));
  const balance = Math.max(0, (bk.total_amount || 0) - (bk.deposit || 0));
  return {
    bk,
    map: {
      center_name: getSettings().center_name || '',
      mother_name: bk.mother_name || '',
      mother_phone: bk.mother_phone || '',
      room_name: bk.room_name || '',
      room_type: bk.room_type || '',
      check_in: bk.check_in || '',
      check_out: bk.check_out || '',
      days: String(days),
      total_amount: money(bk.total_amount),
      deposit: money(bk.deposit),
      balance: money(balance),
      today: today()
    }
  };
}
function renderTemplate(body, map) {
  return String(body || '').replace(/\{\{(\w+)\}\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m);
}

// 合約範本：員工可讀，管理員可增修刪
app.get('/api/contract-templates', requireStaff, (req, res) => {
  res.json(db.prepare('SELECT * FROM contract_templates ORDER BY active DESC, id').all());
});
app.post('/api/contract-templates', requireAdmin, (req, res) => {
  const t = req.body || {};
  if (!t.name || !t.body) return res.status(400).json({ error: '範本名稱與內容必填' });
  const info = db.prepare('INSERT INTO contract_templates (name, body, active) VALUES (?,?,?)')
    .run(t.name, t.body, t.active === 0 ? 0 : 1);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/contract-templates/:id', requireAdmin, (req, res) => {
  const t = req.body || {};
  const cur = db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到範本' });
  db.prepare('UPDATE contract_templates SET name = ?, body = ?, active = ? WHERE id = ?').run(
    t.name ?? cur.name, t.body ?? cur.body,
    t.active === undefined ? cur.active : (t.active ? 1 : 0), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/contract-templates/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM contract_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 合約清單（含訂房／媽媽資訊；不回傳簽名圖檔與全文以縮小體積）
app.get('/api/contracts', requireStaff, (req, res) => {
  const where = req.query.booking_id ? 'WHERE c.booking_id = ?' : '';
  const args = req.query.booking_id ? [req.query.booking_id] : [];
  const rows = db.prepare(`
    SELECT c.id, c.booking_id, c.title, c.status, c.sign_token, c.signer_name,
           c.signer_relation, c.signed_at, c.created_at,
           m.name AS mother_name, r.name AS room_name,
           u.name AS created_by_name
    FROM contracts c
    LEFT JOIN bookings bk ON bk.id = c.booking_id
    LEFT JOIN mothers m ON m.id = bk.mother_id
    LEFT JOIN rooms r ON r.id = bk.room_id
    LEFT JOIN users u ON u.id = c.created_by
    ${where} ORDER BY c.id DESC`).all(...args);
  res.json(rows);
});

// 由某筆訂房 + 範本產生合約，當下渲染並凍結全文
app.post('/api/bookings/:id/contracts', requireStaff, (req, res) => {
  const ctx = contractContext(req.params.id);
  if (!ctx) return res.status(404).json({ error: '找不到訂房' });
  const tplId = (req.body || {}).template_id;
  const tpl = db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(tplId);
  if (!tpl) return res.status(400).json({ error: '請選擇合約範本' });
  const title = (req.body || {}).title || tpl.name;
  const body = renderTemplate(tpl.body, ctx.map);
  const info = db.prepare(`INSERT INTO contracts
    (booking_id, template_id, title, body, sign_token, created_by)
    VALUES (?,?,?,?,?,?)`).run(
    req.params.id, tpl.id, title, body, genSignToken(), req.session.user.id);
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/contracts/:id', requireStaff, (req, res) => {
  const c = db.prepare(`
    SELECT c.*, m.name AS mother_name, r.name AS room_name,
           u.name AS created_by_name, vu.name AS voided_by_name
    FROM contracts c
    LEFT JOIN bookings bk ON bk.id = c.booking_id
    LEFT JOIN mothers m ON m.id = bk.mother_id
    LEFT JOIN rooms r ON r.id = bk.room_id
    LEFT JOIN users u ON u.id = c.created_by
    LEFT JOIN users vu ON vu.id = c.voided_by
    WHERE c.id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: '找不到合約' });
  res.json(c);
});

// 編輯尚未簽署的合約內容（已簽署者請改用「重新簽署」）
app.put('/api/contracts/:id', requireStaff, (req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '找不到合約' });
  if (c.status !== 'pending') return res.status(400).json({ error: '已簽署或已作廢的合約不可直接編輯，請使用「重新簽署」' });
  const b = req.body || {};
  db.prepare('UPDATE contracts SET title = ?, body = ? WHERE id = ?').run(
    (b.title || c.title), (b.body !== undefined ? b.body : c.body), c.id);
  logAudit(req, { action: 'update', entity: 'contracts', entity_id: c.id, summary: '編輯合約內容' });
  res.json({ ok: true });
});

// 重新簽署：以原合約為底（可改內容）建立新版，原合約作廢並留版本鏈
app.post('/api/contracts/:id/resign', requireStaff, (req, res) => {
  const old = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '找不到合約' });
  if (old.status === 'void') return res.status(400).json({ error: '已作廢的合約無法重簽，請重新建立' });
  const b = req.body || {};
  const title = b.title || old.title;
  const body = b.body !== undefined ? b.body : old.body;
  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO contracts
      (booking_id, template_id, title, body, sign_token, created_by, replaces_id)
      VALUES (?,?,?,?,?,?,?)`).run(
      old.booking_id, old.template_id, title, body, genSignToken(), req.session.user.id, old.id);
    db.prepare(`UPDATE contracts SET status='void', voided_by=?, voided_at=datetime('now','localtime'),
      void_reason=? WHERE id=?`).run(
      req.session.user.id, `重新簽署，由合約#${info.lastInsertRowid} 取代`, old.id);
    return info.lastInsertRowid;
  });
  const newId = tx();
  const nc = db.prepare('SELECT id, sign_token FROM contracts WHERE id = ?').get(newId);
  logAudit(req, { action: 'update', entity: 'contracts', entity_id: old.id, summary: `重新簽署→#${newId}` });
  res.json({ id: nc.id, sign_token: nc.sign_token });
});

// 作廢（限管理員）：保留紀錄不刪除，僅標記
app.post('/api/contracts/:id/void', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '找不到合約' });
  if (c.status === 'void') return res.status(400).json({ error: '合約已作廢' });
  db.prepare(`UPDATE contracts SET status = 'void', voided_by = ?, voided_at = datetime('now','localtime'),
    void_reason = ? WHERE id = ?`).run(
    req.session.user.id, (req.body || {}).reason || '', req.params.id);
  res.json({ ok: true });
});

// 刪除：僅限尚未簽署的合約（已簽署者應作廢以保全紀錄）
app.delete('/api/contracts/:id', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT status FROM contracts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '找不到合約' });
  if (c.status !== 'pending') {
    return res.status(400).json({ error: '已簽署或已作廢的合約不可刪除，請改用作廢' });
  }
  db.prepare('DELETE FROM contracts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- 公開簽署（持簽署連結即可，無須登入）----
app.get('/api/sign/:token', (req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE sign_token = ?').get(req.params.token);
  if (!c) return res.status(404).json({ error: '簽署連結無效' });
  res.json({
    title: c.title, body: c.body, status: c.status,
    center_name: getSettings().center_name || '',
    signer_name: c.signer_name, signer_relation: c.signer_relation,
    signed_at: c.signed_at, signature_data: c.status === 'signed' ? c.signature_data : ''
  });
});

app.post('/api/sign/:token', (req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE sign_token = ?').get(req.params.token);
  if (!c) return res.status(404).json({ error: '簽署連結無效' });
  if (c.status === 'void') return res.status(400).json({ error: '此合約已作廢，無法簽署' });
  if (c.status === 'signed') return res.status(409).json({ error: '此合約已完成簽署' });
  const b = req.body || {};
  const name = (b.signer_name || '').trim();
  const sig = b.signature_data || '';
  if (!name) return res.status(400).json({ error: '請填寫簽署人姓名' });
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(sig);
  if (!m || sig.length > 1500000) {
    return res.status(400).json({ error: '請完成手寫簽名' });
  }
  // 後端把關：須為真正的 PNG（檢查魔術位元組）且非極小空白圖
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 200 ||
      buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    return res.status(400).json({ error: '簽名無效，請重新手寫簽名' });
  }
  db.prepare(`UPDATE contracts SET status = 'signed', signer_name = ?, signer_relation = ?,
    signer_id_last4 = ?, signature_data = ?, signed_at = datetime('now','localtime'),
    signed_ip = ?, signed_ua = ? WHERE id = ?`).run(
    name, (b.signer_relation || '').trim(),
    (b.signer_id_last4 || '').replace(/\D/g, '').slice(-4),
    sig, req.ip || '', (req.headers['user-agent'] || '').slice(0, 300), c.id);
  logAudit(req, { action: 'sign', entity: 'contracts', entity_id: c.id, summary: `簽署人:${name}` });
  res.json({ ok: true });
});

// 稽核軌跡查詢（限管理員）：可依關鍵字／實體篩選
app.get('/api/audit-logs', requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '300', 10), 1000);
  const q = (req.query.q || '').trim();
  const where = q ? `WHERE user_name LIKE @q OR action LIKE @q OR entity LIKE @q OR path LIKE @q OR summary LIKE @q` : '';
  const rows = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT @limit`)
    .all({ q: `%${q}%`, limit });
  res.json(rows);
});

// ---------- 異常／不良事件通報 ----------
const INCIDENT_CATEGORIES = ['fall', 'med_error', 'baby_id_error', 'infection', 'burn', 'equipment', 'other'];
const INCIDENT_SEVERITIES = ['near_miss', 'minor', 'moderate', 'severe', 'sentinel'];

app.get('/api/incidents', requireStaff, (req, res) => {
  const conds = [], args = {};
  if (req.query.status) { conds.push('i.status = @status'); args.status = req.query.status; }
  if (req.query.category) { conds.push('i.category = @category'); args.category = req.query.category; }
  if (req.query.month) { conds.push("strftime('%Y-%m', i.occurred_at) = @month"); args.month = req.query.month; }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT i.*, m.name AS mother_name, b.name AS baby_name,
           u.name AS reported_by_name, cu.name AS closed_by_name
    FROM incidents i
    LEFT JOIN mothers m ON m.id = i.mother_id
    LEFT JOIN babies b ON b.id = i.baby_id
    LEFT JOIN users u ON u.id = i.reported_by
    LEFT JOIN users cu ON cu.id = i.closed_by
    ${where} ORDER BY i.occurred_at DESC, i.id DESC`).all(args);
  res.json(rows);
});

app.post('/api/incidents', requireStaff, (req, res) => {
  const i = req.body || {};
  if (!INCIDENT_CATEGORIES.includes(i.category)) return res.status(400).json({ error: '事件類別不正確' });
  if (!i.occurred_at) return res.status(400).json({ error: '發生時間必填' });
  const severity = INCIDENT_SEVERITIES.includes(i.severity) ? i.severity : 'minor';
  const info = db.prepare(`INSERT INTO incidents
    (category, severity, occurred_at, location, mother_id, baby_id, subject, description,
     immediate_action, cause_analysis, follow_up, outcome, physician_notified, family_notified,
     reported_to_authority, status, reported_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    i.category, severity, i.occurred_at, i.location || '', i.mother_id || null, i.baby_id || null,
    i.subject || '', i.description || '', i.immediate_action || '', i.cause_analysis || '',
    i.follow_up || '', i.outcome || '', i.physician_notified ? 1 : 0, i.family_notified ? 1 : 0,
    i.reported_to_authority ? 1 : 0,
    ['open', 'processing', 'closed'].includes(i.status) ? i.status : 'open', req.session.user.id);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/incidents/:id', requireStaff, (req, res) => {
  const i = req.body || {};
  const cur = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到事件' });
  const status = ['open', 'processing', 'closed'].includes(i.status) ? i.status : cur.status;
  const closing = status === 'closed' && cur.status !== 'closed';
  db.prepare(`UPDATE incidents SET
    category = ?, severity = ?, occurred_at = ?, location = ?, mother_id = ?, baby_id = ?,
    subject = ?, description = ?, immediate_action = ?, cause_analysis = ?, follow_up = ?, outcome = ?,
    physician_notified = ?, family_notified = ?, reported_to_authority = ?, status = ?,
    closed_by = ?, closed_at = ? WHERE id = ?`).run(
    INCIDENT_CATEGORIES.includes(i.category) ? i.category : cur.category,
    INCIDENT_SEVERITIES.includes(i.severity) ? i.severity : cur.severity,
    i.occurred_at ?? cur.occurred_at, i.location ?? cur.location,
    i.mother_id ?? cur.mother_id, i.baby_id ?? cur.baby_id, i.subject ?? cur.subject,
    i.description ?? cur.description, i.immediate_action ?? cur.immediate_action,
    i.cause_analysis ?? cur.cause_analysis, i.follow_up ?? cur.follow_up, i.outcome ?? cur.outcome,
    i.physician_notified ? 1 : 0, i.family_notified ? 1 : 0, i.reported_to_authority ? 1 : 0,
    status, closing ? req.session.user.id : cur.closed_by,
    closing ? today() : cur.closed_at, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/incidents/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM incidents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 感染管制 ----------
// 洗手稽核
app.get('/api/infection/hand-hygiene', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT h.*, u.name AS observer_name FROM hand_hygiene_audits h
    LEFT JOIN users u ON u.id = h.observer_id ORDER BY h.audit_date DESC, h.id DESC LIMIT 500`).all();
  res.json(rows);
});
app.post('/api/infection/hand-hygiene', requireStaff, (req, res) => {
  const h = req.body || {};
  const opp = parseInt(h.opportunities, 10), comp = parseInt(h.compliant, 10);
  if (!h.audit_date || !Number.isInteger(opp) || opp < 1) return res.status(400).json({ error: '日期與觀察時機數必填' });
  if (!Number.isInteger(comp) || comp < 0 || comp > opp) return res.status(400).json({ error: '確實執行數須為 0 到觀察數之間' });
  const info = db.prepare(`INSERT INTO hand_hygiene_audits
    (audit_date, area, observed_role, opportunities, compliant, observer_id, note)
    VALUES (?,?,?,?,?,?,?)`).run(
    h.audit_date, h.area || '', h.observed_role || '', opp, comp, req.session.user.id, h.note || '');
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/infection/hand-hygiene/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM hand_hygiene_audits WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 環境清潔消毒簽核
app.get('/api/infection/disinfection', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, o.name AS operator_name, v.name AS verified_name FROM disinfection_logs d
    LEFT JOIN users o ON o.id = d.operator_id
    LEFT JOIN users v ON v.id = d.verified_by
    ORDER BY d.disinfect_date DESC, d.id DESC LIMIT 500`).all();
  res.json(rows);
});
app.post('/api/infection/disinfection', requireStaff, (req, res) => {
  const d = req.body || {};
  if (!d.disinfect_date || !d.area) return res.status(400).json({ error: '日期與區域必填' });
  const info = db.prepare(`INSERT INTO disinfection_logs
    (disinfect_date, area, agent, operator_id, verified_by, note) VALUES (?,?,?,?,?,?)`).run(
    d.disinfect_date, d.area, d.agent || '', req.session.user.id,
    d.verified_by || null, d.note || '');
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/infection/disinfection/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM disinfection_logs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 群聚事件通報
app.get('/api/infection/clusters', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.name AS created_by_name FROM cluster_events c
    LEFT JOIN users u ON u.id = c.created_by ORDER BY c.onset_date DESC, c.id DESC`).all();
  res.json(rows);
});
app.post('/api/infection/clusters', requireStaff, (req, res) => {
  const c = req.body || {};
  if (!c.onset_date) return res.status(400).json({ error: '起始日期必填' });
  const info = db.prepare(`INSERT INTO cluster_events
    (pathogen, onset_date, affected_count, affected_detail, description, control_action,
     reported_to_authority, reported_at, status, created_by, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    c.pathogen || '', c.onset_date, parseInt(c.affected_count, 10) || 0, c.affected_detail || '',
    c.description || '', c.control_action || '', c.reported_to_authority ? 1 : 0,
    c.reported_to_authority ? (c.reported_at || today()) : '',
    ['open', 'monitoring', 'closed'].includes(c.status) ? c.status : 'open',
    req.session.user.id, c.note || '');
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/infection/clusters/:id', requireStaff, (req, res) => {
  const c = req.body || {};
  const cur = db.prepare('SELECT * FROM cluster_events WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到群聚事件' });
  db.prepare(`UPDATE cluster_events SET pathogen = ?, onset_date = ?, affected_count = ?, affected_detail = ?,
    description = ?, control_action = ?, reported_to_authority = ?, reported_at = ?, status = ?, note = ?
    WHERE id = ?`).run(
    c.pathogen ?? cur.pathogen, c.onset_date ?? cur.onset_date,
    c.affected_count != null ? parseInt(c.affected_count, 10) || 0 : cur.affected_count,
    c.affected_detail ?? cur.affected_detail, c.description ?? cur.description,
    c.control_action ?? cur.control_action, c.reported_to_authority ? 1 : 0,
    c.reported_to_authority ? (c.reported_at || cur.reported_at || today()) : '',
    ['open', 'monitoring', 'closed'].includes(c.status) ? c.status : cur.status,
    c.note ?? cur.note, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/infection/clusters/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM cluster_events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 新生兒醫療紀錄（MAR / 疫苗 / 篩檢 / 光照） ----------
app.get('/api/babies/:id/medical', requireStaff, (req, res) => {
  const baby = db.prepare(`SELECT b.*, m.name AS mother_name FROM babies b
    JOIN mothers m ON m.id = b.mother_id WHERE b.id = ?`).get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const nurse = 'LEFT JOIN users u ON u.id = ';
  res.json({
    baby,
    meds: db.prepare(`SELECT a.*, u.name AS nurse_name FROM med_administrations a ${nurse}a.nurse_id
      WHERE a.baby_id = ? ORDER BY a.administered_at DESC, a.id DESC`).all(req.params.id),
    vaccinations: db.prepare(`SELECT v.*, u.name AS nurse_name FROM vaccinations v ${nurse}v.nurse_id
      WHERE v.baby_id = ? ORDER BY v.id DESC`).all(req.params.id),
    screenings: db.prepare(`SELECT s.*, u.name AS nurse_name FROM newborn_screenings s ${nurse}s.nurse_id
      WHERE s.baby_id = ? ORDER BY s.id DESC`).all(req.params.id),
    phototherapy: db.prepare(`SELECT p.*, u.name AS nurse_name FROM phototherapy_logs p ${nurse}p.nurse_id
      WHERE p.baby_id = ? ORDER BY p.start_at DESC, p.id DESC`).all(req.params.id)
  });
});

// 給藥紀錄 MAR
app.post('/api/babies/:id/meds', requireStaff, (req, res) => {
  const m = req.body || {};
  if (!m.drug_name) return res.status(400).json({ error: '藥品名稱必填' });
  const info = db.prepare(`INSERT INTO med_administrations
    (baby_id, drug_name, dose, route, ordered_by, scheduled_at, administered_at, status, nurse_id, note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    req.params.id, m.drug_name, m.dose || '', m.route || '', m.ordered_by || '',
    m.scheduled_at || '', m.administered_at || '',
    ['given', 'held', 'refused', 'missed'].includes(m.status) ? m.status : 'given',
    req.session.user.id, m.note || '');
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/meds/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM med_administrations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 疫苗
app.post('/api/babies/:id/vaccinations', requireStaff, (req, res) => {
  const v = req.body || {};
  if (!v.vaccine) return res.status(400).json({ error: '疫苗別必填' });
  const info = db.prepare(`INSERT INTO vaccinations
    (baby_id, vaccine, dose_no, administered_at, lot_no, site, status, nurse_id, note)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    req.params.id, v.vaccine, v.dose_no || '', v.administered_at || '', v.lot_no || '', v.site || '',
    ['scheduled', 'done', 'deferred', 'refused'].includes(v.status) ? v.status : 'done',
    req.session.user.id, v.note || '');
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/vaccinations/:id', requireStaff, (req, res) => {
  const v = req.body || {};
  const cur = db.prepare('SELECT * FROM vaccinations WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到疫苗紀錄' });
  db.prepare(`UPDATE vaccinations SET vaccine = ?, dose_no = ?, administered_at = ?, lot_no = ?,
    site = ?, status = ?, note = ? WHERE id = ?`).run(
    v.vaccine ?? cur.vaccine, v.dose_no ?? cur.dose_no, v.administered_at ?? cur.administered_at,
    v.lot_no ?? cur.lot_no, v.site ?? cur.site,
    ['scheduled', 'done', 'deferred', 'refused'].includes(v.status) ? v.status : cur.status,
    v.note ?? cur.note, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/vaccinations/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM vaccinations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 新生兒篩檢
app.post('/api/babies/:id/screenings', requireStaff, (req, res) => {
  const s = req.body || {};
  if (!s.screen_type) return res.status(400).json({ error: '篩檢項目必填' });
  const info = db.prepare(`INSERT INTO newborn_screenings
    (baby_id, screen_type, screened_at, result, follow_up, follow_up_done, nurse_id, note)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    req.params.id, s.screen_type, s.screened_at || '',
    ['pending', 'pass', 'refer', 'abnormal'].includes(s.result) ? s.result : 'pending',
    s.follow_up || '', s.follow_up_done ? 1 : 0, req.session.user.id, s.note || '');
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/screenings/:id', requireStaff, (req, res) => {
  const s = req.body || {};
  const cur = db.prepare('SELECT * FROM newborn_screenings WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到篩檢紀錄' });
  db.prepare(`UPDATE newborn_screenings SET screen_type = ?, screened_at = ?, result = ?,
    follow_up = ?, follow_up_done = ?, note = ? WHERE id = ?`).run(
    s.screen_type ?? cur.screen_type, s.screened_at ?? cur.screened_at,
    ['pending', 'pass', 'refer', 'abnormal'].includes(s.result) ? s.result : cur.result,
    s.follow_up ?? cur.follow_up, s.follow_up_done ? 1 : 0, s.note ?? cur.note, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/screenings/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM newborn_screenings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 光照治療
app.post('/api/babies/:id/phototherapy', requireStaff, (req, res) => {
  const p = req.body || {};
  if (!p.start_at) return res.status(400).json({ error: '開始時間必填' });
  const info = db.prepare(`INSERT INTO phototherapy_logs
    (baby_id, start_at, end_at, bilirubin_before, bilirubin_after, device, nurse_id, note)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    req.params.id, p.start_at, p.end_at || '',
    p.bilirubin_before != null && p.bilirubin_before !== '' ? Number(p.bilirubin_before) : null,
    p.bilirubin_after != null && p.bilirubin_after !== '' ? Number(p.bilirubin_after) : null,
    p.device || '', req.session.user.id, p.note || '');
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/phototherapy/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM phototherapy_logs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 電子發票／收據（MIG 3.2 對齊；實際上傳大平台需加值中心 API） ----------
function computeInvoiceAmounts(items, taxType, taxRate) {
  const norm = (Array.isArray(items) ? items : []).map(it => {
    const qty = Number(it.qty) || 0;
    const price = Math.round(Number(it.price) || 0);
    return { name: String(it.name || '').slice(0, 100), qty, price, amount: qty * price };
  }).filter(it => it.name && it.qty > 0);
  const total = norm.reduce((s, it) => s + it.amount, 0);
  let tax = 0, sales = total;
  if (taxType === '1') { // 應稅：價格含稅，反推稅額
    const rate = (Number(taxRate) || 5) / 100;
    tax = Math.round(total - total / (1 + rate));
    sales = total - tax;
  }
  return { items: norm, sales_amount: sales, tax_amount: tax, total_amount: total };
}

app.get('/api/invoices', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, m.name AS mother_name, r.name AS room_name, u.name AS created_by_name
    FROM invoices i
    LEFT JOIN bookings bk ON bk.id = i.booking_id
    LEFT JOIN mothers m ON m.id = bk.mother_id
    LEFT JOIN rooms r ON r.id = bk.room_id
    LEFT JOIN users u ON u.id = i.created_by
    ORDER BY i.id DESC`).all();
  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items || '[]') })));
});

app.get('/api/invoices/:id', requireStaff, (req, res) => {
  const r = db.prepare(`
    SELECT i.*, m.name AS mother_name, r.name AS room_name,
           u.name AS created_by_name, vu.name AS voided_by_name
    FROM invoices i
    LEFT JOIN bookings bk ON bk.id = i.booking_id
    LEFT JOIN mothers m ON m.id = bk.mother_id
    LEFT JOIN rooms r ON r.id = bk.room_id
    LEFT JOIN users u ON u.id = i.created_by
    LEFT JOIN users vu ON vu.id = i.voided_by
    WHERE i.id = ?`).get(req.params.id);
  if (!r) return res.status(404).json({ error: '找不到發票' });
  r.items = JSON.parse(r.items || '[]');
  res.json(r);
});

// 收據自動採番：前綴 + 年月 + 4 碼流水號，流水號存 settings 持續遞增
function nextReceiptNumber() {
  const s = getSettings();
  const seq = parseInt(s.receipt_next_seq, 10) || 1;
  const ym = today().slice(0, 7).replace('-', '');
  setSetting('receipt_next_seq', String(seq + 1));
  return `${s.receipt_prefix || 'R'}${ym}-${String(seq).padStart(4, '0')}`;
}

app.post('/api/invoices', requireStaff, (req, res) => {
  const v = req.body || {};
  const s = getSettings();
  const docType = v.doc_type === 'invoice' ? 'invoice' : 'receipt';
  const taxType = ['1', '2', '3', '9'].includes(v.tax_type) ? v.tax_type : (s.einvoice_tax_type || '3');
  const amt = computeInvoiceAmounts(v.items, taxType, s.einvoice_tax_rate);
  if (!amt.items.length) return res.status(400).json({ error: '至少需一筆有效品項（名稱、數量、單價）' });
  // 收據未指定號碼時自動採番（電子發票字軌由加值中心配發，不在此自動產生）
  let invoiceNumber = (v.invoice_number || '').trim().toUpperCase();
  if (!invoiceNumber && docType === 'receipt') invoiceNumber = nextReceiptNumber();
  if (v.booking_id) {
    const bk = db.prepare('SELECT id FROM bookings WHERE id = ?').get(v.booking_id);
    if (!bk) return res.status(404).json({ error: '找不到訂房' });
  }
  const info = db.prepare(`INSERT INTO invoices
    (booking_id, doc_type, invoice_number, random_number, invoice_date, invoice_time,
     buyer_name, buyer_tax_id, carrier_type, carrier_id, npoban, items,
     sales_amount, tax_type, tax_amount, total_amount, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    v.booking_id || null, docType, invoiceNumber,
    (v.random_number || '').replace(/\D/g, '').slice(0, 4),
    v.invoice_date || today(), v.invoice_time || new Date().toTimeString().slice(0, 5),
    v.buyer_name || '', (v.buyer_tax_id || '').replace(/\D/g, '').slice(0, 8),
    v.carrier_type || '', v.carrier_id || '', v.npoban || '',
    JSON.stringify(amt.items), amt.sales_amount, taxType, amt.tax_amount, amt.total_amount,
    v.note || '', req.session.user.id);
  res.json({ id: info.lastInsertRowid, ...amt });
});

// 作廢
app.post('/api/invoices/:id/void', requireAdmin, (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: '找不到發票' });
  if (inv.status === 'void') return res.status(400).json({ error: '發票已作廢' });
  db.prepare(`UPDATE invoices SET status = 'void', void_reason = ?, voided_by = ?,
    voided_at = datetime('now','localtime') WHERE id = ?`).run(
    (req.body || {}).reason || '', req.session.user.id, req.params.id);
  res.json({ ok: true });
});

// 折讓
app.post('/api/invoices/:id/allowance', requireStaff, (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: '找不到發票' });
  if (inv.status === 'void') return res.status(400).json({ error: '已作廢發票不可折讓' });
  const amount = Math.round(Number((req.body || {}).amount));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: '折讓金額需大於 0' });
  if (inv.allowance_amount + amount > inv.total_amount) {
    return res.status(400).json({ error: '累計折讓金額不可超過發票總額' });
  }
  db.prepare(`UPDATE invoices SET status = 'allowance', allowance_amount = allowance_amount + ?,
    note = TRIM(note || ' / 折讓:' || ?) WHERE id = ?`).run(amount, amount, req.params.id);
  res.json({ ok: true });
});

// 上傳大平台（需設定加值中心；未設定時回傳說明，資料已可本地存證列印）
app.post('/api/invoices/:id/upload', requireAdmin, (req, res) => {
  const s = getSettings();
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: '找不到發票' });
  if (!s.einvoice_provider || !s.einvoice_api_url || !s.einvoice_api_key) {
    return res.status(400).json({
      error: '尚未設定電子發票加值中心（業者/API網址/API金鑰）。設定後即可上傳財政部大平台；目前可先本地列印收據存證。'
    });
  }
  // 介接點：實務上於此呼叫加值中心 API 取號並上傳，成功後回填 invoice_number/random_number。
  db.prepare(`UPDATE invoices SET upload_status = 'uploaded',
    upload_note = ? WHERE id = ?`).run(`已送 ${s.einvoice_provider}`, req.params.id);
  res.json({ ok: true, provider: s.einvoice_provider });
});

app.delete('/api/invoices/:id', requireAdmin, (req, res) => {
  const inv = db.prepare('SELECT status FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: '找不到發票' });
  if (inv.status !== 'issued') return res.status(400).json({ error: '已作廢／折讓的發票不可刪除，請保留存證' });
  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 待辦／提醒中心（整合既有資料） ----------
app.get('/api/reminders', requireStaff, (req, res) => {
  const d = today();
  const items = [];
  // 近 3 日內退房
  for (const c of db.prepare(`
    SELECT bk.check_out, m.name AS mother_name, r.name AS room_name
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status = 'checked_in' AND bk.check_out <= date(?, '+3 days')
    ORDER BY bk.check_out`).all(d)) {
    items.push({ type: 'checkout', level: c.check_out <= d ? 'high' : 'mid',
      title: `${c.mother_name}（${c.room_name}房）退房`, due: c.check_out, link: '#/rooms' });
  }
  // 未結帳款
  for (const b of db.prepare(`
    SELECT bk.id, m.name AS mother_name, r.name AS room_name,
      bk.total_amount + COALESCE((SELECT SUM(unit_price*quantity) FROM charge_items WHERE booking_id=bk.id),0)
      - bk.deposit - COALESCE((SELECT SUM(amount) FROM payments WHERE booking_id=bk.id),0) AS balance
    FROM bookings bk JOIN mothers m ON m.id=bk.mother_id JOIN rooms r ON r.id=bk.room_id
    WHERE bk.status IN ('reserved','checked_in')`).all().filter(b => b.balance > 0)) {
    items.push({ type: 'unpaid', level: 'mid',
      title: `${b.mother_name}（${b.room_name}房）未結 NT$${Number(b.balance).toLocaleString()}`, link: '#/billing' });
  }
  // 在住／已預約但尚無已簽署合約
  for (const b of db.prepare(`
    SELECT bk.id, m.name AS mother_name, r.name AS room_name FROM bookings bk
    JOIN mothers m ON m.id=bk.mother_id JOIN rooms r ON r.id=bk.room_id
    WHERE bk.status IN ('reserved','checked_in')
      AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.booking_id=bk.id AND c.status='signed')`).all()) {
    items.push({ type: 'contract', level: 'mid',
      title: `${b.mother_name}（${b.room_name}房）尚無已簽合約`, link: '#/contracts' });
  }
  // 新生兒篩檢待追蹤
  for (const s of db.prepare(`
    SELECT s.id, s.screen_type, s.result, b.name AS baby_name FROM newborn_screenings s
    JOIN babies b ON b.id=s.baby_id
    WHERE s.follow_up_done=0 AND s.result IN ('pending','refer','abnormal')`).all()) {
    items.push({ type: 'screening', level: s.result === 'refer' || s.result === 'abnormal' ? 'high' : 'mid',
      title: `${s.baby_name} 篩檢待追蹤`, link: '#/newborn-medical' });
  }
  // 未結案異常事件
  for (const i of db.prepare(`SELECT id, category FROM incidents WHERE status!='closed'`).all()) {
    items.push({ type: 'incident', level: 'high', title: `異常事件未結案`, link: '#/incidents' });
  }
  // 今日人力比不足
  const st = staffingCheck(d);
  if (st.babies > 0) for (const s of st.shifts.filter(s => !s.ok)) {
    items.push({ type: 'staffing', level: 'high',
      title: `今日${({ day: '白班', evening: '小夜', night: '大夜' })[s.shift_type]}人力不足（${s.nurses}/${s.required}）`, link: '#/shifts' });
  }
  // 未讀家屬留言
  const unreadMsg = db.prepare(`SELECT COUNT(*) c FROM family_messages WHERE sender='family' AND read_by_staff=0`).get().c;
  if (unreadMsg) items.push({ type: 'message', level: 'mid', title: `${unreadMsg} 則家屬留言未讀`, link: '#/family' });
  // 未讀 LINE／FB 客訊
  const crmUnread = db.prepare('SELECT COALESCE(SUM(unread),0) c FROM crm_contacts').get().c;
  if (crmUnread) items.push({ type: 'crm', level: 'mid', title: `${crmUnread} 則 LINE／FB 訊息未讀`, link: '#/crm' });
  // 智能餵奶提醒：在住寶寶距上次餵奶超過設定間隔
  const feedInterval = Math.max(0.5, parseFloat(getSettings().feed_interval_hours) || 3);
  for (const b of db.prepare(`SELECT b.id, b.name FROM babies b
    WHERE EXISTS (SELECT 1 FROM bookings bk WHERE bk.mother_id=b.mother_id AND bk.status='checked_in')`).all()) {
    const last = db.prepare("SELECT MAX(recorded_at) t FROM baby_records WHERE baby_id=? AND record_type='feeding'").get(b.id).t;
    const hours = last ? (Date.now() - new Date(last.replace(' ', 'T')).getTime()) / 3600000 : 999;
    if (hours >= feedInterval) {
      items.push({ type: 'feeding', level: hours >= feedInterval * 1.5 ? 'high' : 'mid',
        title: last ? `${b.name} 距上次餵奶已 ${Math.floor(hours)} 小時，該餵奶了` : `${b.name} 今日尚無餵奶紀錄`, link: '#/baby-care' });
    }
  }
  // 交班未結待辦
  for (const h of db.prepare(`SELECT id, handover_date, shift_type, follow_up FROM handovers
    WHERE resolved = 0 AND follow_up != '' ORDER BY handover_date DESC, id DESC`).all()) {
    items.push({ type: 'handover', level: 'mid',
      title: `交班待辦：${h.follow_up.slice(0, 30)}${h.follow_up.length > 30 ? '…' : ''}`, due: h.handover_date, link: '#/handover' });
  }
  // 員工證照即將到期／已過期
  const certAlertDays = parseInt(getSettings().cert_alert_days, 10) || 60;
  for (const c of db.prepare(`SELECT c.cert_name, c.expires_on, COALESCE(u.name, c.staff_name) AS person
    FROM staff_certifications c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.expires_on != '' AND c.expires_on <= date(?, '+' || ? || ' days') ORDER BY c.expires_on`).all(d, certAlertDays)) {
    const expired = c.expires_on < d;
    items.push({ type: 'cert', level: expired ? 'high' : 'mid',
      title: `${c.person} 的「${c.cert_name}」${expired ? '已過期' : '即將到期'}（${c.expires_on}）`, due: c.expires_on, link: '#/certifications' });
  }

  const order = { high: 0, mid: 1, low: 2 };
  items.sort((a, b) => (order[a.level] - order[b.level]));
  res.json({ count: items.length, high: items.filter(i => i.level === 'high').length, items });
});

// ---------- 房況視覺月曆 ----------
app.get('/api/room-calendar', requireStaff, (req, res) => {
  const start = req.query.start || today();
  const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 7), 62);
  const end = new Date(new Date(start).getTime() + days * 86400000).toISOString().slice(0, 10);
  const rooms = db.prepare('SELECT id, name, room_type, price_per_day FROM rooms WHERE active=1 ORDER BY name').all();
  const bookings = db.prepare(`
    SELECT bk.id, bk.room_id, bk.check_in, bk.check_out, bk.status, m.name AS mother_name
    FROM bookings bk JOIN mothers m ON m.id=bk.mother_id
    WHERE bk.status != 'cancelled' AND bk.check_in < ? AND bk.check_out > ?
    ORDER BY bk.check_in`).all(end, start);
  res.json({ start, end, days, rooms, bookings });
});

// ---------- 退費試算（依機構定型化契約參數） ----------
app.get('/api/bookings/:id/refund-quote', requireStaff, (req, res) => {
  const bk = db.prepare(`SELECT bk.*, m.name AS mother_name, r.name AS room_name, r.price_per_day
    FROM bookings bk JOIN mothers m ON m.id=bk.mother_id JOIN rooms r ON r.id=bk.room_id
    WHERE bk.id=?`).get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  const s = getSettings();
  const leaveDate = req.query.leave_date || today();
  const totalDays = Math.max(1, Math.round((new Date(bk.check_out) - new Date(bk.check_in)) / 86400000));
  const dailyRate = bk.price_per_day > 0 ? bk.price_per_day : Math.round(bk.total_amount / totalDays);
  // 已使用天數：入住日至離開日（含當日），夾在 0~總天數之間
  let usedDays = Math.round((new Date(leaveDate) - new Date(bk.check_in)) / 86400000) + 1;
  usedDays = Math.min(Math.max(usedDays, 0), totalDays);
  const unusedDays = totalDays - usedDays;
  const paid = bk.deposit + db.prepare('SELECT COALESCE(SUM(amount),0) t FROM payments WHERE booking_id=?').get(bk.id).t;
  const charges = db.prepare('SELECT COALESCE(SUM(unit_price*quantity),0) t FROM charge_items WHERE booking_id=?').get(bk.id).t;
  const usedFee = usedDays * dailyRate;                       // 已使用期間住宿費
  const penaltyPct = Math.min(Math.max(parseFloat(s.refund_penalty_pct) || 0, 0), 100);
  const penalty = Math.round(unusedDays * dailyRate * penaltyPct / 100); // 未使用期間違約金（上限）
  const handlingPct = Math.min(Math.max(parseFloat(s.refund_handling_fee_pct) || 0, 0), 100);
  const handling = Math.round(paid * handlingPct / 100);      // 作業手續費
  const deductible = usedFee + charges + penalty + handling;  // 機構可收取合計
  const refund = Math.max(0, paid - deductible);
  res.json({
    booking_id: bk.id, mother_name: bk.mother_name, room_name: bk.room_name,
    check_in: bk.check_in, check_out: bk.check_out, leave_date: leaveDate,
    total_days: totalDays, used_days: usedDays, unused_days: unusedDays, daily_rate: dailyRate,
    paid_total: paid, charges_total: charges, used_fee: usedFee,
    penalty_pct: penaltyPct, penalty, handling_pct: handlingPct, handling,
    deductible, refund
  });
});

// ---------- 膳食區間統計（給各家月子餐請款對帳） ----------
app.get('/api/meals/summary', requireStaff, (req, res) => {
  const start = req.query.start || today();
  const end = req.query.end || start;
  const rows = db.prepare(`
    SELECT meal_date, meal_type, choice, COUNT(*) c FROM meal_orders
    WHERE meal_date BETWEEN ? AND ? AND choice != '' AND choice != '不需供餐'
    GROUP BY meal_date, meal_type, choice ORDER BY meal_date`).all(start, end);
  const vendors = {};
  for (const r of rows) {
    const v = vendors[r.choice] || (vendors[r.choice] = { choice: r.choice, total: 0, by_meal: {}, by_date: {} });
    v.total += r.c;
    v.by_meal[r.meal_type] = (v.by_meal[r.meal_type] || 0) + r.c;
    v.by_date[r.meal_date] = (v.by_date[r.meal_date] || 0) + r.c;
  }
  res.json({ start, end, vendors: Object.values(vendors).sort((a, b) => b.total - a.total),
    grand_total: rows.reduce((s, r) => s + r.c, 0) });
});

// ---------- 家屬留言（員工端） ----------
app.get('/api/family-messages', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT fm.*, b.name AS baby_name, m.name AS mother_name FROM family_messages fm
    JOIN babies b ON b.id=fm.baby_id JOIN mothers m ON m.id=b.mother_id
    ORDER BY fm.created_at DESC LIMIT 300`).all();
  res.json(rows);
});
app.post('/api/family-messages/:babyId/reply', requireStaff, (req, res) => {
  const baby = db.prepare('SELECT id FROM babies WHERE id=?').get(req.params.babyId);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const body = ((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: '請輸入回覆內容' });
  const info = db.prepare(`INSERT INTO family_messages (baby_id, sender, sender_name, body, staff_id, read_by_staff)
    VALUES (?, 'staff', ?, ?, ?, 1)`).run(req.params.babyId, req.session.user.name, body, req.session.user.id);
  // 標記該寶寶家屬來訊為已讀
  db.prepare(`UPDATE family_messages SET read_by_staff=1 WHERE baby_id=? AND sender='family'`).run(req.params.babyId);
  res.json({ id: info.lastInsertRowid });
});
app.post('/api/family-messages/:babyId/read', requireStaff, (req, res) => {
  db.prepare(`UPDATE family_messages SET read_by_staff=1 WHERE baby_id=? AND sender='family'`).run(req.params.babyId);
  res.json({ ok: true });
});

// ---------- 資料匯出（Excel / PDF）與每日備份 ----------
const BABY_TYPE_TW = { feeding: '餵食', diaper: '換尿布', temperature: '體溫', weight: '體重', jaundice: '黃疸值', bath: '沐浴', sleep: '睡眠', photo: '照片', note: '備註', respiration: '呼吸', heart_rate: '心跳', spo2: '血氧', length: '身長', head_circ: '頭圍', skin: '膚色', cord: '臍帶', vomit: '溢吐奶', activity: '活動力', stool: '大便性狀' };
const MOTHER_TYPE_TW = { vital: '生命徵象', wound: '傷口護理', uterus: '子宮護理', breast: '乳房護理', lochia: '惡露', mood: '情緒評估', education: '衛教', note: '備註', bp: '血壓', pulse: '脈搏', elimination: '排泄', lactation: '泌乳指導', medication: '用藥' };
// 數值型寶寶紀錄的單位（顯示用）
const BABY_UNIT = { temperature: '°C', weight: 'g', jaundice: 'mg/dL', respiration: '次/分', heart_rate: 'bpm', spo2: '%', length: 'cm', head_circ: 'cm' };
const SHIFT_TW = { day: '白班', evening: '小夜', night: '大夜' };
const STATUS_TW = { reserved: '已預約', checked_in: '在住', checked_out: '已退房', cancelled: '已取消' };
const ORDER_STATUS_TW = { pending: '待確認', confirmed: '已確認', cancelled: '已取消' };
const CONTRACT_TW = { pending: '待簽署', signed: '已簽署', void: '已作廢' };
const INCIDENT_TW = { fall: '跌倒', med_error: '給藥錯誤', baby_id_error: '嬰兒辨識錯誤', infection: '感染', burn: '燙傷', equipment: '設備', other: '其他' };
const SEVERITY_TW = { near_miss: '未遂', minor: '輕度', moderate: '中度', severe: '重度', sentinel: '警訊事件' };
const INCIDENT_STATUS_TW = { open: '待處理', processing: '處理中', closed: '已結案' };
const CLUSTER_STATUS_TW = { open: '通報', monitoring: '監測中', closed: '已結案' };
const MED_STATUS_TW = { given: '已給藥', held: '暫停', refused: '拒絕', missed: '漏給' };
const VACCINE_TW = { hepb_immunoglobulin: 'B肝免疫球蛋白', hepb: 'B型肝炎疫苗', bcg: '卡介苗', other: '其他' };
const VACC_STATUS_TW = { scheduled: '待接種', done: '已接種', deferred: '緩種', refused: '拒絕' };
const SCREEN_TW = { hearing: '聽力篩檢', metabolic: '代謝篩檢', cchd: '心臟血氧(CCHD)', other: '其他' };
const SCREEN_RESULT_TW = { pending: '待報告', pass: '通過', refer: '需複篩/轉介', abnormal: '異常' };
const INVOICE_STATUS_TW = { issued: '已開立', void: '已作廢', allowance: '已折讓' };

function babyDetailTW(r) {
  if (r.record_type === 'feeding') return `${r.feed_method || ''}${r.amount_ml ? ` ${r.amount_ml}ml` : ''}`.trim();
  if (r.record_type === 'diaper') {
    const base = r.diaper_kind === '便' ? '大便' : r.diaper_kind === '濕' ? '小便(濕)' : '';
    return r.diaper_rash && r.diaper_rash !== '無' ? `${base}・紅臀${r.diaper_rash}` : base;
  }
  if (BABY_UNIT[r.record_type]) return r.value_num != null ? `${r.value_num} ${BABY_UNIT[r.record_type]}` : '';
  if (['skin', 'cord', 'vomit', 'activity', 'stool'].includes(r.record_type)) return r.value_text || '';
  return '';
}

// 匯出資料集：key -> { label, columns, rows() }
const EXPORTS = {
  mothers: {
    label: '媽媽住客',
    columns: [{ key: 'name', label: '姓名' }, { key: 'phone', label: '電話' }, { key: 'due_date', label: '預產期' }, { key: 'delivery_date', label: '生產日' }, { key: 'delivery_type', label: '生產方式' }, { key: 'diet_notes', label: '飲食禁忌' }, { key: 'medical_notes', label: '醫療注意' }, { key: 'status', label: '狀態' }],
    rows: () => db.prepare('SELECT * FROM mothers ORDER BY id').all()
      .map(m => ({ ...m, status: STATUS_TW[m.status] || m.status }))
  },
  babies: {
    label: '寶寶',
    columns: [{ key: 'name', label: '寶寶' }, { key: 'mother_name', label: '媽媽' }, { key: 'gender', label: '性別' }, { key: 'birth_date', label: '出生日' }, { key: 'birth_weight_g', label: '出生體重(g)' }, { key: 'location', label: '目前位置' }, { key: 'notes', label: '備註' }],
    rows: () => db.prepare(`SELECT b.*, m.name AS mother_name FROM babies b JOIN mothers m ON m.id = b.mother_id ORDER BY b.id`).all()
      .map(b => ({ ...b, gender: b.gender === 'male' ? '男' : b.gender === 'female' ? '女' : '', location: b.location === 'rooming' ? '母嬰同室' : '嬰兒室' }))
  },
  bookings: {
    label: '訂房',
    columns: [{ key: 'mother_name', label: '媽媽' }, { key: 'room_name', label: '房間' }, { key: 'check_in', label: '入住' }, { key: 'check_out', label: '退房' }, { key: 'days', label: '天數' }, { key: 'deposit', label: '訂金' }, { key: 'total_amount', label: '合約總額' }, { key: 'status', label: '狀態' }],
    rows: () => db.prepare(`SELECT bk.*, m.name AS mother_name, r.name AS room_name FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id ORDER BY bk.check_in DESC`).all()
      .map(b => ({ ...b, days: Math.max(0, Math.round((new Date(b.check_out) - new Date(b.check_in)) / 86400000)), status: STATUS_TW[b.status] || b.status }))
  },
  billing: {
    label: '帳務彙總',
    columns: [{ key: 'mother_name', label: '媽媽' }, { key: 'room_name', label: '房間' }, { key: 'total_amount', label: '合約總額' }, { key: 'charges_total', label: '加購' }, { key: 'total_due', label: '應收' }, { key: 'total_paid', label: '已收' }, { key: 'balance', label: '未結餘額' }, { key: 'status', label: '狀態' }],
    rows: () => db.prepare(`SELECT bk.*, m.name AS mother_name, r.name AS room_name, ${BILLING_SUMS}
      FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
      WHERE bk.status != 'cancelled' ORDER BY bk.check_in DESC`).all()
      .map(withBalance).map(b => ({ ...b, status: STATUS_TW[b.status] || b.status }))
  },
  payments: {
    label: '繳費明細',
    columns: [{ key: 'paid_on', label: '日期' }, { key: 'mother_name', label: '媽媽' }, { key: 'room_name', label: '房間' }, { key: 'amount', label: '金額' }, { key: 'method', label: '方式' }, { key: 'note', label: '備註' }, { key: 'staff_name', label: '經手' }],
    rows: () => db.prepare(`SELECT p.*, m.name AS mother_name, r.name AS room_name, u.name AS staff_name FROM payments p JOIN bookings bk ON bk.id = p.booking_id JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id LEFT JOIN users u ON u.id = p.received_by ORDER BY p.paid_on DESC, p.id DESC`).all()
  },
  charges: {
    label: '加購明細',
    columns: [{ key: 'charged_on', label: '日期' }, { key: 'mother_name', label: '媽媽' }, { key: 'room_name', label: '房間' }, { key: 'item_name', label: '項目' }, { key: 'unit_price', label: '單價' }, { key: 'quantity', label: '數量' }, { key: 'subtotal', label: '小計' }, { key: 'note', label: '備註' }, { key: 'staff_name', label: '經手' }],
    rows: () => db.prepare(`SELECT c.*, m.name AS mother_name, r.name AS room_name, u.name AS staff_name FROM charge_items c JOIN bookings bk ON bk.id = c.booking_id JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id LEFT JOIN users u ON u.id = c.created_by ORDER BY c.charged_on DESC, c.id DESC`).all()
      .map(c => ({ ...c, subtotal: (c.unit_price || 0) * (c.quantity || 0) }))
  },
  baby_records: {
    label: '寶寶照護紀錄',
    columns: [{ key: 'recorded_at', label: '時間' }, { key: 'baby_name', label: '寶寶' }, { key: 'type', label: '項目' }, { key: 'detail', label: '內容' }, { key: 'note', label: '備註' }, { key: 'nurse_name', label: '護理師' }],
    rows: () => db.prepare(`SELECT br.*, b.name AS baby_name, u.name AS nurse_name FROM baby_records br JOIN babies b ON b.id = br.baby_id LEFT JOIN users u ON u.id = br.nurse_id ORDER BY br.recorded_at DESC`).all()
      .map(r => ({ recorded_at: r.recorded_at, baby_name: r.baby_name, type: BABY_TYPE_TW[r.record_type] || r.record_type, detail: babyDetailTW(r), note: r.note, nurse_name: r.nurse_name || '' }))
  },
  mother_records: {
    label: '媽媽照護紀錄',
    columns: [{ key: 'recorded_at', label: '時間' }, { key: 'mother_name', label: '媽媽' }, { key: 'type', label: '項目' }, { key: 'value_text', label: '內容' }, { key: 'note', label: '備註' }, { key: 'nurse_name', label: '護理師' }],
    rows: () => db.prepare(`SELECT mr.*, m.name AS mother_name, u.name AS nurse_name FROM mother_records mr JOIN mothers m ON m.id = mr.mother_id LEFT JOIN users u ON u.id = mr.nurse_id ORDER BY mr.recorded_at DESC`).all()
      .map(r => ({ ...r, type: MOTHER_TYPE_TW[r.record_type] || r.record_type, nurse_name: r.nurse_name || '' }))
  },
  contracts: {
    label: '合約',
    columns: [{ key: 'mother_name', label: '媽媽' }, { key: 'room_name', label: '房間' }, { key: 'title', label: '合約' }, { key: 'status', label: '狀態' }, { key: 'signer_name', label: '簽署人' }, { key: 'signer_relation', label: '關係' }, { key: 'signed_at', label: '簽署時間' }, { key: 'signed_ip', label: '簽署IP' }, { key: 'created_at', label: '建立時間' }, { key: 'created_by_name', label: '建立者' }],
    rows: () => db.prepare(`SELECT c.*, m.name AS mother_name, r.name AS room_name, u.name AS created_by_name FROM contracts c LEFT JOIN bookings bk ON bk.id = c.booking_id LEFT JOIN mothers m ON m.id = bk.mother_id LEFT JOIN rooms r ON r.id = bk.room_id LEFT JOIN users u ON u.id = c.created_by ORDER BY c.id DESC`).all()
      .map(c => ({ ...c, status: CONTRACT_TW[c.status] || c.status }))
  },
  tours: {
    label: '參觀預約',
    columns: [{ key: 'name', label: '姓名' }, { key: 'phone', label: '電話' }, { key: 'due_date', label: '預產期' }, { key: 'tour_at', label: '參觀時間' }, { key: 'source', label: '來源' }, { key: 'status', label: '狀態' }, { key: 'note', label: '備註' }],
    rows: () => { const map = { scheduled: '待參觀', visited: '已參觀', signed: '已簽約', lost: '未成交' }; return db.prepare('SELECT * FROM tours ORDER BY tour_at DESC').all().map(t => ({ ...t, status: map[t.status] || t.status })); }
  },
  shifts: {
    label: '排班',
    columns: [{ key: 'shift_date', label: '日期' }, { key: 'shift', label: '班別' }, { key: 'nurse_name', label: '人員' }],
    rows: () => db.prepare(`SELECT s.*, u.name AS nurse_name FROM shifts s JOIN users u ON u.id = s.user_id ORDER BY s.shift_date DESC, s.shift_type`).all()
      .map(s => ({ shift_date: s.shift_date, shift: SHIFT_TW[s.shift_type] || s.shift_type, nurse_name: s.nurse_name }))
  },
  handovers: {
    label: '護理交班',
    columns: [{ key: 'handover_date', label: '日期' }, { key: 'shift', label: '班別' }, { key: 'nurse_name', label: '交班人' }, { key: 'situation', label: '現況(S)' }, { key: 'background', label: '背景(B)' }, { key: 'assessment', label: '評估(A)' }, { key: 'recommendation', label: '建議(R)' }],
    rows: () => db.prepare(`SELECT h.*, u.name AS nurse_name FROM handovers h JOIN users u ON u.id = h.nurse_id ORDER BY h.handover_date DESC, h.shift_type`).all()
      .map(h => ({ ...h, shift: SHIFT_TW[h.shift_type] || h.shift_type }))
  },
  family_members: {
    label: '家屬帳號',
    columns: [{ key: 'baby_name', label: '寶寶' }, { key: 'name', label: '家屬' }, { key: 'relation', label: '關係' }, { key: 'access_code', label: '通行碼' }, { key: 'line_bound', label: 'LINE綁定' }, { key: 'active', label: '啟用' }],
    rows: () => db.prepare(`SELECT f.*, b.name AS baby_name FROM family_members f JOIN babies b ON b.id = f.baby_id ORDER BY f.id`).all()
      .map(f => ({ ...f, line_bound: f.line_user_id ? '是' : '否', active: f.active ? '是' : '否' }))
  },
  incidents: {
    label: '異常不良事件',
    columns: [{ key: 'occurred_at', label: '發生時間' }, { key: 'category', label: '類別' }, { key: 'severity', label: '嚴重度' }, { key: 'location', label: '地點' }, { key: 'subject', label: '對象' }, { key: 'description', label: '事件描述' }, { key: 'immediate_action', label: '立即處置' }, { key: 'follow_up', label: '後續追蹤' }, { key: 'status', label: '狀態' }, { key: 'reported_by_name', label: '通報人' }],
    rows: () => db.prepare(`SELECT i.*, COALESCE(m.name, b.name, i.subject) AS subject2, u.name AS reported_by_name FROM incidents i LEFT JOIN mothers m ON m.id = i.mother_id LEFT JOIN babies b ON b.id = i.baby_id LEFT JOIN users u ON u.id = i.reported_by ORDER BY i.occurred_at DESC`).all()
      .map(i => ({ ...i, category: INCIDENT_TW[i.category] || i.category, severity: SEVERITY_TW[i.severity] || i.severity, subject: i.subject || i.subject2 || '', status: INCIDENT_STATUS_TW[i.status] || i.status }))
  },
  hand_hygiene: {
    label: '洗手稽核',
    columns: [{ key: 'audit_date', label: '日期' }, { key: 'area', label: '區域' }, { key: 'observed_role', label: '對象' }, { key: 'opportunities', label: '觀察時機' }, { key: 'compliant', label: '確實執行' }, { key: 'rate', label: '遵從率%' }, { key: 'observer_name', label: '稽核人' }, { key: 'note', label: '備註' }],
    rows: () => db.prepare(`SELECT h.*, u.name AS observer_name FROM hand_hygiene_audits h LEFT JOIN users u ON u.id = h.observer_id ORDER BY h.audit_date DESC`).all()
      .map(h => ({ ...h, rate: h.opportunities ? Math.round(h.compliant / h.opportunities * 1000) / 10 : 0 }))
  },
  disinfection: {
    label: '環境清消簽核',
    columns: [{ key: 'disinfect_date', label: '日期' }, { key: 'area', label: '區域/設備' }, { key: 'agent', label: '消毒方式' }, { key: 'operator_name', label: '執行人' }, { key: 'verified_name', label: '覆核人' }, { key: 'note', label: '備註' }],
    rows: () => db.prepare(`SELECT d.*, o.name AS operator_name, v.name AS verified_name FROM disinfection_logs d LEFT JOIN users o ON o.id = d.operator_id LEFT JOIN users v ON v.id = d.verified_by ORDER BY d.disinfect_date DESC`).all()
  },
  clusters: {
    label: '群聚事件',
    columns: [{ key: 'onset_date', label: '起始日' }, { key: 'pathogen', label: '病原' }, { key: 'affected_count', label: '影響人數' }, { key: 'description', label: '描述' }, { key: 'control_action', label: '防治措施' }, { key: 'reported', label: '通報主管機關' }, { key: 'status', label: '狀態' }],
    rows: () => db.prepare(`SELECT * FROM cluster_events ORDER BY onset_date DESC`).all()
      .map(c => ({ ...c, reported: c.reported_to_authority ? `是(${c.reported_at})` : '否', status: CLUSTER_STATUS_TW[c.status] || c.status }))
  },
  medications: {
    label: '新生兒給藥(MAR)',
    columns: [{ key: 'administered_at', label: '給藥時間' }, { key: 'baby_name', label: '寶寶' }, { key: 'drug_name', label: '藥品' }, { key: 'dose', label: '劑量' }, { key: 'route', label: '途徑' }, { key: 'status', label: '狀態' }, { key: 'ordered_by', label: '醫囑' }, { key: 'nurse_name', label: '給藥者' }, { key: 'note', label: '備註' }],
    rows: () => db.prepare(`SELECT a.*, b.name AS baby_name, u.name AS nurse_name FROM med_administrations a JOIN babies b ON b.id = a.baby_id LEFT JOIN users u ON u.id = a.nurse_id ORDER BY a.administered_at DESC, a.id DESC`).all()
      .map(a => ({ ...a, status: MED_STATUS_TW[a.status] || a.status }))
  },
  vaccinations: {
    label: '新生兒疫苗',
    columns: [{ key: 'baby_name', label: '寶寶' }, { key: 'vaccine', label: '疫苗' }, { key: 'dose_no', label: '劑次' }, { key: 'administered_at', label: '接種時間' }, { key: 'lot_no', label: '批號' }, { key: 'site', label: '部位' }, { key: 'status', label: '狀態' }, { key: 'nurse_name', label: '執行者' }],
    rows: () => db.prepare(`SELECT v.*, b.name AS baby_name, u.name AS nurse_name FROM vaccinations v JOIN babies b ON b.id = v.baby_id LEFT JOIN users u ON u.id = v.nurse_id ORDER BY v.id DESC`).all()
      .map(v => ({ ...v, vaccine: VACCINE_TW[v.vaccine] || v.vaccine, status: VACC_STATUS_TW[v.status] || v.status }))
  },
  screenings: {
    label: '新生兒篩檢追蹤',
    columns: [{ key: 'baby_name', label: '寶寶' }, { key: 'screen_type', label: '項目' }, { key: 'screened_at', label: '篩檢時間' }, { key: 'result', label: '結果' }, { key: 'follow_up', label: '追蹤' }, { key: 'follow_up_done', label: '追蹤完成' }, { key: 'nurse_name', label: '紀錄者' }],
    rows: () => db.prepare(`SELECT s.*, b.name AS baby_name, u.name AS nurse_name FROM newborn_screenings s JOIN babies b ON b.id = s.baby_id LEFT JOIN users u ON u.id = s.nurse_id ORDER BY s.id DESC`).all()
      .map(s => ({ ...s, screen_type: SCREEN_TW[s.screen_type] || s.screen_type, result: SCREEN_RESULT_TW[s.result] || s.result, follow_up_done: s.follow_up_done ? '是' : '否' }))
  },
  phototherapy: {
    label: '光照治療',
    columns: [{ key: 'baby_name', label: '寶寶' }, { key: 'start_at', label: '開始' }, { key: 'end_at', label: '結束' }, { key: 'bilirubin_before', label: '治療前膽紅素' }, { key: 'bilirubin_after', label: '治療後膽紅素' }, { key: 'device', label: '設備' }, { key: 'nurse_name', label: '紀錄者' }, { key: 'note', label: '備註' }],
    rows: () => db.prepare(`SELECT p.*, b.name AS baby_name, u.name AS nurse_name FROM phototherapy_logs p JOIN babies b ON b.id = p.baby_id LEFT JOIN users u ON u.id = p.nurse_id ORDER BY p.start_at DESC`).all()
  },
  invoices: {
    label: '電子發票/收據',
    columns: [{ key: 'invoice_date', label: '日期' }, { key: 'doc_type', label: '類型' }, { key: 'invoice_number', label: '發票號碼' }, { key: 'mother_name', label: '買受人' }, { key: 'sales_amount', label: '銷售額' }, { key: 'tax_amount', label: '稅額' }, { key: 'total_amount', label: '總計' }, { key: 'status', label: '狀態' }, { key: 'allowance_amount', label: '折讓' }, { key: 'created_by_name', label: '開立者' }],
    rows: () => db.prepare(`SELECT i.*, COALESCE(m.name, i.buyer_name) AS mother_name, u.name AS created_by_name FROM invoices i LEFT JOIN bookings bk ON bk.id = i.booking_id LEFT JOIN mothers m ON m.id = bk.mother_id LEFT JOIN users u ON u.id = i.created_by ORDER BY i.id DESC`).all()
      .map(i => ({ ...i, doc_type: i.doc_type === 'invoice' ? '電子發票' : '收據', status: INVOICE_STATUS_TW[i.status] || i.status }))
  },
  products: {
    label: '商城商品',
    columns: [{ key: 'name', label: '品名' }, { key: 'category', label: '分類' }, { key: 'price', label: '售價' }, { key: 'cost', label: '成本' }, { key: 'track', label: '管控庫存' }, { key: 'stock', label: '庫存' }, { key: 'active', label: '上架' }],
    rows: () => db.prepare('SELECT * FROM products ORDER BY id DESC').all()
      .map(p => ({ ...p, track: p.track_stock ? '是' : '否', active: p.active ? '上架' : '下架' }))
  },
  orders: {
    label: '商城訂單',
    columns: [{ key: 'created_at', label: '時間' }, { key: 'mother_name', label: '媽媽' }, { key: 'source', label: '來源' }, { key: 'items', label: '品項' }, { key: 'subtotal', label: '小計' }, { key: 'discount', label: '折抵' }, { key: 'coupon_code', label: '優惠券' }, { key: 'points_used', label: '折抵點數' }, { key: 'total_amount', label: '應收' }, { key: 'points_earned', label: '回饋點數' }, { key: 'status', label: '狀態' }, { key: 'staff_name', label: '經手' }],
    rows: () => db.prepare(`SELECT o.*, m.name AS mother_name, f.name AS family_name, u.name AS staff_name FROM orders o LEFT JOIN mothers m ON m.id = o.mother_id LEFT JOIN family_members f ON f.id = o.family_id LEFT JOIN users u ON u.id = o.created_by ORDER BY o.id DESC`).all()
      .map(o => ({ ...o, source: o.placed_by === 'family' ? `家屬:${o.family_name || ''}` : '代客', items: db.prepare('SELECT item_name, quantity FROM order_items WHERE order_id = ?').all(o.id).map(i => `${i.item_name}×${i.quantity}`).join('、'), status: ORDER_STATUS_TW[o.status] || o.status }))
  },
  supplies: {
    label: '耗材庫存',
    columns: [{ key: 'name', label: '品名' }, { key: 'category', label: '分類' }, { key: 'unit', label: '單位' }, { key: 'stock', label: '庫存' }, { key: 'safety_stock', label: '安全庫存' }, { key: 'low', label: '需補貨' }, { key: 'active', label: '啟用' }],
    rows: () => db.prepare('SELECT * FROM supplies ORDER BY category, name').all()
      .map(s => ({ ...s, low: s.stock <= s.safety_stock ? '是' : '', active: s.active ? '是' : '否' }))
  },
  supply_txns: {
    label: '耗材異動',
    columns: [{ key: 'created_at', label: '時間' }, { key: 'supply_name', label: '品名' }, { key: 'type', label: '類型' }, { key: 'quantity', label: '數量' }, { key: 'balance_after', label: '結存' }, { key: 'reason', label: '事由' }, { key: 'note', label: '備註' }, { key: 'staff_name', label: '經手' }],
    rows: () => db.prepare(`SELECT st.*, s.name AS supply_name, u.name AS staff_name FROM supply_txns st JOIN supplies s ON s.id = st.supply_id LEFT JOIN users u ON u.id = st.created_by ORDER BY st.id DESC`).all()
      .map(t => ({ ...t, type: { in: '進貨', out: '領用', adjust: '盤點' }[t.txn_type] || t.txn_type }))
  },
  programs: {
    label: '課程與服務',
    columns: [{ key: 'kind', label: '類型' }, { key: 'name', label: '名稱' }, { key: 'category', label: '分類' }, { key: 'price', label: '費用' }, { key: 'capacity', label: '名額' }, { key: 'scheduled_at', label: '時間' }, { key: 'location', label: '地點' }, { key: 'active', label: '開放' }],
    rows: () => db.prepare('SELECT * FROM programs ORDER BY id DESC').all()
      .map(p => ({ ...p, kind: p.kind === 'service' ? '服務' : '課程', capacity: p.capacity > 0 ? p.capacity : '不限', active: p.active ? '是' : '否' }))
  },
  signups: {
    label: '課程報名',
    columns: [{ key: 'created_at', label: '時間' }, { key: 'program_name', label: '項目' }, { key: 'mother_name', label: '媽媽' }, { key: 'source', label: '來源' }, { key: 'quantity', label: '數量' }, { key: 'status', label: '狀態' }, { key: 'note', label: '備註' }],
    rows: () => db.prepare(`SELECT s.*, p.name AS program_name, m.name AS mother_name, f.name AS family_name FROM program_signups s JOIN programs p ON p.id = s.program_id LEFT JOIN mothers m ON m.id = s.mother_id LEFT JOIN family_members f ON f.id = s.family_id ORDER BY s.id DESC`).all()
      .map(s => ({ ...s, source: s.placed_by === 'family' ? `家屬:${s.family_name || ''}` : '代客', status: ORDER_STATUS_TW[s.status] || s.status }))
  },
  coupons: {
    label: '優惠券',
    columns: [{ key: 'code', label: '優惠碼' }, { key: 'name', label: '名稱' }, { key: 'discount', label: '折扣' }, { key: 'min_spend', label: '最低消費' }, { key: 'used_count', label: '已用' }, { key: 'usage_limit', label: '上限' }, { key: 'valid_from', label: '起日' }, { key: 'valid_to', label: '迄日' }, { key: 'active', label: '啟用' }],
    rows: () => db.prepare('SELECT * FROM coupons ORDER BY id DESC').all()
      .map(c => ({ ...c, discount: c.discount_type === 'percent' ? `${c.discount_value}%` : `${c.discount_value}元`, usage_limit: c.usage_limit || '不限', active: c.active ? '是' : '否' }))
  },
  members: {
    label: '會員點數',
    columns: [{ key: 'member_no', label: '會員編號' }, { key: 'name', label: '姓名' }, { key: 'phone', label: '電話' }, { key: 'points', label: '點數' }, { key: 'status', label: '狀態' }],
    rows: () => db.prepare('SELECT id, name, phone, member_no, points, status FROM mothers ORDER BY id DESC').all()
      .map(m => ({ ...m, status: STATUS_TW[m.status] || m.status }))
  },
  certifications: {
    label: '員工證照',
    columns: [{ key: 'person', label: '員工' }, { key: 'cert_name', label: '證照' }, { key: 'cert_no', label: '證號' }, { key: 'issuer', label: '發證單位' }, { key: 'issued_on', label: '發證日' }, { key: 'expires_on', label: '到期日' }, { key: 'note', label: '備註' }],
    rows: () => db.prepare(`SELECT c.*, COALESCE(u.name, c.staff_name) AS person FROM staff_certifications c LEFT JOIN users u ON u.id = c.user_id ORDER BY (c.expires_on='') , c.expires_on`).all()
  },
  survey_responses: {
    label: '問卷回應',
    columns: [{ key: 'submitted_at', label: '時間' }, { key: 'survey_title', label: '問卷' }, { key: 'mother_name', label: '住客' }, { key: 'family_name', label: '填寫家屬' }, { key: 'answers', label: '回答' }],
    rows: () => db.prepare(`SELECT r.*, s.title AS survey_title, m.name AS mother_name, f.name AS family_name, s.questions FROM survey_responses r JOIN surveys s ON s.id = r.survey_id LEFT JOIN mothers m ON m.id = r.mother_id LEFT JOIN family_members f ON f.id = r.family_id ORDER BY r.id DESC`).all()
      .map(r => { let qs = [], a = {}; try { qs = JSON.parse(r.questions || '[]'); } catch (e) {} try { a = JSON.parse(r.answers || '{}'); } catch (e) {}
        return { ...r, answers: qs.map((q, i) => `${q.label}：${a[i] ?? ''}`).join('；') }; })
  },
  gov_submissions: {
    label: '衛福部通報',
    columns: [{ key: 'title', label: '表單' }, { key: 'period', label: '期間' }, { key: 'status', label: '狀態' }, { key: 'attempts', label: '嘗試' }, { key: 'ack_no', label: '回執' }, { key: 'uploaded_at', label: '上傳時間' }, { key: 'last_error', label: '最後錯誤' }],
    rows: () => db.prepare('SELECT * FROM gov_submissions ORDER BY id DESC').all()
      .map(g => ({ ...g, status: ({ pending: '待上傳', uploaded: '已上傳', failed: '失敗' })[g.status] || g.status }))
  },
  audit_logs: {
    label: '稽核軌跡',
    columns: [{ key: 'created_at', label: '時間' }, { key: 'user_name', label: '操作者' }, { key: 'role', label: '角色' }, { key: 'action', label: '動作' }, { key: 'entity', label: '對象' }, { key: 'entity_id', label: 'ID' }, { key: 'path', label: '路徑' }, { key: 'summary', label: '摘要' }, { key: 'ip', label: 'IP' }],
    rows: () => db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 5000').all()
  }
};

app.get('/api/export/datasets', requireStaff, (req, res) => {
  res.json(Object.entries(EXPORTS).map(([key, d]) => ({ key, label: d.label })));
});

app.get('/api/export/:key', requireStaff, (req, res) => {
  const d = EXPORTS[req.params.key];
  if (!d) return res.status(404).json({ error: '找不到資料集' });
  const columns = d.columns;
  const rows = d.rows();
  if (req.query.format === 'xlsx') {
    const buf = buildWorkbook(d.label, columns, rows);
    const fname = encodeURIComponent(`${d.label}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}.xlsx"; filename*=UTF-8''${fname}`);
    return res.send(buf);
  }
  if (req.query.format === 'pdf') {
    const py = require('child_process').spawn('python3', [path.join(__dirname, '..', 'scripts', 'table_pdf.py')]);
    const chunks = []; let err = '';
    py.stdout.on('data', c => chunks.push(c));
    py.stderr.on('data', c => { err += c; });
    py.on('error', e => { if (!res.headersSent) res.status(500).json({ error: 'PDF 產生失敗：' + e.message }); });
    py.on('close', code => {
      if (code !== 0 || !chunks.length) return res.status(500).json({ error: 'PDF 產生失敗：' + err.slice(0, 200) });
      const fname = encodeURIComponent(`${d.label}.pdf`);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}.pdf"; filename*=UTF-8''${fname}`);
      res.send(Buffer.concat(chunks));
    });
    py.stdin.on('error', () => {});
    py.stdin.write(JSON.stringify({ title: d.label, columns, rows, date: today() }));
    py.stdin.end();
    return;
  }
  res.json({ key: req.params.key, label: d.label, columns, rows });
});

// 每日備份（限管理員）
app.get('/api/backups', requireAdmin, (req, res) => {
  const list = backup.listBackups();
  res.json({ last: list[0] || null, retain: Number(process.env.BACKUP_RETAIN || 30), backups: list });
});

app.post('/api/backups', requireAdmin, async (req, res) => {
  try { res.json(await backup.runBackup(true)); }
  catch (e) { res.status(500).json({ error: '備份失敗：' + e.message }); }
});

app.get('/api/backups/:name', requireAdmin, (req, res) => {
  const p = backup.backupFilePath(req.params.name);
  if (!p) return res.status(404).json({ error: '找不到備份檔' });
  res.download(p, req.params.name);
});

// 還原：以指定備份覆蓋現行資料庫，還原前自動保留安全備份，完成後自動重啟程式
app.post('/api/backups/:name/restore', requireAdmin, async (req, res) => {
  if (!backup.backupFilePath(req.params.name)) return res.status(404).json({ error: '找不到備份檔' });
  logAudit(req, { action: 'restore', entity: 'backups', entity_id: req.params.name, summary: '資料庫還原' });
  try {
    const r = await backup.restore(req.params.name);
    res.json({ ok: true, ...r, message: '還原完成，系統將於數秒後自動重啟以套用。' });
    setTimeout(() => process.exit(0), 400); // pm2 會自動重啟並乾淨重開資料庫
  } catch (e) {
    res.status(500).json({ error: '還原失敗：' + e.message });
  }
});

// ---------- 排班與人力比 ----------

// 依訂房推算某日在住嬰兒數：涵蓋過去（已退房）、今日（入住中）與未來（預約），
// 評鑑月報與未來排班規劃才有正確基數
function babiesInHouseOn(date) {
  return db.prepare(`
    SELECT COUNT(*) c FROM babies b
    WHERE EXISTS (
      SELECT 1 FROM bookings bk
      WHERE bk.mother_id = b.mother_id AND bk.status != 'cancelled'
        AND bk.check_in <= ? AND bk.check_out > ?
    )`).get(date, date).c;
}

function staffingCheck(date) {
  const ratio = Math.max(1, parseInt(getSettings().nurse_baby_ratio, 10) || 1);
  const babiesIn = babiesInHouseOn(date);
  const shifts = ['day', 'evening', 'night'].map(st => {
    const nurses = db.prepare(`
      SELECT COUNT(*) c FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.shift_date = ? AND s.shift_type = ? AND u.active = 1`).get(date, st).c;
    const required = Math.ceil(babiesIn / ratio);
    return { shift_type: st, nurses, required, ok: nurses >= required };
  });
  return { date, babies: babiesIn, ratio, shifts };
}

// 區間內的異常照護紀錄，門檻取自系統設定
function abnormalRecords(startDate, endDate) {
  const s = getSettings();
  const severe = RASH_SEVERE.map(() => '?').join(',');
  return db.prepare(`
    SELECT br.recorded_at, br.record_type, br.value_num, br.diaper_rash, b.name AS baby_name
    FROM baby_records br JOIN babies b ON b.id = br.baby_id
    WHERE date(br.recorded_at) BETWEEN ? AND ? AND (
      (br.record_type = 'temperature' AND (br.value_num >= ? OR br.value_num <= ?)) OR
      (br.record_type = 'jaundice' AND br.value_num >= ?) OR
      (br.record_type = 'diaper' AND br.diaper_rash IN (${severe}))
    ) ORDER BY br.recorded_at DESC`).all(
    startDate, endDate,
    parseFloat(s.temp_high), parseFloat(s.temp_low), parseFloat(s.jaundice_alert),
    ...RASH_SEVERE);
}

app.get('/api/shifts', requireStaff, (req, res) => {
  const start = req.query.start || today();
  const days = Math.min(parseInt(req.query.days || '7', 10), 31);
  const end = new Date(new Date(start).getTime() + days * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id
    WHERE s.shift_date >= ? AND s.shift_date < ? ORDER BY s.shift_date, s.shift_type`).all(start, end);
  res.json(rows);
});

app.post('/api/shifts', requireStaff, (req, res) => {
  const s = req.body || {};
  if (!s.user_id || !s.shift_date || !s.shift_type) {
    return res.status(400).json({ error: '人員、日期、班別必填' });
  }
  db.prepare('INSERT OR IGNORE INTO shifts (user_id, shift_date, shift_type) VALUES (?,?,?)')
    .run(s.user_id, s.shift_date, s.shift_type);
  res.json({ ok: true });
});

app.delete('/api/shifts/:id', requireStaff, (req, res) => {
  db.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/staffing-check', requireStaff, (req, res) => {
  res.json(staffingCheck(req.query.date || today()));
});

// ---------- 評鑑月報（衛福部產後護理機構評鑑佐證） ----------
app.get('/api/reports/monthly', requireStaff, (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: '月份格式需為 YYYY-MM' });
  }
  res.json(computeMonthlyReport(month));
});

// 評鑑月報一鍵 PDF（以 python/reportlab 產生中文 PDF）
app.get('/api/reports/monthly.pdf', requireStaff, (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '月份格式需為 YYYY-MM' });
  const report = computeMonthlyReport(month);
  report.center_name = getSettings().center_name || '';
  const py = require('child_process').spawn('python3', [path.join(__dirname, '..', 'scripts', 'report_pdf.py')]);
  const chunks = []; let err = '';
  py.stdout.on('data', c => chunks.push(c));
  py.stderr.on('data', c => { err += c; });
  py.on('error', e => { if (!res.headersSent) res.status(500).json({ error: 'PDF 產生失敗：' + e.message }); });
  py.on('close', code => {
    if (code !== 0 || !chunks.length) return res.status(500).json({ error: 'PDF 產生失敗：' + err.slice(0, 200) });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="monthly-report-${month}.pdf"`);
    res.send(Buffer.concat(chunks));
  });
  py.stdin.on('error', () => {});
  py.stdin.write(JSON.stringify(report));
  py.stdin.end();
});
// 經營分析：近 N 個月入住率／實收／客源轉換／商城毛利等趨勢
app.get('/api/reports/analytics', requireStaff, (req, res) => {
  const n = Math.min(Math.max(parseInt(req.query.months || '12', 10), 3), 24);
  const base = new Date(today() + 'T00:00:00');
  const months = [];
  for (let i = n - 1; i >= 0; i--) months.push(new Date(base.getFullYear(), base.getMonth() - i, 1).toISOString().slice(0, 7));
  const startDate = months[0] + '-01';
  const totalRooms = db.prepare('SELECT COUNT(*) c FROM rooms WHERE active=1').get().c;
  const bookings = db.prepare("SELECT check_in, check_out FROM bookings WHERE status!='cancelled' AND check_out > ?").all(startDate);
  const payMap = {}; for (const r of db.prepare("SELECT substr(paid_on,1,7) m, SUM(amount) s FROM payments GROUP BY m").all()) payMap[r.m] = r.s;
  const tourMap = {}; for (const r of db.prepare("SELECT substr(tour_at,1,7) m, COUNT(*) c, SUM(CASE WHEN status='signed' THEN 1 ELSE 0 END) s FROM tours GROUP BY m").all()) tourMap[r.m] = r;
  const admMap = {}; for (const r of db.prepare("SELECT substr(check_in,1,7) m, COUNT(*) c FROM bookings WHERE status!='cancelled' GROUP BY m").all()) admMap[r.m] = r.c;
  const disMap = {}; for (const r of db.prepare("SELECT substr(check_out,1,7) m, COUNT(*) c FROM bookings WHERE status!='cancelled' GROUP BY m").all()) disMap[r.m] = r.c;
  const shopRevMap = {}; for (const r of db.prepare("SELECT substr(confirmed_at,1,7) m, SUM(total_amount) s FROM orders WHERE status='confirmed' AND confirmed_at!='' GROUP BY m").all()) shopRevMap[r.m] = r.s;
  const shopCostMap = {}; for (const r of db.prepare(`SELECT substr(o.confirmed_at,1,7) m, SUM(oi.quantity*COALESCE(p.cost,0)) c
    FROM orders o JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id
    WHERE o.status='confirmed' AND o.confirmed_at!='' GROUP BY m`).all()) shopCostMap[r.m] = r.c;
  const series = months.map(m => {
    const [y, mo] = m.split('-').map(Number);
    const dim = new Date(y, mo, 0).getDate();
    const mStart = new Date(`${m}-01T00:00:00`).getTime();
    const mEnd = new Date(y, mo, 1).getTime(); // 次月一日
    let roomNights = 0;
    for (const b of bookings) {
      const ci = new Date(b.check_in + 'T00:00:00').getTime(), co = new Date(b.check_out + 'T00:00:00').getTime();
      const ov = Math.min(co, mEnd) - Math.max(ci, mStart);
      if (ov > 0) roomNights += ov / 86400000;
    }
    const t = tourMap[m] || { c: 0, s: 0 };
    const shopRev = shopRevMap[m] || 0, shopCost = shopCostMap[m] || 0;
    return {
      month: m,
      occupancy_rate: totalRooms ? Math.round(roomNights / (totalRooms * dim) * 1000) / 10 : 0,
      payments_received: payMap[m] || 0,
      admissions: admMap[m] || 0,
      discharges: disMap[m] || 0,
      tours: t.c, signed: t.s,
      conversion: t.c ? Math.round(t.s / t.c * 1000) / 10 : 0,
      shop_revenue: shopRev, shop_cost: shopCost, shop_margin: shopRev - shopCost
    };
  });
  res.json({ months: n, total_rooms: totalRooms, series });
});

function computeMonthlyReport(month) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const totalRooms = db.prepare('SELECT COUNT(*) c FROM rooms WHERE active = 1').get().c;
  const occupiedOn = db.prepare(`
    SELECT COUNT(DISTINCT room_id) c FROM bookings
    WHERE status != 'cancelled' AND check_in <= ? AND check_out > ?`);
  const recordsOn = db.prepare(
    'SELECT COUNT(*) c FROM baby_records WHERE date(recorded_at) = ?');
  const motherRecordsOn = db.prepare(
    'SELECT COUNT(*) c FROM mother_records WHERE date(recorded_at) = ?');
  const handoversOn = db.prepare(
    'SELECT COUNT(*) c FROM handovers WHERE handover_date = ?');
  // 當日發生紅臀（輕度以上）的換尿布紀錄筆數
  const occurredIn = RASH_OCCURRED.map(() => '?').join(',');
  const rashOn = db.prepare(
    `SELECT COUNT(*) c FROM baby_records
     WHERE record_type = 'diaper' AND diaper_rash IN (${occurredIn}) AND date(recorded_at) = ?`);

  const days = [];
  for (let i = 1; i <= daysInMonth; i++) {
    const date = `${month}-${String(i).padStart(2, '0')}`;
    const staffing = staffingCheck(date);
    days.push({
      date,
      occupied_rooms: occupiedOn.get(date, date).c,
      babies: staffing.babies,
      baby_records: recordsOn.get(date).c,
      mother_records: motherRecordsOn.get(date).c,
      handovers: handoversOn.get(date).c,
      rash_records: rashOn.get(...RASH_OCCURRED, date).c,
      staffing: staffing.shifts,
      staffing_ok: staffing.shifts.every(s => s.ok)
    });
  }
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const occupiedDays = days.reduce((s, d) => s + d.occupied_rooms, 0);
  // 紅臀發生率 = 當月曾發生紅臀的寶寶數 ÷ 當月受照護寶寶數（有任一照護紀錄者）
  const caredBabies = db.prepare(
    'SELECT COUNT(DISTINCT baby_id) c FROM baby_records WHERE date(recorded_at) BETWEEN ? AND ?')
    .get(start, end).c;
  const rashBabies = db.prepare(
    `SELECT COUNT(DISTINCT baby_id) c FROM baby_records
     WHERE record_type = 'diaper' AND diaper_rash IN (${occurredIn})
       AND date(recorded_at) BETWEEN ? AND ?`).get(...RASH_OCCURRED, start, end).c;
  // 異常／不良事件（依發生月份）
  const incidentRows = db.prepare(
    `SELECT category, severity, status FROM incidents WHERE strftime('%Y-%m', occurred_at) = ?`).all(month);
  const incidentByCategory = {};
  for (const r of incidentRows) incidentByCategory[r.category] = (incidentByCategory[r.category] || 0) + 1;
  // 手部衛生遵從率（當月稽核加總）
  const hh = db.prepare(
    `SELECT COALESCE(SUM(opportunities),0) opp, COALESCE(SUM(compliant),0) comp
     FROM hand_hygiene_audits WHERE strftime('%Y-%m', audit_date) = ?`).get(month);
  const hhTarget = parseFloat(getSettings().hand_hygiene_target) || 0;
  const hhRate = hh.opp ? Math.round(hh.comp / hh.opp * 1000) / 10 : null;
  // 清消簽核次數、群聚事件數
  const disinfectCount = db.prepare(
    `SELECT COUNT(*) c FROM disinfection_logs WHERE strftime('%Y-%m', disinfect_date) = ?`).get(month).c;
  const clusterCount = db.prepare(
    `SELECT COUNT(*) c FROM cluster_events WHERE strftime('%Y-%m', onset_date) = ?`).get(month).c;
  // 待追蹤篩檢（全機構在追蹤者）
  const screeningPending = db.prepare(
    `SELECT COUNT(*) c FROM newborn_screenings
     WHERE follow_up_done = 0 AND result IN ('pending','refer','abnormal')`).get().c;

  // ---- 營收統計（當月）----
  // 當月實收（繳費）與應收加購（含商城／課程折抵後淨額）
  const paymentsReceived = db.prepare(
    'SELECT COALESCE(SUM(amount),0) s FROM payments WHERE paid_on BETWEEN ? AND ?').get(start, end).s;
  const sumCharge = where => db.prepare(
    `SELECT COALESCE(SUM(unit_price*quantity),0) s FROM charge_items WHERE charged_on BETWEEN ? AND ? ${where}`).get(start, end).s;
  const addonBilled = sumCharge('');
  const shopNet = sumCharge("AND note LIKE '商城%'");          // 商品銷售（含優惠折抵）
  const programRevenue = sumCharge("AND note LIKE '報名#%'");  // 課程／服務
  const otherAddon = addonBilled - shopNet - programRevenue;   // 其他加購（手動）
  // 商城／課程當月確認筆數與會員點數、優惠券（依確認月份）
  const shopOrders = db.prepare(
    "SELECT COUNT(*) c, COALESCE(SUM(points_earned),0) earned, COALESCE(SUM(points_used),0) used, COALESCE(SUM(CASE WHEN coupon_code <> '' THEN 1 ELSE 0 END),0) coupons FROM orders WHERE status='confirmed' AND strftime('%Y-%m', confirmed_at) = ?").get(month);
  const programConfirmed = db.prepare(
    "SELECT COUNT(*) c FROM program_signups WHERE status='confirmed' AND strftime('%Y-%m', confirmed_at) = ?").get(month).c;
  const revenue = {
    payments_received: paymentsReceived,
    addon_billed: addonBilled,
    shop_net: shopNet,
    program_revenue: programRevenue,
    other_addon: otherAddon,
    shop_orders: shopOrders.c,
    program_signups: programConfirmed,
    points_earned: shopOrders.earned,
    points_redeemed: shopOrders.used,
    coupons_used: shopOrders.coupons
  };
  return {
    revenue,
    month,
    ratio: staffingCheck(start).ratio,
    total_rooms: totalRooms,
    occupancy_rate: totalRooms ? Math.round(occupiedDays / (totalRooms * daysInMonth) * 1000) / 10 : 0,
    total_baby_records: days.reduce((s, d) => s + d.baby_records, 0),
    total_mother_records: days.reduce((s, d) => s + d.mother_records, 0),
    total_handovers: days.reduce((s, d) => s + d.handovers, 0),
    cared_babies: caredBabies,
    rash_babies: rashBabies,
    rash_rate: caredBabies ? Math.round(rashBabies / caredBabies * 1000) / 10 : 0,
    non_compliant_days: days.filter(d => d.babies > 0 && !d.staffing_ok).map(d => d.date),
    days,
    alerts: abnormalRecords(start, end),
    incident_total: incidentRows.length,
    incident_open: incidentRows.filter(r => r.status !== 'closed').length,
    incident_by_category: incidentByCategory,
    hand_hygiene: { opportunities: hh.opp, compliant: hh.comp, rate: hhRate, target: hhTarget },
    disinfection_count: disinfectCount,
    cluster_count: clusterCount,
    screening_pending: screeningPending
  };
}

// ---------- 交班 ----------
app.get('/api/handovers', requireStaff, (req, res) => {
  const date = req.query.date || today();
  const rows = db.prepare(`
    SELECT h.*, u.name AS nurse_name FROM handovers h
    JOIN users u ON u.id = h.nurse_id
    WHERE h.handover_date = ? ORDER BY h.created_at DESC`).all(date);
  res.json(rows);
});

// 交班自動彙整：依當日照護紀錄／事件，產生 SBAR 草稿
app.get('/api/handovers/draft', requireStaff, (req, res) => {
  const date = req.query.date || today();
  const ms = mothersInHouseOn(date);
  const babyCount = db.prepare(`SELECT COUNT(*) c FROM babies b WHERE EXISTS (
    SELECT 1 FROM bookings bk WHERE bk.mother_id=b.mother_id AND bk.status!='cancelled' AND bk.check_in<=? AND bk.check_out>?)`).get(date, date).c;
  const cnt = (type) => db.prepare(`SELECT COUNT(*) c FROM baby_records WHERE record_type=? AND date(recorded_at)=?`).get(type, date).c;
  const feeds = cnt('feeding'), diapers = cnt('diaper');
  const abn = abnormalRecords(date, date);
  const incidents = db.prepare(`SELECT category, description FROM incidents WHERE date(occurred_at)=?`).all(date);
  const screenPending = db.prepare(`SELECT COUNT(*) c FROM newborn_screenings WHERE follow_up_done=0 AND result IN ('pending','refer','abnormal')`).get().c;
  const todos = db.prepare(`SELECT follow_up FROM handovers WHERE resolved=0 AND follow_up!='' ORDER BY id DESC LIMIT 8`).all();
  const abnText = abn.length ? abn.slice(0, 8).map(a => `${a.baby_name} ${BABY_TYPE_TW[a.record_type] || a.record_type}${a.value_num != null ? ' ' + a.value_num : ''}${a.diaper_rash ? ' 紅臀' + a.diaper_rash : ''}`).join('；') : '無異常生理數值';
  const incText = incidents.length ? incidents.map(i => `${INCIDENT_TW[i.category] || i.category}：${(i.description || '').slice(0, 20)}`).join('；') : '無通報事件';
  res.json({
    situation: `在住媽媽 ${ms.length} 位、寶寶 ${babyCount} 位（${date}）。`,
    background: `今日異常：${abnText}。事件：${incText}。`,
    assessment: `今日照護：餵食 ${feeds} 次、換尿布 ${diapers} 次；異常生理紀錄 ${abn.length} 筆。`,
    recommendation: [
      screenPending ? `待追蹤新生兒篩檢 ${screenPending} 件` : '',
      todos.length ? `未結交班待辦：${todos.map(t => t.follow_up).join('、')}` : '',
      abn.length ? '請持續觀察上述異常個案。' : ''
    ].filter(Boolean).join('；') || '無特別待辦，請依常規照護。'
  });
});

app.post('/api/handovers', requireStaff, (req, res) => {
  const h = req.body || {};
  if (!h.shift_type) return res.status(400).json({ error: '班別必填' });
  const follow = (h.follow_up || '').trim();
  const info = db.prepare(`INSERT INTO handovers
    (nurse_id, shift_type, handover_date, situation, background, assessment, recommendation, follow_up, resolved)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    req.session.user.id, h.shift_type, h.handover_date || today(),
    h.situation || '', h.background || '', h.assessment || '', h.recommendation || '',
    follow, follow ? 0 : 1);   // 有待辦才需追蹤；無待辦視為已結
  res.json({ id: info.lastInsertRowid });
});

// 交班未結待辦：標記完成
app.post('/api/handovers/:id/resolve', requireStaff, (req, res) => {
  const h = db.prepare('SELECT * FROM handovers WHERE id = ?').get(req.params.id);
  if (!h) return res.status(404).json({ error: '找不到交班紀錄' });
  db.prepare("UPDATE handovers SET resolved = 1, resolved_by = ?, resolved_at = datetime('now','localtime') WHERE id = ?")
    .run(req.session.user.id, h.id);
  logAudit(req, { action: 'update', entity: 'handovers', entity_id: h.id, summary: '交班待辦結案' });
  res.json({ ok: true });
});

// 未結交班待辦清單
app.get('/api/handover-todos', requireStaff, (req, res) => {
  res.json(db.prepare(`SELECT h.id, h.handover_date, h.shift_type, h.follow_up, h.created_at, u.name AS nurse_name
    FROM handovers h JOIN users u ON u.id = h.nurse_id
    WHERE h.resolved = 0 AND h.follow_up != '' ORDER BY h.handover_date DESC, h.id DESC`).all());
});

// ---------- 員工 ----------
// 可授權的模組清單（供帳號管理頁顯示）
app.get('/api/modules', requireStaff, (req, res) => res.json(MODULES));

app.get('/api/users', requireStaff, (req, res) => {
  const rows = db.prepare('SELECT id, username, name, role, phone, active, permissions FROM users ORDER BY id').all();
  res.json(rows.map(u => ({ ...u, permissions: parsePermissions(u.permissions) })));
});

function sanitizePerms(arr) {
  return JSON.stringify(Array.isArray(arr) ? arr.filter(k => MODULE_KEYS.includes(k)) : []);
}

app.post('/api/users', requireAdmin, (req, res) => {
  const u = req.body || {};
  if (!u.username || !u.password || !u.name) {
    return res.status(400).json({ error: '帳號、密碼、姓名必填' });
  }
  const role = u.role === 'admin' ? 'admin' : 'nurse';
  try {
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, name, role, phone, permissions) VALUES (?,?,?,?,?,?)').run(
      u.username, hashPassword(u.password), u.name, role, u.phone || '',
      role === 'admin' ? '' : sanitizePerms(u.permissions));
    logAudit(req, { action: 'create', entity: 'users', entity_id: info.lastInsertRowid, summary: u.username });
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: '帳號重複' });
  }
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到帳號' });
  const u = req.body || {};
  const role = u.role === undefined ? cur.role : (u.role === 'admin' ? 'admin' : 'nurse');
  // 避免把最後一位啟用中的管理員降權或停用，導致無人可管理
  if ((cur.role === 'admin') && (role !== 'admin' || u.active === 0)) {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1").get().c;
    if (admins <= 1) return res.status(400).json({ error: '至少需保留一位啟用中的管理員' });
  }
  const perms = role === 'admin' ? '' : sanitizePerms(u.permissions !== undefined ? u.permissions : parsePermissions(cur.permissions));
  db.prepare('UPDATE users SET name=?, role=?, phone=?, active=?, permissions=? WHERE id=?').run(
    u.name ?? cur.name, role, u.phone ?? cur.phone,
    (u.active === undefined ? cur.active : (u.active ? 1 : 0)), perms, cur.id);
  if (u.password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(u.password), cur.id);
  logAudit(req, { action: 'update', entity: 'users', entity_id: cur.id, summary: cur.username });
  res.json({ ok: true });
});

// ---------- LINE / Facebook 雙向訊息 CRM ----------
// 自動把外部聯絡人對應到住戶（LINE 依已綁定的 line_user_id）
function crmAutoLink(channel, userId) {
  if (channel !== 'line') return {};
  const fam = db.prepare(`SELECT f.id AS family_id, b.mother_id FROM family_members f
    JOIN babies b ON b.id = f.baby_id WHERE f.line_user_id = ? AND f.active = 1`).get(userId);
  return fam ? { family_id: fam.family_id, mother_id: fam.mother_id } : {};
}
function crmUpsertContact(channel, userId, profile = {}) {
  let c = db.prepare('SELECT * FROM crm_contacts WHERE channel = ? AND channel_user_id = ?').get(channel, userId);
  if (!c) {
    const link = crmAutoLink(channel, userId);
    const info = db.prepare(`INSERT INTO crm_contacts (channel, channel_user_id, display_name, picture_url, mother_id, family_id)
      VALUES (?,?,?,?,?,?)`).run(channel, userId, profile.display_name || '', profile.picture_url || '',
      link.mother_id || null, link.family_id || null);
    c = db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(info.lastInsertRowid);
  } else if ((profile.display_name && !c.display_name) || (profile.picture_url && !c.picture_url)) {
    db.prepare('UPDATE crm_contacts SET display_name = COALESCE(NULLIF(?,\'\'), display_name), picture_url = COALESCE(NULLIF(?,\'\'), picture_url) WHERE id = ?')
      .run(profile.display_name || '', profile.picture_url || '', c.id);
  }
  return c;
}
function crmInbound(channel, userId, text, profile = {}) {
  const tx = db.transaction(() => {
    const c = crmUpsertContact(channel, userId, profile);
    db.prepare('INSERT INTO crm_messages (contact_id, direction, text) VALUES (?,?,?)').run(c.id, 'in', text);
    db.prepare("UPDATE crm_contacts SET last_message_at = datetime('now','localtime'), last_text = ?, unread = unread + 1, status='open' WHERE id = ?")
      .run(text.slice(0, 120), c.id);
    return c.id;
  });
  return tx();
}

// LINE Webhook（公開；以 channel secret 驗簽）
app.post('/api/webhooks/line', (req, res) => {
  const s = getSettings();
  const secret = (s.line_channel_secret || '').trim();
  if (secret) {
    const sig = crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.from('')).digest('base64');
    if (sig !== req.headers['x-line-signature']) return res.status(401).send('bad signature');
  }
  res.status(200).end(); // 先回 200，避免 LINE 重送
  const token = (s.line_channel_access_token || '').trim();
  const events = (req.body && req.body.events) || [];
  (async () => {
    for (const ev of events) {
      try {
        if (ev.type === 'message' && ev.message && ev.message.type === 'text' && ev.source && ev.source.userId) {
          const profile = token ? await notify.lineProfile(token, ev.source.userId) : {};
          crmInbound('line', ev.source.userId, ev.message.text || '', profile);
        }
      } catch (e) { /* 單一事件失敗不影響其他 */ }
    }
  })();
});

// Facebook Messenger Webhook：GET 驗證、POST 收訊
app.get('/api/webhooks/facebook', (req, res) => {
  const s = getSettings();
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === (s.fb_verify_token || '')) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});
app.post('/api/webhooks/facebook', (req, res) => {
  const s = getSettings();
  const appSecret = (s.fb_app_secret || '').trim();
  if (appSecret) {
    const sig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody || Buffer.from('')).digest('hex');
    if (sig !== req.headers['x-hub-signature-256']) return res.status(401).send('bad signature');
  }
  res.status(200).send('EVENT_RECEIVED');
  const entries = (req.body && req.body.entry) || [];
  for (const entry of entries) {
    for (const m of (entry.messaging || [])) {
      try {
        if (m.message && m.message.text && m.sender && m.sender.id) {
          crmInbound('facebook', m.sender.id, m.message.text);
        }
      } catch (e) { /* 略過單筆 */ }
    }
  }
});

// 員工端：聯絡人清單（統一收件匣）
app.get('/api/crm/contacts', requireStaff, (req, res) => {
  const conds = [], args = [];
  if (req.query.channel) { conds.push('c.channel = ?'); args.push(req.query.channel); }
  if (req.query.unread === '1') conds.push('c.unread > 0');
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`SELECT c.*, m.name AS mother_name FROM crm_contacts c
    LEFT JOIN mothers m ON m.id = c.mother_id ${where}
    ORDER BY (c.last_message_at = '') , c.last_message_at DESC, c.id DESC`).all(...args);
  const config = { line: !!getSettings().line_channel_access_token, facebook: !!getSettings().fb_page_access_token };
  res.json({ config, contacts: rows });
});
app.get('/api/crm/contacts/:id', requireStaff, (req, res) => {
  const c = db.prepare(`SELECT c.*, m.name AS mother_name FROM crm_contacts c
    LEFT JOIN mothers m ON m.id = c.mother_id WHERE c.id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: '找不到聯絡人' });
  const messages = db.prepare(`SELECT cm.*, u.name AS staff_name FROM crm_messages cm
    LEFT JOIN users u ON u.id = cm.staff_id WHERE cm.contact_id = ? ORDER BY cm.id`).all(c.id);
  db.prepare('UPDATE crm_contacts SET unread = 0 WHERE id = ?').run(c.id);
  res.json({ contact: c, messages });
});
// 後台回覆，推回原通道
app.post('/api/crm/contacts/:id/reply', requireStaff, async (req, res) => {
  const c = db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '找不到聯絡人' });
  const text = ((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: '請輸入訊息' });
  const s = getSettings();
  try {
    if (c.channel === 'line') {
      const token = (s.line_channel_access_token || '').trim();
      if (!token) throw new Error('尚未設定 LINE Channel Access Token');
      await notify.pushLine(token, c.channel_user_id, text);
    } else {
      const pt = (s.fb_page_access_token || '').trim();
      if (!pt) throw new Error('尚未設定 Facebook 粉專 Token');
      await notify.fbSend(pt, c.channel_user_id, text);
    }
  } catch (e) { return res.status(400).json({ error: '送出失敗：' + e.message }); }
  db.prepare('INSERT INTO crm_messages (contact_id, direction, text, staff_id) VALUES (?,?,?,?)').run(c.id, 'out', text, req.session.user.id);
  db.prepare("UPDATE crm_contacts SET last_message_at = datetime('now','localtime'), last_text = ? WHERE id = ?").run(text.slice(0, 120), c.id);
  res.json({ ok: true });
});
// 手動把聯絡人對應到住戶（媽媽）
app.post('/api/crm/contacts/:id/link', requireStaff, (req, res) => {
  const c = db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '找不到聯絡人' });
  const motherId = (req.body || {}).mother_id || null;
  if (motherId && !db.prepare('SELECT 1 FROM mothers WHERE id = ?').get(motherId)) return res.status(400).json({ error: '找不到住戶' });
  db.prepare('UPDATE crm_contacts SET mother_id = ? WHERE id = ?').run(motherId, c.id);
  res.json({ ok: true });
});
app.post('/api/crm/contacts/:id/status', requireStaff, (req, res) => {
  const st = (req.body || {}).status === 'closed' ? 'closed' : 'open';
  db.prepare('UPDATE crm_contacts SET status = ? WHERE id = ?').run(st, req.params.id);
  res.json({ ok: true });
});

// ---------- 名人／顧客推薦牆（已改用非同步 DAL，作為 PostgreSQL 切換試點） ----------
// 公開頁讀取（無須登入）：僅回傳上架者
app.get('/api/public/testimonials', ah(async (req, res) => {
  res.json({
    center_name: getSettings().center_name || '',
    items: await dal.all('SELECT name, title, quote, photo, source_url, video_url FROM testimonials WHERE active = 1 ORDER BY sort, id DESC')
  });
}));
app.get('/api/testimonials', requireStaff, ah(async (req, res) => {
  res.json(await dal.all('SELECT * FROM testimonials ORDER BY active DESC, sort, id DESC'));
}));
app.post('/api/testimonials', requireStaff, ah(async (req, res) => {
  const t = req.body || {};
  if (!t.name) return res.status(400).json({ error: '姓名必填' });
  const r = await dal.run(`INSERT INTO testimonials (name, title, quote, photo, source_url, video_url, sort, active, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`, [
    t.name, t.title || '', t.quote || '', t.photo || '', t.source_url || '', t.video_url || '',
    Math.round(Number(t.sort) || 0), t.active === undefined ? 1 : (t.active ? 1 : 0), req.session.user.id]);
  res.json({ id: r.lastInsertRowid });
}));
app.put('/api/testimonials/:id', requireStaff, ah(async (req, res) => {
  const cur = await dal.get('SELECT * FROM testimonials WHERE id = ?', [req.params.id]);
  if (!cur) return res.status(404).json({ error: '找不到推薦' });
  const t = req.body || {};
  await dal.run(`UPDATE testimonials SET name=?, title=?, quote=?, photo=?, source_url=?, video_url=?, sort=?, active=? WHERE id=?`, [
    t.name ?? cur.name, t.title ?? cur.title, t.quote ?? cur.quote, t.photo ?? cur.photo,
    t.source_url ?? cur.source_url, t.video_url ?? cur.video_url,
    Math.round(t.sort === undefined ? cur.sort : Number(t.sort) || 0),
    (t.active === undefined ? cur.active : (t.active ? 1 : 0)), cur.id]);
  res.json({ ok: true });
}));
app.delete('/api/testimonials/:id', requireStaff, ah(async (req, res) => {
  const cur = await dal.get('SELECT photo FROM testimonials WHERE id = ?', [req.params.id]);
  const r = await dal.run('DELETE FROM testimonials WHERE id = ?', [req.params.id]);
  if (r.changes > 0 && cur) removeUploadFile(cur.photo);
  res.json({ ok: true });
}));
app.post('/api/testimonials/:id/photo', requireStaff, upload.single('photo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請選擇圖片' });
  const old = (await dal.get('SELECT photo FROM testimonials WHERE id = ?', [req.params.id]) || {}).photo;
  const url = '/uploads/' + req.file.filename;
  await dal.run('UPDATE testimonials SET photo = ? WHERE id = ?', [url, req.params.id]);
  if (old && old !== url) removeUploadFile(old);
  res.json({ photo: url });
}));

// ---------- 衛福部表單通報上傳 ----------
const GOV_FORMS = { monthly_report: '產後護理機構月報（評鑑佐證）' };

// 標準化「產後護理機構月報表」：彙整成衛生局申報常見欄位
function govMonthlyForm(month) {
  const r = computeMonthlyReport(month);
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`, end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const cnt = (sql, ...a) => db.prepare(sql).get(...a).c;
  const newAdm = cnt(`SELECT COUNT(*) c FROM bookings WHERE status!='cancelled' AND check_in BETWEEN ? AND ?`, start, end);
  const discharges = cnt(`SELECT COUNT(*) c FROM bookings WHERE status!='cancelled' AND check_out BETWEEN ? AND ?`, start, end);
  const startResidents = cnt(`SELECT COUNT(*) c FROM bookings WHERE status!='cancelled' AND check_in<=? AND check_out>?`, start, start);
  const endResidents = cnt(`SELECT COUNT(*) c FROM bookings WHERE status!='cancelled' AND check_in<=? AND check_out>?`, end, end);
  const occupiedBedDays = r.days.reduce((s, d) => s + d.occupied_rooms, 0);
  const babyCareDays = r.days.reduce((s, d) => s + d.babies, 0);
  const totalBedDays = r.total_rooms * r.days.length;
  const losRows = db.prepare(`SELECT check_in, check_out FROM bookings WHERE status!='cancelled' AND check_out BETWEEN ? AND ?`).all(start, end);
  const avgLos = losRows.length ? Math.round(losRows.reduce((s, b) => s + Math.max(0, (new Date(b.check_out) - new Date(b.check_in)) / 86400000), 0) / losRows.length * 10) / 10 : 0;
  const s = getSettings();
  const fields = [
    ['機構名稱', s.center_name || ''],
    ['機構代碼', s.gov_org_code || ''],
    ['申報月份', month],
    ['總床數', r.total_rooms],
    ['可用床日數', totalBedDays],
    ['佔床日數', occupiedBedDays],
    ['佔床率(%)', r.occupancy_rate],
    ['月初在住人數', startResidents],
    ['本月新收人數', newAdm],
    ['本月出住人數', discharges],
    ['月底在住人數', endResidents],
    ['平均住房日數', avgLos],
    ['嬰兒總照護人日數', babyCareDays],
    ['護理人力比 (1:N)', r.ratio],
    ['人力比不合規天數', r.non_compliant_days.length],
    ['寶寶照護紀錄筆數', r.total_baby_records],
    ['媽媽照護紀錄筆數', r.total_mother_records],
    ['交班紀錄筆數', r.total_handovers],
    ['紅臀發生率(%)', r.rash_rate],
    ['手部衛生遵從率(%)', r.hand_hygiene.rate == null ? '' : r.hand_hygiene.rate],
    ['環境清消簽核次數', r.disinfection_count],
    ['群聚事件數', r.cluster_count],
    ['異常／不良事件數', r.incident_total],
    ['異常事件未結案數', r.incident_open],
    ['待追蹤新生兒篩檢', r.screening_pending]
  ].map(([label, value]) => ({ label, value }));
  return { form_type: 'monthly_report', month, center_name: s.center_name || '', generated_at: today(), fields };
}
app.get('/api/gov/form', requireStaff, (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '月份格式需為 YYYY-MM' });
  res.json(govMonthlyForm(month));
});
app.get('/api/gov/form.xlsx', requireStaff, (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '月份格式需為 YYYY-MM' });
  const form = govMonthlyForm(month);
  const buf = buildWorkbook(`月報表${month}`, [{ key: 'label', label: '項目' }, { key: 'value', label: '數值' }], form.fields);
  const fname = encodeURIComponent(`產後護理機構月報表-${month}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="gov-monthly-${month}.xlsx"; filename*=UTF-8''${fname}`);
  res.send(buf);
});
// 實際送出至主管機關／加值平台；未設定介接資訊則回報為本地模式
async function govUpload(sub) {
  const s = getSettings();
  if (!s.gov_api_url || !s.gov_api_key) {
    throw new Error('尚未設定衛福部介接資訊（系統設定→衛福部通報），目前僅本地產生，可手動匯出報送。');
  }
  const r = await fetch(s.gov_api_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.gov_api_key },
    body: JSON.stringify({ org_code: s.gov_org_code, form_type: sub.form_type, period: sub.period, data: JSON.parse(sub.payload || '{}') })
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`主管機關回應 ${r.status}：${text.slice(0, 200)}`);
  let ack = '';
  try { ack = (JSON.parse(text).ack_no) || ''; } catch (e) { ack = ''; }
  return { ack_no: ack };
}
async function attemptUpload(id) {
  const sub = db.prepare('SELECT * FROM gov_submissions WHERE id = ?').get(id);
  if (!sub || sub.status === 'uploaded') return sub;
  try {
    const r = await govUpload(sub);
    db.prepare("UPDATE gov_submissions SET status='uploaded', attempts=attempts+1, last_error='', uploaded_at=datetime('now','localtime'), ack_no=? WHERE id=?")
      .run(r.ack_no || '', id);
  } catch (e) {
    db.prepare("UPDATE gov_submissions SET status='failed', attempts=attempts+1, last_error=? WHERE id=?").run(String(e.message).slice(0, 300), id);
    throw e;
  }
  return db.prepare('SELECT * FROM gov_submissions WHERE id = ?').get(id);
}

app.get('/api/gov/submissions', requireStaff, (req, res) => {
  const rows = db.prepare(`SELECT g.id, g.form_type, g.period, g.title, g.status, g.attempts, g.last_error,
    g.uploaded_at, g.ack_no, g.created_at, u.name AS created_by_name
    FROM gov_submissions g LEFT JOIN users u ON u.id = g.created_by ORDER BY g.id DESC`).all();
  res.json({ forms: GOV_FORMS, configured: !!(getSettings().gov_api_url && getSettings().gov_api_key), submissions: rows });
});
// 產生（快照）某月月報為通報資料；可選擇立即上傳
app.post('/api/gov/submissions', requireStaff, async (req, res) => {
  const b = req.body || {};
  const form_type = b.form_type || 'monthly_report';
  if (!GOV_FORMS[form_type]) return res.status(400).json({ error: '不支援的表單類型' });
  const period = b.period || today().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: '期間格式需為 YYYY-MM' });
  let payload;
  try { payload = govMonthlyForm(period); } catch (e) { return res.status(400).json({ error: '產生報表失敗：' + e.message }); }
  const title = `${GOV_FORMS[form_type]}（${period}）`;
  db.prepare(`INSERT INTO gov_submissions (form_type, period, title, payload, status, created_by)
    VALUES (?,?,?,?, 'pending', ?)
    ON CONFLICT(form_type, period) DO UPDATE SET payload=excluded.payload, title=excluded.title, status='pending', last_error=''`)
    .run(form_type, period, title, JSON.stringify(payload), req.session.user.id);
  const sub = db.prepare('SELECT * FROM gov_submissions WHERE form_type=? AND period=?').get(form_type, period);
  logAudit(req, { action: 'create', entity: 'gov', entity_id: sub.id, summary: title });
  // 自動上傳（若已開啟且已設定介接）
  if (b.upload || getSettings().gov_auto_upload === '1') {
    try { const r = await attemptUpload(sub.id); return res.json({ id: sub.id, status: r.status, ack_no: r.ack_no }); }
    catch (e) { return res.json({ id: sub.id, status: 'failed', error: e.message }); }
  }
  res.json({ id: sub.id, status: 'pending' });
});
app.post('/api/gov/submissions/:id/upload', requireStaff, async (req, res) => {
  try { const r = await attemptUpload(req.params.id); res.json({ ok: true, status: r.status, ack_no: r.ack_no }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/gov/submissions/:id', requireStaff, (req, res) => {
  const sub = db.prepare('SELECT * FROM gov_submissions WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: '找不到通報' });
  res.json(sub);
});
app.delete('/api/gov/submissions/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM gov_submissions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
// 背景自動重試：每 30 分鐘補送失敗／待上傳者（需已開啟自動上傳且設定介接）
setInterval(async () => {
  try {
    if (getSettings().gov_auto_upload !== '1') return;
    if (!getSettings().gov_api_url) return;
    const pend = db.prepare("SELECT id FROM gov_submissions WHERE status IN ('pending','failed') AND attempts < 10").all();
    for (const p of pend) { try { await attemptUpload(p.id); } catch (e) { /* 留待下次重試 */ } }
  } catch (e) { /* 忽略掃描錯誤 */ }
}, 30 * 60 * 1000);

// ---------- 員工證照（到期提醒） ----------
app.get('/api/certifications', requireStaff, (req, res) => {
  const alertDays = parseInt(getSettings().cert_alert_days, 10) || 60;
  const rows = db.prepare(`SELECT c.*, u.name AS user_name FROM staff_certifications c
    LEFT JOIN users u ON u.id = c.user_id ORDER BY (c.expires_on = '') , c.expires_on`).all();
  const d = today();
  const out = rows.map(c => {
    const name = c.user_name || c.staff_name || '';
    let state = 'ok';
    if (c.expires_on) {
      const days = Math.floor((new Date(c.expires_on) - new Date(d)) / 86400000);
      state = days < 0 ? 'expired' : days <= alertDays ? 'expiring' : 'ok';
      return { ...c, person: name, days_left: days, state };
    }
    return { ...c, person: name, days_left: null, state: 'none' };
  });
  res.json({ alert_days: alertDays, certifications: out });
});
app.post('/api/certifications', requireStaff, (req, res) => {
  const c = req.body || {};
  if (!c.cert_name) return res.status(400).json({ error: '證照名稱必填' });
  if (!c.user_id && !c.staff_name) return res.status(400).json({ error: '請選擇員工或填寫姓名' });
  const info = db.prepare(`INSERT INTO staff_certifications
    (user_id, staff_name, cert_name, cert_no, issuer, issued_on, expires_on, note)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    c.user_id || null, c.staff_name || '', c.cert_name, c.cert_no || '', c.issuer || '',
    c.issued_on || '', c.expires_on || '', c.note || '');
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/certifications/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM staff_certifications WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到證照' });
  const c = req.body || {};
  db.prepare(`UPDATE staff_certifications SET user_id=?, staff_name=?, cert_name=?, cert_no=?, issuer=?, issued_on=?, expires_on=?, note=? WHERE id=?`).run(
    c.user_id === undefined ? cur.user_id : (c.user_id || null), c.staff_name ?? cur.staff_name,
    c.cert_name ?? cur.cert_name, c.cert_no ?? cur.cert_no, c.issuer ?? cur.issuer,
    c.issued_on ?? cur.issued_on, c.expires_on ?? cur.expires_on, c.note ?? cur.note, cur.id);
  res.json({ ok: true });
});
app.delete('/api/certifications/:id', requireStaff, (req, res) => {
  db.prepare('DELETE FROM staff_certifications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 電子問卷／滿意度調查 ----------
function surveyStats(survey) {
  const qs = JSON.parse(survey.questions || '[]');
  const resps = db.prepare('SELECT answers FROM survey_responses WHERE survey_id = ?').all(survey.id)
    .map(r => { try { return JSON.parse(r.answers || '{}'); } catch (e) { return {}; } });
  const stats = qs.map((q, i) => {
    if (q.type === 'rating') {
      const vals = resps.map(a => Number(a[i])).filter(v => Number.isFinite(v));
      const avg = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100) / 100 : null;
      return { type: 'rating', label: q.label, avg, count: vals.length };
    }
    if (q.type === 'choice') {
      const dist = {};
      for (const a of resps) { const v = a[i]; if (v) dist[v] = (dist[v] || 0) + 1; }
      return { type: 'choice', label: q.label, dist };
    }
    return { type: 'text', label: q.label, answers: resps.map(a => a[i]).filter(Boolean) };
  });
  return { responses: resps.length, stats };
}
app.get('/api/surveys', requireStaff, (req, res) => {
  const rows = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id=s.id) AS response_count
    FROM surveys s ORDER BY s.id DESC`).all();
  res.json(rows.map(s => ({ ...s, questions: JSON.parse(s.questions || '[]') })));
});
app.get('/api/surveys/:id', requireStaff, (req, res) => {
  const s = db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '找不到問卷' });
  res.json({ ...s, questions: JSON.parse(s.questions || '[]'), ...surveyStats(s) });
});
function validQuestions(qs) {
  return Array.isArray(qs) && qs.length > 0 && qs.every(q => q && q.label && ['rating', 'choice', 'text'].includes(q.type));
}
app.post('/api/surveys', requireStaff, (req, res) => {
  const s = req.body || {};
  if (!s.title) return res.status(400).json({ error: '標題必填' });
  if (!validQuestions(s.questions)) return res.status(400).json({ error: '請至少設定一題' });
  const info = db.prepare('INSERT INTO surveys (title, description, questions, active, created_by) VALUES (?,?,?,?,?)').run(
    s.title, s.description || '', JSON.stringify(s.questions), s.active === undefined ? 1 : (s.active ? 1 : 0), req.session.user.id);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/surveys/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到問卷' });
  const s = req.body || {};
  if (s.questions !== undefined && !validQuestions(s.questions)) return res.status(400).json({ error: '請至少設定一題' });
  db.prepare('UPDATE surveys SET title=?, description=?, questions=?, active=? WHERE id=?').run(
    s.title ?? cur.title, s.description ?? cur.description,
    s.questions !== undefined ? JSON.stringify(s.questions) : cur.questions,
    (s.active === undefined ? cur.active : (s.active ? 1 : 0)), cur.id);
  res.json({ ok: true });
});
app.delete('/api/surveys/:id', requireAdmin, (req, res) => {
  const used = db.prepare('SELECT 1 FROM survey_responses WHERE survey_id = ? LIMIT 1').get(req.params.id);
  if (used) { db.prepare('UPDATE surveys SET active = 0 WHERE id = ?').run(req.params.id); return res.json({ ok: true, deactivated: true }); }
  db.prepare('DELETE FROM surveys WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
// 家屬端：問卷填寫
app.get('/api/family/surveys', requireFamily, (req, res) => {
  const fam = req.session.family;
  const rows = db.prepare('SELECT id, title, description, questions FROM surveys WHERE active = 1 ORDER BY id DESC').all();
  const done = new Set(db.prepare('SELECT survey_id FROM survey_responses WHERE family_id = ?').all(fam.id).map(r => r.survey_id));
  res.json(rows.map(s => ({ id: s.id, title: s.title, description: s.description, questions: JSON.parse(s.questions || '[]'), submitted: done.has(s.id) })));
});
app.post('/api/family/surveys/:id', requireFamily, (req, res) => {
  const fam = req.session.family;
  const s = db.prepare('SELECT * FROM surveys WHERE id = ? AND active = 1').get(req.params.id);
  if (!s) return res.status(404).json({ error: '問卷不存在或已關閉' });
  if (db.prepare('SELECT 1 FROM survey_responses WHERE survey_id=? AND family_id=?').get(s.id, fam.id)) {
    return res.status(400).json({ error: '您已填寫過此問卷，感謝您的回饋' });
  }
  const answers = (req.body || {}).answers || {};
  const mid = familyMotherId(fam);
  db.prepare('INSERT INTO survey_responses (survey_id, family_id, mother_id, answers) VALUES (?,?,?,?)')
    .run(s.id, fam.id, mid || null, JSON.stringify(answers));
  res.json({ ok: true, message: '已送出，感謝您的回饋！' });
});

// ---------- 家屬帳號管理（員工端） ----------
app.get('/api/family-members', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, b.name AS baby_name, m.name AS mother_name
    FROM family_members f JOIN babies b ON b.id = f.baby_id
    JOIN mothers m ON m.id = b.mother_id
    WHERE f.active = 1 ORDER BY f.id DESC`).all();
  res.json(rows);
});

app.post('/api/family-members', requireStaff, (req, res) => {
  const f = req.body || {};
  if (!f.baby_id || !f.name) return res.status(400).json({ error: '寶寶與姓名必填' });
  const code = genAccessCode();
  const info = db.prepare(`INSERT INTO family_members
    (baby_id, name, relation, access_code, line_user_id) VALUES (?,?,?,?,?)`).run(
    f.baby_id, f.name, f.relation || '', code, (f.line_user_id || '').trim());
  res.json({ id: info.lastInsertRowid, access_code: code });
});

app.put('/api/family-members/:id', requireStaff, (req, res) => {
  const f = req.body || {};
  const info = db.prepare(
    'UPDATE family_members SET line_user_id = ? WHERE id = ? AND active = 1').run(
    (f.line_user_id || '').trim(), req.params.id);
  if (!info.changes) return res.status(404).json({ error: '找不到家屬資料' });
  res.json({ ok: true });
});

app.delete('/api/family-members/:id', requireStaff, (req, res) => {
  db.prepare('UPDATE family_members SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 家屬入口 ----------
app.post('/api/family/login', (req, res) => {
  const code = ((req.body || {}).code || '').trim().toUpperCase();
  const fam = db.prepare(`
    SELECT f.*, b.name AS baby_name FROM family_members f
    JOIN babies b ON b.id = f.baby_id
    WHERE f.access_code = ? AND f.active = 1`).get(code);
  if (!fam) return res.status(401).json({ error: '通行碼不正確' });
  req.session.family = { id: fam.id, baby_id: fam.baby_id, name: fam.name, relation: fam.relation };
  logAudit(req, { action: 'login', entity: 'family', entity_id: fam.id, summary: `家屬入口:${fam.name}` });
  res.json({ family: req.session.family, baby_name: fam.baby_name });
});

app.post('/api/family/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/family/me', (req, res) => {
  res.json({ family: req.session.family || null });
});

app.get('/api/family/report', requireFamily, (req, res) => {
  const report = buildDailyReport(req.session.family.baby_id, req.query.date || today());
  if (!report) return res.status(404).json({ error: '找不到資料' });
  // 家屬端不揭露護理師個資以外的內部備註欄位，僅保留必要資訊
  report.records = report.records.map(r => ({
    record_type: r.record_type, feed_method: r.feed_method, amount_ml: r.amount_ml,
    diaper_kind: r.diaper_kind, diaper_rash: r.diaper_rash, value_num: r.value_num,
    photo_file: r.photo_file, note: r.note, recorded_at: r.recorded_at
  }));
  report.photos = report.photos.map(r => ({ photo_file: r.photo_file, note: r.note, recorded_at: r.recorded_at }));
  res.json(report);
});

app.get('/api/family/trends', requireFamily, (req, res) => {
  res.json(buildTrends(req.session.family.baby_id));
});

app.get('/api/family/photos', requireFamily, (req, res) => {
  const rows = db.prepare(`
    SELECT photo_file, note, recorded_at FROM baby_records
    WHERE baby_id = ? AND record_type = 'photo'
    ORDER BY recorded_at DESC LIMIT 60`).all(req.session.family.baby_id);
  res.json(rows);
});

// 同一位媽媽的寶寶（雙胞胎／多胞胎）清單，供家屬端切換檢視
app.get('/api/family/siblings', requireFamily, (req, res) => {
  const cur = db.prepare('SELECT mother_id FROM babies WHERE id=?').get(req.session.family.baby_id);
  if (!cur) return res.json([]);
  const rows = db.prepare('SELECT id, name FROM babies WHERE mother_id=? ORDER BY id').all(cur.mother_id);
  res.json({ current: req.session.family.baby_id, babies: rows });
});

app.post('/api/family/switch-baby', requireFamily, (req, res) => {
  const target = (req.body || {}).baby_id;
  const cur = db.prepare('SELECT mother_id FROM babies WHERE id=?').get(req.session.family.baby_id);
  if (!cur) return res.status(404).json({ error: '找不到寶寶' });
  const ok = db.prepare('SELECT id, name FROM babies WHERE id=? AND mother_id=?').get(target, cur.mother_id);
  if (!ok) return res.status(403).json({ error: '只能切換同一位媽媽的寶寶' });
  req.session.family.baby_id = ok.id;
  res.json({ ok: true, baby_id: ok.id, baby_name: ok.name });
});

// 家屬留言（家屬端）
app.get('/api/family/messages', requireFamily, (req, res) => {
  const babyId = req.session.family.baby_id;
  const rows = db.prepare(`SELECT id, sender, sender_name, body, created_at FROM family_messages
    WHERE baby_id=? ORDER BY created_at`).all(babyId);
  db.prepare(`UPDATE family_messages SET read_by_family=1 WHERE baby_id=? AND sender='staff'`).run(babyId);
  res.json(rows);
});

app.post('/api/family/messages', requireFamily, (req, res) => {
  const body = ((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: '請輸入留言內容' });
  if (body.length > 1000) return res.status(400).json({ error: '留言過長' });
  const f = req.session.family;
  const info = db.prepare(`INSERT INTO family_messages (baby_id, family_id, sender, sender_name, body, read_by_family)
    VALUES (?,?, 'family', ?, ?, 1)`).run(f.baby_id, f.id, f.name + (f.relation ? `（${f.relation}）` : ''), body);
  res.json({ id: info.lastInsertRowid });
});

// ---------- 錯誤處理 ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? '圖片檔案不可超過 10MB' : '檔案上傳失敗';
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: '伺服器錯誤' });
});

app.listen(PORT, () => {
  console.log(`MamaCare 已啟動: http://localhost:${PORT}`);
  console.log(`家屬入口: http://localhost:${PORT}/family.html`);
});
