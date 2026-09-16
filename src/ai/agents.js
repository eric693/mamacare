// 三個 AI 助理：問資料庫、文件辨識、多語文案。
// 這個檔在所有站台完全相同，站台差異全部收在 src/ai/context.js。
//
// 貫穿全檔的一條規則：**AI 只產生草稿，永遠不寫入資料庫。**
//
// 理由不是保守，是責任歸屬。這些系統的價值在那些硬閘門上（證照失效擋派工、
// 給付額度不能超用、預收要對得上負債）。模型繞過閘門寫進去的資料，
// 出事時沒有人能解釋它為什麼長那樣 —— 而營運系統最貴的就是無法解釋的資料。
//
// 所以每個 agent 的產出都要經過三道：
//   1. schema 強制（strict tool call，形狀一定對）
//   2. normalize（把 AI 給的 id 拿回資料庫驗一次，對不到就標成待確認，不自動建檔）
//   3. 使用者自己到既有畫面建檔（該擋的閘門照樣擋）
const ctx = require('./context');
const provider = require('./provider');
const { db, today, thisMonth, nowStamp, audit } = ctx.deps;

// ============================================================
// 共用：把 AI 回來的東西當外部資料看待
// ============================================================
const str = v => (v === null || v === undefined) ? '' : String(v).trim();
const int = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };
const arr = v => Array.isArray(v) ? v : [];
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

// 送進提示的清單要壓成一行一筆，JSON 排版會白白多燒 3 倍 token
const lines = (rows, fn) => rows.map(fn).join('\n');

const BASE_SYSTEM = () => [
  `你是「${ctx.SITE.name}」後台系統裡的助理。`,
  ctx.SITE.business,
  '',
  '你的產出一律是**草稿**，會由承辦人員過目後才決定要不要採用。所以：',
  '- 不確定的欄位留空，不要猜。留空會被標成「待確認」由人補；猜錯會被當成真的。',
  '- 只能從系統給你的清單裡挑 id。清單裡沒有的，id 填 0 並把原文寫在名稱欄位。',
  '- 不要自己發明人員、服務項目或個案。',
  `- 今天是 ${today()}（台北時間），本月是 ${thisMonth()}。`
].join('\n');

