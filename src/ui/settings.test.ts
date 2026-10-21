import { describe, expect, it } from 'vitest';
import { Match } from '../sim/match';
import { t } from '../i18n';
import { DEFAULT_UI, defaultArena, parseExperiment, toSetup, type ExperimentFile } from './settings';

function file(overrides: Partial<ExperimentFile> = {}): ExperimentFile {
  const arena = defaultArena('watch', false);
  const match = new Match(toSetup('watch', arena));
  return { format: 'nebulous-experiment', version: 1, rulesVersion: 'rules-v1', savedAt: '', mode: 'watch', arena, ui: DEFAULT_UI, snapshot: match.toJSON(), ...overrides };
}

describe('experiment files', () => {
  it('round-trips a saved experiment and the snapshot restores', () => {
    const exp = parseExperiment(JSON.stringify(file()));
    expect(exp.arena.seed).toBe(2026);
    expect(() => Match.fromJSON(exp.snapshot)).not.toThrow();
  });

  it('rejects malformed, hostile or oversized input with a readable error', () => {
    const e = t.errors;
    const bad: [string, string][] = [
      ['not json {', e.notJson],
      ['null', e.notExperiment],
      [JSON.stringify({ ...file(), format: 'other' }), e.unknownFormat],
      [JSON.stringify({ ...file(), mode: 'hack' }), e.invalidMode],
      [JSON.stringify({ ...file(), arena: { ...file().arena, seed: -1 } }), 'seed'],
      [JSON.stringify({ ...file(), arena: { ...file().arena, worldSize: 1e9 } }), 'worldSize'],
      [JSON.stringify({ ...file(), arena: { ...file().arena, bots: { ...file().arena.bots, greedy: 1e6 } } }), 'bots.greedy'],
      [JSON.stringify({ ...file(), arena: { ...file().arena, bots: { random: 60, greedy: 60, survival: 0, aggressive: 0, hybrid: 0, ppo: 0 } } }), e.tooManyBots(64)],
      [JSON.stringify({ ...file(), snapshot: { format: 'evil' } }), e.invalidSnapshot],
      ['x'.repeat(26 * 1024 * 1024), e.tooLarge],
    ];
    for (const [text, msg] of bad) expect(() => parseExperiment(text), msg).toThrow(msg);
  });

  it('clamps UI values instead of trusting them', () => {
    const exp = parseExperiment(JSON.stringify({ ...file(), ui: { ...DEFAULT_UI, speed: 1e9 } }));
    expect(exp.ui.speed).toBe(1000);
    expect(parseExperiment(JSON.stringify({ ...file(), ui: { ...DEFAULT_UI, speed: 16 } })).ui.speed).toBe(16); // older step value kept
    expect(parseExperiment(JSON.stringify({ ...file(), ui: { ...DEFAULT_UI, speed: 0.05 } })).ui.speed).toBe(0.25);
  });

  it('names agents in Korean without changing anything the engine stores', () => {
    const setup = toSetup('play', defaultArena('play', false));
    expect(setup.participants[0].name).toBe('나');
    expect(setup.participants.slice(1).every((p) => p.name && /[가-힣]/.test(p.name))).toBe(true);
    // Saved experiments keep their technical keys untouched.
    const saved = JSON.parse(JSON.stringify(file()));
    expect(Object.keys(saved)).toEqual(['format', 'version', 'rulesVersion', 'savedAt', 'mode', 'arena', 'ui', 'snapshot']);
  });

  it('a snapshot with corrupted world data is rejected when loaded', () => {
    const f = file();
    const world = { ...f.snapshot!.world, cells: [{ ...f.snapshot!.world.cells[0], mass: Number.NaN }] };
    const exp = parseExperiment(JSON.stringify({ ...f, snapshot: { ...f.snapshot, world } }));
    expect(() => Match.fromJSON(exp.snapshot)).toThrow();
  });
});
