import assert from 'node:assert/strict';
import * as THREE from 'three';
import test from 'node:test';
import { FakeBrowser } from './helpers/fake-browser.mjs';
import { createBackgroundHarness, createModel } from './helpers/background3d-harness.mjs';

const mobileQuery = '(max-width: 767px), (pointer: coarse)';

async function flushMicrotasks() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function yawDegrees(position, center) {
  return Math.atan2(position.x - center.x, position.z - center.z) * 180 / Math.PI;
}

function elevationDegrees(position, center) {
  const horizontal = Math.hypot(position.x - center.x, position.z - center.z);
  return Math.atan2(position.y - center.y, horizontal) * 180 / Math.PI;
}

function angleError(actual, expected) {
  return Math.abs(((actual - expected + 180) % 360 + 360) % 360 - 180);
}

function cameraSnapshot(harness) {
  return harness.state.renderers[0].renderCalls.at(-1).position;
}

function boundsCenter(model) {
  return new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere()).center;
}

function viewer(browser, src = 'desktop.glb', mobileSrc = src, width = 800, height = 600) {
  return {
    clientWidth: width,
    clientHeight: height,
    dataset: { src, mobileSrc },
    append(element) {
      this.canvas = element;
    }
  };
}

test('desktop/mobile source selection is cached and stale loads cannot replace the latest model', async () => {
  const browser = new FakeBrowser();
  const desktop = createModel();
  const mobile = createModel({ position: [5, 2, -3] });
  const harness = await createBackgroundHarness({
    browser,
    models: new Map([
      ['desktop.glb', Promise.resolve({ scene: desktop.scene })],
      ['mobile.glb', Promise.resolve({ scene: mobile.scene })]
    ])
  });
  const target = viewer(browser, 'desktop.glb', 'mobile.glb');
  const background = harness.initBackground3D(target, browser.window.matchMedia(mobileQuery), {
    desktopBloomStrength: 0,
    mobileBloomStrength: 0
  });
  await background.ready;
  assert.deepEqual(harness.state.scenes[0].children, [desktop.scene]);
  browser.setMedia(mobileQuery, true);
  await flushMicrotasks();
  assert.deepEqual(harness.state.scenes[0].children, [mobile.scene]);
  browser.setMedia(mobileQuery, false);
  await flushMicrotasks();

  assert.deepEqual(harness.state.loadCalls, ['desktop.glb', 'mobile.glb']);
  assert.deepEqual(harness.state.scenes[0].children, [desktop.scene]);

  const lateBrowser = new FakeBrowser();
  let resolveDesktop;
  const lateDesktop = new Promise(resolve => { resolveDesktop = resolve; });
  const newest = createModel({ position: [8, -2, 4] });
  const lateHarness = await createBackgroundHarness({
    browser: lateBrowser,
    models: new Map([
      ['desktop.glb', lateDesktop],
      ['mobile.glb', Promise.resolve({ scene: newest.scene })]
    ])
  });
  const lateBackground = lateHarness.initBackground3D(
    viewer(lateBrowser, 'desktop.glb', 'mobile.glb'),
    lateBrowser.window.matchMedia(mobileQuery),
    { desktopBloomStrength: 0, mobileBloomStrength: 0 }
  );
  lateBrowser.setMedia(mobileQuery, true);
  await flushMicrotasks();
  resolveDesktop({ scene: createModel().scene });
  await lateBackground.ready;
  assert.deepEqual(lateHarness.state.loadCalls, ['desktop.glb', 'mobile.glb']);
  assert.deepEqual(lateHarness.state.scenes[0].children, [newest.scene]);
});

test('default, midpoint, oscillating, and fixed camera paths clamp progress correctly', async () => {
  const cases = [
    { options: { desktopBloomStrength: 0 }, checkpoints: [[0, 45], [0.5, 135], [1, 225]], elevation: 50 },
    {
      options: {
        desktopBloomStrength: 0,
        cameraElevation: 0,
        cameraAzimuthStart: 0,
        cameraAzimuthMid: 30,
        cameraAzimuthRange: -60
      },
      checkpoints: [[0, 0], [0.25, 15], [0.5, 30], [0.75, -15], [1, -60]],
      elevation: 0
    },
    {
      options: { desktopBloomStrength: 0, cameraAzimuthStart: 0, cameraAzimuthRange: 45, cameraOscillates: true },
      checkpoints: [[0, 0], [0.25, 45], [0.5, 0], [0.75, -45], [1, 0]],
      elevation: 50
    },
    {
      options: {
        desktopBloomStrength: 0,
        cameraElevation: 0,
        cameraAzimuthStart: 0,
        cameraAzimuthMid: null,
        cameraAzimuthRange: 0
      },
      checkpoints: [[0, 0], [0.5, 0], [1, 0]],
      elevation: 0
    }
  ];

  for (const { options, checkpoints, elevation } of cases) {
    const browser = new FakeBrowser();
    const model = createModel({ position: [3, 4, -5] });
    const harness = await createBackgroundHarness({
      browser,
      models: new Map([['model.glb', Promise.resolve({ scene: model.scene })]])
    });
    const background = harness.initBackground3D(viewer(browser, 'model.glb'), browser.window.matchMedia(mobileQuery), options);
    await background.ready;
    const center = boundsCenter(model.scene);
    for (const [progress, expectedYaw] of checkpoints) {
      background.setProgress(progress);
      const position = cameraSnapshot(harness);
      assert.ok(angleError(yawDegrees(position, center), expectedYaw) < 1e-6);
      assert.ok(Math.abs(elevationDegrees(position, center) - elevation) < 1e-6);
    }
    background.setProgress(-1);
    assert.ok(angleError(yawDegrees(cameraSnapshot(harness), center), checkpoints[0][1]) < 1e-6);
    background.setProgress(2);
    assert.ok(angleError(yawDegrees(cameraSnapshot(harness), center), checkpoints.at(-1)[1]) < 1e-6);
  }
});

