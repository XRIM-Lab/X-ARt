import { expect, test } from '@playwright/test';
import { blockExternalAndServePackages, pageUrl } from './fixtures.mjs';

test.beforeEach(async ({ page }) => {
  await blockExternalAndServePackages(page);
});

async function expectAboutBelowHeader(page) {
  let previousScrollY;
  await expect.poll(async () => {
    const { y, gap } = await page.evaluate(() => ({
      y: window.scrollY,
      gap: document.getElementById('about').getBoundingClientRect().top -
        document.getElementById('siteHeader').getBoundingClientRect().height
    }));
    const stable = y === previousScrollY;
    previousScrollY = y;
    return stable ? Math.abs(gap - 8) : Infinity;
  }, { message: 'About should settle just below the fixed header' }).toBeLessThanOrEqual(4);
}

test('first-party pages render content, local images, and layouts without overflow', async ({ page }) => {
  const pages = [
    { path: '/', heading: 'About artrio', about: true },
    { path: '/TTY2/', heading: 'About this Project', about: true },
    { path: '/EFV/', heading: 'About this Project', about: true },
    { path: '/NMM/', heading: 'About this Series', about: true },
    { path: '/CSLT/', heading: 'About this Project', about: true }
  ];
  for (const entry of pages) {
    await page.goto(pageUrl(entry.path));
    await expect(page.locator('#loadingScreen')).toBeHidden();
    const main = await page.locator('main.site-container').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width, clientWidth: document.documentElement.clientWidth };
    });
    expect(Math.abs(main.width - Math.min(main.clientWidth, 1040)), `${entry.path} main width`).toBeLessThanOrEqual(1);
    expect(Math.abs(main.left + main.width / 2 - main.clientWidth / 2), `${entry.path} main centering`).toBeLessThanOrEqual(1);
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

test('desktop mouse wheel still enters the site', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'Desktop wheel input only');
  await page.goto(pageUrl('/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await page.mouse.wheel(0, 100);
  await expectAboutBelowHeader(page);
});

