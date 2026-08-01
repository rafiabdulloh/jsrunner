#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
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
  --host <addr>    Bind address               (default: 127.0.0.1, env HOST;
                   use 0.0.0.0 to expose on the LAN — the tool has NO auth)
  --workdir <dir>  Root for static files + config/projects.json
                                              (default: cwd, env WORKDIR)
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

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0-dev';
  }
}

const opts = {
  port: parseInt(process.env.PORT, 10) || 9999,
  host: process.env.HOST || '127.0.0.1',
  workdir: process.env.WORKDIR || process.cwd(),
};

{
  const args = process.argv.slice(2);
  const next = () => args.shift();
  while (args.length) {
    const a = next();
    switch (a) {
      case '--help': case '-h': printHelp(); process.exit(0); break;
      case '--version': case '-v': console.log(readVersion()); process.exit(0); break;
      case '--port': opts.port = parseInt(next(), 10) || 9999; break;
      case '--host': opts.host = next() || '127.0.0.1'; break;
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

const router = createRouter();
const staticHandler = serveStatic(WORKDIR);

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
