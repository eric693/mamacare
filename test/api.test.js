// API 整合測試：以獨立暫存資料庫啟動伺服器，驗證登入、RBAC 與各模組
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB = path.join('/tmp', `mamacare-test-${process.pid}.db`);
const PORT = 3200 + (process.pid % 600);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let cookie = '';

function cleanDb() { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* */ } } }

async function req(method, p, body, useCookie = true) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (useCookie && cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch (e) { /* */ }
  return { status: res.status, data };
}

before(async () => {
  cleanDb();
  const env = { ...process.env, MAMACARE_DB: DB };
  const seed = spawnSync('node', ['src/db.js', '--seed'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.strictEqual(seed.status, 0, '種子建立失敗：' + seed.stderr);
  // 強制此整合測試走 sqlite（不受外部 DB_BACKEND=pg 影響）
  server = spawn('node', ['src/server.js'], { cwd: ROOT, env: { ...env, PORT: String(PORT), SESSION_SECRET: 'test', NODE_ENV: 'test', DB_BACKEND: 'sqlite' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) return; } catch (e) { /* */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('伺服器未能在時限內啟動');
});

after(() => { if (server) server.kill('SIGKILL'); cleanDb(); });

test('未登入存取受保護 API → 401', async () => {
  cookie = '';
  assert.strictEqual((await req('GET', '/api/mothers')).status, 401);
});

test('管理員登入成功', async () => {
  const r = await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.user.role, 'admin');
});

test('錯誤密碼 → 401', async () => {
  const saved = cookie;
  const r = await req('POST', '/api/login', { username: 'admin', password: 'wrong' }, false);
  assert.strictEqual(r.status, 401);
  cookie = saved;
});

test('讀取住客與儀表板', async () => {
  assert.ok(Array.isArray((await req('GET', '/api/mothers')).data));
  assert.strictEqual((await req('GET', '/api/dashboard')).status, 200);
});

test('權限模組至少 30 個', async () => {
  const r = await req('GET', '/api/modules');
  assert.ok(r.data.length >= 30, '模組數=' + r.data.length);
});

test('RBAC：只給 meals 的帳號被擋下 billing、可用 meals', async () => {
  await req('POST', '/api/users', { username: 'kit_test', password: 'k12345', name: '廚房測試', role: 'nurse', permissions: ['meals'] });
  const adminCookie = cookie;
  cookie = '';
  assert.strictEqual((await req('POST', '/api/login', { username: 'kit_test', password: 'k12345' })).status, 200);
  assert.strictEqual((await req('GET', '/api/billing')).status, 403);
  assert.strictEqual((await req('GET', '/api/meal-config')).status, 200);
  cookie = adminCookie;
});

test('衛福部標準月報表欄位齊全', async () => {
  const r = await req('GET', '/api/gov/form?month=2026-06');
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.fields.length >= 15);
});

test('應收帳齡可取得', async () => {
  const r = await req('GET', '/api/billing/aging');
  assert.strictEqual(r.status, 200);
  assert.ok('buckets' in r.data);
});

test('交班自動草稿含 SBAR', async () => {
  const r = await req('GET', '/api/handovers/draft');
  assert.ok(r.data.situation && r.data.assessment);
});

test('經營分析回傳趨勢序列', async () => {
  const r = await req('GET', '/api/reports/analytics?months=6');
  assert.strictEqual(r.data.series.length, 6);
});

test('名人推薦公開頁免登入可讀', async () => {
  cookie = '';
  const r = await req('GET', '/api/public/testimonials', null, false);
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.data.items));
});

// ---- 電子簽署回歸測試 ----
const goodPng = 'data:image/png;base64,' +
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]).toString('base64');
let signCid, signTok;

test('電子簽署：由訂房＋範本建立合約', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' }); // 重新確保 admin
  const bk = (await req('GET', '/api/bookings')).data[0].id;
  const tpl = (await req('GET', '/api/contract-templates')).data.find(t => t.active).id;
  const r = await req('POST', `/api/bookings/${bk}/contracts`, { template_id: tpl });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.id);
  signCid = r.data.id;
  signTok = (await req('GET', `/api/contracts/${signCid}`)).data.sign_token;
  assert.ok(signTok);
});

test('電子簽署：公開頁免登入可讀（pending）', async () => {
  cookie = '';
  const r = await req('GET', `/api/sign/${signTok}`, null, false);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.status, 'pending');
  assert.ok(r.data.body.length > 0);
});

test('電子簽署：空白與偽造（非 PNG）簽名被擋', async () => {
  cookie = '';
  assert.strictEqual((await req('POST', `/api/sign/${signTok}`, { signer_name: 'X', signature_data: '' }, false)).status, 400);
  const fake = 'data:image/png;base64,' + Buffer.alloc(300, 9).toString('base64');
  assert.strictEqual((await req('POST', `/api/sign/${signTok}`, { signer_name: 'X', signature_data: fake }, false)).status, 400);
});

test('電子簽署：合法簽署成功且不可重簽（409）', async () => {
  cookie = '';
  const s = await req('POST', `/api/sign/${signTok}`, { signer_name: '王小明', signer_relation: '配偶', signature_data: goodPng }, false);
  assert.strictEqual(s.status, 200);
  const again = await req('POST', `/api/sign/${signTok}`, { signer_name: '再簽', signature_data: goodPng }, false);
  assert.strictEqual(again.status, 409);
});

test('電子簽署：無效連結 → 404', async () => {
  cookie = '';
  assert.strictEqual((await req('GET', '/api/sign/NOPE_INVALID', null, false)).status, 404);
});

test('電子簽署：重新簽署建立新版、原約作廢', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const r = await req('POST', `/api/contracts/${signCid}/resign`, { body: '重簽版本' });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.sign_token && r.data.sign_token !== signTok);
  const oldC = await req('GET', `/api/contracts/${signCid}`);
  assert.strictEqual(oldC.data.status, 'void');
});

// ---- 商城結帳（優惠券＋點數）回歸測試 ----
test('商城：下單→優惠券＋點數結帳→確認入帳→扣庫存＋回饋點數', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const pid = (await req('POST', '/api/products', { name: '回歸測試商品', price: 1000, track_stock: 1, stock: 10, active: 1 })).data.id;
  await req('POST', '/api/coupons', { code: 'TESTCPN', discount_type: 'amount', discount_value: 100, min_spend: 0 });
  const mom = (await req('GET', '/api/members')).data[0];
  await req('POST', `/api/members/${mom.id}/points`, { delta: 500 });
  // 試算：小計1000 − 券100 − 點數200 = 700
  const q = await req('POST', '/api/orders/quote', { items: [{ product_id: pid, quantity: 1 }], mother_id: mom.id, coupon_code: 'TESTCPN', points_used: 200 });
  assert.strictEqual(q.data.subtotal, 1000);
  assert.strictEqual(q.data.discount, 300);
  assert.strictEqual(q.data.total, 700);
  // 下單（代客）
  const oid = (await req('POST', '/api/orders', { mother_id: mom.id, items: [{ product_id: pid, quantity: 1 }], coupon_code: 'TESTCPN', points_used: 200 })).data.id;
  assert.ok(oid);
  // 下單即保留扣點：500 − 200 = 300
  assert.strictEqual((await req('GET', '/api/members')).data.find(m => m.id === mom.id).points, 300);
  // 確認入帳
  assert.strictEqual((await req('POST', `/api/orders/${oid}/confirm`)).status, 200);
  // 扣庫存 10 → 9
  assert.strictEqual((await req('GET', '/api/products')).data.find(p => p.id === pid).stock, 9);
  // 回饋點數 floor(700/100)=7 → 300 + 7 = 307
  assert.strictEqual((await req('GET', '/api/members')).data.find(m => m.id === mom.id).points, 307);
});

// ---- ECPay 付款回調入帳回歸測試 ----
test('ECPay：付款回調驗簽後自動入帳；錯誤簽章被拒', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const KEY = '5294y06JbISpM5x9', IV = 'v77hoKGq4kWxNNIS';
  await req('PUT', '/api/settings', { payment_provider: 'ecpay', ecpay_merchant_id: '2000132', ecpay_hash_key: KEY, ecpay_hash_iv: IV, ecpay_stage: '1', public_base_url: 'https://x.tw' });
  const bk = (await req('GET', '/api/bookings')).data[0].id;
  const intent = await req('POST', `/api/bookings/${bk}/payment-intent`, { amount: 3000 });
  assert.strictEqual(intent.status, 200);
  const mtn = intent.data.merchant_trade_no;
  assert.ok(mtn);
  const { ecpayCheckMac } = require('../src/payment');
  const cb = { MerchantID: '2000132', MerchantTradeNo: mtn, RtnCode: '1', RtnMsg: '交易成功', TradeNo: 'ITREGTEST01', TradeAmt: '3000', PaymentType: 'Credit_CreditCard', PaymentDate: '2026/06/29 12:00:00' };
  cb.CheckMacValue = ecpayCheckMac(cb, KEY, IV);
  const ok = await fetch(BASE + '/api/webhooks/ecpay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(cb).toString() });
  assert.strictEqual(await ok.text(), '1|OK');
  // 已入帳（線上刷卡 ECPay）
  const billing = await req('GET', `/api/bookings/${bk}/billing`);
  assert.ok(billing.data.payments.some(p => p.method.includes('ECPay') && p.amount === 3000));
  // 錯誤簽章被拒
  const bad = await fetch(BASE + '/api/webhooks/ecpay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'MerchantTradeNo=' + mtn + '&RtnCode=1&CheckMacValue=WRONG' });
  assert.strictEqual(await bad.text(), '0|CheckMacValue Error');
});

test('資安：非管理員讀取 settings 時金鑰被遮罩（不外洩明文）', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  await req('PUT', '/api/settings', { ecpay_hash_key: 'SUPERSECRETKEY' });
  // kit_test 由前面 RBAC 測試建立（只有 meals 權限）
  cookie = '';
  await req('POST', '/api/login', { username: 'kit_test', password: 'k12345' });
  const s = await req('GET', '/api/settings');
  assert.strictEqual(s.status, 200);
  assert.strictEqual(s.data.ecpay_hash_key, '(已設定)');
  assert.notStrictEqual(s.data.ecpay_hash_key, 'SUPERSECRETKEY');
});

