import * as logger from '../utils/logger.mjs';
import * as scriptRunner from '../utils/script-runner.mjs';

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

/**
 * Build the shell command string for a given package manager and script type.
 */
function buildCommand(pm, script, type) {
  if (type === 'install') {
    return `${pm} install`;
  }
  if (type === 'build') {
    // npm -> "npm run build"; bun/pnpm/yarn -> "pm build"
    return pm === 'npm' ? `${pm} run build` : `${pm} build`;
  }
  // Other scripts from package.json
  return pm === 'npm' ? `${pm} run ${script}` : `${pm} ${script}`;
}

export function registerScriptRoutes(router, config, processManager) {
  router.post('/api/project/script', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const { id, script } = body;
    if (!id || !script) {
      sendJSON(res, 400, { error: 'id and script are required' });
      return;
    }

    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    let type;
    if (script === 'install') {
      type = 'install';
    } else if (script === 'build') {
      type = 'build';
    } else {
      if (!project.scripts || !project.scripts.includes(script)) {
        sendJSON(res, 404, { error: 'Script not found' });
        return;
      }
      type = 'script';
    }

    const command = buildCommand(project.pm, script, type);

    // Fire and forget — return immediately with running status
    const result = scriptRunner.runScript(project, script, command);
    sendJSON(res, 200, result);
  });

  // POST /api/project/script/cancel — cancel a running script
  router.post('/api/project/script/cancel', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const { id } = body;
    if (!id) {
      sendJSON(res, 400, { error: 'id is required' });
      return;
    }

    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    const cancelled = scriptRunner.cancelScript(id);
    if (!cancelled) {
      sendJSON(res, 404, { error: 'No running script for this project' });
      return;
    }

    sendJSON(res, 200, { ok: true });
  });
}
