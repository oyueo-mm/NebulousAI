import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MlpModelFile } from '../ai/rl';
import type { PolicyKind } from '../ai/types';
import { t } from '../i18n';
import type { ParticipantSpec } from '../sim/match';
import { reportToCsv, type TournamentReport, type TournamentSpec } from '../sim/tournament';
import type { TournamentOut } from '../worker/tournament.worker';
import { BOT_KINDS } from './settings';
import { KIND_COLOURS, NumberField, Section, Stepper, downloadText } from './kit';
import { modelLabel } from './SettingsPanel';

interface Preset { id: keyof typeof t.tournament.presetNames; counts: Partial<Record<PolicyKind, number>> }
const PRESETS: Preset[] = [
  { id: 'all', counts: { random: 2, greedy: 2, survival: 2, aggressive: 2, hybrid: 2 } },
  { id: 'rvg', counts: { random: 4, greedy: 4 } },
  { id: 'gvs', counts: { greedy: 4, survival: 4 } },
  { id: 'sva', counts: { survival: 4, aggressive: 4 } },
  { id: 'hvp', counts: { hybrid: 4, ppo: 4 } },
  { id: 'everything', counts: { random: 2, greedy: 2, survival: 2, aggressive: 2, hybrid: 2, ppo: 2 } },
];

