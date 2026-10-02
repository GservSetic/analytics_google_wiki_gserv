import { isConfigured, rows, runReport } from './_ga.js';

const allowedRanges = new Set(['today', '7d', '30d']);

function rangeFor(key) {
  if (key === 'today') return { startDate: 'today', endDate: 'today' };
  if (key === '7d') return { startDate: '7daysAgo', endDate: 'today' };
  return { startDate: '30daysAgo', endDate: 'today' };
}

const demoByRange = {
  today: {
    summary: { activeUsers: 20, sessions: 21, views: 30, engagementRate: 0.1429, avgEngagementSeconds: 9.381 },
    daily: [{ date: '20261001', activeUsers: 20, sessions: 21, views: 30 }],
    pages: [
      { name: '/home/base_conhecimento/manuais/portal_cidadao/cin', activeUsers: 3, views: 3 },
      { name: '/home/base_conhecimento/manuais/portal_cidadao/duvidas_frequentes', activeUsers: 1, views: 2 },
      { name: '/', activeUsers: 1, views: 1 },
      { name: '/home/base_conhecimento/manuais/novos_servidores', activeUsers: 1, views: 1 }
    ],
    devices: [{ name: 'desktop', activeUsers: 16, sessions: 17 }, { name: 'mobile', activeUsers: 4, sessions: 4 }],
    cities: [{ name: 'São Paulo', activeUsers: 4 }, { name: 'Porto Velho', activeUsers: 2 }, { name: 'Brasília', activeUsers: 2 }, { name: 'Cuiabá', activeUsers: 2 }]
  },
  '7d': {
    summary: { activeUsers: 1511, sessions: 1871, views: 3410, engagementRate: 0.571, avgEngagementSeconds: 49.4 },
    daily: [
      { date: '20260925', activeUsers: 1, sessions: 1, views: 2 },
      { date: '20260927', activeUsers: 1, sessions: 1, views: 1 },
      { date: '20260928', activeUsers: 549, sessions: 620, views: 1051 },
      { date: '20260929', activeUsers: 546, sessions: 660, views: 1243 },
      { date: '20260930', activeUsers: 463, sessions: 573, views: 1086 },
      { date: '20261001', activeUsers: 20, sessions: 21, views: 30 }
    ],
    pages: [
      { name: '/home/base_conhecimento/manuais/portal_cidadao/cin', activeUsers: 586, views: 725 },
      { name: '/home/base_conhecimento/manuais/portal_cidadao/duvidas_frequentes', activeUsers: 488, views: 629 },
      { name: '/', activeUsers: 76, views: 200 },
      { name: '/home/base_conhecimento/manuais/sei/peticionamento_cidadao', activeUsers: 89, views: 112 }
    ],
    devices: [{ name: 'desktop', activeUsers: 781, sessions: 1062 }, { name: 'mobile', activeUsers: 725, sessions: 806 }, { name: 'tablet', activeUsers: 5, sessions: 6 }],
    cities: [{ name: 'Porto Velho', activeUsers: 410 }, { name: 'São Paulo', activeUsers: 115 }, { name: 'Brasília', activeUsers: 84 }, { name: 'Cuiabá', activeUsers: 61 }]
  },
  '30d': {
    summary: { activeUsers: 1530, sessions: 1901, views: 3470, engagementRate: 0.568, avgEngagementSeconds: 48.9 },
    daily: [
      { date: '20260918', activeUsers: 2, sessions: 2, views: 6 },
      { date: '20260919', activeUsers: 2, sessions: 3, views: 7 },
      { date: '20260920', activeUsers: 1, sessions: 1, views: 1 },
      { date: '20260921', activeUsers: 3, sessions: 4, views: 19 },
      { date: '20260922', activeUsers: 5, sessions: 6, views: 14 },
      { date: '20260925', activeUsers: 1, sessions: 1, views: 2 },
      { date: '20260927', activeUsers: 1, sessions: 1, views: 1 },
      { date: '20260928', activeUsers: 549, sessions: 620, views: 1051 },
      { date: '20260929', activeUsers: 546, sessions: 660, views: 1243 },
      { date: '20260930', activeUsers: 463, sessions: 573, views: 1086 },
      { date: '20261001', activeUsers: 20, sessions: 21, views: 30 }
    ],
    pages: [
      { name: '/home/base_conhecimento/manuais/portal_cidadao/cin', activeUsers: 589, views: 728 },
      { name: '/home/base_conhecimento/manuais/portal_cidadao/duvidas_frequentes', activeUsers: 489, views: 631 },
      { name: '/', activeUsers: 77, views: 201 },
      { name: '/home/base_conhecimento/manuais/sei/peticionamento_cidadao', activeUsers: 89, views: 112 }
    ],
    devices: [{ name: 'desktop', activeUsers: 794, sessions: 1083 }, { name: 'mobile', activeUsers: 731, sessions: 812 }, { name: 'tablet', activeUsers: 5, sessions: 6 }],
    cities: [{ name: 'Porto Velho', activeUsers: 418 }, { name: 'São Paulo', activeUsers: 121 }, { name: 'Brasília', activeUsers: 89 }, { name: 'Cuiabá', activeUsers: 65 }]
  }
};

