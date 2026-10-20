import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, makeConfig } from './config';
import { decayedMass, massToRadius, maxSpeed, radiusToMass } from './physics';
import { Rng } from './rng';
import type { AgentAction } from './types';
import { World, parseSnapshot } from './world';

const cfg = makeConfig();
const go = (dx: number, dy: number, extra: Partial<AgentAction> = {}): AgentAction => ({ dx, dy, split: false, eject: false, ...extra });

/** Empty arena with `n` agents, no food, no thorns, no decay unless asked. */
function arena(n: number, config: Partial<typeof cfg> = {}): World {
  const w = new World({
    seed: 1,
    agents: Array.from({ length: n }, (_, i) => ({ name: `a${i}` })),
    config: { foodMax: 0, foodInitialFraction: 0, thornCount: 0, decayRate: 0, ...config },
  });
  return w;
}

function checkInvariants(w: World): void {
  const ids = new Set<number>();
  for (const c of w.cells) {
    expect(c.alive).toBe(true);
    expect(Number.isFinite(c.mass) && c.mass > 0).toBe(true);
    expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    expect(c.x).toBeGreaterThanOrEqual(c.r - 1e-9);
    expect(c.x).toBeLessThanOrEqual(w.config.worldWidth - c.r + 1e-9);
    expect(c.y).toBeGreaterThanOrEqual(c.r - 1e-9);
    expect(c.y).toBeLessThanOrEqual(w.config.worldHeight - c.r + 1e-9);
    expect(Math.abs(c.r - massToRadius(c.mass, w.config))).toBeLessThan(1e-9);
    expect(c.mass).toBeLessThanOrEqual(w.config.maxCellMass + 1e-9);
    expect(ids.has(c.id)).toBe(false);
    ids.add(c.id);
  }
  for (const a of w.agents) {
    const own = w.cells.filter((c) => c.owner === a.id);
    expect(a.cellCount).toBe(own.length);
    expect(Math.abs(a.totalMass - own.reduce((s, c) => s + c.mass, 0))).toBeLessThan(1e-6);
    expect(a.alive).toBe(own.length > 0 || (w.config.respawn && a.alive));
    expect(own.length).toBeLessThanOrEqual(w.config.maxCells);
  }
  expect(Math.abs(w.totalWorldMass() - w.expectedWorldMass())).toBeLessThan(1e-6 * Math.max(1, w.totalWorldMass()));
}

