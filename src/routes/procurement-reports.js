// 採購報表：進銷存一覽表（依批次）、出貨明細、進貨明細、廠商請款明細。
// 每支都可加 ?format=xlsx 匯出 Excel。
module.exports = function procurementReports(router, deps) {
  const { db, need, requireStaff, today, buildWorkbook, syncLots, str, int, isDate, companyFilter } = deps;

  const monthRange = ym => {
    const m = /^(\d{4})-?(\d{2})$/.exec(String(ym || ''));
    const y = m ? +m[1] : +today().slice(0, 4), mo = m ? +m[2] : +today().slice(5, 7);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const p = n => String(n).padStart(2, '0');
    return { ym: `${y}${p(mo)}`, from: `${y}-${p(mo)}-01`, to: `${y}-${p(mo)}-${p(last)}` };
  };
  const round = v => Math.round(Number(v) || 0);
  const range = (q, defFrom, defTo) => ({ from: isDate(q.from) ? q.from : defFrom, to: isDate(q.to) ? q.to : defTo });
  const thisMonth = () => monthRange(today().slice(0, 7));

  function send(res, req, title, columns, rows, extra) {
    if (req.query.format === 'xlsx') {
      const buf = buildWorkbook(title, columns, rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(`${title}.xlsx`)}`);
      return res.send(buf);
    }
    res.json({ title, columns, rows, ...extra });
  }

  // ---------- 進銷存一覽表（yyyymm）----------
  // 依批次（品項＋廠商＋單價）列期初／進貨／出貨／期末；盤點與系統校正另列「調整」，確保期初＋進−出±調整＝期末
  router.get('/procurement/reports/inventory', requireStaff, need('reports'), (req, res) => {
    syncLots(db, today());
    const { ym, from, to } = monthRange(req.query.month);
    const cond = [], args = [from, from, to, from, to, from, to, to];
    const q = str(req.query.q, 60);
    if (q) { cond.push('(s.name LIKE ? OR s.code LIKE ? OR l.lot_no LIKE ?)'); args.push(...Array(3).fill('%' + q + '%')); }
    if (int(req.query.vendor_id)) { cond.push('l.vendor_id = ?'); args.push(int(req.query.vendor_id)); }
    if (int(req.query.supply_id)) { cond.push('l.supply_id = ?'); args.push(int(req.query.supply_id)); }
    const rows = db.prepare(`
      SELECT l.lot_no, l.unit_price, s.code, s.name AS item_name, s.unit, COALESCE(v.name, '') AS vendor_name,
        COALESCE(SUM(CASE WHEN m.move_date < ? THEN m.qty END), 0) AS open_qty,
        COALESCE(SUM(CASE WHEN m.move_date >= ? AND m.move_date <= ? AND m.move_type = 'in' THEN m.qty END), 0) AS in_qty,
        COALESCE(SUM(CASE WHEN m.move_date >= ? AND m.move_date <= ? AND m.move_type = 'out' THEN -m.qty END), 0) AS out_qty,
        COALESCE(SUM(CASE WHEN m.move_date >= ? AND m.move_date <= ? AND m.move_type = 'adjust' THEN m.qty END), 0) AS adj_qty,
        COALESCE(SUM(CASE WHEN m.move_date <= ? THEN m.qty END), 0) AS end_qty
      FROM stock_lots l JOIN supplies s ON s.id = l.supply_id LEFT JOIN vendors v ON v.id = l.vendor_id
      LEFT JOIN lot_moves m ON m.lot_id = l.id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      GROUP BY l.id
      HAVING open_qty != 0 OR in_qty != 0 OR out_qty != 0 OR adj_qty != 0 OR end_qty != 0
      ORDER BY s.name, l.unit_price, l.lot_no`).all(...args)
      .map(x => ({
        ...x,
        item: `${x.code ? x.code + ' ' : ''}${x.item_name}`,
        open_amt: round(x.open_qty * x.unit_price), in_amt: round(x.in_qty * x.unit_price),
        out_amt: round(x.out_qty * x.unit_price), adj_amt: round(x.adj_qty * x.unit_price), end_amt: round(x.end_qty * x.unit_price)
      }));
    const sum = k => rows.reduce((t, x) => t + x[k], 0);
    const totals = Object.fromEntries(['open_qty', 'open_amt', 'in_qty', 'in_amt', 'out_qty', 'out_amt', 'adj_qty', 'adj_amt', 'end_qty', 'end_amt'].map(k => [k, sum(k)]));
    const columns = [
      { key: 'lot_no', label: '批次' }, { key: 'item', label: '品項' }, { key: 'vendor_name', label: '廠商' },
      { key: 'unit', label: '單位' }, { key: 'unit_price', label: '單價(未稅)' },
      { key: 'open_qty', label: '期初數量' }, { key: 'open_amt', label: '期初金額(未稅)' },
      { key: 'in_qty', label: '進貨數量' }, { key: 'in_amt', label: '進貨金額' },
      { key: 'out_qty', label: '出貨數量' }, { key: 'out_amt', label: '出貨金額' },
      { key: 'adj_qty', label: '盤點調整數量' }, { key: 'adj_amt', label: '盤點調整金額' },
      { key: 'end_qty', label: '期末數量' }, { key: 'end_amt', label: '期末金額' }
    ];
    const out = req.query.format === 'xlsx' ? [...rows, { lot_no: '合計', ...totals }] : rows;
    send(res, req, `進銷存一覽表 ${ym}`, columns, out, { month: ym, from, to, totals });
  });

  // ---------- 出貨明細 ----------
  // 金額為出貨時實際扣到的批次成本（便宜的先出）
  router.get('/procurement/reports/shipments', requireStaff, need('reports'), (req, res) => {
    syncLots(db, today());
    const m = thisMonth();
    const { from, to } = range(req.query, m.from, m.to);
    const cond = ["sh.status = 'shipped'", 'sh.ship_date >= ?', 'sh.ship_date <= ?'], args = [from, to];
    const recipient = str(req.query.recipient, 60);
    if (recipient) { cond.push('sh.recipient LIKE ?'); args.push('%' + recipient + '%'); }
    if (int(req.query.supply_id)) { cond.push('si.supply_id = ?'); args.push(int(req.query.supply_id)); }
    const q = str(req.query.q, 60);
    if (q) { cond.push('(si.item_name LIKE ? OR sp.code LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
    companyFilter(cond, args, 'sh.company_id', req.query);
    const rows = db.prepare(`
      SELECT sh.ship_date, sh.no AS ship_no, sh.recipient, si.item_name, sp.code, si.unit, si.qty,
        COALESCE((SELECT SUM(-m.qty * l.unit_price) FROM supply_txns t JOIN lot_moves m ON m.txn_id = t.id JOIN stock_lots l ON l.id = m.lot_id
          WHERE t.ref_type = 'shipment' AND t.ref_id = sh.id AND t.supply_id = si.supply_id), 0) AS amount
      FROM shipments sh JOIN shipment_items si ON si.shipment_id = sh.id LEFT JOIN supplies sp ON sp.id = si.supply_id
      WHERE ${cond.join(' AND ')} ORDER BY sh.ship_date, sh.no, si.id`).all(...args)
      .map(x => ({ ...x, item: `${x.code ? x.code + ' ' : ''}${x.item_name}`, amount: round(x.amount) }));
    const summary = groupSum(rows, x => `${x.item}|${x.unit}`, x => ({ item: x.item, unit: x.unit }));
    const recipients = db.prepare("SELECT DISTINCT recipient FROM shipments WHERE status = 'shipped' ORDER BY recipient").all().map(x => x.recipient);
    const columns = [
      { key: 'ship_date', label: '出貨日期' }, { key: 'ship_no', label: '出貨單號' }, { key: 'recipient', label: '客戶／部門' },
      { key: 'item', label: '品項' }, { key: 'unit', label: '單位' }, { key: 'qty', label: '出貨數量' }, { key: 'amount', label: '出貨總金額' }
    ];
    send(res, req, `出貨明細 ${from}~${to}`, columns, withTotal(req, rows, 'ship_date'), { from, to, summary, recipients, total: totalOf(rows) });
  });

  // ---------- 進貨明細 ----------
  router.get('/procurement/reports/receipts', requireStaff, need('reports'), (req, res) => {
    const m = thisMonth();
    const { from, to } = range(req.query, m.from, m.to);
    const cond = ['g.receive_date >= ?', 'g.receive_date <= ?', 'gi.received_qty > 0'], args = [from, to];
    if (int(req.query.supply_id)) { cond.push('gi.supply_id = ?'); args.push(int(req.query.supply_id)); }
    if (int(req.query.vendor_id)) { cond.push('o.vendor_id = ?'); args.push(int(req.query.vendor_id)); }
    const q = str(req.query.q, 60);
    if (q) { cond.push('(gi.item_name LIKE ? OR sp.code LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
    companyFilter(cond, args, 'o.company_id', req.query);
    const rows = db.prepare(`
      SELECT g.receive_date, g.no AS gr_no, o.no AS po_no, v.name AS vendor_name, gi.item_name, sp.code, gi.unit,
        gi.received_qty AS qty, gi.unit_price,
        COALESCE((SELECT pi.unit_price FROM payment_request_items pi JOIN payment_requests p ON p.id = pi.pay_id
          WHERE pi.gr_id = g.id AND pi.item_name = gi.item_name AND p.status != 'cancelled' ORDER BY pi.id DESC LIMIT 1), gi.unit_price) AS final_price
      FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.gr_id JOIN purchase_orders o ON o.id = g.po_id
      LEFT JOIN vendors v ON v.id = o.vendor_id LEFT JOIN supplies sp ON sp.id = gi.supply_id
      WHERE ${cond.join(' AND ')} ORDER BY g.receive_date, g.no, gi.id`).all(...args)
      .map(x => ({ ...x, item: `${x.code ? x.code + ' ' : ''}${x.item_name}`, amount: round(x.qty * x.final_price) }));
    const summary = groupSum(rows, x => `${x.vendor_name}|${x.item}|${x.unit}`, x => ({ vendor_name: x.vendor_name, item: x.item, unit: x.unit }));
    const columns = [
      { key: 'receive_date', label: '進貨日期' }, { key: 'gr_no', label: '入庫單號' }, { key: 'vendor_name', label: '廠商' },
      { key: 'item', label: '品項' }, { key: 'unit', label: '單位' }, { key: 'qty', label: '進貨數量' }, { key: 'amount', label: '進貨總金額' }
    ];
    send(res, req, `進貨明細 ${from}~${to}`, columns, withTotal(req, rows, 'receive_date'), { from, to, summary, total: totalOf(rows) });
  });

  // ---------- 廠商請款明細 ----------
  // 稅額依各品項金額分攤（尾差放最後一項），手動調整過的含稅總額差額也放最後一項，合計等於請款單
  router.get('/procurement/reports/payables', requireStaff, need('reports'), (req, res) => {
    const m = thisMonth();
    const { from, to } = range(req.query, m.from, m.to);
    const col = req.query.date_field === 'invoice' ? "COALESCE(NULLIF(p.invoice_date,''), p.req_date)" : 'p.req_date';
    const cond = ["p.status != 'cancelled'", `${col} >= ?`, `${col} <= ?`], args = [from, to];
    if (int(req.query.vendor_id)) { cond.push('p.vendor_id = ?'); args.push(int(req.query.vendor_id)); }
    if (['unpaid', 'paid'].includes(req.query.status)) { cond.push('p.status = ?'); args.push(req.query.status); }
    companyFilter(cond, args, 'p.company_id', req.query);
    const heads = db.prepare(`SELECT p.*, v.name AS vendor_name FROM payment_requests p LEFT JOIN vendors v ON v.id = p.vendor_id
      WHERE ${cond.join(' AND ')} ORDER BY v.name, p.req_date, p.no`).all(...args);
    const rows = [];
    for (const p of heads) {
      const items = db.prepare('SELECT item_name, unit, qty, amount FROM payment_request_items WHERE pay_id = ? ORDER BY id').all(p.id);
      let taxLeft = p.tax_amount;
      items.forEach((it, i) => {
        const last = i === items.length - 1;
        const tax = last ? taxLeft : Math.round(p.subtotal ? it.amount * p.tax_amount / p.subtotal : 0);
        taxLeft -= tax;
        const total = it.amount + tax + (last ? p.total_amount - p.subtotal - p.tax_amount : 0);
        rows.push({ req_date: p.req_date, pay_no: p.no, vendor_name: p.vendor_name, invoice_no: p.invoice_no,
          item: it.item_name, unit: it.unit, qty: it.qty, amount: it.amount, tax, total,
          status: p.status === 'paid' ? `已付款 ${p.paid_on || ''}` : '待付款' });
      });
    }
    const sum = k => rows.reduce((t, x) => t + (Number(x[k]) || 0), 0);
    const totals = { qty: sum('qty'), amount: sum('amount'), tax: sum('tax'), total: sum('total') };
    const columns = [
      { key: 'req_date', label: '請款日期' }, { key: 'pay_no', label: '請款單號' }, { key: 'vendor_name', label: '廠商' },
      { key: 'invoice_no', label: '發票號碼' }, { key: 'item', label: '品項' }, { key: 'unit', label: '單位' },
      { key: 'qty', label: '進貨數量' }, { key: 'amount', label: '進貨總金額(未稅)' }, { key: 'tax', label: '稅額' },
      { key: 'total', label: '總額' }, { key: 'status', label: '狀態' }
    ];
    const out = req.query.format === 'xlsx' ? [...rows, { req_date: '合計', ...totals }] : rows;
    send(res, req, `廠商請款明細 ${from}~${to}`, columns, out, { from, to, totals, count: heads.length });
  });

  function groupSum(rows, keyFn, pick) {
    const map = new Map();
    for (const x of rows) {
      const k = keyFn(x);
      if (!map.has(k)) map.set(k, { ...pick(x), qty: 0, amount: 0 });
      const g = map.get(k);
      g.qty += x.qty; g.amount += x.amount;
    }
    return [...map.values()];
  }
  const totalOf = rows => ({ qty: rows.reduce((t, x) => t + x.qty, 0), amount: rows.reduce((t, x) => t + x.amount, 0) });
  // Excel 匯出時補合計列；畫面上的合計由前端顯示
  const withTotal = (req, rows, firstKey) => (req.query.format === 'xlsx'
    ? [...rows, { [firstKey]: '合計', ...totalOf(rows) }] : rows);
};
