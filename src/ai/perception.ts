import type { GameConfig } from '../engine/config';
import { maxSpeed, massToRadius, visionRadius } from '../engine/physics';
import type { AgentAction, Cell } from '../engine/types';
import type { World } from '../engine/world';

/** Another agent's cell as seen from inside the vision radius. */
export interface SeenCell {
  id: number;
  owner: number;
  x: number;
  y: number;
  r: number;
  mass: number;
  /** Observed velocity (control + boost), wu/s. */
  vx: number;
  vy: number;
  /** Centre distance from the observer's centre of mass. */
  dist: number;
}

export interface SeenFood {
  x: number;
  y: number;
  mass: number;
  dist: number;
  pellet: boolean;
}

export interface SeenThorn {
  id: number;
  x: number;
  y: number;
  r: number;
  dist: number;
}

/**
 * Everything a controller may know. Built only from entities inside the agent's
 * vision radius, plus the agent's own state and the (public) world bounds.
 */
export interface Perception {
  agentId: number;
  time: number;
  config: GameConfig;
  cells: Cell[];
  totalMass: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  largest: Cell;
  smallest: Cell;
  vision: number;
  canSplit: boolean;
  canEject: boolean;
  /** Seconds until the soonest own cell may merge (0 if any may merge now). */
  mergeWait: number;
  others: SeenCell[];
  food: SeenFood[];
  thorns: SeenThorn[];
  /** The agent's own previous action (a controller may remember what it did). */
  lastAction: AgentAction;
}

export function perceive(world: World, agentId: number): Perception | null {
  const cfg = world.config;
  const agent = world.agents[agentId];
  if (!agent || !agent.alive) return null;
  const cells: Cell[] = [];
  let m = 0, cx = 0, cy = 0, vx = 0, vy = 0;
  for (const c of world.cells) {
    if (c.owner !== agentId || !c.alive) continue;
    cells.push(c);
    m += c.mass; cx += c.x * c.mass; cy += c.y * c.mass;
    vx += (c.vx + c.bx) * c.mass; vy += (c.vy + c.by) * c.mass;
  }
  if (cells.length === 0) return null;
  cx /= m; cy /= m; vx /= m; vy /= m;
  let largest = cells[0], smallest = cells[0];
  for (const c of cells) {
    if (c.mass > largest.mass || (c.mass === largest.mass && c.id < largest.id)) largest = c;
    if (c.mass < smallest.mass || (c.mass === smallest.mass && c.id < smallest.id)) smallest = c;
  }
  const vision = visionRadius(m, cfg);
  const t = world.time;

  const others: SeenCell[] = [];
  for (const c of world.cells) {
    if (!c.alive || c.owner === agentId) continue;
    const dist = Math.hypot(c.x - cx, c.y - cy);
    if (dist - c.r > vision) continue;
    others.push({ id: c.id, owner: c.owner, x: c.x, y: c.y, r: c.r, mass: c.mass, vx: c.vx + c.bx, vy: c.vy + c.by, dist });
  }
  others.sort((a, b) => a.dist - b.dist || a.id - b.id);

  const food: SeenFood[] = [];
  world.forEachFoodNear(cx, cy, vision, (f) => {
    const dist = Math.hypot(f.x - cx, f.y - cy);
    if (dist <= vision) food.push({ x: f.x, y: f.y, mass: f.mass, dist, pellet: false });
  });
  for (const p of world.pellets) {
    if (!p.alive) continue;
    const dist = Math.hypot(p.x - cx, p.y - cy);
    if (dist <= vision) food.push({ x: p.x, y: p.y, mass: p.mass, dist, pellet: true });
  }
  food.sort((a, b) => a.dist - b.dist || a.x - b.x || a.y - b.y);

  const thorns: SeenThorn[] = [];
  for (const th of world.thorns) {
    if (!th.alive) continue;
    const dist = Math.hypot(th.x - cx, th.y - cy);
    if (dist - th.r <= vision) thorns.push({ id: th.id, x: th.x, y: th.y, r: th.r, dist });
  }
  thorns.sort((a, b) => a.dist - b.dist || a.id - b.id);

  let mergeWait = Infinity;
  for (const c of cells) mergeWait = Math.min(mergeWait, Math.max(0, c.mergeAt - t));
  const splitReady = t - agent.lastSplitAt >= cfg.splitCooldown;
  const ejectReady = t - agent.lastEjectAt >= cfg.ejectCooldown;

  return {
    agentId, time: t, config: cfg, cells, totalMass: m, cx, cy, vx, vy, largest, smallest, vision,
    canSplit: splitReady && cells.length < cfg.maxCells && largest.mass >= cfg.minSplitMass,
    canEject: ejectReady && largest.mass >= cfg.minEjectMass,
    mergeWait: cells.length > 1 ? mergeWait : 0,
    others, food, thorns, lastAction: { ...agent.action },
  };
}

