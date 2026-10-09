import { createHash } from 'node:crypto';

const COUNTER_PREFIX = 'wiki:setic:v1';
const COUNTER_TTL_SECONDS = 60 * 60 * 72;
const EVENT_TTL_SECONDS = 60 * 60 * 24;
const TIME_ZONE = 'America/Porto_Velho';
const DEVICE_NAMES = ['desktop', 'mobile', 'tablet', 'other'];
const REDIS_BACKOFF_MS = 15 * 60_000;
let redisBlockedUntil = 0;

function redisConfig() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_API_URL ||
    process.env.REDIS_REST_URL ||
    '';

  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_API_TOKEN ||
    process.env.REDIS_REST_TOKEN ||
    '';

  return {
    url: String(url).replace(/\/$/, ''),
    token: String(token)
  };
}

export function counterConfigured() {
  const { url, token } = redisConfig();
  return Boolean(url && token);
}

async function command(args) {
  const { url, token } = redisConfig();
  if (!url || !token) throw new Error('Redis não configurado.');

  if (Date.now() < redisBlockedUntil) {
    throw new Error('Redis em pausa temporária após atingir o limite de operações.');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });

  if (!response.ok) {
    const detail = await response.text();
    if (/max requests limit exceeded/i.test(detail)) {
      redisBlockedUntil = Date.now() + REDIS_BACKOFF_MS;
    }
    throw new Error(`Redis respondeu ${response.status}: ${detail}`);
  }

  const data = await response.json();
  if (data?.error) {
    if (/max requests limit exceeded/i.test(String(data.error))) {
      redisBlockedUntil = Date.now() + REDIS_BACKOFF_MS;
    }
    throw new Error(data.error);
  }
  return data?.result;
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

function localDateKey(date = new Date()) {
  const value = localParts(date);
  return `${value.year}-${value.month}-${value.day}`;
}

function localHour(date = new Date()) {
  return Number(localParts(date).hour || 0);
}

function dayPrefix(day) {
  return `${COUNTER_PREFIX}:day:${day}`;
}

function todayKeys(date = new Date()) {
  const day = localDateKey(date);
  const prefix = dayPrefix(day);

  return {
    day,
    prefix,
    users: `${prefix}:users`,
    sessions: `${prefix}:sessions`,
    views: `${prefix}:views`,
    breakdownUsers: `${prefix}:breakdown_users`,
    breakdownSessions: `${prefix}:breakdown_sessions`,
    pageRank: `${prefix}:pages:rank`,
    pageTitleMap: `${prefix}:pages:title_url`,
    cityRank: `${prefix}:cities:rank`,
    cityVisitorMap: `${prefix}:cities:visitor_map`,
    sourceRank: `${prefix}:sources:rank`,
    sourceSessionMap: `${prefix}:sources:session_map`
  };
}

const globalKeys = {
  trackingSince: `${COUNTER_PREFIX}:tracking_since`,
  breakdownTrackingSince: `${COUNTER_PREFIX}:breakdown_tracking_since`
};

function safeId(value) {
  return createHash('sha1').update(String(value || '')).digest('hex').slice(0, 20);
}

