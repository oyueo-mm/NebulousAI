import type { GameConfig } from '../engine/config';
import { RULES_VERSION } from '../engine/config';
import { Rng, deriveSeed } from '../engine/rng';
import type { AgentAction, WorldEvent } from '../engine/types';
import { IDLE_ACTION } from '../engine/types';
import { World, type WorldSnapshot } from '../engine/world';
import { perceive } from '../ai/perception';
import { createPolicy } from '../ai/registry';
import { DEFAULT_REWARD, type MlpPolicyModel, type RewardBreakdown, type RewardWeights, computeReward } from '../ai/rl';
import type { Policy, PolicyKind, PolicyTrace } from '../ai/types';
import { POLICY_LABELS } from '../ai/types';

export type ControllerKind = PolicyKind | 'human' | 'external';

export interface ParticipantSpec {
  kind: ControllerKind;
  name?: string;
  modelId?: string;
  deterministic?: boolean;
  startMass?: number;
}

export interface MatchSetup {
  seed: number;
  participants: ParticipantSpec[];
  config?: Partial<GameConfig>;
  /** Every AI decides once per this many ticks (and holds its action in between). */
  decisionInterval?: number;
  spawnRotation?: number;
  /** Simulated seconds after which the match is over; 0 = endless. */
  maxSeconds?: number;
  /** End as soon as at most one agent is alive (no-respawn tournaments). */
  endWhenOneLeft?: boolean;
  reward?: Partial<RewardWeights>;
}

export const DEFAULT_DECISION_INTERVAL = 2;

export interface Standing {
  agentId: number;
  name: string;
  kind: ControllerKind;
  modelId: string | null;
  rank: number;
  alive: boolean;
  mass: number;
  maxMass: number;
  survivalSeconds: number;
  diedAt: number;
  kills: number;
  cellsEaten: number;
  foodEaten: number;
  splits: number;
  ejects: number;
  deaths: number;
  splitHits: number;
  cellsLost: number;
  episodeReturn: number;
}

export interface MatchResult {
  seed: number;
  spawnRotation: number;
  rulesVersion: string;
  ticks: number;
  seconds: number;
  standings: Standing[];
  winner: number;
}

interface Window {
  massBefore: number[];
  aliveBefore: boolean[];
  invalidBefore: number[];
  events: WorldEvent[];
}

const HISTORY_EVERY_TICKS = 15;
export const SPLIT_SUCCESS_SECONDS = 3;
const HISTORY_MAX = 800;

export class Match {
  readonly world: World;
  readonly setup: Required<Omit<MatchSetup, 'config' | 'reward'>> & Pick<MatchSetup, 'config'>;
  readonly kinds: ControllerKind[];
  readonly reward: RewardWeights;
  private readonly policies: (Policy | null)[];
  private readonly rngs: Rng[];
  /** Most recent decision trace per agent (null for human / external / dead). */
  readonly traces: (PolicyTrace | null)[];
  private readonly decided: AgentAction[];
  private readonly external: AgentAction[];
  private window: Window | null = null;
  readonly lastReward: (RewardBreakdown | null)[];
  readonly episodeReturn: number[];
  /** Total mass per agent sampled twice per simulated second, for charts. */
  readonly history: { t: number; mass: number[] }[] = [];
  readonly timing = { worldMs: 0, policyMs: 0, ticks: 0, decisions: 0 };
  /** Splits followed by eating an enemy cell within SPLIT_SUCCESS_SECONDS. */
  readonly splitHits: number[];
  readonly cellsLost: number[];
  private readonly splitPendingAt: number[];

