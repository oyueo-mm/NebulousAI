import { describe, expect, it } from 'vitest';
import { Rng } from '../engine/rng';
import { World } from '../engine/world';
import { AggressivePolicy, GreedyPolicy, HybridPolicy, RandomPolicy, SurvivalPolicy } from './heuristics';
import { perceive } from './perception';
import {
  ACTION_VERSION, MODEL_FORMAT, NUM_ACTIONS, OBS_LABELS, OBS_SIZE, OBS_VERSION, MlpPolicyModel, type MlpModelFile, actionMask,
  computeReward, decodeAction, encodeAction, encodeObservation, sampleCategorical, softmax,
} from './rl';

function arena(n: number): World {
  return new World({ seed: 1, agents: Array.from({ length: n }, (_, i) => ({ name: `a${i}` })), config: { foodMax: 0, foodInitialFraction: 0, thornCount: 0 } });
}

describe('perception', () => {
  it('only reports entities inside the vision radius', () => {
    const w = arena(3);
    w.placeCell(0, 500, 500, 20, { replace: true });
    w.placeCell(1, 900, 500, 20, { replace: true });
    w.placeCell(2, 2900, 2900, 20, { replace: true });
    w.placeFood(520, 500);
    w.placeFood(2800, 2800);
    const p = perceive(w, 0)!;
    expect(p.vision).toBeGreaterThan(400);
    expect(p.others.map((o) => o.owner)).toEqual([1]);
    expect(p.food.length).toBe(1);
  });

  it('returns null for dead agents', () => {
    const w = arena(2);
    w.placeCell(0, 1500, 1500, 300, { replace: true });
    w.placeCell(1, 1500, 1500, 20, { replace: true });
    w.step([]);
    expect(perceive(w, 1)).toBeNull();
  });
});

describe('heuristic policies', () => {
  const policies = [new RandomPolicy(), new GreedyPolicy(), new SurvivalPolicy(), new AggressivePolicy(), new HybridPolicy()];

  it('always return finite, bounded actions on a busy random world', () => {
    const w = new World({ seed: 9, agents: Array.from({ length: 10 }, (_, i) => ({ name: `a${i}`, startMass: 20 + 30 * i })) });
    const rng = new Rng(1);
    for (let t = 0; t < 300; t++) {
      for (let i = 0; i < 10; i++) {
        const p = perceive(w, i);
        if (!p) continue;
        const { action, trace } = policies[i % 5].decide(p, rng);
        expect(Number.isFinite(action.dx) && Number.isFinite(action.dy)).toBe(true);
        expect(Math.hypot(action.dx, action.dy)).toBeLessThanOrEqual(1 + 1e-9);
        expect(trace.kind).toBe('heuristic');
      }
      w.step(w.agents.map(() => ({ dx: 0.3, dy: -0.2, split: false, eject: false })));
    }
  });

  it('Greedy heads for food; Survival flees a big threat; Aggressive split-attacks reachable prey', () => {
    const w = arena(3);
    w.placeCell(0, 1000, 1000, 40, { replace: true });
    w.placeCell(1, 2500, 2500, 20, { replace: true });
    w.placeCell(2, 200, 2800, 20, { replace: true });
    w.placeFood(1200, 1000);
    const g = new GreedyPolicy().decide(perceive(w, 0)!, new Rng(1));
    expect(g.action.dx).toBeGreaterThan(0.9);

    const w2 = arena(2);
    w2.placeCell(0, 1500, 1500, 30, { replace: true });
    w2.placeCell(1, 1650, 1500, 400, { replace: true });
    const s = new SurvivalPolicy().decide(perceive(w2, 0)!, new Rng(1));
    expect(s.action.dx).toBeLessThan(0);
    expect(s.trace.kind === 'heuristic' && s.trace.threatIds.length).toBe(1);

    const w3 = arena(2);
    w3.placeCell(0, 1500, 1500, 300, { replace: true });
    w3.placeCell(1, 1650, 1500, 40, { replace: true });
    const a = new AggressivePolicy().decide(perceive(w3, 0)!, new Rng(1));
    expect(a.action.split).toBe(true);
    expect(a.action.dx).toBeGreaterThan(0.9);
    expect(a.trace.kind === 'heuristic' && a.trace.preyId).not.toBeNull();
  });

  it('Aggressive declines a split attack when a counter-threat sits near the prey', () => {
    const w = arena(3);
    w.placeCell(0, 1500, 1500, 300, { replace: true });
    w.placeCell(1, 1650, 1500, 40, { replace: true });
    w.placeCell(2, 1800, 1500, 260, { replace: true });
    const a = new AggressivePolicy().decide(perceive(w, 0)!, new Rng(1));
    expect(a.action.split).toBe(false);
  });

  it('Random is reproducible from its seed', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, 50, { replace: true });
    const run = () => { const r = new Rng(77); return Array.from({ length: 20 }, () => new RandomPolicy().decide(perceive(w, 0)!, r).action); };
    expect(run()).toEqual(run());
  });
});

