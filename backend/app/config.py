"""Single-source configuration for the SEO Video Slicer backend.

Every numeric policy constant lives here (API.md §1). No literal 10 / 60 / 82 / 200
/ 4 MB / 256 KB appears anywhere else in the backend. Each is overridable via the
matching ``SVS_*`` environment variable so a launcher or future per-project override
is a one-line change, never a refactor (spec §5.1).

Paths are resolved relative to this file so the backend works regardless of the
process CWD (the launcher may start it from anywhere).
"""

from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths (resolved from this file, CWD-independent).
#   backend/app/config.py  ->  parents[2] == repo root
# ---------------------------------------------------------------------------
_THIS = Path(__file__).resolve()
REPO_ROOT: Path = _THIS.parents[2]

#: Runtime data root (git-ignored). One directory per job under ``data/jobs/``.
DATA_DIR: Path = Path(os.environ.get("SVS_DATA_DIR", str(REPO_ROOT / "data"))).resolve()

#: The frozen package kernel directory (``build_package.mjs`` + ``verify.mjs`` + template).
KERNEL_DIR: Path = Path(
    os.environ.get("SVS_KERNEL_DIR", str(REPO_ROOT / "package-contract"))
).resolve()

#: Built frontend (Vite ``dist``). Mounted at ``/`` only if it exists.
FRONTEND_DIST: Path = Path(
    os.environ.get("SVS_FRONTEND_DIST", str(REPO_ROOT / "frontend" / "dist"))
).resolve()

#: Convenience handles to the two kernels (the packager shells out to these).
BUILD_PACKAGE_MJS: Path = KERNEL_DIR / "build_package.mjs"
VERIFY_MJS: Path = KERNEL_DIR / "verify.mjs"


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Duration & slice policy (spec §5.1, API.md §1).
# ---------------------------------------------------------------------------
#: Out-point auto-set on import — the hero-animation sweet spot.
DEFAULT_SLICE_SECONDS: float = _env_float("SVS_DEFAULT_SLICE_SECONDS", 10.0)

#: Hard ceiling on ``end - start`` for a preview request. Not a hidden clamp — a
#: range exceeding this is rejected (422); the frontend mirrors it on the slider.
MAX_SLICE_SECONDS: float = _env_float("SVS_MAX_SLICE_SECONDS", 60.0)

# ---------------------------------------------------------------------------
# WebP encode quality (finalize + package frames). Valid 82–90; clamped.
# ---------------------------------------------------------------------------
WEBP_QUALITY: int = max(82, min(90, _env_int("SVS_WEBP_QUALITY", 82)))

# ---------------------------------------------------------------------------
# Weight-budget constants (mirror CONTRACT.md §4 / verify.mjs; the gate is the
# backstop, these power the live meter + advisory warnings).
# ---------------------------------------------------------------------------
#: Total-package SOFT cap (warn only) — ~4 MB.
WEIGHT_BUDGET_BYTES: int = _env_int("SVS_WEIGHT_BUDGET_BYTES", 4 * 1024 * 1024)

#: Per-frame SOFT cap (warn only) — 256 KB.
PER_FRAME_BUDGET_BYTES: int = _env_int("SVS_PER_FRAME_BUDGET_BYTES", 256 * 1024)

#: Frame-count HARD cap (mirrors verify.mjs G7; the gate is the real enforcer).
FRAME_COUNT_HARD_MAX: int = _env_int("SVS_FRAME_COUNT_HARD_MAX", 200)

#: Hero/loop ideal band for the budget meter & lane classification.
HERO_LANE_MIN: int = _env_int("SVS_HERO_LANE_MIN", 20)
HERO_LANE_MAX: int = _env_int("SVS_HERO_LANE_MAX", 80)

# ---------------------------------------------------------------------------
# Networking.
# ---------------------------------------------------------------------------
#: Bind port (spec §4). Surfaced by /api/share.
PORT: int = _env_int("SVS_PORT", 5179)

#: Accepted upload MIME types (others -> 415).
ALLOWED_UPLOAD_TYPES: frozenset[str] = frozenset(
    {"video/mp4", "video/quicktime", "video/webm"}
)

#: Opaque-id pattern shared by every ``{*_id}`` (API.md §0).
ID_PATTERN: str = r"^[A-Za-z0-9_-]{1,64}$"
