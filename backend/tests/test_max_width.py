"""Tests for the opt-in max-width extraction lever."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from PIL import Image

from backend.app.errors import ApiError, validate_max_width
from backend.app.slicing import convert_frames_to_webp, extract_preview

requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH"
)


def _make(dir_: Path, name: str, size: tuple[int, int]) -> None:
    Image.new("RGB", size, (30, 90, 180)).save(dir_ / name, "PNG")


def _size(path: Path) -> tuple[int, int]:
    with Image.open(path) as im:
        return im.size


def test_validate_max_width_accepts_none_and_positive_int() -> None:
    assert validate_max_width(None) is None
    assert validate_max_width(1280) == 1280
    assert validate_max_width("1280") == 1280


@pytest.mark.parametrize("bad", [0, -1, "0", "-1", "abc", "1.5", True])
def test_validate_max_width_rejects_invalid_values(bad: object) -> None:
    with pytest.raises(ApiError) as exc:
        validate_max_width(bad)  # type: ignore[arg-type]
    assert exc.value.status_code == 422
    assert exc.value.error == "max_width must be a positive integer"


def test_frames_dir_max_width_downscales_when_wider(tmp_path: Path) -> None:
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.mkdir()
    _make(src, "element-0.png", (200, 100))

    names, resolution = convert_frames_to_webp(src, dst, max_width=80)

    assert names == ["frame_000.webp"]
    assert resolution == "80x40"
    assert _size(dst / "frame_000.webp") == (80, 40)


def test_frames_dir_max_width_never_upscales(tmp_path: Path) -> None:
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.mkdir()
    _make(src, "element-0.png", (80, 40))

    names, resolution = convert_frames_to_webp(src, dst, max_width=1280)

    assert names == ["frame_000.webp"]
    assert resolution == "80x40"
    assert _size(dst / "frame_000.webp") == (80, 40)


@requires_ffmpeg
def test_video_extract_max_width_downscales_when_wider(
    test_clip: Path, tmp_path: Path
) -> None:
    preview_dir = tmp_path / "preview"

    names = extract_preview(test_clip, preview_dir, start=0, end=0.5, fps=4, max_width=320)

    assert names
    assert _size(preview_dir / names[0]) == (320, 180)


@requires_ffmpeg
def test_video_extract_max_width_never_upscales(test_clip: Path, tmp_path: Path) -> None:
    preview_dir = tmp_path / "preview"

    names = extract_preview(test_clip, preview_dir, start=0, end=0.5, fps=4, max_width=1280)

    assert names
    assert _size(preview_dir / names[0]) == (640, 360)
