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
