import { useEffect, useRef } from 'react';
import { t } from '../i18n';

const PALETTE = ['#DD6B86', '#9CBF78', '#FAC776', '#CE9BD3', '#EEA284'];
type Cell = { x: number; y: number; r: number; base: number; vx: number; vy: number; colour: string; phase: number; age: number };
type Food = { x: number; y: number; colour: string };
const W = 620, H = 600;

/** A small, independent visual simulation. It never starts or modifies the game worker. */
export function HomeCellAnimation() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0, last = 0, time = 0, visible = true, disposed = false;
    let width = 0, height = 0, dpr = 1;
    const food: Food[] = Array.from({ length: 65 }, (_, i) => ({ x: 45 + Math.random() * 530, y: 60 + Math.random() * 480, colour: PALETTE[i % 5] }));
    const cells: Cell[] = [
      [260, 280, 58], [380, 265, 26], [435, 410, 43], [170, 430, 33], [385, 125, 37], [115, 180, 23],
    ].map(([x, y, r], i) => ({ x, y, r, base: r, vx: 0, vy: 0, colour: PALETTE[i % 5], phase: i * 1.8, age: 2 }));

    const respawn = (c: Cell) => {
      c.x = 65 + Math.random() * 490; c.y = Math.random() > .5 ? 45 : H - 45;
      c.r = c.base; c.vx = 0; c.vy = 0; c.age = 0;
    };
    const update = (dt: number) => {
      time += dt;
      for (const c of cells) {
        c.age += dt;
        // Forage normally, hunt smaller neighbours and flee nearby larger cells.
        const threat = cells.filter((o) => o !== c && o.r > c.r * 1.25 && o.age > 1)
          .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
        const prey = cells.filter((o) => o !== c && c.r > o.r * 1.3 && o.age > 1)
          .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
        const nearest = food.reduce((a, b) => Math.hypot(a.x - c.x, a.y - c.y) < Math.hypot(b.x - c.x, b.y - c.y) ? a : b);
        let dx = nearest.x - c.x, dy = nearest.y - c.y, speed = 23;
        if (threat && Math.hypot(threat.x - c.x, threat.y - c.y) < threat.r + c.r + 60) {
          dx = c.x - threat.x; dy = c.y - threat.y; speed = 32;
        } else if (prey && Math.hypot(prey.x - c.x, prey.y - c.y) < 240) {
          dx = prey.x - c.x; dy = prey.y - c.y; speed = 39;
        }
        const length = Math.hypot(dx, dy) || 1;
        const easing = 1 - Math.exp(-dt * 2);
        c.vx += (dx / length * speed + Math.sin(time + c.phase) * 5 - c.vx) * easing;
        c.vy += (dy / length * speed + Math.cos(time * .7 + c.phase) * 5 - c.vy) * easing;
        c.x = Math.max(c.r + 14, Math.min(W - c.r - 14, c.x + c.vx * dt));
        c.y = Math.max(c.r + 14, Math.min(H - c.r - 14, c.y + c.vy * dt));
        for (const f of food) if (Math.hypot(c.x - f.x, c.y - f.y) < c.r - 1) {
          c.r = Math.sqrt(c.r * c.r + 18);
          f.x = 40 + Math.random() * (W - 80); f.y = 40 + Math.random() * (H - 80);
        }
        for (const other of cells) {
          if (other === c || other.age < 2 || c.r <= other.r * 1.25) continue;
          if (Math.hypot(c.x - other.x, c.y - other.y) < c.r - other.r * .4) {
            c.r = Math.sqrt(c.r * c.r + other.r * other.r * .5);
            respawn(other);
          }
        }
        // Gradual decay and new arrivals keep the scene balanced without a hard loop cut.
        c.r += (c.base - c.r) * dt * .035;
      }
    };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const scale = Math.min(width / W, height / H);
      ctx.translate((width - W * scale) / 2, (height - H * scale) / 2);
      ctx.scale(scale, scale);
      for (const f of food) {
        ctx.globalAlpha = .6; ctx.fillStyle = f.colour;
        ctx.beginPath(); ctx.arc(f.x, f.y, 2.8, 0, Math.PI * 2); ctx.fill();
      }
      for (const c of [...cells].sort((a, b) => a.r - b.r)) {
        ctx.globalAlpha = Math.min(1, c.age);
        const radius = c.r * (.94 + .06 * Math.min(1, c.age));
        const fill = ctx.createRadialGradient(c.x - radius * .3, c.y - radius * .35, 0, c.x, c.y, radius);
        fill.addColorStop(0, c.colour + 'AA'); fill.addColorStop(1, c.colour);
        ctx.fillStyle = fill; ctx.strokeStyle = c.colour; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(c.x, c.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#FFFFFF70'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, radius * .8, Math.PI * 1.14, Math.PI * 1.48); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    const tick = (now: number) => {
      if (disposed) return;
      if (now - last >= 1000 / 30) {
        update(last ? Math.min((now - last) / 1000, .05) : 0);
        last = now; draw();
      }
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(raf); last = 0;
      if (disposed) return;
      if (!motion.matches && visible && !document.hidden) raf = requestAnimationFrame(tick);
      else draw();
    };
    const resize = new ResizeObserver(() => {
      const box = canvas.getBoundingClientRect(); width = box.width; height = box.height;
      dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); draw();
    });
    resize.observe(canvas);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(canvas);
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      disposed = true; cancelAnimationFrame(raf); resize.disconnect(); observer.disconnect();
      motion.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return <canvas ref={ref} className="home-animation" role="img" aria-label={t.home.animation} data-testid="home-animation" />;
}
