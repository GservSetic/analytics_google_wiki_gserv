import { batchRunReports, isConfigured, rows } from './_ga.js';

const allowedRanges = new Set(['today', '7d', '30d']);
const reportCache = new Map();
const REPORT_CACHE_MS = 120_000;

function rangeFor(key) {
  if (key === 'today') return { startDate: 'today', endDate: 'today' };
  if (key === '7d') return { startDate: '7daysAgo', endDate: 'today' };
  return { startDate: '30daysAgo', endDate: 'today' };
}

function evolutionRangeFor(key) {
  if (key === '30d') return { startDate: '30daysAgo', endDate: 'today' };
  return { startDate: '7daysAgo', endDate: 'today' };
}

function pageKey(hostName, pagePath) {
  return `${hostName || 'wiki.setic.ro.gov.br'}|${pagePath || '/'}`;
}

function pageFilter(pages) {
  const expressions = pages.map((page) => ({
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: 'hostName',
            stringFilter: { matchType: 'EXACT', value: page.hostName, caseSensitive: false }
          }
        },
        {
          filter: {
            fieldName: 'pagePath',
            stringFilter: { matchType: 'EXACT', value: page.name, caseSensitive: true }
          }
        }
      ]
    }
  }));

  if (!expressions.length) return undefined;
  if (expressions.length === 1) return expressions[0];
  return { orGroup: { expressions } };
}

function labelPage(path = '/') {
  if (path === '/') return 'Página inicial';
  const accents = {
    cidadao: 'Cidadão',
    duvidas: 'Dúvidas',
    autenticacao: 'Autenticação',
    politica: 'Política',
    privacidade: 'Privacidade',
    servicos: 'Serviços',
    relatorios: 'Relatórios',
    aquisicoes: 'Aquisições',
    usuarios: 'Usuários'
  };

  return String(path)
    .replace(/^\/pt-br/i, '')
    .replace(/^\/home\//i, '')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .map((part) => part
      .replaceAll('_', ' ')
      .split(' ')
      .map((word) => accents[word.toLocaleLowerCase('pt-BR')] || word.replace(/\b\w/g, (letter) => letter.toUpperCase()))
      .join(' '))
    .join(' › ');
}

function sourceLabel(value = '') {
  const raw = String(value);
  if (raw === '(direct) / (none)') return 'Acesso direto';
  if (raw === '(not set)') return 'Não identificado';
  if (/google\s*\/\s*organic/i.test(raw)) return 'Google · orgânico';
  if (/bing\s*\/\s*organic/i.test(raw)) return 'Bing · orgânico';
  return raw
    .replace(' / referral', '')
    .replace(' / organic', ' · orgânico')
    .replace(' / ai-assistant', ' · assistente de IA');
}

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
  return labels[value] || value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildPages(report) {
  return rows(report).map((item) => {
    const activeUsers = item.activeUsers || 0;
    const engagementSeconds = item.userEngagementDuration || 0;
    const hostName = item.hostName || 'wiki.setic.ro.gov.br';
    const pagePath = item.pagePath || '/';

    return {
      name: pagePath,
      label: labelPage(pagePath),
      url: `https://${hostName}${pagePath}`,
      hostName,
      activeUsers,
      views: item.screenPageViews || 0,
      engagementRate: item.engagementRate || 0,
      avgEngagementSeconds: activeUsers > 0 ? engagementSeconds / activeUsers : 0
    };
  });
}


function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Porto_Velho',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}`;
}

function buildCities(report) {
  const grouped = new Map();

  for (const item of rows(report)) {
    const name = String(item.city || '').trim() || 'Não informado';
    grouped.set(name, (grouped.get(name) || 0) + (item.activeUsers || 0));
  }

  const sorted = [...grouped.entries()]
    .map(([name, activeUsers]) => ({ name, activeUsers }))
    .sort((a, b) => b.activeUsers - a.activeUsers);

  const top = sorted.slice(0, 6);
  const otherUsers = sorted.slice(6).reduce((sum, item) => sum + item.activeUsers, 0);
  if (otherUsers > 0) top.push({ name: 'Outros', activeUsers: otherUsers });
  return top;
}

