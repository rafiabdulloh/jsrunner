import path from 'path';
import fs from 'fs';
import * as config from '../utils/config.mjs';
import * as scanner from '../utils/scanner.mjs';
import { buildProject, toFolder, isDuplicate } from '../utils/project-factory.mjs';
import { removeProjectFromProfiles } from '../utils/profiles.mjs';

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

export function registerProjectRoutes(router, supervisor) {
  router.get('/api/projects', async (req, res, ctx) => {
    // Reconciled against live process state — a crashed service must not keep
    // reporting "running" just because that is what config still says.
    sendJSON(res, 200, supervisor.reconcile());
  });

  router.post('/api/project', async (req, res, ctx) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    if (!body.path || typeof body.path !== 'string' || !body.path.trim()) {
      sendJSON(res, 400, { error: 'Path is required' });
      return;
    }

    // Accepts a folder or a .../package.json path
    const folderPath = toFolder(body.path.trim());
    if (!fs.existsSync(path.join(folderPath, 'package.json'))) {
      sendJSON(res, 404, { error: 'Package.json not found' });
      return;
    }

    // Duplicate check (normalize stored paths too — path.join uses backslashes on Windows)
    if (isDuplicate(path.join(folderPath, 'package.json'), config.getProjects())) {
      sendJSON(res, 409, { error: 'Project already exists' });
      return;
    }

    let project;
    try {
      project = buildProject(folderPath, { group: body.group, pm: body.pm });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
      return;
    }

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
    // Keep profiles from carrying dead references
    removeProjectFromProfiles(id);
    sendJSON(res, 200, { ok: true });
  });
}
