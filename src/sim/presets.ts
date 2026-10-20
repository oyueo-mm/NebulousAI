import type { ParticipantSpec } from './match';
import type { TournamentSpec } from './tournament';

const many = (kind: ParticipantSpec['kind'], n: number, extra: Partial<ParticipantSpec> = {}): ParticipantSpec[] =>
  Array.from({ length: n }, () => ({ kind, ...extra }));

/** Named, documented evaluation setups (also used by docs/EXPERIMENTS.md). */
export const PRESETS: Record<string, (seeds: number[]) => TournamentSpec> = {
  heuristics: (seeds) => ({
    name: 'heuristics',
    lineup: [...many('random', 2), ...many('greedy', 2), ...many('survival', 2), ...many('aggressive', 2), ...many('hybrid', 2)],
    seeds, rotations: 5, maxSeconds: 180, endWhenOneLeft: true,
  }),
  'greedy-vs-random': (seeds) => ({ name: 'greedy-vs-random', lineup: [...many('greedy', 4), ...many('random', 4)], seeds, rotations: 2, maxSeconds: 120 }),
  'greedy-vs-survival': (seeds) => ({ name: 'greedy-vs-survival', lineup: [...many('greedy', 4), ...many('survival', 4)], seeds, rotations: 2, maxSeconds: 180 }),
  'survival-vs-aggressive': (seeds) => ({ name: 'survival-vs-aggressive', lineup: [...many('survival', 4), ...many('aggressive', 4)], seeds, rotations: 2, maxSeconds: 180 }),
  'hybrid-vs-ppo': (seeds) => ({ name: 'hybrid-vs-ppo', lineup: [...many('hybrid', 4), ...many('ppo', 4, { modelId: 'ppo-v1' })], seeds, rotations: 2, maxSeconds: 180 }),
  'ppo-vs-ppo': (seeds) => ({ name: 'ppo-vs-ppo', lineup: [...many('ppo', 4, { modelId: 'ppo-v1' }), ...many('ppo', 4, { modelId: 'ppo-untrained' })], seeds, rotations: 2, maxSeconds: 180 }),
  'ppo-mixed': (seeds) => ({
    name: 'ppo-mixed',
    lineup: [...many('ppo', 2, { modelId: 'ppo-v1' }), ...many('random', 2), ...many('greedy', 2), ...many('survival', 2), ...many('aggressive', 2), ...many('hybrid', 2)],
    seeds, rotations: 6, maxSeconds: 180,
  }),
  'ppo-untrained-mixed': (seeds) => ({
    name: 'ppo-untrained-mixed',
    lineup: [...many('ppo', 2, { modelId: 'ppo-untrained' }), ...many('random', 2), ...many('greedy', 2), ...many('survival', 2), ...many('aggressive', 2), ...many('hybrid', 2)],
    seeds, rotations: 6, maxSeconds: 180,
  }),
};
