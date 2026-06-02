/** Banners — the single error envelope view + an in-flight busy indicator. */
import { useStore } from '../state/store';

export function ErrorBanner() {
  const { state, dispatch } = useStore();
  if (!state.error) return null;
  return (
    <div className="error-banner" role="alert">
      <span>{state.error}</span>
      <button
        className="ds-link"
        onClick={() => dispatch({ type: 'error', message: null })}
        aria-label="Dismiss error"
      >
        Dismiss
      </button>
    </div>
  );
}

export function BusyBanner() {
  const { state } = useStore();
  if (!state.busy) return null;
  return (
    <div className="busy-banner" role="status" aria-live="polite">
      <span className="busy-dot" aria-hidden="true" />
      {state.busy}…
    </div>
  );
}
