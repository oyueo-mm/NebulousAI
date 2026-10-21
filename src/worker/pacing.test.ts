import { describe, expect, it } from 'vitest';
import { Rng } from '../engine/rng';
import { Match, type ParticipantSpec } from '../sim/match';
import { SPEED_MAX, SPEED_MAX_MODE, SPEED_MIN, normalizeSpeed, sliderToSpeed, speedToSlider } from '../ui/settings';
import { MAX_MODE_SPEED, ticksDone, ticksWanted, type PaceState } from './pacing';

const TICK = 1 / 30;
const lineup: ParticipantSpec[] = (['random', 'greedy', 'survival', 'aggressive', 'hybrid'] as const).flatMap((kind) => [{ kind }, { kind }]);

describe('speed slider scale', () => {
  it('is logarithmic from 0.25× to 50× and invertible', () => {
    expect(sliderToSpeed(0)).toBeCloseTo(SPEED_MIN, 12);
    expect(sliderToSpeed(1)).toBeCloseTo(SPEED_MAX, 12);
    expect(sliderToSpeed(0.5)).toBeCloseTo(Math.sqrt(SPEED_MIN * SPEED_MAX), 12); // geometric middle ≈ 3.54×
    let prev = 0;
    for (let k = 0; k <= 100; k++) {
      const s = sliderToSpeed(k / 100);
      expect(s).toBeGreaterThan(prev);
      expect(speedToSlider(s)).toBeCloseTo(k / 100, 9);
      prev = s;
    }
    // Equal slider movement multiplies speed by the same factor: fine control at low speeds.
    expect(sliderToSpeed(0.2) / sliderToSpeed(0.1)).toBeCloseTo(sliderToSpeed(0.9) / sliderToSpeed(0.8), 9);
  });

  it('keeps Max separate from fixed speeds and accepts older experiment files', () => {
    expect(SPEED_MAX_MODE).toBe(MAX_MODE_SPEED);
    expect(normalizeSpeed(1000)).toBe(SPEED_MAX_MODE);
    expect(normalizeSpeed(16)).toBe(16);
    expect(normalizeSpeed(0.05)).toBe(SPEED_MIN);
    expect(normalizeSpeed(200)).toBe(SPEED_MAX);
    expect(normalizeSpeed(Number.NaN)).toBe(1);
    expect(normalizeSpeed('fast')).toBe(1);
  });
});

describe('pacing', () => {
  /** Simulates the worker loop: frames of jittery real time, a per-frame tick budget. */
  function runPaced(speed: number, seconds: number, budget = Infinity, seed = 1) {
    const pace: PaceState = { owed: 0 };
    const rng = new Rng(seed);
    let real = 0, ticks = 0;
    while (real < seconds) {
      const dt = 0.012 + rng.next() * 0.01;
      real += dt;
      const want = ticksWanted(pace, dt, speed, TICK);
      const ran = Math.min(want, budget);
      ticksDone(pace, ran, speed, TICK);
      ticks += ran;
    }
    return { ticks, simSeconds: ticks * TICK, real };
  }

  it('runs speed × real time worth of fixed ticks at every fixed speed', () => {
    for (const s of [SPEED_MIN, 0.5, 1, 2, 5, 10, 25, SPEED_MAX]) {
      const r = runPaced(s, 20);
      expect(r.simSeconds / r.real).toBeGreaterThan(s * 0.97);
      expect(r.simSeconds / r.real).toBeLessThan(s * 1.03);
    }
  });

  it('reports a lower achieved speed instead of building an unbounded backlog when ticks are too slow', () => {
    // A budget of 10 ticks per ~17 ms frame cannot sustain 50× (≈ 25 ticks per frame).
    const r = runPaced(SPEED_MAX, 20, 10);
    const achieved = r.simSeconds / r.real;
    expect(achieved).toBeLessThan(SPEED_MAX * 0.9);
    expect(achieved).toBeGreaterThan(10);
  });

  it('max mode is not a fixed rate: it asks for as many ticks as the budget allows', () => {
    const pace: PaceState = { owed: 5 };
    expect(ticksWanted(pace, 0.016, MAX_MODE_SPEED, TICK)).toBe(Number.MAX_SAFE_INTEGER);
    expect(pace.owed).toBe(0);
  });

  it('the same seed and tick count give the same state at any speed or speed schedule', () => {
    const target = 900;
    const reference = new Match({ seed: 77, participants: lineup });
    for (let i = 0; i < target; i++) reference.step();
    const want = JSON.stringify(reference.toJSON());

    const schedules: number[][] = [[SPEED_MIN], [1], [SPEED_MAX], [MAX_MODE_SPEED], [0.5, 50, 2, MAX_MODE_SPEED, 0.25, 10]];
    for (const schedule of schedules) {
      const m = new Match({ seed: 77, participants: lineup });
      const pace: PaceState = { owed: 0 };
      let frame = 0;
      while (m.tick < target) {
        // Change speed every 37 frames without touching the match (as the UI slider does).
        const speed = schedule[Math.floor(frame / 37) % schedule.length];
        if (frame % 37 === 0) pace.owed = 0;
        const want = Math.min(ticksWanted(pace, 0.016, speed, TICK), speed >= MAX_MODE_SPEED ? 40 : Infinity, target - m.tick);
        for (let i = 0; i < want; i++) m.step();
        ticksDone(pace, want, speed, TICK);
        frame++;
      }
      expect(m.tick).toBe(target);
      expect(JSON.stringify(m.toJSON())).toBe(want);
    }
  });
});
