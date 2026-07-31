import { exec } from 'child_process';

// Previous WMIC samples: pid -> { cpuTicks, workingSet, timestamp }
const prevSamples = new Map();

/**
 * Query WMIC for process counters.
 * Returns null if process gone or WMIC fails.
 */
function queryWmic(pid) {
  const cmd =
    `wmic path Win32_PerfRawData_PerfProc_Process where IDProcess=${pid} ` +
    `get PercentProcessorTime,WorkingSet,Timestamp_Sys100NS /format:csv`;

  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err) { resolve(null); return; }

      const lines = stdout.trim().split('\n');
      if (lines.length < 2) { resolve(null); return; }

      // Second line is data; first is CSV header
      const fields = lines[1].trim().split(',');
      if (fields.length < 4) { resolve(null); return; }

      try {
        resolve({
          cpuTicks: BigInt(fields[1].trim()),
          workingSet: BigInt(fields[2].trim()),
          timestamp: BigInt(fields[3].trim()),
        });
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Get CPU% (1 decimal string) and memory MB (integer string) for a PID.
 * Two-sample delta: first call stores baseline, returns zeros.
 * On error: returns zeros.
 *
 * @param {number} pid
 * @returns {Promise<{ cpu: string, mem: string }>}
 */
export async function getProcessMetrics(pid) {
  const sample = await queryWmic(pid);
  if (!sample) {
    return { cpu: '0.0', mem: '0' };
  }

  const prev = prevSamples.get(pid);
  prevSamples.set(pid, sample);

  if (!prev) {
    // Baseline sample only — no delta yet
    return { cpu: '0.0', mem: '0' };
  }

  const deltaCpu = Number(sample.cpuTicks - prev.cpuTicks);
  const deltaTs  = Number(sample.timestamp - prev.timestamp);

  if (deltaTs <= 0) {
    return { cpu: '0.0', mem: '0' };
  }

  const cpuPct = (deltaCpu / deltaTs) * 100;
  const memMB  = Number(sample.workingSet) / (1024 * 1024);

  return {
    cpu: cpuPct.toFixed(1),
    mem: Math.round(memMB).toString(),
  };
}

/**
 * Poll running processes every 3 s and collect metrics.
 *
 * @param {object} processManager - must expose getRunningProjects()
 * @param {function} [onUpdate] - called as onUpdate(id, { cpu, mem })
 * @returns {{ stop: () => void }}
 */
export function startMetricsCollection(processManager, onUpdate) {
  const timer = setInterval(async () => {
    try {
      const projects = processManager.getRunningProjects();
      for (const p of projects) {
        const metrics = await getProcessMetrics(p.pid);
        if (onUpdate) onUpdate(p.id, metrics);
      }
    } catch {
      // Swallow — don't crash polling loop
    }
  }, 3000);

  return { stop: () => clearInterval(timer) };
}

/**
 * Return a copy of `project` with cpu/mem fields added.
 *
 * @param {object} project
 * @param {number} pid
 * @returns {Promise<object>}
 */
export async function addMetricsToProject(project, pid) {
  const { cpu, mem } = await getProcessMetrics(pid);
  return { ...project, cpu, mem };
}

/**
 * Convenience — return CPU% string for a PID.
 * @param {number} pid
 * @returns {Promise<string>}
 */
export async function getCpu(pid) {
  const m = await getProcessMetrics(pid);
  return m.cpu;
}

/**
 * Convenience — return memory string for a PID.
 * @param {number} pid
 * @returns {Promise<string>}
 */
export async function getMem(pid) {
  const m = await getProcessMetrics(pid);
  return m.mem;
}