// ============================================================
// 一、自然語言問資料庫
// ============================================================
//
// 這裡刻意**不讓模型寫 SQL**。
// 讓它對 production 產 SQL 有三個問題：跑得動但算錯不會有人發現；
// 一個 typo 就能掃全表；而且答案跟使用者自己點進報表看到的可能對不起來。
// 改成「意圖分類 + 參數抽取」之後，答案永遠是既有報表算出來的，對得上帳。
const askdb = {
  name: 'askdb',
  get module() { return ctx.AGENT_MODULES['askdb']; },
  label: '問資料庫',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['report_key', 'params', 'answerable', 'restated', 'why'],
    properties: {
      report_key: { type: 'string', description: '從報表清單挑一個 key；沒有合適的填空字串' },
      params: {
        type: 'object', additionalProperties: false,
        required: ['date', 'month', 'entity_id', 'keyword', 'days', 'status'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD，用不到就空字串' },
          month: { type: 'string', description: 'YYYY-MM，用不到就空字串' },
          entity_id: { type: 'integer', description: '問題指名的人員／單位 id（見下方清單），用不到填 0' },
          keyword: { type: 'string', description: '姓名或編號等搜尋字，用不到就空字串' },
          days: { type: 'integer', description: '天數（例如 60 天內到期），用不到填 0' },
          status: { type: 'string', description: '狀態篩選，用不到就空字串' }
        }
      },
      answerable: { type: 'boolean', description: '這個問題能不能用清單裡的報表回答' },
      restated: { type: 'string', description: '把問題換句話說一遍，讓使用者確認你有聽懂' },
      why: { type: 'string', description: '為什麼挑這張報表；answerable 為 false 時說明系統目前查不到什麼' }
    }
  },

  buildTask(input) {
    const system = [
      BASE_SYSTEM(),
      '',
      '## 你的任務',
      '把使用者的口語問題，對應到系統既有的一張報表，並抽出要帶的參數。',
      '',
      '**你不能自己算答案，也不能寫 SQL。** 你只負責挑報表和填參數，數字由系統自己算。',
      '如果清單裡沒有能回答的報表，answerable 填 false 並在 why 說明系統目前沒有這項資料 —— 不要硬選一個接近的。',
      '',
      '## 可用的報表（key｜名稱｜說明｜可帶參數）',
      lines(ctx.REPORTS, r => `${r.key}｜${r.label}｜${r.desc}｜${r.params.join(',') || '無'}`),
      // 問題裡可能提到人名（「王小明這個月幾個小時」），要對得上 id 才能帶參數。
      // 哪些實體算「人」是站台的事，不是這個檔該知道的 —— 由 context.js 提供。
      ...(ctx.askEntities ? ctx.askEntities().map(sec => `\n## ${sec.title}\n${sec.body}`) : [])
    ].join('\n');
    return {
      name: 'askdb', system, schema: askdb.schema,
      user: `使用者的問題：${input.question}`,
      mock: () => askdb.mockPick(input.question)
    };
  },

  // 模擬模式：從報表清單自己推導關鍵字，命中最多字的那一張勝出。
  //
  // 刻意不寫死一張「關鍵字 → 報表」對照表：那種表在新增報表時一定會忘記更新，
  // 然後模擬模式就會永遠答不出新報表，而且不會有任何錯誤訊息。
  // 從 label 與 desc 推導雖然笨，但它跟著報表清單一起長大。
  mockPick(question) {
    const q = String(question || '');
    const grams = text => {
      const out = new Set();
      for (const seg of String(text).split(/[^一-龥A-Za-z0-9]+/)) {
        for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= seg.length; i++) out.add(seg.slice(i, i + n));
      }
      return out;
    };
    let best = null, bestScore = 0;
    for (const r of ctx.REPORTS) {
      let score = 0;
      for (const g of grams(`${r.label} ${r.desc}`)) if (q.includes(g)) score += g.length;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    // 分數太低就是沒命中 —— 硬選一張接近的比誠實說不知道更糟
    if (bestScore < 4) best = null;

    // 問題裡提到的人／單位，對得上就帶 id
    let entityId = 0;
    for (const sec of (ctx.askEntities ? ctx.askEntities() : [])) {
      for (const line of sec.body.split('\n')) {
        const parts = line.split('｜');
        const id = Number(parts[0]);
        if (!id) continue;
        if (parts.slice(1).some(v => v && v.length >= 2 && q.includes(v))) { entityId = id; break; }
      }
      if (entityId) break;
    }

    const mon = q.match(/(20\d{2})[-/年](\d{1,2})/);
    const params = { date: '', month: '', entity_id: 0, keyword: '', days: 0, status: '' };
    if (best) {
      if (best.params.includes('date') && /今天|今日/.test(q)) params.date = today();
      if (best.params.includes('month')) {
        params.month = mon ? `${mon[1]}-${String(mon[2]).padStart(2, '0')}`
          : (q.includes('上個月') ? prevMonth() : (q.includes('這個月') || q.includes('本月') ? thisMonth() : ''));
      }
      if (best.params.includes('days') && /到期|快過期|多久|逾期|幾天/.test(q)) params.days = 60;
      if (best.params.includes('entity_id')) params.entity_id = entityId;
    }
    return {
      report_key: best ? best.key : '',
      params,
      answerable: !!best,
      restated: q,
      why: best ? '（模擬模式：用報表名稱與說明做關鍵字比對挑中的）'
        : '（模擬模式：關鍵字沒有命中任何報表。真正呼叫 AI 時判斷會準得多。）'
    };
  },

  normalize(raw, user) {
    const key = str(raw.report_key);
    const report = ctx.REPORTS.find(r => r.key === key) || null;
    const p = raw.params || {};
    const warn = [];
    if (key && !report) warn.push(`AI 挑了一張不存在的報表「${key}」`);

    // 權限：AI 挑中的報表使用者不見得有權限看。這裡擋住，不然就變成越權查詢的後門。
    let allowed = true;
    if (report && user && user.role !== 'admin') {
      const mods = ctx.guard.parsePermissions(user.permissions);
      allowed = !report.module || mods.includes(report.module);
      if (!allowed) warn.push(`這張報表需要「${report.label}」模組權限，你的帳號沒有`);
    }

    const params = {};
    if (report) {
      // 只留這張報表真的吃的參數，多的丟掉 —— 前端帶著無效參數過去只會被忽略，徒增困惑
      if (report.params.includes('date') && isDate(str(p.date))) params.date = str(p.date);
      if (report.params.includes('month') && /^\d{4}-\d{2}$/.test(str(p.month))) params.month = str(p.month);
      if (report.params.includes('days') && int(p.days) > 0) params.days = Math.min(int(p.days), 3650);
      if (report.params.includes('keyword') && str(p.keyword)) params.keyword = str(p.keyword).slice(0, 50);
      if (report.params.includes('status') && str(p.status)) params.status = str(p.status).slice(0, 20);
      if (report.params.includes('entity_id') && int(p.entity_id)) {
        const ent = ctx.resolveEntity ? ctx.resolveEntity(int(p.entity_id)) : null;
        if (ent) params[ctx.ENTITY_PARAM || 'entity_id'] = ent.id;
        else warn.push('AI 給的人員 id 在系統裡不存在，已忽略');
      }
    }
    const qs = new URLSearchParams(params).toString();
    return {
      answerable: !!(report && raw.answerable !== false && allowed),
      report: report ? { key: report.key, label: report.label, module: report.module, desc: report.desc } : null,
      params,
      // 前端就是跳到這個 hash。答案由既有頁面自己算，AI 沒碰過任何數字。
      goto: report && allowed ? `#${report.page}${qs ? '?' + qs : ''}` : '',
      restated: str(raw.restated),
      why: str(raw.why),
      warnings: warn
    };
  }
};

