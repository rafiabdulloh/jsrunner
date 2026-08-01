import { spawn } from 'child_process';
import { execSync } from 'child_process';

// In-memory process store: "id:script" → { child, pid, startedAt, status, command, script, killed, onCrashCallbacks[] }
const processes = new Map();
let logCallback = null;
const startLocks = new Set();

/**
 * Determine the run command for a project.
 * Priority: explicit script > dev > start > first script.
 */
function buildCommand({ scripts, pm, id }, explicitScript) {
  let script;
  if (explicitScript && scripts.includes(explicitScript)) {
    script = explicitScript;
  } else if (scripts.includes('dev')) {
    script = 'dev';
  } else if (scripts.includes('start')) {
    script = 'start';
  } else if (scripts.length > 0) {
    script = scripts[0];
  } else {
    throw new Error(`No scripts available for project ${id}`);
  }

  if (pm === 'npm') return `npm run ${script}`;
  // bun/pnpm/yarn: <pm> dev|start|run <script>
  return script === 'dev' || script === 'start'
    ? `${pm} ${script}`
    : `${pm} run ${script}`;
}

/**
 * Spawn a process with Windows-specific handling.
 * ALL package managers (npm/yarn/pnpm/bun) need cmd.exe wrapper on Windows
 * because they're .cmd/.bat files, not .exe — spawn can't resolve them directly.
 */
