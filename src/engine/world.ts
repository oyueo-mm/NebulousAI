import { type GameConfig, makeConfig } from './config';
import { decayedMass, maxSpeed, massToRadius, mergeDelay, canEat, swallowDistance } from './physics';
import { Rng, deriveSeed } from './rng';
import { SpatialHash } from './spatial';
import type { Agent, AgentAction, Cell, Food, MassLedger, Pellet, Thorn, WorldEvent } from './types';
import { IDLE_ACTION } from './types';

export interface AgentSpec {
  name: string;
  /** Overrides config.startMass for this agent (curriculum stages, handicaps). */
  startMass?: number;
  /** Never respawn this agent even when config.respawn is on (e.g. the human player). */
  noRespawn?: boolean;
}

export interface WorldOptions {
  seed: number;
  agents: AgentSpec[];
  config?: Partial<GameConfig>;
  /** Rotates which spawn slot each agent receives, for start-position swapping in tournaments. */
  spawnRotation?: number;
}

const AGENT_HUES = [212, 4, 145, 38, 275, 186, 330, 95, 18, 250, 60, 165, 300, 120, 200, 350];
const CELL_GRID = 256;
const FOOD_GRID = 128;

/**
 * The authoritative NebulousAI simulation. `step()` advances exactly one fixed tick;
 * nothing here reads wall-clock time, the DOM or Math.random.
 *
 * Tick order (see docs/RULES.md):
 *  1. actions: record intent, perform split / eject requests (agent id order)
 *  2. movement of cells (control + cohesion + decaying boost), then pellets
 *  3. same-owner separation for cells that may not merge yet
 *  4. same-owner merging
 *  5. thorns (large cells swallow and burst)
 *  6. predation between different owners (largest predator first)
 *  7. food and pellet absorption (largest cell first)
 *  8. mass decay, radius update, deaths, respawns, food / thorn regeneration
 */
export class World {
  readonly config: GameConfig;
  readonly seed: number;
  tick = 0;
  cells: Cell[] = [];
  food: Food[] = [];
  pellets: Pellet[] = [];
  thorns: Thorn[] = [];
  agents: Agent[] = [];
  events: WorldEvent[] = [];
  ledger: MassLedger;

  private rng: Rng;
  private nextId = 1;
  private foodAccumulator = 0;
  private readonly cellGrid: SpatialHash;
  private readonly foodGrid: SpatialHash;
  private readonly boostFactor: number;
  private readonly startMasses: number[];
  private noRespawn: boolean[];
  // Scratch buffers reused every tick.
  private order: Cell[] = [];
  private ownerCells: Cell[][] = [];
  private candidates: Cell[] = [];
  private phaseMass: number[] = [];
  private phaseRadius: number[] = [];
  private lastEatenBy: number[] = [];

  constructor(options: WorldOptions) {
    this.config = makeConfig(options.config);
    this.seed = options.seed >>> 0;
    this.rng = new Rng(deriveSeed(this.seed, 0));
    const cfg = this.config;
    this.cellGrid = new SpatialHash(cfg.worldWidth, cfg.worldHeight, CELL_GRID);
    this.foodGrid = new SpatialHash(cfg.worldWidth, cfg.worldHeight, FOOD_GRID);
    this.boostFactor = Math.exp(-cfg.boostDecay * cfg.tickSeconds);
    this.startMasses = options.agents.map((a) => a.startMass ?? cfg.startMass);
    this.noRespawn = options.agents.map((a) => a.noRespawn === true);
    for (const m of this.startMasses) if (!(m > 0 && Number.isFinite(m))) throw new Error('agent startMass must be > 0');

    this.agents = options.agents.map((spec, i) => newAgent(i, spec.name, AGENT_HUES[i % AGENT_HUES.length] + 7 * Math.floor(i / AGENT_HUES.length)));
    this.ownerCells = this.agents.map(() => []);
    this.lastEatenBy = this.agents.map(() => -1);

    const slots = this.spawnSlots(this.agents.length);
    const rot = options.spawnRotation ?? 0;
    this.agents.forEach((agent, i) => {
      const slot = slots[(i + rot) % slots.length];
      this.addCell(agent.id, slot.x, slot.y, this.startMasses[i], 0);
      agent.totalMass = this.startMasses[i];
      agent.cellCount = 1;
      agent.stats.maxMass = agent.totalMass;
    });
    for (let i = 0; i < cfg.thornCount; i++) this.spawnThorn(slots);
    const initialFood = Math.round(cfg.foodMax * cfg.foodInitialFraction);
    for (let i = 0; i < initialFood; i++) this.spawnFood();

    this.ledger = {
      initial: this.totalWorldMass(), foodSpawned: 0, thornSpawned: 0, agentSpawned: 0, decayLost: 0,
      splitLost: 0, ejectLost: 0, pelletExpired: 0, eatLost: 0, capLost: 0,
    };
    this.rebuildFoodGrid();
  }

