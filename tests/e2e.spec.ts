import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

/** Fails the test on console errors, page errors and any HTTP error response. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return errors;
}

/** Skips the first-visit guide (tested separately). */
async function skipOnboarding(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem('nebulousai.onboarding.never', '1'); } catch { /* ignore */ } });
}

/**
 * Samples the canvas backing store densely: size, share of near-black pixels, share of pixels that are
 * not the empty-page background (the white arena, grid, food and cells all count) and distinct colours.
 */
async function canvasInk(page: Page): Promise<{ w: number; h: number; black: number; world: number; colours: number }> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=game-canvas]')!;
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let black = 0, world = 0, n = 0;
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 7) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      n++;
      colours.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      if (r + g + b < 60) black++;
      if (Math.abs(r - 0xf4) + Math.abs(g - 0xf6) + Math.abs(b - 0xfb) > 6) world++;
    }
    return { w: c.width, h: c.height, black: black / n, world: world / n, colours: colours.size };
  });
}

/** The canvas shows the world: not blank, not black, not a single flat colour. Retries briefly to skip transitional frames. */
async function expectWorldVisible(page: Page) {
  await expect.poll(async () => {
    const s = await canvasInk(page);
    return s.w > 10 && s.black < 0.5 && s.world > 0.01 && s.colours >= 4;
  }, { timeout: 3000, intervals: [100, 250, 500] }).toBe(true);
}

const seconds = async (page: Page) => {
  const text = (await page.getByTestId('match-time').textContent()) ?? '0:00';
  const [m, s] = text.split(':').map(Number);
  return m * 60 + s;
};

const speedText = (page: Page) => () => page.getByTestId('speed-value').textContent();
const parseSpeed = (s: string | null) => Number((s ?? '').replace(/[^0-9.]/g, ''));

async function openSettings(page: Page) {
  await expect(page.getByTestId('dock')).toBeVisible();
  if (!(await page.getByTestId('settings-panel').isVisible())) await page.getByTestId('toggle-right').click();
}

async function openAdvanced(page: Page) {
  await openSettings(page);
  await page.getByRole('button', { name: '고급 물리 설정' }).click();
}

async function setNumber(page: Page, label: string, value: number) {
  await page.getByTestId('settings-panel').locator('label', { hasText: label }).locator('input').fill(String(value));
}

