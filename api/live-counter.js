import { bigQueryConfigured, readBigQueryToday } from './_bigquery.js';

let cache = null;
let cacheAt = 0;
const OK_CACHE_MS = 55_000;
const DEGRADED_CACHE_MS = 2 * 60_000;

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

  if (!bigQueryConfigured()) {
    cache = {
      enabled: false,
      source: 'ga4',
      degraded: true,
      message: 'BigQuery ainda não configurado para o total diário.'
    };
    cacheAt = now;
    return res.status(200).json(cache);
  }

  try {
    const stats = await readBigQueryToday();
    cache = {
      enabled: true,
      source: 'bigquery',
      ...stats
    };
    cacheAt = now;
    return res.status(200).json(cache);
  } catch (error) {
    cache = {
      enabled: false,
      source: 'ga4',
      degraded: true,
      message: 'BigQuery ainda não está disponível para o total diário.',
      detail: error.message
    };
    cacheAt = now;
    return res.status(200).json(cache);
  }
}
