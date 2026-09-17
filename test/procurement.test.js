// 採購作業整合測試：請購 → 核准 → 建採購單（依廠商拆單）→ 比價／預算 → 審核 → 分批驗貨入庫 → 請款付款，
// 出貨扣庫存與領料單、批次（便宜先出）與四張報表，以及七種角色權限。
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

let coB;
test('多家公司：預設公司由機構設定建立，可新增、設預設；不能停用預設公司', async () => {
  const list = await ok('GET', '/api/procurement/companies');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].is_default, 1);
  coB = (await ok('POST', '/api/procurement/companies', { name: '嘉禾二館股份有限公司', request_dept: '二館行政部', pay_dept: '二館', tax_id: '87654321' })).id;
  assert.strictEqual((await req('POST', '/api/procurement/companies', { name: '嘉禾二館股份有限公司' })).status, 409);
  assert.strictEqual((await req('POST', '/api/procurement/companies', { name: 'x', tax_id: '12' })).status, 400);
  assert.strictEqual((await req('PUT', `/api/procurement/companies/${list[0].id}`, { active: 0 })).status, 400);
  await ok('PUT', `/api/procurement/companies/${coB}`, { is_default: true });
  assert.strictEqual((await ok('GET', '/api/procurement/companies'))[0].id, coB);
  await ok('PUT', `/api/procurement/companies/${list[0].id}`, { is_default: true });   // 還原
  assert.strictEqual((await ok('GET', '/api/procurement/dashboard')).settings.companies.length, 2);
});

test('廠商價格表：可鍵入供貨品項、未稅價與單位（含尚未建檔的品項），整份儲存', async () => {
  await ok('PUT', `/api/procurement/vendors/${vendorB}`, { items: [
    { item_name: '拋棄式手套', unit: '盒', unit_price: 150, note: '每箱 10 盒' },
    { item_name: '酒精棉片', unit: '盒', unit_price: 85 }
  ] });
  const d = await ok('GET', `/api/procurement/vendors/${vendorB}`);
  assert.deepStrictEqual(d.price_list.map(i => [i.item_name, i.unit, i.unit_price, i.source]).sort(),
    [['拋棄式手套', '盒', 150, 'manual'], ['酒精棉片', '盒', 85, 'manual']].sort());
  assert.strictEqual((await req('PUT', `/api/procurement/vendors/${vendorB}`, { items: [{ item_name: 'a', unit_price: 1 }, { item_name: 'a', unit_price: 2 }] })).status, 400);
  // 可用品名搜尋廠商
  assert.ok((await ok('GET', '/api/procurement/vendors?q=' + encodeURIComponent('拋棄式'))).some(v => v.id === vendorB));
  const prices = await ok('GET', '/api/procurement/vendor-prices?item_name=' + encodeURIComponent('酒精棉片'));
  assert.deepStrictEqual(prices.map(p => [p.vendor_id, p.unit_price]), [[vendorB, 85]]);
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
  assert.strictEqual(item.unit_price, 85);                   // 建單時帶入廠商價格表的價格
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
  // 比價報價（含沒選上的）自動寫進廠商價格表
  const qv = await ok('GET', `/api/procurement/vendors/${quoteVendorId}`);
  assert.ok(qv.price_list.some(i => i.item_name === '酒精棉片' && i.unit_price === 95 && i.source === 'quote'));
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
  // 到貨後廠商價格表記下實際採購價（取代手動價、來源改為採購）
  const pb = (await ok('GET', `/api/procurement/vendors/${vendorB}`)).price_list.find(i => i.item_name === '酒精棉片');
  assert.strictEqual(pb.unit_price, 80);
  assert.strictEqual(pb.source, 'purchase');
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
  // 付款單價（議價後 100）寫回廠商價格表
  const pv = v.price_list.find(i => i.supply_id === paper);
  assert.strictEqual(pv.unit_price, 100);
  assert.strictEqual(pv.source, 'purchase');
  assert.ok(v.purchased.some(p => p.name === 'A4影印紙' && p.total_qty === 20 && p.times === 2));
  await ok('POST', `/api/procurement/payments/${payId}/unpay`, {});
  assert.strictEqual((await ok('GET', `/api/procurement/payments/${payId}`)).status, 'unpaid');
});

