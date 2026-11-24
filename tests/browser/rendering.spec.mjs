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
    desktopModel: 'mesh_index.glb',
    mobileModel: 'mesh_index.mobile.glb',
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

async function instrumentWebGL(page, { capturePoints = false, captureFire = false } = {}) {
  await page.addInitScript(capture => {
    const diagnostics = window.__webglDiagnostics = { drawCalls: 0, shaderErrors: [], programErrors: [] };
    if (capture.points) {
      diagnostics.pointDraws = [];
      diagnostics.meshDrawCalls = 0;
    }
    if (capture.fire) {
      diagnostics.fireDrawCalls = 0;
      diagnostics.fireOnscreenDrawCalls = 0;
      diagnostics.bloomDrawCalls = 0;
      diagnostics.overlayDrawCalls = 0;
      diagnostics.lastFireTime = null;
    }
    const prototype = window.WebGL2RenderingContext?.prototype;
    if (!prototype) return;
    const countIndex = { drawArrays: 2, drawElements: 1, drawRangeElements: 3 };
    for (const name of ['drawArrays', 'drawElements', 'drawRangeElements']) {
      const original = prototype[name];
      if (!original) continue;
      prototype[name] = function (...args) {
        diagnostics.drawCalls++;
        const program = (capture.points || capture.fire) ? this.getParameter(this.CURRENT_PROGRAM) : null;
        if (capture.points && args[0] === this.TRIANGLES) diagnostics.meshDrawCalls++;
        if (capture.fire && args[0] === this.TRIANGLES && program) {
          const uTime = this.getUniformLocation(program, 'uTime');
          const bloomUniform = ['luminosityThreshold', 'bloomStrength', 'direction', 'opacity']
            .some(uniform => this.getUniformLocation(program, uniform));
          if (uTime && this.getUniformLocation(program, '_MainTex')) {
            diagnostics.fireDrawCalls++;
            diagnostics.lastFireTime = this.getUniform(program, uTime);
            if (!this.getParameter(this.FRAMEBUFFER_BINDING)) diagnostics.fireOnscreenDrawCalls++;
          } else if (this.getUniformLocation(program, 'uFade')) {
            diagnostics.overlayDrawCalls++;
          } else if (bloomUniform) {
            diagnostics.bloomDrawCalls++;
          }
        }
        if (capture.points && args[0] === this.POINTS) {
          const projection = this.getUniformLocation(program, 'projectionMatrix');
          const modelView = this.getUniformLocation(program, 'modelViewMatrix');
          diagnostics.pointDraws.push({
            count: args[countIndex[name]],
            projection: projection ? Array.from(this.getUniform(program, projection)) : null,
            modelView: modelView ? Array.from(this.getUniform(program, modelView)) : null,
            colorWrite: this.getParameter(this.COLOR_WRITEMASK),
            depthWrite: this.getParameter(this.DEPTH_WRITEMASK),
            offscreen: this.getParameter(this.FRAMEBUFFER_BINDING) !== null
          });
          if (diagnostics.pointDraws.length > 64) diagnostics.pointDraws.shift();
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
        diagnostics.shaderErrors.push(getShaderInfoLog.call(this, shader));
      }
      return result;
    };
    const linkProgram = prototype.linkProgram;
    const getProgramParameter = prototype.getProgramParameter;
    const getProgramInfoLog = prototype.getProgramInfoLog;
    prototype.linkProgram = function (program) {
      const result = linkProgram.call(this, program);
      if (!getProgramParameter.call(this, program, this.LINK_STATUS)) {
        diagnostics.programErrors.push(getProgramInfoLog.call(this, program));
      }
      return result;
    };
  }, { points: capturePoints, fire: captureFire });
}

for (const entry of pages) {
  test(`${entry.name} loads its responsive GLB and performs real WebGL rendering`, async ({ page }, testInfo) => {
    await blockExternalAndServePackages(page);
    await instrumentWebGL(page, { captureFire: entry.name === 'home' });
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
    if (entry.name === 'home') {
      await expect.poll(() => page.evaluate(() => window.__webglDiagnostics.fireDrawCalls)).toBeGreaterThan(0);
    }

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

test('home loads the page content when the Three.js module request fails', async ({ page }) => {
  await blockExternalAndServePackages(page);
  await page.route('**/npm/three@0.174.0/build/three.module.js', route => route.abort());
  await page.goto(pageUrl('/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'About artrio' })).toBeVisible();
});

test('model request failure leaves page content usable and releases splashes where present', async ({ page }, testInfo) => {
  await blockExternalAndServePackages(page);
  const entry = testInfo.project.name === 'mobile-chromium' ? pages[0] : pages[2];
  await page.route(`**/${entry.mobileModel === entry.desktopModel ? entry.mobileModel : testInfo.project.name === 'mobile-chromium' ? entry.mobileModel : entry.desktopModel}`, route => route.abort());
  await page.goto(pageUrl(entry.path));
  if (entry.splash) await expect(page.locator('#loadingScreen')).toBeHidden();
  await expect(page.getByRole('heading', { name: entry.heading })).toBeVisible();
  await expect(page.getByRole('link', { name: entry.name === 'home' ? 'EQUUS: FORM + VOID' : 'Henry Ho' })).toBeVisible();
});

test('CSLT renders its responsive scan and artwork, then dollies into the right aisle without turning', async ({ page }, testInfo) => {
  await blockExternalAndServePackages(page);
  await instrumentWebGL(page, { capturePoints: true, captureFire: true });
  const isMobile = testInfo.project.name === 'mobile-chromium';
  const cloud = isMobile ? cslt.mobileCloud : cslt.desktopCloud;
  const pointCount = isMobile ? cslt.mobileCount : cslt.desktopCount;
  const artwork = isMobile ? 'Artwork.mobile.glb' : 'Artwork.glb';
  const errors = [];
  const plyRequests = [];
  const glbRequests = [];
  const fbxRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('.ply')) plyRequests.push(pathname);
    if (pathname.endsWith('.glb')) glbRequests.push(pathname);
    if (pathname.endsWith('.fbx')) fbxRequests.push(pathname);
  });
  const cloudRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith(`/${cloud}`));
  await page.goto(pageUrl(cslt.path), { waitUntil: 'domcontentloaded' });
  await cloudRequest;
  await expect(page.locator('#bgViewer canvas')).toBeVisible();
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await page.waitForFunction(count => window.__webglDiagnostics?.pointDraws?.some(draw => draw.count === count), pointCount, { timeout: 30000 });
  await page.waitForFunction(() => window.__webglDiagnostics.meshDrawCalls > 0);

  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => /Fire2\.(?:vert|frag)$/.test(entry.name)).length)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.__webglDiagnostics.fireDrawCalls)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__webglDiagnostics.bloomDrawCalls)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__webglDiagnostics.overlayDrawCalls)).toBeGreaterThan(0);
  const firstFireTime = await page.evaluate(() => window.__webglDiagnostics.lastFireTime);
  await expect.poll(() => page.evaluate(() => window.__webglDiagnostics.lastFireTime)).toBeGreaterThan(firstFireTime);
  const captureDraw = await page.evaluate(() =>
    window.__webglDiagnostics.pointDraws.find(draw => draw.offscreen));
  expect(captureDraw).toBeTruthy();
  expect(captureDraw.count).toBe(pointCount);
  expect(captureDraw.colorWrite).toEqual([false, false, false, false]);
  expect(captureDraw.depthWrite).toBe(true);

  const latestDraw = () => page.evaluate(() => window.__webglDiagnostics.pointDraws
    .filter(draw => !draw.offscreen).at(-1) ?? window.__webglDiagnostics.pointDraws.at(-1));
  const distanceFromAisle = ({ modelView: m }) => {
    // Invert the rigid model-view transform to recover the camera in the scan's coordinates.
    const offset = [0, 4, 8].map(i => -(m[i] * m[12] + m[i + 1] * m[13] + m[i + 2] * m[14]));
    return Math.hypot(offset[0] - 0.775, offset[1] - 1.024, offset[2] - 0.745);
  };
  const opening = await latestDraw();
  expect(opening.count).toBe(pointCount);
  expect(opening.offscreen).toBe(false);
  expect(opening.colorWrite).toEqual([true, true, true, true]);
  expect(opening.depthWrite).toBe(true);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const openingShot = path.join(screenshotDir, `CSLT-${testInfo.project.name}-opening.png`);
  await page.screenshot({ path: openingShot });
  await testInfo.attach(`CSLT-opening-${testInfo.project.name}`, { path: openingShot });

  const midpoint = await page.evaluate(() => {
    document.getElementById('bgViewer').setProgress(0.5);
    return window.__webglDiagnostics.pointDraws.at(-1);
  });
  const midpointShot = path.join(screenshotDir, `CSLT-${testInfo.project.name}-midpoint.png`);
  await page.screenshot({ path: midpointShot });
  await testInfo.attach(`CSLT-midpoint-${testInfo.project.name}`, { path: midpointShot });

  const approachDraws = await page.evaluate(() => {
    const diagnostics = window.__webglDiagnostics;
    const before = diagnostics.meshDrawCalls;
    document.getElementById('bgViewer').setProgress(0.9);
    return diagnostics.meshDrawCalls - before;
  });
  expect(approachDraws).toBeGreaterThan(0);
  const approachShot = testInfo.outputPath('CSLT-artwork-approach.png');
  await page.screenshot({ path: approachShot, style: '.intro-title { visibility: hidden; }' });
  await testInfo.attach('CSLT-artwork-approach', { path: approachShot });

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await expect.poll(async () => distanceFromAisle(await latestDraw())).toBeLessThan(0.1);
  const end = await latestDraw();
  const arrivalDraws = await page.evaluate(() => {
    const diagnostics = window.__webglDiagnostics;
    const before = [
      diagnostics.meshDrawCalls,
      diagnostics.fireDrawCalls,
      diagnostics.bloomDrawCalls,
      diagnostics.overlayDrawCalls
    ];
    document.getElementById('bgViewer').setProgress(1);
    return [
      diagnostics.meshDrawCalls,
      diagnostics.fireDrawCalls,
      diagnostics.bloomDrawCalls,
      diagnostics.overlayDrawCalls
    ].map((value, index) => value - before[index]);
  });
  expect(arrivalDraws).toEqual([0, 0, 0, 0]);
  const zoomedShot = path.join(screenshotDir, `CSLT-${testInfo.project.name}-zoomed.png`);
  await page.screenshot({ path: zoomedShot });
  await testInfo.attach(`CSLT-zoomed-${testInfo.project.name}`, { path: zoomedShot });

  for (const draw of [midpoint, end]) {
    for (let i = 0; i < 12; i++) {
      expect(Math.abs(draw.modelView[i] - opening.modelView[i])).toBeLessThan(1e-5);
    }
    expect(draw.projection).toEqual(opening.projection);
  }
  expect(midpoint.modelView[14]).toBeGreaterThan(opening.modelView[14]);
  expect(end.modelView[14]).toBeGreaterThan(midpoint.modelView[14]);
  expect(end.modelView[12]).toBeLessThan(opening.modelView[12]);
  const meanX = (opening.modelView[12] + end.modelView[12]) / 2;
  expect(midpoint.modelView[12]).toBeLessThan(meanX - 1e-4);
  const meanY = (opening.modelView[13] + end.modelView[13]) / 2;
  expect(midpoint.modelView[13]).toBeCloseTo(meanY, 3);

  const viewport = page.viewportSize();
  const originalWidth = await page.locator('#bgViewer').evaluate(element => element.clientWidth);
  const resizedWidth = Math.max(320, Math.round(viewport.width * 0.7));
  await page.setViewportSize({ width: resizedWidth, height: viewport.height });
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  const resizedClientWidth = await page.locator('#bgViewer').evaluate(element => element.clientWidth);
  await expect.poll(async () => {
    const draw = await latestDraw();
    return Math.abs(draw.projection[0] - end.projection[0] * originalWidth / resizedClientWidth) < 1e-4
      && distanceFromAisle(draw) < 0.1;
  }).toBe(true);
  expect(plyRequests).toEqual([`/CSLT/pointcloud/${cloud}`]);
  expect(Math.abs(await page.locator('#bgViewer canvas').evaluate(canvas => canvas.getBoundingClientRect().width) - resizedWidth)).toBeLessThan(2);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(async () => (await latestDraw()).modelView[14]).toBeLessThan(end.modelView[14] - 1);

  await page.setViewportSize(viewport);
  await expect.poll(() => page.evaluate(target =>
    Math.abs((window.__webglDiagnostics.pointDraws.at(-1)?.projection?.[0] ?? 0) - target) < 1e-4,
    opening.projection[0])).toBe(true);
  const restored = await latestDraw();
  for (let i = 0; i < 16; i++) {
    expect(Math.abs(restored.modelView[i] - opening.modelView[i])).toBeLessThan(1e-5);
  }

  const diagnostics = await page.evaluate(() => window.__webglDiagnostics);
  expect(diagnostics.shaderErrors).toEqual([]);
  expect(diagnostics.programErrors).toEqual([]);
  expect(diagnostics.fireOnscreenDrawCalls).toBe(0);
  expect(plyRequests).toEqual([`/CSLT/pointcloud/${cloud}`]);
  expect(glbRequests).toEqual([`/CSLT/${artwork}`]);
  expect(fbxRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('CSLT reduced motion keeps the point cloud zoom and fade fixed', async ({ page }, testInfo) => {
  await blockExternalAndServePackages(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await instrumentWebGL(page, { capturePoints: true, captureFire: true });
  const isMobile = testInfo.project.name === 'mobile-chromium';
  const pointCount = isMobile ? cslt.mobileCount : cslt.desktopCount;
  await page.goto(pageUrl(cslt.path), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await page.waitForFunction(count => window.__webglDiagnostics?.pointDraws?.some(draw => draw.count === count), pointCount, { timeout: 30000 });
  await page.waitForFunction(() => window.__webglDiagnostics.fireDrawCalls > 0, null, { timeout: 30000 });

  const fireActivity = () => page.evaluate(() => [
    window.__webglDiagnostics.fireDrawCalls,
    window.__webglDiagnostics.bloomDrawCalls,
    window.__webglDiagnostics.overlayDrawCalls,
    window.__webglDiagnostics.lastFireTime
  ]);
  const restingFire = await fireActivity();
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  expect(await fireActivity()).toEqual(restingFire);

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

test('CSLT keeps the point cloud and splash usable when the fire shader requests fail', async ({ page }, testInfo) => {
  await blockExternalAndServePackages(page);
  await instrumentWebGL(page, { capturePoints: true });
  await page.route('**/Fire2.vert', route => route.fulfill({ status: 404, body: 'not found' }));
  await page.route('**/Fire2.frag', route => route.fulfill({ status: 404, body: 'not found' }));
  const isMobile = testInfo.project.name === 'mobile-chromium';
  const pointCount = isMobile ? cslt.mobileCount : cslt.desktopCount;
  const shaderRequests = [];
  const warnings = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (/Fire2\.(?:vert|frag)$/.test(pathname)) shaderRequests.push(pathname);
  });
  page.on('console', message => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.goto(pageUrl(cslt.path), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await page.waitForFunction(count => window.__webglDiagnostics?.pointDraws?.some(draw => draw.count === count), pointCount, { timeout: 30000 });
  await expect(page.getByRole('heading', { name: cslt.heading })).toBeVisible();
  expect(shaderRequests).toEqual(expect.arrayContaining(['/Fire2.vert', '/Fire2.frag']));
  expect(shaderRequests).toHaveLength(2);
  await expect.poll(() => warnings.some(text => text.includes('Could not load CSLT artwork'))).toBe(true);
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

test('CSLT fire alpha lets rear points show through while foreground points still occlude', async ({ page }) => {
  await blockExternalAndServePackages(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/strand-occlusion', route => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><head><script type="importmap">
      {"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/"}}
      </script></head><body></body></html>`
  }));
  await page.goto(pageUrl('/strand-occlusion'));
  const samples = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createFireOverlay } = await import('/CSLT/fire-overlay.js');
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(128, 128, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-6.4, 6.4, 6.4, -6.4, 0.1, 10);
    camera.position.z = 5;
    const fireMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 0.4); }',
      transparent: true
    });
    const fireRoot = new THREE.Object3D();
    fireRoot.add(new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), fireMaterial));
    scene.add(fireRoot);
    const green = new THREE.PointsMaterial({ color: 0x00ff00, size: 60, sizeAttenuation: false });
    const makePoints = z => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, z], 3));
      const points = new THREE.Points(geometry, green);
      scene.add(points);
      return points;
    };
    const rear = makePoints(-1);
    const front = makePoints(1);
    const overlay = createFireOverlay({
      renderer, scene, camera,
      occluders: [rear, front],
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)'),
      onFrame() {}
    });
    if (!overlay) return null;
    overlay.attach(fireRoot, fireMaterial);
    const gl = renderer.getContext();
    const pixel = (x, y) => {
      const values = new Uint8Array(4);
      gl.readPixels(x, 127 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, values);
      return Array.from(values);
    };
    const draw = fade => {
      renderer.render(scene, camera);
      overlay.render(fade);
    };
    front.visible = false;
    draw(1);
    const rearThroughFire = pixel(64, 64);
    const gap = pixel(90, 64);
    const haloWithGreen = pixel(80, 64);
    rear.visible = false;
    front.visible = true;
    draw(1);
    const foreground = pixel(64, 64);
    front.visible = false;
    draw(1);
    const fireOnly = pixel(64, 64);
    const haloOnBlack = pixel(80, 64);
    rear.visible = true;
    draw(0.5);
    const halfFade = pixel(64, 64);
    draw(0);
    const noFade = pixel(64, 64);
    return { rearThroughFire, gap, haloWithGreen, foreground, fireOnly, haloOnBlack, halfFade, noFade };
  });
  expect(samples).not.toBeNull();
  expect(samples.rearThroughFire[0]).toBeGreaterThan(80);
  expect(Math.abs(samples.rearThroughFire[0] - samples.fireOnly[0])).toBeLessThanOrEqual(1);
  expect(samples.rearThroughFire[1]).toBeGreaterThan(250);
  expect(Math.abs(samples.fireOnly[3] - 102)).toBeLessThanOrEqual(2);
  expect(samples.foreground).toEqual([0, 255, 0, 255]);
  expect(samples.gap[1]).toBeGreaterThan(240);
  expect(samples.haloWithGreen[1]).toBeGreaterThan(240);
  expect(samples.haloOnBlack[0] + samples.haloOnBlack[1]).toBeGreaterThan(0);
  expect(samples.halfFade[1]).toBeGreaterThan(250);
  expect(samples.noFade).toEqual([0, 255, 0, 255]);
});

test('CSLT first-person explorer flies the responsive scan with the fire artwork', async ({ page }, testInfo) => {
  await blockExternalAndServePackages(page);
  await instrumentWebGL(page, { capturePoints: true, captureFire: true });
  const isMobile = testInfo.project.name === 'mobile-chromium';
  const cloud = isMobile ? cslt.mobileCloud : cslt.desktopCloud;
  const pointCount = isMobile ? cslt.mobileCount : cslt.desktopCount;
  const artwork = isMobile ? 'Artwork.mobile.glb' : 'Artwork.glb';
  const errors = [];
  const plyRequests = [];
  const glbRequests = [];
  const fbxRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('.ply')) plyRequests.push(pathname);
    if (pathname.endsWith('.glb')) glbRequests.push(pathname);
    if (pathname.endsWith('.fbx')) fbxRequests.push(pathname);
  });
  await page.goto(pageUrl('/CSLT/test.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(count => window.__webglDiagnostics?.pointDraws?.some(draw => draw.count === count), pointCount, { timeout: 30000 });
  await expect(page.locator('#status')).toContainText('Ready');
  await expect.poll(() => page.evaluate(() => window.__webglDiagnostics.fireDrawCalls)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__webglDiagnostics.overlayDrawCalls)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => /Fire2\.(?:vert|frag)$/.test(entry.name)).length)).toBeGreaterThanOrEqual(2);
  const latestDraw = () => page.evaluate(() => window.__webglDiagnostics.pointDraws.at(-1));
  const opening = await latestDraw();
  const firstPersonShot = testInfo.outputPath('CSLT-first-person.png');
  await page.screenshot({ path: firstPersonShot });
  await testInfo.attach('CSLT-first-person', { path: firstPersonShot });
  const translationDelta = draw =>
    Math.abs(draw.modelView[12] - opening.modelView[12])
    + Math.abs(draw.modelView[13] - opening.modelView[13])
    + Math.abs(draw.modelView[14] - opening.modelView[14]);
  const viewport = page.viewportSize();
  const cdp = isMobile ? await page.context().newCDPSession(page) : null;

  if (isMobile) {
    const box = await page.locator('[data-move="forward"]').boundingBox();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }]
    });
    await expect.poll(async () => translationDelta(await latestDraw())).toBeGreaterThan(0.01);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.keyboard.down('w');
    await expect.poll(async () => translationDelta(await latestDraw())).toBeGreaterThan(0.01);
    await page.keyboard.up('w');
  }

  const beforeDrag = await latestDraw();
  if (isMobile) {
    const cx = viewport.width / 2;
    const cy = viewport.height / 3;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 100, y: cy - 30, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport.width / 2 + 120, viewport.height / 2 - 40, { steps: 8 });
    await page.mouse.up();
  }
  await expect.poll(async () => {
    const draw = await latestDraw();
    return draw.modelView.slice(0, 12).some((value, index) => Math.abs(value - beforeDrag.modelView[index]) > 1e-5);
  }).toBe(true);

  await page.locator('#resetButton').click();
  await expect.poll(async () => {
    const draw = await latestDraw();
    return draw.modelView.every((value, index) => Math.abs(value - opening.modelView[index]) < 1e-5);
  }).toBe(true);

  const preResize = await latestDraw();
  const resizedWidth = Math.max(320, Math.round(viewport.width * 0.7));
  await page.setViewportSize({ width: resizedWidth, height: viewport.height });
  await expect.poll(async () => {
    const draw = await latestDraw();
    return draw.projection !== null && Math.abs(draw.projection[0] - preResize.projection[0]) > 1e-6;
  }).toBe(true);
  const resizedDraw = await latestDraw();
  for (let i = 0; i < 16; i++) {
    expect(Math.abs(resizedDraw.modelView[i] - preResize.modelView[i])).toBeLessThan(1e-5);
  }

  expect(plyRequests).toEqual([`/CSLT/pointcloud/${cloud}`]);
  expect(glbRequests).toEqual([`/CSLT/${artwork}`]);
  expect(fbxRequests).toEqual([]);
  expect(errors).toEqual([]);
});
