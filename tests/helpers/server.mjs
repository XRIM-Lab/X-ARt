import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const vendorRoot = await realpath(path.join(repoRoot, 'node_modules'));
const roots = [repoRoot, vendorRoot];
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.frag', 'text/plain; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.vert', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveRequest(pathname) {
  const decoded = decodeURIComponent(pathname);
  const vendorPrefix = '/__test_vendor/';
  const base = decoded.startsWith(vendorPrefix) ? vendorRoot : repoRoot;
  const relative = decoded.startsWith(vendorPrefix) ? decoded.slice(vendorPrefix.length) : decoded.replace(/^\/+/, '');
  let candidate = path.resolve(base, relative || '.');
  if (!inside(base, candidate)) return null;
  try {
    let canonical = await realpath(candidate);
    if (!roots.some(root => inside(root, canonical))) return null;
    if ((await stat(canonical)).isDirectory()) canonical = await realpath(path.join(canonical, 'index.html'));
    if (!roots.some(root => inside(root, canonical)) || !(await stat(canonical)).isFile()) return null;
    return canonical;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (request.url === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  let pathname;
  try {
    pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  } catch {
    response.writeHead(400).end();
    return;
  }
  let filePath;
  try {
    filePath = await resolveRequest(pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (!filePath) {
    response.writeHead(404).end();
    return;
  }
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': mimeTypes.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff'
  };
  if (request.method === 'HEAD') {
    response.writeHead(200, headers).end();
    return;
  }
  response.writeHead(200, headers);
  createReadStream(filePath).pipe(response);
});

const requestedPort = Number(process.env.PORT ?? process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 4173);
server.listen(requestedPort, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`Local test server listening on http://127.0.0.1:${address.port}/\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
