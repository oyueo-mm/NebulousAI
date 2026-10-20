import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CONFIG } from '../engine/config';
import { visionRadius } from '../engine/physics';
import type { AgentAction } from '../engine/types';
import type { MlpModelFile } from '../ai/rl';
import { AnalyticsPanel } from './AnalyticsPanel';
import { GameCanvas, type CanvasHandle } from './GameCanvas';
import { Inspector } from './Inspector';
import { Badge, IconButton, Stat, formatTime } from './kit';
import { SettingsPanel } from './SettingsPanel';
import type { ArenaSettings, UiSettings } from './settings';
import { TouchControls } from './TouchControls';
import type { useSimulation } from './useSimulation';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 1000];

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

export function Arena(props: Props) {
  const { mode, sim, ui, onUi } = props;
  const { agents, running, over, stats, inspect } = sim.ui;
  const humanId = mode === 'play' ? 0 : null;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [follow, setFollow] = useState<'selected' | 'leader' | 'free'>('leader');
  const [fps, setFps] = useState(0);
  const canvasRef = useRef<CanvasHandle>(null);
  const joystick = useRef({ x: 0, y: 0, active: false });
  const lastDir = useRef({ dx: 0, dy: 0 });
  const [touch] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
  const human = humanId !== null ? agents.find((a) => a.id === humanId) : undefined;
  const leader = useMemo(() => [...agents].sort((a, b) => a.rank - b.rank)[0], [agents]);

  useEffect(() => { sim.api.inspect(selectedId, ui.overlays.heatmap); }, [selectedId, ui.overlays.heatmap, sim.api, sim.ready]);
  useEffect(() => { setSelectedId(null); }, [sim.ready]);

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

  const sendInput = (a: AgentAction) => {
    if (humanId === null) return;
    lastDir.current = { dx: a.dx, dy: a.dy };
    sim.api.input(humanId, a);
  };
  const split = () => sendInput({ ...lastDir.current, split: true, eject: false });
  const eject = () => sendInput({ ...lastDir.current, split: false, eject: true });

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat && (e.code === 'Space' || e.code === 'KeyE')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (mode === 'play') split(); else sim.api.setRunning(!running);
      } else if (e.code === 'KeyE' && mode === 'play') eject();
      else if (e.code === 'KeyP' || e.code === 'Escape') sim.api.setRunning(!running);
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

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 bg-[#f4f6fb]">
          <GameCanvas
            frames={sim.frames} humanId={humanId} followId={followId} selectedId={selectedId} overlays={ui.overlays} running={running}
            thornMass={DEFAULT_CONFIG.thornMass * DEFAULT_CONFIG.thornTriggerRatio} visionFor={visionFor} joystick={joystick}
            onSelect={(id) => { setSelectedId(id); if (id !== null && mode === 'watch') setFollow('selected'); if (id !== null && !ui.rightOpen) onUi({ ...ui, rightOpen: true }); }}
            onInput={sendInput} handle={canvasRef}
          />

          {mode === 'play' && human && (
            <div className="pointer-events-none absolute left-3 top-3 grid grid-cols-4 gap-x-4 gap-y-1.5 rounded-xl bg-white/85 px-3.5 py-2.5 shadow-sm ring-1 ring-slate-200 backdrop-blur sm:grid-cols-8" data-testid="hud">
              <Stat label="Mass" value={<span data-testid="hud-mass">{Math.round(human.mass)}</span>} />
              <Stat label="Rank" value={`${human.rank}/${agents.length}`} />
              <Stat label="Cells" value={human.cells} />
              <Stat label="Kills" value={human.kills} />
              <Stat label="Eaten" value={human.cellsEaten} />
              <Stat label="Alive" value={formatTime(human.survival)} />
              <Stat label="Speed" value={`${Math.round(human.speed)}`} sub="wu/s" />
              <Stat label="Split" value={human.canSplit ? <span className="text-emerald-600">ready</span> : <span className="text-slate-400">—</span>} />
            </div>
          )}

          <div className="pointer-events-auto absolute right-3 top-3 hidden w-52 rounded-xl bg-white/85 p-2.5 text-xs shadow-sm ring-1 ring-slate-200 backdrop-blur md:block" data-testid="mini-leaderboard">
            <div className="mb-1 font-semibold text-slate-500">Leaderboard</div>
            {[...agents].sort((a, b) => a.rank - b.rank).slice(0, 8).map((a) => (
              <button type="button" key={a.id} onClick={() => { setSelectedId(a.id); if (mode === 'watch') setFollow('selected'); }}
                className={`flex w-full items-center justify-between rounded px-1 py-0.5 text-left hover:bg-slate-100 ${a.id === humanId ? 'font-semibold text-slate-900' : 'text-slate-600'} ${a.alive ? '' : 'opacity-40'}`}>
                <span className="truncate"><span className="mr-1 tabular-nums text-slate-400">{a.rank}.</span>
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: `hsl(${a.hue} 72% 62%)` }} />{a.name}</span>
                <span className="tabular-nums">{Math.round(a.mass)}</span>
              </button>
            ))}
          </div>

          {gameOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[2px]" data-testid="game-over">
              <div className="w-80 rounded-2xl bg-white p-5 text-center shadow-xl ring-1 ring-slate-200">
                <div className="text-lg font-bold text-slate-900">You were eaten</div>
                <div className="mt-0.5 text-sm text-slate-500">{human.killedBy >= 0 ? `by ${agents[human.killedBy]?.name ?? 'someone'} (${agents[human.killedBy]?.label ?? ''})` : 'game over'}</div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-left">
                  <Stat label="Survived" value={formatTime(human.survival)} />
                  <Stat label="Peak mass" value={Math.round(human.maxMass)} />
                  <Stat label="Kills" value={human.kills} />
                </div>
                <button type="button" onClick={props.onRestart} data-testid="restart" className="mt-5 w-full rounded-lg bg-indigo-500 py-2 text-sm font-semibold text-white hover:bg-indigo-600">Play again (R)</button>
                <p className="mt-2 text-[11px] text-slate-400">The match keeps running; the camera follows the leader.</p>
              </div>
            </div>
          )}

          {over && mode === 'watch' && (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-slate-900/80 px-4 py-1.5 text-sm text-white" data-testid="match-over">
              Match over — winner: {leader?.name} ({leader?.label})
            </div>
          )}

          {sim.error && <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200" role="alert">{sim.error}</div>}

          {touch && mode === 'play' && <TouchControls joystick={joystick} onSplit={split} onEject={eject} />}

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-white/90 p-1 shadow-md ring-1 ring-slate-200 backdrop-blur" data-testid="dock">
            <IconButton label={running ? 'Pause (P)' : 'Play (P)'} onClick={() => sim.api.setRunning(!running)} active={running} testId="play-pause">{running ? '❚❚' : '▶'}</IconButton>
            <IconButton label="Step one tick (.)" onClick={() => sim.api.stepOnce()} disabled={running} testId="step">⏭</IconButton>
            <IconButton label="Restart (R)" onClick={props.onRestart} testId="reset">↺</IconButton>
            <select aria-label="Simulation speed" value={ui.speed} data-testid="speed"
              onChange={(e) => { const v = Number(e.target.value); onUi({ ...ui, speed: v }); sim.api.setSpeed(v); }}
              className="h-9 rounded-lg bg-transparent px-1.5 text-sm text-slate-700 hover:bg-slate-100">
              {SPEEDS.map((s) => <option key={s} value={s}>{s >= 1000 ? 'Max' : `${s}×`}</option>)}
            </select>
            {mode === 'watch' && (
              <select aria-label="Camera" value={follow === 'selected' ? `a${selectedId}` : follow} data-testid="follow"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'leader' || v === 'free') setFollow(v);
                  else { setSelectedId(Number(v.slice(1))); setFollow('selected'); }
                }}
                className="h-9 max-w-36 rounded-lg bg-transparent px-1.5 text-sm text-slate-700 hover:bg-slate-100">
                <option value="leader">Follow leader</option>
                <option value="free">Free camera</option>
                {agents.map((a) => <option key={a.id} value={`a${a.id}`}>{a.name}</option>)}
              </select>
            )}
            <IconButton label="Fit world" onClick={() => { if (mode === 'watch') setFollow('free'); canvasRef.current?.fitWorld(); }} testId="fit">⤢</IconButton>
            <div className="mx-0.5 h-5 w-px bg-slate-200" />
            <IconButton label="Analytics panel" onClick={() => onUi({ ...ui, bottomOpen: !ui.bottomOpen })} active={ui.bottomOpen} testId="toggle-bottom">▤</IconButton>
            <IconButton label="Settings panel" onClick={() => onUi({ ...ui, rightOpen: !ui.rightOpen })} active={ui.rightOpen} testId="toggle-right">⚙</IconButton>
          </div>

          {mode === 'play' && !gameOver && (
            <div className="pointer-events-none absolute bottom-16 left-3 hidden text-[11px] text-slate-400 md:block">
              Mouse: steer · Space: split · E: eject · WASD/arrows: keyboard steer · P/Esc: pause · R: restart
            </div>
          )}
          {mode === 'watch' && (
            <div className="pointer-events-none absolute bottom-16 left-3 hidden text-[11px] text-slate-400 md:block">
              Click a cell to inspect · drag to pan & wheel to zoom (free camera) · Space/P: pause · .: step
            </div>
          )}
        </div>
        {ui.bottomOpen && (
          <div className="h-64 shrink-0 border-t border-slate-200 bg-white">
            <AnalyticsPanel agents={agents} history={sim.history} log={sim.log} stats={stats} fps={fps} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); if (mode === 'watch') setFollow('selected'); }} />
          </div>
        )}
      </div>
      {ui.rightOpen && (
        <aside className="absolute inset-y-0 right-0 z-20 w-[min(20rem,88vw)] border-l border-slate-200 bg-white shadow-xl md:static md:z-auto md:shadow-none">
          <SettingsPanel
            mode={mode} arena={props.arena} onArena={props.onArena} ui={ui} onUi={onUi} models={props.models} dirty={dirty}
            onApply={props.onRestart} onSave={props.onSave} onLoad={props.onLoad}
            inspector={selectedAgent ? <Inspector detail={inspect} agent={selectedAgent} onClose={() => setSelectedId(null)} /> : mode === 'watch' ? <p className="text-xs text-slate-400">Click an agent on the map or in the leaderboard to see what it perceives and why it acts.</p> : null}
          />
        </aside>
      )}
      {!running && !over && !gameOver && sim.ui.tick > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2"><Badge tone="amber">Paused</Badge></div>
      )}
    </div>
  );
}
