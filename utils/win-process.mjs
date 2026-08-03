// One-shot snapshot of the Windows process table.
// Used by metrics (CPU/mem per process tree) and by orphan adoption on boot.
// Single PowerShell/CIM call per sample — cheaper than one wmic call per PID,
// and wmic is deprecated on recent Windows builds.
import { execFile } from 'child_process';

const FIELDS = [
  'p=$_.ProcessId',
  'pp=$_.ParentProcessId',
  'n=$_.Name',
  't=[int64]($_.KernelModeTime + $_.UserModeTime)',
  'w=[int64]$_.WorkingSetSize',
];

function buildScript(withCommandLine) {
  const fields = withCommandLine ? [...FIELDS, 'c=$_.CommandLine'] : FIELDS;
  return (
    '@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ ' +
    fields.join('; ') +
    ' } }) | ConvertTo-Json -Compress'
  );
}

/**
 * @param {{withCommandLine?: boolean, timeout?: number}} [options]
 * @returns {Promise<Map<number, {pid: number, ppid: number, name: string, cpu100ns: number, mem: number, cmd: string}>>}
 *          Empty map when the query fails — callers treat that as "no data".
 */
export function listProcesses({ withCommandLine = false, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', buildScript(withCommandLine)],
      { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(new Map());
          return;
        }

        let rows;
        try {
          rows = JSON.parse(stdout);
        } catch {
          resolve(new Map());
          return;
        }
        if (!Array.isArray(rows)) rows = [rows];

        const map = new Map();
        for (const r of rows) {
          if (typeof r?.p !== 'number') continue;
          map.set(r.p, {
            pid: r.p,
            ppid: typeof r.pp === 'number' ? r.pp : 0,
            name: r.n || '',
            cpu100ns: Number(r.t) || 0,
            mem: Number(r.w) || 0,
            cmd: r.c || '',
          });
        }
        resolve(map);
      }
    );
  });
}

/**
 * Which PID is listening on which TCP port.
 * A hard-killed server leaves orphans whose recorded PID (the cmd.exe wrapper)
 * is gone while the real server keeps holding its port — the port is then the
 * only reliable way to find it again.
 *
 * @returns {Promise<Map<number, number>>} port -> pid
 */
export function findListeningPids({ timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano', '-p', 'TCP'], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        const map = new Map();
        if (err || !stdout) {
          resolve(map);
          return;
        }
        for (const line of stdout.split('\n')) {
          // "  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234"
          const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
          if (!m) continue;
          const port = parseInt(m[1], 10);
          const pid = parseInt(m[2], 10);
          if (!map.has(port)) map.set(port, pid);
        }
        resolve(map);
      }
    );
  });
}

/**
 * Cheap liveness check. EPERM means the PID exists but belongs to someone else.
 */
export function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * All PIDs in the tree rooted at rootPid (inclusive), from a snapshot.
 */
export function collectTree(rootPid, snapshot) {
  const children = new Map(); // ppid -> pid[]
  for (const proc of snapshot.values()) {
    if (!children.has(proc.ppid)) children.set(proc.ppid, []);
    children.get(proc.ppid).push(proc.pid);
  }

  const tree = [];
  const seen = new Set();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (seen.has(pid)) continue; // guards against cycles from PID reuse
    seen.add(pid);
    if (!snapshot.has(pid)) continue;
    tree.push(pid);
    for (const child of children.get(pid) || []) queue.push(child);
  }
  return tree;
}
