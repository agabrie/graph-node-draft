/* server.mjs — tiny static dev server for the repo.
 *
 * ES modules do not load over file://, so both the new demo (demo/) and the
 * old example spike (example/) need an HTTP origin. No dependencies:
 *   npm start  →  http://localhost:8080/        (demo/, against lib/)
 *                 http://localhost:8080/example/example.html  (old spike)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('./', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'); // strip the leading slash Windows paths get
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mmd': 'text/plain; charset=utf-8'
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') {
    // A real redirect, not an internal rewrite: the browser's base URL must
    // become /demo/ so the page's relative script src="app.js" resolves to
    // /demo/app.js instead of /app.js.
    res.writeHead(302, { Location: '/demo/index.html' }).end();
    return;
  }
  const rel = path.slice(1);
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found: ' + rel);
  }
}).listen(PORT, () => {
  console.log('demo running at http://localhost:' + PORT + '/');
  console.log('old example spike at http://localhost:' + PORT + '/example/example.html');
});
