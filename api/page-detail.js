import { batchRunReports, isConfigured, rows, runReport } from './_ga.js';

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

function sourceLabel(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw === '(direct) / (none)') return 'Acesso direto';
  if (/google/i.test(raw)) return raw.replace(/google/i, 'Google');
  if (/bing/i.test(raw)) return raw.replace(/bing/i, 'Bing');
  return raw;
}

function deviceLabel(value = '') {
  return ({
    mobile: 'Celular',
    desktop: 'Desktop',
    tablet: 'Tablet',
    smart_tv: 'Smart TV'
  })[value] || value || 'Outro';
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

    const [reports, todayReport] = await Promise.all([
      batchRunReports([
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
          limit: '24',
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
        },
        {
          dateRanges: [dateRange],
          dimensionFilter: filter,
          dimensions: [{ name: 'sessionSourceMedium' }],
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
          limit: '8',
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
        },
        {
          dateRanges: [dateRange],
          dimensionFilter: filter,
          dimensions: [{ name: 'deviceCategory' }],
          metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
          limit: '5',
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
        }
      ]),
      runReport({
        dateRanges: [{ startDate: 'today', endDate: 'today' }],
        dimensionFilter: filter,
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }]
      })
    ]);

    const [summaryReport, trendReport, hoursReport, sourcesReport, devicesReport] = reports;
    const summary = rows(summaryReport)[0] || {};
    const today = rows(todayReport)[0] || {};
    const activeUsers = summary.activeUsers || 0;
    const views = summary.screenPageViews || 0;

    const trend = rows(trendReport).map((item) => ({
      date: item.date,
      activeUsers: item.activeUsers || 0,
      views: item.screenPageViews || 0,
      avgEngagementSeconds: (item.activeUsers || 0) > 0
        ? (item.userEngagementDuration || 0) / item.activeUsers
        : 0
    }));

    const hours = rows(hoursReport).map((item) => ({
      hour: Number(item.hour || 0),
      label: `${String(Number(item.hour || 0)).padStart(2, '0')}:00`,
      activeUsers: item.activeUsers || 0,
      views: item.screenPageViews || 0
    }));

    const peakHours = hours
      .slice()
      .sort((a, b) => b.views - a.views || b.activeUsers - a.activeUsers)
      .slice(0, 3);

    const sources = rows(sourcesReport).map((item) => ({
      name: item.sessionSourceMedium || '(direct) / (none)',
      label: sourceLabel(item.sessionSourceMedium),
      sessions: item.sessions || 0,
      activeUsers: item.activeUsers || 0
    }));

    const devices = rows(devicesReport).map((item) => ({
      name: item.deviceCategory || 'other',
      label: deviceLabel(item.deviceCategory),
      activeUsers: item.activeUsers || 0,
      sessions: item.sessions || 0
    }));

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
        todayViews: today.screenPageViews || 0,
        todayUsers: today.activeUsers || 0,
        activeUsers,
        sessions: summary.sessions || 0,
        views,
        viewsPerUser: activeUsers > 0 ? views / activeUsers : 0,
        engagementRate: summary.engagementRate || 0,
        avgEngagementSeconds: activeUsers > 0
          ? (summary.userEngagementDuration || 0) / activeUsers
          : 0
      },
      peakHour: peakHours[0] || null,
      peakHours,
      trend,
      hours,
      sources,
      devices
    };

    detailCache.set(cacheKey, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (error) {
    if (cached) {
      return res.status(200).json({ ...cached.payload, stale: true, cache: 'stale', warning: error.message });
    }

    return res.status(502).json({
      error: 'Não foi possível consultar os detalhes da página.',
      detail: error.message
    });
  }
}
