/**
 * Golden trajectory shared by the TypeScript and Python test suites.
 *
 * `npm test` checks that the in-process engine reproduces rl/tests/fixtures/golden_trajectory.json;
 * `pytest rl/tests` checks that the Python environment (through the Node bridge) reproduces
 * the same file. Together they show both sides run identical rules, observations and rewards.
 * Regenerate deliberately (and bump RULES_VERSION if rules changed) with UPDATE_GOLDEN=1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LearnerEnv, VERSIONS, type EnvConfig } from '../../rl/bridge/envs';

const FILE = resolve(__dirname, '../../rl/tests/fixtures/golden_trajectory.json');

export const GOLDEN_ENV: EnvConfig = {
  decisionInterval: 2,
  scenarios: [{
    name: 'golden', maxSeconds: 40, learnerStartMass: [60, 60], config: { respawn: true, thornCount: 4 },
    opponents: [
      { kind: 'random', count: 2 }, { kind: 'greedy', count: 2, startMass: [80, 80] }, { kind: 'survival', count: 1 },
      { kind: 'aggressive', count: 1, startMass: [120, 120] }, { kind: 'hybrid', count: 1 },
    ],
  }],
};
export const GOLDEN_SEED = 31337;
export const GOLDEN_STEPS = 300;

/** Fixed action sequence: a 32-bit LCG, documented so any implementation can regenerate it. */
export function goldenActions(): number[] {
  let s = 12345;
  return Array.from({ length: GOLDEN_STEPS }, () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 16) % 27;
  });
}

function record() {
  const env = new LearnerEnv(GOLDEN_ENV, new Map());
  const actions = goldenActions();
  const obs0 = Array.from(env.reset(GOLDEN_SEED));
  const steps: { reward: number; terminated: boolean; truncated: boolean }[] = [];
  const checkpoints: { step: number; obs: number[]; cells: number[][]; food: number; pellets: number; tick: number }[] = [];
  let ended = -1;
  for (let i = 0; i < actions.length; i++) {
    const r = env.step(actions[i]);
    steps.push({ reward: r.reward, terminated: r.terminated, truncated: r.truncated });
    if (i % 25 === 24 || r.terminated || r.truncated) {
      const w = env.match.world;
      checkpoints.push({
        step: i, tick: w.tick, obs: Array.from(r.obs), food: w.food.length, pellets: w.pellets.length,
        cells: w.cells.map((c) => [c.id, c.owner, c.x, c.y, c.mass, c.r]),
      });
    }
    if (r.terminated || r.truncated) { ended = i; break; }
  }
  return { versions: VERSIONS, env: GOLDEN_ENV, seed: GOLDEN_SEED, actions, obs0, steps, checkpoints, ended };
}

describe('golden trajectory', () => {
  it('the engine reproduces the committed golden trajectory exactly', () => {
    const got = record();
    if (process.env.UPDATE_GOLDEN || !existsSync(FILE)) {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(got));
    }
    const want = JSON.parse(readFileSync(FILE, 'utf8'));
    expect(got.versions).toEqual(want.versions);
    expect(got.actions).toEqual(want.actions);
    expect(got.obs0).toEqual(want.obs0);
    expect(got.steps).toEqual(want.steps);
    expect(got.checkpoints).toEqual(want.checkpoints);
    expect(got.steps.length).toBeGreaterThan(50);
    expect(got.checkpoints.some((c) => c.cells.length > 5)).toBe(true);
  });
});
