import { useEffect, useImperativeHandle, useRef, type MutableRefObject, type Ref } from 'react';
import { CELL_STRIDE } from '../worker/protocol';
import { type Camera, type Overlays, type Viewport, autoZoom, drawFrame, interpolateCells, screenToWorld } from '../render/renderer';
import type { FrameStore } from './useSimulation';
import type { AgentAction } from '../engine/types';

export interface CanvasHandle {
  fitWorld(): void;
  resetZoom(): void;
}

interface Props {
  frames: MutableRefObject<FrameStore>;
  humanId: number | null;
  followId: number | null;
  selectedId: number | null;
  overlays: Overlays;
  running: boolean;
  thornMass: number;
  visionFor: (mass: number) => number;
  /** Direction from the on-screen joystick, if any (takes priority while active). */
  joystick: MutableRefObject<{ x: number; y: number; active: boolean }>;
  onSelect: (agentId: number | null) => void;
  onInput: (action: AgentAction) => void;
  handle?: Ref<CanvasHandle>;
}

const KEY_DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
};

export function GameCanvas(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ x: 1500, y: 1500, zoom: 0.3 });
  const vp = useRef<Viewport>({ width: 1, height: 1, dpr: 1 });
  const userZoom = useRef(1);
  const free = useRef<{ dragging: boolean; lastX: number; lastY: number; moved: number }>({ dragging: false, lastX: 0, lastY: 0, moved: 0 });
  const mouse = useRef<{ x: number; y: number; inside: boolean; lastMove: number }>({ x: 0, y: 0, inside: false, lastMove: 0 });
  const keys = useRef(new Set<string>());
  const lastSent = useRef({ at: 0, dx: 0, dy: 0 });
  const drawState = useRef({ version: -1, camKey: '', force: true });
  const latest = useRef(props);
  latest.current = props;
  const fitRequested = useRef(true);

  useImperativeHandle(props.handle, () => ({
    fitWorld() { fitRequested.current = true; drawState.current.force = true; },
    resetZoom() { userZoom.current = 1; drawState.current.force = true; },
  }), []);

  // Size the backing store to the element; redraw synchronously so a resize never shows a blank canvas.
  useEffect(() => {
    const wrap = wrapRef.current!, canvas = canvasRef.current!;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      vp.current = { width: w, height: h, dpr };
      drawState.current.force = true;
      draw(performance.now(), 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    return () => ro.disconnect();
  }, []);

  function agentCentre(cells: Float32Array, owner: number): { x: number; y: number; mass: number } | null {
    let m = 0, x = 0, y = 0;
    for (let i = 0; i < cells.length; i += CELL_STRIDE) {
      if (cells[i + 1] !== owner) continue;
      const cm = cells[i + 5];
      m += cm; x += cells[i + 2] * cm; y += cells[i + 3] * cm;
    }
    return m > 0 ? { x: x / m, y: y / m, mass: m } : null;
  }

  function draw(now: number, dt: number): void {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const p = latest.current;
    const store = p.frames.current;
    const frame = store.curr;
    const v = vp.current;
    if (!frame) {
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      ctx.fillStyle = '#f4f6fb';
      ctx.fillRect(0, 0, v.width, v.height);
      return;
    }
    const alpha = p.running ? (now - store.currAt) / store.interval : 1;
    const cells = interpolateCells(store.prev, frame, alpha);
    const c = cam.current;
    if (fitRequested.current) {
      fitRequested.current = false;
      c.x = frame.world.width / 2; c.y = frame.world.height / 2;
      c.zoom = Math.min(v.width / frame.world.width, v.height / frame.world.height) * 0.94;
      if (p.followId === null) userZoom.current = 1;
    }
    const target = p.followId !== null ? agentCentre(cells, p.followId) : null;
    if (target) {
      const tz = autoZoom(v, p.visionFor(target.mass)) * userZoom.current;
      const k = dt > 0 ? 1 - Math.exp(-dt * 7) : 1;
      c.x += (target.x - c.x) * k;
      c.y += (target.y - c.y) * k;
      c.zoom += (tz - c.zoom) * (dt > 0 ? 1 - Math.exp(-dt * 3) : 1);
    }
    const camKey = `${c.x.toFixed(2)},${c.y.toFixed(2)},${c.zoom.toFixed(4)}`;
    const ds = drawState.current;
    if (!ds.force && !p.running && ds.version === store.version && ds.camKey === camKey) return;
    ds.force = false;
    ds.version = store.version;
    ds.camKey = camKey;
    drawFrame(ctx, v, c, frame, cells, {
      overlays: p.overlays, inspect: frame.inspect, selectedId: p.selectedId, humanId: p.humanId, thornMass: p.thornMass,
    });
    if (p.humanId !== null) sendInput(now, cells);
  }

  function sendInput(now: number, cells: Float32Array): void {
    const p = latest.current;
    if (p.humanId === null) return;
    let dx = 0, dy = 0;
    const joy = p.joystick.current;
    let keyX = 0, keyY = 0;
    for (const k of keys.current) { const d = KEY_DIRS[k]; if (d) { keyX += d[0]; keyY += d[1]; } }
    if (joy.active) {
      dx = joy.x; dy = joy.y;
    } else if (keyX !== 0 || keyY !== 0) {
      const l = Math.hypot(keyX, keyY);
      dx = keyX / l; dy = keyY / l;
    } else if (mouse.current.inside) {
      const centre = agentCentre(cells, p.humanId);
      if (centre) {
        const v = vp.current;
        const w = screenToWorld(cam.current, v, mouse.current.x, mouse.current.y);
        const ddx = w.x - centre.x, ddy = w.y - centre.y;
        const distPx = Math.hypot(ddx, ddy) * cam.current.zoom;
        const full = Math.min(v.width, v.height) * 0.12;
        const l = Math.hypot(ddx, ddy);
        if (l > 1e-6) { const t = Math.min(1, distPx / full); dx = (ddx / l) * t; dy = (ddy / l) * t; }
      }
    }
    const last = lastSent.current;
    if (now - last.at > 33 || Math.abs(dx - last.dx) + Math.abs(dy - last.dy) > 0.08) {
      lastSent.current = { at: now, dx, dy };
      p.onInput({ dx, dy, split: false, eject: false });
    }
  }

  // Render loop: interpolated while running, dirty-checked while paused.
  useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      draw(now, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => { drawState.current.force = true; }, [props.overlays, props.selectedId, props.followId]);

  // Keyboard movement (split / eject / pause / restart are handled by the app shell).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (KEY_DIRS[e.code] && latest.current.humanId !== null) { keys.current.add(e.code); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  const pickAgent = (sx: number, sy: number): number | null => {
    const f = latest.current.frames.current.curr;
    if (!f) return null;
    const w = screenToWorld(cam.current, vp.current, sx, sy);
    let best: number | null = null, bestR = Infinity;
    for (let i = 0; i < f.cells.length; i += CELL_STRIDE) {
      const d = Math.hypot(f.cells[i + 2] - w.x, f.cells[i + 3] - w.y);
      const r = f.cells[i + 4];
      if (d <= r + 6 / cam.current.zoom && r < bestR) { bestR = r; best = f.cells[i + 1]; }
    }
    return best;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden" data-testid="stage">
      <canvas
        ref={canvasRef}
        data-testid="game-canvas"
        className="block touch-none select-none"
        onPointerMove={(e) => {
          const pt = local(e);
          mouse.current = { x: pt.x, y: pt.y, inside: true, lastMove: performance.now() };
          const fr = free.current;
          if (fr.dragging) {
            const dx = pt.x - fr.lastX, dy = pt.y - fr.lastY;
            fr.moved += Math.abs(dx) + Math.abs(dy);
            fr.lastX = pt.x; fr.lastY = pt.y;
            if (latest.current.followId === null) {
              cam.current.x -= dx / cam.current.zoom;
              cam.current.y -= dy / cam.current.zoom;
            }
          }
        }}
        onPointerLeave={() => { mouse.current.inside = false; }}
        onPointerDown={(e) => {
          const pt = local(e);
          free.current = { dragging: true, lastX: pt.x, lastY: pt.y, moved: 0 };
          if (e.pointerType === 'mouse') mouse.current = { x: pt.x, y: pt.y, inside: true, lastMove: performance.now() };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerUp={(e) => {
          const fr = free.current;
          fr.dragging = false;
          if (fr.moved < 6 && latest.current.humanId === null) {
            const pt = local(e);
            latest.current.onSelect(pickAgent(pt.x, pt.y));
          }
        }}
        onWheel={(e) => {
          const factor = Math.exp(-e.deltaY * 0.0012);
          if (latest.current.followId !== null) {
            userZoom.current = Math.min(6, Math.max(0.15, userZoom.current * factor));
          } else {
            const pt = local(e);
            const before = screenToWorld(cam.current, vp.current, pt.x, pt.y);
            cam.current.zoom = Math.min(4, Math.max(0.03, cam.current.zoom * factor));
            const after = screenToWorld(cam.current, vp.current, pt.x, pt.y);
            cam.current.x += before.x - after.x;
            cam.current.y += before.y - after.y;
          }
          drawState.current.force = true;
        }}
      />
    </div>
  );
}
