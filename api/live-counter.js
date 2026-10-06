function counterUrl() {
  return process.env.COUNTER_EDGE_URL?.trim() || '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const edgeUrl = counterUrl();
  if (!edgeUrl) {
    return res.status(200).json({
      enabled: false,
      source: 'ga4',
      message: 'Contador próprio aguardando configuração.'
    });
  }

  try {
    const response = await fetch(`${edgeUrl}?mode=stats`, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`contador respondeu ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    return res.status(200).json({ enabled: true, source: 'wiki-counter', ...data });
  } catch (error) {
    return res.status(200).json({
      enabled: false,
      source: 'ga4',
      degraded: true,
      message: 'Contador próprio temporariamente indisponível.',
      detail: error.message
    });
  }
}
