import { spawn } from 'node:child_process';
import path from 'node:path';

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

// Escape single quotes for embedding a path inside a quoted shell command.
const shq = (s) => s.replace(/'/g, "''");

export function registerShellRoutes(router, config) {
  // POST /api/project/:id/terminal
  router.post('/api/project/:id/terminal', (req, res, ctx) => {
    const { id } = ctx.params;
    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }

    const folder = project.folder || path.dirname(project.path);

    try {
      let proc;
      if (process.platform === 'win32') {
        // `start` opens a VISIBLE console window; spawning powershell directly
        // with detached+stdio:'ignore' yields a hidden background process.
        proc = spawn('cmd', ['/c', 'start', 'powershell', '-NoExit', '-Command', `cd '${shq(folder)}'`], {
          detached: true,
          stdio: 'ignore',
        });
      } else if (process.platform === 'darwin') {
        proc = spawn('osascript', ['-e', `tell app "Terminal" to do script "cd '${shq(folder)}'"`], {
          detached: true,
          stdio: 'ignore',
        });
      } else {
        // Linux: prefer gnome-terminal, fall back to xterm.
        proc = spawn('gnome-terminal', ['--working-directory=' + folder], {
          detached: true,
          stdio: 'ignore',
        });
        proc.on('error', () => {
          const alt = spawn('xterm', ['-e', `cd '${shq(folder)}' && exec $SHELL`], {
            detached: true,
            stdio: 'ignore',
          });
          alt.unref();
        });
      }
      proc.unref();
      sendJSON(res, 200, { ok: true });
    } catch {
      sendJSON(res, 500, { error: 'Failed to open terminal' });
    }
  });

  // POST /api/project/:id/open
  router.post('/api/project/:id/open', (req, res, ctx) => {
    const { id } = ctx.params;
    const project = config.getProject(id);
    if (!project) {
      sendJSON(res, 404, { error: 'Project not found' });
      return;
    }
    if (!project.port) {
      sendJSON(res, 400, { error: 'No port configured' });
      return;
    }

    const url = `http://localhost:${project.port}`;

    try {
      let proc;
      if (process.platform === 'win32') {
        proc = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
      } else if (process.platform === 'darwin') {
        proc = spawn('open', [url], { detached: true, stdio: 'ignore' });
      } else {
        proc = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
      }
      proc.unref();
      sendJSON(res, 200, { ok: true });
    } catch {
      sendJSON(res, 500, { error: 'Failed to open browser' });
    }
  });
}
