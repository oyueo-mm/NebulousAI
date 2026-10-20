import { useState, type ReactNode } from 'react';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id="nb-core" cx="40%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#a5b4fc" />
          <stop offset="55%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#4338ca" />
        </radialGradient>
      </defs>
      <circle cx="14" cy="17" r="10.5" fill="url(#nb-core)" />
      <circle cx="14" cy="17" r="10.5" fill="none" stroke="#3730a3" strokeWidth="1.2" />
      <circle cx="25.5" cy="7.5" r="3.6" fill="#38bdf8" stroke="#0369a1" strokeWidth="1" />
      <circle cx="27" cy="18.5" r="2" fill="#34d399" stroke="#047857" strokeWidth="0.8" />
      <path d="M7 13.5c2.5-2.8 7.4-3.4 10.6-1.2" fill="none" stroke="#e0e7ff" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-slate-100 px-4 py-3">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-800">
          <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          {title}
        </button>
        {right}
      </div>
      {open && <div className="mt-2.5 space-y-2.5">{children}</div>}
    </section>
  );
}

export function Toggle({ label, checked, onChange, hint, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testId?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 text-sm text-slate-700">
      <span>
        {label}
        {hint && <span className="block text-[11px] leading-tight text-slate-400">{hint}</span>}
      </span>
      <button
        type="button" role="switch" aria-checked={checked} aria-label={label} data-testid={testId} onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-indigo-500' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export function NumberField({ label, value, onChange, min, max, step = 1, testId, suffix }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; testId?: string; suffix?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
      <span className="truncate">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} data-testid={testId}
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); }}
          className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        {suffix && <span className="w-6 text-xs text-slate-400">{suffix}</span>}
      </span>
    </label>
  );
}

export function Stepper({ label, value, onChange, min = 0, max = 64, dot, testId }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; dot?: string; testId?: string }) {
  return (
    <div className="flex items-center justify-between text-sm text-slate-700">
      <span className="flex items-center gap-2">
        {dot && <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />}
        {label}
      </span>
      <span className="flex items-center rounded-md border border-slate-200">
        <button type="button" aria-label={`fewer ${label}`} className="px-2 py-0.5 text-slate-500 hover:bg-slate-50 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
        <span className="w-7 text-center tabular-nums" data-testid={testId}>{value}</span>
        <button type="button" aria-label={`more ${label}`} className="px-2 py-0.5 text-slate-500 hover:bg-slate-50 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
      </span>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className="truncate text-sm font-semibold tabular-nums text-slate-800">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'violet' | 'red' | 'blue' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200', red: 'bg-rose-50 text-rose-700 ring-rose-200', blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-transparent ${tones[tone]}`}>{children}</span>;
}

export function IconButton({ label, onClick, children, active, disabled, testId }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean; testId?: string }) {
  return (
    <button
      type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} data-testid={testId}
      className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors disabled:opacity-40 ${active ? 'bg-indigo-500 text-white hover:bg-indigo-600' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

export const KIND_COLOURS: Record<string, string> = {
  human: '#0f172a', random: '#94a3b8', greedy: '#f59e0b', survival: '#10b981', aggressive: '#ef4444', hybrid: '#6366f1', ppo: '#8b5cf6', external: '#64748b',
};

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function downloadText(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
