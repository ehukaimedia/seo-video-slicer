/** Toast — a panel-deep pill confirming an action, auto-dismissing. */
import { useEffect } from 'react';
import { useStore } from '../state/store';

export function Toast() {
  const { state, dispatch } = useStore();
  const text = state.toast;

  useEffect(() => {
    if (!text) return;
    const id = window.setTimeout(() => dispatch({ type: 'toast', message: null }), 3200);
    return () => window.clearTimeout(id);
  }, [text, dispatch]);

  if (!text) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      <div className="ds-toast" key={text}>
        <span className="ds-toast-dot" aria-hidden="true" />
        {text}
      </div>
    </div>
  );
}
