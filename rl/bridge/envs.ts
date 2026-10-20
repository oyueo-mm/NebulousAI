import type { GameConfig } from '../../src/engine/config';
import { RULES_VERSION } from '../../src/engine/config';
import { Rng, deriveSeed } from '../../src/engine/rng';
import { perceive } from '../../src/ai/perception';
import { createPolicy } from '../../src/ai/registry';
import {
  ACTION_VERSION, NUM_ACTIONS, OBS_SIZE, OBS_VERSION, REWARD_VERSION, decodeAction, encodeObservation, type MlpPolicyModel, type RewardWeights,
} from '../../src/ai/rl';
import type { Policy, PolicyKind } from '../../src/ai/types';
import { Match, type ParticipantSpec } from '../../src/sim/match';

/** One opponent group in a training scenario. */
export interface OpponentGroup {
  kind: PolicyKind;
  count: number;
  /** Uniform start-mass range [lo, hi]; defaults to config.startMass. */
  startMass?: [number, number];
  modelId?: string;
}

export interface Scenario {
  name: string;
  weight?: number;
  opponents: OpponentGroup[];
  learnerStartMass?: [number, number];
  config?: Partial<GameConfig>;
  maxSeconds: number;
}

export interface EnvConfig {
  scenarios: Scenario[];
  decisionInterval?: number;
  reward?: Partial<RewardWeights>;
  /**
   * Built-in controller for the learner slot instead of Python actions — evaluates
   * heuristics in exactly the same scenarios and seeds as the network.
   */
  learnerPolicy?: PolicyKind;
  learnerModelId?: string;
  learnerDeterministic?: boolean;
}

export const VERSIONS = { rules: RULES_VERSION, obs: OBS_VERSION, action: ACTION_VERSION, reward: REWARD_VERSION, obsSize: OBS_SIZE, numActions: NUM_ACTIONS };

export interface EpisodeInfo {
  scenario: string;
  seed: number;
  r: number;
  l: number;
  final_mass: number;
  max_mass: number;
  survival: number;
  kills: number;
  cells_eaten: number;
  food_eaten: number;
  splits: number;
  ejects: number;
  invalid: number;
  rank: number;
  agents: number;
  won: boolean;
  died: boolean;
}

/** Single-learner environment: agent 0 is the learner, the rest are scripted opponents. */
export class LearnerEnv {
  match!: Match;
  scenario!: Scenario;
  seed = 0;
  steps = 0;
  private learnerPolicy: Policy | null = null;
  private readonly policyRng = new Rng(1);
  private readonly obs = new Float32Array(OBS_SIZE);

  constructor(private cfg: EnvConfig, private readonly models: Map<string, MlpPolicyModel>) {}

  setConfig(cfg: EnvConfig): void {
    this.cfg = cfg;
  }

  reset(seed: number): Float32Array {
    this.seed = seed >>> 0;
    const rng = new Rng(deriveSeed(this.seed, 77));
    const scenarios = this.cfg.scenarios;
    const total = scenarios.reduce((s, sc) => s + (sc.weight ?? 1), 0);
    let pick = rng.next() * total;
    this.scenario = scenarios[scenarios.length - 1];
    for (const sc of scenarios) { pick -= sc.weight ?? 1; if (pick < 0) { this.scenario = sc; break; } }
    const sc = this.scenario;
    const range = (r: [number, number] | undefined) => (r ? rng.range(r[0], r[1]) : undefined);
    const participants: ParticipantSpec[] = [{ kind: 'external', name: 'learner', startMass: range(sc.learnerStartMass), noRespawn: true }];
    for (const g of sc.opponents) {
      for (let i = 0; i < g.count; i++) participants.push({ kind: g.kind, modelId: g.modelId, startMass: range(g.startMass) });
    }
    this.match = new Match({
      seed: this.seed, participants, config: sc.config, decisionInterval: this.cfg.decisionInterval, maxSeconds: sc.maxSeconds,
      spawnRotation: rng.int(participants.length), reward: this.cfg.reward,
    }, this.models);
    this.learnerPolicy = this.cfg.learnerPolicy
      ? createPolicy({ kind: this.cfg.learnerPolicy, modelId: this.cfg.learnerModelId, deterministic: this.cfg.learnerDeterministic }, this.models)
      : null;
    this.policyRng.setState(deriveSeed(this.seed, 4242));
    this.steps = 0;
    return this.observe();
  }

