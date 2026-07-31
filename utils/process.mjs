import { spawn } from 'child_process';
import { execSync } from 'child_process';

// In-memory process store: id → { child, pid, startedAt, status, command, killed, onCrashCallbacks[] }
const processes = new Map();
let logCallback = null;
const startLocks = new Set();

/**
 * Determine the run command for a project.
 * Priority: dev > start > first script.
 */
function buildCommand({ scripts, pm, id }) {
  let script;
  if (scripts.includes('dev')) {
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
    const child = spawnProcess(command, project.pm, project.folder);

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
    try { entry.child.kill(); } catch { /* give up */ }
  }

  processes.delete(id);
  return { success: true };
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
 * Returns { pid, status, startedAt, command, cpu, mem } or null.
 */
export function getProcessStatus(id) {
  const entry = processes.get(id);
  if (!entry) return null;
  return {
    pid: entry.pid,
    status: entry.status,
    startedAt: entry.startedAt,
    command: entry.command,
    cpu: 0,
    mem: 0,
  };
}

/**
 * Check if a process is running (entry exists, status running, process alive).
 */
export function isRunning(id) {
  const entry = processes.get(id);
  if (!entry) return false;
  if (entry.status !== 'running') return false;
  return entry.child.exitCode === null;
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
    if (entry.status === 'running' && entry.child.exitCode === null) {
      result.push({ id, pid: entry.pid, startedAt: entry.startedAt });
    }
  }
  return result;
}

/**
 * Stop ALL running processes. Used for cleanup on server shutdown.
 */
export function stopAll() {
  for (const [id, entry] of processes) {
    if (entry.status === 'running' && entry.child.exitCode === null) {
      entry.killed = true;
      try { execSync(`taskkill /pid ${entry.pid} /T /F`, { windowsHide: true }); } catch { try { entry.child.kill(); } catch {} }
    }
  }
  processes.clear();
}
