import { createHash } from 'node:crypto';

const COUNTER_PREFIX = 'wiki:setic:v1';
const COUNTER_TTL_SECONDS = 60 * 60 * 72;
const ACTIVE_WINDOW_SECONDS = 30 * 60;
const ACTIVE_NOW_SECONDS = 5 * 60;
const TIME_ZONE = 'America/Porto_Velho';
const DEFAULT_HEARTBEAT_SECONDS = 45;
const DEVICE_NAMES = ['desktop', 'mobile', 'tablet', 'other'];

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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });

  if (!response.ok) {
    throw new Error(`Redis respondeu ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  if (data?.error) throw new Error(data.error);
  return data?.result;
}

async function pipeline(commands) {
  if (!commands.length) return [];

  const { url, token } = redisConfig();
  if (!url || !token) throw new Error('Redis não configurado.');

  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands)
  });

  if (!response.ok) {
    throw new Error(`Redis pipeline respondeu ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Resposta inválida do Redis.');

  return data.map((item) => {
    if (item?.error) throw new Error(item.error);
    return item?.result;
  });
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
    engagementSeconds: `${prefix}:engagement_seconds`,
    engagedSessions: `${prefix}:engaged_sessions`,
    breakdownUsers: `${prefix}:breakdown_users`,
    breakdownSessions: `${prefix}:breakdown_sessions`,
    pageRank: `${prefix}:pages:rank`,
    cityRank: `${prefix}:cities:rank`,
    cityVisitorMap: `${prefix}:cities:visitor_map`
  };
}

const keys = {
  activeUsers: `${COUNTER_PREFIX}:active:users`,
  activeSessions: `${COUNTER_PREFIX}:active:sessions`,
  viewEvents: `${COUNTER_PREFIX}:active:views`,
  trackingSince: `${COUNTER_PREFIX}:tracking_since`,
  breakdownTrackingSince: `${COUNTER_PREFIX}:breakdown_tracking_since`
};

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function safeId(value) {
  return createHash('sha1').update(String(value || '')).digest('hex').slice(0, 20);
}

