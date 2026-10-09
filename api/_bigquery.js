import { googleAccessToken, propertyId } from './_ga.js';

const DEFAULT_PROJECT_ID = 'project-d0079f33-9005-473f-938';
const TIME_ZONE = 'America/Porto_Velho';

function env(name) {
  return process.env[name]?.trim();
}

function projectId() {
  return env('BQ_PROJECT_ID') || DEFAULT_PROJECT_ID;
}

function datasetId() {
  return env('BQ_DATASET_ID') || `analytics_${propertyId()}`;
}

function location() {
  return env('BQ_LOCATION') || '';
}

function exportStartDate() {
  return env('BQ_EXPORT_START_DATE') || '';
}

function assertIdentifier(value, label) {
  if (!/^[A-Za-z0-9_\-:.]+$/.test(value)) {
    throw new Error(`${label} inválido.`);
  }
  return value;
}

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDay(date = new Date()) {
  const p = localParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function localDayCompact(date = new Date()) {
  return localDay(date).replaceAll('-', '');
}

function localHour(date = new Date()) {
  return Number(localParts(date).hour || 0);
}

export function bigQueryConfigured() {
  return Boolean(projectId() && datasetId());
}

async function googleRequest(url, options = {}) {
  const token = await googleAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`BigQuery respondeu ${response.status}: ${detail}`);
  }

  return response.json();
}

function decodeCell(field, value) {
  if (value == null) return null;

  if (field?.type === 'RECORD') {
    const record = value?.f || [];
    const output = {};
    (field.fields || []).forEach((child, index) => {
      output[child.name] = decodeCell(child, record[index]?.v);
    });
    return output;
  }

  if (field?.mode === 'REPEATED') {
    return (value || []).map((item) => decodeCell({ ...field, mode: 'NULLABLE' }, item?.v ?? item));
  }

  if (['INTEGER', 'INT64', 'FLOAT', 'FLOAT64', 'NUMERIC', 'BIGNUMERIC'].includes(field?.type)) {
    const number = Number(value);
    return Number.isNaN(number) ? value : number;
  }

  if (field?.type === 'BOOLEAN' || field?.type === 'BOOL') {
    return value === true || value === 'true';
  }

  return value;
}

function decodeRows(result) {
  const fields = result.schema?.fields || [];
  return (result.rows || []).map((row) => {
    const output = {};
    fields.forEach((field, index) => {
      output[field.name] = decodeCell(field, row.f?.[index]?.v);
    });
    return output;
  });
}

async function runQuery(query) {
  const project = assertIdentifier(projectId(), 'Projeto BigQuery');
  const body = {
    query,
    useLegacySql: false,
    timeoutMs: 15000,
    maxResults: 1000
  };

  if (location()) body.location = location();

  let result = await googleRequest(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}/queries`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  );

  if (!result.jobComplete && result.jobReference?.jobId) {
    const params = new URLSearchParams({ maxResults: '1000', timeoutMs: '15000' });
    if (result.jobReference.location || location()) {
      params.set('location', result.jobReference.location || location());
    }

    result = await googleRequest(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}/queries/${encodeURIComponent(result.jobReference.jobId)}?${params}`,
      { method: 'GET', headers: {} }
    );
  }

  if (!result.jobComplete) {
    throw new Error('A consulta do BigQuery não terminou dentro do tempo esperado.');
  }

  return decodeRows(result);
}

async function todayTableName(day) {
  const project = assertIdentifier(projectId(), 'Projeto BigQuery');
  const dataset = assertIdentifier(datasetId(), 'Dataset BigQuery');
  const compact = day.replaceAll('-', '');
  const intraday = `events_intraday_${compact}`;
  const daily = `events_${compact}`;

  const rows = await runQuery(`
    SELECT table_name
    FROM \`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\`
    WHERE table_name IN ('${intraday}', '${daily}')
    ORDER BY IF(table_name = '${intraday}', 0, 1)
    LIMIT 1
  `);

  return rows[0]?.table_name || null;
}

function sourceLabel(value = '') {
  const raw = String(value || '');
  if (raw === '(direct) / (none)') return 'Acesso direto';
  if (/google\s*\/\s*cpc/i.test(raw)) return 'Google · anúncios';
  if (/google\s*\/\s*organic/i.test(raw)) return 'Google · orgânico';
  if (/bing\s*\/\s*organic/i.test(raw)) return 'Bing · orgânico';
  return raw
    .replace(' / referral', '')
    .replace(' / organic', ' · orgânico')
    .replace(' / cpc', ' · anúncios');
}

