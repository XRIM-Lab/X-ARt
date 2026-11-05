export function initPageScroll({ contentStart, onUpdate } = {}) {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isFirefox = /Firefox\/\d/.test(navigator.userAgent);
  let lastScrollY = window.scrollY;
  let entrancePhase = 'settling';
  let settleTimer;
  let transitionTimer;
  let entranceFrame;
  let updateFrame;
  let entranceDestination;
  let destroyed = false;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getProgress() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return clamp(window.scrollY / max, 0, 1);
  }

  function getEntranceZones() {
    if (!contentStart?.getBoundingClientRect) return null;
    const aboutTop = contentStart.getBoundingClientRect().top + window.scrollY;
    const buffer = Math.min(window.innerHeight * 0.2, aboutTop * 0.25);
    return { aboutTop, heroEnd: buffer, contentStart: aboutTop - buffer };
  }

  function getEntrancePhase() {
    const zones = getEntranceZones();
    if (!zones) return 'neutral';
    return window.scrollY <= zones.heroEnd ? 'hero' : window.scrollY >= zones.contentStart ? 'content' : 'neutral';
  }

  function updateHeader() {
    if (window._onScrollMenu) window._onScrollMenu();
  }

  function update() {
    updateFrame = undefined;
    if (!destroyed) onUpdate?.(getProgress(), prefersReducedMotion);
  }

  function refresh() {
    if (destroyed || updateFrame !== undefined) return;
    updateFrame = requestAnimationFrame(update);
  }

  function cancelUpdate() {
    if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
    updateFrame = undefined;
  }

  function settleEntrance() {
    clearTimeout(transitionTimer);
    transitionTimer = undefined;
    clearTimeout(settleTimer);
    entrancePhase = 'settling';
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      if (destroyed) return;
      lastScrollY = window.scrollY;
      entrancePhase = getEntrancePhase();
    }, 160);
  }

  function runEntranceScroll(destination) {
    if (destroyed || !getEntranceZones()) return;
    clearTimeout(settleTimer);
    settleTimer = undefined;
    entrancePhase = 'animating';
    entranceDestination = destination;
    if (isFirefox) {
      const start = window.scrollY;
      const distance = destination - start;
      const startedAt = performance.now();
      function animateEntrance(now) {
        if (destroyed) return;
        const progress = clamp((now - startedAt) / 600, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        window.scrollTo(0, start + distance * eased);
        if (progress < 1) {
          entranceFrame = requestAnimationFrame(animateEntrance);
        } else {
          entranceFrame = undefined;
          lastScrollY = window.scrollY;
          settleEntrance();
        }
      }
      entranceFrame = requestAnimationFrame(animateEntrance);
    } else {
      window.scrollTo({ top: destination, behavior: 'smooth' });
      transitionTimer = setTimeout(settleEntrance, 2400);
    }
  }

  function onWheel(event) {
    if (destroyed || event.ctrlKey) return;
    if (entrancePhase === 'animating' || (!isFirefox && entrancePhase === 'settling')) {
      if (event.cancelable) event.preventDefault();
      return;
    }
    if (isFirefox || prefersReducedMotion || event.deltaY <= 0 || !event.cancelable) return;
    const zones = getEntranceZones();
    if (zones && window.scrollY <= zones.heroEnd) {
      event.preventDefault();
      lastScrollY = window.scrollY;
      runEntranceScroll(zones.aboutTop);
    }
  }

  function onKeyDown(event) {
    if (destroyed) return;
    if ((entrancePhase === 'animating' || (!isFirefox && entrancePhase === 'settling')) &&
      ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
    }
  }

  function onTouchMove(event) {
    if (destroyed) return;
    if (entrancePhase === 'animating' || (!isFirefox && entrancePhase === 'settling')) event.preventDefault();
  }

  function onScroll() {
    if (destroyed) return;
    updateHeader();

    const currentScrollY = window.scrollY;
    const previousScrollY = lastScrollY;
    lastScrollY = currentScrollY;
    const zones = getEntranceZones();
    if (!zones) entrancePhase = 'neutral';

    if (!prefersReducedMotion && !isFirefox && entrancePhase === 'animating' &&
      Math.abs(currentScrollY - entranceDestination) < 4) {
      settleEntrance();
    }

    if (!prefersReducedMotion && zones && entrancePhase !== 'animating') {
      if (entrancePhase === 'settling') {
        settleEntrance();
      } else {
        const entering = entrancePhase === 'hero' && currentScrollY > previousScrollY &&
          previousScrollY <= zones.heroEnd && currentScrollY > 0 && currentScrollY < zones.aboutTop;
        const leaving = entrancePhase === 'content' && currentScrollY < previousScrollY &&
          previousScrollY >= zones.contentStart && previousScrollY <= zones.aboutTop + window.innerHeight &&
          currentScrollY < zones.aboutTop && currentScrollY > 0;
        if (entering) {
          runEntranceScroll(zones.aboutTop);
        } else if (leaving) {
          runEntranceScroll(0);
        } else if (currentScrollY <= zones.heroEnd) {
          entrancePhase = 'hero';
        } else if (currentScrollY >= zones.contentStart) {
          entrancePhase = 'content';
        } else {
          entrancePhase = 'neutral';
        }
      }
    }

    if (prefersReducedMotion) return;
    refresh();
  }

  function onPageshow(event) {
    if (destroyed || (!event.persisted && entrancePhase === 'animating')) return;
    clearTimeout(settleTimer);
    settleTimer = undefined;
    clearTimeout(transitionTimer);
    transitionTimer = undefined;
    if (entranceFrame !== undefined) cancelAnimationFrame(entranceFrame);
    entranceFrame = undefined;
    cancelUpdate();
    lastScrollY = window.scrollY;
    entrancePhase = getEntrancePhase();
    updateHeader();
    refresh();
  }

  function onResize() {
    if (destroyed) return;
    updateHeader();
    if (!prefersReducedMotion) refresh();
  }

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pageshow', onPageshow);
  window.addEventListener('resize', onResize);
  entrancePhase = getEntrancePhase();
  updateHeader();
  refresh();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pageshow', onPageshow);
    window.removeEventListener('resize', onResize);
    clearTimeout(settleTimer);
    clearTimeout(transitionTimer);
    if (entranceFrame !== undefined) cancelAnimationFrame(entranceFrame);
    entranceFrame = undefined;
    cancelUpdate();
  }

  return { getProgress, refresh, destroy, prefersReducedMotion };
}