test('多家公司：請購指定公司，採購單與請款單沿用；不同公司的請款單不能合併，列表可依公司篩選', async () => {
  const r = await ok('POST', '/api/procurement/requests', { requester: '二館', company_id: coB, items: [{ supply_id: paper, qty: 2 }] });
  const pr = await ok('GET', `/api/procurement/requests/${r.id}`);
  assert.strictEqual(pr.company_name, '嘉禾二館股份有限公司');
  assert.strictEqual(pr.company_request_dept, '二館行政部');
  await ok('POST', `/api/procurement/requests/${r.id}/approve`, {});
  const od = await ok('POST', `/api/procurement/requests/${r.id}/order`, { items: [{ item_id: pr.items[0].id, vendor_id: vendorA }] });
  const poId = od.orders[0].id;
  await ok('PUT', `/api/procurement/orders/${poId}`, { budget_amount: 500 });
  await ok('POST', `/api/procurement/orders/${poId}/approve`, {});
  const po = await ok('GET', `/api/procurement/orders/${poId}`);
  assert.strictEqual(po.company_id, coB);
  assert.strictEqual(po.company_pay_dept, '二館');
  const gr = await ok('POST', '/api/procurement/receipts', { po_id: poId, inspector: '二館' });
  // 同廠商同月，但公司不同 → 不列為合併對象
  assert.deepStrictEqual(gr.merge_candidates, []);
  const pay = await ok('GET', `/api/procurement/payments/${gr.payment_id}`);
  assert.strictEqual(pay.company_name, '嘉禾二館股份有限公司');
  assert.strictEqual((await req('POST', `/api/procurement/payments/${payId}/merge`, { ids: [gr.payment_id] })).status, 400);
  const onlyB = await ok('GET', `/api/procurement/payments?company_id=${coB}`);
  assert.deepStrictEqual(onlyB.map(x => x.id), [gr.payment_id]);
  assert.ok((await ok('GET', `/api/procurement/requests?company_id=${coB}`)).every(x => x.company_id === coB));
  stockBefore += 2;
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

test('權限：七種角色各自只能瀏覽／key 自己的單據', async () => {
  const mk = async (username, perms) => ok('POST', '/api/users', { username, password: 'pass12345', name: username, role: 'nurse', permissions: perms, modules: perms });
  await mk('u_req', ['proc_request']);
  await mk('u_buy', ['proc_buyer']);
  await mk('u_rcv', ['proc_receive']);
  await mk('u_shp', ['proc_ship']);
  await mk('u_acc', ['proc_account']);
  await mk('u_fin', ['proc_finance']);
  await mk('u_adm', ['proc_admin']);
  await mk('nurse9', ['meals']);
  const as = u => login(u, 'pass12345');
  const st = async (m, p, b) => (await req(m, p, b)).status;

  // 請購人員：請購單可 key，採購單／請款單看不到
  await as('u_req');
  const r = await req('POST', '/api/procurement/requests', { requester: '請購員', items: [{ supply_id: paper, qty: 1 }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(await st('GET', '/api/procurement/items'), 200);            // 庫存總覽
  assert.strictEqual(await st('GET', '/api/procurement/dashboard'), 200);
  assert.strictEqual(await st('GET', '/api/procurement/orders'), 403);
  assert.strictEqual(await st('GET', '/api/procurement/payments'), 403);
  assert.strictEqual(await st('POST', `/api/procurement/requests/${r.data.id}/approve`, {}), 403);
  assert.strictEqual(await st('POST', '/api/procurement/vendors', { name: 'x' }), 403);
  assert.strictEqual(await st('GET', '/api/procurement/reports/inventory'), 403);

  // 管理員核准
  await as('u_adm');
  await ok('POST', `/api/procurement/requests/${r.data.id}/approve`, {});
  const pr = await ok('GET', `/api/procurement/requests/${r.data.id}`);

  // 採購人員：建採購單、維護品項與廠商；不能核准請購、審核採購、驗貨、付款、出貨
  await as('u_buy');
  const od = await req('POST', `/api/procurement/requests/${r.data.id}/order`, { items: [{ item_id: pr.items[0].id, vendor_id: vendorA }] });
  assert.strictEqual(od.status, 200, JSON.stringify(od.data));
  const poId = od.data.orders[0].id;
  await ok('PUT', `/api/procurement/orders/${poId}`, { budget_amount: 200 });
  assert.strictEqual(await st('POST', '/api/procurement/vendors', { name: '採購員建的廠商' }), 200);
  assert.strictEqual(await st('POST', `/api/procurement/orders/${poId}/approve`, {}), 403);
  assert.strictEqual(await st('POST', '/api/procurement/requests', { requester: 'x', items: [{ supply_id: paper, qty: 1 }] }), 403);
  assert.strictEqual(await st('POST', '/api/procurement/receipts', { po_id: poId, inspector: 'x' }), 403);
  assert.strictEqual(await st('GET', '/api/procurement/payments'), 403);
  assert.strictEqual(await st('POST', '/api/procurement/shipments', { recipient: 'x', items: [{ supply_id: paper, qty: 1 }] }), 403);

  await as('u_adm');
  await ok('POST', `/api/procurement/orders/${poId}/approve`, {});

  // 驗貨人員：只能驗貨
  await as('u_rcv');
  assert.strictEqual(await st('GET', '/api/procurement/orders?status=receivable'), 200);
  const gr = await req('POST', '/api/procurement/receipts', { po_id: poId, inspector: '驗貨員' });
  assert.strictEqual(gr.status, 200, JSON.stringify(gr.data));
  assert.strictEqual(await st('PUT', `/api/procurement/orders/${poId}`, { note: 'x' }), 403);
  assert.strictEqual(await st('GET', '/api/procurement/requests'), 403);
  assert.strictEqual(await st('GET', '/api/procurement/payments'), 403);
  assert.strictEqual(await st('GET', '/api/procurement/shipments'), 403);

  // 出貨人員：出貨與領料；看不到採購與請款
  await as('u_shp');
  const sh = await req('POST', '/api/procurement/shipments', { recipient: '出貨員', items: [{ supply_id: paper, qty: 1 }] });
  assert.strictEqual(sh.status, 200, JSON.stringify(sh.data));
  assert.strictEqual(await st('POST', `/api/procurement/shipments/${sh.data.id}/confirm`, {}), 200);
  assert.strictEqual(await st('GET', '/api/procurement/picks'), 200);
  assert.strictEqual(await st('GET', '/api/procurement/orders'), 403);
  assert.strictEqual(await st('GET', '/api/procurement/payments'), 403);

  // 記帳人員：請款單可 key；請購、採購、驗貨、領料可看不可改；不能出貨
  await as('u_acc');
  for (const p of ['/api/procurement/requests', '/api/procurement/orders', '/api/procurement/receipts', '/api/procurement/picks', '/api/procurement/items', '/api/procurement/payments']) {
    assert.strictEqual(await st('GET', p), 200, p);
  }
  assert.strictEqual(await st('PUT', `/api/procurement/payments/${gr.data.payment_id}`, { remark: '記帳員備註' }), 200);
  assert.strictEqual(await st('POST', '/api/procurement/requests', { requester: 'x', items: [{ supply_id: paper, qty: 1 }] }), 403);
  assert.strictEqual(await st('PUT', `/api/procurement/orders/${poId}`, { note: 'x' }), 403);
  assert.strictEqual(await st('POST', '/api/procurement/shipments', { recipient: 'x', items: [{ supply_id: paper, qty: 1 }] }), 403);
  assert.strictEqual(await st('GET', '/api/procurement/reports/inventory'), 403);

  // 財務人員：全部可看，一律不能 key
  await as('u_fin');
  for (const p of ['/api/procurement/dashboard', '/api/procurement/requests', '/api/procurement/orders', '/api/procurement/receipts',
    '/api/procurement/payments', '/api/procurement/shipments', '/api/procurement/picks', '/api/procurement/items', '/api/procurement/vendors',
    '/api/procurement/reports/inventory', '/api/procurement/reports/shipments', '/api/procurement/reports/receipts', '/api/procurement/reports/payables']) {
    assert.strictEqual(await st('GET', p), 200, p);
  }
  for (const [m, p, b] of [
    ['POST', '/api/procurement/requests', { requester: 'x', items: [{ supply_id: paper, qty: 1 }] }],
    ['PUT', `/api/procurement/orders/${poId}`, { note: 'x' }],
    ['POST', '/api/procurement/receipts', { po_id: poId, inspector: 'x' }],
    ['PUT', `/api/procurement/payments/${gr.data.payment_id}`, { remark: 'x' }],
    ['POST', '/api/procurement/shipments', { recipient: 'x', items: [{ supply_id: paper, qty: 1 }] }],
    ['POST', '/api/procurement/vendors', { name: 'x' }],
    ['PUT', '/api/procurement/settings', { tax_rate: 5 }],
    ['POST', '/api/procurement/companies', { name: 'x公司' }]
  ]) assert.strictEqual(await st(m, p, b), 403, `${m} ${p}`);

  // 採購作業管理員：採購作業全部可 key，含設定與公司
  await as('u_adm');
  assert.strictEqual(await st('PUT', '/api/procurement/settings', { tax_rate: 5, payment_terms: '月結30天,貨到付款,月結45天,月結60天,預付款' }), 200);
  assert.strictEqual(await st('POST', '/api/procurement/companies', { name: '管理員新增公司' }), 200);
  assert.strictEqual(await st('GET', '/api/procurement/reports/payables'), 200);

  // 沒有任何採購角色的人整個被擋
  await as('nurse9');
  assert.strictEqual(await st('GET', '/api/procurement/items'), 403);
  await login('admin', 'admin123');
  stockBefore += 0;
});

// ---- 批次（便宜先出）與報表 ----
async function buy(itemId, vendorId, qty, price) {
  const r = await ok('POST', '/api/procurement/requests', { requester: '報表測試', items: [{ supply_id: itemId, qty }] });
  await ok('POST', `/api/procurement/requests/${r.id}/approve`, {});
  const pr = await ok('GET', `/api/procurement/requests/${r.id}`);
  const od = await ok('POST', `/api/procurement/requests/${r.id}/order`, { items: [{ item_id: pr.items[0].id, vendor_id: vendorId }] });
  const po = await ok('GET', `/api/procurement/orders/${od.orders[0].id}`);
  await ok('PUT', `/api/procurement/orders/${po.id}`, { budget_amount: qty * price + 1, items: [{ id: po.items[0].id, unit_price: price }] });
  await ok('POST', `/api/procurement/orders/${po.id}/approve`, {});
  return ok('POST', '/api/procurement/receipts', { po_id: po.id, inspector: '報表測試', invoice_no: `INV${price}` });
}
const ymNow = D(0).slice(0, 7).replace('-', '');
const nextMonth = (() => { const [y, m] = D(0).split('-').map(Number); return m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, '0')}`; })();

let lotItem;
test('批次：同廠商同價併同一批、價格變動才開新批（批號 yyyymm01 起），出貨從最便宜的批次先扣', async () => {
  lotItem = (await ok('POST', '/api/procurement/items', { code: 'LOT1', name: '批次測試棉棒', unit: '包', price: 10, initial_stock: 5 })).id;
  await buy(lotItem, vendorA, 10, 12);
  await buy(lotItem, vendorA, 10, 12);                 // 同價 → 同一批
  await buy(lotItem, vendorB, 10, 9);                  // 不同廠商、較便宜 → 新批
  const rep = await ok('GET', `/api/procurement/reports/inventory?month=${ymNow}&supply_id=${lotItem}`);
  assert.strictEqual(rep.rows.length, 3, JSON.stringify(rep.rows));
  for (const x of rep.rows) assert.match(x.lot_no, new RegExp(`^${ymNow}\\d{2}$`));
  const byPrice = p => rep.rows.find(x => x.unit_price === p);
  assert.strictEqual(byPrice(12).in_qty, 20);
  assert.strictEqual(byPrice(12).vendor_name, '台灣文具有限公司');
  assert.strictEqual(byPrice(9).in_qty, 10);
  assert.strictEqual(byPrice(10).in_qty, 5);           // 期初庫存（建品項時輸入）
  // 出貨 8：全從 $9 那批扣
  const s1 = await ok('POST', '/api/procurement/shipments', { recipient: '護理站', items: [{ supply_id: lotItem, qty: 8 }] });
  await ok('POST', `/api/procurement/shipments/${s1.id}/confirm`, {});
  // 出貨 5：$9 剩 2、再從 $10 扣 3
  const s2 = await ok('POST', '/api/procurement/shipments', { recipient: '客服部', items: [{ supply_id: lotItem, qty: 5 }] });
  await ok('POST', `/api/procurement/shipments/${s2.id}/confirm`, {});
  const r2 = await ok('GET', `/api/procurement/reports/inventory?month=${ymNow}&supply_id=${lotItem}`);
  const p2 = p => r2.rows.find(x => x.unit_price === p);
  assert.deepStrictEqual([p2(9).out_qty, p2(9).end_qty], [10, 0]);
  assert.deepStrictEqual([p2(10).out_qty, p2(10).end_qty], [3, 2]);
  assert.deepStrictEqual([p2(12).out_qty, p2(12).end_qty], [0, 20]);
  assert.strictEqual(r2.totals.end_qty, 22);
  assert.strictEqual(r2.totals.end_amt, 2 * 10 + 20 * 12);
  // 盤點少 2：從最便宜的 $10 批扣，列在調整
  await ok('POST', `/api/supplies/${lotItem}/txns`, { txn_type: 'adjust', quantity: 20 });
  const r3 = await ok('GET', `/api/procurement/reports/inventory?month=${ymNow}&supply_id=${lotItem}`);
  assert.strictEqual(r3.rows.find(x => x.unit_price === 10).adj_qty, -2);
  assert.strictEqual(r3.totals.end_qty, 20);
  // 下個月：本月期末＝下月期初
  const nx = await ok('GET', `/api/procurement/reports/inventory?month=${nextMonth}&supply_id=${lotItem}`);
  assert.strictEqual(nx.totals.open_qty, 20);
  assert.strictEqual(nx.totals.in_qty, 0);
  assert.strictEqual(nx.rows.find(x => x.unit_price === 12).open_qty, 20);
  // 出貨明細金額＝實際扣到的批次成本
  const sd = await ok('GET', `/api/procurement/reports/shipments?from=${D(0)}&to=${D(0)}&q=${encodeURIComponent('批次測試')}`);
  assert.deepStrictEqual(sd.rows.map(x => [x.recipient, x.qty, x.amount]), [['護理站', 8, 72], ['客服部', 5, 48]]);
  assert.strictEqual(sd.total.amount, 120);
  const sdr = await ok('GET', `/api/procurement/reports/shipments?from=${D(0)}&to=${D(0)}&recipient=${encodeURIComponent('客服')}&supply_id=${lotItem}`);
  assert.strictEqual(sdr.rows.length, 1);
});

test('批次：直接改庫存或舊資料（沒有異動紀錄）也會補成期初／校正，期末永遠等於系統庫存', async () => {
  const legacy = (await ok('POST', '/api/supplies', { name: '舊庫存品項', unit: '個', stock: 7, price: 3 })).id;
  const rep = await ok('GET', `/api/procurement/reports/inventory?month=${ymNow}&supply_id=${legacy}`);
  assert.strictEqual(rep.rows.length, 1);
  assert.deepStrictEqual([rep.rows[0].open_qty, rep.rows[0].end_qty, rep.rows[0].end_amt], [7, 7, 21]);
  // 全部品項：報表期末數量合計＝系統庫存合計
  const all = await ok('GET', `/api/procurement/reports/inventory?month=${ymNow}`);
  const stock = (await ok('GET', '/api/supplies/stock-summary')).reduce((t, x) => t + x.stock, 0);
  assert.strictEqual(all.totals.end_qty, stock);
});

test('報表：進貨明細、廠商請款明細（稅額分攤合計一致）、Excel 匯出', async () => {
  const rc = await ok('GET', `/api/procurement/reports/receipts?from=${D(0)}&to=${D(0)}&supply_id=${lotItem}`);
  assert.deepStrictEqual(rc.rows.map(x => [x.vendor_name, x.qty, x.amount]).sort(),
    [['台灣文具有限公司', 10, 120], ['台灣文具有限公司', 10, 120], ['好醫療器材行', 10, 90]].sort());
  assert.strictEqual(rc.total.amount, 330);
  assert.ok(rc.summary.some(g => g.vendor_name === '台灣文具有限公司' && g.qty === 20 && g.amount === 240));
  const pay = await ok('GET', `/api/procurement/reports/payables?from=${D(0)}&to=${D(0)}&vendor_id=${vendorA}`);
  assert.ok(pay.rows.length > 0);
  assert.ok(pay.rows.every(x => x.vendor_name === '台灣文具有限公司'));
  // 每張請款單：明細總額合計＝請款單含稅總額
  const heads = (await ok('GET', `/api/procurement/payments?vendor_id=${vendorA}`)).filter(p => p.status !== 'cancelled');
  for (const h of heads) {
    const lines = pay.rows.filter(x => x.pay_no === h.no);
    if (!lines.length) continue;
    assert.strictEqual(lines.reduce((t, x) => t + x.total, 0), h.total_amount, h.no);
    assert.strictEqual(lines.reduce((t, x) => t + x.tax, 0), h.tax_amount, h.no);
  }
  assert.ok(pay.rows.some(x => x.invoice_no === 'INV12'));
  for (const kind of ['inventory', 'shipments', 'receipts', 'payables']) {
    const res = await fetch(`${BASE}/api/procurement/reports/${kind}?format=xlsx`, { headers: { Cookie: cookie } });
    assert.strictEqual(res.status, 200, kind);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
  }
});
