import { OBS_LABELS } from '../ai/rl';
import { t } from '../i18n';
import type { AgentSummary, InspectDetail } from '../worker/protocol';
import { Badge, KIND_COLOURS, Stat, formatTime } from './kit';

export function Inspector({ detail, agent, onClose }: { detail: InspectDetail | null; agent: AgentSummary | undefined; onClose: () => void }) {
  if (!detail || !agent) return null;
  const i = t.inspector;
  const trace = detail.trace;
  return (
    <div className="space-y-3" data-testid="inspector">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: `hsl(${agent.hue} 72% 62%)` }} />
            <span className="truncate font-semibold text-slate-800">{agent.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs" style={{ color: KIND_COLOURS[detail.kind] }}>{t.policy.label(detail.kind, detail.modelId)}</span>
            {detail.kind === 'ppo' && (detail.trained === false ? <Badge tone="amber">{i.untrained}</Badge> : detail.trained ? <Badge tone="green">{i.trained}</Badge> : null)}
            {!agent.alive && <Badge tone="red">{i.eliminated}</Badge>}
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 pointer-coarse:h-11 pointer-coarse:w-11" aria-label={i.close}>✕</button>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5">
        <Stat label={i.mass} value={Math.round(detail.mass)} />
        <Stat label={i.cells} value={detail.cells} />
        <Stat label={i.rank} value={i.rankValue(agent.rank)} />
        <Stat label={i.kills} value={agent.kills} />
        <Stat label={i.alive} value={formatTime(agent.survival)} />
        <Stat label={i.split} value={detail.canSplit ? i.ready : '—'} />
      </div>

      {trace?.kind === 'heuristic' && (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-slate-500">{i.mode}</span>
            <span className="text-right font-medium text-slate-800" data-testid="inspector-mode">{t.mode(trace.mode)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-slate-500">{i.target}</span>
            <span className="text-right text-slate-700">{trace.targetKind ? t.trace.targetKind[trace.targetKind] ?? trace.targetKind : '—'}{trace.preyId !== null ? ` (${i.cell(trace.preyId)})` : ''}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">{i.threats}</span>
            <span className="text-slate-700">{trace.threatIds.length}</span>
          </div>
          <div>
            <div className="flex items-center justify-between text-slate-500"><span>{i.risk}</span><span className="tabular-nums">{(trace.risk * 100).toFixed(0)}%</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500" style={{ width: `${Math.min(100, trace.risk * 100)}%` }} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">{i.action}</span>
            <span className="text-slate-700">{trace.split ? i.actionSplit : trace.eject ? i.actionEject : i.actionMove}</span>
          </div>
          {trace.note && <p className="text-xs text-slate-500" data-testid="inspector-note">{t.trace.note(trace.note)}</p>}
          <p className="rounded-md bg-sky-50 px-2 py-1.5 text-[11px] leading-snug text-sky-800">{i.heuristicNote}</p>
        </div>
      )}

      {trace?.kind === 'neural' && <NeuralView detail={detail} />}

      {detail.reward && (
        <div className="rounded-lg border border-slate-100 p-2.5 text-xs">
          <div className="mb-1 flex justify-between font-medium text-slate-600"><span>{i.reward}</span><span className="tabular-nums">{detail.reward.total.toFixed(3)}</span></div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-500">
            <span>{i.growth} {detail.reward.growth.toFixed(3)}</span><span>{i.kill} {detail.reward.kill.toFixed(2)}</span>
            <span>{i.cellLost} {detail.reward.cellLost.toFixed(2)}</span><span>{i.actions} {detail.reward.actions.toFixed(3)}</span>
          </div>
          <div className="mt-1 flex justify-between text-slate-500"><span>{i.episodeReturn}</span><span className="tabular-nums">{detail.episodeReturn.toFixed(2)}</span></div>
        </div>
      )}
    </div>
  );
}

function NeuralView({ detail }: { detail: InspectDetail }) {
  const i = t.inspector;
  const trace = detail.trace;
  if (trace?.kind !== 'neural') return null;
  const ranked = trace.probs.map((p, a) => ({ p, a })).sort((x, y) => y.p - x.p).slice(0, 6);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-slate-500">{i.chosen}</span>
        <span className="text-right font-medium text-violet-700" data-testid="inspector-action">#{trace.action} {t.action.describe(trace.action)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-slate-500">{i.selection}</span>
        <span className="text-right text-slate-700">{trace.deterministic ? i.argmax : i.sampled}</span>
      </div>
      {trace.value !== null && (
        <div className="flex items-center justify-between">
          <span className="text-slate-500">{i.value}</span>
          <span className="tabular-nums text-slate-700">{trace.value.toFixed(3)}</span>
        </div>
      )}
      <div>
        <div className="mb-1 text-xs text-slate-500">{i.topProbs}</div>
        {ranked.map(({ p, a }) => (
          <div key={a} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 truncate text-slate-600">{t.action.describe(a)}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${a === trace.action ? 'bg-violet-500' : 'bg-violet-200'}`} style={{ width: `${p * 100}%` }} />
            </div>
            <span className="w-11 text-right tabular-nums text-slate-500">{(p * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500">{i.obs(trace.observation.length)}</summary>
        <div className="mt-1 max-h-48 overflow-auto rounded-md bg-slate-50 p-2 font-mono text-[10px] leading-relaxed">
          {trace.observation.map((v, k) => (v !== 0 || k < 12 ? (
            <div key={k} className="flex justify-between gap-2"><span className="text-slate-500">{OBS_LABELS[k]}</span><span className="tabular-nums text-slate-800">{v.toFixed(3)}</span></div>
          ) : null))}
          <div className="mt-1 font-sans text-slate-400">{i.obsHidden}</div>
        </div>
      </details>
      <p className="rounded-md bg-violet-50 px-2 py-1.5 text-[11px] leading-snug text-violet-800">{i.neuralNote}</p>
    </div>
  );
}
