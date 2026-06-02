/**
 * config.ts — the frontend mirror of `backend/app/config.py` (API.md §1).
 *
 * CONTRACT RULE: the locked numeric literals (10, 60, 82, 200, 4 MB, 256 KB,
 * 20, 80) appear on the frontend ONLY in this file. The budget meter and the
 * trim clamp read from here. There is no `/api/config` endpoint — these are
 * compile-time constants, and the BACKEND is the authoritative enforcer; this
 * mirror is a UX convenience so the meter and clamp never disagree silently.
 */

/** Out-point auto-set on import (hero sweet spot, spec §5.1). */
export const DEFAULT_SLICE_SECONDS = 10;

/** Hard ceiling on `end - start` for preview (spec §5.1). */
export const MAX_SLICE_SECONDS = 60;

/** WebP encode quality for finalize/package frames. Valid 82–90. */
export const WEBP_QUALITY = 82;

/** Total-package SOFT cap (warn only) — mirrors CONTRACT.md §4. */
export const WEIGHT_BUDGET_BYTES = 4_194_304; // ≈ 4 MB

/** Per-frame SOFT cap (warn only) — mirrors CONTRACT.md §4. */
export const PER_FRAME_BUDGET_BYTES = 262_144; // 256 KB

/** Frame-count HARD cap (mirrors verify.mjs G7). The packager is the backstop. */
export const FRAME_COUNT_HARD_MAX = 200;

/** Hero/loop ideal band for the budget meter (spec §5.1). */
export const HERO_LANE_MIN = 20;
export const HERO_LANE_MAX = 80;

/** fps presets offered in the trim step (spec §5). Custom is allowed alongside. */
export const FPS_PRESETS = [3, 6, 12] as const;