  get time(): number {
    return this.tick * this.config.tickSeconds;
  }

  // ------------------------------------------------------------------ queries

  aliveAgents(): Agent[] {
    return this.agents.filter((a) => a.alive);
  }

  cellsOf(agentId: number): Cell[] {
    return this.cells.filter((c) => c.alive && c.owner === agentId);
  }

  /** Mass-weighted centre of an agent's cells, or null when it has none. */
  centerOf(agentId: number): { x: number; y: number } | null {
    let m = 0, x = 0, y = 0;
    for (const c of this.cells) {
      if (!c.alive || c.owner !== agentId) continue;
      m += c.mass; x += c.x * c.mass; y += c.y * c.mass;
    }
    return m > 0 ? { x: x / m, y: y / m } : null;
  }

  totalWorldMass(): number {
    let m = 0;
    for (const c of this.cells) if (c.alive) m += c.mass;
    for (const f of this.food) if (f.alive) m += f.mass;
    for (const p of this.pellets) if (p.alive) m += p.mass;
    for (const t of this.thorns) if (t.alive) m += t.mass;
    return m;
  }

  /** Mass the ledger says should exist: initial + all inflows − all outflows. */
  expectedWorldMass(): number {
    const l = this.ledger;
    return l.initial + l.foodSpawned + l.thornSpawned + l.agentSpawned
      - l.decayLost - l.splitLost - l.ejectLost - l.pelletExpired - l.eatLost - l.capLost;
  }

  /** Food spatial index as of the last tick (positions do not move). */
  forEachFoodNear(x: number, y: number, r: number, visit: (f: Food) => void): void {
    this.foodGrid.queryRadius(x, y, r, (h) => {
      const f = this.food[h];
      if (f && f.alive) visit(f);
    });
  }

  /**
   * Scenario setup: replaces or adds a cell outside the normal tick (tests, sandbox).
   * The mass is recorded as spawned so the ledger stays balanced.
   */
  placeCell(owner: number, x: number, y: number, mass: number, options: { mergeAt?: number; replace?: boolean } = {}): Cell {
    if (!(mass > 0 && Number.isFinite(mass))) throw new Error('mass must be > 0');
    const agent = this.agents[owner];
    if (!agent) throw new Error(`no agent ${owner}`);
    if (options.replace) {
      for (const c of this.cells) if (c.owner === owner && c.alive) { this.ledger.agentSpawned -= c.mass; c.alive = false; }
      this.cells = this.cells.filter((c) => c.alive);
    }
    const c = this.addCell(owner, x, y, mass, options.mergeAt ?? 0);
    this.ledger.agentSpawned += mass;
    agent.alive = true;
    agent.totalMass = this.cellsOf(owner).reduce((s, k) => s + k.mass, 0);
    agent.cellCount = this.cellsOf(owner).length;
    return c;
  }

  /** Scenario setup: removes all food and pellets (ledger-balanced). */
  clearFood(): void {
    for (const f of this.food) this.ledger.foodSpawned -= f.mass;
    for (const p of this.pellets) this.ledger.foodSpawned -= p.mass;
    this.food = [];
    this.pellets = [];
    this.rebuildFoodGrid();
  }

  /** Scenario setup: adds one food item at a fixed position. */
  placeFood(x: number, y: number, mass = this.config.foodMass): Food {
    const f: Food = { id: this.nextId++, x, y, mass, hue: 120, alive: true };
    this.food.push(f);
    this.ledger.foodSpawned += mass;
    this.rebuildFoodGrid();
    return f;
  }

  // ------------------------------------------------------------------- step

