/**
 * BudgetMeter — the live frame-count + projected-weight rail (spec §5.1).
 *
 * Mirrors the backend budget rule via lib/budget.ts (the locked thresholds live
 * in config.ts). Frame COUNT is the hard governor; the over-cap lane is the one
 * blocking (red) condition. Weight is advisory. The band marks at 20/80/200 show
 * the hero/scrollytelling/over lanes on the bar.
 */
import {
  FRAME_COUNT_HARD_MAX,
  HERO_LANE_MAX,
  HERO_LANE_MIN,
} from '../config';
import type { BudgetReadout } from '../lib/budget';
import { mb } from '../lib/format';

interface Props {
  readout: BudgetReadout;
}

export function BudgetMeter({ readout }: Props) {
  const heroMin = (HERO_LANE_MIN / FRAME_COUNT_HARD_MAX) * 100;
  const heroMax = (HERO_LANE_MAX / FRAME_COUNT_HARD_MAX) * 100;

  return (
    <div className="meter" aria-live="polite">
      <div className="row-between">
        <span className="ds-eyebrow">Frame &amp; weight budget</span>
        <span className="ds-mono" style={{ color: 'var(--ink-muted)' }}>
          lane: {readout.lane}
        </span>
      </div>
      <div className="meter-bar" role="img" aria-label={`${readout.count} frames`}>
        <div
          className="meter-fill"
          data-tone={readout.tone}
          style={{ width: `${readout.fill * 100}%` }}
        />
        <div className="meter-bands" aria-hidden="true">
          <span className="meter-band-mark" style={{ left: `${heroMin}%` }} />
          <span className="meter-band-mark" style={{ left: `${heroMax}%` }} />
        </div>
      </div>
      <div className="meter-readout">
        <span className="ds-mono" style={{ color: 'var(--ink-secondary)' }}>
          {readout.count} frames · ~{mb(readout.projectedMb)} projected
        </span>
        <span className="ds-mono" style={{ color: 'var(--ink-muted)' }}>
          cap {FRAME_COUNT_HARD_MAX}
        </span>
      </div>
      <p className="meter-msg" data-tone={readout.tone}>
        {readout.message}
        {readout.weightWarn && !readout.blocked
          ? ' Weight is approaching the package soft cap.'
          : ''}
      </p>
    </div>
  );
}
