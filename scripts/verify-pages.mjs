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
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.__lastInput = null;
      window.Worker = class extends NativeWorker {
        postMessage(message, ...args) {
          if (message.type === 'input') window.__lastInput = message.action;
          super.postMessage(message, ...args);
        }
      };
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(base);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('세포들의 생존 경쟁.');
    await expect(page.getByTestId('home-animation')).toBeVisible();
    await expect(page.getByTestId('game-canvas')).toHaveCount(0);
    await expect.poll(() => page.workers().length).toBe(2); // idle game worker + independent home match
    await expect(page.locator('.sidebar-brand svg radialGradient')).toHaveCount(0);
    const favicon = await (await page.request.get(new URL('favicon.svg', base).href)).text();
    expect(favicon).toContain('#A83557'); expect(favicon).not.toMatch(/gradient/i);
    if (name === 'desktop') expect(await page.locator('.home h1').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(60);
    await page.waitForTimeout(300); // initial worker frame before capturing the hero
    await page.screenshot({ path: `${output}/${name}-home.png` });
    await page.getByTestId('home-play').click();
    await page.getByTestId('onboarding-start').click();
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('play-pause')).toHaveAttribute('aria-label', '일시정지 (P)');
    await expect.poll(() => page.workers().length).toBe(1);
    await expect(page.locator('header').getByTestId('toggle-right')).toBeVisible();
    await expect(page.getByTestId('dock').getByTestId('toggle-right')).toHaveCount(0);
    const input = () => page.evaluate(() => window.__lastInput && ({ dx: window.__lastInput.dx, dy: window.__lastInput.dy }));
    await page.getByTestId('game-canvas').hover();
    await expect.poll(input).toEqual({ dx: 0, dy: 0 });
    await page.keyboard.down('KeyD');
    await expect.poll(input).toEqual({ dx: 1, dy: 0 });
    await page.waitForTimeout(150);
    await page.keyboard.up('KeyD');
    await page.keyboard.down('ArrowUp');
    await expect.poll(input).toEqual({ dx: 0, dy: -1 });
    await page.waitForTimeout(150);
    await page.keyboard.up('ArrowUp');
    await expect.poll(input).toEqual({ dx: 0, dy: 0 });
    await page.screenshot({ path: `${output}/${name}-play.png` });
    if (name === 'desktop') {
      const before = (await page.getByTestId('game-canvas').boundingBox()).width;
      await page.getByTestId('toggle-sidebar').click();
      await expect.poll(async () => (await page.getByTestId('game-canvas').boundingBox()).width).toBeGreaterThan(before + 150);
      await page.getByTestId('toggle-sidebar').click();
    } else {
      await page.getByTestId('open-sidebar').click();
      await expect(page.getByTestId('sidebar')).toHaveAttribute('aria-modal', 'true');
      await expect(page.locator('.drawer-close')).toBeFocused();
      await page.screenshot({ path: `${output}/${name}-menu.png` });
    }
    await page.getByTestId('mode-watch').click();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    await expect(page.getByTestId('alive-count')).toContainText('/');
    const settings = page.locator('header').getByTestId('toggle-right');
    if (await settings.getAttribute('aria-expanded') === 'true') await settings.click();
    await settings.click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await settings.click();
    await expect(page.getByTestId('settings-panel')).toHaveCount(0);
    await page.screenshot({ path: `${output}/${name}-watch.png` });
    if (await page.getByTestId('open-sidebar').isVisible()) await page.getByTestId('open-sidebar').click();
    await page.getByTestId('mode-tournament').click();
    await page.getByTestId('t-seeds').fill('2');
    await page.getByTestId('t-seconds').fill('20');
    await page.getByTestId('t-run').click();
    await expect(page.getByTestId('t-report').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('t-run')).toBeVisible({ timeout: 60000 });
    await page.screenshot({ path: `${output}/${name}-tournament.png` });
    if (await page.getByTestId('open-sidebar').isVisible()) await page.getByTestId('open-sidebar').click();
    await page.getByTestId('mode-lab').click();
    await expect(page.getByTestId('lab-view')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
    console.log(`${name}: flat logo, engine worker lifecycle, home layout, keyboard-only input, header settings, sidebar, watch, tournament, lab and console checks passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