/** Downloads the current state and returns the human player's (agent 0) first cell position. */
async function humanPosition(page: Page, path: string): Promise<{ x: number; y: number; tick: number }> {
  await openSettings(page);
  if (!(await page.getByTestId('save-experiment').isVisible())) await page.getByRole('button', { name: '저장 / 불러오기' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-experiment').click()]);
  await download.saveAs(path);
  const exp = JSON.parse(readFileSync(path, 'utf8'));
  const cell = exp.snapshot.world.cells.find((c: { owner: number }) => c.owner === 0);
  return { x: cell.x, y: cell.y, tick: exp.snapshot.world.tick };
}

/** English UI phrases that must no longer appear anywhere (algorithm/library names are allowed). */
const ENGLISH_UI = [
  'Leaderboard', 'Settings', 'Pause', 'Restart', 'Resume', 'Follow leader', 'Free camera', 'Inspector', 'Analytics', 'Save state', 'Load…',
  'Apply', 'World size', 'Max food', 'Time limit', 'Overlays', 'Experiment', 'Preset', 'Lineup', 'Protocol', 'Run ', 'Reference results',
  'Models shipped', 'Training curve', 'Action space', 'Reproduce', 'You were eaten', 'Play again', 'Mouse:', 'Click a cell',
  'Running', 'Paused', 'Finished', 'Loading', 'Watch AI', 'RL Lab', 'Tournament', 'Win rate', 'Survival (s)', 'Final mass', 'Opponents',
  'AI agents', 'Speed', 'Mass', 'Kills', 'Split', 'Eject', 'Cells eaten', 'random init', 'Training',
];

async function expectKorean(page: Page) {
  const text = await page.evaluate(() => document.body.innerText);
  // Whole-word match, so technical identifiers such as obs-v1's `self.logMass` do not count.
  const esc = (p: string) => p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  expect(text, 'English alive counter').not.toMatch(/\d+\/\d+ alive/);
  for (const phrase of ENGLISH_UI) expect(text, `"${phrase}" still shown`).not.toMatch(new RegExp(`(^|[^A-Za-z.])${esc(phrase)}(?![A-Za-z])`));
  // Korean text must fit inside its buttons.
  const overflowing = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter((b) => b.offsetParent !== null && b.scrollWidth > b.clientWidth + 1)
    .map((b) => b.textContent?.trim()).filter((s) => s));
  expect(overflowing, 'button text overflows').toEqual([]);
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop flows');

  test('first visit: guide pauses the game, 시작하기 starts it, 다시 보지 않기 is remembered', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto('./#play');
    await expect(page.getByTestId('onboarding')).toBeVisible();
    await expect(page.getByTestId('onboarding')).toContainText('작은 먹이를 먹으며 성장하세요');
    await page.waitForTimeout(1200);
    expect(await seconds(page)).toBe(0); // paused while the guide is open
    await page.getByTestId('onboarding-controls').click();
    await expect(page.getByTestId('controls-help')).toContainText('PC 조작');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('controls-help')).toBeHidden();
    await page.getByTestId('onboarding-start').click();
    await expect(page.getByTestId('onboarding')).toBeHidden();
    await expect.poll(() => seconds(page), { timeout: 4000 }).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('onboarding')).toBeHidden(); // already seen in this session
    await ctx.close();

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto('./#play');
    await page2.getByTestId('onboarding-never').click();
    await page2.reload();
    await expect(page2.getByTestId('hud')).toBeVisible();
    await page2.waitForTimeout(500);
    await expect(page2.getByTestId('onboarding')).toBeHidden();
    await ctx2.close();
    expect(errors).toEqual([]);
  });

  test.describe('with the guide dismissed', () => {
    test.beforeEach(async ({ page }) => { await skipOnboarding(page); });

    test('every page is in Korean and no button text overflows', async ({ page }) => {
      const errors = watchErrors(page);
      for (const mode of ['play', 'watch', 'tournament', 'lab']) {
        await page.goto(`./#${mode}`);
        await page.waitForTimeout(mode === 'tournament' || mode === 'lab' ? 1500 : 1000);
        await expect(page.getByTestId(`mode-${mode}`)).toHaveAttribute('aria-selected', 'true');
        await expectKorean(page);
      }
      await expect(page.getByTestId('mode-play')).toContainText('직접 플레이');
      await expect(page.getByTestId('mode-watch')).toContainText('AI 관전');
      await expect(page.getByTestId('mode-tournament')).toContainText('AI 토너먼트');
      await expect(page.getByTestId('mode-lab')).toContainText('강화학습 실험실');
      await page.goto('./#play');
      await page.getByTestId('controls-button').click();
      await expectKorean(page);
      await page.keyboard.press('Escape');
      await page.goto('./#watch');
      await page.getByTestId('toggle-bottom').click();
      for (const tab of ['mass', 'policies', 'log', 'performance', 'leaderboard']) { await page.getByTestId(`tab-${tab}`).click(); await expectKorean(page); }
      await page.getByTestId('mini-leaderboard').locator('button').first().click();
      await expect(page.getByTestId('inspector')).toBeVisible();
      await expectKorean(page);
      expect(errors).toEqual([]);
    });

    test('play: WASD and arrow keys move the cell, the mouse steers it and the player grows by eating', async ({ page }, info) => {
      const errors = watchErrors(page);
      await page.goto('./#play');
      await expect(page.getByTestId('hud-mass')).toHaveText('20');
      await expectWorldVisible(page);
      // Keyboard: D moves east, W north, ArrowLeft west, ArrowDown south (mouse kept outside the canvas).
      for (const [key, axis, sign] of [['KeyD', 'x', 1], ['KeyW', 'y', -1], ['ArrowLeft', 'x', -1], ['ArrowDown', 'y', 1]] as const) {
        const a = await humanPosition(page, info.outputPath(`a-${key}.json`));
        await page.locator('header').click({ position: { x: 5, y: 5 } });
        await page.keyboard.down(key);
        await page.waitForTimeout(700);
        await page.keyboard.up(key);
        const b = await humanPosition(page, info.outputPath(`b-${key}.json`));
        expect(b.tick).toBeGreaterThan(a.tick);
        expect((b[axis] - a[axis]) * sign, `${key} moves along ${axis}`).toBeGreaterThan(30);
      }
      await page.getByTestId('toggle-right').click();
      // Mouse: the cell follows the pointer; steering in circles also collects food.
      const box = (await page.getByTestId('game-canvas').boundingBox())!;
      let grown = false;
      for (let i = 0; i < 40 && !grown; i++) {
        const a = i * 0.5;
        await page.mouse.move(box.x + box.width / 2 + Math.cos(a) * 250, box.y + box.height / 2 + Math.sin(a) * 250);
        await page.waitForTimeout(250);
        grown = Number(await page.getByTestId('hud-mass').textContent()) > 20;
      }
      expect(grown).toBe(true);
      expect(errors).toEqual([]);
    });

    test('play: split/eject explain why they are unavailable, then work; merge; P/Esc pause; R restarts', async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./#play');
      await expect(page.getByTestId('status-split')).toHaveText('분열: 질량 부족');
      await expect(page.getByTestId('status-eject')).toHaveText('방출: 질량 부족');
      await page.locator('header').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Space');
      await expect(page.getByTestId('action-hint')).toContainText('질량이 36 이상');
      await page.keyboard.press('KeyE');
      await expect(page.getByTestId('action-hint')).toContainText('질량을 방출하려면');

      await openAdvanced(page);
      await setNumber(page, '시작 질량', 120);
      await setNumber(page, '기본 재결합 시간', 1);
      await setNumber(page, '질량 감쇠율', 0);
      await page.getByTestId('apply-settings').click();
      await expect(page.getByTestId('hud-mass')).toHaveText('120');
      await expect(page.getByTestId('status-split')).toHaveText('분열 가능');
      const cells = () => page.getByTestId('hud-cells').textContent();
      await page.locator('header').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Space');
      await expect.poll(cells, { timeout: 4000 }).toBe('2');
      await expect.poll(cells, { timeout: 12000 }).toBe('1');
      const before = Number(await page.getByTestId('hud-mass').textContent());
      await page.keyboard.press('KeyE');
      await expect.poll(async () => Number(await page.getByTestId('hud-mass').textContent()), { timeout: 3000 }).toBeLessThanOrEqual(before - 15);

      await page.keyboard.press('KeyP');
      await expect(page.getByTestId('status-paused')).toBeVisible();
      const paused = await seconds(page);
      await page.waitForTimeout(1500);
      expect(await seconds(page)).toBe(paused);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('status-paused')).toBeHidden();
      await page.waitForTimeout(1500);
      await page.keyboard.press('KeyR');
      await expect.poll(() => seconds(page), { timeout: 3000 }).toBeLessThan(2);
      expect(errors).toEqual([]);
    });

    test('controls help lists PC and mobile controls and closes with Escape', async ({ page }) => {
      await page.goto('./#play');
      await page.getByTestId('controls-button').click();
      const help = page.getByTestId('controls-help');
      for (const text of ['PC 조작', '모바일 조작', '마우스 이동', 'W A S D', '방향키', 'Space', '분열', '질량 방출', 'P / Esc', '일시정지', '다시 시작', '가상 조이스틱', '분열 버튼', '방출 버튼', '일시정지 버튼']) {
        await expect(help).toContainText(text);
      }
      await page.keyboard.press('Escape');
      await expect(help).toBeHidden();
    });

    test('a saved state with the player inside a predator loads, ends the game and restarts', async ({ page }, info) => {
      const errors = watchErrors(page);
      await page.goto('./#play');
      await expect(page.getByTestId('hud')).toBeVisible();
      await openSettings(page);
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
      await expect(page.getByTestId('notice')).toContainText('불러왔습니다');
      await page.getByTestId('play-pause').click();
      await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId('game-over')).toContainText('세포가 흡수되었습니다');
      await page.getByTestId('restart').click();
      await expect(page.getByTestId('game-over')).toBeHidden();
      await expect(page.getByTestId('hud-mass')).toHaveText('20');
      expect(errors).toEqual([]);
    });

    test('loading a broken file shows a Korean error and keeps the game', async ({ page }, info) => {
      await page.goto('./#watch');
      await expect(page.getByTestId('dock')).toBeVisible();
      const bad = info.outputPath('bad.json');
      writeFileSync(bad, '{ not json');
      await page.getByTestId('load-experiment').setInputFiles(bad);
      await expect(page.getByTestId('notice')).toContainText('파일을 불러올 수 없습니다: 올바른 JSON 파일이 아닙니다');
      await expectWorldVisible(page);
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
      expect(await run()).toBe(await run());
    });

    test('speed slider: drag, keyboard, 1×, min/max — the match continues and is never reset', async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./#watch');
      await expect(page.getByTestId('dock')).toBeVisible();
      await expect.poll(speedText(page)).toBe('1.00×');
      await page.waitForTimeout(1200);
      const t0 = await seconds(page);
      const slider = page.getByTestId('speed-slider');
      // Mouse drag along the track to the right.
      const box = (await slider.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.48, box.y + box.height / 2);
      await page.mouse.down();
      for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + box.width * (0.48 + 0.045 * k), box.y + box.height / 2);
      await page.mouse.up();
      expect(parseSpeed(await speedText(page)())).toBeGreaterThan(5);
      // Keyboard.
      await slider.focus();
      await page.keyboard.press('Home');
      await expect.poll(speedText(page)).toBe('0.25×');
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      const s = parseSpeed(await speedText(page)());
      expect(s).toBeGreaterThan(0.25);
      expect(s).toBeLessThan(1);
      await page.keyboard.press('End');
      await expect.poll(speedText(page)).toBe('50.0×');
      await page.getByTestId('speed-reset').click();
      await expect.poll(speedText(page)).toBe('1.00×');
      // Throughout, simulated time only moved forward and the same 12 agents kept playing.
      expect(await seconds(page)).toBeGreaterThanOrEqual(t0);
      await expect(page.getByTestId('alive-count')).toContainText('/12');
      expect(errors).toEqual([]);
    });

    test('speed: achieved speed matches the target; changes while paused keep the game paused; Max is separate', async ({ page }) => {
      await page.goto('./#watch');
      await expect(page.getByTestId('dock')).toBeVisible();
      await page.getByTestId('toggle-bottom').click();
      await page.getByTestId('tab-performance').click();
      await page.getByRole('button', { name: '배속 조절' }).first().click();
      await page.getByTestId('speed-quick-10').click();
      await expect.poll(speedText(page)).toBe('10.0×');
      await page.waitForTimeout(3000);
      const row = page.getByTestId('perf-table').locator('tr', { hasText: '실제 시뮬레이션 배속' }).locator('td').nth(1);
      await expect.poll(async () => parseSpeed(await row.textContent()), { timeout: 4000 }).toBeGreaterThan(8.5);
      expect(parseSpeed(await row.textContent())).toBeLessThan(11.5);
      // Pause, change speed: still paused and time frozen.
      await page.getByTestId('play-pause').click();
      await page.waitForTimeout(400); // let the last in-flight frame land
      const frozen = await seconds(page);
      await page.getByTestId('speed-quick-2').click();
      await expect.poll(speedText(page)).toBe('2.00×');
      await page.waitForTimeout(1200);
      expect(await seconds(page)).toBe(frozen);
      await expect(page.getByTestId('speed-sheet')).toContainText('일시정지 중에도 배속을 바꿀 수 있습니다');
      await page.getByTestId('play-pause').click();
      await page.waitForTimeout(2000);
      expect(await seconds(page)).toBeGreaterThanOrEqual(frozen + 3);
      // Max: not a fixed rate; the sheet shows the achieved speed.
      await page.getByTestId('speed-quick-max').click();
      await expect.poll(speedText(page)).toBe('최대 속도');
      await expect(page.getByTestId('speed-sheet')).toContainText('고정 배속이 아니라');
      await expect.poll(async () => parseSpeed(await page.getByTestId('speed-sheet-actual').textContent()), { timeout: 6000 }).toBeGreaterThan(10);
      // The page stays responsive at max speed.
      const t = Date.now();
      await page.getByTestId('tab-leaderboard').click();
      await expect(page.getByTestId('analytics')).toContainText('에이전트');
      expect(Date.now() - t).toBeLessThan(1500);
    });

    test('watch: lineup, inspector, heatmap, follow, fit, reset', async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./#watch');
      await expect(page.getByTestId('alive-count')).toContainText('/');
      await page.getByRole('button', { name: '탐욕형 AI (Greedy) 늘리기' }).click();
      await page.getByRole('button', { name: '무작위 AI (Random) 줄이기' }).click();
      await page.getByTestId('apply-settings').click();
      const total = await page.getByTestId('bot-total').textContent();
      await expect(page.getByTestId('alive-count')).toContainText(`/${total}`);
      await page.getByTestId('mini-leaderboard').locator('button').first().click();
      await expect(page.getByTestId('inspector')).toBeVisible();
      await expect(page.getByTestId('inspector-mode').or(page.getByTestId('inspector-action'))).toBeVisible();
      await page.getByTestId('overlay-heatmap').click();
      await expectWorldVisible(page);
      await page.getByTestId('follow').selectOption('free');
      await page.getByTestId('fit').click();
      await expectWorldVisible(page);
      await page.waitForTimeout(2500);
      const before = await seconds(page);
      await page.getByTestId('reset').click();
      await expect.poll(() => seconds(page)).toBeLessThan(Math.max(2, before));
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
    });

    test('tournament runs headless matches in a worker and reports confidence intervals', async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./#tournament');
      await page.getByTestId('t-seeds').fill('2');
      await page.getByTestId('t-seconds').fill('20');
      await page.getByTestId('t-run').click();
      await expect(page.getByTestId('t-report').first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('t-run')).toBeVisible({ timeout: 60000 });
      await expect(page.getByTestId('t-report').first()).toContainText('승률 [95% CI]');
      await expect(page.getByTestId('t-report').first()).toContainText('브라우저 토너먼트');
      expect(errors).toEqual([]);
    });

    test('RL lab lists shipped models and distinguishes trained from untrained', async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./#lab');
      await expect(page.getByTestId('lab-view')).toContainText('obs-v1');
      const index = await (await page.request.get('./models/index.json')).json() as { id: string; trained: boolean }[];
      for (const m of index) await expect(page.getByTestId(`model-${m.id}`)).toContainText(m.trained ? '학습 완료' : '학습 전');
      expect(errors).toEqual([]);
    });
  });
});

