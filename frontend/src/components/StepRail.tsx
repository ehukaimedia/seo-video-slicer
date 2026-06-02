/**
 * StepRail — the pipeline crumbs above the working column. Walks Import → Trim →
 * Review → Clean → Export. The Electric-Blue accent marks the active step (an
 * accent hairline border); steps the user has not reached yet are disabled.
 */
import { useStore, type Step } from '../state/store';

interface RailStep {
  step: Step;
  label: string;
}

const STEPS: RailStep[] = [
  { step: 'upload', label: 'Import' },
  { step: 'trim', label: 'Trim' },
  { step: 'review', label: 'Frame Review' },
  { step: 'clean', label: 'Clean' },
  { step: 'export', label: 'Export' },
];

const ORDER: Step[] = ['upload', 'trim', 'review', 'clean', 'export'];

export function StepRail() {
  const { state, dispatch } = useStore();
  const currentIndex = ORDER.indexOf(state.step);

  function reachable(step: Step): boolean {
    const idx = ORDER.indexOf(step);
    if (idx <= currentIndex) return true;
    // The next step is reachable only when its precondition is met.
    if (step === 'trim') return Boolean(state.job);
    if (step === 'review') return Boolean(state.preview);
    if (step === 'clean') return Boolean(state.sliceId);
    if (step === 'export') return Boolean(state.pkg);
    return false;
  }

  return (
    <nav className="app-rail" aria-label="Pipeline steps">
      {STEPS.map(({ step, label }, i) => {
        const idx = ORDER.indexOf(step);
        const active = state.step === step;
        const done = idx < currentIndex;
        const enabled = reachable(step);
        return (
          <button
            key={step}
            type="button"
            className="rail-step"
            data-active={active}
            data-done={done}
            disabled={!enabled}
            aria-current={active ? 'step' : undefined}
            onClick={() => enabled && dispatch({ type: 'goto', step })}
          >
            <span className="num">{String(i + 1).padStart(2, '0')}</span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
