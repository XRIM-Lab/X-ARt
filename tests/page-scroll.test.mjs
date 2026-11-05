import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FakeBrowser } from './helpers/fake-browser.mjs';
import { loadSourceModule } from './helpers/vm-modules.mjs';

const pageScrollSource = readFileSync(new URL('../page-scroll.js', import.meta.url), 'utf8');
let moduleSequence = 0;

async function flushMicrotasks() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

async function withBrowser(browser, callback) {
  const { initPageScroll } = await loadSourceModule(pageScrollSource, {
    context: browser.context,
    identifier: `file:///tests/page-scroll-${++moduleSequence}.mjs`
  });
  return callback(initPageScroll);
}

test('progress clamps safely, coalesces frames, and refreshes the header initially and after restoration', async () => {
  const browser = new FakeBrowser();
  const updates = [];
  await withBrowser(browser, async initPageScroll => {
    const controller = initPageScroll({
      contentStart: browser.contentStart(),
      onUpdate: (...args) => updates.push(args)
    });
    assert.equal(controller.getProgress(), 0);
    assert.equal(browser.headerUpdates, 1);
    controller.refresh();
    controller.refresh();
    assert.equal(browser.frames.size, 1);
    browser.runFrame();
    assert.deepEqual(updates, [[0, false]]);

    browser.window.scrollY = -20;
    assert.equal(controller.getProgress(), 0);
    browser.window.scrollY = 6000;
    assert.equal(controller.getProgress(), 1);
    browser.scrollHeight = browser.window.innerHeight;
    assert.equal(controller.getProgress(), 0);

    browser.window.scrollY = 100;
    browser.dispatch('scroll');
    assert.equal(browser.headerUpdates, 2);
    browser.dispatch('pageshow', { persisted: true });
    assert.equal(browser.headerUpdates, 3);
    assert.equal(browser.frames.size, 1);
    browser.runFrame();
    assert.deepEqual(updates.at(-1), [0, false]);
    controller.destroy();
  });
});

test('native entry/return transitions preserve input guards and ordinary scrolling', async () => {
  const browser = new FakeBrowser();
  await withBrowser(browser, async initPageScroll => {
    const controller = initPageScroll({ contentStart: browser.contentStart() });
    browser.runFrame();

    const wheel = browser.dispatch('wheel', { deltaY: 12 });
    assert.equal(wheel.defaultPrevented, true);
    assert.equal(browser.scrollCalls[0][0].top, 1000);
    assert.equal(browser.scrollCalls[0][0].behavior, 'smooth');
    assert.equal(browser.dispatch('wheel', { deltaY: 20, ctrlKey: true }).defaultPrevented, false);
    assert.equal(browser.dispatch('wheel', { deltaY: 20 }).defaultPrevented, true);
    assert.equal(browser.dispatch('keydown', { key: 'PageDown' }).defaultPrevented, true);
    assert.equal(browser.dispatch('touchmove').defaultPrevented, true);

    browser.window.scrollY = 999;
    browser.dispatch('scroll');
    browser.advance(159);
    assert.equal(browser.dispatch('keydown', { key: 'ArrowDown' }).defaultPrevented, true);
    browser.advance(1);
    assert.equal(browser.dispatch('keydown', { key: 'ArrowDown' }).defaultPrevented, false);

    browser.window.scrollY = 1800;
    browser.dispatch('scroll');
    const ordinaryWheel = browser.dispatch('wheel', { deltaY: 20 });
    assert.equal(ordinaryWheel.defaultPrevented, false);
    assert.equal(browser.scrollCalls.length, 1);

    browser.window.scrollY = 500;
    browser.dispatch('scroll');
    assert.equal(browser.scrollCalls.at(-1)[0].top, 0);
    assert.equal(browser.scrollCalls.at(-1)[0].behavior, 'smooth');
    controller.destroy();
  });
});

