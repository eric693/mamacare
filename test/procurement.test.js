// 採購作業整合測試：請購 → 核准 → 建採購單（依廠商拆單）→ 比價／預算 → 審核 → 分批驗貨入庫 → 請款付款，
// 出貨扣庫存與領料單，以及三層權限。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB = path.join('/tmp', `mamacare-proc-${process.pid}.db`);
// 伺服器上還有其他服務，固定埠號容易撞到；改由系統挑一個空閒埠
let PORT, BASE;
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = require('node:net').createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
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
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
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
test('請購單：建立（含既有品項與新品名）→ 修改 → 核准（只核准）→ 採購建單依廠商＋到貨日拆單', async () => {
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
  // 未核准不能建採購單
  assert.strictEqual((await req('POST', `/api/procurement/requests/${prId}/order`, { items: [] })).status, 400);
  // 核准：只改狀態，不產生採購單
  await ok('POST', `/api/procurement/requests/${prId}/approve`, {});
  const approved = await ok('GET', `/api/procurement/requests/${prId}`);
  assert.strictEqual(approved.status, 'approved');
  assert.ok(approved.approved_name);
  assert.strictEqual(approved.orders.length, 0);
  assert.strictEqual((await req('POST', `/api/procurement/requests/${prId}/approve`, {})).status, 400);   // 不可重複核准
  assert.ok((await ok('GET', '/api/procurement/requests?status=approved')).some(r => r.id === prId));
  assert.strictEqual((await ok('GET', '/api/procurement/dashboard')).approved_pr, 1);
  // 未指定廠商 → 擋
  const miss = await req('POST', `/api/procurement/requests/${prId}/order`, { items: [{ item_id: pr.items[0].id, vendor_id: vendorA }] });
  assert.strictEqual(miss.status, 400);
  const ap = await ok('POST', `/api/procurement/requests/${prId}/order`, { items: [
    { item_id: pr.items[0].id, vendor_id: vendorA, eta: D(3) },
    { item_id: pr.items[1].id, vendor_id: vendorB, eta: D(5) }
  ] });
  assert.strictEqual(ap.orders.length, 2);
  poIds = ap.orders.map(o => o.id);
  const ordered = await ok('GET', `/api/procurement/requests/${prId}`);
  assert.strictEqual(ordered.status, 'ordered');
  assert.ok(ordered.ordered_name);
  assert.strictEqual((await req('POST', `/api/procurement/requests/${prId}/cancel`, {})).status, 400);   // 已建單不可取消
  // 已核准不可再改
  assert.strictEqual((await req('PUT', `/api/procurement/requests/${prId}`, { purpose: 'x' })).status, 400);
});

test('採購單：建立後為待審核，鍵入預算與單價才可審核；未審核不能驗貨', async () => {
  const po1 = await ok('GET', `/api/procurement/orders/${poIds[0]}`);
  assert.strictEqual(po1.status, 'draft');
  assert.strictEqual(po1.vendor_name, '台灣文具有限公司');
  assert.strictEqual(po1.items[0].unit_price, 120);          // 帶品項參考單價
  assert.ok(po1.problems.some(p => p.includes('預算金額')));
  // 未審核 → 不能驗貨、不能直接審核（缺預算）
  assert.strictEqual((await req('POST', '/api/procurement/receipts', { po_id: po1.id, inspector: 'x' })).status, 400);
  const noBudget = await req('POST', `/api/procurement/orders/${po1.id}/approve`, {});
  assert.strictEqual(noBudget.status, 400);
  assert.match(noBudget.data.error, /預算/);
  const saved = await ok('PUT', `/api/procurement/orders/${po1.id}`, { budget_amount: 2500, items: [{ id: po1.items[0].id, unit_price: 110 }] });
  assert.deepStrictEqual(saved.problems, []);
  await ok('POST', `/api/procurement/orders/${po1.id}/approve`, {});
  const ap = await ok('GET', `/api/procurement/orders/${po1.id}`);
  assert.strictEqual(ap.status, 'pending');
  assert.ok(ap.approved_name);
  // 審核後價格鎖定：PUT 只改到貨日／備註
  await ok('PUT', `/api/procurement/orders/${po1.id}`, { note: '請分兩批送', items: [{ id: po1.items[0].id, unit_price: 1 }] });
  const locked = await ok('GET', `/api/procurement/orders/${po1.id}`);
  assert.strictEqual(locked.items[0].unit_price, 110);
  assert.strictEqual(locked.note, '請分兩批送');
  const byVendor = await ok('GET', `/api/procurement/orders?vendor_id=${vendorB}`);
  assert.deepStrictEqual(byVendor.map(o => o.id), [poIds[1]]);
});

