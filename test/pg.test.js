// DAL 的 PostgreSQL 後端測試。未設定 PG_URL+DB_BACKEND=pg 時整檔略過（本機/一般 CI 用 sqlite）。
const { test } = require('node:test');
const assert = require('node:assert');

const ENABLED = !!process.env.PG_URL && process.env.DB_BACKEND === 'pg';

test('DAL PostgreSQL 後端：CRUD 與 ? → $n、RETURNING id', { skip: !ENABLED && '未設定 PG_URL/DB_BACKEND=pg，略過' }, async () => {
  // 確保 dal 走 sqlite 連線開檔不影響（db.js 會開 MAMACARE_DB）；僅在啟用時才載入
  const dal = require('../src/dal');
  assert.strictEqual(dal.backend, 'pg');
  await dal.run('DROP TABLE IF EXISTS dal_probe');
  await dal.run('CREATE TABLE dal_probe (id SERIAL PRIMARY KEY, name TEXT, n INTEGER)');
  const ins = await dal.run('INSERT INTO dal_probe (name, n) VALUES (?, ?)', ['小蠻', 5]);
  assert.ok(ins.lastInsertRowid, 'INSERT 應回傳 lastInsertRowid（RETURNING id）');
  const all = await dal.all('SELECT * FROM dal_probe WHERE n = ?', [5]);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].name, '小蠻');
  const one = await dal.get('SELECT name FROM dal_probe WHERE id = ?', [ins.lastInsertRowid]);
  assert.strictEqual(one.name, '小蠻');
  const upd = await dal.run('UPDATE dal_probe SET name = ? WHERE id = ?', ['石頭', ins.lastInsertRowid]);
  assert.strictEqual(upd.changes, 1);
  const del = await dal.run('DELETE FROM dal_probe WHERE id = ?', [ins.lastInsertRowid]);
  assert.strictEqual(del.changes, 1);
  await dal.run('DROP TABLE dal_probe');
});
