import { t } from '../i18n';
import { DEFAULT_CONFIG, RULES_VERSION, type GameConfig } from '../engine/config';
import type { PolicyKind } from '../ai/types';
import { DEFAULT_DECISION_INTERVAL, type MatchSetup, type MatchSnapshot, type ParticipantSpec } from '../sim/match';

export type Mode = 'play' | 'watch' | 'tournament' | 'lab';

export const BOT_KINDS: PolicyKind[] = ['random', 'greedy', 'survival', 'aggressive', 'hybrid', 'ppo'];

export interface ArenaSettings {
  seed: number;
  bots: Record<PolicyKind, number>;
  ppoModel: string;
  ppoDeterministic: boolean;
  worldSize: number;
  foodMax: number;
  thornCount: number;
  respawn: boolean;
  maxSeconds: number;
  decisionInterval: number;
  physics: Pick<GameConfig, 'speedBase' | 'eatRatio' | 'splitSpeed' | 'decayRate' | 'ejectEfficiency' | 'mergeBase' | 'startMass'>;
}

export interface UiSettings {
  overlays: { targets: boolean; vision: boolean; heatmap: boolean; names: boolean };
  speed: number;
  rightOpen: boolean;
  bottomOpen: boolean;
}

export const DEFAULT_PHYSICS: ArenaSettings['physics'] = {
  speedBase: DEFAULT_CONFIG.speedBase, eatRatio: DEFAULT_CONFIG.eatRatio, splitSpeed: DEFAULT_CONFIG.splitSpeed,
  decayRate: DEFAULT_CONFIG.decayRate, ejectEfficiency: DEFAULT_CONFIG.ejectEfficiency, mergeBase: DEFAULT_CONFIG.mergeBase,
  startMass: DEFAULT_CONFIG.startMass,
};

export function defaultArena(mode: 'play' | 'watch', hasPpo: boolean): ArenaSettings {
  return {
    seed: 2026,
    bots: mode === 'play'
      ? { random: 2, greedy: 3, survival: 2, aggressive: 3, hybrid: 3, ppo: hasPpo ? 2 : 0 }
      : { random: 2, greedy: 2, survival: 2, aggressive: 2, hybrid: 2, ppo: hasPpo ? 2 : 0 },
    ppoModel: 'ppo-v1', ppoDeterministic: false,
    worldSize: DEFAULT_CONFIG.worldWidth, foodMax: DEFAULT_CONFIG.foodMax, thornCount: DEFAULT_CONFIG.thornCount,
    respawn: true, maxSeconds: 0, decisionInterval: DEFAULT_DECISION_INTERVAL, physics: { ...DEFAULT_PHYSICS },
  };
}

export const DEFAULT_UI: UiSettings = {
  overlays: { targets: true, vision: false, heatmap: false, names: true },
  speed: 1, rightOpen: true, bottomOpen: false,
};

export function toSetup(mode: 'play' | 'watch', s: ArenaSettings): MatchSetup {
  const participants: ParticipantSpec[] = [];
  if (mode === 'play') participants.push({ kind: 'human', name: t.policy.agentName('human', 0), noRespawn: true });
  for (const kind of BOT_KINDS) {
    for (let i = 0; i < s.bots[kind]; i++) {
      const name = t.policy.agentName(kind, participants.length);
      participants.push(kind === 'ppo' ? { kind, name, modelId: s.ppoModel, deterministic: s.ppoDeterministic } : { kind, name });
    }
  }
  return {
    seed: s.seed, participants, decisionInterval: s.decisionInterval, maxSeconds: s.maxSeconds,
    config: {
      worldWidth: s.worldSize, worldHeight: s.worldSize, foodMax: s.foodMax, thornCount: s.thornCount, respawn: s.respawn,
      ...s.physics,
    },
  };
}

export const MAX_BOTS = 64;

// ------------------------------------------------------------------- speed

