// 每日自動備份 + 手動備份 SQLite 資料庫。使用 better-sqlite3 的線上備份（WAL 安全）。
const path = require('path');
const fs = require('fs');
const { db } = require('./db');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const RETAIN = Number(process.env.BACKUP_RETAIN || 30); // 保留份數
const NAME_RE = /^mamacare-\d{4}-\d{2}-\d{2}(_\d{6})?\.db$/;
// 異地備份目的地（設 BACKUP_OFFSITE_DIR 即啟用：可指向外接硬碟、NAS 掛載點、rclone/S3 掛載…）
const OFFSITE_DIR = process.env.BACKUP_OFFSITE_DIR || '';

// 每次備份後同步複製到異地目的地（不影響主備份成敗）
function copyOffsite(srcPath, name) {
  if (!OFFSITE_DIR) return;
  try {
    if (!fs.existsSync(OFFSITE_DIR)) fs.mkdirSync(OFFSITE_DIR, { recursive: true });
    fs.copyFileSync(srcPath, path.join(OFFSITE_DIR, name));
    // 異地也套用相同保留份數
    const files = fs.readdirSync(OFFSITE_DIR).filter(n => NAME_RE.test(n)).sort((a, b) => (a < b ? 1 : -1));
    for (const f of files.slice(RETAIN)) { try { fs.unlinkSync(path.join(OFFSITE_DIR, f)); } catch (e) { /* */ } }
  } catch (e) { console.error('[backup] 異地備份失敗：', e.message); }
}

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function stamp(withTime) {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString();
  return withTime ? d.slice(0, 19).replace(/[T:]/g, m => (m === 'T' ? '_' : '')) : d.slice(0, 10);
}

function listBackups() {
  ensureDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(n => NAME_RE.test(n))
    .map(n => {
      const st = fs.statSync(path.join(BACKUP_DIR, n));
      return { name: n, size: st.size, created_at: st.mtime.toISOString().slice(0, 19).replace('T', ' ') };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

function prune() {
  const files = listBackups();
  for (const f of files.slice(RETAIN)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch (e) { /* ignore */ }
  }
}

// 執行一次備份。manual=true 時加上時間戳避免覆蓋當日自動備份。
async function runBackup(manual) {
  ensureDir();
  const name = `mamacare-${manual ? stamp(true) : stamp(false)}.db`;
  const dest = path.join(BACKUP_DIR, name);
  await db.backup(dest);
  prune();
  copyOffsite(dest, name); // 異地同步（若已設定 BACKUP_OFFSITE_DIR）
  const st = fs.statSync(dest);
  return { name, size: st.size, created_at: st.mtime.toISOString().slice(0, 19).replace('T', ' ') };
}

function todayBackupExists() {
  return fs.existsSync(path.join(BACKUP_DIR, `mamacare-${stamp(false)}.db`));
}

function backupFilePath(name) {
  if (!NAME_RE.test(name)) return null; // 防路徑穿越
  const p = path.join(BACKUP_DIR, name);
  return fs.existsSync(p) ? p : null;
}

// 啟動時若當日尚無備份則補一份，之後每日 03:00 自動備份。
function scheduleDaily() {
  const tick = async () => {
    try { if (!todayBackupExists()) await runBackup(false); } catch (e) {
      console.error('每日備份失敗：', e.message);
    }
  };
  tick(); // 啟動補備份
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(function run() {
    tick();
    setInterval(tick, 24 * 60 * 60 * 1000);
  }, next - now);
}

// 還原：以指定備份檔覆蓋現行資料庫。會先做安全備份，再 checkpoint、關閉連線並複製，
// 之後須重啟程式（pm2）以乾淨重開資料庫。回傳安全備份檔名供存證。
async function restore(name) {
  const src = backupFilePath(name);
  if (!src) throw new Error('找不到備份檔');
  const safety = await runBackup(true); // 還原前先保留現況
  const live = db.name; // better-sqlite3 連線對應的資料庫檔路徑
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignore */ }
  db.close();
  fs.copyFileSync(src, live);
  for (const ext of ['-wal', '-shm']) {
    const p = live + ext;
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } }
  }
  return { restored_from: name, safety_backup: safety.name };
}

module.exports = { runBackup, listBackups, backupFilePath, restore, scheduleDaily, BACKUP_DIR };
