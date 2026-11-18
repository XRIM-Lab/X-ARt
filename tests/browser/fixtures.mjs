import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageRoots = [
  { prefix: '/npm/three@0.174.0/', root: path.join(repoRoot, 'node_modules/three') },
  { prefix: '/npm/bootstrap@5.3.3/', root: path.join(repoRoot, 'node_modules/bootstrap') }
];

function contains(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function blockExternalAndServePackages(page) {
  const externalRequests = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' ||
      (url.hostname === '127.0.0.1' && url.port === '4173')) {
      await route.continue();
      return;
    }

    if (url.hostname === 'fonts.googleapis.com') {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      return;
    }

    const packageRoot = packageRoots.find(packageInfo => url.pathname.startsWith(packageInfo.prefix));
    if (url.hostname === 'cdn.jsdelivr.net' && packageRoot) {
      const relative = decodeURIComponent(url.pathname.slice(packageRoot.prefix.length));
      const filePath = path.resolve(packageRoot.root, relative);
      if (!contains(packageRoot.root, filePath)) {
        await route.abort('blockedbyclient');
        return;
      }
      const headers = { 'Access-Control-Allow-Origin': '*' };
      if (filePath.endsWith('.wasm')) headers['Content-Type'] = 'application/wasm';
      await route.fulfill({ path: filePath, headers });
      return;
    }

    externalRequests.push(url.href);
    await route.abort('blockedbyclient');
  });
  return { externalRequests };
}

export function pageUrl(pathname) {
  return `http://127.0.0.1:4173${pathname}`;
}