  /** Advances one fixed tick. `actions[i]` drives agent i; missing entries idle. */
  step(actions: ReadonlyArray<AgentAction | undefined>): void {
    const cfg = this.config;
    const t = this.time;
    const dt = cfg.tickSeconds;
    this.events.length = 0;
    this.rebuildOwnerLists();

    // 1. actions
    for (const agent of this.agents) {
      const a = sanitizeAction(actions[agent.id]);
      agent.action = a;
      if (!agent.alive) continue;
      const len = Math.hypot(a.dx, a.dy);
      if (len > 1e-9) { agent.headingX = a.dx / len; agent.headingY = a.dy / len; }
      if (a.split) this.trySplit(agent, t);
      if (a.eject) this.tryEject(agent, t);
    }
    this.rebuildOwnerLists();

    // 2. movement
    for (const agent of this.agents) {
      const own = this.ownerCells[agent.id];
      if (own.length === 0) continue;
      let m = 0, cx = 0, cy = 0;
      for (const c of own) { m += c.mass; cx += c.x * c.mass; cy += c.y * c.mass; }
      cx /= m; cy /= m;
      const a = agent.action;
      const len = Math.hypot(a.dx, a.dy);
      const throttle = Math.min(1, len);
      const ux = len > 1e-9 ? a.dx / len : 0;
      const uy = len > 1e-9 ? a.dy / len : 0;
      for (const c of own) {
        const vmax = maxSpeed(c.mass, cfg);
        let vx = ux * throttle * vmax;
        let vy = uy * throttle * vmax;
        if (own.length > 1) {
          let kx = (cx - c.x) * cfg.cohesion;
          let ky = (cy - c.y) * cfg.cohesion;
          const kl = Math.hypot(kx, ky);
          const cap = 0.6 * vmax;
          if (kl > cap) { kx *= cap / kl; ky *= cap / kl; }
          vx += kx; vy += ky;
        }
        c.vx = vx; c.vy = vy;
        c.x += (vx + c.bx) * dt;
        c.y += (vy + c.by) * dt;
        c.bx *= this.boostFactor;
        c.by *= this.boostFactor;
        if (Math.abs(c.bx) < 1e-3) c.bx = 0;
        if (Math.abs(c.by) < 1e-3) c.by = 0;
        this.clampCell(c);
      }
    }
    for (const p of this.pellets) {
      if (!p.alive) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= this.boostFactor; p.vy *= this.boostFactor;
      const pr = massToRadius(p.mass, cfg);
      if (p.x < pr) { p.x = pr; p.vx = Math.abs(p.vx); }
      if (p.x > cfg.worldWidth - pr) { p.x = cfg.worldWidth - pr; p.vx = -Math.abs(p.vx); }
      if (p.y < pr) { p.y = pr; p.vy = Math.abs(p.vy); }
      if (p.y > cfg.worldHeight - pr) { p.y = cfg.worldHeight - pr; p.vy = -Math.abs(p.vy); }
    }

    // 3–4. same-owner separation and merging
    for (const own of this.ownerCells) if (own.length > 1) this.separate(own, t);
    for (const own of this.ownerCells) if (own.length > 1) this.merge(own, t);

    // 5. thorns
    if (this.thorns.length > 0) this.resolveThorns(t);

    // 6. predation
    this.resolvePredation();

    // 7. food and pellets
    this.resolveFood(t);

    // 8. decay, bookkeeping, regeneration
    for (const c of this.cells) {
      if (!c.alive) continue;
      const m = decayedMass(c.mass, dt, cfg);
      this.ledger.decayLost += c.mass - m;
      c.mass = m;
      c.r = massToRadius(c.mass, cfg);
    }
    for (const p of this.pellets) {
      if (p.alive && t + dt - p.bornAt >= cfg.ejectLifetime) {
        p.alive = false;
        this.ledger.pelletExpired += p.mass;
      }
    }
    this.compact();
    this.updateAgents(t + dt);
    this.regenerate(t + dt);
    this.tick++;
    this.rebuildFoodGrid();
  }

  // ---------------------------------------------------------------- actions

  private trySplit(agent: Agent, t: number): void {
    const cfg = this.config;
    if (t - agent.lastSplitAt < cfg.splitCooldown) { agent.stats.invalidSplits++; return; }
    const own = [...this.ownerCells[agent.id]].sort(byMassDesc);
    let count = own.length;
    let made = 0;
    const len = Math.hypot(agent.action.dx, agent.action.dy);
    const ux = len > 1e-9 ? agent.action.dx / len : agent.headingX;
    const uy = len > 1e-9 ? agent.action.dy / len : agent.headingY;
    for (const c of own) {
      if (count >= cfg.maxCells) break;
      if (c.mass < cfg.minSplitMass) continue;
      const before = c.mass;
      const lost = before * cfg.splitCost;
      const half = (before - lost) / 2;
      this.ledger.splitLost += lost;
      c.mass = half;
      c.r = massToRadius(half, cfg);
      const wait = t + mergeDelay(before, cfg);
      c.mergeAt = Math.max(c.mergeAt, wait);
      const child = this.addCell(agent.id, c.x + ux * 2 * c.r, c.y + uy * 2 * c.r, half, wait);
      child.bx = ux * cfg.splitSpeed;
      child.by = uy * cfg.splitSpeed;
      count++;
      made++;
    }
    if (made === 0) { agent.stats.invalidSplits++; return; }
    agent.lastSplitAt = t;
    agent.stats.splits++;
    this.events.push({ type: 'split', agent: agent.id, pieces: made });
  }

