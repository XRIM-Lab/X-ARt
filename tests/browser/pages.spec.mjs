import { expect, test } from '@playwright/test';
import { blockExternalAndServePackages, pageUrl } from './fixtures.mjs';

test.beforeEach(async ({ page }) => {
  await blockExternalAndServePackages(page);
});

test('first-party pages render content, local images, and layouts without overflow', async ({ page }) => {
  const pages = [
    { path: '/', heading: 'About artrio', about: true },
    { path: '/TTY2/', heading: 'About this Project', about: true },
    { path: '/EFV/', heading: 'About this Project', about: true },
    { path: '/NMM/', heading: 'About this Series', about: true }
  ];
  for (const entry of pages) {
    await page.goto(pageUrl(entry.path));
    await expect(page.locator('#loadingScreen')).toBeHidden();
    await expect(page.getByRole('heading', { name: entry.heading })).toBeVisible();
    await expect(page.locator('#intro')).toHaveCount(1);
    await expect(page.locator('#contact')).toHaveCount(1);
    if (entry.about) await expect(page.locator('#about')).toHaveCount(1);
    const localImages = await page.locator('img').evaluateAll(async images => {
      const pageOrigin = location.origin;
      const pageImages = images.filter(image => new URL(image.src).origin === pageOrigin);
      pageImages.forEach(image => { image.loading = 'eager'; });
      await Promise.all(pageImages.map(image => image.decode().catch(() => null)));
      return pageImages.map(image => ({ source: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0 }));
    });
    expect(localImages.length, `${entry.path} has no local images`).toBeGreaterThan(0);
    expect(localImages.filter(image => !image.loaded), `${entry.path} has failed local images`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('desktop wheel, keyboard, header reveal, project links, and history use the shared scroll behavior', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile-chromium';
  test.skip(isMobile, 'Desktop wheel and keyboard behavior is covered by the desktop project');
  await page.goto(pageUrl('/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator('#siteHeader')).toHaveClass(/is-visible/);
  await expect.poll(async () => page.evaluate(() => {
    const aboutTop = document.querySelector('#about').getBoundingClientRect().top + window.scrollY;
    return Math.abs(window.scrollY - aboutTop) < 8;
  })).toBe(true);

  const projects = page.locator('.has-dropdown');
  await projects.hover();
  const ttyLink = projects.locator('.dropdown-menu a').filter({ hasText: 'Through The Years, To Touch You' });
  const efvLink = projects.locator('.dropdown-menu a').filter({ hasText: 'EQUUS: FORM + VOID' });
  await expect(ttyLink).toHaveAttribute('href', 'TTY2/');
  await expect(efvLink).toHaveAttribute('href', 'EFV/');
  await efvLink.click();
  await expect(page).toHaveURL(/\/EFV\/$/);
  await expect(page.getByRole('heading', { name: 'About this Project' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'About artrio' })).toBeVisible();
});

test('mobile menu preserves ARIA state, dropdown, navigation close, and five-second auto-close', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile-chromium';
  test.skip(!isMobile, 'Mobile menu behavior is covered by the mobile project');
  await page.goto(pageUrl('/TTY2/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.6));
  await expect(page.locator('#siteHeader')).toHaveClass(/is-visible/);

  const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
  await menuButton.tap();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('body')).toHaveClass(/nav-open/);
  const projects = page.locator('.has-dropdown');
  const dropdownToggle = projects.locator('.dropdown-toggle');
  await dropdownToggle.tap();
  await expect(projects).toHaveClass(/is-open/);

  const currentProject = projects.locator('.dropdown-menu a').filter({ hasText: 'Through The Years, To Touch You' });
  await currentProject.tap();
  await expect(page.locator('body')).not.toHaveClass(/nav-open/);
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.6));
  await expect(page.locator('#siteHeader')).toHaveClass(/is-visible/);
  await menuButton.tap();
  if (await projects.evaluate(element => element.classList.contains('is-open'))) {
    await dropdownToggle.tap();
    await expect(projects).not.toHaveClass(/is-open/);
  }
  await dropdownToggle.tap();
  await expect(projects).toHaveClass(/is-open/);
  const efvLink = projects.locator('.dropdown-menu a').filter({ hasText: 'EQUUS: FORM + VOID' });
  await expect(efvLink).toHaveAttribute('href', '../EFV/');
  await efvLink.tap();
  await expect(page).toHaveURL(/\/EFV\/$/);
  await expect(page.locator('body')).not.toHaveClass(/nav-open/);

  await page.clock.install();
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.6));
  await expect(page.locator('#siteHeader')).toHaveClass(/is-visible/);
  const efvMenuButton = page.getByRole('button', { name: 'Open navigation menu' });
  await efvMenuButton.tap();
  await expect(page.locator('body')).toHaveClass(/nav-open/);
  await page.clock.fastForward(5000);
  await expect(page.locator('body')).not.toHaveClass(/nav-open/);
  await expect(efvMenuButton).toHaveAttribute('aria-expanded', 'false');
});

test('reduced motion keeps EFV scroll native and avoids opacity changes', async ({ browser }, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile-chromium';
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: isMobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile,
    hasTouch: isMobile
  });
  const page = await context.newPage();
  await blockExternalAndServePackages(page);
  await page.goto(pageUrl('/EFV/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'About this Project' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
  expect(await page.locator('#bgViewer').evaluate(viewer => viewer.style.opacity)).toBe('');
  await context.close();
});

test('CSLT shows a responsive YouTube video', async ({ page }) => {
  await page.route('https://www.youtube.com/embed/DGYPoJG8ZhY', route => route.fulfill({
    contentType: 'text/html',
    body: '<!DOCTYPE html><html><body><p>Stub YouTube embed</p></body></html>'
  }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pageUrl('/CSLT/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();
  const videoSection = page.locator('#video');
  await videoSection.scrollIntoViewIfNeeded();
  const iframe = videoSection.locator('.video-container iframe');
  await expect(iframe).toHaveAttribute('src', 'https://www.youtube.com/embed/DGYPoJG8ZhY');
  await expect(iframe).toHaveAttribute('loading', 'lazy');
  await expect(videoSection.locator('a')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=DGYPoJG8ZhY');
  await expect(page.frameLocator('#video .video-container iframe').getByText('Stub YouTube embed')).toBeVisible();
  const box = await videoSection.locator('.video-container').boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box.height - (box.width * 9) / 16)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('CSLT gallery renders and navigates every photo', async ({ page }) => {
  const expectedSources = [
    '../images/CSLT.jpeg',
    'images/L1000968-web.jpg',
    'images/L1000988-web.jpg',
    'images/L1010032-web.jpg',
    'images/L1010094-web.jpg',
    'images/L1010103-web.jpg'
  ];
  await page.goto(pageUrl('/CSLT/'));

  await page.evaluate(() => {
    const element = document.querySelector('#csltCarousel');
    const instance = window.bootstrap.Carousel.getInstance(element);
    if (instance) {
      instance.pause();
      instance.dispose();
    }
    window.bootstrap.Carousel.getOrCreateInstance(element, { ride: false });
  });
  await expect(page.locator('#loadingScreen')).toBeHidden();

  const carousel = page.locator('#csltCarousel');
  const items = carousel.locator('.carousel-item');
  const indicators = carousel.locator('.carousel-indicators button');
  await expect(items).toHaveCount(expectedSources.length);
  await expect(indicators).toHaveCount(expectedSources.length);
  expect(await items.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src'))))
    .toEqual(expectedSources);
  const captions = (await items.locator('.home-gallery-caption').allTextContents()).map(text => text.trim());
  expect(captions).toHaveLength(expectedSources.length);
  expect(captions.every(caption => caption.length > 0)).toBe(true);
  expect(await indicators.evaluateAll(buttons => buttons.map(button => ({
    slideTo: button.getAttribute('data-bs-slide-to'),
    label: button.getAttribute('aria-label')
  })))).toEqual(captions.map((caption, index) => ({ slideTo: String(index), label: `Show ${caption}` })));
  await expect(items.first()).toHaveClass(/active/);
  await expect(indicators.first()).toHaveAttribute('aria-current', 'true');

  const activeIndex = () => items.evaluateAll(elements =>
    elements.findIndex(element => element.classList.contains('active')));
  const expectSlideLoaded = async index => {
    const image = items.nth(index).locator('img');
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
    await image.evaluate(element => element.decode());
  };

  await carousel.scrollIntoViewIfNeeded();
  await expectSlideLoaded(0);

  await carousel.locator('.carousel-control-next').click();
  await expect.poll(activeIndex).toBe(1);
  await carousel.locator('.carousel-control-prev').click();
  await expect.poll(activeIndex).toBe(0);

  for (let index = 1; index < expectedSources.length; index++) {
    await indicators.nth(index).click();
    await expect.poll(activeIndex).toBe(index);
    await expect(indicators.nth(index)).toHaveAttribute('aria-current', 'true');
    await expectSlideLoaded(index);
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('CSLT sections share aligned blurred panels and even spacing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pageUrl('/CSLT/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();

  const sectionIds = ['about', 'video', 'textbox', 'gallery', 'events', 'team'];
  const metrics = await page.evaluate(ids => {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const expectedGap = Math.min(Math.max(3 * rootFontSize, 0.06 * window.innerWidth), 5 * rootFontSize);
    return {
      expectedGap,
      sections: ids.map(id => {
        const element = document.getElementById(id);
        const rect = element.getBoundingClientRect();
        const styles = getComputedStyle(element);
        return {
          id,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          paddingInlineStart: parseFloat(styles.paddingInlineStart),
          paddingInlineEnd: parseFloat(styles.paddingInlineEnd),
          backdropFilter: styles.backdropFilter
        };
      })
    };
  }, sectionIds);

  const reference = metrics.sections[0];
  for (const section of metrics.sections) {
    expect(section.backdropFilter, `${section.id} should blur its own background`).toBe('blur(3px)');
    expect(section.left, `${section.id} left edge`).toBeGreaterThanOrEqual(reference.left - 1);
    expect(section.left, `${section.id} left edge`).toBeLessThanOrEqual(reference.left + 1);
    expect(section.right, `${section.id} right edge`).toBeGreaterThanOrEqual(reference.right - 1);
    expect(section.right, `${section.id} right edge`).toBeLessThanOrEqual(reference.right + 1);
    expect(section.paddingInlineStart, `${section.id} padding-inline-start`).toBeGreaterThanOrEqual(reference.paddingInlineStart - 1);
    expect(section.paddingInlineStart, `${section.id} padding-inline-start`).toBeLessThanOrEqual(reference.paddingInlineStart + 1);
    expect(section.paddingInlineEnd, `${section.id} padding-inline-end`).toBeGreaterThanOrEqual(reference.paddingInlineEnd - 1);
    expect(section.paddingInlineEnd, `${section.id} padding-inline-end`).toBeLessThanOrEqual(reference.paddingInlineEnd + 1);
  }
  for (let index = 1; index < metrics.sections.length; index++) {
    const gap = metrics.sections[index].top - metrics.sections[index - 1].bottom;
    expect(gap, `gap before #${metrics.sections[index].id}`).toBeGreaterThanOrEqual(metrics.expectedGap - 1);
    expect(gap, `gap before #${metrics.sections[index].id}`).toBeLessThanOrEqual(metrics.expectedGap + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('CSLT illustrates About and Behind the Piece responsively', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile-chromium';
  const expected = [
    { id: 'about', src: 'images/tsunglun-web.jpg' },
    { id: 'textbox', src: 'images/pointcloud-web.png' }
  ];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pageUrl('/CSLT/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();

  for (const entry of expected) {
    const section = page.locator(`#${entry.id}`);
    const figure = section.locator('figure');
    const image = figure.locator('img');
    await expect(figure).toHaveCount(1);
    await expect(image).toHaveAttribute('src', entry.src);
    expect(await image.getAttribute('alt')).toBeTruthy();
    await expect(figure.locator('figcaption')).toHaveCount(0);
    await section.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
    const geometry = await section.evaluate(element => {
      const copy = element.querySelector('.cslt-story-copy').getBoundingClientRect();
      const fig = element.querySelector('figure').getBoundingClientRect();
      return {
        copyTop: copy.top,
        copyBottom: copy.bottom,
        copyLeft: copy.left,
        copyRight: copy.right,
        figTop: fig.top,
        figLeft: fig.left
      };
    });
    if (isMobile) {
      expect(geometry.figTop, `${entry.id} figure should sit below the copy`).toBeGreaterThanOrEqual(geometry.copyBottom - 1);
      expect(Math.abs(geometry.figLeft - geometry.copyLeft), `${entry.id} figure should share the copy left edge`).toBeLessThanOrEqual(1);
    } else {
      expect(geometry.figLeft, `${entry.id} figure should sit right of the copy`).toBeGreaterThan(geometry.copyRight);
      expect(Math.abs(geometry.figTop - geometry.copyTop), `${entry.id} figure should share the copy top edge`).toBeLessThanOrEqual(1);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