  constructor(setup: MatchSetup, models: ReadonlyMap<string, MlpPolicyModel> = new Map()) {
    if (setup.participants.length === 0) throw new Error('a match needs at least one participant');
    this.setup = {
      seed: setup.seed >>> 0,
      participants: setup.participants.map((p) => ({ ...p })),
      config: setup.config,
      decisionInterval: Math.max(1, Math.floor(setup.decisionInterval ?? DEFAULT_DECISION_INTERVAL)),
      spawnRotation: setup.spawnRotation ?? 0,
      maxSeconds: setup.maxSeconds ?? 0,
      endWhenOneLeft: setup.endWhenOneLeft ?? false,
    };
    this.reward = { ...DEFAULT_REWARD, ...setup.reward };
    this.kinds = setup.participants.map((p) => p.kind);
    this.world = new World({
      seed: this.setup.seed,
      agents: setup.participants.map((p, i) => ({ name: p.name ?? defaultName(p, i), startMass: p.startMass })),
      config: setup.config,
      spawnRotation: this.setup.spawnRotation,
    });
    this.policies = setup.participants.map((p) => (p.kind === 'human' || p.kind === 'external' ? null : createPolicy({ kind: p.kind, modelId: p.modelId, deterministic: p.deterministic }, models)));
    this.rngs = setup.participants.map((_, i) => new Rng(deriveSeed(this.setup.seed, 1000 + i)));
    const n = setup.participants.length;
    this.traces = new Array(n).fill(null);
    this.decided = Array.from({ length: n }, () => ({ ...IDLE_ACTION }));
    this.external = Array.from({ length: n }, () => ({ ...IDLE_ACTION }));
    this.lastReward = new Array(n).fill(null);
    this.episodeReturn = new Array(n).fill(0);
    this.splitHits = new Array(n).fill(0);
    this.cellsLost = new Array(n).fill(0);
    this.splitPendingAt = new Array(n).fill(-1);
    this.recordHistory();
  }

  get tick(): number {
    return this.world.tick;
  }

  get seconds(): number {
    return this.world.time;
  }

  isDecisionTick(): boolean {
    return this.world.tick % this.setup.decisionInterval === 0;
  }

  /**
   * Sets the action of a human / external controller. Split and eject fire once on
   * the next tick and then clear, so a held key does not spam.
   */
  setExternalAction(agentId: number, action: AgentAction): void {
    if (this.policies[agentId]) throw new Error(`agent ${agentId} is controlled by a policy`);
    const e = this.external[agentId];
    e.dx = action.dx; e.dy = action.dy;
    e.split = e.split || action.split;
    e.eject = e.eject || action.eject;
  }

  /** One fixed simulation tick, deciding first when on a decision boundary. */
  step(): void {
    const decisionTick = this.isDecisionTick();
    if (decisionTick) {
      this.closeWindow();
      this.decideAll();
      this.openWindow();
    }
    const n = this.policies.length;
    const actions: AgentAction[] = new Array(n);
    for (let i = 0; i < n; i++) {
      if (this.policies[i]) {
        const d = this.decided[i];
        actions[i] = decisionTick ? d : { dx: d.dx, dy: d.dy, split: false, eject: false };
      } else {
        const e = this.external[i];
        actions[i] = { ...e };
        e.split = false; e.eject = false;
      }
    }
    const t0 = now();
    this.world.step(actions);
    this.timing.worldMs += now() - t0;
    this.timing.ticks++;
    if (this.window) for (const e of this.world.events) this.window.events.push(e);
    this.trackSplitAttacks();
    if (this.world.tick % HISTORY_EVERY_TICKS === 0) this.recordHistory();
  }

  /** Runs ticks up to the next decision boundary and closes the reward window. */
  advanceDecision(): void {
    do this.step(); while (!this.isDecisionTick());
    this.closeWindow();
  }

  isOver(): boolean {
    const { maxSeconds, endWhenOneLeft } = this.setup;
    if (maxSeconds > 0 && this.world.time >= maxSeconds - 1e-9) return true;
    if (endWhenOneLeft && this.world.agents.length > 1 && this.world.agents.filter((a) => a.alive).length <= 1) return true;
    if (this.world.agents.every((a) => !a.alive) && !this.world.config.respawn) return true;
    return false;
  }

