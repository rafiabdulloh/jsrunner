// SSE client. Replaces the 2s status poll; falls back to polling when the
// stream is unavailable (proxy, old browser, server without /api/events).
let source = null;
let fallbackTimer = null;
let handlers = {};
let connected = false;

function startFallback() {
  if (fallbackTimer || !handlers.onFallbackTick) return;
  handlers.onFallbackTick();
  fallbackTimer = setInterval(handlers.onFallbackTick, 2000);
}

function stopFallback() {
  if (fallbackTimer) clearInterval(fallbackTimer);
  fallbackTimer = null;
}

/**
 * @param {{
 *   onProjects: (projects: object[]) => void,
 *   onLogs: (batch: {id: string, count: number}[]) => void,
 *   onFallbackTick: () => void,
 *   onStatus?: (state: 'live' | 'polling') => void,
 * }} opts
 */
export function connectEvents(opts) {
  handlers = opts;

  if (typeof EventSource === 'undefined') {
    startFallback();
    handlers.onStatus?.('polling');
    return;
  }

  source = new EventSource('/api/events');

  source.addEventListener('projects', (e) => {
    if (!connected) {
      connected = true;
      stopFallback();
      handlers.onStatus?.('live');
    }
    try {
      handlers.onProjects(JSON.parse(e.data));
    } catch {
      // ignore a malformed frame
    }
  });

  source.addEventListener('logs', (e) => {
    try {
      handlers.onLogs(JSON.parse(e.data));
    } catch {
      // ignore
    }
  });

  // EventSource reconnects on its own; poll meanwhile so the UI stays fresh
  source.addEventListener('error', () => {
    connected = false;
    handlers.onStatus?.('polling');
    startFallback();
  });
}

export function isLive() {
  return connected;
}