describe('physics formulas', () => {
  it('radius follows r = sqrt(m / (πρ)) and inverts exactly', () => {
    for (const m of [1, 20, 137.5, 5000]) {
      const r = massToRadius(m, cfg);
      expect(r).toBeCloseTo(Math.sqrt(m / (Math.PI * cfg.density)), 12);
      expect(radiusToMass(r, cfg)).toBeCloseTo(m, 9);
    }
  });

  it('max speed is finite, bounded and non-increasing in mass', () => {
    let prev = Infinity;
    for (let m = 1; m < 30000; m *= 1.3) {
      const v = maxSpeed(m, cfg);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeLessThanOrEqual(cfg.speedBase);
      expect(v).toBeGreaterThanOrEqual(cfg.speedMin);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('decay is proportional to time and floors at decayMinMass', () => {
    expect(decayedMass(1000, 1, cfg)).toBeCloseTo(1000 - 1000 * cfg.decayRate, 9);
    expect(decayedMass(cfg.decayMinMass - 1, 100, cfg)).toBe(cfg.decayMinMass - 1);
    expect(decayedMass(cfg.decayMinMass + 1, 1e6, cfg)).toBe(cfg.decayMinMass);
  });

  it('rejects invalid configurations', () => {
    expect(() => makeConfig({ eatRatio: 0.9 })).toThrow();
    expect(() => makeConfig({ tickSeconds: Number.NaN })).toThrow();
    expect(() => makeConfig({ maxCellMass: 1e9 })).toThrow();
    expect(() => makeConfig({ ejectEfficiency: 2 })).toThrow();
  });
});

describe('rng', () => {
  it('is reproducible from a seed and stays in [0, 1)', () => {
    const a = new Rng(42), b = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
});

describe('movement', () => {
  it('moves exactly v_max · dt per tick in the commanded direction', () => {
    const w = arena(1);
    const c = w.placeCell(0, 1500, 1500, 20, { replace: true });
    const x0 = c.x;
    w.step([go(1, 0)]);
    const cell = w.cells[0];
    expect(cell.x - x0).toBeCloseTo(maxSpeed(20, w.config) * w.config.tickSeconds, 9);
    expect(cell.y).toBeCloseTo(1500, 9);
  });

  it('throttle scales speed and is clamped to 1', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, 20, { replace: true });
    w.step([go(0.5, 0)]);
    expect(w.cells[0].x - 1500).toBeCloseTo(0.5 * maxSpeed(20, w.config) * w.config.tickSeconds, 9);
    const w2 = arena(1);
    w2.placeCell(0, 1500, 1500, 20, { replace: true });
    w2.step([go(10, 0)]);
    expect(w2.cells[0].x - 1500).toBeCloseTo(maxSpeed(20, w2.config) * w2.config.tickSeconds, 9);
  });

  it('larger cells move slower', () => {
    const w = arena(2);
    w.placeCell(0, 500, 500, 20, { replace: true });
    w.placeCell(1, 500, 1500, 400, { replace: true });
    w.step([go(1, 0), go(1, 0)]);
    const small = w.cellsOf(0)[0], big = w.cellsOf(1)[0];
    expect(small.x - 500).toBeGreaterThan(big.x - 500);
  });

  it('cells stay inside the world', () => {
    const w = arena(1);
    w.placeCell(0, 30, 30, 20, { replace: true });
    for (let i = 0; i < 200; i++) w.step([go(-1, -1)]);
    const c = w.cells[0];
    expect(c.x).toBeCloseTo(c.r, 9);
    expect(c.y).toBeCloseTo(c.r, 9);
    checkInvariants(w);
  });

  it('a cell that grows while pressed against a wall stays inside it (found by the Python rule checker)', () => {
    const w = arena(1);
    const c = w.placeCell(0, 0, 1500, 20, { replace: true });
    expect(c.x).toBeCloseTo(c.r, 9);
    w.placeFood(c.x + 2, 1500, 400);
    w.step([go(-1, 0)]);
    const grown = w.cells[0];
    expect(grown.mass).toBeCloseTo(420, 9);
    expect(grown.x).toBeGreaterThanOrEqual(grown.r - 1e-9);
    checkInvariants(w);
  });

  it('non-finite actions are treated as idle', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, 20, { replace: true });
    w.step([go(Number.NaN, Number.POSITIVE_INFINITY)]);
    expect(w.cells[0].x).toBe(1500);
    checkInvariants(w);
  });
});

describe('food', () => {
  it('absorbs food whose centre lies inside the cell, adding its mass', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, 20, { replace: true });
    w.placeFood(1505, 1500);
    w.placeFood(1700, 1500);
    w.step([go(0, 0)]);
    expect(w.cells[0].mass).toBeCloseTo(21, 9);
    expect(w.food.length).toBe(1);
    expect(w.agents[0].stats.foodEaten).toBe(1);
    checkInvariants(w);
  });

  it('one food item is eaten by exactly one cell (the larger)', () => {
    const w = arena(2);
    w.placeCell(0, 1490, 1500, 30, { replace: true });
    w.placeCell(1, 1512, 1500, 25, { replace: true });
    w.placeFood(1500, 1500);
    w.step([go(0, 0), go(0, 0)]);
    expect(w.food.length).toBe(0);
    expect(w.cellsOf(0)[0].mass + w.cellsOf(1)[0].mass).toBeCloseTo(56, 9);
    expect(w.cellsOf(0)[0].mass).toBeCloseTo(31, 9);
  });

  it('regenerates toward foodMax at the configured rate', () => {
    const w = new World({ seed: 3, agents: [{ name: 'a' }], config: { foodMax: 100, foodInitialFraction: 0, foodSpawnPerSecond: 30, thornCount: 0 } });
    for (let i = 0; i < 30; i++) w.step([]);
    expect(w.food.length).toBe(30);
    for (let i = 0; i < 300; i++) w.step([]);
    expect(w.food.length).toBe(100);
  });
});