test('model rotation wraps cached scenes once and preserves imported transforms and fitted bounds', async () => {
  const browser = new FakeBrowser();
  const model = createModel({ position: [2, 3, 4], rotation: [0.2, -0.3, 0.4] });
  const originalPosition = model.scene.position.clone();
  const originalRotation = model.scene.rotation.clone();
  const harness = await createBackgroundHarness({
    browser,
    models: new Map([['writing.glb', Promise.resolve({ scene: model.scene })]])
  });
  const background = harness.initBackground3D(
    viewer(browser, 'writing.glb', 'writing.glb'),
    browser.window.matchMedia(mobileQuery),
    { desktopBloomStrength: 0, modelRotation: { x: 90, z: 90 }, cameraElevation: 0 }
  );
  await background.ready;
  const oriented = harness.state.scenes[0].children[0];
  assert.equal(harness.state.orientedGroups.length, 1);
  assert.equal(oriented.children[0], model.scene);
  assert.deepEqual(
    [oriented.rotation.x, oriented.rotation.y, oriented.rotation.z, oriented.rotation.order],
    [Math.PI / 2, 0, Math.PI / 2, 'ZYX']
  );
  assert.ok(model.scene.position.equals(originalPosition));
  assert.ok(model.scene.rotation.equals(originalRotation));
  assert.equal(harness.state.boundsObjects[0], oriented);

  browser.setMedia(mobileQuery, true);
  await flushMicrotasks();
  assert.deepEqual(harness.state.scenes[0].children, [oriented]);
  browser.setMedia(mobileQuery, false);
  await flushMicrotasks();
  assert.deepEqual(harness.state.loadCalls, ['writing.glb']);
  assert.equal(harness.state.orientedGroups.length, 1);
  assert.equal(harness.state.scenes[0].children[0], oriented);

  const unrotatedBrowser = new FakeBrowser();
  const unrotated = createModel();
  const unrotatedHarness = await createBackgroundHarness({
    browser: unrotatedBrowser,
    models: new Map([['horse.glb', Promise.resolve({ scene: unrotated.scene })]])
  });
  const horse = unrotatedHarness.initBackground3D(
    viewer(unrotatedBrowser, 'horse.glb'),
    unrotatedBrowser.window.matchMedia(mobileQuery),
    { desktopBloomStrength: 0 }
  );
  await horse.ready;
  assert.equal(unrotatedHarness.state.orientedGroups.length, 0);
  assert.equal(unrotatedHarness.state.scenes[0].children[0], unrotated.scene);
});

test('camera fitting and resize remain finite with zero-size viewers and capped pixel ratios', async () => {
  const browser = new FakeBrowser();
  browser.window.devicePixelRatio = 3;
  const model = createModel();
  const harness = await createBackgroundHarness({
    browser,
    models: new Map([['model.glb', Promise.resolve({ scene: model.scene })]])
  });
  const target = viewer(browser, 'model.glb');
  const background = harness.initBackground3D(target, browser.window.matchMedia(mobileQuery), {
    desktopBloomStrength: 0.4,
    mobileBloomStrength: 0,
    modelScale: 1.2
  });
  await background.ready;
  const renderer = harness.state.renderers[0];
  const camera = harness.state.cameras[0];
  assert.ok(renderer.pixelRatios.includes(2));
  assert.ok(Number.isFinite(camera.position.x + camera.position.y + camera.position.z));
  const center = boundsCenter(model.scene);
  const distanceAtScale = camera.position.distanceTo(center);

  target.clientWidth = 0;
  target.clientHeight = 0;
  browser.dispatch('resize');
  assert.deepEqual(renderer.sizes.at(-1), [1, 1, false]);
  assert.equal(camera.aspect, 1);

  const composerCallsBeforeMobile = harness.state.composers[0].renderCalls;
  browser.setMedia(mobileQuery, true);
  await flushMicrotasks();
  assert.ok(renderer.pixelRatios.includes(1.5));
  assert.equal(harness.state.composers[0].renderCalls, composerCallsBeforeMobile);
  assert.ok(renderer.renderCalls.length > 0);

  const scaleBrowser = new FakeBrowser();
  const scaleModel = createModel();
  const scaleHarness = await createBackgroundHarness({
    browser: scaleBrowser,
    models: new Map([['model.glb', Promise.resolve({ scene: scaleModel.scene })]])
  });
  await scaleHarness.initBackground3D(
    viewer(scaleBrowser, 'model.glb'),
    scaleBrowser.window.matchMedia(mobileQuery),
    { desktopBloomStrength: 0, modelScale: 2 }
  ).ready;
  const scaleDistance = scaleHarness.state.cameras[0].position.distanceTo(boundsCenter(scaleModel.scene));
  assert.ok(Math.abs(distanceAtScale / scaleDistance - 2 / 1.2) < 1e-6);
});

