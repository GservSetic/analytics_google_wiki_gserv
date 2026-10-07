(() => {
  'use strict';

  const ENDPOINT = 'https://wiki-three-xi.vercel.app/api/track';
  const ALLOWED_HOSTS = new Set(['wiki.setic.ro.gov.br', 'playground-wiki.setic.ro.gov.br']);
  const VISITOR_KEY = 'setic_wiki_visitor_v1';
  const SESSION_KEY = 'setic_wiki_session_v1';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const HEARTBEAT_MS = 30 * 1000;
  const BOT_RE = /bot|crawler|spider|slurp|headless|lighthouse|pagespeed|googlebot|bingbot/i;

  if (!ALLOWED_HOSTS.has(location.hostname)) return;
  if (navigator.webdriver || BOT_RE.test(navigator.userAgent || '')) return;

  const uuid = () => {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const value = Math.random() * 16 | 0;
      const next = char === 'x' ? value : (value & 0x3 | 0x8);
      return next.toString(16);
    });
  };

  function getVisitorId() {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  }

  function getSession() {
    const now = Date.now();
    let session = null;

    try {
      session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {}

    if (!session?.id || !session?.lastActivity || now - session.lastActivity > SESSION_TIMEOUT_MS) {
      session = { id: uuid(), lastActivity: now };
    } else {
      session.lastActivity = now;
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function payload(type, extra = {}) {
    const session = getSession();
    return {
      type,
      eventId: uuid(),
      visitorId: getVisitorId(),
      sessionId: session.id,
      host: location.hostname,
      path: location.pathname || '/',
      title: (document.title || '').slice(0, 240),
      sentAt: new Date().toISOString(),
      ...extra
    };
  }

  async function sendPayload(data) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  let pendingPageview = null;
  let lastTrackedPath = '';
  let routeTimer = null;
  let lastHeartbeatAt = Date.now();

  async function sendPendingPageview() {
    if (!pendingPageview) return true;
    const sent = await sendPayload(pendingPageview);
    if (sent) pendingPageview = null;
    return sent;
  }

  function activeSecondsSinceLastHeartbeat() {
    const now = Date.now();
    const elapsed = Math.max(1, Math.round((now - lastHeartbeatAt) / 1000));
    lastHeartbeatAt = now;
    return Math.min(60, elapsed);
  }

  function sendHeartbeat() {
    if (pendingPageview) return sendPendingPageview();
    return sendPayload(payload('heartbeat', {
      activeSeconds: activeSecondsSinceLastHeartbeat()
    }));
  }

  function flushVisibleTime() {
    const elapsed = Math.round((Date.now() - lastHeartbeatAt) / 1000);
    if (elapsed < 3) return;
    sendHeartbeat();
  }

  function trackPage(force = false) {
    const path = location.pathname || '/';
    if (!force && path === lastTrackedPath) return;
    lastTrackedPath = path;
    lastHeartbeatAt = Date.now();
    clearTimeout(routeTimer);

    routeTimer = setTimeout(() => {
      pendingPageview = payload('pageview');
      sendPendingPageview();
    }, 180);
  }

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    flushVisibleTime();
    const result = originalPushState.apply(this, args);
    setTimeout(() => trackPage(), 0);
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    flushVisibleTime();
    const result = originalReplaceState.apply(this, args);
    setTimeout(() => trackPage(), 0);
    return result;
  };

  addEventListener('popstate', () => {
    flushVisibleTime();
    trackPage();
  });

  addEventListener('pageshow', (event) => {
    lastHeartbeatAt = Date.now();
    if (event.persisted) trackPage(true);
  });

  let lastTitle = document.title;
  const titleObserver = new MutationObserver(() => {
    if (document.title !== lastTitle) {
      lastTitle = document.title;
      trackPage();
    }
  });

  const titleNode = document.querySelector('title');
  if (titleNode) titleObserver.observe(titleNode, { childList: true, subtree: true });

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (pendingPageview) {
      sendPendingPageview();
      return;
    }
    sendHeartbeat();
  }, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushVisibleTime();
    } else {
      lastHeartbeatAt = Date.now();
      if (pendingPageview) sendPendingPageview();
    }
  });

  addEventListener('pagehide', () => flushVisibleTime());

  trackPage(true);
})();
