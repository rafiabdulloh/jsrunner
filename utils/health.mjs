// TCP readiness probes. "Process alive" and "server accepting connections" are
// different things — a dev server needs seconds to compile before it listens,
// and dependency ordering needs to wait for the real thing.
import net from 'net';

/**
 * Can we open a TCP connection to this port?
 * @returns {Promise<boolean>}
 */
export function probePort(port, { host = '127.0.0.1', timeout = 900 } = {}) {
  return new Promise((resolve) => {
    if (!port) {
      resolve(false);
      return;
    }

    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/**
 * Wait until a port accepts connections.
 *
 * @param {number} port
 * @param {{timeoutMs?: number, intervalMs?: number, signal?: () => boolean}} [options]
 *        signal() returning false aborts the wait (e.g. the process died)
 * @returns {Promise<boolean>} true when ready, false on timeout/abort
 */
export async function waitForPort(port, { timeoutMs = 60_000, intervalMs = 700, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal && !signal()) return false;
    if (await probePort(port)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Is this port free to bind? Used as a pre-flight check before starting.
 */
export function isPortFree(port) {
  return new Promise((resolve) => {
    if (!port) {
      resolve(true);
      return;
    }
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}
