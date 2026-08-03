function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function registerLogRoutes(router, config, logger) {
  router.get('/api/project/:id/logs', async (req, res, ctx) => {
    try {
      const { id } = ctx.params;
      if (!config.getProject(id)) {
        sendJSON(res, 404, { error: 'Project not found' });
        return;
      }
      const after = parseInt(ctx.searchParams.get('after'), 10) || 0;
      const script = ctx.searchParams.get('script');
      sendJSON(res, 200, logger.getLogs(id, after, script));
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  router.post('/api/project/:id/logs/clear', async (req, res, ctx) => {
    try {
      const { id } = ctx.params;
      if (!config.getProject(id)) {
        sendJSON(res, 404, { error: 'Project not found' });
        return;
      }
      let body = {};
      try {
        body = await collectBody(req);
      } catch {
        /* empty body or invalid JSON: treat as clear-all */
      }
      logger.clearLogs(id, body.script);
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });
}
