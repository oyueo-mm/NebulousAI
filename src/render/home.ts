import type { Frame } from '../worker/protocol';
import type { Camera, Viewport } from './renderer';

export const HOME_PALETTE = ['#DD6B86', '#9CBF78', '#FAC776', '#CE9BD3', '#EEA284'];

/** Fit the real arena into the hero without altering positions or radii. */
export function homeCamera(frame: Frame, viewport: Viewport): Camera {
  return {
    x: frame.world.width / 2, y: frame.world.height / 2,
    zoom: Math.min(viewport.width / frame.world.width, viewport.height / frame.world.height) * .94,
  };
}