  private tryEject(agent: Agent, t: number): void {
    const cfg = this.config;
    if (t - agent.lastEjectAt < cfg.ejectCooldown) { agent.stats.invalidEjects++; return; }
    const len = Math.hypot(agent.action.dx, agent.action.dy);
    const ux = len > 1e-9 ? agent.action.dx / len : agent.headingX;
    const uy = len > 1e-9 ? agent.action.dy / len : agent.headingY;
    let ejected = 0;
    for (const c of [...this.ownerCells[agent.id]].sort(byIdAsc)) {
      if (c.mass < cfg.minEjectMass) continue;
      c.mass -= cfg.ejectMass;
      c.r = massToRadius(c.mass, cfg);
      const pm = cfg.ejectMass * cfg.ejectEfficiency;
      this.ledger.ejectLost += cfg.ejectMass - pm;
      const pr = massToRadius(pm, cfg);
      const p: Pellet = {
        id: this.nextId++, x: c.x + ux * (c.r + pr + 2), y: c.y + uy * (c.r + pr + 2),
        vx: ux * cfg.ejectSpeed, vy: uy * cfg.ejectSpeed, mass: pm, sourceCell: c.id, owner: agent.id,
        bornAt: t, hue: agent.hue, alive: true,
      };
      p.x = clamp(p.x, pr, cfg.worldWidth - pr);
      p.y = clamp(p.y, pr, cfg.worldHeight - pr);
      this.pellets.push(p);
      ejected += pm;
    }
    if (ejected === 0) { agent.stats.invalidEjects++; return; }
    agent.lastEjectAt = t;
    agent.stats.ejects++;
    this.events.push({ type: 'eject', agent: agent.id, mass: ejected });
  }

  // ------------------------------------------------------------- resolution

