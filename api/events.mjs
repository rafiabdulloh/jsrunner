// Server-Sent Events: pushes project state and log notifications instead of
// making the browser poll. Still zero-dependency — SSE is just a long-lived
// text/event-stream response.
const PROJECT_TICK_MS = 1000;
const LOG_NOTIFY_MS = 200;
const KEEPALIVE_MS = 25_000;

const clients = new Set();

function send(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client vanished mid-write; the 'close' handler cleans up
  }
}

function broadcast(event, data) {
  for (const res of clients) send(res, event, data);
}

export function registerEventRoutes(router, { supervisor, logger }) {
  let lastSnapshot = '';
  // projectId -> pending log line count, flushed on a short timer
  const pendingLogs = new Map();

  // Project state: push only when something actually changed
  const stateTimer = setInterval(() => {
    if (clients.size === 0) return;
    try {
      const projects = supervisor.reconcile();
      const json = JSON.stringify(projects);
      if (json === lastSnapshot) return;
      lastSnapshot = json;
      broadcast('projects', projects);
    } catch {
      // keep the loop alive
    }
  }, PROJECT_TICK_MS);
  stateTimer.unref?.();

  // Log writes: notify which project grew, the client pulls the new lines.
  // Coalesced so a chatty dev server cannot flood the stream.
  const logTimer = setInterval(() => {
    if (pendingLogs.size === 0 || clients.size === 0) {
      pendingLogs.clear();
      return;
    }
    const batch = [...pendingLogs.entries()].map(([id, count]) => ({ id, count }));
    pendingLogs.clear();
    broadcast('logs', batch);
  }, LOG_NOTIFY_MS);
  logTimer.unref?.();

  logger.onLog((id) => {
    if (clients.size === 0) return;
    pendingLogs.set(id, (pendingLogs.get(id) || 0) + 1);
  });

  // Proxies and some browsers drop an idle stream; a comment keeps it warm
  const keepAlive = setInterval(() => {
    for (const res of clients) {
      try { res.write(': keepalive\n\n'); } catch { /* ignore */ }
    }
  }, KEEPALIVE_MS);
  keepAlive.unref?.();

  router.get('/api/events', async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    clients.add(res);
    req.socket.setNoDelay?.(true);

    // Immediate snapshot so the client never waits a tick to paint
    try {
      const projects = supervisor.reconcile();
      lastSnapshot = JSON.stringify(projects);
      send(res, 'projects', projects);
    } catch {
      // fall through — the next tick will retry
    }

    const cleanup = () => {
      clients.delete(res);
      try { res.end(); } catch { /* already gone */ }
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  });
}