test('Firefox uses the existing cubic 600ms path and settles at the measured content target', async () => {
  const browser = new FakeBrowser({ firefox: true });
  await withBrowser(browser, async initPageScroll => {
    const controller = initPageScroll({ contentStart: browser.contentStart() });
    browser.runFrame();
    browser.window.scrollY = 100;
    browser.dispatch('scroll');

    browser.runFrame(300);
    assert.ok(Math.abs(browser.scrollCalls.at(-1)[1] - 887.5) < 0.001);
    browser.runFrame(600);
    assert.equal(browser.window.scrollY, 1000);
    browser.advance(160);
    assert.equal(browser.dispatch('keydown', { key: 'PageDown' }).defaultPrevented, false);
    controller.destroy();
  });
});

test('native smooth timeout, resize, and persisted pageshow release and refresh state', async () => {
  const browser = new FakeBrowser();
  const updates = [];
  await withBrowser(browser, async initPageScroll => {
    const controller = initPageScroll({
      contentStart: browser.contentStart(),
      onUpdate: (...args) => updates.push(args)
    });
    browser.runFrame();
    browser.dispatch('wheel', { deltaY: 10 });
    browser.window.scrollY = 1000;
    browser.advance(2400);
    assert.equal(browser.dispatch('wheel', { deltaY: 10 }).defaultPrevented, true);
    browser.advance(160);
    assert.equal(browser.dispatch('wheel', { deltaY: 10 }).defaultPrevented, false);

    browser.window.scrollY = 1500;
    browser.dispatch('scroll');
    browser.dispatch('resize');
    assert.equal(browser.headerUpdates, 3);
    browser.runFrame();
    assert.equal(updates.at(-1)[0], 0.375);

    browser.dispatch('pageshow', { persisted: true });
    assert.equal(browser.headerUpdates, 4);
    browser.runFrame();
    assert.equal(updates.at(-1)[0], 0.375);
    controller.destroy();
  });
});

test('reduced motion, missing content, and destroy bypass or cancel entrance work', async () => {
  const reducedBrowser = new FakeBrowser({ reduced: true });
  const reducedUpdates = [];
  await withBrowser(reducedBrowser, async initPageScroll => {
    const controller = initPageScroll({
      contentStart: reducedBrowser.contentStart(),
      onUpdate: (...args) => reducedUpdates.push(args)
    });
    assert.equal(controller.prefersReducedMotion, true);
    reducedBrowser.runFrame();
    assert.deepEqual(reducedUpdates, [[0, true]]);
    assert.equal(reducedBrowser.dispatch('wheel', { deltaY: 10 }).defaultPrevented, false);
    assert.equal(reducedBrowser.dispatch('keydown', { key: 'PageDown' }).defaultPrevented, false);
    assert.equal(reducedBrowser.dispatch('touchmove').defaultPrevented, false);
    assert.equal(reducedBrowser.scrollCalls.length, 0);
    reducedBrowser.dispatch('resize');
    assert.equal(reducedBrowser.headerUpdates, 2);
    assert.equal(reducedBrowser.frames.size, 0);
    reducedBrowser.window.scrollY = 1000;
    reducedBrowser.dispatch('scroll');
    assert.equal(reducedBrowser.headerUpdates, 3);
    assert.equal(reducedBrowser.frames.size, 0);
    controller.refresh();
    reducedBrowser.runFrame();
    assert.deepEqual(reducedUpdates.at(-1), [0.25, true]);
    controller.destroy();
  });

  const missingBrowser = new FakeBrowser();
  await withBrowser(missingBrowser, async initPageScroll => {
    const updates = [];
    const controller = initPageScroll({ contentStart: null, onUpdate: (...args) => updates.push(args) });
    missingBrowser.runFrame();
    assert.equal(missingBrowser.dispatch('wheel', { deltaY: 20 }).defaultPrevented, false);
    assert.equal(missingBrowser.dispatch('keydown', { key: 'PageDown' }).defaultPrevented, false);
    assert.equal(missingBrowser.dispatch('touchmove').defaultPrevented, false);
    assert.equal(missingBrowser.scrollCalls.length, 0);
    missingBrowser.window.scrollY = 1000;
    missingBrowser.dispatch('scroll');
    assert.equal(missingBrowser.headerUpdates, 2);
    missingBrowser.runFrame();
    assert.deepEqual(updates.at(-1), [0.25, false]);
    controller.destroy();
  });

  const destroyedBrowser = new FakeBrowser({ firefox: true });
  await withBrowser(destroyedBrowser, async initPageScroll => {
    const controller = initPageScroll({ contentStart: destroyedBrowser.contentStart() });
    destroyedBrowser.window.scrollY = 100;
    destroyedBrowser.dispatch('scroll');
    assert.ok(destroyedBrowser.frames.size > 0);
    controller.destroy();
    assert.equal(destroyedBrowser.listenerCount, 0);
    assert.equal(destroyedBrowser.frames.size, 0);
    assert.equal(destroyedBrowser.timers.size, 0);
    controller.refresh();
    assert.equal(destroyedBrowser.frames.size, 0);
  });

  const timerBrowser = new FakeBrowser();
  await withBrowser(timerBrowser, async initPageScroll => {
    const controller = initPageScroll({ contentStart: timerBrowser.contentStart() });
    timerBrowser.runFrame();
    timerBrowser.dispatch('wheel', { deltaY: 10 });
    assert.equal(timerBrowser.timers.size, 1);
    controller.destroy();
    assert.equal(timerBrowser.listenerCount, 0);
    assert.equal(timerBrowser.timers.size, 0);
  });
});

