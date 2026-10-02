import { isConfigured, rows, runRealtimeReport, runReport } from './_ga.js';

let realtimeCache = null;
let realtimeCacheAt = 0;
const REALTIME_CACHE_MS = 55_000;

let pageUrlCache = new Map();
let pageUrlCacheAt = 0;
const PAGE_URL_CACHE_MS = 5 * 60_000;

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

function mergePageUrlCache(nextMap) {
  for (const [key, value] of nextMap.entries()) pageUrlCache.set(key, value);
  pageUrlCacheAt = Date.now();
}

function enrichRealtimePages(realtimeRows) {
  return realtimeRows
    .filter((item) => item.unifiedScreenName && item.unifiedScreenName !== '(not set)')
    .slice(0, 8)
    .map((item) => {
      const match = pageUrlCache.get(normalizeTitle(item.unifiedScreenName));
      return {
        name: item.unifiedScreenName,
        url: match?.url || null,
        activeUsers: item.activeUsers || 0,
        views: item.screenPageViews || 0
      };
    });
}

function fillTimeline(report) {
  const values = new Map(
    rows(report).map((item) => [
      Number(item.minutesAgo),
      {
        minutesAgo: Number(item.minutesAgo),
        activeUsers: item.activeUsers || 0,
        views: item.screenPageViews || 0,
        events: item.eventCount || 0
      }
    ])
  );

  return Array.from({ length: 30 }, (_, index) => {
    const minutesAgo = 29 - index;
    return values.get(minutesAgo) || { minutesAgo, activeUsers: 0, views: 0, events: 0 };
  });
}

function timelinePeak(timeline) {
  if (!timeline.length) return null;
  return timeline.reduce((best, item) => (item.views || 0) > (best?.views || -1) ? item : best, null);
}

function aggregateMetrics(report, collection = 'totals') {
  const headers = report.metricHeaders?.map((item) => item.name) || [];
  const row = report?.[collection]?.[0];
  if (!row) return {};
  const output = {};
  headers.forEach((name, index) => {
    const value = row.metricValues?.[index]?.value ?? '0';
    output[name] = Number.isNaN(Number(value)) ? value : Number(value);
  });
  return output;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (realtimeCache && Date.now() - realtimeCacheAt < REALTIME_CACHE_MS) {
    return res.status(200).json({ ...realtimeCache, cache: 'memory' });
  }

  if (!isConfigured()) {
    return res.status(503).json({ error: 'Integração GA4 não configurada.' });
  }

  try {
    const [timelineReport, pagesReport] = await Promise.all([
      runRealtimeReport({
        dimensions: [{ name: 'minutesAgo' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'eventCount' }],
        metricAggregations: ['TOTAL'],
        minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
        orderBys: [{ dimension: { dimensionName: 'minutesAgo' }, desc: true }]
      }),
      runRealtimeReport({
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        limit: '100',
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
      })
    ]);

    const summary = aggregateMetrics(timelineReport);
    const allRealtimePageRows = rows(pagesReport)
      .filter((item) => item.unifiedScreenName && item.unifiedScreenName !== '(not set)');
    const activePageCount = allRealtimePageRows.length;
    const realtimePageRows = allRealtimePageRows.slice(0, 8);

    const activeTitles = [...new Set(realtimePageRows.map((item) => item.unifiedScreenName))];
    const missingTitles = activeTitles.filter((title) => !pageUrlCache.has(normalizeTitle(title)));
    const cacheOld = Date.now() - pageUrlCacheAt > PAGE_URL_CACHE_MS;

    if (activeTitles.length && (missingTitles.length || cacheOld)) {
      const pageUrlReport = await runReport({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pageTitle' }, { name: 'fullPageUrl' }],
        metrics: [{ name: 'screenPageViews' }],
        dimensionFilter: {
          filter: {
            fieldName: 'pageTitle',
            inListFilter: {
              values: cacheOld ? activeTitles : missingTitles,
              caseSensitive: false
            }
          }
        },
        limit: '100',
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
      });
      mergePageUrlCache(buildPageUrlMap(pageUrlReport));
    }

    const timeline = fillTimeline(timelineReport);
    const peak = timelinePeak(timeline);

    const payload = {
      mode: 'live',
      generatedAt: new Date().toISOString(),
      windowMinutes: 30,
      refreshSeconds: 60,
      summary: {
        activeUsers: summary.activeUsers || 0,
        views: summary.screenPageViews || 0,
        events: summary.eventCount || 0
      },
      timeline,
      peak: peak
        ? {
            minutesAgo: peak.minutesAgo,
            label: peak.minutesAgo === 0 ? 'agora' : `-${peak.minutesAgo} min`,
            activeUsers: peak.activeUsers,
            views: peak.views,
            events: peak.events
          }
        : null,
      activePageCount,
      pages: enrichRealtimePages(realtimePageRows)
    };

    realtimeCache = payload;
    realtimeCacheAt = Date.now();
    return res.status(200).json(payload);
  } catch (error) {
    if (realtimeCache) {
      return res.status(200).json({
        ...realtimeCache,
        stale: true,
        cache: 'stale',
        warning: error.message
      });
    }

    return res.status(502).json({
      error: 'Não foi possível consultar o GA4 em tempo real.',
      detail: error.message
    });
  }
}