function prevMonth() {
  const d = new Date(today() + 'T00:00:00');
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ============================================================
// 二、文件辨識進系統
// ============================================================
//
// 現實是客戶與廠商給的不是 CSV，是照片和 PDF。
// 這個 agent 只負責「照片 → 欄位」，寫入一樣走既有的建檔畫面。
const ocr = {
  name: 'ocr',
  get module() { return ctx.AGENT_MODULES['ocr']; },
  label: '文件辨識',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['doc_type', 'fields', 'unreadable', 'notes'],
    properties: {
      doc_type: { type: 'string', description: '判斷這是哪一類文件，填清單裡的 key；認不出來填空字串' },
      fields: {
        type: 'array',
        description: '抽到的欄位，一個欄位一筆',
        items: {
          type: 'object', additionalProperties: false,
          required: ['label', 'value', 'confidence'],
          properties: {
            label: { type: 'string', description: '欄位名稱，用清單裡給的中文名稱' },
            value: { type: 'string', description: '欄位值；日期一律轉成 YYYY-MM-DD（民國年要換算成西元）' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: '看得清不清楚' }
          }
        }
      },
      unreadable: { type: 'array', items: { type: 'string' }, description: '哪些欄位看不清楚或被遮住' },
      notes: { type: 'string', description: '其他要提醒承辦的事，例如證件已過期、影像模糊、疑似非正本' }
    }
  },

  buildTask(input) {
    const known = ctx.DOC_TYPES;
    const picked = known.find(d => d.key === input.doc_type);
    const system = [
      BASE_SYSTEM(),
      '',
      '## 你的任務',
      '看這張文件影像，把欄位抄下來。你是在「抄」，不是在「推測」。',
      '',
      '- 看不清楚的欄位，value 留空並寫進 unreadable。**不要用常見值補**。',
      '- 民國年要換算成西元（民國 113 年 = 2024 年），日期一律 YYYY-MM-DD。',
      '- 證件號碼、統編這類有格式的欄位，照抄，不要「修正」看起來怪的字元。',
      '- 如果影像根本不是文件（例如自拍、風景照），doc_type 留空並在 notes 說明。',
      '',
      '## 文件類型與要抽的欄位',
      lines(known, d => `${d.key}｜${d.label}｜寫入目標：${d.target}｜欄位：${d.fields.join('、')}`),
      picked ? `\n承辦指定這是「${picked.label}」，請優先照這個類型抽欄位；如果影像明顯不是，以你看到的為準並在 notes 說明。` : ''
    ].join('\n');
    return {
      name: 'ocr', system, schema: ocr.schema,
      user: '請辨識這份文件。',
      images: input.images,
      // 模擬模式讀不了影像，所以誠實回空手 —— 給假欄位會讓人以為功能好了
      mock: () => ({
        doc_type: str(input.doc_type),
        fields: (picked ? picked.fields : []).map(f => ({ label: f, value: '', confidence: 'low' })),
        unreadable: picked ? picked.fields.slice() : [],
        notes: '模擬模式無法辨識影像。請在 .env 設定 ANTHROPIC_API_KEY 或 OPENAI_API_KEY 後再試。'
      })
    };
  },

  normalize(raw) {
    const dt = ctx.DOC_TYPES.find(d => d.key === str(raw.doc_type)) || null;
    const warn = [];
    const fields = arr(raw.fields).map(f => {
      const value = str(f.value);
      const label = str(f.label);
      // 日期欄位再驗一次格式：民國年沒換算是最常見的錯，而且錯了很難用肉眼看出來
      const looksDate = /日期|期限|起日|迄日|生日|到期/.test(label);
      const bad = looksDate && value && !isDate(value);
      if (bad) warn.push(`「${label}」的值「${value}」不是 YYYY-MM-DD，請人工確認`);
      return {
        label, value,
        confidence: ['high', 'medium', 'low'].includes(str(f.confidence)) ? str(f.confidence) : 'low',
        needs_check: bad || !value || str(f.confidence) === 'low'
      };
    }).filter(f => f.label);
    // 該有的欄位一個都沒抽到時要講出來，不然畫面上就是一片空白沒人知道發生什麼事
    if (dt) {
      for (const want of dt.fields) {
        if (!fields.some(f => f.label === want)) fields.push({ label: want, value: '', confidence: 'low', needs_check: true });
      }
    }
    return {
      doc_type: dt ? dt.key : '',
      doc_label: dt ? dt.label : '（無法判斷類型）',
      target: dt ? dt.target : '',
      fields,
      unreadable: arr(raw.unreadable).map(str).filter(Boolean),
      notes: str(raw.notes),
      warnings: warn
    };
  }
};

