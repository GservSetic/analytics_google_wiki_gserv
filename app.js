const state = {
  range: 'today',
  report: null,
  realtime: null,
  timer: null,
  lastRealtimeUsers: null,
  pageDetail: null,
  pageDetailRange: '7d',
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
    $('syncLabel').textContent = report.stale ? 'Dados em cache' : 'Sincronizado';
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
    $('syncLabel').textContent = realtime.stale ? 'Tempo real em cache' : 'Sincronizado';

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

function renderReport(data) {
  const summary = data.summary || {};
  animateNumber($('metricUsers'), summary.activeUsers);
  animateNumber($('metricSessions'), summary.sessions);
  animateNumber($('metricViews'), summary.views);
  animateNumber($('metricEngagement'), (summary.engagementRate || 0) * 100, (n) => `${n.toFixed(1).replace('.', ',')}%`);
  animateNumber($('metricTime'), summary.avgEngagementSeconds || 0, (n) => formatSeconds(n));

  $('metricUsersCaption').textContent = state.range === 'today' ? 'Usuários ativos hoje' : 'Usuários no período selecionado';

  renderSmartSummary(data);
  renderTrend(data.trend || data.daily || [], data.trendGranularity || 'day');
  renderHeatmap(data.heatmap);
  renderSources(data.sources || []);
  renderEvents(data.events || [], data.eventInstrumentationNote);
  renderPages(data.pages || []);
  renderEngagement(data.pages || []);
  renderDevices(data.devices || []);
  renderCities(data.cities || []);
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
  animateNumber($('realtimeViews'), data.summary?.views || 0);
  animateNumber($('realtimeEvents'), data.summary?.events || 0);

  renderRealtimeChart(data.timeline || []);

  const peak = data.peak;
  $('realtimePeak').textContent = peak
    ? `Pico recente: ${peak.label} · ${fmt.format(peak.views || 0)} visualizações · ${fmt.format(peak.activeUsers || 0)} usuários`
    : 'Ainda não há atividade suficiente para destacar um pico.';

  const pages = data.pages || [];
  $('livePageList').innerHTML = pages.length ? pages.slice(0, 5).map((item) => {
    const label = escapeHtml(shortLabel(item.name));
    const title = escapeHtml(item.name);
    const link = item.url
      ? `<a class="live-page-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="Abrir ${title}"><span>${label}</span><span class="live-page-open" aria-hidden="true">↗</span></a>`
      : `<span class="live-page-name" title="${title}">${label}</span>`;

    return `
      <div class="live-page-item">
        <div class="live-page-main">
          <span class="live-status-dot" aria-hidden="true"></span>
          ${link}
        </div>
        <strong class="live-page-value">${fmt.format(item.activeUsers || 0)}</strong>
      </div>`;
  }).join('') : '<span class="muted">Nenhuma atividade recente.</span>';
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
        <a
          class="rank-title rank-title-link"
          href="${escapeHtml(pageUrl(item))}"
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir ${escapeHtml(item.name)}"
        >
          <span>${escapeHtml(item.label || shortLabel(item.name))}</span>
          <span class="rank-open-icon" aria-hidden="true">↗</span>
        </a>
        <div class="rank-bar"><i style="width:${Math.max(4, (item.views / max) * 100)}%"></i></div>
      </div>
      <div class="page-evolution">
        ${sparklineSvg(item.trend)}
        ${trendChip(item)}
      </div>
      <strong class="rank-value">${fmt.format(item.views || 0)}</strong>
      <button
        type="button"
        class="page-detail-btn"
        data-page-path="${escapeHtml(item.name)}"
        data-page-host="${escapeHtml(item.hostName || 'wiki.setic.ro.gov.br')}"
        data-page-label="${escapeHtml(item.label || shortLabel(item.name))}"
        title="Analisar esta página"
      >Detalhes</button>
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
  $('heatmapInsight').innerHTML = hottest.views >= 0
    ? `<strong>Maior concentração:</strong> ${hottest.day}, por volta de ${String(hottest.hour).padStart(2, '0')}h, com média de ${fmt.format(hottest.views)} visualizações.`
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
          <small>${item.derived ? 'calculado a partir das visualizações de manuais' : `${fmt.format(item.activeUsers || 0)} usuários`}</small>
        </div>
      </div>`).join('');
  }

  noteElement.hidden = !note;
  noteElement.textContent = note || '';
}

function renderDevices(list) {
  const colors = ['#2788f5', '#113f6d', '#8aa4be', '#17a66a'];
  const total = list.reduce((sum, item) => sum + (item.activeUsers || 0), 0) || 1;
  animateNumber($('deviceTotal'), total);

  let cursor = 0;
  const segments = list.map((item, index) => {
    const share = (item.activeUsers || 0) / total * 100;
    const start = cursor;
    cursor += share;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  });
  $('deviceDonut').style.background = `conic-gradient(${segments.join(',')})`;

  const label = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };
  $('deviceList').innerHTML = list.map((item, index) => `
    <div class="device-item">
      <i style="background:${colors[index % colors.length]}"></i>
      <span>${escapeHtml(label[item.name] || item.name)}</span>
      <strong>${pct.format((item.activeUsers || 0) / total)}</strong>
    </div>`).join('');
}

function renderCities(list) {
  $('cityList').innerHTML = list.slice(0, 6).map((item) => `
    <div class="city-item">
      <span class="city-name">${escapeHtml(item.name || 'Não informado')}</span>
      <strong class="city-value">${fmt.format(item.activeUsers || 0)}</strong>
    </div>`).join('');
}

function trendLabel(row, granularity) {
  if (granularity === 'hour') return row.label || `${String(row.hour || '00').padStart(2, '0')}:00`;
  return formatDate(row.date || row.label);
}

function renderTrend(list, granularity = 'day') {
  const svg = $('trendChart');
  const tooltip = $('chartTooltip');

  if (!list.length) {
    svg.innerHTML = '<text class="chart-empty" x="380" y="150" text-anchor="middle">Ainda não há dados suficientes para este período.</text>';
    if (tooltip) tooltip.classList.remove('show');
    return;
  }

  const isHourly = granularity === 'hour';
  $('trendTitle').textContent = isHourly ? 'Movimento de acessos ao longo do dia' : 'Evolução dos acessos no período';
  $('trendSubtitle').textContent = isHourly
    ? 'Identifique rapidamente os horários de maior movimento na Wiki.'
    : 'Compare como o uso da Wiki variou de um dia para o outro.';
  $('trendInterval').textContent = isHourly ? '1 hora' : '1 dia';
  $('trendIntervalDetail').textContent = isHourly ? 'Horário da propriedade no GA4' : 'Cada ponto é um dia do período';

  const peakIndex = list.reduce((best, row, index) => (row.views || 0) > (list[best]?.views || -1) ? index : best, 0);
  const peak = list[peakIndex];
  const average = list.reduce((sum, row) => sum + (row.views || 0), 0) / Math.max(1, list.length);
  $('trendPeak').textContent = trendLabel(peak, granularity);
  $('trendPeakDetail').textContent = `${fmt.format(peak.views || 0)} visualizações · ${fmt.format(peak.activeUsers || 0)} usuários`;
  $('trendAverage').textContent = fmt.format(Math.round(average));
  $('trendAverageDetail').textContent = isHourly ? 'visualizações por hora' : 'visualizações por dia';
  $('trendExplanation').innerHTML = isHourly
    ? '<strong>Como ler:</strong> azul mostra os usuários ativos em cada hora; azul-escuro mostra quantas páginas foram abertas. A faixa destacada marca automaticamente o horário de maior movimento.'
    : '<strong>Como ler:</strong> cada ponto representa um dia. Azul mostra usuários ativos; azul-escuro mostra visualizações. A faixa destacada marca o maior volume do período.';

  const width = 760;
  const height = 300;
  const pad = { left: 48, right: 20, top: 28, bottom: 38 };
  const values = list.flatMap((item) => [item.activeUsers || 0, item.views || 0]);
  const maxRaw = Math.max(1, ...values);
  const max = maxRaw * 1.12;
  const x = (i) => pad.left + i * (width - pad.left - pad.right) / Math.max(1, list.length - 1);
  const y = (value) => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);

  const pointsUsers = list.map((item, index) => `${x(index)},${y(item.activeUsers || 0)}`).join(' ');
  const pointsViews = list.map((item, index) => `${x(index)},${y(item.views || 0)}`).join(' ');
  const area = `${pad.left},${height - pad.bottom} ${pointsUsers} ${x(list.length - 1)},${height - pad.bottom}`;

  const gridLines = [0, .25, .5, .75, 1].map((ratio) => {
    const py = pad.top + ratio * (height - pad.top - pad.bottom);
    const value = Math.round(max * (1 - ratio));
    return `<line class="chart-grid" x1="${pad.left}" y1="${py}" x2="${width - pad.right}" y2="${py}"/><text class="chart-label" x="${pad.left - 10}" y="${py + 3}" text-anchor="end">${compact(value)}</text>`;
  }).join('');

  const every = list.length > 20 ? 4 : list.length > 12 ? 3 : list.length > 8 ? 2 : 1;
  const labels = list.map((item, index) => {
    if (index % every !== 0 && index !== list.length - 1) return '';
    return `<text class="chart-label chart-x-label" x="${x(index)}" y="${height - 11}" text-anchor="middle">${escapeHtml(trendLabel(item, granularity))}</text>`;
  }).join('');

  const userDots = list.map((item, index) => `<circle class="chart-point chart-point-users" cx="${x(index)}" cy="${y(item.activeUsers || 0)}" r="3.2"/>`).join('');
  const viewDots = list.map((item, index) => `<circle class="chart-point chart-point-views" cx="${x(index)}" cy="${y(item.views || 0)}" r="2.8"/>`).join('');
  const hitWidth = Math.max(18, (width - pad.left - pad.right) / Math.max(1, list.length));
  const hits = list.map((item, index) => `
    <rect class="chart-hit" data-index="${index}" x="${x(index) - hitWidth / 2}" y="${pad.top}" width="${hitWidth}" height="${height - pad.top - pad.bottom}" rx="4"/>
  `).join('');

  const peakBandWidth = Math.min(54, Math.max(22, hitWidth * .86));
  const peakBandX = Math.max(pad.left, Math.min(width - pad.right - peakBandWidth, x(peakIndex) - peakBandWidth / 2));
  const peakLabelX = Math.max(75, Math.min(width - 90, x(peakIndex)));

  svg.innerHTML = `
    <defs>
      <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#3f9cff" stop-opacity=".20"/>
        <stop offset="100%" stop-color="#3f9cff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridLines}
    <rect class="chart-peak-band" x="${peakBandX}" y="${pad.top}" width="${peakBandWidth}" height="${height - pad.top - pad.bottom}" rx="8"/>
    <text class="chart-peak-label" x="${peakLabelX}" y="17" text-anchor="middle">Pico · ${escapeHtml(trendLabel(peak, granularity))}</text>
    <polygon class="chart-area" points="${area}"/>
    <polyline class="chart-line-views" points="${pointsViews}"/>
    <polyline class="chart-line-users" points="${pointsUsers}"/>
    ${viewDots}
    ${userDots}
    ${labels}
    ${hits}`;

  svg.querySelectorAll('.chart-hit').forEach((hit) => {
    hit.addEventListener('mouseenter', (event) => {
      const index = Number(hit.dataset.index);
      const row = list[index];
      if (!row || !tooltip) return;
      tooltip.innerHTML = `
        <span class="tooltip-period">${escapeHtml(trendLabel(row, granularity))}</span>
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
  document.querySelectorAll('.page-detail-range').forEach((button) => {
    button.classList.toggle('active', button.dataset.pageRange === '7d');
  });

  $('pageDetailBackdrop').hidden = false;
  document.body.classList.add('detail-open');
  loadPageDetail();
}

function closePageDetail() {
  $('pageDetailBackdrop').hidden = true;
  document.body.classList.remove('detail-open');
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
  $('detailViews').textContent = fmt.format(summary.views || 0);
  $('detailUsers').textContent = fmt.format(summary.activeUsers || 0);
  $('detailTime').textContent = formatSeconds(summary.avgEngagementSeconds || 0);
  $('detailEngagement').textContent = pct.format(summary.engagementRate || 0);
  $('pageDetailPeriodLabel').textContent = data.range === '30d' ? 'últimos 30 dias' : 'últimos 7 dias';

  $('pageDetailPeak').innerHTML = data.peakHour
    ? `<strong>Horário de pico:</strong> ${escapeHtml(data.peakHour.label)} · ${fmt.format(data.peakHour.views || 0)} visualizações · ${fmt.format(data.peakHour.activeUsers || 0)} usuários`
    : 'Ainda não há dados suficientes para identificar um horário de pico.';

  renderPageDetailChart(data.trend || []);
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
  bindControls();
  initPremiumVisuals();
  await Promise.all([loadReport(), loadRealtime()]);
  document.body.classList.add('premium-data-ready');
  state.timer = setInterval(loadRealtime, 60_000);
}

boot();
