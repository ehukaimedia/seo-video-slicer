"""Job & package management (API.md §12 — the management surface).

Read/rename/delete jobs and list/delete their built packages. This module owns the
**enumeration + summarization** logic that backs the management endpoints; it reuses
the existing :class:`~app.jobs.JobStore`, :mod:`app.packager`, and :mod:`app.budget`
rather than re-deriving anything (frame counts, weights, lanes all come from there).

Like the rest of the backend, state is the on-disk layout under ``data/jobs/`` — there
is no database. ``created_at`` is recorded into ``meta.json`` / ``_hints.json`` at
creation time so "newest first" stays stable across a later ``PUT`` rename (sorting on
mtime would reorder a job the moment its meta is rewritten). Jobs/packages created
before this surface existed have no stored ``created_at``; those fall back to the
directory mtime so legacy data still lists.
"""

from __future__ import annotations

import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

from . import budget, packager
from .errors import ApiError, is_valid_id
from .jobs import Job, JobStore

log = logging.getLogger("svs.management")

#: WebP frame glob shared with the package frame listing (mirrors jobs._WEBP_GLOB).
_WEBP_GLOB = "frame_*.webp"
_ANIMATION_ZIP_GLOB = "*-animation.zip"


def now_iso() -> str:
    """Current UTC instant as an ISO-8601 string (the one ``created_at`` format)."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _mtime_iso(path: Path) -> str:
    """Directory/file mtime as ISO-8601 UTC — the legacy ``created_at`` fallback."""
    ts = path.stat().st_mtime
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def _meta_created_at(meta: dict, data_dir: Path) -> str:
    """Stored ``created_at`` if present, else the dir mtime (legacy jobs/packages)."""
    stored = meta.get("created_at")
    return stored if isinstance(stored, str) and stored else _mtime_iso(data_dir)


# ---------------------------------------------------------------------------
# Jobs.
# ---------------------------------------------------------------------------
def list_jobs(store: JobStore) -> list[dict]:
    """Summarize every job on disk, newest first (API.md §12.1).

    ``created_at`` governs the order (stored at upload; mtime fallback for legacy
    jobs) so a later rename never reshuffles the list.
    """
    out: list[dict] = []
    for job_id in store.list():
        job = Job(job_id, store.jobs_root / job_id)
        try:
            meta = job.read_meta()
        except ApiError:  # pragma: no cover - defensive (race with delete)
            continue
        width = int(meta.get("width") or 0)
        height = int(meta.get("height") or 0)
        slices = job.list_slices()
        out.append(
            {
                "job_id": job_id,
                "title": meta.get("title") or meta.get("filename") or job_id,
                "created_at": _meta_created_at(meta, job.data_dir),
                "thumb_url": f"/data/jobs/{job_id}/thumb.jpg",
                "duration_s": meta.get("duration_s"),
                "resolution": f"{width}x{height}" if width and height else None,
                "slice_count": len(slices),
                "package_count": _job_package_count(job),
            }
        )
    out.sort(key=lambda j: j["created_at"], reverse=True)
    return out


def rename_job(store: JobStore, job_id: str, title: str) -> dict:
    """Set the job's display ``title`` in ``meta.json`` (API.md §12.2)."""
    job = store.get(job_id)
    meta = job.read_meta()
    meta["title"] = title
    job.write_meta(meta)
    log.info("rename: job=%s title=%r", job_id, title)
    return {"ok": True, "title": title}


def delete_job(store: JobStore, job_id: str) -> dict:
    """Remove the entire job directory (API.md §12.3)."""
    job = store.get(job_id)  # 404 if unknown
    shutil.rmtree(job.data_dir)
    log.info("delete: job=%s removed", job_id)
    return {"ok": True}


def _job_package_count(job: Job) -> int:
    """Total built package dirs across all of a job's slices (passing or failed)."""
    count = 0
    if not job.slices_dir.is_dir():
        return 0
    for sdir in job.slices_dir.iterdir():
        if not sdir.is_dir() or not is_valid_id(sdir.name):
            continue
        packages_dir = sdir / "packages"
        if packages_dir.is_dir():
            count += sum(
                1
                for p in packages_dir.iterdir()
                if p.is_dir() and is_valid_id(p.name)
            )
    return count