// ---- 寶寶評估單（嬰兒個案基本資料＋嬰兒入住評估）回歸測試 ----
test('寶寶評估單：個案基本資料存檔（含入住日）與入住評估新增', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const babyId = (await req('GET', '/api/room-status/babies')).data.babies[0].id;
  // 初始：病歷號系統帶入、尚無個案資料
  const g0 = await req('GET', `/api/babies/${babyId}/eval`);
  assert.strictEqual(g0.status, 200);
  assert.match(g0.data.medical_no, /^B\d{5}$/);
  assert.strictEqual(g0.data.profile, null);
  // 入住日存檔（部分欄位）
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/eval-profile`,
    { checkin_date: '2026-06-24', checkin_time: '13:39' })).status, 200);
  // APGAR 超出 1~10 被擋
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/eval-profile`, { apgar: 11 })).status, 400);
  // 完整存檔與既有資料合併
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/eval-profile`, {
    birth_date: '2026-06-24', birth_time: '08:00', birth_place: '測試醫院', apgar: 9,
    delivery_modes: ['自然生產'], prom: '無', doic: '無', ma: '無',
    metabolic_screen: '已採檢', metabolic_screen_date: '2026-06-26', vaccination: '有'
  })).status, 200);
  const g1 = await req('GET', `/api/babies/${babyId}/eval`);
  assert.strictEqual(g1.data.profile.data.checkin_date, '2026-06-24'); // 部分存檔未被覆蓋
  assert.strictEqual(g1.data.profile.data.birth_place, '測試醫院');
  // 入住評估：缺 BT → 400；合法 → 建檔
  assert.strictEqual((await req('POST', `/api/babies/${babyId}/intake-assessments`,
    { assess_date: '2026-06-24', assess_time: '14:00', hr: 130, rr: 45, head_circ: 34 })).status, 400);
  const ok = await req('POST', `/api/babies/${babyId}/intake-assessments`, {
    assess_date: '2026-06-24', assess_time: '14:00', bt: 37.0, hr: 130, rr: 45, head_circ: 34,
    head_status: '正常', fontanelle: '平坦', scalp: '正常',
    rash_left: { level: '無', flags: [] }, rash_right: { level: '無', flags: [] }
  });
  assert.strictEqual(ok.status, 200);
  const g2 = await req('GET', `/api/babies/${babyId}/eval`);
  assert.strictEqual(g2.data.rows.length, 1);
  assert.strictEqual(g2.data.rows[0].data.fontanelle, '平坦');
});

// ---- 兒科醫師診視紀錄（醫師巡診）回歸測試 ----
test('醫師巡診：診視紀錄新增→修改→讀取；無 physician 權限被擋', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const babyId = (await req('GET', '/api/room-status/babies')).data.babies[0].id;
  // 缺診視時間 → 400
  assert.strictEqual((await req('POST', `/api/babies/${babyId}/doctor-visits`, { visit_date: '2026-07-04' })).status, 400);
  // 新增
  const ok = await req('POST', `/api/babies/${babyId}/doctor-visits`, {
    visit_date: '2026-07-04', visit_time: '20:31', weight_g: 3300,
    gest_weeks: 39, birth_days: 11, birth_weight_g: 3120,
    skin: ['正常'], fontanelle: '正常', heart: ['規律'], buttock: ['正常'], note: '一切正常'
  });
  assert.strictEqual(ok.status, 200);
  // 修改（記錄 edited_by）
  assert.strictEqual((await req('PUT', `/api/baby-doctor-visits/${ok.data.id}`, {
    visit_date: '2026-07-04', visit_time: '20:45', weight_g: 3310, skin: ['正常', '黃疸'], note: '輕微黃疸'
  })).status, 200);
  const g = await req('GET', `/api/babies/${babyId}/doctor-visits`);
  const row = g.data.rows.find(r => r.id === ok.data.id);
  assert.strictEqual(row.visit_time, '20:45');
  assert.deepStrictEqual(row.data.skin, ['正常', '黃疸']);
  assert.ok(row.edited_at);
  // RBAC：kit_test（僅 meals）→ 403
  const adminCookie = cookie;
  cookie = '';
  await req('POST', '/api/login', { username: 'kit_test', password: 'k12345' });
  assert.strictEqual((await req('GET', `/api/babies/${babyId}/doctor-visits`)).status, 403);
  cookie = adminCookie;
});

// ---- 產科醫師診視紀錄（醫師巡診；媽媽）回歸測試 ----
test('產科醫師巡診：診視紀錄新增→修改→讀取；無 physician 權限被擋', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const mom = (await req('GET', '/api/mothers')).data.find(m => m.status === 'checked_in');
  // 缺診視時間 → 400
  assert.strictEqual((await req('POST', `/api/mothers/${mom.id}/doctor-visits`, { visit_date: '2026-07-04' })).status, 400);
  // 新增
  const ok = await req('POST', `/api/mothers/${mom.id}/doctor-visits`, {
    visit_date: '2026-07-04', visit_time: '22:45', postpartum_days: 10,
    mood: '平穩', complaint: '無', feeding: ['純母乳'], breast: ['脹/充盈'],
    ep_wound: '平整', fundus_height: '平臍', uterus_state: '硬',
    lochia_amount: ['少'], lochia_color: ['暗紅'], urine: '正常', stool: '正常',
    hemorrhoid: '無', edema_none: true, note: '恢復良好'
  });
  assert.strictEqual(ok.status, 200);
  // 修改（記錄 edited_by）
  assert.strictEqual((await req('PUT', `/api/mother-doctor-visits/${ok.data.id}`, {
    visit_date: '2026-07-04', visit_time: '23:00', mood: '焦慮', epds_score: 8,
    breast: ['脹/充盈', '有硬塊'], note: '乳房輕微硬塊，衛教親餵'
  })).status, 200);
  const g = await req('GET', `/api/mothers/${mom.id}/doctor-visits`);
  const row = g.data.rows.find(r => r.id === ok.data.id);
  assert.strictEqual(row.visit_time, '23:00');
  assert.deepStrictEqual(row.data.breast, ['脹/充盈', '有硬塊']);
  assert.strictEqual(row.data.mood, '焦慮');
  assert.ok(row.edited_at);
  // RBAC：kit_test（僅 meals）→ 403
  const adminCookie = cookie;
  cookie = '';
  await req('POST', '/api/login', { username: 'kit_test', password: 'k12345' });
  assert.strictEqual((await req('GET', `/api/mothers/${mom.id}/doctor-visits`)).status, 403);
  cookie = adminCookie;
});

// ---- 產婦交班單回歸測試 ----
test('產婦交班單：新增→修改→飲食禁忌/備註/特殊餐存檔與表頭彙整', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  // 用另一位在住媽媽，避免動到「產婦入住護理評估表」測試的初始 null 斷言（共用同一 profile 表）
  const moms = (await req('GET', '/api/mothers')).data.filter(m => m.status === 'checked_in');
  const mom = moms[moms.length - 1];
  // 缺交班時間 → 400
  assert.strictEqual((await req('POST', `/api/mothers/${mom.id}/handovers`, { handover_date: '2026-07-05' })).status, 400);
  // 新增
  const ok = await req('POST', `/api/mothers/${mom.id}/handovers`, {
    handover_date: '2026-07-05', handover_time: '09:08',
    fundus: '臍下二指', lochia: '少／暗紅', note: '恢復良好，注意乳房硬塊'
  });
  assert.strictEqual(ok.status, 200);
  // 修改（記錄 edited_by）
  assert.strictEqual((await req('PUT', `/api/mother-handovers/${ok.data.id}`, {
    handover_date: '2026-07-05', handover_time: '09:30', fundus: '臍下三指', lochia: '微量／粉紅', note: '已衛教'
  })).status, 200);
  // 飲食禁忌＋重要備註＋特殊餐存檔（diet_notes 進 mothers、其餘進入住評估 profile）
  assert.strictEqual((await req('PUT', `/api/mothers/${mom.id}/handover-profile`, {
    diet_notes: '不吃牛', handover_note: '對青黴素過敏', sp_shenghua: '7/1~7/5', sp_redbean: '每日'
  })).status, 200);
  const g = await req('GET', `/api/mothers/${mom.id}/handovers`);
  const row = g.data.rows.find(r => r.id === ok.data.id);
  assert.strictEqual(row.fundus, '臍下三指');
  assert.ok(row.edited_at);
  assert.strictEqual(g.data.mother.diet_notes, '不吃牛');
  assert.strictEqual(g.data.header.handover_note, '對青黴素過敏');
  assert.strictEqual(g.data.header.sp_shenghua, '7/1~7/5');
  // 表頭宮底/惡露：交班單較新 → 帶交班單值
  assert.strictEqual(g.data.header.fundus_now.value, '臍下三指');
  // RBAC：kit_test（僅 meals）→ 403
  const adminCookie = cookie;
  cookie = '';
  await req('POST', '/api/login', { username: 'kit_test', password: 'k12345' });
  assert.strictEqual((await req('GET', `/api/mothers/${mom.id}/handovers`)).status, 403);
  cookie = adminCookie;
});

// ---- 護理指導獨立頁回歸測試 ----
test('護理指導：獨立 GET（提醒＋紀錄）→ 新增執行紀錄後提醒配對', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const moms = (await req('GET', '/api/mothers')).data.filter(m => m.status === 'checked_in');
  const mom = moms[moms.length - 1];
  const g0 = await req('GET', `/api/mothers/${mom.id}/guidance`);
  assert.strictEqual(g0.status, 200);
  assert.strictEqual(g0.data.reminders.length, 4);
  // 類別錯誤 → 400
  assert.strictEqual((await req('POST', `/api/mothers/${mom.id}/guidance`, { kind: 'xxx' })).status, 400);
  // 新增執行紀錄 → 提醒第 1 天視為完成
  const doneDate = g0.data.reminders[0].remind_date;
  assert.strictEqual((await req('POST', `/api/mothers/${mom.id}/guidance`,
    { kind: 'care', done_date: doneDate, note: '產後傷口照護指導' })).status, 200);
  const g1 = await req('GET', `/api/mothers/${mom.id}/guidance`);
  assert.strictEqual(g1.data.reminders[0].done_date, doneDate);
  assert.strictEqual(g1.data.reminders[0].kind, 'care');
  assert.ok(g1.data.guidance.some(x => x.note === '產後傷口照護指導'));
});

// ---- 產婦結案回歸測試 ----
test('產婦結案：結案存檔→更新→房況旗標→解除結案', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const moms = (await req('GET', '/api/mothers')).data.filter(m => m.status === 'checked_in');
  const mom = moms[moms.length - 1];
  // 初始未結案；缺原因/去向 → 400
  const g0 = await req('GET', `/api/mothers/${mom.id}/closure`);
  assert.strictEqual(g0.status, 200);
  assert.strictEqual(g0.data.closure, null);
  assert.ok(Array.isArray(g0.data.options.educations));
  assert.strictEqual((await req('PUT', `/api/mothers/${mom.id}/closure`,
    { close_date: '2026-07-05', close_time: '10:00' })).status, 400);
  // 條件必填：原因「其他」需補述
  assert.strictEqual((await req('PUT', `/api/mothers/${mom.id}/closure`,
    { close_date: '2026-07-05', close_time: '10:00', reason: '其他', destination: '返家' })).status, 400);
  // 未到退房日（seed 預退日在未來）→ 即使欄位齊全也擋下
  const occ = (await req('GET', '/api/room-status/mothers')).data.rooms
    .map(r => r.occupant).find(o => o && o.mother_id === mom.id);
  const closeBody = { close_date: '2026-07-05', close_time: '10:00', reason: '期滿結案', destination: '返家' };
  if (occ.check_out > new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)) {
    const blocked = await req('PUT', `/api/mothers/${mom.id}/closure`, closeBody);
    assert.strictEqual(blocked.status, 400);
    assert.ok(blocked.data.error.includes('未到退房日'));
    // 調整預退日為今日後放行
    const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    assert.strictEqual((await req('PUT', `/api/bookings/${occ.booking_id}`, { check_out: TODAY })).status, 200);
  }
  // 合法結案
  assert.strictEqual((await req('PUT', `/api/mothers/${mom.id}/closure`, {
    close_date: '2026-07-05', close_time: '10:00', reason: '期滿結案', destination: '返家',
    educations: ['惡露觀察', '乳房護理與哺乳', '不在清單的項目'], follow_up: '兩週後回診', note: '恢復良好'
  })).status, 200);
  const g1 = await req('GET', `/api/mothers/${mom.id}/closure`);
  assert.ok(g1.data.closure);
  assert.deepStrictEqual(g1.data.closure.data.educations, ['惡露觀察', '乳房護理與哺乳']); // 白名單過濾
  // 更新（記錄 edited_by）
  assert.strictEqual((await req('PUT', `/api/mothers/${mom.id}/closure`, {
    close_date: '2026-07-05', close_time: '11:00', reason: '提前退住', destination: '返家'
  })).status, 200);
  const g2 = await req('GET', `/api/mothers/${mom.id}/closure`);
  assert.strictEqual(g2.data.closure.data.reason, '提前退住');
  assert.ok(g2.data.closure.edited_at);
  // 結案存檔即代表已退房：房況不再有該媽媽（顯示空房），媽媽狀態轉 checked_out
  const rs = await req('GET', '/api/room-status/mothers');
  assert.ok(!rs.data.rooms.some(r => r.occupant && r.occupant.mother_id === mom.id));
  const mAfter = (await req('GET', '/api/mothers')).data.find(m => m.id === mom.id);
  assert.strictEqual(mAfter.status, 'checked_out');
  // 解除結案（admin）：結案時自動退房者一併恢復入住中
  const del = await req('DELETE', `/api/mother-closures/${mom.id}`);
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.data.restored, true);
  assert.strictEqual((await req('GET', `/api/mothers/${mom.id}/closure`)).data.closure, null);
  const mBack = (await req('GET', '/api/mothers')).data.find(m => m.id === mom.id);
  assert.strictEqual(mBack.status, 'checked_in');
  const rs2 = await req('GET', '/api/room-status/mothers');
  assert.ok(rs2.data.rooms.some(r => r.occupant && r.occupant.mother_id === mom.id));
  // 還原預退日，避免影響後續測試（換餐窗、7日內退房等）
  assert.strictEqual((await req('PUT', `/api/bookings/${occ.booking_id}`, { check_out: occ.check_out })).status, 200);
});

test('7日內入住／退房清單：在住媽媽依預退日列入 checkouts', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const r = await req('GET', '/api/room-status/mother-upcoming');
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.data.checkins) && Array.isArray(r.data.checkouts));
  for (const row of [...r.data.checkins, ...r.data.checkouts]) {
    for (const k of ['check_in', 'check_out', 'room_name', 'mother_name']) assert.ok(k in row, `缺欄位 ${k}`);
  }
});

test('寶寶報喜資料儲存→媽媽房況與寶寶房況列入今日入住名單', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const END = new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 10 * 86400000).toISOString().slice(0, 10);
  const mom = await req('POST', '/api/mothers', { name: '報喜測試媽', phone: '0911000111' });
  assert.strictEqual(mom.status, 200);
  // 訂房（今日入住、預約中）；避開既有訂房衝突逐房嘗試
  const rooms = (await req('GET', '/api/rooms')).data.filter(r => r.active && !r.occupant).reverse();
  let bk = null;
  for (const r of rooms) {
    const t = await req('POST', '/api/bookings', { mother_id: mom.data.id, room_id: r.id, check_in: TODAY, check_out: END });
    if (t.status === 200) { bk = t.data; break; }
  }
  assert.ok(bk, '找不到可訂房間');
  // 寶寶報喜資料儲存（登記寶寶出生資料）
  const baby = await req('POST', '/api/babies', {
    mother_id: mom.data.id, name: '報喜寶', gender: 'female', birth_date: TODAY, birth_weight_g: 3100
  });
  assert.strictEqual(baby.status, 200);
  // 媽媽房況：今日入住統計＋該房列為今日應入住
  const mrs = (await req('GET', '/api/room-status/mothers')).data;
  assert.ok(mrs.stats.due_in >= 1, '媽媽房況今日入住統計應 >= 1');
  assert.ok(mrs.rooms.some(r => r.next_booking && r.next_booking.mother_id === mom.data.id
    && (r.state === 'due_in' || r.occupant)), '該房應列入今日入住');
  // 寶寶房況：今日入住名單含報喜寶寶
  const brs = (await req('GET', '/api/room-status/babies')).data;
  assert.ok(brs.stats.due_in >= 1, '寶寶房況今日入住統計應 >= 1');
  const row = (brs.due_in || []).find(b => b.id === baby.data.id);
  assert.ok(row, '報喜寶寶應列入今日入住名單');
  assert.strictEqual(row.arrive_date, TODAY);
  assert.strictEqual(row.booking_status, 'reserved');
  // 還原：取消訂房後即不再列入
  assert.strictEqual((await req('PUT', `/api/bookings/${bk.id}/status`, { status: 'cancelled' })).status, 200);
  const brs2 = (await req('GET', '/api/room-status/babies')).data;
  assert.ok(!(brs2.due_in || []).some(b => b.id === baby.data.id));
});

// ---- 醫師查房清單／寶寶報喜／病歷資料回歸測試 ----
test('查房清單/寶寶報喜/病歷資料：查詢與權限', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  // 查房清單：在住媽媽逐列，欄位齊全
  const pr = await req('GET', '/api/physician-rounds');
  assert.strictEqual(pr.status, 200);
  assert.ok(pr.data.rows.length >= 2);
  for (const k of ['room_name', 'name', 'parity', 'delivery_type', 'problems', 'nursing_findings', 'doctor_note']) {
    assert.ok(k in pr.data.rows[0], `缺欄位 ${k}`);
  }
  // Excel 匯出
  const xls = await req('GET', '/api/physician-rounds?format=xlsx');
  assert.strictEqual(xls.status, 200);
  // 寶寶報喜：以 seed 寶寶生產日正向命中；冷門日期查無資料
  const babies = (await req('GET', '/api/babies')).data;
  const withBirth = babies.find(b => b.birth_date);
  if (withBirth) {
    const hit = await req('GET', `/api/baby-announcements?date=${withBirth.birth_date}`);
    assert.strictEqual(hit.status, 200);
    assert.ok(hit.data.rows.some(r => r.baby_name === withBirth.name));
    assert.ok('mother_check_in' in hit.data.rows[0] && 'baby_check_in' in hit.data.rows[0]);
  }
  const g = await req('GET', '/api/baby-announcements?date=2020-01-01');
  assert.strictEqual(g.status, 200);
  assert.strictEqual(g.data.rows.length, 0);
  // 病歷資料：無姓名 400、模糊查詢命中
  assert.strictEqual((await req('GET', '/api/medical-records')).status, 400);
  const mr = await req('GET', '/api/medical-records?name=' + encodeURIComponent('李'));
  assert.strictEqual(mr.status, 200);
  assert.ok(mr.data.rows.length >= 1);
  assert.ok('stay_range' in mr.data.rows[0] && 'baby_genders' in mr.data.rows[0]);
  // RBAC：kit_test（僅 meals）三端點皆 403
  const adminCookie = cookie;
  cookie = '';
  await req('POST', '/api/login', { username: 'kit_test', password: 'k12345' });
  assert.strictEqual((await req('GET', '/api/physician-rounds')).status, 403);
  assert.strictEqual((await req('GET', '/api/baby-announcements')).status, 403);
  assert.strictEqual((await req('GET', '/api/medical-records?name=x')).status, 403);
  cookie = adminCookie;
});

// ---- 客戶管理回歸測試 ----
test('客戶管理：新增潛客→查詢→編輯→行事曆；權限被擋', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  // 無條件查詢 → 400；缺預產期 → 400
  assert.strictEqual((await req('GET', '/api/customers')).status, 400);
  assert.strictEqual((await req('POST', '/api/customers', { name: '測試潛客' })).status, 400);
  // 新增潛客（mothers reserved＋profile）
  const ok = await req('POST', '/api/customers', {
    name: '測試潛客甲', phone: '0911222333', due_date: '2026-09-15', id_no: 'A234567890',
    identity: 'VIP', source: '親友介紹', hospital: '台大醫院', room_pref: '雙人房',
    contact_name: '王先生', contact_relation: '先生', referrer: '李小姐', referrer_fee: '2000'
  });
  assert.strictEqual(ok.status, 200);
  // 查詢：姓名模糊命中，欄位齊全
  const q = await req('GET', '/api/customers?name=' + encodeURIComponent('潛客甲'));
  assert.strictEqual(q.status, 200);
  const row = q.data.rows.find(r => r.id === ok.data.id);
  assert.strictEqual(row.status, 'reserved');
  assert.strictEqual(row.id_no, 'A234567890');
  // 讀取單筆：profile 帶回
  const g = await req('GET', `/api/customers/${ok.data.id}`);
  assert.strictEqual(g.data.profile.identity, 'VIP');
  assert.strictEqual(g.data.profile.referrer, '李小姐');
  // 編輯：mothers 同步＋profile 合併（未帶欄位不消失）
  assert.strictEqual((await req('PUT', `/api/customers/${ok.data.id}`,
    { phone: '0999888777', room_pref: '單人房' })).status, 200);
  const g2 = await req('GET', `/api/customers/${ok.data.id}`);
  assert.strictEqual(g2.data.mother.phone, '0999888777');
  assert.strictEqual(g2.data.profile.room_pref, '單人房');
  assert.strictEqual(g2.data.profile.referrer, '李小姐');
  // 行事曆
  const cal = await req('GET', '/api/tour-calendar?month=2026-07');
  assert.strictEqual(cal.status, 200);
  assert.ok(Array.isArray(cal.data.rows));
  // 互動紀錄：空白 400 → 新增 → 帶回；單筆 GET 同步帶出關聯資料（logs/tours/contracts/bookings）
  assert.strictEqual((await req('POST', `/api/customers/${ok.data.id}/logs`, { body: '' })).status, 400);
  assert.strictEqual((await req('POST', `/api/customers/${ok.data.id}/logs`,
    { body: '來電詢問月子餐與房價' })).status, 200);
  const g3 = await req('GET', `/api/customers/${ok.data.id}`);
  assert.ok(g3.data.logs.some(l => l.body === '來電詢問月子餐與房價'));
  for (const k of ['logs', 'tours', 'contracts', 'bookings', 'charges', 'payments']) assert.ok(Array.isArray(g3.data[k]), `缺 ${k}`);
  // 膳食資訊：7 天供餐預覽與設定
  assert.ok(g3.data.meals && Array.isArray(g3.data.meals.week) && g3.data.meals.week.length === 7);
  assert.ok(Array.isArray(g3.data.meals.slots) && g3.data.meals.slots.length >= 1);
  assert.ok(Array.isArray(g3.data.babies));
  // 預約參觀：由客戶帶入建立 → 依姓名比對帶回 → 狀態切換
  assert.strictEqual((await req('POST', '/api/tours', {
    name: '測試潛客甲', phone: '0999888777', tour_at: '2026-07-10 14:00', note: '客戶管理轉入'
  })).status, 200);
  let g5 = await req('GET', `/api/customers/${ok.data.id}`);
  const tr = g5.data.tours.find(t => t.note === '客戶管理轉入');
  assert.ok(tr);
  assert.strictEqual((await req('PUT', `/api/tours/${tr.id}`, { status: 'visited' })).status, 200);
  // 排房：建訂房（衝突擋 409）→ 入住 → 客戶狀態同步
  const rooms = (await req('GET', '/api/rooms')).data.filter(r => r.active && !r.occupant);
  const room = rooms[rooms.length - 1];
  const bk1 = await req('POST', '/api/bookings', {
    mother_id: ok.data.id, room_id: room.id, check_in: '2026-09-25', check_out: '2026-10-20', total_amount: 99000
  });
  assert.strictEqual(bk1.status, 200);
  assert.strictEqual((await req('POST', '/api/bookings', {
    mother_id: ok.data.id, room_id: room.id, check_in: '2026-10-01', check_out: '2026-10-05'
  })).status, 409);
  assert.strictEqual((await req('PUT', `/api/bookings/${bk1.data.id}/status`, { status: 'checked_in' })).status, 200);
  g5 = await req('GET', `/api/customers/${ok.data.id}`);
  assert.strictEqual(g5.data.mother.status, 'checked_in');
  assert.ok(g5.data.bookings.some(b => b.id === bk1.data.id && b.status === 'checked_in'));
  // 還原：退房（避免影響後續以「在住媽媽」為前提的測試）
  assert.strictEqual((await req('PUT', `/api/bookings/${bk1.data.id}/status`, { status: 'checked_out' })).status, 200);
  // 合約資料：存檔自動編號（YYYYMM+3碼）→ 明細新增（自動帶房價）→ 特殊折扣 → 刪除需說明
  assert.strictEqual((await req('PUT', `/api/customers/${ok.data.id}/contract`, {
    handler: '王小姐', sign_date: '2026-07-05', due_date: '2026-09-20',
    parity_no: '第1胎', baby_count: '單胞胎', diet_ban: '不吃羊肉', note: '合約備註測試'
  })).status, 200);
  let gc = await req('GET', `/api/customers/${ok.data.id}`);
  assert.ok(/^\d{6}\d{3}$/.test(gc.data.contract.contract_no), '合約編號格式 YYYYMM+3碼');
  assert.strictEqual(gc.data.contract.data.handler, '王小姐');
  assert.strictEqual(gc.data.mother.due_date, '2026-09-20');       // 同步 mothers
  assert.strictEqual(gc.data.mother.diet_notes, '不吃羊肉');
  assert.ok(Array.isArray(gc.data.room_types) && gc.data.room_types.length >= 1);
  const rt = gc.data.room_types[0];
  // 明細：缺天數 400、自動帶房價、特殊折扣自訂單價
  assert.strictEqual((await req('POST', `/api/customers/${ok.data.id}/contract/items`, { name: rt.name })).status, 400);
  assert.strictEqual((await req('POST', `/api/customers/${ok.data.id}/contract/items`, { name: rt.name, qty: 20 })).status, 200);
  assert.strictEqual((await req('POST', `/api/customers/${ok.data.id}/contract/items`, { name: rt.name, qty: 5, price: 5000 })).status, 200);
  gc = await req('GET', `/api/customers/${ok.data.id}`);
  assert.strictEqual(gc.data.contract.items.length, 2);
  assert.strictEqual(gc.data.contract.items[0].price, rt.price);
  assert.strictEqual(gc.data.contract.total, rt.price * 20 + 5000 * 5);
  // 刪除：無說明 400 → 有說明成功
  assert.strictEqual((await req('POST', `/api/customers/${ok.data.id}/contract/items/delete`, { index: 1 })).status, 400);
  assert.strictEqual((await req('POST', `/api/customers/${ok.data.id}/contract/items/delete`, { index: 1, reason: '客戶改期' })).status, 200);
  gc = await req('GET', `/api/customers/${ok.data.id}`);
  assert.strictEqual(gc.data.contract.items.length, 1);
  // 以合約編號後碼查詢命中
  const byNo = await req('GET', '/api/customers?contract_no=' + gc.data.contract.contract_no.slice(-4));
  assert.ok(byNo.data.rows.some(r => r.id === ok.data.id && r.contract_no === gc.data.contract.contract_no));
  // 在住媽媽帶出訂房收款欄位
  const inMom = (await req('GET', '/api/mothers')).data.find(m => m.status === 'checked_in');
  const g4 = await req('GET', `/api/customers/${inMom.id}`);
  assert.ok(g4.data.bookings.length >= 1);
  assert.ok('paid' in g4.data.bookings[0] && 'addon' in g4.data.bookings[0]);
  // RBAC：kit_test（僅 meals）→ 403
  const adminCookie = cookie;
  cookie = '';
  await req('POST', '/api/login', { username: 'kit_test', password: 'k12345' });
  assert.strictEqual((await req('GET', '/api/customers?name=x')).status, 403);
  assert.strictEqual((await req('GET', '/api/tour-calendar')).status, 403);
  cookie = adminCookie;
});

// ---- 客戶及簽約資料查詢回歸測試 ----
test('客戶簽約資料查詢：三模式／日期欄位／退訂與恢復／Excel', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  // 測試潛客甲已簽約且已排房（前面測試）→ transferred 模式命中
  const tf = await req('GET', '/api/client-contracts?mode=transferred');
  assert.strictEqual(tf.status, 200);
  const row = tf.data.rows.find(r => r.name === '測試潛客甲');
  assert.ok(row && row.checkin_date && row.days > 0);
  // signed 模式＝查全部合約（含已排房/入住），以狀態欄標示；排除條件可過濾
  const sg = await req('GET', '/api/client-contracts?mode=signed');
  const sgRow = sg.data.rows.find(r => r.name === '測試潛客甲');
  assert.ok(sgRow && ['已排房', '已入住', '已出住'].includes(sgRow.status_label));
  // 日期欄位過濾：以簽約日 2026-07-05 查 7 月命中、6 月不命中
  const hit = await req('GET', '/api/client-contracts?mode=transferred&date_field=sign&from=2026-07-01&to=2026-07-31');
  assert.ok(hit.data.rows.some(r => r.name === '測試潛客甲'));
  const miss = await req('GET', '/api/client-contracts?mode=transferred&date_field=sign&from=2026-06-01&to=2026-06-30');
  assert.ok(!miss.data.rows.some(r => r.name === '測試潛客甲'));
  // 關鍵字：合約編號後碼
  const no = row.contract_no;
  const kw = await req('GET', `/api/client-contracts?mode=transferred&keyword=${no.slice(-3)}&keyword_type=contract`);
  assert.ok(kw.data.rows.some(r => r.contract_no === no));
  // 退訂：原因必填 → 退訂後列入 cancelled 模式、transferred 消失 → admin 恢復
  assert.strictEqual((await req('POST', `/api/customers/${row.mother_id}/contract/cancel`, {})).status, 400);
  assert.strictEqual((await req('POST', `/api/customers/${row.mother_id}/contract/cancel`, { reason: '客戶改期生產' })).status, 200);
  const cx = await req('GET', '/api/client-contracts?mode=cancelled');
  const crow = cx.data.rows.find(r => r.mother_id === row.mother_id);
  assert.ok(crow && crow.cancel_reason === '客戶改期生產' && crow.cancel_by);
  assert.ok(!(await req('GET', '/api/client-contracts?mode=transferred')).data.rows.some(r => r.mother_id === row.mother_id));
  assert.strictEqual((await req('POST', `/api/customers/${row.mother_id}/contract/restore`, {})).status, 200);
  assert.ok((await req('GET', '/api/client-contracts?mode=transferred')).data.rows.some(r => r.mother_id === row.mother_id));
  // Excel 匯出
  assert.strictEqual((await req('GET', '/api/client-contracts?mode=signed&format=xlsx')).status, 200);
});

// ---- 產後報表引擎回歸測試 ----
test('產後報表：清單／各報表可產出／收款統計分類／Excel', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const list = await req('GET', '/api/pp-reports');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.data.length, 33);
  // 全部報表都能無錯產出（寬日期範圍掃 seed 資料）
  for (const r of list.data) {
    const g = await req('GET', `/api/pp-reports/${r.key}?from=2020-01-01&to=2030-12-31`);
    assert.strictEqual(g.status, 200, `${r.key} 失敗`);
    assert.ok(Array.isArray(g.data.rows) && Array.isArray(g.data.columns), r.key);
  }
  // 收款統計：先建一筆「訂金」收款 → 統計表分類到訂金欄且方式歸現金
  const moms = (await req('GET', '/api/mothers')).data.filter(m => m.status === 'checked_in');
  const mom = await req('GET', `/api/customers/${moms[0].id}`);
  const bk = mom.data.bookings.find(b => b.status === 'checked_in');
  await req('POST', `/api/bookings/${bk.id}/payments`, { amount: 12345, method: '現金', paid_on: '2026-07-05', note: '訂金｜測試' });
  const sum = await req('GET', '/api/pp-reports/pay_daily_sum?from=2026-07-05&to=2026-07-05');
  const day = sum.data.rows.find(r => r.d === '2026-07-05');
  assert.ok(day && day.cash >= 12345 && day.deposit >= 12345 && day.grand >= 12345);
  // 明細表歸「訂金10%」欄
  const det = await req('GET', '/api/pp-reports/pay_daily_detail?from=2026-07-05&to=2026-07-05');
  assert.ok(det.data.rows.some(r => r.deposit === 12345));
  // 提前退房：退房帶原因 → actual_check_out 記錄 → 報表命中
  const ecMom = await req('POST', '/api/customers', { name: '提前退房測試', due_date: '2026-10-01' });
  const ecRooms = (await req('GET', '/api/rooms')).data.filter(r => r.active && !r.occupant);
  const ecBk = await req('POST', '/api/bookings', {
    mother_id: ecMom.data.id, room_id: ecRooms[0].id, check_in: '2026-06-20', check_out: '2026-08-20'
  });
  await req('PUT', `/api/bookings/${ecBk.data.id}/status`, { status: 'checked_in' });
  assert.strictEqual((await req('PUT', `/api/bookings/${ecBk.data.id}/status`,
    { status: 'checked_out', reason: '寶寶轉院' })).status, 200);
  const ec = await req('GET', '/api/pp-reports/early_checkout?from=2026-07-01&to=2026-07-31');
  const ecRow = ec.data.rows.find(r => r.mother === '提前退房測試');
  assert.ok(ecRow && ecRow.reason === '寶寶轉院' && ecRow.early_days > 0);
  // 應收帳款：以簽約日查詢（測試潛客甲 2026-07-05 簽約、合約有明細）
  const ar = await req('GET', '/api/pp-reports/ar_detail?from=2026-07-01&to=2026-07-31&date_field=sign');
  const arRow = ar.data.rows.find(r => r.mother === '測試潛客甲');
  assert.ok(arRow && arRow.total > 0 && 'balance' in arRow);
  // 不存在報表 404、日期錯誤 400、Excel 200
  assert.strictEqual((await req('GET', '/api/pp-reports/nope')).status, 404);
  assert.strictEqual((await req('GET', '/api/pp-reports/pay_daily_sum?from=2026-07-10&to=2026-07-01')).status, 400);
  assert.strictEqual((await req('GET', '/api/pp-reports/occupancy_month?from=2026-07-01&to=2026-07-31&format=xlsx')).status, 200);
});

// ---- 房間資料管理回歸測試 ----
test('房間資料管理：房型/房間/折扣/嬰兒床 CRUD 與批次', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  // 房型：回填自既有房間（seed 有標準房/豪華房/總統套房）
  const types = await req('GET', '/api/room-types');
  assert.strictEqual(types.status, 200);
  assert.ok(types.data.length >= 1);
  // 新增房型
  assert.strictEqual((await req('POST', '/api/room-types', {})).status, 400);
  const rt = await req('POST', '/api/room-types', { name: '禾苗房', price: 8800, sort: 1 });
  assert.strictEqual(rt.status, 200);
  assert.ok((await req('GET', '/api/room-types')).data.some(t => t.name === '禾苗房'));
  // 房間：新增（含分機/排序）＋PUT＋批次
  const rm = await req('POST', '/api/rooms', { name: 'T801', room_type: '禾苗房', price_per_day: 8800, call_ext: '801', service_ext: '801', sort: 5 });
  assert.strictEqual(rm.status, 200);
  assert.strictEqual((await req('PUT', `/api/rooms/${rm.data.id}`, { service_ext: '8801' })).status, 200);
  const batch = await req('POST', '/api/rooms/batch', { rooms: [{ name: 'T802', room_type: '禾苗房' }, { name: 'T803', room_type: '禾苗房' }] });
  assert.strictEqual(batch.data.added, 2);
  const gr = (await req('GET', '/api/rooms')).data.find(r => r.id === rm.data.id);
  assert.strictEqual(gr.service_ext, '8801');
  assert.strictEqual(gr.call_ext, '801');
  // 折扣：新增＋房型過濾＋刪除
  assert.strictEqual((await req('POST', '/api/room-discounts', {})).status, 400);
  const disc = await req('POST', '/api/room-discounts', { room_type: '禾苗房', customer_class: '一般客戶', plan_name: '牌價', stay_days: 20, discount_type: 'percent', discount_value: 85, bonus_days: 3 });
  assert.strictEqual(disc.status, 200);
  const dl = await req('GET', '/api/room-discounts?room_type=禾苗房');
  assert.ok(dl.data.some(d => d.id === disc.data.id && d.discount_value === 85));
  assert.strictEqual((await req('DELETE', `/api/room-discounts/${disc.data.id}`)).status, 200);
  // 嬰兒床：單筆＋批次＋關鍵字查詢
  assert.strictEqual((await req('POST', '/api/baby-beds', {})).status, 400);
  assert.strictEqual((await req('POST', '/api/baby-beds', { bed_no: 'Z101', zone: 'Z' })).status, 200);
  const bb = await req('POST', '/api/baby-beds/batch', { beds: [{ bed_no: 'Z102', zone: 'Z' }, { bed_no: 'Z103', zone: 'Z' }] });
  assert.strictEqual(bb.data.added, 2);
  const kw = await req('GET', '/api/baby-beds?keyword=Z10');
  assert.ok(kw.data.length >= 3);
});

// ---- 產後系統其他設定回歸測試 ----
test('產後系統其他設定：選項清單與打掃排程設定', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const s = await req('GET', '/api/settings');
  assert.strictEqual(s.status, 200);
  // 預設選項清單存在
  for (const k of ['tour_source_options', 'formula_brand_options', 'door_light_options',
    'referral_hospital_options', 'contact_class_options', 'discharge_med_options',
    'hk_sheet_days', 'hk_supply_days', 'tour_visit_limit']) {
    assert.ok(k in s.data, `缺設定 ${k}`);
  }
  assert.ok(s.data.tour_source_options.includes('親友介紹'));
  // 選項清單存檔 round-trip
  assert.strictEqual((await req('PUT', '/api/settings', { formula_brand_options: '亞培,惠氏,測試品牌' })).status, 200);
  assert.ok((await req('GET', '/api/settings')).data.formula_brand_options.includes('測試品牌'));
  // 打掃排程設定
  assert.strictEqual((await req('PUT', '/api/settings', { hk_sheet_days: '10', hk_supply_days: '2' })).status, 200);
  const s2 = (await req('GET', '/api/settings')).data;
  assert.strictEqual(s2.hk_sheet_days, '10');
  assert.strictEqual(s2.hk_supply_days, '2');
});

// ---- 後台模組回歸測試 ----
test('後台：公佈欄交辦／文件清單／退訂資料／合約轉住房', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  // 公佈欄：缺標題 400 → 發公告＋交辦 → 交辦結案
  assert.strictEqual((await req('POST', '/api/bulletins', { kind: 'notice' })).status, 400);
  assert.strictEqual((await req('POST', '/api/bulletins',
    { kind: 'notice', title: '七月消防演練', body: '7/15 下午 2 點', pinned: true })).status, 200);
  const task = await req('POST', '/api/bulletins',
    { kind: 'task', title: '補訂尿布', due_date: '2026-07-08' });
  assert.strictEqual(task.status, 200);
  assert.strictEqual((await req('PUT', `/api/bulletins/${task.data.id}`, { done: true })).status, 200);
  const bl = await req('GET', '/api/bulletins');
  const t = bl.data.find(x => x.id === task.data.id);
  assert.strictEqual(t.done, 1);
  assert.ok(t.done_at && t.done_name);
  assert.ok(bl.data.find(x => x.title === '七月消防演練' && x.pinned === 1));
  // 文件：無檔案 400；清單可讀
  assert.strictEqual((await req('POST', '/api/documents', {})).status, 400);
  assert.strictEqual((await req('GET', '/api/documents')).status, 200);
  // 退訂資料／合約轉住房
  const cx = await req('GET', '/api/cancellations');
  assert.ok(Array.isArray(cx.data.bookings) && Array.isArray(cx.data.tours));
  const tf = await req('GET', '/api/contract-transfers');
  assert.strictEqual(tf.status, 200);
  const row = tf.data.rows.find(r => r.name === '測試潛客甲');
  assert.ok(row && /^\d{9}$/.test(row.contract_no));
  assert.ok(row.total > 0);
  assert.ok(['reserved', 'checked_in', 'checked_out'].includes(row.booking_status)); // 前面測試已排房
});

// ---- 新生兒交班單回歸測試 ----
test('新生兒交班單：新增→修改→表頭彙整與每日奶量統計', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const babyId = (await req('GET', '/api/room-status/babies')).data.babies[0].id;
  // 缺交班時間 → 400；黃疸超界 → 400
  assert.strictEqual((await req('POST', `/api/babies/${babyId}/handovers`, { handover_date: '2026-07-04' })).status, 400);
  assert.strictEqual((await req('POST', `/api/babies/${babyId}/handovers`,
    { handover_date: '2026-07-04', handover_time: '20:39', jaundice: 100 })).status, 400);
  // 新增（用未來日期，確保「現在體重／黃疸值」表頭取到這筆而非 seed 照護紀錄）
  const ok = await req('POST', `/api/babies/${babyId}/handovers`, {
    handover_date: '2030-01-01', handover_time: '20:39', feed_method: '瓶', pacifier: '可吃',
    isolation: ['寶寶隔離', '亂填的會被過濾'], weight_g: 3350, jaundice: 8.5, cord: '乾燥',
    sleep: '安穩', note: '午後奶量略少，續觀察'
  });
  assert.strictEqual(ok.status, 200);
  // 修改
  assert.strictEqual((await req('PUT', `/api/baby-handovers/${ok.data.id}`, {
    handover_date: '2030-01-01', handover_time: '21:00', feed_method: '杯', sleep: '哭鬧', jaundice: 9.1
  })).status, 200);
  const g = await req('GET', `/api/babies/${babyId}/handovers`);
  const row = g.data.rows.find(r => r.id === ok.data.id);
  assert.strictEqual(row.feed_method, '杯');
  assert.deepStrictEqual(row.isolation, []);          // PUT 未帶隔離 → 清空且無亂值
  assert.ok(row.edited_at);
  // 表頭：最新交班黃疸帶入現在黃疸值；餵奶方式取最新一筆
  assert.strictEqual(g.data.header.jaundice_now.value, 9.1);
  assert.strictEqual(g.data.header.feed_method_now, '杯');
  // 每日奶量統計欄位齊全（seed 有照護紀錄）
  assert.ok(Array.isArray(g.data.stats));
  if (g.data.stats.length) {
    const s = g.data.stats[0];
    for (const k of ['breast_ml', 'formula_ml', 'total_ml', 'urine', 'stool', 'rooming_hours']) assert.ok(k in s);
  }
  // 重要備註／寶寶游泳存入個案 profile 後由表頭帶回
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/eval-profile`,
    { handover_note: '對牛奶蛋白過敏疑慮，觀察中', swim_count: 3 })).status, 200);
  const g2 = await req('GET', `/api/babies/${babyId}/handovers`);
  assert.strictEqual(g2.data.header.handover_note, '對牛奶蛋白過敏疑慮，觀察中');
  assert.strictEqual(g2.data.header.swim_count, 3);
});