describe('act-v1 action encoding', () => {
  it('maps 27 indices to 9 moves × 3 specials in the documented order', () => {
    expect(NUM_ACTIONS).toBe(27);
    expect(ACTION_VERSION).toBe('act-v1');
    expect(decodeAction(0)).toEqual({ dx: 0, dy: 0, split: false, eject: false });
    expect(decodeAction(1)).toEqual({ dx: 0, dy: 0, split: true, eject: false });
    expect(decodeAction(2)).toEqual({ dx: 0, dy: 0, split: false, eject: true });
    expect(decodeAction(3)).toEqual({ dx: 1, dy: 0, split: false, eject: false });
    expect(decodeAction(9)).toMatchObject({ dx: 0, dy: 1 });
    expect(decodeAction(15)).toMatchObject({ dx: -1, dy: 0 });
    expect(decodeAction(21)).toMatchObject({ dx: 0, dy: -1 });
    const ne = decodeAction(24 + 1);
    expect(ne.dx).toBeCloseTo(Math.SQRT1_2, 12);
    expect(ne.dy).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(ne.split).toBe(true);
    expect(() => decodeAction(27)).toThrow();
    expect(() => decodeAction(-1)).toThrow();
    expect(() => decodeAction(1.5)).toThrow();
  });

  it('encodeAction quantises continuous actions and inverts decodeAction', () => {
    for (let i = 0; i < NUM_ACTIONS; i++) expect(encodeAction(decodeAction(i))).toBe(i);
    expect(encodeAction({ dx: 0.1, dy: 0.1, split: false, eject: false })).toBe(0);
    expect(encodeAction({ dx: 1, dy: 0.3, split: true, eject: true })).toBe(3 + 1);
    expect(encodeAction({ dx: -0.2, dy: -0.98, split: false, eject: true })).toBe(7 * 3 + 2);
    expect(encodeAction({ dx: 0.95, dy: -0.31, split: false, eject: false })).toBe(3);
  });
});

describe('obs-v1 observation encoding', () => {
  it('has the documented size, labels, masks and no non-finite values', () => {
    expect(OBS_SIZE).toBe(139);
    expect(OBS_LABELS.length).toBe(OBS_SIZE);
    expect(OBS_VERSION).toBe('obs-v1');
    const w = arena(2);
    w.placeCell(0, 1500, 1500, 50, { replace: true });
    w.placeCell(1, 1700, 1500, 30, { replace: true });
    w.placeFood(1550, 1500);
    const obs = encodeObservation(perceive(w, 0)!);
    expect(obs.length).toBe(OBS_SIZE);
    expect(obs.every((v) => Number.isFinite(v))).toBe(true);
    const at = (label: string) => obs[OBS_LABELS.indexOf(label)];
    expect(at('cell0.valid')).toBe(1);
    expect(at('cell0.dx')).toBeGreaterThan(0);
    expect(at('cell0.prey')).toBe(1);
    expect(at('cell0.threat')).toBe(0);
    expect(at('cell1.valid')).toBe(0);
    expect(at('cell1.dx')).toBe(0);
    expect(at('food0.valid')).toBe(1);
    expect(at('food1.valid')).toBe(0);
    expect(at('self.canSplit')).toBe(1);
  });

  it('is unaffected by anything outside the vision radius', () => {
    const make = (farX: number) => {
      const w = arena(3);
      w.placeCell(0, 500, 500, 30, { replace: true });
      w.placeCell(1, 700, 500, 25, { replace: true });
      w.placeCell(2, farX, 2800, 2000, { replace: true });
      return Array.from(encodeObservation(perceive(w, 0)!));
    };
    expect(make(2500)).toEqual(make(2700));
  });
});

