const ALLOWED_ORIGINS = new Set([
  'https://wiki.setic.ro.gov.br',
  'https://playground-wiki.setic.ro.gov.br'
]);

export default async function handler(req, res) {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Origem não permitida.' });
  }

  // Compatibilidade temporária para abas antigas que ainda possuam o tracker próprio em cache.
  // A coleta oficial do Wiki Analytics é feita exclusivamente pelo Google Analytics 4.
  return res.status(202).json({
    ok: true,
    ignored: true,
    source: 'ga4-only'
  });
}
