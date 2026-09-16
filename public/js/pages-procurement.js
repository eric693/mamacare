/* ---------- 採購作業：請購 → 採購 → 驗貨入庫 → 請款，出貨／領料，庫存總覽，品項，廠商 ----------
   以 defer 載入：app.js 的 routes／ROUTE_PERM 已就緒，且在 /api/me 回來前就完成註冊。
   品項與庫存就是「備品」（supplies），驗貨入庫、出貨都寫進同一份備品進出紀錄。 */
(function () {
  const PR_ST = { pending: ['待核准', 'yellow'], ordered: ['已建立採購單', 'teal'], cancelled: ['已取消', 'gray'] };
  const PO_ST = { pending: ['待入庫', 'yellow'], received: ['已入庫', 'green'], cancelled: ['已取消', 'gray'] };
  const PAY_ST = { unpaid: ['待付款', 'red'], paid: ['已付款', 'green'], cancelled: ['已取消', 'gray'] };
  const SHIP_ST = { pending: ['待出貨', 'yellow'], shipped: ['已出貨', 'green'], cancelled: ['已取消', 'gray'] };
  const PICK_ST = { pending: ['待領料', 'yellow'], picked: ['已領料', 'green'], cancelled: ['已取消', 'gray'] };
  const PAY_METHODS = ['銀行轉帳', '支票', '現金', '其他'];
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
    const dateField = opt.dateFields ? `<div class="field"><label>日期欄位</label><select data-f="date_field">${
      opt.dateFields.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>` : '';
    return `
      <div class="card no-print proc-filter">
        <div class="form-grid">
          ${dateField}
          <div class="field"><label>${esc(opt.dateLabel || '日期')}（起）</label><input type="date" data-f="from"></div>
          <div class="field"><label>${esc(opt.dateLabel || '日期')}（迄）</label><input type="date" data-f="to"></div>
          ${statuses}${vendors}
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

  // 另開視窗列印（A4）：單據沿用原本紙本排版，機構名稱取自系統設定
  function printDoc(title, inner) {
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>
        @page{size:A4 portrait;margin:12mm}
        body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#000;font-size:12px;margin:0 auto;max-width:190mm;padding:8mm 0}
        h1{text-align:center;font-size:18px;margin:0 0 2px;letter-spacing:2px}
        h2{text-align:center;font-size:16px;margin:0 0 8px;letter-spacing:6px}
        .sec{text-align:center;font-weight:700;background:#eee;border:1px solid #999;padding:3px;margin-bottom:6px}
        table{width:100%;border-collapse:collapse;margin-bottom:6px}
        td,th{border:1px solid #000;padding:5px 7px;vertical-align:top}
        th,.hd{font-weight:700;background:#f5f5f5;text-align:center}
        .r{text-align:right}.c{text-align:center}
        .sign td{height:48px}
        .foot{font-size:11px;color:#555}
        @media print{.noprint{display:none}}
      </style></head><body>${inner}
      <div class="noprint" style="margin-top:20px;text-align:center"><button onclick="window.print()" style="padding:10px 24px;font-size:15px">列印 / 另存 PDF</button></div>
      </body></html>`);
    w.document.close();
  }
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
        <div class="stat"><div class="num">${d.pending_po}</div><div class="label">待入庫採購單</div></div>
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
    main().innerHTML = `
      <div class="page-title">請購單</div>
      <div class="card no-print"><div class="row" style="gap:8px">
        ${can('purchasing') ? '<button class="btn" id="pr-new">新增請購單</button>' : ''}
        <span style="color:var(--muted);font-size:.85rem">流程：請購（待核准）→ 核准時為每個品項指定廠商 → 自動拆成採購單</span></div></div>
      ${filterBar({ dateLabel: '請購日期', statuses: PR_ST, placeholder: '單號／申請人／品名' })}
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
        <td data-label="請購單號">${esc(r.no)}${r.urgent ? ' <span class="badge red">急件</span>' : ''}</td>
        <td data-label="請購日期">${esc(r.req_date)}</td>
        <td data-label="申請人">${esc(r.requester)}</td>
        <td data-label="品項">${r.item_count} 項${r.purpose ? `<br><small style="color:var(--muted)">${esc(r.purpose)}</small>` : ''}</td>
        <td data-label="狀態">${badge(PR_ST, r.status)}</td>
        <td data-label="採購單"><small>${esc(r.po_nos || '—')}</small></td>
        <td data-label="操作" class="no-print">
          <button class="btn small secondary" data-view="${r.id}">查看／列印</button>
          ${r.status === 'pending' && can('purchasing') ? `<button class="btn small secondary" data-edit="${r.id}">修改</button>` : ''}
          ${r.status === 'pending' && can('purchasing_approve') ? `<button class="btn small" data-approve="${r.id}">核准→採購單</button>` : ''}
          ${r.status === 'pending' && can('purchasing') ? `<button class="btn small danger" data-cancel="${r.id}">取消</button>` : ''}
        </td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">查無請購單</div></td></tr>';
      main().querySelectorAll('[data-view]').forEach(b => b.onclick = async () => printRequest(await api('/procurement/requests/' + b.dataset.view)));
      main().querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => openPrForm(await api('/procurement/requests/' + b.dataset.edit), null, reload));
      main().querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => openApprove(await api('/procurement/requests/' + b.dataset.approve), reload));
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
    const [{ rows: items }, vendors] = await Promise.all([api('/procurement/items'), api('/procurement/vendors')]);
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
        const payload = { requester: val(body, '#prf-req'), req_date: val(body, '#prf-date'), urgent: val(body, '#prf-urgent') === '1',
          budget: val(body, '#prf-budget'), purpose: val(body, '#prf-purpose'), items: lineData };
        try {
          if (pr) await api('/procurement/requests/' + pr.id, { method: 'PUT', body: payload });
          else { const r = await api('/procurement/requests', { method: 'POST', body: payload }); alert(`請購單 ${r.no} 已建立，等待主管核准`); }
          closeModal(); done && done();
        } catch (e) { err.textContent = e.message; }
      };
    });
  }

  async function openApprove(pr, done) {
    const [{ rows: items }, vendors] = await Promise.all([api('/procurement/items'), api('/procurement/vendors')]);
    openWide(`核准請購單 ${pr.no} → 分廠商建立採購單`, `
      <div style="background:var(--primary-light);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:.9rem">
        申請人：${esc(pr.requester)}　共 ${pr.items.length} 品項${pr.purpose ? `　用途：${esc(pr.purpose)}` : ''}</div>
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
      <div class="row" style="gap:8px"><button class="btn" id="apv-go">確認核准，建立採購單</button><span class="error-msg" id="apv-err"></span></div>`, body => {
      body.querySelector('#apv-go').onclick = async () => {
        const list = [...body.querySelectorAll('[data-item]')].map(tr => ({
          item_id: Number(tr.dataset.item), vendor_id: Number(val(tr, '[data-k="vendor"]')) || 0, eta: val(tr, '[data-k="eta"]') }));
        const missing = list.filter(l => !l.vendor_id).length;
        if (missing) { body.querySelector('#apv-err').textContent = `尚有 ${missing} 個品項未指定廠商`; return; }
        try {
          const r = await api(`/procurement/requests/${pr.id}/approve`, { method: 'POST', body: { items: list } });
          alert(r.orders.length > 1 ? `已拆成 ${r.orders.length} 張採購單：${r.orders.map(o => o.no).join('、')}` : `採購單 ${r.orders[0].no} 已建立`);
          closeModal(); done && done();
        } catch (e) { body.querySelector('#apv-err').textContent = e.message; }
      };
    });
  }

  async function printRequest(r) {
    const s = await procSettings();
    const blanks = Math.max(0, 5 - r.items.length);
    printDoc(`請購單 ${r.no}`, `
      <h1>${esc(s.center_name)}</h1><h2>請購採購單</h2><div class="sec">【請購作業】</div>
      <table>
        <tr><td class="hd">件別</td><td>${r.urgent ? '■急件　□一般件' : '□急件　■一般件'}</td><td class="hd">請購日期</td><td>${esc((r.req_date || '').replace(/-/g, '/'))}</td>
          <td class="hd">請購單位(部門)</td><td>${esc(s.request_dept)}</td><td class="hd">請購單編號</td><td>${esc(r.no)}</td></tr>
        <tr><td class="hd" rowspan="2">用途說明</td><td colspan="4" rowspan="2" style="height:40px">${esc(r.purpose || '')}</td>
          <td class="hd">預算金額</td><td colspan="2">${r.budget ? money(r.budget) : ''}</td></tr>
        <tr><td class="hd">申請人</td><td colspan="2">${esc(r.requester)}</td></tr>
        <tr><th colspan="2">項次</th><th colspan="3">品名及規格</th><th>請購數量</th><th>需求日期</th><th>庫存量</th></tr>
        ${r.items.map((it, i) => `<tr><td colspan="2" class="c">${i + 1}</td><td colspan="3">${esc(it.item_name)}</td>
          <td class="c">${it.qty} ${esc(it.unit)}</td><td class="c">${esc(it.need_date || '')}</td><td class="c">${it.stock === null || it.stock === undefined ? '' : it.stock}</td></tr>`).join('')}
        ${'<tr><td colspan="2" style="height:22px"></td><td colspan="3"></td><td></td><td></td><td></td></tr>'.repeat(blanks)}
        <tr><td colspan="8">建議事項（品質要求或建議供應商）：${esc([...new Set(r.items.map(i => i.suggested_vendor_name).filter(Boolean))].join('、'))}</td></tr>
        <tr><th colspan="2" rowspan="2">核准</th><th rowspan="2">會簽單位</th><th colspan="5">請　購　單　位</th></tr>
        <tr><th>覆核</th><th>審核</th><th>單位主管</th><th colspan="2">經辦</th></tr>
        <tr class="sign"><td colspan="2">${r.approved_name ? esc(r.approved_name) : ''}</td><td></td><td></td><td></td><td></td><td colspan="2">${esc(r.requester)}</td></tr>
      </table>
      <div class="foot">請購流程：請購單位 → 核決主管 → 會辦單位 → 採購單位${r.orders && r.orders.length ? `　｜　已建立採購單：${esc(r.orders.map(o => o.no).join('、'))}` : ''}</div>`);
  }

  /* ================= 採購單 ================= */
  async function viewProcOrders() {
    const vendors = await api('/procurement/vendors?active=all');
    main().innerHTML = `
      <div class="page-title">採購單</div>
      ${filterBar({ dateLabel: '採購日期', statuses: PO_ST, vendors, placeholder: '採購單號／請購單號／品名' })}
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>採購單號</th><th>採購日期</th><th>來源請購單</th><th>廠商</th><th>預計到貨</th><th>未稅總額</th><th>狀態</th><th class="no-print"></th></tr></thead>
        <tbody id="po-body"></tbody></table></div>
        <small style="color:var(--muted)">採購單由請購單核准時自動產生；待入庫期間可修改單價與到貨日，驗貨入庫後鎖定。</small></div>`;
    let lastQs = '';
    const reload = () => load(lastQs, () => {});
    async function load(qs, setCount) {
      lastQs = qs;
      const rows = await api('/procurement/orders?' + qs);
      setCount(rows.length);
      $('#po-body').innerHTML = rows.map(o => `<tr>
        <td data-label="採購單號">${esc(o.no)}</td>
        <td data-label="採購日期">${esc(o.po_date)}</td>
        <td data-label="來源請購單">${esc(o.pr_no || '—')}</td>
        <td data-label="廠商">${esc(o.vendor_name || '')}</td>
        <td data-label="預計到貨">${esc(o.eta || '—')}${o.status === 'pending' && o.eta && o.eta < todayStr() ? ' <span class="badge red">逾期</span>' : ''}</td>
        <td data-label="未稅總額">${money(o.total)}<br><small>${o.item_count} 項</small></td>
        <td data-label="狀態">${badge(PO_ST, o.status)}</td>
        <td data-label="操作" class="no-print">
          <button class="btn small secondary" data-view="${o.id}">${o.status === 'pending' && can('purchasing_approve') ? '查看／改單價' : '查看'}</button>
          <button class="btn small secondary" data-print="${o.id}">列印</button>
          ${o.status === 'pending' && can('purchasing') ? `<button class="btn small" data-recv="${o.id}">驗貨入庫</button>` : ''}
          ${o.status === 'pending' && can('purchasing_approve') ? `<button class="btn small danger" data-cancel="${o.id}">取消</button>` : ''}
        </td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">查無採購單</div></td></tr>';
      main().querySelectorAll('[data-view]').forEach(b => b.onclick = async () => openPoForm(await api('/procurement/orders/' + b.dataset.view), reload));
      main().querySelectorAll('[data-print]').forEach(b => b.onclick = async () => printOrder(await api('/procurement/orders/' + b.dataset.print)));
      main().querySelectorAll('[data-recv]').forEach(b => b.onclick = async () => openReceiving(await api('/procurement/orders/' + b.dataset.recv), reload));
      main().querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
        const reason = prompt('取消採購單的原因（可留空）：', '');
        if (reason === null) return;
        try { await api(`/procurement/orders/${b.dataset.cancel}/cancel`, { method: 'POST', body: { reason } }); reload(); }
        catch (e) { alert(e.message); }
      });
    }
    wireFilter(main(), load);
  }

  function openPoForm(o, done) {
    const editable = o.status === 'pending' && can('purchasing_approve');
    const dis = editable ? '' : 'disabled';
    openWide(`採購單 ${o.no}`, `
      <div class="form-grid" style="margin-bottom:8px">
        <div class="field"><label>廠商</label><input value="${esc(o.vendor_name)}" disabled></div>
        <div class="field"><label>統一編號／付款條件</label><input value="${esc((o.vendor_tax_id || '—') + '／' + (o.vendor_terms || '—'))}" disabled></div>
        <div class="field"><label>來源請購單</label><input value="${esc(o.pr_no || '—')}" disabled></div>
        <div class="field"><label>預計到貨日</label><input type="date" id="pof-eta" value="${esc(o.eta || '')}" ${dis}></div>
        <div class="field full"><label>備註</label><input id="pof-note" value="${esc(o.note || '')}" ${dis}></div>
      </div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>品項</th><th>數量</th><th>未稅單價</th><th>未稅小計</th></tr></thead>
        <tbody>${o.items.map(it => `<tr data-item="${it.id}">
          <td data-label="品項">${esc(it.item_name)} ${it.is_new && !it.supply_id ? '<span class="badge teal">新品項</span>' : ''}
            ${it.is_new && !it.supply_id ? `<div class="row" style="gap:6px;margin-top:4px;flex-wrap:wrap">
              <input data-k="new_code" placeholder="品項編號" value="${esc(it.new_code || '')}" style="max-width:110px" ${dis}>
              <input data-k="new_warehouse" placeholder="倉庫別" value="${esc(it.new_warehouse || '')}" style="max-width:110px" ${dis}>
              <input type="number" min="0" data-k="new_safety" title="安全庫存" value="${it.new_safety}" style="max-width:80px" ${dis}></div>
              <small style="color:var(--muted)">驗貨入庫時以上述資料自動建檔（編號／倉庫別／安全庫存）</small>` : ''}</td>
          <td data-label="數量"><input type="number" min="1" data-k="qty" value="${it.qty}" style="max-width:80px" ${dis}> ${esc(it.unit)}</td>
          <td data-label="未稅單價"><input type="number" min="0" step="0.01" data-k="unit_price" value="${it.unit_price}" style="max-width:110px" ${dis}></td>
          <td data-label="未稅小計" data-sub>${money(it.qty * it.unit_price)}</td></tr>`).join('')}</tbody></table></div>
      <div style="text-align:right;font-weight:700;margin:8px 0">未稅總額：<span id="pof-total">${money(o.total)}</span></div>
      <div class="row" style="gap:8px">
        ${editable ? '<button class="btn" id="pof-save">儲存</button>' : ''}
        <button class="btn secondary" id="pof-print">列印</button>
        ${o.status === 'pending' && can('purchasing') ? '<button class="btn secondary" id="pof-recv">前往驗貨入庫</button>' : ''}
        <span class="error-msg" id="pof-err"></span></div>`, body => {
      const recalc = () => {
        let total = 0;
        body.querySelectorAll('[data-item]').forEach(tr => {
          const sub = (Number(val(tr, '[data-k="qty"]')) || 0) * (Number(val(tr, '[data-k="unit_price"]')) || 0);
          total += sub; tr.querySelector('[data-sub]').textContent = money(sub);
        });
        body.querySelector('#pof-total').textContent = money(total);
      };
      body.querySelectorAll('input[data-k="qty"], input[data-k="unit_price"]').forEach(el => el.oninput = recalc);
      body.querySelector('#pof-print').onclick = () => printOrder(o);
      const recv = body.querySelector('#pof-recv');
      if (recv) recv.onclick = async () => { closeModal(); openReceiving(await api('/procurement/orders/' + o.id), done); };
      const save = body.querySelector('#pof-save');
      if (save) save.onclick = async () => {
        const items = [...body.querySelectorAll('[data-item]')].map(tr => {
          const x = { id: Number(tr.dataset.item), qty: Number(val(tr, '[data-k="qty"]')), unit_price: Number(val(tr, '[data-k="unit_price"]')) };
          if (tr.querySelector('[data-k="new_code"]')) Object.assign(x, { new_code: val(tr, '[data-k="new_code"]'),
            new_warehouse: val(tr, '[data-k="new_warehouse"]'), new_safety: Number(val(tr, '[data-k="new_safety"]')) });
          return x;
        });
        try {
          await api('/procurement/orders/' + o.id, { method: 'PUT', body: { eta: val(body, '#pof-eta'), note: val(body, '#pof-note'), items } });
          closeModal(); done && done();
        } catch (e) { body.querySelector('#pof-err').textContent = e.message; }
      };
    });
  }

  async function printOrder(o) {
    const s = await procSettings();
    const rows = Math.max(o.items.length, 4);
    printDoc(`採購單 ${o.no}`, `
      <h1>${esc(s.center_name)}</h1><h2>請購採購單</h2><div class="sec">【採購作業】</div>
      <table>
        <tr><td class="hd">採購單編號</td><td>${esc(o.no)}</td><td class="hd">採購日期</td><td>${esc(o.po_date)}</td>
          <td class="hd">來源請購單</td><td colspan="2">${esc(o.pr_no || '')}</td><td class="hd">交期</td><td colspan="2">${esc(o.eta || '')}</td></tr>
        <tr><td class="hd" rowspan="${rows + 2}" style="vertical-align:middle">比價資料</td>
          <th>廠商</th><th colspan="2">品名及規格</th><th>數量</th><th>單價</th><th>金額(未稅)</th><th>付款條件</th><th>交期</th><th>決議</th></tr>
        ${o.items.map((it, i) => `<tr><td>${i === 0 ? esc(o.vendor_name) : ''}</td><td colspan="2">${esc(it.item_name)}</td>
          <td class="c">${it.qty} ${esc(it.unit)}</td><td class="r">${money(it.unit_price)}</td><td class="r">${money(it.qty * it.unit_price)}</td>
          <td>${i === 0 ? esc(o.vendor_terms || '') : ''}</td><td>${i === 0 ? esc(o.eta || '') : ''}</td><td></td></tr>`).join('')}
        ${'<tr><td style="height:22px"></td><td colspan="2"></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(rows - o.items.length)}
        <tr><td colspan="5" class="r"><strong>未稅合計</strong></td><td class="r"><strong>${money(o.total)}</strong></td><td colspan="3"></td></tr>
        <tr><td colspan="10">是否已達到經費最小化：□是　□否</td></tr>
        <tr><td colspan="10">建議廠商及原因：${esc(o.vendor_name)}</td></tr>
        <tr><td colspan="10">議價說明：${esc(o.note || '')}</td></tr>
        <tr><th colspan="2">驗收單位</th><th rowspan="2">核准</th><th rowspan="2">會簽單位</th><th colspan="6">採　購　單　位</th></tr>
        <tr><th>驗收結果</th><th>驗收人</th><th>覆核</th><th>審核</th><th>單位主管</th><th colspan="3">經辦</th></tr>
        <tr class="sign"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td colspan="3"></td></tr>
      </table>
      <div class="foot">採購流程：採購單位 → 核決主管 → 採購訂貨 → 驗收單位 → 請款作業</div>`);
  }

  /* ================= 驗貨入庫 ================= */
  async function viewProcReceiving() {
    const [pending, vendors] = await Promise.all([api('/procurement/orders?status=pending'), api('/procurement/vendors?active=all')]);
    main().innerHTML = `
      <div class="page-title">驗貨入庫</div>
      <div class="card">
        <h3>待入庫採購單（${pending.length}）</h3>
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>採購單號</th><th>廠商</th><th>預計到貨</th><th>品項數</th><th class="no-print"></th></tr></thead>
          <tbody>${pending.map(o => `<tr>
            <td data-label="採購單號">${esc(o.no)}</td><td data-label="廠商">${esc(o.vendor_name)}</td>
            <td data-label="預計到貨">${esc(o.eta || '—')}${o.eta && o.eta < todayStr() ? ' <span class="badge red">逾期</span>' : ''}</td>
            <td data-label="品項數">${o.item_count}</td>
            <td data-label="操作" class="no-print">${can('purchasing') ? `<button class="btn small" data-recv="${o.id}">開始驗貨</button>` : ''}</td></tr>`).join('')
            || '<tr><td colspan="5"><div class="empty">目前沒有待入庫的採購單</div></td></tr>'}</tbody></table></div>
        <small style="color:var(--muted)">確認入庫後：實到數量加入備品庫存（備品進出明細看得到）、採購單轉已入庫、自動產生請款單。</small>
      </div>
      <h3 style="margin:14px 0 6px">入庫紀錄</h3>
      ${filterBar({ dateLabel: '入庫日期', vendors, placeholder: '入庫單號／採購單號／發票號／驗貨人' })}
      <div class="card"><div class="table-wrap"><table class="data stack">
        <thead><tr><th>入庫單號</th><th>採購單號</th><th>廠商</th><th>入庫日期</th><th>驗貨人員</th><th>發票號碼</th><th>未稅金額</th><th>請款單</th><th class="no-print"></th></tr></thead>
        <tbody id="gr-body"></tbody></table></div></div>`;
    main().querySelectorAll('[data-recv]').forEach(b => b.onclick = async () => openReceiving(await api('/procurement/orders/' + b.dataset.recv), viewProcReceiving));
    wireFilter(main(), async (qs, setCount) => {
      const rows = await api('/procurement/receipts?' + qs);
      setCount(rows.length);
      $('#gr-body').innerHTML = rows.map(g => `<tr>
        <td data-label="入庫單號">${esc(g.no)}</td><td data-label="採購單號">${esc(g.po_no)}</td><td data-label="廠商">${esc(g.vendor_name || '')}</td>
        <td data-label="入庫日期">${esc(g.receive_date)}</td><td data-label="驗貨人員">${esc(g.inspector)}</td>
        <td data-label="發票號碼">${esc(g.invoice_no || '—')}</td><td data-label="未稅金額">${money(g.subtotal)}</td>
        <td data-label="請款單">${g.pay_no ? `<a href="#/proc-payments">${esc(g.pay_no)}</a>` : '—'}</td>
        <td data-label="操作" class="no-print"><button class="btn small secondary" data-gr="${g.id}">查看</button></td></tr>`).join('')
        || '<tr><td colspan="9"><div class="empty">查無入庫紀錄</div></td></tr>';
      main().querySelectorAll('[data-gr]').forEach(b => b.onclick = async () => {
        const g = await api('/procurement/receipts/' + b.dataset.gr);
        openWide(`入庫單 ${g.no}`, `
          <div style="margin-bottom:8px;font-size:.9rem">採購單：${esc(g.po_no)}　廠商：${esc(g.vendor_name || '')}　入庫日期：${esc(g.receive_date)}　驗貨人員：${esc(g.inspector)}${g.invoice_no ? `　發票：${esc(g.invoice_no)}` : ''}</div>
          <table class="data"><thead><tr><th>品項</th><th>訂購數</th><th>實到數</th><th>未稅單價</th><th>未稅小計</th></tr></thead>
          <tbody>${g.items.map(i => `<tr><td>${esc(i.item_name)}</td><td>${i.ordered_qty} ${esc(i.unit)}</td>
            <td style="color:${i.received_qty === i.ordered_qty ? 'var(--ok)' : 'var(--danger)'};font-weight:700">${i.received_qty}</td>
            <td>${money(i.unit_price)}</td><td>${money(i.received_qty * i.unit_price)}</td></tr>`).join('')}</tbody></table>
          ${g.note ? `<p>備註：${esc(g.note)}</p>` : ''}`);
      });
    });
  }

  function openReceiving(o, done) {
    if (o.status !== 'pending') { alert('此採購單已入庫或已取消'); return; }
    openWide(`驗貨入庫 — ${o.no}`, `
      <div style="background:var(--primary-light);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:.9rem">
        廠商：<strong>${esc(o.vendor_name)}</strong>　預計到貨：${esc(o.eta || '—')}</div>
      <div class="form-grid">
        <div class="field"><label>驗貨日期</label><input type="date" id="rc-date" value="${todayStr()}"></div>
        <div class="field"><label>驗貨人員 <b class="req">*</b></label><input id="rc-insp" value="${esc(currentUser.name)}"></div>
        <div class="field"><label>發票號碼</label><input id="rc-inv" maxlength="30" placeholder="廠商發票號碼"></div>
        <div class="field"><label>備註</label><input id="rc-note" maxlength="500"></div>
      </div>
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>品項</th><th>訂購數</th><th>實際到貨數</th><th>未稅單價</th><th>未稅小計</th></tr></thead>
        <tbody>${o.items.map(it => {
          const isNew = !it.supply_id;
          return `<tr data-item="${it.id}">
            <td data-label="品項">${esc(it.item_name)}${isNew ? ` <span class="badge teal">新品項</span>
              <div class="row" style="gap:6px;margin-top:4px;flex-wrap:wrap">
                <input data-k="new_code" placeholder="品項編號" value="${esc(it.new_code || '')}" style="max-width:100px">
                <input data-k="new_unit" placeholder="單位" value="${esc(it.unit || '')}" style="max-width:70px">
                <input data-k="new_warehouse" placeholder="倉庫別" value="${esc(it.new_warehouse || '')}" style="max-width:100px">
                <input type="number" min="0" data-k="new_safety" title="安全庫存" value="${it.new_safety}" style="max-width:70px"></div>` : `<br><small style="color:var(--muted)">目前庫存 ${it.stock}</small>`}</td>
            <td data-label="訂購數">${it.qty} ${esc(it.unit)}</td>
            <td data-label="實際到貨數"><input type="number" min="0" data-k="received_qty" value="${it.qty}" style="max-width:90px"></td>
            <td data-label="未稅單價"><input type="number" min="0" step="0.01" data-k="unit_price" value="${it.unit_price}" style="max-width:110px"></td>
            <td data-label="未稅小計" data-sub></td></tr>`;
        }).join('')}</tbody></table></div>
      <div style="text-align:right;font-weight:700;margin:8px 0">未稅合計：<span id="rc-total"></span></div>
      ${o.items.some(i => !i.supply_id) ? '<p style="font-size:.85rem;color:var(--muted)">標示「新品項」的品項，確認入庫後會自動建立到品項管理（備品），並以到貨數量入庫。</p>' : ''}
      <div class="row" style="gap:8px"><button class="btn" id="rc-go">確認入庫，自動產生請款單</button><span class="error-msg" id="rc-err"></span></div>`, body => {
      const recalc = () => {
        let total = 0;
        body.querySelectorAll('[data-item]').forEach(tr => {
          const sub = (Number(val(tr, '[data-k="received_qty"]')) || 0) * (Number(val(tr, '[data-k="unit_price"]')) || 0);
          total += sub; tr.querySelector('[data-sub]').textContent = money(sub);
        });
        body.querySelector('#rc-total').textContent = money(total);
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
        const short = items.filter((x, i) => x.received_qty !== o.items[i].qty).length;
        if (short && !confirm(`有 ${short} 個品項的實到數量與訂購數不同，確定入庫？`)) return;
        try {
          const r = await api('/procurement/receipts', { method: 'POST', body: {
            po_id: o.id, receive_date: val(body, '#rc-date'), inspector: val(body, '#rc-insp'),
            invoice_no: val(body, '#rc-inv'), note: val(body, '#rc-note'), items } });
          alert(`入庫完成（${r.no}），庫存已更新${r.new_items ? `，新建 ${r.new_items} 個品項` : ''}。\n請款單 ${r.payment_no} 已自動建立。`);
          closeModal(); done && done();
        } catch (e) { err.textContent = e.message; }
      };
    });
  }

  /* ================= 請款單 ================= */
  async function viewProcPayments() {
    const vendors = await api('/procurement/vendors?active=all');
    main().innerHTML = `
      <div class="page-title">請款單</div>
      ${filterBar({ dateLabel: '日期', dateFields: [['req', '以請款日期查詢'], ['due', '以付款到期日查詢']], statuses: PAY_ST, vendors, placeholder: '請款單號／發票號／廠商' })}
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
        <td data-label="請款單號">${esc(p.no)}<br><small>${esc(p.req_date)}</small></td>
        <td data-label="廠商">${esc(p.vendor_name || '')}</td>
        <td data-label="入庫／採購單"><small>${esc(p.gr_no || '')}<br>${esc(p.po_no || '')}</small></td>
        <td data-label="發票號碼">${esc(p.invoice_no || '—')}</td>
        <td data-label="含稅金額"><strong>${money(p.total_amount)}</strong><br><small>未稅 ${money(p.subtotal)}＋稅 ${money(p.tax_amount)}</small></td>
        <td data-label="付款到期日">${esc(p.pay_due_date || '—')}${p.status === 'unpaid' && p.pay_due_date && p.pay_due_date < todayStr() ? ' <span class="badge red">逾期</span>' : ''}</td>
        <td data-label="狀態">${badge(PAY_ST, p.status)}${p.status === 'paid' ? `<br><small>${esc(p.paid_on || '')} ${esc(p.pay_method || '')}</small>` : ''}</td>
        <td data-label="操作" class="no-print">
          ${p.status === 'unpaid' && can('payables') ? `<button class="btn small" data-pay="${p.id}">填金額／付款</button>` : ''}
          <button class="btn small secondary" data-print="${p.id}">支付憑單</button>
          ${p.status === 'paid' && currentUser.role === 'admin' ? `<button class="btn small danger" data-unpay="${p.id}">改回待付款</button>` : ''}
        </td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">查無請款單</div></td></tr>';
      main().querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => openPayForm(await api('/procurement/payments/' + b.dataset.pay), reload));
      main().querySelectorAll('[data-print]').forEach(b => b.onclick = async () => printPayment(await api('/procurement/payments/' + b.dataset.print)));
      main().querySelectorAll('[data-unpay]').forEach(b => b.onclick = async () => {
        if (!confirm('將此請款單改回「待付款」？（會留下稽核紀錄）')) return;
        try { await api(`/procurement/payments/${b.dataset.unpay}/unpay`, { method: 'POST' }); reload(); } catch (e) { alert(e.message); }
      });
    }
    wireFilter(main(), load);
  }

  function termDays(terms) { const m = /(\d+)/.exec(terms || ''); return m ? Number(m[1]) : (/貨到|預付/.test(terms || '') ? 0 : 30); }
  function addDays(date, n) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  function openPayForm(p, done) {
    const days = termDays(p.vendor_terms);
    openWide(`填寫請款資訊 — ${p.no}`, `
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
        <div class="field"><label>發票號碼</label><input id="pf-inv" value="${esc(p.invoice_no || '')}"></div>
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
    printDoc(`請款支付憑單 ${p.no}`, `
      <h1>${esc(s.center_name)}</h1><h2 style="text-decoration:underline">請款支付憑單</h2>
      <div class="r" style="margin-bottom:6px">${ymd(p.invoice_date || p.req_date)}　　單號：${esc(p.no)}</div>
      <table>
        <tr><td class="hd" style="width:80px">預算編號</td><td colspan="2">${esc(p.budget_no || '')}</td>
          <td class="hd" rowspan="3" style="width:60px;vertical-align:middle">費用歸屬</td><td rowspan="3">${esc(p.cost_center || '')}</td>
          <td class="hd" style="width:80px">廠商名稱</td><td colspan="3">${esc(p.vendor_name || '')}</td></tr>
        <tr><td class="hd">阿米巴項目</td><td colspan="2"></td><td class="hd">統一編號</td><td colspan="3">${esc(p.vendor_tax_id || '')}</td></tr>
        <tr><td class="hd">部門別</td><td colspan="2">${esc(s.pay_dept)}</td><td class="hd">發票號碼</td><td colspan="3">${esc(p.invoice_no || '')}</td></tr>
        <tr><td class="hd">金　額</td><td colspan="8">新台幣：${chineseAmount(p.total_amount)}　　NT$ <strong>${Number(p.total_amount).toLocaleString('en-US')}</strong></td></tr>
        <tr><td class="hd">事　由</td><td colspan="4">${esc(p.items.map(i => `${i.item_name}×${i.qty}${i.unit}`).join('、'))}　共計 ${money(p.subtotal)}（未稅）${p.tax_amount ? `＋稅 ${money(p.tax_amount)}` : ''}${p.remark ? `<br>${esc(p.remark)}` : ''}</td>
          <td class="hd">領款方式</td><td colspan="3">□自取　□送達　□郵寄<br>${box(p.pay_method === '銀行轉帳')}匯款</td></tr>
        <tr><td class="hd">領款人</td><td colspan="4">${esc(p.bank_holder || p.vendor_name || '')}</td>
          <td class="hd" rowspan="2" style="vertical-align:middle">領款人簽收</td><td colspan="3" rowspan="2"></td></tr>
        <tr><td class="hd">付款方式</td><td colspan="4">${box(p.pay_method === '現金')}現金　${box(p.pay_method === '支票')}票據，票期：____年____月____日<br>
          帳號：${esc(p.bank_account || '________________')}　票號：________________<br>
          ${box(p.pay_method === '銀行轉帳' || p.pay_method === '其他')}其他：${p.pay_method === '其他' ? '其他' : '匯款'}　銀行：${esc(p.bank_name || '')}${p.bank_branch ? ' ' + esc(p.bank_branch) : ''}　代碼：${esc(p.bank_code || '')}</td></tr>
        <tr><th>核准</th><th>覆核</th><th>審核</th><th>單位主管</th><th>申請人</th><th>財務經理</th><th>會計主管</th><th>會計</th><th>出納</th></tr>
        <tr class="sign"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      </table>
      <table>
        <thead><tr><th style="text-align:left">品項名稱</th><th>數量</th><th>未稅單價</th><th>未稅小計</th></tr></thead>
        <tbody>${p.items.map(i => `<tr><td>${esc(i.item_name)}</td><td class="c">${i.qty} ${esc(i.unit)}</td><td class="r">${money(i.unit_price)}</td><td class="r">${money(i.amount)}</td></tr>`).join('')}
          <tr><td colspan="3" class="r"><strong>未稅合計</strong></td><td class="r"><strong>${money(p.subtotal)}</strong></td></tr>
          <tr><td colspan="3" class="r">稅額（${p.tax_rate}%）</td><td class="r">${money(p.tax_amount)}</td></tr>
          <tr><td colspan="3" class="r"><strong>含稅總額</strong></td><td class="r"><strong>${money(p.total_amount)}</strong></td></tr></tbody>
      </table>
      <div class="foot">入庫單：${esc(p.gr_no || '')}　採購單：${esc(p.po_no || '')}　付款到期日：${esc(p.pay_due_date || '')}${p.status === 'paid' ? `　已付款：${esc(p.paid_on || '')}（${esc(p.paid_name || '')}）` : ''}</div>`);
  }

  /* ================= 出貨管理 ================= */
  async function viewProcShipments() {
    main().innerHTML = `
      <div class="page-title">出貨管理</div>
      <div class="card no-print"><div class="row" style="gap:8px">
        ${can('purchasing') ? '<button class="btn" id="sh-new">新增出貨單</button>' : ''}
        <span style="color:var(--muted);font-size:.85rem">建立出貨單會同時產生領料單；按「確認出貨」才從備品庫存扣除。</span></div></div>
      ${filterBar({ dateLabel: '出貨日期', statuses: SHIP_ST, placeholder: '出貨單號／客戶部門／品名' })}
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
        <td data-label="出貨單號">${esc(s.no)}</td><td data-label="出貨日期">${esc(s.ship_date)}</td>
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
    const { rows: items } = await api('/procurement/items');
    const lineHtml = (it = {}) => `<tr data-line>
      <td data-label="品項"><select data-k="supply_id" style="min-width:240px"><option value="">-- 選擇品項 --</option>${itemOptions(items, it.supply_id)}</select></td>
      <td data-label="數量"><input type="number" min="1" data-k="qty" value="${it.qty || 1}" style="max-width:90px"></td>
      <td><button class="btn small danger" data-del>刪</button></td></tr>`;
    openWide(s ? `修改出貨單 ${s.no}` : '新增出貨單', `
      <div class="form-grid">
        <div class="field"><label>客戶／部門 <b class="req">*</b></label><input id="shf-to" value="${esc(s ? s.recipient : '')}" placeholder="客戶或內部部門"></div>
        <div class="field"><label>出貨日期</label><input type="date" id="shf-date" value="${esc(s ? s.ship_date : todayStr())}"></div>
        <div class="field full"><label>備註</label><input id="shf-note" value="${esc(s ? s.note : '')}"></div>
      </div>
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>品項（目前庫存）</th><th>數量</th><th></th></tr></thead>
        <tbody id="shf-lines">${(s ? s.items : [{}]).map(lineHtml).join('')}</tbody></table></div>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn small secondary" id="shf-add">新增品項</button>
        <button class="btn" id="shf-save">${s ? '儲存修改' : '建立出貨單並產生領料單'}</button>
        <span class="error-msg" id="shf-err"></span></div>`, body => {
      const wire = tr => { tr.querySelector('[data-del]').onclick = () => tr.remove(); };
      body.querySelectorAll('[data-line]').forEach(wire);
      body.querySelector('#shf-add').onclick = () => { body.querySelector('#shf-lines').insertAdjacentHTML('beforeend', lineHtml()); wire(body.querySelector('#shf-lines').lastElementChild); };
      body.querySelector('#shf-save').onclick = async () => {
        const lines = [...body.querySelectorAll('[data-line]')].map(tr => ({ supply_id: Number(val(tr, '[data-k="supply_id"]')), qty: Number(val(tr, '[data-k="qty"]')) })).filter(l => l.supply_id);
        const payload = { recipient: val(body, '#shf-to'), ship_date: val(body, '#shf-date'), note: val(body, '#shf-note'), items: lines };
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
      if (b) b.onclick = () => printPick({ ...s.pick, ship_no: s.no, items: s.items });
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
        printPick({ ...s.pick, ship_no: s.no, items: s.items });
      });
    });
  }
  async function printPick(p) {
    const s = await procSettings();
    printDoc(`領料單 ${p.no}`, `
      <h1>${esc(s.center_name)}</h1><h2>領料單</h2>
      <table><tr><td class="hd">領料單號</td><td>${esc(p.no)}</td><td class="hd">出貨單號</td><td>${esc(p.ship_no)}</td></tr>
        <tr><td class="hd">領用對象</td><td>${esc(p.recipient)}</td><td class="hd">日期</td><td>${esc(p.pick_date)}</td></tr></table>
      <table><thead><tr><th>項次</th><th style="text-align:left">品項名稱</th><th>單位</th><th>數量</th><th>確認</th></tr></thead>
        <tbody>${p.items.map((i, n) => `<tr><td class="c">${n + 1}</td><td>${esc(i.item_name)}</td><td class="c">${esc(i.unit)}</td><td class="c"><strong>${i.qty}</strong></td><td class="c">□</td></tr>`).join('')}</tbody></table>
      <table class="sign"><tr><th>領料人簽名</th><th>發料人簽名</th><th>主管</th></tr><tr><td></td><td></td><td></td></tr></table>`);
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
        <div class="field"><label>關鍵字</label><input id="vd-q" placeholder="廠商名稱／編號／統編／聯絡人"></div>
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
        <td data-label="付款條件">${esc(v.payment_terms || '—')}</td>
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
    const s = await procSettings();
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
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn" id="vf-save">儲存</button><span class="error-msg" id="vf-err"></span></div>`, body => {
      body.querySelector('#vf-terms').onchange = () => { body.querySelector('#vf-terms-custom').style.display = val(body, '#vf-terms') === '__custom' ? 'block' : 'none'; };
      body.querySelector('#vf-save').onclick = async () => {
        const g = k => val(body, '#vf-' + k);
        const termSel = g('terms');
        const payload = { code: g('code'), name: g('name'), tax_id: g('tax_id'), payment_terms: termSel === '__custom' ? g('terms-custom') : termSel,
          address: g('address'), contact: g('contact'), phone: g('phone'), email: g('email'), bank_name: g('bank_name'),
          bank_branch: g('bank_branch'), bank_code: g('bank_code'), bank_account: g('bank_account'), bank_holder: g('bank_holder'), note: g('note') };
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
      <div class="sec-hd">供應品項</div>
      <div style="margin-bottom:8px">${d.items.map(i => `<span class="badge ${i.is_default ? 'teal' : 'gray'}">${esc(i.name)}${i.is_default ? '（預設）' : ''}</span>`).join(' ') || '<span style="color:var(--muted)">尚未有品項設定此廠商</span>'}</div>
      <div class="sec-hd">歷史進貨統計</div>
      <table class="data"><thead><tr><th>品項</th><th>進貨次數</th><th>累計到貨量</th><th>未稅累計金額</th></tr></thead>
        <tbody>${d.purchased.map(p => `<tr><td>${esc(p.name)}</td><td>${p.times} 次</td><td>${p.total_qty} ${esc(p.unit)}</td><td>${money(p.total_amount)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">尚無進貨紀錄</div></td></tr>'}</tbody></table>
      <div class="sec-hd" style="margin-top:8px">最近採購單</div>
      <table class="data"><thead><tr><th>採購單號</th><th>日期</th><th>品項數</th><th>狀態</th></tr></thead>
        <tbody>${d.orders.map(o => `<tr><td>${esc(o.no)}</td><td>${esc(o.po_date)}</td><td>${o.item_count}</td><td>${badge(PO_ST, o.status)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">尚無採購單</div></td></tr>'}</tbody></table>
      <div class="sec-hd" style="margin-top:8px">請款紀錄（最新 10 筆）</div>
      <table class="data"><thead><tr><th>請款單號</th><th>發票</th><th>含稅金額</th><th>到期日</th><th>狀態</th></tr></thead>
        <tbody>${d.payments.map(p => `<tr><td>${esc(p.no)}</td><td>${esc(p.invoice_no || '—')}</td><td>${money(p.total_amount)}</td><td>${esc(p.pay_due_date || '—')}</td><td>${badge(PAY_ST, p.status)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">尚無請款單</div></td></tr>'}</tbody></table>`);
  }

  /* ================= 採購設定 ================= */
  async function viewProcSettings() {
    const s = await api('/settings');
    const isAdmin = currentUser.role === 'admin';
    const dis = isAdmin ? '' : 'disabled';
    main().innerHTML = `
      <div class="page-title">採購設定</div>
      <div class="card">
        <div class="form-grid">
          <div class="field"><label>機構名稱<small>（單據抬頭，於系統設定維護）</small></label><input value="${esc(s.center_name || '')}" disabled></div>
          <div class="field"><label>請購單位（部門）<small>（請購採購單）</small></label><input id="ps-req" value="${esc(s.proc_request_dept || '')}" ${dis}></div>
          <div class="field"><label>部門別<small>（請款支付憑單）</small></label><input id="ps-pay" value="${esc(s.proc_pay_dept || '')}" ${dis}></div>
          <div class="field"><label>請款單預設稅率（%）</label><input type="number" min="0" max="100" step="0.1" id="ps-tax" value="${esc(s.proc_tax_rate || '5')}" ${dis}></div>
          <div class="field full"><label>廠商付款條件選項<small>（逗號分隔；含數字者視為天數，用來算付款到期日）</small></label>
            <input id="ps-terms" value="${esc(s.proc_payment_terms || '')}" ${dis}></div>
        </div>
        <div class="row" style="gap:8px;margin-top:8px">${isAdmin ? '<button class="btn" id="ps-save">儲存設定</button>' : '<small style="color:var(--muted)">僅管理員可修改</small>'}<span class="error-msg" id="ps-err"></span></div>
      </div>`;
    const b = main().querySelector('#ps-save');
    if (b) b.onclick = async () => {
      const tax = Number($('#ps-tax').value);
      if (!(tax >= 0 && tax <= 100)) { $('#ps-err').textContent = '稅率需介於 0 到 100'; return; }
      try {
        await api('/settings', { method: 'PUT', body: { proc_request_dept: $('#ps-req').value.trim(), proc_pay_dept: $('#ps-pay').value.trim(),
          proc_tax_rate: String(tax), proc_payment_terms: $('#ps-terms').value.split(/[,，]/).map(x => x.trim()).filter(Boolean).join(',') } });
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
