// 倉庫與分倉庫存
//
// 一家公司（proc_companies）底下有「總倉」，總倉底下掛「小倉」。
// 品項（supplies）還是同一份主檔，庫存改成「品項 × 倉庫」各記一筆（supply_stocks），
// supplies.stock 維持為「各倉合計」，所以備品庫存管理、盤點、進銷存報表看到的數字不變。
//
// 倉別之間搬貨走「調撥單」（stock_transfers）：只動分倉數量，總量不變，
// 因此不寫 supply_txns（不然進銷存報表會多出一進一出的假帳）。

function ensureWarehouseSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES proc_companies(id),
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('main','sub')),
      parent_id INTEGER REFERENCES warehouses(id),
      is_default INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS supply_stocks (
      supply_id INTEGER NOT NULL REFERENCES supplies(id),
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      qty INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (supply_id, warehouse_id)
    );
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no TEXT NOT NULL UNIQUE,
      transfer_date TEXT NOT NULL,
      from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      reason TEXT DEFAULT '',
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      done_by INTEGER REFERENCES users(id),
      done_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS stock_transfer_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id),
      supply_id INTEGER NOT NULL REFERENCES supplies(id),
      item_name TEXT NOT NULL,
      unit TEXT DEFAULT '',
      qty INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supply_stocks_wh ON supply_stocks(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_transfer_items ON stock_transfer_items(transfer_id);
    CREATE INDEX IF NOT EXISTS idx_warehouses_co ON warehouses(company_id, active);
  `);
  // 異動紀錄記下發生在哪個倉
  const cols = db.prepare('PRAGMA table_info(supply_txns)').all().map(c => c.name);
  if (!cols.includes('warehouse_id')) db.exec('ALTER TABLE supply_txns ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id)');
  // 商城商品綁到某個倉的某個品項（綁定後商城庫存就是那個倉的庫存，不再另記一份）
  const pCols = db.prepare('PRAGMA table_info(products)').all().map(c => c.name);
  if (!pCols.includes('supply_id')) {
    db.exec('ALTER TABLE products ADD COLUMN supply_id INTEGER REFERENCES supplies(id)');
    db.exec('ALTER TABLE products ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id)');
  }
  seedWarehouses(db);
}

// 第一次啟用：每家採購公司開一個總倉；既有品項的「倉庫別」文字各開一個小倉，
// 現有庫存就放進該品項原本的倉庫別（沒填的放總倉），數字不會變。
function seedWarehouses(db) {
  if (db.prepare('SELECT 1 FROM warehouses LIMIT 1').get()) return;
  const cos = db.prepare('SELECT id, name, is_default FROM proc_companies ORDER BY is_default DESC, sort_order, id').all();
  if (!cos.length) return;
  const insWh = db.prepare(`INSERT INTO warehouses (company_id, code, name, kind, parent_id, is_default, sort_order, note)
    VALUES (?,?,?,?,?,?,?,?)`);
  let mainOfDefault = null;
  cos.forEach((c, i) => {
    const id = insWh.run(c.id, 'W' + String(i + 1).padStart(2, '0'), `${c.name}總倉`, 'main', null, i === 0 ? 1 : 0, i, '系統建立').lastInsertRowid;
    if (i === 0) mainOfDefault = id;
  });
  // 既有的倉庫別文字 → 預設公司總倉底下的小倉
  const names = db.prepare("SELECT DISTINCT TRIM(warehouse) w FROM supplies WHERE TRIM(COALESCE(warehouse,'')) != '' ORDER BY w").all();
  const subOf = new Map();
  names.forEach((r, i) => {
    const id = insWh.run(cos[0].id, 'S' + String(i + 1).padStart(2, '0'), r.w, 'sub', mainOfDefault, 0, i + 1, '由原本的倉庫別轉入').lastInsertRowid;
    subOf.set(r.w, id);
  });
  const insQty = db.prepare('INSERT INTO supply_stocks (supply_id, warehouse_id, qty) VALUES (?,?,?)');
  for (const s of db.prepare("SELECT id, stock, TRIM(COALESCE(warehouse,'')) w FROM supplies").all()) {
    insQty.run(s.id, subOf.get(s.w) || mainOfDefault, s.stock);
  }
  // 舊的異動紀錄回填倉別，之後查進出明細才看得出來是哪個倉
  db.prepare(`UPDATE supply_txns SET warehouse_id = (SELECT COALESCE(
      (SELECT ss.warehouse_id FROM supply_stocks ss WHERE ss.supply_id = supply_txns.supply_id LIMIT 1), ?))
    WHERE warehouse_id IS NULL`).run(mainOfDefault);
}

const activeWarehouses = db => db.prepare(`SELECT w.*, c.name AS company_name,
    (SELECT name FROM warehouses p WHERE p.id = w.parent_id) AS parent_name
  FROM warehouses w LEFT JOIN proc_companies c ON c.id = w.company_id
  WHERE w.active = 1 ORDER BY w.company_id, w.kind DESC, w.sort_order, w.id`).all();

// 預設倉：指定公司的預設總倉 → 該公司任一總倉 → 系統預設總倉
function defaultWarehouseId(db, companyId) {
  const byCo = companyId && db.prepare(`SELECT id FROM warehouses WHERE company_id = ? AND active = 1 AND kind = 'main'
    ORDER BY is_default DESC, sort_order, id LIMIT 1`).get(companyId);
  if (byCo) return byCo.id;
  const any = db.prepare(`SELECT id FROM warehouses WHERE active = 1 AND kind = 'main'
    ORDER BY is_default DESC, sort_order, id LIMIT 1`).get();
  return any ? any.id : null;
}

const warehouseQty = (db, supplyId, warehouseId) =>
  (db.prepare('SELECT qty FROM supply_stocks WHERE supply_id = ? AND warehouse_id = ?').get(supplyId, warehouseId) || {}).qty || 0;

// 分倉加減，並把 supplies.stock 重算成各倉合計（總量才是全系統共用的那個數字）
function addWarehouseQty(db, supplyId, warehouseId, delta) {
  db.prepare(`INSERT INTO supply_stocks (supply_id, warehouse_id, qty) VALUES (?,?,?)
    ON CONFLICT(supply_id, warehouse_id) DO UPDATE SET qty = qty + excluded.qty`).run(supplyId, warehouseId, delta);
  return recalcSupplyStock(db, supplyId);
}
// 綁到這個品項的商城商品：庫存直接等於它所屬那個倉的數量（商城不另記一份）
function syncBoundProducts(db, supplyId) {
  for (const p of db.prepare('SELECT id, warehouse_id FROM products WHERE supply_id = ?').all(supplyId)) {
    if (!p.warehouse_id) continue;
    db.prepare('UPDATE products SET stock = ?, track_stock = 1 WHERE id = ?')
      .run(warehouseQty(db, supplyId, p.warehouse_id), p.id);
  }
}
// 盤點：直接把某個倉設成實際數量
function setWarehouseQty(db, supplyId, warehouseId, qty) {
  db.prepare(`INSERT INTO supply_stocks (supply_id, warehouse_id, qty) VALUES (?,?,?)
    ON CONFLICT(supply_id, warehouse_id) DO UPDATE SET qty = excluded.qty`).run(supplyId, warehouseId, qty);
  return recalcSupplyStock(db, supplyId);
}
function recalcSupplyStock(db, supplyId) {
  const total = db.prepare('SELECT COALESCE(SUM(qty),0) q FROM supply_stocks WHERE supply_id = ?').get(supplyId).q;
  db.prepare('UPDATE supplies SET stock = ? WHERE id = ?').run(total, supplyId);
  syncBoundProducts(db, supplyId);
  return total;
}
// 品項目前主要存放的倉（庫存最多的那個；都沒有就用預設總倉）
function mainWarehouseOf(db, supplyId) {
  const row = db.prepare(`SELECT warehouse_id FROM supply_stocks ss JOIN warehouses w ON w.id = ss.warehouse_id
    WHERE ss.supply_id = ? AND w.active = 1 ORDER BY ss.qty DESC, w.kind DESC, w.id LIMIT 1`).get(supplyId);
  return row ? row.warehouse_id : defaultWarehouseId(db, null);
}
// 商城出貨倉（採購設定指定；沒設就用預設總倉）
function shopWarehouseId(db) {
  const v = (db.prepare("SELECT value FROM settings WHERE key = 'shop_warehouse_id'").get() || {}).value;
  const id = Number(v) || 0;
  if (id && db.prepare('SELECT 1 FROM warehouses WHERE id = ? AND active = 1').get(id)) return id;
  return defaultWarehouseId(db, null);
}

module.exports = {
  ensureWarehouseSchema, activeWarehouses, defaultWarehouseId, warehouseQty,
  addWarehouseQty, setWarehouseQty, recalcSupplyStock, mainWarehouseOf, shopWarehouseId, syncBoundProducts
};
