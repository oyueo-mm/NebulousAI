import type { MlpModelFile } from '../ai/rl';
import type { PolicyTrace } from '../ai/types';
import type { AgentAction } from '../engine/types';
import type { ControllerKind, MatchSetup, MatchSnapshot } from '../sim/match';

export const CELL_STRIDE = 6; // id, owner, x, y, r, mass
export const FOOD_STRIDE = 3; // x, y, hue
export const PELLET_STRIDE = 4; // x, y, r, hue
export const THORN_STRIDE = 3; // x, y, r (alive only)

export type ToWorker =
  | { type: 'init'; setup: MatchSetup; models: MlpModelFile[]; running: boolean }
  | { type: 'load'; snapshot: MatchSnapshot; models: MlpModelFile[] }
  | { type: 'running'; value: boolean }
  | { type: 'speed'; value: number }
  | { type: 'stepOnce' }
  | { type: 'input'; agentId: number; action: AgentAction }
  | { type: 'inspect'; agentId: number | null; heatmap: boolean }
  | { type: 'save'; requestId: number };

export interface AgentSummary {
  id: number;
  name: string;
  kind: ControllerKind;
  label: string;
  hue: number;
  alive: boolean;
  mass: number;
  cells: number;
  kills: number;
  cellsEaten: number;
  foodEaten: number;
  splits: number;
  deaths: number;
  killedBy: number;
  maxMass: number;
  survival: number;
  rank: number;
  mode: string;
  episodeReturn: number;
  canSplit: boolean;
  speed: number;
}

export interface InspectDetail {
  agentId: number;
  label: string;
  kind: ControllerKind;
  modelId: string | null;
  trained: boolean | null;
  mass: number;
  cells: number;
  centre: { x: number; y: number };
  vision: number;
  canSplit: boolean;
  canEject: boolean;
  trace: PolicyTrace | null;
  /** Nearest visible food (up to 5), from the agent's own perception. */
  nearFood: { x: number; y: number }[];
  /** Visible cells that can eat one of this agent's cells, with heuristic danger. */
  threats: { id: number; x: number; y: number; r: number; danger: number }[];
  /** Visible cells this agent's largest cell could eat. */
  prey: { id: number; x: number; y: number; r: number }[];
  /** For neural agents: ids of the visible cells occupying obs-v1 slots cell0…cell7. */
  obsSlots: number[];
  reward: { total: number; growth: number; kill: number; death: number; cellLost: number; actions: number } | null;
  episodeReturn: number;
  /** Heuristic danger heatmap (rows × cols over the vision square), when requested. */
  heatmap: { cols: number; rows: number; x0: number; y0: number; size: number; values: Float32Array } | null;
}

export interface FrameStats {
  /** Simulated ticks per wall-clock second (measured). */
  ups: number;
  /** Achieved simulation speed relative to real time. */
  speedActual: number;
  worldMsPerTick: number;
  policyMsPerTick: number;
  workerMsPerFrame: number;
}

export interface Frame {
  type: 'frame';
  tick: number;
  time: number;
  world: { width: number; height: number };
  cells: Float32Array;
  food: Float32Array;
  pellets: Float32Array;
  thorns: Float32Array;
  agents: AgentSummary[];
  inspect: InspectDetail | null;
  stats: FrameStats;
  running: boolean;
  over: boolean;
  /** New mass-history samples since the previous frame. */
  history: { t: number; mass: number[] }[];
  log: string[];
}

export type FromWorker =
  | Frame
  | { type: 'ready'; agents: number; seed: number }
  | { type: 'saved'; requestId: number; snapshot: MatchSnapshot }
  | { type: 'error'; message: string };
