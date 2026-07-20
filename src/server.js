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
  '/api/webhooks/line', '/api/webhooks/facebook', '/api/webhooks/ecpay', '/api/public/tours',
  '/api/public/line-tours/register', '/api/public/line-tours/verify', '/api/public/line-tours/book']);
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
  { key: 'physician', label: '醫師巡診' },
  { key: 'mother_care', label: '媽媽照護' },
  { key: 'handover', label: '護理交班' },
  { key: 'incidents', label: '異常事件' },
  { key: 'infection', label: '感染管制' },
  { key: 'residents', label: '住客管理' },
  { key: 'rooms', label: '房務與訂房' },
  { key: 'housekeeping', label: '房務清潔' },
  { key: 'billing', label: '收費帳務' },
  { key: 'shop', label: '商城商品' },
  { key: 'supplies', label: '耗材庫存' },
  { key: 'programs', label: '課程與服務' },
  { key: 'members', label: '會員' },
  { key: 'meals', label: '膳食／月子餐' },
  { key: 'invoices', label: '電子發票' },
  { key: 'contracts', label: '合約簽署' },
  { key: 'tours', label: '參觀預約' },
  { key: 'visitors', label: '訪客預約' },
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
// 寶寶位置狀態（房況卡片顏色）：嬰兒室／親子同室／隔離室／不在館內
const BABY_LOCATIONS = ['nursery', 'rooming', 'isolation', 'out', 'hospital', 'daycare'];
const BABY_LOCATION_TW = { nursery: '嬰兒室', rooming: '親子同室', isolation: '隔離室', out: '不在館內', hospital: '住院中', daycare: '托嬰' };
// 路由 → 模組對照（依序比對，先精準後一般）；未命中者視為基礎共用端點，任何登入員工皆可存取
const MODULE_RULES = [
  [/^\/api\/mothers\/\d+\/meal-diet/, 'meals'],
  [/^\/api\/mothers\/\d+\/(records|nursing|guidance|scales|health-problems|breast-photos|intake|handovers|handover-profile|closure)/, 'mother_care'],
  [/^\/api\/(mother-records|mother-nursing|mother-scales|mother-guidance|mother-health-problems|mother-breast-photos|mother-handovers|mother-closures)/, 'mother_care'],
  [/^\/api\/babies\/\d+\/(meds|screenings|vaccinations|phototherapy)/, 'newborn_medical'],
  [/^\/api\/(meds|screenings|vaccinations|phototherapy)/, 'newborn_medical'],
  [/^\/api\/physician-visits/, 'physician'],
  [/^\/api\/babies\/\d+\/doctor-visits/, 'physician'],
  [/^\/api\/baby-doctor-visits/, 'physician'],
  [/^\/api\/mothers\/\d+\/doctor-visits/, 'physician'],
  [/^\/api\/mother-doctor-visits/, 'physician'],
  [/^\/api\/physician-rounds/, 'physician'],
  [/^\/api\/baby-announcements/, 'baby_care'],
  [/^\/api\/medical-records/, 'mother_care'],
  // 母乳哺育評估：以媽媽護理師為主、嬰兒室為輔 → 兩模組其一即可存取
  [/^\/api\/babies\/\d+\/breastfeeding/, ['baby_care', 'mother_care']],
  [/^\/api\/breastfeeding/, ['baby_care', 'mother_care']],
  [/^\/api\/babies\/\d+\/(records|report|location|photos|trends|nursing|rooming-logs|eval|eval-profile|intake-assessments|handovers|closure)/, 'baby_care'],
  [/^\/api\/(baby-records|baby-nursing|baby-rooming|baby-intake|baby-handovers|baby-closures)/, 'baby_care'],
  [/^\/api\/handovers/, 'handover'],
  [/^\/api\/incidents/, 'incidents'],
  [/^\/api\/infection/, 'infection'],
  [/^\/api\/bookings\/\d+\/contracts/, 'contracts'],
  [/^\/api\/(contracts|contract-templates)/, 'contracts'],
  [/^\/api\/bookings\/\d+\/checkout-complete/, 'residents'],
  [/^\/api\/bookings\/\d+\/(billing|charges|payments|refund-quote|dun)/, 'billing'],
  [/^\/api\/(billing|payments|charges)/, 'billing'],
  [/^\/api\/invoices/, 'invoices'],
  [/^\/api\/products/, 'shop'],
  [/^\/api\/orders/, 'shop'],
  [/^\/api\/supplies/, 'supplies'],
  [/^\/api\/supply-txns/, 'supplies'],
  [/^\/api\/(programs|signups)/, 'programs'],
  [/^\/api\/members/, 'members'],
  [/^\/api\/coupons/, 'coupons'],
  [/^\/api\/(meals|meal-menu|meal-plan|meal-config|meal-swaps)/, 'meals'],
  [/^\/api\/tours/, 'tours'],
  [/^\/api\/tour-slots/, 'tours'],
  [/^\/api\/customers/, 'tours'],
  [/^\/api\/customer-logs/, 'tours'],
  [/^\/api\/client-contracts/, 'tours'],
  [/^\/api\/pp-reports/, 'reports'],
  [/^\/api\/tour-calendar/, 'tours'],
  [/^\/api\/visitor-reservations/, 'visitors'],
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
  [/^\/api\/employees/, 'users'],
  [/^\/api\/housekeeping/, 'housekeeping'],
  [/^\/api\/mothers\/\d+\/housekeeping/, 'housekeeping'],
  // 住客／房務的「異動」才受限，讀取（GET）開放給所有員工以供跨模組顯示
  [/^\/api\/mothers/, 'residents', 'WRITE'],
  [/^\/api\/(room-types|room-discounts|baby-beds)/, 'rooms', 'WRITE'],
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
  if (!mod) return next();
  const mods = Array.isArray(mod) ? mod : [mod];
  if (mods.some(m => userCan(u, m))) return next();
  const label = mods.map(k => (MODULES.find(m => m.key === k) || {}).label).filter(Boolean).join('」或「');
  return res.status(403).json({ error: '您沒有「' + label + '」的權限' });
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

// 文件上傳（後台文件區）：允許常見文件與圖片格式，20MB
const DOC_MIMES = /^(image\/|application\/pdf|application\/msword|application\/vnd\.openxmlformats|application\/vnd\.ms-excel|application\/vnd\.ms-powerpoint|text\/plain|application\/zip)/;
const docUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase().slice(0, 10);
      cb(null, 'doc-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => { cb(null, DOC_MIMES.test(file.mimetype)); }
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
    for (const r of db.prepare("SELECT photo_file FROM mother_breast_photos WHERE photo_file != ''").all()) referenced.add(path.basename(r.photo_file));
    for (const r of db.prepare("SELECT filename FROM documents WHERE filename != ''").all()) referenced.add(path.basename(r.filename));
    for (const r of db.prepare("SELECT file FROM meal_menu_files WHERE file != ''").all()) referenced.add(path.basename(r.file));
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
  // 打掃定期工作設定異動時，伺服器端記錄異動人與時間（不信任前端傳入）
  if (body.hk_sheet_days !== undefined || body.hk_supply_days !== undefined) {
    setSetting('hk_updated_by', req.session.user.name || '');
    setSetting('hk_updated_at', new Date().toLocaleString('sv-SE').slice(0, 19));
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
    id: user.id, name: user.name, role: user.role, id_no: user.id_no || '',
    service_scope: user.role === 'admin' ? '' : (user.service_scope || ''),
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
  const totalRooms = db.prepare("SELECT COUNT(*) c FROM rooms WHERE active = 1 AND room_type != '托嬰'").get().c;
  const occupied = db.prepare(`SELECT COUNT(DISTINCT bk.room_id) c FROM bookings bk JOIN rooms r ON r.id = bk.room_id WHERE bk.status = 'checked_in' AND r.room_type != '托嬰'`).get().c;
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
  // 進行中訂房的未結帳款（應收 = 合約 + 加購 − 寶寶未入住扣抵；已收 = 訂金 + 繳費）
  const unpaidRate = babyDeductRate();
  const unpaidRows = db.prepare(`
    SELECT bk.*, ${BILLING_SUMS} FROM bookings bk WHERE bk.status IN ('reserved','checked_in')`)
    .all().map(r => withBalance(r, unpaidRate)).filter(b => b.balance > 0);
  const unpaid = { c: unpaidRows.length, total: unpaidRows.reduce((s, b) => s + b.balance, 0) };
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
        ORDER BY bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT bk.check_in || ' ~ ' || bk.check_out FROM bookings bk
        WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in')
        ORDER BY bk.check_in DESC LIMIT 1) AS stay_range
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
    (name, phone, due_date, delivery_date, delivery_type, diet_notes, medical_notes, status, id_no)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    m.name, m.phone || '', m.due_date || '', m.delivery_date || '',
    m.delivery_type || '', m.diet_notes || '', m.medical_notes || '', m.status || 'reserved',
    String(m.id_no || '').slice(0, 10));
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/mothers/:id', requireStaff, (req, res) => {
  const m = req.body || {};
  const info = db.prepare(`UPDATE mothers SET
    name = ?, phone = ?, due_date = ?, delivery_date = ?, delivery_type = ?,
    diet_notes = ?, medical_notes = ?, status = ?, id_no = ? WHERE id = ?`).run(
    m.name, m.phone || '', m.due_date || '', m.delivery_date || '',
    m.delivery_type || '', m.diet_notes || '', m.medical_notes || '',
    m.status || 'reserved', String(m.id_no || '').slice(0, 10), req.params.id);
  if (!info.changes) return res.status(404).json({ error: '找不到資料' });
  res.json({ ok: true });
});

// ---------- 寶寶 ----------
app.get('/api/babies', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, m.name AS mother_name, m.status AS mother_status, bb.bed_no
    FROM babies b JOIN mothers m ON m.id = b.mother_id
    LEFT JOIN baby_beds bb ON bb.id = b.bed_id
    ORDER BY m.status = 'checked_in' DESC, b.id DESC`).all();
  res.json(rows);
});

// 床位指派防呆：床位需存在且啟用，且未被其他在住寶寶佔用
function validateBedAssign(bedId, excludeBabyId) {
  if (!bedId) return null;   // 未指派床位
  const bed = db.prepare('SELECT * FROM baby_beds WHERE id = ?').get(bedId);
  if (!bed) return '找不到指定的嬰兒床';
  if (!bed.active) return `嬰兒床 ${bed.bed_no} 已停用`;
  const occ = db.prepare(`SELECT b.name FROM babies b JOIN mothers m ON m.id = b.mother_id
    WHERE b.bed_id = ? AND m.status = 'checked_in' AND b.id != ? LIMIT 1`).get(bedId, excludeBabyId || -1);
  if (occ) return `嬰兒床 ${bed.bed_no} 已由「${occ.name}」使用中`;
  return null;
}

app.post('/api/babies', requireStaff, (req, res) => {
  const b = req.body || {};
  if (!b.mother_id || !b.name) return res.status(400).json({ error: '媽媽與姓名必填' });
  const bedId = b.bed_id ? Number(b.bed_id) : null;
  const bedErr = validateBedAssign(bedId, null);
  if (bedErr) return res.status(400).json({ error: bedErr });
  const info = db.prepare(`INSERT INTO babies
    (mother_id, name, gender, birth_date, birth_weight_g, notes, bed_id) VALUES (?,?,?,?,?,?,?)`).run(
    b.mother_id, b.name, b.gender || '', b.birth_date || '', b.birth_weight_g || null, b.notes || '', bedId);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/babies/:id', requireStaff, (req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM babies WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到資料' });
  const bedId = b.bed_id === undefined ? cur.bed_id : (b.bed_id ? Number(b.bed_id) : null);
  const bedErr = validateBedAssign(bedId, cur.id);
  if (bedErr) return res.status(400).json({ error: bedErr });
  db.prepare(`UPDATE babies SET
    name = ?, gender = ?, birth_date = ?, birth_weight_g = ?, notes = ?, bed_id = ? WHERE id = ?`).run(
    b.name, b.gender || '', b.birth_date || '', b.birth_weight_g || null, b.notes || '', bedId, req.params.id);
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
  // 地點未指定時，沿用寶寶目前所在位置（嬰兒室／親子同室／隔離室／不在館內）
  let location = BABY_LOCATIONS.includes(r.location) ? r.location : '';
  if (!location) {
    const baby = db.prepare('SELECT location FROM babies WHERE id = ?').get(req.params.id);
    location = baby ? baby.location : '';
  }
  // 紅臀程度僅在換尿布紀錄有意義，且須為合法選項，否則存空字串（未評估）
  const rash = (r.record_type === 'diaper' && DIAPER_RASH_LEVELS.includes(r.diaper_rash))
    ? r.diaper_rash : '';
  const lmin = r.record_type === 'feeding' && r.feed_left_min !== '' && r.feed_left_min != null ? Math.max(0, Math.round(Number(r.feed_left_min))) : null;
  const rmin = r.record_type === 'feeding' && r.feed_right_min !== '' && r.feed_right_min != null ? Math.max(0, Math.round(Number(r.feed_right_min))) : null;
  const info = db.prepare(`INSERT INTO baby_records
    (baby_id, nurse_id, record_type, feed_method, amount_ml, feed_left_min, feed_right_min, diaper_kind, diaper_rash, value_num, value_text, note, location, recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    req.params.id, req.session.user.id, r.record_type, r.feed_method || '',
    r.amount_ml || null, lmin, rmin, r.diaper_kind || '', rash, r.value_num ?? null, (r.value_text || '').slice(0, 200), r.note || '', location, recordedAt);
  maybeAlertAbnormal(req.params.id, r.record_type, r.value_num, recordedAt); // 異常即時通知值班
  res.json({ id: info.lastInsertRowid });
});

// 寶寶照護紀錄批次新增（巡房批次用）：多位寶寶／多筆一次寫入，單一交易原子性
app.post('/api/baby-records/batch', requireStaff, (req, res) => {
  const list = Array.isArray((req.body || {}).records) ? req.body.records : [];
  const valid = list.filter(r => r && r.record_type && r.baby_id);
  if (!valid.length) return res.status(400).json({ error: '沒有可儲存的紀錄' });
  const ins = db.prepare(`INSERT INTO baby_records
    (baby_id, nurse_id, record_type, feed_method, amount_ml, feed_left_min, feed_right_min, diaper_kind, diaper_rash, value_num, value_text, note, location, recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const getLoc = db.prepare('SELECT location FROM babies WHERE id = ?');
  const nowStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const alerts = [];
  const tx = db.transaction(() => {
    for (const r of valid) {
      const recordedAt = (r.recorded_at && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(r.recorded_at)) ? r.recorded_at : nowStr();
      let location = BABY_LOCATIONS.includes(r.location) ? r.location : '';
      if (!location) { const b = getLoc.get(r.baby_id); location = b ? b.location : ''; }
      const rash = (r.record_type === 'diaper' && DIAPER_RASH_LEVELS.includes(r.diaper_rash)) ? r.diaper_rash : '';
      const lmin = r.record_type === 'feeding' && r.feed_left_min !== '' && r.feed_left_min != null ? Math.max(0, Math.round(Number(r.feed_left_min))) : null;
      const rmin = r.record_type === 'feeding' && r.feed_right_min !== '' && r.feed_right_min != null ? Math.max(0, Math.round(Number(r.feed_right_min))) : null;
      ins.run(r.baby_id, req.session.user.id, r.record_type, r.feed_method || '', r.amount_ml || null, lmin, rmin,
        r.diaper_kind || '', rash, r.value_num ?? null, (r.value_text || '').slice(0, 200), r.note || '', location, recordedAt);
      alerts.push({ babyId: r.baby_id, type: r.record_type, value: r.value_num, recordedAt });
    }
  });
  tx();
  for (const a of alerts) maybeAlertAbnormal(a.babyId, a.type, a.value, a.recordedAt); // 交易外再送異常通知
  res.json({ added: valid.length });
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

// ---------- 寶寶位置（嬰兒室／親子同室／隔離室／不在館內）----------
app.put('/api/babies/:id/location', requireStaff, (req, res) => {
  const loc = req.body && req.body.location;
  if (!BABY_LOCATIONS.includes(loc)) {
    return res.status(400).json({ error: '位置須為 nursery／rooming／isolation／out' });
  }
  const movedAt = (req.body && req.body.moved_at) || '';
  if (movedAt && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(movedAt)) {
    return res.status(400).json({ error: '異動時間格式需為 YYYY-MM-DD HH:MM' });
  }
  const baby = db.prepare('SELECT location FROM babies WHERE id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  db.prepare('UPDATE babies SET location = ? WHERE id = ?').run(loc, req.params.id);
  db.prepare(`INSERT INTO baby_location_logs (baby_id, nurse_id, location, note, moved_at)
    VALUES (?,?,?,?,?)`).run(req.params.id, req.session.user.id, loc,
    (req.body && req.body.note) || '',
    movedAt || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' '));
  res.json({ ok: true, location: loc });
});

// 臍帶掉落：一次性事件，記錄後不可重複（同步寫入一筆觀察紀錄供日報／時間軸顯示）
app.post('/api/babies/:id/cord-off', requireStaff, (req, res) => {
  const baby = db.prepare('SELECT id, cord_off_at, location FROM babies WHERE id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  if (baby.cord_off_at) return res.status(409).json({ error: '臍帶掉落已登記過，無法重複登記' });
  const d = (req.body && req.body.date) || '';
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: '日期格式需為 YYYY-MM-DD' });
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const at = d ? `${d} ${nowLocal.slice(11)}` : nowLocal;
  const tx = db.transaction(() => {
    db.prepare('UPDATE babies SET cord_off_at = ? WHERE id = ?').run(at, baby.id);
    db.prepare(`INSERT INTO baby_records (baby_id, nurse_id, record_type, value_text, note, location, recorded_at)
      VALUES (?, ?, 'cord', '臍帶掉落', ?, ?, ?)`)
      .run(baby.id, req.session.user.id, (req.body && req.body.note) || '', baby.location || '', at);
  });
  tx();
  res.json({ ok: true, cord_off_at: at });
});

app.get('/api/babies/:id/location-logs', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT ll.*, u.name AS nurse_name FROM baby_location_logs ll
    LEFT JOIN users u ON u.id = ll.nurse_id
    WHERE ll.baby_id = ? ORDER BY ll.moved_at DESC LIMIT 50`).all(req.params.id);
  res.json(rows);
});

// ---------- 寶寶護理每日評估（中衛必要欄位－嬰兒日常評估） ----------
// data 僅收白名單欄位；多選以陣列、紅臀左右以物件保存
const BNA_FIELDS = [
  'medical_no', 'bath', 'heart_rate', 'respiration', 'lip_color', 'muscle_tone',
  'appearance', 'appearance_note', 'cord', 'milk_types', 'milk_note', 'feeding_status',
  'skin_color', 'skin_conditions', 'skin_notes', 'rash_left', 'rash_right',
  'stool', 'stool_count_note', 'stool_amount', 'stool_color', 'stool_color_note', 'stool_texture',
  'urine', 'urine_count_note', 'urine_amount', 'urine_note',
  'rooming', 'rooming_shifts', 'nurse_id_no'
];

app.get('/api/babies/:id/nursing', requireStaff, (req, res) => {
  const baby = db.prepare(`
    SELECT b.*, m.name AS mother_name, m.status AS mother_status,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS mother_check_in,
      (SELECT bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS mother_check_out
    FROM babies b JOIN mothers m ON m.id = b.mother_id WHERE b.id = ?`).get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const rows = db.prepare(`
    SELECT a.*, u.name AS nurse_name FROM baby_nursing_assessments a
    LEFT JOIN users u ON u.id = a.nurse_id
    WHERE a.baby_id = ? ORDER BY a.assess_date DESC, a.assess_time DESC, a.id DESC LIMIT 200`).all(baby.id);
  for (const r of rows) { try { r.data = JSON.parse(r.data); } catch (e) { r.data = {}; } }
  const rooming = db.prepare(`
    SELECT l.*, u.name AS nurse_name FROM baby_rooming_logs l
    LEFT JOIN users u ON u.id = l.nurse_id
    WHERE l.baby_id = ? ORDER BY l.log_date DESC, l.log_time DESC, l.id DESC LIMIT 200`).all(baby.id);
  res.json({ baby, rows, rooming, bf_reminder: bfReminder(baby) });
});

app.post('/api/babies/:id/nursing', requireStaff, (req, res) => {
  const baby = db.prepare('SELECT id FROM babies WHERE id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.assess_date || '') ? b.assess_date : today();
  const time = /^\d{2}:\d{2}/.test(b.assess_time || '') ? b.assess_time.slice(0, 5) : '';
  if (!time) return res.status(400).json({ error: '請填寫評估時間' });
  const weight = Number(b.weight_g), temp = Number(b.temperature);
  if (!(weight > 0 && weight <= 99999.9)) return res.status(400).json({ error: '體重需為 0～99999.9（g）' });
  if (!(temp > 0 && temp <= 99.9)) return res.status(400).json({ error: '體溫需為 0～99.9（度C）' });
  const data = {};
  for (const k of BNA_FIELDS) if (b[k] !== undefined) data[k] = b[k];
  const info = db.prepare(`INSERT INTO baby_nursing_assessments
    (baby_id, nurse_id, assess_date, assess_time, weight_g, temperature, data, special_note)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    baby.id, req.session.user.id, date, time, weight, temp,
    JSON.stringify(data).slice(0, 8000), String(b.special_note || '').slice(0, 500));
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/baby-nursing/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM baby_nursing_assessments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 寶寶親子同室護理紀錄 ----------
app.post('/api/babies/:id/rooming-logs', requireStaff, (req, res) => {
  const baby = db.prepare('SELECT id FROM babies WHERE id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.log_date || '') ? b.log_date : today();
  const time = /^\d{2}:\d{2}/.test(b.log_time || '') ? b.log_time.slice(0, 5) : '';
  if (!time) return res.status(400).json({ error: '請填寫紀錄時間' });
  const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
  const hhmm = v => /^\d{2}:\d{2}/.test(v || '') ? String(v).slice(0, 5) : '';
  const info = db.prepare(`INSERT INTO baby_rooming_logs
    (baby_id, nurse_id, log_date, log_time, breastfeed_min, breast_milk_ml, formula_ml,
     stool, urine, out_time, return_time, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    baby.id, req.session.user.id, date, time,
    num(b.breastfeed_min), num(b.breast_milk_ml), num(b.formula_ml),
    String(b.stool || '').slice(0, 50), String(b.urine || '').slice(0, 50),
    hhmm(b.out_time), hhmm(b.return_time), String(b.note || '').slice(0, 300));
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/baby-rooming/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM baby_rooming_logs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 母乳哺育評估 ----------
// 哺餵母乳評估提醒（比照參考系統：入住第 3 天應執行；最早一筆評估視為執行）
function bfReminder(baby) {
  const bk = db.prepare(`
    SELECT check_in FROM bookings WHERE mother_id = ? AND status IN ('checked_in','checked_out')
    ORDER BY status = 'checked_in' DESC, check_in DESC LIMIT 1`).get(baby.mother_id);
  if (!bk || !bk.check_in) return null;
  const remind = new Date(new Date(bk.check_in).getTime() + 2 * 86400000).toISOString().slice(0, 10);
  const first = db.prepare(`
    SELECT a.assess_date, u.name AS nurse_name FROM breastfeeding_assessments a
    LEFT JOIN users u ON u.id = a.nurse_id WHERE a.baby_id = ?
    ORDER BY a.assess_date, a.id LIMIT 1`).get(baby.id);
  return {
    remind_date: remind, day_label: '入住第3天',
    done_date: first ? first.assess_date : '', done_by: first ? (first.nurse_name || '') : ''
  };
}

app.get('/api/babies/:id/breastfeeding', requireStaff, (req, res) => {
  const baby = db.prepare(`
    SELECT b.*, m.name AS mother_name, m.delivery_type, m.delivery_date,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name
    FROM babies b JOIN mothers m ON m.id = b.mother_id WHERE b.id = ?`).get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const rows = db.prepare(`
    SELECT a.*, u.name AS nurse_name FROM breastfeeding_assessments a
    LEFT JOIN users u ON u.id = a.nurse_id
    WHERE a.baby_id = ? ORDER BY a.assess_date DESC, a.id DESC LIMIT 100`).all(baby.id);
  for (const r of rows) { try { r.items = JSON.parse(r.items); } catch (e) { r.items = {}; } }
  // 表頭自動帶入：目前體重＝寶寶照護紀錄最近一筆體重；胎次＝入住評估表 → 客戶管理
  const wRec = db.prepare(`SELECT value_num FROM baby_records
    WHERE baby_id = ? AND record_type = 'weight' AND value_num IS NOT NULL
    ORDER BY recorded_at DESC, id DESC LIMIT 1`).get(baby.id);
  let parity = '';
  const mia = intakeForMother(baby.mother_id);
  if (mia) { try { parity = JSON.parse(mia.data).parity || ''; } catch (e) { /* */ } }
  if (!parity) {
    const cp = db.prepare('SELECT data FROM customer_profiles WHERE mother_id = ?').get(baby.mother_id);
    if (cp) { try { parity = JSON.parse(cp.data).parity || ''; } catch (e) { /* */ } }
  }
  res.json({ baby, rows, reminder: bfReminder(baby),
    prefill: { current_weight_g: wRec ? wRec.value_num : null, parity: String(parity) } });
});

app.post('/api/babies/:id/breastfeeding', requireStaff, (req, res) => {
  const baby = db.prepare('SELECT id FROM babies WHERE id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.assess_date || '') ? b.assess_date : today();
  const items = (b.items && typeof b.items === 'object') ? b.items : {};
  const weight = b.current_weight_g === '' || b.current_weight_g == null ? null : Number(b.current_weight_g);
  const info = db.prepare(`INSERT INTO breastfeeding_assessments
    (baby_id, nurse_id, assess_date, current_weight_g, parity, feed_type,
     avg_pump_ml, milk_brand, milk_amount, items, other_note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    baby.id, req.session.user.id, date, isNaN(weight) ? null : weight,
    String(b.parity || '').slice(0, 20), String(b.feed_type || '').slice(0, 20),
    String(b.avg_pump_ml || '').slice(0, 30), String(b.milk_brand || '').slice(0, 50),
    String(b.milk_amount || '').slice(0, 30),
    JSON.stringify(items).slice(0, 8000), String(b.other_note || '').slice(0, 500));
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/breastfeeding/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM breastfeeding_assessments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 寶寶評估單（中衛必要欄位－嬰兒個案基本資料＋嬰兒入住評估） ----------
// 個案基本資料（每寶寶一筆，覆寫更新）白名單欄位
const BCP_FIELDS = [
  'checkin_date', 'checkin_time', 'birth_date', 'birth_time', 'birth_place', 'apgar',
  'delivery_modes', 'delivery_other',
  'birth_weight_cat', 'birth_weight_g', 'discharge_weight_cat', 'discharge_weight_g', 'current_weight_g',
  'birth_length_cat', 'birth_length_cm', 'current_length_cm',
  'prom', 'doic', 'ma', 'metabolic_screen', 'metabolic_screen_date', 'vaccination',
  'hbig_date', 'hbv_date',
  'flu_fever', 'flu_cough', 'flu_diarrhea', 'flu_rash',
  'ev_temp', 'ev_mouth_red', 'ev_mouth_blister', 'ev_limb_blister', 'ev_limb_rash',
  'special_care', 'caregiver_id_no',
  'handover_note', 'swim_count'   // 新生兒交班單頁的重要備註／寶寶游泳次數（同一份個案 profile 保存）
];
// 入住評估白名單欄位
const BIA_FIELDS = [
  'bt', 'hr', 'rr', 'head_circ', 'head_status', 'head_status_note',
  'fontanelle', 'fontanelle_note', 'scalp', 'hematoma_site', 'hematoma_size', 'scalp_other_note',
  'eye_left', 'eye_right', 'pupil_left', 'pupil_right',
  'ear', 'ear_note', 'nose', 'nose_note',
  'mouth', 'mouth_conditions', 'mouth_other_note', 'neck', 'neck_note',
  'skin_color', 'skin_conditions', 'skin_notes', 'rash_left', 'rash_right',
  'chest', 'chest_note', 'resp_rate', 'resp_pattern', 'resp_pattern_note',
  'heart_rate', 'heart_rate_note', 'limb_temp', 'limb_color',
  'abdomen', 'abdomen_note', 'bowel_sound', 'caregiver_id_no'
];
// 嬰兒病歷號：系統帶入，依寶寶編號固定產生（沿用於基本資料與入住評估）
const babyMedicalNo = id => 'B' + String(id).padStart(5, '0');

app.get('/api/babies/:id/eval', requireStaff, (req, res) => {
  const baby = db.prepare(`
    SELECT b.*, m.name AS mother_name,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT bk.baby_check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS baby_check_in,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS mother_check_in
    FROM babies b JOIN mothers m ON m.id = b.mother_id WHERE b.id = ?`).get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const prof = db.prepare(`
    SELECT p.*, u.name AS nurse_name FROM baby_case_profiles p
    LEFT JOIN users u ON u.id = p.nurse_id WHERE p.baby_id = ?`).get(baby.id);
  if (prof) { try { prof.data = JSON.parse(prof.data); } catch (e) { prof.data = {}; } }
  const rows = db.prepare(`
    SELECT a.*, u.name AS nurse_name FROM baby_intake_assessments a
    LEFT JOIN users u ON u.id = a.nurse_id
    WHERE a.baby_id = ? ORDER BY a.assess_date DESC, a.assess_time DESC, a.id DESC LIMIT 100`).all(baby.id);
  for (const r of rows) { try { r.data = JSON.parse(r.data); } catch (e) { r.data = {}; } }
  res.json({ baby, medical_no: babyMedicalNo(baby.id), profile: prof || null, rows });
});

// 個案基本資料存檔（部分欄位亦可，與既有資料合併；「入住日存檔」即只送入住日期時間）
app.put('/api/babies/:id/eval-profile', requireStaff, (req, res) => {
  const baby = db.prepare('SELECT b.id, b.mother_id FROM babies b WHERE b.id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const b = req.body || {};
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const isTime = v => /^\d{2}:\d{2}/.test(v || '');
  for (const k of ['checkin_date', 'birth_date', 'metabolic_screen_date', 'hbig_date', 'hbv_date']) {
    if (b[k] !== undefined && b[k] !== '' && !isDate(b[k])) return res.status(400).json({ error: '日期格式錯誤（YYYY-MM-DD）' });
  }
  for (const k of ['checkin_time', 'birth_time']) {
    if (b[k] !== undefined && b[k] !== '' && !isTime(b[k])) return res.status(400).json({ error: '時間格式錯誤（HH:MM）' });
    if (b[k]) b[k] = String(b[k]).slice(0, 5);
  }
  if (b.apgar !== undefined && b.apgar !== '') {
    const a = Number(b.apgar);
    if (!(a >= 1 && a <= 10)) return res.status(400).json({ error: 'APGAR 需為 1～10' });
  }
  const cur = db.prepare('SELECT data FROM baby_case_profiles WHERE baby_id = ?').get(baby.id);
  let data = {};
  if (cur) { try { data = JSON.parse(cur.data); } catch (e) { data = {}; } }
  for (const k of BCP_FIELDS) if (b[k] !== undefined) {
    data[k] = (typeof b[k] === 'string') ? b[k].slice(0, 200) : b[k];
  }
  data.medical_no = babyMedicalNo(baby.id);
  const json = JSON.stringify(data).slice(0, 8000);
  if (cur) {
    db.prepare(`UPDATE baby_case_profiles SET nurse_id=?, data=?, updated_at=datetime('now','localtime') WHERE baby_id=?`)
      .run(req.session.user.id, json, baby.id);
  } else {
    db.prepare('INSERT INTO baby_case_profiles (baby_id, nurse_id, data) VALUES (?,?,?)')
      .run(baby.id, req.session.user.id, json);
  }
  // 入住日期同步至進行中訂房的「寶寶入住日」（帳務不同住天數計算沿用此欄位）
  if (isDate(b.checkin_date)) {
    db.prepare(`UPDATE bookings SET baby_check_in = ? WHERE id =
      (SELECT id FROM bookings WHERE mother_id = ? AND status = 'checked_in' ORDER BY check_in DESC LIMIT 1)`)
      .run(b.checkin_date, baby.mother_id);
  }
  logAudit(req, { action: 'update', entity: 'baby_case_profiles', entity_id: baby.id, summary: '寶寶評估單－個案基本資料' });
  res.json({ ok: true });
});

// 嬰兒入住評估（新增一筆）
app.post('/api/babies/:id/intake-assessments', requireStaff, (req, res) => {
  const baby = db.prepare('SELECT id FROM babies WHERE id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.assess_date || '') ? b.assess_date : today();
  const time = /^\d{2}:\d{2}/.test(b.assess_time || '') ? b.assess_time.slice(0, 5) : '';
  if (!time) return res.status(400).json({ error: '請填寫評估時間' });
  const bt = Number(b.bt), hr = Number(b.hr), rr = Number(b.rr), head = Number(b.head_circ);
  if (!(bt > 0 && bt <= 99.9)) return res.status(400).json({ error: 'BT（肛溫）需為 0～99.9（°C）' });
  if (!(hr > 0 && hr <= 999)) return res.status(400).json({ error: 'HR（心跳）需為 0～999（bpm）' });
  if (!(rr > 0 && rr <= 999)) return res.status(400).json({ error: 'RR（呼吸）需為 0～999（bpm）' });
  if (!(head > 0 && head <= 999.9)) return res.status(400).json({ error: '頭圍需為 0～999.9（cm）' });
  const data = { medical_no: babyMedicalNo(baby.id) };
  for (const k of BIA_FIELDS) if (b[k] !== undefined) {
    data[k] = (typeof b[k] === 'string') ? b[k].slice(0, 200) : b[k];
  }
  const info = db.prepare(`INSERT INTO baby_intake_assessments
    (baby_id, nurse_id, assess_date, assess_time, data) VALUES (?,?,?,?,?)`).run(
    baby.id, req.session.user.id, date, time, JSON.stringify(data).slice(0, 8000));
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/baby-intake/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM baby_intake_assessments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 兒科醫師診視紀錄（醫師巡診） ----------
// data 僅收白名單欄位；各部位以陣列（多選）／字串（單選、補述）保存
const BDV_FIELDS = [
  'gest_weeks', 'birth_days', 'birth_weight_g',
  'skin', 'skin_other', 'head', 'head_hema_sides', 'fontanelle',
  'eyes', 'eye_secretion_side', 'eye_secretion_color', 'eye_secretion_amount', 'eye_conj_side',
  'mouth', 'mouth_other', 'neck', 'neck_side', 'clavicle', 'clavicle_side',
  'heart', 'lungs', 'lung_note', 'umbilicus', 'umb_other',
  'genital', 'genital_undescended_side', 'genital_hernia_side', 'genital_other',
  'buttock', 'rash_w', 'rash_h'
];
function normalizeDoctorVisit(b) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.visit_date || '') ? b.visit_date : today();
  const time = /^\d{2}:\d{2}/.test(b.visit_time || '') ? b.visit_time.slice(0, 5) : '';
  const weight = (b.weight_g === '' || b.weight_g == null) ? null : Number(b.weight_g);
  if (weight != null && !(weight > 0 && weight <= 99999.9)) return { error: '體重需為 0～99999.9（gm）' };
  const data = {};
  for (const k of BDV_FIELDS) if (b[k] !== undefined) {
    data[k] = (typeof b[k] === 'string') ? b[k].slice(0, 200) : b[k];
  }
  return { date, time, weight, data, note: String(b.note || '').slice(0, 600) };
}

app.get('/api/babies/:id/doctor-visits', requireStaff, (req, res) => {
  const baby = db.prepare(`
    SELECT b.*, m.name AS mother_name,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS mother_check_in,
      (SELECT bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS mother_check_out
    FROM babies b JOIN mothers m ON m.id = b.mother_id WHERE b.id = ?`).get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const rows = db.prepare(`
    SELECT v.*, u.name AS recorded_by_name, e.name AS edited_by_name
    FROM baby_doctor_visits v
    LEFT JOIN users u ON u.id = v.recorded_by
    LEFT JOIN users e ON e.id = v.edited_by
    WHERE v.baby_id = ? ORDER BY v.visit_date DESC, v.visit_time DESC, v.id DESC LIMIT 200`).all(baby.id);
  for (const r of rows) { try { r.data = JSON.parse(r.data); } catch (e) { r.data = {}; } }
  res.json({ baby, rows });
});

app.post('/api/babies/:id/doctor-visits', requireStaff, (req, res) => {
  const baby = db.prepare('SELECT id FROM babies WHERE id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const b = req.body || {};
  if (!/^\d{2}:\d{2}/.test(b.visit_time || '')) return res.status(400).json({ error: '請填寫診視時間' });
  const v = normalizeDoctorVisit(b);
  if (v.error) return res.status(400).json({ error: v.error });
  const info = db.prepare(`INSERT INTO baby_doctor_visits
    (baby_id, recorded_by, visit_date, visit_time, weight_g, data, note)
    VALUES (?,?,?,?,?,?,?)`).run(
    baby.id, req.session.user.id, v.date, v.time, v.weight,
    JSON.stringify(v.data).slice(0, 8000), v.note);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/baby-doctor-visits/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM baby_doctor_visits WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到診視紀錄' });
  const b = req.body || {};
  if (!/^\d{2}:\d{2}/.test(b.visit_time || '')) return res.status(400).json({ error: '請填寫診視時間' });
  const v = normalizeDoctorVisit(b);
  if (v.error) return res.status(400).json({ error: v.error });
  db.prepare(`UPDATE baby_doctor_visits SET visit_date=?, visit_time=?, weight_g=?, data=?, note=?,
    edited_at=datetime('now','localtime'), edited_by=? WHERE id=?`).run(
    v.date, v.time, v.weight, JSON.stringify(v.data).slice(0, 8000), v.note,
    req.session.user.id, cur.id);
  logAudit(req, { action: 'update', entity: 'baby_doctor_visits', entity_id: cur.id, summary: '兒科醫師診視紀錄修改' });
  res.json({ ok: true });
});

app.delete('/api/baby-doctor-visits/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM baby_doctor_visits WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 產科醫師診視紀錄（醫師巡診；媽媽） ----------
// data 僅收白名單欄位；多選以陣列、單選／補述以字串保存
const MDV_FIELDS = [
  'postpartum_days', 'parity', 'delivery_mode',
  'mood', 'epds_score', 'complaint', 'complaint_text',
  'feeding', 'breast',
  'ep_wound', 'ep_med', 'ep_med_text',
  'fundus_height', 'uterus_state',
  'lochia_amount', 'lochia_color',
  'urine', 'stool', 'laxative', 'laxative_text',
  'hemorrhoid', 'hem_ointment', 'hem_text',
  'edema_none', 'edema_right', 'edema_left'
];
function normalizeMotherVisit(b) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.visit_date || '') ? b.visit_date : today();
  const time = /^\d{2}:\d{2}/.test(b.visit_time || '') ? b.visit_time.slice(0, 5) : '';
  const data = {};
  for (const k of MDV_FIELDS) if (b[k] !== undefined) {
    data[k] = (typeof b[k] === 'string') ? b[k].slice(0, 200) : b[k];
  }
  return { date, time, data, note: String(b.note || '').slice(0, 600) };
}

app.get('/api/mothers/:id/doctor-visits', requireStaff, (req, res) => {
  const mother = db.prepare(`
    SELECT m.*,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS check_in,
      (SELECT bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS check_out
    FROM mothers m WHERE m.id = ?`).get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const rows = db.prepare(`
    SELECT v.*, u.name AS recorded_by_name, e.name AS edited_by_name
    FROM mother_doctor_visits v
    LEFT JOIN users u ON u.id = v.recorded_by
    LEFT JOIN users e ON e.id = v.edited_by
    WHERE v.mother_id = ? ORDER BY v.visit_date DESC, v.visit_time DESC, v.id DESC LIMIT 200`).all(mother.id);
  for (const r of rows) { try { r.data = JSON.parse(r.data); } catch (e) { r.data = {}; } }
  res.json({ mother, rows });
});

app.post('/api/mothers/:id/doctor-visits', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const b = req.body || {};
  if (!/^\d{2}:\d{2}/.test(b.visit_time || '')) return res.status(400).json({ error: '請填寫診視時間' });
  const v = normalizeMotherVisit(b);
  const info = db.prepare(`INSERT INTO mother_doctor_visits
    (mother_id, recorded_by, visit_date, visit_time, data, note)
    VALUES (?,?,?,?,?,?)`).run(
    mother.id, req.session.user.id, v.date, v.time,
    JSON.stringify(v.data).slice(0, 8000), v.note);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/mother-doctor-visits/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM mother_doctor_visits WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到診視紀錄' });
  const b = req.body || {};
  if (!/^\d{2}:\d{2}/.test(b.visit_time || '')) return res.status(400).json({ error: '請填寫診視時間' });
  const v = normalizeMotherVisit(b);
  db.prepare(`UPDATE mother_doctor_visits SET visit_date=?, visit_time=?, data=?, note=?,
    edited_at=datetime('now','localtime'), edited_by=? WHERE id=?`).run(
    v.date, v.time, JSON.stringify(v.data).slice(0, 8000), v.note,
    req.session.user.id, cur.id);
  logAudit(req, { action: 'update', entity: 'mother_doctor_visits', entity_id: cur.id, summary: '產科醫師診視紀錄修改' });
  res.json({ ok: true });
});

app.delete('/api/mother-doctor-visits/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM mother_doctor_visits WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 新生兒交班單 ----------
const BHO_FEED = ['瓶', '針', '杯'];
const BHO_PACIFIER = ['可吃', '禁嘴', '必要時可吃'];
const BHO_ISOLATION = ['寶寶隔離', '奶瓶隔離'];
const BHO_SLEEP = ['安穩', '安撫可睡著', '哭鬧'];
function normalizeHandover(b) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.handover_date || '') ? b.handover_date : today();
  const time = /^\d{2}:\d{2}/.test(b.handover_time || '') ? b.handover_time.slice(0, 5) : '';
  const num = (v, max) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return (n > 0 && n <= max) ? n : NaN;
  };
  const weight = num(b.weight_g, 99999.9), jaundice = num(b.jaundice, 99.9);
  if (Number.isNaN(weight)) return { error: '體重需為 0～99999.9（gm）' };
  if (Number.isNaN(jaundice)) return { error: '黃疸值需為 0～99.9（mg/dl）' };
  return {
    date, time, weight, jaundice,
    feed_method: BHO_FEED.includes(b.feed_method) ? b.feed_method : '',
    pacifier: BHO_PACIFIER.includes(b.pacifier) ? b.pacifier : '',
    isolation: JSON.stringify((Array.isArray(b.isolation) ? b.isolation : []).filter(x => BHO_ISOLATION.includes(x))),
    sleep: BHO_SLEEP.includes(b.sleep) ? b.sleep : '',
    cord: String(b.cord || '').slice(0, 100),
    note: String(b.note || '').slice(0, 600)
  };
}

app.get('/api/babies/:id/handovers', requireStaff, (req, res) => {
  const baby = db.prepare(`
    SELECT b.*, m.name AS mother_name, m.delivery_type,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name
    FROM babies b JOIN mothers m ON m.id = b.mother_id WHERE b.id = ?`).get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const prof = db.prepare('SELECT data FROM baby_case_profiles WHERE baby_id = ?').get(baby.id);
  let profData = {};
  if (prof) { try { profData = JSON.parse(prof.data); } catch (e) { profData = {}; } }
  const rows = db.prepare(`
    SELECT h.*, u.name AS nurse_name, e.name AS edited_by_name
    FROM baby_handovers h
    LEFT JOIN users u ON u.id = h.nurse_id
    LEFT JOIN users e ON e.id = h.edited_by
    WHERE h.baby_id = ? ORDER BY h.handover_date DESC, h.handover_time DESC, h.id DESC LIMIT 200`).all(baby.id);
  for (const r of rows) { try { r.isolation = JSON.parse(r.isolation); } catch (e) { r.isolation = []; } }

  // 表頭彙整：疫苗／胎次奶品／週數／最後喝奶／黃疸／現在體重
  const vacc = kind => db.prepare(`SELECT administered_at FROM vaccinations
    WHERE baby_id = ? AND vaccine = ? AND status = 'done' AND administered_at != ''
    ORDER BY administered_at DESC LIMIT 1`).get(baby.id, kind);
  const bfa = db.prepare(`SELECT parity, milk_brand FROM breastfeeding_assessments
    WHERE baby_id = ? ORDER BY assess_date DESC, id DESC LIMIT 1`).get(baby.id);
  const bdv = db.prepare(`SELECT data FROM baby_doctor_visits
    WHERE baby_id = ? ORDER BY visit_date DESC, visit_time DESC, id DESC LIMIT 1`).get(baby.id);
  let gestWeeks = '';
  if (bdv) { try { gestWeeks = JSON.parse(bdv.data).gest_weeks || ''; } catch (e) { /* */ } }
  const lastFeed = db.prepare(`SELECT recorded_at, feed_method, amount_ml FROM baby_records
    WHERE baby_id = ? AND record_type = 'feeding' ORDER BY recorded_at DESC LIMIT 1`).get(baby.id);
  const firstJaundice = db.prepare(`SELECT value_num, recorded_at FROM baby_records
    WHERE baby_id = ? AND record_type = 'jaundice' AND value_num IS NOT NULL ORDER BY recorded_at LIMIT 1`).get(baby.id);
  const lastJaundice = db.prepare(`SELECT value_num, recorded_at FROM baby_records
    WHERE baby_id = ? AND record_type = 'jaundice' AND value_num IS NOT NULL ORDER BY recorded_at DESC LIMIT 1`).get(baby.id);
  const lastWeight = db.prepare(`SELECT value_num, recorded_at FROM baby_records
    WHERE baby_id = ? AND record_type = 'weight' AND value_num IS NOT NULL ORDER BY recorded_at DESC LIMIT 1`).get(baby.id);
  // 照護紀錄與交班單皆可能有最新體重／黃疸：取日期較新者
  const newer = (rec, hoRow, field) => {
    const hoDate = hoRow ? `${hoRow.handover_date} ${hoRow.handover_time}` : '';
    if (rec && (!hoRow || rec.recorded_at >= hoDate)) return { value: rec.value_num, at: rec.recorded_at.slice(0, 10) };
    if (hoRow) return { value: hoRow[field], at: hoRow.handover_date };
    return null;
  };
  const hoWeight = rows.find(r => r.weight_g != null);
  const hoJaundice = rows.find(r => r.jaundice != null);
  const header = {
    bcg_date: (vacc('bcg') || {}).administered_at || '',
    hbig_date: (vacc('hepb_immunoglobulin') || {}).administered_at || profData.hbig_date || '',
    parity: bfa ? bfa.parity : '', milk_brand: bfa ? bfa.milk_brand : '',
    gest_weeks: gestWeeks,
    birth_place: profData.birth_place || '',
    last_feed: lastFeed || null,
    jaundice_birth: firstJaundice ? firstJaundice.value_num : null,
    jaundice_now: newer(lastJaundice, hoJaundice, 'jaundice'),
    weight_now: newer(lastWeight, hoWeight, 'weight_g'),
    handover_note: profData.handover_note || '', swim_count: profData.swim_count || '',
    feed_method_now: rows.length ? rows[0].feed_method : '',
    pacifier_now: rows.length ? rows[0].pacifier : ''
  };

  // 寶寶每日奶量統計（近 14 天）：母奶／配方／總量、小便大便次數、親子同室時數
  const stats = db.prepare(`
    SELECT date(recorded_at) AS d,
      SUM(CASE WHEN record_type='feeding' AND (feed_method LIKE '%母%' OR feed_method LIKE '%親%') THEN COALESCE(amount_ml,0) ELSE 0 END) AS breast_ml,
      SUM(CASE WHEN record_type='feeding' AND feed_method LIKE '%配方%' THEN COALESCE(amount_ml,0) ELSE 0 END) AS formula_ml,
      SUM(CASE WHEN record_type='feeding' THEN COALESCE(amount_ml,0) ELSE 0 END) AS total_ml,
      SUM(CASE WHEN record_type='diaper' AND diaper_kind='濕' THEN 1 ELSE 0 END) AS urine,
      SUM(CASE WHEN record_type='diaper' AND diaper_kind='便' THEN 1 ELSE 0 END) AS stool
    FROM baby_records WHERE baby_id = ? AND record_type IN ('feeding','diaper')
    GROUP BY date(recorded_at) ORDER BY d DESC LIMIT 14`).all(baby.id);
  const roomingLogs = db.prepare(`SELECT log_date, out_time, return_time FROM baby_rooming_logs
    WHERE baby_id = ? AND out_time != '' AND return_time != ''`).all(baby.id);
  const roomingHours = {};
  for (const l of roomingLogs) {
    const [oh, om] = l.out_time.split(':').map(Number), [rh, rm] = l.return_time.split(':').map(Number);
    let hrs = (rh * 60 + rm - oh * 60 - om) / 60;
    if (hrs < 0) hrs += 24;   // 跨夜
    roomingHours[l.log_date] = (roomingHours[l.log_date] || 0) + hrs;
  }
  for (const s of stats) s.rooming_hours = roomingHours[s.d] ? Math.round(roomingHours[s.d] * 10) / 10 : 0;

  res.json({ baby, rows, header, stats });
});

app.post('/api/babies/:id/handovers', requireStaff, (req, res) => {
  const baby = db.prepare('SELECT id FROM babies WHERE id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const b = req.body || {};
  if (!/^\d{2}:\d{2}/.test(b.handover_time || '')) return res.status(400).json({ error: '請填寫交班時間' });
  const v = normalizeHandover(b);
  if (v.error) return res.status(400).json({ error: v.error });
  const info = db.prepare(`INSERT INTO baby_handovers
    (baby_id, nurse_id, handover_date, handover_time, feed_method, pacifier, isolation,
     weight_g, jaundice, cord, sleep, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    baby.id, req.session.user.id, v.date, v.time, v.feed_method, v.pacifier, v.isolation,
    v.weight, v.jaundice, v.cord, v.sleep, v.note);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/baby-handovers/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM baby_handovers WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到交班紀錄' });
  const b = req.body || {};
  if (!/^\d{2}:\d{2}/.test(b.handover_time || '')) return res.status(400).json({ error: '請填寫交班時間' });
  const v = normalizeHandover(b);
  if (v.error) return res.status(400).json({ error: v.error });
  db.prepare(`UPDATE baby_handovers SET handover_date=?, handover_time=?, feed_method=?, pacifier=?,
    isolation=?, weight_g=?, jaundice=?, cord=?, sleep=?, note=?,
    edited_at=datetime('now','localtime'), edited_by=? WHERE id=?`).run(
    v.date, v.time, v.feed_method, v.pacifier, v.isolation,
    v.weight, v.jaundice, v.cord, v.sleep, v.note, req.session.user.id, cur.id);
  logAudit(req, { action: 'update', entity: 'baby_handovers', entity_id: cur.id, summary: '新生兒交班單修改' });
  res.json({ ok: true });
});

app.delete('/api/baby-handovers/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM baby_handovers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 產婦交班單 ----------
function normalizeMotherHandover(b) {
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.handover_date || '') ? b.handover_date : today(),
    time: /^\d{2}:\d{2}/.test(b.handover_time || '') ? b.handover_time.slice(0, 5) : '',
    fundus: String(b.fundus || '').slice(0, 100),
    lochia: String(b.lochia || '').slice(0, 200),
    note: String(b.note || '').slice(0, 600)
  };
}
// 重要備註／特殊飲品及特殊餐：存產婦入住評估 profile（每媽媽一筆）
const MHO_PROFILE_FIELDS = ['handover_note', 'sp_shenghua', 'sp_redbean', 'sp_barley', 'sp_weaning'];

app.get('/api/mothers/:id/handovers', requireStaff, (req, res) => {
  const mother = db.prepare(`
    SELECT m.*,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name
    FROM mothers m WHERE m.id = ?`).get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const rows = db.prepare(`
    SELECT h.*, u.name AS nurse_name, e.name AS edited_by_name
    FROM mother_handovers h
    LEFT JOIN users u ON u.id = h.nurse_id
    LEFT JOIN users e ON e.id = h.edited_by
    WHERE h.mother_id = ? ORDER BY h.handover_date DESC, h.handover_time DESC, h.id DESC LIMIT 200`).all(mother.id);

  // 產婦入住評估 profile：重要備註/特殊餐/藥物過敏/胎次（未填→前端顯示紅字提醒）
  const mia = intakeForMother(mother.id);
  let miaData = null;
  if (mia) { try { miaData = JSON.parse(mia.data); } catch (e) { miaData = {}; } }

  // 表頭彙整：第一位寶寶（生產醫院/出生日期/週數/奶品/胎次 fallback）
  const baby = db.prepare('SELECT * FROM babies WHERE mother_id = ? ORDER BY id LIMIT 1').get(mother.id);
  let birthPlace = '', gestWeeks = '', parityBfa = '', milkBrand = '';
  if (baby) {
    const prof = db.prepare('SELECT data FROM baby_case_profiles WHERE baby_id = ?').get(baby.id);
    if (prof) { try { birthPlace = JSON.parse(prof.data).birth_place || ''; } catch (e) { /* */ } }
    const bdv = db.prepare(`SELECT data FROM baby_doctor_visits
      WHERE baby_id = ? ORDER BY visit_date DESC, visit_time DESC, id DESC LIMIT 1`).get(baby.id);
    if (bdv) { try { gestWeeks = JSON.parse(bdv.data).gest_weeks || ''; } catch (e) { /* */ } }
    const bfa = db.prepare(`SELECT parity, milk_brand FROM breastfeeding_assessments
      WHERE baby_id = ? ORDER BY assess_date DESC, id DESC LIMIT 1`).get(baby.id);
    if (bfa) { parityBfa = bfa.parity || ''; milkBrand = bfa.milk_brand || ''; }
  }

  // 宮底高度/惡露：最近一筆媽媽護理評估 vs 交班單，取日期時間較新者
  const mna = db.prepare(`SELECT assess_date, assess_time, data FROM mother_nursing_assessments
    WHERE mother_id = ? ORDER BY assess_date DESC, assess_time DESC, id DESC LIMIT 1`).get(mother.id);
  let mnaData = {};
  if (mna) { try { mnaData = JSON.parse(mna.data); } catch (e) { mnaData = {}; } }
  const hoLatest = rows.find(r => r.fundus || r.lochia);
  const mnaAt = mna ? `${mna.assess_date} ${mna.assess_time}` : '';
  const hoAt = hoLatest ? `${hoLatest.handover_date} ${hoLatest.handover_time}` : '';
  const useHo = hoLatest && (!mna || hoAt >= mnaAt);
  const fundusNow = useHo ? { value: hoLatest.fundus, at: hoLatest.handover_date }
    : (mna ? { value: [mnaData.uterus, mnaData.fundus_note].filter(Boolean).join('／'), at: mna.assess_date } : null);
  const lochiaNow = useHo ? { value: hoLatest.lochia, at: hoLatest.handover_date }
    : (mna ? { value: [mnaData.lochia_amount, mnaData.lochia_color].filter(Boolean).join('／'), at: mna.assess_date } : null);

  const header = {
    birth_place: birthPlace,
    baby_birth_date: baby ? baby.birth_date : '',
    gest_weeks: gestWeeks,
    parity: (miaData && miaData.parity) || parityBfa || '',
    milk_brand: milkBrand,
    allergy_drug: (miaData && miaData.allergy_drug) || '',
    postpartum_days: mother.delivery_date
      ? Math.max(0, Math.floor((new Date(today()) - new Date(mother.delivery_date)) / 86400000)) : null,
    fundus_now: fundusNow && fundusNow.value ? fundusNow : null,
    lochia_now: lochiaNow && lochiaNow.value ? lochiaNow : null,
    intake_filled: !!miaData,
    handover_note: (miaData && miaData.handover_note) || '',
    sp_shenghua: (miaData && miaData.sp_shenghua) || '',
    sp_redbean: (miaData && miaData.sp_redbean) || '',
    sp_barley: (miaData && miaData.sp_barley) || '',
    sp_weaning: (miaData && miaData.sp_weaning) || ''
  };
  res.json({ mother, rows, header });
});

// 飲食禁忌（mothers.diet_notes）＋重要備註/特殊飲品餐（入住評估 profile 合併）存檔
app.put('/api/mothers/:id/handover-profile', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const b = req.body || {};
  if (typeof b.diet_notes === 'string') {
    db.prepare('UPDATE mothers SET diet_notes = ? WHERE id = ?').run(b.diet_notes.slice(0, 500), mother.id);
  }
  if (MHO_PROFILE_FIELDS.some(k => b[k] !== undefined)) {
    const cur = intakeForMother(mother.id);
    let data = {};
    if (cur) { try { data = JSON.parse(cur.data); } catch (e) { data = {}; } }
    for (const k of MHO_PROFILE_FIELDS) if (b[k] !== undefined) data[k] = String(b[k]).slice(0, 500);
    const json = JSON.stringify(data).slice(0, 16000);
    const stayRoot = stayRootForMother(mother.id);
    if (cur) {
      db.prepare(`UPDATE mother_intake_assessments SET data=?, booking_id=?, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(json, stayRoot, cur.id);
    } else {
      db.prepare('INSERT INTO mother_intake_assessments (mother_id, booking_id, nurse_id, data) VALUES (?,?,?,?)')
        .run(mother.id, stayRoot, req.session.user.id, json);
    }
  }
  logAudit(req, { action: 'update', entity: 'mother_handover_profile', entity_id: mother.id, summary: '產婦交班單備註/飲食/特殊餐' });
  res.json({ ok: true });
});

app.post('/api/mothers/:id/handovers', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const b = req.body || {};
  if (!/^\d{2}:\d{2}/.test(b.handover_time || '')) return res.status(400).json({ error: '請填寫交班時間' });
  const v = normalizeMotherHandover(b);
  const info = db.prepare(`INSERT INTO mother_handovers
    (mother_id, nurse_id, handover_date, handover_time, fundus, lochia, note)
    VALUES (?,?,?,?,?,?,?)`).run(
    mother.id, req.session.user.id, v.date, v.time, v.fundus, v.lochia, v.note);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/mother-handovers/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM mother_handovers WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到交班紀錄' });
  const b = req.body || {};
  if (!/^\d{2}:\d{2}/.test(b.handover_time || '')) return res.status(400).json({ error: '請填寫交班時間' });
  const v = normalizeMotherHandover(b);
  db.prepare(`UPDATE mother_handovers SET handover_date=?, handover_time=?, fundus=?, lochia=?, note=?,
    edited_at=datetime('now','localtime'), edited_by=? WHERE id=?`).run(
    v.date, v.time, v.fundus, v.lochia, v.note, req.session.user.id, cur.id);
  logAudit(req, { action: 'update', entity: 'mother_handovers', entity_id: cur.id, summary: '產婦交班單修改' });
  res.json({ ok: true });
});

app.delete('/api/mother-handovers/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM mother_handovers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 產婦結案 ----------
const MCL_REASONS = ['期滿結案', '提前退住', '轉院', '其他'];
const MCL_DEST = ['返家', '轉至醫療院所', '其他'];
const MCL_EDU = ['產後回診提醒', '惡露觀察', '傷口護理', '乳房護理與哺乳', '避孕與月經恢復',
  '情緒調適與憂鬱徵兆', '飲食與活動', '緊急就醫指徵'];
const MCL_FIELDS = ['reason', 'reason_other', 'destination', 'hospital', 'destination_other', 'educations', 'follow_up'];

app.get('/api/mothers/:id/closure', requireStaff, (req, res) => {
  const mother = db.prepare(`
    SELECT m.*,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS check_in,
      (SELECT bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS check_out
    FROM mothers m WHERE m.id = ?`).get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const closure = db.prepare(`
    SELECT c.*, u.name AS nurse_name, e.name AS edited_by_name FROM mother_closures c
    LEFT JOIN users u ON u.id = c.nurse_id
    LEFT JOIN users e ON e.id = c.edited_by WHERE c.mother_id = ? AND c.booking_id IN (?, 0)
    ORDER BY c.booking_id DESC LIMIT 1`).get(mother.id, stayRootForMother(mother.id));
  if (closure) { try { closure.data = JSON.parse(closure.data); } catch (e) { closure.data = {}; } }
  // 住期摘要：最近生命徵象／宮底惡露（媽媽護理評估）、最新 EPDS、未結案健康問題、指導單完成度
  const mna = db.prepare(`SELECT * FROM mother_nursing_assessments
    WHERE mother_id = ? ORDER BY assess_date DESC, assess_time DESC, id DESC LIMIT 1`).get(mother.id);
  let mnaData = {};
  if (mna) { try { mnaData = JSON.parse(mna.data); } catch (e) { mnaData = {}; } }
  const epds = db.prepare(`SELECT total, fill_date FROM mother_scales
    WHERE mother_id = ? AND kind = 'epds' ORDER BY fill_date DESC, id DESC LIMIT 1`).get(mother.id);
  const openProblems = db.prepare(`SELECT COUNT(*) c FROM mother_health_problems
    WHERE mother_id = ? AND (end_date IS NULL OR end_date = '')`).get(mother.id).c;
  const { reminders } = motherGuidanceData(mother);
  const summary = {
    vitals: mna ? { at: `${mna.assess_date} ${mna.assess_time}`, temperature: mna.temperature,
      pulse: mna.pulse, respiration: mna.respiration, systolic: mna.systolic, diastolic: mna.diastolic } : null,
    fundus_last: mna ? [mnaData.uterus, mnaData.fundus_note].filter(Boolean).join('／') : '',
    lochia_last: mna ? [mnaData.lochia_amount, mnaData.lochia_color].filter(Boolean).join('／') : '',
    epds: epds || null,
    open_problems: openProblems,
    guidance_done: reminders.filter(r => r.done_date).length,
    guidance_total: reminders.length
  };
  res.json({ mother, closure: closure || null, summary, options: {
    reasons: MCL_REASONS, destinations: MCL_DEST, educations: MCL_EDU
  } });
});

// 結案存檔（已結案則更新）
app.put('/api/mothers/:id/closure', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  // 未到退房日不可結案（入住中且預退日在今日之後者擋下）
  const inBk = db.prepare(`SELECT check_out FROM bookings WHERE mother_id = ? AND status = 'checked_in'
    ORDER BY check_in DESC LIMIT 1`).get(mother.id);
  if (inBk && today() < inBk.check_out) {
    return res.status(400).json({ error: `未到退房日（${inBk.check_out}），無法辦理產婦結案` });
  }
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.close_date || '') ? b.close_date : today();
  const time = /^\d{2}:\d{2}/.test(b.close_time || '') ? b.close_time.slice(0, 5) : '';
  if (!time) return res.status(400).json({ error: '請填寫結案時間' });
  if (!MCL_REASONS.includes(b.reason)) return res.status(400).json({ error: '請選擇結案原因' });
  if (!MCL_DEST.includes(b.destination)) return res.status(400).json({ error: '請選擇去向' });
  if (b.reason === '其他' && !String(b.reason_other || '').trim()) return res.status(400).json({ error: '結案原因選「其他」時，補述必填' });
  if (b.destination === '轉至醫療院所' && !String(b.hospital || '').trim()) return res.status(400).json({ error: '去向選「轉至醫療院所」時，院所名稱必填' });
  if (b.destination === '其他' && !String(b.destination_other || '').trim()) return res.status(400).json({ error: '去向選「其他」時，補述必填' });
  const data = {};
  for (const k of MCL_FIELDS) if (b[k] !== undefined) {
    data[k] = (typeof b[k] === 'string') ? b[k].slice(0, 200) : b[k];
  }
  data.educations = (Array.isArray(b.educations) ? b.educations : []).filter(x => MCL_EDU.includes(x));
  const note = String(b.note || '').slice(0, 600);
  const cur = closureForMother(mother.id);
  const json = JSON.stringify(data).slice(0, 8000);
  const stayRoot = stayRootForMother(mother.id);
  if (cur) {
    db.prepare(`UPDATE mother_closures SET close_date=?, close_time=?, data=?, note=?, booking_id=?,
      edited_at=datetime('now','localtime'), edited_by=? WHERE id=?`)
      .run(date, time, json, note, stayRoot, req.session.user.id, cur.id);
  } else {
    db.prepare(`INSERT INTO mother_closures (mother_id, booking_id, nurse_id, close_date, close_time, data, note)
      VALUES (?,?,?,?,?,?,?)`).run(mother.id, stayRoot, req.session.user.id, date, time, json, note);
  }
  // 產婦結案為護理端獨立作業：不動訂房／媽媽狀態、不建清潔任務、不推問卷。
  // 退房（訂房轉已退房、房間釋出、清潔任務、滿意度問卷）一律由住客管理「退房完成」負責，
  // 三者（退房完成／產婦結案／產後嬰兒結案）各自獨立完成，互不連動、互不阻擋。
  logAudit(req, { action: cur ? 'update' : 'create', entity: 'mother_closures', entity_id: mother.id, summary: '產婦結案' });
  res.json({ ok: true });
});

// 解除結案（管理員）：只解除結案紀錄，不動訂房／房況（退房與否由住客管理「退房完成」決定）
app.delete('/api/mother-closures/:motherId', requireAdmin, (req, res) => {
  // 僅解除當前住期的結案，不影響前一胎的歷史結案
  const cl = closureForMother(req.params.motherId);
  if (cl) db.prepare('DELETE FROM mother_closures WHERE id = ?').run(cl.id);
  logAudit(req, { action: 'delete', entity: 'mother_closures', entity_id: req.params.motherId, summary: '解除產婦結案' });
  res.json({ ok: true, restored: false });
});

// 退房完成（客服部）：確認退房手續完成後退房、房況轉空房，並自動建立清潔任務
app.post('/api/bookings/:id/checkout-complete', requireStaff, (req, res) => {
  const bk = db.prepare(`SELECT bk.*, r.name AS room_name, m.name AS mother_name
    FROM bookings bk JOIN rooms r ON r.id = bk.room_id JOIN mothers m ON m.id = bk.mother_id
    WHERE bk.id = ?`).get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  if (bk.status !== 'checked_in') return res.status(409).json({ error: '此訂房不是入住中，無法辦理退房' });
  const d = today();
  if (d < bk.check_out) {
    return res.status(400).json({ error: `未到退房日（${bk.check_out}），無法辦理退房完成` });
  }
  db.transaction(() => {
    db.prepare(`UPDATE bookings SET status = 'checked_out', actual_check_out = ? WHERE id = ?`).run(d, bk.id);
    db.prepare(`UPDATE mothers SET status = 'checked_out' WHERE id = ?`).run(bk.mother_id);
    db.prepare(`INSERT INTO housekeeping_logs (room_id, mother_id, task, scheduled_for, note, created_by)
      VALUES (?,?,?,?,?,?)`).run(bk.room_id, bk.mother_id, `${bk.room_name}房已出住`, d,
      '退房完成自動建立', req.session.user.id);
  })();
  pushCheckoutSurvey(bk.mother_id); // 退房時自動推滿意度問卷
  logAudit(req, { action: 'update', entity: 'bookings', entity_id: bk.id, summary: `退房完成（${bk.room_name} ${bk.mother_name}）` });
  res.json({ ok: true, task: `${bk.room_name}房已出住` });
});

// ---------- 產科醫師查房清單（在住媽媽工作清單；醫師評估欄留白供手寫） ----------
app.get('/api/physician-rounds', requireStaff, (req, res) => {
  const moms = db.prepare(`
    SELECT m.*, r.name AS room_name FROM bookings bk
    JOIN mothers m ON m.id = bk.mother_id
    JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status = 'checked_in' ORDER BY r.name`).all();
  const rows = moms.map(m => {
    // 胎次：入住評估表 → 母乳哺育評估
    const mia = intakeForMother(m.id);
    let parity = '';
    if (mia) { try { parity = JSON.parse(mia.data).parity || ''; } catch (e) { /* */ } }
    if (!parity) {
      const bfa = db.prepare(`SELECT a.parity FROM breastfeeding_assessments a
        JOIN babies b ON b.id = a.baby_id WHERE b.mother_id = ?
        ORDER BY a.assess_date DESC, a.id DESC LIMIT 1`).get(m.id);
      if (bfa) parity = bfa.parity || '';
    }
    const ppDays = m.delivery_date
      ? Math.max(0, Math.floor((new Date(today()) - new Date(m.delivery_date)) / 86400000)) : null;
    // 媽媽問題：未結案健康問題＋最近巡診主訴
    const problems = db.prepare(`SELECT item FROM mother_health_problems
      WHERE mother_id = ? AND (end_date IS NULL OR end_date = '') ORDER BY start_date DESC LIMIT 5`).all(m.id)
      .map(p => p.item);
    const mdv = db.prepare(`SELECT visit_date, data, note FROM mother_doctor_visits
      WHERE mother_id = ? ORDER BY visit_date DESC, visit_time DESC, id DESC LIMIT 1`).get(m.id);
    let mdvData = {};
    if (mdv) { try { mdvData = JSON.parse(mdv.data); } catch (e) { mdvData = {}; } }
    if (mdvData.complaint === '有' && mdvData.complaint_text) problems.push(`主訴：${mdvData.complaint_text}`);
    // 護理評估發現：最近一筆媽媽護理評估摘要
    const mna = db.prepare(`SELECT * FROM mother_nursing_assessments
      WHERE mother_id = ? ORDER BY assess_date DESC, assess_time DESC, id DESC LIMIT 1`).get(m.id);
    let nursing = '';
    if (mna) {
      let d = {};
      try { d = JSON.parse(mna.data); } catch (e) { d = {}; }
      nursing = [
        `${mna.assess_date} ${mna.temperature}°C ${mna.systolic}/${mna.diastolic}`,
        d.uterus ? `宮縮:${d.uterus}` : '', d.lochia_amount ? `惡露:${d.lochia_amount}/${d.lochia_color || ''}` : '',
        d.wound && d.wound !== '平整' ? `傷口:${d.wound}` : '',
        d.breast_l_mastitis === '有' || d.breast_r_mastitis === '有' ? '⚠乳腺炎' : ''
      ].filter(Boolean).join('　');
    }
    // 醫師評估記錄：最近巡診（無則留白供手寫）
    const doctor = mdv ? [`${mdv.visit_date}`, mdvData.mood || '', (mdv.note || '').slice(0, 60)].filter(Boolean).join('　') : '';
    return {
      room_name: m.room_name, name: m.name, parity,
      delivery_type: m.delivery_type || '', postpartum_days: ppDays,
      problems: problems.join('；'), nursing_findings: nursing, doctor_note: doctor
    };
  });
  if (req.query.format === 'xlsx') {
    const buf = buildWorkbook('產科醫師查房清單', [
      { key: 'room_name', label: '房號' }, { key: 'name', label: '姓名' },
      { key: 'parity', label: '胎次' }, { key: 'delivery_type', label: '生產方式' },
      { key: 'postpartum_days', label: '生產天數' }, { key: 'problems', label: '媽媽問題' },
      { key: 'nursing_findings', label: '護理評估發現' }, { key: 'doctor_note', label: '醫師評估記錄' }
    ], rows);
    const fname = encodeURIComponent(`產科醫師查房清單-${today()}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="physician-rounds-${today()}.xlsx"; filename*=UTF-8''${fname}`);
    return res.send(buf);
  }
  res.json({ date: today(), center_name: getSettings().center_name || '', rows });
});

// ---------- 寶寶報喜（依生產日查詢新生寶寶與預計入住） ----------
app.get('/api/baby-announcements', requireStaff, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : today();
  const rows = db.prepare(`
    SELECT b.id, b.name AS baby_name, b.gender, b.birth_date, b.birth_weight_g,
      m.id AS mother_id, m.name AS mother_name, m.delivery_type,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS mother_check_in,
      (SELECT COALESCE(NULLIF(bk.baby_check_in,''), bk.check_in) FROM bookings bk
        WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS baby_check_in,
      (SELECT r.value_num FROM baby_records r WHERE r.baby_id = b.id AND r.record_type = 'jaundice'
        AND r.value_num IS NOT NULL ORDER BY r.recorded_at DESC LIMIT 1) AS jaundice
    FROM babies b JOIN mothers m ON m.id = b.mother_id
    WHERE b.birth_date = ? ORDER BY m.name`).all(date);
  res.json({ date, rows });
});

// ---------- 病歷資料（依媽媽姓名查歷史住客；點選再取護理紀錄） ----------
app.get('/api/medical-records', requireStaff, (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: '請輸入媽媽姓名' });
  const rows = db.prepare(`
    SELECT m.id, m.name, m.phone, m.delivery_type, m.delivery_date, m.status,
      (SELECT bk.check_in || ' ~ ' || bk.check_out FROM bookings bk WHERE bk.mother_id = m.id
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS stay_range,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id WHERE bk.mother_id = m.id
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT GROUP_CONCAT(CASE b.gender WHEN 'male' THEN '男' WHEN 'female' THEN '女' ELSE '未填' END, '、')
        FROM babies b WHERE b.mother_id = m.id) AS baby_genders
    FROM mothers m WHERE m.name LIKE ? ORDER BY m.id DESC LIMIT 50`).all(`%${name}%`);
  res.json({ rows });
});

// ---------- 產後嬰兒結案 ----------
const BCL_REASONS = ['期滿結案', '提前退住', '轉院', '其他'];
const BCL_DEST = ['返家', '轉至醫療院所', '其他'];
const BCL_CORD = ['已脫落', '未脫落－乾燥', '未脫落－潮濕', '其他'];
const BCL_FEEDING = ['純母乳', '混合哺餵', '配方奶'];
const BCL_EDU = ['沐浴衛教', '臍帶護理', '餵奶技巧', '預防注射時程', '黃疸觀察', '安全睡眠', '大小便觀察', '體溫量測'];
const BCL_FIELDS = [
  'reason', 'reason_other', 'destination', 'hospital', 'destination_other',
  'weight_g', 'jaundice', 'cord', 'cord_other', 'feeding', 'educations', 'follow_up'
];

app.get('/api/babies/:id/closure', requireStaff, (req, res) => {
  const baby = db.prepare(`
    SELECT b.*, m.name AS mother_name, m.status AS mother_status,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS mother_check_out
    FROM babies b JOIN mothers m ON m.id = b.mother_id WHERE b.id = ?`).get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  const closure = db.prepare(`
    SELECT c.*, u.name AS nurse_name, e.name AS edited_by_name FROM baby_closures c
    LEFT JOIN users u ON u.id = c.nurse_id
    LEFT JOIN users e ON e.id = c.edited_by WHERE c.baby_id = ?`).get(baby.id);
  if (closure) { try { closure.data = JSON.parse(closure.data); } catch (e) { closure.data = {}; } }
  // 住期摘要：入住日（評估單個案資料 → 訂房寶寶入住日）、最新體重／黃疸（照護紀錄 vs 交班單取較新）、疫苗
  const prof = db.prepare('SELECT data FROM baby_case_profiles WHERE baby_id = ?').get(baby.id);
  let profData = {};
  if (prof) { try { profData = JSON.parse(prof.data); } catch (e) { profData = {}; } }
  const bk = db.prepare(`SELECT baby_check_in FROM bookings WHERE mother_id = ? AND status = 'checked_in'
    ORDER BY check_in DESC LIMIT 1`).get(baby.mother_id);
  const lastRec = type => db.prepare(`SELECT value_num, recorded_at FROM baby_records
    WHERE baby_id = ? AND record_type = ? AND value_num IS NOT NULL ORDER BY recorded_at DESC LIMIT 1`).get(baby.id, type);
  const hoW = db.prepare(`SELECT weight_g, handover_date FROM baby_handovers
    WHERE baby_id = ? AND weight_g IS NOT NULL ORDER BY handover_date DESC, handover_time DESC LIMIT 1`).get(baby.id);
  const hoJ = db.prepare(`SELECT jaundice, handover_date FROM baby_handovers
    WHERE baby_id = ? AND jaundice IS NOT NULL ORDER BY handover_date DESC, handover_time DESC LIMIT 1`).get(baby.id);
  const pick = (rec, ho, field) => {
    if (rec && (!ho || rec.recorded_at.slice(0, 10) >= ho.handover_date)) return { value: rec.value_num, at: rec.recorded_at.slice(0, 10) };
    if (ho) return { value: ho[field], at: ho.handover_date };
    return null;
  };
  const vacc = kind => (db.prepare(`SELECT administered_at FROM vaccinations
    WHERE baby_id = ? AND vaccine = ? AND status = 'done' AND administered_at != ''
    ORDER BY administered_at DESC LIMIT 1`).get(baby.id, kind) || {}).administered_at || '';
  const lastNursing = db.prepare(`SELECT data FROM baby_nursing_assessments
    WHERE baby_id = ? ORDER BY assess_date DESC, assess_time DESC, id DESC LIMIT 1`).get(baby.id);
  let lastCord = '';
  if (lastNursing) { try { lastCord = JSON.parse(lastNursing.data).cord || ''; } catch (e) { /* */ } }
  const summary = {
    checkin_date: profData.checkin_date || (bk && bk.baby_check_in) || '',
    weight_now: pick(lastRec('weight'), hoW, 'weight_g'),
    jaundice_now: pick(lastRec('jaundice'), hoJ, 'jaundice'),
    cord_last: lastCord,
    bcg_date: vacc('bcg'), hbv_date: vacc('hepb') || profData.hbv_date || '',
    hbig_date: vacc('hepb_immunoglobulin') || profData.hbig_date || ''
  };
  res.json({ baby, closure: closure || null, summary, options: {
    reasons: BCL_REASONS, destinations: BCL_DEST, cords: BCL_CORD, feedings: BCL_FEEDING, educations: BCL_EDU
  } });
});

// 結案存檔（已結案則更新）
app.put('/api/babies/:id/closure', requireStaff, (req, res) => {
  const baby = db.prepare('SELECT id, mother_id FROM babies WHERE id = ?').get(req.params.id);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  // 未到退房日不可結案（媽媽入住中且預退日在今日之後者擋下）
  const inBk = db.prepare(`SELECT check_out FROM bookings WHERE mother_id = ? AND status = 'checked_in'
    ORDER BY check_in DESC LIMIT 1`).get(baby.mother_id);
  if (inBk && today() < inBk.check_out) {
    return res.status(400).json({ error: `未到退房日（${inBk.check_out}），無法辦理嬰兒結案` });
  }
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.close_date || '') ? b.close_date : today();
  const time = /^\d{2}:\d{2}/.test(b.close_time || '') ? b.close_time.slice(0, 5) : '';
  if (!time) return res.status(400).json({ error: '請填寫結案時間' });
  if (!BCL_REASONS.includes(b.reason)) return res.status(400).json({ error: '請選擇結案原因' });
  if (!BCL_DEST.includes(b.destination)) return res.status(400).json({ error: '請選擇去向' });
  if (b.reason === '其他' && !String(b.reason_other || '').trim()) return res.status(400).json({ error: '結案原因選「其他」時，補述必填' });
  if (b.destination === '轉至醫療院所' && !String(b.hospital || '').trim()) return res.status(400).json({ error: '去向選「轉至醫療院所」時，院所名稱必填' });
  if (b.destination === '其他' && !String(b.destination_other || '').trim()) return res.status(400).json({ error: '去向選「其他」時，補述必填' });
  const num = (v, max) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return (n > 0 && n <= max) ? n : NaN;
  };
  const weight = num(b.weight_g, 99999.9), jaundice = num(b.jaundice, 99.9);
  if (Number.isNaN(weight)) return res.status(400).json({ error: '結案體重需為 0～99999.9（gm）' });
  if (Number.isNaN(jaundice)) return res.status(400).json({ error: '黃疸值需為 0～99.9（mg/dl）' });
  const data = {};
  for (const k of BCL_FIELDS) if (b[k] !== undefined) {
    data[k] = (typeof b[k] === 'string') ? b[k].slice(0, 200) : b[k];
  }
  data.weight_g = weight;
  data.jaundice = jaundice;
  data.educations = (Array.isArray(b.educations) ? b.educations : []).filter(x => BCL_EDU.includes(x));
  const note = String(b.note || '').slice(0, 600);
  const cur = db.prepare('SELECT id FROM baby_closures WHERE baby_id = ?').get(baby.id);
  const json = JSON.stringify(data).slice(0, 8000);
  if (cur) {
    db.prepare(`UPDATE baby_closures SET close_date=?, close_time=?, data=?, note=?,
      edited_at=datetime('now','localtime'), edited_by=? WHERE baby_id=?`)
      .run(date, time, json, note, req.session.user.id, baby.id);
  } else {
    db.prepare(`INSERT INTO baby_closures (baby_id, nurse_id, close_date, close_time, data, note)
      VALUES (?,?,?,?,?,?)`).run(baby.id, req.session.user.id, date, time, json, note);
  }
  logAudit(req, { action: cur ? 'update' : 'create', entity: 'baby_closures', entity_id: baby.id, summary: '產後嬰兒結案' });
  res.json({ ok: true });
});

// 解除結案（管理員）
app.delete('/api/baby-closures/:babyId', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM baby_closures WHERE baby_id = ?').run(req.params.babyId);
  logAudit(req, { action: 'delete', entity: 'baby_closures', entity_id: req.params.babyId, summary: '解除產後嬰兒結案' });
  res.json({ ok: true });
});

// ---------- 媽媽護理（中衛日常評估欄位） ----------
// data 僅收白名單欄位
const MNA_FIELDS = [
  'pain_nrs', 'bowel_count',
  'uterus', 'fundus_note',
  'lochia_amount', 'lochia_color', 'lochia_clot', 'clot_note',
  'wound', 'wound_exudate_amount', 'wound_exudate_color',
  'breast_l', 'breast_l_milk', 'breast_l_mastitis',
  'breast_r', 'breast_r_milk', 'breast_r_mastitis',
  'bf_skill', 'mental', 'activity', 'nurse_id_no',
  'diet', 'urination', 'sleep', 'education', 'note'   // 非必填欄位（報表用）
];
// 媽媽病歷號：沿用會員編號（M+5 碼，建檔時已產生）
const motherMedicalNo = m => m.member_no || ('M' + String(m.id).padStart(5, '0'));
// 護理指導單提醒排程：入住第 1／3／7／10 天
const GUIDANCE_DAYS = [1, 3, 7, 10];
// 指導紀錄＋提醒配對（媽媽護理頁與護理指導頁共用；mother 需含 check_in）
function motherGuidanceData(mother) {
  const guidance = db.prepare(`SELECT g.*, u.name AS nurse_name FROM mother_guidance_logs g
    LEFT JOIN users u ON u.id = g.nurse_id WHERE g.mother_id = ? AND g.booking_id IN (?, 0)
    ORDER BY g.done_date, g.id`).all(mother.id, stayRootForMother(mother.id));
  let reminders = [];
  if (mother.check_in) {
    const used = new Set();
    reminders = GUIDANCE_DAYS.map(day => {
      const remind = new Date(new Date(mother.check_in).getTime() + (day - 1) * 86400000).toISOString().slice(0, 10);
      const log = guidance.find(g => !used.has(g.id) && g.done_date >= remind);
      if (log) used.add(log.id);
      return { remind_date: remind, day_label: `入住 第${day}天`,
        done_date: log ? log.done_date : '', done_by: log ? (log.nurse_name || '') : '', kind: log ? log.kind : '' };
    });
  }
  return { guidance, reminders };
}

app.get('/api/mothers/:id/nursing', requireStaff, (req, res) => {
  const mother = db.prepare(`
    SELECT m.*,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS check_in,
      (SELECT bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS check_out
    FROM mothers m WHERE m.id = ?`).get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const rows = db.prepare(`
    SELECT a.*, u.name AS nurse_name FROM mother_nursing_assessments a
    LEFT JOIN users u ON u.id = a.nurse_id
    WHERE a.mother_id = ? ORDER BY a.assess_date DESC, a.assess_time DESC, a.id DESC LIMIT 200`).all(mother.id);
  for (const r of rows) { try { r.data = JSON.parse(r.data); } catch (e) { r.data = {}; } }
  const problems = db.prepare(`SELECT p.*, u.name AS nurse_name FROM mother_health_problems p
    LEFT JOIN users u ON u.id = p.nurse_id WHERE p.mother_id = ? ORDER BY p.start_date DESC, p.id DESC`).all(mother.id);
  const scales = db.prepare(`SELECT s.*, u.name AS nurse_name FROM mother_scales s
    LEFT JOIN users u ON u.id = s.nurse_id WHERE s.mother_id = ? ORDER BY s.fill_date DESC, s.id DESC LIMIT 100`).all(mother.id);
  for (const s of scales) { try { s.answers = JSON.parse(s.answers); } catch (e) { s.answers = []; } }
  const { guidance, reminders } = motherGuidanceData(mother);
  const todayPhoto = db.prepare(`SELECT * FROM mother_breast_photos
    WHERE mother_id = ? AND taken_date = ? ORDER BY id DESC LIMIT 1`).get(mother.id, today());
  // 寶寶基本資料（母乳認知與支持評估表頭）：性別/出生/體重＋週數（醫師巡診）＋生產醫院（寶寶評估單）＋胎次（母乳哺育評估）
  const baby = db.prepare('SELECT * FROM babies WHERE mother_id = ? ORDER BY id LIMIT 1').get(mother.id);
  let babyInfo = null;
  if (baby) {
    const bdv = db.prepare(`SELECT data FROM baby_doctor_visits WHERE baby_id = ?
      ORDER BY visit_date DESC, visit_time DESC, id DESC LIMIT 1`).get(baby.id);
    const prof = db.prepare('SELECT data FROM baby_case_profiles WHERE baby_id = ?').get(baby.id);
    const bfa = db.prepare(`SELECT parity FROM breastfeeding_assessments WHERE baby_id = ?
      ORDER BY assess_date DESC, id DESC LIMIT 1`).get(baby.id);
    let gestWeeks = '', birthPlace = '';
    try { gestWeeks = JSON.parse((bdv || {}).data || '{}').gest_weeks || ''; } catch (e) { /* */ }
    try { birthPlace = JSON.parse((prof || {}).data || '{}').birth_place || ''; } catch (e) { /* */ }
    babyInfo = {
      gender: baby.gender, birth_date: baby.birth_date, birth_weight_g: baby.birth_weight_g,
      gest_weeks: gestWeeks, birth_place: birthPlace, parity: bfa ? bfa.parity : ''
    };
  }
  res.json({ mother, medical_no: motherMedicalNo(mother), rows, problems, scales, guidance, reminders,
    today_photo: todayPhoto || null, baby_info: babyInfo,
    babies: db.prepare('SELECT id, name FROM babies WHERE mother_id = ? ORDER BY id').all(mother.id) });
});

app.post('/api/mothers/:id/nursing', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.assess_date || '') ? b.assess_date : today();
  const time = /^\d{2}:\d{2}/.test(b.assess_time || '') ? b.assess_time.slice(0, 5) : '';
  if (!time) return res.status(400).json({ error: '請填寫紀錄時間' });
  const num = (v, max, label) => {
    const n = Number(v);
    if (!(n > 0 && n <= max)) throw new Error(`${label}需為 0～${max}`);
    return n;
  };
  let temp, pulse, resp, sys, dia;
  try {
    temp = num(b.temperature, 99.9, '體溫');
    pulse = num(b.pulse, 999, '脈搏');
    resp = num(b.respiration, 999, '呼吸');
    sys = num(b.systolic, 999, '收縮壓');
    dia = num(b.diastolic, 999, '舒張壓');
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const data = {};
  for (const k of MNA_FIELDS) if (b[k] !== undefined) {
    data[k] = (typeof b[k] === 'string') ? b[k].slice(0, 300) : b[k];
  }
  const info = db.prepare(`INSERT INTO mother_nursing_assessments
    (mother_id, nurse_id, assess_date, assess_time, temperature, pulse, respiration, systolic, diastolic, data)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    mother.id, req.session.user.id, date, time, temp, pulse, resp, sys, dia,
    JSON.stringify(data).slice(0, 8000));
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/mother-nursing/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM mother_nursing_assessments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 護理指導：獨立頁讀取（提醒排程＋執行紀錄）
app.get('/api/mothers/:id/guidance', requireStaff, (req, res) => {
  const mother = db.prepare(`
    SELECT m.*,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS check_in,
      (SELECT bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS check_out
    FROM mothers m WHERE m.id = ?`).get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const { guidance, reminders } = motherGuidanceData(mother);
  res.json({ mother, guidance, reminders });
});

// 護理指導單執行（產婦護理／母乳哺育）
app.post('/api/mothers/:id/guidance', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const b = req.body || {};
  if (!['care', 'breastfeeding'].includes(b.kind)) return res.status(400).json({ error: '指導單類別錯誤' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.done_date || '') ? b.done_date : today();
  const info = db.prepare(`INSERT INTO mother_guidance_logs (mother_id, booking_id, nurse_id, kind, done_date, note)
    VALUES (?,?,?,?,?,?)`).run(mother.id, stayRootForMother(mother.id), req.session.user.id, b.kind, date, String(b.note || '').slice(0, 300));
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/mother-guidance/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM mother_guidance_logs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 量表評估（apgar 家庭功能 5 題 0~2 分；epds 愛丁堡憂鬱 10 題 0~3 分＋年齡/判定；bf_awareness 母乳認知與支持完整問卷）
// bf_awareness 問卷白名單欄位（基本資料／認知／經驗／支持系統）
const BFAW_FIELDS = [
  'language', 'ob_history', 'breast_surgery', 'pain_relief', 'discharge_feeding',
  'src', 'method', 'method_other', 'benefits', 'this_feed',
  'prev_feed', 'prev_feed_time', 'r_staff', 'r_staff_other', 'r_mom', 'r_mom_other',
  'r_baby', 'r_baby_other', 'r_social', 'prev_rooming', 'prev_rooming_reason',
  'cohab', 'cohab_other', 'family_help', 'family_view', 'family_view_reason',
  'helpers', 'consult', 'consult_title', 'helpless'
];
app.post('/api/mothers/:id/scales', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const b = req.body || {};
  if (!['apgar', 'epds', 'bf_awareness'].includes(b.kind)) return res.status(400).json({ error: '量表類別錯誤' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.fill_date || '') ? b.fill_date : today();
  let total = null, stored;
  if (b.kind === 'apgar') {
    const answers = Array.isArray(b.answers) ? b.answers : [];
    if (answers.length !== 5 || answers.some(a => ![0, 1, 2].includes(a))) {
      return res.status(400).json({ error: '家庭功能評估需回答 5 題（每題 0～2 分）' });
    }
    total = answers.reduce((s, a) => s + a, 0);
    stored = answers;
  } else if (b.kind === 'epds') {
    // answers 為 10 題分數陣列；另存年齡與判定結果（正常／再觀察／建議進一步評估）
    const arr = Array.isArray(b.answers) ? b.answers : ((b.answers || {}).a || []);
    if (arr.length !== 10 || arr.some(a => ![0, 1, 2, 3].includes(a))) {
      return res.status(400).json({ error: '愛丁堡憂鬱量表需回答 10 題（每題 0～3 分）' });
    }
    total = arr.reduce((s, a) => s + a, 0);
    stored = { a: arr, age: String(b.age || '').slice(0, 10), result: String(b.result || '').slice(0, 50) };
  } else {
    // 母乳認知與支持：完整問卷物件，僅收白名單欄位（陣列＝多選、字串＝單選/文字）
    const src = (b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers)) ? b.answers : {};
    stored = {};
    for (const k of BFAW_FIELDS) {
      if (src[k] === undefined) continue;
      stored[k] = Array.isArray(src[k]) ? src[k].map(x => String(x).slice(0, 100)).slice(0, 30) : String(src[k]).slice(0, 200);
    }
  }
  const info = db.prepare(`INSERT INTO mother_scales (mother_id, nurse_id, kind, fill_date, answers, total, note)
    VALUES (?,?,?,?,?,?,?)`).run(mother.id, req.session.user.id, b.kind, date,
    JSON.stringify(stored).slice(0, 6000), total, String(b.note || '').slice(0, 300));
  res.json({ id: info.lastInsertRowid, total });
});
app.delete('/api/mother-scales/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM mother_scales WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 健康問題列表
app.post('/api/mothers/:id/health-problems', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const b = req.body || {};
  if (!String(b.item || '').trim()) return res.status(400).json({ error: '問題項目必填' });
  const start = /^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '') ? b.start_date : today();
  const info = db.prepare(`INSERT INTO mother_health_problems (mother_id, nurse_id, item, start_date, end_date)
    VALUES (?,?,?,?,?)`).run(mother.id, req.session.user.id,
    String(b.item).trim().slice(0, 200), start,
    /^\d{4}-\d{2}-\d{2}$/.test(b.end_date || '') ? b.end_date : '');
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/mother-health-problems/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM mother_health_problems WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到健康問題' });
  const b = req.body || {};
  db.prepare('UPDATE mother_health_problems SET item = ?, start_date = ?, end_date = ? WHERE id = ?').run(
    String(b.item ?? cur.item).trim().slice(0, 200),
    /^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '') ? b.start_date : cur.start_date,
    b.end_date === '' ? '' : (/^\d{4}-\d{2}-\d{2}$/.test(b.end_date || '') ? b.end_date : cur.end_date),
    cur.id);
  res.json({ ok: true });
});
app.delete('/api/mother-health-problems/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM mother_health_problems WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 產婦入住護理評估表（中衛必要欄位＋中衛入住評估欄位） ----------
// data 僅收白名單欄位（陣列＝多選、其餘存字串）
const MIA_FIELDS = [
  // 中衛必要欄位
  'id_no', 'companion_name', 'companion_phone', 'companion_relation',
  'county', 'district', 'address', 'tel',
  'education', 'education_other', 'languages', 'language_other', 'marital',
  'gravidity', 'parity', 'abortus', 'delivery_modes', 'delivery_other',
  'high_risk', 'high_risk_other', 'occupation',
  'allergy_cat', 'allergy_food', 'allergy_drug',
  'alcohol', 'alcohol_other', 'smoking', 'smoking_other',
  'past_history', 'past_history_other',
  'rpr', 'hiv', 'varicella', 'hbsag', 'hbeag',
  'medication', 'medication_detail', 'travel', 'travel_note', 'fever_hx', 'fever_note',
  'contact_flag', 'contact_items', 'contact_other',
  'infection_flag', 'infection_items',
  'special_flag', 'special_items', 'special_other', 'recorder_id_no',
  // 中衛入住評估欄位
  'height', 'weight', 'temperature', 'respiration', 'bp',
  'ear_l', 'ear_l_other', 'ear_r', 'ear_r_other',
  'nose', 'nose_other', 'mouth', 'mouth_other', 'neck', 'neck_other', 'vision', 'vision_note',
  'consciousness', 'skin', 'skin_items', 'skin_other_note', 'emotion', 'emotion_items',
  'attitude', 'resp_quality', 'pulse', 'resp_pattern', 'resp_pattern_other',
  'heart_rate', 'heart_rate_other', 'limb_temp', 'limb_color',
  'abdomen', 'abdomen_other', 'upper_limb', 'upper_limb_other', 'lower_limb', 'lower_limb_other',
  'urination', 'urination_note', 'bowel', 'bowel_note', 'uterus', 'fundus_note',
  'lochia_amount', 'lochia_nature', 'clot', 'clot_note',
  'wound', 'wound_exu_amount', 'wound_exu_color', 'activity',
  'needs', 'needs_other', 'breast_l', 'breast_l_other', 'breast_r', 'breast_r_other',
  'breast_lump', 'lump_note', 'nipple_len', 'nipple_len_other', 'nipple_size', 'nipple_size_other',
  'bf_exp', 'bf_prev_duration', 'bf_stop_reasons', 'bf_stop_other',
  'bf_intent', 'bf_no_reason', 'bf_planned_time', 'bf_planned_other',
  'family_support', 'pain', 'pain_score', 'pain_site', 'pain_nature', 'pain_time', 'pain_note',
  'report_note'
];

app.get('/api/mothers/:id/intake', requireStaff, (req, res) => {
  const mother = db.prepare(`
    SELECT m.*,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('checked_in','reserved')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in'
        ORDER BY bk.check_in DESC LIMIT 1) AS check_in
    FROM mothers m WHERE m.id = ?`).get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const rec = db.prepare(`
    SELECT a.*, u.name AS nurse_name FROM mother_intake_assessments a
    LEFT JOIN users u ON u.id = a.nurse_id WHERE a.mother_id = ? AND a.booking_id IN (?, 0)
    ORDER BY a.booking_id DESC LIMIT 1`).get(mother.id, stayRootForMother(mother.id));
  if (rec) { try { rec.data = JSON.parse(rec.data); } catch (e) { rec.data = {}; } }
  // 量表填寫概況（供入住評估表以顏色標示：家庭功能 apgar／愛丁堡 epds）
  const scaleRows = db.prepare(`SELECT kind, COUNT(*) c, MAX(fill_date) last FROM mother_scales WHERE mother_id = ? GROUP BY kind`).all(mother.id);
  const scales = {};
  for (const s of scaleRows) scales[s.kind] = { count: s.c, last: s.last };
  res.json({ mother, medical_no: motherMedicalNo(mother), record: rec || null, scales });
});

app.put('/api/mothers/:id/intake', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const b = req.body || {};
  // 數值範圍檢核（有填才驗）
  const numChecks = [
    ['height', 999.9, '身高需為 0～999.9（cm）'], ['weight', 999.9, '體重需為 0～999.9（kg）'],
    ['temperature', 99.9, '體溫需為 0～99.9（°C）'], ['respiration', 999, '呼吸需為 0～999（次/分）'],
    ['pulse', 999, '脈搏需為 0～999'], ['pain_score', 10, '疼痛分數需為 0～10']
  ];
  for (const [k, max, msg] of numChecks) {
    if (b[k] !== undefined && b[k] !== '') {
      const n = Number(b[k]);
      if (!(n >= 0 && n <= max)) return res.status(400).json({ error: msg });
    }
  }
  const cur = intakeForMother(mother.id);
  let data = {};
  if (cur) { try { data = JSON.parse(cur.data); } catch (e) { data = {}; } }
  for (const k of MIA_FIELDS) if (b[k] !== undefined) {
    data[k] = Array.isArray(b[k]) ? b[k].map(x => String(x).slice(0, 100)).slice(0, 30)
      : (typeof b[k] === 'string' ? b[k].slice(0, 500) : b[k]);
  }
  const json = JSON.stringify(data).slice(0, 16000);
  const stayRoot = stayRootForMother(mother.id);
  if (cur) {
    db.prepare(`UPDATE mother_intake_assessments SET nurse_id=?, data=?, booking_id=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(req.session.user.id, json, stayRoot, cur.id);
  } else {
    db.prepare('INSERT INTO mother_intake_assessments (mother_id, booking_id, nurse_id, data) VALUES (?,?,?,?)')
      .run(mother.id, stayRoot, req.session.user.id, json);
  }
  // 身分證號同步回住客資料（媽媽護理等中衛欄位共用）
  if (typeof b.id_no === 'string' && b.id_no.trim()) {
    db.prepare('UPDATE mothers SET id_no = ? WHERE id = ?').run(b.id_no.trim().slice(0, 10), mother.id);
  }
  logAudit(req, { action: cur ? 'update' : 'create', entity: 'mother_intake_assessments', entity_id: mother.id, summary: '產婦入住護理評估表' });
  res.json({ ok: true });
});

// 乳房圖示（每日照片）
app.post('/api/mothers/:id/breast-photos', requireStaff, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請選擇圖片檔案' });
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!mother) return res.status(404).json({ error: '找不到媽媽' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test((req.body || {}).taken_date || '') ? req.body.taken_date : today();
  const info = db.prepare(`INSERT INTO mother_breast_photos (mother_id, nurse_id, taken_date, photo_file, note)
    VALUES (?,?,?,?,?)`).run(mother.id, req.session.user.id, date, req.file.filename,
    String((req.body || {}).note || '').slice(0, 200));
  res.json({ id: info.lastInsertRowid, file: req.file.filename });
});
app.delete('/api/mother-breast-photos/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT photo_file FROM mother_breast_photos WHERE id = ?').get(req.params.id);
  if (cur) removeUploadFile(cur.photo_file);
  db.prepare('DELETE FROM mother_breast_photos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
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
  // 取某型別當日「最新」一筆的值（records 已依時間排序）
  const lastNum = type => { const rs = records.filter(r => r.record_type === type); return rs.length ? rs[rs.length - 1].value_num : null; };
  const lastText = type => { const rs = records.filter(r => r.record_type === type); return rs.length ? (rs[rs.length - 1].value_text || null) : null; };
  // 當日紅臀最嚴重程度（取輕→重排序最大者；無評估則為 null）
  const rashWorst = diapers.reduce((worst, r) => {
    const idx = DIAPER_RASH_LEVELS.indexOf(r.diaper_rash);
    return idx > worst ? idx : worst;
  }, -1);

  // 異常提醒：依設定門檻彙整當日異常（體溫／黃疸／紅臀／餵食間隔）
  const s = getSettings();
  const alerts = [];
  for (const t of temps) { const r = abnormalReason('temperature', t.value_num, s); if (r) alerts.push(r); }
  if (jaundices.length) { const r = abnormalReason('jaundice', jaundices[jaundices.length - 1].value_num, s); if (r) alerts.push(r); }
  if (rashWorst >= 2) alerts.push(`紅臀${DIAPER_RASH_LEVELS[rashWorst]}，需加強護理`);
  if (feedings.length >= 2) {
    const limit = Math.max(0.5, parseFloat(s.feed_interval_hours) || 3);
    let maxGap = 0;
    for (let i = 1; i < feedings.length; i++) {
      const gap = (new Date(feedings[i].recorded_at) - new Date(feedings[i - 1].recorded_at)) / 3600000;
      if (gap > maxGap) maxGap = gap;
    }
    if (maxGap > limit) alerts.push(`餵食間隔最長 ${maxGap.toFixed(1)} 小時（門檻 ${limit}）`);
  }

  return {
    baby, date, records, photos, alerts,
    summary: {
      feed_count: feedings.length,
      feed_total_ml: feedings.reduce((s, r) => s + (r.amount_ml || 0), 0),
      diaper_wet: diapers.filter(r => r.diaper_kind === '濕').length,
      diaper_stool: diapers.filter(r => r.diaper_kind === '便').length,
      rash_worst: rashWorst >= 0 ? DIAPER_RASH_LEVELS[rashWorst] : null,
      temp_latest: temps.length ? temps[temps.length - 1].value_num : null,
      weight_latest_g: weights.length ? weights[weights.length - 1].value_num : null,
      jaundice_latest: jaundices.length ? jaundices[jaundices.length - 1].value_num : null,
      bath_done: records.some(r => r.record_type === 'bath'),
      // 擴充：生命徵象與觀察（取當日最新一筆）
      respiration_latest: lastNum('respiration'),
      heart_rate_latest: lastNum('heart_rate'),
      spo2_latest: lastNum('spo2'),
      length_latest: lastNum('length'),
      head_circ_latest: lastNum('head_circ'),
      sleep_count: records.filter(r => r.record_type === 'sleep').length,
      skin_latest: lastText('skin'),
      cord_latest: lastText('cord'),
      vomit_latest: lastText('vomit'),
      activity_latest: lastText('activity'),
      stool_latest: lastText('stool')
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

// ---------- 每日自動推播：前一日寶寶日報＋成長趨勢（LINE 已綁定且在住的家屬） ----------
function trendsBrief(babyId) {
  try {
    const t = buildTrends(babyId);
    const parts = [];
    if (t.weight.length) {
      const last = t.weight[t.weight.length - 1];
      const prev = t.weight.length > 1 ? t.weight[t.weight.length - 2] : null;
      const diff = prev ? last.value - prev.value : null;
      parts.push(`體重 ${last.value} g${diff != null ? `（較前次 ${diff >= 0 ? '+' : ''}${diff} g）` : ''}`);
    }
    if (t.jaundice.length) parts.push(`黃疸 ${t.jaundice[t.jaundice.length - 1].value} mg/dL`);
    if (t.feeds.length) {
      const recent = t.feeds.slice(-7);
      const avg = Math.round(recent.reduce((s, x) => s + x.count, 0) / recent.length * 10) / 10;
      parts.push(`近${recent.length}日平均餵食 ${avg} 次/日`);
    }
    return parts.length ? `成長趨勢：${parts.join('、')}` : '';
  } catch (e) { return ''; }
}

async function runDailyFamilyPush() {
  const s = getSettings();
  const token = (s.line_channel_access_token || '').trim();
  if (!token) return;
  const base = (s.public_base_url || '').replace(/\/$/, '');
  const yesterday = new Date(Date.now() - 86400000).toLocaleString('sv-SE').slice(0, 10);
  const fams = db.prepare(`
    SELECT f.id, f.baby_id, f.line_user_id, f.access_code
    FROM family_members f
    JOIN babies b ON b.id = f.baby_id
    JOIN mothers m ON m.id = b.mother_id
    WHERE f.active = 1 AND f.line_user_id != '' AND m.status = 'checked_in'`).all();
  const byBaby = new Map();
  for (const f of fams) {
    if (!byBaby.has(f.baby_id)) byBaby.set(f.baby_id, []);
    byBaby.get(f.baby_id).push(f);
  }
  const insLog = db.prepare("INSERT INTO push_logs (baby_id, report_date, channel, sent_by) VALUES (?,?, 'line_auto', NULL)");
  for (const [babyId, members] of byBaby) {
    try {
      // 同一寶寶同一日僅自動發送一次（重啟／補跑不重複）
      if (db.prepare("SELECT 1 FROM push_logs WHERE baby_id = ? AND report_date = ? AND channel = 'line_auto'").get(babyId, yesterday)) continue;
      const report = buildDailyReport(babyId, yesterday);
      if (!report || !report.records.length) continue; // 前一日無照護紀錄則不發
      const brief = trendsBrief(babyId);
      let sent = 0;
      for (const f of members) {
        const text = [notify.reportText(report, s.center_name || ''), brief,
          base ? `家屬入口：${base}/family.html?code=${f.access_code}` : ''].filter(Boolean).join('\n');
        const r = await notify.pushText(token, f.line_user_id, text);
        if (r.ok) sent++;
      }
      if (sent) insLog.run(babyId, yesterday);
    } catch (e) { /* 單一寶寶失敗不影響其他 */ }
  }
}

// 每 30 秒檢查一次；到達設定時間（預設 10:00）即發送，重啟晚於該時間會自動補發（push_logs 防重複）
if (process.env.NODE_ENV !== 'test') {
  let lastFamilyPushDay = '';
  setInterval(() => {
    const t = (getSettings().family_daily_push_time || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return;
    const now = new Date();
    const day = now.toLocaleString('sv-SE').slice(0, 10);
    if (now.toTimeString().slice(0, 5) >= t && lastFamilyPushDay !== day) {
      lastFamilyPushDay = day;
      runDailyFamilyPush().catch(() => {});
    }
  }, 30 * 1000);
}

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
  // 補登紀錄：可指定發生時間（限現在之前）；未帶則以現在時間記錄
  let at = null;
  if (r.recorded_at !== undefined && String(r.recorded_at).trim()) {
    const v = String(r.recorded_at).trim();
    if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(v)) {
      return res.status(400).json({ error: '紀錄時間格式需為 YYYY-MM-DD 或 YYYY-MM-DD HH:MM' });
    }
    at = (v.length === 10 ? `${v} 00:00:00` : v.replace('T', ' ')).slice(0, 19);
    if (at.length === 16) at += ':00';
    const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
    if (at > nowLocal) return res.status(400).json({ error: '補登紀錄時間不可晚於現在' });
  }
  const info = at
    ? db.prepare(`INSERT INTO mother_records (mother_id, nurse_id, record_type, value_text, note, recorded_at)
        VALUES (?,?,?,?,?,?)`).run(req.params.id, req.session.user.id, r.record_type, r.value_text || '', r.note || '', at)
    : db.prepare(`INSERT INTO mother_records (mother_id, nurse_id, record_type, value_text, note)
        VALUES (?,?,?,?,?)`).run(req.params.id, req.session.user.id, r.record_type, r.value_text || '', r.note || '');
  res.json({ id: info.lastInsertRowid });
});

// 媽媽照護紀錄批次新增（一次評估多項）：單一交易原子性
app.post('/api/mothers/:id/records/batch', requireStaff, (req, res) => {
  const list = Array.isArray((req.body || {}).records) ? req.body.records : [];
  const valid = list.filter(r => r && r.record_type);
  if (!valid.length) return res.status(400).json({ error: '沒有可儲存的紀錄' });
  const ins = db.prepare('INSERT INTO mother_records (mother_id, nurse_id, record_type, value_text, note) VALUES (?,?,?,?,?)');
  const tx = db.transaction(() => {
    for (const r of valid) ins.run(req.params.id, req.session.user.id, r.record_type, r.value_text || '', r.note || '');
  });
  tx();
  res.json({ added: valid.length });
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
  // 托嬰室為非產婦房間：預設不列入一般選房（僅 include_daycare=1 時回傳，供排房「安排房型＝托嬰」與房間資料管理使用）
  const dcCond = req.query.include_daycare ? '' : " AND r.room_type != '托嬰'";
  const rows = db.prepare(`
    SELECT r.*,
      (SELECT m.name FROM bookings bk JOIN mothers m ON m.id = bk.mother_id
        WHERE bk.room_id = r.id AND bk.status = 'checked_in' LIMIT 1) AS occupant,
      (SELECT bk.check_out FROM bookings bk
        WHERE bk.room_id = r.id AND bk.status = 'checked_in' LIMIT 1) AS occupied_until
    FROM rooms r WHERE r.active = 1${dcCond} ORDER BY r.name`).all();
  res.json(rows);
});

app.post('/api/rooms', requireAdmin, (req, res) => {
  const r = req.body || {};
  if (!r.name) return res.status(400).json({ error: '房號必填' });
  try {
    const info = db.prepare(`INSERT INTO rooms (name, room_type, price_per_day, notes, call_ext, service_ext, sort)
      VALUES (?,?,?,?,?,?,?)`).run(r.name, r.room_type || '標準房', r.price_per_day || 0, r.notes || '',
      r.call_ext || '', r.service_ext || '', Number(r.sort) || 0);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: '房號重複' });
  }
});

app.put('/api/rooms/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到房間' });
  const r = req.body || {};
  try {
    db.prepare(`UPDATE rooms SET name=?, room_type=?, price_per_day=?, notes=?, call_ext=?, service_ext=?, sort=?, active=? WHERE id=?`)
      .run(String(r.name ?? cur.name).trim() || cur.name, r.room_type ?? cur.room_type,
        r.price_per_day !== undefined ? Number(r.price_per_day) || 0 : cur.price_per_day,
        r.notes ?? cur.notes, r.call_ext ?? cur.call_ext, r.service_ext ?? cur.service_ext,
        r.sort !== undefined ? Number(r.sort) || 0 : cur.sort,
        r.active !== undefined ? (r.active ? 1 : 0) : cur.active, cur.id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: '房號重複' }); }
});

app.post('/api/rooms/batch', requireAdmin, (req, res) => {
  const b = req.body || {};
  const list = Array.isArray(b.rooms) ? b.rooms : [];
  if (!list.length) return res.status(400).json({ error: '請提供房號清單' });
  const ins = db.prepare(`INSERT OR IGNORE INTO rooms (name, room_type, price_per_day, call_ext, service_ext, sort)
    VALUES (?,?,?,?,?,?)`);
  let added = 0;
  const tx = db.transaction(() => {
    for (const r of list) {
      const name = String(r.name || '').trim();
      if (!name) continue;
      const info = ins.run(name, r.room_type || '標準房', Number(r.price_per_day) || 0,
        r.call_ext || name, r.service_ext || name, Number(r.sort) || 0);
      if (info.changes) added++;
    }
  });
  tx();
  res.json({ added });
});

// ---------- 房間資料管理：房型設定 ----------
app.get('/api/room-types', requireStaff, (req, res) => {
  res.json(db.prepare('SELECT * FROM room_types ORDER BY sort, id').all());
});
app.post('/api/room-types', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return res.status(400).json({ error: '請填寫房型名稱' });
  try {
    const info = db.prepare('INSERT INTO room_types (name, price, sort) VALUES (?,?,?)')
      .run(String(b.name).trim().slice(0, 50), Number(b.price) || 0, Number(b.sort) || 0);
    res.json({ id: info.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: '房型名稱重複' }); }
});
app.put('/api/room-types/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM room_types WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到房型' });
  const b = req.body || {};
  const newName = String(b.name ?? cur.name).trim() || cur.name;
  try {
    // 房型改名連動：rooms／room_discounts 以名稱對應房型，改名一併更新避免對不上
    const tx = db.transaction(() => {
      db.prepare('UPDATE room_types SET name=?, price=?, sort=?, active=? WHERE id=?').run(
        newName, b.price !== undefined ? Number(b.price) || 0 : cur.price,
        b.sort !== undefined ? Number(b.sort) || 0 : cur.sort,
        b.active !== undefined ? (b.active ? 1 : 0) : cur.active, cur.id);
      if (newName !== cur.name) {
        db.prepare('UPDATE rooms SET room_type = ? WHERE room_type = ?').run(newName, cur.name);
        db.prepare('UPDATE room_discounts SET room_type = ? WHERE room_type = ?').run(newName, cur.name);
      }
    });
    tx();
    if (newName !== cur.name) {
      logAudit(req, { action: 'update', entity: 'room_types', entity_id: cur.id,
        summary: `房型改名：${cur.name}→${newName}（連動房間與房價折扣）` });
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: '房型名稱重複' }); }
});
app.delete('/api/room-types/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM room_types WHERE id = ?').get(req.params.id);
  if (cur) {
    const usedRooms = db.prepare('SELECT COUNT(*) c FROM rooms WHERE room_type = ?').get(cur.name).c;
    if (usedRooms) return res.status(400).json({ error: `尚有 ${usedRooms} 間房間屬於「${cur.name}」，請先調整房間房型再刪除` });
    const usedDiscounts = db.prepare('SELECT COUNT(*) c FROM room_discounts WHERE room_type = ?').get(cur.name).c;
    if (usedDiscounts) return res.status(400).json({ error: `尚有 ${usedDiscounts} 筆房價折扣屬於「${cur.name}」，請先刪除或改掛其他房型` });
  }
  db.prepare('DELETE FROM room_types WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 房間資料管理：房價折扣設定 ----------
app.get('/api/room-discounts', requireStaff, (req, res) => {
  const rt = String(req.query.room_type || '');
  const where = rt ? 'WHERE room_type = ?' : '';
  const args = rt ? [rt] : [];
  res.json(db.prepare(`SELECT * FROM room_discounts ${where} ORDER BY id DESC`).all(...args));
});
app.post('/api/room-discounts', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!String(b.room_type || '').trim()) return res.status(400).json({ error: '請選擇房型' });
  const type = ['percent', 'amount', 'gift'].includes(b.discount_type) ? b.discount_type : 'percent';
  const info = db.prepare(`INSERT INTO room_discounts
    (room_type, customer_class, plan_name, start_date, end_date, stay_days, discount_type, discount_value, bonus_days, note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    String(b.room_type).slice(0, 50), String(b.customer_class || '一般客戶').slice(0, 30),
    String(b.plan_name || '').slice(0, 50),
    /^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '') ? b.start_date : '',
    /^\d{4}-\d{2}-\d{2}$/.test(b.end_date || '') ? b.end_date : '',
    Number(b.stay_days) || 0, type, Number(b.discount_value) || 0, Number(b.bonus_days) || 0,
    String(b.note || '').slice(0, 200));
  res.json({ id: info.lastInsertRowid });
});
app.post('/api/room-discounts/batch', requireAdmin, (req, res) => {
  const b = req.body || {};
  const types = Array.isArray(b.room_types) ? b.room_types.map(t => String(t || '').trim()).filter(Boolean) : [];
  if (!types.length) return res.status(400).json({ error: '請至少選擇一個房型' });
  const type = ['percent', 'amount', 'gift'].includes(b.discount_type) ? b.discount_type : 'percent';
  const start = /^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '') ? b.start_date : '';
  const end = /^\d{4}-\d{2}-\d{2}$/.test(b.end_date || '') ? b.end_date : '';
  const ins = db.prepare(`INSERT INTO room_discounts
    (room_type, customer_class, plan_name, start_date, end_date, stay_days, discount_type, discount_value, bonus_days, note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  let added = 0;
  const tx = db.transaction(() => {
    for (const rt of types) {
      ins.run(rt.slice(0, 50), String(b.customer_class || '一般客戶').slice(0, 30),
        String(b.plan_name || '').slice(0, 50), start, end,
        Number(b.stay_days) || 0, type, Number(b.discount_value) || 0, Number(b.bonus_days) || 0,
        String(b.note || '').slice(0, 200));
      added++;
    }
  });
  tx();
  res.json({ added });
});
app.put('/api/room-discounts/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM room_discounts WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到折扣設定' });
  const b = req.body || {};
  const type = ['percent', 'amount', 'gift'].includes(b.discount_type) ? b.discount_type : cur.discount_type;
  db.prepare(`UPDATE room_discounts SET room_type=?, customer_class=?, plan_name=?, start_date=?, end_date=?,
    stay_days=?, discount_type=?, discount_value=?, bonus_days=?, note=?, active=? WHERE id=?`).run(
    b.room_type ?? cur.room_type, b.customer_class ?? cur.customer_class, b.plan_name ?? cur.plan_name,
    b.start_date !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(b.start_date) ? b.start_date : '') : cur.start_date,
    b.end_date !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(b.end_date) ? b.end_date : '') : cur.end_date,
    b.stay_days !== undefined ? Number(b.stay_days) || 0 : cur.stay_days, type,
    b.discount_value !== undefined ? Number(b.discount_value) || 0 : cur.discount_value,
    b.bonus_days !== undefined ? Number(b.bonus_days) || 0 : cur.bonus_days,
    b.note ?? cur.note, b.active !== undefined ? (b.active ? 1 : 0) : cur.active, cur.id);
  res.json({ ok: true });
});
app.delete('/api/room-discounts/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM room_discounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 房間資料管理：嬰兒床位設定 ----------
app.get('/api/baby-beds', requireStaff, (req, res) => {
  const kw = String(req.query.keyword || '').trim();
  const where = kw ? 'WHERE bed_no LIKE ?' : '';
  const args = kw ? [`%${kw}%`] : [];
  // 佔用狀態：在住（媽媽入住中）寶寶所指派的床位
  res.json(db.prepare(`SELECT bb.*,
      (SELECT b.name FROM babies b JOIN mothers m ON m.id = b.mother_id
        WHERE b.bed_id = bb.id AND m.status = 'checked_in' LIMIT 1) AS occupant_name,
      (SELECT m.name FROM babies b JOIN mothers m ON m.id = b.mother_id
        WHERE b.bed_id = bb.id AND m.status = 'checked_in' LIMIT 1) AS occupant_mother
    FROM baby_beds bb ${where} ORDER BY bb.zone, bb.bed_no`).all(...args));
});
app.post('/api/baby-beds', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!String(b.bed_no || '').trim()) return res.status(400).json({ error: '請填寫嬰兒床號碼' });
  try {
    const info = db.prepare('INSERT INTO baby_beds (bed_no, zone, note) VALUES (?,?,?)')
      .run(String(b.bed_no).trim().slice(0, 30), String(b.zone || 'A').slice(0, 10), String(b.note || '').slice(0, 100));
    res.json({ id: info.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: '床號重複' }); }
});
app.post('/api/baby-beds/batch', requireAdmin, (req, res) => {
  const list = Array.isArray((req.body || {}).beds) ? req.body.beds : [];
  if (!list.length) return res.status(400).json({ error: '請提供床號清單' });
  const ins = db.prepare('INSERT OR IGNORE INTO baby_beds (bed_no, zone) VALUES (?,?)');
  let added = 0;
  const tx = db.transaction(() => {
    for (const b of list) {
      const no = String(b.bed_no || '').trim();
      if (!no) continue;
      if (ins.run(no.slice(0, 30), String(b.zone || 'A').slice(0, 10)).changes) added++;
    }
  });
  tx();
  res.json({ added });
});
app.put('/api/baby-beds/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM baby_beds WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到床位' });
  const b = req.body || {};
  try {
    db.prepare('UPDATE baby_beds SET bed_no=?, zone=?, note=?, active=? WHERE id=?').run(
      String(b.bed_no ?? cur.bed_no).trim() || cur.bed_no, b.zone ?? cur.zone, b.note ?? cur.note,
      b.active !== undefined ? (b.active ? 1 : 0) : cur.active, cur.id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: '床號重複' }); }
});
app.delete('/api/baby-beds/:id', requireAdmin, (req, res) => {
  // 在住寶寶使用中不可刪；歷史寶寶的指派先解除再刪，避免外鍵擋下
  const occ = db.prepare(`SELECT b.name FROM babies b JOIN mothers m ON m.id = b.mother_id
    WHERE b.bed_id = ? AND m.status = 'checked_in' LIMIT 1`).get(req.params.id);
  if (occ) return res.status(400).json({ error: `此床位由在住寶寶「${occ.name}」使用中，請先改派床位` });
  const tx = db.transaction(() => {
    db.prepare('UPDATE babies SET bed_id = NULL WHERE bed_id = ?').run(req.params.id);
    db.prepare('DELETE FROM baby_beds WHERE id = ?').run(req.params.id);
  });
  tx();
  res.json({ ok: true });
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

// 設定寶寶入住日（用於計算「寶寶未入住扣抵」）；可清空
app.put('/api/bookings/:id/baby-check-in', requireStaff, (req, res) => {
  const bk = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  const v = ((req.body || {}).baby_check_in || '').trim();
  if (v && bk.check_in && v < bk.check_in) {
    return res.status(400).json({ error: '寶寶入住日不可早於媽媽入住日' });
  }
  db.prepare('UPDATE bookings SET baby_check_in = ? WHERE id = ?').run(v, req.params.id);
  logAudit(req, { action: 'update', entity: 'bookings', entity_id: bk.id, summary: `設定寶寶入住日：${v || '(清空)'}` });
  res.json({ ok: true });
});

// 入住前準備：調整房間／床位與起迄日（限尚未退房／取消者），含換房衝突檢查
app.put('/api/bookings/:id', requireStaff, (req, res) => {
  const bk = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  if (['checked_out', 'cancelled'].includes(bk.status)) {
    return res.status(400).json({ error: '已退房或已取消的訂房不可調整' });
  }
  const b = req.body || {};
  const roomId = b.room_id || bk.room_id;
  const checkIn = b.check_in || bk.check_in;
  const checkOut = b.check_out || bk.check_out;
  if (checkOut <= checkIn) return res.status(400).json({ error: '退房日需晚於入住日' });
  const conflict = db.prepare(`
    SELECT COUNT(*) c FROM bookings
    WHERE room_id = ? AND id != ? AND status IN ('reserved','checked_in')
      AND check_in < ? AND check_out > ?`).get(roomId, bk.id, checkOut, checkIn).c;
  if (conflict) return res.status(409).json({ error: '該房間此期間已有其他訂房' });
  const total = b.total_amount !== undefined ? Number(b.total_amount) || 0 : bk.total_amount;
  db.prepare('UPDATE bookings SET room_id = ?, check_in = ?, check_out = ?, total_amount = ? WHERE id = ?')
    .run(roomId, checkIn, checkOut, total, bk.id);
  // 入住日改期：報喜自動帶入的「住期訂餐」重新鋪滿新住期、「請備房」任務名稱與備註跟著更新
  if (checkIn !== bk.check_in || checkOut !== bk.check_out) {
    // 訂餐：以舊住期任一筆餐別為準，清掉舊住期、依新住期重鋪（入住日午餐～出住日早餐）
    const seed = db.prepare(`SELECT choice, note FROM meal_orders WHERE mother_id = ? AND meal_date >= ? AND meal_date <= ?
      ORDER BY meal_date, meal_type LIMIT 1`).get(bk.mother_id, bk.check_in, bk.check_out);
    if (seed) {
      db.prepare('DELETE FROM meal_orders WHERE mother_id = ? AND meal_date >= ? AND meal_date <= ?')
        .run(bk.mother_id, bk.check_in, bk.check_out);
      seedStayMeals(bk.mother_id, checkIn, checkOut, seed.choice, seed.note || '');
    }
    const roomName = (db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId) || {}).name || '';
    const oldRoomName = (db.prepare('SELECT name FROM rooms WHERE id = ?').get(bk.room_id) || {}).name || '';
    const newMmdd = String(checkIn).slice(5).replace('-', ''); // 新入住日 MMdd
    for (const t of db.prepare(`SELECT id, task, note FROM housekeeping_logs
      WHERE mother_id = ? AND status = 'pending' AND task LIKE '%請備房%'`).all(bk.mother_id)) {
      let note = String(t.note || '').split(bk.check_in).join(checkIn).split(bk.check_out).join(checkOut);
      if (oldRoomName && roomName && oldRoomName !== roomName) note = note.split(`${oldRoomName}房`).join(`${roomName}房`);
      // 任務名帶新入住日 MMdd、備註日期同步；排定日維持報喜儲存日不動
      db.prepare('UPDATE housekeeping_logs SET room_id = ?, task = ?, note = ? WHERE id = ?')
        .run(roomId, `${roomName}請備房${newMmdd}`, note, t.id);
    }
  }
  logAudit(req, { action: 'update', entity: 'bookings', entity_id: bk.id, summary: `入住前調整：房間#${roomId} ${checkIn}~${checkOut}` });
  res.json({ ok: true });
});

app.put('/api/bookings/:id/status', requireStaff, (req, res) => {
  const status = (req.body || {}).status;
  if (!['reserved', 'checked_in', 'checked_out', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: '狀態不正確' });
  }
  const bk = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  // 已辦理產婦結案者不可改回入住中（結案＝已退房），避免結案與房況兩邊不同步
  if (status === 'checked_in' && db.prepare(`SELECT 1 FROM mother_closures
      WHERE mother_id = ? AND booking_id IN (?, 0)`).get(bk.mother_id, chainRootIdOf(bk.id))) {
    return res.status(409).json({ error: '此媽媽已辦理產婦結案，請先於「產婦結案」頁解除結案，再改回入住中' });
  }
  // 生效日前提前退房／取消：未生效的接續段（期間變更／轉房的預約段）一併作廢，帳務移回本段
  if (['checked_out', 'cancelled'].includes(status)) {
    let curId = bk.id;
    for (let i = 0; i < 20; i++) {
      const succ = db.prepare(`SELECT * FROM bookings WHERE continued_from = ? AND status = 'reserved' LIMIT 1`).get(curId);
      if (!succ) break;
      db.prepare('UPDATE payments SET booking_id = ? WHERE booking_id = ?').run(bk.id, succ.id);
      db.prepare('UPDATE charge_items SET booking_id = ? WHERE booking_id = ?').run(bk.id, succ.id);
      if (succ.deposit) db.prepare('UPDATE bookings SET deposit = deposit + ? WHERE id = ?').run(succ.deposit, bk.id);
      db.prepare(`UPDATE bookings SET status = 'cancelled', deposit = 0 WHERE id = ?`).run(succ.id);
      logAudit(req, { action: 'update', entity: 'bookings', entity_id: succ.id,
        summary: `未生效接續段自動取消（原訂房#${bk.id} ${status === 'cancelled' ? '取消' : '提前退房'}）：${succ.check_in}~${succ.check_out}，帳務移回原段` });
      curId = succ.id;
    }
  }
  // 取消「未生效接續段」本身（撤銷期間變更／轉房）：帳務移回前段、前段恢復原出住日與應收
  if (status === 'cancelled' && bk.status === 'reserved' && bk.continued_from) {
    const pred = db.prepare(`SELECT * FROM bookings WHERE id = ? AND status IN ('reserved','checked_in')`).get(bk.continued_from);
    if (pred) {
      db.prepare('UPDATE payments SET booking_id = ? WHERE booking_id = ?').run(pred.id, bk.id);
      db.prepare('UPDATE charge_items SET booking_id = ? WHERE booking_id = ?').run(pred.id, bk.id);
      db.prepare('UPDATE bookings SET deposit = deposit + ?, check_out = ?, total_amount = total_amount + ? WHERE id = ?')
        .run(bk.deposit, bk.check_out, bk.total_amount, pred.id);
      db.prepare('UPDATE bookings SET deposit = 0 WHERE id = ?').run(bk.id);
      logAudit(req, { action: 'update', entity: 'bookings', entity_id: pred.id,
        summary: `撤銷未生效變更（接續段#${bk.id} 取消）：出住日恢復 ${bk.check_out}、應收併回 ${bk.total_amount}、帳務移回` });
    }
  }
  // 已結轉至後段的原段不可改回入住中（會與後段同時入住中、帳務重複）
  if (status === 'checked_in') {
    const succ = db.prepare(`SELECT id, status FROM bookings WHERE continued_from = ? AND status IN ('checked_in','checked_out') LIMIT 1`).get(bk.id);
    if (succ) return res.status(409).json({ error: `此訂房已由期間變更／轉房結轉至後段（訂房#${succ.id}），請改於後段操作` });
  }
  // 接續段直接辦理入住＝提前生效：前段（入住中）自動轉已退住，切換日改為今日對齊床表（應收維持原約定）
  if (status === 'checked_in' && bk.continued_from) {
    const pred = db.prepare(`SELECT * FROM bookings WHERE id = ? AND status = 'checked_in'`).get(bk.continued_from);
    if (pred) {
      const d0 = today();
      db.prepare(`UPDATE bookings SET status = 'checked_out', actual_check_out = ?, check_out = ? WHERE id = ?`)
        .run(d0, d0 < pred.check_out ? d0 : pred.check_out, pred.id);
      if (d0 < bk.check_in) db.prepare('UPDATE bookings SET check_in = ? WHERE id = ?').run(d0, bk.id);
      // 原房退房清潔任務提前到今日
      db.prepare(`UPDATE housekeeping_logs SET scheduled_for = ? WHERE room_id = ? AND mother_id = ?
        AND status = 'pending' AND task LIKE '%退房清潔%' AND scheduled_for > ?`).run(d0, pred.room_id, pred.mother_id, d0);
      logAudit(req, { action: 'update', entity: 'bookings', entity_id: pred.id,
        summary: `切段提前生效：接續段#${bk.id} 辦理入住，原段轉已退住、切換日改為 ${d0}（應收維持原約定）` });
    }
  }
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
  if (status === 'checked_out' && !bk.actual_check_out) {
    // 記錄實際退房日；早於預退日視為提前退房（原因可由前端帶入）
    db.prepare('UPDATE bookings SET actual_check_out = ?, early_reason = ? WHERE id = ?')
      .run(today(), String((req.body || {}).reason || '').slice(0, 200), bk.id);
  }
  if (status === 'checked_in') {
    db.prepare(`UPDATE mothers SET status = 'checked_in' WHERE id = ?`).run(bk.mother_id);
    maybeWelcome(bk.id); // 首次入住自動發送歡迎關懷（有家屬帳號才送、不重複）
  } else if (status === 'checked_out') {
    db.prepare(`UPDATE mothers SET status = 'checked_out' WHERE id = ?`).run(bk.mother_id);
    if (bk.status !== 'checked_out') pushCheckoutSurvey(bk.mother_id); // 退房時自動推滿意度問卷
  }
  res.json({ ok: true });
});

// 入住歡迎自動關懷：留言到家屬端，並（已綁定者）LINE 推播；回傳實際發送份數
function pushWelcome(motherId) {
  const s = getSettings();
  const mom = db.prepare('SELECT name FROM mothers WHERE id = ?').get(motherId);
  const fams = db.prepare(`SELECT f.* FROM family_members f JOIN babies b ON b.id = f.baby_id
    WHERE b.mother_id = ? AND f.active = 1`).all(motherId);
  if (!fams.length) return 0;
  const token = (s.line_channel_access_token || '').trim();
  const text = `歡迎入住${s.center_name || '本中心'}！\n${mom ? mom.name + ' 媽媽' : '您'}與寶寶的每日照護紀錄、照片與月子餐都能在家屬入口查看，有任何需求都可在「聯絡護理站」留言，祝您與寶寶月子順心愉快 🍼`;
  const insMsg = db.prepare(`INSERT INTO family_messages (baby_id, family_id, sender, sender_name, body) VALUES (?,?,?,?,?)`);
  for (const f of fams) {
    insMsg.run(f.baby_id, f.id, 'staff', '系統', text);
    if (token && f.line_user_id) notify.pushText(token, f.line_user_id, text).catch(() => {});
  }
  return fams.length;
}

// 只有實際送出（有家屬帳號）才標記已歡迎，讓家屬帳號較晚建立時仍能補送
function maybeWelcome(bookingId) {
  try {
    const bk = db.prepare('SELECT id, mother_id, welcomed_at, status FROM bookings WHERE id = ?').get(bookingId);
    if (!bk || bk.welcomed_at || bk.status !== 'checked_in') return;
    if (pushWelcome(bk.mother_id) > 0) {
      db.prepare("UPDATE bookings SET welcomed_at = datetime('now','localtime') WHERE id = ?").run(bk.id);
    }
  } catch (e) { /* 不影響流程 */ }
}

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
  COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = bk.id), 0) AS payments_total,
  COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = bk.id AND p.target = 'addon'), 0) AS payments_addon`;

function babyDeductRate() {
  return Number(getSettings().baby_absence_daily_deduct) || 0;
}

// 單筆不在館內期間的計費天數：夾在 入住日～退房日（或 until）之間。
// 未填結束日（仍不在館內）者計至今日（已退房計至退房日）；明確結束日（含未來日期）依填寫計算。
function absenceRowDays(a, bk, until) {
  let openCap = until
    || (bk.status === 'checked_out' ? ((bk.actual_check_out || '').slice(0, 10) || bk.check_out) : today());
  if (bk.check_out && openCap > bk.check_out) openCap = bk.check_out;
  let hardCap = until || bk.check_out || openCap;
  if (bk.check_out && hardCap > bk.check_out) hardCap = bk.check_out;
  const s = (bk.check_in && a.start_date < bk.check_in) ? bk.check_in : a.start_date;
  const e = a.end_date ? (a.end_date < hardCap ? a.end_date : hardCap) : openCap;
  return Math.max(0, Math.round((new Date(e) - new Date(s)) / 86400000));
}

// 寶寶不在館內天數：加總各期間計費天數
function babyAbsenceDays(bk, until) {
  return db.prepare('SELECT start_date, end_date FROM baby_absences WHERE booking_id = ? AND removed = 0')
    .all(bk.id).reduce((sum, a) => sum + absenceRowDays(a, bk, until), 0);
}

// 由寶寶照護位置異動紀錄同步「不在館內」期間（住院中／不在館內 → 回館為一段）
// 以 log_key 冪等：已帶入（含已編輯、已移除）者不重複建立；log 帶入且未經手動編輯者自動補結束日
function syncBabyAbsences(bk) {
  const babies = db.prepare('SELECT id, name FROM babies WHERE mother_id = ?').all(bk.mother_id);
  for (const baby of babies) {
    const logs = db.prepare(`SELECT id, location, moved_at FROM baby_location_logs
      WHERE baby_id = ? ORDER BY moved_at, id`).all(baby.id);
    let start = null, startId = null;
    const periods = [];
    for (const l of logs) {
      const away = l.location === 'hospital' || l.location === 'out';
      if (away && !start) { start = l.moved_at.slice(0, 10); startId = l.id; }
      else if (!away && start) { periods.push({ start, end: l.moved_at.slice(0, 10), key: startId }); start = null; startId = null; }
    }
    if (start) periods.push({ start, end: '', key: startId });
    for (const p of periods) {
      // 與訂房期間無重疊者略過
      if (bk.check_out && p.start > bk.check_out) continue;
      if (p.end && bk.check_in && p.end < bk.check_in) continue;
      const key = `log:${baby.id}:${p.key}`;
      const row = db.prepare('SELECT id, source, removed, end_date FROM baby_absences WHERE booking_id = ? AND log_key = ?').get(bk.id, key);
      if (!row) {
        db.prepare(`INSERT INTO baby_absences (booking_id, start_date, end_date, source, log_key, note)
          VALUES (?,?,?,?,?,?)`).run(bk.id, p.start, p.end, 'log', key, `寶寶照護紀錄帶入（${baby.name}）`);
      } else if (row.source === 'log' && !row.removed && !row.end_date && p.end) {
        db.prepare('UPDATE baby_absences SET end_date = ? WHERE id = ?').run(p.end, row.id);
      }
    }
  }
}

// rate 可由呼叫端帶入避免重複讀設定；未帶入時自動讀取
// ---------- 住期切段接續鏈（bookings.continued_from）：期間變更／轉房／拆分的前後段 ----------
// 後段＝接續本段的有效訂房；前段鏈＝沿 continued_from 往前追（防呆上限 20 層）
function chainSuccessorId(bookingId) {
  const r = db.prepare(`SELECT id FROM bookings WHERE continued_from = ? AND status != 'cancelled' ORDER BY id LIMIT 1`).get(bookingId);
  return r ? r.id : null;
}
// 新段插入鏈中時，把前段原有的其他接續改指到新段（維持鏈為嚴格線性，帳務不重複併入）
function chainRelink(oldId, newId) {
  db.prepare(`UPDATE bookings SET continued_from = ? WHERE continued_from = ? AND id != ? AND status != 'cancelled'`)
    .run(newId, oldId, newId);
}
// 前段鏈未結餘額（應收＋加購−寶寶扣抵−訂金−已收），併入現行段應收。
// 期間變更／入住後轉房已把訂金與收款移到後段，此值通常＝前段應收；預約段拆分則訂金留前段自動淨額。
// 僅沿「指定後段」（chainSuccessorId）往前累計，前段帳務只會併入一個後段。
function chainPriorBalance(row, rate) {
  let sum = 0, curId = row.id, curFrom = row.continued_from;
  for (let i = 0; curFrom && i < 20; i++) {
    const p = db.prepare(`SELECT bk.*, ${BILLING_SUMS} FROM bookings bk WHERE bk.id = ?`).get(curFrom);
    if (!p || p.status === 'cancelled' || chainSuccessorId(p.id) !== curId) break;
    sum += p.total_amount + p.charges_total - babyAbsenceDays(p) * rate - p.deposit - p.payments_total;
    curId = p.id;
    curFrom = p.continued_from;
  }
  return sum;
}
// 沿前段鏈找整段住期的起始入住日（供平均住宿日數等報表用）
function chainRootCheckIn(bk) {
  let cur = bk;
  for (let i = 0; cur.continued_from && i < 20; i++) {
    const p = db.prepare('SELECT id, check_in, continued_from FROM bookings WHERE id = ?').get(cur.continued_from);
    if (!p) break;
    cur = p;
  }
  return cur.check_in;
}

function withBalance(row, rate) {
  if (rate === undefined) rate = babyDeductRate();
  // 寶寶不在館內扣抵：baby_absences 期間每日扣 rate，自動調整合約應收
  const absentDays = babyAbsenceDays(row);
  row.baby_absent_days = absentDays;
  row.baby_deduct = absentDays * rate;
  // 切段接續：有後段者帳務全數併入後段（本列不再計餘額）；現行段把前段鏈未結併入應收
  row.merged_into = row.id ? chainSuccessorId(row.id) : null;
  row.chain_prior = (!row.merged_into && row.continued_from) ? chainPriorBalance(row, rate) : 0;
  if (row.merged_into) {
    row.total_due = 0; row.total_paid = 0; row.balance = 0;
    row.paid_contract = 0; row.paid_addon = 0;
    row.contract_due = 0; row.addon_due = 0; row.contract_balance = 0; row.addon_balance = 0;
    return row;
  }
  row.total_due = row.total_amount + row.chain_prior + row.charges_total - row.baby_deduct;
  row.total_paid = row.deposit + row.payments_total;
  row.balance = row.total_due - row.total_paid;
  // 合約款與加購款分開記帳（開立不同公司發票）：
  // 訂金與「合約款」繳費沖抵合約應收；「加購款」繳費沖抵加購消費。
  // 合約先付全額、之後又有扣抵時，合約餘額可為負數（溢收待退／待折抵）。
  row.payments_addon = row.payments_addon || 0;
  row.paid_contract = row.deposit + (row.payments_total - row.payments_addon);
  row.paid_addon = row.payments_addon;
  row.contract_due = row.total_amount + row.chain_prior - row.baby_deduct;
  row.addon_due = row.charges_total;
  row.contract_balance = row.contract_due - row.paid_contract;
  row.addon_balance = row.addon_due - row.paid_addon; // 兩者相加恆等於 balance
  return row;
}

app.get('/api/billing', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT bk.*, m.name AS mother_name, r.name AS room_name, ${BILLING_SUMS}
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status != 'cancelled'
    ORDER BY CASE bk.status WHEN 'checked_in' THEN 0 WHEN 'reserved' THEN 1 ELSE 2 END, bk.check_in`).all();
  const rate = babyDeductRate();
  rows.forEach(r => syncBabyAbsences(r));
  res.json(rows.map(r => withBalance(r, rate)));
});

// 應收帳款帳齡：以退房日為到期基準，逾期分齡（在住者為未到期）
app.get('/api/billing/aging', requireStaff, (req, res) => {
  const d = today();
  const agingRows = db.prepare(`
    SELECT bk.*, m.name AS mother_name, m.phone, r.name AS room_name, ${BILLING_SUMS}
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status != 'cancelled'`).all();
  agingRows.forEach(r => syncBabyAbsences(r)); // 同步寶寶不在館內紀錄，餘額與收費帳務一致
  const rows = agingRows.map(r => withBalance(r, babyDeductRate())).filter(b => b.balance > 0);
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
      db.prepare(`INSERT INTO payments (booking_id, amount, method, paid_on, note, received_by, target, item)
        VALUES (?,?,?,?,?,?,?,?)`).run(intent.booking_id, intent.amount, '線上刷卡(ECPay)', today(), `綠界交易 ${p.TradeNo || ''}`, intent.created_by, 'contract', '房費');
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
  syncBabyAbsences(bk);
  withBalance(bk);
  // 不在館內紀錄：附上每列夾算後的天數（與扣抵計算一致）
  bk.absences = db.prepare(`SELECT * FROM baby_absences WHERE booking_id = ? AND removed = 0
    ORDER BY start_date, id`).all(bk.id).map(a => {
    a.days = absenceRowDays(a, bk);
    return a;
  });
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
  // 款別：房費／訂金／尾款＝合約款；其餘項目預設加購款，但呼叫端可明確指定（入住前收款「其他」歸合約款）
  const item = String(p.item || '').trim();
  const target = ['房費', '訂金', '尾款'].includes(item) ? 'contract'
    : (p.target === 'addon' || p.target === 'contract') ? p.target
    : item ? 'addon' : 'contract';
  const info = db.prepare(`INSERT INTO payments
    (booking_id, amount, method, paid_on, note, received_by, target, item) VALUES (?,?,?,?,?,?,?,?)`).run(
    bk.id, Math.round(amount), p.method || '現金', p.paid_on || today(), p.note || '', req.session.user.id, target, item);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/payments/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
  res.json({ ok: info.changes > 0 });
});

// ---------- 寶寶不在館內紀錄（扣抵合約應收） ----------
function validAbsenceDates(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) return '起始日必填（YYYY-MM-DD）';
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) return '結束日格式錯誤';
  if (end && end < start) return '結束日不可早於起始日';
  return '';
}

app.post('/api/bookings/:id/absences', requireStaff, (req, res) => {
  const a = req.body || {};
  const err = validAbsenceDates(a.start_date, a.end_date);
  if (err) return res.status(400).json({ error: err });
  const bk = db.prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  const info = db.prepare(`INSERT INTO baby_absences (booking_id, start_date, end_date, source, note)
    VALUES (?,?,?,?,?)`).run(bk.id, a.start_date, a.end_date || '', 'manual', a.note || '');
  logAudit(req, { action: 'create', entity: 'baby_absences', entity_id: info.lastInsertRowid, summary: `不在館內 ${a.start_date}~${a.end_date || '至今'}` });
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/absences/:id', requireStaff, (req, res) => {
  const a = req.body || {};
  const err = validAbsenceDates(a.start_date, a.end_date);
  if (err) return res.status(400).json({ error: err });
  const row = db.prepare('SELECT id FROM baby_absences WHERE id = ? AND removed = 0').get(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到紀錄' });
  // 手動編輯後轉為 manual，之後不再被 log 同步覆寫結束日
  db.prepare(`UPDATE baby_absences SET start_date = ?, end_date = ?, note = ?, source = 'manual'
    WHERE id = ?`).run(a.start_date, a.end_date || '', a.note || '', row.id);
  logAudit(req, { action: 'update', entity: 'baby_absences', entity_id: row.id, summary: `不在館內改為 ${a.start_date}~${a.end_date || '至今'}` });
  res.json({ ok: true });
});

app.delete('/api/absences/:id', requireStaff, (req, res) => {
  const row = db.prepare('SELECT id, log_key FROM baby_absences WHERE id = ? AND removed = 0').get(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到紀錄' });
  // log／legacy 帶入列（含編輯過的）標記移除，防同步以同一 log_key 重新帶入；純手動列直接刪除
  if (row.log_key) db.prepare('UPDATE baby_absences SET removed = 1 WHERE id = ?').run(row.id);
  else db.prepare('DELETE FROM baby_absences WHERE id = ?').run(row.id);
  logAudit(req, { action: 'delete', entity: 'baby_absences', entity_id: row.id, summary: '刪除不在館內紀錄' });
  res.json({ ok: true });
});

// ---------- 商城：商品與訂單 ----------
// 找出某媽媽目前進行中的訂房（供訂單掛帳用）
function activeBookingForMother(motherId) {
  return db.prepare(`SELECT id FROM bookings WHERE mother_id = ?
    ORDER BY CASE status WHEN 'checked_in' THEN 0 WHEN 'reserved' THEN 1 ELSE 2 END, check_in DESC`).get(motherId);
}

// ---------- 住期識別（回住支援）----------
// 一段住期＝一條訂房接續鏈，以鏈根 booking id 代表；回住（二胎）會產生新的鏈根。
// 入住評估／產婦結案／衛教紀錄以住期區分，0＝建檔時尚無訂房。
function chainRootIdOf(bookingId) {
  let id = bookingId;
  for (let i = 0; i < 20; i++) {
    const r = db.prepare('SELECT continued_from FROM bookings WHERE id = ?').get(id);
    if (!r || !r.continued_from) break;
    id = r.continued_from;
  }
  return id;
}
// 依「紀錄當下的日期」對應當時所住的房號：多段轉房時，歷史照護／巡診紀錄顯示當時的房，
// 不會被最後一段（或目前在住段）整批覆蓋。查無涵蓋該日的段落時，退回最近一次住房。
// dateExpr＝紀錄日期運算式；momExpr＝媽媽 id 運算式（皆為 SQL 片段）
function roomAtDateSql(dateExpr, momExpr) {
  return `COALESCE(
    (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
      WHERE bk.mother_id = ${momExpr} AND bk.status != 'cancelled'
        AND ${dateExpr} >= bk.check_in AND ${dateExpr} <= bk.check_out
      ORDER BY bk.check_in DESC LIMIT 1),
    (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
      WHERE bk.mother_id = ${momExpr} AND bk.status IN ('checked_in','checked_out')
      ORDER BY bk.check_in DESC LIMIT 1))`;
}

// 本次住期的房段歷程（轉房 log）：沿 continued_from 鏈由起始段往後列出，供房況卡片顯示
// 「201（07-01~07-05）→ 101（07-05~07-10）」這類轉房軌跡
function staySegmentsOf(bookingId) {
  const rootId = chainRootIdOf(bookingId);
  const segs = [];
  let curId = rootId;
  for (let i = 0; curId && i < 20; i++) {
    const s = db.prepare(`SELECT bk.id, bk.check_in, bk.check_out, bk.status, bk.notes, r.name AS room_name, r.room_type
      FROM bookings bk JOIN rooms r ON r.id = bk.room_id WHERE bk.id = ?`).get(curId);
    if (!s || s.status === 'cancelled') break;
    segs.push(s);
    curId = chainSuccessorId(curId);
  }
  return segs;
}

function stayRootForMother(motherId) {
  const bk = db.prepare(`SELECT id FROM bookings WHERE mother_id = ? AND status != 'cancelled'
    ORDER BY check_in DESC, id DESC LIMIT 1`).get(motherId);
  return bk ? chainRootIdOf(bk.id) : 0;
}
// 住期範疇讀取：優先取當前住期的資料，無則回退尚未蓋住期章（booking_id=0）的資料
function intakeForMother(motherId) {
  return db.prepare(`SELECT * FROM mother_intake_assessments WHERE mother_id = ? AND booking_id IN (?, 0)
    ORDER BY booking_id DESC LIMIT 1`).get(motherId, stayRootForMother(motherId));
}
function closureForMother(motherId) {
  return db.prepare(`SELECT * FROM mother_closures WHERE mother_id = ? AND booking_id IN (?, 0)
    ORDER BY booking_id DESC LIMIT 1`).get(motherId, stayRootForMother(motherId));
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

// 商城商品批次匯入（CSV 前端解析後送陣列）；以品名為鍵，存在則更新、否則新增
app.post('/api/products/import', requireAdmin, (req, res) => {
  const list = Array.isArray((req.body || {}).items) ? req.body.items : [];
  if (!list.length) return res.status(400).json({ error: '沒有可匯入的商品' });
  // 檔內重複品名偵測（提醒用，仍會以最後一筆為準匯入）
  const nameCount = {};
  for (const r of list) { const n = String(r.name || '').trim(); if (n) nameCount[n] = (nameCount[n] || 0) + 1; }
  const duplicates = Object.keys(nameCount).filter(k => nameCount[k] > 1);
  const findByName = db.prepare('SELECT id FROM products WHERE name = ?');
  const ins = db.prepare(`INSERT INTO products (name, category, price, cost, description, track_stock, stock, active, sort, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const upd = db.prepare('UPDATE products SET category=?, price=?, cost=?, description=?, track_stock=?, stock=?, active=? WHERE id=?');
  let added = 0, updated = 0, skipped = 0;
  const tx = db.transaction(() => {
    for (const r of list) {
      const name = String(r.name || '').trim();
      if (!name) { skipped++; continue; }
      const category = String(r.category || '').slice(0, 40);
      const price = Math.round(Number(r.price) || 0), cost = Math.round(Number(r.cost) || 0);
      const desc = String(r.description || '').slice(0, 500);
      const track = /^(1|y|yes|是|v)$/i.test(String(r.track_stock || '')) ? 1 : 0;
      const stock = Math.round(Number(r.stock) || 0);
      const active = String(r.active || '') === '' ? 1 : (/^(1|y|yes|是|上架|v)$/i.test(String(r.active)) ? 1 : 0);
      const exist = findByName.get(name);
      if (exist) { upd.run(category, price, cost, desc, track, stock, active, exist.id); updated++; }
      else { ins.run(name, category, price, cost, desc, track, stock, active, 0, req.session.user.id); added++; }
    }
  });
  tx();
  res.json({ added, updated, skipped, duplicates });
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
            (booking_id, order_id, item_name, unit_price, quantity, charged_on, note, created_by)
            VALUES (?,?,?,?,?,?,?,?)`).run(
            bookingId, o.id, it.item_name, it.unit_price, it.quantity, today(),
            `商城訂單#${o.id}`, req.session.user.id);
        }
      }
      // 折扣（優惠券＋點數）以負數加購列入帳
      if (bookingId && o.discount > 0) {
        const parts = [];
        if (o.coupon_code) parts.push(`優惠券 ${o.coupon_code}`);
        if (o.points_used > 0) parts.push(`點數 ${o.points_used} 點`);
        db.prepare(`INSERT INTO charge_items
          (booking_id, order_id, item_name, unit_price, quantity, charged_on, note, created_by)
          VALUES (?,?,?,?,?,?,?,?)`).run(
          bookingId, o.id, '商城優惠折抵', -o.discount, 1, today(),
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
// 備品開放前台銷售 → 商城商品自動建檔（庫存 0、管控庫存、上架）；只建一次，之後商品由商城模組維護。
// product_id 已有值者一律不再建（即使商品已被管理員刪除也尊重刪除，不於重啟時復活）
function syncSupplyProduct(supplyId, userId) {
  const s = db.prepare('SELECT * FROM supplies WHERE id = ?').get(supplyId);
  if (!s || !s.front_sellable) return null;
  if (s.product_id) return null;
  const info = db.prepare(`INSERT INTO products (name, category, price, description, track_stock, stock, active, created_by)
    VALUES (?,?,?,?,1,0,1,?)`).run(
    s.name, s.category || '', s.price || 0, `備品自動建檔（產品編號 ${s.code || '—'}）`, userId || null);
  db.prepare('UPDATE supplies SET product_id = ? WHERE id = ?').run(info.lastInsertRowid, s.id);
  return info.lastInsertRowid;
}
// 啟動時補建：既有已勾開放前台銷售、尚未建檔者（冪等，靠 product_id 連結）
for (const row of db.prepare('SELECT id FROM supplies WHERE front_sellable = 1').all()) syncSupplyProduct(row.id, null);
app.get('/api/supplies', requireStaff, (req, res) => {
  res.json(db.prepare('SELECT * FROM supplies ORDER BY active DESC, (stock <= safety_stock) DESC, category, name').all());
});
app.post('/api/supplies', requireAdmin, (req, res) => {
  const s = req.body || {};
  if (!s.name) return res.status(400).json({ error: '品名必填' });
  const info = db.prepare(`INSERT INTO supplies (name, category, unit, stock, safety_stock, restock_level, note, active, code, price, has_expiry, front_sellable)
    VALUES (?,?,?,?,?,?,?,1,?,?,?,?)`).run(
    s.name, s.category || '', s.unit || '', Math.round(Number(s.stock) || 0),
    Math.round(Number(s.safety_stock) || 0), Math.round(Number(s.restock_level) || 0), s.note || '',
    String(s.code || '').slice(0, 40), Math.round(Number(s.price) || 0), s.has_expiry ? 1 : 0, s.front_sellable ? 1 : 0);
  syncSupplyProduct(info.lastInsertRowid, req.session.user.id);
  logAudit(req, { action: 'create', entity: 'supply', entity_id: info.lastInsertRowid, summary: s.name });
  res.json({ id: info.lastInsertRowid });
});

// 備品品項批次匯入（CSV 前端解析後送陣列）；以產品編號為鍵，存在則更新、否則新增
app.post('/api/supplies/import', requireAdmin, (req, res) => {
  const list = Array.isArray((req.body || {}).items) ? req.body.items : [];
  if (!list.length) return res.status(400).json({ error: '沒有可匯入的品項' });
  // 檔內重複產品編號偵測（提醒用；空白編號一律新增，不視為重複）
  const codeCount = {};
  for (const r of list) { const c = String(r.code || '').trim(); if (c) codeCount[c] = (codeCount[c] || 0) + 1; }
  const duplicates = Object.keys(codeCount).filter(k => codeCount[k] > 1);
  const findByCode = db.prepare('SELECT id FROM supplies WHERE code = ? AND code != \'\'');
  const ins = db.prepare(`INSERT INTO supplies (name, category, unit, safety_stock, note, active, code, price, has_expiry, front_sellable)
    VALUES (?,?,?,?,?,1,?,?,?,?)`);
  const upd = db.prepare('UPDATE supplies SET name=?, category=?, unit=?, safety_stock=?, price=?, has_expiry=?, front_sellable=? WHERE id=?');
  let added = 0, updated = 0, skipped = 0;
  const syncIds = [];
  const tx = db.transaction(() => {
    for (const r of list) {
      const name = String(r.name || '').trim();
      if (!name) { skipped++; continue; }
      const code = String(r.code || '').trim().slice(0, 40);
      const category = String(r.category || '').slice(0, 40), unit = String(r.unit || '').slice(0, 20);
      const price = Math.round(Number(r.price) || 0), safety = Math.round(Number(r.safety_stock) || 0);
      const hasExp = /^(1|y|yes|是|v)$/i.test(String(r.has_expiry || '')) ? 1 : 0;
      const front = /^(1|y|yes|是|v)$/i.test(String(r.front_sellable || '')) ? 1 : 0;
      const exist = code ? findByCode.get(code) : null;
      if (exist) { upd.run(name, category, unit, safety, price, hasExp, front, exist.id); updated++; if (front) syncIds.push(exist.id); }
      else { const ni = ins.run(name, category, unit, safety, '', code, price, hasExp, front); added++; if (front) syncIds.push(ni.lastInsertRowid); }
    }
    for (const id of syncIds) syncSupplyProduct(id, req.session.user.id);
  });
  tx();
  res.json({ added, updated, skipped, duplicates });
});

// 備品庫存盤點彙總：每品項的入庫總數／出庫總數／目前庫存（期初＝目前－入庫＋出庫）
app.get('/api/supplies/stock-summary', requireStaff, (req, res) => {
  res.json(db.prepare(`SELECT s.id, s.code, s.name, s.category, s.unit, s.stock, s.active,
      COALESCE((SELECT SUM(quantity) FROM supply_txns WHERE supply_id = s.id AND txn_type = 'in'), 0) AS total_in,
      COALESCE((SELECT SUM(quantity) FROM supply_txns WHERE supply_id = s.id AND txn_type = 'out'), 0) AS total_out
    FROM supplies s WHERE s.active = 1 ORDER BY s.category, s.name`).all());
});

// 分頁參數：帶 page/pageSize 才啟用（回 {rows,total,page,pageSize}）；否則沿用原本回陣列
function pageParams(req, def = 20, max = 200) {
  const enabled = req.query.page !== undefined || req.query.pageSize !== undefined;
  const pageSize = Math.min(max, Math.max(1, parseInt(req.query.pageSize, 10) || def));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  return { enabled, page, pageSize, offset: (page - 1) * pageSize };
}

// 備品進出／盤點明細：全域異動清單（type 可篩 in/out/adjust；日期區間；關鍵字；分類；可分頁）
app.get('/api/supply-txns', requireStaff, (req, res) => {
  const type = String(req.query.type || '');
  const from = String(req.query.from || ''), to = String(req.query.to || '');
  const kw = String(req.query.keyword || '').trim();
  const kwField = req.query.kw_field === 'code' ? 'code' : 'name';
  const category = String(req.query.category || '').trim();
  const cond = [], args = [];
  if (['in', 'out', 'adjust'].includes(type)) { cond.push('st.txn_type = ?'); args.push(type); }
  else if (type === 'inout') { cond.push("st.txn_type IN ('in','out')"); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { cond.push('date(st.created_at) >= ?'); args.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { cond.push('date(st.created_at) <= ?'); args.push(to); }
  if (category) { cond.push('s.category = ?'); args.push(category); }
  if (kw) { cond.push(kwField === 'code' ? 's.code LIKE ?' : 's.name LIKE ?'); args.push('%' + kw + '%'); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const fromJoin = 'FROM supply_txns st JOIN supplies s ON s.id = st.supply_id LEFT JOIN users u ON u.id = st.created_by';
  const cols = 'SELECT st.*, s.name AS supply_name, s.code AS supply_code, s.category AS supply_category, s.unit AS supply_unit, u.name AS staff_name';
  const pg = pageParams(req);
  if (pg.enabled) {
    const total = db.prepare(`SELECT COUNT(*) c ${fromJoin} ${where}`).get(...args).c;
    const rows = db.prepare(`${cols} ${fromJoin} ${where} ORDER BY st.id DESC LIMIT ? OFFSET ?`).all(...args, pg.pageSize, pg.offset);
    return res.json({ rows, total, page: pg.page, pageSize: pg.pageSize });
  }
  res.json(db.prepare(`${cols} ${fromJoin} ${where} ORDER BY st.id DESC LIMIT 1000`).all(...args));
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
  db.prepare(`UPDATE supplies SET name=?, category=?, unit=?, safety_stock=?, restock_level=?, note=?, active=?,
    code=?, price=?, has_expiry=?, front_sellable=? WHERE id=?`).run(
    s.name ?? cur.name, s.category ?? cur.category, s.unit ?? cur.unit,
    Math.round(s.safety_stock === undefined ? cur.safety_stock : Number(s.safety_stock) || 0),
    Math.round(s.restock_level === undefined ? cur.restock_level : Number(s.restock_level) || 0),
    s.note ?? cur.note, (s.active === undefined ? cur.active : (s.active ? 1 : 0)),
    s.code === undefined ? cur.code : String(s.code).slice(0, 40),
    Math.round(s.price === undefined ? cur.price : Number(s.price) || 0),
    s.has_expiry === undefined ? cur.has_expiry : (s.has_expiry ? 1 : 0),
    s.front_sellable === undefined ? cur.front_sellable : (s.front_sellable ? 1 : 0), cur.id);
  syncSupplyProduct(cur.id, req.session.user.id);
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
    db.prepare(`INSERT INTO supply_txns (supply_id, txn_type, quantity, balance_after, reason, note, created_by, vendor, area, expiry_date)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(cur.id, t.txn_type, delta, balance, t.reason || '', t.note || '', req.session.user.id,
      String(t.vendor || '').slice(0, 60), String(t.area || '').slice(0, 60),
      /^\d{4}-\d{2}-\d{2}$/.test(t.expiry_date || '') ? t.expiry_date : '');
  });
  tx();
  res.json({ ok: true, stock: balance });
});
app.get('/api/supplies/:id/txns', requireStaff, (req, res) => {
  res.json(db.prepare(`SELECT st.*, u.name AS staff_name FROM supply_txns st
    LEFT JOIN users u ON u.id = st.created_by WHERE st.supply_id = ? ORDER BY st.id DESC LIMIT 100`).all(req.params.id));
});

// 備品領取出庫（批次）：一個領取單位一次可領多品項；
// 用途「販售」時領出數量匯入商城同名商品庫存，商城無此品項則整批禁止領用
const SUPPLY_DEPTS = ['清潔', '客服', '護理'];
const SUPPLY_PURPOSES = ['販售', '住房', '護理', '贈送', '尿布', '其他'];
app.post('/api/supply-txns/out-batch', requireStaff, (req, res) => {
  const b = req.body || {};
  if (!SUPPLY_DEPTS.includes(b.dept)) return res.status(400).json({ error: '請選擇領取單位（清潔／客服／護理）' });
  if (!SUPPLY_PURPOSES.includes(b.purpose)) return res.status(400).json({ error: '請選擇領取用途' });
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: '請至少選擇一項備品' });
  // 逐項檢查：品項存在、數量正確、庫存足夠、同品項不重複
  const seen = new Set();
  const rows = [];
  for (const it of items) {
    const cur = db.prepare('SELECT * FROM supplies WHERE id = ?').get(Number(it.supply_id) || 0);
    if (!cur) return res.status(400).json({ error: '有品項不存在，請重新選擇' });
    if (seen.has(cur.id)) return res.status(400).json({ error: `「${cur.name}」重複選取，請合併數量` });
    seen.add(cur.id);
    const qty = Math.round(Number(it.quantity));
    if (!(qty > 0)) return res.status(400).json({ error: `「${cur.name}」數量不正確` });
    if (cur.stock < qty) return res.status(400).json({ error: `「${cur.name}」庫存不足（剩 ${cur.stock}）` });
    rows.push({ cur, qty });
  }
  // 販售：每一品項須有商城同名商品，否則禁止領用
  let productOf = {};
  if (b.purpose === '販售') {
    const missing = [];
    for (const { cur } of rows) {
      const p = db.prepare('SELECT * FROM products WHERE name = ? ORDER BY active DESC, id DESC').get(cur.name);
      if (!p) missing.push(cur.name);
      else productOf[cur.id] = p;
    }
    if (missing.length) {
      return res.status(400).json({ error: `禁止領用：商城尚無商品「${missing.join('、')}」，請先於商城建立同名商品再領用（販售）` });
    }
  }
  const note = String(b.note || '').slice(0, 200);
  const tx = db.transaction(() => {
    for (const { cur, qty } of rows) {
      const balance = cur.stock - qty;
      db.prepare('UPDATE supplies SET stock = ? WHERE id = ?').run(balance, cur.id);
      db.prepare(`INSERT INTO supply_txns (supply_id, txn_type, quantity, balance_after, note, created_by, dept, purpose)
        VALUES (?,?,?,?,?,?,?,?)`).run(cur.id, 'out', qty, balance, note, req.session.user.id, b.dept, b.purpose);
      const p = productOf[cur.id];
      if (p) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(qty, p.id); // 販售：匯入商城庫存
    }
  });
  tx();
  logAudit(req, { action: 'create', entity: 'supply_txns', summary: `領取出庫（${b.dept}／${b.purpose}）${rows.map(r => `${r.cur.name}×${r.qty}`).join('、')}` });
  res.json({ ok: true, count: rows.length });
});

// ---------- 課程／服務與報名 ----------
// 外部協力廠商帳號（users.service_scope 有值）：只能閱覽／新增該名稱的加購服務
const svcScope = req => (req.session.user && req.session.user.service_scope) || '';
app.get('/api/programs', requireStaff, (req, res) => {
  const scope = svcScope(req);
  if (scope) {
    return res.json(db.prepare(`SELECT * FROM programs WHERE kind = 'service' AND name = ?
      ORDER BY active DESC, scheduled_at, id DESC`).all(scope));
  }
  res.json(db.prepare('SELECT * FROM programs ORDER BY active DESC, kind, scheduled_at, id DESC').all());
});
app.post('/api/programs', requireStaff, (req, res) => {
  const scope = svcScope(req);
  if (req.session.user.role !== 'admin' && !scope) return res.status(403).json({ error: '需要管理員權限' });
  const p = req.body || {};
  // 廠商帳號：一律建立自己服務名稱的加購服務
  if (scope) { p.kind = 'service'; p.name = scope; }
  if (!p.name) return res.status(400).json({ error: '名稱必填' });
  const info = db.prepare(`INSERT INTO programs
    (kind, name, category, price, capacity, scheduled_at, location, description, active, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    p.kind === 'service' ? 'service' : 'course', p.name, p.category || '',
    Math.round(Number(p.price) || 0), Math.round(Number(p.capacity) || 0),
    p.scheduled_at || '', p.location || '', p.description || '',
    p.active === undefined ? 1 : (p.active ? 1 : 0), req.session.user.id);
  logAudit(req, { action: 'create', entity: 'program', entity_id: info.lastInsertRowid, summary: p.name + (scope ? '（廠商登記）' : '') });
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
// 課程照片：存 uploads/programs/年月日課程名稱/（資料夾以課程排定日＋名稱建檔）
function programPhotoDir(prog) {
  const d = /^\d{4}-\d{2}-\d{2}/.test(prog.scheduled_at || '') ? prog.scheduled_at.slice(0, 10) : today();
  const folder = (d.replace(/-/g, '') + prog.name).replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 80);
  return { rel: 'programs/' + folder, abs: path.join(UPLOAD_DIR, 'programs', folder) };
}
const programPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const prog = db.prepare('SELECT * FROM programs WHERE id = ?').get(req.params.id);
      if (!prog) return cb(new Error('找不到課程／服務'));
      const dir = programPhotoDir(prog);
      fs.mkdirSync(dir.abs, { recursive: true });
      req._progPhotoRel = dir.rel;
      cb(null, dir.abs);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 10);
      cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});
app.post('/api/programs/:id/photos', requireStaff, programPhotoUpload.array('photos', 10), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '請選擇圖片檔（10MB 內）' });
  const ins = db.prepare('INSERT INTO program_photos (program_id, file, created_by) VALUES (?,?,?)');
  const saved = files.map(f => {
    const rel = `${req._progPhotoRel}/${f.filename}`;
    return { id: ins.run(req.params.id, rel, req.session.user.id).lastInsertRowid, file: rel };
  });
  logAudit(req, { action: 'create', entity: 'program_photos', entity_id: req.params.id, summary: `課程照片上傳 ${saved.length} 張` });
  res.json({ ok: true, photos: saved });
});
app.get('/api/programs/:id/photos', requireStaff, (req, res) => {
  res.json(db.prepare(`SELECT pp.*, u.name AS staff_name FROM program_photos pp
    LEFT JOIN users u ON u.id = pp.created_by WHERE pp.program_id = ? ORDER BY pp.id DESC`).all(req.params.id));
});
app.delete('/api/program-photos/:id', requireStaff, (req, res) => {
  const row = db.prepare('SELECT * FROM program_photos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到照片' });
  db.prepare('DELETE FROM program_photos WHERE id = ?').run(row.id);
  // 檔名經過清洗（僅 programs/資料夾/檔名），仍以 resolve 檢查防路徑穿越
  const abs = path.resolve(UPLOAD_DIR, row.file);
  if (abs.startsWith(path.resolve(UPLOAD_DIR, 'programs'))) fs.unlink(abs, () => {});
  res.json({ ok: true });
});

// 已確認報名人數
function programConfirmedCount(pid) {
  return db.prepare("SELECT COALESCE(SUM(quantity),0) c FROM program_signups WHERE program_id = ? AND status = 'confirmed'").get(pid).c;
}
function loadSignup(s) { return s; }
app.get('/api/signups', requireStaff, (req, res) => {
  const status = req.query.status;
  const conds = [], args = [];
  if (status) { conds.push('s.status = ?'); args.push(status); }
  // 廠商帳號只看得到自己服務名稱的報名
  const scope = svcScope(req);
  if (scope) { conds.push("p.kind = 'service' AND p.name = ?"); args.push(scope); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
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
  // 廠商帳號只能為自己服務名稱的項目建立報名
  const scope = svcScope(req);
  if (scope) {
    const prog = b.program_id ? db.prepare('SELECT kind, name FROM programs WHERE id = ?').get(b.program_id) : null;
    if (!prog || prog.kind !== 'service' || prog.name !== scope) return res.status(403).json({ error: '僅能登記自己服務的報名' });
  }
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
  if (svcScope(req)) return res.status(403).json({ error: '廠商帳號無法確認報名（涉及入帳）' });
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
  if (svcScope(req)) return res.status(403).json({ error: '廠商帳號無法取消報名，請聯繫館方' });
  const s = db.prepare('SELECT * FROM program_signups WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '找不到報名' });
  if (s.status !== 'pending') return res.status(400).json({ error: '已處理過，無法取消' });
  db.prepare("UPDATE program_signups SET status='cancelled', confirmed_by=?, confirmed_at=datetime('now','localtime') WHERE id=?")
    .run(req.session.user.id, s.id);
  res.json({ ok: true });
});
// 家屬端：課程瀏覽與報名（僅開放課程；加購服務由護理站指定媽媽建立）
app.get('/api/family/programs', requireFamily, (req, res) => {
  const rows = db.prepare("SELECT * FROM programs WHERE active = 1 AND kind = 'course' ORDER BY scheduled_at, id DESC").all();
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
  // 只開放媽媽本人預約課程
  if ((fam.relation || '').trim() !== '媽媽') {
    return res.status(403).json({ error: '課程僅開放媽媽本人預約，請由媽媽的帳號報名' });
  }
  const b = req.body || {};
  const prog = db.prepare('SELECT kind FROM programs WHERE id = ?').get(Number(b.program_id) || 0);
  if (prog && prog.kind !== 'course') return res.status(400).json({ error: '加購服務請洽護理站登記' });
  const bk = activeBookingForMother(mid);
  try {
    const id = createSignup({ program_id: b.program_id, mother_id: mid, booking_id: bk ? bk.id : null,
      family_id: fam.id, placed_by: 'family', quantity: b.quantity, preferred_at: b.preferred_at, note: b.note });
    logAudit(req, { action: 'create', entity: 'signup', entity_id: id, summary: `家屬報名:${fam.name}` });
    res.json({ id, message: '已送出報名，將由護理站確認' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/family/signups', requireFamily, (req, res) => {
  // 同一位媽媽的報名（含護理站指定的加購服務）家屬共同可見
  const mid = familyMotherId(req.session.family);
  res.json(db.prepare(`SELECT s.*, p.name AS program_name, p.kind, p.scheduled_at
    FROM program_signups s JOIN programs p ON p.id = s.program_id
    WHERE s.family_id = ? OR (s.mother_id IS NOT NULL AND s.mother_id = ?)
    ORDER BY s.created_at DESC`).all(req.session.family.id, mid || -1));
});

// ---------- 家屬端：訪客預約（登記／查詢／取消，同一位媽媽的家屬共同可見） ----------
// 探訪規則：整點時段 13~18 點、各樓層每小時限 2 組、每組限 4 人、
// 每週（週一至週日）限預約 2 次、隔日預約須於前一日 19:00 前完成
const VISIT_HOURS = ['13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const VISIT_WEEKLY_MAX = 2;
const VISIT_FLOOR_HOURLY_MAX = 2;
const VISIT_HEADCOUNT_MAX = 4;

// 媽媽於指定日期所住樓層（取房號首碼；無訂房回空字串）
function motherFloorOnDate(motherId, date) {
  const bk = db.prepare(`SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
    WHERE bk.mother_id = ? AND bk.status IN ('reserved','checked_in') AND bk.check_in <= ? AND bk.check_out >= ?
    ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1`).get(motherId, date, date);
  return bk ? String(bk.name).trim().charAt(0) : '';
}

// 該日期所屬「週一～週日」區間
function visitWeekRange(date) {
  const d = new Date(date + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 週一=0
  const mon = new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
  const sun = new Date(d.getTime() + (6 - dow) * 86400000).toISOString().slice(0, 10);
  return [mon, sun];
}

// 同樓層該日該整點已預約組數（排除已取消；excludeId 供改期用）
function floorGroupsAt(floor, date, hhmm) {
  if (!floor) return 0;
  const rows = db.prepare(`SELECT mother_id FROM visitor_reservations
    WHERE substr(visit_at,1,10) = ? AND substr(visit_at,12,5) = ? AND status != 'cancelled'`).all(date, hhmm);
  return rows.filter(r => motherFloorOnDate(r.mother_id, date) === floor).length;
}

// 該媽媽於該週已預約次數（排除已取消）
function motherWeeklyVisits(motherId, date) {
  const [mon, sun] = visitWeekRange(date);
  return db.prepare(`SELECT COUNT(*) c FROM visitor_reservations
    WHERE mother_id = ? AND status != 'cancelled' AND substr(visit_at,1,10) BETWEEN ? AND ?`)
    .get(motherId, mon, sun).c;
}

// 日期是否可受理預約：至少隔日，且隔日預約須於前一日 19:00 前完成
function visitDateError(date) {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  const todayD = now.toISOString().slice(0, 10);
  const nowHM = now.toISOString().slice(11, 16);
  const minDate = new Date(new Date(todayD + 'T00:00:00Z').getTime() + (nowHM >= '19:00' ? 2 : 1) * 86400000)
    .toISOString().slice(0, 10);
  if (date <= todayD) return '恕不接受當日（含過期）預約，請預約隔日以後';
  if (date < minDate) return '隔日預約請於每日晚間 19:00 前完成，此時段已截止';
  return '';
}

// 查詢某日可預約空檔（供家屬端日期選擇後帶出）
app.get('/api/family/visitor-slots', requireFamily, (req, res) => {
  const mid = familyMotherId(req.session.family);
  if (!mid) return res.status(400).json({ error: '找不到寶寶資料' });
  const date = String(req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式錯誤' });
  const dateErr = visitDateError(date);
  const quotaUsed = motherWeeklyVisits(mid, date);
  const floor = motherFloorOnDate(mid, date);
  const slots = VISIT_HOURS.map(t => {
    const used = floorGroupsAt(floor, date, t);
    return { time: t, available: !dateErr && quotaUsed < VISIT_WEEKLY_MAX && used < VISIT_FLOOR_HOURLY_MAX, left: Math.max(0, VISIT_FLOOR_HOURLY_MAX - used) };
  });
  res.json({
    date, floor: floor ? `${floor}F` : '', slots,
    quota_used: quotaUsed, quota_max: VISIT_WEEKLY_MAX,
    closed_reason: dateErr || (quotaUsed >= VISIT_WEEKLY_MAX ? `本週（週一至週日）已預約 ${quotaUsed} 次，達每週 ${VISIT_WEEKLY_MAX} 次上限` : '')
  });
});

// 員工端：查詢某媽媽某日可預約空檔（護理站代客登記用；顯示額滿與每週次數供參考）
app.get('/api/visitor-slots', requireStaff, (req, res) => {
  const mid = Number(req.query.mother_id) || 0;
  const date = String(req.query.date || '').trim();
  if (!mid) return res.status(400).json({ error: '請先選擇媽媽' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式錯誤' });
  const floor = motherFloorOnDate(mid, date);
  const quotaUsed = motherWeeklyVisits(mid, date);
  const slots = VISIT_HOURS.map(t => {
    const used = floorGroupsAt(floor, date, t);
    return { time: t, available: used < VISIT_FLOOR_HOURLY_MAX, left: Math.max(0, VISIT_FLOOR_HOURLY_MAX - used) };
  });
  res.json({ date, floor: floor ? `${floor}F` : '', slots, quota_used: quotaUsed, quota_max: VISIT_WEEKLY_MAX });
});

app.get('/api/family/visitor-reservations', requireFamily, (req, res) => {
  const mid = familyMotherId(req.session.family);
  if (!mid) return res.json([]);
  res.json(db.prepare(`SELECT id, visitor_name, relation, phone, headcount, visit_at, status, note, created_at
    FROM visitor_reservations WHERE mother_id = ?
    ORDER BY visit_at DESC, id DESC LIMIT 100`).all(mid));
});

app.post('/api/family/visitor-reservations', requireFamily, (req, res) => {
  const fam = req.session.family;
  const mid = familyMotherId(fam);
  if (!mid) return res.status(400).json({ error: '找不到寶寶資料' });
  const b = req.body || {};
  const name = String(b.visitor_name || '').trim();
  if (!name) return res.status(400).json({ error: '訪客姓名必填' });
  if (!b.agree) return res.status(400).json({ error: '請先詳細閱讀並同意訪客規範' });
  if (!validVisitAt(b.visit_at) || !/ \d{2}:\d{2}$/.test(b.visit_at)) {
    return res.status(400).json({ error: '探訪時間格式應為 YYYY-MM-DD HH:MM' });
  }
  const visitAt = b.visit_at.trim();
  const [vDate, vTime] = [visitAt.slice(0, 10), visitAt.slice(11, 16)];
  if (!VISIT_HOURS.includes(vTime)) return res.status(400).json({ error: `探訪時間請以整點預約（${VISIT_HOURS[0]}～${VISIT_HOURS[VISIT_HOURS.length - 1]}）` });
  const dateErr = visitDateError(vDate);
  if (dateErr) return res.status(400).json({ error: dateErr });
  if (motherWeeklyVisits(mid, vDate) >= VISIT_WEEKLY_MAX) {
    return res.status(400).json({ error: `每週（週一至週日）限預約 ${VISIT_WEEKLY_MAX} 次，本週已達上限` });
  }
  const floor = motherFloorOnDate(mid, vDate);
  if (floorGroupsAt(floor, vDate, vTime) >= VISIT_FLOOR_HOURLY_MAX) {
    return res.status(400).json({ error: '此時段該樓層已額滿（每小時限兩組），請改選其他時段' });
  }
  const headcount = Math.min(Math.max(parseInt(b.headcount, 10) || 1, 1), VISIT_HEADCOUNT_MAX);
  const info = db.prepare(`INSERT INTO visitor_reservations
    (mother_id, family_id, visitor_name, relation, phone, headcount, visit_at, note)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    mid, fam.id, name.slice(0, 100), String(b.relation || '').slice(0, 20),
    String(b.phone || '').slice(0, 20), headcount, visitAt, String(b.note || '').slice(0, 200));
  logAudit(req, { action: 'create', entity: 'visitor_reservation', entity_id: info.lastInsertRowid, summary: `家屬登記訪客:${fam.name}→${name}` });
  res.json({ id: info.lastInsertRowid, message: '已送出訪客預約，探訪當日請攜帶證件至 1 樓核實身分換證' });
});

app.post('/api/family/visitor-reservations/:id/cancel', requireFamily, (req, res) => {
  const mid = familyMotherId(req.session.family);
  const cur = db.prepare('SELECT * FROM visitor_reservations WHERE id = ?').get(req.params.id);
  if (!cur || cur.mother_id !== mid) return res.status(404).json({ error: '找不到資料' });
  if (cur.status !== 'booked') return res.status(400).json({ error: '此筆預約已報到或已取消' });
  db.prepare(`UPDATE visitor_reservations SET status = 'cancelled' WHERE id = ?`).run(cur.id);
  logAudit(req, { action: 'update', entity: 'visitor_reservation', entity_id: cur.id, summary: `家屬取消訪客預約:${cur.visitor_name}` });
  res.json({ ok: true });
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
  const kw = String(req.query.keyword || '').trim();
  const status = ['reserved', 'checked_in', 'checked_out', 'cancelled'].includes(req.query.status) ? req.query.status : '';
  const cond = [], args = [];
  if (kw) { cond.push('(name LIKE ? OR member_no LIKE ? OR phone LIKE ?)'); args.push('%' + kw + '%', '%' + kw + '%', '%' + kw + '%'); }
  if (status) { cond.push('status = ?'); args.push(status); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const cols = 'SELECT id, name, phone, member_no, points, status FROM mothers';
  const pg = pageParams(req);
  if (pg.enabled) {
    const total = db.prepare(`SELECT COUNT(*) c FROM mothers ${where}`).get(...args).c;
    const rows = db.prepare(`${cols} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, pg.pageSize, pg.offset);
    return res.json({ rows, total, page: pg.page, pageSize: pg.pageSize });
  }
  res.json(db.prepare(`${cols} ${where} ORDER BY id DESC`).all(...args));
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
  // 出住日當天仍供早餐：check_out >= date 保留當日出住者；轉房日（前段出住＝後段入住）優先取仍在住的段
  const mothers = db.prepare(`
    SELECT m.id, m.name, m.diet_notes, m.meal_diet, m.delivery_date, m.delivery_type,
           r.name AS room_name, bk.check_in, bk.check_out
    FROM mothers m
    JOIN bookings bk ON bk.id = (
      SELECT bk2.id FROM bookings bk2
      WHERE bk2.mother_id = m.id AND bk2.status != 'cancelled'
        AND bk2.check_in <= ? AND bk2.check_out >= ?
      ORDER BY (bk2.check_out > ?) DESC, bk2.check_in DESC LIMIT 1)
    JOIN rooms r ON r.id = bk.room_id
    ORDER BY r.name`).all(date, date, date);
  for (const mo of mothers) mo.checkout_today = mo.check_out === date;
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
  const status = ['preparing', 'served', 'cancelled'].includes(o.status) ? o.status : 'preparing';
  db.prepare(`INSERT INTO meal_orders (mother_id, meal_date, meal_type, choice, note, status)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(mother_id, meal_date, meal_type) DO UPDATE SET choice = excluded.choice, note = excluded.note, status = excluded.status`)
    .run(o.mother_id, o.meal_date, o.meal_type, o.choice, o.note || '', status);
  // 自動帶入未來日期：同餐別往後鋪到「出住日早餐」為止（僅更新餐點，不覆蓋既有備註）
  let filled = 0;
  if (o.propagate) {
    const bk = db.prepare(`SELECT check_in, check_out FROM bookings
      WHERE mother_id = ? AND status != 'cancelled' AND check_in <= ? AND check_out >= ?
      ORDER BY status = 'checked_in' DESC, check_in DESC LIMIT 1`).get(o.mother_id, o.meal_date, o.meal_date);
    if (bk) {
      const up = db.prepare(`INSERT INTO meal_orders (mother_id, meal_date, meal_type, choice, note, status)
        VALUES (?,?,?,?, '', 'preparing')
        ON CONFLICT(mother_id, meal_date, meal_type) DO UPDATE SET choice = excluded.choice`);
      const endD = new Date(bk.check_out + 'T00:00:00Z');
      let dd = new Date(o.meal_date + 'T00:00:00Z');
      dd = new Date(dd.getTime() + 86400000);   // 從隔天開始
      for (let i = 0; dd <= endD && i < 400; i++, dd = new Date(dd.getTime() + 86400000)) {
        const ds = dd.toISOString().slice(0, 10);
        if (ds === bk.check_out && o.meal_type !== 'breakfast') continue;   // 出住日僅供早餐
        up.run(o.mother_id, ds, o.meal_type, o.choice);
        filled++;
      }
    }
  }
  res.json({ ok: true, filled });
});

// 僅更新訂餐狀態／備註（不改餐點選擇）
app.post('/api/meals/status', requireStaff, (req, res) => {
  const o = req.body || {};
  if (!o.mother_id || !o.meal_date || !['breakfast', 'lunch', 'dinner'].includes(o.meal_type)) {
    return res.status(400).json({ error: '媽媽、日期與餐別必填' });
  }
  const cur = db.prepare('SELECT * FROM meal_orders WHERE mother_id=? AND meal_date=? AND meal_type=?')
    .get(o.mother_id, o.meal_date, o.meal_type);
  if (!cur) return res.status(404).json({ error: '此餐尚未訂餐' });
  const status = ['preparing', 'served', 'cancelled'].includes(o.status) ? o.status : cur.status;
  db.prepare('UPDATE meal_orders SET status=?, note=? WHERE id=?')
    .run(status, o.note !== undefined ? o.note : cur.note, cur.id);
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

// 換餐最早可開始日：每日 14:00 前申請可自「次日」早餐起，之後自「後天」早餐起
function mealSwapMinStart() {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  const days = now.getUTCHours() < 14 ? 1 : 2;
  return new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
}
// 家屬端：查看自己媽媽月子餐（廠商當周菜單＋換餐資訊）
app.get('/api/family/meal-plan', requireFamily, (req, res) => {
  const date = req.query.date || today();
  const mid = familyMotherId(req.session.family);
  const m = mid ? db.prepare('SELECT id, name, delivery_date, meal_diet, diet_notes FROM mothers WHERE id = ?').get(mid) : null;
  if (!m) return res.json({ date, available: false });
  const bk = db.prepare(`SELECT check_in, check_out FROM bookings WHERE mother_id = ? AND status != 'cancelled'
    AND check_in <= ? AND check_out > ? ORDER BY check_in DESC`).get(mid, date, date);
  const cfg = mealConfig();
  const stage = motherStage({ ...m, check_in: bk ? bk.check_in : '' }, date, cfg.stages);
  const diet = m.meal_diet || (cfg.diets[0] || '一般');
  const menus = db.prepare('SELECT * FROM meal_menu WHERE menu_date = ?').all(date);
  const slots = cfg.slots.map(slot => ({ slot, menu: pickMenu(menus.filter(x => x.slot === slot), stage.name, diet) }));
  // 餐別（目前配合的月子餐廠商）＝最近一次訂餐選項
  const curOrder = db.prepare(`SELECT choice FROM meal_orders WHERE mother_id = ? AND meal_date <= ?
    AND choice != '' AND choice != '不需供餐' ORDER BY meal_date DESC, id DESC LIMIT 1`).get(mid, date);
  // 飲食注意：客戶管理合約「飲食禁忌」＋住客資料飲食禁忌
  const contract = getCustomerContract(mid);
  const dietNotes = [...new Set([((contract || {}).data || {}).diet_ban, m.diet_notes].filter(Boolean))].join('、');
  // 各廠商「當周」菜單檔案（周日開始）：取該廠商 week_start <= 查詢日的最新一份
  const choices = String(getSettings().meal_choices || '').split(',').map(s => s.trim())
    .filter(c => c && c !== '不需供餐');
  const menuFiles = db.prepare(`SELECT id, week_start, vendor, file, orig_name FROM meal_menu_files
    WHERE week_start <= ? ORDER BY week_start DESC, id DESC`).all(date);
  const menu_files = choices.map(v => ({ vendor: v, file: menuFiles.find(f => f.vendor === v) || null }));
  const generalFile = menuFiles.find(f => !f.vendor) || null; // 未標廠商的菜單
  // 換餐限制：7 天內限一次（pending/approved 都算）
  const lastSwap = db.prepare(`SELECT created_at FROM meal_swap_requests
    WHERE mother_id = ? AND status IN ('pending','approved')
    AND created_at >= datetime('now','localtime','-7 day') ORDER BY id DESC LIMIT 1`).get(mid);
  res.json({ date, available: true, mother_name: m.name, postpartum_day: stage.day, stage: stage.name, diet, slots,
    current_choice: curOrder ? curOrder.choice : '', diet_notes: dietNotes,
    check_out: bk ? bk.check_out : '', choices, menu_files, general_menu_file: generalFile,
    swap_min_start: mealSwapMinStart(), swap_locked: !!lastSwap,
    swap_last_at: lastSwap ? lastSwap.created_at : '' });
});

// 月子餐「我要換餐」：家屬線上申請（更換月子餐廠商，自開始日早餐起至出住日）/ 查詢
app.post('/api/family/meal-swap', requireFamily, (req, res) => {
  const mid = familyMotherId(req.session.family);
  if (!mid) return res.status(400).json({ error: '找不到寶寶／媽媽資料' });
  const b = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.meal_date || '')) return res.status(400).json({ error: '請選擇換餐開始日期' });
  const to = String(b.to_choice || '').trim();
  const choices = String(getSettings().meal_choices || '').split(',').map(s => s.trim())
    .filter(c => c && c !== '不需供餐');
  if (!choices.includes(to)) return res.status(400).json({ error: '請選擇要更換的月子餐廠商' });
  const minStart = mealSwapMinStart();
  if (b.meal_date < minStart) {
    return res.status(400).json({ error: `每日 14:00 前申請可自次日早餐起、之後自後天早餐起，最早可選 ${minStart}` });
  }
  const bkRow = db.prepare(`SELECT check_out FROM bookings WHERE mother_id = ? AND status IN ('checked_in','reserved')
    AND check_out >= ? ORDER BY status = 'checked_in' DESC, check_in DESC LIMIT 1`).get(mid, b.meal_date);
  if (!bkRow) return res.status(400).json({ error: '該日已超出住宿期間' });
  if (b.meal_date > bkRow.check_out) return res.status(400).json({ error: '換餐開始日不可晚於出住日' });
  // 7 天內限換餐一次（送出過且未被婉拒者）
  const recent = db.prepare(`SELECT 1 FROM meal_swap_requests
    WHERE mother_id = ? AND status IN ('pending','approved')
    AND created_at >= datetime('now','localtime','-7 day') LIMIT 1`).get(mid);
  if (recent) return res.status(400).json({ error: '7 天內僅能申請換餐一次，如需再次調整請聯絡客服（聯絡護理站）' });
  const info = db.prepare(`INSERT INTO meal_swap_requests (mother_id, family_id, meal_date, slot, from_choice, to_choice, reason)
    VALUES (?,?,?,?,?,?,?)`).run(mid, req.session.family.id, b.meal_date, '早餐起',
    String(b.from_choice || '').slice(0, 60), to.slice(0, 60), String(b.reason || '').slice(0, 200));
  res.json({ id: info.lastInsertRowid });
});
app.get('/api/family/meal-swap', requireFamily, (req, res) => {
  res.json(db.prepare('SELECT * FROM meal_swap_requests WHERE family_id = ? ORDER BY id DESC LIMIT 50').all(req.session.family.id));
});

// 家屬「聯絡清潔」：送出清潔申請 → 直接建立房務任務（房務清潔頁與看板待辦即可看到）
const FAMILY_HK_TASKS = ['清潔地板', '更換床單', '馬桶', '浴室', '倒垃圾', '補充備品', '紫外線消毒', '清潔拖鞋', '清潔玻璃', '其他'];
app.post('/api/family/cleaning-request', requireFamily, (req, res) => {
  const mid = familyMotherId(req.session.family);
  if (!mid) return res.status(400).json({ error: '找不到住客資料' });
  const b = req.body || {};
  let task = String(b.task || '').trim();
  if (!FAMILY_HK_TASKS.includes(task)) return res.status(400).json({ error: '請選擇清潔任務' });
  if (task === '其他') {
    const t = String(b.task_other || '').trim();
    if (!t) return res.status(400).json({ error: '任務選「其他」時請說明內容' });
    task = t.slice(0, 100);
  }
  const bk = db.prepare(`SELECT room_id FROM bookings WHERE mother_id = ? AND status = 'checked_in'
    ORDER BY check_in DESC LIMIT 1`).get(mid);
  let date = /^\d{4}-\d{2}-\d{2}$/.test(b.scheduled_for || '') ? b.scheduled_for : today();
  if (date < today()) date = today();
  const note = ['家屬申請', String(b.note || '').trim()].filter(Boolean).join('：').slice(0, 200);
  const info = db.prepare(`INSERT INTO housekeeping_logs (room_id, mother_id, task, scheduled_for, note)
    VALUES (?,?,?,?,?)`).run(bk ? bk.room_id : null, mid, task, date, note);
  res.json({ id: info.lastInsertRowid });
});

// 月子餐換餐申請：員工端審核
app.get('/api/meal-swaps', requireStaff, (req, res) => {
  const status = req.query.status;
  const where = ['pending', 'approved', 'rejected'].includes(status) ? 'WHERE msr.status = ?' : '';
  const args = where ? [status] : [];
  res.json(db.prepare(`SELECT msr.*, m.name AS mother_name, f.name AS family_name, u.name AS handled_by_name
    FROM meal_swap_requests msr
    JOIN mothers m ON m.id = msr.mother_id
    LEFT JOIN family_members f ON f.id = msr.family_id
    LEFT JOIN users u ON u.id = msr.handled_by
    ${where} ORDER BY (msr.status = 'pending') DESC, msr.id DESC LIMIT 200`).all(...args));
});
app.post('/api/meal-swaps/:id/handle', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM meal_swap_requests WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到換餐申請' });
  const action = (req.body || {}).action;
  if (!['approved', 'rejected'].includes(action)) return res.status(400).json({ error: '動作不正確' });
  db.prepare('UPDATE meal_swap_requests SET status = ?, handled_by = ?, handled_at = ?, staff_note = ? WHERE id = ?')
    .run(action, req.session.user.id, new Date().toLocaleString('sv-SE').slice(0, 19), String((req.body || {}).staff_note || '').slice(0, 200), cur.id);
  // 核准（完成）時自動套入訂餐：
  // slot=早餐起（換廠商）→ 自開始日早餐起至出住日早餐，逐日改為新廠商；
  // 舊格式（早餐/午餐/晚餐單餐）→ 僅套該日該餐
  let applied = false;
  if (action === 'approved') {
    if (String(cur.slot || '').trim() === '早餐起') {
      const choices = String(getSettings().meal_choices || '').split(',').map(s => s.trim()).filter(Boolean);
      const bkRow = db.prepare(`SELECT check_out FROM bookings WHERE mother_id = ? AND status IN ('checked_in','reserved')
        AND check_out >= ? ORDER BY status = 'checked_in' DESC, check_in DESC LIMIT 1`).get(cur.mother_id, cur.meal_date);
      if (bkRow && choices.includes(String(cur.to_choice || '').trim())) {
        const upsert = db.prepare(`INSERT INTO meal_orders (mother_id, meal_date, meal_type, choice, note, status)
          VALUES (?,?,?,?,?,'preparing')
          ON CONFLICT(mother_id, meal_date, meal_type) DO UPDATE SET choice = excluded.choice, note = excluded.note`);
        const note = `換餐${cur.reason ? `（${cur.reason}）` : ''}`.slice(0, 200);
        let d = new Date(cur.meal_date);
        const end = new Date(bkRow.check_out);
        for (let i = 0; d <= end && i < 120; i++, d = new Date(d.getTime() + 86400000)) {
          const ds = d.toISOString().slice(0, 10);
          // 供餐至出住日早餐止：出住日僅早餐
          const meals = ds === bkRow.check_out ? ['breakfast'] : ['breakfast', 'lunch', 'dinner'];
          for (const mt of meals) upsert.run(cur.mother_id, ds, mt, cur.to_choice.trim(), note);
        }
        applied = true;
      }
    }
    const mealType = { '早餐': 'breakfast', '午餐': 'lunch', '晚餐': 'dinner' }[String(cur.slot || '').trim()];
    if (mealType) {
      const choices = String(getSettings().meal_choices || '').split(',').map(s => s.trim()).filter(Boolean);
      const swapNote = `換餐：${cur.to_choice || ''}${cur.reason ? `（${cur.reason}）` : ''}`.slice(0, 200);
      const order = db.prepare('SELECT * FROM meal_orders WHERE mother_id = ? AND meal_date = ? AND meal_type = ?')
        .get(cur.mother_id, cur.meal_date, mealType);
      if (choices.includes(String(cur.to_choice || '').trim())) {
        db.prepare(`INSERT INTO meal_orders (mother_id, meal_date, meal_type, choice, note, status)
          VALUES (?,?,?,?,?,'preparing')
          ON CONFLICT(mother_id, meal_date, meal_type) DO UPDATE SET choice = excluded.choice, note = excluded.note`)
          .run(cur.mother_id, cur.meal_date, mealType, cur.to_choice.trim(),
            cur.reason ? `換餐（${cur.reason}）`.slice(0, 200) : '換餐');
        applied = true;
      } else if (order) {
        db.prepare('UPDATE meal_orders SET note = ? WHERE id = ?')
          .run([order.note, swapNote].filter(Boolean).join('；').slice(0, 200), order.id);
        applied = true;
      }
    }
    logAudit(req, { action: 'update', entity: 'meal_swap_requests', entity_id: cur.id,
      summary: `換餐申請完成${applied ? '（已套入 ' + cur.meal_date + ' 訂餐）' : ''}` });
  }
  res.json({ ok: true, applied });
});

// ---------- 月子餐菜單檔案（週菜單 PDF／圖片上傳；菜單以周為單位、周日開始） ----------
app.get('/api/meal-menu-files', requireStaff, (req, res) => {
  res.json(db.prepare(`SELECT f.*, u.name AS uploaded_by_name FROM meal_menu_files f
    LEFT JOIN users u ON u.id = f.uploaded_by
    ORDER BY f.week_start DESC, f.id DESC LIMIT 100`).all());
});
app.post('/api/meal-menu-files', requireStaff, docUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請選擇檔案' });
  if (!/^(image\/|application\/pdf)/.test(req.file.mimetype)) {
    removeUploadFile(req.file.filename);
    return res.status(400).json({ error: '僅接受 PDF 或圖片檔（jpg/png）' });
  }
  const week = /^\d{4}-\d{2}-\d{2}$/.test(req.body.week_start || '') ? req.body.week_start : '';
  const vendor = String(req.body.vendor || '').trim().slice(0, 60);
  const info = db.prepare(`INSERT INTO meal_menu_files (week_start, vendor, file, orig_name, note, uploaded_by)
    VALUES (?,?,?,?,?,?)`).run(week, vendor, req.file.filename,
    String(req.file.originalname || '').slice(0, 200), String(req.body.note || '').slice(0, 200), req.session.user.id);
  logAudit(req, { action: 'create', entity: 'meal_menu_files', entity_id: info.lastInsertRowid, summary: `菜單上傳 ${vendor} ${week || ''}` });
  res.json({ id: info.lastInsertRowid, file: req.file.filename });
});
app.delete('/api/meal-menu-files/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM meal_menu_files WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到檔案' });
  db.prepare('DELETE FROM meal_menu_files WHERE id = ?').run(cur.id);
  removeUploadFile(cur.file);
  logAudit(req, { action: 'delete', entity: 'meal_menu_files', entity_id: cur.id, summary: '刪除菜單檔案' });
  res.json({ ok: true });
});

// ---------- 參觀預約（潛在客戶追蹤） ----------
// 支援伺服器端篩選（field 日期欄位 tour/due/reg + from/to、name、phone、status、only_cancelled）與分頁（帶 page）
app.get('/api/tours', requireStaff, (req, res) => {
  const field = { tour: 'date(t.tour_at)', due: 't.due_date', reg: 'date(t.created_at)' }[req.query.field] || null;
  const from = String(req.query.from || ''), to = String(req.query.to || '');
  const name = String(req.query.name || '').trim(), phone = String(req.query.phone || '').trim();
  const status = ['scheduled', 'visited', 'signed', 'lost'].includes(req.query.status) ? req.query.status : '';
  const cond = [], args = [];
  if (field && /^\d{4}-\d{2}-\d{2}$/.test(from)) { cond.push(`${field} >= ?`); args.push(from); }
  if (field && /^\d{4}-\d{2}-\d{2}$/.test(to)) { cond.push(`${field} <= ?`); args.push(to); }
  if (name) { cond.push('t.name LIKE ?'); args.push('%' + name + '%'); }
  if (phone) { cond.push('t.phone LIKE ?'); args.push('%' + phone + '%'); }
  if (status) { cond.push('t.status = ?'); args.push(status); }
  if (req.query.only_cancelled === '1') cond.push("t.cancel_at != ''");
  // LINE 待確認預約（用戶自官賴送出、員工尚未確認）
  if (req.query.pending === '1') cond.push("t.confirm_status = 'pending' AND t.status = 'scheduled'");
  // 排除條件（潛在客戶查詢）：未參觀＝已取消；未成交＝status lost（含取消）
  if (req.query.exclude_cancelled === '1') cond.push("(t.cancel_at IS NULL OR t.cancel_at = '')");
  if (req.query.exclude_lost === '1') cond.push("t.status != 'lost'");
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const cols = `SELECT t.*,
      uc.name AS created_by_name, ux.name AS cancel_by_name,
      cm.name AS customer_name, cm.status AS customer_status,
      (SELECT COUNT(*) FROM tour_logs l WHERE l.tour_id = t.id) AS log_count,
      (SELECT l.body FROM tour_logs l WHERE l.tour_id = t.id ORDER BY l.id DESC LIMIT 1) AS last_log,
      (SELECT l.created_at FROM tour_logs l WHERE l.tour_id = t.id ORDER BY l.id DESC LIMIT 1) AS last_log_at
    FROM tours t
    LEFT JOIN users uc ON uc.id = t.created_by
    LEFT JOIN users ux ON ux.id = t.cancel_by
    LEFT JOIN mothers cm ON cm.id = t.mother_id`;
  const pg = pageParams(req);
  if (pg.enabled) {
    const total = db.prepare(`SELECT COUNT(*) c FROM tours t ${where}`).get(...args).c;
    const rows = db.prepare(`${cols} ${where} ORDER BY t.tour_at DESC LIMIT ? OFFSET ?`).all(...args, pg.pageSize, pg.offset);
    return res.json({ rows, total, page: pg.page, pageSize: pg.pageSize });
  }
  res.json(db.prepare(`${cols} ${where} ORDER BY t.tour_at DESC LIMIT 300`).all(...args));
});

// 某筆參觀預約的追蹤 log（時間序）
app.get('/api/tours/:id/logs', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, u.name AS staff_name FROM tour_logs l
    LEFT JOIN users u ON u.id = l.created_by
    WHERE l.tour_id = ? ORDER BY l.id DESC`).all(req.params.id);
  res.json(rows);
});

// 新增一則追蹤備註（追加式，不覆蓋）
function addTourLog(tourId, body, userId) {
  const text = (body || '').trim();
  if (!text) return;
  db.prepare('INSERT INTO tour_logs (tour_id, body, created_by) VALUES (?,?,?)').run(tourId, text, userId || null);
}

app.post('/api/tours/:id/logs', requireStaff, (req, res) => {
  const tour = db.prepare('SELECT id FROM tours WHERE id = ?').get(req.params.id);
  if (!tour) return res.status(404).json({ error: '找不到參觀預約' });
  const text = ((req.body || {}).body || '').trim();
  if (!text) return res.status(400).json({ error: '備註內容不可空白' });
  addTourLog(req.params.id, text, req.session.user.id);
  res.json({ ok: true });
});

// 參觀 → 潛在客戶連動：以電話比對 mothers；查無且有電話則自動建潛客檔（基本資料以客戶檔為準）
function tourCustomerLink(t, userId) {
  const phone = String(t.phone || '').trim();
  if (!phone) return { motherId: null, created: false };
  const existing = db.prepare(`SELECT id FROM mothers WHERE phone = ? ORDER BY id DESC LIMIT 1`).get(phone);
  if (existing) return { motherId: existing.id, created: false };
  const info = db.prepare(`INSERT INTO mothers (name, phone, due_date, status) VALUES (?,?,?, 'reserved')`).run(
    String(t.name || '').slice(0, 50), phone.slice(0, 20),
    /^\d{4}-\d{2}-\d{2}$/.test(t.due_date || '') ? t.due_date : '');
  custProfileUpsert(info.lastInsertRowid, {
    source: t.source, parity: t.parity, hospital: t.birth_hospital
  }, userId);
  return { motherId: info.lastInsertRowid, created: true };
}

app.post('/api/tours', requireStaff, (req, res) => {
  const t = req.body || {};
  if (!t.name || !t.tour_at) return res.status(400).json({ error: '姓名與參觀時間必填' });
  const link = tourCustomerLink(t, req.session.user.id);
  const info = db.prepare(`INSERT INTO tours
    (name, phone, due_date, tour_at, source, status, note, follow_up_date, parity, attended, birth_hospital, created_by, mother_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    t.name, t.phone || '', t.due_date || '', t.tour_at, t.source || '',
    ['scheduled', 'visited', 'signed', 'lost'].includes(t.status) ? t.status : 'scheduled', t.note || '', t.follow_up_date || '',
    String(t.parity || '').slice(0, 20), ['是', '否'].includes(t.attended) ? t.attended : '',
    String(t.birth_hospital || '').slice(0, 50), req.session.user.id, link.motherId);
  if (link.created) logAudit(req, { action: 'create', entity: 'customer_profiles', entity_id: link.motherId, summary: `參觀預約自動建潛在客戶 ${t.name}` });
  res.json({ id: info.lastInsertRowid, mother_id: link.motherId, customer_created: link.created });
});

app.put('/api/tours/:id', requireStaff, (req, res) => {
  const t = req.body || {};
  const cur = db.prepare('SELECT * FROM tours WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到參觀預約' });
  const status = ['scheduled', 'visited', 'signed', 'lost'].includes(t.status) ? t.status : cur.status;
  // 電話變更（或原本沒關聯）→ 重新比對客戶；電話清空則解除關聯
  const newPhone = t.phone ?? cur.phone;
  let motherId = cur.mother_id;
  if (newPhone !== cur.phone || (!motherId && newPhone)) {
    const link = tourCustomerLink({ ...cur, ...t, phone: newPhone }, req.session.user.id);
    motherId = link.motherId;
    if (link.created) logAudit(req, { action: 'create', entity: 'customer_profiles', entity_id: motherId, summary: `參觀預約自動建潛在客戶 ${t.name ?? cur.name}` });
  }
  db.prepare(`UPDATE tours SET name = ?, phone = ?, due_date = ?, tour_at = ?, source = ?, status = ?, note = ?, follow_up_date = ?,
    parity = ?, attended = ?, birth_hospital = ?, mother_id = ? WHERE id = ?`).run(
    t.name ?? cur.name, newPhone, t.due_date ?? cur.due_date, t.tour_at ?? cur.tour_at,
    t.source ?? cur.source, status, t.note ?? cur.note, t.follow_up_date ?? cur.follow_up_date,
    t.parity !== undefined ? String(t.parity).slice(0, 20) : cur.parity,
    t.attended !== undefined ? (['是', '否'].includes(t.attended) ? t.attended : '') : cur.attended,
    t.birth_hospital !== undefined ? String(t.birth_hospital).slice(0, 50) : cur.birth_hospital,
    motherId, req.params.id);
  if (status !== cur.status) {
    const L = { scheduled: '待參觀', visited: '已參觀', signed: '已簽約', lost: '未成交' };
    addTourLog(req.params.id, `狀態：${L[cur.status] || cur.status} → ${L[status] || status}`, req.session.user.id);
  }
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
  const result = tx();
  addTourLog(req.params.id, `已簽約並建立訂房（房號 ${b.room_id}，入住 ${b.check_in}）`, req.session.user.id);
  res.json(result);
});

// 取消預約：狀態轉未成交並記錄取消原因／時間／取消人
app.post('/api/tours/:id/cancel', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM tours WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到參觀預約' });
  const reason = String((req.body || {}).reason || '').trim().slice(0, 200);
  if (!reason) return res.status(400).json({ error: '請填寫取消原因' });
  const now = new Date().toLocaleString('sv-SE').slice(0, 19);
  db.prepare("UPDATE tours SET status = 'lost', cancel_reason = ?, cancel_at = ?, cancel_by = ? WHERE id = ?")
    .run(reason, now, req.session.user.id, req.params.id);
  addTourLog(req.params.id, `取消預約：${reason}`, req.session.user.id);
  res.json({ ok: true });
});

// 員工確認 LINE 待確認預約：改為 confirmed 並自動推播「已安排」訊息給用戶
app.post('/api/tours/:id/confirm', requireStaff, async (req, res) => {
  const t = db.prepare('SELECT * FROM tours WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '找不到參觀預約' });
  if (t.confirm_status !== 'pending') return res.status(400).json({ error: '此預約非待確認狀態' });
  db.prepare("UPDATE tours SET confirm_status = 'confirmed' WHERE id = ?").run(t.id);
  addTourLog(t.id, '確認 LINE 預約參觀', req.session.user.id);
  let notified = false;
  const s = getSettings();
  const token = (s.line_channel_access_token || '').trim();
  if (token && t.line_user_id) {
    const r = await notify.pushMessages(token, t.line_user_id, [tourFlexMessage({
      title: '預約參觀已確認',
      intro: '親愛的媽咪，您好！\n您的參觀時間已安排完成，\n我們期待您的到來！\n如需更改時間，請直接於此對話告知我們。',
      fields: [['參觀日期', t.tour_at.slice(0, 10)], ['參觀時段', t.tour_at.slice(11, 16)],
        ['預產期', t.due_date || '—'], ['胎次', t.parity ? `第${t.parity}胎` : '—']],
      centerName: s.center_name || ''
    })]);
    notified = !!r.ok;
  }
  res.json({ ok: true, notified });
});

// ---------- 預約參觀時段設定：指定日期時段／不開放參觀日 ----------
// 某日的開放時段：指定日期設定（取最新一筆）優先，否則用一般開放參觀時間；回傳各時段剩餘名額
function tourDaySlots(ds, s) {
  const ov = db.prepare('SELECT * FROM tour_slots WHERE slot_date = ? ORDER BY id DESC LIMIT 1').get(ds);
  if (ov && ov.closed) return { closed: true, slots: [] };
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const from = toMin((ov && ov.open_from) || s.tour_open_from || '11:00');
  const to = toMin((ov && ov.open_to) || s.tour_open_to || '19:00');
  const step = Math.max(5, Number((ov && ov.slot_minutes) || s.tour_slot_minutes) || 60);
  const cap = Math.max(1, Number((ov && ov.capacity) || s.tour_visit_limit) || 1);
  if (from == null || to == null || from >= to) return { closed: true, slots: [] };
  // 該日已被預約的時段數（含待確認，避免超收；lost＝已取消不計）
  const booked = {};
  db.prepare(`SELECT replace(substr(tour_at, 12, 5), 'T', '') AS tm, COUNT(*) c FROM tours
    WHERE date(replace(tour_at, 'T', ' ')) = ? AND status != 'lost' GROUP BY tm`).all(ds)
    .forEach(r => { booked[r.tm] = r.c; });
  const slots = [];
  for (let m = from; m + step <= to; m += step) {
    const tm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    slots.push({ time: tm, left: Math.max(0, cap - (booked[tm] || 0)) });
  }
  return { closed: false, slots };
}

app.get('/api/tour-slots', requireStaff, (req, res) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const cond = [], args = [];
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(from)) { cond.push('slot_date >= ?'); args.push(from.length === 7 ? from + '-01' : from); }
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(to)) { cond.push('slot_date <= ?'); args.push(to.length === 7 ? to + '-31' : to); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const rows = db.prepare(`SELECT s.*, u.name AS created_by_name FROM tour_slots s
    LEFT JOIN users u ON u.id = s.created_by ${where} ORDER BY s.slot_date`).all(...args);
  res.json(rows);
});
app.post('/api/tour-slots', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.slot_date || '')) return res.status(400).json({ error: '請選擇指定日期' });
  const closed = b.closed ? 1 : 0;
  const info = db.prepare(`INSERT INTO tour_slots (slot_date, closed, open_from, open_to, slot_minutes, capacity, created_by)
    VALUES (?,?,?,?,?,?,?)`).run(
    b.slot_date, closed, closed ? '' : String(b.open_from || '').slice(0, 5), closed ? '' : String(b.open_to || '').slice(0, 5),
    Number(b.slot_minutes) || 60, Number(b.capacity) || 1, req.session.user.id);
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/tour-slots/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tour_slots WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 客戶管理（潛在客戶＝mothers status='reserved'＋customer_profiles 擴充） ----------
const CUST_FIELDS = [
  'identity', 'source', 'delivery_mode', 'stay_days', 'care_exp', 'hospital', 'parity',
  'region', 'room_pref', 'email', 'address', 'tel', 'note',
  'contact_name', 'contact_relation', 'contact_mobile', 'contact_tel', 'contact_email', 'contact_address',
  'baby_gender', 'father_age', 'referrer', 'referrer_fee', 'referrer_note'
];
function custProfileUpsert(motherId, b, userId) {
  const cur = db.prepare('SELECT data FROM customer_profiles WHERE mother_id = ?').get(motherId);
  let data = {};
  if (cur) { try { data = JSON.parse(cur.data); } catch (e) { data = {}; } }
  for (const k of CUST_FIELDS) if (b[k] !== undefined) data[k] = String(b[k] ?? '').slice(0, 500);
  const json = JSON.stringify(data).slice(0, 12000);
  if (cur) {
    db.prepare(`UPDATE customer_profiles SET data=?, updated_at=datetime('now','localtime') WHERE mother_id=?`)
      .run(json, motherId);
  } else {
    db.prepare('INSERT INTO customer_profiles (mother_id, data, created_by) VALUES (?,?,?)')
      .run(motherId, json, userId);
  }
}

// 查詢：姓名/電話（模糊）＋預產期（精準）＋合約編號（contracts.id）
app.get('/api/customers', requireStaff, (req, res) => {
  const name = String(req.query.name || '').trim();
  const phone = String(req.query.phone || '').trim();
  const due = String(req.query.due_date || '').trim();
  const contract = String(req.query.contract_no || '').trim().replace(/\D/g, '');
  if (!name && !phone && !due && !contract) return res.status(400).json({ error: '請至少輸入一個查詢條件' });
  const conds = [], args = [];
  if (name) { conds.push('m.name LIKE ?'); args.push(`%${name}%`); }
  if (phone) { conds.push('m.phone LIKE ?'); args.push(`%${phone}%`); }
  if (due) { conds.push('m.due_date = ?'); args.push(due); }
  if (contract) {
    conds.push(`(EXISTS (SELECT 1 FROM customer_contracts cc WHERE cc.mother_id = m.id AND cc.contract_no LIKE ?)
      OR EXISTS (SELECT 1 FROM contracts c JOIN bookings bk ON bk.id = c.booking_id
      WHERE bk.mother_id = m.id AND CAST(c.id AS TEXT) LIKE ?))`);
    args.push(`%${contract}`, `%${contract}`);
  }
  const rows = db.prepare(`
    SELECT m.id, m.name, m.phone, m.id_no, m.due_date, m.status,
      (SELECT cc.contract_no FROM customer_contracts cc WHERE cc.mother_id = m.id AND cc.status != 'archived') AS contract_no,
      (SELECT c.id FROM contracts c JOIN bookings bk ON bk.id = c.booking_id
        WHERE bk.mother_id = m.id AND c.status != 'void' ORDER BY c.id DESC LIMIT 1) AS contract_id,
      (SELECT COUNT(*) FROM customer_profiles p WHERE p.mother_id = m.id) AS has_profile
    FROM mothers m WHERE ${conds.join(' AND ')} ORDER BY m.id DESC LIMIT 100`).all(...args);
  res.json({ rows });
});

app.get('/api/customers/:motherId', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT * FROM mothers WHERE id = ?').get(req.params.motherId);
  if (!mother) return res.status(404).json({ error: '找不到客戶' });
  const prof = db.prepare('SELECT data, updated_at FROM customer_profiles WHERE mother_id = ?').get(mother.id);
  let data = {};
  if (prof) { try { data = JSON.parse(prof.data); } catch (e) { data = {}; } }
  // 關聯資料同步帶出：互動紀錄／參觀／合約／訂房收款
  const logs = db.prepare(`SELECT l.*, u.name AS staff_name FROM customer_logs l
    LEFT JOIN users u ON u.id = l.created_by WHERE l.mother_id = ? ORDER BY l.id DESC LIMIT 100`).all(mother.id);
  const tours = db.prepare(`SELECT id, tour_at, status, note FROM tours
    WHERE mother_id = ? OR name = ? OR (? != '' AND phone = ?) ORDER BY tour_at DESC LIMIT 50`)
    .all(mother.id, mother.name, mother.phone || '', mother.phone || '');
  const contracts = db.prepare(`
    SELECT c.id, c.title, c.status, c.created_at, c.signed_at, bk.check_in, bk.check_out, bk.room_id,
      r.name AS room_name, bk.total_amount
    FROM contracts c JOIN bookings bk ON bk.id = c.booking_id
    LEFT JOIN rooms r ON r.id = bk.room_id
    WHERE bk.mother_id = ? ORDER BY c.id DESC LIMIT 50`).all(mother.id);
  const bookings = db.prepare(`
    SELECT bk.id, bk.check_in, bk.check_out, bk.status, bk.total_amount, r.name AS room_name, r.room_type,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.booking_id = bk.id) AS paid,
      (SELECT COALESCE(SUM(ci.unit_price*ci.quantity),0) FROM charge_items ci WHERE ci.booking_id = bk.id) AS addon
    FROM bookings bk JOIN rooms r ON r.id = bk.room_id
    WHERE bk.mother_id = ? ORDER BY bk.check_in DESC LIMIT 50`).all(mother.id);
  // 消費明細與收款紀錄（該媽媽所有訂房）
  const charges = db.prepare(`
    SELECT ci.booking_id, ci.item_name, ci.unit_price, ci.quantity, ci.charged_on, ci.note
    FROM charge_items ci JOIN bookings bk ON bk.id = ci.booking_id
    WHERE bk.mother_id = ? ORDER BY ci.charged_on DESC, ci.id DESC LIMIT 200`).all(mother.id);
  const payments = db.prepare(`
    SELECT p.booking_id, p.amount, p.method, p.paid_on, p.note, p.item, p.target, u.name AS received_name
    FROM payments p JOIN bookings bk ON bk.id = p.booking_id
    LEFT JOIN users u ON u.id = p.received_by
    WHERE bk.mother_id = ? ORDER BY p.paid_on DESC, p.id DESC LIMIT 200`).all(mother.id);
  // 客戶合約資料＋房型清單（合約明細下拉用）
  const contract = getCustomerContract(mother.id);
  const roomTypes = db.prepare(`SELECT room_type AS name, MIN(price_per_day) AS price
    FROM rooms WHERE active = 1 GROUP BY room_type ORDER BY price DESC`).all();
  // 膳食資訊：飲食類型/禁忌＋未來 7 天供餐預覽（依產後階段與飲食類型挑菜單）
  const mealCfg = mealConfig();
  const mealWeek = [];
  {
    const bk = db.prepare(`SELECT check_in FROM bookings WHERE mother_id = ? AND status IN ('checked_in','reserved')
      ORDER BY status = 'checked_in' DESC, check_in DESC LIMIT 1`).get(mother.id);
    const mm = { ...mother, check_in: bk ? bk.check_in : '' };
    for (let i = 0; i < 7; i++) {
      const date = new Date(new Date(today()).getTime() + i * 86400000).toISOString().slice(0, 10);
      const menus = db.prepare('SELECT * FROM meal_menu WHERE menu_date = ?').all(date);
      const stage = motherStage(mm, date, mealCfg.stages);
      const diet = mother.meal_diet || (mealCfg.diets[0] || '一般');
      const slots = {};
      for (const slot of mealCfg.slots) {
        const mu = pickMenu(menus.filter(x => x.slot === slot), stage.name, diet);
        slots[slot] = mu ? [mu.staple, mu.main, mu.soup].filter(Boolean).join('／') : '';
      }
      mealWeek.push({ date, day: stage.day, stage: stage.name, slots });
    }
  }
  const babies = db.prepare('SELECT id, name, gender, birth_date, birth_weight_g, location FROM babies WHERE mother_id = ?').all(mother.id);
  // 合約資料修改 log（每次存檔的欄位舊值→新值，取自稽核軌跡）
  const contractLogs = db.prepare(`SELECT id, user_name, action, summary, created_at FROM audit_logs
    WHERE entity = 'customer_contracts' AND entity_id = ? ORDER BY id DESC LIMIT 100`).all(String(mother.id));
  res.json({ mother, profile: data, profile_updated_at: prof ? prof.updated_at : '',
    logs, tours, contracts, bookings, charges, payments, contract, room_types: roomTypes, babies,
    contract_logs: contractLogs,
    meals: { diet: mother.meal_diet || '', diet_notes: mother.diet_notes || '',
      diets: mealCfg.diets, slots: mealCfg.slots, week: mealWeek } });
});

// ---------- 客戶合約資料（每媽媽一筆） ----------
const CCT_FIELDS = [
  'handler', 'sign_date', 'parity_no', 'baby_count', 'checkup_hospital', 'checkup_doctor',
  'birth_hospital', 'birth_date', 'birth_mode', 'butler', 'diet_ban', 'note',
  'expected_check_in', 'expected_check_out',
  'fc_return_date', 'fc_no', 'fc_by',
  'room_card_given_date', 'room_card_no', 'room_card_given_by',
  'room_card_used_date', 'room_card_used_no', 'room_card_used_by',
  'share_card_given_date', 'share_card_no', 'share_card_given_by',
  'share_card_used_date', 'share_card_used_no', 'share_card_used_by',
  'consult_date', 'consult_note', 'consult_by',
  'voucher_amount', 'voucher_by', 'cash_discount', 'cash_discount_by', 'gift_content', 'gift_by',
  'emergency_name', 'emergency_relation', 'emergency_phone'
];
// 稽核用欄位中文名（合約資料每次修改都記錄舊值→新值）
const CCT_LABELS = {
  handler: '經手人', sign_date: '簽約日期', parity_no: '生產胎次', baby_count: '寶寶人數',
  checkup_hospital: '產檢醫院', checkup_doctor: '產檢醫生', birth_hospital: '實際生產醫院',
  birth_date: '實際生產日期', birth_mode: '實際生產方式', butler: '小管家', diet_ban: '飲食禁忌', note: '合約備註',
  expected_check_in: '預計入住日', expected_check_out: '預計出住日',
  fc_return_date: '定型化契約簽回日', fc_no: '契約編號',
  room_card_given_date: '住房卡贈送日', room_card_no: '住房卡號', room_card_used_date: '住房卡抵用日', room_card_used_no: '住房卡抵用卡號',
  share_card_given_date: '分享卡贈送日', share_card_no: '分享卡號', share_card_used_date: '分享卡抵用日', share_card_used_no: '分享卡抵用卡號',
  consult_date: '產前諮詢日', consult_note: '諮詢備註',
  voucher_amount: '商品禮券金額', cash_discount: '現金折扣金額', gift_content: '贈品內容',
  emergency_name: '緊急聯絡人姓名', emergency_relation: '緊急聯絡人關係', emergency_phone: '緊急聯絡人電話'
};
function getCustomerContract(motherId) {
  const c = db.prepare("SELECT * FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(motherId);
  if (!c) return null;
  try { c.data = JSON.parse(c.data); } catch (e) { c.data = {}; }
  try { c.items = JSON.parse(c.items); } catch (e) { c.items = []; }
  c.total = c.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  return c;
}
function ensureCustomerContract(motherId, userId) {
  let c = db.prepare("SELECT * FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(motherId);
  if (c) return c;
  // 合約編號：YYYYMM＋3 碼流水（依當月既有數量遞增，衝突時往後找）
  const ym = today().slice(0, 7).replace('-', '');
  let seq = db.prepare("SELECT COUNT(*) c FROM customer_contracts WHERE contract_no LIKE ?").get(`${ym}%`).c + 1;
  let no = '';
  for (let i = 0; i < 999; i++) {
    no = `${ym}${String(seq + i).padStart(3, '0')}`;
    if (!db.prepare('SELECT 1 FROM customer_contracts WHERE contract_no = ?').get(no)) break;
  }
  db.prepare('INSERT INTO customer_contracts (mother_id, contract_no, created_by) VALUES (?,?,?)')
    .run(motherId, no, userId);
  return db.prepare("SELECT * FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(motherId);
}

// 合約資料存檔（部分欄位合併；同步 mothers 的預產期/生產方式/飲食禁忌）
app.put('/api/customers/:motherId/contract', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.motherId);
  if (!mother) return res.status(404).json({ error: '找不到客戶' });
  const b = req.body || {};
  const cur = ensureCustomerContract(mother.id, req.session.user.id);
  let data = {};
  try { data = JSON.parse(cur.data); } catch (e) { data = {}; }
  // 每次修改儲存都記 LOG：逐欄記錄 舊值→新值
  const changes = [];
  let substantive = false;   // 實質欄位（住期）變更 → 既有電子合約需重簽
  for (const k of CCT_FIELDS) if (b[k] !== undefined) {
    const nv = String(b[k] ?? '').slice(0, 600);
    if (String(data[k] ?? '') !== nv && !k.endsWith('_by')) {
      changes.push(`${CCT_LABELS[k] || k}：${String(data[k] ?? '') || '（空）'}→${nv || '（空）'}`);
      if (k === 'expected_check_in' || k === 'expected_check_out') substantive = true;
    }
    data[k] = nv;
  }
  // 各區塊存檔時間戳：供合約資料頁顯示「儲存明細」，並帶入訂房確認單（合約）
  const stampAt = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
  if (b.voucher_amount !== undefined) data.voucher_at = stampAt;
  if (b.cash_discount !== undefined) data.cash_discount_at = stampAt;
  if (b.gift_content !== undefined) data.gift_at = stampAt;
  if (b.consult_date !== undefined || b.consult_note !== undefined) data.consult_at = stampAt;
  db.prepare(`UPDATE customer_contracts SET data=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
    .run(JSON.stringify(data).slice(0, 12000), mother.id);
  if (/^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '')) {
    db.prepare('UPDATE mothers SET due_date = ? WHERE id = ?').run(b.due_date, mother.id);
  }
  // 媽媽手機於合約表單可直接填寫，同步媽媽主檔
  if (b.mother_phone !== undefined && String(b.mother_phone).trim()) {
    db.prepare('UPDATE mothers SET phone = ? WHERE id = ?').run(String(b.mother_phone).trim().slice(0, 20), mother.id);
  }
  if (b.delivery_mode !== undefined) {
    db.prepare('UPDATE mothers SET delivery_type = ? WHERE id = ?').run(String(b.delivery_mode).slice(0, 20), mother.id);
  }
  if (b.diet_ban !== undefined) {
    db.prepare('UPDATE mothers SET diet_notes = ? WHERE id = ?').run(String(b.diet_ban).slice(0, 500), mother.id);
  }
  // 實際生產日期同步媽媽主檔（寶寶報喜依此查詢）
  if (/^\d{4}-\d{2}-\d{2}$/.test(b.birth_date || '')) {
    db.prepare('UPDATE mothers SET delivery_date = ? WHERE id = ?').run(b.birth_date, mother.id);
  }
  logAudit(req, { action: 'update', entity: 'customer_contracts', entity_id: mother.id,
    summary: changes.length ? `客戶合約資料修改：${changes.join('；').slice(0, 900)}` : '客戶合約資料修改（無欄位變更）' });
  if (substantive) markContractsNeedResign(mother.id);   // 住期變更 → 既有電子合約標示需重簽
  res.json({ ok: true, contract_no: cur.contract_no });
});

// 回住開新約：封存現行合約並以新編號開新約；舊約保留供查閱（歷史合約）
app.post('/api/customers/:motherId/contract/renew', requireStaff, (req, res) => {
  const m = db.prepare('SELECT id, name FROM mothers WHERE id = ?').get(req.params.motherId);
  if (!m) return res.status(404).json({ error: '找不到客戶' });
  const cur = db.prepare("SELECT * FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(m.id);
  if (!cur) return res.status(400).json({ error: '目前沒有現行合約，直接編輯合約資料即可' });
  db.prepare(`UPDATE customer_contracts SET status='archived', updated_at=datetime('now','localtime') WHERE id=?`).run(cur.id);
  const nc = ensureCustomerContract(m.id, req.session.user.id);
  logAudit(req, { action: 'create', entity: 'customer_contracts', entity_id: m.id,
    summary: `回住開新約：封存舊約 ${cur.contract_no}，新約 ${nc.contract_no}` });
  res.json({ ok: true, archived_no: cur.contract_no, contract_no: nc.contract_no });
});

// 歷史（封存）合約查閱
app.get('/api/customers/:motherId/contract/history', requireStaff, (req, res) => {
  const rows = db.prepare(`SELECT id, contract_no, data, items, updated_at FROM customer_contracts
    WHERE mother_id = ? AND status = 'archived' ORDER BY id DESC`).all(req.params.motherId);
  for (const r of rows) {
    try { r.data = JSON.parse(r.data); } catch (e) { r.data = {}; }
    try { r.items = JSON.parse(r.items); } catch (e) { r.items = []; }
    r.total = r.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  }
  res.json(rows);
});

// 報喜訂餐鋪床：自入住日午餐起至出住日早餐止，逐日鋪入餐別（入住日略過早餐、出住日僅早餐）
function seedStayMeals(motherId, checkIn, checkOut, choice, note) {
  const upMeal = db.prepare(`INSERT INTO meal_orders (mother_id, meal_date, meal_type, choice, note)
    VALUES (?,?,?,?,?)
    ON CONFLICT(mother_id, meal_date, meal_type) DO UPDATE SET choice = excluded.choice, note = excluded.note`);
  let dd = new Date(checkIn + 'T00:00:00Z');
  const endD = new Date(checkOut + 'T00:00:00Z');
  for (let i = 0; dd <= endD && i < 200; i++, dd = new Date(dd.getTime() + 86400000)) {
    const ds = dd.toISOString().slice(0, 10);
    const meals = ds === checkIn ? ['lunch', 'dinner'] : ds === checkOut ? ['breakfast'] : ['breakfast', 'lunch', 'dinner'];
    for (const mt of meals) upMeal.run(motherId, ds, mt, choice, note || '');
  }
}

// 寶寶報喜：儲存入住通知單資料；建立寶寶資料（依胎數）、同步媽媽生產資訊
// 儲存後資料轉入：實際入住床表／住客管理／膳食管理／媽媽房況／寶寶房況
app.post('/api/customers/:motherId/baby-announce', requireStaff, (req, res) => {
  const m = db.prepare('SELECT * FROM mothers WHERE id = ?').get(req.params.motherId);
  if (!m) return res.status(404).json({ error: '找不到客戶' });
  const b = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.birth_date || '')) return res.status(400).json({ error: '請填寫實際生產日期' });
  const babiesIn = (Array.isArray(b.babies) ? b.babies : []).slice(0, 3);
  if (!babiesIn.length) return res.status(400).json({ error: '請填寫寶寶性別／體重' });
  const cur = ensureCustomerContract(m.id, req.session.user.id);
  let data = {};
  try { data = JSON.parse(cur.data); } catch (e) { data = {}; }
  // 通知單內容存入合約資料（announce_*），儲存日期＝今日
  const ann = {
    announce_weeks: String(b.weeks || '').slice(0, 20),
    announce_meal: String(b.meal_choice || '').slice(0, 30),
    announce_bra: String(b.bra_size || '').slice(0, 10),
    announce_diet_type: String(b.diet_type || '').slice(0, 10),
    announce_taboos: String(b.taboos || '').slice(0, 200),
    announce_car_no: String(b.car_no || '').slice(0, 20),
    announce_id4: String(b.id4 || '').slice(0, 4),
    announce_room: String(b.room_name || '').slice(0, 20),
    announce_phone_mom: String(b.phone_mom || '').slice(0, 20),
    announce_phone_dad: String(b.phone_dad || '').slice(0, 20),
    announce_gift: String(b.gift || '').slice(0, 300),
    announce_babies: JSON.stringify(babiesIn.map(x => ({ gender: x.gender === 'male' ? 'male' : x.gender === 'female' ? 'female' : '', weight_g: Math.round(Number(x.weight_g) || 0) }))),
    announce_by: req.session.user.name,
    announce_date: today()
  };
  Object.assign(data, ann);
  if (b.birth_hospital !== undefined) data.birth_hospital = String(b.birth_hospital).slice(0, 100);
  if (b.birth_mode !== undefined) data.birth_mode = String(b.birth_mode).slice(0, 20);
  data.birth_date = b.birth_date;
  const existingBefore = db.prepare('SELECT COUNT(*) c FROM babies WHERE mother_id = ?').get(m.id).c;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE customer_contracts SET data=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
      .run(JSON.stringify(data).slice(0, 12000), m.id);
    // 媽媽主檔：實際生產日期／方式；禁忌併入飲食備註
    db.prepare('UPDATE mothers SET delivery_date=?, delivery_type=COALESCE(NULLIF(?,\'\'), delivery_type) WHERE id=?')
      .run(b.birth_date, String(b.birth_mode || '').slice(0, 20), m.id);
    if (String(b.taboos || '').trim() || String(b.diet_type || '').trim()) {
      db.prepare('UPDATE mothers SET diet_notes=? WHERE id=?')
        .run(`${String(b.diet_type || '').trim()} ${String(b.taboos || '').trim()}`.trim().slice(0, 500), m.id);
    }
    // 寶寶資料：不足胎數者補建（已存在的不動）；轉入寶寶房況／照護
    const insBaby = db.prepare(`INSERT INTO babies (mother_id, name, gender, birth_date, birth_weight_g, notes)
      VALUES (?,?,?,?,?,?)`);
    for (let i = existingBefore; i < babiesIn.length; i++) {
      const x = babiesIn[i];
      insBaby.run(m.id, `${m.name}寶${babiesIn.length > 1 ? i + 1 : ''}`.trim(),
        x.gender === 'male' || x.gender === 'female' ? x.gender : 'male',
        b.birth_date, Math.round(Number(x.weight_g) || 0) || null, '寶寶報喜建檔');
    }
  });
  tx();
  // 報喜後續自動帶入：房務「請備房」任務（第一段房間／入住日）＋住期訂餐（鋪滿全部段落至最末段出住日）
  const annBk = db.prepare(`SELECT bk.id, bk.check_in, bk.check_out, bk.room_id, r.name AS room_name
    FROM bookings bk JOIN rooms r ON r.id = bk.room_id
    WHERE bk.mother_id = ? AND bk.status IN ('reserved','checked_in')
    ORDER BY bk.check_in, bk.id LIMIT 1`).get(m.id);
  const annOut = annBk ? db.prepare(`SELECT MAX(check_out) o FROM bookings
    WHERE mother_id = ? AND status IN ('reserved','checked_in')`).get(m.id).o : '';
  let hkTaskName = '';
  if (annBk) {
    // 房務任務：(房號)請備房+MMdd(入住日)；建立於報喜儲存日；重複報喜不重複建立（同任務名且待處理者跳過）
    const mmdd = String(annBk.check_in || '').slice(5).replace('-', ''); // 入住日 MMdd，例如 0720
    hkTaskName = `${annBk.room_name}請備房${mmdd}`;
    const dupTask = db.prepare(`SELECT 1 FROM housekeeping_logs
      WHERE mother_id = ? AND task = ? AND status = 'pending' LIMIT 1`).get(m.id, hkTaskName);
    if (!dupTask) {
      db.prepare(`INSERT INTO housekeeping_logs (room_id, mother_id, task, scheduled_for, note, created_by)
        VALUES (?,?,?,?,?,?)`).run(annBk.room_id, m.id, hkTaskName, today(),
        `媽咪 ${m.name}／${annBk.room_name}房／入住 ${annBk.check_in}／出住 ${annOut}／哺乳衣 ${ann.announce_bra || '—'}`,
        req.session.user.id);
    }
    // 膳食管理：自入住日午餐起至（最末段）出住日早餐止，逐日自動帶入餐別（多段住期整段鋪滿）
    if (ann.announce_meal && ann.announce_meal !== '不需供餐') {
      const mealNote = [ann.announce_diet_type, ann.announce_taboos ? `禁忌：${ann.announce_taboos}` : '']
        .filter(Boolean).join('　');
      seedStayMeals(m.id, annBk.check_in, annOut, ann.announce_meal, mealNote);
    }
  }
  logAudit(req, { action: 'update', entity: 'customer_contracts', entity_id: m.id,
    summary: `寶寶報喜：生產日 ${b.birth_date}、${babiesIn.length} 胎、餐別 ${ann.announce_meal || '—'}、車號 ${ann.announce_car_no || '—'}` });
  res.json({ ok: true, created_babies: Math.max(0, babiesIn.length - existingBefore),
    hk_task: hkTaskName, meal_date: annBk ? annBk.check_in : '', meal_end: annOut });
});

// 合約明細：新增銷售房型（qty=訂房天數；price 未帶則取該房型每日房價）
// ---------- 入住前合約明細變更連動（part2）：合約為唯一事實來源 ----------
// 入住後明細鎖定唯讀（縮短走收費明細退費試算、加項走加購消費）
function motherHasCheckedIn(motherId) {
  return !!db.prepare(`SELECT 1 FROM bookings WHERE mother_id = ? AND status = 'checked_in' LIMIT 1`).get(motherId);
}
// 實質變更（明細/總額/住期）→ 該媽媽已簽/待簽電子合約標示需重簽（人工按重新簽署）
function markContractsNeedResign(motherId) {
  return db.prepare(`UPDATE contracts SET needs_resign = 1
    WHERE status IN ('pending','signed')
      AND booking_id IN (SELECT id FROM bookings WHERE mother_id = ? AND status != 'cancelled')`).run(motherId).changes;
}
// 依合約明細順序同步既有「預約中」訂房段：改天數→順延重排；明細少於訂房→多出的段取消
// 撞到其他客戶訂房整批擋下（丟 409）；訂餐依新住期重鋪（沿用原餐別）
function syncBookingsToContractItems(req, motherId, reasonText) {
  const cur = db.prepare("SELECT items FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(motherId);
  let items = [];
  try { items = JSON.parse((cur || {}).items || '[]'); } catch (e) { items = []; }
  const bks = db.prepare(`SELECT * FROM bookings WHERE mother_id = ? AND status = 'reserved'
    ORDER BY check_in, id`).all(motherId);
  if (!bks.length) return { updated: 0, cancelled: 0 };
  const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
  // 依序建立計畫：起算日維持第一段原入住日，逐段接續
  let cursor = bks[0].check_in;
  const plan = [];
  for (let i = 0; i < bks.length; i++) {
    if (i < items.length) {
      const qty = Math.max(1, Math.round(Number(items[i].qty) || 1));
      const price = Math.round(Number(items[i].price) || 0);
      plan.push({ bk: bks[i], action: 'update', check_in: cursor, check_out: addDays(cursor, qty), total: qty * price });
      cursor = addDays(cursor, qty);
    } else {
      plan.push({ bk: bks[i], action: 'cancel' });
    }
  }
  // 撞期檢查：新期間 vs 其他客戶的有效訂房（同媽媽各段互相接續，不列入）
  const conflictStmt = db.prepare(`SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
    WHERE bk.room_id = ? AND bk.mother_id != ? AND bk.status IN ('reserved','checked_in')
      AND bk.check_in < ? AND bk.check_out > ? LIMIT 1`);
  for (const p of plan) {
    if (p.action !== 'update') continue;
    const hit = conflictStmt.get(p.bk.room_id, motherId, p.check_out, p.check_in);
    if (hit) {
      const err = new Error(`調整後 ${p.check_in}~${p.check_out} 與 ${hit.name} 房其他訂房衝突，請先於排房資料換房或改期`);
      err.httpStatus = 409;
      throw err;
    }
  }
  // 套用計畫
  let updated = 0, cancelled = 0;
  const oldOverallOut = bks.reduce((m, b) => (b.check_out > m ? b.check_out : m), bks[0].check_out);
  for (const p of plan) {
    if (p.action === 'cancel') {
      db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(p.bk.id);
      logAudit(req, { action: 'update', entity: 'bookings', entity_id: p.bk.id,
        summary: `合約明細刪除連動取消訂房（${p.bk.check_in}~${p.bk.check_out}）${reasonText ? `：${reasonText}` : ''}` });
      cancelled++;
    } else if (p.check_in !== p.bk.check_in || p.check_out !== p.bk.check_out || p.total !== p.bk.total_amount) {
      db.prepare('UPDATE bookings SET check_in = ?, check_out = ?, total_amount = ? WHERE id = ?')
        .run(p.check_in, p.check_out, p.total, p.bk.id);
      logAudit(req, { action: 'update', entity: 'bookings', entity_id: p.bk.id,
        summary: `合約明細變更連動排房：${p.bk.check_in}~${p.bk.check_out}→${p.check_in}~${p.check_out}、應收 ${p.bk.total_amount}→${p.total}` });
      updated++;
    }
  }
  // 訂餐重鋪：清原整段住期，依新住期重鋪（入住日午餐～新出住日早餐）
  if (updated || cancelled) {
    const start = bks[0].check_in;
    const seed = db.prepare(`SELECT choice, note FROM meal_orders WHERE mother_id = ? AND meal_date >= ? AND meal_date <= ?
      ORDER BY meal_date, meal_type LIMIT 1`).get(motherId, start, oldOverallOut);
    if (seed) {
      db.prepare('DELETE FROM meal_orders WHERE mother_id = ? AND meal_date >= ? AND meal_date <= ?')
        .run(motherId, start, oldOverallOut);
      const kept = plan.filter(p => p.action === 'update');
      if (kept.length) seedStayMeals(motherId, start, kept[kept.length - 1].check_out, seed.choice, seed.note || '');
    }
  }
  return { updated, cancelled };
}
// 找指定房型的空房（期間無其他有效訂房）；供更改房型／拆分自動連動換房用
function findFreeRoomOfType(roomType, checkIn, checkOut, excludeBookingId) {
  return db.prepare(`SELECT r.* FROM rooms r
    WHERE r.active = 1 AND r.room_type = ? AND NOT EXISTS (
      SELECT 1 FROM bookings bk WHERE bk.room_id = r.id AND bk.id != ?
        AND bk.status IN ('reserved','checked_in') AND bk.check_in < ? AND bk.check_out > ?)
    ORDER BY r.name LIMIT 1`).get(roomType, excludeBookingId || 0, checkOut, checkIn);
}
// 換房時同步該段「請備房」房務任務（房號、任務名、備註內的房名）
function moveHousekeepingPrepTasks(motherId, oldRoomId, oldRoomName, newRoomId, newRoomName) {
  for (const t of db.prepare(`SELECT id, task, note FROM housekeeping_logs
    WHERE mother_id = ? AND room_id = ? AND status = 'pending' AND task LIKE '%請備房%'`).all(motherId, oldRoomId)) {
    db.prepare('UPDATE housekeeping_logs SET room_id = ?, task = ?, note = ? WHERE id = ?')
      .run(newRoomId, String(t.task).split(oldRoomName).join(newRoomName),
        String(t.note || '').split(`${oldRoomName}房`).join(`${newRoomName}房`), t.id);
  }
}
// 訂金溢收提示：已收訂金 vs 新合約總額 10%
function depositOverHint(motherId) {
  const dep = db.prepare(`SELECT COALESCE(SUM(deposit),0) t FROM bookings WHERE mother_id = ? AND status != 'cancelled'`).get(motherId).t;
  const c = getCustomerContract(motherId);
  const need = Math.round(((c && c.total) || 0) * 0.1);
  return dep > need ? dep - need : 0;
}

app.post('/api/customers/:motherId/contract/items', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.motherId);
  if (!mother) return res.status(404).json({ error: '找不到客戶' });
  if (motherHasCheckedIn(mother.id)) return res.status(400).json({ error: '已入住，合約明細鎖定；縮短/升等降等請走收費明細（退費試算/期間變更），加項請走加購消費' });
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 100);
  const qty = Number(b.qty);
  if (!name) return res.status(400).json({ error: '請選擇銷售房型' });
  if (!(qty > 0 && qty <= 999)) return res.status(400).json({ error: '訂房天數需為 1～999' });
  let price = Number(b.price);
  if (!(price >= 0)) {
    const r = db.prepare('SELECT MIN(price_per_day) p FROM rooms WHERE room_type = ? AND active = 1').get(name);
    price = (r && r.p) || 0;
  }
  const cur = ensureCustomerContract(mother.id, req.session.user.id);
  let items = [];
  try { items = JSON.parse(cur.items); } catch (e) { items = []; }
  if (items.length >= 50) return res.status(400).json({ error: '明細筆數已達上限' });
  const totalOf = arr => arr.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const before = totalOf(items);
  items.push({ name, qty, price: Math.round(price), by: req.session.user.name, at: today() });
  db.prepare(`UPDATE customer_contracts SET items=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
    .run(JSON.stringify(items).slice(0, 12000), mother.id);
  // 金額變化記入 LOG（合約金額增加／減少查詢由此判讀）
  logAudit(req, { action: 'update', entity: 'customer_contracts', entity_id: mother.id,
    summary: `合約明細新增 ${name} ${qty}天（金額 ${before}→${totalOf(items)}）` });
  let sync;
  markContractsNeedResign(mother.id);   // 先標記：含將被連動取消之訂房的合約
  try { sync = syncBookingsToContractItems(req, mother.id, '合約明細新增'); }
  catch (e) { return res.status(e.httpStatus || 500).json({ error: e.message, saved: true }); }
  res.json({ ok: true, sync, deposit_over: depositOverHint(mother.id) });
});

// 合約明細：修改天數（入住前；單價鎖定原價，連動排房與應收）
app.post('/api/customers/:motherId/contract/items/edit', requireStaff, (req, res) => {
  const b = req.body || {};
  const idx = Number(b.index);
  const qty = Math.round(Number(b.qty));
  const cur = db.prepare("SELECT * FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(req.params.motherId);
  if (!cur) return res.status(404).json({ error: '找不到合約資料' });
  if (motherHasCheckedIn(cur.mother_id)) return res.status(400).json({ error: '已入住，合約明細鎖定；縮短/升等降等請走收費明細（退費試算/期間變更）' });
  let items = [];
  try { items = JSON.parse(cur.items); } catch (e) { items = []; }
  if (!(idx >= 0 && idx < items.length)) return res.status(400).json({ error: '明細序號錯誤' });
  if (!(qty > 0 && qty <= 999)) return res.status(400).json({ error: '訂房天數需為 1～999' });
  const totalOf = arr => arr.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const before = totalOf(items);
  const oldQty = items[idx].qty;
  if (Number(oldQty) === qty) return res.json({ ok: true, sync: { updated: 0, cancelled: 0 } });
  items[idx] = { ...items[idx], qty, by: req.session.user.name, at: today() };
  db.prepare(`UPDATE customer_contracts SET items=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
    .run(JSON.stringify(items).slice(0, 12000), cur.mother_id);
  logAudit(req, { action: 'update', entity: 'customer_contracts', entity_id: cur.mother_id,
    summary: `合約明細修改天數 ${items[idx].name} ${oldQty}→${qty}天（金額 ${before}→${totalOf(items)}）` });
  let sync;
  markContractsNeedResign(cur.mother_id);
  try { sync = syncBookingsToContractItems(req, cur.mother_id, '合約明細修改天數'); }
  catch (e) { return res.status(e.httpStatus || 500).json({ error: e.message, saved: true }); }
  res.json({ ok: true, sync, deposit_over: depositOverHint(cur.mother_id) });
});

// 合約明細：刪除（需刪除說明，記入稽核）
app.post('/api/customers/:motherId/contract/items/delete', requireStaff, (req, res) => {
  const b = req.body || {};
  const idx = Number(b.index);
  const reason = String(b.reason || '').trim().slice(0, 200);
  if (!reason) return res.status(400).json({ error: '請填寫刪除說明' });
  const cur = db.prepare("SELECT * FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(req.params.motherId);
  if (!cur) return res.status(404).json({ error: '找不到合約資料' });
  if (motherHasCheckedIn(cur.mother_id)) return res.status(400).json({ error: '已入住，合約明細鎖定；縮短/升等降等請走收費明細（退費試算/期間變更）' });
  let items = [];
  try { items = JSON.parse(cur.items); } catch (e) { items = []; }
  if (!(idx >= 0 && idx < items.length)) return res.status(400).json({ error: '明細序號錯誤' });
  const totalOf = arr => arr.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const before = totalOf(items);
  const removed = items.splice(idx, 1)[0];
  db.prepare(`UPDATE customer_contracts SET items=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
    .run(JSON.stringify(items), cur.mother_id);
  logAudit(req, { action: 'delete', entity: 'customer_contracts', entity_id: cur.mother_id,
    summary: `合約明細刪除 ${removed.name} ${removed.qty}天（${reason}）（金額 ${before}→${totalOf(items)}）` });
  let sync;
  markContractsNeedResign(cur.mother_id);
  try { sync = syncBookingsToContractItems(req, cur.mother_id, reason); }
  catch (e) { return res.status(e.httpStatus || 500).json({ error: e.message, saved: true }); }
  res.json({ ok: true, sync, deposit_over: depositOverHint(cur.mother_id) });
});

// 合約明細：更改房型（入住前整段升等/降等；單價帶新房型定價可手改，連動換房與應收）
app.post('/api/customers/:motherId/contract/items/change-type', requireStaff, (req, res) => {
  const b = req.body || {};
  const idx = Number(b.index);
  const name = String(b.name || '').trim().slice(0, 100);
  const cur = db.prepare("SELECT * FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(req.params.motherId);
  if (!cur) return res.status(404).json({ error: '找不到合約資料' });
  if (motherHasCheckedIn(cur.mother_id)) return res.status(400).json({ error: '已入住，合約明細鎖定；升等/降等請走收費明細（期間變更）' });
  let items = [];
  try { items = JSON.parse(cur.items); } catch (e) { items = []; }
  if (!(idx >= 0 && idx < items.length)) return res.status(400).json({ error: '明細序號錯誤' });
  if (!name) return res.status(400).json({ error: '請選擇銷售房型' });
  let price = Number(b.price);
  if (!(price >= 0)) {
    const r = db.prepare('SELECT MIN(price_per_day) p FROM rooms WHERE room_type = ? AND active = 1').get(name);
    price = (r && r.p) || 0;
  }
  price = Math.round(price);
  const old = items[idx];
  if (old.name === name && Number(old.price) === price) return res.json({ ok: true, sync: { updated: 0, cancelled: 0 } });
  const totalOf = arr => arr.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const before = totalOf(items);
  items[idx] = { ...old, name, price, by: req.session.user.name, at: today() };
  db.prepare(`UPDATE customer_contracts SET items=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
    .run(JSON.stringify(items).slice(0, 12000), cur.mother_id);
  logAudit(req, { action: 'update', entity: 'customer_contracts', entity_id: cur.mother_id,
    summary: `合約明細更改房型 ${old.name}→${name}（單價 ${old.price}→${price}）（金額 ${before}→${totalOf(items)}）` });
  markContractsNeedResign(cur.mother_id);
  // 對應排房段換房：第 idx 段預約若房型不符，自動改排新房型空房；無空房則保留原房並提示
  let room_warning = '';
  const bks = db.prepare(`SELECT bk.*, r.room_type, r.name AS room_name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
    WHERE bk.mother_id = ? AND bk.status = 'reserved' ORDER BY bk.check_in, bk.id`).all(cur.mother_id);
  const bkA = bks[idx];
  if (bkA && bkA.room_type !== name) {
    const free = findFreeRoomOfType(name, bkA.check_in, bkA.check_out, bkA.id);
    if (free) {
      db.prepare('UPDATE bookings SET room_id = ? WHERE id = ?').run(free.id, bkA.id);
      moveHousekeepingPrepTasks(cur.mother_id, bkA.room_id, bkA.room_name, free.id, free.name);
      logAudit(req, { action: 'update', entity: 'bookings', entity_id: bkA.id,
        summary: `合約明細更改房型連動換房：${bkA.room_name}→${free.name}（${bkA.check_in}~${bkA.check_out}）` });
    } else {
      room_warning = `「${name}」${bkA.check_in}~${bkA.check_out} 無空房，房號未變更（仍為 ${bkA.room_name}），請至排房資料調整`;
    }
  }
  let sync;
  try { sync = syncBookingsToContractItems(req, cur.mother_id, '合約明細更改房型'); }
  catch (e) { return res.status(e.httpStatus || 500).json({ error: e.message, saved: true }); }
  res.json({ ok: true, sync, room_warning, deposit_over: depositOverHint(cur.mother_id) });
});

// 合約明細：拆分（入住前部分天數升等/降等；一筆拆成前段原房型＋後段新房型，可同時增減天數）
app.post('/api/customers/:motherId/contract/items/split', requireStaff, (req, res) => {
  const b = req.body || {};
  const idx = Number(b.index);
  const qty1 = Math.round(Number(b.qty1));
  const name2 = String(b.name2 || '').trim().slice(0, 100);
  const qty2 = Math.round(Number(b.qty2));
  const cur = db.prepare("SELECT * FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(req.params.motherId);
  if (!cur) return res.status(404).json({ error: '找不到合約資料' });
  if (motherHasCheckedIn(cur.mother_id)) return res.status(400).json({ error: '已入住，合約明細鎖定；升等/降等請走收費明細（期間變更）' });
  let items = [];
  try { items = JSON.parse(cur.items); } catch (e) { items = []; }
  if (!(idx >= 0 && idx < items.length)) return res.status(400).json({ error: '明細序號錯誤' });
  if (!name2) return res.status(400).json({ error: '請選擇後段銷售房型' });
  if (!(qty1 > 0 && qty1 <= 999) || !(qty2 > 0 && qty2 <= 999)) return res.status(400).json({ error: '前後段天數需為 1～999' });
  let price2 = Number(b.price2);
  if (!(price2 >= 0)) {
    const r = db.prepare('SELECT MIN(price_per_day) p FROM rooms WHERE room_type = ? AND active = 1').get(name2);
    price2 = (r && r.p) || 0;
  }
  price2 = Math.round(price2);
  const old = items[idx];
  const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
  // 對應排房段：第 idx 段已排房者需為後段先建立訂房（自動選後段房型空房），排序連動才不會錯位
  const bks = db.prepare(`SELECT bk.*, r.room_type, r.name AS room_name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
    WHERE bk.mother_id = ? AND bk.status = 'reserved' ORDER BY bk.check_in, bk.id`).all(cur.mother_id);
  const bkA = bks[idx];
  let seg2 = null;
  if (bkA) {
    if (bks.length > idx + 1 && qty1 >= Number(old.qty)) {
      return res.status(400).json({ error: '前段天數未減少且後方已有其他排房段，順序無法自動接續，請先改天數或至排房資料調整' });
    }
    const segStart = addDays(bkA.check_in, qty1);
    const segEnd = addDays(segStart, qty2);
    const free = findFreeRoomOfType(name2, segStart, segEnd, 0);
    if (!free) return res.status(409).json({ error: `「${name2}」${segStart}~${segEnd} 無空房，無法拆分；請先於排房資料調整` });
    seg2 = { room: free, check_in: segStart, check_out: segEnd };
  }
  const totalOf = arr => arr.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const before = totalOf(items);
  const by = req.session.user.name, at = today();
  items.splice(idx, 1, { ...old, qty: qty1, by, at }, { name: name2, qty: qty2, price: price2, by, at });
  db.prepare(`UPDATE customer_contracts SET items=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
    .run(JSON.stringify(items).slice(0, 12000), cur.mother_id);
  logAudit(req, { action: 'update', entity: 'customer_contracts', entity_id: cur.mother_id,
    summary: `合約明細拆分 ${old.name} ${old.qty}天 → ${old.name} ${qty1}天＋${name2} ${qty2}天（金額 ${before}→${totalOf(items)}）` });
  markContractsNeedResign(cur.mother_id);
  if (seg2) {
    const info = db.prepare(`INSERT INTO bookings (mother_id, room_id, check_in, check_out, deposit, total_amount, status, notes, continued_from)
      VALUES (?,?,?,?,0,?,'reserved','合約明細拆分建立',?)`)
      .run(cur.mother_id, seg2.room.id, seg2.check_in, seg2.check_out, qty2 * price2, bkA.id);
    chainRelink(bkA.id, info.lastInsertRowid);   // 前段既有接續段改接到新段（維持鏈線性）
    logAudit(req, { action: 'create', entity: 'bookings', entity_id: info.lastInsertRowid,
      summary: `合約明細拆分連動排房：${seg2.room.name}（${seg2.check_in}~${seg2.check_out}、應收 ${qty2 * price2}）` });
  }
  let sync;
  try { sync = syncBookingsToContractItems(req, cur.mother_id, '合約明細拆分'); }
  catch (e) { return res.status(e.httpStatus || 500).json({ error: e.message, saved: true }); }
  res.json({ ok: true, sync, deposit_over: depositOverHint(cur.mother_id),
    note: bkA ? '' : '後段尚未排房，請至排房資料選房' });
});

// 合約金額增加／減少查詢：由 LOG 判讀「第一次合約金額（舊）vs 最新合約金額（新／實際）」
// 第一次金額＝簽約首日建檔完成的金額（首日多筆異動取當日最後值）
// 篩選：未入住（預定入住日/簽約日/預產期）／已入住（實際入住日/簽約日），?format=xlsx 匯出
app.get('/api/contract-amount-changes', requireStaff, (req, res) => {
  const dir = req.query.dir === 'down' ? 'down' : 'up';
  const stay = req.query.stay === 'in' ? 'in' : 'not_in';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : '';
  const dateField = String(req.query.date_field || 'checkin');
  const name = String(req.query.name || '').trim();
  const kw = String(req.query.keyword || '').trim();
  const kwType = String(req.query.keyword_type || 'contract');
  let rows = [];
  for (const c of db.prepare(`SELECT cc.*, m.name AS mother_name, m.id_no, m.phone, m.birth_date AS mother_birth, m.due_date,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS bk_in,
      (SELECT bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS bk_out,
      (SELECT COALESCE(NULLIF(bk.actual_check_out,''), bk.check_out) FROM bookings bk
        WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS bk_actual_out,
      (SELECT bk.status FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS bk_status
    FROM customer_contracts cc JOIN mothers m ON m.id = cc.mother_id
    WHERE cc.status NOT IN ('cancelled','archived')`).all()) {
    let items = [], data = {};
    try { items = JSON.parse(c.items); } catch (e) { items = []; }
    try { data = JSON.parse(c.data); } catch (e) { data = {}; }
    const latest = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
    const logs = db.prepare(`SELECT summary, created_at FROM audit_logs
      WHERE entity = 'customer_contracts' AND entity_id = ? AND summary LIKE '%（金額 %→%）%'
      ORDER BY id`).all(String(c.mother_id));
    const parsed = logs.map(l => {
      const mch = l.summary.match(/（金額 (\d+)→(\d+)）/);
      return mch ? { from: Number(mch[1]), to: Number(mch[2]), at: l.created_at } : null;
    }).filter(Boolean);
    if (!parsed.length) continue;
    const firstDay = parsed[0].at.slice(0, 10);
    const firstDayLogs = parsed.filter(p => p.at.slice(0, 10) === firstDay);
    const first = firstDayLogs[firstDayLogs.length - 1].to;
    const diff = latest - first;
    if (dir === 'up' ? diff <= 0 : diff >= 0) continue;
    rows.push({
      mother_id: c.mother_id, mother_name: c.mother_name, id_no: c.id_no || '', phone: c.phone || '',
      birth_date: c.mother_birth || '', due_date: c.due_date || '', contract_no: c.contract_no,
      sign_date: data.sign_date || '', handler: data.handler || '', gift_content: data.gift_content || '',
      room_types: [...new Set(items.map(it => it.name))].join('、'),
      days: items.reduce((s, it) => s + (Number(it.qty) || 0), 0),
      expected_check_in: data.expected_check_in || c.bk_in || '',
      expected_check_out: data.expected_check_out || c.bk_out || '',
      actual_check_in: c.bk_in || '', actual_check_out: c.bk_actual_out || '',
      checked_in: ['checked_in', 'checked_out'].includes(c.bk_status || ''),
      first_amount: first, latest_amount: latest, diff,
      first_date: firstDay, last_change_at: parsed[parsed.length - 1].at
    });
  }
  // 篩選（只能擇一）：未入住／已入住
  rows = rows.filter(r => stay === 'in' ? r.checked_in : !r.checked_in);
  // 日期欄位：未入住＝預定入住日/簽約日/預產期；已入住＝實際入住日/簽約日
  const df = stay === 'in'
    ? (dateField === 'sign' ? 'sign_date' : 'actual_check_in')
    : (dateField === 'sign' ? 'sign_date' : dateField === 'due' ? 'due_date' : 'expected_check_in');
  if (from) rows = rows.filter(r => r[df] && r[df] >= from);
  if (to) rows = rows.filter(r => r[df] && r[df] <= to);
  if (name) rows = rows.filter(r => r.mother_name.includes(name));
  if (kw) {
    if (kwType === 'idno') rows = rows.filter(r => r.id_no.includes(kw));
    else if (kwType === 'phone') rows = rows.filter(r => r.phone.includes(kw));
    else rows = rows.filter(r => r.contract_no.includes(kw));
  }
  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  if (req.query.format === 'xlsx') {
    const label = `合約金額${dir === 'down' ? '減少' : '增加'}查詢`;
    const cols = [
      { key: 'contract_no', label: '合約號碼' }, { key: 'mother_name', label: '媽媽姓名' },
      { key: 'phone', label: '媽媽手機' }, { key: 'birth_date', label: '媽媽生日' },
      { key: 'due_date', label: '預產期' },
      ...(stay === 'in'
        ? [{ key: 'actual_check_in', label: '實際入住日' }, { key: 'actual_check_out', label: '實際出住日' }]
        : [{ key: 'expected_check_in', label: '預定入住日' }, { key: 'expected_check_out', label: '預定出住日' }]),
      { key: 'days', label: '天數' }, { key: 'room_types', label: '房型' },
      { key: 'gift_content', label: '贈品內容' }, { key: 'handler', label: '經手人' },
      { key: 'first_amount', label: '舊合約總額' },
      { key: 'latest_amount', label: stay === 'in' ? '實際合約總額' : '新合約總額' },
      { key: 'diff', label: '差異總額' }
    ];
    const buf = buildWorkbook(label, cols, rows);
    const fname = encodeURIComponent(`${label}-${today()}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="contract-amount-${dir}.xlsx"; filename*=UTF-8''${fname}`);
    return res.send(buf);
  }
  res.json({ dir, stay, rows });
});

// ---------- 後台：公佈欄及交辦事項 ----------
app.get('/api/bulletins', requireStaff, (req, res) => {
  const rows = db.prepare(`SELECT b.*, u.name AS created_name, a.name AS assigned_name, dn.name AS done_name
    FROM bulletins b
    LEFT JOIN users u ON u.id = b.created_by
    LEFT JOIN users a ON a.id = b.assigned_to
    LEFT JOIN users dn ON dn.id = b.done_by
    ORDER BY b.pinned DESC, b.done, b.id DESC LIMIT 300`).all();
  res.json(rows);
});
app.post('/api/bulletins', requireStaff, (req, res) => {
  const b = req.body || {};
  if (!String(b.title || '').trim()) return res.status(400).json({ error: '請填寫標題' });
  const kind = b.kind === 'task' ? 'task' : 'notice';
  const info = db.prepare(`INSERT INTO bulletins (kind, title, body, assigned_to, due_date, pinned, created_by)
    VALUES (?,?,?,?,?,?,?)`).run(
    kind, String(b.title).trim().slice(0, 100), String(b.body || '').slice(0, 2000),
    kind === 'task' ? (b.assigned_to || null) : null,
    /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : '',
    b.pinned ? 1 : 0, req.session.user.id);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/bulletins/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM bulletins WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到公告/交辦' });
  const b = req.body || {};
  if (b.done !== undefined) { // 交辦結案／重開
    db.prepare(`UPDATE bulletins SET done=?, done_at=CASE WHEN ? THEN datetime('now','localtime') ELSE '' END,
      done_by=CASE WHEN ? THEN ? ELSE NULL END WHERE id=?`)
      .run(b.done ? 1 : 0, b.done ? 1 : 0, b.done ? 1 : 0, req.session.user.id, cur.id);
    return res.json({ ok: true });
  }
  db.prepare(`UPDATE bulletins SET title=?, body=?, assigned_to=?, due_date=?, pinned=? WHERE id=?`).run(
    String(b.title ?? cur.title).trim().slice(0, 100), String(b.body ?? cur.body).slice(0, 2000),
    b.assigned_to !== undefined ? (b.assigned_to || null) : cur.assigned_to,
    b.due_date !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ? b.due_date : '') : cur.due_date,
    b.pinned !== undefined ? (b.pinned ? 1 : 0) : cur.pinned, cur.id);
  res.json({ ok: true });
});
app.delete('/api/bulletins/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM bulletins WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 後台：文件上傳下載區 ----------
app.get('/api/documents', requireStaff, (req, res) => {
  const rows = db.prepare(`SELECT d.*, u.name AS uploaded_name FROM documents d
    LEFT JOIN users u ON u.id = d.uploaded_by ORDER BY d.id DESC LIMIT 500`).all();
  res.json(rows);
});
app.post('/api/documents', requireStaff, docUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請選擇檔案（支援 PDF／Office／圖片／文字／ZIP，20MB 內）' });
  const b = req.body || {};
  const info = db.prepare(`INSERT INTO documents (title, category, filename, orig_name, size, note, uploaded_by)
    VALUES (?,?,?,?,?,?,?)`).run(
    String(b.title || req.file.originalname).trim().slice(0, 100),
    String(b.category || '').slice(0, 50), req.file.filename,
    String(req.file.originalname || '').slice(0, 200), req.file.size,
    String(b.note || '').slice(0, 200), req.session.user.id);
  res.json({ id: info.lastInsertRowid, file: req.file.filename });
});
app.delete('/api/documents/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT filename FROM documents WHERE id = ?').get(req.params.id);
  if (cur) removeUploadFile(cur.filename);
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 後台：客戶退訂資料／合約轉住房資料 ----------
app.get('/api/cancellations', requireStaff, (req, res) => {
  const bookings = db.prepare(`
    SELECT bk.id, bk.check_in, bk.check_out, bk.deposit, bk.total_amount, bk.notes, bk.created_at,
      m.name AS mother_name, m.phone, r.name AS room_name, r.room_type,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.booking_id = bk.id) AS paid
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status = 'cancelled' ORDER BY bk.id DESC LIMIT 200`).all();
  const tours = db.prepare(`SELECT id, name, phone, tour_at, note FROM tours
    WHERE status = 'lost' ORDER BY tour_at DESC LIMIT 200`).all();
  res.json({ bookings, tours });
});
app.get('/api/contract-transfers', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT cc.contract_no, cc.updated_at, m.id AS mother_id, m.name, m.phone, m.due_date, m.status,
      cc.items, cc.data,
      (SELECT bk.id FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS booking_id,
      (SELECT bk.status FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS booking_status,
      (SELECT bk.check_in || ' ~ ' || bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS stay_range,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name
    FROM customer_contracts cc JOIN mothers m ON m.id = cc.mother_id
    WHERE cc.status != 'archived'
    ORDER BY cc.id DESC LIMIT 200`).all();
  for (const r of rows) {
    try { r.total = JSON.parse(r.items).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0); }
    catch (e) { r.total = 0; }
    try { r.sign_date = (JSON.parse(r.data) || {}).sign_date || ''; } catch (e) { r.sign_date = ''; }
    delete r.items; delete r.data;
  }
  res.json({ rows });
});

// ---------- 客戶及簽約資料查詢（簽約中/退訂/已轉住房 三模式共用；?format=xlsx 匯出） ----------
// mode=signed：有效合約且尚未排房；cancelled：已退訂；transferred：有效且已排房/入住/退住
app.get('/api/client-contracts', requireStaff, (req, res) => {
  const mode = ['signed', 'cancelled', 'transferred'].includes(req.query.mode) ? req.query.mode : 'signed';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : '';
  const dateField = String(req.query.date_field || '');
  const name = String(req.query.name || '').trim();
  const kw = String(req.query.keyword || '').trim();
  const kwType = String(req.query.keyword_type || 'contract');
  const all = db.prepare(`
    SELECT cc.contract_no, cc.status, cc.items, cc.data, cc.updated_at,
      m.id AS mother_id, m.name, m.id_no, m.phone, m.birth_date, m.due_date, m.status AS mother_status,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS booking_check_in,
      (SELECT bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS booking_check_out,
      (SELECT COALESCE(NULLIF(bk.actual_check_out,''), bk.check_out) FROM bookings bk
        WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS booking_actual_out,
      (SELECT bk.status FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS booking_status,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS room_name,
      (SELECT COALESCE(SUM(bk.deposit),0) FROM bookings bk WHERE bk.mother_id = m.id AND bk.status != 'cancelled') AS deposit_sum,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN bookings bk ON bk.id = p.booking_id
        WHERE bk.mother_id = m.id AND bk.status != 'cancelled' AND p.target = 'contract' AND p.paid_on < bk.check_in) AS prepaid_pay
    FROM customer_contracts cc JOIN mothers m ON m.id = cc.mother_id
    WHERE cc.status != 'archived'
    ORDER BY cc.id DESC LIMIT 500`).all();
  let rows = all.map(r => {
    let items = [], data = {};
    try { items = JSON.parse(r.items); } catch (e) { items = []; }
    try { data = JSON.parse(r.data); } catch (e) { data = {}; }
    const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
    // 合約餘額＝合約總額 − 入住前繳款（訂金＋入住日前登錄的合約款繳費；已入住者僅計入住前的 LOG）
    const prepaid = (r.deposit_sum || 0) + (r.prepaid_pay || 0);
    return {
      mother_id: r.mother_id, contract_no: r.contract_no, name: r.name, id_no: r.id_no || '',
      phone: r.phone || '', birth_date: r.birth_date || '', due_date: r.due_date || '', sign_date: data.sign_date || '',
      handler: data.handler || '', summary: items.map(it => `${it.name}×${it.qty}天`).join('、'),
      room_types: [...new Set(items.map(it => it.name))].join('、'),
      gift_content: data.gift_content || '',
      expected_check_in: data.expected_check_in || r.booking_check_in || '',
      expected_check_out: data.expected_check_out || r.booking_check_out || '',
      actual_check_in: r.booking_check_in || '',
      actual_check_out: r.booking_actual_out || '',
      days: items.reduce((s, it) => s + (Number(it.qty) || 0), 0),
      total, deposit: r.deposit_sum || 0, prepaid, balance: total - prepaid,
      cancel_date: data.cancel_date || '', cancel_reason: data.cancel_reason || '', cancel_by: data.cancel_by || '',
      checkin_date: r.booking_check_in || '', booking_status: r.booking_status || '', room_name: r.room_name || '',
      cancelled: r.status === 'cancelled',
      status_label: r.status === 'cancelled' ? '已退訂'
        : r.booking_status === 'checked_in' ? '已入住'
        : r.booking_status === 'checked_out' ? '已出住'
        : r.booking_status === 'reserved' ? '已排房' : '簽約中'
    };
  });
  // signed 模式＝區間內所有合約（含已退訂/出住/入住中），可用排除條件過濾
  rows = rows.filter(r => mode === 'cancelled' ? r.cancelled
    : mode === 'transferred' ? (!r.cancelled && r.booking_status)
    : true);
  if (mode === 'signed') {
    if (req.query.exclude_cancelled === '1') rows = rows.filter(r => !r.cancelled);
    if (req.query.exclude_checkedin === '1') rows = rows.filter(r => !['checked_in', 'checked_out'].includes(r.booking_status));
  }
  // 日期區間（欄位依 mode：預產期/簽約日/退訂日/入住日）
  const DF = { due: 'due_date', sign: 'sign_date', cancel: 'cancel_date', checkin: 'checkin_date' };
  const df = DF[dateField] || (mode === 'transferred' ? 'checkin_date' : 'due_date');
  if (from) rows = rows.filter(r => r[df] && r[df] >= from);
  if (to) rows = rows.filter(r => r[df] && r[df] <= to);
  if (name) rows = rows.filter(r => r.name.includes(name));
  if (kw) {
    if (kwType === 'idno') rows = rows.filter(r => r.id_no.includes(kw));
    else if (kwType === 'phone') rows = rows.filter(r => r.phone.includes(kw));
    else rows = rows.filter(r => r.contract_no.includes(kw));
  }
  if (req.query.format === 'xlsx') {
    const LABEL = { signed: '客戶簽約資料', cancelled: '客戶退訂資料', transferred: '合約轉住房資料' };
    const cols = mode === 'signed' ? [
      { key: 'contract_no', label: '合約號碼' }, { key: 'name', label: '媽媽姓名' },
      { key: 'phone', label: '媽媽手機' }, { key: 'birth_date', label: '媽媽生日' },
      { key: 'due_date', label: '預產期' }, { key: 'expected_check_in', label: '預定入住日' },
      { key: 'expected_check_out', label: '預定出住日' }, { key: 'days', label: '天數' },
      { key: 'room_types', label: '房型' }, { key: 'gift_content', label: '贈品內容' },
      { key: 'handler', label: '經手人' }, { key: 'deposit', label: '訂金' },
      { key: 'total', label: '合約總額' }, { key: 'balance', label: '合約餘額' },
      { key: 'status_label', label: '狀態' }
    ] : mode === 'transferred' ? [
      // 已入住合約取最新 LOG：實際合約總額＝目前合約明細合計
      { key: 'contract_no', label: '合約號碼' }, { key: 'name', label: '媽媽姓名' },
      { key: 'phone', label: '媽媽手機' }, { key: 'birth_date', label: '媽媽生日' },
      { key: 'due_date', label: '預產期' }, { key: 'actual_check_in', label: '實際入住日' },
      { key: 'actual_check_out', label: '實際出住日' }, { key: 'days', label: '天數' },
      { key: 'room_types', label: '房型' }, { key: 'gift_content', label: '贈品內容' },
      { key: 'handler', label: '經手人' }, { key: 'total', label: '實際合約總額' }
    ] : [
      { key: 'contract_no', label: '合約號碼' }, { key: 'name', label: '媽媽姓名' },
      { key: 'id_no', label: '身分證號' }, { key: 'phone', label: '聯絡電話' },
      { key: 'due_date', label: '預產期' }, { key: 'sign_date', label: '簽約日期' },
      { key: 'cancel_date', label: '退訂日期' }, { key: 'cancel_reason', label: '退訂原因' }, { key: 'cancel_by', label: '退訂人' },
      { key: 'summary', label: '合約住宿摘要' }, { key: 'days', label: '天數' },
      { key: 'total', label: '合約總額' }, { key: 'handler', label: '經手人' }
    ];
    const buf = buildWorkbook(LABEL[mode], cols, rows);
    const fname = encodeURIComponent(`${LABEL[mode]}-${today()}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="client-contracts-${mode}.xlsx"; filename*=UTF-8''${fname}`);
    return res.send(buf);
  }
  res.json({ mode, rows });
});

// 合約退訂（原因必填；記稽核）／取消退訂（admin）
app.post('/api/customers/:motherId/contract/cancel', requireStaff, (req, res) => {
  const cur = db.prepare("SELECT * FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(req.params.motherId);
  if (!cur) return res.status(404).json({ error: '尚未建立合約資料' });
  if (cur.status === 'cancelled') return res.status(400).json({ error: '此合約已退訂' });
  const reason = String((req.body || {}).reason || '').trim().slice(0, 200);
  if (!reason) return res.status(400).json({ error: '請填寫退訂原因' });
  let data = {};
  try { data = JSON.parse(cur.data); } catch (e) { data = {}; }
  data.cancel_date = today();
  data.cancel_reason = reason;
  data.cancel_by = req.session.user.name;
  db.prepare(`UPDATE customer_contracts SET status='cancelled', data=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
    .run(JSON.stringify(data).slice(0, 12000), cur.mother_id);
  logAudit(req, { action: 'update', entity: 'customer_contracts', entity_id: cur.mother_id, summary: `合約退訂（${reason}）` });
  res.json({ ok: true });
});
app.post('/api/customers/:motherId/contract/restore', requireAdmin, (req, res) => {
  const cur = db.prepare("SELECT * FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(req.params.motherId);
  if (!cur) return res.status(404).json({ error: '尚未建立合約資料' });
  let data = {};
  try { data = JSON.parse(cur.data); } catch (e) { data = {}; }
  delete data.cancel_date; delete data.cancel_reason; delete data.cancel_by;
  db.prepare(`UPDATE customer_contracts SET status='active', data=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
    .run(JSON.stringify(data), cur.mother_id);
  logAudit(req, { action: 'update', entity: 'customer_contracts', entity_id: cur.mother_id, summary: '取消合約退訂（恢復有效）' });
  res.json({ ok: true });
});

// ---------- 產後報表查詢（19 張報表共用引擎；?format=xlsx 匯出） ----------
// 每張報表＝{ label, columns, run(from,to)→rows }；日期預設當月
const ppDays = (from, to) => {
  const out = [];
  for (let d = new Date(from); d <= new Date(to) && out.length < 366; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};
const ppMonths = (from, to) => {
  const out = [];
  let d = new Date(from.slice(0, 7) + '-01');
  const end = new Date(to.slice(0, 7) + '-01');
  while (d <= end && out.length < 36) {
    out.push(d.toISOString().slice(0, 7));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
};
// 某日佔用房數（reserved 不算、checked_in/checked_out 依期間涵蓋；托嬰室不計入住宿率）
const ppOccupiedOn = date => db.prepare(`SELECT COUNT(DISTINCT bk.room_id) c FROM bookings bk
  JOIN rooms r ON r.id = bk.room_id
  WHERE bk.status IN ('checked_in','checked_out') AND r.room_type != '托嬰'
    AND bk.check_in <= ? AND bk.check_out > ?`).get(date, date).c;

// 滿意度報表：以媽媽發送（提交）日期認定；入住期間＝提交當日在訂房期間內
const SATISFY_Q_COLS = [['d', '提交時間'], ['mother', '媽媽姓名'], ['survey', '問卷'], ['avg', '平均評分'], ['detail', '回覆內容']];
const SATISFY_ST_COLS = [['month', '年-月'], ['survey', '問卷'], ['cnt', '回覆數'], ['avg', '平均評分']];
function satisfyRows(f, t) {
  return db.prepare(`SELECT sr.answers, sr.submitted_at, sr.mother_id, s.title, s.questions, m.name AS mother_name
    FROM survey_responses sr JOIN surveys s ON s.id = sr.survey_id
    LEFT JOIN mothers m ON m.id = sr.mother_id
    WHERE substr(sr.submitted_at,1,10) BETWEEN ? AND ? ORDER BY sr.submitted_at DESC`).all(f, t)
    .map(r => {
      let qs = [], ans = {};
      try { qs = JSON.parse(r.questions); } catch (e) { qs = []; }
      try { ans = JSON.parse(r.answers); } catch (e) { ans = {}; }
      const d = r.submitted_at.slice(0, 10);
      const inStay = r.mother_id ? !!db.prepare(`SELECT 1 FROM bookings
        WHERE mother_id = ? AND status IN ('reserved','checked_in','checked_out')
          AND check_in <= ? AND check_out > ? LIMIT 1`).get(r.mother_id, d, d) : false;
      const ratings = [], parts = [];
      qs.forEach((q, i) => {
        const a = ans[i];
        if (a === undefined || a === null || a === '') return;
        if (q.type === 'rating') { const n = Number(a); if (Number.isFinite(n)) ratings.push(n); }
        parts.push(`${q.label}：${a}`);
      });
      return { d: r.submitted_at.slice(0, 16), month: d.slice(0, 7), mother: r.mother_name || '—',
        survey: r.title, avg: ratings.length ? +(ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(1) : '',
        detail: parts.join('；').slice(0, 300), in_stay: inStay, _ratings: ratings };
    });
}
// 統計以月為單位（月 × 問卷：回覆數、評分題平均）
function satisfyStats(rows) {
  const g = {};
  for (const r of rows) {
    const k = r.month + '|' + r.survey;
    const o = g[k] = g[k] || { month: r.month, survey: r.survey, cnt: 0, sum: 0, n: 0 };
    o.cnt++;
    for (const x of r._ratings) { o.sum += x; o.n++; }
  }
  return Object.values(g)
    .sort((a, b) => b.month.localeCompare(a.month) || a.survey.localeCompare(b.survey))
    .map(o => ({ month: o.month, survey: o.survey, cnt: o.cnt, avg: o.n ? +(o.sum / o.n).toFixed(1) : '—' }));
}

const PP_REPORTS = {
  pay_daily_sum: { label: '產後每日收款統計表', columns: [
    ['d', '收款日'], ['cash', '現金'], ['remit', '匯款'], ['other_m', '其他(方式)'],
    ['deposit', '訂金'], ['stay', '入住款項'], ['final', '尾款'], ['other_i', '其他(項目)'],
    ['income', '收入小計'], ['retail', '產品零售'], ['grand', '全部合計']],
    run: (f, t) => {
      const pays = db.prepare(`SELECT paid_on, amount, method, note, item FROM payments
        WHERE paid_on BETWEEN ? AND ? ORDER BY paid_on`).all(f, t);
      const byDay = {};
      for (const p of pays) {
        const r = byDay[p.paid_on] = byDay[p.paid_on] || { d: p.paid_on, cash: 0, remit: 0, other_m: 0,
          deposit: 0, stay: 0, final: 0, other_i: 0, income: 0, retail: 0, grand: 0 };
        // 項目優先看 item 欄位（收款項目），舊資料回落備註判讀
        const it = (p.item || '').trim(), n = p.note || '';
        const isRetail = it === '商城零售' || n.includes('產品零售');
        const m = (p.method || '').includes('現金') ? 'cash' : /匯|轉帳/.test(p.method || '') ? 'remit' : 'other_m';
        r[m] += p.amount;
        if (isRetail) r.retail += p.amount;
        else {
          if (it === '訂金' || n.startsWith('訂金')) r.deposit += p.amount;
          else if (it === '房費' || n.startsWith('房費') || n.includes('入住')) r.stay += p.amount;
          else if (it === '尾款' || n.startsWith('尾款')) r.final += p.amount;
          else r.other_i += p.amount;
          r.income += p.amount;
        }
        r.grand += p.amount;
      }
      return Object.values(byDay);
    } },
  pay_daily_detail: { label: '產後每日收款明細表', columns: [
    ['paid_on', '收款日期'], ['mother', '媽媽姓名'], ['room', '房號'], ['method', '收款方式'],
    ['deposit', '訂金10%'], ['d10', '10日款'], ['d20', '20日款'], ['final', '尾款'],
    ['other', '其他收入'], ['adjust', '加退費款項'], ['subtotal', '小計']],
    run: (f, t) => db.prepare(`SELECT p.paid_on, m.name mother, r.name room, p.method, p.note, p.amount
      FROM payments p JOIN bookings bk ON bk.id = p.booking_id
      JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
      WHERE p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on, p.id`).all(f, t).map(p => {
      const row = { paid_on: p.paid_on, mother: p.mother, room: p.room, method: p.method,
        deposit: 0, d10: 0, d20: 0, final: 0, other: 0, adjust: 0, subtotal: p.amount };
      const n = p.note || '';
      if (n.startsWith('訂金')) row.deposit = p.amount;
      else if (n.startsWith('房費') || n.includes('入住') || n.includes('10日')) row.d10 = p.amount;
      else if (n.includes('20日')) row.d20 = p.amount;
      else if (n.startsWith('尾款')) row.final = p.amount;
      else if (n.includes('退費') || n.includes('加退')) row.adjust = p.amount;
      else row.other = p.amount;
      return row;
    }) },
  revenue_month: { label: '產後營收統計分析表', columns: [
    ['d', '日期'], ['visited', '已參訪人數'], ['scheduled', '預約參訪人數'],
    ['dep_cnt', '已付訂人數'], ['dep_amt', '已付訂金額'], ['res_unpaid', '已預約未付訂'],
    ['checkins', '住房人次'], ['stay_amt', '住房金額']],
    run: (f, t) => ppDays(f, t).map(d => ({
      d,
      visited: db.prepare(`SELECT COUNT(*) c FROM tours WHERE substr(tour_at,1,10)=? AND status IN ('visited','signed')`).get(d).c,
      scheduled: db.prepare(`SELECT COUNT(*) c FROM tours WHERE substr(tour_at,1,10)=? AND status='scheduled'`).get(d).c,
      dep_cnt: db.prepare(`SELECT COUNT(*) c FROM payments WHERE paid_on=? AND note LIKE '訂金%'`).get(d).c,
      dep_amt: db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE paid_on=? AND note LIKE '訂金%'`).get(d).s,
      res_unpaid: db.prepare(`SELECT COUNT(*) c FROM bookings bk WHERE substr(bk.created_at,1,10)=? AND bk.status='reserved'
        AND bk.continued_from IS NULL
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id=bk.id)`).get(d).c,
      // 切段接續（期間變更／轉房／拆分）不重算人次；金額沿接續鏈併回原入住日
      checkins: db.prepare(`SELECT COUNT(*) c FROM bookings WHERE check_in=? AND status IN ('checked_in','checked_out')
        AND continued_from IS NULL`).get(d).c,
      stay_amt: db.prepare(`WITH RECURSIVE chain(id, total_amount) AS (
          SELECT id, total_amount FROM bookings WHERE check_in=? AND status IN ('checked_in','checked_out') AND continued_from IS NULL
          UNION ALL
          SELECT b.id, b.total_amount FROM bookings b JOIN chain c ON b.continued_from = c.id WHERE b.status != 'cancelled'
        ) SELECT COALESCE(SUM(total_amount),0) s FROM chain`).get(d).s
    })) },
  // 商城商品銷售／加購項目收入：以收款日認定，支援 入住日期/收款日期/媽媽姓名/特定商品 搜尋
  supply_sales: { label: '商城商品銷售明細表', columns: [
    ['mother', '媽媽姓名'], ['category', '商品類別'], ['item', '商城商品明細'], ['qty', '數量'],
    ['price', '單價'], ['subtotal', '金額'], ['d', '收款日期'], ['checkin', '入住日期'], ['by', '建檔人']],
    run: (f, t, q) => db.prepare(`SELECT substr(o.created_at,1,10) d, m.name mother,
      COALESCE(pr.category,'') category, oi.item_name item, oi.quantity qty, oi.unit_price price,
      oi.quantity*oi.unit_price subtotal, u.name by,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in','checked_out')
        ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS checkin
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products pr ON pr.id = oi.product_id
      LEFT JOIN mothers m ON m.id = o.mother_id LEFT JOIN users u ON u.id = o.created_by
      WHERE o.status='confirmed' ORDER BY o.created_at DESC`).all()
      .filter(r => {
        const dv = q.date_field === 'checkin' ? r.checkin : r.d;
        return dv && dv >= f && dv <= t;
      })
      .filter(r => !q.cat || r.category === q.cat)
      .filter(r => !q.name || (r.mother || '').includes(q.name))
      .filter(r => !q.item || (r.item || '').includes(q.item)) },
  retail_detail: { label: '加購項目收入明細表', columns: [
    ['mother', '媽媽姓名'], ['item', '加購項目明細'], ['qty', '數量'],
    ['price', '單價'], ['subtotal', '金額'], ['d', '收款日期'], ['checkin', '入住日期'], ['by', '經手人']],
    run: (f, t, q) => db.prepare(`SELECT ci.charged_on d, m.name mother, ci.item_name item,
      ci.unit_price price, ci.quantity qty, ci.unit_price*ci.quantity subtotal, u.name by, bk.check_in AS checkin
      FROM charge_items ci JOIN bookings bk ON bk.id = ci.booking_id
      JOIN mothers m ON m.id = bk.mother_id LEFT JOIN users u ON u.id = ci.created_by
      ORDER BY ci.charged_on DESC, ci.id DESC`).all()
      .filter(r => {
        const dv = q.date_field === 'checkin' ? r.checkin : r.d;
        return dv && dv >= f && dv <= t;
      })
      .filter(r => !q.name || (r.mother || '').includes(q.name))
      .filter(r => !q.item || (r.item || '').includes(q.item)) },
  occupancy_detail: { label: '住宿率明細表', columns: [
    ['d', '查詢日期'], ['occupied', '已入住(間)'], ['not_in', '尚未入住(間)'], ['subtotal', '住房小計(間)'],
    ['rate', '單日住宿率'], ['cum_rate', '累積住宿率']],
    run: (f, t) => {
      const total = db.prepare("SELECT COUNT(*) c FROM rooms WHERE active=1 AND room_type != '托嬰'").get().c || 1;
      let cumSub = 0, cumCap = 0;
      return ppDays(f, t).map(d => {
        const occ = ppOccupiedOn(d);
        const notIn = db.prepare(`SELECT COUNT(DISTINCT room_id) c FROM bookings
          WHERE status = 'reserved' AND check_in <= ? AND check_out > ?`).get(d, d).c;
        const sub = occ + notIn;
        cumSub += sub; cumCap += total;
        return { d, occupied: occ, not_in: notIn, subtotal: sub,
          rate: (sub / total * 100).toFixed(2) + ' %', cum_rate: (cumSub / cumCap * 100).toFixed(2) + ' %' };
      });
    } },
  occupancy_month: { label: '住宿率統計表', columns: [
    ['month', '查詢月份'], ['occupied', '已入住(天)'], ['not_in', '尚未入住(天)'], ['subtotal', '住房小計(天)'], ['rate', '住宿率']],
    run: (f, t) => {
      const total = db.prepare("SELECT COUNT(*) c FROM rooms WHERE active=1 AND room_type != '托嬰'").get().c || 1;
      return ppMonths(f, t).map(month => {
        const last = new Date(new Date(month + '-01').getFullYear(), new Date(month + '-01').getMonth() + 1, 0);
        const days = ppDays(month + '-01', last.toISOString().slice(0, 10));
        let occ = 0, notIn = 0;
        for (const d of days) {
          occ += ppOccupiedOn(d);
          notIn += db.prepare(`SELECT COUNT(DISTINCT room_id) c FROM bookings
            WHERE status = 'reserved' AND check_in <= ? AND check_out > ?`).get(d, d).c;
        }
        return { month, occupied: occ, not_in: notIn, subtotal: occ + notIn,
          rate: ((occ + notIn) / (total * days.length) * 100).toFixed(2) + ' %' };
      });
    } },
  stay_days_month: { label: '媽媽入住天數查詢', columns: [
    ['month', '年-月'], ['moms', '媽媽住房人數'], ['babies', '寶寶住房人數'],
    ['mom_days', '媽媽入住總天數'], ['baby_days', '寶寶入住總天數'], ['avg_days', '平均入住天數'],
    ['rate', '住宿率'], ['checkouts', '退房人數'], ['cancels', '退訂人數'],
    ['new_moms', '新入住媽媽人數'], ['new_babies', '新入住寶寶人數']],
    run: (f, t) => {
      const total = db.prepare("SELECT COUNT(*) c FROM rooms WHERE active=1 AND room_type != '托嬰'").get().c || 1;
      const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
      return ppMonths(f, t).map(month => {
        const mStart = month + '-01';
        const mEndD = new Date(new Date(mStart).getFullYear(), new Date(mStart).getMonth() + 1, 0);
        const mEnd = mEndD.toISOString().slice(0, 10);
        const mDays = mEndD.getDate();
        const bks = db.prepare(`SELECT bk.*, m.id mid FROM bookings bk JOIN mothers m ON m.id = bk.mother_id
          WHERE bk.status IN ('checked_in','checked_out') AND bk.check_in <= ? AND bk.check_out > ?`).all(mEnd, mStart);
        const momSet = new Set(bks.map(b => b.mid));
        let momDays = 0, babyDays = 0;
        const clipDays = (a, b) => Math.max(0, dayDiff(a < mStart ? mStart : a,
          b > mEnd ? new Date(new Date(mEnd).getTime() + 86400000).toISOString().slice(0, 10) : b));
        for (const b of bks) {
          momDays += clipDays(b.check_in, b.check_out);
          if (b.baby_check_in) babyDays += clipDays(b.baby_check_in < b.check_in ? b.check_in : b.baby_check_in, b.check_out);
        }
        const babyCnt = momSet.size ? db.prepare(`SELECT COUNT(*) c FROM babies
          WHERE mother_id IN (${[...momSet].join(',')})`).get().c : 0;
        return {
          month, moms: momSet.size, babies: babyCnt, mom_days: momDays, baby_days: babyDays,
          avg_days: momSet.size ? Math.round(momDays / momSet.size) : 0,
          rate: (momDays / (total * mDays) * 100).toFixed(2) + ' %',
          // 切段接續段不計入出住／新收人次（避免同一住客被算兩次）
          checkouts: db.prepare(`SELECT COUNT(*) c FROM bookings bk WHERE bk.status='checked_out' AND substr(bk.check_out,1,7)=?
            AND NOT EXISTS (SELECT 1 FROM bookings s WHERE s.continued_from = bk.id AND s.status != 'cancelled')`).get(month).c,
          cancels: db.prepare(`SELECT COUNT(*) c FROM customer_contracts WHERE status='cancelled'
            AND substr(json_extract(data,'$.cancel_date'),1,7)=?`).get(month).c
            + db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status='cancelled' AND substr(check_in,1,7)=?`).get(month).c,
          new_moms: db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status IN ('checked_in','checked_out') AND substr(check_in,1,7)=?
            AND continued_from IS NULL`).get(month).c,
          new_babies: db.prepare(`SELECT COUNT(*) c FROM bookings WHERE baby_check_in IS NOT NULL AND substr(baby_check_in,1,7)=?
            AND continued_from IS NULL`).get(month).c
        };
      });
    } },
  checkin_info: { label: '媽媽入住資訊查詢', columns: [
    ['mother', '媽媽姓名'], ['room', '房號'], ['period', '入住期間'], ['days', '入住天數'],
    ['note', '內容'], ['created', '建檔時間']],
    run: (f, t, q) => {
      const byCreated = q.date_field !== 'checkin';
      const rows = db.prepare(`SELECT m.name mother, r.name room,
        bk.check_in || ' ~ ' || bk.check_out period,
        CAST(julianday(bk.check_out)-julianday(bk.check_in) AS INT) || '天' days,
        bk.notes note, bk.created_at created, bk.check_in ci, substr(bk.created_at,1,10) cd
        FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
        WHERE bk.status != 'cancelled' ORDER BY bk.check_in DESC`).all()
        .filter(r => (byCreated ? r.cd : r.ci) >= f && (byCreated ? r.cd : r.ci) <= t)
        .filter(r => !q.name || r.mother.includes(q.name));
      return rows.map(({ ci, cd, ...rest }) => rest);
    } },
  cancel_stats: { label: '退訂資料統計表', columns: [
    ['cancel_date', '退訂日期'], ['due_date', '預產期'], ['mother', '媽媽姓名'],
    ['kind', '分類'], ['reason', '退訂原因'], ['by', '建檔人']],
    run: (f, t, q) => {
      const out = [];
      if (!q.kind || q.kind === 'contract') {
        for (const c of db.prepare(`SELECT cc.data, m.name, m.due_date FROM customer_contracts cc
          JOIN mothers m ON m.id = cc.mother_id WHERE cc.status='cancelled'`).all()) {
          let d = {};
          try { d = JSON.parse(c.data); } catch (e) { continue; }
          if (d.cancel_date && d.cancel_date >= f && d.cancel_date <= t) {
            out.push({ cancel_date: d.cancel_date, due_date: c.due_date || '', mother: c.name,
              kind: '合約退訂', reason: d.cancel_reason || '', by: d.cancel_by || '' });
          }
        }
      }
      if (!q.kind || q.kind === 'booking') {
        for (const b of db.prepare(`SELECT substr(bk.created_at,1,10) cd, m.name, m.due_date, bk.notes
          FROM bookings bk JOIN mothers m ON m.id = bk.mother_id WHERE bk.status='cancelled'`).all()) {
          if (b.cd >= f && b.cd <= t) out.push({ cancel_date: b.cd, due_date: b.due_date || '',
            mother: b.name, kind: '訂房取消', reason: b.notes || '', by: '' });
        }
      }
      return out.filter(r => !q.name || r.mother.includes(q.name))
        .sort((a, b) => b.cancel_date < a.cancel_date ? -1 : 1);
    } },
  tour_conversion: { label: '參觀成交率分析表', columns: [
    ['month', '參觀月份'], ['visits', '參觀人次'], ['people', '參觀人數'], ['signed', '成交筆數'], ['rate', '成交率']],
    run: (f, t) => ppMonths(f, t).map(month => {
      const rows = db.prepare(`SELECT name, status FROM tours WHERE substr(tour_at,1,7)=?`).all(month);
      const signed = rows.filter(r => r.status === 'signed').length;
      return { month, visits: rows.length, people: new Set(rows.map(r => r.name)).size,
        signed: signed + ' 筆', rate: (rows.length ? Math.round(signed / rows.length * 100) : 0) + ' %' };
    }) },
  checkin_stats: { label: '媽媽入住統計表', columns: [
    ['room', '房號'], ['mother', '媽媽姓名'], ['phone', '聯絡電話'], ['address', '聯絡地址'],
    ['check_in', '入住日期'], ['check_out', '退房日期'], ['days', '入住天數']],
    run: (f, t) => db.prepare(`SELECT r.name room, m.name mother, m.phone, m.id mid,
      bk.check_in, bk.check_out, CAST(julianday(bk.check_out)-julianday(bk.check_in) AS INT) || '天' days
      FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
      WHERE bk.status IN ('checked_in','checked_out') AND bk.check_in BETWEEN ? AND ?
      ORDER BY bk.check_in`).all(f, t).map(r => {
      const prof = db.prepare('SELECT data FROM customer_profiles WHERE mother_id = ?').get(r.mid);
      let addr = '';
      if (prof) { try { addr = JSON.parse(prof.data).address || ''; } catch (e) { /* */ } }
      const { mid, ...rest } = r;
      return { ...rest, address: addr };
    }) },
  order_detail: { label: '媽媽訂單明細查詢', columns: [
    ['mother', '媽媽姓名'], ['hospital', '生產醫院'], ['due_date', '預產期'], ['delivery', '生產方式'],
    ['parity', '胎次'], ['room_type', '坪數/房型'], ['days', '天數'], ['total', '合約金額'],
    ['phone', '媽媽電話'], ['note', '備註']],
    run: (f, t, q) => {
      const bySign = q.date_field === 'sign';
      const out = [];
      for (const c of db.prepare(`SELECT cc.items, cc.data, m.name, m.phone, m.due_date, m.delivery_type
        FROM customer_contracts cc JOIN mothers m ON m.id = cc.mother_id WHERE cc.status='active'`).all()) {
        let items = [], data = {};
        try { items = JSON.parse(c.items); data = JSON.parse(c.data); } catch (e) { continue; }
        const key = bySign ? (data.sign_date || '') : (c.due_date || '');
        if (!key || key < f || key > t) continue;
        out.push({ mother: c.name, hospital: data.checkup_hospital || '', due_date: c.due_date || '',
          delivery: c.delivery_type || '', parity: (data.parity_no || '').replace(/[第胎]/g, '') || '',
          room_type: items.map(it => it.name).join('、') || '—',
          days: items.reduce((s, it) => s + (Number(it.qty) || 0), 0),
          total: items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0),
          phone: c.phone || '', note: data.note || '' });
      }
      return out;
    } },
  cleaning10: { label: '10日打掃明細表', columns: [
    ['d', '應打掃日期'], ['room', '房號'], ['mother', '媽媽姓名'], ['check_in', '入住日期'], ['day_no', '入住第幾天'], ['done', '房務登記']],
    run: (f, t) => {
      const out = [];
      const bks = db.prepare(`SELECT bk.id, bk.check_in, bk.check_out, m.name mother, m.id mid, r.name room, r.id rid
        FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
        WHERE bk.status IN ('checked_in','checked_out') AND bk.check_in <= ? AND bk.check_out >= ?`).all(t, f);
      for (const d of ppDays(f, t)) {
        for (const b of bks) {
          if (d <= b.check_in || d > b.check_out) continue;
          const dayNo = Math.round((new Date(d) - new Date(b.check_in)) / 86400000);
          if (dayNo % 10 !== 0) continue;
          const hk = db.prepare(`SELECT status FROM housekeeping_logs
            WHERE scheduled_for = ? AND (room_id = ? OR mother_id = ?) LIMIT 1`).get(d, b.rid, b.mid);
          out.push({ d, room: b.room, mother: b.mother, check_in: b.check_in,
            day_no: '第 ' + dayNo + ' 天', done: hk ? (hk.status === 'done' ? '已完成' : '已排定') : '未排定' });
        }
      }
      return out;
    } },
  // 寶寶入住天數：訂房期間天數 − 寶寶不在館內天數（依 baby_absences）
  baby_stay_days: { label: '寶寶入住天數查詢', columns: [
    ['name', '媽媽姓名'], ['room', '房號'], ['stay', '入住期間'], ['days', '住宿天數'],
    ['babies', '寶寶數'], ['absent', '不在館內天數'], ['baby_days', '寶寶入住天數']],
    run: (f, t) => db.prepare(`SELECT bk.*, m.name, r.name AS room,
      (SELECT COUNT(*) FROM babies b WHERE b.mother_id = m.id) AS babies
      FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
      WHERE bk.status IN ('reserved','checked_in','checked_out') AND bk.check_in <= ? AND bk.check_out >= ?
      ORDER BY bk.check_in DESC`).all(t, f).map(bk => {
      const days = Math.round((new Date(bk.check_out) - new Date(bk.check_in)) / 86400000);
      const absent = babyAbsenceDays(bk);
      return { name: bk.name, room: bk.room, stay: `${bk.check_in} ~ ${bk.check_out}`,
        days, babies: bk.babies, absent, baby_days: Math.max(0, days - absent) };
    }) },
  // 滿意度：入住期間＝提交當日仍在住（訂房期間內）；出住＝其餘（含退房後填寫）
  satisfy_stay_q: { label: '入住期間滿意度查詢', columns: SATISFY_Q_COLS,
    run: (f, t) => satisfyRows(f, t).filter(r => r.in_stay) },
  satisfy_out_q: { label: '出住滿意度查詢', columns: SATISFY_Q_COLS,
    run: (f, t) => satisfyRows(f, t).filter(r => !r.in_stay) },
  satisfy_stay_stats: { label: '入住期間滿意度統計', columns: SATISFY_ST_COLS,
    run: (f, t) => satisfyStats(satisfyRows(f, t).filter(r => r.in_stay)) },
  satisfy_out_stats: { label: '出住滿意度統計', columns: SATISFY_ST_COLS,
    run: (f, t) => satisfyStats(satisfyRows(f, t).filter(r => !r.in_stay)) },
  baby_out: { label: '寶寶不在館內明細查詢', columns: [
    ['mother', '媽媽姓名'], ['period', '入住期間'], ['baby', '寶寶'], ['baby_period', '住館期間'], ['reasons', '不在館內原因']],
    run: (f, t, q) => {
      const out = [];
      const bks = db.prepare(`SELECT bk.check_in, bk.check_out, bk.baby_check_in, m.id mid, m.name
        FROM bookings bk JOIN mothers m ON m.id = bk.mother_id
        WHERE bk.status IN ('checked_in','checked_out') AND bk.check_in <= ? AND bk.check_out >= ?
        ORDER BY bk.check_in`).all(t, f);
      for (const bk of bks) {
        const babies = db.prepare('SELECT id, name FROM babies WHERE mother_id = ? ORDER BY id').all(bk.mid);
        babies.forEach((b, i) => {
          const logs = db.prepare(`SELECT substr(moved_at,6,5) d, note FROM baby_location_logs
            WHERE baby_id = ? AND location = 'out' ORDER BY moved_at`).all(b.id);
          if (q.only_out === '1' && !logs.length) return;
          out.push({ mother: bk.name, period: bk.check_in.slice(5) + '~' + bk.check_out.slice(5),
            baby: String.fromCharCode(65 + i),
            baby_period: (bk.baby_check_in || bk.check_in).slice(5) + '~' + bk.check_out.slice(5),
            reasons: logs.map(l => `${l.d}:${l.note || '外出'}`).join('\n') || '' });
        });
      }
      return out;
    } },
  early_checkout: { label: '提前退房明細表', columns: [
    ['mother', '媽媽姓名'], ['room', '房號'], ['check_out', '原退房日'], ['days', '原天數'],
    ['actual', '提前退房日'], ['early_days', '提前天數'], ['reason', '提前退房原因']],
    run: (f, t, q) => db.prepare(`SELECT m.name mother, r.name room, bk.check_out,
      CAST(julianday(bk.check_out)-julianday(bk.check_in) AS INT) days,
      bk.actual_check_out actual,
      CAST(julianday(bk.check_out)-julianday(bk.actual_check_out) AS INT) early_days,
      bk.early_reason reason
      FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
      WHERE bk.status='checked_out' AND bk.actual_check_out != '' AND bk.actual_check_out < bk.check_out
        AND bk.actual_check_out BETWEEN ? AND ?
      ORDER BY bk.actual_check_out DESC`).all(f, t)
      .filter(r => !q.name || r.mother.includes(q.name)) },
  baby_detail: { label: '寶寶資料明細表', columns: [
    ['mother', '媽媽姓名'], ['baby', '寶寶姓名'], ['birth_date', '寶寶生日'], ['phone', '聯絡電話'], ['address', '地址']],
    run: (f, t, q) => {
      const rows = db.prepare(`SELECT b.mother_id, b.name bname, b.gender, b.birth_date, m.name mother, m.phone
        FROM babies b JOIN mothers m ON m.id = b.mother_id
        WHERE b.birth_date != '' AND b.birth_date BETWEEN ? AND ? ORDER BY b.birth_date, b.mother_id, b.id`).all(f, t)
        .filter(r => !q.name || r.mother.includes(q.name));
      const seq = {};
      return rows.map(r => {
        seq[r.mother_id] = (seq[r.mother_id] || 0) + 1;
        const prof = db.prepare('SELECT data FROM customer_profiles WHERE mother_id = ?').get(r.mother_id);
        let addr = '';
        if (prof) { try { addr = JSON.parse(prof.data).address || ''; } catch (e) { /* */ } }
        return { mother: r.mother,
          baby: String.fromCharCode(64 + seq[r.mother_id]) + (r.gender === 'male' ? '(男)' : r.gender === 'female' ? '(女)' : ''),
          birth_date: r.birth_date, phone: r.phone || '', address: addr };
      });
    } },
  ar_detail: { label: '媽媽應收帳款明細表', columns: [
    ['contract_no', '合約編號'], ['mother', '媽媽姓名'], ['sign_date', '簽約日'], ['due_date', '預產期'],
    ['room_type', '坪數/房型'], ['days', '天數'], ['check_in', '入住日'], ['check_out', '退房日'],
    ['total', '合約金額'], ['spent', '實際消費金額'], ['paid', '已收金額'], ['balance', '應收餘額']],
    run: (f, t, q) => {
      const out = [];
      for (const c of db.prepare(`SELECT cc.contract_no, cc.items, cc.data, m.id mid, m.name, m.due_date
        FROM customer_contracts cc JOIN mothers m ON m.id = cc.mother_id WHERE cc.status='active'`).all()) {
        let items = [], data = {};
        try { items = JSON.parse(c.items); data = JSON.parse(c.data); } catch (e) { continue; }
        const bk = db.prepare(`SELECT id, check_in, check_out FROM bookings
          WHERE mother_id = ? AND status IN ('reserved','checked_in','checked_out')
          ORDER BY status='checked_in' DESC, check_in DESC LIMIT 1`).get(c.mid);
        const DF = { due: c.due_date || '', sign: data.sign_date || '',
          checkin: bk ? bk.check_in : '', checkout: bk ? bk.check_out : '' };
        const key = DF[q.date_field] ?? DF.due;
        if (!key || key < f || key > t) continue;
        const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
        const spent = bk ? db.prepare(`SELECT COALESCE(SUM(unit_price*quantity),0) s FROM charge_items WHERE booking_id=?`).get(bk.id).s : 0;
        const paid = bk ? db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE booking_id=?`).get(bk.id).s : 0;
        out.push({ contract_no: c.contract_no, mother: c.name, sign_date: data.sign_date || '',
          due_date: c.due_date || '', room_type: items.map(it => it.name).join('、') || '—',
          days: items.reduce((s, it) => s + (Number(it.qty) || 0), 0),
          check_in: bk ? bk.check_in : '', check_out: bk ? bk.check_out : '',
          total, spent, paid, balance: total + spent - paid });
      }
      return out;
    } },
  room_card_usage: { label: '住房卡使用明細表', columns: [
    ['mother', '媽媽'], ['contract_no', '合約編號'], ['kind', '卡別'], ['action', '動作'], ['d', '日期'], ['card_no', '卡號'], ['by', '存檔人']],
    run: (f, t) => {
      const out = [];
      for (const c of db.prepare('SELECT cc.contract_no, cc.data, m.name FROM customer_contracts cc JOIN mothers m ON m.id=cc.mother_id').all()) {
        let d = {};
        try { d = JSON.parse(c.data); } catch (e) { continue; }
        const push = (kind, action, dt, no, by) => {
          if (dt && dt >= f && dt <= t) out.push({ mother: c.name, contract_no: c.contract_no, kind, action, d: dt, card_no: no || '', by: by || '' });
        };
        push('住房卡', '贈送', d.room_card_given_date, d.room_card_no, d.room_card_given_by);
        push('住房卡', '抵用', d.room_card_used_date, d.room_card_used_no, d.room_card_used_by);
        push('分享卡', '贈送', d.share_card_given_date, d.share_card_no, d.share_card_given_by);
        push('分享卡', '抵用', d.share_card_used_date, d.share_card_used_no, d.share_card_used_by);
      }
      return out.sort((a, b) => b.d < a.d ? -1 : 1);
    } },
  // ---------- 護理紀錄資料 ----------
  // 已出住照護資料查詢：僅「已退住」媽寶，媽寶照護資料整合成一本，依媽媽姓名／月份查詢
  discharged_care_q: { label: '已出住照護資料查詢', columns: [
    ['month', '歸檔月份'], ['dt', '護理日期'], ['kind', '類別'], ['who', '媽媽／寶寶'],
    ['summary', '照護摘要'], ['nurse', '護理師']],
    run: (f, t, q) => {
      const name = (q.name || '').trim();
      const moms = db.prepare(`SELECT a.assess_date, a.assess_time, m.name mother,
        a.temperature, a.pulse, a.respiration, a.systolic, a.diastolic, a.data, u.name nurse
        FROM mother_nursing_assessments a JOIN mothers m ON m.id = a.mother_id
        LEFT JOIN users u ON u.id = a.nurse_id
        WHERE m.status = 'checked_out' AND a.assess_date BETWEEN ? AND ?`).all(f, t);
      const babies = db.prepare(`SELECT a.assess_date, a.assess_time, b.name baby, m.name mother,
        a.weight_g, a.temperature, a.data, u.name nurse
        FROM baby_nursing_assessments a JOIN babies b ON b.id = a.baby_id JOIN mothers m ON m.id = b.mother_id
        LEFT JOIN users u ON u.id = a.nurse_id
        WHERE m.status = 'checked_out' AND a.assess_date BETWEEN ? AND ?`).all(f, t);
      const rows = [];
      for (const r of moms) {
        if (name && !r.mother.includes(name)) continue;
        let d = {}; try { d = JSON.parse(r.data); } catch (e) { d = {}; }
        rows.push({ _mother: r.mother, month: (r.assess_date || '').slice(0, 7),
          dt: `${r.assess_date} ${r.assess_time}`, kind: '媽媽', who: r.mother,
          summary: [`${r.temperature}°C 脈${r.pulse} 呼${r.respiration} ${r.systolic}/${r.diastolic}`,
            d.wound && `傷口:${d.wound}`, d.uterus && `宮縮:${d.uterus}`,
            (d.lochia_amount || d.lochia_color) && `惡露:${[d.lochia_amount, d.lochia_color].filter(Boolean).join('/')}`,
            d.bf_skill && `親餵:${d.bf_skill}`].filter(Boolean).join('｜'),
          nurse: r.nurse || '' });
      }
      for (const r of babies) {
        if (name && !r.mother.includes(name)) continue;
        let d = {}; try { d = JSON.parse(r.data); } catch (e) { d = {}; }
        rows.push({ _mother: r.mother, month: (r.assess_date || '').slice(0, 7),
          dt: `${r.assess_date} ${r.assess_time}`, kind: '寶寶', who: `${r.baby}（${r.mother}）`,
          summary: [r.weight_g && `${r.weight_g}g`, r.temperature && `${r.temperature}°C`,
            d.cord && `臍帶:${d.cord}`, d.skin_color && `膚色:${d.skin_color}`,
            (d.milk_types || []).join ? (d.milk_types || []).join('/') : d.milk_types].filter(Boolean).join('｜'),
          nurse: r.nurse || '' });
      }
      // 整合成一本：先依媽媽姓名、再依月份／日期排序（同一媽媽的媽寶資料集中、按月歸檔）
      rows.sort((a, b) => a._mother.localeCompare(b._mother, 'zh-Hant') || (a.month < b.month ? 1 : a.month > b.month ? -1 : (a.dt < b.dt ? 1 : -1)));
      return rows.map(({ _mother, ...r }) => r);
    } },
  bf_rate: { label: '母乳哺育率報表', columns: [
    ['mother', '媽媽姓名'], ['check_in', '入住日期'], ['bf_count', '親餵次數'], ['breast_ml', '母乳量(cc)'],
    ['formula_ml', '配方奶量(cc)'], ['total_ml', '喝奶總量(cc)'], ['pure_rate', '純母乳比例(%)'], ['total_rate', '總母乳比例(%)']],
    run: (f, t) => db.prepare(`SELECT m.id mid, m.name mother, bk.check_in
      FROM bookings bk JOIN mothers m ON m.id = bk.mother_id
      WHERE bk.status IN ('checked_in','checked_out') AND bk.check_in BETWEEN ? AND ?
      ORDER BY bk.check_in`).all(f, t).map(r => {
      const feeds = db.prepare(`SELECT fr.feed_method, fr.amount_ml FROM baby_records fr
        JOIN babies b ON b.id = fr.baby_id WHERE b.mother_id = ? AND fr.record_type='feeding'`).all(r.mid);
      const bfCount = feeds.filter(x => /親/.test(x.feed_method || '')).length;
      const breastMl = feeds.filter(x => /母|親/.test(x.feed_method || '')).reduce((s, x) => s + (x.amount_ml || 0), 0);
      const formulaMl = feeds.filter(x => /配方/.test(x.feed_method || '')).reduce((s, x) => s + (x.amount_ml || 0), 0);
      const total = breastMl + formulaMl;
      return { mother: r.mother, check_in: r.check_in, bf_count: bfCount, breast_ml: breastMl,
        formula_ml: formulaMl, total_ml: total,
        pure_rate: (total && formulaMl === 0 ? 100 : total ? Math.round(breastMl / total * 100) : 0) + ' %',
        total_rate: (total ? Math.round(breastMl / total * 100) : 0) + ' %' };
    }) },
  rooming_stats: { label: '親子同室統計分析', columns: [
    ['d', '查詢日期'], ['moms', '產婦人數'], ['lt12', '<12小時人數'], ['ge12', '>=12小時人數'],
    ['ge23', '>=23小時人數'], ['p12', '12小時%'], ['p24', '24小時%']],
    run: (f, t) => ppDays(f, t).map(d => {
      const moms = db.prepare(`SELECT COUNT(DISTINCT mother_id) c FROM bookings
        WHERE status IN ('checked_in','checked_out') AND check_in <= ? AND check_out > ?`).get(d, d).c;
      // 每寶寶當日同室時數
      const byBaby = {};
      for (const l of db.prepare(`SELECT baby_id, out_time, return_time FROM baby_rooming_logs
        WHERE log_date = ? AND out_time != '' AND return_time != ''`).all(d)) {
        const [oh, om] = l.out_time.split(':').map(Number), [rh, rm] = l.return_time.split(':').map(Number);
        let h = (rh * 60 + rm - oh * 60 - om) / 60;
        if (h < 0) h += 24;
        byBaby[l.baby_id] = (byBaby[l.baby_id] || 0) + h;
      }
      const hrs = Object.values(byBaby);
      const lt12 = hrs.filter(h => h < 12).length;
      const ge12 = hrs.filter(h => h >= 12).length;
      const ge23 = hrs.filter(h => h >= 23).length;
      return { d, moms, lt12, ge12, ge23,
        p12: (moms ? Math.round(ge12 / moms * 100) : 0) + ' %',
        p24: (moms ? Math.round(ge23 / moms * 100) : 0) + ' %' };
    }) },
  infection_quality: { label: '護理感控品質查詢', columns: [
    ['month', '品管月份'], ['moms', '媽媽人數'], ['m_fever', '媽媽發燒'], ['m_mastitis', '乳腺炎'],
    ['m_uri', '上呼吸道感染'], ['m_uti', '泌尿道感染'], ['m_entero', '腸病毒'],
    ['babies', '寶寶人數'], ['b_fever', '寶寶發燒'], ['rash_late', '入住一周後紅臀'], ['rash_early', '入院即紅臀'],
    ['hygiene', '洗手遵從率'], ['clusters', '群聚事件']],
    run: (f, t) => ppMonths(f, t).map(month => {
      const mStart = month + '-01';
      const mEndD = new Date(new Date(mStart).getFullYear(), new Date(mStart).getMonth() + 1, 0);
      const mEnd = mEndD.toISOString().slice(0, 10);
      const momIds = db.prepare(`SELECT DISTINCT mother_id id FROM bookings
        WHERE status IN ('checked_in','checked_out') AND check_in <= ? AND check_out > ?`).all(mEnd, mStart).map(r => r.id);
      const probCount = kw => momIds.length ? db.prepare(`SELECT COUNT(DISTINCT mother_id) c FROM mother_health_problems
        WHERE mother_id IN (${momIds.join(',')}) AND substr(start_date,1,7) = ? AND item LIKE ?`).get(month, `%${kw}%`).c : 0;
      // 媽媽發燒：護理評估體溫≥37.5 的媽媽數
      const mFever = momIds.length ? db.prepare(`SELECT COUNT(DISTINCT mother_id) c FROM mother_nursing_assessments
        WHERE mother_id IN (${momIds.join(',')}) AND substr(assess_date,1,7)=? AND temperature >= 37.5`).get(month).c : 0;
      const babyRows = momIds.length ? db.prepare(`SELECT id, mother_id FROM babies WHERE mother_id IN (${momIds.join(',')})`).all() : [];
      const babyIds = babyRows.map(b => b.id);
      const bFever = babyIds.length ? db.prepare(`SELECT COUNT(DISTINCT baby_id) c FROM baby_records
        WHERE baby_id IN (${babyIds.join(',')}) AND record_type='temperature' AND value_num >= 37.5
        AND substr(recorded_at,1,7)=?`).get(month).c : 0;
      // 紅臀：該月首次 diaper_rash 距媽媽入住 >7 天=入住一周後；<=7 天=入院即
      let rashLate = 0, rashEarly = 0;
      for (const b of babyRows) {
        const first = db.prepare(`SELECT MIN(substr(recorded_at,1,10)) d FROM baby_records
          WHERE baby_id = ? AND diaper_rash != '' AND substr(recorded_at,1,7)=?`).get(b.id, month).d;
        if (!first) continue;
        const ci = db.prepare(`SELECT check_in FROM bookings WHERE mother_id = ? AND status IN ('checked_in','checked_out')
          ORDER BY check_in DESC LIMIT 1`).get(b.mother_id);
        if (ci && (new Date(first) - new Date(ci.check_in)) / 86400000 > 7) rashLate++;
        else rashEarly++;
      }
      const h = db.prepare(`SELECT COALESCE(SUM(opportunities),0) o, COALESCE(SUM(compliant),0) cp
        FROM hand_hygiene_audits WHERE substr(audit_date,1,7)=?`).get(month);
      return { month, moms: momIds.length, m_fever: mFever, m_mastitis: probCount('乳腺'),
        m_uri: probCount('呼吸道'), m_uti: probCount('泌尿'), m_entero: probCount('腸病毒'),
        babies: babyIds.length, b_fever: bFever, rash_late: rashLate, rash_early: rashEarly,
        hygiene: (h.o ? Math.round(h.cp / h.o * 100) : 0) + ' %',
        clusters: db.prepare(`SELECT COUNT(*) c FROM cluster_events WHERE substr(onset_date,1,7)=?`).get(month).c };
    }) },
  epds_q: { label: '愛丁堡憂鬱量查詢', columns: [
    ['fill_date', '填表日期'], ['mother', '媽媽'], ['total', '總分'], ['result', '判定'], ['alert', '警示'], ['nurse', '填表人']],
    run: (f, t, q) => db.prepare(`SELECT s.fill_date, m.name mother, s.total, s.answers, u.name nurse
      FROM mother_scales s JOIN mothers m ON m.id = s.mother_id LEFT JOIN users u ON u.id = s.nurse_id
      WHERE s.kind='epds' AND s.fill_date BETWEEN ? AND ? ORDER BY s.fill_date DESC`).all(f, t)
      .filter(r => !q.name || r.mother.includes(q.name)).map(r => {
      let a = {};
      try { a = JSON.parse(r.answers); } catch (e) { a = {}; }
      const ans = Array.isArray(a) ? a : (a.a || []);
      const alert = (r.total || 0) >= 10 || (ans[9] || 0) > 0;
      const { answers, ...rest } = r;
      return { ...rest, result: (Array.isArray(a) ? '' : a.result) || '', alert: alert ? '⚠ 建議關注' : '' };
    }) },
  epds_stats: { label: '愛丁堡憂鬱量統計', columns: [
    ['month', '品管月份'], ['inhouse', '入住人數'], ['s0_5', '0~5分'], ['s6_9', '6~9分'], ['s10_15', '10~15分'], ['s16_21', '16~21分']],
    run: (f, t) => ppMonths(f, t).map(month => {
      const mStart = month + '-01';
      const mEndD = new Date(new Date(mStart).getFullYear(), new Date(mStart).getMonth() + 1, 0);
      const mEnd = mEndD.toISOString().slice(0, 10);
      const rows = db.prepare(`SELECT total FROM mother_scales WHERE kind='epds' AND substr(fill_date,1,7)=?`).all(month);
      return { month,
        inhouse: db.prepare(`SELECT COUNT(DISTINCT mother_id) c FROM bookings
          WHERE status IN ('checked_in','checked_out') AND check_in <= ? AND check_out > ?`).get(mEnd, mStart).c,
        s0_5: rows.filter(r => r.total <= 5).length,
        s6_9: rows.filter(r => r.total >= 6 && r.total <= 9).length,
        s10_15: rows.filter(r => r.total >= 10 && r.total <= 15).length,
        s16_21: rows.filter(r => r.total >= 16).length };
    }) },
  person_days: { label: '入住人日數統計表', columns: [
    ['month', '統計月份'], ['mom_days', '媽媽人日數'], ['baby_days', '寶寶人日數']],
    run: (f, t) => ppMonths(f, t).map(month => {
      const mStart = month + '-01';
      const mEndD = new Date(new Date(mStart).getFullYear(), new Date(mStart).getMonth() + 1, 0);
      const mEnd = mEndD.toISOString().slice(0, 10);
      const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
      const clip = (a, b) => Math.max(0, dayDiff(a < mStart ? mStart : a,
        b > mEnd ? new Date(new Date(mEnd).getTime() + 86400000).toISOString().slice(0, 10) : b));
      let momDays = 0, babyDays = 0;
      for (const bk of db.prepare(`SELECT check_in, check_out, baby_check_in, mother_id FROM bookings
        WHERE status IN ('checked_in','checked_out') AND check_in <= ? AND check_out > ?`).all(mEnd, mStart)) {
        momDays += clip(bk.check_in, bk.check_out);
        const babies = db.prepare('SELECT COUNT(*) c FROM babies WHERE mother_id = ?').get(bk.mother_id).c;
        if (babies) babyDays += clip(bk.baby_check_in && bk.baby_check_in > bk.check_in ? bk.baby_check_in : bk.check_in, bk.check_out) * babies;
      }
      return { month, mom_days: momDays, baby_days: babyDays };
    }) },
  inout_month: { label: '產後出入住月報表', columns: [
    ['d', '日期'], ['in_cnt', '入住人數'], ['out_cnt', '出住人數'], ['total', '本日總人數']],
    run: (f, t) => ppDays(f, t).map(d => ({
      d,
      // 切段接續段不計入出入住人數（同一住客換房／變更不重算）
      in_cnt: db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status IN ('checked_in','checked_out') AND check_in = ?
        AND continued_from IS NULL`).get(d).c,
      out_cnt: db.prepare(`SELECT COUNT(*) c FROM bookings bk WHERE bk.status='checked_out'
        AND (CASE WHEN bk.actual_check_out != '' THEN bk.actual_check_out ELSE bk.check_out END) = ?
        AND NOT EXISTS (SELECT 1 FROM bookings s WHERE s.continued_from = bk.id AND s.status != 'cancelled')`).get(d).c,
      total: db.prepare(`SELECT COUNT(DISTINCT mother_id) c FROM bookings
        WHERE status IN ('checked_in','checked_out') AND check_in <= ? AND check_out > ?`).get(d, d).c
    })) },
  mom_rooming: { label: '媽媽親子同室統計', columns: [
    ['room', '房號'], ['mother', '媽媽姓名'], ['period', '入住期間'], ['days', '入住天數'],
    ['ge12', '同室>=12小時天數'], ['ge23', '同室>=23小時天數']],
    run: (f, t, q) => {
      const out = [];
      for (const bk of db.prepare(`SELECT bk.mother_id, bk.check_in, bk.check_out, m.name mother, r.name room
        FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
        WHERE bk.status IN ('checked_in','checked_out') AND bk.check_in BETWEEN ? AND ?
        ORDER BY bk.check_in`).all(f, t)) {
        if (q.name && !bk.mother.includes(q.name)) continue;
        const babyIds = db.prepare('SELECT id FROM babies WHERE mother_id = ?').all(bk.mother_id).map(b => b.id);
        // 該住期內逐日合計（同媽媽多寶寶取當日最大時數，代表媽媽當日同室時數）
        const byDay = {};
        if (babyIds.length) {
          for (const l of db.prepare(`SELECT baby_id, log_date, out_time, return_time FROM baby_rooming_logs
            WHERE baby_id IN (${babyIds.join(',')}) AND log_date >= ? AND log_date < ?
            AND out_time != '' AND return_time != ''`).all(bk.check_in, bk.check_out)) {
            const [oh, om] = l.out_time.split(':').map(Number), [rh, rm] = l.return_time.split(':').map(Number);
            let h = (rh * 60 + rm - oh * 60 - om) / 60;
            if (h < 0) h += 24;
            byDay[l.log_date] = byDay[l.log_date] || {};
            byDay[l.log_date][l.baby_id] = (byDay[l.log_date][l.baby_id] || 0) + h;
          }
        }
        const dayHours = Object.values(byDay).map(m2 => Math.max(...Object.values(m2)));
        out.push({ room: bk.room, mother: bk.mother, period: `${bk.check_in} ~ ${bk.check_out}`,
          days: Math.round((new Date(bk.check_out) - new Date(bk.check_in)) / 86400000) + '天',
          ge12: dayHours.filter(h => h >= 12).length, ge23: dayHours.filter(h => h >= 23).length });
      }
      return out;
    } }
};

app.get('/api/pp-reports/:key', requireStaff, (req, res) => {
  const rep = PP_REPORTS[req.params.key];
  if (!rep) return res.status(404).json({ error: '找不到此報表' });
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : today().slice(0, 8) + '01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today();
  if (to < from) return res.status(400).json({ error: '日期區間錯誤' });
  let rows;
  try { rows = rep.run(from, to, req.query); } catch (e) { return res.status(500).json({ error: '報表產生失敗：' + e.message }); }
  if (req.query.format === 'xlsx') {
    const buf = buildWorkbook(rep.label, rep.columns.map(([key, label]) => ({ key, label })), rows);
    const fname = encodeURIComponent(`${rep.label}-${from}-${to}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="pp-${req.params.key}.xlsx"; filename*=UTF-8''${fname}`);
    return res.send(buf);
  }
  res.json({ key: req.params.key, label: rep.label, columns: rep.columns, from, to, rows });
});
app.get('/api/pp-reports', requireStaff, (req, res) => {
  res.json(Object.entries(PP_REPORTS).map(([key, r]) => ({ key, label: r.label })));
});

// 客戶互動紀錄（追加式）
app.post('/api/customers/:motherId/logs', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.motherId);
  if (!mother) return res.status(404).json({ error: '找不到客戶' });
  const body = String((req.body || {}).body || '').trim().slice(0, 1000);
  if (!body) return res.status(400).json({ error: '請填入互動紀錄' });
  const info = db.prepare('INSERT INTO customer_logs (mother_id, body, created_by) VALUES (?,?,?)')
    .run(mother.id, body, req.session.user.id);
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/customer-logs/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM customer_logs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 新增潛在客戶：建 mothers（status=reserved）＋擴充 profile；預產期必填（比照參考系統）
app.post('/api/customers', requireStaff, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: '請填寫媽媽姓名' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '')) return res.status(400).json({ error: '請填寫媽媽預產期' });
  // 重複偵測：同電話，或同姓名＋同預產期，且尚未退住者 → 可能為同一人（避免多筆潛客檔）
  // 前端顯示候選後由使用者選擇「開啟既有」或帶 force 仍新增（真的是不同人時）
  const phone = String(b.phone || '').trim();
  if (!b.force) {
    const dupes = db.prepare(`SELECT id, name, phone, due_date, status FROM mothers
      WHERE status != 'checked_out'
        AND ((@phone != '' AND phone = @phone) OR (name = @name AND due_date = @due))
      ORDER BY id DESC LIMIT 10`).all({ phone, name, due: b.due_date });
    if (dupes.length) return res.status(409).json({ error: '可能已有相同的潛在客戶', duplicates: dupes });
  }
  const info = db.prepare(`INSERT INTO mothers (name, phone, birth_date, due_date, delivery_type, status)
    VALUES (?,?,?,?,?, 'reserved')`).run(
    name.slice(0, 50), String(b.phone || '').slice(0, 20),
    /^\d{4}-\d{2}-\d{2}$/.test(b.birth_date || '') ? b.birth_date : '',
    b.due_date, String(b.delivery_mode || '').slice(0, 20));
  const motherId = info.lastInsertRowid;
  if (typeof b.id_no === 'string' && b.id_no.trim()) {
    db.prepare('UPDATE mothers SET id_no = ? WHERE id = ?').run(b.id_no.trim().slice(0, 10), motherId);
  }
  custProfileUpsert(motherId, b, req.session.user.id);
  logAudit(req, { action: 'create', entity: 'customer_profiles', entity_id: motherId, summary: `新增潛在客戶 ${name}` });
  res.json({ id: motherId });
});

// 更新潛客：mothers 同步欄位＋profile 合併
app.put('/api/customers/:motherId', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.motherId);
  if (!mother) return res.status(404).json({ error: '找不到客戶' });
  const b = req.body || {};
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: '媽媽姓名不可空白' });
  const sets = [], args = [];
  if (b.name !== undefined) { sets.push('name = ?'); args.push(String(b.name).trim().slice(0, 50)); }
  if (b.phone !== undefined) { sets.push('phone = ?'); args.push(String(b.phone).slice(0, 20)); }
  if (b.birth_date !== undefined) { sets.push('birth_date = ?'); args.push(/^\d{4}-\d{2}-\d{2}$/.test(b.birth_date) ? b.birth_date : ''); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '')) { sets.push('due_date = ?'); args.push(b.due_date); }
  if (b.delivery_mode !== undefined) { sets.push('delivery_type = ?'); args.push(String(b.delivery_mode).slice(0, 20)); }
  if (typeof b.id_no === 'string' && b.id_no.trim()) { sets.push('id_no = ?'); args.push(b.id_no.trim().slice(0, 10)); }
  if (sets.length) db.prepare(`UPDATE mothers SET ${sets.join(', ')} WHERE id = ?`).run(...args, mother.id);
  custProfileUpsert(mother.id, b, req.session.user.id);
  logAudit(req, { action: 'update', entity: 'customer_profiles', entity_id: mother.id, summary: '潛在客戶資料修改' });
  res.json({ ok: true });
});

// 刪除潛在客戶（清掉重複／誤建的空白潛客）：僅限「潛客/預約」狀態且無任何實質關聯資料者，
// 有訂房（含已取消以外）／合約／寶寶／照護紀錄一律擋下，避免誤刪有作業的客戶
app.delete('/api/customers/:motherId', requireStaff, (req, res) => {
  const mother = db.prepare('SELECT id, name, status FROM mothers WHERE id = ?').get(req.params.motherId);
  if (!mother) return res.status(404).json({ error: '找不到客戶' });
  if (mother.status !== 'reserved') {
    return res.status(409).json({ error: '僅「潛客/預約」狀態可刪除；已入住／已退住請走退房或結案流程' });
  }
  const guards = [
    ['bookings', `SELECT COUNT(*) c FROM bookings WHERE mother_id = ? AND status != 'cancelled'`, '有排房紀錄（請先於排房取消）'],
    ['customer_contracts', `SELECT COUNT(*) c FROM customer_contracts WHERE mother_id = ? AND status != 'archived'`, '有合約資料（請先退訂合約）'],
    ['babies', 'SELECT COUNT(*) c FROM babies WHERE mother_id = ?', '已建立寶寶資料'],
    ['mother_records', 'SELECT COUNT(*) c FROM mother_records WHERE mother_id = ?', '已有照護紀錄']
  ];
  for (const [, sql, msg] of guards) {
    if (db.prepare(sql).get(mother.id).c > 0) return res.status(409).json({ error: `無法刪除：${msg}` });
  }
  db.transaction(() => {
    // 解除參觀單關聯（保留參觀歷史）、清掉已取消的空排房與其附屬，最後刪 profile 與主檔
    db.prepare('UPDATE tours SET mother_id = NULL WHERE mother_id = ?').run(mother.id);
    const cancelledBks = db.prepare(`SELECT id FROM bookings WHERE mother_id = ? AND status = 'cancelled'`).all(mother.id);
    for (const bk of cancelledBks) {
      db.prepare('DELETE FROM payments WHERE booking_id = ?').run(bk.id);
      db.prepare('DELETE FROM charge_items WHERE booking_id = ?').run(bk.id);
      db.prepare('DELETE FROM contracts WHERE booking_id = ?').run(bk.id);
    }
    db.prepare(`DELETE FROM bookings WHERE mother_id = ? AND status = 'cancelled'`).run(mother.id);
    db.prepare('DELETE FROM meal_orders WHERE mother_id = ?').run(mother.id);
    db.prepare('DELETE FROM customer_contracts WHERE mother_id = ?').run(mother.id);
    db.prepare('DELETE FROM customer_logs WHERE mother_id = ?').run(mother.id);
    db.prepare('DELETE FROM customer_profiles WHERE mother_id = ?').run(mother.id);
    db.prepare('DELETE FROM mothers WHERE id = ?').run(mother.id);
  })();
  logAudit(req, { action: 'delete', entity: 'mothers', entity_id: mother.id, summary: `刪除潛在客戶 ${mother.name}` });
  res.json({ ok: true });
});

// 預約參觀行事曆：某月 tours（依日期分組由前端排版）
app.get('/api/tour-calendar', requireStaff, (req, res) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month || '') ? req.query.month : today().slice(0, 7);
  const rows = db.prepare(`SELECT id, name, phone, tour_at, status, confirm_status, note FROM tours
    WHERE tour_at LIKE ? ORDER BY tour_at`).all(`${month}%`);
  res.json({ month, rows });
});

// 總覽整合行事曆：參觀／課程／服務／入住／退住 彙整為統一事件（依登入者模組權限過濾）
app.get('/api/overview-calendar', requireStaff, (req, res) => {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : today();
  const days = Math.min(Math.max(parseInt(req.query.days || '31', 10), 1), 62);
  const end = new Date(new Date(start).getTime() + days * 86400000).toISOString().slice(0, 10); // 不含
  const u = req.session.user;
  const events = [];
  if (userCan(u, 'tours')) {
    db.prepare(`SELECT id, name, phone, tour_at, status FROM tours
      WHERE date(tour_at) >= ? AND date(tour_at) < ? ORDER BY tour_at`).all(start, end)
      .forEach(t => events.push({
        type: 'tour', date: t.tour_at.slice(0, 10), time: t.tour_at.slice(11, 16),
        title: t.name, detail: t.phone, status: t.status, link: '#/tour-calendar'
      }));
  }
  if (userCan(u, 'programs')) {
    // scheduled_at 為自由輸入，兼容 2026-07-10 與 2026/7/10 等格式，正規化後再篩範圍
    db.prepare(`SELECT id, name, kind, scheduled_at, location FROM programs
      WHERE active = 1 AND scheduled_at != ''`).all()
      .forEach(p => {
        const m = String(p.scheduled_at).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/);
        if (!m) return;
        const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        if (date < start || date >= end) return;
        events.push({
          type: p.kind === 'course' ? 'course' : 'service', date,
          time: (m[4] || '').padStart(5, '0'), title: p.name, detail: p.location, status: '', link: '#/program-calendar'
        });
      });
  }
  if (userCan(u, 'visitors')) {
    db.prepare(`SELECT v.visit_at, v.visitor_name, v.headcount, v.status, m.name AS mother_name
      FROM visitor_reservations v JOIN mothers m ON m.id = v.mother_id
      WHERE v.status != 'cancelled' AND date(v.visit_at) >= ? AND date(v.visit_at) < ?
      ORDER BY v.visit_at`).all(start, end)
      .forEach(v => events.push({
        type: 'visitor', date: v.visit_at.slice(0, 10), time: v.visit_at.slice(11, 16),
        title: `${v.visitor_name} 訪 ${v.mother_name}`, detail: v.headcount > 1 ? `${v.headcount} 人` : '',
        status: v.status, link: '#/visitor-reservations'
      }));
  }
  // 入住／退住：bookings 的 GET 對所有員工開放，事件不另設權限
  db.prepare(`SELECT bk.check_in AS d, bk.status, m.name AS mother_name, r.name AS room_name
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status != 'cancelled' AND bk.check_in >= ? AND bk.check_in < ? ORDER BY bk.check_in`).all(start, end)
    .forEach(b => events.push({
      type: 'checkin', date: b.d, time: '', title: `${b.mother_name}（${b.room_name}）`,
      detail: '', status: b.status, link: '#/rooms'
    }));
  db.prepare(`SELECT bk.check_out AS d, bk.status, m.name AS mother_name, r.name AS room_name
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status != 'cancelled' AND bk.check_out >= ? AND bk.check_out < ? ORDER BY bk.check_out`).all(start, end)
    .forEach(b => events.push({
      type: 'checkout', date: b.d, time: '', title: `${b.mother_name}（${b.room_name}）`,
      detail: '', status: b.status, link: '#/rooms'
    }));
  // 無時間（入住/退住）排每日最前，其餘依時間
  events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.json({ start, end, days, events });
});

app.delete('/api/tours/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tours WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 訪客預約（住民探訪；家屬登記或護理站代登，報到／取消由護理站操作） ----------
const VISITOR_STATUSES = ['booked', 'arrived', 'cancelled'];
function validVisitAt(s) { return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s || ''); }

app.get('/api/visitor-reservations', requireStaff, (req, res) => {
  const conds = [], args = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) { conds.push('date(v.visit_at) >= ?'); args.push(req.query.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) { conds.push('date(v.visit_at) <= ?'); args.push(req.query.to); }
  if (VISITOR_STATUSES.includes(req.query.status || '')) { conds.push('v.status = ?'); args.push(req.query.status); }
  if ((req.query.q || '').trim()) {
    conds.push('(v.visitor_name LIKE ? OR m.name LIKE ? OR v.phone LIKE ?)');
    const k = `%${req.query.q.trim()}%`; args.push(k, k, k);
  }
  const rows = db.prepare(`
    SELECT v.*, m.name AS mother_name,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
        WHERE bk.mother_id = m.id AND bk.status IN ('reserved','checked_in')
        ORDER BY bk.check_in DESC LIMIT 1) AS room_name,
      f.name AS family_name
    FROM visitor_reservations v
    JOIN mothers m ON m.id = v.mother_id
    LEFT JOIN family_members f ON f.id = v.family_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY v.visit_at DESC, v.id DESC`).all(...args);
  res.json(rows);
});

app.post('/api/visitor-reservations', requireStaff, (req, res) => {
  const b = req.body || {};
  const name = String(b.visitor_name || '').trim();
  if (!name) return res.status(400).json({ error: '訪客姓名必填' });
  const mother = db.prepare('SELECT id, name FROM mothers WHERE id = ?').get(b.mother_id);
  if (!mother) return res.status(400).json({ error: '請選擇媽媽' });
  if (!validVisitAt(b.visit_at)) return res.status(400).json({ error: '探訪時間格式應為 YYYY-MM-DD HH:MM' });
  const headcount = Math.min(Math.max(parseInt(b.headcount, 10) || 1, 1), 20);
  const info = db.prepare(`INSERT INTO visitor_reservations
    (mother_id, visitor_name, relation, phone, headcount, visit_at, note, created_by)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    mother.id, name.slice(0, 50), String(b.relation || '').slice(0, 20),
    String(b.phone || '').slice(0, 20), headcount, b.visit_at.trim(),
    String(b.note || '').slice(0, 200), req.session.user.id);
  logAudit(req, { action: 'create', entity: 'visitor_reservation', entity_id: info.lastInsertRowid, summary: `訪客預約:${name} 訪 ${mother.name}` });
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/visitor-reservations/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM visitor_reservations WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到資料' });
  const b = req.body || {};
  const sets = [], args = [];
  if (b.visitor_name !== undefined) {
    const name = String(b.visitor_name).trim();
    if (!name) return res.status(400).json({ error: '訪客姓名必填' });
    sets.push('visitor_name = ?'); args.push(name.slice(0, 50));
  }
  if (b.relation !== undefined) { sets.push('relation = ?'); args.push(String(b.relation).slice(0, 20)); }
  if (b.phone !== undefined) { sets.push('phone = ?'); args.push(String(b.phone).slice(0, 20)); }
  if (b.headcount !== undefined) { sets.push('headcount = ?'); args.push(Math.min(Math.max(parseInt(b.headcount, 10) || 1, 1), 20)); }
  if (b.visit_at !== undefined) {
    if (!validVisitAt(b.visit_at)) return res.status(400).json({ error: '探訪時間格式應為 YYYY-MM-DD HH:MM' });
    sets.push('visit_at = ?'); args.push(b.visit_at.trim());
  }
  if (b.note !== undefined) { sets.push('note = ?'); args.push(String(b.note).slice(0, 200)); }
  if (b.status !== undefined) {
    if (!VISITOR_STATUSES.includes(b.status)) return res.status(400).json({ error: '狀態不正確' });
    sets.push('status = ?'); args.push(b.status);
  }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE visitor_reservations SET ${sets.join(', ')} WHERE id = ?`).run(...args, cur.id);
  logAudit(req, { action: 'update', entity: 'visitor_reservation', entity_id: cur.id, summary: `訪客預約修改:${cur.visitor_name}${b.status ? '（狀態 ' + b.status + '）' : ''}` });
  res.json({ ok: true });
});

app.delete('/api/visitor-reservations/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM visitor_reservations WHERE id = ?').run(req.params.id);
  logAudit(req, { action: 'delete', entity: 'visitor_reservation', entity_id: Number(req.params.id), summary: '訪客預約刪除' });
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
  // 合約資料（客戶管理→合約資料）已存檔的優惠明細：帶入訂房確認單
  let cd = {};
  try { cd = JSON.parse((db.prepare("SELECT data FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(bk.mother_id) || {}).data || '{}'); }
  catch (e) { cd = {}; }
  return {
    bk, cd,
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
      today: today(),
      // 合約資料頁存檔的優惠明細（範本可用 {{voucher_amount}} 等自行排版）
      voucher_amount: money(Number(cd.voucher_amount) || 0),
      cash_discount: money(Number(cd.cash_discount) || 0),
      gift_content: cd.gift_content || '',
      voucher_by: cd.voucher_by || '',
      cash_discount_by: cd.cash_discount_by || '',
      gift_by: cd.gift_by || ''
    }
  };
}

// 優惠明細區塊：合約資料頁已存檔的禮券／折扣／贈品，附存檔人與存檔時間
function discountBlock(cd) {
  const line = (label, val, by, at, note) => val
    ? `${label}：${val}${by ? `（存檔人：${by}${at ? `・${at}` : ''}）` : ''}${note ? `\n　　${note}` : ''}`
    : '';
  const rows = [
    line('商品禮券', Number(cd.voucher_amount) ? money(Number(cd.voucher_amount)) : '', cd.voucher_by, cd.voucher_at, '只能折抵商城商品，出住日後歸零。'),
    line('現金折扣', Number(cd.cash_discount) ? money(Number(cd.cash_discount)) : '', cd.cash_discount_by, cd.cash_discount_at, '訂金仍為合約總額 10%（不扣折扣）。'),
    line('贈品內容', cd.gift_content || '', cd.gift_by, cd.gift_at, '')
  ].filter(Boolean);
  if (!rows.length) return '';
  return `\n\n── 優惠與贈品明細（合約資料存檔帶入）──\n${rows.join('\n')}\n`;
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
           c.signer_relation, c.signed_at, c.created_at, c.handler, c.needs_resign,
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
// 依範本＋當下訂房資料渲染合約內容（新建與「重新產生」共用，確保兩者結果一致）
function renderContractBody(tpl, ctx) {
  let body = renderTemplate(tpl.body, ctx.map);
  // 範本未自行放入優惠欄位時，自動附上合約資料頁存檔的優惠明細（避免重複附加）
  if (!/\{\{(voucher_amount|cash_discount|gift_content)\}\}/.test(tpl.body || '')) {
    body += discountBlock(ctx.cd || {});
  }
  return body;
}

// 以目前資料重新產生合約內容（房型／房號／住期／金額改過後重簽用；不寫入，僅回傳供預覽編輯）
app.get('/api/contracts/:id/rerender', requireStaff, (req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '找不到合約' });
  const tpl = db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(c.template_id);
  if (!tpl) return res.status(400).json({ error: '原合約範本已不存在，無法重新產生內容' });
  const ctx = contractContext(c.booking_id);
  if (!ctx) return res.status(404).json({ error: '找不到對應訂房（可能已取消），無法重新產生內容' });
  res.json({ body: renderContractBody(tpl, ctx), title: c.title || tpl.name,
    room_name: ctx.map.room_name, room_type: ctx.map.room_type,
    check_in: ctx.map.check_in, check_out: ctx.map.check_out, days: ctx.map.days });
});

app.post('/api/bookings/:id/contracts', requireStaff, (req, res) => {
  const ctx = contractContext(req.params.id);
  if (!ctx) return res.status(404).json({ error: '找不到訂房' });
  const tplId = (req.body || {}).template_id;
  const tpl = db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(tplId);
  if (!tpl) return res.status(400).json({ error: '請選擇合約範本' });
  const title = (req.body || {}).title || tpl.name;
  const handler = ((req.body || {}).handler || '').trim();
  const body = renderContractBody(tpl, ctx);
  const info = db.prepare(`INSERT INTO contracts
    (booking_id, template_id, title, body, sign_token, created_by, handler)
    VALUES (?,?,?,?,?,?,?)`).run(
    req.params.id, tpl.id, title, body, genSignToken(), req.session.user.id, handler);
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
  db.prepare('UPDATE contracts SET title = ?, body = ?, handler = ? WHERE id = ?').run(
    (b.title || c.title), (b.body !== undefined ? b.body : c.body),
    (b.handler !== undefined ? String(b.handler).trim() : c.handler), c.id);
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
  // 未指定內容時：若原合約已標示「需重簽」（房型／住期／金額等已變更），
  // 依目前資料重新套版，避免沿用舊快照印出舊房型；重新產生失敗才退回原內容
  let body = b.body !== undefined ? b.body : old.body;
  if (b.body === undefined && old.needs_resign) {
    const tpl = db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(old.template_id);
    const ctx = tpl ? contractContext(old.booking_id) : null;
    if (tpl && ctx) body = renderContractBody(tpl, ctx);
  }
  const handler = b.handler !== undefined ? String(b.handler).trim() : old.handler;
  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO contracts
      (booking_id, template_id, title, body, sign_token, created_by, replaces_id, handler)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      old.booking_id, old.template_id, title, body, genSignToken(), req.session.user.id, old.id, handler);
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

// ---------- 醫師巡診就醫紀錄（小兒科／婦產科；SOAP） ----------
const VISIT_SPECIALTIES = ['pediatrics', 'obgyn', 'other'];
const VISIT_TYPES = ['routine', 'follow_up', 'acute', 'discharge'];
app.get('/api/physician-visits', requireStaff, (req, res) => {
  const conds = [], args = {};
  // 房號依巡診當日對應當時的房（媽媽巡診用 v.mother_id；寶寶巡診用寶寶的媽媽 b.mother_id）
  const roomSub = roomAtDateSql('date(v.visit_at)', 'COALESCE(v.mother_id, b.mother_id)');
  if (req.query.subject) { conds.push('v.subject_type = @subject'); args.subject = req.query.subject; }
  if (req.query.specialty) { conds.push('v.specialty = @specialty'); args.specialty = req.query.specialty; }
  if (req.query.baby_id) { conds.push('v.baby_id = @baby_id'); args.baby_id = req.query.baby_id; }
  if (req.query.mother_id) { conds.push('v.mother_id = @mother_id'); args.mother_id = req.query.mother_id; }
  if (req.query.month) { conds.push("strftime('%Y-%m', v.visit_at) = @month"); args.month = req.query.month; }
  // 僅顯示「入住中」的巡診紀錄
  if (req.query.in_house === '1' || req.query.in_house === 'true') {
    conds.push("COALESCE(m.status, bmo.status) = 'checked_in'");
  }
  if (req.query.start) { conds.push('date(v.visit_at) >= @start'); args.start = req.query.start; }
  if (req.query.end) { conds.push('date(v.visit_at) <= @end'); args.end = req.query.end; }
  const kw = (req.query.kw || '').trim();
  if (kw) {
    args.kw = `%${kw}%`;
    if (req.query.kwtype === 'room') conds.push(`${roomSub} LIKE @kw`);
    else conds.push('COALESCE(m.name, bmo.name) LIKE @kw');   // 預設：媽媽姓名
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT v.*, b.name AS baby_name,
      COALESCE(m.name, bmo.name) AS mother_name,
      COALESCE(m.status, bmo.status) AS mother_status,
      u.name AS recorded_by_name,
      ${roomSub} AS room_name
    FROM physician_visits v
    LEFT JOIN babies b ON b.id = v.baby_id
    LEFT JOIN mothers m ON m.id = v.mother_id
    LEFT JOIN mothers bmo ON bmo.id = b.mother_id
    LEFT JOIN users u ON u.id = v.recorded_by
    ${where} ORDER BY v.visit_at DESC, v.id DESC`).all(args);

  // 合併呈現兒科／產科「醫師診視」表單紀錄（唯讀；於各自頁面維護），巡診清單自此一站看全
  const merged = [];
  const addFormRows = (subjectType, specialty) => {
    if (req.query.subject && req.query.subject !== subjectType) return;
    if (req.query.specialty && req.query.specialty !== specialty) return;
    if (subjectType === 'mother' && req.query.baby_id) return;
    const c = [], a = {};
    if (subjectType === 'baby') {
      if (req.query.baby_id) { c.push('v.baby_id = @baby_id'); a.baby_id = req.query.baby_id; }
      if (req.query.mother_id) { c.push('b.mother_id = @mother_id'); a.mother_id = req.query.mother_id; }
    } else if (req.query.mother_id) { c.push('v.mother_id = @mother_id'); a.mother_id = req.query.mother_id; }
    if (req.query.month) { c.push("strftime('%Y-%m', v.visit_date) = @month"); a.month = req.query.month; }
    if (req.query.start) { c.push('v.visit_date >= @start'); a.start = req.query.start; }
    if (req.query.end) { c.push('v.visit_date <= @end'); a.end = req.query.end; }
    if (req.query.in_house === '1' || req.query.in_house === 'true') c.push("mm.status = 'checked_in'");
    const roomSub2 = roomAtDateSql('v.visit_date', 'mm.id');
    if (kw) {
      a.kw = `%${kw}%`;
      if (req.query.kwtype === 'room') c.push(`${roomSub2} LIKE @kw`);
      else c.push('mm.name LIKE @kw');
    }
    const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
    const sel = subjectType === 'baby'
      ? `SELECT v.id AS form_id, v.visit_date, v.visit_time, v.note, b.name AS baby_name,
           mm.name AS mother_name, mm.status AS mother_status, u.name AS recorded_by_name, ${roomSub2} AS room_name
         FROM baby_doctor_visits v JOIN babies b ON b.id = v.baby_id JOIN mothers mm ON mm.id = b.mother_id
         LEFT JOIN users u ON u.id = v.recorded_by ${w}`
      : `SELECT v.id AS form_id, v.visit_date, v.visit_time, v.note, NULL AS baby_name,
           mm.name AS mother_name, mm.status AS mother_status, u.name AS recorded_by_name, ${roomSub2} AS room_name
         FROM mother_doctor_visits v JOIN mothers mm ON mm.id = v.mother_id
         LEFT JOIN users u ON u.id = v.recorded_by ${w}`;
    for (const r of db.prepare(sel).all(a)) {
      merged.push({
        id: `${subjectType === 'baby' ? 'bdv' : 'mdv'}-${r.form_id}`,
        source: 'form', readonly: 1,
        subject_type: subjectType, specialty, physician: '', visit_type: 'routine',
        visit_at: `${r.visit_date} ${r.visit_time || ''}`.trim(),
        subjective: '', objective: '', assessment: String(r.note || '').slice(0, 200),
        plan: '', follow_up: '', referral: '',
        baby_name: r.baby_name, mother_name: r.mother_name, mother_status: r.mother_status,
        recorded_by_name: r.recorded_by_name, room_name: r.room_name
      });
    }
  };
  if (req.query.merged !== '0') { addFormRows('baby', 'pediatrics'); addFormRows('mother', 'obgyn'); }
  res.json(rows.concat(merged).sort((x, y) => String(y.visit_at).localeCompare(String(x.visit_at))));
});

function normalizeVisit(v) {
  const subject_type = v.subject_type === 'mother' ? 'mother' : 'baby';
  return {
    subject_type,
    baby_id: subject_type === 'baby' ? (v.baby_id || null) : null,
    mother_id: subject_type === 'mother' ? (v.mother_id || null) : null,
    specialty: VISIT_SPECIALTIES.includes(v.specialty) ? v.specialty : 'pediatrics',
    physician: v.physician || '',
    visit_at: v.visit_at || '',
    visit_type: VISIT_TYPES.includes(v.visit_type) ? v.visit_type : 'routine',
    subjective: v.subjective || '', objective: v.objective || '',
    assessment: v.assessment || '', plan: v.plan || '',
    follow_up: v.follow_up || '', referral: v.referral || ''
  };
}

app.post('/api/physician-visits', requireStaff, (req, res) => {
  const v = normalizeVisit(req.body || {});
  if (!v.visit_at) return res.status(400).json({ error: '巡診時間必填' });
  if (v.subject_type === 'baby' && !v.baby_id) return res.status(400).json({ error: '請選擇巡診寶寶' });
  if (v.subject_type === 'mother' && !v.mother_id) return res.status(400).json({ error: '請選擇巡診媽媽' });
  const info = db.prepare(`INSERT INTO physician_visits
    (subject_type, baby_id, mother_id, specialty, physician, visit_at, visit_type,
     subjective, objective, assessment, plan, follow_up, referral, recorded_by)
    VALUES (@subject_type,@baby_id,@mother_id,@specialty,@physician,@visit_at,@visit_type,
     @subjective,@objective,@assessment,@plan,@follow_up,@referral,@recorded_by)`)
    .run({ ...v, recorded_by: req.session.user.id });
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/physician-visits/:id', requireStaff, (req, res) => {
  const cur = db.prepare('SELECT * FROM physician_visits WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到巡診紀錄' });
  const v = normalizeVisit(req.body || {});
  if (!v.visit_at) return res.status(400).json({ error: '巡診時間必填' });
  if (v.subject_type === 'baby' && !v.baby_id) return res.status(400).json({ error: '請選擇巡診寶寶' });
  if (v.subject_type === 'mother' && !v.mother_id) return res.status(400).json({ error: '請選擇巡診媽媽' });
  db.prepare(`UPDATE physician_visits SET
    subject_type=@subject_type, baby_id=@baby_id, mother_id=@mother_id, specialty=@specialty,
    physician=@physician, visit_at=@visit_at, visit_type=@visit_type, subjective=@subjective,
    objective=@objective, assessment=@assessment, plan=@plan, follow_up=@follow_up, referral=@referral
    WHERE id=@id`).run({ ...v, id: req.params.id });
  res.json({ ok: true });
});

app.delete('/api/physician-visits/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM physician_visits WHERE id = ?').run(req.params.id);
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
  // 未結帳款（與收費帳務一致：含寶寶未入住扣抵）
  const dunRate = babyDeductRate();
  for (const b of db.prepare(`
    SELECT bk.*, m.name AS mother_name, r.name AS room_name, ${BILLING_SUMS}
    FROM bookings bk JOIN mothers m ON m.id=bk.mother_id JOIN rooms r ON r.id=bk.room_id
    WHERE bk.status IN ('reserved','checked_in')`).all().map(x => withBalance(x, dunRate)).filter(b => b.balance > 0)) {
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

  // 給藥安全：漏給藥（missed）
  for (const m of db.prepare(`SELECT ma.drug_name, b.name AS baby_name FROM med_administrations ma
    JOIN babies b ON b.id=ma.baby_id WHERE ma.status='missed'
    AND EXISTS (SELECT 1 FROM bookings bk WHERE bk.mother_id=b.mother_id AND bk.status='checked_in')`).all()) {
    items.push({ type: 'med', level: 'high', title: `${m.baby_name} 漏給藥：${m.drug_name}`, link: '#/newborn-medical' });
  }
  // 疫苗待接種（status=scheduled）
  const vaccineTw = { hepb_immunoglobulin: 'B肝免疫球蛋白(HBIG)', hepb: 'B型肝炎疫苗', bcg: '卡介苗', other: '其他' };
  for (const v of db.prepare(`SELECT vc.vaccine, b.name AS baby_name FROM vaccinations vc
    JOIN babies b ON b.id=vc.baby_id WHERE vc.status='scheduled'
    AND EXISTS (SELECT 1 FROM bookings bk WHERE bk.mother_id=b.mother_id AND bk.status='checked_in')`).all()) {
    items.push({ type: 'vaccine', level: 'mid', title: `${v.baby_name} 待接種疫苗（${vaccineTw[v.vaccine] || v.vaccine}）`, link: '#/newborn-medical' });
  }
  // 連續異常趨勢預警：體溫連續偏高、體重連續下降（在住寶寶）
  const sset = getSettings();
  const tHigh = parseFloat(sset.temp_high) || 999;
  for (const b of db.prepare(`SELECT b.id, b.name FROM babies b
    WHERE EXISTS (SELECT 1 FROM bookings bk WHERE bk.mother_id=b.mother_id AND bk.status='checked_in')`).all()) {
    const temps = db.prepare(`SELECT value_num FROM baby_records WHERE baby_id=? AND record_type='temperature' AND value_num IS NOT NULL ORDER BY recorded_at DESC LIMIT 2`).all(b.id);
    if (temps.length === 2 && temps.every(t => t.value_num >= tHigh)) {
      items.push({ type: 'trend', level: 'high', title: `${b.name} 體溫連續偏高（${temps[1].value_num}→${temps[0].value_num}°C）`, link: '#/baby-care' });
    }
    const ws = db.prepare(`SELECT value_num FROM baby_records WHERE baby_id=? AND record_type='weight' AND value_num IS NOT NULL ORDER BY recorded_at DESC LIMIT 3`).all(b.id).map(x => x.value_num);
    if (ws.length === 3 && ws[0] < ws[1] && ws[1] < ws[2]) {
      items.push({ type: 'trend', level: 'mid', title: `${b.name} 體重連續下降（${ws[2]}→${ws[1]}→${ws[0]} g）`, link: '#/baby-care' });
    }
  }
  // 參觀跟進：到期（含逾期）的下次跟進
  for (const t of db.prepare(`SELECT name, follow_up_date FROM tours
    WHERE status IN ('scheduled','visited') AND follow_up_date != '' AND follow_up_date <= ?
    ORDER BY follow_up_date`).all(d)) {
    items.push({ type: 'tour', level: t.follow_up_date < d ? 'high' : 'mid',
      title: `參觀跟進：${t.name}（${t.follow_up_date}）`, due: t.follow_up_date, link: '#/tours' });
  }
  // 關懷：已預約媽媽預產期將近（14 天內），可主動聯繫
  for (const m of db.prepare(`SELECT DISTINCT m.name, m.due_date FROM mothers m
    JOIN bookings bk ON bk.mother_id = m.id AND bk.status = 'reserved'
    WHERE m.due_date != '' AND m.due_date BETWEEN ? AND date(?, '+14 days')
    ORDER BY m.due_date`).all(d, d)) {
    items.push({ type: 'care', level: 'mid', title: `${m.name} 預產期將近（${m.due_date}），可致電關懷`, due: m.due_date, link: '#/residents' });
  }
  // 關懷：在住寶寶今日滿月（出生滿 30 天）
  for (const b of db.prepare(`SELECT b.name, b.birth_date FROM babies b
    WHERE b.birth_date != '' AND date(b.birth_date, '+30 days') = ?
    AND EXISTS (SELECT 1 FROM bookings bk WHERE bk.mother_id=b.mother_id AND bk.status='checked_in')`).all(d)) {
    items.push({ type: 'care', level: 'low', title: `${b.name} 今日滿月 🎉，可準備祝福`, link: '#/baby-care' });
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
  const rooms = db.prepare("SELECT id, name, room_type, price_per_day FROM rooms WHERE active=1 AND room_type != '托嬰' ORDER BY name").all();
  const bookings = db.prepare(`
    SELECT bk.id, bk.room_id, bk.mother_id, bk.check_in, bk.check_out, bk.actual_check_out, bk.status, bk.notes,
           m.name AS mother_name
    FROM bookings bk JOIN mothers m ON m.id=bk.mother_id
    WHERE bk.status != 'cancelled' AND bk.check_in < ? AND bk.check_out > ?
    ORDER BY bk.check_in`).all(end, start);
  // 已退房者以實際退房日為佔用終點（提前退房不再多畫到原預退日）
  for (const b of bookings) {
    if (b.status === 'checked_out' && (b.actual_check_out || '').slice(0, 10)) {
      b.check_out = b.actual_check_out.slice(0, 10);
    }
  }
  res.json({ start, end, days, rooms, bookings });
});

// ---------- 媽媽房況／寶寶房況看板 ----------
// 媽媽房況：每間房的即時狀態（入住中住客、住到第幾天、今日進退房、照護與房務摘要、下一筆預約）
app.get('/api/room-status/mothers', requireStaff, (req, res) => {
  const d = today();
  const rooms = db.prepare("SELECT id, name, room_type, price_per_day, notes FROM rooms WHERE active=1 AND room_type != '托嬰' ORDER BY name").all();
  const occupants = db.prepare(`
    SELECT bk.room_id, bk.id AS booking_id, bk.check_in, bk.check_out, bk.baby_check_in,
           m.id AS mother_id, m.name AS mother_name, m.phone, m.delivery_type, m.delivery_date,
           m.meal_diet, m.diet_notes, m.medical_notes, m.hk_dnd, m.hk_needs,
           (SELECT COUNT(*) FROM mother_records mr WHERE mr.mother_id = m.id AND date(mr.recorded_at) = ?) AS today_care_count,
           (SELECT MAX(mr.recorded_at) FROM mother_records mr WHERE mr.mother_id = m.id) AS last_care_at,
           (SELECT COUNT(*) FROM housekeeping_logs h WHERE h.status = 'pending'
             AND (h.mother_id = m.id OR h.room_id = bk.room_id)) AS pending_tasks,
           (SELECT COUNT(*) FROM family_messages fm JOIN babies b2 ON b2.id = fm.baby_id
             WHERE b2.mother_id = m.id AND fm.sender = 'family' AND fm.read_by_staff = 0) AS need_count,
           (SELECT COUNT(*) FROM meal_swap_requests ms
             WHERE ms.mother_id = m.id AND ms.status = 'pending') AS meal_swap_count,
           0 AS closed
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id
    WHERE bk.status = 'checked_in'
    ORDER BY bk.check_in DESC`).all(d);
  // 結案標記限當前住期（回住的新住期不再帶到前一胎的結案）；並帶出本次住期的轉房歷程
  for (const oc of occupants) {
    oc.closed = db.prepare(`SELECT COUNT(*) c FROM mother_closures
      WHERE mother_id = ? AND booking_id IN (?, 0)`).get(oc.mother_id, chainRootIdOf(oc.booking_id)).c;
    const segs = staySegmentsOf(oc.booking_id);
    oc.segments = segs;
    oc.transfers = segs.length > 1 ? segs.length - 1 : 0;   // 轉房次數（0＝未轉房）
  }
  // 已辦「退房完成」但尚未辦「產婦結案」者：仍留在原房號供護理端結案（三者互不連動）
  // 只取近 60 天內退房的，避免歷史資料長期佔用看板
  const pendingClosures = db.prepare(`
    SELECT bk.room_id, bk.id AS booking_id, bk.check_in, bk.check_out, bk.actual_check_out,
           m.id AS mother_id, m.name AS mother_name, m.phone
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id
    WHERE bk.status = 'checked_out' AND bk.actual_check_out >= date(?, '-60 day')
    ORDER BY bk.actual_check_out DESC`).all(d)
    .filter(p => !db.prepare(`SELECT COUNT(*) c FROM mother_closures
      WHERE mother_id = ? AND booking_id IN (?, 0)`).get(p.mother_id, chainRootIdOf(p.booking_id)).c)
    // 同一位媽媽只留最近一次退房
    .filter((p, i, arr) => arr.findIndex(x => x.mother_id === p.mother_id) === i);
  // 每房「今日應到」的預約（房況表不顯示未來預約，只顯示當日入住；未來預約請看 7 日內入住／實際入住床表）
  const upcoming = db.prepare(`
    SELECT bk.room_id, bk.id AS booking_id, bk.check_in, bk.check_out,
           m.id AS mother_id, m.name AS mother_name, m.phone
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id
    WHERE bk.status = 'reserved' AND bk.check_out > ? AND bk.check_in <= ?
    ORDER BY bk.check_in`).all(d, d);
  // 在住寶寶依媽媽彙總（顯示母嬰同室狀況）
  const babies = db.prepare(`
    SELECT b.mother_id, b.name, b.location FROM babies b
    JOIN mothers m ON m.id = b.mother_id WHERE m.status = 'checked_in'`).all();
  const babiesByMom = {};
  for (const b of babies) (babiesByMom[b.mother_id] = babiesByMom[b.mother_id] || []).push(b);
  const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const list = rooms.map(r => {
    const occ = occupants.find(o => o.room_id === r.id) || null;
    const next = upcoming.find(u => u.room_id === r.id) || null;
    if (occ) {
      occ.stay_day = Math.max(1, dayDiff(occ.check_in, d) + 1);  // 住到第幾天（資料異常時至少顯示第 1 天）
      occ.stay_total = dayDiff(occ.check_in, occ.check_out);     // 合約天數
      occ.babies = babiesByMom[occ.mother_id] || [];
    }
    let state = 'vacant';
    if (occ) state = occ.check_out <= d ? 'due_out' : 'occupied'; // 今日（含逾期）應退房
    else if (next && next.check_in <= d) state = 'due_in';        // 今日應入住
    else if (next) state = 'reserved';
    // 已退房待產婦結案（不影響房態／佔房統計，僅供護理端在原房號完成結案）
    const pending = pendingClosures.filter(p => p.room_id === r.id);
    return { ...r, state, occupant: occ, next_booking: next, pending_closures: pending };
  });
  const stats = {
    total: list.length,
    occupied: list.filter(x => x.state === 'occupied' || x.state === 'due_out').length,
    due_out: list.filter(x => x.state === 'due_out').length,
    // 今日入住：空房今日應到（state=due_in）＋前一位尚未退房但下一筆今日應到的房
    due_in: list.filter(x => x.state === 'due_in' ||
      (x.occupant && x.next_booking && x.next_booking.check_in <= d)).length,
    vacant: list.filter(x => x.state === 'vacant' || x.state === 'reserved').length,
    needs: list.filter(x => x.occupant && x.occupant.need_count > 0).length,
    pending_closure: pendingClosures.length   // 已退房尚未辦產婦結案
  };
  res.json({ date: d, stats, rooms: list });
});

// 7日內入住／退房清單（媽媽房況分頁）：checkins＝7日內（含逾期未入住）預約、checkouts＝7日內（含逾期）應退房
app.get('/api/room-status/mother-upcoming', requireStaff, (req, res) => {
  const d = today();
  const checkins = db.prepare(`
    SELECT bk.check_in, bk.check_out, r.name AS room_name, r.room_type,
           m.id AS mother_id, m.name AS mother_name, m.phone, m.due_date,
           m.birth_date AS mother_birth, m.id_no, m.delivery_date, m.delivery_type,
           (SELECT c.data FROM customer_contracts c WHERE c.mother_id = m.id AND c.status != 'archived') AS contract_data
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status = 'reserved' AND bk.check_in <= date(?, '+7 day')
      AND bk.continued_from IS NULL
    ORDER BY bk.check_in, r.name`).all(d);
  // 資料來源以「已儲存的寶寶報喜」為準（實際生產日／實際入住日與預產期、預訂日常有出入）：
  // 未報喜的預約不列入 7 日內入住；報喜儲存時實際入住日已回寫床表，故 check_in 即實際入住日
  const babyStmt = db.prepare('SELECT gender, birth_weight_g FROM babies WHERE mother_id = ? ORDER BY id');
  for (const c of checkins) {
    let cd = {};
    try { cd = JSON.parse(c.contract_data || '{}'); } catch (e) { cd = {}; }
    c.announced = !!cd.announce_date;
    c.birth_hospital = cd.birth_hospital || '';
    c.parity_no = cd.parity_no || '';
    c.weeks = cd.announce_weeks || '';
    c.id4 = String(c.id_no || '').slice(-4) || cd.announce_id4 || '';
    c.babies = babyStmt.all(c.mother_id);
    delete c.contract_data; delete c.id_no;
  }
  const announcedCheckins = checkins.filter(c => c.announced);
  const checkouts = db.prepare(`
    SELECT bk.check_in, bk.check_out, r.name AS room_name, r.room_type,
           m.id AS mother_id, m.name AS mother_name, m.phone
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status = 'checked_in' AND bk.check_out <= date(?, '+7 day')
    ORDER BY bk.check_out, r.name`).all(d);
  res.json({ date: d, checkins: announcedCheckins, checkouts });
});

// 照護紀錄查詢（入住中＋已出住）：kind=mother|baby，可依日期區間、媽媽姓名／房號關鍵字、住客狀態查詢
app.get('/api/care-records/query', requireStaff, (req, res) => {
  const kind = req.query.kind === 'baby' ? 'baby' : 'mother';
  const kw = (req.query.kw || '').trim();
  const kwtype = req.query.kwtype === 'room' ? 'room' : 'name';
  // status=checked_in（入住中）/checked_out（已出住）/all（預設兩者皆查）
  const status = ['checked_in', 'checked_out'].includes(req.query.status) ? req.query.status : 'all';
  const conds = [status === 'all' ? "m.status IN ('checked_in','checked_out')" : `m.status = '${status}'`];
  const args = {};
  if (req.query.start) { conds.push('date(x.recorded_at) >= @start'); args.start = req.query.start; }
  if (req.query.end) { conds.push('date(x.recorded_at) <= @end'); args.end = req.query.end; }
  // 房號依「紀錄當下」對應當時的房（多段轉房時歷史紀錄不被最後一段覆蓋）；查無涵蓋段落退回最近一次住房
  const roomSub = roomAtDateSql('date(x.recorded_at)', 'm.id');
  if (kw) {
    args.kw = `%${kw}%`;
    if (kwtype === 'room') conds.push(`${roomSub} LIKE @kw`);
    else conds.push(kind === 'baby' ? '(m.name LIKE @kw OR b.name LIKE @kw)' : 'm.name LIKE @kw');
  }
  const where = 'WHERE ' + conds.join(' AND ');
  let rows;
  if (kind === 'baby') {
    rows = db.prepare(`
      SELECT x.recorded_at, x.record_type, x.feed_method, x.amount_ml, x.diaper_kind, x.diaper_rash,
             x.value_num, x.value_text, x.note, b.name AS baby_name, m.name AS mother_name,
             u.name AS nurse_name, ${roomSub} AS room_name
      FROM baby_records x JOIN babies b ON b.id = x.baby_id JOIN mothers m ON m.id = b.mother_id
      LEFT JOIN users u ON u.id = x.nurse_id
      ${where} AND x.record_type != 'photo'
      ORDER BY x.recorded_at DESC LIMIT 1000`).all(args);
    return res.json(rows.map(r => ({
      recorded_at: r.recorded_at, room_name: r.room_name || '', subject: r.baby_name,
      mother_name: r.mother_name, type: BABY_TYPE_TW[r.record_type] || r.record_type,
      detail: babyDetailTW(r), note: r.note || '', nurse_name: r.nurse_name || ''
    })));
  }
  rows = db.prepare(`
    SELECT x.recorded_at, x.record_type, x.value_text, x.note, m.name AS mother_name,
           u.name AS nurse_name, ${roomSub} AS room_name
    FROM mother_records x JOIN mothers m ON m.id = x.mother_id
    LEFT JOIN users u ON u.id = x.nurse_id
    ${where}
    ORDER BY x.recorded_at DESC LIMIT 1000`).all(args);
  res.json(rows.map(r => ({
    recorded_at: r.recorded_at, room_name: r.room_name || '', subject: r.mother_name,
    mother_name: r.mother_name, type: MOTHER_TYPE_TW[r.record_type] || r.record_type,
    detail: r.value_text || '', note: r.note || '', nurse_name: r.nurse_name || ''
  })));
});

// 寶寶房況：在住寶寶的位置（嬰兒室／母嬰同室）與今日照護即時摘要
app.get('/api/room-status/babies', requireStaff, (req, res) => {
  const d = today();
  const rows = db.prepare(`
    SELECT b.id, b.name, b.gender, b.birth_date, b.birth_weight_g, b.location, b.notes,
           m.id AS mother_id, m.name AS mother_name, m.status AS mother_status,
           -- 房號：優先取當期住房（在住／今日應入住的預約），其次取最近一次已退房（待結案用）
           COALESCE(
             (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
               WHERE bk.mother_id = m.id AND bk.status != 'cancelled'
                 AND bk.check_in <= @d AND bk.check_out > @d
               ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1),
             (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id
               WHERE bk.mother_id = m.id AND bk.status = 'checked_out'
               ORDER BY bk.check_in DESC LIMIT 1)) AS room_name,
           (SELECT MAX(ll.moved_at) FROM baby_location_logs ll WHERE ll.baby_id = b.id) AS moved_at,
           (SELECT MAX(recorded_at) FROM baby_records WHERE baby_id = b.id AND record_type = 'feeding') AS last_feed_at,
           (SELECT feed_method FROM baby_records WHERE baby_id = b.id AND record_type = 'feeding'
             ORDER BY recorded_at DESC LIMIT 1) AS last_feed_method,
           (SELECT amount_ml FROM baby_records WHERE baby_id = b.id AND record_type = 'feeding'
             ORDER BY recorded_at DESC LIMIT 1) AS last_feed_ml,
           (SELECT COUNT(*) FROM baby_records WHERE baby_id = b.id AND record_type = 'feeding'
             AND date(recorded_at) = @d) AS feed_count,
           (SELECT COUNT(*) FROM baby_records WHERE baby_id = b.id AND record_type = 'diaper'
             AND diaper_kind = '濕' AND date(recorded_at) = @d) AS diaper_wet,
           (SELECT COUNT(*) FROM baby_records WHERE baby_id = b.id AND record_type = 'diaper'
             AND diaper_kind = '便' AND date(recorded_at) = @d) AS diaper_stool,
           (SELECT COUNT(*) FROM baby_records WHERE baby_id = b.id AND record_type = 'bath'
             AND date(recorded_at) = @d) AS bath_done,
           (SELECT value_num FROM baby_records WHERE baby_id = b.id AND record_type = 'temperature'
             ORDER BY recorded_at DESC LIMIT 1) AS last_temp,
           (SELECT recorded_at FROM baby_records WHERE baby_id = b.id AND record_type = 'temperature'
             ORDER BY recorded_at DESC LIMIT 1) AS last_temp_at,
           (SELECT value_num FROM baby_records WHERE baby_id = b.id AND record_type = 'jaundice'
             ORDER BY recorded_at DESC LIMIT 1) AS last_jaundice,
           (SELECT value_num FROM baby_records WHERE baby_id = b.id AND record_type = 'weight'
             ORDER BY recorded_at DESC LIMIT 1) AS last_weight,
           (SELECT a.data FROM baby_nursing_assessments a WHERE a.baby_id = b.id
             ORDER BY a.assess_date DESC, a.assess_time DESC, a.id DESC LIMIT 1) AS last_assess_data,
           (SELECT a.assess_date || ' ' || a.assess_time FROM baby_nursing_assessments a WHERE a.baby_id = b.id
             ORDER BY a.assess_date DESC, a.assess_time DESC, a.id DESC LIMIT 1) AS last_assess_at,
           (SELECT COUNT(*) FROM baby_closures c WHERE c.baby_id = b.id) AS closed,
           -- 退房日取當期住房（在住或今日應入住的預約），供結案按鈕的日期閘門
           (SELECT bk.check_out FROM bookings bk WHERE bk.mother_id = m.id AND bk.status != 'cancelled'
             AND bk.check_in <= @d AND bk.check_out > @d
             ORDER BY bk.status = 'checked_in' DESC, bk.check_in DESC LIMIT 1) AS check_out,
           (SELECT MAX(bk.actual_check_out) FROM bookings bk
             WHERE bk.mother_id = m.id AND bk.status = 'checked_out') AS mother_left_on
    FROM babies b JOIN mothers m ON m.id = b.mother_id
    WHERE m.status = 'checked_in'
       OR EXISTS (SELECT 1 FROM bookings bk JOIN rooms r ON r.id = bk.room_id
                  WHERE bk.mother_id = m.id AND r.room_type = '托嬰' AND bk.status != 'cancelled'
                    AND bk.check_in <= @d AND bk.check_out > @d)
       -- 今日應入住（媽媽尚為預約）：寶寶卡片同步出現，護理端當日即可建檔／評估
       OR EXISTS (SELECT 1 FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'reserved'
                  AND bk.check_out > @d AND COALESCE(NULLIF(bk.baby_check_in, ''), bk.check_in) <= @d)
       -- 媽媽已退房但寶寶尚未辦「產後嬰兒結案」：仍留在原房號供護理端結案（近 60 天內退房者）
       OR (NOT EXISTS (SELECT 1 FROM baby_closures c WHERE c.baby_id = b.id)
           AND EXISTS (SELECT 1 FROM bookings bk WHERE bk.mother_id = m.id
                       AND bk.status = 'checked_out' AND bk.actual_check_out >= date(@d, '-60 day')))
    ORDER BY b.location, m.name, b.name`).all({ d });
  // 托嬰：媽媽退房後寶寶續留館。托嬰起始日起自動轉為「托嬰」狀態、房號顯示「托嬰」
  const dcStmt = db.prepare(`SELECT bk.check_in, bk.check_out FROM bookings bk JOIN rooms r ON r.id = bk.room_id
    WHERE bk.mother_id = ? AND r.room_type = '托嬰' AND bk.status != 'cancelled'
      AND bk.check_in <= ? AND bk.check_out > ? ORDER BY bk.check_in DESC LIMIT 1`);
  for (const b of rows) {
    b.age_days = b.birth_date ? Math.round((new Date(d) - new Date(b.birth_date)) / 86400000) : null;
    // 最近一次寶寶護理評估的臍帶狀態（房況卡片顯示用）
    try { b.cord = JSON.parse(b.last_assess_data || '{}').cord || ''; } catch (e) { b.cord = ''; }
    delete b.last_assess_data;
    const dc = dcStmt.get(b.mother_id, d, d);
    // 媽媽已退房、非托嬰、寶寶尚未結案 → 標示「已退房・待結案」（護理端仍可在原房號辦嬰兒結案）
    b.pending_closure = !b.closed && !dc && b.mother_status === 'checked_out' && !!b.mother_left_on ? 1 : 0;
    // 本次住期的轉房歷程（寶寶隨媽媽的房段移動）
    const curBk = db.prepare(`SELECT id FROM bookings WHERE mother_id = ? AND status != 'cancelled'
      ORDER BY status = 'checked_in' DESC, check_in DESC LIMIT 1`).get(b.mother_id);
    const segs = curBk ? staySegmentsOf(curBk.id) : [];
    b.segments = segs;
    b.transfers = segs.length > 1 ? segs.length - 1 : 0;
    if (dc) {
      b.room_name = '托嬰';
      b.daycare_start = dc.check_in;
      b.daycare_end = dc.check_out;   // 寶寶結案日預設帶入托嬰結束日
      if (b.location !== 'daycare' && !b.closed) {
        db.prepare('UPDATE babies SET location = ? WHERE id = ?').run('daycare', b.id);
        db.prepare('INSERT INTO baby_location_logs (baby_id, location, note) VALUES (?,?,?)')
          .run(b.id, 'daycare', `托嬰起始日 ${dc.check_in} 自動轉入`);
        b.location = 'daycare';
      }
    }
  }
  const alerts = abnormalRecords(d, d); // 今日異常照護紀錄（門檻取自系統設定）
  // 今日入住寶寶（寶寶報喜資料已儲存者）：
  // 媽媽預約中 → 以寶寶預計入住日（未填則隨媽媽入住日）今日（含逾期）應到；
  // 媽媽已入住但寶寶不在館內／住院中 → 以寶寶預計入住日今日（含逾期）應到
  const dueIn = db.prepare(`
    SELECT b.id, b.name, b.gender, b.birth_date, b.birth_weight_g, b.location,
           m.id AS mother_id, m.name AS mother_name, r.name AS room_name,
           bk.status AS booking_status,
           COALESCE(NULLIF(bk.baby_check_in, ''), bk.check_in) AS arrive_date
    FROM babies b
    JOIN mothers m ON m.id = b.mother_id
    JOIN bookings bk ON bk.mother_id = m.id
    JOIN rooms r ON r.id = bk.room_id
    WHERE (bk.status = 'reserved' AND bk.check_out > ? AND bk.continued_from IS NULL
            AND COALESCE(NULLIF(bk.baby_check_in, ''), bk.check_in) <= ?)
       OR (bk.status = 'checked_in' AND b.location IN ('out', 'hospital')
            AND NULLIF(bk.baby_check_in, '') IS NOT NULL AND bk.baby_check_in <= ?)
    GROUP BY b.id
    ORDER BY arrive_date, r.name`).all(d, d, d);
  res.json({
    date: d,
    stats: {
      total: rows.length,
      nursery: rows.filter(b => b.location === 'nursery').length,
      rooming: rows.filter(b => b.location === 'rooming').length,
      isolation: rows.filter(b => b.location === 'isolation').length,
      out: rows.filter(b => b.location === 'out').length,
      hospital: rows.filter(b => b.location === 'hospital').length,
      daycare: rows.filter(b => b.location === 'daycare').length,
      due_in: dueIn.length,
      pending_closure: rows.filter(b => b.pending_closure).length,  // 已退房尚未辦產後嬰兒結案
      alerts: alerts.length
    },
    babies: rows, due_in: dueIn, alerts
  });
});

// ---------- 房務清潔 ----------
// 在住住客的清潔需求總覽（含勿擾時間／需求項目／備註）＋今日任務統計
app.get('/api/housekeeping', requireStaff, (req, res) => {
  const date = req.query.date || today();
  const residents = db.prepare(`
    SELECT m.id AS mother_id, m.name AS mother_name, m.hk_dnd, m.hk_needs, m.hk_notes,
           r.id AS room_id, r.name AS room_name, bk.check_in, bk.check_out,
           (SELECT COUNT(*) FROM housekeeping_logs h WHERE h.mother_id = m.id AND h.status='pending') AS pending_tasks
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status = 'checked_in'
    ORDER BY r.name`).all();
  const tasks = db.prepare(`
    SELECT h.*, r.name AS room_name, m.name AS mother_name,
           cu.name AS created_name, du.name AS done_name,
           (SELECT COUNT(*) FROM housekeeping_progress hp WHERE hp.task_id = h.id) AS progress_count,
           (SELECT hp.body FROM housekeeping_progress hp WHERE hp.task_id = h.id
             ORDER BY hp.created_at DESC, hp.id DESC LIMIT 1) AS last_progress
    FROM housekeeping_logs h
    LEFT JOIN rooms r ON r.id = h.room_id
    LEFT JOIN mothers m ON m.id = h.mother_id
    LEFT JOIN users cu ON cu.id = h.created_by
    LEFT JOIN users du ON du.id = h.done_by
    WHERE h.scheduled_for = ? OR (h.status='pending' AND h.scheduled_for < ?)
    ORDER BY h.status, h.scheduled_for, h.id DESC`).all(date, date);
  res.json({ date, residents, tasks });
});

// 更新某住客的清潔需求
app.put('/api/mothers/:id/housekeeping', requireStaff, (req, res) => {
  const m = db.prepare('SELECT id FROM mothers WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: '找不到住客' });
  const b = req.body || {};
  db.prepare('UPDATE mothers SET hk_dnd = ?, hk_needs = ?, hk_notes = ? WHERE id = ?').run(
    (b.hk_dnd || '').trim(), (b.hk_needs || '').trim(), (b.hk_notes || '').trim(), req.params.id);
  res.json({ ok: true });
});

// 新增清潔任務
app.post('/api/housekeeping/tasks', requireStaff, (req, res) => {
  const b = req.body || {};
  if (!b.task || !String(b.task).trim()) return res.status(400).json({ error: '請輸入清潔任務' });
  const info = db.prepare(`INSERT INTO housekeeping_logs
    (room_id, mother_id, task, scheduled_for, note, created_by, kind, location)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    b.room_id || null, b.mother_id || null, String(b.task).trim(),
    b.scheduled_for || today(), b.note || '', req.session.user.id,
    b.kind === 'repair' ? 'repair' : 'clean',
    b.room_id ? '' : String(b.location || '').trim().slice(0, 40));
  res.json({ id: info.lastInsertRowid });
});

// 任務進度儲存（有 log）：逐筆追加進度紀錄，不覆蓋歷史
app.get('/api/housekeeping/tasks/:id/progress', requireStaff, (req, res) => {
  res.json(db.prepare(`SELECT hp.*, u.name AS staff_name FROM housekeeping_progress hp
    LEFT JOIN users u ON u.id = hp.created_by
    WHERE hp.task_id = ? ORDER BY hp.created_at DESC, hp.id DESC`).all(req.params.id));
});
app.post('/api/housekeeping/tasks/:id/progress', requireStaff, (req, res) => {
  const t = db.prepare('SELECT id FROM housekeeping_logs WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '找不到任務' });
  const body = String((req.body || {}).body || '').trim().slice(0, 300);
  if (!body) return res.status(400).json({ error: '請輸入進度內容' });
  const info = db.prepare('INSERT INTO housekeeping_progress (task_id, body, created_by) VALUES (?,?,?)')
    .run(t.id, body, req.session.user.id);
  res.json({ id: info.lastInsertRowid });
});

// 更新清潔任務（完成／取消完成／編輯備註）
app.put('/api/housekeeping/tasks/:id', requireStaff, (req, res) => {
  const t = db.prepare('SELECT * FROM housekeeping_logs WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '找不到任務' });
  const b = req.body || {};
  if (b.status === 'done') {
    db.prepare(`UPDATE housekeeping_logs SET status='done', done_by=?, done_at=datetime('now','localtime'), note=? WHERE id=?`)
      .run(req.session.user.id, b.note ?? t.note, t.id);
  } else if (b.status === 'pending') {
    db.prepare(`UPDATE housekeeping_logs SET status='pending', done_by=NULL, done_at='', note=? WHERE id=?`)
      .run(b.note ?? t.note, t.id);
  } else {
    db.prepare('UPDATE housekeeping_logs SET task=?, scheduled_for=?, note=? WHERE id=?')
      .run(b.task ?? t.task, b.scheduled_for ?? t.scheduled_for, b.note ?? t.note, t.id);
  }
  res.json({ ok: true });
});

app.delete('/api/housekeeping/tasks/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM housekeeping_logs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 退費試算（依機構定型化契約參數）；同一公式供「入住中縮短住期」沿用 ----------
function refundQuoteOf(bk, leaveDate) {
  const s = getSettings();
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
  // 寶寶不在館內扣抵：不在館內紀錄落在「已使用期間」內的天數，每日扣抵
  const rate = babyDeductRate();
  syncBabyAbsences(bk);
  const babyAbsentUsed = Math.max(0, Math.min(babyAbsenceDays(bk, leaveDate), usedDays));
  const babyDeduct = babyAbsentUsed * rate;                   // 已使用期間的寶寶未入住扣抵
  const chainPrior = bk.continued_from ? chainPriorBalance(bk, rate) : 0;  // 切段接續：前段鏈未結（收款已移本段，應計入可收取）
  const deductible = Math.max(0, chainPrior + usedFee + charges + penalty + handling - babyDeduct); // 機構可收取合計
  const refund = Math.max(0, paid - deductible);
  return {
    booking_id: bk.id, mother_name: bk.mother_name, room_name: bk.room_name,
    check_in: bk.check_in, check_out: bk.check_out, leave_date: leaveDate,
    total_days: totalDays, used_days: usedDays, unused_days: unusedDays, daily_rate: dailyRate,
    paid_total: paid, charges_total: charges, used_fee: usedFee,
    penalty_pct: penaltyPct, penalty, handling_pct: handlingPct, handling,
    baby_absent_days: babyAbsentUsed, baby_deduct: babyDeduct,
    chain_prior: chainPrior, deductible, refund
  };
}
app.get('/api/bookings/:id/refund-quote', requireStaff, (req, res) => {
  const bk = db.prepare(`SELECT bk.*, m.name AS mother_name, r.name AS room_name, r.price_per_day
    FROM bookings bk JOIN mothers m ON m.id=bk.mother_id JOIN rooms r ON r.id=bk.room_id
    WHERE bk.id=?`).get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  res.json(refundQuoteOf(bk, req.query.leave_date || today()));
});

// 入住中縮短住期：以離開日期為新退房日，依退費試算公式重算合約應收，並連動訂餐／床表／房況
app.post('/api/bookings/:id/shorten', requireStaff, (req, res) => {
  const bk = db.prepare(`SELECT bk.*, m.name AS mother_name, r.name AS room_name, r.price_per_day
    FROM bookings bk JOIN mothers m ON m.id=bk.mother_id JOIN rooms r ON r.id=bk.room_id
    WHERE bk.id=?`).get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  if (bk.status !== 'checked_in') return res.status(400).json({ error: '僅入住中訂房可縮短住期（預約中請至排房資料調整）' });
  if (chainSuccessorId(bk.id)) return res.status(409).json({ error: '此訂房已有未生效的期間變更／轉房接續段，請先取消該接續段再操作' });
  const leaveDate = (req.body || {}).leave_date || '';
  const reason = String((req.body || {}).reason || '').trim().slice(0, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) return res.status(400).json({ error: '請填寫離開日期' });
  if (leaveDate < bk.check_in || leaveDate >= bk.check_out) {
    return res.status(400).json({ error: '離開日期需在入住日之後、原退房日之前' });
  }
  const q = refundQuoteOf(bk, leaveDate);
  // 新合約應收＝已使用住宿費＋違約金＋作業手續費（加購與寶寶扣抵由帳務另計；溢收顯示為負餘額待退）
  const newTotal = q.used_fee + q.penalty + q.handling;
  db.prepare(`UPDATE bookings SET check_out = ?, total_amount = ?, early_reason = ? WHERE id = ?`)
    .run(leaveDate, newTotal, reason ? `入住中縮短住期：${reason}` : '入住中縮短住期', bk.id);
  // 訂餐連動：清掉原住期、依新住期重鋪（入住日午餐～新退房日早餐；沿用原餐別與備註）
  const seed = db.prepare(`SELECT choice, note FROM meal_orders WHERE mother_id = ? AND meal_date >= ? AND meal_date <= ?
    ORDER BY meal_date, meal_type LIMIT 1`).get(bk.mother_id, bk.check_in, bk.check_out);
  if (seed) {
    db.prepare('DELETE FROM meal_orders WHERE mother_id = ? AND meal_date >= ? AND meal_date <= ?')
      .run(bk.mother_id, bk.check_in, bk.check_out);
    seedStayMeals(bk.mother_id, bk.check_in, leaveDate, seed.choice, seed.note || '');
  }
  // 托嬰段連動：媽媽提早出住時，接在原退房日之後的托嬰段整段順移到新退房日（天數不變）
  // 例：原 10 天住期＋出住後托嬰 5 天，第 N 天提早出住 → 托嬰改為新出住日起算 5 天
  let daycare_moved = null;
  const dcBk = db.prepare(`SELECT bk.id, bk.check_in, bk.check_out, r.name AS room_name
    FROM bookings bk JOIN rooms r ON r.id = bk.room_id
    WHERE bk.mother_id = ? AND r.room_type = '托嬰' AND bk.status != 'cancelled'
      AND bk.check_in >= ? ORDER BY bk.check_in LIMIT 1`).get(bk.mother_id, leaveDate);
  if (dcBk && dcBk.check_in !== leaveDate) {
    const dcDays = Math.max(1, Math.round((new Date(dcBk.check_out) - new Date(dcBk.check_in)) / 86400000));
    const newEnd = new Date(new Date(leaveDate + 'T00:00:00Z').getTime() + dcDays * 86400000)
      .toISOString().slice(0, 10);
    // 同房其他訂房撞期則不動，改回報提示由人工調整
    const clash = db.prepare(`SELECT m.name FROM bookings bk2 JOIN mothers m ON m.id = bk2.mother_id
      WHERE bk2.room_id = (SELECT room_id FROM bookings WHERE id = ?) AND bk2.id != ?
        AND bk2.status IN ('reserved','checked_in') AND bk2.check_in < ? AND bk2.check_out > ? LIMIT 1`)
      .get(dcBk.id, dcBk.id, newEnd, leaveDate);
    if (clash) {
      daycare_moved = { ok: false, warning: `托嬰段 ${leaveDate}~${newEnd} 與 ${clash.name} 撞期，未自動順移，請至排房調整` };
    } else {
      db.prepare('UPDATE bookings SET check_in = ?, check_out = ? WHERE id = ?').run(leaveDate, newEnd, dcBk.id);
      daycare_moved = { ok: true, from: dcBk.check_in, to: leaveDate, end: newEnd, days: dcDays };
      logAudit(req, { action: 'update', entity: 'bookings', entity_id: dcBk.id,
        summary: `縮短住期連動托嬰段順移：${dcBk.check_in}~${dcBk.check_out} → ${leaveDate}~${newEnd}（${dcDays}天不變）` });
    }
  }
  logAudit(req, { action: 'update', entity: 'bookings', entity_id: bk.id,
    summary: `入住中縮短住期：退房日 ${bk.check_out}→${leaveDate}、合約應收 ${bk.total_amount}→${newTotal}` +
      `（已用${q.used_days}天×${q.daily_rate}＋違約金${q.penalty}＋手續費${q.handling}）${reason ? `；原因：${reason}` : ''}` });
  logAudit(req, { action: 'update', entity: 'customer_contracts', entity_id: bk.mother_id,
    summary: `入住中縮短住期（訂房#${bk.id}）：退房日 ${bk.check_out}→${leaveDate}；銷售房型明細維持原約，應收依定型化契約重算` });
  res.json({ ok: true, check_out: leaveDate, total_amount: newTotal, quote: q, daycare_moved });
});

// ---------- 入住中期間變更（升等/降等，可同時增減天數）：生效日切段計價 ----------
// 已住天數照原房型單價、生效日起按新房間單價；若總天數縮短，縮短天數依定型化契約收違約金＋作業手續費
function changeStayQuoteOf(bk, effectiveDate, newRoom, newCheckOut) {
  const s = getSettings();
  const dayDiff = (a, c) => Math.round((new Date(c) - new Date(a)) / 86400000);
  const origDays = Math.max(1, dayDiff(bk.check_in, bk.check_out));
  const rate1 = bk.price_per_day > 0 ? bk.price_per_day : Math.round(bk.total_amount / origDays);
  const rate2 = newRoom.price_per_day > 0 ? newRoom.price_per_day
    : (((db.prepare('SELECT price FROM room_types WHERE name = ?').get(newRoom.room_type) || {}).price) || rate1);
  const days1 = dayDiff(bk.check_in, effectiveDate);
  const days2 = dayDiff(effectiveDate, newCheckOut);
  const unusedDays = Math.max(0, origDays - days1 - days2);
  const paid = bk.deposit + db.prepare('SELECT COALESCE(SUM(amount),0) t FROM payments WHERE booking_id=?').get(bk.id).t;
  const penaltyPct = Math.min(Math.max(parseFloat(s.refund_penalty_pct) || 0, 0), 100);
  const handlingPct = Math.min(Math.max(parseFloat(s.refund_handling_fee_pct) || 0, 0), 100);
  const penalty = unusedDays ? Math.round(unusedDays * rate1 * penaltyPct / 100) : 0;
  const handling = unusedDays ? Math.round(paid * handlingPct / 100) : 0;
  const seg1Total = days1 * rate1;
  const seg2Total = days2 * rate2 + penalty + handling;
  return {
    booking_id: bk.id, mother_name: bk.mother_name,
    old_room: bk.room_name, old_type: bk.room_type, new_room: newRoom.name, new_type: newRoom.room_type,
    check_in: bk.check_in, check_out: bk.check_out, effective_date: effectiveDate, new_check_out: newCheckOut,
    orig_days: origDays, days1, rate1, days2, rate2,
    unused_days: unusedDays, penalty_pct: penaltyPct, penalty, handling_pct: handlingPct, handling,
    seg1_total: seg1Total, seg2_total: seg2Total, old_total: bk.total_amount, new_total: seg1Total + seg2Total,
    grade: rate2 > rate1 ? '升等' : rate2 < rate1 ? '降等' : '平轉'
  };
}
function changeStayValidate(req) {
  const bk = db.prepare(`SELECT bk.*, m.name AS mother_name, r.name AS room_name, r.room_type, r.price_per_day
    FROM bookings bk JOIN mothers m ON m.id=bk.mother_id JOIN rooms r ON r.id=bk.room_id
    WHERE bk.id=?`).get(req.params.id);
  if (!bk) return { error: '找不到訂房', code: 404 };
  if (bk.status !== 'checked_in') return { error: '僅入住中訂房可辦理期間變更（預約中請至合約明細／排房資料調整）', code: 400 };
  if (chainSuccessorId(bk.id)) return { error: '此訂房已有未生效的期間變更／轉房接續段，請先取消該接續段再操作', code: 409 };
  const p = req.method === 'GET' ? req.query : (req.body || {});
  const effectiveDate = String(p.effective_date || '');
  const newCheckOut = String(p.new_check_out || '') || bk.check_out;
  const roomId = Number(p.room_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return { error: '請填寫生效日', code: 400 };
  if (!(effectiveDate > bk.check_in && effectiveDate < bk.check_out)) {
    return { error: '生效日需在入住日之後、原出住日之前（整段變更請於入住前辦理）', code: 400 };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newCheckOut) || newCheckOut <= effectiveDate) {
    return { error: '新出住日需在生效日之後', code: 400 };
  }
  const newRoom = db.prepare('SELECT * FROM rooms WHERE id = ? AND active = 1').get(roomId);
  if (!newRoom) return { error: '請選擇新房號', code: 400 };
  const hit = db.prepare(`SELECT m.name FROM bookings bk JOIN mothers m ON m.id = bk.mother_id
    WHERE bk.room_id = ? AND bk.id != ? AND bk.status IN ('reserved','checked_in')
      AND bk.check_in < ? AND bk.check_out > ? LIMIT 1`).get(roomId, bk.id, newCheckOut, effectiveDate);
  if (hit) return { error: `${newRoom.name} 房 ${effectiveDate}~${newCheckOut} 已有 ${hit.name} 的訂房，請改選其他房間或日期`, code: 409 };
  return { bk, effectiveDate, newCheckOut, newRoom };
}
app.get('/api/bookings/:id/change-stay-quote', requireStaff, (req, res) => {
  const v = changeStayValidate(req);
  if (v.error) return res.status(v.code).json({ error: v.error });
  res.json(changeStayQuoteOf(v.bk, v.effectiveDate, v.newRoom, v.newCheckOut));
});
app.post('/api/bookings/:id/change-stay', requireStaff, (req, res) => {
  const v = changeStayValidate(req);
  if (v.error) return res.status(v.code).json({ error: v.error });
  const { bk, effectiveDate, newCheckOut, newRoom } = v;
  const reason = String((req.body || {}).reason || '').trim().slice(0, 200);
  const q = changeStayQuoteOf(bk, effectiveDate, newRoom, newCheckOut);
  // 生效日已到＝立即切換；生效日在未來＝新段先掛預約、原段維持入住中，到生效日由排程自動轉換
  const immediate = effectiveDate <= today();
  const run = db.transaction(() => {
    // 原段收尾：出住日改生效日、應收＝已住天數×原單價；訂金隨帳務移往新段
    if (immediate) {
      db.prepare(`UPDATE bookings SET check_out = ?, actual_check_out = ?, total_amount = ?, deposit = 0, status = 'checked_out' WHERE id = ?`)
        .run(effectiveDate, effectiveDate, q.seg1_total, bk.id);
    } else {
      db.prepare(`UPDATE bookings SET check_out = ?, total_amount = ?, deposit = 0 WHERE id = ?`)
        .run(effectiveDate, q.seg1_total, bk.id);
    }
    // 新段：生效日起入住新房，應收＝天數×新單價（縮短時加計違約金／手續費）；接續鏈記前段
    const info = db.prepare(`INSERT INTO bookings (mother_id, room_id, check_in, check_out, deposit, total_amount, status, notes,
        baby_check_in, dunned_at, welcomed_at, continued_from)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(bk.mother_id, newRoom.id, effectiveDate, newCheckOut, bk.deposit, q.seg2_total,
        immediate ? 'checked_in' : 'reserved',
        `入住中期間變更（${q.grade}，原${bk.room_name}房）${reason ? `：${reason}` : ''}`,
        bk.baby_check_in || '', bk.dunned_at || '', bk.welcomed_at || '', bk.id);
    chainRelink(bk.id, info.lastInsertRowid);   // 原段既有接續段改接到新段（維持鏈線性）
    // 帳務隨住客走：收款與加購移到新段（收費帳務／退費試算以新段為現行帳；前段應收由接續鏈自動併入）
    db.prepare('UPDATE payments SET booking_id = ? WHERE booking_id = ?').run(info.lastInsertRowid, bk.id);
    db.prepare('UPDATE charge_items SET booking_id = ? WHERE booking_id = ?').run(info.lastInsertRowid, bk.id);
    // 房務：新房生效日前請備房（重複報喜同名待處理任務不重建）
    const mmdd = effectiveDate.slice(5).replace('-', '');
    const prepTask = `${newRoom.name}請備房${mmdd}`;
    if (!db.prepare(`SELECT 1 FROM housekeeping_logs WHERE mother_id = ? AND task = ? AND status = 'pending' LIMIT 1`)
      .get(bk.mother_id, prepTask)) {
      db.prepare(`INSERT INTO housekeeping_logs (room_id, mother_id, task, scheduled_for, note, created_by)
        VALUES (?,?,?,?,?,?)`).run(newRoom.id, bk.mother_id, prepTask, today(),
        `入住中期間變更：${bk.mother_name} ${effectiveDate} 自${bk.room_name}房換入`, req.session.user.id);
    }
    // 合約明細改為兩筆：找到對應原房型明細者拆為前後段；找不到則不動明細、僅記稽核
    const cc = db.prepare("SELECT items FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(bk.mother_id);
    let itemNote = '明細無對應原房型項目，未自動改寫';
    if (cc) {
      let items = [];
      try { items = JSON.parse(cc.items || '[]'); } catch (e) { items = []; }
      let ci = items.findIndex(it => it.name === bk.room_type && Number(it.qty) === q.orig_days);
      if (ci < 0) ci = items.findIndex(it => it.name === bk.room_type);
      if (ci >= 0) {
        const totalOf = arr => arr.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
        const before = totalOf(items);
        const by = req.session.user.name, at = today();
        items.splice(ci, 1, { name: bk.room_type, qty: q.days1, price: q.rate1, by, at },
          { name: newRoom.room_type, qty: q.days2, price: q.rate2, by, at });
        db.prepare(`UPDATE customer_contracts SET items=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
          .run(JSON.stringify(items).slice(0, 12000), bk.mother_id);
        itemNote = `明細改為 ${bk.room_type} ${q.days1}天＋${newRoom.room_type} ${q.days2}天`;
        logAudit(req, { action: 'update', entity: 'customer_contracts', entity_id: bk.mother_id,
          summary: `入住中期間變更（${q.grade}）：${itemNote}（金額 ${before}→${totalOf(items)}）` });
      }
    }
    markContractsNeedResign(bk.mother_id);
    // 訂餐連動：住期尾端變動時清原住期重鋪（沿用原餐別；供餐至新出住日早餐）
    if (newCheckOut !== bk.check_out) {
      const seed = db.prepare(`SELECT choice, note FROM meal_orders WHERE mother_id = ? AND meal_date >= ? AND meal_date <= ?
        ORDER BY meal_date, meal_type LIMIT 1`).get(bk.mother_id, bk.check_in, bk.check_out);
      if (seed) {
        db.prepare('DELETE FROM meal_orders WHERE mother_id = ? AND meal_date >= ? AND meal_date <= ?')
          .run(bk.mother_id, bk.check_in, bk.check_out);
        seedStayMeals(bk.mother_id, bk.check_in, newCheckOut, seed.choice, seed.note || '');
      }
    }
    // 房務：原房生效日退房清潔任務
    db.prepare(`INSERT INTO housekeeping_logs (room_id, mother_id, task, scheduled_for, note, created_by)
      VALUES (?,?,?,?,?,?)`)
      .run(bk.room_id, bk.mother_id, `${bk.room_name}退房清潔`, effectiveDate,
        `入住中期間變更：${bk.mother_name} ${effectiveDate} 換至${newRoom.name}房`, req.session.user.id);
    logAudit(req, { action: 'update', entity: 'bookings', entity_id: bk.id,
      summary: `入住中期間變更（${q.grade}）：${bk.room_name}→${newRoom.name}房、生效日 ${effectiveDate}、出住日 ${bk.check_out}→${newCheckOut}；` +
        `應收 ${bk.total_amount}→${q.new_total}（前段${q.days1}天×${q.rate1}＋後段${q.days2}天×${q.rate2}` +
        `${q.penalty || q.handling ? `＋違約金${q.penalty}＋手續費${q.handling}` : ''}）${reason ? `；原因：${reason}` : ''}` });
    return info.lastInsertRowid;
  });
  let newId;
  try { newId = run(); } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ ok: true, new_booking_id: newId, immediate, quote: q });
});

// 切段生效排程：生效日在未來的新段（預約中）到期自動轉換——前段轉已退住、新段轉入住中
function sweepStayContinuations() {
  const rows = db.prepare(`SELECT s.id sid, p.id pid, p.check_out eff
    FROM bookings s JOIN bookings p ON p.id = s.continued_from
    WHERE s.status = 'reserved' AND p.status = 'checked_in' AND s.check_in <= ?`).all(today());
  for (const r of rows) {
    db.transaction(() => {
      db.prepare(`UPDATE bookings SET status = 'checked_out', actual_check_out = ? WHERE id = ?`).run(r.eff, r.pid);
      db.prepare(`UPDATE bookings SET status = 'checked_in' WHERE id = ?`).run(r.sid);
      insAudit.run(null, '系統', 'system', 'update', 'AUTO', 'bookings', String(r.sid), '',
        `切段生效：訂房#${r.pid} 轉已退住、#${r.sid} 自動轉入住中`, '', '');
    })();
  }
  return rows.length;
}
// 手動觸發（管理員；排程外例如剛改完系統時間、想立即生效時使用）
app.post('/api/admin/sweep-continuations', requireAdmin, (req, res) => {
  res.json({ ok: true, switched: sweepStayContinuations() });
});
// 啟動後補跑一次＋每 30 分鐘檢查一次（生效日當天自動切換，毋須人工辦理退房／入住）
if (process.env.NODE_ENV !== 'test') {
  setTimeout(() => { try { sweepStayContinuations(); } catch (e) { console.error('切段生效檢查失敗', e.message); } }, 5000);
  setInterval(() => { try { sweepStayContinuations(); } catch (e) { console.error('切段生效檢查失敗', e.message); } }, 30 * 60 * 1000);
}

// ---------- 期間轉房（不改銷售明細）：轉房日起換住他房，前後段沿用原合約單價、應收總額不變 ----------
// 預約中＝預定入住期間轉房（拆兩段預約，合約明細同房型同價拆兩筆以維持連動順序）
// 入住中＝入住後轉房（原段結至轉房日轉已退住、新段入住新房；銷售明細不動、不標需重簽）
app.post('/api/bookings/:id/transfer', requireStaff, (req, res) => {
  const bk = db.prepare(`SELECT bk.*, m.name AS mother_name, r.name AS room_name, r.room_type
    FROM bookings bk JOIN mothers m ON m.id=bk.mother_id JOIN rooms r ON r.id=bk.room_id
    WHERE bk.id=?`).get(req.params.id);
  if (!bk) return res.status(404).json({ error: '找不到訂房' });
  if (!['reserved', 'checked_in'].includes(bk.status)) return res.status(400).json({ error: '僅預約中／入住中訂房可轉房' });
  if (bk.status === 'checked_in' && chainSuccessorId(bk.id)) {
    return res.status(409).json({ error: '此訂房已有未生效的期間變更／轉房接續段，請先取消該接續段再操作' });
  }
  const b = req.body || {};
  const transferDate = String(b.transfer_date || '');
  const roomId = Number(b.room_id);
  const reason = String(b.reason || '').trim().slice(0, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) return res.status(400).json({ error: '請填寫轉房日' });
  if (!(transferDate > bk.check_in && transferDate < bk.check_out)) {
    return res.status(400).json({ error: '轉房日需在入住日之後、出住日之前（整段換房請直接改房號）' });
  }
  const newRoom = db.prepare('SELECT * FROM rooms WHERE id = ? AND active = 1').get(roomId);
  if (!newRoom) return res.status(400).json({ error: '請選擇新房號' });
  if (newRoom.id === bk.room_id) return res.status(400).json({ error: '新房號與目前相同' });
  const hit = db.prepare(`SELECT m.name FROM bookings bk2 JOIN mothers m ON m.id = bk2.mother_id
    WHERE bk2.room_id = ? AND bk2.id != ? AND bk2.status IN ('reserved','checked_in')
      AND bk2.check_in < ? AND bk2.check_out > ? LIMIT 1`).get(roomId, bk.id, bk.check_out, transferDate);
  if (hit) return res.status(409).json({ error: `${newRoom.name} 房 ${transferDate}~${bk.check_out} 已有 ${hit.name} 的訂房，請改選其他房間` });
  const dayDiff = (a, c) => Math.round((new Date(c) - new Date(a)) / 86400000);
  const totalDays = Math.max(1, dayDiff(bk.check_in, bk.check_out));
  const days1 = dayDiff(bk.check_in, transferDate), days2 = totalDays - days1;
  // 前後段沿用原合約單價；尾差記在後段，兩段合計＝原應收不變
  let rate = Math.round(bk.total_amount / totalDays);
  const run = db.transaction(() => {
    let itemNote = '';
    if (bk.status === 'reserved') {
      // 合約明細同房型同價拆兩筆（依段序對應），排房連動順序才不會錯位；非實質變更不標需重簽
      const bks = db.prepare(`SELECT id FROM bookings WHERE mother_id = ? AND status = 'reserved'
        ORDER BY check_in, id`).all(bk.mother_id);
      const idx = bks.findIndex(x => x.id === bk.id);
      const cc = db.prepare("SELECT items FROM customer_contracts WHERE mother_id = ? AND status != 'archived'").get(bk.mother_id);
      let items = [];
      try { items = JSON.parse((cc || {}).items || '[]'); } catch (e) { items = []; }
      if (idx >= 0 && idx < items.length) {
        const it = items[idx];
        if (Number(it.price) > 0) rate = Number(it.price);
        items.splice(idx, 1, { ...it, qty: days1 }, { ...it, qty: days2 });
        db.prepare(`UPDATE customer_contracts SET items=?, updated_at=datetime('now','localtime') WHERE mother_id=? AND status != 'archived'`)
          .run(JSON.stringify(items).slice(0, 12000), bk.mother_id);
        itemNote = `；明細 ${it.name} ${it.qty}天拆為 ${days1}＋${days2} 天（同價，總額不變）`;
      }
      db.prepare('UPDATE bookings SET check_out = ?, total_amount = ? WHERE id = ?')
        .run(transferDate, days1 * rate, bk.id);
      const rinfo = db.prepare(`INSERT INTO bookings (mother_id, room_id, check_in, check_out, deposit, total_amount, status, notes, continued_from)
        VALUES (?,?,?,?,0,?,'reserved',?,?)`)
        .run(bk.mother_id, newRoom.id, transferDate, bk.check_out, bk.total_amount - days1 * rate,
          `預定期間轉房（原${bk.room_name}房）${reason ? `：${reason}` : ''}`, bk.id);
      chainRelink(bk.id, rinfo.lastInsertRowid);
    } else {
      // 入住中：原段結至轉房日、新段入住新房（轉房日在未來＝新段先掛預約、排程到期自動轉換）；
      // 訂金／收款／加購隨住客移到新段，前段應收由接續鏈自動併入；房務排原房清潔＋新房請備房
      const immediate = transferDate <= today();
      if (immediate) {
        db.prepare(`UPDATE bookings SET check_out = ?, actual_check_out = ?, total_amount = ?, deposit = 0, status = 'checked_out' WHERE id = ?`)
          .run(transferDate, transferDate, days1 * rate, bk.id);
      } else {
        db.prepare(`UPDATE bookings SET check_out = ?, total_amount = ?, deposit = 0 WHERE id = ?`)
          .run(transferDate, days1 * rate, bk.id);
      }
      const info = db.prepare(`INSERT INTO bookings (mother_id, room_id, check_in, check_out, deposit, total_amount, status, notes,
          baby_check_in, dunned_at, welcomed_at, continued_from)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(bk.mother_id, newRoom.id, transferDate, bk.check_out, bk.deposit, bk.total_amount - days1 * rate,
          immediate ? 'checked_in' : 'reserved',
          `入住後轉房（原${bk.room_name}房）${reason ? `：${reason}` : ''}`,
          bk.baby_check_in || '', bk.dunned_at || '', bk.welcomed_at || '', bk.id);
      chainRelink(bk.id, info.lastInsertRowid);   // 原段既有接續段改接到新段（維持鏈線性）
      db.prepare('UPDATE payments SET booking_id = ? WHERE booking_id = ?').run(info.lastInsertRowid, bk.id);
      db.prepare('UPDATE charge_items SET booking_id = ? WHERE booking_id = ?').run(info.lastInsertRowid, bk.id);
      db.prepare(`INSERT INTO housekeeping_logs (room_id, mother_id, task, scheduled_for, note, created_by)
        VALUES (?,?,?,?,?,?)`)
        .run(bk.room_id, bk.mother_id, `${bk.room_name}退房清潔`, transferDate,
          `入住後轉房：${bk.mother_name} ${transferDate} 換至${newRoom.name}房`, req.session.user.id);
      const mmdd = transferDate.slice(5).replace('-', '');
      const prepTask = `${newRoom.name}請備房${mmdd}`;
      if (!db.prepare(`SELECT 1 FROM housekeeping_logs WHERE mother_id = ? AND task = ? AND status = 'pending' LIMIT 1`)
        .get(bk.mother_id, prepTask)) {
        db.prepare(`INSERT INTO housekeeping_logs (room_id, mother_id, task, scheduled_for, note, created_by)
          VALUES (?,?,?,?,?,?)`).run(newRoom.id, bk.mother_id, prepTask, today(),
          `入住後轉房：${bk.mother_name} ${transferDate} 自${bk.room_name}房換入`, req.session.user.id);
      }
    }
    logAudit(req, { action: 'update', entity: 'bookings', entity_id: bk.id,
      summary: `${bk.status === 'reserved' ? '預定期間轉房' : '入住後轉房'}：${bk.room_name}→${newRoom.name}房、轉房日 ${transferDate}` +
        `（前段${days1}天／後段${days2}天，單價與應收總額不變）${itemNote}${reason ? `；原因：${reason}` : ''}` });
  });
  try { run(); } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ ok: true, transfer_date: transferDate, new_room: newRoom.name, days1, days2 });
});

// ---------- 護理提醒：本班未完成護理紀錄／衛教未完成／家屬護理需求未處理 ----------
app.get('/api/nursing-reminders', requireStaff, (req, res) => {
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  const today = nowLocal.toISOString().slice(0, 10);
  const hh = nowLocal.getUTCHours();
  const shiftKey = hh < 8 ? 'night' : hh < 16 ? 'day' : 'evening';
  const shiftStart = hh < 8 ? '00:00:00' : hh < 16 ? '08:00:00' : '16:00:00';
  const shiftStartDT = `${today} ${shiftStart}`;
  const SHIFT_TW2 = { day: '白班', evening: '小夜', night: '大夜' };

  // 1) 護理紀錄未完成：在館寶寶（嬰兒室/親子同室/隔離室、未結案）本班既無護理評估、也無任一照護紀錄
  const babies = db.prepare(`SELECT b.id, b.name, m.name AS mother_name,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id WHERE bk.mother_id = m.id AND bk.status = 'checked_in' ORDER BY bk.check_in DESC LIMIT 1) AS room_name
    FROM babies b JOIN mothers m ON m.id = b.mother_id
    WHERE m.status = 'checked_in' AND b.location IN ('nursery','rooming','isolation')
      AND NOT EXISTS (SELECT 1 FROM baby_closures c WHERE c.baby_id = b.id)`).all();
  const hasAssess = db.prepare(`SELECT 1 FROM baby_nursing_assessments WHERE baby_id = ? AND (assess_date || ' ' || assess_time) >= ? LIMIT 1`);
  const hasRec = db.prepare(`SELECT 1 FROM baby_records WHERE baby_id = ? AND recorded_at >= ? LIMIT 1`);
  const records_incomplete = babies
    .filter(b => !hasAssess.get(b.id, shiftStartDT) && !hasRec.get(b.id, shiftStartDT))
    .map(b => ({ baby_id: b.id, baby_name: b.name, mother_name: b.mother_name, room_name: b.room_name }));

  // 2) 衛教未完成：checked_in 媽媽，入住第 N 天，衛教時間表中 day<=N 且尚未完成的項目
  let schedule = [];
  try { schedule = JSON.parse(getSettings().edu_schedule || '[]'); } catch (e) { schedule = []; }
  schedule = schedule.filter(x => x && Number(x.day) > 0);
  const moms = db.prepare(`SELECT m.id, m.name,
      (SELECT bk.check_in FROM bookings bk WHERE bk.mother_id = m.id AND bk.status = 'checked_in' ORDER BY bk.check_in DESC LIMIT 1) AS check_in,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id WHERE bk.mother_id = m.id AND bk.status = 'checked_in' ORDER BY bk.check_in DESC LIMIT 1) AS room_name
    FROM mothers m WHERE m.status = 'checked_in'`).all();
  const doneStmt = db.prepare('SELECT edu_day, item FROM edu_records WHERE mother_id = ? AND booking_id IN (?, 0)');
  const edu_pending = [];
  for (const mo of moms) {
    if (!mo.check_in) continue;
    const day = Math.floor((new Date(today) - new Date(mo.check_in)) / 86400000) + 1;
    if (day < 1) continue;
    const done = new Set(doneStmt.all(mo.id, stayRootForMother(mo.id)).map(r => r.edu_day + '' + r.item));
    const items = [];
    for (const sc of schedule) {
      if (Number(sc.day) > day) continue;
      for (const it of (sc.items || [])) if (!done.has(Number(sc.day) + '' + it)) items.push({ day: Number(sc.day), item: it });
    }
    if (items.length) edu_pending.push({ mother_id: mo.id, mother_name: mo.name, room_name: mo.room_name, day, items });
  }

  // 3) 護理需求未完成：家屬「聯繫護理站」留言未讀（sender=family, read_by_staff=0），依寶寶彙整
  //    僅列在住者（以有入住中訂房為準，與護理需求頁同一標準，兩邊件數才會一致）
  const nursing_needs = db.prepare(`SELECT fm.baby_id, b.name AS baby_name, m.name AS mother_name,
      (SELECT r.name FROM bookings bk JOIN rooms r ON r.id = bk.room_id WHERE bk.mother_id = m.id AND bk.status = 'checked_in' ORDER BY bk.check_in DESC LIMIT 1) AS room_name,
      COUNT(*) AS unread, MAX(fm.created_at) AS last_at,
      (SELECT x.body FROM family_messages x WHERE x.baby_id = fm.baby_id AND x.sender = 'family' AND x.read_by_staff = 0 ORDER BY x.id DESC LIMIT 1) AS last_body
    FROM family_messages fm JOIN babies b ON b.id = fm.baby_id JOIN mothers m ON m.id = b.mother_id
    WHERE fm.sender = 'family' AND fm.read_by_staff = 0
      AND EXISTS (SELECT 1 FROM bookings bk2 WHERE bk2.mother_id = m.id AND bk2.status = 'checked_in')
    GROUP BY fm.baby_id ORDER BY last_at DESC`).all();

  // 4) 媽媽護理紀錄未完成：在住媽媽當日尚未有任何護理紀錄（每天 9:30 後才提醒；當日 nurse 儲存即消失）
  const mm = nowLocal.getUTCMinutes();
  const showMother = hh > 9 || (hh === 9 && mm >= 30);
  let mother_records_incomplete = [];
  if (showMother) {
    const hasMR = db.prepare(`SELECT 1 FROM mother_records WHERE mother_id = ? AND date(recorded_at) = ? LIMIT 1`);
    mother_records_incomplete = moms
      .filter(mo => !hasMR.get(mo.id, today))
      .map(mo => ({ mother_id: mo.id, mother_name: mo.name, room_name: mo.room_name }));
  }

  res.json({ shift: SHIFT_TW2[shiftKey], date: today, records_incomplete, edu_pending, nursing_needs, mother_records_incomplete });
});

// 標記某媽媽某天某衛教項目已完成
app.post('/api/edu-records', requireStaff, (req, res) => {
  const b = req.body || {};
  if (!b.mother_id || !(Number(b.edu_day) > 0) || !String(b.item || '').trim()) return res.status(400).json({ error: '資料不完整' });
  db.prepare('INSERT OR IGNORE INTO edu_records (mother_id, booking_id, edu_day, item, done_by) VALUES (?,?,?,?,?)')
    .run(b.mother_id, stayRootForMother(b.mother_id), Math.round(Number(b.edu_day)), String(b.item).slice(0, 100), req.session.user.id);
  res.json({ ok: true });
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
// 標記單一則家屬護理需求為已處理
app.post('/api/family-messages/msg/:id/read', requireStaff, (req, res) => {
  const info = db.prepare(`UPDATE family_messages SET read_by_staff=1 WHERE id=? AND sender='family'`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: '找不到留言' });
  res.json({ ok: true });
});

// 護理需求總覽（依入住媽媽彙整；區分媽媽／寶寶需求＋勿擾時間，供護理需求頁使用）
// 「在住」以有入住中訂房為準（與媽媽房況看板同一標準），避免 mothers.status 不同步時漏列
app.get('/api/nursing-needs', requireStaff, (req, res) => {
  const d = today();
  const residents = db.prepare(`
    SELECT m.id AS mother_id, m.name AS mother_name, m.hk_dnd, m.hk_needs, m.hk_notes,
           r.name AS room_name
    FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
    WHERE bk.status = 'checked_in'
    GROUP BY m.id
    ORDER BY r.name`).all();
  const reqStmt = db.prepare(`
    SELECT fm.id, fm.baby_id, fm.body, fm.subject_type, fm.created_at, fm.sender_name, b.name AS baby_name
    FROM family_messages fm JOIN babies b ON b.id = fm.baby_id
    WHERE b.mother_id = ? AND fm.sender = 'family' AND fm.read_by_staff = 0
    ORDER BY fm.created_at DESC`);
  const list = residents.map(r => {
    const reqs = reqStmt.all(r.mother_id);
    return {
      ...r,
      mother_requests: reqs.filter(x => x.subject_type === 'mother'),
      baby_requests: reqs.filter(x => x.subject_type !== 'mother')
    };
  });
  res.json({ date: d, residents: list });
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
      .map(b => ({ ...b, gender: b.gender === 'male' ? '男' : b.gender === 'female' ? '女' : '', location: BABY_LOCATION_TW[b.location] || '嬰兒室' }))
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
    rows: () => { const rate = babyDeductRate(); return db.prepare(`SELECT bk.*, m.name AS mother_name, r.name AS room_name, ${BILLING_SUMS}
      FROM bookings bk JOIN mothers m ON m.id = bk.mother_id JOIN rooms r ON r.id = bk.room_id
      WHERE bk.status != 'cancelled' ORDER BY bk.check_in DESC`).all()
      .map(b => withBalance(b, rate)).map(b => ({ ...b, status: STATUS_TW[b.status] || b.status })); }
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
  const totalRooms = db.prepare("SELECT COUNT(*) c FROM rooms WHERE active=1 AND room_type != '托嬰'").get().c;
  const bookings = db.prepare("SELECT check_in, check_out FROM bookings WHERE status!='cancelled' AND check_out > ?").all(startDate);
  const payMap = {}; for (const r of db.prepare("SELECT substr(paid_on,1,7) m, SUM(amount) s FROM payments GROUP BY m").all()) payMap[r.m] = r.s;
  const tourMap = {}; for (const r of db.prepare("SELECT substr(tour_at,1,7) m, COUNT(*) c, SUM(CASE WHEN status='signed' THEN 1 ELSE 0 END) s FROM tours GROUP BY m").all()) tourMap[r.m] = r;
  const admMap = {}; for (const r of db.prepare("SELECT substr(check_in,1,7) m, COUNT(*) c FROM bookings WHERE status!='cancelled' AND continued_from IS NULL GROUP BY m").all()) admMap[r.m] = r.c;
  const disMap = {}; for (const r of db.prepare(`SELECT substr(bk.check_out,1,7) m, COUNT(*) c FROM bookings bk WHERE bk.status!='cancelled'
    AND NOT EXISTS (SELECT 1 FROM bookings s WHERE s.continued_from = bk.id AND s.status != 'cancelled') GROUP BY m`).all()) disMap[r.m] = r.c;
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

// 營運報表：每日入住率 + 評鑑品質 7 大指標（依衛福部產後護理機構評鑑精神，定義可於前端標示）
app.get('/api/reports/quality', requireStaff, (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '月份格式需為 YYYY-MM' });
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const totalRooms = db.prepare("SELECT COUNT(*) c FROM rooms WHERE active = 1 AND room_type != '托嬰'").get().c;
  const occOn = db.prepare(`SELECT COUNT(DISTINCT room_id) c FROM bookings
    WHERE status != 'cancelled' AND check_in <= ? AND check_out > ?`);

  // 每日入住率
  const daily = [];
  let occupiedDays = 0, staffingOkDays = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const date = `${month}-${String(i).padStart(2, '0')}`;
    const occ = occOn.get(date, date).c;
    occupiedDays += occ;
    const st = staffingCheck(date);
    const ok = st.shifts.every(s => s.ok);
    if (ok) staffingOkDays++;
    daily.push({ date, occupied: occ, total: totalRooms, rate: totalRooms ? Math.round(occ / totalRooms * 1000) / 10 : 0, staffing_ok: ok });
  }
  const patientDays = occupiedDays; // 住民日（以每日佔床房數估算）
  const avgOccupancy = totalRooms ? Math.round(occupiedDays / (totalRooms * daysInMonth) * 1000) / 10 : 0;

  // 異常事件（依發生月份）
  const incRows = db.prepare(`SELECT category, severity FROM incidents WHERE strftime('%Y-%m', occurred_at) = ?`).all(month);
  const falls = incRows.filter(r => r.category === 'fall').length;
  const infections = incRows.filter(r => r.category === 'infection').length;
  const clusters = db.prepare(`SELECT COUNT(*) c FROM cluster_events WHERE strftime('%Y-%m', onset_date) = ?`).get(month).c;
  const per1000 = n => patientDays ? Math.round(n / patientDays * 1000 * 100) / 100 : 0;

  // 手部衛生遵從率
  const hh = db.prepare(`SELECT COALESCE(SUM(opportunities),0) opp, COALESCE(SUM(compliant),0) comp
    FROM hand_hygiene_audits WHERE strftime('%Y-%m', audit_date) = ?`).get(month);
  const hhRate = hh.opp ? Math.round(hh.comp / hh.opp * 1000) / 10 : null;

  // 新生兒篩檢異常追蹤完成率（當月建立、結果為需複篩/異常者）
  const scr = db.prepare(`SELECT result, follow_up_done FROM newborn_screenings
    WHERE strftime('%Y-%m', created_at) = ? AND result IN ('refer','abnormal')`).all(month);
  const scrDone = scr.filter(r => r.follow_up_done).length;
  const screeningFollowRate = scr.length ? Math.round(scrDone / scr.length * 1000) / 10 : null;

  // 顧客滿意度（當月問卷中 rating 題平均，換算百分比；以 5 分制計）
  const resps = db.prepare(`SELECT r.answers, s.questions FROM survey_responses r
    JOIN surveys s ON s.id = r.survey_id WHERE strftime('%Y-%m', r.submitted_at) = ?`).all(month);
  let ratingSum = 0, ratingN = 0;
  for (const row of resps) {
    let qs = [], ans = {};
    try { qs = JSON.parse(row.questions || '[]'); ans = JSON.parse(row.answers || '{}'); } catch (e) { continue; }
    qs.forEach((q, idx) => {
      if (q && q.type === 'rating') {
        const v = Number(ans[idx]);
        if (v >= 1 && v <= 5) { ratingSum += v; ratingN++; }
      }
    });
  }
  const satisfaction = ratingN ? Math.round(ratingSum / ratingN / 5 * 1000) / 10 : null;
  const staffingRate = daysInMonth ? Math.round(staffingOkDays / daysInMonth * 1000) / 10 : 0;

  // 7 大指標（評鑑品管）
  const indicators = [
    { key: 'occupancy', name: '平均入住率', value: avgOccupancy, unit: '%', detail: `佔床 ${occupiedDays} 房日 / 可供 ${totalRooms * daysInMonth} 房日` },
    { key: 'fall_rate', name: '住民跌倒事件率', value: per1000(falls), unit: '‰（每千住民日）', detail: `跌倒 ${falls} 件 / 住民日 ${patientDays}` },
    { key: 'infection_rate', name: '院內感染事件率', value: per1000(infections), unit: '‰（每千住民日）', detail: `感染事件 ${infections} 件；群聚 ${clusters} 起` },
    { key: 'hand_hygiene', name: '手部衛生遵從率', value: hhRate, unit: '%', detail: hh.opp ? `${hh.comp} / ${hh.opp} 次稽核` : '當月無稽核' },
    { key: 'screening_follow', name: '新生兒篩檢異常追蹤完成率', value: screeningFollowRate, unit: '%', detail: scr.length ? `完成 ${scrDone} / 需追蹤 ${scr.length}` : '當月無需追蹤個案' },
    { key: 'satisfaction', name: '顧客滿意度', value: satisfaction, unit: '%', detail: ratingN ? `${resps.length} 份問卷、${ratingN} 題評分` : '當月無評分問卷' },
    { key: 'staffing', name: '護理人力配置達標率', value: staffingRate, unit: '%', detail: `達標 ${staffingOkDays} / ${daysInMonth} 天` }
  ];
  res.json({ month, total_rooms: totalRooms, days_in_month: daysInMonth, patient_days: patientDays, avg_occupancy: avgOccupancy, daily, indicators });
});

function computeMonthlyReport(month) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const totalRooms = db.prepare("SELECT COUNT(*) c FROM rooms WHERE active = 1 AND room_type != '托嬰'").get().c;
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
  const rows = db.prepare('SELECT id, username, name, role, phone, id_no, active, permissions, service_scope FROM users ORDER BY id').all();
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
      'INSERT INTO users (username, password_hash, name, role, phone, id_no, permissions, service_scope) VALUES (?,?,?,?,?,?,?,?)').run(
      u.username, hashPassword(u.password), u.name, role, u.phone || '',
      String(u.id_no || '').slice(0, 10), role === 'admin' ? '' : sanitizePerms(u.permissions),
      role === 'admin' ? '' : String(u.service_scope || '').trim().slice(0, 30));
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
  const scope = role === 'admin' ? '' : String(u.service_scope ?? cur.service_scope ?? '').trim().slice(0, 30);
  db.prepare('UPDATE users SET name=?, role=?, phone=?, id_no=?, active=?, permissions=?, service_scope=? WHERE id=?').run(
    u.name ?? cur.name, role, u.phone ?? cur.phone,
    String(u.id_no ?? cur.id_no ?? '').slice(0, 10),
    (u.active === undefined ? cur.active : (u.active ? 1 : 0)), perms, scope, cur.id);
  if (u.password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(u.password), cur.id);
  logAudit(req, { action: 'update', entity: 'users', entity_id: cur.id, summary: cur.username });
  res.json({ ok: true });
});

// ---------- 員工基本資料（沿用 users 表，登入權限0-5 對映 role/active，旗標對映模組權限） ----------
const EMP_DEFAULT_PERMS = ['baby_care', 'newborn_medical', 'mother_care', 'handover', 'incidents', 'infection',
  'residents', 'rooms', 'billing', 'shop', 'supplies', 'programs', 'members', 'meals', 'invoices', 'contracts', 'tours', 'shifts', 'family'];
const EMP_STR = (v, n = 60) => String(v || '').slice(0, n);
const EMP_B = v => (v === true || v === 1 || v === '1' || v === '是') ? 1 : 0;
const EMP_DATE = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '';
const EMP_LVL = v => Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
// 旗標 → 模組權限（union，只加不減）
function empPermsWith(baseArr, u) {
  const s = new Set(Array.isArray(baseArr) ? baseArr : []);
  if (EMP_B(u.flag_physician)) s.add('physician');
  if (EMP_B(u.flag_nursing)) { s.add('mother_care'); s.add('baby_care'); }
  return [...s];
}
const EMP_FIELDS = ['clock_no', 'department', 'emp_group', 'category', 'emp_level', 'home_phone', 'email', 'ext'];
const EMP_FLAGS = ['flag_tour', 'flag_checkpoint', 'flag_nutrition', 'flag_nursing', 'flag_physician', 'flag_intern'];

app.get('/api/employees', requireStaff, (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id').all();
  res.json(rows.map(u => { const { password_hash, ...rest } = u; return { ...rest, permissions: parsePermissions(u.permissions) }; }));
});

app.post('/api/employees', requireAdmin, (req, res) => {
  const u = req.body || {};
  if (!u.username || !u.name) return res.status(400).json({ error: '員工編碼與員工姓名必填' });
  const lvl = EMP_LVL(u.login_level);
  const role = lvl >= 5 ? 'admin' : 'nurse';
  const active = lvl > 0 ? 1 : 0;
  const perms = role === 'admin' ? '' : sanitizePerms(empPermsWith(EMP_DEFAULT_PERMS, u));
  const pwd = (u.password && String(u.password).trim()) ? String(u.password) : String(u.username); // 預設密碼同登入帳號
  const cols = ['username', 'password_hash', 'name', 'role', 'phone', 'id_no', 'active', 'permissions', 'resign_date', 'login_level', ...EMP_FIELDS, ...EMP_FLAGS];
  const vals = [u.username, hashPassword(pwd), u.name, role, EMP_STR(u.phone, 30), EMP_STR(u.id_no, 20), active, perms,
    EMP_DATE(u.resign_date), lvl, ...EMP_FIELDS.map(f => EMP_STR(u[f])), ...EMP_FLAGS.map(f => EMP_B(u[f]))];
  try {
    const info = db.prepare(`INSERT INTO users (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    logAudit(req, { action: 'create', entity: 'users', entity_id: info.lastInsertRowid, summary: u.username });
    res.json({ id: info.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: '員工編碼（登入帳號）重複' }); }
});

app.put('/api/employees/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '找不到員工' });
  const u = req.body || {};
  const lvl = u.login_level === undefined ? cur.login_level : EMP_LVL(u.login_level);
  const role = lvl >= 5 ? 'admin' : 'nurse';
  const active = lvl > 0 ? 1 : 0;
  if (cur.role === 'admin' && (role !== 'admin' || active === 0)) {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1").get().c;
    if (admins <= 1) return res.status(400).json({ error: '至少需保留一位啟用中的管理員' });
  }
  const perms = role === 'admin' ? '' : sanitizePerms(empPermsWith(parsePermissions(cur.permissions), u));
  const set = ['name=?', 'role=?', 'phone=?', 'id_no=?', 'active=?', 'permissions=?', 'resign_date=?', 'login_level=?',
    ...EMP_FIELDS.map(f => `${f}=?`), ...EMP_FLAGS.map(f => `${f}=?`)];
  const vals = [u.name ?? cur.name, role, EMP_STR(u.phone ?? cur.phone, 30), EMP_STR(u.id_no ?? cur.id_no, 20), active, perms,
    u.resign_date === undefined ? cur.resign_date : EMP_DATE(u.resign_date), lvl,
    ...EMP_FIELDS.map(f => u[f] === undefined ? cur[f] : EMP_STR(u[f])),
    ...EMP_FLAGS.map(f => u[f] === undefined ? cur[f] : EMP_B(u[f])), cur.id];
  db.prepare(`UPDATE users SET ${set.join(', ')} WHERE id=?`).run(...vals);
  if (u.password && String(u.password).trim()) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(String(u.password)), cur.id);
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
  const base = (s.public_base_url || '').replace(/\/$/, '') || `https://${req.headers.host || ''}`;
  (async () => {
    for (const ev of events) {
      try {
        const userId = ev.source && ev.source.userId;
        if (!userId) continue;
        const text = (ev.type === 'message' && ev.message && ev.message.type === 'text') ? (ev.message.text || '') : null;
        // 官賴選單「預約參觀」：postback（action=tour_booking）或關鍵字 → 回傳預約頁連結，不進客訊收件匣
        const wantBooking = (ev.type === 'postback' && /(^|&)action=tour_booking(&|$)/.test((ev.postback || {}).data || ''))
          || (text != null && text.trim() === '預約參觀');
        if (wantBooking) {
          const liffId = (s.line_liff_id || '').trim();
          const link = liffId ? `https://liff.line.me/${liffId}` : `${base}/tour-booking.html?lu=${encodeURIComponent(userId)}`;
          if (token) await notify.pushText(token, userId, `親愛的媽咪，您好！\n請點選以下連結預約參觀：\n${link}`);
          continue;
        }
        // 官賴選單「產後服務」：已綁定家屬 → 家屬入口連結；未綁定 → 指引輸入通行碼
        const wantPortal = (ev.type === 'postback' && /(^|&)action=family_portal(&|$)/.test((ev.postback || {}).data || ''))
          || (text != null && text.trim() === '產後服務');
        if (wantPortal) {
          const fams = db.prepare(`SELECT f.access_code, b.name AS baby_name FROM family_members f
            JOIN babies b ON b.id = f.baby_id WHERE f.line_user_id = ? AND f.active = 1`).all(userId);
          if (!token) continue;
          if (fams.length) {
            const links = fams.map(f => `${f.baby_name}：${base}/family.html?code=${f.access_code}`);
            await notify.pushText(token, userId,
              `親愛的家屬，您好！\n請點選以下連結進入家屬入口網頁，查看寶寶日報、照片與成長趨勢：\n${links.join('\n')}`);
          } else {
            await notify.pushText(token, userId,
              '您好！此功能於寶寶入住建檔（寶寶報喜）後開通。\n請直接於此輸入您的 8 碼家屬通行碼完成綁定（通行碼請向護理站索取）。');
          }
          continue;
        }
        // 家屬通行碼綁定：輸入 8 碼通行碼即綁定 LINE，之後每日自動收寶寶日報
        if (text != null && /^[A-Z0-9]{8}$/i.test(text.trim())) {
          const fam = db.prepare(`SELECT f.*, b.name AS baby_name FROM family_members f
            JOIN babies b ON b.id = f.baby_id WHERE f.access_code = ? AND f.active = 1`).get(text.trim().toUpperCase());
          if (fam) {
            db.prepare('UPDATE family_members SET line_user_id = ? WHERE id = ?').run(userId, fam.id);
            if (token) {
              await notify.pushText(token, userId,
                `綁定成功！您已綁定 ${fam.baby_name} 的家屬帳號（${fam.name}）。\n每日將自動傳送前一日的寶寶日報與成長趨勢。\n家屬入口：${base}/family.html?code=${fam.access_code}`);
            }
            continue;
          }
          // 查無此通行碼 → 當一般訊息進客訊收件匣
        }
        if (text != null) {
          const profile = token ? await notify.lineProfile(token, userId) : {};
          crmInbound('line', userId, text, profile);
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

// 對外線上參觀預約：潛在客戶自助送出，寫入參觀預約（狀態 scheduled、來源=線上預約）
app.get('/api/public/center', (req, res) => {
  const s = getSettings();
  res.json({ center_name: s.center_name || '' });
});
app.post('/api/public/tours', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 60);
  const phone = String(b.phone || '').trim().slice(0, 30);
  const date = String(b.date || '').trim();
  const time = String(b.time || '').trim() || '14:00';
  if (!name || !phone) return res.status(400).json({ error: '請填寫姓名與電話' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '請選擇參觀日期' });
  const tourAt = `${date} ${/^\d{2}:\d{2}$/.test(time) ? time : '14:00'}`;
  const note = String(b.note || '').trim().slice(0, 500);
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date || '')) ? b.due_date : '';
  const link = tourCustomerLink({ name, phone, due_date: due, source: '線上預約' }, null);
  db.prepare(`INSERT INTO tours (name, phone, due_date, tour_at, source, status, note, mother_id)
    VALUES (?,?,?,?,?, 'scheduled', ?, ?)`).run(name, phone, due, tourAt, '線上預約', note, link.motherId);
  // 即時通知值班有新預約（若已設定 LINE）
  try {
    const s = getSettings();
    const token = (s.line_channel_access_token || '').trim();
    if (token && s.line_staff_alert_id) {
      notify.pushText(token, s.line_staff_alert_id, `🗓️ 新線上參觀預約\n${name}（${phone}）\n希望參觀：${tourAt}${note ? `\n備註：${note}` : ''}`).catch(() => {});
    }
  } catch (e) { /* 通知失敗不影響預約 */ }
  res.json({ ok: true });
});

// ---------- LINE 官賴預約參觀（用戶端三步驟：建檔 → LINE 驗證碼 → 選時段送出） ----------
// Flex 卡片（確認中／已確認共用版型）
function tourFlexMessage({ title, intro, fields, centerName }) {
  return {
    type: 'flex', altText: title,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#d6336c', paddingAll: 'lg',
        contents: [
          { type: 'text', text: centerName ? `${centerName}` : '產後護理之家', size: 'xs', color: '#ffd9e5' },
          { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#ffffff', margin: 'sm' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: intro, wrap: true, size: 'sm', color: '#555555' },
          { type: 'separator' },
          ...fields.map(([k, v]) => ({
            type: 'box', layout: 'baseline', spacing: 'md',
            contents: [
              { type: 'text', text: k, size: 'sm', color: '#999999', flex: 2 },
              { type: 'text', text: String(v || '—'), size: 'sm', color: '#333333', flex: 4, wrap: true }
            ]
          }))
        ]
      }
    }
  };
}

// 預約頁設定（公開）：機構名稱／LIFF ID／LINE 是否已串接
app.get('/api/public/tour-config', (req, res) => {
  const s = getSettings();
  res.json({
    center_name: s.center_name || '',
    liff_id: (s.line_liff_id || '').trim(),
    line_enabled: !!(s.line_channel_access_token || '').trim()
  });
});

// 可預約時段（公開）：以「一般開放參觀時間」＋指定日期設定（含不開放日）計算，扣除已預約量
app.get('/api/public/tour-availability', (req, res) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month || '') ? req.query.month : today().slice(0, 7);
  const s = getSettings();
  const [y, m] = month.split('-').map(Number);
  const daysIn = new Date(y, m, 0).getDate();
  const todayStr = today();
  const days = [];
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    if (ds < todayStr) { days.push({ date: ds, closed: true, slots: [] }); continue; }
    const r = tourDaySlots(ds, s);
    // 當日已過的時段不可再約
    if (ds === todayStr) {
      const now = new Date().toTimeString().slice(0, 5);
      r.slots = r.slots.filter(x => x.time > now);
    }
    days.push({ date: ds, closed: r.closed, slots: r.slots });
  }
  res.json({ month, days });
});

const LINE_UID_RE = /^U[0-9a-f]{32}$/i;
function lineTourSession(token) {
  if (!token || typeof token !== 'string') return null;
  db.prepare("DELETE FROM line_tour_sessions WHERE expires_at < datetime('now','localtime')").run();
  return db.prepare('SELECT * FROM line_tour_sessions WHERE token = ?').get(token) || null;
}

// 步驟一：儲存媽咪資料並發送驗證碼（推播至用戶 LINE 聊天室）
app.post('/api/public/line-tours/register', async (req, res) => {
  const b = req.body || {};
  const s = getSettings();
  const chToken = (s.line_channel_access_token || '').trim();
  if (!chToken) return res.status(400).json({ error: '機構尚未完成 LINE 串接設定' });
  const lineUserId = String(b.line_user_id || '').trim();
  if (!LINE_UID_RE.test(lineUserId)) return res.status(400).json({ error: '無法取得您的 LINE 身分，請由官方帳號選單重新開啟' });
  const name = String(b.name || '').trim().slice(0, 60);
  const phone = String(b.phone || '').replace(/[-\s]/g, '');
  const parity = ['1', '2', '3', '4以上'].includes(b.parity) ? b.parity : '';
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date || '')) ? b.due_date : '';
  if (!name) return res.status(400).json({ error: '請填寫媽咪姓名' });
  if (!/^09\d{8}$/.test(phone)) return res.status(400).json({ error: '請填寫正確的手機號碼（09 開頭共 10 碼）' });
  if (!due) return res.status(400).json({ error: '請選擇預產期' });
  // 防濫發：同一用戶 10 分鐘內最多 3 次驗證碼
  const recent = db.prepare(`SELECT COUNT(*) c FROM line_tour_sessions
    WHERE line_user_id = ? AND created_at > datetime('now','localtime','-10 minutes')`).get(lineUserId).c;
  if (recent >= 3) return res.status(429).json({ error: '驗證碼發送過於頻繁，請稍後再試' });
  const code = String(crypto.randomInt(100000, 1000000));
  const token = crypto.randomBytes(24).toString('hex');
  const r = await notify.pushMessages(chToken, lineUserId, [{
    type: 'text', text: `【${s.center_name || '預約參觀'}】您的手機驗證碼為 ${code}，請於 10 分鐘內回到預約頁面輸入完成驗證。`
  }]);
  if (!r.ok) return res.status(400).json({ error: '驗證碼發送失敗，請確認已加入官方帳號好友後再試' });
  db.prepare(`INSERT INTO line_tour_sessions (token, line_user_id, name, phone, parity, due_date, code, expires_at)
    VALUES (?,?,?,?,?,?,?, datetime('now','localtime','+10 minutes'))`)
    .run(token, lineUserId, name, phone, parity, due, code);
  res.json({ ok: true, token });
});

// 步驟二：核對驗證碼
app.post('/api/public/line-tours/verify', (req, res) => {
  const b = req.body || {};
  const ses = lineTourSession(b.token);
  if (!ses) return res.status(400).json({ error: '驗證已逾時，請重新填寫資料' });
  if (ses.attempts >= 5) return res.status(429).json({ error: '錯誤次數過多，請重新填寫資料取得新驗證碼' });
  if (String(b.code || '').trim() !== ses.code) {
    db.prepare('UPDATE line_tour_sessions SET attempts = attempts + 1 WHERE id = ?').run(ses.id);
    return res.status(400).json({ error: '驗證碼不正確，請重新輸入' });
  }
  db.prepare('UPDATE line_tour_sessions SET verified = 1 WHERE id = ?').run(ses.id);
  res.json({ ok: true });
});

// 步驟三：選定時段送出預約 → 自動建潛在客戶檔＋待確認預約＋推播「安排中」訊息
app.post('/api/public/line-tours/book', async (req, res) => {
  const b = req.body || {};
  const ses = lineTourSession(b.token);
  if (!ses) return res.status(400).json({ error: '預約逾時，請重新填寫資料' });
  if (!ses.verified) return res.status(400).json({ error: '請先完成手機驗證' });
  const date = String(b.date || ''), time = String(b.time || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: '請選擇參觀時段' });
  if (date < today()) return res.status(400).json({ error: '參觀日期不可早於今天' });
  const s = getSettings();
  const day = tourDaySlots(date, s);
  const slot = day.closed ? null : day.slots.find(x => x.time === time);
  if (!slot || slot.left <= 0) return res.status(400).json({ error: '此時段已額滿或未開放，請重新選擇' });
  const tourAt = `${date} ${time}`;
  const link = tourCustomerLink({ name: ses.name, phone: ses.phone, due_date: ses.due_date, parity: ses.parity, source: 'LINE預約' }, null);
  const info = db.prepare(`INSERT INTO tours
    (name, phone, due_date, tour_at, source, status, note, parity, mother_id, line_user_id, confirm_status)
    VALUES (?,?,?,?, 'LINE預約', 'scheduled', '', ?, ?, ?, 'pending')`)
    .run(ses.name, ses.phone, ses.due_date, tourAt, ses.parity, link.motherId, ses.line_user_id);
  addTourLog(info.lastInsertRowid, '用戶自 LINE 官方帳號送出預約參觀，待員工確認', null);
  db.prepare('DELETE FROM line_tour_sessions WHERE id = ?').run(ses.id);
  const chToken = (s.line_channel_access_token || '').trim();
  // 推播「預約參觀安排中」給用戶（合約書指定訊息）
  notify.pushMessages(chToken, ses.line_user_id, [tourFlexMessage({
    title: '預約參觀安排中',
    intro: '親愛的媽咪，您好！\n我們已收到您的預約參觀申請。\n客服正在安排中，請稍等片刻～\n我們將會儘快與您聯繫，確認您的參觀時間！',
    fields: [['預約日期', date], ['預約時段', time], ['預產期', ses.due_date || '—'], ['胎次', ses.parity ? `第${ses.parity}胎` : '—']],
    centerName: s.center_name || ''
  })]).catch(() => {});
  // 通知值班人員有新的待確認預約
  if (chToken && s.line_staff_alert_id) {
    notify.pushText(chToken, s.line_staff_alert_id,
      `新 LINE 預約參觀（待確認）\n${ses.name}（${ses.phone}）\n希望參觀：${tourAt}\n預產期：${ses.due_date || '—'}／胎次：${ses.parity ? `第${ses.parity}胎` : '—'}\n請至客戶管理「待確認預約」確認。`).catch(() => {});
  }
  res.json({ ok: true, tour_at: tourAt });
});
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
  // 切段接續段（期間變更／轉房／拆分）不重複計入新收／出住
  const newAdm = cnt(`SELECT COUNT(*) c FROM bookings WHERE status!='cancelled' AND check_in BETWEEN ? AND ? AND continued_from IS NULL`, start, end);
  const discharges = cnt(`SELECT COUNT(*) c FROM bookings bk WHERE bk.status!='cancelled' AND bk.check_out BETWEEN ? AND ?
    AND NOT EXISTS (SELECT 1 FROM bookings s WHERE s.continued_from = bk.id AND s.status != 'cancelled')`, start, end);
  const startResidents = cnt(`SELECT COUNT(*) c FROM bookings WHERE status!='cancelled' AND check_in<=? AND check_out>?`, start, start);
  const endResidents = cnt(`SELECT COUNT(*) c FROM bookings WHERE status!='cancelled' AND check_in<=? AND check_out>?`, end, end);
  const occupiedBedDays = r.days.reduce((s, d) => s + d.occupied_rooms, 0);
  const babyCareDays = r.days.reduce((s, d) => s + d.babies, 0);
  const totalBedDays = r.total_rooms * r.days.length;
  // 平均住宿日數：以最終段結束為準、住期自接續鏈起始入住日起算（切段不縮短平均值）
  const losRows = db.prepare(`SELECT bk.check_in, bk.check_out, bk.continued_from FROM bookings bk
    WHERE bk.status!='cancelled' AND bk.check_out BETWEEN ? AND ?
    AND NOT EXISTS (SELECT 1 FROM bookings s WHERE s.continued_from = bk.id AND s.status != 'cancelled')`).all(start, end);
  const avgLos = losRows.length ? Math.round(losRows.reduce((s, b) =>
    s + Math.max(0, (new Date(b.check_out) - new Date(chainRootCheckIn(b))) / 86400000), 0) / losRows.length * 10) / 10 : 0;
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
  // 若此寶寶的媽媽已入住但尚未發送過歡迎，於建立家屬帳號時補送
  try {
    const bk = db.prepare(`SELECT bk.id FROM bookings bk JOIN babies b ON b.mother_id = bk.mother_id
      WHERE b.id = ? AND bk.status = 'checked_in' AND (bk.welcomed_at IS NULL OR bk.welcomed_at = '')
      ORDER BY bk.check_in DESC LIMIT 1`).get(f.baby_id);
    if (bk) maybeWelcome(bk.id);
  } catch (e) { /* 不影響建立帳號 */ }
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
    diaper_kind: r.diaper_kind, diaper_rash: r.diaper_rash, value_num: r.value_num, value_text: r.value_text,
    photo_file: r.photo_file, note: r.note, recorded_at: r.recorded_at
  }));
  report.photos = report.photos.map(r => ({ photo_file: r.photo_file, note: r.note, recorded_at: r.recorded_at }));
  res.json(report);
});

// 親子同室紀錄：寶寶在「親子同室」時，家屬可自行登記餵奶／尿布／睡眠／小提醒
const FAMILY_REC_TYPES = new Set(['feeding', 'diaper', 'sleep', 'note']);
app.post('/api/family/records', requireFamily, (req, res) => {
  const babyId = req.session.family.baby_id;
  const baby = db.prepare('SELECT id, location FROM babies WHERE id=?').get(babyId);
  if (!baby) return res.status(404).json({ error: '找不到寶寶' });
  if (baby.location !== 'rooming') return res.status(403).json({ error: '寶寶目前不在親子同室，暫時無法自行登記' });
  const b = req.body || {};
  const type = String(b.record_type || '');
  if (!FAMILY_REC_TYPES.has(type)) return res.status(400).json({ error: '不支援的紀錄類型' });
  let feed_method = '', amount_ml = null, diaper_kind = '', note = String(b.note || '').slice(0, 200);
  if (type === 'feeding') {
    feed_method = ['親餵', '瓶餵'].includes(b.feed_method) ? b.feed_method : '親餵';
    if (b.amount_ml != null && b.amount_ml !== '') {
      amount_ml = Math.round(Number(b.amount_ml));
      if (!(amount_ml >= 0 && amount_ml <= 500)) return res.status(400).json({ error: '奶量數值不正確' });
    }
  } else if (type === 'diaper') {
    diaper_kind = ['濕', '便'].includes(b.diaper_kind) ? b.diaper_kind : '濕';
  }
  const tag = '（家屬登記）';
  const finalNote = note ? `${note}${tag}` : tag;
  const info = db.prepare(`INSERT INTO baby_records
    (baby_id, nurse_id, record_type, feed_method, amount_ml, diaper_kind, note, location)
    VALUES (?, NULL, ?, ?, ?, ?, ?, 'rooming')`)
    .run(babyId, type, feed_method, amount_ml, diaper_kind, finalNote);
  res.json({ id: info.lastInsertRowid });
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
  const rows = db.prepare(`SELECT id, sender, sender_name, body, subject_type, read_by_staff, created_at FROM family_messages
    WHERE baby_id=? ORDER BY created_at DESC`).all(babyId);
  db.prepare(`UPDATE family_messages SET read_by_family=1 WHERE baby_id=? AND sender='staff'`).run(babyId);
  res.json(rows);
});

app.post('/api/family/messages', requireFamily, (req, res) => {
  const b = req.body || {};
  const body = (b.body || '').trim();
  if (!body) return res.status(400).json({ error: '請輸入留言內容' });
  if (body.length > 1000) return res.status(400).json({ error: '留言過長' });
  const subject_type = b.subject_type === 'mother' ? 'mother' : 'baby';
  const f = req.session.family;
  const info = db.prepare(`INSERT INTO family_messages (baby_id, family_id, sender, sender_name, body, subject_type, read_by_family)
    VALUES (?,?, 'family', ?, ?, ?, 1)`).run(f.baby_id, f.id, f.name + (f.relation ? `（${f.relation}）` : ''), body, subject_type);
  // 即時通知值班：家屬留言推播 LINE（需設定 token 與 line_staff_alert_id）
  try {
    const s = getSettings();
    const token = (s.line_channel_access_token || '').trim();
    if (token && s.line_staff_alert_id) {
      const baby = db.prepare('SELECT b.name, m.name AS mother_name FROM babies b JOIN mothers m ON m.id=b.mother_id WHERE b.id=?').get(f.baby_id);
      const text = `💬 家屬留言\n${baby ? baby.name : '寶寶'}（媽媽：${baby ? baby.mother_name : '-'}）\n${f.name}${f.relation ? `（${f.relation}）` : ''}：${body.slice(0, 200)}\n請至「家屬帳號」頁回覆。`;
      notify.pushText(token, s.line_staff_alert_id, text).catch(() => {});
    }
  } catch (e) { /* 通知失敗不影響留言 */ }
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
