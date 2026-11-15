async function api(path, options = {}) {
  const opts = { headers: {}, credentials: 'same-origin', ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* 無內容 */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || ('HTTP ' + res.status));
    err.status = res.status;
    err.data = data;   // 保留完整回應內容（例如重複偵測回傳的候選清單）
    throw err;
  }
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function todayStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function fmtTime(dt) {
  return (dt || '').slice(11, 16);
}

function fmtMoney(n) {
  return 'NT$ ' + Number(n || 0).toLocaleString('zh-Hant-TW');
}

/* 輕量 SVG 折線圖：points 為 [{date, value}]，無外部依賴 */
function svgLineChart(points, opts = {}) {
  const { width = 560, height = 170, unit = '', color = '#2a7f78' } = opts;
  if (!points || !points.length) return '<div class="empty">尚無資料</div>';
  const padL = 44, padR = 14, padT = 14, padB = 26;
  const w = width - padL - padR, h = height - padT - padB;
  const vals = points.map(p => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const x = i => padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = v => padT + h - ((v - min) / span) * h;
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `
    <circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" fill="${color}">
      <title>${esc(p.date)}: ${p.value}${unit}</title>
    </circle>`).join('');
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const xLabels = points.map((p, i) => i % labelEvery === 0
    ? `<text x="${x(i).toFixed(1)}" y="${height - 8}" font-size="10" fill="#6b7c79"
        text-anchor="middle">${esc(p.date.slice(5))}</text>` : '').join('');
  return `
  <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto" role="img">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + h}" stroke="#dde5e3"/>
    <line x1="${padL}" y1="${padT + h}" x2="${padL + w}" y2="${padT + h}" stroke="#dde5e3"/>
    <text x="${padL - 6}" y="${y(max) + 4}" font-size="10" fill="#6b7c79" text-anchor="end">${max}${unit}</text>
    <text x="${padL - 6}" y="${y(min) + 4}" font-size="10" fill="#6b7c79" text-anchor="end">${min}${unit}</text>
    ${points.length > 1 ? `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"/>` : ''}
    ${dots}
    ${xLabels}
  </svg>`;
}

/* ---------- 全站輸入防呆 ----------
   1. 瀏覽器自動填入：登入畫面以外一律關閉；密碼欄一律標為新密碼，瀏覽器不會把「自己存的帳密」填進去
      （2026-11 帳號管理曾因此把別人的密碼改成自己的、身分證欄被填成帳號名稱）
   2. 身分證／電話／Email 欄位：離開欄位時即時檢查格式並提示（後端存檔時也會再擋一次） */
(function () {
  const isLogin = el => !!el.closest('#login-view, #login-form');
  const harden = root => {
    if (!root || !root.querySelectorAll) return;
    const list = root.matches && root.matches('input, textarea') ? [root] : root.querySelectorAll('input, textarea');
    list.forEach(el => {
      if (isLogin(el) || el.dataset.acDone) return;
      el.dataset.acDone = '1';
      if (el.type === 'password') el.setAttribute('autocomplete', 'new-password');
      else if (!el.getAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
    });
  };
  const start = () => {
    harden(document.body);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && harden(n))))
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  // 依欄位標題判斷種類（末四碼／後四碼等只填部分的不檢查）
  const labelOf = el => {
    const f = el.closest('.field, label, td, .row');
    const lb = f && (f.querySelector('label') || f);
    return ((lb && lb.textContent) || '') + ' ' + (el.placeholder || '');
  };
  const kindOf = el => {
    if (el.type === 'password' || el.type === 'hidden' || el.readOnly || el.disabled || isLogin(el)) return '';
    if (!['text', 'tel', 'email', '', 'search'].includes(el.type)) return '';
    const t = labelOf(el);
    if (/末四碼|後四碼|末4碼/.test(t)) return '';
    if (/身分證|居留證/.test(t)) return /委託人/.test(t) ? 'idp' : 'id';
    if (/E-?MAIL|電子郵件|信箱/i.test(t)) return 'email';
    if (/手機|電話|市話|行動/.test(t) && !/分機/.test(t)) return 'phone';
    return '';
  };
  const RULES = {
    id: [v => /^[A-Z][A-Z0-9]\d{8}$/.test(v), '身分證格式不正確：1 個英文字母＋9 碼，例 A123456789'],
    idp: [v => /^[A-Z][A-Z0-9]\d{8}$/.test(v) || /^[A-Z]{0,2}\d{7,9}$/.test(v), '格式不正確：身分證（A123456789）或護照號碼'],
    phone: [v => /^[0-9+\-()#＃\s]{6,25}$/.test(v), '電話格式不正確：只能填數字、-、( )、#（分機），至少 6 碼'],
    email: [v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail 格式不正確，例 name@example.com']
  };
  const tip = (el, msg) => {
    let t = el.nextElementSibling;
    if (!t || !t.classList || !t.classList.contains('fmt-tip')) {
      if (!msg) return;
      t = document.createElement('small'); t.className = 'fmt-tip';
      t.style.cssText = 'display:block;color:#b23b3b;font-size:.78rem;margin-top:2px';
      el.insertAdjacentElement('afterend', t);
    }
    t.textContent = msg || '';
    el.style.borderColor = msg ? '#b23b3b' : '';
    el.setCustomValidity(msg || '');
  };
  document.addEventListener('focusout', e => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    const k = kindOf(el);
    if (!k) return;
    let v = el.value.trim();
    if (k === 'id' || k === 'idp') { v = v.toUpperCase(); if (el.value !== v) el.value = v; }
    tip(el, v && !RULES[k][0](v) ? RULES[k][1] : '');
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains('fmt-tip')) tip(el, '');
  });
})();