  policyLabel(agentId: number): string {
    const k = this.kinds[agentId];
    if (k === 'human') return 'Human';
    if (k === 'external') return 'External';
    const p = this.setup.participants[agentId];
    return k === 'ppo' ? `${POLICY_LABELS.ppo} · ${p.modelId}` : POLICY_LABELS[k];
  }

  /**
   * Ranking: alive agents by current mass, then dead agents by how long they lasted,
   * ties broken by peak mass then agent id. Documented in docs/AI_ALGORITHMS.md.
   */
  standings(): Standing[] {
    const rows: Standing[] = this.world.agents.map((a) => ({
      agentId: a.id, name: a.name, kind: this.kinds[a.id], modelId: this.setup.participants[a.id].modelId ?? null, rank: 0,
      alive: a.alive, mass: a.alive ? a.totalMass : 0, maxMass: a.stats.maxMass, survivalSeconds: a.aliveSeconds,
      diedAt: a.diedAt, kills: a.stats.kills, cellsEaten: a.stats.cellsEaten, foodEaten: a.stats.foodEaten,
      splits: a.stats.splits, ejects: a.stats.ejects, deaths: a.stats.deaths, splitHits: this.splitHits[a.id],
      cellsLost: this.cellsLost[a.id], episodeReturn: this.episodeReturn[a.id],
    }));
    const sorted = [...rows].sort((x, y) => {
      if (x.alive !== y.alive) return x.alive ? -1 : 1;
      if (x.alive) return y.mass - x.mass || y.maxMass - x.maxMass || x.agentId - y.agentId;
      return y.survivalSeconds - x.survivalSeconds || y.maxMass - x.maxMass || x.agentId - y.agentId;
    });
    sorted.forEach((r, i) => (r.rank = i + 1));
    return rows;
  }

  result(): MatchResult {
    const standings = this.standings();
    return {
      seed: this.setup.seed, spawnRotation: this.setup.spawnRotation, rulesVersion: RULES_VERSION,
      ticks: this.world.tick, seconds: this.world.time, standings,
      winner: standings.find((s) => s.rank === 1)!.agentId,
    };
  }

  // ------------------------------------------------------------- internals

  private decideAll(): void {
    const t0 = now();
    for (let i = 0; i < this.policies.length; i++) {
      const policy = this.policies[i];
      if (!policy) continue;
      const p = perceive(this.world, i);
      if (!p) { this.traces[i] = null; this.decided[i] = { ...IDLE_ACTION }; continue; }
      const d = policy.decide(p, this.rngs[i]);
      this.decided[i] = d.action;
      this.traces[i] = d.trace;
      this.timing.decisions++;
    }
    this.timing.policyMs += now() - t0;
  }

  private openWindow(): void {
    const agents = this.world.agents;
    this.window = {
      massBefore: agents.map((a) => (a.alive ? a.totalMass : 0)),
      aliveBefore: agents.map((a) => a.alive),
      invalidBefore: agents.map((a) => a.stats.invalidSplits + a.stats.invalidEjects),
      events: [],
    };
  }

  private closeWindow(): void {
    const w = this.window;
    if (!w) return;
    this.window = null;
    for (const a of this.world.agents) {
      if (!w.aliveBefore[a.id]) { this.lastReward[a.id] = null; continue; }
      const r = computeReward({
        agentId: a.id, massBefore: w.massBefore[a.id], massAfter: a.alive ? a.totalMass : 0, died: !a.alive,
        invalidActions: a.stats.invalidSplits + a.stats.invalidEjects - w.invalidBefore[a.id], events: w.events,
      }, this.reward);
      this.lastReward[a.id] = r;
      this.episodeReturn[a.id] += r.total;
    }
  }

