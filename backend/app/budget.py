"""Frame-budget projection, lane classification, and fps auto-suggest (API.md §1.1).

The backend is the authoritative enforcer of the §5.1 budget rule; the frontend
``BudgetMeter`` mirrors the same arithmetic for UX. This module is the single source
of that rule on the backend side and feeds the ``lane`` field in the package
response and any advisory weight warnings.
"""

from __future__ import annotations

from .config import (
    FRAME_COUNT_HARD_MAX,
    HERO_LANE_MAX,
    HERO_LANE_MIN,
    PER_FRAME_BUDGET_BYTES,
    WEIGHT_BUDGET_BYTES,
)

#: fps presets the auto-suggest walks (highest-first preference, plus the meter UI).
FPS_PRESETS: tuple[int, ...] = (12, 6, 3)


def projected_frame_count(start: float, end: float, fps: float) -> int:
    """Projected frame count for a trim range (API.md §1.1): ``round((end-start)*fps)``."""
    return round((end - start) * fps)


def lane_for_count(count: int) -> str:
    """Classify a frame count into a lane: ``hero`` | ``scrollytelling`` | ``over``.

    Bands (API.md §1.1): hero 20–80 (ideal), scrollytelling 81–200 (allowed, amber),
    over >200 (hard-blocked by G7). Counts below the hero floor still read as the
    hero lane so a tiny clip has a valid lane (the meter handles the "too few"
    advisory separately).
    """
    if count > FRAME_COUNT_HARD_MAX:
        return "over"
    if count <= HERO_LANE_MAX:
        return "hero"
    return "scrollytelling"


def suggest_fps(start: float, end: float) -> int:
    """Highest preset fps keeping the projected count inside the hero/scrollytelling band.

    As duration rises this prevents 60 s silently producing ~720 frames (spec §5.1).
    Returns the highest preset whose projected count stays ``<= FRAME_COUNT_HARD_MAX``,
    preferring counts within the hero band; falls back to the lowest preset.
    """
    duration = max(0.0, end - start)
    if duration <= 0:
        return FPS_PRESETS[0]
    # Prefer the highest fps that lands in the hero band; otherwise the highest that
    # stays under the hard cap; otherwise the slowest preset.
    in_hero = [f for f in FPS_PRESETS if projected_frame_count(start, end, f) <= HERO_LANE_MAX]
    if in_hero:
        return max(in_hero)
    under_cap = [
        f for f in FPS_PRESETS if projected_frame_count(start, end, f) <= FRAME_COUNT_HARD_MAX
    ]
    if under_cap:
        return max(under_cap)
    return min(FPS_PRESETS)


def weight_warnings(frame_sizes: list[int]) -> list[str]:
    """Advisory (non-blocking) soft-cap warnings for a finalized frame set.

    Mirrors verify.mjs G7's soft caps: any frame over the per-frame budget, or a
    total over the package budget, yields a human-readable warning string. These
    never block — they inform the meter and logs.
    """
    warnings: list[str] = []
    total = sum(frame_sizes)
    oversized = [i for i, sz in enumerate(frame_sizes) if sz > PER_FRAME_BUDGET_BYTES]
    if oversized:
        warnings.append(
            f"{len(oversized)} frame(s) over the "
            f"{PER_FRAME_BUDGET_BYTES // 1024} KB per-frame soft cap"
        )
    if total > WEIGHT_BUDGET_BYTES:
        warnings.append(
            f"total frame bytes {total / 1024 / 1024:.2f} MB over the "
            f"~{WEIGHT_BUDGET_BYTES // 1024 // 1024} MB soft cap"
        )
    return warnings
