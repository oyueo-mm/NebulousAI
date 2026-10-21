import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_CONFIG } from '../engine/config';
import { visionRadius } from '../engine/physics';
import type { AgentAction } from '../engine/types';
import type { MlpModelFile } from '../ai/rl';
import { t } from '../i18n';
import { GameCanvas, type CanvasHandle } from './GameCanvas';
import { ControlsHelp, Onboarding, shouldShowOnboarding } from './Guides';
import { Inspector } from './Inspector';
import { agentLabel } from './labels';
import { Badge, IconButton, Stat, formatTime } from './kit';
import { SettingsPanel } from './SettingsPanel';
import type { ArenaSettings, UiSettings } from './settings';
import { SpeedControl } from './SpeedControl';
import { TouchControls } from './TouchControls';
import type { useSimulation } from './useSimulation';

const AnalyticsPanel = lazy(() => import('./AnalyticsPanel').then((m) => ({ default: m.AnalyticsPanel })));

interface Props {
  mode: 'play' | 'watch';
  sim: ReturnType<typeof useSimulation>;
  models: MlpModelFile[];
  arena: ArenaSettings;
  onArena: (a: ArenaSettings) => void;
  applied: ArenaSettings;
  ui: UiSettings;
  onUi: (u: UiSettings) => void;
  onRestart: () => void;
  onSave: () => void;
  onLoad: (file: File) => void;
}

function StatusPill({ ok, text, testId }: { ok: boolean; text: string; testId: string }) {
  return (
    <span data-testid={testId} data-ready={ok}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-400'}`} />{text}
    </span>
  );
}

