import { batchRunReports, isConfigured, rows } from './_ga.js';

const detailCache = new Map();
const CACHE_MS = 180_000;

function dateRangeFor(range) {
  return range === '30d'
    ? { startDate: '30daysAgo', endDate: 'today' }
    : { startDate: '7daysAgo', endDate: 'today' };
}

function exactPageFilter(hostName, pagePath) {
  return {
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: 'hostName',
            stringFilter: { matchType: 'EXACT', value: hostName, caseSensitive: false }
          }
        },
        {
          filter: {
            fieldName: 'pagePath',
            stringFilter: { matchType: 'EXACT', value: pagePath, caseSensitive: true }
          }
        }
      ]
    }
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!isConfigured()) {
    return res.status(503).json({ error: 'Integração GA4 não configurada.' });
  }

  const hostName = String(req.query?.host || 'wiki.setic.ro.gov.br').trim();
  const pagePath = String(req.query?.path || '/').trim();
  const range = req.query?.range === '30d' ? '30d' : '7d';

  if (!pagePath.startsWith('/') || !/^[a-z0-9.-]+$/i.test(hostName)) {
    return res.status(400).json({ error: 'Página inválida.' });
  }

  const cacheKey = `${hostName}|${pagePath}|${range}`;
  const cached = detailCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return res.status(200).json({ ...cached.payload, cache: 'memory' });
  }

  try {
    const dateRange = dateRangeFor(range);
    const filter = exactPageFilter(hostName, pagePath);

    const reports = await batchRunReports([
      {
        dateRanges: [dateRange],
        dimensionFilter: filter,
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'userEngagementDuration' },
          { name: 'engagementRate' }
        ]
      },
      {
        dateRanges: [dateRange],
        dimensionFilter: filter,
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'screenPageViews' },
          { name: 'userEngagementDuration' }
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }]
      },
      {
        dateRanges: [dateRange],
        dimensionFilter: filter,
        dimensions: [{ name: 'hour' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
      }
    ]);

    const summary = rows(reports[0])[0] || {};
    const activeUsers = summary.activeUsers || 0;
    const trend = rows(reports[1]).map((item) => ({
      date: item.date,
      activeUsers: item.activeUsers || 0,
      views: item.screenPageViews || 0,
      avgEngagementSeconds: (item.activeUsers || 0) > 0
        ? (item.userEngagementDuration || 0) / item.activeUsers
        : 0
    }));
    const hours = rows(reports[2]).map((item) => ({
      hour: Number(item.hour || 0),
      activeUsers: item.activeUsers || 0,
      views: item.screenPageViews || 0
    }));
    const peak = hours[0] || null;

    const payload = {
      mode: 'live',
      generatedAt: new Date().toISOString(),
      range,
      page: {
        hostName,
        path: pagePath,
        url: `https://${hostName}${pagePath}`
      },
      summary: {
        activeUsers,
        sessions: summary.sessions || 0,
        views: summary.screenPageViews || 0,
        engagementRate: summary.engagementRate || 0,
        avgEngagementSeconds: activeUsers > 0
          ? (summary.userEngagementDuration || 0) / activeUsers
          : 0
      },
      peakHour: peak
        ? {
            hour: peak.hour,
            label: `${String(peak.hour).padStart(2, '0')}:00`,
            activeUsers: peak.activeUsers,
            views: peak.views
          }
        : null,
      trend,
      hours
    };

    detailCache.set(cacheKey, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (error) {
    if (cached) {
      return res.status(200).json({ ...cached.payload, stale: true, cache: 'stale', warning: error.message });
    }
    return res.status(502).json({ error: 'Não foi possível consultar os detalhes da página.', detail: error.message });
  }
}
