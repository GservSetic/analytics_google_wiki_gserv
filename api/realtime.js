import { isConfigured, rows, runRealtimeReport, runReport } from './_ga.js';

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
    { name: 'Carteira de Identidade Nacional (CIN)', url: 'https://wiki.setic.ro.gov.br/home/base_conhecimento/manuais/portal_cidadao/cin', activeUsers: 3, views: 7 },
    { name: 'Dúvidas Frequentes — Portal do Cidadão', url: 'https://wiki.setic.ro.gov.br/home/base_conhecimento/manuais/portal_cidadao/duvidas_frequentes', activeUsers: 2, views: 5 },
    { name: 'Wiki SETIC — Página inicial', url: 'https://wiki.setic.ro.gov.br/', activeUsers: 1, views: 3 },
    { name: 'Autenticação de dois fatores do SEI', url: 'https://wiki.setic.ro.gov.br/home/base_conhecimento/manuais/sei/autenticacao_de_dois_fatores_do_sei', activeUsers: 1, views: 2 }
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


function normalizeTitle(value = '') {
  return String(value).trim().toLocaleLowerCase('pt-BR');
}

function buildPageUrlMap(report) {
  const map = new Map();

  for (const item of rows(report)) {
    const title = normalizeTitle(item.pageTitle);
    if (!title || !item.fullPageUrl) continue;

    const url = /^https?:\/\//i.test(item.fullPageUrl)
      ? item.fullPageUrl
      : `https://${item.fullPageUrl}`;

    const current = map.get(title);
    const views = item.screenPageViews || 0;

    if (!current || views > current.views) {
      map.set(title, { url, views });
    }
  }

  return map;
}

function enrichRealtimePages(realtimeRows, urlMap) {
  return realtimeRows
    .filter((item) => item.unifiedScreenName && item.unifiedScreenName !== '(not set)')
    .slice(0, 8)
    .map((item) => {
      const match = urlMap.get(normalizeTitle(item.unifiedScreenName));
      return {
        name: item.unifiedScreenName,
        url: match?.url || null,
        activeUsers: item.activeUsers || 0,
        views: item.screenPageViews || 0
      };
    });
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
    const realtimePageRows = rows(pagesReport)
      .filter((item) => item.unifiedScreenName && item.unifiedScreenName !== '(not set)')
      .slice(0, 8);

    const activeTitles = [...new Set(realtimePageRows.map((item) => item.unifiedScreenName))];

    let pageUrlMap = new Map();
    if (activeTitles.length) {
      const pageUrlReport = await runReport({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pageTitle' }, { name: 'fullPageUrl' }],
        metrics: [{ name: 'screenPageViews' }],
        dimensionFilter: {
          filter: {
            fieldName: 'pageTitle',
            inListFilter: {
              values: activeTitles,
              caseSensitive: false
            }
          }
        },
        limit: '100',
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
      });
      pageUrlMap = buildPageUrlMap(pageUrlReport);
    }

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
      pages: enrichRealtimePages(realtimePageRows, pageUrlMap),
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