function attachPageEvolution(pages, report, range) {
  const evolutionRows = rows(report);
  const allDates = [...new Set(evolutionRows.map((item) => item.date).filter(Boolean))].sort();
  const today = localDateKey();
  const grouped = new Map();

  for (const item of evolutionRows) {
    const key = pageKey(item.hostName, item.pagePath);
    if (!grouped.has(key)) grouped.set(key, new Map());
    grouped.get(key).set(item.date, {
      date: item.date,
      views: item.screenPageViews || 0,
      activeUsers: item.activeUsers || 0
    });
  }

  return pages.map((page) => {
    const values = grouped.get(pageKey(page.hostName, page.name)) || new Map();
    const trend = allDates.map((date) => values.get(date) || { date, views: 0, activeUsers: 0 });

    // Nunca comparar o dia parcial atual com um dia completo anterior.
    // A tendência só é calculada quando existem pelo menos dois dias completos.
    const completed = trend.filter((item) => item.date !== today);
    const comparable = range !== 'today' && completed.length >= 2;

    if (!comparable) {
      return {
        ...page,
        trend,
        direction: 'stable',
        deltaPercent: 0,
        trendComparable: false
      };
    }

    const size = Math.min(3, Math.max(1, Math.floor(completed.length / 2)));
    const firstSlice = completed.slice(0, size);
    const lastSlice = completed.slice(-size);
    const firstAverage = firstSlice.reduce((sum, item) => sum + item.views, 0) / Math.max(1, firstSlice.length);
    const lastAverage = lastSlice.reduce((sum, item) => sum + item.views, 0) / Math.max(1, lastSlice.length);
    const deltaPercent = firstAverage > 0
      ? ((lastAverage - firstAverage) / firstAverage) * 100
      : (lastAverage > 0 ? 100 : 0);
    const direction = deltaPercent > 10 ? 'up' : deltaPercent < -10 ? 'down' : 'stable';

    return { ...page, trend, direction, deltaPercent, trendComparable: true };
  });
}

function buildHeatmap(report) {
  const data = rows(report);
  const labels = [
    { day: 1, label: 'Seg' },
    { day: 2, label: 'Ter' },
    { day: 3, label: 'Qua' },
    { day: 4, label: 'Qui' },
    { day: 5, label: 'Sex' },
    { day: 6, label: 'Sáb' },
    { day: 0, label: 'Dom' }
  ];
  const grouped = new Map();
  const datesByDay = new Map();

  for (const item of data) {
    const day = Number(item.dayOfWeek);
    const hour = Number(item.hour);
    const key = `${day}|${hour}`;

    if (!datesByDay.has(day)) datesByDay.set(day, new Set());
    if (item.date) datesByDay.get(day).add(item.date);

    const current = grouped.get(key) || { views: 0, users: 0 };
    current.views += item.screenPageViews || 0;
    current.users += item.activeUsers || 0;
    grouped.set(key, current);
  }

  const matrix = labels.map(({ day, label }) => {
    const daySamples = Math.max(1, datesByDay.get(day)?.size || 0);
    return {
      day,
      label,
      cells: Array.from({ length: 24 }, (_, hour) => {
        const value = grouped.get(`${day}|${hour}`) || { views: 0, users: 0 };
        return {
          hour,
          views: Math.round(value.views / daySamples),
          activeUsers: Math.round(value.users / daySamples)
        };
      })
    };
  });

  const maxViews = Math.max(1, ...matrix.flatMap((row) => row.cells.map((cell) => cell.views)));
  const distinctDates = [...new Set(data.map((item) => item.date).filter(Boolean))].sort();
  return {
    period: '30d',
    maxViews,
    rows: matrix,
    sampleDays: distinctDates.length,
    firstDate: distinctDates[0] || null,
    lastDate: distinctDates.at(-1) || null
  };
}

function detectAnomaly(report) {
  const data = rows(report)
    .map((item) => ({
      date: item.date,
      hour: Number(item.hour),
      activeUsers: item.activeUsers || 0,
      views: item.screenPageViews || 0
    }))
    .filter((item) => item.date && Number.isFinite(item.hour));

  if (data.length < 8) {
    return { status: 'normal', title: 'Comportamento dentro do esperado', detail: 'Ainda não há histórico suficiente para uma comparação robusta.' };
  }

  const latestDate = data.map((item) => item.date).sort().at(-1);
  const latestDayRows = data.filter((item) => item.date === latestDate).sort((a, b) => a.hour - b.hour);
  const current = latestDayRows.length > 1 ? latestDayRows.at(-2) : latestDayRows.at(-1);
  if (!current) return { status: 'normal', title: 'Sem anomalias detectadas', detail: 'Monitoramento ativo.' };

  const baseline = data.filter((item) => item.date !== latestDate && item.hour === current.hour);
  if (baseline.length < 3) {
    return {
      status: 'normal',
      title: 'Comportamento dentro do esperado',
      detail: `Monitorando o padrão das ${String(current.hour).padStart(2, '0')}h.`,
      hour: current.hour,
      currentUsers: current.activeUsers
    };
  }

  const mean = baseline.reduce((sum, item) => sum + item.activeUsers, 0) / baseline.length;
  const variance = baseline.reduce((sum, item) => sum + Math.pow(item.activeUsers - mean, 2), 0) / baseline.length;
  const stdDev = Math.sqrt(variance);
  const zScore = stdDev > 0 ? (current.activeUsers - mean) / stdDev : 0;
  const spike = current.activeUsers >= Math.max(mean * 1.8, mean + 2 * stdDev) && current.activeUsers - mean >= 10;
  const drop = mean >= 20 && current.activeUsers <= Math.min(mean * 0.45, mean - 2 * stdDev);

  if (spike) {
    return {
      status: 'spike',
      title: 'Pico incomum detectado',
      detail: `${current.activeUsers} usuários às ${String(current.hour).padStart(2, '0')}h, acima da média histórica de ${Math.round(mean)}.`,
      hour: current.hour,
      currentUsers: current.activeUsers,
      expectedUsers: Math.round(mean),
      zScore
    };
  }

  if (drop) {
    return {
      status: 'drop',
      title: 'Queda incomum detectada',
      detail: `${current.activeUsers} usuários às ${String(current.hour).padStart(2, '0')}h, abaixo da média histórica de ${Math.round(mean)}.`,
      hour: current.hour,
      currentUsers: current.activeUsers,
      expectedUsers: Math.round(mean),
      zScore
    };
  }

  return {
    status: 'normal',
    title: 'Comportamento dentro do esperado',
    detail: `${current.activeUsers} usuários às ${String(current.hour).padStart(2, '0')}h; média histórica aproximada de ${Math.round(mean)}.`,
    hour: current.hour,
    currentUsers: current.activeUsers,
    expectedUsers: Math.round(mean),
    zScore
  };
}

