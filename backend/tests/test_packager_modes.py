"""Tests for ``packager.build_and_verify`` scroll vs loop modes (spec §6.4a, §6.8).

Builds against the committed scroll sample frames (``example/sample-package/frames``):

* SCROLL (default): all gates pass, ``package_dir`` present, ``loop_webp`` None,
  existing keys preserved (the sole HTTP caller is unaffected).
* LOOP: all 9 gates pass, ``loop_webp == "loop.webp"``, an independent
  ``node verify.mjs <pkg>`` exits 0, ``loop.webp`` is on disk.
* LOOP fail-fast: a slice over the hard frame cap raises 422 BEFORE any encode.

Node + the frozen kernel are required; skip cleanly if node is absent.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from backend.app import packager
from backend.app.config import FRAME_COUNT_HARD_MAX
from backend.app.errors import ApiError

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SAMPLE_FRAMES = _REPO_ROOT / "example" / "sample-package" / "frames"
_VERIFY_MJS = _REPO_ROOT / "package-contract" / "verify.mjs"

requires_node = pytest.mark.skipif(
    shutil.which("node") is None, reason="node (frozen kernel) not on PATH"
)


@pytest.fixture(scope="module")
def frame_count() -> int:
    n = len(list(_SAMPLE_FRAMES.glob("frame_*.webp")))
    assert n >= 2, f"sample frames missing at {_SAMPLE_FRAMES}"
    return n


@requires_node
def test_scroll_build_passes_and_keys(tmp_path: Path, frame_count: int) -> None:
    pkg_dir = tmp_path / "scroll"
    result = packager.build_and_verify(
        slice_dir=_SAMPLE_FRAMES,
        pkg_dir=pkg_dir,
        slug="test-scroll",
        duration_s=round(frame_count / 12, 3),
        fps_effective=12,
        resolution="540x960",
        origin="test",
    )
    assert result["verify"]["pass"] is True
    assert result["loop_webp"] is None
    assert result["package_dir"] == str(pkg_dir)
    # Existing keys preserved for the unchanged HTTP caller.
    for key in ("verify", "frame_count", "weight_mb", "lane", "zip_path"):
        assert key in result
    assert not (pkg_dir / "loop.webp").exists()


@requires_node
def test_loop_build_passes_nine_gates(tmp_path: Path, frame_count: int) -> None:
    pkg_dir = tmp_path / "loop"
    result = packager.build_and_verify(
        slice_dir=_SAMPLE_FRAMES,
        pkg_dir=pkg_dir,
        slug="test-loop",
        duration_s=round(frame_count / 12, 3),
        fps_effective=12,
        resolution="540x960",
        origin="test",
        mode="loop",
    )
    gates = result["verify"]["gates"]
    assert [g["id"] for g in gates] == [f"G{i}" for i in range(1, 10)]
    assert result["verify"]["pass"] is True
    assert all(g["pass"] for g in gates)
    assert result["loop_webp"] == "loop.webp"
    assert result["package_dir"] == str(pkg_dir)
    assert (pkg_dir / "loop.webp").is_file()

    # Independent gate: verify.mjs takes the package dir as argv[2] and exits 0.
    proc = subprocess.run(
        ["node", str(_VERIFY_MJS), str(pkg_dir)],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


@requires_node
def test_loop_fail_fast_over_hard_cap(tmp_path: Path) -> None:
    """A loop slice over the hard frame cap raises 422 before any encode."""
    slice_dir = tmp_path / "huge"
    slice_dir.mkdir()
    # Create empty placeholder frame files just past the cap; the fail-fast count
    # check runs (and raises) before any frame is opened/encoded.
    for i in range(FRAME_COUNT_HARD_MAX + 1):
        (slice_dir / f"frame_{i:03d}.webp").write_bytes(b"")

    with pytest.raises(ApiError) as exc:
        packager.build_and_verify(
            slice_dir=slice_dir,
            pkg_dir=tmp_path / "out",
            slug="too-many",
            duration_s=1.0,
            fps_effective=12,
            resolution="16x16",
            origin="test",
            mode="loop",
        )
    assert exc.value.status_code == 422


@requires_node
def test_loop_too_few_frames_no_tmpfile_leak(tmp_path: Path) -> None:
    """A 1-frame loop passes the >200 fail-fast, then export raises 422 — and the
    just-allocated tmpfile must not leak (the encode + tmpfile share one finally)."""
    import glob
    import tempfile as _tf

    slice_dir = tmp_path / "one"
    slice_dir.mkdir()
    from PIL import Image

    Image.new("RGB", (16, 16), (10, 0, 0)).save(slice_dir / "frame_000.webp", "WEBP")

    before = set(glob.glob(str(Path(_tf.gettempdir()) / "svs-loop-*.webp")))
    with pytest.raises(ApiError) as exc:
        packager.build_and_verify(
            slice_dir=slice_dir,
            pkg_dir=tmp_path / "out",
            slug="one",
            duration_s=1.0,
            fps_effective=12,
            resolution="16x16",
            origin="test",
            mode="loop",
        )
    assert exc.value.status_code == 422
    after = set(glob.glob(str(Path(_tf.gettempdir()) / "svs-loop-*.webp")))
    assert after == before, f"leaked tmpfile(s): {after - before}"


def test_invalid_mode_rejected(tmp_path: Path) -> None:
    with pytest.raises(ApiError) as exc:
        packager.build_and_verify(
            slice_dir=_SAMPLE_FRAMES,
            pkg_dir=tmp_path / "x",
            slug="bad",
            duration_s=1.0,
            fps_effective=12,
            resolution="16x16",
            origin="test",
            mode="bogus",
        )
    assert exc.value.status_code == 422


@pytest.mark.parametrize("bad_fps", [0, -1, float("nan"), None])
def test_non_positive_fps_raises_422_before_build(bad_fps, tmp_path: Path) -> None:
    """The central backstop (spec §6.4a): a non-positive/non-finite/None fps raises
    ``ApiError(422, "fps must be a positive number")`` BEFORE any extraction/encode/
    build — so the degenerate ``duration_s=0`` / ``fps_effective=0`` package the gates
    never caught is rejected at the choke point both CLI and MCP pass through. No node
    needed (the guard fires before the node-availability check); no package produced."""
    pkg_dir = tmp_path / "out"
    with pytest.raises(ApiError) as exc:
        packager.build_and_verify(
            slice_dir=_SAMPLE_FRAMES,
            pkg_dir=pkg_dir,
            slug="bad-fps",
            duration_s=0.0,
            fps_effective=bad_fps,
            resolution="16x16",
            origin="test",
        )
    assert exc.value.status_code == 422
    assert exc.value.error == "fps must be a positive number"
    assert not (pkg_dir / "manifest.json").exists()
