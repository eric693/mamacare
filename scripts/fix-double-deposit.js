// 一次性資料修正（2026-11）：排房「訂金」欄與入住前收款的訂金重複計算
// 用法：node scripts/fix-double-deposit.js          只列出會異動的資料（不寫入）
//       node scripts/fix-double-deposit.js --apply  寫入（每筆記稽核）
// 規則：同一位媽媽已在入住前收款登記過訂金 → 訂房上的訂金欄歸零（訂金以收款紀錄為準）；
//       只有訂房訂金欄、沒有任何收款紀錄 → 不動，列給財務確認
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(process.env.MAMACARE_DB || path.join(__dirname, '..', 'data', 'mamacare.db'));
const apply = process.argv.includes('--apply');

const rows = db.prepare(`SELECT bk.id, bk.mother_id, m.name, bk.status, bk.check_in, bk.deposit,
    (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN bookings b2 ON b2.id = p.booking_id
      WHERE b2.mother_id = bk.mother_id AND (p.item = '訂金' OR p.note LIKE '訂金%')) AS dep_paid,
    (SELECT COUNT(*) FROM payments p JOIN bookings b2 ON b2.id = p.booking_id WHERE b2.mother_id = bk.mother_id) AS pay_count
  FROM bookings bk JOIN mothers m ON m.id = bk.mother_id
  WHERE bk.status != 'cancelled' AND bk.deposit > 0 ORDER BY bk.id`).all();

const fix = rows.filter(r => r.dep_paid > 0);
const review = rows.filter(r => r.dep_paid === 0);
console.log(`【歸零】已在入住前收款登記訂金，訂房訂金欄歸零（${fix.length} 筆）`);
for (const r of fix) console.log(`  訂房#${r.id} ${r.name}（${r.status}）訂房訂金 ${r.deposit} → 0；收款紀錄訂金 ${r.dep_paid}`);
console.log(`【請財務確認】只有訂房訂金欄、沒有訂金收款紀錄（${review.length} 筆，未異動）`);
for (const r of review) console.log(`  訂房#${r.id} ${r.name}（${r.status}，入住 ${r.check_in}）訂房訂金 ${r.deposit}，該媽媽收款紀錄 ${r.pay_count} 筆`);

if (apply) {
  const ins = db.prepare(`INSERT INTO audit_logs (user_id, user_name, role, action, method, entity, entity_id, path, summary)
    VALUES (NULL, '系統', 'system', 'update', 'SCRIPT', 'bookings', ?, 'scripts/fix-double-deposit.js', ?)`);
  db.transaction(() => {
    for (const r of fix) {
      db.prepare('UPDATE bookings SET deposit = 0 WHERE id = ?').run(r.id);
      ins.run(String(r.id), `訂金重複計算修正：訂房訂金欄 ${r.deposit} 歸零（已於入住前收款登記訂金 ${r.dep_paid}）`);
    }
  })();
  console.log(`已寫入 ${fix.length} 筆`);
} else {
  console.log('（試算，未寫入；加 --apply 才會寫入）');
}
