"""Headless ``slice`` CLI — the exit-code matrix + ingest/mode coverage (spec §5.3).

Drives ``slice_cli.main(argv) -> int`` IN-PROCESS (no subprocess, no
``_resolve_bundled_paths``) so it gates against the canonical ``package-contract/``
kernel via ``config`` — the right surface for the CLI lane. Asserts the §5.3
exit-code matrix and the §10.2 ``--json`` shape, hardened so a loop regression
cannot read as green: loop cases check the loop-specific output (G8/G9 gate ids,
``loop.webp`` on disk, the ``loop-package.v1`` schema, ``loop_webp`` in the JSON),
not merely a zero exit.

* ``0`` — built and every gate passed (or ``--no-verify`` clean).
* ``1`` — built but a gate failed (a package exists; ``verify.pass=false``).
* ``2`` — input/ffmpeg/node/build error (no package; ``{error:{code,message}}``).

Node + the frozen kernel are required; skip cleanly if node is absent.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from PIL import Image

from backend.app import slice_cli
from backend.app.config import FRAME_COUNT_HARD_MAX

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SAMPLE_FRAMES = _REPO_ROOT / "example" / "sample-package" / "frames"
_VERIFY_MJS = _REPO_ROOT / "package-contract" / "verify.mjs"

requires_node = pytest.mark.skipif(
    shutil.which("node") is None, reason="node (frozen kernel) not on PATH"
)
requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH"
)


def _run(argv: list[str], capsys: pytest.CaptureFixture[str]) -> tuple[int, str, str]:
    """Invoke ``slice_cli.main`` in-process; return ``(exit_code, stdout, stderr)``.

    HERMETICITY (exposure-reduction, not a root-cause fix): drain ``capsys`` first so
    the returned ``out``/``err`` reflect ONLY what ``slice_cli.main`` wrote on THIS
    call — never a byte that leaked into this test's capture buffer *before* the call
    (e.g. a prior test's async/thread-teardown ``sys.stderr`` write, an
    ``unraisablehook``/async-generator-finalization line surfacing during GC). Without
    the drain such a stray byte is misattributed to the CLI and can flip the strict
    ``assert err == ""`` (and the pure-JSON ``_json_stdout`` parse) order-flakily. The
    assertions are unchanged — they still pin the CLI's exact output.
    """
    capsys.readouterr()  # discard any pre-call leakage from this capture buffer
    code = slice_cli.main(argv)
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def _json_stdout(out: str) -> dict:
    """Parse the single ``--json`` object off stdout (stdout must be pure JSON)."""
    return json.loads(out.strip())


# ---------------------------------------------------------------------------
# Exit 0 — clean builds, both ingest paths, both modes.
# ---------------------------------------------------------------------------
@requires_node
def test_frames_scroll_exit0_human(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out_dir = tmp_path / "pkg"
    code, out, _err = _run(
        [str(_SAMPLE_FRAMES), "--mode", "scroll", "--fps", "12", "--out-dir", str(out_dir)],
        capsys,
    )
    assert code == 0
    assert "PASS" in out and str(out_dir) in out
    assert (out_dir / "manifest.json").is_file()
    schema = json.loads((out_dir / "manifest.json").read_text())["schema"]
    assert schema == "seo-video-slicer.package.v1"


@requires_node
def test_frames_scroll_exit0_json_shape(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out_dir = tmp_path / "pkg"
    code, out, _err = _run(
        [str(_SAMPLE_FRAMES), "--mode", "scroll", "--fps", "12", "--out-dir", str(out_dir),
         "--json"],
        capsys,
    )
    assert code == 0
    obj = _json_stdout(out)
    # Exactly the §10.2 shape — no zip_path/lane/weight_mb/frame_count leakage.
    assert set(obj.keys()) == {"package_dir", "verify", "loop_webp"}
    assert obj["package_dir"] == str(out_dir)
    assert obj["loop_webp"] is None
    assert obj["verify"]["pass"] is True
    assert set(obj["verify"].keys()) == {"pass", "gates"}


@requires_node
def test_frames_loop_exit0_is_actually_loop(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Hardened: a loop build must emit loop-specific output, not just exit 0."""
    out_dir = tmp_path / "pkg"
    code, out, _err = _run(
        [str(_SAMPLE_FRAMES), "--mode", "loop", "--fps", "12", "--out-dir", str(out_dir),
         "--json"],
        capsys,
    )
    assert code == 0
    obj = _json_stdout(out)
    assert obj["loop_webp"] == "loop.webp"
    assert obj["verify"]["pass"] is True
    gate_ids = [g["id"] for g in obj["verify"]["gates"]]
    assert gate_ids == [f"G{i}" for i in range(1, 10)]  # G1..G9 (loop adds G8/G9)
    assert (out_dir / "loop.webp").is_file()
    schema = json.loads((out_dir / "manifest.json").read_text())["schema"]
    assert schema == "seo-video-slicer.loop-package.v1"

    # Close the loop in pytest: an INDEPENDENT node verify.mjs on the package on
    # disk exits 0 (the §13 "real package that verify.mjs passes" acceptance).
    import subprocess

    proc = subprocess.run(
        ["node", str(_VERIFY_MJS), str(out_dir)],
        capture_output=True, text=True, check=False, timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


@requires_node
def test_frames_loop_exit0_human(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out_dir = tmp_path / "pkg"
    code, out, _err = _run(
        [str(_SAMPLE_FRAMES), "--mode", "loop", "--fps", "12", "--out-dir", str(out_dir)],
        capsys,
    )
    assert code == 0
    assert "loop.webp" in out
    assert "G8" in out and "G9" in out


@requires_node
@requires_ffmpeg
def test_video_scroll_exit0(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """Video ingest: synthesize a 1s mp4 from the sample frames, slice it (scroll)."""
    import subprocess

    mp4 = tmp_path / "t.mp4"
    proc = subprocess.run(
        ["ffmpeg", "-y", "-framerate", "12", "-i",
         str(_SAMPLE_FRAMES / "frame_%03d.webp"), "-t", "1", str(mp4)],
        capture_output=True, text=True, check=False, timeout=120,
    )
    assert proc.returncode == 0 and mp4.is_file(), proc.stderr[-800:]

    out_dir = tmp_path / "pkg"
    code, out, _err = _run(
        [str(mp4), "--mode", "scroll", "--fps", "12", "--out-dir", str(out_dir), "--json"],
        capsys,
    )
    assert code == 0, out
    obj = _json_stdout(out)
    assert obj["verify"]["pass"] is True
    assert obj["loop_webp"] is None
    assert (out_dir / "manifest.json").is_file()


# ---------------------------------------------------------------------------
# Exit 1 — built, but a gate failed (a package exists).
# ---------------------------------------------------------------------------
@requires_node
def test_scroll_over_cap_exit1_gate_fail(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """201 frames in SCROLL builds, then G7 hard-fails: exit 1, package on disk."""
    src = tmp_path / "frames"
    src.mkdir()
    for i in range(FRAME_COUNT_HARD_MAX + 1):
        Image.new("RGB", (16, 16), (i % 256, 0, 0)).save(src / f"frame_{i:03d}.webp", "WEBP")

    out_dir = tmp_path / "pkg"
    code, out, err = _run(
        [str(src), "--mode", "scroll", "--fps", "12", "--out-dir", str(out_dir), "--json"],
        capsys,
    )
    assert code == 1
    obj = _json_stdout(out)
    assert obj["verify"]["pass"] is False
    failed = [g["id"] for g in obj["verify"]["gates"] if not g["pass"]]
    assert "G7" in failed
    assert "G7" in err  # failing gate id(s) go to stderr
    assert (out_dir / "manifest.json").is_file()  # a package WAS produced


# ---------------------------------------------------------------------------
# Exit 2 — input/build error, no package, {error:{code,message}} under --json.
# ---------------------------------------------------------------------------
@requires_node
def test_empty_dir_exit2_error_shape(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    out_dir = tmp_path / "pkg"
    code, out, err = _run(
        [str(empty), "--mode", "scroll", "--fps", "12", "--out-dir", str(out_dir), "--json"],
        capsys,
    )
    assert code == 2
    obj = _json_stdout(out)
    assert set(obj.keys()) == {"error"}
    assert set(obj["error"].keys()) == {"code", "message"}
    # Under --json the structured error is the ONLY stdout; the human stderr line is
    # suppressed (a diagnostic still goes through logging, not to sys.stderr).
    assert err == ""
    assert not out_dir.exists() or not (out_dir / "manifest.json").exists()


def test_missing_path_human_writes_stderr_exit2(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Without --json, a hard error writes a human ``error: ...`` line to stderr."""
    code, out, err = _run(
        [str(tmp_path / "nope"), "--mode", "scroll", "--fps", "12",
         "--out-dir", str(tmp_path / "pkg")],
        capsys,
    )
    assert code == 2
    assert out == ""  # nothing on stdout for a non-json hard error
    assert err.startswith("error: ")


def test_missing_path_exit2(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """Neither a file nor a directory — exit 2 (no node needed; fails before build)."""
    missing = tmp_path / "nope"
    code, out, _err = _run(
        [str(missing), "--mode", "scroll", "--fps", "12", "--out-dir", str(tmp_path / "pkg"),
         "--json"],
        capsys,
    )
    assert code == 2
    assert _json_stdout(out)["error"]["code"]


def test_dir_with_trim_window_exit2(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """--start/--end with a frames dir is a loud error (video-only) before any work."""
    code, out, _err = _run(
        [str(_SAMPLE_FRAMES), "--mode", "scroll", "--fps", "12", "--start", "0", "--end", "1",
         "--out-dir", str(tmp_path / "pkg"), "--json"],
        capsys,
    )
    assert code == 2
    assert "trim" in _json_stdout(out)["error"]["code"].lower()


def test_path_traversal_rejected_exit2(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out, _err = _run(
        ["../etc/passwd", "--mode", "scroll", "--fps", "12", "--out-dir", str(tmp_path / "pkg"),
         "--json"],
        capsys,
    )
    assert code == 2
    assert _json_stdout(out)["error"]["code"]


@requires_node
def test_loop_over_cap_exit2_fail_fast(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """201 frames in LOOP fail-fasts (422) BEFORE the encode: exit 2, no package."""
    src = tmp_path / "frames"
    src.mkdir()
    for i in range(FRAME_COUNT_HARD_MAX + 1):
        Image.new("RGB", (16, 16), (i % 256, 0, 0)).save(src / f"frame_{i:03d}.webp", "WEBP")

    out_dir = tmp_path / "pkg"
    code, out, _err = _run(
        [str(src), "--mode", "loop", "--fps", "12", "--out-dir", str(out_dir), "--json"],
        capsys,
    )
    assert code == 2
    assert _json_stdout(out)["error"]["code"]
    assert not (out_dir / "manifest.json").exists()  # no package produced


# ---------------------------------------------------------------------------
# --no-verify — skip the gate report, exit 0 on a clean build.
# ---------------------------------------------------------------------------
@requires_node
def test_no_verify_skipped_shape_exit0(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out_dir = tmp_path / "pkg"
    code, out, _err = _run(
        [str(_SAMPLE_FRAMES), "--mode", "scroll", "--fps", "12", "--out-dir", str(out_dir),
         "--no-verify", "--json"],
        capsys,
    )
    assert code == 0
    obj = _json_stdout(out)
    assert obj["verify"] == {"skipped": True}
    assert (out_dir / "manifest.json").is_file()  # the package was still built


# ---------------------------------------------------------------------------
# Curated --help — the §5.1 signature + one example per ingest path/mode.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# cli.py dispatch — `seo-video-slicer slice …` routes to slice_cli and propagates
# the exit code (the spec §5.2 intercept-before-the-uvicorn-path constraint).
# ---------------------------------------------------------------------------
@requires_node
def test_cli_slice_dispatch_propagates_exit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """``cli.main()`` must intercept ``slice`` and SystemExit with slice_cli's code."""
    from backend.app import cli

    out_dir = tmp_path / "pkg"
    monkeypatch.setattr(
        "sys.argv",
        ["seo-video-slicer", "slice", str(_SAMPLE_FRAMES), "--mode", "scroll",
         "--fps", "12", "--out-dir", str(out_dir), "--json"],
    )
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 0
    obj = _json_stdout(capsys.readouterr().out)
    assert obj["verify"]["pass"] is True
    assert (out_dir / "manifest.json").is_file()


def test_curated_help(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        slice_cli.main(["--help"])
    assert exc.value.code == 0
    out = capsys.readouterr().out
    assert "signature:" in out and "examples:" in out
    # one example per ingest path/mode is present.
    assert "video -> scroll" in out
    assert "video -> loop" in out
    assert "frames-dir (Remotion --sequence) -> scroll" in out
    assert "frames-dir -> loop" in out
