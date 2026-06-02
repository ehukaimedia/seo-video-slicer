/**
 * ReviewStep — Step 03. The preview filmstrip on the dark stage, each frame with
 * an exclude toggle; click a frame to zoom the lightbox (spec §5). "Finalize"
 * POSTs /finalize with the excluded list, promoting kept frames to a WebP slice.
 */
import { useMemo, useState } from 'react';
import type { FrameRef } from '../api/types';
import { useActions } from '../state/actions';
import { useStore } from '../state/store';
import { Filmstrip } from '../components/Filmstrip';
import { Lightbox } from '../components/Lightbox';

export function ReviewStep() {
  const { state, dispatch } = useStore();
  const { finalizeSlice } = useActions();
  const [zoom, setZoom] = useState<FrameRef | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [thumbSize, setThumbSize] = useState(132);

  const preview = state.preview;
  const kept = useMemo(
    () => (preview ? preview.count - state.excluded.size : 0),
    [preview, state.excluded],
  );

  if (!preview) return null;

  const busy = state.busy !== null;
  const noKept = kept <= 0;

  return (
    <div className="stack">
      <div className="step-head">
        <span className="ds-eyebrow">Step 03</span>
        <h1 className="ds-headline">Frame Review</h1>
        <p className="ds-lead">
          Drop hallucinated or bad frames before they become a slice. Toggle a
          frame to exclude it; click to pixel-peep in the lightbox. Kept frames
          re-index contiguously on finalize.
        </p>
      </div>

      <div className="ds-stage stack">
        <div className="row-between">
          <span className="ds-stage-timecode">
            {preview.count} preview frames · {state.excluded.size} excluded ·{' '}
            {kept} kept
          </span>
          <div className="zoom-row">
            <span className="ds-stage-timecode">Zoom</span>
            <input
              type="range"
              min={96}
              max={240}
              step={4}
              value={thumbSize}
              aria-label="Thumbnail zoom"
              onChange={(e) => setThumbSize(Number(e.target.value))}
            />
          </div>
        </div>
        <div style={{ ['--thumb-size' as string]: `${thumbSize}px` } as React.CSSProperties}>
          <Filmstrip
            frames={preview.frames}
            activeName={active}
            excluded={state.excluded}
            onActivate={setActive}
            onToggleExclude={(name) => dispatch({ type: 'toggleExclude', name })}
            onZoom={setZoom}
          />
        </div>
      </div>

      <div className="actions">
        <button
          className="btn-primary"
          disabled={busy || noKept}
          onClick={() => void finalizeSlice()}
        >
          {busy ? 'Finalizing…' : 'Finalize Slice'}
        </button>
        {noKept ? (
          <span className="ds-supporting" style={{ color: 'var(--danger)' }}>
            A slice needs at least one frame. Keep one.
          </span>
        ) : (
          <button className="ds-link" onClick={() => dispatch({ type: 'goto', step: 'trim' })}>
            Back to trim
          </button>
        )}
      </div>

      {zoom ? (
        <Lightbox
          src={zoom.url}
          label={zoom.name.replace(/\.\w+$/, '')}
          onClose={() => setZoom(null)}
        />
      ) : null}
    </div>
  );
}
