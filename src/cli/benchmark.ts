/** Headless throughput benchmark: node dist-node/benchmark.mjs */
import os from 'node:os';
import { Match, type ParticipantSpec } from '../sim/match';

const kinds: ParticipantSpec['kind'][] = ['random', 'greedy', 'survival', 'aggressive', 'hybrid'];
const scenarios = [
  { agents: 10, food: 600 },
  { agents: 20, food: 600 },
  { agents: 50, food: 1000 },
  { agents: 50, food: 2000 },
];
console.log(`node ${process.version}, ${os.cpus()[0]?.model ?? 'unknown cpu'}, ${os.cpus().length} threads`);
const rows = [];
for (const s of scenarios) {
  const match = new Match({
    seed: 7, participants: Array.from({ length: s.agents }, (_, i) => ({ kind: kinds[i % kinds.length] })),
    config: { foodMax: s.food, respawn: true },
  });
  for (let i = 0; i < 60; i++) match.step();
  match.timing.worldMs = 0; match.timing.policyMs = 0; match.timing.ticks = 0; match.timing.decisions = 0;
  const ticks = 1800;
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) match.step();
  const wall = (performance.now() - t0) / 1000;
  rows.push({
    agents: s.agents, food: s.food, cells: match.world.cells.length,
    'ticks/s (UPS)': Math.round(ticks / wall), 'x real time': ((ticks * match.world.config.tickSeconds) / wall).toFixed(1),
    'world ms/tick': (match.timing.worldMs / match.timing.ticks).toFixed(3),
    'policy ms/decision': (match.timing.policyMs / Math.max(1, match.timing.decisions)).toFixed(4),
  });
}
console.table(rows);
