// 採購作業整合測試：請購 → 核准拆採購單 → 驗貨入庫（進備品庫存、新品項建檔）→ 請款付款，
// 出貨扣庫存與領料單，以及三層權限。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB = path.join('/tmp', `mamacare-proc-${process.pid}.db`);
const PORT = 3960 + (process.pid % 30);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let cookie = '';

function cleanDb() { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* */ } } }
async function req(method, p, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch (e) { /* */ }
  return { status: res.status, data };
}
async function ok(method, p, body) {
  const r = await req(method, p, body);
  assert.strictEqual(r.status, 200, `${method} ${p}：${JSON.stringify(r.data)}`);
  return r.data;
}
const D = n => new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + n * 86400000).toISOString().slice(0, 10);
const login = (u, p) => { cookie = ''; return req('POST', '/api/login', { username: u, password: p }); };

before(async () => {
  cleanDb();
  const env = { ...process.env, MAMACARE_DB: DB };
  const seed = spawnSync('node', ['src/db.js', '--seed'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.strictEqual(seed.status, 0, seed.stderr);
  server = spawn('node', ['src/server.js'], { cwd: ROOT,
    env: { ...env, PORT: String(PORT), SESSION_SECRET: 'test', NODE_ENV: 'test', DB_BACKEND: 'sqlite' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/')).ok) break; } catch (e) { /* */ }
    await new Promise(r => setTimeout(r, 100));
  }
  await login('admin', 'admin123');
});
after(() => { if (server) server.kill('SIGKILL'); cleanDb(); });

let vendorA, vendorB, paper, stockBefore;

test('廠商管理：新增（自動編號）→ 修改 → 列表', async () => {
  vendorA = (await ok('POST', '/api/procurement/vendors', {
    name: '台灣文具有限公司', tax_id: '12345678', payment_terms: '月結30天', contact: '陳先生',
    bank_name: '台灣銀行', bank_code: '004', bank_account: '123-456-789', bank_holder: '台灣文具有限公司'
  })).id;
  vendorB = (await ok('POST', '/api/procurement/vendors', { name: '好醫療器材行', payment_terms: '貨到付款' })).id;
  await ok('PUT', `/api/procurement/vendors/${vendorA}`, { phone: '02-2234-5678' });
  const list = await ok('GET', '/api/procurement/vendors?q=文具');
  assert.strictEqual(list.length, 1);
  assert.match(list[0].code, /^S\d{3}$/);
  assert.strictEqual(list[0].phone, '02-2234-5678');
});

test('品項管理：建立品項（期初庫存寫入備品進出紀錄）並指定預設廠商', async () => {
  paper = (await ok('POST', '/api/procurement/items', {
    code: 'P001', name: 'A4影印紙', unit: '包', safety_stock: 10, price: 120, warehouse: 'A倉', initial_stock: 3,
    vendors: [{ vendor_id: vendorA, is_default: true }, { vendor_id: vendorB }]
  })).id;
  const { rows, warehouses } = await ok('GET', '/api/procurement/items?low=1');
  const it = rows.find(r => r.id === paper);
  assert.strictEqual(it.stock, 3);
  assert.deepStrictEqual(it.vendors.map(v => [v.id, v.is_default]), [[vendorA, 1], [vendorB, 0]]);
  assert.ok(warehouses.includes('A倉'));
  // 同一份庫存：既有備品模組看得到這筆期初入庫
  const txns = await ok('GET', `/api/supplies/${paper}/txns`);
  assert.ok(txns.some(t => t.txn_type === 'in' && t.quantity === 3 && t.reason === '期初庫存'));
  stockBefore = 3;
});

let prId, poIds;
test('請購單：建立（含既有品項與新品名）→ 修改 → 核准後依廠商＋到貨日拆採購單', async () => {
  const r = await ok('POST', '/api/procurement/requests', {
    requester: '王小姐', purpose: '九月耗材補貨', items: [
      { supply_id: paper, qty: 20, suggested_vendor_id: vendorA },
      { item_name: '酒精棉片', unit: '盒', qty: 5 }
    ]
  });
  prId = r.id;
  assert.match(r.no, /^PR-\d{6}-0001$/);
  await ok('PUT', `/api/procurement/requests/${prId}`, { purpose: '九月耗材補貨（急）', urgent: true });
  const pr = await ok('GET', `/api/procurement/requests/${prId}`);
  assert.strictEqual(pr.urgent, 1);
  assert.strictEqual(pr.items.length, 2);
  // 未指定廠商 → 擋
  const miss = await req('POST', `/api/procurement/requests/${prId}/approve`, { items: [{ item_id: pr.items[0].id, vendor_id: vendorA }] });
  assert.strictEqual(miss.status, 400);
  const ap = await ok('POST', `/api/procurement/requests/${prId}/approve`, { items: [
    { item_id: pr.items[0].id, vendor_id: vendorA, eta: D(3) },
    { item_id: pr.items[1].id, vendor_id: vendorB, eta: D(5) }
  ] });
  assert.strictEqual(ap.orders.length, 2);
  poIds = ap.orders.map(o => o.id);
  assert.strictEqual((await ok('GET', `/api/procurement/requests/${prId}`)).status, 'ordered');
  // 已核准不可再改
  assert.strictEqual((await req('PUT', `/api/procurement/requests/${prId}`, { purpose: 'x' })).status, 400);
});

test('採購單：可改單價，新品項帶建檔資料；列表可依廠商篩選', async () => {
  const po1 = await ok('GET', `/api/procurement/orders/${poIds[0]}`);
  assert.strictEqual(po1.vendor_name, '台灣文具有限公司');
  assert.strictEqual(po1.items[0].unit_price, 120);          // 帶品項參考單價
  await ok('PUT', `/api/procurement/orders/${po1.id}`, { items: [{ id: po1.items[0].id, unit_price: 110 }] });
  const po2 = await ok('GET', `/api/procurement/orders/${poIds[1]}`);
  assert.strictEqual(po2.items[0].is_new, 1);
  await ok('PUT', `/api/procurement/orders/${po2.id}`, { items: [{ id: po2.items[0].id, unit_price: 80, new_code: 'P900', new_warehouse: '護理站', new_safety: 2 }] });
  const byVendor = await ok('GET', `/api/procurement/orders?vendor_id=${vendorB}`);
  assert.deepStrictEqual(byVendor.map(o => o.id), [po2.id]);
});

let payId;
test('驗貨入庫：實到數量進備品庫存、採購單轉已入庫、自動產生請款單（到期日依廠商付款條件）', async () => {
  const po1 = await ok('GET', `/api/procurement/orders/${poIds[0]}`);
  const gr = await ok('POST', '/api/procurement/receipts', {
    po_id: po1.id, inspector: '李驗收', invoice_no: 'AB12345678', receive_date: D(0),
    items: [{ po_item_id: po1.items[0].id, received_qty: 18, unit_price: 110 }]
  });
  assert.match(gr.no, /^REC-/);
  assert.match(gr.payment_no, /^PAY-/);
  payId = gr.payment_id;
  const it = (await ok('GET', '/api/procurement/items')).rows.find(r => r.id === paper);
  assert.strictEqual(it.stock, stockBefore + 18);
  const txns = await ok('GET', `/api/supplies/${paper}/txns`);
  assert.ok(txns.some(t => t.txn_type === 'in' && t.quantity === 18 && t.vendor === '台灣文具有限公司'));
  assert.strictEqual((await ok('GET', `/api/procurement/orders/${po1.id}`)).status, 'received');
  // 已入庫不可重複驗貨
  assert.strictEqual((await req('POST', '/api/procurement/receipts', { po_id: po1.id, inspector: 'x' })).status, 400);
  const pay = await ok('GET', `/api/procurement/payments/${payId}`);
  assert.strictEqual(pay.subtotal, 1980);
  assert.strictEqual(pay.tax_amount, 99);
  assert.strictEqual(pay.total_amount, 2079);
  assert.strictEqual(pay.pay_due_date, D(30));               // 月結30天
  assert.strictEqual(pay.bank_account, '123-456-789');       // 請款帶出廠商匯款資料
  assert.strictEqual(pay.invoice_no, 'AB12345678');
});

test('驗貨入庫：新品項自動建檔並掛上廠商', async () => {
  const po2 = await ok('GET', `/api/procurement/orders/${poIds[1]}`);
  const gr = await ok('POST', '/api/procurement/receipts', {
    po_id: po2.id, inspector: '李驗收',
    items: [{ po_item_id: po2.items[0].id, received_qty: 5, new_unit: '盒' }]
  });
  assert.strictEqual(gr.new_items, 1);
  const { rows } = await ok('GET', '/api/procurement/items?q=P900');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].stock, 5);
  assert.strictEqual(rows[0].warehouse, '護理站');
  assert.strictEqual(rows[0].vendors[0].id, vendorB);
  const pay = await ok('GET', `/api/procurement/payments/${gr.payment_id}`);
  assert.strictEqual(pay.pay_due_date, D(0));                // 貨到付款
});

test('請款單：改金額（手動含稅總額覆蓋）→ 付款 → 付款後鎖定 → 管理員可改回待付款', async () => {
  const pay = await ok('GET', `/api/procurement/payments/${payId}`);
  const upd = await ok('PUT', `/api/procurement/payments/${payId}`, {
    items: [{ id: pay.items[0].id, unit_price: 100 }], tax_rate: 5, total_amount: 1890, remark: '議價後'
  });
  assert.strictEqual(upd.subtotal, 1800);
  assert.strictEqual(upd.total_amount, 1890);
  const paid = await ok('POST', `/api/procurement/payments/${payId}/pay`, { pay_method: '銀行轉帳', paid_on: D(0) });
  assert.strictEqual(paid.status, 'paid');
  assert.strictEqual((await req('PUT', `/api/procurement/payments/${payId}`, { remark: 'x' })).status, 400);
  const v = await ok('GET', `/api/procurement/vendors/${vendorA}`);
  assert.strictEqual(v.payables.paid, 1890);
  assert.ok(v.purchased.some(p => p.name === 'A4影印紙' && p.total_qty === 18));
  await ok('POST', `/api/procurement/payments/${payId}/unpay`, {});
  assert.strictEqual((await ok('GET', `/api/procurement/payments/${payId}`)).status, 'unpaid');
});

test('出貨：建立時檢查庫存並產生領料單，確認出貨才扣庫存；取消的不扣', async () => {
  const over = await req('POST', '/api/procurement/shipments', { recipient: '護理站', items: [{ supply_id: paper, qty: 999 }] });
  assert.strictEqual(over.status, 400);
  const s = await ok('POST', '/api/procurement/shipments', { recipient: '護理站', items: [{ supply_id: paper, qty: 4 }] });
  assert.match(s.pick_no, /^PICK-/);
  const stock = () => ok('GET', '/api/procurement/items').then(d => d.rows.find(r => r.id === paper).stock);
  const before = await stock();
  await ok('PUT', `/api/procurement/shipments/${s.id}`, { items: [{ supply_id: paper, qty: 6 }] });
  assert.strictEqual(await stock(), before);                 // 尚未出貨不扣
  await ok('POST', `/api/procurement/shipments/${s.id}/confirm`, {});
  assert.strictEqual(await stock(), before - 6);
  const picks = await ok('GET', '/api/procurement/picks?status=picked');
  assert.ok(picks.some(p => p.shipment_id === s.id));
  const txns = await ok('GET', `/api/supplies/${paper}/txns`);
  assert.ok(txns.some(t => t.txn_type === 'out' && t.quantity === 6 && t.reason === `出貨 ${s.no}`));
  const c = await ok('POST', '/api/procurement/shipments', { recipient: '客服', items: [{ supply_id: paper, qty: 1 }] });
  await ok('POST', `/api/procurement/shipments/${c.id}/cancel`, {});
  assert.strictEqual((await req('POST', `/api/procurement/shipments/${c.id}/confirm`, {})).status, 400);
  assert.strictEqual(await stock(), before - 6);
});

test('總覽：待辦計數與低庫存', async () => {
  const d = await ok('GET', '/api/procurement/dashboard');
  assert.ok(d.unpaid.c >= 2);
  assert.ok(Array.isArray(d.low_stock));
  assert.strictEqual(d.settings.tax_rate, 5);
  assert.ok(d.settings.payment_terms.includes('月結30天'));
});

test('權限：只有採購作業的人能請購、驗貨，但不能核准或付款；沒有任何採購權限的人整個被擋', async () => {
  await ok('POST', '/api/users', { username: 'buyer1', password: 'buyer12345', name: '採購員', role: 'nurse', permissions: ['purchasing'], modules: ['purchasing'] });
  await ok('POST', '/api/users', { username: 'nurse9', password: 'nurse12345', name: '護理師', role: 'nurse', permissions: ['meals'], modules: ['meals'] });
  await login('buyer1', 'buyer12345');
  const r = await req('POST', '/api/procurement/requests', { requester: '採購員', items: [{ supply_id: paper, qty: 1 }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const pr = await ok('GET', `/api/procurement/requests/${r.data.id}`);
  assert.strictEqual((await req('POST', `/api/procurement/requests/${r.data.id}/approve`, { items: [{ item_id: pr.items[0].id, vendor_id: vendorA }] })).status, 403);
  assert.strictEqual((await req('POST', `/api/procurement/payments/${payId}/pay`, {})).status, 403);
  assert.strictEqual((await req('POST', '/api/procurement/vendors', { name: 'x' })).status, 403);
  await login('nurse9', 'nurse12345');
  assert.strictEqual((await req('GET', '/api/procurement/requests')).status, 403);
  await login('admin', 'admin123');
});
