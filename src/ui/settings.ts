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
  if (mode === 'play') participants.push({ kind: 'human', name: 'You', noRespawn: true });
  for (const kind of BOT_KINDS) {
    for (let i = 0; i < s.bots[kind]; i++) {
      participants.push(kind === 'ppo' ? { kind, modelId: s.ppoModel, deterministic: s.ppoDeterministic } : { kind });
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
  if (text.length > MAX_FILE_BYTES) throw new Error('file is larger than 25 MB');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('not valid JSON'); }
  if (!raw || typeof raw !== 'object') throw new Error('not an experiment file');
  const e = raw as Partial<ExperimentFile>;
  if (e.format !== 'nebulous-experiment' || e.version !== 1) throw new Error('unknown experiment format or version');
  if (e.mode !== 'play' && e.mode !== 'watch') throw new Error('invalid mode');
  const a = e.arena as ArenaSettings | undefined;
  if (!a || typeof a !== 'object') throw new Error('missing arena settings');
  const num = (v: unknown, lo: number, hi: number, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} must be a number in [${lo}, ${hi}]`);
    return v;
  };
  num(a.seed, 0, 2 ** 32 - 1, 'seed');
  num(a.worldSize, 500, 20000, 'worldSize');
  num(a.foodMax, 0, 20000, 'foodMax');
  num(a.thornCount, 0, 500, 'thornCount');
  num(a.maxSeconds, 0, 1e6, 'maxSeconds');
  num(a.decisionInterval, 1, 30, 'decisionInterval');
  if (!a.bots || typeof a.bots !== 'object') throw new Error('missing bot counts');
  for (const k of BOT_KINDS) num(a.bots[k], 0, MAX_BOTS, `bots.${k}`);
  if (totalBots(a) > MAX_BOTS) throw new Error(`at most ${MAX_BOTS} bots`);
  if (typeof a.ppoModel !== 'string' || a.ppoModel.length > 64) throw new Error('invalid ppoModel');
  if (!a.physics || typeof a.physics !== 'object') throw new Error('missing physics');
  for (const [k, v] of Object.entries(DEFAULT_PHYSICS)) num((a.physics as Record<string, unknown>)[k] ?? v, 0, 1e5, `physics.${k}`);
  const ui = { ...DEFAULT_UI, ...(e.ui && typeof e.ui === 'object' ? e.ui : {}) };
  ui.overlays = { ...DEFAULT_UI.overlays, ...(ui.overlays ?? {}) };
  ui.speed = typeof ui.speed === 'number' && Number.isFinite(ui.speed) ? Math.min(1000, Math.max(0.05, ui.speed)) : 1;
  const snapshot = e.snapshot ?? null;
  if (snapshot !== null && (typeof snapshot !== 'object' || (snapshot as MatchSnapshot).format !== 'nebulous-match')) throw new Error('invalid snapshot');
  return {
    format: 'nebulous-experiment', version: 1, rulesVersion: String(e.rulesVersion ?? RULES_VERSION), savedAt: String(e.savedAt ?? ''),
    mode: e.mode, arena: { ...a, physics: { ...DEFAULT_PHYSICS, ...a.physics }, ppoDeterministic: !!a.ppoDeterministic, respawn: !!a.respawn },
    ui, snapshot,
  };
}
