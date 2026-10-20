import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

/** Fails the test on console errors, page errors and any HTTP error response. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return errors;
}

/** Samples the canvas backing store: how many pixels differ from the empty-page background. */
async function canvasInk(page: Page): Promise<{ w: number; h: number; ink: number; colours: number }> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=game-canvas]')!;
    const ctx = c.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let ink = 0;
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      colours.add((r << 16) | (g << 8) | b);
      if (Math.abs(r - 0xf4) + Math.abs(g - 0xf6) + Math.abs(b - 0xfb) > 12 && !(r === 255 && g === 255 && b === 255)) ink++;
    }
    return { w: c.width, h: c.height, ink, colours: colours.size };
  });
}

async function expectWorldVisible(page: Page) {
  const s = await canvasInk(page);
  expect(s.w).toBeGreaterThan(10);
  expect(s.colours).toBeGreaterThan(8); // food, cells, grid, arena: never a flat or black canvas
  expect(s.ink).toBeGreaterThan(20);
}

const seconds = async (page: Page) => {
  const t = (await page.getByTestId('match-time').textContent()) ?? '0:00';
  const [m, s] = t.split(':').map(Number);
  return m * 60 + s;
};

async function openAdvanced(page: Page) {
  if (!(await page.getByTestId('settings-panel').isVisible())) await page.getByTestId('toggle-right').click();
  await page.getByRole('button', { name: /advanced physics/i }).click();
}

