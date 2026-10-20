import { useRef, useState, type MutableRefObject } from 'react';

const RADIUS = 56;

/** On-screen joystick (left) and split / eject buttons (right) for touch devices. */
export function TouchControls({ joystick, onSplit, onEject }: {
  joystick: MutableRefObject<{ x: number; y: number; active: boolean }>;
  onSplit: () => void;
  onEject: () => void;
}) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const update = (clientX: number, clientY: number) => {
    const rect = base.current!.getBoundingClientRect();
    let dx = clientX - (rect.left + rect.width / 2);
    let dy = clientY - (rect.top + rect.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > RADIUS) { dx *= RADIUS / l; dy *= RADIUS / l; }
    setKnob({ x: dx, y: dy });
    joystick.current = { x: dx / RADIUS, y: dy / RADIUS, active: true };
  };
  const release = () => {
    setKnob({ x: 0, y: 0 });
    joystick.current = { x: 0, y: 0, active: false };
  };
  return (
    <>
      <div
        ref={base} data-testid="joystick"
        className="absolute bottom-20 left-6 h-32 w-32 touch-none rounded-full bg-slate-900/10 ring-1 ring-slate-300 backdrop-blur-sm"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); update(e.clientX, e.clientY); }}
        onPointerMove={(e) => { if (joystick.current.active) update(e.clientX, e.clientY); }}
        onPointerUp={release} onPointerCancel={release}
      >
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-white shadow ring-1 ring-slate-300"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
      </div>
      <div className="absolute bottom-20 right-6 flex flex-col gap-3">
        <button type="button" onPointerDown={(e) => { e.preventDefault(); onSplit(); }} data-testid="touch-split"
          className="h-16 w-16 touch-none rounded-full bg-indigo-500/90 text-sm font-semibold text-white shadow-lg active:scale-95">Split</button>
        <button type="button" onPointerDown={(e) => { e.preventDefault(); onEject(); }} data-testid="touch-eject"
          className="h-14 w-14 touch-none self-end rounded-full bg-sky-500/90 text-xs font-semibold text-white shadow-lg active:scale-95">Eject</button>
      </div>
    </>
  );
}
