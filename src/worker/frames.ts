import { maxSpeed } from '../engine/physics';
import { dangerAt, perceive, preyCandidates, threats } from '../ai/perception';
import type { Match } from '../sim/match';
import {
  CELL_STRIDE, FOOD_STRIDE, PELLET_STRIDE, THORN_STRIDE, type AgentSummary, type Frame, type FrameStats, type InspectDetail,
} from './protocol';

const HEAT_CELLS = 28;

/** Packs the match state into a transferable frame. Read-only with respect to the match. */
export function buildFrame(match: Match, opts: {
  inspectId: number | null; heatmap: boolean; stats: FrameStats; running: boolean; historyFrom: number; log: string[];
}): Frame {
  const w = match.world;
  const cells = new Float32Array(w.cells.length * CELL_STRIDE);
  w.cells.forEach((c, i) => {
    const o = i * CELL_STRIDE;
    cells[o] = c.id; cells[o + 1] = c.owner; cells[o + 2] = c.x; cells[o + 3] = c.y; cells[o + 4] = c.r; cells[o + 5] = c.mass;
  });
  const food = new Float32Array(w.food.length * FOOD_STRIDE);
  w.food.forEach((f, i) => { food[i * 3] = f.x; food[i * 3 + 1] = f.y; food[i * 3 + 2] = f.hue; });
  const pellets = new Float32Array(w.pellets.length * PELLET_STRIDE);
  w.pellets.forEach((p, i) => {
    pellets[i * 4] = p.x; pellets[i * 4 + 1] = p.y; pellets[i * 4 + 2] = Math.sqrt(p.mass / (Math.PI * w.config.density)); pellets[i * 4 + 3] = p.hue;
  });
  const liveThorns = w.thorns.filter((t) => t.alive);
  const thorns = new Float32Array(liveThorns.length * THORN_STRIDE);
  liveThorns.forEach((t, i) => { thorns[i * 3] = t.x; thorns[i * 3 + 1] = t.y; thorns[i * 3 + 2] = t.r; });

  const standings = match.standings();
  const agents: AgentSummary[] = w.agents.map((a) => {
    const trace = match.traces[a.id];
    const s = standings[a.id];
    let largest = 0;
    for (const c of w.cells) if (c.owner === a.id && c.mass > largest) largest = c.mass;
    const cfg = w.config;
    return {
      id: a.id, name: a.name, kind: match.kinds[a.id], label: match.policyLabel(a.id), hue: a.hue, alive: a.alive,
      mass: a.alive ? a.totalMass : 0, cells: a.cellCount, kills: a.stats.kills, cellsEaten: a.stats.cellsEaten, foodEaten: a.stats.foodEaten,
      splits: a.stats.splits, deaths: a.stats.deaths, killedBy: a.killedBy, maxMass: a.stats.maxMass, survival: a.aliveSeconds, rank: s.rank,
      mode: !a.alive ? 'dead' : trace ? (trace.kind === 'heuristic' ? trace.mode : 'neural policy') : match.kinds[a.id] === 'human' ? 'human' : '',
      episodeReturn: match.episodeReturn[a.id],
      canSplit: a.alive && w.time - a.lastSplitAt >= cfg.splitCooldown && largest >= cfg.minSplitMass && a.cellCount < cfg.maxCells,
      speed: largest > 0 ? maxSpeed(largest, cfg) : 0,
    };
  });

  return {
    type: 'frame', tick: w.tick, time: w.time, world: { width: w.config.worldWidth, height: w.config.worldHeight },
    cells, food, pellets, thorns, agents,
    inspect: opts.inspectId === null ? null : inspect(match, opts.inspectId, opts.heatmap),
    stats: opts.stats, running: opts.running, over: match.isOver(),
    history: match.history.slice(opts.historyFrom), log: opts.log,
  };
}

export function inspect(match: Match, agentId: number, heatmap: boolean): InspectDetail | null {
  const w = match.world;
  const agent = w.agents[agentId];
  if (!agent) return null;
  const p = perceive(w, agentId);
  const trace = match.traces[agentId];
  const spec = match.setup.participants[agentId];
  const r = match.lastReward[agentId];
  const base = {
    agentId, label: match.policyLabel(agentId), kind: match.kinds[agentId], modelId: spec.modelId ?? null,
    trained: trace && trace.kind === 'neural' ? trace.trained : null,
    trace: agent.alive ? trace : null, episodeReturn: match.episodeReturn[agentId],
    reward: r ? { total: r.total, growth: r.growth, kill: r.kill, death: r.death, cellLost: r.cellLost, actions: r.actions } : null,
  };
  if (!p) {
    return { ...base, mass: 0, cells: 0, centre: w.centerOf(agentId) ?? { x: 0, y: 0 }, vision: 0, canSplit: false, canEject: false, nearFood: [], threats: [], prey: [], obsSlots: [], heatmap: null };
  }
  const th = threats(p);
  let heat: InspectDetail['heatmap'] = null;
  if (heatmap) {
    const size = (2 * p.vision) / HEAT_CELLS;
    const x0 = p.cx - p.vision, y0 = p.cy - p.vision;
    const values = new Float32Array(HEAT_CELLS * HEAT_CELLS);
    for (let row = 0; row < HEAT_CELLS; row++) for (let col = 0; col < HEAT_CELLS; col++) {
      values[row * HEAT_CELLS + col] = dangerAt(p, x0 + (col + 0.5) * size, y0 + (row + 0.5) * size, th);
    }
    heat = { cols: HEAT_CELLS, rows: HEAT_CELLS, x0, y0, size, values };
  }
  return {
    ...base, mass: p.totalMass, cells: p.cells.length, centre: { x: p.cx, y: p.cy }, vision: p.vision, canSplit: p.canSplit, canEject: p.canEject,
    nearFood: p.food.slice(0, 5).map((f) => ({ x: f.x, y: f.y })),
    threats: th.map((t) => ({ id: t.cell.id, x: t.cell.x, y: t.cell.y, r: t.cell.r, danger: t.danger })),
    prey: preyCandidates(p).map((o) => ({ id: o.id, x: o.x, y: o.y, r: o.r })),
    obsSlots: p.others.slice(0, 8).map((o) => o.id),
    heatmap: heat,
  };
}
