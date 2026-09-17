// 採購作業：請購 → 採購 → 驗貨入庫 → 請款，以及出貨／領料、廠商管理。
//
// 庫存不另立一份：品項就是既有的「備品」（supplies），驗貨入庫與出貨都寫 supply_txns，
// 所以備品庫存管理、盤點、進出明細看到的是同一個數字。
//
// 權限分三層（由 server.js 的 MODULE_RULES 先擋「完全沒有採購權限」的人）：
//   purchasing          建請購單、將已核准請購單建成採購單、驗貨入庫、出貨／領料
//   purchasing_approve  核准請購、改採購單價、維護廠商與品項
//   payables            請款單填金額與付款
const express = require('express');

const PREFIX = { pr: 'PR', po: 'PO', gr: 'REC', pay: 'PAY', ship: 'SHP', pick: 'PICK' };
const PR_STATUS = ['pending', 'approved', 'ordered', 'cancelled'];
const PAY_METHODS = ['銀行轉帳', '支票', '現金', '其他'];

module.exports = function procurementRouter({ db, requireStaff, logAudit, getSettings, today }) {
  ensureSchema(db);
  const router = express.Router();

  // ---------- 共用 ----------
  function can(req, mod) {
    const u = req.session.user;
    return u.role === 'admin' || (Array.isArray(u.permissions) && u.permissions.includes(mod));
  }
  const need = mod => (req, res, next) => (can(req, mod) ? next()
    : res.status(403).json({ error: `您沒有「${MOD_LABEL[mod]}」的權限` }));
  const MOD_LABEL = { purchasing: '採購作業', purchasing_approve: '採購核准', payables: '請款付款' };

  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const str = (v, max = 200) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);
  const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

  // 單號：前綴-年月-4 碼流水（每月重新起算）
  function nextNo(table, kind, date) {
    const ym = String(date || today()).slice(0, 7).replace('-', '');
    const head = `${PREFIX[kind]}-${ym}-`;
    const row = db.prepare(`SELECT no FROM ${table} WHERE no LIKE ? ORDER BY no DESC LIMIT 1`).get(head + '%');
    const seq = row ? (parseInt(row.no.slice(head.length), 10) || 0) + 1 : 1;
    return head + String(seq).padStart(4, '0');
  }

  // 付款條件字串中的天數（月結30天 → 30）；貨到付款／預付款視為 0 天
  function termDays(terms) {
    const m = /(\d+)/.exec(terms || '');
    if (m) return parseInt(m[1], 10);
    return /貨到|預付/.test(terms || '') ? 0 : 30;
  }
  function addDays(date, days) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // 庫存異動（與既有 /api/supplies/:id/txns 同一套寫法，交易內呼叫）
  function stockMove(supplyId, type, qty, userId, extra = {}) {
    const cur = db.prepare('SELECT id, name, stock FROM supplies WHERE id = ?').get(supplyId);
    if (!cur) throw httpErr(`找不到品項（#${supplyId}）`);
    let balance;
    if (type === 'in') balance = cur.stock + qty;
    else {
      if (cur.stock < qty) throw httpErr(`庫存不足：${cur.name}（現有 ${cur.stock}，需 ${qty}）`);
      balance = cur.stock - qty;
    }
    db.prepare('UPDATE supplies SET stock = ? WHERE id = ?').run(balance, cur.id);
    db.prepare(`INSERT INTO supply_txns (supply_id, txn_type, quantity, balance_after, reason, note, created_by, vendor, dept, purpose)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(cur.id, type, qty, balance, extra.reason || '', extra.note || '', userId,
      str(extra.vendor, 60), str(extra.dept, 60), str(extra.purpose, 60));
    return balance;
  }
  function httpErr(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
  function run(res, fn) {
    try { fn(); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : '伺服器錯誤' }); if (!e.status) console.error(e); }
  }
  // 清單頁共用篩選：日期區間＋關鍵字
  function dateRange(cond, args, col, q) {
    if (isDate(q.from)) { cond.push(`${col} >= ?`); args.push(q.from); }
    if (isDate(q.to)) { cond.push(`${col} <= ?`); args.push(q.to); }
  }

  // ---------- 總覽 ----------
  router.get('/procurement/dashboard', requireStaff, (req, res) => {
    const low = db.prepare(`SELECT id, code, name, unit, stock, safety_stock, warehouse FROM supplies
      WHERE active = 1 AND stock < safety_stock ORDER BY name`).all();
    res.json({
      low_stock: low,
      pending_pr: db.prepare("SELECT COUNT(*) c FROM purchase_requests WHERE status = 'pending'").get().c,
      approved_pr: db.prepare("SELECT COUNT(*) c FROM purchase_requests WHERE status = 'approved'").get().c,
      pending_po: db.prepare("SELECT COUNT(*) c FROM purchase_orders WHERE status = 'pending'").get().c,
      unpaid: db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total_amount),0) amt FROM payment_requests WHERE status = 'unpaid'").get(),
      pending_ship: db.prepare("SELECT COUNT(*) c FROM shipments WHERE status = 'pending'").get().c,
      recent_pr: db.prepare('SELECT id, no, req_date, requester, status FROM purchase_requests ORDER BY id DESC LIMIT 5').all(),
      recent_ship: db.prepare('SELECT id, no, ship_date, recipient, status FROM shipments ORDER BY id DESC LIMIT 5').all(),
      can: { approve: can(req, 'purchasing_approve'), pay: can(req, 'payables'), purchasing: can(req, 'purchasing') },
      settings: procSettings()
    });
  });
  function procSettings() {
    const s = getSettings();
    return {
      center_name: s.center_name || '',
      request_dept: s.proc_request_dept || '',
      pay_dept: s.proc_pay_dept || '',
      tax_rate: num(s.proc_tax_rate === undefined ? 5 : s.proc_tax_rate),
      payment_terms: String(s.proc_payment_terms || '').split(',').map(x => x.trim()).filter(Boolean)
    };
  }

  // ---------- 廠商管理 ----------
  router.get('/procurement/vendors', requireStaff, (req, res) => {
    const cond = [], args = [];
    if (req.query.active !== 'all') cond.push('v.active = 1');
    const q = str(req.query.q, 60);
    if (q) { cond.push('(v.name LIKE ? OR v.code LIKE ? OR v.contact LIKE ? OR v.tax_id LIKE ?)'); args.push(...Array(4).fill('%' + q + '%')); }
    res.json(db.prepare(`SELECT v.*,
        (SELECT COUNT(*) FROM purchase_orders o WHERE o.vendor_id = v.id) AS po_count,
        (SELECT COALESCE(SUM(total_amount),0) FROM payment_requests p WHERE p.vendor_id = v.id AND p.status = 'unpaid') AS unpaid_amount
      FROM vendors v ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY v.active DESC, v.code, v.name`).all(...args));
  });
  function vendorFields(b) {
    return {
      name: str(b.name, 100), tax_id: str(b.tax_id, 8), payment_terms: str(b.payment_terms, 40),
      address: str(b.address, 200), contact: str(b.contact, 50), phone: str(b.phone, 40), email: str(b.email, 100),
      bank_name: str(b.bank_name, 50), bank_branch: str(b.bank_branch, 50), bank_code: str(b.bank_code, 7),
      bank_account: str(b.bank_account, 30), bank_holder: str(b.bank_holder, 100), note: str(b.note, 500)
    };
  }
  router.post('/procurement/vendors', requireStaff, need('purchasing_approve'), (req, res) => {
    const f = vendorFields(req.body || {});
    if (!f.name) return bad(res, '請填寫廠商名稱');
    let code = str((req.body || {}).code, 20);
    if (!code) {
      const n = db.prepare("SELECT COUNT(*) c FROM vendors").get().c + 1;
      code = 'S' + String(n).padStart(3, '0');
      while (db.prepare('SELECT 1 FROM vendors WHERE code = ?').get(code)) code = 'S' + String(parseInt(code.slice(1), 10) + 1).padStart(3, '0');
    }
    if (db.prepare('SELECT 1 FROM vendors WHERE code = ?').get(code)) return bad(res, '廠商編號已存在', 409);
    const info = db.prepare(`INSERT INTO vendors (code, name, tax_id, payment_terms, address, contact, phone, email,
      bank_name, bank_branch, bank_code, bank_account, bank_holder, note)
      VALUES (@code,@name,@tax_id,@payment_terms,@address,@contact,@phone,@email,@bank_name,@bank_branch,@bank_code,@bank_account,@bank_holder,@note)`)
      .run({ code, ...f });
    logAudit(req, { action: 'create', entity: 'vendors', entity_id: info.lastInsertRowid, summary: `新增廠商 ${f.name}` });
    res.json({ id: info.lastInsertRowid, code });
  });
  router.put('/procurement/vendors/:id', requireStaff, need('purchasing_approve'), (req, res) => {
    const cur = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
    if (!cur) return bad(res, '找不到廠商', 404);
    const b = req.body || {};
    const f = vendorFields({ ...cur, ...b });
    if (!f.name) return bad(res, '請填寫廠商名稱');
    db.prepare(`UPDATE vendors SET name=@name, tax_id=@tax_id, payment_terms=@payment_terms, address=@address, contact=@contact,
      phone=@phone, email=@email, bank_name=@bank_name, bank_branch=@bank_branch, bank_code=@bank_code,
      bank_account=@bank_account, bank_holder=@bank_holder, note=@note, active=@active WHERE id=@id`)
      .run({ ...f, active: b.active === undefined ? cur.active : (b.active ? 1 : 0), id: cur.id });
    logAudit(req, { action: 'update', entity: 'vendors', entity_id: cur.id, summary: `修改廠商 ${f.name}` });
    res.json({ ok: true });
  });
  // 有交易紀錄的廠商只停用不刪除（請款與採購單要能追回廠商資料）
  router.delete('/procurement/vendors/:id', requireStaff, need('purchasing_approve'), (req, res) => {
    const cur = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
    if (!cur) return bad(res, '找不到廠商', 404);
    const used = db.prepare('SELECT 1 FROM purchase_orders WHERE vendor_id = ? UNION SELECT 1 FROM payment_requests WHERE vendor_id = ? LIMIT 1').get(cur.id, cur.id);
    if (used) {
      db.prepare('UPDATE vendors SET active = 0 WHERE id = ?').run(cur.id);
      logAudit(req, { action: 'update', entity: 'vendors', entity_id: cur.id, summary: `停用廠商 ${cur.name}（已有交易紀錄）` });
      return res.json({ ok: true, deactivated: true });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM supply_vendors WHERE vendor_id = ?').run(cur.id);
      db.prepare('DELETE FROM vendors WHERE id = ?').run(cur.id);
    })();
    logAudit(req, { action: 'delete', entity: 'vendors', entity_id: cur.id, summary: `刪除廠商 ${cur.name}` });
    res.json({ ok: true });
  });
  // 廠商詳情：供應品項、歷史採購統計、最近採購單、請款（應付）彙總
  router.get('/procurement/vendors/:id', requireStaff, (req, res) => {
    const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
    if (!v) return bad(res, '找不到廠商', 404);
    res.json({
      vendor: v,
      items: db.prepare(`SELECT s.id, s.code, s.name, s.unit, sv.is_default FROM supply_vendors sv
        JOIN supplies s ON s.id = sv.supply_id WHERE sv.vendor_id = ? ORDER BY sv.is_default DESC, s.name`).all(v.id),
      purchased: db.prepare(`SELECT gi.item_name AS name, gi.unit, COUNT(DISTINCT g.id) AS times, SUM(gi.received_qty) AS total_qty,
          SUM(gi.received_qty * gi.unit_price) AS total_amount
        FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.gr_id JOIN purchase_orders o ON o.id = g.po_id
        WHERE o.vendor_id = ? GROUP BY gi.item_name, gi.unit ORDER BY times DESC, name`).all(v.id),
      orders: db.prepare(`SELECT o.id, o.no, o.po_date, o.status, (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = o.id) AS item_count
        FROM purchase_orders o WHERE o.vendor_id = ? ORDER BY o.id DESC LIMIT 5`).all(v.id),
      payables: db.prepare(`SELECT
          COALESCE(SUM(CASE WHEN status = 'unpaid' THEN total_amount END),0) AS unpaid,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN total_amount END),0) AS paid,
          SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid_count
        FROM payment_requests WHERE vendor_id = ?`).get(v.id),
      payments: db.prepare(`SELECT id, no, invoice_no, total_amount, pay_due_date, status, paid_at FROM payment_requests
        WHERE vendor_id = ? ORDER BY id DESC LIMIT 10`).all(v.id)
    });
  });

  // ---------- 品項（沿用備品主檔，另加倉庫別與供應廠商） ----------
  function itemVendors(supplyId) {
    return db.prepare(`SELECT v.id, v.name, sv.is_default FROM supply_vendors sv JOIN vendors v ON v.id = sv.vendor_id
      WHERE sv.supply_id = ? ORDER BY sv.is_default DESC, v.name`).all(supplyId);
  }
  router.get('/procurement/items', requireStaff, (req, res) => {
    const cond = ['s.active = 1'], args = [];
    const q = str(req.query.q, 60);
    if (q) { cond.push('(s.name LIKE ? OR s.code LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
    if (req.query.warehouse) { cond.push('s.warehouse = ?'); args.push(str(req.query.warehouse, 40)); }
    if (req.query.low === '1') cond.push('s.stock < s.safety_stock');
    if (req.query.vendor_id) { cond.push('EXISTS (SELECT 1 FROM supply_vendors sv WHERE sv.supply_id = s.id AND sv.vendor_id = ?)'); args.push(int(req.query.vendor_id)); }
    const rows = db.prepare(`SELECT s.id, s.code, s.name, s.category, s.unit, s.stock, s.safety_stock, s.price, s.warehouse,
        (SELECT COUNT(DISTINCT i.po_id) FROM purchase_order_items i WHERE i.supply_id = s.id) AS po_count
      FROM supplies s WHERE ${cond.join(' AND ')} ORDER BY s.warehouse, s.code, s.name`).all(...args);
    for (const r of rows) r.vendors = itemVendors(r.id);
    const warehouses = db.prepare("SELECT DISTINCT warehouse FROM supplies WHERE active = 1 AND warehouse != '' ORDER BY warehouse").all().map(r => r.warehouse);
    res.json({ rows, warehouses });
  });
  function saveItemVendors(supplyId, list) {
    db.prepare('DELETE FROM supply_vendors WHERE supply_id = ?').run(supplyId);
    const ids = [...new Set((Array.isArray(list) ? list : []).map(v => int(v.vendor_id)).filter(Boolean))];
    const def = (Array.isArray(list) ? list : []).find(v => v.is_default);
    const defId = def ? int(def.vendor_id) : ids[0];
    const ins = db.prepare('INSERT INTO supply_vendors (supply_id, vendor_id, is_default) VALUES (?,?,?)');
    for (const id of ids) {
      if (!db.prepare('SELECT 1 FROM vendors WHERE id = ?').get(id)) continue;
      ins.run(supplyId, id, id === defId ? 1 : 0);
    }
  }
  router.post('/procurement/items', requireStaff, need('purchasing_approve'), (req, res) => run(res, () => {
    const b = req.body || {};
    const name = str(b.name, 100), unit = str(b.unit, 20);
    if (!name || !unit) throw httpErr('請填寫品項名稱與單位');
    const code = str(b.code, 40);
    if (code && db.prepare('SELECT 1 FROM supplies WHERE code = ? AND active = 1').get(code)) throw httpErr('品項編號已存在', 409);
    let id;
    db.transaction(() => {
      id = db.prepare(`INSERT INTO supplies (name, category, unit, safety_stock, code, price, warehouse)
        VALUES (?,?,?,?,?,?,?)`).run(name, str(b.category, 40), unit, Math.max(0, int(b.safety_stock)),
        code, Math.max(0, int(b.price)), str(b.warehouse, 40)).lastInsertRowid;
      saveItemVendors(id, b.vendors);
      const init = Math.max(0, int(b.initial_stock));
      if (init > 0) stockMove(id, 'in', init, req.session.user.id, { reason: '期初庫存', note: '品項管理建立時輸入' });
    })();
    logAudit(req, { action: 'create', entity: 'supplies', entity_id: id, summary: `採購品項新增 ${name}` });
    res.json({ id });
  }));
  router.put('/procurement/items/:id', requireStaff, need('purchasing_approve'), (req, res) => run(res, () => {
    const cur = db.prepare('SELECT * FROM supplies WHERE id = ?').get(req.params.id);
    if (!cur) throw httpErr('找不到品項', 404);
    const b = req.body || {};
    const name = b.name === undefined ? cur.name : str(b.name, 100);
    const unit = b.unit === undefined ? cur.unit : str(b.unit, 20);
    if (!name || !unit) throw httpErr('請填寫品項名稱與單位');
    db.transaction(() => {
      db.prepare('UPDATE supplies SET name=?, unit=?, safety_stock=?, price=?, warehouse=?, category=? WHERE id=?').run(
        name, unit,
        b.safety_stock === undefined ? cur.safety_stock : Math.max(0, int(b.safety_stock)),
        b.price === undefined ? cur.price : Math.max(0, int(b.price)),
        b.warehouse === undefined ? cur.warehouse : str(b.warehouse, 40),
        b.category === undefined ? cur.category : str(b.category, 40), cur.id);
      if (b.vendors !== undefined) saveItemVendors(cur.id, b.vendors);
    })();
    logAudit(req, { action: 'update', entity: 'supplies', entity_id: cur.id, summary: `採購品項修改 ${name}` });
    res.json({ ok: true });
  }));
  router.get('/procurement/items/:id/history', requireStaff, (req, res) => {
    const s = db.prepare('SELECT id, code, name, unit, stock, warehouse FROM supplies WHERE id = ?').get(req.params.id);
    if (!s) return bad(res, '找不到品項', 404);
    res.json({
      item: s, vendors: itemVendors(s.id),
      orders: db.prepare(`SELECT o.id, o.no, o.po_date, o.status, v.name AS vendor_name, i.qty, i.unit_price
        FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id LEFT JOIN vendors v ON v.id = o.vendor_id
        WHERE i.supply_id = ? ORDER BY o.id DESC LIMIT 50`).all(s.id),
      vendor_stats: db.prepare(`SELECT v.name, COUNT(DISTINCT g.id) AS times, SUM(gi.received_qty) AS total_qty
        FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.gr_id JOIN purchase_orders o ON o.id = g.po_id
        LEFT JOIN vendors v ON v.id = o.vendor_id WHERE gi.supply_id = ? GROUP BY o.vendor_id ORDER BY times DESC`).all(s.id)
    });
  });

  // ---------- 請購單 ----------
  function prDetail(id) {
    const r = db.prepare(`SELECT r.*, u.name AS approved_name, uo.name AS ordered_name FROM purchase_requests r
      LEFT JOIN users u ON u.id = r.approved_by LEFT JOIN users uo ON uo.id = r.ordered_by WHERE r.id = ?`).get(id);
    if (!r) return null;
    r.items = db.prepare(`SELECT i.*, s.stock, s.safety_stock, s.code AS supply_code, v.name AS suggested_vendor_name
      FROM purchase_request_items i LEFT JOIN supplies s ON s.id = i.supply_id LEFT JOIN vendors v ON v.id = i.suggested_vendor_id
      WHERE i.pr_id = ? ORDER BY i.id`).all(id);
    r.orders = db.prepare('SELECT id, no, status FROM purchase_orders WHERE pr_id = ? ORDER BY id').all(id);
    return r;
  }
  // 請購品項：可選既有品項，或直接輸入新品名（驗貨時再建檔）
  function normPrItems(list) {
    const out = [];
    for (const it of Array.isArray(list) ? list : []) {
      const qty = int(it.qty);
      if (qty <= 0) continue;
      let supplyId = int(it.supply_id) || null, name = str(it.item_name, 100), unit = str(it.unit, 20);
      if (supplyId) {
        const s = db.prepare('SELECT id, name, unit FROM supplies WHERE id = ?').get(supplyId);
        if (!s) throw httpErr('請購品項不存在');
        name = s.name; unit = s.unit;
      } else if (!name) continue;
      out.push({ supply_id: supplyId, item_name: name, unit, qty,
        need_date: isDate(it.need_date) ? it.need_date : '',
        suggested_vendor_id: int(it.suggested_vendor_id) || null });
    }
    if (!out.length) throw httpErr('請至少填一個品項與數量');
    return out;
  }
  router.get('/procurement/requests', requireStaff, (req, res) => {
    const cond = [], args = [];
    dateRange(cond, args, 'r.req_date', req.query);
    if (PR_STATUS.includes(req.query.status)) { cond.push('r.status = ?'); args.push(req.query.status); }
    const q = str(req.query.q, 60);
    if (q) { cond.push('(r.no LIKE ? OR r.requester LIKE ? OR r.purpose LIKE ? OR EXISTS (SELECT 1 FROM purchase_request_items i WHERE i.pr_id = r.id AND i.item_name LIKE ?))'); args.push(...Array(4).fill('%' + q + '%')); }
    res.json(db.prepare(`SELECT r.*, (SELECT name FROM users u WHERE u.id = r.approved_by) AS approved_name,
        (SELECT COUNT(*) FROM purchase_request_items i WHERE i.pr_id = r.id) AS item_count,
        (SELECT GROUP_CONCAT(no, '、') FROM purchase_orders o WHERE o.pr_id = r.id) AS po_nos
      FROM purchase_requests r ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY r.id DESC LIMIT 500`).all(...args));
  });
  router.get('/procurement/requests/:id', requireStaff, (req, res) => {
    const r = prDetail(req.params.id);
    return r ? res.json(r) : bad(res, '找不到請購單', 404);
  });
  router.post('/procurement/requests', requireStaff, need('purchasing'), (req, res) => run(res, () => {
    const b = req.body || {};
    const requester = str(b.requester, 50);
    if (!requester) throw httpErr('請填寫申請人');
    const reqDate = isDate(b.req_date) ? b.req_date : today();
    const items = normPrItems(b.items);
    let id, no;
    db.transaction(() => {
      no = nextNo('purchase_requests', 'pr', reqDate);
      id = db.prepare(`INSERT INTO purchase_requests (no, req_date, requester, urgent, purpose, budget, created_by)
        VALUES (?,?,?,?,?,?,?)`).run(no, reqDate, requester, b.urgent ? 1 : 0, str(b.purpose, 500),
        Math.max(0, int(b.budget)), req.session.user.id).lastInsertRowid;
      const ins = db.prepare(`INSERT INTO purchase_request_items (pr_id, supply_id, item_name, unit, qty, need_date, suggested_vendor_id)
        VALUES (?,?,?,?,?,?,?)`);
      for (const it of items) ins.run(id, it.supply_id, it.item_name, it.unit, it.qty, it.need_date, it.suggested_vendor_id);
    })();
    logAudit(req, { action: 'create', entity: 'purchase_requests', entity_id: id, summary: `建立請購單 ${no}` });
    res.json({ id, no });
  }));
  // 待核准的請購單可修改（核准後內容已拆到採購單，不再異動）
  router.put('/procurement/requests/:id', requireStaff, need('purchasing'), (req, res) => run(res, () => {
    const cur = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(req.params.id);
    if (!cur) throw httpErr('找不到請購單', 404);
    if (cur.status !== 'pending') throw httpErr('請購單已核准或取消，不能再修改');
    const b = req.body || {};
    const items = b.items === undefined ? null : normPrItems(b.items);
    db.transaction(() => {
      db.prepare('UPDATE purchase_requests SET req_date=?, requester=?, urgent=?, purpose=?, budget=? WHERE id=?').run(
        isDate(b.req_date) ? b.req_date : cur.req_date,
        b.requester === undefined ? cur.requester : (str(b.requester, 50) || cur.requester),
        b.urgent === undefined ? cur.urgent : (b.urgent ? 1 : 0),
        b.purpose === undefined ? cur.purpose : str(b.purpose, 500),
        b.budget === undefined ? cur.budget : Math.max(0, int(b.budget)), cur.id);
      if (items) {
        db.prepare('DELETE FROM purchase_request_items WHERE pr_id = ?').run(cur.id);
        const ins = db.prepare(`INSERT INTO purchase_request_items (pr_id, supply_id, item_name, unit, qty, need_date, suggested_vendor_id)
          VALUES (?,?,?,?,?,?,?)`);
        for (const it of items) ins.run(cur.id, it.supply_id, it.item_name, it.unit, it.qty, it.need_date, it.suggested_vendor_id);
      }
    })();
    logAudit(req, { action: 'update', entity: 'purchase_requests', entity_id: cur.id, summary: `修改請購單 ${cur.no}` });
    res.json({ ok: true });
  }));
  router.post('/procurement/requests/:id/cancel', requireStaff, need('purchasing'), (req, res) => {
    const cur = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(req.params.id);
    if (!cur) return bad(res, '找不到請購單', 404);
    if (!['pending', 'approved'].includes(cur.status)) return bad(res, '已建立採購單的請購單不能取消，請改取消採購單');
    db.prepare("UPDATE purchase_requests SET status='cancelled', cancel_reason=? WHERE id=?").run(str((req.body || {}).reason, 200), cur.id);
    logAudit(req, { action: 'update', entity: 'purchase_requests', entity_id: cur.id, summary: `取消請購單 ${cur.no}` });
    res.json({ ok: true });
  });
  // 核准：主管只決定「准不准買」；廠商與價格交給採購建單
  router.post('/procurement/requests/:id/approve', requireStaff, need('purchasing_approve'), (req, res) => {
    const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(req.params.id);
    if (!pr) return bad(res, '找不到請購單', 404);
    if (pr.status !== 'pending') return bad(res, '只有待核准的請購單可以核准');
    db.prepare("UPDATE purchase_requests SET status='approved', approved_by=?, approved_at=datetime('now','localtime') WHERE id=?")
      .run(req.session.user.id, pr.id);
    logAudit(req, { action: 'update', entity: 'purchase_requests', entity_id: pr.id, summary: `核准請購單 ${pr.no}` });
    res.json({ ok: true });
  });
  // 建立採購單（採購作業）：已核准的請購單，每個品項指定廠商與預計到貨日，同廠商＋同到貨日合併成一張
  router.post('/procurement/requests/:id/order', requireStaff, need('purchasing'), (req, res) => run(res, () => {
    const pr = prDetail(req.params.id);
    if (!pr) throw httpErr('找不到請購單', 404);
    if (pr.status === 'pending') throw httpErr('請購單尚未核准，不能建立採購單');
    if (pr.status !== 'approved') throw httpErr('此請購單已建立採購單或已取消');
    const assign = new Map((Array.isArray((req.body || {}).items) ? req.body.items : []).map(a => [int(a.item_id), a]));
    const groups = new Map();
    for (const it of pr.items) {
      const a = assign.get(it.id) || {};
      const vendorId = int(a.vendor_id);
      if (!vendorId || !db.prepare('SELECT 1 FROM vendors WHERE id = ? AND active = 1').get(vendorId)) {
        throw httpErr(`請為「${it.item_name}」指定廠商`);
      }
      const eta = isDate(a.eta) ? a.eta : today();
      const key = `${vendorId}|${eta}`;
      if (!groups.has(key)) groups.set(key, { vendorId, eta, items: [] });
      groups.get(key).items.push(it);
    }
    const created = [];
    db.transaction(() => {
      for (const g of groups.values()) {
        const no = nextNo('purchase_orders', 'po', today());
        const poId = db.prepare(`INSERT INTO purchase_orders (no, po_date, pr_id, vendor_id, eta, created_by)
          VALUES (?,?,?,?,?,?)`).run(no, today(), pr.id, g.vendorId, g.eta, req.session.user.id).lastInsertRowid;
        const ins = db.prepare(`INSERT INTO purchase_order_items (po_id, pr_item_id, supply_id, item_name, unit, qty, unit_price, is_new)
          VALUES (?,?,?,?,?,?,?,?)`);
        for (const it of g.items) {
          // 參考單價：品項主檔的單價，採購時可再改
          const price = it.supply_id ? (db.prepare('SELECT price FROM supplies WHERE id = ?').get(it.supply_id) || {}).price || 0 : 0;
          ins.run(poId, it.id, it.supply_id, it.item_name, it.unit, it.qty, price, it.supply_id ? 0 : 1);
        }
        created.push({ id: poId, no });
      }
      db.prepare("UPDATE purchase_requests SET status='ordered', ordered_by=?, ordered_at=datetime('now','localtime') WHERE id=?")
        .run(req.session.user.id, pr.id);
    })();
    logAudit(req, { action: 'update', entity: 'purchase_requests', entity_id: pr.id, summary: `請購單 ${pr.no} 建立採購單 ${created.map(c => c.no).join('、')}` });
    res.json({ ok: true, orders: created });
  }));

  // ---------- 採購單 ----------
  function poDetail(id) {
    const o = db.prepare(`SELECT o.*, v.name AS vendor_name, v.tax_id AS vendor_tax_id, v.payment_terms AS vendor_terms,
        r.no AS pr_no, r.requester, r.purpose AS pr_purpose
      FROM purchase_orders o LEFT JOIN vendors v ON v.id = o.vendor_id LEFT JOIN purchase_requests r ON r.id = o.pr_id
      WHERE o.id = ?`).get(id);
    if (!o) return null;
    o.items = db.prepare(`SELECT i.*, s.stock, s.code AS supply_code FROM purchase_order_items i
      LEFT JOIN supplies s ON s.id = i.supply_id WHERE i.po_id = ? ORDER BY i.id`).all(id);
    o.total = o.items.reduce((t, i) => t + i.qty * i.unit_price, 0);
    o.receipts = db.prepare('SELECT id, no, receive_date FROM goods_receipts WHERE po_id = ? ORDER BY id').all(id);
    return o;
  }
  router.get('/procurement/orders', requireStaff, (req, res) => {
    const cond = [], args = [];
    dateRange(cond, args, 'o.po_date', req.query);
    if (['pending', 'received', 'cancelled'].includes(req.query.status)) { cond.push('o.status = ?'); args.push(req.query.status); }
    if (req.query.vendor_id) { cond.push('o.vendor_id = ?'); args.push(int(req.query.vendor_id)); }
    const q = str(req.query.q, 60);
    if (q) { cond.push('(o.no LIKE ? OR r.no LIKE ? OR v.name LIKE ? OR EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.po_id = o.id AND i.item_name LIKE ?))'); args.push(...Array(4).fill('%' + q + '%')); }
    res.json(db.prepare(`SELECT o.*, v.name AS vendor_name, r.no AS pr_no,
        (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = o.id) AS item_count,
        (SELECT COALESCE(SUM(qty * unit_price),0) FROM purchase_order_items i WHERE i.po_id = o.id) AS total
      FROM purchase_orders o LEFT JOIN vendors v ON v.id = o.vendor_id LEFT JOIN purchase_requests r ON r.id = o.pr_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 500`).all(...args));
  });
  router.get('/procurement/orders/:id', requireStaff, (req, res) => {
    const o = poDetail(req.params.id);
    return o ? res.json(o) : bad(res, '找不到採購單', 404);
  });
  // 待入庫採購單：可改單價、預計到貨日、備註，並標記新品項的建檔資料
  router.put('/procurement/orders/:id', requireStaff, need('purchasing_approve'), (req, res) => run(res, () => {
    const o = poDetail(req.params.id);
    if (!o) throw httpErr('找不到採購單', 404);
    if (o.status !== 'pending') throw httpErr('採購單已入庫或取消，不能再修改');
    const b = req.body || {};
    db.transaction(() => {
      db.prepare('UPDATE purchase_orders SET eta=?, note=? WHERE id=?').run(
        isDate(b.eta) ? b.eta : o.eta, b.note === undefined ? o.note : str(b.note, 500), o.id);
      const upd = db.prepare('UPDATE purchase_order_items SET unit_price=?, qty=?, new_code=?, new_warehouse=?, new_safety=? WHERE id=? AND po_id=?');
      for (const it of Array.isArray(b.items) ? b.items : []) {
        const cur = o.items.find(x => x.id === int(it.id));
        if (!cur) continue;
        const qty = it.qty === undefined ? cur.qty : int(it.qty);
        if (qty <= 0) throw httpErr(`「${cur.item_name}」數量需大於 0`);
        upd.run(Math.max(0, num(it.unit_price === undefined ? cur.unit_price : it.unit_price)), qty,
          it.new_code === undefined ? cur.new_code : str(it.new_code, 40),
          it.new_warehouse === undefined ? cur.new_warehouse : str(it.new_warehouse, 40),
          it.new_safety === undefined ? cur.new_safety : Math.max(0, int(it.new_safety)), cur.id, o.id);
      }
    })();
    logAudit(req, { action: 'update', entity: 'purchase_orders', entity_id: o.id, summary: `修改採購單 ${o.no}` });
    res.json({ ok: true });
  }));
  router.post('/procurement/orders/:id/cancel', requireStaff, need('purchasing_approve'), (req, res) => {
    const o = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!o) return bad(res, '找不到採購單', 404);
    if (o.status !== 'pending') return bad(res, '只有待入庫的採購單可以取消');
    db.prepare("UPDATE purchase_orders SET status='cancelled', note=TRIM(note || ' 取消原因：' || ?) WHERE id=?").run(str((req.body || {}).reason, 200), o.id);
    logAudit(req, { action: 'update', entity: 'purchase_orders', entity_id: o.id, summary: `取消採購單 ${o.no}` });
    res.json({ ok: true });
  });

  // ---------- 驗貨入庫 ----------
  router.get('/procurement/receipts', requireStaff, (req, res) => {
    const cond = [], args = [];
    dateRange(cond, args, 'g.receive_date', req.query);
    if (req.query.vendor_id) { cond.push('o.vendor_id = ?'); args.push(int(req.query.vendor_id)); }
    const q = str(req.query.q, 60);
    if (q) { cond.push('(g.no LIKE ? OR o.no LIKE ? OR g.invoice_no LIKE ? OR g.inspector LIKE ? OR v.name LIKE ?)'); args.push(...Array(5).fill('%' + q + '%')); }
    res.json(db.prepare(`SELECT g.*, o.no AS po_no, v.name AS vendor_name, p.no AS pay_no, p.id AS pay_id,
        (SELECT COALESCE(SUM(received_qty * unit_price),0) FROM goods_receipt_items i WHERE i.gr_id = g.id) AS subtotal
      FROM goods_receipts g JOIN purchase_orders o ON o.id = g.po_id LEFT JOIN vendors v ON v.id = o.vendor_id
      LEFT JOIN payment_requests p ON p.gr_id = g.id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY g.id DESC LIMIT 500`).all(...args));
  });
  router.get('/procurement/receipts/:id', requireStaff, (req, res) => {
    const g = db.prepare(`SELECT g.*, o.no AS po_no, v.name AS vendor_name FROM goods_receipts g
      JOIN purchase_orders o ON o.id = g.po_id LEFT JOIN vendors v ON v.id = o.vendor_id WHERE g.id = ?`).get(req.params.id);
    if (!g) return bad(res, '找不到入庫單', 404);
    g.items = db.prepare('SELECT * FROM goods_receipt_items WHERE gr_id = ? ORDER BY id').all(g.id);
    res.json(g);
  });
  // 驗貨：實到數量進備品庫存、新品項自動建檔、採購單轉已入庫、自動產生請款單
  router.post('/procurement/receipts', requireStaff, need('purchasing'), (req, res) => run(res, () => {
    const b = req.body || {};
    const o = poDetail(int(b.po_id));
    if (!o) throw httpErr('找不到採購單', 404);
    if (o.status !== 'pending') throw httpErr('此採購單已入庫或已取消');
    const inspector = str(b.inspector, 50);
    if (!inspector) throw httpErr('請填寫驗貨人員');
    const receiveDate = isDate(b.receive_date) ? b.receive_date : today();
    const input = new Map((Array.isArray(b.items) ? b.items : []).map(i => [int(i.po_item_id), i]));
    const s = procSettings();
    let grId, grNo, payId, payNo, newCount = 0;
    db.transaction(() => {
      grNo = nextNo('goods_receipts', 'gr', receiveDate);
      grId = db.prepare(`INSERT INTO goods_receipts (no, po_id, receive_date, inspector, invoice_no, note, created_by)
        VALUES (?,?,?,?,?,?,?)`).run(grNo, o.id, receiveDate, inspector, str(b.invoice_no, 30), str(b.note, 500), req.session.user.id).lastInsertRowid;
      const insGi = db.prepare(`INSERT INTO goods_receipt_items (gr_id, po_item_id, supply_id, item_name, unit, ordered_qty, received_qty, unit_price)
        VALUES (?,?,?,?,?,?,?,?)`);
      const payLines = [];
      for (const it of o.items) {
        const inp = input.get(it.id) || {};
        const qty = inp.received_qty === undefined ? it.qty : int(inp.received_qty);
        if (qty < 0) throw httpErr(`「${it.item_name}」實到數量不可為負`);
        const price = Math.max(0, num(inp.unit_price === undefined ? it.unit_price : inp.unit_price));
        let supplyId = it.supply_id;
        let unit = it.unit;
        if (!supplyId && qty > 0) {
          // 新品項：同編號已存在就併入，否則建檔（單位／倉庫別／安全庫存以驗貨畫面為準）
          const code = str(inp.new_code === undefined ? it.new_code : inp.new_code, 40);
          unit = str(inp.new_unit, 20) || it.unit;
          if (!unit) throw httpErr(`新品項「${it.item_name}」請填寫單位`);
          const exist = code ? db.prepare('SELECT id FROM supplies WHERE code = ? AND active = 1').get(code) : null;
          if (exist) supplyId = exist.id;
          else {
            supplyId = db.prepare(`INSERT INTO supplies (name, unit, safety_stock, code, price, warehouse) VALUES (?,?,?,?,?,?)`).run(
              it.item_name, unit, Math.max(0, int(inp.new_safety === undefined ? (it.new_safety || 5) : inp.new_safety)),
              code, Math.round(price), str(inp.new_warehouse === undefined ? it.new_warehouse : inp.new_warehouse, 40)).lastInsertRowid;
            newCount++;
          }
          db.prepare('UPDATE purchase_order_items SET supply_id = ? WHERE id = ?').run(supplyId, it.id);
          db.prepare('INSERT OR IGNORE INTO supply_vendors (supply_id, vendor_id, is_default) VALUES (?,?,1)').run(supplyId, o.vendor_id);
        }
        insGi.run(grId, it.id, supplyId, it.item_name, unit, it.qty, qty, price);
        if (qty > 0) {
          stockMove(supplyId, 'in', qty, req.session.user.id, {
            vendor: o.vendor_name, reason: `驗貨入庫 ${grNo}`, note: `採購單 ${o.no}${b.invoice_no ? `／發票 ${str(b.invoice_no, 30)}` : ''}`
          });
          payLines.push({ supplyId, name: it.item_name, unit, qty, price });
        }
      }
      if (!payLines.length) throw httpErr('實到數量全部為 0，無法入庫');
      db.prepare("UPDATE purchase_orders SET status='received' WHERE id=?").run(o.id);
      // 請款單：金額帶入未稅小計與預設稅率，財務確認後付款
      const vendor = db.prepare('SELECT payment_terms FROM vendors WHERE id = ?').get(o.vendor_id) || {};
      const subtotal = payLines.reduce((t, l) => t + l.qty * l.price, 0);
      const tax = Math.round(subtotal * s.tax_rate / 100);
      payNo = nextNo('payment_requests', 'pay', today());
      payId = db.prepare(`INSERT INTO payment_requests (no, req_date, gr_id, po_id, vendor_id, invoice_no, invoice_date,
          subtotal, tax_rate, tax_amount, total_amount, pay_due_date, pay_method)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(payNo, today(), grId, o.id, o.vendor_id, str(b.invoice_no, 30), receiveDate,
        subtotal, s.tax_rate, tax, subtotal + tax, addDays(receiveDate, termDays(vendor.payment_terms)), '銀行轉帳').lastInsertRowid;
      const insPi = db.prepare('INSERT INTO payment_request_items (pay_id, item_name, unit, qty, unit_price, amount) VALUES (?,?,?,?,?,?)');
      for (const l of payLines) insPi.run(payId, l.name, l.unit, l.qty, l.price, l.qty * l.price);
    })();
    logAudit(req, { action: 'create', entity: 'goods_receipts', entity_id: grId, summary: `驗貨入庫 ${grNo}（採購單 ${o.no}），產生請款單 ${payNo}` });
    res.json({ id: grId, no: grNo, payment_id: payId, payment_no: payNo, new_items: newCount });
  }));

  // ---------- 請款單 ----------
  function payDetail(id) {
    const p = db.prepare(`SELECT p.*, v.name AS vendor_name, v.code AS vendor_code, v.tax_id AS vendor_tax_id, v.payment_terms AS vendor_terms,
        v.bank_name, v.bank_branch, v.bank_code, v.bank_account, v.bank_holder,
        g.no AS gr_no, o.no AS po_no, u.name AS paid_name
      FROM payment_requests p LEFT JOIN vendors v ON v.id = p.vendor_id LEFT JOIN goods_receipts g ON g.id = p.gr_id
      LEFT JOIN purchase_orders o ON o.id = p.po_id LEFT JOIN users u ON u.id = p.paid_by WHERE p.id = ?`).get(id);
    if (!p) return null;
    p.items = db.prepare('SELECT * FROM payment_request_items WHERE pay_id = ? ORDER BY id').all(id);
    return p;
  }
  router.get('/procurement/payments', requireStaff, (req, res) => {
    const cond = [], args = [];
    const col = req.query.date_field === 'due' ? 'p.pay_due_date' : 'p.req_date';
    dateRange(cond, args, col, req.query);
    if (['unpaid', 'paid', 'cancelled'].includes(req.query.status)) { cond.push('p.status = ?'); args.push(req.query.status); }
    if (req.query.vendor_id) { cond.push('p.vendor_id = ?'); args.push(int(req.query.vendor_id)); }
    const q = str(req.query.q, 60);
    if (q) { cond.push('(p.no LIKE ? OR p.invoice_no LIKE ? OR v.name LIKE ?)'); args.push(...Array(3).fill('%' + q + '%')); }
    res.json(db.prepare(`SELECT p.*, v.name AS vendor_name, g.no AS gr_no, o.no AS po_no
      FROM payment_requests p LEFT JOIN vendors v ON v.id = p.vendor_id LEFT JOIN goods_receipts g ON g.id = p.gr_id
      LEFT JOIN purchase_orders o ON o.id = p.po_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 500`).all(...args));
  });
  router.get('/procurement/payments/:id', requireStaff, (req, res) => {
    const p = payDetail(req.params.id);
    return p ? res.json(p) : bad(res, '找不到請款單', 404);
  });
  // 填金額：單價、稅率、手動含稅總額（有填就覆蓋計算值）、發票日、到期日、付款方式、備註
  function applyPayment(p, b) {
    const prices = new Map((Array.isArray(b.items) ? b.items : []).map(i => [int(i.id), i]));
    let subtotal = 0;
    const lines = p.items.map(it => {
      const inp = prices.get(it.id);
      const price = Math.max(0, num(inp && inp.unit_price !== undefined ? inp.unit_price : it.unit_price));
      const amount = Math.round(price * it.qty);
      subtotal += amount;
      return { id: it.id, price, amount };
    });
    const taxRate = b.tax_rate === undefined ? p.tax_rate : Math.min(100, Math.max(0, num(b.tax_rate)));
    const taxAmount = Math.round(subtotal * taxRate / 100);
    const manual = b.total_amount === undefined || b.total_amount === '' || b.total_amount === null ? null : Math.max(0, Math.round(num(b.total_amount)));
    const invoiceDate = isDate(b.invoice_date) ? b.invoice_date : p.invoice_date;
    const method = PAY_METHODS.includes(b.pay_method) ? b.pay_method : p.pay_method;
    const upd = db.prepare('UPDATE payment_request_items SET unit_price = ?, amount = ? WHERE id = ?');
    for (const l of lines) upd.run(l.price, l.amount, l.id);
    db.prepare(`UPDATE payment_requests SET invoice_no=?, invoice_date=?, subtotal=?, tax_rate=?, tax_amount=?, total_amount=?,
        pay_due_date=?, pay_method=?, remark=?, budget_no=?, cost_center=? WHERE id=?`).run(
      b.invoice_no === undefined ? p.invoice_no : str(b.invoice_no, 30), invoiceDate, subtotal, taxRate, taxAmount,
      manual === null ? subtotal + taxAmount : manual,
      isDate(b.pay_due_date) ? b.pay_due_date : p.pay_due_date, method,
      b.remark === undefined ? p.remark : str(b.remark, 500),
      b.budget_no === undefined ? p.budget_no : str(b.budget_no, 40),
      b.cost_center === undefined ? p.cost_center : str(b.cost_center, 60), p.id);
  }
  router.put('/procurement/payments/:id', requireStaff, need('payables'), (req, res) => run(res, () => {
    const p = payDetail(req.params.id);
    if (!p) throw httpErr('找不到請款單', 404);
    if (p.status !== 'unpaid') throw httpErr('請款單已付款或取消，不能再修改');
    db.transaction(() => applyPayment(p, req.body || {}))();
    logAudit(req, { action: 'update', entity: 'payment_requests', entity_id: p.id, summary: `修改請款單 ${p.no}` });
    res.json(payDetail(p.id));
  }));
  router.post('/procurement/payments/:id/pay', requireStaff, need('payables'), (req, res) => run(res, () => {
    const p = payDetail(req.params.id);
    if (!p) throw httpErr('找不到請款單', 404);
    if (p.status !== 'unpaid') throw httpErr('此請款單已付款或已取消');
    const b = req.body || {};
    const paidOn = isDate(b.paid_on) ? b.paid_on : today();
    db.transaction(() => {
      applyPayment(p, b);
      db.prepare("UPDATE payment_requests SET status='paid', paid_by=?, paid_at=?, paid_on=? WHERE id=?")
        .run(req.session.user.id, new Date().toLocaleString('sv-SE').slice(0, 19), paidOn, p.id);
    })();
    const after = payDetail(p.id);
    logAudit(req, { action: 'update', entity: 'payment_requests', entity_id: p.id, summary: `請款單 ${p.no} 付款完成 ${after.total_amount}` });
    res.json(after);
  }));
  // 付錯了要能改回：限管理員，並留稽核
  router.post('/procurement/payments/:id/unpay', requireStaff, (req, res) => {
    if (req.session.user.role !== 'admin') return bad(res, '需要管理員權限', 403);
    const p = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(req.params.id);
    if (!p) return bad(res, '找不到請款單', 404);
    if (p.status !== 'paid') return bad(res, '此請款單尚未付款');
    db.prepare("UPDATE payment_requests SET status='unpaid', paid_by=NULL, paid_at='', paid_on='' WHERE id=?").run(p.id);
    logAudit(req, { action: 'update', entity: 'payment_requests', entity_id: p.id, summary: `請款單 ${p.no} 取消付款（改回待付款）` });
    res.json({ ok: true });
  });

  // ---------- 出貨／領料 ----------
  function shipDetail(id) {
    const s = db.prepare(`SELECT sh.*, u.name AS shipped_name FROM shipments sh LEFT JOIN users u ON u.id = sh.shipped_by WHERE sh.id = ?`).get(id);
    if (!s) return null;
    s.items = db.prepare(`SELECT i.*, sp.stock, sp.code AS supply_code FROM shipment_items i
      LEFT JOIN supplies sp ON sp.id = i.supply_id WHERE i.shipment_id = ? ORDER BY i.id`).all(id);
    s.pick = db.prepare('SELECT * FROM pick_lists WHERE shipment_id = ?').get(id) || null;
    return s;
  }
  function normShipItems(list) {
    const merged = new Map();
    for (const it of Array.isArray(list) ? list : []) {
      const id = int(it.supply_id), qty = int(it.qty);
      if (!id || qty <= 0) continue;
      merged.set(id, (merged.get(id) || 0) + qty);
    }
    const out = [];
    for (const [id, qty] of merged) {
      const sp = db.prepare('SELECT id, name, unit, stock FROM supplies WHERE id = ? AND active = 1').get(id);
      if (!sp) throw httpErr('出貨品項不存在');
      if (sp.stock < qty) throw httpErr(`庫存不足：${sp.name}（現有 ${sp.stock}，需 ${qty}）`);
      out.push({ supply_id: id, item_name: sp.name, unit: sp.unit, qty });
    }
    if (!out.length) throw httpErr('請至少填一個品項與數量');
    return out;
  }
  router.get('/procurement/shipments', requireStaff, (req, res) => {
    const cond = [], args = [];
    dateRange(cond, args, 'sh.ship_date', req.query);
    if (['pending', 'shipped', 'cancelled'].includes(req.query.status)) { cond.push('sh.status = ?'); args.push(req.query.status); }
    const q = str(req.query.q, 60);
    if (q) { cond.push('(sh.no LIKE ? OR sh.recipient LIKE ? OR EXISTS (SELECT 1 FROM shipment_items i WHERE i.shipment_id = sh.id AND i.item_name LIKE ?))'); args.push(...Array(3).fill('%' + q + '%')); }
    res.json(db.prepare(`SELECT sh.*, pk.no AS pick_no, pk.status AS pick_status,
        (SELECT COUNT(*) FROM shipment_items i WHERE i.shipment_id = sh.id) AS item_count
      FROM shipments sh LEFT JOIN pick_lists pk ON pk.shipment_id = sh.id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY sh.id DESC LIMIT 500`).all(...args));
  });
  router.get('/procurement/shipments/:id', requireStaff, (req, res) => {
    const s = shipDetail(req.params.id);
    return s ? res.json(s) : bad(res, '找不到出貨單', 404);
  });
  // 建立出貨單同時產生領料單；此時只檢查庫存、還不扣，確認出貨才扣
  router.post('/procurement/shipments', requireStaff, need('purchasing'), (req, res) => run(res, () => {
    const b = req.body || {};
    const recipient = str(b.recipient, 60);
    if (!recipient) throw httpErr('請填寫客戶／部門');
    const shipDate = isDate(b.ship_date) ? b.ship_date : today();
    const items = normShipItems(b.items);
    let id, no, pickNo;
    db.transaction(() => {
      no = nextNo('shipments', 'ship', shipDate);
      id = db.prepare('INSERT INTO shipments (no, ship_date, recipient, note, created_by) VALUES (?,?,?,?,?)')
        .run(no, shipDate, recipient, str(b.note, 500), req.session.user.id).lastInsertRowid;
      const ins = db.prepare('INSERT INTO shipment_items (shipment_id, supply_id, item_name, unit, qty) VALUES (?,?,?,?,?)');
      for (const it of items) ins.run(id, it.supply_id, it.item_name, it.unit, it.qty);
      pickNo = nextNo('pick_lists', 'pick', shipDate);
      db.prepare('INSERT INTO pick_lists (no, shipment_id, pick_date, recipient) VALUES (?,?,?,?)').run(pickNo, id, shipDate, recipient);
    })();
    logAudit(req, { action: 'create', entity: 'shipments', entity_id: id, summary: `建立出貨單 ${no}，領料單 ${pickNo}` });
    res.json({ id, no, pick_no: pickNo });
  }));
  router.put('/procurement/shipments/:id', requireStaff, need('purchasing'), (req, res) => run(res, () => {
    const cur = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
    if (!cur) throw httpErr('找不到出貨單', 404);
    if (cur.status !== 'pending') throw httpErr('出貨單已出貨或取消，不能再修改');
    const b = req.body || {};
    const items = b.items === undefined ? null : normShipItems(b.items);
    const recipient = b.recipient === undefined ? cur.recipient : str(b.recipient, 60);
    if (!recipient) throw httpErr('請填寫客戶／部門');
    db.transaction(() => {
      db.prepare('UPDATE shipments SET ship_date=?, recipient=?, note=? WHERE id=?').run(
        isDate(b.ship_date) ? b.ship_date : cur.ship_date, recipient, b.note === undefined ? cur.note : str(b.note, 500), cur.id);
      db.prepare('UPDATE pick_lists SET recipient=?, pick_date=? WHERE shipment_id=?').run(recipient, isDate(b.ship_date) ? b.ship_date : cur.ship_date, cur.id);
      if (items) {
        db.prepare('DELETE FROM shipment_items WHERE shipment_id = ?').run(cur.id);
        const ins = db.prepare('INSERT INTO shipment_items (shipment_id, supply_id, item_name, unit, qty) VALUES (?,?,?,?,?)');
        for (const it of items) ins.run(cur.id, it.supply_id, it.item_name, it.unit, it.qty);
      }
    })();
    logAudit(req, { action: 'update', entity: 'shipments', entity_id: cur.id, summary: `修改出貨單 ${cur.no}` });
    res.json({ ok: true });
  }));
  // 確認出貨：扣備品庫存（寫出庫紀錄）、領料單轉已領料
  router.post('/procurement/shipments/:id/confirm', requireStaff, need('purchasing'), (req, res) => run(res, () => {
    const s = shipDetail(req.params.id);
    if (!s) throw httpErr('找不到出貨單', 404);
    if (s.status !== 'pending') throw httpErr('此出貨單已出貨或已取消');
    db.transaction(() => {
      for (const it of s.items) {
        stockMove(it.supply_id, 'out', it.qty, req.session.user.id, {
          reason: `出貨 ${s.no}`, note: s.pick ? `領料單 ${s.pick.no}` : '', dept: s.recipient, purpose: '出貨'
        });
      }
      db.prepare("UPDATE shipments SET status='shipped', shipped_by=?, shipped_at=datetime('now','localtime') WHERE id=?").run(req.session.user.id, s.id);
      db.prepare("UPDATE pick_lists SET status='picked' WHERE shipment_id=?").run(s.id);
    })();
    logAudit(req, { action: 'update', entity: 'shipments', entity_id: s.id, summary: `確認出貨 ${s.no}（已扣庫存）` });
    res.json({ ok: true });
  }));
  router.post('/procurement/shipments/:id/cancel', requireStaff, need('purchasing'), (req, res) => {
    const s = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
    if (!s) return bad(res, '找不到出貨單', 404);
    if (s.status !== 'pending') return bad(res, '只有待出貨的出貨單可以取消');
    db.transaction(() => {
      db.prepare("UPDATE shipments SET status='cancelled' WHERE id=?").run(s.id);
      db.prepare("UPDATE pick_lists SET status='cancelled' WHERE shipment_id=?").run(s.id);
    })();
    logAudit(req, { action: 'update', entity: 'shipments', entity_id: s.id, summary: `取消出貨單 ${s.no}` });
    res.json({ ok: true });
  });
  router.get('/procurement/picks', requireStaff, (req, res) => {
    const cond = [], args = [];
    dateRange(cond, args, 'pk.pick_date', req.query);
    if (['pending', 'picked', 'cancelled'].includes(req.query.status)) { cond.push('pk.status = ?'); args.push(req.query.status); }
    const q = str(req.query.q, 60);
    if (q) { cond.push('(pk.no LIKE ? OR sh.no LIKE ? OR pk.recipient LIKE ?)'); args.push(...Array(3).fill('%' + q + '%')); }
    res.json(db.prepare(`SELECT pk.*, sh.no AS ship_no, (SELECT COUNT(*) FROM shipment_items i WHERE i.shipment_id = sh.id) AS item_count
      FROM pick_lists pk JOIN shipments sh ON sh.id = pk.shipment_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY pk.id DESC LIMIT 500`).all(...args));
  });

  return router;
};

