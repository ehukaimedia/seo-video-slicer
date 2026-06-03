"""Tests for the ``loop_export.export_loop_webp`` frame-count guard (spec §6.7).

A 1-frame "loop" cannot be a valid animated WebP per the §6.9 encoder spike, so
``export_loop_webp`` must raise a clear error below 2 frames (0 is already caught by
``_list_frames``). Also asserts the FROZEN cross-language ``perFrameMs`` formula and
that a valid 2+ frame export produces non-empty bytes.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from backend.app.errors import ApiError
from backend.app.loop_export import _frame_duration_ms, export_loop_webp


def _frames(dir_: Path, count: int) -> None:
    dir_.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        Image.new("RGB", (16, 16), (i * 20, 0, 0)).save(
            dir_ / f"frame_{i:03d}.webp", "WEBP"
        )


def test_zero_frames_errors(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.mkdir()
    with pytest.raises(ApiError) as exc:
        export_loop_webp(src, tmp_path / "loop.webp", fps=12)
    assert exc.value.status_code == 422


def test_one_frame_errors(tmp_path: Path) -> None:
    src = tmp_path / "src"
    _frames(src, 1)
    with pytest.raises(ApiError) as exc:
        export_loop_webp(src, tmp_path / "loop.webp", fps=12)
    assert exc.value.status_code == 422
    assert "2 frames" in (exc.value.detail or "") or ">=2" in (exc.value.detail or "")


def test_two_frames_export_ok(tmp_path: Path) -> None:
    src = tmp_path / "src"
    _frames(src, 2)
    out = tmp_path / "loop.webp"
    result = export_loop_webp(src, out, fps=12)
    assert result == out
    assert out.is_file() and out.stat().st_size > 0


def test_per_frame_ms_frozen_formula() -> None:
    """floor(1000/fps + 0.5): half-up, deterministic, cross-language (§6.9)."""
    assert _frame_duration_ms(12) == 83
    assert _frame_duration_ms(16) == 63  # round() would give 62 (banker's)
    assert _frame_duration_ms(24) == 42
    assert _frame_duration_ms(30) == 33
