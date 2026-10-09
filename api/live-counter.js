import { counterConfigured, readCounterStats } from './_counter.js';

let cache = null;
let cacheAt = 0;
const OK_CACHE_MS = 55_000;
const DEGRADED_CACHE_MS = 5 * 60_000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const now = Date.now();
  const cacheTtl = cache?.enabled ? OK_CACHE_MS : DEGRADED_CACHE_MS;

  if (cache && now - cacheAt < cacheTtl) {
    return res.status(200).json({ ...cache, cache: 'memory' });
  }

  if (!counterConfigured()) {
    cache = {
      enabled: false,
      source: 'ga4',
      message: 'Contador próprio aguardando conexão Redis.'
    };
    cacheAt = now;
    return res.status(200).json(cache);
  }

  try {
    const stats = await readCounterStats();
    cache = {
      enabled: true,
      source: 'wiki-counter',
      ...stats
    };
    cacheAt = now;
    return res.status(200).json(cache);
  } catch (error) {
    cache = {
      enabled: false,
      source: 'ga4',
      degraded: true,
      message: 'Contador próprio temporariamente indisponível.',
      detail: error.message
    };
    cacheAt = now;
    return res.status(200).json(cache);
  }
}
