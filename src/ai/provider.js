// AI 供應商抽象層：Claude（Anthropic）／OpenAI／模擬模式。
//
// 這個檔在所有站台完全相同。跟站台有關的只有一件事：設定值從哪裡讀 ——
// 各站的 db.js 匯出的名字不完全一樣，所以統一由 src/ai/context.js 的 deps 提供。
//
// 三個刻意的設計決定：
//
// 1. **未設金鑰走模擬模式**，跟各站 notify.js 的 LINE 通知一樣。
//    示範、教育訓練與測試都不必先申請 API 金鑰，程式路徑與畫面照樣完整可驗證。
//    模擬模式用規則式抽取，不是隨機假資料 —— 假資料會讓人以為功能好了。
//
// 2. **金鑰只從環境變數讀，不進資料庫**。設定頁能改的是「用哪一家、用哪個模型」，
//    不是金鑰本身。金鑰存進 settings 表就會出現在畫面上、備份裡與稽核軌跡裡。
//
// 3. **結構化輸出用「強制工具呼叫 + strict schema」**，不是叫模型「請回傳 JSON」。
//    後者在長輸入時會夾帶說明文字，JSON.parse 就炸了，而且是偶發的。
const { deps } = require('./context');
const getSetting = (k, d) => deps.getSetting(k, d);

const ANTHROPIC_MODEL_DEFAULT = 'claude-opus-5';
const OPENAI_MODEL_DEFAULT = 'gpt-4o';

function anthropicKey() { return (process.env.ANTHROPIC_API_KEY || '').trim(); }
function openaiKey() { return (process.env.OPENAI_API_KEY || '').trim(); }

// 用哪一家。設定值 auto（預設）＝有哪家的金鑰就用哪家，都沒有就模擬。
// 明確指定 anthropic／openai 但缺金鑰時**退回模擬而不是報錯** ——
// 櫃檯不該因為老闆忘記續費 API 就整頁壞掉。
function resolveProvider() {
  const want = getSetting('ai_provider', 'auto');
  if (want === 'mock') return 'mock';
  if (want === 'anthropic') return anthropicKey() ? 'anthropic' : 'mock';
  if (want === 'openai') return openaiKey() ? 'openai' : 'mock';
  if (anthropicKey()) return 'anthropic';
  if (openaiKey()) return 'openai';
  return 'mock';
}

function resolveModel(provider) {
  if (provider === 'anthropic') return String(getSetting('ai_model_anthropic', '') || '').trim() || ANTHROPIC_MODEL_DEFAULT;
  if (provider === 'openai') return String(getSetting('ai_model_openai', '') || '').trim() || OPENAI_MODEL_DEFAULT;
  return 'mock';
}

// 思考深度。櫃檯是即時操作，等 20 秒沒有人會用 —— 所以預設不是最高。
// 抽帳、對法規那類「錯了很貴」的用途再往上調。
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
function resolveEffort() {
  const e = getSetting('ai_effort', 'medium');
  return EFFORTS.includes(e) ? e : 'medium';
}

function status() {
  const provider = resolveProvider();
  return {
    provider,
    model: resolveModel(provider),
    effort: resolveEffort(),
    simulated: provider === 'mock',
    configured: { anthropic: !!anthropicKey(), openai: !!openaiKey() },
    // 設定頁要顯示「為什麼現在是模擬模式」，否則使用者會以為系統壞了
    reason: provider !== 'mock' ? ''
      : (getSetting('ai_provider', 'auto') === 'mock'
        ? '系統設定指定為模擬模式'
        : '未在 .env 設定 ANTHROPIC_API_KEY 或 OPENAI_API_KEY')
  };
}

let _anthropic, _openai;
function anthropicClient() {
  if (!_anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: anthropicKey(), maxRetries: 2 });
  }
  return _anthropic;
}
function openaiClient() {
  if (!_openai) {
    const OpenAI = require('openai');
    _openai = new OpenAI({ apiKey: openaiKey(), maxRetries: 2 });
  }
  return _openai;
}

