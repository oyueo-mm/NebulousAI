import type { Mode } from './settings';

export type Page = 'home' | Mode;
export const PAGES: Page[] = ['home', 'play', 'watch', 'tournament', 'lab'];

/** Accept both the original #play links and the canonical #/play routes. */
export function pageFromHash(hash = window.location.hash): Page {
  const value = hash.replace(/^#\/?/, '');
  return PAGES.includes(value as Page) ? value as Page : 'home';
}
