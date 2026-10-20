/**
 * Headless tournament runner.
 *   node dist-node/tournament.mjs --preset heuristics --seeds 20 --out docs/results
 *   node dist-node/tournament.mjs --spec my-spec.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTournament, reportToCsv, type TournamentSpec } from '../sim/tournament';
import { PRESETS } from '../sim/presets';
import { loadModels } from './models';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const models = loadModels(arg('models', 'public/models')!);
let spec: TournamentSpec;
const specPath = arg('spec');
if (specPath) {
  spec = JSON.parse(readFileSync(specPath, 'utf8')) as TournamentSpec;
} else {
  const preset = arg('preset', 'heuristics')!;
  const make = PRESETS[preset];
  if (!make) throw new Error(`unknown preset ${preset}; choose one of ${Object.keys(PRESETS).join(', ')}`);
  const seeds = Number(arg('seeds', '10'));
  const seedBase = Number(arg('seed-base', '100000'));
  spec = make(Array.from({ length: seeds }, (_, i) => seedBase + i));
}
if (arg('seconds')) spec.maxSeconds = Number(arg('seconds'));
if (arg('rotations')) spec.rotations = Number(arg('rotations'));

const report = runTournament(spec, models, (done, total) => {
  if (done % Math.max(1, Math.floor(total / 10)) === 0 || done === total) process.stderr.write(`  ${done}/${total} matches\n`);
});
const out = arg('out');
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${spec.name}.json`), JSON.stringify(report));
  writeFileSync(join(out, `${spec.name}.csv`), reportToCsv(report));
}
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
console.log(`\n${spec.name}: ${report.matches} matches, ${report.wallSeconds.toFixed(1)} s wall, ${report.simSecondsPerWallSecond.toFixed(0)}x real time`);
console.table(report.entries.map((e) => ({
  entry: e.label, n: e.samples, win: `${pct(e.winRate)} [${pct(e.winRateCI[0])}, ${pct(e.winRateCI[1])}]`, rank: e.avgRank.toFixed(2),
  survival: `${e.avgSurvival.toFixed(1)}±${e.survivalCI.toFixed(1)}`, mass: `${e.avgFinalMass.toFixed(0)}±${e.finalMassCI.toFixed(0)}`,
  peak: e.avgMaxMass.toFixed(0), kills: e.avgKills.toFixed(2), eaten: e.avgCellsEaten.toFixed(2), splits: e.avgSplits.toFixed(1),
  splitHit: pct(e.splitSuccessRate), exch: e.exchangeRatio.toFixed(2), alive: pct(e.survivedToEnd),
})));
