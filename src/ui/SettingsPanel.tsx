import { useState, type ReactNode } from 'react';
import type { MlpModelFile } from '../ai/rl';
import { t } from '../i18n';
import { BOT_KINDS, DEFAULT_PHYSICS, MAX_BOTS, totalBots, type ArenaSettings, type UiSettings } from './settings';
import { KIND_COLOURS, NumberField, Section, Stepper, Toggle } from './kit';

interface Props {
  mode: 'play' | 'watch';
  arena: ArenaSettings;
  onArena: (a: ArenaSettings) => void;
  ui: UiSettings;
  onUi: (u: UiSettings) => void;
  models: MlpModelFile[];
  dirty: boolean;
  onApply: () => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  inspector: ReactNode;
  /** Actions that do not fit the phone dock (restart, fit, analytics). */
  quick: ReactNode;
  onClose: () => void;
}

/** Display name of an exported model (model files themselves are never modified). */
export function modelLabel(m: MlpModelFile): string {
  const label = t.models.label(m.id, m.label);
  return label === m.label && !m.trained ? `${label}${t.models.untrainedSuffix}` : label;
}

export function SettingsPanel({ mode, arena, onArena, ui, onUi, models, dirty, onApply, onSave, onLoad, inspector, quick, onClose }: Props) {
  const s = t.settings;
  const set = <K extends keyof ArenaSettings>(k: K, v: ArenaSettings[K]) => onArena({ ...arena, [k]: v });
  const setPhys = (k: keyof ArenaSettings['physics'], v: number) => onArena({ ...arena, physics: { ...arena.physics, [k]: v } });
  const overlay = (k: keyof UiSettings['overlays'], v: boolean) => onUi({ ...ui, overlays: { ...ui.overlays, [k]: v } });
  const total = totalBots(arena);
  const hasModels = models.length > 0;
  // Phones: keep the panel short — only the agents section starts open.
  const [phone] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches);
  return (
    <div className="flex h-full flex-col" data-testid="settings-panel">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 lg:hidden">
          <span className="text-sm font-semibold text-slate-800">{t.dock.settings}</span>
          <button type="button" onClick={onClose} aria-label={s.close} data-testid="close-settings"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>
        <div className="border-b border-slate-100 px-4 py-3 sm:hidden">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{s.quick}</div>
          {quick}
        </div>
        {inspector && <Section title={s.inspector}>{inspector}</Section>}

        <Section title={mode === 'play' ? s.opponents : s.agents} right={<span className="text-xs tabular-nums text-slate-400"><span data-testid="bot-total">{total}</span>{mode === 'play' ? s.plusYou : ''}</span>}>
          {BOT_KINDS.map((k) => (
            <Stepper key={k} label={t.policy.name(k)} value={arena.bots[k]} dot={KIND_COLOURS[k]} testId={`count-${k}`}
              max={k === 'ppo' && !hasModels ? 0 : MAX_BOTS - total + arena.bots[k]}
              onChange={(v) => onArena({ ...arena, bots: { ...arena.bots, [k]: v } })} />
          ))}
          {hasModels ? (
            <>
              <label className="flex items-center justify-between gap-2 text-sm text-slate-700">
                <span className="shrink-0">{s.ppoModel}</span>
                <select value={arena.ppoModel} onChange={(e) => set('ppoModel', e.target.value)} data-testid="ppo-model"
                  className="min-w-0 max-w-44 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm pointer-coarse:py-2">
                  {models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
                </select>
              </label>
              <Toggle label={s.deterministic} hint={s.deterministicHint} checked={arena.ppoDeterministic} onChange={(v) => set('ppoDeterministic', v)} />
            </>
          ) : <p className="text-xs text-slate-400">{s.noModels}</p>}
        </Section>

        <Section title={s.world} defaultOpen={!phone}>
          <NumberField label={s.seed} value={arena.seed} min={0} max={4294967295} onChange={(v) => set('seed', Math.floor(v))} testId="seed" />
          <NumberField label={s.worldSize} value={arena.worldSize} min={1500} max={8000} step={250} onChange={(v) => set('worldSize', v)} suffix="wu" />
          <NumberField label={s.maxFood} value={arena.foodMax} min={0} max={5000} step={50} onChange={(v) => set('foodMax', v)} />
          <NumberField label={s.thorns} value={arena.thornCount} min={0} max={60} onChange={(v) => set('thornCount', v)} />
          <NumberField label={s.timeLimit} value={arena.maxSeconds} min={0} max={3600} step={30} onChange={(v) => set('maxSeconds', v)} suffix={s.unitSeconds} />
          <Toggle label={s.respawn} checked={arena.respawn} onChange={(v) => set('respawn', v)} hint={mode === 'play' ? s.respawnHint : undefined} />
          <NumberField label={s.decisionInterval} value={arena.decisionInterval} min={1} max={10} onChange={(v) => set('decisionInterval', v)} suffix={s.unitTicks} />
        </Section>

        <Section title={s.physics} defaultOpen={false}>
          <NumberField label={s.speedBase} value={arena.physics.speedBase} min={50} max={600} step={10} onChange={(v) => setPhys('speedBase', v)} suffix="wu/s" />
          <NumberField label={s.eatRatio} value={arena.physics.eatRatio} min={1.05} max={3} step={0.05} onChange={(v) => setPhys('eatRatio', v)} suffix="×" />
          <NumberField label={s.splitSpeed} value={arena.physics.splitSpeed} min={200} max={2000} step={50} onChange={(v) => setPhys('splitSpeed', v)} />
          <NumberField label={s.decayRate} value={arena.physics.decayRate} min={0} max={0.05} step={0.001} onChange={(v) => setPhys('decayRate', v)} suffix="/s" />
          <NumberField label={s.ejectEfficiency} value={arena.physics.ejectEfficiency} min={0} max={1} step={0.05} onChange={(v) => setPhys('ejectEfficiency', v)} />
          <NumberField label={s.mergeBase} value={arena.physics.mergeBase} min={1} max={60} onChange={(v) => setPhys('mergeBase', v)} suffix={s.unitSeconds} />
          <NumberField label={s.startMass} value={arena.physics.startMass} min={5} max={500} onChange={(v) => setPhys('startMass', v)} />
          <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => onArena({ ...arena, physics: { ...DEFAULT_PHYSICS } })}>{s.resetPhysics}</button>
        </Section>

        <Section title={s.overlays}>
          <Toggle label={s.targets} checked={ui.overlays.targets} onChange={(v) => overlay('targets', v)} testId="overlay-targets" />
          <Toggle label={s.vision} checked={ui.overlays.vision} onChange={(v) => overlay('vision', v)} />
          <Toggle label={s.heatmap} hint={s.heatmapHint} checked={ui.overlays.heatmap} onChange={(v) => overlay('heatmap', v)} testId="overlay-heatmap" />
          <Toggle label={s.names} checked={ui.overlays.names} onChange={(v) => overlay('names', v)} />
        </Section>

        <Section title={s.experiment} defaultOpen={!phone}>
          <div className="flex gap-2">
            <button type="button" onClick={onSave} data-testid="save-experiment" className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 pointer-coarse:py-2.5">{s.save}</button>
            <label className="flex-1 cursor-pointer rounded-md border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-700 hover:bg-slate-50 pointer-coarse:py-2.5">
              {s.load}
              <input type="file" accept="application/json,.json" className="hidden" data-testid="load-experiment"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoad(f); e.target.value = ''; }} />
            </label>
          </div>
          <p className="text-[11px] text-slate-400">{s.experimentHint}</p>
        </Section>
      </div>
      <div className="border-t border-slate-100 p-3">
        <button type="button" onClick={onApply} data-testid="apply-settings"
          className={`h-10 w-full rounded-lg px-3 text-sm font-semibold transition-colors pointer-coarse:h-11 ${dirty ? 'bg-indigo-500 text-white hover:bg-indigo-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
          {dirty ? s.apply : s.restart}
        </button>
      </div>
    </div>
  );
}
