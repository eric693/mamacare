/* 公開合約簽署頁：持簽署連結即可閱讀合約並手寫簽名，無須登入 */
const token = new URLSearchParams(location.search).get('t') || '';
const root = document.getElementById('root');

function renderError(msg) {
  root.innerHTML = `<div class="card"><div class="error-msg">${esc(msg)}</div></div>`;
}

// 一次簽約的全部文件（服務說明書／訂房確認單／服務契約書／服務內容／住房須知）
function docsOf(c) {
  return (c.docs && c.docs.length) ? c.docs : [{ id: 0, title: c.title, body: c.body, sign_required: 1 }];
}
function docCard(d, i, total, withAck) {
  const tag = d.sign_required ? '<span class="badge red">須簽署</span>' : '<span class="badge gray">須閱讀確認</span>';
  return `
    <div class="card">
      <h3>${esc(d.title)} <small style="color:var(--muted)">（第 ${i + 1} / ${total} 份）</small> ${tag}</h3>
      <div class="contract-body">${esc(d.body)}</div>
      ${withAck ? `<label class="ack-line"><input type="checkbox" class="doc-ack" value="${d.id}"> 我已詳細閱讀並同意本份「${esc(d.title)}」內容</label>` : ''}
    </div>`;
}

function renderSigned(c) {
  document.getElementById('brand').textContent = c.center_name || '合約電子簽署';
  const docs = docsOf(c);
  root.innerHTML = `
    <div class="card signed-banner">
      <div class="tick">&#10003;</div>
      <h2>簽約完成</h2>
      <p>本次簽約之 <strong>${docs.length}</strong> 份文件已於 <strong>${esc(c.signed_at)}</strong> 完成簽署。</p>
      <p>簽署人：${esc(c.signer_name)}${c.signer_relation ? `（${esc(c.signer_relation)}）` : ''}</p>
      ${c.signature_data ? `<div style="margin-top:12px"><img src="${c.signature_data}" alt="簽名" style="max-width:260px;border-bottom:1px solid #333"></div>` : ''}
    </div>
    ${docs.map((d, i) => docCard(d, i, docs.length, false)).join('')}`;
}

// 服務契約書當事人區：依契約原件由產婦本人填寫（客服已建的資料先帶入，可自行修改）
function partyForm(pre) {
  const p = pre || {};
  const t = (k, label, type) => `<div class="field"><label>${label}</label>
    <input id="pf-${k}" type="${type || 'text'}" value="${esc(p[k] || '')}"></div>`;
  const req = (k, label, type) => t(k, `${label} <b class="req">*</b>`, type);
  return `
    <div class="card">
      <h3>契約當事人資料</h3>
      <p class="sig-hint">本區依契約原件應由<strong>產婦本人填寫</strong>。已知資料先為您帶入，請確認並補齊，送出後會列入服務契約書。</p>
      <h4>產婦</h4>
      <div class="form-grid">
        ${req('mother_name', '產婦姓名')}
        <div class="field"><label>與立契約書人甲方之關係</label>
          <div class="row" style="gap:14px;padding-top:8px">
            <label><input type="radio" name="pf-isparty" value="是" ${p.mother_is_party !== '否' ? 'checked' : ''}> 即立契約書人甲方</label>
            <label><input type="radio" name="pf-isparty" value="否" ${p.mother_is_party === '否' ? 'checked' : ''}> 另有甲方，關係：</label>
          </div>
          <input id="pf-mother_relation" value="${esc(p.mother_relation || '')}" placeholder="例如：配偶／母親">
        </div>
        ${req('mother_id_no', '身分證字號')}
        ${req('mother_birth', '出生年月日', 'date')}
        ${req('mother_address', '地址')}
        ${req('mother_phone', '行動電話')}
        ${t('mother_phone_home', '住家電話')}
        ${t('mother_phone_company', '公司電話')}
        ${t('mother_email', '電子郵件信箱', 'email')}
      </div>
      <h4>嬰兒</h4>
      <div class="form-grid">
        ${t('baby_name', '嬰兒姓名')}
        ${t('baby_relation', '與甲方之關係')}
        <div class="field"><label>進住方式</label>
          <div class="row" style="gap:14px;padding-top:8px">
            ${['隨同產婦進住', '單獨托嬰'].map(o =>
              `<label><input type="radio" name="pf-stay" value="${o}" ${p.baby_stay_type === o ? 'checked' : ''}> ${o}</label>`).join('')}
          </div></div>
      </div>
      <h4>緊急聯絡人</h4>
      <div class="form-grid">
        ${req('emergency_name', '姓名')}
        ${t('emergency_relation', '與產婦或嬰兒之關係')}
        ${t('emergency_address', '地址')}
        ${req('emergency_phone', '行動電話')}
        ${t('emergency_phone_home', '住家電話')}
        ${t('emergency_phone_company', '公司電話')}
        ${t('emergency_email', '電子郵件信箱', 'email')}
      </div>
      <h4>契約當事人（甲方）</h4>
      <div class="form-grid">
        ${req('party_name', '甲方姓名')}
        ${t('party_id_no', '身分證字號')}
        ${t('party_birth', '出生年月日', 'date')}
        ${t('party_address', '地址')}
        ${t('party_phone', '行動電話')}
        ${t('party_phone_company', '公司電話')}
        ${t('party_phone_home', '住家電話')}
        ${t('party_email', '電子郵件信箱', 'email')}
      </div>
    </div>`;
}

