/* ---------- 採購作業：請購 → 採購 → 驗貨入庫 → 請款，出貨／領料，庫存總覽，品項，廠商 ----------
   以 defer 載入：app.js 的 routes／ROUTE_PERM 已就緒，且在 /api/me 回來前就完成註冊。
   品項與庫存就是「備品」（supplies），驗貨入庫、出貨都寫進同一份備品進出紀錄。 */
(function () {
  const PR_ST = { pending: ['待核准', 'yellow'], approved: ['已核准・待採購', 'teal'], ordered: ['已建立採購單', 'green'], cancelled: ['已取消', 'gray'] };
  const PO_ST = { draft: ['待審核', 'purple'], pending: ['待入庫', 'yellow'], partial: ['部分到貨', 'pink'], received: ['已入庫', 'green'], closed: ['已結案', 'gray'], cancelled: ['已取消', 'gray'] };
  const PAY_ST = { unpaid: ['待付款', 'red'], paid: ['已付款', 'green'], cancelled: ['已取消', 'gray'] };
  const SHIP_ST = { pending: ['待出貨', 'yellow'], shipped: ['已出貨', 'green'], cancelled: ['已取消', 'gray'] };
  const PICK_ST = { pending: ['待領料', 'yellow'], picked: ['已領料', 'green'], cancelled: ['已取消', 'gray'] };
  const PAY_METHODS = ['銀行轉帳', '支票', '現金', '其他'];
  const SRC = { manual: '手動鍵入', quote: '比價報價', purchase: '實際採購' };
  // 採購公司：多家時才顯示公司欄與篩選，只有一家就不打擾
  const multiCo = st => st && st.companies && st.companies.length > 1;
  const companySelect = (st, sel, id = 'co-sel') => `<select id="${id}">${(st.companies || []).map(c =>
    `<option value="${c.id}" ${String(sel || st.default_company_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
  const coTag = (st, name) => multiCo(st) && name ? `<br><small class="badge gray" style="margin-top:2px">${esc(name)}</small>` : '';
  // 單據抬頭：依單據所屬公司，沒有就用系統設定
  const headOf = (doc, st) => ({
    name: doc.company_name || st.center_name,
    request_dept: doc.company_request_dept !== undefined && doc.company_id ? doc.company_request_dept : st.request_dept,
    pay_dept: doc.company_pay_dept !== undefined && doc.company_id ? doc.company_pay_dept : st.pay_dept
  });
  const badge = (map, s) => { const m = map[s] || [s, 'gray']; return `<span class="badge ${m[1]}">${esc(m[0])}</span>`; };
  const money = n => '$' + Math.round(Number(n || 0)).toLocaleString('en-US');
  const can = m => currentUser && (currentUser.role === 'admin' || (currentUser.modules || []).includes(m));
  const val = (root, sel) => { const el = root.querySelector(sel); return el ? el.value.trim() : ''; };
  let SETTINGS_CACHE = null;

  async function procSettings() {
    if (!SETTINGS_CACHE) SETTINGS_CACHE = (await api('/procurement/dashboard')).settings;
    return SETTINGS_CACHE;
  }

  // 明細編輯需要較寬的對話框；關閉時還原，不影響其他頁面的對話框
  function openWide(title, html, onMount) {
    const dlg = $('#modal');
    dlg.classList.add('wide');
    const reset = () => { dlg.classList.remove('wide'); dlg.removeEventListener('close', reset); };
    dlg.addEventListener('close', reset);
    openModal(title, html, onMount);
  }

  // 清單頁共用查詢列：日期區間＋狀態＋廠商＋關鍵字；回傳 querystring 產生器
  function filterBar(opt) {
    const statuses = opt.statuses ? `<div class="field"><label>狀態</label><select data-f="status"><option value="">全部</option>${
      Object.entries(opt.statuses).map(([k, v]) => `<option value="${k}" ${opt.status === k ? 'selected' : ''}>${esc(v[0])}</option>`).join('')}</select></div>` : '';
    const vendors = opt.vendors ? `<div class="field"><label>廠商</label><select data-f="vendor_id"><option value="">全部廠商</option>${
      opt.vendors.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>` : '';
    const companies = opt.companies && opt.companies.length > 1 ? `<div class="field"><label>採購公司</label><select data-f="company_id"><option value="">全部公司</option>${
      opt.companies.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>` : '';
    const dateField = opt.dateFields ? `<div class="field"><label>日期欄位</label><select data-f="date_field">${
      opt.dateFields.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>` : '';
    return `
      <div class="card no-print proc-filter">
        <div class="form-grid">
          ${dateField}
          <div class="field"><label>${esc(opt.dateLabel || '日期')}（起）</label><input type="date" data-f="from"></div>
          <div class="field"><label>${esc(opt.dateLabel || '日期')}（迄）</label><input type="date" data-f="to"></div>
          ${companies}${statuses}${vendors}
          <div class="field"><label>關鍵字</label><input data-f="q" placeholder="${esc(opt.placeholder || '單號／名稱')}"></div>
          <div class="field"><label>&nbsp;</label><div class="row" style="gap:6px">
            <button class="btn small" data-f-go>查詢</button><button class="btn small secondary" data-f-clear>清除</button>
            <span data-f-count style="color:var(--muted);font-size:.85rem;align-self:center"></span></div></div>
        </div>
      </div>`;
  }
  function wireFilter(root, load) {
    const bar = root.querySelector('.proc-filter');
    const qs = () => {
      const p = new URLSearchParams();
      bar.querySelectorAll('[data-f]').forEach(el => { if (el.value) p.set(el.dataset.f, el.value); });
      return p.toString();
    };
    const go = () => load(qs(), n => { bar.querySelector('[data-f-count]').textContent = `共 ${n} 筆`; });
    bar.querySelector('[data-f-go]').onclick = go;
    bar.querySelector('[data-f-clear]').onclick = () => {
      bar.querySelectorAll('[data-f]').forEach(el => { el.value = el.tagName === 'SELECT' ? (el.options[0] || {}).value || '' : ''; });
      go();
    };
    bar.querySelectorAll('input[data-f]').forEach(el => { el.onkeydown = e => { if (e.key === 'Enter') go(); }; });
    bar.querySelectorAll('select[data-f]').forEach(el => { el.onchange = go; });
    go();
  }

  // 另開視窗列印（A5 直式）：每張表都用固定欄寬（colgroup＋table-layout:fixed），
  // 表頭、明細、簽核各自一張表，不再用跨欄湊版面，印在 A5 上欄位不會忽寬忽窄
  function printDoc(title, inner) {
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>
        @page{size:A5 portrait;margin:8mm}
        *{box-sizing:border-box}
        body{font-family:"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif;color:#000;font-size:8.5pt;line-height:1.35;
          margin:0 auto;width:132mm;padding:4mm 0}
        h1{text-align:center;font-size:12pt;margin:0;letter-spacing:2pt}
        h2{text-align:center;font-size:11pt;margin:1mm 0 2mm;letter-spacing:5pt}
        .sub{display:flex;justify-content:space-between;font-size:8pt;margin:0 0 1.5mm}
        .sec{text-align:center;font-weight:700;background:#eee;border:0.6pt solid #000;padding:0.8mm;margin:0 0 1.5mm}
        table{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 1.8mm}
        td,th{border:0.6pt solid #000;padding:0.9mm 1.2mm;vertical-align:middle;word-break:break-all;overflow-wrap:anywhere}
        th,.hd{font-weight:700;background:#f2f2f2;text-align:center}
        .r{text-align:right}.c{text-align:center}
        .tall{height:13mm}
        .blank td{height:5.5mm}
        .sign td{height:12mm}
        .foot{font-size:7pt;color:#333;margin-top:1mm}
        .trail{page-break-before:always;break-before:page}
        .trail h3{font-size:9pt;margin:2.5mm 0 1mm;border-bottom:0.8pt solid #000;padding-bottom:0.5mm}
        .trail table{font-size:7.5pt;page-break-inside:avoid}
        @media print{.noprint{display:none}body{padding:0}}
      </style></head><body>${inner}
      <div class="noprint" style="margin-top:16px;text-align:center"><button onclick="window.print()" style="padding:8px 22px;font-size:14px">列印 / 另存 PDF（紙張 A5）</button></div>
      </body></html>`);
    w.document.close();
  }
  // 固定欄寬的表格：widths 為百分比陣列
  const cols = widths => `<colgroup>${widths.map(w => `<col style="width:${w}%">`).join('')}</colgroup>`;
  // 「標籤｜內容｜標籤｜內容」四欄資料表
  const infoTable = rows => `<table>${cols([17, 33, 17, 33])}${rows.map(r => r.length === 2
    ? `<tr><td class="hd">${r[0]}</td><td colspan="3">${r[1]}</td></tr>`
    : `<tr><td class="hd">${r[0]}</td><td>${r[1]}</td><td class="hd">${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</table>`;
  const dt16 = v => esc(String(v || '').slice(0, 16));
  // 中文大寫金額（請款支付憑單）：四位一組由高到低，組內與組間的「零」各自處理
  function chineseAmount(n) {
    n = Math.round(Number(n) || 0);
    if (n <= 0) return '零元整';
    const digits = '零壹貳參肆伍陸柒捌玖', units = ['仟', '佰', '拾', ''], big = ['', '萬', '億', '兆'];
    const groups = [];
    for (let v = n; v > 0; v = Math.floor(v / 10000)) groups.push(v % 10000);
    let out = '', gap = false;
    for (let g = groups.length - 1; g >= 0; g--) {
      const part = groups[g];
      if (!part) { if (out) gap = true; continue; }
      if (out && (gap || part < 1000)) out += '零';
      const str = String(part).padStart(4, '0');
      let started = false, zero = false;
      for (let i = 0; i < 4; i++) {
        const d = Number(str[i]);
        if (!d) { if (started) zero = true; continue; }
        if (zero) { out += '零'; zero = false; }
        out += digits[d] + units[i];
        started = true;
      }
      out += big[g];
      gap = false;
    }
    return out + '元整';
  }
  const ymd = d => { const [y, m, dd] = String(d || '').split('-'); return y ? `${y} 年 ${m} 月 ${dd} 日` : '____ 年 __ 月 __ 日'; };

  // 品項選單（含目前庫存）
  const itemOptions = (items, sel) => items.map(i =>
    `<option value="${i.id}" ${String(sel) === String(i.id) ? 'selected' : ''}>${esc(i.code ? i.code + ' ' : '')}${esc(i.name)}（庫存 ${i.stock} ${esc(i.unit)}）</option>`).join('');
  const vendorOptions = (vendors, sel, blank = '-- 由採購決定 --') => `<option value="">${esc(blank)}</option>` + vendors.map(v =>
    `<option value="${v.id}" ${String(sel) === String(v.id) ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  const defaultVendor = item => ((item && item.vendors) || []).find(v => v.is_default) || ((item && item.vendors) || [])[0];

  /* ================= 採購總覽 ================= */
  async function viewProcDashboard() {
    const d = await api('/procurement/dashboard');
    SETTINGS_CACHE = d.settings;
    main().innerHTML = `
      <div class="page-title">採購總覽</div>
      <div class="stat-grid">
        <div class="stat"><div class="num" style="color:${d.low_stock.length ? 'var(--danger)' : ''}">${d.low_stock.length}</div><div class="label">庫存不足品項</div></div>
        <div class="stat"><div class="num">${d.pending_pr}</div><div class="label">待核准請購單</div></div>
        <div class="stat"><div class="num">${d.approved_pr}</div><div class="label">已核准・待建採購單</div></div>
        <div class="stat"><div class="num">${d.draft_po}</div><div class="label">待審核採購單</div></div>
        <div class="stat"><div class="num">${d.pending_po}</div><div class="label">待到貨採購單（含部分到貨）</div></div>
        <div class="stat"><div class="num">${d.unpaid.c}</div><div class="label">待付款請款單（${money(d.unpaid.amt)}）</div></div>
        <div class="stat"><div class="num">${d.pending_ship}</div><div class="label">待出貨</div></div>
      </div>
      <div class="card">
        <div class="row between"><h3>庫存警示（低於安全庫存）</h3>
          ${d.low_stock.length && can('purchasing') ? '<button class="btn small" id="pd-req">低庫存一鍵請購</button>' : ''}</div>
        ${d.low_stock.length ? `<div class="table-wrap"><table class="data stack">
          <thead><tr><th>品項</th><th>倉庫別</th><th>目前庫存</th><th>安全庫存</th></tr></thead>
          <tbody>${d.low_stock.map(s => `<tr>
            <td data-label="品項">${esc(s.code ? s.code + ' ' : '')}${esc(s.name)}</td>
            <td data-label="倉庫別">${esc(s.warehouse || '—')}</td>
            <td data-label="目前庫存"><strong style="color:var(--danger)">${s.stock} ${esc(s.unit)}</strong></td>
            <td data-label="安全庫存">${s.safety_stock} ${esc(s.unit)}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">所有品項庫存正常</div>'}
      </div>
      <div class="form-grid" style="gap:14px">
        <div class="card" style="margin:0"><h3>最近請購單</h3>
          <table class="data"><tbody>${d.recent_pr.map(r => `<tr><td><a href="#/proc-requests">${esc(r.no)}</a></td><td>${esc(r.requester)}</td><td>${badge(PR_ST, r.status)}</td></tr>`).join('')
            || '<tr><td><div class="empty">尚無資料</div></td></tr>'}</tbody></table></div>
        <div class="card" style="margin:0"><h3>最近出貨</h3>
          <table class="data"><tbody>${d.recent_ship.map(s => `<tr><td><a href="#/proc-shipments">${esc(s.no)}</a></td><td>${esc(s.recipient)}</td><td>${badge(SHIP_ST, s.status)}</td></tr>`).join('')
            || '<tr><td><div class="empty">尚無資料</div></td></tr>'}</tbody></table></div>
      </div>`;
    const btn = main().querySelector('#pd-req');
    if (btn) btn.onclick = () => openPrForm(null, d.low_stock.map(s => ({ supply_id: s.id, qty: Math.max(1, s.safety_stock * 2 - s.stock) })), viewProcDashboard);
  }

  /* ================= 請購單 ================= */
  async function viewProcRequests() {
    const st = await procSettings();
    main().innerHTML = `
      <div class="page-title">請購單</div>
      <div class="card no-print"><div class="row" style="gap:8px">
        ${can('purchasing') ? '<button class="btn" id="pr-new">新增請購單</button>' : ''}
        <span style="color:var(--muted);font-size:.85rem">流程：請購（待核准）→ 主管核准 → 採購人員於「採購單」頁指定廠商建立採購單</span></div></div>
      ${filterBar({ dateLabel: '請購日期', statuses: PR_ST, companies: st.companies, placeholder: '單號／申請人／品名' })}
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>請購單號</th><th>請購日期</th><th>申請人</th><th>品項</th><th>狀態</th><th>採購單</th><th class="no-print"></th></tr></thead>
        <tbody id="pr-body"></tbody></table></div></div>`;
    const newBtn = main().querySelector('#pr-new');
    if (newBtn) newBtn.onclick = () => openPrForm(null, null, reload);
    let lastQs = '';
    function reload() { load(lastQs, () => {}); }
    async function load(qs, setCount) {
      lastQs = qs;
      const rows = await api('/procurement/requests?' + qs);
      setCount(rows.length);
      $('#pr-body').innerHTML = rows.map(r => `<tr>
        <td data-label="請購單號">${esc(r.no)}${r.urgent ? ' <span class="badge red">急件</span>' : ''}${coTag(st, r.company_name)}</td>
        <td data-label="請購日期">${esc(r.req_date)}</td>
        <td data-label="申請人">${esc(r.requester)}</td>
        <td data-label="品項">${r.item_count} 項${r.purpose ? `<br><small style="color:var(--muted)">${esc(r.purpose)}</small>` : ''}</td>
        <td data-label="狀態">${badge(PR_ST, r.status)}${r.approved_name && r.status !== 'pending' ? `<br><small style="color:var(--muted)">核准：${esc(r.approved_name)}</small>` : ''}</td>
        <td data-label="採購單"><small>${esc(r.po_nos || '—')}</small></td>
        <td data-label="操作" class="no-print">
          <button class="btn small secondary" data-view="${r.id}">查看／列印</button>
          ${r.status === 'pending' && can('purchasing') ? `<button class="btn small secondary" data-edit="${r.id}">修改</button>` : ''}
          ${r.status === 'pending' && can('purchasing_approve') ? `<button class="btn small" data-approve="${r.id}" data-no="${esc(r.no)}">核准</button>` : ''}
          ${r.status === 'approved' && can('purchasing') ? `<button class="btn small" data-order="${r.id}">建立採購單</button>` : ''}
          ${['pending', 'approved'].includes(r.status) && can('purchasing') ? `<button class="btn small danger" data-cancel="${r.id}">取消</button>` : ''}
        </td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">查無請購單</div></td></tr>';
      main().querySelectorAll('[data-view]').forEach(b => b.onclick = async () => printRequest(await api('/procurement/requests/' + b.dataset.view)));
      main().querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => openPrForm(await api('/procurement/requests/' + b.dataset.edit), null, reload));
      main().querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
        if (!confirm(`核准請購單 ${b.dataset.no}？\n核准後由採購人員指定廠商、建立採購單。`)) return;
        try { await api(`/procurement/requests/${b.dataset.approve}/approve`, { method: 'POST' }); reload(); }
        catch (e) { alert(e.message); }
      });
      main().querySelectorAll('[data-order]').forEach(b => b.onclick = async () => openOrderFromRequest(await api('/procurement/requests/' + b.dataset.order), reload));
      main().querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
        const reason = prompt('取消請購單的原因（可留空）：', '');
        if (reason === null) return;
        try { await api(`/procurement/requests/${b.dataset.cancel}/cancel`, { method: 'POST', body: { reason } }); reload(); }
        catch (e) { alert(e.message); }
      });
    }
    wireFilter(main(), load);
  }

  async function openPrForm(pr, preset, done) {
    const [{ rows: items }, vendors, st] = await Promise.all([api('/procurement/items'), api('/procurement/vendors'), procSettings()]);
    const lines = pr ? pr.items : (preset || [{}]);
    const rowHtml = (it = {}) => {
      const isNew = it.supply_id === undefined ? false : !it.supply_id && !!it.item_name;
      return `
      <tr data-line>
        <td data-label="品項">
          <select data-k="supply_id" style="min-width:220px"><option value="">-- 選擇品項 --</option>${itemOptions(items, it.supply_id)}<option value="new" ${isNew ? 'selected' : ''}>＋ 新品項（尚未建檔）</option></select>
          <div data-newbox style="display:${isNew ? 'flex' : 'none'};gap:6px;margin-top:4px">
            <input data-k="item_name" placeholder="新品名" value="${esc(isNew ? it.item_name : '')}" style="flex:2">
            <input data-k="unit" placeholder="單位" value="${esc(isNew ? it.unit : '')}" style="flex:1;max-width:80px"></div>
        </td>
        <td data-label="請購數量"><input type="number" min="1" data-k="qty" value="${it.qty || 1}" style="max-width:90px"></td>
        <td data-label="需求日期"><input type="date" data-k="need_date" value="${esc(it.need_date || '')}"></td>
        <td data-label="建議廠商"><select data-k="suggested_vendor_id">${vendorOptions(vendors, it.suggested_vendor_id)}</select></td>
        <td><button class="btn small danger" data-del>刪</button></td>
      </tr>`;
    };
    openWide(pr ? `修改請購單 ${pr.no}` : '新增請購單', `
      <div class="form-grid">
        <div class="field"><label>採購公司 <b class="req">*</b></label>${companySelect(st, pr && pr.company_id, 'prf-co')}</div>
        <div class="field"><label>申請人 <b class="req">*</b></label><input id="prf-req" value="${esc(pr ? pr.requester : currentUser.name)}"></div>
        <div class="field"><label>請購日期</label><input type="date" id="prf-date" value="${esc(pr ? pr.req_date : todayStr())}"></div>
        <div class="field"><label>件別</label><select id="prf-urgent"><option value="0">一般件</option><option value="1" ${pr && pr.urgent ? 'selected' : ''}>急件</option></select></div>
        <div class="field"><label>預算金額</label><input type="number" min="0" id="prf-budget" value="${pr && pr.budget ? pr.budget : ''}"></div>
        <div class="field full"><label>用途說明</label><input id="prf-purpose" maxlength="500" value="${esc(pr ? pr.purpose : '')}"></div>
      </div>
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>品項</th><th>請購數量</th><th>需求日期</th><th>建議廠商</th><th></th></tr></thead>
        <tbody id="prf-lines">${lines.map(rowHtml).join('')}</tbody></table></div>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn small secondary" id="prf-add">新增品項</button>
        <button class="btn" id="prf-save">${pr ? '儲存修改' : '建立請購單'}</button>
        <span class="error-msg" id="prf-err"></span></div>
      <small style="color:var(--muted)">選擇品項會自動帶入該品項的預設廠商；尚未建檔的品項選「新品項」輸入品名與單位，驗貨入庫時自動建檔。</small>`, body => {
      const wireLine = tr => {
        const sel = tr.querySelector('[data-k="supply_id"]');
        sel.onchange = () => {
          tr.querySelector('[data-newbox]').style.display = sel.value === 'new' ? 'flex' : 'none';
          const item = items.find(i => String(i.id) === sel.value);
          const dv = defaultVendor(item);
          if (dv) tr.querySelector('[data-k="suggested_vendor_id"]').value = dv.id;
        };
        tr.querySelector('[data-del]').onclick = () => tr.remove();
      };
      body.querySelectorAll('[data-line]').forEach(tr => {
        wireLine(tr);
        // 一鍵請購帶入的品項：補上預設廠商
        const sel = tr.querySelector('[data-k="supply_id"]');
        const vs = tr.querySelector('[data-k="suggested_vendor_id"]');
        if (sel.value && sel.value !== 'new' && !vs.value) { const dv = defaultVendor(items.find(i => String(i.id) === sel.value)); if (dv) vs.value = dv.id; }
      });
      body.querySelector('#prf-add').onclick = () => {
        body.querySelector('#prf-lines').insertAdjacentHTML('beforeend', rowHtml());
        wireLine(body.querySelector('#prf-lines').lastElementChild);
      };
      body.querySelector('#prf-save').onclick = async () => {
        const err = body.querySelector('#prf-err');
        err.textContent = '';
        const lineData = [...body.querySelectorAll('[data-line]')].map(tr => {
          const g = k => val(tr, `[data-k="${k}"]`);
          const sid = g('supply_id');
          return { supply_id: sid && sid !== 'new' ? Number(sid) : null, item_name: sid === 'new' ? g('item_name') : '',
            unit: sid === 'new' ? g('unit') : '', qty: Number(g('qty')), need_date: g('need_date'),
            suggested_vendor_id: g('suggested_vendor_id') ? Number(g('suggested_vendor_id')) : null };
        }).filter(l => l.supply_id || l.item_name);
        if (lineData.some(l => !l.supply_id && !l.unit)) { err.textContent = '新品項請填寫單位'; return; }
        const payload = { company_id: Number(val(body, '#prf-co')) || null, requester: val(body, '#prf-req'), req_date: val(body, '#prf-date'), urgent: val(body, '#prf-urgent') === '1',
          budget: val(body, '#prf-budget'), purpose: val(body, '#prf-purpose'), items: lineData };
        try {
          if (pr) await api('/procurement/requests/' + pr.id, { method: 'PUT', body: payload });
          else { const r = await api('/procurement/requests', { method: 'POST', body: payload }); alert(`請購單 ${r.no} 已建立，等待主管核准`); }
          closeModal(); done && done();
        } catch (e) { err.textContent = e.message; }
      };
    });
  }

  async function openOrderFromRequest(pr, done) {
    const [{ rows: items }, vendors] = await Promise.all([api('/procurement/items'), api('/procurement/vendors')]);
    openWide(`建立採購單 — 請購單 ${pr.no}`, `
      <div style="background:var(--primary-light);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:.9rem">
        ${pr.company_name ? `公司：${esc(pr.company_name)}　` : ''}申請人：${esc(pr.requester)}　核准：${esc(pr.approved_name || '—')}　共 ${pr.items.length} 品項${pr.purpose ? `　用途：${esc(pr.purpose)}` : ''}</div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>品項</th><th>數量</th><th>指定廠商 <b class="req">*</b></th><th>預計到貨日</th></tr></thead>
        <tbody>${pr.items.map(it => {
          const dv = it.suggested_vendor_id || (defaultVendor(items.find(i => i.id === it.supply_id)) || {}).id;
          return `<tr data-item="${it.id}">
            <td data-label="品項">${esc(it.item_name)}${it.supply_id ? '' : ' <span class="badge teal">新品項</span>'}
              ${it.suggested_vendor_name ? `<br><small style="color:var(--muted)">建議：${esc(it.suggested_vendor_name)}</small>` : ''}</td>
            <td data-label="數量">${it.qty} ${esc(it.unit)}</td>
            <td data-label="指定廠商"><select data-k="vendor">${vendorOptions(vendors, dv, '-- 必選 --')}</select></td>
            <td data-label="預計到貨日"><input type="date" data-k="eta" value="${esc(it.need_date || todayStr())}"></td></tr>`;
        }).join('')}</tbody></table></div>
      <p style="font-size:.85rem;color:var(--muted)">相同廠商＋相同到貨日的品項會合併成同一張採購單。</p>
      <div class="row" style="gap:8px"><button class="btn" id="apv-go">建立採購單</button><span class="error-msg" id="apv-err"></span></div>`, body => {
      body.querySelector('#apv-go').onclick = async () => {
        const list = [...body.querySelectorAll('[data-item]')].map(tr => ({
          item_id: Number(tr.dataset.item), vendor_id: Number(val(tr, '[data-k="vendor"]')) || 0, eta: val(tr, '[data-k="eta"]') }));
        const missing = list.filter(l => !l.vendor_id).length;
        if (missing) { body.querySelector('#apv-err').textContent = `尚有 ${missing} 個品項未指定廠商`; return; }
        try {
          const r = await api(`/procurement/requests/${pr.id}/order`, { method: 'POST', body: { items: list } });
          alert(r.orders.length > 1 ? `已拆成 ${r.orders.length} 張採購單：${r.orders.map(o => o.no).join('、')}` : `採購單 ${r.orders[0].no} 已建立`);
          closeModal(); done && done();
        } catch (e) { body.querySelector('#apv-err').textContent = e.message; }
      };
    });
  }

  async function printRequest(r) {
    const s = await procSettings();
    const blanks = Math.max(0, 6 - r.items.length);
    const suggest = [...new Set(r.items.map(i => i.suggested_vendor_name).filter(Boolean))].join('、');
    printDoc(`請購單 ${r.no}`, `
      <h1>${esc(headOf(r, s).name)}</h1><h2>請購採購單</h2><div class="sec">【請購作業】</div>
      ${infoTable([
        ['件別', r.urgent ? '■急件　□一般件' : '□急件　■一般件', '請購單編號', esc(r.no)],
        ['請購日期', esc((r.req_date || '').replace(/-/g, '/')), '請購單位', esc(headOf(r, s).request_dept)],
        ['申請人', esc(r.requester), '預算金額', r.budget ? money(r.budget) : ''],
        ['用途說明', `<div style="min-height:9mm">${esc(r.purpose || '')}</div>`]
      ])}
      <table>${cols([9, 47, 15, 15, 14])}
        <tr><th>項次</th><th>品名及規格</th><th>請購數量</th><th>需求日期</th><th>庫存量</th></tr>
        ${r.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.item_name)}</td>
          <td class="c">${it.qty} ${esc(it.unit)}</td><td class="c">${esc(it.need_date || '')}</td>
          <td class="c">${it.stock === null || it.stock === undefined ? '' : it.stock}</td></tr>`).join('')}
        ${'<tr class="blank"><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(blanks)}
      </table>
      ${infoTable([['建議事項', `品質要求或建議供應商：${esc(suggest)}`]])}
      <table>${cols([17, 17, 16.5, 16.5, 16.5, 16.5])}
        <tr><th rowspan="2">核准</th><th rowspan="2">會簽單位</th><th colspan="4">請　購　單　位</th></tr>
        <tr><th>覆核</th><th>審核</th><th>單位主管</th><th>經辦</th></tr>
        <tr class="sign"><td class="c">${esc(r.approved_name || '')}<br><small>${dt16(r.approved_at)}</small></td><td></td><td></td><td></td><td></td>
          <td class="c">${esc(r.requester)}</td></tr>
      </table>
      <div class="foot">請購流程：請購單位 → 核決主管 → 會辦單位 → 採購單位${r.orders && r.orders.length ? `　｜　採購單：${esc(r.orders.map(o => o.no).join('、'))}${r.ordered_name ? `（${esc(r.ordered_name)}）` : ''}` : ''}</div>`);
  }

  /* ================= 採購單 ================= */
  // 採購單列表的操作按鈕（採購單頁與驗貨頁共用）
  function poActions(o) {
    const b = [];
    const editLabel = o.status === 'draft' && can('purchasing') ? '編輯／比價' : '查看';
    b.push(`<button class="btn small secondary" data-po-view="${o.id}">${editLabel}</button>`);
    b.push(`<button class="btn small secondary" data-po-print="${o.id}">列印</button>`);
    if (o.status === 'draft' && can('purchasing_approve')) b.push(`<button class="btn small" data-po-approve="${o.id}">審核</button>`);
    if (['pending', 'partial'].includes(o.status) && can('purchasing')) b.push(`<button class="btn small" data-po-recv="${o.id}">${o.status === 'partial' ? '續收到貨' : '驗貨入庫'}</button>`);
    if (o.status === 'pending' && !o.receipt_count && can('purchasing_approve')) b.push(`<button class="btn small secondary" data-po-return="${o.id}">退回修改</button>`);
    if (o.status === 'partial' && can('purchasing_approve')) b.push(`<button class="btn small secondary" data-po-close="${o.id}">結案</button>`);
    if (['draft', 'pending'].includes(o.status) && !o.receipt_count && can('purchasing_approve')) b.push(`<button class="btn small danger" data-po-cancel="${o.id}">取消</button>`);
    return b.join(' ');
  }
  function wirePoActions(root, reload) {
    const act = (sel, fn) => root.querySelectorAll(sel).forEach(btn => { btn.onclick = () => fn(btn.getAttribute(sel.slice(1, -1))); });
    act('[data-po-view]', async id => openPoForm(await api('/procurement/orders/' + id), reload));
    act('[data-po-print]', async id => printOrder(await api('/procurement/orders/' + id)));
    act('[data-po-approve]', async id => openPoForm(await api('/procurement/orders/' + id), reload));
    act('[data-po-recv]', async id => openReceiving(await api('/procurement/orders/' + id), reload));
    act('[data-po-return]', async id => {
      const reason = prompt('退回待審核的原因（可留空）：', '');
      if (reason === null) return;
      try { await api(`/procurement/orders/${id}/return`, { method: 'POST', body: { reason } }); reload(); } catch (e) { alert(e.message); }
    });
    act('[data-po-close]', async id => {
      const reason = prompt('結案原因（例如：廠商缺貨不再出貨；剩餘數量將不再等候）：', '');
      if (reason === null) return;
      if (!reason.trim()) { alert('請填寫結案原因'); return; }
      try { await api(`/procurement/orders/${id}/close`, { method: 'POST', body: { reason } }); reload(); } catch (e) { alert(e.message); }
    });
    act('[data-po-cancel]', async id => {
      const reason = prompt('取消採購單的原因（可留空）：', '');
      if (reason === null) return;
      try { await api(`/procurement/orders/${id}/cancel`, { method: 'POST', body: { reason } }); reload(); } catch (e) { alert(e.message); }
    });
  }
  // 到貨進度：已到 / 訂購
  const progress = o => o.qty_total ? `<br><small style="color:var(--muted)">到貨 ${o.received_total_qty} / ${o.qty_total}${o.receipt_count ? `（${o.receipt_count} 批）` : ''}</small>` : '';

  async function viewProcOrders() {
    const [vendors, approved, st] = await Promise.all([api('/procurement/vendors?active=all'), api('/procurement/requests?status=approved'), procSettings()]);
    main().innerHTML = `
      <div class="page-title">採購單</div>
      <div class="card">
        <h3>待建立採購單（已核准的請購單 ${approved.length} 張）</h3>
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>請購單號</th><th>請購日期</th><th>申請人</th><th>品項</th><th>核准</th><th class="no-print"></th></tr></thead>
          <tbody>${approved.map(r => `<tr>
            <td data-label="請購單號">${esc(r.no)}${r.urgent ? ' <span class="badge red">急件</span>' : ''}${coTag(st, r.company_name)}</td>
            <td data-label="請購日期">${esc(r.req_date)}</td>
            <td data-label="申請人">${esc(r.requester)}</td>
            <td data-label="品項">${r.item_count} 項${r.purpose ? `<br><small style="color:var(--muted)">${esc(r.purpose)}</small>` : ''}</td>
            <td data-label="核准">${esc(r.approved_name || '—')}<br><small>${esc((r.approved_at || '').slice(0, 16))}</small></td>
            <td data-label="操作" class="no-print">
              <button class="btn small secondary" data-prview="${r.id}">查看</button>
              ${can('purchasing') ? `<button class="btn small" data-order="${r.id}">建立採購單</button>` : ''}</td></tr>`).join('')
            || '<tr><td colspan="6"><div class="empty">目前沒有待建立採購單的請購單</div></td></tr>'}</tbody></table></div>
        <small style="color:var(--muted)">為每個品項指定預計採購廠商與到貨日；相同廠商＋相同到貨日的品項合併成一張採購單（建立後為「待審核」）。</small>
      </div>
      ${filterBar({ dateLabel: '採購日期', statuses: PO_ST, vendors, companies: st.companies, placeholder: '採購單號／請購單號／品名' })}
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>採購單號</th><th>採購日期</th><th>來源請購單</th><th>廠商</th><th>預計到貨</th><th>未稅總額／預算</th><th>狀態</th><th class="no-print"></th></tr></thead>
        <tbody id="po-body"></tbody></table></div>
        <small style="color:var(--muted)">流程：待審核（採購鍵入廠商、預算金額，新品項須兩家以上比價）→ 主管審核通過 → 待入庫（可分批到貨）→ 已入庫；剩餘不再交貨可「結案」。</small></div>`;
    main().querySelectorAll('[data-order]').forEach(b => b.onclick = async () => openOrderFromRequest(await api('/procurement/requests/' + b.dataset.order), viewProcOrders));
    main().querySelectorAll('[data-prview]').forEach(b => b.onclick = async () => printRequest(await api('/procurement/requests/' + b.dataset.prview)));
    let lastQs = '';
    const reload = () => load(lastQs, () => {});
    async function load(qs, setCount) {
      lastQs = qs;
      const rows = await api('/procurement/orders?' + qs);
      setCount(rows.length);
      $('#po-body').innerHTML = rows.map(o => `<tr>
        <td data-label="採購單號">${esc(o.no)}${o.new_count ? ' <span class="badge teal">含新品項</span>' : ''}${coTag(st, o.company_name)}</td>
        <td data-label="採購日期">${esc(o.po_date)}</td>
        <td data-label="來源請購單">${esc(o.pr_no || '—')}</td>
        <td data-label="廠商">${esc(o.vendor_name || '')}</td>
        <td data-label="預計到貨">${esc(o.eta || '—')}${['pending', 'partial'].includes(o.status) && o.eta && o.eta < todayStr() ? ' <span class="badge red">逾期</span>' : ''}</td>
        <td data-label="未稅總額／預算">${money(o.total)}<br><small style="color:${o.budget_amount && o.total > o.budget_amount ? 'var(--danger)' : 'var(--muted)'}">預算 ${o.budget_amount ? money(o.budget_amount) : '未填'}</small></td>
        <td data-label="狀態">${badge(PO_ST, o.status)}${progress(o)}</td>
        <td data-label="操作" class="no-print">${poActions(o)}</td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">查無採購單</div></td></tr>';
      wirePoActions($('#po-body'), reload);
    }
    wireFilter(main(), load);
  }

  // 採購單視窗：待審核可編輯（廠商、預算、單價、新品項比價）；審核者在同一視窗按「審核通過」
  async function openPoForm(o, done) {
    const draft = o.status === 'draft';
    const editable = draft && can('purchasing');
    const vendors = await api('/procurement/vendors');
    const dis = editable ? '' : 'disabled';
    const vOpts = sel => vendors.map(v => `<option value="${v.id}" ${String(sel) === String(v.id) ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
    const quoteRow = (itemId, q = {}) => `<tr data-quote>
      <td><select data-q="vendor_id" ${dis} style="min-width:150px"><option value="">＋ 新廠商（輸入右側）</option>${vOpts(q.vendor_id)}</select>
        <div data-newv style="display:${q.vendor_id ? 'none' : 'flex'};gap:4px;margin-top:4px;flex-wrap:wrap">
          <input data-q="vendor_name" placeholder="廠商名稱" style="max-width:130px" ${dis}>
          <input data-q="vendor_contact" placeholder="聯絡人" style="max-width:80px" ${dis}>
          <input data-q="vendor_phone" placeholder="電話" style="max-width:110px" ${dis}></div></td>
      <td><input type="number" min="0" step="0.01" data-q="unit_price" value="${q.unit_price || ''}" style="max-width:100px" ${dis}></td>
      <td><input data-q="note" value="${esc(q.note || '')}" placeholder="交期、運費等" ${dis}></td>
      <td style="text-align:center"><input type="radio" name="sel-${itemId}" data-q="selected" ${q.is_selected ? 'checked' : ''} ${dis}></td>
      <td>${editable ? '<button class="btn small danger" data-qdel>刪</button>' : ''}</td></tr>`;
    const itemBlock = it => `
      <tr data-item="${it.id}">
        <td data-label="品項">${esc(it.item_name)} ${it.needs_quotes ? '<span class="badge teal">新品項・需比價</span>' : ''}</td>
        <td data-label="數量"><input type="number" min="1" data-k="qty" value="${it.qty}" style="max-width:80px" ${dis}> ${esc(it.unit)}
          ${o.status !== 'draft' ? `<br><small style="color:var(--muted)">已到 ${it.received_qty}／未到 ${it.remaining}</small>` : ''}</td>
        <td data-label="未稅單價"><input type="number" min="0" step="0.01" data-k="unit_price" value="${it.unit_price}" style="max-width:110px" ${dis || (it.needs_quotes ? 'disabled title="由選定報價帶入"' : '')}></td>
        <td data-label="未稅小計" data-sub>${money(it.qty * it.unit_price)}</td>
      </tr>
      ${it.needs_quotes ? `<tr data-quotes-for="${it.id}"><td colspan="4" style="background:var(--bg)">
        <div style="font-weight:600;margin-bottom:4px">比價報價（至少 2 家，點選一家為預計採購廠商；新廠商會自動存入廠商管理）</div>
        <table class="data"><thead><tr><th>廠商</th><th>報價單價（未稅）</th><th>備註</th><th>預計採購</th><th></th></tr></thead>
          <tbody data-qbody>${(it.quotes.length ? it.quotes : [{}]).map(q => quoteRow(it.id, q)).join('')}</tbody></table>
        ${editable ? `<button class="btn small secondary" data-qadd="${it.id}" style="margin-top:4px">新增報價</button>` : ''}
        <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
          <span style="color:var(--muted);font-size:.85rem">到貨時建檔：</span>
          <input data-k="new_code" placeholder="品項編號" value="${esc(it.new_code || '')}" style="max-width:110px" ${dis}>
          <input data-k="new_warehouse" placeholder="倉庫別" value="${esc(it.new_warehouse || '')}" style="max-width:110px" ${dis}>
          <input type="number" min="0" data-k="new_safety" title="安全庫存" value="${it.new_safety}" style="max-width:80px" ${dis}></div>
      </td></tr>` : ''}`;
    const statusLine = o.status === 'draft' ? ''
      : `<div style="margin-bottom:8px;font-size:.9rem">狀態：${badge(PO_ST, o.status)}　審核：${esc(o.approved_name || '—')} ${esc((o.approved_at || '').slice(0, 16))}${o.closed_reason ? `　結案原因：${esc(o.closed_reason)}` : ''}</div>`;
    openWide(`採購單 ${o.no}${draft ? '（待審核）' : ''}`, `
      ${statusLine}
      <div class="form-grid" style="margin-bottom:8px">
        <div class="field"><label>採購廠商 <b class="req">*</b></label><select id="pof-vendor" ${dis}>${vOpts(o.vendor_id)}</select></div>
        <div class="field"><label>預算金額 <b class="req">*</b></label><input type="number" min="0" id="pof-budget" value="${o.budget_amount || ''}" ${dis}
          placeholder="${o.pr_budget ? '請購預算 ' + o.pr_budget : ''}"></div>
        <div class="field"><label>來源請購單${o.company_name ? `（${esc(o.company_name)}）` : ''}</label><input value="${esc(o.pr_no || '—')}" disabled></div>
        <div class="field"><label>預計到貨日</label><input type="date" id="pof-eta" value="${esc(o.eta || '')}" ${['draft', 'pending', 'partial'].includes(o.status) && can('purchasing') ? '' : 'disabled'}></div>
        <div class="field full"><label>備註</label><input id="pof-note" value="${esc(o.note || '')}" ${['draft', 'pending', 'partial'].includes(o.status) && can('purchasing') ? '' : 'disabled'}></div>
      </div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>品項</th><th>數量</th><th>未稅單價</th><th>未稅小計</th></tr></thead>
        <tbody>${o.items.map(itemBlock).join('')}</tbody></table></div>
      <div style="text-align:right;font-weight:700;margin:8px 0">未稅總額：<span id="pof-total">${money(o.total)}</span>
        <span id="pof-budget-warn" style="color:var(--danger);font-weight:400"></span></div>
      ${o.receipts.length ? `<div class="sec-hd">到貨紀錄（${o.receipts.length} 批）</div>
        <table class="data"><thead><tr><th>批次</th><th>入庫單</th><th>日期</th><th>驗貨人</th><th>發票</th><th>未稅金額</th><th>請款單</th></tr></thead>
        <tbody>${o.receipts.map(g => `<tr><td>第 ${g.batch_no} 批</td><td>${esc(g.no)}</td><td>${esc(g.receive_date)}</td><td>${esc(g.inspector)}</td>
          <td>${esc(g.invoice_no || '—')}</td><td>${money(g.subtotal)}</td><td>${esc(g.pay_no || '—')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${draft ? `<div id="pof-problems" style="margin:8px 0"></div>` : ''}
      <div class="row" style="gap:8px;flex-wrap:wrap">
        ${editable ? '<button class="btn secondary" id="pof-save">儲存</button>' : ''}
        ${draft && can('purchasing_approve') ? '<button class="btn" id="pof-approve">審核通過</button>' : ''}
        ${!draft && ['pending', 'partial'].includes(o.status) && can('purchasing') ? '<button class="btn secondary" id="pof-save-eta">儲存到貨日／備註</button>' : ''}
        <button class="btn secondary" id="pof-print">列印</button>
        ${['pending', 'partial'].includes(o.status) && can('purchasing') ? `<button class="btn secondary" id="pof-recv">${o.status === 'partial' ? '續收到貨' : '驗貨入庫'}</button>` : ''}
        <span class="error-msg" id="pof-err"></span></div>`, body => {
      const showProblems = list => {
        const box = body.querySelector('#pof-problems');
        if (!box) return;
        box.innerHTML = list && list.length
          ? `<div style="background:#fdeeee;border-radius:8px;padding:8px 12px;font-size:.88rem"><strong>審核前需補齊：</strong><ul style="margin:4px 0 0 18px">${list.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`
          : '<div style="background:var(--primary-light);border-radius:8px;padding:8px 12px;font-size:.88rem">資料齊全，可送主管審核。</div>';
      };
      showProblems(o.problems);
      const recalc = () => {
        let total = 0;
        body.querySelectorAll('[data-item]').forEach(tr => {
          const id = tr.dataset.item;
          const qbox = body.querySelector(`[data-quotes-for="${id}"]`);
          if (qbox) {
            const sel = [...qbox.querySelectorAll('[data-quote]')].find(r => r.querySelector('[data-q="selected"]').checked);
            if (sel) tr.querySelector('[data-k="unit_price"]').value = val(sel, '[data-q="unit_price"]') || 0;
          }
          const sub = (Number(val(tr, '[data-k="qty"]')) || 0) * (Number(val(tr, '[data-k="unit_price"]')) || 0);
          total += sub; tr.querySelector('[data-sub]').textContent = money(sub);
        });
        body.querySelector('#pof-total').textContent = money(total);
        const bud = Number(val(body, '#pof-budget')) || 0;
        body.querySelector('#pof-budget-warn').textContent = bud && total > bud ? `（超出預算 ${money(total - bud)}）` : '';
      };
      const wireQuote = tr => {
        const vs = tr.querySelector('[data-q="vendor_id"]');
        vs.onchange = async () => {
          tr.querySelector('[data-newv]').style.display = vs.value ? 'none' : 'flex';
          const priceEl = tr.querySelector('[data-q="unit_price"]');
          if (!vs.value || Number(priceEl.value)) return;
          // 廠商價格表有這個品項的價格就先帶入，可再改
          const itemId = tr.closest('[data-quotes-for]').dataset.quotesFor;
          const it = o.items.find(x => String(x.id) === itemId);
          const qs = new URLSearchParams({ vendor_id: vs.value });
          if (it.supply_id) qs.set('supply_id', it.supply_id); else qs.set('item_name', it.item_name);
          const found = (await api('/procurement/vendor-prices?' + qs))[0];
          if (found) { priceEl.value = found.unit_price; priceEl.title = `廠商價格表 ${found.price_date || ''}`; recalc(); }
        };
        tr.querySelectorAll('input').forEach(el => { el.oninput = recalc; el.onchange = recalc; });
        const del = tr.querySelector('[data-qdel]');
        if (del) del.onclick = () => { tr.remove(); recalc(); };
      };
      body.querySelectorAll('[data-quote]').forEach(wireQuote);
      body.querySelectorAll('[data-qadd]').forEach(b => b.onclick = () => {
        const tb = body.querySelector(`[data-quotes-for="${b.dataset.qadd}"] [data-qbody]`);
        tb.insertAdjacentHTML('beforeend', quoteRow(b.dataset.qadd));
        wireQuote(tb.lastElementChild);
      });
      body.querySelectorAll('input[data-k="qty"], input[data-k="unit_price"], #pof-budget').forEach(el => el.oninput = recalc);
      // 單品項採購單：選定報價廠商時，採購廠商跟著變
      body.querySelectorAll('[data-q="selected"]').forEach(r => r.addEventListener('change', () => {
        if (o.items.length !== 1) return;
        const vid = val(r.closest('[data-quote]'), '[data-q="vendor_id"]');
        if (vid) body.querySelector('#pof-vendor').value = vid;
      }));
      recalc();
      const payload = () => ({
        vendor_id: Number(val(body, '#pof-vendor')), budget_amount: val(body, '#pof-budget'),
        eta: val(body, '#pof-eta'), note: val(body, '#pof-note'),
        items: [...body.querySelectorAll('[data-item]')].map(tr => {
          const id = Number(tr.dataset.item);
          const x = { id, qty: Number(val(tr, '[data-k="qty"]')), unit_price: Number(val(tr, '[data-k="unit_price"]')) };
          const qbox = body.querySelector(`[data-quotes-for="${id}"]`);
          if (qbox) {
            Object.assign(x, { new_code: val(qbox, '[data-k="new_code"]'), new_warehouse: val(qbox, '[data-k="new_warehouse"]'),
              new_safety: Number(val(qbox, '[data-k="new_safety"]')) });
            x.quotes = [...qbox.querySelectorAll('[data-quote]')].map(r => ({
              vendor_id: Number(val(r, '[data-q="vendor_id"]')) || null,
              vendor_name: val(r, '[data-q="vendor_name"]'), vendor_contact: val(r, '[data-q="vendor_contact"]'),
              vendor_phone: val(r, '[data-q="vendor_phone"]'), unit_price: Number(val(r, '[data-q="unit_price"]')) || 0,
              note: val(r, '[data-q="note"]'), selected: r.querySelector('[data-q="selected"]').checked
            })).filter(q => q.vendor_id || q.vendor_name);
          }
          return x;
        })
      });
      const err = body.querySelector('#pof-err');
      const save = async () => {
        const r = await api('/procurement/orders/' + o.id, { method: 'PUT', body: payload() });
        showProblems(r.problems);
        return r;
      };
      const sb = body.querySelector('#pof-save');
      if (sb) sb.onclick = async () => {
        err.textContent = '';
        try { const r = await save(); openPoForm({ ...r, problems: r.problems }, done); done && done(); }
        catch (e) { err.textContent = e.message; }
      };
      const ap = body.querySelector('#pof-approve');
      if (ap) ap.onclick = async () => {
        err.textContent = '';
        try {
          if (editable) await save();
          const total = body.querySelector('#pof-total').textContent;
          if (!confirm(`審核通過採購單 ${o.no}？\n廠商：${body.querySelector('#pof-vendor').selectedOptions[0].textContent}\n未稅總額：${total}　預算：${money(val(body, '#pof-budget'))}\n通過後即可驗貨入庫。`)) return;
          const r = await api(`/procurement/orders/${o.id}/approve`, { method: 'POST' });
          if (r.over_budget) alert('已審核通過（注意：採購金額超出預算）');
          closeModal(); done && done();
        } catch (e) { err.textContent = e.message; }
      };
      const se = body.querySelector('#pof-save-eta');
      if (se) se.onclick = async () => {
        try { await api('/procurement/orders/' + o.id, { method: 'PUT', body: { eta: val(body, '#pof-eta'), note: val(body, '#pof-note') } }); closeModal(); done && done(); }
        catch (e) { err.textContent = e.message; }
      };
      body.querySelector('#pof-print').onclick = () => printOrder(o);
      const recv = body.querySelector('#pof-recv');
      if (recv) recv.onclick = async () => { closeModal(); openReceiving(await api('/procurement/orders/' + o.id), done); };
    });
  }

  async function printOrder(o) {
    const s = await procSettings();
    // 比價資料：新品項列出各家報價（決議欄標示採購），既有品項列採購廠商
    const lines = [];
    for (const it of o.items) {
      const qs = it.quotes && it.quotes.length ? it.quotes : [{ vendor_name: o.vendor_name, unit_price: it.unit_price, is_selected: 1, note: o.vendor_terms || '' }];
      qs.forEach((q, i) => lines.push(`<tr><td>${i === 0 ? esc(it.item_name) : ''}</td><td>${esc(q.vendor_name || '')}</td>
        <td class="c">${i === 0 ? `${it.qty} ${esc(it.unit)}` : ''}</td><td class="r">${money(q.unit_price)}</td>
        <td class="r">${money(q.unit_price * it.qty)}</td><td>${esc(q.note || '')}</td><td class="c">${q.is_selected ? '■採購' : ''}</td></tr>`));
    }
    const blanks = Math.max(0, 5 - lines.length);
    const quoted = o.items.filter(i => i.quotes && i.quotes.length);
    const within = o.budget_amount ? o.total <= o.budget_amount : null;
    printDoc(`採購單 ${o.no}`, `
      <h1>${esc(headOf(o, s).name)}</h1><h2>請購採購單</h2><div class="sec">【採購作業】</div>
      ${infoTable([
        ['採購單編號', esc(o.no), '採購日期', esc(o.po_date)],
        ['來源請購單', esc(o.pr_no || ''), '預算金額', o.budget_amount ? money(o.budget_amount) : ''],
        ['採購廠商', esc(o.vendor_name), '交期', esc(o.eta || '')]
      ])}
      <div class="sec" style="margin-top:0">比價資料</div>
      <table>${cols([22, 20, 11, 12, 13, 12, 10])}
        <tr><th>品名及規格</th><th>廠商</th><th>數量</th><th>單價</th><th>金額(未稅)</th><th>備註</th><th>決議</th></tr>
        ${lines.join('')}
        ${'<tr class="blank"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(blanks)}
        <tr><td colspan="4" class="r"><strong>採購未稅合計</strong></td><td class="r"><strong>${money(o.total)}</strong></td>
          <td colspan="2">${within === false ? '超出預算' : ''}</td></tr>
      </table>
      ${infoTable([
        ['經費最小化', within === null ? '□是　□否' : within ? '■是　□否' : '□是　■否'],
        ['建議廠商及原因', `${esc(o.vendor_name)}${quoted.length ? `（${esc(quoted.map(i => `${i.item_name} 比價 ${i.quotes.length} 家`).join('、'))}）` : ''}`],
        ['議價說明', esc(o.note || '')]
      ])}
      <table>${cols([12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5])}
        <tr><th colspan="2">驗收單位</th><th rowspan="2">核准</th><th rowspan="2">會簽單位</th><th colspan="4">採　購　單　位</th></tr>
        <tr><th>驗收結果</th><th>驗收人</th><th>覆核</th><th>審核</th><th>單位主管</th><th>經辦</th></tr>
        <tr class="sign"><td class="c">${o.receipts && o.receipts.length ? (o.status === 'received' ? '全數到貨' : o.status === 'closed' ? '部分到貨<br>結案' : '部分到貨') : ''}</td>
          <td class="c">${esc([...new Set((o.receipts || []).map(g => g.inspector))].join('、'))}</td>
          <td class="c">${esc(o.approved_name || '')}<br><small>${dt16(o.approved_at)}</small></td><td></td><td></td><td></td><td></td><td></td></tr>
      </table>
      <div class="foot">採購流程：採購單位 → 核決主管 → 採購訂貨 → 驗收單位 → 請款作業${o.receipts && o.receipts.length ? `　｜　到貨：${esc(o.receipts.map(g => `第${g.batch_no}批 ${g.receive_date}`).join('、'))}` : ''}</div>`);
  }

  /* ================= 驗貨入庫 ================= */
  async function viewProcReceiving() {
    const [pending, vendors] = await Promise.all([api('/procurement/orders?status=receivable'), api('/procurement/vendors?active=all')]);
    main().innerHTML = `
      <div class="page-title">驗貨入庫</div>
      <div class="card">
        <h3>待到貨採購單（${pending.length}）</h3>
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>採購單號</th><th>廠商</th><th>預計到貨</th><th>到貨進度</th><th>狀態</th><th class="no-print"></th></tr></thead>
          <tbody id="rcv-pending">${pending.map(o => `<tr>
            <td data-label="採購單號">${esc(o.no)}</td><td data-label="廠商">${esc(o.vendor_name)}</td>
            <td data-label="預計到貨">${esc(o.eta || '—')}${o.eta && o.eta < todayStr() ? ' <span class="badge red">逾期</span>' : ''}</td>
            <td data-label="到貨進度">${o.received_total_qty} / ${o.qty_total}${o.receipt_count ? `（已收 ${o.receipt_count} 批）` : ''}</td>
            <td data-label="狀態">${badge(PO_ST, o.status)}</td>
            <td data-label="操作" class="no-print">${poActions(o)}</td></tr>`).join('')
            || '<tr><td colspan="6"><div class="empty">目前沒有待到貨的採購單（採購單須先審核通過）</div></td></tr>'}</tbody></table></div>
        <small style="color:var(--muted)">廠商分批送貨時，每次到貨各驗一次：本批數量入庫並各自產生一張請款單；全部到齊自動轉「已入庫」，剩餘不再交貨可按「結案」。</small>
      </div>
      <h3 style="margin:14px 0 6px">入庫紀錄</h3>
      ${filterBar({ dateLabel: '入庫日期', vendors, placeholder: '入庫單號／採購單號／發票號／驗貨人' })}
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>入庫單號</th><th>採購單號</th><th>批次</th><th>廠商</th><th>入庫日期</th><th>驗貨人員</th><th>發票號碼</th><th>未稅金額</th><th>請款單</th><th class="no-print"></th></tr></thead>
        <tbody id="gr-body"></tbody></table></div></div>`;
    wirePoActions($('#rcv-pending'), viewProcReceiving);
    wireFilter(main(), async (qs, setCount) => {
      const rows = await api('/procurement/receipts?' + qs);
      setCount(rows.length);
      $('#gr-body').innerHTML = rows.map(g => `<tr>
        <td data-label="入庫單號">${esc(g.no)}</td><td data-label="採購單號">${esc(g.po_no)}</td>
        <td data-label="批次">第 ${g.batch_no} 批</td><td data-label="廠商">${esc(g.vendor_name || '')}</td>
        <td data-label="入庫日期">${esc(g.receive_date)}</td><td data-label="驗貨人員">${esc(g.inspector)}</td>
        <td data-label="發票號碼">${esc(g.invoice_no || '—')}</td><td data-label="未稅金額">${money(g.subtotal)}</td>
        <td data-label="請款單">${g.pay_no ? `<a href="#/proc-payments">${esc(g.pay_no)}</a>` : '—'}</td>
        <td data-label="操作" class="no-print"><button class="btn small secondary" data-gr="${g.id}">查看</button></td></tr>`).join('')
        || '<tr><td colspan="10"><div class="empty">查無入庫紀錄</div></td></tr>';
      main().querySelectorAll('[data-gr]').forEach(b => b.onclick = async () => {
        const g = await api('/procurement/receipts/' + b.dataset.gr);
        openWide(`入庫單 ${g.no}（第 ${g.batch_no} 批）`, `
          <div style="margin-bottom:8px;font-size:.9rem">採購單：${esc(g.po_no)}　廠商：${esc(g.vendor_name || '')}　入庫日期：${esc(g.receive_date)}　驗貨人員：${esc(g.inspector)}${g.invoice_no ? `　發票：${esc(g.invoice_no)}` : ''}</div>
          <table class="data"><thead><tr><th>品項</th><th>訂購數</th><th>本批到貨</th><th>累計到貨</th><th>未稅單價</th><th>未稅小計</th></tr></thead>
          <tbody>${g.items.map(i => `<tr><td>${esc(i.item_name)}</td><td>${i.ordered_qty} ${esc(i.unit)}</td>
            <td><strong>${i.received_qty}</strong></td>
            <td style="color:${i.cumulative_qty >= i.ordered_qty ? 'var(--ok)' : 'var(--danger)'}">${i.cumulative_qty}</td>
            <td>${money(i.unit_price)}</td><td>${money(i.received_qty * i.unit_price)}</td></tr>`).join('')}</tbody></table>
          ${g.note ? `<p>備註：${esc(g.note)}</p>` : ''}`);
      });
    });
  }

  function openReceiving(o, done) {
    if (!['pending', 'partial'].includes(o.status)) { alert(o.status === 'draft' ? '採購單尚未審核通過，不能驗貨' : '此採購單已全數入庫、結案或取消'); return; }
    const open = o.items.filter(i => i.remaining > 0);
    const batch = o.receipts.length + 1;
    openWide(`驗貨入庫 — ${o.no}（第 ${batch} 批）`, `
      <div style="background:var(--primary-light);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:.9rem">
        廠商：<strong>${esc(o.vendor_name)}</strong>　預計到貨：${esc(o.eta || '—')}${o.receipts.length ? `　已收 ${o.receipts.length} 批` : ''}</div>
      <div class="form-grid">
        <div class="field"><label>驗貨日期</label><input type="date" id="rc-date" value="${todayStr()}"></div>
        <div class="field"><label>驗貨人員 <b class="req">*</b></label><input id="rc-insp" value="${esc(currentUser.name)}"></div>
        <div class="field"><label>發票號碼<small>（本批）</small></label><input id="rc-inv" maxlength="30" placeholder="廠商發票號碼"></div>
        <div class="field"><label>備註</label><input id="rc-note" maxlength="500"></div>
      </div>
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>品項</th><th>訂購數</th><th>已到貨</th><th>本次到貨數</th><th>未稅單價</th><th>未稅小計</th></tr></thead>
        <tbody>${open.map(it => {
          const isNew = !it.supply_id;
          return `<tr data-item="${it.id}" data-remain="${it.remaining}">
            <td data-label="品項">${esc(it.item_name)}${isNew ? ` <span class="badge teal">新品項</span>
              <div class="row" style="gap:6px;margin-top:4px;flex-wrap:wrap">
                <input data-k="new_code" placeholder="品項編號" value="${esc(it.new_code || '')}" style="max-width:100px">
                <input data-k="new_unit" placeholder="單位" value="${esc(it.unit || '')}" style="max-width:70px">
                <input data-k="new_warehouse" placeholder="倉庫別" value="${esc(it.new_warehouse || '')}" style="max-width:100px">
                <input type="number" min="0" data-k="new_safety" title="安全庫存" value="${it.new_safety}" style="max-width:70px"></div>` : `<br><small style="color:var(--muted)">目前庫存 ${it.stock}</small>`}</td>
            <td data-label="訂購數">${it.qty} ${esc(it.unit)}</td>
            <td data-label="已到貨">${it.received_qty}<br><small style="color:var(--muted)">未到 ${it.remaining}</small></td>
            <td data-label="本次到貨數"><input type="number" min="0" max="${it.remaining}" data-k="received_qty" value="${it.remaining}" style="max-width:90px"></td>
            <td data-label="未稅單價"><input type="number" min="0" step="0.01" data-k="unit_price" value="${it.unit_price}" style="max-width:110px"></td>
            <td data-label="未稅小計" data-sub></td></tr>`;
        }).join('')}</tbody></table></div>
      <div style="text-align:right;font-weight:700;margin:8px 0">本批未稅合計：<span id="rc-total"></span></div>
      <p id="rc-hint" style="font-size:.85rem;color:var(--muted)"></p>
      <div class="row" style="gap:8px"><button class="btn" id="rc-go">確認本批入庫，產生請款單</button><span class="error-msg" id="rc-err"></span></div>`, body => {
      const recalc = () => {
        let total = 0, short = 0;
        body.querySelectorAll('[data-item]').forEach(tr => {
          const q = Number(val(tr, '[data-k="received_qty"]')) || 0;
          if (q < Number(tr.dataset.remain)) short++;
          const sub = q * (Number(val(tr, '[data-k="unit_price"]')) || 0);
          total += sub; tr.querySelector('[data-sub]').textContent = money(sub);
        });
        body.querySelector('#rc-total').textContent = money(total);
        body.querySelector('#rc-hint').textContent = short
          ? `有 ${short} 個品項本次未全數到貨，入庫後採購單會標為「部分到貨」，之後到貨再按「續收到貨」；若剩餘不再交貨，可按「結案」。`
          : '本次全數到齊，入庫後採購單轉為「已入庫」。';
      };
      body.querySelectorAll('input[data-k="received_qty"], input[data-k="unit_price"]').forEach(el => el.oninput = recalc);
      recalc();
      body.querySelector('#rc-go').onclick = async () => {
        const err = body.querySelector('#rc-err');
        err.textContent = '';
        const items = [...body.querySelectorAll('[data-item]')].map(tr => {
          const x = { po_item_id: Number(tr.dataset.item), received_qty: Number(val(tr, '[data-k="received_qty"]')), unit_price: Number(val(tr, '[data-k="unit_price"]')) };
          if (tr.querySelector('[data-k="new_unit"]')) Object.assign(x, { new_code: val(tr, '[data-k="new_code"]'), new_unit: val(tr, '[data-k="new_unit"]'),
            new_warehouse: val(tr, '[data-k="new_warehouse"]'), new_safety: Number(val(tr, '[data-k="new_safety"]')) });
          return x;
        });
        const over = items.find((x, i) => x.received_qty > Number(body.querySelectorAll('[data-item]')[i].dataset.remain));
        if (over) { err.textContent = '本次到貨數不可超過未到貨數量'; return; }
        try {
          const r = await api('/procurement/receipts', { method: 'POST', body: {
            po_id: o.id, receive_date: val(body, '#rc-date'), inspector: val(body, '#rc-insp'),
            invoice_no: val(body, '#rc-inv'), note: val(body, '#rc-note'), items } });
          alert(`第 ${r.batch_no} 批入庫完成（${r.no}），庫存已更新${r.new_items ? `，新建 ${r.new_items} 個品項` : ''}。\n請款單 ${r.payment_no} 已自動建立。\n${r.complete ? '採購單已全數到齊。' : '尚有未到貨數量，採購單標為「部分到貨」。'}`);
          closeModal();
          await askMonthlyMerge(r);
          done && done();
        } catch (e) { err.textContent = e.message; }
      };
    });
  }

  /* ================= 請款單 ================= */
  async function viewProcPayments() {
    const [vendors, st] = await Promise.all([api('/procurement/vendors?active=all'), procSettings()]);
    main().innerHTML = `
      <div class="page-title">請款單</div>
      ${filterBar({ dateLabel: '日期', dateFields: [['req', '以請款日期查詢'], ['due', '以付款到期日查詢']], statuses: PAY_ST, vendors, companies: st.companies, placeholder: '請款單號／發票號／廠商' })}
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>請款單號</th><th>廠商</th><th>入庫／採購單</th><th>發票號碼</th><th>含稅金額</th><th>付款到期日</th><th>狀態</th><th class="no-print"></th></tr></thead>
        <tbody id="pay-body"></tbody></table></div>
        <div id="pay-sum" style="text-align:right;margin-top:8px;font-weight:700"></div>
        <small style="color:var(--muted)">請款單由驗貨入庫自動建立；匯款帳號、付款條件取自廠商管理。</small></div>`;
    let lastQs = '';
    const reload = () => load(lastQs, () => {});
    async function load(qs, setCount) {
      lastQs = qs;
      const rows = await api('/procurement/payments?' + qs);
      setCount(rows.length);
      const unpaid = rows.filter(p => p.status === 'unpaid').reduce((t, p) => t + p.total_amount, 0);
      $('#pay-sum').textContent = `本查詢待付款合計：${money(unpaid)}`;
      $('#pay-body').innerHTML = rows.map(p => `<tr>
        <td data-label="請款單號">${esc(p.no)}<br><small>${esc(p.req_date)}</small>${coTag(st, p.company_name)}</td>
        <td data-label="廠商">${esc(p.vendor_name || '')}</td>
        <td data-label="入庫／採購單"><small>${esc(p.gr_nos || p.gr_no || '')}<br>${esc(p.po_nos || p.po_no || '')}</small></td>
        <td data-label="發票號碼">${esc(p.invoice_no || '—')}</td>
        <td data-label="含稅金額"><strong>${money(p.total_amount)}</strong><br><small>未稅 ${money(p.subtotal)}＋稅 ${money(p.tax_amount)}</small></td>
        <td data-label="付款到期日">${esc(p.pay_due_date || '—')}${p.status === 'unpaid' && p.pay_due_date && p.pay_due_date < todayStr() ? ' <span class="badge red">逾期</span>' : ''}</td>
        <td data-label="狀態">${p.merged_into ? `<span class="badge gray">已合併</span><br><small>併入 ${esc(p.merged_into_no || '')}</small>` : badge(PAY_ST, p.status)}${p.status === 'paid' ? `<br><small>${esc(p.paid_on || '')} ${esc(p.pay_method || '')}</small>` : ''}
          ${p.status !== 'cancelled' && p.month_count > 1 ? `<br><span class="badge red" title="公司規定同一廠商每月只開一張請款單">本月同廠商 ${p.month_count} 張</span>` : ''}</td>
        <td data-label="操作" class="no-print">
          ${p.status === 'unpaid' && can('payables') ? `<button class="btn small" data-pay="${p.id}">填金額／付款</button>` : ''}
          ${p.status === 'unpaid' && p.month_unpaid > 1 && can('payables') ? `<button class="btn small secondary" data-merge="${p.id}">合併請款</button>` : ''}
          <button class="btn small secondary" data-print="${p.id}">支付憑單</button>
          ${p.status === 'paid' && currentUser.role === 'admin' ? `<button class="btn small danger" data-unpay="${p.id}">改回待付款</button>` : ''}
        </td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">查無請款單</div></td></tr>';
      main().querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => openPayForm(await api('/procurement/payments/' + b.dataset.pay), reload));
      main().querySelectorAll('[data-print]').forEach(b => b.onclick = async () => printPayment(await api('/procurement/payments/' + b.dataset.print)));
      main().querySelectorAll('[data-merge]').forEach(b => b.onclick = () => openMerge(rows.find(x => String(x.id) === b.dataset.merge), reload));
      main().querySelectorAll('[data-unpay]').forEach(b => b.onclick = async () => {
        if (!confirm('將此請款單改回「待付款」？（會留下稽核紀錄）')) return;
        try { await api(`/procurement/payments/${b.dataset.unpay}/unpay`, { method: 'POST' }); reload(); } catch (e) { alert(e.message); }
      });
    }
    wireFilter(main(), load);
  }

  // 公司規定：同一家廠商一個月只開一張請款單。新請款單產生時，若同月已有待付款的，詢問是否合併並重出支付憑單
  async function askMonthlyMerge(r) {
    const cands = r.merge_candidates || [];
    if (!cands.length) {
      if (r.month_paid) alert(`提醒：「${r.vendor_name}」本月已有已付款的請款單，依規定同一廠商每月只開一張請款單。\n如需合併，請由管理員將已付款單改回待付款後，於請款單頁合併。`);
      return;
    }
    if (!can('payables')) {
      alert(`提醒：「${r.vendor_name}」本月已有待付款請款單 ${cands.map(c => c.no).join('、')}，依規定應合併請款，請通知財務於請款單頁合併。`);
      return;
    }
    const target = cands[0];
    if (!confirm(`「${r.vendor_name}」本月已有待付款請款單 ${cands.map(c => `${c.no}（${money(c.total_amount)}）`).join('、')}。\n\n公司規定同一廠商一個月只開一張請款單，是否將剛產生的 ${r.payment_no} 合併到 ${target.no}，並重新列印支付憑單？`)) return;
    try {
      const ids = [r.payment_id, ...cands.slice(1).map(c => c.id)];
      const merged = await api(`/procurement/payments/${target.id}/merge`, { method: 'POST', body: { ids } });
      alert(`已合併至 ${merged.no}，含稅總額 ${money(merged.total_amount)}。接著開啟支付憑單供重新列印。`);
      printPayment(merged);
    } catch (e) { alert('合併失敗：' + e.message); }
  }

  async function openMerge(p, done) {
    const d = await api('/procurement/payments/' + p.id);
    const others = d.month_others.filter(x => x.status === 'unpaid');
    openWide(`合併請款 — ${d.vendor_name}（${String(d.req_date).slice(0, 7)}）`, `
      <p style="font-size:.9rem">${d.company_name ? `採購公司：${esc(d.company_name)}。` : ''}公司規定同一廠商一個月只開一張請款單（依採購公司分開計）。勾選要併入 <strong>${esc(d.no)}</strong> 的請款單，合併後明細、發票號碼與金額會彙總到這一張，被合併的請款單改為「已合併」。</p>
      <table class="data"><thead><tr><th>併入</th><th>請款單號</th><th>請款日</th><th>含稅金額</th></tr></thead>
        <tbody>${others.map(x => `<tr><td><input type="checkbox" data-m="${x.id}" checked></td><td>${esc(x.no)}</td><td>${esc(x.req_date)}</td><td>${money(x.total_amount)}</td></tr>`).join('')
          || '<tr><td colspan="4"><div class="empty">本月沒有其他待付款的請款單</div></td></tr>'}</tbody></table>
      ${d.month_others.some(x => x.status === 'paid') ? '<p style="color:var(--danger);font-size:.85rem">本月另有已付款的請款單，已付款的不能合併；如需合併請管理員先改回待付款。</p>' : ''}
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn" id="mg-go" ${others.length ? '' : 'disabled'}>合併並重出支付憑單</button><span class="error-msg" id="mg-err"></span></div>`, body => {
      body.querySelector('#mg-go').onclick = async () => {
        const ids = [...body.querySelectorAll('[data-m]:checked')].map(c => Number(c.dataset.m));
        if (!ids.length) { body.querySelector('#mg-err').textContent = '請勾選要合併的請款單'; return; }
        try {
          const merged = await api(`/procurement/payments/${d.id}/merge`, { method: 'POST', body: { ids } });
          closeModal();
          printPayment(merged);
          done && done();
        } catch (e) { body.querySelector('#mg-err').textContent = e.message; }
      };
    });
  }

  function termDays(terms) { const m = /(\d+)/.exec(terms || ''); return m ? Number(m[1]) : (/貨到|預付/.test(terms || '') ? 0 : 30); }
  function addDays(date, n) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  function openPayForm(p, done) {
    const days = termDays(p.vendor_terms);
    const sameMonth = (p.month_others || []);
    openWide(`填寫請款資訊 — ${p.no}`, `
      ${sameMonth.length ? `<div style="background:#fdeeee;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:.88rem">
        提醒：「${esc(p.vendor_name)}」本月另有請款單 ${esc(sameMonth.map(x => `${x.no}（${PAY_ST[x.status] ? PAY_ST[x.status][0] : x.status}）`).join('、'))}，公司規定同一廠商每月只開一張，建議先到列表按「合併請款」。</div>` : ''}
      <div class="form-grid" style="margin-bottom:8px">
        <div class="card" style="margin:0;background:var(--bg)">
          <div style="color:var(--muted);font-size:.8rem">廠商</div><strong>${esc(p.vendor_name || '')}</strong>
          <div style="font-size:.85rem">統編：${esc(p.vendor_tax_id || '—')}　付款條件：${esc(p.vendor_terms || '—')}</div>
          <div style="font-size:.85rem">入庫單：${esc(p.gr_no || '—')}　採購單：${esc(p.po_no || '—')}</div></div>
        <div class="card" style="margin:0;background:var(--bg)">
          <div style="color:var(--muted);font-size:.8rem">匯款資料（廠商管理）</div>
          ${p.bank_account ? `<div>${esc(p.bank_name || '')} ${esc(p.bank_branch || '')}（${esc(p.bank_code || '')}）</div>
            <div style="font-size:1.05rem;font-weight:700;color:var(--primary-dark)">${esc(p.bank_account)}</div><div style="font-size:.85rem">戶名：${esc(p.bank_holder || '')}</div>`
            : '<div style="color:var(--danger)">廠商尚未填寫銀行資料，請至廠商管理補齊</div>'}</div>
      </div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>品項</th><th>數量</th><th>未稅單價</th><th>未稅小計</th></tr></thead>
        <tbody>${p.items.map(it => `<tr data-item="${it.id}" data-qty="${it.qty}">
          <td data-label="品項">${esc(it.item_name)}</td><td data-label="數量">${it.qty} ${esc(it.unit)}</td>
          <td data-label="未稅單價"><input type="number" min="0" step="0.01" data-k="unit_price" value="${it.unit_price}" style="max-width:110px"></td>
          <td data-label="未稅小計" data-sub></td></tr>`).join('')}</tbody></table></div>
      <div class="form-grid" style="margin-top:8px">
        <div class="field"><label>未稅總額</label><input id="pf-sub" disabled></div>
        <div class="field"><label>稅率（%）</label><input type="number" min="0" max="100" step="0.1" id="pf-rate" value="${p.tax_rate}"></div>
        <div class="field"><label>稅額</label><input id="pf-tax" disabled></div>
        <div class="field"><label>含稅總額（應付）<small>（可手動調整，留空＝依計算）</small></label>
          <input type="number" min="0" id="pf-total" placeholder="" value="${p.total_amount !== p.subtotal + p.tax_amount ? p.total_amount : ''}"></div>
        <div class="field"><label>發票號碼</label><input id="pf-inv" maxlength="200" value="${esc(p.invoice_no || '')}"></div>
        <div class="field"><label>發票日期</label><input type="date" id="pf-invdate" value="${esc(p.invoice_date || '')}"></div>
        <div class="field"><label>付款到期日 <small>（發票日＋${days} 天）</small></label><input type="date" id="pf-due" value="${esc(p.pay_due_date || '')}"></div>
        <div class="field"><label>付款方式</label><select id="pf-method">${PAY_METHODS.map(m => `<option ${p.pay_method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label>預算編號</label><input id="pf-budget" value="${esc(p.budget_no || '')}"></div>
        <div class="field"><label>費用歸屬</label><input id="pf-cost" value="${esc(p.cost_center || '')}"></div>
        <div class="field"><label>實際付款日</label><input type="date" id="pf-paidon" value="${todayStr()}"></div>
        <div class="field full"><label>備註</label><input id="pf-remark" value="${esc(p.remark || '')}"></div>
      </div>
      <div style="text-align:right;font-size:1.15rem;font-weight:700;margin:6px 0">應付：<span id="pf-final"></span></div>
      <div class="row" style="gap:8px">
        <button class="btn secondary" id="pf-save">只儲存金額</button>
        <button class="btn" id="pf-pay">確認付款完成</button>
        <span class="error-msg" id="pf-err"></span></div>`, body => {
      const recalc = () => {
        let sub = 0;
        body.querySelectorAll('[data-item]').forEach(tr => {
          const s = Math.round((Number(val(tr, '[data-k="unit_price"]')) || 0) * Number(tr.dataset.qty));
          sub += s; tr.querySelector('[data-sub]').textContent = money(s);
        });
        const tax = Math.round(sub * (Number(val(body, '#pf-rate')) || 0) / 100);
        body.querySelector('#pf-sub').value = money(sub);
        body.querySelector('#pf-tax').value = money(tax);
        body.querySelector('#pf-total').placeholder = String(sub + tax);
        const manual = val(body, '#pf-total');
        body.querySelector('#pf-final').textContent = money(manual === '' ? sub + tax : Number(manual));
      };
      body.querySelectorAll('input[data-k="unit_price"], #pf-rate, #pf-total').forEach(el => el.oninput = recalc);
      body.querySelector('#pf-invdate').onchange = () => { const d = val(body, '#pf-invdate'); if (d) body.querySelector('#pf-due').value = addDays(d, days); };
      recalc();
      const payload = () => ({
        items: [...body.querySelectorAll('[data-item]')].map(tr => ({ id: Number(tr.dataset.item), unit_price: Number(val(tr, '[data-k="unit_price"]')) })),
        tax_rate: Number(val(body, '#pf-rate')), total_amount: val(body, '#pf-total'),
        invoice_no: val(body, '#pf-inv'), invoice_date: val(body, '#pf-invdate'), pay_due_date: val(body, '#pf-due'),
        pay_method: val(body, '#pf-method'), budget_no: val(body, '#pf-budget'), cost_center: val(body, '#pf-cost'),
        remark: val(body, '#pf-remark'), paid_on: val(body, '#pf-paidon')
      });
      body.querySelector('#pf-save').onclick = async () => {
        try { await api('/procurement/payments/' + p.id, { method: 'PUT', body: payload() }); closeModal(); done && done(); }
        catch (e) { body.querySelector('#pf-err').textContent = e.message; }
      };
      body.querySelector('#pf-pay').onclick = async () => {
        if (!confirm(`確認已付款 ${body.querySelector('#pf-final').textContent} 給「${p.vendor_name}」？`)) return;
        try { await api(`/procurement/payments/${p.id}/pay`, { method: 'POST', body: payload() }); closeModal(); done && done(); }
        catch (e) { body.querySelector('#pf-err').textContent = e.message; }
      };
    });
  }

  async function printPayment(p) {
    const s = await procSettings();
    const box = on => (on ? '■' : '□');
    const t = p.trail || { requests: [], orders: [], receipts: [] };
    const itemsText = list => list.map(i => `${esc(i.item_name)} ×${i.qty !== undefined ? i.qty : i.received_qty}${esc(i.unit || '')}`).join('、');
    const trail = `
      <div class="trail">
        <h3>請採驗流程紀錄　${esc(p.no)}（${esc(p.vendor_name || '')}）</h3>
        <div style="font-weight:700;margin:1mm 0 0.5mm">一、請購單</div>
        <table>${cols([19, 13, 30, 19, 19])}
          <tr><th>請購單號</th><th>請購日</th><th>品項及數量</th><th>建立</th><th>核准</th></tr>
          ${t.requests.map(r => `<tr><td>${esc(r.no)}</td><td class="c">${esc(r.req_date)}</td><td>${itemsText(r.items)}</td>
            <td>${dt16(r.created_at)}<br>${esc(r.created_name || '')}（申請人 ${esc(r.requester)}）</td>
            <td>${dt16(r.approved_at)}<br>${esc(r.approved_name || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="c">—</td></tr>'}
        </table>
        <div style="font-weight:700;margin:1mm 0 0.5mm">二、採購單</div>
        <table>${cols([19, 13, 30, 19, 19])}
          <tr><th>採購單號</th><th>採購日</th><th>品項、數量、單價</th><th>建立</th><th>審核</th></tr>
          ${t.orders.map(o => `<tr><td>${esc(o.no)}${o.quote_count ? `<br><small>比價 ${o.quote_count} 筆</small>` : ''}</td><td class="c">${esc(o.po_date)}</td>
            <td>${o.items.map(i => `${esc(i.item_name)} ×${i.qty}${esc(i.unit)} @${money(i.unit_price)}`).join('、')}<br><small>預算 ${o.budget_amount ? money(o.budget_amount) : '—'}</small></td>
            <td>${dt16(o.created_at)}<br>${esc(o.created_name || '')}</td>
            <td>${dt16(o.approved_at)}<br>${esc(o.approved_name || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="c">—</td></tr>'}
        </table>
        <div style="font-weight:700;margin:1mm 0 0.5mm">三、驗貨單</div>
        <table>${cols([19, 13, 30, 19, 19])}
          <tr><th>入庫單號</th><th>驗貨日</th><th>本批品項及數量</th><th>建立</th><th>驗貨人員／發票</th></tr>
          ${t.receipts.map(g => `<tr><td>${esc(g.no)}<br><small>第 ${g.batch_no} 批</small></td><td class="c">${esc(g.receive_date)}</td>
            <td>${itemsText(g.items)}</td><td>${dt16(g.created_at)}<br>${esc(g.created_name || '')}</td>
            <td>${esc(g.inspector)}<br>${esc(g.invoice_no || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="c">—</td></tr>'}
        </table>
      </div>`;
    printDoc(`請款支付憑單 ${p.no}`, `
      <h1>${esc(headOf(p, s).name)}</h1><h2 style="text-decoration:underline">請款支付憑單</h2>
      <div class="sub"><span>${ymd(p.invoice_date || p.req_date)}</span><span>單號：${esc(p.no)}${p.merged_from && p.merged_from.length ? `（合併 ${esc(p.merged_from.map(x => x.no).join('、'))}）` : ''}</span></div>
      ${infoTable([
        ['預算編號', esc(p.budget_no || ''), '廠商名稱', esc(p.vendor_name || '')],
        ['阿米巴項目', '', '統一編號', esc(p.vendor_tax_id || '')],
        ['部門別', esc(headOf(p, s).pay_dept), '發票號碼', esc(p.invoice_no || '')],
        ['費用歸屬', esc(p.cost_center || ''), '付款到期日', esc(p.pay_due_date || '')],
        ['金　額', `新台幣 ${chineseAmount(p.total_amount)}　<strong>NT$ ${Number(p.total_amount).toLocaleString('en-US')}</strong>`],
        ['事　由', `${itemsText(p.items)}　未稅 ${money(p.subtotal)}${p.tax_amount ? `＋稅 ${money(p.tax_amount)}` : ''}${p.remark ? `<br>${esc(p.remark)}` : ''}`],
        ['領款人', esc(p.bank_holder || p.vendor_name || ''), '領款方式', `□自取 □送達 □郵寄 ${box(p.pay_method === '銀行轉帳')}匯款`],
        ['付款方式', `${box(p.pay_method === '現金')}現金　${box(p.pay_method === '支票')}票據，票期：___年___月___日　票號：__________<br>
          ${box(p.pay_method === '銀行轉帳' || p.pay_method === '其他')}${p.pay_method === '其他' ? '其他' : '匯款'}　銀行：${esc(p.bank_name || '')}${p.bank_branch ? ' ' + esc(p.bank_branch) : ''}${p.bank_code ? `（${esc(p.bank_code)}）` : ''}　帳號：${esc(p.bank_account || '')}`],
        ['領款人簽收', '<div style="height:9mm"></div>']
      ])}
      <table>${cols(Array(9).fill(100 / 9))}
        <tr><th>核准</th><th>覆核</th><th>審核</th><th>單位<br>主管</th><th>申請人</th><th>財務<br>經理</th><th>會計<br>主管</th><th>會計</th><th>出納</th></tr>
        <tr class="sign"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="c">${p.status === 'paid' ? esc(p.paid_name || '') : ''}</td></tr>
      </table>
      <table>${cols([34, 22, 14, 15, 15])}
        <tr><th>品項名稱</th><th>入庫單／採購單</th><th>數量</th><th>未稅單價</th><th>未稅小計</th></tr>
        ${p.items.map(i => `<tr><td>${esc(i.item_name)}</td><td><small>${esc(i.gr_no || p.gr_no || '')}<br>${esc(i.po_no || p.po_no || '')}</small></td>
          <td class="c">${i.qty} ${esc(i.unit)}</td><td class="r">${money(i.unit_price)}</td><td class="r">${money(i.amount)}</td></tr>`).join('')}
        <tr><td colspan="4" class="r">未稅合計</td><td class="r">${money(p.subtotal)}</td></tr>
        <tr><td colspan="4" class="r">稅額（${p.tax_rate}%）</td><td class="r">${money(p.tax_amount)}</td></tr>
        <tr><td colspan="4" class="r"><strong>含稅總額</strong></td><td class="r"><strong>${money(p.total_amount)}</strong></td></tr>
      </table>
      <div class="foot">${p.status === 'paid' ? `已付款：${esc(p.paid_on || '')}（${esc(p.paid_name || '')}，${esc(p.pay_method || '')}）` : '狀態：待付款'}</div>
      ${trail}`);
  }

  /* ================= 出貨管理 ================= */
  async function viewProcShipments() {
    const st = await procSettings();
    main().innerHTML = `
      <div class="page-title">出貨管理</div>
      <div class="card no-print"><div class="row" style="gap:8px">
        ${can('purchasing') ? '<button class="btn" id="sh-new">新增出貨單</button>' : ''}
        <span style="color:var(--muted);font-size:.85rem">建立出貨單會同時產生領料單；按「確認出貨」才從備品庫存扣除。</span></div></div>
      ${filterBar({ dateLabel: '出貨日期', statuses: SHIP_ST, companies: st.companies, placeholder: '出貨單號／客戶部門／品名' })}
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>出貨單號</th><th>出貨日期</th><th>客戶／部門</th><th>品項數</th><th>領料單</th><th>狀態</th><th class="no-print"></th></tr></thead>
        <tbody id="sh-body"></tbody></table></div></div>`;
    let lastQs = '';
    const reload = () => load(lastQs, () => {});
    const nb = main().querySelector('#sh-new');
    if (nb) nb.onclick = () => openShipForm(null, reload);
    async function load(qs, setCount) {
      lastQs = qs;
      const rows = await api('/procurement/shipments?' + qs);
      setCount(rows.length);
      $('#sh-body').innerHTML = rows.map(s => `<tr>
        <td data-label="出貨單號">${esc(s.no)}${coTag(st, s.company_name)}</td><td data-label="出貨日期">${esc(s.ship_date)}</td>
        <td data-label="客戶／部門">${esc(s.recipient)}${s.note ? `<br><small style="color:var(--muted)">${esc(s.note)}</small>` : ''}</td>
        <td data-label="品項數">${s.item_count}</td>
        <td data-label="領料單">${esc(s.pick_no || '—')}</td>
        <td data-label="狀態">${badge(SHIP_ST, s.status)}</td>
        <td data-label="操作" class="no-print">
          <button class="btn small secondary" data-view="${s.id}">查看</button>
          ${s.status === 'pending' && can('purchasing') ? `<button class="btn small secondary" data-edit="${s.id}">修改</button>
            <button class="btn small" data-confirm="${s.id}">確認出貨</button>
            <button class="btn small danger" data-cancel="${s.id}">取消</button>` : ''}
        </td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">查無出貨單</div></td></tr>';
      main().querySelectorAll('[data-view]').forEach(b => b.onclick = async () => showShipment(await api('/procurement/shipments/' + b.dataset.view)));
      main().querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => openShipForm(await api('/procurement/shipments/' + b.dataset.edit), reload));
      main().querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
        if (!confirm('確認出貨？將從備品庫存扣除並將領料單改為已領料。')) return;
        try { await api(`/procurement/shipments/${b.dataset.confirm}/confirm`, { method: 'POST' }); reload(); } catch (e) { alert(e.message); }
      });
      main().querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
        if (!confirm('取消這張出貨單（領料單一併取消）？')) return;
        try { await api(`/procurement/shipments/${b.dataset.cancel}/cancel`, { method: 'POST' }); reload(); } catch (e) { alert(e.message); }
      });
    }
    wireFilter(main(), load);
  }

  async function openShipForm(s, done) {
    const [{ rows: items }, st] = await Promise.all([api('/procurement/items'), procSettings()]);
    const unitOf = id => (items.find(i => String(i.id) === String(id)) || {}).unit || '';
    const lineHtml = (it = {}) => `<tr data-line>
      <td data-label="品項"><select data-k="supply_id" style="min-width:240px"><option value="">-- 選擇品項 --</option>${itemOptions(items, it.supply_id)}</select></td>
      <td data-label="單位" data-unit>${esc(it.unit || unitOf(it.supply_id))}</td>
      <td data-label="數量"><input type="number" min="1" data-k="qty" value="${it.qty || 1}" style="max-width:90px"></td>
      <td><button class="btn small danger" data-del>刪</button></td></tr>`;
    openWide(s ? `修改出貨單 ${s.no}` : '新增出貨單', `
      <div class="form-grid">
        ${multiCo(st) ? `<div class="field"><label>公司</label>${companySelect(st, s && s.company_id, 'shf-co')}</div>` : ''}
        <div class="field"><label>客戶／部門 <b class="req">*</b></label><input id="shf-to" value="${esc(s ? s.recipient : '')}" placeholder="客戶或內部部門"></div>
        <div class="field"><label>出貨日期</label><input type="date" id="shf-date" value="${esc(s ? s.ship_date : todayStr())}"></div>
        <div class="field full"><label>備註</label><input id="shf-note" value="${esc(s ? s.note : '')}"></div>
      </div>
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>品項（目前庫存）</th><th>單位</th><th>數量</th><th></th></tr></thead>
        <tbody id="shf-lines">${(s ? s.items : [{}]).map(lineHtml).join('')}</tbody></table></div>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn small secondary" id="shf-add">新增品項</button>
        <button class="btn" id="shf-save">${s ? '儲存修改' : '建立出貨單並產生領料單'}</button>
        <span class="error-msg" id="shf-err"></span></div>`, body => {
      const wire = tr => {
        tr.querySelector('[data-del]').onclick = () => tr.remove();
        const sel = tr.querySelector('[data-k="supply_id"]');
        sel.onchange = () => { tr.querySelector('[data-unit]').textContent = unitOf(sel.value); };
      };
      body.querySelectorAll('[data-line]').forEach(wire);
      body.querySelector('#shf-add').onclick = () => { body.querySelector('#shf-lines').insertAdjacentHTML('beforeend', lineHtml()); wire(body.querySelector('#shf-lines').lastElementChild); };
      body.querySelector('#shf-save').onclick = async () => {
        const lines = [...body.querySelectorAll('[data-line]')].map(tr => ({ supply_id: Number(val(tr, '[data-k="supply_id"]')), qty: Number(val(tr, '[data-k="qty"]')) })).filter(l => l.supply_id);
        const payload = { company_id: Number(val(body, '#shf-co')) || null, recipient: val(body, '#shf-to'), ship_date: val(body, '#shf-date'), note: val(body, '#shf-note'), items: lines };
        try {
          if (s) await api('/procurement/shipments/' + s.id, { method: 'PUT', body: payload });
          else { const r = await api('/procurement/shipments', { method: 'POST', body: payload }); alert(`出貨單 ${r.no} 已建立，領料單 ${r.pick_no} 已產生`); }
          closeModal(); done && done();
        } catch (e) { body.querySelector('#shf-err').textContent = e.message; }
      };
    });
  }

  function showShipment(s) {
    openWide(`出貨單 ${s.no}`, `
      <div style="margin-bottom:8px">客戶／部門：<strong>${esc(s.recipient)}</strong>　日期：${esc(s.ship_date)}　狀態：${badge(SHIP_ST, s.status)}
        ${s.status === 'shipped' ? `　出貨人：${esc(s.shipped_name || '')} ${esc((s.shipped_at || '').slice(0, 16))}` : ''}</div>
      <table class="data"><thead><tr><th>品項</th><th>單位</th><th>數量</th><th>目前庫存</th></tr></thead>
        <tbody>${s.items.map(i => `<tr><td>${esc(i.item_name)}</td><td>${esc(i.unit)}</td><td><strong>${i.qty}</strong></td><td>${i.stock}</td></tr>`).join('')}</tbody></table>
      ${s.pick ? `<div class="row" style="margin-top:10px;gap:8px"><span>領料單：${esc(s.pick.no)} ${badge(PICK_ST, s.pick.status)}</span>
        <button class="btn small secondary" id="shv-print">列印領料單</button></div>` : ''}`, body => {
      const b = body.querySelector('#shv-print');
      if (b) b.onclick = () => printPick({ ...s.pick, ship_no: s.no, items: s.items, company_name: s.company_name, company_id: s.company_id });
    });
  }

  /* ================= 領料單 ================= */
  async function viewProcPicks() {
    main().innerHTML = `
      <div class="page-title">領料單</div>
      ${filterBar({ dateLabel: '領料日期', statuses: PICK_ST, placeholder: '領料單號／出貨單號／領用對象' })}
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>領料單號</th><th>出貨單號</th><th>領用對象</th><th>日期</th><th>品項數</th><th>狀態</th><th class="no-print"></th></tr></thead>
        <tbody id="pk-body"></tbody></table></div>
        <small style="color:var(--muted)">領料單隨出貨單自動建立；出貨確認後自動轉為已領料。</small></div>`;
    wireFilter(main(), async (qs, setCount) => {
      const rows = await api('/procurement/picks?' + qs);
      setCount(rows.length);
      $('#pk-body').innerHTML = rows.map(p => `<tr>
        <td data-label="領料單號">${esc(p.no)}</td><td data-label="出貨單號">${esc(p.ship_no)}</td>
        <td data-label="領用對象">${esc(p.recipient)}</td><td data-label="日期">${esc(p.pick_date)}</td>
        <td data-label="品項數">${p.item_count}</td><td data-label="狀態">${badge(PICK_ST, p.status)}</td>
        <td data-label="操作" class="no-print"><button class="btn small secondary" data-print="${p.shipment_id}">查看／列印</button></td></tr>`).join('')
        || '<tr><td colspan="7"><div class="empty">查無領料單</div></td></tr>';
      main().querySelectorAll('[data-print]').forEach(b => b.onclick = async () => {
        const s = await api('/procurement/shipments/' + b.dataset.print);
        printPick({ ...s.pick, ship_no: s.no, items: s.items, company_name: s.company_name, company_id: s.company_id });
      });
    });
  }
  async function printPick(p) {
    const s = await procSettings();
    const blanks = Math.max(0, 8 - p.items.length);
    printDoc(`領料單 ${p.no}`, `
      <h1>${esc(headOf(p, s).name)}</h1><h2>領料單</h2>
      ${infoTable([
        ['領料單號', esc(p.no), '出貨單號', esc(p.ship_no)],
        ['領用對象', esc(p.recipient), '日期', esc(p.pick_date)]
      ])}
      <table>${cols([9, 51, 14, 14, 12])}
        <tr><th>項次</th><th>品項名稱</th><th>單位</th><th>數量</th><th>確認</th></tr>
        ${p.items.map((i, n) => `<tr><td class="c">${n + 1}</td><td>${esc(i.item_name)}</td><td class="c">${esc(i.unit)}</td>
          <td class="c"><strong>${i.qty}</strong></td><td class="c">□</td></tr>`).join('')}
        ${'<tr class="blank"><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(blanks)}
      </table>
      <table>${cols([33.3, 33.3, 33.4])}
        <tr><th>領料人簽名</th><th>發料人簽名</th><th>主管</th></tr>
        <tr class="sign"><td></td><td></td><td></td></tr>
      </table>`);
  }

  /* ================= 庫存總覽 ================= */
  async function viewProcStock() {
    const [first, vendors] = await Promise.all([api('/procurement/items'), api('/procurement/vendors')]);
    main().innerHTML = `
      <div class="page-title">庫存總覽</div>
      <div class="card no-print"><div class="form-grid">
        <div class="field"><label>倉庫別</label><select id="st-wh"><option value="">全部倉庫</option>${first.warehouses.map(w => `<option>${esc(w)}</option>`).join('')}</select></div>
        <div class="field"><label>供應廠商</label><select id="st-vendor"><option value="">全部廠商</option>${vendors.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
        <div class="field"><label>關鍵字</label><input id="st-q" placeholder="品項編號／名稱"></div>
        <div class="field"><label>&nbsp;</label><label class="bna-chk"><input type="checkbox" id="st-low"> 只看庫存不足</label></div>
      </div></div>
      <div class="stat-grid" id="st-stats"></div>
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>品項編號</th><th>品項名稱</th><th>倉庫別</th><th>目前庫存</th><th>安全庫存</th><th>參考單價</th><th>未稅庫存值</th><th>狀態</th><th class="no-print"></th></tr></thead>
        <tbody id="st-body"></tbody></table></div>
        <small style="color:var(--muted)">庫存與「備品庫存管理」為同一份數字：驗貨入庫加、確認出貨扣、盤點調整，都會即時反映。</small></div>`;
    const load = async () => {
      const p = new URLSearchParams();
      if ($('#st-wh').value) p.set('warehouse', $('#st-wh').value);
      if ($('#st-vendor').value) p.set('vendor_id', $('#st-vendor').value);
      if ($('#st-q').value.trim()) p.set('q', $('#st-q').value.trim());
      if ($('#st-low').checked) p.set('low', '1');
      const { rows } = await api('/procurement/items?' + p);
      const value = rows.reduce((t, r) => t + r.stock * r.price, 0);
      const low = rows.filter(r => r.stock < r.safety_stock);
      $('#st-stats').innerHTML = `
        <div class="stat"><div class="num">${rows.length}</div><div class="label">品項數</div></div>
        <div class="stat"><div class="num" style="color:${low.length ? 'var(--danger)' : ''}">${low.length}</div><div class="label">庫存不足</div></div>
        <div class="stat"><div class="num" style="font-size:1.3rem">${money(value)}</div><div class="label">庫存未稅總值（依參考單價）</div></div>`;
      $('#st-body').innerHTML = rows.map(r => {
        const isLow = r.stock < r.safety_stock;
        return `<tr>
          <td data-label="品項編號">${esc(r.code || '—')}</td>
          <td data-label="品項名稱">${esc(r.name)}${r.vendors.length ? `<br><small style="color:var(--muted)">${esc(r.vendors.map(v => v.name + (v.is_default ? '（預設）' : '')).join('、'))}</small>` : ''}</td>
          <td data-label="倉庫別">${esc(r.warehouse || '—')}</td>
          <td data-label="目前庫存"><strong style="color:${isLow ? 'var(--danger)' : 'var(--ok)'}">${r.stock}</strong> ${esc(r.unit)}</td>
          <td data-label="安全庫存">${r.safety_stock}</td>
          <td data-label="參考單價">${r.price ? money(r.price) : '<span style="color:var(--muted)">未設</span>'}</td>
          <td data-label="未稅庫存值">${r.price ? money(r.stock * r.price) : '—'}</td>
          <td data-label="狀態">${isLow ? '<span class="badge red">庫存不足</span>' : '<span class="badge green">正常</span>'}</td>
          <td data-label="操作" class="no-print">
            ${can('purchasing') ? `<button class="btn small" data-req="${r.id}">請購</button>` : ''}
            <button class="btn small secondary" data-hist="${r.id}">歷史</button></td></tr>`;
      }).join('') || '<tr><td colspan="9"><div class="empty">查無品項</div></td></tr>';
      main().querySelectorAll('[data-req]').forEach(b => b.onclick = () => {
        const r = rows.find(x => String(x.id) === b.dataset.req);
        openPrForm(null, [{ supply_id: r.id, qty: Math.max(1, r.safety_stock * 2 - r.stock) }], load);
      });
      main().querySelectorAll('[data-hist]').forEach(b => b.onclick = () => showItemHistory(b.dataset.hist));
    };
    ['#st-wh', '#st-vendor', '#st-low'].forEach(id => { $(id).onchange = load; });
    $('#st-q').oninput = () => { clearTimeout(load._t); load._t = setTimeout(load, 300); };
    load();
  }

  async function showItemHistory(id) {
    const h = await api(`/procurement/items/${id}/history`);
    openWide(`品項歷史 — ${h.item.name}`, `
      <div class="form-grid" style="margin-bottom:8px">
        <div class="card" style="margin:0;background:var(--bg)">編號：${esc(h.item.code || '—')}　單位：${esc(h.item.unit)}　倉庫：${esc(h.item.warehouse || '—')}<br>
          目前庫存：<strong>${h.item.stock} ${esc(h.item.unit)}</strong><br>
          供應廠商：${h.vendors.length ? esc(h.vendors.map(v => v.name + (v.is_default ? '（預設）' : '')).join('、')) : '未設定'}</div>
        <div class="card" style="margin:0;background:var(--bg)"><strong>廠商進貨統計</strong><br>
          ${h.vendor_stats.map(v => `${esc(v.name || '—')}：${v.times} 次／共 ${v.total_qty} ${esc(h.item.unit)}`).join('<br>') || '尚無進貨紀錄'}</div>
      </div>
      <table class="data"><thead><tr><th>採購單號</th><th>廠商</th><th>日期</th><th>數量</th><th>單價</th><th>狀態</th></tr></thead>
        <tbody>${h.orders.map(o => `<tr><td>${esc(o.no)}</td><td>${esc(o.vendor_name || '')}</td><td>${esc(o.po_date)}</td><td>${o.qty}</td><td>${money(o.unit_price)}</td><td>${badge(PO_ST, o.status)}</td></tr>`).join('')
          || '<tr><td colspan="6"><div class="empty">尚無採購紀錄</div></td></tr>'}</tbody></table>
      ${(h.vendor_prices || []).length ? `<div class="sec-hd" style="margin-top:8px">各廠商價格（廠商價格表）</div>
        <table class="data"><thead><tr><th>廠商</th><th>未稅單價</th><th>單位</th><th>來源</th><th>日期</th></tr></thead>
        <tbody>${h.vendor_prices.map(v => `<tr><td>${esc(v.vendor_name)}</td><td>${money(v.unit_price)}</td><td>${esc(v.unit || '')}</td>
          <td>${esc(SRC[v.source] || v.source)}</td><td>${esc(v.price_date || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${(h.quotes || []).length ? `<div class="sec-hd" style="margin-top:8px">比價紀錄</div>
        <table class="data"><thead><tr><th>日期</th><th>採購單</th><th>廠商</th><th>報價單價</th><th>結果</th></tr></thead>
        <tbody>${h.quotes.map(q => `<tr><td>${esc((q.created_at || '').slice(0, 10))}</td><td>${esc(q.po_no)}</td><td>${esc(q.vendor_name || '')}</td>
          <td>${money(q.unit_price)}</td><td>${q.is_selected ? '<span class="badge green">得標</span>' : ''}</td></tr>`).join('')}</tbody></table>` : ''}
      <p style="margin-top:8px"><a href="#/supply-movements">查看備品進出明細表</a></p>`);
  }

  /* ================= 品項管理 ================= */
  async function viewProcItems() {
    const editable = can('purchasing_approve');
    const vendors = await api('/procurement/vendors');
    main().innerHTML = `
      <div class="page-title">品項管理</div>
      <div class="card no-print"><div class="form-grid">
        <div class="field"><label>關鍵字</label><input id="it-q" placeholder="品項編號／名稱"></div>
        <div class="field"><label>供應廠商</label><select id="it-vendor"><option value="">全部廠商</option>${vendors.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
        <div class="field"><label>&nbsp;</label><div class="row" style="gap:8px">${editable ? '<button class="btn" id="it-new">新增品項</button>' : ''}
          <a class="btn small secondary" href="#/supply-items">備品名稱設定</a></div></div>
      </div></div>
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>品項編號</th><th>品項名稱</th><th>倉庫別</th><th>單位</th><th>安全庫存</th><th>參考單價（未稅）</th><th>供應廠商</th><th class="no-print"></th></tr></thead>
        <tbody id="it-body"></tbody></table></div>
        <small style="color:var(--muted)">品項即系統的「備品」，在這裡另外維護倉庫別與供應廠商（預設廠商會在請購時自動帶入）。</small></div>`;
    let rows = [];
    const load = async () => {
      const p = new URLSearchParams();
      if ($('#it-q').value.trim()) p.set('q', $('#it-q').value.trim());
      if ($('#it-vendor').value) p.set('vendor_id', $('#it-vendor').value);
      rows = (await api('/procurement/items?' + p)).rows;
      $('#it-body').innerHTML = rows.map(r => `<tr>
        <td data-label="品項編號">${esc(r.code || '—')}</td><td data-label="品項名稱">${esc(r.name)}</td>
        <td data-label="倉庫別">${esc(r.warehouse || '—')}</td><td data-label="單位">${esc(r.unit)}</td>
        <td data-label="安全庫存">${r.safety_stock}</td><td data-label="參考單價">${r.price ? money(r.price) : '—'}</td>
        <td data-label="供應廠商">${r.vendors.map(v => `<span class="badge ${v.is_default ? 'teal' : 'gray'}">${esc(v.name)}${v.is_default ? '（預設）' : ''}</span>`).join(' ') || '<span style="color:var(--muted)">未設定</span>'}
          ${r.po_count ? `<br><small style="color:var(--muted)">採購 ${r.po_count} 次</small>` : ''}</td>
        <td data-label="操作" class="no-print">${editable ? `<button class="btn small secondary" data-edit="${r.id}">編輯</button>` : ''}
          <button class="btn small secondary" data-hist="${r.id}">歷史</button></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">查無品項</div></td></tr>';
      main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openItemForm(rows.find(r => String(r.id) === b.dataset.edit), vendors, load));
      main().querySelectorAll('[data-hist]').forEach(b => b.onclick = () => showItemHistory(b.dataset.hist));
    };
    const nb = main().querySelector('#it-new');
    if (nb) nb.onclick = () => openItemForm(null, vendors, load);
    $('#it-vendor').onchange = load;
    $('#it-q').oninput = () => { clearTimeout(load._t); load._t = setTimeout(load, 300); };
    load();
  }

  function openItemForm(it, vendors, done) {
    const linked = new Map(((it && it.vendors) || []).map(v => [v.id, v.is_default]));
    openWide(it ? `編輯品項 — ${it.name}` : '新增品項', `
      <div class="form-grid">
        <div class="field"><label>品項編號</label><input id="itf-code" value="${esc(it ? it.code || '' : '')}" ${it ? 'disabled' : ''} placeholder="例：P001"></div>
        <div class="field"><label>品項名稱 <b class="req">*</b></label><input id="itf-name" value="${esc(it ? it.name : '')}"></div>
        <div class="field"><label>單位 <b class="req">*</b></label><input id="itf-unit" value="${esc(it ? it.unit : '')}" placeholder="包、箱、個"></div>
        <div class="field"><label>安全庫存</label><input type="number" min="0" id="itf-safe" value="${it ? it.safety_stock : 5}"></div>
        <div class="field"><label>參考單價（未稅）</label><input type="number" min="0" id="itf-price" value="${it ? it.price : 0}"></div>
        <div class="field"><label>倉庫別</label><input id="itf-wh" value="${esc(it ? it.warehouse || '' : '')}" placeholder="例：A倉、護理站、冷藏庫"></div>
        ${it ? '' : '<div class="field"><label>初始庫存數量</label><input type="number" min="0" id="itf-init" value="0"></div>'}
      </div>
      <div class="sec-hd" style="margin-top:10px">供應廠商 <small style="font-weight:400;color:var(--muted)">可勾選多家，指定一家為預設（請購時自動帶入）</small></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>供應</th><th>預設</th><th>廠商</th><th>付款條件</th></tr></thead>
        <tbody>${vendors.map(v => `<tr><td><input type="checkbox" data-v="${v.id}" ${linked.has(v.id) ? 'checked' : ''}></td>
          <td><input type="radio" name="itf-def" value="${v.id}" ${linked.get(v.id) ? 'checked' : ''}></td>
          <td>${esc(v.name)}</td><td>${esc(v.payment_terms || '—')}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">尚無廠商，請先到廠商管理新增</div></td></tr>'}</tbody></table></div>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn" id="itf-save">儲存</button><span class="error-msg" id="itf-err"></span></div>`, body => {
      body.querySelectorAll('input[name="itf-def"]').forEach(r => r.onchange = () => { body.querySelector(`[data-v="${r.value}"]`).checked = true; });
      body.querySelector('#itf-save').onclick = async () => {
        const def = (body.querySelector('input[name="itf-def"]:checked') || {}).value;
        const vlist = [...body.querySelectorAll('[data-v]:checked')].map(c => ({ vendor_id: Number(c.dataset.v), is_default: c.dataset.v === def }));
        const payload = { code: val(body, '#itf-code'), name: val(body, '#itf-name'), unit: val(body, '#itf-unit'),
          safety_stock: val(body, '#itf-safe'), price: val(body, '#itf-price'), warehouse: val(body, '#itf-wh'),
          initial_stock: val(body, '#itf-init'), vendors: vlist };
        try {
          if (it) await api('/procurement/items/' + it.id, { method: 'PUT', body: payload });
          else await api('/procurement/items', { method: 'POST', body: payload });
          closeModal(); done && done();
        } catch (e) { body.querySelector('#itf-err').textContent = e.message; }
      };
    });
  }

  /* ================= 廠商管理 ================= */
  async function viewProcVendors() {
    const editable = can('purchasing_approve');
    main().innerHTML = `
      <div class="page-title">廠商管理</div>
      <div class="card no-print"><div class="form-grid">
        <div class="field"><label>關鍵字</label><input id="vd-q" placeholder="廠商名稱／編號／統編／聯絡人／供貨品名"></div>
        <div class="field"><label>&nbsp;</label><label class="bna-chk"><input type="checkbox" id="vd-all"> 含已停用</label></div>
        <div class="field"><label>&nbsp;</label>${editable ? '<button class="btn" id="vd-new">新增廠商</button>' : ''}</div>
      </div></div>
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>廠商編號</th><th>廠商名稱</th><th>統編</th><th>聯絡人</th><th>電話</th><th>付款條件</th><th>待付款</th><th class="no-print"></th></tr></thead>
        <tbody id="vd-body"></tbody></table></div>
        <small style="color:var(--muted)">請款單的匯款帳號、付款到期日（依付款條件天數）都取自這裡。</small></div>`;
    let rows = [];
    const load = async () => {
      const p = new URLSearchParams();
      if ($('#vd-q').value.trim()) p.set('q', $('#vd-q').value.trim());
      if ($('#vd-all').checked) p.set('active', 'all');
      rows = await api('/procurement/vendors?' + p);
      $('#vd-body').innerHTML = rows.map(v => `<tr style="${v.active ? '' : 'opacity:.55'}">
        <td data-label="廠商編號">${esc(v.code)}</td>
        <td data-label="廠商名稱"><strong>${esc(v.name)}</strong>${v.active ? '' : ' <span class="badge gray">已停用</span>'}${v.address ? `<br><small style="color:var(--muted)">${esc(v.address)}</small>` : ''}</td>
        <td data-label="統編">${esc(v.tax_id || '—')}</td>
        <td data-label="聯絡人">${esc(v.contact || '—')}${v.email ? `<br><small>${esc(v.email)}</small>` : ''}</td>
        <td data-label="電話">${esc(v.phone || '—')}</td>
        <td data-label="付款條件">${esc(v.payment_terms || '—')}${v.item_count ? `<br><small style="color:var(--muted)">供貨 ${v.item_count} 項</small>` : ''}</td>
        <td data-label="待付款">${v.unpaid_amount ? `<strong style="color:var(--danger)">${money(v.unpaid_amount)}</strong>` : '—'}</td>
        <td data-label="操作" class="no-print">
          <button class="btn small secondary" data-detail="${v.id}">詳情</button>
          ${editable ? `<button class="btn small secondary" data-edit="${v.id}">編輯</button>
            ${v.active ? `<button class="btn small danger" data-del="${v.id}">刪除</button>` : `<button class="btn small" data-on="${v.id}">啟用</button>`}` : ''}
        </td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">查無廠商</div></td></tr>';
      main().querySelectorAll('[data-detail]').forEach(b => b.onclick = () => showVendor(b.dataset.detail));
      main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openVendorForm(rows.find(v => String(v.id) === b.dataset.edit), load));
      main().querySelectorAll('[data-on]').forEach(b => b.onclick = async () => { await api('/procurement/vendors/' + b.dataset.on, { method: 'PUT', body: { active: 1 } }); load(); });
      main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm('刪除這家廠商？（已有採購或請款紀錄的廠商會改為停用，資料保留）')) return;
        try { const r = await api('/procurement/vendors/' + b.dataset.del, { method: 'DELETE' }); if (r.deactivated) alert('此廠商已有交易紀錄，已改為停用。'); load(); }
        catch (e) { alert(e.message); }
      });
    };
    const nb = main().querySelector('#vd-new');
    if (nb) nb.onclick = () => openVendorForm(null, load);
    $('#vd-all').onchange = load;
    $('#vd-q').oninput = () => { clearTimeout(load._t); load._t = setTimeout(load, 300); };
    load();
  }

  async function openVendorForm(v, done) {
    const [s, { rows: items }, detail] = await Promise.all([procSettings(), api('/procurement/items'),
      v ? api('/procurement/vendors/' + v.id) : Promise.resolve(null)]);
    const priceList = detail ? detail.price_list : [];
    const unitOf = id => (items.find(i => String(i.id) === String(id)) || {}).unit || '';
    const priceRow = (r = {}) => `<tr data-pl data-source="${esc(r.source || 'manual')}" data-date="${esc(r.price_date || '')}">
      <td data-label="品項"><select data-p="supply_id" style="min-width:200px"><option value="">＋ 尚未建檔的品項（輸入品名）</option>${
        items.map(i => `<option value="${i.id}" ${String(r.supply_id) === String(i.id) ? 'selected' : ''}>${esc(i.code ? i.code + ' ' : '')}${esc(i.name)}</option>`).join('')}</select>
        <input data-p="item_name" placeholder="品名" value="${esc(r.supply_id ? '' : r.item_name || '')}" style="margin-top:4px;display:${r.supply_id ? 'none' : 'block'}"></td>
      <td data-label="單位"><input data-p="unit" value="${esc(r.unit || unitOf(r.supply_id))}" style="max-width:70px"></td>
      <td data-label="未稅單價"><input type="number" min="0" step="0.01" data-p="unit_price" value="${r.unit_price !== undefined ? r.unit_price : ''}" style="max-width:100px"></td>
      <td data-label="備註"><input data-p="note" value="${esc(r.note || '')}" placeholder="包裝、最低訂量等"></td>
      <td data-label="來源"><small>${esc(SRC[r.source] || '手動鍵入')}${r.price_date ? `<br>${esc(r.price_date)}` : ''}</small></td>
      <td><button class="btn small danger" data-pdel>刪</button></td></tr>`;
    const terms = s.payment_terms;
    const custom = v && v.payment_terms && !terms.includes(v.payment_terms);
    const f = (id, label, value, extra = '') => `<div class="field"><label>${label}</label><input id="vf-${id}" value="${esc(value || '')}" ${extra}></div>`;
    openWide(v ? `編輯廠商 — ${v.name}` : '新增廠商', `
      <div class="form-grid">
        ${f('code', '廠商編號<small>（留空自動編號）</small>', v ? v.code : '', v ? 'disabled' : 'placeholder="S001"')}
        ${f('name', '廠商名稱 <b class="req">*</b>', v && v.name, 'placeholder="公司全名"')}
        ${f('tax_id', '統一編號', v && v.tax_id, 'maxlength="8" placeholder="8 碼"')}
        <div class="field"><label>付款條件</label><select id="vf-terms"><option value="">-- 請選擇 --</option>
          ${terms.map(t => `<option ${v && v.payment_terms === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          <option value="__custom" ${custom ? 'selected' : ''}>自訂</option></select>
          <input id="vf-terms-custom" style="margin-top:4px;display:${custom ? 'block' : 'none'}" placeholder="例：月結90天" value="${esc(custom ? v.payment_terms : '')}"></div>
        <div class="field full"><label>公司地址</label><input id="vf-address" value="${esc(v ? v.address : '')}"></div>
        ${f('contact', '聯絡人', v && v.contact)}${f('phone', '電話', v && v.phone)}
        <div class="field full"><label>Email</label><input id="vf-email" value="${esc(v ? v.email : '')}"></div>
        <div class="full sec-hd">銀行匯款資料</div>
        ${f('bank_name', '銀行名稱', v && v.bank_name, 'placeholder="例：台灣銀行"')}${f('bank_branch', '分行名稱', v && v.bank_branch)}
        ${f('bank_code', '銀行代碼', v && v.bank_code, 'maxlength="7" placeholder="3 碼"')}${f('bank_account', '帳號', v && v.bank_account)}
        <div class="field full"><label>戶名</label><input id="vf-bank_holder" value="${esc(v ? v.bank_holder : '')}"></div>
        <div class="field full"><label>備註</label><input id="vf-note" value="${esc(v ? v.note : '')}"></div>
      </div>
      <div class="sec-hd" style="margin-top:10px">供貨品項及未稅價格 <small style="font-weight:400;color:var(--muted)">
        （這家廠商可供應的品項與報價，不論是否採購過都可登錄；比價報價與實際採購價會自動更新到這裡）</small></div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>品項</th><th>單位</th><th>未稅單價</th><th>備註</th><th>來源</th><th></th></tr></thead>
        <tbody id="vf-prices">${priceList.map(priceRow).join('')}</tbody></table></div>
      <button class="btn small secondary" id="vf-padd" style="margin-top:6px">新增供貨品項</button>
      <div class="row" style="gap:8px;margin-top:10px"><button class="btn" id="vf-save">儲存</button><span class="error-msg" id="vf-err"></span></div>`, body => {
      const wirePrice = tr => {
        const sel = tr.querySelector('[data-p="supply_id"]');
        sel.onchange = () => {
          tr.querySelector('[data-p="item_name"]').style.display = sel.value ? 'none' : 'block';
          if (sel.value) tr.querySelector('[data-p="unit"]').value = unitOf(sel.value);
        };
        tr.querySelector('[data-pdel]').onclick = () => tr.remove();
        // 改了價格就視為手動更新
        tr.querySelector('[data-p="unit_price"]').addEventListener('input', () => { tr.dataset.source = 'manual'; tr.dataset.date = ''; });
      };
      body.querySelectorAll('[data-pl]').forEach(wirePrice);
      body.querySelector('#vf-padd').onclick = () => {
        body.querySelector('#vf-prices').insertAdjacentHTML('beforeend', priceRow());
        wirePrice(body.querySelector('#vf-prices').lastElementChild);
      };
      body.querySelector('#vf-terms').onchange = () => { body.querySelector('#vf-terms-custom').style.display = val(body, '#vf-terms') === '__custom' ? 'block' : 'none'; };
      body.querySelector('#vf-save').onclick = async () => {
        const g = k => val(body, '#vf-' + k);
        const termSel = g('terms');
        const payload = { code: g('code'), name: g('name'), tax_id: g('tax_id'), payment_terms: termSel === '__custom' ? g('terms-custom') : termSel,
          address: g('address'), contact: g('contact'), phone: g('phone'), email: g('email'), bank_name: g('bank_name'),
          bank_branch: g('bank_branch'), bank_code: g('bank_code'), bank_account: g('bank_account'), bank_holder: g('bank_holder'), note: g('note'),
          items: [...body.querySelectorAll('[data-pl]')].map(tr => ({
            supply_id: Number(val(tr, '[data-p="supply_id"]')) || null, item_name: val(tr, '[data-p="item_name"]'),
            unit: val(tr, '[data-p="unit"]'), unit_price: val(tr, '[data-p="unit_price"]'), note: val(tr, '[data-p="note"]'),
            source: tr.dataset.source, price_date: tr.dataset.date })).filter(x => x.supply_id || x.item_name) };
        const noPrice = payload.items.find(x => x.unit_price === '');
        if (noPrice) { body.querySelector('#vf-err').textContent = '供貨品項請填寫未稅單價'; return; }
        if (payload.tax_id && !/^\d{8}$/.test(payload.tax_id)) { body.querySelector('#vf-err').textContent = '統一編號需為 8 碼數字'; return; }
        try {
          if (v) await api('/procurement/vendors/' + v.id, { method: 'PUT', body: payload });
          else await api('/procurement/vendors', { method: 'POST', body: payload });
          closeModal(); done && done();
        } catch (e) { body.querySelector('#vf-err').textContent = e.message; }
      };
    });
  }

  async function showVendor(id) {
    const d = await api('/procurement/vendors/' + id);
    const v = d.vendor;
    openWide(`廠商詳情 — ${v.name}`, `
      <div class="form-grid" style="margin-bottom:8px">
        <div class="card" style="margin:0;background:var(--bg);line-height:1.9;font-size:.9rem">
          <strong>基本資料</strong><br>編號：${esc(v.code)}　統編：${esc(v.tax_id || '—')}<br>地址：${esc(v.address || '—')}<br>
          聯絡人：${esc(v.contact || '—')}　電話：${esc(v.phone || '—')}<br>Email：${esc(v.email || '—')}<br>付款條件：<strong>${esc(v.payment_terms || '—')}</strong></div>
        <div class="card" style="margin:0;background:var(--bg);line-height:1.9;font-size:.9rem">
          <strong>銀行匯款資料</strong><br>${v.bank_account ? `${esc(v.bank_name)} ${esc(v.bank_branch)}（${esc(v.bank_code)}）<br>
            帳號：<strong style="color:var(--primary-dark)">${esc(v.bank_account)}</strong><br>戶名：${esc(v.bank_holder)}` : '<span style="color:var(--danger)">尚未填寫</span>'}
          <br><strong>應付帳款</strong><br>待付款 ${d.payables.unpaid_count || 0} 張：<strong style="color:var(--danger)">${money(d.payables.unpaid)}</strong>　已付款累計：${money(d.payables.paid)}</div>
      </div>
      <div class="sec-hd">供貨品項及未稅價格（${(d.price_list || []).length} 項）</div>
      <table class="data"><thead><tr><th>品項</th><th>單位</th><th>未稅單價</th><th>來源</th><th>日期</th><th>備註</th></tr></thead>
        <tbody>${(d.price_list || []).map(i => `<tr><td>${esc(i.supply_code ? i.supply_code + ' ' : '')}${esc(i.item_name)}${i.supply_id ? '' : ' <span class="badge gray">未建檔</span>'}</td>
          <td>${esc(i.unit || '')}</td><td>${money(i.unit_price)}</td><td>${esc(SRC[i.source] || i.source)}</td>
          <td>${esc(i.price_date || '')}</td><td>${esc(i.note || '')}</td></tr>`).join('')
          || '<tr><td colspan="6"><div class="empty">尚未登錄供貨品項，可在「編輯」中新增</div></td></tr>'}</tbody></table>
      <div class="sec-hd" style="margin-top:8px">設為供應廠商的品項（品項管理）</div>
      <div style="margin-bottom:8px">${d.items.map(i => `<span class="badge ${i.is_default ? 'teal' : 'gray'}">${esc(i.name)}${i.is_default ? '（預設）' : ''}</span>`).join(' ') || '<span style="color:var(--muted)">尚未有品項設定此廠商</span>'}</div>
      <div class="sec-hd">歷史進貨統計</div>
      <table class="data"><thead><tr><th>品項</th><th>進貨次數</th><th>累計到貨量</th><th>未稅累計金額</th></tr></thead>
        <tbody>${d.purchased.map(p => `<tr><td>${esc(p.name)}</td><td>${p.times} 次</td><td>${p.total_qty} ${esc(p.unit)}</td><td>${money(p.total_amount)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">尚無進貨紀錄</div></td></tr>'}</tbody></table>
      <div class="sec-hd" style="margin-top:8px">最近採購單</div>
      <table class="data"><thead><tr><th>採購單號</th><th>日期</th><th>品項數</th><th>狀態</th></tr></thead>
        <tbody>${d.orders.map(o => `<tr><td>${esc(o.no)}</td><td>${esc(o.po_date)}</td><td>${o.item_count}</td><td>${badge(PO_ST, o.status)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">尚無採購單</div></td></tr>'}</tbody></table>
      <div class="sec-hd" style="margin-top:8px">報價紀錄（比價，最新 30 筆）</div>
      <table class="data"><thead><tr><th>日期</th><th>採購單</th><th>品項</th><th>報價單價</th><th>結果</th><th>備註</th></tr></thead>
        <tbody>${(d.quotes || []).map(q => `<tr><td>${esc((q.created_at || '').slice(0, 10))}</td><td>${esc(q.po_no)}</td><td>${esc(q.item_name)}</td>
          <td>${money(q.unit_price)} / ${esc(q.unit)}</td><td>${q.is_selected ? '<span class="badge green">得標</span>' : '<span class="badge gray">未選</span>'}</td><td>${esc(q.note || '')}</td></tr>`).join('')
          || '<tr><td colspan="6"><div class="empty">尚無報價紀錄</div></td></tr>'}</tbody></table>
      <div class="sec-hd" style="margin-top:8px">請款紀錄（最新 10 筆）</div>
      <table class="data"><thead><tr><th>請款單號</th><th>發票</th><th>含稅金額</th><th>到期日</th><th>狀態</th></tr></thead>
        <tbody>${d.payments.map(p => `<tr><td>${esc(p.no)}</td><td>${esc(p.invoice_no || '—')}</td><td>${money(p.total_amount)}</td><td>${esc(p.pay_due_date || '—')}</td><td>${badge(PAY_ST, p.status)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">尚無請款單</div></td></tr>'}</tbody></table>`);
  }

  /* ================= 採購設定 ================= */
  async function viewProcSettings() {
    const [s, list] = await Promise.all([api('/settings'), api('/procurement/companies?all=1')]);
    const isAdmin = currentUser.role === 'admin';
    const dis = isAdmin ? '' : 'disabled';
    main().innerHTML = `
      <div class="page-title">採購設定</div>
      <div class="card">
        <div class="row between"><h3>採購公司（單據抬頭）</h3>${isAdmin ? '<button class="btn small" id="ps-co-new">新增公司</button>' : ''}</div>
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>公司名稱（單據抬頭）</th><th>請購單位（請購採購單）</th><th>部門別（請款支付憑單）</th><th>統一編號</th><th>狀態</th><th class="no-print"></th></tr></thead>
          <tbody>${list.map(c => `<tr style="${c.active ? '' : 'opacity:.55'}">
            <td data-label="公司名稱"><strong>${esc(c.name)}</strong>${c.is_default ? ' <span class="badge teal">預設</span>' : ''}${c.address ? `<br><small style="color:var(--muted)">${esc(c.address)}</small>` : ''}</td>
            <td data-label="請購單位">${esc(c.request_dept || '—')}</td>
            <td data-label="部門別">${esc(c.pay_dept || '—')}</td>
            <td data-label="統一編號">${esc(c.tax_id || '—')}</td>
            <td data-label="狀態">${c.active ? '<span class="badge green">使用中</span>' : '<span class="badge gray">停用</span>'}</td>
            <td data-label="操作" class="no-print">${isAdmin ? `<button class="btn small secondary" data-co="${c.id}">編輯</button>
              ${!c.is_default && c.active ? `<button class="btn small secondary" data-co-def="${c.id}">設為預設</button>` : ''}` : ''}</td></tr>`).join('')}</tbody></table></div>
        <small style="color:var(--muted)">請購單建立時選擇採購公司，採購單、請款單沿用；單據抬頭與部門別依公司列印。新增請購單時預設帶入「預設」公司。同一廠商每月一張請款單的規定依公司分開計算。</small>
      </div>
      <div class="card">
        <h3>共用參數</h3>
        <div class="form-grid">
          <div class="field"><label>請款單預設稅率（%）</label><input type="number" min="0" max="100" step="0.1" id="ps-tax" value="${esc(s.proc_tax_rate || '5')}" ${dis}></div>
          <div class="field full"><label>廠商付款條件選項<small>（逗號分隔；含數字者視為天數，用來算付款到期日）</small></label>
            <input id="ps-terms" value="${esc(s.proc_payment_terms || '')}" ${dis}></div>
        </div>
        <div class="row" style="gap:8px;margin-top:8px">${isAdmin ? '<button class="btn" id="ps-save">儲存參數</button>' : '<small style="color:var(--muted)">僅管理員可修改</small>'}<span class="error-msg" id="ps-err"></span></div>
      </div>`;
    const reload = () => { SETTINGS_CACHE = null; viewProcSettings(); };
    const openCo = c => openModal(c ? `編輯公司 — ${c.name}` : '新增採購公司', `
      <div class="form-grid">
        <div class="field full"><label>公司名稱（單據抬頭） <b class="req">*</b></label><input id="co-name" value="${esc(c ? c.name : '')}" placeholder="例：嘉禾產後護理之家"></div>
        <div class="field"><label>請購單位（部門）</label><input id="co-req" value="${esc(c ? c.request_dept : '')}" placeholder="例：健康生活事業處"></div>
        <div class="field"><label>部門別（支付憑單）</label><input id="co-pay" value="${esc(c ? c.pay_dept : '')}" placeholder="例：月子中心"></div>
        <div class="field"><label>統一編號</label><input id="co-tax" maxlength="8" value="${esc(c ? c.tax_id : '')}"></div>
        <div class="field"><label>電話</label><input id="co-phone" value="${esc(c ? c.phone : '')}"></div>
        <div class="field full"><label>地址</label><input id="co-addr" value="${esc(c ? c.address : '')}"></div>
        <div class="field"><label>排序</label><input type="number" id="co-sort" value="${c ? c.sort_order : 0}"></div>
        <div class="field"><label>狀態</label><select id="co-active"><option value="1">使用中</option><option value="0" ${c && !c.active ? 'selected' : ''}>停用</option></select></div>
        <div class="field full"><label class="bna-chk"><input type="checkbox" id="co-def" ${c && c.is_default ? 'checked disabled' : ''}> 設為預設公司</label></div>
      </div>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn" id="co-save">儲存</button><span class="error-msg" id="co-err"></span></div>`, body => {
      body.querySelector('#co-save').onclick = async () => {
        const payload = { name: val(body, '#co-name'), request_dept: val(body, '#co-req'), pay_dept: val(body, '#co-pay'),
          tax_id: val(body, '#co-tax'), phone: val(body, '#co-phone'), address: val(body, '#co-addr'),
          sort_order: Number(val(body, '#co-sort')) || 0, active: val(body, '#co-active') === '1',
          is_default: body.querySelector('#co-def').checked && !body.querySelector('#co-def').disabled };
        try {
          if (c) await api('/procurement/companies/' + c.id, { method: 'PUT', body: payload });
          else await api('/procurement/companies', { method: 'POST', body: payload });
          closeModal(); reload();
        } catch (e) { body.querySelector('#co-err').textContent = e.message; }
      };
    });
    const nb = main().querySelector('#ps-co-new');
    if (nb) nb.onclick = () => openCo(null);
    main().querySelectorAll('[data-co]').forEach(b => b.onclick = () => openCo(list.find(c => String(c.id) === b.dataset.co)));
    main().querySelectorAll('[data-co-def]').forEach(b => b.onclick = async () => {
      try { await api('/procurement/companies/' + b.dataset.coDef, { method: 'PUT', body: { is_default: true } }); reload(); }
      catch (e) { alert(e.message); }
    });
    const b = main().querySelector('#ps-save');
    if (b) b.onclick = async () => {
      const tax = Number($('#ps-tax').value);
      if (!(tax >= 0 && tax <= 100)) { $('#ps-err').textContent = '稅率需介於 0 到 100'; return; }
      try {
        await api('/settings', { method: 'PUT', body: { proc_tax_rate: String(tax),
          proc_payment_terms: $('#ps-terms').value.split(/[,，]/).map(x => x.trim()).filter(Boolean).join(',') } });
        SETTINGS_CACHE = null;
        $('#ps-err').textContent = '';
        alert('已儲存');
      } catch (e) { $('#ps-err').textContent = e.message; }
    };
  }

  /* ---------- 註冊路由與權限 ---------- */
  const ALL = ['purchasing', 'purchasing_approve', 'payables'];
  const pages = {
    '#/proc-dashboard': [viewProcDashboard, ALL],
    '#/proc-requests': [viewProcRequests, ['purchasing', 'purchasing_approve']],
    '#/proc-orders': [viewProcOrders, ['purchasing', 'purchasing_approve']],
    '#/proc-receiving': [viewProcReceiving, ['purchasing', 'purchasing_approve']],
    '#/proc-payments': [viewProcPayments, ALL],
    '#/proc-shipments': [viewProcShipments, ['purchasing', 'purchasing_approve']],
    '#/proc-picks': [viewProcPicks, ['purchasing', 'purchasing_approve']],
    '#/proc-stock': [viewProcStock, ALL],
    '#/proc-items': [viewProcItems, ALL],
    '#/proc-vendors': [viewProcVendors, ALL],
    '#/proc-settings': [viewProcSettings, ALL]
  };
  for (const [hash, [fn, perm]] of Object.entries(pages)) {
    routes[hash] = fn;
    ROUTE_PERM[hash] = perm;
  }
})();
