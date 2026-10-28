import { describe, expect, it } from 'vitest';
import { movement } from './movement';

const idle = { x: 0, y: 0, active: false };
describe('human movement', () => {
  it('supports WASD and arrows, normalizes diagonals and treats aliases as one direction', () => {
    expect(movement(new Set(['KeyW']), idle)).toEqual({ dx: 0, dy: -1 });
    expect(movement(new Set(['ArrowRight']), idle)).toEqual({ dx: 1, dy: 0 });
    const diagonal = movement(new Set(['KeyW', 'ArrowUp', 'KeyD']), idle);
    expect(diagonal.dx).toBeCloseTo(Math.SQRT1_2);
    expect(diagonal.dy).toBeCloseTo(-Math.SQRT1_2);
  });
  it('cancels opposite axes and returns neutral after key release', () => {
    const keys = new Set(['KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight']);
    expect(movement(keys, idle)).toEqual({ dx: 0, dy: 0 });
    keys.clear();
    expect(movement(keys, idle)).toEqual({ dx: 0, dy: 0 });
    expect(movement(new Set(['KeyA', 'KeyD', 'KeyS']), idle)).toEqual({ dx: 0, dy: 1 });
  });
  it('preserves analog joystick movement and caps magnitude', () => {
    expect(movement(new Set(['KeyW']), { x: .5, y: 0, active: true })).toEqual({ dx: .5, dy: 0 });
    expect(movement(new Set(), { x: 1, y: 1, active: true }).dx).toBeCloseTo(Math.SQRT1_2);
  });
});
