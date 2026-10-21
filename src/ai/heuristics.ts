import { maxSpeed } from '../engine/physics';
import type { Rng } from '../engine/rng';
import type { AgentAction } from '../engine/types';
import {
  DIRECTIONS_16, type Perception, type SeenCell, type ThreatInfo, dangerAt, preyCandidates, splitReach, threats,
} from './perception';
import type { HeuristicTrace, Policy, PolicyKind, PolicyTrace } from './types';

type Decision = { action: AgentAction; trace: PolicyTrace };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function unit(dx: number, dy: number): { x: number; y: number } {
  const l = Math.hypot(dx, dy);
  return l > 1e-9 ? { x: dx / l, y: dy / l } : { x: 0, y: 0 };
}

function trace(mode: string, partial: Partial<HeuristicTrace> = {}): HeuristicTrace {
  return { kind: 'heuristic', mode, target: null, targetKind: null, preyId: null, threatIds: [], risk: 0, split: false, eject: false, note: null, ...partial };
}

function act(dir: { x: number; y: number }, split = false, eject = false): AgentAction {
  return { dx: dir.x, dy: dir.y, split, eject };
}

/** Food target: the visible item with the most food mass around it per unit distance. */
function bestFood(p: Perception): { x: number; y: number } | null {
  const food = p.food;
  if (food.length === 0) return null;
  const candidates = Math.min(food.length, 24);
  const neighbourhood = Math.min(food.length, 64);
  let best = food[0], bestScore = -Infinity;
  for (let i = 0; i < candidates; i++) {
    const f = food[i];
    let cluster = 0;
    for (let j = 0; j < neighbourhood; j++) {
      const g = food[j];
      if ((g.x - f.x) ** 2 + (g.y - f.y) ** 2 < 120 * 120) cluster += g.mass;
    }
    const score = cluster / (f.dist + 60);
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return { x: best.x, y: best.y };
}

/** Weighted sum of "away from threat" vectors plus a push off nearby walls. */
function fleeDirection(p: Perception, list: ThreatInfo[]): { x: number; y: number } {
  let fx = 0, fy = 0;
  for (const t of list) {
    if (t.danger <= 0) continue;
    const u = unit(p.cx - t.cell.x, p.cy - t.cell.y);
    fx += u.x * t.danger * t.danger; fy += u.y * t.danger * t.danger;
  }
  const cfg = p.config;
  const margin = 250 + p.largest.r;
  if (p.cx < margin) fx += (margin - p.cx) / margin;
  if (p.cy < margin) fy += (margin - p.cy) / margin;
  if (cfg.worldWidth - p.cx < margin) fx -= (margin - (cfg.worldWidth - p.cx)) / margin;
  if (cfg.worldHeight - p.cy < margin) fy -= (margin - (cfg.worldHeight - p.cy)) / margin;
  const u = unit(fx, fy);
  return u.x === 0 && u.y === 0 ? unit(cfg.worldWidth / 2 - p.cx, cfg.worldHeight / 2 - p.cy) : u;
}

function wander(p: Perception, rng: Rng, last: AgentAction): Decision {
  let dir = unit(last.dx, last.dy);
  if ((dir.x === 0 && dir.y === 0) || rng.next() < 0.05) {
    const tx = rng.range(0.2, 0.8) * p.config.worldWidth;
    const ty = rng.range(0.2, 0.8) * p.config.worldHeight;
    dir = unit(tx - p.cx, ty - p.cy);
  }
  return { action: act(dir), trace: trace('wander', { targetKind: 'wander', target: { x: p.cx + dir.x * 300, y: p.cy + dir.y * 300 } }) };
}

/** Survival-style direction scoring: sampled future danger vs. food along each of 16 headings. */
function scoreDirections(p: Perception, list: ThreatInfo[], foodWeight: number, last: AgentAction) {
  const cfg = p.config;
  const speed = maxSpeed(p.largest.mass, cfg);
  const r = p.largest.r;
  const lastDir = unit(last.dx, last.dy);
  let best = DIRECTIONS_16[0], bestScore = -Infinity, bestDanger = 0;
  const foodSlice = p.food.slice(0, 80);
  for (const d of DIRECTIONS_16) {
    let danger = 0;
    let reachable = 0;
    for (const s of [0.4, 1.0, 1.8]) {
      // The engine clamps cells to the world, so score where the cell can actually be.
      const x = clamp(p.cx + d.x * speed * s, r, cfg.worldWidth - r);
      const y = clamp(p.cy + d.y * speed * s, r, cfg.worldHeight - r);
      reachable = Math.hypot(x - p.cx, y - p.cy);
      danger = Math.max(danger, dangerAt(p, x, y, list, s));
    }
    // Pushing into a wall goes nowhere: count it as not moving at all.
    if (reachable < speed * 0.5) danger += 0.3;
    let food = 0;
    for (const f of foodSlice) {
      const ux = (f.x - p.cx) / (f.dist || 1), uy = (f.y - p.cy) / (f.dist || 1);
      const c = ux * d.x + uy * d.y;
      if (c > 0.75) food += f.mass / (f.dist + 40);
    }
    const score = -4 * danger + foodWeight * food + 0.12 * (d.x * lastDir.x + d.y * lastDir.y);
    if (score > bestScore) { bestScore = score; best = d; bestDanger = danger; }
  }
  return { dir: best, danger: bestDanger };
}

/** Predicted danger of heading along `d` (same sampling as scoreDirections). */
function pathDanger(p: Perception, d: { x: number; y: number }, list: ThreatInfo[]): number {
  const cfg = p.config;
  const speed = maxSpeed(p.largest.mass, cfg);
  const r = p.largest.r;
  let danger = 0;
  for (const s of [0.4, 1.0, 1.8]) {
    const x = clamp(p.cx + d.x * speed * s, r, cfg.worldWidth - r);
    const y = clamp(p.cy + d.y * speed * s, r, cfg.worldHeight - r);
    danger = Math.max(danger, dangerAt(p, x, y, list, s));
  }
  return danger;
}

/** Best food cluster, but only if the straight path there is predicted safe. */
function safeFood(p: Perception, list: ThreatInfo[], tolerance: number): { target: { x: number; y: number }; dir: { x: number; y: number } } | null {
  const target = bestFood(p);
  if (!target) return null;
  const dir = unit(target.x - p.cx, target.y - p.cy);
  return pathDanger(p, dir, list) <= tolerance ? { target, dir } : null;
}

// ------------------------------------------------------------------ policies

export class RandomPolicy implements Policy {
  readonly kind: PolicyKind = 'random';
  decide(p: Perception, rng: Rng): Decision {
    const last = lastActionOf(p);
    let dir = unit(last.dx, last.dy);
    if ((dir.x === 0 && dir.y === 0) || rng.next() < 0.1) {
      const a = rng.range(0, 2 * Math.PI);
      dir = { x: Math.cos(a), y: Math.sin(a) };
    }
    const split = rng.next() < 0.01;
    const eject = rng.next() < 0.01;
    return {
      action: act(dir, split, eject),
      trace: trace('random walk', { target: { x: p.cx + dir.x * 250, y: p.cy + dir.y * 250 }, targetKind: 'wander', split, eject, note: { key: 'randomWalk', values: {} } }),
    };
  }
}

export class GreedyPolicy implements Policy {
  readonly kind: PolicyKind = 'greedy';
  decide(p: Perception, rng: Rng): Decision {
    const list = threats(p);
    const risk = list[0]?.danger ?? 0;
    const threatIds = list.filter((t) => t.danger > 0).map((t) => t.cell.id);
    if (risk > 0.55) {
      const dir = fleeDirection(p, list);
      return { action: act(dir), trace: trace('flee', { target: { x: p.cx + dir.x * 300, y: p.cy + dir.y * 300 }, targetKind: 'flee', threatIds, risk, note: { key: 'threatGap', values: { gap: list[0].gap } } }) };
    }
    let prey: SeenCell | null = null, preyScore = 0;
    for (const o of preyCandidates(p)) {
      if (o.mass < 0.1 * p.largest.mass) continue;
      const s = o.mass / (o.dist + 50);
      if (s > preyScore) { preyScore = s; prey = o; }
    }
    if (prey) {
      const dir = unit(prey.x - p.largest.x, prey.y - p.largest.y);
      const gap = Math.hypot(prey.x - p.largest.x, prey.y - p.largest.y) - p.largest.r;
      // Naive split: no risk assessment — this is what separates Greedy from Aggressive.
      const split = p.canSplit && p.largest.mass / 2 >= p.config.eatRatio * prey.mass && gap < splitReach(p.largest.mass, p.config) * 0.8;
      return { action: act(dir, split), trace: trace('chase', { target: { x: prey.x, y: prey.y }, targetKind: 'prey', preyId: prey.id, threatIds, risk, split }) };
    }
    const food = bestFood(p);
    if (food) {
      const dir = unit(food.x - p.cx, food.y - p.cy);
      return { action: act(dir), trace: trace('forage', { target: food, targetKind: 'food', threatIds, risk }) };
    }
    return wander(p, rng, lastActionOf(p));
  }
}

export class SurvivalPolicy implements Policy {
  readonly kind: PolicyKind = 'survival';
  decide(p: Perception, _rng: Rng): Decision {
    const list = threats(p);
    const risk = list[0]?.danger ?? 0;
    const threatIds = list.filter((t) => t.danger > 0).map((t) => t.cell.id);
    const calm = risk < 0.15 ? safeFood(p, list, 0.1) : null;
    if (calm) {
      return { action: act(calm.dir), trace: trace('forage', { target: calm.target, targetKind: 'food', threatIds, risk, note: { key: 'safePath', values: {} } }) };
    }
    const { dir, danger } = scoreDirections(p, list, 0.6 * (1 - risk), lastActionOf(p));
    // Last resort: when contact is imminent, split away so at least the launched half escapes.
    const top = list[0];
    const split = !!top && top.gap < 20 && p.canSplit && p.cells.length <= 2;
    const mode = risk > 0.5 ? 'evade' : risk > 0.15 ? 'cautious forage' : 'forage';
    return {
      action: act(dir, split),
      trace: trace(split ? 'escape split' : mode, {
        target: { x: p.cx + dir.x * 300, y: p.cy + dir.y * 300 }, targetKind: risk > 0.5 ? 'flee' : 'food', threatIds, risk, split,
        note: { key: 'headings', values: { danger } },
      }),
    };
  }
}

interface Hunt { prey: SeenCell; aim: { x: number; y: number }; value: number; tau: number; splitChance: number }

/** Evaluates every catchable visible prey: intercept point, time-to-catch, split-attack odds. */
function planHunt(p: Perception, list: ThreatInfo[]): Hunt | null {
  const cfg = p.config;
  const me = p.largest;
  const vMe = maxSpeed(me.mass, cfg);
  let best: Hunt | null = null;
  for (const o of preyCandidates(p)) {
    if (o.mass < 0.05 * me.mass) continue;
    const gap = Math.hypot(o.x - me.x, o.y - me.y) - me.r;
    const vPrey = maxSpeed(o.mass, cfg);
    const closing = vMe - 0.6 * vPrey;
    const reach = splitReach(me.mass, cfg);
    const halfCanEat = me.mass / 2 >= cfg.eatRatio * o.mass;
    if (closing <= 5 && !(halfCanEat && gap < reach)) continue;
    const tau = Math.max(0, gap) / Math.max(30, closing);
    const lead = Math.min(tau, 1.2);
    const aim = { x: o.x + o.vx * lead, y: o.y + o.vy * lead };
    const exposure = dangerAt(p, aim.x, aim.y, list);
    let splitChance = 0;
    if (p.canSplit && halfCanEat && p.cells.length <= 4 && gap < reach * 0.9) {
      // After splitting, our halves can be eaten by cells that are no threat to the whole.
      const counter = p.others.some((c) => c.owner !== o.owner && c.mass >= cfg.eatRatio * (me.mass / 2) && Math.hypot(c.x - aim.x, c.y - aim.y) < 1.5 * reach);
      if (!counter) splitChance = Math.max(0, 1 - gap / (reach * 0.9)) * (vPrey > vMe * 1.3 ? 0.6 : 1);
    }
    const value = (o.mass / (1 + tau)) * (1 - Math.min(0.9, exposure));
    if (!best || value > best.value) best = { prey: o, aim, value, tau, splitChance };
  }
  return best;
}

export class AggressivePolicy implements Policy {
  readonly kind: PolicyKind = 'aggressive';
  decide(p: Perception, rng: Rng): Decision {
    const list = threats(p);
    const risk = list[0]?.danger ?? 0;
    const threatIds = list.filter((t) => t.danger > 0).map((t) => t.cell.id);
    if (risk > 0.75) {
      const dir = fleeDirection(p, list);
      return { action: act(dir), trace: trace('evade', { target: { x: p.cx + dir.x * 300, y: p.cy + dir.y * 300 }, targetKind: 'flee', threatIds, risk }) };
    }
    const hunt = planHunt(p, list);
    if (hunt) {
      const dir = unit(hunt.aim.x - p.largest.x, hunt.aim.y - p.largest.y);
      const split = hunt.splitChance >= 0.35;
      return {
        action: act(dir, split),
        trace: trace(split ? 'split attack' : 'hunt', {
          target: hunt.aim, targetKind: 'prey', preyId: hunt.prey.id, threatIds, risk, split,
          note: { key: 'intercept', values: { tau: hunt.tau, odds: hunt.splitChance } },
        }),
      };
    }
    const food = bestFood(p);
    if (food) {
      const dir = unit(food.x - p.cx, food.y - p.cy);
      return { action: act(dir), trace: trace('forage', { target: food, targetKind: 'food', threatIds, risk }) };
    }
    return wander(p, rng, lastActionOf(p));
  }
}

export class HybridPolicy implements Policy {
  readonly kind: PolicyKind = 'hybrid';
  private readonly survival = new SurvivalPolicy();
  decide(p: Perception, rng: Rng): Decision {
    const list = threats(p);
    const risk = list[0]?.danger ?? 0;
    if (risk > 0.45) {
      const d = this.survival.decide(p, rng);
      if (d.trace.kind === 'heuristic') d.trace.mode = `survive · ${d.trace.mode}`;
      return d;
    }
    const threatIds = list.filter((t) => t.danger > 0).map((t) => t.cell.id);
    const hunt = planHunt(p, list);
    if (hunt && (hunt.splitChance >= 0.4 || (hunt.prey.mass >= 0.08 * p.largest.mass && hunt.tau < 4))) {
      const dir = unit(hunt.aim.x - p.largest.x, hunt.aim.y - p.largest.y);
      const split = hunt.splitChance >= 0.4;
      return {
        action: act(dir, split),
        trace: trace(split ? 'hunt · split attack' : 'hunt', {
          target: hunt.aim, targetKind: 'prey', preyId: hunt.prey.id, threatIds, risk, split,
          note: { key: 'intercept', values: { tau: hunt.tau, odds: hunt.splitChance } },
        }),
      };
    }
    if (p.food.length === 0) return wander(p, rng, lastActionOf(p));
    const direct = safeFood(p, list, 0.2);
    if (direct) {
      return { action: act(direct.dir), trace: trace('forage', { target: direct.target, targetKind: 'food', threatIds, risk, note: { key: 'safePath', values: {} } }) };
    }
    const { dir, danger } = scoreDirections(p, list, 1.2, lastActionOf(p));
    return {
      action: act(dir),
      trace: trace('safe forage', { target: { x: p.cx + dir.x * 300, y: p.cy + dir.y * 300 }, targetKind: 'food', threatIds, risk, note: { key: 'foodHeading', values: { danger } } }),
    };
  }
}

/** The agent's own previous action, which every controller is allowed to remember. */
export function lastActionOf(p: Perception): AgentAction {
  return p.lastAction;
}
