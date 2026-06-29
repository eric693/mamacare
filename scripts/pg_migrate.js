// 資料搬遷：SQLite → PostgreSQL（先以 scripts/pg_schema.js 建好結構）
// 前置：npm install pg
// 用法：PG_URL=postgres://user:pass@host:5432/mamacare node scripts/pg_migrate.js
const path = require('path');
const Database = require('better-sqlite3');

(async () => {
  let Client;
  try { ({ Client } = require('pg')); }
  catch (e) { console.error('缺少 pg 套件，請先執行：npm install pg'); process.exit(1); }
  if (!process.env.PG_URL) { console.error('請設定 PG_URL，例如 postgres://postgres@127.0.0.1:5432/mamacare'); process.exit(1); }

  const sqlite = new Database(process.env.MAMACARE_DB || path.join(__dirname, '..', 'data', 'mamacare.db'), { readonly: true });
  const pg = new Client({ connectionString: process.env.PG_URL });
  await pg.connect();

  // 依 FK 相依順序（同 pg_schema.js 的拓樸排序）
  const raw = sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL").all();
  const names = new Set(raw.map(t => t.name));
  const byName = Object.fromEntries(raw.map(t => [t.name, t]));
  const refsOf = (sql, self) => { const o = new Set(); const re = /REFERENCES\s+(\w+)/gi; let m; while ((m = re.exec(sql))) if (names.has(m[1]) && m[1] !== self) o.add(m[1]); return [...o]; };
  const order = [], seen = new Set(), stack = new Set();
  const visit = n => { if (seen.has(n) || stack.has(n)) return; stack.add(n); for (const d of refsOf(byName[n].sql, n)) visit(d); stack.delete(n); seen.add(n); order.push(n); };
  raw.forEach(t => visit(t.name));

  try {
    await pg.query('BEGIN');
    await pg.query("SET session_replication_role = 'replica'"); // 暫關 FK 觸發
    for (const table of order) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) { console.log(`- ${table}: 0`); continue; }
      const cols = Object.keys(rows[0]);
      const colList = cols.map(c => `"${c}"`).join(', ');
      for (const r of rows) {
        const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
        await pg.query(`INSERT INTO ${table} (${colList}) VALUES (${ph})`, cols.map(c => r[c]));
      }
      console.log(`✓ ${table}: ${rows.length}`);
    }
    // 重設各表的序列（SERIAL）到目前最大 id
    for (const table of order) {
      const hasId = sqlite.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'id');
      if (hasId) await pg.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}),1))`);
    }
    await pg.query("SET session_replication_role = 'origin'");
    await pg.query('COMMIT');
    console.log('搬遷完成。');
  } catch (e) {
    await pg.query('ROLLBACK');
    console.error('搬遷失敗，已回滾：', e.message);
    process.exitCode = 1;
  } finally {
    await pg.end();
  }
})();
