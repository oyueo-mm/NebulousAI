import { useRef, useState, type MutableRefObject } from 'react';
import { t } from '../i18n';

const RADIUS = 52;

/**
 * On-screen joystick (bottom left) and split / eject buttons (bottom right) for touch devices.
 * Buttons stay pressable when the action is unavailable; the arena then explains why.
 */
export function TouchControls({ joystick, onSplit, onEject, splitReady, ejectReady }: {
  joystick: MutableRefObject<{ x: number; y: number; active: boolean }>;
  onSplit: () => void;
  onEject: () => void;
  splitReady: boolean;
  ejectReady: boolean;
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
  const button = 'flex touch-none select-none flex-col items-center justify-center rounded-full font-semibold text-white shadow-lg transition-opacity active:scale-95';
  return (
    <>
      <div
        ref={base} data-testid="joystick" role="application" aria-label={t.touch.joystick}
        className="absolute bottom-20 left-4 h-28 w-28 touch-none rounded-full bg-slate-900/10 ring-1 ring-slate-300 backdrop-blur-sm"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); update(e.clientX, e.clientY); }}
        onPointerMove={(e) => { if (joystick.current.active) update(e.clientX, e.clientY); }}
        onPointerUp={release} onPointerCancel={release}
      >
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-white shadow ring-1 ring-slate-300"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
      </div>
      <div className="absolute bottom-20 right-4 flex flex-col items-end gap-3">
        <button type="button" onPointerDown={(e) => { e.preventDefault(); onSplit(); }} data-testid="touch-split" data-ready={splitReady} aria-label={t.touch.splitAria}
          className={`${button} h-16 w-16 text-sm ${splitReady ? 'bg-indigo-500/90' : 'bg-slate-400/80'}`}>{t.touch.split}</button>
        <button type="button" onPointerDown={(e) => { e.preventDefault(); onEject(); }} data-testid="touch-eject" data-ready={ejectReady} aria-label={t.touch.ejectAria}
          className={`${button} mr-1 h-14 w-14 text-xs ${ejectReady ? 'bg-sky-500/90' : 'bg-slate-400/80'}`}>{t.touch.eject}</button>
      </div>
    </>
  );
}
