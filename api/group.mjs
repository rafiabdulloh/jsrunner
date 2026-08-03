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
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function registerGroupRoutes(router, config) {
  // Rename group: update all projects with old group name
  router.post('/api/group/rename', async (req, res) => {
    let body;
    try { body = await collectBody(req); } catch { sendJSON(res, 400, { error: 'Invalid JSON' }); return; }

    const { oldName, newName } = body;
    if (!oldName || !newName) {
      sendJSON(res, 400, { error: 'oldName and newName are required' });
      return;
    }
    if (oldName === 'Ungrouped') {
      sendJSON(res, 400, { error: 'Cannot rename Ungrouped' });
      return;
    }

    const projects = config.getProjects();
    // Unique check: new name not already used (unless renaming to same)
    if (oldName !== newName && projects.some(p => p.group === newName)) {
      sendJSON(res, 409, { error: 'Group name already exists' });
      return;
    }

    for (const p of projects) {
      if (p.group === oldName) {
        config.updateProject(p.id, { group: newName });
      }
    }

    sendJSON(res, 200, { ok: true });
  });

  // Move project to a group
  router.post('/api/project/group', async (req, res) => {
    let body;
    try { body = await collectBody(req); } catch { sendJSON(res, 400, { error: 'Invalid JSON' }); return; }

    const { id, group } = body;
    if (!id) {
      sendJSON(res, 400, { error: 'id is required' });
      return;
    }

    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    const updated = config.updateProject(id, { group: group || null });
    sendJSON(res, 200, updated);
  });

  // Delete group
  router.post('/api/group/delete', async (req, res) => {
    let body;
    try { body = await collectBody(req); } catch { sendJSON(res, 400, { error: 'Invalid JSON' }); return; }

    const { name, mode } = body;
    if (!name || !mode) {
      sendJSON(res, 400, { error: 'name and mode are required' });
      return;
    }
    if (name === 'Ungrouped') {
      sendJSON(res, 400, { error: 'Cannot delete Ungrouped' });
      return;
    }

    const projects = config.getProjects();
    for (const p of projects) {
      if (p.group === name) {
        if (mode === 'delete_all') {
          config.deleteProject(p.id);
          removeProjectFromProfiles(p.id);
        } else {
          config.updateProject(p.id, { group: null });
        }
      }
    }
    sendJSON(res, 200, { ok: true });
  });
}
