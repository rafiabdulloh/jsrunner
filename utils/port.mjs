import net from 'net';
import fs from 'fs';
import path from 'path';

/**
 * Search project files in priority order for a port setting.
 * Skips .env files entirely (read-only per BRD).
 * @param {string} projectFolder
 * @returns {{ file: string, port: number } | null}
 */
export function detectPortConfig(projectFolder) {
  const checks = [
    // vite.config
    ['vite.config.js', content => {
      const m = content.match(/port\s*:\s*(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }],
    ['vite.config.ts', content => {
      const m = content.match(/port\s*:\s*(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }],
    // next.config
    ['next.config.js', content => {
      const m = content.match(/port\s*:\s*(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }],
    ['next.config.mjs', content => {
      const m = content.match(/port\s*:\s*(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }],
    // package.json scripts
    ['package.json', content => {
      let obj;
      try { obj = JSON.parse(content); } catch { return null; }
      const scripts = obj.scripts || {};
      const allScripts = Object.values(scripts).join(' ');
      const m = allScripts.match(/--port\s+(\d+)|-p\s+(\d+)|\bPORT=(\d+)/);
      const port = m ? parseInt(m[1] || m[2] || m[3], 10) : null;
      return port && !isNaN(port) ? port : null;
    }],
    // angular.json
    ['angular.json', content => {
      const m = content.match(/"port"\s*:\s*(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }],
    // nest-cli.json
    ['nest-cli.json', content => {
      const m = content.match(/"port"\s*:\s*(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }],
  ];

  for (const [filename, extract] of checks) {
    const filePath = path.join(projectFolder, filename);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const port = extract(content);
        if (port !== null && !isNaN(port)) {
          return { file: filename, port };
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return null;
}

/**
 * Rewrite port value in a config file based on file type.
 * Preserves exact whitespace/formatting.
 * @param {string} projectFolder
 * @param {string} configFile - relative path
 * @param {number} newPort
 * @returns {boolean}
 */
export function rewritePort(projectFolder, configFile, newPort) {
  const filePath = path.join(projectFolder, configFile);
  try {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf-8');

    let updated;
    const name = path.basename(configFile);

    if (name === 'vite.config.js' || name === 'vite.config.ts' ||
        name === 'next.config.js' || name === 'next.config.mjs') {
      // port: <number> or port:<number>
      updated = content.replace(/(port\s*:\s*)\d+/g, (match, prefix) => `${prefix}${newPort}`);

    } else if (name === 'package.json') {
      // --port <num>, -p <num>, or PORT=<num> in script values
      updated = content
        .replace(/((?:--port|-p)\s+)\d+/g, (match, prefix) => `${prefix}${newPort}`)
        .replace(/(\bPORT=)\d+/g, (match, prefix) => `${prefix}${newPort}`);

    } else if (name === 'angular.json' || name === 'nest-cli.json') {
      // "port": <number>
      updated = content.replace(/("port"\s*:\s*)\d+/g, (match, prefix) => `${prefix}${newPort}`);

    } else {
      return false;
    }

    if (updated === content) return false;
    fs.writeFileSync(filePath, updated, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate port is an integer between 1 and 65535.
 * @param {*} port
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validatePort(port) {
  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    return { valid: true };
  }
  return { valid: false, error: 'Port must be between 1 and 65535' };
}

/**
 * Check if a port is available (not in use).
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}
