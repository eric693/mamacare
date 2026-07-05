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
const LOCATION_LABEL = { nursery: '嬰兒室', rooming: '親子同室', isolation: '隔離室', out: '不在館內' };
const LOCATION_BADGE = { nursery: 'teal', rooming: 'purple', isolation: 'yellow', out: 'green' };
// 寶寶房況卡片圖例顏色（標題＝性別、卡身＝狀態）
const BABY_LEGEND = [
  ['男', '#5ec8f2'], ['女', '#f291b2'],
  ['親子同室', '#d9a6ee'], ['隔離室', '#f6df7a'], ['不在館內', '#9ccc9c'], ['嬰兒室', '#ffffff']
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
    const table = bar.parentElement.querySelector('table');
    if (!table) return;
    const search = bar.querySelector('.flt-search');
    const count = bar.querySelector('.flt-count');
    const statusBtns = [...bar.querySelectorAll('[data-flt-status]')];
    let status = statusBtns.length ? statusBtns[0].dataset.fltStatus : '';
    const apply = () => {
      const q = search ? search.value.trim().toLowerCase() : '';
      let shown = 0, total = 0;
      table.querySelectorAll('tr[data-filter]').forEach(tr => {
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
      return `${r.feed_method || ''}${amt}`;
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
  const [d, reminders] = await Promise.all([api('/dashboard'), api('/reminders')]);
  const REM_LEVEL = { high: 'red', mid: 'yellow', low: 'gray' };
  const REM_TYPE = { checkout: '退房', unpaid: '帳款', contract: '合約', screening: '篩檢', incident: '異常', staffing: '人力', message: '留言', crm: '客訊', feeding: '餵奶', handover: '交班', cert: '證照', med: '給藥', vaccine: '疫苗', trend: '趨勢', tour: '跟進', care: '關懷' };
  const remCard = `
    <div class="card">
      <div class="row between"><h3>待辦提醒${reminders.count ? `　<span class="badge ${reminders.high ? 'red' : 'yellow'}">${reminders.count}</span>` : ''}</h3></div>
      ${reminders.items.length ? `<ul class="timeline">${reminders.items.map(it => `
        <li><a href="${it.link}" style="text-decoration:none;color:inherit">
          <span class="badge ${REM_LEVEL[it.level]}">${REM_TYPE[it.type] || ''}</span>
          ${esc(it.title)}${it.due ? `　<small style="color:var(--muted)">${esc(it.due)}</small>` : ''}</a></li>`).join('')}</ul>`
        : '<div class="empty">目前沒有待辦事項，一切就緒 👍</div>'}
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
  const upcoming = d.upcoming.length
    ? d.upcoming.map(u => `<li>${esc(u.check_in)}　${esc(u.mother_name)}　${esc(u.room_name)} 房</li>`).join('')
    : '<li class="empty">近期無預約入住</li>';
  const alerts = d.alerts.length
    ? d.alerts.map(a => `
      <li>
        <span class="badge red">${BABY_TYPE_LABEL[a.record_type]}異常</span>
        ${esc(a.baby_name)}：${esc(String(alertDetail(a)))}（${fmtTime(a.recorded_at)}）
      </li>`).join('')
    : '<li class="empty">今日無異常警示</li>';
  const tourList = d.tours.length
    ? d.tours.map(t => `<li>${esc(t.tour_at.slice(5, 16))}　${esc(t.name)}　${esc(t.phone)}${t.note ? `　<small>${esc(t.note)}</small>` : ''}</li>`).join('')
    : '<li class="empty">近期無待參觀預約</li>';
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
  const checkoutList = d.checkouts.length
    ? d.checkouts.map(c => `<li>${esc(c.check_out)}　${esc(c.mother_name)}　${esc(c.room_name)} 房</li>`).join('')
    : '<li class="empty">近 7 日無退房</li>';

  main().innerHTML = `
    <div class="page-title">總覽　<span style="font-weight:400;font-size:.85rem;color:var(--muted)">${todayStr()}</span></div>
    ${remCard}
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
      <h3>近 7 日退房</h3>
      <ul class="timeline">${checkoutList}</ul>
    </div>
    <div class="card">
      <h3>近期預約入住</h3>
      <ul class="timeline">${upcoming}</ul>
    </div>
    <div class="card">
      <h3>近期參觀預約</h3>
      <ul class="timeline">${tourList}</ul>
    </div>
    <div class="card">
      <h3>近 30 天入住率趨勢 (%)</h3>
      ${svgLineChart(d.occupancy_trend, { unit: '%' })}
    </div>`;
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
        for (const [id, rec] of posts) await api(`/babies/${id}/records`, { method: 'POST', body: rec });
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
        <button class="btn" id="bc-send" style="background:var(--accent)">發送日報給家屬</button>
      </div>
      <div class="row mt">
        <span style="font-size:.85rem;color:var(--muted)">一鍵記錄：</span>
        <button class="btn small secondary" data-quick="wet">濕尿布</button>
        <button class="btn small secondary" data-quick="stool">大便</button>
        <button class="btn small secondary" data-quick="bath">沐浴完成</button>
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
    const target = loc === 'nursery' ? 'rooming' : 'nursery';
    bar.innerHTML = `
      <span style="font-size:.85rem;color:var(--muted)">目前位置：</span>
      <span class="badge ${LOCATION_BADGE[loc]}">${LOCATION_LABEL[loc]}</span>
      <button class="btn small" id="bc-move">${loc === 'nursery' ? '抱去給媽媽（轉親子同室）' : '抱回嬰兒室'}</button>
      <button class="btn small secondary" id="bc-loc-log">位置異動紀錄</button>`;
    $('#bc-move').onclick = async () => {
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
    $('#bc-loc-log').onclick = () => showLocLogs(baby);
  };

  const refresh = async () => {
    renderLoc();
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
        fd.append('photo', file);
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
      <div class="row mt"><button class="btn" id="mc-assess">一頁式評估</button><button class="btn secondary" id="mc-add">單項紀錄</button></div>
    </div>
    <div class="card">
      <h3>當日紀錄</h3>
      <div id="mc-list"><div class="empty">載入中</div></div>
    </div>`;

  const refresh = async () => {
    const id = $('#mc-mother').value;
    if (!id) { $('#mc-list').innerHTML = '<div class="empty">尚無媽媽資料</div>'; return; }
    const rows = await api(`/mothers/${id}/records?date=${$('#mc-date').value}`);
    $('#mc-list').innerHTML = rows.length ? `<ul class="timeline">${rows.map(r => `
      <li>
        <div class="time">${fmtTime(r.recorded_at)}　${esc(r.nurse_name || '')}
          ${r.edited_at ? `<span class="badge gray" title="最後修改：${esc(r.edited_at)}">已修改</span>` : ''}
          <span style="float:right">
            <button class="btn small secondary" data-edit="${r.id}">編輯</button>
            ${currentUser.role === 'admin' ? `<button class="btn small danger" data-del="${r.id}">刪除</button>` : ''}
          </span>
        </div>
        <div class="what">${MOTHER_TYPE_LABEL[r.record_type] || r.record_type}</div>
        ${r.value_text ? `<div class="detail">${esc(r.value_text)}</div>` : ''}
        ${r.note ? `<div class="detail">${esc(r.note)}</div>` : ''}
      </li>`).join('')}</ul>` : '<div class="empty">當日尚無紀錄</div>';
    $('#mc-list').querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openMotherRecordEdit(rows.find(x => x.id == btn.dataset.edit), refresh));
    $('#mc-list').querySelectorAll('[data-del]').forEach(btn => btn.onclick = async () => {
      if (!confirm('確定刪除這筆紀錄？')) return;
      await api(`/mother-records/${btn.dataset.del}`, { method: 'DELETE' }); refresh();
    });
  };
  $('#mc-mother').onchange = refresh;
  $('#mc-date').onchange = refresh;

  $('#mc-assess').onclick = () => {
    const id = $('#mc-mother').value;
    if (!id) return;
    openMotherAssessment(id, refresh);
  };

  $('#mc-add').onclick = () => {
    const id = $('#mc-mother').value;
    if (!id) return;
    openModal('新增媽媽照護紀錄', `
      <div class="field">
        <label>紀錄類型</label>
        <select id="mr-type">${Object.entries(MOTHER_TYPE_LABEL)
          .map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>觀察內容</label>
        <textarea id="mr-value" placeholder="例如：BP 110/70, HR 76；或：子宮收縮良好"></textarea>
      </div>
      <div class="field">
        <label>備註</label>
        <input id="mr-note">
      </div>
      <div class="row mt">
        <button class="btn" id="mr-save">儲存</button>
        <span class="error-msg" id="mr-err"></span>
      </div>`, body => {
      body.querySelector('#mr-save').onclick = async () => {
        try {
          await api(`/mothers/${id}/records`, {
            method: 'POST',
            body: {
              record_type: body.querySelector('#mr-type').value,
              value_text: body.querySelector('#mr-value').value,
              note: body.querySelector('#mr-note').value
            }
          });
          closeModal();
          refresh();
        } catch (e) {
          body.querySelector('#mr-err').textContent = e.message;
        }
      };
    });
  };

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
        for (const r of records) await api(`/mothers/${motherId}/records`, { method: 'POST', body: r });
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
      <div class="row" style="margin-bottom:6px"><button class="btn small secondary" id="hn-draft" type="button">🪄 自動帶入草稿（依今日紀錄）</button></div>
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
  const [mothers, babies] = await Promise.all([api('/mothers'), api('/babies')]);
  main().innerHTML = `
    <div class="page-title">住客管理</div>
    <div class="card">
      <div class="row between">
        <h3>媽媽</h3>
        <button class="btn small" id="rs-add-mother">新增媽媽</button>
      </div>
      ${filterBar({ placeholder: '搜尋姓名 / 電話 / 房間…', statuses: [{ val: '', label: '全部' }, { val: 'reserved', label: '預約' }, { val: 'checked_in', label: '入住中' }, { val: 'checked_out', label: '已退房' }] })}
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>姓名</th><th>電話</th><th>房間</th><th>寶寶數</th><th>狀態</th><th></th></tr></thead>
          <tbody>${mothers.map(m => `
            <tr data-filter="${esc(m.name + ' ' + (m.phone || '') + ' ' + (m.room_name || ''))}" data-status="${m.status}">
              <td data-label="姓名">${esc(m.name)}</td>
              <td data-label="電話">${esc(m.phone)}</td>
              <td data-label="房間">${esc(m.room_name || '-')}</td>
              <td data-label="寶寶數">${m.baby_count}</td>
              <td data-label="狀態"><span class="badge ${STATUS_BADGE[m.status]}">${STATUS_LABEL[m.status]}</span></td>
              <td data-label="操作"><button class="btn small secondary" data-edit-mother="${m.id}">編輯</button></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="row between">
        <h3>寶寶</h3>
        <button class="btn small" id="rs-add-baby">新增寶寶</button>
      </div>
      ${filterBar({ placeholder: '搜尋寶寶 / 媽媽…', search: true })}
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>姓名</th><th>性別</th><th>出生日期</th><th>出生體重</th><th>媽媽</th><th>備註</th><th></th></tr></thead>
          <tbody>${babies.map(b => `
            <tr data-filter="${esc(b.name + ' ' + b.mother_name + ' ' + (b.notes || ''))}">
              <td data-label="姓名">${esc(b.name)}</td>
              <td data-label="性別">${b.gender === 'male' ? '男' : b.gender === 'female' ? '女' : '-'}</td>
              <td data-label="出生日期">${esc(b.birth_date || '-')}</td>
              <td data-label="出生體重">${b.birth_weight_g ? b.birth_weight_g + ' g' : '-'}</td>
              <td data-label="媽媽">${esc(b.mother_name)}</td>
              <td data-label="備註">${esc(b.notes || '-')}</td>
              <td data-label="操作"><button class="btn small secondary" data-edit-baby="${b.id}">編輯</button></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
  wireFilter(main());

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
        <div>🔕 勿擾時間：${r.hk_dnd ? esc(r.hk_dnd) : '<span style="color:var(--muted)">未設定</span>'}</div>
        <div style="margin-top:4px">🧺 需求：${needs.length ? needs.map(n => `<span class="badge teal">${esc(n)}</span>`).join(' ') : '<span style="color:var(--muted)">無</span>'}</div>
        ${r.hk_notes ? `<div style="margin-top:4px;color:#555">📝 ${esc(r.hk_notes)}</div>` : ''}
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

function openHkNeedsForm(r) {
  const cur = (r.hk_needs || '').split(',').map(s => s.trim()).filter(Boolean);
  const checks = hkNeedOptions().map(n =>
    `<label class="perm-chk"><input type="checkbox" value="${esc(n)}" ${cur.includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('');
  openModal(`清潔需求 — ${esc(r.room_name)} 房 ${esc(r.mother_name)}`, `
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
        closeModal(); viewHousekeeping();
      } catch (e) { body.querySelector('#hk-err').textContent = e.message; }
    };
  });
}

function openHkTaskForm(residents, date) {
  openModal('新增清潔任務', `
    <div class="form-grid">
      <div class="field full"><label>任務</label>
        <input id="hkt-task" list="hkt-presets" placeholder="例如：更換床單">
        <datalist id="hkt-presets">${hkTaskPresets().map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      </div>
      <div class="field full"><label>對象房間／住客（可不選＝公共區域）</label>
        <select id="hkt-target"><option value="">— 公共區域 / 不指定 —</option>${residents.map(r =>
          `<option value="${r.room_id}|${r.mother_id}">${esc(r.room_name)} 房　${esc(r.mother_name)}</option>`).join('')}</select></div>
      <div class="field"><label>排定日期</label><input type="date" id="hkt-date" value="${esc(date)}"></div>
      <div class="field full"><label>備註</label><input id="hkt-note"></div>
    </div>
    <div class="row mt"><button class="btn" id="hkt-save">新增</button><span class="error-msg" id="hkt-err"></span></div>`, body => {
    body.querySelector('#hkt-save').onclick = async () => {
      const task = body.querySelector('#hkt-task').value.trim();
      if (!task) { body.querySelector('#hkt-err').textContent = '請輸入任務'; return; }
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
  const rows = await api('/billing');
  main().innerHTML = `
    <div class="page-title">收費帳務</div>
    <div class="card">
      ${filterBar({ placeholder: '搜尋媽媽 / 房間…', statuses: [{ val: '', label: '全部' }, { val: 'unpaid', label: '未結清' }, { val: 'paid', label: '已結清' }] })}
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>媽媽</th><th>房間 / 期間</th><th>應收</th><th>已收</th><th>未結餘額</th><th></th></tr></thead>
          <tbody>${rows.map(b => `
            <tr data-filter="${esc(b.mother_name + ' ' + b.room_name)}" data-status="${b.balance > 0 ? 'unpaid' : 'paid'}">
              <td data-label="媽媽">${esc(b.mother_name)}　<span class="badge ${STATUS_BADGE[b.status]}">${STATUS_LABEL[b.status]}</span></td>
              <td data-label="房間 / 期間">${esc(b.room_name)} 房<br><small>${esc(b.check_in)} ~ ${esc(b.check_out)}</small></td>
              <td data-label="應收">${fmtMoney(b.total_due)}<br><small>合約 ${fmtMoney(b.total_amount)}＋加購 ${fmtMoney(b.charges_total)}${b.baby_deduct ? `−寶寶未入住 ${fmtMoney(b.baby_deduct)}` : ''}</small></td>
              <td data-label="已收">${fmtMoney(b.total_paid)}<br><small>含訂金 ${fmtMoney(b.deposit)}</small></td>
              <td data-label="未結餘額">${b.balance > 0
                ? `<strong style="color:var(--danger)">${fmtMoney(b.balance)}</strong> <span class="badge red">未結清</span><br><small>合約 ${fmtMoney(b.contract_balance)}＋加購 ${fmtMoney(b.addon_balance)}</small>`
                : '<span class="badge green">已結清</span>'}</td>
              <td data-label="操作"><button class="btn small secondary" data-detail="${b.id}">收費明細</button></td>
            </tr>`).join('') || '<tr><td colspan="6"><div class="empty">尚無訂房資料</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  wireFilter(main());
  main().querySelectorAll('[data-detail]').forEach(btn => {
    btn.onclick = () => {
      $('#modal').onclose = () => { $('#modal').onclose = null; viewBilling(); };
      openBillingDetail(btn.dataset.detail);
    };
  });
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
    ${b.baby_deduct ? `<p style="font-size:13px;color:#555;margin-top:10px">另：寶寶未入住扣抵 ${b.baby_absent_days} 天 −${fmtMoney(b.baby_deduct)}（已反映於應收總額）</p>` : ''}
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
      <td data-label="方式">${esc(p.method)}${p.note ? `<br><small>${esc(p.note)}</small>` : ''}</td>
      <td data-label="金額">${fmtMoney(p.amount)}</td>
      <td data-label="經手">${esc(p.staff_name || '-')}</td>
      <td data-label="操作">${isAdmin ? `<button class="btn small danger" data-del-pay="${p.id}">刪除</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty">尚無繳費紀錄</div></td></tr>';

  openModal(`收費明細：${b.mother_name}（${b.room_name} 房）`, `
    <div class="summary-grid" style="margin-bottom:14px">
      <div class="item"><div class="v">${fmtMoney(b.total_due)}</div><div class="k">應收（合約＋加購${b.baby_deduct ? '−扣抵' : ''}）</div></div>
      <div class="item"><div class="v">${fmtMoney(b.total_paid)}</div><div class="k">已收（含訂金 ${fmtMoney(b.deposit)}）</div></div>
      <div class="item"><div class="v" style="${b.balance > 0 ? 'color:var(--danger)' : ''}">${fmtMoney(b.balance)}</div><div class="k">未結餘額${b.balance > 0 ? `（合約 ${fmtMoney(b.contract_balance)}＋加購 ${fmtMoney(b.addon_balance)}）` : ''}</div></div>
      <div class="item"><div class="v">${b.balance > 0 ? '未結清' : '已結清'}</div><div class="k">帳務狀態</div></div>
    </div>
    <div class="row" style="margin-bottom:10px">
      <button class="btn small secondary" id="bd-refund">退費試算</button>
      <button class="btn small secondary" id="bd-receipt">開立收據</button>
      <button class="btn small secondary" id="bd-print-charges">列印加購明細</button>
    </div>
    <div class="card" style="background:#f7faf9;padding:10px 12px;margin-bottom:12px">
      <div class="row" style="align-items:flex-end;gap:10px;flex-wrap:wrap">
        <div class="field" style="max-width:170px;margin:0"><label>寶寶入住日</label><input type="date" id="bd-baby-in" value="${esc(b.baby_check_in || '')}" min="${esc(b.check_in || '')}"></div>
        <button class="btn small" id="bd-baby-save">儲存</button>
        <span style="font-size:.82rem;color:var(--muted)">媽媽入住 ${esc(b.check_in)}${b.baby_deduct
          ? `・寶寶未入住 ${b.baby_absent_days} 天，扣抵 <strong style="color:var(--primary-dark)">${fmtMoney(b.baby_deduct)}</strong>`
          : '・無扣抵（寶寶已隨媽媽入住或未設定）'}</span>
        <span class="error-msg" id="bd-baby-err"></span>
      </div>
      <p style="font-size:.76rem;color:var(--muted);margin:6px 0 0">媽媽已入住但寶寶尚未到院期間，每日自動扣抵（金額於系統設定調整，目前 ${fmtMoney((Number(SETTINGS.baby_absence_daily_deduct) || 0))}/日），扣抵已反映於上方應收。</p>
    </div>
    <div id="bd-refund-box"></div>
    <h3 style="color:var(--primary-dark);font-size:1rem;margin:8px 0">加購消費</h3>
    <div class="table-wrap"><table class="data stack">
      <thead><tr><th>日期</th><th>項目</th><th>金額</th><th>經手</th><th></th></tr></thead>
      <tbody>${chargeRows}</tbody>
    </table></div>
    <div class="form-grid" style="margin-top:10px">
      <div class="field">
        <label>項目名稱</label>
        <input id="cg-name" list="cg-presets" placeholder="例如：營養品">
        <datalist id="cg-presets">${chargePresets().map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      </div>
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
      <thead><tr><th>日期</th><th>方式</th><th>金額</th><th>經手</th><th></th></tr></thead>
      <tbody>${payRows}</tbody>
    </table></div>
    <div class="form-grid" style="margin-top:10px">
      <div class="field"><label>金額</label><input type="number" id="py-amount" inputmode="numeric" min="1"></div>
      <div class="field">
        <label>繳費方式</label>
        <select id="py-method">${paymentMethods().map(m => `<option>${esc(m)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>日期</label><input type="date" id="py-date" value="${todayStr()}"></div>
      <div class="field"><label>備註</label><input id="py-note" placeholder="例如：第二期款"></div>
      <div class="full row">
        <button class="btn small" id="py-save">新增繳費</button>
        <button class="btn small secondary" id="py-online" style="display:none">💳 線上收款</button>
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
    body.querySelector('#cg-save').onclick = async () => {
      try {
        await api(`/bookings/${b.id}/charges`, {
          method: 'POST',
          body: {
            item_name: body.querySelector('#cg-name').value.trim(),
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
    body.querySelector('#py-save').onclick = async () => {
      try {
        await api(`/bookings/${b.id}/payments`, {
          method: 'POST',
          body: {
            amount: Number(body.querySelector('#py-amount').value),
            method: body.querySelector('#py-method').value,
            paid_on: body.querySelector('#py-date').value,
            note: body.querySelector('#py-note').value
          }
        });
        openBillingDetail(b.id);
      } catch (e) {
        body.querySelector('#py-err').textContent = e.message;
      }
    };
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
              ${q.baby_deduct ? `<tr><td>扣抵：寶寶未入住 ${q.baby_absent_days} 天</td><td style="text-align:right;color:var(--primary-dark)">-${fmtMoney(q.baby_deduct)}</td></tr>` : ''}
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
    body.querySelector('#bd-baby-save').onclick = async () => {
      try {
        await api(`/bookings/${b.id}/baby-check-in`, { method: 'PUT', body: { baby_check_in: body.querySelector('#bd-baby-in').value } });
        openBillingDetail(b.id);
      } catch (e) { body.querySelector('#bd-baby-err').textContent = e.message; }
    };
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
      </p>
    </div>
    <div class="card no-print" id="ml-grid"><div class="empty">載入中</div></div>
    <div class="card" id="ml-kitchen"></div>
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
    const data = await api(`/meals?date=${$('#ml-date').value}`);
    const orderOf = (mid, mt) => data.orders.find(o => o.mother_id === mid && o.meal_type === mt);

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
                </select></td>`;
            }).join('')}
          </tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">該日無在住媽媽</div>');

    // 備餐單以「月子餐廠商（訂餐選項）」為主，方便分別給各家叫餐：A家明細、B家明細…
    // 廠商順序沿用系統設定，另把設定外但當日有訂的選項補在後面（不漏單）。
    const presentChoices = [...new Set(data.orders
      .filter(o => o.choice && o.choice !== '不需供餐').map(o => o.choice))];
    const settingOrder = mealChoices().filter(c => c !== '不需供餐' && presentChoices.includes(c));
    const vendors = [...settingOrder, ...presentChoices.filter(c => !settingOrder.includes(c))];
    const grandTotal = data.orders.filter(o => o.choice && o.choice !== '不需供餐').length;

    const sections = vendors.map(choice => {
      const byMeal = Object.keys(MEAL_LABEL).map(mt => ({
        mt,
        items: data.mothers.map(m => ({ m, o: orderOf(m.id, mt) }))
          .filter(x => x.o && x.o.choice === choice)
      })).filter(x => x.items.length);
      const total = byMeal.reduce((s, x) => s + x.items.length, 0);
      const summary = byMeal.map(x => `${MEAL_LABEL[x.mt]} ${x.items.length}`).join('、');
      const detail = byMeal.map(x => `
        <div style="margin:4px 0 8px">
          <div style="font-weight:600">${MEAL_LABEL[x.mt]}（${x.items.length} 份）</div>
          <ul class="timeline" style="margin-top:2px">${x.items.map(({ m }) => `
            <li>${esc(m.room_name)} 房　${esc(m.name)}${m.diet_notes ? `　<strong>注意：${esc(m.diet_notes)}</strong>` : ''}</li>`).join('')}</ul>
        </div>`).join('');
      return `
        <div class="card" style="margin:10px 0;padding:12px 14px">
          <h4 style="margin:0 0 6px;color:var(--primary-dark)">${esc(choice)} 明細　<span style="font-weight:400;font-size:.9rem;color:var(--muted)">共 ${total} 份（${summary}）</span></h4>
          ${detail}
        </div>`;
    }).join('');
    $('#ml-kitchen').innerHTML = `<h3>廚房備餐單（${data.date}）　<span style="font-weight:400;font-size:.9rem;color:var(--muted)">合計 ${grandTotal} 份</span></h3>`
      + (sections || '<div class="empty">當日尚無訂餐</div>');

    $('#ml-grid').querySelectorAll('[data-meal]').forEach(sel => {
      sel.onchange = async () => {
        const [mid, mt] = sel.dataset.meal.split(':');
        await api('/meals', {
          method: 'POST',
          body: { mother_id: Number(mid), meal_date: $('#ml-date').value, meal_type: mt, choice: sel.value }
        });
        refresh();
      };
    });
  };

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
    <div id="mp-body"><div class="empty">載入中</div></div>`;
  const draw = () => mealPlanTab === 'serving' ? drawServing() : drawMenu();
  $('#mp-date').onchange = draw;
  $('#mp-tab-serving').onclick = () => { mealPlanTab = 'serving'; $('#mp-tab-serving').classList.add('active'); $('#mp-tab-menu').classList.remove('active'); draw(); };
  $('#mp-tab-menu').onclick = () => { mealPlanTab = 'menu'; $('#mp-tab-menu').classList.add('active'); $('#mp-tab-serving').classList.remove('active'); draw(); };
  draw();
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
              <td data-label="姓名">${esc(t.name)}</td>
              <td data-label="電話">${esc(t.phone || '-')}</td>
              <td data-label="預產期">${esc(t.due_date || '-')}</td>
              <td data-label="來源">${esc(t.source || '-')}</td>
              <td data-label="狀態"><span class="badge ${TOUR_STATUS_BADGE[t.status]}">${TOUR_STATUS_LABEL[t.status]}</span></td>
              <td data-label="最近跟進">${t.last_log
                ? `${esc(t.last_log.length > 24 ? t.last_log.slice(0, 24) + '…' : t.last_log)}<br><small>${esc((t.last_log_at || '').slice(0, 16))}</small>`
                : (t.note ? esc(t.note.length > 24 ? t.note.slice(0, 24) + '…' : t.note) : '<span style="color:var(--muted)">-</span>')}${t.follow_up_date && ['scheduled', 'visited'].includes(t.status) ? `<br><small style="color:${t.follow_up_date < todayStr() ? 'var(--danger)' : 'var(--primary-dark)'}">📌 跟進 ${esc(t.follow_up_date)}</small>` : ''}</td>
              <td data-label="操作">
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
        <div class="field"><label>寶寶未入住每日扣抵（元）</label><input type="number" id="st-baby-deduct" min="0" value="${esc(s.baby_absence_daily_deduct || '0')}"></div>
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
  const [visits, babies, mothers] = await Promise.all([
    api('/physician-visits' + (spec ? `?specialty=${spec}` : '')), api('/babies'), api('/mothers')
  ]);
  const filterBtn = (val, label) => `<button class="btn small ${spec === val ? '' : 'secondary'}" data-filter="${val}">${label}</button>`;
  main().innerHTML = `
    <div class="page-title">醫師巡診就醫紀錄</div>
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <button class="btn" id="pv-new">＋ 新增巡診紀錄</button>
        <span style="flex:1"></span>
        ${filterBtn('', '全部')} ${filterBtn('pediatrics', '小兒科')} ${filterBtn('obgyn', '婦產科')} ${filterBtn('other', '其他')}
      </div>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>巡診時間</th><th>科別/類型</th><th>對象</th><th>醫師</th><th>評估/處置</th><th>追蹤</th><th>操作</th></tr></thead>
        <tbody>${visits.map(v => `
          <tr>
            <td data-label="巡診時間">${esc(v.visit_at)}<br><small>${esc(v.recorded_by_name || '')}</small></td>
            <td data-label="科別"><span class="badge teal">${VISIT_SPECIALTY_LABEL[v.specialty] || v.specialty}</span><br><small><span class="badge ${VISIT_TYPE_BADGE[v.visit_type] || 'gray'}">${VISIT_TYPE_LABEL[v.visit_type] || ''}</span></small></td>
            <td data-label="對象">${esc(v.baby_name || v.mother_name || '-')}<br><small>${v.subject_type === 'baby' ? '寶寶' : '媽媽'}</small></td>
            <td data-label="醫師">${esc(v.physician || '-')}</td>
            <td data-label="評估/處置">${esc((v.assessment || '').slice(0, 30))}${(v.assessment || '').length > 30 ? '…' : ''}<br><small>處置：${esc((v.plan || '').slice(0, 24))}</small></td>
            <td data-label="追蹤">${v.referral ? '<span class="badge red">轉診</span> ' : ''}${esc((v.follow_up || '').slice(0, 20))}</td>
            <td data-label="操作">
              <button class="btn small secondary" data-edit="${v.id}">檢視/編輯</button>
              ${isAdmin ? `<button class="btn small danger" data-del="${v.id}">刪除</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="7"><div class="empty">尚無巡診紀錄</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  main().querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { window._pvSpec = b.dataset.filter; viewPhysicianVisits(); });
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

function marForm(babyId) {
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
      try { await api(`/babies/${babyId}/meds`, { method: 'POST', body: payload }); closeModal(); renderNewbornMedical(babyId); }
      catch (e) { body.querySelector('#mar-err').textContent = e.message; }
    };
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
        ${isAdmin ? '<button class="btn small" id="shop-newprod">新增商品</button>' : ''}
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
    main().querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      const p = products.find(x => x.id == b.dataset.toggle);
      try { await api(`/products/${p.id}`, { method: 'PUT', body: { active: p.active ? 0 : 1 } }); viewShop(); }
      catch (e) { alert(e.message); }
    });
  }
  main().querySelector('#shop-neworder').onclick = () => openStaffOrderForm(products.filter(p => p.active));
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
        const fd = new FormData(); fd.append('image', f);
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
      <td data-label="操作">${isAdmin ? `<button class="btn small secondary" data-edit="${p.id}">編輯</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty">尚未建立課程／服務</div></td></tr>';
  main().innerHTML = `
    <div class="page-title">課程與服務</div>
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
  if (isAdmin) {
    main().querySelector('#pg-new').onclick = () => openProgramForm(null, distinctCats(progs));
    main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openProgramForm(progs.find(p => p.id == b.dataset.edit), distinctCats(progs)));
  }
}
function openProgramForm(p, cats) {
  const ed = p || {};
  openModal(ed.id ? '編輯課程／服務' : '新增課程／服務', `
    <div class="form-grid">
      <div class="field"><label>類型</label><select id="pg-kind">
        <option value="course" ${ed.kind === 'service' ? '' : 'selected'}>課程／活動</option>
        <option value="service" ${ed.kind === 'service' ? 'selected' : ''}>加購服務</option></select></div>
      <div class="field"><label>名稱 *</label><input id="pg-name" value="${esc(ed.name || '')}"></div>
      <div class="field"><label>分類</label><input id="pg-cat" value="${esc(ed.category || '')}" list="pg-cat-list" placeholder="例如：產後服務">${dataListValues('pg-cat-list', cats)}</div>
      <div class="field"><label>費用</label><input type="number" id="pg-price" min="0" value="${ed.price ?? 0}"></div>
      <div class="field"><label>名額（0=不限）</label><input type="number" id="pg-cap" min="0" value="${ed.capacity ?? 0}"></div>
      <div class="field"><label>時間（課程填，服務可空）</label><input id="pg-when" value="${esc(ed.scheduled_at || '')}" placeholder="2026-07-10 14:00"></div>
      <div class="field"><label>地點</label><input id="pg-loc" value="${esc(ed.location || '')}"></div>
      <div class="field"><label><input type="checkbox" id="pg-active" ${ed.active === 0 ? '' : 'checked'}> 開放報名</label></div>
      <div class="field full"><label>說明</label><textarea id="pg-desc" rows="2">${esc(ed.description || '')}</textarea></div>
      <div class="full row"><button class="btn" id="pg-save">儲存</button>
        ${ed.id ? '<button class="btn danger" id="pg-del">刪除</button>' : ''}
        <span class="error-msg" id="pg-err"></span></div>
    </div>`, body => {
    const v = id => body.querySelector(id);
    v('#pg-save').onclick = async () => {
      const payload = { kind: v('#pg-kind').value, name: v('#pg-name').value.trim(), category: v('#pg-cat').value.trim(),
        price: Number(v('#pg-price').value) || 0, capacity: Number(v('#pg-cap').value) || 0,
        scheduled_at: v('#pg-when').value.trim(), location: v('#pg-loc').value.trim(),
        description: v('#pg-desc').value, active: v('#pg-active').checked ? 1 : 0 };
      try { if (ed.id) await api(`/programs/${ed.id}`, { method: 'PUT', body: payload });
        else await api('/programs', { method: 'POST', body: payload });
        closeModal(); viewPrograms();
      } catch (e) { v('#pg-err').textContent = e.message; }
    };
    if (ed.id) v('#pg-del').onclick = async () => {
      if (!confirm('確定刪除？（已有報名者改為停止報名）')) return;
      try { await api(`/programs/${ed.id}`, { method: 'DELETE' }); closeModal(); viewPrograms(); }
      catch (e) { v('#pg-err').textContent = e.message; }
    };
  });
}
async function openSignupForm(progs) {
  const members = await api('/members');
  openModal('代客報名', `
    <div class="form-grid">
      <div class="field"><label>媽媽 *</label><select id="sg-mother"><option value="">請選擇</option>${members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field"><label>項目 *</label><select id="sg-prog"><option value="">請選擇</option>${progs.map(p => `<option value="${p.id}">${esc(p.name)}（${fmtMoney(p.price)}）</option>`).join('')}</select></div>
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
  const rows = await api('/members');
  main().innerHTML = `
    <div class="page-title">會員</div>
    <div class="card">
      ${filterBar({ placeholder: '搜尋姓名 / 會員編號…' })}
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>會員編號</th><th>姓名</th><th>電話</th><th>點數</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map(m => `
          <tr data-filter="${esc(m.name + ' ' + m.member_no + ' ' + (m.phone || ''))}">
            <td data-label="會員編號">${esc(m.member_no)}</td>
            <td data-label="姓名">${esc(m.name)}　<span class="badge ${STATUS_BADGE[m.status] || 'gray'}">${STATUS_LABEL[m.status] || m.status}</span></td>
            <td data-label="電話">${esc(m.phone || '-')}</td>
            <td data-label="點數"><strong>${m.points}</strong> 點</td>
            <td data-label="操作"><button class="btn small secondary" data-pts="${m.id}" data-name="${esc(m.name)}" data-cur="${m.points}">調整點數</button></td>
          </tr>`).join('') : '<tr><td colspan="5"><div class="empty">尚無會員</div></td></tr>'}</tbody>
      </table></div>
    </div>`;
  wireFilter(main());
  main().querySelectorAll('[data-pts]').forEach(b => b.onclick = () => openPointsAdjust(b.dataset.pts, b.dataset.name, b.dataset.cur));
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
  '出納／帳務': ['billing', 'invoices', 'members', 'shop', 'programs', 'coupons'],
  '廚房': ['meals'],
  '房務清潔': ['housekeeping', 'rooms'],
  '行政': ['residents', 'rooms', 'housekeeping', 'tours', 'contracts', 'family', 'shop', 'supplies', 'programs', 'members', 'reports']
};
async function viewUsers() {
  const [users, modules] = await Promise.all([api('/users'), api('/modules')]);
  window._modules = modules;
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
    let body = '';
    if (occ) {
      const babyLine = (occ.babies || []).length
        ? occ.babies.map(b => `${esc(b.name)} <span class="badge ${LOCATION_BADGE[b.location] || 'gray'}" style="font-weight:400">${LOCATION_LABEL[b.location] || '-'}</span>`).join('　')
        : '<span style="color:var(--muted)">尚未登記</span>';
      body = `
        <div class="rs-name">${esc(occ.mother_name)}<small style="color:var(--muted);font-weight:400">　${esc(occ.phone || '')}</small></div>
        <div class="rs-stay">
          <div class="rs-bar"><i style="width:${Math.min(100, Math.round(occ.stay_day / Math.max(occ.stay_total, 1) * 100))}%"></i></div>
          <small>第 ${occ.stay_day} / ${occ.stay_total} 天（${esc(occ.check_in)} ~ ${esc(occ.check_out)}）</small>
        </div>
        <div class="rs-kv">
          ${occ.delivery_type ? `<span>生產：${esc(occ.delivery_type)}${occ.delivery_date ? `（${esc(occ.delivery_date)}）` : ''}</span>` : ''}
          <span>膳食：${esc(occ.meal_diet || '一般')}${occ.diet_notes ? `・${esc(occ.diet_notes)}` : ''}</span>
          ${occ.hk_dnd ? `<span>🔕 勿擾：${esc(occ.hk_dnd)}</span>` : ''}
          ${occ.hk_needs ? `<span>房務需求：${esc(occ.hk_needs)}</span>` : ''}
          ${occ.medical_notes ? `<span style="color:var(--danger)">⚕ ${esc(occ.medical_notes)}</span>` : ''}
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
      ? `<div class="rs-next">下一筆：${esc(next.mother_name)}　${esc(next.check_in)} 入住</div>` : '';
    const actions = [
      occ && canAccess('#/mother-nursing') ? `<a class="btn small" href="#/mother-nursing?m=${occ.mother_id}">媽媽護理</a>` : '',
      occ && canAccess('#/mother-intake') ? `<a class="btn small" href="#/mother-intake?m=${occ.mother_id}">入住評估表</a>` : '',
      occ && canAccess('#/mother-care') ? `<a class="btn small secondary" href="#/mother-care">媽媽照護</a>` : '',
      occ && canAccess('#/housekeeping') ? `<button class="btn small secondary" data-hk-room="${r.id}" data-hk-mom="${occ.mother_id}" data-hk-label="${esc(r.name)}／${esc(occ.mother_name)}">＋房務任務</button>` : '',
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
        </div>
        <div class="row" style="gap:6px">
          <small style="color:var(--muted)">${esc(data.date)}</small>
          <button class="btn small secondary" id="rs-refresh">重新整理</button>
        </div>
      </div>
      <div class="board-grid mt" id="rs-grid">${cards || '<div class="empty">尚未建立房間</div>'}</div>
    </div>`;
  $('#rs-refresh').onclick = viewMotherRooms;
  wireBoardFilter(main(), '#rs-grid');
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

async function viewBabyRooms() {
  const data = await api('/room-status/babies');
  const st = data.stats;
  const feedGap = parseFloat(SETTINGS.feed_interval_hours) || 3;
  const tempHigh = parseFloat(SETTINGS.temp_high) || 37.5;
  const tempLow = parseFloat(SETTINGS.temp_low) || 36.0;
  const jaundiceAlert = parseFloat(SETTINGS.jaundice_alert) || 13;
  const canCare = canAccess('#/baby-care');
  const cards = data.babies.map(b => {
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
            <a class="btn small secondary" href="#/baby-care">照護紀錄</a>
          </div>
          <div class="row" style="gap:6px;align-items:center;margin-top:6px">
            <small style="color:var(--muted)">狀態切換：</small>
            <select data-loc-sel="${b.id}" data-name="${esc(b.name)}" data-loc="${b.location}" style="width:auto;padding:4px 8px;font-size:.85rem">
              ${['nursery', 'rooming', 'isolation', 'out'].map(l => `<option value="${l}" ${b.location === l ? 'selected' : ''}>${LOCATION_LABEL[l]}</option>`).join('')}
            </select>
          </div>
        </div>` : ''}
      </div>`;
  }).join('');
  const alertRows = data.alerts.map(a => `
    <tr><td data-label="時間">${esc(fmtTime(a.recorded_at))}</td>
      <td data-label="寶寶">${esc(a.baby_name)}</td>
      <td data-label="項目">${BABY_TYPE_LABEL[a.record_type] || a.record_type}</td>
      <td data-label="數值" style="color:var(--danger);font-weight:600">${esc(alertDetail(a))}</td></tr>`).join('');
  main().innerHTML = `
    <div class="page-title">寶寶房況</div>
    <div class="stat-grid">
      <div class="stat"><div class="num">${st.total}</div><div class="label">在住寶寶</div></div>
      <div class="stat"><div class="num">${st.nursery}</div><div class="label">嬰兒室</div></div>
      <div class="stat"><div class="num">${st.rooming}</div><div class="label">親子同室</div></div>
      <div class="stat"><div class="num" style="color:${st.isolation ? 'var(--warn)' : 'var(--primary)'}">${st.isolation}</div><div class="label">隔離室</div></div>
      <div class="stat"><div class="num">${st.out}</div><div class="label">不在館內</div></div>
      <div class="stat"><div class="num" style="color:${st.alerts ? 'var(--danger)' : 'var(--primary)'}">${st.alerts}</div><div class="label">今日異常紀錄</div></div>
    </div>
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
          <button class="btn small secondary" data-board-flt="alert">有警示</button>
        </div>
        <div class="row" style="gap:6px">
          <small style="color:var(--muted)">${esc(data.date)}</small>
          <button class="btn small secondary" id="bs-refresh">重新整理</button>
        </div>
      </div>
      <div class="row" style="gap:6px 16px;flex-wrap:wrap;margin-top:8px;font-size:.88rem;color:var(--muted)">
        ${BABY_LEGEND.map(([label, color]) => `<span><i class="legend-sq" style="background:${color}"></i>${label}</span>`).join('')}
      </div>
      <div class="board-grid mt" id="bs-grid">${cards || '<div class="empty">目前沒有在住寶寶</div>'}</div>
    </div>`;
  $('#bs-refresh').onclick = viewBabyRooms;
  wireBoardFilter(main(), '#bs-grid');
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
  ['您能看到事物有趣的一面，並笑得開心', [['完全不能', 3], ['肯定比以前少', 2], ['沒有以前那麼多', 1], ['同以前一樣', 0]]],
  ['您欣然期待未來的一切', [['完全不能', 3], ['肯定比以前少', 2], ['沒有以前那麼多', 1], ['同以前一樣', 0]]],
  ['當事情出錯時，您會不必要地責備自己', [['沒有這樣', 0], ['不經常這樣', 1], ['有時候這樣', 2], ['大部分時候這樣', 3]]],
  ['你無緣無故感到焦慮和擔心', [['經常這樣', 3], ['有時候這樣', 2], ['極少有', 1], ['一點也沒有', 0]]],
  ['您無緣無故感到害怕和驚慌', [['一點也沒有', 0], ['不經常這樣', 1], ['有時候這樣', 2], ['相當多時候這樣', 3]]],
  ['很多事情衝著您來時，使您透不過氣', [['您一直都能應付的好', 0], ['大部分時候您都能像平時那樣應付的好', 1], ['有時候您不能像平時那樣應付的好', 2], ['大多數時候您都不能應付', 3]]],
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

async function viewMotherNursing() {
  const all = await api('/mothers');
  const mothers = all.filter(m => m.status === 'checked_in');
  if (!mothers.length) {
    main().innerHTML = '<div class="page-title">媽媽護理</div><div class="card"><div class="empty">目前沒有在住媽媽</div></div>';
    return;
  }
  const want = Number((location.hash.split('?m=')[1] || '').split('&')[0]);
  const momId = mothers.some(m => m.id === want) ? want : mothers[0].id;
  const { mother, medical_no, rows, problems, scales, reminders, today_photo, baby_info } = await api(`/mothers/${momId}/nursing`);
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
        <a class="btn small secondary" href="#/mother-care">媽媽照護紀錄</a>
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
        <div class="row no-print" style="gap:6px">
          <button class="btn" data-guide="care">產婦護理指導單</button>
          <button class="btn" data-guide="breastfeeding">母乳哺育指導單</button>
        </div>
      </div>
    </div>
    <div class="card no-print" id="mna-form">
      <div class="sec-hd">媽媽護理資料－編輯（中衛日常評估欄位，<b>*</b> 為必填）</div>
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
    ${scaleCard('apgar')}
    ${scaleCard('bf_awareness')}
    ${scaleCard('epds')}
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
    fd.append('photo', f);
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
          closeModal(); viewMotherNursing();
        } catch (e) { err.textContent = e.message; }
      };
    });
  };
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
  const { mother, medical_no, record } = await api(`/mothers/${momId}/intake`);
  const d = (record && record.data) || {};
  const idNo = currentUser.id_no || '';

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
        <button class="btn small secondary" id="mi-print">資料列印</button>
        ${record ? `<small style="color:var(--muted)">最後存檔：${esc(record.updated_at)}（${esc(record.nurse_name || '—')}）</small>` : '<span class="badge yellow">尚未建立</span>'}
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
    </div>
    <div class="card no-print">
      <h3>寶寶親子同室－編輯</h3>
      <div class="form-grid">
        <div class="field"><label>護理紀錄日期 <b class="req">*</b></label><input type="date" id="brl-date" value="${todayStr()}"></div>
        <div class="field"><label>紀錄時間 <b class="req">*</b></label><input type="time" id="brl-time" value="${hhmm}"></div>
        <div class="field"><label>親餵（分鐘）</label><input type="number" min="0" id="brl-bf-min" placeholder="未親餵留空"></div>
        <div class="field"><label>母乳（ml）</label><input type="number" min="0" id="brl-bm"></div>
        <div class="field"><label>配方奶（ml）</label><input type="number" min="0" id="brl-fm"></div>
        <div class="field"><label>大便</label><input id="brl-stool" maxlength="50" placeholder="次數／性狀"></div>
        <div class="field"><label>小便</label><input id="brl-urine" maxlength="50" placeholder="次數／性狀"></div>
        <div class="field"><label>推出時間</label><input type="time" id="brl-out"></div>
        <div class="field"><label>返室時間</label><input type="time" id="brl-return"></div>
        <div class="field full"><label>敍述性護理紀錄<small>（限 300 字）</small></label><textarea id="brl-note" maxlength="300"></textarea></div>
        <div class="full row" style="gap:10px">
          <button class="btn" id="brl-save">資料新增</button>
          <span class="error-msg" id="brl-err"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>寶寶親子同室（${rooming.length} 筆）</h3>
      <div class="table-wrap">
        <table class="data stack">
          <thead><tr><th>護理日期</th><th>奶量</th><th>大便</th><th>小便</th><th>推出時間</th><th>返室時間</th><th>敍述性紀錄</th><th>建檔人</th><th class="no-print"></th></tr></thead>
          <tbody>${rooming.map(l => {
            const milk = [
              l.breastfeed_min != null ? `親餵 ${l.breastfeed_min} 分鐘` : '',
              l.breast_milk_ml != null ? `母乳 ${l.breast_milk_ml} ml` : '',
              l.formula_ml != null ? `配方奶 ${l.formula_ml} ml` : ''
            ].filter(Boolean).join('・');
            return `
            <tr>
              <td data-label="護理日期">${esc(l.log_date)}<br><small>${esc(l.log_time)}</small></td>
              <td data-label="奶量"><small>${esc(milk || '—')}</small></td>
              <td data-label="大便">${esc(l.stool || '—')}</td>
              <td data-label="小便">${esc(l.urine || '—')}</td>
              <td data-label="推出時間">${esc(l.out_time || '—')}</td>
              <td data-label="返室時間">${esc(l.return_time || '—')}</td>
              <td data-label="敍述性紀錄"><small>${esc(l.note || '—')}</small></td>
              <td data-label="建檔人">${esc(l.nurse_name || '—')}</td>
              <td data-label="" class="no-print">${currentUser.role === 'admin' ? `<button class="btn small danger" data-brl-del="${l.id}">刪除</button>` : ''}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="9"><div class="empty">尚無親子同室紀錄</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $('#brl-save').onclick = async () => {
    const err = $('#brl-err');
    err.textContent = '';
    const gv = id => $(id).value.trim();
    if (!gv('#brl-date') || !gv('#brl-time')) { err.textContent = '請填寫紀錄日期與時間'; return; }
    try {
      await api(`/babies/${babyId}/rooming-logs`, { method: 'POST', body: {
        log_date: gv('#brl-date'), log_time: gv('#brl-time'),
        breastfeed_min: gv('#brl-bf-min'), breast_milk_ml: gv('#brl-bm'), formula_ml: gv('#brl-fm'),
        stool: gv('#brl-stool'), urine: gv('#brl-urine'),
        out_time: gv('#brl-out'), return_time: gv('#brl-return'), note: gv('#brl-note')
      } });
      viewBabyNursing();
    } catch (e) { err.textContent = e.message; }
  };
  main().querySelectorAll('[data-brl-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定刪除這筆親子同室紀錄？')) return;
      await api(`/baby-rooming/${btn.dataset.brlDel}`, { method: 'DELETE' });
      viewBabyNursing();
    };
  });

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
  const { baby, rows, reminder } = await api(`/babies/${want}/breastfeeding`);
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
        <a class="btn small secondary" href="#/baby-nursing?b=${baby.id}">回寶寶護理</a>
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
        <div class="field"><label>目前體重（g）</label><input type="number" step="0.1" min="0" id="bfa-weight"></div>
        <div class="field"><label>生產方式</label><input value="${esc(baby.delivery_type || '—')}" disabled></div>
        <div class="field"><label>產後天數</label><input value="${ageDays}" disabled></div>
        <div class="field"><label>胎次</label><input id="bfa-parity" maxlength="20"></div>
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
      const fd = new FormData(); fd.append('photo', f);
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
  '#/baby-care': viewBabyCare,
  '#/newborn-medical': viewNewbornMedical,
  '#/physician-visits': viewPhysicianVisits,
  '#/mother-care': viewMotherCare,
  '#/handover': viewHandover,
  '#/incidents': viewIncidents,
  '#/infection': viewInfection,
  '#/residents': viewResidents,
  '#/rooms': viewRooms,
  '#/mother-rooms': viewMotherRooms,
  '#/baby-rooms': viewBabyRooms,
  '#/baby-nursing': viewBabyNursing,
  '#/baby-eval': viewBabyEval,
  '#/baby-doctor': viewBabyDoctor,
  '#/baby-handover': viewBabyHandover,
  '#/baby-close': viewBabyClosure,
  '#/mother-nursing': viewMotherNursing,
  '#/mother-intake': viewMotherIntake,
  '#/breastfeeding': viewBreastfeeding,
  '#/bed-planning': viewBedPlanning,
  '#/housekeeping': viewHousekeeping,
  '#/room-timeline': viewRoomTimeline,
  '#/billing': viewBilling,
  '#/aging': viewAging,
  '#/shop': viewShop,
  '#/supplies': viewSupplies,
  '#/programs': viewPrograms,
  '#/members': viewMembers,
  '#/coupons': viewCoupons,
  '#/invoices': viewInvoices,
  '#/contracts': viewContracts,
  '#/meals': viewMeals,
  '#/meal-plan': viewMealPlan,
  '#/tours': viewTours,
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
  '#/analytics': viewAnalytics,
  '#/testimonials': viewTestimonials
};
// 路由 → 所需模組權限（未列者免權限，例如總覽）
const ROUTE_PERM = {
  '#/baby-care': 'baby_care', '#/newborn-medical': 'newborn_medical', '#/physician-visits': 'physician', '#/mother-care': 'mother_care',
  '#/handover': 'handover', '#/incidents': 'incidents', '#/infection': 'infection',
  '#/residents': 'residents', '#/rooms': 'rooms', '#/mother-rooms': 'rooms', '#/baby-rooms': 'baby_care', '#/baby-nursing': 'baby_care', '#/baby-eval': 'baby_care', '#/baby-doctor': 'physician', '#/baby-handover': 'baby_care', '#/baby-close': 'baby_care', '#/mother-nursing': 'mother_care', '#/mother-intake': 'mother_care', '#/breastfeeding': 'baby_care', '#/bed-planning': 'rooms', '#/housekeeping': 'housekeeping', '#/room-timeline': 'rooms', '#/billing': 'billing', '#/aging': 'billing', '#/analytics': 'reports', '#/shop': 'shop',
  '#/supplies': 'supplies', '#/programs': 'programs', '#/members': 'members', '#/coupons': 'coupons',
  '#/invoices': 'invoices', '#/contracts': 'contracts', '#/meals': 'meals', '#/meal-plan': 'meals',
  '#/tours': 'tours', '#/shifts': 'shifts', '#/family': 'family', '#/crm': 'crm', '#/testimonials': 'testimonials', '#/reports': 'reports', '#/quality-report': 'reports',
  '#/gov': 'gov', '#/certifications': 'certifications', '#/surveys': 'surveys',
  '#/audit-logs': 'audit', '#/export': 'export', '#/settings': 'settings', '#/users': 'users'
};
function canAccess(hash) {
  const mod = ROUTE_PERM[hash];
  if (!mod) return true;
  return currentUser.role === 'admin' || (currentUser.modules || []).includes(mod);
}

async function route() {
  if (!currentUser) return;
  // 忽略 ?x= 查詢參數（如 #/baby-nursing?b=2、#/housekeeping?d=…），以基底路徑找路由
  const base = location.hash.split('?')[0];
  let hash = routes[base] ? base : '#/dashboard';
  if (!canAccess(hash)) hash = '#/dashboard';
  document.querySelectorAll('[data-nav]').forEach(a =>
    a.classList.toggle('active', a.getAttribute('href') === hash));
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
  // 隱藏底下沒有任何可見項目的分區標題
  document.querySelectorAll('[data-section]').forEach(sec => {
    let vis = false;
    for (let el = sec.nextElementSibling; el && !el.hasAttribute('data-section'); el = el.nextElementSibling) {
      if (el.matches('[data-nav]') && el.style.display !== 'none') { vis = true; break; }
    }
    sec.style.display = vis ? '' : 'none';
  });
  route();
}

/* ---------- 初始化 ---------- */
window.addEventListener('hashchange', route);

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