function pageKeys(dayKeys, event) {
  const id = safeId(`${event.host}|${event.path}`);
  const prefix = `${dayKeys.prefix}:page:${id}`;
  return {
    id,
    meta: `${prefix}:meta`,
    users: `${prefix}:users`,
    sessions: `${prefix}:sessions`,
    engagementSeconds: `${prefix}:engagement_seconds`,
    engagedSessions: `${prefix}:engaged_sessions`
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

function normalizeDevice(value) {
  return DEVICE_NAMES.includes(value) ? value : 'other';
}

function parseHash(value) {
  if (!value) return {};
  if (!Array.isArray(value)) return typeof value === 'object' ? value : {};
  const result = {};
  for (let i = 0; i < value.length; i += 2) result[value[i]] = value[i + 1];
  return result;
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

export async function recordActivity(event) {
  const now = Date.now();
  const score = Math.floor(now / 1000);
  const currentDate = new Date(now);
  const dayKeys = todayKeys(currentDate);
  const hour = localHour(currentDate);
  const hourData = hourKeys(dayKeys, hour);
  const pageData = pageKeys(dayKeys, event);
  const device = normalizeDevice(event.device);
  const deviceData = deviceKeys(dayKeys, device);
  const isPageview = event.type === 'pageview';
  const engagementSeconds = Math.max(
    1,
    Math.min(60, Number(event.activeSeconds || DEFAULT_HEARTBEAT_SECONDS))
  );

  const activityCommands = [
    ['SET', keys.trackingSince, new Date(now).toISOString(), 'NX'],
    ['ZADD', keys.activeUsers, score, event.visitorId],
    ['ZADD', keys.activeSessions, score, event.sessionId],
    ['ZREMRANGEBYSCORE', keys.activeUsers, '-inf', score - ACTIVE_WINDOW_SECONDS - 60],
    ['ZREMRANGEBYSCORE', keys.activeSessions, '-inf', score - ACTIVE_WINDOW_SECONDS - 60],
    ['ZREMRANGEBYSCORE', keys.viewEvents, '-inf', score - ACTIVE_WINDOW_SECONDS - 60],
    ['SADD', hourData.users, event.visitorId],
    ['SADD', hourData.sessions, event.sessionId],
    ['EXPIRE', hourData.users, COUNTER_TTL_SECONDS],
    ['EXPIRE', hourData.sessions, COUNTER_TTL_SECONDS]
  ];

  if (!isPageview) {
    activityCommands.push(
      ['INCRBY', dayKeys.engagementSeconds, engagementSeconds],
      ['SADD', dayKeys.engagedSessions, event.sessionId],
      ['INCRBY', pageData.engagementSeconds, engagementSeconds],
      ['SADD', pageData.engagedSessions, event.sessionId],
      ['EXPIRE', dayKeys.engagementSeconds, COUNTER_TTL_SECONDS],
      ['EXPIRE', dayKeys.engagedSessions, COUNTER_TTL_SECONDS],
      ['EXPIRE', pageData.engagementSeconds, COUNTER_TTL_SECONDS],
      ['EXPIRE', pageData.engagedSessions, COUNTER_TTL_SECONDS]
    );

    await pipeline(activityCommands);
    return { ok: true, day: dayKeys.day };
  }

  const eventKey = `${COUNTER_PREFIX}:event:${event.eventId}`;
  const firstSeen = await command(['SET', eventKey, '1', 'NX', 'EX', 60 * 60 * 24]);
  if (!firstSeen) {
    await pipeline(activityCommands);
    return { ok: true, duplicate: true, day: dayKeys.day };
  }

  const city = String(event.city || 'Não informado').slice(0, 120);
  const cityKey = cityUsersKey(dayKeys, city);

  activityCommands.push(
    ['SET', keys.breakdownTrackingSince, new Date(now).toISOString(), 'NX'],
    ['SADD', dayKeys.users, event.visitorId],
    ['SADD', dayKeys.sessions, event.sessionId],
    ['INCR', dayKeys.views],
    ['SADD', dayKeys.breakdownUsers, event.visitorId],
    ['SADD', dayKeys.breakdownSessions, event.sessionId],
    ['INCR', hourData.views],
    ['SADD', deviceData.users, event.visitorId],
    ['SADD', deviceData.sessions, event.sessionId],
    ['INCR', deviceData.views],
    ['ZINCRBY', dayKeys.pageRank, 1, pageData.id],
    ['HSET', pageData.meta, 'host', event.host, 'path', event.path, 'title', event.title || ''],
    ['SADD', pageData.users, event.visitorId],
    ['SADD', pageData.sessions, event.sessionId],
    ['ZINCRBY', dayKeys.cityRank, 1, city],
    ['ZADD', keys.viewEvents, score, event.eventId],

    ['EXPIRE', dayKeys.users, COUNTER_TTL_SECONDS],
    ['EXPIRE', dayKeys.sessions, COUNTER_TTL_SECONDS],
    ['EXPIRE', dayKeys.views, COUNTER_TTL_SECONDS],
    ['EXPIRE', dayKeys.breakdownUsers, COUNTER_TTL_SECONDS],
    ['EXPIRE', dayKeys.breakdownSessions, COUNTER_TTL_SECONDS],
    ['EXPIRE', hourData.views, COUNTER_TTL_SECONDS],
    ['EXPIRE', deviceData.users, COUNTER_TTL_SECONDS],
    ['EXPIRE', deviceData.sessions, COUNTER_TTL_SECONDS],
    ['EXPIRE', deviceData.views, COUNTER_TTL_SECONDS],
    ['EXPIRE', dayKeys.pageRank, COUNTER_TTL_SECONDS],
    ['EXPIRE', pageData.meta, COUNTER_TTL_SECONDS],
    ['EXPIRE', pageData.users, COUNTER_TTL_SECONDS],
    ['EXPIRE', pageData.sessions, COUNTER_TTL_SECONDS],
    ['EXPIRE', dayKeys.cityRank, COUNTER_TTL_SECONDS]
  );

  const cityWasAssigned = await command([
    'HSETNX',
    dayKeys.cityVisitorMap,
    event.visitorId,
    city
  ]);

  if (cityWasAssigned) {
    activityCommands.push(
      ['SADD', cityKey, event.visitorId],
      ['EXPIRE', cityKey, COUNTER_TTL_SECONDS]
    );
  }
  activityCommands.push(['EXPIRE', dayKeys.cityVisitorMap, COUNTER_TTL_SECONDS]);

  await pipeline(activityCommands);
  return { ok: true, day: dayKeys.day };
}

async function readTrend(dayKeys) {
  const commands = [];
  for (let hour = 0; hour < 24; hour++) {
    const hourData = hourKeys(dayKeys, hour);
    commands.push(
      ['SCARD', hourData.users],
      ['SCARD', hourData.sessions],
      ['GET', hourData.views]
    );
  }

  const values = await pipeline(commands);
  const currentHour = localHour(new Date());
  const trend = [];

  for (let hour = 0; hour <= currentHour; hour++) {
    const offset = hour * 3;
    const activeUsers = asNumber(values[offset]);
    const sessions = asNumber(values[offset + 1]);
    const views = asNumber(values[offset + 2]);

    if (activeUsers || sessions || views || hour === currentHour) {
      trend.push({
        label: `${String(hour).padStart(2, '0')}:00`,
        hour: String(hour),
        activeUsers,
        sessions,
        views
      });
    }
  }

  return trend;
}

async function readDevices(dayKeys, totalUsers, totalSessions) {
  const commands = [];
  DEVICE_NAMES.forEach((device) => {
    const data = deviceKeys(dayKeys, device);
    commands.push(
      ['SCARD', data.users],
      ['SCARD', data.sessions],
      ['GET', data.views]
    );
  });

  const values = await pipeline(commands);
  const devices = DEVICE_NAMES.map((name, index) => ({
    name,
    activeUsers: asNumber(values[index * 3]),
    sessions: asNumber(values[index * 3 + 1]),
    views: asNumber(values[index * 3 + 2])
  })).filter((item) => item.activeUsers || item.sessions || item.views);

  const classifiedUsers = devices.reduce((sum, item) => sum + item.activeUsers, 0);
  const classifiedSessions = devices.reduce((sum, item) => sum + item.sessions, 0);
  const missingUsers = Math.max(0, totalUsers - classifiedUsers);
  const missingSessions = Math.max(0, totalSessions - classifiedSessions);

  if (missingUsers || missingSessions) {
    devices.push({
      name: 'unclassified',
      activeUsers: missingUsers,
      sessions: missingSessions,
      views: 0
    });
  }

  return devices.sort((a, b) => b.activeUsers - a.activeUsers);
}

async function readCities(dayKeys, totalUsers) {
  const ranked = await command(['ZREVRANGE', dayKeys.cityRank, 0, 7]);
  const cities = Array.isArray(ranked) ? ranked : [];
  if (!cities.length) {
    return totalUsers ? [{ name: 'Aguardando classificação', activeUsers: totalUsers }] : [];
  }

  const counts = await pipeline(cities.map((city) => ['SCARD', cityUsersKey(dayKeys, city)]));
  const result = cities.map((name, index) => ({
    name,
    activeUsers: asNumber(counts[index])
  })).filter((item) => item.activeUsers > 0);

  const shown = result.slice(0, 6);
  const shownUsers = shown.reduce((sum, item) => sum + item.activeUsers, 0);
  const remaining = Math.max(0, totalUsers - shownUsers);
  if (remaining) shown.push({ name: 'Outros / ainda não classificados', activeUsers: remaining });
  return shown;
}

async function readPages(dayKeys) {
  const ranked = await command(['ZREVRANGE', dayKeys.pageRank, 0, 14, 'WITHSCORES']);
  const flat = Array.isArray(ranked) ? ranked : [];
  const pages = [];

  for (let index = 0; index < flat.length; index += 2) {
    pages.push({ id: flat[index], views: asNumber(flat[index + 1]) });
  }
  if (!pages.length) return [];

  const commands = [];
  pages.forEach((page) => {
    const prefix = `${dayKeys.prefix}:page:${page.id}`;
    commands.push(
      ['HGETALL', `${prefix}:meta`],
      ['SCARD', `${prefix}:users`],
      ['SCARD', `${prefix}:sessions`],
      ['GET', `${prefix}:engagement_seconds`],
      ['SCARD', `${prefix}:engaged_sessions`]
    );
  });

  const values = await pipeline(commands);

  return pages.map((page, index) => {
    const offset = index * 5;
    const meta = parseHash(values[offset]);
    const activeUsers = asNumber(values[offset + 1]);
    const sessions = asNumber(values[offset + 2]);
    const engagementSeconds = asNumber(values[offset + 3]);
    const engagedSessions = asNumber(values[offset + 4]);
    const pagePath = meta.path || '/';
    const hostName = meta.host || 'wiki.setic.ro.gov.br';

    return {
      name: pagePath,
      label: labelPage(pagePath, meta.title),
      url: `https://${hostName}${pagePath}`,
      hostName,
      activeUsers,
      sessions,
      views: page.views,
      avgEngagementSeconds: activeUsers > 0 ? engagementSeconds / activeUsers : 0,
      engagementRate: sessions > 0 ? Math.min(1, engagedSessions / sessions) : 0,
      trend: [],
      direction: 'stable',
      deltaPercent: 0
    };
  });
}

export async function readCounterStats() {
  const now = Date.now();
  const score = Math.floor(now / 1000);
  const dayKeys = todayKeys(new Date(now));

  const [
    users,
    sessions,
    views,
    breakdownUsers,
    breakdownSessions,
    engagementSeconds,
    engagedSessions,
    activeUsers30m,
    activeUsersNow,
    sessions30m,
    views30m,
    trackingSince,
    breakdownTrackingSince
  ] = await pipeline([
    ['SCARD', dayKeys.users],
    ['SCARD', dayKeys.sessions],
    ['GET', dayKeys.views],
    ['SCARD', dayKeys.breakdownUsers],
    ['SCARD', dayKeys.breakdownSessions],
    ['GET', dayKeys.engagementSeconds],
    ['SCARD', dayKeys.engagedSessions],
    ['ZCOUNT', keys.activeUsers, score - ACTIVE_WINDOW_SECONDS, '+inf'],
    ['ZCOUNT', keys.activeUsers, score - ACTIVE_NOW_SECONDS, '+inf'],
    ['ZCOUNT', keys.activeSessions, score - ACTIVE_WINDOW_SECONDS, '+inf'],
    ['ZCOUNT', keys.viewEvents, score - ACTIVE_WINDOW_SECONDS, '+inf'],
    ['GET', keys.trackingSince],
    ['GET', keys.breakdownTrackingSince]
  ]);

  const totalUsers = asNumber(users);
  const totalSessions = asNumber(sessions);
  const totalViews = asNumber(views);
  const detailedUsers = asNumber(breakdownUsers);
  const detailedSessions = asNumber(breakdownSessions);
  const totalEngagementSeconds = asNumber(engagementSeconds);
  const totalEngagedSessions = asNumber(engagedSessions);

  const [trend, devices, cities, pages] = await Promise.all([
    readTrend(dayKeys),
    readDevices(dayKeys, totalUsers, totalSessions),
    readCities(dayKeys, totalUsers),
    readPages(dayKeys)
  ]);

  const trackingDate = trackingSince ? new Date(trackingSince) : null;
  const breakdownDate = breakdownTrackingSince ? new Date(breakdownTrackingSince) : null;
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

  return {
    generatedAt: new Date(now).toISOString(),
    timeZone: TIME_ZONE,
    today: {
      date: dayKeys.day,
      users: totalUsers,
      sessions: totalSessions,
      views: totalViews,
      engagementRate: detailedSessions > 0 ? Math.min(1, totalEngagedSessions / detailedSessions) : 0,
      avgEngagementSeconds: detailedSessions > 0 ? totalEngagementSeconds / detailedSessions : 0,
      detailedUsers,
      detailedSessions
    },
    realtime: {
      activeUsersNow: asNumber(activeUsersNow),
      activeUsers30m: asNumber(activeUsers30m),
      sessions30m: asNumber(sessions30m),
      views30m: asNumber(views30m),
      windowMinutes: 30,
      activeNowMinutes: 5
    },
    trend,
    pages,
    devices,
    cities,
    coverage: {
      trackingSince: trackingSince || null,
      completeDay,
      breakdownTrackingSince: breakdownTrackingSince || null,
      breakdownCompleteDay
    }
  };
}

export async function pingCounter() {
  return command(['PING']);
}
