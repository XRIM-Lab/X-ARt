import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { blockExternalAndServePackages, pageUrl } from './fixtures.mjs';

const screenshotDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-results');

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
    mobileModel: 'writing.mobile.glb',
    splash: true,
    shader: true,
    heading: 'About this Project'
  },
  {
    name: 'nmm',
    path: '/NMM/',
    desktopModel: 'NCB.glb',
    mobileModel: 'NCB.mobile.glb',
    splash: true,
    shader: false,
    heading: 'About this Series'
  }
];

const cslt = {
  name: 'CSLT',
  path: '/CSLT/',
  desktopCloud: 'shop.ply',
  mobileCloud: 'shop.mobile.ply',
  desktopCount: 220000,
  mobileCount: 80000,
  heading: 'About this Project'
};

async function instrumentWebGL(page, { capturePoints = false } = {}) {
  await page.addInitScript(capture => {
    window.__webglDiagnostics = { drawCalls: 0, shaderErrors: [], programErrors: [] };
    if (capture) window.__webglDiagnostics.pointDraws = [];
    const prototype = window.WebGL2RenderingContext?.prototype;
    if (!prototype) return;
    const countIndex = { drawArrays: 2, drawElements: 1, drawRangeElements: 3 };
    for (const name of ['drawArrays', 'drawElements', 'drawRangeElements']) {
      const original = prototype[name];
      if (!original) continue;
      prototype[name] = function (...args) {
        window.__webglDiagnostics.drawCalls++;
        if (capture && args[0] === this.POINTS) {
          const program = this.getParameter(this.CURRENT_PROGRAM);
          const projection = this.getUniformLocation(program, 'projectionMatrix');
          const modelView = this.getUniformLocation(program, 'modelViewMatrix');
          window.__webglDiagnostics.pointDraws.push({
            count: args[countIndex[name]],
            projection: projection ? Array.from(this.getUniform(program, projection)) : null,
            modelView: modelView ? Array.from(this.getUniform(program, modelView)) : null
          });
        }
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
  }, capturePoints);
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
  await expect(page.getByRole('heading', { name: entry.heading })).toBeVisible();
  await expect(page.getByRole('link', { name: entry.name === 'home' ? 'EQUUS: FORM + VOID' : 'Henry Ho' })).toBeVisible();
});

test('CSLT loads only its responsive PLY, draws real points, and pans along a curved zoom without turning', async ({ page }, testInfo) => {
  await blockExternalAndServePackages(page);
  await instrumentWebGL(page, { capturePoints: true });
  const isMobile = testInfo.project.name === 'mobile-chromium';
  const cloud = isMobile ? cslt.mobileCloud : cslt.desktopCloud;
  const pointCount = isMobile ? cslt.mobileCount : cslt.desktopCount;
  const errors = [];
  const plyRequests = [];
  const glbRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('.ply')) plyRequests.push(pathname);
    if (pathname.endsWith('.glb')) glbRequests.push(pathname);
  });
  const cloudRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith(`/${cloud}`));
  await page.goto(pageUrl(cslt.path), { waitUntil: 'domcontentloaded' });
  await cloudRequest;
  await expect(page.locator('#bgViewer canvas')).toBeVisible();
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await page.waitForFunction(count => window.__webglDiagnostics?.pointDraws?.some(draw => draw.count === count), pointCount, { timeout: 30000 });

  const opening = await page.evaluate(() => window.__webglDiagnostics.pointDraws.at(-1));
  expect(opening.count).toBe(pointCount);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const openingShot = path.join(screenshotDir, `CSLT-${testInfo.project.name}-opening.png`);
  await page.screenshot({ path: openingShot });
  await testInfo.attach(`CSLT-opening-${testInfo.project.name}`, { path: openingShot });

  await page.evaluate(() => document.getElementById('bgViewer').setProgress(0.5));
  await expect.poll(() => page.evaluate(target =>
    Math.abs((window.__webglDiagnostics.pointDraws.at(-1)?.projection?.[0] ?? 0) - target) < 1e-4,
    opening.projection[0] * 1.3)).toBe(true);
  const midpoint = await page.evaluate(() => window.__webglDiagnostics.pointDraws.at(-1));
  const midpointShot = path.join(screenshotDir, `CSLT-${testInfo.project.name}-midpoint.png`);
  await page.screenshot({ path: midpointShot });
  await testInfo.attach(`CSLT-midpoint-${testInfo.project.name}`, { path: midpointShot });

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(target =>
    Math.abs((window.__webglDiagnostics.pointDraws.at(-1)?.projection?.[0] ?? 0) - target) < 1e-4,
    opening.projection[0] * 1.6)).toBe(true);
  const end = await page.evaluate(() => window.__webglDiagnostics.pointDraws.at(-1));
  const zoomedShot = path.join(screenshotDir, `CSLT-${testInfo.project.name}-zoomed.png`);
  await page.screenshot({ path: zoomedShot });
  await testInfo.attach(`CSLT-zoomed-${testInfo.project.name}`, { path: zoomedShot });

  for (const draw of [midpoint, end]) {
    for (let i = 0; i < 12; i++) {
      expect(Math.abs(draw.modelView[i] - opening.modelView[i])).toBeLessThan(1e-5);
    }
    expect(Math.abs(draw.modelView[14] - opening.modelView[14])).toBeLessThan(1e-4);
  }
  expect(midpoint.modelView[12]).toBeLessThan(opening.modelView[12]);
  expect(midpoint.modelView[12]).toBeGreaterThan(end.modelView[12]);
  expect(end.modelView[12]).toBeLessThan(opening.modelView[12]);
  const meanY = (opening.modelView[13] + end.modelView[13]) / 2;
  expect(midpoint.modelView[13]).toBeLessThan(meanY - 1e-4);

  const viewport = page.viewportSize();
  const originalWidth = await page.locator('#bgViewer').evaluate(element => element.clientWidth);
  const resizedWidth = Math.max(320, Math.round(viewport.width * 0.7));
  await page.setViewportSize({ width: resizedWidth, height: viewport.height });
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  const resizedClientWidth = await page.locator('#bgViewer').evaluate(element => element.clientWidth);
  await expect.poll(() => page.evaluate(targets => {
    const draw = window.__webglDiagnostics.pointDraws.at(-1);
    return draw && Math.abs(draw.projection[0] - targets.p0) < 1e-4
      && Math.abs(draw.projection[5] - targets.p5) < 1e-4;
  }, { p0: end.projection[0] * originalWidth / resizedClientWidth, p5: opening.projection[5] * 1.6 })).toBe(true);
  const resizedEnd = await page.evaluate(() => window.__webglDiagnostics.pointDraws.at(-1));
  expect(plyRequests).toEqual([`/CSLT/pointcloud/${cloud}`]);
  expect(Math.abs(await page.locator('#bgViewer canvas').evaluate(canvas => canvas.getBoundingClientRect().width) - resizedWidth)).toBeLessThan(2);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(target =>
    Math.abs((window.__webglDiagnostics.pointDraws.at(-1)?.projection?.[5] ?? 0) - target) < 1e-4,
    opening.projection[5])).toBe(true);
  const resizedOpening = await page.evaluate(() => window.__webglDiagnostics.pointDraws.at(-1));
  expect(resizedEnd.modelView[12]).toBeLessThan(resizedOpening.modelView[12]);

  await page.setViewportSize(viewport);
  await expect.poll(() => page.evaluate(target =>
    Math.abs((window.__webglDiagnostics.pointDraws.at(-1)?.projection?.[0] ?? 0) - target) < 1e-4,
    opening.projection[0])).toBe(true);
  const restored = await page.evaluate(() => window.__webglDiagnostics.pointDraws.at(-1));
  for (let i = 0; i < 16; i++) {
    expect(Math.abs(restored.modelView[i] - opening.modelView[i])).toBeLessThan(1e-5);
  }

  const diagnostics = await page.evaluate(() => window.__webglDiagnostics);
  expect(diagnostics.shaderErrors).toEqual([]);
  expect(diagnostics.programErrors).toEqual([]);
  expect(plyRequests).toEqual([`/CSLT/pointcloud/${cloud}`]);
  expect(glbRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('CSLT reduced motion keeps the point cloud zoom and fade fixed', async ({ page }, testInfo) => {
  await blockExternalAndServePackages(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await instrumentWebGL(page, { capturePoints: true });
  const isMobile = testInfo.project.name === 'mobile-chromium';
  const pointCount = isMobile ? cslt.mobileCount : cslt.desktopCount;
  await page.goto(pageUrl(cslt.path), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await page.waitForFunction(count => window.__webglDiagnostics?.pointDraws?.some(draw => draw.count === count), pointCount, { timeout: 30000 });

  const resting = await page.evaluate(() => window.__webglDiagnostics.pointDraws.at(-1));
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const latest = await page.evaluate(() => window.__webglDiagnostics.pointDraws.at(-1));
  expect(latest.projection).toEqual(resting.projection);
  expect(latest.modelView).toEqual(resting.modelView);
  expect(await page.locator('#bgViewer').evaluate(viewer => viewer.style.opacity)).toBe('');
});

test('CSLT releases the splash and keeps content usable when the point cloud request fails', async ({ page }, testInfo) => {
  await blockExternalAndServePackages(page);
  const cloud = testInfo.project.name === 'mobile-chromium' ? cslt.mobileCloud : cslt.desktopCloud;
  await page.route(`**/pointcloud/${cloud}`, route => route.abort());
  await page.goto(pageUrl(cslt.path));
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await expect(page.locator('main')).not.toHaveClass(/content-hidden/);
  await expect(page.getByRole('heading', { name: cslt.heading })).toBeVisible();
});

test('CSLT releases the splash and keeps content usable while the point cloud is still loading', async ({ page }, testInfo) => {
  await blockExternalAndServePackages(page);
  await instrumentWebGL(page, { capturePoints: true });
  const isMobile = testInfo.project.name === 'mobile-chromium';
  const cloud = isMobile ? cslt.mobileCloud : cslt.desktopCloud;
  const pointCount = isMobile ? cslt.mobileCount : cslt.desktopCount;
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  let requested = false;
  await page.route(`**/pointcloud/${cloud}`, async route => {
    requested = true;
    await gate;
    await route.continue();
  });
  try {
    await page.goto(pageUrl(cslt.path), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator('#loadingScreen')).toBeHidden();
    await expect(page.locator('main')).not.toHaveClass(/content-hidden/);
    await expect(page.getByRole('heading', { name: cslt.heading })).toBeVisible();
    expect(await page.evaluate(() => window.__webglDiagnostics.pointDraws.length)).toBe(0);
  } finally {
    release();
  }
  await page.waitForFunction(count => window.__webglDiagnostics?.pointDraws?.some(draw => draw.count === count), pointCount, { timeout: 30000 });
});