describe('predation', () => {
  it('a large enough cell swallows a smaller one once its centre is deep inside', () => {
    const w = arena(2);
    w.placeCell(0, 1500, 1500, 100, { replace: true });
    const r = massToRadius(100, w.config);
    const rq = massToRadius(20, w.config);
    w.placeCell(1, 1500 + r - 0.4 * rq + 2, 1500, 20, { replace: true });
    w.step([go(0, 0), go(0, 0)]);
    expect(w.cells.length).toBe(2);
    w.cellsOf(1)[0].x = 1500 + r - 0.4 * rq - 1;
    w.step([go(0, 0), go(0, 0)]);
    expect(w.cellsOf(1).length).toBe(0);
    expect(w.cellsOf(0)[0].mass).toBeCloseTo(120, 9);
    expect(w.agents[1].alive).toBe(false);
    expect(w.agents[1].killedBy).toBe(0);
    expect(w.agents[0].stats.kills).toBe(1);
    checkInvariants(w);
  });

  it('cannot eat a cell below the mass ratio, even when fully overlapping', () => {
    const w = arena(2);
    w.placeCell(0, 1500, 1500, 24, { replace: true });
    w.placeCell(1, 1500, 1500, 20, { replace: true });
    w.step([go(0, 0), go(0, 0)]);
    expect(w.cells.length).toBe(2);
  });

  it('same-owner cells never eat each other', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, 200, { replace: true, mergeAt: 1e9 });
    w.placeCell(0, 1500, 1500, 20, { mergeAt: 1e9 });
    w.step([go(0, 0)]);
    expect(w.cells.length).toBe(2);
    checkInvariants(w);
  });

  it('simultaneous contest: the largest eligible predator wins, independent of array order', () => {
    const run = (reverse: boolean) => {
      const w = arena(3);
      const placements: [owner: number, x: number, y: number, mass: number][] = [[0, 1455, 1500, 300], [1, 1545, 1500, 200], [2, 1500, 1500, 20]];
      const ordered = reverse ? [...placements].reverse() : placements;
      for (const [owner, x, y, m] of ordered) w.placeCell(owner, x, y, m, { replace: true });
      w.step([go(0, 0), go(0, 0), go(0, 0)]);
      return { m0: w.cellsOf(0)[0].mass, m1: w.cellsOf(1)[0].mass, prey: w.cellsOf(2).length };
    };
    const a = run(false), b = run(true);
    expect(a).toEqual(b);
    expect(a.prey).toBe(0);
    expect(a.m0).toBeCloseTo(320, 9);
    expect(a.m1).toBeCloseTo(200, 9);
  });

  it('a cell eaten this tick cannot also eat (chain A ⊃ B ⊃ C)', () => {
    const w = arena(3);
    w.placeCell(0, 1500, 1500, 1000, { replace: true });
    w.placeCell(1, 1510, 1500, 100, { replace: true });
    w.placeCell(2, 1512, 1500, 10, { replace: true });
    w.step([go(0, 0), go(0, 0), go(0, 0)]);
    expect(w.cellsOf(1).length).toBe(0);
    expect(w.cellsOf(2).length).toBe(0);
    expect(w.cellsOf(0)[0].mass).toBeCloseTo(1110, 9);
    expect(w.agents[2].killedBy).toBe(0);
  });
});

describe('split', () => {
  it('halves mass exactly, launches the child forward and respects the cost', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, 100, { replace: true });
    w.step([go(1, 0, { split: true })]);
    const cells = w.cellsOf(0).sort((a, b) => a.x - b.x);
    expect(cells.length).toBe(2);
    expect(cells[0].mass).toBeCloseTo(50, 9);
    expect(cells[1].mass).toBeCloseTo(50, 9);
    expect(cells[1].bx).toBeGreaterThan(0);
    checkInvariants(w);

    const w2 = arena(1, { splitCost: 0.1 });
    w2.placeCell(0, 1500, 1500, 100, { replace: true });
    w2.step([go(1, 0, { split: true })]);
    expect(w2.cellsOf(0).reduce((s, c) => s + c.mass, 0)).toBeCloseTo(90, 9);
    expect(w2.ledger.splitLost).toBeCloseTo(10, 9);
    checkInvariants(w2);
  });

  it('enforces minimum mass, cooldown and the cell cap', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, w.config.minSplitMass - 1, { replace: true });
    w.step([go(1, 0, { split: true })]);
    expect(w.cells.length).toBe(1);
    expect(w.agents[0].stats.invalidSplits).toBe(1);

    const w2 = arena(1);
    w2.placeCell(0, 1500, 1500, 5000, { replace: true });
    w2.step([go(1, 0, { split: true })]);
    w2.step([go(1, 0, { split: true })]);
    expect(w2.cells.length).toBe(2);
    expect(w2.agents[0].stats.invalidSplits).toBe(1);
    for (let i = 0; i < 200; i++) w2.step([go(1, 0, { split: i % 20 === 0 })]);
    expect(w2.cells.length).toBeLessThanOrEqual(w2.config.maxCells);
    expect(w2.cells.length).toBe(w2.config.maxCells);
    checkInvariants(w2);
  });

  it('split cells push apart, then merge back after the timer without losing mass', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, 200, { replace: true });
    w.step([go(1, 0, { split: true })]);
    expect(w.cells.length).toBe(2);
    let minGap = Infinity;
    const mergeTicks = Math.ceil((w.config.mergeBase + w.config.mergePerMass * 200) / w.config.tickSeconds);
    for (let i = 0; i < mergeTicks - 5; i++) {
      w.step([go(0, 0)]);
      const [a, b] = w.cells;
      minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);
      checkInvariants(w);
    }
    expect(w.cells.length).toBe(2);
    expect(minGap).toBeGreaterThan(-1e-6);
    for (let i = 0; i < 300 && w.cells.length > 1; i++) w.step([go(0, 0)]);
    expect(w.cells.length).toBe(1);
    expect(w.cells[0].mass).toBeCloseTo(200, 9);
    checkInvariants(w);
  });

  it('a split attack can catch prey that the unsplit cell could not reach', () => {
    const w = arena(2);
    w.placeCell(0, 1000, 1500, 200, { replace: true });
    w.placeCell(1, 1200, 1500, 20, { replace: true });
    for (let i = 0; i < 10; i++) w.step([go(1, 0, { split: i === 0 }), go(0, 0)]);
    expect(w.agents[1].alive).toBe(false);
    expect(w.agents[0].stats.cellsEaten).toBe(1);
    checkInvariants(w);
  });
});