let quoteVendorId;
test('新品項比價：至少兩家報價、勾選一家；新廠商與報價自動存入廠商管理', async () => {
  const po2 = await ok('GET', `/api/procurement/orders/${poIds[1]}`);
  const item = po2.items[0];
  assert.strictEqual(item.is_new, 1);
  assert.strictEqual(item.needs_quotes, true);
  assert.strictEqual(item.quotes.length, 1);                 // 建單時指定的廠商先列為預計採購
  assert.strictEqual(item.quotes[0].vendor_id, vendorB);
  // 只有一家報價 → 不能審核
  await ok('PUT', `/api/procurement/orders/${po2.id}`, { budget_amount: 500 });
  const one = await req('POST', `/api/procurement/orders/${po2.id}/approve`, {});
  assert.strictEqual(one.status, 400);
  assert.match(one.data.error, /至少 2 家/);
  // 補一家新廠商報價（輸入名稱 → 自動建檔）
  const saved = await ok('PUT', `/api/procurement/orders/${po2.id}`, {
    budget_amount: 500,
    items: [{ id: item.id, new_code: 'P900', new_warehouse: '護理站', new_safety: 2, quotes: [
      { vendor_id: vendorB, unit_price: 80, selected: true },
      { vendor_name: '康健醫材行', vendor_phone: '02-1111-2222', vendor_contact: '林小姐', unit_price: 95, note: '含運' }
    ] }]
  });
  assert.deepStrictEqual(saved.problems, []);
  assert.strictEqual(saved.items[0].unit_price, 80);         // 選定報價即採購單價
  const vendors = await ok('GET', '/api/procurement/vendors?q=康健');
  assert.strictEqual(vendors.length, 1);
  assert.strictEqual(vendors[0].phone, '02-1111-2222');
  quoteVendorId = vendors[0].id;
  const vd = await ok('GET', `/api/procurement/vendors/${quoteVendorId}`);
  assert.ok(vd.quotes.some(q => q.unit_price === 95 && q.item_name === '酒精棉片' && q.note === '含運'));
  // 同名再報價不會重複建廠商
  await ok('PUT', `/api/procurement/orders/${po2.id}`, { items: [{ id: item.id, quotes: [
    { vendor_id: vendorB, unit_price: 80, selected: true }, { vendor_name: '康健醫材行', unit_price: 90 }] }] });
  assert.strictEqual((await ok('GET', '/api/procurement/vendors?q=康健')).length, 1);
  // 兩家都勾 → 擋
  const both = await req('PUT', `/api/procurement/orders/${po2.id}`, { items: [{ id: item.id, quotes: [
    { vendor_id: vendorB, unit_price: 80, selected: true }, { vendor_id: quoteVendorId, unit_price: 90, selected: true }] }] });
  assert.strictEqual(both.status, 400);
  // 單品項採購單改選另一家 → 採購單廠商跟著換；再換回來
  const sw = await ok('PUT', `/api/procurement/orders/${po2.id}`, { items: [{ id: item.id, quotes: [
    { vendor_id: vendorB, unit_price: 80 }, { vendor_id: quoteVendorId, unit_price: 90, selected: true }] }] });
  assert.strictEqual(sw.vendor_id, quoteVendorId);
  assert.strictEqual(sw.items[0].unit_price, 90);
  await ok('PUT', `/api/procurement/orders/${po2.id}`, { items: [{ id: item.id, quotes: [
    { vendor_id: vendorB, unit_price: 80, selected: true }, { vendor_id: quoteVendorId, unit_price: 90 }] }] });
  await ok('POST', `/api/procurement/orders/${po2.id}/approve`, {});
  // 退回：未到貨可退回待審核，再審核
  await ok('POST', `/api/procurement/orders/${po2.id}/return`, { reason: '重新議價' });
  assert.strictEqual((await ok('GET', `/api/procurement/orders/${po2.id}`)).status, 'draft');
  await ok('POST', `/api/procurement/orders/${po2.id}/approve`, {});
});