export function TournamentView({ models }: { models: MlpModelFile[] }) {
  const tr = t.tournament;
  const [counts, setCounts] = useState<Record<PolicyKind, number>>({ random: 2, greedy: 2, survival: 2, aggressive: 2, hybrid: 2, ppo: 0 });
  const [ppoModel, setPpoModel] = useState(models[0]?.id ?? '');
  const [seeds, setSeeds] = useState(6);
  const [seedBase, setSeedBase] = useState(500000);
  const [rotations, setRotations] = useState(2);
  const [seconds, setSeconds] = useState(120);
  const [report, setReport] = useState<TournamentReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<TournamentReport[]>([]);
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    if (!ppoModel && models[0]) setPpoModel(models[0].id);
  }, [models, ppoModel]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}results/index.json`).then((r) => (r.ok ? r.json() : [])).then(async (files: string[]) => {
      const reports = await Promise.all(files.map((f) => fetch(`${import.meta.env.BASE_URL}results/${f}`).then((r) => r.json() as Promise<TournamentReport>)));
      setReference(reports);
    }).catch(() => setReference([]));
    return () => worker.current?.terminate();
  }, []);

  const lineup: ParticipantSpec[] = BOT_KINDS.flatMap((k) => Array.from({ length: counts[k] }, () => (k === 'ppo' ? { kind: k, modelId: ppoModel } : { kind: k })));
  const matches = seeds * Math.max(1, Math.min(rotations, lineup.length));

  const run = () => {
    worker.current?.terminate();
    setError(null);
    setReport(null);
    const spec: TournamentSpec = {
      name: 'browser-tournament', lineup, seeds: Array.from({ length: seeds }, (_, i) => seedBase + i), rotations, maxSeconds: seconds, endWhenOneLeft: true,
    };
    const w = new Worker(new URL('../worker/tournament.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setProgress({ done: 0, total: matches });
    w.onmessage = (ev: MessageEvent<TournamentOut>) => {
      const m = ev.data;
      if (m.type === 'progress') { setProgress({ done: m.done, total: m.total }); setReport(m.partial); }
      else if (m.type === 'done') { setReport(m.report); setProgress(null); w.terminate(); worker.current = null; }
      else { setError(t.app.simError(m.message)); setProgress(null); }
    };
    w.postMessage({ type: 'run', spec, models: models.filter((f) => f.id === ppoModel) });
  };
  const cancel = () => { worker.current?.terminate(); worker.current = null; setProgress(null); };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row" data-testid="tournament-view">
      <aside className="shrink-0 border-b border-slate-200 bg-white md:w-80 md:border-b-0 md:border-r">
        <Section title={tr.presets}>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" disabled={p.counts.ppo !== undefined && models.length === 0}
                onClick={() => setCounts({ random: 0, greedy: 0, survival: 0, aggressive: 0, hybrid: 0, ppo: 0, ...p.counts })}
                className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-40 pointer-coarse:px-3 pointer-coarse:py-2">{tr.presetNames[p.id]}</button>
            ))}
          </div>
        </Section>
        <Section title={tr.lineup}>
          {BOT_KINDS.map((k) => (
            <Stepper key={k} label={t.policy.name(k)} value={counts[k]} dot={KIND_COLOURS[k]} max={k === 'ppo' && models.length === 0 ? 0 : 24}
              onChange={(v) => setCounts({ ...counts, [k]: v })} testId={`t-count-${k}`} />
          ))}
          {models.length > 0 && (
            <label className="flex items-center justify-between gap-2 text-sm text-slate-700">
              <span className="shrink-0">{tr.ppoModel}</span>
              <select value={ppoModel} onChange={(e) => setPpoModel(e.target.value)} className="min-w-0 max-w-44 rounded-md border border-slate-200 px-2 py-1 text-sm">
                {models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
              </select>
            </label>
          )}
        </Section>
        <Section title={tr.protocol}>
          <NumberField label={tr.seeds} value={seeds} min={1} max={200} onChange={setSeeds} testId="t-seeds" />
          <NumberField label={tr.firstSeed} value={seedBase} min={0} max={4294967295} onChange={setSeedBase} />
          <NumberField label={tr.rotations} value={rotations} min={1} max={Math.max(1, lineup.length)} onChange={setRotations} />
          <NumberField label={tr.timeLimit} value={seconds} min={10} max={900} step={10} onChange={setSeconds} suffix={tr.unitSeconds} testId="t-seconds" />
          <p className="text-[11px] leading-snug text-slate-400">{tr.protocolNote}</p>
        </Section>
        <div className="p-4">
          {progress ? (
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
              <div className="flex items-center justify-between text-xs text-slate-500"><span data-testid="t-progress">{tr.progress(progress.done, progress.total)}</span><button type="button" onClick={cancel} className="px-2 py-1 text-rose-600 hover:underline">{tr.cancel}</button></div>
            </div>
          ) : (
            <button type="button" onClick={run} disabled={lineup.length < 2} data-testid="t-run"
              className="h-11 w-full rounded-lg bg-indigo-500 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-40">{tr.run(matches)}</button>
          )}
          {error && <p className="mt-2 text-xs text-rose-600" role="alert">{error}</p>}
        </div>
      </aside>
      <main className="min-w-0 flex-1 space-y-6 p-4 md:p-6">
        {report ? <ReportView report={report} live={!!progress} /> : (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">{tr.empty}</div>
        )}
        {reference.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-500">{tr.reference}</h2>
            {reference.map((r) => <ReportView key={r.name} report={r} live={false} />)}
          </div>
        )}
      </main>
    </div>
  );
}

export function ReportView({ report, live }: { report: TournamentReport; live: boolean }) {
  const tr = t.tournament;
  const c = tr.cols;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const chart = report.entries.map((e) => ({
    label: t.policy.entryShort(e.label), win: +(e.winRate * 100).toFixed(1), winErr: [+(e.winRate * 100 - e.winRateCI[0] * 100).toFixed(1), +(e.winRateCI[1] * 100 - e.winRate * 100).toFixed(1)],
    survival: +e.avgSurvival.toFixed(1), survivalErr: +e.survivalCI.toFixed(1), mass: Math.round(e.avgFinalMass), massErr: Math.round(e.finalMassCI),
  }));
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-testid="t-report">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-800">{tr.reportNames[report.name] ?? report.name} {live && <span className="text-xs font-normal text-amber-600">{tr.running}</span>}</h3>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>{tr.meta(report.matches, report.spec.seeds.length, report.spec.maxSeconds, report.versions.rules)}</span>
          {!live && (
            <>
              <button type="button" className="text-indigo-600 hover:underline" onClick={() => downloadText(`${report.name}.json`, JSON.stringify(report, null, 1))}>JSON</button>
              {report.results.length > 0 && <button type="button" className="text-indigo-600 hover:underline" onClick={() => downloadText(`${report.name}.csv`, reportToCsv(report), 'text/csv')}>CSV</button>}
            </>
          )}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="whitespace-nowrap text-left text-[10px] tracking-wider text-slate-400">
            <tr><th className="py-1 pr-2">{c.policy}</th><th className="px-1 text-right">{c.n}</th><th className="px-1 text-right">{c.win}</th><th className="px-1 text-right">{c.rank}</th><th className="px-1 text-right">{c.survival}</th><th className="px-1 text-right">{c.mass}</th><th className="px-1 text-right">{c.peak}</th><th className="px-1 text-right">{c.kills}</th><th className="px-1 text-right">{c.eaten}</th><th className="px-1 text-right">{c.splits}</th><th className="px-1 text-right">{c.splitHit}</th><th className="px-1 text-right">{c.exchange}</th><th className="px-1 text-right">{c.aliveEnd}</th></tr>
          </thead>
          <tbody>
            {report.entries.map((e) => (
              <tr key={e.label} className="whitespace-nowrap border-t border-slate-50">
                <td className="py-1 pr-2 font-medium" style={{ color: KIND_COLOURS[e.kind] }}>{t.policy.entry(e.label)}</td>
                <td className="text-right tabular-nums">{e.samples}</td>
                <td className="text-right tabular-nums">{pct(e.winRate)} <span className="text-slate-400">[{pct(e.winRateCI[0])}, {pct(e.winRateCI[1])}]</span></td>
                <td className="text-right tabular-nums">{e.avgRank.toFixed(2)}</td>
                <td className="text-right tabular-nums">{e.avgSurvival.toFixed(1)} <span className="text-slate-400">±{e.survivalCI.toFixed(1)}</span></td>
                <td className="text-right tabular-nums">{e.avgFinalMass.toFixed(0)} <span className="text-slate-400">±{e.finalMassCI.toFixed(0)}</span></td>
                <td className="text-right tabular-nums">{e.avgMaxMass.toFixed(0)}</td>
                <td className="text-right tabular-nums">{e.avgKills.toFixed(2)}</td>
                <td className="text-right tabular-nums">{e.avgCellsEaten.toFixed(2)}</td>
                <td className="text-right tabular-nums">{e.avgSplits.toFixed(1)}</td>
                <td className="text-right tabular-nums">{pct(e.splitSuccessRate)}</td>
                <td className="text-right tabular-nums">{e.exchangeRatio.toFixed(2)}</td>
                <td className="text-right tabular-nums">{pct(e.survivedToEnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {([['win', 'winErr', tr.charts.win], ['survival', 'survivalErr', tr.charts.survival], ['mass', 'massErr', tr.charts.mass]] as const).map(([key, err, title]) => (
          <div key={key} className="h-48">
            <div className="mb-1 text-xs font-medium text-slate-500">{title} <span className="font-normal text-slate-400">· {tr.charts.errorBars}</span></div>
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                <YAxis tick={{ fontSize: 10 }} width={36} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Bar dataKey={key} fill="#818cf8" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                  <ErrorBar dataKey={err} width={4} stroke="#334155" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{tr.note}</p>
    </section>
  );
}
