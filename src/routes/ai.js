// AI 助理的存取層。引擎在 src/ai/，這裡只做權限、限流、稽核與參數把關。
// 這個檔在所有站台完全相同：權限模組名稱、限流與稽核的接法都由 src/ai/context.js 提供。
//
// 全檔沒有任何一支端點會寫進業務資料表。AI 的產出一律是草稿，
// 使用者要建檔請走既有的建檔畫面（該擋的閘門照樣擋）。
const express = require('express');
const ctx = require('../ai/context');
const provider = require('../ai/provider');
const agents = require('../ai/agents');
const { db, getSetting, setSetting, audit } = ctx.deps;
const { requireStaff, rateLimit } = ctx.guard;

const router = express.Router();

// AI 呼叫要花錢，而且一次不便宜。限流不是防攻擊，是防「按住不放」與程式打圈。
const aiLimit = rateLimit({ windowMs: 60 * 1000, max: 20, prefix: 'ai:' });

// 助理的權限門檻各站不同（見 src/ai/context.js 的 AGENT_MODULES），
// 沒啟用的助理連端點都不該存在 —— 回 403「沒權限」會讓人以為是權限問題，
// 但其實這個站根本沒有這個功能。
function agentGate(key) {
  const enabled = key in ctx.AGENT_MODULES;
  const guard = enabled ? requireStaff(ctx.AGENT_MODULES[key] || undefined) : null;
  return (req, res, next) => enabled ? guard(req, res, next)
    : res.status(404).json({ error: '本站沒有啟用這個 AI 助理' });
}

// 影像上限。base64 會膨脹約 1/3，這裡抓 6MB 原始大小，
// 超過就請使用者先縮圖 —— 直接送過去只會在對面被拒。
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function parseImage(dataUri) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUri || ''));
  if (!m) { const e = new Error('請上傳圖片檔'); e.status = 400; throw e; }
  const [, media_type, data] = m;
  if (!IMAGE_TYPES.has(media_type)) {
    const e = new Error(`不支援的圖片格式（${media_type}），請用 JPG 或 PNG`); e.status = 400; throw e;
  }
  if (Buffer.byteLength(data, 'base64') > MAX_IMAGE_BYTES) {
    const e = new Error('圖片超過 6MB，請先縮小再上傳'); e.status = 400; throw e;
  }
  return { media_type, data };
}

function text(req, field, max = 20000) {
  const v = String((req.body || {})[field] || '').trim();
  if (!v) { const e = new Error('請先輸入內容'); e.status = 400; throw e; }
  if (v.length > max) { const e = new Error(`內容過長（上限 ${max} 字）`); e.status = 400; throw e; }
  return v;
}

// 這一層自己接錯誤：各站的錯誤處理中介層長得不一樣（有的沒有），
// 交給 next(e) 在某些站會變成 500 而且訊息吃掉。
function fail(res, e) {
  res.status(e.status || 500).json({ error: e.message || '系統錯誤' });
}

// ---- 狀態：現在用哪一家、是不是模擬模式、這個月花了多少 ----
router.get('/ai/status', requireStaff(), (req, res) => {
  const st = provider.status();
  const usage = db.prepare(`SELECT COUNT(*) runs, COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout,
      SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) errors,
      SUM(CASE WHEN adopted_at <> '' THEN 1 ELSE 0 END) adopted,
      SUM(CASE WHEN simulated=1 THEN 1 ELSE 0 END) simulated
    FROM ai_runs WHERE created_at >= date('now','localtime','start of month')`).get();
  res.json({
    ...st,
    agents: Object.values(agents.AGENTS).map(a => ({ key: a.name, label: a.label, module: a.module })),
    copy: ctx.COPY,
    perm: ctx.PERM,
    samples: ctx.SAMPLE_QUESTIONS || [],
    doc_types: ctx.DOC_TYPES,
    languages: ctx.LANGUAGES,
    reports: ctx.REPORTS.map(r => ({ key: r.key, label: r.label, desc: r.desc })),
    month_usage: usage
  });
});

// ---- 一、問資料庫 ----
// 不綁單一模組：AI 挑中報表之後才依那張報表的模組檢查權限（在 agents.askdb.normalize 裡）。
router.post('/ai/ask', agentGate('askdb'), aiLimit, async (req, res) => {
  try {
    res.json(await agents.execute('askdb', { question: text(req, 'question', 500) }, req.user));
  } catch (e) { fail(res, e); }
});

