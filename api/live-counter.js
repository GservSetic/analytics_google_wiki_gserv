import { counterConfigured, pingCounter, readCounterStats } from './_counter.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  if (!counterConfigured()) {
    return res.status(200).json({
      enabled: false,
      source: 'ga4',
      message: 'Contador próprio aguardando conexão Redis.'
    });
  }

  try {
    await pingCounter();
    const stats = await readCounterStats();
    return res.status(200).json({
      enabled: true,
      source: 'wiki-counter',
      ...stats
    });
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
