/**
 * ShareToggle — the Local / Tailscale segmented pill in the top bar. Shows the
 * active reachable URL in mono with a copy icon-btn. Data comes from GET
 * /api/share (API.md §8.2); `lan`/`tailscale` may be null, so the toggle
 * degrades — a null target is disabled, and the copy button no-ops without a URL.
 */
import { useEffect, useState } from 'react';
import { useActions } from '../state/actions';
import { useStore } from '../state/store';
import { CopyIcon, CheckIcon } from './Icons';

type Mode = 'local' | 'tailscale';

export function ShareToggle() {
  const { state, dispatch } = useStore();
  const { loadShare } = useActions();
  const [mode, setMode] = useState<Mode>('local');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!state.share) void loadShare();
  }, [state.share, loadShare]);

  const share = state.share;
  const url = mode === 'local' ? share?.local ?? null : share?.tailscale ?? null;
  const tailscaleAvailable = Boolean(share?.tailscale);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      dispatch({ type: 'toast', message: 'Share URL copied.' });
    } catch {
      dispatch({ type: 'toast', message: 'Could not copy URL.' });
    }
  }

  return (
    <>
      <div className="segmented" role="group" aria-label="Share mode">
        <button
          type="button"
          className="segmented-btn"
          data-active={mode === 'local'}
          onClick={() => setMode('local')}
        >
          Local
        </button>
        <button
          type="button"
          className="segmented-btn"
          data-active={mode === 'tailscale'}
          disabled={!tailscaleAvailable}
          title={tailscaleAvailable ? undefined : 'Not on a tailnet'}
          onClick={() => tailscaleAvailable && setMode('tailscale')}
        >
          Tailscale
        </button>
      </div>
      <span className="share-url" title={url ?? undefined}>
        {url ?? '—'}
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label="Copy share URL"
        disabled={!url}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      </button>
    </>
  );
}