test('desktop wheel, keyboard, header reveal, project links, and history use the shared scroll behavior', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile-chromium';
  test.skip(isMobile, 'Desktop wheel and keyboard behavior is covered by the desktop project');
  await page.goto(pageUrl('/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator('#siteHeader')).toHaveClass(/is-visible/);
  await expectAboutBelowHeader(page);

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

test('mobile touch scroll moves through the opening without snapping', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Touch input only');
  await page.goto(pageUrl('/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();
  const session = await page.context().newCDPSession(page);
  try {
    const touchPoints = y => [{ id: 1, x: 180, y, force: 1 }];
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoints(450) });
    for (const y of [420, 390, 360, 330]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoints(y) });
      await page.waitForTimeout(16);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(30);
    await expect.poll(async () => {
      const previous = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(100);
      return Math.abs(await page.evaluate(() => window.scrollY) - previous);
    }).toBeLessThanOrEqual(1);
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeLessThan(200);
  } finally {
    await session.detach();
  }
});

test('mobile menu preserves ARIA state, dropdown, and explicit closing', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile-chromium';
  test.skip(!isMobile, 'Mobile menu behavior is covered by the mobile project');
  await page.goto(pageUrl('/TTY2/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.6));
  await expect(page.locator('#siteHeader')).toHaveClass(/is-visible/);
  await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - window.innerHeight * 0.6))).toBeLessThanOrEqual(1);

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
  await page.clock.fastForward(6000);
  await expect(page.locator('body')).toHaveClass(/nav-open/);
  await expect(efvMenuButton).toHaveAttribute('aria-expanded', 'true');
  await efvMenuButton.tap();
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

const sectionPlans = [
  { path: '/', ids: ['about', 'featured-projects', 'about', 'gallery', 'performances', 'engagement', 'team'], readingCopy: false },
  { path: '/TTY2/', ids: ['about', 'video', 'artwork', 'awards', 'gallery', 'events', 'team'], readingCopy: true, insetReadingCopy: true },
  { path: '/EFV/', ids: ['about', 'video', 'gallery', 'events', 'team'], readingCopy: true },
  { path: '/NMM/', ids: ['about', 'video', 'gallery', 'events', 'team'], readingCopy: true },
  { path: '/CSLT/', ids: ['about', 'video', 'textbox', 'gallery', 'events', 'team'], readingCopy: true }
];

for (const plan of sectionPlans) {
  test(`${plan.path} sections share a continuous blurred ribbon and even spacing`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl(plan.path));
    const carousel = page.locator('.home-gallery-carousel');
    await page.evaluate(() => {
      const element = document.querySelector('.home-gallery-carousel');
      const instance = window.bootstrap && window.bootstrap.Carousel.getInstance(element);
      if (instance) {
        instance.pause();
        instance.dispose();
      }
      window.bootstrap && window.bootstrap.Carousel.getOrCreateInstance(element, { ride: false });
    });
    await expect(page.locator('#loadingScreen')).toBeHidden();
    const contactFooter = page.getByRole('contentinfo');
    await expect(contactFooter).toHaveCount(1);
    await expect(contactFooter.getByRole('link', { name: 'braudt@ust.hk' }))
      .toHaveAttribute('href', 'mailto:braudt@ust.hk');

    const metrics = await page.evaluate(() => {
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const clamp = (minRem, vwPercent, maxRem) =>
        Math.min(Math.max(minRem * rootFontSize, (vwPercent / 100) * window.innerWidth), maxRem * rootFontSize);
      const main = document.querySelector('main.site-content');
      const mainStyles = getComputedStyle(main);
      const mainRect = main.getBoundingClientRect();
      const hero = main.querySelector(':scope > section.intro-hero');
      const heroRect = hero.getBoundingClientRect();
      const ribbon = main.querySelector(':scope > .content-ribbon');
      const ribbonRect = ribbon.getBoundingClientRect();
      const ribbonStyles = getComputedStyle(ribbon);
      const siteFooter = ribbon.querySelector(':scope > site-footer:last-child');
      const siteFooterStyles = getComputedStyle(siteFooter);
      const footer = ribbon.querySelector(':scope > site-footer:last-child > footer#contact');
      const footerRect = footer.getBoundingClientRect();
      const footerStyles = getComputedStyle(footer);
      const mainChildren = [...main.children].map(element => ({
        tag: element.tagName,
        id: element.id,
        className: typeof element.className === 'string' ? element.className : ''
      }));
      const sections = [...ribbon.querySelectorAll(':scope > section.site-section')].map(element => {
        const rect = element.getBoundingClientRect();
        const styles = getComputedStyle(element);
        const heading = element.querySelector('h2');
        const copy = element.querySelector(':scope > .reading-copy')?.getBoundingClientRect();
        return {
          id: element.id,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          paddingTop: parseFloat(styles.paddingTop),
          paddingBottom: parseFloat(styles.paddingBottom),
          paddingInlineStart: parseFloat(styles.paddingInlineStart),
          paddingInlineEnd: parseFloat(styles.paddingInlineEnd),
          backdropFilter: styles.backdropFilter,
          borderBottomWidth: styles.borderBottomWidth,
          headingLeft: heading ? heading.getBoundingClientRect().left : null,
          readingCopy: copy && { left: copy.left, width: copy.width }
        };
      });
      const team = document.getElementById('team');
      const teamStyles = getComputedStyle(team);
      const teamCols = [...team.querySelectorAll(':scope > .col')].map(col => {
        const styles = getComputedStyle(col);
        return {
          backdropFilter: styles.backdropFilter,
          paddingTop: parseFloat(styles.paddingTop),
          paddingBottom: parseFloat(styles.paddingBottom),
          paddingInlineStart: parseFloat(styles.paddingInlineStart),
          paddingInlineEnd: parseFloat(styles.paddingInlineEnd)
        };
      });
      const videoContainer = main.querySelector('.video-container');
      const videoRect = videoContainer && videoContainer.getBoundingClientRect();
      const frame = main.querySelector('.home-gallery-carousel');
      const frameRect = frame.getBoundingClientRect();
      const frameStyles = getComputedStyle(frame);
      const track = frame.querySelector('.carousel-inner');
      const trackRect = track.getBoundingClientRect();
      const activeCaption = frame.querySelector('.carousel-item.active .home-gallery-caption');
      const captionRange = document.createRange();
      captionRange.selectNodeContents(activeCaption);
      return {
        viewport: window.innerWidth,
        rem: rootFontSize,
        expectedInline: clamp(1, 3, 2),
        expectedBlock: 1.5 * rootFontSize,
        expectedGap: clamp(3, 6, 5),
        mainChildren,
        main: {
          left: mainRect.left,
          right: mainRect.right,
          paddingLeft: parseFloat(mainStyles.paddingLeft),
          paddingRight: parseFloat(mainStyles.paddingRight),
          backdropFilter: mainStyles.backdropFilter
        },
        hero: {
          bottom: heroRect.bottom,
          backdropFilter: getComputedStyle(hero).backdropFilter,
          borderBottomWidth: getComputedStyle(hero).borderBottomWidth
        },
        ribbon: {
          left: ribbonRect.left,
          right: ribbonRect.right,
          top: ribbonRect.top,
          bottom: ribbonRect.bottom,
          backdropFilter: ribbonStyles.backdropFilter
        },
        siteFooter: { display: siteFooterStyles.display },
        footer: {
          left: footerRect.left,
          right: footerRect.right,
          top: footerRect.top,
          bottom: footerRect.bottom,
          paddingTop: parseFloat(footerStyles.paddingTop),
          paddingBottom: parseFloat(footerStyles.paddingBottom),
          paddingInlineStart: parseFloat(footerStyles.paddingInlineStart),
          paddingInlineEnd: parseFloat(footerStyles.paddingInlineEnd),
          textAlign: footerStyles.textAlign,
          backgroundColor: footerStyles.backgroundColor,
          backdropFilter: footerStyles.backdropFilter
        },
        sections,
        team: {
          cols: teamCols,
          tracks: teamStyles.gridTemplateColumns.split(' ').filter(Boolean).length
        },
        video: videoRect && { width: videoRect.width, height: videoRect.height },
        carousel: {
          frame: { left: frameRect.left, top: frameRect.top, right: frameRect.right, bottom: frameRect.bottom, width: frameRect.width, height: frameRect.height },
          track: { width: trackRect.width, height: trackRect.height },
          borders: [frameStyles.borderTopWidth, frameStyles.borderRightWidth, frameStyles.borderBottomWidth, frameStyles.borderLeftWidth],
          captionRects: [...captionRange.getClientRects()].map(rect => ({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }))
        }
      };
    });

    expect(metrics.mainChildren).toEqual([
      { tag: 'SECTION', id: 'intro', className: 'intro-hero' },
      { tag: 'DIV', id: '', className: 'content-ribbon' }
    ]);
    expect(metrics.main.backdropFilter, 'main is not blurred').toBe('none');
    expect(metrics.hero.backdropFilter, 'intro hero is not blurred').toBe('none');
    const ribbonBlur = /^blur\(([\d.]+)px\)$/.exec(metrics.ribbon.backdropFilter);
    expect(ribbonBlur, 'ribbon applies a blur').not.toBeNull();
    expect(Number.parseFloat(ribbonBlur[1]), 'ribbon blur is nonzero').toBeGreaterThan(0);
    expect(metrics.hero.borderBottomWidth, 'intro hero keeps its divider').toBe('1px');
    const contentLeft = metrics.main.left + metrics.main.paddingLeft;
    const contentRight = metrics.main.right - metrics.main.paddingRight;
    expect(metrics.sections.map(section => section.id)).toEqual(plan.ids);
    expect(metrics.siteFooter.display, 'ribbon footer participates in block flow').toBe('block');
    expect(Math.abs(metrics.ribbon.left - contentLeft), 'ribbon left edge').toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.ribbon.right - contentRight), 'ribbon right edge').toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.ribbon.top - metrics.hero.bottom), 'ribbon starts at hero bottom').toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.sections[0].top - metrics.ribbon.top), 'first section starts at ribbon top').toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.footer.left - metrics.ribbon.left), 'footer left edge').toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.footer.right - metrics.ribbon.right), 'footer right edge').toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.footer.top - metrics.sections.at(-1).bottom - metrics.expectedGap), 'footer follows the last section gap').toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.footer.bottom - metrics.ribbon.bottom), 'ribbon ends at footer bottom').toBeLessThanOrEqual(1);
    expect(metrics.footer.backgroundColor, 'footer has no tint').toBe('rgba(0, 0, 0, 0)');
    expect(metrics.footer.backdropFilter, 'footer has no independent blur').toBe('none');
    for (const [name, value, expected] of [
      ['top padding', metrics.footer.paddingTop, metrics.expectedBlock],
      ['bottom padding', metrics.footer.paddingBottom, metrics.expectedBlock],
      ['inline-start padding', metrics.footer.paddingInlineStart, metrics.expectedInline],
      ['inline-end padding', metrics.footer.paddingInlineEnd, metrics.expectedInline]
    ]) {
      expect(Math.abs(value - expected), `footer ${name}`).toBeLessThanOrEqual(1);
    }
    expect(metrics.footer.textAlign, 'footer content is centered').toBe('center');
    for (const [index, section] of metrics.sections.entries()) {
      expect(section.backdropFilter, `#${section.id} does not blur independently`).toBe('none');
      expect(section.borderBottomWidth, `#${section.id} has no horizontal separator`).toBe('0px');
      expect(Math.abs(section.left - contentLeft), `#${section.id} left edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(section.right - contentRight), `#${section.id} right edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(section.paddingTop - metrics.expectedBlock), `#${section.id} block padding`).toBeLessThanOrEqual(1);
      expect(Math.abs(section.paddingBottom - metrics.expectedBlock), `#${section.id} block padding`).toBeLessThanOrEqual(1);
      expect(Math.abs(section.paddingInlineStart - metrics.expectedInline), `#${section.id} inline padding`).toBeLessThanOrEqual(1);
      expect(Math.abs(section.paddingInlineEnd - metrics.expectedInline), `#${section.id} inline padding`).toBeLessThanOrEqual(1);
      expect(Math.abs(section.headingLeft - (section.left + section.paddingInlineStart)), `#${section.id} heading inset`).toBeLessThanOrEqual(1);
      if (index > 0) {
        const gap = section.top - metrics.sections[index - 1].bottom;
        expect(Math.abs(gap - metrics.expectedGap), `gap before #${section.id}`).toBeLessThanOrEqual(1);
      }
    }
    expect(Math.abs(metrics.sections[0].top - metrics.hero.bottom), 'no extra gap before the first panel').toBeLessThanOrEqual(1);

    for (const [index, col] of metrics.team.cols.entries()) {
      expect(col.backdropFilter, `team col ${index} is not blurred`).toBe('none');
      for (const padding of [col.paddingTop, col.paddingBottom, col.paddingInlineStart, col.paddingInlineEnd]) {
        expect(padding, `team col ${index} is not padded`).toBeLessThanOrEqual(1);
      }
    }
    expect(metrics.team.tracks, 'team grid column count').toBe(metrics.viewport >= 992 ? 2 : 1);

    if (plan.readingCopy) {
      const copyIds = plan.insetReadingCopy ? ['about', 'artwork'] : ['about'];
      for (const id of copyIds) {
        const section = metrics.sections.find(entry => entry.id === id);
        const available = section.right - section.left - section.paddingInlineStart - section.paddingInlineEnd;
        const inset = plan.insetReadingCopy ? Math.max(0, (available - 50 * metrics.rem) / 2) : 0;
        const expectedWidth = Math.min(available - inset, 43 * metrics.rem);
        expect(section.readingCopy, `#${id} reading column`).toBeDefined();
        expect(Math.abs(section.readingCopy.left - (section.headingLeft + inset)), `#${id} reading-copy inset`).toBeLessThanOrEqual(1);
        expect(Math.abs(section.readingCopy.width - expectedWidth), `#${id} reading-copy width`).toBeLessThanOrEqual(1);
      }
    }

    if (metrics.video) {
      expect(Math.abs(metrics.video.height - (metrics.video.width * 9) / 16), 'video container is 16:9').toBeLessThanOrEqual(2);
    }

    const expectedRatio = metrics.viewport <= 767 ? 4 / 3 : 16 / 9;
    expect(Math.abs(metrics.carousel.frame.width - metrics.carousel.track.width), 'carousel frame tracks the inner width').toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.carousel.frame.height - metrics.carousel.track.height), 'carousel frame tracks the inner height').toBeLessThanOrEqual(1);
    expect(Math.abs((metrics.carousel.track.width / metrics.carousel.track.height) - expectedRatio), 'carousel aspect ratio').toBeLessThanOrEqual(0.02);
    for (const border of metrics.carousel.borders) {
      expect(border, 'carousel frame is borderless').toBe('0px');
    }
    expect(metrics.carousel.captionRects.length, 'active caption has text').toBeGreaterThan(0);
    for (const rect of metrics.carousel.captionRects) {
      expect(rect.left, 'caption inside frame').toBeGreaterThanOrEqual(metrics.carousel.frame.left - 1);
      expect(rect.right, 'caption inside frame').toBeLessThanOrEqual(metrics.carousel.frame.right + 1);
      expect(rect.top, 'caption inside frame').toBeGreaterThanOrEqual(metrics.carousel.frame.top - 1);
      expect(rect.bottom, 'caption inside frame').toBeLessThanOrEqual(metrics.carousel.frame.bottom + 1);
    }

    await carousel.scrollIntoViewIfNeeded();
    const items = carousel.locator('.carousel-item');
    const activeIndex = () => items.evaluateAll(elements =>
      elements.findIndex(element => element.classList.contains('active')));
    await carousel.locator('.carousel-control-next').click();
    await expect.poll(activeIndex).toBe(1);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (plan.path === '/' && metrics.viewport >= 992) {
      await page.evaluate(() => { window.location.hash = 'contact'; });
      await expect(contactFooter).toBeInViewport();
    }
  });
}

