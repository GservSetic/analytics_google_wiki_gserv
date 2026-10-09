(() => {
  'use strict';

  const ENDPOINT = 'https://wiki-three-xi.vercel.app/api/track';
  const ALLOWED_HOSTS = new Set(['wiki.setic.ro.gov.br', 'playground-wiki.setic.ro.gov.br']);
  const VISITOR_KEY = 'setic_wiki_visitor_v1';
  const SESSION_KEY = 'setic_wiki_session_v1';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const RETRY_MS = 60 * 1000;
  const QUOTA_BACKOFF_MS = 60 * 60 * 1000;
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
      session = {
        id: uuid(),
        lastActivity: now,
        referrer: document.referrer || '',
        entryUrl: location.href
      };
    } else {
      session.lastActivity = now;
      if (session.referrer === undefined) session.referrer = document.referrer || '';
      if (!session.entryUrl) session.entryUrl = location.href;
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function pageviewPayload() {
    const session = getSession();
    return {
      type: 'pageview',
      eventId: uuid(),
      visitorId: getVisitorId(),
      sessionId: session.id,
      host: location.hostname,
      path: location.pathname || '/',
      title: (document.title || '').slice(0, 240),
      referrer: (session.referrer || '').slice(0, 600),
      entryUrl: (session.entryUrl || location.href).slice(0, 900),
      sentAt: new Date().toISOString()
    };
  }

  let pendingPageview = null;
  let lastTrackedPath = '';
  let routeTimer = null;
  let retryTimer = null;
  let pausedUntil = 0;

  async function sendPendingPageview() {
    if (!pendingPageview || Date.now() < pausedUntil) return false;

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingPageview)
      });

      if (response.ok) {
        pendingPageview = null;
        clearTimeout(retryTimer);
        return true;
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') || 3600);
        pausedUntil = Date.now() + Math.max(300, retryAfter) * 1000;
      }
    } catch {}

    clearTimeout(retryTimer);
    const delay = Math.max(RETRY_MS, pausedUntil - Date.now());
    retryTimer = setTimeout(sendPendingPageview, delay);
    return false;
  }

  function trackPage(force = false) {
    const path = location.pathname || '/';
    if (!force && path === lastTrackedPath) return;
    lastTrackedPath = path;
    clearTimeout(routeTimer);

    routeTimer = setTimeout(() => {
      pendingPageview = pageviewPayload();
      sendPendingPageview();
    }, 180);
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

  addEventListener('pageshow', (event) => {
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

  addEventListener('online', () => {
    if (pendingPageview) sendPendingPageview();
  });

  trackPage(true);
})();
