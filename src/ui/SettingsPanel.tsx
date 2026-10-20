import type { ReactNode } from 'react';
import type { MlpModelFile } from '../ai/rl';
import { POLICY_LABELS } from '../ai/types';
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
}

export function SettingsPanel({ mode, arena, onArena, ui, onUi, models, dirty, onApply, onSave, onLoad, inspector }: Props) {
  const set = <K extends keyof ArenaSettings>(k: K, v: ArenaSettings[K]) => onArena({ ...arena, [k]: v });
  const setPhys = (k: keyof ArenaSettings['physics'], v: number) => onArena({ ...arena, physics: { ...arena.physics, [k]: v } });
  const overlay = (k: keyof UiSettings['overlays'], v: boolean) => onUi({ ...ui, overlays: { ...ui.overlays, [k]: v } });
  const total = totalBots(arena);
  const hasModels = models.length > 0;
  return (
    <div className="flex h-full flex-col" data-testid="settings-panel">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {inspector && <Section title="Inspector">{inspector}</Section>}

        <Section title={mode === 'play' ? 'Opponents' : 'AI agents'} right={<span className="text-xs tabular-nums text-slate-400">{total}{mode === 'play' ? ' + you' : ''}</span>}>
          {BOT_KINDS.map((k) => (
            <Stepper key={k} label={POLICY_LABELS[k]} value={arena.bots[k]} dot={KIND_COLOURS[k]} testId={`count-${k}`}
              max={k === 'ppo' && !hasModels ? 0 : MAX_BOTS - total + arena.bots[k]}
              onChange={(v) => onArena({ ...arena, bots: { ...arena.bots, [k]: v } })} />
          ))}
          {hasModels ? (
            <>
              <label className="flex items-center justify-between gap-2 text-sm text-slate-700">
                <span>PPO model</span>
                <select value={arena.ppoModel} onChange={(e) => set('ppoModel', e.target.value)} data-testid="ppo-model"
                  className="max-w-40 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
                  {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.trained ? '' : ' (untrained)'}</option>)}
                </select>
              </label>
              <Toggle label="Deterministic PPO" hint="argmax instead of sampling" checked={arena.ppoDeterministic} onChange={(v) => set('ppoDeterministic', v)} />
            </>
          ) : <p className="text-xs text-slate-400">No exported PPO model found, so PPO agents are unavailable.</p>}
        </Section>

        <Section title="World">
          <NumberField label="Seed" value={arena.seed} min={0} max={4294967295} onChange={(v) => set('seed', Math.floor(v))} testId="seed" />
          <NumberField label="World size" value={arena.worldSize} min={1500} max={8000} step={250} onChange={(v) => set('worldSize', v)} suffix="wu" />
          <NumberField label="Max food" value={arena.foodMax} min={0} max={5000} step={50} onChange={(v) => set('foodMax', v)} />
          <NumberField label="Thorns" value={arena.thornCount} min={0} max={60} onChange={(v) => set('thornCount', v)} />
          <NumberField label="Time limit" value={arena.maxSeconds} min={0} max={3600} step={30} onChange={(v) => set('maxSeconds', v)} suffix="s" />
          <Toggle label="Respawn bots" checked={arena.respawn} onChange={(v) => set('respawn', v)} hint={mode === 'play' ? 'you never respawn — death ends your game' : undefined} />
          <NumberField label="AI decision interval" value={arena.decisionInterval} min={1} max={10} onChange={(v) => set('decisionInterval', v)} suffix="tk" />
        </Section>

        <Section title="Advanced physics" defaultOpen={false}>
          <NumberField label="Base speed" value={arena.physics.speedBase} min={50} max={600} step={10} onChange={(v) => setPhys('speedBase', v)} suffix="wu/s" />
          <NumberField label="Eat ratio" value={arena.physics.eatRatio} min={1.05} max={3} step={0.05} onChange={(v) => setPhys('eatRatio', v)} suffix="×" />
          <NumberField label="Split launch speed" value={arena.physics.splitSpeed} min={200} max={2000} step={50} onChange={(v) => setPhys('splitSpeed', v)} />
          <NumberField label="Mass decay" value={arena.physics.decayRate} min={0} max={0.05} step={0.001} onChange={(v) => setPhys('decayRate', v)} suffix="/s" />
          <NumberField label="Eject efficiency" value={arena.physics.ejectEfficiency} min={0} max={1} step={0.05} onChange={(v) => setPhys('ejectEfficiency', v)} />
          <NumberField label="Merge base time" value={arena.physics.mergeBase} min={1} max={60} onChange={(v) => setPhys('mergeBase', v)} suffix="s" />
          <NumberField label="Start mass" value={arena.physics.startMass} min={5} max={500} onChange={(v) => setPhys('startMass', v)} />
          <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => onArena({ ...arena, physics: { ...DEFAULT_PHYSICS } })}>Reset physics to rules-v1 defaults</button>
        </Section>

        <Section title="Overlays">
          <Toggle label="AI targets & threats" checked={ui.overlays.targets} onChange={(v) => overlay('targets', v)} testId="overlay-targets" />
          <Toggle label="Vision radius" checked={ui.overlays.vision} onChange={(v) => overlay('vision', v)} />
          <Toggle label="Risk heatmap" hint="heuristic dangerAt() of the inspected agent" checked={ui.overlays.heatmap} onChange={(v) => overlay('heatmap', v)} testId="overlay-heatmap" />
          <Toggle label="Names & mass" checked={ui.overlays.names} onChange={(v) => overlay('names', v)} />
        </Section>

        <Section title="Experiment">
          <div className="flex gap-2">
            <button type="button" onClick={onSave} data-testid="save-experiment" className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Save state</button>
            <label className="flex-1 cursor-pointer rounded-md border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-700 hover:bg-slate-50">
              Load…
              <input type="file" accept="application/json,.json" className="hidden" data-testid="load-experiment"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoad(f); e.target.value = ''; }} />
            </label>
          </div>
          <p className="text-[11px] text-slate-400">Saves settings, seed, rule version and the full game state (positions, RNG streams) as JSON.</p>
        </Section>
      </div>
      <div className="border-t border-slate-100 p-3">
        <button type="button" onClick={onApply} data-testid="apply-settings"
          className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${dirty ? 'bg-indigo-500 text-white hover:bg-indigo-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
          {dirty ? 'Apply & restart' : 'Restart with these settings'}
        </button>
      </div>
    </div>
  );
}
