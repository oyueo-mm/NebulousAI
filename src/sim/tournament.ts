import type { GameConfig } from '../engine/config';
import { RULES_VERSION } from '../engine/config';
import type { MlpPolicyModel } from '../ai/rl';
import { OBS_VERSION, ACTION_VERSION, REWARD_VERSION } from '../ai/rl';
import { Match, type MatchResult, type ParticipantSpec, type Standing } from './match';

export interface TournamentSpec {
  name: string;
  lineup: ParticipantSpec[];
  /** Evaluation seeds; each runs once per spawn rotation. */
  seeds: number[];
  /** How many spawn rotations per seed (1 … lineup size). Rotation k shifts every agent k slots. */
  rotations: number;
  maxSeconds: number;
  config?: Partial<GameConfig>;
  decisionInterval?: number;
  endWhenOneLeft?: boolean;
}

/** Aggregated statistics for one entry (participants sharing a label). */
export interface EntryStats {
  label: string;
  kind: string;
  modelId: string | null;
  /** Agent-matches played (one agent in one match). */
  samples: number;
  wins: number;
  winRate: number;
  winRateCI: [number, number];
  avgRank: number;
  avgSurvival: number;
  survivalCI: number;
  avgFinalMass: number;
  finalMassCI: number;
  avgMaxMass: number;
  bestMass: number;
  avgKills: number;
  avgCellsEaten: number;
  avgSplits: number;
  /** Split attacks that ate an enemy cell within 3 s ÷ splits. */
  splitSuccessRate: number;
  /** Enemy cells eaten ÷ (enemy cells eaten + own cells lost). */
  exchangeRatio: number;
  survivedToEnd: number;
}

export interface TournamentReport {
  name: string;
  createdAt: string;
  versions: { rules: string; obs: string; action: string; reward: string };
  spec: TournamentSpec;
  matches: number;
  entries: EntryStats[];
  results: MatchResult[];
  wallSeconds: number;
  simSecondsPerWallSecond: number;
}

export function entryLabel(p: ParticipantSpec): string {
  return p.kind === 'ppo' ? `ppo:${p.modelId ?? '?'}` : p.kind;
}

export function runMatch(spec: TournamentSpec, seed: number, rotation: number, models: ReadonlyMap<string, MlpPolicyModel>): MatchResult {
  const match = new Match({
    seed, participants: spec.lineup, config: spec.config, decisionInterval: spec.decisionInterval,
    spawnRotation: rotation, maxSeconds: spec.maxSeconds, endWhenOneLeft: spec.endWhenOneLeft ?? true,
  }, models);
  while (!match.isOver()) match.step();
  return match.result();
}

export function* tournamentSchedule(spec: TournamentSpec): Generator<{ seed: number; rotation: number }> {
  const rotations = Math.max(1, Math.min(spec.rotations, spec.lineup.length));
  const stride = Math.max(1, Math.floor(spec.lineup.length / rotations));
  for (const seed of spec.seeds) for (let k = 0; k < rotations; k++) yield { seed, rotation: k * stride };
}

export function runTournament(
  spec: TournamentSpec,
  models: ReadonlyMap<string, MlpPolicyModel> = new Map(),
  onProgress?: (done: number, total: number, last: MatchResult) => void,
): TournamentReport {
  const t0 = Date.now();
  const schedule = [...tournamentSchedule(spec)];
  const results: MatchResult[] = [];
  for (const { seed, rotation } of schedule) {
    const r = runMatch(spec, seed, rotation, models);
    results.push(r);
    onProgress?.(results.length, schedule.length, r);
  }
  return buildReport(spec, results, (Date.now() - t0) / 1000);
}

export function buildReport(spec: TournamentSpec, results: MatchResult[], wallSeconds: number): TournamentReport {
  const labels = spec.lineup.map(entryLabel);
  const groups = new Map<string, Standing[]>();
  for (const r of results) for (const s of r.standings) {
    const label = labels[s.agentId];
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(s);
  }
  const entries: EntryStats[] = [];
  for (const [label, rows] of groups) {
    const first = spec.lineup[labels.indexOf(label)];
    const n = rows.length;
    const wins = rows.filter((s) => s.rank === 1).length;
    const surv = rows.map((s) => s.survivalSeconds);
    const mass = rows.map((s) => s.mass);
    const eaten = sum(rows.map((s) => s.cellsEaten));
    const lost = sum(rows.map((s) => s.cellsLost));
    const splits = sum(rows.map((s) => s.splits));
    entries.push({
      label, kind: first.kind, modelId: first.modelId ?? null, samples: n, wins, winRate: wins / n, winRateCI: wilson(wins, n),
      avgRank: mean(rows.map((s) => s.rank)), avgSurvival: mean(surv), survivalCI: ci95(surv), avgFinalMass: mean(mass), finalMassCI: ci95(mass),
      avgMaxMass: mean(rows.map((s) => s.maxMass)), bestMass: Math.max(...rows.map((s) => s.maxMass)),
      avgKills: mean(rows.map((s) => s.kills)), avgCellsEaten: eaten / n, avgSplits: splits / n,
      splitSuccessRate: splits > 0 ? sum(rows.map((s) => s.splitHits)) / splits : 0,
      exchangeRatio: eaten + lost > 0 ? eaten / (eaten + lost) : 0,
      survivedToEnd: rows.filter((s) => s.alive).length / n,
    });
  }
  entries.sort((a, b) => b.winRate - a.winRate || a.avgRank - b.avgRank);
  const simSeconds = sum(results.map((r) => r.seconds));
  return {
    name: spec.name, createdAt: new Date().toISOString(),
    versions: { rules: RULES_VERSION, obs: OBS_VERSION, action: ACTION_VERSION, reward: REWARD_VERSION },
    spec, matches: results.length, entries, results, wallSeconds,
    simSecondsPerWallSecond: wallSeconds > 0 ? simSeconds / wallSeconds : 0,
  };
}

export function reportToCsv(report: TournamentReport): string {
  const head = ['seed', 'rotation', 'agent', 'entry', 'rank', 'alive', 'final_mass', 'max_mass', 'survival_s', 'kills', 'cells_eaten', 'cells_lost', 'splits', 'split_hits', 'food', 'return'];
  const labels = report.spec.lineup.map(entryLabel);
  const lines = [head.join(',')];
  for (const r of report.results) for (const s of r.standings) {
    lines.push([r.seed, r.spawnRotation, s.agentId, labels[s.agentId], s.rank, s.alive ? 1 : 0, s.mass.toFixed(2), s.maxMass.toFixed(2),
      s.survivalSeconds.toFixed(2), s.kills, s.cellsEaten, s.cellsLost, s.splits, s.splitHits, s.foodEaten, s.episodeReturn.toFixed(3)].join(','));
  }
  return lines.join('\n') + '\n';
}

function sum(v: number[]): number {
  return v.reduce((a, b) => a + b, 0);
}

function mean(v: number[]): number {
  return v.length ? sum(v) / v.length : 0;
}

/** Half-width of a normal-approximation 95% confidence interval for the mean. */
function ci95(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
  return (1.96 * sd) / Math.sqrt(v.length);
}

/** Wilson score interval (95%) for a binomial proportion. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
