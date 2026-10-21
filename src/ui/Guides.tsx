import { t } from '../i18n';
import { Sheet, safeStorage } from './kit';

const ONBOARDING_NEVER = 'nebulousai.onboarding.never';
const ONBOARDING_SEEN = 'nebulousai.onboarding.seen';

/** Whether the first-visit guide should open when entering Play (not dismissed for good, not yet seen this session). */
export function shouldShowOnboarding(): boolean {
  return safeStorage.get('local', ONBOARDING_NEVER) !== '1' && safeStorage.get('session', ONBOARDING_SEEN) !== '1';
}

function Keys({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt><kbd className="inline-block min-w-12 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-center text-xs font-semibold text-slate-700 shadow-[inset_0_-1px_0_#e2e8f0]">{k}</kbd></dt>
          <dd className="text-slate-600">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "조작법": PC and mobile controls; the section for the current device comes first. */
export function ControlsHelp({ onClose, touch }: { onClose: () => void; touch: boolean }) {
  const pc = (
    <section key="pc">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t.controls.pc}</h3>
      <Keys items={t.controls.pcItems} />
    </section>
  );
  const mobile = (
    <section key="mobile">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t.controls.mobile}</h3>
      <Keys items={t.controls.mobileItems} />
    </section>
  );
  return (
    <Sheet title={t.controls.title} onClose={onClose} testId="controls-help">
      <div className="space-y-5">
        {touch ? [mobile, pc] : [pc, mobile]}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t.controls.rules}</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">{t.onboarding.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </section>
      </div>
    </Sheet>
  );
}

/** First visit to Play: five rules, then start. The game stays paused while this is open. */
export function Onboarding({ onStart, onShowControls }: { onStart: () => void; onShowControls: () => void }) {
  const start = (never: boolean) => {
    safeStorage.set('session', ONBOARDING_SEEN, '1');
    if (never) safeStorage.set('local', ONBOARDING_NEVER, '1');
    onStart();
  };
  return (
    <Sheet title={t.onboarding.title} onClose={() => start(false)} testId="onboarding"
      footer={(
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" onClick={() => start(false)} data-testid="onboarding-start" autoFocus
            className="h-11 flex-1 rounded-lg bg-indigo-500 text-sm font-semibold text-white hover:bg-indigo-600">{t.onboarding.start}</button>
          <button type="button" onClick={() => start(true)} data-testid="onboarding-never"
            className="h-11 flex-1 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">{t.onboarding.never}</button>
        </div>
      )}>
      <p className="text-sm text-slate-600">{t.onboarding.intro}</p>
      <ol className="mt-3 space-y-2">
        {t.onboarding.steps.map((s, i) => (
          <li key={s} className="flex gap-3 text-sm text-slate-700">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={onShowControls} data-testid="onboarding-controls" className="mt-3 text-sm font-medium text-indigo-600 hover:underline">{t.onboarding.controlsLink} →</button>
    </Sheet>
  );
}
