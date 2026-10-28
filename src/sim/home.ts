import type { MatchSetup } from './match';

/** A normal seeded heuristic match; only arena settings and lineup differ from Watch. */
export function homeSetup(): MatchSetup {
  return {
    seed: 202607,
    participants: [
      { kind: 'greedy', startMass: 160 }, { kind: 'survival', startMass: 90 },
      { kind: 'aggressive', startMass: 250 }, { kind: 'hybrid', startMass: 120 },
      { kind: 'greedy', startMass: 70 }, { kind: 'survival', startMass: 110 },
    ],
    config: { worldWidth: 1400, worldHeight: 1400, foodMax: 180, thornCount: 0, respawn: true },
    maxSeconds: 0, endWhenOneLeft: false,
  };
}
