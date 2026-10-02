const state = {
  range: 'today',
  report: null,
  realtime: null,
  timer: null,
  lastRealtimeUsers: null,
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
  if (!raw || raw.length !== 8) return raw;
  const year = Number(raw.slice(0,4));
  const month = Number(raw.slice(4,6)) - 1;
  const day = Number(raw.slice(6,8));
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit' }).format(new Date(year, month, day));
}

function animateNumber(el, next, formatter = (n) => fmt.format(Math.round(n))) {
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
  $('lastUpdate').textContent = `atualizado às ${date.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`;
}

async function getJson(url) {
  if (location.protocol === 'file:' && window.DEMO_DATA) {
    if (url.startsWith('/api/realtime')) return structuredClone(window.DEMO_DATA.realtime);
    const range = new URLSearchParams(url.split('?')[1] || '').get('range') || 'today';
    return structuredClone(window.DEMO_DATA.reports[range] || window.DEMO_DATA.reports.today);
  }
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || 'Falha ao carregar dados.');
    return data;
  } catch (error) {
    if (window.DEMO_DATA) {
      if (url.startsWith('/api/realtime')) return structuredClone(window.DEMO_DATA.realtime);
      const range = new URLSearchParams(url.split('?')[1] || '').get('range') || 'today';
      return structuredClone(window.DEMO_DATA.reports[range] || window.DEMO_DATA.reports.today);
    }
    throw error;
  }
}

