// 倉庫（總倉／小倉）與分倉庫存整合測試：
// 建倉 → 驗貨入庫進總倉 → 調撥到小倉 → 出貨從指定倉扣 → 商城商品綁小倉後賣出扣小倉。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB = path.join('/tmp', `mamacare-wh-${process.pid}.db`);
let PORT, BASE, server, cookie = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = require('node:net').createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
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
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
});
after(() => { if (server) server.kill('SIGKILL'); cleanDb(); });

let mainWh, shopWh, otherCo, otherWh, vendor, item;

test('倉庫主檔：系統自動建預設總倉，可在總倉底下開小倉、也可為關係企業另開總倉', async () => {
  const first = await ok('GET', '/api/procurement/warehouses');
  const def = first.rows.find(w => w.id === first.default_id);
  assert.ok(def, '應該有預設總倉');
  assert.strictEqual(def.kind, 'main');
  mainWh = def.id;
  // 小倉一定要指定所屬總倉
  const bad = await req('POST', '/api/procurement/warehouses', { name: '沒有總倉的小倉', kind: 'sub' });
  assert.strictEqual(bad.status, 400);
  shopWh = (await ok('POST', '/api/procurement/warehouses', {
    code: 'S01', name: '商城小倉', kind: 'sub', parent_id: mainWh, note: '商城商品的庫存倉'
  })).id;
  // 關係企業：另一家公司、另一個總倉
  otherCo = (await ok('POST', '/api/procurement/companies', { name: '嘉禾關係企業' })).id;
  otherWh = (await ok('POST', '/api/procurement/warehouses', { code: 'W02', name: '嘉禾總倉', kind: 'main', company_id: otherCo })).id;
  const list = await ok('GET', '/api/procurement/warehouses');
  const shop = list.rows.find(w => w.id === shopWh);
  assert.strictEqual(shop.parent_name, def.name);
  assert.strictEqual(list.rows.find(w => w.id === otherWh).company_name, '嘉禾關係企業');
});

test('驗貨入庫指定倉庫：庫存只進那一個倉，總量等於各倉合計', async () => {
  vendor = (await ok('POST', '/api/procurement/vendors', { name: '倉測廠商' })).id;
  item = (await ok('POST', '/api/procurement/items', {
    code: 'WH001', name: '倉測衛生紙', unit: '箱', safety_stock: 2, price: 100,
    vendors: [{ vendor_id: vendor, is_default: true }]
  })).id;
  const pr = await ok('POST', '/api/procurement/requests', { requester: '倉管', items: [{ supply_id: item, qty: 30 }] });
  await ok('POST', `/api/procurement/requests/${pr.id}/approve`, {});
  const prd = await ok('GET', `/api/procurement/requests/${pr.id}`);
  const po = (await ok('POST', `/api/procurement/requests/${pr.id}/order`, {
    items: [{ item_id: prd.items[0].id, vendor_id: vendor, eta: D(1) }]
  })).orders[0];
  const pod = await ok('GET', `/api/procurement/orders/${po.id}`);
  await ok('PUT', `/api/procurement/orders/${po.id}`, { budget_amount: 5000, items: [{ id: pod.items[0].id, unit_price: 100 }] });
  await ok('POST', `/api/procurement/orders/${po.id}/approve`, {});
  const gr = await ok('POST', '/api/procurement/receipts', {
    po_id: po.id, inspector: '驗貨員', warehouse_id: mainWh, items: [{ po_item_id: pod.items[0].id, received_qty: 30 }]
  });
  assert.strictEqual(gr.warehouse_id, mainWh);
  const rows = (await ok('GET', '/api/procurement/items')).rows;
  const r = rows.find(x => x.id === item);
  assert.strictEqual(r.stock, 30);
  assert.deepStrictEqual(r.stocks.map(s => [s.warehouse_id, s.qty]), [[mainWh, 30]]);
});

let trfId;
test('調撥單：總倉 → 小倉，只換倉別不動總量；庫存不足會擋下', async () => {
  const over = await req('POST', '/api/procurement/transfers', {
    from_warehouse_id: mainWh, to_warehouse_id: shopWh, items: [{ supply_id: item, qty: 999 }]
  });
  assert.strictEqual(over.status, 400);
  assert.match(over.data.error, /庫存不足/);
  const same = await req('POST', '/api/procurement/transfers', {
    from_warehouse_id: mainWh, to_warehouse_id: mainWh, items: [{ supply_id: item, qty: 1 }]
  });
  assert.strictEqual(same.status, 400);
  const t = await ok('POST', '/api/procurement/transfers', {
    from_warehouse_id: mainWh, to_warehouse_id: shopWh, reason: '補商城庫存', items: [{ supply_id: item, qty: 12 }]
  });
  trfId = t.id;
  assert.match(t.no, /^TRF-\d{6}-0001$/);
  // 待調撥時庫存還沒動
  let r = (await ok('GET', '/api/procurement/items')).rows.find(x => x.id === item);
  assert.strictEqual(r.stocks.find(s => s.warehouse_id === shopWh), undefined);
  await ok('POST', `/api/procurement/transfers/${trfId}/confirm`, {});
  r = (await ok('GET', '/api/procurement/items')).rows.find(x => x.id === item);
  assert.strictEqual(r.stock, 30, '調撥不影響總庫存');
  assert.strictEqual(r.stocks.find(s => s.warehouse_id === mainWh).qty, 18);
  assert.strictEqual(r.stocks.find(s => s.warehouse_id === shopWh).qty, 12);
  // 已確認的不能再改、也不能重複確認
  assert.strictEqual((await req('POST', `/api/procurement/transfers/${trfId}/confirm`, {})).status, 400);
  assert.strictEqual((await req('PUT', `/api/procurement/transfers/${trfId}`, { reason: 'x' })).status, 400);
  const detail = await ok('GET', `/api/procurement/transfers/${trfId}`);
  assert.strictEqual(detail.status, 'done');
  assert.strictEqual(detail.items[0].from_qty, 18);
  assert.strictEqual(detail.items[0].to_qty, 12);
});

