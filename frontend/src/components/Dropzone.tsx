/**
 * Dropzone — the first-run empty state (PRODUCT register: onboard nicely).
 * Drag a video or browse. On a file, POST /api/upload via the upload action.
 * Hand-rolled (no UI lib). Teaches the interface rather than saying "nothing
 * here": it states exactly what to drop and what comes out.
 */
import { useCallback, useRef, useState } from 'react';
import { useActions } from '../state/actions';
import { useStore } from '../state/store';

const ACCEPT = 'video/mp4,video/quicktime,video/webm';

export function Dropzone() {
  const { uploadVideo } = useActions();
  const { state } = useStore();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = state.busy !== null;

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void uploadVideo(file);
    },
    [uploadVideo],
  );

  return (
    <div className="stack">
      <div className="step-head">
        <span className="ds-eyebrow">Step 01</span>
        <h1 className="ds-headline">Import</h1>
        <p className="ds-lead">
          Drop a short clip. The slicer trims it, cleans the frames, and exports a
          drop-in WebP animation package: frames, a self-contained scroll player,
          a manifest, and a verify gate. The default slice is ten seconds.
        </p>
      </div>

      <div
        className="dropzone"
        data-drag={dragging}
        role="button"
        tabIndex={0}
        aria-label="Drop a video file or press Enter to browse"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) onFiles(e.dataTransfer.files);
        }}
      >
        <span className="glyph" aria-hidden="true">
          ⌖
        </span>
        <h2 className="ds-title">
          {busy ? 'Reading your clip' : 'Drag a video here'}
        </h2>
        <p className="ds-supporting">
          {busy
            ? 'Probing duration and dimensions, making a poster frame.'
            : 'Or click to browse. MP4, MOV, and WebM up to sixty seconds of usable range.'}
        </p>
        <span className="hint">MP4 · MOV · WEBM</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>
    </div>
  );
}