  observe(): Float32Array {
    const p = perceive(this.match.world, 0);
    if (!p) { this.obs.fill(0); return this.obs; }
    return encodeObservation(p, this.obs);
  }

  /** One decision step (decisionInterval ticks). */
  step(action: number): { obs: Float32Array; reward: number; terminated: boolean; truncated: boolean; info: EpisodeInfo | null } {
    const m = this.match;
    let a = decodeAction(action);
    if (this.learnerPolicy) {
      const p = perceive(m.world, 0);
      if (p) a = this.learnerPolicy.decide(p, this.policyRng).action;
    }
    m.setExternalAction(0, a);
    m.advanceDecision();
    this.steps++;
    const reward = m.lastReward[0]?.total ?? 0;
    const learner = m.world.agents[0];
    const terminated = !learner.alive;
    const truncated = !terminated && m.isOver();
    const obs = this.observe();
    return { obs, reward, terminated, truncated, info: terminated || truncated ? this.episodeInfo() : null };
  }

  episodeInfo(): EpisodeInfo {
    const m = this.match;
    const a = m.world.agents[0];
    const s = m.standings()[0];
    return {
      scenario: this.scenario.name, seed: this.seed, r: m.episodeReturn[0], l: this.steps,
      final_mass: a.alive ? a.totalMass : 0, max_mass: a.stats.maxMass, survival: a.aliveSeconds, kills: a.stats.kills,
      cells_eaten: a.stats.cellsEaten, food_eaten: a.stats.foodEaten, splits: a.stats.splits, ejects: a.stats.ejects,
      invalid: a.stats.invalidSplits + a.stats.invalidEjects, rank: s.rank, agents: m.world.agents.length, won: s.rank === 1, died: !a.alive,
    };
  }
}

/**
 * Multi-learner world for the PettingZoo Parallel API: the first `learners` agents are
 * driven from Python, the rest are scripted opponents.
 */
export class MultiEnv {
  match!: Match;
  learners = 0;
  private readonly obs: Float32Array[] = [];

  constructor(private readonly models: Map<string, MlpPolicyModel>) {}

  reset(seed: number, learners: number, scenario: Scenario, cfg: Pick<EnvConfig, 'decisionInterval' | 'reward'>): Float32Array[] {
    this.learners = learners;
    const participants: ParticipantSpec[] = Array.from({ length: learners }, (_, i) => ({ kind: 'external' as const, name: `learner_${i}`, noRespawn: true }));
    for (const g of scenario.opponents) for (let i = 0; i < g.count; i++) participants.push({ kind: g.kind, modelId: g.modelId, startMass: g.startMass?.[0] });
    this.match = new Match({ seed, participants, config: scenario.config, decisionInterval: cfg.decisionInterval, maxSeconds: scenario.maxSeconds, reward: cfg.reward }, this.models);
    this.obs.length = 0;
    for (let i = 0; i < learners; i++) this.obs.push(new Float32Array(OBS_SIZE));
    return this.observeAll();
  }

  observeAll(): Float32Array[] {
    for (let i = 0; i < this.learners; i++) {
      const p = perceive(this.match.world, i);
      if (p) encodeObservation(p, this.obs[i]); else this.obs[i].fill(0);
    }
    return this.obs;
  }

  /** actions[i] < 0 means "agent i is not acting" (already terminated). */
  step(actions: number[]) {
    const m = this.match;
    const aliveBefore = m.world.agents.slice(0, this.learners).map((a) => a.alive);
    for (let i = 0; i < this.learners; i++) {
      if (aliveBefore[i] && actions[i] >= 0) m.setExternalAction(i, decodeAction(actions[i]));
    }
    m.advanceDecision();
    const over = m.isOver();
    const rewards: number[] = [], terminated: boolean[] = [], truncated: boolean[] = [];
    for (let i = 0; i < this.learners; i++) {
      rewards.push(aliveBefore[i] ? m.lastReward[i]?.total ?? 0 : 0);
      terminated.push(!m.world.agents[i].alive);
      truncated.push(m.world.agents[i].alive && over);
    }
    return { obs: this.observeAll(), rewards, terminated, truncated };
  }
}
