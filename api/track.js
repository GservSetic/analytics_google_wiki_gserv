import { counterConfigured, recordActivity } from './_counter.js';

const ALLOWED_ORIGINS = new Set([
  'https://wiki.setic.ro.gov.br',
  'https://playground-wiki.setic.ro.gov.br'
]);

const ID_RE = /^[a-z0-9-]{8,80}$/i;

function setCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function cleanPath(value) {
  const path = String(value || '/').slice(0, 600);
  return path.startsWith('/') ? path : '/';
}

function decodeGeoHeader(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(String(value).replace(/\+/g, ' ')).trim();
  } catch {
    return String(value).trim();
  }
}

function deviceFromUserAgent(value = '') {
  const ua = String(value).toLowerCase();
  if (/ipad|tablet|playbook|silk|android(?!.*mobile)/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(ua)) return 'mobile';
  if (ua) return 'desktop';
  return 'other';
}


export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const origin = String(req.headers.origin || '');
  if (!ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Origem não autorizada.' });
  }

  if (!counterConfigured()) {
    return res.status(503).json({ error: 'Contador próprio ainda não configurado.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const type = body.type === 'heartbeat' ? 'heartbeat' : body.type === 'pageview' ? 'pageview' : null;

    // Versões antigas do tracker ainda podem enviar heartbeat em abas já abertas.
    // O tempo real agora é responsabilidade do GA4, portanto heartbeats não usam Redis.
    if (type === 'heartbeat') {
      return res.status(202).json({ ok: true, ignored: true, source: 'ga4-realtime' });
    }

    if (
      !type ||
      !ID_RE.test(String(body.eventId || '')) ||
      !ID_RE.test(String(body.visitorId || '')) ||
      !ID_RE.test(String(body.sessionId || ''))
    ) {
      return res.status(400).json({ error: 'Evento inválido.' });
    }

    const host = String(body.host || '').toLowerCase();
    if (!['wiki.setic.ro.gov.br', 'playground-wiki.setic.ro.gov.br'].includes(host)) {
      return res.status(400).json({ error: 'Host inválido.' });
    }

    const result = await recordActivity({
      type,
      eventId: String(body.eventId),
      visitorId: String(body.visitorId),
      sessionId: String(body.sessionId),
      host,
      path: cleanPath(body.path),
      title: String(body.title || '').slice(0, 240),
      referrer: String(body.referrer || '').slice(0, 600),
      entryUrl: String(body.entryUrl || '').slice(0, 900),
      activeSeconds: Number(body.activeSeconds || 0),
      device: deviceFromUserAgent(req.headers['user-agent'] || ''),
      city: decodeGeoHeader(req.headers['x-vercel-ip-city']) || 'Não informado'
    });

    return res.status(202).json(result);
  } catch (error) {
    const quotaExceeded = /max requests limit exceeded/i.test(String(error?.message || ''));
    if (quotaExceeded) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({
        error: 'Contador próprio temporariamente em pausa por limite de operações.',
        detail: error.message
      });
    }
    return res.status(502).json({ error: 'Falha ao registrar atividade.', detail: error.message });
  }
}
