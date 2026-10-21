import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { RULES_VERSION } from '../engine/config';
import type { MlpModelFile } from '../ai/rl';
import { t } from '../i18n';
import { Arena } from './Arena';
import { Badge, Logo, downloadText, formatTime } from './kit';
import { loadModels } from './models';
import { DEFAULT_UI, defaultArena, parseExperiment, toSetup, type ArenaSettings, type ExperimentFile, type Mode, type UiSettings } from './settings';
import { useSimulation } from './useSimulation';

// Chart-heavy pages load on demand so the game starts with a smaller bundle.
const TournamentView = lazy(() => import('./TournamentView').then((m) => ({ default: m.TournamentView })));
const LabView = lazy(() => import('./LabView').then((m) => ({ default: m.LabView })));

const MODES: Mode[] = ['play', 'watch', 'tournament', 'lab'];

function modeFromHash(): Mode {
  const h = window.location.hash.replace('#', '');
  return (MODES.includes(h as Mode) ? h : 'play') as Mode;
}

/** Drops PPO agents whose model is not available so a setup never references a missing model. */
function withAvailableModels(a: ArenaSettings, models: MlpModelFile[]): ArenaSettings {
  if (models.some((m) => m.id === a.ppoModel)) return a;
  if (models.length > 0) return { ...a, ppoModel: models[0].id };
  return { ...a, bots: { ...a.bots, ppo: 0 } };
}