/** Slowest and fastest *fixed* simulation speeds the slider offers (simulated seconds per real second). */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 50;
/** `speed` value meaning "as fast as this device can" (the worker's Max mode), not a fixed rate. */
export const SPEED_MAX_MODE = 1000;

/** Log-scale slider mapping: speed(t) = min · (max/min)^t for t ∈ [0, 1]. */
export function sliderToSpeed(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, c);
}

export function speedToSlider(speed: number): number {
  const s = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  return Math.log(s / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN);
}

/** Accepts any stored value (including older files' 0.05 … 16 steps) and maps it onto what the UI supports. */
export function normalizeSpeed(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  if (v >= SPEED_MAX_MODE) return SPEED_MAX_MODE;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
}

export function totalBots(s: ArenaSettings): number {
  return BOT_KINDS.reduce((n, k) => n + s.bots[k], 0);
}

// ------------------------------------------------------------ experiment files

export interface ExperimentFile {
  format: 'nebulous-experiment';
  version: 1;
  rulesVersion: string;
  savedAt: string;
  mode: 'play' | 'watch';
  arena: ArenaSettings;
  ui: UiSettings;
  snapshot: MatchSnapshot | null;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Validates an imported experiment without trusting any field. Throws with a readable message. */
export function parseExperiment(text: string): ExperimentFile {
  const err = t.errors;
  if (text.length > MAX_FILE_BYTES) throw new Error(err.tooLarge);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error(err.notJson); }
  if (!raw || typeof raw !== 'object') throw new Error(err.notExperiment);
  const e = raw as Partial<ExperimentFile>;
  if (e.format !== 'nebulous-experiment' || e.version !== 1) throw new Error(err.unknownFormat);
  if (e.mode !== 'play' && e.mode !== 'watch') throw new Error(err.invalidMode);
  const a = e.arena as ArenaSettings | undefined;
  if (!a || typeof a !== 'object') throw new Error(err.missingArena);
  const num = (v: unknown, lo: number, hi: number, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(err.range(name, lo, hi));
    return v;
  };
  num(a.seed, 0, 2 ** 32 - 1, 'seed');
  num(a.worldSize, 500, 20000, 'worldSize');
  num(a.foodMax, 0, 20000, 'foodMax');
  num(a.thornCount, 0, 500, 'thornCount');
  num(a.maxSeconds, 0, 1e6, 'maxSeconds');
  num(a.decisionInterval, 1, 30, 'decisionInterval');
  if (!a.bots || typeof a.bots !== 'object') throw new Error(err.missingBots);
  for (const k of BOT_KINDS) num(a.bots[k], 0, MAX_BOTS, `bots.${k}`);
  if (totalBots(a) > MAX_BOTS) throw new Error(err.tooManyBots(MAX_BOTS));
  if (typeof a.ppoModel !== 'string' || a.ppoModel.length > 64) throw new Error(err.invalidModel);
  if (!a.physics || typeof a.physics !== 'object') throw new Error(err.missingPhysics);
  for (const [k, v] of Object.entries(DEFAULT_PHYSICS)) num((a.physics as Record<string, unknown>)[k] ?? v, 0, 1e5, `physics.${k}`);
  const ui = { ...DEFAULT_UI, ...(e.ui && typeof e.ui === 'object' ? e.ui : {}) };
  ui.overlays = { ...DEFAULT_UI.overlays, ...(ui.overlays ?? {}) };
  ui.speed = normalizeSpeed(ui.speed);
  const snapshot = e.snapshot ?? null;
  if (snapshot !== null && (typeof snapshot !== 'object' || (snapshot as MatchSnapshot).format !== 'nebulous-match')) throw new Error(err.invalidSnapshot);
  return {
    format: 'nebulous-experiment', version: 1, rulesVersion: String(e.rulesVersion ?? RULES_VERSION), savedAt: String(e.savedAt ?? ''),
    mode: e.mode, arena: { ...a, physics: { ...DEFAULT_PHYSICS, ...a.physics }, ppoDeterministic: !!a.ppoDeterministic, respawn: !!a.respawn },
    ui, snapshot,
  };
}
