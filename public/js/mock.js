// Mock backend: in-memory project DB, simulated latency, log generators,
// metrics jitter, crash + auto-restart simulation.

const delay = (ms = 200 + Math.random() * 400) =>
  new Promise((r) => setTimeout(r, ms));

const fail = (msg) => {
  throw new Error(msg);
};

let nextId = 100;
let nextPid = 4000;

const db = [
  {
    id: 'p1', name: 'gateway', group: 'TMF', framework: 'Express', pm: 'pnpm',
    folder: 'D:/Neuronworks/project/tmf/gateway', port: 3001,
    scripts: ['dev', 'start', 'build', 'lint', 'test'],
  },
  {
    id: 'p2', name: 'product-service', group: 'TMF', framework: 'NestJS', pm: 'pnpm',
    folder: 'D:/Neuronworks/project/tmf/product', port: 3002,
    scripts: ['dev', 'start', 'build', 'test', 'lint'],
  },
  {
    id: 'p3', name: 'inventory-service', group: 'TMF', framework: 'NestJS', pm: 'pnpm',
    folder: 'D:/Neuronworks/project/tmf/inventory', port: 3003,
    scripts: ['dev', 'start', 'build', 'test'],
  },
  {
    id: 'p4', name: 'pos-backend', group: 'POS', framework: 'Express', pm: 'npm',
    folder: 'D:/Neuronworks/project/pos/backend', port: 4000,
    scripts: ['dev', 'start', 'seed', 'test'],
  },
  {
    id: 'p5', name: 'pos-frontend', group: 'POS', framework: 'React', pm: 'yarn',
    folder: 'D:/Neuronworks/project/pos/frontend', port: 5173,
    scripts: ['dev', 'build', 'preview', 'lint'],
  },
  {
    id: 'p6', name: 'auth-service', group: 'Support', framework: 'Next', pm: 'npm',
    folder: 'D:/Neuronworks/project/support/auth', port: 3100,
    scripts: ['dev', 'build', 'start', 'lint'],
  },
  {
    id: 'p7', name: 'notification-worker', group: 'Support', framework: 'Node', pm: 'npm',
    folder: 'D:/Neuronworks/project/support/notification', port: null,
    scripts: ['start', 'dev', 'test'],
  },
  {
    id: 'p8', name: 'marketing-site', group: null, framework: 'Astro', pm: 'bun',
    folder: 'D:/Neuronworks/project/marketing', port: 4321,
    scripts: ['dev', 'build', 'preview'],
  },
  {
    id: 'p9', name: 'flaky-api', group: null, framework: 'Express', pm: 'npm',
    folder: 'D:/Neuronworks/project/lab/flaky-api', port: 5050,
    scripts: ['dev', 'start'], crashDemo: true,
  },
].map((p, i) => {
  const hues = [210, 160, 30, 340, 190, 280, 15, 50, 100];
  return {
    status: 'stopped',
    pid: null,
    startedAt: null,
    color: `hsl(${hues[i % hues.length]}, 55%, 45%)`,
    ...p,
    path: `${p.folder}/package.json`,
  };
});

// ---------- Logs ----------
const buffers = new Map(); // id -> [{text, err}]
const MAX_LINES = 500;

function pushLog(p, text, err = false) {
  const buf = buffers.get(p.id) ?? [];
  buf.push({ text, err });
  if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
  buffers.set(p.id, buf);
}

const bootLines = {
  Vite: (p) => [`VITE v5.0.11 ready in ${280 + rnd(220)} ms`, `???  Local:   http://localhost:${p.port}/`],
  React: (p) => [`VITE v5.0.11 ready in ${300 + rnd(250)} ms`, `???  Local:   http://localhost:${p.port}/`],
  Next: (p) => [`??? Next.js 14.2.3`, `- Local:        http://localhost:${p.port}`, '??? Ready in 1.2s'],
  NestJS: (p) => [`[Nest] ${p.pid}  - LOG [NestFactory] Starting Nest application...`, `[Nest] ${p.pid}  - LOG [RoutesResolver] Mapped {/api, GET} route`, `[Nest] ${p.pid}  - LOG Nest application successfully started on port ${p.port}`],
  Astro: (p) => [`astro v4.5.0 started in ${90 + rnd(80)}ms`, `??? Local    http://localhost:${p.port}/`],
  Express: (p) => [`Server listening on http://localhost:${p.port}`],
  Node: (p) => [`[worker] ${p.name} started, pid ${p.pid}`],
  Unknown: (p) => [`${p.name} started on port ${p.port}`],
};

