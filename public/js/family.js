/* MamaCare 家屬入口 */

const $ = sel => document.querySelector(sel);

const TYPE_LABEL = {
  feeding: '餵食', diaper: '換尿布', temperature: '體溫', weight: '體重',
  jaundice: '黃疸值', bath: '沐浴', sleep: '睡眠', photo: '照片', note: '小提醒',
  respiration: '呼吸', heart_rate: '心跳', spo2: '血氧', length: '身長', head_circ: '頭圍',
  skin: '膚色', cord: '臍帶', vomit: '溢吐奶', activity: '活動力', stool: '大便性狀'
};
const FAM_NUM_UNIT = { temperature: '度C', weight: 'g', jaundice: 'mg/dL', respiration: '次/分', heart_rate: 'bpm', spo2: '%', length: 'cm', head_circ: 'cm' };

let family = null;
let activeTab = 'report';
let babyLocation = '';

function recordDetail(r) {
  switch (r.record_type) {
    case 'feeding': return `${r.feed_method || ''}${r.amount_ml ? ` ${r.amount_ml} ml` : ''}`;
    case 'diaper': {
      const base = r.diaper_kind === '便' ? '大便' : '小便(濕)';
      return r.diaper_rash && r.diaper_rash !== '無' ? `${base}・紅臀${r.diaper_rash}` : base;
    }
    case 'temperature': return `${r.value_num} 度C`;
    case 'weight': return `${r.value_num} g`;
    case 'jaundice': return `${r.value_num} mg/dL`;
    default:
      if (FAM_NUM_UNIT[r.record_type]) return r.value_num != null ? `${r.value_num} ${FAM_NUM_UNIT[r.record_type]}` : '';
      if (['skin', 'cord', 'vomit', 'activity', 'stool'].includes(r.record_type)) return r.value_text || '';
      return '';
  }
}

