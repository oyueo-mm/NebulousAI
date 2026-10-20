import { describe, expect, it } from 'vitest';
import { Match, type ParticipantSpec } from './match';
import { buildReport, runTournament, tournamentSchedule, wilson } from './tournament';

const lineup: ParticipantSpec[] = (['random', 'greedy', 'survival', 'aggressive', 'hybrid'] as const).flatMap((kind) => [{ kind }, { kind }]);

describe('Match', () => {
  it('is fully reproducible for a seed, including AI decisions', () => {
    const run = () => {
      const m = new Match({ seed: 5, participants: lineup, maxSeconds: 30 });
      while (!m.isOver()) m.step();
      return JSON.stringify(m.toJSON());
    };
    expect(run()).toBe(run());
  });

  it('decides only on decision ticks and holds direction between them', () => {
    const m = new Match({ seed: 3, participants: [{ kind: 'greedy' }], decisionInterval: 3 });
    let decisions = 0;
    for (let i = 0; i < 30; i++) { const before = m.timing.decisions; m.step(); decisions += m.timing.decisions - before; }
    expect(decisions).toBe(10);
  });

  it('save → load → continue reproduces an uninterrupted match', () => {
    const a = new Match({ seed: 12, participants: lineup });
    for (let i = 0; i < 600; i++) a.step();
    const b0 = new Match({ seed: 12, participants: lineup });
    for (let i = 0; i < 300; i++) b0.step();
    const b = Match.fromJSON(JSON.parse(JSON.stringify(b0.toJSON())));
    for (let i = 0; i < 300; i++) b.step();
    expect(JSON.stringify(b.world.toJSON())).toBe(JSON.stringify(a.world.toJSON()));
  });

  it('external controllers fire split once per request', () => {
    const m = new Match({ seed: 1, participants: [{ kind: 'human', startMass: 400 }] });
    m.setExternalAction(0, { dx: 1, dy: 0, split: true, eject: false });
    m.step();
    m.step();
    expect(m.world.agents[0].stats.splits).toBe(1);
    expect(m.world.agents[0].stats.invalidSplits).toBe(0);
  });

  it('accumulates reward-v1 per decision window', () => {
    const m = new Match({ seed: 4, participants: [{ kind: 'external' }, { kind: 'greedy' }], config: { foodMax: 0, foodInitialFraction: 0, thornCount: 0 } });
    m.world.placeFood(m.world.cellsOf(0)[0].x, m.world.cellsOf(0)[0].y);
    m.setExternalAction(0, { dx: 0, dy: 0, split: false, eject: false });
    m.advanceDecision();
    expect(m.lastReward[0]!.growth).toBeCloseTo(10 * Math.log(21 / 20), 9);
    expect(m.episodeReturn[0]).toBeCloseTo(m.lastReward[0]!.total, 12);
  });

  it('ranks alive agents above dead ones and reports a winner', () => {
    const m = new Match({ seed: 2, participants: lineup, maxSeconds: 60, endWhenOneLeft: true });
    while (!m.isOver()) m.step();
    const r = m.result();
    const ranks = r.standings.map((s) => s.rank).sort((a, b) => a - b);
    expect(ranks).toEqual(lineup.map((_, i) => i + 1));
    const winner = r.standings.find((s) => s.agentId === r.winner)!;
    expect(winner.rank).toBe(1);
    for (const s of r.standings) if (!s.alive) expect(r.standings.some((o) => o.alive && o.rank > s.rank)).toBe(false);
  });
});

describe('tournament', () => {
  it('rotates spawn slots and aggregates per entry', () => {
    const spec = { name: 't', lineup: [{ kind: 'greedy' as const }, { kind: 'random' as const }], seeds: [1, 2], rotations: 2, maxSeconds: 20 };
    expect([...tournamentSchedule(spec)]).toEqual([{ seed: 1, rotation: 0 }, { seed: 1, rotation: 1 }, { seed: 2, rotation: 0 }, { seed: 2, rotation: 1 }]);
    const report = runTournament(spec);
    expect(report.matches).toBe(4);
    expect(report.entries.map((e) => e.label).sort()).toEqual(['greedy', 'random']);
    expect(report.entries.reduce((s, e) => s + e.wins, 0)).toBe(4);
    const again = buildReport(spec, report.results, 1);
    expect(again.entries).toEqual(report.entries);
  });

  it('Wilson interval brackets the estimate', () => {
    const [lo, hi] = wilson(7, 20);
    expect(lo).toBeLessThan(0.35);
    expect(hi).toBeGreaterThan(0.35);
    expect(wilson(0, 10)[0]).toBe(0);
  });
});
