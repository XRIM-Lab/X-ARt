import { initPageScroll } from './page-scroll.js';

export function initPage({ backgroundOptions } = {}) {
  const viewer = document.getElementById('bgViewer');
  const mobileLayout = window.matchMedia('(max-width: 767px), (pointer: coarse)');
  let background;

  const loadingScreen = document.getElementById('loadingScreen');
  const mainContent = document.querySelector('main');

  mainContent.classList.add('content-hidden');

  const pageScroll = initPageScroll({
    contentStart: document.getElementById('about'),
    onUpdate(progress, prefersReducedMotion) {
      if (prefersReducedMotion) return;
      background?.setProgress(progress);
      viewer.style.opacity = String(0.9 - progress * 0.2);
    }
  });

  const splashStartedAt = performance.now();
  let splashReleaseTimer;
  let splashReleased = false;
  const splashDeadlineTimer = setTimeout(revealPage, 1250);

  function revealPage() {
    if (splashReleased) return;
    splashReleased = true;
    clearTimeout(splashDeadlineTimer);
    clearTimeout(splashReleaseTimer);
    loadingScreen.classList.add('fade-out');
    mainContent.classList.remove('content-hidden');
    setTimeout(() => {
      loadingScreen.style.display = 'none';
    }, 350);
  }

  function hideLoadingScreen() {
    if (splashReleased || splashReleaseTimer) return;
    const minimumRemaining = 350 - (performance.now() - splashStartedAt);
    if (minimumRemaining > 0) {
      splashReleaseTimer = setTimeout(revealPage, minimumRemaining);
    } else {
      revealPage();
    }
  }

  import('./background3d.js').then(({ initBackground3D }) => {
    background = initBackground3D(viewer, mobileLayout, backgroundOptions);
    background.setProgress(pageScroll.prefersReducedMotion ? 0 : pageScroll.getProgress());
    return background.ready;
  }).then(() => {
    pageScroll.refresh();
    hideLoadingScreen();
  }, error => {
    console.error('Could not load 3D background', error);
    pageScroll.refresh();
    hideLoadingScreen();
  });
}
