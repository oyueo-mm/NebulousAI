import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_UI, defaultArena } from '../src/ui/settings';
import type { MatchSnapshot } from '../src/sim/match';
import type { Frame, ToWorker } from '../src/worker/protocol';

type Probe = { worker: Worker; commands: ToWorker[]; frame?: Frame; snapshot?: MatchSnapshot; terminated: boolean };
declare global { interface Window { __workers: Probe[] } }

/** Observe the actual worker boundary; no production debug hooks or substitute engine. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.__workers = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      probe: Probe;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.probe = { worker: this, commands: [], terminated: false };
        window.__workers.push(this.probe);
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'frame') this.probe.frame = data;
          if (data.type === 'saved') this.probe.snapshot = data.snapshot;
        });
      }
      override postMessage(message: ToWorker) { this.probe.commands.push(message); super.postMessage(message); }
      override terminate() { this.probe.terminated = true; super.terminate(); }
    };
    localStorage.setItem('nebulousai.onboarding.never', '1');
  });
}

test('home worker runs real AI; snapshot, packed frame and rendered cell agree', async ({ page }) => {
  await instrument(page);
  await page.goto('./');
  await expect.poll(() => page.evaluate(() => window.__workers.find(p => p.commands.some(c => c.type === 'init' && c.setup.seed === 202607))?.frame?.agents.some(a => a.foodEaten > 0))).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => window.__workers.find(p => p.commands.some(c => c.type === 'init' && c.setup.seed === 202607))?.frame?.running)).toBe(false);
  await page.evaluate(() => window.__workers.find(p => p.commands.some(c => c.type === 'init' && c.setup.seed === 202607))!.worker.postMessage({ type: 'save', requestId: 7001 }));
  await expect.poll(() => page.evaluate(() => !!window.__workers.find(p => p.snapshot)?.snapshot)).toBe(true);
  const evidence = await page.evaluate(() => {
    const probe = window.__workers.find(p => p.snapshot)!;
    const snapshot = probe.snapshot!, frame = probe.frame!;
    const cells = snapshot.world.cells;
    const largest = [...cells].sort((a, b) => b.mass - a.mass)[0];
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid=home-animation]')!;
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
    const zoom = Math.min(rect.width / frame.world.width, rect.height / frame.world.height) * .94;
    const sx = ((largest.x - frame.world.width / 2) * zoom + rect.width / 2) * dpr;
    const sy = ((largest.y - frame.world.height / 2) * zoom + rect.height / 2) * dpr;
    const pixel = [...canvas.getContext('2d')!.getImageData(Math.round(sx), Math.round(sy), 1, 1).data].slice(0, 3);
    const palette = ['#DD6B86', '#9CBF78', '#FAC776', '#CE9BD3', '#EEA284'];
    const hex = palette[largest.owner % palette.length];
    return {
      tick: frame.tick, snapshotTick: snapshot.world.tick,
      kinds: frame.agents.map(a => a.kind), modes: frame.agents.map(a => a.mode),
      positionsAgree: cells.every(c => {
        const i = Array.from(frame.cells).findIndex((v, index) => index % 6 === 0 && v === c.id);
        return i >= 0 && Math.abs(frame.cells[i + 2] - c.x) < .001 && Math.abs(frame.cells[i + 3] - c.y) < .001 && Math.abs(frame.cells[i + 4] - c.r) < .001;
      }),
      pixel, expectedPixel: [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)),
    };
  });
  expect(evidence.tick).toBeGreaterThan(0);
  expect(evidence.tick).toBe(evidence.snapshotTick);
  expect(evidence.kinds).toHaveLength(6);
  expect(evidence.kinds).not.toContain('human');
  expect(evidence.kinds).not.toContain('ppo');
  expect(evidence.modes.some(mode => mode.length > 0)).toBe(true);
  expect(evidence.positionsAgree).toBe(true);
  expect(evidence.pixel).toEqual(evidence.expectedPixel);
});

test('home worker stops for reduced motion, offscreen and background tabs; route changes terminate it', async ({ page }) => {
  await instrument(page);
  await page.goto('./');
  const state = () => page.evaluate(() => window.__workers.filter(p => p.commands.some(c => c.type === 'init' && c.setup.seed === 202607)).map(p => ({ terminated: p.terminated, tick: p.frame?.tick, running: p.frame?.running })));
  await expect.poll(async () => (await state()).at(-1)?.running).toBe(true);
  await page.getByTestId('home-animation').evaluate(el => { el.style.transform = 'translateY(200vh)'; });
  await expect.poll(async () => (await state()).at(-1)?.running).toBe(false);
  const frozen = (await state()).at(-1)!.tick;
  await page.waitForTimeout(200);
  expect((await state()).at(-1)!.tick).toBe(frozen);
  await page.getByTestId('home-animation').evaluate(el => { el.style.transform = ''; });
  await expect.poll(async () => (await state()).at(-1)?.running).toBe(true);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(async () => (await state()).at(-1)?.running).toBe(false);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { location.hash = '/watch'; });
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    expect((await state()).every(p => p.terminated)).toBe(true);
    await page.evaluate(() => { location.hash = '/home'; });
    await expect.poll(async () => (await state()).filter(p => !p.terminated).length).toBe(1);
  }
  const game = await page.evaluate(() => window.__workers.find(p => p.commands.some(c => c.type === 'init' && c.setup.participants.some(a => a.kind === 'ppo')))?.frame);
  expect(game?.agents.length).toBeGreaterThan(6);
});

test('keyboard diagonals, opposite directions, release and blur are neutral; mouse does not steer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop keyboard; existing mobile suite covers the joystick');
  await instrument(page);
  await page.goto('./#/play');
  await expect(page.getByTestId('dock')).toBeVisible();
  const arena = defaultArena('play', false);
  arena.bots = { random: 0, greedy: 0, survival: 0, aggressive: 0, hybrid: 0, ppo: 0 };
  arena.foodMax = 0; arena.thornCount = 0;
  await page.getByTestId('load-experiment').setInputFiles({ name: 'keyboard.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'nebulous-experiment', version: 1, mode: 'play', arena, ui: DEFAULT_UI, snapshot: null })) });
  await expect(page.getByTestId('alive-count')).toContainText('1/1');
  const action = () => page.evaluate(() => {
    const p = window.__workers.find(p => p.commands.some(c => c.type === 'init' && c.setup.participants.some(a => a.kind === 'human')))!;
    const command = p.commands.filter(c => c.type === 'input').at(-1);
    return command?.type === 'input' ? { dx: command.action.dx, dy: command.action.dy } : null;
  });
  await page.locator('header .page-title').click();
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
  await expect.poll(async () => (await action())?.dx).toBeCloseTo(Math.SQRT1_2);
  expect((await action())?.dy).toBeCloseTo(-Math.SQRT1_2);
  await page.keyboard.down('KeyS'); await page.keyboard.down('KeyA');
  await expect.poll(action).toEqual({ dx: 0, dy: 0 });
  for (const key of ['KeyW', 'KeyD', 'KeyS', 'KeyA']) await page.keyboard.up(key);
  await page.keyboard.down('ArrowRight');
  await expect.poll(action).toEqual({ dx: 1, dy: 0 });
  await page.keyboard.up('ArrowRight');
  await expect.poll(action).toEqual({ dx: 0, dy: 0 });
  await page.keyboard.down('KeyD');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(action).toEqual({ dx: 0, dy: 0 });
  await page.keyboard.up('KeyD');
  const cell = () => page.evaluate(() => {
    const frame = window.__workers.find(p => p.commands.some(c => c.type === 'init' && c.setup.participants.some(a => a.kind === 'human')))!.frame!;
    return Array.from(frame.cells).slice(2, 4);
  });
  await page.waitForTimeout(200);
  const before = await cell();
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .7);
  await page.mouse.click(box.x + box.width * .2, box.y + box.height * .3);
  await page.waitForTimeout(350);
  expect(await action()).toEqual({ dx: 0, dy: 0 });
  expect(await cell()).toEqual(before);
  await page.keyboard.down('KeyD');
  await page.evaluate(() => { location.hash = '/home'; });
  await expect(page.getByTestId('home')).toBeVisible();
  await page.keyboard.up('KeyD');
  expect(await action()).toEqual({ dx: 0, dy: 0 });
});

test('settings toggle lives in the header, resizes independently and remains reachable on mobile', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nebulousai.onboarding.never', '1'));
  await page.goto('./#/watch');
  const toggle = page.locator('header').getByTestId('toggle-right');
  await expect(toggle).toBeVisible();
  await expect(page.getByTestId('dock').getByTestId('toggle-right')).toHaveCount(0);
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
  const before = (await page.getByTestId('game-canvas').boundingBox())!.width;
  await toggle.click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  await expect.poll(async () => (await page.getByTestId('game-canvas').boundingBox())!.width).toBeCloseTo(before, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await toggle.click();
  await expect(page.getByTestId('close-settings')).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  await page.getByTestId('open-sidebar').click();
  await expect(page.getByTestId('sidebar')).toHaveAttribute('aria-modal', 'true');
});

test('flat logo and favicon agree at small sizes; desktop introduction begins near the top', async ({ page, isMobile }, info) => {
  test.skip(isMobile, 'uses desktop geometry and explicit logo sizes');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('./');
  const intro = (await page.locator('.home-intro').boundingBox())!;
  const header = (await page.locator('header').boundingBox())!;
  expect(intro.y - header.y - header.height).toBeGreaterThanOrEqual(100);
  expect(intro.y - header.y - header.height).toBeLessThanOrEqual(150);
  const fonts = await page.locator('.home').evaluate(el => ({ title: parseFloat(getComputedStyle(el.querySelector('h1')!).fontSize), description: parseFloat(getComputedStyle(el.querySelector('.home-description')!).fontSize) }));
  expect(fonts.title).toBeGreaterThanOrEqual(68); expect(fonts.title).toBeLessThanOrEqual(82);
  expect(fonts.description).toBeGreaterThanOrEqual(20);
  const logo = page.locator('.sidebar-brand svg');
  await expect(logo.locator('radialGradient, linearGradient, path')).toHaveCount(0);
  const svg = await logo.innerHTML();
  const favicon = await (await page.request.get('./favicon.svg')).text();
  expect(favicon).not.toMatch(/gradient|filter|stroke/i);
  for (const colour of ['#A83557', '#9CBF78']) { expect(svg).toContain(colour); expect(favicon).toContain(colour); }
  for (const size of [16, 24, 32]) {
    await logo.evaluate((el, value) => { el.setAttribute('width', String(value)); el.setAttribute('height', String(value)); el.style.width = `${value}px`; el.style.height = `${value}px`; }, size);
    await logo.screenshot({ path: info.outputPath(`logo-${size}.png`) });
  }
});
