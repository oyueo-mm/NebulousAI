import type { AgentAction, WorldEvent } from '../engine/types';
import type { Perception } from './perception';

// ------------------------------------------------------------------ actions

export const ACTION_VERSION = 'act-v1';
export const NUM_MOVES = 9;
export const NUM_SPECIALS = 3;
export const NUM_ACTIONS = NUM_MOVES * NUM_SPECIALS;
export const MOVE_NAMES = ['stay', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
export const SPECIAL_NAMES = ['none', 'split', 'eject'];

/**
 * act-v1: index = move · 3 + special.
 *   move 0 = stay, move k ∈ 1…8 heads at angle (k−1)·45° in world space (+x east,
 *   +y south, so 1 = E, 3 = S, 5 = W, 7 = N); special 0 = none, 1 = split, 2 = eject.
 * Impossible specials (cooldown, too small, cell cap) are accepted and ignored by the
 * engine, counted in stats.invalidSplits / invalidEjects.
 */
export function decodeAction(index: number): AgentAction {
  if (!Number.isInteger(index) || index < 0 || index >= NUM_ACTIONS) throw new Error(`action ${index} out of range`);
  const move = Math.floor(index / NUM_SPECIALS);
  const special = index % NUM_SPECIALS;
  let dx = 0, dy = 0;
  if (move > 0) {
    const a = ((move - 1) * Math.PI) / 4;
    dx = round12(Math.cos(a));
    dy = round12(Math.sin(a));
  }
  return { dx, dy, split: special === 1, eject: special === 2 };
}

export function describeAction(index: number): string {
  return `${MOVE_NAMES[Math.floor(index / NUM_SPECIALS)]} · ${SPECIAL_NAMES[index % NUM_SPECIALS]}`;
}

/** Removes ±1e-16 noise from cos/sin so the table is exactly symmetric. */
function round12(v: number): number {
  return Math.round(v * 1e12) / 1e12 + 0;
}

// -------------------------------------------------------------- observation

export const OBS_VERSION = 'obs-v1';
export const K_CELLS = 8;
export const K_FOOD = 8;
export const K_THORNS = 3;
export const FOOD_SECTORS = 8;
export const SELF_FEATURES = 12;
export const CELL_FEATURES = 10;
export const FOOD_FEATURES = 3;
export const THORN_FEATURES = 5;
export const OBS_SIZE = SELF_FEATURES + K_CELLS * CELL_FEATURES + K_FOOD * FOOD_FEATURES + FOOD_SECTORS + K_THORNS * THORN_FEATURES;

const clip = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Human-readable name of every observation slot (for the RL inspector and docs). */
export const OBS_LABELS: string[] = (() => {
  const l = ['self.logMass', 'self.cells', 'self.canSplit', 'self.canEject', 'self.vx', 'self.vy', 'self.wallW', 'self.wallE', 'self.wallN', 'self.wallS', 'self.largestFrac', 'self.mergeWait'];
  for (let i = 0; i < K_CELLS; i++) for (const f of ['valid', 'dx', 'dy', 'dist', 'logMassRatio', 'vx', 'vy', 'threat', 'prey', 'splitThreat']) l.push(`cell${i}.${f}`);
  for (let i = 0; i < K_FOOD; i++) for (const f of ['valid', 'dx', 'dy']) l.push(`food${i}.${f}`);
  for (let s = 0; s < FOOD_SECTORS; s++) l.push(`foodSector${s}`);
  for (let i = 0; i < K_THORNS; i++) for (const f of ['valid', 'dx', 'dy', 'dist', 'dangerous']) l.push(`thorn${i}.${f}`);
  return l;
})();

/**
 * obs-v1. Positions are relative to the agent's centre of mass and divided by its
 * vision radius; empty slots are all-zero with valid = 0. Only perceived entities
 * enter the vector — no global state, no screen coordinates.
 */
export function encodeObservation(p: Perception, out: Float32Array = new Float32Array(OBS_SIZE)): Float32Array {
  const cfg = p.config;
  const V = p.vision;
  const L = p.largest.mass, S = p.smallest.mass;
  out.fill(0);
  let i = 0;
  out[i++] = Math.log(p.totalMass / cfg.startMass) / 6;
  out[i++] = p.cells.length / cfg.maxCells;
  out[i++] = p.canSplit ? 1 : 0;
  out[i++] = p.canEject ? 1 : 0;
  out[i++] = clip(p.vx / cfg.speedBase, -3, 3);
  out[i++] = clip(p.vy / cfg.speedBase, -3, 3);
  out[i++] = clip(p.cx / V, 0, 1);
  out[i++] = clip((cfg.worldWidth - p.cx) / V, 0, 1);
  out[i++] = clip(p.cy / V, 0, 1);
  out[i++] = clip((cfg.worldHeight - p.cy) / V, 0, 1);
  out[i++] = L / p.totalMass;
  out[i++] = clip(p.mergeWait / cfg.mergeMax, 0, 1);

  for (let k = 0; k < K_CELLS; k++, i += CELL_FEATURES) {
    const o = p.others[k];
    if (!o) continue;
    out[i] = 1;
    out[i + 1] = clip((o.x - p.cx) / V, -1.5, 1.5);
    out[i + 2] = clip((o.y - p.cy) / V, -1.5, 1.5);
    out[i + 3] = clip(o.dist / V, 0, 1.5);
    out[i + 4] = clip(Math.log2(o.mass / L) / 4, -1.5, 1.5);
    out[i + 5] = clip(o.vx / cfg.speedBase, -3, 3);
    out[i + 6] = clip(o.vy / cfg.speedBase, -3, 3);
    out[i + 7] = o.mass >= cfg.eatRatio * S ? 1 : 0;
    out[i + 8] = L >= cfg.eatRatio * o.mass ? 1 : 0;
    out[i + 9] = o.mass >= cfg.minSplitMass && o.mass / 2 >= cfg.eatRatio * S ? 1 : 0;
  }

  for (let k = 0; k < K_FOOD; k++, i += FOOD_FEATURES) {
    const f = p.food[k];
    if (!f) continue;
    out[i] = 1;
    out[i + 1] = clip((f.x - p.cx) / V, -1, 1);
    out[i + 2] = clip((f.y - p.cy) / V, -1, 1);
  }
  const sectorBase = i;
  for (const f of p.food) {
    let a = Math.atan2(f.y - p.cy, f.x - p.cx);
    if (a < 0) a += 2 * Math.PI;
    const s = Math.min(FOOD_SECTORS - 1, Math.floor((a / (2 * Math.PI)) * FOOD_SECTORS));
    out[sectorBase + s] += f.mass / 30;
  }
  for (let s = 0; s < FOOD_SECTORS; s++) out[sectorBase + s] = Math.min(1, out[sectorBase + s]);
  i += FOOD_SECTORS;

  const thornDanger = L >= cfg.thornMass * cfg.thornTriggerRatio ? 1 : 0;
  for (let k = 0; k < K_THORNS; k++, i += THORN_FEATURES) {
    const th = p.thorns[k];
    if (!th) continue;
    out[i] = 1;
    out[i + 1] = clip((th.x - p.cx) / V, -1.5, 1.5);
    out[i + 2] = clip((th.y - p.cy) / V, -1.5, 1.5);
    out[i + 3] = clip(th.dist / V, 0, 1.5);
    out[i + 4] = thornDanger;
  }
  return out;
}

// ------------------------------------------------------------------- reward

export const REWARD_VERSION = 'reward-v1';

export interface RewardWeights {
  /** × Δ ln(total mass): growth with diminishing returns for already-large agents. */
  growth: number;
  /** Per enemy agent eliminated by this agent. */
  kill: number;
  /** Once, on death (terminal). */
  death: number;
  /** Per own cell lost to a predator. */
  cellLost: number;
  /** Per successful ejection (discourages eject/re-absorb loops). */
  eject: number;
  /** Per successful split. */
  split: number;
  /** Per rejected split / eject request. */
  invalid: number;
  /** Per decision step alive. */
  alive: number;
}

export const DEFAULT_REWARD: Readonly<RewardWeights> = Object.freeze({
  growth: 10, kill: 1, death: -3, cellLost: -0.25, eject: -0.03, split: -0.02, invalid: -0.01, alive: 0,
});

export interface RewardInput {
  agentId: number;
  massBefore: number;
  massAfter: number;
  died: boolean;
  invalidActions: number;
  events: WorldEvent[];
}

export interface RewardBreakdown {
  total: number;
  growth: number;
  kill: number;
  death: number;
  cellLost: number;
  actions: number;
  alive: number;
}

export function computeReward(x: RewardInput, w: RewardWeights = DEFAULT_REWARD): RewardBreakdown {
  const growth = !x.died && x.massBefore > 0 && x.massAfter > 0 ? w.growth * Math.log(x.massAfter / x.massBefore) : 0;
  let kills = 0, lost = 0, ejects = 0, splits = 0;
  for (const e of x.events) {
    if (e.type === 'death' && e.killer === x.agentId && e.agent !== x.agentId) kills++;
    else if (e.type === 'eatCell' && e.prey === x.agentId) lost++;
    else if (e.type === 'eject' && e.agent === x.agentId) ejects++;
    else if (e.type === 'split' && e.agent === x.agentId) splits++;
  }
  const b: RewardBreakdown = {
    growth,
    kill: w.kill * kills,
    death: x.died ? w.death : 0,
    cellLost: w.cellLost * lost,
    actions: w.eject * ejects + w.split * splits + w.invalid * x.invalidActions,
    alive: x.died ? 0 : w.alive,
    total: 0,
  };
  b.total = b.growth + b.kill + b.death + b.cellLost + b.actions + b.alive;
  return b;
}

// ---------------------------------------------------------------------- MLP

export const MODEL_FORMAT = 'nebulous-mlp';

export interface DenseLayer {
  /** Row-major [out][in]. */
  weight: number[][];
  bias: number[];
}

/** JSON exported by rl/nebulous_rl/export.py from a Stable-Baselines3 PPO policy. */
export interface MlpModelFile {
  format: typeof MODEL_FORMAT;
  formatVersion: 1;
  id: string;
  label: string;
  trained: boolean;
  obsVersion: string;
  actionVersion: string;
  rulesVersion: string;
  rewardVersion: string;
  activation: 'tanh' | 'relu';
  obsSize: number;
  numActions: number;
  /** Observation normalisation (VecNormalize): (x − mean) / sqrt(var + eps), clipped, rounded to float32. */
  obsNorm: { mean: number[]; var: number[]; clip: number; eps: number } | null;
  policyNet: DenseLayer[];
  actionNet: DenseLayer;
  valueNet: DenseLayer[];
  valueHead: DenseLayer;
  training?: Record<string, unknown>;
}

export interface PolicyOutput {
  logits: Float64Array;
  probs: Float64Array;
  value: number;
}

export class MlpPolicyModel {
  readonly file: MlpModelFile;
  private readonly act: (v: number) => number;

  constructor(file: MlpModelFile) {
    validateModel(file);
    this.file = file;
    this.act = file.activation === 'relu' ? (v) => (v > 0 ? v : 0) : Math.tanh;
  }

  normalize(obs: ArrayLike<number>): Float64Array {
    const f = this.file;
    const x = new Float64Array(f.obsSize);
    for (let i = 0; i < f.obsSize; i++) {
      let v = obs[i];
      if (f.obsNorm) {
        v = (v - f.obsNorm.mean[i]) / Math.sqrt(f.obsNorm.var[i] + f.obsNorm.eps);
        // SB3's VecNormalize clips, then casts to float32 before the network sees the value.
        v = Math.fround(clip(v, -f.obsNorm.clip, f.obsNorm.clip));
      }
      x[i] = v;
    }
    return x;
  }

  forward(obs: ArrayLike<number>): PolicyOutput {
    const x = this.normalize(obs);
    const latentPi = this.trunk(x, this.file.policyNet);
    const logits = dense(this.file.actionNet, latentPi, (v) => v);
    const latentVf = this.trunk(x, this.file.valueNet);
    const value = dense(this.file.valueHead, latentVf, (v) => v)[0];
    return { logits, probs: softmax(logits), value };
  }

  private trunk(x: Float64Array, layers: DenseLayer[]): Float64Array {
    let h = x;
    for (const layer of layers) h = dense(layer, h, this.act);
    return h;
  }
}

function dense(layer: DenseLayer, x: Float64Array, act: (v: number) => number): Float64Array {
  const out = new Float64Array(layer.bias.length);
  for (let o = 0; o < out.length; o++) {
    const row = layer.weight[o];
    let s = layer.bias[o];
    for (let i = 0; i < row.length; i++) s += row[i] * x[i];
    out[o] = act(s);
  }
  return out;
}

export function softmax(logits: ArrayLike<number>): Float64Array {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]);
  const p = new Float64Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) { p[i] = Math.exp(logits[i] - max); sum += p[i]; }
  for (let i = 0; i < p.length; i++) p[i] /= sum;
  return p;
}