# ---------------------------------------------------------------------------
# Packages.
# ---------------------------------------------------------------------------
def list_packages(store: JobStore, job_id: str) -> list[dict]:
    """List every package built under a job, across all slices, newest first (§12.4).

    Each row reuses the packager/budget kernels for its summary: ``frame_count`` from
    the package's own ``frames/``, ``weight_mb`` from :func:`packager.package_weight_mb`,
    ``lane`` from :func:`budget.lane_for_count`. ``thumb_url`` is the package's existing
    ``frames/frame_000.webp`` (never copied/regenerated); ``download_url`` is the static
    zip when the gate passed, else ``null`` (a failed package writes no zip — §7.3).
    """
    job = store.get(job_id)
    out: list[dict] = []
    if not job.slices_dir.is_dir():
        return out
    for sdir in sorted(job.slices_dir.iterdir()):
        if not sdir.is_dir() or not is_valid_id(sdir.name):
            continue
        packages_dir = sdir / "packages"
        if not packages_dir.is_dir():
            continue
        for pdir in packages_dir.iterdir():
            if not pdir.is_dir() or not is_valid_id(pdir.name):
                continue
            out.append(_package_summary(job_id, sdir.name, pdir))
    out.sort(key=lambda p: p["created_at"], reverse=True)
    return out


def _package_summary(job_id: str, slice_id: str, pkg_dir: Path) -> dict:
    """Build one §12.4 package row from a package dir (reusing the existing kernels)."""
    package_id = pkg_dir.name
    frames_dir = pkg_dir / "frames"
    frame_count = (
        len(list(frames_dir.glob(_WEBP_GLOB))) if frames_dir.is_dir() else 0
    )
    base = f"/data/jobs/{job_id}/slices/{slice_id}/packages/{package_id}"

    thumb_url = None
    if (frames_dir / "frame_000.webp").is_file():
        thumb_url = f"{base}/frames/frame_000.webp"

    zips = sorted(pkg_dir.glob(_ANIMATION_ZIP_GLOB))
    download_url = f"{base}/{zips[0].name}" if zips else None

    return {
        "package_id": package_id,
        "slice_id": slice_id,
        "created_at": _package_created_at(pkg_dir),
        "frame_count": frame_count,
        "weight_mb": packager.package_weight_mb(pkg_dir),
        "lane": budget.lane_for_count(frame_count),
        "thumb_url": thumb_url,
        "download_url": download_url,
    }


def _package_created_at(pkg_dir: Path) -> str:
    """Stored ``created_at`` from ``_hints.json`` if present, else the dir mtime."""
    hints_path = pkg_dir / "_hints.json"
    if hints_path.is_file():
        try:
            hints = json.loads(hints_path.read_text())
            stored = hints.get("created_at")
            if isinstance(stored, str) and stored:
                return stored
        except (OSError, json.JSONDecodeError):  # pragma: no cover - defensive
            pass
    return _mtime_iso(pkg_dir)


def delete_package(store: JobStore, job_id: str, package_id: str) -> dict:
    """Remove one package dir, finding its owning slice by enumeration (§12.5).

    The DELETE path carries no ``slice_id`` (a ``package_id`` is unique within a job),
    so we scan the job's slices for the one whose ``packages/{package_id}`` exists.
    """
    job = store.get(job_id)
    if job.slices_dir.is_dir():
        for sdir in job.slices_dir.iterdir():
            if not sdir.is_dir() or not is_valid_id(sdir.name):
                continue
            pkg_dir = sdir / "packages" / package_id
            if pkg_dir.is_dir():
                shutil.rmtree(pkg_dir)
                log.info("delete: job=%s package=%s removed", job_id, package_id)
                return {"ok": True}
    raise ApiError(404, "unknown package_id", package_id)
