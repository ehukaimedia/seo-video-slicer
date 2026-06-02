/**
 * FpsControl — fps presets 3/6/12 + custom, with the live fps auto-suggest
 * (API.md §1.1) surfaced next to the control. The suggestion is the highest
 * preset that keeps the projected count in the hero band for the current span.
 */
import { FPS_PRESETS } from '../config';
import { suggestFps } from '../lib/budget';

interface Props {
  fps: number;
  start: number;
  end: number;
  onChange: (fps: number) => void;
}

export function FpsControl({ fps, start, end, onChange }: Props) {
  const suggestion = suggestFps(start, end);
  const presets: number[] = [...FPS_PRESETS];
  const isPreset = presets.includes(fps);

  return (
    <div className="field">
      <label htmlFor="fps-custom">Frame rate</label>
      <div className="row">
        <div className="fps-presets" role="group" aria-label="fps presets">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              className="fps-chip"
              data-active={fps === p}
              aria-pressed={fps === p}
              onClick={() => onChange(p)}
            >
              {p} fps
            </button>
          ))}
        </div>
        <input
          id="fps-custom"
          className="ds-input fps-custom"
          type="number"
          min={1}
          max={30}
          step={1}
          value={isPreset ? '' : fps}
          placeholder="custom"
          aria-label="Custom fps"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) onChange(v);
          }}
        />
      </div>
      {suggestion !== null && suggestion !== fps ? (
        <span className="fps-suggest">
          Suggested {suggestion} fps keeps this range in the hero band.
          <button className="ds-link" onClick={() => onChange(suggestion)}>
            use {suggestion}
          </button>
        </span>
      ) : (
        <span className="fps-suggest">
          {suggestion === null
            ? 'No fps keeps this range under the frame cap. Shorten the range.'
            : 'fps is set for the hero band.'}
        </span>
      )}
    </div>
  );
}
