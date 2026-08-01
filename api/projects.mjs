import path from 'path';
import fs from 'fs';
import * as config from '../utils/config.mjs';
import * as scanner from '../utils/scanner.mjs';

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
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function registerProjectRoutes(router, processManager) {
  router.get('/api/projects', async (req, res, ctx) => {
    const projects = config.getProjects();
    sendJSON(res, 200, projects.map((p) => {
      const services = processManager.getRunningServices(p.id);
      return { ...p, status: services.length > 0 ? 'running' : (p.status || 'stopped'), runningServices: services };
    }));
  });

  router.post('/api/project', async (req, res, ctx) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    // Normalize backslashes to forward slashes (Windows sends D:/path, config stores D:\path from path.join)
    const inputPath = body.path.replace(/\\/g, '/');
    if (!inputPath || typeof inputPath !== 'string' || !inputPath.endsWith('package.json')) {
      sendJSON(res, 400, { error: 'Invalid path. Must end with package.json' });
      return;
    }

    const folderPath = path.dirname(inputPath);
    if (!fs.existsSync(folderPath)) {
      sendJSON(res, 404, { error: 'Package.json not found' });
      return;
    }

    // Duplicate check (normalize stored paths too — path.join uses backslashes on Windows)
    const existing = config.getProjects();
    if (existing.some(p => p.path.replace(/\\/g, '/') === inputPath)) {
      sendJSON(res, 409, { error: 'Project already exists' });
      return;
    }

    let meta;
    let subProjects = [];
    try {
      meta = scanner.scanProject(folderPath);
      const rawPkg = JSON.parse(fs.readFileSync(path.join(folderPath, 'package.json'), 'utf-8'));
      subProjects = scanner.detectSubProjects(rawPkg, folderPath);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
      return;
    }

    const projects = config.getProjects();
    // Generate a harmonious random color
    const hue = Math.floor(Math.random() * 360);
    const color = `hsl(${hue}, 55%, 45%)`;
    const project = {
      id: config.nextId(),
      name: meta.name,
      group: body.group || null,
      framework: meta.framework,
      pm: body.pm || meta.pm,
      folder: meta.folder,
      path: meta.path,
      port: meta.port,
      scripts: meta.scripts,
      subProjects,
      color,
      status: 'stopped',
      pid: null,
      startedAt: null,
    };

    config.addProject(project);
    sendJSON(res, 201, project);
  });

  router.post('/api/project/rescan', async (req, res, ctx) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const { id } = body;
    if (!id) {
      sendJSON(res, 400, { error: 'Project id is required' });
      return;
    }

    const existing = config.getProject(id);
    if (!existing) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    const folderPath = existing.folder || path.dirname(existing.path);
    if (!fs.existsSync(path.join(folderPath, 'package.json'))) {
      sendJSON(res, 404, { error: 'Package.json not found' });
      return;
    }

    let meta;
    let subProjects = [];
    try {
      meta = scanner.scanProject(folderPath);
      const rawPkg = JSON.parse(fs.readFileSync(path.join(folderPath, 'package.json'), 'utf-8'));
      subProjects = scanner.detectSubProjects(rawPkg, folderPath);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
      return;
    }

    const updated = config.updateProject(id, {
      name: meta.name,
      version: meta.version,
      scripts: meta.scripts,
      framework: meta.framework,
      pm: meta.pm,
      port: meta.port,
      folder: meta.folder,
      path: meta.path,
      subProjects,
    });

    sendJSON(res, 200, updated);
  });

  router.delete('/api/project/:id', async (req, res, ctx) => {
    const { id } = ctx.params;
    const existing = config.getProject(id);
    if (!existing) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }
    config.deleteProject(id);
    sendJSON(res, 200, { ok: true });
  });
}
