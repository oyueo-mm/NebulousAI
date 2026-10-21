// Browser performance probe: reads the app's own Performance tab (render FPS, simulation UPS,
// achieved speed, per-tick world / AI cost) in Chromium via Playwright.
//   npm run build && npx vite preview --port 4173 &   then   node scripts/browser-benchmark.mjs [--headed]
import { chromium } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const headed = process.argv.includes('--headed');
const base = 'http://127.0.0.1:4173/NebulousAI/';
const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => localStorage.setItem('nebulousai.onboarding.never', '1'));

async function readPerf() {
  await page.waitForTimeout(4000);
  const rows = await page.getByTestId('perf-table').locator('tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].slice(0, 2).map((td) => td.textContent)));
  return Object.fromEntries(rows);
}

async function scenario(label, setup) {
  await setup();
  if (!(await page.getByTestId('analytics').isVisible().catch(() => false))) await page.getByTestId('toggle-bottom').click();
  await page.getByTestId('tab-performance').click();
  const perf = await readPerf();
  const agents = await page.getByTestId('alive-count').textContent();
  console.log(label.padEnd(34), agents.padEnd(14), JSON.stringify(perf));
  return { label, agents, ...perf };
}

function experiment(bots) {
  const dir = mkdtempSync(join(tmpdir(), 'nebulous-bench-'));
  const file = join(dir, 'exp.json');
  writeFileSync(file, JSON.stringify({
    format: 'nebulous-experiment', version: 1, rulesVersion: 'rules-v1', savedAt: '', mode: 'watch', snapshot: null,
    ui: { overlays: { targets: true, vision: false, heatmap: false, names: true }, speed: 1, rightOpen: false, bottomOpen: true },
    arena: { seed: 2026, bots, ppoModel: 'ppo-v4', ppoDeterministic: false, worldSize: 3000, foodMax: 1000, thornCount: 10, respawn: true, maxSeconds: 0, decisionInterval: 2,
      physics: { speedBase: 230, eatRatio: 1.25, splitSpeed: 800, decayRate: 0.002, ejectEfficiency: 0.8, mergeBase: 9, startMass: 20 } },
  }));
  return file;
}

const results = [];
await page.goto(`${base}#watch`);
await page.getByTestId('dock').waitFor();
results.push(await scenario('watch default, 1x', async () => {}));
results.push(await scenario('watch default, Max speed', async () => page.getByTestId('speed-max').click()));
await page.getByTestId('speed-reset').click();
results.push(await scenario('watch default, fixed 50x', async () => { await page.getByTestId('speed-slider').focus(); await page.keyboard.press('End'); }));
await page.getByTestId('speed-reset').click();
for (const [label, bots] of [
  ['50 heuristic agents, 1000 food, 1x', { random: 10, greedy: 10, survival: 10, aggressive: 10, hybrid: 10, ppo: 0 }],
  ['50 agents incl. 25 PPO, 1x', { random: 5, greedy: 5, survival: 5, aggressive: 5, hybrid: 5, ppo: 25 }],
]) {
  results.push(await scenario(label, async () => {
    if (!(await page.getByTestId('settings-panel').isVisible().catch(() => false))) await page.getByTestId('toggle-right').click();
    await page.getByTestId('load-experiment').setInputFiles(experiment(bots));
    await page.waitForTimeout(500);
  }));
}
// Heavy lineup at a 50× target: the readout must show the achieved speed, not the target.
results.push(await scenario('50 agents incl. 25 PPO, target 50x', async () => { await page.getByTestId('speed-slider').focus(); await page.keyboard.press('End'); }));
results[results.length - 1].readout = await page.getByTestId('speed-actual').textContent().catch(() => null);
console.log('   readout under the slider:', results[results.length - 1].readout);
await page.getByTestId('speed-reset').click();
await page.goto(`${base}#play`);
await page.getByTestId('hud').waitFor();
results.push(await scenario('play default (you + 15 bots), 1x', async () => {}));
await browser.close();
writeFileSync('docs/results/browser-benchmark.json', JSON.stringify({ headless: !headed, results }, null, 1));
