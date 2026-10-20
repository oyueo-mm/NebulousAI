/// <reference lib="webworker" />
import { MlpPolicyModel, type MlpModelFile } from '../ai/rl';
import type { MatchResult } from '../sim/match';
import { buildReport, runMatch, tournamentSchedule, type TournamentReport, type TournamentSpec } from '../sim/tournament';

declare const self: DedicatedWorkerGlobalScope;

export type TournamentIn = { type: 'run'; spec: TournamentSpec; models: MlpModelFile[] };
export type TournamentOut =
  | { type: 'progress'; done: number; total: number; partial: TournamentReport }
  | { type: 'done'; report: TournamentReport }
  | { type: 'error'; message: string };

/** Headless batch evaluation: no rendering, one match after another, progress after each. */
self.onmessage = (ev: MessageEvent<TournamentIn>) => {
  try {
    const { spec } = ev.data;
    const models = new Map(ev.data.models.map((f) => [f.id, new MlpPolicyModel(f)]));
    const schedule = [...tournamentSchedule(spec)];
    const results: MatchResult[] = [];
    const t0 = performance.now();
    for (const { seed, rotation } of schedule) {
      results.push(runMatch(spec, seed, rotation, models));
      const partial = buildReport(spec, results, (performance.now() - t0) / 1000);
      self.postMessage({ type: 'progress', done: results.length, total: schedule.length, partial } satisfies TournamentOut);
    }
    self.postMessage({ type: 'done', report: buildReport(spec, results, (performance.now() - t0) / 1000) } satisfies TournamentOut);
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies TournamentOut);
  }
};
