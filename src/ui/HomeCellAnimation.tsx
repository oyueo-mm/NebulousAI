import { useEffect, useRef } from 'react';
import { DEFAULT_CONFIG } from '../engine/config';
import { t } from '../i18n';
import { HOME_PALETTE, homeCamera } from '../render/home';
import { drawFrame, interpolateCells, type Viewport } from '../render/renderer';
import { homeSetup } from '../sim/home';
import type { Frame, FromWorker, ToWorker } from '../worker/protocol';

/** A separate instance of the same worker, Match, policies and renderer used by Play / Watch. */
export function HomeCellAnimation() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let previous: Frame | null = null, current: Frame | null = null;
    let receivedAt = 0, interval = 33, raf = 0, visible = false, active = false, disposed = false;
    const viewport: Viewport = { width: 1, height: 1, dpr: 1 };
    const send = (message: ToWorker) => worker.postMessage(message);
    const draw = (now: number) => {
      if (!current || disposed) return;
      const cells = interpolateCells(previous, current, active ? (now - receivedAt) / interval : 1);
      drawFrame(ctx, viewport, homeCamera(current, viewport), current, cells, {
        overlays: { names: false, targets: false, vision: false, heatmap: false },
        inspect: null, selectedId: null, humanId: null,
        thornMass: DEFAULT_CONFIG.thornMass * DEFAULT_CONFIG.thornTriggerRatio,
        arena: false, palette: HOME_PALETTE,
      });
    };
    const tick = (now: number) => { draw(now); raf = requestAnimationFrame(tick); };
    const sync = () => {
      if (disposed) return;
      const next = visible && !document.hidden && !motion.matches;
      if (next === active) return;
      active = next;
      cancelAnimationFrame(raf);
      send({ type: 'running', value: active });
      if (active) raf = requestAnimationFrame(tick);
      else draw(performance.now());
    };
    worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
      if (data.type !== 'frame') return;
      const now = performance.now();
      if (current && data.tick > current.tick) {
        previous = current; interval = Math.max(8, Math.min(100, now - receivedAt));
      } else previous = null;
      current = data; receivedAt = now;
      if (!active) draw(now);
    };
    send({ type: 'init', setup: homeSetup(), models: [], running: false });
    const resize = new ResizeObserver(() => {
      const box = canvas.getBoundingClientRect();
      viewport.width = box.width; viewport.height = box.height;
      viewport.dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(box.width * viewport.dpr); canvas.height = Math.round(box.height * viewport.dpr);
      draw(performance.now());
    });
    resize.observe(canvas);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(canvas);
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      disposed = true; cancelAnimationFrame(raf); worker.terminate();
      resize.disconnect(); observer.disconnect();
      motion.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return <canvas ref={ref} className="home-animation" role="img" aria-label={t.home.animation} data-testid="home-animation" />;
}
