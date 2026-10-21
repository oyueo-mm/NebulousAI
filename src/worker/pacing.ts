/**
 * Real-time pacing of the fixed-tick simulation. Speed only decides *how many* fixed ticks run per
 * real second; the ticks themselves (dt = config.tickSeconds) are identical at every speed, so the
 * simulated result never depends on speed or frame timing.
 */
export const MAX_MODE_SPEED = 1000;
/** Real seconds per loop iteration are capped so a stalled tab does not trigger a burst. */
export const MAX_REAL_STEP = 0.1;
/** Unpaid backlog above this many ticks is dropped (and shows up as a lower measured speed). */
export const MAX_BACKLOG_TICKS = 4;

export interface PaceState {
  /** Simulated seconds owed but not yet simulated. */
  owed: number;
}

/**
 * Ticks wanted for this loop iteration at a fixed speed. Max mode (≥ MAX_MODE_SPEED) is not a
 * fixed rate: the caller simply runs ticks until its time budget is spent.
 */
export function ticksWanted(state: PaceState, dtReal: number, speed: number, tickSeconds: number): number {
  if (speed >= MAX_MODE_SPEED) { state.owed = 0; return Number.MAX_SAFE_INTEGER; }
  state.owed += Math.min(MAX_REAL_STEP, Math.max(0, dtReal)) * speed;
  return Math.floor(state.owed / tickSeconds + 1e-9);
}

/** Books the ticks that actually ran (fewer than wanted when the time budget ran out). */
export function ticksDone(state: PaceState, ran: number, speed: number, tickSeconds: number): void {
  if (speed >= MAX_MODE_SPEED) return;
  state.owed -= ran * tickSeconds;
  if (state.owed > MAX_BACKLOG_TICKS * tickSeconds) state.owed = 0;
}