// 請購單表頭。狀態：pending 待核准 → approved 已核准（待採購）→ ordered 已建立採購單；cancelled 已取消
function prTableSql(name) {
  return `CREATE TABLE IF NOT EXISTS ${name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no TEXT NOT NULL UNIQUE,
      req_date TEXT NOT NULL,
      requester TEXT NOT NULL DEFAULT '',
      urgent INTEGER NOT NULL DEFAULT 0,
      purpose TEXT DEFAULT '',
      budget INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','ordered','cancelled')),
      cancel_reason TEXT DEFAULT '',
      approved_by INTEGER REFERENCES users(id),
      approved_at TEXT DEFAULT '',
      ordered_by INTEGER REFERENCES users(id),
      ordered_at TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );`;
}

// 舊版請購單表的狀態 CHECK 沒有 approved（核准與建採購單原本是同一步），SQLite 不能改 CHECK，只能重建表。
// 依 SQLite 建議的步驟：關外鍵 → 交易內建新表、搬資料、刪舊表、改名 → 檢查外鍵 → 開外鍵。
function migratePrTable(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='purchase_requests'").get();
  if (!row || row.sql.includes("'approved'")) return;
  const cols = ['id', 'no', 'req_date', 'requester', 'urgent', 'purpose', 'budget', 'status', 'cancel_reason',
    'approved_by', 'approved_at', 'created_by', 'created_at'].join(', ');
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(prTableSql('purchase_requests_new'));
      db.exec(`INSERT INTO purchase_requests_new (${cols}) SELECT ${cols} FROM purchase_requests`);
      // 舊資料「已建立採購單」的核准者就是建單者
      db.exec("UPDATE purchase_requests_new SET ordered_by = approved_by, ordered_at = approved_at WHERE status = 'ordered'");
      db.exec('DROP TABLE purchase_requests');
      db.exec('ALTER TABLE purchase_requests_new RENAME TO purchase_requests');
      const bad = db.pragma('foreign_key_check');
      if (bad.length) throw new Error('請購單表重建後外鍵檢查失敗：' + JSON.stringify(bad.slice(0, 3)));
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// 資料表：採購單據各自一張表頭＋明細；品項沿用 supplies（另加倉庫別）
function ensureSchema(db) {
  migratePrTable(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      tax_id TEXT DEFAULT '',
      payment_terms TEXT DEFAULT '',
      address TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      bank_name TEXT DEFAULT '',
      bank_branch TEXT DEFAULT '',
      bank_code TEXT DEFAULT '',
      bank_account TEXT DEFAULT '',
      bank_holder TEXT DEFAULT '',
      note TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS supply_vendors (
      supply_id INTEGER NOT NULL REFERENCES supplies(id),
      vendor_id INTEGER NOT NULL REFERENCES vendors(id),
      is_default INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (supply_id, vendor_id)
    );
    ${prTableSql('purchase_requests')}
    CREATE TABLE IF NOT EXISTS purchase_request_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_id INTEGER NOT NULL REFERENCES purchase_requests(id),
      supply_id INTEGER REFERENCES supplies(id),
      item_name TEXT NOT NULL,
      unit TEXT DEFAULT '',
      qty INTEGER NOT NULL,
      need_date TEXT DEFAULT '',
      suggested_vendor_id INTEGER REFERENCES vendors(id)
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no TEXT NOT NULL UNIQUE,
      po_date TEXT NOT NULL,
      pr_id INTEGER REFERENCES purchase_requests(id),
      vendor_id INTEGER NOT NULL REFERENCES vendors(id),
      eta TEXT DEFAULT '',
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','cancelled')),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
      pr_item_id INTEGER REFERENCES purchase_request_items(id),
      supply_id INTEGER REFERENCES supplies(id),
      item_name TEXT NOT NULL,
      unit TEXT DEFAULT '',
      qty INTEGER NOT NULL,
      unit_price REAL NOT NULL DEFAULT 0,
      is_new INTEGER NOT NULL DEFAULT 0,
      new_code TEXT DEFAULT '',
      new_warehouse TEXT DEFAULT '',
      new_safety INTEGER NOT NULL DEFAULT 5
    );
    CREATE TABLE IF NOT EXISTS goods_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no TEXT NOT NULL UNIQUE,
      po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
      receive_date TEXT NOT NULL,
      inspector TEXT NOT NULL DEFAULT '',
      invoice_no TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS goods_receipt_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gr_id INTEGER NOT NULL REFERENCES goods_receipts(id),
      po_item_id INTEGER REFERENCES purchase_order_items(id),
      supply_id INTEGER REFERENCES supplies(id),
      item_name TEXT NOT NULL,
      unit TEXT DEFAULT '',
      ordered_qty INTEGER NOT NULL DEFAULT 0,
      received_qty INTEGER NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no TEXT NOT NULL UNIQUE,
      req_date TEXT NOT NULL,
      gr_id INTEGER REFERENCES goods_receipts(id),
      po_id INTEGER REFERENCES purchase_orders(id),
      vendor_id INTEGER REFERENCES vendors(id),
      invoice_no TEXT DEFAULT '',
      invoice_date TEXT DEFAULT '',
      subtotal INTEGER NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 5,
      tax_amount INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL DEFAULT 0,
      pay_due_date TEXT DEFAULT '',
      pay_method TEXT DEFAULT '銀行轉帳',
      budget_no TEXT DEFAULT '',
      cost_center TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','cancelled')),
      paid_by INTEGER REFERENCES users(id),
      paid_at TEXT DEFAULT '',
      paid_on TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS payment_request_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pay_id INTEGER NOT NULL REFERENCES payment_requests(id),
      item_name TEXT NOT NULL,
      unit TEXT DEFAULT '',
      qty INTEGER NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      amount INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no TEXT NOT NULL UNIQUE,
      ship_date TEXT NOT NULL,
      recipient TEXT NOT NULL DEFAULT '',
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','shipped','cancelled')),
      created_by INTEGER REFERENCES users(id),
      shipped_by INTEGER REFERENCES users(id),
      shipped_at TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS shipment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id INTEGER NOT NULL REFERENCES shipments(id),
      supply_id INTEGER NOT NULL REFERENCES supplies(id),
      item_name TEXT NOT NULL,
      unit TEXT DEFAULT '',
      qty INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pick_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no TEXT NOT NULL UNIQUE,
      shipment_id INTEGER NOT NULL UNIQUE REFERENCES shipments(id),
      pick_date TEXT NOT NULL,
      recipient TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','picked','cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_pr_items ON purchase_request_items(pr_id);
    CREATE INDEX IF NOT EXISTS idx_po_items ON purchase_order_items(po_id);
    CREATE INDEX IF NOT EXISTS idx_po_vendor ON purchase_orders(vendor_id, status);
    CREATE INDEX IF NOT EXISTS idx_gr_items ON goods_receipt_items(gr_id);
    CREATE INDEX IF NOT EXISTS idx_pay_vendor ON payment_requests(vendor_id, status);
    CREATE INDEX IF NOT EXISTS idx_pay_items ON payment_request_items(pay_id);
    CREATE INDEX IF NOT EXISTS idx_ship_items ON shipment_items(shipment_id);
  `);
  const cols = db.prepare('PRAGMA table_info(supplies)').all().map(c => c.name);
  if (!cols.includes('warehouse')) db.exec("ALTER TABLE supplies ADD COLUMN warehouse TEXT DEFAULT ''");
}
