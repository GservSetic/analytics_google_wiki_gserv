const state = {
  range: 'today',
  report: null,
  realtime: null,
  timer: null,
  reportTimer: null,
  counter: null,
  counterTimer: null,
  lastRealtimeUsers: null,
  pageDetail: null,
  pageDetailRange: '7d',
  trendMode: 'both',
};

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('pt-BR');
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function shortLabel(value) {
  if (!value) return 'Sem identificação';
  if (value === '/') return 'Página inicial';
  return value
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/pt-br/i, '')
    .replace(/^\/home\//i, '')
    .replaceAll('_', ' ')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join(' › ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(raw) {
  if (!raw || raw.length !== 8) return raw || '';
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6)) - 1;
  const day = Number(raw.slice(6, 8));
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(year, month, day));
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

function formatSeconds(value) {
  const seconds = Math.max(0, Number(value || 0));
  if (seconds < 60) return `${seconds.toFixed(1).replace('.', ',')}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

function compact(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace('.', ',')}k`;
  return fmt.format(value);
}

function animateNumber(el, next, formatter = (n) => fmt.format(Math.round(n))) {
  if (!el) return;
  const previous = Number(el.dataset.value || 0);
  const duration = 500;
  const started = performance.now();
  const target = Number(next || 0);

  function frame(now) {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = previous + (target - previous) * eased;
    el.textContent = formatter(current);
    if (progress < 1) requestAnimationFrame(frame);
    else el.dataset.value = target;
  }

  requestAnimationFrame(frame);
}

function setMode(mode) {
  const live = mode === 'live';
  $('sidebarMode').textContent = live ? 'Dados oficiais em tempo real' : 'Modo de demonstração';
  $('footerMode').textContent = live ? 'Integração GA4 ativa' : 'Prévia — aguardando credenciais GA4';
}

