import path from 'path';
import * as config from '../utils/config.mjs';
import * as scanner from '../utils/scanner.mjs';
import { buildProject, toFolder, isDuplicate, pickColor } from '../utils/project-factory.mjs';

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

export function registerWorkspaceRoutes(router) {
  // Scan a folder/workspace and list every service found inside it.
  router.post('/api/workspace/scan', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    if (!body.path || typeof body.path !== 'string' || !body.path.trim()) {
      sendJSON(res, 400, { error: 'Folder path is required' });
      return;
    }

    const rootFolder = toFolder(body.path.trim());
    const depth = Number.isInteger(body.depth) ? Math.min(Math.max(body.depth, 0), 6) : 3;

    let result;
    try {
      result = scanner.scanWorkspace(rootFolder, { maxDepth: depth });
    } catch (err) {
      sendJSON(res, 404, { error: err.message });
      return;
    }

    if (result.services.length === 0) {
      sendJSON(res, 404, { error: 'No package.json found in this folder' });
      return;
    }

    // Flag what is already on the dashboard so the UI can disable those rows
    const existing = config.getProjects();
    const services = result.services.map((s) => ({
      ...s,
      added: isDuplicate(s.path, existing),
    }));

    sendJSON(res, 200, { ...result, depth, services });
  });

  // Bulk-add selected services from a scan.
  router.post('/api/workspace/add', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const items = Array.isArray(body.services) ? body.services : [];
    if (items.length === 0) {
      sendJSON(res, 400, { error: 'No services selected' });
      return;
    }

    const defaultGroup = typeof body.group === 'string' && body.group.trim() ? body.group.trim() : null;
    const added = [];
    const skipped = [];

    items.forEach((item, i) => {
      const raw = typeof item === 'string' ? item : item?.path;
      if (!raw || typeof raw !== 'string') {
        skipped.push({ path: String(raw ?? ''), reason: 'Invalid path' });
        return;
      }

      const folderPath = toFolder(raw);
      const pkgPath = path.join(folderPath, 'package.json');

      if (isDuplicate(pkgPath, config.getProjects())) {
        skipped.push({ path: pkgPath, reason: 'Project already exists' });
        return;
      }

      try {
        const project = buildProject(folderPath, {
          group: (typeof item === 'object' && item.group) || defaultGroup,
          pm: typeof item === 'object' ? item.pm : undefined,
          color: pickColor(i),
        });
        config.addProject(project);
        added.push(project);
      } catch (err) {
        skipped.push({ path: pkgPath, reason: err.message });
      }
    });

    sendJSON(res, added.length > 0 ? 201 : 400, { added, skipped });
  });
}
