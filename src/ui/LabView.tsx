import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ACTION_VERSION, DEFAULT_REWARD, NUM_ACTIONS, OBS_LABELS, OBS_SIZE, OBS_VERSION, REWARD_VERSION, describeAction, type MlpModelFile,
} from '../ai/rl';
import { RULES_VERSION } from '../engine/config';
import { Badge } from './kit';

interface CurvePoint { timesteps: number; ep_rew_mean?: number; ep_len_mean?: number; stage?: string }
interface StageInfo { name: string; timesteps: number; description?: string }

export function LabView({ models, errors }: { models: MlpModelFile[]; errors: string[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="lab-view">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header>
          <h1 className="text-xl font-bold text-slate-900">Reinforcement-learning lab</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Policies are trained in Python (Stable-Baselines3 PPO) against the <em>same TypeScript engine</em> that runs this page — the Python
            environment drives it through a Node bridge, so the rules cannot diverge. Trained weights are exported to JSON and evaluated here by a
            TypeScript MLP whose outputs are tested against PyTorch to 1e-5.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{RULES_VERSION}</Badge><Badge>{OBS_VERSION} · {OBS_SIZE} floats</Badge><Badge>{ACTION_VERSION} · {NUM_ACTIONS} actions</Badge><Badge>{REWARD_VERSION}</Badge>
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Models shipped with this build</h2>
          {models.length === 0 && <p className="text-sm text-slate-500">No models were found in <code>models/index.json</code>.</p>}
          {errors.map((e) => <p key={e} className="text-xs text-rose-600">{e}</p>)}
          <div className="grid gap-4 lg:grid-cols-2">
            {models.map((m) => <ModelCard key={m.id} model={m} />)}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="font-semibold text-slate-800">Action space ({ACTION_VERSION})</h3>
            <p className="mt-1 text-xs text-slate-500">index = move × 3 + special. Moves: stay or 8 compass headings in world space (+y is south). Impossible splits/ejects are ignored by the engine and cost −0.01.</p>
            <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-0.5 font-mono text-[11px] text-slate-600">
              {Array.from({ length: NUM_ACTIONS }, (_, i) => <span key={i}><span className="text-slate-400">{String(i).padStart(2, ' ')}</span> {describeAction(i)}</span>)}
            </div>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="font-semibold text-slate-800">Reward ({REWARD_VERSION})</h3>
            <p className="mt-1 text-xs text-slate-500">Per decision step (2 ticks = 1/15 s). Growth uses Δ ln(mass) so a large cell is not paid more for the same food. Evaluation metrics (win rate, survival, mass) are computed separately from the reward.</p>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {([
                  ['growth', DEFAULT_REWARD.growth, '× Δ ln(total mass), while alive'],
                  ['kill', DEFAULT_REWARD.kill, 'per enemy agent eliminated'],
                  ['death', DEFAULT_REWARD.death, 'once, terminates the episode'],
                  ['cellLost', DEFAULT_REWARD.cellLost, 'per own cell eaten'],
                  ['eject', DEFAULT_REWARD.eject, 'per successful ejection'],
                  ['split', DEFAULT_REWARD.split, 'per successful split'],
                  ['invalid', DEFAULT_REWARD.invalid, 'per rejected split / eject'],
                  ['alive', DEFAULT_REWARD.alive, 'per step alive (0: avoids rewarding pure hiding)'],
                ] as const).map(([k, v, d]) => (
                  <tr key={k} className="border-t border-slate-50"><td className="py-0.5 font-mono text-slate-700">{k}</td><td className="text-right tabular-nums">{v}</td><td className="pl-3 text-slate-500">{d}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h3 className="font-semibold text-slate-800">Observation ({OBS_VERSION}, {OBS_SIZE} floats)</h3>
          <p className="mt-1 text-xs text-slate-500">
            Relative to the agent's centre of mass, scaled by its vision radius. Only entities inside the vision radius appear; empty slots are zeros with
            <code> valid = 0</code>. 12 self features · 8 nearest cells × 10 · 8 nearest food × 3 · 8 food-density sectors · 3 thorns × 5.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 font-mono text-[10px] leading-relaxed text-slate-600 sm:grid-cols-4 lg:grid-cols-6">
            {OBS_LABELS.filter((l) => !/^(cell[1-7]|food[1-7]|thorn[12])\./.test(l)).map((l) => <span key={l}>{l}</span>)}
            <span className="text-slate-400">… cell1–7, food1–7, thorn1–2 repeat</span>
          </div>
        </section>

        <section className="rounded-xl bg-white p-4 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
          <h3 className="font-semibold text-slate-800">Reproduce the training</h3>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{`npm ci && npm run build:node           # bundle the engine bridge
pip install -r rl/requirements.txt
python -m rl.train --config rl/configs/ppo_v1.json   # stages A→D, checkpoints in rl/checkpoints/
python -m rl.evaluate --model rl/checkpoints/ppo_v1/final.zip --episodes 50
python -m rl.export --model rl/checkpoints/ppo_v1/final.zip --id ppo-v1 --out public/models/ppo-v1.json`}</pre>
        </section>
      </div>
    </div>
  );
}

function ModelCard({ model }: { model: MlpModelFile }) {
  const t = (model.training ?? {}) as Record<string, unknown>;
  const curve = (Array.isArray(t.curve) ? t.curve : []) as CurvePoint[];
  const stages = (Array.isArray(t.stages) ? t.stages : []) as StageInfo[];
  const evalRows = (Array.isArray(t.evaluation) ? t.evaluation : []) as Record<string, number | string>[];
  const arch = [model.obsSize, ...model.policyNet.map((l) => l.bias.length), model.numActions].join(' → ');
  const params = [...model.policyNet, model.actionNet, ...model.valueNet, model.valueHead].reduce((s, l) => s + l.bias.length * (1 + l.weight[0].length), 0);
  return (
    <article className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-testid={`model-${model.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-800">{model.label}</h3>
          <div className="font-mono text-xs text-slate-400">{model.id}</div>
        </div>
        {model.trained ? <Badge tone="green">trained</Badge> : <Badge tone="amber">untrained · random init</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-slate-500">Network</dt><dd className="font-mono text-slate-700">{arch} ({model.activation})</dd>
        <dt className="text-slate-500">Parameters</dt><dd className="tabular-nums text-slate-700">{params.toLocaleString()}</dd>
        <dt className="text-slate-500">Algorithm</dt><dd className="text-slate-700">{String(t.algorithm ?? '—')}</dd>
        <dt className="text-slate-500">Timesteps</dt><dd className="tabular-nums text-slate-700">{typeof t.totalTimesteps === 'number' ? t.totalTimesteps.toLocaleString() : '—'}</dd>
        <dt className="text-slate-500">Wall time</dt><dd className="text-slate-700">{typeof t.wallSeconds === 'number' ? `${(t.wallSeconds / 60).toFixed(1)} min on ${String(t.device ?? '?')}` : '—'}</dd>
        <dt className="text-slate-500">Obs normalisation</dt><dd className="text-slate-700">{model.obsNorm ? `VecNormalize (clip ±${model.obsNorm.clip})` : 'none'}</dd>
        <dt className="text-slate-500">Versions</dt><dd className="text-slate-700">{model.rulesVersion} · {model.obsVersion} · {model.actionVersion} · {model.rewardVersion}</dd>
      </dl>
      {stages.length > 0 && (
        <div className="mt-3 text-xs">
          <div className="font-medium text-slate-600">Curriculum</div>
          <ol className="mt-1 space-y-0.5 text-slate-500">
            {stages.map((s) => <li key={s.name}><span className="font-medium text-slate-700">{s.name}</span> · {s.timesteps.toLocaleString()} steps{s.description ? ` — ${s.description}` : ''}</li>)}
          </ol>
        </div>
      )}
      {curve.length > 1 && (
        <div className="mt-3 h-44">
          <div className="text-xs font-medium text-slate-600">Training curve (rollout episodes)</div>
          <ResponsiveContainer width="100%" height="88%">
            <LineChart data={curve} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#f1f5f9" />
              <XAxis dataKey="timesteps" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
              <YAxis yAxisId="r" tick={{ fontSize: 10 }} width={36} />
              <YAxis yAxisId="l" orientation="right" tick={{ fontSize: 10 }} width={40} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line yAxisId="r" dataKey="ep_rew_mean" name="episode return" stroke="#7c3aed" dot={false} isAnimationActive={false} />
              <Line yAxisId="l" dataKey="ep_len_mean" name="episode length" stroke="#94a3b8" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {evalRows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <div className="text-xs font-medium text-slate-600">Python evaluation (held-out seeds)</div>
          <table className="mt-1 w-full text-[11px]">
            <thead className="text-left text-slate-400"><tr>{Object.keys(evalRows[0]).map((k) => <th key={k} className="pr-2 font-medium">{k}</th>)}</tr></thead>
            <tbody>{evalRows.map((r, i) => <tr key={i} className="border-t border-slate-50">{Object.values(r).map((v, j) => <td key={j} className="pr-2 tabular-nums text-slate-700">{typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {!model.trained && <p className="mt-3 text-xs text-amber-700">This network has random initial weights and was never trained. It exists as the “before training” baseline.</p>}
    </article>
  );
}
