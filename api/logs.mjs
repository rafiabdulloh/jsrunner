function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
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
      sendJSON(res, 200, logger.getLogs(id, after));
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
      logger.clearLogs(id);
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });
}