function pageLabel(url, title = '') {
  const cleanTitle = String(title || '')
    .replace(/\s*\|\s*Wiki\.?SETIC\s*$/i, '')
    .trim();

  if (cleanTitle) return cleanTitle;

  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/') return 'Página inicial';
    return parsed.pathname
      .replace(/^\/pt-br/i, '')
      .replace(/^\/home\//i, '')
      .split('/')
      .filter(Boolean)
      .slice(-2)
      .map((part) => decodeURIComponent(part).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()))
      .join(' › ');
  } catch {
    return 'Página';
  }
}

function normalizePayload(raw, day, currentHour) {
  const data = raw || {};
  const trendMap = new Map(
    (data.trend || []).map((item) => [Number(item.hour), {
      label: `${String(item.hour).padStart(2, '0')}:00`,
      hour: String(item.hour),
      activeUsers: Number(item.activeUsers || 0),
      sessions: Number(item.sessions || 0),
      views: Number(item.views || 0)
    }])
  );

  const trend = [];
  for (let hour = 0; hour <= currentHour; hour += 1) {
    const row = trendMap.get(hour);
    if (row || hour === currentHour) {
      trend.push(row || {
        label: `${String(hour).padStart(2, '0')}:00`,
        hour: String(hour),
        activeUsers: 0,
        sessions: 0,
        views: 0
      });
    }
  }

  const pages = (data.pages || []).map((item) => {
    let path = '/';
    let hostName = 'wiki.setic.ro.gov.br';
    try {
      const parsed = new URL(item.url);
      path = parsed.pathname || '/';
      hostName = parsed.hostname || hostName;
    } catch {}

    return {
      name: path,
      label: pageLabel(item.url, item.title),
      url: item.url,
      hostName,
      activeUsers: Number(item.activeUsers || 0),
      sessions: Number(item.sessions || 0),
      views: Number(item.views || 0),
      engagementRate: Number(item.engagementRate || 0),
      avgEngagementSeconds: Number(item.avgEngagementSeconds || 0),
      trend: [],
      direction: 'stable',
      deltaPercent: 0,
      trendComparable: false
    };
  });

  const start = exportStartDate();
  const completeDay = Boolean(start && day > start);

  return {
    generatedAt: new Date().toISOString(),
    timeZone: TIME_ZONE,
    today: {
      date: day,
      users: Number(data.users || 0),
      sessions: Number(data.sessions || 0),
      views: Number(data.views || 0),
      engagementRate: Number(data.engagementRate || 0),
      avgEngagementSeconds: Number(data.avgEngagementSeconds || 0)
    },
    trend,
    pages,
    devices: (data.devices || []).map((item) => ({
      name: item.name || 'other',
      activeUsers: Number(item.activeUsers || 0),
      sessions: Number(item.sessions || 0),
      views: Number(item.views || 0)
    })),
    cities: (data.cities || []).map((item) => ({
      name: item.name || 'Não informado',
      activeUsers: Number(item.activeUsers || 0)
    })),
    sources: (data.sources || []).map((item) => ({
      name: item.name || '(direct) / (none)',
      label: sourceLabel(item.name),
      sessions: Number(item.sessions || 0),
      activeUsers: Number(item.activeUsers || 0)
    })),
    coverage: {
      trackingSince: data.firstEventAt || null,
      completeDay,
      breakdownTrackingSince: data.firstEventAt || null,
      breakdownCompleteDay: completeDay
    }
  };
}