test('出貨：從指定倉扣；該倉不夠就擋下（即使其他倉還有）', async () => {
  // 小倉只有 12，要出 20 → 擋
  const over = await req('POST', '/api/procurement/shipments', {
    recipient: '門市', warehouse_id: shopWh, items: [{ supply_id: item, qty: 20 }]
  });
  assert.strictEqual(over.status, 400);
  assert.match(over.data.error, /庫存不足/);
  const sh = await ok('POST', '/api/procurement/shipments', {
    recipient: '門市', warehouse_id: shopWh, items: [{ supply_id: item, qty: 5 }]
  });
  await ok('POST', `/api/procurement/shipments/${sh.id}/confirm`, {});
  const r = (await ok('GET', '/api/procurement/items')).rows.find(x => x.id === item);
  assert.strictEqual(r.stock, 25);
  assert.strictEqual(r.stocks.find(s => s.warehouse_id === shopWh).qty, 7);
  assert.strictEqual(r.stocks.find(s => s.warehouse_id === mainWh).qty, 18);
});

test('倉庫停用：還有庫存不給停用，清空後才可以', async () => {
  const busy = await req('PUT', `/api/procurement/warehouses/${shopWh}`, { active: false });
  assert.strictEqual(busy.status, 400);
  assert.match(busy.data.error, /調撥出去/);
});

test('商城商品綁小倉：庫存就是小倉庫存，確認訂單扣的也是小倉', async () => {
  await ok('PUT', '/api/procurement/settings', { shop_warehouse_id: shopWh });
  const prod = await ok('POST', '/api/products', { name: '倉測衛生紙', price: 250, supply_id: item, warehouse_id: shopWh });
  let p = (await ok('GET', '/api/products')).find(x => x.id === prod.id);
  assert.strictEqual(p.stock, 7, '商城庫存＝小倉庫存');
  assert.strictEqual(p.track_stock, 1);
  // 再調撥 3 箱進小倉，商城庫存跟著變
  const t2 = await ok('POST', '/api/procurement/transfers', {
    from_warehouse_id: mainWh, to_warehouse_id: shopWh, items: [{ supply_id: item, qty: 3 }], confirm: true
  });
  assert.ok(t2.no);
  p = (await ok('GET', '/api/products')).find(x => x.id === prod.id);
  assert.strictEqual(p.stock, 10);
  // 下單並確認 → 扣小倉、總量也跟著少（代客下單要有在住的媽媽）
  const mother = (await ok('GET', '/api/mothers')).find(m => m.id);
  const order = await ok('POST', '/api/orders', { mother_id: mother.id, items: [{ product_id: prod.id, quantity: 4 }] });
  await ok('POST', `/api/orders/${order.id}/confirm`, {});
  const r = (await ok('GET', '/api/procurement/items')).rows.find(x => x.id === item);
  assert.strictEqual(r.stocks.find(s => s.warehouse_id === shopWh).qty, 6);
  assert.strictEqual(r.stock, 21);
  p = (await ok('GET', '/api/products')).find(x => x.id === prod.id);
  assert.strictEqual(p.stock, 6);
});

test('備品進出：進貨、領用、盤點都落在指定倉，總量永遠是各倉合計', async () => {
  await ok('POST', `/api/supplies/${item}/txns`, { txn_type: 'in', quantity: 4, warehouse_id: otherWh, reason: '關係企業進貨' });
  let r = (await ok('GET', '/api/procurement/items')).rows.find(x => x.id === item);
  assert.strictEqual(r.stocks.find(s => s.warehouse_id === otherWh).qty, 4);
  assert.strictEqual(r.stock, 25);
  // 該倉庫存不足不能領
  const over = await req('POST', `/api/supplies/${item}/txns`, { txn_type: 'out', quantity: 9, warehouse_id: otherWh });
  assert.strictEqual(over.status, 400);
  await ok('POST', `/api/supplies/${item}/txns`, { txn_type: 'adjust', quantity: 2, warehouse_id: otherWh, reason: '盤點' });
  r = (await ok('GET', '/api/procurement/items')).rows.find(x => x.id === item);
  assert.strictEqual(r.stocks.find(s => s.warehouse_id === otherWh).qty, 2);
  assert.strictEqual(r.stock, 23, '15（總倉）＋6（商城小倉）＋2（關係企業總倉）');
});