  private trackSplitAttacks(): void {
    const t = this.world.time;
    for (const e of this.world.events) {
      if (e.type === 'split') this.splitPendingAt[e.agent] = t;
      else if (e.type === 'eatCell') {
        this.cellsLost[e.prey]++;
        if (this.splitPendingAt[e.predator] >= 0) {
          this.splitHits[e.predator]++;
          this.splitPendingAt[e.predator] = -1;
        }
      }
    }
    for (let i = 0; i < this.splitPendingAt.length; i++) {
      if (this.splitPendingAt[i] >= 0 && t - this.splitPendingAt[i] > SPLIT_SUCCESS_SECONDS) this.splitPendingAt[i] = -1;
    }
  }

  private recordHistory(): void {
    this.history.push({ t: this.world.time, mass: this.world.agents.map((a) => (a.alive ? a.totalMass : 0)) });
    if (this.history.length > HISTORY_MAX) {
      // Keep every other sample: bounded memory, still covers the whole match.
      const kept = this.history.filter((_, i) => i % 2 === 0);
      this.history.length = 0;
      this.history.push(...kept);
    }
  }

  // ----------------------------------------------------------- persistence

  toJSON(): MatchSnapshot {
    return {
      format: 'nebulous-match', version: 1, rulesVersion: RULES_VERSION,
      setup: { ...this.setup, participants: this.setup.participants.map((p) => ({ ...p })) }, reward: { ...this.reward },
      world: this.world.toJSON(), rngStates: this.rngs.map((r) => r.getState()),
      decided: this.decided.map((a) => ({ ...a })), episodeReturn: [...this.episodeReturn],
    };
  }

  static fromJSON(raw: unknown, models: ReadonlyMap<string, MlpPolicyModel> = new Map()): Match {
    if (!raw || typeof raw !== 'object') throw new Error('invalid match snapshot');
    const s = raw as MatchSnapshot;
    if (s.format !== 'nebulous-match' || s.version !== 1) throw new Error('unknown match snapshot format');
    if (s.rulesVersion !== RULES_VERSION) throw new Error(`snapshot rules ${s.rulesVersion} ≠ ${RULES_VERSION}`);
    if (!s.setup || !Array.isArray(s.setup.participants) || s.setup.participants.length > 256) throw new Error('invalid participants');
    const kinds = new Set<ControllerKind>(['random', 'greedy', 'survival', 'aggressive', 'hybrid', 'ppo', 'human', 'external']);
    for (const p of s.setup.participants) if (!p || !kinds.has(p.kind)) throw new Error('invalid participant kind');
    if (!Array.isArray(s.rngStates) || s.rngStates.length !== s.setup.participants.length) throw new Error('rng states mismatch');
    const m = new Match({ ...s.setup, reward: s.reward }, models);
    const world = World.fromJSON(s.world);
    if (world.agents.length !== s.setup.participants.length) throw new Error('agent count mismatch');
    (m as { world: World }).world = world;
    s.rngStates.forEach((st, i) => m.rngs[i].setState(Number(st)));
    if (Array.isArray(s.decided)) s.decided.forEach((a, i) => { if (a && i < m.decided.length) m.decided[i] = { dx: Number(a.dx) || 0, dy: Number(a.dy) || 0, split: !!a.split, eject: !!a.eject }; });
    if (Array.isArray(s.episodeReturn)) s.episodeReturn.forEach((v, i) => { if (Number.isFinite(v)) m.episodeReturn[i] = v; });
    m.history.length = 0;
    m.recordHistory();
    return m;
  }
}

export interface MatchSnapshot {
  format: 'nebulous-match';
  version: 1;
  rulesVersion: string;
  setup: MatchSetup;
  reward: RewardWeights;
  world: WorldSnapshot;
  rngStates: number[];
  decided: AgentAction[];
  episodeReturn: number[];
}

function defaultName(p: ParticipantSpec, i: number): string {
  if (p.kind === 'human') return 'You';
  if (p.kind === 'external') return `Learner ${i}`;
  return `${POLICY_LABELS[p.kind].split(' ')[0]} ${i}`;
}

const now: () => number = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