async function setNumber(page: Page, label: string, value: number) {
  const input = page.getByTestId('settings-panel').locator('label', { hasText: label }).locator('input');
  await input.fill(String(value));
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop flows');

  test('play mode loads, renders the world and the player grows by eating', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./#play');
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('hud-mass')).toHaveText('20');
    await expectWorldVisible(page);
    const box = (await page.getByTestId('game-canvas').boundingBox())!;
    let grown = false;
    for (let i = 0; i < 40 && !grown; i++) {
      const a = i * 0.5;
      await page.mouse.move(box.x + box.width / 2 + Math.cos(a) * 250, box.y + box.height / 2 + Math.sin(a) * 250);
      await page.waitForTimeout(250);
      grown = Number(await page.getByTestId('hud-mass').textContent()) > 20;
    }
    expect(grown).toBe(true);
    expect(await seconds(page)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('split, merge and eject change cells and mass as the rules say', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./#play');
    await openAdvanced(page);
    await setNumber(page, 'Start mass', 120);
    await setNumber(page, 'Merge base time', 1);
    await setNumber(page, 'Mass decay', 0);
    await page.getByTestId('apply-settings').click();
    await expect(page.getByTestId('hud-mass')).toHaveText('120');
    const cells = () => page.getByTestId('hud-cells').textContent();
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Space');
    await expect.poll(cells, { timeout: 4000 }).toBe('2');
    await expect.poll(cells, { timeout: 12000 }).toBe('1'); // merged back after the shortened timer
    const before = Number(await page.getByTestId('hud-mass').textContent());
    await page.keyboard.press('KeyE');
    await expect.poll(async () => Number(await page.getByTestId('hud-mass').textContent()), { timeout: 3000 }).toBeLessThanOrEqual(before - 15);
    expect(errors).toEqual([]);
  });

  test('a saved state with the player inside a predator loads, ends the game and restarts', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto('./#play');
    await expect(page.getByTestId('hud')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-experiment').click()]);
    const file = info.outputPath('state.json');
    await download.saveAs(file);
    const exp = JSON.parse(readFileSync(file, 'utf8'));
    expect(exp.format).toBe('nebulous-experiment');
    const world = exp.snapshot.world;
    const me = world.cells.find((c: { owner: number }) => c.owner === 0);
    const foe = world.cells.find((c: { owner: number }) => c.owner === 1);
    Object.assign(foe, { x: me.x, y: me.y, mass: 900, r: Math.sqrt(900 * 16) });
    world.agents[1].totalMass = 900;
    world.ledger.agentSpawned += 900 - 20;
    const edited = info.outputPath('edited.json');
    writeFileSync(edited, JSON.stringify(exp));
    await page.getByTestId('load-experiment').setInputFiles(edited);
    await page.getByTestId('play-pause').click();
    await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('game-over')).toContainText('You were eaten');
    await page.getByTestId('restart').click();
    await expect(page.getByTestId('game-over')).toBeHidden();
    await expect(page.getByTestId('hud-mass')).toHaveText('20');
    expect(errors).toEqual([]);
  });

  test('loading the same saved state twice and stepping gives identical results', async ({ page }, info) => {
    await page.goto('./#watch');
    await expect(page.getByTestId('mini-leaderboard')).toContainText('1.');
    await page.waitForTimeout(1500);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-experiment').click()]);
    const file = info.outputPath('watch.json');
    await download.saveAs(file);
    const run = async () => {
      await page.getByTestId('load-experiment').setInputFiles(file);
      await expect(page.getByTestId('step')).toBeEnabled();
      for (let i = 0; i < 40; i++) await page.getByTestId('step').click();
      await page.waitForTimeout(300);
      return page.getByTestId('mini-leaderboard').textContent();
    };
    const a = await run();
    const b = await run();
    expect(a).toBe(b);
  });

  test('watch mode: change AI lineup, inspect an agent, speed, follow, reset', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./#watch');
    await expect(page.getByTestId('alive-count')).toContainText('/');
    await page.getByRole('button', { name: 'more Greedy' }).click();
    await page.getByRole('button', { name: 'fewer Random' }).click();
    await page.getByTestId('apply-settings').click();
    const total = await page.getByTestId('bot-total').textContent();
    await expect(page.getByTestId('alive-count')).toContainText(`/${total}`);
    await page.getByTestId('mini-leaderboard').locator('button').first().click();
    await expect(page.getByTestId('inspector')).toBeVisible();
    await expect(page.getByTestId('inspector-mode').or(page.getByTestId('inspector-action'))).toBeVisible();
    await page.getByTestId('overlay-heatmap').click();
    await expectWorldVisible(page);
    await page.getByTestId('speed').selectOption('8');
    const t0 = await seconds(page);
    await page.waitForTimeout(2000);
    expect(await seconds(page)).toBeGreaterThanOrEqual(t0 + 8);
    await page.getByTestId('follow').selectOption('free');
    await page.getByTestId('fit').click();
    await expectWorldVisible(page);
    await page.getByTestId('reset').click();
    await expect.poll(() => seconds(page)).toBeLessThan(t0 + 4);
    expect(errors).toEqual([]);
  });

  test('canvas never goes blank while panels toggle or the window resizes, including when paused', async ({ page }) => {
    await page.goto('./#watch');
    await expect(page.getByTestId('alive-count')).toBeVisible();
    await page.waitForTimeout(800);
    for (let i = 0; i < 6; i++) {
      await page.getByTestId(i % 2 ? 'toggle-bottom' : 'toggle-right').click();
      await page.waitForTimeout(60);
      await expectWorldVisible(page);
    }
    await page.getByTestId('play-pause').click();
    for (const [w, h] of [[900, 700], [1300, 820], [700, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(120);
      await expectWorldVisible(page);
    }
    await page.getByTestId('toggle-right').click();
    await page.waitForTimeout(100);
    await expectWorldVisible(page);
  });

  test('analytics panel shows leaderboard, chart, policy stats, log and performance', async ({ page }) => {
    await page.goto('./#watch');
    await page.getByTestId('speed').selectOption('8');
    await page.getByTestId('toggle-bottom').click();
    await expect(page.getByTestId('analytics')).toBeVisible();
    for (const tab of ['mass', 'policies', 'log', 'performance', 'leaderboard']) await page.getByTestId(`tab-${tab}`).click();
    await page.getByTestId('tab-performance').click();
    await expect(page.getByTestId('perf-table')).toContainText('Simulation UPS');
    await expect.poll(async () => page.getByTestId('perf-table').locator('tr').nth(1).locator('td').nth(1).textContent()).not.toBe('0');
  });

  test('tournament runs headless matches in a worker and reports confidence intervals', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./#tournament');
    await page.getByTestId('t-seeds').fill('2');
    await page.getByTestId('t-seconds').fill('20');
    await page.getByTestId('t-run').click();
    await expect(page.getByTestId('t-report').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('t-run')).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('t-report').first()).toContainText('Win rate [95% CI]');
    expect(errors).toEqual([]);
  });

  test('RL lab lists shipped models and distinguishes trained from untrained', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./#lab');
    await expect(page.getByTestId('lab-view')).toContainText('obs-v1');
    const index = await (await page.request.get('./models/index.json')).json() as { id: string; trained: boolean }[];
    for (const m of index) {
      await expect(page.getByTestId(`model-${m.id}`)).toContainText(m.trained ? 'trained' : 'untrained');
    }
    expect(errors).toEqual([]);
  });
});

test.describe('mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only');

  test('mobile viewport: world, HUD, dock and touch controls', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./#play');
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('dock')).toBeVisible();
    await expect(page.getByTestId('joystick')).toBeVisible();
    await expectWorldVisible(page);
    const joy = (await page.getByTestId('joystick').boundingBox())!;
    await page.touchscreen.tap(joy.x + joy.width - 5, joy.y + joy.height / 2);
    await page.getByTestId('touch-split').tap();
    await page.getByTestId('mode-watch').tap();
    await expect(page.getByTestId('dock')).toBeVisible();
    await expectWorldVisible(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