let payId, secondPayId;
test('分批到貨：第一批部分到貨→部分到貨＋請款單；第二批到齊→已入庫；超量擋下', async () => {
  const po1 = await ok('GET', `/api/procurement/orders/${poIds[0]}`);
  const itemId = po1.items[0].id;                            // 訂 20
  const over = await req('POST', '/api/procurement/receipts', { po_id: po1.id, inspector: '李驗收', items: [{ po_item_id: itemId, received_qty: 21 }] });
  assert.strictEqual(over.status, 400);
  const gr = await ok('POST', '/api/procurement/receipts', {
    po_id: po1.id, inspector: '李驗收', invoice_no: 'AB12345678', receive_date: D(0),
    items: [{ po_item_id: itemId, received_qty: 18, unit_price: 110 }]
  });
  assert.strictEqual(gr.batch_no, 1);
  assert.strictEqual(gr.complete, false);
  payId = gr.payment_id;
  let o = await ok('GET', `/api/procurement/orders/${po1.id}`);
  assert.strictEqual(o.status, 'partial');
  assert.strictEqual(o.items[0].received_qty, 18);
  assert.strictEqual(o.items[0].remaining, 2);
  assert.ok((await ok('GET', '/api/procurement/orders?status=receivable')).some(x => x.id === po1.id));
  // 部分到貨不能取消（要用結案）
  assert.strictEqual((await req('POST', `/api/procurement/orders/${po1.id}/cancel`, {})).status, 400);
  const it = (await ok('GET', '/api/procurement/items')).rows.find(r => r.id === paper);
  assert.strictEqual(it.stock, stockBefore + 18);
  const txns = await ok('GET', `/api/supplies/${paper}/txns`);
  assert.ok(txns.some(t => t.txn_type === 'in' && t.quantity === 18 && t.vendor === '台灣文具有限公司' && /第 1 批/.test(t.note)));
  const pay = await ok('GET', `/api/procurement/payments/${payId}`);
  assert.strictEqual(pay.subtotal, 1980);
  assert.strictEqual(pay.tax_amount, 99);
  assert.strictEqual(pay.total_amount, 2079);
  assert.strictEqual(pay.pay_due_date, D(30));               // 月結30天
  assert.strictEqual(pay.bank_account, '123-456-789');       // 請款帶出廠商匯款資料
  // 第二批：預設帶未到貨數量
  const gr2 = await ok('POST', '/api/procurement/receipts', { po_id: po1.id, inspector: '李驗收', invoice_no: 'AB12345679' });
  assert.strictEqual(gr2.batch_no, 2);
  assert.strictEqual(gr2.complete, true);
  // 同廠商同月已有待付款請款單 → 回傳可合併對象，供畫面詢問
  assert.deepStrictEqual(gr2.merge_candidates.map(x => x.id), [payId]);
  secondPayId = gr2.payment_id;
  o = await ok('GET', `/api/procurement/orders/${po1.id}`);
  assert.strictEqual(o.status, 'received');
  assert.strictEqual(o.receipts.length, 2);
  assert.strictEqual((await ok('GET', `/api/procurement/payments/${gr2.payment_id}`)).subtotal, 220);
  const g2 = await ok('GET', `/api/procurement/receipts/${gr2.id}`);
  assert.strictEqual(g2.items[0].cumulative_qty, 20);
  assert.strictEqual((await req('POST', '/api/procurement/receipts', { po_id: po1.id, inspector: 'x' })).status, 400);
  stockBefore += 20;
});