test('CSLT textboxes use text-only reading columns', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pageUrl('/CSLT/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();

  for (const id of ['about', 'textbox']) {
    const section = page.locator(`#${id}`);
    await expect(section.locator('img')).toHaveCount(0);
    const copy = section.locator(':scope > .reading-copy');
    await expect(copy).toBeVisible();
    const { width, expectedWidth } = await copy.evaluate(element => {
      const panel = element.parentElement;
      const { paddingInlineStart, paddingInlineEnd } = getComputedStyle(panel);
      const available = panel.clientWidth - parseFloat(paddingInlineStart) - parseFloat(paddingInlineEnd);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return { width: element.getBoundingClientRect().width, expectedWidth: Math.min(available, 43 * rem) };
    });
    expect(Math.abs(width - expectedWidth), `${id} reading width`).toBeLessThanOrEqual(1);
  }
});

test('NMM gallery keeps its longest caption inside the carousel frame at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pageUrl('/NMM/'));
  await page.evaluate(() => {
    const element = document.querySelector('.home-gallery-carousel');
    const instance = window.bootstrap && window.bootstrap.Carousel.getInstance(element);
    if (instance) {
      instance.pause();
      instance.dispose();
    }
    window.bootstrap && window.bootstrap.Carousel.getOrCreateInstance(element, { ride: false });
  });
  await expect(page.locator('#loadingScreen')).toBeHidden();

  const carousel = page.locator('.home-gallery-carousel');
  const captions = await carousel.locator('.home-gallery-caption').allTextContents();
  const longestIndex = captions.reduce((best, caption, index) =>
    caption.trim().length > captions[best].trim().length ? index : best, 0);
  await carousel.scrollIntoViewIfNeeded();
  await carousel.locator('.carousel-indicators button').nth(longestIndex).click();
  await expect(carousel.locator('.carousel-item').nth(longestIndex)).toHaveClass(/active/);

  const result = await page.evaluate(index => {
    const frame = document.querySelector('.home-gallery-carousel').getBoundingClientRect();
    const caption = document.querySelectorAll('.carousel-item')[index].querySelector('.home-gallery-caption');
    const range = document.createRange();
    range.selectNodeContents(caption);
    return {
      frame: { top: frame.top, right: frame.right, bottom: frame.bottom, left: frame.left },
      rects: [...range.getClientRects()].map(rect => ({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }))
    };
  }, longestIndex);
  expect(result.rects.length, 'long caption has text').toBeGreaterThan(0);
  for (const rect of result.rects) {
    expect(rect.left, 'caption inside frame').toBeGreaterThanOrEqual(result.frame.left - 1);
    expect(rect.right, 'caption inside frame').toBeLessThanOrEqual(result.frame.right + 1);
    expect(rect.top, 'caption inside frame').toBeGreaterThanOrEqual(result.frame.top - 1);
    expect(rect.bottom, 'caption inside frame').toBeLessThanOrEqual(result.frame.bottom + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('homepage logos fit the viewport at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pageUrl('/'));
  await expect(page.locator('#loadingScreen')).toBeHidden();

  const logos = await page.evaluate(() => {
    const splash = document.getElementById('loadingScreen');
    const previousDisplay = splash.style.display;
    splash.style.display = 'grid';
    const result = [...document.querySelectorAll('.site-logo')].map(logo => {
      const rect = logo.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    splash.style.display = previousDisplay;
    return result;
  });
  expect(logos).toHaveLength(2);
  for (const logo of logos) {
    expect(logo.width, 'logo width fits the viewport').toBeLessThanOrEqual(320);
    expect(logo.left, 'logo inside viewport').toBeGreaterThanOrEqual(-1);
    expect(logo.right, 'logo inside viewport').toBeLessThanOrEqual(321);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile menu on the archived SKHAF page stays open until dismissed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile menu behavior is covered by the mobile project');
  await page.route('**/skhaf.htm', route => route.abort());
  await page.clock.install();
  await page.goto(pageUrl('/TTY2/SKHAF/'));

  const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
  await menuButton.tap();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await page.clock.fastForward(6000);
  await expect(page.locator('body')).toHaveClass(/nav-open/);
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await menuButton.tap();
  await expect(page.locator('body')).not.toHaveClass(/nav-open/);
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
});

test('archived SKHAF page keeps the wide container', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'Desktop-only archive check');
  await page.route('**/skhaf.htm', route => route.abort());
  await page.goto(pageUrl('/TTY2/SKHAF/'));
  const archive = await page.evaluate(() => {
    const main = document.querySelector('main');
    const rect = main.getBoundingClientRect();
    return {
      hasSiteContent: main.classList.contains('site-content'),
      width: rect.width,
      clientWidth: document.documentElement.clientWidth
    };
  });
  expect(archive.hasSiteContent, 'archive main stays outside the live content cap').toBe(false);
  expect(Math.abs(archive.width - Math.min(archive.clientWidth, 1200)), 'archive main keeps 1200px cap').toBeLessThanOrEqual(1);
});
