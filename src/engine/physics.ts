import type { GameConfig } from './config';

/** r = sqrt(m / (π ρ)): radius used for collision, eating and rendering alike. */
export function massToRadius(mass: number, cfg: GameConfig): number {
  return Math.sqrt(mass / (Math.PI * cfg.density));
}

export function radiusToMass(radius: number, cfg: GameConfig): number {
  return Math.PI * cfg.density * radius * radius;
}

/** Maximum control speed (wu/s); decreasing in mass, bounded to [speedMin, speedBase]. */
export function maxSpeed(mass: number, cfg: GameConfig): number {
  const v = cfg.speedBase * Math.pow(mass / cfg.startMass, -cfg.speedExponent);
  return Math.min(cfg.speedBase, Math.max(cfg.speedMin, v));
}

/** Merge timer granted to a cell of this mass right after it splits or bursts. */
export function mergeDelay(mass: number, cfg: GameConfig): number {
  return Math.min(cfg.mergeMax, cfg.mergeBase + cfg.mergePerMass * mass);
}

/** Mass after `seconds` of decay; never drops below decayMinMass through decay alone. */
export function decayedMass(mass: number, seconds: number, cfg: GameConfig): number {
  if (mass <= cfg.decayMinMass) return mass;
  const lost = mass * cfg.decayRate * seconds;
  return Math.max(cfg.decayMinMass, mass - lost);
}

export function canEat(predatorMass: number, preyMass: number, cfg: GameConfig): boolean {
  return predatorMass >= cfg.eatRatio * preyMass;
}

/** Centre distance at or below which a predator of radius rp swallows prey of radius rq. */
export function swallowDistance(rp: number, rq: number, cfg: GameConfig): number {
  return rp - cfg.eatDepth * rq;
}

/** Vision radius of an agent whose total mass is `totalMass`. */
export function visionRadius(totalMass: number, cfg: GameConfig): number {
  return cfg.visionBase + cfg.visionPerRadius * massToRadius(totalMass, cfg);
}