async function loadReport() {
  const date = $('#report-date').value;
  let rpt;
  try {
    rpt = await api(`/family/report?date=${date}`);
  } catch (e) {
    if (e.status === 401) { showLogin(); return; }
    $('#panel').innerHTML = `<div class="card"><div class="error-msg">${esc(e.message)}</div></div>`;
    return;
  }
  const s = rpt.summary;
  // 親子同室時才顯示「親子同室紀錄」分頁（讓家屬自行登記）
  babyLocation = rpt.baby.location;
  const roomingTab = $('#tab-rooming');
  if (roomingTab) roomingTab.hidden = babyLocation !== 'rooming';
  $('#baby-title').textContent = `${rpt.baby.name} 的一天`;
  const days = rpt.baby.birth_date
    ? Math.floor((new Date(date) - new Date(rpt.baby.birth_date)) / 86400000) + 1 : null;
  $('#baby-sub').textContent =
    `${date}${days && days > 0 ? `　出生第 ${days} 天` : ''}　媽媽：${rpt.baby.mother_name}`;

  if (activeTab === 'report') {
    const extra = [];
    if (s.respiration_latest != null) extra.push([`${s.respiration_latest} 次/分`, '呼吸']);
    if (s.heart_rate_latest != null) extra.push([`${s.heart_rate_latest} bpm`, '心跳']);
    if (s.spo2_latest != null) extra.push([`${s.spo2_latest}%`, '血氧']);
    if (s.length_latest != null) extra.push([`${s.length_latest} cm`, '身長']);
    if (s.head_circ_latest != null) extra.push([`${s.head_circ_latest} cm`, '頭圍']);
    if (s.skin_latest) extra.push([esc(s.skin_latest), '膚色']);
    if (s.activity_latest) extra.push([esc(s.activity_latest), '活動力']);
    if (s.stool_latest) extra.push([esc(s.stool_latest), '大便性狀']);
    const alertCard = (rpt.alerts && rpt.alerts.length)
      ? `<div class="card" style="background:#fdecea;border-left:4px solid #d9534f;padding:10px 12px">
          <strong style="color:#c0392b">⚠ 今日需注意</strong>
          <ul style="margin:6px 0 0;padding-left:18px">${rpt.alerts.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : '';
    $('#panel').innerHTML = `
      ${alertCard}
      <div class="card">
        <h3>今日摘要</h3>
        <div class="summary-grid">
          <div class="item"><div class="v">${s.feed_count} 次</div><div class="k">餵食次數</div></div>
          <div class="item"><div class="v">${s.feed_total_ml} ml</div><div class="k">瓶餵總量</div></div>
          <div class="item"><div class="v">濕 ${s.diaper_wet} / 便 ${s.diaper_stool}</div><div class="k">尿布</div></div>
          <div class="item"><div class="v">${s.rash_worst ?? '未評估'}</div><div class="k">紅臀</div></div>
          <div class="item"><div class="v">${s.temp_latest ?? '-'}</div><div class="k">最新體溫 (度C)</div></div>
          <div class="item"><div class="v">${s.weight_latest_g ?? '-'}</div><div class="k">體重 (g)</div></div>
          <div class="item"><div class="v">${s.jaundice_latest ?? '-'}</div><div class="k">黃疸 (mg/dL)</div></div>
          <div class="item"><div class="v">${s.bath_done ? '已完成' : '未安排'}</div><div class="k">沐浴</div></div>
          ${extra.map(([v, k]) => `<div class="item"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')}
          <div class="item"><div class="v">${rpt.photos.length} 張</div><div class="k">今日照片</div></div>
        </div>
      </div>
      ${rpt.photos.length ? `
      <div class="card">
        <h3>今日照片</h3>
        <div class="photo-grid">${rpt.photos.map(p => `
          <figure>
            <img src="/uploads/${esc(p.photo_file)}" loading="lazy">
            <figcaption>${esc(p.note || '')} ${fmtTime(p.recorded_at)}</figcaption>
          </figure>`).join('')}</div>
      </div>` : ''}`;
  } else if (activeTab === 'timeline') {
    const items = rpt.records.filter(r => r.record_type !== 'photo');
    $('#panel').innerHTML = `
      <div class="card">
        <h3>完整照護時間軸</h3>
        ${items.length ? `<ul class="timeline">${items.map(r => `
          <li>
            <div class="time">${fmtTime(r.recorded_at)}</div>
            <div class="what">${TYPE_LABEL[r.record_type] || r.record_type}
              <span style="font-weight:400">${esc(recordDetail(r))}</span></div>
            ${r.note ? `<div class="detail">${esc(r.note)}</div>` : ''}
          </li>`).join('')}</ul>` : '<div class="empty">這一天還沒有紀錄</div>'}
      </div>`;
  } else if (activeTab === 'photos') {
    let photos = [];
    try { photos = await api('/family/photos'); } catch (e) { /* 沿用空陣列 */ }
    $('#panel').innerHTML = `
      <div class="card">
        <h3>照片牆（最近 60 張）</h3>
        ${photos.length ? `<div class="photo-grid">${photos.map(p => `
          <figure>
            <img src="/uploads/${esc(p.photo_file)}" loading="lazy">
            <figcaption>${esc(p.note || '')} ${esc((p.recorded_at || '').slice(0, 16))}</figcaption>
          </figure>`).join('')}</div>` : '<div class="empty">還沒有照片，護理師上傳後會出現在這裡</div>'}
      </div>`;
  } else if (activeTab === 'messages') {
    await loadMessages();
    return;
  } else {
    let t = { weight: [], jaundice: [], feeds: [] };
    try { t = await api('/family/trends'); } catch (e) { /* 沿用空資料 */ }
    $('#panel').innerHTML = `
      <div class="card">
        <h3>體重趨勢 (g)</h3>
        ${svgLineChart(t.weight, { unit: 'g' })}
      </div>
      <div class="card">
        <h3>黃疸趨勢 (mg/dL)</h3>
        ${svgLineChart(t.jaundice, { color: '#b8860b' })}
      </div>
      <div class="card">
        <h3>每日瓶餵總量 (ml)</h3>
        ${svgLineChart(t.feeds.map(f => ({ date: f.date, value: f.total_ml })), { unit: 'ml', color: '#d77a8a' })}
      </div>`;
  }
}

async function loadMessages() {
  let msgs = [], rpt = null;
  try {
    [msgs, rpt] = await Promise.all([api('/family/messages'), api('/family/report')]);
  } catch (e) {
    if (e.status === 401) { showLogin(); return; }
  }
  const babyName = (rpt && rpt.baby && rpt.baby.name) || '寶寶';
  const motherName = (rpt && rpt.baby && rpt.baby.mother_name) || '媽媽';
  // 我送出的護理需求留言（非對話；依媽媽／寶寶區分），護理站回覆以附註呈現
  const items = msgs.map(m => {
    if (m.sender === 'family') {
      const who = m.subject_type === 'mother' ? '媽媽' : '寶寶';
      const done = m.read_by_staff;
      return `<div class="card" style="margin:8px 0;padding:10px 12px">
        <div style="font-size:.75rem;color:#888">${esc(m.created_at)}</div>
        <div style="margin:3px 0"><span class="badge ${m.subject_type === 'mother' ? 'teal' : 'gray'}">${who}的護理需求</span>
          <span class="badge ${done ? 'green' : 'yellow'}">${done ? '已處理' : '待處理'}</span></div>
        <div>${esc(m.body)}</div></div>`;
    }
    return `<div style="margin:8px 0 8px 14px;padding:8px 12px;background:#f0f0f0;border-radius:10px">
      <div style="font-size:.72rem;color:#888">護理站回覆・${esc(m.created_at)}</div>${esc(m.body)}</div>`;
  }).join('');
  $('#panel').innerHTML = `
    <div class="card">
      <h3>聯絡護理站</h3>
      <p style="font-size:.85rem;color:#888">有任何照護需求都可以在這裡留言，請先選擇這是「媽媽」或「寶寶」的需求，護理站看到後會盡快處理。</p>
      <div class="field"><label>需求對象</label>
        <select id="msg-subject">
          <option value="baby">寶寶（${esc(babyName)}）</option>
          <option value="mother">媽媽（${esc(motherName)}）</option>
        </select></div>
      <div class="field"><textarea id="msg-body" rows="3" placeholder="輸入護理需求或想告知護理站的事…"></textarea></div>
      <div class="row"><button class="btn" id="msg-send">送出留言</button><span class="error-msg" id="msg-err"></span></div>
    </div>
    <div class="card">
      <h3>我的留言紀錄</h3>
      <div style="max-height:52vh;overflow:auto;margin-top:6px">${items || '<div class="empty">還沒有留言，送出第一則需求給護理站吧！</div>'}</div>
    </div>`;
  $('#msg-send').onclick = async () => {
    const text = $('#msg-body').value.trim();
    if (!text) return;
    try {
      await api('/family/messages', { method: 'POST', body: { body: text, subject_type: $('#msg-subject').value } });
      loadMessages();
    } catch (e) { $('#msg-err').textContent = e.message; }
  };
}

// 親子同室紀錄：寶寶在媽媽房內時，家屬可自行一鍵登記餵奶／尿布／睡眠／小提醒
async function loadRooming() {
  const date = $('#report-date').value;
  let rpt;
  try { rpt = await api(`/family/report?date=${date}`); }
  catch (e) { if (e.status === 401) { showLogin(); return; }
    $('#panel').innerHTML = `<div class="card"><div class="error-msg">${esc(e.message)}</div></div>`; return; }
  babyLocation = rpt.baby.location;
  const roomingTab = $('#tab-rooming'); if (roomingTab) roomingTab.hidden = babyLocation !== 'rooming';
  if (babyLocation !== 'rooming') {
    $('#panel').innerHTML = `<div class="card"><h3>親子同室紀錄</h3>
      <div class="empty">寶寶目前不在親子同室，暫時無法自行登記。<br>當護理站將寶寶抱來親子同室後，這裡就能自己記錄囉！</div></div>`;
    return;
  }
  const items = rpt.records.filter(r => r.record_type !== 'photo');
  $('#panel').innerHTML = `
    <div class="card">
      <h3>親子同室紀錄</h3>
      <p style="font-size:.85rem;color:#888">寶寶在您房內時，餵奶、換尿布、睡眠都可以自己記錄，護理站也會同步看到。</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin:8px 0">
        <button class="btn small" data-fr="feeding-親餵">親餵</button>
        <button class="btn small" data-fr="feeding-瓶餵">瓶餵…</button>
        <button class="btn small secondary" data-fr="diaper-濕">濕尿布</button>
        <button class="btn small secondary" data-fr="diaper-便">大便</button>
        <button class="btn small secondary" data-fr="sleep">睡眠</button>
        <button class="btn small secondary" data-fr="note">小提醒…</button>
      </div>
      <span class="error-msg" id="fr-err"></span>
    </div>
    <div class="card">
      <h3>今日登記（${esc(date)}）</h3>
      ${items.length ? `<ul class="timeline">${items.map(r => `
        <li>
          <div class="time">${fmtTime(r.recorded_at)}</div>
          <div class="what">${TYPE_LABEL[r.record_type] || r.record_type}
            <span style="font-weight:400">${esc(recordDetail(r))}</span></div>
          ${r.note ? `<div class="detail">${esc(r.note)}</div>` : ''}
        </li>`).join('')}</ul>` : '<div class="empty">今天還沒有紀錄，點上方按鈕開始登記</div>'}
    </div>`;
  $('#panel').querySelectorAll('[data-fr]').forEach(btn => btn.onclick = async () => {
    const key = btn.dataset.fr;
    let body;
    if (key === 'feeding-親餵') body = { record_type: 'feeding', feed_method: '親餵' };
    else if (key === 'feeding-瓶餵') {
      const v = prompt('瓶餵奶量（ml），可留空：', '');
      if (v === null) return;
      body = { record_type: 'feeding', feed_method: '瓶餵', amount_ml: v.trim() === '' ? '' : v.trim() };
    } else if (key === 'diaper-濕') body = { record_type: 'diaper', diaper_kind: '濕' };
    else if (key === 'diaper-便') body = { record_type: 'diaper', diaper_kind: '便' };
    else if (key === 'sleep') body = { record_type: 'sleep' };
    else if (key === 'note') {
      const t = prompt('想記下的小提醒：', '');
      if (t === null || !t.trim()) return;
      body = { record_type: 'note', note: t.trim() };
    }
    try { await api('/family/records', { method: 'POST', body }); loadRooming(); }
    catch (e) { $('#fr-err').textContent = e.message; }
  });
}

async function loadSiblings() {
  try {
    const s = await api('/family/siblings');
    const wrap = $('#sibling-wrap'), sel = $('#sibling-select');
    if (s.babies && s.babies.length > 1) {
      sel.innerHTML = s.babies.map(b => `<option value="${b.id}" ${b.id === s.current ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
      wrap.hidden = false;
      sel.onchange = async () => {
        await api('/family/switch-baby', { method: 'POST', body: { baby_id: Number(sel.value) } });
        loadReport();
      };
    } else {
      wrap.hidden = true;
    }
  } catch (e) { /* 單胞胎或未登入，忽略 */ }
}

function setTab(tab) {
  activeTab = tab;
  ['report', 'rooming', 'timeline', 'photos', 'trends', 'meal', 'shop', 'programs', 'visitors', 'survey', 'messages'].forEach(t =>
    $(`#tab-${t}`).classList.toggle('active', t === tab));
  if (tab !== 'meal') $('#report-date').removeAttribute('max'); // 月子餐分頁才限制日期至出住日
  if (tab === 'shop') { loadShop(); return; }
  if (tab === 'programs') { loadPrograms(); return; }
  if (tab === 'visitors') { loadVisitors(); return; }
  if (tab === 'meal') { loadConfinementMeal(); return; }
  if (tab === 'survey') { loadSurveys(); return; }
  if (tab === 'rooming') { loadRooming(); return; }
  loadReport();
}

async function loadSurveys() {
  let surveys = [];
  try { surveys = await api('/family/surveys'); }
  catch (e) { if (e.status === 401) { showLogin(); return; }
    $('#panel').innerHTML = `<div class="card"><div class="error-msg">${esc(e.message)}</div></div>`; return; }
  if (!surveys.length) { $('#panel').innerHTML = '<div class="card"><h3>滿意度問卷</h3><div class="empty">目前沒有開放的問卷</div></div>'; return; }
  $('#panel').innerHTML = surveys.map(s => {
    if (s.submitted) return `<div class="card"><h3>${esc(s.title)}</h3><div class="badge green">已完成，感謝您的回饋！</div></div>`;
    const qs = s.questions.map((q, i) => {
      const name = `q_${s.id}_${i}`;
      if (q.type === 'rating') return `<div class="field"><label>${esc(q.label)}</label>
        <select data-ans="${s.id}:${i}"><option value="">請選擇</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${n} 分${n === 5 ? '（非常滿意）' : n === 1 ? '（非常不滿意）' : ''}</option>`).join('')}</select></div>`;
      if (q.type === 'choice') return `<div class="field"><label>${esc(q.label)}</label>
        <select data-ans="${s.id}:${i}"><option value="">請選擇</option>${(q.options || []).map(o => `<option>${esc(o)}</option>`).join('')}</select></div>`;
      return `<div class="field"><label>${esc(q.label)}</label><textarea data-ans="${s.id}:${i}" rows="2"></textarea></div>`;
    }).join('');
    return `<div class="card">
      <h3>${esc(s.title)}</h3>${s.description ? `<p style="font-size:.85rem;color:var(--muted)">${esc(s.description)}</p>` : ''}
      <div class="form-grid">${qs}</div>
      <div class="row" style="margin-top:8px"><button class="btn" data-submit="${s.id}">送出問卷</button><span class="error-msg" data-err="${s.id}"></span><span style="color:var(--ok)" data-ok="${s.id}"></span></div>
    </div>`;
  }).join('');
  $('#panel').querySelectorAll('[data-submit]').forEach(btn => btn.onclick = async () => {
    const sid = btn.dataset.submit;
    const answers = {};
    $('#panel').querySelectorAll(`[data-ans^="${sid}:"]`).forEach(el => {
      const i = el.dataset.ans.split(':')[1];
      if (el.value !== '') answers[i] = el.value;
    });
    $('#panel').querySelector(`[data-err="${sid}"]`).textContent = '';
    try { const r = await api(`/family/surveys/${sid}`, { method: 'POST', body: { answers } });
      $('#panel').querySelector(`[data-ok="${sid}"]`).textContent = r.message || '已送出';
      setTimeout(loadSurveys, 800);
    } catch (e) { $('#panel').querySelector(`[data-err="${sid}"]`).textContent = e.message; }
  });
}

async function loadConfinementMeal() {
  const date = $('#report-date').value;
  let plan;
  try { plan = await api(`/family/meal-plan?date=${date}`); }
  catch (e) {
    if (e.status === 401) { showLogin(); return; }
    $('#panel').innerHTML = `<div class="card"><div class="error-msg">${esc(e.message)}</div></div>`;
    return;
  }
  if (!plan.available) {
    $('#panel').innerHTML = '<div class="card"><h3>月子餐</h3><div class="empty">這一天沒有在住資料</div></div>';
    return;
  }
  let swaps = [];
  try { swaps = await api('/family/meal-swap'); } catch (e) { swaps = []; }
  const SWST = { pending: ['待審核', 'yellow'], approved: ['已同意', 'green'], rejected: ['未同意', 'red'] };
  // 日期最多可看到出住日
  if (plan.check_out) $('#report-date').max = plan.check_out;
  // 各家月子餐當周菜單（廚房上傳的週菜單檔案；圖片直接顯示、PDF 開新頁）
  const fileView = f => !f ? '<div class="empty">尚未公布當周菜單</div>'
    : /\.pdf$/i.test(f.file)
      ? `<a class="btn small" href="/uploads/${esc(f.file)}" target="_blank">檢視菜單（PDF）</a><small style="color:var(--muted)">　週起 ${esc(f.week_start || '')}</small>`
      : `<a href="/uploads/${esc(f.file)}" target="_blank"><img src="/uploads/${esc(f.file)}" alt="菜單" style="max-width:100%;border-radius:8px"></a><div><small style="color:var(--muted)">週起 ${esc(f.week_start || '')}</small></div>`;
  const menuCards = (plan.menu_files || []).map(x => `
    <div class="card" style="margin:0">
      <h4 style="margin:0 0 6px;color:var(--primary-dark)">${esc(x.vendor)} 當周菜單${plan.current_choice === x.vendor ? '　<span class="badge green">目前配合</span>' : ''}</h4>
      ${fileView(x.file)}
    </div>`).join('')
    + (plan.general_menu_file ? `
    <div class="card" style="margin:0">
      <h4 style="margin:0 0 6px;color:var(--primary-dark)">本中心菜單</h4>
      ${fileView(plan.general_menu_file)}
    </div>` : '');
  const swapLocked = plan.swap_locked;
  $('#panel').innerHTML = `
    <div class="card">
      <h3>${esc(plan.mother_name)} 的月子餐</h3>
      <p style="font-size:.85rem;color:var(--muted)">${esc(date)}　產後第 ${plan.postpartum_day ?? '-'} 天　餐別：${esc(plan.current_choice || '尚未安排')}　飲食注意：${esc(plan.diet_notes || '無')}</p>
    </div>
    <div style="display:grid;gap:10px;margin-top:4px">${menuCards || '<div class="card" style="margin:0"><div class="empty">尚未公布菜單</div></div>'}</div>
    <div class="card" style="margin-top:10px">
      <h3>我要換餐</h3>
      <p style="font-size:.85rem;color:var(--muted)">若餐點需要調整，可線上申請更換月子餐廠商，由客服確認。換餐以「天」為單位，自開始日早餐起至出住日。每日 14:00 前申請可自次日早餐起，之後自後天早餐起；7 天內限換餐一次，需再調整請至「聯絡護理站」留言。</p>
      ${swapLocked ? `<div class="empty" style="color:var(--warn)">7 天內已申請過換餐（${esc((plan.swap_last_at || '').slice(0, 16))}），如需調整請聯絡客服。</div>` : `
      <div class="field"><label>換餐開始日期（早餐起）</label><input type="date" id="sw-date" value="${esc(plan.swap_min_start)}" min="${esc(plan.swap_min_start)}" ${plan.check_out ? `max="${esc(plan.check_out)}"` : ''}></div>
      <div class="field"><label>希望更換為</label><select id="sw-to">${(plan.choices || []).map(c => `<option ${c === plan.current_choice ? 'disabled' : ''}>${esc(c)}${c === plan.current_choice ? '（目前配合）' : ''}</option>`).join('')}</select></div>
      <div class="field"><label>原因／備註</label><textarea id="sw-reason" rows="2" placeholder="例如：對某食材過敏"></textarea></div>
      <div class="row"><button class="btn" id="sw-send">送出換餐申請</button><span class="error-msg" id="sw-err"></span><span id="sw-ok" style="color:var(--ok)"></span></div>`}
      <h4 style="margin:12px 0 4px">我的換餐申請</h4>
      ${swaps.length ? `<div class="table-wrap"><table class="data stack">
        <thead><tr><th>開始日</th><th>更換為</th><th>原因</th><th>狀態</th></tr></thead>
        <tbody>${swaps.map(s => `<tr>
          <td data-label="開始日"><small>${esc(s.meal_date)}${s.slot === '早餐起' ? '（早餐起）' : s.slot ? `（${esc(s.slot)}）` : ''}</small></td>
          <td data-label="更換為">${esc(s.to_choice || '')}</td>
          <td data-label="原因"><small style="color:var(--muted)">${esc(s.reason || '—')}</small>${s.staff_note ? `<br><small>客服：${esc(s.staff_note)}</small>` : ''}</td>
          <td data-label="狀態"><span class="badge ${SWST[s.status] ? SWST[s.status][1] : 'gray'}">${SWST[s.status] ? SWST[s.status][0] : s.status}</span></td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="empty">尚無換餐申請</div>'}
    </div>`;
  const send = $('#sw-send');
  if (send) send.onclick = async () => {
    $('#sw-err').textContent = ''; $('#sw-ok').textContent = '';
    const to = $('#sw-to').value.replace('（目前配合）', ''), reason = $('#sw-reason').value.trim();
    try {
      await api('/family/meal-swap', { method: 'POST', body: {
        meal_date: $('#sw-date').value, to_choice: to, from_choice: plan.current_choice || '', reason
      } });
      $('#sw-ok').textContent = '已送出，請待客服確認';
      loadConfinementMeal();
    } catch (e) { $('#sw-err').textContent = e.message; }
  };
}

const shopCart = {};
async function loadShop() {
  let products = [], orders = [], member = { points: 0, points_enabled: false, points_value: 1, points_earn_per: 100 };
  try {
    [products, orders, member] = await Promise.all([api('/family/products'), api('/family/orders'), api('/family/member')]);
  } catch (e) {
    if (e.status === 401) { showLogin(); return; }
    $('#panel').innerHTML = `<div class="card"><div class="error-msg">${esc(e.message)}</div></div>`;
    return;
  }
  const cards = products.length ? products.map(p => {
    const soldOut = p.track_stock && p.stock <= 0;
    return `
    <div class="prod-card${soldOut ? ' off' : ''}">
      <div class="prod-img">${p.image ? `<img src="${esc(p.image)}" loading="lazy">` : '<div class="ph">無圖片</div>'}${soldOut ? '<span class="prod-off">已售完</span>' : ''}</div>
      <div class="prod-body">
        <div class="prod-name">${esc(p.name)}</div>
        ${p.category ? `<div class="prod-meta"><span class="badge gray">${esc(p.category)}</span></div>` : ''}
        ${p.description ? `<div class="prod-meta"><small>${esc(p.description)}</small></div>` : ''}
        <div class="prod-meta"><strong>${fmtMoney(p.price)}</strong></div>
        ${soldOut ? '<div class="prod-meta"><small style="color:var(--danger)">暫無庫存</small></div>'
          : `<div class="row" style="margin-top:6px;align-items:center">
              <label style="font-size:.8rem;color:var(--muted)">數量</label>
              <input type="number" min="0" value="${shopCart[p.id] || 0}" data-cart="${p.id}" style="width:64px">
            </div>`}
      </div>
    </div>`;
  }).join('') : '<div class="empty">目前沒有上架商品</div>';

  const ORDER_STATUS = { pending: '待確認', confirmed: '已確認', cancelled: '已取消' };
  const orderRows = orders.length ? orders.map(o => `
    <tr>
      <td data-label="日期"><small>${esc((o.created_at || '').slice(0, 16))}</small></td>
      <td data-label="品項">${o.items.map(i => `${esc(i.item_name)}×${i.quantity}`).join('、')}</td>
      <td data-label="金額">${fmtMoney(o.total_amount)}</td>
      <td data-label="狀態"><span class="badge ${o.status === 'confirmed' ? 'green' : o.status === 'cancelled' ? 'red' : 'yellow'}">${ORDER_STATUS[o.status] || o.status}</span></td>
    </tr>`).join('') : '<tr><td colspan="4"><div class="empty">尚無訂購紀錄</div></td></tr>';

  $('#panel').innerHTML = `
    <div class="card">
      <h3>商城</h3>
      <p style="font-size:.85rem;color:var(--muted)">選購商品後送出訂單，護理站確認後會列入您的帳單，於現場結算。${member.points_enabled ? `<br>會員 ${esc(member.member_no || '')}　目前 <strong>${member.points}</strong> 點（每滿 ${member.points_earn_per} 元回饋 1 點，1 點折抵 ${member.points_value} 元）。` : ''}</p>
      <div class="prod-grid" style="margin-top:10px">${cards}</div>
      <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <div class="field" style="flex:1;min-width:140px"><label>優惠券碼</label><input id="shop-coupon" placeholder="選填"></div>
          ${member.points_enabled ? `<div class="field" style="flex:1;min-width:140px"><label>使用點數（最多 ${member.points}）</label><input type="number" id="shop-points" min="0" max="${member.points}" value="0"></div>` : ''}
        </div>
        <div id="shop-quote" style="margin:10px 0;padding:10px;background:var(--primary-light);border-radius:8px;font-size:.9rem"></div>
        <div class="row" style="justify-content:flex-end"><button class="btn" id="shop-submit">送出訂單</button></div>
        <div class="error-msg" id="shop-err"></div>
        <div id="shop-ok" style="color:var(--ok)"></div>
      </div>
    </div>
    <div class="card">
      <h3>我的訂單</h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>日期</th><th>品項</th><th>金額</th><th>狀態</th></tr></thead>
        <tbody>${orderRows}</tbody>
      </table></div>
    </div>`;

  const curItems = () => Object.entries(shopCart).filter(([, q]) => q > 0)
    .map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity }));
  const refreshQuote = async () => {
    const items = curItems();
    const box = $('#shop-quote');
    if (!items.length) { box.innerHTML = '<small style="color:var(--muted)">尚未選擇商品</small>'; return; }
    try {
      const q = await api('/family/orders/quote', { method: 'POST', body: {
        items, coupon_code: $('#shop-coupon').value.trim(),
        points_used: ($('#shop-points') ? Number($('#shop-points').value) : 0) || 0 } });
      box.innerHTML = `小計 ${fmtMoney(q.subtotal)}<br>優惠券折抵 -${fmtMoney(q.coupon_discount)}　點數折抵 -${fmtMoney(q.points_discount)}（${q.points_used} 點）<br>
        <strong style="font-size:1.05rem">應付 ${fmtMoney(q.total)}</strong>${member.points_enabled ? `　<small>確認後回饋 ${q.points_earned} 點</small>` : ''}`;
    } catch (e) { box.innerHTML = `<span class="error-msg">${esc(e.message)}</span>`; }
  };
  $('#panel').querySelectorAll('[data-cart]').forEach(inp => inp.onchange = () => {
    shopCart[inp.dataset.cart] = Math.max(0, Number(inp.value) || 0);
    inp.value = shopCart[inp.dataset.cart];
    refreshQuote();
  });
  $('#shop-coupon').oninput = () => refreshQuote();
  if ($('#shop-points')) $('#shop-points').onchange = () => refreshQuote();
  refreshQuote();
  $('#shop-submit').onclick = async () => {
    const items = curItems();
    $('#shop-err').textContent = ''; $('#shop-ok').textContent = '';
    if (!items.length) { $('#shop-err').textContent = '請先選擇商品數量'; return; }
    try {
      const r = await api('/family/orders', { method: 'POST', body: {
        items, coupon_code: $('#shop-coupon').value.trim(),
        points_used: ($('#shop-points') ? Number($('#shop-points').value) : 0) || 0 } });
      Object.keys(shopCart).forEach(k => delete shopCart[k]);
      $('#shop-ok').textContent = r.message || '訂單已送出';
      loadShop();
    } catch (e) { $('#shop-err').textContent = e.message; }
  };
}

async function loadPrograms() {
  let progs = [], signups = [];
  try {
    [progs, signups] = await Promise.all([api('/family/programs'), api('/family/signups')]);
  } catch (e) {
    if (e.status === 401) { showLogin(); return; }
    $('#panel').innerHTML = `<div class="card"><div class="error-msg">${esc(e.message)}</div></div>`;
    return;
  }
  const KIND = { course: '課程', service: '服務' };
  const ST = { pending: '待確認', confirmed: '已確認', cancelled: '已取消' };
  const cards = progs.length ? progs.map(p => {
    const full = p.seats_left === 0;
    return `
    <div class="card" style="margin:0">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <span class="badge ${p.kind === 'course' ? 'teal' : 'gray'}">${KIND[p.kind]}</span>
          <strong> ${esc(p.name)}</strong>
          ${p.category ? `<div><small style="color:var(--muted)">${esc(p.category)}</small></div>` : ''}
          ${p.scheduled_at ? `<div><small>時間：${esc(p.scheduled_at)}</small></div>` : ''}
          ${p.location ? `<div><small>地點：${esc(p.location)}</small></div>` : ''}
          ${p.description ? `<div style="margin-top:4px;font-size:.85rem">${esc(p.description)}</div>` : ''}
          ${p.seats_left !== null ? `<div><small style="color:${full ? 'var(--danger)' : 'var(--muted)'}">${full ? '名額已滿' : '剩餘名額 ' + p.seats_left}</small></div>` : ''}
        </div>
        <div style="text-align:right;white-space:nowrap">
          <div><strong>${fmtMoney(p.price)}</strong></div>
          <button class="btn small" data-signup="${p.id}" ${full ? 'disabled' : ''} style="margin-top:6px">報名</button>
        </div>
      </div>
    </div>`;
  }).join('') : '<div class="empty">目前沒有開放的課程／服務</div>';
  // 課表：有排定時段的課程／服務，依日期分組（僅列今日起）
  const nowD = new Date();
  const todayS = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`;
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const sched = progs.filter(p => p.scheduled_at && /^\d{4}-\d{2}-\d{2}/.test(p.scheduled_at) && p.scheduled_at.slice(0, 10) >= todayS)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const schedByDate = {};
  sched.forEach(p => { const d = p.scheduled_at.slice(0, 10); (schedByDate[d] = schedByDate[d] || []).push(p); });
  const schedHtml = sched.length ? Object.keys(schedByDate).sort().map(d => {
    const wd = WD[new Date(d.replace(/-/g, '/')).getDay()];
    return `<div style="margin-top:8px"><div style="font-weight:600;font-size:.85rem;color:var(--primary-dark)">${esc(d)}（${wd}）</div>
      ${schedByDate[d].map(p => `<div style="display:flex;gap:8px;font-size:.85rem;padding:3px 0;border-bottom:1px dashed var(--border)">
        <span style="min-width:44px;color:var(--muted)">${esc(p.scheduled_at.slice(11, 16) || '—')}</span>
        <span><span class="badge ${p.kind === 'course' ? 'teal' : 'gray'}">${KIND[p.kind]}</span> ${esc(p.name)}${p.location ? `　<small style="color:var(--muted)">${esc(p.location)}</small>` : ''}</span>
      </div>`).join('')}</div>`;
  }).join('') : '<div class="empty">近期尚無排定課表</div>';
  const suRows = signups.length ? signups.map(s => `
    <tr>
      <td data-label="日期"><small>${esc((s.created_at || '').slice(0, 16))}</small></td>
      <td data-label="項目">${KIND[s.kind]}｜${esc(s.program_name)}${s.scheduled_at ? `<br><small>${esc(s.scheduled_at)}</small>` : ''}</td>
      <td data-label="數量">×${s.quantity}</td>
      <td data-label="狀態"><span class="badge ${s.status === 'confirmed' ? 'green' : s.status === 'cancelled' ? 'red' : 'yellow'}">${ST[s.status] || s.status}</span></td>
    </tr>`).join('') : '<tr><td colspan="4"><div class="empty">尚無報名紀錄</div></td></tr>';
  $('#panel').innerHTML = `
    <div class="card">
      <h3>課表</h3>
      <p style="font-size:.85rem;color:var(--muted)">近期已排定時段的課程／服務。</p>
      <div>${schedHtml}</div>
    </div>
    <div class="card">
      <h3>課程／服務</h3>
      <p style="font-size:.85rem;color:var(--muted)">報名後由護理站確認，費用將列入您的帳單於現場結算。</p>
      <div style="display:grid;gap:10px;margin-top:10px">${cards}</div>
      <div class="error-msg" id="pg-err" style="margin-top:8px"></div>
      <div id="pg-ok" style="color:var(--ok)"></div>
    </div>
    <div class="card">
      <h3>我的報名</h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>日期</th><th>項目</th><th>數量</th><th>狀態</th></tr></thead>
        <tbody>${suRows}</tbody></table></div>
    </div>`;
  $('#panel').querySelectorAll('[data-signup]').forEach(b => b.onclick = async () => {
    const prog = progs.find(p => p.id == b.dataset.signup);
    if (!confirm(`確定報名「${prog.name}」（${fmtMoney(prog.price)}）？`)) return;
    $('#pg-err').textContent = ''; $('#pg-ok').textContent = '';
    try {
      const r = await api('/family/signups', { method: 'POST', body: { program_id: prog.id, quantity: 1 } });
      $('#pg-ok').textContent = r.message || '已送出報名';
      loadPrograms();
    } catch (e) { $('#pg-err').textContent = e.message; }
  });
}

async function loadVisitors() {
  let rows = [];
  try { rows = await api('/family/visitor-reservations'); }
  catch (e) {
    if (e.status === 401) { showLogin(); return; }
    $('#panel').innerHTML = `<div class="card"><div class="error-msg">${esc(e.message)}</div></div>`;
    return;
  }
  const ST = { booked: ['已預約', 'yellow'], arrived: ['已報到', 'green'], cancelled: ['已取消', 'gray'] };
  const trs = rows.length ? rows.map(v => {
    const [label, color] = ST[v.status] || ['-', 'gray'];
    return `<tr>
      <td data-label="探訪時間">${esc(v.visit_at)}</td>
      <td data-label="訪客">${esc(v.visitor_name)}${v.relation ? `　<small>${esc(v.relation)}</small>` : ''}</td>
      <td data-label="人數">${v.headcount}</td>
      <td data-label="狀態"><span class="badge ${color}">${label}</span></td>
      <td data-label="操作">${v.status === 'booked' ? `<button class="btn small secondary" data-vr-cancel="${v.id}">取消</button>` : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5"><div class="empty">尚無訪客預約</div></td></tr>';
  $('#panel').innerHTML = `
    <div class="card">
      <h3>登記訪客</h3>
      <div class="form-grid">
        <div class="field"><label>訪客姓名 *</label><input id="vr-name"></div>
        <div class="field"><label>與媽媽關係</label><input id="vr-rel" placeholder="例如：先生、婆婆"></div>
        <div class="field"><label>聯絡電話</label><input id="vr-phone" inputmode="tel"></div>
        <div class="field"><label>人數</label><input type="number" id="vr-count" min="1" max="20" value="1"></div>
        <div class="field"><label>探訪日期 *</label><input type="date" id="vr-date"></div>
        <div class="field"><label>探訪時間 *</label><input type="time" id="vr-time" value="14:00"></div>
        <div class="field full"><label>備註</label><input id="vr-note"></div>
        <div class="full row"><button class="btn" id="vr-submit">送出預約</button>
          <span class="error-msg" id="vr-err"></span><span style="color:var(--ok)" id="vr-ok"></span></div>
      </div>
      <small style="color:var(--muted)">依機構感控原則：訪客請於公共區域會客、進入前量體溫戴口罩；額溫 37.5 度以上或有呼吸道症狀請改期。</small>
    </div>
    <div class="card">
      <h3>訪客預約紀錄</h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>探訪時間</th><th>訪客</th><th>人數</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>${trs}</tbody></table></div>
    </div>`;
  $('#vr-submit').onclick = async () => {
    $('#vr-err').textContent = ''; $('#vr-ok').textContent = '';
    const date = $('#vr-date').value, time = $('#vr-time').value;
    if (!date || !time) { $('#vr-err').textContent = '請選擇探訪日期與時間'; return; }
    try {
      const r = await api('/family/visitor-reservations', { method: 'POST', body: {
        visitor_name: $('#vr-name').value.trim(), relation: $('#vr-rel').value.trim(),
        phone: $('#vr-phone').value.trim(), headcount: Number($('#vr-count').value) || 1,
        visit_at: `${date} ${time}`, note: $('#vr-note').value.trim()
      } });
      alert(r.message || '已送出訪客預約');
      loadVisitors();
    } catch (e) { $('#vr-err').textContent = e.message; }
  };
  $('#panel').querySelectorAll('[data-vr-cancel]').forEach(b => b.onclick = async () => {
    if (!confirm('確定取消此筆訪客預約？')) return;
    try { await api(`/family/visitor-reservations/${b.dataset.vrCancel}/cancel`, { method: 'POST' }); loadVisitors(); }
    catch (e) { alert(e.message); }
  });
}

function showLogin() {
  family = null;
  $('#login-view').hidden = false;
  $('#app-view').hidden = true;
}

function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#fam-info').textContent = `${family.name}${family.relation ? `（${family.relation}）` : ''}`;
  $('#report-date').value = todayStr();
  loadSiblings();
  setTab('report');
}

$('#login-form').onsubmit = async e => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const r = await api('/family/login', {
      method: 'POST',
      body: { code: $('#code').value }
    });
    family = r.family;
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
};

$('#logout-btn').onclick = async () => {
  await api('/family/logout', { method: 'POST' });
  showLogin();
};

$('#report-date').onchange = () => {
  if (activeTab === 'shop') loadShop();
  else if (activeTab === 'programs') loadPrograms();
  else if (activeTab === 'meal') loadConfinementMeal();
  else loadReport();
};
$('#tab-report').onclick = () => setTab('report');
$('#tab-rooming').onclick = () => setTab('rooming');
$('#tab-timeline').onclick = () => setTab('timeline');
$('#tab-photos').onclick = () => setTab('photos');
$('#tab-trends').onclick = () => setTab('trends');
$('#tab-meal').onclick = () => setTab('meal');
$('#tab-shop').onclick = () => setTab('shop');
$('#tab-programs').onclick = () => setTab('programs');
$('#tab-visitors').onclick = () => setTab('visitors');
$('#tab-survey').onclick = () => setTab('survey');
$('#tab-messages').onclick = () => setTab('messages');
$('#tab-cleaning').onclick = () => openCleaningRequest();

// 聯絡清潔：跳出清潔申請視窗（送出後建立房務任務，清潔人員即可看到）
const HK_TASK_CHOICES = ['清潔地板', '更換床單', '馬桶', '浴室', '倒垃圾', '補充備品', '紫外線消毒', '清潔拖鞋', '清潔玻璃', '其他'];
function openCleaningRequest() {
  const old = document.getElementById('clean-modal');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'clean-modal';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:60;padding:16px';
  const d = new Date();
  const today = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  wrap.innerHTML = `
    <div class="card" style="max-width:420px;width:100%;max-height:90vh;overflow:auto;margin:0">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="margin:0">聯絡清潔</h3>
        <button class="btn small secondary" id="cl-close">關閉</button>
      </div>
      <p style="font-size:.85rem;color:var(--muted)">送出後由清潔人員於排定日期處理。</p>
      <div class="field"><label>任務</label>
        <select id="cl-task">${HK_TASK_CHOICES.map(t => `<option>${t}</option>`).join('')}</select></div>
      <div class="field" id="cl-other-wrap" style="display:none"><label>其他（請說明）</label>
        <input id="cl-other" placeholder="請描述需要的清潔服務"></div>
      <div class="field"><label>排定日期</label><input type="date" id="cl-date" value="${today}" min="${today}"></div>
      <div class="field"><label>備註</label><textarea id="cl-note" rows="2" placeholder="例如：下午時段方便"></textarea></div>
      <div class="row"><button class="btn" id="cl-send">送出</button><span class="error-msg" id="cl-err"></span><span id="cl-ok" style="color:var(--ok)"></span></div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.onclick = e => { if (e.target === wrap) wrap.remove(); };
  wrap.querySelector('#cl-close').onclick = () => wrap.remove();
  wrap.querySelector('#cl-task').onchange = () => {
    wrap.querySelector('#cl-other-wrap').style.display = wrap.querySelector('#cl-task').value === '其他' ? '' : 'none';
  };
  wrap.querySelector('#cl-send').onclick = async () => {
    wrap.querySelector('#cl-err').textContent = '';
    wrap.querySelector('#cl-ok').textContent = '';
    try {
      await api('/family/cleaning-request', { method: 'POST', body: {
        task: wrap.querySelector('#cl-task').value,
        task_other: wrap.querySelector('#cl-other').value.trim(),
        scheduled_for: wrap.querySelector('#cl-date').value,
        note: wrap.querySelector('#cl-note').value.trim()
      } });
      wrap.querySelector('#cl-ok').textContent = '已送出清潔申請';
      setTimeout(() => wrap.remove(), 1000);
    } catch (e) { wrap.querySelector('#cl-err').textContent = e.message; }
  };
}

(async () => {
  try {
    const meta = await api('/meta');
    if (meta.center_name) {
      document.title = `寶寶日報 - ${meta.center_name}`;
      const sub = document.querySelector('#login-view .sub');
      if (sub) sub.textContent = `${meta.center_name} 家屬入口`;
    }
  } catch (e) { /* 沿用預設名稱 */ }
  try {
    const r = await api('/family/me');
    if (r.family) {
      family = r.family;
      showApp();
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
})();