function tinyModel(): MlpModelFile {
  const zeros = (r: number, c: number) => Array.from({ length: r }, () => new Array(c).fill(0));
  const w1 = zeros(2, OBS_SIZE);
  w1[0][0] = 1; w1[1][1] = -1;
  const head = zeros(NUM_ACTIONS, 2);
  head[3][0] = 2; head[4][1] = 1;
  return {
    format: MODEL_FORMAT, formatVersion: 1, id: 'tiny', label: 'tiny', trained: false, obsVersion: OBS_VERSION, actionVersion: ACTION_VERSION,
    rulesVersion: 'rules-v1', rewardVersion: 'reward-v1', activation: 'tanh', obsSize: OBS_SIZE, numActions: NUM_ACTIONS,
    obsNorm: { mean: new Array(OBS_SIZE).fill(0.5), var: new Array(OBS_SIZE).fill(0.25), clip: 10, eps: 0 },
    policyNet: [{ weight: w1, bias: [0, 0] }], actionNet: { weight: head, bias: new Array(NUM_ACTIONS).fill(0) },
    valueNet: [{ weight: w1, bias: [0.5, 0] }], valueHead: { weight: [[1, 1]], bias: [0.25] },
  };
}

describe('MLP inference', () => {
  it('computes normalisation, tanh layers, logits and value exactly', () => {
    const m = new MlpPolicyModel(tinyModel());
    const obs = new Float32Array(OBS_SIZE);
    obs[0] = 1; obs[1] = 0;
    const out = m.forward(obs);
    // normalised: x0 = (1 − 0.5)/0.5 = 1, x1 = (0 − 0.5)/0.5 = −1
    const h0 = Math.tanh(1), h1 = Math.tanh(1);
    expect(out.logits[3]).toBeCloseTo(2 * h0, 12);
    expect(out.logits[4]).toBeCloseTo(h1, 12);
    expect(out.logits[0]).toBe(0);
    expect(out.value).toBeCloseTo(Math.tanh(1.5) + Math.tanh(1) + 0.25, 12);
    expect(out.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('rejects models with the wrong schema, shape or non-finite weights', () => {
    expect(() => new MlpPolicyModel({ ...tinyModel(), obsVersion: 'obs-v0' })).toThrow();
    expect(() => new MlpPolicyModel({ ...tinyModel(), obsSize: 10 })).toThrow();
    const bad = tinyModel();
    bad.policyNet[0].weight[0][5] = Number.NaN;
    expect(() => new MlpPolicyModel(bad)).toThrow();
    const short = tinyModel();
    short.actionNet.bias = [0];
    expect(() => new MlpPolicyModel(short)).toThrow();
  });

  it('action masking removes impossible splits / ejects exactly when the observation says so', () => {
    const m = new MlpPolicyModel({ ...tinyModel(), actionMasking: true });
    const obs = new Float32Array(OBS_SIZE);
    obs[2] = 0; obs[3] = 1; // cannot split, can eject
    const out = m.forward(obs);
    expect(out.mask).toEqual(actionMask(obs));
    for (let a = 0; a < NUM_ACTIONS; a++) {
      if (a % 3 === 1) expect(out.probs[a]).toBe(0);
      else expect(out.probs[a]).toBeGreaterThan(0);
    }
    expect(out.probs.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
    expect(new MlpPolicyModel(tinyModel()).forward(obs).mask).toBeNull();
  });

  it('softmax is stable for large logits; sampling follows the CDF', () => {
    const p = softmax([1000, 1000, 0]);
    expect(p[0]).toBeCloseTo(0.5, 12);
    expect(sampleCategorical([0.2, 0.3, 0.5], 0.1)).toBe(0);
    expect(sampleCategorical([0.2, 0.3, 0.5], 0.49)).toBe(1);
    expect(sampleCategorical([0.2, 0.3, 0.5], 0.99)).toBe(2);
  });
});

describe('reward-v1', () => {
  it('rewards log-growth, kills; penalises death, lost cells and action spam', () => {
    const grow = computeReward({ agentId: 0, massBefore: 20, massAfter: 22, died: false, invalidActions: 0, events: [] });
    expect(grow.total).toBeCloseTo(10 * Math.log(22 / 20), 12);
    const big = computeReward({ agentId: 0, massBefore: 2000, massAfter: 2002, died: false, invalidActions: 0, events: [] });
    expect(big.growth).toBeLessThan(grow.growth / 50);
    const death = computeReward({ agentId: 0, massBefore: 20, massAfter: 0, died: true, invalidActions: 0, events: [{ type: 'eatCell', predator: 1, prey: 0, mass: 20, preyCellId: 5 }] });
    expect(death.total).toBeCloseTo(-3 - 0.25, 12);
    const kill = computeReward({ agentId: 1, massBefore: 100, massAfter: 100, died: false, invalidActions: 2, events: [{ type: 'death', agent: 0, killer: 1 }, { type: 'eject', agent: 1, mass: 12.8 }] });
    expect(kill.total).toBeCloseTo(1 - 0.03 - 0.02, 12);
  });
});