// ---- 二、文件辨識 ----
router.post('/ai/ocr', agentGate('ocr'), aiLimit, async (req, res) => {
  try {
    const images = [parseImage((req.body || {}).image)];
    const docType = String((req.body || {}).doc_type || '');
    if (docType && !ctx.DOC_TYPES.some(d => d.key === docType)) {
      return res.status(400).json({ error: '沒有這個文件類型' });
    }
    // 證件影像本身不留在 ai_runs（那張表只留 200 字預覽），這裡也不落地。
    // 要存檔請走既有的附件上傳，那條路有完整性檢查與存取控制。
    res.json(await agents.execute('ocr', { doc_type: docType, images }, req.user));
  } catch (e) { fail(res, e); }
});

// ---- 三、多語文案 ----
router.post('/ai/i18n', agentGate('i18n'), aiLimit, async (req, res) => {
  try {
    res.json(await agents.execute('i18n', {
      text: text(req, 'text', 4000),
      context: String((req.body || {}).context || '').slice(0, 500)
    }, req.user));
  } catch (e) { fail(res, e); }
});

// ---- 採用軌跡 ----
router.post('/ai/runs/:id/adopt', requireStaff(), (req, res) => {
  const ok = agents.markAdopted(Number(req.params.id), (req.body || {}).ref, req.user);
  if (!ok) return res.status(404).json({ error: '找不到這筆 AI 紀錄' });
  res.json({ ok: true });
});

// ---- 紀錄 ----
// 放在稽核軌跡（沒有稽核模組的站放系統設定）的權限底下：這張表裡有
// 「誰在什麼時候丟了什麼給 AI」，跟稽核軌跡是同一種東西，不該比它更容易看到。
router.get('/ai/runs', requireStaff(ctx.PERM.audit), (req, res) => {
  const where = [], args = [];
  if (req.query.agent) { where.push('agent = ?'); args.push(String(req.query.agent)); }
  if (req.query.status) { where.push('status = ?'); args.push(String(req.query.status)); }
  if (req.query.adopted === '1') where.push("adopted_at <> ''");
  const sql = `SELECT id, agent, provider, model, simulated, status, error, ms, tokens_in, tokens_out,
      input_preview, actor_name, adopted_at, adopted_ref, created_at
    FROM ai_runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ?`;
  res.json({
    rows: db.prepare(sql).all(...args, Math.min(Number(req.query.limit) || 200, 500)),
    // 每個助理提了幾次、被採用幾次。功能有沒有用看這個，不是看提示調得漂不漂亮。
    by_agent: db.prepare(`SELECT agent, COUNT(*) runs,
        SUM(CASE WHEN adopted_at <> '' THEN 1 ELSE 0 END) adopted,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) errors,
        COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout
      FROM ai_runs GROUP BY agent ORDER BY runs DESC`).all()
  });
});

router.get('/ai/runs/:id', requireStaff(ctx.PERM.audit), (req, res) => {
  const row = db.prepare('SELECT * FROM ai_runs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到這筆 AI 紀錄' });
  res.json(row);
});

// ---- 設定 ----
// 只能改「用哪一家、哪個模型、思考深度」。金鑰在 .env，不經過這裡也不回傳。
const SETTING_KEYS = ['ai_provider', 'ai_model_anthropic', 'ai_model_openai', 'ai_effort'];
router.get('/ai/settings', requireStaff(ctx.PERM.settings), (req, res) => {
  res.json({
    ai_provider: getSetting('ai_provider', 'auto'),
    ai_model_anthropic: getSetting('ai_model_anthropic', ''),
    ai_model_openai: getSetting('ai_model_openai', ''),
    ai_effort: getSetting('ai_effort', 'medium'),
    defaults: { anthropic: provider.ANTHROPIC_MODEL_DEFAULT, openai: provider.OPENAI_MODEL_DEFAULT },
    efforts: provider.EFFORTS,
    status: provider.status()
  });
});

router.put('/ai/settings', requireStaff(ctx.PERM.settings), (req, res) => {
  const b = req.body || {};
  const want = String(b.ai_provider || 'auto');
  if (!['auto', 'anthropic', 'openai', 'mock'].includes(want)) {
    return res.status(400).json({ error: '供應商只能是 auto／anthropic／openai／mock' });
  }
  const effort = String(b.ai_effort || 'medium');
  if (!provider.EFFORTS.includes(effort)) return res.status(400).json({ error: '沒有這個思考深度' });
  setSetting('ai_provider', want);
  setSetting('ai_model_anthropic', String(b.ai_model_anthropic || '').trim().slice(0, 60));
  setSetting('ai_model_openai', String(b.ai_model_openai || '').trim().slice(0, 60));
  setSetting('ai_effort', effort);
  audit(req.user, `調整 AI 設定：供應商 ${want}、思考深度 ${effort}`);
  res.json({ ok: true, status: provider.status() });
});

module.exports = router;
module.exports.SETTING_KEYS = SETTING_KEYS;
