/**
 * TrimStep — Step 02. The dark Media Stage holds the live <video> preview; the
 * dual-handle slider is bound to the playhead; numeric in/out inputs mirror it;
 * fps presets + custom sit beside the live budget meter (spec §5, §5.1). "Slice"
 * POSTs /preview. The whole stage is neutral-dark so frames grade true.
 */
import { useMemo, useRef, useState } from 'react';
import { MAX_SLICE_SECONDS } from '../config';
import { computeBudget } from '../lib/budget';
import { timecode } from '../lib/format';
import { useActions } from '../state/actions';
import { useStore } from '../state/store';
import { TrimSlider } from '../components/TrimSlider';
import { FpsControl } from '../components/FpsControl';
import { BudgetMeter } from '../components/BudgetMeter';

export function TrimStep() {
  const { state, dispatch } = useStore();
  const { slicePreview } = useActions();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playhead, setPlayhead] = useState(0);

  const job = state.job;
  const { start, end, fps } = state.trim;

  const readout = useMemo(
    () =>
      computeBudget(start, end, fps, job?.width ?? 1280, job?.height ?? 720),
    [start, end, fps, job?.width, job?.height],
  );

  if (!job) return null;

  const videoSrc = `/data/jobs/${job.jobId}/video.mp4`;

  function scrub(time: number) {
    setPlayhead(time);
    if (videoRef.current) videoRef.current.currentTime = time;
  }

  const busy = state.busy !== null;
  const overCap = readout.blocked;

  return (
    <div className="stack">
      <div className="step-head">
        <span className="ds-eyebrow">Step 02</span>
        <h1 className="ds-headline">Trim</h1>
        <p className="ds-lead">
          Set the in and out points. Duration is governed by the frame and weight
          budget, not a fixed wall. The stage is dark so you read the frame true.
        </p>
      </div>

      <div className="ds-stage stack">
        <video
          ref={videoRef}
          className="ds-stage-preview"
          src={videoSrc}
          poster={job.thumbUrl}
          controls
          playsInline
          onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
        />
        <div className="trim-head">
          <span className="ds-eyebrow">Trim Segment Bounds</span>
          <span className="trim-span">
            {start.toFixed(2)}S — {end.toFixed(2)}S ({(end - start).toFixed(2)}S SPAN)
          </span>
        </div>
        <TrimSlider
          duration={job.durationS}
          start={start}
          end={end}
          playhead={playhead}
          onChange={(next) => dispatch({ type: 'setTrim', patch: next })}
          onScrub={scrub}
        />
        <div className="row-between">
          <span className="ds-stage-timecode">
            playhead {timecode(playhead)} / {timecode(job.durationS)}
          </span>
          <span className="ds-stage-timecode">
            {job.fps !== null ? `source ${job.fps.toFixed(0)} fps` : 'source fps —'}
          </span>
        </div>
      </div>

      <div className="row" style={{ gap: 32, alignItems: 'flex-end' }}>
        <div className="field">
          <label htmlFor="trim-start">Start (s)</label>
          <input
            id="trim-start"
            className="input-field"
            type="number"
            min={0}
            max={Math.max(0, end - 0.1)}
            step={0.1}
            value={start}
            onChange={(e) => {
              const v = Math.max(0, Math.min(Number(e.target.value), end - 0.1));
              dispatch({ type: 'setTrim', patch: { start: v } });
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="trim-end">End (s)</label>
          <input
            id="trim-end"
            className="input-field"
            type="number"
            min={start + 0.1}
            max={Math.min(job.durationS, start + MAX_SLICE_SECONDS)}
            step={0.1}
            value={end}
            onChange={(e) => {
              const cap = Math.min(job.durationS, start + MAX_SLICE_SECONDS);
              const v = Math.min(cap, Math.max(Number(e.target.value), start + 0.1));
              dispatch({ type: 'setTrim', patch: { end: v } });
            }}
          />
        </div>
        <FpsControl
          fps={fps}
          start={start}
          end={end}
          onChange={(v) => dispatch({ type: 'setTrim', patch: { fps: v } })}
        />
      </div>

      <span className="ds-mono" style={{ color: 'var(--ink-muted)' }}>
        {readout.count} frames · cap {readout.lane === 'over' ? 'EXCEEDED' : 'ok'}
      </span>

      <BudgetMeter readout={readout} />

      <div className="actions">
        <button
          className="btn-primary"
          disabled={busy || overCap || end - start <= 0}
          onClick={() => void slicePreview()}
        >
          {busy ? 'Extracting…' : 'Slice Frame Sequence'}
        </button>
        {overCap ? (
          <span className="ds-supporting" style={{ color: 'var(--danger)' }}>
            Over the frame cap. Lower fps or shorten the range to slice.
          </span>
        ) : (
          <span className="ds-supporting">
            Extracts {readout.count} preview frames for review.
          </span>
        )}
      </div>
    </div>
  );
}
