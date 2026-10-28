import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../engine/config';
import { HOME_PALETTE, homeCamera } from '../render/home';
import { drawFrame } from '../render/renderer';
import { buildFrame } from '../worker/frames';
import { CELL_STRIDE } from '../worker/protocol';
import { homeSetup } from './home';
import { Match } from './match';

const options = { inspectId: null, heatmap: false, stats: { ups: 0, speedActual: 0, worldMsPerTick: 0, policyMsPerTick: 0, workerMsPerFrame: 0 }, running: false, historyFrom: 0, log: [] };

describe('home uses the actual game simulation', () => {
  it('runs seeded heuristic policies, movement, food growth and the normal mass-radius rule', () => {
    const setup = homeSetup(), match = new Match(setup);
    expect(setup.participants).toHaveLength(6);
    expect(match.world.config.tickSeconds).toBe(DEFAULT_CONFIG.tickSeconds);
    expect(match.world.config.eatRatio).toBe(DEFAULT_CONFIG.eatRatio);
    expect(match.world.config.speedBase).toBe(DEFAULT_CONFIG.speedBase);
    const original = match.world.cells.map(c => [c.x, c.y]);
    let ate = false;
    for (let i = 0; i < 150; i++) { match.step(); ate ||= match.world.events.some(e => e.type === 'eatFood'); }
    expect(match.traces.some(trace => trace?.kind === 'heuristic')).toBe(true);
    expect(match.world.cells.some((c, i) => c.x !== original[i]?.[0] || c.y !== original[i]?.[1])).toBe(true);
    expect(ate).toBe(true);
    expect(match.world.agents.some(a => a.stats.foodMass > 0)).toBe(true);
    for (const c of match.world.cells) expect(c.r).toBeCloseTo(Math.sqrt(c.mass / (Math.PI * match.world.config.density)));
    const replay = new Match(homeSetup());
    for (let i = 0; i < 150; i++) replay.step();
    expect(replay.world.toJSON()).toEqual(match.world.toJSON());
  });

  it('uses real predation conditions, mass transfer, death and respawn', () => {
    const match = new Match(homeSetup());
    const predator = match.world.cells.find(c => c.owner === 2)!;
    const prey = match.world.cells.find(c => c.owner === 1)!;
    expect(predator.mass).toBeGreaterThan(prey.mass * match.world.config.eatRatio);
    prey.x = predator.x; prey.y = predator.y;
    // Put both agents in their normal split cooldown so this fixture isolates whole-cell predation.
    match.world.agents[1].lastSplitAt = match.world.time;
    match.world.agents[2].lastSplitAt = match.world.time;
    const initial = predator.mass, preyMass = prey.mass;
    match.step();
    expect(match.world.events).toContainEqual(expect.objectContaining({ type: 'eatCell', predator: 2, prey: 1, mass: preyMass }));
    expect(match.world.agents[2].stats.preyMass).toBe(preyMass);
    expect(match.world.agents[2].totalMass).toBeGreaterThanOrEqual(initial + preyMass - 1);
    expect(match.world.agents[1].alive).toBe(false);
    let respawned = false;
    for (let i = 0; i < 300; i++) { match.step(); respawned ||= match.world.events.some(e => e.type === 'respawn' && e.agent === 1); }
    expect(respawned).toBe(true);
  });

  it('renders the actual packed engine positions and radii through the shared renderer', () => {
    const match = new Match(homeSetup());
    for (let i = 0; i < 30; i++) match.step();
    const frame = buildFrame(match, options);
    const arcs: number[][] = [];
    const context = {
      setTransform() {}, fillRect() {}, save() {}, translate() {}, scale() {}, beginPath() {},
      arc(...args: number[]) { arcs.push(args); }, fill() {}, stroke() {}, restore() {},
    } as unknown as CanvasRenderingContext2D;
    const viewport = { width: 620, height: 600, dpr: 1 };
    drawFrame(context, viewport, homeCamera(frame, viewport), frame, frame.cells, {
      overlays: { names: false, targets: false, vision: false, heatmap: false },
      inspect: null, selectedId: null, humanId: null, thornMass: 143, arena: false, palette: HOME_PALETTE,
    });
    for (let i = 0; i < frame.cells.length; i += CELL_STRIDE) {
      const c = match.world.cells.find(c => c.id === frame.cells[i])!;
      expect(frame.cells[i + 2]).toBeCloseTo(c.x, 3);
      expect(frame.cells[i + 4]).toBeCloseTo(c.r, 3);
      expect(arcs).toContainEqual([frame.cells[i + 2], frame.cells[i + 3], frame.cells[i + 4], 0, Math.PI * 2]);
    }
  });
});