// ------------------------------------------------------------ shared tactics

/** Distance a split launches the new half: separation 2r' plus the boost glide v/k. */
export function splitReach(mass: number, cfg: GameConfig): number {
  const rHalf = massToRadius(mass / 2, cfg);
  return 2 * rHalf + cfg.splitSpeed / cfg.boostDecay;
}

/** Own cell nearest to a point (edge distance), and that distance. */
export function nearestOwn(p: Perception, x: number, y: number): { cell: Cell; edge: number } {
  let best = p.cells[0], bestD = Infinity;
  for (const c of p.cells) {
    const d = Math.hypot(c.x - x, c.y - y) - c.r;
    if (d < bestD) { bestD = d; best = c; }
  }
  return { cell: best, edge: bestD };
}

export interface ThreatInfo {
  cell: SeenCell;
  /** Edge-to-edge gap between the threat and the own cell it could eat. */
  gap: number;
  /** Whether it can also reach us by splitting. */
  splitter: boolean;
  /** Effective reach: how close is too close (wu). */
  reach: number;
  /** 0 (far) … 1 (contact). */
  danger: number;
}

export function threats(p: Perception): ThreatInfo[] {
  const cfg = p.config;
  const out: ThreatInfo[] = [];
  for (const o of p.others) {
    const { cell, edge } = nearestOwn(p, o.x, o.y);
    if (o.mass < cfg.eatRatio * cell.mass) continue;
    const gap = edge - o.r;
    const splitter = o.mass >= cfg.minSplitMass && o.mass / 2 >= cfg.eatRatio * cell.mass;
    const reach = (splitter ? splitReach(o.mass, cfg) : 0) + 2.2 * o.r + 60;
    const danger = Math.max(0, Math.min(1, 1 - gap / reach));
    out.push({ cell: o, gap, splitter, reach, danger });
  }
  out.sort((a, b) => b.danger - a.danger || a.gap - b.gap);
  return out;
}

export function preyCandidates(p: Perception): SeenCell[] {
  const cfg = p.config;
  return p.others.filter((o) => p.largest.mass >= cfg.eatRatio * o.mass);
}

/**
 * Heuristic danger of being at (x, y) `horizon` seconds from now. Each threat is
 * assumed to pursue that point at its top speed. Walls count in proportion to the
 * current threat level (a cornered cell has no escape route), thorns hurt cells big
 * enough to burst and shelter cells that are not when the pursuer is.
 * Used for direction scoring and drawn as the (explicitly heuristic) risk heatmap.
 */
export function dangerAt(p: Perception, x: number, y: number, threatList: ThreatInfo[], horizon = 0): number {
  const cfg = p.config;
  let d = 0, worst = 0;
  for (const t of threatList) {
    let tx = t.cell.x, ty = t.cell.y;
    if (horizon > 0) {
      const dist = Math.hypot(x - tx, y - ty);
      const step = Math.min(dist, 0.9 * maxSpeed(t.cell.mass, cfg) * horizon);
      if (dist > 1e-9) { tx += ((x - tx) / dist) * step; ty += ((y - ty) / dist) * step; }
    }
    const gap = Math.hypot(tx - x, ty - y) - t.cell.r - p.smallest.r;
    const v = Math.max(0, 1 - gap / t.reach) ** 2;
    d += v;
    worst = Math.max(worst, t.danger);
  }
  const wall = Math.min(x, y, cfg.worldWidth - x, cfg.worldHeight - y) - p.largest.r;
  if (wall < 450) d += (0.1 + 1.5 * worst) * (1 - Math.max(0, wall) / 450) ** 2;
  const trigger = cfg.thornMass * cfg.thornTriggerRatio;
  const bigPursuer = threatList.some((t) => t.danger > 0.2 && t.cell.mass >= trigger);
  for (const th of p.thorns) {
    const gap = Math.hypot(th.x - x, th.y - y) - p.largest.r;
    if (p.largest.mass >= trigger) {
      if (gap < 60) d += 0.6 * (1 - Math.max(0, gap) / 60);
    } else if (bigPursuer && gap < 80) {
      d -= 0.35 * (1 - Math.max(0, gap) / 80);
    }
  }
  return d;
}

export const DIRECTIONS_16 = Array.from({ length: 16 }, (_, k) => {
  const a = (k * Math.PI) / 8;
  return { x: Math.cos(a), y: Math.sin(a) };
});

/** Seconds the agent's largest cell needs to cover `dist`. */
export function travelTime(p: Perception, dist: number): number {
  return dist / maxSpeed(p.largest.mass, p.config);
}