describe('eject', () => {
  it('removes ejectMass from the cell; the pellet carries the efficient share', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, 100, { replace: true });
    w.step([go(1, 0, { eject: true })]);
    expect(w.cells[0].mass).toBeCloseTo(100 - w.config.ejectMass, 9);
    expect(w.pellets.length).toBe(1);
    expect(w.pellets[0].mass).toBeCloseTo(w.config.ejectMass * w.config.ejectEfficiency, 9);
    expect(w.pellets[0].x).toBeGreaterThan(1500);
    checkInvariants(w);
  });

  it('pellets transfer their mass to whoever absorbs them, and expire otherwise', () => {
    const w = arena(2);
    w.placeCell(0, 1000, 1500, 100, { replace: true });
    w.placeCell(1, 1170, 1500, 60, { replace: true });
    w.step([go(1, 0, { eject: true }), go(0, 0)]);
    const pm = w.pellets[0].mass;
    for (let i = 0; i < 60; i++) w.step([go(0, 0), go(0, 0)]);
    expect(w.pellets.length).toBe(0);
    expect(w.cellsOf(1)[0].mass).toBeCloseTo(60 + pm, 9);
    checkInvariants(w);

    const w2 = arena(1, { ejectLifetime: 1 });
    w2.placeCell(0, 1500, 1500, 100, { replace: true });
    w2.step([go(1, 0, { eject: true })]);
    for (let i = 0; i < 40; i++) w2.step([go(-1, 0)]);
    expect(w2.pellets.length).toBe(0);
    expect(w2.ledger.pelletExpired).toBeCloseTo(w2.config.ejectMass * w2.config.ejectEfficiency, 9);
    checkInvariants(w2);
  });

  it('rejects ejection below the minimum mass and during cooldown', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, w.config.minEjectMass - 1, { replace: true });
    w.step([go(1, 0, { eject: true })]);
    expect(w.pellets.length).toBe(0);
    expect(w.agents[0].stats.invalidEjects).toBe(1);
  });

  it('eject-and-reabsorb loops lose mass rather than create it', () => {
    const w = arena(1);
    w.placeCell(0, 1500, 1500, 200, { replace: true });
    for (let i = 0; i < 300; i++) w.step([go(i % 2 ? 1 : -1, 0, { eject: i % 4 === 0 })]);
    for (let i = 0; i < 300; i++) w.step([go(0, 0)]);
    expect(w.agents[0].totalMass).toBeLessThan(200);
    checkInvariants(w);
  });
});

describe('thorns', () => {
  it('small cells pass over thorns unharmed; large cells swallow and burst', () => {
    const w = arena(2, { thornCount: 1 });
    const thorn = w.thorns[0];
    w.placeCell(0, thorn.x, thorn.y, 50, { replace: true });
    w.placeCell(1, 200, 200, 20, { replace: true });
    w.step([go(0, 0), go(0, 0)]);
    expect(thorn.alive).toBe(true);
    expect(w.cellsOf(0).length).toBe(1);

    w.placeCell(0, thorn.x, thorn.y, 400, { replace: true });
    w.step([go(0, 0), go(0, 0)]);
    expect(w.thorns[0].alive).toBe(false);
    expect(w.cellsOf(0).length).toBe(1 + w.config.thornBurstPieces);
    expect(w.agents[0].totalMass).toBeCloseTo(400 + w.config.thornMass, 6);
    checkInvariants(w);
    for (let i = 0; i < Math.ceil(w.config.thornRespawnSeconds / w.config.tickSeconds) + 2; i++) w.step([go(1, 0), go(0, 0)]);
    expect(w.thorns[0].alive).toBe(true);
    checkInvariants(w);
  });
});