test('新品項分批：第一批到貨建檔、比價廠商都掛上供應廠商；剩餘不再交貨可結案', async () => {
  const po2 = await ok('GET', `/api/procurement/orders/${poIds[1]}`);   // 訂 5
  const gr = await ok('POST', '/api/procurement/receipts', {
    po_id: po2.id, inspector: '李驗收',
    items: [{ po_item_id: po2.items[0].id, received_qty: 3, new_unit: '盒' }]
  });
  assert.strictEqual(gr.new_items, 1);
  const { rows } = await ok('GET', '/api/procurement/items?q=P900');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].stock, 3);
  assert.strictEqual(rows[0].warehouse, '護理站');
  assert.deepStrictEqual(rows[0].vendors.map(v => [v.id, v.is_default]).sort(), [[vendorB, 1], [quoteVendorId, 0]].sort());
  const pay = await ok('GET', `/api/procurement/payments/${gr.payment_id}`);
  assert.strictEqual(pay.pay_due_date, D(0));                // 貨到付款
  assert.strictEqual(pay.subtotal, 240);
  // 結案需原因
  assert.strictEqual((await req('POST', `/api/procurement/orders/${po2.id}/close`, {})).status, 400);
  await ok('POST', `/api/procurement/orders/${po2.id}/close`, { reason: '廠商缺貨不再出貨' });
  const o = await ok('GET', `/api/procurement/orders/${po2.id}`);
  assert.strictEqual(o.status, 'closed');
  assert.strictEqual(o.closed_reason, '廠商缺貨不再出貨');
  assert.strictEqual((await req('POST', '/api/procurement/receipts', { po_id: po2.id, inspector: 'x' })).status, 400);
  const hist = await ok('GET', `/api/procurement/items/${rows[0].id}/history`);
  assert.ok(hist.quotes.length >= 2);
});

test('合併請款：同廠商同月的待付款請款單可合併，支付憑單帶出請採驗流程', async () => {
  const list = await ok('GET', '/api/procurement/payments');
  const row = list.find(x => x.id === payId);
  assert.strictEqual(row.month_unpaid, 2);
  const b = await ok('GET', `/api/procurement/payments/${secondPayId}`);
  assert.ok(b.month_others.some(x => x.id === payId));
  // 不同廠商不可合併
  const other = list.find(x => x.vendor_id !== row.vendor_id && x.status === 'unpaid');
  if (other) assert.strictEqual((await req('POST', `/api/procurement/payments/${payId}/merge`, { ids: [other.id] })).status, 400);
  const merged = await ok('POST', `/api/procurement/payments/${payId}/merge`, { ids: [secondPayId] });
  assert.strictEqual(merged.items.length, 2);
  assert.strictEqual(merged.subtotal, 2200);
  assert.strictEqual(merged.total_amount, 2310);
  assert.strictEqual(merged.invoice_no, 'AB12345678、AB12345679');
  assert.deepStrictEqual(merged.merged_from.map(x => x.id), [secondPayId]);
  assert.deepStrictEqual([...new Set(merged.items.map(i => i.gr_no))].length, 2);
  const src = await ok('GET', `/api/procurement/payments/${secondPayId}`);
  assert.strictEqual(src.status, 'cancelled');
  assert.strictEqual(src.merged_into_no, merged.no);
  // 流程紀錄：請購（申請人、建立人、核准人）→ 採購（建立、審核）→ 兩批驗貨
  const t = merged.trail;
  assert.strictEqual(t.requests.length, 1);
  assert.ok(t.requests[0].approved_name && t.requests[0].created_name && t.requests[0].items.length === 2);
  assert.strictEqual(t.orders.length, 1);
  assert.ok(t.orders[0].approved_name && t.orders[0].approved_at);
  assert.strictEqual(t.receipts.length, 2);
  assert.deepStrictEqual(t.receipts.map(g => g.batch_no), [1, 2]);
  assert.deepStrictEqual(t.receipts.map(g => g.items[0].received_qty), [18, 2]);
  // 已取消（被合併）的不能再合併
  assert.strictEqual((await req('POST', `/api/procurement/payments/${payId}/merge`, { ids: [secondPayId] })).status, 400);
});