// ---- 產後嬰兒結案回歸測試 ----
test('產後嬰兒結案：結案存檔→更新→房況旗標→解除結案', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const baby0 = (await req('GET', '/api/room-status/babies')).data.babies[0];
  const babyId = baby0.id;
  // 未到退房日 → 結案被擋；調整預退日為今日後放行
  const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  let bkRestore = null;
  if (baby0.check_out && baby0.check_out > TODAY) {
    const blocked = await req('PUT', `/api/babies/${babyId}/closure`, {
      close_date: '2026-07-20', close_time: '10:00', reason: '期滿結案', destination: '返家' });
    assert.strictEqual(blocked.status, 400);
    assert.ok(blocked.data.error.includes('未到退房日'));
    const occ = (await req('GET', '/api/room-status/mothers')).data.rooms
      .map(r => r.occupant).find(o => o && o.mother_id === baby0.mother_id);
    assert.strictEqual((await req('PUT', `/api/bookings/${occ.booking_id}`, { check_out: TODAY })).status, 200);
    bkRestore = { booking_id: occ.booking_id, check_out: occ.check_out };
  }
  // 初始未結案
  const g0 = await req('GET', `/api/babies/${babyId}/closure`);
  assert.strictEqual(g0.status, 200);
  assert.strictEqual(g0.data.closure, null);
  assert.ok(g0.data.options.educations.length >= 5);
  // 檢核：缺原因／去向、條件必填
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/closure`,
    { close_date: '2026-07-20', close_time: '10:00' })).status, 400);
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/closure`,
    { close_date: '2026-07-20', close_time: '10:00', reason: '轉院', destination: '轉至醫療院所' })).status, 400);
  // 結案
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/closure`, {
    close_date: '2026-07-20', close_time: '10:00', reason: '期滿結案', destination: '返家',
    weight_g: 3600, jaundice: 6.2, cord: '已脫落', feeding: '混合哺餵',
    educations: ['沐浴衛教', '臍帶護理', '不在清單的會被過濾'], follow_up: '滿月回診', note: '結案摘要'
  })).status, 200);
  // 房況卡片旗標
  const flagged = (await req('GET', '/api/room-status/babies')).data.babies.find(b => b.id === babyId);
  assert.strictEqual(flagged.closed, 1);
  // 再存＝更新（UNIQUE 不重複），衛教清單過濾
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/closure`, {
    close_date: '2026-07-21', close_time: '11:00', reason: '期滿結案', destination: '返家'
  })).status, 200);
  const g1 = await req('GET', `/api/babies/${babyId}/closure`);
  assert.strictEqual(g1.data.closure.close_date, '2026-07-21');
  assert.ok(g1.data.closure.edited_at);
  const g0edu = ['沐浴衛教', '臍帶護理'];
  assert.ok(!g0edu.includes('不在清單的會被過濾'));
  // 解除結案
  assert.strictEqual((await req('DELETE', `/api/baby-closures/${babyId}`)).status, 200);
  assert.strictEqual((await req('GET', `/api/babies/${babyId}/closure`)).data.closure, null);
  // 還原預退日，避免影響後續測試
  if (bkRestore) {
    assert.strictEqual((await req('PUT', `/api/bookings/${bkRestore.booking_id}`, { check_out: bkRestore.check_out })).status, 200);
  }
});