export function App() {
  const sim = useSimulation();
  const [mode, setMode] = useState<Mode>(modeFromHash);
  const [models, setModels] = useState<MlpModelFile[] | null>(null);
  const [modelErrors, setModelErrors] = useState<string[]>([]);
  const [arena, setArena] = useState<Record<'play' | 'watch', ArenaSettings>>({ play: defaultArena('play', false), watch: defaultArena('watch', false) });
  const [applied, setApplied] = useState(arena);
  const [ui, setUi] = useState<UiSettings>(() => ({ ...DEFAULT_UI, rightOpen: window.innerWidth >= 1024, bottomOpen: false }));
  const [notice, setNotice] = useState<string | null>(null);
  const started = useRef<string>('');

  useEffect(() => {
    let first = true;
    void loadModels(import.meta.env.BASE_URL, ({ files, errors, defaultId }) => {
      setModels(files);
      setModelErrors(errors);
      if (!first) return; // later models only extend the choice; they never reset the running match
      first = false;
      const hasPpo = files.some((f) => f.trained);
      const preferred = files.find((f) => f.id === defaultId);
      const fresh = (m: 'play' | 'watch') => withAvailableModels({ ...defaultArena(m, hasPpo), ppoModel: preferred?.id ?? 'ppo-v1' }, files);
      const next = { play: fresh('play'), watch: fresh('watch') };
      setArena(next);
      setApplied(next);
    });
  }, []);

  useEffect(() => {
    const onHash = () => setMode(modeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const start = useCallback((m: 'play' | 'watch', settings: ArenaSettings) => {
    if (!models) return;
    sim.api.init(toSetup(m, withAvailableModels(settings, models)), models, true);
    sim.api.setSpeed(ui.speed);
  }, [models, sim.api, ui.speed]);

  // Start (or switch) the live match when entering Play / Watch; pause it on the analysis pages.
  useEffect(() => {
    if (!models) return;
    if (mode === 'play' || mode === 'watch') {
      if (started.current !== mode) { started.current = mode; start(mode, applied[mode]); }
      else sim.api.setRunning(true);
    } else {
      sim.api.setRunning(false);
    }
  }, [mode, models !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m: Mode) => {
    window.location.hash = m;
    setMode(m);
  };

  const restart = () => {
    if (mode !== 'play' && mode !== 'watch') return;
    const next = { ...applied, [mode]: arena[mode] };
    setApplied(next);
    start(mode, arena[mode]);
  };

  const save = async () => {
    if (mode !== 'play' && mode !== 'watch') return;
    const snapshot = await sim.api.save();
    const file: ExperimentFile = { format: 'nebulous-experiment', version: 1, rulesVersion: RULES_VERSION, savedAt: new Date().toISOString(), mode, arena: applied[mode], ui, snapshot };
    downloadText(`nebulous-${mode}-seed${applied[mode].seed}-t${Math.round(sim.ui.time)}.json`, JSON.stringify(file));
    setNotice(t.app.saved);
  };

  const load = async (f: File) => {
    try {
      const exp = parseExperiment(await f.text());
      if (!models) return;
      const settings = withAvailableModels(exp.arena, models);
      setArena((a) => ({ ...a, [exp.mode]: settings }));
      setApplied((a) => ({ ...a, [exp.mode]: settings }));
      setUi({ ...exp.ui, rightOpen: ui.rightOpen, bottomOpen: ui.bottomOpen });
      started.current = exp.mode;
      window.location.hash = exp.mode;
      setMode(exp.mode);
      if (exp.snapshot) sim.api.load(exp.snapshot, models); else start(exp.mode, settings);
      sim.api.setSpeed(exp.ui.speed);
      setNotice(exp.snapshot ? t.app.loadedState : t.app.loadedSettings);
    } catch (err) {
      setNotice(t.app.loadFailed(err instanceof Error ? err.message : String(err)));
    }
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const live = mode === 'play' || mode === 'watch';
  const aliveCount = sim.ui.agents.filter((a) => a.alive).length;
  const status = !live ? null : sim.ui.over ? <Badge tone="red">{t.app.status.finished}</Badge> : sim.ui.running ? <Badge tone="green">{t.app.status.running}</Badge> : <Badge tone="amber">{t.app.status.paused}</Badge>;

  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-800">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 md:px-4">
        <a href="#play" onClick={() => switchMode('play')} className="flex shrink-0 items-center gap-2" aria-label={t.app.home}>
          <Logo />
          <span className="hidden text-[15px] font-bold tracking-tight text-slate-900 sm:inline">Nebulous<span className="text-indigo-500">AI</span></span>
        </a>
        <nav className="flex min-w-0 flex-1 justify-center">
          <div className="flex gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-0.5" role="tablist">
            {MODES.map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} aria-label={t.app.modes[m]} onClick={() => switchMode(m)} data-testid={`mode-${m}`}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3.5 sm:text-sm pointer-coarse:py-2 ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                <span className="sm:hidden">{t.app.modesShort[m]}</span><span className="hidden sm:inline">{t.app.modes[m]}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="hidden items-center gap-3 text-xs text-slate-500 md:flex">
          {live && <span className="tabular-nums" data-testid="match-time">{formatTime(sim.ui.time)}</span>}
          {live && <span className="tabular-nums" data-testid="alive-count">{t.app.alive(aliveCount, sim.ui.agents.length)}</span>}
          {status}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {models === null && <div className="flex flex-1 items-center justify-center text-sm text-slate-400">{t.app.loading}</div>}
        {models !== null && live && (
          <Arena
            key={mode} mode={mode} sim={sim} models={models} arena={arena[mode]} applied={applied[mode]}
            onArena={(a) => setArena((s) => ({ ...s, [mode]: a }))} ui={ui} onUi={setUi} onRestart={restart} onSave={save} onLoad={load}
          />
        )}
        <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-slate-400">{t.app.loading}</div>}>
          {models !== null && mode === 'tournament' && <TournamentView models={models} />}
          {models !== null && mode === 'lab' && <LabView models={models} errors={modelErrors} />}
        </Suspense>
        {notice && <div className="absolute left-1/2 top-3 z-30 w-max max-w-[90%] -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-center text-sm text-white shadow-lg" role="status" data-testid="notice">{notice}</div>}
      </div>
    </div>
  );
}