// 收集產婦填寫的當事人資料
function collectParty(fields) {
  const out = {};
  for (const f of fields) {
    const el = document.getElementById(`pf-${f.key}`);
    if (el) out[f.key] = el.value.trim();
  }
  const isParty = document.querySelector('input[name="pf-isparty"]:checked');
  if (isParty) out.mother_is_party = isParty.value;
  const stay = document.querySelector('input[name="pf-stay"]:checked');
  if (stay) out.baby_stay_type = stay.value;
  return out;
}

function renderSign(c) {
  document.getElementById('brand').textContent = c.center_name || '合約電子簽署';
  const docs = docsOf(c);
  root.innerHTML = `
    <div class="card">
      <h3>本次簽約文件共 ${docs.length} 份</h3>
      <p class="sig-hint">以下文件均為服務契約的一部分，請逐份閱讀並勾選確認，最後於頁尾一次完成簽名。</p>
      <ol class="doc-list">${docs.map(d => `<li>${esc(d.title)}${d.sign_required ? '' : '（閱讀確認）'}</li>`).join('')}</ol>
    </div>
    ${docs.map((d, i) => docCard(d, i, docs.length, true)).join('')}
    ${docs.some(d => d.needs_party) ? partyForm(c.party_prefill) : ''}
    <div class="card">
      <div class="form-grid">
        <div class="field"><label>簽署人姓名</label><input id="sg-name" placeholder="請填寫本人姓名"></div>
        <div class="field"><label>與媽媽關係（選填）</label><input id="sg-rel" placeholder="例如：本人 / 配偶"></div>
        <div class="field"><label>身分證末四碼（選填）</label><input id="sg-id" inputmode="numeric" maxlength="4" placeholder="加強存證用"></div>
      </div>
      <label style="display:block;margin-top:8px">手寫簽名</label>
      <canvas id="sigpad" class="sigpad"></canvas>
      <div class="row between">
        <span class="sig-hint">請用手指或滑鼠在框內簽名</span>
        <button class="btn small secondary" id="sg-clear">清除重簽</button>
      </div>
      <div class="row mt">
        <button class="btn" id="sg-submit">確認簽署（共 ${docs.length} 份文件）</button>
        <span class="error-msg" id="sg-err"></span>
      </div>
    </div>`;
  setupPad();
}

let hasInk = false;
function setupPad() {
  const canvas = document.getElementById('sigpad');
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#15302c';
    hasInk = false;
  }
  resize();
  window.addEventListener('resize', resize);

  let drawing = false;
  const pos = e => {
    const rect = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  };
  const start = e => { e.preventDefault(); drawing = true; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = e => { if (!drawing) return; e.preventDefault(); const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); hasInk = true; };
  const end = () => { drawing = false; };

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  document.getElementById('sg-clear').onclick = resize;
  document.getElementById('sg-submit').onclick = async () => {
    const partyFields = (loaded && loaded.party_fields) || [];
    const errEl = document.getElementById('sg-err');
    errEl.textContent = '';
    const name = document.getElementById('sg-name').value.trim();
    if (!name) { errEl.textContent = '請填寫簽署人姓名'; return; }
    const boxes = [...document.querySelectorAll('.doc-ack')];
    const missed = boxes.filter(b => !b.checked);
    if (missed.length) {
      errEl.textContent = `尚有 ${missed.length} 份文件未勾選閱讀確認`;
      missed[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!hasInk) { errEl.textContent = '請完成手寫簽名'; return; }
    try {
      await api(`/sign/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: {
          acks: boxes.map(b => Number(b.value)),
          party: partyFields.length ? collectParty(partyFields) : undefined,
          signer_name: name,
          signer_relation: document.getElementById('sg-rel').value.trim(),
          signer_id_last4: document.getElementById('sg-id').value.trim(),
          signature_data: canvas.toDataURL('image/png')
        }
      });
      load();
    } catch (e) { errEl.textContent = e.message; }
  };
}

let loaded = null;
async function load() {
  if (!token) { renderError('簽署連結無效'); return; }
  try {
    const c = await api(`/sign/${encodeURIComponent(token)}`);
    loaded = c;
    if (c.status === 'signed') renderSigned(c);
    else if (c.status === 'void') renderError('此合約已作廢，無法簽署。');
    else renderSign(c);
  } catch (e) {
    renderError(e.message);
  }
}

load();