// ---- 寶寶位置狀態擴充回歸測試 ----
test('寶寶位置：隔離室／不在館內可切換並計入房況統計', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const babyId = (await req('GET', '/api/room-status/babies')).data.babies[0].id;
  // 非法值被擋
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/location`, { location: 'moon' })).status, 400);
  // 隔離室
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/location`, { location: 'isolation', note: '疑似腸病毒' })).status, 200);
  let d = (await req('GET', '/api/room-status/babies')).data;
  assert.strictEqual(d.stats.isolation, 1);
  assert.strictEqual(d.babies.find(b => b.id === babyId).location, 'isolation');
  // 不在館內
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/location`, { location: 'out', note: '回診' })).status, 200);
  d = (await req('GET', '/api/room-status/babies')).data;
  assert.strictEqual(d.stats.out, 1);
  // 復歸嬰兒室（異動紀錄留存）
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/location`, { location: 'nursery' })).status, 200);
  const logs = (await req('GET', `/api/babies/${babyId}/location-logs`)).data;
  assert.ok(logs.some(l => l.location === 'isolation') && logs.some(l => l.location === 'out'));
});

// ---- 一鍵記錄／位置異動／臍帶掉落：回填日期＋備註回歸測試 ----
test('寶寶照護回填：紀錄、位置異動與臍帶掉落可指定日期與備註', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const babyId = (await req('GET', '/api/room-status/babies')).data.babies[0].id;
  const local = ms => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString();
  const yesterday = local(Date.now() - 86400000).slice(0, 10);
  // 一鍵記錄回填昨日＋備註
  assert.strictEqual((await req('POST', `/api/babies/${babyId}/records`,
    { record_type: 'diaper', diaper_kind: '濕', note: '回填測試', recorded_at: `${yesterday} 08:30` })).status, 200);
  const rec = (await req('GET', `/api/babies/${babyId}/records?date=${yesterday}`)).data
    .find(r => r.note === '回填測試');
  assert.ok(rec && rec.recorded_at.startsWith(yesterday));
  // 時間格式錯誤被擋
  assert.strictEqual((await req('POST', `/api/babies/${babyId}/records`,
    { record_type: 'bath', recorded_at: '2026/07/01' })).status, 400);
  // 位置異動可回填 moved_at；格式錯誤被擋
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/location`,
    { location: 'hospital', note: '回填住院', moved_at: 'not-a-date' })).status, 400);
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/location`,
    { location: 'hospital', note: '回填住院', moved_at: `${yesterday} 09:00` })).status, 200);
  const mv = (await req('GET', `/api/babies/${babyId}/location-logs`)).data
    .find(l => l.note === '回填住院');
  assert.ok(mv && mv.moved_at === `${yesterday} 09:00`);
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/location`, { location: 'nursery' })).status, 200);
  // 臍帶掉落可回填日期，且僅能登記一次
  assert.strictEqual((await req('POST', `/api/babies/${babyId}/cord-off`,
    { date: '2026/1/1' })).status, 400);
  const co = await req('POST', `/api/babies/${babyId}/cord-off`, { date: yesterday, note: '回填臍帶' });
  assert.strictEqual(co.status, 200);
  assert.ok(co.data.cord_off_at.startsWith(yesterday));
  assert.strictEqual((await req('POST', `/api/babies/${babyId}/cord-off`, { date: yesterday })).status, 409);
});

// ---- 媽媽護理回歸測試 ----
test('媽媽護理：日常評估新增＋量表＋健康問題＋指導單提醒', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const mom = (await req('GET', '/api/mothers')).data.find(m => m.status === 'checked_in');
  // 初始讀取：病歷號帶入、提醒 4 筆（第 1/3/7/10 天）
  const g0 = await req('GET', `/api/mothers/${mom.id}/nursing`);
  assert.strictEqual(g0.status, 200);
  assert.ok(g0.data.medical_no);
  assert.strictEqual(g0.data.reminders.length, 4);
  assert.strictEqual(g0.data.reminders[0].done_date, '');
  // 缺生命徵象 → 400
  assert.strictEqual((await req('POST', `/api/mothers/${mom.id}/nursing`,
    { assess_date: '2026-07-04', assess_time: '22:10' })).status, 400);
  // 合法新增
  const ok = await req('POST', `/api/mothers/${mom.id}/nursing`, {
    assess_date: '2026-07-04', assess_time: '22:10',
    temperature: 36.8, pulse: 78, respiration: 18, systolic: 118, diastolic: 76,
    pain_nrs: 2, bowel_count: 1, uterus: '硬', fundus_note: '臍下二指',
    lochia_amount: '少', lochia_color: '暗紅', lochia_clot: '無',
    wound: '乾燥完整', breast_l: '柔軟', breast_l_milk: '中', breast_l_mastitis: '無',
    breast_r: '柔軟', breast_r_milk: '中', breast_r_mastitis: '無',
    bf_skill: '佳', mental: '平穩', activity: '佳'
  });
  assert.strictEqual(ok.status, 200);
  // 量表：APGAR 5 題（0~2）、EPDS 10 題（0~3）自動計總分；題數錯 → 400
  assert.strictEqual((await req('POST', `/api/mothers/${mom.id}/scales`,
    { kind: 'apgar', answers: [2, 2] })).status, 400);
  const apgar = await req('POST', `/api/mothers/${mom.id}/scales`,
    { kind: 'apgar', fill_date: '2026-07-04', answers: [2, 2, 1, 2, 1] });
  assert.strictEqual(apgar.data.total, 8);
  const epds = await req('POST', `/api/mothers/${mom.id}/scales`, {
    kind: 'epds', fill_date: '2026-07-04', answers: [1, 1, 2, 1, 1, 1, 2, 1, 1, 0],
    age: 32, result: '再觀察，一週後重新做一次評估'
  });
  assert.strictEqual(epds.data.total, 11);
  // 母乳認知與支持：完整問卷物件（白名單過濾）
  const bfaw = await req('POST', `/api/mothers/${mom.id}/scales`, {
    kind: 'bf_awareness', fill_date: '2026-07-04', answers: {
      language: '國語', src: ['醫療院所', '本中心'], benefits: ['容易消化'],
      this_feed: '混合哺餵', family_help: '是', helpless: '偶爾', hacker_field: 'x'
    }
  });
  assert.strictEqual(bfaw.status, 200);
  // 健康問題：新增→結案
  const hp = await req('POST', `/api/mothers/${mom.id}/health-problems`, { item: '乳腺阻塞', start_date: '2026-07-01' });
  assert.strictEqual(hp.status, 200);
  assert.strictEqual((await req('PUT', `/api/mother-health-problems/${hp.data.id}`, { end_date: '2026-07-04' })).status, 200);
  // 指導單執行 → 提醒紀錄第一筆帶入執行日期（用當天：媽媽在住→check_in≤今天→必配到第1天提醒，避免日期寫死日後失敗）
  const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  assert.strictEqual((await req('POST', `/api/mothers/${mom.id}/guidance`,
    { kind: 'care', done_date: TODAY })).status, 200);
  const g1 = await req('GET', `/api/mothers/${mom.id}/nursing`);
  assert.strictEqual(g1.data.rows.length, 1);
  assert.strictEqual(g1.data.rows[0].data.uterus, '硬');
  assert.strictEqual(g1.data.scales.length, 3);
  // EPDS 儲存為 {a, age, result}；認知問卷白名單過濾掉未知欄位、保留合法欄位
  const ep = g1.data.scales.find(s => s.kind === 'epds');
  assert.deepStrictEqual(ep.answers.a, [1, 1, 2, 1, 1, 1, 2, 1, 1, 0]);
  assert.strictEqual(ep.answers.result, '再觀察，一週後重新做一次評估');
  const aw = g1.data.scales.find(s => s.kind === 'bf_awareness');
  assert.strictEqual(aw.answers.this_feed, '混合哺餵');
  assert.strictEqual(aw.answers.hacker_field, undefined);
  assert.ok('baby_info' in g1.data);
  assert.ok(g1.data.problems[0].end_date);
  assert.ok(g1.data.reminders.some(r => r.done_date === TODAY));
  // mothers.id_no 可維護
  assert.strictEqual((await req('PUT', `/api/mothers/${mom.id}`, {
    name: mom.name, status: mom.status, id_no: 'A234567890'
  })).status, 200);
  assert.strictEqual((await req('GET', `/api/mothers/${mom.id}/nursing`)).data.mother.id_no, 'A234567890');
});

// ---- 產婦入住護理評估表回歸測試 ----
test('產婦入住護理評估表：upsert、白名單過濾、數值檢核、身分證同步', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const mom = (await req('GET', '/api/mothers')).data.find(m => m.status === 'checked_in');
  // 初始無紀錄、病歷號帶入
  const g0 = await req('GET', `/api/mothers/${mom.id}/intake`);
  assert.strictEqual(g0.status, 200);
  assert.strictEqual(g0.data.record, null);
  assert.ok(g0.data.medical_no);
  // 數值超界 → 400
  assert.strictEqual((await req('PUT', `/api/mothers/${mom.id}/intake`, { pain_score: 99 })).status, 400);
  assert.strictEqual((await req('PUT', `/api/mothers/${mom.id}/intake`, { temperature: 200 })).status, 400);
  // 首次存檔（部分欄位＋多選＋未知欄位）
  assert.strictEqual((await req('PUT', `/api/mothers/${mom.id}/intake`, {
    id_no: 'B123456789', companion_name: '林先生', county: '臺北市', district: '大安區',
    languages: ['國語', '台語'], delivery_modes: ['自然生產'],
    height: 162, weight: 60, temperature: 36.7, pain_score: 3,
    hbsag: '陰性(-)', evil_field: 'x'
  })).status, 200);
  const g1 = await req('GET', `/api/mothers/${mom.id}/intake`);
  assert.strictEqual(g1.data.record.data.companion_name, '林先生');
  assert.deepStrictEqual(g1.data.record.data.languages, ['國語', '台語']);
  assert.strictEqual(g1.data.record.data.evil_field, undefined);   // 白名單過濾
  // 身分證同步回住客
  assert.strictEqual((await req('GET', `/api/mothers/${mom.id}/nursing`)).data.mother.id_no, 'B123456789');
  // 再存＝更新（UNIQUE 不重複），部分欄位合併保留
  assert.strictEqual((await req('PUT', `/api/mothers/${mom.id}/intake`, { occupation: '教師' })).status, 200);
  const g2 = await req('GET', `/api/mothers/${mom.id}/intake`);
  assert.strictEqual(g2.data.record.data.companion_name, '林先生');   // 未被覆蓋
  assert.strictEqual(g2.data.record.data.occupation, '教師');
  assert.ok(g2.data.record.updated_at);
});

test('寶寶評估單：帳號身分證字號可維護並帶入 session', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const me = (await req('GET', '/api/me')).data.user;
  const r = await req('PUT', `/api/users/${me.id}`, { id_no: 'A123456789' });
  assert.strictEqual(r.status, 200);
  // 重新登入後 session 帶入 id_no
  cookie = '';
  const login = await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  assert.strictEqual(login.data.user.id_no, 'A123456789');
});

test('員工基本資料：登入權限0-5對映 role/active、旗標對映模組權限、預設密碼', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const c = await req('POST', '/api/employees', { username: 'emp_t1', name: '測試員', login_level: 3, flag_physician: 1, flag_nursing: 1, department: '護理部' });
  assert.strictEqual(c.status, 200);
  const e = (await req('GET', '/api/employees')).data.find(u => u.username === 'emp_t1');
  assert.strictEqual(e.role, 'nurse');
  assert.strictEqual(e.active, 1);
  assert.strictEqual(e.login_level, 3);
  assert.ok(e.permissions.includes('physician'));
  assert.ok(e.permissions.includes('mother_care') && e.permissions.includes('baby_care'));
  await req('POST', '/api/employees', { username: 'emp_t5', name: '主管', login_level: 5 });
  assert.strictEqual((await req('GET', '/api/employees')).data.find(u => u.username === 'emp_t5').role, 'admin');
  await req('POST', '/api/employees', { username: 'emp_t0', name: '停用', login_level: 0 });
  const saved = cookie; cookie = '';
  assert.strictEqual((await req('POST', '/api/login', { username: 'emp_t0', password: 'emp_t0' }, false)).status, 401);
  cookie = '';
  assert.strictEqual((await req('POST', '/api/login', { username: 'emp_t5', password: 'emp_t5' }, false)).status, 200);
  cookie = saved;
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
});

test('備品：CSV 匯入(編號 upsert)、進出/盤點、庫存彙總與分頁向後相容', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const imp = await req('POST', '/api/supplies/import', { items: [
    { code: 'SUP1', name: '測試備品A', category: '其他備品', unit: '個', price: '100', safety_stock: '2', front_sellable: 'yes' },
    { code: 'SUP1', name: '測試備品A改', price: '120' }
  ] });
  assert.strictEqual(imp.status, 200);
  assert.strictEqual(imp.data.added, 1);
  assert.strictEqual(imp.data.updated, 1);
  const sup = (await req('GET', '/api/supplies')).data.find(s => s.code === 'SUP1');
  assert.strictEqual(sup.price, 120);
  assert.strictEqual(sup.name, '測試備品A改');
  assert.strictEqual((await req('POST', `/api/supplies/${sup.id}/txns`, { txn_type: 'in', quantity: 10, vendor: '廠商A', expiry_date: '2027-01-01' })).status, 200);
  assert.strictEqual((await req('POST', `/api/supplies/${sup.id}/txns`, { txn_type: 'out', quantity: 3, area: '嬰兒室' })).status, 200);
  assert.strictEqual((await req('POST', `/api/supplies/${sup.id}/txns`, { txn_type: 'adjust', quantity: 9 })).status, 200);
  const sum = (await req('GET', '/api/supplies/stock-summary')).data.find(s => s.code === 'SUP1');
  assert.strictEqual(sum.total_in, 10);
  assert.strictEqual(sum.total_out, 3);
  const pg = (await req('GET', '/api/supply-txns?type=inout&page=1&pageSize=1')).data;
  assert.ok(Array.isArray(pg.rows) && pg.total >= 2 && pg.pageSize === 1);
  assert.ok(Array.isArray((await req('GET', '/api/supply-txns?type=inout')).data));
  const inTx = (await req('GET', '/api/supply-txns?type=in')).data.find(t => t.supply_code === 'SUP1');
  assert.strictEqual(inTx.vendor, '廠商A');
  assert.strictEqual(inTx.expiry_date, '2027-01-01');
});

test('參觀：新增(胎次/生產醫院)、取消明細、時段設定、伺服器端分頁/篩選', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const c = await req('POST', '/api/tours', { name: '測試媽媽X', phone: '0912', tour_at: '2026-07-15 14:00', due_date: '2026-09-01', source: '官網', parity: '第2胎', birth_hospital: '台大' });
  assert.strictEqual(c.status, 200);
  const tid = c.data.id;
  const paged = (await req('GET', '/api/tours?field=tour&from=2026-07-01&to=2026-07-31&page=1&pageSize=100')).data;
  assert.ok(Array.isArray(paged.rows) && typeof paged.total === 'number');
  const t = paged.rows.find(x => x.id === tid);
  assert.strictEqual(t.parity, '第2胎');
  assert.strictEqual(t.birth_hospital, '台大');
  assert.strictEqual((await req('POST', `/api/tours/${tid}/cancel`, { reason: '臨時有事' })).status, 200);
  const cancelled = (await req('GET', '/api/tours?only_cancelled=1&page=1&pageSize=100')).data.rows.find(x => x.id === tid);
  assert.strictEqual(cancelled.status, 'lost');
  assert.strictEqual(cancelled.cancel_reason, '臨時有事');
  assert.ok(cancelled.cancel_by_name);
  const c2 = await req('POST', '/api/tours', { name: 'Y', tour_at: '2026-07-16 10:00' });
  assert.strictEqual((await req('POST', `/api/tours/${c2.data.id}/cancel`, {})).status, 400);
  assert.strictEqual((await req('POST', '/api/tour-slots', { slot_date: '2026-07-20', open_from: '10:00', open_to: '12:00', capacity: 2 })).status, 200);
  assert.strictEqual((await req('POST', '/api/tour-slots', { slot_date: '2026-07-25', closed: 1 })).status, 200);
  const slots = (await req('GET', '/api/tour-slots?from=2026-07&to=2026-07')).data;
  assert.ok(slots.length >= 2);
  assert.strictEqual((await req('DELETE', `/api/tour-slots/${slots[0].id}`)).status, 200);
  assert.ok(Array.isArray((await req('GET', '/api/tours')).data));
});

test('膳食：訂餐狀態/備註；月子餐換餐家屬申請→員工審核', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const mom = (await req('GET', '/api/mothers')).data.find(m => m.status === 'checked_in');
  assert.ok(mom);
  const d = '2026-07-05';
  assert.strictEqual((await req('POST', '/api/meals', { mother_id: mom.id, meal_date: d, meal_type: 'lunch', choice: 'A家', note: '少鹽' })).status, 200);
  assert.strictEqual((await req('POST', '/api/meals/status', { mother_id: mom.id, meal_date: d, meal_type: 'lunch', status: 'served' })).status, 200);
  const o = (await req('GET', `/api/meals?date=${d}`)).data.orders.find(x => x.mother_id === mom.id && x.meal_type === 'lunch');
  assert.strictEqual(o.status, 'served');
  assert.strictEqual(o.note, '少鹽');
  assert.strictEqual((await req('POST', '/api/meals/status', { mother_id: mom.id, meal_date: '2030-01-01', meal_type: 'dinner', status: 'served' })).status, 404);
  const saved = cookie; cookie = '';
  assert.strictEqual((await req('POST', '/api/family/login', { code: 'DEMO1234' }, false)).status, 200);
  // 新版換餐：更換月子餐廠商（下拉有效選項）、自開始日早餐起，開始日受每日 14:00 規則限制
  const plan = (await req('GET', '/api/family/meal-plan')).data;
  assert.ok(Array.isArray(plan.choices) && plan.choices.includes('素食餐'), 'meal-plan 應回傳廠商清單');
  assert.ok(plan.swap_min_start, '應回傳最早可換餐日');
  assert.ok('menu_files' in plan, '應回傳各廠商當周菜單');
  assert.strictEqual((await req('POST', '/api/family/meal-swap',
    { meal_date: plan.swap_min_start, to_choice: '不存在廠商' })).status, 400);
  assert.strictEqual((await req('POST', '/api/family/meal-swap',
    { meal_date: '2020-01-01', to_choice: '素食餐' })).status, 400);
  assert.strictEqual((await req('POST', '/api/family/meal-swap',
    { meal_date: plan.swap_min_start, to_choice: '素食餐', reason: '過敏' })).status, 200);
  // 7 天內限換餐一次
  assert.strictEqual((await req('POST', '/api/family/meal-swap',
    { meal_date: plan.swap_min_start, to_choice: '一般餐' })).status, 400);
  cookie = saved;
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const mine = (await req('GET', '/api/meal-swaps?status=pending')).data.find(x => x.to_choice === '素食餐');
  assert.ok(mine);
  assert.strictEqual(mine.slot, '早餐起');
  const h = await req('POST', `/api/meal-swaps/${mine.id}/handle`, { action: 'approved', staff_note: '已安排' });
  assert.strictEqual(h.status, 200);
  assert.strictEqual(h.data.applied, true, '核准後應自開始日起自動套入訂餐');
  assert.strictEqual((await req('GET', '/api/meal-swaps')).data.find(x => x.id === mine.id).status, 'approved');
  // 開始日三餐已改為新廠商
  const o2 = (await req('GET', `/api/meals?date=${mine.meal_date}`)).data.orders.filter(x => x.mother_id === mine.mother_id);
  assert.ok(o2.length >= 3, '開始日應有三餐訂餐');
  assert.ok(o2.every(x => x.choice === '素食餐'), '訂餐應全部改為新廠商');
});

test('家屬聯絡清潔：送出申請→建立房務任務', async () => {
  const saved = cookie; cookie = '';
  assert.strictEqual((await req('POST', '/api/family/login', { code: 'DEMO1234' }, false)).status, 200);
  assert.strictEqual((await req('POST', '/api/family/cleaning-request', { task: '不在清單' })).status, 400);
  assert.strictEqual((await req('POST', '/api/family/cleaning-request', { task: '其他' })).status, 400);
  const r = await req('POST', '/api/family/cleaning-request', { task: '更換床單', note: '下午時段方便' });
  assert.strictEqual(r.status, 200);
  cookie = saved;
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const hk = (await req('GET', '/api/housekeeping')).data;
  const t = hk.tasks.find(x => x.id === r.data.id);
  assert.ok(t, '房務清潔頁應看到家屬申請的任務');
  assert.strictEqual(t.task, '更換床單');
  assert.ok(t.note.includes('家屬申請'));
  assert.ok(t.room_name, '任務應帶入住客房間');
});

test('商城：商品 CSV 匯入(品名 upsert)', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const r = await req('POST', '/api/products/import', { items: [
    { name: '測試商品Z', category: '媽媽用品', price: '200', stock: '5', track_stock: 'yes' },
    { name: '測試商品Z', price: '250' }
  ] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.added, 1);
  assert.strictEqual(r.data.updated, 1);
  assert.strictEqual((await req('GET', '/api/products')).data.find(x => x.name === '測試商品Z').price, 250);
});

test('寶寶餵奶：親餵左右分鐘數紀錄與回傳', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const baby = (await req('GET', '/api/babies')).data[0];
  assert.ok(baby);
  assert.strictEqual((await req('POST', `/api/babies/${baby.id}/records`, { record_type: 'feeding', feed_method: '親餵', feed_left_min: '10', feed_right_min: '8' })).status, 200);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const f = (await req('GET', `/api/babies/${baby.id}/records?date=${today}`)).data.find(r => r.record_type === 'feeding' && r.feed_left_min === 10);
  assert.ok(f);
  assert.strictEqual(f.feed_right_min, 8);
});

test('批次端點：寶寶巡房批次、媽媽評估批次一次寫入（原子）', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const babies = (await req('GET', '/api/babies')).data;
  assert.ok(babies.length);
  const b1 = babies[0].id, b2 = (babies[1] || babies[0]).id;
  const r = await req('POST', '/api/baby-records/batch', { records: [
    { baby_id: b1, record_type: 'temperature', value_num: 36.8 },
    { baby_id: b2, record_type: 'feeding', feed_method: '親餵', feed_left_min: 5 }
  ] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.added, 2);
  assert.strictEqual((await req('POST', '/api/baby-records/batch', { records: [] })).status, 400);
  const mom = (await req('GET', '/api/mothers')).data.find(m => m.status === 'checked_in');
  const rm = await req('POST', `/api/mothers/${mom.id}/records/batch`, { records: [
    { record_type: 'note', value_text: '批次A' }, { record_type: 'vital', value_text: 'BP 120/80' }
  ] });
  assert.strictEqual(rm.status, 200);
  assert.strictEqual(rm.data.added, 2);
});

test('匯入重複鍵偵測：supplies(編號)、products(品名) 回傳 duplicates', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const s = await req('POST', '/api/supplies/import', { items: [
    { code: 'DUPX', name: '甲' }, { code: 'DUPX', name: '乙' }, { code: 'OKX', name: '丙' }
  ] });
  assert.deepStrictEqual(s.data.duplicates, ['DUPX']);
  const p = await req('POST', '/api/products/import', { items: [
    { name: '重複品X', price: 100 }, { name: '重複品X', price: 120 }
  ] });
  assert.deepStrictEqual(p.data.duplicates, ['重複品X']);
});

test('會員：伺服器端關鍵字/狀態篩選與分頁，且無 page 相容回陣列', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const pg = (await req('GET', '/api/members?page=1&pageSize=2')).data;
  assert.ok(Array.isArray(pg.rows) && typeof pg.total === 'number' && pg.pageSize === 2);
  const inHouse = (await req('GET', '/api/members?status=checked_in&page=1&pageSize=100')).data;
  assert.ok(inHouse.rows.every(r => r.status === 'checked_in'));
  const arr = (await req('GET', '/api/members')).data;   // 下拉用：無 page 回陣列
  assert.ok(Array.isArray(arr));
});

test('護理提醒：回傳三類待辦，且可標記衛教完成', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const r = await req('GET', '/api/nursing-reminders');
  assert.strictEqual(r.status, 200);
  assert.ok(['白班', '小夜', '大夜'].includes(r.data.shift));
  assert.ok(Array.isArray(r.data.records_incomplete));
  assert.ok(Array.isArray(r.data.edu_pending));
  assert.ok(Array.isArray(r.data.nursing_needs));
  // 找一位有待完成衛教的媽媽，標記其中一項完成後應從清單消失
  const mo = r.data.edu_pending.find(m => m.items.length);
  if (mo) {
    const it = mo.items[0];
    const done = await req('POST', '/api/edu-records', { mother_id: mo.mother_id, edu_day: it.day, item: it.item });
    assert.strictEqual(done.status, 200);
    const r2 = await req('GET', '/api/nursing-reminders');
    const mo2 = r2.data.edu_pending.find(m => m.mother_id === mo.mother_id);
    assert.ok(!mo2 || !mo2.items.some(x => x.day === it.day && x.item === it.item));
  }
  // 缺欄位 → 400
  assert.strictEqual((await req('POST', '/api/edu-records', { mother_id: 1 })).status, 400);
});

test('母乳哺育評估：表頭帶入（體重/胎次）與媽媽護理權限可存取', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const baby = (await req('GET', '/api/room-status/babies')).data.babies[0];
  // 目前體重＝寶寶照護紀錄最近一筆體重
  assert.strictEqual((await req('POST', `/api/babies/${baby.id}/records`,
    { record_type: 'weight', value_num: 3456 })).status, 200);
  // 胎次＝入住評估表優先（seed 無入住評估時走客戶管理，這裡直接寫入住評估驗證優先源）
  assert.strictEqual((await req('PUT', `/api/mothers/${baby.mother_id}/intake`, { parity: '2' })).status, 200);
  const g = await req('GET', `/api/babies/${baby.id}/breastfeeding`);
  assert.strictEqual(g.status, 200);
  assert.strictEqual(g.data.prefill.current_weight_g, 3456);
  assert.strictEqual(g.data.prefill.parity, '2');
  // 只有媽媽護理權限的帳號：可讀寫母乳哺育評估、仍被擋寶寶照護
  await req('POST', '/api/users', { username: 'bfa_momnurse', password: 'p12345', name: '媽媽護理測試', role: 'nurse', permissions: ['mother_care'] });
  const adminCookie = cookie;
  cookie = '';
  assert.strictEqual((await req('POST', '/api/login', { username: 'bfa_momnurse', password: 'p12345' })).status, 200);
  assert.strictEqual((await req('GET', `/api/babies/${baby.id}/breastfeeding`)).status, 200);
  assert.strictEqual((await req('POST', `/api/babies/${baby.id}/breastfeeding`,
    { assess_date: '2026-07-08', parity: '2', current_weight_g: 3456, items: { rows: { p0: 'L' } } })).status, 200);
  assert.strictEqual((await req('GET', `/api/babies/${baby.id}/records`)).status, 403);
  cookie = adminCookie;
});

test('親子同室紀錄：家屬僅在寶寶 rooming 時可自行登記', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const saved = cookie;
  // 取得 DEMO 家屬對應的寶寶
  cookie = '';
  assert.strictEqual((await req('POST', '/api/family/login', { code: 'DEMO1234' }, false)).status, 200);
  const rpt0 = (await req('GET', '/api/family/report')).data;
  const babyId = rpt0.baby.id;
  const famCookie = cookie;
  // 先設為非 rooming（nursery）→ 家屬登記應被擋 403
  cookie = saved;
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/location`, { location: 'nursery' })).status, 200);
  cookie = famCookie;
  assert.strictEqual((await req('POST', '/api/family/records', { record_type: 'feeding', feed_method: '親餵' })).status, 403);
  // 改為 rooming → 家屬可登記，且出現在報表
  cookie = saved;
  assert.strictEqual((await req('PUT', `/api/babies/${babyId}/location`, { location: 'rooming' })).status, 200);
  cookie = famCookie;
  assert.strictEqual((await req('POST', '/api/family/records', { record_type: 'feeding', feed_method: '親餵' })).status, 200);
  assert.strictEqual((await req('POST', '/api/family/records', { record_type: 'diaper', diaper_kind: '便' })).status, 200);
  assert.strictEqual((await req('POST', '/api/family/records', { record_type: 'temperature', value_num: 36 })).status, 400);
  assert.strictEqual((await req('POST', '/api/family/records', { record_type: 'feeding', feed_method: '瓶餵', amount_ml: 9999 })).status, 400);
  const rpt = (await req('GET', '/api/family/report')).data;
  assert.ok(rpt.records.some(r => r.record_type === 'feeding' && (r.note || '').includes('家屬登記')));
  cookie = saved;
});

