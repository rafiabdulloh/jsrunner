import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { pidAlive } from './win-process.mjs';

// In-memory process store: id → { child, pid, startedAt, status, command, killed, adopted, onCrashCallbacks[] }
// `child` is null for adopted entries — processes started by a previous run of
// the server that we re-attached to by PID (no stdio, so no logs).
const processes = new Map();
let logCallback = null;
let exitCallback = null;
const startLocks = new Set();

/**
 * Is this entry's process still alive? Adopted entries have no child handle,
 * so they are checked against the OS.
 */
function isAlive(entry) {
  if (!entry) return false;
  if (entry.adopted) return pidAlive(entry.pid);
  return entry.child?.exitCode === null;
}

function notifyExit(id, info) {
  if (exitCallback) {
    try { exitCallback(id, info); } catch { /* never let a listener break teardown */ }
  }
}

/**
 * Determine the run command for a project.
 * Priority: explicit `command` > chosen `runScript` > dev > start > first script.
 */
export function buildCommand({ scripts = [], pm, id, runScript, command }) {
  if (typeof command === 'string' && command.trim()) return command.trim();

  let script;
  if (runScript && scripts.includes(runScript)) {
    script = runScript;
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
function spawnProcess(command, cwd, env) {
  const extra = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (v !== null && v !== undefined) extra[k] = String(v);
  }

  const opts = {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.keys(extra).length > 0 ? { ...process.env, ...extra } : process.env,
  };

  return spawn('cmd.exe', ['/d', '/s', '/c', command], opts);
}

/**
 * Start a project process.
 * Idempotent: returns existing entry if already running.
 */
export function startProjectProcess(project) {
  const { id } = project;

  // Lock guard: reject concurrent start for same project id
  if (startLocks.has(id)) {
    const existing = processes.get(id);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      return { pid: existing.pid, status: existing.status, startedAt: existing.startedAt };
    }
  }

  const existing = processes.get(id);
  if (existing && (existing.status === 'running' || existing.status === 'starting')) {
    return { pid: existing.pid, status: existing.status, startedAt: existing.startedAt };
  }

  startLocks.add(id);

  try {
    const command = buildCommand(project);
    const child = spawnProcess(command, project.folder, project.env);
    if (logCallback) {
      logCallback(id, `[runner] ${command}${project.port ? ` (port ${project.port})` : ''}`, false);
    }

    const entry = {
      child,
      pid: child.pid,
      startedAt: Date.now(),
      status: 'running',
      command,
      killed: false,
      onCrashCallbacks: [],
    };

    processes.set(id, entry);

    child.stdout.on('data', (data) => {
      if (logCallback) logCallback(id, data.toString(), false);
    });

    child.stderr.on('data', (data) => {
      if (logCallback) logCallback(id, data.toString(), true);
    });

    child.on('close', (code) => {
      if (code !== 0 && !entry.killed) {
        entry.status = 'crashed';
        if (logCallback) logCallback(id, `Process crashed with exit code ${code}`, true);
        if (logCallback) logCallback(id, 'Process crashed', true);

        for (const cb of entry.onCrashCallbacks) {
          try { cb(code); } catch { /* swallow callback errors */ }
        }
      } else if (code === 0) {
        entry.status = 'exited';
      }
      // Entry stays in map for status queries after exit
      notifyExit(id, { code, killed: entry.killed, adopted: false });
    });

    child.on('error', (err) => {
      entry.status = 'error';
      if (logCallback) logCallback(id, `Process error: ${err.message}`, true);
    });

    return { pid: child.pid, status: 'running', startedAt: entry.startedAt };
  } finally {
    startLocks.delete(id);
  }
}

/**
 * Stop a project process by id.
 * Uses taskkill /T /F on Windows for full process tree kill.
 * Falls back to child.kill() if taskkill fails.
 */
