import { isConfigured, rows, runRealtimeReport, runReport } from './_ga.js';
import { counterConfigured, resolveCounterPageUrls } from './_counter.js';

let realtimeCache = null;
let realtimeCacheAt = 0;
const REALTIME_CACHE_MS = 55_000;

let pageUrlCache = new Map();
let pageUrlCacheAt = 0;
const PAGE_URL_CACHE_MS = 5 * 60_000;
const PAGE_URL_RETRY_MS = 10 * 60_000;
const unresolvedTitleCache = new Map();

const KNOWN_PAGE_URLS = new Map([
  [
    'demandas',
    'https://wiki.setic.ro.gov.br/pt-br/home/spaces/code/migration/Ferramentas/gitlab/informacoes_adicionais/gitlab_esteira_automocao'
  ],
  [
    'atividades de gestao patrimonial e seu impacto na depreciacao',
    'https://wiki.setic.ro.gov.br/pt-br/home/base_conhecimento/projetos/coge/pater_proj_depreciacao_sombrinha'
  ],
  [
    'estudo para verificacao da tabela 03 natureza das rubricas da folha de pagamento',
    'https://wiki.setic.ro.gov.br/pt-br/home/spaces/code/gc/estudos/tropadeelite7'
  ]
]);


function eventLabel(value = '') {
  const labels = {
    click: 'Cliques em links',
    file_download: 'Downloads de arquivos',
    view_search_results: 'Buscas realizadas',
    search: 'Buscas realizadas',
    form_start: 'Formulários iniciados',
    form_submit: 'Formulários enviados',
    scroll: 'Rolagens de página',
    video_start: 'Vídeos iniciados',
    video_complete: 'Vídeos concluídos',
    select_content: 'Seleções de conteúdo'
  };
  return labels[value] || String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildRealtimeEvents(report) {
  const generic = new Set(['page_view', 'session_start', 'first_visit', 'user_engagement']);
  const allRows = rows(report);
  const items = allRows
    .filter((item) => item.eventName && !generic.has(item.eventName))
    .slice(0, 10)
    .map((item) => ({
      name: item.eventName,
      label: eventLabel(item.eventName),
      count: item.eventCount || 0,
      activeUsers: item.activeUsers || 0,
      derived: false
    }));

  const measuredNames = new Set(allRows.map((item) => item.eventName));
  const expected = ['click', 'file_download', 'view_search_results'];
  const missing = expected.filter((name) => !measuredNames.has(name));

  return {
    items,
    instrumentationNote: missing.length
      ? `Nos últimos 30 minutos ainda não houve registro de: ${missing.map((name) => eventLabel(name).toLocaleLowerCase('pt-BR')).join(', ')}.`
      : null
  };
}

function normalizeTitle(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\|\s*wiki\.?setic\s*$/i, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(value = '') {
  return new Set(
    normalizeTitle(value)
      .split(' ')
      .filter((token) => token.length > 2)
  );
}

function titleSimilarity(left = '', right = '') {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);

  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 18) return 0.94;

  const aTokens = titleTokens(a);
  const bTokens = titleTokens(b);
  if (!aTokens.size || !bTokens.size) return 0;

  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }

  const coverage = shared / Math.max(aTokens.size, bTokens.size);
  const precision = shared / Math.min(aTokens.size, bTokens.size);
  return coverage * 0.72 + precision * 0.28;
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
  for (const [key, value] of nextMap.entries()) {
    pageUrlCache.set(key, value);
    unresolvedTitleCache.delete(key);
  }
  pageUrlCacheAt = Date.now();
}

function bestUrlMatch(title, report) {
  const candidates = rows(report)
    .filter((item) => item.pageTitle && item.fullPageUrl)
    .map((item) => ({
      title: item.pageTitle,
      url: /^https?:\/\//i.test(item.fullPageUrl) ? item.fullPageUrl : `https://${item.fullPageUrl}`,
      views: item.screenPageViews || 0,
      score: titleSimilarity(title, item.pageTitle)
    }))
    .filter((item) => item.score >= 0.78)
    .sort((a, b) => b.score - a.score || b.views - a.views);

  return candidates[0] || null;
}

