import { useState, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import { SPEED_MAX, SPEED_MAX_MODE, SPEED_MIN, sliderToSpeed, speedToSlider } from './settings';

const STEPS = 1000;
const QUICK = [0.5, 1, 2, 5, 10];

interface Props {
  /** Target speed; SPEED_MAX_MODE means "Max" (as fast as possible). */
  value: number;
  /** Measured simulated seconds per real second, from the worker (0 while paused). */
  actual: number;
  running: boolean;
  onChange: (speed: number) => void;
}

/** Slider position (0 … STEPS) → speed, snapping to exactly 1× near it so returning to real time is easy. */
function positionToSpeed(pos: number): number {
  const s = sliderToSpeed(pos / STEPS);
  return Math.abs(Math.log(s)) < 0.025 ? 1 : Number(s.toPrecision(3));
}

function RangeInput({ value, onChange, large = false }: { value: number; onChange: (s: number) => void; large?: boolean }) {
  const isMax = value >= SPEED_MAX_MODE;
  const pos = Math.round(speedToSlider(isMax ? SPEED_MAX : value) * STEPS);
  const nudge = (delta: number) => onChange(positionToSpeed(Math.min(STEPS, Math.max(0, pos + delta))));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const step = STEPS / 40, page = STEPS / 10;
    const map: Record<string, () => void> = {
      ArrowRight: () => nudge(step), ArrowUp: () => nudge(step), ArrowLeft: () => nudge(-step), ArrowDown: () => nudge(-step),
      PageUp: () => nudge(page), PageDown: () => nudge(-page), Home: () => onChange(SPEED_MIN), End: () => onChange(SPEED_MAX),
    };
    const fn = map[e.key];
    if (fn) { e.preventDefault(); e.stopPropagation(); fn(); }
  };
  return (
    <input
      type="range" min={0} max={STEPS} step={1} value={pos} aria-label={t.speed.aria} data-testid={large ? 'speed-slider-sheet' : 'speed-slider'}
      aria-valuetext={isMax ? t.speed.max : t.speed.value(value)}
      onChange={(e) => onChange(positionToSpeed(Number(e.target.value)))} onKeyDown={onKey}
      className={`speed-range ${large ? 'speed-range-lg w-full' : 'w-28 lg:w-36'} ${isMax ? 'opacity-50' : ''}`}
    />
  );
}

function Readout({ value, actual, running }: Omit<Props, 'onChange'>) {
  const isMax = value >= SPEED_MAX_MODE;
  const behind = running && !isMax && actual > 0 && actual < value * 0.9;
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="text-sm font-semibold tabular-nums text-slate-800" data-testid="speed-value">{isMax ? t.speed.max : t.speed.value(value)}</span>
      {running && (isMax || behind) && (
        <span className={`text-[10px] tabular-nums ${behind ? 'text-amber-600' : 'text-slate-400'}`} data-testid="speed-actual">
          {t.speed.actual} {t.speed.value(actual)}
        </span>
      )}
    </span>
  );
}

/**
 * Speed control for the dock: an inline log-scale slider on wide screens, a chip that opens a large
 * slider sheet on phones. Changing speed only changes how many fixed ticks run per real second.
 */
export function SpeedControl(props: Props) {
  const [open, setOpen] = useState(false);
  const { value, onChange } = props;
  const isMax = value >= SPEED_MAX_MODE;
  return (
    <div className="relative flex items-center">
      {/* Wide screens with a fine pointer: label · slider · value · 1× · MAX */}
      <div className="speed-inline items-center gap-2 px-1">
        <span className="whitespace-nowrap text-xs font-medium text-slate-500">{t.speed.label}</span>
        <RangeInput value={value} onChange={onChange} />
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-14 rounded-md px-1 py-0.5 text-right hover:bg-slate-100" aria-label={t.speed.sheetTitle} aria-expanded={open}>
          <Readout {...props} />
        </button>
        <button type="button" onClick={() => onChange(1)} data-testid="speed-reset" title={t.speed.reset}
          className={`h-7 rounded-md px-1.5 text-xs font-medium ${value === 1 ? 'text-slate-300' : 'text-indigo-600 hover:bg-indigo-50'}`}>1×</button>
        <button type="button" onClick={() => onChange(isMax ? 1 : SPEED_MAX_MODE)} data-testid="speed-max" aria-pressed={isMax} title={t.speed.maxNote}
          className={`h-7 rounded-md px-1.5 text-xs font-semibold ${isMax ? 'bg-indigo-500 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>{t.speed.maxShort}</button>
      </div>
      {/* Phones and other touch screens: a chip that opens the large slider sheet */}
      <button type="button" onClick={() => setOpen((o) => !o)} data-testid="speed-chip" aria-label={t.speed.sheetTitle} aria-expanded={open}
        className="speed-chip h-11 min-w-14 items-center justify-center rounded-lg px-2 text-sm font-semibold tabular-nums text-slate-700 hover:bg-slate-100">
        {isMax ? t.speed.maxShort : t.speed.value(value)}
      </button>
      {open && <SpeedSheet {...props} onClose={() => setOpen(false)} />}
    </div>
  );
}

function SpeedSheet({ value, actual, running, onChange, onClose }: Props & { onClose: () => void }) {
  const isMax = value >= SPEED_MAX_MODE;
  return (
    <div className="fixed inset-x-2 bottom-20 z-40 rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-slate-200 sm:absolute sm:inset-x-auto sm:bottom-full sm:left-1/2 sm:mb-3 sm:w-80 sm:-translate-x-1/2"
      data-testid="speed-sheet" role="dialog" aria-label={t.speed.sheetTitle}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">{t.speed.sheetTitle}</span>
        <button type="button" onClick={onClose} aria-label={t.speed.close} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 pointer-coarse:h-11 pointer-coarse:w-11">✕</button>
      </div>
      {/* The value sits above the slider so a finger on the thumb never hides it. */}
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-xs text-slate-500">{t.speed.target}</span>
        <span className="text-2xl font-bold tabular-nums text-slate-900" data-testid="speed-sheet-value">{isMax ? t.speed.max : t.speed.value(value)}</span>
      </div>
      <div className="mt-2 py-2"><RangeInput value={value} onChange={onChange} large /></div>
      <div className="flex justify-between text-[10px] text-slate-400"><span>{t.speed.value(SPEED_MIN)}</span><span>{t.speed.value(SPEED_MAX)}</span></div>
      <div className="mt-3 grid grid-cols-6 gap-1.5">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => onChange(q)} data-testid={`speed-quick-${q}`}
            className={`h-11 rounded-lg text-sm font-medium tabular-nums ${!isMax && value === q ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{q}×</button>
        ))}
        <button type="button" onClick={() => onChange(SPEED_MAX_MODE)} data-testid="speed-quick-max" aria-pressed={isMax}
          className={`h-11 rounded-lg text-xs font-semibold ${isMax ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{t.speed.maxShort}</button>
      </div>
      <div className="mt-3 space-y-1 text-[11px] leading-snug text-slate-500">
        {running && <p data-testid="speed-sheet-actual">{t.speed.actual}: <span className="font-medium tabular-nums text-slate-700">{t.speed.value(actual)}</span>{!isMax && actual > 0 && actual < value * 0.9 && <span className="text-amber-600"> — {t.speed.behind(actual)}</span>}</p>}
        {!running && <p>{t.speed.pausedNote}</p>}
        {isMax && <p>{t.speed.maxNote}</p>}
      </div>
    </div>
  );
}