export function stopProjectProcess(id) {
  const entry = processes.get(id);
  if (!entry) return { success: false };

  entry.killed = true;

  try {
    execSync(`taskkill /pid ${entry.pid} /T /F`, { windowsHide: true });
  } catch {
    try { entry.child?.kill(); } catch { /* give up */ }
  }

  processes.delete(id);
  return { success: true };
}

/**
 * Kill an arbitrary PID and its tree — used to free a port held by a process
 * this dashboard does not manage.
 */
export function killPid(pid) {
  execSync(`taskkill /pid ${pid} /T /F`, { windowsHide: true });
}

/**
 * Restart a project process (stop then start).
 */
export function restartProjectProcess(project) {
  stopProjectProcess(project.id);
  return startProjectProcess(project);
}

/**
 * Get process status by id.
 * Returns { pid, status, startedAt, command, adopted, alive } or null.
 * CPU/memory are not here — they come from the metrics collector.
 */
export function getProcessStatus(id) {
  const entry = processes.get(id);
  if (!entry) return null;
  return {
    pid: entry.pid,
    status: entry.status,
    startedAt: entry.startedAt,
    command: entry.command,
    adopted: !!entry.adopted,
    alive: isAlive(entry),
  };
}

/**
 * Check if a process is running (entry exists, status running, process alive).
 */
export function isRunning(id) {
  const entry = processes.get(id);
  if (!entry) return false;
  if (entry.status !== 'running') return false;
  return isAlive(entry);
}

/**
 * Re-attach to a process started by a previous run of the server.
 * No stdio is available, so logs stay empty until the project is restarted —
 * but Stop/Restart work, which is what makes the orphan manageable again.
 */
export function adoptProcess({ id, pid, startedAt, command }) {
  if (!pidAlive(pid)) return null;

  const entry = {
    child: null,
    pid,
    startedAt: startedAt || Date.now(),
    status: 'running',
    command: command || '',
    killed: false,
    adopted: true,
    onCrashCallbacks: [],
  };
  processes.set(id, entry);
  return { pid, status: 'running', startedAt: entry.startedAt };
}

/**
 * Detect adopted processes that died while we were not watching them.
 * Real children report via their 'close' event; adopted ones need this sweep.
 */
export function sweepAdopted() {
  for (const [id, entry] of processes) {
    if (!entry.adopted || entry.status !== 'running') continue;
    if (pidAlive(entry.pid)) continue;
    entry.status = 'exited';
    if (logCallback) logCallback(id, `Adopted process (PID ${entry.pid}) is no longer running`, true);
    notifyExit(id, { code: null, killed: false, adopted: true });
  }
}

/**
 * Set the log callback.
 * fn: (id, text, err) => void
 */
export function setLogCallback(fn) {
  logCallback = fn;
}

/**
 * Set the process-exit callback — fires for every exit, clean or not.
 * fn: (id, { code, killed, adopted }) => void
 */
export function setExitCallback(fn) {
  exitCallback = fn;
}

/**
 * Register a crash callback for a process.
 * Called when process exits with non-zero code and was not intentionally killed.
 */
export function onCrash(id, callback) {
  const entry = processes.get(id);
  if (!entry) return;
  entry.onCrashCallbacks.push(callback);
}

/**
 * Get all running processes from the map.
 * Optionally accepts an external map; defaults to internal.
 */
export function getRunningProjects(map) {
  const target = map || processes;
  const result = [];
  for (const [id, entry] of target) {
    if (entry.status === 'running' && isAlive(entry)) {
      result.push({ id, pid: entry.pid, startedAt: entry.startedAt, adopted: !!entry.adopted });
    }
  }
  return result;
}

/**
 * Stop ALL running processes. Used for cleanup on server shutdown.
 */
export function stopAll() {
  for (const entry of processes.values()) {
    if (entry.status === 'running' && isAlive(entry)) {
      entry.killed = true;
      try { execSync(`taskkill /pid ${entry.pid} /T /F`, { windowsHide: true }); } catch { try { entry.child?.kill(); } catch {} }
    }
  }
  processes.clear();
}
