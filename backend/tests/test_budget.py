"""Unit tests for the frame-budget rule (spec §5.1, API.md §1.1).

backend.app.budget is the single source of the lane classifier, the fps
auto-suggest, and the soft-cap weight warnings. These tests assert the *actual*
classifier behavior (hero <=80, scrollytelling 81-200, over >200) — not the
docstring's "ideal 20-80" advisory band, which the meter handles separately.

Imports only config-level modules (no cv2), so it runs without the heavy media
stack — but conftest's sys.path fix is still what makes ``backend.app`` resolve.
"""

from __future__ import annotations

import pytest

from backend.app import budget
from backend.app.config import FRAME_COUNT_HARD_MAX, HERO_LANE_MAX


def test_projected_frame_count_rounds() -> None:
    assert budget.projected_frame_count(0, 2, 6) == 12
    assert budget.projected_frame_count(0.0, 10.0, 12.0) == 120
    # round() banker's-rounding-agnostic: 2.5s * 3fps = 7.5 -> 8.
    assert budget.projected_frame_count(0.0, 2.5, 3.0) == 8


@pytest.mark.parametrize(
    "count, lane",
    [
        (1, "hero"),
        (20, "hero"),
        (79, "hero"),
        (80, "hero"),        # boundary: <= HERO_LANE_MAX is hero.
        (81, "scrollytelling"),
        (150, "scrollytelling"),
        (200, "scrollytelling"),  # boundary: <= hard cap is still scrollytelling.
        (201, "over"),           # boundary: > hard cap is over.
        (500, "over"),
    ],
)
def test_lane_classifier_bands(count: int, lane: str) -> None:
    assert budget.lane_for_count(count) == lane


def test_lane_boundaries_track_config() -> None:
    # The classifier's cut points must be the config constants, not magic numbers.
    assert budget.lane_for_count(HERO_LANE_MAX) == "hero"
    assert budget.lane_for_count(HERO_LANE_MAX + 1) == "scrollytelling"
    assert budget.lane_for_count(FRAME_COUNT_HARD_MAX) == "scrollytelling"
    assert budget.lane_for_count(FRAME_COUNT_HARD_MAX + 1) == "over"


def test_suggest_fps_prefers_highest_in_hero_band() -> None:
    # Short clip: 12 fps keeps the count tiny -> the highest preset wins.
    assert budget.suggest_fps(0.0, 2.0) == 12
    # Highest preset must be a known preset.
    assert budget.suggest_fps(0.0, 2.0) in budget.FPS_PRESETS


def test_suggest_fps_steps_down_as_duration_rises() -> None:
    # At 12 fps a long clip blows past the hero band; suggest a lower preset.
    long_at_12 = budget.projected_frame_count(0.0, 30.0, 12.0)  # 360
    assert long_at_12 > HERO_LANE_MAX
    suggested = budget.suggest_fps(0.0, 30.0)
    assert suggested in budget.FPS_PRESETS
    # The suggestion never pushes the projected count over the hard cap when a
    # preset exists that stays under it (30s * 3fps = 90 <= 200).
    assert budget.projected_frame_count(0.0, 30.0, suggested) <= FRAME_COUNT_HARD_MAX
    assert suggested < 12


def test_suggest_fps_zero_duration_is_safe() -> None:
    assert budget.suggest_fps(5.0, 5.0) in budget.FPS_PRESETS
    assert budget.suggest_fps(5.0, 2.0) in budget.FPS_PRESETS  # negative duration guard


def test_weight_warnings_per_frame_softcap() -> None:
    from backend.app.config import PER_FRAME_BUDGET_BYTES

    sizes = [10, 20, PER_FRAME_BUDGET_BYTES + 1]
    warns = budget.weight_warnings(sizes)
    assert any("per-frame" in w for w in warns)


def test_weight_warnings_total_softcap() -> None:
    from backend.app.config import WEIGHT_BUDGET_BYTES

    # One frame that alone exceeds the total budget but is itself within the
    # per-frame cap is impossible (per-frame << total); use many mid-size frames.
    half = WEIGHT_BUDGET_BYTES // 2 + 1
    warns = budget.weight_warnings([half, half])
    assert any("soft cap" in w for w in warns)


def test_weight_warnings_clean_set_is_silent() -> None:
    assert budget.weight_warnings([10, 20, 30]) == []
