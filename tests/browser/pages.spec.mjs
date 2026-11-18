import { expect, test } from '@playwright/test';
import { blockExternalAndServePackages, pageUrl } from './fixtures.mjs';

test.beforeEach(async ({ page }) => {
  await blockExternalAndServePackages(page);
});

test('first-party pages render content, local images, and layouts without overflow', async ({ page }) => {
  const pages = [
    { path: '/', heading: 'About artrio', about: true },
    { path: '/TTY2/', heading: 'About this Project', about: true },
    { path: '/EFV/', heading: 'About Performance', about: true },
    { path: '/NMM/', heading: 'Project Details', about: false }
  ];
  for (const entry of pages) {
    await page.goto(pageUrl(entry.path));
    if (entry.path !== '/EFV/') await expect(page.locator('#loadingScreen')).toBeHidden();
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
  await expect(page.getByRole('heading', { name: 'About Performance' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'About Performance' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
  expect(await page.locator('#bgViewer').evaluate(viewer => viewer.style.opacity)).toBe('');
  await context.close();
});
