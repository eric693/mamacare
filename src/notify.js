/* 家屬通知通道。
   設定 line_channel_access_token 後，已綁定 line_user_id 的家屬走 LINE 推播；
   未綁定或未設定 token 的家屬一律可在家屬入口查看（portal）。 */

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

function reportText(report, centerName) {
  const s = report.summary;
  const lines = [
    `${centerName} 寶寶日報`,
    `${report.baby.name}（${report.date}）`,
    `餵食 ${s.feed_count} 次，瓶餵共 ${s.feed_total_ml} ml`,
    `尿布：濕 ${s.diaper_wet} 次、便 ${s.diaper_stool} 次`
  ];
  if (s.rash_worst != null) {
    lines.push(s.rash_worst === '無' ? '紅臀評估：無' : `紅臀評估：${s.rash_worst}（已加強護理）`);
  }
  if (s.temp_latest != null) lines.push(`最新體溫 ${s.temp_latest} 度C`);
  if (s.weight_latest_g != null) lines.push(`體重 ${s.weight_latest_g} g`);
  if (s.jaundice_latest != null) lines.push(`黃疸值 ${s.jaundice_latest} mg/dL`);
  const vit = [];
  if (s.respiration_latest != null) vit.push(`呼吸 ${s.respiration_latest} 次/分`);
  if (s.heart_rate_latest != null) vit.push(`心跳 ${s.heart_rate_latest} bpm`);
  if (s.spo2_latest != null) vit.push(`血氧 ${s.spo2_latest}%`);
  if (vit.length) lines.push(vit.join('、'));
  const meas = [];
  if (s.length_latest != null) meas.push(`身長 ${s.length_latest} cm`);
  if (s.head_circ_latest != null) meas.push(`頭圍 ${s.head_circ_latest} cm`);
  if (meas.length) lines.push(meas.join('、'));
  const obs = [];
  if (s.skin_latest) obs.push(`膚色 ${s.skin_latest}`);
  if (s.activity_latest) obs.push(`活動力 ${s.activity_latest}`);
  if (s.stool_latest) obs.push(`大便 ${s.stool_latest}`);
  if (s.vomit_latest) obs.push(`溢吐奶 ${s.vomit_latest}`);
  if (s.cord_latest) obs.push(`臍帶 ${s.cord_latest}`);
  if (obs.length) lines.push(obs.join('、'));
  lines.push(s.bath_done ? '今日已完成沐浴' : '今日未安排沐浴');
  if (report.photos.length) lines.push(`今日有 ${report.photos.length} 張新照片，請至家屬入口查看`);
  if (report.alerts && report.alerts.length) lines.push(`【注意】${report.alerts.join('；')}`);
  return lines.join('\n');
}

async function pushLine(token, lineUserId, text) {
  const res = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE API ${res.status}: ${body.slice(0, 200)}`);
  }
}

/* 回傳每位家屬的發送通道結果：[{ family_id, channel, ok, error? }] */
async function sendReport(report, familyMembers, settings) {
  const token = (settings.line_channel_access_token || '').trim();
  const text = reportText(report, settings.center_name || '');
  const results = [];
  for (const f of familyMembers) {
    if (token && f.line_user_id) {
      try {
        await pushLine(token, f.line_user_id, text);
        results.push({ family_id: f.id, channel: 'line', ok: true });
      } catch (e) {
        results.push({ family_id: f.id, channel: 'line', ok: false, error: e.message });
      }
    } else {
      results.push({ family_id: f.id, channel: 'portal', ok: true });
    }
  }
  return results;
}

/* 推播任意訊息陣列（含 Flex）給單一 LINE 目標。token、to 任一為空則略過。 */
async function pushMessages(token, to, messages) {
  if (!token || !to || !messages || !messages.length) return { ok: false, skipped: true };
  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: messages.slice(0, 5) })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LINE API ${res.status}: ${body.slice(0, 200)}`);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* 推播任意文字給單一 LINE 目標（userId / group / room）。token、to 任一為空則略過。 */
async function pushText(token, to, text) {
  if (!token || !to) return { ok: false, skipped: true };
  try { await pushLine(token, to, text); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

/* 取得 LINE 使用者顯示名稱／頭像（失敗回傳空物件，不阻斷流程） */
async function lineProfile(token, userId) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return {};
    const j = await res.json();
    return { display_name: j.displayName || '', picture_url: j.pictureUrl || '' };
  } catch (e) { return {}; }
}

/* Facebook Messenger 送訊息給單一 PSID */
async function fbSend(pageToken, psid, text) {
  const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text } })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FB API ${res.status}: ${body.slice(0, 200)}`);
  }
}

module.exports = { sendReport, reportText, pushLine, pushText, pushMessages, lineProfile, fbSend };