  private separate(own: Cell[], t: number): void {
    const sorted = [...own].sort(byIdAsc);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (t >= a.mergeAt && t >= b.mergeAt) continue;
        let nx = b.x - a.x, ny = b.y - a.y;
        let d = Math.hypot(nx, ny);
        const overlap = a.r + b.r - d;
        if (overlap <= 0) continue;
        if (d < 1e-9) { nx = 1; ny = 0; d = 1; }
        nx /= d; ny /= d;
        const total = a.mass + b.mass;
        const pa = overlap * (b.mass / total);
        const pb = overlap * (a.mass / total);
        a.x -= nx * pa; a.y -= ny * pa;
        b.x += nx * pb; b.y += ny * pb;
        this.clampCell(a);
        this.clampCell(b);
      }
    }
  }

  private merge(own: Cell[], t: number): void {
    const sorted = [...own].sort(byMassDesc);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      if (!a.alive || t < a.mergeAt) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (!b.alive || t < b.mergeAt) continue;
        if (Math.hypot(b.x - a.x, b.y - a.y) > a.r) continue;
        this.gain(a, b.mass);
        b.alive = false;
        this.events.push({ type: 'merge', agent: a.owner });
      }
      a.r = massToRadius(a.mass, this.config);
    }
  }

  private resolveThorns(t: number): void {
    const cfg = this.config;
    const trigger = cfg.thornMass * cfg.thornTriggerRatio;
    const live = this.liveCounts();
    for (const thorn of this.thorns) {
      if (!thorn.alive) continue;
      let hit: Cell | null = null;
      for (const c of this.cells) {
        if (!c.alive || c.mass < trigger) continue;
        if (Math.hypot(c.x - thorn.x, c.y - thorn.y) > swallowDistance(c.r, thorn.r, cfg)) continue;
        if (!hit || byMassDesc(c, hit) < 0) hit = c;
      }
      if (!hit) continue;
      thorn.alive = false;
      thorn.respawnAt = t + cfg.thornRespawnSeconds;
      this.gain(hit, thorn.mass);
      const pieces = Math.min(cfg.thornBurstPieces, cfg.maxCells - live[hit.owner]);
      const agent = this.agents[hit.owner];
      agent.stats.thornBursts++;
      if (pieces <= 0) { hit.r = massToRadius(hit.mass, cfg); continue; }
      const total = hit.mass;
      const share = total / 2 / pieces;
      hit.mass = total / 2;
      hit.r = massToRadius(hit.mass, cfg);
      const wait = t + mergeDelay(total, cfg);
      hit.mergeAt = Math.max(hit.mergeAt, wait);
      const pr = massToRadius(share, cfg);
      const offset = (thorn.id % 16) * 0.39;
      for (let k = 0; k < pieces; k++) {
        const ang = offset + (2 * Math.PI * k) / pieces;
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const piece = this.addCell(hit.owner, hit.x + ux * (hit.r + pr), hit.y + uy * (hit.r + pr), share, wait);
        piece.bx = ux * cfg.splitSpeed * 0.6;
        piece.by = uy * cfg.splitSpeed * 0.6;
      }
      live[hit.owner] += pieces;
      this.events.push({ type: 'thorn', agent: hit.owner, pieces });
    }
  }

  /**
   * Eligibility uses masses and radii frozen at the start of this phase, so the
   * outcome does not depend on array order. Predators act from largest to smallest
   * (ties by id); a cell eaten earlier in the phase can no longer eat.
   */
  private resolvePredation(): void {
    const cfg = this.config;
    const cells = this.cells;
    this.cellGrid.clear();
    this.phaseMass.length = cells.length;
    this.phaseRadius.length = cells.length;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      this.phaseMass[i] = c.mass;
      this.phaseRadius[i] = c.r;
      if (c.alive) this.cellGrid.insertDisc(i, c.x, c.y, c.r);
    }
    const index = new Map<number, number>();
    cells.forEach((c, i) => index.set(c.id, i));
    const order = this.sortedAlive();
    for (const p of order) {
      if (!p.alive) continue;
      const pi = index.get(p.id)!;
      const pm = this.phaseMass[pi], pr = this.phaseRadius[pi];
      const cand = this.candidates;
      cand.length = 0;
      this.cellGrid.queryRadius(p.x, p.y, pr, (h) => {
        const q = cells[h];
        if (!q.alive || q.owner === p.owner) return;
        if (!canEat(pm, this.phaseMass[h], cfg)) return;
        if (Math.hypot(q.x - p.x, q.y - p.y) > swallowDistance(pr, this.phaseRadius[h], cfg)) return;
        cand.push(q);
      });
      if (cand.length === 0) continue;
      cand.sort(byMassDesc);
      for (const q of cand) {
        if (!q.alive) continue;
        q.alive = false;
        const gained = q.mass * cfg.eatEfficiency;
        this.ledger.eatLost += q.mass - gained;
        this.gain(p, gained);
        const pa = this.agents[p.owner];
        pa.stats.cellsEaten++;
        pa.stats.preyMass += gained;
        this.lastEatenBy[q.owner] = p.owner;
        this.events.push({ type: 'eatCell', predator: p.owner, prey: q.owner, mass: gained, preyCellId: q.id });
      }
    }
  }

  private resolveFood(t: number): void {
    const cfg = this.config;
    const order = this.sortedAlive();
    for (const c of order) {
      if (!c.alive) continue;
      const agent = this.agents[c.owner];
      this.foodGrid.queryRadius(c.x, c.y, c.r, (h) => {
        const f = this.food[h];
        if (!f || !f.alive) return;
        if ((f.x - c.x) ** 2 + (f.y - c.y) ** 2 >= c.r * c.r) return;
        f.alive = false;
        this.gain(c, f.mass);
        agent.stats.foodEaten++;
        agent.stats.foodMass += f.mass;
        this.events.push({ type: 'eatFood', agent: c.owner, mass: f.mass });
      });
    }
    if (this.pellets.length === 0) return;
    for (const c of order) {
      if (!c.alive) continue;
      for (const p of this.pellets) {
        if (!p.alive || !canEat(c.mass, p.mass, cfg)) continue;
        if (p.sourceCell === c.id && t - p.bornAt < cfg.ejectSelfImmunity) continue;
        if ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 >= c.r * c.r) continue;
        p.alive = false;
        this.gain(c, p.mass);
        this.agents[c.owner].stats.pelletsEaten++;
        this.events.push({ type: 'eatPellet', agent: c.owner, mass: p.mass, from: p.owner });
      }
    }
  }

  private updateAgents(tEnd: number): void {
    const cfg = this.config;
    for (const a of this.agents) { a.totalMass = 0; a.cellCount = 0; }
    for (const c of this.cells) {
      const a = this.agents[c.owner];
      a.totalMass += c.mass;
      a.cellCount++;
    }
    for (const a of this.agents) {
      if (a.alive && a.cellCount === 0) {
        a.alive = false;
        a.diedAt = tEnd;
        a.killedBy = this.lastEatenBy[a.id];
        a.stats.deaths++;
        if (a.killedBy >= 0) this.agents[a.killedBy].stats.kills++;
        a.respawnAt = tEnd + cfg.respawnDelay;
        this.events.push({ type: 'death', agent: a.id, killer: a.killedBy });
      } else if (a.alive) {
        a.aliveSeconds += cfg.tickSeconds;
        if (a.totalMass > a.stats.maxMass) a.stats.maxMass = a.totalMass;
      }
    }
  }

  private regenerate(tEnd: number): void {
    const cfg = this.config;
    if (cfg.respawn) {
      for (const a of this.agents) {
        if (a.alive || tEnd < a.respawnAt || this.noRespawn[a.id]) continue;
        const p = this.safeSpawnPoint();
        const mass = this.startMasses[a.id];
        this.addCell(a.id, p.x, p.y, mass, 0);
        this.ledger.agentSpawned += mass;
        a.alive = true;
        a.spawnedAt = tEnd;
        a.killedBy = -1;
        a.totalMass = mass;
        a.cellCount = 1;
        a.lastSplitAt = -1e9;
        a.lastEjectAt = -1e9;
        this.lastEatenBy[a.id] = -1;
        this.events.push({ type: 'respawn', agent: a.id });
      }
    }
    for (const thorn of this.thorns) {
      if (thorn.alive || tEnd < thorn.respawnAt) continue;
      const p = this.randomPoint(thorn.r + 60);
      thorn.x = p.x; thorn.y = p.y; thorn.alive = true;
      this.ledger.thornSpawned += thorn.mass;
    }
    if (this.food.length < cfg.foodMax) {
      this.foodAccumulator += cfg.foodSpawnPerSecond * cfg.tickSeconds;
      while (this.foodAccumulator >= 1 && this.food.length < cfg.foodMax) {
        this.foodAccumulator -= 1;
        const f = this.spawnFood();
        this.ledger.foodSpawned += f.mass;
      }
    } else {
      this.foodAccumulator = 0;
    }
  }

  // ----------------------------------------------------------------- helpers

  private gain(c: Cell, mass: number): void {
    c.mass += mass;
    if (c.mass > this.config.maxCellMass) {
      this.ledger.capLost += c.mass - this.config.maxCellMass;
      c.mass = this.config.maxCellMass;
    }
  }

  private addCell(owner: number, x: number, y: number, mass: number, mergeAt: number): Cell {
    const c: Cell = {
      id: this.nextId++, owner, x, y, vx: 0, vy: 0, bx: 0, by: 0, mass,
      r: massToRadius(mass, this.config), mergeAt, bornTick: this.tick, alive: true,
    };
    this.clampCell(c);
    this.cells.push(c);
    return c;
  }

  private clampCell(c: Cell): void {
    const cfg = this.config;
    c.x = clamp(c.x, c.r, cfg.worldWidth - c.r);
    c.y = clamp(c.y, c.r, cfg.worldHeight - c.r);
  }

  private rebuildFoodGrid(): void {
    this.foodGrid.clear();
    for (let i = 0; i < this.food.length; i++) this.foodGrid.insertPoint(i, this.food[i].x, this.food[i].y);
  }

  private rebuildOwnerLists(): void {
    for (const list of this.ownerCells) list.length = 0;
    for (const c of this.cells) if (c.alive) this.ownerCells[c.owner].push(c);
  }

  private liveCounts(): number[] {
    const n = this.agents.map(() => 0);
    for (const c of this.cells) if (c.alive) n[c.owner]++;
    return n;
  }

  private sortedAlive(): Cell[] {
    const o = this.order;
    o.length = 0;
    for (const c of this.cells) if (c.alive) o.push(c);
    o.sort(byMassDesc);
    return o;
  }

  private compact(): void {
    this.cells = this.cells.filter((c) => c.alive);
    this.food = this.food.filter((f) => f.alive);
    this.pellets = this.pellets.filter((p) => p.alive);
  }

  private spawnFood(): Food {
    const cfg = this.config;
    let x = 0, y = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      x = this.rng.range(8, cfg.worldWidth - 8);
      y = this.rng.range(8, cfg.worldHeight - 8);
      if (!this.insideThorn(x, y, 6)) break;
    }
    const f: Food = { id: this.nextId++, x, y, mass: cfg.foodMass, hue: Math.floor(this.rng.next() * 360), alive: true };
    this.food.push(f);
    return f;
  }

  private spawnThorn(avoid: { x: number; y: number }[]): void {
    const cfg = this.config;
    const r = massToRadius(cfg.thornMass, cfg);
    let p = this.randomPoint(r + 60);
    for (let attempt = 0; attempt < 20; attempt++) {
      if (avoid.every((s) => Math.hypot(s.x - p.x, s.y - p.y) > 250)) break;
      p = this.randomPoint(r + 60);
    }
    this.thorns.push({ id: this.nextId++, x: p.x, y: p.y, mass: cfg.thornMass, r, alive: true, respawnAt: 0 });
  }

  private insideThorn(x: number, y: number, pad: number): boolean {
    for (const t of this.thorns) if (t.alive && Math.hypot(t.x - x, t.y - y) < t.r + pad) return true;
    return false;
  }

  private randomPoint(margin: number): { x: number; y: number } {
    const cfg = this.config;
    return { x: this.rng.range(margin, cfg.worldWidth - margin), y: this.rng.range(margin, cfg.worldHeight - margin) };
  }

  /** Best-of-k farthest-point sampling: well spread, deterministic spawn slots. */
  private spawnSlots(n: number): { x: number; y: number }[] {
    const slots: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      let best = this.randomPoint(120);
      let bestD = -1;
      for (let k = 0; k < 24; k++) {
        const p = k === 0 ? best : this.randomPoint(120);
        let d = Infinity;
        for (const s of slots) d = Math.min(d, Math.hypot(s.x - p.x, s.y - p.y));
        if (d > bestD) { bestD = d; best = p; }
      }
      slots.push(best);
    }
    return slots;
  }

  private safeSpawnPoint(): { x: number; y: number } {
    let best = this.randomPoint(120);
    let bestScore = -Infinity;
    for (let k = 0; k < 16; k++) {
      const p = k === 0 ? best : this.randomPoint(120);
      let score = Infinity;
      for (const c of this.cells) if (c.alive) score = Math.min(score, Math.hypot(c.x - p.x, c.y - p.y) - c.r);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  // ----------------------------------------------------------- persistence

  toJSON(): WorldSnapshot {
    return {
      format: 'nebulous-world', version: 1, seed: this.seed, tick: this.tick, config: { ...this.config },
      rngState: this.rng.getState(), nextId: this.nextId, foodAccumulator: this.foodAccumulator,
      startMasses: [...this.startMasses], noRespawn: [...this.noRespawn],
      cells: this.cells.map((c) => ({ ...c })), food: this.food.map((f) => ({ ...f })),
      pellets: this.pellets.map((p) => ({ ...p })), thorns: this.thorns.map((t) => ({ ...t })),
      agents: this.agents.map((a) => ({ ...a, action: { ...a.action }, stats: { ...a.stats } })),
      ledger: { ...this.ledger }, lastEatenBy: [...this.lastEatenBy],
    };
  }

  static fromJSON(raw: unknown): World {
    const s = parseSnapshot(raw);
    const w = new World({ seed: s.seed, agents: s.agents.map((a, i) => ({ name: a.name, startMass: s.startMasses[i] })), config: { ...s.config, foodInitialFraction: 0, thornCount: 0 } });
    (w as { config: GameConfig }).config = makeConfig(s.config);
    w.tick = s.tick;
    w.rng.setState(s.rngState);
    w.nextId = s.nextId;
    w.foodAccumulator = s.foodAccumulator;
    w.cells = s.cells.map((c) => ({ ...c }));
    w.food = s.food.map((f) => ({ ...f }));
    w.pellets = s.pellets.map((p) => ({ ...p }));
    w.thorns = s.thorns.map((t) => ({ ...t }));
    w.agents = s.agents.map((a) => ({ ...a, action: { ...a.action }, stats: { ...a.stats } }));
    w.ledger = { ...s.ledger };
    w.lastEatenBy = [...s.lastEatenBy];
    w.noRespawn = s.agents.map((_, i) => s.noRespawn?.[i] === true);
    w.ownerCells = w.agents.map(() => []);
    w.rebuildFoodGrid();
    return w;
  }
}

export interface WorldSnapshot {
  format: 'nebulous-world';
  version: 1;
  seed: number;
  tick: number;
  config: GameConfig;
  rngState: number;
  nextId: number;
  foodAccumulator: number;
  startMasses: number[];
  noRespawn?: boolean[];
  cells: Cell[];
  food: Food[];
  pellets: Pellet[];
  thorns: Thorn[];
  agents: Agent[];
  ledger: MassLedger;
  lastEatenBy: number[];
}

const LIMITS = { agents: 256, cells: 8192, food: 50000, pellets: 20000, thorns: 2000 };

/** Validates untrusted snapshot JSON: shape, finiteness, bounds and referential integrity. */
export function parseSnapshot(raw: unknown): WorldSnapshot {
  const fail = (msg: string): never => { throw new Error(`invalid world snapshot: ${msg}`); };
  if (!raw || typeof raw !== 'object') fail('not an object');
  const s = raw as Record<string, unknown>;
  if (s.format !== 'nebulous-world' || s.version !== 1) fail('unknown format or version');
  const num = (v: unknown, name: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${name} must be a finite number`));
  const arr = (v: unknown, name: string, max: number): unknown[] => {
    if (!Array.isArray(v)) fail(`${name} must be an array`);
    if ((v as unknown[]).length > max) fail(`${name} exceeds ${max} entries`);
    return v as unknown[];
  };
  const objs = <T>(v: unknown, name: string, max: number, keys: string[]): T[] =>
    arr(v, name, max).map((o, i) => {
      if (!o || typeof o !== 'object') fail(`${name}[${i}] must be an object`);
      for (const k of keys) num((o as Record<string, unknown>)[k], `${name}[${i}].${k}`);
      return o as T;
    });
  num(s.seed, 'seed'); num(s.tick, 'tick'); num(s.rngState, 'rngState'); num(s.nextId, 'nextId'); num(s.foodAccumulator, 'foodAccumulator');
  if (!s.config || typeof s.config !== 'object') fail('config missing');
  makeConfig(s.config as Partial<GameConfig>);
  const agents = objs<Agent>(s.agents, 'agents', LIMITS.agents, ['id', 'hue', 'totalMass', 'cellCount', 'lastSplitAt', 'lastEjectAt', 'headingX', 'headingY']);
  agents.forEach((a, i) => {
    if (a.id !== i) fail('agent ids must equal their index');
    if (typeof a.name !== 'string' || a.name.length > 64) fail('agent name invalid');
    if (!a.stats || typeof a.stats !== 'object') fail('agent stats missing');
    if (!a.action || typeof a.action !== 'object') fail('agent action missing');
  });
  const cells = objs<Cell>(s.cells, 'cells', LIMITS.cells, ['id', 'owner', 'x', 'y', 'vx', 'vy', 'bx', 'by', 'mass', 'r', 'mergeAt']);
  const ids = new Set<number>();
  for (const c of cells) {
    if (!(c.mass > 0)) fail('cell mass must be positive');
    if (!Number.isInteger(c.owner) || c.owner < 0 || c.owner >= agents.length) fail('cell owner out of range');
    if (ids.has(c.id)) fail('duplicate cell id');
    ids.add(c.id);
  }
  objs(s.food, 'food', LIMITS.food, ['x', 'y', 'mass']);
  objs(s.pellets, 'pellets', LIMITS.pellets, ['x', 'y', 'vx', 'vy', 'mass', 'bornAt']);
  objs(s.thorns, 'thorns', LIMITS.thorns, ['x', 'y', 'mass', 'r', 'respawnAt']);
  const startMasses = arr(s.startMasses, 'startMasses', LIMITS.agents).map((m, i) => num(m, `startMasses[${i}]`));
  if (startMasses.length !== agents.length) fail('startMasses length mismatch');
  arr(s.lastEatenBy, 'lastEatenBy', LIMITS.agents).forEach((m, i) => num(m, `lastEatenBy[${i}]`));
  if (!s.ledger || typeof s.ledger !== 'object') fail('ledger missing');
  return s as unknown as WorldSnapshot;
}

function newAgent(id: number, name: string, hue: number): Agent {
  return {
    id, name, hue, alive: true, spawnedAt: 0, diedAt: -1, respawnAt: 0, killedBy: -1,
    lastSplitAt: -1e9, lastEjectAt: -1e9, action: { ...IDLE_ACTION }, headingX: 1, headingY: 0,
    totalMass: 0, cellCount: 0, aliveSeconds: 0,
    stats: {
      foodEaten: 0, foodMass: 0, pelletsEaten: 0, cellsEaten: 0, preyMass: 0, kills: 0, splits: 0, ejects: 0,
      invalidSplits: 0, invalidEjects: 0, thornBursts: 0, maxMass: 0, deaths: 0,
    },
  };
}

function sanitizeAction(a: AgentAction | undefined): AgentAction {
  if (!a) return { ...IDLE_ACTION };
  const dx = Number.isFinite(a.dx) ? a.dx : 0;
  const dy = Number.isFinite(a.dy) ? a.dy : 0;
  return { dx, dy, split: a.split === true, eject: a.eject === true };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function byMassDesc(a: { mass: number; id: number }, b: { mass: number; id: number }): number {
  return b.mass - a.mass || a.id - b.id;
}

function byIdAsc(a: { id: number }, b: { id: number }): number {
  return a.id - b.id;
}
