/**
 * Header — the slicer top bar. Left: a green pulse-dot + "SLICER READY" in mono
 * uppercase, then the open clip's source meta. Right: the Local/Tailscale share
 * toggle and a back-to-Library link. Dark studio; system fonts only.
 *
 * NOTE: a re-opened job (GET §5.2) carries no source `fps`, so `job.fps` may be
 * null — the readout guards it rather than calling `.toFixed` on null.
 */
import { useStore } from '../state/store';
import { ShareToggle } from './ShareToggle';

export function Header() {
  const { state, dispatch } = useStore();
  const job = state.job;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="pulse-dot" aria-hidden="true" />
        <span className="topbar-status">Slicer Ready</span>
        {job ? (
          <span className="ds-mono" style={{ marginLeft: 14, color: 'var(--ink-muted)' }}>
            {job.filename} · {job.width}×{job.height}
            {job.fps !== null ? ` · ${job.fps.toFixed(0)} fps` : ''}
          </span>
        ) : null}
      </div>
      <div className="topbar-right">
        <button
          className="ds-link"
          onClick={() => dispatch({ type: 'goDashboard' })}
        >
          ‹ Library
        </button>
        <ShareToggle />
      </div>
    </header>
  );
}