function normalizePageTitle(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\|\s*wiki\.?setic\s*$/i, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDevice(value) {
  return DEVICE_NAMES.includes(value) ? value : 'other';
}

function pageKeys(dayKeys, event) {
  const id = safeId(`${event.host}|${event.path}`);
  const prefix = `${dayKeys.prefix}:page:${id}`;
  return {
    id,
    meta: `${prefix}:meta`,
    users: `${prefix}:users`,
    sessions: `${prefix}:sessions`
  };
}

function hourKeys(dayKeys, hour) {
  const prefix = `${dayKeys.prefix}:hour:${String(hour).padStart(2, '0')}`;
  return {
    users: `${prefix}:users`,
    sessions: `${prefix}:sessions`,
    views: `${prefix}:views`
  };
}

function deviceKeys(dayKeys, device) {
  const prefix = `${dayKeys.prefix}:device:${device}`;
  return {
    users: `${prefix}:users`,
    sessions: `${prefix}:sessions`,
    views: `${prefix}:views`
  };
}

function cityUsersKey(dayKeys, city) {
  return `${dayKeys.prefix}:city:${safeId(city)}:users`;
}

function sourceUsersKey(dayKeys, source) {
  return `${dayKeys.prefix}:source:${safeId(source)}:users`;
}

function sourceSessionsKey(dayKeys, source) {
  return `${dayKeys.prefix}:source:${safeId(source)}:sessions`;
}

function sourceFromEvent(event) {
  try {
    const entry = new URL(event.entryUrl || `https://${event.host}/`);
    const utmSource = entry.searchParams.get('utm_source');
    const utmMedium = entry.searchParams.get('utm_medium');
    if (utmSource) return `${utmSource} / ${utmMedium || 'campaign'}`;
  } catch {}

  const raw = String(event.referrer || '').trim();
  if (!raw) return '(direct) / (none)';

  try {
    const referrer = new URL(raw);
    const host = referrer.hostname.toLowerCase();
    if (host === String(event.host || '').toLowerCase()) return '(internal) / navigation';
    if (/^(www\.)?google\./i.test(host)) return 'google / organic';
    if (/^(www\.)?bing\.com$/i.test(host)) return 'bing / organic';
    if (/^(www\.)?chatgpt\.com$/i.test(host)) return 'chatgpt.com / ai-assistant';
    return `${host} / referral`;
  } catch {
    return '(direct) / (none)';
  }
}

function sourceLabel(value = '') {
  const raw = String(value);
  if (raw === '(direct) / (none)') return 'Acesso direto';
  if (raw === '(internal) / navigation') return 'Navegação interna';
  if (/google\s*\/\s*organic/i.test(raw)) return 'Google · orgânico';
  if (/bing\s*\/\s*organic/i.test(raw)) return 'Bing · orgânico';
  if (/chatgpt\.com\s*\/\s*ai-assistant/i.test(raw)) return 'ChatGPT · assistente de IA';
  return raw
    .replace(' / referral', '')
    .replace(' / organic', ' · orgânico')
    .replace(' / ai-assistant', ' · assistente de IA');
}

function labelPage(path = '/', title = '') {
  const cleanTitle = String(title || '')
    .replace(/\s*\|\s*Wiki\.?SETIC\s*$/i, '')
    .trim();

  if (cleanTitle) return cleanTitle;
  if (path === '/') return 'Página inicial';

  return String(path)
    .replace(/^\/pt-br/i, '')
    .replace(/^\/home\//i, '')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .map((part) => part.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()))
    .join(' › ');
}

const PAGEVIEW_SCRIPT = `
local eventCreated = redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1])
if not eventCreated then
  return 0
end

local ttl = ARGV[2]
local nowIso = ARGV[3]
local visitorId = ARGV[4]
local sessionId = ARGV[5]
local pageId = ARGV[6]
local host = ARGV[7]
local path = ARGV[8]
local title = ARGV[9]
local city = ARGV[10]
local source = ARGV[11]
local normalizedTitle = ARGV[12]
local pageUrl = ARGV[13]

redis.call('SET', KEYS[2], nowIso, 'NX')
redis.call('SET', KEYS[3], nowIso, 'NX')

redis.call('SADD', KEYS[4], visitorId)
redis.call('SADD', KEYS[5], sessionId)
redis.call('INCR', KEYS[6])
redis.call('SADD', KEYS[7], visitorId)
redis.call('SADD', KEYS[8], sessionId)

redis.call('SADD', KEYS[9], visitorId)
redis.call('SADD', KEYS[10], sessionId)
redis.call('INCR', KEYS[11])

redis.call('SADD', KEYS[12], visitorId)
redis.call('SADD', KEYS[13], sessionId)
redis.call('INCR', KEYS[14])

redis.call('ZINCRBY', KEYS[15], 1, pageId)
redis.call('HSET', KEYS[16], 'host', host, 'path', path, 'title', title)
redis.call('SADD', KEYS[17], visitorId)
redis.call('SADD', KEYS[18], sessionId)

local newCity = redis.call('HSETNX', KEYS[20], visitorId, city)
if newCity == 1 then
  redis.call('ZINCRBY', KEYS[19], 1, city)
  redis.call('SADD', KEYS[21], visitorId)
end

local newSource = redis.call('HSETNX', KEYS[23], sessionId, source)
if newSource == 1 then
  redis.call('ZINCRBY', KEYS[22], 1, source)
  redis.call('SADD', KEYS[24], visitorId)
  redis.call('SADD', KEYS[25], sessionId)
end

if normalizedTitle ~= '' then
  redis.call('HSET', KEYS[26], normalizedTitle, pageUrl)
end

for i = 4, 26 do
  redis.call('EXPIRE', KEYS[i], ttl)
end

return 1
`;

export async function recordActivity(event) {
  if (event.type !== 'pageview') return { ok: true, ignored: true };

  const now = new Date();
  const dayKeys = todayKeys(now);
  const hourData = hourKeys(dayKeys, localHour(now));
  const device = normalizeDevice(event.device);
  const deviceData = deviceKeys(dayKeys, device);
  const pageData = pageKeys(dayKeys, event);
  const city = String(event.city || 'Não informado').slice(0, 120);
  const source = sourceFromEvent(event);
  const normalizedTitle = normalizePageTitle(event.title);
  const pageUrl = `https://${event.host}${event.path}`;

  const result = await command([
    'EVAL',
    PAGEVIEW_SCRIPT,
    '26',
    `${COUNTER_PREFIX}:event:${event.eventId}`,
    globalKeys.trackingSince,
    globalKeys.breakdownTrackingSince,
    dayKeys.users,
    dayKeys.sessions,
    dayKeys.views,
    dayKeys.breakdownUsers,
    dayKeys.breakdownSessions,
    hourData.users,
    hourData.sessions,
    hourData.views,
    deviceData.users,
    deviceData.sessions,
    deviceData.views,
    dayKeys.pageRank,
    pageData.meta,
    pageData.users,
    pageData.sessions,
    dayKeys.cityRank,
    dayKeys.cityVisitorMap,
    cityUsersKey(dayKeys, city),
    dayKeys.sourceRank,
    dayKeys.sourceSessionMap,
    sourceUsersKey(dayKeys, source),
    sourceSessionsKey(dayKeys, source),
    dayKeys.pageTitleMap,
    String(EVENT_TTL_SECONDS),
    String(COUNTER_TTL_SECONDS),
    now.toISOString(),
    event.visitorId,
    event.sessionId,
    pageData.id,
    event.host,
    event.path,
    event.title || '',
    city,
    source,
    normalizedTitle,
    pageUrl
  ]);

  return {
    ok: true,
    duplicate: Number(result || 0) === 0,
    day: dayKeys.day
  };
}

const READ_STATS_SCRIPT = `
local prefix = ARGV[1]
local base = ARGV[2]
local currentHour = tonumber(ARGV[3]) or 0

local function number(value)
  return tonumber(value or '0') or 0
end

local function hashToObject(values)
  local obj = {}
  for i = 1, #values, 2 do
    obj[values[i]] = values[i + 1]
  end
  return obj
end

local result = {
  users = number(redis.call('SCARD', prefix .. ':users')),
  sessions = number(redis.call('SCARD', prefix .. ':sessions')),
  views = number(redis.call('GET', prefix .. ':views')),
  trend = {},
  devices = {},
  cities = {},
  pages = {},
  sources = {},
  trackingSince = redis.call('GET', base .. ':tracking_since'),
  breakdownTrackingSince = redis.call('GET', base .. ':breakdown_tracking_since')
}

for hour = 0, currentHour do
  local h = string.format('%02d', hour)
  local hp = prefix .. ':hour:' .. h
  local users = number(redis.call('SCARD', hp .. ':users'))
  local sessions = number(redis.call('SCARD', hp .. ':sessions'))
  local views = number(redis.call('GET', hp .. ':views'))

  if users > 0 or sessions > 0 or views > 0 or hour == currentHour then
    table.insert(result.trend, {
      label = h .. ':00',
      hour = tostring(hour),
      activeUsers = users,
      sessions = sessions,
      views = views
    })
  end
end

local devices = {'desktop', 'mobile', 'tablet', 'other'}
for _, device in ipairs(devices) do
  local dp = prefix .. ':device:' .. device
  local users = number(redis.call('SCARD', dp .. ':users'))
  local sessions = number(redis.call('SCARD', dp .. ':sessions'))
  local views = number(redis.call('GET', dp .. ':views'))

  if users > 0 or sessions > 0 or views > 0 then
    table.insert(result.devices, {
      name = device,
      activeUsers = users,
      sessions = sessions,
      views = views
    })
  end
end

local cityNames = redis.call('ZREVRANGE', prefix .. ':cities:rank', 0, -1)
local cityTop = {}
local otherCityUsers = 0
for index, city in ipairs(cityNames) do
  local id = string.sub(redis.sha1hex(city), 1, 20)
  local users = number(redis.call('SCARD', prefix .. ':city:' .. id .. ':users'))
  if index <= 6 then
    table.insert(cityTop, { name = city, activeUsers = users })
  else
    otherCityUsers = otherCityUsers + users
  end
end
if otherCityUsers > 0 then
  table.insert(cityTop, { name = 'Outros', activeUsers = otherCityUsers })
end
result.cities = cityTop

local pageRows = redis.call('ZREVRANGE', prefix .. ':pages:rank', 0, 14, 'WITHSCORES')
for i = 1, #pageRows, 2 do
  local id = pageRows[i]
  local views = number(pageRows[i + 1])
  local pp = prefix .. ':page:' .. id
  local meta = hashToObject(redis.call('HGETALL', pp .. ':meta'))
  local path = meta.path or '/'
  local host = meta.host or 'wiki.setic.ro.gov.br'
  local title = meta.title or ''
  local users = number(redis.call('SCARD', pp .. ':users'))
  local sessions = number(redis.call('SCARD', pp .. ':sessions'))

  table.insert(result.pages, {
    id = id,
    path = path,
    host = host,
    title = title,
    activeUsers = users,
    sessions = sessions,
    views = views
  })
end

local sourceRows = redis.call('ZREVRANGE', prefix .. ':sources:rank', 0, 9, 'WITHSCORES')
for i = 1, #sourceRows, 2 do
  local source = sourceRows[i]
  local sessions = number(sourceRows[i + 1])
  local id = string.sub(redis.sha1hex(source), 1, 20)
  local users = number(redis.call('SCARD', prefix .. ':source:' .. id .. ':users'))

  table.insert(result.sources, {
    name = source,
    sessions = sessions,
    activeUsers = users
  })
end

return cjson.encode(result)
`;

export async function readCounterStats() {
  const now = new Date();
  const dayKeys = todayKeys(now);
  const raw = await command([
    'EVAL',
    READ_STATS_SCRIPT,
    '0',
    dayKeys.prefix,
    COUNTER_PREFIX,
    String(localHour(now))
  ]);

  const stats = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
  const trackingDate = stats.trackingSince ? new Date(stats.trackingSince) : null;
  const breakdownDate = stats.breakdownTrackingSince ? new Date(stats.breakdownTrackingSince) : null;

  const completeDay = Boolean(
    trackingDate &&
    !Number.isNaN(trackingDate.getTime()) &&
    localDateKey(trackingDate) < dayKeys.day
  );

  const breakdownCompleteDay = Boolean(
    breakdownDate &&
    !Number.isNaN(breakdownDate.getTime()) &&
    localDateKey(breakdownDate) < dayKeys.day
  );

  const pages = (stats.pages || []).map((page) => ({
    name: page.path || '/',
    label: labelPage(page.path || '/', page.title || ''),
    url: `https://${page.host || 'wiki.setic.ro.gov.br'}${page.path || '/'}`,
    hostName: page.host || 'wiki.setic.ro.gov.br',
    activeUsers: Number(page.activeUsers || 0),
    sessions: Number(page.sessions || 0),
    views: Number(page.views || 0),
    trend: [],
    direction: 'stable',
    deltaPercent: 0,
    trendComparable: false
  }));

  const sources = (stats.sources || []).map((item) => ({
    name: item.name,
    label: sourceLabel(item.name),
    sessions: Number(item.sessions || 0),
    activeUsers: Number(item.activeUsers || 0)
  }));

  return {
    generatedAt: new Date().toISOString(),
    timeZone: TIME_ZONE,
    today: {
      date: dayKeys.day,
      users: Number(stats.users || 0),
      sessions: Number(stats.sessions || 0),
      views: Number(stats.views || 0)
    },
    trend: stats.trend || [],
    pages,
    devices: stats.devices || [],
    cities: stats.cities || [],
    sources,
    coverage: {
      trackingSince: stats.trackingSince || null,
      completeDay,
      breakdownTrackingSince: stats.breakdownTrackingSince || null,
      breakdownCompleteDay
    }
  };
}

export async function readCounterPageIndex() {
  if (!counterConfigured()) return new Map();

  const stats = await readCounterStats();
  const map = new Map();

  for (const page of stats.pages || []) {
    const key = normalizePageTitle(page.label);
    if (key && page.url) map.set(key, page.url);
  }

  return map;
}

export async function resolveCounterPageUrls(titles = []) {
  if (!counterConfigured() || !Array.isArray(titles) || !titles.length) return new Map();

  const dayKeys = todayKeys(new Date());
  const valid = titles.map((title) => normalizePageTitle(title)).filter(Boolean);
  if (!valid.length) return new Map();

  const values = await command(['HMGET', dayKeys.pageTitleMap, ...valid]);
  const map = new Map();

  valid.forEach((key, index) => {
    const url = Array.isArray(values) ? values[index] : null;
    if (url) map.set(key, url);
  });

  return map;
}

export async function pingCounter() {
  return command(['PING']);
}