/** Opens a page at a given viewport; portrait phone/tablet sizes get touch emulation (coarse pointer). */
async function openAt(browser: Browser, width: number, height: number) {
  const touch = height > width;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch && width <= 430, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem('nebulousai.onboarding.never', '1'); } catch { /* ignore */ } });
  return { ctx, page: await ctx.newPage(), touch };
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe('responsive layouts', () => {
  test.skip(({ isMobile }) => isMobile, 'runs its own viewports');

  for (const [w, h] of [[360, 800], [390, 844], [430, 932], [768, 1024], [1280, 720], [1440, 900]]) {
    test(`${w}×${h}: no horizontal overflow, controls do not overlap, canvas fully visible`, async ({ browser }) => {
      const { ctx, page, touch } = await openAt(browser, w, h);
      const errors = watchErrors(page);
      for (const mode of ['play', 'watch']) {
        await page.goto(`./#${mode}`);
        await expect(page.getByTestId('dock')).toBeVisible();
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${mode} horizontal overflow`).toBeLessThanOrEqual(1);
        const dock = (await page.getByTestId('dock').boundingBox())!;
        expect(dock.x).toBeGreaterThanOrEqual(0);
        expect(dock.x + dock.width).toBeLessThanOrEqual(w + 0.5);
        expect(dock.y + dock.height).toBeLessThanOrEqual(h + 0.5);
        const canvas = (await page.getByTestId('game-canvas').boundingBox())!;
        expect(canvas.width).toBeGreaterThan(w * 0.5);
        expect(canvas.y + canvas.height).toBeLessThanOrEqual(h + 0.5);
        expect(canvas.x + canvas.width).toBeLessThanOrEqual(w + 0.5);
        if (mode === 'play') {
          const hud = (await page.getByTestId('hud').boundingBox())!;
          expect(hud.x + hud.width).toBeLessThanOrEqual(w);
          if (touch) {
            for (const id of ['joystick', 'touch-split', 'touch-eject']) {
              const b = (await page.getByTestId(id).boundingBox())!;
              expect(overlaps(b, dock), `${id} overlaps the dock`).toBe(false);
              expect(overlaps(b, hud), `${id} overlaps the HUD`).toBe(false);
              expect(Math.min(b.width, b.height), `${id} touch target`).toBeGreaterThanOrEqual(44);
            }
          }
        }
        if (touch) {
          const small = await page.getByTestId('dock').locator('button:visible, select:visible').evaluateAll((els) =>
            els.map((e) => e.getBoundingClientRect()).filter((r) => r.height < 43.5).length);
          expect(small, 'dock touch targets below 44 px').toBe(0);
        }
        await expectKorean(page);
        await expectWorldVisible(page);
      }
      for (const mode of ['tournament', 'lab']) {
        await page.goto(`./#${mode}`);
        await page.waitForTimeout(1200);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${mode} horizontal overflow`).toBeLessThanOrEqual(1);
      }
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }
});

test.describe('mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only');
  test.beforeEach(async ({ page }) => { await skipOnboarding(page); });

  test('touch: joystick moves the cell, action buttons explain and work, pause button stops the game', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto('./#play');
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('joystick')).toBeVisible();
    await expectWorldVisible(page);
    // Split with too little mass: still tappable, explains why.
    await page.getByTestId('touch-split').tap();
    await expect(page.getByTestId('action-hint')).toContainText('질량');
    await expect(page.getByTestId('touch-split')).toHaveAttribute('data-ready', 'false');
    // Joystick: hold to the right for a second via CDP touch events.
    const before = await humanPosition(page, info.outputPath('m-a.json'));
    await page.getByTestId('close-settings').tap();
    const joy = (await page.getByTestId('joystick').boundingBox())!;
    const cx = joy.x + joy.width / 2, cy = joy.y + joy.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + k * 8, y: cy }] });
    await page.waitForTimeout(1000);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await humanPosition(page, info.outputPath('m-b.json'));
    expect(after.x - before.x, 'joystick moves the cell east').toBeGreaterThan(30);
    await page.getByTestId('drawer-backdrop').tap({ position: { x: 10, y: 300 } }); // tapping outside also closes it
    // Pause button.
    await page.getByTestId('play-pause').tap();
    await expect(page.getByTestId('status-paused')).toBeVisible();
    await page.getByTestId('play-pause').tap();
    await expect(page.getByTestId('status-paused')).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('touch: speed sheet slider responds to a touch drag, has quick buttons, 1× and Max', async ({ page }) => {
    await page.goto('./#watch');
    await expect(page.getByTestId('dock')).toBeVisible();
    await page.getByTestId('speed-chip').tap();
    const sheet = page.getByTestId('speed-sheet');
    await expect(sheet).toBeVisible();
    const slider = page.getByTestId('speed-slider-sheet');
    const box = (await slider.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const cdp = await page.context().newCDPSession(page);
    const y = box.y + box.height / 2;
    const startX = box.x + box.width * 0.47;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
    for (let k = 1; k <= 12; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + (box.width * 0.4 * k) / 12, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => parseSpeed(await page.getByTestId('speed-sheet-value').textContent())).toBeGreaterThan(4);
    await page.getByTestId('speed-quick-1').tap();
    await expect(page.getByTestId('speed-sheet-value')).toHaveText('1.00×');
    await page.getByTestId('speed-quick-max').tap();
    await expect(page.getByTestId('speed-sheet-value')).toHaveText('최대 속도');
    await expect(page.getByTestId('speed-chip')).toHaveText('MAX');
    await page.getByTestId('speed-quick-1').tap();
    await sheet.getByRole('button', { name: '닫기' }).tap();
    await expect(sheet).toBeHidden();
  });
});
