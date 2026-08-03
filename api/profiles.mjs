import * as store from '../utils/profiles.mjs';

// Predefined hues so profile chips stay visually distinct
const HUES = [210, 160, 30, 340, 280, 100, 15, 190];

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

const MODES = ['parallel', 'sequential'];

/**
 * Validate a name + ordered project id list + start mode.
 * projectIds order is preserved — it is the start order in sequential mode.
 * @returns {{error?: string, name?: string, projectIds?: string[], mode?: string}}
 */
function validate(body, projects, { requireName = true } = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (requireName && !name) return { error: 'Profile name is required' };
  if (name.length > 60) return { error: 'Profile name is too long (max 60)' };

  if (body.projectIds !== undefined && !Array.isArray(body.projectIds)) {
    return { error: 'projectIds must be an array' };
  }

  const ids = [...new Set(body.projectIds || [])];
  for (const id of ids) {
    if (!projects.some((p) => p.id === id)) {
      return { error: `Unknown project id: ${id}` };
    }
  }

  const mode = body.mode === undefined ? 'parallel' : body.mode;
  if (!MODES.includes(mode)) {
    return { error: `mode must be one of: ${MODES.join(', ')}` };
  }

  return { name, projectIds: ids, mode };
}

export function registerProfileRoutes(router, config, supervisor, processManager) {
  const knownIds = () => new Set(config.getProjects().map((p) => p.id));

  router.get('/api/profiles', async (req, res) => {
    sendJSON(res, 200, store.getProfiles(knownIds()));
  });

  router.post('/api/profiles', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const projects = config.getProjects();
    const parsed = validate(body, projects);
    if (parsed.error) {
      sendJSON(res, 400, { error: parsed.error });
      return;
    }

    const existing = store.getProfiles();
    if (existing.some((p) => p.name.toLowerCase() === parsed.name.toLowerCase())) {
      sendJSON(res, 409, { error: 'A profile with that name already exists' });
      return;
    }

    const profile = store.addProfile({
      id: store.nextProfileId(),
      name: parsed.name,
      projectIds: parsed.projectIds,
      mode: parsed.mode,
      color: `hsl(${HUES[existing.length % HUES.length]}, 60%, 50%)`,
    });
    sendJSON(res, 201, profile);
  });

  router.put('/api/profiles/:id', async (req, res, ctx) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const { id } = ctx.params;
    if (!store.getProfile(id)) {
      sendJSON(res, 404, { error: 'Profile not found' });
      return;
    }

    const parsed = validate(body, config.getProjects());
    if (parsed.error) {
      sendJSON(res, 400, { error: parsed.error });
      return;
    }

    if (store.getProfiles().some((p) => p.id !== id && p.name.toLowerCase() === parsed.name.toLowerCase())) {
      sendJSON(res, 409, { error: 'A profile with that name already exists' });
      return;
    }

    sendJSON(res, 200, store.updateProfile(id, {
      name: parsed.name,
      projectIds: parsed.projectIds,
      mode: parsed.mode,
    }));
  });

  router.delete('/api/profiles/:id', async (req, res, ctx) => {
    const { id } = ctx.params;
    if (!store.getProfile(id)) {
      sendJSON(res, 404, { error: 'Profile not found' });
      return;
    }
    store.deleteProfile(id);
    sendJSON(res, 200, { ok: true });
  });

  // Start every member plus their dependencies. Runs in the background —
  // a four-service profile with dependency gates takes a while.
  router.post('/api/profiles/:id/start', async (req, res, ctx) => {
    const profile = store.getProfile(ctx.params.id);
    if (!profile) {
      sendJSON(res, 404, { error: 'Profile not found' });
      return;
    }

    const known = knownIds();
    const targets = (profile.projectIds || []).filter((pid) => known.has(pid));
    if (targets.length === 0) {
      sendJSON(res, 400, { error: 'This profile has no projects' });
      return;
    }

    const mode = profile.mode === 'sequential' ? 'sequential' : 'parallel';

    // Optimistic status so cards show movement immediately. In sequential mode
    // only the first one is starting — the rest are genuinely still waiting,
    // and claiming otherwise would just flicker back on the next reconcile.
    const optimistic = mode === 'sequential' ? targets.slice(0, 1) : targets;
    for (const pid of optimistic) {
      const project = config.getProject(pid);
      if (project && project.status !== 'running') {
        config.updateProject(pid, { status: 'starting' });
      }
    }

    supervisor.startProfile(targets, { mode }).catch(() => {
      // Per-project failures are already written to config and the log
    });

    sendJSON(res, 202, { ok: true, starting: targets.length, mode });
  });

  router.post('/api/profiles/:id/stop', async (req, res, ctx) => {
    const profile = store.getProfile(ctx.params.id);
    if (!profile) {
      sendJSON(res, 404, { error: 'Profile not found' });
      return;
    }

    // Only the profile's own members — a shared dependency may still be
    // serving something outside this profile.
    const stopped = [];
    for (const pid of profile.projectIds || []) {
      const project = config.getProject(pid);
      if (!project || project.status === 'stopped') continue;
      supervisor.cancelPendingRestart(pid);
      processManager.stopProjectProcess(pid);
      supervisor.clearMetrics(pid);
      config.updateProject(pid, { status: 'stopped', pid: null, startedAt: null, cpu: 0, mem: 0 });
      stopped.push(pid);
    }

    sendJSON(res, 200, { ok: true, stopped: stopped.length });
  });
}
