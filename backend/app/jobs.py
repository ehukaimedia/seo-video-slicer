"""Filesystem-backed job store (API.md §2, §10).

State is the on-disk layout under ``data/jobs/{job_id}/`` plus a thin in-memory
index; there is no database. One directory per job. The store owns id generation,
ffprobe metadata extraction, and thumbnail creation.

Slices are enumerated directly from disk (``slices/{slice_id}/``) so the store stays
truthful even across restarts — the in-memory index is a cache, not the source of
truth.
"""

from __future__ import annotations

import json
import logging
import secrets
import shutil
import subprocess
from pathlib import Path

from .config import DATA_DIR
from .errors import ApiError, is_valid_id

log = logging.getLogger("svs.jobs")

#: WebP frame glob used to count a slice's current frames.
_WEBP_GLOB = "frame_*.webp"


def _new_id(prefix: str) -> str:
    """Opaque, filesystem-safe id matching ``^[A-Za-z0-9_-]{1,64}$``."""
    return f"{prefix}_{secrets.token_urlsafe(6).replace('_', '-')}"


def _run(cmd: list[str], *, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    """Run a subprocess capturing text output; never raises on non-zero (caller checks)."""
    return subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout, check=False
    )


class Job:
    """A single working clip: its data dir, meta, and (disk-derived) slices."""

    def __init__(self, job_id: str, data_dir: Path) -> None:
        self.job_id = job_id
        self.data_dir = data_dir

    @property
    def video_path(self) -> Path:
        return self.data_dir / "video.mp4"

    @property
    def meta_path(self) -> Path:
        return self.data_dir / "meta.json"

    @property
    def thumb_path(self) -> Path:
        return self.data_dir / "thumb.jpg"

    @property
    def previews_dir(self) -> Path:
        return self.data_dir / "previews"

    @property
    def slices_dir(self) -> Path:
        return self.data_dir / "slices"

    def read_meta(self) -> dict:
        try:
            return json.loads(self.meta_path.read_text())
        except (OSError, json.JSONDecodeError) as exc:  # pragma: no cover - defensive
            raise ApiError(404, "unknown job_id", f"meta unreadable: {exc}") from exc

    def write_meta(self, meta: dict) -> None:
        self.meta_path.write_text(json.dumps(meta, indent=2))

    def slice_dir(self, slice_id: str) -> Path:
        return self.slices_dir / slice_id

    def list_slices(self) -> list[dict]:
        """Enumerate slices from disk: id, current WebP frame count, package status."""
        out: list[dict] = []
        if not self.slices_dir.is_dir():
            return out
        for sdir in sorted(self.slices_dir.iterdir()):
            if not sdir.is_dir() or not is_valid_id(sdir.name):
                continue
            frame_count = len(list(sdir.glob(_WEBP_GLOB)))
            out.append(
                {
                    "slice_id": sdir.name,
                    "frame_count": frame_count,
                    "has_package": _has_passing_package(sdir),
                }
            )
        return out


def _has_passing_package(slice_dir: Path) -> bool:
    """True iff at least one package under this slice built and passed its gate.

    A passing build is marked by the presence of its downloadable zip (we write the
    zip only when ``verify.pass`` is true — see ``packager.py``). This keeps
    ``has_package`` derivable purely from disk.
    """
    packages_dir = slice_dir / "packages"
    if not packages_dir.is_dir():
        return False
    for pdir in packages_dir.iterdir():
        if pdir.is_dir() and any(pdir.glob("*-animation.zip")):
            return True
    return False


class JobStore:
    """Create / get / list jobs; probe metadata; make thumbnails."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self.jobs_root = (data_dir or DATA_DIR) / "jobs"
        self.jobs_root.mkdir(parents=True, exist_ok=True)
        log.info("JobStore rooted at %s", self.jobs_root)

    # -- lifecycle -----------------------------------------------------------
    def create(self) -> Job:
        for _ in range(8):
            job_id = _new_id("j")
            data_dir = self.jobs_root / job_id
            if not data_dir.exists():
                data_dir.mkdir(parents=True)
                return Job(job_id, data_dir)
        raise ApiError(500, "could not allocate job id")  # pragma: no cover

    def get(self, job_id: str) -> Job:
        """Return the job or raise 404. ``job_id`` is assumed already id-validated."""
        data_dir = self.jobs_root / job_id
        if not data_dir.is_dir() or not (data_dir / "meta.json").exists():
            raise ApiError(404, "unknown job_id", job_id)
        return Job(job_id, data_dir)

    def list(self) -> list[str]:
        """Minimal recents list: job ids on disk (newest first)."""
        if not self.jobs_root.is_dir():
            return []
        dirs = [
            d
            for d in self.jobs_root.iterdir()
            if d.is_dir() and is_valid_id(d.name) and (d / "meta.json").exists()
        ]
        dirs.sort(key=lambda d: d.stat().st_mtime, reverse=True)
        return [d.name for d in dirs]

    # -- media probing -------------------------------------------------------
    def probe(self, video_path: Path) -> dict:
        """ffprobe a video → ``{duration_s, width, height, fps}``. Raises 422 on failure."""
        if shutil.which("ffprobe") is None:
            raise ApiError(500, "ffprobe not found", "install ffmpeg/ffprobe")
        proc = _run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,avg_frame_rate,r_frame_rate",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(video_path),
            ]
        )
        if proc.returncode != 0:
            raise ApiError(
                422, "unreadable or corrupt video", (proc.stderr or "").strip()[:400]
            )
        try:
            data = json.loads(proc.stdout)
            stream = (data.get("streams") or [{}])[0]
            width = int(stream.get("width") or 0)
            height = int(stream.get("height") or 0)
            duration = float((data.get("format") or {}).get("duration") or 0.0)
            fps = _parse_fps(stream.get("avg_frame_rate") or stream.get("r_frame_rate"))
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise ApiError(422, "unreadable or corrupt video", str(exc)) from exc
        if width <= 0 or height <= 0:
            raise ApiError(422, "unreadable or corrupt video", "no video stream dimensions")
        return {
            "duration_s": round(duration, 3),
            "width": width,
            "height": height,
            "fps": round(fps, 3),
        }

    def make_thumbnail(self, video_path: Path, thumb_path: Path) -> None:
        """Poster frame at ~0.5s (fallback 0.0s) → thumb.jpg. Raises 500 on failure."""
        if shutil.which("ffmpeg") is None:
            raise ApiError(500, "ffmpeg not found", "install ffmpeg")
        for ss in ("0.5", "0.0"):
            proc = _run(
                [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    ss,
                    "-i",
                    str(video_path),
                    "-frames:v",
                    "1",
                    "-q:v",
                    "3",
                    str(thumb_path),
                ]
            )
            if proc.returncode == 0 and thumb_path.exists():
                return
        raise ApiError(500, "thumbnail generation failed")


def _parse_fps(rate: str | None) -> float:
    """Parse ffprobe's ``num/den`` frame-rate string into a float (0.0 on failure)."""
    if not rate or "/" not in rate:
        try:
            return float(rate) if rate else 0.0
        except ValueError:
            return 0.0
    num, _, den = rate.partition("/")
    try:
        n, d = float(num), float(den)
        return n / d if d else 0.0
    except (ValueError, ZeroDivisionError):
        return 0.0
