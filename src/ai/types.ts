import type { Rng } from '../engine/rng';
import type { AgentAction } from '../engine/types';
import type { Perception } from './perception';

export type PolicyKind = 'random' | 'greedy' | 'survival' | 'aggressive' | 'hybrid' | 'ppo';

export const POLICY_KINDS: PolicyKind[] = ['random', 'greedy', 'survival', 'aggressive', 'hybrid', 'ppo'];

export const POLICY_LABELS: Record<PolicyKind, string> = {
  random: 'Random',
  greedy: 'Greedy',
  survival: 'Survival',
  aggressive: 'Aggressive',
  hybrid: 'Hybrid',
  ppo: 'PPO (neural)',
};

/**
 * Structured explanation attached to a heuristic decision. The UI renders it in the user's language;
 * the numbers are the values the decision code actually computed.
 */
export interface TraceNote {
  key: 'randomWalk' | 'threatGap' | 'safePath' | 'headings' | 'foodHeading' | 'intercept';
  values: Record<string, number>;
}

/**
 * What a heuristic actually used to choose its action. Every field is produced by
 * the decision code itself, never reconstructed after the fact.
 */
export interface HeuristicTrace {
  kind: 'heuristic';
  mode: string;
  target: { x: number; y: number } | null;
  targetKind: 'food' | 'prey' | 'flee' | 'wander' | 'regroup' | null;
  preyId: number | null;
  threatIds: number[];
  /** Highest danger among visible threats, 0 … 1. */
  risk: number;
  split: boolean;
  eject: boolean;
  note: TraceNote | null;
}

/** Neural policies expose their real outputs instead of an invented "goal". */
export interface NeuralTrace {
  kind: 'neural';
  modelId: string;
  trained: boolean;
  action: number;
  probs: number[];
  value: number | null;
  observation: number[];
  deterministic: boolean;
}

export type PolicyTrace = HeuristicTrace | NeuralTrace;

export interface Policy {
  readonly kind: PolicyKind;
  /** Chooses an action from what the agent can perceive. Must not mutate the world. */
  decide(p: Perception, rng: Rng): { action: AgentAction; trace: PolicyTrace };
}
