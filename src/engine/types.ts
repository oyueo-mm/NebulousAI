/** Owner-agnostic action every controller (human, heuristic, neural) sends to the engine. */
export interface AgentAction {
  /** Desired movement direction in world space; length is the throttle and is clamped to 1. */
  dx: number;
  dy: number;
  split: boolean;
  eject: boolean;
}

export const IDLE_ACTION: Readonly<AgentAction> = Object.freeze({ dx: 0, dy: 0, split: false, eject: false });

export interface Cell {
  id: number;
  owner: number;
  x: number;
  y: number;
  /** Control velocity applied during the last tick (wu/s). */
  vx: number;
  vy: number;
  /** Decaying impulse velocity from splits / bursts (wu/s). */
  bx: number;
  by: number;
  mass: number;
  r: number;
  /** Simulation time (s) after which this cell may merge with siblings. */
  mergeAt: number;
  bornTick: number;
  alive: boolean;
}

export interface Food {
  id: number;
  x: number;
  y: number;
  mass: number;
  hue: number;
  alive: boolean;
}

export interface Pellet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  sourceCell: number;
  owner: number;
  bornAt: number;
  hue: number;
  alive: boolean;
}

export interface Thorn {
  id: number;
  x: number;
  y: number;
  mass: number;
  r: number;
  alive: boolean;
  respawnAt: number;
}

export interface AgentStats {
  foodEaten: number;
  foodMass: number;
  pelletsEaten: number;
  cellsEaten: number;
  /** Mass gained from enemy cells. */
  preyMass: number;
  kills: number;
  splits: number;
  ejects: number;
  invalidSplits: number;
  invalidEjects: number;
  thornBursts: number;
  maxMass: number;
  deaths: number;
}

export interface Agent {
  id: number;
  name: string;
  hue: number;
  alive: boolean;
  spawnedAt: number;
  /** Simulation time of the most recent death, or −1. */
  diedAt: number;
  respawnAt: number;
  killedBy: number;
  lastSplitAt: number;
  lastEjectAt: number;
  action: AgentAction;
  /** Unit heading used when the action has no direction (last non-zero move). */
  headingX: number;
  headingY: number;
  totalMass: number;
  cellCount: number;
  /** Total survival time across lives, seconds. */
  aliveSeconds: number;
  stats: AgentStats;
}

export type WorldEvent =
  | { type: 'eatCell'; predator: number; prey: number; mass: number; preyCellId: number }
  | { type: 'eatFood'; agent: number; mass: number }
  | { type: 'eatPellet'; agent: number; mass: number; from: number }
  | { type: 'split'; agent: number; pieces: number }
  | { type: 'eject'; agent: number; mass: number }
  | { type: 'thorn'; agent: number; pieces: number }
  | { type: 'merge'; agent: number }
  | { type: 'death'; agent: number; killer: number }
  | { type: 'respawn'; agent: number };

/** Running totals of mass entering and leaving the world, for exact balance checks. */
export interface MassLedger {
  initial: number;
  foodSpawned: number;
  thornSpawned: number;
  agentSpawned: number;
  decayLost: number;
  splitLost: number;
  ejectLost: number;
  pelletExpired: number;
  eatLost: number;
  capLost: number;
}