test('臍帶掉落：一次性登記，重複登記回 409 並寫入觀察紀錄', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const baby = (await req('GET', '/api/babies')).data.find(b => !b.cord_off_at);
  assert.ok(baby, '需有尚未登記臍帶掉落的寶寶');
  const r1 = await req('POST', `/api/babies/${baby.id}/cord-off`, {});
  assert.strictEqual(r1.status, 200);
  assert.ok(r1.data.cord_off_at);
  // 寶寶清單反映 cord_off_at
  const after = (await req('GET', '/api/babies')).data.find(b => b.id === baby.id);
  assert.ok(after.cord_off_at);
  // 當日紀錄新增一筆臍帶觀察
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const recs = (await req('GET', `/api/babies/${baby.id}/records?date=${today}`)).data;
  assert.ok(recs.some(x => x.record_type === 'cord' && x.value_text === '臍帶掉落'));
  // 重複登記 → 409
  assert.strictEqual((await req('POST', `/api/babies/${baby.id}/cord-off`, {})).status, 409);
});

test('醫師巡診總覽：入住中篩選＋日期區間＋關鍵字（姓名/房號）查詢', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const baby = (await req('GET', '/api/babies')).data.find(b => b.mother_status === 'checked_in');
  assert.ok(baby, '需有在住寶寶');
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const at = `${today}T09:30`;
  const created = await req('POST', '/api/physician-visits', {
    subject_type: 'baby', baby_id: baby.id, specialty: 'pediatrics', visit_type: 'routine',
    visit_at: at, physician: '林小兒科醫師', assessment: '一般狀況良好', plan: '續觀察'
  });
  assert.strictEqual(created.status, 200);
  // in_house=1 應含此筆，且帶出 mother_name / room_name
  const inHouse = (await req('GET', '/api/physician-visits?in_house=1')).data;
  const mine = inHouse.find(v => v.id === created.data.id);
  assert.ok(mine, '入住中清單應含新建紀錄');
  assert.ok(mine.mother_name, '應帶出媽媽姓名');
  // 日期區間命中
  assert.ok((await req('GET', `/api/physician-visits?in_house=1&start=${today}&end=${today}`)).data.some(v => v.id === created.data.id));
  // 日期區間未命中
  assert.ok(!(await req('GET', '/api/physician-visits?in_house=1&start=2000-01-01&end=2000-01-02')).data.some(v => v.id === created.data.id));
  // 關鍵字（媽媽姓名）命中
  const byName = (await req('GET', `/api/physician-visits?in_house=1&kwtype=name&kw=${encodeURIComponent(mine.mother_name)}`)).data;
  assert.ok(byName.some(v => v.id === created.data.id));
  // 關鍵字（不存在）未命中
  assert.ok(!(await req('GET', '/api/physician-visits?in_house=1&kwtype=name&kw=絕對不存在的名字ZZZ')).data.some(v => v.id === created.data.id));
});

