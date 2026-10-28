import { expect, test, type Page } from '@playwright/test';

async function navigate(page: Page, route: string) {
  if (await page.getByTestId('open-sidebar').isVisible()) await page.getByTestId('open-sidebar').click();
  await page.getByTestId(`mode-${route}`).click();
}

test('home is the entry page; play guide appears only after entering play', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('세포들의 생존 경쟁.');
  await expect(page.getByTestId('home-animation')).toBeVisible();
  await expect(page.getByTestId('game-canvas')).toHaveCount(0);
  await expect(page.getByTestId('onboarding')).toHaveCount(0);
  await page.getByTestId('home-play').click();
  await expect(page).toHaveURL(/#\/play$/);
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await page.getByTestId('onboarding-start').click();
  await page.goBack();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('home-watch').click();
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  await expect(page.getByTestId('onboarding')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('alive-count')).toContainText('/');
  await page.goBack();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('all sidebar routes work and preserve active navigation on refresh', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nebulousai.onboarding.never', '1'));
  await page.goto('./');
  for (const route of ['play', 'watch', 'tournament', 'lab', 'home']) {
    await navigate(page, route);
    await expect(page).toHaveURL(new RegExp(`#/${route}$`));
    await expect(page.getByTestId(`mode-${route}`)).toHaveAttribute('aria-current', 'page');
    await page.reload();
    await expect(page.getByTestId(`mode-${route}`)).toHaveAttribute('aria-current', 'page');
    if (route === 'lab') await expect(page.getByTestId('lab-view')).toBeVisible();
  }
  await page.goto('./#watch');
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  await expect(page.getByTestId('mode-watch')).toHaveAttribute('aria-current', 'page');
});

test('desktop collapse resizes the canvas backing store and keeps settings separate', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop sidebar');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./#/watch');
  const canvas = page.getByTestId('game-canvas');
  await expect(canvas).toBeVisible();
  const before = (await canvas.boundingBox())!.width;
  await page.getByTestId('toggle-sidebar').click();
  await expect(page.getByTestId('toggle-sidebar')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(before + 150);
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => Math.abs(c.width - c.getBoundingClientRect().width * Math.min(devicePixelRatio, 2)))).toBeLessThan(3);
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('toggle-sidebar')).toHaveAttribute('aria-expanded', 'false');
  await page.getByTestId('toggle-sidebar').click();
  await expect.poll(async () => Math.abs((await canvas.boundingBox())!.width - before)).toBeLessThan(2);
});

test('mobile drawer traps focus and closes via Escape, backdrop, close button and navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  const opener = page.getByTestId('open-sidebar');
  await opener.click();
  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar).toHaveAttribute('aria-modal', 'true');
  await expect(sidebar.getByRole('button', { name: '메뉴 닫기' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('mode-lab')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sidebar.getByRole('button', { name: '메뉴 닫기' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await opener.click();
  await page.getByTestId('sidebar-backdrop').click({ position: { x: 350, y: 400 } });
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await opener.click();
  await sidebar.getByRole('button', { name: '메뉴 닫기' }).click();
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await navigate(page, 'watch');
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('game-canvas')).toBeVisible();
});

test('home canvas respects reduced motion and resumes when motion is enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const canvas = page.getByTestId('home-animation');
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0);
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => {
    const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    return pixels.some((_, i) => i % 4 === 0 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 30);
  })).toBe(true);
  const still = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.waitForTimeout(300);
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(still);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(still);
});

test.describe('home layouts', () => {
  test.skip(({ isMobile }) => isMobile, 'uses independent viewport sizes');
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 768], [768, 1024], [390, 844], [375, 667]]) {
    test(`${width}×${height}: home content fits and canvas is painted`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await page.goto('./');
      await expect(page.getByTestId('home-play')).toBeInViewport();
      await expect(page.getByTestId('home-watch')).toBeInViewport();
      await expect(page.getByTestId('home-animation')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await expect.poll(() => page.getByTestId('home-animation').evaluate((c: HTMLCanvasElement) => {
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        return data.some((v, i) => i % 4 === 3 && v > 0);
      })).toBe(true);
      await page.screenshot({ path: info.outputPath(`home-${width}.png`) });
    });
  }
});
