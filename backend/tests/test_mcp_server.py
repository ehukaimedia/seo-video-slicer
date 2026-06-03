"""MCP server smoke test (spec §7.3, §11.1).

The two tools (``slice_video`` / ``slice_frames``) are imported and invoked
DIRECTLY — ``@mcp.tool()`` registers and returns the function unwrapped, so the
tool body is callable in-process without a JSON-RPC round-trip.

Asserts the §7.3 error contract:

* tools register on the FastMCP instance and enumerate;
* a successful build returns exactly ``{package_dir, verify, loop_webp}`` with
  ``verify.pass`` true (scroll: 7 gates; loop: 9 gates), and the loop package
  passes an independent ``node verify.mjs``;
* a NON-gate failure (bad path, traversal, empty dir) is CAUGHT and returned as
  ``{error: {code, message}}`` — no exception escapes;
* **no tool call writes to stdout** (stdout is the JSON-RPC channel — capsys must
  be empty after every call).

Skips cleanly if node (the frozen kernel) is absent.
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path

import pytest

# The MCP server depends on the OPTIONAL ``[mcp]`` extra. Skip this whole module
# cleanly when it isn't installed (e.g. a contributor who ran a plain
# ``pip install -e backend`` / ``make test`` without the extra) rather than failing
# collection with a hard ImportError.
pytest.importorskip("mcp", reason="optional [mcp] extra not installed (pip install 'seo-video-slicer[mcp]')")

from backend.app import packager
from backend.app.mcp.server import mcp, slice_frames, slice_video

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SAMPLE_FRAMES = _REPO_ROOT / "example" / "sample-package" / "frames"
_VERIFY_MJS = _REPO_ROOT / "package-contract" / "verify.mjs"

requires_node = pytest.mark.skipif(
    shutil.which("node") is None, reason="node (frozen kernel) not on PATH"
)


def test_tools_registered() -> None:
    """Both tools register and enumerate on the FastMCP instance."""
    assert mcp.name == "seo-video-slicer"
    names = sorted(t.name for t in asyncio.run(mcp.list_tools()))
    assert names == ["slice_frames", "slice_video"]
    # Decorator returns the unwrapped function (direct-callable for the rest here).
    assert callable(slice_frames) and callable(slice_video)


@requires_node
def test_slice_frames_scroll(capsys: pytest.CaptureFixture[str]) -> None:
    result = slice_frames(dir=str(_SAMPLE_FRAMES), fps=12, mode="scroll")
    assert capsys.readouterr().out == "", "stdout is reserved for JSON-RPC"
    assert set(result) == {"package_dir", "verify", "loop_webp"}
    assert result["verify"]["pass"] is True
    assert [g["id"] for g in result["verify"]["gates"]] == [f"G{i}" for i in range(1, 8)]
    assert result["loop_webp"] is None
    assert Path(result["package_dir"]).is_dir()  # mkdtemp: OUTLIVES the call.


@requires_node
def test_slice_frames_loop_passes_and_node_verifies(
    capsys: pytest.CaptureFixture[str],
) -> None:
    result = slice_frames(dir=str(_SAMPLE_FRAMES), fps=12, mode="loop")
    assert capsys.readouterr().out == "", "stdout is reserved for JSON-RPC"
    assert set(result) == {"package_dir", "verify", "loop_webp"}
    assert result["verify"]["pass"] is True
    assert [g["id"] for g in result["verify"]["gates"]] == [f"G{i}" for i in range(1, 10)]
    assert result["loop_webp"] == "loop.webp"

    pkg = Path(result["package_dir"])
    assert (pkg / "loop.webp").is_file()
    proc = subprocess.run(
        ["node", str(_VERIFY_MJS), str(pkg)],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


@requires_node
def test_slice_video_scroll(
    test_clip: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The video branch (ffmpeg extract -> finalize -> build) end to end.

    Exercises the ``start/end = None`` defaults (begin=0.0, end=MAX_SLICE_SECONDS,
    bounded by the 3s clip's EOF) — the only coverage of ``slice_video``.
    """
    result = slice_video(path=str(test_clip), fps=12, mode="scroll")
    assert capsys.readouterr().out == "", "stdout is reserved for JSON-RPC"
    assert set(result) == {"package_dir", "verify", "loop_webp"}
    assert result["verify"]["pass"] is True
    assert result["loop_webp"] is None
    assert Path(result["package_dir"]).is_dir()


