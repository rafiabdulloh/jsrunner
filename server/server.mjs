#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import { createRouter } from './router.mjs';
import { serveStatic } from './static.mjs';
import { registerProjectRoutes } from '../api/projects.mjs';
import * as processManager from '../utils/process.mjs';
import * as logger from '../utils/logger.mjs';
import { registerLogRoutes } from '../api/logs.mjs';
import * as config from '../utils/config.mjs';
import { registerControlRoutes } from '../api/control.mjs';
import { registerScriptRoutes } from '../api/script.mjs';
import { registerPortRoutes } from '../api/port.mjs';
import { registerPathRoutes } from '../api/path.mjs';
import { registerGroupRoutes } from '../api/group.mjs';

// ---------------------------------------------------------------------------
// CLI argument parsing (falls back to env, then defaults)
// ---------------------------------------------------------------------------
const USAGE = `jsrunner — local multi-project dev dashboard

Usage:
  jsrunner [options]
  jsr [options]
  npm start [-- --help]

Options:
  --port <n>       HTTP port                  (default: 9999, env PORT)
  --host <addr>    Bind address               (default: localhost, env HOST;
                   use 0.0.0.0 to expose on the LAN — the tool has NO auth)
  --workdir <dir>  Where config/projects.json lives (default: cwd, env WORKDIR)
  --version, -v    Print version and exit
  --help, -h       Show this help and exit

Examples:
  jsrunner                        Start on http://localhost:9999
  jsrunner --port 9876            Start on http://localhost:9876
  jsrunner --host 0.0.0.0         Expose to local network (no auth — be careful)
`;

function printHelp() {
  console.log(USAGE);
}

function readPackage() {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
  } catch {
    return { name: 'jsrunner', version: '0.0.0-dev' };
  }
}

const pkg = readPackage();

// Self-update notice: user-installed copies get a heads-up when a new
// version lands on npm. Read-only, never blocks startup, silent offline.
async function checkForUpdate() {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return;
    const { version } = await res.json();
    if (version && version !== pkg.version) {
      console.log(`\n⬆  Update tersedia: ${pkg.name}@${version} (terpasang: ${pkg.version})`);
      console.log(`   Jalankan: npm install -g ${pkg.name}@latest\n`);
    }
  } catch {
    // Offline or registry hiccup — skip silently.
  }
}

const opts = {
  port: parseInt(process.env.PORT, 10) || 9999,
  host: process.env.HOST || 'localhost',
  workdir: process.env.WORKDIR || process.cwd(),
};

{
  const args = process.argv.slice(2);
  const next = () => args.shift();
  while (args.length) {
    const a = next();
    switch (a) {
      case '--help': case '-h': printHelp(); process.exit(0); break;
      case '--version': case '-v': console.log(pkg.version); process.exit(0); break;
      case '--port': opts.port = parseInt(next(), 10) || 9999; break;
      case '--host': opts.host = next() || 'localhost'; break;
      case '--workdir': opts.workdir = next() || process.cwd(); break;
      default:
        console.error(`Unknown option: ${a}\n\n${USAGE}`);
        process.exit(1);
    }
  }
}

const PORT = opts.port;
const WORKDIR = opts.workdir;
config.setBase(WORKDIR);

// Static files ship inside the package (repo root in dev, node_modules when
// installed globally). Config stays in WORKDIR so users keep a writable copy.
// ponytail: single-file bundle (pkg/nexe) can't serve public/ from disk —
// embed it as an assets map when that mode is needed.
const PKG_ROOT = fileURLToPath(new URL('../', import.meta.url));

const router = createRouter();
const staticHandler = serveStatic(PKG_ROOT);

registerProjectRoutes(router, processManager);
logger.initLogger(processManager);
registerLogRoutes(router, config, logger);
registerControlRoutes(router, config, processManager);
registerScriptRoutes(router, config, processManager);
registerPortRoutes(router);
registerPathRoutes(router);
registerGroupRoutes(router, config);

const server = http.createServer(async (req, res) => {
  try {
    // Try API routes first; if none matched, fall through to static file serving
    const matched = router.match(req, res);
    if (!matched) {
      await staticHandler(req, res);
    }
  } catch (err) {
    console.error('Request handler error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

server.listen(PORT, opts.host, () => {
  console.log(`Server listening on http://${opts.host}:${PORT}`);
  checkForUpdate();
});

// Kill all child processes on shutdown
function shutdown(signal) {
  console.log(`\n${signal} received — stopping all processes...`);
  processManager.stopAll();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Windows: Ctrl+C sends SIGINT

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exitCode = 1;
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exitCode = 1;
});