function spawnProcess(command, pm, cwd) {
  const opts = {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  return spawn('cmd.exe', ['/d', '/s', '/c', command], opts);
}

/** Default script for a project: dev > start > first. */
function defaultScript({ scripts }) {
  if (scripts.includes('dev')) return 'dev';
  if (scripts.includes('start')) return 'start';
  return scripts[0];
}

/** Resolve requested script to one that exists; fall back to default. */
function resolveScript(project, script) {
  if (script && project.scripts.includes(script)) return script;
  return defaultScript(project);
}

/** Kill an entry's process tree; swallow failures. */
function killEntry(entry) {
  entry.killed = true;
  try {
    execSync(`taskkill /pid ${entry.pid} /T /F`, { windowsHide: true });
  } catch {
    try { entry.child.kill(); } catch { /* give up */ }
  }
}

/** Wire stdout/stderr/close/error handlers onto a spawned entry. */
function attachEntryHandlers(id, entry) {
  entry.child.stdout.on('data', (data) => {
    if (logCallback) logCallback(id, data.toString(), false);
  });

  entry.child.stderr.on('data', (data) => {
    if (logCallback) logCallback(id, data.toString(), true);
  });

  entry.child.on('close', (code) => {
    if (code !== 0 && !entry.killed) {
      entry.status = 'crashed';
      if (logCallback) logCallback(id, `Process crashed with exit code ${code}`, true);

      for (const cb of entry.onCrashCallbacks) {
        try { cb(code); } catch { /* swallow callback errors */ }
      }
    } else if (code === 0) {
      entry.status = 'exited';
    }
    // Entry stays in map for status queries after exit
  });

  entry.child.on('error', (err) => {
    entry.status = 'error';
    if (logCallback) logCallback(id, `Process error: ${err.message}`, true);
  });
}

/**
 * Start one service script for a project.
 * Idempotent: returns existing entry if "id:script" already running/starting.
 * Keyed per "id:script" so multiple scripts of one project can run together.
 */
export function startServiceProcess(project, script) {
  const { id } = project;
  const resolved = resolveScript(project, script);
  const key = `${id}:${resolved}`;

  const existing = processes.get(key);
  if (existing && (existing.status === 'running' || existing.status === 'starting')) {
    return { pid: existing.pid, status: existing.status, startedAt: existing.startedAt, script: resolved };
  }
  if (startLocks.has(key)) {
    const locked = processes.get(key);
    if (locked && (locked.status === 'running' || locked.status === 'starting')) {
      return { pid: locked.pid, status: locked.status, startedAt: locked.startedAt, script: resolved };
    }
  }

  startLocks.add(key);

  try {
    const command = buildCommand(project, resolved);
    const child = spawnProcess(command, project.pm, project.folder);

    const entry = {
      child,
      pid: child.pid,
      startedAt: Date.now(),
      status: 'running',
      command,
      script: resolved,
      killed: false,
      onCrashCallbacks: [],
    };

    processes.set(key, entry);
    attachEntryHandlers(id, entry);

    return { pid: child.pid, status: 'running', startedAt: entry.startedAt, script: resolved };
  } finally {
    startLocks.delete(key);
  }
}

/**
 * Stop one service script for a project.
 * Uses taskkill /T /F on Windows for full process tree kill.
 */
export function stopServiceProcess(id, script) {
  const key = `${id}:${script}`;
  const entry = processes.get(key);
  if (!entry) return { success: false };

  killEntry(entry);
  processes.delete(key);
  return { success: true };
}

/** Stop all service entries whose key starts with "id:". Returns count. */
export function stopAllServicesForProject(id) {
  const prefix = `${id}:`;
  let count = 0;
  for (const key of [...processes.keys()]) {
    if (key.startsWith(prefix)) {
      stopServiceProcess(id, key.slice(prefix.length));
      count++;
    }
  }
  return count;
}

/** List running services of a project: [{ script, pid, startedAt, status }]. */
export function getRunningServices(id) {
  const prefix = `${id}:`;
  const result = [];
  for (const [key, entry] of processes) {
    if (key.startsWith(prefix) && entry.status === 'running' && entry.child.exitCode === null) {
      result.push({ script: entry.script, pid: entry.pid, startedAt: entry.startedAt, status: entry.status });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases (old single-process-per-project API)
// ---------------------------------------------------------------------------

/**
 * Start a project process (backward compat).
 * Alias for startServiceProcess with default script when no explicit script given.
 */
export function startProjectProcess(project, explicitScript) {
  return startServiceProcess(project, explicitScript || defaultScript(project));
}

/** Stop a project (backward compat). Alias for stopAllServicesForProject. */
export function stopProjectProcess(id) {
  return stopAllServicesForProject(id);
}

/** Restart a project (backward compat): stop all services, start default script. */
export function restartProjectProcess(project) {
  stopAllServicesForProject(project.id);
  return startServiceProcess(project, defaultScript(project));
}

/**
 * Get process status by id (backward compat).
 * Running if any service of the project is running; otherwise reflects
 * the latest entry status, or 'stopped' when the project has no entries.
 */
export function getProcessStatus(id) {
  const running = getRunningServices(id);
  if (running.length > 0) {
    const first = running[0];
    return {
      pid: first.pid,
      status: 'running',
      startedAt: first.startedAt,
      command: first.script,
      cpu: 0,
      mem: 0,
    };
  }

  const prefix = `${id}:`;
  let latest = null;
  for (const [key, entry] of processes) {
    if (key.startsWith(prefix)) {
      if (!latest || entry.startedAt > latest.startedAt) latest = entry;
    }
  }
  if (latest) {
    return {
      pid: latest.pid,
      status: latest.status,
      startedAt: latest.startedAt,
      command: latest.script,
      cpu: 0,
      mem: 0,
    };
  }

  return { pid: null, status: 'stopped', startedAt: null, command: null, cpu: 0, mem: 0 };
}

/** Check if any service of a project is running (backward compat). */
export function isRunning(id) {
  return getRunningServices(id).length > 0;
}

/**
 * Set the log callback.
 * fn: (id, text, err) => void
 */
export function setLogCallback(fn) {
  logCallback = fn;
}

/**
 * Register a crash callback for a process.
 * Called when process exits with non-zero code and was not intentionally killed.
 * Usage: onCrash(id, cb) applies to all services of the project;
 *        onCrash(id, script, cb) targets one specific service script.
 */
export function onCrash(id, scriptOrCallback, maybeCallback) {
  let entries = [];
  if (typeof scriptOrCallback === 'function') {
    for (const [key, entry] of processes) {
      if (key.startsWith(`${id}:`)) entries.push(entry);
    }
    maybeCallback = scriptOrCallback;
  } else {
    const entry = processes.get(`${id}:${scriptOrCallback}`);
    if (entry) entries.push(entry);
  }
  for (const entry of entries) entry.onCrashCallbacks.push(maybeCallback);
}

/**
 * Get all running entries from the map.
 * Optionally accepts an external map; defaults to internal.
 * Returns [{ id, pid, startedAt }] — one row per running service.
 */
export function getRunningProjects(map) {
  const target = map || processes;
  const result = [];
  for (const [key, entry] of target) {
    if (entry.status === 'running' && entry.child.exitCode === null) {
      result.push({ id: key.slice(0, key.length - entry.script.length - 1), pid: entry.pid, startedAt: entry.startedAt });
    }
  }
  return result;
}

/**
 * Stop ALL running processes. Used for cleanup on server shutdown.
 */
export function stopAll() {
  for (const [key, entry] of processes) {
    if (entry.status === 'running' && entry.child.exitCode === null) {
      killEntry(entry);
    }
  }
  processes.clear();
}