function updateTimestamp(iso) {
  const date = iso ? new Date(iso) : new Date();
  $('lastUpdate').textContent = `atualizado às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function updateSyncStatus() {
  if (state.counter?.degraded) {
    $('syncLabel').textContent = 'GA4 ativo · contador em pausa';
    return;
  }

  if (state.realtime?.stale) {
    $('syncLabel').textContent = 'Tempo real em cache';
    return;
  }

  if (state.report?.stale) {
    $('syncLabel').textContent = 'Dados em cache';
    return;
  }

  $('syncLabel').textContent = 'Sincronizado';
}

function reconcileTodaySources() {
  if (state.range !== 'today') {
    updateSyncStatus();
    return;
  }

  if (state.counter?.enabled) {
    renderCounter(state.counter);
  } else if (state.counter?.degraded) {
    renderCounterFallback(state.counter);
  }

  if (state.realtime && Array.isArray(state.realtime.events)) {
    renderEvents(state.realtime.events, state.realtime.eventInstrumentationNote);
    if ($('eventsSourceLabel')) $('eventsSourceLabel').textContent = 'GA4 Realtime · últimos 30 min';
  }

  updateSyncStatus();
}

async function getJson(url) {
  if (location.protocol === 'file:' && window.DEMO_DATA) {
    if (url.startsWith('/api/realtime')) return structuredClone(window.DEMO_DATA.realtime);
    if (url.startsWith('/api/page-detail')) throw new Error('Detalhes avançados disponíveis apenas com a API conectada.');
    const range = new URLSearchParams(url.split('?')[1] || '').get('range') || 'today';
    return structuredClone(window.DEMO_DATA.reports[range] || window.DEMO_DATA.reports.today);
  }

  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || data.error || 'Falha ao carregar dados.');
  return data;
}

async function loadReport() {
  $('syncLabel').textContent = 'Sincronizando';
  try {
    const report = await getJson(`/api/report?range=${encodeURIComponent(state.range)}`);
    state.report = report;
    renderReport(report);
    setMode(report.mode);
    updateTimestamp(report.generatedAt);
    reconcileTodaySources();
    if (report.warning) showToast('O GA4 atingiu um limite temporário; exibindo o último relatório válido.');
  } catch (error) {
    $('syncLabel').textContent = 'Falha na sincronização';
    showToast(error.message);
  }
}

async function loadRealtime() {
  try {
    const realtime = await getJson('/api/realtime');
    const previous = state.lastRealtimeUsers;
    state.realtime = realtime;
    state.lastRealtimeUsers = realtime.summary.activeUsers;
    renderRealtime(realtime);
    setMode(realtime.mode);
    updateTimestamp(realtime.generatedAt);
    reconcileTodaySources();

    if (previous !== null && realtime.summary.activeUsers > previous) {
      showToast(`Novo acesso detectado · ${fmt.format(realtime.summary.activeUsers)} usuários ativos`);
      premiumPulse('.realtime-panel');
      premiumPulse('.live-pages-panel');
    }
  } catch (error) {
    $('syncLabel').textContent = 'Reconectando';
    showToast(error.message);
  }
}

async function loadCounter() {
  try {
    const counter = await getJson('/api/live-counter');
    state.counter = counter;

    if (!counter?.enabled) {
      reconcileTodaySources();
      return;
    }

    renderCounter(counter);
    updateTimestamp(counter.generatedAt);
    reconcileTodaySources();
  } catch {
    state.counter = { enabled: false, degraded: true, source: 'ga4' };
    reconcileTodaySources();
  }
}

function renderCounterFallback(counter = {}) {
  if (state.range !== 'today' || !state.report) return;

  const summary = state.report.summary || {};
  const live = state.realtime?.summary || {};
  const lastHour = state.report.trend?.at(-1);
  const lastHourLabel = lastHour ? trendLabel(lastHour, 'hour') : null;
  const processedCaption = lastHourLabel
    ? `GA4 consolidado somente até aproximadamente ${lastHourLabel}`
    : 'GA4 intradiário ainda em processamento';

  // Sem Redis não exibimos um total diário incompleto como se fosse o total real de hoje.
  $('metricUsers').textContent = '—';
  $('metricSessions').textContent = '—';
  $('metricViews').textContent = '—';
  delete $('metricUsers').dataset.value;
  delete $('metricSessions').dataset.value;
  delete $('metricViews').dataset.value;

  $('metricUsersLabel').textContent = 'Usuários ativos hoje';
  $('metricSessionsLabel').textContent = 'Sessões hoje';
  $('metricViewsLabel').textContent = 'Visualizações hoje';

  $('metricUsersCaption').textContent = 'Aguardando BigQuery Streaming · total diário';
  $('metricSessionsCaption').textContent = 'Aguardando BigQuery Streaming · total diário';
  $('metricViewsCaption').textContent = 'Aguardando BigQuery Streaming · total diário';
  $('metricEngagementCaption').textContent = processedCaption;
  $('metricTimeCaption').textContent = processedCaption;

  if ($('pagesSourceLabel')) $('pagesSourceLabel').textContent = processedCaption;
  if ($('audienceSourceLabel')) $('audienceSourceLabel').textContent = processedCaption;
  if ($('engagementSourceLabel')) $('engagementSourceLabel').textContent = processedCaption;
  if ($('citiesSourceLabel')) $('citiesSourceLabel').textContent = processedCaption;
  if ($('sourcesSourceLabel')) $('sourcesSourceLabel').textContent = processedCaption;

  renderTrend(state.report.trend || [], 'hour', false);

  const liveUsers = live.activeUsers || 0;
  const liveViews = live.views || 0;

  $('smartSummaryText').textContent =
    `O total atualizado de hoje ainda está aguardando a exportação Streaming do GA4 para o BigQuery. ` +
    `No GA4 Realtime, ${fmt.format(liveUsers)} usuários distintos estiveram ativos e ocorreram ${fmt.format(liveViews)} visualizações nos últimos 30 minutos. ` +
    (lastHourLabel
      ? `Como referência apenas, o GA4 intradiário já consolidou dados até aproximadamente ${lastHourLabel}, mas esses valores não representam o total atual do dia.`
      : '');

  $('anomalyDetail').textContent =
    'Os cards diários serão preenchidos pelo BigQuery assim que a exportação Streaming estiver ativa. O Tempo Real continua válido e independente, usando diretamente o GA4 Realtime.';

  $('syncLabel').textContent = 'GA4 ativo · BigQuery aguardando';
}

function renderReport(data) {
  const summary = data.summary || {};
  animateNumber($('metricUsers'), summary.activeUsers);
  animateNumber($('metricSessions'), summary.sessions);
  animateNumber($('metricViews'), summary.views);
  animateNumber($('metricEngagement'), (summary.engagementRate || 0) * 100, (n) => `${n.toFixed(1).replace('.', ',')}%`);
  animateNumber($('metricTime'), summary.avgEngagementSeconds || 0, (n) => formatSeconds(n));

  $('metricUsersLabel').textContent = state.range === 'today' ? 'Usuários ativos' : 'Usuários';
  $('metricSessionsLabel').textContent = 'Sessões';
  $('metricViewsLabel').textContent = 'Visualizações';
  $('metricUsersCaption').textContent = state.range === 'today'
    ? 'GA4 · dados de hoje já processados'
    : 'Usuários no período selecionado';
  $('metricSessionsCaption').textContent = state.range === 'today'
    ? 'GA4 · dados de hoje já processados'
    : 'Sessões iniciadas no período';
  $('metricViewsCaption').textContent = state.range === 'today'
    ? 'GA4 · dados de hoje já processados'
    : 'Visualizações de páginas';
  $('metricEngagementCaption').textContent = state.range === 'today'
    ? 'GA4 · dados de hoje já processados'
    : 'Taxa de sessões engajadas';
  $('metricTimeCaption').textContent = state.range === 'today'
    ? 'GA4 · dados de hoje já processados'
    : 'Engajamento por sessão';

  if ($('pagesSourceLabel')) $('pagesSourceLabel').textContent = state.range === 'today' ? 'GA4 · processado' : 'por visualizações';
  if ($('audienceSourceLabel')) $('audienceSourceLabel').textContent = state.range === 'today' ? 'GA4 · processado' : 'usuários';
  if ($('engagementSourceLabel')) $('engagementSourceLabel').textContent = state.range === 'today' ? 'GA4 · processado' : 'clique na página para analisar';
  if ($('citiesSourceLabel')) $('citiesSourceLabel').textContent = state.range === 'today' ? 'GA4 · processado' : 'usuários ativos';
  if ($('sourcesSourceLabel')) $('sourcesSourceLabel').textContent = state.range === 'today' ? 'GA4 · dados processados' : 'sessões';
  if ($('eventsSourceLabel')) $('eventsSourceLabel').textContent = state.range === 'today' ? 'GA4 · dados processados' : 'ações registradas';

  document.querySelectorAll('.metric-card').forEach((card) => card.classList.remove('counter-live'));

  renderSmartSummary(data);
  renderTrend(data.trend || data.daily || [], data.trendGranularity || 'day', false);
  renderHeatmap(data.heatmap);
  renderSources(data.sources || []);
  renderEvents(data.events || [], data.eventInstrumentationNote);
  renderPages(data.pages || []);
  renderEngagement(data.pages || []);
  renderDevices(data.devices || [], summary.activeUsers || 0);
  renderCities(data.cities || []);

  if (state.counter?.enabled && state.range === 'today') {
    renderCounter(state.counter);
  } else if (state.range === 'today' && state.counter?.degraded) {
    renderCounterFallback(state.counter);
  }

  if (state.range === 'today' && state.realtime && Array.isArray(state.realtime.events)) {
    renderEvents(state.realtime.events, state.realtime.eventInstrumentationNote);
    if ($('eventsSourceLabel')) $('eventsSourceLabel').textContent = 'GA4 Realtime · últimos 30 min';
  }
}

function renderCounter(data) {
  if (!data?.enabled || state.range !== 'today') return;

  const today = data.today || {};
  const coverage = data.coverage || {};
  const realtime = state.realtime?.summary || {};

  animateNumber($('metricUsers'), today.users || 0);
  animateNumber($('metricSessions'), today.sessions || 0);
  animateNumber($('metricViews'), today.views || 0);

  $('metricUsersLabel').textContent = 'Usuários únicos hoje';
  $('metricSessionsLabel').textContent = 'Sessões hoje';
  $('metricViewsLabel').textContent = 'Visualizações hoje';

  $('metricUsersCaption').textContent = 'BigQuery Streaming · atualização quase em tempo real';
  $('metricSessionsCaption').textContent = 'BigQuery Streaming · atualização quase em tempo real';
  $('metricViewsCaption').textContent = 'BigQuery Streaming · atualização quase em tempo real';

  // Engajamento e tempo médio continuam no GA4: o contador próprio mede acesso,
  // enquanto o GA4 é a fonte correta para métricas comportamentais.
  $('metricEngagementCaption').textContent = 'GA4 · dados comportamentais processados';
  $('metricTimeCaption').textContent = 'GA4 · dados comportamentais processados';

  ['metricUsers', 'metricSessions', 'metricViews'].forEach((id) => {
    $(id)?.closest('.metric-card')?.classList.add('counter-live');
  });

  if ($('pagesSourceLabel')) $('pagesSourceLabel').textContent = 'BigQuery Streaming · hoje';
  if ($('audienceSourceLabel')) $('audienceSourceLabel').textContent = 'usuários únicos hoje';
  if ($('engagementSourceLabel')) $('engagementSourceLabel').textContent = 'acessos: BigQuery · engajamento: GA4';
  if ($('citiesSourceLabel')) $('citiesSourceLabel').textContent = 'usuários únicos hoje';
  if ($('sourcesSourceLabel')) $('sourcesSourceLabel').textContent = 'sessões hoje · BigQuery';
  if ($('eventsSourceLabel')) $('eventsSourceLabel').textContent = state.realtime && Array.isArray(state.realtime.events)
    ? 'GA4 Realtime · últimos 30 min'
    : 'GA4 · dados processados';

  renderTrend(data.trend || [], 'hour', true);
  renderPages(data.pages || []);
  // O detalhamento de engajamento permanece com o GA4 já renderizado em renderReport().
  renderDevices(data.devices || [], today.users || 0);
  renderCities(data.cities || []);
  renderSources(data.sources || []);

  const topPage = data.pages?.[0];
  $('smartSummaryText').textContent =
    `Hoje, a Wiki registra ${fmt.format(today.users || 0)} usuários únicos, ${fmt.format(today.sessions || 0)} sessões e ${fmt.format(today.views || 0)} visualizações. ` +
    `Nos últimos 30 minutos, o GA4 Realtime registra ${fmt.format(realtime.activeUsers || 0)} usuários ativos e ${fmt.format(realtime.views || 0)} visualizações.` +
    (topPage ? ` A página com mais visualizações hoje é ${topPage.label || shortLabel(topPage.name)}, com ${fmt.format(topPage.views || 0)} visualizações.` : '');

  $('anomalyDetail').textContent = coverage.completeDay === false
    ? 'O BigQuery começou a receber dados após o início do dia; o primeiro dia pode ficar parcial.'
    : 'Totais e detalhamentos de Hoje vêm do BigQuery Streaming; atividade dos últimos 30 minutos vem do GA4 Realtime.';
}

function renderSmartSummary(data) {
  $('smartSummaryText').textContent = data.smartSummary || 'Dados sincronizados com o Google Analytics.';
  const anomaly = data.anomaly || { status: 'normal', title: 'Monitoramento normal', detail: 'Sem alterações relevantes.' };
  const badge = $('anomalyBadge');

  badge.className = `anomaly-badge ${anomaly.status || 'normal'}`;
  badge.textContent = anomaly.status === 'spike'
    ? 'Pico detectado'
    : anomaly.status === 'drop'
      ? 'Queda detectada'
      : 'Monitoramento normal';

  $('anomalyDetail').textContent = anomaly.detail || '';
  $('smartSummaryCard').classList.toggle('has-anomaly', anomaly.status === 'spike' || anomaly.status === 'drop');
}

function renderRealtime(data) {
  animateNumber($('realtimeUsers'), data.summary?.activeUsers || 0);
  animateNumber($('realtimeUsers30m'), data.summary?.activeUsers || 0);
  animateNumber($('realtimeViews'), data.summary?.views || 0);
  $('realtimeSessions').textContent = '—';
  animateNumber($('realtimeEvents'), data.summary?.events || 0);
  $('realtimeUsersLabel').textContent = 'Usuários ativos · 30 min';
  $('realtimeNote').textContent = 'GA4 Realtime · atualização automática a cada 60s';

  renderRealtimeChart(data.timeline || []);

  if (state.range === 'today') {
    renderEvents(data.events || [], data.eventInstrumentationNote);
    if ($('eventsSourceLabel')) $('eventsSourceLabel').textContent = 'GA4 Realtime · últimos 30 min';
  }

  const peak = data.peak;
  $('realtimePeak').textContent = peak
    ? `Pico recente: ${peak.label} · ${fmt.format(peak.views || 0)} visualizações · ${fmt.format(peak.activeUsers || 0)} usuários`
    : 'Ainda não há atividade suficiente para destacar um pico.';

  const pages = data.pages || [];
  const activePagesCount = Number(data.activePageCount ?? pages.length ?? 0);
  const activePagesLabel = activePagesCount === 1 ? '1 página ativa' : `${fmt.format(activePagesCount)} páginas ativas`;
  if ($('activePagesCount')) $('activePagesCount').textContent = activePagesLabel;

  $('livePageList').innerHTML = pages.length ? pages.map((item) => {
    const labelText = shortLabel(item.name);
    const label = escapeHtml(labelText);
    const title = escapeHtml(item.name);
    const parts = item.url ? pagePartsFromUrl(item.url, labelText) : null;

    const pageControl = parts
      ? `<button
          type="button"
          class="live-page-link live-page-detail page-detail-btn"
          data-page-path="${escapeHtml(parts.path)}"
          data-page-host="${escapeHtml(parts.host)}"
          data-page-label="${escapeHtml(parts.label)}"
          title="Analisar ${title}"
        ><span>${label}</span></button>
        <a class="live-page-open live-page-open-target" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="Abrir página na Wiki" aria-label="Abrir ${title}">↗</a>`
      : `<span class="live-page-name" title="${title}">${label}</span>`;

    return `
      <div class="live-page-item">
        <div class="live-page-main">
          <span class="live-status-dot" aria-hidden="true"></span>
          <span class="live-page-title-wrap">${pageControl}</span>
        </div>
        <strong class="live-page-metric" title="Usuários ativos nos últimos 30 minutos">${fmt.format(item.activeUsers || 0)}</strong>
        <strong class="live-page-metric views" title="Visualizações nos últimos 30 minutos">${fmt.format(item.views || 0)}</strong>
      </div>`;
  }).join('') : '<span class="muted">Nenhuma atividade recente.</span>';

  bindPageDetailButtons();
}

function renderRealtimeChart(list) {
  const svg = $('realtimeChart');
  if (!svg) return;

  const width = 420;
  const height = 90;
  const pad = { left: 4, right: 4, top: 10, bottom: 8 };

  if (!list.length) {
    svg.innerHTML = '<text x="210" y="48" text-anchor="middle" class="realtime-empty">Sem atividade recente</text>';
    return;
  }

  const max = Math.max(1, ...list.flatMap((item) => [item.activeUsers || 0, item.views || 0]));
  const x = (i) => pad.left + i * (width - pad.left - pad.right) / Math.max(1, list.length - 1);
  const y = (value) => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);

  const userPoints = list.map((item, index) => `${x(index)},${y(item.activeUsers || 0)}`).join(' ');
  const viewPoints = list.map((item, index) => `${x(index)},${y(item.views || 0)}`).join(' ');
  const area = `${pad.left},${height - pad.bottom} ${userPoints} ${x(list.length - 1)},${height - pad.bottom}`;

  const peakIndex = list.reduce((best, item, index) => (item.views || 0) > (list[best]?.views || -1) ? index : best, 0);
  const peakX = x(peakIndex);
  const peakUserY = y(list[peakIndex]?.activeUsers || 0);

  svg.innerHTML = `
    <defs>
      <linearGradient id="realtimeAreaGradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#3f9cff" stop-opacity=".26"/>
        <stop offset="100%" stop-color="#3f9cff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <line class="realtime-grid-line" x1="4" y1="45" x2="416" y2="45"/>
    <polygon class="realtime-area" points="${area}"/>
    <polyline class="realtime-line-views" points="${viewPoints}"/>
    <polyline class="realtime-line-users" points="${userPoints}"/>
    <line class="realtime-peak-line" x1="${peakX}" y1="8" x2="${peakX}" y2="82"/>
    <circle class="realtime-peak-point" cx="${peakX}" cy="${peakUserY}" r="4"/>
  `;
}

function pageUrl(item) {
  if (item.url) return item.url;
  const path = String(item.name || '');
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/')) return `https://wiki.setic.ro.gov.br${path}`;
  return 'https://wiki.setic.ro.gov.br';
}

