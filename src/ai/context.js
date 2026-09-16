// AI 的「本站知識」與「本站接線」：每個站台不同的那一半。
//
// src/ai/provider.js、src/ai/agents.js、src/routes/ai.js 與 public/js/pages-ai.js
// 四個檔各站完全相同，差異全部收在這個檔。
//
// 本站的底座跟其他站不一樣：登入走 express-session（不是 JWT cookie）、
// 權限判斷是 server.js 裡的 userCan、setSetting 有白名單、稽核叫 logAudit(req, {...})。
// 那些差異全部壓在這裡。
const dbm = require('../db');
const db = dbm.db;

function today() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nowStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${today()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 本站的 settings 表有 DEFAULT_SETTINGS 白名單（寫不在白名單裡的鍵會被擋掉，
// 那是刻意的設計），所以 AI 的設定放自己的 ai_settings 表，不去動那份白名單。
function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM ai_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO ai_settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

// 稽核：本站的 logAudit 掛在 server.js 上（不是可 require 的模組），
// 所以這裡直接寫 audit_logs —— 欄位跟 logAudit 寫進去的一樣。
function audit(user, action) {
  try {
    db.prepare(`INSERT INTO audit_logs (user_id, user_name, role, action, method, entity, entity_id, path, summary)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(user ? user.id : null, user ? user.name : '', user ? user.role : '',
           'update', 'PUT', 'ai', '', '/api/ai/settings', action);
  } catch (e) { /* 稽核寫不進去不該擋住功能本身 */ }
}

const deps = { db, today, thisMonth: () => today().slice(0, 7), nowStamp, getSetting, setSetting, audit };

// 其他站的 requireStaff(moduleKey) = 「要登入 + 要有這個模組的權限」。
// 本站的登入是 session，模組權限是 admin 全通、其餘看 permissions 陣列。
function userCan(user, mod) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(mod);
}
function requireStaff(moduleKey) {
  return (req, res, next) => {
    const u = req.session && req.session.user;
    if (!u) return res.status(401).json({ error: '請先登入' });
    req.user = u;                       // 共用檔要的是 req.user
    if (moduleKey && !userCan(u, moduleKey)) {
      return res.status(403).json({ error: '您沒有這個功能的權限' });
    }
    next();
  };
}

// AI 呼叫要花錢，限流不是防攻擊，是防「按住不放」與程式打圈。
function rateLimit({ windowMs, max, prefix = '' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = prefix + (req.user ? req.user.id : (req.ip || ''));
    if (hits.size > 20000) { for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }
    let e = hits.get(key);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(key, e); }
    e.count++;
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ error: '請求過於頻繁，請稍後再試' });
    }
    next();
  };
}

// 共用檔拿它比對「AI 挑中的報表，這個帳號有沒有權限看」。
const ALL_MODULES = ['baby_care', 'newborn_medical', 'physician', 'mother_care', 'handover',
  'incidents', 'infection', 'residents', 'rooms', 'housekeeping', 'billing', 'shop', 'supplies',
  'programs', 'members', 'meals', 'invoices', 'contracts', 'tours', 'visitors', 'shifts',
  'family', 'crm', 'testimonials', 'reports', 'gov', 'certifications', 'surveys',
  'custom_forms', 'coupons', 'audit', 'export', 'settings', 'users', 'ai'];
function parsePermissions(user) {
  if (!user) return [];
  if (user.role === 'admin') return ALL_MODULES;
  return Array.isArray(user.permissions) ? user.permissions : [];
}

const guard = { requireStaff, rateLimit, parsePermissions };

// AI 使用紀錄跟稽核軌跡是同一種東西（誰在什麼時候丟了什麼給 AI），門檻不該比它低。
const PERM = { audit: 'audit', settings: 'settings' };

// 哪些助理在這個站台啟用。沒宣告的助理端點回 404 不是 403 ——
// 403 會讓人以為只是權限沒開，其實這個站根本沒有這個功能。
const AGENT_MODULES = {
  askdb: null,
  ocr: 'residents',
  i18n: 'settings'
};

const COPY = {
  ocr_title: '媽媽手冊、出生證明與合約單據轉欄位',
  i18n_title: '入住須知、衛教說明與參觀回覆的多語初稿',
  i18n_where: '確認無誤後，請把譯文貼進對應的公告、衛教或通知欄位。'
};

const SITE = {
  key: 'mamacare',
  name: 'MamaCare 產後護理之家管理系統',
  audience: '產後護理之家的護理長、護理師、房務、業務與行政人員',
  business: [
    '這是產後護理之家（月子中心）用的管理系統，涵蓋寶寶照護與新生兒醫療、醫師巡診、',
    '媽媽照護、護理交班、異常事件與感染管制、住客與房務訂房、收費帳務與電子發票、',
    '月子餐與課程、合約簽署、參觀與訪客預約、排班、家屬帳號、評鑑月報與衛福部通報、',
    '員工證照、問卷與商城。',
    '產後護理機構受護理機構分級評鑑規範：人力比、感染管制、異常事件通報與紀錄保存都會被查。',
    '寶寶與產婦的健康資料屬最敏感的個資，家屬帳號只看得到自己的寶寶。',
    '你不得提供任何醫療診斷、用藥、餵食量或黃疸處置的建議 ——',
    '那是護理師與醫師的專業判斷與法定責任；有疑慮一律請醫師評估。'
  ].join('\n')
};

// ---- 自然語言問資料庫：可以問的東西的白名單 ----
// AI 只做「意圖分類 + 參數抽取」挑一張既有報表，永遠不寫 SQL，答案跟使用者自己點進去看到的一致。
// page 是本站的 hash 路由（不含 #/）。
const REPORTS = [
  { key: 'dashboard', label: '總覽', module: 'residents', page: 'dashboard',
    desc: '今日在住人數、空房、待辦與異常', params: ['date'] },
  { key: 'residents', label: '住客管理', module: 'residents', page: 'residents',
    desc: '在住媽媽與寶寶、入住與退房日期', params: ['keyword', 'date'] },
  { key: 'rooms', label: '房務與訂房', module: 'rooms', page: 'rooms',
    desc: '房間狀態、訂房與可入住日期', params: ['date', 'month'] },
  { key: 'bed-planning', label: '床位規劃', module: 'rooms', page: 'bed-planning',
    desc: '某段期間的床位配置與滿床風險', params: ['date', 'month'] },
  { key: 'baby-care', label: '寶寶照護', module: 'baby_care', page: 'baby-care',
    desc: '某一天的餵奶、換尿布、體重等照護紀錄完成度', params: ['date', 'keyword'] },
  { key: 'newborn-medical', label: '新生兒醫療', module: 'newborn_medical', page: 'newborn-medical',
    desc: '黃疸值、篩檢與就醫紀錄的追蹤狀況', params: ['date', 'keyword'] },
  { key: 'physician-visits', label: '醫師巡診', module: 'physician', page: 'physician-visits',
    desc: '巡診排程與紀錄', params: ['date', 'month'] },
  { key: 'mother-care', label: '媽媽照護', module: 'mother_care', page: 'mother-care',
    desc: '產婦的傷口、泌乳與衛教紀錄完成度', params: ['date', 'keyword'] },
  { key: 'handover', label: '護理交班', module: 'handover', page: 'handover',
    desc: '交班紀錄與未交待事項', params: ['date'] },
  { key: 'incidents', label: '異常事件', module: 'incidents', page: 'incidents',
    desc: '異常事件的通報、分級與後續處理（評鑑必查）', params: ['month', 'status'] },
  { key: 'infection', label: '感染管制', module: 'infection', page: 'infection',
    desc: '感染監測、隔離與清消紀錄', params: ['month', 'date'] },
  { key: 'housekeeping', label: '房務清潔', module: 'housekeeping', page: 'housekeeping',
    desc: '某一天的清潔工作與完成度', params: ['date'] },
  { key: 'meals', label: '膳食／月子餐', module: 'meals', page: 'meals',
    desc: '某一天的餐點、特殊飲食與備餐數', params: ['date'] },
  { key: 'programs', label: '課程與服務', module: 'programs', page: 'programs',
    desc: '課程場次、報名人數與服務預約', params: ['date', 'month'] },
  { key: 'billing', label: '收費帳務', module: 'billing', page: 'billing',
    desc: '某個月的收費、加購與未收款', params: ['month', 'keyword'] },
  { key: 'contracts', label: '合約簽署', module: 'contracts', page: 'contracts',
    desc: '合約的簽署狀況與待補件', params: ['month', 'keyword'] },
  { key: 'tours', label: '參觀預約', module: 'tours', page: 'tours',
    desc: '參觀預約的來源、成交與待追蹤', params: ['date', 'month', 'status'] },
  { key: 'visitors', label: '訪客預約', module: 'visitors', page: 'visitors',
    desc: '某一天的訪客預約與報到', params: ['date'] },
  { key: 'shifts', label: '排班與人力', module: 'shifts', page: 'shifts',
    desc: '某一天或某個月的班表與護理人力比', params: ['date', 'month'] },
  { key: 'certifications', label: '員工證照', module: 'certifications', page: 'certifications',
    desc: '人員證照效期與待更新（評鑑會查）', params: ['days', 'keyword'] },
  { key: 'supplies', label: '耗材庫存', module: 'supplies', page: 'supplies',
    desc: '尿布、奶粉等耗材庫存與待補', params: ['keyword'] },
  { key: 'quality-report', label: '評鑑月報', module: 'reports', page: 'quality-report',
    desc: '某個月的評鑑指標與統計', params: ['month'] }
];

// ---- 文件辨識：抽哪些欄位 ----
const DOC_TYPES = [
  { key: 'mom_handbook', label: '孕婦健康手冊', target: '住客管理',
    fields: ['產婦姓名', '出生日期', '預產期', '生產方式', '血型', '過敏史', '慢性病'] },
  { key: 'birth_cert', label: '出生證明書', target: '寶寶資料',
    fields: ['新生兒姓名', '性別', '出生日期', '出生時間', '出生體重', '身長', '母親姓名', '接生醫院'] },
  { key: 'discharge', label: '出院病歷摘要', target: '新生兒醫療',
    fields: ['姓名', '住院期間', '診斷', '黃疸值', '用藥', '出院建議', '回診日期'] },
  { key: 'id_card', label: '身分證', target: '住客管理',
    fields: ['姓名', '身分證字號', '出生日期', '戶籍地址'] },
  { key: 'staff_cert', label: '員工證照／研習證明', target: '員工證照',
    fields: ['姓名', '證照名稱', '證號', '發證單位', '發證日期', '有效期限', '時數'] },
  { key: 'receipt', label: '收據／統一發票', target: '收費帳務',
    fields: ['日期', '賣方名稱', '統一編號', '發票號碼', '未稅金額', '稅額', '總計'] }
];

// ---- 多語文案 ----
// 缺翻譯一律留空並標「未校對」，不自動上架。
const LANGUAGES = [
  { code: 'zh', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語（日文）' },
  { code: 'vi', label: 'Tiếng Việt（越南文）' },
  { code: 'id', label: 'Bahasa Indonesia（印尼文）' }
];

const SAMPLE_QUESTIONS = [
  '今天有幾間空房',
  '這個月的收費多少',
  '今天有誰要退房',
  '有哪些員工證照快到期',
  '這個月有幾件異常事件'
];

// 問題裡可能提到產婦或寶寶的名字。本站報表都吃關鍵字或日期，不吃人員 id，
// 所以回空陣列 —— 把住客姓名清單送進模型是不必要的個資外流。
function askEntities() { return []; }

module.exports = { SITE, COPY, AGENT_MODULES, SAMPLE_QUESTIONS, askEntities, REPORTS, DOC_TYPES, LANGUAGES, PERM, deps, guard };
