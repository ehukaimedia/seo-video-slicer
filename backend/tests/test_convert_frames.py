"""Tests for ``slicing.convert_frames_to_webp`` (spec §8.2, §11.1).

Covers the Remotion frames-dir ingest: empty dir error, mixed PNG/JPEG, the
**numeric** trailing-integer sort (``element-10`` after ``element-9``, NOT after
``element-1``), a non-zero first source index, and renumber-to-contiguous.

The numeric-sort test does NOT merely check output filenames — ``element-0…12``
renumbered yields ``frame_000…012`` under BOTH numeric and lexicographic sort, so a
name check is vacuous. Instead it encodes the source index into each frame's pixel
value (well-separated grayscale so the q82 WebP roundtrip can't collapse neighbours)
and asserts the decoded output order, proving ``frame_010`` came from ``element-10``.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from backend.app.errors import ApiError
from backend.app.slicing import convert_frames_to_webp


def _make(dir_: Path, name: str, value: int, fmt: str = "PNG") -> None:
    """Write a 16x16 solid-grayscale image so its pixel value encodes ``value``."""
    Image.new("RGB", (16, 16), (value, value, value)).save(dir_ / name, fmt)


def _decoded_index(path: Path) -> int:
    """Recover the encoded source index from a converted frame (i*15 grayscale)."""
    with Image.open(path) as im:
        return round(im.convert("RGB").getpixel((8, 8))[0] / 15)


def test_empty_dir_errors(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.mkdir()
    with pytest.raises(ApiError) as exc:
        convert_frames_to_webp(src, tmp_path / "dst")
    assert exc.value.status_code == 422


def test_missing_dir_errors(tmp_path: Path) -> None:
    with pytest.raises(ApiError) as exc:
        convert_frames_to_webp(tmp_path / "does-not-exist", tmp_path / "dst")
    assert exc.value.status_code == 404


def test_numeric_sort_element_0_to_12(tmp_path: Path) -> None:
    """element-0..element-12 must order numerically: frame_010 <- element-10."""
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.mkdir()
    for i in range(13):
        _make(src, f"element-{i}.png", i * 15)

    names, resolution = convert_frames_to_webp(src, dst)

    assert names == [f"frame_{j:03d}.webp" for j in range(13)]
    assert resolution == "16x16"
    # The load-bearing assertion: decoded source index == output index for ALL
    # frames. Under a lexicographic sort element-10/11/12 would land at output
    # positions 2/3/4 and this would be [0,1,10,11,12,2,...] — it must be 0..12.
    decoded = [_decoded_index(dst / f"frame_{j:03d}.webp") for j in range(13)]
    assert decoded == list(range(13))


def test_non_zero_first_index_renumbers_from_000(tmp_path: Path) -> None:
    """A source starting at element-5 still renumbers contiguously from frame_000."""
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.mkdir()
    for i in (5, 6, 7):
        _make(src, f"element-{i}.png", i * 15)

    names, _ = convert_frames_to_webp(src, dst)

    assert names == ["frame_000.webp", "frame_001.webp", "frame_002.webp"]
    # frame_000 came from element-5 (the lowest source index), preserving order.
    assert [_decoded_index(dst / n) for n in names] == [5, 6, 7]


def test_mixed_png_jpeg(tmp_path: Path) -> None:
    """A mixed PNG/JPEG set converts and orders by trailing integer across formats."""
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.mkdir()
    _make(src, "element-0.png", 0, "PNG")
    _make(src, "element-1.jpg", 60, "JPEG")
    _make(src, "element-2.jpeg", 120, "JPEG")

    names, _ = convert_frames_to_webp(src, dst)

    assert names == ["frame_000.webp", "frame_001.webp", "frame_002.webp"]
    decoded = [_decoded_index(dst / n) for n in names]
    assert decoded == [0, 4, 8]  # 0/60/120 grayscale -> i*15 buckets 0/4/8


def test_unorderable_names_error(tmp_path: Path) -> None:
    """A file with no trailing integer cannot be ordered -> clear 422."""
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.mkdir()
    _make(src, "element-0.png", 0)
    _make(src, "cover.png", 30)  # no trailing integer
    with pytest.raises(ApiError) as exc:
        convert_frames_to_webp(src, dst)
    assert exc.value.status_code == 422
    assert "cover.png" in (exc.value.detail or "")


def test_duplicate_trailing_index_error(tmp_path: Path) -> None:
    """Two files sharing a trailing integer are ambiguous -> 422 naming both."""
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.mkdir()
    _make(src, "element-1.png", 15)
    _make(src, "other-1.jpg", 30, "JPEG")  # same trailing integer (1) as element-1
    with pytest.raises(ApiError) as exc:
        convert_frames_to_webp(src, dst)
    assert exc.value.status_code == 422
    assert exc.value.error == "ambiguous frame names"
    detail = exc.value.detail or ""
    assert "element-1.png" in detail
    assert "other-1.jpg" in detail
    # No partial output: the ambiguous set errors before any frame is written.
    assert not dst.exists()
