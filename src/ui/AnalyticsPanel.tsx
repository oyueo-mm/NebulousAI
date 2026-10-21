import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { t } from '../i18n';
import type { AgentSummary, FrameStats } from '../worker/protocol';
import { agentLabel } from './labels';
import { KIND_COLOURS, formatTime } from './kit';

type Tab = 'leaderboard' | 'mass' | 'policies' | 'log' | 'performance';

interface Props {
  agents: AgentSummary[];
  history: { t: number; mass: number[] }[];
  log: string[];
  stats: FrameStats | null;
  fps: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function AnalyticsPanel(props: Props) {
  const [tab, setTab] = useState<Tab>('leaderboard');
  const tabs = Object.entries(t.analytics.tabs) as [Tab, string][];
  return (
    <div className="flex h-full flex-col" data-testid="analytics">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-2">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} data-testid={`tab-${id}`}
            className={`whitespace-nowrap rounded-t-md px-3 py-1.5 text-xs font-medium pointer-coarse:py-2.5 ${tab === id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:text-slate-800'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'leaderboard' && <Leaderboard {...props} />}
        {tab === 'mass' && <MassChart agents={props.agents} history={props.history} />}
        {tab === 'policies' && <ByPolicy agents={props.agents} />}
        {tab === 'log' && (
          <div className="space-y-0.5 text-xs text-slate-600" data-testid="event-log">
            {props.log.length === 0 && <div className="text-slate-400">{t.analytics.noEvents}</div>}
            {[...props.log].reverse().map((l, i) => <div key={i} className="tabular-nums">{l}</div>)}
          </div>
        )}
        {tab === 'performance' && <Performance stats={props.stats} fps={props.fps} agents={props.agents.length} />}
      </div>
    </div>
  );
}

function Leaderboard({ agents, selectedId, onSelect }: Props) {
  const c = t.analytics.cols;
  const rows = [...agents].sort((a, b) => a.rank - b.rank);
  return (
    <table className="w-full whitespace-nowrap text-xs">
      <thead className="text-left text-[10px] tracking-wider text-slate-400">
        <tr><th className="py-1 pr-2">{c.rank}</th><th>{c.agent}</th><th>{c.policy}</th><th className="text-right">{c.mass}</th><th className="text-right">{c.cells}</th><th className="text-right">{c.kills}</th><th className="text-right">{c.eaten}</th><th className="text-right">{c.alive}</th><th className="text-right">{c.ret}</th><th className="pl-3">{c.mode}</th></tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id} onClick={() => onSelect(a.id)} className={`cursor-pointer border-t border-slate-50 hover:bg-slate-50 ${a.id === selectedId ? 'bg-indigo-50/60' : ''} ${a.alive ? '' : 'text-slate-400'}`}>
            <td className="py-1 pr-2 tabular-nums">{a.rank}</td>
            <td className="pr-2"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: `hsl(${a.hue} 72% 62%)` }} />{a.name}</td>
            <td className="pr-2" style={{ color: a.alive ? KIND_COLOURS[a.kind] : undefined }}>{agentLabel(a)}</td>
            <td className="text-right tabular-nums">{Math.round(a.mass)}</td>
            <td className="text-right tabular-nums">{a.cells}</td>
            <td className="text-right tabular-nums">{a.kills}</td>
            <td className="text-right tabular-nums">{a.cellsEaten}</td>
            <td className="text-right tabular-nums">{formatTime(a.survival)}</td>
            <td className="text-right tabular-nums">{a.episodeReturn.toFixed(1)}</td>
            <td className="max-w-40 truncate pl-3 text-slate-500">{t.mode(a.mode)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MassChart({ agents, history }: { agents: AgentSummary[]; history: { t: number; mass: number[] }[] }) {
  const top = useMemo(() => [...agents].sort((a, b) => b.mass - a.mass).slice(0, 8), [agents]);
  const data = useMemo(() => history.map((h) => {
    const row: Record<string, number> = { t: Math.round(h.t) };
    for (const a of top) row[`a${a.id}`] = Math.round(h.mass[a.id] ?? 0);
    return row;
  }), [history, top]);
  if (data.length < 2) return <div className="text-xs text-slate-400">{t.analytics.collecting}</div>;
  return (
    <div className="h-full min-h-40">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#f1f5f9" />
          <XAxis dataKey="t" tick={{ fontSize: 10 }} unit={t.analytics.seconds} />
          <YAxis tick={{ fontSize: 10 }} width={44} />
          <Tooltip contentStyle={{ fontSize: 11 }} labelFormatter={(v) => `${v}${t.analytics.seconds}`} />
          {top.map((a) => <Line key={a.id} dataKey={`a${a.id}`} name={a.name} dot={false} isAnimationActive={false} stroke={`hsl(${a.hue} 65% 52%)`} strokeWidth={1.6} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ByPolicy({ agents }: { agents: AgentSummary[] }) {
  const c = t.analytics.cols;
  const groups = new Map<string, AgentSummary[]>();
  for (const a of agents) { const k = agentLabel(a); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(a); }
  return (
    <div>
      <table className="w-full whitespace-nowrap text-xs">
        <thead className="text-left text-[10px] tracking-wider text-slate-400">
          <tr><th className="py-1">{c.policy}</th><th className="text-right">{c.agents}</th><th className="text-right">{c.aliveNow}</th><th className="text-right">{c.avgMass}</th><th className="text-right">{c.kills}</th><th className="text-right">{c.deaths}</th><th className="text-right">{c.bestRank}</th></tr>
        </thead>
        <tbody>
          {[...groups].map(([label, rows]) => (
            <tr key={label} className="border-t border-slate-50">
              <td className="py-1 pr-2" style={{ color: KIND_COLOURS[rows[0].kind] }}>{label}</td>
              <td className="text-right tabular-nums">{rows.length}</td>
              <td className="text-right tabular-nums">{rows.filter((r) => r.alive).length}</td>
              <td className="text-right tabular-nums">{Math.round(rows.reduce((s, r) => s + r.mass, 0) / rows.length)}</td>
              <td className="text-right tabular-nums">{rows.reduce((s, r) => s + r.kills, 0)}</td>
              <td className="text-right tabular-nums">{rows.reduce((s, r) => s + r.deaths, 0)}</td>
              <td className="text-right tabular-nums">{Math.min(...rows.map((r) => r.rank))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-slate-400">{t.analytics.policyNote}</p>
    </div>
  );
}

function Performance({ stats, fps, agents }: { stats: FrameStats | null; fps: number; agents: number }) {
  const p = t.analytics.perf;
  const rows: [string, string, string][] = [
    [p.fps.label, fps.toFixed(0), p.fps.hint],
    [p.ups.label, stats ? stats.ups.toFixed(0) : '—', p.ups.hint],
    [p.speed.label, stats ? `${stats.speedActual.toFixed(2)}×` : '—', p.speed.hint],
    [p.world.label, stats ? `${stats.worldMsPerTick.toFixed(3)} ${p.msTick}` : '—', p.world.hint],
    [p.ai.label, stats ? `${stats.policyMsPerTick.toFixed(3)} ${p.msTick}` : '—', p.ai.hint(agents)],
    [p.frame.label, stats ? `${stats.workerMsPerFrame.toFixed(2)} ${p.msFrame}` : '—', p.frame.hint],
  ];
  return (
    <table className="w-full max-w-xl text-xs" data-testid="perf-table">
      <tbody>
        {rows.map(([k, v, hint]) => (
          <tr key={k} className="border-t border-slate-50"><td className="py-1 pr-2 text-slate-500">{k}</td><td className="whitespace-nowrap text-right font-medium tabular-nums text-slate-800">{v}</td><td className="pl-4 text-slate-400">{hint}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
