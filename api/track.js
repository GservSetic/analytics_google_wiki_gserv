const ALLOWED_ORIGINS = new Set([
  'https://wiki.setic.ro.gov.br',
  'https://playground-wiki.setic.ro.gov.br'
]);

function counterUrl() {
  return process.env.COUNTER_EDGE_URL?.trim() || '';
}

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

function isAllowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  return ALLOWED_ORIGINS.has(origin);
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const edgeUrl = counterUrl();
  if (!edgeUrl) return res.status(503).json({ error: 'Contador próprio ainda não configurado.' });
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'Origem não autorizada.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const response = await fetch(`${edgeUrl}?mode=track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wiki-Origin': String(req.headers.origin || '')
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(text);
  } catch (error) {
    return res.status(502).json({ error: 'Falha ao registrar atividade.', detail: error.message });
  }
}
