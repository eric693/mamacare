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
  $('#baby-title').textContent = `${rpt.baby.name} 的一天`;
  const days = rpt.baby.birth_date
    ? Math.floor((new Date(date) - new Date(rpt.baby.birth_date)) / 86400000) + 1 : null;
  $('#baby-sub').textContent =
    `${date}${days && days > 0 ? `　出生第 ${days} 天` : ''}　媽媽：${rpt.baby.mother_name}`;

  if (activeTab === 'report') {
    $('#panel').innerHTML = `
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
  let msgs = [];
  try { msgs = await api('/family/messages'); } catch (e) {
    if (e.status === 401) { showLogin(); return; }
  }
  const bubbles = msgs.map(m => `
    <div style="margin:6px 0;text-align:${m.sender === 'family' ? 'right' : 'left'}">
      <div style="display:inline-block;max-width:82%;padding:8px 12px;border-radius:12px;background:${m.sender === 'family' ? '#cdeae4' : '#f0f0f0'}">
        <div style="font-size:.72rem;color:#888">${esc(m.sender_name || (m.sender === 'family' ? '我' : '護理站'))}・${esc(m.created_at)}</div>
        ${esc(m.body)}</div></div>`).join('');
  $('#panel').innerHTML = `
    <div class="card">
      <h3>聯絡護理站</h3>
      <p style="font-size:.85rem;color:#888">有任何照護問題或需求都可以在這裡留言，護理站會盡快回覆。</p>
      <div style="max-height:50vh;overflow:auto;margin:10px 0">${bubbles || '<div class="empty">還沒有留言，傳第一則訊息給護理站吧！</div>'}</div>
      <div class="field"><textarea id="msg-body" rows="2" placeholder="輸入留言…"></textarea></div>
      <div class="row"><button class="btn" id="msg-send">送出</button><span class="error-msg" id="msg-err"></span></div>
    </div>`;
  $('#msg-send').onclick = async () => {
    const text = $('#msg-body').value.trim();
    if (!text) return;
    try { await api('/family/messages', { method: 'POST', body: { body: text } }); loadMessages(); }
    catch (e) { $('#msg-err').textContent = e.message; }
  };
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
  ['report', 'timeline', 'photos', 'trends', 'meal', 'shop', 'programs', 'survey', 'messages'].forEach(t =>
    $(`#tab-${t}`).classList.toggle('active', t === tab));
  if (tab === 'shop') { loadShop(); return; }
  if (tab === 'programs') { loadPrograms(); return; }
  if (tab === 'meal') { loadConfinementMeal(); return; }
  if (tab === 'survey') { loadSurveys(); return; }
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
  const dish = (label, v) => v ? `<div><small style="color:var(--muted)">${label}</small> ${esc(v)}</div>` : '';
  const cards = plan.slots.map(s => `
    <div class="card" style="margin:0">
      <h4 style="margin:0 0 6px;color:var(--primary-dark)">${esc(s.slot)}</h4>
      ${s.menu ? (dish('主食', s.menu.staple) + dish('主菜', s.menu.main) + dish('藥膳湯品', s.menu.soup)
        + dish('鮮蔬', s.menu.veggie) + dish('甜品', s.menu.dessert) + dish('飲品', s.menu.drink)
        + (s.menu.note ? `<div><small style="color:var(--muted)">備註 ${esc(s.menu.note)}</small></div>` : ''))
        : '<div class="empty">本餐尚未公布菜單</div>'}
    </div>`).join('');
  $('#panel').innerHTML = `
    <div class="card">
      <h3>${esc(plan.mother_name)} 的月子餐</h3>
      <p style="font-size:.85rem;color:var(--muted)">${esc(date)}　產後第 ${plan.postpartum_day ?? '-'} 天　餐期：${esc(plan.stage || '不分期')}　飲食：${esc(plan.diet)}</p>
    </div>
    <div style="display:grid;gap:10px;margin-top:4px">${cards}</div>`;
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
          ${p.scheduled_at ? `<div><small>🕒 ${esc(p.scheduled_at)}</small></div>` : ''}
          ${p.location ? `<div><small>📍 ${esc(p.location)}</small></div>` : ''}
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
  const suRows = signups.length ? signups.map(s => `
    <tr>
      <td data-label="日期"><small>${esc((s.created_at || '').slice(0, 16))}</small></td>
      <td data-label="項目">${KIND[s.kind]}｜${esc(s.program_name)}${s.scheduled_at ? `<br><small>${esc(s.scheduled_at)}</small>` : ''}</td>
      <td data-label="數量">×${s.quantity}</td>
      <td data-label="狀態"><span class="badge ${s.status === 'confirmed' ? 'green' : s.status === 'cancelled' ? 'red' : 'yellow'}">${ST[s.status] || s.status}</span></td>
    </tr>`).join('') : '<tr><td colspan="4"><div class="empty">尚無報名紀錄</div></td></tr>';
  $('#panel').innerHTML = `
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
$('#tab-timeline').onclick = () => setTab('timeline');
$('#tab-photos').onclick = () => setTab('photos');
$('#tab-trends').onclick = () => setTab('trends');
$('#tab-meal').onclick = () => setTab('meal');
$('#tab-shop').onclick = () => setTab('shop');
$('#tab-programs').onclick = () => setTab('programs');
$('#tab-survey').onclick = () => setTab('survey');
$('#tab-messages').onclick = () => setTab('messages');

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