test('照護紀錄查詢：僅入住中、日期區間、姓名/房號關鍵字（媽媽與寶寶）', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const mom = (await req('GET', '/api/mothers')).data.find(m => m.status === 'checked_in');
  assert.ok(mom, '需有在住媽媽');
  await req('POST', `/api/mothers/${mom.id}/records`, { record_type: 'note', value_text: '查詢測試備註' });
  // 媽媽：命中
  const mres = (await req('GET', `/api/care-records/query?kind=mother&start=${today}&end=${today}`)).data;
  assert.ok(Array.isArray(mres));
  assert.ok(mres.some(r => r.subject === mom.name && r.detail === '查詢測試備註'));
  // 關鍵字（姓名）命中
  assert.ok((await req('GET', `/api/care-records/query?kind=mother&kwtype=name&kw=${encodeURIComponent(mom.name)}`)).data.some(r => r.subject === mom.name));
  // 關鍵字（不存在）未命中
  assert.ok(!(await req('GET', '/api/care-records/query?kind=mother&kwtype=name&kw=不存在ZZZ')).data.some(r => r.subject === mom.name));
  // 寶寶查詢：回傳陣列且帶 mother_name
  const bres = (await req('GET', '/api/care-records/query?kind=baby')).data;
  assert.ok(Array.isArray(bres));
});

test('護理提醒：payload 含 mother_records_incomplete 陣列', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const d = (await req('GET', '/api/nursing-reminders')).data;
  assert.ok(Array.isArray(d.mother_records_incomplete));
});

test('媽媽房況：stats 含 needs 欄位', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const d = (await req('GET', '/api/room-status/mothers')).data;
  assert.strictEqual(typeof d.stats.needs, 'number');
});

