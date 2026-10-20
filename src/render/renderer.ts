import { CELL_STRIDE, FOOD_STRIDE, PELLET_STRIDE, THORN_STRIDE, type AgentSummary, type Frame, type InspectDetail } from '../worker/protocol';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Overlays {
  targets: boolean;
  vision: boolean;
  heatmap: boolean;
  names: boolean;
}

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

export const worldToScreen = (cam: Camera, vp: Viewport, x: number, y: number) => ({
  x: (x - cam.x) * cam.zoom + vp.width / 2,
  y: (y - cam.y) * cam.zoom + vp.height / 2,
});

export const screenToWorld = (cam: Camera, vp: Viewport, sx: number, sy: number) => ({
  x: (sx - vp.width / 2) / cam.zoom + cam.x,
  y: (sy - vp.height / 2) / cam.zoom + cam.y,
});

/** Cell positions blended between the two latest frames (by cell id). */
export function interpolateCells(prev: Frame | null, curr: Frame, alpha: number): Float32Array {
  if (!prev || alpha >= 1 || prev.tick >= curr.tick) return curr.cells;
  const a = Math.max(0, alpha);
  const prevPos = new Map<number, number>();
  for (let i = 0; i < prev.cells.length; i += CELL_STRIDE) prevPos.set(prev.cells[i], i);
  const out = new Float32Array(curr.cells);
  for (let i = 0; i < out.length; i += CELL_STRIDE) {
    const j = prevPos.get(out[i]);
    if (j === undefined) continue;
    const dx = out[i + 2] - prev.cells[j + 2], dy = out[i + 3] - prev.cells[j + 3];
    if (dx * dx + dy * dy > 200 * 200) continue; // respawn / teleport: do not smear
    out[i + 2] = prev.cells[j + 2] + dx * a;
    out[i + 3] = prev.cells[j + 3] + dy * a;
    out[i + 4] = prev.cells[j + 4] + (out[i + 4] - prev.cells[j + 4]) * a;
  }
  return out;
}

const cellFill = (hue: number) => `hsl(${hue} 72% 62%)`;
const cellStroke = (hue: number) => `hsl(${hue} 60% 42%)`;

