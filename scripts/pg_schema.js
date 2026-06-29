// 由現行 SQLite 結構自動轉譯為 PostgreSQL DDL。
// 用法：node scripts/pg_schema.js > db/schema.postgres.sql
// 註：CHECK 約束、保留字、型別請人工複核；FK 以相依順序輸出。
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.MAMACARE_DB || path.join(__dirname, '..', 'data', 'mamacare.db'), { readonly: true });

function translate(sql) {
  return sql
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
    .replace(/DEFAULT \(datetime\('now',\s*'localtime'\)\)/gi, 'DEFAULT CURRENT_TIMESTAMP')
    .replace(/\bREAL\b/g, 'DOUBLE PRECISION')
    .replace(/\bAUTOINCREMENT\b/gi, '');
}

const rawTables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL").all();
const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all();

// 依 FK（REFERENCES）做拓樸排序，確保被參照表先建立
const byName = Object.fromEntries(rawTables.map(t => [t.name, t]));
const names = new Set(rawTables.map(t => t.name));
function refsOf(sql, self) {
  const out = new Set(); const re = /REFERENCES\s+(\w+)/gi; let m;
  while ((m = re.exec(sql))) if (names.has(m[1]) && m[1] !== self) out.add(m[1]);
  return [...out];
}
const tables = [];
const visited = new Set(), inStack = new Set();
function visit(name) {
  if (visited.has(name) || inStack.has(name)) return;
  inStack.add(name);
  for (const d of refsOf(byName[name].sql, name)) visit(d);
  inStack.delete(name); visited.add(name); tables.push(byName[name]);
}
for (const t of rawTables) visit(t.name);

let out = '-- MamaCare PostgreSQL schema（由 SQLite 自動轉譯，請人工複核）\n';
out += '-- 產生時間：' + new Date().toISOString() + '\n\nBEGIN;\n\n';
for (const t of tables) out += translate(t.sql).trim() + ';\n\n';
for (const i of indexes) out += i.sql.trim() + ';\n';
out += '\nCOMMIT;\n';
process.stdout.write(out);
