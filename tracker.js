(() => {
  'use strict';

  const ENDPOINT = 'https://wiki-three-xi.vercel.app/api/track';
  const ALLOWED_HOSTS = new Set(['wiki.setic.ro.gov.br', 'playground-wiki.setic.ro.gov.br']);
  const VISITOR_KEY = 'setic_wiki_visitor_v1';
  const SESSION_KEY = 'setic_wiki_session_v1';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const HEARTBEAT_MS = 45 * 1000;
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

  function payload(type) {
    const session = getSession();
    return {
      type,
      eventId: uuid(),
      visitorId: getVisitorId(),
      sessionId: session.id,
      host: location.hostname,
      path: location.pathname || '/',
      title: (document.title || '').slice(0, 240),
      sentAt: new Date().toISOString()
    };
  }

  async function send(type) {
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(type))
      });
    } catch {
      // O rastreamento nunca deve interferir na navegação da Wiki.
    }
  }

  let lastTrackedPath = '';
  let routeTimer = null;

  function trackPage(force = false) {
    const path = location.pathname || '/';
    if (!force && path === lastTrackedPath) return;
    lastTrackedPath = path;
    clearTimeout(routeTimer);
    routeTimer = setTimeout(() => send('pageview'), 180);
  }

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    setTimeout(() => trackPage(), 0);
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    setTimeout(() => trackPage(), 0);
    return result;
  };

  addEventListener('popstate', () => trackPage());
  addEventListener('pageshow', () => trackPage(true));

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
    if (document.visibilityState === 'visible') send('heartbeat');
  }, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') send('heartbeat');
  });

  trackPage(true);
})();
