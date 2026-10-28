import { mkdir } from 'node:fs/promises';
import { expect, chromium } from '@playwright/test';

const base = process.argv[2] ?? 'https://oyueo-mm.github.io/NebulousAI/';
const output = 'test-results/published';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: name === 'mobile', isMobile: name === 'mobile' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(base);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('세포들의 생존 경쟁.');
    await expect(page.getByTestId('home-animation')).toBeVisible();
    await expect(page.getByTestId('game-canvas')).toHaveCount(0);
    await page.screenshot({ path: `${output}/${name}-home.png` });
    await page.getByTestId('home-play').click();
    await page.getByTestId('onboarding-start').click();
    await expect(page.getByTestId('hud')).toBeVisible();
    await page.screenshot({ path: `${output}/${name}-play.png` });
    if (name === 'desktop') {
      const before = (await page.getByTestId('game-canvas').boundingBox()).width;
      await page.getByTestId('toggle-sidebar').click();
      await expect.poll(async () => (await page.getByTestId('game-canvas').boundingBox()).width).toBeGreaterThan(before + 150);
      await page.getByTestId('toggle-sidebar').click();
    } else {
      await page.getByTestId('open-sidebar').click();
      await expect(page.getByTestId('sidebar')).toHaveAttribute('aria-modal', 'true');
      await page.screenshot({ path: `${output}/${name}-menu.png` });
    }
    await page.getByTestId('mode-watch').click();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    await expect(page.getByTestId('alive-count')).toContainText('/');
    await page.screenshot({ path: `${output}/${name}-watch.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
    console.log(`${name}: home, play, sidebar, watch, overflow and console checks passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
