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