// ============================================================
// 三、多語文案生成
// ============================================================
//
// 產出一律標記為「未校對」。把「請母語人員校對」變成資料上的一個狀態，
// 而不是 README 裡一句沒有人會照做的提醒。
const i18n = {
  name: 'i18n',
  get module() { return ctx.AGENT_MODULES['i18n']; },
  label: '多語文案',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['translations', 'banned_terms', 'notes'],
    properties: {
      translations: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['lang', 'text'],
          properties: {
            lang: { type: 'string', description: '語言代碼' },
            text: { type: 'string', description: '譯文' }
          }
        }
      },
      banned_terms: {
        type: 'array', items: { type: 'string' },
        description: '原文裡疑似踩到本站法規紅線的字詞'
      },
      notes: { type: 'string', description: '翻譯上的取捨說明，例如某個詞在該語言沒有對應說法' }
    }
  },

  buildTask(input) {
    const langs = ctx.LANGUAGES.filter(l => l.code !== 'zh');
    const system = [
      BASE_SYSTEM(),
      '',
      '## 你的任務',
      '把中文文案翻成其他語言，產出**初稿**。這份初稿會被標記為「未校對」，要母語人員確認後才會使用。',
      '',
      `- 對象是${ctx.SITE.audience || '本站的客戶與員工'}，語氣要自然口語，不是公文。`,
      ...(ctx.BANNED_HINT ? [`- ${ctx.BANNED_HINT}`, '  原文如果有，照樣翻成不踩線的說法，並把原文的問題字詞列在 banned_terms。'] : []),
      '- 機構名稱、專有名詞保留原樣，不要意譯。',
      '- 要用該語言真正的說法，不要從英文直譯。',
      '',
      '## 要產出的語言',
      lines(langs, l => `${l.code}｜${l.label}`),
      input.context ? `\n## 這段文字用在哪裡\n${input.context}` : ''
    ].join('\n');
    return {
      name: 'i18n', system, schema: i18n.schema,
      user: `請翻譯以下文案：\n\n${input.text}`,
      mock: () => ({
        translations: langs.map(l => ({ lang: l.code, text: '' })),
        banned_terms: (ctx.BANNED_TERMS || []).filter(w => String(input.text || '').includes(w)),
        notes: '模擬模式不產生譯文。請在 .env 設定 ANTHROPIC_API_KEY 或 OPENAI_API_KEY 後再試。'
      })
    };
  },

  normalize(raw, user, input) {
    const warn = [];
    const byLang = new Map(arr(raw.translations).map(t => [str(t.lang), str(t.text)]));
    const translations = ctx.LANGUAGES.filter(l => l.code !== 'zh').map(l => {
      const text = byLang.get(l.code) || '';
      if (!text) warn.push(`${l.label} 沒有產出譯文`);
      return {
        lang: l.code, label: l.label, text,
        // 一律 false。這個欄位存在的意義就是「AI 產的東西預設不可信」，
        // 沒有任何路徑能讓它一開始就是 true。
        reviewed: false
      };
    });
    return {
      source: str(input && input.text),
      translations,
      banned_terms: arr(raw.banned_terms).map(str).filter(Boolean),
      notes: str(raw.notes),
      warnings: warn
    };
  }
};

