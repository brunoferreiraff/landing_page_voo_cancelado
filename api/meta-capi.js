// Vercel Serverless Function: envia eventos para a API de Conversões da Meta.
// Usada apenas pela LP /cias_cancel_delays.
//
// Variáveis de ambiente (Vercel > Settings > Environment Variables):
//   META_PIXEL_ID         ID do Pixel/dataset (1339223671651989)
//   META_CAPI_TOKEN       Token de acesso gerado no Gerenciador de Eventos
//   META_TEST_EVENT_CODE  (opcional) código da aba "Testar eventos"

const crypto = require('crypto');

const GRAPH_API_VERSION = 'v21.0';
const ALLOWED_EVENTS = ['PageView', 'Lead'];
const ALLOWED_PATH = '/cias_cancel_delays';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) {
    console.error('META_PIXEL_ID ou META_CAPI_TOKEN não configurados.');
    return res.status(500).json({ error: 'CAPI not configured' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  const eventName = body.event_name;
  const eventId = body.event_id;
  const sourceUrl = String(body.event_source_url || '');

  if (ALLOWED_EVENTS.indexOf(eventName) === -1 || !eventId) {
    return res.status(400).json({ error: 'Invalid event' });
  }

  let sourcePath = '';
  try { sourcePath = new URL(sourceUrl).pathname; } catch (e) {}
  if (sourcePath.indexOf(ALLOWED_PATH) !== 0) {
    return res.status(400).json({ error: 'Invalid source' });
  }

  const forwardedFor = String(req.headers['x-forwarded-for'] || '');
  const userData = {
    client_ip_address: forwardedFor.split(',')[0].trim() || undefined,
    client_user_agent: req.headers['user-agent'] || undefined,
    fbp: body.fbp || undefined,
    fbc: body.fbc || undefined
  };

  const email = normalize(body.email);
  if (email) userData.em = [sha256(email)];

  const phone = String(body.phone || '').replace(/\D/g, '');
  if (phone) userData.ph = [sha256(phone)];

  const nameParts = normalize(body.name).split(/\s+/).filter(Boolean);
  if (nameParts.length) {
    userData.fn = [sha256(nameParts[0])];
    if (nameParts.length > 1) userData.ln = [sha256(nameParts[nameParts.length - 1])];
  }

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: String(eventId),
    action_source: 'website',
    event_source_url: sourceUrl,
    user_data: userData
  };
  if (body.custom_data && typeof body.custom_data === 'object') {
    event.custom_data = body.custom_data;
  }

  const payload = { data: [event] };
  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  try {
    const url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + pixelId +
      '/events?access_token=' + encodeURIComponent(token);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(function () { return {}; });

    if (!response.ok) {
      console.error('Erro da API de Conversões:', JSON.stringify(result));
      return res.status(502).json({ error: 'Meta API error' });
    }
    return res.status(200).json({ ok: true, events_received: result.events_received });
  } catch (err) {
    console.error('Falha ao chamar a API de Conversões:', err);
    return res.status(502).json({ error: 'Meta API unreachable' });
  }
};
