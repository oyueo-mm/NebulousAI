import { OBS_LABELS, describeAction } from '../ai/rl';
import type { AgentSummary, InspectDetail } from '../worker/protocol';
import { Badge, KIND_COLOURS, Stat, formatTime } from './kit';

export function Inspector({ detail, agent, onClose }: { detail: InspectDetail | null; agent: AgentSummary | undefined; onClose: () => void }) {
  if (!detail || !agent) return null;
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
            <span className="text-xs" style={{ color: KIND_COLOURS[detail.kind] }}>{detail.label}</span>
            {detail.kind === 'ppo' && (detail.trained === false ? <Badge tone="amber">untrained (random init)</Badge> : detail.trained ? <Badge tone="green">trained</Badge> : null)}
            {!agent.alive && <Badge tone="red">eliminated</Badge>}
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="close inspector">✕</button>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5">
        <Stat label="Mass" value={Math.round(detail.mass)} />
        <Stat label="Cells" value={detail.cells} />
        <Stat label="Rank" value={`#${agent.rank}`} />
        <Stat label="Kills" value={agent.kills} />
        <Stat label="Alive" value={formatTime(agent.survival)} />
        <Stat label="Split" value={detail.canSplit ? 'ready' : '—'} />
      </div>

      {trace?.kind === 'heuristic' && (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Mode</span>
            <span className="font-medium text-slate-800" data-testid="inspector-mode">{trace.mode}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Target</span>
            <span className="text-slate-700">{trace.targetKind ?? '—'}{trace.preyId !== null ? ` (cell ${trace.preyId})` : ''}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Threats in view</span>
            <span className="text-slate-700">{trace.threatIds.length}</span>
          </div>
          <div>
            <div className="flex items-center justify-between text-slate-500"><span>Estimated risk</span><span className="tabular-nums">{(trace.risk * 100).toFixed(0)}%</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500" style={{ width: `${Math.min(100, trace.risk * 100)}%` }} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Action</span>
            <span className="text-slate-700">{trace.split ? 'move + split' : trace.eject ? 'move + eject' : 'move'}</span>
          </div>
          {trace.note && <p className="text-xs text-slate-500">{trace.note}</p>}
          <p className="rounded-md bg-sky-50 px-2 py-1.5 text-[11px] leading-snug text-sky-800">
            Heuristic trace: every value above comes from this policy's own decision code. Arrow = chosen target, red rings = threats it
            reacted to, green ring = chosen prey, blue circles = nearest visible food.
          </p>
        </div>
      )}

      {trace?.kind === 'neural' && <NeuralView detail={detail} />}

      {detail.reward && (
        <div className="rounded-lg border border-slate-100 p-2.5 text-xs">
          <div className="mb-1 flex justify-between font-medium text-slate-600"><span>reward-v1 (last decision)</span><span className="tabular-nums">{detail.reward.total.toFixed(3)}</span></div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-500">
            <span>growth {detail.reward.growth.toFixed(3)}</span><span>kill {detail.reward.kill.toFixed(2)}</span>
            <span>cell lost {detail.reward.cellLost.toFixed(2)}</span><span>actions {detail.reward.actions.toFixed(3)}</span>
          </div>
          <div className="mt-1 flex justify-between text-slate-500"><span>episode return</span><span className="tabular-nums">{detail.episodeReturn.toFixed(2)}</span></div>
        </div>
      )}
    </div>
  );
}

function NeuralView({ detail }: { detail: InspectDetail }) {
  const trace = detail.trace;
  if (trace?.kind !== 'neural') return null;
  const ranked = trace.probs.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p).slice(0, 6);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-slate-500">Chosen action</span>
        <span className="font-medium text-violet-700" data-testid="inspector-action">#{trace.action} {describeAction(trace.action)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-500">Selection</span>
        <span className="text-slate-700">{trace.deterministic ? 'argmax' : 'sampled from π(a|s)'}</span>
      </div>
      {trace.value !== null && (
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Value estimate V(s)</span>
          <span className="tabular-nums text-slate-700">{trace.value.toFixed(3)}</span>
        </div>
      )}
      <div>
        <div className="mb-1 text-xs text-slate-500">Top action probabilities</div>
        {ranked.map(({ p, i }) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate text-slate-600">{describeAction(i)}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${i === trace.action ? 'bg-violet-500' : 'bg-violet-200'}`} style={{ width: `${p * 100}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums text-slate-500">{(p * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500">Observation vector (obs-v1, {trace.observation.length} values)</summary>
        <div className="mt-1 max-h-48 overflow-auto rounded-md bg-slate-50 p-2 font-mono text-[10px] leading-relaxed">
          {trace.observation.map((v, i) => (v !== 0 || i < 12 ? (
            <div key={i} className="flex justify-between gap-2"><span className="text-slate-500">{OBS_LABELS[i]}</span><span className="tabular-nums text-slate-800">{v.toFixed(3)}</span></div>
          ) : null))}
          <div className="mt-1 text-slate-400">zero entries after self.* hidden (empty slots, valid = 0)</div>
        </div>
      </details>
      <p className="rounded-md bg-violet-50 px-2 py-1.5 text-[11px] leading-snug text-violet-800">
        Neural policy: there is no explicit goal to show. The purple arrow is the chosen move direction; #k labels mark which visible cells
        occupy observation slots cell0…cell7. No threat/prey rings are drawn because the network does not compute them; if the risk heatmap is on,
        it is the heuristic dangerAt() estimate, not a network prediction.
      </p>
    </div>
  );
}