// 只暴露這個站台啟用的助理。沒宣告在 AGENT_MODULES 裡的就不存在 ——
// 端點會回 404，畫面上也不會出現那個頁籤。
const ALL = { askdb, ocr, i18n };
const AGENTS = Object.fromEntries(
  Object.keys(ALL).filter(k => k in ctx.AGENT_MODULES).map(k => [k, ALL[k]]));

// ============================================================
// 執行 + 留紀錄
// ============================================================
async function execute(agentKey, input, user) {
  const agent = AGENTS[agentKey];
  if (!agent) { const e = new Error('沒有這個 AI 助理'); e.status = 404; throw e; }
  const task = agent.buildTask(input);
  const preview = String(input.text || input.question || task.user).slice(0, 200);

  let out, meta;
  try {
    ({ data: out, meta } = await provider.run(task));
  } catch (e) {
    // 失敗也要留紀錄：使用者回報「AI 又壞了」時，這是唯一查得到的東西
    const st = provider.status();
    db.prepare(`INSERT INTO ai_runs(agent,provider,model,simulated,status,error,input_preview,actor_id,actor_name)
                VALUES(?,?,?,?,'error',?,?,?,?)`)
      .run(agentKey, st.provider, st.model, st.simulated ? 1 : 0,
        String(e.message).slice(0, 500), preview, user ? user.id : null, user ? user.name : '');
    throw e;
  }

  const result = agent.normalize(out, user, input);
  const run = db.prepare(`INSERT INTO ai_runs(agent,provider,model,simulated,status,ms,tokens_in,tokens_out,
                            input_preview,output_json,actor_id,actor_name)
                          VALUES(?,?,?,?,'ok',?,?,?,?,?,?,?)`)
    .run(agentKey, meta.provider, meta.model, meta.simulated ? 1 : 0, meta.ms,
      meta.usage.input, meta.usage.output, preview, JSON.stringify(result),
      user ? user.id : null, user ? user.name : '');

  return { run_id: run.lastInsertRowid, ...result, meta };
}

// 使用者按「採用」之後回填。這條軌跡是判斷這個功能到底有沒有用的唯一誠實指標 ——
// 提了 500 次、採用 6 次的功能，該砍掉而不是繼續調提示。
function markAdopted(runId, ref, user) {
  const r = db.prepare('SELECT * FROM ai_runs WHERE id = ?').get(runId);
  if (!r) return null;
  db.prepare('UPDATE ai_runs SET adopted_at = ?, adopted_ref = ? WHERE id = ?')
    .run(nowStamp(), String(ref || '').slice(0, 200), runId);
  // audit 的參數在各站不一樣，由 context.js 的 deps.audit(user, msg) 轉接
  audit(user, `採用 AI 草稿 #${runId}（${r.agent}）→ ${ref}`);
  return true;
}

module.exports = { AGENTS, execute, markAdopted };
