/* server.mjs — tiny static dev server for the example page.
 *
 * ES modules do not load over file://, so the demo needs an HTTP origin.
 * No dependencies:  npm start  →  http://localhost:8080
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('./example/', import.meta.url).pathname
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
  const rel = path === '/' ? 'example.html' : path.slice(1);
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
  console.log('example running at http://localhost:' + PORT + '/');
});