export function drawFrame(
  ctx: CanvasRenderingContext2D, vp: Viewport, cam: Camera, frame: Frame, cells: Float32Array,
  opts: { overlays: Overlays; inspect: InspectDetail | null; selectedId: number | null; humanId: number | null; thornMass: number },
): void {
  const { width, height, dpr } = vp;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#f4f6fb';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  const vw = width / cam.zoom, vh = height / cam.zoom;
  const left = cam.x - vw / 2, top = cam.y - vh / 2, right = left + vw, bottom = top + vh;
  const W = frame.world.width, H = frame.world.height;

  // Arena and grid
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const grid = cam.zoom > 0.25 ? 100 : 500;
  ctx.strokeStyle = '#e8ecf4';
  ctx.lineWidth = 1 / cam.zoom;
  ctx.beginPath();
  for (let x = Math.max(0, Math.floor(left / grid) * grid); x <= Math.min(W, right); x += grid) { ctx.moveTo(x, Math.max(0, top)); ctx.lineTo(x, Math.min(H, bottom)); }
  for (let y = Math.max(0, Math.floor(top / grid) * grid); y <= Math.min(H, bottom); y += grid) { ctx.moveTo(Math.max(0, left), y); ctx.lineTo(Math.min(W, right), y); }
  ctx.stroke();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 3 / cam.zoom;
  ctx.strokeRect(0, 0, W, H);

  // Heuristic risk heatmap (drawn under everything else)
  const ins = opts.inspect;
  if (opts.overlays.heatmap && ins?.heatmap) {
    const h = ins.heatmap;
    for (let r = 0; r < h.rows; r++) for (let c = 0; c < h.cols; c++) {
      const v = h.values[r * h.cols + c];
      if (v <= 0.02) continue;
      ctx.fillStyle = `rgba(239, 68, 68, ${Math.min(0.45, v * 0.4)})`;
      ctx.fillRect(h.x0 + c * h.size, h.y0 + r * h.size, h.size + 0.5, h.size + 0.5);
    }
  }

  // Food
  const pad = 40;
  const f = frame.food;
  for (let i = 0; i < f.length; i += FOOD_STRIDE) {
    const x = f[i], y = f[i + 1];
    if (x < left - pad || x > right + pad || y < top - pad || y > bottom + pad) continue;
    ctx.fillStyle = `hsl(${f[i + 2]} 75% 66%)`;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const pel = frame.pellets;
  for (let i = 0; i < pel.length; i += PELLET_STRIDE) {
    ctx.fillStyle = cellFill(pel[i + 3]);
    ctx.strokeStyle = cellStroke(pel[i + 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pel[i], pel[i + 1], pel[i + 2], 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Cells sorted small → large; thorns are drawn above cells too small to burst (they can hide).
  const order: number[] = [];
  for (let i = 0; i < cells.length; i += CELL_STRIDE) order.push(i);
  order.sort((a, b) => cells[a + 5] - cells[b + 5]);
  const agents = new Map<number, AgentSummary>(frame.agents.map((a) => [a.id, a]));
  let thornsDrawn = false;
  const drawThorns = () => {
    thornsDrawn = true;
    const t = frame.thorns;
    for (let i = 0; i < t.length; i += THORN_STRIDE) drawThorn(ctx, t[i], t[i + 1], t[i + 2]);
  };
  for (const i of order) {
    const mass = cells[i + 5];
    if (!thornsDrawn && mass >= opts.thornMass) drawThorns();
    const x = cells[i + 2], y = cells[i + 3], r = cells[i + 4];
    if (x + r < left || x - r > right || y + r < top || y - r > bottom) continue;
    const owner = cells[i + 1];
    const a = agents.get(owner);
    const hue = a?.hue ?? 0;
    ctx.fillStyle = cellFill(hue);
    ctx.strokeStyle = cellStroke(hue);
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (owner === opts.selectedId || owner === opts.humanId) {
      ctx.strokeStyle = owner === opts.humanId ? '#0f172a' : '#2563eb';
      ctx.lineWidth = 2.5 / cam.zoom;
      ctx.setLineDash(owner === opts.humanId ? [] : [6 / cam.zoom, 4 / cam.zoom]);
      ctx.beginPath();
      ctx.arc(x, y, r + 5 / cam.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const px = r * cam.zoom;
    if (opts.overlays.names && a && px > 20) {
      const fs = Math.max(10, Math.min(26, px * 0.3)) / cam.zoom;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(15,23,42,0.45)';
      ctx.lineWidth = fs * 0.16;
      ctx.lineJoin = 'round';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
      ctx.strokeText(a.name, x, y - (px > 28 ? fs * 0.35 : 0));
      ctx.fillText(a.name, x, y - (px > 28 ? fs * 0.35 : 0));
      if (px > 28) {
        ctx.font = `500 ${fs * 0.8}px Inter, system-ui, sans-serif`;
        ctx.strokeText(Math.round(mass).toString(), x, y + fs * 0.65);
        ctx.fillText(Math.round(mass).toString(), x, y + fs * 0.65);
      }
    }
  }
  if (!thornsDrawn) drawThorns();

  if (ins && ins.cells > 0) drawInspection(ctx, cam, ins, opts.overlays, cells);
  ctx.restore();
}

function drawThorn(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const spikes = 18;
  ctx.beginPath();
  for (let k = 0; k <= spikes * 2; k++) {
    const a = (k * Math.PI) / spikes;
    const rr = k % 2 === 0 ? r * 1.12 : r * 0.9;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(52, 211, 153, 0.82)';
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
}

function drawInspection(ctx: CanvasRenderingContext2D, cam: Camera, ins: InspectDetail, overlays: Overlays, cells: Float32Array): void {
  const lw = 2 / cam.zoom;
  if (overlays.vision) {
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
    ctx.lineWidth = lw;
    ctx.setLineDash([10 / cam.zoom, 8 / cam.zoom]);
    ctx.beginPath();
    ctx.arc(ins.centre.x, ins.centre.y, ins.vision, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (!overlays.targets) return;
  const trace = ins.trace;
  if (trace?.kind === 'heuristic') {
    for (const f of ins.nearFood) {
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.7)';
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const t of ins.threats) {
      if (!trace.threatIds.includes(t.id)) continue;
      ctx.strokeStyle = `rgba(220, 38, 38, ${0.45 + 0.55 * t.danger})`;
      ctx.lineWidth = (2 + 3 * t.danger) / cam.zoom;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r + 8 / cam.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    const prey = ins.prey.find((p) => p.id === trace.preyId);
    if (prey) {
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 3 / cam.zoom;
      ctx.beginPath();
      ctx.arc(prey.x, prey.y, prey.r + 8 / cam.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (trace.target) {
      const colour = trace.targetKind === 'flee' ? '#dc2626' : trace.targetKind === 'prey' ? '#16a34a' : '#2563eb';
      arrow(ctx, ins.centre.x, ins.centre.y, trace.target.x, trace.target.y, colour, cam.zoom);
    }
  } else if (trace?.kind === 'neural') {
    // Neural policies have no explicit goal: show which visible cells fill obs-v1 slots, and the chosen move.
    ins.obsSlots.forEach((id, slot) => {
      for (let i = 0; i < cells.length; i += CELL_STRIDE) {
        if (cells[i] !== id) continue;
        ctx.fillStyle = '#7c3aed';
        ctx.font = `700 ${14 / cam.zoom}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`#${slot}`, cells[i + 2], cells[i + 3] - cells[i + 4] - 8 / cam.zoom);
      }
    });
    const move = Math.floor(trace.action / 3);
    if (move > 0) {
      const a = ((move - 1) * Math.PI) / 4;
      const len = 160 / cam.zoom;
      arrow(ctx, ins.centre.x, ins.centre.y, ins.centre.x + Math.cos(a) * len, ins.centre.y + Math.sin(a) * len, '#7c3aed', cam.zoom);
    }
  }
}

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, colour: string, zoom: number): void {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  const head = 14 / zoom;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 3 / zoom;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * head, y1 - uy * head);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * head - uy * head * 0.55, y1 - uy * head + ux * head * 0.55);
  ctx.lineTo(x1 - ux * head + uy * head * 0.55, y1 - uy * head - ux * head * 0.55);
  ctx.closePath();
  ctx.fill();
}

/** Follow-camera zoom for an agent with this vision radius. */
export function autoZoom(vp: Viewport, vision: number): number {
  // The short screen side spans 1.3 × vision; the long side usually covers the full vision diameter.
  return Math.min(vp.width, vp.height) / (2 * vision * 0.65);
}
