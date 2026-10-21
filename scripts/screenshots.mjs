// Captures the README screenshots from the production build (vite preview on :4173).
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4173/NebulousAI/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
await page.addInitScript(() => localStorage.setItem('nebulousai.onboarding.never', '1'));

await page.goto(`${base}#watch`);
await page.getByTestId('dock').waitFor();
await page.waitForTimeout(6000);
await page.getByTestId('mini-leaderboard').locator('button', { hasText: '강화학습' }).first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: 'docs/images/watch-ppo.png' });

await page.getByTestId('mini-leaderboard').locator('button', { hasText: '혼합형' }).first().click();
await page.getByTestId('overlay-heatmap').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: 'docs/images/watch-heuristic.png' });

await page.goto(`${base}#play`);
await page.getByTestId('hud').waitFor();
const box = await page.getByTestId('game-canvas').boundingBox();
for (let i = 0; i < 30; i++) {
  await page.mouse.move(box.x + box.width / 2 + Math.cos(i / 3) * 300, box.y + box.height / 2 + Math.sin(i / 3) * 300);
  await page.waitForTimeout(200);
}
await page.screenshot({ path: 'docs/images/play.png' });

await page.goto(`${base}#tournament`);
await page.getByTestId('t-report').first().waitFor();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/images/tournament.png' });

await page.goto(`${base}#lab`);
await page.getByTestId('model-ppo-v4').waitFor();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/images/lab.png' });
await browser.close();
console.log('screenshots written to docs/images/');
