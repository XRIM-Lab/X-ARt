import { expect, test } from '@playwright/test';
import { blockExternalAndServePackages, pageUrl } from './fixtures.mjs';

const pages = [
  {
    name: 'home',
    path: '/',
    desktopModel: 'mesh_test.glb',
    mobileModel: 'mesh_test.mobile.glb',
    splash: true,
    shader: true,
    heading: 'About artrio'
  },
  {
    name: 'tty2',
    path: '/TTY2/',
    desktopModel: '400kArtworkonly_glb.glb',
    mobileModel: '400kArtworkonly_mobile.glb',
    splash: true,
    shader: false,
    heading: 'About this Project'
  },
  {
    name: 'efv',
    path: '/EFV/',
    desktopModel: 'writing.glb',
    mobileModel: 'writing.glb',
    splash: false,
    shader: true,
    heading: 'About Performance'
  }
];

async function instrumentWebGL(page) {
  await page.addInitScript(() => {
    window.__webglDiagnostics = { drawCalls: 0, shaderErrors: [], programErrors: [] };
    const prototype = window.WebGL2RenderingContext?.prototype;
    if (!prototype) return;
    for (const name of ['drawArrays', 'drawElements', 'drawRangeElements']) {
      const original = prototype[name];
      if (!original) continue;
      prototype[name] = function (...args) {
        window.__webglDiagnostics.drawCalls++;
        return original.apply(this, args);
      };
    }
    const compileShader = prototype.compileShader;
    const getShaderParameter = prototype.getShaderParameter;
    const getShaderInfoLog = prototype.getShaderInfoLog;
    prototype.compileShader = function (shader) {
      const result = compileShader.call(this, shader);
      if (!getShaderParameter.call(this, shader, this.COMPILE_STATUS)) {
        window.__webglDiagnostics.shaderErrors.push(getShaderInfoLog.call(this, shader));
      }
      return result;
    };
    const linkProgram = prototype.linkProgram;
    const getProgramParameter = prototype.getProgramParameter;
    const getProgramInfoLog = prototype.getProgramInfoLog;
    prototype.linkProgram = function (program) {
      const result = linkProgram.call(this, program);
      if (!getProgramParameter.call(this, program, this.LINK_STATUS)) {
        window.__webglDiagnostics.programErrors.push(getProgramInfoLog.call(this, program));
      }
      return result;
    };
  });
}

for (const entry of pages) {
  test(`${entry.name} loads its responsive GLB and performs real WebGL rendering`, async ({ page }, testInfo) => {
    await blockExternalAndServePackages(page);
    await instrumentWebGL(page);
    const errors = [];
    const modelRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', request => {
      if (new URL(request.url()).pathname.endsWith('.glb')) modelRequests.push(new URL(request.url()).pathname);
    });
    const isMobile = testInfo.project.name === 'mobile-chromium';
    const model = isMobile ? entry.mobileModel : entry.desktopModel;
    const modelRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith(`/${model}`));
    await page.goto(pageUrl(entry.path), { waitUntil: 'domcontentloaded' });
    await modelRequest;
    await expect(page.locator('#bgViewer canvas')).toBeVisible();
    if (entry.splash) await expect(page.locator('#loadingScreen')).toBeHidden();
    await page.waitForFunction(() => window.__webglDiagnostics?.drawCalls > 0, null, { timeout: 30000 });

    const result = await page.locator('#bgViewer canvas').evaluate(canvas => {
      const gl = canvas.getContext('webgl2');
      const rect = canvas.getBoundingClientRect();
      return {
        width: canvas.width,
        height: canvas.height,
        rectWidth: rect.width,
        rectHeight: rect.height,
        hasWebGL2: Boolean(gl),
        version: gl?.getParameter(gl.VERSION),
        drawCalls: window.__webglDiagnostics.drawCalls,
        shaderErrors: window.__webglDiagnostics.shaderErrors,
        programErrors: window.__webglDiagnostics.programErrors
      };
    });
    expect(result.hasWebGL2).toBe(true);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.rectWidth).toBeGreaterThan(0);
    expect(result.rectHeight).toBeGreaterThan(0);
    expect(result.drawCalls).toBeGreaterThan(0);
    expect(result.shaderErrors).toEqual([]);
    expect(result.programErrors).toEqual([]);
    expect(modelRequests.some(pathname => pathname.endsWith(`/${model}`))).toBe(true);
    expect(errors).toEqual([]);
    if (entry.shader) {
      await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource')
        .filter(entry => /Fire2\.(?:vert|frag)$/.test(entry.name)).length)).toBeGreaterThanOrEqual(2);
    }
    await testInfo.attach(`${entry.name}-${testInfo.project.name}`, {
      body: await page.screenshot(),
      contentType: 'image/png'
    });
  });
}

test('model request failure leaves page content usable and releases splashes where present', async ({ page }, testInfo) => {
  await blockExternalAndServePackages(page);
  const entry = testInfo.project.name === 'mobile-chromium' ? pages[0] : pages[2];
  await page.route(`**/${entry.mobileModel === entry.desktopModel ? entry.mobileModel : testInfo.project.name === 'mobile-chromium' ? entry.mobileModel : entry.desktopModel}`, route => route.abort());
  await page.goto(pageUrl(entry.path));
  if (entry.splash) await expect(page.locator('#loadingScreen')).toBeHidden();
  await expect(page.getByRole('heading', { name: entry.name === 'home' ? 'About artrio' : 'About Performance' })).toBeVisible();
  await expect(page.getByRole('link', { name: entry.name === 'home' ? 'EQUUS: FORM + VOID' : 'Henry Ho' })).toBeVisible();
});
