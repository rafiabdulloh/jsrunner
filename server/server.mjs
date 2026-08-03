import http from 'http';
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
import { registerWorkspaceRoutes } from '../api/workspace.mjs';
import { registerEventRoutes } from '../api/events.mjs';
import { registerProfileRoutes } from '../api/profiles.mjs';
import * as supervisor from '../utils/supervisor.mjs';
import { startMetricsCollection } from '../utils/metrics.mjs';

const PORT = parseInt(process.env.PORT, 10) || 3000;
const WORKDIR = process.env.WORKDIR || process.cwd();

const router = createRouter();
const staticHandler = serveStatic(WORKDIR);

logger.initLogger(processManager);
supervisor.initSupervisor({ config, processManager, logger });

registerProjectRoutes(router, supervisor);
registerLogRoutes(router, config, logger);
registerControlRoutes(router, config, processManager, supervisor);
registerScriptRoutes(router, config, processManager);
registerPortRoutes(router);
registerPathRoutes(router);
registerGroupRoutes(router, config);
registerWorkspaceRoutes(router);
registerEventRoutes(router, { supervisor, logger });
registerProfileRoutes(router, config, supervisor, processManager);

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

// Live CPU/memory for running projects (in memory — never written to config)
startMetricsCollection(processManager, (id, m) => supervisor.setMetrics(id, m));
// TCP readiness probes: "process spawned" vs "server actually listening"
supervisor.startHealthChecks();

server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);

  // Re-attach to services left running by a previous run of this server
  try {
    const { adopted, cleared } = await supervisor.adoptOrphans();
    for (const p of adopted) {
      console.log(`Re-attached to "${p.name}" (PID ${p.adoptedPid}, matched by ${p.via})`);
    }
    for (const p of cleared) {
      console.log(`Marked "${p.name}" as stopped — its process is gone`);
    }
  } catch (err) {
    console.error('Orphan adoption failed:', err.message);
  }
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