function pagePartsFromUrl(url, fallbackLabel = '') {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      path: parsed.pathname || '/',
      label: fallbackLabel || shortLabel(parsed.pathname || '/')
    };
  } catch {
    return {
      host: 'wiki.setic.ro.gov.br',
      path: '/',
      label: fallbackLabel || 'Página'
    };
  }
}

function sparklineSvg(trend = []) {
  if (!trend.length) return '<span class="sparkline-empty">sem histórico</span>';
  const width = 92;
  const height = 28;
  const values = trend.map((item) => Number(item.views || 0));
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const x = (index) => index * width / Math.max(1, trend.length - 1);
  const y = (value) => height - 4 - ((value - min) / span) * (height - 8);
  const points = trend.map((item, index) => `${x(index)},${y(item.views || 0)}`).join(' ');
  return `<svg class="page-sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"/></svg>`;
}

function trendChip(item) {
  const direction = item.direction || 'stable';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  const value = Math.abs(Number(item.deltaPercent || 0));
  return `<span class="page-trend-chip ${direction}">${arrow} ${value.toFixed(0)}%</span>`;
}

function renderPages(list) {
  const max = Math.max(1, ...list.map((item) => item.views || 0));

  $('pageList').innerHTML = list.map((item, index) => `
    <div class="rank-item page-rank-item">
      <span class="rank-number">${index + 1}</span>
      <div class="rank-main">
        <button
          type="button"
          class="rank-title rank-title-link rank-title-detail page-detail-btn"
          data-page-path="${escapeHtml(item.name)}"
          data-page-host="${escapeHtml(item.hostName || 'wiki.setic.ro.gov.br')}"
          data-page-label="${escapeHtml(item.label || shortLabel(item.name))}"
          title="Analisar ${escapeHtml(item.label || shortLabel(item.name))}"
        >
          <span>${escapeHtml(item.label || shortLabel(item.name))}</span>
          <span class="rank-open-icon rank-detail-icon" aria-hidden="true">→</span>
        </button>
        <div class="rank-bar"><i style="width:${Math.max(4, (item.views / max) * 100)}%"></i></div>
      </div>
      <div class="page-evolution">
        ${sparklineSvg(item.trend)}
        ${item.trendComparable ? trendChip(item) : '<span class="sparkline-empty">sem comparação completa</span>'}
      </div>
      <strong class="rank-value">${fmt.format(item.views || 0)}</strong>
    </div>`).join('');

  bindPageDetailButtons();
}

