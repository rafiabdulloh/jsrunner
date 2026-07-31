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
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function registerPathRoutes(router) {
  router.post('/api/project/path', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const { id, path: inputPath } = body;

    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    // Validate path ends with package.json
    if (!inputPath || typeof inputPath !== 'string' || !inputPath.endsWith('package.json')) {
      sendJSON(res, 400, { error: 'Package.json not found' });
      return;
    }

    // Validate parent folder exists
    const folderPath = path.dirname(inputPath);
    if (!fs.existsSync(folderPath)) {
      sendJSON(res, 400, { error: 'Package.json not found' });
      return;
    }

    // Check path not already in use by another project
    const existing = config.getProjects();
    if (existing.some(p => p.id !== id && p.path === inputPath)) {
      sendJSON(res, 409, { error: 'Project already exists' });
      return;
    }

    // Run scanner on new folder
    let meta;
    try {
      meta = scanner.scanProject(folderPath);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
      return;
    }

    // Update project with new path, folder, and scanned metadata
    const updated = config.updateProject(id, {
      path: inputPath,
      folder: folderPath,
      name: meta.name,
      version: meta.version,
      scripts: meta.scripts,
      framework: meta.framework,
      pm: meta.pm,
      port: meta.port,
    });

    sendJSON(res, 200, updated);
  });
}
