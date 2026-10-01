import { isConfigured, rows, runRealtimeReport } from './_ga.js';

const demo = {
  mode: 'demo',
  generatedAt: new Date().toISOString(),
  windowMinutes: 30,
  summary: { activeUsers: 7, views: 19, events: 46 },
  timeline: [
    { minutesAgo: 5, activeUsers: 2, views: 3 },
    { minutesAgo: 4, activeUsers: 3, views: 5 },
    { minutesAgo: 3, activeUsers: 3, views: 4 },
    { minutesAgo: 2, activeUsers: 5, views: 7 },
    { minutesAgo: 1, activeUsers: 6, views: 8 },
    { minutesAgo: 0, activeUsers: 7, views: 9 }
  ],
  pages: [
    { name: 'Carteira de Identidade Nacional (CIN)', activeUsers: 3, views: 7 },
    { name: 'Dúvidas Frequentes — Portal do Cidadão', activeUsers: 2, views: 5 },
    { name: 'Wiki SETIC — Página inicial', activeUsers: 1, views: 3 },
    { name: 'Autenticação de dois fatores do SEI', activeUsers: 1, views: 2 }
  ],
  devices: [
    { name: 'desktop', activeUsers: 5 },
    { name: 'mobile', activeUsers: 2 }
  ],
  cities: [
    { name: 'Porto Velho', activeUsers: 3 },
    { name: 'São Paulo', activeUsers: 2 },
    { name: 'Brasília', activeUsers: 1 },
    { name: 'Outras', activeUsers: 1 }
  ]
};

function top(rowsList, dimension, limit = 8) {
  return rowsList
    .filter((item) => item[dimension] && item[dimension] !== '(not set)')
    .slice(0, limit)
    .map((item) => ({ name: item[dimension], activeUsers: item.activeUsers || 0, views: item.screenPageViews || 0 }));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!isConfigured()) {
    return res.status(200).json(demo);
  }

  try {
    const [summaryReport, timelineReport, pagesReport, devicesReport, citiesReport] = await Promise.all([
      runRealtimeReport({ metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'eventCount' }] }),
      runRealtimeReport({
        dimensions: [{ name: 'minutesAgo' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        minuteRanges: [{ startMinutesAgo: 5, endMinutesAgo: 0 }],
        orderBys: [{ dimension: { dimensionName: 'minutesAgo' }, desc: true }]
      }),
      runRealtimeReport({
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        limit: '8',
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
      }),
      runRealtimeReport({
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'activeUsers' }],
        limit: '5',
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
      }),
      runRealtimeReport({
        dimensions: [{ name: 'city' }],
        metrics: [{ name: 'activeUsers' }],
        limit: '8',
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
      })
    ]);

    const summaryRows = rows(summaryReport);
    const timelineRows = rows(timelineReport)
      .map((item) => ({ minutesAgo: Number(item.minutesAgo), activeUsers: item.activeUsers || 0, views: item.screenPageViews || 0 }))
      .sort((a, b) => b.minutesAgo - a.minutesAgo);

    const summary = summaryRows[0] || {};

    return res.status(200).json({
      mode: 'live',
      generatedAt: new Date().toISOString(),
      windowMinutes: 30,
      summary: {
        activeUsers: summary.activeUsers || 0,
        views: summary.screenPageViews || 0,
        events: summary.eventCount || 0
      },
      timeline: timelineRows,
      pages: top(rows(pagesReport), 'unifiedScreenName'),
      devices: top(rows(devicesReport), 'deviceCategory'),
      cities: top(rows(citiesReport), 'city')
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Não foi possível consultar o GA4 em tempo real.',
      detail: error.message
    });
  }
}
