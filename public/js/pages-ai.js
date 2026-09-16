// AI 助理：問資料庫、文件辨識、多語文案、設定與使用紀錄。
//
// 這一頁的每個功能都只產「草稿」。畫面上刻意到處寫著這件事 ——
// 使用者要清楚知道螢幕上的東西還沒有進系統。
//
// 這個檔在所有站台完全相同，所以它**只依賴每個站都有的東西**：
// App.page／App.can／GET／POST，以及 UI.esc、UI.toast（沒有就用本地退路）。
// 表格、標籤、檔案欄位都在這裡自己畫，不使用各站不一定存在的 UI helper；
// 版面樣式也在這裡注入，避免某個站剛好沒有 .tabs 或 .chip 而排版爛掉。
(function () {
  const esc = s => (window.UI && UI.esc) ? UI.esc(s)
    : String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (msg, bad) => (window.UI && UI.toast) ? UI.toast(msg, bad) : alert(msg);
  const num = n => Number(n || 0).toLocaleString('en-US');

  // 只注入一次；用 ai- 前綴避免撞到各站既有的樣式
  const STYLE = `
  .ai-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
  .ai-tabs button{padding:6px 14px;border:1px solid #d7dbe0;background:#fff;border-radius:999px;cursor:pointer;font-size:14px}
  .ai-tabs button.active{background:#2b6cb0;color:#fff;border-color:#2b6cb0}
  .ai-box{border:1px solid #e2e6ea;border-radius:8px;padding:14px;margin:12px 0;background:#fff}
  .ai-box h3{margin:0 0 6px;font-size:16px}
  .ai-note{border-radius:6px;padding:10px 12px;margin:10px 0;font-size:14px;line-height:1.6}
  .ai-note.info{background:#eef5fb;border:1px solid #cfe0f0}
  .ai-note.ok{background:#eefbf1;border:1px solid #c7ecd2}
  .ai-note.warn{background:#fff8e6;border:1px solid #f0dfae}
  .ai-note.bad{background:#fdeeee;border:1px solid #f2c8c8}
  .ai-muted{color:#6b7280;font-size:13px}
  .ai-field{display:block;margin:8px 0}
  .ai-field>span{display:block;font-size:13px;color:#374151;margin-bottom:4px}
  .ai-field input[type=text],.ai-field textarea,.ai-field select{width:100%;box-sizing:border-box;padding:8px;
    border:1px solid #d7dbe0;border-radius:6px;font:inherit}
  .ai-btn{padding:8px 16px;border:0;border-radius:6px;background:#2b6cb0;color:#fff;cursor:pointer;font:inherit;margin-right:6px}
  .ai-btn.sec{background:#eceff3;color:#243}
  .ai-btn:disabled{opacity:.6;cursor:progress}
  .ai-tbl{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
  .ai-tbl th,.ai-tbl td{border-bottom:1px solid #eef0f2;padding:7px 8px;text-align:left;vertical-align:top}
  .ai-tbl th{background:#f7f9fb;font-weight:600;white-space:nowrap}
  .ai-tbl tr.warn td{background:#fffdf2}
  .ai-tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid}
  .ai-tag.ok{background:#eefbf1;border-color:#c7ecd2;color:#186a3b}
  .ai-tag.warn{background:#fff8e6;border-color:#f0dfae;color:#8a6100}
  .ai-tag.bad{background:#fdeeee;border-color:#f2c8c8;color:#a12727}
  .ai-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .ai-chip{border:1px dashed #c9d2db;border-radius:999px;padding:4px 10px;font-size:13px;cursor:pointer;color:#2b6cb0}
  .ai-pre{white-space:pre-wrap;background:#f7f9fb;border:1px solid #eef0f2;border-radius:6px;padding:10px;font-size:14px}`;
  function injectStyle() {
    if (document.getElementById('ai-style')) return;
    const s = document.createElement('style');
    s.id = 'ai-style'; s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const tag = (text, kind) => `<span class="ai-tag ${kind || 'ok'}">${esc(text)}</span>`;
  const table = (heads, rowsHtml, empty) => rowsHtml
    ? `<div style="overflow-x:auto"><table class="ai-tbl"><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
      + `<tbody>${rowsHtml}</tbody></table></div>`
    : `<div class="ai-muted">${esc(empty || '沒有資料')}</div>`;

  // 各站文案由伺服器的 /ai/status 帶過來（見 src/ai/context.js 的 COPY）
  const C = (key, fallback) => ((App.aiStatus && App.aiStatus.copy && App.aiStatus.copy[key]) || fallback);

  function warnBlock(warnings) {
    if (!warnings || !warnings.length) return '';
    return '<div class="ai-note warn">系統覆核後調整了這些地方：<ul>'
      + warnings.map(w => `<li>${esc(w)}</li>`).join('') + '</ul></div>';
  }

  // 執行按鈕的共用行為：跑的時候鎖住並改字，失敗時把錯誤留在畫面上而不是彈一下就消失。
  // AI 呼叫要好幾秒，沒有這個回饋使用者會連按三次（然後被限流擋掉，更困惑）。
  async function aiRun(btn, outEl, fn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = '處理中…';
    outEl.innerHTML = '<div class="ai-muted">AI 處理中，通常需要 3～15 秒…</div>';
    try { await fn(); }
    catch (e) { outEl.innerHTML = `<div class="ai-note bad">✗ ${esc(e.message)}</div>`; }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  const readFile = file => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('讀取檔案失敗'));
    r.readAsDataURL(file);
  });

  const AI = {

    // ---- 一、問資料庫 ----
    ask(el) {
      const st = App.aiStatus || {};
      el.innerHTML = `
        <div class="ai-box">
          <h3>用問的找報表</h3>
          <div class="ai-muted" style="margin-bottom:8px">
            AI <b>不會自己算數字，也不會產生 SQL</b>。它只負責聽懂你在問什麼、挑一張既有的報表並填好篩選條件，
            數字一律由系統自己算 —— 所以答案跟你自己點進去看到的完全一樣。
          </div>
          <label class="ai-field"><span>你想知道什麼</span>
            <input type="text" name="question" placeholder="${esc((st.samples || [])[0] ? '例：' + st.samples[0] + '？' : '例：這個月的數字')}"></label>
          <button class="ai-btn" id="go">問</button>
          <div class="ai-chips" id="samples">
            ${(st.samples || []).map(q => `<span class="ai-chip" data-q="${esc(q)}">${esc(q)}</span>`).join('')}
          </div>
        </div>
        <div id="out"></div>
        <div class="ai-box">
          <h3>目前問得到的範圍（${(st.reports || []).length} 張報表）</h3>
          <div class="ai-muted">清單以外的問題 AI 會直接說查不到，不會硬挑一張接近的給你。</div>
          ${table(['報表', '可以回答什麼'],
            (st.reports || []).map(r => `<tr><td>${esc(r.label)}</td><td class="ai-muted">${esc(r.desc)}</td></tr>`).join(''))}
        </div>`;

      const out = el.querySelector('#out');
      const input = el.querySelector('[name=question]');
      const go = el.querySelector('#go');
      el.querySelector('#samples').onclick = e => { if (e.target.dataset.q) { input.value = e.target.dataset.q; go.click(); } };
      input.onkeydown = e => { if (e.key === 'Enter') go.click(); };

      go.onclick = e => aiRun(e.target, out, async () => {
        const question = input.value.trim();
        if (!question) throw new Error('請先輸入問題');
        const d = await POST('/ai/ask', { question });
        out.innerHTML = `
          ${warnBlock(d.warnings)}
          ${d.answerable ? `
            <div class="ai-note ok">
              <b>我聽到的問題是：</b>${esc(d.restated || question)}<br>
              <b>要看的是：</b>${esc(d.report.label)}
              ${Object.keys(d.params).length ? `<br><b>篩選條件：</b>${esc(JSON.stringify(d.params))}` : ''}
              <div class="ai-muted">${esc(d.why)}</div>
            </div>
            <button class="ai-btn" id="goto">開啟「${esc(d.report.label)}」</button>`
          : `<div class="ai-note warn">
              <b>這個問題系統目前回答不了。</b>
              <div>${esc(d.why || '沒有對應的報表。')}</div>
              <div class="ai-muted">與其給你一個看起來合理但算錯的數字，不如直說。</div>
            </div>`}`;
        const btn = out.querySelector('#goto');
        if (btn) btn.onclick = async () => {
          await POST(`/ai/runs/${d.run_id}/adopt`, { ref: d.goto });
          location.hash = d.goto;
        };
      });
    },

    // ---- 二、文件辨識 ----
    ocr(el) {
      const types = (App.aiStatus && App.aiStatus.doc_types) || [];
      el.innerHTML = `
        <div class="ai-box">
          <h3>${esc(C('ocr_title', '證件與單據照片轉欄位'))}</h3>
          <div class="ai-muted" style="margin-bottom:8px">
            客戶與廠商給的是照片，不是 CSV。這裡把照片抽成欄位讓你核對，
            <b>照片不會被存下來</b>；要留存請走原本的附件上傳。
          </div>
          <label class="ai-field"><span>文件類型</span>
            <select name="doc_type"><option value="">讓 AI 自己判斷</option>
              ${types.map(t => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('')}</select></label>
          <label class="ai-field"><span>文件照片</span>
            <input type="file" name="image" accept="image/png,image/jpeg,image/webp">
            <span class="ai-muted">JPG／PNG／WebP，6MB 以內。拍清楚一點，模糊的欄位 AI 會留空不會猜。</span></label>
          <button class="ai-btn" id="go">辨識</button>
        </div>
        <div id="out"></div>`;

      const out = el.querySelector('#out');
      el.querySelector('#go').onclick = e => aiRun(e.target, out, async () => {
        const file = el.querySelector('[name=image]').files[0];
        if (!file) throw new Error('請先選一張文件照片');
        if (file.size > 6 * 1024 * 1024) throw new Error('圖片超過 6MB，請先縮小再上傳');
        const dataUri = await readFile(file);
        const d = await POST('/ai/ocr', { image: dataUri, doc_type: el.querySelector('[name=doc_type]').value });
        const needs = d.fields.filter(x => x.needs_check).length;
        const conf = { high: tag('清楚', 'ok'), medium: tag('尚可', 'warn'), low: tag('不清楚', 'bad') };
        out.innerHTML = `
          ${warnBlock(d.warnings)}
          <div class="ai-note ${needs ? 'warn' : 'ok'}">
            辨識為 <b>${esc(d.doc_label)}</b>${d.target ? `　寫入目標：${esc(d.target)}` : ''}
            ${needs ? `　<b>${needs}</b> 個欄位需要人工確認` : '　所有欄位都清楚'}
            ${d.notes ? `<div>${esc(d.notes)}</div>` : ''}
          </div>
          <div class="ai-box">
            <h3>抽出的欄位</h3>
            ${table(['欄位', '值', '清晰度'], d.fields.map(f => `<tr class="${f.needs_check ? 'warn' : ''}">
              <td>${esc(f.label)}</td>
              <td>${f.value ? esc(f.value) : '<span class="ai-tag bad">未抽到</span>'}</td>
              <td>${conf[f.confidence] || conf.low}</td></tr>`).join(''))}
            <div class="ai-muted" style="margin-top:8px">系統不會自動把這些值寫進任何一張表。核對過後請到對應的頁面手動建檔 ——
              到期日填錯的代價是罰則或漏辦，這一步不值得省。</div>
            <button class="ai-btn sec" id="copy" style="margin-top:8px">複製成文字</button>
          </div>`;
        out.querySelector('#copy').onclick = async () => {
          const txt = d.fields.map(f => `${f.label}：${f.value}`).join('\n');
          try { await navigator.clipboard.writeText(txt); toast('已複製'); }
          catch { toast('瀏覽器不允許複製，請手動選取', true); }
        };
      });
    },

    // ---- 三、多語文案 ----
    i18n(el) {
      el.innerHTML = `
        <div class="ai-box">
          <h3>${esc(C('i18n_title', '多語文案初稿'))}</h3>
          <div class="ai-muted" style="margin-bottom:8px">
            產出的是<b>初稿</b>，一律標記為「未校對」。請母語人員確認過再使用 ——
            翻錯的公告比沒有翻譯更傷。
          </div>
          <label class="ai-field"><span>中文原文</span><textarea name="text" rows="4"></textarea></label>
          <label class="ai-field"><span>這段文字用在哪裡（可留空）</span>
            <input type="text" name="context" placeholder="例：家屬端的服務完成通知"></label>
          <button class="ai-btn" id="go">產生初稿</button>
        </div>
        <div id="out"></div>`;

      const out = el.querySelector('#out');
      el.querySelector('#go').onclick = e => aiRun(e.target, out, async () => {
        const text = el.querySelector('[name=text]').value.trim();
        if (!text) throw new Error('請先輸入中文原文');
        const d = await POST('/ai/i18n', { text, context: el.querySelector('[name=context]').value });
        out.innerHTML = `
          ${warnBlock(d.warnings)}
          ${d.banned_terms.length ? `<div class="ai-note bad">
            ⚠ 原文出現需要留意的用詞：${d.banned_terms.map(t => `<b>${esc(t)}</b>`).join('、')}。
            ${esc(C('banned_hint', '請先確認中文原文沒有踩到法規紅線再翻譯。'))}
          </div>` : ''}
          <div class="ai-box">
            <h3>譯文初稿 ${tag('未校對', 'warn')}</h3>
            ${table(['語言', '譯文', '狀態'], d.translations.map(t => `<tr class="${t.text ? '' : 'warn'}">
              <td>${esc(t.label)}</td>
              <td>${t.text ? esc(t.text) : '<span class="ai-tag bad">未產出</span>'}</td>
              <td>${tag('未校對', 'warn')}</td></tr>`).join(''))}
            ${d.notes ? `<div class="ai-note info">${esc(d.notes)}</div>` : ''}
            <div class="ai-muted" style="margin-top:8px">${esc(C('i18n_where', '確認無誤後，請把譯文貼進對應的設定頁。'))}
              系統不會自動使用未校對的譯文。</div>
          </div>`;
      });
    },

    // ---- 四、設定與使用紀錄 ----
    admin(el) {
      el.innerHTML = '<div class="ai-muted">載入中…</div>';
      Promise.all([GET('/ai/settings').catch(e => ({ error: e.message })),
                   GET('/ai/runs?limit=50').catch(e => ({ error: e.message }))])
        .then(([s, r]) => {
          const efforts = (s.efforts || ['medium']);
          el.innerHTML = `
            ${s.error ? `<div class="ai-note warn">設定：${esc(s.error)}</div>` : `
            <div class="ai-box">
              <h3>供應商設定</h3>
              <div class="ai-muted" style="margin-bottom:8px">
                <b>API 金鑰只從 .env 讀，不會存進資料庫、也不會顯示在這裡。</b>
                目前 Claude 金鑰${s.status.configured.anthropic ? '已設定' : '未設定'}、
                OpenAI 金鑰${s.status.configured.openai ? '已設定' : '未設定'}。
              </div>
              <label class="ai-field"><span>供應商</span>
                <select name="ai_provider">${[['auto', '自動（有哪家金鑰就用哪家）'], ['anthropic', 'Claude（Anthropic）'],
                  ['openai', 'OpenAI'], ['mock', '模擬模式（不呼叫 AI）']]
                  .map(([v, l]) => `<option value="${v}"${s.ai_provider === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
              <label class="ai-field"><span>Claude 模型（留空用預設 ${esc(s.defaults.anthropic)}）</span>
                <input type="text" name="ai_model_anthropic" value="${esc(s.ai_model_anthropic)}"></label>
              <label class="ai-field"><span>OpenAI 模型（留空用預設 ${esc(s.defaults.openai)}）</span>
                <input type="text" name="ai_model_openai" value="${esc(s.ai_model_openai)}"></label>
              <label class="ai-field"><span>思考深度（越高越準也越慢，櫃檯即時操作建議 medium）</span>
                <select name="ai_effort">${efforts.map(v => `<option value="${v}"${s.ai_effort === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
              <button class="ai-btn" id="save">儲存設定</button>
            </div>`}
            ${r.error ? `<div class="ai-note warn">使用紀錄：${esc(r.error)}</div>` : `
            <div class="ai-box">
              <h3>各助理的提案與採用</h3>
              <div class="ai-muted">「提了幾次／採用幾次」是判斷這個功能有沒有用的唯一誠實指標。</div>
              ${table(['助理', '呼叫', '採用', '失敗', 'token 進', 'token 出'],
                (r.by_agent || []).map(a => `<tr><td>${esc(a.agent)}</td><td>${a.runs}</td><td>${a.adopted}</td>
                  <td>${a.errors}</td><td>${num(a.tin)}</td><td>${num(a.tout)}</td></tr>`).join(''), '還沒有任何呼叫')}
            </div>
            <div class="ai-box">
              <h3>最近 50 筆</h3>
              ${table(['時間', '助理', '供應商', '狀態', '輸入預覽', '操作者', '採用'],
                (r.rows || []).map(x => `<tr class="${x.status === 'error' ? 'warn' : ''}">
                  <td>${esc(x.created_at)}</td><td>${esc(x.agent)}</td>
                  <td>${esc(x.simulated ? '模擬' : x.provider)}</td>
                  <td>${x.status === 'ok' ? tag('成功', 'ok') : tag(x.error || '失敗', 'bad')}</td>
                  <td class="ai-muted">${esc(String(x.input_preview).slice(0, 60))}</td>
                  <td>${esc(x.actor_name)}</td>
                  <td>${x.adopted_at ? tag('已採用', 'ok') : '—'}</td></tr>`).join(''), '還沒有任何呼叫')}
            </div>`}`;
          const save = el.querySelector('#save');
          if (save) save.onclick = async () => {
            const val = n => el.querySelector(`[name=${n}]`).value;
            try {
              await PUT('/ai/settings', {
                ai_provider: val('ai_provider'), ai_model_anthropic: val('ai_model_anthropic'),
                ai_model_openai: val('ai_model_openai'), ai_effort: val('ai_effort')
              });
              toast('已儲存'); AI.admin(el);
            } catch (e) { toast(e.message, true); }
          };
        });
    }
  };

  App.page('ai', {
    title: 'AI 助理', module: 'ai', sub: 'AI 只產生草稿，確認後才由你寫入系統',
    help: {
      intro: 'AI 負責把不成形的東西（口語問題、證件照片、中文文案）變成結構化的草稿；'
        + '驗證、閘門與寫入還是由系統本身負責。AI 不會直接改任何一筆資料。',
      steps: ['挑上面的頁籤選一個功能。',
        '貼上內容或選圖，按執行，等它跑完。',
        '看過結果、確認無誤，再自己到對應的頁面建檔。'],
      notes: ['沒有設定 API 金鑰時會走「模擬模式」：畫面與流程完全一樣，但準度差很多，只適合示範。',
        '每一次呼叫都會記在「設定與紀錄」頁籤裡，包含花了多少 token 與有沒有被採用。',
        '證件照片不會被存下來，只有抽出來的欄位會顯示在畫面上。']
    },

    async render(el) {
      injectStyle();
      el.innerHTML = '<div class="ai-muted">載入中…</div>';
      const st = await GET('/ai/status');
      App.aiStatus = st;

      // 頁籤來自伺服器回報的啟用清單（各站不同），不寫死在前端；再依這個帳號的模組權限篩一次。
      const RENDERER = { askdb: 'ask', ocr: 'ocr', i18n: 'i18n' };
      const tabs = (st.agents || [])
        .filter(a => RENDERER[a.key] && (!a.module || App.can(a.module)))
        .map(a => ({ key: RENDERER[a.key], label: a.label }));
      if (App.can((st.perm && st.perm.settings) || 'settings')) tabs.push({ key: 'admin', label: '設定與紀錄' });

      if (!tabs.length) {
        el.innerHTML = '<div class="ai-note warn">你的帳號沒有任何 AI 功能對應的模組權限。'
          + '請向管理員申請對應模組的權限：'
          + (st.agents || []).map(a => `${a.label}${a.module ? `（${a.module}）` : ''}`).join('、') + '。</div>';
        return;
      }

      const u = st.month_usage || {};
      el.innerHTML = `
        <div class="ai-note ${st.simulated ? 'warn' : 'info'}">
          ${st.simulated
            ? `⚠ <b>模擬模式</b>：${esc(st.reason)}。畫面與流程是完整的，但結果由規則式抽取產生，準度差很多，只適合示範與教育訓練。`
            : `✓ 供應商 <b>${esc(st.provider === 'anthropic' ? 'Claude（Anthropic）' : 'OpenAI')}</b>`
              + `｜模型 <b>${esc(st.model)}</b>｜思考深度 <b>${esc(st.effort)}</b>`}
          <div class="ai-muted">本月共呼叫 ${u.runs || 0} 次（其中模擬 ${u.simulated || 0} 次、失敗 ${u.errors || 0} 次），
            採用 ${u.adopted || 0} 次，token 進 ${num(u.tin)}／出 ${num(u.tout)}。</div>
        </div>
        <div class="ai-tabs" id="ai-tabs">
          ${tabs.map((t, i) => `<button type="button" data-tab="${t.key}" class="${i ? '' : 'active'}">${esc(t.label)}</button>`).join('')}
        </div>
        <div id="ai-body"></div>`;

      const body = el.querySelector('#ai-body');
      const show = key => {
        el.querySelectorAll('#ai-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
        AI[key](body);
      };
      el.querySelector('#ai-tabs').onclick = e => { if (e.target.dataset.tab) show(e.target.dataset.tab); };
      show(tabs[0].key);
    }
  });
})();