/** Categorical sample by inverse CDF with one uniform draw u ∈ [0, 1). */
export function sampleCategorical(probs: ArrayLike<number>, u: number): number {
  let c = 0;
  for (let i = 0; i < probs.length; i++) {
    c += probs[i];
    if (u < c) return i;
  }
  return probs.length - 1;
}

export function argmax(v: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i;
  return best;
}

export function validateModel(f: MlpModelFile): void {
  const fail = (m: string): never => { throw new Error(`invalid model file: ${m}`); };
  if (!f || f.format !== MODEL_FORMAT || f.formatVersion !== 1) fail('unknown format');
  if (f.obsVersion !== OBS_VERSION) fail(`observation schema ${f.obsVersion} ≠ ${OBS_VERSION}`);
  if (f.actionVersion !== ACTION_VERSION) fail(`action encoding ${f.actionVersion} ≠ ${ACTION_VERSION}`);
  if (f.obsSize !== OBS_SIZE || f.numActions !== NUM_ACTIONS) fail('input/output size mismatch');
  if (f.activation !== 'tanh' && f.activation !== 'relu') fail('unsupported activation');
  const check = (layers: DenseLayer[], inWidth: number, name: string): number => {
    let w = inWidth;
    layers.forEach((l, k) => {
      if (!Array.isArray(l.weight) || !Array.isArray(l.bias) || l.weight.length !== l.bias.length) fail(`${name}[${k}] shape`);
      for (const row of l.weight) {
        if (!Array.isArray(row) || row.length !== w) fail(`${name}[${k}] expects width ${w}`);
        for (const v of row) if (!Number.isFinite(v)) fail(`${name}[${k}] has non-finite weights`);
      }
      for (const v of l.bias) if (!Number.isFinite(v)) fail(`${name}[${k}] has non-finite bias`);
      w = l.bias.length;
    });
    return w;
  };
  const pw = check(f.policyNet, f.obsSize, 'policyNet');
  if (check([f.actionNet], pw, 'actionNet') !== NUM_ACTIONS) fail('action head width');
  const vw = check(f.valueNet, f.obsSize, 'valueNet');
  if (check([f.valueHead], vw, 'valueHead') !== 1) fail('value head width');
  if (f.obsNorm) {
    if (f.obsNorm.mean.length !== f.obsSize || f.obsNorm.var.length !== f.obsSize) fail('obsNorm size');
    if (![...f.obsNorm.mean, ...f.obsNorm.var, f.obsNorm.clip, f.obsNorm.eps].every(Number.isFinite)) fail('obsNorm non-finite');
  }
}
