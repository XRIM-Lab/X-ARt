export function initPageScroll({ contentStart, onUpdate } = {}) {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const isFirefox = /Firefox\/\d/.test(navigator.userAgent);
  let entrancePhase = 'neutral';
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
    const headerHeight = document.getElementById('siteHeader')?.getBoundingClientRect().height ?? 0;
    const landingTop = Math.max(0, aboutTop - (headerHeight > 0 ? Math.ceil(headerHeight) + 8 : 0));
    const buffer = Math.min(window.innerHeight * 0.2, aboutTop * 0.25);
    return { landingTop, heroEnd: buffer, contentStart: landingTop - buffer };
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
      if (!destroyed) entrancePhase = 'neutral';
    }, 160);
  }

  function runEntranceScroll(destination) {
    if (destroyed) return;
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
          settleEntrance();
        }
      }
      entranceFrame = requestAnimationFrame(animateEntrance);
    } else {
      window.scrollTo({ top: destination, behavior: 'smooth' });
      transitionTimer = setTimeout(settleEntrance, 2400);
    }
  }

  function isEntranceLocked() {
    return entrancePhase === 'animating' || (!isFirefox && entrancePhase === 'settling');
  }

  function cancelEntrance() {
    clearTimeout(settleTimer);
    settleTimer = undefined;
    clearTimeout(transitionTimer);
    transitionTimer = undefined;
    if (entranceFrame !== undefined) cancelAnimationFrame(entranceFrame);
    entranceFrame = undefined;
    entrancePhase = 'neutral';
  }

  function allowNativeScroll() {
    if (entrancePhase === 'neutral') return;
    const wasSmoothScrolling = !isFirefox && entrancePhase === 'animating';
    cancelEntrance();
    if (wasSmoothScrolling) window.scrollTo({ top: window.scrollY, behavior: 'instant' });
  }

  function isDiscreteWheel(event) {
    // WheelEvent does not identify the device; let ambiguous pixel deltas scroll natively.
    const mode = event.deltaMode;
    if (event.deltaX !== 0 || !Number.isInteger(event.deltaY) || event.deltaY === 0) return false;
    if (mode === 1 || mode === 2) return true;
    const ticks = event.wheelDeltaY;
    return Number.isFinite(ticks) && ticks !== 0 && ticks % 120 === 0;
  }

  function snapForDirection(event, direction) {
    if (!event.cancelable) return;
    const zones = getEntranceZones();
    if (!zones) return;
    const y = window.scrollY;
    if (direction > 0 && y <= zones.heroEnd) {
      event.preventDefault();
      runEntranceScroll(zones.landingTop);
    } else if (direction < 0 && y > 0 && y >= zones.contentStart && y <= zones.landingTop + 4) {
      event.preventDefault();
      runEntranceScroll(0);
    }
  }

  function onWheel(event) {
    if (destroyed || event.defaultPrevented || event.ctrlKey || event.shiftKey || prefersReducedMotion) return;
    if (coarsePointer.matches || !isDiscreteWheel(event)) {
      allowNativeScroll();
      return;
    }
    if (isEntranceLocked()) {
      if (event.cancelable) event.preventDefault();
      return;
    }
    snapForDirection(event, event.deltaY);
  }

  function onKeyDown(event) {
    if (destroyed || event.defaultPrevented || prefersReducedMotion || coarsePointer.matches ||
        event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target && event.target !== document.body && event.target !== document.documentElement) return;
    const direction = ['ArrowDown', 'PageDown'].includes(event.key) ? 1 :
      ['ArrowUp', 'PageUp'].includes(event.key) ? -1 : event.key === ' ' ? (event.shiftKey ? -1 : 1) : 0;
    if (!direction) return;
    if (isEntranceLocked()) {
      if (event.cancelable) event.preventDefault();
      return;
    }
    snapForDirection(event, direction);
  }

  function onScroll() {
    if (destroyed) return;
    updateHeader();
    if (prefersReducedMotion) return;
    if (!isFirefox && entrancePhase === 'animating' &&
      Math.abs(window.scrollY - entranceDestination) < 4) {
      settleEntrance();
    }
    refresh();
  }

  function onPageshow(event) {
    if (destroyed || (!event.persisted && entrancePhase === 'animating')) return;
    cancelEntrance();
    cancelUpdate();
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
  window.addEventListener('touchstart', allowNativeScroll, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pageshow', onPageshow);
  window.addEventListener('resize', onResize);
  updateHeader();
  refresh();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('touchstart', allowNativeScroll);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pageshow', onPageshow);
    window.removeEventListener('resize', onResize);
    cancelEntrance();
    cancelUpdate();
  }

  return { getProgress, refresh, destroy, prefersReducedMotion };
}