function renderEngagement(list) {
  const body = $('engagementTable');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhuma página encontrada.</td></tr>';
    return;
  }

  body.innerHTML = list.slice(0, 12).map((item) => `
    <tr>
      <td>
        <button
          type="button"
          class="engagement-page-button page-detail-btn"
          data-page-path="${escapeHtml(item.name)}"
          data-page-host="${escapeHtml(item.hostName || 'wiki.setic.ro.gov.br')}"
          data-page-label="${escapeHtml(item.label || shortLabel(item.name))}"
        >
          <span>${escapeHtml(item.label || shortLabel(item.name))}</span>
          <small>${escapeHtml(item.hostName || 'wiki.setic.ro.gov.br')}</small>
        </button>
      </td>
      <td><strong>${fmt.format(item.views || 0)}</strong></td>
      <td>${fmt.format(item.activeUsers || 0)}</td>
      <td>${formatSeconds(item.avgEngagementSeconds || 0)}</td>
      <td><span class="engagement-rate-pill">${pct.format(item.engagementRate || 0)}</span></td>
    </tr>`).join('');

  bindPageDetailButtons();
}

function renderHeatmap(data) {
  const grid = $('heatmapGrid');
  if (!data?.rows?.length) {
    grid.innerHTML = '<span class="muted">Ainda não há dados suficientes para o mapa de calor.</span>';
    $('heatmapInsight').textContent = 'O padrão semanal aparecerá assim que houver histórico suficiente.';
    return;
  }

  const max = Math.max(1, data.maxViews || 1);
  let hottest = { views: -1, day: '', hour: 0, activeUsers: 0 };

  const header = ['<span class="heatmap-corner"></span>']
    .concat(Array.from({ length: 24 }, (_, hour) => `<span class="heatmap-hour">${String(hour).padStart(2, '0')}h</span>`))
    .join('');

  const cells = data.rows.map((row) => {
    const rowCells = row.cells.map((cell) => {
      if (cell.views > hottest.views) hottest = { ...cell, day: row.label };
      const intensity = Math.max(0.035, Math.min(1, (cell.views || 0) / max));
      return `<span
        class="heatmap-cell"
        style="--heat:${intensity}"
        title="${row.label} · ${String(cell.hour).padStart(2, '0')}h · média de ${fmt.format(cell.views || 0)} visualizações · ${fmt.format(cell.activeUsers || 0)} usuários"
      ></span>`;
    }).join('');
    return `<span class="heatmap-day">${row.label}</span>${rowCells}`;
  }).join('');

  grid.innerHTML = header + cells;

  const sampleDays = Number(data.sampleDays || 0);
  const firstDate = data.firstDate ? formatDate(data.firstDate) : null;
  const historyNote = sampleDays > 0 && sampleDays < 7
    ? ` <span class="muted">Histórico inicial: ${sampleDays} dia(s)${firstDate ? `, desde ${firstDate}` : ''}. O padrão ficará mais representativo com mais dias de coleta.</span>`
    : '';

  $('heatmapInsight').innerHTML = hottest.views >= 0
    ? `<strong>Maior concentração observada:</strong> ${hottest.day}, por volta de ${String(hottest.hour).padStart(2, '0')}h, com média de ${fmt.format(hottest.views)} visualizações.${historyNote}`
    : 'Ainda não há um horário predominante.';
}

function renderSources(list) {
  const target = $('sourceList');
  if (!list.length) {
    target.innerHTML = '<span class="muted">Nenhuma origem identificada no período.</span>';
    return;
  }

  const max = Math.max(1, ...list.map((item) => item.sessions || 0));
  target.innerHTML = list.slice(0, 10).map((item, index) => `
    <div class="source-item">
      <span class="source-rank">${index + 1}</span>
      <div class="source-main">
        <div class="source-heading"><span title="${escapeHtml(item.name)}">${escapeHtml(item.label || item.name)}</span><strong>${fmt.format(item.sessions || 0)}</strong></div>
        <div class="source-bar"><i style="width:${Math.max(3, ((item.sessions || 0) / max) * 100)}%"></i></div>
        <small>${fmt.format(item.activeUsers || 0)} usuários</small>
      </div>
    </div>`).join('');
}

