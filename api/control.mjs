import net from 'net';

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

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

export function registerControlRoutes(router, config, processManager) {
  // POST /api/project/start
  router.post('/api/project/start', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const { id } = body;
    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    // Idempotent: already running or starting
    if (project.status === 'running' || project.status === 'starting') {
      sendJSON(res, 200, project);
      return;
    }

    // Port conflict check
    if (project.port) {
      const available = await isPortAvailable(project.port);
      if (!available) {
        sendJSON(res, 500, { error: 'Failed to start process' });
        return;
      }
    }

    try {
      // Optimistic: mark as starting so concurrent requests see it
      config.updateProject(id, { status: 'starting' });
      const result = processManager.startProjectProcess(project);
      const updated = config.updateProject(id, {
        status: result.status || 'running',
        pid: result.pid || null,
        startedAt: result.startedAt || null,
        cpu: 0,
        mem: 0,
      });
      sendJSON(res, 200, updated);
    } catch {
      sendJSON(res, 500, { error: 'Failed to start process' });
    }
  });

  // POST /api/project/stop
  router.post('/api/project/stop', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const { id } = body;
    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    // Idempotent: already stopped or crashed
    if (project.status === 'stopped' || project.status === 'crashed') {
      sendJSON(res, 200, project);
      return;
    }

    processManager.stopProjectProcess(id);
    const updated = config.updateProject(id, {
      status: 'stopped',
      pid: null,
      startedAt: null,
      cpu: 0,
      mem: 0,
    });
    sendJSON(res, 200, updated);
  });

  // POST /api/project/restart
  router.post('/api/project/restart', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const { id } = body;
    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    try {
      const result = processManager.restartProjectProcess(project);
      const updated = config.updateProject(id, {
        pid: result.pid,
        startedAt: result.startedAt,
        status: 'running',
        cpu: 0,
        mem: 0,
      });
      sendJSON(res, 200, updated);
    } catch {
      sendJSON(res, 500, { error: 'Failed to start process' });
    }
  });
}
