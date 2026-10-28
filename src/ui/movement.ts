const DIRECTIONS = [
  ['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft'], ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp'],
];

export const MOVEMENT_KEYS = new Set(DIRECTIONS.flat());

/** Keyboard aliases represent one direction; opposite directions cancel before normalizing. */
export function movement(keys: ReadonlySet<string>, joystick: { x: number; y: number; active: boolean }) {
  let dx: number, dy: number;
  if (joystick.active) { dx = joystick.x; dy = joystick.y; }
  else {
    const [right, left, down, up] = DIRECTIONS.map((aliases) => Number(aliases.some((key) => keys.has(key))));
    dx = right - left; dy = down - up;
  }
  const length = Math.max(1, Math.hypot(dx, dy));
  return { dx: dx / length, dy: dy / length };
}