export function Arena(props: Props) {
  const { mode, sim, ui, onUi } = props;
  const { agents, running, over, stats, inspect } = sim.ui;
  const humanId = mode === 'play' ? 0 : null;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [follow, setFollow] = useState<'selected' | 'leader' | 'free'>('leader');
  const [fps, setFps] = useState(0);
  const [help, setHelp] = useState(false);
  const [onboarding, setOnboarding] = useState(() => mode === 'play' && shouldShowOnboarding());
  const [hint, setHint] = useState<string | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const joystick = useRef({ x: 0, y: 0, active: false });
  const lastDir = useRef({ dx: 0, dy: 0 });
  const [touch] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
  const human = humanId !== null ? agents.find((a) => a.id === humanId) : undefined;
  const leader = useMemo(() => [...agents].sort((a, b) => a.rank - b.rank)[0], [agents]);
  const dialogOpen = help || onboarding;

  useEffect(() => { sim.api.inspect(selectedId, ui.overlays.heatmap); }, [selectedId, ui.overlays.heatmap, sim.api, sim.ready]);
  useEffect(() => { setSelectedId(null); }, [sim.ready]);
  // The first-visit guide keeps the game paused until the player chooses to start.
  useEffect(() => { if (onboarding) sim.api.setRunning(false); }, [onboarding, sim.ready, sim.api]);
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(null), 2600);
    return () => clearTimeout(id);
  }, [hint]);

  const followId = mode === 'play'
    ? (human?.alive ? humanId : leader?.id ?? null)
    : follow === 'free' ? null : follow === 'selected' ? selectedId : leader?.id ?? null;

  // Render FPS, measured on the main thread independently of the simulation rate.
  useEffect(() => {
    let raf = 0, n = 0, t0 = performance.now();
    const tick = (now: number) => {
      n++;
      if (now - t0 >= 1000) { setFps((n * 1000) / (now - t0)); n = 0; t0 = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const rules = sim.frames.current.curr?.world;
  const splitReason = (): string | null => {
    if (!human || !rules) return null;
    switch (human.splitStatus) {
      case 'cooldown': return t.hud.splitWhy.cooldown;
      case 'mass': return t.hud.splitWhy.mass(rules.minSplitMass, human.largestMass);
      case 'maxCells': return t.hud.splitWhy.maxCells(rules.maxCells);
      default: return null;
    }
  };
  const ejectReason = (): string | null => {
    if (!human || !rules) return null;
    if (human.ejectStatus === 'cooldown') return t.hud.ejectWhy.cooldown;
    if (human.ejectStatus === 'mass') return t.hud.ejectWhy.mass(rules.minEjectMass, human.largestMass);
    return null;
  };

  const sendInput = (a: AgentAction) => {
    if (humanId === null) return;
    lastDir.current = { dx: a.dx, dy: a.dy };
    sim.api.input(humanId, a);
  };
  // The engine stays the authority: requests are always sent; the hint only explains a likely rejection.
  const split = () => { const why = splitReason(); if (why) setHint(why); sendInput({ ...lastDir.current, split: true, eject: false }); };
  const eject = () => { const why = ejectReason(); if (why) setHint(why); sendInput({ ...lastDir.current, split: false, eject: true }); };
  const togglePause = () => sim.api.setRunning(!running);
  const startFromOnboarding = () => { setOnboarding(false); sim.api.setRunning(true); };

  // Keyboard shortcuts (movement keys are handled by the canvas).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (dialogOpen) {
        // Escape closes only the top-most dialog (help opened from the guide returns to the guide).
        if (e.code === 'Escape') { if (help) setHelp(false); else if (onboarding) startFromOnboarding(); }
        return;
      }
      if (e.repeat && (e.code === 'Space' || e.code === 'KeyE')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (mode === 'play') split(); else togglePause();
      } else if (e.code === 'KeyE' && mode === 'play') eject();
      else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
      else if (e.code === 'KeyR') props.onRestart();
      else if (e.code === 'Period' && !running) sim.api.stepOnce();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cfg = props.applied;
  const visionFor = useMemo(() => {
    const c = { ...DEFAULT_CONFIG, ...cfg.physics, worldWidth: cfg.worldSize, worldHeight: cfg.worldSize };
    return (mass: number) => visionRadius(mass, c);
  }, [cfg]);
  const dirty = JSON.stringify(props.arena) !== JSON.stringify(props.applied);
  const selectedAgent = agents.find((a) => a.id === selectedId);
  const gameOver = mode === 'play' && human && !human.alive;
  const setSpeed = (v: number) => { onUi({ ...ui, speed: v }); sim.api.setSpeed(v); };
  const selectAgent = (id: number) => { setSelectedId(id); if (mode === 'watch') setFollow('selected'); };
  const splitText = human ? t.hud[`split_${human.splitStatus === 'dead' ? 'mass' : human.splitStatus}`] : '';
  const ejectText = human ? t.hud[`eject_${human.ejectStatus === 'dead' ? 'mass' : human.ejectStatus}`] : '';
  const fit = () => { if (mode === 'watch') setFollow('free'); canvasRef.current?.fitWorld(); };
  const quickActions: ReactNode = (
    <div className="grid grid-cols-3 gap-2">
      {([[t.dock.restart, props.onRestart, 'quick-restart'], [t.dock.fit, fit, 'quick-fit'], [t.dock.analytics, () => onUi({ ...ui, bottomOpen: !ui.bottomOpen, rightOpen: false }), 'quick-analytics']] as const).map(([label, fn, id]) => (
        <button key={id} type="button" onClick={fn} data-testid={id} className="h-11 rounded-lg bg-slate-100 px-1 text-xs font-medium text-slate-700 hover:bg-slate-200">{label.replace(/ \(.\)$/, '')}</button>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[#f4f6fb]">
          <GameCanvas
            frames={sim.frames} humanId={humanId} followId={followId} selectedId={selectedId} overlays={ui.overlays} running={running}
            thornMass={DEFAULT_CONFIG.thornMass * DEFAULT_CONFIG.thornTriggerRatio} visionFor={visionFor} joystick={joystick}
            onSelect={(id) => { setSelectedId(id); if (id !== null && mode === 'watch') setFollow('selected'); if (id !== null && !ui.rightOpen) onUi({ ...ui, rightOpen: true }); }}
            onInput={sendInput} handle={canvasRef}
          />

          {mode === 'play' && human && (
            <div className="pointer-events-none absolute left-2 top-2 rounded-xl bg-white/85 px-3 py-2 shadow-sm ring-1 ring-slate-200 backdrop-blur sm:left-3 sm:top-3 sm:px-3.5 sm:py-2.5" data-testid="hud">
              <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 sm:grid-cols-7">
                <Stat label={t.hud.mass} value={<span data-testid="hud-mass">{Math.round(human.mass)}</span>} />
                <Stat label={t.hud.rank} value={`${human.rank}/${agents.length}`} />
                <Stat label={t.hud.alive} value={formatTime(human.survival)} />
                <div className="hidden sm:block"><Stat label={t.hud.cells} value={<span data-testid="hud-cells">{human.cells}</span>} /></div>
                <div className="hidden sm:block"><Stat label={t.hud.kills} value={human.kills} /></div>
                <div className="hidden sm:block"><Stat label={t.hud.eaten} value={human.cellsEaten} /></div>
                <div className="hidden sm:block"><Stat label={t.hud.speed} value={`${Math.round(human.speed)}`} sub="wu/s" /></div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <StatusPill ok={human.splitStatus === 'ready'} text={splitText} testId="status-split" />
                <StatusPill ok={human.ejectStatus === 'ready'} text={ejectText} testId="status-eject" />
                {!running && !gameOver && !dialogOpen && <StatusPill ok={false} text={t.hud.paused} testId="status-paused" />}
              </div>
            </div>
          )}

          <div className="pointer-events-auto absolute right-3 top-3 hidden w-52 rounded-xl bg-white/85 p-2.5 text-xs shadow-sm ring-1 ring-slate-200 backdrop-blur md:block" data-testid="mini-leaderboard">
            <div className="mb-1 font-semibold text-slate-500">{t.leaderboard.title}</div>
            {[...agents].sort((a, b) => a.rank - b.rank).slice(0, 8).map((a) => (
              <button type="button" key={a.id} onClick={() => selectAgent(a.id)} title={agentLabel(a)}
                className={`flex w-full items-center justify-between rounded px-1 py-0.5 text-left hover:bg-slate-100 ${a.id === humanId ? 'font-semibold text-slate-900' : 'text-slate-600'} ${a.alive ? '' : 'opacity-40'}`}>
                <span className="truncate"><span className="mr-1 tabular-nums text-slate-400">{a.rank}.</span>
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: `hsl(${a.hue} 72% 62%)` }} />{a.name}</span>
                <span className="tabular-nums">{Math.round(a.mass)}</span>
              </button>
            ))}
          </div>

          {gameOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/40 p-4 backdrop-blur-[2px]" data-testid="game-over">
              <div className="w-full max-w-80 rounded-2xl bg-white p-5 text-center shadow-xl ring-1 ring-slate-200">
                <div className="text-lg font-bold text-slate-900">{t.gameOver.title}</div>
                <div className="mt-0.5 text-sm text-slate-500">{human.killedBy >= 0 && agents[human.killedBy] ? t.gameOver.by(agents[human.killedBy].name, agentLabel(agents[human.killedBy])) : t.gameOver.over}</div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-left">
                  <Stat label={t.gameOver.survived} value={formatTime(human.survival)} />
                  <Stat label={t.gameOver.peak} value={Math.round(human.maxMass)} />
                  <Stat label={t.gameOver.kills} value={human.kills} />
                </div>
                <button type="button" onClick={props.onRestart} data-testid="restart" className="mt-5 h-11 w-full rounded-lg bg-indigo-500 text-sm font-semibold text-white hover:bg-indigo-600">{t.gameOver.again}</button>
                <p className="mt-2 text-[11px] text-slate-400">{t.gameOver.note}</p>
              </div>
            </div>
          )}

          {over && mode === 'watch' && leader && (
            <div className="pointer-events-none absolute left-1/2 top-4 max-w-[90%] -translate-x-1/2 rounded-full bg-slate-900/80 px-4 py-1.5 text-center text-sm text-white" data-testid="match-over">
              {t.matchOver(leader.name, agentLabel(leader))}
            </div>
          )}

          {sim.error && <div className="absolute left-1/2 top-16 max-w-[90%] -translate-x-1/2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200" role="alert">{sim.error}</div>}

          {hint && (
            <div className="pointer-events-none absolute bottom-20 left-1/2 z-20 w-max max-w-[90%] -translate-x-1/2 rounded-lg bg-slate-900/85 px-3 py-2 text-center text-sm text-white shadow-lg sm:bottom-24" role="status" data-testid="action-hint">
              {hint}
            </div>
          )}

          {touch && mode === 'play' && !gameOver && (
            <TouchControls joystick={joystick} onSplit={split} onEject={eject}
              splitReady={human?.splitStatus === 'ready'} ejectReady={human?.ejectStatus === 'ready'} />
          )}

          <div className="absolute bottom-2 left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-xl bg-white/90 p-1 shadow-md ring-1 ring-slate-200 backdrop-blur sm:bottom-3 sm:gap-1" data-testid="dock">
            <IconButton label={running ? t.dock.pause : sim.ui.tick > 0 ? t.dock.resume : t.dock.play} onClick={togglePause} active={running} testId="play-pause">{running ? '❚❚' : '▶'}</IconButton>
            <IconButton label={t.dock.step} onClick={() => sim.api.stepOnce()} disabled={running} testId="step" className={mode === 'play' ? 'hidden sm:flex' : ''}>⏭</IconButton>
            <IconButton label={t.dock.restart} onClick={props.onRestart} testId="reset" className={mode === 'watch' ? 'hidden sm:flex' : ''}>↺</IconButton>
            {mode === 'play' && (
              <IconButton label={t.dock.controls} onClick={() => setHelp(true)} testId="controls-button">
                <span aria-hidden="true">?</span><span className="hidden text-xs lg:inline">{t.dock.controls}</span>
              </IconButton>
            )}
            <div className="mx-0.5 hidden h-5 w-px bg-slate-200 sm:block" />
            <SpeedControl value={ui.speed} actual={stats?.speedActual ?? 0} running={running} onChange={setSpeed} />
            {mode === 'watch' && (
              <select aria-label={t.dock.camera} value={follow === 'selected' ? `a${selectedId}` : follow} data-testid="follow"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'leader' || v === 'free') setFollow(v);
                  else selectAgent(Number(v.slice(1)));
                }}
                className="h-9 w-24 shrink rounded-lg bg-transparent px-1 text-sm text-slate-700 hover:bg-slate-100 sm:w-auto sm:max-w-36 pointer-coarse:h-11">
                <option value="leader">{t.dock.followLeader}</option>
                <option value="free">{t.dock.freeCamera}</option>
                {agents.map((a) => <option key={a.id} value={`a${a.id}`}>{t.dock.follow(a.name)}</option>)}
              </select>
            )}
            <IconButton label={t.dock.fit} onClick={fit} testId="fit" className="hidden sm:flex">⤢</IconButton>
            <div className="mx-0.5 hidden h-5 w-px bg-slate-200 sm:block" />
            <IconButton label={t.dock.analytics} onClick={() => onUi({ ...ui, bottomOpen: !ui.bottomOpen })} active={ui.bottomOpen} testId="toggle-bottom" className="hidden sm:flex">▤</IconButton>
            <IconButton label={t.dock.settings} onClick={() => onUi({ ...ui, rightOpen: !ui.rightOpen })} active={ui.rightOpen} testId="toggle-right">⚙</IconButton>
          </div>

          {!gameOver && (
            <div className="pointer-events-none absolute bottom-16 left-3 hidden text-[11px] text-slate-400 lg:block">
              {mode === 'play' ? t.hints.play : t.hints.watch}
            </div>
          )}
        </div>
        {ui.bottomOpen && (
          <div className="h-56 shrink-0 border-t border-slate-200 bg-white sm:h-64">
            <Suspense fallback={null}><AnalyticsPanel agents={agents} history={sim.history} log={sim.log} stats={stats} fps={fps} selectedId={selectedId} onSelect={selectAgent} /></Suspense>
          </div>
        )}
      </div>
      {ui.rightOpen && (
        // Narrow screens: the drawer covers the dock, so a backdrop tap or its close button dismisses it.
        <div className="absolute inset-0 z-20 bg-slate-900/20 md:hidden" onClick={() => onUi({ ...ui, rightOpen: false })} data-testid="drawer-backdrop" />
      )}
      {ui.rightOpen && (
        <aside className="absolute inset-y-0 right-0 z-20 w-[min(20rem,88vw)] border-l border-slate-200 bg-white shadow-xl md:static md:z-auto md:shadow-none">
          <SettingsPanel onClose={() => onUi({ ...ui, rightOpen: false })}
            mode={mode} arena={props.arena} onArena={props.onArena} ui={ui} onUi={onUi} models={props.models} dirty={dirty}
            onApply={props.onRestart} onSave={props.onSave} onLoad={props.onLoad} quick={quickActions}
            inspector={selectedAgent ? <Inspector detail={inspect} agent={selectedAgent} onClose={() => setSelectedId(null)} /> : mode === 'watch' ? <p className="text-xs text-slate-400">{t.hints.inspectPrompt}</p> : null}
          />
        </aside>
      )}
      {!running && !over && !gameOver && !dialogOpen && sim.ui.tick > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2"><Badge tone="amber">{t.app.status.paused}</Badge></div>
      )}
      {help && <ControlsHelp onClose={() => setHelp(false)} touch={touch} />}
      {onboarding && !help && <Onboarding onStart={startFromOnboarding} onShowControls={() => setHelp(true)} />}
    </div>
  );
}
