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

export function pushLog(id, text, err) {
  const entry = normalize(text, err);
  let buf = buffers.get(id);
  if (!buf) {
    buf = [];
    buffers.set(id, buf);
  }
  buf.push(entry);
  if (buf.length > MAX_LINES) {
    buf.splice(0, buf.length - MAX_LINES);
  }
}

export function getLogs(id, after = 0) {
  const buf = buffers.get(id);
  if (!buf) return { total: 0, lines: [] };
  return { total: buf.length, lines: buf.slice(after) };
}

export function clearLogs(id) {
  buffers.delete(id);
}

export function removeLogs(id) {
  buffers.delete(id);
}