function renderEvents(list, note) {
  const target = $('eventList');
  const noteElement = $('eventInstrumentationNote');

  if (!list.length) {
    target.innerHTML = '<span class="muted">Nenhum evento adicional registrado neste período.</span>';
  } else {
    const max = Math.max(1, ...list.map((item) => item.count || 0));
    target.innerHTML = list.slice(0, 9).map((item) => `
      <div class="event-item">
        <div class="event-icon">${item.derived ? '▤' : '⌁'}</div>
        <div class="event-main">
          <div class="event-heading"><span>${escapeHtml(item.label || item.name)}</span><strong>${fmt.format(item.count || 0)}</strong></div>
          <div class="event-bar"><i style="width:${Math.max(3, ((item.count || 0) / max) * 100)}%"></i></div>
          <small>${item.derived
            ? 'calculado a partir das visualizações de manuais'
            : item.activeUsers == null
              ? 'ocorrências nos últimos 30 min'
              : `${fmt.format(item.activeUsers || 0)} usuários`}</small>
        </div>
      </div>`).join('');
  }

  noteElement.hidden = !note;
  noteElement.textContent = note || '';
}

function renderDevices(list, audienceTotal = null) {
  const colors = ['#2788f5', '#113f6d', '#8aa4be', '#17a66a'];
  const distributionTotal = list.reduce((sum, item) => sum + (item.activeUsers || 0), 0) || 1;
  const headlineTotal = Number.isFinite(Number(audienceTotal)) && Number(audienceTotal) > 0
    ? Number(audienceTotal)
    : distributionTotal;

  // O número central representa a audiência da mesma fonte dos cards principais.
  // As fatias são normalizadas pela distribuição por dispositivo para sempre somarem 100%.
  animateNumber($('deviceTotal'), headlineTotal);

  let cursor = 0;
  const segments = list.map((item, index) => {
    const share = (item.activeUsers || 0) / distributionTotal * 100;
    const start = cursor;
    cursor += share;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  });
  $('deviceDonut').style.background = list.length
    ? `conic-gradient(${segments.join(',')})`
    : 'conic-gradient(#dce6f0 0 100%)';

  const label = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet', other: 'Outro', unclassified: 'Ainda não classificado' };
  $('deviceList').innerHTML = list.length
    ? list.map((item, index) => `
        <div class="device-item">
          <i style="background:${colors[index % colors.length]}"></i>
          <span>${escapeHtml(label[item.name] || item.name)}</span>
          <strong>${pct.format((item.activeUsers || 0) / distributionTotal)}</strong>
        </div>`).join('')
    : '<span class="muted">Nenhum dispositivo identificado no período.</span>';
}

function renderCities(list) {
  $('cityList').innerHTML = list.slice(0, 7).map((item) => `
    <div class="city-item">
      <span class="city-name">${escapeHtml(item.name || 'Não informado')}</span>
      <strong class="city-value">${fmt.format(item.activeUsers || 0)}</strong>
    </div>`).join('');
}

function trendLabel(row, granularity) {
  if (granularity === 'hour') return row.label || `${String(row.hour || '00').padStart(2, '0')}:00`;
  return formatDate(row.date || row.label);
}