function buildImportantEvents(report, pages) {
  const generic = new Set(['page_view', 'session_start', 'first_visit', 'user_engagement']);
  const eventRows = rows(report);
  const filtered = eventRows
    .filter((item) => item.eventName && !generic.has(item.eventName))
    .slice(0, 10)
    .map((item) => ({
      name: item.eventName,
      label: eventLabel(item.eventName),
      count: item.eventCount || 0,
      activeUsers: item.activeUsers || 0,
      derived: false
    }));

  const manualViews = pages
    .filter((page) => /\/manuais\//i.test(page.name))
    .reduce((sum, page) => sum + page.views, 0);

  if (manualViews > 0) {
    filtered.unshift({
      name: 'manual_page_view',
      label: 'Acessos a manuais',
      count: manualViews,
      activeUsers: 0,
      derived: true
    });
  }

  const measuredNames = new Set(eventRows.map((item) => item.eventName));
  const expected = ['click', 'file_download', 'view_search_results'];
  const missing = expected.filter((name) => !measuredNames.has(name));
  const missingLabels = missing.map((name) => eventLabel(name).toLocaleLowerCase('pt-BR'));

  return {
    items: filtered.slice(0, 10),
    instrumentationNote: missing.length
      ? `Ainda não há coleta registrada para: ${missingLabels.join(', ')}. Esses indicadores aparecerão automaticamente quando os respectivos eventos forem enviados ao GA4.`
      : null
  };
}

function compactDateLabel(value) {
  const raw = String(value || '');
  return /^\d{8}$/.test(raw) ? `${raw.slice(6, 8)}/${raw.slice(4, 6)}` : raw;
}

function buildSmartSummary(range, summary, trend, pages, devices, anomaly) {
  const period = range === 'today' ? 'Hoje' : range === '7d' ? 'Nos últimos 7 dias' : 'Nos últimos 30 dias';
  const peak = trend.reduce((best, item) => (item.views || 0) > (best?.views || -1) ? item : best, null);
  const topPages = pages.slice(0, 2).map((page) => page.label).filter(Boolean);
  const topDevice = devices[0];
  const pieces = [
    `${period}, a Wiki registra ${summary.activeUsers || 0} usuários ativos e ${summary.views || 0} visualizações.`
  ];

  if (peak) pieces.push(`O maior movimento ocorreu em ${compactDateLabel(peak.label || peak.date || peak.hour)}, com ${peak.views || 0} visualizações.`);
  if (topPages.length) pieces.push(`${topPages.join(' e ')} concentram os maiores volumes de acesso.`);
  if (topDevice) {
    const deviceLabel = { mobile: 'celular', desktop: 'desktop', tablet: 'tablet' }[topDevice.name] || topDevice.name;
    pieces.push(`O acesso por ${deviceLabel} lidera entre os dispositivos.`);
  }
  if (anomaly.status === 'spike') pieces.push('O monitoramento detectou um pico acima do padrão histórico.');
  if (anomaly.status === 'drop') pieces.push('O monitoramento detectou uma queda abaixo do padrão histórico.');

  return pieces.join(' ');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const range = allowedRanges.has(req.query?.range) ? req.query.range : 'today';
  const cached = reportCache.get(range);

  if (cached && Date.now() - cached.at < REPORT_CACHE_MS) {
    return res.status(200).json({ ...cached.payload, cache: 'memory' });
  }

  if (!isConfigured()) {
    return res.status(503).json({ error: 'Integração GA4 não configurada.' });
  }

  try {
    const dateRange = rangeFor(range);
    const trendDimension = range === 'today' ? 'hour' : 'date';

    const firstBatch = await batchRunReports([
      {
        dateRanges: [dateRange],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'engagementRate' },
          { name: 'averageEngagementTimePerSession', expression: 'userEngagementDuration/sessions' }
        ]
      },
      {
        dateRanges: [dateRange],
        dimensions: [{ name: trendDimension }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: trendDimension } }]
      },
      {
        dateRanges: [dateRange],
        dimensions: [{ name: 'hostName' }, { name: 'pagePath' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'screenPageViews' },
          { name: 'userEngagementDuration' },
          { name: 'engagementRate' }
        ],
        limit: '20',
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
      },
      {
        dateRanges: [dateRange],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
        limit: '5',
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
      },
      {
        dateRanges: [dateRange],
        dimensions: [{ name: 'city' }],
        metrics: [{ name: 'activeUsers' }],
        limit: '50',
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
      }
    ]);

    const [summaryReport, trendReport, pagesReport, devicesReport, citiesReport] = firstBatch;
    const summaryRow = rows(summaryReport)[0] || {};
    const rawPages = buildPages(pagesReport);

    const secondRequests = [
      {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }, { name: 'dayOfWeek' }, { name: 'hour' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        limit: '2000',
        orderBys: [
          { dimension: { dimensionName: 'date' } },
          { dimension: { dimensionName: 'hour' } }
        ]
      },
      {
        dateRanges: [dateRange],
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        limit: '12',
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
      },
      {
        dateRanges: [dateRange],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
        limit: '30',
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }]
      }
    ];

    if (rawPages.length) {
      secondRequests.push({
        dateRanges: [evolutionRangeFor(range)],
        dimensions: [{ name: 'date' }, { name: 'hostName' }, { name: 'pagePath' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        dimensionFilter: pageFilter(rawPages),
        limit: '2000',
        orderBys: [{ dimension: { dimensionName: 'date' } }]
      });
    }

    const secondBatch = await batchRunReports(secondRequests);
    const heatmapReport = secondBatch[0];
    const sourcesReport = secondBatch[1];
    const eventsReport = secondBatch[2];
    const evolutionReport = secondBatch[3] || { rows: [] };

    const trend = rows(trendReport)
      .map((item) => ({
        label: range === 'today' ? `${String(item.hour || '00').padStart(2, '0')}:00` : item.date,
        date: item.date || null,
        hour: item.hour ?? null,
        activeUsers: item.activeUsers || 0,
        sessions: item.sessions || 0,
        views: item.screenPageViews || 0
      }))
      .sort((a, b) => range === 'today'
        ? Number(a.hour || 0) - Number(b.hour || 0)
        : String(a.date || '').localeCompare(String(b.date || '')));

    const pages = attachPageEvolution(rawPages, evolutionReport, range);
    const devices = rows(devicesReport).map((item) => ({
      name: item.deviceCategory,
      activeUsers: item.activeUsers || 0,
      sessions: item.sessions || 0
    }));
    const cities = buildCities(citiesReport);
    const summary = {
      activeUsers: summaryRow.activeUsers || 0,
      sessions: summaryRow.sessions || 0,
      views: summaryRow.screenPageViews || 0,
      engagementRate: summaryRow.engagementRate || 0,
      avgEngagementSeconds: summaryRow.averageEngagementTimePerSession || 0
    };
    const anomaly = detectAnomaly(heatmapReport);
    const sources = rows(sourcesReport).map((item) => ({
      name: item.sessionSourceMedium,
      label: sourceLabel(item.sessionSourceMedium),
      sessions: item.sessions || 0,
      activeUsers: item.activeUsers || 0
    }));
    const importantEvents = buildImportantEvents(eventsReport, pages);

    const payload = {
      mode: 'live',
      range,
      generatedAt: new Date().toISOString(),
      summary,
      smartSummary: buildSmartSummary(range, summary, trend, pages, devices, anomaly),
      anomaly,
      trendGranularity: range === 'today' ? 'hour' : 'day',
      trend,
      daily: range === 'today' ? [] : trend.map((item) => ({
        date: item.date,
        activeUsers: item.activeUsers,
        sessions: item.sessions,
        views: item.views
      })),
      pages,
      heatmap: buildHeatmap(heatmapReport),
      sources,
      events: importantEvents.items,
      eventInstrumentationNote: importantEvents.instrumentationNote,
      devices,
      cities
    };

    reportCache.set(range, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (error) {
    if (cached) {
      return res.status(200).json({ ...cached.payload, stale: true, cache: 'stale', warning: error.message });
    }
    return res.status(502).json({ error: 'Não foi possível consultar o relatório do GA4.', detail: error.message });
  }
}
