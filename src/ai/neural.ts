import type { Rng } from '../engine/rng';
import type { Perception } from './perception';
import { MlpPolicyModel, OBS_SIZE, argmax, decodeAction, encodeObservation, sampleCategorical } from './rl';
import type { Policy, PolicyKind, PolicyTrace } from './types';

/**
 * A real neural policy: obs-v1 → MLP → 27 action probabilities → act-v1 action.
 * There is no hand-written rule anywhere in this path.
 */
export class NeuralPolicy implements Policy {
  readonly kind: PolicyKind = 'ppo';
  private readonly obs = new Float32Array(OBS_SIZE);

  constructor(readonly model: MlpPolicyModel, readonly deterministic = false) {}

  decide(p: Perception, rng: Rng) {
    const obs = encodeObservation(p, this.obs);
    const out = this.model.forward(obs);
    // Always draw, so the agent's RNG stream advances identically in both modes.
    const u = rng.next();
    const index = this.deterministic ? argmax(out.probs) : sampleCategorical(out.probs, u);
    const trace: PolicyTrace = {
      kind: 'neural', modelId: this.model.file.id, trained: this.model.file.trained, action: index,
      probs: Array.from(out.probs), value: out.value, observation: Array.from(obs), deterministic: this.deterministic,
    };
    return { action: decodeAction(index), trace };
  }
}
