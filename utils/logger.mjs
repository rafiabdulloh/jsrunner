import fs from 'fs';
import path from 'path';

const MAX_LINES = 500;
// Disk history so output survives a server restart (the in-memory ring buffer does not)
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const HYDRATE_BYTES = 256 * 1024;

const BASE = process.env.WORKDIR || process.cwd();
const LOG_DIR = path.join(BASE, 'logs');

const buffers = new Map();
const hydrated = new Set();
const listeners = new Set();

function normalize(text, err) {
  if (typeof text === 'object' && text !== null) {
    return { text: text.text, err: !!text.err, ts: Date.now() };
  }
  return { text: String(text), err: !!err, ts: Date.now() };
}

export function initLogger(processManager) {
  processManager.setLogCallback((id, text, err) => {
    pushLog(id, text, err);
  });
}

/**
 * Subscribe to log writes — used by the SSE stream to notify clients.
 * fn: (id, entry) => void
 * @returns {() => void} unsubscribe
 */
export function onLog(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function logFile(id) {
  return path.join(LOG_DIR, `${id}.log`);
}

function appendToDisk(id, entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = logFile(id);

    // Rotate before the file grows unbounded; one generation of history is plenty
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      // no file yet
    }

    // One disk line per log line: a stdout chunk can carry several newlines,
    // and hydration has to read back exactly what was written.
    const prefix = entry.err ? '! ' : '  ';
    const body = entry.text
      .replace(/\r?\n$/, '')
      .split(/\r?\n/)
      .map((line) => prefix + line)
      .join('\n');
    fs.appendFileSync(file, body + '\n', 'utf-8');
  } catch {
    // Logging must never break the process it is logging for
  }
}

/**
 * Read the tail of a project's log file into the buffer, so opening the panel
 * after a server restart is not empty. Only ever runs when this session has
 * produced no output for the project — otherwise it would duplicate lines that
 * are already in the buffer.
 */
function hydrateFromDisk(id) {
  if (hydrated.has(id)) return;
  hydrated.add(id);
  if (buffers.has(id)) return;

  try {
    const file = logFile(id);
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - HYDRATE_BYTES);
    const fd = fs.openSync(file, 'r');
    const length = stat.size - start;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    fs.closeSync(fd);

    const lines = buf.toString('utf-8').split('\n');
    if (start > 0) lines.shift(); // drop the partial first line

    const entries = lines
      .filter((l) => l.length > 0)
      .slice(-MAX_LINES)
      .map((l) => ({ text: l.slice(2), err: l.startsWith('! '), ts: null, history: true }));

    if (entries.length === 0) return;

    entries.push({ text: '——— end of saved log (previous run) ———', err: false, ts: null, history: true });
    buffers.set(id, entries.slice(-MAX_LINES));
  } catch {
    // no history for this project
  }
}

export function pushLog(id, text, err) {
  const entry = normalize(text, err);
  let buf = buffers.get(id);
  if (!buf) {
    // Live output exists now, so disk history must not be pulled in later
    hydrateFromDisk(id);
    buf = buffers.get(id) || [];
    buffers.set(id, buf);
  }
  buf.push(entry);
  if (buf.length > MAX_LINES) {
    buf.splice(0, buf.length - MAX_LINES);
  }

  appendToDisk(id, entry);

  for (const fn of listeners) {
    try { fn(id, entry); } catch { /* a bad listener must not break logging */ }
  }
}

export function getLogs(id, after = 0) {
  hydrateFromDisk(id);
  const buf = buffers.get(id);
  if (!buf) return { total: 0, lines: [] };
  return { total: buf.length, lines: buf.slice(after) };
}

export function clearLogs(id) {
  buffers.delete(id);
  hydrated.add(id); // cleared on purpose — do not pull the file back in
  try {
    fs.rmSync(logFile(id), { force: true });
  } catch {
    // best effort
  }
}

export function removeLogs(id) {
  clearLogs(id);
  try {
    fs.rmSync(`${logFile(id)}.1`, { force: true });
  } catch {
    // best effort
  }
}
