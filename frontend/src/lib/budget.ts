/**
 * budget.ts — the frame/weight budget meter (API.md §1.1, spec §5.1).
 *
 * Pure functions, no React. The frontend mirror of the backend `budget.py`
 * rule. Frame COUNT is the hard governor (G7 backstop); weight is advisory.
 * All numeric thresholds come from config.ts (the one home for the locked
 * literals on the frontend).
 */
import {
  FPS_PRESETS,
  FRAME_COUNT_HARD_MAX,
  HERO_LANE_MAX,
  HERO_LANE_MIN,
  PER_FRAME_BUDGET_BYTES,
  WEIGHT_BUDGET_BYTES,
} from '../config';
import type { Lane } from '../api/types';

/** Projected frame count = round((end - start) × fps) (API.md §1.1). */
export function projectedFrameCount(
  start: number,
  end: number,
  fps: number,
): number {
  const span = Math.max(0, end - start);
  return Math.round(span * fps);
}

/** Lane from a frame count (API.md §1.1 / §7.3). */
export function laneForCount(count: number): Lane {
  if (count > FRAME_COUNT_HARD_MAX) return 'over';
  if (count > HERO_LANE_MAX) return 'scrollytelling';
  return 'hero';
}

/**
 * A coarse pre-extraction per-frame byte estimate, scaled by source area.
 * The contract gives no exact formula before extraction, so this is LABELLED
 * projected; the authoritative `weight_mb` comes back from /package. Tuned so a
 * 1280×720 q82 WebP frame lands near a realistic ~30 KB.
 */
export function estimatedFrameBytes(width: number, height: number): number {
  const REFERENCE_AREA = 1280 * 720;
  const REFERENCE_BYTES = 30_000; // ~30 KB for a 720p q82 WebP frame
  const area = Math.max(1, width * height);
  return Math.round((area / REFERENCE_AREA) * REFERENCE_BYTES);
}

export type MeterTone = 'hero' | 'warn' | 'over';

export interface BudgetReadout {
  count: number;
  lane: Lane;
  tone: MeterTone;
  /** Projected total package weight in bytes (advisory). */
  projectedBytes: number;
  projectedMb: number;
  /** Position of the count on the 0..hard-max meter, as a 0..1 fraction. */
  fill: number;
  /** True when count > hard max — the one BLOCKING condition (red). */
  blocked: boolean;
  /** True when weight is advisory-over (soft cap) — amber, never blocks. */
  weightWarn: boolean;
  /** Plain, decisive copy for the meter (no hedging — PRODUCT.md voice). */
  message: string;
}

/** Compute the live meter readout for the current trim + fps. */
export function computeBudget(
  start: number,
  end: number,
  fps: number,
  width: number,
  height: number,
): BudgetReadout {
  const count = projectedFrameCount(start, end, fps);
  const lane = laneForCount(count);
  const perFrame = estimatedFrameBytes(width, height);
  const projectedBytes = count * perFrame;
  const projectedMb = projectedBytes / (1024 * 1024);

  const blocked = lane === 'over';
  const weightWarn =
    projectedBytes > WEIGHT_BUDGET_BYTES || perFrame > PER_FRAME_BUDGET_BYTES;

  let tone: MeterTone;
  let message: string;
  if (blocked) {
    tone = 'over';
    message = `${count} frames exceeds the ${FRAME_COUNT_HARD_MAX}-frame cap. Lower fps or shorten the range.`;
  } else if (lane === 'scrollytelling') {
    tone = 'warn';
    message = `${count} frames. Scrollytelling lane (${HERO_LANE_MAX + 1}–${FRAME_COUNT_HARD_MAX}). Heavier package; fine for long-form.`;
  } else if (count < HERO_LANE_MIN) {
    tone = 'hero';
    message = `${count} frames. Below the ${HERO_LANE_MIN}-frame hero band; raise fps for smoother motion.`;
  } else {
    tone = 'hero';
    message = `${count} frames. Hero lane (${HERO_LANE_MIN}–${HERO_LANE_MAX}). Clean and lazy-loadable.`;
  }

  // The fill maps the count onto the meter; the hard max anchors the right end.
  const fill = Math.min(1, count / FRAME_COUNT_HARD_MAX);

  return {
    count,
    lane,
    tone,
    projectedBytes,
    projectedMb,
    fill,
    blocked,
    weightWarn,
    message,
  };
}

/**
 * fps auto-suggest (API.md §1.1): the highest preset fps that keeps the
 * projected count within the hero band (≤ HERO_LANE_MAX) for the current span,
 * so a long duration never silently produces hundreds of frames. Falls back to
 * the lowest preset that at least stays under the hard cap; null if even that
 * fails (the user must shorten the range).
 */
export function suggestFps(start: number, end: number): number | null {
  const span = Math.max(0, end - start);
  if (span <= 0) return null;
  const presets = [...FPS_PRESETS].sort((a, b) => b - a); // high → low
  for (const fps of presets) {
    if (Math.round(span * fps) <= HERO_LANE_MAX) return fps;
  }
  for (const fps of [...FPS_PRESETS].sort((a, b) => a - b)) {
    if (Math.round(span * fps) <= FRAME_COUNT_HARD_MAX) return fps;
  }
  return null;
}