test('請款單：改金額（手動含稅總額覆蓋）→ 付款 → 付款後鎖定 → 管理員可改回待付款', async () => {
  const pay = await ok('GET', `/api/procurement/payments/${payId}`);
  const upd = await ok('PUT', `/api/procurement/payments/${payId}`, {
    items: pay.items.map(i => ({ id: i.id, unit_price: 100 })), tax_rate: 5, total_amount: 2100, remark: '議價後'
  });
  assert.strictEqual(upd.subtotal, 2000);
  assert.strictEqual(upd.total_amount, 2100);
  const paid = await ok('POST', `/api/procurement/payments/${payId}/pay`, { pay_method: '銀行轉帳', paid_on: D(0) });
  assert.strictEqual(paid.status, 'paid');
  assert.strictEqual((await req('PUT', `/api/procurement/payments/${payId}`, { remark: 'x' })).status, 400);
  const v = await ok('GET', `/api/procurement/vendors/${vendorA}`);
  assert.strictEqual(v.payables.paid, 2100);
  assert.ok(v.purchased.some(p => p.name === 'A4影印紙' && p.total_qty === 20 && p.times === 2));
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

test('權限：採購作業可請購、建採購單與鍵入預算，不能核准、審核或付款；沒有任何採購權限的人整個被擋', async () => {
  await ok('POST', '/api/users', { username: 'buyer1', password: 'buyer12345', name: '採購員', role: 'nurse', permissions: ['purchasing'], modules: ['purchasing'] });
  await ok('POST', '/api/users', { username: 'nurse9', password: 'nurse12345', name: '護理師', role: 'nurse', permissions: ['meals'], modules: ['meals'] });
  await login('buyer1', 'buyer12345');
  const r = await req('POST', '/api/procurement/requests', { requester: '採購員', items: [{ supply_id: paper, qty: 1 }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const pr = await ok('GET', `/api/procurement/requests/${r.data.id}`);
  assert.strictEqual((await req('POST', `/api/procurement/requests/${r.data.id}/approve`, {})).status, 403);
  // 主管核准後，採購作業的人可以建立採購單
  cookie = ''; await login('admin', 'admin123');
  await ok('POST', `/api/procurement/requests/${r.data.id}/approve`, {});
  await login('buyer1', 'buyer12345');
  const od = await req('POST', `/api/procurement/requests/${r.data.id}/order`, { items: [{ item_id: pr.items[0].id, vendor_id: vendorA }] });
  assert.strictEqual(od.status, 200, JSON.stringify(od.data));
  const poId = od.data.orders[0].id;
  await ok('PUT', `/api/procurement/orders/${poId}`, { budget_amount: 200 });          // 採購人員可鍵入預算
  assert.strictEqual((await req('POST', `/api/procurement/orders/${poId}/approve`, {})).status, 403);   // 不能自己審核
  assert.strictEqual((await req('POST', '/api/procurement/receipts', { po_id: poId, inspector: 'x' })).status, 400);   // 未審核不能驗貨
  assert.strictEqual((await req('POST', `/api/procurement/payments/${payId}/pay`, {})).status, 403);
  assert.strictEqual((await req('POST', '/api/procurement/vendors', { name: 'x' })).status, 403);
  await login('nurse9', 'nurse12345');
  assert.strictEqual((await req('GET', '/api/procurement/requests')).status, 403);
  await login('admin', 'admin123');
});