function enrichRealtimePages(realtimeRows) {
  return realtimeRows
    .filter((item) => item.unifiedScreenName && item.unifiedScreenName !== '(not set)')
    .map((item) => {
      const key = normalizeTitle(item.unifiedScreenName);
      const match = pageUrlCache.get(key);
      const knownUrl = KNOWN_PAGE_URLS.get(key);
      return {
        name: item.unifiedScreenName,
        url: match?.url || knownUrl || null,
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
    const [summaryReport, timelineReport, pagesReport, eventsReport] = await Promise.all([
      runRealtimeReport({
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'eventCount' }]
      }),
      runRealtimeReport({
        dimensions: [{ name: 'minutesAgo' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'eventCount' }],
        minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
        orderBys: [{ dimension: { dimensionName: 'minutesAgo' }, desc: true }]
      }),
      runRealtimeReport({
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        limit: '100',
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
      }),
      runRealtimeReport({
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
        limit: '30',
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }]
      })
    ]);

    const summary = rows(summaryReport)[0] || {};
    const allRealtimePageRows = rows(pagesReport)
      .filter((item) => item.unifiedScreenName && item.unifiedScreenName !== '(not set)');
    const realtimePageRows = allRealtimePageRows.slice(0, 50);

    const activeTitles = [...new Set(realtimePageRows.map((item) => item.unifiedScreenName))];

    if (counterConfigured() && activeTitles.length) {
      try {
        const counterUrls = await resolveCounterPageUrls(activeTitles);
        for (const [key, url] of counterUrls.entries()) {
          pageUrlCache.set(key, { url, views: 0 });
          unresolvedTitleCache.delete(key);
        }
        if (counterUrls.size) pageUrlCacheAt = Date.now();
      } catch {
        // O GA4 continua como fallback para resolução de URL.
      }
    }

    const cacheOld = Date.now() - pageUrlCacheAt > PAGE_URL_CACHE_MS;
    const now = Date.now();

    const retryableTitles = activeTitles.filter((title) => {
      const key = normalizeTitle(title);
      if (pageUrlCache.has(key)) return false;
      const lastFailure = unresolvedTitleCache.get(key) || 0;
      return now - lastFailure > PAGE_URL_RETRY_MS;
    });

    if (activeTitles.length && (retryableTitles.length || cacheOld)) {
      const exactTitles = cacheOld ? activeTitles : retryableTitles;

      if (exactTitles.length) {
        const pageUrlReport = await runReport({
          dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'pageTitle' }, { name: 'fullPageUrl' }],
          metrics: [{ name: 'screenPageViews' }],
          dimensionFilter: {
            filter: {
              fieldName: 'pageTitle',
              inListFilter: {
                values: exactTitles,
                caseSensitive: false
              }
            }
          },
          limit: '250',
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
        });
        mergePageUrlCache(buildPageUrlMap(pageUrlReport));
      }

      const unresolved = retryableTitles.filter((title) => !pageUrlCache.has(normalizeTitle(title)));

      if (unresolved.length) {
        const fallbackReport = await runReport({
          dateRanges: [{ startDate: '90daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'pageTitle' }, { name: 'fullPageUrl' }],
          metrics: [{ name: 'screenPageViews' }],
          limit: '2500',
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
        });

        for (const title of unresolved) {
          const key = normalizeTitle(title);
          const match = bestUrlMatch(title, fallbackReport);

          if (match) {
            pageUrlCache.set(key, { url: match.url, views: match.views });
            unresolvedTitleCache.delete(key);
          } else {
            unresolvedTitleCache.set(key, Date.now());
          }
        }

        pageUrlCacheAt = Date.now();
      }
    }

    const timeline = fillTimeline(timelineReport);
    const peak = timelinePeak(timeline);
    const importantEvents = buildRealtimeEvents(eventsReport);
    const resolvedPages = enrichRealtimePages(realtimePageRows)
      .filter((item) => Boolean(item.url));
    const activePageCount = resolvedPages.length;

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
      pages: resolvedPages,
      events: importantEvents.items,
      eventInstrumentationNote: importantEvents.instrumentationNote
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
