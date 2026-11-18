import vm from 'node:vm';

export class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values);
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

export class FakeElement {
  constructor(browser, id = '') {
    this.browser = browser;
    this.id = id;
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.textContent = '';
    this.innerHTML = '';
    this.listeners = new Map();
  }

  getBoundingClientRect() {
    return { top: this.browser.contentTop - this.browser.window.scrollY, left: 0, width: 0, height: 0 };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

export class FakeBrowser {
  constructor({
    firefox = false,
    reduced = false,
    mobile = false,
    innerHeight = 1000,
    innerWidth = 1280,
    scrollHeight = 5000,
    scrollY = 0,
    contentTop = 1000
  } = {}) {
    this.now = 0;
    this.nextId = 1;
    this.frames = new Map();
    this.timers = new Map();
    this.listeners = new Map();
    this.scrollCalls = [];
    this.headerUpdates = 0;
    this.contentTop = contentTop;
    this.scrollHeight = scrollHeight;
    this.elements = new Map();
    this.mediaQueryLists = new Map();
    this.errors = [];
    const browser = this;
    this.window = {
      innerHeight,
      innerWidth,
      devicePixelRatio: 1,
      scrollY,
      location: { href: 'http://localhost/' },
      _onScrollMenu() {
        browser.headerUpdates++;
      },
      addEventListener(type, listener, options) {
        browser.addEventListener(type, listener, options);
      },
      removeEventListener(type, listener) {
        browser.removeEventListener(type, listener);
      },
      matchMedia(query) {
        if (!browser.mediaQueryLists.has(query)) {
          const listeners = new Set();
          browser.mediaQueryLists.set(query, {
            media: query,
            matches: query.includes('prefers-reduced-motion') ? reduced : query.includes('pointer: coarse') ? mobile : false,
            addEventListener(type, listener) {
              if (type === 'change') listeners.add(listener);
            },
            removeEventListener(type, listener) {
              if (type === 'change') listeners.delete(listener);
            },
            listeners
          });
        }
        return browser.mediaQueryLists.get(query);
      },
      scrollTo(...args) {
        browser.scrollCalls.push(args);
        if (typeof args[0] === 'number') this.scrollY = args[1];
      }
    };
    this.document = {
      hidden: false,
      body: this.element('body'),
      documentElement: {
        get scrollHeight() {
          return browser.scrollHeight;
        }
      },
      getElementById(id) {
        return browser.element(id);
      },
      querySelector(selector) {
        if (selector === 'main') return browser.element('main');
        return null;
      },
      addEventListener(type, listener, options) {
        browser.addEventListener(`document:${type}`, listener, options);
      },
      removeEventListener(type, listener) {
        browser.removeEventListener(`document:${type}`, listener);
      }
    };
    this.navigator = { userAgent: firefox ? 'Firefox/120.0' : 'TestBrowser/1.0' };
    this.performance = { now: () => this.now };
    this.console = { error: (...args) => this.errors.push(args) };
    this.window.requestAnimationFrame = callback => this.requestAnimationFrame(callback);
    this.window.cancelAnimationFrame = id => this.cancelAnimationFrame(id);
    this.window.setTimeout = (callback, delay) => this.setTimeout(callback, delay);
    this.window.clearTimeout = id => this.clearTimeout(id);
    this.context = vm.createContext({
      window: this.window,
      document: this.document,
      navigator: this.navigator,
      performance: this.performance,
      requestAnimationFrame: this.window.requestAnimationFrame,
      cancelAnimationFrame: this.window.cancelAnimationFrame,
      setTimeout: this.window.setTimeout,
      clearTimeout: this.window.clearTimeout,
      console: this.console
    });
  }

  element(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement(this, id));
    return this.elements.get(id);
  }

  setMedia(query, matches) {
    const mediaQueryList = this.window.matchMedia(query);
    mediaQueryList.matches = matches;
    for (const listener of mediaQueryList.listeners) listener({ matches });
  }

  addEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, options });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry.listener !== listener));
  }

  dispatch(type, event = {}) {
    const dispatched = {
      cancelable: true,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...event
    };
    for (const { listener } of this.listeners.get(type) ?? []) listener(dispatched);
    return dispatched;
  }

  requestAnimationFrame(callback) {
    const id = this.nextId++;
    this.frames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id) {
    this.frames.delete(id);
  }

  runFrame(now = this.now) {
    this.now = now;
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    callbacks.forEach(callback => callback(now));
  }

  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.timers.set(id, { callback, at: this.now + delay });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  advance(ms) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      this.now = timer.at;
      this.timers.delete(id);
      timer.callback();
    }
    this.now = end;
  }

  contentStart() {
    return this.element('about');
  }

  get listenerCount() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.length, 0);
  }
}
