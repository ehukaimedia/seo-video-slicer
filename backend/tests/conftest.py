"""Shared pytest fixtures + hermetic environment setup for the backend suite.

HERMETICITY (the load-bearing part): ``backend/app/config.py`` resolves
``DATA_DIR`` from ``SVS_DATA_DIR`` at *import time*, and ``backend/app/main.py``
binds ``store = JobStore(DATA_DIR)`` the moment it is imported. So the env var MUST
be set BEFORE anything imports the app — i.e. here, at module top level, not inside
a fixture or via monkeypatch (which would run too late). We point it at a fresh
``tempfile.mkdtemp`` so the suite never reads or writes the real ``data/`` tree.

PATH: under ``cd backend && python -m pytest`` the cwd-derived ``sys.path[0]`` is
``backend/``, which makes ``app`` importable but NOT ``backend.app`` (what
test_budget/test_share import). We prepend the repo root so ``backend`` resolves as
a namespace package regardless of the working directory.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

# --- Path: make ``backend.app.*`` importable from any cwd (repo root on sys.path).
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# --- Hermetic data root: set BEFORE the app (and its module-level JobStore) imports.
#     Survives the whole session; cleaned up implicitly as an OS temp dir.
_TMP_DATA_DIR = tempfile.mkdtemp(prefix="svs-test-data-")
os.environ["SVS_DATA_DIR"] = _TMP_DATA_DIR


@pytest.fixture(scope="session")
def data_dir() -> Path:
    """The hermetic SVS data root used for the whole test session."""
    return Path(_TMP_DATA_DIR)


@pytest.fixture(scope="session")
def test_clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A tiny generated test clip: 3s, 640x360, 30fps, H.264 mp4 (lavfi testsrc).

    Generated a touch longer than the 2s preview window the pipeline test uses so
    the ``end <= duration`` guard in POST /preview never trips on ffprobe rounding.
    """
    out = tmp_path_factory.mktemp("clip") / "clip.mp4"
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=3:size=640x360:rate=30",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=120)
    if proc.returncode != 0 or not out.exists():
        pytest.fail(f"ffmpeg could not generate the test clip:\n{proc.stderr[-800:]}")
    return out