// ---- 統一入口 ----
//
// task = { name, system, user, images, schema, mock }
//   user   是文字；images 是 [{ media_type, data }]（data 為 base64，不含 data: 前綴）
//   schema 是 JSON Schema（object，additionalProperties:false，required 齊全）
//   mock   是 (task) => object，模擬模式下用它產生同樣形狀的結果
//
// 回傳 { data, meta:{ provider, model, ms, usage, simulated } }
// 一律回傳 schema 形狀的物件；解析不出來就 throw，不回半套資料。
async function run(task) {
  const provider = resolveProvider();
  const model = resolveModel(provider);
  const started = Date.now();

  let data, usage = { input: 0, output: 0 };
  if (provider === 'mock') {
    data = task.mock(task);
  } else if (provider === 'anthropic') {
    ({ data, usage } = await runAnthropic(task, model));
  } else {
    ({ data, usage } = await runOpenAI(task, model));
  }
  return {
    data,
    meta: { provider, model, ms: Date.now() - started, usage, simulated: provider === 'mock' }
  };
}

// 影像放在文字之前：文件辨識時「先看到圖再讀指示」的順序，兩家的建議都一樣。
function anthropicContent(task) {
  if (!task.images || !task.images.length) return task.user;
  return [
    ...task.images.map(im => ({
      type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data }
    })),
    { type: 'text', text: task.user }
  ];
}

function openaiContent(task) {
  if (!task.images || !task.images.length) return task.user;
  return [
    ...task.images.map(im => ({
      type: 'image_url', image_url: { url: `data:${im.media_type};base64,${im.data}` }
    })),
    { type: 'text', text: task.user }
  ];
}

async function runAnthropic(task, model) {
  const client = anthropicClient();
  const toolName = 'submit_' + task.name;
  const res = await client.messages.create({
    model,
    max_tokens: 16000,
    output_config: { effort: resolveEffort() },
    system: [{ type: 'text', text: task.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: anthropicContent(task) }],
    tools: [{
      name: toolName,
      description: '把抽取結果交回系統。所有欄位都要填，不確定的填空字串或空陣列，不要自己編。',
      strict: true,
      input_schema: task.schema
    }],
    tool_choice: { type: 'tool', name: toolName }
  });
  // Opus 5 可能因安全分類拒答（HTTP 200 但 stop_reason 是 refusal），要先擋掉再讀 content
  if (res.stop_reason === 'refusal') {
    const e = new Error('AI 拒絕處理這段內容' + (res.stop_details && res.stop_details.explanation ? `：${res.stop_details.explanation}` : ''));
    e.status = 400;
    throw e;
  }
  const block = res.content.find(b => b.type === 'tool_use' && b.name === toolName);
  if (!block) throw new Error('AI 沒有回傳結構化結果，請重試');
  return {
    // input 是模型產的 JSON，一律當外部資料看待：後面還會過 agents.js 的正規化
    data: block.input,
    usage: {
      input: (res.usage.input_tokens || 0) + (res.usage.cache_read_input_tokens || 0)
        + (res.usage.cache_creation_input_tokens || 0),
      output: res.usage.output_tokens || 0
    }
  };
}

async function runOpenAI(task, model) {
  const client = openaiClient();
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: task.system },
      { role: 'user', content: openaiContent(task) }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: task.name, strict: true, schema: task.schema }
    }
  });
  const choice = res.choices && res.choices[0];
  if (!choice || choice.finish_reason === 'content_filter') throw new Error('AI 拒絕處理這段內容');
  const text = (choice.message && choice.message.content) || '';
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('AI 回傳的內容不是有效 JSON，請重試'); }
  return {
    data,
    usage: { input: (res.usage && res.usage.prompt_tokens) || 0, output: (res.usage && res.usage.completion_tokens) || 0 }
  };
}

module.exports = { run, status, resolveProvider, resolveModel, resolveEffort, EFFORTS,
  ANTHROPIC_MODEL_DEFAULT, OPENAI_MODEL_DEFAULT };
