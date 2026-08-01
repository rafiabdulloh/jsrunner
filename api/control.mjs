import net from 'net';
import fs from 'fs';

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
    // Bind all interfaces — dev servers (craco/vite) bind 0.0.0.0; checking
    // localhost alone misses them on Windows.
    server.listen(port);
  });
}

/**
 * Resolve which port a start action will bind.
 * Priority: sub-project match (dev:frontend -> subProjects.frontend.port)
 *           > PORT=NNN in the script value (re-read package.json)
 *           > project.port
 */
function resolveScriptPort(project, script) {
  if (script && project.subProjects?.length > 0) {
    const suffix = script.split(':').pop();
    const sp = project.subProjects.find((s) => s.name === suffix);
    if (sp?.port) return sp.port;
  }
  if (script && project.scripts?.includes(script)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(project.path, 'utf-8'));
      const value = pkg.scripts?.[script] || '';
      const m = value.match(/\bPORT=(\d+)/);
      if (m) return parseInt(m[1], 10);
    } catch { /* fall through */ }
  }
  return project.port || null;
}

export function registerControlRoutes(router, config, processManager) {
  function withRunningServices(project) {
    const services = processManager.getRunningServices(project.id);
    const status = services.length > 0 ? 'running' : (project.status || 'stopped');
    return { ...project, status, runningServices: services };
  }

  // POST /api/project/start
  router.post('/api/project/start', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const { id, script } = body;
    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    // Idempotent: requested script already running
    const running = processManager.getRunningServices(id);
    if (script && running.some((s) => s.script === script)) {
      sendJSON(res, 200, withRunningServices(project));
      return;
    }
    if (!script && running.length > 0) {
      sendJSON(res, 200, withRunningServices(project));
      return;
    }

    // Resolve the port this start will use, then check for conflicts.
    const portToUse = resolveScriptPort(project, script);
    if (portToUse) {
      const available = await isPortAvailable(portToUse);
      if (!available) {
        sendJSON(res, 409, { error: 'Port already in use.' });
        return;
      }
    }

    try {
      // Explicit script starts one service; empty script starts the default (dev > start > first)
      const result = script
        ? processManager.startServiceProcess(project, script)
        : processManager.startProjectProcess(project);
      sendJSON(res, 200, withRunningServices(project));
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

    const { id, script } = body;
    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    if (script) {
      processManager.stopServiceProcess(id, script);
    } else {
      processManager.stopAllServicesForProject(id);
    }
    sendJSON(res, 200, withRunningServices(project));
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
