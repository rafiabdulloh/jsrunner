import fs from 'fs';
import path from 'path';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * @param {string} projectRoot - absolute path to the project root
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void>}
 */
export function serveStatic(projectRoot) {
  const publicDir = path.resolve(projectRoot, 'public');

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let pathname = url.pathname;

    if (pathname === '/') pathname = '/index.html';

    // Resolve requested path inside publicDir
    const relativePath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const filePath = path.resolve(publicDir, relativePath);

    // Path traversal guard
    if (!filePath.startsWith(publicDir + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // Try to serve the file
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on('error', () => {
          res.writeHead(500);
          res.end();
        });
        return;
      }
    } catch {
      // File not found — fall through to SPA / 404 logic
    }

    // SPA fallback: non-API paths serve index.html
    if (!pathname.startsWith('/api/')) {
      const indexPath = path.resolve(publicDir, 'index.html');
      try {
        const stat = await fs.promises.stat(indexPath);
        if (stat.isFile()) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          const stream = fs.createReadStream(indexPath);
          stream.pipe(res);
          stream.on('error', () => {
            res.writeHead(500);
            res.end();
          });
          return;
        }
      } catch {
        // index.html missing — fall through to 404
      }
    }

    // API path with no matching file → JSON 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}