test('entrance destinations use the content element position measured at trigger time', async () => {
  const browser = new FakeBrowser();
  await withBrowser(browser, async initPageScroll => {
    const controller = initPageScroll({ contentStart: browser.contentStart() });
    browser.runFrame();
    browser.contentTop = 1600;
    browser.dispatch('wheel', { deltaY: 10 });
    assert.equal(browser.scrollCalls.at(-1)[0].top, 1600);
    assert.equal(browser.scrollCalls.at(-1)[0].behavior, 'smooth');
    controller.destroy();
  });
});

test('home, TTY2, and EFV share the controller without duplicate page listeners or lost page behavior', () => {
  const pages = [
    ['../index.html', './page-scroll.js'],
    ['../TTY2/index.html', '../page-scroll.js'],
    ['../EFV/index.html', '../page-scroll.js']
  ];
  for (const [path, importPath] of pages) {
    const html = readFileSync(new URL(path, import.meta.url), 'utf8');
    const modules = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
    assert.equal(modules.length, 1);
    const script = modules[0][1];
    assert.equal((script.match(/from ['"][^'"]*page-scroll\.js['"]/g) ?? []).length, 1);
    assert.ok(script.includes(`from '${importPath}'`));
    assert.ok(script.includes("contentStart: document.getElementById('about')"));
    assert.doesNotMatch(script, /addEventListener\(['"](?:wheel|keydown|touchmove|scroll|pageshow)['"]/);
  }

  const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tty = readFileSync(new URL('../TTY2/index.html', import.meta.url), 'utf8');
  const efv = readFileSync(new URL('../EFV/index.html', import.meta.url), 'utf8');
  const components = readFileSync(new URL('../components.js', import.meta.url), 'utf8');
  assert.match(home, /id="loadingScreen"/);
  assert.match(tty, /id="loadingScreen"/);
  assert.doesNotMatch(efv, /id="loadingScreen"|content-hidden/);
  assert.match(efv, /<section id="about" class="mb-5 raised">/);
  assert.match(efv, /<div id="bgViewer" data-src="writing\.glb" data-mobile-src="writing\.glb"><\/div>/);
  assert.equal((efv.match(/id="bgViewer"/g) ?? []).length, 1);
  assert.doesNotMatch(efv, /horse\.glb|writingViewer/);
  assert.doesNotMatch(efv, /padding-top:\s*80px/);
  assert.doesNotMatch(efv, /\.site-header\s*\{\s*transform:\s*translateY\(0\)\s*!important;\s*opacity:\s*1\s*!important;/);
  assert.doesNotMatch(components, /page === 'efv' \? ' is-visible'/);
  assert.match(efv, /modelRotation: \{ x: 90, z: 90 \},[\s\S]*?cameraElevation: 0,[\s\S]*?cameraAzimuthStart: 0,[\s\S]*?cameraAzimuthMid: null,[\s\S]*?cameraAzimuthRange: 0,[\s\S]*?cameraOscillates: false/);
  assert.match(efv, /emissionGain:\s*[0-9.]+/);
  assert.match(efv, /onUpdate\(progress, prefersReducedMotion\) \{\s*if \(prefersReducedMotion\) return;\s*viewer\.style\.opacity = String\(0\.9 - progress \* 0\.2\);/);
  assert.doesNotMatch(efv, /setProgress|writingBackground|writingViewer/);
});

test('EFV renders one centered writing model with scroll fade but no camera progress', async () => {
  const html = readFileSync(new URL('../EFV/index.html', import.meta.url), 'utf8');
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const pageScrollSource = readFileSync(new URL('../page-scroll.js', import.meta.url), 'utf8');

  async function run({ failedReady = false, reduced = false } = {}) {
    const browser = new FakeBrowser({ reduced });
    const elements = { bgViewer: { style: {} } };
    browser.document.getElementById = id => id === 'about' ? browser.contentStart() : elements[id];
    const calls = [];
    const progress = [];
    const errors = [];
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const initBackground3D = (viewer, mobileLayout, options) => {
      calls.push({ viewer, mobileLayout, options });
      return { ready, setProgress: value => progress.push(value) };
    };

    await withBrowser(browser, async initPageScroll => {
      browser.context.console = { error: message => errors.push(message) };
      await loadSourceModule(module, {
        context: browser.context,
        identifier: `file:///EFV-inline-${failedReady}-${reduced}.mjs`,
        modules: {
          '../page-scroll.js': {
            source: pageScrollSource,
            identifier: `file:///EFV-page-scroll-${failedReady}-${reduced}.mjs`
          },
          '../background3d.js': { exports: { initBackground3D } }
        }
      });
      for (let i = 0; i < 5 && calls.length === 0; i++) await Promise.resolve();
      assert.equal(calls.length, 1);
      assert.equal(calls[0].viewer, elements.bgViewer);
      assert.ok(Number.isFinite(calls[0].options.modelScale) && calls[0].options.modelScale > 0);
      assert.deepEqual(
        [calls[0].options.modelRotation.x, calls[0].options.modelRotation.z],
        [90, 90]
      );
      assert.equal(calls[0].options.cameraElevation, 0);
      assert.equal(calls[0].options.cameraAzimuthStart, 0);
      assert.equal(calls[0].options.cameraAzimuthMid, null);
      assert.equal(calls[0].options.cameraAzimuthRange, 0);
      assert.equal(calls[0].options.cameraOscillates, false);
      assert.ok(Number.isFinite(calls[0].options.desktopBloomStrength));
      assert.ok(Number.isFinite(calls[0].options.mobileBloomStrength));
      assert.ok(Number.isFinite(calls[0].options.fireMaterial.emissionGain));
      assert.ok(Number.isFinite(calls[0].options.fireMaterial.textureScaleX));
      assert.ok(Number.isFinite(calls[0].options.fireMaterial.textureOffsetX));
      assert.equal(typeof calls[0].options.fireMaterial.clampTextureX, 'boolean');
      assert.deepEqual(progress, []);

      if (failedReady) rejectReady(new Error('writing load failed'));
      else resolveReady();
      await flushMicrotasks();

      browser.runFrame();
      if (reduced) {
        assert.equal(elements.bgViewer.style.opacity, undefined);
        browser.window.scrollY = 1500;
        browser.dispatch('scroll');
        browser.runFrame();
        browser.dispatch('pageshow', { persisted: true });
        browser.runFrame();
        assert.equal(elements.bgViewer.style.opacity, undefined);
      } else {
        assert.equal(elements.bgViewer.style.opacity, '0.9');
        browser.window.scrollY = 1500;
        browser.dispatch('scroll');
        browser.runFrame();
        assert.equal(elements.bgViewer.style.opacity, '0.825');
        browser.dispatch('resize');
        browser.runFrame();
        assert.equal(elements.bgViewer.style.opacity, '0.825');
        browser.dispatch('pageshow', { persisted: true });
        browser.runFrame();
        assert.equal(elements.bgViewer.style.opacity, '0.825');
      }
      assert.deepEqual(progress, []);
      assert.equal(errors.length, failedReady ? 1 : 0);
      assert.ok(!module.includes('content-hidden'));
    });
  }

  await run();
  await run({ failedReady: true });
  await run({ reduced: true });
});