test('fire shader adapts sources, creates required attributes, clamps texture S, and animates time', async () => {
  const browser = new FakeBrowser();
  const model = createModel();
  const harness = await createBackgroundHarness({
    browser,
    models: new Map([['fire.glb', Promise.resolve({ scene: model.scene })]])
  });
  model.texture.wrapS = THREE.RepeatWrapping;
  model.texture.wrapT = THREE.MirroredRepeatWrapping;
  const background = harness.initBackground3D(viewer(browser, 'fire.glb'), browser.window.matchMedia(mobileQuery), {
    desktopBloomStrength: 0.6,
    mobileBloomStrength: 0,
    bloomTint: '#22aa44',
    fireMaterial: {
      color: '#00ff00',
      emissionGain: 2.5,
      scroll1: 3,
      scroll2: 4,
      displacementIntensity: 5,
      textureScaleX: 0.4,
      textureOffsetX: 0.3,
      clampTextureX: true
    }
  });
  await background.ready;

  const shader = model.mesh.material;
  assert.ok(shader.isShaderMaterial);
  assert.equal(harness.state.fetchCalls.length, 2);
  assert.match(shader.vertexShader, /projectionMatrix \* modelViewMatrix/);
  assert.doesNotMatch(shader.vertexShader, /#version|layout\(location|uModelViewProjection/);
  assert.doesNotMatch(shader.fragmentShader, /#version/);
  assert.equal(model.geometry.getAttribute('aPosition'), model.geometry.getAttribute('position'));
  assert.equal(model.geometry.getAttribute('aTexcoord'), model.geometry.getAttribute('uv'));
  assert.equal(model.geometry.getAttribute('aColor').itemSize, 4);
  assert.equal(shader.uniforms._MainTex.value, model.texture);
  assert.equal(shader.uniforms._MainTex_ST.value.x, 0.4);
  assert.equal(shader.uniforms._MainTex_ST.value.z, 0.3);
  assert.equal(shader.uniforms._Scroll1.value, 3);
  assert.equal(shader.uniforms._Scroll2.value, 4);
  assert.equal(shader.uniforms._DisplacementIntensity.value, 5);
  assert.equal(shader.uniforms._EmissionGain.value, 2.5);
  assert.equal(model.texture.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(model.texture.wrapT, THREE.MirroredRepeatWrapping);
  assert.equal(harness.state.bloomPasses[0].materialHighPassFilter.needsUpdate, true);
  assert.equal(harness.state.animationLoopRegistrations, 1);

  const animationLoop = harness.state.loopCallbacks[0];
  assert.equal(harness.state.composers[0].renderCalls, 1);
  animationLoop();
  assert.equal(shader.uniforms.uTime.value, 0.25);
  browser.document.hidden = true;
  const rendered = harness.state.composers[0].renderCalls;
  animationLoop();
  assert.equal(harness.state.composers[0].renderCalls, rendered);
  browser.document.hidden = false;
  browser.setMedia(mobileQuery, true);
  await flushMicrotasks();
  assert.ok(harness.state.renderers[0].renderCalls.length > 0);
});

test('initial model load failures reject ready and responsive load failures are reported', async () => {
  const failedBrowser = new FakeBrowser();
  const failed = await createBackgroundHarness({
    browser: failedBrowser,
    loadModel: async () => { throw new Error('initial model error'); }
  });
  const initial = failed.initBackground3D(
    viewer(failedBrowser, 'bad.glb'),
    failedBrowser.window.matchMedia(mobileQuery),
    { desktopBloomStrength: 0 }
  );
  await assert.rejects(initial.ready, /initial model error/);

  const mobileBrowser = new FakeBrowser();
  const goodModel = createModel();
  const responsive = await createBackgroundHarness({
    browser: mobileBrowser,
    loadModel: src => src === 'desktop.glb'
      ? Promise.resolve({ scene: goodModel.scene })
      : Promise.reject(new Error('mobile model error'))
  });
  const background = responsive.initBackground3D(
    viewer(mobileBrowser, 'desktop.glb', 'mobile.glb'),
    mobileBrowser.window.matchMedia(mobileQuery),
    { desktopBloomStrength: 0 }
  );
  await background.ready;
  mobileBrowser.setMedia(mobileQuery, true);
  await flushMicrotasks();
  assert.ok(mobileBrowser.errors.some(args => String(args[0]).includes('Could not load 3D background')));
});
