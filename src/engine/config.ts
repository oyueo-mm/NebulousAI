/**
 * Every tunable rule of the NebulousAI world lives here. The RL bridge, the
 * headless tournament runner and the browser all build worlds from this one
 * object, so a rule cannot silently differ between training and play.
 *
 * Units: distance in world units (wu), time in simulated seconds, mass in mass units (mu).
 */
export const RULES_VERSION = 'rules-v1';

export interface GameConfig {
  worldWidth: number;
  worldHeight: number;
  /** Fixed simulation step in seconds. The engine never uses wall-clock time. */
  tickSeconds: number;

  /** 2D areal density ρ in r = sqrt(m / (π ρ)). */
  density: number;
  startMass: number;
  /** Mass at which no further growth is allowed (keeps 2r well below the world size). */
  maxCellMass: number;

  /** v_max(m) = clamp(speedBase · (m / startMass)^(-speedExponent), speedMin, speedBase). */
  speedBase: number;
  speedExponent: number;
  speedMin: number;

  /** Fraction of mass above decayMinMass lost per second. */
  decayRate: number;
  decayMinMass: number;

  foodMass: number;
  foodMax: number;
  /** Food items spawned per simulated second while below foodMax. */
  foodSpawnPerSecond: number;
  /** Food present at t = 0, as a fraction of foodMax. */
  foodInitialFraction: number;

  /** Predator must satisfy predatorMass ≥ eatRatio · preyMass. */
  eatRatio: number;
  /** Prey is swallowed when centre distance ≤ rPredator − eatDepth · rPrey. */
  eatDepth: number;
  /** Fraction of the prey mass that reaches the predator (1 = conservative). */
  eatEfficiency: number;

  minSplitMass: number;
  maxCells: number;
  splitCooldown: number;
  /** Fraction of the parent mass destroyed by a split (0 = conservative). */
  splitCost: number;
  splitSpeed: number;
  /** Boost velocity decays as v·exp(−boostDecay·t). */
  boostDecay: number;
  /** Merge timer after a split: mergeBase + mergePerMass · cellMass, capped at mergeMax. */
  mergeBase: number;
  mergePerMass: number;
  mergeMax: number;
  /** Same-owner cells drift toward their common centre of mass at this rate (1/s). */
  cohesion: number;

  minEjectMass: number;
  ejectMass: number;
  /** Fraction of ejectMass carried by the pellet; the rest is lost. */
  ejectEfficiency: number;
  ejectCooldown: number;
  ejectSpeed: number;
  ejectLifetime: number;
  /** The ejecting cell ignores its own pellet for this long. */
  ejectSelfImmunity: number;

  thornCount: number;
  thornMass: number;
  /** Cells at or above thornMass · thornTriggerRatio burst when they swallow a thorn. */
  thornTriggerRatio: number;
  thornBurstPieces: number;
  thornRespawnSeconds: number;

  /** Vision radius: visionBase + visionPerRadius · (radius of the agent's mass as one cell). */
  visionBase: number;
  visionPerRadius: number;

  respawn: boolean;
  respawnDelay: number;
}

export const DEFAULT_CONFIG: Readonly<GameConfig> = Object.freeze({
  worldWidth: 3000,
  worldHeight: 3000,
  tickSeconds: 1 / 30,

  density: 1 / (16 * Math.PI),
  startMass: 20,
  maxCellMass: 20000,

  speedBase: 230,
  speedExponent: 0.36,
  speedMin: 40,

  decayRate: 0.002,
  decayMinMass: 60,

  foodMass: 1,
  foodMax: 600,
  foodSpawnPerSecond: 25,
  foodInitialFraction: 1,

  eatRatio: 1.25,
  eatDepth: 0.4,
  eatEfficiency: 1,

  minSplitMass: 36,
  maxCells: 16,
  splitCooldown: 0.5,
  splitCost: 0,
  splitSpeed: 800,
  boostDecay: 5,
  mergeBase: 9,
  mergePerMass: 0.01,
  mergeMax: 25,
  cohesion: 0.9,

  minEjectMass: 36,
  ejectMass: 16,
  ejectEfficiency: 0.8,
  ejectCooldown: 0.12,
  ejectSpeed: 700,
  ejectLifetime: 30,
  ejectSelfImmunity: 0.4,

  thornCount: 10,
  thornMass: 110,
  thornTriggerRatio: 1.3,
  thornBurstPieces: 8,
  thornRespawnSeconds: 8,

  visionBase: 650,
  visionPerRadius: 3,

  respawn: false,
  respawnDelay: 3,
});

export function makeConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  const cfg: GameConfig = { ...DEFAULT_CONFIG, ...overrides };
  validateConfig(cfg);
  return cfg;
}

/** Rejects configurations that would break invariants (non-finite, negative, impossible). */
export function validateConfig(cfg: GameConfig): void {
  for (const [key, value] of Object.entries(cfg)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`config.${key} must be finite`);
  }
  const positive: (keyof GameConfig)[] = [
    'worldWidth', 'worldHeight', 'tickSeconds', 'density', 'startMass', 'maxCellMass', 'speedBase',
    'foodMass', 'eatRatio', 'minSplitMass', 'maxCells', 'ejectMass', 'thornMass', 'visionBase',
  ];
  for (const key of positive) if ((cfg[key] as number) <= 0) throw new Error(`config.${key} must be > 0`);
  if (cfg.eatRatio < 1) throw new Error('config.eatRatio must be ≥ 1 so equal cells cannot eat each other');
  if (cfg.ejectEfficiency < 0 || cfg.ejectEfficiency > 1) throw new Error('config.ejectEfficiency must be in [0, 1]');
  if (cfg.eatEfficiency < 0 || cfg.eatEfficiency > 1) throw new Error('config.eatEfficiency must be in [0, 1]');
  if (cfg.splitCost < 0 || cfg.splitCost >= 1) throw new Error('config.splitCost must be in [0, 1)');
  if (cfg.minEjectMass <= cfg.ejectMass) throw new Error('config.minEjectMass must exceed ejectMass');
  if (cfg.tickSeconds > 0.1) throw new Error('config.tickSeconds must be ≤ 0.1 for stable integration');
  const maxR = Math.sqrt(cfg.maxCellMass / (Math.PI * cfg.density));
  if (2 * maxR >= Math.min(cfg.worldWidth, cfg.worldHeight)) throw new Error('config.maxCellMass too large for the world');
}
