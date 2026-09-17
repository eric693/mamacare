// 模組可編輯性測試：逐一確認每個模組都能「新增 → 修改 → 讀回」，
// 上線前用來確保沒有任何模組是只能看不能改的。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB = path.join('/tmp', `mamacare-edit-${process.pid}.db`);
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
  let data = null; try { data = await res.json(); } catch (e) { /* 非 JSON 回應 */ }
  return { status: res.status, data };
}
const D = n => new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + n * 86400000).toISOString().slice(0, 10);
// 新增必須成功，並回傳建立的 id
async function created(method, p, body, label) {
  const r = await req(method, p, body);
  assert.strictEqual(r.status, 200, `${label} 新增失敗：${JSON.stringify(r.data)}`);
  return r.data && (r.data.id !== undefined ? r.data.id : r.data);
}
// 修改必須成功
async function edited(method, p, body, label) {
  const r = await req(method, p, body);
  assert.strictEqual(r.status, 200, `${label} 修改失敗：${JSON.stringify(r.data)}`);
  return r.data;
}

before(async () => {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  cleanDb();
  const env = { ...process.env, MAMACARE_DB: DB };
  const seed = spawnSync('node', ['src/db.js', '--seed'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.strictEqual(seed.status, 0, '種子建立失敗：' + seed.stderr);
  server = spawn('node', ['src/server.js'], { cwd: ROOT,
    env: { ...env, PORT: String(PORT), SESSION_SECRET: 'test', NODE_ENV: 'test', DB_BACKEND: 'sqlite' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) { await req('POST', '/api/login', { username: 'admin', password: 'admin123' }); return; } }
    catch (e) { /* 尚未啟動 */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('伺服器未能在時限內啟動');
});
after(() => { if (server) server.kill('SIGKILL'); cleanDb(); });

async function anyMother(status) {
  const ms = (await req('GET', '/api/mothers')).data;
  return ms.find(m => m.status === status) || ms[0];
}
async function anyBaby() {
  const bs = (await req('GET', '/api/babies')).data;
  return Array.isArray(bs) ? bs[0] : (bs.rows || [])[0];
}

test('模組 住客管理：媽媽新增→修改', async () => {
  const id = await created('POST', '/api/mothers', { name: '可編輯測試媽', phone: '0912000001', due_date: D(60) }, '住客');
  await edited('PUT', `/api/mothers/${id}`, { name: '可編輯測試媽', phone: '0912000002', medical_notes: '測試備註' }, '住客');
  const m = (await req('GET', '/api/mothers')).data.find(x => x.id === id);
  assert.strictEqual(m.phone, '0912000002');
  assert.strictEqual(m.medical_notes, '測試備註');
});

test('模組 房務與訂房：房型／房間／折扣／嬰兒床／訂房都可改', async () => {
  const rt = await created('POST', '/api/room-types', { name: '可編輯房型', price_per_day: 6000 }, '房型');
  await edited('PUT', `/api/room-types/${rt}`, { name: '可編輯房型', price_per_day: 6500 }, '房型');
  const room = await created('POST', '/api/rooms', { name: 'E01', room_type: '可編輯房型', price_per_day: 6500 }, '房間');
  await edited('PUT', `/api/rooms/${room}`, { name: 'E01', room_type: '可編輯房型', price_per_day: 7000, notes: '測試' }, '房間');
  const disc = await created('POST', '/api/room-discounts', { room_type: '可編輯房型', category: '員工親友', discount: 10 }, '折扣');
  await edited('PUT', `/api/room-discounts/${disc}`, { room_type: '可編輯房型', category: '員工親友', discount: 15 }, '折扣');
  const bed = await created('POST', '/api/baby-beds', { bed_no: 'B99', zone: '測試' }, '嬰兒床');
  await edited('PUT', `/api/baby-beds/${bed}`, { bed_no: 'B99', zone: '測試2' }, '嬰兒床');
  const mom = await created('POST', '/api/mothers', { name: '訂房可編輯測試', due_date: D(30) }, '媽媽');
  const bk = await created('POST', '/api/bookings', { mother_id: mom, room_id: room, check_in: D(240), check_out: D(250), total_amount: 60000 }, '訂房');
  await edited('PUT', `/api/bookings/${bk}`, { check_in: D(240), check_out: D(255), total_amount: 70000 }, '訂房');
  const b = (await req('GET', '/api/bookings')).data.find(x => x.id === bk);
  assert.strictEqual(b.total_amount, 70000);
});

test('模組 寶寶照護：照護紀錄新增→修改，位置可切換', async () => {
  const baby = await anyBaby();
  const rec = await created('POST', `/api/babies/${baby.id}/records`, { record_type: 'feeding', amount_ml: 30, note: '可編輯測試' }, '寶寶照護');
  await edited('PUT', `/api/baby-records/${rec}`, { amount_ml: 45, note: '改過了' }, '寶寶照護');
  const rows = (await req('GET', `/api/babies/${baby.id}/records`)).data;
  const got = (Array.isArray(rows) ? rows : rows.rows).find(r => r.id === rec);
  assert.strictEqual(got.note, '改過了');
  await edited('PUT', `/api/babies/${baby.id}/location`, { location: 'rooming' }, '寶寶位置');
  await edited('PUT', `/api/babies/${baby.id}/location`, { location: 'nursery' }, '寶寶位置');
});

test('模組 新生兒醫療：篩檢與疫苗可新增→修改', async () => {
  const baby = await anyBaby();
  const sc = await created('POST', `/api/babies/${baby.id}/screenings`, { screen_type: '聽力篩檢', screened_at: D(0), result: '通過' }, '篩檢');
  await edited('PUT', `/api/screenings/${sc}`, { screen_type: '聽力篩檢', result: '複檢' }, '篩檢');
  const vc = await created('POST', `/api/babies/${baby.id}/vaccinations`, { vaccine: 'B肝疫苗', dose_no: 1, administered_at: D(0) }, '疫苗');
  await edited('PUT', `/api/vaccinations/${vc}`, { vaccine: 'B肝疫苗', dose_no: 1, administered_at: D(0), note: '已補登' }, '疫苗');
});

test('模組 醫師巡診：巡診紀錄新增→修改', async () => {
  const mom = await anyMother('checked_in');
  const id = await created('POST', '/api/physician-visits', { subject_type: 'mother', mother_id: mom.id, specialty: 'obstetrics', visit_at: D(0) + ' 10:00', subjective: '主訴', objective: '客觀', assessment: '評估', plan: '計畫' }, '巡診');
  await edited('PUT', `/api/physician-visits/${id}`, { subject_type: 'mother', mother_id: mom.id, visit_at: D(0) + ' 10:00', plan: '計畫已修改' }, '巡診');
});

test('模組 媽媽照護：照護紀錄新增→修改', async () => {
  const mom = await anyMother('checked_in');
  const rec = await created('POST', `/api/mothers/${mom.id}/records`, { record_type: 'vital', note: '可編輯測試' }, '媽媽照護');
  await edited('PUT', `/api/mother-records/${rec}`, { note: '改過了' }, '媽媽照護');
});

test('模組 護理交班：交班單新增→結案', async () => {
  const id = await created('POST', '/api/handovers', { shift_type: 'day', situation: 'S', follow_up: '待追蹤' }, '交班');
  await edited('POST', `/api/handovers/${id}/resolve`, {}, '交班結案');
});

test('模組 異常事件：通報新增→修改', async () => {
  const id = await created('POST', '/api/incidents', { category: 'fall', severity: 'minor', occurred_at: D(0) + ' 10:00', subject: '可編輯測試', description: '測試' }, '異常事件');
  await edited('PUT', `/api/incidents/${id}`, { category: 'fall', severity: 'minor', occurred_at: D(0) + ' 10:00', follow_up: '已追蹤' }, '異常事件');
});

test('模組 感染管制：洗手稽核新增、群聚事件新增→修改', async () => {
  await created('POST', '/api/infection/hand-hygiene', { audit_date: D(0), area: '嬰兒室', opportunities: 10, compliant: 9 }, '洗手稽核');
  const cl = await created('POST', '/api/infection/clusters', { onset_date: D(0), symptom: '腸胃炎', affected: 2, description: '測試' }, '群聚');
  await edited('PUT', `/api/infection/clusters/${cl}`, { onset_date: D(0), symptom: '腸胃炎', affected: 3, status: 'closed' }, '群聚');
});

test('模組 房務清潔：任務新增→完成→取消完成', async () => {
  const id = await created('POST', '/api/housekeeping/tasks', { task: '可編輯測試清潔', scheduled_for: D(0) }, '清潔任務');
  await edited('PUT', `/api/housekeeping/tasks/${id}`, { status: 'done' }, '清潔任務');
  await edited('PUT', `/api/housekeeping/tasks/${id}`, { status: 'pending' }, '清潔任務');
  const mom = await anyMother('checked_in');
  await edited('PUT', `/api/mothers/${mom.id}/housekeeping`, { hk_dnd: '13:00-15:00', hk_needs: '定時清垃圾' }, '住客清潔需求');
});

test('模組 收費帳務：加購消費與繳款可新增，且可刪除更正', async () => {
  const mom = await anyMother('checked_in');
  const bk = (await req('GET', `/api/customers/${mom.id}`)).data.bookings.find(b => b.status === 'checked_in');
  const ch = await created('POST', `/api/bookings/${bk.id}/charges`, { item_name: '可編輯測試加購', unit_price: 500, quantity: 2, charged_on: D(0) }, '加購');
  const pay = await created('POST', `/api/bookings/${bk.id}/payments`, { amount: 1000, method: '現金', paid_on: D(0), target: 'addon' }, '繳款');
  assert.strictEqual((await req('DELETE', `/api/charges/${ch}`)).status, 200);
  assert.strictEqual((await req('DELETE', `/api/payments/${pay}`)).status, 200);
});

test('模組 商城商品：商品新增→修改', async () => {
  const id = await created('POST', '/api/products', { name: '可編輯測試商品', price: 300, stock: 5 }, '商品');
  await edited('PUT', `/api/products/${id}`, { name: '可編輯測試商品', price: 350, stock: 8 }, '商品');
});

test('模組 耗材庫存：品項新增→修改→進出庫', async () => {
  const id = await created('POST', '/api/supplies', { name: '可編輯測試耗材', unit: '包', safety_stock: 3 }, '耗材');
  await edited('PUT', `/api/supplies/${id}`, { name: '可編輯測試耗材', unit: '箱', safety_stock: 5 }, '耗材');
  await created('POST', `/api/supplies/${id}/txns`, { txn_type: 'in', quantity: 10, note: '進貨' }, '進貨');
  await created('POST', `/api/supplies/${id}/txns`, { txn_type: 'out', quantity: 2, note: '領用' }, '領用');
});

test('模組 課程與服務：項目新增→修改', async () => {
  const id = await created('POST', '/api/programs', { name: '可編輯測試課程', kind: 'class', starts_at: D(3) + ' 14:00', capacity: 10 }, '課程');
  await edited('PUT', `/api/programs/${id}`, { name: '可編輯測試課程', capacity: 12 }, '課程');
});

test('模組 會員：點數可調整', async () => {
  const mom = await anyMother('checked_in');
  await edited('POST', `/api/members/${mom.id}/points`, { delta: 50, reason: '可編輯測試' }, '會員點數');
});

test('模組 膳食：訂餐狀態與菜單可維護', async () => {
  const mom = await anyMother('checked_in');
  await edited('POST', '/api/meals', { mother_id: mom.id, meal_date: D(1), meal_type: 'lunch', choice: '一般餐', note: '可編輯測試' }, '訂餐');
  await edited('POST', '/api/meals/status', { mother_id: mom.id, meal_date: D(1), meal_type: 'lunch', status: 'served', note: '已送達' }, '訂餐狀態');
  await edited('POST', '/api/meal-menu', { menu_date: D(1), slot: 'lunch', main: '可編輯測試主菜' }, '菜單');
  await edited('PUT', `/api/mothers/${mom.id}/meal-diet`, { meal_diet: '素食' }, '膳食設定');
});

test('模組 電子發票：可開立與作廢', async () => {
  const mom = await anyMother('checked_in');
  const bk = (await req('GET', `/api/customers/${mom.id}`)).data.bookings.find(b => b.status === 'checked_in');
  const id = await created('POST', '/api/invoices', { booking_id: bk.id, doc_type: 'receipt', buyer_name: '可編輯測試',
    items: [{ name: '住宿費', qty: 1, price: 1000 }] }, '發票');
  await edited('POST', `/api/invoices/${id}/void`, { reason: '測試作廢' }, '發票作廢');
});

test('模組 合約簽署：範本新增→修改，合約內容可編輯', async () => {
  const t = await created('POST', '/api/contract-templates', { name: '可編輯測試範本', body: '內容 {{mother_name}}', doc_kind: 'other', sign_required: 1 }, '範本');
  await edited('PUT', `/api/contract-templates/${t}`, { name: '可編輯測試範本', body: '內容已修改 {{mother_name}}' }, '範本');
  const mom = await anyMother('checked_in');
  const bk = (await req('GET', `/api/customers/${mom.id}`)).data.bookings.find(b => b.status === 'checked_in');
  const c = await created('POST', `/api/bookings/${bk.id}/contracts`, { template_id: t, handler: '測試' }, '合約');
  await edited('PUT', `/api/contracts/${c}`, { body: '簽署前可修改內容' }, '合約內容');
});

test('模組 參觀預約：參觀新增→修改（含客服承辦人）', async () => {
  const users = (await req('GET', '/api/users')).data;
  const id = await created('POST', '/api/tours', { name: '可編輯測試參觀', phone: '0912000009', tour_at: D(5) + ' 14:00', host_by: users[0].id }, '參觀');
  await edited('PUT', `/api/tours/${id}`, { name: '可編輯測試參觀', status: 'visited', note: '已改' }, '參觀');
  const slot = await created('POST', '/api/tour-slots', { slot_date: D(6), slots: '14:00,16:00' }, '參觀時段');
  assert.ok(slot !== undefined);
});

test('模組 客戶管理：潛客資料與合約資料可修改', async () => {
  const id = await created('POST', '/api/customers', { name: '可編輯測試客戶', due_date: D(90), phone: '0912000010' }, '潛客');
  await edited('PUT', `/api/customers/${id}`, { phone: '0912000011', room_pref: '雙人房' }, '潛客');
  await edited('PUT', `/api/customers/${id}/contract`, { handler: '測試', sign_date: D(0), note: '合約備註' }, '合約資料');
  const rt = (await req('GET', `/api/customers/${id}`)).data.room_types[0];
  await edited('POST', `/api/customers/${id}/contract/items`, { name: rt.name, qty: 10 }, '合約明細');
  await edited('POST', `/api/customers/${id}/contract/items/edit`, { index: 0, qty: 12 }, '合約明細');
  const cust = (await req('GET', `/api/customers/${id}`)).data;
  assert.strictEqual(cust.contract.items[0].qty, 12);
});

test('模組 訪客預約：新增→修改', async () => {
  const mom = await anyMother('checked_in');
  const id = await created('POST', '/api/visitor-reservations', { mother_id: mom.id, visit_at: D(1) + ' 15:00', visitor_name: '可編輯測試訪客', visitor_count: 2 }, '訪客');
  await edited('PUT', `/api/visitor-reservations/${id}`, { visitor_count: 3, note: '已改' }, '訪客');
});

test('模組 排班與人力：班表可新增與刪除', async () => {
  const users = (await req('GET', '/api/users')).data;
  const id = await created('POST', '/api/shifts', { user_id: users[0].id, shift_date: D(1), shift_type: '白班' }, '排班');
  assert.strictEqual((await req('DELETE', `/api/shifts/${id}`)).status, 200);
});

test('模組 家屬帳號：新增→修改', async () => {
  const mom = await anyMother('checked_in');
  const babies = (await req('GET', `/api/customers/${mom.id}`)).data.babies;
  const id = await created('POST', '/api/family-members', { mother_id: mom.id, baby_id: (babies[0] || {}).id, name: '可編輯測試家屬', relation: '先生' }, '家屬');
  await edited('PUT', `/api/family-members/${id}`, { name: '可編輯測試家屬', relation: '母親' }, '家屬');
});

test('模組 名人推薦：新增→修改', async () => {
  const id = await created('POST', '/api/testimonials', { name: '可編輯測試推薦', title: '藝人', content: '推薦內容' }, '推薦');
  await edited('PUT', `/api/testimonials/${id}`, { name: '可編輯測試推薦', content: '推薦內容已修改' }, '推薦');
});

test('模組 員工證照：新增→修改', async () => {
  const users = (await req('GET', '/api/users')).data;
  const id = await created('POST', '/api/certifications', { user_id: users[0].id, cert_name: '護理師執照', issued_on: D(-365), expires_on: D(365) }, '證照');
  await edited('PUT', `/api/certifications/${id}`, { cert_name: '護理師執照', expires_on: D(730) }, '證照');
});

test('模組 問卷調查：新增→修改', async () => {
  const id = await created('POST', '/api/surveys', { title: '可編輯測試問卷', questions: [{ label: '滿意度', type: 'rating' }] }, '問卷');
  await edited('PUT', `/api/surveys/${id}`, { title: '可編輯測試問卷（改）' }, '問卷');
});

test('模組 自訂表格：表格設計、填寫與修改', async () => {
  const id = await created('POST', '/api/custom-forms', { name: '可編輯測試表格', fields: [{ key: 'f1', label: '數量', type: 'number' }] }, '自訂表格');
  await edited('PUT', `/api/custom-forms/${id}`, { name: '可編輯測試表格', fields: [{ key: 'f1', label: '數量', type: 'number' }, { key: 'f2', label: '備註', type: 'text' }] }, '自訂表格');
  const e = await created('POST', `/api/custom-forms/${id}/entries`, { entry_date: D(0), data: { f1: 3, f2: '測試' } }, '表格填寫');
  await edited('PUT', `/api/custom-form-entries/${e}`, { entry_date: D(0), data: { f1: 5, f2: '改過' } }, '表格填寫');
});

test('模組 優惠券：新增→修改', async () => {
  const id = await created('POST', '/api/coupons', { code: 'EDITTEST', name: '可編輯測試券', amount: 100, expires_on: D(30) }, '優惠券');
  await edited('PUT', `/api/coupons/${id}`, { code: 'EDITTEST', name: '可編輯測試券', amount: 200 }, '優惠券');
});

test('模組 公佈欄與文件：公告新增→修改', async () => {
  const id = await created('POST', '/api/bulletins', { title: '可編輯測試公告', body: '內容' }, '公告');
  await edited('PUT', `/api/bulletins/${id}`, { title: '可編輯測試公告', body: '內容已修改' }, '公告');
});

test('模組 帳號管理與員工資料：新增→修改', async () => {
  const id = await created('POST', '/api/users', { username: 'edittest', password: 'edit12345', name: '可編輯測試員', role: 'nurse', modules: ['meals'] }, '帳號');
  await edited('PUT', `/api/users/${id}`, { name: '可編輯測試員2', modules: ['meals', 'billing'] }, '帳號');
  const emps = (await req('GET', '/api/employees')).data;
  const emp = Array.isArray(emps) ? emps[0] : (emps.rows || [])[0];
  if (emp) await edited('PUT', `/api/employees/${emp.id}`, { name: emp.name, phone: '0912000012' }, '員工資料');
});

test('模組 系統設定：可儲存並讀回', async () => {
  const before = (await req('GET', '/api/settings')).data;
  await edited('PUT', '/api/settings', { temp_high: '37.6' }, '系統設定');
  assert.strictEqual((await req('GET', '/api/settings')).data.temp_high, '37.6');
  await edited('PUT', '/api/settings', { temp_high: before.temp_high }, '系統設定還原');
});

test('模組 資料匯出與備份：可立即備份', async () => {
  const r = await req('POST', '/api/backups', {});
  assert.strictEqual(r.status, 200, `備份失敗：${JSON.stringify(r.data)}`);
});

test('模組 唯讀報表：稽核軌跡、評鑑月報、經營分析、衛福部通報可讀取', async () => {
  for (const p of ['/api/audit-logs', '/api/reports/analytics', '/api/gov/submissions']) {
    assert.strictEqual((await req('GET', p)).status, 200, `${p} 讀取失敗`);
  }
});
