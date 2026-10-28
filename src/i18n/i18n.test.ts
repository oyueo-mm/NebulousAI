import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NUM_ACTIONS } from '../ai/rl';
import { POLICY_KINDS } from '../ai/types';
import { Match, type ParticipantSpec } from '../sim/match';
import { t } from './index';

const HANGUL = /[가-힣]/;
const PUBLIC = resolve(__dirname, '../../public');

describe('Korean UI dictionary covers everything the app can display', () => {
  it('every heuristic mode and decision note produced in real matches has a Korean rendering', () => {
    const lineup: ParticipantSpec[] = (['random', 'greedy', 'survival', 'aggressive', 'hybrid'] as const).flatMap((kind) => [{ kind }, { kind, startMass: 150 }]);
    const modes = new Set<string>();
    const notes = new Set<string>();
    for (const seed of [1, 2, 3]) {
      const m = new Match({ seed, participants: lineup, maxSeconds: 90, config: { respawn: true } });
      while (!m.isOver()) {
        m.step();
        for (const tr of m.traces) {
          if (tr?.kind !== 'heuristic') continue;
          modes.add(tr.mode);
          if (tr.note) { notes.add(tr.note.key); expect(HANGUL.test(t.trace.note(tr.note)), tr.note.key).toBe(true); }
          if (tr.targetKind) expect(t.trace.targetKind[tr.targetKind], tr.targetKind).toBeTruthy();
        }
      }
    }
    expect(modes.size).toBeGreaterThan(6);
    for (const mode of modes) expect(HANGUL.test(t.mode(mode)) && !/[a-z]{3,}/.test(t.mode(mode)), mode).toBe(true);
    expect(notes.size).toBeGreaterThan(3);
  }, 30000); // Three full 90-second matches also run on slower CI / shared developer machines.

  it('policies, actions and agent names are Korean (algorithm names kept)', () => {
    for (const k of POLICY_KINDS) {
      expect(HANGUL.test(t.policy.name(k))).toBe(true);
      expect(HANGUL.test(t.policy.short(k))).toBe(true);
    }
    expect(t.policy.name('ppo')).toContain('PPO');
    for (let a = 0; a < NUM_ACTIONS; a++) expect(t.action.describe(a)).toMatch(/^[가-힣]+ · [가-힣]+$/);
    expect(t.policy.agentName('human', 0)).toBe('나');
  });

  it('shipped models, training stages, evaluation tables and reference tournaments are all translated', () => {
    const index = JSON.parse(readFileSync(`${PUBLIC}/models/index.json`, 'utf8')) as { id: string; file: string }[];
    for (const entry of index) {
      expect(HANGUL.test(t.models.label(entry.id, '')), entry.id).toBe(true);
      const model = JSON.parse(readFileSync(`${PUBLIC}/models/${entry.file}`, 'utf8'));
      const training = model.training ?? {};
      for (const stage of training.stages ?? []) expect(t.lab.stageDescriptions[stage.name], stage.name).toBeTruthy();
      if (training.algorithm) expect(t.lab.algorithmNames[training.algorithm], training.algorithm).toBeTruthy();
      for (const row of training.evaluation ?? []) {
        for (const key of Object.keys(row)) expect(t.lab.evalCols[key], key).toBeTruthy();
        expect(t.lab.scenarios[row.scenario], row.scenario).toBeTruthy();
      }
      for (const d of training.imitation?.demonstrations ?? []) expect(t.lab.scenarios[d.scenario], d.scenario).toBeTruthy();
    }
    const results = `${PUBLIC}/results/index.json`;
    if (existsSync(results)) {
      for (const f of JSON.parse(readFileSync(results, 'utf8')) as string[]) {
        const report = JSON.parse(readFileSync(`${PUBLIC}/results/${f}`, 'utf8'));
        expect(t.tournament.reportNames[report.name], report.name).toBeTruthy();
        for (const e of report.entries) expect(HANGUL.test(t.policy.entry(e.label)) || e.label.startsWith('ppo:'), e.label).toBe(true);
      }
    }
  });
});
