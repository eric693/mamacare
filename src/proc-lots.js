// 庫存批次帳（進銷存報表用）
//
// 庫存數字的唯一來源仍是 supplies.stock／supply_txns（備品、採購、出貨、盤點都寫那裡）。
// 這裡把 supply_txns 逐筆「過帳」成批次：
//   進貨：同一品項＋同一廠商＋同一單價歸同一批；價格有變才開新批（批號 yyyymm01、yyyymm02…）
//   出貨／盤虧：從單價最低的批次先扣（便宜的先出），同價再依先進先出
//   盤盈：以品項參考單價併入（或新開）無廠商的批次
// 過帳記錄在 lot_moves，已過帳到哪一筆記在 proc_meta，重複呼叫只處理新異動。
// 過帳後逐品項比對「批次結餘」與 supplies.stock，不一致（例如直接改庫存、舊資料）就補一筆校正，
// 保證報表的期末數量永遠等於系統庫存。

const OPENING_DATE = '1900-01-01';   // 期初（系統導入前）庫存的過帳日，任何月份都算期初

function ensureLotSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS proc_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS stock_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_no TEXT NOT NULL UNIQUE,
      supply_id INTEGER NOT NULL REFERENCES supplies(id),
      vendor_id INTEGER REFERENCES vendors(id),
      unit_price REAL NOT NULL DEFAULT 0,
      first_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS lot_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id INTEGER NOT NULL REFERENCES stock_lots(id),
      supply_id INTEGER NOT NULL REFERENCES supplies(id),
      txn_id INTEGER REFERENCES supply_txns(id),
      move_type TEXT NOT NULL CHECK (move_type IN ('open','in','out','adjust')),
      qty INTEGER NOT NULL,
      move_date TEXT NOT NULL,
      note TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_lots_supply ON stock_lots(supply_id, unit_price);
    CREATE INDEX IF NOT EXISTS idx_lot_moves_lot ON lot_moves(lot_id, move_date);
    CREATE INDEX IF NOT EXISTS idx_lot_moves_txn ON lot_moves(txn_id);
  `);
  // 異動帶上單價、廠商與來源單據（採購作業寫入時填；舊資料由原因欄回推）
  const cols = db.prepare('PRAGMA table_info(supply_txns)').all().map(c => c.name);
  const add = (c, def) => { if (!cols.includes(c)) db.exec(`ALTER TABLE supply_txns ADD COLUMN ${c} ${def}`); };
  const fresh = !cols.includes('ref_type');
  add('unit_price', 'REAL');
  add('vendor_id', 'INTEGER REFERENCES vendors(id)');
  add('ref_type', "TEXT DEFAULT ''");
  add('ref_id', 'INTEGER');
  if (fresh) backfillRefs(db);
}

// 舊的採購異動只有「驗貨入庫 REC-…」「出貨 SHP-…」字樣，回推來源單據與單價
function backfillRefs(db) {
  const rows = db.prepare("SELECT id, supply_id, reason FROM supply_txns WHERE reason LIKE '驗貨入庫 %' OR reason LIKE '出貨 %'").all();
  for (const t of rows) {
    const rec = /^驗貨入庫 (\S+)/.exec(t.reason);
    if (rec) {
      const g = db.prepare(`SELECT g.id, o.vendor_id, gi.unit_price FROM goods_receipts g JOIN purchase_orders o ON o.id = g.po_id
        LEFT JOIN goods_receipt_items gi ON gi.gr_id = g.id AND gi.supply_id = ? WHERE g.no = ?`).get(t.supply_id, rec[1]);
      if (g) {
        // 付款時議價後的單價才是成交價，有就用
        const paid = db.prepare(`SELECT pi.unit_price FROM payment_request_items pi JOIN payment_requests p ON p.id = pi.pay_id
          JOIN goods_receipt_items gi ON gi.gr_id = pi.gr_id AND gi.item_name = pi.item_name
          WHERE pi.gr_id = ? AND gi.supply_id = ? AND p.status = 'paid' AND pi.unit_price > 0 ORDER BY pi.id DESC LIMIT 1`).get(g.id, t.supply_id);
        db.prepare("UPDATE supply_txns SET ref_type='receipt', ref_id=?, vendor_id=?, unit_price=? WHERE id=?")
          .run(g.id, g.vendor_id, paid ? paid.unit_price : g.unit_price, t.id);
      }
      continue;
    }
    const shp = /^出貨 (\S+)/.exec(t.reason);
    if (shp) {
      const s = db.prepare('SELECT id FROM shipments WHERE no = ?').get(shp[1]);
      if (s) db.prepare("UPDATE supply_txns SET ref_type='shipment', ref_id=? WHERE id=?").run(s.id, t.id);
    }
  }
}

function lotNo(db, date) {
  const ym = String(date).slice(0, 7).replace('-', '');
  const row = db.prepare('SELECT lot_no FROM stock_lots WHERE lot_no LIKE ? ORDER BY length(lot_no) DESC, lot_no DESC LIMIT 1').get(ym + '%');
  const seq = row ? (parseInt(row.lot_no.slice(6), 10) || 0) + 1 : 1;
  return ym + String(seq).padStart(2, '0');
}

const round2 = v => Math.round((Number(v) || 0) * 100) / 100;

function findOrCreateLot(db, supplyId, vendorId, price, date) {
  const p = round2(price);
  const lot = db.prepare('SELECT id FROM stock_lots WHERE supply_id = ? AND vendor_id IS ? AND unit_price = ? ORDER BY id LIMIT 1')
    .get(supplyId, vendorId || null, p);
  if (lot) return lot.id;
  // 期初批的批號取實際第一筆異動的月份
  const noDate = date === OPENING_DATE ? (db.prepare('SELECT MIN(created_at) d FROM supply_txns').get().d || new Date().toISOString()) : date;
  return db.prepare('INSERT INTO stock_lots (lot_no, supply_id, vendor_id, unit_price, first_date) VALUES (?,?,?,?,?)')
    .run(lotNo(db, noDate), supplyId, vendorId || null, p, date).lastInsertRowid;
}

const insMove = (db, lotId, supplyId, txnId, type, qty, date, note = '') =>
  db.prepare('INSERT INTO lot_moves (lot_id, supply_id, txn_id, move_type, qty, move_date, note) VALUES (?,?,?,?,?,?,?)')
    .run(lotId, supplyId, txnId, type, qty, date, note);

const ledgerBalance = (db, supplyId) =>
  db.prepare('SELECT COALESCE(SUM(qty),0) q FROM lot_moves WHERE supply_id = ?').get(supplyId).q;

// 扣庫存：便宜的批次先扣，同價先進先出；批次不夠（不應發生）就記在最後一批上，維持總數一致
function consume(db, supplyId, qty, txnId, type, date, note) {
  let left = qty;
  const lots = db.prepare(`SELECT l.id, COALESCE(SUM(m.qty),0) AS remain FROM stock_lots l
    LEFT JOIN lot_moves m ON m.lot_id = l.id WHERE l.supply_id = ?
    GROUP BY l.id HAVING remain > 0 ORDER BY l.unit_price, l.id`).all(supplyId);
  for (const l of lots) {
    if (left <= 0) break;
    const take = Math.min(left, l.remain);
    insMove(db, l.id, supplyId, txnId, type, -take, date, note);
    left -= take;
  }
  if (left > 0) {
    const last = db.prepare('SELECT id FROM stock_lots WHERE supply_id = ? ORDER BY unit_price, id LIMIT 1').get(supplyId)
      || { id: findOrCreateLot(db, supplyId, null, refPrice(db, supplyId), date) };
    insMove(db, last.id, supplyId, txnId, type, -left, date, note);
  }
}
const refPrice = (db, supplyId) => (db.prepare('SELECT price FROM supplies WHERE id = ?').get(supplyId) || {}).price || 0;

function addStock(db, supplyId, vendorId, price, qty, txnId, type, date, note) {
  const lotId = findOrCreateLot(db, supplyId, vendorId, price, date);
  insMove(db, lotId, supplyId, txnId, type, qty, date, note);
}

function vendorIdByName(db, name) {
  if (!name) return null;
  const v = db.prepare('SELECT id FROM vendors WHERE name = ? ORDER BY active DESC, id LIMIT 1').get(name);
  return v ? v.id : null;
}

function syncLots(db, today) {
  ensureLotSchema(db);
  const run = db.transaction(() => {
    const last = parseInt((db.prepare("SELECT value FROM proc_meta WHERE key = 'lots_last_txn'").get() || {}).value || '0', 10);
    const txns = db.prepare('SELECT * FROM supply_txns WHERE id > ? ORDER BY id').all(last);
    let maxId = last;
    for (const t of txns) {
      maxId = t.id;
      const date = String(t.created_at).slice(0, 10);
      const started = db.prepare('SELECT 1 FROM lot_moves WHERE supply_id = ? LIMIT 1').get(t.supply_id);
      if (!started) {
        // 這個品項第一次過帳：異動前的庫存當期初
        const before = t.txn_type === 'in' ? t.balance_after - t.quantity
          : t.txn_type === 'out' ? t.balance_after + t.quantity
          : t.balance_after;
        if (before > 0) addStock(db, t.supply_id, null, refPrice(db, t.supply_id), before, null, 'open', OPENING_DATE, '期初庫存');
      }
      if (t.txn_type === 'in') {
        const vendorId = t.vendor_id || vendorIdByName(db, t.vendor);
        const price = t.unit_price !== null && t.unit_price !== undefined ? t.unit_price : refPrice(db, t.supply_id);
        addStock(db, t.supply_id, vendorId, price, t.quantity, t.id, 'in', date, t.reason || '');
      } else if (t.txn_type === 'out') {
        consume(db, t.supply_id, t.quantity, t.id, 'out', date, t.reason || '');
      } else {
        const diff = t.balance_after - ledgerBalance(db, t.supply_id);
        if (diff > 0) addStock(db, t.supply_id, null, refPrice(db, t.supply_id), diff, t.id, 'adjust', date, '盤點調整');
        else if (diff < 0) consume(db, t.supply_id, -diff, t.id, 'adjust', date, '盤點調整');
      }
    }
    db.prepare("INSERT INTO proc_meta (key, value) VALUES ('lots_last_txn', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(maxId));
    // 校正：批次結餘必須等於系統庫存
    const drift = db.prepare(`SELECT s.id, s.stock, COALESCE((SELECT SUM(qty) FROM lot_moves m WHERE m.supply_id = s.id), 0) AS ledger
      FROM supplies s`).all().filter(r => r.stock !== r.ledger);
    for (const r of drift) {
      const hasMoves = db.prepare('SELECT 1 FROM lot_moves WHERE supply_id = ? LIMIT 1').get(r.id);
      const diff = r.stock - r.ledger;
      if (diff > 0) addStock(db, r.id, null, refPrice(db, r.id), diff, null, hasMoves ? 'adjust' : 'open', hasMoves ? today : OPENING_DATE, hasMoves ? '系統校正' : '期初庫存');
      else consume(db, r.id, -diff, null, 'adjust', today, '系統校正');
    }
  });
  run();
}

module.exports = { ensureLotSchema, syncLots, OPENING_DATE };