const tickLines = {
  Vite: () => pick(['hmr update /src/App.jsx', 'page reload src/components/Nav.tsx']),
  React: () => pick(['hmr update /src/App.jsx', 'page reload src/pages/Pos.tsx']),
  Next: () => pick(['??? Compiled /page in 412ms', '??? Compiling /api/auth ...', 'GET / 200 in 34ms']),
  NestJS: () => pick([`[Nest] LOG [Router] Mapped {/items/:id, GET} route`, `[Nest] LOG Request completed in ${8 + rnd(30)}ms`]),
  Astro: () => pick(['watch src/pages/index.astro', '200 / 12ms']),
  Express: () => pick([`GET /api/health 200 ${3 + rnd(12)}ms`, `POST /api/orders 201 ${15 + rnd(40)}ms`]),
  Node: () => pick(['[worker] heartbeat ok', `[worker] processed ${rnd(20)} messages`]),
  Unknown: () => 'tick',
};

function rnd(n) {
  return Math.floor(Math.random() * n);
}
function pick(arr) {
  return arr[rnd(arr.length)];
}
function gen(p, table) {
  const fn = table[p.framework] ?? table.Unknown;
  return fn(p);
}

// ---------- Lifecycle helpers ----------
function jitterMetrics(p) {
  const cpu = parseFloat(p.cpu) + (Math.random() - 0.5) * 4;
  const mem = parseFloat(p.mem) + (Math.random() - 0.5) * 30;
  p.cpu = Math.max(0.1, Math.min(25, cpu)).toFixed(1);
  p.mem = Math.max(30, Math.min(400, mem)).toFixed(0);
}

function toRunning(p) {
  p.status = 'running';
  p.pid = nextPid += rnd(700) + 17;
  p.startedAt = Date.now();
  p.cpu = (1 + Math.random() * 6).toFixed(1);
  p.mem = (60 + Math.random() * 120).toFixed(0);
  for (const line of gen(p, bootLines)) pushLog(p, line);
  if (p.crashDemo) {
    setTimeout(() => crash(p), 10000);
  }
}

function toStopped(p) {
  p.status = 'stopped';
  p.pid = null;
  p.startedAt = null;
  p.cpu = 0;
  p.mem = 0;
}

function crash(p) {
  if (p.status !== 'running') return;
  pushLog(p, `Error: listen EADDRINUSE: address already in use :::${p.port}`, true);
  pushLog(p, `Process exited with code 1`, true);
  toStopped(p);
  p.status = 'crashed';
  if (p.autoRestart) {
    pushLog(p, '[runner] auto-restart enabled, restarting in 2s...');
    setTimeout(() => {
      if (p.status === 'crashed') toRunning(p);
    }, 2000);
  }
}

// Occupied by "something else" on the machine, per BRD port-check demo.
const EXTERNAL_OCCUPIED_PORTS = new Set([3000, 8080]);

// Track cancelled scripts for cancellable runScript
const scriptCancelled = new Set();

function find(id) {
  const p = db.find((x) => x.id === id);
  if (!p) fail('Project not found');
  return p;
}
const clone = (p) => ({ ...p });