function renderTrend(list, granularity = 'day', currentHourLive = false) {
  const svg = $('trendChart');
  const tooltip = $('chartTooltip');

  if (!list.length) {
    svg.innerHTML = '<text class="chart-empty" x="380" y="145" text-anchor="middle">Ainda não há dados suficientes para este período.</text>';
    if (tooltip) tooltip.classList.remove('show');
    return;
  }

  const isHourly = granularity === 'hour';
  const mode = state.trendMode || 'both';

  $('trendTitle').textContent = isHourly
    ? (currentHourLive ? 'Movimento de acessos ao longo do dia' : 'Horas já processadas de hoje')
    : 'Evolução dos acessos no período';
  $('trendSubtitle').textContent = isHourly
    ? (currentHourLive
        ? 'Movimento de hoje por hora, atualizado pelo contador próprio.'
        : 'Horas já processadas pelo GA4. A atividade atual aparece no painel Tempo real.')
    : 'Compare visualizações e usuários ao longo do período selecionado.';

  const peakIndex = list.reduce((best, row, index) => (row.views || 0) > (list[best]?.views || -1) ? index : best, 0);
  const peak = list[peakIndex];
  const average = list.reduce((sum, row) => sum + (row.views || 0), 0) / Math.max(1, list.length);

  $('trendPeak').textContent = trendLabel(peak, granularity);
  $('trendPeakDetail').textContent = `${fmt.format(peak.views || 0)} visualizações · ${fmt.format(peak.activeUsers || 0)} usuários`;
  $('trendAverage').textContent = fmt.format(Math.round(average));
  $('trendAverageDetail').textContent = isHourly ? 'visualizações por hora' : 'visualizações por dia';

  let busyStart = 0;
  let busyEnd = 0;
  const windowSize = Math.min(3, list.length);
  let bestWindow = -1;

  for (let index = 0; index <= list.length - windowSize; index++) {
    const total = list.slice(index, index + windowSize).reduce((sum, row) => sum + (row.views || 0), 0);
    if (total > bestWindow) {
      bestWindow = total;
      busyStart = index;
      busyEnd = index + windowSize - 1;
    }
  }

  const busyStartLabel = trendLabel(list[busyStart], granularity);
  const busyEndLabel = trendLabel(list[busyEnd], granularity);
  $('trendInterval').textContent = busyStart === busyEnd ? busyStartLabel : `${busyStartLabel} — ${busyEndLabel}`;
  $('trendIntervalDetail').textContent = isHourly
    ? 'Maior concentração de acessos do dia'
    : 'Trecho com maior volume de visualizações';

  const currentDayIndex = !isHourly && String(list.at(-1)?.date || '') === localDateKey()
    ? list.length - 1
    : -1;
  const partialIndex = isHourly
    ? (currentHourLive ? list.length - 1 : -1)
    : currentDayIndex;
  const partialLabel = partialIndex >= 0 ? trendLabel(list[partialIndex], granularity) : null;
  const processedUntil = isHourly && !currentHourLive ? trendLabel(list.at(-1), granularity) : null;
  const firstDate = !isHourly ? trendLabel(list[0], granularity) : null;

  $('trendExplanation').innerHTML = isHourly
    ? currentHourLive
      ? `<strong>Como ler:</strong> as barras representam visualizações e a linha azul representa usuários únicos por hora. ${partialLabel ? `<span class="partial-note">${escapeHtml(partialLabel)} está em andamento e ainda pode aumentar.</span>` : ''}`
      : `<strong>Dados processados:</strong> este gráfico mostra somente as horas já consolidadas pelo GA4${processedUntil ? `, até aproximadamente ${escapeHtml(processedUntil)}` : ''}. Para o movimento atual, use o painel Tempo real.`
    : `<strong>Como ler:</strong> as barras representam visualizações e a linha azul representa usuários. ${firstDate ? `A nova propriedade possui histórico a partir de ${escapeHtml(firstDate)}.` : ''} ${partialLabel ? `<span class="partial-note">${escapeHtml(partialLabel)} é o dia atual e ainda está parcial.</span>` : ''}`;

  const width = 760;
  const height = 300;
  const pad = { left: 56, right: 58, top: 58, bottom: 38 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const step = plotWidth / Math.max(1, list.length);
  const x = (i) => pad.left + step * i + step / 2;

  const maxViewsRaw = Math.max(1, ...list.map((item) => Number(item.views || 0)));
  const maxUsersRaw = Math.max(1, ...list.map((item) => Number(item.activeUsers || 0)));
  const maxViews = maxViewsRaw * 1.12;
  const maxUsers = maxUsersRaw * 1.18;
  const yViews = (value) => height - pad.bottom - (Number(value || 0) / maxViews) * plotHeight;
  const yUsers = (value) => height - pad.bottom - (Number(value || 0) / maxUsers) * plotHeight;

  const showBars = mode === 'both' || mode === 'views';
  const showUsers = mode === 'both' || mode === 'users';

  const horizontalGrid = [0, .25, .5, .75, 1].map((ratio) => {
    const py = pad.top + ratio * plotHeight;
    const viewValue = Math.round(maxViews * (1 - ratio));
    const userValue = Math.round(maxUsers * (1 - ratio));
    return `
      <line class="trend-grid-line" x1="${pad.left}" y1="${py}" x2="${width - pad.right}" y2="${py}"/>
      ${showBars ? `<text class="trend-axis-label left" x="${pad.left - 10}" y="${py + 3}" text-anchor="end">${compact(viewValue)}</text>` : ''}
      ${showUsers ? `<text class="trend-axis-label right" x="${width - pad.right + 10}" y="${py + 3}" text-anchor="start">${compact(userValue)}</text>` : ''}
    `;
  }).join('');

  const labelEvery = list.length <= 16 ? 1 : list.length <= 24 ? 2 : list.length <= 32 ? 4 : 5;
  const labels = list.map((item, index) => {
    if (index % labelEvery !== 0 && index !== list.length - 1) return '';
    const partial = index === partialIndex;
    return `<text class="trend-x-label ${partial ? 'partial' : ''}" x="${x(index)}" y="${height - 12}" text-anchor="middle">${escapeHtml(trendLabel(item, granularity))}${partial ? (isHourly ? ' · agora' : ' · parcial') : ''}</text>`;
  }).join('');

  const verticalGrid = list.map((item, index) => {
    if (index % labelEvery !== 0 && index !== list.length - 1) return '';
    return `<line class="trend-grid-vertical" x1="${x(index)}" y1="${pad.top}" x2="${x(index)}" y2="${height - pad.bottom}"/>`;
  }).join('');

  const barWidth = Math.min(32, Math.max(10, step * .56));
  const bars = list.map((item, index) => {
    const barY = yViews(item.views || 0);
    const barHeight = Math.max(2, height - pad.bottom - barY);
    const partial = index === partialIndex;
    const peakBar = index === peakIndex;
    const fill = partial
      ? 'url(#trendPartialPattern)'
      : peakBar
        ? 'url(#trendPeakBarGradient)'
        : 'url(#trendBarGradient)';
    return `<rect class="trend-view-bar ${peakBar ? 'peak' : ''} ${partial ? 'partial' : ''}" x="${x(index) - barWidth / 2}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${Math.min(6, barWidth / 3)}" fill="${fill}"/>`;
  }).join('');

  const completeUserEnd = partialIndex > 0 ? partialIndex - 1 : list.length - 1;
  const solidUserPoints = list.slice(0, completeUserEnd + 1)
    .map((item, index) => `${x(index)},${yUsers(item.activeUsers || 0)}`).join(' ');
  const fullUserPoints = list.map((item, index) => `${x(index)},${yUsers(item.activeUsers || 0)}`).join(' ');
  const areaPoints = `${x(0)},${height - pad.bottom} ${fullUserPoints} ${x(list.length - 1)},${height - pad.bottom}`;

  const partialSegment = partialIndex > 0
    ? `<line class="trend-users-partial-segment" x1="${x(partialIndex - 1)}" y1="${yUsers(list[partialIndex - 1]?.activeUsers || 0)}" x2="${x(partialIndex)}" y2="${yUsers(list[partialIndex]?.activeUsers || 0)}"/>`
    : '';

  const userDots = list.map((item, index) => {
    const partial = index === partialIndex;
    const peakPoint = index === peakIndex;
    return `<circle class="trend-user-point ${partial ? 'partial' : ''} ${peakPoint ? 'peak' : ''}" cx="${x(index)}" cy="${yUsers(item.activeUsers || 0)}" r="${peakPoint ? 4.8 : 3.4}"/>`;
  }).join('');

  const peakX = x(peakIndex);
  const peakTopY = Math.min(yViews(peak.views || 0), yUsers(peak.activeUsers || 0));
  const calloutWidth = 118;
  const calloutHeight = 47;
  const calloutX = Math.max(pad.left + calloutWidth / 2, Math.min(width - pad.right - calloutWidth / 2, peakX));
  const calloutY = Math.max(8, peakTopY - 57);

  const hitWidth = Math.max(18, step);
  const hits = list.map((item, index) => `
    <rect class="trend-hit" data-index="${index}" x="${x(index) - hitWidth / 2}" y="${pad.top}" width="${hitWidth}" height="${plotHeight}" rx="4"/>
  `).join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="trendBarGradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#7bbcff" stop-opacity=".72"/>
        <stop offset="100%" stop-color="#cfe5fb" stop-opacity=".48"/>
      </linearGradient>
      <linearGradient id="trendPeakBarGradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#5aa8f5" stop-opacity=".82"/>
        <stop offset="100%" stop-color="#9bcaf4" stop-opacity=".62"/>
      </linearGradient>
      <linearGradient id="trendUsersAreaGradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#2788fb" stop-opacity=".16"/>
        <stop offset="100%" stop-color="#2788fb" stop-opacity="0"/>
      </linearGradient>
      <pattern id="trendPartialPattern" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="rgba(169,207,245,.26)"/>
        <rect width="2" height="6" fill="rgba(39,136,251,.28)"/>
      </pattern>
    </defs>

    <rect class="trend-plot-bg" x="${pad.left}" y="${pad.top}" width="${plotWidth}" height="${plotHeight}" rx="10"/>

    <g class="trend-grid">${horizontalGrid}${verticalGrid}</g>

    ${showBars ? `<g class="trend-bars">${bars}</g>` : ''}

    ${showUsers ? `
      <polygon class="trend-users-area" points="${areaPoints}"/>
      <polyline class="trend-users-line" points="${solidUserPoints}"/>
      ${partialSegment}
      ${userDots}
    ` : ''}

    <text class="trend-axis-title left" x="${pad.left}" y="${pad.top - 17}">Visualizações</text>
    <text class="trend-axis-title right" x="${width - pad.right}" y="${pad.top - 17}" text-anchor="end">Usuários ativos</text>

    <g class="trend-inline-legend" transform="translate(${pad.left}, 20)">
      <rect class="trend-legend-bar" x="0" y="0" width="13" height="9" rx="2"/>
      <text x="19" y="8">Visualizações (barras)</text>
      <line class="trend-legend-line" x1="132" y1="5" x2="151" y2="5"/>
      <circle class="trend-legend-dot" cx="141.5" cy="5" r="3"/>
      <text x="158" y="8">Usuários ativos (linha)</text>
    </g>

    <line class="trend-peak-marker" x1="${peakX}" y1="${pad.top}" x2="${peakX}" y2="${height - pad.bottom}"/>

    <g class="trend-peak-callout" transform="translate(${calloutX - calloutWidth / 2}, ${calloutY})">
      <rect class="trend-callout-box" width="${calloutWidth}" height="${calloutHeight}" rx="10"/>
      <rect class="trend-callout-head" width="${calloutWidth}" height="20" rx="10"/>
      <rect class="trend-callout-head-mask" y="10" width="${calloutWidth}" height="10"/>
      <text class="trend-callout-title" x="${calloutWidth / 2}" y="14" text-anchor="middle">Pico · ${escapeHtml(trendLabel(peak, granularity))}</text>
      <text class="trend-callout-detail" x="${calloutWidth / 2}" y="31" text-anchor="middle">${fmt.format(peak.views || 0)} visualizações</text>
      <text class="trend-callout-detail" x="${calloutWidth / 2}" y="42" text-anchor="middle">${fmt.format(peak.activeUsers || 0)} usuários</text>
    </g>

    ${partialIndex >= 0 ? `<line class="trend-now-marker" x1="${x(partialIndex)}" y1="${pad.top}" x2="${x(partialIndex)}" y2="${height - pad.bottom}"/>` : ''}

    ${labels}
    ${hits}
  `;

  svg.querySelectorAll('.trend-hit').forEach((hit) => {
    hit.addEventListener('mouseenter', (event) => {
      const index = Number(hit.dataset.index);
      const row = list[index];
      if (!row || !tooltip) return;
      const partial = index === partialIndex;
      tooltip.innerHTML = `
        <span class="tooltip-period">${escapeHtml(trendLabel(row, granularity))}${partial ? ' · em andamento' : ''}</span>
        <div><i class="tooltip-dot users"></i><span>Usuários ativos</span><strong>${fmt.format(row.activeUsers || 0)}</strong></div>
        <div><i class="tooltip-dot views"></i><span>Visualizações</span><strong>${fmt.format(row.views || 0)}</strong></div>
        <div><i class="tooltip-dot sessions"></i><span>Sessões</span><strong>${fmt.format(row.sessions || 0)}</strong></div>`;
      tooltip.classList.add('show');
      positionChartTooltip(event);
    });
    hit.addEventListener('mousemove', positionChartTooltip);
    hit.addEventListener('mouseleave', () => tooltip?.classList.remove('show'));
  });
}

function positionChartTooltip(event) {
  const tooltip = $('chartTooltip');
  const wrap = event.currentTarget.closest('.chart-wrap');
  if (!tooltip || !wrap) return;
  const rect = wrap.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const tooltipWidth = 190;
  tooltip.style.left = `${Math.min(Math.max(10, x + 14), rect.width - tooltipWidth - 8)}px`;
  tooltip.style.top = `${Math.max(8, y - 88)}px`;
}

function bindPageDetailButtons() {
  document.querySelectorAll('.page-detail-btn').forEach((button) => {
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
      openPageDetail({
        path: button.dataset.pagePath || '/',
        host: button.dataset.pageHost || 'wiki.setic.ro.gov.br',
        label: button.dataset.pageLabel || shortLabel(button.dataset.pagePath || '/')
      });
    });
  });
}

function openPageDetail(page) {
  state.pageDetail = page;
  state.pageDetailRange = '7d';

  $('pageDetailTitle').textContent = page.label;
  $('pageDetailLink').href = `https://${page.host}${page.path}`;
  $('pageDetailPeriodLabel').textContent = 'últimos 7 dias';
  $('detailUsersPeriod').textContent = 'nos últimos 7 dias';

  document.querySelectorAll('.page-detail-range').forEach((button) => {
    button.classList.toggle('active', button.dataset.pageRange === '7d');
  });

  $('pageDetailBackdrop').hidden = false;
  document.body.classList.add('detail-open');
  requestAnimationFrame(() => $('pageDetailBackdrop').classList.add('open'));
  loadPageDetail();
}

function closePageDetail() {
  $('pageDetailBackdrop').classList.remove('open');
  document.body.classList.remove('detail-open');
  setTimeout(() => {
    $('pageDetailBackdrop').hidden = true;
  }, 220);
}

async function loadPageDetail() {
  if (!state.pageDetail) return;
  const loading = $('pageDetailLoading');
  loading.hidden = false;

  try {
    const params = new URLSearchParams({
      path: state.pageDetail.path,
      host: state.pageDetail.host,
      range: state.pageDetailRange
    });
    const data = await getJson(`/api/page-detail?${params.toString()}`);
    renderPageDetail(data);
  } catch (error) {
    showToast(error.message);
  } finally {
    loading.hidden = true;
  }
}

function renderPageDetail(data) {
  const summary = data.summary || {};
  const is30 = data.range === '30d';

  $('detailTodayViews').textContent = fmt.format(summary.todayViews || 0);
  $('detailUsers').textContent = fmt.format(summary.activeUsers || 0);
  $('detailViewsPerUser').textContent = Number(summary.viewsPerUser || 0).toFixed(1).replace('.', ',');
  $('detailTime').textContent = formatSeconds(summary.avgEngagementSeconds || 0);
  $('detailEngagement').textContent = pct.format(summary.engagementRate || 0);
  $('detailUsersPeriod').textContent = is30 ? 'nos últimos 30 dias' : 'nos últimos 7 dias';
  $('pageDetailPeriodLabel').textContent = is30 ? 'últimos 30 dias' : 'últimos 7 dias';

  if (data.page?.url) $('pageDetailLink').href = data.page.url;

  renderPageDetailPeaks(data.peakHours || (data.peakHour ? [data.peakHour] : []));
  renderPageDetailSources(data.sources || []);
  renderPageDetailDevices(data.devices || []);
  renderPageDetailChart(data.trend || []);
}

function renderPageDetailPeaks(list) {
  const target = $('pageDetailPeaks');
  if (!list.length) {
    target.innerHTML = '<span class="muted">Ainda não há dados suficientes para identificar horários de pico.</span>';
    return;
  }

  target.innerHTML = list.slice(0, 3).map((item, index) => `
    <div class="page-detail-peak-card ${index === 0 ? 'primary' : ''}">
      <span>${index === 0 ? 'Pico principal' : `${index + 1}º maior pico`}</span>
      <strong>${escapeHtml(item.label || `${String(item.hour || 0).padStart(2, '0')}:00`)}</strong>
      <small>${fmt.format(item.views || 0)} visualizações · ${fmt.format(item.activeUsers || 0)} usuários</small>
    </div>`).join('');
}

function renderPageDetailSources(list) {
  const target = $('pageDetailSources');
  if (!list.length) {
    target.innerHTML = '<span class="muted">Nenhuma origem identificada para esta página.</span>';
    return;
  }

  const max = Math.max(1, ...list.map((item) => item.sessions || 0));
  target.innerHTML = list.slice(0, 6).map((item) => `
    <div class="page-detail-source-item">
      <div class="page-detail-list-heading">
        <span title="${escapeHtml(item.name || item.label)}">${escapeHtml(item.label || item.name)}</span>
        <strong>${fmt.format(item.sessions || 0)}</strong>
      </div>
      <div class="page-detail-mini-bar"><i style="width:${Math.max(4, ((item.sessions || 0) / max) * 100)}%"></i></div>
      <small>${fmt.format(item.activeUsers || 0)} usuários</small>
    </div>`).join('');
}

function renderPageDetailDevices(list) {
  const target = $('pageDetailDevices');
  if (!list.length) {
    target.innerHTML = '<span class="muted">Nenhum dispositivo identificado para esta página.</span>';
    return;
  }

  const total = list.reduce((sum, item) => sum + (item.activeUsers || 0), 0) || 1;
  target.innerHTML = list.map((item) => {
    const share = (item.activeUsers || 0) / total * 100;
    return `
      <div class="page-detail-device-item">
        <div class="page-detail-list-heading">
          <span>${escapeHtml(item.label || item.name)}</span>
          <strong>${share.toFixed(0)}%</strong>
        </div>
        <div class="page-detail-mini-bar device"><i style="width:${Math.max(4, share)}%"></i></div>
        <small>${fmt.format(item.activeUsers || 0)} usuários · ${fmt.format(item.sessions || 0)} sessões</small>
      </div>`;
  }).join('');
}

function renderPageDetailChart(list) {
  const svg = $('pageDetailChart');
  if (!list.length) {
    svg.innerHTML = '<text x="360" y="120" text-anchor="middle" class="chart-empty">Sem dados suficientes para este período.</text>';
    return;
  }

  const width = 720;
  const height = 230;
  const pad = { left: 42, right: 16, top: 18, bottom: 34 };
  const max = Math.max(1, ...list.map((item) => item.views || 0)) * 1.1;
  const x = (index) => pad.left + index * (width - pad.left - pad.right) / Math.max(1, list.length - 1);
  const y = (value) => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);
  const points = list.map((item, index) => `${x(index)},${y(item.views || 0)}`).join(' ');
  const area = `${pad.left},${height - pad.bottom} ${points} ${x(list.length - 1)},${height - pad.bottom}`;
  const every = list.length > 15 ? 4 : list.length > 8 ? 2 : 1;

  const labels = list.map((item, index) => index % every === 0 || index === list.length - 1
    ? `<text class="chart-label" x="${x(index)}" y="${height - 10}" text-anchor="middle">${formatDate(item.date)}</text>`
    : ''
  ).join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="pageDetailArea" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#2788fb" stop-opacity=".24"/>
        <stop offset="100%" stop-color="#2788fb" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <line class="chart-grid" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"/>
    <polygon class="page-detail-area" points="${area}"/>
    <polyline class="page-detail-line" points="${points}"/>
    ${list.map((item, index) => `<circle class="page-detail-point" cx="${x(index)}" cy="${y(item.views || 0)}" r="3"><title>${formatDate(item.date)} · ${fmt.format(item.views || 0)} visualizações</title></circle>`).join('')}
    ${labels}`;
}

function initEmbedMode() {
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get('embed') === '1';

  if (!embedded) return;

  document.body.classList.add('embed-mode');
  document.documentElement.classList.add('embed-mode-root');
}

function premiumPulse(selector) {
  const element = document.querySelector(selector);
  if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  element.classList.remove('premium-flash');
  void element.offsetWidth;
  element.classList.add('premium-flash');
}

function initPremiumVisuals() {
  document.body.classList.add('premium-dashboard');

  const revealItems = [...document.querySelectorAll('.metric-card, .panel, .smart-summary')];
  revealItems.forEach((item, index) => {
    item.classList.add('premium-reveal');
    item.style.setProperty('--reveal-delay', `${Math.min(index * 45, 500)}ms`);
  });

  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('premium-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08 });

    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('premium-visible'));
  }

  document.querySelectorAll('.metric-card, .panel, .smart-summary').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--pointer-x', `${event.clientX - rect.left}px`);
      card.style.setProperty('--pointer-y', `${event.clientY - rect.top}px`);
    });
  });
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3400);
}

function bindControls() {
  document.querySelectorAll('.trend-mode-btn').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.trend-mode-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.trendMode = button.dataset.trendMode || 'both';
      if (state.range === 'today' && state.counter?.enabled) {
        renderTrend(state.counter.trend || [], 'hour', true);
      } else if (state.report) {
        renderTrend(state.report.trend || state.report.daily || [], state.report.trendGranularity || 'day', false);
      }
    });
  });

  document.querySelectorAll('.range-btn').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.range = button.dataset.range;
      loadReport();
    });
  });

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      const section = button.dataset.section;
      const target = section === 'realtime' ? document.querySelector('.realtime-panel')
        : section === 'pages' ? document.querySelector('.pages-panel')
        : section === 'audience' ? document.querySelector('.audience-panel')
        : document.querySelector('.metric-grid');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  $('pageDetailClose')?.addEventListener('click', closePageDetail);
  $('pageDetailBackdrop')?.addEventListener('click', (event) => {
    if (event.target === $('pageDetailBackdrop')) closePageDetail();
  });

  document.querySelectorAll('.page-detail-range').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.page-detail-range').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.pageDetailRange = button.dataset.pageRange === '30d' ? '30d' : '7d';
      loadPageDetail();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('pageDetailBackdrop')?.hidden) closePageDetail();
  });
}

async function boot() {
  initEmbedMode();
  bindControls();
  initPremiumVisuals();
  await Promise.all([loadReport(), loadRealtime(), loadCounter()]);
  document.body.classList.add('premium-data-ready');
  state.timer = setInterval(loadRealtime, 60_000);
  state.reportTimer = setInterval(loadReport, 120_000);
  state.counterTimer = setInterval(loadCounter, 60_000);
}

boot();
