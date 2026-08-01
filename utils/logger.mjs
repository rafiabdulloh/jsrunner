const MAX_LINES = 500;

const buffers = new Map();

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

export function pushLog(id, text, err, script) {
  const entry = normalize(text, err);
  const key = `${id}:${script || ''}`;
  let buf = buffers.get(key);
  if (!buf) {
    buf = [];
    buffers.set(key, buf);
  }
  buf.push(entry);
  if (buf.length > MAX_LINES) {
    buf.splice(0, buf.length - MAX_LINES);
  }
}

function mergedLines(keys) {
  const lines = [];
  for (const k of keys) {
    const buf = buffers.get(k);
    if (buf) lines.push(...buf);
  }
  lines.sort((a, b) => a.ts - b.ts);
  return lines;
}

export function getLogs(id, after = 0, script) {
  if (script) {
    // Per-script buffer, falling back to the general key when the process
    // layer doesn't tag logs with a script (logCallback sends (id, text, err)).
    const buf = buffers.get(`${id}:${script}`) || buffers.get(`${id}:`);
    if (!buf) return { total: 0, lines: [] };
    return { total: buf.length, lines: buf.slice(after) };
  }
  const prefix = `${id}:`;
  const keys = [...buffers.keys()].filter((k) => k.startsWith(prefix)).sort();
  const lines = mergedLines(keys);
  return { total: lines.length, lines: lines.slice(after) };
}

function deletePrefix(prefix) {
  for (const k of [...buffers.keys()]) {
    if (k.startsWith(prefix)) buffers.delete(k);
  }
}

export function clearLogs(id, script) {
  if (script) buffers.delete(`${id}:${script}`);
  else deletePrefix(`${id}:`);
}

export function removeLogs(id) {
  deletePrefix(`${id}:`);
}