// ---------- Mock API surface (mirrors api.js functions) ----------
export const mock = {
  async getProjects() {
    for (const p of db) if (p.status === 'running') jitterMetrics(p);
    await delay(120);
    return db.map(clone);
  },

  async getMetrics() {
    for (const p of db) if (p.status === 'running') jitterMetrics(p);
    await delay(80);
    return Object.fromEntries(db.map((p) => [p.id, { cpu: p.cpu, mem: p.mem }]));
  },

  async addProject(path, group, pm) {
    await delay(800);
    if (!path.endsWith('package.json') || path.includes('invalid')) fail('Package.json not found');
    if (db.some((p) => p.path === path)) fail('Project already exists');
    const folder = path.replace(/[\\/]package\.json$/, '');
    const name = folder.split(/[\\/]/).pop() || 'new-project';
    let port = 2000 + rnd(7000);
    while (db.some((p) => p.port === port) || EXTERNAL_OCCUPIED_PORTS.has(port)) port = 2000 + rnd(7000);
    const p = {
      id: `p${nextId++}`, name, group: group || null, framework: 'Unknown', pm: pm || 'npm',
      folder, port, scripts: ['dev', 'build', 'start'],
      subProjects: [],
      color: `hsl(${Math.floor(Math.random() * 360)}, 55%, 45%)`,
      status: 'stopped', pid: null, startedAt: null, path,
    };
    db.push(p);
    return clone(p);
  },

  async startProject(id) {
    const p = find(id);
    if (p.status === 'running' || p.status === 'starting') return clone(p);
    if (db.some((x) => x.id !== id && x.status === 'running' && x.port === p.port && p.port !== null)) {
      fail('Failed to start process');
    }
    p.status = 'starting';
    pushLog(p, `[runner] ${p.pm} ${p.scripts.includes('dev') ? 'dev' : p.scripts[0]}`);
    await delay(1000 + rnd(1000));
    toRunning(p);
    return clone(p);
  },

  async stopProject(id) {
    const p = find(id);
    await delay(400);
    pushLog(p, '[runner] process stopped');
    toStopped(p);
    return clone(p);
  },

  async restartProject(id) {
    const p = find(id);
    toStopped(p);
    p.status = 'starting';
    pushLog(p, '[runner] restarting...');
    await delay(900 + rnd(800));
    toRunning(p);
    return clone(p);
  },

  async runScript(id, script) {
    const p = find(id);
    if (!p.scripts.includes(script)) fail('Script not found');
    pushLog(p, `[runner] ${p.pm} run ${script}`);

    // Chunked delay to check cancellation flag
    const total = 1200 + rnd(1500);
    const chunk = 200;
    for (let elapsed = 0; elapsed < total; elapsed += chunk) {
      await delay(chunk);
      if (scriptCancelled.has(id)) {
        scriptCancelled.delete(id);
        pushLog(p, `[runner] script "${script}" cancelled`);
        return clone(p);
      }
    }

    pushLog(p, `[runner] script "${script}" finished successfully`);
    return clone(p);
  },

  cancelScript(id) {
    scriptCancelled.add(id);
    return { ok: true };
  },

  async install(id) {
    const p = find(id);
    pushLog(p, `[runner] ${p.pm} install`);
    await delay(1800 + rnd(1500));
    pushLog(p, `[runner] dependencies installed`);
    return clone(p);
  },

  async rescanProject(id) {
    const p = find(id);
    await delay(700);
    return clone(p);
  },

  async changePort(id, port, target) {
    const p = find(id);
    await delay(400);
    if (p.noPort) fail('Port configuration not supported.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid port');
    if (EXTERNAL_OCCUPIED_PORTS.has(port) || db.some((x) => x.id !== id && x.port === port)) {
      fail('Port already in use.');
    }
    if (target && p.subProjects?.length > 0) {
      const sp = p.subProjects.find(s => s.name === target);
      if (sp) {
        sp.port = port;
        pushLog(p, `[runner] sub-project "${target}" port updated to ${port}`);
      }
    }
    p.port = port;
    p.path = `${p.folder}/package.json`;
    pushLog(p, `[runner] port updated to ${port}`);
    return clone(p);
  },

  async editPath(id, path) {
    const p = find(id);
    await delay(600);
    if (!path.endsWith('package.json') || path.includes('invalid')) fail('Package.json not found');
    if (db.some((x) => x.id !== id && x.path === path)) fail('Project already exists');
    p.path = path;
    p.folder = path.replace(/[\\/]package\.json$/, '');
    return clone(p);
  },

  async deleteProject(id) {
    find(id);
    await delay(300);
    db.splice(db.findIndex((x) => x.id === id), 1);
    buffers.delete(id);
    return { ok: true };
  },

  async fetchLogs(id, after = 0) {
    const p = find(id);
    if (p.status === 'running') pushLog(p, gen(p, tickLines));
    await delay(60);
    const buf = buffers.get(p.id) ?? [];
    return { total: buf.length, lines: buf.slice(after) };
  },

  async clearLogs(id) {
    find(id);
    buffers.set(id, []);
    return { ok: true };
  },

  async editGroup(id, group) {
    const p = find(id);
    await delay(200);
    p.group = group || null;
    return clone(p);
  },

  async renameGroup(oldName, newName) {
    await delay(200);
    if (oldName === newName) return { ok: true };
    if (db.some(p => p.group === newName)) fail('Group name already exists');
    for (const p of db) { if (p.group === oldName) p.group = newName; }
    return { ok: true };
  },

  async deleteGroup(name, mode) {
    await delay(200);
    if (name === 'Ungrouped') fail('Cannot delete Ungrouped');
    for (let i = db.length - 1; i >= 0; i--) {
      if (db[i].group === name) {
        if (mode === 'delete_all') db.splice(i, 1);
        else db[i].group = null;
      }
    }
    return { ok: true };
  },
};
