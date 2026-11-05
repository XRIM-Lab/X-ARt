import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FakeBrowser } from './helpers/fake-browser.mjs';
import { loadSourceModule } from './helpers/vm-modules.mjs';

const pageScrollSource = readFileSync(new URL('../page-scroll.js', import.meta.url), 'utf8');
let runId = 0;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function bootPage(page, { reduced = false, importFailure = false, initFailure = false } = {}) {
  const browser = new FakeBrowser({ reduced });
  const file = page === 'home' ? '../index.html' : page === 'tty2' ? '../TTY2/index.html' : '../EFV/index.html';
  const text = await readFile(new URL(file, import.meta.url), 'utf8');
  const script = text.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, `missing ${page} module script`);
  const calls = [];
  const progress = [];
  const ready = deferred();
  const initBackground3D = (viewer, mobileLayout, options) => {
    calls.push({ viewer, mobileLayout, options });
    if (initFailure) throw new Error('renderer init failed');
    return { ready: ready.promise, setProgress: value => progress.push(value) };
  };
  const pageScrollImport = page === 'home' ? './page-scroll.js' : '../page-scroll.js';
  const backgroundImport = page === 'home' ? './background3d.js' : '../background3d.js';
  const modules = {
    [pageScrollImport]: {
      source: pageScrollSource,
      identifier: `file:///page-scroll-${++runId}.mjs`
    },
    [backgroundImport]: importFailure
      ? { error: new Error('background module unavailable') }
      : { exports: { initBackground3D } }
  };

  await loadSourceModule(script, {
    context: browser.context,
    identifier: `file:///pages-${page}-${runId}.mjs`,
    modules
  });
  await flushMicrotasks();
  return { browser, calls, progress, ready };
}

test('home and TTY2 keep splash minimum, deadline, and idempotent release behavior', async () => {
  for (const page of ['home', 'tty2']) {
    const { browser, calls, progress, ready } = await bootPage(page);
    const main = browser.document.querySelector('main');
    const loadingScreen = browser.document.getElementById('loadingScreen');
    assert.equal(calls.length, 1);
    assert.equal(main.classList.contains('content-hidden'), true);
    assert.deepEqual(progress, [0]);
    browser.runFrame();
    browser.advance(100);
    ready.resolve();
    await flushMicrotasks();
    browser.advance(249);
    assert.equal(loadingScreen.classList.contains('fade-out'), false);
    browser.advance(1);
    assert.equal(loadingScreen.classList.contains('fade-out'), true);
    assert.equal(main.classList.contains('content-hidden'), false);
    browser.advance(350);
    assert.equal(loadingScreen.style.display, 'none');
    ready.resolve();
    await flushMicrotasks();
    assert.equal(browser.timers.size, 0);
  }

  const late = await bootPage('home');
  const lateMain = late.browser.document.querySelector('main');
  const lateLoading = late.browser.document.getElementById('loadingScreen');
  late.browser.advance(1250);
  assert.equal(lateLoading.classList.contains('fade-out'), true);
  assert.equal(lateMain.classList.contains('content-hidden'), false);
  late.ready.resolve();
  await flushMicrotasks();
  late.browser.advance(350);
  assert.equal(lateLoading.style.display, 'none');
  assert.equal(late.browser.timers.size, 0);
});

test('home and TTY2 renderer import, initialization, and ready failures release visible content', async () => {
  for (const page of ['home', 'tty2']) {
    const imported = await bootPage(page, { importFailure: true });
    assert.equal(imported.calls.length, 0);
    assert.equal(imported.browser.listeners.has('scroll'), true);
    assert.equal(imported.browser.document.querySelector('main').classList.contains('content-hidden'), true);
    imported.browser.advance(350);
    assert.equal(imported.browser.document.querySelector('main').classList.contains('content-hidden'), false);
    assert.equal(imported.browser.errors.length, 1);

    const initialized = await bootPage(page, { initFailure: true });
    assert.equal(initialized.calls.length, 1);
    initialized.browser.advance(350);
    assert.equal(initialized.browser.document.querySelector('main').classList.contains('content-hidden'), false);
    assert.equal(initialized.browser.errors.length, 1);

    const failedReady = await bootPage(page);
    failedReady.ready.reject(new Error('background load failed'));
    await flushMicrotasks();
    failedReady.browser.advance(350);
    assert.equal(failedReady.browser.document.querySelector('main').classList.contains('content-hidden'), false);
    assert.equal(failedReady.browser.errors.length, 1);
    assert.equal(failedReady.browser.listeners.has('scroll'), true);
  }
});

test('reduced motion keeps home and TTY2 camera/fade updates disabled', async () => {
  for (const page of ['home', 'tty2']) {
    const result = await bootPage(page, { reduced: true });
    const viewer = result.browser.document.getElementById('bgViewer');
    assert.deepEqual(result.progress, [0]);
    result.ready.resolve();
    await flushMicrotasks();
    result.browser.runFrame();
    result.browser.window.scrollY = 1500;
    result.browser.dispatch('scroll');
    result.browser.runFrame();
    assert.deepEqual(result.progress, [0]);
    assert.equal(viewer.style.opacity, undefined);
  }
});

test('EFV has no splash gate and remains scroll-readable when renderer import or load fails', async () => {
  for (const options of [{ importFailure: true }, { initFailure: true }, {}]) {
    const result = await bootPage('efv', options);
    const main = result.browser.document.querySelector('main');
    assert.equal(main.classList.contains('content-hidden'), false);
    assert.equal(result.browser.listeners.has('scroll'), true);
    if (options.importFailure || options.initFailure) {
      result.browser.advance(5000);
      assert.equal(main.classList.contains('content-hidden'), false);
      assert.equal(result.browser.errors.length, 1);
      continue;
    }
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].viewer, result.browser.document.getElementById('bgViewer'));
    result.ready.reject(new Error('writing model load failed'));
    await flushMicrotasks();
    result.browser.window.scrollY = 1500;
    result.browser.dispatch('scroll');
    result.browser.runFrame();
    assert.equal(result.browser.document.getElementById('bgViewer').style.opacity, '0.825');
    assert.deepEqual(result.progress, []);
    assert.equal(result.browser.errors.length, 1);
  }

  const reduced = await bootPage('efv', { reduced: true });
  const viewer = reduced.browser.document.getElementById('bgViewer');
  reduced.ready.resolve();
  await flushMicrotasks();
  reduced.browser.runFrame();
  reduced.browser.window.scrollY = 1500;
  reduced.browser.dispatch('scroll');
  reduced.browser.dispatch('pageshow', { persisted: true });
  reduced.browser.runFrame();
  assert.equal(viewer.style.opacity, undefined);
  assert.deepEqual(reduced.progress, []);
});
