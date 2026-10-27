import http from 'node:http';
import { readFile, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.md', 'text/plain; charset=utf-8'],
  ['.fixture', 'text/plain; charset=utf-8']
]);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function createStaticServer(root = PROJECT_ROOT) {
  const absoluteRoot = path.resolve(root);
  return http.createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', CSP);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Cache-Control', 'no-store');
    const finish = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return finish(405, 'Method not allowed.');
    }
    try {
      const raw = (request.url ?? '/').split('?')[0];
      const decoded = decodeURIComponent(raw);
      if (!decoded.startsWith('/') || /[\\\u0000]/u.test(decoded)) return finish(400, 'Invalid path.');
      const segments = decoded.split('/');
      if (segments.some(segment => segment === '..' || segment === '.')) return finish(403, 'Forbidden.');
      const route = decoded === '/' ? '/index.html' : decoded;
      if (!(route === '/index.html' || route === '/styles.css' || route === '/favicon.svg'
          || /^\/(?:src|docs|examples)\//u.test(route))) return finish(404, 'Not found.');
      const target = path.resolve(absoluteRoot, `.${route}`);
      if (!target.startsWith(absoluteRoot + path.sep)) return finish(403, 'Forbidden.');
      // No link in a served path may escape the small public tree.
      let inspected = absoluteRoot;
      for (const segment of path.relative(absoluteRoot, target).split(path.sep)) {
        inspected = path.join(inspected, segment);
        if ((await lstat(inspected)).isSymbolicLink()) return finish(403, 'Forbidden.');
      }
      const mime = TYPES.get(path.extname(target));
      if (!mime || !(await stat(target)).isFile()) return finish(404, 'Not found.');
      const content = await readFile(target);
      response.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error instanceof URIError) return finish(400, 'Invalid path.');
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return finish(404, 'Not found.');
      finish(500, 'Unable to read this local file.');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some(argument => argument !== '--dist')) {
    console.error('Usage: node scripts/server.mjs [--dist]');
    process.exitCode = 1;
  } else {
    const portText = process.env.PORT ?? '4173';
    if (!/^\d+$/u.test(portText) || Number(portText) > 65535) {
      console.error('PORT must be an integer from 0 to 65535.');
      process.exitCode = 1;
    } else {
      const root = arguments_.includes('--dist') ? path.join(PROJECT_ROOT, 'dist') : PROJECT_ROOT;
      const server = createStaticServer(root);
      server.on('error', error => {
        console.error(`Local server: ${error.message}`);
        process.exitCode = 1;
      });
      server.listen(Number(portText), '127.0.0.1', () => {
        console.log(`FixtureLang is local at http://127.0.0.1:${server.address().port}`);
      });
    }
  }
}
