import path from 'path';
import * as config from '../utils/config.mjs';
import * as portManager from '../utils/port.mjs';

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

export function registerPortRoutes(router) {
  router.post('/api/project/port', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const { id, port, target } = body;

    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    // Don't change port of a running process
    if (project.status === 'running' || project.status === 'starting') {
      sendJSON(res, 400, { error: 'Project is running' });
      return;
    }

    // Validate port: integer, 1-65535
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      sendJSON(res, 400, { error: 'Invalid port' });
      return;
    }

    // Resolve target folder (sub-project or root)
    let targetFolder = project.folder || path.dirname(project.path);
    if (target && project.subProjects?.length > 0) {
      const sp = project.subProjects.find(s => s.name === target);
      if (!sp) {
        sendJSON(res, 404, { error: 'Sub-project not found' });
        return;
      }
      targetFolder = path.dirname(sp.path);
    }

    // Check port availability
    const available = await portManager.isPortAvailable(portNum);
    if (!available) {
      sendJSON(res, 409, { error: 'Port already in use.' });
      return;
    }

    // Detect port config file in target folder
    const detected = portManager.detectPortConfig(targetFolder);
    if (!detected) {
      sendJSON(res, 400, { error: 'Port configuration not supported.' });
      return;
    }

    // Rewrite port in config file
    const rewritten = portManager.rewritePort(targetFolder, detected.file, portNum);
    if (!rewritten) {
      sendJSON(res, 500, { error: 'Failed to update port configuration' });
      return;
    }

    // Update project in config
    const updated = config.updateProject(id, { port: portNum });
    sendJSON(res, 200, updated);
  });
}
