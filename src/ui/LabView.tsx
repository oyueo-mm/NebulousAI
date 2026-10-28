import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ACTION_VERSION, DEFAULT_REWARD, NUM_ACTIONS, OBS_LABELS, OBS_SIZE, OBS_VERSION, REWARD_VERSION, type MlpModelFile,
} from '../ai/rl';
import type { PolicyKind } from '../ai/types';
import { RULES_VERSION } from '../engine/config';
import { t } from '../i18n';
import { Badge } from './kit';
import { modelLabel } from './SettingsPanel';

interface CurvePoint { timesteps: number; ep_rew_mean?: number; ep_len_mean?: number; stage?: string }
interface StageInfo { name: string; timesteps: number; description?: string }

const HEURISTICS: PolicyKind[] = ['random', 'greedy', 'survival', 'aggressive', 'hybrid'];

/** Evaluation policy names as written by rl.evaluate → display text (identifiers stay as data). */
function evalPolicy(name: string): string {
  if ((HEURISTICS as string[]).includes(name)) return t.policy.short(name as PolicyKind);
  return name.replace('(TS, argmax)', '(TS 추론, argmax)').replace('(TS, sampled)', '(TS 추론, 샘플링)');
}

export function LabView({ models, errors }: { models: MlpModelFile[]; errors: string[] }) {
  const l = t.lab;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="lab-view">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header>
          <h1 className="text-xl font-bold text-slate-900">{l.title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">{l.intro}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{RULES_VERSION}</Badge><Badge>{OBS_VERSION} · {l.floats(OBS_SIZE)}</Badge><Badge>{ACTION_VERSION} · {l.actions(NUM_ACTIONS)}</Badge><Badge>{REWARD_VERSION}</Badge>
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500">{l.shipped}</h2>
          {models.length === 0 && <p className="text-sm text-slate-500">{l.none}</p>}
          {errors.map((e) => <p key={e} className="text-xs text-rose-600">{e}</p>)}
          <div className="grid gap-4 lg:grid-cols-2">
            {models.map((m) => <ModelCard key={m.id} model={m} />)}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="font-semibold text-slate-800">{l.actionSpace(ACTION_VERSION)}</h3>
            <p className="mt-1 text-xs text-slate-500">{l.actionNote}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-600 sm:grid-cols-3">
              {Array.from({ length: NUM_ACTIONS }, (_, i) => <span key={i}><span className="font-mono text-slate-400">{String(i).padStart(2, ' ')}</span> {t.action.describe(i)}</span>)}
            </div>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="font-semibold text-slate-800">{l.reward(REWARD_VERSION)}</h3>
            <p className="mt-1 text-xs text-slate-500">{l.rewardNote}</p>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {(Object.keys(l.rewardRows) as (keyof typeof DEFAULT_REWARD)[]).map((k) => (
                  <tr key={k} className="border-t border-slate-50"><td className="py-0.5 font-mono text-slate-700">{k}</td><td className="text-right tabular-nums">{DEFAULT_REWARD[k]}</td><td className="pl-3 text-slate-500">{l.rewardRows[k]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h3 className="font-semibold text-slate-800">{l.observation(OBS_VERSION, OBS_SIZE)}</h3>
          <p className="mt-1 text-xs text-slate-500">{l.obsNote}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 font-mono text-[10px] leading-relaxed text-slate-600 sm:grid-cols-4 lg:grid-cols-6">
            {OBS_LABELS.filter((x) => !/^(cell[1-7]|food[1-7]|thorn[12])\./.test(x)).map((x) => <span key={x}>{x}</span>)}
            <span className="font-sans text-slate-400">{l.obsRepeat}</span>
          </div>
        </section>

        <section className="rounded-xl bg-white p-4 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
          <h3 className="font-semibold text-slate-800">{l.reproduce}</h3>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{`npm ci && npm run build:node           # 엔진 브리지 번들
pip install -r rl/requirements.txt
python -m rl.train   --config rl/configs/ppo_v2.json   # 순수 (Maskable)PPO 커리큘럼
python -m rl.imitate --config rl/configs/bc_v4.json    # 행동 복제 + DAgger
python -m rl.train   --config rl/configs/ppo_v4.json   # 모방 정책에서 PPO 미세조정
# 평가·내보내기 명령: docs/EXPERIMENTS.md#reproduce`}</pre>
        </section>
      </div>
    </div>
  );
}

function ModelCard({ model }: { model: MlpModelFile }) {
  const l = t.lab;
  const tr = (model.training ?? {}) as Record<string, unknown>;
  const curve = (Array.isArray(tr.curve) ? tr.curve : []) as CurvePoint[];
  const stages = (Array.isArray(tr.stages) ? tr.stages : []) as StageInfo[];
  const evalRows = (Array.isArray(tr.evaluation) ? tr.evaluation : []) as Record<string, number | string>[];
  const im = tr.imitation as { samples?: number; demonstrations?: { teacher: string; scenario: string }[]; dagger?: { rounds?: number } } | undefined;
  const imitation = im && typeof im.samples === 'number'
    ? {
      samples: im.samples, rounds: im.dagger?.rounds ?? 0,
      teachers: [...new Set((im.demonstrations ?? []).map((d) => l.teacherIn(t.policy.short(d.teacher as PolicyKind), l.scenarios[d.scenario] ?? d.scenario)))].join(', '),
    }
    : null;
  const arch = [model.obsSize, ...model.policyNet.map((x) => x.bias.length), model.numActions].join(' → ');
  const params = [...model.policyNet, model.actionNet, ...model.valueNet, model.valueHead].reduce((s, x) => s + x.bias.length * (1 + x.weight[0].length), 0);
  const algorithm = typeof tr.algorithm === 'string' ? l.algorithmNames[tr.algorithm] ?? tr.algorithm : '—';
  return (
    <article className="min-w-0 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-testid={`model-${model.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-800">{modelLabel(model)}</h3>
          <div className="font-mono text-xs text-slate-400">{model.id}</div>
        </div>
        {model.trained ? <Badge tone="green">{l.trained}</Badge> : <Badge tone="amber">{l.untrained}</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-slate-500">{l.network}</dt><dd className="break-all font-mono text-slate-700">{arch} ({model.activation})</dd>
        <dt className="text-slate-500">{l.params}</dt><dd className="tabular-nums text-slate-700">{params.toLocaleString(t.locale)}</dd>
        <dt className="text-slate-500">{l.algorithm}</dt><dd className="text-slate-700">{algorithm}</dd>
        <dt className="text-slate-500">{l.timesteps}</dt><dd className="tabular-nums text-slate-700">{typeof tr.totalTimesteps === 'number' ? tr.totalTimesteps.toLocaleString(t.locale) : '—'}</dd>
        <dt className="text-slate-500">{l.wall}</dt><dd className="text-slate-700">{typeof tr.wallSeconds === 'number' ? l.wallValue(tr.wallSeconds / 60, String(tr.device ?? '?')) : '—'}</dd>
        {typeof tr.initFrom === 'string' && (<><dt className="text-slate-500">{l.initFrom}</dt><dd className="break-all font-mono text-slate-700">{tr.initFrom}</dd></>)}
        {model.actionMasking !== undefined && (<><dt className="text-slate-500">{l.masking}</dt><dd className="text-slate-700">{model.actionMasking ? l.maskingYes : l.maskingNo}</dd></>)}
        <dt className="text-slate-500">{l.obsNorm}</dt><dd className="text-slate-700">{model.obsNorm ? `VecNormalize (clip ±${model.obsNorm.clip})` : l.noNorm}</dd>
        <dt className="text-slate-500">{l.versions}</dt><dd className="text-slate-700">{model.rulesVersion} · {model.obsVersion} · {model.actionVersion} · {model.rewardVersion}</dd>
      </dl>
      {stages.length > 0 && (
        <div className="mt-3 text-xs">
          <div className="font-medium text-slate-600">{l.curriculum}</div>
          <ol className="mt-1 space-y-0.5 text-slate-500">
            {stages.map((s) => <li key={s.name}><span className="font-medium text-slate-700">{s.name}</span> · {l.steps(s.timesteps)} — {l.stageDescriptions[s.name] ?? s.description ?? ''}</li>)}
          </ol>
        </div>
      )}
      {imitation && (
        <div className="mt-3 text-xs">
          <div className="font-medium text-slate-600">{l.imitation}</div>
          <p className="mt-1 text-slate-500">{l.imitationText(imitation.samples, imitation.teachers, imitation.rounds)}</p>
        </div>
      )}
      {curve.length > 1 && (
        <div className="mt-3 h-44">
          <div className="text-xs font-medium text-slate-600">{l.curve}</div>
          <ResponsiveContainer width="100%" height="88%">
            <LineChart data={curve} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#f1f5f9" />
              <XAxis dataKey="timesteps" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}M`} />
              <YAxis yAxisId="r" tick={{ fontSize: 10 }} width={36} />
              <YAxis yAxisId="l" orientation="right" tick={{ fontSize: 10 }} width={40} />
              <Tooltip contentStyle={{ fontSize: 11 }} labelFormatter={(v) => l.steps(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line yAxisId="r" dataKey="ep_rew_mean" name={l.curveReturn} stroke="#A83557" dot={false} isAnimationActive={false} />
              <Line yAxisId="l" dataKey="ep_len_mean" name={l.curveLength} stroke="#94a3b8" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {evalRows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <div className="text-xs font-medium text-slate-600">{l.evaluation}</div>
          <table className="mt-1 w-full whitespace-nowrap text-[11px]">
            <thead className="text-left text-slate-400"><tr>{Object.keys(evalRows[0]).map((k) => <th key={k} className="pr-2 font-medium">{l.evalCols[k] ?? k}</th>)}</tr></thead>
            <tbody>{evalRows.map((r, i) => (
              <tr key={i} className="border-t border-slate-50">{Object.entries(r).map(([k, v]) => (
                <td key={k} className="pr-2 tabular-nums text-slate-700">
                  {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : k === 'scenario' ? l.scenarios[v] ?? v : k === 'policy' ? evalPolicy(v) : v}
                </td>
              ))}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!model.trained && <p className="mt-3 text-xs text-amber-700">{l.untrainedNote}</p>}
    </article>
  );
}