export async function readBigQueryToday() {
  if (!bigQueryConfigured()) throw new Error('BigQuery não configurado.');

  const project = assertIdentifier(projectId(), 'Projeto BigQuery');
  const dataset = assertIdentifier(datasetId(), 'Dataset BigQuery');
  const day = localDay();
  const compact = localDayCompact();
  const table = await todayTableName(day);

  if (!table) {
    throw new Error(`A exportação do GA4 ainda não criou a tabela de hoje em ${dataset}.`);
  }

  const fullTable = `${project}.${dataset}.${assertIdentifier(table, 'Tabela BigQuery')}`;

  const rows = await runQuery(`
    CREATE TEMP TABLE today_events AS
    SELECT
      event_timestamp,
      event_name,
      COALESCE(NULLIF(user_id, ''), user_pseudo_id) AS user_key,
      user_pseudo_id,
      IF(
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) IS NULL,
        NULL,
        CONCAT(
          COALESCE(user_pseudo_id, COALESCE(NULLIF(user_id, ''), 'anonymous')),
          '.',
          CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) AS STRING)
        )
      ) AS session_key,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location' LIMIT 1) AS page_location,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_title' LIMIT 1) AS page_title,
      COALESCE(
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec' LIMIT 1),
        0
      ) AS engagement_ms,
      COALESCE(
        CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'session_engaged' LIMIT 1) AS STRING),
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged' LIMIT 1),
        '0'
      ) IN ('1', 'true') AS session_engaged,
      COALESCE(device.category, 'other') AS device_name,
      COALESCE(NULLIF(geo.city, ''), 'Não informado') AS city_name,
      collected_traffic_source.manual_source AS manual_source,
      collected_traffic_source.manual_medium AS manual_medium,
      collected_traffic_source.gclid AS gclid
    FROM \`${fullTable}\`
    WHERE event_date = '${compact}';

    SELECT TO_JSON_STRING(STRUCT(
      (SELECT COUNT(DISTINCT user_key) FROM today_events WHERE user_key IS NOT NULL) AS users,
      (SELECT COUNT(DISTINCT session_key) FROM today_events WHERE session_key IS NOT NULL) AS sessions,
      (SELECT COUNTIF(event_name = 'page_view') FROM today_events) AS views,
      (
        SELECT SAFE_DIVIDE(
          COUNT(DISTINCT IF(session_engaged, session_key, NULL)),
          COUNT(DISTINCT session_key)
        )
        FROM today_events
        WHERE session_key IS NOT NULL
      ) AS engagementRate,
      (
        SELECT SAFE_DIVIDE(
          SUM(engagement_ms) / 1000.0,
          COUNT(DISTINCT session_key)
        )
        FROM today_events
        WHERE session_key IS NOT NULL
      ) AS avgEngagementSeconds,
      (
        SELECT FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', MIN(TIMESTAMP_MICROS(event_timestamp)), 'UTC')
        FROM today_events
      ) AS firstEventAt,

      ARRAY(
        SELECT AS STRUCT
          EXTRACT(HOUR FROM DATETIME(TIMESTAMP_MICROS(event_timestamp), '${TIME_ZONE}')) AS hour,
          COUNT(DISTINCT user_key) AS activeUsers,
          COUNT(DISTINCT session_key) AS sessions,
          COUNTIF(event_name = 'page_view') AS views
        FROM today_events
        GROUP BY hour
        ORDER BY hour
      ) AS trend,

      ARRAY(
        SELECT AS STRUCT
          page_location AS url,
          ANY_VALUE(page_title) AS title,
          COUNT(DISTINCT user_key) AS activeUsers,
          COUNT(DISTINCT session_key) AS sessions,
          COUNTIF(event_name = 'page_view') AS views,
          SAFE_DIVIDE(
            COUNT(DISTINCT IF(session_engaged, session_key, NULL)),
            COUNT(DISTINCT session_key)
          ) AS engagementRate,
          SAFE_DIVIDE(
            SUM(engagement_ms) / 1000.0,
            COUNT(DISTINCT user_key)
          ) AS avgEngagementSeconds
        FROM today_events
        WHERE page_location IS NOT NULL
        GROUP BY page_location
        HAVING views > 0
        ORDER BY views DESC
        LIMIT 15
      ) AS pages,

      ARRAY(
        SELECT AS STRUCT
          device_name AS name,
          COUNT(DISTINCT user_key) AS activeUsers,
          COUNT(DISTINCT session_key) AS sessions,
          COUNTIF(event_name = 'page_view') AS views
        FROM today_events
        GROUP BY device_name
        ORDER BY activeUsers DESC
      ) AS devices,

      ARRAY(
        SELECT AS STRUCT
          city_name AS name,
          COUNT(DISTINCT user_key) AS activeUsers
        FROM today_events
        GROUP BY city_name
        ORDER BY activeUsers DESC
        LIMIT 7
      ) AS cities,

      ARRAY(
        WITH session_source AS (
          SELECT
            session_key,
            ANY_VALUE(user_key) AS user_key,
            ARRAY_AGG(
              CASE
                WHEN gclid IS NOT NULL THEN 'google / cpc'
                WHEN manual_source IS NOT NULL AND manual_source != ''
                  THEN CONCAT(manual_source, ' / ', COALESCE(NULLIF(manual_medium, ''), '(none)'))
                ELSE '(direct) / (none)'
              END
              ORDER BY event_timestamp
              LIMIT 1
            )[SAFE_OFFSET(0)] AS source_name
          FROM today_events
          WHERE session_key IS NOT NULL
          GROUP BY session_key
        )
        SELECT AS STRUCT
          source_name AS name,
          COUNT(*) AS sessions,
          COUNT(DISTINCT user_key) AS activeUsers
        FROM session_source
        GROUP BY source_name
        ORDER BY sessions DESC
        LIMIT 10
      ) AS sources
    )) AS payload
  `);

  const raw = rows[0]?.payload;
  if (!raw) throw new Error('BigQuery não retornou o resumo do dia.');

  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return normalizePayload(payload, day, localHour());
}
