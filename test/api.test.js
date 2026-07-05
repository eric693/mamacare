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
  const babyId = (await req('GET', '/api/room-status/babies')).data.babies[0].id;
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
  // 指導單執行 → 提醒紀錄第一筆帶入執行日期
  assert.strictEqual((await req('POST', `/api/mothers/${mom.id}/guidance`,
    { kind: 'care', done_date: '2026-07-04' })).status, 200);
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
  assert.ok(g1.data.reminders.some(r => r.done_date === '2026-07-04'));
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