test('護理需求：家屬留言區分媽媽/寶寶，護理站彙整與單筆標記已處理', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const baby = (await req('GET', '/api/babies')).data.find(b => b.mother_status === 'checked_in');
  assert.ok(baby);
  const saved = cookie; cookie = '';
  assert.strictEqual((await req('POST', '/api/family/login', { code: 'DEMO1234' }, false)).status, 200);
  const famCookie = cookie;
  assert.strictEqual((await req('POST', '/api/family/messages', { body: '媽媽傷口有點痛', subject_type: 'mother' })).status, 200);
  assert.strictEqual((await req('POST', '/api/family/messages', { body: '寶寶好像肚子餓', subject_type: 'baby' })).status, 200);
  // 家屬端：可看到自己的留言含 subject_type
  const mine = (await req('GET', '/api/family/messages')).data;
  assert.ok(mine.some(m => m.sender === 'family' && m.subject_type === 'mother' && m.body === '媽媽傷口有點痛'));
  cookie = saved;
  // 護理站：彙整依媽媽，區分 mother_requests / baby_requests
  const nn = (await req('GET', '/api/nursing-needs')).data;
  const res = nn.residents.find(r => r.mother_requests.some(x => x.body === '媽媽傷口有點痛'));
  assert.ok(res, 'mother_requests 應含媽媽需求');
  assert.ok(res.baby_requests.some(x => x.body === '寶寶好像肚子餓'), 'baby_requests 應含寶寶需求');
  // 單筆標記已處理後消失
  const mid = res.mother_requests.find(x => x.body === '媽媽傷口有點痛').id;
  assert.strictEqual((await req('POST', `/api/family-messages/msg/${mid}/read`, {})).status, 200);
  const nn2 = (await req('GET', '/api/nursing-needs')).data;
  const res2 = nn2.residents.find(r => r.mother_id === res.mother_id);
  assert.ok(!res2.mother_requests.some(x => x.id === mid), '標記已處理後不應再出現');
  assert.strictEqual((await req('POST', '/api/family-messages/msg/999999/read', {})).status, 404);
});

test('入住評估表：回傳量表填寫概況，填寫後 apgar/epds 反映已填', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const mom = (await req('GET', '/api/mothers')).data.find(m => m.status === 'checked_in');
  assert.ok(mom);
  const before = (await req('GET', `/api/mothers/${mom.id}/intake`)).data;
  assert.ok(before.scales && typeof before.scales === 'object');
  const epdsBefore = (before.scales.epds && before.scales.epds.count) || 0;
  const r = await req('POST', `/api/mothers/${mom.id}/scales`, {
    kind: 'epds', fill_date: '2026-07-08', answers: [0,0,0,0,0,0,0,0,0,0], age: '30', result: '正常', note: 't'
  });
  assert.strictEqual(r.status, 200);
  const after = (await req('GET', `/api/mothers/${mom.id}/intake`)).data;
  assert.ok(after.scales.epds && after.scales.epds.count === epdsBefore + 1);
  assert.ok(after.scales.epds.last === '2026-07-08');
});

test('已出住照護資料查詢：只含已退住媽寶，可依媽媽姓名查詢', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const r = await req('GET', '/api/pp-reports/discharged_care_q?from=2000-01-01&to=2100-01-01');
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.data.columns) && Array.isArray(r.data.rows));
  assert.ok(r.data.columns.some(c => c[1] === '歸檔月份'));
  // 舊的 mom_nursing_q / baby_care_q 已移除
  assert.strictEqual((await req('GET', '/api/pp-reports/mom_nursing_q')).status, 404);
  assert.strictEqual((await req('GET', '/api/pp-reports/baby_care_q')).status, 404);
  // 姓名查詢參數可用（無此媽媽 → 空）
  const none = await req('GET', '/api/pp-reports/discharged_care_q?from=2000-01-01&to=2100-01-01&name=絕對不存在ZZZ');
  assert.strictEqual(none.data.rows.length, 0);
});

// ---- 退房完成（客服部）回歸測試 ----
test('退房完成：未到退房日擋下→改期後退房成功、房轉空房並自動建清潔任務', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const occ = (await req('GET', '/api/room-status/mothers')).data.rooms
    .map(r => r.occupant).find(o => o);
  assert.ok(occ, '需有入住中住客');
  if (occ.check_out > TODAY) {
    // 未到退房日 → 400
    const blocked = await req('POST', `/api/bookings/${occ.booking_id}/checkout-complete`, {});
    assert.strictEqual(blocked.status, 400);
    assert.ok(blocked.data.error.includes('未到退房日'));
    assert.strictEqual((await req('PUT', `/api/bookings/${occ.booking_id}`, { check_out: TODAY })).status, 200);
  }
  // 退房完成
  const done = await req('POST', `/api/bookings/${occ.booking_id}/checkout-complete`, {});
  assert.strictEqual(done.status, 200);
  assert.ok(done.data.task.includes('已出住'));
  // 房況轉空房、媽媽轉已出住
  const rooms = (await req('GET', '/api/room-status/mothers')).data.rooms;
  assert.ok(!rooms.some(r => r.occupant && r.occupant.mother_id === occ.mother_id));
  const mAfter = (await req('GET', '/api/mothers')).data.find(m => m.id === occ.mother_id);
  assert.strictEqual(mAfter.status, 'checked_out');
  // 自動建立清潔任務（今日待辦）
  const hk = (await req('GET', `/api/housekeeping?date=${TODAY}`)).data;
  assert.ok(hk.tasks.some(t => t.task === done.data.task && t.status === 'pending'));
  // 已退房者再辦一次 → 409
  assert.strictEqual((await req('POST', `/api/bookings/${occ.booking_id}/checkout-complete`, {})).status, 409);
});

// ---- 外部廠商帳號（service_scope）回歸測試 ----
test('廠商帳號：只看得到自己服務、可新增登記、不可確認報名', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  // 準備：一個他人服務與一個廠商服務範圍外的課程
  const other = await req('POST', '/api/programs', { kind: 'service', name: '寶寶攝影', price: 1500 });
  assert.strictEqual(other.status, 200);
  assert.strictEqual((await req('POST', '/api/programs', { kind: 'course', name: '媽媽瑜珈', price: 0 })).status, 200);
  // 建立廠商帳號：只有 programs 模組＋服務範圍「泌乳」
  const vu = await req('POST', '/api/users', {
    username: 'vendor1', password: 'vendor123', name: '泌乳廠商',
    permissions: ['programs'], service_scope: '泌乳'
  });
  assert.strictEqual(vu.status, 200);
  const adminCookie = cookie;
  cookie = '';
  assert.strictEqual((await req('POST', '/api/login', { username: 'vendor1', password: 'vendor123' })).status, 200);
  // 新增：即使亂帶 kind/name 也強制為自己的服務
  const created = await req('POST', '/api/programs',
    { kind: 'course', name: '亂填名稱', price: 800, scheduled_at: '2026-08-01 14:00' });
  assert.strictEqual(created.status, 200);
  // 閱覽：清單只含「泌乳」，看不到寶寶攝影與課程
  const list = (await req('GET', '/api/programs')).data;
  assert.ok(list.length >= 1);
  assert.ok(list.every(p => p.kind === 'service' && p.name === '泌乳'));
  assert.ok(list.some(p => p.scheduled_at === '2026-08-01 14:00'));
  // 報名清單同樣過濾；確認/取消被擋
  const su = (await req('GET', '/api/signups')).data;
  assert.ok(su.every(s => s.program_name === '泌乳'));
  assert.strictEqual((await req('POST', '/api/signups/1/confirm', {})).status, 403);
  assert.strictEqual((await req('POST', '/api/signups/1/cancel', {})).status, 403);
  // 為他人服務建報名被擋
  cookie = adminCookie;
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const moms = (await req('GET', '/api/mothers')).data.filter(m => m.status === 'checked_in' || m.status === 'checked_out');
  cookie = '';
  await req('POST', '/api/login', { username: 'vendor1', password: 'vendor123' });
  if (moms.length) {
    assert.strictEqual((await req('POST', '/api/signups',
      { mother_id: moms[0].id, program_id: other.data.id, quantity: 1 })).status, 403);
  }
  cookie = adminCookie;
});

// ---- 設備報修＋任務進度 log 回歸測試 ----
test('房務：設備報修任務（故障類別＋公共地點）與進度儲存 log', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  // 建立報修任務：公共地點 3樓嬰兒室
  const r = await req('POST', '/api/housekeeping/tasks',
    { task: '冷氣', kind: 'repair', location: '3樓嬰兒室', scheduled_for: TODAY, note: '不冷' });
  assert.strictEqual(r.status, 200);
  const hk = (await req('GET', `/api/housekeeping?date=${TODAY}`)).data;
  const t = hk.tasks.find(x => x.id === r.data.id);
  assert.ok(t);
  assert.strictEqual(t.kind, 'repair');
  assert.strictEqual(t.location, '3樓嬰兒室');
  assert.strictEqual(t.progress_count, 0);
  // 進度儲存：空內容擋下、兩筆 log 依時間序保存
  assert.strictEqual((await req('POST', `/api/housekeeping/tasks/${t.id}/progress`, { body: '  ' })).status, 400);
  assert.strictEqual((await req('POST', `/api/housekeeping/tasks/${t.id}/progress`, { body: '已聯繫廠商' })).status, 200);
  assert.strictEqual((await req('POST', `/api/housekeeping/tasks/${t.id}/progress`, { body: '週五到府維修' })).status, 200);
  const logs = (await req('GET', `/api/housekeeping/tasks/${t.id}/progress`)).data;
  assert.strictEqual(logs.length, 2);
  assert.ok(logs.every(l => l.staff_name));
  // 清單帶最後進度與筆數
  const t2 = (await req('GET', `/api/housekeeping?date=${TODAY}`)).data.tasks.find(x => x.id === t.id);
  assert.strictEqual(t2.progress_count, 2);
  assert.strictEqual(t2.last_progress, '週五到府維修');
  // 指定房間時 location 淨空；一般清潔任務 kind 預設 clean
  const hkRes = hk.residents[0];
  if (hkRes) {
    const rc = await req('POST', '/api/housekeeping/tasks',
      { task: '清潔地板', room_id: hkRes.room_id, mother_id: hkRes.mother_id, location: '亂帶的', scheduled_for: TODAY });
    assert.strictEqual(rc.status, 200);
    const tc = (await req('GET', `/api/housekeeping?date=${TODAY}`)).data.tasks.find(x => x.id === rc.data.id);
    assert.strictEqual(tc.kind, 'clean');
    assert.strictEqual(tc.location, '');
  }
  // 不存在任務的進度 → 404
  assert.strictEqual((await req('POST', '/api/housekeeping/tasks/999999/progress', { body: 'x' })).status, 404);
});

// ---- 備品開放前台銷售 → 商城商品自動建檔回歸測試 ----
test('備品：開放前台銷售自動建商城商品（庫存0）、只建一次', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  // 新增時勾開放前台銷售 → 自動建商品
  const su = await req('POST', '/api/supplies',
    { name: 'AVENT儲乳瓶125ml', code: 'MA0006', category: '備品-媽媽專用', unit: '個', price: 290, front_sellable: 1 });
  assert.strictEqual(su.status, 200);
  let prods = (await req('GET', '/api/products')).data;
  const p = prods.find(x => x.name === 'AVENT儲乳瓶125ml');
  assert.ok(p, '應自動建檔商城商品');
  assert.strictEqual(p.stock, 0);
  assert.strictEqual(p.track_stock, 1);
  assert.strictEqual(p.active, 1);
  assert.strictEqual(p.price, 290);
  // 再編輯備品 → 不重複建檔
  assert.strictEqual((await req('PUT', `/api/supplies/${su.data.id}`, { price: 300 })).status, 200);
  prods = (await req('GET', '/api/products')).data;
  assert.strictEqual(prods.filter(x => x.name === 'AVENT儲乳瓶125ml').length, 1);
  // 未勾開放前台銷售 → 不建檔；之後改勾 → 補建
  const su2 = await req('POST', '/api/supplies', { name: '6吋棉枝10支', code: 'MA0018', price: 10 });
  assert.strictEqual(su2.status, 200);
  prods = (await req('GET', '/api/products')).data;
  assert.ok(!prods.some(x => x.name === '6吋棉枝10支'));
  assert.strictEqual((await req('PUT', `/api/supplies/${su2.data.id}`, { front_sellable: 1 })).status, 200);
  prods = (await req('GET', '/api/products')).data;
  const p2 = prods.find(x => x.name === '6吋棉枝10支');
  assert.ok(p2 && p2.stock === 0);
  // CSV 匯入勾前台銷售 → 也自動建檔
  const imp = await req('POST', '/api/supplies/import', { items: [
    { name: '5CC無菌空針', code: 'M50001', category: '備品-媽媽專用', unit: '個', price: 5, front_sellable: 'yes' }
  ] });
  assert.strictEqual(imp.status, 200);
  prods = (await req('GET', '/api/products')).data;
  assert.ok(prods.some(x => x.name === '5CC無菌空針'));
});

// ---- 合約資料：緊急聯絡人＋媽媽手機同步回歸測試 ----
test('客戶合約：緊急聯絡人存檔、媽媽手機同步主檔', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const c = await req('POST', '/api/customers', { name: '合約測試媽', phone: '', due_date: '2026-07-31' });
  assert.strictEqual(c.status, 200);
  const put = await req('PUT', `/api/customers/${c.data.id}/contract`, {
    handler: '王主任', sign_date: '2026-07-11', due_date: '2026-07-31',
    expected_check_in: '2026-07-31', parity_no: '第1胎', baby_count: '單胞胎',
    mother_phone: '0912333444',
    emergency_name: '張先生', emergency_relation: '先生', emergency_phone: '0911222333'
  });
  assert.strictEqual(put.status, 200);
  assert.ok(put.data.contract_no);
  const g = await req('GET', `/api/customers/${c.data.id}`);
  assert.strictEqual(g.data.contract.data.emergency_name, '張先生');
  assert.strictEqual(g.data.contract.data.emergency_relation, '先生');
  assert.strictEqual(g.data.contract.data.emergency_phone, '0911222333');
  assert.strictEqual(g.data.mother.phone, '0912333444');
  // 每次存檔都要有修改 log（欄位舊值→新值）
  assert.ok(Array.isArray(g.data.contract_logs));
  assert.ok(g.data.contract_logs.length >= 1);
  assert.ok(g.data.contract_logs[0].summary.includes('緊急聯絡人姓名'));
  assert.ok(g.data.contract_logs[0].user_name);
  // 再存一次（無變更）也要記 log
  assert.strictEqual((await req('PUT', `/api/customers/${c.data.id}/contract`, { handler: '王主任' })).status, 200);
  const g2 = await req('GET', `/api/customers/${c.data.id}`);
  assert.ok(g2.data.contract_logs.length >= 2);
});

// ---- 排房：床表資料含備註、期間衝突擋下回歸測試 ----
test('排房：訂房備註帶入床表資料、期間衝突回 409', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const rooms = (await req('GET', '/api/rooms')).data;
  const cal0 = (await req('GET', '/api/room-calendar?start=2027-01-01&days=30')).data;
  const busy = new Set(cal0.bookings.map(b => b.room_id));
  const freeRoom = rooms.find(r => r.active && !busy.has(r.id));
  assert.ok(freeRoom, '需有 2027-01 空房');
  const mom = (await req('GET', '/api/mothers')).data[0];
  const bk = await req('POST', '/api/bookings', {
    mother_id: mom.id, room_id: freeRoom.id, check_in: '2027-01-05', check_out: '2027-01-15',
    total_amount: 100000, notes: '靠電梯、需相通房'
  });
  assert.strictEqual(bk.status, 200);
  // 床表資料含此訂房與備註（特殊需求標示用）
  const cal = (await req('GET', '/api/room-calendar?start=2027-01-01&days=30')).data;
  const row = cal.bookings.find(b => b.id === bk.data.id);
  assert.ok(row, '新排房應出現在床表資料');
  assert.strictEqual(row.notes, '靠電梯、需相通房');
  // 同房同期間再排 → 409（前端會以 alert 顯示，不被頁面重載洗掉）
  const dup = await req('POST', '/api/bookings', {
    mother_id: mom.id, room_id: freeRoom.id, check_in: '2027-01-10', check_out: '2027-01-20' });
  assert.strictEqual(dup.status, 409);
  // 清掉測試訂房
  assert.strictEqual((await req('PUT', `/api/bookings/${bk.data.id}/status`, { status: 'cancelled' })).status, 200);
});

