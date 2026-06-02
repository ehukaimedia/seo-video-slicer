/**
 * TrimSlider — the dual-handle in/out control (the signature dual-range).
 *
 * A single track with two white thumbs (accent-ringed) over the dark stage; the
 * selected span is filled with the Electric-Blue accent, and a thin playhead
 * marks the video's current time. Handles are keyboard-accessible sliders (ARIA).
 * The clamp uses MAX_SLICE_SECONDS from config so the slider and the backend
 * never disagree (API.md §6.1).
 */
import { useCallback, useRef } from 'react';
import { MAX_SLICE_SECONDS } from '../config';
import { timecode } from '../lib/format';

interface Props {
  duration: number;
  start: number;
  end: number;
  playhead: number;
  onChange: (next: { start: number; end: number }) => void;
  onScrub: (time: number) => void;
}

const MIN_SPAN = 0.1; // keep in < out with a hair of separation

function pct(value: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(100, (value / duration) * 100));
}

/**
 * Position inside the padded track as a valid CSS calc. The track has 12px of
 * padding each side, so the usable width is `(100% - 24px)`. CSS `calc` requires
 * a unitless operand for `*` and `/`, so the percent is passed unitless and
 * divided by a plain 100 (NOT `100%`). An offset shifts handles vs. the range.
 */
function trackPos(percent: number, offsetPx: number): string {
  return `calc(${offsetPx}px + ${percent} * (100% - 24px) / 100)`;
}

export function TrimSlider({ duration, start, end, playhead, onChange, onScrub }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);

  const timeFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const frac = (clientX - rect.left) / Math.max(1, rect.width);
      return Math.max(0, Math.min(duration, frac * duration));
    },
    [duration],
  );

  const beginDrag = useCallback(
    (handle: 'start' | 'end') => (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const move = (ev: PointerEvent) => {
        const t = timeFromClientX(ev.clientX);
        if (handle === 'start') {
          const next = Math.min(t, end - MIN_SPAN);
          onChange({ start: Math.max(0, next), end });
          onScrub(Math.max(0, next));
        } else {
          // Clamp the out-point so the span never exceeds the contract ceiling.
          const maxEnd = Math.min(duration, start + MAX_SLICE_SECONDS);
          const next = Math.max(start + MIN_SPAN, Math.min(t, maxEnd));
          onChange({ start, end: next });
          onScrub(next);
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [start, end, duration, onChange, onScrub, timeFromClientX],
  );

  const onKey = useCallback(
    (handle: 'start' | 'end') => (e: React.KeyboardEvent) => {
      const stepBase = e.shiftKey ? 1 : 0.1;
      let delta = 0;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -stepBase;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = stepBase;
      else return;
      e.preventDefault();
      if (handle === 'start') {
        const next = Math.max(0, Math.min(start + delta, end - MIN_SPAN));
        onChange({ start: next, end });
      } else {
        const maxEnd = Math.min(duration, start + MAX_SLICE_SECONDS);
        const next = Math.min(maxEnd, Math.max(end + delta, start + MIN_SPAN));
        onChange({ start, end: next });
      }
    },
    [start, end, duration, onChange],
  );

  const startPct = pct(start, duration);
  const endPct = pct(end, duration);
  const headPct = pct(playhead, duration);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div
        className="ds-trim"
        ref={trackRef}
        onPointerDown={(e) => {
          // Click-to-scrub on the track body (not on a handle).
          if ((e.target as HTMLElement).classList.contains('ds-trim-handle')) return;
          onScrub(timeFromClientX(e.clientX));
        }}
      >
        <div className="ds-trim-track" />
        <div
          className="ds-trim-range"
          style={{
            left: trackPos(startPct, 12),
            width: `calc(${endPct - startPct} * (100% - 24px) / 100)`,
          }}
        />
        <div
          className="ds-trim-playhead"
          style={{ left: trackPos(headPct, 12) }}
          aria-hidden="true"
        />
        <button
          type="button"
          className="ds-trim-handle"
          style={{ left: trackPos(startPct, 12) }}
          role="slider"
          aria-label="In point"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Number(start.toFixed(1))}
          aria-valuetext={timecode(start)}
          tabIndex={0}
          onPointerDown={beginDrag('start')}
          onKeyDown={onKey('start')}
        />
        <button
          type="button"
          className="ds-trim-handle"
          style={{ left: trackPos(endPct, 12) }}
          role="slider"
          aria-label="Out point"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Number(end.toFixed(1))}
          aria-valuetext={timecode(end)}
          tabIndex={0}
          onPointerDown={beginDrag('end')}
          onKeyDown={onKey('end')}
        />
      </div>
      <div className="ds-trim-readout row-between">
        <span>in {timecode(start)}</span>
        <span>span {timecode(end - start)}</span>
        <span>out {timecode(end)}</span>
      </div>
    </div>
  );
}