function mapRows(list, dimension, metrics) {
  return rows(list).map((item) => {
    const output = { name: item[dimension] };
    for (const metric of metrics) output[metric.alias] = item[metric.id] || 0;
    return output;
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const range = allowedRanges.has(req.query?.range) ? req.query.range : 'today';

  if (!isConfigured()) {
    return res.status(200).json({ mode: 'demo', range, generatedAt: new Date().toISOString(), ...demoByRange[range] });
  }

  try {
    const dateRange = rangeFor(range);
    const trendDimension = range === 'today' ? 'hour' : 'date';
    const [summaryReport, trendReport, pagesReport, devicesReport, citiesReport] = await Promise.all([
      runReport({
        dateRanges: [dateRange],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'engagementRate' },
          { name: 'averageEngagementTimePerSession', expression: 'userEngagementDuration/sessions' }
        ]
      }),
      runReport({
        dateRanges: [dateRange],
        dimensions: [{ name: trendDimension }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: trendDimension } }]
      }),
      runReport({
        dateRanges: [dateRange],
        dimensions: [{ name: 'hostName' }, { name: 'pagePath' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        limit: '20',
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
      }),
      runReport({
        dateRanges: [dateRange],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
        limit: '5',
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
      }),
      runReport({
        dateRanges: [dateRange],
        dimensions: [{ name: 'city' }],
        metrics: [{ name: 'activeUsers' }],
        limit: '8',
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
      })
    ]);

    const summaryRows = rows(summaryReport);
    const summary = summaryRows[0] || {};

    return res.status(200).json({
      mode: 'live',
      range,
      generatedAt: new Date().toISOString(),
      summary: {
        activeUsers: summary.activeUsers || 0,
        sessions: summary.sessions || 0,
        views: summary.screenPageViews || 0,
        engagementRate: summary.engagementRate || 0,
        avgEngagementSeconds: summary.averageEngagementTimePerSession || 0
      },
      trendGranularity: range === 'today' ? 'hour' : 'day',
      trend: rows(trendReport).map((item) => ({
        label: range === 'today' ? `${String(item.hour || '00').padStart(2, '0')}:00` : item.date,
        date: item.date || null,
        hour: item.hour ?? null,
        activeUsers: item.activeUsers || 0,
        sessions: item.sessions || 0,
        views: item.screenPageViews || 0
      })),
      daily: range === 'today' ? [] : rows(trendReport).map((item) => ({
        date: item.date,
        activeUsers: item.activeUsers || 0,
        sessions: item.sessions || 0,
        views: item.screenPageViews || 0
      })),
      pages: rows(pagesReport).map((item) => ({
        name: item.pagePath || '/',
        url: `https://${item.hostName || 'wiki.setic.ro.gov.br'}${item.pagePath || '/'}`,
        hostName: item.hostName || 'wiki.setic.ro.gov.br',
        activeUsers: item.activeUsers || 0,
        views: item.screenPageViews || 0
      })),
      devices: mapRows(devicesReport, 'deviceCategory', [{ id: 'activeUsers', alias: 'activeUsers' }, { id: 'sessions', alias: 'sessions' }]),
      cities: mapRows(citiesReport, 'city', [{ id: 'activeUsers', alias: 'activeUsers' }])
    });
  } catch (error) {
    return res.status(502).json({ error: 'Não foi possível consultar o relatório do GA4.', detail: error.message });
  }
}