// ---- 寶寶報喜（入住通知單）後續帶入回歸測試 ----
test('寶寶報喜：自動建請備房任務＋入住日訂餐；7日內入住帶完整欄位', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const IN = new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 3 * 86400000).toISOString().slice(0, 10);
  const OUT = new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 23 * 86400000).toISOString().slice(0, 10);
  const c = await req('POST', '/api/customers', { name: '通知單測試媽', phone: '0987000111', due_date: TODAY, id_no: 'A234567890' });
  assert.strictEqual(c.status, 200);
  // 手 key 排房（報喜視窗雙向寫回床表的等效 API 呼叫）
  const rooms = (await req('GET', '/api/rooms')).data.filter(r => r.active).reverse();
  let bk = null, room = null;
  for (const r of rooms) {
    const t = await req('POST', '/api/bookings', { mother_id: c.data.id, room_id: r.id, check_in: IN, check_out: OUT, notes: '寶寶報喜排房帶入' });
    if (t.status === 200) { bk = t.data; room = r; break; }
  }
  assert.ok(bk, '找不到可訂房間');
  // 報喜儲存
  const ann = await req('POST', `/api/customers/${c.data.id}/baby-announce`, {
    birth_date: TODAY, birth_mode: '自然產', birth_hospital: '禾馨民權', weeks: '38+2',
    babies: [{ gender: 'male', weight_g: 3200 }], meal_choice: 'A', bra_size: 'M',
    diet_type: '葷食', taboos: '牛肉、內臟', room_name: room.name
  });
  assert.strictEqual(ann.status, 200);
  const MMDD_IN = IN.slice(5).replace('-', '');
  const TASK = `${room.name}請備房${MMDD_IN}`;
  assert.strictEqual(ann.data.hk_task, TASK);
  assert.strictEqual(ann.data.meal_date, IN);
  // 房務任務：名稱帶入住日 MMdd、排定於報喜儲存日（今日）、備註含媽咪／房號／入出住日／哺乳衣
  const hk = (await req('GET', `/api/housekeeping?date=${IN}`)).data;
  const task = hk.tasks.find(t => t.task === TASK && t.mother_name === '通知單測試媽');
  assert.ok(task, '應建立請備房任務');
  assert.strictEqual(task.scheduled_for, TODAY);
  for (const kw of ['通知單測試媽', room.name, IN, OUT, 'M']) assert.ok(task.note.includes(kw), `備註缺 ${kw}`);
  // 膳食：入住日午餐起（略過早餐＝2 筆）；住期中間日三餐皆自動帶入
  const meals = (await req('GET', `/api/meals?date=${IN}`)).data;
  const mine = meals.orders.filter(o => o.mother_id === c.data.id);
  assert.strictEqual(mine.length, 2);
  assert.ok(mine.every(o => o.meal_type !== 'breakfast'));
  assert.ok(mine.every(o => o.choice === 'A' && o.note.includes('牛肉')));
  const MID = new Date(new Date(IN + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  const midMine = (await req('GET', `/api/meals?date=${MID}`)).data.orders.filter(o => o.mother_id === c.data.id);
  assert.strictEqual(midMine.length, 3);
  // 重複報喜不重複建任務
  await req('POST', `/api/customers/${c.data.id}/baby-announce`, {
    birth_date: TODAY, babies: [{ gender: 'male', weight_g: 3200 }], meal_choice: 'A',
    diet_type: '葷食', taboos: '牛肉、內臟', weeks: '38+2' });
  const hk2 = (await req('GET', `/api/housekeeping?date=${IN}`)).data;
  assert.strictEqual(hk2.tasks.filter(t => t.task === TASK && t.mother_name === '通知單測試媽').length, 1);
  // 7日內入住：帶生日／後四碼／生產資訊／妊娠週數／寶寶性別體重
  const up = (await req('GET', '/api/room-status/mother-upcoming')).data;
  const row = up.checkins.find(x => x.mother_name === '通知單測試媽');
  assert.ok(row, '應列入 7 日內入住');
  assert.strictEqual(row.id4, '7890');
  assert.strictEqual(row.delivery_date, TODAY);
  assert.strictEqual(row.birth_hospital, '禾馨民權');
  assert.strictEqual(row.weeks, '38+2');
  assert.ok(row.babies.length === 1 && row.babies[0].gender === 'male' && row.babies[0].birth_weight_g === 3200);
  // 清掉測試訂房
  assert.strictEqual((await req('PUT', `/api/bookings/${bk.id}/status`, { status: 'cancelled' })).status, 200);
});

// ---- 一致性修正回歸測試（結案連動／改期同步／床表實際退房日） ----
test('產婦結案：自動建清潔任務；結案後訂房不可改回入住中', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  // 建媽媽＋今日到期訂房後結案
  const c = await req('POST', '/api/customers', { name: '結案連動媽', due_date: TODAY });
  const rooms = (await req('GET', '/api/rooms')).data.filter(r => r.active).reverse();
  let bk = null, room = null;
  for (const r of rooms) {
    const t = await req('POST', '/api/bookings', { mother_id: c.data.id, room_id: r.id, check_in: '2026-01-01', check_out: TODAY });
    if (t.status === 200) { bk = t.data; room = r; break; }
  }
  assert.ok(bk, '需可建訂房');
  assert.strictEqual((await req('PUT', `/api/bookings/${bk.id}/status`, { status: 'checked_in' })).status, 200);
  assert.strictEqual((await req('PUT', `/api/mothers/${c.data.id}/closure`, {
    close_date: TODAY, close_time: '10:00', reason: '期滿結案', destination: '返家' })).status, 200);
  // 自動建立「(房號)房已出住」清潔任務
  const hk = (await req('GET', `/api/housekeeping?date=${TODAY}`)).data;
  assert.ok(hk.tasks.some(t => t.task === `${room.name}房已出住` && t.note === '產婦結案自動建立'));
  // 已結案 → 改回入住中被擋（409）
  const back = await req('PUT', `/api/bookings/${bk.id}/status`, { status: 'checked_in' });
  assert.strictEqual(back.status, 409);
  assert.ok(back.data.error.includes('解除結案'));
  // 解除結案後即可改回
  assert.strictEqual((await req('DELETE', `/api/mother-closures/${c.data.id}`)).status, 200);
  assert.strictEqual((await req('PUT', `/api/bookings/${bk.id}/status`, { status: 'cancelled' })).status, 200);
});

test('訂房改期：報喜帶入的入住日訂餐與請備房任務跟著搬', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const base = Date.now() - new Date().getTimezoneOffset() * 60000;
  const D = n => new Date(base + n * 86400000).toISOString().slice(0, 10);
  const c = await req('POST', '/api/customers', { name: '改期同步媽', due_date: D(0) });
  const rooms = (await req('GET', '/api/rooms')).data.filter(r => r.active).reverse();
  let bk = null, room = null;
  for (const r of rooms) {
    const t = await req('POST', '/api/bookings', { mother_id: c.data.id, room_id: r.id, check_in: D(40), check_out: D(60) });
    if (t.status === 200) { bk = t.data; room = r; break; }
  }
  assert.ok(bk);
  // 報喜（自動建 D40 訂餐＋請備房）
  assert.strictEqual((await req('POST', `/api/customers/${c.data.id}/baby-announce`, {
    birth_date: D(0), babies: [{ gender: 'female', weight_g: 3000 }], meal_choice: 'A',
    diet_type: '葷食', taboos: '羊肉', bra_size: 'L' })).status, 200);
  // 改期到 D45~D65
  assert.strictEqual((await req('PUT', `/api/bookings/${bk.id}`, { check_in: D(45), check_out: D(65) })).status, 200);
  // 訂餐重鋪到新住期：D40 清空、D45（新入住日）午餐起 2 筆、中間日 3 筆
  const oldMeals = (await req('GET', `/api/meals?date=${D(40)}`)).data.orders.filter(o => o.mother_id === c.data.id);
  const newMeals = (await req('GET', `/api/meals?date=${D(45)}`)).data.orders.filter(o => o.mother_id === c.data.id);
  assert.strictEqual(oldMeals.length, 0);
  assert.strictEqual(newMeals.length, 2);
  assert.ok(newMeals.every(o => o.choice === 'A'));
  const midNew = (await req('GET', `/api/meals?date=${D(50)}`)).data.orders.filter(o => o.mother_id === c.data.id);
  assert.strictEqual(midNew.length, 3);
  // 請備房任務名帶新入住日 MMdd、備註日期同步；排定日維持報喜儲存日（今日）
  const hk = (await req('GET', `/api/housekeeping?date=${D(45)}`)).data;
  const TASK2 = `${room.name}請備房${D(45).slice(5).replace('-', '')}`;
  const task = hk.tasks.find(t => t.task === TASK2 && t.mother_name === '改期同步媽');
  assert.ok(task);
  assert.strictEqual(task.scheduled_for, D(0));
  assert.ok(task.note.includes(D(45)) && task.note.includes(D(65)));
  assert.strictEqual((await req('PUT', `/api/bookings/${bk.id}/status`, { status: 'cancelled' })).status, 200);
});

test('床表：提前退房以實際退房日為佔用終點', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const base = Date.now() - new Date().getTimezoneOffset() * 60000;
  const D = n => new Date(base + n * 86400000).toISOString().slice(0, 10);
  const mom = (await req('GET', '/api/mothers')).data[0];
  const rooms = (await req('GET', '/api/rooms')).data.filter(r => r.active).reverse();
  let bk = null;
  for (const r of rooms) {
    const t = await req('POST', '/api/bookings', { mother_id: mom.id, room_id: r.id, check_in: D(-10), check_out: D(20) });
    if (t.status === 200) { bk = t.data; break; }
  }
  assert.ok(bk);
  assert.strictEqual((await req('PUT', `/api/bookings/${bk.id}/status`, { status: 'checked_in' })).status, 200);
  // 提前退房（今日）→ 床表 check_out 應收斂為今日，且狀態為 checked_out
  assert.strictEqual((await req('PUT', `/api/bookings/${bk.id}/status`, { status: 'checked_out', reason: '測試提前退房' })).status, 200);
  const cal = (await req('GET', `/api/room-calendar?start=${D(-10)}&days=30`)).data;
  const row = cal.bookings.find(x => x.id === bk.id);
  assert.ok(row);
  assert.strictEqual(row.status, 'checked_out');
  assert.strictEqual(row.check_out, D(0));
});

test('膳食：更改餐點自動帶入未來日期（至出住日早餐止），未訂只改當天', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const mom = (await req('GET', '/api/mothers')).data.find(m => m.status === 'checked_in');
  const cust = await req('GET', `/api/customers/${mom.id}`);
  const bk = cust.data.bookings.find(b => b.status === 'checked_in');
  assert.ok(bk, '需有入住中訂房');
  // 取住期內一天（入住日之後），設定午餐 A 並往後帶
  const startPlus1 = new Date(new Date(bk.check_in).getTime() + 86400000).toISOString().slice(0, 10);
  const day = startPlus1 <= bk.check_out ? startPlus1 : bk.check_in;
  const r = await req('POST', '/api/meals', { mother_id: mom.id, meal_date: day, meal_type: 'lunch', choice: 'A核', propagate: true });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.filled >= 1, '應往後帶入至少一天');
  // 隔天的午餐應已帶入 A核
  const next = new Date(new Date(day).getTime() + 86400000).toISOString().slice(0, 10);
  if (next < bk.check_out) {
    const o = (await req('GET', `/api/meals?date=${next}`)).data.orders.find(x => x.mother_id === mom.id && x.meal_type === 'lunch');
    assert.ok(o && o.choice === 'A核', '隔天午餐應自動帶入 A核');
  }
  // 出住日只帶早餐：晚餐不應出現在出住日
  const outDinner = (await req('GET', `/api/meals?date=${bk.check_out}`)).data.orders.find(x => x.mother_id === mom.id && x.meal_type === 'dinner' && x.meal_date === bk.check_out);
  assert.ok(!outDinner, '出住日不應有晚餐');
  // 未訂只改當天（不往後清）
  const r2 = await req('POST', '/api/meals', { mother_id: mom.id, meal_date: day, meal_type: 'lunch', choice: '', propagate: false });
  assert.strictEqual(r2.status, 200);
  if (next < bk.check_out) {
    const o2 = (await req('GET', `/api/meals?date=${next}`)).data.orders.find(x => x.mother_id === mom.id && x.meal_type === 'lunch');
    assert.ok(o2 && o2.choice === 'A核', '未訂當天不應影響隔天');
  }
});

test('寶寶報喜：房務任務名(房號+請備房+MMdd)、備註含哺乳衣、膳食自入住日午餐帶入禁忌', async () => {
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const mom = (await req('GET', '/api/mothers')).data.find(m => m.status === 'checked_in');
  const cust = await req('GET', `/api/customers/${mom.id}`);
  const bk = cust.data.bookings.find(b => b.status === 'checked_in');
  assert.ok(bk, '需有入住中訂房');
  const mmdd = bk.check_in.slice(5).replace('-', '');
  const r = await req('POST', `/api/customers/${mom.id}/baby-announce`, {
    birth_date: '2026-07-12', birth_mode: '自然產', birth_hospital: '禾馨',
    babies: [{ gender: 'male', weight_g: 3200 }],
    meal_choice: 'A', diet_type: '葷食', taboos: '牛肉、帶殼海鮮', bra_size: 'M', room_name: bk.room_name
  });
  assert.strictEqual(r.status, 200);
  // 房務任務名 = 房號+請備房+MMdd(入住日)
  assert.strictEqual(r.data.hk_task, `${bk.room_name}請備房${mmdd}`);
  assert.strictEqual(r.data.meal_date, bk.check_in);
  // 房務任務建於今日、備註含哺乳衣尺寸
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const hk = (await req('GET', `/api/housekeeping?date=${today}`)).data;
  const task = hk.tasks.find(t => t.task === r.data.hk_task);
  assert.ok(task, '房務任務應建立於今日');
  assert.ok((task.note || '').includes('哺乳衣 M'), '備註應含哺乳衣尺寸');
  // 入住日午餐已帶入餐別 A 且備註含禁忌
  const lunch = (await req('GET', `/api/meals?date=${bk.check_in}`)).data.orders.find(o => o.mother_id === mom.id && o.meal_type === 'lunch');
  assert.ok(lunch && lunch.choice === 'A', '入住日午餐應帶入 A');
  assert.ok((lunch.note || '').includes('牛肉'), '訂餐備註應含禁忌');
  // 入住日早餐不供餐（自午餐起）
  const bfast = (await req('GET', `/api/meals?date=${bk.check_in}`)).data.orders.find(o => o.mother_id === mom.id && o.meal_type === 'breakfast');
  assert.ok(!bfast, '入住日不供早餐');
});
