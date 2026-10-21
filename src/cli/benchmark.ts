/** Headless throughput benchmark: node dist-node/benchmark.mjs [--models public/models] */
import os from 'node:os';
import { Match, type ParticipantSpec } from '../sim/match';
import { OBS_SIZE } from '../ai/rl';
import { loadModels } from './models';

const models = loadModels('public/models');
const ppoId = models.has('ppo-v4') ? 'ppo-v4' : [...models.keys()][0];
const kinds: ParticipantSpec['kind'][] = ['random', 'greedy', 'survival', 'aggressive', 'hybrid'];
const scenarios: { agents: number; food: number; ppo: number }[] = [
  { agents: 10, food: 600, ppo: 0 },
  { agents: 20, food: 600, ppo: 0 },
  { agents: 50, food: 1000, ppo: 0 },
  { agents: 50, food: 2000, ppo: 0 },
  ...(ppoId ? [{ agents: 20, food: 600, ppo: 10 }, { agents: 50, food: 1000, ppo: 25 }] : []),
];
console.log(`node ${process.version}, ${os.cpus()[0]?.model ?? 'unknown cpu'}, ${os.cpus().length} threads; PPO model: ${ppoId ?? 'none'}`);
const rows = [];
for (const s of scenarios) {
  const participants: ParticipantSpec[] = Array.from({ length: s.agents }, (_, i) =>
    i < s.ppo ? { kind: 'ppo', modelId: ppoId } : { kind: kinds[i % kinds.length] });
  const match = new Match({ seed: 7, participants, config: { foodMax: s.food, respawn: true } }, models);
  for (let i = 0; i < 60; i++) match.step();
  match.timing.worldMs = 0; match.timing.policyMs = 0; match.timing.ticks = 0; match.timing.decisions = 0;
  const ticks = 1800;
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) match.step();
  const wall = (performance.now() - t0) / 1000;
  rows.push({
    agents: s.agents, ppo: s.ppo, food: s.food, cells: match.world.cells.length,
    'ticks/s (UPS)': Math.round(ticks / wall), 'x real time': ((ticks * match.world.config.tickSeconds) / wall).toFixed(1),
    'world ms/tick': (match.timing.worldMs / match.timing.ticks).toFixed(3),
    'policy ms/decision': (match.timing.policyMs / Math.max(1, match.timing.decisions)).toFixed(4),
  });
}
console.table(rows);

if (ppoId) {
  const model = models.get(ppoId)!;
  const obs = new Float32Array(OBS_SIZE).map((_, i) => Math.sin(i));
  for (let i = 0; i < 2000; i++) model.forward(obs);
  const n = 20000;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) model.forward(obs);
  console.log(`MLP forward (${ppoId}, policy + value nets): ${(((performance.now() - t0) / n) * 1000).toFixed(1)} µs per call`);
}
