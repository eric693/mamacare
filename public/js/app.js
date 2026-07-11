/* MamaCare 員工端單頁應用 */

let currentUser = null;
let SETTINGS = {}; // 營運參數（餵食方式、生產方式、門檻值等）一律來自後端設定

function feedMethods() {
  return (SETTINGS.feed_methods || '親餵').split(',').map(s => s.trim()).filter(Boolean);
}
function deliveryTypes() {
  return (SETTINGS.delivery_types || '').split(',').map(s => s.trim()).filter(Boolean);
}
function paymentMethods() {
  return (SETTINGS.payment_methods || '現金').split(',').map(s => s.trim()).filter(Boolean);
}
function chargePresets() {
  return (SETTINGS.charge_presets || '').split(',').map(s => s.trim()).filter(Boolean);
}
function mealChoices() {
  return (SETTINGS.meal_choices || '一般餐').split(',').map(s => s.trim()).filter(Boolean);
}

const BABY_TYPE_LABEL = {
  feeding: '餵食', diaper: '換尿布', temperature: '體溫', weight: '體重',
  jaundice: '黃疸值', bath: '沐浴', sleep: '睡眠', photo: '照片', note: '備註',
  respiration: '呼吸', heart_rate: '心跳', spo2: '血氧', length: '身長', head_circ: '頭圍',
  skin: '膚色', cord: '臍帶', vomit: '溢吐奶', activity: '活動力', stool: '大便性狀'
};
// 數值型寶寶紀錄與單位
const BABY_NUM_UNIT = { temperature: '°C', weight: 'g', jaundice: 'mg/dL', respiration: '次/分', heart_rate: 'bpm', spo2: '%', length: 'cm', head_circ: 'cm' };
// 類別型寶寶紀錄 → 對應的設定選項 key
const BABY_TEXT_OPT = { skin: 'skin_options', cord: 'cord_options', vomit: 'vomit_options', activity: 'activity_options', stool: 'stool_options' };
// 紅臀（尿布疹）程度，與後端 db.js DIAPER_RASH_LEVELS 一致
const DIAPER_RASH_LEVELS = ['無', '輕度', '中度', '重度'];
// 異常事件顯示值：紅臀顯示程度，其餘顯示數值
function alertDetail(a) {
  return a.record_type === 'diaper' ? `紅臀${a.diaper_rash}` : a.value_num;
}
const MOTHER_TYPE_LABEL = {
  vital: '生命徵象', wound: '傷口護理', uterus: '子宮護理', breast: '乳房護理',
  lochia: '惡露觀察', mood: '情緒評估', education: '衛教指導', note: '備註',
  bp: '血壓', pulse: '脈搏', elimination: '排泄', lactation: '泌乳指導', medication: '用藥'
};
const SHIFT_LABEL = { day: '白班', evening: '小夜', night: '大夜' };
const STATUS_LABEL = {
  reserved: '預約', checked_in: '入住中', checked_out: '已退房', cancelled: '已取消'
};
const STATUS_BADGE = {
  reserved: 'yellow', checked_in: 'green', checked_out: 'gray', cancelled: 'gray'
};
const MEAL_LABEL = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
const MEAL_STATUS = { preparing: '備餐中', served: '已出餐', cancelled: '取消' };
const LOCATION_LABEL = { nursery: '嬰兒室', rooming: '親子同室', isolation: '隔離室', out: '不在館內', hospital: '住院中' };
const LOCATION_BADGE = { nursery: 'teal', rooming: 'purple', isolation: 'yellow', out: 'green', hospital: 'red' };
// 寶寶房況卡片圖例顏色（標題＝性別、卡身＝狀態）
const BABY_LEGEND = [
  ['男', '#5ec8f2'], ['女', '#f291b2'],
  ['親子同室', '#d9a6ee'], ['隔離室', '#f6df7a'], ['不在館內', '#9ccc9c'], ['住院中', '#f3b1b1'], ['嬰兒室', '#ffffff']
];
const TOUR_STATUS_LABEL = { scheduled: '待參觀', visited: '已參觀', signed: '已簽約', lost: '未成交' };
const TOUR_STATUS_BADGE = { scheduled: 'yellow', visited: 'teal', signed: 'green', lost: 'gray' };

// 異常／不良事件
const INCIDENT_LABEL = { fall: '跌倒', med_error: '給藥錯誤', baby_id_error: '嬰兒辨識錯誤', infection: '感染', burn: '燙傷', equipment: '設備故障', other: '其他' };
const SEVERITY_LABEL = { near_miss: '未遂', minor: '輕度', moderate: '中度', severe: '重度', sentinel: '警訊事件' };
const SEVERITY_BADGE = { near_miss: 'gray', minor: 'yellow', moderate: 'yellow', severe: 'red', sentinel: 'red' };
const INCIDENT_STATUS_LABEL = { open: '待處理', processing: '處理中', closed: '已結案' };
const INCIDENT_STATUS_BADGE = { open: 'red', processing: 'yellow', closed: 'green' };
const CLUSTER_STATUS_LABEL = { open: '通報', monitoring: '監測中', closed: '已結案' };
// 新生兒醫療
const MED_STATUS_LABEL = { given: '已給藥', held: '暫停', refused: '拒絕', missed: '漏給' };
const MED_STATUS_BADGE = { given: 'green', held: 'yellow', refused: 'gray', missed: 'red' };
const VACCINE_LABEL = { hepb_immunoglobulin: 'B肝免疫球蛋白(HBIG)', hepb: 'B型肝炎疫苗', bcg: '卡介苗', other: '其他' };
const VACC_STATUS_LABEL = { scheduled: '待接種', done: '已接種', deferred: '緩種', refused: '拒絕' };
const VACC_STATUS_BADGE = { scheduled: 'yellow', done: 'green', deferred: 'gray', refused: 'gray' };
const SCREEN_LABEL = { hearing: '聽力篩檢', metabolic: '代謝篩檢', cchd: '心臟血氧(CCHD)', other: '其他' };
const SCREEN_RESULT_LABEL = { pending: '待報告', pass: '通過', refer: '需複篩/轉介', abnormal: '異常' };
const SCREEN_RESULT_BADGE = { pending: 'yellow', pass: 'green', refer: 'red', abnormal: 'red' };
// 醫師巡診
const VISIT_SPECIALTY_LABEL = { pediatrics: '小兒科', obgyn: '婦產科', other: '其他' };
const VISIT_TYPE_LABEL = { routine: '常規巡診', follow_up: '追蹤複查', acute: '不適診視', discharge: '出院評估' };
const VISIT_TYPE_BADGE = { routine: 'teal', follow_up: 'yellow', acute: 'red', discharge: 'gray' };
const INVOICE_STATUS_LABEL = { issued: '已開立', void: '已作廢', allowance: '已折讓' };
const INVOICE_STATUS_BADGE = { issued: 'green', void: 'gray', allowance: 'yellow' };
const DOC_TYPE_LABEL = { invoice: '電子發票', receipt: '收據' };
function pct(n) { return n == null ? '—' : n + '%'; }

/* ---------- 共用：列表搜尋／狀態篩選 ----------
   用法：在卡片內放 filterBar(...)，列 <tr> 加 data-filter（可搜尋文字）與 data-status（可選），
   再呼叫 wireFilter(scopeEl) 啟用。純前端篩選，不需重新請求。 */
function filterBar(opts = {}) {
  const ph = opts.placeholder || '搜尋姓名 / 電話 / 房間…';
  const sb = opts.search === false ? '' : `<input class="flt-search" placeholder="${esc(ph)}" style="flex:1;min-width:150px">`;
  const btns = (opts.statuses || []).map((s, i) =>
    `<button class="btn small ${i === 0 ? '' : 'secondary'}" data-flt-status="${esc(s.val)}">${esc(s.label)}</button>`).join('');
  return `<div class="row flt-bar" style="gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:center">${sb}${btns}<span class="flt-count" style="color:var(--muted);font-size:.85rem"></span></div>`;
}
function wireFilter(scope) {
  scope.querySelectorAll('.flt-bar').forEach(bar => {
    // 篩選對象：同卡片內的表格列，或卡片格容器（.flt-zone 內的 [data-filter] 元素）
    const table = bar.parentElement.querySelector('table') || bar.parentElement.querySelector('.flt-zone');
    if (!table) return;
    const search = bar.querySelector('.flt-search');
    const count = bar.querySelector('.flt-count');
    const statusBtns = [...bar.querySelectorAll('[data-flt-status]')];
    let status = statusBtns.length ? statusBtns[0].dataset.fltStatus : '';
    const apply = () => {
      const q = search ? search.value.trim().toLowerCase() : '';
      let shown = 0, total = 0;
      table.querySelectorAll('[data-filter]').forEach(tr => {
        total++;
        const okText = !q || (tr.dataset.filter || '').toLowerCase().includes(q);
        const okStatus = !status || tr.dataset.status === status;
        const vis = okText && okStatus;
        tr.style.display = vis ? '' : 'none';
        if (vis) shown++;
      });
      if (count) count.textContent = total ? `顯示 ${shown} / ${total} 筆` : '';
    };
    if (search) search.oninput = apply;
    statusBtns.forEach(b => b.onclick = () => {
      status = b.dataset.fltStatus;
      statusBtns.forEach(x => x.classList.toggle('secondary', x !== b));
      apply();
    });
    apply();
  });
}

const $ = sel => document.querySelector(sel);
const main = () => $('#main');

/* ---------- 對話框 ---------- */
function openModal(title, bodyHtml, onMount) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  if (!$('#modal').open) $('#modal').showModal();
  if (onMount) onMount($('#modal-body'));
}
function closeModal() { $('#modal').close(); }

/* ---------- 寶寶紀錄描述 ---------- */
function babyRecordDetail(r) {
  switch (r.record_type) {
    case 'feeding': {
      const amt = r.amount_ml ? ` ${r.amount_ml} ml` : '';
      const lr = (r.feed_left_min != null || r.feed_right_min != null)
        ? ` 親餵 左${r.feed_left_min ?? 0}/右${r.feed_right_min ?? 0} 分` : '';
      return `${r.feed_method || ''}${amt}${lr}`;
    }
    case 'diaper': {
      const base = r.diaper_kind === '便' ? '大便' : '小便(濕)';
      return r.diaper_rash && r.diaper_rash !== '無' ? `${base}・紅臀${r.diaper_rash}` : base;
    }
    case 'temperature': return `${r.value_num} 度C`;
    case 'weight': return `${r.value_num} g`;
    case 'jaundice': return `${r.value_num} mg/dL`;
    case 'photo': return '已上傳照片';
    default:
      if (BABY_NUM_UNIT[r.record_type]) return r.value_num != null ? `${r.value_num} ${BABY_NUM_UNIT[r.record_type]}` : '';
      if (BABY_TEXT_OPT[r.record_type]) return r.value_text || '';
      return '';
  }
}

/* 編輯媽媽照護紀錄 */
function openMotherRecordEdit(r, onDone) {
  if (!r) return;
  openModal(`編輯：${MOTHER_TYPE_LABEL[r.record_type] || r.record_type}`, `
    <div class="field"><label>觀察內容</label><textarea id="mre-text">${esc(r.value_text || '')}</textarea></div>
    <div class="field"><label>備註</label><textarea id="mre-note">${esc(r.note || '')}</textarea></div>
    <div class="row mt"><button class="btn" id="mre-save">儲存修改</button><span class="error-msg" id="mre-err"></span></div>
    <p style="font-size:.8rem;color:var(--muted)">修改會保留軌跡（記入稽核軌跡）。</p>`, body => {
    body.querySelector('#mre-save').onclick = async () => {
      try { await api(`/mother-records/${r.id}`, { method: 'PUT', body: { value_text: body.querySelector('#mre-text').value, note: body.querySelector('#mre-note').value } });
        closeModal(); onDone && onDone();
      } catch (e) { body.querySelector('#mre-err').textContent = e.message; }
    };
  });
}

/* 編輯寶寶照護紀錄（依類型顯示對應欄位；類型不可改） */
function openBabyRecordEdit(r, onDone) {
  if (!r) return;
  let fields = '';
  if (r.record_type === 'feeding') {
    fields = `<div class="field"><label>餵食方式</label><select id="er-feed">${feedMethods().map(m => `<option ${r.feed_method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
      <div class="field"><label>奶量 (ml)</label><input type="number" id="er-amount" min="0" value="${r.amount_ml ?? ''}"></div>`;
  } else if (r.record_type === 'diaper') {
    fields = `<div class="field"><label>尿布內容</label><select id="er-dkind"><option value="濕" ${r.diaper_kind === '濕' ? 'selected' : ''}>小便(濕)</option><option value="便" ${r.diaper_kind === '便' ? 'selected' : ''}>大便</option></select></div>
      <div class="field"><label>紅臀評估</label><select id="er-rash">${DIAPER_RASH_LEVELS.map(v => `<option ${r.diaper_rash === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`;
  } else if (BABY_NUM_UNIT[r.record_type]) {
    fields = `<div class="field"><label>${BABY_TYPE_LABEL[r.record_type]}（${BABY_NUM_UNIT[r.record_type]}）</label><input type="number" step="0.1" id="er-num" value="${r.value_num ?? ''}"></div>`;
  } else if (BABY_TEXT_OPT[r.record_type]) {
    const opts = (SETTINGS[BABY_TEXT_OPT[r.record_type]] || '').split(',').map(x => x.trim()).filter(Boolean);
    fields = `<div class="field"><label>${BABY_TYPE_LABEL[r.record_type]}</label><select id="er-text">${opts.map(o => `<option ${r.value_text === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  }
  openModal(`編輯：${BABY_TYPE_LABEL[r.record_type] || r.record_type}`, `
    <div class="form-grid">
      ${fields}
      <div class="field"><label>時間</label><input id="er-at" value="${esc((r.recorded_at || '').slice(0, 16))}" placeholder="YYYY-MM-DD HH:MM"></div>
      <div class="field full"><label>備註</label><textarea id="er-note">${esc(r.note || '')}</textarea></div>
      <div class="full row"><button class="btn" id="er-save">儲存修改</button><span class="error-msg" id="er-err"></span></div>
    </div>
    <p style="font-size:.8rem;color:var(--muted)">修改會保留軌跡（修改者、時間與前後值記入稽核軌跡）。紀錄類型不可變更，如需更改請刪除後重記。</p>`, body => {
    body.querySelector('#er-save').onclick = async () => {
      const v = id => { const el = body.querySelector(id); return el ? el.value : undefined; };
      const payload = { recorded_at: v('#er-at'), note: v('#er-note') };
      if (r.record_type === 'feeding') { payload.feed_method = v('#er-feed'); payload.amount_ml = Number(v('#er-amount')) || null; }
      else if (r.record_type === 'diaper') { payload.diaper_kind = v('#er-dkind'); payload.diaper_rash = v('#er-rash'); }
      else if (BABY_NUM_UNIT[r.record_type]) payload.value_num = Number(v('#er-num')) || null;
      else if (BABY_TEXT_OPT[r.record_type]) payload.value_text = v('#er-text');
      try { await api(`/baby-records/${r.id}`, { method: 'PUT', body: payload }); closeModal(); onDone && onDone(); }
      catch (e) { body.querySelector('#er-err').textContent = e.message; }
    };
  });
}

/* ---------- 總覽 ---------- */
async function viewDashboard() {
  const _now = new Date();
  const _mon = new Date(_now); _mon.setDate(_now.getDate() - ((_now.getDay() + 6) % 7)); // 本週一
  const weekStart = `${_mon.getFullYear()}-${String(_mon.getMonth() + 1).padStart(2, '0')}-${String(_mon.getDate()).padStart(2, '0')}`;
  const [d, reminders, weekCal] = await Promise.all([
    api('/dashboard'), api('/reminders'), api(`/overview-calendar?start=${weekStart}&days=7`)
  ]);
  const REM_LEVEL = { high: 'red', mid: 'yellow', low: 'gray' };
  const REM_TYPE = { checkout: '退房', unpaid: '帳款', contract: '合約', screening: '篩檢', incident: '異常', staffing: '人力', message: '留言', crm: '客訊', feeding: '餵奶', handover: '交班', cert: '證照', med: '給藥', vaccine: '疫苗', trend: '趨勢', tour: '跟進', care: '關懷' };
  const remCard = `
    <div class="card">
      <div class="row between"><h3>待辦提醒${reminders.count ? `　<span class="badge ${reminders.high ? 'red' : 'yellow'}">${reminders.count}</span>` : ''}</h3></div>
      ${reminders.items.length ? `<ul class="timeline">${reminders.items.map(it => `
        <li><a href="${it.link}" style="text-decoration:none;color:inherit">
          <span class="badge ${REM_LEVEL[it.level]}">${REM_TYPE[it.type] || ''}</span>
          ${esc(it.title)}${it.due ? `　<small style="color:var(--muted)">${esc(it.due)}</small>` : ''}</a></li>`).join('')}</ul>`
        : '<div class="empty">目前沒有待辦事項，一切就緒</div>'}
    </div>`;
  const shiftRows = d.staffing.shifts.map(s => `
    <tr>
      <td data-label="班別">${SHIFT_LABEL[s.shift_type]}</td>
      <td data-label="排班人數">${s.nurses} 人</td>
      <td data-label="法定需求">${s.required} 人</td>
      <td data-label="狀態">${s.ok
        ? '<span class="badge green">符合</span>'
        : '<span class="badge red">人力不足</span>'}</td>
    </tr>`).join('');
  // 本週行事曆（參觀／課程／服務／入住／退住 彙整）
  const wkByDate = {};
  for (const ev of weekCal.events) (wkByDate[ev.date] = wkByDate[ev.date] || []).push(ocItemHtml(ev));
  const wkNames = ['一', '二', '三', '四', '五', '六', '日'];
  let wkHead = '', wkCells = '';
  for (let i = 0; i < 7; i++) {
    const dt = new Date(_mon); dt.setDate(_mon.getDate() + i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const isToday = key === todayStr();
    wkHead += `<th style="text-align:center${isToday ? ';background:#eef6f0' : ''}">週${wkNames[i]} ${dt.getMonth() + 1}/${dt.getDate()}</th>`;
    wkCells += `<td class="pc-day${isToday ? ' pc-today' : ''}" style="vertical-align:top;height:72px;min-width:90px">${(wkByDate[key] || []).join('') || ''}</td>`;
  }
  const weekCard = `
    <div class="card">
      <div class="row between"><h3>本週行事曆</h3><a class="btn small secondary" href="#/overview-calendar">看整月</a></div>
      <div class="table-wrap">
        <table class="data pc-cal"><thead><tr>${wkHead}</tr></thead><tbody><tr>${wkCells}</tr></tbody></table>
      </div>
      <small style="color:var(--muted)">${ocLegendHtml()}</small>
      <style>
        .pc-cal td.pc-day{border:1px solid var(--border);padding:3px}
        .pc-cal td.pc-today{background:#eef6f0}
        .pc-item{font-size:.72rem;background:#f0f4f8;border-radius:4px;padding:1px 4px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:3px;vertical-align:middle}
      </style>
    </div>`;
  const alerts = d.alerts.length
    ? d.alerts.map(a => `
      <li>
        <span class="badge red">${BABY_TYPE_LABEL[a.record_type]}異常</span>
        ${esc(a.baby_name)}：${esc(String(alertDetail(a)))}（${fmtTime(a.recorded_at)}）
      </li>`).join('')
    : '<li class="empty">今日無異常警示</li>';
  const babyRows = d.baby_status.map(b => `
    <tr>
      <td data-label="寶寶">${esc(b.name)}</td>
      <td data-label="目前位置"><span class="badge ${LOCATION_BADGE[b.location] || 'gray'}">${LOCATION_LABEL[b.location] || '-'}</span></td>
      <td data-label="最後餵食">${b.last_feed_at ? fmtTime(b.last_feed_at) : '<span class="badge yellow">今日未餵</span>'}</td>
      <td data-label="今日餵食">${b.feed_count} 次</td>
      <td data-label="尿布">濕 ${b.diaper_wet} / 便 ${b.diaper_stool}</td>
      <td data-label="最後體溫">${b.last_temp != null ? b.last_temp + ' 度C' : '-'}</td>
    </tr>`).join('');
  const mealBadges = d.meals_today.map(m => {
    const missing = d.mothers_in_house - m.ordered;
    return `<span class="badge ${missing > 0 ? 'yellow' : 'green'}">
      ${MEAL_LABEL[m.meal_type]} ${m.ordered}/${d.mothers_in_house} 份${missing > 0 ? `（${missing} 位未訂）` : ''}</span>`;
  }).join(' ');

  main().innerHTML = `
    <div class="page-title">總覽　<span style="font-weight:400;font-size:.85rem;color:var(--muted)">${todayStr()}</span></div>
    ${remCard}
    <div id="dash-nr"></div>
    <div class="stat-grid">
      <div class="stat"><div class="num">${d.occupied}/${d.totalRooms}</div><div class="label">入住房數 / 總房數</div></div>
      <div class="stat"><div class="num">${d.mothersIn}</div><div class="label">在住媽媽</div></div>
      <div class="stat"><div class="num">${d.babiesIn}</div><div class="label">在住寶寶</div></div>
      <div class="stat"><div class="num">${d.todayBabyRecords + d.todayMotherRecords}</div><div class="label">今日照護紀錄筆數</div></div>
      <div class="stat"><div class="num" ${d.unpaid_count ? 'style="color:var(--danger)"' : ''}>${fmtMoney(d.unpaid_total)}</div><div class="label">未結帳款（${d.unpaid_count} 筆訂房）</div></div>
      <div class="stat"><div class="num" style="color:var(--ok)">${fmtMoney(d.month_paid)}</div><div class="label">本月已收款</div></div>
      <div class="stat"><a href="#/incidents" style="text-decoration:none;color:inherit"><div class="num" ${d.open_incidents ? 'style="color:var(--danger)"' : ''}>${d.open_incidents}</div><div class="label">未結案異常事件</div></a></div>
      <div class="stat"><a href="#/newborn-medical" style="text-decoration:none;color:inherit"><div class="num" ${d.pending_screenings ? 'style="color:var(--danger)"' : ''}>${d.pending_screenings}</div><div class="label">待追蹤新生兒篩檢</div></a></div>
    </div>
    ${weekCard}
    <div class="card">
      <h3>在住寶寶今日照護狀態</h3>
      ${d.baby_status.length ? `
      <div class="row" style="margin-bottom:8px">
        <span class="badge teal">嬰兒室 ${d.baby_nursery} 名</span>
        <span class="badge green">親子同室 ${d.baby_rooming} 名</span>
      </div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>寶寶</th><th>目前位置</th><th>最後餵食</th><th>今日餵食</th><th>尿布</th><th>最後體溫</th></tr></thead>
          <tbody>${babyRows}</tbody>
        </table>
      </div>` : '<div class="empty">目前無在住寶寶</div>'}
    </div>
    <div class="card">
      <h3>今日膳食</h3>
      <div class="row">${d.mothers_in_house ? mealBadges : '<span class="empty">今日無在住媽媽</span>'}</div>
    </div>
    <div class="card">
      <h3>今日異常警示</h3>
      <ul class="timeline">${alerts}</ul>
    </div>
    <div class="card">
      <h3>今日人力比檢核（每 ${d.staffing.ratio} 名嬰兒至少 1 名護理人員，現有 ${d.staffing.babies} 名嬰兒）</h3>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>班別</th><th>排班人數</th><th>法定需求</th><th>狀態</th></tr></thead>
          <tbody>${shiftRows}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>近 30 天入住率趨勢 (%)</h3>
      ${svgLineChart(d.occupancy_trend, { unit: '%' })}
    </div>`;
  ocWireLinks(main());
  loadNursingReminders('#dash-nr');
}

/* ---------- 總覽整合行事曆：參觀／課程／服務／入住／退住 ---------- */
const OC_TYPES = [
  ['tour', '參觀', '#e0762f'],
  ['visitor', '訪客', '#7b5ea7'],
  ['course', '課程', '#2a9d8f'],
  ['service', '服務', '#8a94a6'],
  ['checkin', '入住', '#3d8b57'],
  ['checkout', '退住', '#c0504d']
];
const OC_COLOR = Object.fromEntries(OC_TYPES.map(t => [t[0], t[2]]));
const OC_LABEL = Object.fromEntries(OC_TYPES.map(t => [t[0], t[1]]));
function ocItemHtml(ev) {
  const text = (ev.type === 'checkin' || ev.type === 'checkout')
    ? `${OC_LABEL[ev.type]} ${ev.title}`
    : `${ev.time ? ev.time + ' ' : ''}${ev.title}`;
  const tip = `${OC_LABEL[ev.type]}｜${ev.title}${ev.detail ? '｜' + ev.detail : ''}${ev.time ? '｜' + ev.time : ''}`;
  const clickable = ev.link && canAccess(ev.link);
  return `<div class="pc-item" title="${esc(tip)}" ${clickable ? `data-oc-link="${esc(ev.link)}" style="cursor:pointer"` : 'style="cursor:default"'}>
    <span class="dot" style="background:${OC_COLOR[ev.type]}"></span>${esc(text.length > 12 ? text.slice(0, 12) + '…' : text)}</div>`;
}
function ocLegendHtml(types) {
  return OC_TYPES.filter(t => !types || types.includes(t[0]))
    .map(t => `<span style="white-space:nowrap"><span class="dot" style="background:${t[2]}"></span>${t[1]}</span>`).join('　');
}
function ocWireLinks(root) {
  root.querySelectorAll('[data-oc-link]').forEach(el => el.onclick = () => { location.hash = el.dataset.ocLink; });
}
let _ocState = null;
async function viewOverviewCalendar() {
  if (!_ocState) _ocState = { mode: 'month', anchor: todayStr(), types: Object.fromEntries(OC_TYPES.map(t => [t[0], true])) };
  const st = _ocState;
  const fmtD = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const anchor = parse(st.anchor);
  let gridStart, nDays, title;
  if (st.mode === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7)); // 週一起
    nDays = 42; title = `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`;
  } else {
    gridStart = new Date(anchor); gridStart.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
    const end = new Date(gridStart); end.setDate(gridStart.getDate() + 6);
    nDays = 7; title = `${fmtD(gridStart)} ~ ${fmtD(end)}`;
  }
  const cal = await api(`/overview-calendar?start=${fmtD(gridStart)}&days=${nDays}`);
  const counts = {};
  for (const ev of cal.events) counts[ev.type] = (counts[ev.type] || 0) + 1;
  const shown = cal.events.filter(ev => st.types[ev.type]);
  const byDate = {};
  shown.forEach(ev => { (byDate[ev.date] = byDate[ev.date] || []).push(ocItemHtml(ev)); });
  const dayCell = (d) => {
    const key = fmtD(d);
    const isToday = key === todayStr();
    const dim = st.mode === 'month' && d.getMonth() !== anchor.getMonth();
    return `<td class="pc-day${isToday ? ' pc-today' : ''}" style="vertical-align:top;height:88px;min-width:90px${dim ? ';opacity:.45' : ''}">
      <div style="font-size:.8rem;color:var(--muted)">${d.getDate()}</div>${(byDate[key] || []).join('')}</td>`;
  };
  let grid = '';
  for (let w = 0; w < nDays / 7; w++) {
    let tds = '';
    for (let i = 0; i < 7; i++) { const d = new Date(gridStart); d.setDate(gridStart.getDate() + w * 7 + i); tds += dayCell(d); }
    grid += `<tr>${tds}</tr>`;
  }
  const wk = ['一', '二', '三', '四', '五', '六', '日'];
  const chips = OC_TYPES.map(([k, label, color]) => `
    <label style="white-space:nowrap;cursor:pointer">
      <input type="checkbox" data-oc-type="${k}" ${st.types[k] ? 'checked' : ''}>
      <span class="dot" style="background:${color}"></span>${label}${counts[k] ? ` ${counts[k]}` : ''}</label>`).join('　');
  main().innerHTML = `
    <div class="page-title">整合行事曆</div>
    <div class="card no-print">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div class="row" style="gap:6px">
          <button class="btn small secondary" id="oc-prev">‹ 上一${st.mode === 'month' ? '月' : '週'}</button>
          <button class="btn small secondary" id="oc-today">今天</button>
          <button class="btn small secondary" id="oc-next">下一${st.mode === 'month' ? '月' : '週'} ›</button>
          <strong style="align-self:center;margin-left:8px">${title}</strong>
        </div>
        <div class="row" style="gap:6px">
          <button class="btn small ${st.mode === 'month' ? '' : 'secondary'}" id="oc-month">月</button>
          <button class="btn small ${st.mode === 'week' ? '' : 'secondary'}" id="oc-week">週</button>
        </div>
      </div>
      <div class="row" style="gap:4px;flex-wrap:wrap;margin-top:6px">${chips}</div>
      <small style="color:var(--muted)">彙整參觀預約、課程與服務、入住與退住；點事件可跳到對應頁面（唯讀，編輯請至各模組）</small>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="data pc-cal"><thead><tr>${wk.map(w => `<th style="text-align:center">週${w}</th>`).join('')}</tr></thead>
          <tbody>${grid}</tbody></table>
      </div>
    </div>
    <style>
      .pc-cal td.pc-day{border:1px solid var(--border);padding:3px}
      .pc-cal td.pc-today{background:#eef6f0}
      .pc-item{font-size:.72rem;background:#f0f4f8;border-radius:4px;padding:1px 4px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:3px;vertical-align:middle}
    </style>`;
  const shift = (n) => {
    const a = parse(st.anchor);
    if (st.mode === 'month') a.setMonth(a.getMonth() + n); else a.setDate(a.getDate() + n * 7);
    st.anchor = fmtD(a); viewOverviewCalendar();
  };
  $('#oc-prev').onclick = () => shift(-1);
  $('#oc-next').onclick = () => shift(1);
  $('#oc-today').onclick = () => { st.anchor = todayStr(); viewOverviewCalendar(); };
  $('#oc-month').onclick = () => { st.mode = 'month'; viewOverviewCalendar(); };
  $('#oc-week').onclick = () => { st.mode = 'week'; viewOverviewCalendar(); };
  main().querySelectorAll('[data-oc-type]').forEach(cb => cb.onchange = () => {
    st.types[cb.dataset.ocType] = cb.checked; viewOverviewCalendar();
  });
  ocWireLinks(main());
}

/* ---------- 訪客預約（護理站） ---------- */
const VR_STATUS = { booked: ['已預約', 'yellow'], arrived: ['已報到', 'green'], cancelled: ['已取消', 'gray'] };
let _vrState = null;
async function viewVisitorReservations() {
  if (!_vrState) _vrState = { from: todayStr(), to: '', status: '', q: '' };
  const st = _vrState;
  const qs = new URLSearchParams();
  if (st.from) qs.set('from', st.from);
  if (st.to) qs.set('to', st.to);
  if (st.status) qs.set('status', st.status);
  if (st.q) qs.set('q', st.q);
  const rows = await api(`/visitor-reservations?${qs}`);
  const isAdmin = currentUser.role === 'admin';
  const trs = rows.map(v => {
    const [label, color] = VR_STATUS[v.status] || ['-', 'gray'];
    return `<tr>
      <td data-label="探訪時間">${esc(v.visit_at)}</td>
      <td data-label="媽媽">${esc(v.mother_name)}${v.room_name ? `（${esc(v.room_name)}）` : ''}</td>
      <td data-label="訪客">${esc(v.visitor_name)}${v.relation ? `　<small>${esc(v.relation)}</small>` : ''}</td>
      <td data-label="電話">${esc(v.phone || '-')}</td>
      <td data-label="人數">${v.headcount}</td>
      <td data-label="登記">${v.family_name ? `家屬 ${esc(v.family_name)}` : '護理站'}</td>
      <td data-label="狀態"><span class="badge ${color}">${label}</span></td>
      <td data-label="備註">${esc(v.note || '')}</td>
      <td data-label="操作"><div class="row" style="gap:4px;flex-wrap:wrap">
        ${v.status === 'booked' ? `<button class="btn small" data-vr-arrive="${v.id}">報到</button>
          <button class="btn small secondary" data-vr-cancel="${v.id}">取消</button>` : ''}
        <button class="btn small secondary" data-vr-edit="${v.id}">編輯</button>
        ${isAdmin ? `<button class="btn small danger" data-vr-del="${v.id}">刪除</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
  main().innerHTML = `
    <div class="page-title">訪客預約</div>
    <div class="card no-print">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div class="field"><label>日期起</label><input type="date" id="vr-from" value="${st.from}"></div>
        <div class="field"><label>日期迄</label><input type="date" id="vr-to" value="${st.to}"></div>
        <div class="field"><label>狀態</label><select id="vr-status">
          <option value="">全部</option>
          ${Object.entries(VR_STATUS).map(([k, [label]]) => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${label}</option>`).join('')}
        </select></div>
        <div class="field"><label>關鍵字（訪客／媽媽／電話）</label><input id="vr-q" value="${esc(st.q)}"></div>
        <button class="btn small" id="vr-search">查詢</button>
        <button class="btn small secondary" id="vr-clear">清除</button>
        <span class="spacer"></span>
        <button class="btn small" id="vr-add">新增訪客預約</button>
      </div>
      <small style="color:var(--muted)">家屬可在家屬入口登記，本頁彙整全部；探訪當日按「報到」。共 ${rows.length} 筆</small>
    </div>
    <div class="card">
      ${rows.length ? `<div class="table-wrap"><table class="data stack">
        <thead><tr><th>探訪時間</th><th>媽媽</th><th>訪客</th><th>電話</th><th>人數</th><th>登記</th><th>狀態</th><th>備註</th><th>操作</th></tr></thead>
        <tbody>${trs}</tbody></table></div>` : '<div class="empty">查無訪客預約</div>'}
    </div>`;
  const refresh = () => viewVisitorReservations();
  $('#vr-search').onclick = () => {
    st.from = $('#vr-from').value; st.to = $('#vr-to').value;
    st.status = $('#vr-status').value; st.q = $('#vr-q').value.trim(); refresh();
  };
  $('#vr-q').onkeydown = e => { if (e.key === 'Enter') $('#vr-search').click(); };
  $('#vr-clear').onclick = () => { _vrState = { from: '', to: '', status: '', q: '' }; refresh(); };
  $('#vr-add').onclick = () => openVisitorForm(null, refresh);
  main().querySelectorAll('[data-vr-edit]').forEach(b => b.onclick = () =>
    openVisitorForm(rows.find(v => v.id == b.dataset.vrEdit), refresh));
  main().querySelectorAll('[data-vr-arrive]').forEach(b => b.onclick = async () => {
    try { await api(`/visitor-reservations/${b.dataset.vrArrive}`, { method: 'PUT', body: { status: 'arrived' } }); refresh(); }
    catch (e) { alert(e.message); }
  });
  main().querySelectorAll('[data-vr-cancel]').forEach(b => b.onclick = async () => {
    if (!confirm('確定取消此筆訪客預約？')) return;
    try { await api(`/visitor-reservations/${b.dataset.vrCancel}`, { method: 'PUT', body: { status: 'cancelled' } }); refresh(); }
    catch (e) { alert(e.message); }
  });
  main().querySelectorAll('[data-vr-del]').forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除？刪除後無法復原')) return;
    try { await api(`/visitor-reservations/${b.dataset.vrDel}`, { method: 'DELETE' }); refresh(); }
    catch (e) { alert(e.message); }
  });
}
async function openVisitorForm(v, onSaved) {
  const ed = v || {};
  const mothers = await api('/mothers');
  const opts = mothers.filter(m => m.status !== 'checked_out' || m.id === ed.mother_id)
    .map(m => `<option value="${m.id}" ${ed.mother_id === m.id ? 'selected' : ''}>${esc(m.name)}${m.room_name ? `（${esc(m.room_name)}）` : ''}</option>`).join('');
  // 與家屬端一致：人數連動姓名欄、選日期帶出可預約空檔（13~18 整點、各樓層每小時限 2 組）
  const edNames = String(ed.visitor_name || '').split('、').map(s => s.trim()).filter(Boolean);
  const edDate = (ed.visit_at || '').slice(0, 10);
  const edTime = (ed.visit_at || '').slice(11, 16);
  openModal(ed.id ? '編輯訪客預約' : '登記訪客', `
    <div class="form-grid">
      <div class="field"><label>媽媽 *</label><select id="vf-mother" ${ed.id ? 'disabled' : ''}><option value="">請選擇</option>${opts}</select></div>
      <div class="field"><label>人數<small>（每組限 4 人）</small></label>
        <select id="vf-count">${[1, 2, 3, 4].map(n => `<option ${n === Math.min(Math.max(edNames.length, ed.headcount || 1), 4) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="full" id="vf-names"></div>
      <div class="field"><label>與媽媽關係</label><input id="vf-rel" value="${esc(ed.relation || '')}" placeholder="例如：先生、婆婆"></div>
      <div class="field"><label>聯絡電話</label><input id="vf-phone" value="${esc(ed.phone || '')}" inputmode="tel"></div>
      <div class="field"><label>探訪日期 *</label><input type="date" id="vf-date" value="${esc(edDate)}"></div>
      <div class="field"><label>探訪時間 *<small>（選媽媽與日期後帶出空檔）</small></label>
        <select id="vf-time"><option value="">請先選擇媽媽與日期</option></select></div>
      <div class="field full" id="vf-slot-msg" style="font-size:.84rem;color:var(--muted)"></div>
      <div class="field full"><label>備註</label><input id="vf-note" value="${esc(ed.note || '')}"></div>
      <div class="full row"><button class="btn" id="vf-save">${ed.id ? '儲存' : '送出預約'}</button><span class="error-msg" id="vf-err"></span></div>
    </div>`, body => {
    const el = id => body.querySelector(id);
    // 人數連動姓名欄
    const renderNames = () => {
      const n = Number(el('#vf-count').value) || 1;
      el('#vf-names').innerHTML = `<div class="form-grid" style="margin:0">${Array.from({ length: n }, (_, i) => `
        <div class="field"><label>訪客姓名 ${n > 1 ? i + 1 : ''} *</label><input data-vf-name value="${esc(edNames[i] || '')}"></div>`).join('')}</div>`;
    };
    el('#vf-count').onchange = renderNames;
    renderNames();
    // 選媽媽＋日期 → 帶出該樓層可預約空檔（護理站可代選已額滿時段以外的整點）
    const loadSlots = async () => {
      const mid = Number(el('#vf-mother').value) || ed.mother_id || 0;
      const date = el('#vf-date').value;
      const sel = el('#vf-time'), msg = el('#vf-slot-msg');
      if (!mid || !date) { sel.innerHTML = '<option value="">請先選擇媽媽與日期</option>'; msg.textContent = ''; return; }
      sel.innerHTML = '<option value="">載入空檔中…</option>';
      try {
        const r = await api(`/visitor-slots?mother_id=${mid}&date=${date}`);
        const keepCur = ed.id && edDate === date && edTime && !r.slots.some(s => s.time === edTime);
        sel.innerHTML = '<option value="">請選擇時段</option>'
          + r.slots.map(s => `<option value="${s.time}" ${s.available || (ed.id && s.time === edTime) ? '' : 'disabled'} ${s.time === edTime && edDate === date ? 'selected' : ''}>${s.time}${s.available ? `（尚可預約 ${s.left} 組）` : '（已額滿）'}</option>`).join('')
          + (keepCur ? `<option value="${esc(edTime)}" selected>${esc(edTime)}（原時間）</option>` : '');
        msg.textContent = `該媽媽本週已預約 ${r.quota_used}／${r.quota_max} 次（週一至週日）${r.floor ? `・會客地點：${r.floor} 當層會客室` : ''}`;
      } catch (e) { sel.innerHTML = '<option value="">載入失敗</option>'; msg.textContent = e.message; }
    };
    el('#vf-mother').onchange = loadSlots;
    el('#vf-date').onchange = loadSlots;
    if ((ed.mother_id || el('#vf-mother').value) && edDate) loadSlots();
    el('#vf-save').onclick = async () => {
      el('#vf-err').textContent = '';
      const names = [...body.querySelectorAll('[data-vf-name]')].map(i => i.value.trim());
      if (names.some(x => !x)) { el('#vf-err').textContent = '請填寫每一位訪客姓名'; return; }
      const date = el('#vf-date').value, time = el('#vf-time').value;
      if (!date || !time) { el('#vf-err').textContent = '請選擇探訪日期與時段'; return; }
      const payload = {
        visitor_name: names.join('、'), relation: el('#vf-rel').value.trim(),
        phone: el('#vf-phone').value.trim(), headcount: names.length,
        visit_at: `${date} ${time}`, note: el('#vf-note').value.trim()
      };
      if (!ed.id) payload.mother_id = Number(el('#vf-mother').value) || 0;
      try {
        if (ed.id) await api(`/visitor-reservations/${ed.id}`, { method: 'PUT', body: payload });
        else await api('/visitor-reservations', { method: 'POST', body: payload });
        closeModal(); (onSaved || viewVisitorReservations)();
      } catch (e) { el('#vf-err').textContent = e.message; }
    };
  });
}

/* ---------- 寶寶日報：摘要 / 異常 / 列印 ---------- */
function babyReportAlerts(alerts) {
  if (!alerts || !alerts.length) return '';
  return `<div class="card" style="background:#fdecea;border-left:4px solid var(--danger);padding:10px 12px;margin-bottom:12px">
    <strong style="color:var(--danger)">⚠ 異常提醒</strong>
    <ul style="margin:6px 0 0;padding-left:18px">${alerts.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>`;
}
function babyReportSummaryGrid(s, photoCount) {
  const items = [
    [`${s.feed_count} 次`, '餵食次數'],
    [`${s.feed_total_ml} ml`, '瓶餵總量'],
    [`濕 ${s.diaper_wet} / 便 ${s.diaper_stool}`, '尿布'],
    [`${s.rash_worst ?? '未評估'}`, '紅臀'],
    [`${s.temp_latest ?? '-'}`, '最新體溫 (°C)'],
    [`${s.weight_latest_g ?? '-'}`, '體重 (g)'],
    [`${s.jaundice_latest ?? '-'}`, '黃疸 (mg/dL)']
  ];
  // 擴充項目：有記錄才顯示，避免空白塞滿版面
  if (s.respiration_latest != null) items.push([`${s.respiration_latest} 次/分`, '呼吸']);
  if (s.heart_rate_latest != null) items.push([`${s.heart_rate_latest} bpm`, '心跳']);
  if (s.spo2_latest != null) items.push([`${s.spo2_latest}%`, '血氧']);
  if (s.length_latest != null) items.push([`${s.length_latest} cm`, '身長']);
  if (s.head_circ_latest != null) items.push([`${s.head_circ_latest} cm`, '頭圍']);
  if (s.sleep_count) items.push([`${s.sleep_count} 次`, '睡眠紀錄']);
  if (s.skin_latest) items.push([esc(s.skin_latest), '膚色']);
  if (s.activity_latest) items.push([esc(s.activity_latest), '活動力']);
  if (s.stool_latest) items.push([esc(s.stool_latest), '大便性狀']);
  if (s.vomit_latest) items.push([esc(s.vomit_latest), '溢吐奶']);
  if (s.cord_latest) items.push([esc(s.cord_latest), '臍帶']);
  items.push([`${s.bath_done ? '已完成' : '未安排'}`, '沐浴']);
  if (photoCount != null) items.push([`${photoCount} 張`, '今日照片']);
  return `<div class="summary-grid" style="margin-bottom:14px">${items.map(([v, k]) =>
    `<div class="item"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')}</div>`;
}
// 另開視窗列印／另存 PDF：寶寶日報（摘要＋異常＋當日紀錄＋照片）
function printBabyReport(rpt) {
  const center = (SETTINGS && SETTINGS.center_name) || 'MamaCare';
  const s = rpt.summary;
  const row = (k, v) => v == null || v === '' ? '' : `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`;
  const summaryRows = [
    row('餵食次數', `${s.feed_count} 次`), row('瓶餵總量', `${s.feed_total_ml} ml`),
    row('尿布', `濕 ${s.diaper_wet} / 便 ${s.diaper_stool}`), row('紅臀', s.rash_worst ?? '未評估'),
    row('最新體溫', s.temp_latest != null ? `${s.temp_latest} °C` : ''),
    row('體重', s.weight_latest_g != null ? `${s.weight_latest_g} g` : ''),
    row('黃疸', s.jaundice_latest != null ? `${s.jaundice_latest} mg/dL` : ''),
    row('呼吸', s.respiration_latest != null ? `${s.respiration_latest} 次/分` : ''),
    row('心跳', s.heart_rate_latest != null ? `${s.heart_rate_latest} bpm` : ''),
    row('血氧', s.spo2_latest != null ? `${s.spo2_latest}%` : ''),
    row('身長', s.length_latest != null ? `${s.length_latest} cm` : ''),
    row('頭圍', s.head_circ_latest != null ? `${s.head_circ_latest} cm` : ''),
    row('膚色', s.skin_latest), row('活動力', s.activity_latest), row('大便性狀', s.stool_latest),
    row('溢吐奶', s.vomit_latest), row('臍帶', s.cord_latest),
    row('沐浴', s.bath_done ? '已完成' : '未安排')
  ].join('');
  const recs = (rpt.records || []).filter(r => r.record_type !== 'photo').map(r => `
    <tr><td>${esc((r.recorded_at || '').slice(11, 16))}</td><td>${esc(BABY_TYPE_LABEL[r.record_type] || r.record_type)}</td>
    <td>${esc(babyRecordDetail(r))}</td><td>${esc(r.nurse_name || '')}</td></tr>`).join('')
    || '<tr><td colspan="4" style="text-align:center;color:#888">本日無紀錄</td></tr>';
  const alerts = (rpt.alerts && rpt.alerts.length)
    ? `<div class="alert"><strong>⚠ 異常提醒：</strong>${rpt.alerts.map(esc).join('；')}</div>` : '';
  const photos = (rpt.photos || []).map(p => `<img src="${location.origin}/uploads/${esc(p.photo_file)}" style="max-width:160px;max-height:160px;margin:4px;border:1px solid #ddd">`).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">
    <title>寶寶日報 - ${esc(rpt.baby.name)} ${esc(rpt.date)}</title>
    <style>
      body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#1c2b29;line-height:1.6;max-width:760px;margin:24px auto;padding:0 24px}
      h1{font-size:20px;margin:0 0 2px;color:#b03060} .sub{color:#666;font-size:13px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px}
      th,td{border:1px solid #ccc;padding:5px 8px;text-align:left} th{background:#f2f7f6}
      h3{font-size:15px;margin:14px 0 6px;color:#9c2b58}
      .alert{background:#fdecea;border-left:4px solid #d9534f;padding:8px 12px;margin-bottom:12px;color:#a33}
      @media print{.noprint{display:none}}
    </style></head><body>
    <h1>${esc(center)}　寶寶日報</h1>
    <div class="sub">${esc(rpt.baby.name)}　媽媽：${esc(rpt.baby.mother_name || '')}　日期：${esc(rpt.date)}</div>
    ${alerts}
    <h3>今日摘要</h3>
    <table><tbody>${summaryRows}</tbody></table>
    <h3>當日紀錄</h3>
    <table><thead><tr><th>時間</th><th>項目</th><th>內容</th><th>護理師</th></tr></thead><tbody>${recs}</tbody></table>
    ${photos ? `<h3>今日照片</h3><div>${photos}</div>` : ''}
    <div class="noprint" style="margin-top:24px;text-align:center"><button onclick="window.print()" style="padding:10px 24px;font-size:15px">列印 / 另存 PDF</button></div>
    </body></html>`);
  win.document.close();
}

// 巡房批次記錄：一次記錄多位在住寶寶的體溫與餵食，減少逐位切換
function openBatchRound(babies, onSaved) {
  if (!babies.length) { openModal('巡房批次', '<div class="empty">目前沒有在住寶寶</div>'); return; }
  const feeds = feedMethods();
  const rows = babies.map(b => `
    <tr>
      <td data-label="寶寶">${esc(b.name)}<br><small>${esc(b.mother_name)}</small></td>
      <td data-label="體溫"><input type="number" step="0.1" inputmode="decimal" id="br-temp-${b.id}" style="width:78px" placeholder="°C"></td>
      <td data-label="餵食方式"><select id="br-fm-${b.id}"><option value="">—</option>${feeds.map(f => `<option>${esc(f)}</option>`).join('')}</select></td>
      <td data-label="餵食量"><input type="number" inputmode="numeric" id="br-ml-${b.id}" style="width:70px" placeholder="ml"></td>
    </tr>`).join('');
  openModal('巡房批次記錄', `
    <p style="font-size:.82rem;color:var(--muted)">一次記錄多位在住寶寶的體溫與餵食；留空的欄位不建立紀錄。體溫超標會照常觸發異常警示。</p>
    <div class="table-wrap"><table class="data stack">
      <thead><tr><th>寶寶</th><th>體溫</th><th>餵食方式</th><th>餵食量</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="row mt"><button class="btn" id="br-save">儲存全部</button><span class="error-msg" id="br-err"></span></div>`, body => {
    body.querySelector('#br-save').onclick = async () => {
      const posts = [];
      for (const b of babies) {
        const temp = body.querySelector(`#br-temp-${b.id}`).value.trim();
        if (temp) posts.push([b.id, { record_type: 'temperature', value_num: Number(temp) }]);
        const fm = body.querySelector(`#br-fm-${b.id}`).value;
        const ml = body.querySelector(`#br-ml-${b.id}`).value.trim();
        if (fm) posts.push([b.id, { record_type: 'feeding', feed_method: fm, amount_ml: ml ? Number(ml) : null }]);
      }
      if (!posts.length) { body.querySelector('#br-err').textContent = '請至少填寫一項'; return; }
      try {
        await api('/baby-records/batch', { method: 'POST', body: { records: posts.map(([id, rec]) => ({ baby_id: id, ...rec })) } });
        closeModal(); onSaved && onSaved();
      } catch (e) { body.querySelector('#br-err').textContent = e.message; }
    };
  });
}

/* ---------- 寶寶照護 ---------- */
async function viewBabyCare() {
  const babies = await api('/babies');
  const inHouse = babies.filter(b => b.mother_status === 'checked_in');
  const list = inHouse.length ? inHouse : babies;
  const options = list.map(b =>
    `<option value="${b.id}">${esc(b.name)}（媽媽：${esc(b.mother_name)}）</option>`).join('');

  main().innerHTML = `
    <div class="page-title">寶寶照護</div>
    <div class="card">
      <div class="form-grid">
        <div class="field">
          <label>選擇寶寶</label>
          <select id="bc-baby">${options || '<option value="">尚無寶寶資料</option>'}</select>
        </div>
        <div class="field">
          <label>日期</label>
          <input type="date" id="bc-date" value="${todayStr()}">
        </div>
      </div>
      <div class="row mt">
        <button class="btn" id="bc-add">新增紀錄</button>
        <button class="btn secondary" id="bc-round">巡房批次</button>
        <button class="btn secondary" id="bc-photo">上傳照片</button>
        <button class="btn secondary" id="bc-report">寶寶日報</button>
        <button class="btn secondary" id="bc-mar">給藥紀錄</button>
        <button class="btn" id="bc-send" style="background:var(--accent)">發送日報給家屬</button>
      </div>
      <div class="row mt">
        <span style="font-size:.85rem;color:var(--muted)">一鍵記錄：</span>
        <button class="btn small secondary" data-quick="wet">濕尿布</button>
        <button class="btn small secondary" data-quick="stool">大便</button>
        <button class="btn small secondary" data-quick="bath">沐浴完成</button>
        <button class="btn small" id="bc-quickfeed">餵奶</button>
        <button class="btn small secondary" id="bc-cord">臍帶掉落</button>
      </div>
      <div class="row mt" id="bc-loc"></div>
      <div class="ok-msg" id="bc-msg"></div>
    </div>
    <div class="card">
      <h3>當日紀錄</h3>
      <div id="bc-list"><div class="empty">載入中</div></div>
    </div>`;

  const babyById = id => list.find(b => String(b.id) === String(id));

  // 寶寶位置（嬰兒室／親子同室）切換與異動紀錄
  const showLocLogs = async (baby) => {
    const logs = await api(`/babies/${baby.id}/location-logs`);
    openModal(`${esc(baby.name)} 位置異動紀錄`, logs.length
      ? `<ul class="timeline">${logs.map(l => `
        <li>
          <div class="time">${fmtTime(l.moved_at)}　${esc(l.nurse_name || '')}</div>
          <div class="what"><span class="badge ${LOCATION_BADGE[l.location]}">移至 ${LOCATION_LABEL[l.location]}</span>
            ${l.note ? `<span style="font-weight:400">　${esc(l.note)}</span>` : ''}</div>
        </li>`).join('')}</ul>`
      : '<div class="empty">尚無位置異動紀錄</div>');
  };

  const renderLoc = () => {
    const bar = $('#bc-loc');
    if (!bar) return;
    const baby = babyById($('#bc-baby').value);
    if (!baby) { bar.innerHTML = ''; return; }
    const loc = baby.location || 'nursery';
    // 快速切換：嬰兒室／親子同室／不在館內／住院中（住院中／不在館內會帶入收費帳務扣抵）
    const MOVE_BTN = { nursery: '抱回嬰兒室', rooming: '抱去給媽媽（親子同室）', out: '不在館內', hospital: '住院中' };
    bar.innerHTML = `
      <span style="font-size:.85rem;color:var(--muted)">目前位置：</span>
      <span class="badge ${LOCATION_BADGE[loc]}">${LOCATION_LABEL[loc]}</span>
      ${Object.keys(MOVE_BTN).filter(l => l !== loc).map(l =>
        `<button class="btn small ${l === 'nursery' || l === 'rooming' ? '' : 'secondary'}" data-move="${l}">${MOVE_BTN[l]}</button>`).join('')}
      <button class="btn small secondary" id="bc-loc-log">位置異動紀錄</button>`;
    bar.querySelectorAll('[data-move]').forEach(btn => {
      btn.onclick = async () => {
        const target = btn.dataset.move;
        const note = prompt(`確認將「${baby.name}」移至「${LOCATION_LABEL[target]}」，可填備註（可留空）`, '');
        if (note === null) return;
        await api(`/babies/${baby.id}/location`, { method: 'PUT', body: { location: target, note } });
        baby.location = target;
        const msg = $('#bc-msg');
        if (msg) {
          msg.textContent = `已將 ${baby.name} 移至 ${LOCATION_LABEL[target]}`;
          setTimeout(() => { const el = $('#bc-msg'); if (el) el.textContent = ''; }, 2500);
        }
        renderLoc();
      };
    });
    $('#bc-loc-log').onclick = () => showLocLogs(baby);
  };

  // 臍帶掉落：一次性；已登記則停用按鈕
  const updateCordBtn = () => {
    const btn = $('#bc-cord'); if (!btn) return;
    const baby = babyById($('#bc-baby').value);
    if (baby && baby.cord_off_at) {
      btn.disabled = true;
      btn.textContent = `臍帶已掉落（${String(baby.cord_off_at).slice(5, 10)}）`;
    } else {
      btn.disabled = false;
      btn.textContent = '臍帶掉落';
    }
  };

  const refresh = async () => {
    renderLoc();
    updateCordBtn();
    const babyId = $('#bc-baby').value;
    if (!babyId) { $('#bc-list').innerHTML = '<div class="empty">尚無寶寶資料</div>'; return; }
    const rows = await api(`/babies/${babyId}/records?date=${$('#bc-date').value}`);
    if (!rows.length) { $('#bc-list').innerHTML = '<div class="empty">當日尚無紀錄</div>'; return; }
    $('#bc-list').innerHTML = `<ul class="timeline">${rows.map(r => `
      <li>
        <div class="time">${fmtTime(r.recorded_at)}　${esc(r.nurse_name || '')}
          ${r.edited_at ? `<span class="badge gray" title="最後修改：${esc(r.edited_at)}">已修改</span>` : ''}
          <span style="float:right">
            ${r.record_type !== 'photo' ? `<button class="btn small secondary" data-edit="${r.id}">編輯</button>` : ''}
            ${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${r.id}">刪除</button>` : ''}
          </span>
        </div>
        <div class="what">${BABY_TYPE_LABEL[r.record_type] || r.record_type}
          <span style="font-weight:400">${esc(babyRecordDetail(r))}</span>
          ${r.location ? `<span class="badge ${LOCATION_BADGE[r.location]}" style="font-weight:400">${LOCATION_LABEL[r.location]}</span>` : ''}</div>
        ${r.photo_file ? `<img src="/uploads/${esc(r.photo_file)}" style="max-width:180px;border-radius:8px;margin-top:6px">` : ''}
        ${r.note ? `<div class="detail">${esc(r.note)}</div>` : ''}
      </li>`).join('')}</ul>`;
    $('#bc-list').querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('確定刪除這筆紀錄？')) return;
        await api(`/baby-records/${btn.dataset.del}`, { method: 'DELETE' });
        refresh();
      };
    });
    $('#bc-list').querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = () => openBabyRecordEdit(rows.find(x => x.id == btn.dataset.edit), refresh);
    });
  };

  $('#bc-baby').onchange = refresh;
  $('#bc-date').onchange = refresh;

  main().querySelectorAll('[data-quick]').forEach(btn => {
    btn.onclick = async () => {
      const babyId = $('#bc-baby').value;
      if (!babyId) return;
      const presets = {
        wet: { record_type: 'diaper', diaper_kind: '濕' },
        stool: { record_type: 'diaper', diaper_kind: '便' },
        bath: { record_type: 'bath' }
      };
      await api(`/babies/${babyId}/records`, { method: 'POST', body: presets[btn.dataset.quick] });
      $('#bc-msg').textContent = '已記錄';
      setTimeout(() => { const el = $('#bc-msg'); if (el) el.textContent = ''; }, 1500);
      refresh();
    };
  });

  $('#bc-round').onclick = () => openBatchRound(list.filter(b => b.mother_status === 'checked_in'), refresh);

  // 給藥紀錄：跳出 MAR 視窗（同新生兒醫療分頁），＋給藥儲存後自動關閉
  $('#bc-mar').onclick = () => {
    const babyId = $('#bc-baby').value; if (!babyId) return;
    const baby = babyById(babyId);
    openBabyMar(babyId, baby ? baby.name : '');
  };

  // 臍帶掉落：一次性事件，確認後登記並停用按鈕
  $('#bc-cord').onclick = async () => {
    const babyId = $('#bc-baby').value; if (!babyId) return;
    const baby = babyById(babyId);
    if (baby && baby.cord_off_at) return;
    if (!confirm(`確認登記「${baby ? baby.name : '寶寶'}」臍帶掉落？此紀錄只能登記一次。`)) return;
    try {
      const r = await api(`/babies/${babyId}/cord-off`, { method: 'POST', body: {} });
      if (baby) baby.cord_off_at = r.cord_off_at;
      $('#bc-msg').textContent = '已登記臍帶掉落';
      setTimeout(() => { const el = $('#bc-msg'); if (el) el.textContent = ''; }, 1500);
      refresh();
    } catch (e) { alert(e.message); }
  };

  // 餵奶一鍵快速記錄：精簡輸入（方式＋奶量／親餵左右分鐘）
  $('#bc-quickfeed').onclick = () => {
    const babyId = $('#bc-baby').value;
    if (!babyId) return;
    const feeds = feedMethods();
    openModal('快速餵奶紀錄', `
      <div class="field"><label>餵食方式</label><select id="qf-method">${feeds.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
      <div class="field"><label>奶量 (ml)<small>（瓶餵）</small></label><input type="number" min="0" id="qf-ml" inputmode="numeric"></div>
      <div class="field"><label>親餵分鐘（左／右）</label>
        <div class="row" style="gap:6px;align-items:center">左 <input type="number" min="0" id="qf-lmin" inputmode="numeric" style="width:70px"> 分　右 <input type="number" min="0" id="qf-rmin" inputmode="numeric" style="width:70px"> 分</div></div>
      <div class="field"><label>備註</label><input id="qf-note"></div>
      <div class="row mt"><button class="btn" id="qf-save">記錄</button><span class="error-msg" id="qf-err"></span></div>`, body => {
      body.querySelector('#qf-save').onclick = async () => {
        try {
          await api(`/babies/${babyId}/records`, { method: 'POST', body: {
            record_type: 'feeding', feed_method: body.querySelector('#qf-method').value,
            amount_ml: Number(body.querySelector('#qf-ml').value) || null,
            feed_left_min: body.querySelector('#qf-lmin').value, feed_right_min: body.querySelector('#qf-rmin').value,
            note: body.querySelector('#qf-note').value.trim()
          } });
          closeModal(); $('#bc-msg').textContent = '已記錄餵奶';
          setTimeout(() => { const el = $('#bc-msg'); if (el) el.textContent = ''; }, 1500);
          refresh();
        } catch (e) { body.querySelector('#qf-err').textContent = e.message; }
      };
    });
  };

  $('#bc-add').onclick = () => {
    const babyId = $('#bc-baby').value;
    if (!babyId) return;
    openModal('新增寶寶照護紀錄', `
      <div class="form-grid">
        <div class="field full">
          <label>紀錄類型</label>
          <select id="nr-type">
            <optgroup label="日常照護">${['feeding', 'diaper', 'bath', 'sleep', 'note']
              .map(t => `<option value="${t}">${BABY_TYPE_LABEL[t]}</option>`).join('')}</optgroup>
            <optgroup label="生命徵象">${['temperature', 'respiration', 'heart_rate', 'spo2']
              .map(t => `<option value="${t}">${BABY_TYPE_LABEL[t]}</option>`).join('')}</optgroup>
            <optgroup label="生長測量">${['weight', 'length', 'head_circ', 'jaundice']
              .map(t => `<option value="${t}">${BABY_TYPE_LABEL[t]}</option>`).join('')}</optgroup>
            <optgroup label="觀察評估">${['skin', 'cord', 'vomit', 'activity', 'stool']
              .map(t => `<option value="${t}">${BABY_TYPE_LABEL[t]}</option>`).join('')}</optgroup>
          </select>
        </div>
        <div class="field" id="nr-text-wrap" hidden>
          <label id="nr-text-label">觀察值</label>
          <select id="nr-text"></select>
        </div>
        <div class="field" id="nr-feed-wrap">
          <label>餵食方式</label>
          <select id="nr-feed">
            ${feedMethods().map(m => `<option>${esc(m)}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="nr-amount-wrap">
          <label>奶量 (ml)</label>
          <input type="number" id="nr-amount" min="0" inputmode="numeric">
        </div>
        <div class="field" id="nr-lrmin-wrap">
          <label>親餵分鐘（左／右）</label>
          <div class="row" style="gap:6px;align-items:center">
            左 <input type="number" id="nr-lmin" min="0" inputmode="numeric" style="width:70px"> 分
            右 <input type="number" id="nr-rmin" min="0" inputmode="numeric" style="width:70px"> 分
          </div>
        </div>
        <div class="field" id="nr-diaper-wrap" hidden>
          <label>尿布內容</label>
          <select id="nr-diaper"><option value="濕">小便(濕)</option><option value="便">大便</option></select>
        </div>
        <div class="field" id="nr-rash-wrap" hidden>
          <label>紅臀評估</label>
          <select id="nr-rash">
            ${DIAPER_RASH_LEVELS.map(v => `<option value="${v}">${v}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="nr-value-wrap" hidden>
          <label id="nr-value-label">數值</label>
          <input type="number" step="0.1" id="nr-value" inputmode="decimal">
        </div>
        <div class="field">
          <label>照護地點</label>
          <select id="nr-loc">
            <option value="">沿用目前位置</option>
            <option value="nursery">嬰兒室</option>
            <option value="rooming">親子同室</option>
          </select>
        </div>
        <div class="field full">
          <label>備註</label>
          <textarea id="nr-note"></textarea>
        </div>
        <div class="full row">
          <button class="btn" id="nr-save">儲存</button>
          <span class="error-msg" id="nr-err"></span>
        </div>
      </div>`, body => {
      const sync = () => {
        const t = body.querySelector('#nr-type').value;
        body.querySelector('#nr-feed-wrap').hidden = t !== 'feeding';
        body.querySelector('#nr-amount-wrap').hidden = t !== 'feeding';
        body.querySelector('#nr-lrmin-wrap').hidden = t !== 'feeding';
        body.querySelector('#nr-diaper-wrap').hidden = t !== 'diaper';
        body.querySelector('#nr-rash-wrap').hidden = t !== 'diaper';
        const needValue = !!BABY_NUM_UNIT[t];
        body.querySelector('#nr-value-wrap').hidden = !needValue;
        if (needValue) body.querySelector('#nr-value-label').textContent = `${BABY_TYPE_LABEL[t]}（${BABY_NUM_UNIT[t]}）`;
        const textWrap = body.querySelector('#nr-text-wrap');
        textWrap.hidden = !BABY_TEXT_OPT[t];
        if (BABY_TEXT_OPT[t]) {
          body.querySelector('#nr-text-label').textContent = BABY_TYPE_LABEL[t];
          const opts = (SETTINGS[BABY_TEXT_OPT[t]] || '').split(',').map(x => x.trim()).filter(Boolean);
          body.querySelector('#nr-text').innerHTML = opts.map(o => `<option>${esc(o)}</option>`).join('');
        }
      };
      body.querySelector('#nr-type').onchange = sync;
      sync();
      body.querySelector('#nr-save').onclick = async () => {
        const t = body.querySelector('#nr-type').value;
        try {
          await api(`/babies/${babyId}/records`, {
            method: 'POST',
            body: {
              record_type: t,
              feed_method: t === 'feeding' ? body.querySelector('#nr-feed').value : '',
              amount_ml: t === 'feeding' ? Number(body.querySelector('#nr-amount').value) || null : null,
              feed_left_min: t === 'feeding' ? body.querySelector('#nr-lmin').value : '',
              feed_right_min: t === 'feeding' ? body.querySelector('#nr-rmin').value : '',
              diaper_kind: t === 'diaper' ? body.querySelector('#nr-diaper').value : '',
              diaper_rash: t === 'diaper' ? body.querySelector('#nr-rash').value : '',
              value_num: BABY_NUM_UNIT[t] ? Number(body.querySelector('#nr-value').value) || null : null,
              value_text: BABY_TEXT_OPT[t] ? body.querySelector('#nr-text').value : '',
              location: body.querySelector('#nr-loc').value,
              note: body.querySelector('#nr-note').value
            }
          });
          closeModal();
          refresh();
        } catch (e) {
          body.querySelector('#nr-err').textContent = e.message;
        }
      };
    });
  };

  $('#bc-photo').onclick = () => {
    const babyId = $('#bc-baby').value;
    if (!babyId) return;
    openModal('上傳寶寶照片', `
      <div class="field">
        <label>照片檔案（jpg / png，10MB 以內）</label>
        <input type="file" id="ph-file" accept="image/*" capture="environment">
      </div>
      <div class="field">
        <label>照片說明（會顯示給家屬）</label>
        <input id="ph-note" placeholder="例如：今天洗澡後心情很好">
      </div>
      <div class="row mt">
        <button class="btn" id="ph-save">上傳</button>
        <span class="error-msg" id="ph-err"></span>
      </div>`, body => {
      body.querySelector('#ph-save').onclick = async () => {
        const file = body.querySelector('#ph-file').files[0];
        if (!file) { body.querySelector('#ph-err').textContent = '請選擇圖片'; return; }
        const fd = new FormData();
        fd.append('photo', await compressImage(file));
        fd.append('note', body.querySelector('#ph-note').value);
        try {
          await api(`/babies/${babyId}/photos`, { method: 'POST', body: fd });
          closeModal();
          refresh();
        } catch (e) {
          body.querySelector('#ph-err').textContent = e.message;
        }
      };
    });
  };

  $('#bc-report').onclick = async () => {
    const babyId = $('#bc-baby').value;
    if (!babyId) return;
    const [rpt, trends] = await Promise.all([
      api(`/babies/${babyId}/report?date=${$('#bc-date').value}`),
      api(`/babies/${babyId}/trends`)
    ]);
    const s = rpt.summary;
    openModal(`${rpt.baby.name} 寶寶日報（${rpt.date}）`, `
      ${babyReportAlerts(rpt.alerts)}
      <div class="row" style="margin-bottom:10px"><button class="btn small secondary" id="br-print">列印 / 匯出 PDF</button></div>
      ${babyReportSummaryGrid(s, rpt.photos.length)}
      ${rpt.photos.length ? `<div class="photo-grid" style="margin-bottom:14px">${rpt.photos.map(p => `
        <figure><img src="/uploads/${esc(p.photo_file)}"><figcaption>${esc(p.note || '')}</figcaption></figure>`).join('')}</div>` : ''}
      <h3 style="color:var(--primary-dark);font-size:1rem;margin:8px 0">體重趨勢 (g)</h3>
      ${svgLineChart(trends.weight, { unit: 'g' })}
      <h3 style="color:var(--primary-dark);font-size:1rem;margin:8px 0">黃疸趨勢 (mg/dL)</h3>
      ${svgLineChart(trends.jaundice, { unit: '', color: '#b8860b' })}`, body => {
      body.querySelector('#br-print').onclick = () => printBabyReport(rpt);
    });
  };

  $('#bc-send').onclick = async () => {
    const babyId = $('#bc-baby').value;
    if (!babyId) return;
    const r = await api(`/babies/${babyId}/report/send`, {
      method: 'POST', body: { date: $('#bc-date').value }
    });
    let msg = `日報已發布至家屬入口（${r.recipients} 位家屬）`;
    if (r.line_sent) msg += `，LINE 推播 ${r.line_sent} 則`;
    if (r.line_failed) msg += `，LINE 失敗 ${r.line_failed} 則`;
    $('#bc-msg').textContent = msg;
    setTimeout(() => { const el = $('#bc-msg'); if (el) el.textContent = ''; }, 4000);
  };

  refresh();
}

/* ---------- 媽媽照護 ---------- */
async function viewMotherCare() {
  const mothers = await api('/mothers');
  const inHouse = mothers.filter(m => m.status === 'checked_in');
  const list = inHouse.length ? inHouse : mothers;
  main().innerHTML = `
    <div class="page-title">媽媽照護</div>
    <div class="card">
      <div class="form-grid">
        <div class="field">
          <label>選擇媽媽</label>
          <select id="mc-mother">${list.map(m =>
            `<option value="${m.id}">${esc(m.name)}${m.room_name ? `（${esc(m.room_name)} 房）` : ''}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>日期</label>
          <input type="date" id="mc-date" value="${todayStr()}">
        </div>
      </div>
      <div class="row mt"><small style="color:var(--muted)">本頁僅供查詢；新增／填寫請至「媽媽護理」頁。</small></div>
    </div>
    <div class="card">
      <h3>當日紀錄</h3>
      <div id="mc-list"><div class="empty">載入中</div></div>
    </div>`;
  // 深連結：#/mother-care?m=<id>（媽媽房況卡片「照護紀錄」直接帶入該媽媽）
  const wantMom = (location.hash.split('?m=')[1] || '').split('&')[0];
  if (wantMom && list.some(m => m.id == wantMom)) $('#mc-mother').value = wantMom;

  const refresh = async () => {
    const id = $('#mc-mother').value;
    if (!id) { $('#mc-list').innerHTML = '<div class="empty">尚無媽媽資料</div>'; return; }
    const rows = await api(`/mothers/${id}/records?date=${$('#mc-date').value}`);
    $('#mc-list').innerHTML = rows.length ? `<ul class="timeline">${rows.map(r => `
      <li>
        <div class="time">${fmtTime(r.recorded_at)}　${esc(r.nurse_name || '')}
          ${r.edited_at ? `<span class="badge gray" title="最後修改：${esc(r.edited_at)}">已修改</span>` : ''}
          <span style="float:right">
            ${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${r.id}">刪除</button>` : ''}
          </span>
        </div>
        <div class="what">${MOTHER_TYPE_LABEL[r.record_type] || r.record_type}</div>
        ${r.value_text ? `<div class="detail">${esc(r.value_text)}</div>` : ''}
        ${r.note ? `<div class="detail">${esc(r.note)}</div>` : ''}
      </li>`).join('')}</ul>` : '<div class="empty">當日尚無紀錄</div>';
    $('#mc-list').querySelectorAll('[data-del]').forEach(btn => btn.onclick = async () => {
      if (!confirm('確定刪除這筆紀錄？')) return;
      await api(`/mother-records/${btn.dataset.del}`, { method: 'DELETE' }); refresh();
    });
  };
  $('#mc-mother').onchange = refresh;
  $('#mc-date').onchange = refresh;

  refresh();
}

// 一頁式產婦評估：所有評估項目同一頁，類別項以下拉選單填寫，減少打字。
// 僅有填寫/選擇的項目會建立紀錄；可一次儲存多筆。
const MOTHER_ASSESS_ITEMS = [
  { type: 'wound', label: '傷口護理', optKey: 'wound_options' },
  { type: 'uterus', label: '子宮護理', optKey: 'uterus_options' },
  { type: 'breast', label: '乳房護理', optKey: 'breast_options' },
  { type: 'lochia', label: '惡露觀察', optKey: 'lochia_options' },
  { type: 'elimination', label: '排泄', optKey: 'elimination_options' },
  { type: 'lactation', label: '泌乳指導', optKey: 'lactation_options' },
  { type: 'mood', label: '情緒評估', optKey: 'mood_options' },
  { type: 'education', label: '衛教指導', optKey: 'education_options' }
];
function csvOptHtml(key) {
  return (SETTINGS[key] || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
}
// 快選 datalist：輸入框仍可自由輸入，另提供設定裡的建議選項下拉
function dataList(id, key) {
  return `<datalist id="${id}">${(SETTINGS[key] || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
}
// 快選 datalist（值來自傳入陣列，例如現有分類）：去重、去空
function dataListValues(id, values) {
  return `<datalist id="${id}">${[...new Set((values || []).filter(Boolean))]
    .map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
}
function distinctCats(list) { return [...new Set((list || []).map(x => x.category).filter(Boolean))]; }
function openMotherAssessment(motherId, onSaved) {
  const selects = MOTHER_ASSESS_ITEMS.map(it => `
    <div class="field">
      <label>${esc(it.label)}</label>
      <select id="as-${it.type}"><option value="">（略）</option>${csvOptHtml(it.optKey)}</select>
    </div>`).join('');
  openModal('一頁式評估', `
    <p style="font-size:.82rem;color:var(--muted);margin:0 0 10px">只填寫需要記錄的項目；留空者不建立紀錄。每項可於下拉選單外，於最下方備註補充。</p>
    <h3 style="color:var(--primary-dark);font-size:1rem;margin:4px 0 8px">生命徵象</h3>
    <div class="form-grid">
      <div class="field"><label>血壓</label><input id="as-bp" placeholder="110/70"></div>
      <div class="field"><label>脈搏 (bpm)</label><input type="number" id="as-pulse" inputmode="numeric"></div>
      <div class="field"><label>體溫 (°C)</label><input type="number" id="as-temp" step="0.1" inputmode="decimal"></div>
    </div>
    <h3 style="color:var(--primary-dark);font-size:1rem;margin:12px 0 8px">評估項目</h3>
    <div class="form-grid">${selects}</div>
    <div class="form-grid" style="margin-top:8px">
      <div class="field full"><label>其他備註</label><textarea id="as-note" rows="2"></textarea></div>
    </div>
    <div class="row mt"><button class="btn" id="as-save">儲存評估</button><span class="error-msg" id="as-err"></span></div>`, body => {
    body.querySelector('#as-save').onclick = async () => {
      const v = id => (body.querySelector(id)?.value || '').trim();
      const records = [];
      const bp = v('#as-bp'), pulse = v('#as-pulse'), temp = v('#as-temp');
      const vital = [bp ? `BP ${bp}` : '', pulse ? `P ${pulse}` : '', temp ? `T ${temp}` : ''].filter(Boolean).join('、');
      if (vital) records.push({ record_type: 'vital', value_text: vital });
      for (const it of MOTHER_ASSESS_ITEMS) {
        const val = v(`#as-${it.type}`);
        if (val) records.push({ record_type: it.type, value_text: val });
      }
      const note = v('#as-note');
      if (note) records.push({ record_type: 'note', value_text: note });
      if (!records.length) { body.querySelector('#as-err').textContent = '請至少填寫一個項目'; return; }
      try {
        await api(`/mothers/${motherId}/records/batch`, { method: 'POST', body: { records } });
        closeModal();
        onSaved && onSaved();
      } catch (e) { body.querySelector('#as-err').textContent = e.message; }
    };
  });
}

// 另開視窗列印／另存 PDF：某日的 SBAR 交班單
function printHandovers(date, rows) {
  const center = (SETTINGS && SETTINGS.center_name) || 'MamaCare';
  const blocks = (rows && rows.length) ? rows.map(h => `
    <div class="ho">
      <div class="hh">${esc(SHIFT_LABEL[h.shift_type] || h.shift_type)}　交班護理師：${esc(h.nurse_name || '')}　${esc((h.created_at || '').slice(0, 16))}</div>
      <table><tbody>
        <tr><th>S 現況</th><td>${esc(h.situation || '')}</td></tr>
        <tr><th>B 背景</th><td>${esc(h.background || '')}</td></tr>
        <tr><th>A 評估</th><td>${esc(h.assessment || '')}</td></tr>
        <tr><th>R 建議</th><td>${esc(h.recommendation || '')}</td></tr>
        ${h.follow_up ? `<tr><th>待辦</th><td>${esc(h.follow_up)}${h.resolved ? '（已完成）' : ''}</td></tr>` : ''}
      </tbody></table>
    </div>`).join('') : '<p style="color:#888">當日無交班紀錄</p>';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">
    <title>交班單 ${esc(date)}</title>
    <style>
      body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#1c2b29;line-height:1.6;max-width:760px;margin:24px auto;padding:0 24px}
      h1{font-size:20px;margin:0 0 2px;color:#b03060} .sub{color:#666;font-size:13px;margin-bottom:14px}
      .ho{border:1px solid #ccc;border-radius:6px;margin-bottom:14px;overflow:hidden}
      .hh{background:#f2f7f6;padding:6px 10px;font-weight:700;font-size:14px}
      table{width:100%;border-collapse:collapse;font-size:14px}
      th{width:80px;text-align:left;vertical-align:top;padding:6px 8px;background:#fafafa;border-top:1px solid #eee}
      td{padding:6px 8px;border-top:1px solid #eee;white-space:pre-wrap}
      @media print{.noprint{display:none}}
    </style></head><body>
    <h1>${esc(center)}　護理交班單（SBAR）</h1>
    <div class="sub">交班日期：${esc(date)}　列印時間：${esc(new Date().toLocaleString('zh-TW'))}</div>
    ${blocks}
    <div class="noprint" style="margin-top:20px;text-align:center"><button onclick="window.print()" style="padding:10px 24px;font-size:15px">列印 / 另存 PDF</button></div>
    </body></html>`);
  win.document.close();
}

/* ---------- 護理交班 ---------- */
async function viewHandover() {
  main().innerHTML = `
    <div class="page-title">護理交班（SBAR）</div>
    <div class="card">
      <div class="form-grid">
        <div class="field">
          <label>日期</label>
          <input type="date" id="ho-date" value="${todayStr()}">
        </div>
        <div class="field" style="display:flex;align-items:flex-end;gap:8px">
          <button class="btn" id="ho-add">新增交班紀錄</button>
          <button class="btn secondary" id="ho-print">列印交班單</button>
        </div>
      </div>
    </div>
    <div id="ho-todos"></div>
    <div id="ho-list"></div>`;

  let lastRows = [];

  const refreshTodos = async () => {
    const todos = await api('/handover-todos');
    $('#ho-todos').innerHTML = todos.length ? `
      <div class="card" style="border-left:4px solid var(--warn)">
        <h3>未結交班待辦 <span class="badge red">${todos.length}</span></h3>
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>待辦</th><th>交班</th><th></th></tr></thead>
          <tbody>${todos.map(t => `<tr>
            <td data-label="待辦" style="white-space:normal">${esc(t.follow_up)}</td>
            <td data-label="交班"><small>${esc(t.handover_date)}　${SHIFT_LABEL[t.shift_type]}　${esc(t.nurse_name)}</small></td>
            <td data-label="操作"><button class="btn small" data-resolve="${t.id}">完成</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>` : '';
    $('#ho-todos').querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
      await api(`/handovers/${b.dataset.resolve}/resolve`, { method: 'POST' }); refreshTodos();
    });
  };

  const refresh = async () => {
    const rows = await api(`/handovers?date=${$('#ho-date').value}`);
    lastRows = rows;
    $('#ho-list').innerHTML = rows.length ? rows.map(h => `
      <div class="card">
        <div class="row between">
          <h3>${SHIFT_LABEL[h.shift_type]}　${esc(h.nurse_name)}</h3>
          <span class="badge teal">${fmtTime(h.created_at)}</span>
        </div>
        <div class="table-wrap"><table class="data stack">
          <tbody>
            <tr><td data-label="S 現況" style="white-space:normal"><strong>S 現況</strong>　${esc(h.situation)}</td></tr>
            <tr><td data-label="B 背景" style="white-space:normal"><strong>B 背景</strong>　${esc(h.background)}</td></tr>
            <tr><td data-label="A 評估" style="white-space:normal"><strong>A 評估</strong>　${esc(h.assessment)}</td></tr>
            <tr><td data-label="R 建議" style="white-space:normal"><strong>R 建議</strong>　${esc(h.recommendation)}</td></tr>
            ${h.follow_up ? `<tr><td data-label="待辦" style="white-space:normal;background:#fff7e6"><strong>待辦</strong>　${esc(h.follow_up)}　${h.resolved ? '<span class="badge green">已完成</span>' : `<button class="btn small" data-resolve="${h.id}">標記完成</button>`}</td></tr>` : ''}
          </tbody>
        </table></div>
      </div>`).join('') : '<div class="card"><div class="empty">當日尚無交班紀錄</div></div>';
    $('#ho-list').querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
      await api(`/handovers/${b.dataset.resolve}/resolve`, { method: 'POST' }); refresh(); refreshTodos();
    });
  };
  $('#ho-date').onchange = refresh;
  $('#ho-print').onclick = () => printHandovers($('#ho-date').value, lastRows);

  $('#ho-add').onclick = () => {
    openModal('新增交班紀錄（SBAR）', `
      <div class="field">
        <label>班別</label>
        <select id="hn-shift">${Object.entries(SHIFT_LABEL)
          .map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="row" style="margin-bottom:6px"><button class="btn small secondary" id="hn-draft" type="button">自動帶入草稿（依今日紀錄）</button></div>
      <div class="field"><label>S 現況 Situation</label><textarea id="hn-s"></textarea></div>
      <div class="field"><label>B 背景 Background</label><textarea id="hn-b"></textarea></div>
      <div class="field"><label>A 評估 Assessment</label><textarea id="hn-a"></textarea></div>
      <div class="field"><label>R 建議 Recommendation</label><textarea id="hn-r"></textarea></div>
      <div class="field"><label>待辦事項（未完成會列入下班待辦／提醒，可留空）</label><textarea id="hn-f" placeholder="例如：3 床傷口換藥未完成，下一班接續"></textarea></div>
      <div class="row mt">
        <button class="btn" id="hn-save">儲存</button>
        <span class="error-msg" id="hn-err"></span>
      </div>`, body => {
      body.querySelector('#hn-draft').onclick = async () => {
        try {
          const d = await api(`/handovers/draft?date=${$('#ho-date').value}`);
          body.querySelector('#hn-s').value = d.situation;
          body.querySelector('#hn-b').value = d.background;
          body.querySelector('#hn-a').value = d.assessment;
          body.querySelector('#hn-r').value = d.recommendation;
        } catch (e) { body.querySelector('#hn-err').textContent = e.message; }
      };
      body.querySelector('#hn-save').onclick = async () => {
        try {
          await api('/handovers', {
            method: 'POST',
            body: {
              shift_type: body.querySelector('#hn-shift').value,
              handover_date: $('#ho-date').value,
              situation: body.querySelector('#hn-s').value,
              background: body.querySelector('#hn-b').value,
              assessment: body.querySelector('#hn-a').value,
              recommendation: body.querySelector('#hn-r').value,
              follow_up: body.querySelector('#hn-f').value
            }
          });
          closeModal();
          refresh(); refreshTodos();
        } catch (e) {
          body.querySelector('#hn-err').textContent = e.message;
        }
      };
    });
  };

  refresh();
  refreshTodos();
}

/* ---------- 住客管理 ---------- */
function motherForm(m = {}) {
  return `
    <div class="form-grid">
      <div class="field"><label>姓名</label><input id="mf-name" value="${esc(m.name || '')}"></div>
      <div class="field"><label>電話</label><input id="mf-phone" value="${esc(m.phone || '')}"></div>
      <div class="field"><label>身分證號<small>（媽媽護理中衛欄位帶入）</small></label><input id="mf-idno" maxlength="10" value="${esc(m.id_no || '')}"></div>
      <div class="field"><label>預產期</label><input type="date" id="mf-due" value="${esc(m.due_date || '')}"></div>
      <div class="field"><label>生產日期</label><input type="date" id="mf-delivery" value="${esc(m.delivery_date || '')}"></div>
      <div class="field">
        <label>生產方式</label>
        <select id="mf-type">
          ${['', ...deliveryTypes()].map(t =>
            `<option value="${esc(t)}" ${m.delivery_type === t ? 'selected' : ''}>${esc(t) || '未填'}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>狀態</label>
        <select id="mf-status">
          ${['reserved', 'checked_in', 'checked_out'].map(s =>
            `<option value="${s}" ${m.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
      </div>
      <div class="field full"><label>飲食注意（訂餐用）</label><input id="mf-diet" value="${esc(m.diet_notes || '')}"></div>
      <div class="field full"><label>醫療注意事項</label><textarea id="mf-medical">${esc(m.medical_notes || '')}</textarea></div>
      <div class="full row">
        <button class="btn" id="mf-save">儲存</button>
        <span class="error-msg" id="mf-err"></span>
      </div>
    </div>`;
}

function readMotherForm(body) {
  return {
    name: body.querySelector('#mf-name').value.trim(),
    phone: body.querySelector('#mf-phone').value.trim(),
    id_no: body.querySelector('#mf-idno').value.trim(),
    due_date: body.querySelector('#mf-due').value,
    delivery_date: body.querySelector('#mf-delivery').value,
    delivery_type: body.querySelector('#mf-type').value,
    status: body.querySelector('#mf-status').value,
    diet_notes: body.querySelector('#mf-diet').value,
    medical_notes: body.querySelector('#mf-medical').value
  };
}

async function viewResidents() {
  const [data, mothers, babies] = await Promise.all([api('/room-status/mothers'), api('/mothers'), api('/babies')]);
  const st = data.stats;
  // 房況看板（呈現同媽媽房況；資訊區塊保留不變，卡片按鈕改為營運功能）
  const boardCards = data.rooms.map(r => {
    const occ = r.occupant, next = r.next_booking;
    const states = [r.state];
    if (occ && occ.pending_tasks > 0) states.push('has_tasks');
    if (occ && occ.need_count > 0) states.push('has_needs');
    if (occ && occ.meal_swap_count > 0) states.push('has_meal_swap');
    const nextDue = occ && next && next.check_in <= data.date;
    if (nextDue) states.push('due_in');
    // 家屬傳送新訊息提示（護理留言／換餐申請）
    const msgBadges = occ ? [
      occ.need_count > 0 ? `<span class="badge red">家屬留言 ${occ.need_count}</span>` : '',
      occ.meal_swap_count > 0 ? `<span class="badge yellow">換餐申請 ${occ.meal_swap_count}</span>` : ''
    ].filter(Boolean).join(' ') : '';
    let body = '';
    if (occ) {
      const babyLine = (occ.babies || []).length
        ? occ.babies.map(b => `${esc(b.name)} <span class="badge ${LOCATION_BADGE[b.location] || 'gray'}" style="font-weight:400">${LOCATION_LABEL[b.location] || '-'}</span>`).join('　')
        : '<span style="color:var(--muted)">尚未登記</span>';
      body = `
        <div class="rs-name">${esc(occ.mother_name)}${occ.closed ? ' <span class="badge gray">已結案</span>' : ''}<small style="color:var(--muted);font-weight:400">　${esc(occ.phone || '')}</small></div>
        <div class="rs-stay">
          <div class="rs-bar"><i style="width:${Math.min(100, Math.round(occ.stay_day / Math.max(occ.stay_total, 1) * 100))}%"></i></div>
          <small>第 ${occ.stay_day} / ${occ.stay_total} 天（${esc(occ.check_in)} ~ ${esc(occ.check_out)}）</small>
        </div>
        <div class="rs-kv">
          ${occ.delivery_type ? `<span>生產：${esc(occ.delivery_type)}${occ.delivery_date ? `（${esc(occ.delivery_date)}）` : ''}</span>` : ''}
          <span>膳食：${esc(occ.meal_diet || '一般')}${occ.diet_notes ? `・${esc(occ.diet_notes)}` : ''}</span>
          ${occ.hk_dnd ? `<span>勿擾：${esc(occ.hk_dnd)}</span>` : ''}
          ${occ.hk_needs ? `<span>房務需求：${esc(occ.hk_needs)}</span>` : ''}
          ${occ.medical_notes ? `<span style="color:var(--danger)">醫療注意：${esc(occ.medical_notes)}</span>` : ''}
          <span>寶寶：${babyLine}</span>
          <span>今日照護 ${occ.today_care_count} 次${occ.last_care_at ? `・最後 ${fmtTime(occ.last_care_at)}（${sinceText(occ.last_care_at)}）` : ''}</span>
          ${occ.pending_tasks > 0 ? `<span class="badge yellow">待辦房務 ${occ.pending_tasks} 件</span>` : ''}
        </div>`;
    } else if (next) {
      body = `
        <div class="rs-name" style="color:var(--muted)">${r.state === 'due_in' ? '今日應入住' : '下一筆預約'}</div>
        <div class="rs-kv">
          <span>${esc(next.mother_name)}${next.phone ? `　${esc(next.phone)}` : ''}</span>
          <span>${esc(next.check_in)} ~ ${esc(next.check_out)}</span>
        </div>`;
    } else {
      body = '<div class="rs-name" style="color:var(--muted)">目前空房，無排定預約</div>';
    }
    const nextLine = occ && next
      ? `<div class="rs-next" ${nextDue ? 'style="color:var(--warn);font-weight:600"' : ''}>${nextDue ? '今日應入住' : '下一筆'}：${esc(next.mother_name)}　${esc(next.check_in)} 入住</div>` : '';
    const actions = occ ? [
      canAccess('#/meals') ? '<a class="btn small" href="#/meals">膳食管理</a>' : '',
      canAccess('#/housekeeping') ? '<a class="btn small" href="#/housekeeping">房務清潔</a>' : '',
      canAccess('#/billing') ? `<button class="btn small" data-bill="${occ.booking_id}">收費帳務</button>` : '',
      canAccess('#/shop') ? '<a class="btn small" href="#/shop">商城商品</a>' : '',
      canAccess('#/customers') ? `<button class="btn small" data-contract="${occ.mother_id}">合約資料</button>` : '',
      canAccess('#/visitor-reservations') ? '<a class="btn small" href="#/visitor-reservations">訪客預約</a>' : '',
      canAccess('#/family') ? '<a class="btn small" href="#/family">＋家屬帳號</a>' : ''
    ].filter(Boolean).join('') : (canAccess('#/rooms') ? '<a class="btn small secondary" href="#/rooms">訂房管理</a>' : '');
    return `
      <div class="room-card ${r.state}" data-state="${states.join(' ')}">
        <div class="row between" style="align-items:flex-start">
          <div><span class="rs-room">${esc(r.name)}</span><small style="color:var(--muted)">　${esc(r.room_type)}</small></div>
          <div style="text-align:right"><span class="badge ${ROOM_STATE_BADGE[r.state]}">${ROOM_STATE_LABEL[r.state]}</span>
            ${msgBadges ? `<div style="margin-top:4px">${msgBadges}</div>` : ''}</div>
        </div>
        ${body}${nextLine}
        ${actions ? `<div class="row" style="gap:6px;margin-top:10px">${actions}</div>` : ''}
      </div>`;
  }).join('');
  // 媽媽／寶寶資料管理卡片（收合區塊；左側色條依狀態）
  const MOM_STATE_CLS = { checked_in: 'occupied', reserved: 'reserved', checked_out: '' };
  const motherCards = mothers.map(m => `
    <div class="room-card ${MOM_STATE_CLS[m.status] || ''}" data-filter="${esc(m.name + ' ' + (m.phone || '') + ' ' + (m.room_name || ''))}" data-status="${m.status}">
      <div class="row between" style="align-items:flex-start">
        <div><span class="rs-room">${esc(m.room_name || '未排房')}</span>${m.room_name ? '<small style="color:var(--muted)">　房</small>' : ''}</div>
        <span class="badge ${STATUS_BADGE[m.status]}">${STATUS_LABEL[m.status]}</span>
      </div>
      <div class="rs-name">${esc(m.name)}<small style="color:var(--muted);font-weight:400">　${esc(m.phone || '')}</small></div>
      <div class="rs-kv">
        ${m.stay_range ? `<span>住期：${esc(m.stay_range)}</span>` : ''}
        ${m.due_date ? `<span>預產期：${esc(m.due_date)}</span>` : ''}
        ${m.delivery_type || m.delivery_date ? `<span>生產：${esc(m.delivery_type || '—')}${m.delivery_date ? `（${esc(m.delivery_date)}）` : ''}</span>` : ''}
        <span>寶寶：${m.baby_count > 0 ? `${m.baby_count} 位` : '<span style="color:var(--muted)">尚未登記</span>'}</span>
        ${m.diet_notes ? `<span>飲食禁忌：${esc(m.diet_notes)}</span>` : ''}
        ${m.medical_notes ? `<span style="color:var(--danger)">醫療注意：${esc(m.medical_notes)}</span>` : ''}
      </div>
      <div class="row" style="gap:6px;margin-top:10px">
        <button class="btn small secondary" data-edit-mother="${m.id}">編輯</button>
      </div>
    </div>`).join('');
  const babyCards = babies.map(b => `
    <div class="room-card ${b.mother_status === 'checked_in' ? 'occupied' : ''}" data-filter="${esc(b.name + ' ' + b.mother_name + ' ' + (b.notes || ''))}">
      <div class="row between" style="align-items:flex-start">
        <div><span class="rs-room">${esc(b.name)}</span>　${b.gender === 'male' ? '<span style="color:#3b78c2">♂ 男</span>' : b.gender === 'female' ? '<span style="color:var(--accent)">♀ 女</span>' : '<small style="color:var(--muted)">性別未填</small>'}</div>
        ${b.mother_status ? `<span class="badge ${STATUS_BADGE[b.mother_status] || 'gray'}">${STATUS_LABEL[b.mother_status] || ''}</span>` : ''}
      </div>
      <div class="rs-name" style="font-weight:400"><small style="color:var(--muted)">媽媽</small>　${esc(b.mother_name)}</div>
      <div class="rs-kv">
        <span>出生日期：${esc(b.birth_date || '—')}</span>
        <span>出生體重：${b.birth_weight_g ? `${b.birth_weight_g} g` : '—'}</span>
        ${b.notes ? `<span>備註：${esc(b.notes)}</span>` : ''}
      </div>
      <div class="row" style="gap:6px;margin-top:10px">
        <button class="btn small secondary" data-edit-baby="${b.id}">編輯</button>
      </div>
    </div>`).join('');
  main().innerHTML = `
    <div class="page-title">住客管理</div>
    <div class="stat-grid">
      <div class="stat"><div class="num">${st.total}</div><div class="label">總房數</div></div>
      <div class="stat"><div class="num">${st.occupied}</div><div class="label">入住中</div></div>
      <div class="stat"><div class="num">${st.due_out}</div><div class="label">應退房</div></div>
      <div class="stat"><div class="num">${st.due_in}</div><div class="label">今日入住</div></div>
    </div>
    <div class="card">
      <div class="row between" style="flex-wrap:wrap;gap:8px">
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn small" data-board-flt="all">全部</button>
          <button class="btn small secondary" data-board-flt="occupied">入住中</button>
          <button class="btn small secondary" data-board-flt="due_out">應退房</button>
          <button class="btn small secondary" data-board-flt="due_in">今日入住</button>
          <button class="btn small secondary" data-board-flt="vacant">空房</button>
          <button class="btn small secondary" data-board-flt="has_tasks">有待辦房務</button>
          <button class="btn small secondary" data-board-flt="has_meal_swap">有換餐申請</button>
          <button class="btn small secondary" data-board-flt="has_needs">有護理需求</button>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn small" id="rs-add-mother">新增媽媽</button>
          <button class="btn small" id="rs-add-baby">新增寶寶</button>
          ${canAccess('#/mother-rooms-print') ? '<a class="btn small secondary" href="#/mother-rooms-print">房況列印</a>' : ''}
          <small style="color:var(--muted)">${esc(data.date)}</small>
          <button class="btn small secondary" id="rs-refresh">重新整理</button>
        </div>
      </div>
      <div class="board-grid mt" id="rm-grid">${boardCards || '<div class="empty">尚未建立房間</div>'}</div>
    </div>
    <div class="card">
      <details>
        <summary style="cursor:pointer;font-weight:600">媽媽資料管理（${mothers.length}）　點擊展開 ▾</summary>
        ${filterBar({ placeholder: '搜尋姓名 / 電話 / 房間…', statuses: [{ val: '', label: '全部' }, { val: 'reserved', label: '預約' }, { val: 'checked_in', label: '入住中' }, { val: 'checked_out', label: '已退房' }] })}
        <div class="board-grid flt-zone">${motherCards || '<div class="empty">尚無媽媽資料</div>'}</div>
      </details>
    </div>
    <div class="card">
      <details>
        <summary style="cursor:pointer;font-weight:600">寶寶資料管理（${babies.length}）　點擊展開 ▾</summary>
        ${filterBar({ placeholder: '搜尋寶寶 / 媽媽…', search: true })}
        <div class="board-grid flt-zone">${babyCards || '<div class="empty">尚無寶寶資料</div>'}</div>
      </details>
    </div>`;
  $('#rs-refresh').onclick = viewResidents;
  wireBoardFilter(main(), '#rm-grid');
  wireFilter(main());
  // 收費帳務：開啟該訂房收費明細
  main().querySelectorAll('[data-bill]').forEach(b => b.onclick = () => openBillingDetail(b.dataset.bill));
  // 合約資料：彈窗顯示此媽媽的合約資料
  main().querySelectorAll('[data-contract]').forEach(b => b.onclick = async () => {
    let d;
    try { d = await api(`/customers/${b.dataset.contract}`); } catch (e) { alert(e.message); return; }
    const ct = d.contract, cd = (ct && ct.data) || {};
    openModal(`合約資料 — ${d.mother.name}`, ct ? `
      <div style="font-size:.95rem;line-height:2">
        <div>合約編號：<b>${esc(ct.contract_no)}</b>${ct.status === 'cancelled' ? ` <span class="badge gray">已退訂 ${esc(cd.cancel_date || '')}</span>` : ''}</div>
        <div>簽約日：${esc(cd.sign_date || '—')}　經手人：${esc(cd.handler || '—')}</div>
        <div>預產期：${esc(cd.due_date || '—')}　胎次：${esc(cd.parity_no || '—')}　胞胎：${esc(cd.baby_count || '—')}</div>
        <div>飲食禁忌：${esc(cd.diet_ban || '—')}</div>
        ${(ct.items || []).length ? `
          <div class="table-wrap"><table class="data">
            <thead><tr><th>銷售房型</th><th>天數</th><th>單價</th><th>小計</th></tr></thead>
            <tbody>${ct.items.map(it => `<tr><td>${esc(it.name)}</td><td>${it.qty}</td><td>${Number(it.price).toLocaleString()}</td><td>${(Number(it.qty) * Number(it.price)).toLocaleString()}</td></tr>`).join('')}</tbody>
          </table></div>
          <div style="text-align:right;font-weight:700">合約總額：${Number(ct.total).toLocaleString()} 元</div>` : ''}
        ${cd.note ? `<div>備註：${esc(cd.note)}</div>` : ''}
        ${canAccess('#/customers') ? '<div class="row mt"><a class="btn small secondary" href="#/customers" data-close-modal>前往客戶管理</a></div>' : ''}
      </div>` : '<div class="empty">此媽媽尚無合約資料（可至客戶管理建立）</div>',
    body => body.querySelectorAll('[data-close-modal]').forEach(a => a.onclick = () => closeModal()));
  });

  $('#rs-add-mother').onclick = () => {
    openModal('新增媽媽', motherForm(), body => {
      body.querySelector('#mf-save').onclick = async () => {
        try {
          await api('/mothers', { method: 'POST', body: readMotherForm(body) });
          closeModal();
          viewResidents();
        } catch (e) {
          body.querySelector('#mf-err').textContent = e.message;
        }
      };
    });
  };

  main().querySelectorAll('[data-edit-mother]').forEach(btn => {
    btn.onclick = async () => {
      const m = await api(`/mothers/${btn.dataset.editMother}`);
      openModal('編輯媽媽資料', motherForm(m), body => {
        body.querySelector('#mf-save').onclick = async () => {
          try {
            await api(`/mothers/${m.id}`, { method: 'PUT', body: readMotherForm(body) });
            closeModal();
            viewResidents();
          } catch (e) {
            body.querySelector('#mf-err').textContent = e.message;
          }
        };
      });
    };
  });

  main().querySelectorAll('[data-edit-baby]').forEach(btn => {
    btn.onclick = () => {
      const b = babies.find(x => String(x.id) === btn.dataset.editBaby);
      openModal('編輯寶寶資料', `
        <div class="form-grid">
          <div class="field"><label>姓名／暱稱</label><input id="be-name" value="${esc(b.name)}"></div>
          <div class="field">
            <label>性別</label>
            <select id="be-gender">
              ${[['', '未填'], ['male', '男'], ['female', '女']].map(([v, t]) =>
                `<option value="${v}" ${b.gender === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>出生日期</label><input type="date" id="be-birth" value="${esc(b.birth_date || '')}"></div>
          <div class="field"><label>出生體重 (g)</label><input type="number" id="be-weight" inputmode="numeric" value="${b.birth_weight_g ?? ''}"></div>
          <div class="field full"><label>備註</label><input id="be-notes" value="${esc(b.notes || '')}"></div>
          <div class="full row">
            <button class="btn" id="be-save">儲存</button>
            <span class="error-msg" id="be-err"></span>
          </div>
        </div>`, body => {
        body.querySelector('#be-save').onclick = async () => {
          try {
            await api(`/babies/${b.id}`, {
              method: 'PUT',
              body: {
                name: body.querySelector('#be-name').value.trim(),
                gender: body.querySelector('#be-gender').value,
                birth_date: body.querySelector('#be-birth').value,
                birth_weight_g: Number(body.querySelector('#be-weight').value) || null,
                notes: body.querySelector('#be-notes').value
              }
            });
            closeModal();
            viewResidents();
          } catch (e) {
            body.querySelector('#be-err').textContent = e.message;
          }
        };
      });
    };
  });

  $('#rs-add-baby').onclick = () => {
    openModal('新增寶寶', `
      <div class="form-grid">
        <div class="field full">
          <label>媽媽</label>
          <select id="bf-mother">${mothers.map(m =>
            `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>姓名／暱稱</label><input id="bf-name"></div>
        <div class="field">
          <label>性別</label>
          <select id="bf-gender">
            <option value="">未填</option><option value="male">男</option><option value="female">女</option>
          </select>
        </div>
        <div class="field"><label>出生日期</label><input type="date" id="bf-birth"></div>
        <div class="field"><label>出生體重 (g)</label><input type="number" id="bf-weight" inputmode="numeric"></div>
        <div class="field full"><label>備註</label><input id="bf-notes"></div>
        <div class="full row">
          <button class="btn" id="bf-save">儲存</button>
          <span class="error-msg" id="bf-err"></span>
        </div>
      </div>`, body => {
      body.querySelector('#bf-save').onclick = async () => {
        try {
          await api('/babies', {
            method: 'POST',
            body: {
              mother_id: body.querySelector('#bf-mother').value,
              name: body.querySelector('#bf-name').value.trim(),
              gender: body.querySelector('#bf-gender').value,
              birth_date: body.querySelector('#bf-birth').value,
              birth_weight_g: Number(body.querySelector('#bf-weight').value) || null,
              notes: body.querySelector('#bf-notes').value
            }
          });
          closeModal();
          viewResidents();
        } catch (e) {
          body.querySelector('#bf-err').textContent = e.message;
        }
      };
    });
  };
}

/* ---------- 房務與訂房 ---------- */
async function viewRooms() {
  const [rooms, bookings, mothers] = await Promise.all([
    api('/rooms'), api('/bookings'), api('/mothers')
  ]);
  main().innerHTML = `
    <div class="page-title">房務與訂房</div>
    <div class="card">
      <h3>房間狀態</h3>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>房號</th><th>房型</th><th>定價/日</th><th>狀態</th></tr></thead>
          <tbody>${rooms.map(r => `
            <tr>
              <td data-label="房號">${esc(r.name)}</td>
              <td data-label="房型">${esc(r.room_type)}</td>
              <td data-label="定價/日">${fmtMoney(r.price_per_day)}</td>
              <td data-label="狀態">${r.occupant
                ? `<span class="badge green">入住中</span> ${esc(r.occupant)}（至 ${esc(r.occupied_until)}）`
                : '<span class="badge gray">空房</span>'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="row between">
        <h3>訂房</h3>
        <button class="btn small" id="bk-add">新增訂房</button>
      </div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>媽媽</th><th>房間</th><th>期間</th><th>金額</th><th>狀態</th><th></th></tr></thead>
          <tbody>${bookings.map(b => `
            <tr>
              <td data-label="媽媽">${esc(b.mother_name)}</td>
              <td data-label="房間">${esc(b.room_name)}（${esc(b.room_type)}）</td>
              <td data-label="期間">${esc(b.check_in)} ~ ${esc(b.check_out)}</td>
              <td data-label="金額">${fmtMoney(b.total_amount)}<br><small>訂金 ${fmtMoney(b.deposit)}</small></td>
              <td data-label="狀態"><span class="badge ${STATUS_BADGE[b.status]}">${STATUS_LABEL[b.status]}</span></td>
              <td data-label="操作">
                ${b.status === 'reserved'
                  ? `<button class="btn small secondary" data-prep="${b.id}">入住前準備</button>
                     <button class="btn small" data-st="checked_in" data-id="${b.id}">辦理入住</button>
                     <button class="btn small danger" data-st="cancelled" data-id="${b.id}">取消</button>` : ''}
                ${b.status === 'checked_in'
                  ? `<button class="btn small secondary" data-st="checked_out" data-id="${b.id}">辦理退房</button>` : ''}
              </td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;

  main().querySelectorAll('[data-st]').forEach(btn => {
    btn.onclick = async () => {
      const labels = { checked_in: '辦理入住', checked_out: '辦理退房', cancelled: '取消訂房' };
      if (!confirm(`確定${labels[btn.dataset.st]}？`)) return;
      await api(`/bookings/${btn.dataset.id}/status`, { method: 'PUT', body: { status: btn.dataset.st } });
      viewRooms();
    };
  });

  main().querySelectorAll('[data-prep]').forEach(btn => {
    btn.onclick = () => {
      const bk = bookings.find(x => String(x.id) === btn.dataset.prep);
      const mom = mothers.find(m => String(m.id) === String(bk.mother_id));
      openCheckinPrep(bk, mom, rooms);
    };
  });

  $('#bk-add').onclick = () => openBookingForm(rooms, mothers, {});
  wireRoomCalendar(rooms, mothers);
}

// 入住前準備：簽約到實際入住之間，調整床位／起迄日、膳食安排、寶寶入住日，最後可直接辦理入住
async function openCheckinPrep(bk, mom, rooms) {
  // 膳食類型沿用月子餐設定的飲食類型（meal_diets），與住客 meal_diet 同一套值，避免命名落差
  const cfg = await api('/meal-config').catch(() => ({ diets: [] }));
  const diets = (cfg.diets && cfg.diets.length) ? cfg.diets : ['一般'];
  const curDiet = mom && mom.meal_diet ? mom.meal_diet : '';
  const dietList = curDiet && !diets.includes(curDiet) ? [curDiet, ...diets] : diets;
  const dietOpts = dietList.map(c => `<option ${curDiet === c ? 'selected' : ''}>${esc(c)}</option>`).join('');
  openModal(`入住前準備 — ${esc(bk.mother_name)}`, `
    <h3 style="color:var(--primary-dark);font-size:1rem;margin:2px 0 8px">床位安排</h3>
    <div class="form-grid">
      <div class="field"><label>房間／床位</label>
        <select id="cp-room">${rooms.map(r => `<option value="${r.id}" data-price="${r.price_per_day}" ${r.id === bk.room_id ? 'selected' : ''}>${esc(r.name)}（${esc(r.room_type)}，${fmtMoney(r.price_per_day)}/日）</option>`).join('')}</select></div>
      <div class="field"><label>入住日</label><input type="date" id="cp-in" value="${esc(bk.check_in || '')}"></div>
      <div class="field"><label>退房日</label><input type="date" id="cp-out" value="${esc(bk.check_out || '')}"></div>
      <div class="field"><label>合約總額</label><input type="number" id="cp-total" inputmode="numeric" value="${bk.total_amount || 0}"></div>
      <div class="field"><label>寶寶入住日（未定可留空）</label><input type="date" id="cp-baby" value="${esc(bk.baby_check_in || '')}" min="${esc(bk.check_in || '')}"></div>
    </div>
    <h3 style="color:var(--primary-dark);font-size:1rem;margin:12px 0 8px">膳食安排</h3>
    <div class="form-grid">
      <div class="field"><label>膳食類型</label><select id="cp-diet">${dietOpts}</select></div>
      <div class="field full"><label>飲食注意（過敏／忌口，會帶入備餐單）</label><input id="cp-dietnote" value="${esc(mom ? (mom.diet_notes || '') : '')}"></div>
    </div>
    <div class="row mt" style="gap:8px">
      <button class="btn" id="cp-save">儲存安排</button>
      <button class="btn secondary" id="cp-save-in">儲存並辦理入住</button>
      <span class="error-msg" id="cp-err"></span>
    </div>`, body => {
    const roomEl = body.querySelector('#cp-room');
    const inEl = body.querySelector('#cp-in'), outEl = body.querySelector('#cp-out');
    const calcTotal = () => {
      const price = Number(roomEl.selectedOptions[0]?.dataset.price || 0);
      if (!price || !inEl.value || !outEl.value) return;
      const days = Math.round((new Date(outEl.value) - new Date(inEl.value)) / 86400000);
      if (days > 0) body.querySelector('#cp-total').value = days * price;
    };
    roomEl.onchange = calcTotal; inEl.onchange = calcTotal; outEl.onchange = calcTotal;

    const persist = async () => {
      // 床位／日期／金額
      await api(`/bookings/${bk.id}`, { method: 'PUT', body: {
        room_id: roomEl.value, check_in: inEl.value, check_out: outEl.value,
        total_amount: Number(body.querySelector('#cp-total').value) || 0
      } });
      // 寶寶入住日
      await api(`/bookings/${bk.id}/baby-check-in`, { method: 'PUT', body: { baby_check_in: body.querySelector('#cp-baby').value } });
      // 膳食安排
      if (mom) {
        await api(`/mothers/${mom.id}/meal-diet`, { method: 'PUT', body: { meal_diet: body.querySelector('#cp-diet').value } });
        await api(`/mothers/${mom.id}`, { method: 'PUT', body: {
          name: mom.name, phone: mom.phone || '', due_date: mom.due_date || '',
          delivery_date: mom.delivery_date || '', delivery_type: mom.delivery_type || '',
          diet_notes: body.querySelector('#cp-dietnote').value,
          medical_notes: mom.medical_notes || '', status: mom.status || 'reserved'
        } });
      }
    };
    body.querySelector('#cp-save').onclick = async () => {
      try { await persist(); closeModal(); viewRooms(); }
      catch (e) { body.querySelector('#cp-err').textContent = e.message; }
    };
    body.querySelector('#cp-save-in').onclick = async () => {
      try {
        await persist();
        await api(`/bookings/${bk.id}/status`, { method: 'PUT', body: { status: 'checked_in' } });
        closeModal(); viewRooms();
      } catch (e) { body.querySelector('#cp-err').textContent = e.message; }
    };
  });
}

// 訂房表單（可帶 prefill：room_id / check_in，供房況月曆點空格快速建檔）
function openBookingForm(rooms, mothers, prefill = {}) {
  openModal('新增訂房', `
    <div class="form-grid">
      <div class="field">
        <label>媽媽</label>
        <select id="bk-mother">${mothers.map(m =>
          `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>房間</label>
        <select id="bk-room">${rooms.map(r =>
          `<option value="${r.id}" ${String(r.id) === String(prefill.room_id) ? 'selected' : ''}>${esc(r.name)}（${esc(r.room_type)}，${fmtMoney(r.price_per_day)}/日）</option>`).join('')}</select>
      </div>
      <div class="field"><label>入住日</label><input type="date" id="bk-in" value="${esc(prefill.check_in || '')}"></div>
      <div class="field"><label>退房日</label><input type="date" id="bk-out"></div>
      <div class="field"><label>訂金</label><input type="number" id="bk-deposit" inputmode="numeric" value="0"></div>
      <div class="field"><label>合約總額</label><input type="number" id="bk-total" inputmode="numeric" value="0"></div>
      <div class="full row">
        <button class="btn" id="bk-save">儲存</button>
        <span class="error-msg" id="bk-err"></span>
      </div>
    </div>`, body => {
    const inEl = body.querySelector('#bk-in');
    const outEl = body.querySelector('#bk-out');
    const calcTotal = () => {
      const room = rooms.find(r => String(r.id) === body.querySelector('#bk-room').value);
      if (!room || !inEl.value || !outEl.value) return;
      const days = Math.round((new Date(outEl.value) - new Date(inEl.value)) / 86400000);
      if (days > 0) body.querySelector('#bk-total').value = days * room.price_per_day;
    };
    inEl.onchange = calcTotal;
    outEl.onchange = calcTotal;
    body.querySelector('#bk-room').onchange = calcTotal;
    body.querySelector('#bk-save').onclick = async () => {
      try {
        await api('/bookings', {
          method: 'POST',
          body: {
            mother_id: body.querySelector('#bk-mother').value,
            room_id: body.querySelector('#bk-room').value,
            check_in: inEl.value,
            check_out: outEl.value,
            deposit: Number(body.querySelector('#bk-deposit').value) || 0,
            total_amount: Number(body.querySelector('#bk-total').value) || 0
          }
        });
        closeModal();
        viewRooms();
      } catch (e) {
        body.querySelector('#bk-err').textContent = e.message;
      }
    };
  });
}

// 房況月曆：房間 × 日期格狀檢視，已訂房著色、點空格快速建檔
async function wireRoomCalendar(rooms, mothers, start) {
  const cal = await api(`/room-calendar?start=${start || todayStr()}&days=30`);
  const days = [];
  for (let i = 0; i < cal.days; i++) days.push(new Date(new Date(cal.start).getTime() + i * 86400000).toISOString().slice(0, 10));
  const td = todayStr();
  const headCells = days.map(d => {
    const wd = '日一二三四五六'[new Date(d).getDay()];
    return `<th style="min-width:30px;padding:2px;font-weight:${d === td ? '700' : '400'};${d === td ? 'color:var(--primary-dark)' : ''}">${d.slice(8)}<br><small>${wd}</small></th>`;
  }).join('');
  const bodyRows = cal.rooms.map(r => {
    const cells = days.map(d => {
      const bk = cal.bookings.find(b => b.room_id === r.id && b.check_in <= d && b.check_out > d);
      if (bk) {
        const isStart = bk.check_in === d || d === cal.start;
        const color = bk.status === 'checked_in' ? '#cdeae4' : '#fdeec2';
        return `<td title="${esc(bk.mother_name)}（${esc(bk.check_in)}~${esc(bk.check_out)}）" style="background:${color};padding:2px;font-size:11px;white-space:nowrap;overflow:hidden;max-width:0">${isStart ? esc(bk.mother_name.slice(0, 4)) : ''}</td>`;
      }
      return `<td data-cal-room="${r.id}" data-cal-date="${d}" style="cursor:pointer;padding:2px;border:1px solid #eef2f1"></td>`;
    }).join('');
    return `<tr><th style="text-align:left;white-space:nowrap;padding:2px 6px;position:sticky;left:0;background:#fff">${esc(r.name)}<br><small style="color:var(--muted)">${esc(r.room_type)}</small></th>${cells}</tr>`;
  }).join('');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="row between"><h3>房況月曆</h3>
      <span style="font-size:.8rem;color:var(--muted)"><span class="badge green">入住中</span> <span class="badge yellow">已預約</span>　點空白格可快速建立訂房</span></div>
    <div class="table-wrap" style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px">
      <thead><tr><th style="position:sticky;left:0;background:#eef5f4;padding:2px 6px">房號</th>${headCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table></div>`;
  // 插在「訂房」卡片之前
  const cards = main().querySelectorAll('.card');
  main().insertBefore(card, cards[cards.length - 1]);
  card.querySelectorAll('[data-cal-room]').forEach(td => td.onclick = () =>
    openBookingForm(rooms, mothers, { room_id: td.dataset.calRoom, check_in: td.dataset.calDate }));
}

/* ---------- 排床（預定床表 / 實際入住床表） ---------- */
let bedTab = 'planned'; // planned=預定床表, actual=實際入住床表
async function viewBedPlanning() {
  const start = (location.hash.split('?s=')[1] || todayStr());
  const [cal, rooms, mothers] = await Promise.all([
    api(`/room-calendar?start=${start}&days=30`), api('/rooms'), api('/mothers')
  ]);
  const days = [];
  for (let i = 0; i < cal.days; i++) days.push(new Date(new Date(cal.start).getTime() + i * 86400000).toISOString().slice(0, 10));
  const td = todayStr();

  // 今日預定 vs 實際入住統計
  const coversToday = b => b.check_in <= td && b.check_out > td;
  const plannedToday = cal.bookings.filter(coversToday).length;
  const actualToday = cal.bookings.filter(b => b.status === 'checked_in' && coversToday(b)).length;
  const pendingToday = cal.bookings.filter(b => b.status === 'reserved' && coversToday(b)).length;

  const headCells = days.map(d => {
    const wd = '日一二三四五六'[new Date(d).getDay()];
    return `<th style="min-width:30px;padding:2px;font-weight:${d === td ? '700' : '400'};${d === td ? 'color:var(--primary-dark)' : ''}">${d.slice(8)}<br><small>${wd}</small></th>`;
  }).join('');

  // mode='planned'：預定（reserved+checked_in 皆著色）；mode='actual'：僅 checked_in 著色，reserved 顯示待入住
  const matrix = mode => cal.rooms.map(r => {
    const cells = days.map(d => {
      const bk = cal.bookings.find(b => b.room_id === r.id && b.check_in <= d && b.check_out > d);
      if (bk) {
        const isStart = bk.check_in === d || d === cal.start;
        if (mode === 'actual' && bk.status !== 'checked_in') {
          // 預定但尚未實際入住：以斜線淡色標示「待入住」
          return `<td title="${esc(bk.mother_name)} 預定未入住" style="background:repeating-linear-gradient(45deg,#fff,#fff 4px,#fdeec2 4px,#fdeec2 8px);padding:2px;font-size:10px;color:#b9911f;white-space:nowrap;overflow:hidden;max-width:0">${isStart ? '待' : ''}</td>`;
        }
        const color = bk.status === 'checked_in' ? '#cdeae4' : '#fdeec2';
        return `<td title="${esc(bk.mother_name)}（${esc(bk.check_in)}~${esc(bk.check_out)}・${STATUS_LABEL[bk.status]}）" style="background:${color};padding:2px;font-size:11px;white-space:nowrap;overflow:hidden;max-width:0">${isStart ? esc(bk.mother_name.slice(0, 4)) : ''}</td>`;
      }
      return mode === 'planned'
        ? `<td data-cal-room="${r.id}" data-cal-date="${d}" style="cursor:pointer;padding:2px;border:1px solid #eef2f1"></td>`
        : `<td style="padding:2px;border:1px solid #eef2f1"></td>`;
    }).join('');
    return `<tr><th style="text-align:left;white-space:nowrap;padding:2px 6px;position:sticky;left:0;background:#fff">${esc(r.name)}<br><small style="color:var(--muted)">${esc(r.room_type)}</small></th>${cells}</tr>`;
  }).join('');

  const legend = bedTab === 'planned'
    ? '<span class="badge green">入住中</span> <span class="badge yellow">已預約</span>　點空白格可快速建立訂房'
    : '<span class="badge green">實際入住中</span>　斜線格＝已預約尚未辦理入住';

  main().innerHTML = `
    <div class="page-title">排床</div>
    <div class="card no-print">
      <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:170px;margin:0"><label>起始日</label><input type="date" id="bp-start" value="${esc(cal.start)}"></div>
        <div class="row" style="gap:4px">
          <button class="btn small ${bedTab === 'planned' ? '' : 'secondary'}" id="bp-tab-planned">預定床表</button>
          <button class="btn small ${bedTab === 'actual' ? '' : 'secondary'}" id="bp-tab-actual">實際入住床表</button>
        </div>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="num">${plannedToday}</div><div class="label">今日預定床數</div></div>
      <div class="stat"><div class="num" style="color:var(--primary-dark)">${actualToday}</div><div class="label">今日實際入住</div></div>
      <div class="stat"><div class="num" ${pendingToday ? 'style="color:var(--danger)"' : ''}>${pendingToday}</div><div class="label">已預約待入住</div></div>
      <div class="stat"><div class="num">${cal.rooms.length}</div><div class="label">總床位</div></div>
    </div>
    <div class="card">
      <div class="row between"><h3>${bedTab === 'planned' ? '預定床表' : '實際入住床表'}（${esc(cal.start)} 起 30 天）</h3>
        <span style="font-size:.8rem;color:var(--muted)">${legend}</span></div>
      <div class="table-wrap" style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px">
        <thead><tr><th style="position:sticky;left:0;background:#eef5f4;padding:2px 6px">房號</th>${headCells}</tr></thead>
        <tbody>${matrix(bedTab)}</tbody>
      </table></div>
    </div>`;

  $('#bp-start').onchange = () => { location.hash = `#/bed-planning?s=${$('#bp-start').value}`; viewBedPlanning(); };
  $('#bp-tab-planned').onclick = () => { bedTab = 'planned'; viewBedPlanning(); };
  $('#bp-tab-actual').onclick = () => { bedTab = 'actual'; viewBedPlanning(); };
  main().querySelectorAll('[data-cal-room]').forEach(c => c.onclick = () =>
    openBookingForm(rooms, mothers, { room_id: c.dataset.calRoom, check_in: c.dataset.calDate }));
}

/* ---------- 房務清潔 ---------- */
function hkNeedOptions() {
  return (SETTINGS.hk_need_options || '').split(',').map(s => s.trim()).filter(Boolean);
}
function hkTaskPresets() {
  return (SETTINGS.hk_task_presets || '').split(',').map(s => s.trim()).filter(Boolean);
}
async function viewHousekeeping() {
  const date = location.hash.split('?d=')[1] || todayStr();
  const data = await api(`/housekeeping?date=${date}`);
  const isAdmin = currentUser.role === 'admin';

  const resCards = data.residents.length ? data.residents.map(r => {
    const needs = (r.hk_needs || '').split(',').map(s => s.trim()).filter(Boolean);
    return `
    <div class="card" style="margin:0">
      <div class="row between" style="align-items:flex-start">
        <div><strong>${esc(r.room_name)} 房</strong>　${esc(r.mother_name)}
          ${r.pending_tasks ? `<span class="badge yellow">待清潔 ${r.pending_tasks}</span>` : ''}</div>
        <button class="btn small secondary" data-hk-edit="${r.mother_id}">編輯需求</button>
      </div>
      <div style="font-size:.86rem;margin-top:6px">
        <div>勿擾時間：${r.hk_dnd ? esc(r.hk_dnd) : '<span style="color:var(--muted)">未設定</span>'}</div>
        <div style="margin-top:4px">需求：${needs.length ? needs.map(n => `<span class="badge teal">${esc(n)}</span>`).join(' ') : '<span style="color:var(--muted)">無</span>'}</div>
        ${r.hk_notes ? `<div style="margin-top:4px;color:#555">備註：${esc(r.hk_notes)}</div>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="empty">目前無入住中住客</div>';

  const taskRow = t => `
    <tr data-status="${t.status}">
      <td data-label="任務">${esc(t.task)}${t.note ? `<br><small style="color:#666">${esc(t.note)}</small>` : ''}</td>
      <td data-label="位置">${t.room_name ? esc(t.room_name) + ' 房' : ''}${t.mother_name ? `<br><small>${esc(t.mother_name)}</small>` : ''}</td>
      <td data-label="排定">${esc(t.scheduled_for || '')}${t.status === 'pending' && t.scheduled_for < date ? ' <span class="badge red">逾期</span>' : ''}</td>
      <td data-label="狀態">${t.status === 'done'
        ? `<span class="badge green">已完成</span><br><small>${esc((t.done_at || '').slice(5, 16))} ${esc(t.done_name || '')}</small>`
        : '<span class="badge yellow">待處理</span>'}</td>
      <td data-label="操作">
        ${t.status === 'pending'
          ? `<button class="btn small" data-hk-done="${t.id}">完成</button>`
          : `<button class="btn small secondary" data-hk-undo="${t.id}">取消完成</button>`}
        ${isAdmin ? `<button class="btn small danger" data-hk-del="${t.id}">刪除</button>` : ''}
      </td>
    </tr>`;

  main().innerHTML = `
    <div class="page-title">房務清潔</div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:170px;margin:0"><label>日期</label><input type="date" id="hk-date" value="${esc(data.date)}"></div>
        <button class="btn small" id="hk-add-task">新增清潔任務</button>
      </div>
    </div>
    <div class="card">
      <h3>住客需求（入住中 ${data.residents.length} 位）</h3>
      <p style="font-size:.8rem;color:var(--muted);margin:0 0 10px">客服在此登記住客需求（勿擾時間／哺乳衣／定時清垃圾…），清潔人員即可同步看到。</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">${resCards}</div>
    </div>
    <div class="card">
      <h3>清潔任務（${esc(data.date)}）</h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>任務</th><th>位置</th><th>排定日</th><th>狀態</th><th></th></tr></thead>
        <tbody>${data.tasks.map(taskRow).join('') || '<tr><td colspan="5"><div class="empty">本日尚無清潔任務</div></td></tr>'}</tbody>
      </table></div>
    </div>`;

  $('#hk-date').onchange = () => { location.hash = `#/housekeeping?d=${$('#hk-date').value}`; viewHousekeeping(); };
  $('#hk-add-task').onclick = () => openHkTaskForm(data.residents, data.date);
  main().querySelectorAll('[data-hk-edit]').forEach(b => b.onclick = () =>
    openHkNeedsForm(data.residents.find(r => String(r.mother_id) === b.dataset.hkEdit)));
  main().querySelectorAll('[data-hk-done]').forEach(b => b.onclick = async () => {
    await api(`/housekeeping/tasks/${b.dataset.hkDone}`, { method: 'PUT', body: { status: 'done' } }); viewHousekeeping();
  });
  main().querySelectorAll('[data-hk-undo]').forEach(b => b.onclick = async () => {
    await api(`/housekeeping/tasks/${b.dataset.hkUndo}`, { method: 'PUT', body: { status: 'pending' } }); viewHousekeeping();
  });
  main().querySelectorAll('[data-hk-del]').forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除這筆清潔任務？')) return;
    await api(`/housekeeping/tasks/${b.dataset.hkDel}`, { method: 'DELETE' }); viewHousekeeping();
  });
}

function openHkNeedsForm(r, onDone) {
  const cur = (r.hk_needs || '').split(',').map(s => s.trim()).filter(Boolean);
  const checks = hkNeedOptions().map(n =>
    `<label class="perm-chk"><input type="checkbox" value="${esc(n)}" ${cur.includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('');
  openModal(`需求設定 — ${esc(r.room_name)} 房 ${esc(r.mother_name)}`, `
    <div class="form-grid">
      <div class="field full"><label>勿擾時間</label><input id="hk-dnd" value="${esc(r.hk_dnd || '')}" placeholder="例如：13:00-15:00 午休"></div>
      <div class="field full"><label>需求項目</label><div style="display:flex;flex-wrap:wrap;gap:8px">${checks}</div></div>
      <div class="field full"><label>其他備註</label><textarea id="hk-notes" rows="2">${esc(r.hk_notes || '')}</textarea></div>
    </div>
    <div class="row mt"><button class="btn" id="hk-save">儲存</button><span class="error-msg" id="hk-err"></span></div>`, body => {
    body.querySelector('#hk-save').onclick = async () => {
      const needs = [...body.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value).join(',');
      try {
        await api(`/mothers/${r.mother_id}/housekeeping`, { method: 'PUT', body: {
          hk_dnd: body.querySelector('#hk-dnd').value, hk_needs: needs, hk_notes: body.querySelector('#hk-notes').value
        } });
        closeModal(); (onDone || viewHousekeeping)();
      } catch (e) { body.querySelector('#hk-err').textContent = e.message; }
    };
  });
}

// 清潔任務固定選項（與家屬入口「聯絡清潔」一致；設定的常用任務會併入）
const HK_TASK_OPTIONS = ['清潔地板', '更換床單', '馬桶', '浴室', '倒垃圾', '補充備品', '紫外線消毒', '清潔拖鞋', '清潔玻璃'];
function openHkTaskForm(residents, date) {
  const options = [...new Set([...HK_TASK_OPTIONS, ...hkTaskPresets()])];
  openModal('新增清潔任務', `
    <div class="form-grid">
      <div class="field full"><label>任務</label>
        <select id="hkt-task">${options.map(p => `<option>${esc(p)}</option>`).join('')}<option>其他</option></select>
      </div>
      <div class="field full" id="hkt-other-wrap" style="display:none"><label>其他（請說明）</label><input id="hkt-other" placeholder="請描述清潔任務"></div>
      <div class="field full"><label>對象房間／住客（可不選＝公共區域）</label>
        <select id="hkt-target"><option value="">— 公共區域 / 不指定 —</option>${residents.map(r =>
          `<option value="${r.room_id}|${r.mother_id}">${esc(r.room_name)} 房　${esc(r.mother_name)}</option>`).join('')}</select></div>
      <div class="field"><label>排定日期</label><input type="date" id="hkt-date" value="${esc(date)}"></div>
      <div class="field full"><label>備註</label><input id="hkt-note"></div>
    </div>
    <div class="row mt"><button class="btn" id="hkt-save">新增</button><span class="error-msg" id="hkt-err"></span></div>`, body => {
    const taskSel = body.querySelector('#hkt-task');
    taskSel.onchange = () => { body.querySelector('#hkt-other-wrap').style.display = taskSel.value === '其他' ? '' : 'none'; };
    body.querySelector('#hkt-save').onclick = async () => {
      const task = taskSel.value === '其他' ? body.querySelector('#hkt-other').value.trim() : taskSel.value;
      if (!task) { body.querySelector('#hkt-err').textContent = '任務選「其他」時請說明內容'; return; }
      const [room_id, mother_id] = (body.querySelector('#hkt-target').value || '|').split('|');
      try {
        await api('/housekeeping/tasks', { method: 'POST', body: {
          task, room_id: room_id || null, mother_id: mother_id || null,
          scheduled_for: body.querySelector('#hkt-date').value, note: body.querySelector('#hkt-note').value
        } });
        closeModal(); viewHousekeeping();
      } catch (e) { body.querySelector('#hkt-err').textContent = e.message; }
    };
  });
}

/* ---------- 收費帳務 ---------- */
async function viewBilling() {
  // 已退房且已結清者不顯示（僅列：入住中未結清／入住中已結清／已退房未結清）
  const rows = (await api('/billing')).filter(b => !(b.status === 'checked_out' && b.balance <= 0));
  const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  // 入住超過 3 天仍未結清「合約金額」→ 整列變底色
  const isOverdue = b => b.status === 'checked_in' && b.contract_balance > 0
    && (new Date(todayStr) - new Date(b.check_in)) / 86400000 > 3;
  main().innerHTML = `
    <div class="page-title">收費帳務</div>
    <div class="card">
      ${filterBar({ placeholder: '搜尋媽媽 / 房間…', statuses: [{ val: '', label: '全部' }, { val: 'unpaid', label: '未結清' }, { val: 'paid', label: '已結清' }] })}
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>媽媽</th><th>房間 / 期間</th><th>應收</th><th>已收</th><th>未結餘額</th><th></th></tr></thead>
          <tbody>${rows.map(b => `
            <tr class="${isOverdue(b) ? 'row-overdue' : ''}" data-filter="${esc(b.mother_name + ' ' + b.room_name)}" data-status="${b.balance > 0 ? 'unpaid' : 'paid'}">
              <td data-label="媽媽">${esc(b.mother_name)}　<span class="badge ${STATUS_BADGE[b.status]}">${STATUS_LABEL[b.status]}</span></td>
              <td data-label="房間 / 期間">${esc(b.room_name)} 房<br><small>${esc(b.check_in)} ~ ${esc(b.check_out)}</small></td>
              <td data-label="應收">${fmtMoney(b.total_due)}<br><small>合約 ${fmtMoney(b.total_amount)}＋加購 ${fmtMoney(b.charges_total)}${b.baby_deduct ? `−寶寶不在館內 ${fmtMoney(b.baby_deduct)}` : ''}</small></td>
              <td data-label="已收">${fmtMoney(b.total_paid)}<br><small>含訂金 ${fmtMoney(b.deposit)}</small></td>
              <td data-label="未結餘額">${b.balance > 0
                ? `<strong style="color:var(--danger)">${fmtMoney(b.balance)}</strong> <span class="badge red">未結清</span><br><small>合約 ${fmtMoney(b.contract_balance)}＋加購 ${fmtMoney(b.addon_balance)}</small>`
                : '<span class="badge green">已結清</span>'}</td>
              <td data-label="操作"><button class="btn small secondary" data-detail="${b.id}">收費明細</button>${b.balance > 0 ? ` <button class="btn small" data-notify="${b.id}">通知繳費</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="6"><div class="empty">尚無訂房資料</div></td></tr>'}</tbody>
        </table>
      </div>
      ${rows.some(isOverdue) ? '<p style="font-size:.8rem;color:var(--muted);margin:8px 0 0">底色列＝入住超過 3 天，合約金額尚未結清。</p>' : ''}
    </div>`;
  wireFilter(main());
  main().querySelectorAll('[data-detail]').forEach(btn => {
    btn.onclick = () => {
      $('#modal').onclose = () => { $('#modal').onclose = null; viewBilling(); };
      openBillingDetail(btn.dataset.detail);
    };
  });
  main().querySelectorAll('[data-notify]').forEach(btn => btn.onclick = async () => {
    if (!confirm('發送繳費通知給家屬（留言＋已綁定者 LINE）？')) return;
    try {
      const r = await api(`/bookings/${btn.dataset.notify}/dun`, { method: 'POST' });
      alert(`已送出繳費通知${r.notified ? `，並推播 ${r.notified} 位家屬 LINE` : '（家屬留言已送出；尚無綁定 LINE 之家屬）'}`);
    } catch (e) { alert(e.message); }
  });
}

// 另開視窗列印：寶寶報喜入住通知單
function printBabyAnnounce(m, bk, birth, cd, p, stayDays) {
  const center = (SETTINGS && SETTINGS.center_name) || 'MamaCare';
  const babyCells = p.babies.map((x, i) => `
    <tr><td>體重${p.babies.length > 1 ? i + 1 : ''}</td><td>${x.weight_g} g</td>
    <td>性別${p.babies.length > 1 ? i + 1 : ''}</td><td>${x.gender === 'male' ? '男' : '女'}</td></tr>`).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">
    <title>入住通知單 - ${esc(m.name)}</title>
    <style>
      body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 24px}
      h1{font-size:18px;text-align:center;margin:0 0 2px}
      .sub{text-align:center;font-size:13px;color:#444;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;font-size:14px}
      td{border:1px solid #333;padding:6px 8px}
      td:nth-child(odd){background:#f4f6f5;width:14%;white-space:nowrap}
      .wide td:nth-child(odd){width:auto}
      @media print{.noprint{display:none}}
    </style></head><body>
    <h1>${esc(center)}　入住通知單</h1>
    <div class="sub">第一聯　客服收執聯　（媽媽生日：${esc(m.birth_date || '—')}）</div>
    <table>
      <tr><td>房號</td><td>${esc(bk.room_name || '—')}</td><td>姓名</td><td>${esc(m.name)}</td>
        <td>生產日期</td><td>${esc(birth.birth_date)}</td><td>後四碼</td><td>${esc(p.id4 || (m.id_no || '').slice(-4) || '—')}</td></tr>
      <tr><td>入住日</td><td>${esc(bk.check_in || '—')}</td><td>出住日</td><td>${esc(bk.check_out || '—')}</td>
        <td>生產方式</td><td>${esc(birth.birth_mode)}</td><td>胎次</td><td>${esc(cd.parity_no || '—')}</td></tr>
      <tr><td>生產醫院</td><td>${esc(birth.birth_hospital)}</td><td>妊娠週數</td><td>${esc(p.weeks || '—')}</td>
        <td>總天數</td><td>${stayDays ? stayDays + ' 天' : '—'}</td><td>哺乳衣尺寸</td><td>${esc(p.bra_size || '—')}</td></tr>
      ${babyCells}
      <tr><td>餐別</td><td>${esc(p.meal_choice || '—')}</td><td>禁忌</td><td colspan="5">${esc(p.diet_type || '')}　${esc(p.taboos || '無')}</td></tr>
      <tr class="wide"><td>贈</td><td colspan="7">${esc(p.gift || cd.gift_content || '—')}</td></tr>
      <tr class="wide"><td>電話</td><td colspan="7">媽咪：${esc(p.phone_mom || '—')}　　把拔：${esc(p.phone_dad || '—')}</td></tr>
      <tr><td>車號</td><td>${esc(p.car_no || '—')}</td><td>製單</td><td>${esc(currentUser.name)}</td>
        <td>日期</td><td colspan="3">${esc(todayStr())}</td></tr>
    </table>
    <div class="noprint" style="margin-top:20px;text-align:center">
      <button onclick="window.print()" style="padding:10px 24px;font-size:15px">列印 / 另存 PDF</button>
    </div>
    </body></html>`);
  win.document.close();
}

// 另開視窗列印／另存 PDF：加購消費明細
function printCharges(b) {
  const center = (SETTINGS && SETTINGS.center_name) || 'MamaCare';
  const rows = (b.charges || []).map(c => `
    <tr>
      <td>${esc(c.charged_on)}</td>
      <td>${esc(c.item_name)}${c.note ? `<br><small style="color:#666">${esc(c.note)}</small>` : ''}</td>
      <td style="text-align:right">${fmtMoney(c.unit_price)}</td>
      <td style="text-align:center">${c.quantity}</td>
      <td style="text-align:right">${fmtMoney(c.unit_price * c.quantity)}</td>
      <td>${esc(c.staff_name || '-')}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#888">尚無加購消費</td></tr>';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">
    <title>加購消費明細 - ${esc(b.mother_name)}</title>
    <style>
      body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#1c2b29;line-height:1.6;
        max-width:760px;margin:24px auto;padding:0 24px}
      h1{font-size:20px;margin:0 0 4px} .sub{color:#666;font-size:13px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:14px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
      th{background:#f2f7f6}
      tfoot td{font-weight:700;background:#fafafa}
      .meta{font-size:13px;color:#444;margin-bottom:12px}
      @media print{.noprint{display:none}}
    </style></head><body>
    <h1>${esc(center)}　加購消費明細</h1>
    <div class="sub">列印時間：${esc(new Date().toLocaleString('zh-TW'))}</div>
    <div class="meta">
      媽媽：${esc(b.mother_name)}　房間：${esc(b.room_name)} 房
      期間：${esc(b.check_in)} ~ ${esc(b.check_out)}
    </div>
    <table>
      <thead><tr><th>日期</th><th>項目</th><th>單價</th><th>數量</th><th>小計</th><th>經手</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4" style="text-align:right">加購消費合計</td><td style="text-align:right">${fmtMoney(b.charges_total)}</td><td></td></tr></tfoot>
    </table>
    ${b.baby_deduct ? `<p style="font-size:13px;color:#555;margin-top:10px">另：寶寶不在館內扣抵 ${b.baby_absent_days} 天 −${fmtMoney(b.baby_deduct)}（已反映於應收總額）</p>` : ''}
    <div class="noprint" style="margin-top:24px;text-align:center">
      <button onclick="window.print()" style="padding:10px 24px;font-size:15px">列印 / 另存 PDF</button>
    </div>
    </body></html>`);
  win.document.close();
}

async function openBillingDetail(bookingId) {
  const b = await api(`/bookings/${bookingId}/billing`);
  const isAdmin = currentUser.role === 'admin';
  const chargeRows = b.charges.length ? b.charges.map(c => `
    <tr>
      <td data-label="日期">${esc(c.charged_on)}</td>
      <td data-label="項目">${esc(c.item_name)}${c.note ? `<br><small>${esc(c.note)}</small>` : ''}</td>
      <td data-label="金額">${fmtMoney(c.unit_price)} × ${c.quantity} = ${fmtMoney(c.unit_price * c.quantity)}</td>
      <td data-label="經手">${esc(c.staff_name || '-')}</td>
      <td data-label="操作">${isAdmin ? `<button class="btn small danger" data-del-charge="${c.id}">刪除</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty">尚無加購消費</div></td></tr>';
  const payRows = b.payments.length ? b.payments.map(p => `
    <tr>
      <td data-label="日期">${esc(p.paid_on)}</td>
      <td data-label="項目">${esc(p.item || (p.target === 'addon' ? '—' : '房費'))}<br><span class="badge ${p.target === 'addon' ? 'purple' : 'teal'}">${p.target === 'addon' ? '加購款' : '合約款'}</span></td>
      <td data-label="方式">${esc(p.method)}${p.note ? `<br><small>${esc(p.note)}</small>` : ''}</td>
      <td data-label="金額">${fmtMoney(p.amount)}</td>
      <td data-label="經手">${esc(p.staff_name || '-')}</td>
      <td data-label="操作">${isAdmin ? `<button class="btn small danger" data-del-pay="${p.id}">刪除</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty">尚無繳費紀錄</div></td></tr>';

  const absRows = (b.absences || []).length ? b.absences.map(a => `
    <tr data-ab-row="${a.id}" data-start="${esc(a.start_date)}" data-end="${esc(a.end_date || '')}" data-note="${esc(a.note || '')}">
      <td data-label="起始日">${esc(a.start_date)}</td>
      <td data-label="結束日">${a.end_date ? esc(a.end_date) : '<span class="badge yellow">仍不在館內</span>'}</td>
      <td data-label="天數">${a.days} 天</td>
      <td data-label="備註"><small>${esc(a.note || '')}</small></td>
      <td data-label="操作"><button class="btn small secondary" data-ab-edit="${a.id}">編輯</button> <button class="btn small danger" data-ab-del="${a.id}">刪除</button></td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty">尚無不在館內紀錄</div></td></tr>';
  const deductRate = Number(SETTINGS.baby_absence_daily_deduct) || 0;

  openModal(`收費明細：${b.mother_name}（${b.room_name} 房）`, `
    <div class="table-wrap"><table class="data" style="margin-bottom:12px">
      <thead><tr><th>款別（分開開立發票）</th><th>應收</th><th>已收</th><th>未結</th></tr></thead>
      <tbody>
        <tr>
          <td>合約款${b.baby_deduct ? `<br><small>已扣寶寶不在館內 ${fmtMoney(b.baby_deduct)}</small>` : ''}</td>
          <td>${fmtMoney(b.contract_due)}</td>
          <td>${fmtMoney(b.paid_contract)}<br><small>含訂金 ${fmtMoney(b.deposit)}</small></td>
          <td>${b.contract_balance > 0 ? `<strong style="color:var(--danger)">${fmtMoney(b.contract_balance)}</strong>`
            : b.contract_balance < 0 ? `<strong style="color:var(--primary-dark)">${fmtMoney(b.contract_balance)}</strong><br><small>溢收（待退／折抵）</small>`
            : '<span class="badge green">已結清</span>'}</td>
        </tr>
        <tr>
          <td>加購款</td>
          <td>${fmtMoney(b.addon_due)}</td>
          <td>${fmtMoney(b.paid_addon)}</td>
          <td>${b.addon_balance > 0 ? `<strong style="color:var(--danger)">${fmtMoney(b.addon_balance)}</strong>`
            : b.addon_balance < 0 ? `<strong style="color:var(--primary-dark)">${fmtMoney(b.addon_balance)}</strong><br><small>溢收</small>`
            : '<span class="badge green">已結清</span>'}</td>
        </tr>
        <tr style="border-top:2px solid #cdd">
          <td><strong>合計</strong>　${b.balance > 0 ? '<span class="badge red">未結清</span>' : '<span class="badge green">已結清</span>'}</td>
          <td><strong>${fmtMoney(b.total_due)}</strong></td>
          <td><strong>${fmtMoney(b.total_paid)}</strong></td>
          <td><strong style="${b.balance > 0 ? 'color:var(--danger)' : ''}">${fmtMoney(b.balance)}</strong></td>
        </tr>
      </tbody>
    </table></div>
    <div class="row" style="margin-bottom:10px">
      <button class="btn small secondary" id="bd-refund">退費試算</button>
      <button class="btn small secondary" id="bd-receipt">開立收據</button>
      <button class="btn small secondary" id="bd-print-charges">列印加購明細</button>
    </div>
    <div class="card" style="background:#f7faf9;padding:10px 12px;margin-bottom:12px">
      <div style="font-weight:600;color:var(--primary-dark);margin-bottom:6px">寶寶不在館內紀錄</div>
      <div class="table-wrap"><table class="data" style="font-size:.86rem">
        <thead><tr><th>起始日</th><th>結束日（回館）</th><th>天數</th><th>備註</th><th></th></tr></thead>
        <tbody>${absRows}</tbody>
      </table></div>
      <div class="row" style="align-items:flex-end;gap:8px;flex-wrap:wrap;margin-top:8px">
        <div class="field" style="max-width:160px;margin:0"><label>起始日</label><input type="date" id="ab-start"></div>
        <div class="field" style="max-width:160px;margin:0"><label>結束日（可留空＝至今）</label><input type="date" id="ab-end"></div>
        <div class="field" style="max-width:200px;margin:0"><label>備註</label><input id="ab-note"></div>
        <button class="btn small" id="ab-add">新增</button>
        <span class="error-msg" id="ab-err"></span>
      </div>
      <p style="font-size:.76rem;color:var(--muted);margin:8px 0 0">
        由寶寶照護「住院中／不在館內」位置紀錄自動帶入，可編輯日期或手動新增。
        合計 <strong>${b.baby_absent_days} 天</strong> × ${fmtMoney(deductRate)}/日，
        扣抵 <strong style="color:var(--primary-dark)">${fmtMoney(b.baby_deduct)}</strong>，已自動調整合約應收
        （合約已先付全額時，合約未結會呈負數）。費率於系統設定調整。
      </p>
    </div>
    <div id="bd-refund-box"></div>
    <h3 style="color:var(--primary-dark);font-size:1rem;margin:8px 0">加購消費</h3>
    <div class="table-wrap"><table class="data stack">
      <thead><tr><th>日期</th><th>項目</th><th>金額</th><th>經手</th><th></th></tr></thead>
      <tbody>${chargeRows}</tbody>
    </table></div>
    <div class="form-grid" style="margin-top:10px">
      <div class="field">
        <label>項目</label>
        <select id="cg-item">
          ${chargePresets().map(p => `<option>${esc(p)}</option>`).join('')}
          <option value="__other">其他（自行輸入）</option>
        </select>
      </div>
      <div class="field" id="cg-name-wrap" style="display:none"><label>其他項目名稱</label><input id="cg-name" placeholder="自行輸入項目"></div>
      <div class="field"><label>單價</label><input type="number" id="cg-price" inputmode="numeric" min="0"></div>
      <div class="field"><label>數量</label><input type="number" id="cg-qty" inputmode="numeric" min="1" value="1"></div>
      <div class="field"><label>日期</label><input type="date" id="cg-date" value="${todayStr()}"></div>
      <div class="field full"><label>備註</label><input id="cg-note"></div>
      <div class="full row">
        <button class="btn small" id="cg-save">新增消費</button>
        <span class="error-msg" id="cg-err"></span>
      </div>
    </div>
    <h3 style="color:var(--primary-dark);font-size:1rem;margin:14px 0 8px">繳費紀錄</h3>
    <div class="table-wrap"><table class="data stack">
      <thead><tr><th>日期</th><th>項目 / 款別</th><th>方式</th><th>金額</th><th>經手</th><th></th></tr></thead>
      <tbody>${payRows}</tbody>
    </table></div>
    <div class="form-grid" style="margin-top:10px">
      <div class="field">
        <label>項目<small>（房費＝合約款，其餘＝加購款）</small></label>
        <select id="py-item">
          <option>房費</option>
          ${chargePresets().map(p => `<option>${esc(p)}</option>`).join('')}
          <option value="__other">其他（自行輸入）</option>
        </select>
      </div>
      <div class="field" id="py-item-wrap" style="display:none"><label>其他項目名稱</label><input id="py-item-name" placeholder="自行輸入項目"></div>
      <div class="field"><label>金額</label><input type="number" id="py-amount" inputmode="numeric" min="1"></div>
      <div class="field">
        <label>繳費方式</label>
        <select id="py-method">${paymentMethods().map(m => `<option>${esc(m)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>日期</label><input type="date" id="py-date" value="${todayStr()}"></div>
      <div class="field"><label>備註</label><input id="py-note" placeholder="例如：第二期款"></div>
      <div class="full row">
        <button class="btn small" id="py-save">新增繳費</button>
        <button class="btn small secondary" id="py-online" style="display:none">線上收款</button>
        <span class="error-msg" id="py-err"></span>
      </div>
    </div>`, body => {
    // 線上金流：已設定才顯示按鈕
    api('/pay/config').then(cfg => {
      if (!cfg.enabled) return;
      const btn = body.querySelector('#py-online');
      btn.style.display = '';
      btn.onclick = async () => {
        const amount = Number(body.querySelector('#py-amount').value) || (b.balance > 0 ? b.balance : 0);
        if (!amount) { body.querySelector('#py-err').textContent = '請輸入收款金額'; return; }
        try {
          const r = await api(`/bookings/${b.id}/payment-intent`, { method: 'POST', body: { amount } });
          window.open(r.checkout_url, '_blank');
        } catch (e) { body.querySelector('#py-err').textContent = e.message; }
      };
    }).catch(() => {});
    // 加購項目下拉：選「其他」才顯示自行輸入欄
    const itemSel = body.querySelector('#cg-item');
    itemSel.onchange = () => {
      body.querySelector('#cg-name-wrap').style.display = itemSel.value === '__other' ? '' : 'none';
    };
    body.querySelector('#cg-save').onclick = async () => {
      try {
        await api(`/bookings/${b.id}/charges`, {
          method: 'POST',
          body: {
            item_name: itemSel.value === '__other' ? body.querySelector('#cg-name').value.trim() : itemSel.value,
            unit_price: Number(body.querySelector('#cg-price').value),
            quantity: Number(body.querySelector('#cg-qty').value) || 1,
            charged_on: body.querySelector('#cg-date').value,
            note: body.querySelector('#cg-note').value
          }
        });
        openBillingDetail(b.id);
      } catch (e) {
        body.querySelector('#cg-err').textContent = e.message;
      }
    };
    // 繳費項目下拉：選「其他」才顯示自行輸入欄
    const pyItemSel = body.querySelector('#py-item');
    pyItemSel.onchange = () => {
      body.querySelector('#py-item-wrap').style.display = pyItemSel.value === '__other' ? '' : 'none';
    };
    body.querySelector('#py-save').onclick = async () => {
      const pyItem = pyItemSel.value === '__other' ? body.querySelector('#py-item-name').value.trim() : pyItemSel.value;
      if (!pyItem) { body.querySelector('#py-err').textContent = '請輸入其他項目名稱'; return; }
      try {
        await api(`/bookings/${b.id}/payments`, {
          method: 'POST',
          body: {
            amount: Number(body.querySelector('#py-amount').value),
            method: body.querySelector('#py-method').value,
            paid_on: body.querySelector('#py-date').value,
            note: body.querySelector('#py-note').value,
            item: pyItem
          }
        });
        openBillingDetail(b.id);
      } catch (e) {
        body.querySelector('#py-err').textContent = e.message;
      }
    };
    // 寶寶不在館內紀錄：新增／編輯／刪除
    body.querySelector('#ab-add').onclick = async () => {
      try {
        await api(`/bookings/${b.id}/absences`, {
          method: 'POST',
          body: {
            start_date: body.querySelector('#ab-start').value,
            end_date: body.querySelector('#ab-end').value,
            note: body.querySelector('#ab-note').value
          }
        });
        openBillingDetail(b.id);
      } catch (e) { body.querySelector('#ab-err').textContent = e.message; }
    };
    body.querySelectorAll('[data-ab-edit]').forEach(btn => {
      btn.onclick = () => {
        const tr = body.querySelector(`[data-ab-row="${btn.dataset.abEdit}"]`);
        tr.innerHTML = `
          <td data-label="起始日"><input type="date" data-ab-s value="${esc(tr.dataset.start)}" style="padding:4px 6px"></td>
          <td data-label="結束日"><input type="date" data-ab-e value="${esc(tr.dataset.end)}" style="padding:4px 6px"></td>
          <td data-label="天數"></td>
          <td data-label="備註"><input data-ab-n value="${esc(tr.dataset.note)}" style="padding:4px 6px"></td>
          <td data-label="操作"><button class="btn small" data-ab-save>儲存</button> <button class="btn small secondary" data-ab-cancel>取消</button></td>`;
        tr.querySelector('[data-ab-save]').onclick = async () => {
          try {
            await api(`/absences/${btn.dataset.abEdit}`, {
              method: 'PUT',
              body: {
                start_date: tr.querySelector('[data-ab-s]').value,
                end_date: tr.querySelector('[data-ab-e]').value,
                note: tr.querySelector('[data-ab-n]').value
              }
            });
            openBillingDetail(b.id);
          } catch (e) { body.querySelector('#ab-err').textContent = e.message; }
        };
        tr.querySelector('[data-ab-cancel]').onclick = () => openBillingDetail(b.id);
      };
    });
    body.querySelectorAll('[data-ab-del]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('確定刪除這筆不在館內紀錄？扣抵金額將同步調整。')) return;
        await api(`/absences/${btn.dataset.abDel}`, { method: 'DELETE' });
        openBillingDetail(b.id);
      };
    });
    body.querySelectorAll('[data-del-charge]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('確定刪除這筆消費？')) return;
        await api(`/charges/${btn.dataset.delCharge}`, { method: 'DELETE' });
        openBillingDetail(b.id);
      };
    });
    body.querySelectorAll('[data-del-pay]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('確定刪除這筆繳費紀錄？')) return;
        await api(`/payments/${btn.dataset.delPay}`, { method: 'DELETE' });
        openBillingDetail(b.id);
      };
    });
    const refundBox = body.querySelector('#bd-refund-box');
    const drawRefund = async (leaveDate) => {
      const q = await api(`/bookings/${b.id}/refund-quote${leaveDate ? `?leave_date=${leaveDate}` : ''}`);
      refundBox.innerHTML = `
        <div class="card" style="background:#f7faf9;padding:12px;margin-bottom:10px">
          <div class="row" style="margin-bottom:8px;align-items:flex-end">
            <div class="field" style="max-width:180px;margin:0"><label>離開日期</label><input type="date" id="rf-date" value="${esc(q.leave_date)}"></div>
            <span style="font-size:.82rem;color:var(--muted)">總天數 ${q.total_days}・已用 ${q.used_days}・未用 ${q.unused_days}・日費率 ${fmtMoney(q.daily_rate)}</span>
          </div>
          <table class="data" style="font-size:13px">
            <tbody>
              <tr><td>已收總額</td><td style="text-align:right">${fmtMoney(q.paid_total)}</td></tr>
              <tr><td>應收：已使用 ${q.used_days} 天住宿費</td><td style="text-align:right">${fmtMoney(q.used_fee)}</td></tr>
              <tr><td>應收：加購消費</td><td style="text-align:right">${fmtMoney(q.charges_total)}</td></tr>
              ${q.baby_deduct ? `<tr><td>扣抵：寶寶不在館內 ${q.baby_absent_days} 天</td><td style="text-align:right;color:var(--primary-dark)">-${fmtMoney(q.baby_deduct)}</td></tr>` : ''}
              <tr><td>違約金（未使用 ${q.unused_days} 天 × ${q.penalty_pct}%）</td><td style="text-align:right">${fmtMoney(q.penalty)}</td></tr>
              <tr><td>作業手續費（${q.handling_pct}%）</td><td style="text-align:right">${fmtMoney(q.handling)}</td></tr>
              <tr style="border-top:2px solid #cdd"><td><strong>應退費用</strong></td><td style="text-align:right"><strong style="color:var(--primary-dark);font-size:1.1rem">${fmtMoney(q.refund)}</strong></td></tr>
            </tbody>
          </table>
          <p style="font-size:.78rem;color:var(--muted);margin-top:6px">※ 試算結果，實際依雙方契約與衛福部產後護理機構定型化契約退費規定；違約金與手續費比例可於系統設定調整。</p>
        </div>`;
      refundBox.querySelector('#rf-date').onchange = e => drawRefund(e.target.value);
    };
    body.querySelector('#bd-refund').onclick = () => { if (refundBox.innerHTML) refundBox.innerHTML = ''; else drawRefund(); };
    body.querySelector('#bd-print-charges').onclick = () => printCharges(b);
    body.querySelector('#bd-receipt').onclick = () => {
      const due = b.balance > 0 ? b.balance : b.total_paid;
      invoiceForm([{ id: b.id, mother_name: b.mother_name, room_name: b.room_name }], {
        booking_id: b.id, buyer_name: b.mother_name,
        items: [{ name: `產後護理服務費（${b.mother_name}）`, qty: 1, price: due }]
      });
    };
  });
}

/* ---------- 膳食管理 ---------- */
async function viewMeals() {
  main().innerHTML = `
    <div class="page-title">膳食管理</div>
    <div class="card no-print">
      <div class="form-grid">
        <div class="field" style="max-width:220px"><label>日期</label><input type="date" id="ml-date" value="${todayStr()}"></div>
        <div class="field" style="display:flex;align-items:flex-end">
          <button class="btn secondary" id="ml-print">列印廚房備餐單</button>
        </div>
      </div>
      <p style="font-size:.85rem;color:var(--muted);margin-top:8px">
        選擇餐點後自動儲存；「未訂」表示當餐不需準備。飲食注意取自住客資料，會一併帶入備餐單。
        供餐自入住日「午餐」開始、至出住日「早餐」止；月子餐菜單以周為單位（周日開始）。
      </p>
    </div>
    <div class="card no-print" id="ml-swaps"></div>
    <div class="card no-print" id="ml-grid"><div class="empty">載入中</div></div>
    <div class="card" id="ml-kitchen"></div>
    <div class="card no-print" id="ml-menu-files"></div>
    <div class="card no-print">
      <h3>區間對帳（各家月子餐請款）</h3>
      <div class="row" style="align-items:flex-end;gap:8px;margin-bottom:10px">
        <div class="field" style="max-width:160px;margin:0"><label>起</label><input type="date" id="ms-start" value="${todayStr()}"></div>
        <div class="field" style="max-width:160px;margin:0"><label>迄</label><input type="date" id="ms-end" value="${todayStr()}"></div>
        <button class="btn" id="ms-go">統計</button>
      </div>
      <div id="ms-result"></div>
    </div>`;

  const refresh = async () => {
    const [data, swaps] = await Promise.all([
      api(`/meals?date=${$('#ml-date').value}`), api('/meal-swaps?status=pending')
    ]);
    const orderOf = (mid, mt) => data.orders.find(o => o.mother_id === mid && o.meal_type === mt);

    // 換餐申請（家屬入口送出）：點「完成」自動套入該日訂餐
    $('#ml-swaps').innerHTML = `
      <h3>換餐申請　<span class="badge ${swaps.length ? 'red' : 'green'}">待處理 ${swaps.length}</span></h3>
      <p style="font-size:.85rem;color:var(--muted);margin:6px 0 10px">媽咪（家屬入口）送出的換餐申請；點「完成」自動套入該日訂餐——希望更換內容若是有效餐點選項會直接改選項，否則寫入該餐備註帶入備餐單。</p>
      ${swaps.length ? `<div class="table-wrap"><table class="data stack">
        <thead><tr><th>用餐日</th><th>餐別</th><th>媽媽</th><th>目前餐點</th><th>希望更換</th><th>原因</th><th>申請人</th><th></th></tr></thead>
        <tbody>${swaps.map(s => `
          <tr>
            <td data-label="用餐日">${esc(s.meal_date)}</td>
            <td data-label="餐別">${esc(s.slot || '—')}</td>
            <td data-label="媽媽">${esc(s.mother_name)}</td>
            <td data-label="目前餐點">${esc(s.from_choice || '—')}</td>
            <td data-label="希望更換"><b>${esc(s.to_choice || '—')}</b></td>
            <td data-label="原因"><small>${esc(s.reason || '—')}</small></td>
            <td data-label="申請人"><small>${esc(s.family_name || '—')}・${esc((s.created_at || '').slice(5, 16))}</small></td>
            <td data-label="操作">
              <button class="btn small" data-swap-ok="${s.id}">完成</button>
              <button class="btn small secondary" data-swap-no="${s.id}">婉拒</button>
            </td>
          </tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">目前沒有待處理的換餐申請</div>'}`;
    $('#ml-swaps').querySelectorAll('[data-swap-ok]').forEach(b => b.onclick = async () => {
      try {
        const r = await api(`/meal-swaps/${b.dataset.swapOk}/handle`, { method: 'POST', body: { action: 'approved' } });
        if (r && r.applied === false) alert('已完成申請，但該餐別無法自動套入（請手動調整訂餐）');
        refresh();
      } catch (e) { alert(e.message); }
    });
    $('#ml-swaps').querySelectorAll('[data-swap-no]').forEach(b => b.onclick = async () => {
      const note = prompt('婉拒原因（會顯示給家屬）：', '');
      if (note === null) return;
      try { await api(`/meal-swaps/${b.dataset.swapNo}/handle`, { method: 'POST', body: { action: 'rejected', staff_note: note } }); refresh(); }
      catch (e) { alert(e.message); }
    });

    $('#ml-grid').innerHTML = `<h3>當日訂餐（在住 ${data.mothers.length} 位媽媽）</h3>` + (data.mothers.length ? `
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>房間</th><th>媽媽</th><th>飲食注意</th>
          ${Object.values(MEAL_LABEL).map(l => `<th>${l}</th>`).join('')}</tr></thead>
        <tbody>${data.mothers.map(m => `
          <tr>
            <td data-label="房間">${esc(m.room_name)}</td>
            <td data-label="媽媽">${esc(m.name)}</td>
            <td data-label="飲食注意">${esc(m.diet_notes || '-')}</td>
            ${Object.keys(MEAL_LABEL).map(mt => {
              const o = orderOf(m.id, mt);
              return `<td data-label="${MEAL_LABEL[mt]}">
                <select data-meal="${m.id}:${mt}">
                  <option value="">未訂</option>
                  ${mealChoices().map(c =>
                    `<option ${o && o.choice === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                </select>
                ${o ? `<input data-mnote="${m.id}:${mt}" value="${esc(o.note || '')}" placeholder="備註" style="width:100%;margin-top:2px;font-size:.8rem">` : ''}
              </td>`;
            }).join('')}
          </tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">該日無在住媽媽</div>');

    // 廚房備餐單（核餐單）：每家廠商一張表，逐房列早/午/晚份數、禁忌、生產、供餐期間、備註
    const fmtMD = d => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '';
    const dvCode = t => t === '自然產' ? 'N' : t === '剖腹產' ? 'C' : '';
    const presentChoices = [...new Set(data.orders
      .filter(o => o.choice && o.choice !== '不需供餐').map(o => o.choice))];
    const settingOrder = mealChoices().filter(c => c !== '不需供餐' && presentChoices.includes(c));
    const vendors = [...settingOrder, ...presentChoices.filter(c => !settingOrder.includes(c))];
    const grandTotal = data.orders.filter(o => o.choice && o.choice !== '不需供餐').length;

    const sections = vendors.map(choice => {
      const moms = data.mothers.map(m => {
        const cnt = {}, notes = [];
        for (const mt of Object.keys(MEAL_LABEL)) {
          const o = orderOf(m.id, mt);
          cnt[mt] = o && o.choice === choice ? 1 : 0;
          if (cnt[mt] && o.note && !notes.includes(o.note)) notes.push(o.note);
        }
        return { m, cnt, notes, total: Object.values(cnt).reduce((s, x) => s + x, 0) };
      }).filter(x => x.total > 0);
      const tot = mt => moms.reduce((s, x) => s + x.cnt[mt], 0);
      const total = moms.reduce((s, x) => s + x.total, 0);
      return `
        <div style="margin:12px 0">
          <h4 style="margin:0 0 6px;color:var(--primary-dark)">${esc(choice)} 核餐單（${esc(data.date)}）　<span style="font-weight:400;font-size:.9rem;color:var(--muted)">共 ${total} 份</span></h4>
          <div class="table-wrap"><table class="data" style="min-width:760px">
            <thead><tr><th style="width:40px">No</th><th style="width:60px">房號</th><th style="width:90px">姓名</th>
              <th style="width:44px">早</th><th style="width:44px">午</th><th style="width:44px">晚</th>
              <th>禁忌</th><th style="width:80px">生產</th><th style="width:150px">供餐期間</th><th>備註</th></tr></thead>
            <tbody>
              ${moms.map((x, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${esc(x.m.room_name)}</td>
                  <td>${esc(x.m.name)}</td>
                  <td style="text-align:center">${x.cnt.breakfast}</td>
                  <td style="text-align:center">${x.cnt.lunch}</td>
                  <td style="text-align:center">${x.cnt.dinner}</td>
                  <td><small>${esc(x.m.diet_notes || '')}</small></td>
                  <td>${x.m.delivery_date ? `${fmtMD(x.m.delivery_date)}${dvCode(x.m.delivery_type)}` : ''}</td>
                  <td><small>${fmtMD(x.m.check_in)}午 ~ ${fmtMD(x.m.check_out)}早</small></td>
                  <td><small>${esc([x.m.meal_diet && x.m.meal_diet !== '一般' ? x.m.meal_diet : '', ...x.notes].filter(Boolean).join('、'))}</small></td>
                </tr>`).join('')}
              <tr style="font-weight:700;background:var(--primary-light)">
                <td colspan="3">餐點小數</td>
                <td style="text-align:center;background:#fff3b0">${tot('breakfast')}</td>
                <td style="text-align:center;background:#fff3b0">${tot('lunch')}</td>
                <td style="text-align:center;background:#fff3b0">${tot('dinner')}</td>
                <td colspan="4"></td>
              </tr>
            </tbody>
          </table></div>
        </div>`;
    }).join('');
    $('#ml-kitchen').innerHTML = `<h3>廚房備餐單（${esc(data.date)}）　<span style="font-weight:400;font-size:.9rem;color:var(--muted)">合計 ${grandTotal} 份</span></h3>
      <small style="color:var(--muted)">供餐自入住日午餐起、至出住日早餐止。</small>`
      + (sections || '<div class="empty">當日尚無訂餐</div>');

    $('#ml-grid').querySelectorAll('[data-meal]').forEach(sel => {
      sel.onchange = async () => {
        const [mid, mt] = sel.dataset.meal.split(':');
        const o = orderOf(Number(mid), mt);
        await api('/meals', {
          method: 'POST',
          body: { mother_id: Number(mid), meal_date: $('#ml-date').value, meal_type: mt, choice: sel.value, note: o ? o.note : '', status: o ? o.status : 'preparing' }
        });
        refresh();
      };
    });
    // 訂餐備註（不改餐點選擇）
    $('#ml-grid').querySelectorAll('[data-mnote]').forEach(inp => {
      inp.onchange = async () => {
        const [mid, mt] = inp.dataset.mnote.split(':');
        try { await api('/meals/status', { method: 'POST', body: { mother_id: Number(mid), meal_date: $('#ml-date').value, meal_type: mt, note: inp.value } }); }
        catch (e) { alert(e.message); }
      };
    });
  };

  // 菜單上傳（週菜單 PDF／JPG；菜單以周為單位、周日開始）
  const loadMenuFiles = async () => {
    const files = await api('/meal-menu-files');
    const now = new Date();
    const sunday = new Date(now.getTime() - now.getTimezoneOffset() * 60000 - now.getDay() * 86400000).toISOString().slice(0, 10);
    $('#ml-menu-files').innerHTML = `
      <h3>菜單上傳 <small style="font-weight:400;color:var(--muted);font-size:.85rem">週菜單檔案（PDF 或 JPG）；以周為單位、周日開始</small></h3>
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap;margin:8px 0">
        <div class="field" style="max-width:160px;margin:0"><label>月子餐廠商</label>
          <select id="mf-vendor">${mealChoices().filter(c => c !== '不需供餐').map(c => `<option>${esc(c)}</option>`).join('')}<option value="">（通用）</option></select></div>
        <div class="field" style="max-width:180px;margin:0"><label>週起始日（周日）</label><input type="date" id="mf-week" value="${sunday}"></div>
        <div class="field" style="margin:0"><label>檔案</label><input type="file" id="mf-file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"></div>
        <button class="btn" id="mf-up">上傳菜單</button>
        <span class="error-msg" id="mf-err"></span>
      </div>
      <p style="font-size:.8rem;color:var(--muted);margin:0 0 8px">家屬入口的月子餐分頁會顯示各廠商「當周」菜單（依週起始日）。</p>
      ${files.length ? `<div class="table-wrap"><table class="data stack">
        <thead><tr><th>廠商</th><th>週起始</th><th>檔案</th><th>上傳時間</th><th>上傳人</th><th></th></tr></thead>
        <tbody>${files.map(f => `
          <tr>
            <td data-label="廠商">${esc(f.vendor || '通用')}</td>
            <td data-label="週起始">${esc(f.week_start || '—')}</td>
            <td data-label="檔案"><a href="/uploads/${esc(f.file)}" target="_blank">${esc(f.orig_name || f.file)}</a></td>
            <td data-label="上傳時間"><small>${esc((f.created_at || '').slice(0, 16))}</small></td>
            <td data-label="上傳人">${esc(f.uploaded_by_name || '—')}</td>
            <td data-label="">${currentUser.role === 'admin' ? `<button class="btn small danger" data-mf-del="${f.id}">刪除</button>` : ''}</td>
          </tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">尚未上傳菜單</div>'}`;
    $('#mf-up').onclick = async () => {
      const err = $('#mf-err');
      err.textContent = '';
      const f = $('#mf-file').files[0];
      if (!f) { err.textContent = '請選擇 PDF 或 JPG 檔案'; return; }
      const fd = new FormData();
      fd.append('file', f);
      fd.append('week_start', $('#mf-week').value);
      fd.append('vendor', $('#mf-vendor').value);
      try { await api('/meal-menu-files', { method: 'POST', body: fd }); loadMenuFiles(); }
      catch (e) { err.textContent = e.message; }
    };
    $('#ml-menu-files').querySelectorAll('[data-mf-del]').forEach(b => b.onclick = async () => {
      if (!confirm('確定刪除此菜單檔案？')) return;
      await api(`/meal-menu-files/${b.dataset.mfDel}`, { method: 'DELETE' });
      loadMenuFiles();
    });
  };
  loadMenuFiles();

  $('#ml-date').onchange = refresh;
  $('#ml-print').onclick = () => window.print();

  $('#ms-go').onclick = async () => {
    const start = $('#ms-start').value, end = $('#ms-end').value;
    if (!start || !end || end < start) { $('#ms-result').innerHTML = '<div class="error-msg">請選擇正確的起迄日期</div>'; return; }
    const sum = await api(`/meals/summary?start=${start}&end=${end}`);
    if (!sum.vendors.length) { $('#ms-result').innerHTML = '<div class="empty">該區間無訂餐</div>'; return; }
    $('#ms-result').innerHTML = `
      <p style="color:var(--muted);font-size:.85rem">${esc(start)} ~ ${esc(end)}　合計 ${sum.grand_total} 份</p>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>月子餐廠商</th><th>早餐</th><th>午餐</th><th>晚餐</th><th>合計份數</th></tr></thead>
        <tbody>${sum.vendors.map(v => `<tr>
          <td data-label="廠商"><strong>${esc(v.choice)}</strong></td>
          <td data-label="早餐">${v.by_meal.breakfast || 0}</td>
          <td data-label="午餐">${v.by_meal.lunch || 0}</td>
          <td data-label="晚餐">${v.by_meal.dinner || 0}</td>
          <td data-label="合計"><strong>${v.total}</strong></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  };
  refresh();
}

/* ---------- 月子餐（餐期 + 菜單 + 供餐） ---------- */
let mealPlanTab = 'serving';
let mealCfg = null;
async function viewMealPlan() {
  mealCfg = await api('/meal-config');
  main().innerHTML = `
    <div class="page-title">月子餐</div>
    <div class="card no-print">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div class="tabbar" style="margin:0">
          <button id="mp-tab-serving" class="${mealPlanTab === 'serving' ? 'active' : ''}">今日供餐</button>
          <button id="mp-tab-menu" class="${mealPlanTab === 'menu' ? 'active' : ''}">菜單管理</button>
        </div>
        <div class="field" style="max-width:200px;margin:0"><label>日期</label><input type="date" id="mp-date" value="${todayStr()}"></div>
      </div>
      ${mealCfg.stages.length ? `<p style="font-size:.82rem;color:var(--muted);margin:8px 0 0">餐期階段：${mealCfg.stages.map(s => `${esc(s.name)}（第${s.from}–${s.to}天）`).join('、')}。可於系統設定調整。</p>` : ''}
    </div>
    <div id="mp-body"><div class="empty">載入中</div></div>
    <div id="mp-swaps"></div>`;
  const draw = () => mealPlanTab === 'serving' ? drawServing() : drawMenu();
  $('#mp-date').onchange = draw;
  $('#mp-tab-serving').onclick = () => { mealPlanTab = 'serving'; $('#mp-tab-serving').classList.add('active'); $('#mp-tab-menu').classList.remove('active'); draw(); };
  $('#mp-tab-menu').onclick = () => { mealPlanTab = 'menu'; $('#mp-tab-menu').classList.add('active'); $('#mp-tab-serving').classList.remove('active'); draw(); };
  draw();
  loadMealSwaps();
}

// 家屬換餐申請審核（併入月子餐管理）
async function loadMealSwaps() {
  const box = $('#mp-swaps'); if (!box) return;
  const swaps = await api('/meal-swaps').catch(() => []);
  const SWST = { pending: ['待審核', 'yellow'], approved: ['已同意', 'green'], rejected: ['未同意', 'red'] };
  const pending = swaps.filter(s => s.status === 'pending').length;
  box.innerHTML = `
    <div class="card">
      <h3 style="color:var(--primary-dark);font-size:1rem;margin:0 0 8px">家屬換餐申請 <span class="badge ${pending ? 'red' : 'green'}">${pending}</span></h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>申請時間</th><th>媽媽／家屬</th><th>日期・餐別</th><th>希望更換／原因</th><th>狀態</th><th class="no-print"></th></tr></thead>
        <tbody>${swaps.length ? swaps.map(s => `
          <tr>
            <td data-label="申請時間"><small>${esc((s.created_at || '').slice(0, 16))}</small></td>
            <td data-label="媽媽／家屬">${esc(s.mother_name || '-')}${s.family_name ? `<br><small>${esc(s.family_name)}</small>` : ''}</td>
            <td data-label="日期・餐別">${esc(s.meal_date)}<br><small>${esc(s.slot || '-')}</small></td>
            <td data-label="希望更換／原因">${esc(s.to_choice || '')}${s.reason ? `<br><small style="color:var(--muted)">${esc(s.reason)}</small>` : ''}${s.staff_note ? `<br><small>備註：${esc(s.staff_note)}</small>` : ''}</td>
            <td data-label="狀態"><span class="badge ${SWST[s.status] ? SWST[s.status][1] : 'gray'}">${SWST[s.status] ? SWST[s.status][0] : s.status}</span>${s.handled_by_name ? `<br><small>${esc(s.handled_by_name)}</small>` : ''}</td>
            <td data-label="" class="no-print">${s.status === 'pending' ? `<button class="btn small" data-swap-ok="${s.id}">同意</button> <button class="btn small danger" data-swap-no="${s.id}">婉拒</button>` : ''}</td>
          </tr>`).join('') : '<tr><td colspan="6"><div class="empty">目前沒有換餐申請</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  const handle = async (id, action) => {
    let note = '';
    if (action === 'rejected') { note = prompt('婉拒原因（可留空，會回饋給家屬）：', '') || ''; }
    try { await api(`/meal-swaps/${id}/handle`, { method: 'POST', body: { action, staff_note: note } }); loadMealSwaps(); }
    catch (e) { alert(e.message); }
  };
  box.querySelectorAll('[data-swap-ok]').forEach(b => b.onclick = () => handle(b.dataset.swapOk, 'approved'));
  box.querySelectorAll('[data-swap-no]').forEach(b => b.onclick = () => handle(b.dataset.swapNo, 'rejected'));
}

function menuCell(mu) {
  if (!mu) return '<span style="color:var(--muted)">—</span>';
  const parts = [['主食', mu.staple], ['主菜', mu.main], ['湯品', mu.soup], ['鮮蔬', mu.veggie], ['甜品', mu.dessert], ['飲品', mu.drink]]
    .filter(([, v]) => v).map(([k, v]) => `<div><small style="color:var(--muted)">${k}</small> ${esc(v)}</div>`).join('');
  return parts + (mu.note ? `<div><small style="color:var(--muted)">備註 ${esc(mu.note)}</small></div>` : '');
}

async function drawServing() {
  const date = $('#mp-date').value;
  const data = await api(`/meal-plan?date=${date}`);
  const slots = data.config.slots;
  const countRows = Object.entries(data.counts).sort().map(([k, v]) => `<span class="badge teal" style="margin:2px">${esc(k)}：${v} 份</span>`).join(' ');
  $('#mp-body').innerHTML = data.mothers.length ? `
    <div class="card" id="mp-kitchen">
      <h3>廚房備餐單（${esc(date)}）　<span style="font-weight:400;font-size:.9rem;color:var(--muted)">在住 ${data.mothers.length} 位</span>
        <button class="btn small secondary no-print" id="mp-print" style="margin-left:8px">列印</button></h3>
      <div style="margin:8px 0">${countRows || '<span class="empty">尚無菜單，請先到「菜單管理」排餐</span>'}</div>
      ${filterBar({ placeholder: '搜尋媽媽 / 房間 / 餐期…', search: true })}
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>房間</th><th>媽媽</th><th>產後</th><th>餐期</th><th>飲食</th>${slots.map(s => `<th>${esc(s)}</th>`).join('')}</tr></thead>
        <tbody>${data.mothers.map(m => `
          <tr data-filter="${esc(m.name + ' ' + m.room_name + ' ' + (m.stage || '') + ' ' + m.diet)}">
            <td data-label="房間">${esc(m.room_name)}</td>
            <td data-label="媽媽">${esc(m.name)}${m.diet_notes ? `<br><small style="color:var(--danger)">禁忌：${esc(m.diet_notes)}</small>` : ''}</td>
            <td data-label="產後">第 ${m.postpartum_day ?? '-'} 天</td>
            <td data-label="餐期">${esc(m.stage || '不分期')}</td>
            <td data-label="飲食"><select data-diet="${m.id}" class="no-print">${mealCfg.diets.map(d => `<option ${m.diet === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select><span class="only-print">${esc(m.diet)}</span></td>
            ${slots.map(s => `<td data-label="${esc(s)}" style="font-size:.85rem">${menuCell(m.slots[s])}</td>`).join('')}
          </tr>`).join('')}</tbody>
      </table></div>
    </div>` : '<div class="card"><div class="empty">該日無在住媽媽</div></div>';
  if (!data.mothers.length) return;
  wireFilter($('#mp-body'));
  $('#mp-print').onclick = () => window.print();
  $('#mp-body').querySelectorAll('[data-diet]').forEach(sel => sel.onchange = async () => {
    try { await api(`/mothers/${sel.dataset.diet}/meal-diet`, { method: 'PUT', body: { meal_diet: sel.value } }); drawServing(); }
    catch (e) { alert(e.message); }
  });
}

async function drawMenu() {
  const date = $('#mp-date').value;
  const menus = await api(`/meal-menu?date=${date}`);
  const SLOT_ORDER = mealCfg.slots;
  menus.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  $('#mp-body').innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:flex-end;gap:8px">
        <button class="btn small secondary" id="mp-copy">複製前一天</button>
        <button class="btn small" id="mp-add">新增菜單</button>
      </div>
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>餐別</th><th>餐期</th><th>飲食</th><th>菜色</th><th></th></tr></thead>
        <tbody>${menus.length ? menus.map(mu => `
          <tr>
            <td data-label="餐別"><strong>${esc(mu.slot)}</strong></td>
            <td data-label="餐期">${esc(mu.stage || '不分期')}</td>
            <td data-label="飲食">${esc(mu.diet || '通用')}</td>
            <td data-label="菜色" style="font-size:.85rem">${menuCell(mu)}</td>
            <td data-label="操作"><button class="btn small secondary" data-edit="${mu.id}">編輯</button> <button class="btn small danger" data-del="${mu.id}">刪除</button></td>
          </tr>`).join('') : '<tr><td colspan="5"><div class="empty">這天還沒排菜單，按「新增菜單」或「複製前一天」</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  $('#mp-add').onclick = () => openMenuForm(date, null);
  $('#mp-body').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openMenuForm(date, menus.find(m => m.id == b.dataset.edit)));
  $('#mp-body').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除此菜單？')) return;
    try { await api(`/meal-menu/${b.dataset.del}`, { method: 'DELETE' }); drawMenu(); } catch (e) { alert(e.message); }
  });
  $('#mp-copy').onclick = async () => {
    const from = new Date(new Date(date).getTime() - 86400000).toISOString().slice(0, 10);
    if (!confirm(`將 ${from} 的菜單複製到 ${date}？（同餐別會覆蓋）`)) return;
    try { const r = await api('/meal-menu/copy', { method: 'POST', body: { from_date: from, to_date: date } });
      alert(`已複製 ${r.copied} 筆`); drawMenu();
    } catch (e) { alert(e.message); }
  };
}

function openMenuForm(date, mu) {
  const ed = mu || {};
  const stageOpts = ['<option value="">不分期（通用）</option>', ...mealCfg.stages.map(s => `<option ${ed.stage === s.name ? 'selected' : ''}>${esc(s.name)}</option>`)].join('');
  const dietOpts = ['<option value="">通用</option>', ...mealCfg.diets.map(d => `<option ${ed.diet === d ? 'selected' : ''}>${esc(d)}</option>`)].join('');
  openModal(ed.id ? '編輯菜單' : `新增菜單（${date}）`, `
    <div class="form-grid">
      <div class="field"><label>餐別 *</label><select id="mn-slot">${mealCfg.slots.map(s => `<option ${ed.slot === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div class="field"><label>餐期階段</label><select id="mn-stage">${stageOpts}</select></div>
      <div class="field"><label>飲食類型</label><select id="mn-diet">${dietOpts}</select></div>
      <div class="field"><label>主食</label><input id="mn-staple" value="${esc(ed.staple || '')}"></div>
      <div class="field"><label>主菜</label><input id="mn-main" value="${esc(ed.main || '')}"></div>
      <div class="field"><label>藥膳湯品</label><input id="mn-soup" value="${esc(ed.soup || '')}"></div>
      <div class="field"><label>鮮蔬</label><input id="mn-veggie" value="${esc(ed.veggie || '')}"></div>
      <div class="field"><label>甜品</label><input id="mn-dessert" value="${esc(ed.dessert || '')}"></div>
      <div class="field"><label>飲品</label><input id="mn-drink" value="${esc(ed.drink || '')}"></div>
      <div class="field full"><label>備註</label><input id="mn-note" value="${esc(ed.note || '')}"></div>
      <div class="full row"><button class="btn" id="mn-save">儲存</button><span class="error-msg" id="mn-err"></span></div>
    </div>
    <p style="font-size:.8rem;color:var(--muted)">同一餐別可分別建立不同「餐期×飲食」的菜色；供餐時系統會依每位媽媽的產後天數與飲食類型自動對應，找不到精準對應時會退回「通用」菜單。</p>`, body => {
    const v = id => body.querySelector(id).value;
    body.querySelector('#mn-save').onclick = async () => {
      try {
        await api('/meal-menu', { method: 'POST', body: {
          menu_date: date, slot: v('#mn-slot'), stage: v('#mn-stage'), diet: v('#mn-diet'),
          staple: v('#mn-staple'), main: v('#mn-main'), soup: v('#mn-soup'), veggie: v('#mn-veggie'),
          dessert: v('#mn-dessert'), drink: v('#mn-drink'), note: v('#mn-note') } });
        closeModal(); drawMenu();
      } catch (e) { body.querySelector('#mn-err').textContent = e.message; }
    };
  });
}

/* ---------- 參觀預約 ---------- */
function tourForm(t = {}) {
  const [d, tm] = (t.tour_at || '').split(' ');
  return `
    <div class="form-grid">
      <div class="field"><label>姓名</label><input id="tf-name" value="${esc(t.name || '')}"></div>
      <div class="field"><label>電話</label><input id="tf-phone" value="${esc(t.phone || '')}"></div>
      <div class="field"><label>參觀日期</label><input type="date" id="tf-date" value="${esc(d || todayStr())}"></div>
      <div class="field"><label>參觀時間</label><input type="time" id="tf-time" value="${esc(tm ? tm.slice(0, 5) : '14:00')}"></div>
      <div class="field"><label>預產期</label><input type="date" id="tf-due" value="${esc(t.due_date || '')}"></div>
      <div class="field"><label>來源</label><input id="tf-source" value="${esc(t.source || '')}" placeholder="官網 / 介紹 / 廣告"></div>
      <div class="field"><label>下次跟進日</label><input type="date" id="tf-follow" value="${esc(t.follow_up_date || '')}"></div>
      <div class="field full">
        <label>狀態</label>
        <select id="tf-status">${Object.entries(TOUR_STATUS_LABEL).map(([k, v]) =>
          `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="field full"><label>備註</label><textarea id="tf-note">${esc(t.note || '')}</textarea></div>
      <div class="full row">
        <button class="btn" id="tf-save">儲存</button>
        <span class="error-msg" id="tf-err"></span>
      </div>
    </div>`;
}

function readTourForm(body) {
  return {
    name: body.querySelector('#tf-name').value.trim(),
    phone: body.querySelector('#tf-phone').value.trim(),
    due_date: body.querySelector('#tf-due').value,
    tour_at: `${body.querySelector('#tf-date').value} ${body.querySelector('#tf-time').value || '00:00'}`,
    source: body.querySelector('#tf-source').value.trim(),
    status: body.querySelector('#tf-status').value,
    note: body.querySelector('#tf-note').value,
    follow_up_date: body.querySelector('#tf-follow').value
  };
}

async function viewTours() {
  const tours = await api('/tours');
  const sources = [...new Set(tours.map(t => t.source).filter(Boolean))].sort();
  const month = todayStr().slice(0, 7);
  const inMonth = tours.filter(t => (t.tour_at || '').slice(0, 7) === month);
  const signed = inMonth.filter(t => t.status === 'signed').length;
  const decided = inMonth.filter(t => t.status !== 'scheduled').length;
  const rate = decided ? Math.round(signed / decided * 100) : null;

  main().innerHTML = `
    <div class="page-title">參觀預約</div>
    <div class="stat-grid">
      <div class="stat"><div class="num">${inMonth.length}</div><div class="label">本月參觀預約</div></div>
      <div class="stat"><div class="num">${signed}</div><div class="label">本月簽約</div></div>
      <div class="stat"><div class="num">${rate === null ? '-' : rate + '%'}</div><div class="label">參觀後簽約率</div></div>
      <div class="stat"><div class="num">${tours.filter(t => t.status === 'scheduled').length}</div><div class="label">待參觀</div></div>
    </div>
    <div class="card">
      <div class="row between">
        <h3>潛在客戶追蹤</h3>
        <button class="btn small" id="tr-add">新增參觀預約</button>
      </div>
      <div class="row" style="gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center">
        <input id="tr-q" placeholder="搜尋姓名 / 電話 / 來源 / 備註…" style="flex:1;min-width:150px">
        <select id="tr-fsource"><option value="">全部來源</option>${sources.map(s => `<option>${esc(s)}</option>`).join('')}</select>
        <label style="font-size:.85rem;color:var(--muted)">參觀日</label>
        <input type="date" id="tr-from" style="max-width:150px">
        <span>~</span>
        <input type="date" id="tr-to" style="max-width:150px">
        <button class="btn small secondary" id="tr-clear">清除</button>
      </div>
      <div class="row" style="gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:center">
        ${[{ val: '', label: '全部' }, { val: 'scheduled', label: '待參觀' }, { val: 'visited', label: '已參觀' }, { val: 'signed', label: '已簽約' }, { val: 'lost', label: '未成交' }]
          .map((s, i) => `<button class="btn small ${i === 0 ? '' : 'secondary'}" data-tr-status="${s.val}">${s.label}</button>`).join('')}
        <span id="tr-count" style="color:var(--muted);font-size:.85rem"></span>
      </div>
      <div class="table-wrap">
        <table class="data stack" id="tr-table">
          <thead><tr><th>參觀時間</th><th>姓名</th><th>電話</th><th>預產期</th><th>來源</th><th>狀態</th><th>最近跟進</th><th></th></tr></thead>
          <tbody>${tours.map(t => `
            <tr data-q="${esc((t.name + ' ' + (t.phone || '') + ' ' + (t.source || '') + ' ' + (t.note || '') + ' ' + (t.last_log || '')).toLowerCase())}" data-status="${t.status}" data-source="${esc(t.source || '')}" data-date="${esc((t.tour_at || '').slice(0, 10))}">
              <td data-label="參觀時間">${esc(t.tour_at)}</td>
              <td data-label="姓名">${t.mother_id && canAccess('#/customers')
                ? `<a href="#/customers?m=${t.mother_id}" title="開啟客戶資料">${esc(t.name)}</a>`
                : esc(t.name)}</td>
              <td data-label="電話">${esc(t.phone || '-')}</td>
              <td data-label="預產期">${esc(t.due_date || '-')}</td>
              <td data-label="來源">${esc(t.source || '-')}</td>
              <td data-label="狀態">${t.confirm_status === 'pending' && t.status === 'scheduled'
                ? '<span class="badge yellow">LINE 待確認</span>'
                : `<span class="badge ${TOUR_STATUS_BADGE[t.status]}">${TOUR_STATUS_LABEL[t.status]}</span>`}</td>
              <td data-label="最近跟進">${t.last_log
                ? `${esc(t.last_log.length > 24 ? t.last_log.slice(0, 24) + '…' : t.last_log)}<br><small>${esc((t.last_log_at || '').slice(0, 16))}</small>`
                : (t.note ? esc(t.note.length > 24 ? t.note.slice(0, 24) + '…' : t.note) : '<span style="color:var(--muted)">-</span>')}${t.follow_up_date && ['scheduled', 'visited'].includes(t.status) ? `<br><small style="color:${t.follow_up_date < todayStr() ? 'var(--danger)' : 'var(--primary-dark)'}">跟進 ${esc(t.follow_up_date)}</small>` : ''}</td>
              <td data-label="操作">
                ${t.confirm_status === 'pending' && t.status === 'scheduled'
                  ? `<button class="btn small" data-tconfirm="${t.id}">確認預約</button>` : ''}
                ${t.status === 'scheduled'
                  ? `<button class="btn small" data-tst="visited" data-id="${t.id}">已參觀</button>` : ''}
                ${t.status === 'visited'
                  ? `<button class="btn small" data-tst="signed" data-id="${t.id}">已簽約</button>` : ''}
                ${['scheduled', 'visited'].includes(t.status)
                  ? `<button class="btn small secondary" data-tst="lost" data-id="${t.id}">未成交</button>` : ''}
                <button class="btn small secondary" data-log-tour="${t.id}">追蹤紀錄${t.log_count ? `(${t.log_count})` : ''}</button>
                <button class="btn small secondary" data-edit-tour="${t.id}">編輯</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="8"><div class="empty">尚無參觀預約</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  // 多條件篩選：關鍵字 + 狀態 + 來源 + 參觀日區間
  const trState = { q: '', status: '', source: '', from: '', to: '' };
  const trApply = () => {
    let shown = 0, total = 0;
    main().querySelectorAll('#tr-table tr[data-q]').forEach(tr => {
      total++;
      const d = tr.dataset.date;
      const vis = (!trState.q || tr.dataset.q.includes(trState.q))
        && (!trState.status || tr.dataset.status === trState.status)
        && (!trState.source || tr.dataset.source === trState.source)
        && (!trState.from || (d && d >= trState.from))
        && (!trState.to || (d && d <= trState.to));
      tr.style.display = vis ? '' : 'none';
      if (vis) shown++;
    });
    const c = $('#tr-count');
    if (c) c.textContent = total ? `顯示 ${shown} / ${total} 筆` : '';
  };
  $('#tr-q').oninput = e => { trState.q = e.target.value.trim().toLowerCase(); trApply(); };
  $('#tr-fsource').onchange = e => { trState.source = e.target.value; trApply(); };
  $('#tr-from').onchange = e => { trState.from = e.target.value; trApply(); };
  $('#tr-to').onchange = e => { trState.to = e.target.value; trApply(); };
  $('#tr-clear').onclick = () => {
    Object.assign(trState, { q: '', source: '', from: '', to: '' });
    $('#tr-q').value = ''; $('#tr-fsource').value = ''; $('#tr-from').value = ''; $('#tr-to').value = '';
    trApply();
  };
  main().querySelectorAll('[data-tr-status]').forEach(b => b.onclick = () => {
    trState.status = b.dataset.trStatus;
    main().querySelectorAll('[data-tr-status]').forEach(x => x.classList.toggle('secondary', x !== b));
    trApply();
  });
  trApply();

  main().querySelectorAll('[data-log-tour]').forEach(btn => {
    btn.onclick = () => openTourLog(tours.find(x => String(x.id) === btn.dataset.logTour));
  });

  // LINE 待確認預約：確認後自動推播「已安排」訊息給客戶
  main().querySelectorAll('[data-tconfirm]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確認此 LINE 預約？系統將自動發送確認訊息給客戶。')) return;
      try {
        const r = await api(`/tours/${btn.dataset.tconfirm}/confirm`, { method: 'POST', body: {} });
        alert(r.notified ? '已確認，並已發送 LINE 通知給客戶。' : '已確認（未發送 LINE 通知）。');
      } catch (e) { alert(e.message); }
      viewTours();
    };
  });

  main().querySelectorAll('[data-tst]').forEach(btn => {
    btn.onclick = async () => {
      if (btn.dataset.tst === 'signed') {
        const tour = tours.find(x => String(x.id) === btn.dataset.id);
        return openSignModal(tour);
      }
      await api(`/tours/${btn.dataset.id}`, { method: 'PUT', body: { status: btn.dataset.tst } });
      viewTours();
    };
  });

  // 簽約：帶出訂房表單，預填客戶資料，存檔時一併建立媽媽資料與訂房
  async function openSignModal(tour) {
    const rooms = await api('/rooms');
    openModal(`簽約建檔 — ${esc(tour.name)}`, `
      <div class="form-grid">
        <div class="field"><label>客戶姓名</label><input id="sg-name" value="${esc(tour.name || '')}"></div>
        <div class="field"><label>電話</label><input id="sg-phone" value="${esc(tour.phone || '')}"></div>
        <div class="field"><label>預產期</label><input type="date" id="sg-due" value="${esc(tour.due_date || '')}"></div>
        <div class="field">
          <label>房間</label>
          <select id="sg-room">${rooms.map(r =>
            `<option value="${r.id}" data-price="${r.price_per_day}">${esc(r.name)}（${esc(r.room_type)}，${fmtMoney(r.price_per_day)}/日）</option>`).join('')}</select>
        </div>
        <div class="field"><label>入住日</label><input type="date" id="sg-in"></div>
        <div class="field"><label>退房日</label><input type="date" id="sg-out"></div>
        <div class="field"><label>訂金</label><input type="number" id="sg-deposit" inputmode="numeric" value="0"></div>
        <div class="field"><label>合約總額</label><input type="number" id="sg-total" inputmode="numeric" value="0"></div>
        <div class="full row">
          <button class="btn" id="sg-save">確認簽約並建立訂房</button>
          <span class="error-msg" id="sg-err"></span>
        </div>
      </div>`, body => {
      const inEl = body.querySelector('#sg-in');
      const outEl = body.querySelector('#sg-out');
      const roomEl = body.querySelector('#sg-room');
      const calcTotal = () => {
        const price = Number(roomEl.selectedOptions[0]?.dataset.price || 0);
        if (!price || !inEl.value || !outEl.value) return;
        const days = Math.round((new Date(outEl.value) - new Date(inEl.value)) / 86400000);
        if (days > 0) body.querySelector('#sg-total').value = days * price;
      };
      inEl.onchange = calcTotal;
      outEl.onchange = calcTotal;
      roomEl.onchange = calcTotal;
      body.querySelector('#sg-save').onclick = async () => {
        try {
          await api(`/tours/${tour.id}/sign`, {
            method: 'POST',
            body: {
              name: body.querySelector('#sg-name').value.trim(),
              phone: body.querySelector('#sg-phone').value,
              due_date: body.querySelector('#sg-due').value,
              room_id: roomEl.value,
              check_in: inEl.value,
              check_out: outEl.value,
              deposit: Number(body.querySelector('#sg-deposit').value) || 0,
              total_amount: Number(body.querySelector('#sg-total').value) || 0
            }
          });
          closeModal();
          location.hash = '#/rooms';
        } catch (e) {
          body.querySelector('#sg-err').textContent = e.message;
        }
      };
    });
  }

  const saveTour = (body, fn) => {
    body.querySelector('#tf-save').onclick = async () => {
      const t = readTourForm(body);
      if (!t.name || !body.querySelector('#tf-date').value) {
        body.querySelector('#tf-err').textContent = '姓名與參觀日期必填';
        return;
      }
      try {
        await fn(t);
        closeModal();
        viewTours();
      } catch (e) {
        body.querySelector('#tf-err').textContent = e.message;
      }
    };
  };

  $('#tr-add').onclick = () => {
    openModal('新增參觀預約', tourForm(), body =>
      saveTour(body, t => api('/tours', { method: 'POST', body: t })));
  };

  main().querySelectorAll('[data-edit-tour]').forEach(btn => {
    btn.onclick = () => {
      const t = tours.find(x => String(x.id) === btn.dataset.editTour);
      openModal('編輯參觀預約', tourForm(t), body =>
        saveTour(body, payload => api(`/tours/${t.id}`, { method: 'PUT', body: payload })));
    };
  });
}

// 參觀預約追蹤紀錄：時間序顯示 log，可追加新備註（不覆蓋歷史）
async function openTourLog(tour) {
  const draw = async () => {
    const logs = await api(`/tours/${tour.id}/logs`);
    const timeline = logs.length ? logs.map(l => `
      <div style="border-left:2px solid var(--primary);padding:4px 0 8px 10px;margin-left:4px">
        <div style="font-size:.78rem;color:var(--muted)">${esc((l.created_at || '').slice(0, 16))}　${esc(l.staff_name || '系統')}</div>
        <div style="white-space:pre-wrap">${esc(l.body)}</div>
      </div>`).join('') : '<div class="empty">尚無追蹤紀錄</div>';
    const box = document.querySelector('#tl-timeline');
    if (box) box.innerHTML = timeline;
  };
  openModal(`追蹤紀錄 — ${esc(tour.name)}`, `
    ${tour.note ? `<p style="font-size:.85rem;color:var(--muted)">原始備註：${esc(tour.note)}</p>` : ''}
    <div class="form-grid" style="margin-bottom:10px">
      <div class="field full"><label>新增追蹤備註</label><textarea id="tl-body" rows="2" placeholder="例如：來電詢問房型，已寄報價單"></textarea></div>
      <div class="full row"><button class="btn small" id="tl-save">新增備註</button><span class="error-msg" id="tl-err"></span></div>
    </div>
    <div id="tl-timeline" style="max-height:300px;overflow:auto"></div>`, body => {
    draw();
    body.querySelector('#tl-save').onclick = async () => {
      const text = body.querySelector('#tl-body').value.trim();
      if (!text) { body.querySelector('#tl-err').textContent = '請輸入內容'; return; }
      try {
        await api(`/tours/${tour.id}/logs`, { method: 'POST', body: { body: text } });
        body.querySelector('#tl-body').value = '';
        body.querySelector('#tl-err').textContent = '';
        await draw();
      } catch (e) { body.querySelector('#tl-err').textContent = e.message; }
    };
  });
}

/* ---------- 排班與人力 ---------- */
async function viewShifts() {
  const start = todayStr();
  const [shifts, users, check] = await Promise.all([
    api(`/shifts?start=${start}&days=7`),
    api('/users'),
    api(`/staffing-check?date=${start}`)
  ]);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(new Date(start).getTime() + i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  const weekday = ['日', '一', '二', '三', '四', '五', '六'];

  const cell = (date, st) => {
    const list = shifts.filter(s => s.shift_date === date && s.shift_type === st);
    return `<td class="shift-cell" data-label="${date.slice(5)} ${SHIFT_LABEL[st]}">
      ${list.map(s => `<span class="shift-tag">${esc(s.user_name)}
        <button data-del-shift="${s.id}" aria-label="移除">&times;</button></span>`).join('') || '<span style="color:var(--border)">-</span>'}
    </td>`;
  };

  main().innerHTML = `
    <div class="page-title">排班與人力</div>
    <div class="card">
      <h3>今日人力比檢核（在住嬰兒 ${check.babies} 名，1:${check.ratio}）</h3>
      <div class="row">
        ${check.shifts.map(s => `
          <span class="badge ${s.ok ? 'green' : 'red'}">
            ${SHIFT_LABEL[s.shift_type]}：${s.nurses}/${s.required} 人 ${s.ok ? '符合' : '不足'}
          </span>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="row between">
        <h3>未來七日班表</h3>
        <button class="btn small" id="sf-add">加入排班</button>
      </div>
      <div class="table-wrap">
        <table class="data shift-table">
          <thead><tr><th>日期</th><th>白班</th><th>小夜</th><th>大夜</th></tr></thead>
          <tbody>${days.map(d => `
            <tr>
              <td>${d.slice(5)}（${weekday[new Date(d).getDay()]}）</td>
              ${cell(d, 'day')}${cell(d, 'evening')}${cell(d, 'night')}
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;

  main().querySelectorAll('[data-del-shift]').forEach(btn => {
    btn.onclick = async () => {
      await api(`/shifts/${btn.dataset.delShift}`, { method: 'DELETE' });
      viewShifts();
    };
  });

  $('#sf-add').onclick = () => {
    openModal('加入排班', `
      <div class="form-grid">
        <div class="field">
          <label>人員</label>
          <select id="sf-user">${users.filter(u => u.active).map(u =>
            `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>班別</label>
          <select id="sf-shift">${Object.entries(SHIFT_LABEL)
            .map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        </div>
        <div class="field full"><label>日期</label><input type="date" id="sf-date" value="${todayStr()}"></div>
        <div class="full row">
          <button class="btn" id="sf-save">加入</button>
          <span class="error-msg" id="sf-err"></span>
        </div>
      </div>`, body => {
      body.querySelector('#sf-save').onclick = async () => {
        try {
          await api('/shifts', {
            method: 'POST',
            body: {
              user_id: body.querySelector('#sf-user').value,
              shift_date: body.querySelector('#sf-date').value,
              shift_type: body.querySelector('#sf-shift').value
            }
          });
          closeModal();
          viewShifts();
        } catch (e) {
          body.querySelector('#sf-err').textContent = e.message;
        }
      };
    });
  };
}

/* ---------- 家屬帳號 ---------- */
// 員工端：開啟某寶寶的家屬留言對話並回覆
function openFamilyThread(babyId, thread) {
  const bubbles = (thread.list || []).slice().reverse().map(m => `
    <div style="margin:6px 0;text-align:${m.sender === 'staff' ? 'right' : 'left'}">
      <div style="display:inline-block;max-width:80%;padding:6px 10px;border-radius:10px;background:${m.sender === 'staff' ? '#cdeae4' : '#f0f0f0'}">
        <div style="font-size:.75rem;color:var(--muted)">${esc(m.sender_name || (m.sender === 'staff' ? '員工' : '家屬'))}・${esc(m.created_at)}</div>
        ${esc(m.body)}</div></div>`).join('');
  openModal(`家屬留言：${esc(thread.baby_name)}`, `
    <div style="max-height:50vh;overflow:auto;margin-bottom:10px">${bubbles || '<div class="empty">尚無留言</div>'}</div>
    <div class="field"><textarea id="ft-body" rows="2" placeholder="輸入回覆…"></textarea></div>
    <div class="row"><button class="btn" id="ft-send">送出回覆</button><span class="error-msg" id="ft-err"></span></div>`, body => {
    body.querySelector('#ft-send').onclick = async () => {
      const text = body.querySelector('#ft-body').value.trim();
      if (!text) return;
      try { await api(`/family-messages/${babyId}/reply`, { method: 'POST', body: { body: text } }); closeModal(); viewFamily(); }
      catch (e) { body.querySelector('#ft-err').textContent = e.message; }
    };
  });
  // 開啟即標記為已讀
  api(`/family-messages/${babyId}/read`, { method: 'POST' }).catch(() => {});
}

async function viewFamily() {
  const [fams, babies, messages] = await Promise.all([api('/family-members'), api('/babies'), api('/family-messages')]);
  // 依寶寶分組留言
  const msgByBaby = {};
  for (const m of messages) (msgByBaby[m.baby_id] = msgByBaby[m.baby_id] || { baby_name: m.baby_name, mother_name: m.mother_name, list: [] }).list.push(m);
  const unread = messages.filter(m => m.sender === 'family' && !m.read_by_staff).length;
  const threads = Object.entries(msgByBaby).map(([babyId, t]) => {
    const last = t.list[0];
    const hasUnread = t.list.some(m => m.sender === 'family' && !m.read_by_staff);
    return `<tr data-filter="${esc(t.baby_name + ' ' + t.mother_name)}">
      <td data-label="寶寶">${esc(t.baby_name)}（${esc(t.mother_name)}）${hasUnread ? '<span class="badge red">未讀</span>' : ''}</td>
      <td data-label="最新留言">${esc((last.body || '').slice(0, 30))}<br><small>${last.sender === 'family' ? '家屬' : '員工'} ${esc(last.created_at)}</small></td>
      <td data-label="操作"><button class="btn small secondary" data-msg="${babyId}">開啟對話</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="3"><div class="empty">尚無家屬留言</div></td></tr>';
  main().innerHTML = `
    <div class="page-title">家屬帳號</div>
    <div class="card">
      <p style="font-size:.9rem;color:var(--muted);margin-bottom:12px">
        家屬以通行碼登入「家屬入口」（/family.html）查看寶寶日報與照片。
        正式環境可在此整合 LINE 官方帳號綁定與推播。
      </p>
      <button class="btn small" id="fa-add">新增家屬通行碼</button>
    </div>
    <div class="card">
      ${filterBar({ placeholder: '搜尋家屬 / 寶寶 / 通行碼…', statuses: [{ val: '', label: '全部' }, { val: 'bound', label: '已綁 LINE' }, { val: 'unbound', label: '未綁' }] })}
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>家屬</th><th>關係</th><th>寶寶</th><th>通行碼</th><th>LINE</th><th></th></tr></thead>
          <tbody>${fams.map(f => `
            <tr data-filter="${esc(f.name + ' ' + (f.relation || '') + ' ' + f.baby_name + ' ' + f.mother_name + ' ' + f.access_code)}" data-status="${f.line_user_id ? 'bound' : 'unbound'}">
              <td data-label="家屬">${esc(f.name)}</td>
              <td data-label="關係">${esc(f.relation || '-')}</td>
              <td data-label="寶寶">${esc(f.baby_name)}（${esc(f.mother_name)}）</td>
              <td data-label="通行碼"><code style="font-size:1rem;letter-spacing:2px">${esc(f.access_code)}</code></td>
              <td data-label="LINE">${f.line_user_id
                ? '<span class="badge green">已綁定</span>'
                : '<span class="badge gray">未綁定</span>'}</td>
              <td data-label="操作">
                <button class="btn small secondary" data-bind="${f.id}">LINE 綁定</button>
                <button class="btn small danger" data-revoke="${f.id}">停用</button>
              </td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>家屬留言${unread ? `　<span class="badge red">${unread} 則未讀</span>` : ''}</h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>寶寶</th><th>最新留言</th><th></th></tr></thead>
        <tbody>${threads}</tbody>
      </table></div>
    </div>`;

  wireFilter(main());
  main().querySelectorAll('[data-msg]').forEach(btn => btn.onclick = () => openFamilyThread(btn.dataset.msg, msgByBaby[btn.dataset.msg]));

  main().querySelectorAll('[data-revoke]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定停用此通行碼？家屬將無法再登入。')) return;
      await api(`/family-members/${btn.dataset.revoke}`, { method: 'DELETE' });
      viewFamily();
    };
  });

  main().querySelectorAll('[data-bind]').forEach(btn => {
    btn.onclick = () => {
      const f = fams.find(x => String(x.id) === btn.dataset.bind);
      openModal(`LINE 綁定：${f.name}`, `
        <p style="font-size:.88rem;color:var(--muted);margin-bottom:12px">
          填入家屬的 LINE User ID（家屬加入機構官方帳號後，由 webhook 取得）。
          綁定後發送日報會直接推播到家屬的 LINE；清空則改回家屬入口查看。
        </p>
        <div class="field">
          <label>LINE User ID</label>
          <input id="lb-id" value="${esc(f.line_user_id || '')}" placeholder="U 開頭的使用者識別碼">
        </div>
        <div class="row mt">
          <button class="btn" id="lb-save">儲存</button>
          <span class="error-msg" id="lb-err"></span>
        </div>`, body => {
        body.querySelector('#lb-save').onclick = async () => {
          try {
            await api(`/family-members/${f.id}`, {
              method: 'PUT', body: { line_user_id: body.querySelector('#lb-id').value }
            });
            closeModal();
            viewFamily();
          } catch (e) {
            body.querySelector('#lb-err').textContent = e.message;
          }
        };
      });
    };
  });

  $('#fa-add').onclick = () => {
    openModal('新增家屬通行碼', `
      <div class="form-grid">
        <div class="field full">
          <label>寶寶</label>
          <select id="fa-baby">${babies.map(b =>
            `<option value="${b.id}">${esc(b.name)}（媽媽：${esc(b.mother_name)}）</option>`).join('')}</select>
        </div>
        <div class="field"><label>家屬姓名</label><input id="fa-name"></div>
        <div class="field"><label>關係</label><input id="fa-relation" placeholder="爸爸 / 阿公 / 阿嬤"></div>
        <div class="full row">
          <button class="btn" id="fa-save">建立</button>
          <span class="error-msg" id="fa-err"></span>
        </div>
        <div class="full" id="fa-result"></div>
      </div>`, body => {
      body.querySelector('#fa-save').onclick = async () => {
        try {
          const r = await api('/family-members', {
            method: 'POST',
            body: {
              baby_id: body.querySelector('#fa-baby').value,
              name: body.querySelector('#fa-name').value.trim(),
              relation: body.querySelector('#fa-relation').value.trim()
            }
          });
          body.querySelector('#fa-result').innerHTML = `
            <div class="ok-msg">已建立，通行碼：
              <code style="font-size:1.2rem;letter-spacing:3px">${esc(r.access_code)}</code>
              請提供給家屬登入家屬入口。</div>`;
          viewFamily(); // 背景刷新列表，彈窗續留供抄寫通行碼
        } catch (e) {
          body.querySelector('#fa-err').textContent = e.message;
        }
      };
    });
  };
}

/* ---------- 營運報表：每日入住率 + 評鑑品管 7 大指標 ---------- */
async function viewQualityReport() {
  const month = location.hash.split('?m=')[1] || todayStr().slice(0, 7);
  main().innerHTML = `
    <div class="page-title">營運報表</div>
    <div class="card no-print">
      <div class="row">
        <div class="field" style="max-width:200px"><label>月份</label><input type="month" id="qr-month" value="${month}"></div>
        <div style="align-self:flex-end" class="row">
          <button class="btn secondary" id="qr-print">列印</button>
          <button class="btn secondary" id="qr-csv">匯出每日入住率 CSV</button>
        </div>
      </div>
    </div>
    <div id="qr-body"><div class="empty">載入中</div></div>`;

  let data = null;
  const load = async () => {
    data = await api(`/reports/quality?month=${$('#qr-month').value}`);
    const ind = data.indicators.map(i => `
      <div class="stat">
        <div class="num">${i.value === null ? '—' : i.value}${i.value === null ? '' : `<span style="font-size:.5em;color:var(--muted)"> ${esc(i.unit)}</span>`}</div>
        <div class="label">${esc(i.name)}</div>
        <div style="font-size:.72rem;color:var(--muted);margin-top:2px">${esc(i.detail)}</div>
      </div>`).join('');
    const rows = data.daily.map(d => `
      <tr>
        <td data-label="日期">${esc(d.date)}</td>
        <td data-label="佔床">${d.occupied} / ${d.total}</td>
        <td data-label="入住率"><div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;background:#eef3f2;border-radius:4px;height:8px;min-width:60px"><div style="width:${Math.min(100, d.rate)}%;background:var(--primary);height:8px;border-radius:4px"></div></div>
          <span style="min-width:46px;text-align:right">${d.rate}%</span></div></td>
        <td data-label="人力配置">${d.staffing_ok ? '<span class="badge green">符合</span>' : '<span class="badge red">不足</span>'}</td>
      </tr>`).join('');
    $('#qr-body').innerHTML = `
      <div class="card">
        <h3>評鑑品管 7 大指標（${esc(data.month)}）</h3>
        <p style="font-size:.8rem;color:var(--muted);margin:0 0 10px">依衛福部產後護理機構評鑑精神彙整；指標定義與分母（住民日 ${data.patient_days}）可依貴中心評鑑基準調整。</p>
        <div class="stat-grid">${ind}</div>
      </div>
      <div class="card">
        <h3>每日入住率（平均 ${data.avg_occupancy}%）</h3>
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>日期</th><th>佔床 / 總床</th><th>入住率</th><th>人力配置</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
  };

  $('#qr-month').onchange = () => { location.hash = `#/quality-report?m=${$('#qr-month').value}`; load(); };
  $('#qr-print').onclick = () => window.print();
  $('#qr-csv').onclick = () => {
    if (!data) return;
    const lines = [['日期', '佔床', '總床', '入住率%', '人力配置'],
      ...data.daily.map(d => [d.date, d.occupied, d.total, d.rate, d.staffing_ok ? '符合' : '不足'])];
    const csv = '﻿' + lines.map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `每日入住率-${data.month}.csv`;
    a.click();
  };
  load();
}

/* ---------- 評鑑月報 ---------- */
async function viewReports() {
  const month = location.hash.split('?m=')[1] || todayStr().slice(0, 7);
  main().innerHTML = `
    <div class="page-title">評鑑月報</div>
    <div class="card no-print">
      <div class="row">
        <div class="field" style="max-width:200px">
          <label>月份</label>
          <input type="month" id="rp-month" value="${month}">
        </div>
        <div style="align-self:flex-end" class="row">
          <button class="btn secondary" id="rp-print">列印</button>
          <button class="btn secondary" id="rp-pdf">匯出 PDF</button>
          <button class="btn secondary" id="rp-csv">匯出 CSV</button>
        </div>
      </div>
    </div>
    <div id="rp-body"><div class="empty">載入中</div></div>`;

  let data = null;
  const load = async () => {
    data = await api(`/reports/monthly?month=${$('#rp-month').value}`);
    const nc = data.non_compliant_days;
    $('#rp-body').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="num">${data.occupancy_rate}%</div><div class="label">月住房率</div></div>
        <div class="stat"><div class="num">${data.total_baby_records}</div><div class="label">寶寶照護紀錄筆數</div></div>
        <div class="stat"><div class="num">${data.total_mother_records}</div><div class="label">媽媽照護紀錄筆數</div></div>
        <div class="stat"><div class="num">${data.total_handovers}</div><div class="label">交班紀錄筆數</div></div>
        <div class="stat"><div class="num">${data.rash_rate}%</div><div class="label">紅臀發生率（${data.rash_babies}/${data.cared_babies} 位）</div></div>
        <div class="stat"><div class="num" ${data.incident_open ? 'style="color:var(--danger)"' : ''}>${data.incident_total}</div><div class="label">異常事件（未結 ${data.incident_open}）</div></div>
        <div class="stat"><div class="num" ${data.hand_hygiene.rate != null && data.hand_hygiene.rate < data.hand_hygiene.target ? 'style="color:var(--danger)"' : ''}>${pct(data.hand_hygiene.rate)}</div><div class="label">手部衛生遵從率（目標 ${data.hand_hygiene.target}%）</div></div>
        <div class="stat"><div class="num" ${data.screening_pending ? 'style="color:var(--danger)"' : ''}>${data.screening_pending}</div><div class="label">待追蹤新生兒篩檢</div></div>
      </div>
      ${data.revenue ? `<div class="card">
        <h3>營收統計（${data.month}）</h3>
        <div class="stat-grid">
          <div class="stat"><div class="num">${fmtMoney(data.revenue.payments_received)}</div><div class="label">當月實收款</div></div>
          <div class="stat"><div class="num">${fmtMoney(data.revenue.addon_billed)}</div><div class="label">加購入帳（含折抵）</div></div>
          <div class="stat"><div class="num">${fmtMoney(data.revenue.shop_net)}</div><div class="label">商城銷售（${data.revenue.shop_orders} 筆）</div></div>
          <div class="stat"><div class="num">${fmtMoney(data.revenue.program_revenue)}</div><div class="label">課程／服務（${data.revenue.program_signups} 筆）</div></div>
          <div class="stat"><div class="num">${fmtMoney(data.revenue.other_addon)}</div><div class="label">其他加購</div></div>
          <div class="stat"><div class="num">${data.revenue.coupons_used}</div><div class="label">優惠券使用</div></div>
          <div class="stat"><div class="num">${data.revenue.points_redeemed} / ${data.revenue.points_earned}</div><div class="label">點數 折抵／回饋</div></div>
        </div>
        <p style="font-size:.85rem;color:var(--muted);margin-top:6px">「加購入帳」為當月加購消費（含商城、課程與優惠折抵後淨額）；「實收款」為當月繳費總額，兩者用途不同，未必相等。</p>
      </div>` : ''}
      <div class="card">
        <h3>品質與安全指標（${data.month}）</h3>
        <p>
          異常／不良事件：${Object.keys(data.incident_by_category).length
            ? Object.entries(data.incident_by_category).map(([k, v]) => `<span class="badge yellow">${INCIDENT_LABEL[k] || k} ${v}</span>`).join(' ')
            : '<span class="badge green">本月無通報</span>'}<br>
          手部衛生稽核：${data.hand_hygiene.opportunities} 時機，遵從 ${data.hand_hygiene.compliant} 次
          ${data.hand_hygiene.rate != null ? `（${data.hand_hygiene.rate}%${data.hand_hygiene.rate < data.hand_hygiene.target ? '・<span style="color:var(--danger)">未達標</span>' : '・<span style="color:var(--primary-dark)">達標</span>'}）` : ''}<br>
          環境清消簽核：${data.disinfection_count} 次　群聚事件：${data.cluster_count} 件
        </p>
      </div>
      <div class="card">
        <h3>人力比合規（1:${data.ratio}）</h3>
        ${nc.length
          ? `<p><span class="badge red">不合規 ${nc.length} 天</span>　${nc.map(esc).join('、')}</p>`
          : '<p><span class="badge green">全月各班別皆符合法定人力比</span></p>'}
      </div>
      <div class="card">
        <h3>逐日明細（${data.month}）</h3>
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>日期</th><th>住房</th><th>嬰兒</th><th>寶寶紀錄</th><th>媽媽紀錄</th>
              <th>交班</th><th>紅臀</th><th>白班</th><th>小夜</th><th>大夜</th><th>人力比</th>
            </tr></thead>
            <tbody>${data.days.map(d => `
              <tr>
                <td>${d.date.slice(5)}</td>
                <td>${d.occupied_rooms}/${data.total_rooms}</td>
                <td>${d.babies}</td>
                <td>${d.baby_records}</td>
                <td>${d.mother_records}</td>
                <td>${d.handovers}</td>
                <td>${d.rash_records > 0 ? `<span class="badge yellow">${d.rash_records}</span>` : '0'}</td>
                ${d.staffing.map(s => `<td>${s.nurses}/${s.required}</td>`).join('')}
                <td>${d.babies === 0
                  ? '<span class="badge gray">無住客</span>'
                  : d.staffing_ok
                    ? '<span class="badge green">符合</span>'
                    : '<span class="badge red">不足</span>'}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h3>異常事件清單</h3>
        ${data.alerts.length ? `<ul class="timeline">${data.alerts.map(a => `
          <li>
            <div class="time">${esc(a.recorded_at)}</div>
            <div class="what">${esc(a.baby_name)}　${BABY_TYPE_LABEL[a.record_type]}異常：${esc(String(alertDetail(a)))}</div>
          </li>`).join('')}</ul>` : '<div class="empty">本月無異常事件</div>'}
      </div>`;
  };

  $('#rp-month').onchange = load;
  $('#rp-print').onclick = () => window.print();
  $('#rp-pdf').onclick = () => { window.open(`/api/reports/monthly.pdf?month=${$('#rp-month').value}`, '_blank'); };
  $('#rp-csv').onclick = () => {
    if (!data) return;
    const head = ['日期', '住房數', '在住嬰兒', '寶寶紀錄', '媽媽紀錄', '交班', '紅臀發生',
      '白班(實/需)', '小夜(實/需)', '大夜(實/需)', '人力比合規'];
    const rows = data.days.map(d => [
      d.date, d.occupied_rooms, d.babies, d.baby_records, d.mother_records, d.handovers, d.rash_records,
      ...d.staffing.map(s => `${s.nurses}/${s.required}`),
      d.babies === 0 ? '無住客' : d.staffing_ok ? '符合' : '不足'
    ]);
    const csv = '﻿' + [head, ...rows].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `評鑑月報-${data.month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  load();
}

/* ---------- 系統設定 ---------- */
async function viewSettings() {
  const s = await api('/settings');
  main().innerHTML = `
    <div class="page-title">系統設定</div>
    <div class="card">
      <div class="form-grid">
        <div class="field full"><label>機構名稱</label><input id="st-name" value="${esc(s.center_name)}"></div>
        <div class="field">
          <label>護理人力比（1 名護理人員照護嬰兒數）</label>
          <input type="number" id="st-ratio" min="1" max="20" value="${esc(s.nurse_baby_ratio)}">
        </div>
        <div class="field">
          <label>黃疸警示值 (mg/dL，達此值列入異常)</label>
          <input type="number" step="0.1" id="st-jaundice" value="${esc(s.jaundice_alert)}">
        </div>
        <div class="field">
          <label>體溫過高警示 (度C)</label>
          <input type="number" step="0.1" id="st-temp-high" value="${esc(s.temp_high)}">
        </div>
        <div class="field">
          <label>體溫過低警示 (度C)</label>
          <input type="number" step="0.1" id="st-temp-low" value="${esc(s.temp_low)}">
        </div>
        <div class="field full">
          <label>餵食方式選項（逗號分隔）</label>
          <input id="st-feed" value="${esc(s.feed_methods)}">
        </div>
        <div class="field full">
          <label>生產方式選項（逗號分隔）</label>
          <input id="st-delivery" value="${esc(s.delivery_types)}">
        </div>
        <div class="field full">
          <label>繳費方式選項（逗號分隔）</label>
          <input id="st-payment" value="${esc(s.payment_methods)}">
        </div>
        <div class="field full">
          <label>加購消費常用項目（逗號分隔）</label>
          <input id="st-charge" value="${esc(s.charge_presets)}">
        </div>
        <div class="field full">
          <label>餐點選項（逗號分隔）</label>
          <input id="st-meal" value="${esc(s.meal_choices)}">
        </div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>新生兒觀察選項（逗號分隔）</strong></div>
        <div class="field"><label>膚色／發紺</label><input id="st-skin" value="${esc(s.skin_options)}"></div>
        <div class="field"><label>臍帶狀態</label><input id="st-cord" value="${esc(s.cord_options)}"></div>
        <div class="field"><label>溢吐奶</label><input id="st-vomit" value="${esc(s.vomit_options)}"></div>
        <div class="field"><label>活動力</label><input id="st-activity" value="${esc(s.activity_options)}"></div>
        <div class="field"><label>大便性狀</label><input id="st-stool" value="${esc(s.stool_options)}"></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>產婦評估選項（一頁式評估的下拉內容，逗號分隔）</strong></div>
        <div class="field"><label>傷口護理</label><input id="st-wound" value="${esc(s.wound_options || '')}"></div>
        <div class="field"><label>子宮護理</label><input id="st-uterus" value="${esc(s.uterus_options || '')}"></div>
        <div class="field"><label>乳房護理</label><input id="st-breast" value="${esc(s.breast_options || '')}"></div>
        <div class="field"><label>惡露觀察</label><input id="st-lochia" value="${esc(s.lochia_options || '')}"></div>
        <div class="field"><label>排泄</label><input id="st-elimination" value="${esc(s.elimination_options || '')}"></div>
        <div class="field"><label>泌乳指導</label><input id="st-lactation" value="${esc(s.lactation_options || '')}"></div>
        <div class="field"><label>情緒評估</label><input id="st-mood" value="${esc(s.mood_options || '')}"></div>
        <div class="field"><label>衛教指導</label><input id="st-education" value="${esc(s.education_options || '')}"></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>帳款</strong></div>
        <div class="field"><label>寶寶不在館內每日扣抵（元）</label><input type="number" id="st-baby-deduct" min="0" value="${esc(s.baby_absence_daily_deduct || '0')}"></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>房務清潔（逗號分隔）</strong></div>
        <div class="field full"><label>住客需求項目</label><input id="st-hk-needs" value="${esc(s.hk_need_options || '')}"></div>
        <div class="field full"><label>清潔常用任務</label><input id="st-hk-tasks" value="${esc(s.hk_task_presets || '')}"></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>新生兒醫療／異常事件快選（逗號分隔）</strong></div>
        <div class="field"><label>常用藥品</label><input id="st-med-drug" value="${esc(s.med_drug_options || '')}"></div>
        <div class="field"><label>給藥途徑</label><input id="st-med-route" value="${esc(s.med_route_options || '')}"></div>
        <div class="field"><label>接種部位</label><input id="st-vac-site" value="${esc(s.vaccine_site_options || '')}"></div>
        <div class="field"><label>異常發生地點</label><input id="st-inc-loc" value="${esc(s.incident_location_options || '')}"></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>感染管制／員工證照快選（逗號分隔）</strong></div>
        <div class="field"><label>手衛稽核區域</label><input id="st-hh-area" value="${esc(s.hh_area_options || '')}"></div>
        <div class="field"><label>手衛稽核對象</label><input id="st-hh-role" value="${esc(s.hh_role_options || '')}"></div>
        <div class="field"><label>清消區域/設備</label><input id="st-dis-area" value="${esc(s.disinfect_area_options || '')}"></div>
        <div class="field"><label>消毒方式</label><input id="st-dis-agent" value="${esc(s.disinfect_agent_options || '')}"></div>
        <div class="field"><label>證照名稱</label><input id="st-cert-name" value="${esc(s.cert_name_options || '')}"></div>
        <div class="field"><label>發證單位</label><input id="st-cert-issuer" value="${esc(s.cert_issuer_options || '')}"></div>
        <div class="field"><label>巡診醫師</label><input id="st-visit-physician" value="${esc(s.visit_physician_options || '')}"></div>
        <div class="field full">
          <label>LINE Channel Access Token（設定後，已綁定的家屬改走 LINE 推播）</label>
          <input id="st-line" value="${esc(s.line_channel_access_token)}" placeholder="留空表示僅使用家屬入口">
        </div>
        <div class="field"><label>異常通知 LINE 目標（值班 userId / 群組 id）</label><input id="st-line-alert" value="${esc(s.line_staff_alert_id)}" placeholder="體溫/黃疸超標時即時推播"></div>
        <div class="field"><label>退房自動推滿意度問卷</label><select id="st-survey-co"><option value="1" ${s.survey_on_checkout === '1' ? 'selected' : ''}>開啟</option><option value="0" ${s.survey_on_checkout === '0' ? 'selected' : ''}>關閉</option></select></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>LINE／Facebook 雙向客訊（CRM）</strong>
          <p class="sig-hint" style="color:#6b7c79;margin:4px 0">設定後可在「LINE／FB 客訊」收發訊息。LINE Webhook 指向 <code>/api/webhooks/line</code>、FB 指向 <code>/api/webhooks/facebook</code>。</p></div>
        <div class="field"><label>LINE Channel Secret（驗簽）</label><input id="st-line-secret" value="${esc(s.line_channel_secret)}" placeholder="收訊驗簽用"></div>
        <div class="field"><label>LINE LIFF ID（官賴預約參觀頁）</label><input id="st-line-liff" value="${esc(s.line_liff_id || '')}" placeholder="例 1234567890-abcdefgh；LIFF Endpoint 設為 /tour-booking.html"></div>
        <div class="field"><label>家屬日報自動推播時間（前一日摘要＋成長趨勢）</label><input id="st-fam-push" value="${esc(s.family_daily_push_time || '')}" placeholder="例 10:00；留空停用"></div>
        <div class="field"><label>FB 粉專 Access Token</label><input id="st-fb-token" value="${esc(s.fb_page_access_token)}"></div>
        <div class="field"><label>FB App Secret（驗簽）</label><input id="st-fb-secret" value="${esc(s.fb_app_secret)}"></div>
        <div class="field"><label>FB Webhook Verify Token（自訂）</label><input id="st-fb-verify" value="${esc(s.fb_verify_token)}"></div>
        <div class="field">
          <label>手部衛生遵從率目標 (%)</label>
          <input type="number" id="st-hh" min="0" max="100" value="${esc(s.hand_hygiene_target)}">
        </div>
        <div class="field">
          <label>餵奶間隔提醒 (小時，超過即提醒該餵奶)</label>
          <input type="number" step="0.5" id="st-feed-int" min="0.5" value="${esc(s.feed_interval_hours)}">
        </div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>電子發票（財政部 MIG 3.2）</strong>
          <p class="sig-hint" style="color:#6b7c79;margin:4px 0">填入加值中心（如 ecPay、關貿）業者與 API 後即可上傳大平台；留空則僅供本地收據列印存證。</p></div>
        <div class="field"><label>賣方名稱</label><input id="st-ei-name" value="${esc(s.einvoice_seller_name)}"></div>
        <div class="field"><label>賣方統一編號</label><input id="st-ei-taxid" maxlength="8" value="${esc(s.einvoice_seller_tax_id)}"></div>
        <div class="field"><label>預設稅別</label>
          <select id="st-ei-tax"><option value="3" ${s.einvoice_tax_type === '3' ? 'selected' : ''}>免稅</option><option value="1" ${s.einvoice_tax_type === '1' ? 'selected' : ''}>應稅</option><option value="2" ${s.einvoice_tax_type === '2' ? 'selected' : ''}>零稅率</option></select></div>
        <div class="field"><label>稅率 (%)</label><input type="number" id="st-ei-rate" value="${esc(s.einvoice_tax_rate)}"></div>
        <div class="field"><label>加值中心業者</label><input id="st-ei-provider" value="${esc(s.einvoice_provider)}" placeholder="ecpay / tradevan…"></div>
        <div class="field"><label>API 網址</label><input id="st-ei-url" value="${esc(s.einvoice_api_url)}"></div>
        <div class="field full"><label>API 金鑰</label><input id="st-ei-key" value="${esc(s.einvoice_api_key)}" placeholder="留空表示未啟用上傳"></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>線上金流（ECPay 綠界）</strong>
          <p class="sig-hint" style="color:#6b7c79;margin:4px 0">填入綠界特店資訊後，收費明細可「線上收款」；綠界 ReturnURL 請設為 <code>對外網址/api/webhooks/ecpay</code>。</p></div>
        <div class="field"><label>啟用</label><select id="st-pay-prov"><option value="" ${s.payment_provider === '' ? 'selected' : ''}>停用</option><option value="ecpay" ${s.payment_provider === 'ecpay' ? 'selected' : ''}>ECPay 綠界</option></select></div>
        <div class="field"><label>環境</label><select id="st-pay-stage"><option value="1" ${s.ecpay_stage === '1' ? 'selected' : ''}>測試</option><option value="0" ${s.ecpay_stage === '0' ? 'selected' : ''}>正式</option></select></div>
        <div class="field"><label>MerchantID</label><input id="st-pay-mid" value="${esc(s.ecpay_merchant_id)}"></div>
        <div class="field"><label>對外網址</label><input id="st-pay-url" value="${esc(s.public_base_url)}" placeholder="https://mamacare.crownai.ink"></div>
        <div class="field"><label>HashKey</label><input id="st-pay-key" value="${esc(s.ecpay_hash_key)}"></div>
        <div class="field"><label>HashIV</label><input id="st-pay-iv" value="${esc(s.ecpay_hash_iv)}"></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>會員點數（商城）</strong></div>
        <div class="field"><label>每滿多少元回饋 1 點</label><input type="number" id="st-pt-per" min="1" value="${esc(s.points_earn_per)}"></div>
        <div class="field"><label>1 點折抵金額（元）</label><input type="number" id="st-pt-val" min="0" value="${esc(s.points_value)}"></div>
        <div class="field"><label>啟用點數</label><select id="st-pt-on"><option value="1" ${s.points_enabled === '1' ? 'selected' : ''}>啟用</option><option value="0" ${s.points_enabled === '0' ? 'selected' : ''}>停用</option></select></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>月子餐</strong></div>
        <div class="field full"><label>餐別（逗號分隔）</label><input id="st-meal-slots" value="${esc(s.meal_slots)}"></div>
        <div class="field full"><label>飲食類型（逗號分隔）</label><input id="st-meal-diets" value="${esc(s.meal_diets)}"></div>
        <div class="field full"><label>餐期階段（JSON：name/from/to 產後天數）</label><textarea id="st-meal-stages" rows="2">${esc(s.meal_stages)}</textarea></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>員工證照</strong></div>
        <div class="field"><label>到期前幾天提醒</label><input type="number" id="st-cert-days" min="1" value="${esc(s.cert_alert_days)}"></div>
        <div class="full" style="border-top:1px solid var(--border,#dde5e3);padding-top:8px;margin-top:4px"><strong>衛福部通報介接</strong>
          <p class="sig-hint" style="color:#6b7c79;margin:4px 0">填入主管機關／加值平台 API 後可自動上傳並於失敗時重試；留空則僅本地產生，可用「資料匯出」報送。</p></div>
        <div class="field"><label>API 網址</label><input id="st-gov-url" value="${esc(s.gov_api_url)}"></div>
        <div class="field"><label>機構代碼</label><input id="st-gov-org" value="${esc(s.gov_org_code)}"></div>
        <div class="field"><label>API 金鑰</label><input id="st-gov-key" value="${esc(s.gov_api_key)}" placeholder="留空表示未啟用上傳"></div>
        <div class="field"><label>自動上傳</label><select id="st-gov-auto"><option value="0" ${s.gov_auto_upload === '0' ? 'selected' : ''}>關閉（手動）</option><option value="1" ${s.gov_auto_upload === '1' ? 'selected' : ''}>開啟（產生即上傳＋自動重試）</option></select></div>
        <div class="full row">
          <button class="btn" id="st-save">儲存設定</button>
          <span class="ok-msg" id="st-ok"></span>
          <span class="error-msg" id="st-err"></span>
        </div>
      </div>
    </div>`;

  $('#st-save').onclick = async () => {
    $('#st-err').textContent = '';
    try {
      await api('/settings', {
        method: 'PUT',
        body: {
          center_name: $('#st-name').value.trim(),
          nurse_baby_ratio: Number($('#st-ratio').value),
          jaundice_alert: $('#st-jaundice').value,
          temp_high: $('#st-temp-high').value,
          temp_low: $('#st-temp-low').value,
          feed_methods: $('#st-feed').value,
          delivery_types: $('#st-delivery').value,
          payment_methods: $('#st-payment').value,
          charge_presets: $('#st-charge').value,
          meal_choices: $('#st-meal').value,
          skin_options: $('#st-skin').value,
          cord_options: $('#st-cord').value,
          vomit_options: $('#st-vomit').value,
          activity_options: $('#st-activity').value,
          stool_options: $('#st-stool').value,
          wound_options: $('#st-wound').value,
          uterus_options: $('#st-uterus').value,
          breast_options: $('#st-breast').value,
          lochia_options: $('#st-lochia').value,
          elimination_options: $('#st-elimination').value,
          lactation_options: $('#st-lactation').value,
          mood_options: $('#st-mood').value,
          education_options: $('#st-education').value,
          baby_absence_daily_deduct: $('#st-baby-deduct').value,
          hk_need_options: $('#st-hk-needs').value,
          hk_task_presets: $('#st-hk-tasks').value,
          med_drug_options: $('#st-med-drug').value,
          med_route_options: $('#st-med-route').value,
          vaccine_site_options: $('#st-vac-site').value,
          incident_location_options: $('#st-inc-loc').value,
          hh_area_options: $('#st-hh-area').value,
          hh_role_options: $('#st-hh-role').value,
          disinfect_area_options: $('#st-dis-area').value,
          disinfect_agent_options: $('#st-dis-agent').value,
          cert_name_options: $('#st-cert-name').value,
          cert_issuer_options: $('#st-cert-issuer').value,
          visit_physician_options: $('#st-visit-physician').value,
          line_channel_access_token: $('#st-line').value.trim(),
          line_staff_alert_id: $('#st-line-alert').value.trim(),
          survey_on_checkout: $('#st-survey-co').value,
          line_channel_secret: $('#st-line-secret').value.trim(),
          line_liff_id: $('#st-line-liff').value.trim(),
          family_daily_push_time: $('#st-fam-push').value.trim(),
          fb_page_access_token: $('#st-fb-token').value.trim(),
          fb_app_secret: $('#st-fb-secret').value.trim(),
          fb_verify_token: $('#st-fb-verify').value.trim(),
          hand_hygiene_target: $('#st-hh').value,
          feed_interval_hours: $('#st-feed-int').value,
          einvoice_seller_name: $('#st-ei-name').value.trim(),
          einvoice_seller_tax_id: $('#st-ei-taxid').value.trim(),
          einvoice_tax_type: $('#st-ei-tax').value,
          einvoice_tax_rate: $('#st-ei-rate').value,
          einvoice_provider: $('#st-ei-provider').value.trim(),
          einvoice_api_url: $('#st-ei-url').value.trim(),
          einvoice_api_key: $('#st-ei-key').value.trim(),
          payment_provider: $('#st-pay-prov').value,
          ecpay_stage: $('#st-pay-stage').value,
          ecpay_merchant_id: $('#st-pay-mid').value.trim(),
          public_base_url: $('#st-pay-url').value.trim(),
          ecpay_hash_key: $('#st-pay-key').value.trim(),
          ecpay_hash_iv: $('#st-pay-iv').value.trim(),
          points_earn_per: $('#st-pt-per').value,
          points_value: $('#st-pt-val').value,
          points_enabled: $('#st-pt-on').value,
          meal_slots: $('#st-meal-slots').value.trim(),
          meal_diets: $('#st-meal-diets').value.trim(),
          meal_stages: $('#st-meal-stages').value.trim(),
          cert_alert_days: $('#st-cert-days').value,
          gov_api_url: $('#st-gov-url').value.trim(),
          gov_org_code: $('#st-gov-org').value.trim(),
          gov_api_key: $('#st-gov-key').value.trim(),
          gov_auto_upload: $('#st-gov-auto').value
        }
      });
      SETTINGS = await api('/settings');
      applyBrand();
      $('#st-ok').textContent = '已儲存';
      setTimeout(() => { const el = $('#st-ok'); if (el) el.textContent = ''; }, 2500);
    } catch (e) {
      $('#st-err').textContent = e.message;
    }
  };
}

/* ---------- 電子合約與簽署 ---------- */
const CONTRACT_STATUS = {
  pending: { label: '待簽署', badge: 'yellow' },
  signed: { label: '已簽署', badge: 'green' },
  void: { label: '已作廢', badge: 'gray' }
};

function signLink(token) {
  return `${location.origin}/sign.html?t=${token}`;
}

// 經手人下拉：列出在職員工姓名，selected 為預設選取的姓名
function handlerSelectOptions(users, selected) {
  const names = [...new Set((users || []).filter(u => u.active !== 0 && u.name).map(u => u.name))];
  if (selected && !names.includes(selected)) names.unshift(selected);
  return `<option value="">未指定</option>` +
    names.map(n => `<option ${n === selected ? 'selected' : ''}>${esc(n)}</option>`).join('');
}

// 另開視窗列印／另存 PDF：凍結全文 + 簽名圖 + 簽署存證
function printContract(c) {
  const st = CONTRACT_STATUS[c.status] || CONTRACT_STATUS.pending;
  const proof = c.status === 'signed' ? `
    <div class="sign-block">
      <div class="sig">
        <img src="${c.signature_data}" alt="簽名">
        <div class="sig-line">消費者簽名：${esc(c.signer_name)}${c.signer_relation ? `（${esc(c.signer_relation)}）` : ''}</div>
      </div>
      <div class="proof">
        簽署時間：${esc(c.signed_at)}<br>
        ${c.signer_id_last4 ? `身分證末四碼：${esc(c.signer_id_last4)}<br>` : ''}
        簽署來源 IP：${esc(c.signed_ip || '-')}<br>
        簽署裝置：${esc(c.signed_ua || '-')}
      </div>
    </div>` : `<div class="sign-block"><div class="unsigned">— 本合約尚未完成簽署 —</div></div>`;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">
    <title>${esc(c.title)}</title>
    <style>
      body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#1c2b29;line-height:1.7;
        max-width:760px;margin:24px auto;padding:0 24px}
      .status{text-align:right;color:${st.badge === 'green' ? '#2a7f78' : st.badge === 'gray' ? '#888' : '#c98a00'};font-weight:700}
      pre{white-space:pre-wrap;font-family:inherit;font-size:15px;margin:12px 0 28px}
      .sign-block{border-top:1px solid #ccc;padding-top:18px;margin-top:18px}
      .sig img{max-width:280px;max-height:120px;border-bottom:1px solid #333}
      .sig-line{margin-top:6px;font-weight:700}
      .proof{margin-top:14px;font-size:12px;color:#666}
      .unsigned{color:#c98a00;font-weight:700}
      @media print{.noprint{display:none}}
    </style></head><body>
    <div class="status">${st.label}</div>
    ${c.handler ? `<div style="font-size:13px;color:#555;margin-bottom:6px">經手人：${esc(c.handler)}</div>` : ''}
    <pre>${esc(c.body)}</pre>
    ${proof}
    <div class="noprint" style="margin-top:24px;text-align:center">
      <button onclick="window.print()" style="padding:10px 24px;font-size:15px">列印 / 另存 PDF</button>
    </div>
    </body></html>`);
  win.document.close();
}

async function viewContracts() {
  const isAdmin = currentUser.role === 'admin';
  const [contracts, templates, bookings, users] = await Promise.all([
    api('/contracts'), api('/contract-templates'), api('/bookings'), api('/users')
  ]);
  const activeTpls = templates.filter(t => t.active);
  const handlerOptions = handlerSelectOptions(users, currentUser.name);
  main().innerHTML = `
    <div class="page-title">合約簽署</div>
    <div class="card">
      <h3>建立合約</h3>
      <div class="form-grid">
        <div class="field full">
          <label>選擇訂房</label>
          <select id="ct-booking">
            <option value="">請選擇訂房</option>
            ${bookings.map(b => `<option value="${b.id}">${esc(b.mother_name)}　${esc(b.room_name)} 房　${esc(b.check_in)}~${esc(b.check_out)}</option>`).join('')}
          </select>
        </div>
        <div class="field full">
          <label>合約範本</label>
          <select id="ct-template">
            ${activeTpls.length
              ? activeTpls.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')
              : '<option value="">尚無啟用範本，請先到下方管理範本</option>'}
          </select>
        </div>
        <div class="field">
          <label>經手人</label>
          <select id="ct-handler">${handlerOptions}</select>
        </div>
        <div class="full row">
          <button class="btn" id="ct-create">產生合約</button>
          ${isAdmin ? '<button class="btn secondary" id="ct-tpl">管理合約範本</button>' : ''}
          <span class="error-msg" id="ct-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      ${filterBar({ placeholder: '搜尋媽媽 / 房間 / 合約名稱…', statuses: [{ val: '', label: '全部' }, { val: 'pending', label: '待簽署' }, { val: 'signed', label: '已簽署' }, { val: 'void', label: '已作廢' }] })}
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>媽媽 / 房間</th><th>合約</th><th>經手人</th><th>狀態</th><th>簽署人</th><th>操作</th></tr></thead>
          <tbody>${contracts.map(c => {
            const st = CONTRACT_STATUS[c.status] || CONTRACT_STATUS.pending;
            return `<tr data-filter="${esc((c.mother_name || '') + ' ' + (c.room_name || '') + ' ' + c.title + ' ' + (c.signer_name || '') + ' ' + (c.handler || ''))}" data-status="${c.status}">
              <td data-label="媽媽 / 房間">${esc(c.mother_name || '-')}<br><small>${esc(c.room_name || '')} 房</small></td>
              <td data-label="合約">${esc(c.title)}<br><small>${esc(c.created_at?.slice(0, 16) || '')}　${esc(c.created_by_name || '')}</small></td>
              <td data-label="經手人">${esc(c.handler || '-')}</td>
              <td data-label="狀態"><span class="badge ${st.badge}">${st.label}</span></td>
              <td data-label="簽署人">${c.status === 'signed' ? `${esc(c.signer_name)}${c.signer_relation ? `（${esc(c.signer_relation)}）` : ''}<br><small>${esc(c.signed_at || '')}</small>` : '-'}</td>
              <td data-label="操作">
                ${c.status === 'pending' ? `<button class="btn small secondary" data-link="${esc(c.sign_token)}">簽署連結</button>` : ''}
                ${c.status === 'pending' ? `<button class="btn small secondary" data-edit="${c.id}">編輯內容</button>` : ''}
                ${c.status !== 'void' ? `<button class="btn small secondary" data-resign="${c.id}">重新簽署</button>` : ''}
                <button class="btn small secondary" data-view="${c.id}">檢視 / 列印</button>
                ${isAdmin && c.status === 'signed' ? `<button class="btn small danger" data-void="${c.id}">作廢</button>` : ''}
                ${isAdmin && c.status === 'pending' ? `<button class="btn small danger" data-del="${c.id}">刪除</button>` : ''}
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="6"><div class="empty">尚無合約</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  wireFilter(main());

  $('#ct-create').onclick = async () => {
    const bookingId = $('#ct-booking').value;
    const templateId = $('#ct-template').value;
    $('#ct-err').textContent = '';
    if (!bookingId) { $('#ct-err').textContent = '請選擇訂房'; return; }
    if (!templateId) { $('#ct-err').textContent = '請選擇合約範本'; return; }
    try {
      await api(`/bookings/${bookingId}/contracts`, { method: 'POST', body: { template_id: Number(templateId), handler: $('#ct-handler').value } });
      viewContracts();
    } catch (e) { $('#ct-err').textContent = e.message; }
  };

  if ($('#ct-tpl')) $('#ct-tpl').onclick = () => openTemplateManager();

  main().querySelectorAll('[data-link]').forEach(btn => {
    btn.onclick = () => openSignLink(btn.dataset.link);
  });
  main().querySelectorAll('[data-view]').forEach(btn => {
    btn.onclick = async () => { printContract(await api(`/contracts/${btn.dataset.view}`)); };
  });
  main().querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = async () => openContractEditor(await api(`/contracts/${btn.dataset.edit}`), 'edit');
  });
  main().querySelectorAll('[data-resign]').forEach(btn => {
    btn.onclick = async () => openContractEditor(await api(`/contracts/${btn.dataset.resign}`), 'resign');
  });
  main().querySelectorAll('[data-void]').forEach(btn => {
    btn.onclick = async () => {
      const reason = prompt('請輸入作廢原因（可留空）：', '');
      if (reason === null) return;
      await api(`/contracts/${btn.dataset.void}/void`, { method: 'POST', body: { reason } });
      viewContracts();
    };
  });
  main().querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這份未簽署的合約？')) return;
      await api(`/contracts/${btn.dataset.del}`, { method: 'DELETE' });
      viewContracts();
    };
  });
}

// 合約編輯 / 重新簽署。mode='edit'（直接改未簽署的內容）或 'resign'（建立新版、原約作廢）
async function openContractEditor(c, mode) {
  const resign = mode === 'resign';
  const users = await api('/users');
  const handlerOptions = handlerSelectOptions(users, c.handler || '');
  openModal(resign ? '重新簽署（建立新版合約）' : '編輯合約內容', `
    ${resign ? `<p style="font-size:.85rem;color:var(--muted)">將以下方內容建立一份<strong>新合約</strong>並產生新的簽署連結；原合約（${c.status === 'signed' ? '已簽署' : '待簽署'}）會自動作廢並保留存證。</p>` : ''}
    <div class="form-grid">
      <div class="field full"><label>合約名稱</label><input id="ce-title" value="${esc(c.title || '')}"></div>
      <div class="field"><label>經手人</label><select id="ce-handler">${handlerOptions}</select></div>
      <div class="field full"><label>合約內容</label><textarea id="ce-body" rows="14" style="font-family:inherit">${esc(c.body || '')}</textarea></div>
    </div>
    <div class="row" style="margin-top:8px"><button class="btn" id="ce-save">${resign ? '建立新版並取得簽署連結' : '儲存'}</button><span class="error-msg" id="ce-err"></span></div>`, body => {
    body.querySelector('#ce-save').onclick = async () => {
      const payload = { title: body.querySelector('#ce-title').value.trim(), body: body.querySelector('#ce-body').value, handler: body.querySelector('#ce-handler').value };
      try {
        if (resign) {
          const r = await api(`/contracts/${c.id}/resign`, { method: 'POST', body: payload });
          closeModal();
          openSignLink(r.sign_token);   // 直接給出新簽署連結
          viewContracts();
        } else {
          await api(`/contracts/${c.id}`, { method: 'PUT', body: payload });
          closeModal(); viewContracts();
        }
      } catch (e) { body.querySelector('#ce-err').textContent = e.message; }
    };
  });
}

function openSignLink(token) {
  const url = signLink(token);
  openModal('簽署連結', `
    <p>讓客人在平板／手機開啟此連結，閱讀合約後手寫簽名即可：</p>
    <div class="field"><input id="sl-url" value="${esc(url)}" readonly onclick="this.select()"></div>
    <div class="row">
      <button class="btn" id="sl-copy">複製連結</button>
      <a class="btn secondary" href="${esc(url)}" target="_blank">在本機開啟</a>
    </div>
    <span class="error-msg" id="sl-msg" style="color:var(--primary-dark)"></span>`, body => {
    body.querySelector('#sl-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        body.querySelector('#sl-msg').textContent = '已複製';
      } catch (e) {
        body.querySelector('#sl-url').select();
        body.querySelector('#sl-msg').textContent = '請手動複製（已選取）';
      }
    };
  });
}

async function openTemplateManager() {
  const templates = await api('/contract-templates');
  const list = templates.map(t => `
    <tr>
      <td data-label="範本">${esc(t.name)} ${t.active ? '' : '<span class="badge gray">停用</span>'}</td>
      <td data-label="操作">
        <button class="btn small secondary" data-edit-tpl="${t.id}">編輯</button>
        <button class="btn small danger" data-del-tpl="${t.id}">刪除</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="2"><div class="empty">尚無範本</div></td></tr>';
  openModal('合約範本管理', `
    <p>範本內容可使用占位符，產生合約時自動帶入訂房資料：<br>
      <small>${esc('{{center_name}} {{mother_name}} {{mother_phone}} {{room_name}} {{room_type}} {{check_in}} {{check_out}} {{days}} {{total_amount}} {{deposit}} {{balance}} {{today}}')}</small></p>
    <div class="table-wrap"><table class="data stack"><tbody>${list}</tbody></table></div>
    <div class="row mt"><button class="btn" id="tpl-new">新增範本</button></div>`, body => {
    body.querySelector('#tpl-new').onclick = () => openTemplateEditor(null);
    body.querySelectorAll('[data-edit-tpl]').forEach(b =>
      b.onclick = () => openTemplateEditor(templates.find(t => t.id == b.dataset.editTpl)));
    body.querySelectorAll('[data-del-tpl]').forEach(b =>
      b.onclick = async () => {
        if (!confirm('確定刪除此範本？已產生的合約不受影響。')) return;
        await api(`/contract-templates/${b.dataset.delTpl}`, { method: 'DELETE' });
        openTemplateManager();
      });
  });
}

function openTemplateEditor(tpl) {
  openModal(tpl ? '編輯範本' : '新增範本', `
    <div class="form-grid">
      <div class="field full"><label>範本名稱</label><input id="te-name" value="${esc(tpl?.name || '')}"></div>
      <div class="field full"><label>啟用</label>
        <select id="te-active"><option value="1" ${!tpl || tpl.active ? 'selected' : ''}>啟用</option><option value="0" ${tpl && !tpl.active ? 'selected' : ''}>停用</option></select>
      </div>
      <div class="field full"><label>合約內容</label>
        <textarea id="te-body" rows="14" style="font-family:inherit">${esc(tpl?.body || '')}</textarea>
      </div>
      <div class="full row"><button class="btn" id="te-save">儲存</button><span class="error-msg" id="te-err"></span></div>
    </div>`, body => {
    body.querySelector('#te-save').onclick = async () => {
      const payload = {
        name: body.querySelector('#te-name').value.trim(),
        body: body.querySelector('#te-body').value,
        active: Number(body.querySelector('#te-active').value)
      };
      try {
        if (tpl) await api(`/contract-templates/${tpl.id}`, { method: 'PUT', body: payload });
        else await api('/contract-templates', { method: 'POST', body: payload });
        openTemplateManager();
      } catch (e) { body.querySelector('#te-err').textContent = e.message; }
    };
  });
}

/* ---------- 資料匯出與每日備份 ---------- */
// 另開視窗以表格列印／另存 PDF
function printTable(label, columns, rows) {
  const head = columns.map(c => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.length
    ? rows.map(r => `<tr>${columns.map(c => `<td>${esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" style="text-align:center;color:#888">無資料</td></tr>`;
  const center = (SETTINGS && SETTINGS.center_name) || 'MamaCare';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">
    <title>${esc(label)}</title>
    <style>
      body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#1c2b29;margin:24px}
      h2{margin:0 0 4px} .meta{color:#666;font-size:12px;margin-bottom:14px}
      table{border-collapse:collapse;width:100%;font-size:12.5px}
      th,td{border:1px solid #bcc;padding:5px 8px;text-align:left;vertical-align:top}
      th{background:#eef5f4}
      @media print{.noprint{display:none}}
    </style></head><body>
    <h2>${esc(center)}　${esc(label)}</h2>
    <div class="meta">匯出時間：${esc(new Date().toLocaleString('zh-Hant-TW'))}　共 ${rows.length} 筆</div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <div class="noprint" style="margin-top:20px;text-align:center">
      <button onclick="window.print()" style="padding:10px 24px;font-size:15px">列印 / 另存 PDF</button>
    </div></body></html>`);
  win.document.close();
}

async function viewExport() {
  const [datasets, bk] = await Promise.all([api('/export/datasets'), api('/backups')]);
  const rows = datasets.map(d => `
    <tr>
      <td data-label="資料">${esc(d.label)}</td>
      <td data-label="匯出">
        <a class="btn small secondary" href="/api/export/${encodeURIComponent(d.key)}?format=xlsx">匯出 Excel</a>
        <a class="btn small secondary" href="/api/export/${encodeURIComponent(d.key)}?format=pdf" target="_blank">匯出 PDF</a>
      </td>
    </tr>`).join('');
  const backupRows = bk.backups.length
    ? bk.backups.map(b => `
      <tr>
        <td data-label="備份檔">${esc(b.name)}</td>
        <td data-label="時間">${esc(b.created_at)}</td>
        <td data-label="大小">${(b.size / 1024).toFixed(0)} KB</td>
        <td data-label="下載"><a class="btn small secondary" href="/api/backups/${encodeURIComponent(b.name)}">下載</a>
          <button class="btn small danger" data-restore="${esc(b.name)}">還原</button></td>
      </tr>`).join('')
    : '<tr><td colspan="4"><div class="empty">尚無備份</div></td></tr>';

  main().innerHTML = `
    <div class="page-title">資料匯出與備份</div>
    <div class="card">
      <h3>資料匯出</h3>
      <p class="sig-hint" style="color:#6b7c79">每份資料皆可直接下載 Excel（.xlsx）或 PDF 檔。</p>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>資料</th><th>匯出格式</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <div class="card">
      <h3>每日備份</h3>
      <p class="sig-hint" style="color:#6b7c79">系統每日凌晨 3 點自動備份整個資料庫，保留最近 ${bk.retain} 份；亦可隨時手動備份。最近一次：${bk.last ? esc(bk.last.created_at) : '尚無'}。<br><strong>還原</strong>會以該備份覆蓋現行資料，還原前系統自動保留一份安全備份，完成後自動重啟。</p>
      <div class="row" style="margin-bottom:10px">
        <button class="btn" id="bk-now">立即備份</button>
        <span class="error-msg" id="bk-msg" style="color:var(--primary-dark)"></span>
      </div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>備份檔</th><th>時間</th><th>大小</th><th>下載</th></tr></thead>
        <tbody>${backupRows}</tbody>
      </table></div>
    </div>`;

  main().querySelectorAll('[data-pdf]').forEach(btn => {
    btn.onclick = async () => {
      const d = await api(`/export/${btn.dataset.pdf}`);
      printTable(d.label, d.columns, d.rows);
    };
  });
  $('#bk-now').onclick = async () => {
    $('#bk-msg').textContent = '備份中…';
    try {
      const r = await api('/backups', { method: 'POST' });
      $('#bk-msg').textContent = `已備份：${r.name}`;
      setTimeout(viewExport, 800);
    } catch (e) { $('#bk-msg').textContent = e.message; }
  };
  main().querySelectorAll('[data-restore]').forEach(btn => btn.onclick = async () => {
    const name = btn.dataset.restore;
    if (!confirm(`確定以「${name}」還原資料庫？\n現行資料將被覆蓋（系統會先自動保留一份安全備份），完成後系統會自動重啟，請稍候約 10 秒再重新整理。`)) return;
    $('#bk-msg').textContent = '還原中，系統即將重啟…';
    try {
      const r = await api(`/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' });
      $('#bk-msg').textContent = `${r.message}（安全備份：${r.safety_backup}）`;
      setTimeout(() => location.reload(), 9000);
    } catch (e) { $('#bk-msg').textContent = e.message; }
  });
}

/* ---------- 共用：日期時間輸入 ---------- */
// 後端儲存 'YYYY-MM-DD HH:MM'；datetime-local 用 'YYYY-MM-DDTHH:MM'
function toDtInput(v) { return (v || '').replace(' ', 'T').slice(0, 16); }
function fromDtInput(v) { return (v || '').replace('T', ' ').slice(0, 16); }
function nowDtInput() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function selectOptions(list, valKey, labelFn, selected) {
  return list.map(o => `<option value="${esc(o[valKey])}" ${String(o[valKey]) === String(selected) ? 'selected' : ''}>${esc(labelFn(o))}</option>`).join('');
}

/* ---------- 異常／不良事件 ---------- */
async function viewIncidents() {
  const isAdmin = currentUser.role === 'admin';
  const status = window._incStatus || '';
  const [incidents, babies, mothers] = await Promise.all([
    api('/incidents' + (status ? `?status=${status}` : '')), api('/babies'), api('/mothers')
  ]);
  const filterBtn = (val, label) => `<button class="btn small ${status === val ? '' : 'secondary'}" data-filter="${val}">${label}</button>`;
  main().innerHTML = `
    <div class="page-title">異常／不良事件通報</div>
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <button class="btn" id="inc-new">＋ 新增事件通報</button>
        <span style="flex:1"></span>
        ${filterBtn('', '全部')} ${filterBtn('open', '待處理')} ${filterBtn('processing', '處理中')} ${filterBtn('closed', '已結案')}
      </div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>發生時間</th><th>類別/嚴重度</th><th>對象/地點</th><th>事件與處置</th><th>通報</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>${incidents.map(i => `
          <tr>
            <td data-label="發生時間">${esc(i.occurred_at)}<br><small>${esc(i.reported_by_name || '')}</small></td>
            <td data-label="類別"><span class="badge ${SEVERITY_BADGE[i.severity] || 'gray'}">${INCIDENT_LABEL[i.category] || i.category}</span><br><small>${SEVERITY_LABEL[i.severity] || ''}</small></td>
            <td data-label="對象/地點">${esc(i.baby_name || i.mother_name || i.subject || '-')}<br><small>${esc(i.location || '')}</small></td>
            <td data-label="事件">${esc((i.description || '').slice(0, 40))}${(i.description || '').length > 40 ? '…' : ''}<br><small>處置：${esc((i.immediate_action || '').slice(0, 30))}</small></td>
            <td data-label="通報">${i.physician_notified ? '<span class="badge teal">醫師</span>' : ''}${i.family_notified ? '<span class="badge teal">家屬</span>' : ''}${i.reported_to_authority ? '<span class="badge teal">主管機關</span>' : ''}</td>
            <td data-label="狀態"><span class="badge ${INCIDENT_STATUS_BADGE[i.status]}">${INCIDENT_STATUS_LABEL[i.status]}</span></td>
            <td data-label="操作">
              <button class="btn small secondary" data-edit="${i.id}">檢視/編輯</button>
              ${isAdmin ? `<button class="btn small danger" data-del="${i.id}">刪除</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="7"><div class="empty">尚無事件紀錄</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  main().querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { window._incStatus = b.dataset.filter; viewIncidents(); });
  $('#inc-new').onclick = () => incidentForm(null, babies, mothers);
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => incidentForm(incidents.find(i => i.id == b.dataset.edit), babies, mothers));
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除此事件紀錄？')) return;
    await api(`/incidents/${b.dataset.del}`, { method: 'DELETE' }); viewIncidents();
  });
}

function incidentForm(i, babies, mothers) {
  i = i || {};
  const isNew = !i.id;
  openModal(isNew ? '新增事件通報' : '事件通報', `
    <div class="form-grid">
      <div class="field"><label>類別</label><select id="if-category">${Object.entries(INCIDENT_LABEL).map(([k, v]) => `<option value="${k}" ${i.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>嚴重度</label><select id="if-severity">${Object.entries(SEVERITY_LABEL).map(([k, v]) => `<option value="${k}" ${i.severity === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>發生時間</label><input type="datetime-local" id="if-occurred" value="${toDtInput(i.occurred_at) || nowDtInput()}"></div>
      <div class="field"><label>地點</label><input id="if-location" value="${esc(i.location || '')}" list="if-location-list">${dataList('if-location-list', 'incident_location_options')}</div>
      <div class="field"><label>相關寶寶（可選）</label><select id="if-baby"><option value="">無</option>${selectOptions(babies, 'id', b => `${b.name}（${b.mother_name}）`, i.baby_id)}</select></div>
      <div class="field"><label>相關媽媽（可選）</label><select id="if-mother"><option value="">無</option>${selectOptions(mothers, 'id', m => m.name, i.mother_id)}</select></div>
      <div class="field full"><label>對象描述（員工/訪客等，可選）</label><input id="if-subject" value="${esc(i.subject || '')}"></div>
      <div class="field full"><label>事件描述</label><textarea id="if-desc" rows="2">${esc(i.description || '')}</textarea></div>
      <div class="field full"><label>立即處置</label><textarea id="if-action" rows="2">${esc(i.immediate_action || '')}</textarea></div>
      <div class="field full"><label>原因分析</label><textarea id="if-cause" rows="2">${esc(i.cause_analysis || '')}</textarea></div>
      <div class="field full"><label>後續追蹤／改善措施</label><textarea id="if-follow" rows="2">${esc(i.follow_up || '')}</textarea></div>
      <div class="field full"><label>結果</label><input id="if-outcome" value="${esc(i.outcome || '')}"></div>
      <div class="field full row" style="gap:16px">
        <label><input type="checkbox" id="if-phy" ${i.physician_notified ? 'checked' : ''}> 已通知醫師</label>
        <label><input type="checkbox" id="if-fam" ${i.family_notified ? 'checked' : ''}> 已通知家屬</label>
        <label><input type="checkbox" id="if-auth" ${i.reported_to_authority ? 'checked' : ''}> 已通報主管機關</label>
      </div>
      <div class="field"><label>狀態</label><select id="if-status">${Object.entries(INCIDENT_STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${(i.status || 'open') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="full row"><button class="btn" id="if-save">儲存</button><span class="error-msg" id="if-err"></span></div>
    </div>`, body => {
    body.querySelector('#if-save').onclick = async () => {
      const payload = {
        category: body.querySelector('#if-category').value,
        severity: body.querySelector('#if-severity').value,
        occurred_at: fromDtInput(body.querySelector('#if-occurred').value),
        location: body.querySelector('#if-location').value.trim(),
        baby_id: body.querySelector('#if-baby').value || null,
        mother_id: body.querySelector('#if-mother').value || null,
        subject: body.querySelector('#if-subject').value.trim(),
        description: body.querySelector('#if-desc').value.trim(),
        immediate_action: body.querySelector('#if-action').value.trim(),
        cause_analysis: body.querySelector('#if-cause').value.trim(),
        follow_up: body.querySelector('#if-follow').value.trim(),
        outcome: body.querySelector('#if-outcome').value.trim(),
        physician_notified: body.querySelector('#if-phy').checked,
        family_notified: body.querySelector('#if-fam').checked,
        reported_to_authority: body.querySelector('#if-auth').checked,
        status: body.querySelector('#if-status').value
      };
      if (!payload.occurred_at) { body.querySelector('#if-err').textContent = '請填發生時間'; return; }
      try {
        if (isNew) await api('/incidents', { method: 'POST', body: payload });
        else await api(`/incidents/${i.id}`, { method: 'PUT', body: payload });
        closeModal(); viewIncidents();
      } catch (e) { body.querySelector('#if-err').textContent = e.message; }
    };
  });
}

/* ---------- 醫師巡診就醫紀錄 ---------- */
async function viewPhysicianVisits() {
  const isAdmin = currentUser.role === 'admin';
  const spec = window._pvSpec || '';
  const q = window._pvQuery || {};   // { start, end, kw, kwtype }
  const params = new URLSearchParams({ in_house: '1' });   // 僅顯示入住中
  if (spec) params.set('specialty', spec);
  if (q.start) params.set('start', q.start);
  if (q.end) params.set('end', q.end);
  if (q.kw) { params.set('kw', q.kw); params.set('kwtype', q.kwtype || 'name'); }
  const [visits, babies, mothers] = await Promise.all([
    api('/physician-visits?' + params.toString()), api('/babies'), api('/mothers')
  ]);
  const filterBtn = (val, label) => `<button class="btn small ${spec === val ? '' : 'secondary'}" data-filter="${val}">${label}</button>`;
  const som = todayStr().slice(0, 8) + '01';
  main().innerHTML = `
    <div class="page-title">醫師巡診就醫紀錄 <small style="font-weight:400;color:var(--muted);font-size:.85rem">（僅顯示入住中）</small></div>
    <div class="card">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:6px">
        ${canAccess('#/baby-doctor') ? '<a class="btn small" href="#/baby-doctor">兒科醫師診視（寶寶房況）</a>' : ''}
        ${canAccess('#/mother-doctor') ? '<a class="btn small" href="#/mother-doctor">產科醫師診視（媽媽房況）</a>' : ''}
      </div>
      <div class="form-grid" style="align-items:end">
        <div class="field"><label>查詢日期（起）</label><input type="date" id="pv-start" value="${esc(q.start || '')}" placeholder="${som}"></div>
        <div class="field"><label>查詢日期（迄）</label><input type="date" id="pv-end" value="${esc(q.end || '')}"></div>
        <div class="field"><label>關鍵字查詢</label><input id="pv-kw" value="${esc(q.kw || '')}" placeholder="輸入媽媽姓名或房號"></div>
        <div class="field"><label>查詢欄位</label>
          <div class="row" style="gap:14px;padding-top:6px">
            <label><input type="radio" name="pv-kwtype" value="room" ${q.kwtype === 'room' ? 'checked' : ''}> 媽媽房號</label>
            <label><input type="radio" name="pv-kwtype" value="name" ${q.kwtype !== 'room' ? 'checked' : ''}> 媽媽姓名</label>
          </div>
        </div>
        <div class="field"><label>&nbsp;</label>
          <div class="row" style="gap:6px"><button class="btn" id="pv-search">送出查詢</button><button class="btn secondary" id="pv-reset">清除</button></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <button class="btn" id="pv-new">＋ 新增巡診紀錄</button>
        <span style="flex:1"></span>
        ${filterBtn('', '全部')} ${filterBtn('pediatrics', '小兒科')} ${filterBtn('obgyn', '婦產科')} ${filterBtn('other', '其他')}
      </div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>巡診時間</th><th>科別/類型</th><th>對象</th><th>醫師</th><th>評估/處置</th><th>追蹤</th><th>操作</th></tr></thead>
        <tbody>${visits.map(v => {
    const detailHref = v.subject_type === 'baby'
      ? (canAccess('#/baby-doctor') ? `#/baby-doctor?b=${v.baby_id}` : '')
      : (canAccess('#/mother-doctor') ? `#/mother-doctor?m=${v.mother_id}` : '');
    return `
          <tr>
            <td data-label="巡診時間">${esc(v.visit_at)}<br><small>${esc(v.recorded_by_name || '')}</small></td>
            <td data-label="科別"><span class="badge teal">${VISIT_SPECIALTY_LABEL[v.specialty] || v.specialty}</span><br><small><span class="badge ${VISIT_TYPE_BADGE[v.visit_type] || 'gray'}">${VISIT_TYPE_LABEL[v.visit_type] || ''}</span></small></td>
            <td data-label="對象">${v.room_name ? `<span class="badge gray">${esc(v.room_name)}</span> ` : ''}${esc(v.baby_name || v.mother_name || '-')}<br><small>${v.subject_type === 'baby' ? `寶寶（${esc(v.mother_name || '')}）` : '媽媽'}</small></td>
            <td data-label="醫師">${esc(v.physician || '-')}</td>
            <td data-label="評估/處置">${esc((v.assessment || '').slice(0, 30))}${(v.assessment || '').length > 30 ? '…' : ''}<br><small>處置：${esc((v.plan || '').slice(0, 24))}</small></td>
            <td data-label="追蹤">${v.referral ? '<span class="badge red">轉診</span> ' : ''}${esc((v.follow_up || '').slice(0, 20))}</td>
            <td data-label="操作">
              <button class="btn small secondary" data-edit="${v.id}">檢視/編輯</button>
              ${detailHref ? `<a class="btn small secondary" href="${detailHref}">詳細診視</a>` : ''}
              ${isAdmin ? `<button class="btn small danger" data-del="${v.id}">刪除</button>` : ''}
            </td>
          </tr>`;
  }).join('') || '<tr><td colspan="7"><div class="empty">尚無符合條件的巡診紀錄</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  main().querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { window._pvSpec = b.dataset.filter; viewPhysicianVisits(); });
  const runSearch = () => {
    window._pvQuery = {
      start: $('#pv-start').value, end: $('#pv-end').value,
      kw: $('#pv-kw').value.trim(),
      kwtype: (main().querySelector('input[name="pv-kwtype"]:checked') || {}).value || 'name'
    };
    viewPhysicianVisits();
  };
  $('#pv-search').onclick = runSearch;
  $('#pv-kw').onkeydown = e => { if (e.key === 'Enter') runSearch(); };
  $('#pv-reset').onclick = () => { window._pvQuery = {}; viewPhysicianVisits(); };
  $('#pv-new').onclick = () => physicianVisitForm(null, babies, mothers);
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => physicianVisitForm(visits.find(v => v.id == b.dataset.edit), babies, mothers));
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除此巡診紀錄？')) return;
    await api(`/physician-visits/${b.dataset.del}`, { method: 'DELETE' }); viewPhysicianVisits();
  });
}

function physicianVisitForm(v, babies, mothers) {
  v = v || {};
  const isNew = !v.id;
  const subject = v.subject_type === 'mother' ? 'mother' : 'baby';
  const specialty = v.specialty || (subject === 'mother' ? 'obgyn' : 'pediatrics');
  openModal(isNew ? '新增巡診紀錄' : '醫師巡診紀錄', `
    <div class="form-grid">
      <div class="field"><label>巡診對象</label><select id="pv-subject">
        <option value="baby" ${subject === 'baby' ? 'selected' : ''}>寶寶（小兒科）</option>
        <option value="mother" ${subject === 'mother' ? 'selected' : ''}>媽媽（婦產科）</option>
      </select></div>
      <div class="field" id="pv-baby-wrap"><label>寶寶</label><select id="pv-baby"><option value="">請選擇</option>${selectOptions(babies, 'id', b => `${b.name}（${b.mother_name}）`, v.baby_id)}</select></div>
      <div class="field" id="pv-mother-wrap"><label>媽媽</label><select id="pv-mother"><option value="">請選擇</option>${selectOptions(mothers, 'id', m => m.name, v.mother_id)}</select></div>
      <div class="field"><label>科別</label><select id="pv-spec">${Object.entries(VISIT_SPECIALTY_LABEL).map(([k, l]) => `<option value="${k}" ${specialty === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>巡診類型</label><select id="pv-type">${Object.entries(VISIT_TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${(v.visit_type || 'routine') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>巡診時間</label><input type="datetime-local" id="pv-at" value="${toDtInput(v.visit_at) || nowDtInput()}"></div>
      <div class="field"><label>巡診醫師</label><input id="pv-physician" value="${esc(v.physician || '')}" list="pv-physician-list">${dataList('pv-physician-list', 'visit_physician_options')}</div>
      <div class="field full"><label>主訴／護理或家屬反映（S）</label><textarea id="pv-s" rows="2">${esc(v.subjective || '')}</textarea></div>
      <div class="field full"><label>理學檢查所見（O）</label><textarea id="pv-o" rows="2">${esc(v.objective || '')}</textarea></div>
      <div class="field full"><label>診斷／評估（A）</label><textarea id="pv-a" rows="2">${esc(v.assessment || '')}</textarea></div>
      <div class="field full"><label>處置／醫囑（P）</label><textarea id="pv-p" rows="2">${esc(v.plan || '')}</textarea></div>
      <div class="field full"><label>追蹤／回診安排</label><input id="pv-follow" value="${esc(v.follow_up || '')}"></div>
      <div class="field full"><label>轉診／建議就醫院所（填寫代表需轉診）</label><input id="pv-referral" value="${esc(v.referral || '')}"></div>
      <div class="full row"><button class="btn" id="pv-save">儲存</button><span class="error-msg" id="pv-err"></span></div>
    </div>`, body => {
    const syncSubject = () => {
      const s = body.querySelector('#pv-subject').value;
      body.querySelector('#pv-baby-wrap').style.display = s === 'baby' ? '' : 'none';
      body.querySelector('#pv-mother-wrap').style.display = s === 'mother' ? '' : 'none';
    };
    syncSubject();
    body.querySelector('#pv-subject').onchange = syncSubject;
    body.querySelector('#pv-save').onclick = async () => {
      const s = body.querySelector('#pv-subject').value;
      const payload = {
        subject_type: s,
        baby_id: s === 'baby' ? (body.querySelector('#pv-baby').value || null) : null,
        mother_id: s === 'mother' ? (body.querySelector('#pv-mother').value || null) : null,
        specialty: body.querySelector('#pv-spec').value,
        visit_type: body.querySelector('#pv-type').value,
        visit_at: fromDtInput(body.querySelector('#pv-at').value),
        physician: body.querySelector('#pv-physician').value.trim(),
        subjective: body.querySelector('#pv-s').value.trim(),
        objective: body.querySelector('#pv-o').value.trim(),
        assessment: body.querySelector('#pv-a').value.trim(),
        plan: body.querySelector('#pv-p').value.trim(),
        follow_up: body.querySelector('#pv-follow').value.trim(),
        referral: body.querySelector('#pv-referral').value.trim()
      };
      if (!payload.visit_at) { body.querySelector('#pv-err').textContent = '請填巡診時間'; return; }
      if (s === 'baby' && !payload.baby_id) { body.querySelector('#pv-err').textContent = '請選擇寶寶'; return; }
      if (s === 'mother' && !payload.mother_id) { body.querySelector('#pv-err').textContent = '請選擇媽媽'; return; }
      try {
        if (isNew) await api('/physician-visits', { method: 'POST', body: payload });
        else await api(`/physician-visits/${v.id}`, { method: 'PUT', body: payload });
        closeModal(); viewPhysicianVisits();
      } catch (e) { body.querySelector('#pv-err').textContent = e.message; }
    };
  });
}

/* ---------- 感染管制 ---------- */
async function viewInfection() {
  const isAdmin = currentUser.role === 'admin';
  const [hh, dis, clusters, users] = await Promise.all([
    api('/infection/hand-hygiene'), api('/infection/disinfection'), api('/infection/clusters'), api('/users')
  ]);
  const staff = users.filter(u => u.active);
  const hhRate = h => h.opportunities ? Math.round(h.compliant / h.opportunities * 1000) / 10 : 0;
  main().innerHTML = `
    <div class="page-title">感染管制</div>
    <div class="card">
      <h3>洗手稽核（手部衛生遵從率）</h3>
      <div class="form-grid">
        <div class="field"><label>稽核日期</label><input type="date" id="hh-date" value="${todayStr()}"></div>
        <div class="field"><label>區域</label><input id="hh-area" list="hh-area-list" placeholder="嬰兒室/護理站…">${dataList('hh-area-list', 'hh_area_options')}</div>
        <div class="field"><label>對象</label><input id="hh-role" list="hh-role-list" placeholder="護理師/清潔…">${dataList('hh-role-list', 'hh_role_options')}</div>
        <div class="field"><label>觀察時機數</label><input type="number" id="hh-opp" min="1" value="10"></div>
        <div class="field"><label>確實執行數</label><input type="number" id="hh-comp" min="0" value="10"></div>
        <div class="field full"><label>備註</label><input id="hh-note"></div>
        <div class="full row"><button class="btn" id="hh-add">新增稽核</button><span class="error-msg" id="hh-err"></span></div>
      </div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>日期</th><th>區域</th><th>對象</th><th>遵從率</th><th>稽核人</th><th>備註</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
        <tbody>${hh.map(h => `<tr>
          <td data-label="日期">${esc(h.audit_date)}</td><td data-label="區域">${esc(h.area)}</td>
          <td data-label="對象">${esc(h.observed_role)}</td>
          <td data-label="遵從率"><span class="badge ${hhRate(h) >= (parseFloat(SETTINGS.hand_hygiene_target) || 85) ? 'green' : 'red'}">${hhRate(h)}%</span> <small>(${h.compliant}/${h.opportunities})</small></td>
          <td data-label="稽核人">${esc(h.observer_name || '')}</td><td data-label="備註">${esc(h.note || '')}</td>
          ${isAdmin ? `<td><button class="btn small danger" data-del-hh="${h.id}">刪</button></td>` : ''}
        </tr>`).join('') || `<tr><td colspan="${isAdmin ? 7 : 6}"><div class="empty">尚無稽核紀錄</div></td></tr>`}</tbody>
      </table></div>
    </div>
    <div class="card">
      <h3>環境清潔消毒簽核</h3>
      <div class="form-grid">
        <div class="field"><label>日期</label><input type="date" id="dis-date" value="${todayStr()}"></div>
        <div class="field"><label>區域/設備</label><input id="dis-area" list="dis-area-list" placeholder="嬰兒室/保溫箱…">${dataList('dis-area-list', 'disinfect_area_options')}</div>
        <div class="field"><label>消毒方式</label><input id="dis-agent" list="dis-agent-list" placeholder="1:100漂白水…">${dataList('dis-agent-list', 'disinfect_agent_options')}</div>
        <div class="field"><label>覆核簽核人</label><select id="dis-verify"><option value="">無</option>${selectOptions(staff, 'id', u => u.name)}</select></div>
        <div class="field full"><label>備註</label><input id="dis-note"></div>
        <div class="full row"><button class="btn" id="dis-add">新增簽核</button><span class="error-msg" id="dis-err"></span></div>
      </div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>日期</th><th>區域/設備</th><th>消毒方式</th><th>執行人</th><th>覆核</th><th>備註</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
        <tbody>${dis.map(d => `<tr>
          <td data-label="日期">${esc(d.disinfect_date)}</td><td data-label="區域">${esc(d.area)}</td>
          <td data-label="方式">${esc(d.agent)}</td><td data-label="執行人">${esc(d.operator_name || '')}</td>
          <td data-label="覆核">${esc(d.verified_name || '-')}</td><td data-label="備註">${esc(d.note || '')}</td>
          ${isAdmin ? `<td><button class="btn small danger" data-del-dis="${d.id}">刪</button></td>` : ''}
        </tr>`).join('') || `<tr><td colspan="${isAdmin ? 7 : 6}"><div class="empty">尚無清消紀錄</div></td></tr>`}</tbody>
      </table></div>
    </div>
    <div class="card">
      <h3>群聚事件通報</h3>
      <div class="row" style="margin-bottom:10px"><button class="btn" id="cl-new">＋ 新增群聚事件</button></div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>起始日</th><th>病原</th><th>影響人數</th><th>防治措施</th><th>主管機關</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>${clusters.map(c => `<tr>
          <td data-label="起始日">${esc(c.onset_date)}</td><td data-label="病原">${esc(c.pathogen || '-')}</td>
          <td data-label="影響人數">${c.affected_count}</td><td data-label="措施">${esc((c.control_action || '').slice(0, 30))}</td>
          <td data-label="主管機關">${c.reported_to_authority ? `<span class="badge teal">已通報</span>` : '<span class="badge yellow">未通報</span>'}</td>
          <td data-label="狀態"><span class="badge ${c.status === 'closed' ? 'green' : c.status === 'monitoring' ? 'yellow' : 'red'}">${CLUSTER_STATUS_LABEL[c.status]}</span></td>
          <td data-label="操作"><button class="btn small secondary" data-edit-cl="${c.id}">編輯</button>${isAdmin ? `<button class="btn small danger" data-del-cl="${c.id}">刪</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="7"><div class="empty">尚無群聚事件</div></td></tr>'}</tbody>
      </table></div>
    </div>`;

  $('#hh-add').onclick = async () => {
    try {
      await api('/infection/hand-hygiene', { method: 'POST', body: {
        audit_date: $('#hh-date').value, area: $('#hh-area').value.trim(), observed_role: $('#hh-role').value.trim(),
        opportunities: $('#hh-opp').value, compliant: $('#hh-comp').value, note: $('#hh-note').value.trim()
      } }); viewInfection();
    } catch (e) { $('#hh-err').textContent = e.message; }
  };
  $('#dis-add').onclick = async () => {
    try {
      await api('/infection/disinfection', { method: 'POST', body: {
        disinfect_date: $('#dis-date').value, area: $('#dis-area').value.trim(), agent: $('#dis-agent').value.trim(),
        verified_by: $('#dis-verify').value || null, note: $('#dis-note').value.trim()
      } }); viewInfection();
    } catch (e) { $('#dis-err').textContent = e.message; }
  };
  $('#cl-new').onclick = () => clusterForm(null);
  main().querySelectorAll('[data-edit-cl]').forEach(b => b.onclick = () => clusterForm(clusters.find(c => c.id == b.dataset.editCl)));
  main().querySelectorAll('[data-del-hh]').forEach(b => b.onclick = async () => { if (confirm('刪除？')) { await api(`/infection/hand-hygiene/${b.dataset.delHh}`, { method: 'DELETE' }); viewInfection(); } });
  main().querySelectorAll('[data-del-dis]').forEach(b => b.onclick = async () => { if (confirm('刪除？')) { await api(`/infection/disinfection/${b.dataset.delDis}`, { method: 'DELETE' }); viewInfection(); } });
  main().querySelectorAll('[data-del-cl]').forEach(b => b.onclick = async () => { if (confirm('刪除？')) { await api(`/infection/clusters/${b.dataset.delCl}`, { method: 'DELETE' }); viewInfection(); } });
}

function clusterForm(c) {
  c = c || {};
  const isNew = !c.id;
  openModal(isNew ? '新增群聚事件' : '編輯群聚事件', `
    <div class="form-grid">
      <div class="field"><label>起始日</label><input type="date" id="cl-onset" value="${esc(c.onset_date || todayStr())}"></div>
      <div class="field"><label>病原/疾病</label><input id="cl-path" value="${esc(c.pathogen || '')}"></div>
      <div class="field"><label>影響人數</label><input type="number" id="cl-count" min="0" value="${c.affected_count || 0}"></div>
      <div class="field"><label>狀態</label><select id="cl-status">${Object.entries(CLUSTER_STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${(c.status || 'open') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field full"><label>影響對象描述</label><input id="cl-detail" value="${esc(c.affected_detail || '')}"></div>
      <div class="field full"><label>事件描述</label><textarea id="cl-desc" rows="2">${esc(c.description || '')}</textarea></div>
      <div class="field full"><label>防治措施</label><textarea id="cl-action" rows="2">${esc(c.control_action || '')}</textarea></div>
      <div class="field full"><label><input type="checkbox" id="cl-auth" ${c.reported_to_authority ? 'checked' : ''}> 已通報主管機關</label></div>
      <div class="field full"><label>備註</label><input id="cl-note" value="${esc(c.note || '')}"></div>
      <div class="full row"><button class="btn" id="cl-save">儲存</button><span class="error-msg" id="cl-err"></span></div>
    </div>`, body => {
    body.querySelector('#cl-save').onclick = async () => {
      const payload = {
        onset_date: body.querySelector('#cl-onset').value, pathogen: body.querySelector('#cl-path').value.trim(),
        affected_count: body.querySelector('#cl-count').value, affected_detail: body.querySelector('#cl-detail').value.trim(),
        description: body.querySelector('#cl-desc').value.trim(), control_action: body.querySelector('#cl-action').value.trim(),
        reported_to_authority: body.querySelector('#cl-auth').checked, status: body.querySelector('#cl-status').value,
        note: body.querySelector('#cl-note').value.trim()
      };
      try {
        if (isNew) await api('/infection/clusters', { method: 'POST', body: payload });
        else await api(`/infection/clusters/${c.id}`, { method: 'PUT', body: payload });
        closeModal(); viewInfection();
      } catch (e) { body.querySelector('#cl-err').textContent = e.message; }
    };
  });
}

// 另開視窗列印／另存 PDF：新生兒醫療紀錄單（給藥 MAR ＋ 疫苗 ＋ 篩檢 ＋ 光療）
function printMedicalSheet(d) {
  const center = (SETTINGS && SETTINGS.center_name) || 'MamaCare';
  const sec = (title, head, rows) => `
    <h3>${title}</h3>
    <table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${head.length}" style="text-align:center;color:#888">無紀錄</td></tr>`}</tbody></table>`;
  const mar = d.meds.map(m => `<tr><td>${esc(m.administered_at || m.scheduled_at || '')}</td><td>${esc(m.drug_name)} ${esc(m.dose || '')}</td><td>${esc(m.route || '')}</td><td>${esc(MED_STATUS_LABEL[m.status] || m.status)}</td><td>${esc(m.nurse_name || '')}</td></tr>`).join('');
  const vac = d.vaccinations.map(v => `<tr><td>${esc(VACCINE_LABEL[v.vaccine] || v.vaccine)} ${esc(v.dose_no || '')}</td><td>${esc(v.administered_at || '-')}</td><td>${esc(v.lot_no || '')} ${esc(v.site || '')}</td><td>${esc(VACC_STATUS_LABEL[v.status] || v.status)}</td></tr>`).join('');
  const scr = d.screenings.map(s => `<tr><td>${esc(SCREEN_LABEL[s.screen_type] || s.screen_type)}</td><td>${esc(s.screened_at || '-')}</td><td>${esc(SCREEN_RESULT_LABEL[s.result] || s.result)}</td><td>${esc(s.follow_up || '')}${s.follow_up_done ? '（已完成）' : ''}</td></tr>`).join('');
  const pho = (d.phototherapy || []).map(p => `<tr><td>${esc(p.start_at)}</td><td>${esc(p.end_at || '進行中')}</td><td>${p.bilirubin_before ?? '-'} → ${p.bilirubin_after ?? '-'}</td><td>${esc(p.device || '')}</td></tr>`).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">
    <title>新生兒醫療紀錄單 - ${esc(d.baby.name)}</title>
    <style>
      body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#1c2b29;line-height:1.5;max-width:800px;margin:24px auto;padding:0 24px}
      h1{font-size:20px;margin:0 0 2px;color:#b03060} .sub{color:#666;font-size:13px;margin-bottom:14px}
      h3{font-size:15px;margin:16px 0 6px;color:#9c2b58}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}
      th,td{border:1px solid #ccc;padding:5px 8px;text-align:left} th{background:#f2f7f6}
      @media print{.noprint{display:none}}
    </style></head><body>
    <h1>${esc(center)}　新生兒醫療紀錄單</h1>
    <div class="sub">${esc(d.baby.name)}　媽媽：${esc(d.baby.mother_name || '')}　列印：${esc(new Date().toLocaleString('zh-TW'))}</div>
    ${sec('給藥紀錄 (MAR)', ['時間', '藥品/劑量', '途徑', '狀態', '給藥者'], mar)}
    ${sec('疫苗接種', ['疫苗/劑次', '接種時間', '批號/部位', '狀態'], vac)}
    ${sec('新生兒篩檢', ['項目', '時間', '結果', '追蹤'], scr)}
    ${sec('光照治療', ['開始', '結束', '膽紅素(前→後)', '設備'], pho)}
    <div class="noprint" style="margin-top:20px;text-align:center"><button onclick="window.print()" style="padding:10px 24px;font-size:15px">列印 / 另存 PDF</button></div>
    </body></html>`);
  win.document.close();
}

/* ---------- 新生兒醫療紀錄 ---------- */
async function viewNewbornMedical() {
  const babies = await api('/babies');
  const inHouse = babies.filter(b => b.mother_status === 'checked_in');
  const list = inHouse.length ? inHouse : babies;
  const sel = window._nmBaby && list.find(b => b.id == window._nmBaby) ? window._nmBaby : (list[0] && list[0].id);
  main().innerHTML = `
    <div class="page-title">新生兒醫療紀錄</div>
    <div class="card">
      <div class="field"><label>選擇寶寶</label>
        <select id="nm-baby">${list.map(b => `<option value="${b.id}" ${b.id == sel ? 'selected' : ''}>${esc(b.name)}（${esc(b.mother_name)}）${b.mother_status === 'checked_in' ? '' : '・已退房'}</option>`).join('')}</select>
      </div>
    </div>
    <div id="nm-detail"></div>`;
  $('#nm-baby').onchange = () => { window._nmBaby = $('#nm-baby').value; renderNewbornMedical($('#nm-baby').value); };
  if (sel) renderNewbornMedical(sel);
  else $('#nm-detail').innerHTML = '<div class="card"><div class="empty">尚無寶寶資料</div></div>';
}

async function renderNewbornMedical(babyId) {
  const isAdmin = currentUser.role === 'admin';
  const d = await api(`/babies/${babyId}/medical`);
  const delBtn = (type, id) => isAdmin ? `<button class="btn small danger" data-del="${type}:${id}">刪</button>` : '';
  const marRows = d.meds.map(m => `<tr>
    <td data-label="時間">${esc(m.administered_at || m.scheduled_at || '')}</td>
    <td data-label="藥品">${esc(m.drug_name)} ${esc(m.dose || '')}<br><small>${esc(m.route || '')} ${esc(m.ordered_by ? '醫囑:' + m.ordered_by : '')}</small></td>
    <td data-label="狀態"><span class="badge ${MED_STATUS_BADGE[m.status]}">${MED_STATUS_LABEL[m.status]}</span></td>
    <td data-label="給藥者">${esc(m.nurse_name || '')}<br><small>${esc(m.note || '')}</small></td>
    <td>${delBtn('meds', m.id)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">無給藥紀錄</div></td></tr>';
  const vacRows = d.vaccinations.map(v => `<tr>
    <td data-label="疫苗">${VACCINE_LABEL[v.vaccine] || v.vaccine} ${esc(v.dose_no || '')}</td>
    <td data-label="接種時間">${esc(v.administered_at || '-')}<br><small>${esc(v.lot_no ? '批號:' + v.lot_no : '')} ${esc(v.site || '')}</small></td>
    <td data-label="狀態"><span class="badge ${VACC_STATUS_BADGE[v.status]}">${VACC_STATUS_LABEL[v.status]}</span></td>
    <td data-label="操作"><button class="btn small secondary" data-edit-vac="${v.id}">編輯</button> ${delBtn('vaccinations', v.id)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">無疫苗紀錄</div></td></tr>';
  const scrRows = d.screenings.map(s => `<tr>
    <td data-label="項目">${SCREEN_LABEL[s.screen_type] || s.screen_type}</td>
    <td data-label="時間">${esc(s.screened_at || '-')}</td>
    <td data-label="結果"><span class="badge ${SCREEN_RESULT_BADGE[s.result]}">${SCREEN_RESULT_LABEL[s.result]}</span></td>
    <td data-label="追蹤">${esc(s.follow_up || '')} ${s.follow_up_done ? '<span class="badge green">已完成</span>' : (s.result === 'refer' || s.result === 'abnormal' || s.result === 'pending' ? '<span class="badge red">待追蹤</span>' : '')}</td>
    <td data-label="操作"><button class="btn small secondary" data-edit-scr="${s.id}">編輯</button> ${delBtn('screenings', s.id)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">無篩檢紀錄</div></td></tr>';
  const phoRows = d.phototherapy.map(p => `<tr>
    <td data-label="開始">${esc(p.start_at)}</td><td data-label="結束">${esc(p.end_at || '進行中')}</td>
    <td data-label="膽紅素">${p.bilirubin_before != null ? p.bilirubin_before : '-'} → ${p.bilirubin_after != null ? p.bilirubin_after : '-'} mg/dL</td>
    <td data-label="設備">${esc(p.device || '')}<br><small>${esc(p.nurse_name || '')} ${esc(p.note || '')}</small></td>
    <td>${delBtn('phototherapy', p.id)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">無光照治療紀錄</div></td></tr>';
  $('#nm-detail').innerHTML = `
    <div class="row no-print" style="margin-bottom:8px"><button class="btn small secondary" id="nm-print">列印醫療紀錄單</button></div>
    <div class="card"><h3>給藥紀錄 MAR <button class="btn small" id="add-mar">＋ 給藥</button></h3>
      <div class="table-wrap"><table class="data stack"><thead><tr><th>時間</th><th>藥品/劑量</th><th>狀態</th><th>給藥者/備註</th><th></th></tr></thead><tbody>${marRows}</tbody></table></div></div>
    <div class="card"><h3>疫苗接種 <button class="btn small" id="add-vac">＋ 疫苗</button></h3>
      <div class="table-wrap"><table class="data stack"><thead><tr><th>疫苗/劑次</th><th>接種時間</th><th>狀態</th><th>操作</th></tr></thead><tbody>${vacRows}</tbody></table></div></div>
    <div class="card"><h3>新生兒篩檢追蹤 <button class="btn small" id="add-scr">＋ 篩檢</button></h3>
      <div class="table-wrap"><table class="data stack"><thead><tr><th>項目</th><th>篩檢時間</th><th>結果</th><th>追蹤</th><th>操作</th></tr></thead><tbody>${scrRows}</tbody></table></div></div>
    <div class="card"><h3>光照治療 <button class="btn small" id="add-pho">＋ 光照</button></h3>
      <div class="table-wrap"><table class="data stack"><thead><tr><th>開始</th><th>結束</th><th>膽紅素(前→後)</th><th>設備/備註</th><th></th></tr></thead><tbody>${phoRows}</tbody></table></div></div>`;

  $('#nm-print').onclick = () => printMedicalSheet(d);
  $('#add-mar').onclick = () => marForm(babyId);
  $('#add-vac').onclick = () => vaccForm(babyId, null);
  $('#add-scr').onclick = () => screenForm(babyId, null);
  $('#add-pho').onclick = () => phototherapyForm(babyId);
  $('#nm-detail').querySelectorAll('[data-edit-vac]').forEach(b => b.onclick = () => vaccForm(babyId, d.vaccinations.find(v => v.id == b.dataset.editVac)));
  $('#nm-detail').querySelectorAll('[data-edit-scr]').forEach(b => b.onclick = () => screenForm(babyId, d.screenings.find(s => s.id == b.dataset.editScr)));
  $('#nm-detail').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const [type, id] = b.dataset.del.split(':');
    if (!confirm('確定刪除此筆紀錄？')) return;
    await api(`/${type}/${id}`, { method: 'DELETE' }); renderNewbornMedical(babyId);
  });
}

function marForm(babyId, onSaved) {
  openModal('新增給藥紀錄', `
    <div class="form-grid">
      <div class="field full"><label>藥品名稱</label><input id="mar-drug" list="mar-drug-list">${dataList('mar-drug-list', 'med_drug_options')}</div>
      <div class="field"><label>劑量</label><input id="mar-dose" placeholder="400 IU"></div>
      <div class="field"><label>途徑</label><input id="mar-route" list="mar-route-list" placeholder="口服/IM…">${dataList('mar-route-list', 'med_route_options')}</div>
      <div class="field"><label>醫囑醫師</label><input id="mar-order"></div>
      <div class="field"><label>狀態</label><select id="mar-status">${Object.entries(MED_STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>排定時間</label><input type="datetime-local" id="mar-sched"></div>
      <div class="field"><label>實際給藥時間</label><input type="datetime-local" id="mar-admin" value="${nowDtInput()}"></div>
      <div class="field full"><label>備註</label><input id="mar-note"></div>
      <div class="full row"><button class="btn" id="mar-save">儲存</button><span class="error-msg" id="mar-err"></span></div>
    </div>`, body => {
    body.querySelector('#mar-save').onclick = async () => {
      const payload = {
        drug_name: body.querySelector('#mar-drug').value.trim(), dose: body.querySelector('#mar-dose').value.trim(),
        route: body.querySelector('#mar-route').value.trim(), ordered_by: body.querySelector('#mar-order').value.trim(),
        status: body.querySelector('#mar-status').value,
        scheduled_at: fromDtInput(body.querySelector('#mar-sched').value),
        administered_at: fromDtInput(body.querySelector('#mar-admin').value),
        note: body.querySelector('#mar-note').value.trim()
      };
      try { await api(`/babies/${babyId}/meds`, { method: 'POST', body: payload }); closeModal(); (onSaved || (() => renderNewbornMedical(babyId)))(); }
      catch (e) { body.querySelector('#mar-err').textContent = e.message; }
    };
  });
}

// 寶寶照護頁的「給藥紀錄」快捷視窗：沿用新生兒醫療分頁的 MAR，＋給藥儲存後自動關閉
async function openBabyMar(babyId, babyName) {
  const isAdmin = currentUser.role === 'admin';
  let d;
  try { d = await api(`/babies/${babyId}/medical`); }
  catch (e) { openModal('給藥紀錄 MAR', `<div class="error-msg">${esc(e.message)}</div>`); return; }
  const marRows = d.meds.map(m => `<tr>
    <td data-label="時間">${esc(m.administered_at || m.scheduled_at || '')}</td>
    <td data-label="藥品">${esc(m.drug_name)} ${esc(m.dose || '')}<br><small>${esc(m.route || '')} ${esc(m.ordered_by ? '醫囑:' + m.ordered_by : '')}</small></td>
    <td data-label="狀態"><span class="badge ${MED_STATUS_BADGE[m.status]}">${MED_STATUS_LABEL[m.status]}</span></td>
    <td data-label="給藥者">${esc(m.nurse_name || '')}<br><small>${esc(m.note || '')}</small></td>
    <td>${isAdmin ? `<button class="btn small danger" data-del-med="${m.id}">刪</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="5"><div class="empty">無給藥紀錄</div></td></tr>';
  openModal(`給藥紀錄 MAR　${esc(babyName || '')}`, `
    <div class="row" style="margin-bottom:8px"><button class="btn small" id="bmar-add">＋ 給藥</button></div>
    <div class="table-wrap"><table class="data stack"><thead><tr><th>時間</th><th>藥品/劑量</th><th>狀態</th><th>給藥者/備註</th><th></th></tr></thead><tbody>${marRows}</tbody></table></div>`,
  body => {
    body.querySelector('#bmar-add').onclick = () => marForm(babyId, () => closeModal());  // 儲存後自動關閉
    body.querySelectorAll('[data-del-med]').forEach(b => b.onclick = async () => {
      if (!confirm('確定刪除此筆給藥紀錄？')) return;
      await api(`/meds/${b.dataset.delMed}`, { method: 'DELETE' }); openBabyMar(babyId, babyName);
    });
  });
}

function vaccForm(babyId, v) {
  v = v || {};
  openModal(v.id ? '編輯疫苗紀錄' : '新增疫苗紀錄', `
    <div class="form-grid">
      <div class="field"><label>疫苗</label><select id="vac-vaccine">${Object.entries(VACCINE_LABEL).map(([k, lbl]) => `<option value="${k}" ${v.vaccine === k ? 'selected' : ''}>${lbl}</option>`).join('')}</select></div>
      <div class="field"><label>劑次</label><input id="vac-dose" value="${esc(v.dose_no || '')}" placeholder="第1劑"></div>
      <div class="field"><label>狀態</label><select id="vac-status">${Object.entries(VACC_STATUS_LABEL).map(([k, lbl]) => `<option value="${k}" ${(v.status || 'done') === k ? 'selected' : ''}>${lbl}</option>`).join('')}</select></div>
      <div class="field"><label>接種時間</label><input type="datetime-local" id="vac-admin" value="${toDtInput(v.administered_at)}"></div>
      <div class="field"><label>批號</label><input id="vac-lot" value="${esc(v.lot_no || '')}"></div>
      <div class="field"><label>部位</label><input id="vac-site" value="${esc(v.site || '')}" list="vac-site-list" placeholder="右大腿">${dataList('vac-site-list', 'vaccine_site_options')}</div>
      <div class="field full"><label>備註</label><input id="vac-note" value="${esc(v.note || '')}"></div>
      <div class="full row"><button class="btn" id="vac-save">儲存</button><span class="error-msg" id="vac-err"></span></div>
    </div>`, body => {
    body.querySelector('#vac-save').onclick = async () => {
      const payload = {
        vaccine: body.querySelector('#vac-vaccine').value, dose_no: body.querySelector('#vac-dose').value.trim(),
        status: body.querySelector('#vac-status').value, administered_at: fromDtInput(body.querySelector('#vac-admin').value),
        lot_no: body.querySelector('#vac-lot').value.trim(), site: body.querySelector('#vac-site').value.trim(),
        note: body.querySelector('#vac-note').value.trim()
      };
      try {
        if (v.id) await api(`/vaccinations/${v.id}`, { method: 'PUT', body: payload });
        else await api(`/babies/${babyId}/vaccinations`, { method: 'POST', body: payload });
        closeModal(); renderNewbornMedical(babyId);
      } catch (e) { body.querySelector('#vac-err').textContent = e.message; }
    };
  });
}

function screenForm(babyId, s) {
  s = s || {};
  openModal(s.id ? '編輯篩檢紀錄' : '新增篩檢紀錄', `
    <div class="form-grid">
      <div class="field"><label>篩檢項目</label><select id="scr-type">${Object.entries(SCREEN_LABEL).map(([k, lbl]) => `<option value="${k}" ${s.screen_type === k ? 'selected' : ''}>${lbl}</option>`).join('')}</select></div>
      <div class="field"><label>結果</label><select id="scr-result">${Object.entries(SCREEN_RESULT_LABEL).map(([k, lbl]) => `<option value="${k}" ${(s.result || 'pending') === k ? 'selected' : ''}>${lbl}</option>`).join('')}</select></div>
      <div class="field"><label>篩檢時間</label><input type="datetime-local" id="scr-at" value="${toDtInput(s.screened_at)}"></div>
      <div class="field"><label><input type="checkbox" id="scr-done" ${s.follow_up_done ? 'checked' : ''}> 追蹤已完成</label></div>
      <div class="field full"><label>複篩／轉介追蹤</label><input id="scr-follow" value="${esc(s.follow_up || '')}"></div>
      <div class="field full"><label>備註</label><input id="scr-note" value="${esc(s.note || '')}"></div>
      <div class="full row"><button class="btn" id="scr-save">儲存</button><span class="error-msg" id="scr-err"></span></div>
    </div>`, body => {
    body.querySelector('#scr-save').onclick = async () => {
      const payload = {
        screen_type: body.querySelector('#scr-type').value, result: body.querySelector('#scr-result').value,
        screened_at: fromDtInput(body.querySelector('#scr-at').value), follow_up: body.querySelector('#scr-follow').value.trim(),
        follow_up_done: body.querySelector('#scr-done').checked, note: body.querySelector('#scr-note').value.trim()
      };
      try {
        if (s.id) await api(`/screenings/${s.id}`, { method: 'PUT', body: payload });
        else await api(`/babies/${babyId}/screenings`, { method: 'POST', body: payload });
        closeModal(); renderNewbornMedical(babyId);
      } catch (e) { body.querySelector('#scr-err').textContent = e.message; }
    };
  });
}

function phototherapyForm(babyId) {
  openModal('新增光照治療紀錄', `
    <div class="form-grid">
      <div class="field"><label>開始時間</label><input type="datetime-local" id="pho-start" value="${nowDtInput()}"></div>
      <div class="field"><label>結束時間</label><input type="datetime-local" id="pho-end"></div>
      <div class="field"><label>治療前膽紅素</label><input type="number" step="0.1" id="pho-before"></div>
      <div class="field"><label>治療後膽紅素</label><input type="number" step="0.1" id="pho-after"></div>
      <div class="field full"><label>設備</label><input id="pho-device" placeholder="單面/雙面藍光燈"></div>
      <div class="field full"><label>備註</label><input id="pho-note"></div>
      <div class="full row"><button class="btn" id="pho-save">儲存</button><span class="error-msg" id="pho-err"></span></div>
    </div>`, body => {
    body.querySelector('#pho-save').onclick = async () => {
      const payload = {
        start_at: fromDtInput(body.querySelector('#pho-start').value), end_at: fromDtInput(body.querySelector('#pho-end').value),
        bilirubin_before: body.querySelector('#pho-before').value, bilirubin_after: body.querySelector('#pho-after').value,
        device: body.querySelector('#pho-device').value.trim(), note: body.querySelector('#pho-note').value.trim()
      };
      if (!payload.start_at) { body.querySelector('#pho-err').textContent = '請填開始時間'; return; }
      try { await api(`/babies/${babyId}/phototherapy`, { method: 'POST', body: payload }); closeModal(); renderNewbornMedical(babyId); }
      catch (e) { body.querySelector('#pho-err').textContent = e.message; }
    };
  });
}

/* ---------- 電子發票／收據 ---------- */
async function viewInvoices() {
  const isAdmin = currentUser.role === 'admin';
  const [invoices, bookings] = await Promise.all([api('/invoices'), api('/bookings')]);
  main().innerHTML = `
    <div class="page-title">電子發票／收據</div>
    <div class="card">
      <p class="sig-hint" style="color:#6b7c79">收據可直接開立列印存證。欲上傳財政部電子發票大平台（MIG 3.2），請先於「系統設定」填入加值中心業者與 API 資訊。</p>
      <div class="row"><button class="btn" id="inv-new">＋ 開立發票／收據</button></div>
    </div>
    <div class="card">
      ${filterBar({ placeholder: '搜尋買受人 / 號碼…', statuses: [{ val: '', label: '全部' }, { val: 'issued', label: '已開立' }, { val: 'allowance', label: '已折讓' }, { val: 'void', label: '已作廢' }] })}
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>日期</th><th>類型/號碼</th><th>買受人</th><th>金額</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>${invoices.map(i => `<tr data-filter="${esc((i.mother_name || i.buyer_name || '') + ' ' + (i.invoice_number || '') + ' ' + (i.note || ''))}" data-status="${i.status}">
          <td data-label="日期">${esc(i.invoice_date)}<br><small>${esc(i.created_by_name || '')}</small></td>
          <td data-label="類型">${DOC_TYPE_LABEL[i.doc_type]}<br><small>${esc(i.invoice_number || '—')}</small></td>
          <td data-label="買受人">${esc(i.mother_name || i.buyer_name || '-')}${i.buyer_tax_id ? `<br><small>統編 ${esc(i.buyer_tax_id)}</small>` : ''}</td>
          <td data-label="金額">${fmtMoney(i.total_amount)}${i.allowance_amount ? `<br><small style="color:var(--danger)">折讓 ${fmtMoney(i.allowance_amount)}</small>` : ''}</td>
          <td data-label="狀態"><span class="badge ${INVOICE_STATUS_BADGE[i.status]}">${INVOICE_STATUS_LABEL[i.status]}</span>${i.upload_status === 'uploaded' ? '<br><small class="badge teal">已上傳</small>' : ''}</td>
          <td data-label="操作">
            <button class="btn small secondary" data-print="${i.id}">列印</button>
            ${i.status === 'issued' ? `<button class="btn small secondary" data-allow="${i.id}">折讓</button>` : ''}
            ${isAdmin && i.status !== 'void' ? `<button class="btn small secondary" data-upload="${i.id}">上傳</button>` : ''}
            ${isAdmin && i.status !== 'void' ? `<button class="btn small danger" data-void="${i.id}">作廢</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="6"><div class="empty">尚無發票／收據</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  wireFilter(main());
  $('#inv-new').onclick = () => invoiceForm(bookings);
  main().querySelectorAll('[data-print]').forEach(b => b.onclick = async () => printInvoice(await api(`/invoices/${b.dataset.print}`)));
  main().querySelectorAll('[data-allow]').forEach(b => b.onclick = async () => {
    const amount = prompt('請輸入折讓金額：'); if (!amount) return;
    try { await api(`/invoices/${b.dataset.allow}/allowance`, { method: 'POST', body: { amount } }); viewInvoices(); }
    catch (e) { alert(e.message); }
  });
  main().querySelectorAll('[data-upload]').forEach(b => b.onclick = async () => {
    try { const r = await api(`/invoices/${b.dataset.upload}/upload`, { method: 'POST' }); alert('已上傳 ' + (r.provider || '')); viewInvoices(); }
    catch (e) { alert(e.message); }
  });
  main().querySelectorAll('[data-void]').forEach(b => b.onclick = async () => {
    const reason = prompt('作廢原因（可留空）：', ''); if (reason === null) return;
    await api(`/invoices/${b.dataset.void}/void`, { method: 'POST', body: { reason } }); viewInvoices();
  });
}

function invoiceForm(bookings, prefill = {}) {
  let items = (prefill.items && prefill.items.length) ? prefill.items.map(it => ({ ...it })) : [{ name: '', qty: 1, price: 0 }];
  const rowHtml = (it, idx) => `<div class="row" data-item-row="${idx}" style="gap:6px;margin-bottom:6px">
    <input placeholder="品項名稱" data-it-name value="${esc(it.name)}" style="flex:2">
    <input type="number" placeholder="數量" data-it-qty value="${it.qty}" style="width:70px" min="1">
    <input type="number" placeholder="單價" data-it-price value="${it.price}" style="width:100px" min="0">
    <button class="btn small danger" data-it-del="${idx}" type="button">×</button></div>`;
  openModal('開立發票／收據', `
    <div class="form-grid">
      <div class="field"><label>類型</label><select id="iv-type"><option value="receipt">收據</option><option value="invoice">電子發票</option></select></div>
      <div class="field"><label>稅別</label><select id="iv-tax"><option value="3">免稅</option><option value="1">應稅</option><option value="2">零稅率</option></select></div>
      <div class="field"><label>日期</label><input type="date" id="iv-date" value="${todayStr()}"></div>
      <div class="field"><label>關聯訂房（可選）</label><select id="iv-booking"><option value="">無</option>${bookings.map(b => `<option value="${b.id}" ${String(b.id) === String(prefill.booking_id) ? 'selected' : ''}>${esc(b.mother_name)}　${esc(b.room_name)}房</option>`).join('')}</select></div>
      <div class="field"><label>買受人</label><input id="iv-buyer" value="${esc(prefill.buyer_name || '')}"></div>
      <div class="field"><label>統一編號（B2B，可選）</label><input id="iv-taxid" maxlength="8"></div>
      <div class="field full"><label>品項</label><div id="iv-items">${items.map(rowHtml).join('')}</div>
        <button class="btn small secondary" id="iv-additem" type="button">＋ 新增品項</button></div>
      <div class="field full"><label>備註</label><input id="iv-note"></div>
      <div class="full" style="text-align:right;font-weight:700">合計：<span id="iv-total">NT$ 0</span></div>
      <div class="full row"><button class="btn" id="iv-save">開立</button><span class="error-msg" id="iv-err"></span></div>
    </div>`, body => {
    const render = () => {
      body.querySelector('#iv-items').innerHTML = items.map(rowHtml).join('');
      bind();
      recalc();
    };
    const recalc = () => {
      const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
      body.querySelector('#iv-total').textContent = fmtMoney(total);
    };
    const sync = () => {
      body.querySelectorAll('[data-item-row]').forEach(row => {
        const idx = Number(row.dataset.itemRow);
        items[idx] = {
          name: row.querySelector('[data-it-name]').value,
          qty: row.querySelector('[data-it-qty]').value,
          price: row.querySelector('[data-it-price]').value
        };
      });
    };
    const bind = () => {
      body.querySelectorAll('[data-item-row] input').forEach(inp => inp.oninput = () => { sync(); recalc(); });
      body.querySelectorAll('[data-it-del]').forEach(b => b.onclick = () => { sync(); items.splice(Number(b.dataset.itDel), 1); if (!items.length) items.push({ name: '', qty: 1, price: 0 }); render(); });
    };
    bind(); recalc();
    body.querySelector('#iv-additem').onclick = () => { sync(); items.push({ name: '', qty: 1, price: 0 }); render(); };
    body.querySelector('#iv-save').onclick = async () => {
      sync();
      const payload = {
        doc_type: body.querySelector('#iv-type').value, tax_type: body.querySelector('#iv-tax').value,
        invoice_date: body.querySelector('#iv-date').value, booking_id: body.querySelector('#iv-booking').value || null,
        buyer_name: body.querySelector('#iv-buyer').value.trim(), buyer_tax_id: body.querySelector('#iv-taxid').value.trim(),
        items: items.filter(it => it.name && Number(it.qty) > 0), note: body.querySelector('#iv-note').value.trim()
      };
      try { await api('/invoices', { method: 'POST', body: payload }); closeModal(); viewInvoices(); }
      catch (e) { body.querySelector('#iv-err').textContent = e.message; }
    };
  });
}

function printInvoice(i) {
  const center = (SETTINGS && SETTINGS.einvoice_seller_name) || SETTINGS.center_name || 'MamaCare';
  const itemRows = (i.items || []).map(it => `<tr><td>${esc(it.name)}</td><td style="text-align:right">${it.qty}</td><td style="text-align:right">${fmtMoney(it.price)}</td><td style="text-align:right">${fmtMoney(it.amount)}</td></tr>`).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>${DOC_TYPE_LABEL[i.doc_type]}</title>
    <style>body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#1c2b29;max-width:560px;margin:24px auto;padding:0 20px}
    h2{text-align:center;margin:0} .meta{font-size:13px;margin:14px 0;color:#444}
    table{border-collapse:collapse;width:100%;font-size:13px;margin-top:10px}
    th,td{border:1px solid #bbb;padding:6px 8px} th{background:#eef5f4}
    .totals{margin-top:12px;text-align:right;font-size:14px} .void{color:#c00;font-weight:700;text-align:center;font-size:20px;border:3px solid #c00;padding:6px;margin:10px 0}
    @media print{.noprint{display:none}}</style></head><body>
    <h2>${esc(center)}</h2>
    <div style="text-align:center">${DOC_TYPE_LABEL[i.doc_type]}${i.invoice_number ? '　' + esc(i.invoice_number) : ''}</div>
    ${i.status === 'void' ? '<div class="void">作　廢</div>' : ''}
    <div class="meta">日期：${esc(i.invoice_date)} ${esc(i.invoice_time || '')}<br>
      買受人：${esc(i.mother_name || i.buyer_name || '-')}${i.buyer_tax_id ? '　統一編號：' + esc(i.buyer_tax_id) : ''}</div>
    <table><thead><tr><th>品項</th><th>數量</th><th>單價</th><th>小計</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div class="totals">銷售額：${fmtMoney(i.sales_amount)}<br>稅額：${fmtMoney(i.tax_amount)}<br>
      <strong>總計：${fmtMoney(i.total_amount)}</strong>${i.allowance_amount ? `<br>折讓：${fmtMoney(i.allowance_amount)}` : ''}</div>
    ${i.note ? `<div class="meta">備註：${esc(i.note)}</div>` : ''}
    <div class="noprint" style="margin-top:20px;text-align:center"><button onclick="window.print()" style="padding:10px 24px">列印 / 另存 PDF</button></div>
    </body></html>`);
  win.document.close();
}

/* ---------- 稽核軌跡 ---------- */
async function viewAuditLogs() {
  const q = window._auditQ || '';
  const logs = await api('/audit-logs' + (q ? `?q=${encodeURIComponent(q)}` : ''));
  main().innerHTML = `
    <div class="page-title">稽核軌跡</div>
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <input id="al-q" placeholder="搜尋操作者 / 動作 / 對象 / 摘要" value="${esc(q)}" style="flex:1">
        <button class="btn" id="al-search">搜尋</button>
      </div>
      <p class="sig-hint" style="color:#6b7c79">顯示最近 ${logs.length} 筆（最多 1000 筆）。完整稽核軌跡可於「資料匯出」下載。</p>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>時間</th><th>操作者</th><th>動作</th><th>對象</th><th>摘要</th><th>IP</th></tr></thead>
        <tbody>${logs.map(l => `<tr>
          <td data-label="時間">${esc(l.created_at)}</td>
          <td data-label="操作者">${esc(l.user_name || '-')}<br><small>${esc(l.role || '')}</small></td>
          <td data-label="動作"><span class="badge ${l.action === 'delete' || l.action === 'void' ? 'red' : l.action === 'create' ? 'green' : 'gray'}">${esc(l.action)}</span></td>
          <td data-label="對象">${esc(l.entity || '')}${l.entity_id ? ' #' + esc(l.entity_id) : ''}</td>
          <td data-label="摘要"><small>${esc((l.summary || '').slice(0, 80))}</small></td>
          <td data-label="IP">${esc(l.ip || '')}</td>
        </tr>`).join('') || '<tr><td colspan="6"><div class="empty">尚無紀錄</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  $('#al-search').onclick = () => { window._auditQ = $('#al-q').value.trim(); viewAuditLogs(); };
  $('#al-q').onkeydown = e => { if (e.key === 'Enter') { window._auditQ = $('#al-q').value.trim(); viewAuditLogs(); } };
}

/* ---------- 商城（商品與訂單） ---------- */
async function viewShop() {
  const isAdmin = currentUser.role === 'admin';
  const [products, orders] = await Promise.all([api('/products'), api('/orders?status=pending')]);
  const orderRows = orders.length ? orders.map(o => `
    <tr data-filter="${esc((o.mother_name || '') + ' ' + (o.family_name || '') + ' ' + (o.staff_name || '') + ' ' + o.items.map(i => i.item_name).join(' '))}">
      <td data-label="時間"><small>${esc((o.created_at || '').slice(5, 16))}</small></td>
      <td data-label="來源">${o.placed_by === 'family'
        ? `<span class="badge">家屬</span> ${esc(o.family_name || '')}`
        : `<span class="badge gray">代客</span> ${esc(o.staff_name || '')}`}</td>
      <td data-label="媽媽">${esc(o.mother_name || '-')}${o.booking_id ? '' : '<br><small style="color:var(--danger)">無進行中訂房</small>'}</td>
      <td data-label="品項">${o.items.map(i => `${esc(i.item_name)}×${i.quantity}`).join('、')}${o.note ? `<br><small>備註：${esc(o.note)}</small>` : ''}</td>
      <td data-label="金額">${fmtMoney(o.total_amount)}</td>
      <td data-label="操作">
        <button class="btn small" data-confirm="${o.id}">確認入帳</button>
        <button class="btn small danger" data-cancel="${o.id}">取消</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty">目前沒有待處理訂單</div></td></tr>';

  const prodCards = products.length ? products.map(p => `
    <div class="prod-card${p.active ? '' : ' off'}">
      <div class="prod-img">${p.image
        ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">`
        : '<div class="ph">無圖片</div>'}${p.active ? '' : '<span class="prod-off">已下架</span>'}</div>
      <div class="prod-body">
        <div class="prod-name">${esc(p.name)}</div>
        <div class="prod-meta">${p.category ? `<span class="badge gray">${esc(p.category)}</span> ` : ''}${fmtMoney(p.price)}</div>
        <div class="prod-meta"><small>${p.track_stock ? `庫存 ${p.stock}` : '不管控庫存'}</small></div>
        ${isAdmin ? `<div class="row" style="margin-top:6px">
          <button class="btn small secondary" data-edit="${p.id}">編輯</button>
          <button class="btn small ${p.active ? 'secondary' : ''}" data-toggle="${p.id}">${p.active ? '下架' : '上架'}</button>
        </div>` : ''}
      </div>
    </div>`).join('') : '<div class="empty">尚未建立商品</div>';

  main().innerHTML = `
    <div class="page-title">商城</div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="color:var(--primary-dark);font-size:1rem;margin:0">待處理訂單 <span class="badge ${orders.length ? 'red' : 'green'}">${orders.length}</span></h3>
        <button class="btn small" id="shop-neworder">代客下單</button>
      </div>
      ${orders.length ? filterBar({ placeholder: '搜尋媽媽 / 家屬 / 品項…' }) : ''}
      <div class="table-wrap" style="margin-top:8px">
        <table class="data stack">
          <thead><tr><th>時間</th><th>來源</th><th>媽媽</th><th>品項</th><th>金額</th><th></th></tr></thead>
          <tbody>${orderRows}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="color:var(--primary-dark);font-size:1rem;margin:0">商品管理</h3>
        ${isAdmin ? '<div class="row" style="gap:8px"><button class="btn small" id="shop-newprod">新增商品</button><button class="btn small secondary" id="shop-import">匯入 CSV</button></div>' : ''}
      </div>
      <input class="prod-search" placeholder="搜尋商品名稱 / 分類…" style="width:100%;margin-top:10px;padding:8px 12px;border:1px solid var(--border);border-radius:8px">
      <div class="prod-grid" style="margin-top:10px">${prodCards}</div>
    </div>`;
  wireFilter(main());
  { // 商品卡片即時搜尋
    const ps = main().querySelector('.prod-search');
    const cards = [...main().querySelectorAll('.prod-grid .prod-card')];
    if (ps) ps.oninput = () => {
      const q = ps.value.trim().toLowerCase();
      cards.forEach((card, i) => {
        const p = products[i];
        card.style.display = (!q || (p.name + ' ' + (p.category || '')).toLowerCase().includes(q)) ? '' : 'none';
      });
    };
  }

  main().querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
    if (!confirm('確認此訂單？將扣庫存並寫入該媽媽訂房的加購帳。')) return;
    try { const r = await api(`/orders/${b.dataset.confirm}/confirm`, { method: 'POST' });
      if (!r.charged) alert('已確認，但此媽媽無進行中訂房，未自動入帳，請至收費帳務手動處理。');
      viewShop();
    } catch (e) { alert(e.message); }
  });
  main().querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
    if (!confirm('確定取消此訂單？')) return;
    try { await api(`/orders/${b.dataset.cancel}/cancel`, { method: 'POST' }); viewShop(); }
    catch (e) { alert(e.message); }
  });
  if (isAdmin) {
    main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
      openProductForm(products.find(p => p.id == b.dataset.edit), distinctCats(products)));
    main().querySelector('#shop-newprod').onclick = () => openProductForm(null, distinctCats(products));
    main().querySelector('#shop-import').onclick = () => productImportModal();
    main().querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      const p = products.find(x => x.id == b.dataset.toggle);
      try { await api(`/products/${p.id}`, { method: 'PUT', body: { active: p.active ? 0 : 1 } }); viewShop(); }
      catch (e) { alert(e.message); }
    });
  }
  main().querySelector('#shop-neworder').onclick = () => openStaffOrderForm(products.filter(p => p.active));
}

function productImportModal() {
  const MAP = { name: ['商品名稱', '品名', '名稱', 'name'], category: ['分類', '商品分類', 'category'],
    price: ['售價', '價格', 'price'], cost: ['成本', 'cost'], stock: ['庫存', 'stock'],
    track_stock: ['管控庫存', 'track_stock'], active: ['上架', '啟用', 'active'], description: ['描述', '說明', 'description'] };
  openModal('匯入商城商品 CSV', `
    <div class="field"><label>選擇 CSV 檔</label><input type="file" id="pi-file" accept=".csv,text/csv"></div>
    <div class="field"><label>或直接貼上 CSV 內容</label><textarea id="pi-text" rows="6" placeholder="商品名稱,分類,售價,成本,庫存,管控庫存,上架,描述"></textarea></div>
    <small style="color:var(--muted)">＊第一列為標題，以商品名稱為鍵：已存在則更新、否則新增。管控庫存／上架填 yes／是／1 代表開啟。</small>
    <div class="row mt"><button class="btn" id="pi-go">匯入</button><span class="error-msg" id="pi-err"></span></div>`, body => {
    body.querySelector('#pi-file').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = () => { body.querySelector('#pi-text').value = r.result; }; r.readAsText(f, 'utf-8');
    };
    body.querySelector('#pi-go').onclick = async () => {
      const rows = parseCsv(body.querySelector('#pi-text').value);
      if (rows.length < 2) { body.querySelector('#pi-err').textContent = '請提供含標題列的 CSV'; return; }
      const header = rows[0].map(h => h.trim());
      const idx = {}; for (const k in MAP) idx[k] = header.findIndex(h => MAP[k].includes(h));
      if (idx.name < 0) { body.querySelector('#pi-err').textContent = '找不到「商品名稱」欄'; return; }
      const items = rows.slice(1).map(r => { const o = {}; for (const k in idx) if (idx[k] >= 0) o[k] = (r[idx[k]] || '').trim(); return o; }).filter(o => o.name);
      if (!items.length) { body.querySelector('#pi-err').textContent = '沒有可匯入的商品'; return; }
      try {
        const res = await api('/products/import', { method: 'POST', body: { items } });
        alert(`匯入完成：新增 ${res.added}、更新 ${res.updated}、略過 ${res.skipped}`
          + (res.duplicates && res.duplicates.length ? `\n注意：檔案中有重複鍵（以最後一筆為準）：${res.duplicates.join('、')}` : ''));
        closeModal(); viewShop();
      } catch (e) { body.querySelector('#pi-err').textContent = e.message; }
    };
  });
}
function openProductForm(p, cats) {
  const ed = p || {};
  openModal(ed.id ? '編輯商品' : '新增商品', `
    <div class="form-grid">
      <div class="field full"><label>品名 *</label><input id="pf-name" value="${esc(ed.name || '')}"></div>
      <div class="field"><label>分類</label><input id="pf-cat" value="${esc(ed.category || '')}" list="pf-cat-list" placeholder="例如：媽媽用品">${dataListValues('pf-cat-list', cats)}</div>
      <div class="field"><label>售價 *</label><input type="number" id="pf-price" min="0" value="${ed.price ?? ''}"></div>
      <div class="field"><label>成本</label><input type="number" id="pf-cost" min="0" value="${ed.cost ?? 0}"></div>
      <div class="field"><label>排序</label><input type="number" id="pf-sort" value="${ed.sort ?? 0}"></div>
      <div class="field"><label><input type="checkbox" id="pf-track" ${ed.track_stock ? 'checked' : ''}> 管控庫存</label>
        <input type="number" id="pf-stock" min="0" value="${ed.stock ?? 0}" placeholder="庫存數量"></div>
      <div class="field"><label><input type="checkbox" id="pf-active" ${ed.active === 0 ? '' : 'checked'}> 上架（顯示於家屬商城）</label></div>
      <div class="field full"><label>商品說明</label><textarea id="pf-desc" rows="2">${esc(ed.description || '')}</textarea></div>
      <div class="field full"><label>商品圖片</label>
        <div class="row" style="align-items:center">
          <div class="prod-img sm" id="pf-imgprev">${ed.image ? `<img src="${esc(ed.image)}">` : '<div class="ph">無</div>'}</div>
          <input type="file" id="pf-img" accept="image/*">
        </div>
        <small style="color:var(--muted)">${ed.id ? '選擇檔案後即時上傳' : '請先儲存商品，再回來上傳圖片'}</small>
      </div>
      <div class="full row">
        <button class="btn" id="pf-save">儲存</button>
        ${ed.id ? '<button class="btn danger" id="pf-del">刪除</button>' : ''}
        <span class="error-msg" id="pf-err"></span>
      </div>
    </div>`, body => {
    const val = id => body.querySelector(id);
    if (ed.id) {
      val('#pf-img').onchange = async () => {
        const f = val('#pf-img').files[0]; if (!f) return;
        const fd = new FormData(); fd.append('image', await compressImage(f));
        try { const r = await api(`/products/${ed.id}/image`, { method: 'POST', body: fd });
          val('#pf-imgprev').innerHTML = `<img src="${esc(r.image)}">`;
        } catch (e) { val('#pf-err').textContent = e.message; }
      };
    }
    val('#pf-save').onclick = async () => {
      const payload = {
        name: val('#pf-name').value.trim(), category: val('#pf-cat').value.trim(),
        price: Number(val('#pf-price').value), cost: Number(val('#pf-cost').value) || 0,
        sort: Number(val('#pf-sort').value) || 0,
        track_stock: val('#pf-track').checked ? 1 : 0, stock: Number(val('#pf-stock').value) || 0,
        active: val('#pf-active').checked ? 1 : 0, description: val('#pf-desc').value
      };
      try {
        if (ed.id) await api(`/products/${ed.id}`, { method: 'PUT', body: payload });
        else await api('/products', { method: 'POST', body: payload });
        closeModal(); viewShop();
      } catch (e) { val('#pf-err').textContent = e.message; }
    };
    if (ed.id) val('#pf-del').onclick = async () => {
      if (!confirm('確定刪除此商品？（已有訂單者將改為下架保留紀錄）')) return;
      try { await api(`/products/${ed.id}`, { method: 'DELETE' }); closeModal(); viewShop(); }
      catch (e) { val('#pf-err').textContent = e.message; }
    };
  });
}

async function openStaffOrderForm(products) {
  const members = await api('/members');
  const cart = {};
  const itemsArr = () => Object.entries(cart).filter(([, q]) => q > 0).map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity }));
  const quote = async body => {
    const items = itemsArr();
    const mother_id = Number(body.querySelector('#so-mother').value) || null;
    const box = body.querySelector('#so-quote');
    if (!items.length) { box.innerHTML = '<small style="color:var(--muted)">請選擇商品</small>'; return; }
    try {
      const q = await api('/orders/quote', { method: 'POST', body: {
        items, mother_id, coupon_code: body.querySelector('#so-coupon').value.trim(),
        points_used: Number(body.querySelector('#so-points').value) || 0 } });
      box.innerHTML = `小計 ${fmtMoney(q.subtotal)}　優惠券 -${fmtMoney(q.coupon_discount)}　點數 -${fmtMoney(q.points_discount)}（${q.points_used} 點）<br>
        <strong>應收 ${fmtMoney(q.total)}</strong>　<small>確認後回饋 ${q.points_earned} 點</small>`;
    } catch (e) { box.innerHTML = `<span class="error-msg">${esc(e.message)}</span>`; }
  };
  const memberOpts = members.map(m => `<option value="${m.id}">${esc(m.name)}（${esc(m.member_no)}・${m.points}點）</option>`).join('');
  openModal('代客下單', `
    <div class="field"><label>選擇媽媽（會員）*</label>
      <select id="so-mother"><option value="">請選擇</option>${memberOpts}</select></div>
    <div id="so-list" style="margin:8px 0"></div>
    <div class="form-grid">
      <div class="field"><label>優惠券碼</label><input id="so-coupon" placeholder="選填"></div>
      <div class="field"><label>使用點數</label><input type="number" id="so-points" min="0" value="0"></div>
      <div class="field full"><label>備註</label><input id="so-note"></div>
    </div>
    <div id="so-quote" style="margin:8px 0;padding:8px;background:var(--primary-light);border-radius:8px;font-size:.9rem"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="so-save">建立訂單</button></div>
    <div class="error-msg" id="so-err"></div>`, body => {
    body.querySelector('#so-list').innerHTML = products.map(p => `
      <div class="row" style="justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);padding:4px 0">
        <span>${esc(p.name)} <small style="color:var(--muted)">${fmtMoney(p.price)}${p.track_stock ? `・庫存${p.stock}` : ''}</small></span>
        <input type="number" min="0" value="0" data-cart="${p.id}" style="width:64px">
      </div>`).join('') || '<div class="empty">無上架商品</div>';
    body.querySelectorAll('[data-cart]').forEach(inp => inp.onchange = () => { cart[inp.dataset.cart] = Number(inp.value) || 0; quote(body); });
    ['#so-mother', '#so-coupon', '#so-points'].forEach(s => body.querySelector(s).onchange = () => quote(body));
    quote(body);
    body.querySelector('#so-save').onclick = async () => {
      const items = itemsArr();
      const mother_id = Number(body.querySelector('#so-mother').value);
      if (!mother_id) { body.querySelector('#so-err').textContent = '請選擇媽媽'; return; }
      if (!items.length) { body.querySelector('#so-err').textContent = '請至少選一項商品'; return; }
      try { await api('/orders', { method: 'POST', body: {
        mother_id, items, note: body.querySelector('#so-note').value,
        coupon_code: body.querySelector('#so-coupon').value.trim(),
        points_used: Number(body.querySelector('#so-points').value) || 0 } });
        closeModal(); viewShop();
      } catch (e) { body.querySelector('#so-err').textContent = e.message; }
    };
  });
}

/* ---------- 耗材進銷存 ---------- */
async function viewSupplies() {
  const isAdmin = currentUser.role === 'admin';
  const rows = await api('/supplies');
  const low = rows.filter(s => s.active && s.stock <= s.safety_stock).length;
  main().innerHTML = `
    <div class="page-title">耗材庫存</div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>內部物料進銷存（尿布、奶粉等）${low ? `　<span class="badge red">${low} 項低於安全庫存</span>` : ''}</div>
        <div class="row">
          <button class="btn small secondary" id="sup-po">產生叫貨單</button>
          ${isAdmin ? '<button class="btn small" id="sup-new">新增耗材</button>' : ''}
        </div>
      </div>
      ${filterBar({ placeholder: '搜尋品名 / 分類…', statuses: [{ val: '', label: '全部' }, { val: 'low', label: '需補貨' }] })}
      <div class="table-wrap" style="margin-top:8px">
        <table class="data stack">
          <thead><tr><th>品名</th><th>分類</th><th>庫存</th><th>安全庫存</th><th>操作</th></tr></thead>
          <tbody>${rows.length ? rows.map(s => `
            <tr data-filter="${esc(s.name + ' ' + (s.category || ''))}" data-status="${s.stock <= s.safety_stock ? 'low' : 'ok'}"${s.active ? '' : ' style="opacity:.55"'}>
              <td data-label="品名">${esc(s.name)}${s.active ? '' : ' <span class="badge gray">停用</span>'}</td>
              <td data-label="分類">${esc(s.category || '-')}</td>
              <td data-label="庫存"><strong${s.stock <= s.safety_stock ? ' style="color:var(--danger)"' : ''}>${s.stock}</strong> ${esc(s.unit || '')}${s.stock <= s.safety_stock ? ' <span class="badge red">補貨</span>' : ''}</td>
              <td data-label="安全庫存">${s.safety_stock}</td>
              <td data-label="操作">
                <button class="btn small" data-in="${s.id}">進貨</button>
                <button class="btn small secondary" data-out="${s.id}">領用</button>
                <button class="btn small secondary" data-txn="${s.id}">紀錄</button>
                ${isAdmin ? `<button class="btn small secondary" data-edit="${s.id}">編輯</button>` : ''}
              </td>
            </tr>`).join('') : '<tr><td colspan="5"><div class="empty">尚未建立耗材</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  wireFilter(main());
  main().querySelector('#sup-po').onclick = openPurchaseOrder;
  const byId = id => rows.find(s => s.id == id);
  main().querySelectorAll('[data-in]').forEach(b => b.onclick = () => openSupplyTxn(byId(b.dataset.in), 'in'));
  main().querySelectorAll('[data-out]').forEach(b => b.onclick = () => openSupplyTxn(byId(b.dataset.out), 'out'));
  main().querySelectorAll('[data-txn]').forEach(b => b.onclick = () => openSupplyTxns(byId(b.dataset.txn)));
  if (isAdmin) {
    main().querySelector('#sup-new').onclick = () => openSupplyForm(null, distinctCats(rows));
    main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openSupplyForm(byId(b.dataset.edit), distinctCats(rows)));
  }
}
async function openPurchaseOrder() {
  const po = await api('/supplies/purchase-order');
  openModal(`叫貨單（${po.date}）`, `
    ${po.items.length ? `
    <p style="font-size:.85rem;color:var(--muted)">以下為庫存低於安全庫存的耗材與建議叫貨量，可列印或交予供應商。</p>
    <div class="table-wrap"><table class="data stack" id="po-table">
      <thead><tr><th>品名</th><th>分類</th><th>現有</th><th>安全</th><th>建議叫貨</th></tr></thead>
      <tbody>${po.items.map(i => `<tr>
        <td data-label="品名">${esc(i.name)}</td>
        <td data-label="分類">${esc(i.category || '-')}</td>
        <td data-label="現有">${i.stock} ${esc(i.unit || '')}</td>
        <td data-label="安全">${i.safety_stock}</td>
        <td data-label="建議叫貨"><strong>${i.suggest_qty}</strong> ${esc(i.unit || '')}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="row" style="margin-top:10px"><button class="btn secondary" id="po-print">列印</button></div>`
    : '<div class="empty">目前沒有低於安全庫存的耗材，無需叫貨。</div>'}`, body => {
    const pb = body.querySelector('#po-print');
    if (pb) pb.onclick = () => {
      const w = window.open('', '_blank');
      w.document.write(`<html><head><meta charset="utf-8"><title>叫貨單 ${po.date}</title>
        <style>body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px 10px;text-align:left}h2{margin:0 0 4px}</style></head>
        <body><h2>${esc(po.center_name)} 耗材叫貨單</h2><div>日期：${po.date}</div><br>
        ${body.querySelector('#po-table').outerHTML}</body></html>`);
      w.document.close(); w.print();
    };
  });
}
function openSupplyForm(s, cats) {
  const ed = s || {};
  openModal(ed.id ? '編輯耗材' : '新增耗材', `
    <div class="form-grid">
      <div class="field full"><label>品名 *</label><input id="su-name" value="${esc(ed.name || '')}"></div>
      <div class="field"><label>分類</label><input id="su-cat" value="${esc(ed.category || '')}" list="su-cat-list">${dataListValues('su-cat-list', cats)}</div>
      <div class="field"><label>單位</label><input id="su-unit" value="${esc(ed.unit || '')}" placeholder="包/罐/箱"></div>
      ${ed.id ? '' : '<div class="field"><label>期初庫存</label><input type="number" id="su-stock" min="0" value="0"></div>'}
      <div class="field"><label>安全庫存</label><input type="number" id="su-safe" min="0" value="${ed.safety_stock ?? 0}"></div>
      <div class="field"><label>目標補貨量（叫貨單，0=安全庫存2倍）</label><input type="number" id="su-restock" min="0" value="${ed.restock_level ?? 0}"></div>
      <div class="field full"><label>備註</label><input id="su-note" value="${esc(ed.note || '')}"></div>
      ${ed.id ? `<div class="field"><label><input type="checkbox" id="su-active" ${ed.active ? 'checked' : ''}> 啟用</label></div>` : ''}
      <div class="full row"><button class="btn" id="su-save">儲存</button>
        ${ed.id ? '<button class="btn danger" id="su-del">刪除</button>' : ''}
        <span class="error-msg" id="su-err"></span></div>
    </div>`, body => {
    const v = id => body.querySelector(id);
    v('#su-save').onclick = async () => {
      const payload = { name: v('#su-name').value.trim(), category: v('#su-cat').value.trim(),
        unit: v('#su-unit').value.trim(), safety_stock: Number(v('#su-safe').value) || 0,
        restock_level: Number(v('#su-restock').value) || 0, note: v('#su-note').value };
      if (!ed.id) payload.stock = Number(v('#su-stock').value) || 0;
      else payload.active = v('#su-active').checked ? 1 : 0;
      try { if (ed.id) await api(`/supplies/${ed.id}`, { method: 'PUT', body: payload });
        else await api('/supplies', { method: 'POST', body: payload });
        closeModal(); viewSupplies();
      } catch (e) { v('#su-err').textContent = e.message; }
    };
    if (ed.id) v('#su-del').onclick = async () => {
      if (!confirm('確定刪除此耗材？（有異動紀錄者改為停用）')) return;
      try { await api(`/supplies/${ed.id}`, { method: 'DELETE' }); closeModal(); viewSupplies(); }
      catch (e) { v('#su-err').textContent = e.message; }
    };
  });
}
function openSupplyTxn(s, type) {
  openModal(`${type === 'in' ? '進貨' : '領用'}：${s.name}（現有 ${s.stock} ${s.unit || ''}）`, `
    <div class="form-grid">
      <div class="field"><label>數量 *</label><input type="number" id="tx-qty" min="1" value="1"></div>
      <div class="field"><label>事由</label><input id="tx-reason" placeholder="${type === 'in' ? '採購入庫' : '日常領用'}"></div>
      <div class="field full"><label>備註</label><input id="tx-note"></div>
      <div class="full row"><button class="btn" id="tx-save">確認${type === 'in' ? '進貨' : '領用'}</button>
        <span class="error-msg" id="tx-err"></span></div>
    </div>`, body => {
    body.querySelector('#tx-save').onclick = async () => {
      try { await api(`/supplies/${s.id}/txns`, { method: 'POST', body: {
        txn_type: type, quantity: Number(body.querySelector('#tx-qty').value),
        reason: body.querySelector('#tx-reason').value, note: body.querySelector('#tx-note').value } });
        closeModal(); viewSupplies();
      } catch (e) { body.querySelector('#tx-err').textContent = e.message; }
    };
  });
}
async function openSupplyTxns(s) {
  const txns = await api(`/supplies/${s.id}/txns`);
  const LBL = { in: '進貨', out: '領用', adjust: '盤點' };
  openModal(`異動紀錄：${s.name}`, `
    <div class="table-wrap"><table class="data stack">
      <thead><tr><th>時間</th><th>類型</th><th>數量</th><th>結存</th><th>事由</th><th>經手</th></tr></thead>
      <tbody>${txns.length ? txns.map(t => `
        <tr><td data-label="時間"><small>${esc((t.created_at || '').slice(5, 16))}</small></td>
          <td data-label="類型"><span class="badge ${t.txn_type === 'in' ? 'green' : t.txn_type === 'out' ? 'yellow' : 'gray'}">${LBL[t.txn_type]}</span></td>
          <td data-label="數量">${t.txn_type === 'out' ? '-' : t.txn_type === 'in' ? '+' : '='}${t.quantity}</td>
          <td data-label="結存">${t.balance_after}</td>
          <td data-label="事由">${esc(t.reason || '')}${t.note ? `<br><small>${esc(t.note)}</small>` : ''}</td>
          <td data-label="經手">${esc(t.staff_name || '-')}</td></tr>`).join('')
        : '<tr><td colspan="6"><div class="empty">尚無異動</div></td></tr>'}</tbody>
    </table></div>`);
}

/* ========== 備品庫存管理模組 ========== */
const SUPPLY_CATS_DEFAULT = ['備品-媽媽專用', '備品-寶寶專用', '其他備品'];
function supplyCats(list) { return [...new Set([...SUPPLY_CATS_DEFAULT, ...list.map(s => s.category).filter(Boolean)])]; }
const YN = v => v ? 'yes' : 'no';
// 簡易 CSV 解析（支援雙引號欄位）
function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

// 1. 備品名稱設定
async function viewSupplyItems() {
  const list = await api('/supplies');
  const isAdmin = currentUser.role === 'admin';
  const cats = supplyCats(list);
  main().innerHTML = `
    <div class="page-title">備品名稱設定</div>
    <div class="card no-print">
      <div class="sec-hd">備品名稱設定（資料查詢）</div>
      <div class="form-grid">
        <div class="field"><label>查詢關鍵字</label><input id="si-kw"></div>
        <div class="field"><label>關鍵字欄位</label>
          <div class="row" style="gap:12px;padding-top:6px">
            <label class="bna-chk"><input type="radio" name="si-kf" value="name" checked> 產品名稱</label>
            <label class="bna-chk"><input type="radio" name="si-kf" value="code"> 產品編號</label>
          </div></div>
        <div class="field"><label>&nbsp;</label><label class="bna-chk"><input type="checkbox" id="si-front"> 只查詢前台可銷售項目</label></div>
        <div class="field"><label>產品分類</label><select id="si-cat"><option value="">全部</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="full row" style="gap:10px;justify-content:center">
          <button class="btn" id="si-go">送出查詢</button>
          ${isAdmin ? '<button class="btn secondary" id="si-add">資料新增</button><button class="btn secondary" id="si-import">匯入 CSV</button>' : ''}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">備品名稱設定（查詢結果）</div>
      <div class="table-wrap" id="si-result"></div>
    </div>`;
  const render = (rows) => {
    $('#si-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>產品編號</th><th>產品分類</th><th>產品名稱</th><th>單位</th><th>建議售價</th><th>註明有效期</th><th>開放前台銷售</th><th>安全庫存量</th><th class="no-print"></th></tr></thead>
      <tbody>${rows.map((s, i) => `
        <tr>
          <td data-label="筆數">${i + 1}</td>
          <td data-label="產品編號">${esc(s.code || '—')}</td>
          <td data-label="產品分類">${esc(s.category || '—')}</td>
          <td data-label="產品名稱">${esc(s.name)}${s.active ? '' : ' <span class="badge gray">停用</span>'}</td>
          <td data-label="單位">${esc(s.unit || '—')}</td>
          <td data-label="建議售價">${(s.price || 0).toLocaleString()}</td>
          <td data-label="註明有效期">${YN(s.has_expiry)}</td>
          <td data-label="開放前台銷售">${s.front_sellable ? 'yes' : ''}</td>
          <td data-label="安全庫存量">${s.safety_stock || 0}</td>
          <td data-label="" class="no-print">${isAdmin ? `<button class="btn small secondary" data-edit="${s.id}">編輯</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="10"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
    $('#si-result').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => supplyItemForm(list.find(x => x.id == b.dataset.edit), cats));
  };
  const go = () => {
    const kw = $('#si-kw').value.trim();
    const kf = main().querySelector('input[name="si-kf"]:checked').value;
    const front = $('#si-front').checked, cat = $('#si-cat').value;
    render(list.filter(s =>
      (!kw || (kf === 'code' ? (s.code || '') : s.name).includes(kw)) &&
      (!front || s.front_sellable) && (!cat || s.category === cat)));
  };
  $('#si-go').onclick = go;
  $('#si-kw').onkeydown = e => { if (e.key === 'Enter') go(); };
  go();
  if (!isAdmin) return;
  $('#si-add').onclick = () => supplyItemForm(null, cats);
  $('#si-import').onclick = () => supplyImportModal();
}
function supplyItemForm(s, cats) {
  s = s || {};
  openModal(s.id ? '編輯備品' : '新增備品', `
    <div class="field"><label>產品編號</label><input id="si-code" maxlength="40" value="${esc(s.code || '')}"></div>
    <div class="field"><label>產品分類</label><input id="si-fcat" list="si-catlist" value="${esc(s.category || '')}"><datalist id="si-catlist">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
    <div class="field"><label>產品名稱 <b class="req">*</b></label><input id="si-name" maxlength="60" value="${esc(s.name || '')}"></div>
    <div class="field"><label>單位</label><input id="si-unit" maxlength="20" value="${esc(s.unit || '')}"></div>
    <div class="field"><label>建議售價</label><input type="number" min="0" id="si-price" value="${s.price ?? 0}"></div>
    <div class="field"><label>安全庫存量</label><input type="number" min="0" id="si-safety" value="${s.safety_stock ?? 0}"></div>
    <div class="field"><label class="bna-chk"><input type="checkbox" id="si-exp" ${s.has_expiry ? 'checked' : ''}> 註明有效期</label></div>
    <div class="field"><label class="bna-chk"><input type="checkbox" id="si-fsell" ${s.front_sellable ? 'checked' : ''}> 開放前台銷售</label></div>
    ${s.id ? `<div class="field"><label>狀態</label><select id="si-active"><option value="1" ${s.active ? 'selected' : ''}>啟用</option><option value="0" ${!s.active ? 'selected' : ''}>停用</option></select></div>` : ''}
    <div class="row mt"><button class="btn" id="si-save">存檔</button><span class="error-msg" id="si-err"></span></div>`, body => {
    body.querySelector('#si-save').onclick = async () => {
      const b = { code: body.querySelector('#si-code').value.trim(), category: body.querySelector('#si-fcat').value.trim(),
        name: body.querySelector('#si-name').value.trim(), unit: body.querySelector('#si-unit').value.trim(),
        price: body.querySelector('#si-price').value, safety_stock: body.querySelector('#si-safety').value,
        has_expiry: body.querySelector('#si-exp').checked, front_sellable: body.querySelector('#si-fsell').checked };
      if (s.id) b.active = body.querySelector('#si-active').value === '1';
      if (!b.name) { body.querySelector('#si-err').textContent = '產品名稱必填'; return; }
      try {
        if (s.id) await api(`/supplies/${s.id}`, { method: 'PUT', body: b });
        else await api('/supplies', { method: 'POST', body: b });
        closeModal(); viewSupplyItems();
      } catch (e) { body.querySelector('#si-err').textContent = e.message; }
    };
  });
}
function supplyImportModal() {
  // CSV 欄位對應（可接受多種標題）
  const MAP = { code: ['產品編號', '編號', 'code'], category: ['產品分類', '分類', 'category'], name: ['產品名稱', '名稱', 'name'],
    unit: ['單位', 'unit'], price: ['建議售價', '售價', 'price'], has_expiry: ['註明有效期', '有效期', 'has_expiry'],
    front_sellable: ['開放前台銷售', '前台銷售', 'front_sellable'], safety_stock: ['安全庫存量', '安全庫存', 'safety_stock'] };
  openModal('匯入備品 CSV', `
    <div class="field"><label>選擇 CSV 檔</label><input type="file" id="ci-file" accept=".csv,text/csv"></div>
    <div class="field"><label>或直接貼上 CSV 內容</label><textarea id="ci-text" rows="6" placeholder="產品編號,產品分類,產品名稱,單位,建議售價,註明有效期,開放前台銷售,安全庫存量"></textarea></div>
    <small style="color:var(--muted)">＊第一列為標題，以產品編號為鍵：已存在則更新、否則新增。有效期／前台銷售填 yes／是／1 代表開啟。</small>
    <div class="row mt"><button class="btn" id="ci-go">匯入</button><span class="error-msg" id="ci-err"></span></div>`, body => {
    body.querySelector('#ci-file').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = () => { body.querySelector('#ci-text').value = r.result; }; r.readAsText(f, 'utf-8');
    };
    body.querySelector('#ci-go').onclick = async () => {
      const rows = parseCsv(body.querySelector('#ci-text').value);
      if (rows.length < 2) { body.querySelector('#ci-err').textContent = '請提供含標題列的 CSV'; return; }
      const header = rows[0].map(h => h.trim());
      const idx = {};
      for (const key in MAP) { idx[key] = header.findIndex(h => MAP[key].includes(h)); }
      if (idx.name < 0) { body.querySelector('#ci-err').textContent = '找不到「產品名稱」欄'; return; }
      const items = rows.slice(1).map(r => {
        const o = {}; for (const key in idx) if (idx[key] >= 0) o[key] = (r[idx[key]] || '').trim(); return o;
      }).filter(o => o.name);
      if (!items.length) { body.querySelector('#ci-err').textContent = '沒有可匯入的品項'; return; }
      try {
        const res = await api('/supplies/import', { method: 'POST', body: { items } });
        alert(`匯入完成：新增 ${res.added}、更新 ${res.updated}、略過 ${res.skipped}`
          + (res.duplicates && res.duplicates.length ? `\n注意：檔案中有重複鍵（以最後一筆為準）：${res.duplicates.join('、')}` : ''));
        closeModal(); viewSupplyItems();
      } catch (e) { body.querySelector('#ci-err').textContent = e.message; }
    };
  });
}

// 2 & 3. 備品進貨入庫 / 領取出庫（查詢頁 ＋ 資料新增）
function viewSupplyIn() {
  return supplyFlowPage({ type: 'in', pfx: 'sin', title: '備品進貨入庫', dateLabel: '進貨入庫日期', colDate: '入庫日期',
    extraKey: 'vendor', extraLabel: '進貨廠商', qtyLabel: '入庫數量', stockLabel: '目前存量' });
}
function viewSupplyOut() {
  return supplyFlowPage({ type: 'out', pfx: 'sout', title: '備品領取出庫', dateLabel: '領貨日期', colDate: '領貨日期',
    extraKey: 'dept', extraLabel: '領取單位', extraKwLabel: '領取單位', qtyLabel: '領取數量', stockLabel: '目前庫存量' });
}
const SUPPLY_DEPTS = ['清潔', '客服', '護理'];
const SUPPLY_PURPOSES = ['販售', '住房', '護理', '贈送', '尿布', '其他'];
async function supplyFlowPage(cfg) {
  const { type, pfx, title, dateLabel, extraKey, extraLabel, qtyLabel, stockLabel } = cfg;
  const extraKwLabel = cfg.extraKwLabel || extraLabel;
  const [supplies, txns] = await Promise.all([api('/supplies'), api(`/supply-txns?type=${type}`)]);
  const canWrite = canAccess('#/supplies');
  const active = supplies.filter(s => s.active);
  const smap = Object.fromEntries(supplies.map(s => [s.id, s]));
  const [mf, mt] = monthBounds();
  main().innerHTML = `
    <div class="page-title">${title}</div>
    <div class="card no-print">
      <div class="sec-hd">${title}（資料查詢）</div>
      <div class="form-grid">
        <div class="field"><label>${dateLabel}</label>
          <div class="row" style="gap:6px;align-items:center"><input type="date" id="${pfx}-from" value="${mf}"><span>to</span><input type="date" id="${pfx}-to" value="${mt}"></div></div>
        <div class="field"><label>查詢關鍵字</label><input id="${pfx}-kw"></div>
        <div class="field full"><label>關鍵字欄位</label>
          <div class="row" style="gap:16px;padding-top:6px;flex-wrap:wrap">
            <label class="bna-chk"><input type="radio" name="${pfx}-kf" value="name" checked> 產品名稱</label>
            <label class="bna-chk"><input type="radio" name="${pfx}-kf" value="code"> 產品編號</label>
            <label class="bna-chk"><input type="radio" name="${pfx}-kf" value="${extraKey}"> ${extraKwLabel}</label>
          </div></div>
        <div class="full row" style="gap:10px;justify-content:center">
          <button class="btn" id="${pfx}-go">送出查詢</button>
          ${canWrite ? `<button class="btn secondary" id="${pfx}-add">資料新增</button>` : ''}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">${title}（查詢結果）</div>
      <div class="table-wrap" id="${pfx}-result"></div>
    </div>`;
  // 出庫顯示 領取單位/領取用途；入庫顯示 進貨廠商/有效日期
  const midCols = type === 'out'
    ? [['領取單位', t => t.dept || t.area || '—'], ['領取用途', t => t.purpose || '—']]
    : [['進貨廠商', t => t.vendor || '—'], ['有效日期', t => t.expiry_date || '—']];
  const render = (rows) => {
    $(`#${pfx}-result`).innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>${cfg.colDate}</th><th>${midCols[0][0]}</th><th>產品編號</th><th>產品名稱</th><th>${qtyLabel}</th><th>單位</th><th>${midCols[1][0]}</th><th>${stockLabel}</th><th>備註</th></tr></thead>
      <tbody>${rows.map((t, i) => `
        <tr>
          <td data-label="筆數">${i + 1}</td>
          <td data-label="日期">${esc((t.created_at || '').slice(0, 10))}</td>
          <td data-label="${midCols[0][0]}">${esc(midCols[0][1](t))}</td>
          <td data-label="產品編號">${esc(t.supply_code || '—')}</td>
          <td data-label="產品名稱">${esc(t.supply_name)}</td>
          <td data-label="${qtyLabel}">${t.quantity}</td>
          <td data-label="單位">${esc(t.supply_unit || '')}</td>
          <td data-label="${midCols[1][0]}">${esc(midCols[1][1](t))}</td>
          <td data-label="${stockLabel}">${(smap[t.supply_id] || {}).stock ?? '—'}</td>
          <td data-label="備註">${esc(t.note || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="10"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
  };
  const filtered = () => {
    const from = $(`#${pfx}-from`).value, to = $(`#${pfx}-to`).value;
    const kw = $(`#${pfx}-kw`).value.trim();
    const kf = main().querySelector(`input[name="${pfx}-kf"]:checked`).value;
    return txns.filter(t => {
      const d = (t.created_at || '').slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (kw) { const v = kf === 'code' ? (t.supply_code || '') : kf === 'name' ? (t.supply_name || '') : (t[kf] || ''); if (!v.includes(kw)) return false; }
      return true;
    });
  };
  const go = () => render(filtered());
  $(`#${pfx}-go`).onclick = go;
  go();
  if (!canWrite) return;
  const itemOpts = `<option value="">請選擇</option>${active.map(s =>
    `<option value="${s.id}">${esc((s.code ? s.code + '｜' : '') + s.name)}（庫存 ${s.stock}${esc(s.unit || '')}）</option>`).join('')}`;
  // 入庫：單品項（無進貨廠商欄）；出庫：領取單位＋多品項＋領取用途
  const openIn = () => openModal(`${title} 資料新增`, `
    <div class="field"><label>備品品項 <b class="req">*</b></label><select id="${pfx}-item">${itemOpts}</select></div>
    <div class="field"><label>${qtyLabel} <b class="req">*</b></label><input type="number" min="1" id="${pfx}-qty"></div>
    <div class="field"><label>有效日期</label><input type="date" id="${pfx}-exp"></div>
    <div class="field"><label>備註</label><input id="${pfx}-note"></div>
    <div class="row mt"><button class="btn" id="${pfx}-save">存檔</button><span class="error-msg" id="${pfx}-err"></span></div>`, body => {
    body.querySelector(`#${pfx}-save`).onclick = async () => {
      const id = body.querySelector(`#${pfx}-item`).value, qty = body.querySelector(`#${pfx}-qty`).value;
      if (!id) { body.querySelector(`#${pfx}-err`).textContent = '請選擇備品品項'; return; }
      if (!(Number(qty) > 0)) { body.querySelector(`#${pfx}-err`).textContent = '請輸入正確數量'; return; }
      try {
        await api(`/supplies/${id}/txns`, { method: 'POST', body: { txn_type: 'in', quantity: qty,
          expiry_date: body.querySelector(`#${pfx}-exp`).value, note: body.querySelector(`#${pfx}-note`).value.trim() } });
        closeModal(); supplyFlowPage(cfg);
      } catch (e) { body.querySelector(`#${pfx}-err`).textContent = e.message; }
    };
  });
  const openOut = () => openModal(`${title} 資料新增`, `
    <div class="field"><label>領取單位 <b class="req">*</b></label>
      <select id="${pfx}-dept"><option value="">請選擇</option>${SUPPLY_DEPTS.map(d => `<option>${d}</option>`).join('')}</select></div>
    <div id="${pfx}-rows"></div>
    <div class="row" style="margin:6px 0"><button class="btn small secondary" id="${pfx}-addrow">增加品項</button>
      <small style="color:var(--muted)">一個單位可一次領取多個品項</small></div>
    <div class="field"><label>領取用途 <b class="req">*</b></label>
      <select id="${pfx}-purpose"><option value="">請選擇</option>${SUPPLY_PURPOSES.map(p => `<option>${p}</option>`).join('')}</select></div>
    <p id="${pfx}-sale-hint" style="display:none;font-size:.78rem;color:var(--muted);margin:4px 0">用途「販售」：領出數量將自動匯入商城<strong>同名商品</strong>庫存；商城無此品項時將禁止領用。</p>
    <div class="field"><label>備註</label><input id="${pfx}-note"></div>
    <div class="row mt"><button class="btn" id="${pfx}-save">存檔</button><span class="error-msg" id="${pfx}-err"></span></div>`, body => {
    const rowsBox = body.querySelector(`#${pfx}-rows`);
    const addRow = () => {
      const div = document.createElement('div');
      div.className = 'row';
      div.style.cssText = 'gap:8px;align-items:flex-end;margin-bottom:6px';
      div.innerHTML = `
        <div class="field" style="flex:1;margin:0"><label>備品品項 <b class="req">*</b></label><select data-out-item>${itemOpts}</select></div>
        <div class="field" style="max-width:110px;margin:0"><label>${qtyLabel} <b class="req">*</b></label><input type="number" min="1" data-out-qty></div>
        <button class="btn small danger" data-out-del title="移除">✕</button>`;
      div.querySelector('[data-out-del]').onclick = () => {
        if (rowsBox.children.length > 1) div.remove();
      };
      rowsBox.appendChild(div);
    };
    addRow();
    body.querySelector(`#${pfx}-addrow`).onclick = addRow;
    const purposeSel = body.querySelector(`#${pfx}-purpose`);
    purposeSel.onchange = () => {
      body.querySelector(`#${pfx}-sale-hint`).style.display = purposeSel.value === '販售' ? '' : 'none';
    };
    body.querySelector(`#${pfx}-save`).onclick = async () => {
      const err = body.querySelector(`#${pfx}-err`);
      err.textContent = '';
      const dept = body.querySelector(`#${pfx}-dept`).value;
      if (!dept) { err.textContent = '請選擇領取單位'; return; }
      const items = [...rowsBox.children].map(div => ({
        supply_id: Number(div.querySelector('[data-out-item]').value) || 0,
        quantity: Number(div.querySelector('[data-out-qty]').value) || 0
      }));
      if (items.some(it => !it.supply_id)) { err.textContent = '請選擇每一列的備品品項'; return; }
      if (items.some(it => !(it.quantity > 0))) { err.textContent = '請輸入每一列的正確數量'; return; }
      if (!purposeSel.value) { err.textContent = '請選擇領取用途'; return; }
      try {
        await api('/supply-txns/out-batch', { method: 'POST', body: {
          dept, purpose: purposeSel.value, note: body.querySelector(`#${pfx}-note`).value.trim(), items
        } });
        closeModal(); supplyFlowPage(cfg);
      } catch (e) {
        err.textContent = e.message;
        if (e.message.startsWith('禁止領用')) alert(e.message); // 販售但商城無此品項：跳出警告
      }
    };
  });
  $(`#${pfx}-add`).onclick = type === 'out' ? openOut : openIn;
}

// 4. 備品進出明細表
async function viewSupplyMovements() {
  const supplies = await api('/supplies');
  const smap = Object.fromEntries(supplies.map(s => [s.id, s]));
  const cats = supplyCats(supplies);
  const [mf, mt] = monthBounds();
  main().innerHTML = `
    <div class="page-title">備品進出明細表</div>
    <div class="card no-print">
      <div class="sec-hd">備品進出明細表（資料查詢）</div>
      <div class="form-grid">
        <div class="field"><label>查詢日期</label>
          <div class="row" style="gap:6px;align-items:center"><input type="date" id="sm-from" value="${mf}"><span>to</span><input type="date" id="sm-to" value="${mt}"></div></div>
        <div class="field"><label>產品分類</label><select id="sm-cat"><option value="">全部</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label>查詢關鍵字</label><input id="sm-kw"></div>
        <div class="field"><label>關鍵字欄位</label>
          <div class="row" style="gap:12px;padding-top:6px">
            <label class="bna-chk"><input type="radio" name="sm-kf" value="name" checked> 產品名稱</label>
            <label class="bna-chk"><input type="radio" name="sm-kf" value="code"> 產品編號</label>
          </div></div>
        <div class="full row" style="justify-content:center"><button class="btn" id="sm-go">送出查詢</button></div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">備品進出明細表（查詢結果）</div>
      <div class="row no-print" style="justify-content:flex-end;gap:8px;margin-bottom:6px"><button class="btn small" id="sm-csv">匯出 Excel（CSV）</button><button class="btn small secondary" id="sm-print">資料列印</button></div>
      <div class="table-wrap" id="sm-result"></div>
      <div id="sm-pager"></div>
    </div>`;
  const params = () => {
    const kf = main().querySelector('input[name="sm-kf"]:checked').value;
    const p = new URLSearchParams({ type: 'inout' });
    if ($('#sm-from').value) p.set('from', $('#sm-from').value);
    if ($('#sm-to').value) p.set('to', $('#sm-to').value);
    if ($('#sm-cat').value) p.set('category', $('#sm-cat').value);
    const kw = $('#sm-kw').value.trim();
    if (kw) { p.set('keyword', kw); p.set('kw_field', kf); }
    return p;
  };
  const rowToArr = t => [(t.created_at || '').slice(0, 10), t.supply_code || '', t.supply_category || '', t.supply_name, t.supply_unit || '', t.txn_type === 'in' ? t.quantity : '', t.txn_type === 'out' ? t.quantity : '', (smap[t.supply_id] || {}).stock ?? ''];
  const load = async (page = 1) => {
    const p = params(); p.set('page', page); p.set('pageSize', PAGE_SIZE);
    const { rows, total, pageSize } = await api('/supply-txns?' + p.toString());
    const base = (page - 1) * pageSize;
    $('#sm-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>日期</th><th>產品編號</th><th>產品分類</th><th>產品名稱</th><th>單位</th><th>進貨數量</th><th>領貨數量</th><th>目前庫存量</th></tr></thead>
      <tbody>${rows.map((t, i) => `
        <tr>
          <td data-label="筆數">${base + i + 1}</td>
          <td data-label="日期">${esc((t.created_at || '').slice(0, 10))}</td>
          <td data-label="產品編號">${esc(t.supply_code || '—')}</td>
          <td data-label="產品分類">${esc(t.supply_category || '—')}</td>
          <td data-label="產品名稱">${esc(t.supply_name)}</td>
          <td data-label="單位">${esc(t.supply_unit || '')}</td>
          <td data-label="進貨數量">${t.txn_type === 'in' ? t.quantity : ''}</td>
          <td data-label="領貨數量">${t.txn_type === 'out' ? t.quantity : ''}</td>
          <td data-label="目前庫存量">${(smap[t.supply_id] || {}).stock ?? '—'}</td>
        </tr>`).join('') || '<tr><td colspan="9"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
    $('#sm-pager').innerHTML = pagerBar(total, page, pageSize);
    wirePager(page, total, pageSize, load);
  };
  $('#sm-go').onclick = () => load(1);
  $('#sm-print').onclick = () => window.print();
  $('#sm-csv').onclick = async () => {
    const p = params(); p.set('page', 1); p.set('pageSize', 200);
    const { rows, total } = await api('/supply-txns?' + p.toString());
    if (!rows.length) { alert('查無資料可匯出'); return; }
    if (total > rows.length) alert(`資料共 ${total} 筆，匯出前 ${rows.length} 筆；如需完整請縮小日期範圍。`);
    downloadCsv(`備品進出明細_${todayStr()}.csv`,
      ['日期', '產品編號', '產品分類', '產品名稱', '單位', '進貨數量', '領貨數量', '目前庫存量'], rows.map(rowToArr));
  };
  load(1);
}

// 5. 庫存盤點
async function viewSupplyStocktake() {
  const rows0 = await api('/supplies/stock-summary');
  const canWrite = canAccess('#/supplies');
  const cats = supplyCats(rows0);
  main().innerHTML = `
    <div class="page-title">庫存盤點</div>
    <div class="card no-print">
      <div class="sec-hd">庫存盤點（資料查詢）</div>
      <div class="form-grid">
        <div class="field"><label>查詢關鍵字</label><input id="stk-kw"></div>
        <div class="field"><label>關鍵字欄位</label>
          <div class="row" style="gap:12px;padding-top:6px">
            <label class="bna-chk"><input type="radio" name="stk-kf" value="name" checked> 產品名稱</label>
            <label class="bna-chk"><input type="radio" name="stk-kf" value="code"> 產品編號</label>
          </div></div>
        <div class="field"><label>產品分類</label><select id="stk-cat"><option value="">全部</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="full row" style="justify-content:center"><button class="btn" id="stk-go">送出查詢</button></div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">庫存盤點</div>
      <div class="table-wrap" id="stk-result"></div>
    </div>`;
  const render = (rows) => {
    $('#stk-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>產品編號</th><th>產品名稱</th><th>期初數量</th><th>入庫總數</th><th>出庫總數</th><th>目前庫存數量</th><th class="no-print"></th></tr></thead>
      <tbody>${rows.map((s, i) => {
        const opening = s.stock - s.total_in + s.total_out;
        return `
        <tr>
          <td data-label="筆數">${i + 1}</td>
          <td data-label="產品編號">${esc(s.code || '—')}</td>
          <td data-label="產品名稱">${esc(s.name)}</td>
          <td data-label="期初數量">${opening}</td>
          <td data-label="入庫總數">${s.total_in}</td>
          <td data-label="出庫總數">${s.total_out}</td>
          <td data-label="目前庫存數量">${s.stock}</td>
          <td data-label="" class="no-print">${canWrite ? `<button class="btn small" data-adj="${s.id}" data-name="${esc(s.name)}" data-stock="${s.stock}" data-unit="${esc(s.unit || '')}">調整</button>` : ''}</td>
        </tr>`; }).join('') || '<tr><td colspan="8"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
    if (canWrite) $('#stk-result').querySelectorAll('[data-adj]').forEach(b => b.onclick = () => adjustStock(b.dataset.adj, b.dataset.name, Number(b.dataset.stock), b.dataset.unit));
  };
  const go = () => {
    const kw = $('#stk-kw').value.trim(), kf = main().querySelector('input[name="stk-kf"]:checked').value, cat = $('#stk-cat').value;
    render(rows0.filter(s => (!kw || (kf === 'code' ? (s.code || '') : s.name).includes(kw)) && (!cat || s.category === cat)));
  };
  $('#stk-go').onclick = go;
  go();
}
function adjustStock(id, name, stock, unit) {
  openModal(`盤點調整：${name}`, `
    <div class="field"><label>系統目前庫存</label><input value="${stock} ${esc(unit || '')}" disabled></div>
    <div class="field"><label>實際盤點數量 <b class="req">*</b></label><input type="number" min="0" id="adj-qty" value="${stock}"></div>
    <div class="field"><label>備註</label><input id="adj-note" placeholder="庫存盤點"></div>
    <div class="row mt"><button class="btn" id="adj-save">存檔</button><span class="error-msg" id="adj-err"></span></div>`, body => {
    body.querySelector('#adj-save').onclick = async () => {
      const qty = body.querySelector('#adj-qty').value;
      if (qty === '' || Number(qty) < 0) { body.querySelector('#adj-err').textContent = '請輸入正確盤點數量'; return; }
      try {
        await api(`/supplies/${id}/txns`, { method: 'POST', body: { txn_type: 'adjust', quantity: qty, reason: '庫存盤點', note: body.querySelector('#adj-note').value.trim() } });
        closeModal(); viewSupplyStocktake();
      } catch (e) { body.querySelector('#adj-err').textContent = e.message; }
    };
  });
}

// 6. 庫存盤點明細表
async function viewStocktakeDetail() {
  const supplies = await api('/supplies');
  const cats = supplyCats(supplies);
  const [mf, mt] = monthBounds();
  main().innerHTML = `
    <div class="page-title">庫存盤點明細表</div>
    <div class="card no-print">
      <div class="sec-hd">庫存盤點明細表（資料查詢）</div>
      <div class="form-grid">
        <div class="field"><label>查詢日期</label>
          <div class="row" style="gap:6px;align-items:center"><input type="date" id="sd-from" value="${mf}"><span>to</span><input type="date" id="sd-to" value="${mt}"></div></div>
        <div class="field"><label>查詢關鍵字</label><input id="sd-kw"></div>
        <div class="field"><label>關鍵字欄位</label>
          <div class="row" style="gap:12px;padding-top:6px">
            <label class="bna-chk"><input type="radio" name="sd-kf" value="name" checked> 產品名稱</label>
            <label class="bna-chk"><input type="radio" name="sd-kf" value="code"> 產品編號</label>
          </div></div>
        <div class="field"><label>產品分類</label><select id="sd-cat"><option value="">全部</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="full row" style="gap:10px;justify-content:center">
          <button class="btn" id="sd-go">送出查詢</button>
          <button class="btn secondary" id="sd-stock">匯出最新庫存量</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">庫存盤點明細表（查詢結果）</div>
      <div class="row no-print" style="justify-content:flex-end;gap:8px;margin-bottom:6px"><button class="btn small" id="sd-csv">匯出 Excel（CSV）</button><button class="btn small secondary" id="sd-print">資料列印</button></div>
      <div class="table-wrap" id="sd-result"></div>
      <div id="sd-pager"></div>
    </div>`;
  const params = () => {
    const kf = main().querySelector('input[name="sd-kf"]:checked').value;
    const p = new URLSearchParams({ type: 'adjust' });
    if ($('#sd-from').value) p.set('from', $('#sd-from').value);
    if ($('#sd-to').value) p.set('to', $('#sd-to').value);
    if ($('#sd-cat').value) p.set('category', $('#sd-cat').value);
    const kw = $('#sd-kw').value.trim();
    if (kw) { p.set('keyword', kw); p.set('kw_field', kf); }
    return p;
  };
  const rowToArr = t => [(t.created_at || '').slice(0, 16), t.supply_code || '', t.supply_category || '', t.supply_name, t.balance_after, t.staff_name || ''];
  const load = async (page = 1) => {
    const p = params(); p.set('page', page); p.set('pageSize', PAGE_SIZE);
    const { rows, total, pageSize } = await api('/supply-txns?' + p.toString());
    const base = (page - 1) * pageSize;
    $('#sd-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>盤點日期</th><th>產品編號</th><th>產品分類</th><th>產品名稱</th><th>目前庫存量</th><th>建檔人</th></tr></thead>
      <tbody>${rows.map((t, i) => `
        <tr>
          <td data-label="筆數">${base + i + 1}</td>
          <td data-label="盤點日期">${esc((t.created_at || '').slice(0, 16))}</td>
          <td data-label="產品編號">${esc(t.supply_code || '—')}</td>
          <td data-label="產品分類">${esc(t.supply_category || '—')}</td>
          <td data-label="產品名稱">${esc(t.supply_name)}</td>
          <td data-label="目前庫存量">${t.balance_after}${esc(t.supply_unit || '')}</td>
          <td data-label="建檔人">${esc(t.staff_name || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="7"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
    $('#sd-pager').innerHTML = pagerBar(total, page, pageSize);
    wirePager(page, total, pageSize, load);
  };
  $('#sd-go').onclick = () => load(1);
  $('#sd-print').onclick = () => window.print();
  $('#sd-csv').onclick = async () => {
    const p = params(); p.set('page', 1); p.set('pageSize', 200);
    const { rows, total } = await api('/supply-txns?' + p.toString());
    if (!rows.length) { alert('查無資料可匯出'); return; }
    if (total > rows.length) alert(`資料共 ${total} 筆，匯出前 ${rows.length} 筆；如需完整請縮小日期範圍。`);
    downloadCsv(`庫存盤點明細_${todayStr()}.csv`,
      ['盤點日期', '產品編號', '產品分類', '產品名稱', '目前庫存量', '建檔人'], rows.map(rowToArr));
  };
  $('#sd-stock').onclick = () => {
    downloadCsv(`最新庫存量_${todayStr()}.csv`,
      ['產品編號', '產品分類', '產品名稱', '單位', '目前庫存量', '安全庫存量'],
      supplies.filter(s => s.active).map(s => [s.code || '', s.category || '', s.name, s.unit || '', s.stock, s.safety_stock]));
  };
  load(1);
}

/* ---------- 課程與服務 ---------- */
async function viewPrograms() {
  const isAdmin = currentUser.role === 'admin';
  const [progs, signups] = await Promise.all([api('/programs'), api('/signups?status=pending')]);
  const KIND = { course: '課程', service: '服務' };
  const suRows = signups.length ? signups.map(s => `
    <tr>
      <td data-label="時間"><small>${esc((s.created_at || '').slice(5, 16))}</small></td>
      <td data-label="項目">${KIND[s.kind]}｜${esc(s.program_name)}${s.scheduled_at ? `<br><small>${esc(s.scheduled_at)}</small>` : ''}</td>
      <td data-label="來源">${s.placed_by === 'family' ? `<span class="badge">家屬</span> ${esc(s.family_name || '')}` : `<span class="badge gray">代客</span>`}</td>
      <td data-label="媽媽">${esc(s.mother_name || '-')}　×${s.quantity}${s.preferred_at ? `<br><small>偏好：${esc(s.preferred_at)}</small>` : ''}</td>
      <td data-label="操作"><button class="btn small" data-confirm="${s.id}">確認</button> <button class="btn small danger" data-cancel="${s.id}">取消</button></td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty">沒有待確認報名</div></td></tr>';
  const progRows = progs.length ? progs.map(p => `
    <tr data-filter="${esc(p.name + ' ' + (p.category || ''))}" data-status="${p.kind}"${p.active ? '' : ' style="opacity:.55"'}>
      <td data-label="類型"><span class="badge ${p.kind === 'course' ? 'teal' : 'gray'}">${KIND[p.kind]}</span></td>
      <td data-label="名稱">${esc(p.name)}${p.active ? '' : ' <span class="badge gray">停止報名</span>'}${p.category ? `<br><small>${esc(p.category)}</small>` : ''}</td>
      <td data-label="時間/地點">${esc(p.scheduled_at || '採預約')}${p.location ? `<br><small>${esc(p.location)}</small>` : ''}</td>
      <td data-label="費用">${fmtMoney(p.price)}</td>
      <td data-label="名額">${p.capacity > 0 ? p.capacity : '不限'}</td>
      <td data-label="操作">${isAdmin ? `<button class="btn small secondary" data-edit="${p.id}">編輯</button> ` : ''}<button class="btn small secondary" data-photos="${p.id}">照片</button></td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty">尚未建立課程／服務</div></td></tr>';
  main().innerHTML = `
    <div class="page-title">課程與服務</div>
    <div class="tabbar no-print" style="margin-bottom:12px">
      <button class="active">清單</button>
      <button onclick="location.hash='#/program-calendar'">行事曆</button>
    </div>
    <div class="card">
      <h3 style="color:var(--primary-dark);font-size:1rem;margin:0 0 8px">待確認報名 <span class="badge ${signups.length ? 'red' : 'green'}">${signups.length}</span></h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>時間</th><th>項目</th><th>來源</th><th>媽媽</th><th></th></tr></thead>
        <tbody>${suRows}</tbody></table></div>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="color:var(--primary-dark);font-size:1rem;margin:0">課程／服務項目</h3>
        <div class="row">
          <button class="btn small secondary" id="pg-neworder">代客報名</button>
          ${isAdmin ? '<button class="btn small" id="pg-new">新增項目</button>' : ''}
        </div>
      </div>
      ${filterBar({ placeholder: '搜尋名稱 / 分類…', statuses: [{ val: '', label: '全部' }, { val: 'course', label: '課程' }, { val: 'service', label: '服務' }] })}
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>類型</th><th>名稱</th><th>時間/地點</th><th>費用</th><th>名額</th><th></th></tr></thead>
        <tbody>${progRows}</tbody></table></div>
    </div>`;
  wireFilter(main());
  main().querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
    try { const r = await api(`/signups/${b.dataset.confirm}/confirm`, { method: 'POST' });
      if (!r.charged) alert('已確認；此媽媽無進行中訂房或項目免費，未自動入帳。'); viewPrograms();
    } catch (e) { alert(e.message); }
  });
  main().querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
    if (!confirm('確定取消此報名？')) return;
    try { await api(`/signups/${b.dataset.cancel}/cancel`, { method: 'POST' }); viewPrograms(); } catch (e) { alert(e.message); }
  });
  main().querySelector('#pg-neworder').onclick = () => openSignupForm(progs.filter(p => p.active));
  main().querySelectorAll('[data-photos]').forEach(b => b.onclick = () => openProgramPhotos(progs.find(p => p.id == b.dataset.photos)));
  if (isAdmin) {
    main().querySelector('#pg-new').onclick = () => openProgramForm(null, distinctCats(progs));
    main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openProgramForm(progs.find(p => p.id == b.dataset.edit), distinctCats(progs)));
  }
}

// 課程照片：上傳／檢視／刪除（檔案存 uploads/programs/年月日課程名稱/）
async function openProgramPhotos(p) {
  const photos = await api(`/programs/${p.id}/photos`);
  openModal(`課程照片：${p.name}`, `
    <div class="row" style="align-items:center;gap:8px;margin-bottom:10px">
      <input type="file" id="pp-files" accept="image/*" multiple>
      <button class="btn small" id="pp-upload">上傳</button>
      <span class="error-msg" id="pp-err"></span>
    </div>
    <p style="font-size:.76rem;color:var(--muted);margin:0 0 10px">照片依「年月日課程名稱」資料夾歸檔於伺服器。</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
      ${photos.length ? photos.map(ph => `
        <div style="position:relative">
          <a href="/uploads/${esc(ph.file)}" target="_blank"><img src="/uploads/${esc(ph.file)}" style="width:100%;height:110px;object-fit:cover;border-radius:8px;border:1px solid var(--border)"></a>
          <button class="btn small danger" data-pp-del="${ph.id}" style="position:absolute;top:4px;right:4px;padding:2px 8px">刪除</button>
          <div style="font-size:.7rem;color:var(--muted)">${esc((ph.created_at || '').slice(0, 16))}</div>
        </div>`).join('') : '<div class="empty" style="grid-column:1/-1">尚無照片</div>'}
    </div>`, body => {
    body.querySelector('#pp-upload').onclick = async () => {
      const files = body.querySelector('#pp-files').files;
      if (!files.length) { body.querySelector('#pp-err').textContent = '請先選擇圖片檔'; return; }
      const fd = new FormData();
      [...files].forEach(f => fd.append('photos', f));
      try {
        const res = await fetch(`/api/programs/${p.id}/photos`, { method: 'POST', body: fd });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || '上傳失敗');
        openProgramPhotos(p);
      } catch (e) { body.querySelector('#pp-err').textContent = e.message; }
    };
    body.querySelectorAll('[data-pp-del]').forEach(b => b.onclick = async () => {
      if (!confirm('確定刪除此照片？')) return;
      try { await api(`/program-photos/${b.dataset.ppDel}`, { method: 'DELETE' }); openProgramPhotos(p); }
      catch (e) { alert(e.message); }
    });
  });
}

/* ---------- 課程行事曆（月／週檢視） ---------- */
let _pcState = null;
async function viewProgramCalendar() {
  const allProgs = await api('/programs');
  const progs = allProgs.filter(p => p.active && p.scheduled_at && /^\d{4}-\d{2}-\d{2}/.test(p.scheduled_at));
  const KIND = { course: '課程', service: '服務' };
  const isAdmin = currentUser.role === 'admin';
  const cats = distinctCats(allProgs);
  // 以日期分組
  const byDate = {};
  for (const p of progs) { const d = p.scheduled_at.slice(0, 10); (byDate[d] = byDate[d] || []).push(p); }
  for (const d in byDate) byDate[d].sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''));
  if (!_pcState) _pcState = { mode: 'month', anchor: todayStr() };
  const st = _pcState;
  const fmtD = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const anchor = parse(st.anchor);
  const dayCell = (d) => {
    const key = fmtD(d);
    const items = (byDate[key] || []).map(p => `<div class="pc-item" title="${esc(p.name)}" data-pc="${p.id}"><span class="dot ${p.kind === 'course' ? 'teal' : 'gray'}"></span>${esc((p.scheduled_at.slice(11, 16) || ''))} ${esc(p.name.length > 8 ? p.name.slice(0, 8) + '…' : p.name)}</div>`).join('');
    const isToday = key === todayStr();
    return `<td class="pc-day${isToday ? ' pc-today' : ''}" ${isAdmin ? `data-add="${key}" style="vertical-align:top;height:88px;min-width:90px;cursor:pointer"` : 'style="vertical-align:top;height:88px;min-width:90px"'}><div style="font-size:.8rem;color:var(--muted)">${d.getDate()}${isAdmin ? '<span class="pc-plus" style="float:right;color:var(--primary);font-weight:700">＋</span>' : ''}</div>${items}</td>`;
  };
  let grid = '', title = '';
  if (st.mode === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // 週一起
    title = `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`;
    let rows = '';
    for (let w = 0; w < 6; w++) {
      let tds = '';
      for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + w * 7 + i); tds += dayCell(d); }
      rows += `<tr>${tds}</tr>`;
    }
    grid = rows;
  } else {
    const start = new Date(anchor); start.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(start.getDate() + 6);
    title = `${fmtD(start)} ~ ${fmtD(end)}`;
    let tds = '';
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); tds += dayCell(d); }
    grid = `<tr>${tds}</tr>`;
  }
  const wk = ['一', '二', '三', '四', '五', '六', '日'];
  main().innerHTML = `
    <div class="page-title">課程與服務</div>
    <div class="tabbar no-print" style="margin-bottom:12px">
      <button onclick="location.hash='#/programs'">清單</button>
      <button class="active">行事曆</button>
    </div>
    <div class="card no-print">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div class="row" style="gap:6px">
          <button class="btn small secondary" id="pc-prev">‹ 上一${st.mode === 'month' ? '月' : '週'}</button>
          <button class="btn small secondary" id="pc-today">今天</button>
          <button class="btn small secondary" id="pc-next">下一${st.mode === 'month' ? '月' : '週'} ›</button>
          <strong style="align-self:center;margin-left:8px">${title}</strong>
        </div>
        <div class="row" style="gap:6px">
          <button class="btn small ${st.mode === 'month' ? '' : 'secondary'}" id="pc-month">月</button>
          <button class="btn small ${st.mode === 'week' ? '' : 'secondary'}" id="pc-week">週</button>
        </div>
      </div>
      <small style="color:var(--muted)"><span class="dot teal"></span> 課程　<span class="dot gray"></span> 服務　（僅顯示有排定時段的項目）${canAccess('#/programs') ? '　點課程可代客報名' : ''}${isAdmin ? '　點空白日期可新增課程（＋）' : ''}</small>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="data pc-cal"><thead><tr>${wk.map(w => `<th style="text-align:center">週${w}</th>`).join('')}</tr></thead>
          <tbody>${grid}</tbody></table>
      </div>
    </div>
    <style>
      .pc-cal td.pc-day{border:1px solid var(--border);padding:3px}
      .pc-cal td.pc-today{background:#eef6f0}
      .pc-cal td.pc-drop{background:#dcefe4;outline:2px dashed var(--primary)}
      .pc-item{font-size:.72rem;background:#f0f4f8;border-radius:4px;padding:1px 4px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
      .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:3px;vertical-align:middle}
      .dot.teal{background:#2a9d8f}.dot.gray{background:#9aa}
    </style>`;
  const shift = (n) => {
    const a = parse(st.anchor);
    if (st.mode === 'month') a.setMonth(a.getMonth() + n); else a.setDate(a.getDate() + n * 7);
    st.anchor = fmtD(a); viewProgramCalendar();
  };
  $('#pc-prev').onclick = () => shift(-1);
  $('#pc-next').onclick = () => shift(1);
  $('#pc-today').onclick = () => { st.anchor = todayStr(); viewProgramCalendar(); };
  $('#pc-month').onclick = () => { st.mode = 'month'; viewProgramCalendar(); };
  $('#pc-week').onclick = () => { st.mode = 'week'; viewProgramCalendar(); };
  const canSignup = canAccess('#/programs');
  if (isAdmin) main().querySelectorAll('[data-add]').forEach(td => {
    td.onclick = () => openProgramForm({ scheduled_at: td.dataset.add + ' 10:00' }, cats, viewProgramCalendar);
    // 拖曳改期：課程/服務項目拖到別的日期即改期（保留原時間）
    td.ondragover = (e) => { e.preventDefault(); td.classList.add('pc-drop'); };
    td.ondragleave = () => td.classList.remove('pc-drop');
    td.ondrop = async (e) => {
      e.preventDefault(); td.classList.remove('pc-drop');
      const id = e.dataTransfer.getData('text/plain'); if (!id) return;
      const p = progs.find(x => x.id == id); if (!p) return;
      const newDate = td.dataset.add;
      if ((p.scheduled_at || '').slice(0, 10) === newDate) return; // 同一天不動
      const time = (p.scheduled_at || '').slice(11, 16) || '10:00';
      try { await api(`/programs/${id}`, { method: 'PUT', body: { scheduled_at: `${newDate} ${time}` } }); viewProgramCalendar(); }
      catch (err) { alert(err.message); }
    };
  });
  if (isAdmin) main().querySelectorAll('[data-pc]').forEach(el => {
    el.setAttribute('draggable', 'true');
    el.style.cursor = 'grab';
    el.ondragstart = (e) => { e.dataTransfer.setData('text/plain', el.dataset.pc); e.dataTransfer.effectAllowed = 'move'; };
  });
  main().querySelectorAll('[data-pc]').forEach(el => el.onclick = (e) => {
    e.stopPropagation(); // 避免觸發整格的「新增課程」
    const p = progs.find(x => x.id == el.dataset.pc); if (!p) return;
    openModal(p.name, `
      <div class="field"><label>類型</label><div>${KIND[p.kind]}${p.category ? '｜' + esc(p.category) : ''}</div></div>
      <div class="field"><label>時間</label><div>${esc(p.scheduled_at)}</div></div>
      ${p.location ? `<div class="field"><label>地點</label><div>${esc(p.location)}</div></div>` : ''}
      <div class="field"><label>費用／名額</label><div>${fmtMoney(p.price)}　名額 ${p.capacity > 0 ? p.capacity : '不限'}</div></div>
      ${p.description ? `<div class="field"><label>說明</label><div>${esc(p.description)}</div></div>` : ''}
      ${canSignup ? `<div class="row mt"><button class="btn" id="pc-signup">代客報名</button></div>` : ''}`, body => {
      const btn = body.querySelector('#pc-signup');
      if (btn) btn.onclick = () => { closeModal(); openSignupForm(progs.filter(x => x.active !== 0), p.id); };
    });
  });
}
// 加購服務固定名稱清單（選「其他」自行輸入）
const SERVICE_NAME_OPTIONS = ['泌乳', '產後修復', '寶寶攝影', '寶寶挑片', '身體SPA', '洗頭', '寶寶游泳', '洗澡回式'];
async function openProgramForm(p, cats, onSaved) {
  const ed = p || {};
  const done = () => { closeModal(); (onSaved || viewPrograms)(); };
  // 加購服務可指定媽媽（入住中名單）：儲存時自動為該媽媽建立此服務的報名
  const mothers = (await api('/mothers')).filter(m => m.status === 'checked_in');
  const edSvcPreset = SERVICE_NAME_OPTIONS.includes(ed.name || '');
  openModal(ed.id ? '編輯課程／服務' : '新增課程／服務', `
    <div class="form-grid">
      <div class="field"><label>類型</label><select id="pg-kind">
        <option value="course" ${ed.kind === 'service' ? '' : 'selected'}>課程／活動</option>
        <option value="service" ${ed.kind === 'service' ? 'selected' : ''}>加購服務</option></select></div>
      <div class="field" id="pg-name-course-wrap"><label>名稱 *</label><input id="pg-name" value="${esc(ed.name || '')}"></div>
      <div class="field" id="pg-name-svc-wrap" style="display:none"><label>名稱 *</label>
        <select id="pg-name-svc">
          ${SERVICE_NAME_OPTIONS.map(n => `<option ${ed.name === n ? 'selected' : ''}>${n}</option>`).join('')}
          <option value="__other" ${ed.id && ed.kind === 'service' && !edSvcPreset ? 'selected' : ''}>其他（自行輸入）</option>
        </select></div>
      <div class="field" id="pg-name-other-wrap" style="display:none"><label>其他名稱 *</label><input id="pg-name-other" value="${esc(ed.kind === 'service' && !edSvcPreset ? (ed.name || '') : '')}"></div>
      <div class="field"><label>費用</label><input type="number" id="pg-price" min="0" value="${ed.price ?? 0}"></div>
      <div class="field"><label>名額（0=不限）</label><input type="number" id="pg-cap" min="0" value="${ed.capacity ?? 0}"></div>
      <div class="field"><label>時間（課程填，服務可空）</label><input id="pg-when" value="${esc(ed.scheduled_at || '')}" placeholder="2026-07-10 14:00"></div>
      <div class="field"><label>地點</label><input id="pg-loc" value="${esc(ed.location || '')}"></div>
      <div class="field" id="pg-mom-wrap" style="display:none"><label>媽媽姓名<small>（入住中；選擇後自動建立報名）</small></label>
        <select id="pg-mom"><option value="">不指定</option>${mothers.map(m => `<option value="${m.id}">${esc(m.name)}${m.room_name ? `（${esc(m.room_name)}）` : ''}</option>`).join('')}</select></div>
      <div class="field"><label><input type="checkbox" id="pg-active" ${ed.active === 0 ? '' : 'checked'}> 開放報名</label></div>
      <div class="field full"><label>說明</label><textarea id="pg-desc" rows="2">${esc(ed.description || '')}</textarea></div>
      <div class="full row"><button class="btn" id="pg-save">儲存</button>
        ${ed.id ? '<button class="btn danger" id="pg-del">刪除</button>' : ''}
        <span class="error-msg" id="pg-err"></span></div>
    </div>`, body => {
    const v = id => body.querySelector(id);
    // 類型切換：課程＝自由輸入名稱；加購服務＝固定下拉＋媽媽姓名
    const syncKind = () => {
      const isSvc = v('#pg-kind').value === 'service';
      v('#pg-name-course-wrap').style.display = isSvc ? 'none' : '';
      v('#pg-name-svc-wrap').style.display = isSvc ? '' : 'none';
      v('#pg-mom-wrap').style.display = isSvc ? '' : 'none';
      syncOther();
    };
    const syncOther = () => {
      const isSvc = v('#pg-kind').value === 'service';
      v('#pg-name-other-wrap').style.display = isSvc && v('#pg-name-svc').value === '__other' ? '' : 'none';
    };
    v('#pg-kind').onchange = syncKind;
    v('#pg-name-svc').onchange = syncOther;
    syncKind();
    v('#pg-save').onclick = async () => {
      const isSvc = v('#pg-kind').value === 'service';
      const name = isSvc
        ? (v('#pg-name-svc').value === '__other' ? v('#pg-name-other').value.trim() : v('#pg-name-svc').value)
        : v('#pg-name').value.trim();
      if (!name) { v('#pg-err').textContent = '請填寫名稱'; return; }
      const payload = { kind: v('#pg-kind').value, name,
        price: Number(v('#pg-price').value) || 0, capacity: Number(v('#pg-cap').value) || 0,
        scheduled_at: v('#pg-when').value.trim(), location: v('#pg-loc').value.trim(),
        description: v('#pg-desc').value, active: v('#pg-active').checked ? 1 : 0 };
      try {
        let progId = ed.id;
        if (ed.id) await api(`/programs/${ed.id}`, { method: 'PUT', body: payload });
        else progId = (await api('/programs', { method: 'POST', body: payload })).id;
        // 加購服務有指定媽媽 → 自動建立該媽媽的報名（待確認）
        const momId = isSvc ? Number(v('#pg-mom').value) : 0;
        if (momId) await api('/signups', { method: 'POST', body: { mother_id: momId, program_id: progId, quantity: 1 } });
        done();
      } catch (e) { v('#pg-err').textContent = e.message; }
    };
    if (ed.id) v('#pg-del').onclick = async () => {
      if (!confirm('確定刪除？（已有報名者改為停止報名）')) return;
      try { await api(`/programs/${ed.id}`, { method: 'DELETE' }); done(); }
      catch (e) { v('#pg-err').textContent = e.message; }
    };
  });
}
async function openSignupForm(progs, preselectId) {
  const members = await api('/members');
  openModal('代客報名', `
    <div class="form-grid">
      <div class="field"><label>媽媽 *</label><select id="sg-mother"><option value="">請選擇</option>${members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field"><label>項目 *</label><select id="sg-prog"><option value="">請選擇</option>${progs.map(p => `<option value="${p.id}" ${preselectId != null && p.id == preselectId ? 'selected' : ''}>${esc(p.name)}（${fmtMoney(p.price)}）</option>`).join('')}</select></div>
      <div class="field"><label>數量</label><input type="number" id="sg-qty" min="1" value="1"></div>
      <div class="field"><label>偏好時段（服務）</label><input id="sg-pref"></div>
      <div class="field full"><label>備註</label><input id="sg-note"></div>
      <div class="full row"><button class="btn" id="sg-save">建立報名</button><span class="error-msg" id="sg-err"></span></div>
    </div>`, body => {
    body.querySelector('#sg-save').onclick = async () => {
      const mother_id = Number(body.querySelector('#sg-mother').value);
      const program_id = Number(body.querySelector('#sg-prog').value);
      if (!mother_id || !program_id) { body.querySelector('#sg-err').textContent = '請選擇媽媽與項目'; return; }
      try { await api('/signups', { method: 'POST', body: { mother_id, program_id,
        quantity: Number(body.querySelector('#sg-qty').value) || 1,
        preferred_at: body.querySelector('#sg-pref').value, note: body.querySelector('#sg-note').value } });
        closeModal(); viewPrograms();
      } catch (e) { body.querySelector('#sg-err').textContent = e.message; }
    };
  });
}

/* ---------- 優惠券（管理員） ---------- */
async function viewCoupons() {
  const rows = await api('/coupons');
  main().innerHTML = `
    <div class="page-title">優惠券</div>
    <div class="card">
      <div class="row" style="justify-content:flex-end"><button class="btn small" id="cp-new">新增優惠券</button></div>
      ${filterBar({ placeholder: '搜尋優惠碼 / 名稱…', statuses: [{ val: '', label: '全部' }, { val: 'on', label: '啟用' }, { val: 'off', label: '停用' }] })}
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>優惠碼</th><th>折扣</th><th>門檻</th><th>使用</th><th>效期</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map(c => `
          <tr data-filter="${esc(c.code + ' ' + (c.name || ''))}" data-status="${c.active ? 'on' : 'off'}"${c.active ? '' : ' style="opacity:.55"'}>
            <td data-label="優惠碼"><strong>${esc(c.code)}</strong>${c.name ? `<br><small>${esc(c.name)}</small>` : ''}${c.active ? '' : ' <span class="badge gray">停用</span>'}</td>
            <td data-label="折扣">${c.discount_type === 'percent' ? `${c.discount_value}%${c.max_discount ? `（上限${fmtMoney(c.max_discount)}）` : ''}` : fmtMoney(c.discount_value)}</td>
            <td data-label="門檻">${c.min_spend ? `滿${fmtMoney(c.min_spend)}` : '無'}</td>
            <td data-label="使用">${c.used_count}${c.usage_limit ? ` / ${c.usage_limit}` : ''}</td>
            <td data-label="效期"><small>${esc(c.valid_from || '不限')} ~ ${esc(c.valid_to || '不限')}</small></td>
            <td data-label="操作"><button class="btn small secondary" data-edit="${c.id}">編輯</button> <button class="btn small danger" data-del="${c.id}">刪除</button></td>
          </tr>`).join('') : '<tr><td colspan="6"><div class="empty">尚無優惠券</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  wireFilter(main());
  main().querySelector('#cp-new').onclick = () => openCouponForm(null);
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openCouponForm(rows.find(c => c.id == b.dataset.edit)));
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除此優惠券？')) return;
    try { await api(`/coupons/${b.dataset.del}`, { method: 'DELETE' }); viewCoupons(); } catch (e) { alert(e.message); }
  });
}
function openCouponForm(c) {
  const ed = c || {};
  openModal(ed.id ? '編輯優惠券' : '新增優惠券', `
    <div class="form-grid">
      <div class="field"><label>優惠碼 *</label><input id="cf-code" value="${esc(ed.code || '')}" ${ed.id ? 'disabled' : ''} placeholder="WELCOME150"></div>
      <div class="field"><label>名稱</label><input id="cf-name" value="${esc(ed.name || '')}"></div>
      <div class="field"><label>折扣方式</label><select id="cf-type">
        <option value="amount" ${ed.discount_type === 'percent' ? '' : 'selected'}>固定金額</option>
        <option value="percent" ${ed.discount_type === 'percent' ? 'selected' : ''}>百分比</option></select></div>
      <div class="field"><label>折扣值（元 或 %）</label><input type="number" id="cf-val" min="0" value="${ed.discount_value ?? 0}"></div>
      <div class="field"><label>最低消費</label><input type="number" id="cf-min" min="0" value="${ed.min_spend ?? 0}"></div>
      <div class="field"><label>折扣上限（%用，0=不限）</label><input type="number" id="cf-max" min="0" value="${ed.max_discount ?? 0}"></div>
      <div class="field"><label>使用次數上限（0=不限）</label><input type="number" id="cf-limit" min="0" value="${ed.usage_limit ?? 0}"></div>
      <div class="field"><label>起日</label><input type="date" id="cf-from" value="${esc(ed.valid_from || '')}"></div>
      <div class="field"><label>迄日</label><input type="date" id="cf-to" value="${esc(ed.valid_to || '')}"></div>
      <div class="field"><label><input type="checkbox" id="cf-active" ${ed.active === 0 ? '' : 'checked'}> 啟用</label></div>
      <div class="full row"><button class="btn" id="cf-save">儲存</button><span class="error-msg" id="cf-err"></span></div>
    </div>`, body => {
    const v = id => body.querySelector(id);
    v('#cf-save').onclick = async () => {
      const payload = { name: v('#cf-name').value.trim(), discount_type: v('#cf-type').value,
        discount_value: Number(v('#cf-val').value) || 0, min_spend: Number(v('#cf-min').value) || 0,
        max_discount: Number(v('#cf-max').value) || 0, usage_limit: Number(v('#cf-limit').value) || 0,
        valid_from: v('#cf-from').value, valid_to: v('#cf-to').value, active: v('#cf-active').checked ? 1 : 0 };
      try {
        if (ed.id) await api(`/coupons/${ed.id}`, { method: 'PUT', body: payload });
        else { payload.code = v('#cf-code').value.trim(); await api('/coupons', { method: 'POST', body: payload }); }
        closeModal(); viewCoupons();
      } catch (e) { v('#cf-err').textContent = e.message; }
    };
  });
}

/* ---------- 會員（媽媽） ---------- */
async function viewMembers() {
  main().innerHTML = `
    <div class="page-title">會員</div>
    <div class="card no-print">
      <div class="form-grid">
        <div class="field"><label>搜尋<small>（姓名／會員編號／電話）</small></label><input id="mb-kw"></div>
        <div class="field"><label>狀態</label><select id="mb-status"><option value="">全部</option>${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="full row" style="justify-content:center"><button class="btn" id="mb-go">送出查詢</button></div>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap" id="mb-result"></div>
      <div id="mb-pager"></div>
    </div>`;
  const load = async (page = 1) => {
    const p = new URLSearchParams({ page, pageSize: PAGE_SIZE });
    if ($('#mb-kw').value.trim()) p.set('keyword', $('#mb-kw').value.trim());
    if ($('#mb-status').value) p.set('status', $('#mb-status').value);
    const { rows, total, pageSize } = await api('/members?' + p.toString());
    const base = (page - 1) * pageSize;
    $('#mb-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>會員編號</th><th>姓名</th><th>電話</th><th>點數</th><th class="no-print"></th></tr></thead>
      <tbody>${rows.length ? rows.map((m, i) => `
        <tr>
          <td data-label="筆數">${base + i + 1}</td>
          <td data-label="會員編號">${esc(m.member_no)}</td>
          <td data-label="姓名">${esc(m.name)}　<span class="badge ${STATUS_BADGE[m.status] || 'gray'}">${STATUS_LABEL[m.status] || m.status}</span></td>
          <td data-label="電話">${esc(m.phone || '-')}</td>
          <td data-label="點數"><strong>${m.points}</strong> 點</td>
          <td data-label="操作" class="no-print"><button class="btn small secondary" data-pts="${m.id}" data-name="${esc(m.name)}" data-cur="${m.points}">調整點數</button></td>
        </tr>`).join('') : '<tr><td colspan="6"><div class="empty">查無會員</div></td></tr>'}</tbody></table>`;
    $('#mb-result').querySelectorAll('[data-pts]').forEach(b => b.onclick = () => openPointsAdjust(b.dataset.pts, b.dataset.name, b.dataset.cur));
    $('#mb-pager').innerHTML = pagerBar(total, page, pageSize);
    wirePager(page, total, pageSize, load);
  };
  $('#mb-go').onclick = () => load(1);
  $('#mb-kw').onkeydown = e => { if (e.key === 'Enter') load(1); };
  load(1);
}
function openPointsAdjust(id, name, cur) {
  openModal(`調整點數：${name}（目前 ${cur} 點）`, `
    <div class="form-grid">
      <div class="field full"><label>增減點數（負數為扣除）</label><input type="number" id="pt-delta" value="0"></div>
      <div class="full row"><button class="btn" id="pt-save">確認</button><span class="error-msg" id="pt-err"></span></div>
    </div>`, body => {
    body.querySelector('#pt-save').onclick = async () => {
      try { await api(`/members/${id}/points`, { method: 'POST', body: { delta: Number(body.querySelector('#pt-delta').value) } });
        closeModal(); viewMembers();
      } catch (e) { body.querySelector('#pt-err').textContent = e.message; }
    };
  });
}

/* ---------- 帳號管理（權限分配） ---------- */
const ROLE_PRESETS = {
  '護理師': ['baby_care', 'newborn_medical', 'physician', 'mother_care', 'handover', 'incidents', 'infection', 'residents', 'rooms', 'meals', 'shifts', 'family'],
  '出納／帳務': ['billing', 'shop', 'programs'],
  '廚房': ['meals'],
  '房務清潔': ['housekeeping', 'rooms'],
  '行政': ['residents', 'rooms', 'housekeeping', 'tours', 'contracts', 'family', 'shop', 'supplies', 'programs', 'reports']
};
// 已從系統隱藏（無可見入口）的模組：不在帳號管理權限勾選中出現
const HIDDEN_PERM_MODULES = ['members', 'invoices', 'crm', 'testimonials', 'coupons', 'audit'];
async function viewUsers() {
  const [users, modules] = await Promise.all([api('/users'), api('/modules')]);
  // 勾選表單只顯示仍在使用的模組；完整清單（modules）仍用於「可用模組」欄位顯示既有權限標籤
  window._modules = modules.filter(m => !HIDDEN_PERM_MODULES.includes(m.key));
  main().innerHTML = `
    <div class="page-title">帳號管理</div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div style="font-size:.9rem;color:var(--muted)">管理員（admin）為全權帳號；其他帳號可逐一勾選可用模組。</div>
        <button class="btn small" id="u-new">新增帳號</button>
      </div>
      ${filterBar({ placeholder: '搜尋帳號 / 姓名…', statuses: [{ val: '', label: '全部' }, { val: 'admin', label: '管理員' }, { val: 'nurse', label: '員工' }] })}
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>帳號</th><th>姓名</th><th>角色</th><th>可用模組</th><th>狀態</th><th></th></tr></thead>
        <tbody>${users.map(u => `
          <tr data-filter="${esc(u.username + ' ' + u.name)}" data-status="${u.role}"${u.active ? '' : ' style="opacity:.55"'}>
            <td data-label="帳號">${esc(u.username)}</td>
            <td data-label="姓名">${esc(u.name)}</td>
            <td data-label="角色">${u.role === 'admin' ? '<span class="badge teal">管理員</span>' : '<span class="badge gray">員工</span>'}</td>
            <td data-label="可用模組" style="font-size:.82rem">${u.role === 'admin' ? '全部'
              : (u.permissions.length ? u.permissions.map(k => esc((modules.find(m => m.key === k) || {}).label || k)).join('、') : '<span style="color:var(--danger)">未授權</span>')}</td>
            <td data-label="狀態">${u.active ? '<span class="badge green">啟用</span>' : '<span class="badge gray">停用</span>'}</td>
            <td data-label="操作"><button class="btn small secondary" data-edit="${u.id}">編輯</button></td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  wireFilter(main());
  main().querySelector('#u-new').onclick = () => openUserForm(null);
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openUserForm(users.find(u => u.id == b.dataset.edit)));
}
function openUserForm(u) {
  const ed = u || {};
  const modules = window._modules || [];
  const isEdit = !!ed.id;
  const checks = modules.map(m => `<label class="perm-chk"><input type="checkbox" data-mod="${m.key}" ${(ed.permissions || []).includes(m.key) ? 'checked' : ''}> ${esc(m.label)}</label>`).join('');
  openModal(isEdit ? `編輯帳號：${ed.username}` : '新增帳號', `
    <div class="form-grid">
      <div class="field"><label>帳號 *</label><input id="u-username" value="${esc(ed.username || '')}" ${isEdit ? 'disabled' : ''}></div>
      <div class="field"><label>姓名 *</label><input id="u-name" value="${esc(ed.name || '')}"></div>
      <div class="field"><label>電話</label><input id="u-phone" value="${esc(ed.phone || '')}"></div>
      <div class="field"><label>身分證字號<small>（中衛欄位「照護人員身分證字號」自動帶入用）</small></label><input id="u-idno" maxlength="10" value="${esc(ed.id_no || '')}"></div>
      <div class="field"><label>${isEdit ? '重設密碼（留空不改）' : '密碼 *'}</label><input type="password" id="u-pw"></div>
      <div class="field"><label>角色</label><select id="u-role">
        <option value="nurse" ${ed.role === 'admin' ? '' : 'selected'}>一般員工（依下方權限）</option>
        <option value="admin" ${ed.role === 'admin' ? 'selected' : ''}>管理員（全權）</option></select></div>
      ${isEdit ? `<div class="field"><label><input type="checkbox" id="u-active" ${ed.active ? 'checked' : ''}> 啟用</label></div>` : ''}
    </div>
    <div id="u-perm-wrap">
      <div class="row" style="justify-content:space-between;align-items:center;margin:6px 0">
        <strong style="font-size:.9rem">可用模組</strong>
        <span class="row" style="gap:6px">
          ${Object.keys(ROLE_PRESETS).map(p => `<button type="button" class="btn small secondary" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}
          <button type="button" class="btn small secondary" data-preset="__none">清空</button>
        </span>
      </div>
      <div class="perm-grid">${checks}</div>
    </div>
    <div class="row" style="margin-top:10px"><button class="btn" id="u-save">儲存</button><span class="error-msg" id="u-err"></span></div>`, body => {
    const permWrap = body.querySelector('#u-perm-wrap');
    const roleSel = body.querySelector('#u-role');
    const syncRole = () => { permWrap.style.display = roleSel.value === 'admin' ? 'none' : ''; };
    roleSel.onchange = syncRole; syncRole();
    body.querySelectorAll('[data-preset]').forEach(btn => btn.onclick = () => {
      const set = btn.dataset.preset === '__none' ? [] : (ROLE_PRESETS[btn.dataset.preset] || []);
      body.querySelectorAll('[data-mod]').forEach(c => c.checked = set.includes(c.dataset.mod));
    });
    body.querySelector('#u-save').onclick = async () => {
      const permissions = [...body.querySelectorAll('[data-mod]:checked')].map(c => c.dataset.mod);
      const payload = { name: body.querySelector('#u-name').value.trim(), phone: body.querySelector('#u-phone').value.trim(),
        id_no: body.querySelector('#u-idno').value.trim(), role: roleSel.value, permissions };
      const pw = body.querySelector('#u-pw').value;
      if (pw) payload.password = pw;
      if (isEdit) payload.active = body.querySelector('#u-active').checked ? 1 : 0;
      try {
        if (isEdit) await api(`/users/${ed.id}`, { method: 'PUT', body: payload });
        else {
          payload.username = body.querySelector('#u-username').value.trim();
          if (!payload.username || !pw) { body.querySelector('#u-err').textContent = '帳號與密碼必填'; return; }
          await api('/users', { method: 'POST', body: payload });
        }
        closeModal(); viewUsers();
      } catch (e) { body.querySelector('#u-err').textContent = e.message; }
    };
  });
}

/* ---------- 員工基本資料（員工資料管理） ---------- */
const EMP_DEPTS = ['客服部', '護理部', '管理部', '膳食部', '房務部'];
const EMP_CATS = ['行政人員', '護理人員', '客服人員', '膳食人員', '嬰兒照顧員', '房務人員', '醫師', '營養師'];
const EMP_LEVELS = ['A', 'B', 'C', 'D', 'E'];
async function viewEmployees() {
  const list = await api('/employees');
  const canWrite = canAccess('#/employees');
  main().innerHTML = `
    <div class="page-title">員工基本資料 <small style="font-weight:400;color:var(--muted);font-size:.9rem">員工資料管理</small></div>
    <div class="card no-print">
      <div class="form-grid">
        <div class="field"><label>查詢關鍵字</label><input id="emp-kw"></div>
        <div class="field"><label>員工分類</label><select id="emp-cat"><option value="">全部查詢</option>${EMP_CATS.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label>員工部門</label><select id="emp-dept"><option value="">全部查詢</option>${EMP_DEPTS.map(d => `<option>${esc(d)}</option>`).join('')}</select></div>
        <div class="field full"><label>關鍵字欄位</label>
          <div class="row" style="gap:16px;padding-top:4px;flex-wrap:wrap">
            <label class="bna-chk"><input type="radio" name="emp-kf" value="name" checked> 員工姓名</label>
            <label class="bna-chk"><input type="radio" name="emp-kf" value="emp_level"> 員工等級</label>
            <label class="bna-chk"><input type="radio" name="emp-kf" value="login_level"> 員工權限</label>
            <label class="bna-chk"><input type="radio" name="emp-kf" value="id_no"> 身分證號</label>
          </div></div>
        <div class="field"><label class="bna-chk"><input type="checkbox" id="emp-resigned"> 查詢包含已離職員工</label></div>
        <div class="full row" style="gap:10px;justify-content:center">
          <button class="btn" id="emp-go">送出查詢</button>
          ${canWrite ? '<button class="btn secondary" id="emp-add">新增資料</button>' : ''}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap" id="emp-result"></div>
    </div>`;
  const render = (rows) => {
    $('#emp-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>員工姓名</th><th>員工編碼</th><th>分類/部門</th><th>等級</th><th>聯絡電話</th><th>權限</th><th>分機</th><th>員工群組</th><th>離職日期</th><th class="no-print"></th></tr></thead>
      <tbody>${rows.map((u, i) => `
        <tr>
          <td data-label="筆數">${i + 1}</td>
          <td data-label="員工姓名">${esc(u.name)}</td>
          <td data-label="員工編碼">${esc(u.username)}</td>
          <td data-label="分類/部門"><small>${esc(u.category || '—')}<br>${esc(u.department || '—')}</small></td>
          <td data-label="等級">${esc(u.emp_level || '—')}</td>
          <td data-label="聯絡電話">${esc(u.phone || '')}</td>
          <td data-label="權限">${u.login_level}</td>
          <td data-label="分機">${esc(u.ext || '')}</td>
          <td data-label="員工群組">${esc(u.emp_group || '')}</td>
          <td data-label="離職日期">${esc(u.resign_date || '')}</td>
          <td data-label="" class="no-print">${canWrite ? `<button class="btn small secondary" data-edit="${u.id}">編輯</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="11"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
    $('#emp-result').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => empForm(list.find(x => x.id == b.dataset.edit)));
  };
  const go = () => {
    const kw = $('#emp-kw').value.trim(), kf = main().querySelector('input[name="emp-kf"]:checked').value;
    const cat = $('#emp-cat').value, dept = $('#emp-dept').value, incResigned = $('#emp-resigned').checked;
    render(list.filter(u => {
      if (!incResigned && u.resign_date) return false;
      if (cat && u.category !== cat) return false;
      if (dept && u.department !== dept) return false;
      if (kw) { const v = String(kf === 'login_level' ? u.login_level : (u[kf] || '')); if (!v.includes(kw)) return false; }
      return true;
    }));
  };
  $('#emp-go').onclick = go;
  $('#emp-kw').onkeydown = e => { if (e.key === 'Enter') go(); };
  go();
  if (!canWrite) return;
  $('#emp-add').onclick = () => empForm(null);
}
function empForm(u) {
  const isNew = !u; u = u || {};
  const yn = (id, val) => `<label class="bna-chk"><input type="radio" name="${id}" value="1" ${val ? 'checked' : ''}> 是</label>
    <label class="bna-chk"><input type="radio" name="${id}" value="0" ${val ? '' : 'checked'}> 否</label>`;
  const sel = (id, opts, val) => `<select id="${id}"><option value="">--請選擇--</option>${opts.map(o => `<option ${String(val) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  openModal(`員工基本資料-${isNew ? '新增' : '編輯'}`, `
    <div class="form-grid">
      <div class="field"><label>員工姓名 <b class="req">*</b></label><input id="e-name" value="${esc(u.name || '')}"></div>
      <div class="field"><label>員工編碼 <b class="req">*</b><small>（即系統登入帳號）</small></label><input id="e-code" value="${esc(u.username || '')}" ${isNew ? '' : 'disabled'}></div>
      <div class="field"><label>身分證號</label><input id="e-idno" value="${esc(u.id_no || '')}"></div>
      <div class="field"><label>考勤卡號</label><input id="e-clock" value="${esc(u.clock_no || '')}"></div>
      <div class="field"><label>員工部門</label>${sel('e-dept', EMP_DEPTS, u.department)}</div>
      <div class="field"><label>員工群組</label><input id="e-group" value="${esc(u.emp_group || '')}"></div>
      <div class="field"><label>員工分類</label>${sel('e-cat', EMP_CATS, u.category)}</div>
      <div class="field"><label>員工等級</label>${sel('e-level', EMP_LEVELS, u.emp_level)}</div>
      <div class="field"><label>員工手機</label><input id="e-phone" value="${esc(u.phone || '')}"></div>
      <div class="field"><label>住家電話</label><input id="e-home" value="${esc(u.home_phone || '')}"></div>
      <div class="field full"><label>E-MAIL</label><input id="e-email" value="${esc(u.email || '')}"></div>
      <div class="field"><label>登入權限<small>（0 表示不可登入系統）</small></label>
        <select id="e-login">${[0, 1, 2, 3, 4, 5].map(n => `<option ${Number(u.login_level || 0) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field"><label>登入密碼<small>（${isNew ? '預設同登入帳號' : '留空不變更'}）</small></label><input type="password" id="e-pw" autocomplete="new-password"></div>
      <div class="field"><label>員工分機</label><input id="e-ext" value="${esc(u.ext || '')}"></div>
      ${isNew ? '' : `<div class="field"><label>離職日期<small>（留空＝在職）</small></label><input type="date" id="e-resign" value="${esc(u.resign_date || '')}"></div>`}
      <div class="field"><label>參觀介紹/合約經手</label><div class="row" style="gap:14px;padding-top:4px">${yn('e-tour', u.flag_tour)}</div></div>
      <div class="field"><label>媽媽出入住對點</label><div class="row" style="gap:14px;padding-top:4px">${yn('e-checkpoint', u.flag_checkpoint)}</div></div>
      <div class="field"><label>是否有營養師權限</label><div class="row" style="gap:14px;padding-top:4px">${yn('e-nutrition', u.flag_nutrition)}</div></div>
      <div class="field"><label>是否可建立護理資料</label><div class="row" style="gap:14px;padding-top:4px">${yn('e-nursing', u.flag_nursing)}</div></div>
      <div class="field"><label>是否有醫師權限</label><div class="row" style="gap:14px;padding-top:4px">${yn('e-physician', u.flag_physician)}</div></div>
      <div class="field"><label>是否為實習人員</label><div class="row" style="gap:14px;padding-top:4px">${yn('e-intern', u.flag_intern)}</div></div>
    </div>
    <small style="color:var(--muted)">＊登入權限 5＝管理員（全權）、1~4＝一般員工、0＝停用；「醫師權限／可建立護理資料」會對映到對應模組權限。</small>
    <div class="row mt"><button class="btn" id="e-save">${isNew ? '新增資料' : '存檔'}</button><span class="error-msg" id="e-err"></span></div>`, body => {
    const rv = id => (body.querySelector(`input[name="${id}"]:checked`) || {}).value === '1';
    body.querySelector('#e-save').onclick = async () => {
      const b = {
        name: body.querySelector('#e-name').value.trim(), id_no: body.querySelector('#e-idno').value.trim(),
        clock_no: body.querySelector('#e-clock').value.trim(), department: body.querySelector('#e-dept').value,
        emp_group: body.querySelector('#e-group').value.trim(), category: body.querySelector('#e-cat').value,
        emp_level: body.querySelector('#e-level').value, phone: body.querySelector('#e-phone').value.trim(),
        home_phone: body.querySelector('#e-home').value.trim(), email: body.querySelector('#e-email').value.trim(),
        login_level: body.querySelector('#e-login').value, ext: body.querySelector('#e-ext').value.trim(),
        flag_tour: rv('e-tour'), flag_checkpoint: rv('e-checkpoint'), flag_nutrition: rv('e-nutrition'),
        flag_nursing: rv('e-nursing'), flag_physician: rv('e-physician'), flag_intern: rv('e-intern')
      };
      const pw = body.querySelector('#e-pw').value;
      if (pw) b.password = pw;
      if (!isNew) b.resign_date = body.querySelector('#e-resign').value;
      if (!b.name) { body.querySelector('#e-err').textContent = '員工姓名必填'; return; }
      try {
        if (isNew) {
          b.username = body.querySelector('#e-code').value.trim();
          if (!b.username) { body.querySelector('#e-err').textContent = '員工編碼必填'; return; }
          await api('/employees', { method: 'POST', body: b });
        } else await api(`/employees/${u.id}`, { method: 'PUT', body: b });
        closeModal(); viewEmployees();
      } catch (e) { body.querySelector('#e-err').textContent = e.message; }
    };
  });
}

/* ---------- LINE／Facebook 客訊整合（CRM） ---------- */
const CRM_CH = { line: ['LINE', 'green'], facebook: ['FB', 'teal'] };
async function viewCrm() {
  const ch = window._crmCh || '';
  const data = await api('/crm/contacts' + (ch ? `?channel=${ch}` : ''));
  const chBtn = (v, l) => `<button class="btn small ${ch === v ? '' : 'secondary'}" data-ch="${v}">${l}</button>`;
  main().innerHTML = `
    <div class="page-title">LINE／FB 客訊</div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div class="row">${chBtn('', '全部')} ${chBtn('line', 'LINE')} ${chBtn('facebook', 'Facebook')}</div>
        <div style="font-size:.85rem;color:var(--muted)">
          LINE：${data.config.line ? '<span class="badge green">已設定</span>' : '<span class="badge gray">未設定</span>'}
          FB：${data.config.facebook ? '<span class="badge green">已設定</span>' : '<span class="badge gray">未設定</span>'}</div>
      </div>
      ${(!data.config.line && !data.config.facebook) ? '<p style="font-size:.83rem;color:var(--muted);margin-top:8px">尚未設定介接。請至「系統設定→LINE／Facebook」填入金鑰，並將 Webhook 指向：<code>'+location.origin+'/api/webhooks/line</code>、<code>'+location.origin+'/api/webhooks/facebook</code></p>' : ''}
      ${filterBar({ placeholder: '搜尋姓名 / 內容…', statuses: [{ val: '', label: '全部' }, { val: 'unread', label: '未讀' }, { val: 'lead', label: '潛在客戶' }, { val: 'linked', label: '已對應住戶' }] })}
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>通道</th><th>聯絡人 / 住戶</th><th>最新訊息</th><th>時間</th><th></th></tr></thead>
        <tbody>${data.contacts.length ? data.contacts.map(c => `
          <tr data-filter="${esc((c.display_name || '') + ' ' + (c.mother_name || '') + ' ' + (c.last_text || ''))}" data-status="${c.unread > 0 ? 'unread' : (c.mother_id ? 'linked' : 'lead')}">
            <td data-label="通道"><span class="badge ${CRM_CH[c.channel][1]}">${CRM_CH[c.channel][0]}</span></td>
            <td data-label="聯絡人">${esc(c.display_name || c.channel_user_id.slice(0, 10))}${c.mother_name ? `<br><small style="color:var(--primary-dark)">住戶：${esc(c.mother_name)}</small>` : '<br><small style="color:var(--accent)">潛在客戶</small>'}</td>
            <td data-label="最新訊息">${esc(c.last_text || '')}${c.unread > 0 ? ` <span class="badge red">${c.unread}</span>` : ''}</td>
            <td data-label="時間"><small>${esc((c.last_message_at || '').slice(0, 16))}</small></td>
            <td data-label="操作"><button class="btn small" data-open="${c.id}">開啟對話</button></td>
          </tr>`).join('') : '<tr><td colspan="5"><div class="empty">尚無客訊。設定 Webhook 後，LINE／FB 訊息會自動進來。</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  wireFilter(main());
  main().querySelectorAll('[data-ch]').forEach(b => b.onclick = () => { window._crmCh = b.dataset.ch; viewCrm(); });
  main().querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCrmThread(b.dataset.open));
}
async function openCrmThread(id) {
  const data = await api(`/crm/contacts/${id}`);
  const c = data.contacts ? data.contacts : data.contact;
  const mothers = await api('/mothers');
  const bubbles = data.messages.map(m => `
    <div style="margin:6px 0;text-align:${m.direction === 'out' ? 'right' : 'left'}">
      <div style="display:inline-block;max-width:82%;padding:8px 12px;border-radius:12px;background:${m.direction === 'out' ? '#cdeae4' : '#f0f0f0'}">
        <div style="font-size:.72rem;color:#888">${m.direction === 'out' ? esc(m.staff_name || '護理站') : esc(c.display_name || '客戶')}・${esc((m.created_at || '').slice(5, 16))}</div>
        ${esc(m.text)}</div></div>`).join('');
  openModal(`${CRM_CH[c.channel][0]}　${esc(c.display_name || c.channel_user_id.slice(0, 12))}`, `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
      <div>對應住戶：
        <select id="crm-link" style="max-width:200px"><option value="">（潛在客戶，未對應）</option>
          ${mothers.map(m => `<option value="${m.id}" ${c.mother_id == m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      </div>
      <button class="btn small secondary" id="crm-save-link">儲存對應</button>
    </div>
    <div style="max-height:46vh;overflow:auto;margin:8px 0;padding:8px;background:#fafcfb;border-radius:8px">${bubbles || '<div class="empty">尚無訊息</div>'}</div>
    <div class="field"><textarea id="crm-reply" rows="2" placeholder="輸入回覆，將推回 ${CRM_CH[c.channel][0]}…"></textarea></div>
    <div class="row"><button class="btn" id="crm-send">送出回覆</button><span class="error-msg" id="crm-err"></span></div>`, body => {
    body.querySelector('#crm-save-link').onclick = async () => {
      try { await api(`/crm/contacts/${id}/link`, { method: 'POST', body: { mother_id: Number(body.querySelector('#crm-link').value) || null } }); viewCrm(); }
      catch (e) { body.querySelector('#crm-err').textContent = e.message; }
    };
    body.querySelector('#crm-send').onclick = async () => {
      const text = body.querySelector('#crm-reply').value.trim();
      if (!text) return;
      body.querySelector('#crm-err').textContent = '';
      try { await api(`/crm/contacts/${id}/reply`, { method: 'POST', body: { text } }); closeModal(); openCrmThread(id); }
      catch (e) { body.querySelector('#crm-err').textContent = e.message; }
    };
  });
}

/* ---------- 房況時間軸（甘特圖） ---------- */
const TL_STATUS = { reserved: ['預約', '#fdf3d7', '#8a6d1a'], checked_in: ['入住', '#cdeae4', '#1f5f5a'], checked_out: ['已退', '#eceff0', '#6b7c79'] };
async function viewRoomTimeline() {
  const start = window._tlStart || todayStr();
  const days = window._tlDays || 30;
  const data = await api(`/room-calendar?start=${start}&days=${days}`);
  const dayList = [];
  for (let i = 0; i < data.days; i++) dayList.push(new Date(new Date(data.start).getTime() + i * 86400000).toISOString().slice(0, 10));
  const td = todayStr();
  // 每個房間：把訂房攤平成每日對應，再合併連續同訂房為 colspan
  const byRoom = {};
  for (const r of data.rooms) byRoom[r.id] = {};
  for (const b of data.bookings) {
    for (const d of dayList) if (d >= b.check_in && d < b.check_out && byRoom[b.room_id]) byRoom[b.room_id][d] = b;
  }
  const headCells = dayList.map(d => `<th class="tl-day${d === td ? ' tl-today' : ''}">${d.slice(5).replace('-', '/')}<br><small>${'日一二三四五六'[new Date(d).getDay()]}</small></th>`).join('');
  const rows = data.rooms.map(r => {
    let cells = '', i = 0;
    while (i < dayList.length) {
      const b = byRoom[r.id][dayList[i]];
      if (!b) { cells += `<td class="tl-cell${dayList[i] === td ? ' tl-today' : ''}"></td>`; i++; continue; }
      let span = 1;
      while (i + span < dayList.length && byRoom[r.id][dayList[i + span]] && byRoom[r.id][dayList[i + span]].id === b.id) span++;
      const [lbl, bg, fg] = TL_STATUS[b.status] || TL_STATUS.reserved;
      cells += `<td colspan="${span}" class="tl-book" style="background:${bg};color:${fg}" title="${esc(b.mother_name)}　${esc(b.check_in)}~${esc(b.check_out)}　${lbl}" data-book="${b.id}">${esc(b.mother_name)}<small>（${lbl}）</small></td>`;
      i += span;
    }
    return `<tr><th class="tl-room">${esc(r.name)}<br><small>${esc(r.room_type || '')}</small></th>${cells}</tr>`;
  }).join('');
  main().innerHTML = `
    <div class="page-title">房況時間軸</div>
    <div class="card no-print">
      <div class="row" style="align-items:flex-end;gap:10px">
        <div class="field" style="max-width:170px;margin:0"><label>起始日</label><input type="date" id="tl-start" value="${start}"></div>
        <div class="field" style="max-width:130px;margin:0"><label>天數</label>
          <select id="tl-days">${[14, 30, 45, 62].map(n => `<option value="${n}" ${days == n ? 'selected' : ''}>${n} 天</option>`).join('')}</select></div>
        <button class="btn secondary" id="tl-today">回到今天</button>
        <button class="btn secondary" id="tl-print">列印</button>
        <span style="font-size:.85rem;color:var(--muted)">
          <span class="badge yellow">預約</span> <span class="badge green">入住</span> <span class="badge gray">已退</span>　點訂房可看帳務</span>
      </div>
    </div>
    <div class="card" style="overflow-x:auto">
      <table class="tl-grid"><thead><tr><th class="tl-room">房間</th>${headCells}</tr></thead>
        <tbody>${rows || '<tr><td>尚無房間</td></tr>'}</tbody></table>
    </div>`;
  $('#tl-start').onchange = () => { window._tlStart = $('#tl-start').value; viewRoomTimeline(); };
  $('#tl-days').onchange = () => { window._tlDays = Number($('#tl-days').value); viewRoomTimeline(); };
  $('#tl-today').onclick = () => { window._tlStart = todayStr(); viewRoomTimeline(); };
  $('#tl-print').onclick = () => window.print();
  main().querySelectorAll('[data-book]').forEach(c => c.onclick = () => {
    if (canAccess('#/billing')) { $('#modal').onclose = () => { $('#modal').onclose = null; }; openBillingDetail(c.dataset.book); }
  });
}

/* ---------- 媽媽房況／寶寶房況看板 ---------- */
const ROOM_STATE_LABEL = { occupied: '入住中', due_out: '應退房', due_in: '今日入住', reserved: '已預約', vacant: '空房' };
const ROOM_STATE_BADGE = { occupied: 'green', due_out: 'yellow', due_in: 'teal', reserved: 'pink', vacant: 'gray' };
// 距今多久的口語化描述（給「最後餵食」「最後照護」用）
function sinceText(dt) {
  if (!dt) return '';
  const ms = Date.now() - new Date(dt.replace(' ', 'T')).getTime();
  if (isNaN(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時 ${min % 60} 分前`;
  return `${Math.floor(hr / 24)} 天前`;
}
function hoursSince(dt) {
  if (!dt) return null;
  const ms = Date.now() - new Date(dt.replace(' ', 'T')).getTime();
  return isNaN(ms) ? null : ms / 3600000;
}
// 看板卡片的狀態篩選（依 data-state / data-flag 顯示）
function wireBoardFilter(scope, gridSel) {
  const btns = [...scope.querySelectorAll('[data-board-flt]')];
  if (!btns.length) return;
  const apply = key => {
    scope.querySelectorAll(`${gridSel} [data-state]`).forEach(c => {
      const states = (c.dataset.state || '').split(' ');
      c.style.display = (key === 'all' || states.includes(key)) ? '' : 'none';
    });
    btns.forEach(b => b.classList.toggle('secondary', b.dataset.boardFlt !== key));
  };
  btns.forEach(b => b.onclick = () => apply(b.dataset.boardFlt));
  apply('all');
}

async function viewMotherRooms() {
  const data = await api('/room-status/mothers');
  const st = data.stats;
  const cards = data.rooms.map(r => {
    const occ = r.occupant, next = r.next_booking;
    const states = [r.state];
    if (occ && occ.pending_tasks > 0) states.push('has_tasks');
    if (occ && occ.need_count > 0) states.push('has_needs');
    // 前一位尚未退房、下一筆今日（含逾期）應入住：也列入「今日入住」名單
    const nextDue = occ && next && next.check_in <= data.date;
    if (nextDue) states.push('due_in');
    let body = '';
    if (occ) {
      const babyLine = (occ.babies || []).length
        ? occ.babies.map(b => `${esc(b.name)} <span class="badge ${LOCATION_BADGE[b.location] || 'gray'}" style="font-weight:400">${LOCATION_LABEL[b.location] || '-'}</span>`).join('　')
        : '<span style="color:var(--muted)">尚未登記</span>';
      body = `
        <div class="rs-name">${esc(occ.mother_name)}${occ.closed ? ' <span class="badge gray">已結案</span>' : ''}<small style="color:var(--muted);font-weight:400">　${esc(occ.phone || '')}</small></div>
        <div class="rs-stay">
          <div class="rs-bar"><i style="width:${Math.min(100, Math.round(occ.stay_day / Math.max(occ.stay_total, 1) * 100))}%"></i></div>
          <small>第 ${occ.stay_day} / ${occ.stay_total} 天（${esc(occ.check_in)} ~ ${esc(occ.check_out)}）</small>
        </div>
        <div class="rs-kv">
          ${occ.delivery_type ? `<span>生產：${esc(occ.delivery_type)}${occ.delivery_date ? `（${esc(occ.delivery_date)}）` : ''}</span>` : ''}
          <span>膳食：${esc(occ.meal_diet || '一般')}${occ.diet_notes ? `・${esc(occ.diet_notes)}` : ''}</span>
          ${occ.hk_dnd ? `<span>勿擾：${esc(occ.hk_dnd)}</span>` : ''}
          ${occ.hk_needs ? `<span>房務需求：${esc(occ.hk_needs)}</span>` : ''}
          ${occ.medical_notes ? `<span style="color:var(--danger)">醫療注意：${esc(occ.medical_notes)}</span>` : ''}
          <span>寶寶：${babyLine}</span>
          <span>今日照護 ${occ.today_care_count} 次${occ.last_care_at ? `・最後 ${fmtTime(occ.last_care_at)}（${sinceText(occ.last_care_at)}）` : ''}</span>
          ${occ.pending_tasks > 0 ? `<span class="badge yellow">待辦房務 ${occ.pending_tasks} 件</span>` : ''}
        </div>`;
    } else if (next) {
      body = `
        <div class="rs-name" style="color:var(--muted)">${r.state === 'due_in' ? '今日應入住' : '下一筆預約'}</div>
        <div class="rs-kv">
          <span>${esc(next.mother_name)}${next.phone ? `　${esc(next.phone)}` : ''}</span>
          <span>${esc(next.check_in)} ~ ${esc(next.check_out)}</span>
        </div>`;
    } else {
      body = '<div class="rs-name" style="color:var(--muted)">目前空房，無排定預約</div>';
    }
    const nextLine = occ && next
      ? `<div class="rs-next" ${nextDue ? 'style="color:var(--warn);font-weight:600"' : ''}>${nextDue ? '今日應入住' : '下一筆'}：${esc(next.mother_name)}　${esc(next.check_in)} 入住</div>` : '';
    const actions = [
      occ && canAccess('#/mother-nursing') ? `<a class="btn small" href="#/mother-nursing?m=${occ.mother_id}">媽媽護理</a>` : '',
      occ && canAccess('#/mother-intake') ? `<a class="btn small" href="#/mother-intake?m=${occ.mother_id}">入住評估表</a>` : '',
      occ && canAccess('#/mother-doctor') ? `<a class="btn small" href="#/mother-doctor?m=${occ.mother_id}">醫師巡診</a>` : '',
      occ && canAccess('#/mother-handover') ? `<a class="btn small" href="#/mother-handover?m=${occ.mother_id}">產婦交班單</a>` : '',
      occ && canAccess('#/mother-guidance') ? `<a class="btn small" href="#/mother-guidance?m=${occ.mother_id}">護理指導</a>` : '',
      occ && canAccess('#/mother-close') ? `<a class="btn small ${occ.closed ? 'secondary' : ''}" href="#/mother-close?m=${occ.mother_id}">產婦結案${occ.closed ? ' ✓' : ''}</a>` : '',
      !occ && canAccess('#/rooms') ? `<a class="btn small secondary" href="#/rooms">訂房管理</a>` : ''
    ].filter(Boolean).join('');
    return `
      <div class="room-card ${r.state}" data-state="${states.join(' ')}">
        <div class="row between" style="align-items:flex-start">
          <div><span class="rs-room">${esc(r.name)}</span><small style="color:var(--muted)">　${esc(r.room_type)}</small></div>
          <span class="badge ${ROOM_STATE_BADGE[r.state]}">${ROOM_STATE_LABEL[r.state]}</span>
        </div>
        ${body}${nextLine}
        ${actions ? `<div class="row" style="gap:6px;margin-top:10px">${actions}</div>` : ''}
      </div>`;
  }).join('');
  main().innerHTML = `
    <div class="page-title">媽媽房況</div>
    <div class="stat-grid">
      <div class="stat"><div class="num">${st.occupied}</div><div class="label">入住中</div></div>
      <div class="stat"><div class="num">${st.due_out}</div><div class="label">應退房</div></div>
      <div class="stat"><div class="num">${st.due_in}</div><div class="label">今日入住</div></div>
      <div class="stat"><div class="num" ${st.needs ? 'style="color:var(--danger)"' : ''}>${st.needs}</div><div class="label">有護理需求</div></div>
    </div>
    <div id="nr-banner"></div>
    <div class="card">
      <div class="row between" style="flex-wrap:wrap;gap:8px">
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn small" data-board-flt="all">全部</button>
          <button class="btn small secondary" data-board-flt="occupied">入住中</button>
          <button class="btn small secondary" data-board-flt="due_out">應退房</button>
          <button class="btn small secondary" data-board-flt="due_in">今日入住</button>
          <button class="btn small secondary" data-board-flt="vacant">空房</button>
          <button class="btn small secondary" data-board-flt="has_needs">有護理需求</button>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${canAccess('#/rounds-list') ? '<a class="btn small secondary" href="#/rounds-list">醫師查房清單</a>' : ''}
          ${canAccess('#/mother-intake-blank') ? '<a class="btn small secondary" href="#/mother-intake-blank">空白媽媽評估單</a>' : ''}
          <small style="color:var(--muted)">${esc(data.date)}</small>
          <button class="btn small secondary" id="rs-refresh">重新整理</button>
        </div>
      </div>
      <div class="board-grid mt" id="rs-grid">${cards || '<div class="empty">尚未建立房間</div>'}</div>
    </div>`;
  $('#rs-refresh').onclick = viewMotherRooms;
  wireBoardFilter(main(), '#rs-grid');
  loadNursingReminders('#nr-banner');
  // 快速新增房務任務
  main().querySelectorAll('[data-hk-room]').forEach(btn => {
    btn.onclick = () => openModal(`新增房務任務 — ${btn.dataset.hkLabel}`, `
      <div class="field"><label>清潔任務</label><input id="hk-task" placeholder="例如：換床單、消毒浴室"></div>
      <div class="field"><label>預定日期</label><input type="date" id="hk-date" value="${todayStr()}"></div>
      <div class="field"><label>備註</label><textarea id="hk-note"></textarea></div>
      <div class="row mt"><button class="btn" id="hk-save">建立任務</button><span class="error-msg" id="hk-err"></span></div>`, body => {
      body.querySelector('#hk-save').onclick = async () => {
        try {
          await api('/housekeeping/tasks', { method: 'POST', body: {
            room_id: btn.dataset.hkRoom, mother_id: btn.dataset.hkMom,
            task: body.querySelector('#hk-task').value,
            scheduled_for: body.querySelector('#hk-date').value,
            note: body.querySelector('#hk-note').value
          } });
          closeModal(); viewMotherRooms();
        } catch (e) { body.querySelector('#hk-err').textContent = e.message; }
      };
    });
  });
}

/* ---------- 7日內入住／7日內退房（媽媽房況分頁） ---------- */
async function viewMotherUpcoming(kind) {
  const isIn = kind === 'in';
  const title = isIn ? '7日內入住' : '7日內退房';
  const data = await api('/room-status/mother-upcoming');
  const d = data.date;
  const rows = isIn ? data.checkins : data.checkouts;
  const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const badge = r => {
    const key = isIn ? r.check_in : r.check_out;
    if (key < d) return `<span class="badge red">逾期 ${dayDiff(key, d)} 天</span>`;
    if (key === d) return isIn ? '<span class="badge teal">今日入住</span>' : '<span class="badge yellow">今日退房</span>';
    return `<span class="badge gray">${dayDiff(d, key)} 天後</span>`;
  };
  const cols = isIn
    ? ['入住日', '房號', '房型', '媽媽', '電話', '預退日', '合約天數', '狀態']
    : ['預退日', '房號', '房型', '媽媽', '電話', '入住日', '已住天數', '狀態'];
  const tr = r => {
    const total = dayDiff(r.check_in, r.check_out);
    const cells = isIn
      ? [esc(r.check_in), esc(r.room_name), esc(r.room_type), esc(r.mother_name), esc(r.phone || ''), esc(r.check_out), `${total} 天`, badge(r)]
      : [esc(r.check_out), esc(r.room_name), esc(r.room_type), esc(r.mother_name), esc(r.phone || ''), esc(r.check_in), `第 ${Math.max(1, dayDiff(r.check_in, d) + 1)} / ${total} 天`, badge(r)];
    return `<tr data-kw="${esc(`${r.mother_name} ${r.room_name} ${r.phone || ''}`.toLowerCase())}">${cells.map((c, i) => `<td data-label="${cols[i]}">${c}</td>`).join('')}</tr>`;
  };
  main().innerHTML = `
    <div class="page-title">${title} <small style="font-weight:400;color:var(--muted);font-size:.85rem">（${esc(d)} 起 7 日內，含逾期）</small></div>
    <div class="card">
      <div class="row between" style="flex-wrap:wrap;gap:8px">
        <input id="mu-kw" placeholder="搜尋姓名／房號／電話" style="max-width:240px">
        <div class="row" style="gap:6px">
          ${canAccess('#/rooms') ? '<a class="btn small secondary" href="#/rooms">訂房管理</a>' : ''}
          <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        </div>
      </div>
      <div class="table-wrap mt">
        <table class="data stack">
          <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
          <tbody id="mu-body">${rows.map(tr).join('') || `<tr><td colspan="${cols.length}"><div class="empty">未來 7 日內沒有排定${isIn ? '入住' : '退房'}</div></td></tr>`}</tbody>
        </table>
      </div>
      <div style="color:var(--muted);font-size:.85rem;margin-top:6px" id="mu-count">共 ${rows.length} 筆</div>
    </div>`;
  $('#mu-kw').oninput = () => {
    const kw = $('#mu-kw').value.trim().toLowerCase();
    let n = 0;
    main().querySelectorAll('#mu-body tr[data-kw]').forEach(trEl => {
      const show = !kw || trEl.dataset.kw.includes(kw);
      trEl.style.display = show ? '' : 'none';
      if (show) n++;
    });
    $('#mu-count').textContent = `共 ${kw ? n : rows.length} 筆`;
  };
}

/* ---------- 照護紀錄查詢（媽媽／寶寶；僅入住中） ---------- */
const CRQ_STATE = {};
async function viewCareRecordQuery(kind) {
  kind = kind === 'baby' ? 'baby' : 'mother';
  const title = kind === 'baby' ? '寶寶照護資料查詢' : '媽媽照護資料查詢';
  const st = CRQ_STATE[kind] || (CRQ_STATE[kind] = { start: todayStr().slice(0, 8) + '01', end: todayStr(), kw: '', kwtype: 'name' });
  main().innerHTML = `
    <div class="page-title">${title} <small style="font-weight:400;color:var(--muted);font-size:.85rem">（僅供查詢入住中的照護資料）</small></div>
    <div class="card">
      <div class="sec-hd">${title}（資料查詢）</div>
      <div class="form-grid" style="align-items:end">
        <div class="field"><label>查詢日期區間（起）</label><input type="date" id="crq-start" value="${esc(st.start)}"></div>
        <div class="field"><label>查詢日期區間（迄）</label><input type="date" id="crq-end" value="${esc(st.end)}"></div>
        <div class="field"><label>關鍵字查詢</label><input id="crq-kw" value="${esc(st.kw)}" placeholder="輸入媽媽姓名或房號"></div>
        <div class="field"><label>查詢欄位</label>
          <div class="row" style="gap:14px;padding-top:6px">
            <label><input type="radio" name="crq-kwtype" value="room" ${st.kwtype === 'room' ? 'checked' : ''}> 媽媽房號</label>
            <label><input type="radio" name="crq-kwtype" value="name" ${st.kwtype !== 'room' ? 'checked' : ''}> 媽媽姓名</label>
          </div></div>
        <div class="field"><label>&nbsp;</label><button class="btn" id="crq-run">送出查詢</button></div>
      </div>
    </div>
    <div class="card">
      <div class="row between" style="flex-wrap:wrap;gap:8px">
        <div class="sec-hd" style="margin:0">${title}（查詢結果）</div>
        <div class="row" style="gap:6px"><button class="btn small secondary" id="crq-print">資料列印</button><button class="btn small" id="crq-csv">匯出Excel</button></div>
      </div>
      <div id="crq-result"><div class="empty">您輸入的條件，查無資料 …</div></div>
    </div>`;
  let lastRows = [];
  const cols = [
    { key: 'time', label: '時間' }, { key: 'room', label: '房號' },
    { key: 'subject', label: kind === 'baby' ? '寶寶（媽媽）' : '媽媽' },
    { key: 'type', label: '類型' }, { key: 'detail', label: '內容' },
    { key: 'note', label: '備註' }, { key: 'nurse', label: '護理師' }
  ];
  const toRow = r => ({
    time: (r.recorded_at || '').slice(0, 16), room: r.room_name || '',
    subject: kind === 'baby' ? `${r.subject}（${r.mother_name || ''}）` : r.subject,
    type: r.type, detail: r.detail || '', note: r.note || '', nurse: r.nurse_name || ''
  });
  const run = async () => {
    st.start = $('#crq-start').value; st.end = $('#crq-end').value; st.kw = $('#crq-kw').value.trim();
    st.kwtype = (main().querySelector('input[name="crq-kwtype"]:checked') || {}).value || 'name';
    const p = new URLSearchParams({ kind });
    if (st.start) p.set('start', st.start); if (st.end) p.set('end', st.end);
    if (st.kw) { p.set('kw', st.kw); p.set('kwtype', st.kwtype); }
    const rows = await api('/care-records/query?' + p.toString());
    lastRows = rows.map(toRow);
    $('#crq-result').innerHTML = lastRows.length
      ? `<div class="table-wrap"><table class="data stack"><thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
          <tbody>${lastRows.map(r => `<tr>${cols.map(c => `<td data-label="${c.label}">${esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
         <div style="color:var(--muted);font-size:.85rem;margin-top:6px">共 ${lastRows.length} 筆</div>`
      : '<div class="empty">您輸入的條件，查無資料 …</div>';
  };
  $('#crq-run').onclick = run;
  $('#crq-kw').onkeydown = e => { if (e.key === 'Enter') run(); };
  $('#crq-print').onclick = () => { if (!lastRows.length) return alert('尚無查詢結果'); printTable(title, cols, lastRows); };
  $('#crq-csv').onclick = () => {
    if (!lastRows.length) return alert('尚無查詢結果');
    downloadCsv(`${title}_${todayStr()}.csv`, cols.map(c => c.label), lastRows.map(r => cols.map(c => r[c.key])));
  };
}

/* ---------- 護理需求（家屬入口留言；區分媽媽／寶寶；呈現如房務清潔頁，保留勿擾時間＋編輯需求） ---------- */
async function viewNursingNeeds(kind) {
  kind = kind === 'baby' ? 'baby' : kind === 'mother' ? 'mother' : 'all';
  const title = kind === 'baby' ? '寶寶護理需求' : kind === 'mother' ? '媽媽護理需求' : '護理需求';
  const data = await api('/nursing-needs');
  const reqLine = (m, who) => `
    <div class="row between" style="align-items:center;gap:6px;margin:2px 0">
      <div><span class="badge ${who === 'mother' ? 'teal' : 'gray'}">${who === 'mother' ? '媽媽' : '寶寶'}</span>
        ${who === 'baby' && m.baby_name ? `<b>${esc(m.baby_name)}</b>：` : ''}${esc(m.body)}
        <small style="color:var(--muted)">（${esc((m.created_at || '').slice(5, 16))}・${esc(m.sender_name || '')}）</small></div>
      <div class="row" style="gap:4px">
        <button class="btn small" data-reply="${m.baby_id}">回覆</button>
        <button class="btn small secondary" data-done="${m.id}">標記已處理</button>
      </div>
    </div>`;
  const cards = data.residents.map(r => {
    const showMother = kind !== 'baby';
    const showBaby = kind !== 'mother';
    const mReqs = showMother ? r.mother_requests : [];
    const bReqs = showBaby ? r.baby_requests : [];
    const hkNeeds = (r.hk_needs || '').split(',').map(s => s.trim()).filter(Boolean);
    const total = mReqs.length + bReqs.length;
    return `
      <div class="card" style="margin:0${total ? ';border-left:4px solid var(--warn)' : ''}">
        <div class="row between" style="align-items:flex-start">
          <div><strong>${esc(r.room_name || '未排房')} 房</strong>　${esc(r.mother_name)}
            ${total ? `<span class="badge red">${total}</span>` : ''}</div>
          <button class="btn small secondary" data-hk-edit="${r.mother_id}">編輯需求</button>
        </div>
        <div style="font-size:.86rem;margin-top:6px">
          <div>勿擾時間：${r.hk_dnd ? esc(r.hk_dnd) : '<span style="color:var(--muted)">未設定</span>'}</div>
          ${hkNeeds.length ? `<div style="margin-top:4px">房務需求：${hkNeeds.map(n => `<span class="badge teal">${esc(n)}</span>`).join(' ')}</div>` : ''}
          <div style="margin-top:6px">護理需求：${total ? '' : '<span style="color:var(--muted)">無待處理</span>'}</div>
          ${mReqs.map(m => reqLine(m, 'mother')).join('')}
          ${bReqs.map(m => reqLine(m, 'baby')).join('')}
        </div>
      </div>`;
  }).join('') || '<div class="empty">目前無入住中住客</div>';
  const pendingCount = data.residents.reduce((s, r) =>
    s + (kind !== 'baby' ? r.mother_requests.length : 0) + (kind !== 'mother' ? r.baby_requests.length : 0), 0);
  // 待辦護理需求：家屬送出的未處理需求條列（跨住客、新到舊），處理完即從清單消失
  const todos = data.residents.flatMap(r =>
    [...(kind !== 'baby' ? r.mother_requests.map(m => ({ ...m, who: 'mother' })) : []),
     ...(kind !== 'mother' ? r.baby_requests.map(m => ({ ...m, who: 'baby' })) : [])]
      .map(m => ({ ...m, room_name: r.room_name, mother_name: r.mother_name })))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const todoLines = todos.map(m => `
    <div class="row between" style="align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line,#eee)">
      <div><small style="color:var(--muted)">${esc((m.created_at || '').slice(5, 16))}</small>
        　<b>${esc(m.room_name || '未排房')}</b>　${esc(m.mother_name)}
        <span class="badge ${m.who === 'mother' ? 'teal' : 'gray'}">${m.who === 'mother' ? '媽媽' : '寶寶'}</span>
        ${m.who === 'baby' && m.baby_name ? `<b>${esc(m.baby_name)}</b>：` : ''}${esc(m.body)}
        <small style="color:var(--muted)">（${esc(m.sender_name || '')}）</small></div>
      <div class="row" style="gap:4px;flex-shrink:0">
        <button class="btn small secondary" data-reply="${m.baby_id}">回覆</button>
        <button class="btn small" data-done="${m.id}">完成</button>
      </div>
    </div>`).join('');
  main().innerHTML = `
    <div class="page-title">${title} <small style="font-weight:400;color:var(--muted);font-size:.85rem">來源：家屬入口留言</small></div>
    <div class="card">
      <div class="row between" style="flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">住客需求（入住中 ${data.residents.length} 位）　<span class="badge ${pendingCount ? 'red' : 'green'}">待處理 ${pendingCount}</span></h3>
        <button class="btn small secondary" id="nn-refresh">重新整理</button>
      </div>
      <p style="font-size:.8rem;color:var(--muted);margin:6px 0 10px">家屬於「家屬入口」送出留言後，會依媽媽／寶寶顯示在此；可設定勿擾時間、回覆或標記已處理。</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px">${cards}</div>
    </div>
    <div class="card">
      <div class="row between" style="flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">待辦護理需求　<span class="badge ${todos.length ? 'red' : 'green'}">${todos.length} 件</span></h3>
        <small style="color:var(--muted)">${esc(data.date)}</small>
      </div>
      <p style="font-size:.8rem;color:var(--muted);margin:6px 0 4px">家屬送出的護理需求依時間條列於此，按「完成」即從清單移除；清單每日隨最新留言更新。</p>
      ${todoLines || '<div class="empty">目前沒有待辦護理需求</div>'}
    </div>`;
  const refresh = () => viewNursingNeeds(kind);
  $('#nn-refresh').onclick = refresh;
  main().querySelectorAll('[data-hk-edit]').forEach(b => b.onclick = () =>
    openHkNeedsForm(data.residents.find(r => String(r.mother_id) === b.dataset.hkEdit), refresh));
  main().querySelectorAll('[data-reply]').forEach(b => b.onclick = async () => {
    const text = prompt('回覆家屬：', '');
    if (text === null || !text.trim()) return;
    try { await api(`/family-messages/${b.dataset.reply}/reply`, { method: 'POST', body: { body: text.trim() } }); refresh(); }
    catch (e) { alert(e.message); }
  });
  main().querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
    try { await api(`/family-messages/msg/${b.dataset.done}/read`, { method: 'POST', body: {} }); refresh(); }
    catch (e) { alert(e.message); }
  });
}

// 護理提醒橫幅（本班護理紀錄未完成／衛教未完成／家屬護理需求未處理），看板與儀表板共用
async function loadNursingReminders(sel) {
  const box = document.querySelector(sel); if (!box) return;
  let d; try { d = await api('/nursing-reminders'); } catch (e) { return; }
  const ri = d.records_incomplete, ep = d.edu_pending, nn = d.nursing_needs;
  const mri = d.mother_records_incomplete || [];
  const eduCount = ep.reduce((s, m) => s + m.items.length, 0);
  if (!ri.length && !mri.length && !eduCount && !nn.length) {
    box.innerHTML = `<div class="card"><h3 style="margin:0">護理提醒（${esc(d.shift)}班）</h3><div class="empty">目前沒有待辦提醒 ✓</div></div>`;
    return;
  }
  box.innerHTML = `<div class="card" style="border-left:4px solid var(--warn)">
    <h3 style="margin:0 0 8px">護理提醒（${esc(d.shift)}班・${esc(d.date)}）</h3>
    <details ${ri.length ? 'open' : ''}><summary style="cursor:pointer;font-weight:600">本班寶寶護理紀錄未完成　<span class="badge ${ri.length ? 'red' : 'green'}">${ri.length}</span></summary>
      <div style="margin:6px 0 10px">${ri.length ? ri.map(b => `<div style="padding:2px 0">${esc(b.room_name || '')}　${esc(b.baby_name)}（媽媽 ${esc(b.mother_name)}）${canAccess('#/baby-nursing') ? ` <a class="btn small secondary" href="#/baby-nursing?b=${b.baby_id}">去記錄</a>` : ''}</div>`).join('') : '<div class="empty">全部完成</div>'}</div></details>
    <details ${mri.length ? 'open' : ''}><summary style="cursor:pointer;font-weight:600">媽媽護理紀錄未完成　<span class="badge ${mri.length ? 'red' : 'green'}">${mri.length}</span></summary>
      <div style="margin:6px 0 10px">${mri.length ? mri.map(m => `<div style="padding:2px 0">${esc(m.room_name || '')}　${esc(m.mother_name)}${canAccess('#/mother-nursing') ? ` <a class="btn small secondary" href="#/mother-nursing?m=${m.mother_id}">去記錄</a>` : ''}</div>`).join('') : '<div class="empty">全部完成</div>'}</div></details>
    <details ${eduCount ? 'open' : ''}><summary style="cursor:pointer;font-weight:600">衛教未完成　<span class="badge ${eduCount ? 'yellow' : 'green'}">${eduCount}</span></summary>
      <div style="margin:6px 0 10px">${ep.length ? ep.map(m => `<div style="margin:4px 0"><b>${esc(m.room_name || '')}　${esc(m.mother_name)}</b>（入住第 ${m.day} 天）
        ${m.items.map(it => `<div class="row" style="gap:6px;align-items:center;margin:2px 0 2px 8px"><span class="badge gray">第${it.day}天</span> ${esc(it.item)} <button class="btn small" data-edu-done="${m.mother_id}|${it.day}|${esc(it.item)}">標記完成</button></div>`).join('')}</div>`).join('') : '<div class="empty">全部完成</div>'}</div></details>
    <details ${nn.length ? 'open' : ''}><summary style="cursor:pointer;font-weight:600">家屬護理需求未處理　<span class="badge ${nn.length ? 'red' : 'green'}">${nn.length}</span></summary>
      <div style="margin:6px 0 2px">${nn.length ? nn.map(n => `<div style="padding:2px 0">${esc(n.room_name || '')}　${esc(n.baby_name)}（${esc(n.mother_name)}）：<small style="color:var(--muted)">${esc((n.last_body || '').slice(0, 40))}</small> <span class="badge red">${n.unread}</span>${canAccess('#/nursing-needs') ? ` <a class="btn small secondary" href="#/nursing-needs">前往處理</a>` : ''}</div>`).join('') : '<div class="empty">無</div>'}</div></details>
  </div>`;
  box.querySelectorAll('[data-edu-done]').forEach(b => b.onclick = async () => {
    const [mid, day, ...rest] = b.dataset.eduDone.split('|'); const item = rest.join('|');
    try { await api('/edu-records', { method: 'POST', body: { mother_id: Number(mid), edu_day: Number(day), item } }); loadNursingReminders(sel); }
    catch (e) { alert(e.message); }
  });
}
async function viewBabyRooms() {
  const data = await api('/room-status/babies');
  const st = data.stats;
  const feedGap = parseFloat(SETTINGS.feed_interval_hours) || 3;
  const tempHigh = parseFloat(SETTINGS.temp_high) || 37.5;
  const tempLow = parseFloat(SETTINGS.temp_low) || 36.0;
  const jaundiceAlert = parseFloat(SETTINGS.jaundice_alert) || 13;
  const canCare = canAccess('#/baby-care');
  const renderBabyCard = (b) => {
    const feedHrs = hoursSince(b.last_feed_at);
    const feedOver = feedHrs != null && feedHrs >= feedGap;
    const tempAbn = b.last_temp != null && (b.last_temp >= tempHigh || b.last_temp <= tempLow);
    const jaunAbn = b.last_jaundice != null && b.last_jaundice >= jaundiceAlert;
    const hasAlert = feedOver || tempAbn || jaunAbn;
    const states = [b.location];
    if (hasAlert) states.push('alert');
    const genderTag = b.gender === 'male' ? '<span style="color:#3b78c2">♂</span>' : b.gender === 'female' ? '<span style="color:var(--accent)">♀</span>' : '';
    const feedText = b.last_feed_at
      ? `${fmtTime(b.last_feed_at)}（${sinceText(b.last_feed_at)}）${esc(b.last_feed_method || '')}${b.last_feed_ml ? ` ${b.last_feed_ml}ml` : ''}`
      : '今日尚無紀錄';
    const genderCls = b.gender === 'male' ? 'male' : b.gender === 'female' ? 'female' : 'none';
    return `
      <div class="bbc ${hasAlert ? 'alert' : ''}" data-state="${states.join(' ')}">
        <div class="bbc-head ${genderCls}">
          <span>${esc(b.room_name || b.mother_name)}</span>
          <small>${LOCATION_LABEL[b.location] || '狀態'}</small>
        </div>
        <div class="bbc-body loc-${b.location}">
          <div style="font-weight:700;font-size:1.02rem">${esc(b.name)} ${genderTag}
            ${b.age_days != null ? `<small style="color:var(--muted);font-weight:400">　出生 ${b.age_days} 天</small>` : ''}
            ${b.closed ? ' <span class="badge gray">已結案</span>' : ''}</div>
          <div class="rs-kv" style="margin-top:6px">
            <span>媽媽：${esc(b.mother_name)}${b.room_name ? `（${esc(b.room_name)}）` : ''}</span>
            <span class="${feedOver ? 'rs-alert' : ''}">最後餵食：${feedText}${feedOver ? `　⚠ 已逾 ${feedGap} 小時` : ''}</span>
            <span>今日餵食 ${b.feed_count} 次・尿布 濕${b.diaper_wet}／便${b.diaper_stool}</span>
            <span class="${tempAbn ? 'rs-alert' : ''}">體溫：${b.last_temp != null ? `${b.last_temp}°C（${fmtTime(b.last_temp_at)}）${tempAbn ? ' ⚠' : ''}` : '—'}</span>
            <span class="${jaunAbn ? 'rs-alert' : ''}">黃疸：${b.last_jaundice != null ? `${b.last_jaundice} mg/dL${jaunAbn ? ' ⚠' : ''}` : '—'}</span>
            <span>體重：${b.last_weight != null ? `${b.last_weight} g` : (b.birth_weight_g ? `出生 ${b.birth_weight_g} g` : '—')}</span>
            <span>臍帶：${b.cord ? esc(b.cord) : '—'}${b.last_assess_at ? `<small style="color:var(--muted)">（護理評估 ${esc(b.last_assess_at.slice(5))}）</small>` : ''}</span>
            ${b.moved_at ? `<span style="color:var(--muted)">位置異動：${esc(b.moved_at.slice(5, 16))}</span>` : ''}
            ${b.notes ? `<span style="color:var(--muted)">備註：${esc(b.notes)}</span>` : ''}
          </div>
        </div>
        ${canCare ? `<div class="bbc-foot">
          <div class="row" style="gap:6px;flex-wrap:wrap">
            <a class="btn small" href="#/baby-nursing?b=${b.id}">寶寶護理</a>
            <a class="btn small" href="#/baby-eval?b=${b.id}">寶寶評估單</a>
            ${canAccess('#/baby-doctor') ? `<a class="btn small" href="#/baby-doctor?b=${b.id}">醫師巡診</a>` : ''}
            <a class="btn small" href="#/baby-handover?b=${b.id}">新生兒交班單</a>
            <a class="btn small ${b.closed ? 'secondary' : ''}" href="#/baby-close?b=${b.id}">產後嬰兒結案${b.closed ? ' ✓' : ''}</a>
            ${canAccess('#/mother-guidance') ? `<a class="btn small" href="#/mother-guidance?m=${b.mother_id}">衛教指導</a>` : ''}
            <a class="btn small secondary" href="#/baby-care">寶寶照護</a>
          </div>
          <div class="row" style="gap:6px;align-items:center;margin-top:6px">
            <small style="color:var(--muted)">狀態切換：</small>
            <select data-loc-sel="${b.id}" data-name="${esc(b.name)}" data-loc="${b.location}" style="width:auto;padding:4px 8px;font-size:.85rem">
              ${['nursery', 'rooming', 'isolation', 'out', 'hospital'].map(l => `<option value="${l}" ${b.location === l ? 'selected' : ''}>${LOCATION_LABEL[l]}</option>`).join('')}
            </select>
          </div>
        </div>` : ''}
      </div>`;
  };
  // 依房號排序（同房雙胞胎相鄰），再依樓層（房號開頭字元）分組，每樓一區塊、每排 5 房
  const sortedBabies = [...data.babies].sort((a, z) =>
    String(a.room_name || 'zzz').localeCompare(String(z.room_name || 'zzz'), 'zh-Hant', { numeric: true }) || a.id - z.id);
  const floors = {};
  for (const b of sortedBabies) { const fl = String(b.room_name || '')[0] || '其他'; (floors[fl] = floors[fl] || []).push(b); }
  const natCmp = (a, z) => String(a).localeCompare(String(z), 'zh-Hant', { numeric: true });
  const cards = Object.keys(floors).sort(natCmp).map(fl => {
    // 每樓再以「房」為單位：一格＝一房，同房雙胞胎併在同一格內（上下並列），不佔用第二個房位
    const byRoom = {};
    for (const b of floors[fl]) { const rn = b.room_name || '（未排房）'; (byRoom[rn] = byRoom[rn] || []).push(b); }
    const roomCells = Object.keys(byRoom).sort(natCmp)
      .map(rn => `<div class="bbc-room">${byRoom[rn].map(renderBabyCard).join('')}</div>`).join('');
    return `<div class="bbc-floor">${/^\d/.test(fl) ? fl + ' 樓' : esc(fl)}</div>
      <div class="bbc-grid">${roomCells}</div>`;
  }).join('');
  const alertRows = data.alerts.map(a => `
    <tr><td data-label="時間">${esc(fmtTime(a.recorded_at))}</td>
      <td data-label="寶寶">${esc(a.baby_name)}</td>
      <td data-label="項目">${BABY_TYPE_LABEL[a.record_type] || a.record_type}</td>
      <td data-label="數值" style="color:var(--danger);font-weight:600">${esc(alertDetail(a))}</td></tr>`).join('');
  const dueInRows = (data.due_in || []).map(b => `
    <tr>
      <td data-label="預計入住">${esc(b.arrive_date)}${b.arrive_date < data.date ? ' <span class="badge red">逾期</span>' : ''}</td>
      <td data-label="房號">${esc(b.room_name || '—')}</td>
      <td data-label="寶寶">${esc(b.name)}</td>
      <td data-label="性別">${b.gender === 'male' ? '<span style="color:#3b78c2">男</span>' : b.gender === 'female' ? '<span style="color:var(--accent)">女</span>' : '—'}</td>
      <td data-label="媽媽">${esc(b.mother_name)}</td>
      <td data-label="出生日期">${esc(b.birth_date || '—')}</td>
      <td data-label="出生體重">${b.birth_weight_g ? `${b.birth_weight_g} g` : '—'}</td>
      <td data-label="狀態">${b.booking_status === 'reserved' ? '隨媽媽入住' : `媽媽已在住（寶寶${LOCATION_LABEL[b.location] || '—'}）`}</td>
    </tr>`).join('');
  main().innerHTML = `
    <div class="page-title">寶寶房況</div>
    <div class="stat-grid">
      <div class="stat"><div class="num">${st.total}</div><div class="label">在住寶寶</div></div>
      <div class="stat"><div class="num" style="color:${st.due_in ? 'var(--warn)' : 'var(--primary)'}">${st.due_in || 0}</div><div class="label">今日入住</div></div>
      <div class="stat"><div class="num">${st.nursery}</div><div class="label">嬰兒室</div></div>
      <div class="stat"><div class="num">${st.rooming}</div><div class="label">親子同室</div></div>
      <div class="stat"><div class="num" style="color:${st.isolation ? 'var(--warn)' : 'var(--primary)'}">${st.isolation}</div><div class="label">隔離室</div></div>
      <div class="stat"><div class="num">${st.out}</div><div class="label">不在館內</div></div>
      <div class="stat"><div class="num" style="color:${st.hospital ? 'var(--danger)' : 'var(--primary)'}">${st.hospital}</div><div class="label">住院中</div></div>
      <div class="stat"><div class="num" style="color:${st.alerts ? 'var(--danger)' : 'var(--primary)'}">${st.alerts}</div><div class="label">今日異常紀錄</div></div>
    </div>
    <div id="nr-banner"></div>
    ${dueInRows ? `
    <div class="card">
      <h3>今日入住寶寶 <span class="badge yellow">${(data.due_in || []).length}</span></h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>預計入住</th><th>房號</th><th>寶寶</th><th>性別</th><th>媽媽</th><th>出生日期</th><th>出生體重</th><th>狀態</th></tr></thead>
        <tbody>${dueInRows}</tbody></table></div>
    </div>` : ''}
    ${data.alerts.length ? `
    <div class="card">
      <h3>今日異常照護紀錄</h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>時間</th><th>寶寶</th><th>項目</th><th>數值</th></tr></thead>
        <tbody>${alertRows}</tbody></table></div>
    </div>` : ''}
    <div class="card">
      <div class="row between" style="flex-wrap:wrap;gap:8px">
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn small" data-board-flt="all">全部</button>
          <button class="btn small secondary" data-board-flt="nursery">嬰兒室</button>
          <button class="btn small secondary" data-board-flt="rooming">親子同室</button>
          <button class="btn small secondary" data-board-flt="isolation">隔離室</button>
          <button class="btn small secondary" data-board-flt="out">不在館內</button>
          <button class="btn small secondary" data-board-flt="hospital">住院中</button>
          <button class="btn small secondary" data-board-flt="alert">有警示</button>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${canAccess('#/baby-care-query') ? '<a class="btn small secondary" href="#/baby-care-query">寶寶照護紀錄查詢</a>' : ''}
          ${canAccess('#/baby-needs') ? '<a class="btn small secondary" href="#/baby-needs">寶寶護理需求</a>' : ''}
          <small style="color:var(--muted)">${esc(data.date)}</small>
          <button class="btn small secondary" id="bs-refresh">重新整理</button>
        </div>
      </div>
      <div class="row" style="gap:6px 16px;flex-wrap:wrap;margin-top:8px;font-size:.88rem;color:var(--muted)">
        ${BABY_LEGEND.map(([label, color]) => `<span><i class="legend-sq" style="background:${color}"></i>${label}</span>`).join('')}
      </div>
      <div class="mt" id="bs-grid">${cards || '<div class="empty">目前沒有在住寶寶</div>'}</div>
    </div>`;
  $('#bs-refresh').onclick = viewBabyRooms;
  wireBoardFilter(main(), '#bs-grid');
  loadNursingReminders('#nr-banner');
  // 狀態切換（嬰兒室／親子同室／隔離室／不在館內；留存異動紀錄）
  main().querySelectorAll('[data-loc-sel]').forEach(sel => {
    sel.onchange = async () => {
      const target = sel.value;
      const note = prompt(`確認將「${sel.dataset.name}」改為「${LOCATION_LABEL[target]}」，可填備註（可留空）`, '');
      if (note === null) { sel.value = sel.dataset.loc; return; }
      try {
        await api(`/babies/${sel.dataset.locSel}/location`, { method: 'PUT', body: { location: target, note } });
        viewBabyRooms();
      } catch (e) { alert(e.message); sel.value = sel.dataset.loc; }
    };
  });
}

/* ---------- 媽媽護理（中衛日常評估欄位） ---------- */
const MNA_OPTS = {
  uterus: ['硬', '可', '差'],
  lochia_amount: ['無', '少', '中', '多'],
  lochia_color: ['鮮紅', '暗紅', '漿液', '白色'],
  yn: ['無', '有'],
  wound: ['無傷口', '乾燥完整', '紅腫', '滲液', '其他'],
  breast: ['柔軟', '腫脹', '硬塊'],
  milk: ['無', '少', '中', '多'],
  bf_skill: ['佳', '尚可', '差', '未執行'],
  mental: ['佳', '平穩', '疲倦', '焦慮', '低落'],
  activity: ['佳', '正常', '差']
};
// 家庭功能評估 APGAR：5 題，經常 2／有時 1／幾乎沒有 0
const APGAR_ITEMS = [
  ['我滿意於當我遇到困難時，可以求助於家人。', '適應度 Adaptation'],
  ['我滿意於家人和我討論事情及分擔問題的方式。', '合作度 Partnership'],
  ['我滿意於當我希望從事新活動，或是有新的發展方向時，家人能接受並給予支持。', '成長度 Growth'],
  ['我滿意於當家人對我表達情感的方式，以及對我的情緒(如憤怒、悲傷、愛)的反應。', '情感度 Affection'],
  ['我滿意於家人與我共處的方式。', '融洽度 Resolve']
];
// 愛丁堡產後憂鬱量表 EPDS：10 題，每題選項獨立（[標籤, 分數] 依顯示順序）
const EPDS_ITEMS = [
  ['您能看到事物有趣的一面，並笑得開心', [['同以前一樣', 0], ['沒有以前那麼多', 1], ['肯定比以前少', 2], ['完全不能', 3]]],
  ['您欣然期待未來的一切', [['同以前一樣', 0], ['沒有以前那麼多', 1], ['肯定比以前少', 2], ['完全不能', 3]]],
  ['當事情出錯時，您會不必要地責備自己', [['大部分時候這樣', 3], ['有時候這樣', 2], ['不經常這樣', 1], ['沒有這樣', 0]]],
  ['你無緣無故感到焦慮和擔心', [['一點也沒有', 0], ['極少有', 1], ['有時候這樣', 2], ['經常這樣', 3]]],
  ['您無緣無故感到害怕和驚慌', [['相當多時候這樣', 3], ['有時候這樣', 2], ['不經常這樣', 1], ['一點也沒有', 0]]],
  ['很多事情衝著您來時，使您透不過氣', [['大多數時候您都不能應付', 3], ['有時候您不能像平時那樣應付的好', 2], ['大部分時候您都能像平時那樣應付的好', 1], ['您一直都能應付的好', 0]]],
  ['您很不開心，以致失眠', [['大部分時候這樣', 3], ['有時候這樣', 2], ['不經常這樣', 1], ['一點也沒有', 0]]],
  ['您感到難過和悲傷', [['大部分時候這樣', 3], ['相當時候這樣', 2], ['不經常這樣', 1], ['一點也沒有', 0]]],
  ['您不開心到哭泣', [['大部分時候這樣', 3], ['有時候這樣', 2], ['只是偶爾這樣', 1], ['沒有這樣', 0]]],
  ['您想過要傷害自己', [['相當多時候這樣', 3], ['有時候這樣', 2], ['很少這樣', 1], ['沒有這樣', 0]]]
];
const EPDS_RESULTS = ['正常', '再觀察，一週後重新做一次評估', '建議接受進一步情緒障礙評估'];
// 母乳認知與支持系統評估：完整問卷選項
const BFAW = {
  src: ['醫療院所', '本中心', '其他機構', '媒體廣告', '衛生所', '親友'],
  method: ['衛教單張', '醫護人員口頭衛教', '海報、報章雜誌', '電視', '錄影帶', '網路', '其他'],
  benefits: ['母乳含有寶寶需要的所有營養份', '容易消化', '預防腸炎', '提高寶寶免疫力', '減少媽媽缺鐵性貧血',
    '促進子宮收縮', '促進親子關係發展', '減少卵巢癌、乳癌的發生', '經濟省錢', '減少垃圾，比較環保'],
  this_feed: ['純母乳哺餵', '混合哺餵', '純配方奶哺餵', '未決定'],
  prev_feed: ['純母乳哺餵', '混合哺餵', '純配方奶哺餵'],
  r_staff: ['未獲得醫護人員的鼓勵與支持', '醫療環境不支持，醫護人員沒有指導', '其他'],
  r_mom: ['覺得乳汁不足', '覺得母奶不夠營養', '乳頭疼痛破皮', '乳頭較短/凹陷', '脹奶痛', '會影響身材/乳房下垂',
    '使用藥物', '產後/剖腹產傷口痛', '上一胎哺餵母乳經驗不佳', '不知道如何哺餵', '太累', '健康不佳', '其他'],
  r_baby: ['寶寶不會吸', '寶寶不想吃/嗜睡', '經醫師診斷寶寶不宜吃母奶', '其他'],
  r_social: ['親友多是哺餵配方奶', '外出時不方便', '家人不贊成', '產後必須工作', '家人擔心寶寶太黏媽媽'],
  cohab: ['先生', '兒女', '父母', '公婆', '祖父母', '兄弟姊妹', '其他親戚', '朋友', '其他'],
  family_view: ['贊成', '支持,但不勉強', '不贊成'],
  helpers: ['2位以上', '1位', '無'],
  helpless: ['時常', '偶爾', '幾乎沒有']
};
const SCALE_LABEL = { apgar: '家庭功能評估', epds: '愛丁堡憂鬱量表', bf_awareness: '母乳認知與支持系統評估' };

function mnaSel(id, opts, { req = true } = {}) {
  return `<select id="${id}" ${req ? 'data-req' : ''}><option value="">請選擇</option>${opts.map(o => `<option>${esc(o)}</option>`).join('')}</select>`;
}
function mnaBreastBlock(side, label) {
  return `
    <div class="field"><label>${label}乳房狀態 <b class="req">*</b></label>${mnaSel(`mna-br-${side}`, MNA_OPTS.breast)}</div>
    <div class="field"><label>${label}乳房泌乳量 <b class="req">*</b></label>${mnaSel(`mna-br-${side}-milk`, MNA_OPTS.milk)}</div>
    <div class="field"><label>${label}乳房乳腺炎 <b class="req">*</b></label>${mnaSel(`mna-br-${side}-mast`, MNA_OPTS.yn)}</div>`;
}

/* 媽媽量表填寫（家庭功能 APGAR／愛丁堡 EPDS／母乳認知），供媽媽護理與入住評估表共用 */
function openMotherScale(ctx, kind, onSaved) {
  const { momId, mother, baby_info } = ctx;
  // 量表：家庭功能 APGAR／愛丁堡憂鬱 EPDS／母乳認知與支持系統評估（完整問卷）
  const chkRow = (name, opts, otherIdx = -1, otherId = '') => opts.map((o, i) =>
    `<label class="bna-chk"><input type="checkbox" data-bfck="${name}" value="${esc(o)}"> ${esc(o)}</label>${i === otherIdx ? `<input id="${otherId}" maxlength="100" style="width:180px">` : ''}`).join(' ');
  const rdRow = (name, opts) => opts.map(o =>
    `<label class="bna-chk"><input type="radio" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join(' ');
  const openScale = kind => {
    let bodyHtml = '';
    if (kind === 'apgar') {
      bodyHtml = `<div style="font-size:.9rem;color:var(--muted);margin-bottom:8px">
        房號：${esc(mother.room_name || '—')}　${esc(mother.name)}　身分證：${esc(mother.id_no || '—')}　入住：${esc(mother.check_in || '—')}</div>
        <div class="field" style="max-width:200px"><label>填表日期</label><input type="date" id="sc-date" value="${todayStr()}"></div>
        <table class="data" style="margin-top:8px">
        <thead><tr><th>家庭功能評估 APGAR</th><th>經常</th><th>有時</th><th>幾乎沒有</th></tr></thead>
        <tbody>${APGAR_ITEMS.map(([q, sub], i) => `
          <tr><td style="white-space:normal">${esc(q)}<br><small style="color:var(--danger)">（${esc(sub)}）</small></td>
            ${[2, 1, 0].map(val => `<td style="text-align:center"><input type="radio" name="sc-q${i}" value="${val}"></td>`).join('')}</tr>`).join('')}
        </tbody></table>
        <div style="margin-top:8px;font-size:.92rem">評估結果　總分：<b id="sc-total">—</b> 分<small style="color:var(--muted)">（7~10 家庭功能良好；4~6 中度障礙；0~3 重度障礙）</small></div>`;
    } else if (kind === 'epds') {
      bodyHtml = `
        <div style="text-align:center;font-weight:700">產後護理之家<br><span style="font-weight:500">產後憂鬱評量表</span></div>
        <div class="row" style="gap:8px 18px;flex-wrap:wrap;align-items:center;font-size:.92rem;margin:8px 0">
          <span>房號：${esc(mother.room_name || '—')}</span><span>姓名：${esc(mother.name)}</span>
          <span>年齡：<input id="sc-age" type="number" min="0" max="99" style="width:70px"></span>
          <span>填表日期：<input type="date" id="sc-date" value="${todayStr()}" style="width:auto"></span>
        </div>
        <div style="font-size:.88rem;margin:6px 0"><b>最近一週心情感受</b><br>
          這是要瞭解<u>過去七天內</u>您的心理感受，請選最能描述您心情的感覺，並在每題後面符合的數字上打「V」，沒有所謂的正確答案。</div>
        ${EPDS_ITEMS.map(([q, opts], i) => `
          <div class="field" style="margin-bottom:8px"><label>${i + 1}、${esc(q)}</label>
            <div class="row" style="gap:6px 14px;flex-wrap:wrap">${opts.map(([label, score]) =>
              `<label class="bna-chk" style="white-space:normal"><input type="radio" name="sc-q${i}" value="${score}"> ${esc(label)}</label>`).join('')}</div></div>`).join('')}
        <div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin:8px 0;font-size:.9rem">
          <div>總分：<b id="sc-total">—</b> 分</div>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;margin-top:6px">${EPDS_RESULTS.map(r =>
            `<label class="bna-chk" style="white-space:normal"><input type="radio" name="sc-result" value="${esc(r)}"> ${esc(r)}</label>`).join('')}</div>
          <div style="color:var(--muted);text-align:center;margin-top:8px;font-size:.85rem">
            您是我們最願意服務的對象..您的喜怒哀樂，是我們最關心的...您的聲音，是我們最願意傾聽的..<br>
            如果您需要我們的幫助...請別忘了------ 我們在您身邊。</div>
        </div>`;
    } else {
      const bi = baby_info || {};
      const ro = v => `<input value="${esc(v || '')}" disabled>`;
      bodyHtml = `
        <div style="text-align:center;font-weight:700;margin-bottom:8px">產後護理之家 -- 母乳認知與支持系統評估</div>
        <div class="field" style="max-width:200px"><label>填表日期</label><input type="date" id="sc-date" value="${todayStr()}"></div>
        <h3 style="font-size:.95rem;color:var(--primary-dark);margin:10px 0 6px">基本資料</h3>
        <div class="form-grid">
          <div class="field"><label>姓名</label>${ro(mother.name)}</div>
          <div class="field"><label>房號</label>${ro(mother.room_name)}</div>
          <div class="field"><label>入住期間</label>${ro(mother.check_in)}</div>
          <div class="field"><label>慣用語言</label><input id="bf-language" maxlength="30"></div>
          <div class="field"><label>孕產史</label><input id="bf-ob" maxlength="100"></div>
          <div class="field"><label>生產醫院</label>${ro(bi.birth_place)}</div>
          <div class="field"><label>乳房手術史</label><input id="bf-surgery" maxlength="100"></div>
          <div class="field"><label>減痛分娩</label><input id="bf-pain" maxlength="30" value="無"></div>
          <div class="field"><label>寶寶性別</label>${ro(bi.gender === 'male' ? '男' : bi.gender === 'female' ? '女' : '')}</div>
          <div class="field"><label>出生日期</label>${ro(bi.birth_date)}</div>
          <div class="field"><label>週數</label>${ro(bi.gest_weeks)}</div>
          <div class="field"><label>出生體重</label>${ro(bi.birth_weight_g ? bi.birth_weight_g + ' g' : '')}</div>
          <div class="field"><label>胎次</label>${ro(bi.parity)}</div>
          <div class="field"><label>生產方式</label>${ro(mother.delivery_type)}</div>
          <div class="field"><label>出住時哺餵方式</label><input id="bf-discharge" maxlength="50"></div>
        </div>
        <h3 style="font-size:.95rem;color:var(--primary-dark);margin:12px 0 6px">認知</h3>
        <div class="field"><label>一、您對哺餵母乳之相關資訊來源(可複選)</label>
          <div style="margin:4px 0"><b style="font-size:.88rem">資訊來源：</b>${chkRow('src', BFAW.src)}</div>
          <div style="margin:4px 0"><b style="font-size:.88rem">獲得方式：</b>${chkRow('method', BFAW.method, 6, 'bf-method-other')}</div></div>
        <div class="field"><label>二、您知道六個月內純母乳哺餵的好處有哪些?(可複選)</label>
          <div class="row" style="gap:6px 14px;flex-wrap:wrap">${chkRow('benefits', BFAW.benefits)}</div></div>
        <div class="field"><label>三、您此胎哺餵寶寶的方式為：</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${rdRow('bf-thisfeed', BFAW.this_feed)}</div></div>
        <h3 style="font-size:.95rem;color:var(--primary-dark);margin:12px 0 6px">經驗 <small style="font-weight:400;color:var(--muted)">（第一胎者不需填寫下列兩項）</small></h3>
        <div class="field"><label>四、您前一胎的餵奶方式：</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">
            ${rdRow('bf-prevfeed', BFAW.prev_feed)} 哺餵時間 <input id="bf-prevtime" maxlength="30" style="width:120px"></div></div>
        <div class="field"><label>五、沒有純母乳哺餵的原因：(可複選)</label>
          <div style="margin:4px 0"><b style="font-size:.88rem">醫護人員方面：</b><br>${chkRow('r_staff', BFAW.r_staff, 2, 'bf-rstaff-other')}</div>
          <div style="margin:4px 0"><b style="font-size:.88rem">媽媽方面：</b><br>${chkRow('r_mom', BFAW.r_mom, 12, 'bf-rmom-other')}</div>
          <div style="margin:4px 0"><b style="font-size:.88rem">寶寶方面：</b><br>${chkRow('r_baby', BFAW.r_baby, 3, 'bf-rbaby-other')}</div>
          <div style="margin:4px 0"><b style="font-size:.88rem">社會家庭方面：</b><br>${chkRow('r_social', BFAW.r_social)}</div></div>
        <div class="field"><label>六、您前一胎在醫療院所親子同室執行情形：</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">
            ${rdRow('bf-prevroom', ['有執行', '未執行'])} 原因 <input id="bf-prevroom-reason" maxlength="100" style="width:220px"></div></div>
        <h3 style="font-size:.95rem;color:var(--primary-dark);margin:12px 0 6px">支持系統</h3>
        <div class="field"><label>七、您與誰同住：</label>
          <div class="row" style="gap:6px 14px;flex-wrap:wrap">${chkRow('cohab', BFAW.cohab, 8, 'bf-cohab-other')}</div></div>
        <div class="field"><label>八、同住的家人會協助哺餵及照顧寶寶：</label>
          <div class="row" style="gap:8px 14px">${rdRow('bf-famhelp', ['是', '否'])}</div></div>
        <div class="field"><label>九、您家人對寶寶純母乳餵食的看法：</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">
            ${rdRow('bf-famview', BFAW.family_view)} 原因 <input id="bf-famview-reason" maxlength="100" style="width:220px"></div></div>
        <div class="field"><label>十、親戚朋友中有多少人可以到家中協助哺餵及照顧寶寶：</label>
          <div class="row" style="gap:8px 14px">${rdRow('bf-helpers', BFAW.helpers)}</div></div>
        <div class="field"><label>十一、有沒有您可以信任的母乳哺育諮詢對象：</label>
          <div class="row" style="gap:8px 14px;align-items:center">
            ${rdRow('bf-consult', ['無', '有'])} 稱謂 <input id="bf-consult-title" maxlength="30" style="width:120px"></div></div>
        <div class="field"><label>十二、餵奶時您是否感覺到無助：</label>
          <div class="row" style="gap:8px 14px">${rdRow('bf-helpless', BFAW.helpless)}</div></div>`;
    }
    bodyHtml += `
      <div class="field" style="margin-top:8px"><label>備註<small>（限 100 字）</small></label><textarea id="sc-note" maxlength="100" rows="2"></textarea></div>
      <div class="row" style="gap:10px;align-items:center">
        <button class="btn" id="sc-save">資料存檔</button>
        <span>填表人：${esc(currentUser.name)}</span>
        <span class="error-msg" id="sc-err"></span>
      </div>`;
    openModal(`產後護理之家 -- ${SCALE_LABEL[kind]}`, bodyHtml, body => {
      const rd = name => { const c = body.querySelector(`input[name="${name}"]:checked`); return c ? c.value : ''; };
      const cks = name => [...body.querySelectorAll(`[data-bfck="${name}"]:checked`)].map(c => c.value);
      const iv = id => { const el = body.querySelector('#' + id); return el ? el.value.trim() : ''; };
      const nQ = kind === 'apgar' ? 5 : kind === 'epds' ? 10 : 0;
      const totalEl = body.querySelector('#sc-total');
      if (totalEl) body.querySelectorAll('input[name^="sc-q"]').forEach(r => r.onchange = () => {
        let sum = 0, done = true;
        for (let i = 0; i < nQ; i++) {
          const c = body.querySelector(`input[name="sc-q${i}"]:checked`);
          if (!c) { done = false; continue; }
          sum += Number(c.value);
        }
        totalEl.textContent = done ? sum : `${sum}（未答完）`;
        // EPDS 依總分自動預選判定（<10 正常；10~12 再觀察；>=13 建議進一步評估），可手動改
        if (kind === 'epds' && done && !body.querySelector('input[name="sc-result"]:checked')) {
          const idx = sum >= 13 ? 2 : sum >= 10 ? 1 : 0;
          const el = body.querySelectorAll('input[name="sc-result"]')[idx];
          if (el) el.checked = true;
        }
      });
      body.querySelector('#sc-save').onclick = async () => {
        const err = body.querySelector('#sc-err');
        const payload = { kind, fill_date: iv('sc-date'), note: iv('sc-note') };
        if (kind === 'bf_awareness') {
          payload.answers = {
            language: iv('bf-language'), ob_history: iv('bf-ob'), breast_surgery: iv('bf-surgery'),
            pain_relief: iv('bf-pain'), discharge_feeding: iv('bf-discharge'),
            src: cks('src'), method: cks('method'), method_other: iv('bf-method-other'),
            benefits: cks('benefits'), this_feed: rd('bf-thisfeed'),
            prev_feed: rd('bf-prevfeed'), prev_feed_time: iv('bf-prevtime'),
            r_staff: cks('r_staff'), r_staff_other: iv('bf-rstaff-other'),
            r_mom: cks('r_mom'), r_mom_other: iv('bf-rmom-other'),
            r_baby: cks('r_baby'), r_baby_other: iv('bf-rbaby-other'),
            r_social: cks('r_social'),
            prev_rooming: rd('bf-prevroom'), prev_rooming_reason: iv('bf-prevroom-reason'),
            cohab: cks('cohab'), cohab_other: iv('bf-cohab-other'),
            family_help: rd('bf-famhelp'), family_view: rd('bf-famview'), family_view_reason: iv('bf-famview-reason'),
            helpers: rd('bf-helpers'), consult: rd('bf-consult'), consult_title: iv('bf-consult-title'),
            helpless: rd('bf-helpless')
          };
          if (!payload.answers.this_feed) { err.textContent = '「三、您此胎哺餵寶寶的方式」尚未選擇'; return; }
        } else {
          const answers = [];
          for (let i = 0; i < nQ; i++) {
            const c = body.querySelector(`input[name="sc-q${i}"]:checked`);
            if (!c) { err.textContent = `第 ${i + 1} 題尚未作答`; return; }
            answers.push(Number(c.value));
          }
          payload.answers = answers;
          if (kind === 'epds') { payload.age = iv('sc-age'); payload.result = rd('sc-result'); }
        }
        try {
          await api(`/mothers/${momId}/scales`, { method: 'POST', body: payload });
          closeModal(); onSaved && onSaved();
        } catch (e) { err.textContent = e.message; }
      };
    });
  };
  openScale(kind);
}

async function viewMotherNursing() {
  const all = await api('/mothers');
  const mothers = all.filter(m => m.status === 'checked_in');
  if (!mothers.length) {
    main().innerHTML = '<div class="page-title">媽媽護理</div><div class="card"><div class="empty">目前沒有在住媽媽</div></div>';
    return;
  }
  const want = Number((location.hash.split('?m=')[1] || '').split('&')[0]);
  const momId = mothers.some(m => m.id === want) ? want : mothers[0].id;
  const { mother, medical_no, rows, problems, scales, reminders, today_photo, baby_info, babies } = await api(`/mothers/${momId}/nursing`);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const idNo = currentUser.id_no || '';
  const tempHigh = 37.5;

  const listRows = rows.map(r => {
    const d = r.data || {};
    const feverish = r.temperature != null && r.temperature >= tempHigh;
    return `
      <tr data-filter="${esc(r.assess_date)} ${esc(r.nurse_name || '')}">
        <td data-label="日期時間">${esc(r.assess_date)}<br><small>${esc(r.assess_time)}</small></td>
        <td data-label="生命徵象"><small><span class="${feverish ? 'rs-alert' : ''}">${r.temperature} °C${feverish ? ' ⚠' : ''}</span><br>脈 ${r.pulse}／呼 ${r.respiration}<br>${r.systolic}/${r.diastolic} mmHg</small></td>
        <td data-label="宮縮宮底"><small>${esc(d.uterus || '—')}${d.fundus_note ? `<br>${esc(d.fundus_note)}` : ''}</small></td>
        <td data-label="惡露"><small>${esc([d.lochia_amount, d.lochia_color].filter(Boolean).join('／') || '—')}${d.lochia_clot === '有' ? `<br>血塊：${esc(d.clot_note || '有')}` : ''}</small></td>
        <td data-label="傷口"><small>${esc(d.wound || '—')}${d.wound === '滲液' ? `<br>${esc(d.wound_exudate_amount || '')}／${esc(d.wound_exudate_color || '')}` : ''}</small></td>
        <td data-label="乳房"><small>左 ${esc(d.breast_l || '—')}／${esc(d.breast_l_milk || '—')}${d.breast_l_mastitis === '有' ? '／⚠乳腺炎' : ''}<br>右 ${esc(d.breast_r || '—')}／${esc(d.breast_r_milk || '—')}${d.breast_r_mastitis === '有' ? '／⚠乳腺炎' : ''}</small></td>
        <td data-label="疼痛/排便"><small>NRS ${esc(d.pain_nrs ?? '—')}／排便 ${esc(d.bowel_count ?? '—')} 次</small></td>
        <td data-label="精神/活動力"><small>${esc(d.mental || '—')}／${esc(d.activity || '—')}<br>親餵：${esc(d.bf_skill || '—')}</small></td>
        <td data-label="護理師">${esc(r.nurse_name || '—')}</td>
        <td data-label="" class="no-print">${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${r.id}">刪除</button>` : ''}</td>
      </tr>`;
  }).join('');

  const scaleCard = kind => {
    const list = scales.filter(s => s.kind === kind);
    const latest = list[0];
    // 各量表的結果摘要（EPDS 答案為 {a,age,result}，舊資料相容陣列格式）
    const epdsAns = s => Array.isArray(s.answers) ? s.answers : ((s.answers || {}).a || []);
    const resultText = s => {
      if (kind === 'apgar') return `${s.total} 分`;
      if (kind === 'epds') {
        const alert = s.total >= 10 || (epdsAns(s)[9] || 0) > 0;
        return `<span style="color:${alert ? 'var(--danger)' : 'inherit'}">${s.total} 分${alert ? ' ⚠' : ''}</span>${(s.answers || {}).result ? `<br><small>${esc(s.answers.result)}</small>` : ''}`;
      }
      return esc((s.answers || {}).this_feed || '已填寫');
    };
    let latestText = '<span style="color:var(--danger)">此筆資料尚未填寫</span>';
    if (latest) {
      const alert = kind === 'epds' && (latest.total >= 10 || (epdsAns(latest)[9] || 0) > 0);
      latestText = `最近：${esc(latest.fill_date)}${latest.total != null ? `　總分 <b style="color:${alert ? 'var(--danger)' : 'var(--primary-dark)'}">${latest.total} 分</b>${alert ? '（⚠ 建議關注／轉介）' : ''}` : ''}　填表：${esc(latest.nurse_name || '—')}（共 ${list.length} 筆）`;
    }
    return `
      <div class="card">
        <div class="row between" style="flex-wrap:wrap;gap:8px">
          <h3>${SCALE_LABEL[kind]}</h3>
          <button class="btn danger" data-scale="${kind}">${latest ? '新增' : '填寫'}${SCALE_LABEL[kind]}</button>
        </div>
        <div style="font-size:.92rem;margin-top:6px">${latestText}</div>
        ${list.length ? `<div class="table-wrap" style="margin-top:8px"><table class="data stack">
          <thead><tr><th>填表日期</th><th>${kind === 'bf_awareness' ? '此胎哺餵方式' : '總分/判定'}</th><th>備註</th><th>填表人</th><th class="no-print"></th></tr></thead>
          <tbody>${list.map(s => `
            <tr><td data-label="填表日期">${esc(s.fill_date)}</td>
              <td data-label="結果">${resultText(s)}</td>
              <td data-label="備註"><small>${esc(s.note || '—')}</small></td>
              <td data-label="填表人">${esc(s.nurse_name || '—')}</td>
              <td data-label="" class="no-print">${currentUser.role === 'admin' ? `<button class="btn small danger" data-scale-del="${s.id}">刪</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>` : ''}
      </div>`;
  };

  main().innerHTML = `
    <div class="page-title">媽媽護理 <small style="font-weight:400;color:var(--muted);font-size:.9rem">中衛日常評估欄位</small></div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇媽媽</label>
          <select id="mna-mom">${mothers.map(m => `<option value="${m.id}" ${m.id === momId ? 'selected' : ''}>${esc(m.name)}${m.room_name ? `（${esc(m.room_name)}）` : ''}</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <a class="btn small secondary" href="#/mother-intake?m=${momId}">入住評估表</a>
        <a class="btn small secondary" href="#/mother-care?m=${momId}">媽媽照護紀錄</a>
        <a class="btn small secondary" href="#/mother-handover?m=${momId}">產婦交班單</a>
        <a class="btn small secondary" href="#/mother-guidance?m=${momId}">衛教指導</a>
        <a class="btn small secondary" href="#/mother-close?m=${momId}">產婦結案</a>
        ${(babies || []).map(b => `<a class="btn small secondary" href="#/breastfeeding?b=${b.id}">母乳哺育評估${(babies || []).length > 1 ? `（${esc(b.name)}）` : ''}</a>`).join('')}
        ${canAccess('#/mother-doctor') ? `<a class="btn small secondary" href="#/mother-doctor?m=${momId}">醫師巡診</a>` : ''}
        <button class="btn small secondary" id="mna-print">資料列印</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">媽媽護理</div>
      <div class="row between" style="flex-wrap:wrap;gap:8px">
        <div class="row" style="gap:6px 18px;flex-wrap:wrap;font-size:.95rem">
          <span><b>媽媽姓名：</b>${mother.room_name ? `${esc(mother.room_name)}　` : ''}${esc(mother.name)}</span>
          ${mother.check_in ? `<span><b>入住日：</b>${esc(mother.check_in)}</span>` : ''}
          ${mother.check_out ? `<span><b>預退：</b>${esc(mother.check_out)}</span>` : ''}
          <span><b>生產方式：</b>${esc(mother.delivery_type || '—')}</span>
          <span><b>病歷號：</b>${esc(medical_no)}</span>
        </div>
        <div class="row no-print" style="gap:6px;flex-wrap:wrap">
          <button class="btn" data-guide="care">產婦衛教指導</button>
          ${(babies || []).length
            ? `<a class="btn" href="#/breastfeeding?b=${babies[0].id}">母乳哺育評估</a>`
            : '<button class="btn" id="mna-bfa-none">母乳哺育評估</button>'}
          <button class="btn" data-scale="bf_awareness">母乳認知與支持系統評估</button>
        </div>
      </div>
    </div>
    <div class="card no-print" id="mna-form">
      <details>
      <summary class="sec-hd" style="cursor:pointer;list-style:none">媽媽護理資料－編輯（中衛日常評估欄位，<b>*</b> 為必填）　點擊展開 ▾</summary>
      <div class="form-grid">
        <div class="field"><label>護理紀錄日期 <b class="req">*</b></label><input type="date" id="mna-date" value="${todayStr()}"></div>
        <div class="field"><label>紀錄時間 <b class="req">*</b></label><input type="time" id="mna-time" value="${hhmm}"></div>
        <div class="field"><label>體溫 <b class="req">*</b><small>（>=37.5°C 等於發燒）</small></label><input type="number" step="0.1" min="0" id="mna-temp"></div>
        <div class="field"><label>脈搏 <b class="req">*</b><small>（bpm）</small></label><input type="number" min="0" id="mna-pulse"></div>
        <div class="field"><label>呼吸 <b class="req">*</b><small>（bpm）</small></label><input type="number" min="0" id="mna-resp"></div>
        <div class="field"><label>收縮壓 <b class="req">*</b><small>（mmHg）</small></label><input type="number" min="0" id="mna-sys"></div>
        <div class="field"><label>舒張壓 <b class="req">*</b><small>（mmHg）</small></label><input type="number" min="0" id="mna-dia"></div>
        <div class="field"><label>產婦病歷號 <b class="req">*</b><small>（系統帶入）</small></label><input value="${esc(medical_no)}" disabled></div>
        <div class="field"><label>身分證號 <b class="req">*</b><small>（住客資料帶入）</small></label><input value="${esc(mother.id_no || '')}" placeholder="${mother.id_no ? '' : '請於住客管理維護身分證號'}" disabled></div>
        <div class="field"><label>入住日期 <b class="req">*</b></label><input type="date" value="${esc(mother.check_in || '')}" disabled></div>
        <div class="field"><label>疼痛評分(NRS) <b class="req">*</b><small>（0~10）</small></label><input type="number" min="0" max="10" id="mna-pain" data-req></div>
        <div class="field"><label>排便(次) <b class="req">*</b></label><input type="number" min="0" id="mna-bowel" data-req></div>
        <div class="field"><label>子宮復舊(宮縮宮底) <b class="req">*</b></label>${mnaSel('mna-uterus', MNA_OPTS.uterus)}</div>
        <div class="field"><label>宮底說明 <b class="req">*</b><small>（值為硬/可/差時必填，最多100字）</small></label><input id="mna-fundus" maxlength="100"></div>
        <div class="field"><label>惡露量 <b class="req">*</b></label>${mnaSel('mna-lo-amt', MNA_OPTS.lochia_amount)}</div>
        <div class="field"><label>惡露顏色 <b class="req">*</b></label>${mnaSel('mna-lo-color', MNA_OPTS.lochia_color)}</div>
        <div class="field"><label>是否血塊 <b class="req">*</b></label>${mnaSel('mna-clot', MNA_OPTS.yn)}</div>
        <div class="field"><label>血塊備註<small>（有血塊時必填，最多100字）</small></label><input id="mna-clot-note" maxlength="100"></div>
        <div class="field"><label>會陰/腹部傷口 <b class="req">*</b></label>${mnaSel('mna-wound', MNA_OPTS.wound)}</div>
        <div class="field"><label>傷口滲液量<small>（滲液時必填，最多100字）</small></label><input id="mna-wexu-amt" maxlength="100"></div>
        <div class="field"><label>傷口滲液顏色<small>（滲液時必填，最多100字）</small></label><input id="mna-wexu-color" maxlength="100"></div>
        ${mnaBreastBlock('l', '左')}
        ${mnaBreastBlock('r', '右')}
        <div class="field"><label>親餵技巧/執行狀態 <b class="req">*</b></label>${mnaSel('mna-bfskill', MNA_OPTS.bf_skill)}</div>
        <div class="field"><label>精神狀態 <b class="req">*</b></label>${mnaSel('mna-mental', MNA_OPTS.mental)}</div>
        <div class="field"><label>活動力 <b class="req">*</b></label>${mnaSel('mna-activity', MNA_OPTS.activity)}</div>
        <div class="field"><label>護理人員身分證字號 <b class="req">*</b><small>（自動帶入登入者，不可修改）</small></label><input value="${esc(idNo)}" placeholder="${idNo ? '' : '請於帳號管理維護身分證字號'}" disabled></div>
        <div class="field full">
          <details>
            <summary style="cursor:pointer;color:var(--muted);padding:6px 0">非必填欄位(報表用)　點擊展開 ▾</summary>
            <div class="form-grid" style="margin-top:8px">
              <div class="field"><label>進食狀況</label><input id="mna-diet" maxlength="100"></div>
              <div class="field"><label>排尿</label><input id="mna-urine" maxlength="100"></div>
              <div class="field"><label>睡眠</label><input id="mna-sleep" maxlength="100"></div>
              <div class="field"><label>衛教內容</label><input id="mna-edu" maxlength="200"></div>
              <div class="field full"><label>備註</label><textarea id="mna-note" maxlength="300" rows="2"></textarea></div>
            </div>
          </details>
        </div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="mna-save">資料新增</button>
          <span class="error-msg" id="mna-err"></span>
        </div>
      </div>
      </details>
    </div>
    <div class="board-grid" style="grid-template-columns:1fr;gap:12px">
      <div class="card" style="margin:0">
        <div class="row between" style="flex-wrap:wrap;gap:8px">
          <h3>乳房圖示</h3>
          <span class="row no-print" style="gap:6px">
            <input type="file" id="mna-photo-file" accept="image/*" style="width:auto">
            <button class="btn small" id="mna-photo-up">上傳今日圖片</button>
          </span>
        </div>
        <div style="margin-top:8px">${today_photo
          ? `<img src="/uploads/${esc(today_photo.photo_file)}" style="max-width:260px;max-height:260px;border:1px solid var(--border);border-radius:8px">${currentUser.role === 'admin' ? `<br><button class="btn small danger no-print" id="mna-photo-del" data-pid="${today_photo.id}" style="margin-top:6px">刪除今日圖片</button>` : ''}`
          : '<div class="empty" style="border:1px dashed var(--border);border-radius:8px;padding:30px;color:var(--danger)">...本日無圖片...</div>'}</div>
      </div>
      <div class="card" style="margin:0">
        <div class="row between" style="flex-wrap:wrap;gap:8px">
          <h3>健康問題列表</h3>
          <button class="btn small no-print" id="mna-hp-add">修改健康問題</button>
        </div>
        <div class="table-wrap" style="margin-top:8px">
          <table class="data stack">
            <thead><tr><th>No</th><th>問題項目</th><th>開始日期</th><th>結案日期</th><th class="no-print"></th></tr></thead>
            <tbody>${problems.map((p, i) => `
              <tr><td data-label="No">${i + 1}</td>
                <td data-label="問題項目">${esc(p.item)}</td>
                <td data-label="開始日期">${esc(p.start_date)}</td>
                <td data-label="結案日期">${p.end_date ? esc(p.end_date) : '<span class="badge yellow">處理中</span>'}</td>
                <td data-label="" class="no-print">${!p.end_date ? `<button class="btn small secondary" data-hp-close="${p.id}">結案</button>` : ''} ${currentUser.role === 'admin' ? `<button class="btn small danger" data-hp-del="${p.id}">刪</button>` : ''}</td></tr>`).join('') ||
              '<tr><td colspan="5"><div class="empty">尚無健康問題</div></td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
    ${scaleCard('bf_awareness')}
    <div class="card">
      <h3>護理指導單提醒紀錄</h3>
      <div class="table-wrap" style="margin-top:8px">
        <table class="data stack">
          <thead><tr><th>筆數</th><th>提醒日期</th><th>入住天數</th><th>執行日期</th><th>執行人員</th></tr></thead>
          <tbody>${reminders.map((r, i) => `
            <tr><td data-label="筆數">${i + 1}</td>
              <td data-label="提醒日期">${esc(r.remind_date)}</td>
              <td data-label="入住天數">${esc(r.day_label)}</td>
              <td data-label="執行日期">${r.done_date ? `${esc(r.done_date)}${r.kind ? `<br><small>${r.kind === 'care' ? '產婦護理' : '母乳哺育'}指導單</small>` : ''}` : '<span class="badge yellow">未執行</span>'}</td>
              <td data-label="執行人員">${esc(r.done_by || '—')}</td></tr>`).join('') ||
            '<tr><td colspan="5"><div class="empty">媽媽尚未入住，無提醒排程</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="row between no-print"><h3>媽媽護理資料（${rows.length} 筆）</h3></div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>日期時間</th><th>生命徵象</th><th>宮縮宮底</th><th>惡露</th><th>傷口</th><th>乳房</th><th>疼痛/排便</th><th>精神/活動力</th><th>護理師</th><th class="no-print"></th></tr></thead>
          <tbody>${listRows || '<tr><td colspan="10"><div class="empty">尚無護理紀錄</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $('#mna-mom').onchange = () => { location.hash = `#/mother-nursing?m=${$('#mna-mom').value}`; };
  $('#mna-print').onclick = () => window.print();
  const bfaNone = $('#mna-bfa-none');
  if (bfaNone) bfaNone.onclick = () =>
    alert(`「${mother.name}」尚未登記寶寶。\n母乳哺育評估依寶寶進行，請先至「住客管理」新增寶寶後，再由此進入評估。`);

  const form = $('#mna-form');
  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };

  // 指導單執行（記錄執行日期＝提醒紀錄的執行來源）
  main().querySelectorAll('[data-guide]').forEach(btn => {
    btn.onclick = async () => {
      const kind = btn.dataset.guide;
      const label = kind === 'care' ? '產婦護理指導單' : '母乳哺育指導單';
      const note = prompt(`記錄「${label}」已執行（今日），可填指導內容備註（可留空）`, '');
      if (note === null) return;
      try {
        await api(`/mothers/${momId}/guidance`, { method: 'POST', body: { kind, done_date: todayStr(), note } });
        viewMotherNursing();
      } catch (e) { alert(e.message); }
    };
  });

  // 護理紀錄新增
  $('#mna-save').onclick = async () => {
    const err = $('#mna-err');
    err.textContent = '';
    if (!v('#mna-date') || !v('#mna-time')) { err.textContent = '請填寫護理紀錄日期與時間'; return; }
    if (!v('#mna-temp') || !v('#mna-pulse') || !v('#mna-resp') || !v('#mna-sys') || !v('#mna-dia')) {
      err.textContent = '請填寫體溫／脈搏／呼吸／血壓'; return;
    }
    for (const el of form.querySelectorAll('[data-req]')) {
      if (!el.value) { err.textContent = '尚有必填欄位未填寫'; el.focus(); return; }
    }
    const pain = Number(v('#mna-pain'));
    if (!(pain >= 0 && pain <= 10)) { err.textContent = '疼痛評分(NRS)需為 0～10'; return; }
    if (MNA_OPTS.uterus.includes(v('#mna-uterus')) && !v('#mna-fundus')) { err.textContent = '宮底說明必填（值為硬/可/差時）'; return; }
    if (v('#mna-clot') === '有' && !v('#mna-clot-note')) { err.textContent = '有血塊時，血塊備註必填'; return; }
    if (v('#mna-wound') === '滲液' && (!v('#mna-wexu-amt') || !v('#mna-wexu-color'))) { err.textContent = '傷口滲液時，滲液量與顏色必填'; return; }
    try {
      await api(`/mothers/${momId}/nursing`, { method: 'POST', body: {
        assess_date: v('#mna-date'), assess_time: v('#mna-time'),
        temperature: v('#mna-temp'), pulse: v('#mna-pulse'), respiration: v('#mna-resp'),
        systolic: v('#mna-sys'), diastolic: v('#mna-dia'),
        pain_nrs: v('#mna-pain'), bowel_count: v('#mna-bowel'),
        uterus: v('#mna-uterus'), fundus_note: v('#mna-fundus'),
        lochia_amount: v('#mna-lo-amt'), lochia_color: v('#mna-lo-color'),
        lochia_clot: v('#mna-clot'), clot_note: v('#mna-clot-note'),
        wound: v('#mna-wound'), wound_exudate_amount: v('#mna-wexu-amt'), wound_exudate_color: v('#mna-wexu-color'),
        breast_l: v('#mna-br-l'), breast_l_milk: v('#mna-br-l-milk'), breast_l_mastitis: v('#mna-br-l-mast'),
        breast_r: v('#mna-br-r'), breast_r_milk: v('#mna-br-r-milk'), breast_r_mastitis: v('#mna-br-r-mast'),
        bf_skill: v('#mna-bfskill'), mental: v('#mna-mental'), activity: v('#mna-activity'),
        nurse_id_no: idNo,
        diet: v('#mna-diet'), urination: v('#mna-urine'), sleep: v('#mna-sleep'),
        education: v('#mna-edu'), note: v('#mna-note')
      } });
      viewMotherNursing();
    } catch (e) { err.textContent = e.message; }
  };

  // 乳房圖示上傳／刪除
  $('#mna-photo-up').onclick = async () => {
    const f = $('#mna-photo-file').files[0];
    if (!f) { alert('請先選擇圖片'); return; }
    const fd = new FormData();
    fd.append('photo', await compressImage(f));
    fd.append('taken_date', todayStr());
    try { await api(`/mothers/${momId}/breast-photos`, { method: 'POST', body: fd }); viewMotherNursing(); }
    catch (e) { alert(e.message); }
  };
  const photoDel = $('#mna-photo-del');
  if (photoDel) photoDel.onclick = async () => {
    if (!confirm('確定刪除今日乳房圖示？')) return;
    await api(`/mother-breast-photos/${photoDel.dataset.pid}`, { method: 'DELETE' });
    viewMotherNursing();
  };

  // 健康問題：新增／結案／刪除
  $('#mna-hp-add').onclick = () => {
    openModal('修改健康問題', `
      <div class="form-grid">
        <div class="field full"><label>問題項目 <b class="req">*</b></label><input id="hp-item" maxlength="200" placeholder="例如：乳腺阻塞、傷口紅腫"></div>
        <div class="field"><label>開始日期 <b class="req">*</b></label><input type="date" id="hp-start" value="${todayStr()}"></div>
        <div class="full row" style="gap:10px"><button class="btn" id="hp-save">新增問題</button><span class="error-msg" id="hp-err"></span></div>
      </div>`, body => {
      body.querySelector('#hp-save').onclick = async () => {
        try {
          await api(`/mothers/${momId}/health-problems`, { method: 'POST', body: {
            item: body.querySelector('#hp-item').value.trim(), start_date: body.querySelector('#hp-start').value
          } });
          closeModal(); viewMotherNursing();
        } catch (e) { body.querySelector('#hp-err').textContent = e.message; }
      };
    });
  };
  main().querySelectorAll('[data-hp-close]').forEach(btn => {
    btn.onclick = async () => {
      const d = prompt('結案日期（YYYY-MM-DD）', todayStr());
      if (d === null) return;
      try { await api(`/mother-health-problems/${btn.dataset.hpClose}`, { method: 'PUT', body: { end_date: d } }); viewMotherNursing(); }
      catch (e) { alert(e.message); }
    };
  });
  main().querySelectorAll('[data-hp-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆健康問題？')) return;
      await api(`/mother-health-problems/${btn.dataset.hpDel}`, { method: 'DELETE' });
      viewMotherNursing();
    };
  });

  const openScale = kind => openMotherScale({ momId, mother, baby_info }, kind, viewMotherNursing);
  main().querySelectorAll('[data-scale]').forEach(btn => btn.onclick = () => openScale(btn.dataset.scale));
  main().querySelectorAll('[data-scale-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆量表紀錄？')) return;
      await api(`/mother-scales/${btn.dataset.scaleDel}`, { method: 'DELETE' });
      viewMotherNursing();
    };
  });

  main().querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆護理紀錄？（會記入稽核軌跡）')) return;
      await api(`/mother-nursing/${btn.dataset.del}`, { method: 'DELETE' });
      viewMotherNursing();
    };
  });
}

/* ---------- 產婦入住護理評估表（中衛必要欄位＋中衛入住評估欄位） ---------- */
const TW_COUNTIES = ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];
const MIA_OPT = {
  education: ['國小以下', '國小', '國中', '高中職', '專科', '大學', '研究所以上', '其他'],
  marital: ['已婚', '未婚', '同居', '離婚', '喪偶', '其他'],
  highRisk: ['無', '妊娠糖尿病', '妊娠高血壓', '子癲前症', '前置胎盤', '胎盤早期剝離', '早產', '多胎妊娠', '其他'],
  allergyCat: ['無', '食物', '藥物', '食物及藥物', '其他'],
  alcohol: ['無', '偶爾', '經常', '已戒', '其他'],
  smoking: ['無', '偶爾', '經常', '已戒', '其他'],
  pastHx: ['無', '高血壓', '糖尿病', '心臟病', '甲狀腺疾病', '氣喘', '曾接受手術', '其他'],
  lab3: ['陰性(-)', '陽性(+)', '未檢驗', '報告未到'],
  varicella: ['有抗體', '無抗體', '已接種疫苗', '未檢驗'],
  ynMed: ['無', '有'],
  ear: ['正常', '耳垢阻塞', '分泌物', '聽力異常', '其他'],
  nose: ['正常', '鼻塞', '分泌物', '其他'],
  mouth: ['正常', '口腔潰瘍', '牙齦紅腫', '缺牙', '其他'],
  neck: ['正常', '甲狀腺腫大', '淋巴結腫大', '其他'],
  vision: ['正常', '近視', '遠視', '配戴眼鏡', '配戴隱形眼鏡', '視力不清', '其他'],
  consciousness: ['清醒', '嗜睡', '混亂', '躁動', '其他'],
  skin: ['正常', '蒼白', '潮紅', '黃疸', '發紺', '其他'],
  emotion: ['穩定', '愉快', '平淡', '低落', '激動', '其他'],
  attitude: ['合作', '被動', '抗拒', '其他'],
  respQuality: ['規則', '不規則', '費力', '其他'],
  respPattern: ['正常', '淺快', '深慢', '喘', '呼吸困難', '其他'],
  heartRate: ['規則', '不規則', '過速(>100)', '過緩(<60)', '其他'],
  limbTemp: ['溫暖', '冰冷'],
  limbColor: ['紅潤', '蒼白', '發紺'],
  abdomen: ['柔軟', '腹脹', '壓痛', '其他'],
  limb: ['正常', '水腫', '無力', '活動受限', '其他'],
  urination: ['正常', '頻尿', '解尿困難', '尿失禁', '留置導尿', '其他'],
  bowel: ['正常', '便秘', '腹瀉', '其他'],
  uterus: ['硬', '可', '差'],
  lochiaAmount: ['無', '少量', '中量', '多量'],
  wound: ['無傷口', '會陰傷口', '腹部傷口', '乾燥完整', '紅腫', '滲液', '裂開', '其他'],
  activity: ['可自行下床活動', '需協助下床', '臥床', '其他'],
  breast: ['柔軟', '脹', '硬塊', '紅腫', '乳頭皸裂', '其他'],
  nippleLen: ['正常', '短', '凹陷', '其他'],
  nippleSize: ['正常', '大', '小', '其他'],
  bfPrevDuration: ['未曾哺餵', '未滿1個月', '1-3個月', '3-6個月', '6個月-1年', '1年以上'],
  bfIntent: ['純母乳', '混合哺餵', '純配方奶', '未決定'],
  bfPlannedTime: ['1個月', '2個月', '4個月', '6個月', '6個月以上', '其他'],
  familySupport: ['支持', '中立', '不支持'],
  pain: ['無疼痛', '輕度(1-3)', '中度(4-6)', '重度(7-10)']
};
const MIA_MULTI = {
  languages: ['國語', '台語', '其他'],
  delivery_modes: ['自然生產', '剖腹生產', '真空吸引', '產鉗', 'VBAC'],
  contact_items: ['曾接觸近期自國外返國親友', '曾出入機場、觀光景點及其他頻繁接觸外國人場所', '曾參與公眾集會或開學/畢業典禮、婚喪喜慶、運動賽事等群聚活動', '其他'],
  infection_items: ['發燒', '腹瀉', '咳嗽', '流鼻水', '皮疹', '肋肌痛'],
  special_items: ['視覺障礙', '聽語障礙', '心智障礙', '肢體障礙', '其他'],
  skin_items: ['皮下出血點', '乾燥脫皮', '疤痕', '水腫', '紅疹', '其他'],
  emotion_items: ['緊張', '焦慮', '憂慮', '哀傷', '憤怒', '其他'],
  needs: ['獲得休息', '學習哺乳技巧', '獲得營養膳食', '學習照顧新生兒技巧', '婦兒科醫師相關諮詢', '其他'],
  lochia_nature: ['鮮紅', '粉紅', '暗紅', '褐色', '黃色', '無', '血塊'],
  bf_stop_reasons: ['乳汁不足', '身體虛弱', '工作因素', '嬰兒吸吮能力不好', '乳頭問題', '其他']
};

async function viewMotherIntake() {
  const all = await api('/mothers');
  const mothers = all.filter(m => m.status === 'checked_in');
  if (!mothers.length) {
    main().innerHTML = '<div class="page-title">產婦入住護理評估表</div><div class="card"><div class="empty">目前沒有在住媽媽</div></div>';
    return;
  }
  const want = Number((location.hash.split('?m=')[1] || '').split('&')[0]);
  const momId = mothers.some(m => m.id === want) ? want : mothers[0].id;
  const { mother, medical_no, record, scales } = await api(`/mothers/${momId}/intake`);
  const d = (record && record.data) || {};
  const idNo = currentUser.id_no || '';
  const sc = scales || {};
  // 量表快捷按鈕：未填為紅色（顏色1），已填為綠色打勾（顏色2）
  const scaleBtn = (kind, label) => {
    const done = sc[kind] && sc[kind].count > 0;
    return `<button class="btn small ${done ? '' : 'danger'}" ${done ? 'style="background:var(--ok)"' : ''} data-mi-scale="${kind}">${esc(label)}${done ? ` ✓（${esc(sc[kind].last || '')}）` : ''}</button>`;
  };

  // 表單元件產生器（id 一律 mi-<key>；prefill 由 d[key]）
  const sel = (k, opts, req = true) => `<select id="mi-${k}" ${req ? 'data-req' : ''}><option value="">--請選擇--</option>${opts.map(o => `<option ${d[k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  const txt = (k, ph = '', { req = false, max = 100 } = {}) => `<input id="mi-${k}" maxlength="${max}" ${req ? 'data-req' : ''} placeholder="${esc(ph)}" value="${esc(d[k] ?? '')}">`;
  const numf = (k, ph = '', req = false) => `<input id="mi-${k}" type="number" step="0.1" min="0" ${req ? 'data-req' : ''} placeholder="${esc(ph)}" value="${esc(d[k] ?? '')}">`;
  const other = (k, ph) => `<input id="mi-${k}" maxlength="100" placeholder="${esc(ph)}" value="${esc(d[k] ?? '')}" style="margin-top:6px">`;
  const chks = k => MIA_MULTI[k].map(o => `<label class="bna-chk"><input type="checkbox" data-ck="${k}" value="${esc(o)}" ${(d[k] || []).includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join(' ');
  const rad = (k, opts) => opts.map(o => `<label class="bna-chk"><input type="radio" name="mi-${k}" value="${esc(o)}" ${d[k] === o ? 'checked' : ''}> ${esc(o)}</label>`).join(' ');
  const F = (label, inner, { req = false, hint = '', full = false } = {}) => `<div class="field${full ? ' full' : ''}"><label>${esc(label)}${req ? ' <b class="req">*</b>' : ''}${hint ? `<small>${esc(hint)}</small>` : ''}</label>${inner}</div>`;

  main().innerHTML = `
    <div class="page-title">產婦入住護理評估表 <small style="font-weight:400;color:var(--muted);font-size:.9rem">中衛必要欄位＋入住評估</small></div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇媽媽</label>
          <select id="mi-mom">${mothers.map(m => `<option value="${m.id}" ${m.id === momId ? 'selected' : ''}>${esc(m.name)}${m.room_name ? `（${esc(m.room_name)}）` : ''}</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <a class="btn small secondary" href="#/mother-nursing?m=${momId}">媽媽護理</a>
        <a class="btn small secondary" href="#/mother-intake-blank">空白單列印</a>
        <button class="btn small secondary" id="mi-print">資料列印</button>
        ${record ? `<small style="color:var(--muted)">最後存檔：${esc(record.updated_at)}（${esc(record.nurse_name || '—')}）</small>` : '<span class="badge yellow">尚未建立</span>'}
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
        <span style="font-size:.85rem;color:var(--muted);align-self:center">入住評估量表：</span>
        ${scaleBtn('epds', '愛丁堡產後憂鬱量表')}
        ${scaleBtn('apgar', '家庭功能評估表')}
      </div>
    </div>

    <form id="mi-form">
    <div class="card">
      <div class="sec-hd warn">中衛必要欄位（<b>*</b> 為必填）</div>
      <div class="form-grid">
        ${F('產婦病歷號', `<input value="${esc(medical_no)}" disabled>`, { req: true, hint: '（系統帶入）' })}
        ${F('產婦身分證號', `<input id="mi-id_no" maxlength="10" data-req value="${esc(d.id_no ?? mother.id_no ?? '')}">`, { req: true })}
        ${F('主要陪伴者姓名', txt('companion_name', '', { req: true, max: 50 }), { req: true })}
        ${F('陪伴者電話', txt('companion_phone', '', { req: true, max: 30 }), { req: true })}
        ${F('陪伴者關係', txt('companion_relation', '', { req: true, max: 30 }), { req: true })}
        ${F('縣市', sel('county', TW_COUNTIES), { req: true })}
        ${F('區域', txt('district', '請輸入鄉鎮市區', { req: true, max: 30 }), { req: true })}
        ${F('巷弄門牌', txt('address', '', { req: true, max: 100 }), { req: true, hint: '（最多100字）' })}
        ${F('市話', txt('tel', '', { req: true, max: 30 }), { req: true })}
        ${F('教育程度', sel('education', MIA_OPT.education), { req: true })}
        ${F('教育程度其他', txt('education_other', '', { max: 100 }), { hint: '（選「其他」時必填）' })}
        ${F('語言（多選）', `<div class="row" style="gap:10px;padding-top:8px">${chks('languages')}</div>`, { req: true })}
        ${F('語言其他', txt('language_other', '', { max: 100 }), { hint: '（選「其他」時必填）' })}
        ${F('婚姻狀態', sel('marital', MIA_OPT.marital), { req: true })}
        ${F('孕次(Gravidity)', txt('gravidity', '', { req: true, max: 10 }), { req: true })}
        ${F('生產次數(Parity)', txt('parity', '', { req: true, max: 10 }), { req: true })}
        ${F('流產次數(Abortus)', txt('abortus', '', { req: true, max: 10 }), { req: true })}
        ${F('生產方式/輔助（多選）', `<div class="row" style="gap:8px 14px;flex-wrap:wrap;padding-top:8px">${chks('delivery_modes')}</div>`, { req: true })}
        ${F('生產方式其他說明', txt('delivery_other', '', { max: 100 }))}
        ${F('高危妊娠/併發症', sel('high_risk', MIA_OPT.highRisk), { req: true })}
        ${F('高危妊娠其他說明', txt('high_risk_other', '', { max: 100 }))}
        ${F('工作/職業', txt('occupation', '', { req: true, max: 50 }), { req: true })}
        ${F('過敏史主類別', sel('allergy_cat', MIA_OPT.allergyCat), { req: true })}
        ${F('食物過敏說明', txt('allergy_food', '', { max: 100 }))}
        ${F('藥物過敏說明', txt('allergy_drug', '', { max: 100 }))}
        ${F('飲酒史', sel('alcohol', MIA_OPT.alcohol), { req: true })}
        ${F('飲酒其他說明', txt('alcohol_other', '', { max: 100 }))}
        ${F('抽菸史', sel('smoking', MIA_OPT.smoking), { req: true })}
        ${F('抽菸其他說明', txt('smoking_other', '', { max: 100 }))}
        ${F('既往病史/手術史', sel('past_history', MIA_OPT.pastHx), { req: true })}
        ${F('病史其他說明', txt('past_history_other', '', { max: 100 }))}
        ${F('梅毒檢驗 RPR', sel('rpr', MIA_OPT.lab3), { req: true })}
        ${F('愛滋檢驗 HIV', sel('hiv', MIA_OPT.lab3), { req: true })}
        ${F('水痘檢驗', sel('varicella', MIA_OPT.varicella), { req: true })}
        ${F('B型肝炎 HBsAg', sel('hbsag', MIA_OPT.lab3), { req: true })}
        ${F('B型肝炎 HBeAg', sel('hbeag', MIA_OPT.lab3), { req: true })}
        ${F('服藥/帶藥紀錄', sel('medication', MIA_OPT.ynMed), { req: true })}
        ${F('服藥明細(藥名/量/時間)', `<textarea id="mi-medication_detail" maxlength="300" rows="2">${esc(d.medication_detail ?? '')}</textarea>`, { full: true })}
        ${F('旅遊史', sel('travel', MIA_OPT.ynMed), { req: true })}
        ${F('旅遊史說明', txt('travel_note', '', { max: 100 }))}
        ${F('發燒史', sel('fever_hx', MIA_OPT.ynMed), { req: true })}
        ${F('發燒史說明', txt('fever_note', '', { max: 100 }))}
        ${F('接觸史旗標', `<div class="row" style="gap:14px;padding-top:8px">${rad('contact_flag', ['有', '無'])}</div>`, { req: true })}
        ${F('接觸史細項（多選）', `<div style="display:flex;flex-direction:column;gap:6px;padding-top:6px">${MIA_MULTI.contact_items.map(o => `<label class="bna-chk" style="white-space:normal"><input type="checkbox" data-ck="contact_items" value="${esc(o)}" ${(d.contact_items || []).includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>`, { req: true })}
        ${F('接觸史其他', txt('contact_other', '', { max: 100 }))}
        ${F('感染症狀旗標', `<div class="row" style="gap:14px;padding-top:8px">${rad('infection_flag', ['有', '無'])}</div>`, { req: true })}
        ${F('感染症狀細項（多選）', `<div class="row" style="gap:8px 14px;flex-wrap:wrap;padding-top:6px">${chks('infection_items')}</div>`, { req: true })}
        ${F('特殊需求旗標', `<div class="row" style="gap:14px;padding-top:8px">${rad('special_flag', ['有', '無'])}</div>`, { req: true })}
        ${F('特殊需求細項（多選）', `<div class="row" style="gap:8px 14px;flex-wrap:wrap;padding-top:6px">${chks('special_items')}</div>`, { req: true })}
        ${F('特殊需求其他', txt('special_other', '', { max: 100 }))}
        ${F('建檔人員身分證', `<input id="mi-recorder_id_no" value="${esc(idNo)}" placeholder="${idNo ? '' : '請於帳號管理維護身分證字號'}" disabled>`, { req: true, hint: '（登入者帶入）' })}
      </div>
    </div>

    <div class="card">
      <div class="sec-hd">中衛入住評估欄位（<b>*</b> 為必填）</div>
      <div class="form-grid">
        ${F('身高(cm)', numf('height', '', true), { req: true })}
        ${F('體重(kg)', numf('weight', '', true), { req: true })}
        ${F('體溫(°C)', numf('temperature', '', true), { req: true })}
        ${F('呼吸(次/分)', numf('respiration', '', true), { req: true })}
        ${F('血壓(mmHg)', txt('bp', '收縮壓/舒張壓', { req: true, max: 20 }), { req: true })}
        ${F('左耳評估', sel('ear_l', MIA_OPT.ear) + other('ear_l_other', '左耳其他'), { req: true })}
        ${F('右耳評估', sel('ear_r', MIA_OPT.ear) + other('ear_r_other', '右耳其他'), { req: true })}
        ${F('鼻子評估', sel('nose', MIA_OPT.nose) + other('nose_other', '鼻子其他'), { req: true })}
        ${F('口腔評估', sel('mouth', MIA_OPT.mouth) + other('mouth_other', '口腔其他'), { req: true })}
        ${F('頸部評估', sel('neck', MIA_OPT.neck) + other('neck_other', '頸部其他'), { req: true })}
        ${F('視力狀態', sel('vision', MIA_OPT.vision) + other('vision_note', '視力不清晰輔具/說明'), { req: true })}
        ${F('意識狀態', sel('consciousness', MIA_OPT.consciousness), { req: true })}
        ${F('皮膚狀態', sel('skin', MIA_OPT.skin) + `<div class="row" style="gap:8px 14px;flex-wrap:wrap;margin-top:6px">${chks('skin_items')}</div>` + other('skin_other_note', '皮膚其他狀況說明'), { req: true, full: true })}
        ${F('情緒表現', sel('emotion', MIA_OPT.emotion) + `<div class="row" style="gap:8px 14px;flex-wrap:wrap;margin-top:6px">${chks('emotion_items')}</div>`, { req: true, full: true })}
        ${F('態度表現', sel('attitude', MIA_OPT.attitude), { req: true })}
        ${F('呼吸速率（質）', sel('resp_quality', MIA_OPT.respQuality), { req: true })}
        ${F('脈搏', numf('pulse', '', true), { req: true })}
        ${F('呼吸型態', sel('resp_pattern', MIA_OPT.respPattern) + other('resp_pattern_other', '呼吸型態其他'), { req: true })}
        ${F('心跳速率', sel('heart_rate', MIA_OPT.heartRate) + other('heart_rate_other', '心跳速率其他'), { req: true })}
        ${F('四肢循環-溫度', sel('limb_temp', MIA_OPT.limbTemp), { req: true })}
        ${F('四肢循環-顏色', sel('limb_color', MIA_OPT.limbColor), { req: true })}
        ${F('腹部外觀', sel('abdomen', MIA_OPT.abdomen) + other('abdomen_other', '腹部外觀其他'), { req: true })}
        ${F('上肢評估', sel('upper_limb', MIA_OPT.limb) + other('upper_limb_other', '上肢其他'), { req: true })}
        ${F('下肢評估', sel('lower_limb', MIA_OPT.limb) + other('lower_limb_other', '下肢其他'), { req: true })}
        ${F('排尿', sel('urination', MIA_OPT.urination) + other('urination_note', '排尿異常補述'), { req: true })}
        ${F('排便', sel('bowel', MIA_OPT.bowel) + other('bowel_note', '排便異常補述'), { req: true })}
        ${F('子宮復舊(宮縮宮底)', sel('uterus', MIA_OPT.uterus) + other('fundus_note', '宮底Fb說明'), { req: true })}
        ${F('惡露量', sel('lochia_amount', MIA_OPT.lochiaAmount), { req: true })}
        ${F('惡露性質（多選）', `<div class="row" style="gap:8px 14px;flex-wrap:wrap;padding-top:8px">${chks('lochia_nature')}</div>`, { req: true })}
        ${F('是否血塊', `<div class="row" style="gap:14px;padding-top:8px">${rad('clot', ['有', '無'])}</div>` + other('clot_note', '血塊備註'), { req: true })}
        ${F('會陰/腹部傷口', sel('wound', MIA_OPT.wound) + other('wound_exu_amount', '滲液量') + other('wound_exu_color', '滲液顏色'), { req: true })}
        ${F('活動力', sel('activity', MIA_OPT.activity), { req: true })}
        ${F('入住主要需求（多選）', `<div class="row" style="gap:8px 14px;flex-wrap:wrap;padding-top:8px">${chks('needs')}</div>` + other('needs_other', '入住主要需求其他'), { req: true, full: true })}
        ${F('左乳房評估', sel('breast_l', MIA_OPT.breast) + other('breast_l_other', '左乳房其他'), { req: true })}
        ${F('右乳房評估', sel('breast_r', MIA_OPT.breast) + other('breast_r_other', '右乳房其他'), { req: true })}
        ${F('乳房硬塊', `<div class="row" style="gap:14px;padding-top:8px">${rad('breast_lump', ['有', '無'])}</div>` + other('lump_note', '硬塊說明'), { req: true })}
        ${F('乳頭長度', sel('nipple_len', MIA_OPT.nippleLen) + other('nipple_len_other', '乳頭長度其他'), { req: true })}
        ${F('乳頭大小', sel('nipple_size', MIA_OPT.nippleSize) + other('nipple_size_other', '乳頭大小其他'), { req: true })}
        ${F('餵母奶經驗', `<div class="row" style="gap:14px;padding-top:8px">${rad('bf_exp', ['有', '無'])}</div>` + sel('bf_prev_duration', MIA_OPT.bfPrevDuration, false).replace('mi-bf_prev_duration"', 'mi-bf_prev_duration" style="margin-top:6px"'), { req: true })}
        ${F('前胎停止餵母奶原因（多選）', `<div class="row" style="gap:8px 14px;flex-wrap:wrap;padding-top:8px">${chks('bf_stop_reasons')}</div>` + other('bf_stop_other', '停止餵奶其他'), { full: true })}
        ${F('此胎餵母奶意願', sel('bf_intent', MIA_OPT.bfIntent, false) + other('bf_no_reason', '不餵母奶原因'))}
        ${F('預計餵母奶時間', sel('bf_planned_time', MIA_OPT.bfPlannedTime, false) + other('bf_planned_other', '預計餵母奶時間其他'))}
        ${F('家人/機構對母乳支持', sel('family_support', MIA_OPT.familySupport), { req: true })}
        ${F('疼痛評估', sel('pain', MIA_OPT.pain), { req: true })}
        ${F('疼痛分數(0-10)', `<input id="mi-pain_score" type="number" min="0" max="10" value="${esc(d.pain_score ?? '')}">`)}
        ${F('疼痛部位', txt('pain_site', '', { max: 100 }))}
        ${F('疼痛性質', txt('pain_nature', '', { max: 100 }))}
        ${F('疼痛時間', txt('pain_time', '', { max: 100 }))}
        ${F('疼痛備註', txt('pain_note', '', { max: 200 }))}
        <div class="field full">
          <details>
            <summary style="cursor:pointer;color:var(--muted);padding:6px 0">非必填欄位(報表用)　點擊展開 ▾</summary>
            <div class="form-grid" style="margin-top:8px">
              ${F('報表備註', `<textarea id="mi-report_note" maxlength="500" rows="2">${esc(d.report_note ?? '')}</textarea>`, { full: true })}
            </div>
          </details>
        </div>
      </div>
      <div class="row" style="gap:10px;align-items:center;margin-top:12px">
        <button type="button" class="btn" id="mi-save">資料存檔</button>
        <span style="color:var(--muted)">（填表人：${esc(currentUser.name)}${record ? `　填表日期：${esc(record.updated_at.slice(0, 10))}` : ''}）</span>
        <span class="error-msg" id="mi-err"></span>
      </div>
    </div>
    </form>`;

  $('#mi-mom').onchange = () => { location.hash = `#/mother-intake?m=${$('#mi-mom').value}`; };
  $('#mi-print').onclick = () => window.print();
  // 入住評估量表：點下跳出填寫視窗，儲存後重整（按鈕轉為綠色）
  main().querySelectorAll('[data-mi-scale]').forEach(btn => btn.onclick = () =>
    openMotherScale({ momId, mother, baby_info: {} }, btn.dataset.miScale, viewMotherIntake));

  const form = $('#mi-form');
  const gv = id => { const el = form.querySelector('#' + id); return el ? el.value.trim() : ''; };

  $('#mi-save').onclick = async () => {
    const err = $('#mi-err');
    err.textContent = '';
    // 必填掃描（下拉／文字）
    for (const el of form.querySelectorAll('[data-req]')) {
      if (!el.value.trim()) { err.textContent = '尚有必填欄位未填寫'; el.scrollIntoView({ block: 'center' }); el.focus(); return; }
    }
    // 數值範圍
    const pain = gv('mi-pain_score');
    if (pain !== '' && !(Number(pain) >= 0 && Number(pain) <= 10)) { err.textContent = '疼痛分數需為 0～10'; return; }
    // 必填旗標（radio）
    const reqRadios = [['contact_flag', '接觸史旗標'], ['infection_flag', '感染症狀旗標'], ['special_flag', '特殊需求旗標'],
      ['clot', '是否血塊'], ['breast_lump', '乳房硬塊'], ['bf_exp', '餵母奶經驗']];
    for (const [name, label] of reqRadios) {
      if (!form.querySelector(`input[name="mi-${name}"]:checked`)) { err.textContent = `請選擇「${label}」`; return; }
    }
    // 必填多選（至少一項）
    const ckVals = k => [...form.querySelectorAll(`[data-ck="${k}"]:checked`)].map(c => c.value);
    const reqMulti = [['languages', '語言'], ['delivery_modes', '生產方式'], ['needs', '入住主要需求'], ['lochia_nature', '惡露性質']];
    for (const [k, label] of reqMulti) {
      if (!ckVals(k).length) { err.textContent = `請至少勾選一項「${label}」`; return; }
    }
    // 旗標為「有」時細項至少一項
    const flagMulti = [['contact_flag', 'contact_items', '接觸史細項'], ['infection_flag', 'infection_items', '感染症狀細項'], ['special_flag', 'special_items', '特殊需求細項']];
    for (const [flag, items, label] of flagMulti) {
      const fv = (form.querySelector(`input[name="mi-${flag}"]:checked`) || {}).value;
      if (fv === '有' && !ckVals(items).length) { err.textContent = `「${label}」旗標為「有」時請至少勾選一項`; return; }
    }

    // 組 payload：所有 mi-<key> 值＋多選陣列＋旗標
    const body = {};
    form.querySelectorAll('[id^="mi-"]').forEach(el => {
      if (el.id === 'mi-mom') return;
      body[el.id.slice(3)] = el.value.trim();
    });
    [...new Set([...form.querySelectorAll('[data-ck]')].map(c => c.dataset.ck))].forEach(k => { body[k] = ckVals(k); });
    [...new Set([...form.querySelectorAll('input[type="radio"]')].map(r => r.name))].forEach(name => {
      const c = form.querySelector(`input[name="${name}"]:checked`);
      body[name.slice(3)] = c ? c.value : '';
    });
    body.recorder_id_no = idNo;

    try {
      await api(`/mothers/${momId}/intake`, { method: 'PUT', body });
      err.style.color = 'var(--primary-dark)';
      err.textContent = '已存檔 ✓';
      setTimeout(() => viewMotherIntake(), 700);
    } catch (e) { err.style.color = ''; err.textContent = e.message; }
  };
}

/* ---------- 寶寶護理每日評估（中衛必要欄位－嬰兒日常評估） ---------- */
const BNA_OPTS = {
  bath: ['盆浴', '擦澡', '未洗'],
  heart_rate: ['正常（100–160次/分）', '過速（>160次/分）', '過緩（<100次/分）'],
  respiration: ['正常（40–60次/分）', '過速（>60次/分）', '費力／胸凹', '過緩（<40次/分）'],
  lip_color: ['紅潤', '蒼白', '發紺'],
  muscle_tone: ['佳', '正常', '差'],
  appearance: ['正常', '其他'],
  cord: ['W-潮濕', 'D-乾燥', '已脫落', '發紅', '滲液／分泌物'],
  feeding_status: ['佳', '尚可', '差'],
  skin_color: ['紅潤', '黃染', '蒼白', '發紺'],
  stool_amount: ['S-少', 'M-中', 'L-多'],
  stool_color: ['M-胎便', 'T-過渡便', 'N-奶便', 'B-血便', 'O-其他'],
  stool_texture: ['軟', '稀', '水便', '硬'],
  urine_amount: ['S-少', 'M-中', 'L-多']
};
const BNA_SKIN = ['疹子', '粟粒疹', '皮下出血點', '乾燥脫皮', '水腫', '紅臀', '蒙古斑', '黃疸', '新生兒紅斑', '血管瘤', '針扎', '其他'];
const BNA_SKIN_NOTE = ['蒙古斑', '黃疸', '新生兒紅斑', '血管瘤', '針扎', '其他'];   // 勾選時補述必填
const BNA_MILK = ['母奶', '配方', '親餵'];
const BNA_SHIFTS = ['大夜', '白天', '小夜'];   // 大夜 00–08／白天 08–16／小夜 16–24
const BNA_COUNTS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'];

function bnaSel(id, opts, { req = true, blank = '請選擇' } = {}) {
  return `<select id="${id}" ${req ? 'data-req' : ''}><option value="">${blank}</option>${opts.map(o => `<option>${esc(o)}</option>`).join('')}</select>`;
}
function bnaChecks(name, opts) {
  return opts.map(o => `<label class="bna-chk"><input type="checkbox" data-ck="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('');
}
// 紅臀單側欄位（左／右）
function bnaRashBlock(side, label) {
  return `
    <div class="field"><label>紅臀-${label} <b class="req">*</b></label>
      ${bnaSel(`bna-rash-${side}`, DIAPER_RASH_LEVELS)}
      <div class="row" style="gap:10px;margin-top:6px">${bnaChecks(`rash-${side}`, ['破皮', '發紅', '滲液'])}</div>
      <input id="bna-rash-${side}-pos" placeholder="滲液時必填：位置" style="margin-top:6px">
      <input id="bna-rash-${side}-range" placeholder="滲液時必填：範圍" style="margin-top:6px">
    </div>`;
}

async function viewBabyNursing() {
  const list = await api('/room-status/babies');
  const babies = list.babies;
  if (!babies.length) {
    main().innerHTML = '<div class="page-title">寶寶護理</div><div class="card"><div class="empty">目前沒有在住寶寶</div></div>';
    return;
  }
  const want = Number((location.hash.split('?b=')[1] || '').split('&')[0]);
  const babyId = babies.some(b => b.id === want) ? want : babies[0].id;
  const { baby, rows, rooming, bf_reminder } = await api(`/babies/${babyId}/nursing`);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const listRows = rows.map(r => {
    const d = r.data || {};
    const milk = [(d.milk_types || []).join('/'), d.milk_note].filter(Boolean).join(' ');
    const skin = [d.skin_color, (d.skin_conditions || []).join('、')].filter(Boolean).join('；');
    return `
      <tr data-filter="${esc(r.assess_date)} ${esc(r.nurse_name || '')}">
        <td data-label="日期時間">${esc(r.assess_date)}<br><small>${esc(r.assess_time)}</small></td>
        <td data-label="體重/體溫">${r.weight_g} g<br><small>${r.temperature} °C</small></td>
        <td data-label="心跳/呼吸"><small>${esc(d.heart_rate || '—')}<br>${esc(d.respiration || '—')}</small></td>
        <td data-label="臍帶">${esc(d.cord || '—')}</td>
        <td data-label="奶量"><small>${esc(milk || '—')}${d.feeding_status ? `<br>哺育：${esc(d.feeding_status)}` : ''}</small></td>
        <td data-label="皮膚"><small>${esc(skin || '—')}</small></td>
        <td data-label="大便/小便"><small>大便 ${esc(d.stool ?? '—')} 次 ${esc(d.stool_amount || '')}<br>小便 ${esc(d.urine ?? '—')} 次 ${esc(d.urine_amount || '')}</small></td>
        <td data-label="親子同室">${esc(d.rooming || '—')}${(d.rooming_shifts || []).length ? `<br><small>${esc(d.rooming_shifts.join('、'))}</small>` : ''}</td>
        <td data-label="特殊情況"><small>${esc(r.special_note || '—')}</small></td>
        <td data-label="護理師">${esc(r.nurse_name || '—')}</td>
        <td data-label="" class="no-print">${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${r.id}">刪除</button>` : ''}</td>
      </tr>`;
  }).join('');

  main().innerHTML = `
    <div class="page-title">寶寶護理 <small style="font-weight:400;color:var(--muted);font-size:.9rem">中衛必要欄位－嬰兒日常評估</small></div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇寶寶</label>
          <select id="bna-baby">${babies.map(b => `<option value="${b.id}" ${b.id === babyId ? 'selected' : ''}>${esc(b.name)}（${esc(b.mother_name)}${b.room_name ? `／${esc(b.room_name)}` : ''}）</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/baby-rooms">回寶寶房況</a>
        <a class="btn small secondary" href="#/baby-eval?b=${babyId}">寶寶評估單</a>
        ${canAccess('#/baby-doctor') ? `<a class="btn small secondary" href="#/baby-doctor?b=${babyId}">醫師巡診</a>` : ''}
        <a class="btn small secondary" href="#/breastfeeding?b=${babyId}">母乳哺育評估</a>
        <a class="btn small secondary" href="#/baby-handover?b=${babyId}">新生兒交班單</a>
        <a class="btn small secondary" href="#/baby-close?b=${babyId}">嬰兒結案</a>
        <a class="btn small secondary" href="#/baby-care">嬰兒照護紀錄</a>
        <button class="btn small secondary" id="bna-print">資料列印</button>
      </div>
    </div>
    <div class="card">
      <div class="row" style="gap:6px 18px;flex-wrap:wrap;font-size:.95rem">
        <span><b>媽媽：</b>${baby.room_name ? `${esc(baby.room_name)}　` : ''}${esc(baby.mother_name)}</span>
        ${baby.mother_check_in ? `<span><b>媽媽入住：</b>${esc(baby.mother_check_in)}</span>` : ''}
        ${baby.mother_check_out ? `<span><b>媽媽預退：</b>${esc(baby.mother_check_out)}</span>` : ''}
        <span><b>寶寶：</b>${esc(baby.name)}${baby.gender ? `（${baby.gender === 'male' ? '男' : '女'}）` : ''}</span>
        ${baby.birth_date ? `<span><b>出生：</b>${esc(baby.birth_date)}</span>` : ''}
        <span class="badge ${LOCATION_BADGE[baby.location] || 'gray'}">${LOCATION_LABEL[baby.location] || '-'}</span>
      </div>
    </div>
    <div class="card no-print">
      <h3>嬰兒日常評估（<b class="req">*</b> 為必填）</h3>
      <div class="form-grid">
        <div class="field"><label>嬰兒病歷號</label><input id="bna-medno"></div>
        <div class="field"><label>評估日期 <b class="req">*</b></label><input type="date" id="bna-date" value="${todayStr()}"></div>
        <div class="field"><label>評估時間 <b class="req">*</b></label><input type="time" id="bna-time" value="${hhmm}"></div>
        <div class="field"><label>體重（g）<b class="req">*</b></label><input type="number" step="0.1" min="0" id="bna-weight" placeholder="範圍：0～99999.9"></div>
        <div class="field"><label>體溫（°C）<b class="req">*</b></label><input type="number" step="0.1" min="0" id="bna-temp" placeholder="範圍：0～99.9"></div>
        <div class="field"><label>洗澡 <b class="req">*</b></label>${bnaSel('bna-bath', BNA_OPTS.bath)}</div>
        <div class="field"><label>心跳 <b class="req">*</b></label>${bnaSel('bna-hr', BNA_OPTS.heart_rate)}</div>
        <div class="field"><label>呼吸 <b class="req">*</b></label>${bnaSel('bna-resp', BNA_OPTS.respiration)}</div>
        <div class="field"><label>唇色 <b class="req">*</b></label>${bnaSel('bna-lip', BNA_OPTS.lip_color)}</div>
        <div class="field"><label>肌張活動力 <b class="req">*</b></label>${bnaSel('bna-tone', BNA_OPTS.muscle_tone)}</div>
        <div class="field"><label>外觀 <b class="req">*</b></label>${bnaSel('bna-look', BNA_OPTS.appearance)}</div>
        <div class="field"><label>外觀補述<small>（選「其他」時必填）</small></label><input id="bna-look-note" maxlength="100"></div>
        <div class="field"><label>臍帶 <b class="req">*</b><small>（W-潮濕；D-乾燥）</small></label>${bnaSel('bna-cord', BNA_OPTS.cord)}</div>
        <div class="field"><label>奶量 <b class="req">*</b></label><div class="row" style="gap:10px;padding-top:8px">${bnaChecks('milk', BNA_MILK)}</div></div>
        <div class="field"><label>奶量補述 <b class="req">*</b></label><input id="bna-milk-note" placeholder="範例：30,20" maxlength="50"></div>
        <div class="field"><label>哺育情況 <b class="req">*</b></label>${bnaSel('bna-feedst', BNA_OPTS.feeding_status)}</div>
        <div class="field"><label>皮膚顏色 <b class="req">*</b></label>${bnaSel('bna-skin', BNA_OPTS.skin_color)}</div>
        <div class="field full"><label>皮膚其他情形（多選）</label><div class="row" style="gap:8px 14px;flex-wrap:wrap">${bnaChecks('skincond', BNA_SKIN)}</div></div>
        ${BNA_SKIN_NOTE.map(k => `<div class="field"><label>${k}補述<small>（勾選「${k}」時必填）</small></label><input data-skin-note="${k}" maxlength="50"></div>`).join('')}
        ${bnaRashBlock('left', '左臀')}
        ${bnaRashBlock('right', '右臀')}
        <div class="field"><label>大便（次）<b class="req">*</b></label>${bnaSel('bna-stool', BNA_COUNTS)}</div>
        <div class="field"><label>大便次數補述</label><input id="bna-stool-note" maxlength="100"></div>
        <div class="field"><label>大便量</label>${bnaSel('bna-stool-amt', BNA_OPTS.stool_amount, { req: false })}</div>
        <div class="field"><label>大便色及性質</label>${bnaSel('bna-stool-color', BNA_OPTS.stool_color, { req: false })}</div>
        <div class="field"><label>大便色及性質補述</label><input id="bna-stool-color-note" maxlength="100"></div>
        <div class="field"><label>大便軟硬</label>${bnaSel('bna-stool-tex', BNA_OPTS.stool_texture, { req: false })}</div>
        <div class="field"><label>小便（次）<b class="req">*</b></label>${bnaSel('bna-urine', BNA_COUNTS)}</div>
        <div class="field"><label>小便次數補述</label><input id="bna-urine-note" maxlength="100"></div>
        <div class="field"><label>小便量</label>${bnaSel('bna-urine-amt', BNA_OPTS.urine_amount, { req: false })}</div>
        <div class="field"><label>小便性狀</label><input id="bna-urine-desc" maxlength="100"></div>
        <div class="field"><label>有無親子同室 <b class="req">*</b></label>${bnaSel('bna-rooming', ['有', '無'])}</div>
        <div class="field"><label>親子同室時間<small>（大夜 00–08／白天 08–16／小夜 16–24）</small></label><div class="row" style="gap:10px;padding-top:8px">${bnaChecks('shift', BNA_SHIFTS)}</div></div>
        <div class="field full"><label>特殊情況及處理</label><textarea id="bna-special" maxlength="500"></textarea></div>
        <div class="field"><label>護理人員身分證字號</label><input id="bna-nurseid" maxlength="10"></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="bna-save">資料新增</button>
          <span class="error-msg" id="bna-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="row between no-print">
        <h3>寶寶護理資料（${rows.length} 筆）</h3>
      </div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>日期時間</th><th>體重/體溫</th><th>心跳/呼吸</th><th>臍帶</th><th>奶量</th><th>皮膚</th><th>大便/小便</th><th>親子同室</th><th>特殊情況</th><th>護理師</th><th class="no-print"></th></tr></thead>
          <tbody>${listRows || '<tr><td colspan="11"><div class="empty">尚無護理紀錄</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card no-print">
      <div class="row between" style="flex-wrap:wrap;gap:8px">
        <h3>母乳哺育評估</h3>
        <a class="btn danger" href="#/breastfeeding?b=${babyId}">母乳哺育評估</a>
      </div>
      <h4 style="color:var(--primary-dark);font-size:.95rem;margin:10px 0 6px">哺餵母乳評估提醒紀錄</h4>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>筆數</th><th>提醒日期</th><th>入住天數</th><th>執行日期</th><th>執行人員</th></tr></thead>
          <tbody>${bf_reminder ? `
            <tr>
              <td data-label="筆數">1</td>
              <td data-label="提醒日期">${esc(bf_reminder.remind_date)}</td>
              <td data-label="入住天數">${esc(bf_reminder.day_label)}</td>
              <td data-label="執行日期">${bf_reminder.done_date ? esc(bf_reminder.done_date) : '<span class="badge yellow">未執行</span>'}</td>
              <td data-label="執行人員">${esc(bf_reminder.done_by || '—')}</td>
            </tr>` : '<tr><td colspan="5"><div class="empty">媽媽尚未入住，無提醒排程</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $('#bna-baby').onchange = () => { location.hash = `#/baby-nursing?b=${$('#bna-baby').value}`; };
  $('#bna-print').onclick = () => window.print();

  const ckVals = name => [...main().querySelectorAll(`[data-ck="${name}"]:checked`)].map(c => c.value);
  $('#bna-save').onclick = async () => {
    const err = $('#bna-err');
    err.textContent = '';
    const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
    // 必填檢核（比照中衛欄位）
    for (const el of main().querySelectorAll('[data-req]')) {
      if (!el.value) { err.textContent = '尚有必填欄位未選擇'; el.focus(); return; }
    }
    if (!v('#bna-weight') || !v('#bna-temp')) { err.textContent = '請填寫體重與體溫'; return; }
    const milk = ckVals('milk');
    if (!milk.length) { err.textContent = '奶量請至少勾選一項（母奶／配方／親餵）'; return; }
    if (!v('#bna-milk-note')) { err.textContent = '請填寫奶量補述（範例：30,20）'; return; }
    if (v('#bna-look') === '其他' && !v('#bna-look-note')) { err.textContent = '外觀選「其他」時，外觀補述必填'; return; }
    const skinCond = ckVals('skincond');
    const skinNotes = {};
    for (const k of BNA_SKIN_NOTE) {
      const note = main().querySelector(`[data-skin-note="${k}"]`).value.trim();
      if (skinCond.includes(k) && !note) { err.textContent = `勾選「${k}」時，${k}補述必填`; return; }
      if (note) skinNotes[k] = note;
    }
    const rash = side => {
      const flags = ckVals(`rash-${side}`);
      return { level: v(`#bna-rash-${side}`), flags, pos: v(`#bna-rash-${side}-pos`), range: v(`#bna-rash-${side}-range`) };
    };
    const rashL = rash('left'), rashR = rash('right');
    for (const [r, lbl] of [[rashL, '左臀'], [rashR, '右臀']]) {
      if (r.flags.includes('滲液') && (!r.pos || !r.range)) { err.textContent = `紅臀-${lbl}勾選「滲液」時，位置與範圍必填`; return; }
    }
    try {
      await api(`/babies/${babyId}/nursing`, { method: 'POST', body: {
        assess_date: v('#bna-date'), assess_time: v('#bna-time'),
        weight_g: Number(v('#bna-weight')), temperature: Number(v('#bna-temp')),
        medical_no: v('#bna-medno'), bath: v('#bna-bath'),
        heart_rate: v('#bna-hr'), respiration: v('#bna-resp'), lip_color: v('#bna-lip'),
        muscle_tone: v('#bna-tone'), appearance: v('#bna-look'), appearance_note: v('#bna-look-note'),
        cord: v('#bna-cord'), milk_types: milk, milk_note: v('#bna-milk-note'),
        feeding_status: v('#bna-feedst'), skin_color: v('#bna-skin'),
        skin_conditions: skinCond, skin_notes: skinNotes,
        rash_left: rashL, rash_right: rashR,
        stool: v('#bna-stool'), stool_count_note: v('#bna-stool-note'),
        stool_amount: v('#bna-stool-amt'), stool_color: v('#bna-stool-color'),
        stool_color_note: v('#bna-stool-color-note'), stool_texture: v('#bna-stool-tex'),
        urine: v('#bna-urine'), urine_count_note: v('#bna-urine-note'),
        urine_amount: v('#bna-urine-amt'), urine_note: v('#bna-urine-desc'),
        rooming: v('#bna-rooming'), rooming_shifts: ckVals('shift'),
        special_note: v('#bna-special'), nurse_id_no: v('#bna-nurseid')
      } });
      viewBabyNursing();
    } catch (e) { err.textContent = e.message; }
  };

  main().querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆護理紀錄？（會記入稽核軌跡）')) return;
      await api(`/baby-nursing/${btn.dataset.del}`, { method: 'DELETE' });
      viewBabyNursing();
    };
  });
}

/* ---------- 寶寶評估單（中衛必要欄位－嬰兒個案基本資料＋嬰兒入住評估） ---------- */
const BEV_OPTS = {
  delivery: ['自然生產', '剖腹生產', '真空吸引', '產鉗', 'VBAC', '其他'],
  weight_cat: ['未滿 1,500g', '1,500～2,499g', '2,500～4,000g', '4,001g 以上'],
  length_cat: ['未滿 45cm', '45～55cm', '55cm 以上'],
  yn: ['無', '有'],
  metabolic: ['已採檢', '未採檢'],
  head_status: ['正常', '異常'],
  fontanelle: ['平坦', '凸出', '凹陷', '過小'],
  scalp: ['正常', '產瘤', '頭血腫', '其他'],
  eye: ['正常', '分泌物', '結膜下出血', '其他'],
  pupil: ['正常', '異常'],
  ear: ['正常', '耳前瘻管', '副耳', '低位耳', '其他'],
  nose: ['正常', '鼻塞', '鼻翼搧動', '其他'],
  mouth: ['正常', '異常'],
  neck: ['正常', '斜頸', '腫塊', '其他'],
  skin_color: ['紅潤', '蒼白', '發紺', '黃疸'],
  chest: ['正常（對稱）', '凹陷', '凸出', '其他'],
  resp_rate: ['正常（40–60次/分）', '過速（>60次/分）', '過緩（<40次/分）'],
  resp_pattern: ['規則', '不規則', '胸凹', '呻吟', '其他'],
  heart_rate: ['正常（100–160次/分）', '過速（>160次/分）', '過緩（<100次/分）', '其他'],
  limb_temp: ['溫暖', '冰冷'],
  limb_color: ['紅潤', '蒼白', '發紺'],
  abdomen: ['柔軟', '腹脹', '其他'],
  bowel: ['正常', '亢進', '減弱', '無']
};
const BEV_MOUTH = ['唇裂', '歪嘴', '大舌頭', '舌苔', '分泌物過多', '上顎珍珠瘤', '其他'];
// 流感／腸病毒症狀（key、標籤）：文字選填，最多 50 字
const BEV_FLU = [['flu_fever', '流感症狀－發燒'], ['flu_cough', '流感症狀－咳嗽'], ['flu_diarrhea', '流感症狀－腹瀉'], ['flu_rash', '流感症狀－皮疹']];
const BEV_EV = [['ev_temp', '腸病毒症狀－體溫異常'], ['ev_mouth_red', '腸病毒症狀－口腔泛紅'], ['ev_mouth_blister', '腸病毒症狀－口腔水泡'],
  ['ev_limb_blister', '腸病毒症狀－手足水泡'], ['ev_limb_rash', '腸病毒症狀－手足紅疹']];

function bevSel(id, opts, val = '', { req = true } = {}) {
  return `<select id="${id}" ${req ? 'data-req' : ''}><option value="">請選擇</option>${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
}
// 左／右臀紅臀欄位（程度＋破皮/發紅/滲液＋滲液位置範圍）
function bevRashBlock(side, label, r = {}) {
  const flags = r.flags || [];
  return `
    <div class="field"><label>${label}紅臀 <b class="req">*</b></label>
      ${bevSel(`bev-rash-${side}`, DIAPER_RASH_LEVELS, r.level || '')}
      <div class="row" style="gap:10px;margin-top:6px">${['破皮', '發紅', '滲液'].map(o =>
        `<label class="bna-chk"><input type="checkbox" data-ck="bev-rash-${side}" value="${o}" ${flags.includes(o) ? 'checked' : ''}> ${o}</label>`).join('')}</div>
      <input id="bev-rash-${side}-pos" placeholder="滲液時必填：位置" maxlength="100" style="margin-top:6px" value="${esc(r.pos || '')}">
      <input id="bev-rash-${side}-range" placeholder="滲液時必填：範圍" maxlength="100" style="margin-top:6px" value="${esc(r.range || '')}">
    </div>`;
}

async function viewBabyEval() {
  const list = await api('/room-status/babies');
  const babies = list.babies;
  if (!babies.length) {
    main().innerHTML = '<div class="page-title">寶寶評估單</div><div class="card"><div class="empty">目前沒有在住寶寶</div></div>';
    return;
  }
  const want = Number((location.hash.split('?b=')[1] || '').split('&')[0]);
  const babyId = babies.some(b => b.id === want) ? want : babies[0].id;
  const { baby, medical_no, profile, rows } = await api(`/babies/${babyId}/eval`);
  const d = (profile && profile.data) || {};
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const idNo = currentUser.id_no || '';

  const listRows = rows.map(r => {
    const a = r.data || {};
    const rashL = a.rash_left || {}, rashR = a.rash_right || {};
    return `
      <tr data-filter="${esc(r.assess_date)} ${esc(r.nurse_name || '')}">
        <td data-label="日期時間">${esc(r.assess_date)}<br><small>${esc(r.assess_time)}</small></td>
        <td data-label="BT/HR/RR"><small>${esc(a.bt ?? '—')} °C<br>${esc(a.hr ?? '—')}／${esc(a.rr ?? '—')} bpm</small></td>
        <td data-label="頭圍">${esc(a.head_circ ?? '—')} cm${a.head_status ? `<br><small>${esc(a.head_status)}</small>` : ''}</td>
        <td data-label="頭部"><small>囟門 ${esc(a.fontanelle || '—')}<br>頭皮 ${esc(a.scalp || '—')}</small></td>
        <td data-label="皮膚"><small>${esc([a.skin_color, (a.skin_conditions || []).join('、')].filter(Boolean).join('；') || '—')}</small></td>
        <td data-label="紅臀"><small>左 ${esc(rashL.level || '—')}／右 ${esc(rashR.level || '—')}</small></td>
        <td data-label="呼吸/心跳"><small>${esc(a.resp_rate || '—')}<br>${esc(a.heart_rate || '—')}</small></td>
        <td data-label="評估者">${esc(r.nurse_name || '—')}</td>
        <td data-label="" class="no-print">${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${r.id}">刪除</button>` : ''}</td>
      </tr>`;
  }).join('');

  main().innerHTML = `
    <div class="page-title">寶寶評估單 <small style="font-weight:400;color:var(--muted);font-size:.9rem">寶寶護理資料評估表</small></div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇寶寶</label>
          <select id="bev-baby">${babies.map(b => `<option value="${b.id}" ${b.id === babyId ? 'selected' : ''}>${esc(b.name)}（${esc(b.mother_name)}${b.room_name ? `／${esc(b.room_name)}` : ''}）</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/baby-rooms">回寶寶房況</a>
        <a class="btn small secondary" href="#/baby-nursing?b=${babyId}">寶寶護理</a>
        <button class="btn small secondary" id="bev-print">資料列印</button>
      </div>
    </div>
    <div class="card">
      <div class="row" style="gap:6px 18px;flex-wrap:wrap;font-size:.95rem">
        <span><b>寶寶：</b>${esc(baby.name)}${baby.gender ? `（${baby.gender === 'male' ? '男' : '女'}）` : ''}</span>
        <span><b>媽媽：</b>${baby.room_name ? `${esc(baby.room_name)}　` : ''}${esc(baby.mother_name)}</span>
        <span><b>嬰兒病歷號：</b>${esc(medical_no)}</span>
        ${profile ? `<span style="color:var(--muted)">個案資料最後存檔：${esc(profile.updated_at)}（${esc(profile.nurse_name || '—')}）</span>` : '<span class="badge yellow">個案基本資料尚未建立</span>'}
      </div>
    </div>
    <div class="card" id="bev-a">
      <div class="sec-hd">中衛必要欄位－嬰兒個案基本資料（<b>*</b> 為必填）</div>
      <div class="form-grid">
        <div class="field"><label>入住日期 <b class="req">*</b></label><input type="date" id="bev-ci-date" data-req value="${esc(d.checkin_date || baby.baby_check_in || baby.mother_check_in || todayStr())}"></div>
        <div class="field"><label>入住時間 <b class="req">*</b></label>
          <div class="row" style="gap:8px"><input type="time" id="bev-ci-time" data-req value="${esc(d.checkin_time || hhmm)}" style="flex:1">
          <button class="btn small" id="bev-ci-save" type="button">入住日存檔</button></div></div>
        <div class="field"><label>出生日期 <b class="req">*</b></label><input type="date" id="bev-b-date" data-req value="${esc(d.birth_date || baby.birth_date || '')}"></div>
        <div class="field"><label>出生時間 <b class="req">*</b></label><input type="time" id="bev-b-time" data-req value="${esc(d.birth_time || '')}"></div>
        <div class="field"><label>嬰兒病歷號 <b class="req">*</b><small>（系統帶入）</small></label><input value="${esc(medical_no)}" disabled></div>
        <div class="field"><label>出生地點 <b class="req">*</b><small>（最多100字）</small></label><input id="bev-b-place" data-req maxlength="100" value="${esc(d.birth_place || '')}"></div>
        <div class="field"><label>APGAR（1~10）<b class="req">*</b></label><input type="number" id="bev-apgar" data-req min="1" max="10" value="${esc(d.apgar ?? '')}"></div>
        <div class="field full"><label>生產方式（多選）<b class="req">*</b></label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${BEV_OPTS.delivery.map(o =>
            `<label class="bna-chk"><input type="checkbox" data-ck="bev-delivery" value="${o}" ${(d.delivery_modes || []).includes(o) ? 'checked' : ''}> ${o}</label>`).join('')}</div></div>
        <div class="field"><label>生產方式其他<small>（勾選「其他」時必填，最多100字）</small></label><input id="bev-delivery-other" maxlength="100" value="${esc(d.delivery_other || '')}"></div>
        <div class="field"><label>出生體重(g) <b class="req">*</b></label>${bevSel('bev-bw-cat', BEV_OPTS.weight_cat, d.birth_weight_cat || '')}
          <input type="number" id="bev-bw" min="0" placeholder="實際數值（g，選填）" style="margin-top:6px" value="${esc(d.birth_weight_g ?? '')}"></div>
        <div class="field"><label>出院體重(g) <b class="req">*</b></label>${bevSel('bev-dw-cat', BEV_OPTS.weight_cat, d.discharge_weight_cat || '')}
          <input type="number" id="bev-dw" min="0" placeholder="實際數值（g，選填）" style="margin-top:6px" value="${esc(d.discharge_weight_g ?? '')}"></div>
        <div class="field"><label>現在體重(g) <b class="req">*</b></label><input type="number" id="bev-cw" data-req min="0" value="${esc(d.current_weight_g ?? '')}"></div>
        <div class="field"><label>出生身長(cm) <b class="req">*</b></label>${bevSel('bev-bl-cat', BEV_OPTS.length_cat, d.birth_length_cat || '')}
          <input type="number" step="0.1" id="bev-bl" min="0" placeholder="實際數值（cm，選填）" style="margin-top:6px" value="${esc(d.birth_length_cm ?? '')}"></div>
        <div class="field"><label>現在身長(cm) <b class="req">*</b></label><input type="number" step="0.1" id="bev-cl" data-req min="0" value="${esc(d.current_length_cm ?? '')}"></div>
        <div class="field"><label>PROM <b class="req">*</b><small>（早期破水）</small></label>${bevSel('bev-prom', BEV_OPTS.yn, d.prom || '')}</div>
        <div class="field"><label>DOIC <b class="req">*</b></label>${bevSel('bev-doic', BEV_OPTS.yn, d.doic || '')}</div>
        <div class="field"><label>胎便吸入(MA) <b class="req">*</b></label>${bevSel('bev-ma', BEV_OPTS.yn, d.ma || '')}</div>
        <div class="field"><label>代謝篩檢 <b class="req">*</b></label>${bevSel('bev-meta', BEV_OPTS.metabolic, d.metabolic_screen || '')}</div>
        <div class="field"><label>代謝篩檢日期<small>（選「已採檢」時必填）</small></label><input type="date" id="bev-meta-date" value="${esc(d.metabolic_screen_date || '')}"></div>
        <div class="field"><label>預防注射 <b class="req">*</b></label>${bevSel('bev-vac', BEV_OPTS.yn, d.vaccination || '')}</div>
        <div class="field"><label>HBIG注射日期</label><input type="date" id="bev-hbig" value="${esc(d.hbig_date || '')}"></div>
        <div class="field"><label>HBV注射日期</label><input type="date" id="bev-hbv" value="${esc(d.hbv_date || '')}"></div>
        ${BEV_FLU.map(([k, label]) => `<div class="field"><label>${label}<small>（最多50字，選填）</small></label><input data-bev-a="${k}" maxlength="50" value="${esc(d[k] || '')}"></div>`).join('')}
        ${BEV_EV.map(([k, label]) => `<div class="field"><label>${label}<small>（最多50字，選填）</small></label><input data-bev-a="${k}" maxlength="50" value="${esc(d[k] || '')}"></div>`).join('')}
        <div class="field"><label>特殊照護需求<small>（最多200字，選填）</small></label><input id="bev-special" maxlength="200" value="${esc(d.special_care || '')}"></div>
        <div class="field"><label>照護人員身分證字號 <b class="req">*</b><small>（自動帶入登入者，不可修改）</small></label><input value="${esc(idNo)}" placeholder="${idNo ? '' : '請於帳號管理維護身分證字號'}" disabled></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="bev-a-save">個案基本資料存檔</button>
          <span class="error-msg" id="bev-a-err"></span>
        </div>
      </div>
    </div>
    <div class="card" id="bev-b">
      <div class="sec-hd">中衛必要欄位－嬰兒入住評估（<b>*</b> 為必填）</div>
      <div class="form-grid">
        <div class="field"><label>嬰兒病歷號 <b class="req">*</b><small>（沿用病歷號，只讀）</small></label><input value="${esc(medical_no)}" disabled></div>
        <div class="field"><label>評估日期 <b class="req">*</b></label><input type="date" id="bev-as-date" value="${todayStr()}"></div>
        <div class="field"><label>評估時間 <b class="req">*</b></label><input type="time" id="bev-as-time" value="${hhmm}"></div>
        <div class="field"><label>BT(肛溫) <b class="req">*</b><small>（°C）</small></label><input type="number" step="0.1" min="0" id="bev-bt" placeholder="範圍：0～99.9"></div>
        <div class="field"><label>HR(心跳) <b class="req">*</b><small>（bpm）</small></label><input type="number" min="0" id="bev-hr" placeholder="範圍：0～999"></div>
        <div class="field"><label>RR(呼吸) <b class="req">*</b><small>（bpm）</small></label><input type="number" min="0" id="bev-rr" placeholder="範圍：0～999"></div>
        <div class="field"><label>頭圍(cm) <b class="req">*</b><small>（數值，小數1位，0～999.9）</small></label><input type="number" step="0.1" min="0" id="bev-head"></div>
        <div class="field"><label>頭圍狀態 <b class="req">*</b></label>${bevSel('bev-head-st', BEV_OPTS.head_status)}</div>
        <div class="field"><label>頭圍狀態補述<small>（選「異常」時必填，最多100字）</small></label><input id="bev-head-note" maxlength="100"></div>
        <div class="field"><label>囟門 <b class="req">*</b></label>${bevSel('bev-font', BEV_OPTS.fontanelle)}</div>
        <div class="field"><label>囟門補述<small>（選「過小」時必填，最多100字）</small></label><input id="bev-font-note" maxlength="100"></div>
        <div class="field"><label>頭皮 <b class="req">*</b></label>${bevSel('bev-scalp', BEV_OPTS.scalp)}</div>
        <div class="field"><label>頭血腫部位<small>（頭血腫時填寫，最多50字）</small></label><input id="bev-hema-site" maxlength="50"></div>
        <div class="field"><label>頭血腫大小<small>（頭血腫時填寫，最多50字）</small></label><input id="bev-hema-size" maxlength="50"></div>
        <div class="field"><label>頭皮其他補述<small>（選「其他」時必填，最多50字）</small></label><input id="bev-scalp-note" maxlength="50"></div>
        <div class="field"><label>左眼 <b class="req">*</b></label>${bevSel('bev-eye-l', BEV_OPTS.eye)}</div>
        <div class="field"><label>右眼 <b class="req">*</b></label>${bevSel('bev-eye-r', BEV_OPTS.eye)}</div>
        <div class="field"><label>左瞳孔</label>${bevSel('bev-pupil-l', BEV_OPTS.pupil, '', { req: false })}</div>
        <div class="field"><label>右瞳孔</label>${bevSel('bev-pupil-r', BEV_OPTS.pupil, '', { req: false })}</div>
        <div class="field"><label>耳朵 <b class="req">*</b></label>${bevSel('bev-ear', BEV_OPTS.ear)}</div>
        <div class="field"><label>耳朵補述<small>（選「其他」時必填，最多100字）</small></label><input id="bev-ear-note" maxlength="100"></div>
        <div class="field"><label>鼻子 <b class="req">*</b></label>${bevSel('bev-nose', BEV_OPTS.nose)}</div>
        <div class="field"><label>鼻子補述<small>（選「其他」時必填，最多100字）</small></label><input id="bev-nose-note" maxlength="100"></div>
        <div class="field"><label>口腔 <b class="req">*</b></label>${bevSel('bev-mouth', BEV_OPTS.mouth)}</div>
        <div class="field full"><label>口腔其他狀態（多選）</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${BEV_MOUTH.map(o =>
            `<label class="bna-chk"><input type="checkbox" data-ck="bev-mouth" value="${o}"> ${o}</label>`).join('')}</div></div>
        <div class="field"><label>口腔其他補述<small>（勾選「其他」時必填，最多100字）</small></label><input id="bev-mouth-note" maxlength="100"></div>
        <div class="field"><label>頸部 <b class="req">*</b></label>${bevSel('bev-neck', BEV_OPTS.neck)}</div>
        <div class="field"><label>頸部補述<small>（選「其他」時必填，最多100字）</small></label><input id="bev-neck-note" maxlength="100"></div>
        <div class="field"><label>皮膚顏色 <b class="req">*</b></label>${bevSel('bev-skin', BEV_OPTS.skin_color)}</div>
        <div class="field full"><label>皮膚其他情形（多選）</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${BNA_SKIN.map(o =>
            `<label class="bna-chk"><input type="checkbox" data-ck="bev-skincond" value="${o}"> ${o}</label>`).join('')}</div></div>
        ${BNA_SKIN_NOTE.map(k => `<div class="field"><label>${k}補述<small>（勾選「${k}」時必填，最多100字）</small></label><input data-bev-skin-note="${k}" maxlength="100"></div>`).join('')}
        ${bevRashBlock('left', '左臀')}
        ${bevRashBlock('right', '右臀')}
        <div class="field"><label>胸部外觀 <b class="req">*</b></label>${bevSel('bev-chest', BEV_OPTS.chest)}</div>
        <div class="field"><label>胸部補述<small>（選「其他」時必填，最多100字）</small></label><input id="bev-chest-note" maxlength="100"></div>
        <div class="field"><label>呼吸速率 <b class="req">*</b></label>${bevSel('bev-resp', BEV_OPTS.resp_rate)}</div>
        <div class="field"><label>呼吸型態 <b class="req">*</b></label>${bevSel('bev-resp-pat', BEV_OPTS.resp_pattern)}</div>
        <div class="field"><label>呼吸型態補述<small>（選「其他」時必填，最多100字）</small></label><input id="bev-resp-note" maxlength="100"></div>
        <div class="field"><label>心跳速率 <b class="req">*</b></label>${bevSel('bev-hr-rate', BEV_OPTS.heart_rate)}</div>
        <div class="field"><label>心跳速率補述<small>（選「其他」時必填，最多100字）</small></label><input id="bev-hr-note" maxlength="100"></div>
        <div class="field"><label>四肢循環溫度 <b class="req">*</b></label>${bevSel('bev-limb-t', BEV_OPTS.limb_temp)}</div>
        <div class="field"><label>四肢循環顏色 <b class="req">*</b></label>${bevSel('bev-limb-c', BEV_OPTS.limb_color)}</div>
        <div class="field"><label>腹部外觀 <b class="req">*</b></label>${bevSel('bev-abd', BEV_OPTS.abdomen)}</div>
        <div class="field"><label>腹部補述<small>（非柔軟時必填，最多100字）</small></label><input id="bev-abd-note" maxlength="100"></div>
        <div class="field"><label>腸音 <b class="req">*</b></label>${bevSel('bev-bowel', BEV_OPTS.bowel)}</div>
        <div class="field"><label>照護人員身分證字號 <b class="req">*</b><small>（自動帶入登入者，不可修改）</small></label><input value="${esc(idNo)}" placeholder="${idNo ? '' : '請於帳號管理維護身分證字號'}" disabled></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="bev-b-save">入住評估存檔</button>
          <span class="error-msg" id="bev-b-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>入住評估紀錄（${rows.length} 筆）</h3>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>日期時間</th><th>BT/HR/RR</th><th>頭圍</th><th>頭部</th><th>皮膚</th><th>紅臀</th><th>呼吸/心跳</th><th>評估者</th><th class="no-print"></th></tr></thead>
          <tbody>${listRows || '<tr><td colspan="9"><div class="empty">尚無入住評估紀錄</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $('#bev-baby').onchange = () => { location.hash = `#/baby-eval?b=${$('#bev-baby').value}`; };
  $('#bev-print').onclick = () => window.print();

  const secA = $('#bev-a'), secB = $('#bev-b');
  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
  const ckVals = (sec, name) => [...sec.querySelectorAll(`[data-ck="${name}"]:checked`)].map(c => c.value);

  // 入住日存檔：只儲存入住日期／時間（同步至訂房「寶寶入住日」）
  $('#bev-ci-save').onclick = async () => {
    const err = $('#bev-a-err');
    err.textContent = '';
    if (!v('#bev-ci-date') || !v('#bev-ci-time')) { err.textContent = '請填寫入住日期與入住時間'; return; }
    try {
      await api(`/babies/${babyId}/eval-profile`, { method: 'PUT', body: {
        checkin_date: v('#bev-ci-date'), checkin_time: v('#bev-ci-time'), caregiver_id_no: idNo
      } });
      err.textContent = '';
      $('#bev-ci-save').textContent = '已存檔 ✓';
      setTimeout(() => { const b = $('#bev-ci-save'); if (b) b.textContent = '入住日存檔'; }, 1500);
    } catch (e) { err.textContent = e.message; }
  };

  // 個案基本資料存檔（整份）
  $('#bev-a-save').onclick = async () => {
    const err = $('#bev-a-err');
    err.textContent = '';
    for (const el of secA.querySelectorAll('[data-req]')) {
      if (!el.value) { err.textContent = '尚有必填欄位未填寫'; el.focus(); return; }
    }
    const apgar = Number(v('#bev-apgar'));
    if (!(apgar >= 1 && apgar <= 10)) { err.textContent = 'APGAR 需為 1～10'; return; }
    const delivery = ckVals(secA, 'bev-delivery');
    if (!delivery.length) { err.textContent = '生產方式請至少勾選一項'; return; }
    if (delivery.includes('其他') && !v('#bev-delivery-other')) { err.textContent = '生產方式勾選「其他」時，生產方式其他必填'; return; }
    if (v('#bev-meta') === '已採檢' && !v('#bev-meta-date')) { err.textContent = '代謝篩檢選「已採檢」時，代謝篩檢日期必填'; return; }
    const body = {
      checkin_date: v('#bev-ci-date'), checkin_time: v('#bev-ci-time'),
      birth_date: v('#bev-b-date'), birth_time: v('#bev-b-time'),
      birth_place: v('#bev-b-place'), apgar: v('#bev-apgar'),
      delivery_modes: delivery, delivery_other: v('#bev-delivery-other'),
      birth_weight_cat: v('#bev-bw-cat'), birth_weight_g: v('#bev-bw'),
      discharge_weight_cat: v('#bev-dw-cat'), discharge_weight_g: v('#bev-dw'),
      current_weight_g: v('#bev-cw'),
      birth_length_cat: v('#bev-bl-cat'), birth_length_cm: v('#bev-bl'), current_length_cm: v('#bev-cl'),
      prom: v('#bev-prom'), doic: v('#bev-doic'), ma: v('#bev-ma'),
      metabolic_screen: v('#bev-meta'), metabolic_screen_date: v('#bev-meta-date'),
      vaccination: v('#bev-vac'), hbig_date: v('#bev-hbig'), hbv_date: v('#bev-hbv'),
      special_care: v('#bev-special'), caregiver_id_no: idNo
    };
    for (const el of secA.querySelectorAll('[data-bev-a]')) body[el.dataset.bevA] = el.value.trim();
    try {
      await api(`/babies/${babyId}/eval-profile`, { method: 'PUT', body });
      viewBabyEval();
    } catch (e) { err.textContent = e.message; }
  };

  // 入住評估存檔（新增一筆）
  $('#bev-b-save').onclick = async () => {
    const err = $('#bev-b-err');
    err.textContent = '';
    if (!v('#bev-as-date') || !v('#bev-as-time')) { err.textContent = '請填寫評估日期與評估時間'; return; }
    if (!v('#bev-bt') || !v('#bev-hr') || !v('#bev-rr') || !v('#bev-head')) { err.textContent = '請填寫 BT／HR／RR／頭圍'; return; }
    for (const el of secB.querySelectorAll('[data-req]')) {
      if (!el.value) { err.textContent = '尚有必填欄位未選擇'; el.focus(); return; }
    }
    // 條件必填檢核（比照中衛欄位）
    const conds = [
      ['#bev-head-st', '異常', '#bev-head-note', '頭圍狀態選「異常」時，頭圍狀態補述必填'],
      ['#bev-font', '過小', '#bev-font-note', '囟門選「過小」時，囟門補述必填'],
      ['#bev-scalp', '其他', '#bev-scalp-note', '頭皮選「其他」時，頭皮其他補述必填'],
      ['#bev-ear', '其他', '#bev-ear-note', '耳朵選「其他」時，耳朵補述必填'],
      ['#bev-nose', '其他', '#bev-nose-note', '鼻子選「其他」時，鼻子補述必填'],
      ['#bev-neck', '其他', '#bev-neck-note', '頸部選「其他」時，頸部補述必填'],
      ['#bev-chest', '其他', '#bev-chest-note', '胸部外觀選「其他」時，胸部補述必填'],
      ['#bev-resp-pat', '其他', '#bev-resp-note', '呼吸型態選「其他」時，呼吸型態補述必填'],
      ['#bev-hr-rate', '其他', '#bev-hr-note', '心跳速率選「其他」時，心跳速率補述必填']
    ];
    for (const [sel, val, note, msg] of conds) {
      if (v(sel) === val && !v(note)) { err.textContent = msg; return; }
    }
    if (v('#bev-scalp') === '頭血腫' && (!v('#bev-hema-site') || !v('#bev-hema-size'))) {
      err.textContent = '頭皮選「頭血腫」時，頭血腫部位與大小必填'; return;
    }
    const mouthConds = ckVals(secB, 'bev-mouth');
    if (mouthConds.includes('其他') && !v('#bev-mouth-note')) { err.textContent = '口腔其他狀態勾選「其他」時，口腔其他補述必填'; return; }
    const abd = v('#bev-abd');
    if (abd && abd !== '柔軟' && !v('#bev-abd-note')) { err.textContent = '腹部外觀非「柔軟」時，腹部補述必填'; return; }
    const skinCond = ckVals(secB, 'bev-skincond');
    const skinNotes = {};
    for (const k of BNA_SKIN_NOTE) {
      const note = secB.querySelector(`[data-bev-skin-note="${k}"]`).value.trim();
      if (skinCond.includes(k) && !note) { err.textContent = `勾選「${k}」時，${k}補述必填`; return; }
      if (note) skinNotes[k] = note;
    }
    const rash = side => ({
      level: v(`#bev-rash-${side}`), flags: ckVals(secB, `bev-rash-${side}`),
      pos: v(`#bev-rash-${side}-pos`), range: v(`#bev-rash-${side}-range`)
    });
    const rashL = rash('left'), rashR = rash('right');
    for (const [r, lbl] of [[rashL, '左臀'], [rashR, '右臀']]) {
      if (r.flags.includes('滲液') && (!r.pos || !r.range)) { err.textContent = `${lbl}紅臀勾選「滲液」時，位置與範圍必填`; return; }
    }
    try {
      await api(`/babies/${babyId}/intake-assessments`, { method: 'POST', body: {
        assess_date: v('#bev-as-date'), assess_time: v('#bev-as-time'),
        bt: v('#bev-bt'), hr: v('#bev-hr'), rr: v('#bev-rr'), head_circ: v('#bev-head'),
        head_status: v('#bev-head-st'), head_status_note: v('#bev-head-note'),
        fontanelle: v('#bev-font'), fontanelle_note: v('#bev-font-note'),
        scalp: v('#bev-scalp'), hematoma_site: v('#bev-hema-site'), hematoma_size: v('#bev-hema-size'),
        scalp_other_note: v('#bev-scalp-note'),
        eye_left: v('#bev-eye-l'), eye_right: v('#bev-eye-r'),
        pupil_left: v('#bev-pupil-l'), pupil_right: v('#bev-pupil-r'),
        ear: v('#bev-ear'), ear_note: v('#bev-ear-note'),
        nose: v('#bev-nose'), nose_note: v('#bev-nose-note'),
        mouth: v('#bev-mouth'), mouth_conditions: mouthConds, mouth_other_note: v('#bev-mouth-note'),
        neck: v('#bev-neck'), neck_note: v('#bev-neck-note'),
        skin_color: v('#bev-skin'), skin_conditions: skinCond, skin_notes: skinNotes,
        rash_left: rashL, rash_right: rashR,
        chest: v('#bev-chest'), chest_note: v('#bev-chest-note'),
        resp_rate: v('#bev-resp'), resp_pattern: v('#bev-resp-pat'), resp_pattern_note: v('#bev-resp-note'),
        heart_rate: v('#bev-hr-rate'), heart_rate_note: v('#bev-hr-note'),
        limb_temp: v('#bev-limb-t'), limb_color: v('#bev-limb-c'),
        abdomen: abd, abdomen_note: v('#bev-abd-note'), bowel_sound: v('#bev-bowel'),
        caregiver_id_no: idNo
      } });
      viewBabyEval();
    } catch (e) { err.textContent = e.message; }
  };

  main().querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆入住評估？（會記入稽核軌跡）')) return;
      await api(`/baby-intake/${btn.dataset.del}`, { method: 'DELETE' });
      viewBabyEval();
    };
  });
}

/* ---------- 兒科醫師診視紀錄（醫師巡診） ---------- */
const BDV_OPTS = {
  skin: ['正常', '發紺', '黃疸', '新生兒坐瘡', '粟粒疹', '蒙古斑', '鮭魚斑', '血管瘤', '毒性紅斑', '脂漏性皮膚炎', '其它'],
  head: ['正常', '產瘤', '血腫'],
  fontanelle: ['正常', '膨出', '凹陷'],
  eyes: ['正常', '不對稱', '分泌物', '結膜出血'],
  mouth: ['正常', '水泡', '珍珠白點', '破洞', '鵝口瘡', '其它異常'],
  neck: ['正常', '斜頸'],
  clavicle: ['正常', '骨折'],
  heart: ['規律', '心雜音', '心律不整'],
  lungs: ['正常', '異常'],
  umbilicus: ['正常', '發炎', '臍疝氣', '其它異常'],
  genital_m: ['睪丸完全下降', '睪丸未下降', '陰囊水腫', '尿道下裂', '腹股溝疝氣', '其他異常'],
  genital_f: ['正常', '大陰唇未蓋住小陰唇', '分泌物', '假性月經', '其他異常'],
  buttock: ['正常', '紅臀']
};
function bdvChecks(name, opts, picked = []) {
  return opts.map(o => `<label class="bna-chk"><input type="checkbox" data-ck="${name}" value="${esc(o)}" ${picked.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('');
}
function bdvRadios(name, opts, val = '') {
  return opts.map(o => `<label class="bna-chk"><input type="radio" name="${name}" value="${esc(o)}" ${o === val ? 'checked' : ''}> ${esc(o)}</label>`).join('');
}

async function viewBabyDoctor() {
  const list = await api('/room-status/babies');
  const babies = list.babies;
  if (!babies.length) {
    main().innerHTML = '<div class="page-title">醫師巡診</div><div class="card"><div class="empty">目前沒有在住寶寶</div></div>';
    return;
  }
  const want = Number((location.hash.split('?b=')[1] || '').split('&')[0]);
  const babyId = babies.some(b => b.id === want) ? want : babies[0].id;
  const { baby, rows } = await api(`/babies/${babyId}/doctor-visits`);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  // 出生天數（自出生日至今）；出生體重預設帶寶寶基本資料
  const birthDays = baby.birth_date ? Math.max(0, Math.floor((new Date(todayStr()) - new Date(baby.birth_date)) / 86400000)) : '';
  // 體重增加減輕百分比：最近一筆診視體重 vs 出生體重
  const lastW = rows.find(r => r.weight_g != null);
  const bw = (lastW && lastW.data.birth_weight_g) || baby.birth_weight_g;
  const pct = (lastW && bw > 0) ? ((lastW.weight_g - bw) / bw * 100).toFixed(2) : '0.00';

  const joinArr = a => (a || []).join('、') || '—';
  const listRows = rows.map((r, i) => {
    const a = r.data || {};
    const head = [(a.head || []).join('、'), (a.head || []).includes('血腫') && (a.head_hema_sides || []).length ? `（${a.head_hema_sides.join('、')}）` : ''].join('');
    const genital = [(a.genital || []).join('、'),
      a.genital_undescended_side ? `未下降:${a.genital_undescended_side}` : '',
      a.genital_hernia_side ? `疝氣:${a.genital_hernia_side}` : '', a.genital_other].filter(Boolean).join('；');
    return `
      <tr data-filter="${esc(r.visit_date)} ${esc(r.recorded_by_name || '')}">
        <td data-label="筆數">${i + 1}<br>
          ${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${r.id}" style="margin:2px 0">刪</button>` : ''}
          <button class="btn small secondary" data-edit="${r.id}" style="margin:2px 0">修</button></td>
        <td data-label="診視日期">${esc(r.visit_date)}<br><small>${esc(r.visit_time)}</small></td>
        <td data-label="出生週數/天數/體重"><small>${esc(a.gest_weeks || '—')} 週／${esc(a.birth_days ?? '—')} 天<br>${esc(a.birth_weight_g || '—')} gm</small></td>
        <td data-label="體重/膚色"><small>${r.weight_g != null ? `${r.weight_g} gm` : '—'}<br>${esc(joinArr(a.skin))}${a.skin_other ? `（${esc(a.skin_other)}）` : ''}</small></td>
        <td data-label="頭部/囟門"><small>${esc(head || '—')}<br>囟門 ${esc(a.fontanelle || '—')}</small></td>
        <td data-label="眼睛/口腔"><small>${esc(joinArr(a.eyes))}<br>${esc(joinArr(a.mouth))}${a.mouth_other ? `（${esc(a.mouth_other)}）` : ''}</small></td>
        <td data-label="頸部/鎖骨"><small>${esc(joinArr(a.neck))}${a.neck_side ? `（${esc(a.neck_side)}）` : ''}<br>${esc(joinArr(a.clavicle))}${a.clavicle_side ? `（${esc(a.clavicle_side)}）` : ''}</small></td>
        <td data-label="心臟/肺部"><small>${esc(joinArr(a.heart))}<br>${esc(joinArr(a.lungs))}${a.lung_note ? `（${esc(a.lung_note)}）` : ''}</small></td>
        <td data-label="臍部/臀部"><small>${esc(joinArr(a.umbilicus))}${a.umb_other ? `（${esc(a.umb_other)}）` : ''}<br>${esc(joinArr(a.buttock))}${a.rash_w || a.rash_h ? `（${esc(a.rash_w || '?')}×${esc(a.rash_h || '?')}cm）` : ''}</small></td>
        <td data-label="生殖器"><small>${esc(genital || '—')}</small></td>
        <td data-label="建檔人">${esc(r.recorded_by_name || '—')}${r.edited_at ? `<br><small title="${esc(r.edited_at)}（${esc(r.edited_by_name || '')}）" style="color:var(--muted)">已修改</small>` : ''}</td>
        <td data-label="敍述"><small>${esc((r.note || '').slice(0, 40))}${(r.note || '').length > 40 ? '…' : ''}</small></td>
      </tr>`;
  }).join('');

  // 生殖器選項依寶寶性別顯示（未填性別則兩組都列出）
  const genitalRows = [];
  if (baby.gender !== 'female') genitalRows.push(['男孩', bdvChecks('bdv-genital-m', BDV_OPTS.genital_m)]);
  if (baby.gender !== 'male') genitalRows.push(['女孩', bdvChecks('bdv-genital-f', BDV_OPTS.genital_f)]);

  main().innerHTML = `
    <div class="page-title">醫師巡診 <small style="font-weight:400;color:var(--muted);font-size:.9rem">兒科醫師診視紀錄</small></div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇寶寶</label>
          <select id="bdv-baby">${babies.map(b => `<option value="${b.id}" ${b.id === babyId ? 'selected' : ''}>${esc(b.name)}（${esc(b.mother_name)}${b.room_name ? `／${esc(b.room_name)}` : ''}）</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/baby-rooms">回寶寶房況</a>
        <a class="btn small secondary" href="#/physician-visits">巡診總覽(SOAP)</a>
        <button class="btn small secondary" id="bdv-print">資料列印</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">兒科醫師巡診</div>
      <div class="row" style="gap:6px 18px;flex-wrap:wrap;font-size:.95rem">
        <span><b>媽媽姓名：</b>${baby.room_name ? `${esc(baby.room_name)}　` : ''}${esc(baby.mother_name)}</span>
        ${baby.mother_check_in ? `<span><b>入住：</b>${esc(baby.mother_check_in)}</span>` : ''}
        ${baby.mother_check_out ? `<span><b>預退：</b>${esc(baby.mother_check_out)}</span>` : ''}
        <span><b>寶寶：</b>${esc(baby.name)}${baby.gender ? `（${baby.gender === 'male' ? '男' : '女'}）` : ''}</span>
        <span><b>體重增加減輕百分比：</b><b style="color:${Number(pct) < 0 ? 'var(--danger)' : 'var(--primary-dark)'}">${pct} %</b></span>
      </div>
    </div>
    <div class="card no-print" id="bdv-form">
      <div class="sec-hd">兒科醫師診視紀錄 － <span id="bdv-mode">新增</span></div>
      <div class="form-grid">
        <div class="field"><label>診視日期 <b class="req">*</b></label><input type="date" id="bdv-date" value="${todayStr()}"></div>
        <div class="field"><label>診視時間 <b class="req">*</b></label><input type="time" id="bdv-time" value="${hhmm}"></div>
        <div class="field full"><label>寶寶紀錄</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">
            出生週數 <input type="number" id="bdv-gw" min="0" max="45" style="width:80px">
            出生天數 <input type="number" id="bdv-bd" min="0" style="width:80px" value="${birthDays}">
            出生體重 <input type="number" id="bdv-bw" min="0" style="width:110px" value="${esc(baby.birth_weight_g ?? '')}"> gm
          </div></div>
        <div class="field"><label>體重（gm）</label><input type="number" id="bdv-w" min="0" placeholder="診視當日體重"></div>
        <div class="field full"><label>皮膚</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${bdvChecks('bdv-skin', BDV_OPTS.skin)}
            <input id="bdv-skin-other" maxlength="100" placeholder="勾「其它」時必填" style="width:220px"></div></div>
        <div class="field full"><label>頭部</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${bdvChecks('bdv-head', BDV_OPTS.head)}
            血腫（${bdvChecks('bdv-head-side', ['左', '右'])}）</div></div>
        <div class="field full"><label>囟門</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${bdvRadios('bdvr-font', BDV_OPTS.fontanelle)}</div></div>
        <div class="field full"><label>眼睛</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${bdvChecks('bdv-eyes', BDV_OPTS.eyes)}</div>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center;margin-top:6px">
            分泌物（${bdvRadios('bdvr-eye-sec', ['左', '右'])}）顏色 <input id="bdv-eye-color" maxlength="50" style="width:110px">
            量 <input id="bdv-eye-amt" maxlength="50" style="width:110px">
            　結膜出血（${bdvRadios('bdvr-eye-conj', ['左', '右'])}）</div></div>
        <div class="field full"><label>口腔</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${bdvChecks('bdv-mouth', BDV_OPTS.mouth)}
            <input id="bdv-mouth-other" maxlength="100" placeholder="勾「其它異常」時必填" style="width:220px"></div></div>
        <div class="field"><label>頸部</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${bdvChecks('bdv-neck', BDV_OPTS.neck)} 斜頸（${bdvRadios('bdvr-neck', ['左', '右'])}）</div></div>
        <div class="field"><label>鎖骨</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${bdvChecks('bdv-clav', BDV_OPTS.clavicle)} 骨折（${bdvRadios('bdvr-clav', ['左', '右'])}）</div></div>
        <div class="field"><label>心臟</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${bdvChecks('bdv-heart', BDV_OPTS.heart)}</div></div>
        <div class="field"><label>肺部</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${bdvChecks('bdv-lungs', BDV_OPTS.lungs)}
            <input id="bdv-lung-note" maxlength="100" placeholder="勾「異常」時必填" style="width:180px"></div></div>
        <div class="field full"><label>臍部</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${bdvChecks('bdv-umb', BDV_OPTS.umbilicus)}
            <input id="bdv-umb-other" maxlength="100" placeholder="勾「其它異常」時必填" style="width:220px"></div></div>
        ${genitalRows.map(([who, checks]) => `
        <div class="field full"><label>生殖器${genitalRows.length > 1 ? `（${who}）` : ''}</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${who === '男孩' ? '男孩，' : '女孩，'}${checks}</div>
          ${who === '男孩' ? `<div class="row" style="gap:8px 14px;flex-wrap:wrap;margin-top:6px">
            睪丸未下降（${bdvRadios('bdvr-gen-und', ['左', '右', '雙側'])}）　腹股溝疝氣（${bdvRadios('bdvr-gen-hern', ['左', '右', '雙側'])}）</div>` : ''}
        </div>`).join('')}
        <div class="field full"><label>生殖器其他異常補述</label><input id="bdv-gen-other" maxlength="100" placeholder="勾「其他異常」時必填"></div>
        <div class="field full"><label>臀部</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${bdvChecks('bdv-butt', BDV_OPTS.buttock)}
            紅臀大小 <input type="number" step="0.1" min="0" id="bdv-rash-w" style="width:80px"> ×
            <input type="number" step="0.1" min="0" id="bdv-rash-h" style="width:80px"> cm</div></div>
        <div class="field full"><label>敍述性紀錄<small>（限 600 字）</small></label><textarea id="bdv-note" maxlength="600" rows="3"></textarea></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="bdv-save">資料新增</button>
          <button class="btn secondary" id="bdv-cancel" style="display:none">取消編輯</button>
          <span class="error-msg" id="bdv-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="row between no-print">
        <h3>兒科醫師診視紀錄（${rows.length} 筆）</h3>
      </div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th class="no-print">筆數</th><th>診視日期</th><th>出生週數/天數/體重</th><th>體重/膚色</th><th>頭部/囟門</th><th>眼睛/口腔</th><th>頸部/鎖骨</th><th>心臟/肺部</th><th>臍部/臀部</th><th>生殖器</th><th>建檔人</th><th>敍述</th></tr></thead>
          <tbody>${listRows || '<tr><td colspan="12"><div class="empty">尚無診視紀錄</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $('#bdv-baby').onchange = () => { location.hash = `#/baby-doctor?b=${$('#bdv-baby').value}`; };
  $('#bdv-print').onclick = () => window.print();

  const form = $('#bdv-form');
  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
  const ckVals = name => [...form.querySelectorAll(`[data-ck="${name}"]:checked`)].map(c => c.value);
  const radioVal = name => { const el = form.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; };
  let editingId = null;

  // 「修」：把該筆資料帶回表單改為修改模式
  const setForm = r => {
    const a = r.data || {};
    editingId = r.id;
    $('#bdv-mode').textContent = `編輯（第 ${rows.findIndex(x => x.id === r.id) + 1} 筆）`;
    $('#bdv-save').textContent = '資料修改';
    $('#bdv-cancel').style.display = '';
    $('#bdv-date').value = r.visit_date; $('#bdv-time').value = r.visit_time;
    $('#bdv-gw').value = a.gest_weeks ?? ''; $('#bdv-bd').value = a.birth_days ?? '';
    $('#bdv-bw').value = a.birth_weight_g ?? ''; $('#bdv-w').value = r.weight_g ?? '';
    $('#bdv-skin-other').value = a.skin_other || ''; $('#bdv-mouth-other').value = a.mouth_other || '';
    $('#bdv-eye-color').value = a.eye_secretion_color || ''; $('#bdv-eye-amt').value = a.eye_secretion_amount || '';
    $('#bdv-lung-note').value = a.lung_note || ''; $('#bdv-umb-other').value = a.umb_other || '';
    $('#bdv-gen-other').value = a.genital_other || '';
    $('#bdv-rash-w').value = a.rash_w || ''; $('#bdv-rash-h').value = a.rash_h || '';
    $('#bdv-note').value = r.note || '';
    const setCk = (name, vals) => form.querySelectorAll(`[data-ck="${name}"]`).forEach(c => c.checked = (vals || []).includes(c.value));
    setCk('bdv-skin', a.skin); setCk('bdv-head', a.head); setCk('bdv-head-side', a.head_hema_sides);
    setCk('bdv-eyes', a.eyes); setCk('bdv-mouth', a.mouth); setCk('bdv-neck', a.neck);
    setCk('bdv-clav', a.clavicle); setCk('bdv-heart', a.heart); setCk('bdv-lungs', a.lungs);
    setCk('bdv-umb', a.umbilicus); setCk('bdv-butt', a.buttock);
    setCk('bdv-genital-m', a.genital); setCk('bdv-genital-f', a.genital);
    const setRadio = (name, val) => form.querySelectorAll(`input[name="${name}"]`).forEach(c => c.checked = c.value === val);
    setRadio('bdvr-font', a.fontanelle); setRadio('bdvr-eye-sec', a.eye_secretion_side);
    setRadio('bdvr-eye-conj', a.eye_conj_side); setRadio('bdvr-neck', a.neck_side);
    setRadio('bdvr-clav', a.clavicle_side); setRadio('bdvr-gen-und', a.genital_undescended_side);
    setRadio('bdvr-gen-hern', a.genital_hernia_side);
    form.scrollIntoView({ behavior: 'smooth' });
  };
  $('#bdv-cancel').onclick = () => viewBabyDoctor();

  $('#bdv-save').onclick = async () => {
    const err = $('#bdv-err');
    err.textContent = '';
    if (!v('#bdv-date') || !v('#bdv-time')) { err.textContent = '請填寫診視日期與時間'; return; }
    const skin = ckVals('bdv-skin'), mouth = ckVals('bdv-mouth'), lungs = ckVals('bdv-lungs'), umb = ckVals('bdv-umb');
    const genital = [...ckVals('bdv-genital-m'), ...ckVals('bdv-genital-f')];
    if (skin.includes('其它') && !v('#bdv-skin-other')) { err.textContent = '皮膚勾選「其它」時，補述必填'; return; }
    if (mouth.includes('其它異常') && !v('#bdv-mouth-other')) { err.textContent = '口腔勾選「其它異常」時，補述必填'; return; }
    if (lungs.includes('異常') && !v('#bdv-lung-note')) { err.textContent = '肺部勾選「異常」時，補述必填'; return; }
    if (umb.includes('其它異常') && !v('#bdv-umb-other')) { err.textContent = '臍部勾選「其它異常」時，補述必填'; return; }
    if (genital.includes('其他異常') && !v('#bdv-gen-other')) { err.textContent = '生殖器勾選「其他異常」時，補述必填'; return; }
    const body = {
      visit_date: v('#bdv-date'), visit_time: v('#bdv-time'), weight_g: v('#bdv-w'),
      gest_weeks: v('#bdv-gw'), birth_days: v('#bdv-bd'), birth_weight_g: v('#bdv-bw'),
      skin, skin_other: v('#bdv-skin-other'),
      head: ckVals('bdv-head'), head_hema_sides: ckVals('bdv-head-side'), fontanelle: radioVal('bdvr-font'),
      eyes: ckVals('bdv-eyes'), eye_secretion_side: radioVal('bdvr-eye-sec'),
      eye_secretion_color: v('#bdv-eye-color'), eye_secretion_amount: v('#bdv-eye-amt'),
      eye_conj_side: radioVal('bdvr-eye-conj'),
      mouth, mouth_other: v('#bdv-mouth-other'),
      neck: ckVals('bdv-neck'), neck_side: radioVal('bdvr-neck'),
      clavicle: ckVals('bdv-clav'), clavicle_side: radioVal('bdvr-clav'),
      heart: ckVals('bdv-heart'), lungs, lung_note: v('#bdv-lung-note'),
      umbilicus: umb, umb_other: v('#bdv-umb-other'),
      genital, genital_undescended_side: radioVal('bdvr-gen-und'),
      genital_hernia_side: radioVal('bdvr-gen-hern'), genital_other: v('#bdv-gen-other'),
      buttock: ckVals('bdv-butt'), rash_w: v('#bdv-rash-w'), rash_h: v('#bdv-rash-h'),
      note: v('#bdv-note')
    };
    try {
      if (editingId) await api(`/baby-doctor-visits/${editingId}`, { method: 'PUT', body });
      else await api(`/babies/${babyId}/doctor-visits`, { method: 'POST', body });
      viewBabyDoctor();
    } catch (e) { err.textContent = e.message; }
  };

  main().querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => setForm(rows.find(r => r.id == btn.dataset.edit));
  });
  main().querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆診視紀錄？（會記入稽核軌跡）')) return;
      await api(`/baby-doctor-visits/${btn.dataset.del}`, { method: 'DELETE' });
      viewBabyDoctor();
    };
  });
}

/* ---------- 產科醫師診視紀錄（醫師巡診；媽媽） ---------- */
const MDV_OPTS = {
  mood: ['平穩', '焦慮', '易怒', '亢奮', '憂鬱'],
  feeding: ['純母乳', '混哺', '親哺', '配方奶'],
  breast: ['未脹奶', '脹/充盈', '有硬塊', '退奶', '乳腺炎'],
  ep_wound: ['平整', '疼痛', '紅腫', '滲液'],
  fundus_height: ['臍上3指', '臍上2指', '臍上1指', '平臍', '臍下1指', '臍下2指', '臍下3指', '已入骨盆腔'],
  uterus_state: ['硬', '鬆弛柔軟，按摩後變硬', '鬆弛柔軟', '降回骨盆腔'],
  lochia_amount: ['無', '微量', '少', '中', '多', '血塊'],
  lochia_color: ['無', '鮮紅', '暗紅', '粉紅', '黃褐', '透明', '咖啡'],
  urine: ['正常', '失禁', '需加壓', '頻尿', '小便灼熱', '導尿管'],
  stool: ['正常', '腹瀉', '便祕'],
  edema_deg: ['+1', '+2', '+3', '+4']
};
function mdvChecks(name, opts, picked = []) {
  return opts.map(o => `<label class="bna-chk"><input type="checkbox" data-ck="${name}" value="${esc(o)}" ${picked.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('');
}
function mdvRadios(name, opts, val = '') {
  return opts.map(o => `<label class="bna-chk"><input type="radio" name="${name}" value="${esc(o)}" ${o === val ? 'checked' : ''}> ${esc(o)}</label>`).join('');
}
function mdvSel(id, opts) {
  return `<select id="${id}"><option value="">--請選擇--</option>${opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
}

async function viewMotherDoctor() {
  const all = await api('/mothers');
  const mothers = all.filter(m => m.status === 'checked_in');
  if (!mothers.length) {
    main().innerHTML = '<div class="page-title">醫師巡診</div><div class="card"><div class="empty">目前沒有在住媽媽</div></div>';
    return;
  }
  const want = Number((location.hash.split('?m=')[1] || '').split('&')[0]);
  const momId = mothers.some(m => m.id === want) ? want : mothers[0].id;
  const { mother, rows } = await api(`/mothers/${momId}/doctor-visits`);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  // 生產後天數：自生產日至今
  const ppDays = mother.delivery_date ? Math.max(0, Math.floor((new Date(todayStr()) - new Date(mother.delivery_date)) / 86400000)) : '';

  const joinArr = a => (a || []).join('、') || '—';
  const listRows = rows.map((r, i) => {
    const a = r.data || {};
    const edema = a.edema_none ? '無' : [a.edema_right ? `右 ${a.edema_right}` : '', a.edema_left ? `左 ${a.edema_left}` : ''].filter(Boolean).join('／') || '—';
    return `
      <tr data-filter="${esc(r.visit_date)} ${esc(r.recorded_by_name || '')}">
        <td data-label="筆數">${i + 1}<br>
          ${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${r.id}" style="margin:2px 0">刪</button>` : ''}
          <button class="btn small secondary" data-edit="${r.id}" style="margin:2px 0">修</button></td>
        <td data-label="診視日期">${esc(r.visit_date)}<br><small>${esc(r.visit_time)}</small></td>
        <td data-label="產後天數/精神"><small>產後 ${esc(a.postpartum_days ?? '—')} 天<br>${esc(a.mood || '—')}${a.epds_score !== undefined && a.epds_score !== '' ? `（EPDS ${esc(a.epds_score)}）` : ''}<br>主訴：${a.complaint === '有' ? esc(a.complaint_text || '有') : '無'}</small></td>
        <td data-label="哺乳/乳房"><small>${esc(joinArr(a.feeding))}<br>${esc(joinArr(a.breast))}</small></td>
        <td data-label="EP傷口/宮縮"><small>${esc(a.ep_wound || '—')}${a.ep_med === '有' ? `／用藥：${esc(a.ep_med_text || '有')}` : ''}<br>${esc(a.fundus_height || '—')}／${esc(a.uterus_state || '—')}</small></td>
        <td data-label="惡露"><small>量：${esc(joinArr(a.lochia_amount))}<br>色：${esc(joinArr(a.lochia_color))}</small></td>
        <td data-label="二便/痔瘡/水腫"><small>小便：${esc(a.urine || '—')}<br>大便：${esc(a.stool || '—')}${a.laxative ? `／軟便劑${a.laxative_text ? '：' + esc(a.laxative_text) : ''}` : ''}<br>痔瘡：${esc(a.hemorrhoid || '—')}　水腫：${esc(edema)}</small></td>
        <td data-label="建檔人">${esc(r.recorded_by_name || '—')}${r.edited_at ? `<br><small title="${esc(r.edited_at)}（${esc(r.edited_by_name || '')}）" style="color:var(--muted)">已修改</small>` : ''}</td>
        <td data-label="敍述"><small>${esc((r.note || '').slice(0, 40))}${(r.note || '').length > 40 ? '…' : ''}</small></td>
      </tr>`;
  }).join('');

  main().innerHTML = `
    <div class="page-title">醫師巡診 <small style="font-weight:400;color:var(--muted);font-size:.9rem">產科醫師診視紀錄</small></div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇媽媽</label>
          <select id="mdv-mom">${mothers.map(m => `<option value="${m.id}" ${m.id === momId ? 'selected' : ''}>${esc(m.name)}${m.room_name ? `（${esc(m.room_name)}）` : ''}</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <a class="btn small secondary" href="#/mother-nursing?m=${momId}">媽媽護理</a>
        <a class="btn small secondary" href="#/physician-visits">巡診總覽(SOAP)</a>
        <button class="btn small secondary" id="mdv-print">資料列印</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">產科醫師巡診</div>
      <div class="row" style="gap:6px 18px;flex-wrap:wrap;font-size:.95rem">
        <span><b>媽媽姓名：</b>${mother.room_name ? `${esc(mother.room_name)}　` : ''}${esc(mother.name)}</span>
        ${mother.check_in ? `<span><b>入住：</b>${esc(mother.check_in)}</span>` : ''}
        ${mother.check_out ? `<span><b>預退：</b>${esc(mother.check_out)}</span>` : ''}
        ${mother.delivery_date ? `<span><b>生產日：</b>${esc(mother.delivery_date)}</span>` : ''}
        ${mother.delivery_type ? `<span><b>生產方式：</b>${esc(mother.delivery_type)}</span>` : ''}
      </div>
    </div>
    <div class="card no-print" id="mdv-form">
      <div class="sec-hd">產科醫師診視紀錄 － <span id="mdv-mode">新增</span></div>
      <div class="form-grid">
        <div class="field"><label>診視日期 <b class="req">*</b></label><input type="date" id="mdv-date" value="${todayStr()}"></div>
        <div class="field"><label>診視時間 <b class="req">*</b></label><input type="time" id="mdv-time" value="${hhmm}"></div>
        <div class="field full"><label>基本資料</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">
            生產後天數 <input type="number" id="mdv-ppd" min="0" style="width:90px" value="${ppDays}"> 天
            胎次 <input id="mdv-parity" maxlength="20" style="width:100px">
            生產方式 <input id="mdv-delmode" maxlength="30" style="width:140px" value="${esc(mother.delivery_type || '')}">
          </div></div>
        <div class="field full"><label>精神情緒狀態</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${mdvRadios('mdvr-mood', MDV_OPTS.mood)}
            愛丁堡憂鬱量表分數 <input type="number" id="mdv-epds" min="0" max="30" style="width:90px"></div></div>
        <div class="field full"><label>主訴</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${mdvRadios('mdvr-comp', ['無', '有'])}
            <input id="mdv-comp-text" maxlength="200" placeholder="有，請填入問題" style="width:320px;max-width:100%"></div></div>
        <div class="field full"><label>哺乳狀態</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${mdvChecks('mdv-feeding', MDV_OPTS.feeding)}</div></div>
        <div class="field full"><label>乳房狀況</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${mdvChecks('mdv-breast', MDV_OPTS.breast)}</div></div>
        <div class="field full"><label>EP 傷口</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${mdvRadios('mdvr-ep', MDV_OPTS.ep_wound)}
            　用藥：${mdvRadios('mdvr-epmed', ['無', '有'])}<input id="mdv-epmed-text" maxlength="100" placeholder="用藥名稱" style="width:180px"></div></div>
        <div class="field full"><label>宮縮情形</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">宮底高度 ${mdvSel('mdv-fundus', MDV_OPTS.fundus_height)}</div>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center;margin-top:6px">宮縮狀態：${mdvRadios('mdvr-uterus', MDV_OPTS.uterus_state)}</div></div>
        <div class="field full"><label>惡露 － 量</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${mdvChecks('mdv-lochia-amt', MDV_OPTS.lochia_amount)}</div></div>
        <div class="field full"><label>惡露 － 顏色</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${mdvChecks('mdv-lochia-col', MDV_OPTS.lochia_color)}</div></div>
        <div class="field full"><label>小便</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${mdvRadios('mdvr-urine', MDV_OPTS.urine)}</div></div>
        <div class="field full"><label>大便</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${mdvRadios('mdvr-stool', MDV_OPTS.stool)}
            　<label class="bna-chk"><input type="checkbox" id="mdv-laxative"> 軟便劑</label> 用藥：<input id="mdv-laxative-text" maxlength="100" style="width:180px"></div></div>
        <div class="field"><label>痔瘡</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">${mdvRadios('mdvr-hem', ['無', '有'])}
            <label class="bna-chk"><input type="checkbox" id="mdv-hem-oint"> 藥膏</label><input id="mdv-hem-text" maxlength="100" style="width:140px"></div></div>
        <div class="field"><label>下肢水腫</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap;align-items:center">
            <label class="bna-chk"><input type="checkbox" id="mdv-edema-none"> 無</label>
            右 ${mdvSel('mdv-edema-r', MDV_OPTS.edema_deg)} 左 ${mdvSel('mdv-edema-l', MDV_OPTS.edema_deg)}</div></div>
        <div class="field full"><label>敍述性紀錄<small>（限 600 字）</small></label><textarea id="mdv-note" maxlength="600" rows="3"></textarea></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="mdv-save">資料新增</button>
          <button class="btn secondary" id="mdv-cancel" style="display:none">取消編輯</button>
          <span class="error-msg" id="mdv-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="row between no-print">
        <h3>產科醫師診視紀錄（${rows.length} 筆）</h3>
      </div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th class="no-print">筆數</th><th>診視日期</th><th>產後天數/精神</th><th>哺乳/乳房</th><th>EP傷口/宮縮</th><th>惡露</th><th>二便/痔瘡/水腫</th><th>建檔人</th><th>敍述</th></tr></thead>
          <tbody>${listRows || '<tr><td colspan="9"><div class="empty">尚無診視紀錄</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $('#mdv-mom').onchange = () => { location.hash = `#/mother-doctor?m=${$('#mdv-mom').value}`; };
  $('#mdv-print').onclick = () => window.print();

  const form = $('#mdv-form');
  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
  const ck = id => { const el = $(id); return el ? el.checked : false; };
  const ckVals = name => [...form.querySelectorAll(`[data-ck="${name}"]:checked`)].map(c => c.value);
  const radioVal = name => { const el = form.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; };
  let editingId = null;

  // 「修」：把該筆資料帶回表單改為修改模式
  const setForm = r => {
    const a = r.data || {};
    editingId = r.id;
    $('#mdv-mode').textContent = `編輯（第 ${rows.findIndex(x => x.id === r.id) + 1} 筆）`;
    $('#mdv-save').textContent = '資料修改';
    $('#mdv-cancel').style.display = '';
    $('#mdv-date').value = r.visit_date; $('#mdv-time').value = r.visit_time;
    $('#mdv-ppd').value = a.postpartum_days ?? ''; $('#mdv-parity').value = a.parity || '';
    $('#mdv-delmode').value = a.delivery_mode || ''; $('#mdv-epds').value = a.epds_score ?? '';
    $('#mdv-comp-text').value = a.complaint_text || ''; $('#mdv-epmed-text').value = a.ep_med_text || '';
    $('#mdv-fundus').value = a.fundus_height || '';
    $('#mdv-laxative').checked = !!a.laxative; $('#mdv-laxative-text').value = a.laxative_text || '';
    $('#mdv-hem-oint').checked = !!a.hem_ointment; $('#mdv-hem-text').value = a.hem_text || '';
    $('#mdv-edema-none').checked = !!a.edema_none;
    $('#mdv-edema-r').value = a.edema_right || ''; $('#mdv-edema-l').value = a.edema_left || '';
    $('#mdv-note').value = r.note || '';
    const setCk = (name, vals) => form.querySelectorAll(`[data-ck="${name}"]`).forEach(c => c.checked = (vals || []).includes(c.value));
    setCk('mdv-feeding', a.feeding); setCk('mdv-breast', a.breast);
    setCk('mdv-lochia-amt', a.lochia_amount); setCk('mdv-lochia-col', a.lochia_color);
    const setRadio = (name, val) => form.querySelectorAll(`input[name="${name}"]`).forEach(c => c.checked = c.value === val);
    setRadio('mdvr-mood', a.mood); setRadio('mdvr-comp', a.complaint);
    setRadio('mdvr-ep', a.ep_wound); setRadio('mdvr-epmed', a.ep_med);
    setRadio('mdvr-uterus', a.uterus_state); setRadio('mdvr-urine', a.urine);
    setRadio('mdvr-stool', a.stool); setRadio('mdvr-hem', a.hemorrhoid);
    form.scrollIntoView({ behavior: 'smooth' });
  };
  $('#mdv-cancel').onclick = () => viewMotherDoctor();

  $('#mdv-save').onclick = async () => {
    const err = $('#mdv-err');
    err.textContent = '';
    if (!v('#mdv-date') || !v('#mdv-time')) { err.textContent = '請填寫診視日期與時間'; return; }
    if (radioVal('mdvr-comp') === '有' && !v('#mdv-comp-text')) { err.textContent = '主訴勾選「有」時，問題必填'; return; }
    const body = {
      visit_date: v('#mdv-date'), visit_time: v('#mdv-time'),
      postpartum_days: v('#mdv-ppd'), parity: v('#mdv-parity'), delivery_mode: v('#mdv-delmode'),
      mood: radioVal('mdvr-mood'), epds_score: v('#mdv-epds'),
      complaint: radioVal('mdvr-comp'), complaint_text: v('#mdv-comp-text'),
      feeding: ckVals('mdv-feeding'), breast: ckVals('mdv-breast'),
      ep_wound: radioVal('mdvr-ep'), ep_med: radioVal('mdvr-epmed'), ep_med_text: v('#mdv-epmed-text'),
      fundus_height: v('#mdv-fundus'), uterus_state: radioVal('mdvr-uterus'),
      lochia_amount: ckVals('mdv-lochia-amt'), lochia_color: ckVals('mdv-lochia-col'),
      urine: radioVal('mdvr-urine'), stool: radioVal('mdvr-stool'),
      laxative: ck('#mdv-laxative'), laxative_text: v('#mdv-laxative-text'),
      hemorrhoid: radioVal('mdvr-hem'), hem_ointment: ck('#mdv-hem-oint'), hem_text: v('#mdv-hem-text'),
      edema_none: ck('#mdv-edema-none'), edema_right: v('#mdv-edema-r'), edema_left: v('#mdv-edema-l'),
      note: v('#mdv-note')
    };
    try {
      if (editingId) await api(`/mother-doctor-visits/${editingId}`, { method: 'PUT', body });
      else await api(`/mothers/${momId}/doctor-visits`, { method: 'POST', body });
      viewMotherDoctor();
    } catch (e) { err.textContent = e.message; }
  };

  main().querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => setForm(rows.find(r => r.id == btn.dataset.edit));
  });
  main().querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆診視紀錄？（會記入稽核軌跡）')) return;
      await api(`/mother-doctor-visits/${btn.dataset.del}`, { method: 'DELETE' });
      viewMotherDoctor();
    };
  });
}

/* ---------- 新生兒交班單 ---------- */
const BHO_OPTS = {
  feed: ['瓶', '針', '杯'],
  pacifier: ['可吃', '禁嘴', '必要時可吃'],
  isolation: ['寶寶隔離', '奶瓶隔離'],
  sleep: ['安穩', '安撫可睡著', '哭鬧']
};

async function viewBabyHandover() {
  const list = await api('/room-status/babies');
  const babies = list.babies;
  if (!babies.length) {
    main().innerHTML = '<div class="page-title">新生兒交班單</div><div class="card"><div class="empty">目前沒有在住寶寶</div></div>';
    return;
  }
  const want = Number((location.hash.split('?b=')[1] || '').split('&')[0]);
  const babyId = babies.some(b => b.id === want) ? want : babies[0].id;
  const { baby, rows, header, stats } = await api(`/babies/${babyId}/handovers`);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const hv = (label, val) => `<span style="min-width:230px"><b>${label}：</b>${val}</span>`;
  const red = s => `<b style="color:var(--danger)">${s}</b>`;
  const listRows = rows.map((r, i) => `
      <tr data-filter="${esc(r.handover_date)} ${esc(r.nurse_name || '')}">
        <td data-label="筆數">${i + 1}<br>
          ${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${r.id}" style="margin:2px 0">刪</button>` : ''}
          <button class="btn small secondary" data-edit="${r.id}" style="margin:2px 0">修</button></td>
        <td data-label="交班日期">${esc(r.handover_date)}<br><small>${esc(r.handover_time)}</small></td>
        <td data-label="體重">${r.weight_g != null ? `${r.weight_g} gm` : '—'}</td>
        <td data-label="黃疸值">${r.jaundice != null ? `${r.jaundice} mg/dl` : '—'}</td>
        <td data-label="臍帶">${esc(r.cord || '—')}</td>
        <td data-label="餵奶方式/安撫奶嘴"><small>${esc(r.feed_method || '—')}／${esc(r.pacifier || '—')}</small></td>
        <td data-label="隔離"><small>${esc((r.isolation || []).join('、') || '—')}</small></td>
        <td data-label="睡眠狀況">${esc(r.sleep || '—')}</td>
        <td data-label="交班事項"><small>${esc(r.note || '—')}</small></td>
        <td data-label="建檔人">${esc(r.nurse_name || '—')}${r.edited_at ? `<br><small title="${esc(r.edited_at)}（${esc(r.edited_by_name || '')}）" style="color:var(--muted)">已修改</small>` : ''}</td>
      </tr>`).join('');

  const statRows = stats.map(s => `
      <tr>
        <td data-label="日期">${esc(s.d)}</td>
        <td data-label="母奶量">${s.breast_ml || 0} ml</td>
        <td data-label="配方奶量">${s.formula_ml || 0} ml</td>
        <td data-label="總奶量"><b>${s.total_ml || 0} ml</b></td>
        <td data-label="小便">${s.urine || 0} 次</td>
        <td data-label="大便">${s.stool || 0} 次</td>
        <td data-label="親子同室時數">${s.rooming_hours || 0} 小時</td>
      </tr>`).join('');

  const lf = header.last_feed;
  main().innerHTML = `
    <div class="page-title">新生兒交班單</div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇寶寶</label>
          <select id="bho-baby">${babies.map(b => `<option value="${b.id}" ${b.id === babyId ? 'selected' : ''}>${esc(b.name)}（${esc(b.mother_name)}${b.room_name ? `／${esc(b.room_name)}` : ''}）</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/baby-rooms">回寶寶房況</a>
        <button class="btn small secondary" id="bho-print">資料列印</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">新生兒交班單</div>
      <div class="row" style="gap:8px 18px;flex-wrap:wrap;font-size:.93rem;line-height:1.9">
        ${hv('媽媽姓名', esc(baby.mother_name))}
        ${hv('媽媽房號', esc(baby.room_name || '—'))}
        ${hv('生產醫院', esc(header.birth_place || '—'))}
        ${hv('出生日期', esc(baby.birth_date || '—'))}
        ${hv('產式', esc(baby.delivery_type || '—'))}
        ${hv('週數', esc(header.gest_weeks || '—'))}
        ${hv('出生體重', baby.birth_weight_g ? `${baby.birth_weight_g} gm` : '— gm')}
        ${hv('胎次', esc(header.parity || '—'))}
        ${hv('性別', baby.gender ? (baby.gender === 'male' ? '男' : '女') : '—')}
        ${hv('現在體重', header.weight_now ? red(`${header.weight_now.value} gm`) + `（${esc(header.weight_now.at)}）` : '— gm')}
        ${hv('BCG', esc(header.bcg_date || '—'))}
        ${hv('HBIG', esc(header.hbig_date || '—'))}
        ${hv('奶品', esc(header.milk_brand || '—'))}
        ${hv('最後喝奶', lf ? `${esc(lf.recorded_at.slice(5, 16))} ${esc(lf.feed_method || '')}${lf.amount_ml ? ` ${lf.amount_ml}ml` : ''}` : '—')}
        ${hv('出生黃疸值', header.jaundice_birth != null ? `${header.jaundice_birth} mg/dl` : '— mg/dl')}
        ${hv('餵奶方式', esc(header.feed_method_now || '—'))}
        ${hv('安撫奶嘴', esc(header.pacifier_now || '—'))}
        ${hv('現在黃疸值', header.jaundice_now ? red(`${header.jaundice_now.value} mg/dl`) + `（${esc(header.jaundice_now.at)}）` : '— mg/dl')}
      </div>
      <div class="form-grid no-print" style="margin-top:10px">
        <div class="field"><label>寶寶游泳（次）</label><input type="number" min="0" id="bho-swim" value="${esc(header.swim_count)}"></div>
        <div class="field full"><label>重要備註</label><textarea id="bho-imp-note" maxlength="500" rows="2">${esc(header.handover_note)}</textarea></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="bho-note-save">備註存檔</button>
          <span class="error-msg" id="bho-note-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">寶寶每日奶量統計（近 14 天）</div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>日期</th><th>母奶量</th><th>配方奶量</th><th>總奶量</th><th>小便</th><th>大便</th><th>親子同室時數</th></tr></thead>
          <tbody>${statRows || '<tr><td colspan="7"><div class="empty">尚無照護紀錄可統計</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card no-print" id="bho-form">
      <div class="sec-hd">新生兒交班單 － <span id="bho-mode">新增</span></div>
      <div class="form-grid">
        <div class="field"><label>填寫交班日期 <b class="req">*</b></label><input type="date" id="bho-date" value="${todayStr()}"></div>
        <div class="field"><label>交班時間 <b class="req">*</b></label><input type="time" id="bho-time" value="${hhmm}"></div>
        <div class="field"><label>餵奶方式</label>
          <div class="row" style="gap:10px;padding-top:8px">${BHO_OPTS.feed.map(o => `<label class="bna-chk"><input type="radio" name="bhor-feed" value="${o}"> ${o}</label>`).join('')}</div></div>
        <div class="field"><label>安撫奶嘴</label>
          <div class="row" style="gap:10px;padding-top:8px">${BHO_OPTS.pacifier.map(o => `<label class="bna-chk"><input type="radio" name="bhor-paci" value="${o}"> ${o}</label>`).join('')}</div></div>
        <div class="field"><label>隔離</label>
          <div class="row" style="gap:10px;padding-top:8px">${BHO_OPTS.isolation.map(o => `<label class="bna-chk"><input type="checkbox" data-ck="bho-iso" value="${o}"> ${o}</label>`).join('')}</div></div>
        <div class="field"><label>體重（gm）</label><input type="number" min="0" id="bho-w"></div>
        <div class="field"><label>黃疸值（mg/dl）</label><input type="number" step="0.1" min="0" id="bho-j"></div>
        <div class="field"><label>臍帶</label><input id="bho-cord" maxlength="100"></div>
        <div class="field"><label>睡眠狀況</label>
          <div class="row" style="gap:10px;padding-top:8px">${BHO_OPTS.sleep.map(o => `<label class="bna-chk"><input type="radio" name="bhor-sleep" value="${o}"> ${o}</label>`).join('')}</div></div>
        <div class="field full"><label>交班事項<small>（限 600 字）</small></label><textarea id="bho-note" maxlength="600" rows="3"></textarea></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="bho-save">資料新增</button>
          <button class="btn secondary" id="bho-cancel" style="display:none">取消編輯</button>
          <span class="error-msg" id="bho-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="row between no-print">
        <h3>新生兒交班單（${rows.length} 筆）</h3>
      </div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th class="no-print">筆數</th><th>交班日期</th><th>體重</th><th>黃疸值</th><th>臍帶</th><th>餵奶方式/安撫奶嘴</th><th>隔離</th><th>睡眠狀況</th><th>交班事項</th><th>建檔人</th></tr></thead>
          <tbody>${listRows || '<tr><td colspan="10"><div class="empty">尚無交班紀錄</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $('#bho-baby').onchange = () => { location.hash = `#/baby-handover?b=${$('#bho-baby').value}`; };
  $('#bho-print').onclick = () => window.print();

  const form = $('#bho-form');
  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
  const radioVal = name => { const el = form.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; };
  let editingId = null;

  // 重要備註／寶寶游泳次數：存在個案 profile（與寶寶評估單同一份）
  $('#bho-note-save').onclick = async () => {
    const err = $('#bho-note-err');
    err.textContent = '';
    try {
      await api(`/babies/${babyId}/eval-profile`, { method: 'PUT', body: {
        handover_note: $('#bho-imp-note').value.trim(), swim_count: v('#bho-swim')
      } });
      $('#bho-note-save').textContent = '已存檔 ✓';
      setTimeout(() => { const b = $('#bho-note-save'); if (b) b.textContent = '備註存檔'; }, 1500);
    } catch (e) { err.textContent = e.message; }
  };

  const setForm = r => {
    editingId = r.id;
    $('#bho-mode').textContent = `編輯（第 ${rows.findIndex(x => x.id === r.id) + 1} 筆）`;
    $('#bho-save').textContent = '資料修改';
    $('#bho-cancel').style.display = '';
    $('#bho-date').value = r.handover_date; $('#bho-time').value = r.handover_time;
    $('#bho-w').value = r.weight_g ?? ''; $('#bho-j').value = r.jaundice ?? '';
    $('#bho-cord').value = r.cord || ''; $('#bho-note').value = r.note || '';
    form.querySelectorAll('[data-ck="bho-iso"]').forEach(c => c.checked = (r.isolation || []).includes(c.value));
    const setRadio = (name, val) => form.querySelectorAll(`input[name="${name}"]`).forEach(c => c.checked = c.value === val);
    setRadio('bhor-feed', r.feed_method); setRadio('bhor-paci', r.pacifier); setRadio('bhor-sleep', r.sleep);
    form.scrollIntoView({ behavior: 'smooth' });
  };
  $('#bho-cancel').onclick = () => viewBabyHandover();

  $('#bho-save').onclick = async () => {
    const err = $('#bho-err');
    err.textContent = '';
    if (!v('#bho-date') || !v('#bho-time')) { err.textContent = '請填寫交班日期與時間'; return; }
    const body = {
      handover_date: v('#bho-date'), handover_time: v('#bho-time'),
      feed_method: radioVal('bhor-feed'), pacifier: radioVal('bhor-paci'),
      isolation: [...form.querySelectorAll('[data-ck="bho-iso"]:checked')].map(c => c.value),
      weight_g: v('#bho-w'), jaundice: v('#bho-j'), cord: v('#bho-cord'),
      sleep: radioVal('bhor-sleep'), note: v('#bho-note')
    };
    try {
      if (editingId) await api(`/baby-handovers/${editingId}`, { method: 'PUT', body });
      else await api(`/babies/${babyId}/handovers`, { method: 'POST', body });
      viewBabyHandover();
    } catch (e) { err.textContent = e.message; }
  };

  main().querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => setForm(rows.find(r => r.id == btn.dataset.edit));
  });
  main().querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆交班紀錄？（會記入稽核軌跡）')) return;
      await api(`/baby-handovers/${btn.dataset.del}`, { method: 'DELETE' });
      viewBabyHandover();
    };
  });
}

/* ---------- 產婦交班單 ---------- */
async function viewMotherHandover() {
  const all = await api('/mothers');
  const mothers = all.filter(m => m.status === 'checked_in');
  if (!mothers.length) {
    main().innerHTML = '<div class="page-title">產婦交班單</div><div class="card"><div class="empty">目前沒有在住媽媽</div></div>';
    return;
  }
  const want = Number((location.hash.split('?m=')[1] || '').split('&')[0]);
  const momId = mothers.some(m => m.id === want) ? want : mothers[0].id;
  const { mother, rows, header } = await api(`/mothers/${momId}/handovers`);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const hv = (label, val) => `<span style="min-width:230px"><b>${label}：</b>${val}</span>`;
  const listRows = rows.map((r, i) => `
      <tr data-filter="${esc(r.handover_date)} ${esc(r.nurse_name || '')}">
        <td data-label="筆數">${i + 1}<br>
          ${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${r.id}" style="margin:2px 0">刪</button>` : ''}
          <button class="btn small secondary" data-edit="${r.id}" style="margin:2px 0">修</button></td>
        <td data-label="交班日期">${esc(r.handover_date)}<br><small>${esc(r.handover_time)}</small></td>
        <td data-label="宮底高度">${esc(r.fundus || '—')}</td>
        <td data-label="惡露"><small>${esc(r.lochia || '—')}</small></td>
        <td data-label="交班事項"><small>${esc(r.note || '—')}</small></td>
        <td data-label="建檔人">${esc(r.nurse_name || '—')}${r.edited_at ? `<br><small title="${esc(r.edited_at)}（${esc(r.edited_by_name || '')}）" style="color:var(--muted)">已修改</small>` : ''}</td>
      </tr>`).join('');

  main().innerHTML = `
    <div class="page-title">產婦交班單</div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇媽媽</label>
          <select id="mho-mom">${mothers.map(m => `<option value="${m.id}" ${m.id === momId ? 'selected' : ''}>${esc(m.name)}${m.room_name ? `（${esc(m.room_name)}）` : ''}</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <a class="btn small secondary" href="#/mother-nursing?m=${momId}">媽媽護理</a>
        <button class="btn small secondary" id="mho-print">資料列印</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">產婦交班單</div>
      <div class="row" style="gap:8px 18px;flex-wrap:wrap;font-size:.93rem;line-height:1.9">
        ${hv('媽媽房號', esc(mother.room_name || '—'))}
        ${hv('媽媽姓名', esc(mother.name))}
        ${hv('生產醫院', esc(header.birth_place || '—'))}
        ${hv('新生兒出生日期', esc(header.baby_birth_date || '—'))}
        ${hv('產式', esc(mother.delivery_type || '—'))}
        ${hv('週數', esc(header.gest_weeks || '—'))}
        ${hv('胎次', esc(header.parity || '—'))}
        ${hv('奶品', esc(header.milk_brand || '—'))}
        ${hv('藥物過敏', esc(header.allergy_drug || '—'))}
        ${hv('生產後天數', header.postpartum_days != null ? `${header.postpartum_days} 天` : '— 天')}
        ${hv('宮底高度', header.fundus_now ? `${esc(header.fundus_now.value)}<small>（${esc(header.fundus_now.at)}）</small>` : '—')}
        ${hv('惡露', header.lochia_now ? `${esc(header.lochia_now.value)}<small>（${esc(header.lochia_now.at)}）</small>` : '—')}
      </div>
      <div class="form-grid no-print" style="margin-top:10px">
        <div class="field full"><label>飲食禁忌</label><textarea id="mho-diet" maxlength="500" rows="2">${esc(mother.diet_notes || '')}</textarea></div>
        <div class="field full"><label>重要備註</label><textarea id="mho-imp-note" maxlength="500" rows="2">${esc(header.handover_note)}</textarea></div>
        <div class="full row" style="gap:10px;align-items:center">
          <button class="btn" id="mho-note-save">存檔</button>
          ${header.intake_filled ? '' : '<span style="color:var(--danger);font-size:.9rem">**尚未填寫入住評估單</span>'}
          <span class="error-msg" id="mho-note-err"></span>
        </div>
      </div>
    </div>
    <div class="card no-print">
      <div class="sec-hd warn">特殊飲品及特殊餐</div>
      <div class="form-grid">
        <div class="field"><label>生化湯</label><input id="mho-sp-shenghua" maxlength="100" value="${esc(header.sp_shenghua)}"></div>
        <div class="field"><label>紅豆水</label><input id="mho-sp-redbean" maxlength="100" value="${esc(header.sp_redbean)}"></div>
        <div class="field"><label>生麥芽水</label><input id="mho-sp-barley" maxlength="100" value="${esc(header.sp_barley)}"></div>
        <div class="field"><label>退奶餐</label><input id="mho-sp-weaning" maxlength="100" value="${esc(header.sp_weaning)}"></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="mho-sp-save">修改特殊飲品及特殊餐</button>
          <span class="error-msg" id="mho-sp-err"></span>
        </div>
      </div>
    </div>
    <div class="card no-print" id="mho-form">
      <div class="sec-hd">產婦交班單 － <span id="mho-mode">新增</span></div>
      <div class="form-grid">
        <div class="field"><label>填寫交班日期 <b class="req">*</b></label><input type="date" id="mho-date" value="${todayStr()}"></div>
        <div class="field"><label>交班時間 <b class="req">*</b></label><input type="time" id="mho-time" value="${hhmm}"></div>
        <div class="field"><label>宮底高度</label><input id="mho-fundus" maxlength="100"></div>
        <div class="field"><label>惡露</label><input id="mho-lochia" maxlength="200" placeholder="量／顏色"></div>
        <div class="field full"><label>交班事項<small>（限 600 字）</small></label><textarea id="mho-note" maxlength="600" rows="3"></textarea></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="mho-save">資料新增</button>
          <button class="btn secondary" id="mho-cancel" style="display:none">取消編輯</button>
          <span class="error-msg" id="mho-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="row between no-print">
        <h3>產婦交班單（${rows.length} 筆）</h3>
      </div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th class="no-print">筆數</th><th>交班日期</th><th>宮底高度</th><th>惡露</th><th>交班事項</th><th>建檔人</th></tr></thead>
          <tbody>${listRows || '<tr><td colspan="6"><div class="empty">尚無交班紀錄</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $('#mho-mom').onchange = () => { location.hash = `#/mother-handover?m=${$('#mho-mom').value}`; };
  $('#mho-print').onclick = () => window.print();

  const form = $('#mho-form');
  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
  let editingId = null;

  // 飲食禁忌／重要備註：diet_notes 存住客資料、備註存入住評估 profile
  $('#mho-note-save').onclick = async () => {
    const err = $('#mho-note-err');
    err.textContent = '';
    try {
      await api(`/mothers/${momId}/handover-profile`, { method: 'PUT', body: {
        diet_notes: $('#mho-diet').value.trim(), handover_note: $('#mho-imp-note').value.trim()
      } });
      $('#mho-note-save').textContent = '已存檔 ✓';
      setTimeout(() => { const b = $('#mho-note-save'); if (b) b.textContent = '存檔'; }, 1500);
    } catch (e) { err.textContent = e.message; }
  };
  // 特殊飲品及特殊餐
  $('#mho-sp-save').onclick = async () => {
    const err = $('#mho-sp-err');
    err.textContent = '';
    try {
      await api(`/mothers/${momId}/handover-profile`, { method: 'PUT', body: {
        sp_shenghua: v('#mho-sp-shenghua'), sp_redbean: v('#mho-sp-redbean'),
        sp_barley: v('#mho-sp-barley'), sp_weaning: v('#mho-sp-weaning')
      } });
      $('#mho-sp-save').textContent = '已存檔 ✓';
      setTimeout(() => { const b = $('#mho-sp-save'); if (b) b.textContent = '修改特殊飲品及特殊餐'; }, 1500);
    } catch (e) { err.textContent = e.message; }
  };

  const setForm = r => {
    editingId = r.id;
    $('#mho-mode').textContent = `編輯（第 ${rows.findIndex(x => x.id === r.id) + 1} 筆）`;
    $('#mho-save').textContent = '資料修改';
    $('#mho-cancel').style.display = '';
    $('#mho-date').value = r.handover_date; $('#mho-time').value = r.handover_time;
    $('#mho-fundus').value = r.fundus || ''; $('#mho-lochia').value = r.lochia || '';
    $('#mho-note').value = r.note || '';
    form.scrollIntoView({ behavior: 'smooth' });
  };
  $('#mho-cancel').onclick = () => viewMotherHandover();

  $('#mho-save').onclick = async () => {
    const err = $('#mho-err');
    err.textContent = '';
    if (!v('#mho-date') || !v('#mho-time')) { err.textContent = '請填寫交班日期與時間'; return; }
    const body = {
      handover_date: v('#mho-date'), handover_time: v('#mho-time'),
      fundus: v('#mho-fundus'), lochia: v('#mho-lochia'), note: v('#mho-note')
    };
    try {
      if (editingId) await api(`/mother-handovers/${editingId}`, { method: 'PUT', body });
      else await api(`/mothers/${momId}/handovers`, { method: 'POST', body });
      viewMotherHandover();
    } catch (e) { err.textContent = e.message; }
  };

  main().querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => setForm(rows.find(r => r.id == btn.dataset.edit));
  });
  main().querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆交班紀錄？（會記入稽核軌跡）')) return;
      await api(`/mother-handovers/${btn.dataset.del}`, { method: 'DELETE' });
      viewMotherHandover();
    };
  });
}

/* ---------- 護理指導（獨立頁；資料與媽媽護理頁共用） ---------- */
async function viewMotherGuidance() {
  const all = await api('/mothers');
  const mothers = all.filter(m => m.status === 'checked_in');
  if (!mothers.length) {
    main().innerHTML = '<div class="page-title">護理指導</div><div class="card"><div class="empty">目前沒有在住媽媽</div></div>';
    return;
  }
  const want = Number((location.hash.split('?m=')[1] || '').split('&')[0]);
  const momId = mothers.some(m => m.id === want) ? want : mothers[0].id;
  const { mother, guidance, reminders } = await api(`/mothers/${momId}/guidance`);
  const kindLabel = k => k === 'care' ? '產婦衛教指導單' : '母乳哺育評估單';

  main().innerHTML = `
    <div class="page-title">衛教指導 <small style="font-weight:400;color:var(--muted);font-size:.9rem">產婦衛教指導單／母乳哺育評估單</small></div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇媽媽</label>
          <select id="mgl-mom">${mothers.map(m => `<option value="${m.id}" ${m.id === momId ? 'selected' : ''}>${esc(m.name)}${m.room_name ? `（${esc(m.room_name)}）` : ''}</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <a class="btn small secondary" href="#/mother-nursing?m=${momId}">媽媽護理</a>
        <button class="btn small secondary" id="mgl-print">資料列印</button>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn" data-guide-btn="care">產婦衛教指導單</button>
        <button class="btn" data-guide-btn="breastfeeding">母乳哺育評估單</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">護理指導單提醒（入住第 1／3／7／10 天）</div>
      <div class="row" style="gap:6px 18px;flex-wrap:wrap;font-size:.95rem;margin-bottom:8px">
        <span><b>媽媽姓名：</b>${mother.room_name ? `${esc(mother.room_name)}　` : ''}${esc(mother.name)}</span>
        ${mother.check_in ? `<span><b>入住：</b>${esc(mother.check_in)}</span>` : ''}
        ${mother.check_out ? `<span><b>預退：</b>${esc(mother.check_out)}</span>` : ''}
      </div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>排程</th><th>提醒日期</th><th>執行日期</th><th>執行人</th></tr></thead>
          <tbody>${reminders.map(r => `
            <tr>
              <td data-label="排程">${esc(r.day_label)}</td>
              <td data-label="提醒日期">${esc(r.remind_date)}</td>
              <td data-label="執行日期">${r.done_date ? `${esc(r.done_date)}${r.kind ? `<br><small>${kindLabel(r.kind)}</small>` : ''}` : '<span class="badge yellow">未執行</span>'}</td>
              <td data-label="執行人">${esc(r.done_by || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="4"><div class="empty">無入住訂房，無法計算提醒</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>
    `;

  $('#mgl-mom').onchange = () => { location.hash = `#/mother-guidance?m=${$('#mgl-mom').value}`; };
  $('#mgl-print').onclick = () => window.print();

  // 新增指導紀錄：點按鈕跳出視窗（產婦衛教指導單／母乳哺育評估單）
  main().querySelectorAll('[data-guide-btn]').forEach(btn => btn.onclick = () => {
    const kind = btn.dataset.guideBtn;
    openModal(kindLabel(kind), `
      <div class="field"><label>執行日期 <b class="req">*</b></label><input type="date" id="gf-date" value="${todayStr()}"></div>
      <div class="field"><label>指導內容備註<small>（限 300 字）</small></label><textarea id="gf-note" maxlength="300" rows="3"></textarea></div>
      <div class="row mt"><button class="btn" id="gf-save">資料新增</button><span class="error-msg" id="gf-err"></span></div>`, body => {
      body.querySelector('#gf-save').onclick = async () => {
        const date = body.querySelector('#gf-date').value;
        if (!date) { body.querySelector('#gf-err').textContent = '請填寫執行日期'; return; }
        try {
          await api(`/mothers/${momId}/guidance`, { method: 'POST', body: {
            kind, done_date: date, note: body.querySelector('#gf-note').value.trim()
          } });
          closeModal(); viewMotherGuidance();
        } catch (e) { body.querySelector('#gf-err').textContent = e.message; }
      };
    });
  });
}

/* ---------- 產婦結案 ---------- */
async function viewMotherClosure() {
  const all = await api('/mothers');
  const mothers = all.filter(m => m.status === 'checked_in');
  const want = Number((location.hash.split('?m=')[1] || '').split('&')[0]);
  // 結案存檔即同步退房；已退房媽媽仍可經 ?m= 檢視／修改結案單
  if (want && !mothers.some(m => m.id === want)) {
    const extra = all.find(m => m.id === want);
    if (extra) mothers.unshift(extra);
  }
  if (!mothers.length) {
    main().innerHTML = '<div class="page-title">產婦結案</div><div class="card"><div class="empty">目前沒有在住媽媽</div></div>';
    return;
  }
  const momId = mothers.some(m => m.id === want) ? want : mothers[0].id;
  const { mother, closure, summary, options } = await api(`/mothers/${momId}/closure`);
  const d = (closure && closure.data) || {};
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 實際入住天數：入住日 → 結案日（未結案則今日）
  const endDate = closure ? closure.close_date : todayStr();
  const stayDays = mother.check_in
    ? Math.max(1, Math.round((new Date(endDate) - new Date(mother.check_in)) / 86400000) + 1) : null;
  const epdsAlert = summary.epds && summary.epds.total >= 10;

  const hv = (label, val) => `<span style="min-width:230px"><b>${label}：</b>${val}</span>`;
  const sel = (id, opts, val, req = true) =>
    `<select id="${id}" ${req ? 'data-req' : ''}><option value="">請選擇</option>${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;

  main().innerHTML = `
    <div class="page-title">產婦結案</div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇媽媽</label>
          <select id="mcl-mom">${mothers.map(m => `<option value="${m.id}" ${m.id === momId ? 'selected' : ''}>${esc(m.name)}${m.room_name ? `（${esc(m.room_name)}）` : ''}</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <button class="btn small secondary" id="mcl-print">資料列印</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">住期摘要 ${closure ? '<span class="badge gray" style="float:right">已結案</span>' : '<span class="badge yellow" style="float:right">未結案</span>'}</div>
      <div class="row" style="gap:8px 18px;flex-wrap:wrap;font-size:.93rem;line-height:1.9">
        ${hv('媽媽姓名', `${mother.room_name ? esc(mother.room_name) + '　' : ''}${esc(mother.name)}`)}
        ${hv('入住日', esc(mother.check_in || '—'))}
        ${hv('預退日', esc(mother.check_out || '—'))}
        ${hv('實際入住天數', stayDays != null ? `${stayDays} 天` : '—')}
        ${hv('生產日', esc(mother.delivery_date || '—'))}
        ${hv('生產方式', esc(mother.delivery_type || '—'))}
        ${hv('最近生命徵象', summary.vitals ? `${summary.vitals.temperature}°C／脈 ${summary.vitals.pulse}／${summary.vitals.systolic}/${summary.vitals.diastolic} mmHg<small>（${esc(summary.vitals.at)}）</small>` : '—')}
        ${hv('宮縮宮底（最近護理）', esc(summary.fundus_last || '—'))}
        ${hv('惡露（最近護理）', esc(summary.lochia_last || '—'))}
        ${hv('最新 EPDS', summary.epds ? `<b style="color:${epdsAlert ? 'var(--danger)' : 'var(--primary-dark)'}">${summary.epds.total} 分${epdsAlert ? ' ⚠' : ''}</b>（${esc(summary.epds.fill_date)}）` : '—')}
        ${hv('未結案健康問題', summary.open_problems > 0 ? `<b style="color:var(--danger)">${summary.open_problems} 項</b>` : '0 項')}
        ${hv('護理指導完成', `${summary.guidance_done}／${summary.guidance_total || 4} 次`)}
        ${closure ? hv('結案人員', `${esc(closure.nurse_name || '—')}（${esc(closure.created_at.slice(0, 16))}）${closure.edited_at ? `，最後修改 ${esc(closure.edited_at.slice(0, 16))}（${esc(closure.edited_by_name || '')}）` : ''}`) : ''}
      </div>
      ${summary.open_problems > 0 && !closure ? `<div style="color:var(--danger);font-size:.9rem;margin-top:6px">⚠ 尚有 ${summary.open_problems} 項健康問題未結案，建議先至「媽媽護理」處理或於追蹤事項註明。</div>` : ''}
    </div>
    <div class="card" id="mcl-form">
      <div class="sec-hd">產婦結案單（<b>*</b> 為必填）</div>
      <div class="form-grid">
        <div class="field"><label>結案日期 <b class="req">*</b></label><input type="date" id="mcl-date" value="${esc(closure ? closure.close_date : todayStr())}"></div>
        <div class="field"><label>結案時間 <b class="req">*</b></label><input type="time" id="mcl-time" value="${esc(closure ? closure.close_time : hhmm)}"></div>
        <div class="field"><label>結案原因 <b class="req">*</b></label>${sel('mcl-reason', options.reasons, d.reason || '')}</div>
        <div class="field"><label>結案原因補述<small>（選「其他」時必填）</small></label><input id="mcl-reason-other" maxlength="100" value="${esc(d.reason_other || '')}"></div>
        <div class="field"><label>去向 <b class="req">*</b></label>${sel('mcl-dest', options.destinations, d.destination || '')}</div>
        <div class="field"><label>轉至院所名稱<small>（選「轉至醫療院所」時必填）</small></label><input id="mcl-hospital" maxlength="100" value="${esc(d.hospital || '')}"></div>
        <div class="field"><label>去向補述<small>（選「其他」時必填）</small></label><input id="mcl-dest-other" maxlength="100" value="${esc(d.destination_other || '')}"></div>
        <div class="field full"><label>出住衛教完成項目（多選）</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${options.educations.map(o =>
            `<label class="bna-chk"><input type="checkbox" data-ck="mcl-edu" value="${esc(o)}" ${(d.educations || []).includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div></div>
        <div class="field full"><label>追蹤與轉介事項</label><textarea id="mcl-follow" maxlength="500" rows="2">${esc(d.follow_up || '')}</textarea></div>
        <div class="field full"><label>結案摘要<small>（限 600 字）</small></label><textarea id="mcl-note" maxlength="600" rows="3">${esc(closure ? closure.note : '')}</textarea></div>
        <div class="full row no-print" style="gap:10px">
          <button class="btn" id="mcl-save">${closure ? '更新結案' : '結案存檔'}</button>
          ${closure && currentUser.role === 'admin' ? '<button class="btn danger" id="mcl-reopen">解除結案</button>' : ''}
          <span class="error-msg" id="mcl-err"></span>
        </div>
      </div>
    </div>`;

  $('#mcl-mom').onchange = () => { location.hash = `#/mother-close?m=${$('#mcl-mom').value}`; };
  $('#mcl-print').onclick = () => window.print();

  const form = $('#mcl-form');
  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };

  $('#mcl-save').onclick = async () => {
    const err = $('#mcl-err');
    err.textContent = '';
    if (!v('#mcl-date') || !v('#mcl-time')) { err.textContent = '請填寫結案日期與時間'; return; }
    for (const el of form.querySelectorAll('[data-req]')) {
      if (!el.value) { err.textContent = '尚有必填欄位未選擇'; el.focus(); return; }
    }
    if (v('#mcl-reason') === '其他' && !v('#mcl-reason-other')) { err.textContent = '結案原因選「其他」時，補述必填'; return; }
    if (v('#mcl-dest') === '轉至醫療院所' && !v('#mcl-hospital')) { err.textContent = '去向選「轉至醫療院所」時，院所名稱必填'; return; }
    if (v('#mcl-dest') === '其他' && !v('#mcl-dest-other')) { err.textContent = '去向選「其他」時，補述必填'; return; }
    if (!closure && !confirm(`確認為「${mother.name}」建立結案？結案存檔即代表已退房，媽媽房況將顯示空房。`)) return;
    try {
      await api(`/mothers/${momId}/closure`, { method: 'PUT', body: {
        close_date: v('#mcl-date'), close_time: v('#mcl-time'),
        reason: v('#mcl-reason'), reason_other: v('#mcl-reason-other'),
        destination: v('#mcl-dest'), hospital: v('#mcl-hospital'), destination_other: v('#mcl-dest-other'),
        educations: [...form.querySelectorAll('[data-ck="mcl-edu"]:checked')].map(c => c.value),
        follow_up: v('#mcl-follow'), note: v('#mcl-note')
      } });
      viewMotherClosure();
    } catch (e) { err.textContent = e.message; }
  };

  const reopen = $('#mcl-reopen');
  if (reopen) reopen.onclick = async () => {
    if (!confirm('確定解除結案？結案單內容將刪除（會記入稽核軌跡）；若退房是結案時自動產生的，將一併恢復為入住中。')) return;
    await api(`/mother-closures/${momId}`, { method: 'DELETE' });
    viewMotherClosure();
  };
}

/* ---------- 產科醫師查房清單（列印工作單；醫師評估欄留白可手寫） ---------- */
async function viewRoundsList() {
  const { date, center_name, rows } = await api('/physician-rounds');
  const ts = new Date().toLocaleString('sv').replace('T', ' ');
  main().innerHTML = `
    <div class="card no-print">
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <button class="btn small" id="prl-print">開始列印</button>
        <a class="btn small secondary" href="/api/physician-rounds?format=xlsx">匯出 Excel</a>
      </div>
    </div>
    <div style="text-align:center;font-weight:700;font-size:1.05rem">${esc(center_name || '')}</div>
    <div class="row between" style="margin:4px 0 6px">
      <span style="font-weight:700">產科醫師查房清單</span>
      <small>印表：${esc(ts)}</small>
    </div>
    <div class="table-wrap">
      <table class="data" style="min-width:900px">
        <thead><tr><th style="width:56px">房號</th><th style="width:90px">姓名</th><th style="width:56px">胎次</th><th style="width:100px">生產方式</th><th style="width:70px">生產天數</th><th>媽媽問題</th><th>護理評估發現</th><th style="width:24%">醫師評估記錄</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr style="height:64px">
            <td data-label="房號">${esc(r.room_name)}</td>
            <td data-label="姓名">${esc(r.name)}</td>
            <td data-label="胎次">${esc(r.parity || '')}</td>
            <td data-label="生產方式">${esc(r.delivery_type || '')}</td>
            <td data-label="生產天數">${r.postpartum_days != null ? `${r.postpartum_days} 天` : ''}</td>
            <td data-label="媽媽問題"><small>${esc(r.problems || '')}</small></td>
            <td data-label="護理評估發現"><small>${esc(r.nursing_findings || '')}</small></td>
            <td data-label="醫師評估記錄"><small>${esc(r.doctor_note || '')}</small></td>
          </tr>`).join('') || '<tr><td colspan="8"><div class="empty">目前沒有在住媽媽</div></td></tr>'}</tbody>
      </table>
    </div>
    <small style="color:var(--muted)" class="no-print">＊清單日期 ${esc(date)}；醫師評估記錄欄帶入最近一次巡診摘要，無紀錄則留白供查房手寫。</small>`;
  $('#prl-print').onclick = () => window.print();
}

/* ---------- 寶寶報喜（依生產日查詢） ---------- */
async function viewBabyAnnouncements() {
  const qd = (location.hash.split('?d=')[1] || '').split('&')[0];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd : todayStr();
  const { rows } = await api(`/baby-announcements?date=${date}`);
  const shift = days => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    location.hash = `#/baby-announcements?d=${d.toISOString().slice(0, 10)}`;
  };
  main().innerHTML = `
    <div class="page-title">寶寶報喜 <small style="font-weight:400;color:var(--muted);font-size:.9rem">依實際生產日期查詢</small></div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
        <span>查詢報喜日期：</span>
        <button class="btn small danger" id="ban-prev">prev</button>
        <input type="date" id="ban-date" value="${date}" style="width:auto">
        <button class="btn small danger" id="ban-next">next</button>
        <button class="btn small" id="ban-go">查詢</button>
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <button class="btn small secondary" id="ban-print">資料列印</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">寶寶報喜（查詢結果）</div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>筆數</th><th>媽媽姓名</th><th>實際生產日期</th><th>媽媽預計入住日期</th><th>生產方式</th><th>寶寶預計入住日期</th><th>性別</th><th>寶寶體重</th><th>黃疸值</th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr>
              <td data-label="筆數">${i + 1}</td>
              <td data-label="媽媽姓名">${esc(r.mother_name)}<br><small>${esc(r.baby_name)}</small></td>
              <td data-label="實際生產日期">${esc(r.birth_date)}</td>
              <td data-label="媽媽預計入住">${esc(r.mother_check_in || '—')}</td>
              <td data-label="生產方式">${esc(r.delivery_type || '—')}</td>
              <td data-label="寶寶預計入住">${esc(r.baby_check_in || '—')}</td>
              <td data-label="性別">${r.gender === 'male' ? '<span style="color:#3b78c2">男</span>' : r.gender === 'female' ? '<span style="color:var(--accent)">女</span>' : '—'}</td>
              <td data-label="寶寶體重">${r.birth_weight_g ? `${r.birth_weight_g} g` : '—'}</td>
              <td data-label="黃疸值">${r.jaundice != null ? `${r.jaundice} mg/dl` : '—'}</td>
            </tr>`).join('') || '<tr><td colspan="9"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  $('#ban-prev').onclick = () => shift(-1);
  $('#ban-next').onclick = () => shift(1);
  $('#ban-go').onclick = () => { location.hash = `#/baby-announcements?d=${$('#ban-date').value}`; };
  $('#ban-print').onclick = () => window.print();
}

/* ---------- 病歷資料（依媽媽姓名查歷史住客＋護理紀錄） ---------- */
async function viewMedicalRecords() {
  main().innerHTML = `
    <div class="page-title">病歷資料</div>
    <div class="card">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>媽媽姓名 <b class="req">*</b></label>
          <input id="mrq-name" placeholder="輸入姓名（可部分比對）"></div>
        <button class="btn" id="mrq-go">送出查詢</button>
        <button class="btn secondary" id="mrq-clear">清空重查</button>
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <span class="error-msg" id="mrq-err"></span>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">媽媽資料查詢結果</div>
      <div id="mrq-moms"><div class="empty">請輸入姓名查詢</div></div>
    </div>
    <div class="card">
      <div class="sec-hd">護理資料（查詢結果）</div>
      <div id="mrq-nursing"><div class="empty">您輸入的條件，查無資料 …</div></div>
    </div>`;

  const search = async () => {
    const err = $('#mrq-err');
    err.textContent = '';
    const name = $('#mrq-name').value.trim();
    if (!name) { err.textContent = '請輸入媽媽姓名'; return; }
    try {
      const { rows } = await api(`/medical-records?name=${encodeURIComponent(name)}`);
      $('#mrq-moms').innerHTML = rows.length ? `
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>筆數</th><th>媽媽姓名</th><th>生產方式</th><th>入出住日期</th><th>入住房號</th><th>寶寶性別</th><th>聯絡電話</th><th class="no-print"></th></tr></thead>
          <tbody>${rows.map((m, i) => `
            <tr>
              <td data-label="筆數">${i + 1}</td>
              <td data-label="媽媽姓名">${esc(m.name)}${m.status === 'checked_in' ? ' <span class="badge green">在住</span>' : ''}</td>
              <td data-label="生產方式">${esc(m.delivery_type || '—')}</td>
              <td data-label="入出住日期"><small>${esc(m.stay_range || '—')}</small></td>
              <td data-label="入住房號">${esc(m.room_name || '—')}</td>
              <td data-label="寶寶性別">${esc(m.baby_genders || '—')}</td>
              <td data-label="聯絡電話">${esc(m.phone || '—')}</td>
              <td data-label="" class="no-print"><button class="btn small" data-nursing="${m.id}" data-name="${esc(m.name)}">護理資料</button></td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">您輸入的條件，查無資料 …</div>';
      $('#mrq-moms').querySelectorAll('[data-nursing]').forEach(btn => btn.onclick = () => loadNursing(btn.dataset.nursing, btn.dataset.name));
    } catch (e) { err.textContent = e.message; }
  };

  const loadNursing = async (mid, name) => {
    const { rows } = await api(`/mothers/${mid}/nursing`);
    $('#mrq-nursing').innerHTML = `
      <div style="margin-bottom:6px"><b>${esc(name)}</b>　共 ${rows.length} 筆護理評估</div>
      ${rows.length ? `<div class="table-wrap"><table class="data stack">
        <thead><tr><th>日期時間</th><th>生命徵象</th><th>宮縮宮底</th><th>惡露</th><th>傷口</th><th>乳房</th><th>精神/活動力</th><th>護理師</th></tr></thead>
        <tbody>${rows.map(r => {
          const d = r.data || {};
          return `<tr>
            <td data-label="日期時間">${esc(r.assess_date)}<br><small>${esc(r.assess_time)}</small></td>
            <td data-label="生命徵象"><small>${r.temperature}°C／脈 ${r.pulse}<br>${r.systolic}/${r.diastolic} mmHg</small></td>
            <td data-label="宮縮宮底"><small>${esc(d.uterus || '—')}${d.fundus_note ? `<br>${esc(d.fundus_note)}` : ''}</small></td>
            <td data-label="惡露"><small>${esc([d.lochia_amount, d.lochia_color].filter(Boolean).join('／') || '—')}</small></td>
            <td data-label="傷口"><small>${esc(d.wound || '—')}</small></td>
            <td data-label="乳房"><small>左 ${esc(d.breast_l || '—')}／右 ${esc(d.breast_r || '—')}</small></td>
            <td data-label="精神/活動力"><small>${esc(d.mental || '—')}／${esc(d.activity || '—')}</small></td>
            <td data-label="護理師">${esc(r.nurse_name || '—')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<div class="empty">此媽媽尚無護理評估紀錄</div>'}`;
  };

  $('#mrq-go').onclick = search;
  $('#mrq-name').onkeydown = e => { if (e.key === 'Enter') search(); };
  $('#mrq-clear').onclick = () => viewMedicalRecords();
}

/* ---------- 房況列印（目前入住媽媽房況一覽） ---------- */
async function viewMotherRoomsPrint() {
  const data = await api('/room-status/mothers');
  const occupied = data.rooms.filter(r => r.occupant);
  main().innerHTML = `
    <div class="card no-print">
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <button class="btn small" id="rsp-print">開始列印</button>
      </div>
    </div>
    <div style="text-align:center;font-weight:700;font-size:1.1rem;margin-bottom:4px">${esc(SETTINGS.center_name || '')}</div>
    <div style="margin-bottom:6px">日期：${esc(data.date)}　目前入住媽媽房況資料</div>
    <div class="table-wrap">
      <table class="data rsp-cards" style="width:100%">
        <tbody>${(() => {
          const cells = occupied.map(r => `
            <td style="text-align:center;vertical-align:top;padding:10px">
              <div style="font-weight:700">${esc(r.name)}</div>
              <div>媽媽姓名：${esc(r.occupant.mother_name)}</div>
              <div>入住日期：${esc(r.occupant.check_in)}</div>
              <div>預退日期：${esc(r.occupant.check_out)}</div>
              <div>入住天數：${r.occupant.stay_day} / ${r.occupant.stay_total} 天</div>
            </td>`);
          const trs = [];
          for (let i = 0; i < cells.length; i += 2) trs.push(`<tr>${cells[i]}${cells[i + 1] || '<td></td>'}</tr>`);
          return trs.join('');
        })() || '<tr><td><div class="empty">目前沒有在住媽媽</div></td></tr>'}</tbody>
      </table>
    </div>`;
  $('#rsp-print').onclick = () => window.print();
}

/* ---------- 空白媽媽評估單（列印手寫用；選項攤平成勾選框） ---------- */
function viewMotherIntakeBlank() {
  const bl = (w = 130) => `<span class="bf-line" style="min-width:${w}px"></span>`;
  const cks = opts => opts.map(o => `<span class="bf-ck">□ ${esc(o)}</span>`).join('');
  const it = (label, content, full = false) => `<div class="bf-item ${full ? 'full' : ''}"><b>${esc(label)}：</b>${content}</div>`;
  const O = MIA_OPT, M = MIA_MULTI;

  main().innerHTML = `
    <div class="card no-print">
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <a class="btn small secondary" href="#/mother-rooms">回媽媽房況</a>
        <a class="btn small secondary" href="#/mother-intake">線上填寫（入住評估表）</a>
        <button class="btn small" id="mib-print">開始列印</button>
      </div>
      <small style="color:var(--muted)">＊本頁為空白紙本評估單（供列印手寫）；線上填寫請使用「入住評估表」。</small>
    </div>
    <div class="bf-sheet">
      <div style="text-align:center;font-weight:700;font-size:1.1rem">${esc(SETTINGS.center_name || '')}</div>
      <div style="text-align:center;font-weight:700;margin-bottom:6px">產婦入住護理評估表</div>
      <div class="bf-grid">
        ${it('產婦病歷號', bl())}${it('產婦姓名', bl())}${it('填表日期', bl())}
        ${it('產婦身分證號', bl())}${it('填表人', bl())}${it('填表人身分證', bl())}
      </div>
      <div class="bf-sec">中衛必要欄位</div>
      <div class="bf-grid">
        ${it('縣市／區域', bl(90) + '　' + bl(90))}
        ${it('巷弄門牌', bl(220))}
        ${it('市話', bl())}
        ${it('教育程度', cks(O.education) + ' 其他' + bl(70), true)}
        ${it('語言(多選)', cks(M.languages) + ' 其他' + bl(70))}
        ${it('婚姻狀態', cks(O.marital))}
        ${it('孕次(G)／產次(P)／流產(A)', bl(40) + '／' + bl(40) + '／' + bl(40))}
        ${it('生產方式/輔助(多選)', cks(M.delivery_modes) + ' 其他' + bl(70), true)}
        ${it('高危妊娠/併發症', cks(O.highRisk) + ' 其他' + bl(70), true)}
        ${it('工作/職業', bl())}
        ${it('過敏史主類別', cks(O.allergyCat))}
        ${it('食物過敏說明', bl(180))}
        ${it('藥物過敏說明', bl(180))}
        ${it('飲酒史', cks(O.alcohol) + ' 其他' + bl(60))}
        ${it('抽菸史', cks(O.smoking) + ' 其他' + bl(60))}
        ${it('既往病史/手術史', cks(O.pastHx) + ' 其他' + bl(70), true)}
        ${it('梅毒檢驗 RPR', cks(O.lab3))}
        ${it('愛滋檢驗 HIV', cks(O.lab3))}
        ${it('水痘檢驗', cks(O.varicella))}
        ${it('B型肝炎 HBsAg', cks(O.lab3))}
        ${it('B型肝炎 HBeAg', cks(O.lab3))}
        ${it('服藥/帶藥紀錄', cks(O.ynMed))}
        ${it('服藥明細(藥名/量/時間)', bl(400), true)}
        ${it('旅遊史', cks(O.ynMed) + ' 說明' + bl(120))}
        ${it('發燒史', cks(O.ynMed) + ' 說明' + bl(120))}
        ${it('接觸史', cks(['有', '無']))}
        ${it('接觸史細項(多選)', cks(M.contact_items) + ' 其他' + bl(90), true)}
        ${it('感染症狀', cks(['有', '無']) + '　細項：' + cks(M.infection_items), true)}
        ${it('特殊需求', cks(['有', '無']) + '　細項：' + cks(M.special_items) + ' 其他' + bl(80), true)}
        ${it('主要陪伴者姓名', bl())}
        ${it('陪伴者電話', bl())}
        ${it('陪伴者關係', bl())}
      </div>
      <div class="bf-sec">中衛入住評估欄位</div>
      <div class="bf-grid">
        ${it('身高', bl(60) + ' cm')}${it('體重', bl(60) + ' kg')}${it('體溫', bl(60) + ' °C')}
        ${it('呼吸', bl(60) + ' 次/分')}${it('血壓', bl(45) + '／' + bl(45) + ' mmHg')}${it('脈搏', bl(60) + ' 次/分')}
        ${it('左耳評估', cks(O.ear) + ' 其他' + bl(60), true)}
        ${it('右耳評估', cks(O.ear) + ' 其他' + bl(60), true)}
        ${it('鼻子評估', cks(O.nose) + ' 其他' + bl(60))}
        ${it('口腔評估', cks(O.mouth) + ' 其他' + bl(60))}
        ${it('頸部評估', cks(O.neck) + ' 其他' + bl(60))}
        ${it('視力狀態', cks(O.vision) + ' 說明' + bl(60), true)}
        ${it('意識狀態', cks(O.consciousness))}
        ${it('皮膚狀態', cks(O.skin) + '　細項：' + cks(M.skin_items) + ' 說明' + bl(80), true)}
        ${it('情緒表現', cks(O.emotion) + '　細項：' + cks(M.emotion_items), true)}
        ${it('態度表現', cks(O.attitude))}
        ${it('呼吸速率(質)', cks(O.respQuality))}
        ${it('呼吸型態', cks(O.respPattern) + ' 其他' + bl(60))}
        ${it('心跳速率', cks(O.heartRate) + ' 其他' + bl(60))}
        ${it('四肢循環-溫度', cks(O.limbTemp))}
        ${it('四肢循環-顏色', cks(O.limbColor))}
        ${it('腹部外觀', cks(O.abdomen) + ' 其他' + bl(60))}
        ${it('上肢評估', cks(O.limb) + ' 其他' + bl(60))}
        ${it('下肢評估', cks(O.limb) + ' 其他' + bl(60))}
        ${it('排尿', cks(O.urination) + ' 補述' + bl(60), true)}
        ${it('排便', cks(O.bowel) + ' 補述' + bl(60))}
        ${it('子宮復舊(宮縮宮底)', cks(O.uterus) + ' 宮底Fb' + bl(60))}
        ${it('惡露量', cks(O.lochiaAmount))}
        ${it('惡露性質(多選)', cks(M.lochia_nature) + '　血塊：' + cks(['有', '無']) + ' 備註' + bl(70), true)}
        ${it('會陰/腹部傷口', cks(O.wound) + ' 滲液量' + bl(50) + ' 顏色' + bl(50), true)}
        ${it('活動力', cks(O.activity), true)}
        ${it('入住主要需求(多選)', cks(M.needs) + ' 其他' + bl(80), true)}
        ${it('左乳房評估', cks(O.breast) + ' 其他' + bl(50), true)}
        ${it('右乳房評估', cks(O.breast) + ' 其他' + bl(50), true)}
        ${it('乳房硬塊', cks(['有', '無']) + ' 說明' + bl(80))}
        ${it('乳頭長度', cks(O.nippleLen))}
        ${it('乳頭大小', cks(O.nippleSize))}
        ${it('餵母奶經驗', cks(['有', '無']) + '　前胎持續：' + cks(O.bfPrevDuration), true)}
        ${it('前胎停止餵母奶原因(多選)', cks(M.bf_stop_reasons) + ' 其他' + bl(70), true)}
        ${it('預計餵母奶時間', cks(O.bfPlannedTime) + ' 其他' + bl(50), true)}
        ${it('此胎餵母奶意願', cks(O.bfIntent) + ' 不餵原因' + bl(70), true)}
        ${it('家人/機構對母乳支持', cks(O.familySupport))}
        ${it('疼痛評估', cks(O.pain))}
        ${it('疼痛分數(0-10)', bl(40))}
        ${it('疼痛部位／性質', bl(70) + '／' + bl(70))}
        ${it('疼痛時間／備註', bl(70) + '／' + bl(110))}
      </div>
      <div class="bf-grid" style="margin-top:8px">
        ${it('護理師簽名', bl(140))}${it('主管覆核', bl(140))}${it('日期', bl(120))}
      </div>
    </div>`;
  $('#mib-print').onclick = () => window.print();
}

/* ---------- 客戶管理（潛在客戶＋整合查詢） ---------- */
const CUST_OPT = {
  identity: ['一般客戶', 'VIP', '舊客回住', '員工親友', '其他'],
  source: ['網路', '雜誌', '親友介紹', '路過看到', '報紙', '其他'],
  care_exp: ['無', '有（本館）', '有（其他機構）'],
  parity: ['1', '2', '3', '4以上'],
  relation: ['先生', '父母', '兄弟姊妹', '朋友', '其他'],
  baby_gender: ['男', '女', '雙胞胎']
};
const CUST_STATUS = { reserved: ['潛客/預約', 'teal'], checked_in: ['在住', 'green'], checked_out: ['已退住', 'gray'] };

async function viewCustomers() {
  const deepId = Number((location.hash.split('?m=')[1] || '').split('&')[0]) || null;
  const sel = (id, opts, val) => `<select id="${id}"><option value="">--請選擇--</option>${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  let editId = null;

  main().innerHTML = `
    <div class="page-title">客戶管理 <small style="font-weight:400;color:var(--muted);font-size:.9rem">潛在客戶與媽媽資料查詢</small></div>
    <div class="card">
      <div class="sec-hd">客戶資料查詢</div>
      <div class="form-grid">
        <div class="field"><label>媽媽姓名</label><input id="cq-name" placeholder="可部分比對"></div>
        <div class="field"><label>連絡電話</label><input id="cq-phone"></div>
        <div class="field"><label>預產期</label><input type="date" id="cq-due"></div>
        <div class="field"><label>合約編號<small>（輸入後 3~8 碼）</small></label><input id="cq-contract"></div>
        <div class="full row" style="gap:10px;flex-wrap:wrap">
          <button class="btn" id="cq-go">送出查詢</button>
          <button class="btn secondary" id="cq-clear">清空重查</button>
          <a class="btn small secondary" href="#/tour-calendar">預約參觀行事曆</a>
          <span class="error-msg" id="cq-err"></span>
        </div>
      </div>
      <div id="cq-result" style="margin-top:8px"><div class="empty">請輸入條件查詢（姓名／電話／預產期／合約編號擇一）</div></div>
    </div>
    <div id="cq-pending"></div>
    <div id="cust-banner"></div>
    <div class="ctabs no-print" id="cust-tabs"></div>
    <div id="tab-lead"><div id="cust-form-wrap"></div><div id="cust-logs"></div></div>
    <div id="cust-extra"></div>`;

  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };

  // ----- 潛客表單（新增／修改共用） -----
  const renderForm = (m = {}, p = {}) => {
    $('#cust-form-wrap').innerHTML = `
    <div class="card" id="cust-form">
      <div class="sec-hd">${editId ? `修改潛在客戶 － ${esc(m.name)}` : '新增潛在客戶'}</div>
      <div class="form-grid">
        <div class="field"><label>媽媽姓名 <b class="req">*</b></label><input id="cf-name" maxlength="50" value="${esc(m.name || '')}"></div>
        <div class="field"><label>媽媽身份</label>${sel('cf-identity', CUST_OPT.identity, p.identity || '一般客戶')}</div>
        <div class="field"><label>身分證號</label><input id="cf-idno" maxlength="10" value="${esc(m.id_no || '')}"></div>
        <div class="field"><label>媽媽資料來源</label>${sel('cf-source', CUST_OPT.source, p.source || '')}</div>
        <div class="field"><label>媽媽出生日期</label><input type="date" id="cf-birth" value="${esc(m.birth_date || '')}"></div>
        <div class="field"><label>預計生產方式</label>${sel('cf-delmode', deliveryTypes(), m.delivery_type || '')}</div>
        <div class="field"><label>媽媽預產期 <b class="req">*</b></label><input type="date" id="cf-due" value="${esc(m.due_date || '')}"></div>
        <div class="field"><label>預定入住天數</label><input type="number" min="0" id="cf-days" value="${esc(p.stay_days || '')}"></div>
        <div class="field"><label>媽媽手機</label><input id="cf-phone" maxlength="20" value="${esc(m.phone || '')}"></div>
        <div class="field"><label>入住產後護理經驗</label>${sel('cf-careexp', CUST_OPT.care_exp, p.care_exp || '')}</div>
        <div class="field"><label>聯絡電話（市話）</label><input id="cf-tel" maxlength="20" value="${esc(p.tel || '')}"></div>
        <div class="field"><label>預計生產醫院</label><input id="cf-hospital" maxlength="100" value="${esc(p.hospital || '')}"></div>
        <div class="field"><label>胎次</label>${sel('cf-parity', CUST_OPT.parity, p.parity || '')}</div>
        <div class="field"><label>地區</label><input id="cf-region" maxlength="50" value="${esc(p.region || '')}"></div>
        <div class="field"><label>喜好房型</label><input id="cf-roompref" maxlength="50" value="${esc(p.room_pref || '')}"></div>
        <div class="field"><label>寶寶性別</label>${sel('cf-bgender', CUST_OPT.baby_gender, p.baby_gender || '')}</div>
        <div class="field full"><label>E-MAIL</label><input id="cf-email" maxlength="100" value="${esc(p.email || '')}"></div>
        <div class="field full"><label>通訊地址</label><input id="cf-address" maxlength="200" value="${esc(p.address || '')}"></div>
        <div class="field full"><label>潛客備註</label><textarea id="cf-note" maxlength="500" rows="3" placeholder="請填入潛客備註">${esc(p.note || '')}</textarea></div>
        <div class="field"><label>聯絡人</label><input id="cf-cname" maxlength="50" value="${esc(p.contact_name || '')}"></div>
        <div class="field"><label>與媽媽關係</label>${sel('cf-crel', CUST_OPT.relation, p.contact_relation || '')}</div>
        <div class="field"><label>聯絡人手機</label><input id="cf-cmobile" maxlength="20" value="${esc(p.contact_mobile || '')}"></div>
        <div class="field"><label>爸爸年齡</label><input type="number" min="0" id="cf-fage" value="${esc(p.father_age || '')}"></div>
        <div class="field"><label>聯絡人電話（市話）</label><input id="cf-ctel" maxlength="20" value="${esc(p.contact_tel || '')}"></div>
        <div class="field"><label>聯絡人E-MAIL</label><input id="cf-cemail" maxlength="100" value="${esc(p.contact_email || '')}"></div>
        <div class="field full"><label>聯絡人通訊地址</label><input id="cf-caddr" maxlength="200" value="${esc(p.contact_address || '')}"></div>
        <div class="field" style="background:#e8f4fb;border-radius:6px;padding:8px"><label>介紹人</label><input id="cf-ref" maxlength="50" value="${esc(p.referrer || '')}"></div>
        <div class="field" style="background:#e8f4fb;border-radius:6px;padding:8px"><label>介紹人手續費</label><input type="number" min="0" id="cf-reffee" value="${esc(p.referrer_fee || '')}"></div>
        <div class="field full" style="background:#e8f4fb;border-radius:6px;padding:8px"><label>介紹人備註</label><textarea id="cf-refnote" maxlength="500" rows="2" placeholder="請填入介紹人備註">${esc(p.referrer_note || '')}</textarea></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="cf-save">${editId ? '資料修改' : '資料新增'}</button>
          ${editId ? '<button class="btn secondary" id="cf-new">切換新增模式</button>' : ''}
          <span class="error-msg" id="cf-err"></span>
        </div>
      </div>
    </div>`;
    $('#cf-save').onclick = saveForm;
    const bn = $('#cf-new');
    if (bn) bn.onclick = resetNew;
  };

  const collectForm = () => ({
    name: v('#cf-name'), id_no: v('#cf-idno'), birth_date: v('#cf-birth'), due_date: v('#cf-due'),
    phone: v('#cf-phone'), delivery_mode: v('#cf-delmode'),
    identity: v('#cf-identity'), source: v('#cf-source'), stay_days: v('#cf-days'),
    care_exp: v('#cf-careexp'), tel: v('#cf-tel'), hospital: v('#cf-hospital'),
    parity: v('#cf-parity'), region: v('#cf-region'), room_pref: v('#cf-roompref'),
    baby_gender: v('#cf-bgender'), email: v('#cf-email'), address: v('#cf-address'), note: v('#cf-note'),
    contact_name: v('#cf-cname'), contact_relation: v('#cf-crel'), contact_mobile: v('#cf-cmobile'),
    contact_tel: v('#cf-ctel'), contact_email: v('#cf-cemail'), contact_address: v('#cf-caddr'),
    father_age: v('#cf-fage'), referrer: v('#cf-ref'), referrer_fee: v('#cf-reffee'), referrer_note: v('#cf-refnote')
  });

  async function saveForm() {
    const err = $('#cf-err');
    err.textContent = '';
    const body = collectForm();
    if (!body.name) { err.textContent = '請填寫媽媽姓名'; return; }
    if (!body.due_date) { err.textContent = '請填寫媽媽預產期'; return; }
    try {
      if (editId) {
        await api(`/customers/${editId}`, { method: 'PUT', body });
        await selectCustomer(editId);
      } else {
        const r = await api('/customers', { method: 'POST', body });
        await selectCustomer(r.id);
      }
    } catch (e) { err.textContent = e.message; }
  }

  // ----- 選取客戶：紅色橫幅＋表單帶入＋分頁關聯資料 -----
  async function selectCustomer(id) {
    let d;
    try { d = await api(`/customers/${id}`); } catch (e) { alert(e.message); return; }
    editId = id;
    const m = d.mother;
    $('#cust-banner').innerHTML = `
      <div class="card" style="background:var(--danger);color:#fff;padding:10px 16px">
        <div class="row between" style="flex-wrap:wrap;gap:8px;align-items:center">
          <span>潛在客戶資料：<b>${esc(m.name)}</b>　｜　電話：${esc(m.phone || '—')}
            <span class="badge ${CUST_STATUS[m.status] ? CUST_STATUS[m.status][1] : 'gray'}" style="margin-left:8px">${CUST_STATUS[m.status] ? CUST_STATUS[m.status][0] : m.status}</span></span>
          <button class="btn small secondary" id="cb-new">切換新增模式</button>
        </div>
      </div>`;
    $('#cb-new').onclick = resetNew;
    renderForm(m, d.profile || {});
    renderTabs(d);
    $('#cust-banner').scrollIntoView({ behavior: 'smooth' });
  }

  function resetNew() {
    editId = null;
    $('#cust-banner').innerHTML = '';
    renderForm();
    renderTabs(null);
  }

  // ----- 分頁：潛在客戶／預約參觀／合約資料／排房資料／膳食資訊／入住資訊／消費及收款 -----
  const CTABS = [['lead', '潛在客戶'], ['tours', '預約參觀'], ['contracts', '合約資料'], ['rooms', '排房資料'],
    ['meals', '膳食資訊'], ['pay', '入住前收款紀錄']];
  const BK_ST = { reserved: ['已預約', 'teal'], checked_in: ['入住中', 'green'], checked_out: ['已退住', 'gray'], cancelled: ['取消', 'gray'] };
  const CT_ST = { pending: ['待簽', 'yellow'], signed: ['已簽', 'green'], void: ['作廢', 'gray'] };

  let curTab = 'lead';
  function showTab(k) {
    curTab = k;
    $('#cust-tabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
    $('#tab-lead').style.display = k === 'lead' ? '' : 'none';
    $('#cust-extra').querySelectorAll('.cpanel').forEach(p => { p.style.display = p.dataset.tab === k ? '' : 'none'; });
  }

  function renderTabs(d) {
    // 防呆：已存合約但尚無排房紀錄 → 排房資料頁籤變色提醒
    const needRooms = d && d.contract && d.contract.status !== 'cancelled' && !d.bookings.some(b => b.status !== 'cancelled');
    $('#cust-tabs').innerHTML = CTABS.map(([k, l]) =>
      `<button data-tab="${k}" ${!d && k !== 'lead' ? 'disabled title="請先查詢並選擇客戶"' : ''}
        ${k === 'rooms' && needRooms ? 'style="background:var(--danger);color:#fff" title="已有合約但尚未排房，請儘速排房"' : ''}>${l}${k === 'rooms' && needRooms ? ' ⚠' : ''}</button>`).join('');
    $('#cust-tabs').querySelectorAll('button:not([disabled])').forEach(b => b.onclick = () => showTab(b.dataset.tab));
    renderLogs(d);
    $('#cust-extra').innerHTML = d ? panelsHTML(d) : '';
    if (d) { wireContract(d); wirePanels(d); }
    showTab(d ? curTab : 'lead');
  }

  // ----- 合約資料分頁：存檔／明細增刪／卡片與諮詢 -----
  function wireContract(d) {
    const cput = async body => {
      await api(`/customers/${editId}/contract`, { method: 'PUT', body });
      await selectCustomer(editId);
    };
    const $q = id => $('#cust-extra').querySelector(id);
    const gv = id => { const el = $q(id); return el ? el.value.trim() : ''; };

    const ctPayload = () => {
      const babies = $('#cust-extra').querySelector('input[name="ctr-babies"]:checked');
      return {
        handler: gv('#ct-handler'), sign_date: gv('#ct-sign'), due_date: gv('#ct-due'),
        expected_check_in: gv('#ct-expin'), expected_check_out: gv('#ct-expout'),
        parity_no: gv('#ct-parity'), baby_count: babies ? babies.value : '',
        delivery_mode: gv('#ct-delmode'), checkup_hospital: gv('#ct-ckhosp'), checkup_doctor: gv('#ct-ckdoc'),
        birth_hospital: gv('#ct-bhosp'), birth_date: gv('#ct-bdate'), birth_mode: gv('#ct-bmode'),
        butler: gv('#ct-butler'), diet_ban: gv('#ct-dietban'), note: gv('#ct-note')
      };
    };
    $q('#ct-save').onclick = async () => {
      const err = $q('#ct-err');
      err.textContent = '';
      if (!gv('#ct-sign') || !gv('#ct-due')) { err.textContent = '請填寫簽約日期與預產期'; return; }
      try { await cput(ctPayload()); } catch (e) { err.textContent = e.message; }
    };
    // 預計入住日改變 → 預計出住日自動帶入（入住日＋合約訂房總天數）
    const expIn = $q('#ct-expin');
    if (expIn) expIn.onchange = () => {
      const days = Number(expIn.dataset.days) || 0;
      if (!expIn.value || !days) return;
      $q('#ct-expout').value = new Date(new Date(expIn.value + 'T00:00:00Z').getTime() + days * 86400000)
        .toISOString().slice(0, 10);
    };
    // 寶寶報喜：實際生產醫院／日期／方式皆填寫後才可按下；先存檔再開啟填寫視窗（入住通知單）
    const ctAnn = $q('#ct-announce');
    if (ctAnn) ctAnn.onclick = async () => {
      const err = $q('#ct-err');
      err.textContent = '';
      if (!gv('#ct-bhosp') || !gv('#ct-bdate') || !gv('#ct-bmode')) {
        err.textContent = '請先填寫實際生產醫院、實際生產日期、實際生產方式，再按寶寶報喜';
        alert('請先填寫實際生產醫院、實際生產日期、實際生產方式，再按寶寶報喜');
        return;
      }
      try {
        await api(`/customers/${editId}/contract`, { method: 'PUT', body: ctPayload() });
        openBabyAnnounce(d, {
          birth_hospital: gv('#ct-bhosp'), birth_date: gv('#ct-bdate'), birth_mode: gv('#ct-bmode'),
          baby_count: ($('#cust-extra').querySelector('input[name="ctr-babies"]:checked') || {}).value || (d.contract && d.contract.data.baby_count) || '單胞胎'
        });
      } catch (e) { err.textContent = e.message; }
    };
    $q('#ct-fcsave').onclick = () => cput({
      fc_return_date: gv('#ct-fcdate'), fc_no: gv('#ct-fcno'), fc_by: currentUser.name
    }).catch(e => alert(e.message));
    const ctCancel = $q('#ct-cancel');
    if (ctCancel) ctCancel.onclick = async () => {
      const reason = prompt('合約退訂：請填寫退訂原因（必填，記入稽核；退訂後列入「客戶退訂資料」）');
      if (reason == null) return;
      try {
        await api(`/customers/${editId}/contract/cancel`, { method: 'POST', body: { reason } });
        await selectCustomer(editId);
      } catch (e) { alert(e.message); }
    };
    const ctRestore = $q('#ct-restore');
    if (ctRestore) ctRestore.onclick = async () => {
      if (!confirm('確定取消退訂、恢復合約有效？')) return;
      try {
        await api(`/customers/${editId}/contract/restore`, { method: 'POST' });
        await selectCustomer(editId);
      } catch (e) { alert(e.message); }
    };

    const addItem = async price => {
      const err = $q('#ct-item-err');
      err.textContent = '';
      const name = gv('#ct-item-type'), days = gv('#ct-item-days');
      if (!days) { err.textContent = '請填寫訂房天數'; return; }
      try {
        await api(`/customers/${editId}/contract/items`, { method: 'POST',
          body: price != null ? { name, qty: days, price } : { name, qty: days } });
        await selectCustomer(editId);
      } catch (e) { err.textContent = e.message; }
    };
    $q('#ct-item-add').onclick = () => addItem(null);
    // 增加房型：跳出視窗，單價自動帶入房型定價、可手改後儲存
    $q('#ct-item-modal').onclick = () => {
      const typeSel = $q('#ct-item-type');
      const opts = [...typeSel.options].map(o => `<option value="${esc(o.value)}" data-price="${o.dataset.price || 0}">${esc(o.textContent)}</option>`).join('');
      openModal('增加房型', `
        <div class="form-grid">
          <div class="field"><label>銷售房型 <b class="req">*</b></label><select id="im-type">${opts}</select></div>
          <div class="field"><label>訂房天數 <b class="req">*</b></label><input type="number" min="1" id="im-days"></div>
          <div class="field"><label>單價（元/日，可手改）<b class="req">*</b></label><input type="number" min="0" id="im-price"></div>
          <div class="field"><label>小計</label><input id="im-sub" readonly></div>
          <div class="full row"><button class="btn" id="im-save">儲存</button><span class="error-msg" id="im-err"></span></div>
        </div>`, body => {
        const bv = id => body.querySelector(id);
        const syncPrice = () => { bv('#im-price').value = bv('#im-type').selectedOptions[0].dataset.price || 0; syncSub(); };
        const syncSub = () => {
          const n = (Number(bv('#im-days').value) || 0) * (Number(bv('#im-price').value) || 0);
          bv('#im-sub').value = n ? `$${n.toLocaleString()}` : '';
        };
        bv('#im-type').onchange = syncPrice;
        bv('#im-days').oninput = syncSub;
        bv('#im-price').oninput = syncSub;
        syncPrice();
        bv('#im-save').onclick = async () => {
          const days = Number(bv('#im-days').value), price = Number(bv('#im-price').value);
          if (!(days > 0)) { bv('#im-err').textContent = '請填寫訂房天數'; return; }
          if (!(price >= 0)) { bv('#im-err').textContent = '單價需為 0 以上數字'; return; }
          try {
            await api(`/customers/${editId}/contract/items`, { method: 'POST',
              body: { name: bv('#im-type').value, qty: days, price } });
            closeModal();
            await selectCustomer(editId);
          } catch (e) { bv('#im-err').textContent = e.message; }
        };
      });
    };
    $('#cust-extra').querySelectorAll('[data-ctdel]').forEach(btn => {
      btn.onclick = async () => {
        const reason = prompt('刪除訂房明細：請填寫刪除說明（必填，記入稽核）');
        if (reason == null) return;
        try {
          await api(`/customers/${editId}/contract/items/delete`, { method: 'POST',
            body: { index: Number(btn.dataset.ctdel), reason } });
          await selectCustomer(editId);
        } catch (e) { alert(e.message); }
      };
    });

    const CARD_MAP = {
      rcg: ['#ct-rcg-date', '#ct-rcg-no', 'room_card_given_date', 'room_card_no', 'room_card_given_by'],
      rcu: ['#ct-rcu-date', '#ct-rcu-no', 'room_card_used_date', 'room_card_used_no', 'room_card_used_by'],
      scg: ['#ct-scg-date', '#ct-scg-no', 'share_card_given_date', 'share_card_no', 'share_card_given_by'],
      scu: ['#ct-scu-date', '#ct-scu-no', 'share_card_used_date', 'share_card_used_no', 'share_card_used_by']
    };
    $('#cust-extra').querySelectorAll('[data-cardsave]').forEach(btn => {
      btn.onclick = () => {
        const [dSel, nSel, dKey, nKey, byKey] = CARD_MAP[btn.dataset.cardsave];
        cput({ [dKey]: gv(dSel), [nKey]: gv(nSel), [byKey]: currentUser.name }).catch(e => alert(e.message));
      };
    });
    $q('#ct-consult-save').onclick = () => cput({
      consult_date: gv('#ct-consult-date'), consult_note: gv('#ct-consult-note'), consult_by: currentUser.name
    }).catch(e => alert(e.message));
    // 商品禮券／現金折扣／贈品內容
    $q('#ct-voucher-save').onclick = () => cput({
      voucher_amount: gv('#ct-voucher'), voucher_by: currentUser.name
    }).catch(e => alert(e.message));
    $q('#ct-cashdisc-save').onclick = () => cput({
      cash_discount: gv('#ct-cashdisc'), cash_discount_by: currentUser.name
    }).catch(e => alert(e.message));
    $q('#ct-gift-save').onclick = () => cput({
      gift_content: gv('#ct-gift'), gift_by: currentUser.name
    }).catch(e => alert(e.message));
  }

  // ----- 寶寶報喜：入住通知單填寫視窗（儲存後轉入床表／住客／膳食／房況） -----
  function openBabyAnnounce(d, birth) {
    const m = d.mother, cd = (d.contract && d.contract.data) || {}, prof = d.profile || {};
    // 房號／入退住日：從排房紀錄（已預約優先）帶入
    const bk = d.bookings.find(b => b.status === 'reserved') || d.bookings.find(b => b.status === 'checked_in') || {};
    const nBabies = birth.baby_count === '三胞胎' ? 3 : birth.baby_count === '雙胞胎' ? 2 : 1;
    const stayDays = bk.check_in && bk.check_out ? Math.round((new Date(bk.check_out) - new Date(bk.check_in)) / 86400000) : '';
    const TABOOS = ['無', '牛肉', '羊肉', '內臟', '帶殼海鮮'];
    const babyRow = i => `
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
        <b style="min-width:56px">寶寶${nBabies > 1 ? i + 1 : ''}</b>
        <div class="field" style="margin:0;max-width:110px"><label>性別</label>
          <select data-ba-gender><option value="male">男</option><option value="female">女</option></select></div>
        <div class="field" style="margin:0;max-width:130px"><label>體重（g）</label><input type="number" min="0" data-ba-weight></div>
      </div>`;
    openModal(`寶寶報喜：${m.name}（入住通知單）`, `
      <div class="form-grid">
        <div class="field"><label>房號<small>（排房紀錄帶入）</small></label><input id="ba-room" value="${esc(bk.room_name || '')}" ${bk.room_name ? 'readonly' : 'placeholder="尚未排房"'}></div>
        <div class="field"><label>姓名</label><input value="${esc(m.name)}" readonly></div>
        <div class="field"><label>媽媽生日</label><input value="${esc(m.birth_date || '—')}" readonly></div>
        <div class="field"><label>後四碼<small>（身分證自動帶入）</small></label><input id="ba-id4" maxlength="4" value="${esc((m.id_no || '').slice(-4))}"></div>
        <div class="field"><label>入住日</label><input value="${esc(bk.check_in || '—')}" readonly></div>
        <div class="field"><label>出住日</label><input value="${esc(bk.check_out || '—')}" readonly></div>
        <div class="field"><label>總天數</label><input value="${stayDays ? stayDays + ' 天' : '—'}" readonly></div>
        <div class="field"><label>生產日期</label><input value="${esc(birth.birth_date)}" readonly></div>
        <div class="field"><label>生產方式</label><input value="${esc(birth.birth_mode)}" readonly></div>
        <div class="field"><label>生產醫院</label><input value="${esc(birth.birth_hospital)}" readonly></div>
        <div class="field"><label>胎次</label><input value="${esc(cd.parity_no || '—')}" readonly></div>
        <div class="field"><label>妊娠週數</label><input id="ba-weeks" maxlength="10" placeholder="例如：38+2"></div>
        <div class="field full" id="ba-babies">${Array.from({ length: nBabies }, (_, i) => babyRow(i)).join('')}</div>
        <div class="field"><label>餐別</label>
          <div class="row" style="gap:12px;padding-top:6px;flex-wrap:wrap">${mealChoices().map((c, i) =>
            `<label class="bna-chk"><input type="radio" name="ba-meal" value="${esc(c)}" ${i === 0 ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div></div>
        <div class="field"><label>哺乳衣尺寸</label>
          <select id="ba-bra">${['S', 'M', 'L', 'XL', 'XXL'].map(s => `<option ${s === 'M' ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>禁忌（膳食）</label>
          <div class="row" style="gap:12px;padding-top:6px">${['葷食', '全素', '蛋奶素'].map((t, i) =>
            `<label class="bna-chk"><input type="radio" name="ba-diet" value="${t}" ${i === 0 ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
        <div class="field"><label>禁忌食材</label>
          <div class="row" style="gap:10px;padding-top:6px;flex-wrap:wrap">${TABOOS.map(t =>
            `<label class="bna-chk"><input type="checkbox" data-ba-taboo value="${t}"> ${t}</label>`).join('')}
            <input id="ba-taboo-other" placeholder="其他" style="max-width:140px"></div></div>
        <div class="field full"><label>贈<small>（合約贈品內容帶入）</small></label><textarea id="ba-gift" rows="2" maxlength="300">${esc(cd.gift_content || '')}</textarea></div>
        <div class="field"><label>電話（媽咪）</label><input id="ba-phone-mom" value="${esc(m.phone || '')}"></div>
        <div class="field"><label>電話（把拔）</label><input id="ba-phone-dad" value="${esc(prof.contact_mobile || '')}"></div>
        <div class="field"><label>車號</label><input id="ba-car" maxlength="15"></div>
        <div class="field"><label>製單</label><input value="${esc(currentUser.name)}" readonly></div>
        <div class="field"><label>日期（儲存日期）</label><input value="${todayStr()}" readonly></div>
        <div class="full row"><button class="btn danger" id="ba-save">儲存</button><span class="error-msg" id="ba-err"></span></div>
      </div>`, body => {
      body.querySelector('#ba-save').onclick = async () => {
        const err = body.querySelector('#ba-err');
        err.textContent = '';
        const babies = [...body.querySelectorAll('#ba-babies .row')].map(r => ({
          gender: r.querySelector('[data-ba-gender]').value,
          weight_g: Number(r.querySelector('[data-ba-weight]').value) || 0
        }));
        if (babies.some(x => !x.weight_g)) { err.textContent = '請填寫每位寶寶體重'; return; }
        const taboos = [...body.querySelectorAll('[data-ba-taboo]:checked')].map(c => c.value);
        const other = body.querySelector('#ba-taboo-other').value.trim();
        if (other) taboos.push(other);
        const payload = {
          ...birth, weeks: body.querySelector('#ba-weeks').value.trim(), babies,
          meal_choice: (body.querySelector('input[name="ba-meal"]:checked') || {}).value || '',
          bra_size: body.querySelector('#ba-bra').value,
          diet_type: (body.querySelector('input[name="ba-diet"]:checked') || {}).value || '',
          taboos: taboos.join('、'), gift: body.querySelector('#ba-gift').value.trim(),
          phone_mom: body.querySelector('#ba-phone-mom').value.trim(),
          phone_dad: body.querySelector('#ba-phone-dad').value.trim(),
          car_no: body.querySelector('#ba-car').value.trim(),
          id4: body.querySelector('#ba-id4').value.trim(),
          room_name: body.querySelector('#ba-room').value.trim()
        };
        try {
          const r = await api(`/customers/${editId}/baby-announce`, { method: 'POST', body: payload });
          closeModal();
          openModal('寶寶報喜完成', `
            <p>已儲存入住通知單${r.created_babies ? `，並建立 ${r.created_babies} 筆寶寶資料` : ''}。資料已轉入下列模組：</p>
            <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
              ${canAccess('#/bed-planning') ? '<a class="btn small secondary" href="#/bed-planning" data-close-modal>實際入住床表</a>' : ''}
              ${canAccess('#/residents') ? '<a class="btn small secondary" href="#/residents" data-close-modal>住客管理</a>' : ''}
              ${canAccess('#/meals') ? '<a class="btn small secondary" href="#/meals" data-close-modal>膳食管理</a>' : ''}
              <a class="btn small secondary" href="#/mother-rooms" data-close-modal>媽媽房況</a>
              ${canAccess('#/baby-rooms') ? '<a class="btn small secondary" href="#/baby-rooms" data-close-modal>寶寶房況</a>' : ''}
              <button class="btn small" id="ba-print">列印入住通知單</button>
            </div>`, mBody => {
            mBody.querySelector('#ba-print').onclick = () => printBabyAnnounce(m, bk, birth, cd, payload, stayDays);
          });
          selectCustomer(editId);
        } catch (e) { err.textContent = e.message; }
      };
    });
  }

  // ----- 膳食資訊／消費及收款分頁 wiring -----
  async function wirePanels(d) {
    const $q = sel => $('#cust-extra').querySelector(sel);
    // 膳食：修改膳食總類（modal 下拉）
    const mlBtn = $q('#ml-diet');
    if (mlBtn) mlBtn.onclick = () => openModal('修改膳食總類', `
      <div class="field"><label>膳食總類</label><select id="ml-sel">${d.meals.diets.map(x =>
        `<option ${x === d.meals.diet ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="row mt"><button class="btn" id="ml-save">存檔</button><span class="error-msg" id="ml-err"></span></div>`, body => {
      body.querySelector('#ml-save').onclick = async () => {
        try {
          await api(`/mothers/${editId}/meal-diet`, { method: 'PUT', body: { meal_diet: body.querySelector('#ml-sel').value } });
          closeModal();
          selectCustomer(editId);
        } catch (e) { body.querySelector('#ml-err').textContent = e.message; }
      };
    });
    // 入住前收款新增（掛進行中／預約訂房；收款項目寫入款別）
    const payBtn = $q('#py-pay-add');
    if (payBtn) payBtn.onclick = async () => {
      const err = $q('#py-pay-err');
      err.textContent = '';
      const amount = Number($q('#py-pamount').value);
      if (!(amount > 0)) { err.textContent = '請填寫收款金額'; return; }
      const bk = d.bookings.find(b => b.status === 'checked_in') || d.bookings.find(b => b.status === 'reserved');
      if (!bk) { err.textContent = '無進行中／預約訂房，無法登錄收款'; return; }
      const note = $q('#py-pnote').value.trim();
      try {
        await api(`/bookings/${bk.id}/payments`, { method: 'POST', body: {
          amount, method: $q('#py-pmethod').value, paid_on: $q('#py-pdate').value || todayStr(), note,
          item: $q('#py-pitem').value, target: 'contract' // 入住前收款一律沖抵合約款
        } });
        selectCustomer(editId);
      } catch (e) { err.textContent = e.message; }
    };

    // 預約參觀：新增＋狀態切換
    const trAdd = $q('#tr-add');
    if (trAdd) trAdd.onclick = async () => {
      const err = $q('#tr-err');
      err.textContent = '';
      const date = $q('#tr-date').value, time = $q('#tr-time').value;
      if (!date || !time) { err.textContent = '請填寫參觀日期與時段'; return; }
      try {
        await api('/tours', { method: 'POST', body: {
          name: d.mother.name, phone: d.mother.phone || '', due_date: d.mother.due_date || '',
          tour_at: `${date} ${time}`, source: (d.profile || {}).source || '', note: $q('#tr-note').value.trim()
        } });
        selectCustomer(editId);
      } catch (e) { err.textContent = e.message; }
    };
    $('#cust-extra').querySelectorAll('[data-trst]').forEach(btn => {
      btn.onclick = async () => {
        const [id, status] = btn.dataset.trst.split('|');
        try { await api(`/tours/${id}`, { method: 'PUT', body: { status } }); selectCustomer(editId); }
        catch (e) { alert(e.message); }
      };
    });
    // 取消預約參觀：記錄取消時間／原因／取消人，列入取消預約明細表
    $('#cust-extra').querySelectorAll('[data-trcancel]').forEach(btn => {
      btn.onclick = async () => {
        const reason = prompt('取消這筆預約參觀？請填寫取消原因（必填）', '');
        if (reason === null) return;
        if (!reason.trim()) { alert('請填寫取消原因'); return; }
        try { await api(`/tours/${btn.dataset.trcancel}/cancel`, { method: 'POST', body: { reason } }); selectCustomer(editId); }
        catch (e) { alert(e.message); }
      };
    });
    // 排房：合約帶入預定房型／天數，選房號後依序接續建立訂房；可「增加房號」拆多段
    const bkRows = $q('#bk-rows');
    if (bkRows) {
      let roomList = [];
      try { roomList = (await api('/rooms')).filter(r => r.active); } catch (e) { roomList = []; }
      const roomOpt = r => `<option value="${r.id}">${esc(r.name)}（${esc(r.room_type)}｜$${(r.price_per_day || 0).toLocaleString()}/日）${r.occupant ? `｜在住至 ${esc(r.occupied_until || '')}` : ''}</option>`;
      const roomOpts = type => {
        const match = roomList.filter(r => r.room_type === type);
        const rest = roomList.filter(r => r.room_type !== type);
        return '<option value="">--請選擇--</option>'
          + (match.length ? `<optgroup label="同房型">${match.map(roomOpt).join('')}</optgroup>` : '')
          + (rest.length ? `<optgroup label="其他房型（升等／降等）">${rest.map(roomOpt).join('')}</optgroup>` : '');
      };
      bkRows.querySelectorAll('[data-bk-row]').forEach(tr => {
        tr.querySelector('[data-bk-room]').innerHTML = roomOpts(tr.dataset.type);
      });
      $q('#bk-addrow').onclick = () => {
        const types = [...new Set(d.contract.items.map(i => i.name))];
        const tr = document.createElement('tr');
        tr.setAttribute('data-bk-row', '');
        tr.dataset.type = types[0] || '';
        tr.innerHTML = `
          <td data-label="預定房型"><select data-bk-type>${types.map(t => `<option>${esc(t)}</option>`).join('')}</select></td>
          <td data-label="預定天數">—</td>
          <td data-label="房號"><select data-bk-room style="min-width:170px"></select></td>
          <td data-label="天數"><input type="number" min="1" data-bk-days style="max-width:90px"></td>
          <td><button class="btn small danger" data-bk-del title="移除">✕</button></td>`;
        bkRows.appendChild(tr);
        const typeSel = tr.querySelector('[data-bk-type]');
        const roomSel = tr.querySelector('[data-bk-room]');
        roomSel.innerHTML = roomOpts(tr.dataset.type);
        typeSel.onchange = () => { tr.dataset.type = typeSel.value; roomSel.innerHTML = roomOpts(typeSel.value); };
        tr.querySelector('[data-bk-del]').onclick = () => tr.remove();
      };
      $q('#bk-add').onclick = async () => {
        const err = $q('#bk-err');
        err.textContent = '';
        const start = $q('#bk-in').value;
        if (!start) { err.textContent = '請填寫入住日（可於合約資料設定預計入住日自動帶入）'; return; }
        const rows = [...bkRows.querySelectorAll('[data-bk-row]')].map(tr => ({
          type: tr.dataset.type,
          room_id: Number(tr.querySelector('[data-bk-room]').value) || 0,
          days: Number(tr.querySelector('[data-bk-days]').value) || 0
        }));
        const picked = rows.filter(r => r.room_id || r.days);
        if (!picked.length) { err.textContent = '請至少選擇一列的房號與天數'; return; }
        if (picked.some(r => !r.room_id)) { err.textContent = '請選擇每一列的房號'; return; }
        if (picked.some(r => !(r.days > 0))) { err.textContent = '請填寫每一列的天數'; return; }
        let cursor = start;
        let dep = Number($q('#bk-dep').value) || 0;
        try {
          for (const r of picked) {
            const end = new Date(new Date(cursor + 'T00:00:00Z').getTime() + r.days * 86400000).toISOString().slice(0, 10);
            const it = d.contract.items.find(i => i.name === r.type);
            const room = roomList.find(x => x.id === r.room_id);
            const price = it ? (it.price || 0) : ((room && room.price_per_day) || 0);
            await api('/bookings', { method: 'POST', body: {
              mother_id: editId, room_id: r.room_id, check_in: cursor, check_out: end,
              deposit: dep, total_amount: price * r.days
            } });
            dep = 0; // 訂金僅記於第一段
            cursor = end;
          }
          selectCustomer(editId);
        } catch (e) {
          err.textContent = e.message;
          selectCustomer(editId); // 部分成功時重載，讓已建立的段落顯示於排房紀錄
        }
      };
    }
    // 內嵌床表：預定床表（本客戶標示升等／降等／特殊需求）／實際入住床表
    const bcCard = $q('#bk-bedchart-card');
    if (bcCard) {
      let bcTab = 'planned';
      const drawChart = async () => {
        const startD = $q('#bc2-start').value || todayStr();
        let cal;
        try { cal = await api(`/room-calendar?start=${startD}&days=30`); }
        catch (e) { $q('#bc2-chart').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
        const days = [];
        for (let i = 0; i < cal.days; i++) days.push(new Date(new Date(cal.start).getTime() + i * 86400000).toISOString().slice(0, 10));
        const td = todayStr();
        const ctItems = (d.contract && d.contract.items) || [];
        const basePrice = ctItems.length ? Math.max(...ctItems.map(i => Number(i.price) || 0)) : 0;
        // 本客戶的訂房標示：升＝升等、降＝降等、特＝特殊需求（媽媽有房務需求）
        const markFor = bk => {
          if (bk.mother_id !== Number(editId)) return '';
          const marks = [];
          const room = cal.rooms.find(r => r.id === bk.room_id);
          if (room && basePrice && !ctItems.some(i => i.name === room.room_type)) {
            marks.push((room.price_per_day || 0) > basePrice ? '升' : '降');
          }
          if (((d.mother && d.mother.hk_needs) || '').trim()) marks.push('特');
          return marks.length ? `〔${marks.join('')}〕` : '';
        };
        const headCells = days.map(dd => {
          const wd = '日一二三四五六'[new Date(dd).getDay()];
          return `<th style="min-width:30px;padding:2px;font-weight:${dd === td ? '700' : '400'};${dd === td ? 'color:var(--primary-dark)' : ''}">${dd.slice(8)}<br><small>${wd}</small></th>`;
        }).join('');
        const rowsHtml = cal.rooms.map(r => {
          const cells = days.map(dd => {
            const bk = cal.bookings.find(b => b.room_id === r.id && b.check_in <= dd && b.check_out > dd);
            if (bk) {
              const isStart = bk.check_in === dd || dd === cal.start;
              if (bcTab === 'actual' && bk.status !== 'checked_in') {
                return `<td title="${esc(bk.mother_name)} 已預約未入住" style="background:repeating-linear-gradient(45deg,#fff,#fff 4px,#fdeec2 4px,#fdeec2 8px);padding:2px;font-size:10px;color:#b9911f;white-space:nowrap;overflow:hidden;max-width:0">${isStart ? '約' : ''}</td>`;
              }
              const mine = bk.mother_id === Number(editId);
              const color = bk.status === 'checked_in' ? '#cdeae4' : '#fdeec2';
              const mk = bcTab === 'planned' ? markFor(bk) : '';
              return `<td title="${esc(bk.mother_name)}（${esc(bk.check_in)}~${esc(bk.check_out)}・${STATUS_LABEL[bk.status]}）${mk}" style="background:${color};padding:2px;font-size:11px;white-space:nowrap;overflow:hidden;max-width:0;${mine ? 'outline:2px solid var(--primary-dark);outline-offset:-2px;' : ''}">${isStart ? esc(mk + bk.mother_name.slice(0, 4)) : ''}</td>`;
            }
            return '<td style="padding:2px;border:1px solid #eef2f1"></td>';
          }).join('');
          return `<tr><th style="text-align:left;white-space:nowrap;padding:2px 6px;position:sticky;left:0;background:#fff">${esc(r.name)}<br><small style="color:var(--muted)">${esc(r.room_type)}</small></th>${cells}</tr>`;
        }).join('');
        $q('#bc2-legend').innerHTML = bcTab === 'planned'
          ? '<span class="badge green">入住中</span> <span class="badge yellow">已預約</span>　〔升〕升等　〔降〕降等　〔特〕特殊需求　粗框＝本客戶'
          : '<span class="badge green">入住中</span> <span class="badge yellow">已預約</span>　斜線格＝已預約尚未入住';
        $q('#bc2-chart').innerHTML = `
          <div class="row between"><h3 style="margin:0;font-size:.95rem">${bcTab === 'planned' ? '預定床表' : '實際入住床表'}（${esc(cal.start)} 起 30 天）</h3></div>
          <div class="table-wrap" style="overflow-x:auto;margin-top:6px"><table style="border-collapse:collapse;font-size:12px">
            <thead><tr><th style="position:sticky;left:0;background:#eef5f4;padding:2px 6px">房號</th>${headCells}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table></div>`;
        $q('#bc2-tab-planned').className = `btn small ${bcTab === 'planned' ? '' : 'secondary'}`;
        $q('#bc2-tab-actual').className = `btn small ${bcTab === 'actual' ? '' : 'secondary'}`;
      };
      $q('#bc2-start').onchange = drawChart;
      $q('#bc2-tab-planned').onclick = () => { bcTab = 'planned'; drawChart(); };
      $q('#bc2-tab-actual').onclick = () => { bcTab = 'actual'; drawChart(); };
      drawChart();
    }
    const BKST_TW = { checked_in: '辦理入住', checked_out: '退房', cancelled: '取消訂房' };
    $('#cust-extra').querySelectorAll('[data-bkst]').forEach(btn => {
      btn.onclick = async () => {
        const [id, status] = btn.dataset.bkst.split('|');
        if (!confirm(`確定${BKST_TW[status] || status}？${status === 'checked_out' ? '（退房會同步住客狀態並推送滿意度問卷）' : ''}`)) return;
        const body = { status };
        if (status === 'checked_out') {
          const bk = d.bookings.find(b => b.id == id);
          if (bk && bk.check_out > todayStr()) {
            const reason = prompt('提前退房：請填寫提前退房原因（列入提前退房明細表）', '');
            if (reason == null) return;
            body.reason = reason;
          }
        }
        try { await api(`/bookings/${id}/status`, { method: 'PUT', body }); selectCustomer(editId); }
        catch (e) { alert(e.message); }
      };
    });
  }

  // 客戶互動紀錄（潛在客戶分頁內）
  function renderLogs(d) {
    if (!d) { $('#cust-logs').innerHTML = ''; return; }
    $('#cust-logs').innerHTML = `
    <div class="card">
      <div class="sec-hd">客戶互動紀錄（${d.logs.length} 筆）</div>
      <div class="form-grid no-print">
        <div class="field full"><label>客戶互動紀錄</label><textarea id="cl-body" maxlength="1000" rows="3" placeholder="請填入客戶互動紀錄"></textarea></div>
        <div class="full row" style="gap:10px"><button class="btn" id="cl-save">紀錄存檔</button><span class="error-msg" id="cl-err"></span></div>
      </div>
      ${d.logs.length ? `<div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>時間</th><th>內容</th><th>經手人</th><th class="no-print"></th></tr></thead>
        <tbody>${d.logs.map(l => `
          <tr><td data-label="時間"><small>${esc(l.created_at.slice(0, 16))}</small></td>
            <td data-label="內容">${esc(l.body)}</td>
            <td data-label="經手人">${esc(l.staff_name || '—')}</td>
            <td data-label="" class="no-print">${currentUser.role === 'admin' ? `<button class="btn small danger" data-ldel="${l.id}">刪</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
    </div>`;
    $('#cl-save').onclick = async () => {
      const err = $('#cl-err');
      err.textContent = '';
      try {
        await api(`/customers/${editId}/logs`, { method: 'POST', body: { body: $('#cl-body').value } });
        selectCustomer(editId);
      } catch (e) { err.textContent = e.message; }
    };
    $('#cust-logs').querySelectorAll('[data-ldel]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('確定刪除這筆互動紀錄？')) return;
        await api(`/customer-logs/${btn.dataset.ldel}`, { method: 'DELETE' });
        selectCustomer(editId);
      };
    });
  }

  function panelsHTML(d) {
    const m = d.mother;
    const cur = d.bookings.find(b => b.status === 'checked_in') || d.bookings.find(b => b.status === 'reserved') || null;
    const totals = d.bookings.reduce((s, b) => ({
      room: s.room + (b.total_amount || 0), addon: s.addon + (b.addon || 0), paid: s.paid + (b.paid || 0)
    }), { room: 0, addon: 0, paid: 0 });
    const due = totals.room + totals.addon - totals.paid;
    const stayDay = cur && cur.status === 'checked_in'
      ? Math.max(1, Math.round((new Date(todayStr()) - new Date(cur.check_in)) / 86400000) + 1) : null;
    const stayTotal = cur ? Math.round((new Date(cur.check_out) - new Date(cur.check_in)) / 86400000) : null;

    return `
    <div class="cpanel" data-tab="tours">
      <div class="card" style="background:var(--danger);color:#fff;padding:10px 16px">
        <span>預約參觀資料：<b>${esc(m.name)}</b>　｜　電話：${esc(m.phone || '—')}</span>
      </div>
      <div class="card no-print">
        <div class="sec-hd">新增預約參觀</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0"><label>參觀日期 <b class="req">*</b></label><input type="date" id="tr-date" value="${todayStr()}"></div>
          <div class="field" style="margin:0"><label>參觀時段 <b class="req">*</b></label><input type="time" id="tr-time" value="14:00"></div>
          <div class="field" style="margin:0;min-width:220px"><label>備註</label><input id="tr-note" maxlength="200"></div>
          <button class="btn danger" id="tr-add">轉入預約參觀</button>
          <a class="btn small secondary" href="#/tour-calendar">預約參觀行事曆</a>
          <span class="error-msg" id="tr-err"></span>
        </div>
        <small style="color:var(--muted)">姓名／電話／預產期自動帶入本客戶；來源帶入「媽媽資料來源」。</small>
      </div>
      <div class="card">
        <div class="sec-hd">參觀紀錄（${d.tours.length} 筆）</div>
        ${d.tours.length ? `<div class="table-wrap"><table class="data stack">
          <thead><tr><th>參觀時間</th><th>狀態</th><th>備註</th><th class="no-print">操作</th></tr></thead>
          <tbody>${d.tours.map(t => {
            const st = TOUR_STATUS_TW[t.status] || [t.status, 'gray'];
            return `<tr><td data-label="參觀時間">${esc(t.tour_at)}</td>
              <td data-label="狀態"><span class="badge ${st[1]}">${st[0]}</span></td>
              <td data-label="備註"><small>${esc(t.note || '—')}</small></td>
              <td data-label="操作" class="no-print">
                ${t.status === 'scheduled' ? `<button class="btn small" data-trst="${t.id}|visited">已參觀</button>
                  <button class="btn small secondary" data-trst="${t.id}|lost">未成交</button>
                  <button class="btn small danger" data-trcancel="${t.id}">取消</button>` : ''}
                ${t.status === 'visited' ? `<button class="btn small secondary" data-trst="${t.id}|lost">未成交</button>` : ''}
              </td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty">尚無參觀紀錄（新增參觀時以電話自動關聯本客戶）</div>'}
      </div>
    </div>
    <div class="cpanel" data-tab="rooms">
      <div class="card" style="background:var(--danger);color:#fff;padding:10px 16px">
        <span>排房資料：<b>${esc(m.name)}</b>${d.contract ? `　｜　合約編號：${esc(d.contract.contract_no)}` : ''}</span>
      </div>
      ${canAccess('#/rooms') ? (() => {
        const bct = d.contract, bcd = (bct && bct.data) || {};
        // 防呆：新增訂房只能從合約資料進去（需先有合約＋銷售房型明細）
        if (!bct || bct.status === 'cancelled' || !bct.items.length) {
          return `<div class="card no-print">
            <div class="sec-hd">新增訂房（排房）</div>
            <div class="empty">新增訂房請從「合約資料」進入：先儲存合約資料並新增銷售房型明細，本頁會自動帶入預定入住日、銷售房型與天數。</div>
          </div>`;
        }
        return `<div class="card no-print">
        <div class="sec-hd">新增訂房（排房）</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">
          <div class="field" style="margin:0"><label>入住日 <b class="req">*</b><small>（合約預計入住日帶入）</small></label>
            <input type="date" id="bk-in" value="${esc(bcd.expected_check_in || '')}"></div>
          <div class="field" style="margin:0;max-width:130px"><label>訂金<small>（10%合約總額）</small></label>
            <input type="number" min="0" id="bk-dep" value="${Math.round((bct.total || 0) * 0.1)}"></div>
        </div>
        <div class="table-wrap"><table class="data" id="bk-rows-table">
          <thead><tr><th>預定房型</th><th>預定天數</th><th>房號 <b class="req">*</b></th><th>天數 <b class="req">*</b></th><th></th></tr></thead>
          <tbody id="bk-rows">${bct.items.map(it => `
            <tr data-bk-row data-type="${esc(it.name)}">
              <td data-label="預定房型">${esc(it.name)}<br><small>$${(it.price || 0).toLocaleString()}/日</small></td>
              <td data-label="預定天數">${it.qty} 天</td>
              <td data-label="房號"><select data-bk-room style="min-width:170px"><option value="">載入中…</option></select></td>
              <td data-label="天數"><input type="number" min="1" data-bk-days value="${it.qty}" style="max-width:90px"></td>
              <td></td>
            </tr>`).join('')}</tbody>
        </table></div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px">
          <button class="btn small secondary" id="bk-addrow">增加房號</button>
          <button class="btn danger" id="bk-add">確定排房</button>
          <span class="error-msg" id="bk-err"></span>
        </div>
        <small style="color:var(--muted)">預定房型與天數由合約銷售房型明細自動帶入；多列時依序接續排房（前一列退房日＝下一列入住日）。金額依合約單價×天數計；期間衝突會被擋下。</small>
      </div>`;
      })() : ''}
      <div class="card" id="bk-bedchart-card">
        <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="max-width:170px;margin:0"><label>起始日</label>
            <input type="date" id="bc2-start" value="${esc((d.contract && d.contract.data && d.contract.data.expected_check_in) || todayStr())}"></div>
          <div class="row" style="gap:4px">
            <button class="btn small" id="bc2-tab-planned">預定床表</button>
            <button class="btn small secondary" id="bc2-tab-actual">實際入住床表</button>
          </div>
          <span style="font-size:.8rem;color:var(--muted)" id="bc2-legend"></span>
        </div>
        <div id="bc2-chart" style="margin-top:8px"><div class="empty">載入床表中…</div></div>
      </div>
      <div class="card">
        <div class="row between no-print" style="flex-wrap:wrap;gap:8px">
          <div class="sec-hd" style="flex:1;min-width:200px">排房紀錄（${d.bookings.length} 筆）</div>
          <div class="row" style="gap:6px">
            ${canAccess('#/rooms') ? '<a class="btn small secondary" href="#/rooms">訂房管理</a><a class="btn small secondary" href="#/room-timeline">房況時間軸</a>' : ''}
            ${canAccess('#/bed-planning') ? '<a class="btn small secondary" href="#/bed-planning">排床</a>' : ''}
          </div>
        </div>
        ${d.bookings.length ? `<div class="table-wrap"><table class="data stack">
          <thead><tr><th>房號</th><th>房型</th><th>入住</th><th>預退</th><th>天數</th><th>狀態</th><th class="no-print">操作</th></tr></thead>
          <tbody>${d.bookings.map(b => {
            const st = BK_ST[b.status] || [b.status, 'gray'];
            const days = Math.round((new Date(b.check_out) - new Date(b.check_in)) / 86400000);
            return `<tr>
              <td data-label="房號">${esc(b.room_name)}</td>
              <td data-label="房型">${esc(b.room_type)}</td>
              <td data-label="入住">${esc(b.check_in)}</td>
              <td data-label="預退">${esc(b.check_out)}</td>
              <td data-label="天數">${days} 天</td>
              <td data-label="狀態"><span class="badge ${st[1]}">${st[0]}</span></td>
              <td data-label="操作" class="no-print">${canAccess('#/rooms') ? `
                ${b.status === 'reserved' ? `<button class="btn small" data-bkst="${b.id}|checked_in">辦理入住</button>
                  <button class="btn small secondary" data-bkst="${b.id}|cancelled">取消</button>` : ''}
                ${b.status === 'checked_in' ? `<button class="btn small danger" data-bkst="${b.id}|checked_out">退房</button>` : ''}` : ''}
              </td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty">尚無排房資料</div>'}
      </div>
    </div>
    <div class="cpanel" data-tab="contracts">
      ${(() => {
        const ct = d.contract, cd = (ct && ct.data) || {};
        const p = d.profile || {};
        const lastTour = d.tours.length ? d.tours[0].tour_at.slice(0, 10) : '';
        const total = ct ? ct.total : 0;
        const parityOpts = ['第1胎', '第2胎', '第3胎', '第4胎以上'];
        const stamp = (dt, by) => dt ? `${esc(dt)}${by ? `（${esc(by)}）` : ''}` : '';
        return `
      <div class="card" style="background:var(--danger);color:#fff;padding:10px 16px">
        <div class="row" style="flex-wrap:wrap;gap:8px 24px;align-items:center">
          <span>媽媽合約資料：<b>${esc(m.name)}</b></span>
          <span>電話：${esc(m.phone || '—')}</span>
          <span>合約編號：<b>${ct ? esc(ct.contract_no) : '（存檔後自動編號）'}</b>${ct && ct.status === 'cancelled' ? `　<span class="badge gray">已退訂 ${esc(cd.cancel_date || '')}（${esc(cd.cancel_reason || '')}）</span>` : ''}</span>
        </div>
      </div>
      <div class="card">
        <div class="sec-hd">${ct ? '修改' : '新增'}合約資料</div>
        <div class="form-grid">
          <div class="field"><label>媽媽姓名</label><input value="${esc(m.name)}" readonly></div>
          <div class="field"><label>合約編號</label><input value="${ct ? esc(ct.contract_no) : ''}" readonly placeholder="存檔後自動編號"></div>
          <div class="field"><label>經手人</label><input id="ct-handler" maxlength="50" value="${esc(cd.handler || '')}"></div>
          <div class="field"><label>合約總額</label><input value="$${total.toLocaleString()}" readonly></div>
          <div class="field"><label>簽約日期 <b class="req">*</b></label><input type="date" id="ct-sign" value="${esc(cd.sign_date || todayStr())}"></div>
          <div class="field"><label>預產期 <b class="req">*</b></label><input type="date" id="ct-due" value="${esc(m.due_date || '')}"></div>
          <div class="field"><label>預計入住日</label><input type="date" id="ct-expin" data-days="${ct ? ct.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0}" value="${esc(cd.expected_check_in || '')}"></div>
          <div class="field"><label>預計出住日<small>（依訂房天數自動帶入，可改）</small></label><input type="date" id="ct-expout" value="${esc(cd.expected_check_out || '')}"></div>
          <div class="field"><label>生產胎次</label><select id="ct-parity"><option value="">--請選擇--</option>${parityOpts.map(o => `<option ${cd.parity_no === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          <div class="field"><label>寶寶人數</label>
            <div class="row" style="gap:14px;padding-top:8px">${['單胞胎', '雙胞胎', '三胞胎'].map(o =>
              `<label class="bna-chk"><input type="radio" name="ctr-babies" value="${o}" ${(cd.baby_count || '單胞胎') === o ? 'checked' : ''}> ${o}</label>`).join('')}</div></div>
          <div class="field"><label>預計生產方式</label><select id="ct-delmode"><option value="">--請選擇--</option>${deliveryTypes().map(o => `<option ${m.delivery_type === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
          <div class="field"><label>產檢醫院</label><input id="ct-ckhosp" maxlength="100" value="${esc(cd.checkup_hospital || p.hospital || '')}"></div>
          <div class="field"><label>產檢醫生</label><input id="ct-ckdoc" maxlength="50" value="${esc(cd.checkup_doctor || '')}"></div>
          <div class="field"><label>實際生產醫院</label><input id="ct-bhosp" maxlength="100" value="${esc(cd.birth_hospital || '')}"></div>
          <div class="field"><label>實際生產日期</label><input type="date" id="ct-bdate" value="${esc(cd.birth_date || '')}"></div>
          <div class="field"><label>實際生產方式</label><select id="ct-bmode"><option value="">--請選擇--</option>${deliveryTypes().map(o => `<option ${cd.birth_mode === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
          <div class="field"><label>媽媽手機</label><input value="${esc(m.phone || '')}" readonly></div>
          <div class="field"><label>聯絡電話（市話）</label><input value="${esc(p.tel || '')}" readonly></div>
          <div class="field"><label>E-MAIL</label><input value="${esc(p.email || '')}" readonly></div>
          <div class="field"><label>小管家</label><input id="ct-butler" maxlength="50" value="${esc(cd.butler || '')}"></div>
          <div class="field full"><label style="color:var(--danger)">媽媽飲食禁忌</label><textarea id="ct-dietban" maxlength="500" rows="3" placeholder="請填入媽媽飲食禁忌">${esc(cd.diet_ban !== undefined ? cd.diet_ban : (m.diet_notes || ''))}</textarea></div>
          <div class="field full"><label>合約備註</label><textarea id="ct-note" maxlength="600" rows="3" placeholder="請填入合約備註">${esc(cd.note || '')}</textarea></div>
          <div class="field full"><label>潛在客戶備註</label><div style="padding:6px 0;color:#555">${esc(p.note || '—')}</div></div>
          <div class="field full"><label>預約參觀備註</label><div style="padding:6px 0;color:#555">${lastTour ? `最後參觀日期：${esc(lastTour)}` : '—'}</div></div>
          <div class="field"><label>住房狀態</label><input value="${CUST_STATUS[m.status] ? CUST_STATUS[m.status][0] : m.status}" readonly></div>
          <div class="field"><label>入住日期</label><input value="${esc((d.bookings.find(b => b.status === 'checked_in') || d.bookings.find(b => b.status === 'reserved') || {}).check_in || '')}" readonly></div>
          <div class="full row" style="gap:10px;flex-wrap:wrap">
            <button class="btn danger" id="ct-save">${ct ? '資料修改' : '資料存檔（產生合約編號）'}</button>
            ${ct ? '<button class="btn" id="ct-announce" title="實際生產醫院／日期／方式皆填寫後才可按下">寶寶報喜</button>' : ''}
            ${ct && ct.status !== 'cancelled' ? '<button class="btn secondary" id="ct-cancel">合約退訂</button>' : ''}
            ${ct && ct.status === 'cancelled' && currentUser.role === 'admin' ? '<button class="btn secondary" id="ct-restore">取消退訂（恢復有效）</button>' : ''}
            <span class="error-msg" id="ct-err"></span>
          </div>
          <div class="full row no-print" style="gap:8px;flex-wrap:wrap;align-items:center">
            <b>其它資料：</b>
            <a class="btn small" href="#/booking-blank">列印訂房確認單</a>
            ${canAccess('#/contracts') ? '<a class="btn small" href="#/contracts">電子合約簽署</a>' : ''}
            ${canAccess('#/billing') ? '<a class="btn small" href="#/billing">繳費／帳務</a>' : ''}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="sec-hd">定型化契約簽回</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0"><label>定型化契約簽回日</label><input type="date" id="ct-fcdate" value="${esc(cd.fc_return_date || '')}"></div>
          <div class="field" style="margin:0"><label>契約編號</label><input id="ct-fcno" maxlength="30" value="${esc(cd.fc_no || '')}"></div>
          <div class="field" style="margin:0"><label>存檔人</label><input value="${esc(cd.fc_by || '')}" readonly style="max-width:120px"></div>
          <button class="btn danger" id="ct-fcsave">定型化契約簽回日存檔</button>
        </div>
      </div>
      <div class="card">
        <div class="sec-hd">合約資料明細（銷售房型）</div>
        <div class="row no-print" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0"><label>銷售房型</label>
            <select id="ct-item-type">${d.room_types.map(r => `<option value="${esc(r.name)}" data-price="${r.price || 0}">${esc(r.name)}（$${(r.price || 0).toLocaleString()}/日）</option>`).join('')}</select></div>
          <div class="field" style="margin:0;max-width:120px"><label>訂房天數</label><input type="number" min="1" id="ct-item-days"></div>
          <button class="btn danger" id="ct-item-add">確定新增</button>
          <button class="btn" id="ct-item-modal" style="background:#2fb6e8">增加房型（可改金額）</button>
          <span class="error-msg" id="ct-item-err"></span>
        </div>
        <div class="table-wrap" style="margin-top:8px">
          <table class="data stack">
            <thead><tr><th>項次</th><th>銷售品名</th><th>數量</th><th>單價</th><th>小計</th><th>建檔人</th><th class="no-print"></th></tr></thead>
            <tbody>${ct && ct.items.length ? ct.items.map((it, i) => `
              <tr><td data-label="項次">${i + 1}</td>
                <td data-label="銷售品名">${esc(it.name)}</td>
                <td data-label="數量">${it.qty}</td>
                <td data-label="單價">$${(it.price || 0).toLocaleString()}</td>
                <td data-label="小計">$${((it.qty || 0) * (it.price || 0)).toLocaleString()}</td>
                <td data-label="建檔人">${esc(it.by || '—')}<br><small>${esc(it.at || '')}</small></td>
                <td data-label="" class="no-print"><button class="btn small danger" data-ctdel="${i}">刪</button></td></tr>`).join('')
              : '<tr><td colspan="7"><div class="empty">尚無明細</div></td></tr>'}
              <tr><td colspan="7" style="text-align:right"><b>合計金額：$${total.toLocaleString()}</b></td></tr>
            </tbody>
          </table>
        </div>
        <small style="color:var(--muted)">刪除明細需填寫刪除說明（記入稽核軌跡）。</small>
      </div>
      <div class="card">
        <div class="sec-hd">住房卡贈送</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0"><label>贈送日期</label><input type="date" id="ct-rcg-date" value="${esc(cd.room_card_given_date || '')}"></div>
          <div class="field" style="margin:0"><label>住房卡號</label><input id="ct-rcg-no" maxlength="30" value="${esc(cd.room_card_no || '')}"></div>
          <div class="field" style="margin:0"><label>存檔人</label><input value="${esc(cd.room_card_given_by || '')}" readonly style="max-width:120px"></div>
          <button class="btn danger" data-cardsave="rcg">贈送存檔</button>
        </div>
      </div>
      <div class="card">
        <div class="sec-hd">住房卡抵用</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0"><label>使用日期</label><input type="date" id="ct-rcu-date" value="${esc(cd.room_card_used_date || '')}"></div>
          <div class="field" style="margin:0"><label>住房卡號</label><input id="ct-rcu-no" maxlength="30" value="${esc(cd.room_card_used_no || '')}"></div>
          <div class="field" style="margin:0"><label>存檔人</label><input value="${esc(cd.room_card_used_by || '')}" readonly style="max-width:120px"></div>
          <button class="btn danger" data-cardsave="rcu">抵用存檔</button>
        </div>
      </div>
      <div class="card">
        <div class="sec-hd">分享卡贈送</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0"><label>贈送日期</label><input type="date" id="ct-scg-date" value="${esc(cd.share_card_given_date || '')}"></div>
          <div class="field" style="margin:0"><label>分享卡號</label><input id="ct-scg-no" maxlength="30" value="${esc(cd.share_card_no || '')}"></div>
          <div class="field" style="margin:0"><label>存檔人</label><input value="${esc(cd.share_card_given_by || '')}" readonly style="max-width:120px"></div>
          <button class="btn danger" data-cardsave="scg">贈送存檔</button>
        </div>
      </div>
      <div class="card">
        <div class="sec-hd">分享卡抵用</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0"><label>使用日期</label><input type="date" id="ct-scu-date" value="${esc(cd.share_card_used_date || '')}"></div>
          <div class="field" style="margin:0"><label>分享卡號</label><input id="ct-scu-no" maxlength="30" value="${esc(cd.share_card_used_no || '')}"></div>
          <div class="field" style="margin:0"><label>存檔人</label><input value="${esc(cd.share_card_used_by || '')}" readonly style="max-width:120px"></div>
          <button class="btn danger" data-cardsave="scu">抵用存檔</button>
        </div>
      </div>
      <div class="card">
        <div class="sec-hd">產前諮詢</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0"><label>諮詢日期</label><input type="date" id="ct-consult-date" value="${esc(cd.consult_date || '')}"></div>
          <div class="field" style="margin:0"><label>存檔人</label><input value="${esc(cd.consult_by || '')}" readonly style="max-width:120px"></div>
          <button class="btn danger" id="ct-consult-save">諮詢存檔</button>
        </div>
        <div class="field full" style="margin-top:8px"><label>諮詢備註</label><textarea id="ct-consult-note" maxlength="600" rows="3" placeholder="請填入諮詢備註">${esc(cd.consult_note || '')}</textarea></div>
      </div>
      <div class="card">
        <div class="sec-hd">商品禮券</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0;max-width:150px"><label>金額</label><input type="number" min="0" id="ct-voucher" value="${esc(cd.voucher_amount || '')}"></div>
          <div class="field" style="margin:0"><label>存檔人</label><input value="${esc(cd.voucher_by || '')}" readonly style="max-width:120px"></div>
          <button class="btn danger" id="ct-voucher-save">禮券存檔</button>
        </div>
        <small style="color:var(--muted)">只能折抵商城商品，出住日後歸零。</small>
      </div>
      <div class="card">
        <div class="sec-hd">現金折扣</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0;max-width:150px"><label>金額</label><input type="number" min="0" id="ct-cashdisc" value="${esc(cd.cash_discount || '')}"></div>
          <div class="field" style="margin:0"><label>存檔人</label><input value="${esc(cd.cash_discount_by || '')}" readonly style="max-width:120px"></div>
          <button class="btn danger" id="ct-cashdisc-save">折扣存檔</button>
        </div>
        <small style="color:var(--muted)">訂金仍為合約總額 10%（不扣折扣）。</small>
      </div>
      <div class="card">
        <div class="sec-hd">贈品內容</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0;flex:1;min-width:220px"><label>內容</label><input id="ct-gift" maxlength="300" value="${esc(cd.gift_content || '')}" placeholder="請填入贈品內容"></div>
          <div class="field" style="margin:0"><label>存檔人</label><input value="${esc(cd.gift_by || '')}" readonly style="max-width:120px"></div>
          <button class="btn danger" id="ct-gift-save">贈品存檔</button>
        </div>
      </div>
      <div class="card">
        <div class="row between no-print" style="flex-wrap:wrap;gap:8px">
          <div class="sec-hd" style="flex:1;min-width:200px">電子簽署合約（${d.contracts.length} 筆）</div>
          <a class="btn small" href="#/contracts">轉入簽約資料</a>
        </div>
        ${d.contracts.length ? `<div class="table-wrap"><table class="data stack">
          <thead><tr><th>筆數</th><th>簽約日期</th><th>編號</th><th>合約名稱</th><th>狀態</th><th>住房期間</th><th>房型及金額</th></tr></thead>
          <tbody>${d.contracts.map((c, i) => {
            const st = CT_ST[c.status] || [c.status, 'gray'];
            return `<tr>
              <td data-label="筆數">${i + 1}</td>
              <td data-label="簽約日期">${esc((c.signed_at || c.created_at || '').slice(0, 10))}</td>
              <td data-label="編號">#${c.id}</td>
              <td data-label="合約名稱"><small>${esc(c.title)}</small></td>
              <td data-label="狀態"><span class="badge ${st[1]}">${st[0]}</span></td>
              <td data-label="住房期間"><small>${esc(c.check_in)} ~ ${esc(c.check_out)}</small></td>
              <td data-label="房型及金額">${esc(c.room_name || '—')}　合計：$${(c.total_amount || 0).toLocaleString()}</td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty">尚無電子簽署紀錄</div>'}
      </div>`;
      })()}
    </div>
    <div class="cpanel" data-tab="meals">
      <div class="card" style="background:var(--danger);color:#fff;padding:10px 16px">
        <span>排餐及膳食資料：<b>${esc(m.name)}</b></span>
      </div>
      <div class="card">
        <div class="sec-hd">排餐與膳食資料</div>
        <div class="table-wrap">
          <table class="data stack">
            <thead><tr><th>合約編號</th><th>預產期</th><th>膳食總類</th><th>飲食備註／禁忌</th><th class="no-print">排餐</th></tr></thead>
            <tbody><tr>
              <td data-label="合約編號">${d.contract ? esc(d.contract.contract_no) : '—'}</td>
              <td data-label="預產期">${m.due_date ? `（預產）${esc(m.due_date)}` : '—'}${m.delivery_date ? `<br><span style="color:var(--danger)">（生產）${esc(m.delivery_date)}</span>` : ''}</td>
              <td data-label="膳食總類"><b>${esc(d.meals.diet || '（未設定）')}</b></td>
              <td data-label="飲食備註／禁忌"><small>${esc(d.meals.diet_notes || '—')}</small></td>
              <td data-label="排餐" class="no-print">
                ${canAccess('#/meal-plan') ? '<button class="btn small danger" id="ml-diet">修改膳食總類</button>' : '<small style="color:var(--muted)">需膳食權限</small>'}
              </td>
            </tr></tbody>
          </table>
        </div>
        <div class="sec-hd" style="margin-top:10px">未來 7 天供餐預覽（依產後階段與膳食總類自動挑菜單）</div>
        <div class="table-wrap">
          <table class="data stack">
            <thead><tr><th>日期</th>${d.meals.slots.map(s => `<th>${esc(s)}</th>`).join('')}</tr></thead>
            <tbody>${d.meals.week.map(w => `
              <tr><td data-label="日期">${esc(w.date.slice(5))}${w.day ? `<br><small>第${w.day}天${w.stage ? `・${esc(w.stage)}` : ''}</small>` : ''}</td>
                ${d.meals.slots.map(s => `<td data-label="${esc(s)}"><small>${esc(w.slots[s] || '—')}</small></td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="row no-print" style="gap:6px;margin-top:8px">
          ${canAccess('#/meals') ? '<a class="btn small" href="#/meals">膳食管理</a>' : ''}
          ${canAccess('#/meal-plan') ? '<a class="btn small secondary" href="#/meal-plan">月子餐（菜單管理）</a>' : ''}
          <a class="btn small secondary" href="#/mother-handover?m=${m.id}">修改飲食禁忌（產婦交班單）</a>
        </div>
      </div>
    </div>
    <div class="cpanel" data-tab="pay">
      <div class="card" style="background:var(--danger);color:#fff;padding:10px 16px">
        <div class="row" style="flex-wrap:wrap;gap:8px 24px">
          <span>入住前收款紀錄：<b>${esc(m.name)}</b></span>
          <span>電話：${esc(m.phone || '—')}</span>
          <span>合約編號：${d.contract ? esc(d.contract.contract_no) : '—'}</span>
        </div>
      </div>
      ${(() => {
        const curBk = d.bookings.find(b => b.status === 'checked_in') || d.bookings.find(b => b.status === 'reserved') || null;
        const contractTotal = d.contract ? d.contract.total : 0;
        // 只計合約款（排除加購款如商城零售），與收費帳務分款一致
        const contractPays = d.payments.filter(p => p.target !== 'addon');
        const paidSum = contractPays.reduce((s, p) => s + (p.amount || 0), 0);
        return `
      <div class="card">
        <div class="sec-hd">收款紀錄（新增）</div>
        <div class="form-grid">
          <div class="field"><label>收款日期</label><input type="date" id="py-pdate" value="${todayStr()}"></div>
          <div class="field"><label>收款項目</label><select id="py-pitem">${['訂金', '其他'].map(o => `<option>${o}</option>`).join('')}</select></div>
          <div class="field"><label>收款方式</label><select id="py-pmethod">${paymentMethods().map(o => `<option>${esc(o)}</option>`).join('')}</select></div>
          <div class="field"><label>收款金額 <b class="req">*</b></label><input type="number" min="1" id="py-pamount"></div>
          <div class="field full"><label>收款備註</label><input id="py-pnote" maxlength="200"></div>
          <div class="full row" style="gap:10px">
            <button class="btn danger" id="py-pay-add">資料新增</button>
            <span class="error-msg" id="py-pay-err"></span>
            ${!curBk ? '<small style="color:var(--danger)">此客戶無進行中／預約訂房，收款將無法登錄（請先完成排房）。</small>' : ''}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="sec-hd">合約金額（扣除入住前繳款）</div>
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>日期</th><th>摘要</th><th>金額</th><th>建檔人</th></tr></thead>
          <tbody>
            <tr><td data-label="日期">${d.contract && d.contract.data.sign_date ? esc(d.contract.data.sign_date) : '—'}</td>
              <td data-label="摘要">合約金額</td>
              <td data-label="金額">$${contractTotal.toLocaleString()}</td>
              <td data-label="建檔人">${d.contract && d.contract.data.handler ? esc(d.contract.data.handler) : '—'}</td></tr>
            ${contractPays.map(p => `
            <tr><td data-label="日期">${esc(p.paid_on)}</td>
              <td data-label="摘要">入住前繳款${p.item ? `（${esc(p.item)}）` : ''}｜${esc(p.method || '—')}${p.note ? `<br><small>${esc(p.note)}</small>` : ''}</td>
              <td data-label="金額" style="color:var(--primary-dark)">−$${(p.amount || 0).toLocaleString()}</td>
              <td data-label="建檔人">${esc(p.received_name || '—')}</td></tr>`).join('')}
            <tr><td colspan="4" style="text-align:right">已繳合計：$${paidSum.toLocaleString()}
              合約餘額：<b style="color:${contractTotal - paidSum > 0 ? 'var(--danger)' : 'var(--primary-dark)'}">$${(contractTotal - paidSum).toLocaleString()}</b></td></tr>
          </tbody>
        </table></div>
        <small style="color:var(--muted)">合約餘額自動帶入入住管理／收費帳務（此處繳款均已同步至該訂房的繳費紀錄）。</small>
      </div>`;
      })()}
    </div>`;
  }

  // ----- 待確認預約（用戶自 LINE 官賴送出，員工確認後自動推播「已安排」訊息） -----
  async function loadPending() {
    const box = $('#cq-pending');
    if (!box) return;
    let rows = [];
    try { rows = await api('/tours?pending=1'); } catch (e) { return; }
    if (!rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div class="card" style="border:2px solid var(--danger)">
        <div class="sec-hd" style="background:var(--danger)">待確認預約（LINE）<span class="badge yellow" style="margin-left:8px">${rows.length} 筆</span></div>
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>送單時間</th><th>媽咪姓名</th><th>連絡電話</th><th>預產期</th><th>胎次</th><th>預約參觀時段</th><th>操作</th></tr></thead>
          <tbody>${rows.map(t => `
            <tr>
              <td data-label="送單時間">${esc((t.created_at || '').slice(0, 16))}</td>
              <td data-label="媽咪姓名">${t.mother_id ? `<a href="#/customers?m=${t.mother_id}" title="開啟客戶資料">${esc(t.name)}</a>` : esc(t.name)}</td>
              <td data-label="連絡電話">${esc(t.phone || '—')}</td>
              <td data-label="預產期">${esc(t.due_date || '—')}</td>
              <td data-label="胎次">${t.parity ? `第${esc(t.parity)}胎` : '—'}</td>
              <td data-label="預約參觀時段"><b>${esc(t.tour_at)}</b></td>
              <td data-label="操作">
                <button class="btn small" data-pd-ok="${t.id}">確認</button>
                <button class="btn small secondary danger" data-pd-no="${t.id}">取消</button>
              </td>
            </tr>`).join('')}</tbody>
        </table></div>
        <small style="color:var(--muted)">點「確認」後系統自動發送「預約已確認」LINE 訊息給客戶；點「取消」需填原因（不另行通知）。</small>
      </div>`;
    box.querySelectorAll('[data-pd-ok]').forEach(b => b.onclick = async () => {
      const t = rows.find(x => String(x.id) === b.dataset.pdOk);
      if (!confirm(`確認 ${t.name} 於 ${t.tour_at} 的參觀預約？\n系統將自動發送確認訊息給客戶。`)) return;
      try {
        const r = await api(`/tours/${t.id}/confirm`, { method: 'POST', body: {} });
        alert(r.notified ? '已確認，並已發送 LINE 通知給客戶。' : '已確認（未發送 LINE 通知：客戶未綁定或 LINE 未設定）。');
      } catch (e) { alert(e.message); }
      loadPending();
    });
    box.querySelectorAll('[data-pd-no]').forEach(b => b.onclick = async () => {
      const reason = prompt('請輸入取消原因：');
      if (reason === null) return;
      if (!reason.trim()) { alert('請填寫取消原因'); return; }
      try { await api(`/tours/${b.dataset.pdNo}/cancel`, { method: 'POST', body: { reason: reason.trim() } }); }
      catch (e) { alert(e.message); }
      loadPending();
    });
  }
  loadPending();

  // ----- 查詢 -----
  const doSearch = async () => {
    const err = $('#cq-err');
    err.textContent = '';
    const qs = new URLSearchParams();
    if (v('#cq-name')) qs.set('name', v('#cq-name'));
    if (v('#cq-phone')) qs.set('phone', v('#cq-phone'));
    if (v('#cq-due')) qs.set('due_date', v('#cq-due'));
    if (v('#cq-contract')) qs.set('contract_no', v('#cq-contract'));
    if (![...qs.keys()].length) { err.textContent = '請至少輸入一個查詢條件'; return; }
    try {
      const { rows } = await api(`/customers?${qs}`);
      $('#cq-result').innerHTML = rows.length ? `
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>筆數</th><th>姓名</th><th>聯絡電話</th><th>身分證號</th><th>預產期</th><th>合約編號</th><th>狀態</th></tr></thead>
          <tbody>${rows.map((r, i) => {
            const st = CUST_STATUS[r.status] || [r.status, 'gray'];
            return `<tr>
              <td data-label="筆數"><button class="btn small" data-sel="${r.id}">${i + 1}</button></td>
              <td data-label="姓名"><a href="javascript:void 0" data-sel="${r.id}">${esc(r.name)}</a></td>
              <td data-label="聯絡電話">${esc(r.phone || '—')}</td>
              <td data-label="身分證號">${esc(r.id_no || '—')}</td>
              <td data-label="預產期">${esc(r.due_date || '—')}</td>
              <td data-label="合約編號">${r.contract_no ? esc(r.contract_no) : (r.contract_id ? `#${r.contract_id}` : '—')}</td>
              <td data-label="狀態"><span class="badge ${st[1]}">${st[0]}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>` : '<div class="empty">您輸入的條件，查無資料 …</div>';
      $('#cq-result').querySelectorAll('[data-sel]').forEach(el => el.onclick = () => selectCustomer(Number(el.dataset.sel)));
    } catch (e) { err.textContent = e.message; }
  };
  $('#cq-go').onclick = doSearch;
  ['#cq-name', '#cq-phone', '#cq-contract'].forEach(id => { $(id).onkeydown = e => { if (e.key === 'Enter') doSearch(); }; });
  $('#cq-clear').onclick = () => { location.hash = '#/customers'; viewCustomers(); };

  // 初始：深連結 ?m= 直接選取，否則新增模式
  if (deepId) await selectCustomer(deepId);
  else resetNew();
}

/* ---------- 預約參觀行事曆 ---------- */
const TOUR_STATUS_TW = { scheduled: ['已預約', 'teal'], visited: ['已參觀', 'green'], signed: ['已簽約', 'pink'], lost: ['流失', 'gray'] };
async function viewTourCalendar() {
  const qm = (location.hash.split('?m=')[1] || '').split('&')[0];
  const month = /^\d{4}-\d{2}$/.test(qm) ? qm : todayStr().slice(0, 7);
  const { rows } = await api(`/tour-calendar?month=${month}`);
  const byDay = {};
  for (const t of rows) (byDay[t.tour_at.slice(0, 10)] = byDay[t.tour_at.slice(0, 10)] || []).push(t);
  const [y, mo] = month.split('-').map(Number);
  const first = new Date(y, mo - 1, 1), startDow = first.getDay(), daysIn = new Date(y, mo, 0).getDate();
  const shiftMonth = d => {
    const nd = new Date(y, mo - 1 + d, 1);
    location.hash = `#/tour-calendar?m=${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`;
  };
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<td class="tc-out"></td>';
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    const items = (byDay[ds] || []).map(t => {
      const st = (t.confirm_status === 'pending' && t.status === 'scheduled')
        ? ['待確認', 'yellow'] : TOUR_STATUS_TW[t.status] || [t.status, 'gray'];
      return `<div class="tc-item"><small>${esc(t.tour_at.slice(11, 16))}</small> ${esc(t.name)} <span class="badge ${st[1]}" style="font-weight:400">${st[0]}</span></div>`;
    }).join('');
    cells += `<td class="${ds === todayStr() ? 'tc-today' : ''}"><div class="tc-day">${d}日</div>${items}</td>`;
    if ((startDow + d) % 7 === 0 && d !== daysIn) cells += '</tr><tr>';
  }
  const rest = (startDow + daysIn) % 7;
  if (rest) for (let i = rest; i < 7; i++) cells += '<td class="tc-out"></td>';
  main().innerHTML = `
    <div class="page-title">預約參觀－行事曆</div>
    <div class="card no-print">
      <div class="row between" style="flex-wrap:wrap;gap:8px">
        <h3>${y}年${mo}月</h3>
        <div class="row" style="gap:6px">
          <a class="btn small secondary" href="#/customers">回客戶管理</a>
          <a class="btn small secondary" href="#/tours">參觀預約列表</a>
          <button class="btn small secondary" id="tc-cur">本月</button>
          <button class="btn small" id="tc-prev">上個月</button>
          <button class="btn small" id="tc-next">下個月</button>
          <button class="btn small secondary" id="tc-print">列印</button>
        </div>
      </div>
      <small style="color:var(--muted)">本月參觀 ${rows.length} 筆；點「參觀預約列表」可新增／修改。</small>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="data tc-cal">
          <thead><tr><th>週日</th><th>週一</th><th>週二</th><th>週三</th><th>週四</th><th>週五</th><th>週六</th></tr></thead>
          <tbody><tr>${cells}</tr></tbody>
        </table>
      </div>
    </div>`;
  $('#tc-prev').onclick = () => shiftMonth(-1);
  $('#tc-next').onclick = () => shiftMonth(1);
  $('#tc-cur').onclick = () => { location.hash = '#/tour-calendar'; route(); };
  $('#tc-print').onclick = () => window.print();
}

/* ---------- 空白預約參觀單（參訪紀錄表；列印手寫用） ---------- */
function viewTourVisitBlank() {
  const bl = w => `<span class="bf-line" style="min-width:${w}px"></span>`;
  main().innerHTML = `
    <div class="card no-print">
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <a class="btn small secondary" href="#/customers">回客戶管理</a>
        <button class="btn small" id="tvb-print">開始列印</button>
      </div>
    </div>
    <div class="bf-sheet">
      <div style="text-align:center;font-weight:700;font-size:1.05rem">${esc(SETTINGS.center_name || '')}</div>
      <div class="row between" style="margin:4px 0 6px">
        <b style="font-size:1.02rem">參訪紀錄表</b><span>合約編號：${bl(120)}</span>
      </div>
      <table class="data tvb">
        <tr><td colspan="4" style="text-align:right">參訪日期：${bl(110)}　參訪時段：${bl(90)}</td></tr>
        <tr><th style="width:110px">媽媽姓名</th><td style="width:170px"></td><th style="width:60px">電話</th>
          <td>(家裡)${bl(90)}　(手機)${bl(100)}<br>(公司)${bl(90)}　ext.${bl(50)}</td></tr>
        <tr><th>爸爸姓名</th><td></td><th>電話</th>
          <td>(家裡)${bl(90)}　(手機)${bl(100)}<br>(公司)${bl(90)}　ext.${bl(50)}</td></tr>
        <tr><th>產檢醫院/醫師</th><td>${bl(70)}／${bl(70)}</td><th>預產期</th><td>${bl(100)}　胎次：${bl(50)}</td></tr>
        <tr><th>媽媽出生年月日</th><td></td><th>寶寶性別</th><td>□女　□男　□雙</td></tr>
        <tr><th>地址</th><td></td><th>生產方式</th><td>□自然產　□剖腹產</td></tr>
        <tr><th>學歷</th><td>媽媽：${bl(80)}<br>爸爸：${bl(80)}</td><th>職業</th>
          <td>媽媽：工　公　商　教　醫療　服務　資訊　金融　其他${bl(50)}<br>爸爸：工　公　商　教　醫療　服務　資訊　金融　其他${bl(50)}</td></tr>
        <tr><th>由何處得知<br>本護理之家</th><td colspan="3">□網路　□雜誌　□親友介紹　□路過看到　□報紙　□其他${bl(80)}</td></tr>
        <tr><th colspan="4" style="text-align:center">備　註</th></tr>
        <tr><td colspan="4" style="height:340px;vertical-align:top">
          付訂房型 ${bl(130)}　預約時段：${bl(50)}年${bl(35)}月${bl(35)}日 至 ${bl(50)}年${bl(35)}月${bl(35)}日止，共計 ${bl(45)} 天。<br><br>
          特別叮嚀<br><br><br>
          □飲食:<br><br><br>
          □生活:
        </td></tr>
        <tr><td colspan="4">接待人員：${bl(100)}　主管覆核：${bl(100)}</td></tr>
      </table>
    </div>`;
  $('#tvb-print').onclick = () => window.print();
}

/* ---------- 產品零售作業（快速代客下單＋確認入帳＋收款） ---------- */
async function viewRetail() {
  const [mothers, products, orders] = await Promise.all([
    api('/mothers'), api('/products'), api('/orders')
  ]);
  const actives = products.filter(p => p.active);
  const wantMom = Number((location.hash.split('?m=')[1] || '').split('&')[0]);
  const cutoff = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const recent = orders.filter(o => o.placed_by === 'staff' && (o.created_at || '').slice(0, 10) >= cutoff);
  const listRows = recent.flatMap((o, i) => (o.items || []).map(it => `
      <tr>
        <td data-label="筆數">${i + 1}</td>
        <td data-label="銷售日期">${esc((o.created_at || '').slice(0, 10))}</td>
        <td data-label="購買人">${esc(o.mother_name || '—')}</td>
        <td data-label="銷售品名">${esc(it.item_name)}</td>
        <td data-label="數量">${it.quantity}</td>
        <td data-label="單價">$${it.unit_price}</td>
        <td data-label="合計">$${it.unit_price * it.quantity}</td>
        <td data-label="狀態"><span class="badge ${o.status === 'confirmed' ? 'green' : o.status === 'pending' ? 'yellow' : 'gray'}">${o.status === 'confirmed' ? '已入帳' : o.status === 'pending' ? '待處理' : '已取消'}</span>${o.note ? `<br><small>${esc(o.note)}</small>` : ''}</td>
        <td data-label="建檔人">${esc(o.staff_name || '—')}</td>
      </tr>`)).join('');

  main().innerHTML = `
    <div class="page-title">產品零售作業</div>
    <div class="card">
      <div class="form-grid">
        <div class="field"><label>購買人（媽媽） <b class="req">*</b></label>
          <select id="rt-mom">${mothers.map(m => `<option value="${m.id}" ${m.id === wantMom ? 'selected' : ''}>${esc(m.name)}${m.room_name ? `（${esc(m.room_name)}）` : ''}${m.status === 'checked_in' ? '' : m.status === 'reserved' ? '（潛客/預約）' : '（已退住）'}</option>`).join('')}</select></div>
        <div class="field"><label>銷售日期</label><input type="date" id="rt-date" value="${todayStr()}"></div>
        <div class="field"><label>銷售品名 <b class="req">*</b></label>
          <select id="rt-prod"><option value="">--請選擇--</option>${actives.map(p => `<option value="${p.id}" data-price="${p.price}">${esc(p.name)}（$${p.price}${p.track_stock ? `｜庫存 ${p.stock}` : ''}）</option>`).join('')}</select></div>
        <div class="field"><label>銷售數量</label><input type="number" min="1" id="rt-qty" value="1"></div>
        <div class="field"><label>售價（合計）</label><input id="rt-total" readonly></div>
        <div class="field"><label>收款方式</label>
          <select id="rt-method">${paymentMethods().map(o => `<option>${esc(o)}</option>`).join('')}</select></div>
        <div class="field"><label>收款金額<small>（0＝暫不收款，掛入住帳）</small></label><input type="number" min="0" id="rt-amount"></div>
        <div class="full row" style="gap:10px;flex-wrap:wrap">
          <button class="btn" id="rt-save">資料新增</button>
          <button class="btn secondary" id="rt-clear">清空重填</button>
          <a class="btn small secondary" href="#/customers">回客戶管理</a>
          <a class="btn small secondary" href="#/shop">商城商品管理</a>
          <span class="error-msg" id="rt-err"></span>
        </div>
      </div>
      <small style="color:var(--muted)">新增後自動確認入帳：扣庫存、寫入該媽媽進行中訂房的加購明細；有填收款金額且有進行中訂房時同步登錄收款。</small>
    </div>
    <div class="card">
      <div class="sec-hd">10 日內零售資料如下</div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>筆數</th><th>銷售日期</th><th>購買人</th><th>銷售品名</th><th>數量</th><th>單價</th><th>合計</th><th>狀態</th><th>建檔人</th></tr></thead>
          <tbody>${listRows || '<tr><td colspan="9"><div class="empty">無資料 …</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
  const recalc = () => {
    const opt = $('#rt-prod').selectedOptions[0];
    const price = opt ? Number(opt.dataset.price || 0) : 0;
    const qty = Math.max(1, Number(v('#rt-qty')) || 1);
    const total = price * qty;
    $('#rt-total').value = total ? `$${total}` : '';
    $('#rt-amount').value = total || '';
  };
  $('#rt-prod').onchange = recalc;
  $('#rt-qty').oninput = recalc;
  $('#rt-clear').onclick = () => viewRetail();

  $('#rt-save').onclick = async () => {
    const err = $('#rt-err');
    err.textContent = '';
    const momId = Number(v('#rt-mom')), prodId = Number(v('#rt-prod'));
    const qty = Math.max(1, Number(v('#rt-qty')) || 1);
    if (!momId || !prodId) { err.textContent = '請選擇購買人與銷售品名'; return; }
    const method = v('#rt-method'), amount = Number(v('#rt-amount')) || 0;
    try {
      const o = await api('/orders', { method: 'POST', body: {
        mother_id: momId, items: [{ product_id: prodId, quantity: qty }],
        note: `產品零售 ${v('#rt-date')}${amount > 0 ? `｜收款 ${method} $${amount}` : ''}`
      } });
      await api(`/orders/${o.id}/confirm`, { method: 'POST' });
      // 收款：有進行中訂房才登錄 payments（無則提示改走收費帳務）
      if (amount > 0) {
        const mom = await api(`/mothers/${momId}`);
        const bk = (mom.bookings || []).find(b => b.status === 'checked_in');
        if (bk) {
          await api(`/bookings/${bk.id}/payments`, { method: 'POST', body: {
            amount, method, paid_on: v('#rt-date') || todayStr(), note: `產品零售 訂單#${o.id}`,
            item: '商城零售', target: 'addon' // 零售收款沖抵加購款（訂單確認已入加購明細）
          } });
        } else {
          alert('已建立零售訂單，但該客戶無進行中訂房，收款請至「收費帳務」另行登錄。');
        }
      }
      viewRetail();
    } catch (e) { err.textContent = e.message; }
  };
}

/* ---------- 空白訂房確認單（列印手寫用） ---------- */
async function viewBookingBlank() {
  let rooms = [];
  try { rooms = await api('/rooms'); } catch (e) { rooms = []; }
  // 房型彙整：同房型取每日房價（去重）
  const typeMap = new Map();
  for (const r of rooms) if (r.room_type && !typeMap.has(r.room_type)) typeMap.set(r.room_type, r.price_per_day);
  const bl = w => `<span class="bf-line" style="min-width:${w}px"></span>`;
  const cn = SETTINGS.center_name || '本機構';
  const roomLine = typeMap.size
    ? [...typeMap.entries()].map(([t, p]) => `□（${esc(t)}）${p ? `${Number(p).toLocaleString()} 元/日` : ''}`).join('　')
    : `□${bl(90)}元/日　□${bl(90)}元/日　□${bl(90)}元/日`;

  main().innerHTML = `
    <div class="card no-print">
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <a class="btn small secondary" href="#/customers">回客戶管理</a>
        <button class="btn small" id="bb-print">開始列印</button>
      </div>
    </div>
    <div class="bf-sheet">
      <div style="text-align:center;font-weight:700;font-size:1.05rem">${esc(cn)}</div>
      <div style="text-align:center;font-weight:700;letter-spacing:6px;margin:4px 0 6px">訂房確認單</div>
      <table class="data tvb">
        <tr><th style="width:120px">訂房者姓名</th><th style="width:130px">預產期</th><th style="width:90px">訂房天數</th><th>生產醫院及方式</th><th style="width:200px">訂金</th><th style="width:60px">胎次</th></tr>
        <tr style="height:88px">
          <td></td><td style="text-align:center">　年　月　日</td><td style="text-align:center">　天</td>
          <td style="text-align:center">${bl(120)}醫院<br>□ 自然產<br>□ 剖腹產，日期${bl(80)}</td>
          <td style="text-align:center">新台幣${bl(60)}元整<br>□ 現金<br>□ 匯款銀行/後五碼${bl(70)}</td><td></td>
        </tr>
        <tr><th colspan="6" style="text-align:center">預訂房型</th></tr>
        <tr><td colspan="6" style="text-align:center">${roomLine}<br><b>（**恕難指定房號）</b></td></tr>
        <tr><td colspan="6">飲食禁忌：□無　□牛肉　□羊肉　□帶殼海鮮　□魚，其他：${bl(120)}</td></tr>
        <tr><td colspan="6">特殊疾病：□無　□妊娠高血壓　□妊娠糖尿病　□甲狀腺　□紅斑性狼瘡　□地中海型貧血　其他：${bl(100)}</td></tr>
      </table>
      <div style="font-size:.85rem;line-height:1.8;margin-top:8px">
        <b>※ 雙方約定事項</b>（訂房者以下簡稱甲方，${esc(cn)} 以下簡稱乙方）：
        <ol style="padding-left:22px;margin:4px 0">
          <li>甲方須於確定剖腹日期、待產、生產當日、出院日期，提前通知乙方並確定相關入住事宜。</li>
          <li>本機構入住時間為上午12時以後，退房時間為當日上午10時之前。</li>
          <li>甲方入住當日請務必攜帶：媽媽手冊、寶寶手冊、爸爸陪宿用品（及媽媽貼身衣物、衛生用品、保暖衣帽、寶寶配方奶、奶瓶、吸乳器配件…等）。</li>
          <li>乙方應於甲方生產時提供預定之房型，唯生產皆可能提前或延後，若因而遇滿床，甲方願意同意乙方所安排之其他床型、轉床及退補其差額；並依實際可安排天數入住收費；入住後，乙方保留轉床之權利；屆時甲方若不願意接受乙方轉換床位等安排，則乙方須無條件退還訂金，甲方不得要求其他賠償。</li>
          <li>本機構提供入住媽媽房內：盥洗用具、沐浴用品、毛巾浴巾、室內拖鞋、捲筒衛生紙、吹風機、哺乳睡衣、哺乳枕、保溫壺、茶杯、奶瓶消毒鍋、電動吸乳器。嬰兒房內：嬰兒服、包巾、沐浴用品、尿布、濕紙巾、消毒用品。</li>
          <li>入住後甲方請於包含假日三日內，以現金或匯款方式繳清房費餘款。</li>
          <li>依衛生主管機關規定本機構為非醫療單位，不得執行醫療行為。本機構將善盡照顧之責；如產婦或嬰兒有任何需醫師診斷之情形，將協助至就近的轉診醫院，所發生之醫療費用則由訂房者自行負擔。</li>
          <li>訂房確認後，產婦或嬰兒於進住日前，因健康情形不佳、疾病、死亡，或其他不可歸責於甲方之事由，致無法接受乙方之服務者，甲方得解除契約；乙方應將甲方所繳交之訂金，全數無息退還。除前項事由外，甲方得於產婦或嬰兒進住日之前解除契約；但甲方應依下列規定，賠償乙方損害：一、於預定進住日之前三十一日以前解除契約者，賠償訂金百分之十。二、於預定進住日之前二十一日至三十日解除契約者，賠償訂金百分之二十。三、於預定進住日之前二日至二十日解除契約者，賠償訂金百分之三十。四、於預定進住日之前一日解除契約者，賠償訂金百分之五十。五、於預定進住日當日解除契約者，賠償訂金百分之百。<br>※如需退訂，需5個工作天，請事先來電通知，<b>攜帶本訂房確認單正本前來辦理退費</b>。</li>
        </ol>
      </div>
      <table class="data tvb">
        <tr><td style="width:50%;height:70px;vertical-align:top">媽媽姓名：<br><br>身分證字號：</td>
          <td style="vertical-align:top">${esc(cn)}<br>經辦人：</td></tr>
      </table>
      <div style="font-size:.85rem;margin-top:6px">9. 匯款明細如下：</div>
      <table class="data tvb">
        <tr><th rowspan="3" style="width:60px">匯款</th><th style="width:70px">銀行</th><td>${bl(180)}</td><th style="width:70px">分行</th><td>${bl(140)}</td></tr>
        <tr><th>戶名</th><td>${bl(180)}</td><th>帳號</th><td>${bl(140)}</td></tr>
        <tr><td colspan="4" style="text-align:center">請於完成付款後，將匯款明細註名媽媽姓名回傳客服，以便確認。　連絡電話：${bl(120)}</td></tr>
      </table>
      <div style="font-size:.85rem;line-height:1.8;margin-top:6px">
        <b>感控條款：</b>為確保住房安全，訪客進入需遵守本機構感控原則：換穿拖鞋、量體溫、戴口罩、消毒；若有上呼吸道感染、咳嗽、流鼻水等症狀請主動告知，勿入內探訪。訪客額溫 37.5 以上不得進入本機構。訪客不進房，僅限公共區域會客。12 歲以下訪客兒童禁止進入感控區域。可進房人員為新生兒寶寶爺爺奶奶及外公外婆；一次限兩位進房、並不得接觸新生兒。媽媽住房期間先生可陪宿，陪宿人員中途不可更換。<b>訪客時段：${bl(160)}</b>
      </div>
    </div>`;
  $('#bb-print').onclick = () => window.print();
}

/* ---------- 後台：公佈欄及交辦事項 ---------- */
async function viewBulletins() {
  const rows = await api('/bulletins');
  let staff = [];
  try { staff = await api('/users'); } catch (e) { staff = []; }
  const notices = rows.filter(r => r.kind === 'notice');
  const tasks = rows.filter(r => r.kind === 'task');
  main().innerHTML = `
    <div class="page-title">公佈欄及交辦事項</div>
    <div class="card no-print">
      <div class="sec-hd">發佈公告／交辦</div>
      <div class="form-grid">
        <div class="field"><label>類別</label>
          <div class="row" style="gap:14px;padding-top:8px">
            <label class="bna-chk"><input type="radio" name="bl-kind" value="notice" checked> 公告</label>
            <label class="bna-chk"><input type="radio" name="bl-kind" value="task"> 交辦事項</label>
          </div></div>
        <div class="field"><label>標題 <b class="req">*</b></label><input id="bl-title" maxlength="100"></div>
        <div class="field"><label>指派給<small>（交辦用）</small></label>
          <select id="bl-assign"><option value="">（全體）</option>${staff.filter(u => u.active !== 0).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
        <div class="field"><label>期限<small>（交辦用）</small></label><input type="date" id="bl-due"></div>
        <div class="field full"><label>內容</label><textarea id="bl-body" maxlength="2000" rows="3"></textarea></div>
        <div class="full row" style="gap:10px;align-items:center">
          <label class="bna-chk"><input type="checkbox" id="bl-pin"> 置頂</label>
          <button class="btn" id="bl-add">發佈</button>
          <span class="error-msg" id="bl-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">交辦事項與公佈欄查詢</div>
      ${filterBar({ placeholder: '搜尋標題 / 指派 / 內容…' })}
      <small style="color:var(--muted)">＊搜尋同時套用到下方交辦事項與公佈欄。</small>
    </div>
    <div class="card">
      <div class="sec-hd">交辦事項（未完成 ${tasks.filter(t => !t.done).length}／共 ${tasks.length}）</div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>標題/內容</th><th>指派</th><th>期限</th><th>狀態</th><th>發佈</th><th class="no-print">操作</th></tr></thead>
          <tbody>${tasks.map(t => {
            const overdue = !t.done && t.due_date && t.due_date < todayStr();
            return `
            <tr data-filter="${esc(t.title)} ${esc(t.assigned_name || '')}">
              <td data-label="標題/內容">${t.pinned ? '<span class="badge pink">置頂</span> ' : ''}<b>${esc(t.title)}</b>${t.body ? `<br><small>${esc(t.body)}</small>` : ''}</td>
              <td data-label="指派">${esc(t.assigned_name || '全體')}</td>
              <td data-label="期限"><span style="color:${overdue ? 'var(--danger)' : 'inherit'}">${esc(t.due_date || '—')}${overdue ? ' ⚠' : ''}</span></td>
              <td data-label="狀態">${t.done ? `<span class="badge green">已完成</span><br><small>${esc((t.done_at || '').slice(0, 10))} ${esc(t.done_name || '')}</small>` : '<span class="badge yellow">進行中</span>'}</td>
              <td data-label="發佈"><small>${esc((t.created_at || '').slice(0, 10))}<br>${esc(t.created_name || '')}</small></td>
              <td data-label="操作" class="no-print">
                <button class="btn small ${t.done ? 'secondary' : ''}" data-done="${t.id}|${t.done ? 0 : 1}">${t.done ? '重開' : '標記完成'}</button>
                ${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${t.id}">刪</button>` : ''}
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="6"><div class="empty">尚無交辦事項</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">公佈欄（${notices.length} 則）</div>
      ${notices.map(n => `
        <div data-filter="${esc(n.title)} ${esc(n.body || '')} ${esc(n.created_name || '')}" style="border-bottom:1px dotted var(--border);padding:8px 0">
          <div class="row between" style="flex-wrap:wrap;gap:6px">
            <b>${n.pinned ? '<span class="badge pink">置頂</span> ' : ''}${esc(n.title)}</b>
            <small style="color:var(--muted)">${esc((n.created_at || '').slice(0, 16))}　${esc(n.created_name || '')}
              ${currentUser.role === 'admin' ? `<button class="btn small danger no-print" data-del="${n.id}" style="margin-left:8px">刪</button>` : ''}</small>
          </div>
          ${n.body ? `<div style="font-size:.92rem;margin-top:4px;white-space:pre-wrap">${esc(n.body)}</div>` : ''}
        </div>`).join('') || '<div class="empty">尚無公告</div>'}
    </div>`;

  $('#bl-add').onclick = async () => {
    const err = $('#bl-err');
    err.textContent = '';
    const kind = main().querySelector('input[name="bl-kind"]:checked').value;
    try {
      await api('/bulletins', { method: 'POST', body: {
        kind, title: $('#bl-title').value, body: $('#bl-body').value,
        assigned_to: Number($('#bl-assign').value) || null, due_date: $('#bl-due').value,
        pinned: $('#bl-pin').checked
      } });
      viewBulletins();
    } catch (e) { err.textContent = e.message; }
  };
  wireFilter(main());
  main().querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
    const [id, done] = b.dataset.done.split('|');
    await api(`/bulletins/${id}`, { method: 'PUT', body: { done: done === '1' } });
    viewBulletins();
  });
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除？')) return;
    await api(`/bulletins/${b.dataset.del}`, { method: 'DELETE' });
    viewBulletins();
  });
}

/* ---------- 後台：文件上傳下載區 ---------- */
async function viewDocuments() {
  const rows = await api('/documents');
  const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  main().innerHTML = `
    <div class="page-title">文件上傳下載區</div>
    <div class="card no-print">
      <div class="sec-hd">上傳文件<small>（PDF／Office／圖片／文字／ZIP，單檔 20MB 內）</small></div>
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label>檔案 <b class="req">*</b></label><input type="file" id="doc-file"></div>
        <div class="field" style="margin:0"><label>文件名稱<small>（空白＝檔名）</small></label><input id="doc-title" maxlength="100"></div>
        <div class="field" style="margin:0"><label>分類</label><input id="doc-cat" maxlength="50" placeholder="例如：SOP／表單／教育訓練"></div>
        <div class="field" style="margin:0"><label>備註</label><input id="doc-note" maxlength="200"></div>
        <button class="btn" id="doc-up">上傳</button>
        <span class="error-msg" id="doc-err"></span>
      </div>
    </div>
    <div class="card">
      <div class="row between no-print" style="flex-wrap:wrap;gap:8px">
        <div class="sec-hd" style="flex:1;min-width:200px">文件清單（${rows.length} 份）</div>
      </div>
      ${filterBar({ placeholder: '搜尋文件名稱 / 分類…' })}
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>文件名稱</th><th>分類</th><th>大小</th><th>備註</th><th>上傳</th><th class="no-print">操作</th></tr></thead>
          <tbody>${rows.map(dcu => `
            <tr data-filter="${esc(dcu.title)} ${esc(dcu.category || '')}">
              <td data-label="文件名稱"><b>${esc(dcu.title)}</b>${dcu.orig_name && dcu.orig_name !== dcu.title ? `<br><small style="color:var(--muted)">${esc(dcu.orig_name)}</small>` : ''}</td>
              <td data-label="分類">${dcu.category ? `<span class="badge teal">${esc(dcu.category)}</span>` : '—'}</td>
              <td data-label="大小">${fmtSize(dcu.size || 0)}</td>
              <td data-label="備註"><small>${esc(dcu.note || '—')}</small></td>
              <td data-label="上傳"><small>${esc((dcu.created_at || '').slice(0, 16))}<br>${esc(dcu.uploaded_name || '—')}</small></td>
              <td data-label="操作" class="no-print">
                <a class="btn small" href="/uploads/${esc(dcu.filename)}" download="${esc(dcu.orig_name || dcu.title)}">下載</a>
                ${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${dcu.id}">刪</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="6"><div class="empty">尚無文件</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  $('#doc-up').onclick = async () => {
    const err = $('#doc-err');
    err.textContent = '';
    const f = $('#doc-file').files[0];
    if (!f) { err.textContent = '請選擇檔案'; return; }
    const fd = new FormData();
    fd.append('file', f);
    fd.append('title', $('#doc-title').value.trim());
    fd.append('category', $('#doc-cat').value.trim());
    fd.append('note', $('#doc-note').value.trim());
    try { await api('/documents', { method: 'POST', body: fd }); viewDocuments(); }
    catch (e) { err.textContent = e.message; }
  };
  wireFilter(main());
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除此文件？檔案將一併移除。')) return;
    await api(`/documents/${b.dataset.del}`, { method: 'DELETE' });
    viewDocuments();
  });
}

/* ---------- 後台：客戶退訂資料 ---------- */
async function viewCancellations() {
  const { bookings, tours } = await api('/cancellations');
  main().innerHTML = `
    <div class="page-title">客戶退訂資料</div>
    <div class="card">
      <div class="sec-hd">退訂訂房（${bookings.length} 筆）</div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>媽媽</th><th>房號/房型</th><th>原訂期間</th><th>訂金</th><th>總額</th><th>已收</th><th>備註</th></tr></thead>
          <tbody>${bookings.map(b => `
            <tr data-filter="${esc(b.mother_name)} ${esc(b.room_name)}">
              <td data-label="媽媽">${esc(b.mother_name)}<br><small>${esc(b.phone || '')}</small></td>
              <td data-label="房號/房型">${esc(b.room_name)}<small>（${esc(b.room_type)}）</small></td>
              <td data-label="原訂期間"><small>${esc(b.check_in)} ~ ${esc(b.check_out)}</small></td>
              <td data-label="訂金">$${(b.deposit || 0).toLocaleString()}</td>
              <td data-label="總額">$${(b.total_amount || 0).toLocaleString()}</td>
              <td data-label="已收">${b.paid > 0 ? `<b style="color:var(--danger)">$${b.paid.toLocaleString()}</b>` : '$0'}</td>
              <td data-label="備註"><small>${esc(b.notes || '—')}</small></td>
            </tr>`).join('') || '<tr><td colspan="7"><div class="empty">無退訂訂房</div></td></tr>'}</tbody>
        </table>
      </div>
      <small style="color:var(--muted)">＊已收金額大於 0 者請至「收費帳務」處理退費。</small>
    </div>
    <div class="card">
      <div class="sec-hd">未成交參觀（${tours.length} 筆）</div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>姓名</th><th>電話</th><th>參觀時間</th><th>備註</th></tr></thead>
          <tbody>${tours.map(t => `
            <tr data-filter="${esc(t.name)}">
              <td data-label="姓名">${esc(t.name)}</td>
              <td data-label="電話">${esc(t.phone || '—')}</td>
              <td data-label="參觀時間">${esc(t.tour_at)}</td>
              <td data-label="備註"><small>${esc(t.note || '—')}</small></td>
            </tr>`).join('') || '<tr><td colspan="4"><div class="empty">無未成交紀錄</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

/* ---------- 後台：合約轉住房資料 ---------- */
async function viewContractTransfers() {
  const { rows } = await api('/contract-transfers');
  const BK_TW = { reserved: ['已排房', 'teal'], checked_in: ['已入住', 'green'], checked_out: ['已退住', 'gray'] };
  main().innerHTML = `
    <div class="page-title">合約轉住房資料 <small style="font-weight:400;color:var(--muted);font-size:.9rem">簽約 → 排房 → 入住轉換狀態</small></div>
    <div class="card">
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>合約編號</th><th>媽媽</th><th>簽約日期</th><th>合約總額</th><th>預產期</th><th>排房</th><th>轉換狀態</th><th class="no-print"></th></tr></thead>
          <tbody>${rows.map(r => {
            const st = r.booking_status ? (BK_TW[r.booking_status] || [r.booking_status, 'gray']) : ['未排房', 'yellow'];
            return `
            <tr data-filter="${esc(r.name)} ${esc(r.contract_no)}">
              <td data-label="合約編號">${esc(r.contract_no)}</td>
              <td data-label="媽媽">${esc(r.name)}<br><small>${esc(r.phone || '')}</small></td>
              <td data-label="簽約日期">${esc(r.sign_date || '—')}</td>
              <td data-label="合約總額">$${(r.total || 0).toLocaleString()}</td>
              <td data-label="預產期">${esc(r.due_date || '—')}</td>
              <td data-label="排房"><small>${r.room_name ? `${esc(r.room_name)}<br>${esc(r.stay_range || '')}` : '—'}</small></td>
              <td data-label="轉換狀態"><span class="badge ${st[1]}">${st[0]}</span></td>
              <td data-label="" class="no-print"><a class="btn small" href="#/customers?m=${r.mother_id}">客戶管理</a></td>
            </tr>`;
          }).join('') || '<tr><td colspan="8"><div class="empty">尚無合約資料</div></td></tr>'}</tbody>
        </table>
      </div>
      <small style="color:var(--muted)">＊「未排房」表示已簽約但尚未建立訂房——請至客戶管理「排房資料」分頁完成排房。</small>
    </div>`;
}

/* ---------- 後台：客戶及簽約資料（簽約中/退訂/轉住房 三查詢頁共用） ---------- */
const CCQ_CONF = {
  signed: { title: '客戶簽約資料', note: '',
    dates: [['due', '以預產期查詢'], ['sign', '以簽約日期查詢']] },
  cancelled: { title: '客戶退訂資料', note: '',
    dates: [['due', '以預產期查詢'], ['sign', '以簽約日期查詢'], ['cancel', '以退訂日期查詢']] },
  transferred: { title: '合約轉住房資料', note: '',
    dates: [['checkin', '以入住日期查詢'], ['sign', '以簽約日期查詢'], ['due', '以預產期查詢']] }
};
async function viewClientContractQuery(mode) {
  const cfg = CCQ_CONF[mode];
  const monthStart = todayStr().slice(0, 8) + '01';
  const d = new Date(todayStr().slice(0, 7) + '-01');
  d.setMonth(d.getMonth() + 1); d.setDate(0);
  const monthEnd = d.toISOString().slice(0, 10);
  main().innerHTML = `
    <div class="page-title">${cfg.title}</div>
    <div class="card no-print">
      <div class="sec-hd">${cfg.title}（資料查詢）</div>
      ${cfg.note ? `<div style="color:var(--danger);text-align:center;font-size:.9rem;margin:4px 0">${cfg.note}</div>` : ''}
      <div class="form-grid">
        <div class="field"><label>查詢日期區間</label>
          <div class="row" style="gap:6px;align-items:center">
            <input type="date" id="ccq-from" value="${monthStart}"> <span>to</span> <input type="date" id="ccq-to" value="${monthEnd}">
          </div></div>
        <div class="field"><label>日期欄位條件</label>
          <div class="row" style="gap:12px;padding-top:8px;flex-wrap:wrap">${cfg.dates.map(([k, l], i) =>
            `<label class="bna-chk"><input type="radio" name="ccq-df" value="${k}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
        <div class="field"><label>媽媽姓名</label><input id="ccq-name"></div>
        <div class="field"><label>其他關鍵字查詢</label>
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
            <input id="ccq-kw" style="max-width:180px">
            ${[['contract', '合約編號'], ['idno', '身分證號'], ['phone', '連絡電話']].map(([k, l], i) =>
              `<label class="bna-chk"><input type="radio" name="ccq-kt" value="${k}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}
          </div></div>
        ${mode === 'signed' ? `<div class="field full">
          <div class="row" style="gap:16px;flex-wrap:wrap">
            <span style="font-size:.88rem;color:var(--muted)">查詢區間所有合約（含已退訂／出住／入住中）；排除條件（點選代表排除）：</span>
            <label class="bna-chk"><input type="checkbox" id="ccq-ex-cancel"> 已退訂</label>
            <label class="bna-chk"><input type="checkbox" id="ccq-ex-checkin"> 已入住</label>
          </div></div>` : ''}
        <div class="full row" style="gap:10px;justify-content:center">
          <button class="btn" id="ccq-go">送出查詢</button>
          <span class="error-msg" id="ccq-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="row between no-print" style="flex-wrap:wrap;gap:8px">
        <div class="sec-hd" style="flex:1;min-width:200px">${cfg.title}（查詢結果）</div>
        <a class="btn small" id="ccq-xlsx" href="javascript:void 0" style="background:#2fb6e8">匯出Excel</a>
      </div>
      <div id="ccq-result"><div class="empty">請設定條件後送出查詢</div></div>
    </div>`;

  const qs = () => {
    const p = new URLSearchParams({ mode });
    const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
    if (v('#ccq-from')) p.set('from', v('#ccq-from'));
    if (v('#ccq-to')) p.set('to', v('#ccq-to'));
    p.set('date_field', main().querySelector('input[name="ccq-df"]:checked').value);
    if (v('#ccq-name')) p.set('name', v('#ccq-name'));
    if (v('#ccq-kw')) { p.set('keyword', v('#ccq-kw')); p.set('keyword_type', main().querySelector('input[name="ccq-kt"]:checked').value); }
    const exC = $('#ccq-ex-cancel'), exI = $('#ccq-ex-checkin');
    if (exC && exC.checked) p.set('exclude_cancelled', '1');
    if (exI && exI.checked) p.set('exclude_checkedin', '1');
    return p;
  };

  const run = async () => {
    const err = $('#ccq-err');
    err.textContent = '';
    try {
      const { rows } = await api(`/client-contracts?${qs()}`);
      const sumDays = rows.reduce((s, r) => s + (r.days || 0), 0);
      const sumTotal = rows.reduce((s, r) => s + (r.total || 0), 0);
      const dateCell = r => {
        const parts = [`<span style="color:#3b78c2">(產期)${esc(r.due_date || '—')}</span>`];
        parts.push(`<span style="color:var(--danger)">(簽約)${esc(r.sign_date || '—')}</span>`);
        if (mode === 'cancelled') parts.push(`<span style="color:var(--danger)">(退訂)${esc(r.cancel_date || '—')}</span>`);
        if (mode === 'transferred') parts.push(`<span style="color:var(--primary-dark)">(入住)${esc(r.checkin_date || '—')}</span>`);
        return parts.join('<br>');
      };
      const stBadge = r => {
        const c = { '已退訂': 'red', '已入住': 'green', '已出住': 'gray', '已排房': 'teal', '簽約中': 'yellow' }[r.status_label] || 'gray';
        return `<span class="badge ${c}">${esc(r.status_label || '—')}</span>`;
      };
      $('#ccq-result').innerHTML = rows.length ? (mode === 'signed' ? `
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>筆數</th><th>媽媽姓名<br>身分證號</th><th>預產期</th><th>簽約日期</th><th>預定入住日</th><th>狀態</th><th>聯絡電話</th><th>合約住宿摘要</th><th>天數</th><th>合約總額<br>合約餘額</th><th>合約號碼<br>經手人</th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr data-filter="${esc(r.name)} ${esc(r.contract_no)}">
              <td data-label="筆數">${i + 1}</td>
              <td data-label="媽媽姓名">${esc(r.name)}<br><small>${esc(r.id_no || '—')}</small></td>
              <td data-label="預產期"><span style="color:#3b78c2">${esc(r.due_date || '—')}</span></td>
              <td data-label="簽約日期"><span style="color:var(--danger)">${esc(r.sign_date || '—')}</span></td>
              <td data-label="預定入住日"><span style="color:var(--primary-dark)">${esc(r.expected_check_in || '—')}</span></td>
              <td data-label="狀態">${stBadge(r)}</td>
              <td data-label="聯絡電話">${esc(r.phone || '—')}</td>
              <td data-label="合約住宿摘要"><small>${esc(r.summary || '—')}</small></td>
              <td data-label="天數">${r.days || 0}</td>
              <td data-label="合約總額/餘額">$${(r.total || 0).toLocaleString()}<br><small style="color:${(r.balance || 0) > 0 ? 'var(--danger)' : 'var(--primary-dark)'}">餘 $${(r.balance || 0).toLocaleString()}</small></td>
              <td data-label="合約號碼/經手人"><a href="#/customers?m=${r.mother_id}">${esc(r.contract_no)}</a><br><small>${esc(r.handler || '—')}</small></td>
            </tr>`).join('')}
            <tr style="background:#fbeaea"><td colspan="8" style="text-align:right">合計：</td>
              <td>${sumDays}</td><td>$${sumTotal.toLocaleString()}</td><td></td></tr>
          </tbody>
        </table></div>` : `
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>筆數</th><th>媽媽姓名<br>身分證號</th><th>日期</th><th>聯絡電話</th><th>合約住宿摘要</th>
            ${mode === 'cancelled' ? '<th>原合約金額</th><th>退訂原因<br>退訂人</th>' : '<th>天數</th><th>合約總額</th>'}
            <th>合約號碼<br>經手人</th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr data-filter="${esc(r.name)} ${esc(r.contract_no)}">
              <td data-label="筆數">${i + 1}</td>
              <td data-label="媽媽姓名">${esc(r.name)}<br><small>${esc(r.id_no || '—')}</small></td>
              <td data-label="日期"><small>${dateCell(r)}</small></td>
              <td data-label="聯絡電話">${esc(r.phone || '—')}</td>
              <td data-label="合約住宿摘要"><small>${esc(r.summary || '—')}${mode === 'transferred' && r.room_name ? `<br>房號：${esc(r.room_name)}` : ''}</small></td>
              ${mode === 'cancelled'
                ? `<td data-label="原合約金額">$${(r.total || 0).toLocaleString()}</td>
                   <td data-label="退訂原因/退訂人"><small>${esc(r.cancel_reason || '—')}<br>${esc(r.cancel_by || '—')}</small></td>`
                : `<td data-label="天數">${r.days || 0}</td>
                   <td data-label="合約總額">$${(r.total || 0).toLocaleString()}</td>`}
              <td data-label="合約號碼/經手人"><a href="#/customers?m=${r.mother_id}">${esc(r.contract_no)}</a><br><small>${esc(r.handler || '—')}</small></td>
            </tr>`).join('')}
            <tr style="background:#fbeaea"><td colspan="5" style="text-align:right">合計：</td>
              ${mode === 'cancelled' ? `<td>$${sumTotal.toLocaleString()}</td><td></td>` : `<td>${sumDays}</td><td>$${sumTotal.toLocaleString()}</td>`}<td></td></tr>
          </tbody>
        </table></div>`) : '<div class="empty">搜尋結果無資料…</div>';
    } catch (e) { err.textContent = e.message; }
  };
  $('#ccq-go').onclick = run;
  $('#ccq-xlsx').onclick = () => { location.href = `/api/client-contracts?${qs()}&format=xlsx`; };
  run();
}
function viewClientContracts() { return viewClientContractQuery('signed'); }
function viewCancellationsQuery() { return viewClientContractQuery('cancelled'); }
function viewContractTransfersQuery() { return viewClientContractQuery('transferred'); }

/* ---------- 產後報表查詢（通用報表頁；?r=key） ---------- */
const PP_LABELS = {
  pay_daily_sum: '產後每日收款統計表', pay_daily_detail: '產後每日收款明細表', revenue_month: '產後營收統計分析表',
  supply_sales: '商城商品銷售明細表', retail_detail: '加購項目收入明細表', occupancy_detail: '住宿率明細表',
  occupancy_month: '住宿率統計表', stay_days_month: '媽媽入住天數查詢', baby_stay_days: '寶寶入住天數查詢',
  checkin_info: '媽媽入住資訊查詢',
  cancel_stats: '退訂資料統計表', tour_conversion: '參觀成交率分析表', checkin_stats: '媽媽入住統計表',
  order_detail: '媽媽訂單明細查詢', cleaning10: '10日打掃明細表', baby_out: '寶寶不在館內明細查詢',
  early_checkout: '提前退房明細表', baby_detail: '寶寶資料明細表', ar_detail: '媽媽應收帳款明細表',
  room_card_usage: '住房卡使用明細表',
  satisfy_stay_q: '入住期間滿意度查詢', satisfy_stay_stats: '入住期間滿意度統計',
  satisfy_out_q: '出住滿意度查詢', satisfy_out_stats: '出住滿意度統計',
  discharged_care_q: '已出住照護資料查詢', bf_rate: '母乳哺育率報表',
  rooming_stats: '親子同室統計分析', infection_quality: '護理感控品質查詢',
  epds_q: '愛丁堡憂鬱量查詢', epds_stats: '愛丁堡憂鬱量統計', person_days: '入住人日數統計表',
  inout_month: '產後出入住月報表', mom_rooming: '媽媽親子同室統計'
};
async function viewPpReport() {
  const key = (location.hash.split('?r=')[1] || '').split('&')[0];
  const label = PP_LABELS[key];
  if (!label) {
    main().innerHTML = `<div class="page-title">產後報表查詢</div><div class="card"><div class="row" style="gap:8px;flex-wrap:wrap">${Object.entries(PP_LABELS).map(([k, l]) => `<a class="btn small secondary" href="#/pp-report?r=${k}">${l}</a>`).join('')}</div></div>`;
    return;
  }
  // 客房備品銷售：備品類別下拉（吃商品分類，無權限則僅全部）
  let cats = [];
  if (key === 'supply_sales') {
    try { cats = [...new Set((await api('/products')).map(p => p.category).filter(Boolean))]; } catch (e) { cats = []; }
  }
  main().innerHTML = `
    <div class="page-title">${label}</div>
    <div class="card no-print">
      <div class="sec-hd">${label}（資料查詢）</div>
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end;justify-content:center">
        ${(() => {
          const MONTHLY = ['epds_q', 'epds_stats', 'infection_quality', 'person_days', 'occupancy_month', 'stay_days_month', 'satisfy_stay_stats', 'satisfy_out_stats'];
          return MONTHLY.includes(key) ? `<div class="field" style="margin:0"><label>查詢${['epds_q', 'epds_stats', 'infection_quality'].includes(key) ? '品管' : ''}月份</label>
            <div class="row" style="gap:6px;align-items:center">
              <input type="month" id="pp-from-m" value="${todayStr().slice(0, 7)}"> <span>to</span> <input type="month" id="pp-to-m" value="${todayStr().slice(0, 7)}">
            </div></div>` : `<div class="field" style="margin:0"><label>查詢日期區間</label>
            <div class="row" style="gap:6px;align-items:center">
              <input type="date" id="pp-from" value="${todayStr().slice(0, 8)}01"> <span>to</span> <input type="date" id="pp-to" value="${todayStr()}">
            </div></div>`;
        })()}
        ${key === 'supply_sales' ? `<div class="field" style="margin:0"><label>查詢備品類別</label>
          <select id="pp-cat"><option value="">全部備品</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>` : ''}
        ${(() => {
          const DF_OPTS = {
            checkin_info: [['created', '入住資料建檔日'], ['checkin', '入住日期']],
            order_detail: [['due', '預產期'], ['sign', '簽約日']],
            ar_detail: [['due', '預產期'], ['sign', '簽約日'], ['checkin', '入住日'], ['checkout', '退房日']],
            supply_sales: [['pay', '以收款日期查詢'], ['checkin', '以入住日期查詢']],
            retail_detail: [['pay', '以收款日期查詢'], ['checkin', '以入住日期查詢']]
          };
          return DF_OPTS[key] ? `<div class="field" style="margin:0"><label>日期欄位條件</label>
            <div class="row" style="gap:12px;padding-top:8px;flex-wrap:wrap">${DF_OPTS[key].map(([v, l], i) =>
              `<label class="bna-chk"><input type="radio" name="pp-df" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>` : '';
        })()}
        ${key === 'cancel_stats' ? `<div class="field" style="margin:0"><label>查詢分類</label>
          <select id="pp-kind"><option value="">全部查詢</option><option value="contract">合約退訂</option><option value="booking">訂房取消</option></select></div>` : ''}
        ${key === 'baby_out' ? `<div class="field" style="margin:0"><label style="color:var(--danger)">選項</label>
          <label class="bna-chk" style="padding-top:8px"><input type="checkbox" id="pp-onlyout"> 僅查詢不在館內明細</label></div>` : ''}
        ${['discharged_care_q'].includes(key) ? `<div class="field" style="margin:0"><label>媽媽姓名查詢</label>
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
            <input id="pp-name" style="max-width:200px" placeholder="輸入已出住媽媽姓名">
          </div></div>` : ''}
        ${['checkin_info', 'cancel_stats', 'early_checkout', 'baby_detail', 'epds_q', 'mom_rooming', 'supply_sales', 'retail_detail'].includes(key) ? `<div class="field" style="margin:0"><label>媽媽姓名</label><input id="pp-name"></div>` : ''}
        ${['supply_sales', 'retail_detail'].includes(key) ? `<div class="field" style="margin:0"><label>特定商品或服務</label><input id="pp-item" placeholder="輸入品名關鍵字"></div>` : ''}
        <button class="btn" id="pp-go">送出查詢</button>
        <span class="error-msg" id="pp-err"></span>
      </div>
    </div>
    <div class="card">
      <div class="row between no-print" style="flex-wrap:wrap;gap:8px">
        <div class="sec-hd" style="flex:1;min-width:200px">${label}（查詢結果）</div>
        <div class="row" style="gap:6px">
          <button class="btn small secondary" id="pp-print">資料列印</button>
          <a class="btn small" id="pp-xlsx" href="javascript:void 0" style="background:#2fb6e8">匯出Excel</a>
        </div>
      </div>
      <div id="pp-result"><div class="empty">載入中…</div></div>
    </div>`;

  const qs = () => {
    const p = new URLSearchParams();
    const fm = $('#pp-from-m'), tm = $('#pp-to-m');
    if (fm && fm.value) p.set('from', fm.value + '-01');
    if (tm && tm.value) {
      const d = new Date(new Date(tm.value + '-01').getFullYear(), new Date(tm.value + '-01').getMonth() + 1, 0);
      p.set('to', d.toISOString().slice(0, 10));
    }
    if ($('#pp-from') && $('#pp-from').value) p.set('from', $('#pp-from').value);
    if ($('#pp-to') && $('#pp-to').value) p.set('to', $('#pp-to').value);
    const cat = $('#pp-cat');
    if (cat && cat.value) p.set('cat', cat.value);
    const nameEl = $('#pp-name');
    if (nameEl && nameEl.value.trim()) p.set('name', nameEl.value.trim());
    const itemEl = $('#pp-item');
    if (itemEl && itemEl.value.trim()) p.set('item', itemEl.value.trim());
    const kindEl = $('#pp-kind');
    if (kindEl && kindEl.value) p.set('kind', kindEl.value);
    const dfEl = main().querySelector('input[name="pp-df"]:checked');
    if (dfEl) p.set('date_field', dfEl.value);
    const ooEl = $('#pp-onlyout');
    if (ooEl && ooEl.checked) p.set('only_out', '1');
    const kwtEl = main().querySelector('input[name="pp-kwt"]:checked');
    if (kwtEl) p.set('kw_type', kwtEl.value);
    return p;
  };
  const run = async () => {
    const err = $('#pp-err');
    err.textContent = '';
    try {
      const d = await api(`/pp-reports/${key}?${qs()}`);
      const numeric = d.columns.map(([k]) => d.rows.some(r => typeof r[k] === 'number'));
      const sums = d.columns.map(([k], i) => numeric[i] ? d.rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) : null);
      $('#pp-result').innerHTML = d.rows.length ? `
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>筆數</th>${d.columns.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
          <tbody>${d.rows.map((r, i) => `
            <tr><td data-label="筆數">${i + 1}</td>${d.columns.map(([k, l], ci) => `<td data-label="${esc(l)}">${
              typeof r[k] === 'number' ? r[k].toLocaleString() : esc(r[k] ?? '—')}</td>`).join('')}</tr>`).join('')}
            <tr style="background:#fbeaea"><td>合計</td>${d.columns.map(([k], ci) =>
              `<td>${ci === 0 && !numeric[0] ? '' : (sums[ci] != null ? sums[ci].toLocaleString() : '')}</td>`).join('')}</tr>
          </tbody>
        </table></div>` : '<div class="empty">您輸入的條件，查無資料 …</div>';
    } catch (e) { err.textContent = e.message; $('#pp-result').innerHTML = '<div class="empty">查詢失敗</div>'; }
  };
  $('#pp-go').onclick = run;
  $('#pp-print').onclick = () => window.print();
  $('#pp-xlsx').onclick = () => { location.href = `/api/pp-reports/${key}?${qs()}&format=xlsx`; };
  run();
}

/* ---------- 房間資料管理：房型設定 ---------- */
async function viewRoomTypes() {
  const rows = await api('/room-types');
  const canWrite = currentUser.role === 'admin';
  main().innerHTML = `
    <div class="page-title">房型設定</div>
    <div class="card no-print">
      <div class="sec-hd">房型設定（資料查詢）</div>
      <div class="row" style="justify-content:center;padding:6px 0">
        ${canWrite ? '<button class="btn" id="rt-add">資料新增</button>' : '<small style="color:var(--muted)">僅管理員可維護</small>'}
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">房型設定（查詢結果）</div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>筆數</th><th>房型名稱</th><th>定價</th><th>排序</th><th>狀態</th><th class="no-print"></th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr>
              <td data-label="筆數">${i + 1}</td>
              <td data-label="房型名稱">${esc(r.name)}</td>
              <td data-label="定價">${r.price.toLocaleString()}</td>
              <td data-label="排序">${r.sort}</td>
              <td data-label="狀態"><span class="badge ${r.active ? 'green' : 'gray'}">${r.active ? '啟用' : '停用'}</span></td>
              <td data-label="" class="no-print">${canWrite ? `<button class="btn small secondary" data-edit="${r.id}">編輯</button>
                <button class="btn small danger" data-del="${r.id}">刪</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="6"><div class="empty">尚未設定房型</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  if (!canWrite) return;
  const form = (r) => openModal(r ? '編輯房型' : '新增房型', `
    <div class="field"><label>房型名稱 <b class="req">*</b></label><input id="rt-name" maxlength="50" value="${esc((r || {}).name || '')}"></div>
    <div class="field"><label>定價</label><input type="number" min="0" id="rt-price" value="${(r || {}).price ?? ''}"></div>
    <div class="field"><label>排序</label><input type="number" id="rt-sort" value="${(r || {}).sort ?? 0}"></div>
    <div class="row mt"><button class="btn" id="rt-save">存檔</button><span class="error-msg" id="rt-err"></span></div>`, body => {
    body.querySelector('#rt-save').onclick = async () => {
      const b = { name: body.querySelector('#rt-name').value.trim(), price: body.querySelector('#rt-price').value, sort: body.querySelector('#rt-sort').value };
      try {
        if (r) await api(`/room-types/${r.id}`, { method: 'PUT', body: b });
        else await api('/room-types', { method: 'POST', body: b });
        closeModal(); viewRoomTypes();
      } catch (e) { body.querySelector('#rt-err').textContent = e.message; }
    };
  });
  $('#rt-add').onclick = () => form(null);
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(rows.find(x => x.id == b.dataset.edit)));
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除此房型？（不影響既有房間）')) return;
    await api(`/room-types/${b.dataset.del}`, { method: 'DELETE' }); viewRoomTypes();
  });
}

/* ---------- 房間資料管理：房間資料 ---------- */
async function viewRoomList() {
  const [rooms, types] = await Promise.all([api('/rooms'), api('/room-types')]);
  const canWrite = currentUser.role === 'admin';
  const typeOpts = types.filter(t => t.active).map(t => t.name);
  main().innerHTML = `
    <div class="page-title">房間資料</div>
    <div class="card no-print">
      <div class="sec-hd">房間資料（資料查詢）</div>
      <div class="form-grid">
        <div class="field"><label>查詢關鍵字</label><input id="rl-kw"></div>
        <div class="field"><label>關鍵字欄位</label>
          <div class="row" style="gap:12px;padding-top:8px">
            <label class="bna-chk"><input type="radio" name="rl-kf" value="name" checked> 房間號碼</label>
            <label class="bna-chk"><input type="radio" name="rl-kf" value="ext"> 分機號碼</label>
          </div></div>
        <div class="full row" style="gap:10px;justify-content:center">
          <button class="btn" id="rl-go">送出查詢</button>
          ${canWrite ? '<button class="btn secondary" id="rl-add">資料新增</button><button class="btn secondary" id="rl-batch">多筆新增</button>' : ''}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">房間資料（查詢結果）</div>
      <div class="table-wrap" id="rl-result"></div>
    </div>`;
  const render = (list) => {
    $('#rl-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>房間號碼</th><th>房型名稱</th><th>呼叫分機</th><th>客服分機</th><th>排序</th><th>狀態</th><th class="no-print"></th></tr></thead>
      <tbody>${list.map((r, i) => `
        <tr>
          <td data-label="筆數">${i + 1}</td>
          <td data-label="房間號碼">${esc(r.name)}</td>
          <td data-label="房型名稱">${esc(r.room_type)}</td>
          <td data-label="呼叫分機">${esc(r.call_ext || '—')}</td>
          <td data-label="客服分機">${esc(r.service_ext || '—')}</td>
          <td data-label="排序">${r.sort || 0}</td>
          <td data-label="狀態"><span class="badge ${r.active ? 'green' : 'gray'}">${r.active ? '可用' : '停用'}</span></td>
          <td data-label="" class="no-print">${canWrite ? `<button class="btn small secondary" data-edit="${r.id}">編輯</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="8"><div class="empty">查無資料</div></td></tr>'}</tbody></table>`;
    $('#rl-result').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editRoom(rooms.find(x => x.id == b.dataset.edit), typeOpts));
  };
  const doSearch = () => {
    const kw = $('#rl-kw').value.trim();
    const kf = main().querySelector('input[name="rl-kf"]:checked').value;
    render(!kw ? rooms : rooms.filter(r => kf === 'ext'
      ? ((r.call_ext || '').includes(kw) || (r.service_ext || '').includes(kw))
      : r.name.includes(kw)));
  };
  $('#rl-go').onclick = doSearch;
  $('#rl-kw').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
  render(rooms);
  if (!canWrite) return;
  $('#rl-add').onclick = () => editRoom(null, typeOpts);
  $('#rl-batch').onclick = () => batchRooms(typeOpts);
}
function editRoom(r, typeOpts) {
  openModal(r ? `編輯房間 ${r.name}` : '新增房間', `
    <div class="field"><label>房間號碼 <b class="req">*</b></label><input id="rm-name" value="${esc((r || {}).name || '')}"></div>
    <div class="field"><label>房型</label><select id="rm-type">${typeOpts.map(t => `<option ${r && r.room_type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <div class="field"><label>每日房價</label><input type="number" min="0" id="rm-price" value="${(r || {}).price_per_day ?? ''}"></div>
    <div class="field"><label>呼叫分機</label><input id="rm-call" value="${esc((r || {}).call_ext || '')}"></div>
    <div class="field"><label>客服分機</label><input id="rm-svc" value="${esc((r || {}).service_ext || '')}"></div>
    <div class="field"><label>排序</label><input type="number" id="rm-sort" value="${(r || {}).sort ?? 0}"></div>
    ${r ? `<div class="field"><label>狀態</label><select id="rm-active"><option value="1" ${r.active ? 'selected' : ''}>可用</option><option value="0" ${!r.active ? 'selected' : ''}>停用</option></select></div>` : ''}
    <div class="row mt"><button class="btn" id="rm-save">存檔</button><span class="error-msg" id="rm-err"></span></div>`, body => {
    body.querySelector('#rm-save').onclick = async () => {
      const b = { name: body.querySelector('#rm-name').value.trim(), room_type: body.querySelector('#rm-type').value,
        price_per_day: body.querySelector('#rm-price').value, call_ext: body.querySelector('#rm-call').value.trim(),
        service_ext: body.querySelector('#rm-svc').value.trim(), sort: body.querySelector('#rm-sort').value };
      if (r) b.active = body.querySelector('#rm-active').value === '1';
      try {
        if (r) await api(`/rooms/${r.id}`, { method: 'PUT', body: b });
        else await api('/rooms', { method: 'POST', body: b });
        closeModal(); viewRoomList();
      } catch (e) { body.querySelector('#rm-err').textContent = e.message; }
    };
  });
}
function batchRooms(typeOpts) {
  openModal('多筆新增房間', `
    <div class="field"><label>房型</label><select id="rb-type">${typeOpts.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
    <div class="field"><label>每日房價</label><input type="number" min="0" id="rb-price" value="0"></div>
    <div class="field"><label>房號清單<small>（每行一個，或用「101-110」表示連號）</small></label>
      <textarea id="rb-list" rows="5" placeholder="101\n102\n或 201-210"></textarea></div>
    <div class="row mt"><button class="btn" id="rb-save">批次建立</button><span class="error-msg" id="rb-err"></span></div>`, body => {
    body.querySelector('#rb-save').onclick = async () => {
      const type = body.querySelector('#rb-type').value, price = body.querySelector('#rb-price').value;
      const names = [];
      for (const line of body.querySelector('#rb-list').value.split('\n').map(s => s.trim()).filter(Boolean)) {
        const m = line.match(/^([A-Za-z]*)(\d+)\s*-\s*([A-Za-z]*)(\d+)$/);
        if (m && m[1] === m[3] && Number(m[4]) >= Number(m[2])) {
          const pad = m[2].length;
          for (let n = Number(m[2]); n <= Number(m[4]); n++) names.push(m[1] + String(n).padStart(pad, '0'));
        } else names.push(line);
      }
      if (!names.length) { body.querySelector('#rb-err').textContent = '請輸入房號'; return; }
      try {
        const r = await api('/rooms/batch', { method: 'POST', body: { rooms: names.map(name => ({ name, room_type: type, price_per_day: price })) } });
        alert(`成功新增 ${r.added} 間房（重複房號已略過）`);
        closeModal(); viewRoomList();
      } catch (e) { body.querySelector('#rb-err').textContent = e.message; }
    };
  });
}

/* ---------- 房間資料管理：房價折扣設定 ---------- */
const DISC_TYPE = { percent: '折扣百分比', amount: '折抵金額', gift: '專案贈送' };
const DISC_DEFAULT_CLASSES = ['一般客戶', 'VIP', '舊客回住', '員工親友', '其他'];
async function viewRoomDiscounts() {
  const [types, discounts, settings] = await Promise.all([api('/room-types'), api('/room-discounts'), api('/settings')]);
  const canWrite = currentUser.role === 'admin';
  const typeOpts = types.map(t => t.name);
  const classOpts = (settings.discount_class_options || '').split(',').map(x => x.trim()).filter(Boolean);
  const classes = classOpts.length ? classOpts : DISC_DEFAULT_CLASSES;
  main().innerHTML = `
    <div class="page-title">房價折扣設定</div>
    <div class="card no-print">
      <div class="sec-hd">房價折扣設定（資料查詢）</div>
      <div class="form-grid">
        <div class="field"><label>房型名稱</label><select id="rd-filter"><option value="">全部</option>${typeOpts.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div class="full row" style="gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn" id="rd-go">送出查詢</button>
          ${canWrite ? `<button class="btn secondary" id="rd-add">資料新增</button>
            <button class="btn secondary" id="rd-batch">批次新增</button>
            <button class="btn secondary" id="rd-class">折扣客戶分類</button>` : ''}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">房價折扣設定（查詢結果）</div>
      <div class="table-wrap" id="rd-result"></div>
    </div>`;
  const render = (list) => {
    $('#rd-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>折扣專案／專案贈送方式</th><th>客戶分類</th><th>房型名稱</th><th>折扣方案名稱</th><th>住宿天數</th><th>折扣方式</th><th>折扣值</th><th>優惠天數</th><th class="no-print"></th></tr></thead>
      <tbody>${list.map((r, i) => `
        <tr>
          <td data-label="筆數">${i + 1}</td>
          <td data-label="折扣專案／專案贈送方式"><small>${esc(r.start_date || '—')} ~ ${esc(r.end_date || '—')} ${r.stay_days || 0} (${r.bonus_days || 0})</small></td>
          <td data-label="客戶分類">${esc(r.customer_class || '—')}</td>
          <td data-label="房型名稱">${esc(r.room_type)}</td>
          <td data-label="折扣方案名稱">${esc(r.plan_name || '—')}</td>
          <td data-label="住宿天數">${r.stay_days}</td>
          <td data-label="折扣方式">${DISC_TYPE[r.discount_type] || r.discount_type}</td>
          <td data-label="折扣值">${r.discount_value}${r.discount_type === 'percent' ? '%' : r.discount_type === 'amount' ? ' 元' : ''}</td>
          <td data-label="優惠天數">${r.bonus_days}</td>
          <td data-label="" class="no-print">${canWrite ? `<button class="btn small secondary" data-edit="${r.id}">編輯</button>
            <button class="btn small danger" data-del="${r.id}">刪</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="10"><div class="empty">查無資料</div></td></tr>'}</tbody></table>`;
    $('#rd-result').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => discForm(discounts.find(x => x.id == b.dataset.edit), typeOpts, classes));
    $('#rd-result').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('確定刪除此折扣設定？')) return;
      await api(`/room-discounts/${b.dataset.del}`, { method: 'DELETE' }); viewRoomDiscounts();
    });
  };
  const doFilter = () => { const t = $('#rd-filter').value; render(t ? discounts.filter(d => d.room_type === t) : discounts); };
  $('#rd-go').onclick = doFilter;
  render(discounts);
  if (!canWrite) return;
  $('#rd-add').onclick = () => discForm(null, typeOpts, classes);
  $('#rd-batch').onclick = () => discBatchForm(typeOpts, classes);
  $('#rd-class').onclick = () => discClassManager(settings.discount_class_options || '');
}
function discForm(r, typeOpts, classes) {
  const CLASSES = classes && classes.length ? classes : DISC_DEFAULT_CLASSES;
  openModal(r ? '編輯折扣設定' : '新增折扣設定', `
    <div class="field"><label>房型 <b class="req">*</b></label><select id="d-type">${typeOpts.map(t => `<option ${r && r.room_type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <div class="field"><label>客戶分類</label><select id="d-class">${CLASSES.map(c => `<option ${r && r.customer_class === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="field"><label>折扣方案名稱</label><input id="d-plan" maxlength="50" value="${esc((r || {}).plan_name || '')}" placeholder="例如：牌價／早鳥／續住"></div>
    <div class="field"><label>專案期間（起）</label><input type="date" id="d-start" value="${esc((r || {}).start_date || '')}"></div>
    <div class="field"><label>專案期間（迄）</label><input type="date" id="d-end" value="${esc((r || {}).end_date || '')}"></div>
    <div class="field"><label>住宿天數</label><input type="number" min="0" id="d-days" value="${(r || {}).stay_days ?? 0}"></div>
    <div class="field"><label>折扣方式</label><select id="d-dtype">${Object.entries(DISC_TYPE).map(([k, v]) => `<option value="${k}" ${r && r.discount_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>折扣值<small>（百分比填 85＝85折）</small></label><input type="number" min="0" id="d-val" value="${(r || {}).discount_value ?? 100}"></div>
    <div class="field"><label>優惠贈送天數</label><input type="number" min="0" id="d-bonus" value="${(r || {}).bonus_days ?? 0}"></div>
    <div class="row mt"><button class="btn" id="d-save">存檔</button><span class="error-msg" id="d-err"></span></div>`, body => {
    body.querySelector('#d-save').onclick = async () => {
      const b = { room_type: body.querySelector('#d-type').value, customer_class: body.querySelector('#d-class').value,
        plan_name: body.querySelector('#d-plan').value.trim(), start_date: body.querySelector('#d-start').value,
        end_date: body.querySelector('#d-end').value, stay_days: body.querySelector('#d-days').value,
        discount_type: body.querySelector('#d-dtype').value, discount_value: body.querySelector('#d-val').value,
        bonus_days: body.querySelector('#d-bonus').value };
      try {
        if (r) await api(`/room-discounts/${r.id}`, { method: 'PUT', body: b });
        else await api('/room-discounts', { method: 'POST', body: b });
        closeModal(); viewRoomDiscounts();
      } catch (e) { body.querySelector('#d-err').textContent = e.message; }
    };
  });
}
// 折扣批次新增：一次套用相同折扣條件到多個房型
function discBatchForm(typeOpts, classes) {
  const CLASSES = classes && classes.length ? classes : DISC_DEFAULT_CLASSES;
  openModal('折扣批次新增', `
    <div class="field"><label>套用房型 <b class="req">*</b><small>（可複選）</small></label>
      <div class="row" style="gap:6px 16px;flex-wrap:wrap;padding-top:4px">
        ${typeOpts.map((t, i) => `<label class="bna-chk"><input type="checkbox" class="db-type" value="${esc(t)}"> ${esc(t)}</label>`).join('') || '<small style="color:var(--muted)">尚未設定房型</small>'}
      </div>
      <div class="row" style="gap:12px;padding-top:6px"><a href="javascript:void 0" id="db-all">全選</a><a href="javascript:void 0" id="db-none">全不選</a></div></div>
    <div class="field"><label>客戶分類</label><select id="db-class">${CLASSES.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
    <div class="field"><label>折扣方案名稱</label><input id="db-plan" maxlength="50" placeholder="例如：牌價／早鳥／續住"></div>
    <div class="field"><label>專案期間（起）</label><input type="date" id="db-start"></div>
    <div class="field"><label>專案期間（迄）</label><input type="date" id="db-end"></div>
    <div class="field"><label>住宿天數</label><input type="number" min="0" id="db-days" value="0"></div>
    <div class="field"><label>折扣方式</label><select id="db-dtype">${Object.entries(DISC_TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="field"><label>折扣值<small>（百分比填 85＝85折）</small></label><input type="number" min="0" id="db-val" value="100"></div>
    <div class="field"><label>優惠贈送天數</label><input type="number" min="0" id="db-bonus" value="0"></div>
    <div class="row mt"><button class="btn" id="db-save">批次建立</button><span class="error-msg" id="db-err"></span></div>`, body => {
    const chks = () => [...body.querySelectorAll('.db-type')];
    body.querySelector('#db-all').onclick = () => chks().forEach(c => c.checked = true);
    body.querySelector('#db-none').onclick = () => chks().forEach(c => c.checked = false);
    body.querySelector('#db-save').onclick = async () => {
      const room_types = chks().filter(c => c.checked).map(c => c.value);
      if (!room_types.length) { body.querySelector('#db-err').textContent = '請至少選擇一個房型'; return; }
      const b = { room_types, customer_class: body.querySelector('#db-class').value,
        plan_name: body.querySelector('#db-plan').value.trim(), start_date: body.querySelector('#db-start').value,
        end_date: body.querySelector('#db-end').value, stay_days: body.querySelector('#db-days').value,
        discount_type: body.querySelector('#db-dtype').value, discount_value: body.querySelector('#db-val').value,
        bonus_days: body.querySelector('#db-bonus').value };
      try {
        const r = await api('/room-discounts/batch', { method: 'POST', body: b });
        alert(`成功新增 ${r.added} 筆折扣設定`);
        closeModal(); viewRoomDiscounts();
      } catch (e) { body.querySelector('#db-err').textContent = e.message; }
    };
  });
}
// 折扣客戶分類維護：清單存於 settings.discount_class_options（逗號分隔）
function discClassManager(csv) {
  let items = (csv || '').split(',').map(x => x.trim()).filter(Boolean);
  const save = async (list) => {
    await api('/settings', { method: 'PUT', body: { discount_class_options: list.join(',') } });
    closeModal(); viewRoomDiscounts();
  };
  const render = (body) => {
    body.querySelector('#dc-list').innerHTML = items.map((v, i) => `
      <tr>
        <td data-label="筆數">${i + 1}</td>
        <td data-label="客戶分類">${esc(v)}</td>
        <td data-label="" class="no-print"><button class="btn small secondary" data-edit="${i}">編輯</button>
          <button class="btn small danger" data-del="${i}">刪</button></td>
      </tr>`).join('') || '<tr><td colspan="3"><div class="empty">尚未設定客戶分類</div></td></tr>';
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.edit); const v = prompt('編輯客戶分類：', items[i]);
      if (v == null || !v.trim()) return;
      if (items.some((x, j) => j !== i && x === v.trim())) { alert('已存在'); return; }
      items[i] = v.trim(); render(body);
    });
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (!confirm('確定刪除此分類？（不影響既有折扣設定）')) return;
      items = items.filter((_, i) => i !== Number(b.dataset.del)); render(body);
    });
  };
  openModal('折扣客戶分類', `
    <div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn small" id="dc-add">新增分類</button></div>
    <div class="table-wrap"><table class="data stack">
      <thead><tr><th style="width:70px">筆數</th><th>客戶分類</th><th class="no-print" style="width:130px"></th></tr></thead>
      <tbody id="dc-list"></tbody></table></div>
    <div class="row mt"><button class="btn" id="dc-save">儲存</button><small style="color:var(--muted)">＊儲存後套用於折扣新增／編輯的客戶分類選項。</small></div>`, body => {
    render(body);
    body.querySelector('#dc-add').onclick = () => {
      const v = prompt('新增客戶分類：', '');
      if (v == null || !v.trim()) return;
      if (items.includes(v.trim())) { alert('已存在'); return; }
      items.push(v.trim()); render(body);
    };
    body.querySelector('#dc-save').onclick = () => save(items);
  });
}

/* ---------- 房間資料管理：嬰兒床位設定 ---------- */
async function viewBabyBeds() {
  const beds = await api('/baby-beds');
  const canWrite = currentUser.role === 'admin';
  main().innerHTML = `
    <div class="page-title">嬰兒床位設定</div>
    <div class="card no-print">
      <div class="sec-hd">嬰兒床位設定（資料查詢）</div>
      <div class="form-grid">
        <div class="field"><label>查詢關鍵字</label><input id="bb-kw"></div>
        <div class="field"><label>關鍵字欄位</label>
          <div class="row" style="gap:12px;padding-top:8px">
            <label class="bna-chk"><input type="radio" name="bb-kf" value="bed_no" checked> 房間號碼</label>
          </div></div>
        <div class="full row" style="gap:10px;justify-content:center">
          <button class="btn" id="bb-go">送出查詢</button>
          ${canWrite ? '<button class="btn secondary" id="bb-add">單筆床號新增</button><button class="btn secondary" id="bb-batch">多筆床號新增</button>' : ''}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">嬰兒床位設定（查詢結果）</div>
      <div class="table-wrap" id="bb-result"></div>
    </div>`;
  const render = (list) => {
    $('#bb-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>嬰兒床號碼</th><th>嬰兒床分區</th><th>狀態</th><th class="no-print"></th></tr></thead>
      <tbody>${list.map((r, i) => `
        <tr>
          <td data-label="筆數">${i + 1}</td>
          <td data-label="嬰兒床號碼">${esc(r.bed_no)}</td>
          <td data-label="嬰兒床分區">${esc(r.zone)}</td>
          <td data-label="狀態"><span class="badge ${r.active ? 'green' : 'gray'}">${r.active ? '可用' : '停用'}</span></td>
          <td data-label="" class="no-print">${canWrite ? `<button class="btn small secondary" data-edit="${r.id}">編輯</button>
            <button class="btn small danger" data-del="${r.id}">刪</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="5"><div class="empty">查無資料</div></td></tr>'}</tbody></table>`;
    $('#bb-result').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => bedForm(beds.find(x => x.id == b.dataset.edit)));
    $('#bb-result').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('確定刪除此床位？')) return;
      await api(`/baby-beds/${b.dataset.del}`, { method: 'DELETE' }); viewBabyBeds();
    });
  };
  const doSearch = () => { const kw = $('#bb-kw').value.trim(); render(kw ? beds.filter(b => b.bed_no.includes(kw)) : beds); };
  $('#bb-go').onclick = doSearch;
  $('#bb-kw').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
  render(beds);
  if (!canWrite) return;
  $('#bb-add').onclick = () => bedForm(null);
  $('#bb-batch').onclick = () => batchBeds();
}
function bedForm(r) {
  openModal(r ? '編輯床位' : '單筆床號新增', `
    <div class="field"><label>嬰兒床號碼 <b class="req">*</b></label><input id="bd-no" value="${esc((r || {}).bed_no || '')}"></div>
    <div class="field"><label>分區</label><input id="bd-zone" value="${esc((r || {}).zone || 'A')}"></div>
    ${r ? `<div class="field"><label>狀態</label><select id="bd-active"><option value="1" ${r.active ? 'selected' : ''}>可用</option><option value="0" ${!r.active ? 'selected' : ''}>停用</option></select></div>` : ''}
    <div class="row mt"><button class="btn" id="bd-save">存檔</button><span class="error-msg" id="bd-err"></span></div>`, body => {
    body.querySelector('#bd-save').onclick = async () => {
      const b = { bed_no: body.querySelector('#bd-no').value.trim(), zone: body.querySelector('#bd-zone').value.trim() || 'A' };
      if (r) b.active = body.querySelector('#bd-active').value === '1';
      try {
        if (r) await api(`/baby-beds/${r.id}`, { method: 'PUT', body: b });
        else await api('/baby-beds', { method: 'POST', body: b });
        closeModal(); viewBabyBeds();
      } catch (e) { body.querySelector('#bd-err').textContent = e.message; }
    };
  });
}
function batchBeds() {
  openModal('多筆床號新增', `
    <div class="field"><label>分區</label><input id="bz-zone" value="A"></div>
    <div class="field"><label>床號清單<small>（每行一個，或用「A301-A310」連號）</small></label>
      <textarea id="bz-list" rows="5" placeholder="A301\nA302\n或 A301-A310"></textarea></div>
    <div class="row mt"><button class="btn" id="bz-save">批次建立</button><span class="error-msg" id="bz-err"></span></div>`, body => {
    body.querySelector('#bz-save').onclick = async () => {
      const zone = body.querySelector('#bz-zone').value.trim() || 'A';
      const nos = [];
      for (const line of body.querySelector('#bz-list').value.split('\n').map(s => s.trim()).filter(Boolean)) {
        const m = line.match(/^([A-Za-z]*)(\d+)\s*-\s*([A-Za-z]*)(\d+)$/);
        if (m && m[1] === m[3] && Number(m[4]) >= Number(m[2])) {
          const pad = m[2].length;
          for (let n = Number(m[2]); n <= Number(m[4]); n++) nos.push(m[1] + String(n).padStart(pad, '0'));
        } else nos.push(line);
      }
      if (!nos.length) { body.querySelector('#bz-err').textContent = '請輸入床號'; return; }
      try {
        const r = await api('/baby-beds/batch', { method: 'POST', body: { beds: nos.map(bed_no => ({ bed_no, zone })) } });
        alert(`成功新增 ${r.added} 個床位（重複已略過）`);
        closeModal(); viewBabyBeds();
      } catch (e) { body.querySelector('#bz-err').textContent = e.message; }
    };
  });
}

/* ---------- 產後系統其他設定：通用選項清單頁 ---------- */
const SYS_OPT_PAGES = {
  tour_source: { key: 'tour_source_options', title: '預約參觀訊息來源', label: '訊息來源',
    extra: { key: 'tour_visit_limit', label: '設定預約參觀人數限制' } },
  formula_brand: { key: 'formula_brand_options', title: '寶寶奶粉廠牌設定', label: '奶粉廠牌' },
  referral_hospital: { key: 'referral_hospital_options', title: '護理後送醫院', label: '後送醫院' },
  contact_class: { key: 'contact_class_options', title: '產後客戶聯絡人分類', label: '產後客戶聯絡人關係' }
};
async function viewSysOption() {
  const which = (location.hash.split('?k=')[1] || '').split('&')[0];
  const cfg = SYS_OPT_PAGES[which];
  if (!cfg) { main().innerHTML = '<div class="page-title">產後系統其他設定</div><div class="card"><div class="empty">未指定設定項目</div></div>'; return; }
  const canWrite = currentUser.role === 'admin';
  const s = await api('/settings');
  const items = (s[cfg.key] || '').split(',').map(x => x.trim()).filter(Boolean);
  const save = async (list) => {
    await api('/settings', { method: 'PUT', body: { [cfg.key]: list.join(',') } });
    viewSysOption();
  };
  main().innerHTML = `
    <div class="page-title">${cfg.title}</div>
    <div class="card no-print">
      <div class="row" style="gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        ${canWrite ? '<button class="btn" id="so-add">新增資料</button>' : '<small style="color:var(--muted)">僅管理員可維護</small>'}
        ${cfg.extra ? `<div class="row" style="gap:8px;align-items:center">
          <span>${cfg.extra.label}：</span>
          <input type="number" min="0" id="so-extra" value="${esc(s[cfg.extra.key] || '')}" style="width:90px" ${canWrite ? '' : 'disabled'}>
          ${canWrite ? '<button class="btn small" id="so-extra-save">設定</button>' : ''}
        </div>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">${cfg.title}（資料明細）</div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th style="width:80px">筆數</th><th>${esc(cfg.label)}</th><th class="no-print" style="width:140px"></th></tr></thead>
          <tbody>${items.map((v, i) => `
            <tr>
              <td data-label="筆數">${i + 1}</td>
              <td data-label="${esc(cfg.label)}">${esc(v)}</td>
              <td data-label="" class="no-print">${canWrite ? `<button class="btn small secondary" data-edit="${i}">編輯</button>
                <button class="btn small danger" data-del="${i}">刪</button>` : ''}</td>
            </tr>`).join('') || `<tr><td colspan="3"><div class="empty">尚未設定${esc(cfg.label)}</div></td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
  if (!canWrite) return;
  if (cfg.extra) $('#so-extra-save').onclick = async () => {
    await api('/settings', { method: 'PUT', body: { [cfg.extra.key]: $('#so-extra').value } });
    alert('已設定');
  };
  $('#so-add').onclick = () => {
    const v = prompt(`新增${cfg.label}：`, '');
    if (v == null || !v.trim()) return;
    if (items.includes(v.trim())) { alert('已存在'); return; }
    save([...items, v.trim()]);
  };
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.edit);
    const v = prompt(`編輯${cfg.label}：`, items[i]);
    if (v == null || !v.trim()) return;
    const next = [...items]; next[i] = v.trim();
    save(next);
  });
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (!confirm('確定刪除此項？')) return;
    save(items.filter((_, i) => i !== Number(b.dataset.del)));
  });
}

/* ---------- 產後系統其他設定：打掃定期工作設定 ---------- */
async function viewCleaningSchedule() {
  const canWrite = currentUser.role === 'admin';
  const s = await api('/settings');
  main().innerHTML = `
    <div class="page-title">打掃定期工作設定</div>
    <div class="card">
      <div class="form-grid">
        <div class="field"><label>定期換媽媽床單</label>
          <div class="row" style="gap:8px;align-items:center">媽媽房間每 <input type="number" min="1" id="cs-sheet" value="${esc(s.hk_sheet_days || '7')}" style="width:90px" ${canWrite ? '' : 'disabled'}> 天換一次床單</div></div>
        <div class="field"><label>定期更新房內備品</label>
          <div class="row" style="gap:8px;align-items:center">媽媽房間每 <input type="number" min="1" id="cs-supply" value="${esc(s.hk_supply_days || '1')}" style="width:90px" ${canWrite ? '' : 'disabled'}> 天更新一次備品</div></div>
        <div class="field"><label>異動狀態</label>
          <div id="cs-log" style="color:#b23">${s.hk_updated_by ? `${esc(s.hk_updated_by)}<br>${esc(s.hk_updated_at || '')}` : '<span style="color:var(--muted)">尚無異動紀錄</span>'}</div></div>
        ${canWrite ? '<div class="full row" style="justify-content:center;margin-top:6px"><button class="btn" id="cs-save">資料存檔</button><span class="error-msg" id="cs-err"></span></div>' : '<div class="full"><small style="color:var(--muted)">僅管理員可維護</small></div>'}
      </div>
      <small style="color:var(--muted)">＊此設定供房務清潔排程提醒使用（媽媽房況「有待辦房務」與房務任務排定）。</small>
    </div>`;
  if (!canWrite) return;
  $('#cs-save').onclick = async () => {
    try {
      const r = await api('/settings', { method: 'PUT', body: { hk_sheet_days: $('#cs-sheet').value, hk_supply_days: $('#cs-supply').value } });
      const ns = (r && r.settings) || {};
      if (ns.hk_updated_by) $('#cs-log').innerHTML = `${esc(ns.hk_updated_by)}<br>${esc(ns.hk_updated_at || '')}`;
      $('#cs-save').textContent = '已存檔 ✓';
      setTimeout(() => { const b = $('#cs-save'); if (b) b.textContent = '資料存檔'; }, 1500);
    } catch (e) { $('#cs-err').textContent = e.message; }
  };
}

/* ---------- 產後系統其他設定：門燈控制設定（房況狀態 → 色碼） ---------- */
const DOOR_LIGHT_STATES = ['空房', '入住準備', '媽媽入住', '母嬰同室', '出住打掃', '等待檢查', '保留', '維修'];
const DOOR_LIGHT_DEFAULT = { '空房': '#057505', '入住準備': '#409fff', '媽媽入住': '#ff244a', '母嬰同室': '#8c0fff', '出住打掃': '#e0e070', '等待檢查': '#ff9f40', '保留': '#f53bd6', '維修': '#9e9e9e' };
const DOOR_LIGHT_PRESETS = [['綠', '#057505'], ['藍', '#409fff'], ['紅', '#ff244a'], ['紫', '#8c0fff'], ['黃', '#e0e070'], ['橘', '#ff9f40'], ['桃紅', '#f53bd6'], ['灰', '#9e9e9e'], ['黑', '#333333']];
function parseJsonSetting(v, fallback) {
  try { const o = JSON.parse(v); return (o && typeof o === 'object') ? o : fallback; } catch (e) { return fallback; }
}
async function viewDoorLight() {
  const canWrite = currentUser.role === 'admin';
  const s = await api('/settings');
  const colors = { ...DOOR_LIGHT_DEFAULT, ...parseJsonSetting(s.door_light_options, {}) };
  const dis = canWrite ? '' : 'disabled';
  main().innerHTML = `
    <div class="page-title">門燈控制設定</div>
    <div class="card">
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th style="width:60px">No</th><th style="width:110px">狀態</th><th>前台媽媽房況顏色</th><th style="width:120px">顏色預覽</th></tr></thead>
          <tbody>${DOOR_LIGHT_STATES.map((st, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${esc(st)}</td>
              <td>
                <div class="row" style="gap:8px 18px;flex-wrap:wrap;align-items:center">
                  <span>選擇預設顏色：<select class="dl-preset" data-st="${esc(st)}" ${dis}><option value="">請選擇預設顏色</option>${DOOR_LIGHT_PRESETS.map(([n, c]) => `<option value="${c}">${esc(n)}（${c}）</option>`).join('')}</select></span>
                  <span>自行填入色碼：<input class="dl-hex" data-st="${esc(st)}" value="${esc(colors[st] || '')}" placeholder="#rrggbb" maxlength="7" style="width:120px" ${dis}></span>
                </div>
              </td>
              <td><div class="dl-prev" data-st="${esc(st)}" style="width:100%;height:34px;border:1px solid var(--border);border-radius:4px;background:${esc(colors[st] || '#ffffff')}"></div></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      ${canWrite ? '<div class="row mt" style="margin-top:12px"><button class="btn" id="dl-save">資料存檔</button><span class="error-msg" id="dl-err"></span></div>' : '<small style="color:var(--muted)">僅管理員可維護</small>'}
      <small style="color:var(--muted)">＊此設定儲存各房況狀態的顯示色碼；色碼格式為 #rrggbb。</small>
    </div>`;
  const prev = st => main().querySelector(`.dl-prev[data-st="${st}"]`);
  main().querySelectorAll('.dl-hex').forEach(inp => inp.oninput = () => {
    const v = inp.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) prev(inp.dataset.st).style.background = v;
  });
  main().querySelectorAll('.dl-preset').forEach(sel => sel.onchange = () => {
    if (!sel.value) return;
    const hex = main().querySelector(`.dl-hex[data-st="${sel.dataset.st}"]`);
    hex.value = sel.value; prev(sel.dataset.st).style.background = sel.value;
  });
  if (!canWrite) return;
  $('#dl-save').onclick = async () => {
    const out = {};
    for (const inp of main().querySelectorAll('.dl-hex')) {
      const v = inp.value.trim();
      if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) { $('#dl-err').textContent = `「${inp.dataset.st}」色碼格式需為 #rrggbb`; return; }
      out[inp.dataset.st] = v || DOOR_LIGHT_DEFAULT[inp.dataset.st];
    }
    try {
      await api('/settings', { method: 'PUT', body: { door_light_options: JSON.stringify(out) } });
      $('#dl-save').textContent = '已存檔 ✓';
      setTimeout(() => { const b = $('#dl-save'); if (b) b.textContent = '資料存檔'; }, 1500);
    } catch (e) { $('#dl-err').textContent = e.message; }
  };
}

/* ---------- 產後系統其他設定：出院帶藥藥品設定（藥品種類＋藥品名稱） ---------- */
function parseJsonArraySetting(v, fallback) {
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : fallback; } catch (e) { return fallback; }
}

/* ---------- 衛教時間表設定（入住第 N 天 → 衛教項目，管理員可自由增修）---------- */
async function viewEduSchedule() {
  const canWrite = currentUser.role === 'admin';
  const s = await api('/settings');
  const sched = parseJsonArraySetting(s.edu_schedule, []).filter(x => x && Number(x.day) > 0)
    .map(x => ({ day: Number(x.day), items: Array.isArray(x.items) ? x.items : [] }))
    .sort((a, b) => a.day - b.day);
  const save = async (list) => {
    await api('/settings', { method: 'PUT', body: { edu_schedule: JSON.stringify(list.sort((a, b) => a.day - b.day)) } });
    viewEduSchedule();
  };
  main().innerHTML = `
    <div class="page-title">衛教時間表設定 <small style="font-weight:400;color:var(--muted);font-size:.9rem">入住第 N 天應完成的衛教項目</small></div>
    <div class="card no-print">
      ${canWrite ? '<button class="btn" id="es-add">新增日程</button>' : '<small style="color:var(--muted)">僅管理員可維護</small>'}
      <small style="color:var(--muted);display:block;margin-top:6px">＊此表供「護理提醒」判斷各媽媽當日應完成哪些衛教；可自由增減天數與項目。</small>
    </div>
    <div class="card">
      <div class="sec-hd">衛教時間表（${sched.length} 個日程）</div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th style="width:120px">入住天數</th><th>衛教項目</th><th class="no-print" style="width:130px"></th></tr></thead>
        <tbody>${sched.map((d, i) => `
          <tr>
            <td data-label="入住天數">第 ${d.day} 天</td>
            <td data-label="衛教項目">${d.items.length ? d.items.map(it => `<span class="badge teal" style="margin:2px">${esc(it)}</span>`).join(' ') : '—'}</td>
            <td data-label="" class="no-print">${canWrite ? `<button class="btn small secondary" data-edit="${i}">編輯</button> <button class="btn small danger" data-del="${i}">刪</button>` : ''}</td>
          </tr>`).join('') || '<tr><td colspan="3"><div class="empty">尚未設定衛教時間表</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  if (!canWrite) return;
  const form = (idx) => {
    const d = idx == null ? { day: '', items: [] } : sched[idx];
    openModal(idx == null ? '新增衛教日程' : '編輯衛教日程', `
      <div class="field"><label>入住第幾天 <b class="req">*</b></label><input type="number" min="1" id="es-day" value="${d.day || ''}"></div>
      <div class="field"><label>衛教項目<small>（每行一項）</small></label><textarea id="es-items" rows="6">${esc((d.items || []).join('\n'))}</textarea></div>
      <div class="row mt"><button class="btn" id="es-save">存檔</button><span class="error-msg" id="es-err"></span></div>`, body => {
      body.querySelector('#es-save').onclick = () => {
        const day = Number(body.querySelector('#es-day').value);
        const items = body.querySelector('#es-items').value.split('\n').map(x => x.trim()).filter(Boolean);
        if (!(day > 0)) { body.querySelector('#es-err').textContent = '請輸入正確的入住天數'; return; }
        if (!items.length) { body.querySelector('#es-err').textContent = '請至少填一個衛教項目'; return; }
        // 同一天視為覆蓋（避免重複日程）
        const next = sched.filter((_, j) => j !== idx).filter(x => x.day !== day).concat([{ day, items }]);
        closeModal(); save(next);
      };
    });
  };
  $('#es-add').onclick = () => form(null);
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Number(b.dataset.edit)));
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (!confirm('確定刪除此日程？')) return;
    save(sched.filter((_, i) => i !== Number(b.dataset.del)));
  });
}
async function viewDischargeMeds() {
  const canWrite = currentUser.role === 'admin';
  const s = await api('/settings');
  let items = parseJsonArraySetting(s.discharge_med_options, []).filter(x => x && (x.cat || x.name));
  const save = async (list) => {
    await api('/settings', { method: 'PUT', body: { discharge_med_options: JSON.stringify(list) } });
    items = list; render();
  };
  const render = () => {
    $('#dm-list').innerHTML = items.map((r, i) => `
      <tr>
        <td data-label="筆數">${i + 1}</td>
        <td data-label="藥品種類">${esc(r.cat || '')}</td>
        <td data-label="藥品名稱">${esc(r.name || '')}</td>
        <td data-label="" class="no-print">${canWrite ? `<button class="btn small secondary" data-edit="${i}">編輯</button>
          <button class="btn small danger" data-del="${i}">刪</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="4"><div class="empty">尚未設定藥品</div></td></tr>';
    main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Number(b.dataset.edit)));
    main().querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (!confirm('確定刪除此藥品？')) return;
      save(items.filter((_, i) => i !== Number(b.dataset.del)));
    });
  };
  const form = (idx) => {
    const r = idx == null ? { cat: '', name: '' } : items[idx];
    openModal(idx == null ? '新增藥品' : '編輯藥品', `
      <div class="field"><label>藥品種類 <b class="req">*</b></label><input id="dm-cat" maxlength="30" value="${esc(r.cat || '')}"></div>
      <div class="field"><label>藥品名稱 <b class="req">*</b></label><input id="dm-name" maxlength="60" value="${esc(r.name || '')}"></div>
      <div class="row mt"><button class="btn" id="dm-save">存檔</button><span class="error-msg" id="dm-err"></span></div>`, body => {
      body.querySelector('#dm-save').onclick = () => {
        const cat = body.querySelector('#dm-cat').value.trim(), name = body.querySelector('#dm-name').value.trim();
        if (!cat || !name) { body.querySelector('#dm-err').textContent = '請填寫藥品種類與名稱'; return; }
        const next = [...items];
        if (idx == null) next.push({ cat, name }); else next[idx] = { cat, name };
        closeModal(); save(next);
      };
    });
  };
  main().innerHTML = `
    <div class="page-title">出院帶藥藥品設定</div>
    <div class="card no-print">
      ${canWrite ? '<button class="btn" id="dm-add">新增資料</button>' : '<small style="color:var(--muted)">僅管理員可維護</small>'}
    </div>
    <div class="card">
      <div class="sec-hd">出院帶藥藥品設定（資料明細）</div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th style="width:80px">筆數</th><th>藥品種類</th><th>藥品名稱</th><th class="no-print" style="width:130px"></th></tr></thead>
          <tbody id="dm-list"></tbody>
        </table>
      </div>
    </div>`;
  render();
  if (canWrite) $('#dm-add').onclick = () => form(null);
}

/* ========== 預約參觀管理模組 ========== */
// 依「日期欄位條件」取得該筆的比對日期：tour=預約參觀日、due=預產期、reg=報名日期
function tourFieldDate(t, f) { return f === 'due' ? (t.due_date || '') : f === 'reg' ? (t.created_at || '').slice(0, 10) : (t.tour_at || '').slice(0, 10); }
// 本月起迄（YYYY-MM-DD）
function monthBounds() { const s = todayStr().slice(0, 7); const d = new Date(); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); return [s + '-01', s + '-' + String(last).padStart(2, '0')]; }
// 產生 CSV 並下載（含 BOM，Excel 可正確顯示中文）
// 上傳前於瀏覽器端壓縮圖片：長邊縮到 maxDim、轉 JPEG，降低上傳量與儲存空間；失敗或非圖片則原檔回傳
function compressImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file || !/^image\//.test(file.type) || /gif|svg/.test(file.type)) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const long = Math.max(img.width, img.height);
      if (long <= maxDim && file.size < 800 * 1024) return resolve(file); // 已夠小就不重壓
      const scale = Math.min(1, maxDim / long);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob(b => {
        if (b && b.size < file.size) resolve(new File([b], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
        else resolve(file);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
function downloadCsv(filename, header, rows) {
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const body = [header.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
// 伺服器端分頁列（單頁只會有一個，故用固定 id pg-prev/pg-next）
const PAGE_SIZE = 20;
function pagerBar(total, page, pageSize) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<div class="row no-print" style="justify-content:center;gap:12px;align-items:center;margin-top:10px">
    <button class="btn small secondary" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>‹ 上一頁</button>
    <span style="font-size:.85rem;color:var(--muted)">第 ${page} / ${pages} 頁　共 ${total} 筆</span>
    <button class="btn small secondary" id="pg-next" ${page >= pages ? 'disabled' : ''}>下一頁 ›</button>
  </div>`;
}
function wirePager(page, total, pageSize, go) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const prev = document.getElementById('pg-prev'), next = document.getElementById('pg-next');
  if (prev) prev.onclick = () => { if (page > 1) go(page - 1); };
  if (next) next.onclick = () => { if (page < pages) go(page + 1); };
}
const TOUR_DATE_FIELDS = [['tour', '以預約參觀日查詢'], ['due', '以預產期查詢'], ['reg', '以聯繫日期查詢']];
function tourQueryForm(prefix, { fromDefault, toDefault, withName = true } = {}) {
  return `
    <div class="form-grid">
      <div class="field"><label>查詢日期區間</label>
        <div class="row" style="gap:6px;align-items:center">
          <input type="date" id="${prefix}-from" value="${fromDefault}"><span>to</span><input type="date" id="${prefix}-to" value="${toDefault}"></div></div>
      <div class="field full"><label>日期欄位條件</label>
        <div class="row" style="gap:16px;padding-top:6px;flex-wrap:wrap">${TOUR_DATE_FIELDS.map(([v, l], i) =>
          `<label class="bna-chk"><input type="radio" name="${prefix}-fld" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
      ${withName ? `<div class="field"><label>媽媽姓名</label><input id="${prefix}-name"></div>
      <div class="field"><label>連絡電話</label><input id="${prefix}-phone"></div>` : ''}
    </div>`;
}
function tourQueryRead(prefix, withName = true) {
  return {
    from: $(`#${prefix}-from`).value, to: $(`#${prefix}-to`).value,
    fld: main().querySelector(`input[name="${prefix}-fld"]:checked`).value,
    name: withName ? $(`#${prefix}-name`).value.trim() : '', phone: withName ? $(`#${prefix}-phone`).value.trim() : ''
  };
}
function tourMatch(t, q) {
  const d = tourFieldDate(t, q.fld);
  if (q.from && (!d || d < q.from)) return false;
  if (q.to && (!d || d > q.to)) return false;
  if (q.name && !(t.name || '').includes(q.name)) return false;
  if (q.phone && !(t.phone || '').includes(q.phone)) return false;
  return true;
}
// 由查詢表單組出伺服器端 /tours 查詢參數
function tourQueryParams(prefix, { withName = true, onlyCancelled = false } = {}) {
  const q = tourQueryRead(prefix, withName);
  const p = new URLSearchParams({ field: q.fld });
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.name) p.set('name', q.name);
  if (q.phone) p.set('phone', q.phone);
  if (onlyCancelled) p.set('only_cancelled', '1');
  return p;
}

// 1. 潛在客戶資料
// 參觀狀態顯示：取消（未參觀）優先於狀態欄
function tourStatusBadge(t) {
  if (t.cancel_at) return '<span class="badge gray">未參觀</span>';
  const map = { scheduled: ['已預約', 'yellow'], visited: ['已參觀', 'teal'], signed: ['已簽約', 'green'], lost: ['未成交', 'gray'] };
  const [l, c] = map[t.status] || [t.status || '—', 'gray'];
  return `<span class="badge ${c}">${l}</span>`;
}
async function viewProspects() {
  const [mf, mt] = monthBounds();
  main().innerHTML = `
    <div class="page-title">潛在客戶資料</div>
    <div class="card no-print">
      <div class="sec-hd">潛在客戶資料（資料查詢）</div>
      ${tourQueryForm('pc', { fromDefault: mf, toDefault: mt })}
      <div class="row" style="gap:16px;flex-wrap:wrap;margin-top:4px">
        <span style="font-size:.88rem;color:var(--muted)">排除條件（點選代表排除）：</span>
        <label class="bna-chk"><input type="checkbox" id="pc-ex-cancel"> 未參觀</label>
        <label class="bna-chk"><input type="checkbox" id="pc-ex-lost"> 未成交</label>
      </div>
      <div class="row" style="gap:10px;justify-content:center;margin-top:8px">
        <button class="btn" id="pc-go">送出查詢</button>
        <button class="btn secondary" id="pc-csv">匯出 EXCEL</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">潛在客戶資料（查詢結果）</div>
      <div class="table-wrap" id="pc-result"></div>
      <div id="pc-pager"></div>
    </div>`;
  const params = () => {
    const p = tourQueryParams('pc');
    if ($('#pc-ex-cancel').checked) p.set('exclude_cancelled', '1');
    if ($('#pc-ex-lost').checked) p.set('exclude_lost', '1');
    return p;
  };
  const rowToArr = t => [t.name, t.due_date || '', (t.tour_at || '').slice(0, 16), (t.created_at || '').slice(0, 10),
    t.cancel_at ? '未參觀' : ({ scheduled: '已預約', visited: '已參觀', signed: '已簽約', lost: '未成交' }[t.status] || ''),
    t.phone || '', t.note || '', t.created_by_name || ''];
  const load = async (page = 1) => {
    const p = params(); p.set('page', page); p.set('pageSize', PAGE_SIZE);
    const { rows, total, pageSize } = await api('/tours?' + p.toString());
    const base = (page - 1) * pageSize;
    $('#pc-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>媽媽姓名</th><th>預產期</th><th>預約參觀日</th><th>聯繫日期</th><th>狀態</th><th>聯絡電話</th><th>備註</th><th>建檔人</th></tr></thead>
      <tbody>${rows.map((t, i) => `
        <tr>
          <td data-label="筆數">${base + i + 1}</td>
          <td data-label="媽媽姓名">${esc(t.name)}</td>
          <td data-label="預產期">${esc(t.due_date || '—')}</td>
          <td data-label="預約參觀日"><span style="color:#b23">${esc((t.tour_at || '—').slice(0, 16))}</span></td>
          <td data-label="聯繫日期"><span style="color:#2a7f78">${esc((t.created_at || '—').slice(0, 10))}</span></td>
          <td data-label="狀態">${tourStatusBadge(t)}</td>
          <td data-label="聯絡電話">${esc(t.phone || '—')}</td>
          <td data-label="備註">${esc(t.note || '—')}</td>
          <td data-label="建檔人">${esc(t.created_by_name || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="9"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
    $('#pc-pager').innerHTML = pagerBar(total, page, pageSize);
    wirePager(page, total, pageSize, load);
  };
  $('#pc-go').onclick = () => load(1);
  $('#pc-csv').onclick = async () => {
    const p = params(); p.set('page', 1); p.set('pageSize', 200);
    const { rows, total } = await api('/tours?' + p.toString());
    if (!rows.length) { alert('查無資料可匯出'); return; }
    if (total > rows.length) alert(`資料共 ${total} 筆，匯出前 ${rows.length} 筆；如需完整請縮小日期範圍。`);
    downloadCsv(`潛在客戶資料_${todayStr()}.csv`,
      ['媽媽姓名', '預產期', '預約參觀日', '聯繫日期', '狀態', '聯絡電話', '備註', '建檔人'], rows.map(rowToArr));
  };
  load(1);
}

// 2. 預約參觀報名資料
async function viewTourSignups() {
  const canWrite = canAccess('#/tours');
  main().innerHTML = `
    <div class="page-title">預約參觀報名資料</div>
    <div class="card no-print">
      <div class="sec-hd">預約參觀報名資料（資料查詢）</div>
      ${tourQueryForm('ts', { fromDefault: todayStr(), toDefault: todayStr() })}
      <div class="row" style="gap:10px;justify-content:center;margin-top:8px">
        <button class="btn" id="ts-go">送出查詢</button>
        <a class="btn secondary" href="#/tour-calendar">預約參觀行事曆</a>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">預約參觀報名資料（查詢結果）</div>
      <div class="table-wrap" id="ts-result"></div>
      <div id="ts-pager"></div>
    </div>`;
  let current = [], curPage = 1;
  const load = async (page = 1) => {
    curPage = page;
    const p = tourQueryParams('ts'); p.set('page', page); p.set('pageSize', PAGE_SIZE);
    const { rows, total, pageSize } = await api('/tours?' + p.toString());
    current = rows;
    const base = (page - 1) * pageSize;
    $('#ts-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>參觀日期-時段</th><th>媽媽姓名</th><th>預產期-胎次</th><th>聯絡電話</th><th>填寫日期<br>訊息來源</th><th>是否出席</th><th>建檔人/日期</th><th class="no-print">列印</th></tr></thead>
      <tbody>${rows.map((t, i) => `
        <tr>
          <td data-label="筆數">${base + i + 1}</td>
          <td data-label="參觀日期-時段">${esc((t.tour_at || '').slice(0, 10))}<br><small>${esc((t.tour_at || '').slice(11, 16))}</small></td>
          <td data-label="媽媽姓名">${esc(t.name)}</td>
          <td data-label="預產期-胎次">${esc(t.due_date || '—')}${t.parity ? `<br><small>${esc(t.parity)}</small>` : ''}</td>
          <td data-label="聯絡電話">${esc(t.phone || '—')}</td>
          <td data-label="填寫日期/來源"><small>${esc((t.created_at || '').slice(0, 10))}<br>${esc(t.source || '—')}</small></td>
          <td data-label="是否出席">${t.attended === '是' ? '<span class="badge green">出席</span>' : t.attended === '否' ? '<span class="badge gray">未到</span>' : '—'}
            ${canWrite ? `<div class="row no-print" style="gap:4px;margin-top:4px"><button class="btn small secondary" data-att="是" data-id="${t.id}">出席</button><button class="btn small secondary" data-att="否" data-id="${t.id}">未到</button></div>` : ''}</td>
          <td data-label="建檔人/日期"><small>${esc(t.created_by_name || '—')}<br>${esc((t.created_at || '').slice(0, 16))}</small></td>
          <td data-label="" class="no-print"><button class="btn small secondary" data-print="${t.id}">列印</button></td>
        </tr>`).join('') || '<tr><td colspan="9"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
    $('#ts-result').querySelectorAll('[data-att]').forEach(b => b.onclick = async () => {
      await api(`/tours/${b.dataset.id}`, { method: 'PUT', body: { attended: b.dataset.att } });
      load(curPage);
    });
    $('#ts-result').querySelectorAll('[data-print]').forEach(b => b.onclick = () => printTourSignup(current.find(x => x.id == b.dataset.print)));
    $('#ts-pager').innerHTML = pagerBar(total, page, pageSize);
    wirePager(page, total, pageSize, load);
  };
  $('#ts-go').onclick = () => load(1);
  load(1);
}
function printTourSignup(t) {
  if (!t) return;
  const w = window.open('', '_blank', 'width=520,height=640');
  if (!w) { alert('請允許彈出視窗以進行列印'); return; }
  const row = (k, v) => `<tr><th style="text-align:left;padding:6px 12px;background:#f4f7f4;white-space:nowrap">${k}</th><td style="padding:6px 12px">${escHtml(v || '—')}</td></tr>`;
  w.document.write(`<html><head><meta charset="utf-8"><title>預約參觀報名單</title></head>
    <body style="font-family:sans-serif;padding:24px;color:#222">
      <h2 style="text-align:center">預約參觀報名單</h2>
      <table style="border-collapse:collapse;width:100%;border:1px solid #ccc">
        ${row('媽媽姓名', t.name)}${row('聯絡電話', t.phone)}${row('參觀日期-時段', (t.tour_at || '').slice(0, 16))}
        ${row('預產期', t.due_date)}${row('胎次', t.parity)}${row('訊息來源', t.source)}
        ${row('是否出席', t.attended)}${row('建檔人', t.created_by_name)}${row('備註', t.note)}
      </table>
      <p style="margin-top:24px;color:#888;font-size:12px;text-align:right">列印時間：${new Date().toLocaleString('sv-SE').slice(0, 16)}</p>
    </body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// 3. 未參觀查詢（取消預約明細）
async function viewTourCancellations() {
  const [mf, mt] = monthBounds();
  main().innerHTML = `
    <div class="page-title">未參觀查詢</div>
    <div class="card no-print">
      <div class="sec-hd">未參觀查詢（資料查詢）</div>
      ${tourQueryForm('tc', { fromDefault: mf, toDefault: mt, withName: false })}
      <div class="row" style="justify-content:center;margin-top:8px"><button class="btn" id="tc-go">送出查詢</button></div>
    </div>
    <div class="card">
      <div class="sec-hd">未參觀查詢（查詢結果）</div>
      <div class="row no-print" style="justify-content:flex-end;margin-bottom:6px"><button class="btn small" id="tc-csv">匯出 Excel（CSV）</button></div>
      <div class="table-wrap" id="tc-result"></div>
      <div id="tc-pager"></div>
    </div>`;
  const rowToArr = t => [t.name, t.phone || '', (t.tour_at || '').slice(0, 16), t.due_date || '', (t.created_at || '').slice(0, 10), t.cancel_at || '', t.cancel_reason || '', t.cancel_by_name || ''];
  const load = async (page = 1) => {
    const p = tourQueryParams('tc', { withName: false, onlyCancelled: true }); p.set('page', page); p.set('pageSize', PAGE_SIZE);
    const { rows, total, pageSize } = await api('/tours?' + p.toString());
    const base = (page - 1) * pageSize;
    $('#tc-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>媽媽姓名</th><th>聯絡電話</th><th>原預約日期<br>時段</th><th>預產期<br>報名日期</th><th>取消時間</th><th>取消原因</th><th>取消人</th></tr></thead>
      <tbody>${rows.map((t, i) => `
        <tr>
          <td data-label="筆數">${base + i + 1}</td>
          <td data-label="媽媽姓名">${esc(t.name)}</td>
          <td data-label="聯絡電話">${esc(t.phone || '—')}</td>
          <td data-label="原預約日期/時段">${esc((t.tour_at || '').slice(0, 10))}<br><small>${esc((t.tour_at || '').slice(11, 16))}</small></td>
          <td data-label="預產期/報名日期"><small>${esc(t.due_date || '—')}<br>${esc((t.created_at || '').slice(0, 10))}</small></td>
          <td data-label="取消時間">${esc(t.cancel_at || '—')}</td>
          <td data-label="取消原因">${esc(t.cancel_reason || '—')}</td>
          <td data-label="取消人">${esc(t.cancel_by_name || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="8"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
    $('#tc-pager').innerHTML = pagerBar(total, page, pageSize);
    wirePager(page, total, pageSize, load);
  };
  $('#tc-go').onclick = () => load(1);
  $('#tc-csv').onclick = async () => {
    const p = tourQueryParams('tc', { withName: false, onlyCancelled: true }); p.set('page', 1); p.set('pageSize', 200);
    const { rows, total } = await api('/tours?' + p.toString());
    if (!rows.length) { alert('查無資料可匯出'); return; }
    if (total > rows.length) alert(`資料共 ${total} 筆，匯出前 ${rows.length} 筆；如需完整請縮小日期範圍。`);
    downloadCsv(`未參觀查詢_${todayStr()}.csv`,
      ['媽媽姓名', '聯絡電話', '原預約時段', '預產期', '報名日期', '取消時間', '取消原因', '取消人'], rows.map(rowToArr));
  };
  load(1);
}

// 3b. 未成交查詢（狀態＝未成交的參觀）
async function viewTourLost() {
  const [mf, mt] = monthBounds();
  main().innerHTML = `
    <div class="page-title">未成交查詢</div>
    <div class="card no-print">
      <div class="sec-hd">未成交查詢（資料查詢）</div>
      ${tourQueryForm('tl', { fromDefault: mf, toDefault: mt })}
      <div class="row" style="justify-content:center;margin-top:8px"><button class="btn" id="tl-go">送出查詢</button></div>
    </div>
    <div class="card">
      <div class="sec-hd">未成交查詢（查詢結果）</div>
      <div class="row no-print" style="justify-content:flex-end;margin-bottom:6px"><button class="btn small" id="tl-csv">匯出 Excel（CSV）</button></div>
      <div class="table-wrap" id="tl-result"></div>
      <div id="tl-pager"></div>
    </div>`;
  const rowToArr = t => [t.name, t.phone || '', (t.tour_at || '').slice(0, 16), t.due_date || '', t.source || '', t.last_log || '', (t.last_log_at || '').slice(0, 16)];
  const params = () => { const p = tourQueryParams('tl'); p.set('status', 'lost'); return p; };
  const load = async (page = 1) => {
    const p = params(); p.set('page', page); p.set('pageSize', PAGE_SIZE);
    const { rows, total, pageSize } = await api('/tours?' + p.toString());
    const base = (page - 1) * pageSize;
    $('#tl-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>媽媽姓名</th><th>聯絡電話</th><th>參觀日期<br>時段</th><th>預產期</th><th>來源</th><th>最後追蹤</th></tr></thead>
      <tbody>${rows.map((t, i) => `
        <tr>
          <td data-label="筆數">${base + i + 1}</td>
          <td data-label="媽媽姓名">${esc(t.name)}</td>
          <td data-label="聯絡電話">${esc(t.phone || '—')}</td>
          <td data-label="參觀日期/時段">${esc((t.tour_at || '').slice(0, 10))}<br><small>${esc((t.tour_at || '').slice(11, 16))}</small></td>
          <td data-label="預產期">${esc(t.due_date || '—')}</td>
          <td data-label="來源">${esc(t.source || '—')}</td>
          <td data-label="最後追蹤"><small>${t.last_log ? `${esc(t.last_log)}<br>${esc((t.last_log_at || '').slice(0, 16))}` : '—'}</small></td>
        </tr>`).join('') || '<tr><td colspan="7"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
    $('#tl-pager').innerHTML = pagerBar(total, page, pageSize);
    wirePager(page, total, pageSize, load);
  };
  $('#tl-go').onclick = () => load(1);
  $('#tl-csv').onclick = async () => {
    const p = params(); p.set('page', 1); p.set('pageSize', 200);
    const { rows, total } = await api('/tours?' + p.toString());
    if (!rows.length) { alert('查無資料可匯出'); return; }
    if (total > rows.length) alert(`資料共 ${total} 筆，匯出前 ${rows.length} 筆；如需完整請縮小日期範圍。`);
    downloadCsv(`未成交查詢_${todayStr()}.csv`,
      ['媽媽姓名', '聯絡電話', '參觀時段', '預產期', '來源', '最後追蹤', '追蹤時間'], rows.map(rowToArr));
  };
  load(1);
}

// 合約金額增加／減少查詢（由合約明細異動 LOG 判讀第一次 vs 最新合約金額）
async function viewContractAmountChanges(dir) {
  const label = dir === 'down' ? '減少' : '增加';
  const title = `合約金額${label}查詢`;
  const monthStart = todayStr().slice(0, 8) + '01';
  const dEnd = new Date(todayStr().slice(0, 7) + '-01');
  dEnd.setMonth(dEnd.getMonth() + 1); dEnd.setDate(0);
  // 日期欄位條件依住房篩選連動：未入住＝預定入住日/簽約日/預產期；已入住＝實際入住日/簽約日
  const DF_BY_STAY = {
    not_in: [['checkin', '以入住日期查詢'], ['sign', '以簽約日期查詢'], ['due', '以預產期查詢']],
    in: [['checkin', '以入住日期查詢'], ['sign', '以簽約日期查詢']]
  };
  main().innerHTML = `
    <div class="page-title">${title}</div>
    <div class="card no-print">
      <div class="sec-hd">${title}（資料查詢）</div>
      <div class="form-grid">
        <div class="field"><label>查詢日期區間</label>
          <div class="row" style="gap:6px;align-items:center">
            <input type="date" id="ca-from" value="${monthStart}"> <span>to</span> <input type="date" id="ca-to" value="${dEnd.toISOString().slice(0, 10)}">
          </div></div>
        <div class="field"><label>篩選條件（只能擇一）</label>
          <div class="row" style="gap:12px;padding-top:8px;flex-wrap:wrap">
            <label class="bna-chk"><input type="radio" name="ca-stay" value="not_in" checked> 未入住</label>
            <label class="bna-chk"><input type="radio" name="ca-stay" value="in"> 已入住</label>
          </div></div>
        <div class="field full"><label>日期欄位條件</label>
          <div class="row" style="gap:12px;padding-top:6px;flex-wrap:wrap" id="ca-df-box"></div></div>
        <div class="field"><label>媽媽姓名</label><input id="ca-name"></div>
        <div class="field"><label>其他關鍵字查詢</label>
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
            <input id="ca-kw" style="max-width:180px">
            ${[['contract', '合約編號'], ['idno', '身分證號'], ['phone', '連絡電話']].map(([k, l], i) =>
              `<label class="bna-chk"><input type="radio" name="ca-kt" value="${k}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}
          </div></div>
        <div class="full row" style="gap:10px;justify-content:center">
          <button class="btn" id="ca-go">送出查詢</button>
          <span class="error-msg" id="ca-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="row between no-print" style="flex-wrap:wrap;gap:8px">
        <div class="sec-hd" style="flex:1;min-width:200px">${title}（查詢結果）</div>
        <a class="btn small" id="ca-xlsx" href="javascript:void 0" style="background:#2fb6e8">匯出Excel</a>
      </div>
      <div id="ca-result"><div class="empty">請設定條件後送出查詢</div></div>
    </div>`;
  const stayVal = () => main().querySelector('input[name="ca-stay"]:checked').value;
  const renderDf = () => {
    $('#ca-df-box').innerHTML = DF_BY_STAY[stayVal()].map(([v, l], i) =>
      `<label class="bna-chk"><input type="radio" name="ca-df" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('');
  };
  main().querySelectorAll('input[name="ca-stay"]').forEach(r => r.onchange = renderDf);
  renderDf();
  const qs = () => {
    const p = new URLSearchParams({ dir, stay: stayVal() });
    const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
    if (v('#ca-from')) p.set('from', v('#ca-from'));
    if (v('#ca-to')) p.set('to', v('#ca-to'));
    p.set('date_field', main().querySelector('input[name="ca-df"]:checked').value);
    if (v('#ca-name')) p.set('name', v('#ca-name'));
    if (v('#ca-kw')) { p.set('keyword', v('#ca-kw')); p.set('keyword_type', main().querySelector('input[name="ca-kt"]:checked').value); }
    return p;
  };
  const run = async () => {
    $('#ca-err').textContent = '';
    try {
      const { rows, stay } = await api(`/contract-amount-changes?${qs()}`);
      const isIn = stay === 'in';
      const sumDiff = rows.reduce((s, r) => s + (r.diff || 0), 0);
      $('#ca-result').innerHTML = rows.length ? `
        <div class="table-wrap"><table class="data stack">
          <thead><tr><th>筆數</th><th>媽媽姓名<br>手機／生日</th><th>預產期</th><th>${isIn ? '實際' : '預定'}入住日<br>${isIn ? '實際' : '預定'}出住日</th><th>天數</th><th>房型<br>贈品內容</th><th>舊合約總額</th><th>${isIn ? '實際' : '新'}合約總額</th><th>差異總額</th><th>合約號碼<br>經手人</th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr>
              <td data-label="筆數">${i + 1}</td>
              <td data-label="媽媽姓名">${esc(r.mother_name)}<br><small>${esc(r.phone || '—')}／${esc(r.birth_date || '—')}</small></td>
              <td data-label="預產期">${esc(r.due_date || '—')}</td>
              <td data-label="入住/出住"><small>${esc((isIn ? r.actual_check_in : r.expected_check_in) || '—')}<br>${esc((isIn ? r.actual_check_out : r.expected_check_out) || '—')}</small></td>
              <td data-label="天數">${r.days || 0}</td>
              <td data-label="房型/贈品"><small>${esc(r.room_types || '—')}${r.gift_content ? `<br>${esc(r.gift_content)}` : ''}</small></td>
              <td data-label="舊合約總額">$${(r.first_amount || 0).toLocaleString()}<br><small>${esc(r.first_date)}</small></td>
              <td data-label="${isIn ? '實際' : '新'}合約總額">$${(r.latest_amount || 0).toLocaleString()}</td>
              <td data-label="差異總額"><strong style="color:${dir === 'down' ? 'var(--danger)' : 'var(--primary-dark)'}">${r.diff > 0 ? '+' : '−'}$${Math.abs(r.diff || 0).toLocaleString()}</strong></td>
              <td data-label="合約號碼/經手人"><a href="#/customers?m=${r.mother_id}">${esc(r.contract_no)}</a><br><small>${esc(r.handler || '—')}</small></td>
            </tr>`).join('')}
            <tr style="background:#fbeaea"><td colspan="8" style="text-align:right">差異合計：</td>
              <td><strong>${sumDiff > 0 ? '+' : '−'}$${Math.abs(sumDiff).toLocaleString()}</strong></td><td></td></tr>
          </tbody>
        </table></div>
        <small style="color:var(--muted)">舊合約總額＝簽約首日建檔完成金額（依合約明細異動 LOG）；${isIn ? '實際' : '新'}合約總額＝最新合約明細合計。</small>`
        : '<div class="empty">搜尋結果無資料…</div>';
    } catch (e) { $('#ca-err').textContent = e.message; }
  };
  $('#ca-go').onclick = run;
  $('#ca-xlsx').onclick = () => { location.href = `/api/contract-amount-changes?${qs()}&format=xlsx`; };
  run();
}

// 4. 預約參觀時段設定
async function viewTourSlots() {
  const canWrite = currentUser.role === 'admin';
  const [s, slots] = await Promise.all([api('/settings'), api('/tour-slots')]);
  const [mf, mt] = monthBounds();
  const dis = canWrite ? '' : 'disabled';
  main().innerHTML = `
    <div class="page-title">預約參觀時段設定</div>
    <div class="card">
      <div class="sec-hd">預約參觀時段設定</div>
      <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
        一般開放參觀時間：從 <input type="time" id="tsl-from" value="${esc(s.tour_open_from || '11:00')}" ${dis}>
        ~ <input type="time" id="tsl-to" value="${esc(s.tour_open_to || '19:00')}" ${dis}>
        ，每 <input type="number" min="5" step="5" id="tsl-min" value="${esc(s.tour_slot_minutes || '60')}" style="width:80px" ${dis}> 分鐘，
        開放 <input type="number" min="1" id="tsl-cap" value="${esc(s.tour_visit_limit || '1')}" style="width:70px" ${dis}> 人預約
        ${canWrite ? '<button class="btn small" id="tsl-save">資料存檔</button>' : ''}
        <span class="error-msg" id="tsl-err"></span>
      </div>
    </div>
    <div class="card no-print">
      <div class="sec-hd">指定日期參觀時段設定（資料查詢）</div>
      <div class="form-grid">
        <div class="field"><label>查詢日期區間</label>
          <div class="row" style="gap:6px;align-items:center"><input type="date" id="tsl-qf" value="${mf}"><span>to</span><input type="date" id="tsl-qt" value="${mt}"></div></div>
        <div class="full row" style="gap:10px;justify-content:center">
          <button class="btn" id="tsl-go">送出查詢</button>
          ${canWrite ? '<button class="btn secondary" id="tsl-add">資料新增</button>' : ''}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">指定日期參觀時段設定（查詢結果）</div>
      <div class="row no-print" style="justify-content:flex-end;margin-bottom:6px"><button class="btn small" id="tsl-csv">匯出 Excel（CSV）</button></div>
      <div class="table-wrap" id="tsl-result"></div>
    </div>`;
  let all = slots.slice();
  let current = [];
  const render = (list) => {
    current = list;
    $('#tsl-result').innerHTML = `<table class="data stack">
      <thead><tr><th>筆數</th><th>不開放參觀日期</th><th>指定日期</th><th>開放時段</th><th>每時段開放人數</th><th>建檔人</th><th class="no-print"></th></tr></thead>
      <tbody>${list.map((r, i) => `
        <tr>
          <td data-label="筆數">${i + 1}</td>
          <td data-label="不開放參觀日期">${r.closed ? esc(r.slot_date) : '—'}</td>
          <td data-label="指定日期">${r.closed ? '—' : esc(r.slot_date)}</td>
          <td data-label="開放時段">${r.closed ? '—' : `${esc(r.open_from || '')}~${esc(r.open_to || '')}（每 ${r.slot_minutes} 分）`}</td>
          <td data-label="每時段開放人數">${r.closed ? '—' : r.capacity}</td>
          <td data-label="建檔人">${esc(r.created_by_name || '—')}</td>
          <td data-label="" class="no-print">${canWrite ? `<button class="btn small danger" data-del="${r.id}">刪</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="7"><div class="empty">您輸入的條件，查無資料 …</div></td></tr>'}</tbody></table>`;
    $('#tsl-result').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('確定刪除此時段設定？')) return;
      await api(`/tour-slots/${b.dataset.del}`, { method: 'DELETE' });
      all = all.filter(x => x.id != b.dataset.del); go();
    });
  };
  const go = () => {
    const f = $('#tsl-qf').value, t = $('#tsl-qt').value;
    render(all.filter(r => (!f || r.slot_date >= f) && (!t || r.slot_date <= t)));
  };
  $('#tsl-go').onclick = go;
  $('#tsl-csv').onclick = () => {
    if (!current.length) { alert('查無資料可匯出'); return; }
    downloadCsv(`參觀時段設定_${todayStr()}.csv`,
      ['指定日期', '不開放', '開放時段起', '開放時段迄', '每時段分鐘', '每時段人數', '建檔人'],
      current.map(r => [r.slot_date, r.closed ? 'V' : '', r.open_from || '', r.open_to || '', r.slot_minutes, r.closed ? '' : r.capacity, r.created_by_name || '']));
  };
  render(all.filter(r => (!mf || r.slot_date >= mf) && (!mt || r.slot_date <= mt)));
  if (!canWrite) return;
  $('#tsl-save').onclick = async () => {
    try {
      await api('/settings', { method: 'PUT', body: { tour_open_from: $('#tsl-from').value, tour_open_to: $('#tsl-to').value, tour_slot_minutes: $('#tsl-min').value, tour_visit_limit: $('#tsl-cap').value } });
      $('#tsl-save').textContent = '已存檔 ✓';
      setTimeout(() => { const b = $('#tsl-save'); if (b) b.textContent = '資料存檔'; }, 1500);
    } catch (e) { $('#tsl-err').textContent = e.message; }
  };
  $('#tsl-add').onclick = () => {
    openModal('新增指定日期時段', `
      <div class="field"><label>指定日期 <b class="req">*</b></label><input type="date" id="sl-date"></div>
      <div class="field"><label><input type="checkbox" id="sl-closed"> 此日不開放參觀</label></div>
      <div id="sl-open">
        <div class="field"><label>開放時段（起）</label><input type="time" id="sl-from" value="${esc(s.tour_open_from || '11:00')}"></div>
        <div class="field"><label>開放時段（迄）</label><input type="time" id="sl-to" value="${esc(s.tour_open_to || '19:00')}"></div>
        <div class="field"><label>每時段分鐘</label><input type="number" min="5" step="5" id="sl-min" value="${esc(s.tour_slot_minutes || '60')}"></div>
        <div class="field"><label>每時段開放人數</label><input type="number" min="1" id="sl-cap" value="${esc(s.tour_visit_limit || '1')}"></div>
      </div>
      <div class="row mt"><button class="btn" id="sl-save">存檔</button><span class="error-msg" id="sl-err"></span></div>`, body => {
      const openBox = body.querySelector('#sl-open');
      body.querySelector('#sl-closed').onchange = e => { openBox.style.display = e.target.checked ? 'none' : ''; };
      body.querySelector('#sl-save').onclick = async () => {
        const closed = body.querySelector('#sl-closed').checked;
        const payload = { slot_date: body.querySelector('#sl-date').value, closed,
          open_from: body.querySelector('#sl-from').value, open_to: body.querySelector('#sl-to').value,
          slot_minutes: body.querySelector('#sl-min').value, capacity: body.querySelector('#sl-cap').value };
        if (!payload.slot_date) { body.querySelector('#sl-err').textContent = '請選擇指定日期'; return; }
        try {
          const r = await api('/tour-slots', { method: 'POST', body: payload });
          all.push({ id: r.id, ...payload, closed: closed ? 1 : 0, slot_minutes: Number(payload.slot_minutes) || 60, capacity: Number(payload.capacity) || 1, created_by_name: currentUser.name });
          closeModal(); go();
        } catch (e) { body.querySelector('#sl-err').textContent = e.message; }
      };
    });
  };
}

/* ---------- 產後系統其他設定：媽媽憂鬱量表樣版（愛丁堡 EPDS 標準樣版） ---------- */
function viewEpdsTemplate() {
  const rows = [];
  EPDS_ITEMS.forEach(([q, opts], qi) => {
    opts.forEach(([opt, score]) => rows.push({ order: qi + 1, q, opt, score }));
  });
  main().innerHTML = `
    <div class="page-title">媽媽憂鬱量表樣版 <small style="font-weight:400;color:var(--muted);font-size:.9rem">愛丁堡產後憂鬱量表 EPDS 標準樣版</small></div>
    <div class="card no-print">
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <a class="btn small secondary" href="#/mother-nursing">回媽媽護理</a>
        <button class="btn small secondary" id="ep-print">資料列印</button>
      </div>
      <small style="color:var(--muted)">＊本樣版為標準愛丁堡憂鬱量表（10 題，每題 4 選項，計分 0～3），供「媽媽護理→愛丁堡憂鬱量表」填寫；為維持評分一致性採固定樣版。</small>
    </div>
    <div class="card">
      <div class="sec-hd">量表樣版（${rows.length} 筆＝10 題 × 4 選項）</div>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>筆數</th><th>問題順序</th><th>問題種類說明文字</th><th>答案選項</th><th>問題型態</th><th>答案選項分數</th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr>
              <td data-label="筆數">${i + 1}</td>
              <td data-label="問題順序">${r.order}</td>
              <td data-label="問題種類說明文字">${esc(r.q)}</td>
              <td data-label="答案選項">${esc(r.opt)}</td>
              <td data-label="問題型態">單選</td>
              <td data-label="答案選項分數">${r.score}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
  $('#ep-print').onclick = () => window.print();
}

/* ---------- 產後嬰兒結案 ---------- */
async function viewBabyClosure() {
  const list = await api('/room-status/babies');
  const babies = list.babies;
  if (!babies.length) {
    main().innerHTML = '<div class="page-title">產後嬰兒結案</div><div class="card"><div class="empty">目前沒有在住寶寶</div></div>';
    return;
  }
  const want = Number((location.hash.split('?b=')[1] || '').split('&')[0]);
  const babyId = babies.some(b => b.id === want) ? want : babies[0].id;
  const { baby, closure, summary, options } = await api(`/babies/${babyId}/closure`);
  const d = (closure && closure.data) || {};
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 實際入住天數：入住日 → 結案日（未結案則今日）
  const endDate = closure ? closure.close_date : todayStr();
  const stayDays = summary.checkin_date
    ? Math.max(1, Math.round((new Date(endDate) - new Date(summary.checkin_date)) / 86400000) + 1) : null;
  // 體重增減：結案體重（未填則最新體重）vs 出生體重
  const wNow = d.weight_g ?? (summary.weight_now && summary.weight_now.value);
  const wPct = (wNow && baby.birth_weight_g > 0)
    ? (((wNow - baby.birth_weight_g) / baby.birth_weight_g) * 100).toFixed(2) : null;

  const hv = (label, val) => `<span style="min-width:230px"><b>${label}：</b>${val}</span>`;
  const sel = (id, opts, val, req = true) =>
    `<select id="${id}" ${req ? 'data-req' : ''}><option value="">請選擇</option>${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;

  main().innerHTML = `
    <div class="page-title">產後嬰兒結案</div>
    <div class="card no-print">
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="max-width:240px;margin:0"><label>選擇寶寶</label>
          <select id="bcl-baby">${babies.map(b => `<option value="${b.id}" ${b.id === babyId ? 'selected' : ''}>${esc(b.name)}（${esc(b.mother_name)}${b.room_name ? `／${esc(b.room_name)}` : ''}）${b.closed ? '（已結案）' : ''}</option>`).join('')}</select></div>
        <a class="btn small secondary" href="#/baby-rooms">回寶寶房況</a>
        <button class="btn small secondary" id="bcl-print">資料列印</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-hd">住期摘要 ${closure ? '<span class="badge gray" style="float:right">已結案</span>' : '<span class="badge yellow" style="float:right">未結案</span>'}</div>
      <div class="row" style="gap:8px 18px;flex-wrap:wrap;font-size:.93rem;line-height:1.9">
        ${hv('媽媽姓名', `${baby.room_name ? esc(baby.room_name) + '　' : ''}${esc(baby.mother_name)}`)}
        ${hv('寶寶', `${esc(baby.name)}${baby.gender ? `（${baby.gender === 'male' ? '男' : '女'}）` : ''}`)}
        ${hv('出生日期', esc(baby.birth_date || '—'))}
        ${hv('入住日', esc(summary.checkin_date || '—'))}
        ${hv('媽媽預退日', esc(baby.mother_check_out || '—'))}
        ${hv('實際入住天數', stayDays != null ? `${stayDays} 天` : '—')}
        ${hv('出生體重', baby.birth_weight_g ? `${baby.birth_weight_g} gm` : '—')}
        ${hv('目前體重', summary.weight_now ? `${summary.weight_now.value} gm（${esc(summary.weight_now.at)}）` : '—')}
        ${hv('體重增減', wPct != null ? `<b style="color:${Number(wPct) < 0 ? 'var(--danger)' : 'var(--primary-dark)'}">${wPct} %</b>` : '—')}
        ${hv('目前黃疸值', summary.jaundice_now ? `${summary.jaundice_now.value} mg/dl（${esc(summary.jaundice_now.at)}）` : '—')}
        ${hv('臍帶（最近護理評估）', esc(summary.cord_last || '—'))}
        ${hv('BCG', esc(summary.bcg_date || '—'))}
        ${hv('B肝疫苗', esc(summary.hbv_date || '—'))}
        ${hv('HBIG', esc(summary.hbig_date || '—'))}
        ${closure ? hv('結案人員', `${esc(closure.nurse_name || '—')}（${esc(closure.created_at.slice(0, 16))}）${closure.edited_at ? `，最後修改 ${esc(closure.edited_at.slice(0, 16))}（${esc(closure.edited_by_name || '')}）` : ''}`) : ''}
      </div>
    </div>
    <div class="card" id="bcl-form">
      <div class="sec-hd">產後嬰兒結案單（<b>*</b> 為必填）</div>
      <div class="form-grid">
        <div class="field"><label>結案日期 <b class="req">*</b></label><input type="date" id="bcl-date" value="${esc(closure ? closure.close_date : todayStr())}"></div>
        <div class="field"><label>結案時間 <b class="req">*</b></label><input type="time" id="bcl-time" value="${esc(closure ? closure.close_time : hhmm)}"></div>
        <div class="field"><label>結案原因 <b class="req">*</b></label>${sel('bcl-reason', options.reasons, d.reason || '')}</div>
        <div class="field"><label>結案原因補述<small>（選「其他」時必填）</small></label><input id="bcl-reason-other" maxlength="100" value="${esc(d.reason_other || '')}"></div>
        <div class="field"><label>去向 <b class="req">*</b></label>${sel('bcl-dest', options.destinations, d.destination || '')}</div>
        <div class="field"><label>轉至院所名稱<small>（選「轉至醫療院所」時必填）</small></label><input id="bcl-hospital" maxlength="100" value="${esc(d.hospital || '')}"></div>
        <div class="field"><label>去向補述<small>（選「其他」時必填）</small></label><input id="bcl-dest-other" maxlength="100" value="${esc(d.destination_other || '')}"></div>
        <div class="field"><label>結案體重（gm）</label><input type="number" min="0" id="bcl-w" value="${esc(d.weight_g ?? (summary.weight_now ? summary.weight_now.value : ''))}"></div>
        <div class="field"><label>結案黃疸值（mg/dl）</label><input type="number" step="0.1" min="0" id="bcl-j" value="${esc(d.jaundice ?? '')}"></div>
        <div class="field"><label>臍帶狀態</label>${sel('bcl-cord', options.cords, d.cord || '', false)}</div>
        <div class="field"><label>臍帶補述<small>（選「其他」時必填）</small></label><input id="bcl-cord-other" maxlength="100" value="${esc(d.cord_other || '')}"></div>
        <div class="field"><label>結案時餵食方式</label>${sel('bcl-feed', options.feedings, d.feeding || '', false)}</div>
        <div class="field full"><label>衛教指導完成項目（多選）</label>
          <div class="row" style="gap:8px 14px;flex-wrap:wrap">${options.educations.map(o =>
            `<label class="bna-chk"><input type="checkbox" data-ck="bcl-edu" value="${esc(o)}" ${(d.educations || []).includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div></div>
        <div class="field full"><label>追蹤與轉介事項</label><textarea id="bcl-follow" maxlength="500" rows="2">${esc(d.follow_up || '')}</textarea></div>
        <div class="field full"><label>結案摘要<small>（限 600 字）</small></label><textarea id="bcl-note" maxlength="600" rows="3">${esc(closure ? closure.note : '')}</textarea></div>
        <div class="full row no-print" style="gap:10px">
          <button class="btn" id="bcl-save">${closure ? '更新結案' : '結案存檔'}</button>
          ${closure && currentUser.role === 'admin' ? '<button class="btn danger" id="bcl-reopen">解除結案</button>' : ''}
          <span class="error-msg" id="bcl-err"></span>
        </div>
      </div>
    </div>`;

  $('#bcl-baby').onchange = () => { location.hash = `#/baby-close?b=${$('#bcl-baby').value}`; };
  $('#bcl-print').onclick = () => window.print();

  const form = $('#bcl-form');
  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };

  $('#bcl-save').onclick = async () => {
    const err = $('#bcl-err');
    err.textContent = '';
    if (!v('#bcl-date') || !v('#bcl-time')) { err.textContent = '請填寫結案日期與時間'; return; }
    for (const el of form.querySelectorAll('[data-req]')) {
      if (!el.value) { err.textContent = '尚有必填欄位未選擇'; el.focus(); return; }
    }
    if (v('#bcl-reason') === '其他' && !v('#bcl-reason-other')) { err.textContent = '結案原因選「其他」時，補述必填'; return; }
    if (v('#bcl-dest') === '轉至醫療院所' && !v('#bcl-hospital')) { err.textContent = '去向選「轉至醫療院所」時，院所名稱必填'; return; }
    if (v('#bcl-dest') === '其他' && !v('#bcl-dest-other')) { err.textContent = '去向選「其他」時，補述必填'; return; }
    if (v('#bcl-cord') === '其他' && !v('#bcl-cord-other')) { err.textContent = '臍帶狀態選「其他」時，補述必填'; return; }
    if (!closure && !confirm(`確認為「${baby.name}」建立結案？結案後房況卡片會顯示已結案標記。`)) return;
    try {
      await api(`/babies/${babyId}/closure`, { method: 'PUT', body: {
        close_date: v('#bcl-date'), close_time: v('#bcl-time'),
        reason: v('#bcl-reason'), reason_other: v('#bcl-reason-other'),
        destination: v('#bcl-dest'), hospital: v('#bcl-hospital'), destination_other: v('#bcl-dest-other'),
        weight_g: v('#bcl-w'), jaundice: v('#bcl-j'),
        cord: v('#bcl-cord'), cord_other: v('#bcl-cord-other'), feeding: v('#bcl-feed'),
        educations: [...form.querySelectorAll('[data-ck="bcl-edu"]:checked')].map(c => c.value),
        follow_up: v('#bcl-follow'), note: v('#bcl-note')
      } });
      viewBabyClosure();
    } catch (e) { err.textContent = e.message; }
  };

  const reopen = $('#bcl-reopen');
  if (reopen) reopen.onclick = async () => {
    if (!confirm('確定解除結案？結案單內容將刪除（會記入稽核軌跡）。')) return;
    await api(`/baby-closures/${babyId}`, { method: 'DELETE' });
    viewBabyClosure();
  };
}

/* ---------- 母乳哺育評估表（BREAST 觀察評估） ---------- */
// 每列＝一組「有效餵奶表現｜可能有餵食問題表現」單選；__MIN__／__STOOLNOTE__ 為列內附加輸入框
const BFA_SECTIONS = [
  { key: 'p', title: '1.BREAST觀察評估<br>1-1身體姿勢<br><small>(Body position)</small>', rows: [
    ['媽媽放鬆自然', '肩膀僵硬，身體傾向新生兒'],
    ['新生兒身體緊貼媽媽，臉朝向乳房', '新生兒身體離開媽媽'],
    ['新生兒頭部及身體呈一直線', '新生兒頸部扭轉'],
    ['新生兒下巴貼著乳房', '新生兒下巴沒有貼著乳房'],
    ['新生兒臀部受到支撐', '只有托住頭和肩膀']
  ] },
  { key: 'r', title: '1-2反應<br><small>(Responses)</small>', rows: [
    ['饑餓時新生兒會朝向乳房', '對乳房無反應'],
    ['新生兒會尋找乳房', '看不到尋覓反應'],
    ['新生兒以舌頭探索乳房', '新生兒對乳房無興趣'],
    ['新生兒接觸乳房時平靜而清醒', '新生兒哭鬧或煩燥'],
    ['新生兒持續含住乳房', '新生兒放開乳房'],
    ['噴乳的表現（漏奶、子宮收縮）', '無噴乳的表現']
  ] },
  { key: 'e', title: '1-3母嬰情感連結<br><small>(Emotional bonding)</small>', rows: [
    ['穩定且有自信的撫抱', '神經質或無力的撫抱'],
    ['母親臉對臉的注視', '沒有母子眼神的接觸'],
    ['母親給予很多的撫摸', '搖晃或重拍新生兒']
  ] },
  { key: 'a', title: '1-4乳房的生理變化<br><small>(Anatomy)</small>', rows: [
    ['餵奶後乳房變軟', '乳房腫脹'],
    ['餵奶後乳頭突出，有彈性', '餵奶後乳頭仍平或凹陷'],
    ['乳房皮膚看起來很健康', '乳房皮膚發紅或有皺摺'],
    ['餵奶時乳房看起來圓圓的', '乳房看起來被拉扯的樣子'],
    ['乳頭皮膚完整、乳頭不痛', '乳頭破皮、乳頭酸痛（有明顯壓痕）']
  ] },
  { key: 's', title: '1-5含乳與吸吮<br><small>(Suckling)</small>', rows: [
    ['嘴巴張大', '嘴巴張不夠大，嘴巴噘起'],
    ['下唇外翻', '下唇內翻'],
    ['舌頭繞著乳房', '看不到舌頭'],
    ['兩頰圓鼓', '兩頰凹入'],
    ['新生兒嘴巴上方乳暈較多', '新生兒嘴巴下方之乳暈較多'],
    ['慢慢的深吸奶一陣子後變慢且有短暫休息', '只有快速地吸奶'],
    ['可看到或聽到吞嚥，吞嚥是緩慢的', '吸吮時發出聲音，可聽到啪吋聲']
  ] },
  { key: 't', title: '1-6含乳時間<br><small>(Time spent suckling)</small>', rows: [
    ['新生兒自己鬆開乳房，吸 __MIN__ 分鐘', '媽媽將新生兒抱離開乳房']
  ] },
  { key: 'n', title: '2.新生兒外觀', rows: [
    ['膚色正常', '黃疸未改善或惡化'],
    ['覺醒', '嗜睡，喝奶時沒醒'],
    ['肌肉張力正常(活力佳)', '肌肉張力不佳']
  ] },
  { key: 'u', title: '3.小便', rows: [['5-6次以上/24小時', '少於5次/24小時']] },
  { key: 'st', title: '4.大便', rows: [
    ['外觀正常,黃色,軟的(至少硬幣大小,水份多的)', '外觀不正常 __STOOLNOTE__'],
    ['2次以上/24小時', '少於2次/24小時']
  ] },
  { key: 'w', title: '5.體重', rows: [['體重減輕少於10%', '體重減輕大於10%']] },
  { key: 'f', title: '6.餵食次數', rows: [['8次以上/24小時', '少於8次/24小時']] },
  { key: 'fr', title: '7.餵食時新生兒反應', rows: [['冷靜且放鬆的', '頻繁吸奶,或是拒絕親餵']] },
  { key: 'ft', title: '8.餵食時間', rows: [['超過5-30分鐘', '寶寶持續吸吮時間少於5分鐘或是多於40分鐘']] },
  { key: 'bi', title: '9.是否雙邊親餵', rows: [['依據寶寶的食量雙邊親餵', '媽媽限制寶寶一次只喝單邊或是不論寶寶需求每次都餵雙邊']] },
  { key: 'ab', title: '10.餵食後新生兒行為', rows: [['寶寶獲得滿足', '餵完後寶寶情緒不穩定']] }
];
const BFA_FEED_TYPES = ['純母乳', '混合哺餵', '配方奶'];
const BFA_USE_ITEMS = ['奶嘴', '乳頭罩', '配方奶'];
const BFA_USE_REASONS = ['難照顧', '寶寶體重沒增加', '寶寶情緒不穩定', '其他'];

function bfaCell(name, val, text) {
  // __MIN__／__STOOLNOTE__ 置換為列內小輸入框（點擊輸入框同時視為選取該側，符合填寫情境）
  const html = esc(text)
    .replace('__MIN__', `<input type="number" min="0" id="bfa-min" style="width:70px;display:inline-block;padding:4px 6px;min-height:0">`)
    .replace('__STOOLNOTE__', `<input id="bfa-stoolnote" maxlength="50" style="max-width:150px;display:inline-block;padding:4px 6px;min-height:0">`);
  return `<td><label class="bfa-opt"><input type="radio" name="${name}" value="${val}"><span>${html}</span></label></td>`;
}

async function viewBreastfeeding() {
  const want = Number((location.hash.split('?b=')[1] || '').split('&')[0]);
  if (!want) { location.hash = '#/baby-nursing'; return; }
  const { baby, rows, reminder, prefill } = await api(`/babies/${want}/breastfeeding`);
  const pre = prefill || {};
  const ageDays = baby.birth_date ? Math.round((new Date(todayStr()) - new Date(baby.birth_date)) / 86400000) : '';

  const sectionRows = BFA_SECTIONS.map(sec => sec.rows.map((r, i) => `
    <tr>
      ${i === 0 ? `<th class="bfa-sec" rowspan="${sec.rows.length}">${sec.title}</th>` : ''}
      ${bfaCell(`bfa-${sec.key}${i}`, 'L', r[0])}
      ${bfaCell(`bfa-${sec.key}${i}`, 'R', r[1])}
    </tr>`).join('')).join('');

  const histRows = rows.map(r => {
    const marks = Object.values((r.items && r.items.rows) || {});
    const good = marks.filter(v => v === 'L').length, bad = marks.filter(v => v === 'R').length;
    return `
      <tr>
        <td data-label="評估日期">${esc(r.assess_date)}</td>
        <td data-label="哺餵方式">${esc(r.feed_type || '—')}</td>
        <td data-label="結果"><span class="badge green">有效 ${good} 項</span> ${bad ? `<span class="badge red">待改善 ${bad} 項</span>` : ''}</td>
        <td data-label="評估者">${esc(r.nurse_name || '—')}</td>
        <td data-label="操作" class="no-print">
          <button class="btn small secondary" data-bfa-load="${r.id}">載入檢視</button>
          ${currentUser.role === 'admin' ? `<button class="btn small danger" data-bfa-del="${r.id}">刪除</button>` : ''}
        </td>
      </tr>`;
  }).join('');

  main().innerHTML = `
    <div class="page-title">母乳哺育評估表</div>
    <div class="card no-print">
      <div class="row" style="gap:8px;flex-wrap:wrap">
        ${canAccess('#/baby-nursing') ? `<a class="btn small secondary" href="#/baby-nursing?b=${baby.id}">回寶寶護理</a>` : ''}
        ${canAccess('#/mother-nursing') ? `<a class="btn small secondary" href="#/mother-nursing?m=${baby.mother_id}">回媽媽護理</a>` : ''}
        <button class="btn small secondary" id="bfa-print">列印</button>
        ${reminder ? `<span style="font-size:.85rem;color:var(--muted)">提醒：${esc(reminder.remind_date)}（${esc(reminder.day_label)}）應執行${reminder.done_date ? `，已於 ${esc(reminder.done_date)} 由 ${esc(reminder.done_by)} 執行` : '，<b style="color:var(--warn)">尚未執行</b>'}</span>` : ''}
      </div>
    </div>
    <div class="card" id="bfa-form">
      <div class="form-grid">
        <div class="field"><label>評估日期 <b class="req">*</b></label><input type="date" id="bfa-date" value="${todayStr()}"></div>
        <div class="field"><label>評估者</label><input value="${esc(currentUser.name)}" disabled></div>
        <div class="field"><label>寶寶</label><input value="${esc(baby.name)}${baby.gender ? `（${baby.gender === 'male' ? '男' : '女'}）` : ''}" disabled></div>
        <div class="field"><label>房號／媽媽</label><input value="${esc(baby.room_name || '—')}／${esc(baby.mother_name)}" disabled></div>
        <div class="field"><label>出生體重（g）</label><input value="${baby.birth_weight_g ?? ''}" disabled></div>
        <div class="field"><label>目前體重（g）<small>（寶寶護理帶入，可修改）</small></label><input type="number" step="0.1" min="0" id="bfa-weight" value="${pre.current_weight_g ?? ''}"></div>
        <div class="field"><label>生產方式</label><input value="${esc(baby.delivery_type || '—')}" disabled></div>
        <div class="field"><label>產後天數</label><input value="${ageDays}" disabled></div>
        <div class="field"><label>胎次<small>（入住評估／客戶管理帶入，可修改）</small></label><input id="bfa-parity" maxlength="20" value="${esc(pre.parity || '')}"></div>
        <div class="field"><label>哺餵方式</label><div class="row" style="gap:12px;padding-top:8px">${BFA_FEED_TYPES.map(t => `<label class="bna-chk"><input type="radio" name="bfa-feedtype" value="${t}"> ${t}</label>`).join('')}</div></div>
        <div class="field"><label>平均每次擠奶量</label><input id="bfa-pump" maxlength="30"></div>
        <div class="field"><label>奶品</label><input id="bfa-brand" maxlength="50"></div>
        <div class="field"><label>奶量</label><input id="bfa-amount" maxlength="30"></div>
      </div>
      <div class="table-wrap" style="margin-top:14px">
        <table class="bfa-grid">
          <thead><tr><th style="width:190px"></th><th>有效餵奶表現</th><th>可能有餵食問題表現</th></tr></thead>
          <tbody>
            ${sectionRows}
            <tr>
              <th class="bfa-sec">11.使用奶嘴/乳頭罩/配方奶</th>
              <td><label class="bfa-opt"><input type="radio" name="bfa-use" value="none"><span>沒有使用</span></label></td>
              <td>
                <label class="bfa-opt"><input type="radio" name="bfa-use" value="used"><span>有，使用</span></label>
                <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:4px">${BFA_USE_ITEMS.map(o => `<label class="bna-chk"><input type="checkbox" data-bfa-useitem value="${o}"> ${o}</label>`).join('')}</div>
                <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:4px">原因：${BFA_USE_REASONS.map(o => `<label class="bna-chk"><input type="checkbox" data-bfa-usereason value="${o}"> ${o}</label>`).join('')}</div>
                <input id="bfa-useother" maxlength="50" placeholder="其他原因說明" style="margin-top:4px;max-width:220px;padding:4px 6px;min-height:0">
              </td>
            </tr>
            <tr>
              <th class="bfa-sec">12.其它</th>
              <td colspan="2"><textarea id="bfa-other" maxlength="500" style="width:100%;min-height:70px"></textarea></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="row mt no-print" style="gap:10px">
        <button class="btn" id="bfa-save">存檔</button>
        <button class="btn secondary" id="bfa-clear">清空重填</button>
        <span style="color:var(--muted);font-size:.85rem">（護理人員：${esc(currentUser.name)}）</span>
        <span class="error-msg" id="bfa-err"></span>
      </div>
    </div>
    <div class="card no-print">
      <h3>歷史評估（${rows.length} 筆）</h3>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>評估日期</th><th>哺餵方式</th><th>結果</th><th>評估者</th><th></th></tr></thead>
          <tbody>${histRows || '<tr><td colspan="5"><div class="empty">尚無評估紀錄</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $('#bfa-print').onclick = () => window.print();
  $('#bfa-clear').onclick = viewBreastfeeding;

  const fillForm = r => {
    $('#bfa-date').value = r.assess_date;
    $('#bfa-weight').value = r.current_weight_g ?? '';
    $('#bfa-parity').value = r.parity || '';
    $('#bfa-pump').value = r.avg_pump_ml || '';
    $('#bfa-brand').value = r.milk_brand || '';
    $('#bfa-amount').value = r.milk_amount || '';
    $('#bfa-other').value = r.other_note || '';
    main().querySelectorAll('[name="bfa-feedtype"]').forEach(x => x.checked = x.value === r.feed_type);
    const it = r.items || {};
    for (const [k, v] of Object.entries(it.rows || {})) {
      const el = main().querySelector(`[name="bfa-${k}"][value="${v}"]`);
      if (el) el.checked = true;
    }
    $('#bfa-min').value = it.suck_min ?? '';
    $('#bfa-stoolnote').value = it.stool_note || '';
    main().querySelectorAll('[name="bfa-use"]').forEach(x => x.checked = x.value === it.use);
    main().querySelectorAll('[data-bfa-useitem]').forEach(x => x.checked = (it.use_items || []).includes(x.value));
    main().querySelectorAll('[data-bfa-usereason]').forEach(x => x.checked = (it.use_reasons || []).includes(x.value));
    $('#bfa-useother').value = it.use_other || '';
    window.scrollTo(0, 0);
  };
  main().querySelectorAll('[data-bfa-load]').forEach(btn => {
    btn.onclick = () => { const r = rows.find(x => String(x.id) === btn.dataset.bfaLoad); if (r) fillForm(r); };
  });
  main().querySelectorAll('[data-bfa-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆母乳哺育評估？')) return;
      await api(`/breastfeeding/${btn.dataset.bfaDel}`, { method: 'DELETE' });
      viewBreastfeeding();
    };
  });

  $('#bfa-save').onclick = async () => {
    const err = $('#bfa-err');
    err.textContent = '';
    const rowsPicked = {};
    for (const sec of BFA_SECTIONS) {
      sec.rows.forEach((_, i) => {
        const el = main().querySelector(`[name="bfa-${sec.key}${i}"]:checked`);
        if (el) rowsPicked[`${sec.key}${i}`] = el.value;
      });
    }
    if (!Object.keys(rowsPicked).length) { err.textContent = '請至少勾選一項評估結果'; return; }
    const useEl = main().querySelector('[name="bfa-use"]:checked');
    try {
      await api(`/babies/${baby.id}/breastfeeding`, { method: 'POST', body: {
        assess_date: $('#bfa-date').value,
        current_weight_g: $('#bfa-weight').value,
        parity: $('#bfa-parity').value.trim(),
        feed_type: (main().querySelector('[name="bfa-feedtype"]:checked') || {}).value || '',
        avg_pump_ml: $('#bfa-pump').value.trim(),
        milk_brand: $('#bfa-brand').value.trim(),
        milk_amount: $('#bfa-amount').value.trim(),
        other_note: $('#bfa-other').value.trim(),
        items: {
          rows: rowsPicked,
          suck_min: $('#bfa-min').value ? Number($('#bfa-min').value) : null,
          stool_note: $('#bfa-stoolnote').value.trim(),
          use: useEl ? useEl.value : '',
          use_items: [...main().querySelectorAll('[data-bfa-useitem]:checked')].map(x => x.value),
          use_reasons: [...main().querySelectorAll('[data-bfa-usereason]:checked')].map(x => x.value),
          use_other: $('#bfa-useother').value.trim()
        }
      } });
      viewBreastfeeding();
    } catch (e) { err.textContent = e.message; }
  };
}

/* ---------- 衛福部通報上傳 ---------- */
const GOV_STATUS = { pending: ['待上傳', 'yellow'], uploaded: ['已上傳', 'green'], failed: ['上傳失敗', 'red'] };
async function viewGov() {
  const data = await api('/gov/submissions');
  main().innerHTML = `
    <div class="page-title">衛福部通報</div>
    <div class="card">
      ${data.configured
        ? '<div class="badge green">已設定介接，可自動上傳</div>'
        : '<div class="badge yellow">尚未設定介接</div>　<span style="font-size:.85rem;color:var(--muted)">未設定衛福部 API 前為本地模式，可產生資料並用「資料匯出」報送；設定後（系統設定→衛福部通報）即可自動上傳與失敗重試。</span>'}
      <div class="row" style="margin-top:10px;align-items:flex-end;gap:8px">
        <div class="field" style="max-width:160px;margin:0"><label>月份</label><input type="month" id="gv-month" value="${todayStr().slice(0, 7)}"></div>
        <div class="field" style="max-width:220px;margin:0"><label>表單</label><select id="gv-form">${Object.entries(data.forms).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <button class="btn" id="gv-gen">產生通報</button>
        <button class="btn secondary" id="gv-gen-up">產生並上傳</button>
        <button class="btn secondary" id="gv-xlsx">下載月報表 Excel</button>
        <button class="btn secondary" id="gv-view">檢視欄位</button>
      </div>
    </div>
    <div class="card">
      <h3>通報紀錄</h3>
      ${filterBar({ placeholder: '搜尋表單 / 期間…', statuses: [{ val: '', label: '全部' }, { val: 'pending', label: '待上傳' }, { val: 'uploaded', label: '已上傳' }, { val: 'failed', label: '失敗' }] })}
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>表單／期間</th><th>狀態</th><th>嘗試</th><th>回執</th><th>時間</th><th></th></tr></thead>
        <tbody>${data.submissions.length ? data.submissions.map(s => `
          <tr data-filter="${esc((s.title || s.form_type) + ' ' + s.period)}" data-status="${s.status}">
            <td data-label="表單">${esc(s.title || s.form_type)}</td>
            <td data-label="狀態"><span class="badge ${(GOV_STATUS[s.status] || ['', 'gray'])[1]}">${(GOV_STATUS[s.status] || [s.status])[0]}</span>${s.last_error ? `<br><small style="color:var(--danger)">${esc(s.last_error)}</small>` : ''}</td>
            <td data-label="嘗試">${s.attempts}</td>
            <td data-label="回執">${esc(s.ack_no || '-')}</td>
            <td data-label="時間"><small>${esc((s.uploaded_at || s.created_at || '').slice(0, 16))}</small></td>
            <td data-label="操作">
              ${s.status !== 'uploaded' ? `<button class="btn small" data-up="${s.id}">上傳</button>` : ''}
              <button class="btn small danger" data-del="${s.id}">刪除</button>
            </td>
          </tr>`).join('') : '<tr><td colspan="6"><div class="empty">尚無通報紀錄</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  wireFilter(main());
  const gen = async (upload) => {
    try { const r = await api('/gov/submissions', { method: 'POST', body: { form_type: main().querySelector('#gv-form').value, period: main().querySelector('#gv-month').value, upload } });
      if (r.error) alert(r.error); else if (r.status === 'failed') alert('已產生，但上傳失敗：' + (r.error || '')); viewGov();
    } catch (e) { alert(e.message); }
  };
  main().querySelector('#gv-gen').onclick = () => gen(false);
  main().querySelector('#gv-gen-up').onclick = () => gen(true);
  main().querySelector('#gv-xlsx').onclick = () => window.open(`/api/gov/form.xlsx?month=${main().querySelector('#gv-month').value}`, '_blank');
  main().querySelector('#gv-view').onclick = async () => {
    const f = await api(`/gov/form?month=${main().querySelector('#gv-month').value}`);
    openModal(`產後護理機構月報表（${f.month}）`, `
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>項目</th><th>數值</th></tr></thead>
        <tbody>${f.fields.map(x => `<tr><td data-label="項目">${esc(x.label)}</td><td data-label="數值"><strong>${esc(String(x.value))}</strong></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="row" style="margin-top:10px"><button class="btn secondary" id="gvm-xlsx">下載 Excel</button></div>`, body => {
      body.querySelector('#gvm-xlsx').onclick = () => window.open(`/api/gov/form.xlsx?month=${f.month}`, '_blank');
    });
  };
  main().querySelectorAll('[data-up]').forEach(b => b.onclick = async () => {
    try { const r = await api(`/gov/submissions/${b.dataset.up}/upload`, { method: 'POST' }); alert('上傳成功' + (r.ack_no ? '，回執 ' + r.ack_no : '')); viewGov(); }
    catch (e) { alert(e.message); }
  });
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('刪除此通報紀錄？')) return;
    try { await api(`/gov/submissions/${b.dataset.del}`, { method: 'DELETE' }); viewGov(); } catch (e) { alert(e.message); }
  });
}

/* ---------- 員工證照 ---------- */
const CERT_STATE = { expired: ['已過期', 'red'], expiring: ['即將到期', 'yellow'], ok: ['有效', 'green'], none: ['無期限', 'gray'] };
async function viewCerts() {
  const [data, users] = await Promise.all([api('/certifications'), api('/users')]);
  window._certUsers = users;
  const low = data.certifications.filter(c => c.state === 'expired' || c.state === 'expiring').length;
  main().innerHTML = `
    <div class="page-title">員工證照</div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>到期前 ${data.alert_days} 天提醒${low ? `　<span class="badge red">${low} 張需注意</span>` : ''}</div>
        <button class="btn small" id="ct-new">新增證照</button>
      </div>
      ${filterBar({ placeholder: '搜尋員工 / 證照 / 證號…', statuses: [{ val: '', label: '全部' }, { val: 'expired', label: '已過期' }, { val: 'expiring', label: '即將到期' }, { val: 'ok', label: '有效' }] })}
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>員工</th><th>證照</th><th>證號</th><th>到期日</th><th>狀態</th><th></th></tr></thead>
        <tbody>${data.certifications.length ? data.certifications.map(c => `
          <tr data-filter="${esc((c.person || '') + ' ' + c.cert_name + ' ' + (c.cert_no || ''))}" data-status="${c.state}">
            <td data-label="員工">${esc(c.person || '-')}</td>
            <td data-label="證照">${esc(c.cert_name)}${c.issuer ? `<br><small>${esc(c.issuer)}</small>` : ''}</td>
            <td data-label="證號">${esc(c.cert_no || '-')}</td>
            <td data-label="到期日">${esc(c.expires_on || '無')}${c.days_left != null ? `<br><small>${c.days_left < 0 ? '已過期 ' + (-c.days_left) + ' 天' : '剩 ' + c.days_left + ' 天'}</small>` : ''}</td>
            <td data-label="狀態"><span class="badge ${(CERT_STATE[c.state] || ['', 'gray'])[1]}">${(CERT_STATE[c.state] || [c.state])[0]}</span></td>
            <td data-label="操作"><button class="btn small secondary" data-edit="${c.id}">編輯</button> <button class="btn small danger" data-del="${c.id}">刪除</button></td>
          </tr>`).join('') : '<tr><td colspan="6"><div class="empty">尚未建立證照</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  wireFilter(main());
  main().querySelector('#ct-new').onclick = () => openCertForm(null);
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openCertForm(data.certifications.find(c => c.id == b.dataset.edit)));
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('刪除此證照紀錄？')) return;
    try { await api(`/certifications/${b.dataset.del}`, { method: 'DELETE' }); viewCerts(); } catch (e) { alert(e.message); }
  });
}
function openCertForm(c) {
  const ed = c || {};
  const users = window._certUsers || [];
  openModal(ed.id ? '編輯證照' : '新增證照', `
    <div class="form-grid">
      <div class="field"><label>員工帳號</label><select id="ct-user"><option value="">（手填姓名）</option>${users.map(u => `<option value="${u.id}" ${ed.user_id == u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
      <div class="field"><label>姓名（非帳號者）</label><input id="ct-name" value="${esc(ed.staff_name || '')}"></div>
      <div class="field"><label>證照名稱 *</label><input id="ct-cert" value="${esc(ed.cert_name || '')}" list="ct-cert-list" placeholder="護理師執照 / BLS…">${dataList('ct-cert-list', 'cert_name_options')}</div>
      <div class="field"><label>證號</label><input id="ct-no" value="${esc(ed.cert_no || '')}"></div>
      <div class="field"><label>發證單位</label><input id="ct-issuer" value="${esc(ed.issuer || '')}" list="ct-issuer-list">${dataList('ct-issuer-list', 'cert_issuer_options')}</div>
      <div class="field"><label>發證日</label><input type="date" id="ct-issued" value="${esc(ed.issued_on || '')}"></div>
      <div class="field"><label>到期日</label><input type="date" id="ct-exp" value="${esc(ed.expires_on || '')}"></div>
      <div class="field full"><label>備註</label><input id="ct-note" value="${esc(ed.note || '')}"></div>
      <div class="full row"><button class="btn" id="ct-save">儲存</button><span class="error-msg" id="ct-err"></span></div>
    </div>`, body => {
    const v = id => body.querySelector(id).value;
    body.querySelector('#ct-save').onclick = async () => {
      const payload = { user_id: v('#ct-user') ? Number(v('#ct-user')) : null, staff_name: v('#ct-name').trim(),
        cert_name: v('#ct-cert').trim(), cert_no: v('#ct-no').trim(), issuer: v('#ct-issuer').trim(),
        issued_on: v('#ct-issued'), expires_on: v('#ct-exp'), note: v('#ct-note') };
      try { if (ed.id) await api(`/certifications/${ed.id}`, { method: 'PUT', body: payload });
        else await api('/certifications', { method: 'POST', body: payload });
        closeModal(); viewCerts();
      } catch (e) { body.querySelector('#ct-err').textContent = e.message; }
    };
  });
}

/* ---------- 問卷／滿意度調查 ---------- */
async function viewSurveys() {
  const rows = await api('/surveys');
  main().innerHTML = `
    <div class="page-title">問卷調查</div>
    <div class="card">
      <div class="row" style="justify-content:flex-end"><button class="btn small" id="sv-new">新增問卷</button></div>
      ${filterBar({ placeholder: '搜尋問卷標題…', statuses: [{ val: '', label: '全部' }, { val: 'on', label: '開放中' }, { val: 'off', label: '已關閉' }] })}
      <div class="table-wrap" style="margin-top:8px"><table class="data stack">
        <thead><tr><th>標題</th><th>題數</th><th>回應</th><th>狀態</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map(s => `
          <tr data-filter="${esc(s.title + ' ' + (s.description || ''))}" data-status="${s.active ? 'on' : 'off'}"${s.active ? '' : ' style="opacity:.55"'}>
            <td data-label="標題">${esc(s.title)}${s.description ? `<br><small>${esc(s.description)}</small>` : ''}</td>
            <td data-label="題數">${s.questions.length}</td>
            <td data-label="回應">${s.response_count}</td>
            <td data-label="狀態"><span class="badge ${s.active ? 'green' : 'gray'}">${s.active ? '開放中' : '已關閉'}</span></td>
            <td data-label="操作">
              <button class="btn small" data-stat="${s.id}">統計</button>
              <button class="btn small secondary" data-edit="${s.id}">編輯</button>
              <button class="btn small danger" data-del="${s.id}">刪除</button>
            </td>
          </tr>`).join('') : '<tr><td colspan="5"><div class="empty">尚無問卷</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  wireFilter(main());
  main().querySelector('#sv-new').onclick = () => openSurveyForm(null);
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openSurveyForm(rows.find(s => s.id == b.dataset.edit)));
  main().querySelectorAll('[data-stat]').forEach(b => b.onclick = () => openSurveyStats(b.dataset.stat));
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('刪除此問卷？（已有回應者改為關閉）')) return;
    try { await api(`/surveys/${b.dataset.del}`, { method: 'DELETE' }); viewSurveys(); } catch (e) { alert(e.message); }
  });
}
const QTYPE = { rating: '評分(1-5)', choice: '單選', text: '文字' };
function openSurveyForm(s) {
  const ed = s || {};
  let questions = ed.questions ? JSON.parse(JSON.stringify(ed.questions)) : [{ type: 'rating', label: '' }];
  const render = body => {
    body.querySelector('#sv-qs').innerHTML = questions.map((q, i) => `
      <div class="card" style="margin:0 0 8px;padding:10px">
        <div class="row" style="gap:8px;align-items:flex-end">
          <div class="field" style="max-width:130px;margin:0"><label>第 ${i + 1} 題類型</label>
            <select data-q="${i}" data-k="type">${Object.entries(QTYPE).map(([k, v]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field" style="flex:1;margin:0"><label>題目</label><input data-q="${i}" data-k="label" value="${esc(q.label || '')}"></div>
          <button class="btn small danger" data-rm="${i}">刪</button>
        </div>
        ${q.type === 'choice' ? `<div class="field" style="margin:6px 0 0"><label>選項（逗號分隔）</label><input data-q="${i}" data-k="options" value="${esc((q.options || []).join(','))}"></div>` : ''}
      </div>`).join('');
    body.querySelectorAll('[data-q]').forEach(el => el.onchange = () => {
      const i = Number(el.dataset.q), k = el.dataset.k;
      if (k === 'options') questions[i].options = el.value.split(',').map(x => x.trim()).filter(Boolean);
      else { questions[i][k] = el.value; if (k === 'type') render(body); }
    });
    body.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { questions.splice(Number(b.dataset.rm), 1); if (!questions.length) questions.push({ type: 'rating', label: '' }); render(body); });
  };
  openModal(ed.id ? '編輯問卷' : '新增問卷', `
    <div class="form-grid">
      <div class="field full"><label>標題 *</label><input id="sv-title" value="${esc(ed.title || '')}"></div>
      <div class="field full"><label>說明</label><input id="sv-desc" value="${esc(ed.description || '')}"></div>
      ${ed.id ? `<div class="field"><label><input type="checkbox" id="sv-active" ${ed.active ? 'checked' : ''}> 開放填寫</label></div>` : ''}
    </div>
    <div class="row" style="justify-content:space-between;align-items:center;margin:8px 0">
      <strong style="font-size:.9rem">題目</strong><button class="btn small secondary" id="sv-add">＋ 加一題</button></div>
    <div id="sv-qs"></div>
    <div class="row"><button class="btn" id="sv-save">儲存</button><span class="error-msg" id="sv-err"></span></div>`, body => {
    render(body);
    body.querySelector('#sv-add').onclick = () => { questions.push({ type: 'rating', label: '' }); render(body); };
    body.querySelector('#sv-save').onclick = async () => {
      const payload = { title: body.querySelector('#sv-title').value.trim(), description: body.querySelector('#sv-desc').value.trim(),
        questions: questions.filter(q => q.label && q.label.trim()) };
      if (ed.id) payload.active = body.querySelector('#sv-active').checked ? 1 : 0;
      try { if (ed.id) await api(`/surveys/${ed.id}`, { method: 'PUT', body: payload });
        else await api('/surveys', { method: 'POST', body: payload });
        closeModal(); viewSurveys();
      } catch (e) { body.querySelector('#sv-err').textContent = e.message; }
    };
  });
}
async function openSurveyStats(id) {
  const s = await api(`/surveys/${id}`);
  const body = s.stats.map(st => {
    if (st.type === 'rating') return `<div class="card" style="margin:0 0 8px"><strong>${esc(st.label)}</strong><div>平均 <span style="font-size:1.3rem;color:var(--primary)">${st.avg ?? '-'}</span> / 5　（${st.count} 份）</div></div>`;
    if (st.type === 'choice') return `<div class="card" style="margin:0 0 8px"><strong>${esc(st.label)}</strong>${Object.entries(st.dist).map(([k, v]) => `<div>${esc(k)}：${v}</div>`).join('') || '<div class="empty">尚無回應</div>'}</div>`;
    return `<div class="card" style="margin:0 0 8px"><strong>${esc(st.label)}</strong><ul class="timeline" style="margin-top:4px">${st.answers.map(a => `<li>${esc(a)}</li>`).join('') || '<div class="empty">尚無文字回應</div>'}</ul></div>`;
  }).join('');
  openModal(`${s.title}（回應 ${s.responses} 份）`, body || '<div class="empty">尚無資料</div>');
}

/* ---------- 名人推薦管理 ---------- */
async function viewTestimonials() {
  const rows = await api('/testimonials');
  main().innerHTML = `
    <div class="page-title">名人推薦</div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div style="font-size:.88rem;color:var(--muted)">管理對外推薦牆；公開展示頁：<a href="/testimonials.html" target="_blank">/testimonials.html</a></div>
        <button class="btn small" id="ts-new">新增推薦</button>
      </div>
      ${filterBar({ placeholder: '搜尋姓名 / 稱號…', statuses: [{ val: '', label: '全部' }, { val: 'on', label: '上架' }, { val: 'off', label: '下架' }] })}
      <div class="prod-grid" style="margin-top:10px">${rows.length ? rows.map(t => `
        <div class="prod-card${t.active ? '' : ' off'}" data-filter="${esc(t.name + ' ' + (t.title || ''))}" data-status="${t.active ? 'on' : 'off'}">
          <div class="prod-img">${t.photo ? `<img src="${esc(t.photo)}" alt="${esc(t.name)}">` : '<div class="ph">無照片</div>'}${t.active ? '' : '<span class="prod-off">已下架</span>'}</div>
          <div class="prod-body">
            <div class="prod-name">${esc(t.name)}</div>
            ${t.title ? `<div class="prod-meta"><small>${esc(t.title)}</small></div>` : ''}
            ${t.quote ? `<div class="prod-meta" style="font-size:.82rem">${esc(t.quote.slice(0, 40))}${t.quote.length > 40 ? '…' : ''}</div>` : ''}
            <div class="row" style="margin-top:6px">
              <button class="btn small secondary" data-edit="${t.id}">編輯</button>
              <button class="btn small ${t.active ? 'secondary' : ''}" data-toggle="${t.id}">${t.active ? '下架' : '上架'}</button>
            </div>
          </div>
        </div>`).join('') : '<div class="empty">尚未建立推薦</div>'}</div>
    </div>`;
  // 卡片用 prod-grid，但 filterBar 需要 table；改用簡易自訂過濾
  const bar = main().querySelector('.flt-bar');
  if (bar) {
    const search = bar.querySelector('.flt-search');
    const cards = [...main().querySelectorAll('.prod-card')];
    let st = '';
    const apply = () => { const q = (search.value || '').toLowerCase();
      cards.forEach(c => { c.style.display = ((!q || c.dataset.filter.toLowerCase().includes(q)) && (!st || c.dataset.status === st)) ? '' : 'none'; }); };
    search.oninput = apply;
    bar.querySelectorAll('[data-flt-status]').forEach(b => b.onclick = () => { st = b.dataset.fltStatus; bar.querySelectorAll('[data-flt-status]').forEach(x => x.classList.toggle('secondary', x !== b)); apply(); });
  }
  main().querySelector('#ts-new').onclick = () => openTestimonialForm(null);
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openTestimonialForm(rows.find(t => t.id == b.dataset.edit)));
  main().querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
    const t = rows.find(x => x.id == b.dataset.toggle);
    try { await api(`/testimonials/${t.id}`, { method: 'PUT', body: { active: t.active ? 0 : 1 } }); viewTestimonials(); } catch (e) { alert(e.message); }
  });
}
function openTestimonialForm(t) {
  const ed = t || {};
  openModal(ed.id ? '編輯推薦' : '新增推薦', `
    <div class="form-grid">
      <div class="field"><label>姓名 *</label><input id="tf-name" value="${esc(ed.name || '')}"></div>
      <div class="field"><label>稱號</label><input id="tf-title" value="${esc(ed.title || '')}" placeholder="明星夫妻 / 資深音樂人…"></div>
      <div class="field full"><label>推薦語</label><textarea id="tf-quote" rows="2">${esc(ed.quote || '')}</textarea></div>
      <div class="field"><label>來源連結（FB／IG）</label><input id="tf-src" value="${esc(ed.source_url || '')}"></div>
      <div class="field"><label>影片連結</label><input id="tf-vid" value="${esc(ed.video_url || '')}"></div>
      <div class="field"><label>排序</label><input type="number" id="tf-sort" value="${ed.sort ?? 0}"></div>
      <div class="field"><label><input type="checkbox" id="tf-active" ${ed.active === 0 ? '' : 'checked'}> 上架（顯示於公開頁）</label></div>
      <div class="field full"><label>人物照片</label>
        <div class="row" style="align-items:center">
          <div class="prod-img sm" id="tf-imgprev">${ed.photo ? `<img src="${esc(ed.photo)}">` : '<div class="ph">無</div>'}</div>
          <input type="file" id="tf-img" accept="image/*">
        </div>
        <small style="color:var(--muted)">${ed.id ? '選擇檔案後即時上傳' : '請先儲存，再回來上傳照片'}</small>
      </div>
      <div class="full row"><button class="btn" id="tf-save">儲存</button>
        ${ed.id ? '<button class="btn danger" id="tf-del">刪除</button>' : ''}
        <span class="error-msg" id="tf-err"></span></div>
    </div>`, body => {
    const v = id => body.querySelector(id);
    if (ed.id) v('#tf-img').onchange = async () => {
      const f = v('#tf-img').files[0]; if (!f) return;
      const fd = new FormData(); fd.append('photo', await compressImage(f));
      try { const r = await api(`/testimonials/${ed.id}/photo`, { method: 'POST', body: fd });
        v('#tf-imgprev').innerHTML = `<img src="${esc(r.photo)}">`;
      } catch (e) { v('#tf-err').textContent = e.message; }
    };
    v('#tf-save').onclick = async () => {
      const payload = { name: v('#tf-name').value.trim(), title: v('#tf-title').value.trim(),
        quote: v('#tf-quote').value, source_url: v('#tf-src').value.trim(), video_url: v('#tf-vid').value.trim(),
        sort: Number(v('#tf-sort').value) || 0, active: v('#tf-active').checked ? 1 : 0 };
      try { if (ed.id) await api(`/testimonials/${ed.id}`, { method: 'PUT', body: payload });
        else await api('/testimonials', { method: 'POST', body: payload });
        closeModal(); viewTestimonials();
      } catch (e) { v('#tf-err').textContent = e.message; }
    };
    if (ed.id) v('#tf-del').onclick = async () => {
      if (!confirm('確定刪除此推薦？')) return;
      try { await api(`/testimonials/${ed.id}`, { method: 'DELETE' }); closeModal(); viewTestimonials(); }
      catch (e) { v('#tf-err').textContent = e.message; }
    };
  });
}

/* ---------- 經營分析儀表板 ---------- */
async function viewAnalytics() {
  const months = window._anMonths || 12;
  const data = await api(`/reports/analytics?months=${months}`);
  const s = data.series;
  const last = s[s.length - 1] || {};
  const sum = k => s.reduce((a, b) => a + (b[k] || 0), 0);
  const pts = (k) => s.map(r => ({ date: r.month, value: r[k] }));
  main().innerHTML = `
    <div class="page-title">經營分析</div>
    <div class="card no-print">
      <div class="row" style="align-items:flex-end;gap:10px">
        <div class="field" style="max-width:140px;margin:0"><label>期間</label>
          <select id="an-months">${[6, 12, 18, 24].map(n => `<option value="${n}" ${months == n ? 'selected' : ''}>近 ${n} 個月</option>`).join('')}</select></div>
        <button class="btn secondary" id="an-print">列印</button>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="num">${last.occupancy_rate ?? 0}%</div><div class="label">本月入住率</div></div>
      <div class="stat"><div class="num">${fmtMoney(last.payments_received || 0)}</div><div class="label">本月實收</div></div>
      <div class="stat"><div class="num">${last.conversion ?? 0}%</div><div class="label">本月參觀簽約率</div></div>
      <div class="stat"><div class="num">${fmtMoney(sum('shop_margin'))}</div><div class="label">商城毛利（期間）</div></div>
    </div>
    <div class="card"><h3>入住率趨勢 (%)</h3>${svgLineChart(pts('occupancy_rate'), { unit: '%' })}</div>
    <div class="card"><h3>每月實收金額 (NT$)</h3>${svgLineChart(pts('payments_received'), { color: '#2a7f78' })}</div>
    <div class="card"><h3>客源：參觀人數與簽約率</h3>${svgLineChart(pts('conversion'), { unit: '%', color: '#d77a8a' })}</div>
    <div class="card"><h3>商城毛利 (NT$)</h3>${svgLineChart(pts('shop_margin'), { color: '#b8860b' })}</div>
    <div class="card">
      <h3>逐月明細</h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>月份</th><th>入住率</th><th>實收</th><th>新收</th><th>退住</th><th>參觀</th><th>簽約率</th><th>商城營收</th><th>商城毛利</th></tr></thead>
        <tbody>${s.map(r => `<tr>
          <td data-label="月份">${esc(r.month)}</td>
          <td data-label="入住率">${r.occupancy_rate}%</td>
          <td data-label="實收">${fmtMoney(r.payments_received)}</td>
          <td data-label="新收">${r.admissions}</td>
          <td data-label="退住">${r.discharges}</td>
          <td data-label="參觀">${r.tours}</td>
          <td data-label="簽約率">${r.conversion}%</td>
          <td data-label="商城營收">${fmtMoney(r.shop_revenue)}</td>
          <td data-label="商城毛利">${fmtMoney(r.shop_margin)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  $('#an-months').onchange = () => { window._anMonths = Number($('#an-months').value); viewAnalytics(); };
  $('#an-print').onclick = () => window.print();
}

/* ---------- 應收帳款帳齡與催收 ---------- */
async function viewAging() {
  const data = await api('/billing/aging');
  const BK = { current: ['未到期 / 在住', 'gray'], d30: ['逾期 1–30 天', 'yellow'], d60: ['逾期 31–60 天', 'yellow'], d60p: ['逾期 60 天以上', 'red'] };
  main().innerHTML = `
    <div class="page-title">應收帳齡與催收</div>
    <div class="stat-grid">
      <div class="stat"><div class="num">${fmtMoney(data.total)}</div><div class="label">未結總額</div></div>
      <div class="stat"><div class="num">${fmtMoney(data.buckets.d30)}</div><div class="label">逾期 1–30 天</div></div>
      <div class="stat"><div class="num">${fmtMoney(data.buckets.d60)}</div><div class="label">逾期 31–60 天</div></div>
      <div class="stat"><div class="num" style="${data.buckets.d60p ? 'color:var(--danger)' : ''}">${fmtMoney(data.buckets.d60p)}</div><div class="label">逾期 60 天以上</div></div>
    </div>
    <div class="card">
      ${filterBar({ placeholder: '搜尋媽媽 / 房間…', statuses: [{ val: '', label: '全部' }, { val: 'overdue', label: '已逾期' }] })}
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>媽媽 / 房間</th><th>退房日</th><th>逾期</th><th>未結餘額</th><th>最後催收</th><th></th></tr></thead>
        <tbody>${data.rows.length ? data.rows.map(b => `
          <tr data-filter="${esc(b.mother_name + ' ' + b.room_name)}" data-status="${b.overdue_days > 0 ? 'overdue' : ''}">
            <td data-label="媽媽">${esc(b.mother_name)}<br><small>${esc(b.room_name)} 房・${esc(b.phone || '')}</small></td>
            <td data-label="退房日">${esc(b.check_out)}<br><small>${STATUS_LABEL[b.status] || b.status}</small></td>
            <td data-label="逾期">${b.overdue_days > 0 ? `<span class="badge ${BK[b.bucket][1]}">${b.overdue_days} 天</span>` : '<span class="badge gray">未到期</span>'}</td>
            <td data-label="未結餘額"><strong style="color:var(--danger)">${fmtMoney(b.balance)}</strong></td>
            <td data-label="最後催收"><small>${esc((b.dunned_at || '').slice(0, 16) || '—')}</small></td>
            <td data-label="操作"><button class="btn small" data-dun="${b.id}">催收提醒</button> <button class="btn small secondary" data-bill="${b.id}">明細</button></td>
          </tr>`).join('') : '<tr><td colspan="6"><div class="empty">目前沒有未結帳款</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  wireFilter(main());
  main().querySelectorAll('[data-dun]').forEach(b => b.onclick = async () => {
    if (!confirm('發送催收提醒給家屬（留言＋已綁定者 LINE）並記錄催收時間？')) return;
    try { const r = await api(`/bookings/${b.dataset.dun}/dun`, { method: 'POST' });
      alert(`已記錄催收${r.notified ? `，並推播 ${r.notified} 位家屬 LINE` : '（家屬留言已送出）'}`); viewAging();
    } catch (e) { alert(e.message); }
  });
  main().querySelectorAll('[data-bill]').forEach(b => b.onclick = () => { $('#modal').onclose = () => { $('#modal').onclose = null; }; openBillingDetail(b.dataset.bill); });
}

/* ---------- 路由 ---------- */
const routes = {
  '#/dashboard': viewDashboard,
  '#/overview-calendar': viewOverviewCalendar,
  '#/baby-care': viewBabyCare,
  '#/newborn-medical': viewNewbornMedical,
  '#/physician-visits': viewPhysicianVisits,
  '#/mother-care': viewMotherCare,
  '#/handover': viewHandover,
  '#/incidents': viewIncidents,
  '#/infection': viewInfection,
  '#/residents': viewResidents,
  '#/rooms': viewRooms,
  '#/sys-option': viewSysOption,
  '#/cleaning-schedule': viewCleaningSchedule,
  '#/door-light': viewDoorLight,
  '#/discharge-meds': viewDischargeMeds,
  '#/edu-schedule': viewEduSchedule,
  '#/epds-template': viewEpdsTemplate,
  '#/room-types': viewRoomTypes,
  '#/room-list': viewRoomList,
  '#/room-discounts': viewRoomDiscounts,
  '#/baby-beds': viewBabyBeds,
  '#/mother-rooms': viewMotherRooms,
  '#/baby-rooms': viewBabyRooms,
  '#/mother-care-query': () => viewCareRecordQuery('mother'),
  '#/mother-arrivals': () => viewMotherUpcoming('in'),
  '#/mother-departures': () => viewMotherUpcoming('out'),
  '#/baby-care-query': () => viewCareRecordQuery('baby'),
  '#/nursing-needs': () => viewNursingNeeds('all'),
  '#/mother-needs': () => viewNursingNeeds('mother'),
  '#/baby-needs': () => viewNursingNeeds('baby'),
  '#/baby-nursing': viewBabyNursing,
  '#/baby-eval': viewBabyEval,
  '#/baby-doctor': viewBabyDoctor,
  '#/baby-handover': viewBabyHandover,
  '#/baby-close': viewBabyClosure,
  '#/mother-nursing': viewMotherNursing,
  '#/mother-doctor': viewMotherDoctor,
  '#/mother-handover': viewMotherHandover,
  '#/mother-guidance': viewMotherGuidance,
  '#/mother-close': viewMotherClosure,
  '#/mother-intake': viewMotherIntake,
  '#/rounds-list': viewRoundsList,
  '#/baby-announcements': viewBabyAnnouncements,
  '#/mother-intake-blank': viewMotherIntakeBlank,
  '#/customers': viewCustomers,
  '#/client-contracts': viewClientContracts,
  '#/pp-report': viewPpReport,
  '#/bulletins': viewBulletins,
  '#/documents': viewDocuments,
  '#/cancellations': viewCancellationsQuery,
  '#/contract-transfers': viewContractTransfersQuery,
  '#/tour-calendar': viewTourCalendar,
  '#/tour-visit-blank': viewTourVisitBlank,
  '#/booking-blank': viewBookingBlank,
  '#/retail': viewRetail,
  '#/medical-records': viewMedicalRecords,
  '#/mother-rooms-print': viewMotherRoomsPrint,
  '#/breastfeeding': viewBreastfeeding,
  '#/bed-planning': viewBedPlanning,
  '#/housekeeping': viewHousekeeping,
  '#/room-timeline': viewRoomTimeline,
  '#/billing': viewBilling,
  '#/aging': viewAging,
  '#/shop': viewShop,
  '#/supplies': viewSupplies,
  '#/supply-items': viewSupplyItems,
  '#/supply-in': viewSupplyIn,
  '#/supply-out': viewSupplyOut,
  '#/supply-movements': viewSupplyMovements,
  '#/supply-stocktake': viewSupplyStocktake,
  '#/stocktake-detail': viewStocktakeDetail,
  '#/programs': viewPrograms,
  '#/program-calendar': viewProgramCalendar,
  '#/members': viewMembers,
  '#/coupons': viewCoupons,
  '#/invoices': viewInvoices,
  '#/contracts': viewContracts,
  '#/meals': viewMeals,
  '#/meal-plan': viewMealPlan,
  '#/tours': viewTours,
  '#/visitor-reservations': viewVisitorReservations,
  '#/prospects': viewProspects,
  '#/tour-signups': viewTourSignups,
  '#/tour-cancellations': viewTourCancellations,
  '#/tour-lost': viewTourLost,
  '#/contract-amount-up': () => viewContractAmountChanges('up'),
  '#/contract-amount-down': () => viewContractAmountChanges('down'),
  '#/tour-slots': viewTourSlots,
  '#/shifts': viewShifts,
  '#/family': viewFamily,
  '#/crm': viewCrm,
  '#/reports': viewReports,
  '#/quality-report': viewQualityReport,
  '#/gov': viewGov,
  '#/certifications': viewCerts,
  '#/surveys': viewSurveys,
  '#/audit-logs': viewAuditLogs,
  '#/export': viewExport,
  '#/settings': viewSettings,
  '#/users': viewUsers,
  '#/employees': viewEmployees,
  '#/analytics': viewAnalytics,
  '#/testimonials': viewTestimonials
};
// 路由 → 所需模組權限（未列者免權限，例如總覽）
const ROUTE_PERM = {
  '#/baby-care': 'baby_care', '#/newborn-medical': 'newborn_medical', '#/physician-visits': 'physician', '#/mother-care': 'mother_care',
  '#/handover': 'handover', '#/incidents': 'incidents', '#/infection': 'infection',
  '#/residents': 'residents', '#/rooms': 'rooms', '#/room-types': 'rooms', '#/sys-option': 'settings', '#/cleaning-schedule': 'settings', '#/door-light': 'settings', '#/discharge-meds': 'settings', '#/edu-schedule': 'settings', '#/epds-template': 'mother_care', '#/room-list': 'rooms', '#/room-discounts': 'rooms', '#/baby-beds': 'rooms', '#/mother-rooms': 'rooms', '#/baby-rooms': 'baby_care', '#/baby-nursing': 'baby_care', '#/baby-eval': 'baby_care', '#/baby-doctor': 'physician', '#/baby-handover': 'baby_care', '#/baby-close': 'baby_care', '#/mother-nursing': 'mother_care', '#/mother-doctor': 'physician', '#/mother-handover': 'mother_care', '#/mother-guidance': 'mother_care', '#/mother-close': 'mother_care', '#/mother-intake': 'mother_care',
  '#/rounds-list': 'physician', '#/baby-announcements': 'baby_care', '#/mother-intake-blank': 'mother_care', '#/medical-records': 'mother_care', '#/mother-rooms-print': 'rooms', '#/mother-arrivals': 'rooms', '#/mother-departures': 'rooms',
  '#/mother-care-query': 'mother_care', '#/baby-care-query': 'baby_care', '#/nursing-needs': 'family', '#/mother-needs': 'family', '#/baby-needs': 'family',
  '#/customers': 'tours', '#/tour-calendar': 'tours', '#/tour-visit-blank': 'tours', '#/booking-blank': 'tours', '#/retail': 'shop',
  '#/cancellations': 'tours', '#/contract-transfers': 'tours', '#/client-contracts': 'tours', '#/pp-report': 'reports', '#/breastfeeding': ['baby_care', 'mother_care'], '#/bed-planning': 'rooms', '#/housekeeping': 'housekeeping', '#/room-timeline': 'rooms', '#/billing': 'billing', '#/aging': 'billing', '#/analytics': 'reports', '#/shop': 'shop',
  '#/supplies': 'supplies', '#/supply-items': 'supplies', '#/supply-in': 'supplies', '#/supply-out': 'supplies', '#/supply-movements': 'supplies', '#/supply-stocktake': 'supplies', '#/stocktake-detail': 'supplies', '#/programs': 'programs', '#/program-calendar': 'programs', '#/members': 'members', '#/coupons': 'coupons',
  '#/invoices': 'invoices', '#/contracts': 'contracts', '#/meals': 'meals', '#/meal-plan': 'meals',
  '#/tours': 'tours', '#/visitor-reservations': 'visitors', '#/prospects': 'tours', '#/tour-signups': 'tours', '#/tour-cancellations': 'tours', '#/tour-lost': 'tours', '#/contract-amount-up': 'tours', '#/contract-amount-down': 'tours', '#/tour-slots': 'tours', '#/shifts': 'shifts', '#/family': 'family', '#/crm': 'crm', '#/testimonials': 'testimonials', '#/reports': 'reports', '#/quality-report': 'reports',
  '#/gov': 'gov', '#/certifications': 'certifications', '#/surveys': 'surveys',
  '#/audit-logs': 'audit', '#/export': 'export', '#/settings': 'settings', '#/users': 'users', '#/employees': 'users'
};
function canAccess(hash) {
  const mod = ROUTE_PERM[hash];
  if (!mod) return true;
  if (currentUser.role === 'admin') return true;
  const mods = Array.isArray(mod) ? mod : [mod];
  return mods.some(m => (currentUser.modules || []).includes(m));
}

async function route() {
  if (!currentUser) return;
  // 忽略 ?x= 查詢參數（如 #/baby-nursing?b=2、#/housekeeping?d=…），以基底路徑找路由
  const base = location.hash.split('?')[0];
  let hash = routes[base] ? base : '#/dashboard';
  if (!canAccess(hash)) hash = '#/dashboard';
  const fullHash = location.hash || hash;
  document.querySelectorAll('[data-nav]').forEach(a => {
    const href = a.getAttribute('href');
    a.classList.toggle('active', href === fullHash || (href === hash && !href.includes('?')));
  });
  document.querySelectorAll('[data-nav-group]').forEach(g => {
    if ([...g.querySelectorAll('[data-nav]')].some(a => {
      const href = a.getAttribute('href');
      return href === fullHash || href.split('?')[0] === hash;
    })) g.classList.add('open');
  });
  $('#sidenav').classList.remove('open');
  $('#overlay').classList.remove('show');
  main().innerHTML = '<div class="empty">載入中</div>';
  try {
    await routes[hash]();
  } catch (e) {
    if (e.status === 401) { showLogin(); return; }
    main().innerHTML = `<div class="card"><div class="error-msg">${esc(e.message)}</div></div>`;
  }
}

function showLogin() {
  currentUser = null;
  $('#login-view').hidden = false;
  $('#app-view').hidden = true;
}

function applyBrand() {
  const name = SETTINGS.center_name || 'MamaCare';
  $('#brand').textContent = name;
  $('#login-brand').textContent = name;
  document.title = `${name} 管理系統`;
}

async function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#user-info').textContent =
    `${currentUser.name}（${currentUser.role === 'admin' ? '管理員' : '護理師'}）`;
  SETTINGS = await api('/settings');
  applyBrand();
  // 依帳號權限顯示／隱藏側欄項目；admin 為全權
  const mods = currentUser.role === 'admin' ? null : (currentUser.modules || []);
  document.querySelectorAll('[data-perm]').forEach(el => {
    el.style.display = (!mods || mods.includes(el.getAttribute('data-perm'))) ? '' : 'none';
  });
  // 折疊群組底下的分頁全被隱藏時，連群組標題一起隱藏
  document.querySelectorAll('[data-nav-group]').forEach(g => {
    const hd = g.querySelector('.nav-group-hd');
    if (hd.style.display !== 'none' &&
        ![...g.querySelectorAll('[data-nav]')].some(a => a.style.display !== 'none')) hd.style.display = 'none';
  });
  // 隱藏底下沒有任何可見項目的分區標題
  document.querySelectorAll('[data-section]').forEach(sec => {
    let vis = false;
    for (let el = sec.nextElementSibling; el && !el.hasAttribute('data-section'); el = el.nextElementSibling) {
      if (el.matches('[data-nav]') && el.style.display !== 'none') { vis = true; break; }
      if (el.matches('[data-nav-group]') && el.querySelector('.nav-group-hd').style.display !== 'none') { vis = true; break; }
    }
    sec.style.display = vis ? '' : 'none';
  });
  route();
}

/* ---------- 初始化 ---------- */
window.addEventListener('hashchange', route);
// 側欄折疊群組：點標題展開/收合
document.querySelectorAll('[data-nav-group] .nav-group-hd').forEach(hd => {
  hd.onclick = () => hd.parentElement.classList.toggle('open');
});

$('#menu-btn').onclick = () => {
  $('#sidenav').classList.toggle('open');
  $('#overlay').classList.toggle('show');
};
$('#overlay').onclick = () => {
  $('#sidenav').classList.remove('open');
  $('#overlay').classList.remove('show');
};
$('#modal-close').onclick = closeModal;

$('#login-form').onsubmit = async e => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const r = await api('/login', {
      method: 'POST',
      body: {
        username: $('#login-username').value.trim(),
        password: $('#login-password').value
      }
    });
    currentUser = r.user;
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
};

$('#logout-btn').onclick = async () => {
  await api('/logout', { method: 'POST' });
  showLogin();
};

(async () => {
  try {
    const meta = await api('/meta');
    $('#login-brand').textContent = meta.center_name || 'MamaCare';
    document.title = `${meta.center_name || 'MamaCare'} 管理系統`;
  } catch (e) { /* 沿用預設名稱 */ }
  try {
    const r = await api('/me');
    if (r.user) {
      currentUser = r.user;
      showApp();
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
})();