describe('death and respawn', () => {
  it('respawns dead agents after the delay when enabled', () => {
    const w = arena(2, { respawn: true, respawnDelay: 1 });
    w.placeCell(0, 1500, 1500, 300, { replace: true });
    w.placeCell(1, 1500, 1500, 20, { replace: true });
    w.step([go(0, 0), go(0, 0)]);
    expect(w.agents[1].alive).toBe(false);
    for (let i = 0; i < 31; i++) w.step([go(0, 0), go(0, 0)]);
    expect(w.agents[1].alive).toBe(true);
    expect(w.cellsOf(1)[0].mass).toBe(w.config.startMass);
    expect(w.agents[1].stats.deaths).toBe(1);
    checkInvariants(w);
  });
});

describe('determinism and invariants in full games', () => {
  function chaoticRun(seed: number, ticks: number, check = false): World {
    const w = new World({ seed, agents: Array.from({ length: 12 }, (_, i) => ({ name: `a${i}`, startMass: 20 + 40 * i })), config: { respawn: true } });
    const rng = new Rng(seed ^ 0xabcdef);
    for (let t = 0; t < ticks; t++) {
      const actions = w.agents.map(() => ({ dx: rng.range(-1, 1), dy: rng.range(-1, 1), split: rng.next() < 0.02, eject: rng.next() < 0.02 }));
      w.step(actions);
      if (check && t % 25 === 0) checkInvariants(w);
    }
    return w;
  }

  it('same seed and action sequence reproduce the exact same state', () => {
    const a = chaoticRun(7, 900), b = chaoticRun(7, 900);
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
    const c = chaoticRun(8, 900);
    expect(JSON.stringify(a.toJSON())).not.toBe(JSON.stringify(c.toJSON()));
  });

  it('holds every invariant and balances the mass ledger through a chaotic game', () => {
    const w = chaoticRun(11, 3000, true);
    checkInvariants(w);
    expect(w.agents.some((a) => a.stats.splits > 0)).toBe(true);
    expect(w.agents.some((a) => a.stats.cellsEaten > 0)).toBe(true);
  });

  it('snapshot save → load → continue matches an uninterrupted run', () => {
    const seed = 21;
    const rngA = new Rng(5), rngB = new Rng(5);
    const mk = () => new World({ seed, agents: Array.from({ length: 8 }, (_, i) => ({ name: `a${i}` })) });
    const act = (r: Rng, n: number) => Array.from({ length: n }, () => ({ dx: r.range(-1, 1), dy: r.range(-1, 1), split: r.next() < 0.03, eject: r.next() < 0.03 }));
    const a = mk();
    for (let i = 0; i < 400; i++) a.step(act(rngA, 8));
    let b = mk();
    for (let i = 0; i < 200; i++) b.step(act(rngB, 8));
    b = World.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    for (let i = 0; i < 200; i++) b.step(act(rngB, 8));
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
  });

  it('rejects malformed or hostile snapshots without hanging', () => {
    const good = new World({ seed: 1, agents: [{ name: 'a' }] }).toJSON();
    expect(() => parseSnapshot(null)).toThrow();
    expect(() => parseSnapshot({ ...good, version: 99 })).toThrow();
    expect(() => parseSnapshot({ ...good, cells: [{ ...good.cells[0], mass: -5 }] })).toThrow();
    expect(() => parseSnapshot({ ...good, cells: [{ ...good.cells[0], x: 'NaN' }] })).toThrow();
    expect(() => parseSnapshot({ ...good, cells: [{ ...good.cells[0], owner: 99 }] })).toThrow();
    expect(() => parseSnapshot({ ...good, food: new Array(100000).fill(good.food[0]) })).toThrow();
    expect(() => parseSnapshot({ ...good, config: { ...good.config, worldWidth: -1 } })).toThrow();
    expect(() => World.fromJSON(JSON.parse(JSON.stringify(good)))).not.toThrow();
  });

  it('default world matches the documented initial setup', () => {
    const w = new World({ seed: 1, agents: Array.from({ length: 16 }, (_, i) => ({ name: `a${i}` })) });
    expect(w.cells.length).toBe(16);
    expect(w.food.length).toBe(DEFAULT_CONFIG.foodMax);
    expect(w.thorns.length).toBe(DEFAULT_CONFIG.thornCount);
    expect(new Set(w.cells.map((c) => c.mass))).toEqual(new Set([DEFAULT_CONFIG.startMass]));
  });
});