async function loadReport() {
  $('syncLabel').textContent = 'Sincronizando';
  try {
    const report = await getJson(`/api/report?range=${encodeURIComponent(state.range)}`);
    state.report = report;
    renderReport(report);
    setMode(report.mode);
    updateTimestamp(report.generatedAt);
    $('syncLabel').textContent = 'Sincronizado';
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
    $('syncLabel').textContent = 'Sincronizado';

    if (previous !== null && realtime.summary.activeUsers > previous) {
      showToast(`Novo acesso detectado · ${fmt.format(realtime.summary.activeUsers)} usuários ativos`);
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
  animateNumber($('metricTime'), summary.avgEngagementSeconds || 0, (n) => `${n.toFixed(1).replace('.', ',')}s`);

  $('metricUsersCaption').textContent = state.range === 'today' ? 'Usuários ativos hoje' : `Usuários no período selecionado`;
  renderTrend(data.daily || []);
  renderPages(data.pages || []);
  renderDevices(data.devices || []);
  renderCities(data.cities || []);
}

function renderRealtime(data) {
  animateNumber($('realtimeUsers'), data.summary?.activeUsers || 0);
  animateNumber($('realtimeViews'), data.summary?.views || 0);
  animateNumber($('realtimeEvents'), data.summary?.events || 0);

  const timeline = data.timeline || [];
  const max = Math.max(1, ...timeline.map((row) => row.activeUsers || 0));
  $('miniBars').innerHTML = timeline.map((row, i) => {
    const height = Math.max(10, ((row.activeUsers || 0) / max) * 100);
    return `<span style="height:${height}%; animation-delay:${i * 35}ms" title="${row.activeUsers || 0} usuários"></span>`;
  }).join('');

  const pages = data.pages || [];
  $('livePageList').innerHTML = pages.length ? pages.slice(0,5).map((item) => `
    <div class="live-page-item">
      <span class="live-page-name" title="${escapeHtml(item.name)}">${escapeHtml(shortLabel(item.name))}</span>
      <strong class="live-page-value">${fmt.format(item.activeUsers || 0)}</strong>
    </div>`).join('') : '<span class="muted">Nenhuma atividade recente.</span>';
}

function pageUrl(item) {
  if (item.url) return item.url;
  const path = String(item.name || '');
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/')) return `https://wiki.setic.ro.gov.br${path}`;
  return 'https://wiki.setic.ro.gov.br';
}

function renderPages(list) {
  const max = Math.max(1, ...list.map((item) => item.views || 0));
  $('pageList').innerHTML = list.map((item, index) => `
    <div class="rank-item">
      <span class="rank-number">${index + 1}</span>
      <div class="rank-main">
        <a
          class="rank-title rank-title-link"
          href="${escapeHtml(pageUrl(item))}"
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir ${escapeHtml(item.name)}"
        >
          <span>${escapeHtml(shortLabel(item.name))}</span>
          <span class="rank-open-icon" aria-hidden="true">↗</span>
        </a>
        <div class="rank-bar"><i style="width:${Math.max(4, (item.views / max) * 100)}%"></i></div>
      </div>
      <strong class="rank-value">${fmt.format(item.views || 0)}</strong>
    </div>`).join('');
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

  const label = { desktop:'Desktop', mobile:'Mobile', tablet:'Tablet' };
  $('deviceList').innerHTML = list.map((item, index) => `
    <div class="device-item">
      <i style="background:${colors[index % colors.length]}"></i>
      <span>${escapeHtml(label[item.name] || item.name)}</span>
      <strong>${pct.format((item.activeUsers || 0) / total)}</strong>
    </div>`).join('');
}

function renderCities(list) {
  $('cityList').innerHTML = list.slice(0,6).map((item) => `
    <div class="city-item">
      <span class="city-name">${escapeHtml(item.name || 'Não informado')}</span>
      <strong class="city-value">${fmt.format(item.activeUsers || 0)}</strong>
    </div>`).join('');
}

function renderTrend(list) {
  const svg = $('trendChart');
  if (!list.length) { svg.innerHTML = ''; return; }

  const width = 760, height = 300, pad = { left:45, right:18, top:20, bottom:34 };
  const values = list.flatMap((d) => [d.activeUsers || 0, d.views || 0]);
  const max = Math.max(1, ...values) * 1.12;
  const x = (i) => pad.left + (i * (width - pad.left - pad.right) / Math.max(1, list.length - 1));
  const y = (v) => height - pad.bottom - (v / max) * (height - pad.top - pad.bottom);

  const pointsUsers = list.map((d,i) => `${x(i)},${y(d.activeUsers || 0)}`).join(' ');
  const pointsViews = list.map((d,i) => `${x(i)},${y(d.views || 0)}`).join(' ');
  const area = `${pad.left},${height-pad.bottom} ${pointsUsers} ${x(list.length-1)},${height-pad.bottom}`;

  const gridLines = [0,.25,.5,.75,1].map((r) => {
    const py = pad.top + r * (height-pad.top-pad.bottom);
    const val = Math.round(max * (1-r));
    return `<line class="chart-grid" x1="${pad.left}" y1="${py}" x2="${width-pad.right}" y2="${py}"/><text class="chart-label" x="${pad.left-9}" y="${py+3}" text-anchor="end">${compact(val)}</text>`;
  }).join('');

  const labels = list.map((d,i) => `<text class="chart-label" x="${x(i)}" y="${height-10}" text-anchor="middle">${formatDate(d.date)}</text>`).join('');
  const dots = list.map((d,i) => `<circle class="chart-point" cx="${x(i)}" cy="${y(d.activeUsers || 0)}" r="3.2"><title>${fmt.format(d.activeUsers || 0)} usuários</title></circle>`).join('');

  svg.innerHTML = `
    <defs><linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#3f9cff" stop-opacity=".18"/><stop offset="100%" stop-color="#3f9cff" stop-opacity="0"/></linearGradient></defs>
    ${gridLines}
    <polygon class="chart-area" points="${area}"/>
    <polyline class="chart-line-views" points="${pointsViews}"/>
    <polyline class="chart-line-users" points="${pointsUsers}"/>
    ${dots}
    ${labels}`;
}

function compact(value) {
  if (value >= 1000) return `${(value/1000).toFixed(value >= 10000 ? 0 : 1).replace('.', ',')}k`;
  return fmt.format(value);
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
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
      target?.scrollIntoView({ behavior:'smooth', block:'center' });
    });
  });
}

async function boot() {
  bindControls();
  await Promise.all([loadReport(), loadRealtime()]);
  state.timer = setInterval(loadRealtime, 15000);
}

boot();
