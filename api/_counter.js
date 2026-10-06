const COUNTER_PREFIX = 'wiki:setic:v1';
const COUNTER_TTL_SECONDS = 60 * 60 * 72;
const ACTIVE_WINDOW_SECONDS = 30 * 60;
const ACTIVE_NOW_SECONDS = 5 * 60;
const TIME_ZONE = 'America/Porto_Velho';

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

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function todayKeys(date = new Date()) {
  const day = localDateKey(date);
  return {
    day,
    users: `${COUNTER_PREFIX}:day:${day}:users`,
    sessions: `${COUNTER_PREFIX}:day:${day}:sessions`,
    views: `${COUNTER_PREFIX}:day:${day}:views`
  };
}

const keys = {
  activeUsers: `${COUNTER_PREFIX}:active:users`,
  activeSessions: `${COUNTER_PREFIX}:active:sessions`,
  viewEvents: `${COUNTER_PREFIX}:active:views`,
  trackingSince: `${COUNTER_PREFIX}:tracking_since`
};

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export async function recordActivity(event) {
  const now = Date.now();
  const score = Math.floor(now / 1000);
  const dayKeys = todayKeys(new Date(now));
  const isPageview = event.type === 'pageview';

  const commands = [
    ['SET', keys.trackingSince, new Date(now).toISOString(), 'NX'],
    ['SADD', dayKeys.users, event.visitorId],
    ['SADD', dayKeys.sessions, event.sessionId],
    ['EXPIRE', dayKeys.users, COUNTER_TTL_SECONDS],
    ['EXPIRE', dayKeys.sessions, COUNTER_TTL_SECONDS],
    ['ZADD', keys.activeUsers, score, event.visitorId],
    ['ZADD', keys.activeSessions, score, event.sessionId],
    ['ZREMRANGEBYSCORE', keys.activeUsers, '-inf', score - ACTIVE_WINDOW_SECONDS - 60],
    ['ZREMRANGEBYSCORE', keys.activeSessions, '-inf', score - ACTIVE_WINDOW_SECONDS - 60],
    ['ZREMRANGEBYSCORE', keys.viewEvents, '-inf', score - ACTIVE_WINDOW_SECONDS - 60]
  ];

  if (isPageview) {
    commands.push(
      ['INCR', dayKeys.views],
      ['EXPIRE', dayKeys.views, COUNTER_TTL_SECONDS],
      ['ZADD', keys.viewEvents, score, event.eventId]
    );
  }

  await pipeline(commands);
  return { ok: true, day: dayKeys.day };
}

export async function readCounterStats() {
  const now = Date.now();
  const score = Math.floor(now / 1000);
  const dayKeys = todayKeys(new Date(now));

  const [
    users,
    sessions,
    views,
    activeUsers30m,
    activeUsersNow,
    sessions30m,
    views30m,
    trackingSince
  ] = await pipeline([
    ['SCARD', dayKeys.users],
    ['SCARD', dayKeys.sessions],
    ['GET', dayKeys.views],
    ['ZCOUNT', keys.activeUsers, score - ACTIVE_WINDOW_SECONDS, '+inf'],
    ['ZCOUNT', keys.activeUsers, score - ACTIVE_NOW_SECONDS, '+inf'],
    ['ZCOUNT', keys.activeSessions, score - ACTIVE_WINDOW_SECONDS, '+inf'],
    ['ZCOUNT', keys.viewEvents, score - ACTIVE_WINDOW_SECONDS, '+inf'],
    ['GET', keys.trackingSince]
  ]);

  const trackingDate = trackingSince ? new Date(trackingSince) : null;
  const completeDay = Boolean(
    trackingDate &&
    !Number.isNaN(trackingDate.getTime()) &&
    localDateKey(trackingDate) < dayKeys.day
  );

  return {
    generatedAt: new Date(now).toISOString(),
    timeZone: TIME_ZONE,
    today: {
      date: dayKeys.day,
      users: asNumber(users),
      sessions: asNumber(sessions),
      views: asNumber(views)
    },
    realtime: {
      activeUsersNow: asNumber(activeUsersNow),
      activeUsers30m: asNumber(activeUsers30m),
      sessions30m: asNumber(sessions30m),
      views30m: asNumber(views30m),
      windowMinutes: 30,
      activeNowMinutes: 5
    },
    coverage: {
      trackingSince: trackingSince || null,
      completeDay
    }
  };
}

export async function pingCounter() {
  return command(['PING']);
}
