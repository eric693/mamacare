/* 非同步資料存取層（Data Access Layer）。
   目的：讓路由改用 await dal.x()，把「同步 better-sqlite3」與「非同步 pg」隔在這層之後，
   之後整套切到 PostgreSQL 時，模組程式碼不必再改。
   後端以環境變數 DB_BACKEND 選擇（預設 sqlite，與線上一致）：
     - sqlite：沿用 db.js 既有連線（與其餘仍用同步 db 的程式同一個資料庫）。
     - pg    ：使用 pg 連線池，需設 PG_URL。
   模組一律用「?」佔位符；pg 後端自動轉成 $1,$2…，INSERT 自動補 RETURNING id 以取得新 id。 */
const { db } = require('./db');

const BACKEND = process.env.DB_BACKEND === 'pg' ? 'pg' : 'sqlite';
let pool = null;
function pg() {
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.PG_URL });
  }
  return pool;
}
function toPg(sql) { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); }

async function all(sql, params = []) {
  if (BACKEND === 'sqlite') return db.prepare(sql).all(...params);
  const r = await pg().query(toPg(sql), params);
  return r.rows;
}
async function get(sql, params = []) {
  if (BACKEND === 'sqlite') return db.prepare(sql).get(...params);
  const r = await pg().query(toPg(sql), params);
  return r.rows[0];
}
async function run(sql, params = []) {
  if (BACKEND === 'sqlite') {
    const info = db.prepare(sql).run(...params);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
  let q = sql;
  if (/^\s*insert/i.test(sql) && !/returning/i.test(sql)) q = sql.replace(/;?\s*$/, '') + ' RETURNING id';
  const r = await pg().query(toPg(q), params);
  return { changes: r.rowCount, lastInsertRowid: r.rows[0] && r.rows[0].id };
}

module.exports = { all, get, run, backend: BACKEND, toPg };
