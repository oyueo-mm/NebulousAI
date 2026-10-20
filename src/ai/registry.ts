import { AggressivePolicy, GreedyPolicy, HybridPolicy, RandomPolicy, SurvivalPolicy } from './heuristics';
import { NeuralPolicy } from './neural';
import type { MlpPolicyModel } from './rl';
import type { Policy, PolicyKind } from './types';

export interface PolicySpec {
  kind: PolicyKind;
  /** Required for 'ppo': id of a loaded model. */
  modelId?: string;
  deterministic?: boolean;
}

export function createPolicy(spec: PolicySpec, models: ReadonlyMap<string, MlpPolicyModel>): Policy {
  switch (spec.kind) {
    case 'random': return new RandomPolicy();
    case 'greedy': return new GreedyPolicy();
    case 'survival': return new SurvivalPolicy();
    case 'aggressive': return new AggressivePolicy();
    case 'hybrid': return new HybridPolicy();
    case 'ppo': {
      const model = spec.modelId ? models.get(spec.modelId) : undefined;
      if (!model) throw new Error(`PPO policy needs a loaded model (got ${spec.modelId ?? 'none'})`);
      return new NeuralPolicy(model, spec.deterministic ?? false);
    }
  }
}