def test_gate_fail_flows_through_as_success(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The §7.3 crux: a built-but-failed-gate package is a SUCCESSFUL return.

    ``build_and_verify`` returns ``verify.pass=false`` *normally* (not an
    exception), so the tool must pass it through as ``{package_dir, verify,
    loop_webp}`` with NO ``error`` key — the agent inspects ``verify.gates``. We
    stub ONLY ``build_and_verify`` (the gate is hard to fail on clean sample
    frames) and let ``convert_frames_to_webp`` run for real so ``_build_from_slice``
    finds frames (it re-globs the slice dir for its ``frame_count < 1`` guard).
    The stub works because the server does ``from .. import packager`` and looks up
    the attribute at call time. No node needed — convert is pure Pillow.
    """
    fake = {
        "verify": {
            "pass": False,
            "gates": [{"id": "G7", "pass": False, "detail": "frames 201 > 200"}],
        },
        "package_dir": "/tmp/svs-mcp-gatefail",
        "loop_webp": None,
        "frame_count": 201,
        "weight_mb": 1.0,
        "lane": "hero",
        "zip_path": None,
    }
    monkeypatch.setattr(packager, "build_and_verify", lambda **kwargs: fake)

    result = slice_frames(dir=str(_SAMPLE_FRAMES), fps=12, mode="scroll")
    assert capsys.readouterr().out == "", "stdout is reserved for JSON-RPC"
    assert set(result) == {"package_dir", "verify", "loop_webp"}
    assert result["verify"]["pass"] is False
    assert "error" not in result
    assert [g["id"] for g in result["verify"]["gates"]] == ["G7"]


def test_bogus_path_returns_structured_error(capsys: pytest.CaptureFixture[str]) -> None:
    """A missing path is a NON-gate failure: structured error, no exception, no stdout."""
    result = slice_frames(dir="/no/such/svs-mcp-missing-xyz", fps=12, mode="loop")
    assert capsys.readouterr().out == "", "stdout is reserved for JSON-RPC"
    assert set(result) == {"error"}
    assert set(result["error"]) == {"code", "message"}


def test_traversal_path_rejected(capsys: pytest.CaptureFixture[str]) -> None:
    """A ``..`` segment is rejected BEFORE filesystem access (spec §7.6)."""
    result = slice_frames(dir="../../../etc", fps=12, mode="scroll")
    assert capsys.readouterr().out == "", "stdout is reserved for JSON-RPC"
    assert set(result) == {"error"}
    assert "traversal" in result["error"]["message"].lower()


@requires_node
def test_empty_dir_returns_structured_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """An empty frames dir is a NON-gate failure caught into the error shape."""
    empty = tmp_path / "empty"
    empty.mkdir()
    result = slice_frames(dir=str(empty), fps=12, mode="scroll")
    assert capsys.readouterr().out == "", "stdout is reserved for JSON-RPC"
    assert set(result) == {"error"}
    assert set(result["error"]) == {"code", "message"}


def test_invalid_mode_returns_structured_error(
    capsys: pytest.CaptureFixture[str],
) -> None:
    result = slice_frames(dir=str(_SAMPLE_FRAMES), fps=12, mode="bogus")
    assert capsys.readouterr().out == "", "stdout is reserved for JSON-RPC"
    assert set(result) == {"error"}
    assert result["error"]["code"] == "invalid mode"
