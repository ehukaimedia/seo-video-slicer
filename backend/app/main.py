"""FastAPI application for the SEO Video Slicer (API.md — the frozen contract).

A single-process desktop-local app: it mounts the runtime ``/data`` tree as static
files, serves the built frontend (``frontend/dist``) with SPA fallback when present,
and exposes every ``/api`` endpoint in API.md, delegating to the slicing / erase /
packager / share modules. Every non-2xx response is the ``{"error", "detail"?}``
envelope. Structured ``logging`` throughout — no ``print``.
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, File, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import management, packager, share, slicing
from .config import (
    DATA_DIR,
    DEFAULT_SLICE_SECONDS,
    FRONTEND_DIST,
    MAX_SLICE_SECONDS,
    WEBP_QUALITY,
)
from .erase import erase_region
from .errors import ApiError, validate_data_subpath, validate_id
from .jobs import Job, JobStore, _new_id

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("svs.main")

app = FastAPI(title="SEO Video Slicer", version="1.0")

# Dev CORS: a desktop-local app reachable on localhost/LAN/tailnet. No auth surface.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

store = JobStore(DATA_DIR)


# ===========================================================================
# Error model — every non-2xx becomes {"error", "detail"?} (API.md §9).
# ===========================================================================
@app.exception_handler(ApiError)
async def _api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.body())


@app.exception_handler(RequestValidationError)
async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Reshape FastAPI's default {"detail": [...]} into the frozen envelope.
    try:
        first = exc.errors()[0]
        loc = ".".join(str(p) for p in first.get("loc", []))
        detail = f"{loc}: {first.get('msg', 'invalid')}"
    except Exception:  # pragma: no cover - defensive
        detail = "request validation failed"
    return JSONResponse(status_code=422, content={"error": "invalid request", "detail": detail})


@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else None
    error = detail or {404: "not found", 400: "bad request"}.get(exc.status_code, "error")
    body: dict[str, str] = {"error": error}
    if detail and detail != error:
        body["detail"] = detail
    return JSONResponse(status_code=exc.status_code, content=body)


@app.exception_handler(Exception)
async def _unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error")
    return JSONResponse(
        status_code=500, content={"error": "internal server error", "detail": str(exc)[:300]}
    )


# ===========================================================================
# Helpers — slice meta, URL builders, frame listings.
# ===========================================================================
def _slice_meta_path(job: Job, slice_id: str) -> Path:
    return job.slice_dir(slice_id) / "meta.json"


def _read_slice_meta(job: Job, slice_id: str) -> dict:
    path = _slice_meta_path(job, slice_id)
    if not path.exists():
        raise ApiError(404, "unknown slice_id", slice_id)
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ApiError(500, "slice meta unreadable", str(exc)) from exc


def _write_slice_meta(job: Job, slice_id: str, meta: dict) -> None:
    _slice_meta_path(job, slice_id).write_text(json.dumps(meta, indent=2))


def _require_slice(job: Job, slice_id: str) -> Path:
    """Return an existing slice dir or raise 404 (id already format-validated)."""
    sdir = job.slice_dir(slice_id)
    if not sdir.is_dir() or not _slice_meta_path(job, slice_id).exists():
        raise ApiError(404, "unknown slice_id", slice_id)
    return sdir


def _preview_frame_url(job_id: str, preview_id: str, name: str) -> str:
    return f"/data/jobs/{job_id}/previews/{preview_id}/{name}"


def _slice_frame_entries(job_id: str, slice_id: str, slice_dir: Path) -> list[dict[str, str]]:
    """Ordered ``[{name, url}]`` for a slice's WebP frames with ``?v=<mtime>`` (API.md §3)."""
    entries: list[dict[str, str]] = []
    for path in slicing.list_slice_frames(slice_dir):
        mtime = int(path.stat().st_mtime)
        entries.append(
            {
                "name": path.name,
                "url": f"/data/jobs/{job_id}/slices/{slice_id}/{path.name}?v={mtime}",
            }
        )
    return entries


def _path_is_within(path: Path, root: Path) -> bool:
    """True when a resolved filesystem path remains under a resolved root."""
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


# ===========================================================================
# 1. POST /api/upload
# ===========================================================================
@app.post("/api/upload")
async def upload(file: UploadFile = File(...)) -> dict[str, Any]:
    if file is None or not file.filename:
        raise ApiError(400, "no file part", "expected a multipart 'file' field")
    if file.content_type not in (
        "video/mp4",
        "video/quicktime",
        "video/webm",
    ):
        raise ApiError(
            415, "unsupported media type", f"got {file.content_type!r}; expected mp4/mov/webm"
        )

    job = store.create()
    try:
        contents = await file.read()
        job.video_path.write_bytes(contents)
    except OSError as exc:
        raise ApiError(500, "storage failure", str(exc)) from exc

    probe = store.probe(job.video_path)  # 422 on corrupt
    store.make_thumbnail(job.video_path, job.thumb_path)  # 500 on failure

    meta = {
        "job_id": job.job_id,
        "filename": file.filename,
        # Display title defaults to the filename; renamable via PUT /api/jobs/{id}.
        "title": file.filename,
        # Stored at creation so "newest first" survives a later rename (mtime would
        # reorder the list the moment meta.json is rewritten — see management.py).
        "created_at": management.now_iso(),
        "duration_s": probe["duration_s"],
        "width": probe["width"],
        "height": probe["height"],
        "fps": probe["fps"],
        "default_slice_seconds": DEFAULT_SLICE_SECONDS,
    }
    job.write_meta(meta)
    log.info("upload: job=%s file=%s %dx%d %.2fs", job.job_id, file.filename,
             probe["width"], probe["height"], probe["duration_s"])

    return {
        "job_id": job.job_id,
        "filename": file.filename,
        "duration_s": probe["duration_s"],
        "width": probe["width"],
        "height": probe["height"],
        "fps": probe["fps"],
        "thumb_url": f"/data/jobs/{job.job_id}/thumb.jpg",
    }


# ===========================================================================
# 2. GET /api/jobs/{job_id}
# ===========================================================================
@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    job = store.get(job_id)
    meta = job.read_meta()
    return {
        "job_id": job.job_id,
        "filename": meta.get("filename"),
        "duration_s": meta.get("duration_s"),
        "width": meta.get("width"),
        "height": meta.get("height"),
        "slices": job.list_slices(),
    }


# ===========================================================================
# 3. POST /api/jobs/{job_id}/preview
# ===========================================================================
@app.post("/api/jobs/{job_id}/preview")
async def preview(job_id: str, body: dict = Body(...)) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    job = store.get(job_id)
    meta = job.read_meta()

    start = _as_number(body.get("start"), "start")
    end = _as_number(body.get("end"), "end")
    fps = _as_number(body.get("fps"), "fps")

    duration_s = float(meta.get("duration_s") or 0.0)
    if start < 0 or start >= end:
        raise ApiError(422, "invalid trim range", "require 0 <= start < end")
    if end > duration_s + 1e-3:
        raise ApiError(422, "end beyond duration", f"end {end} > duration {duration_s}")
    if fps <= 0:
        raise ApiError(422, "invalid fps", "fps must be > 0")
    if (end - start) > MAX_SLICE_SECONDS:
        raise ApiError(
            422,
            "slice too long",
            f"end - start ({end - start:.3f}s) exceeds MAX_SLICE_SECONDS ({MAX_SLICE_SECONDS}s)",
        )

    preview_id = _new_id("p")
    out_dir = job.previews_dir / preview_id
    names = slicing.extract_preview(job.video_path, out_dir, start, end, fps)

    # Persist the originating fps/range so finalize can carry them into slice meta.
    (out_dir / "preview_meta.json").write_text(
        json.dumps({"start": start, "end": end, "fps": fps})
    )

    return {
        "preview_id": preview_id,
        "count": len(names),
        "frames": [
            {"name": n, "url": _preview_frame_url(job_id, preview_id, n)} for n in names
        ],
    }


# ===========================================================================
# 4. POST /api/jobs/{job_id}/finalize
# ===========================================================================
@app.post("/api/jobs/{job_id}/finalize")
async def finalize(job_id: str, body: dict = Body(...)) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    job = store.get(job_id)

    preview_id = body.get("preview_id")
    if not isinstance(preview_id, str):
        raise ApiError(422, "missing preview_id", "preview_id is required")
    validate_id(preview_id, "preview_id")

    excluded = body.get("excluded", [])
    if not isinstance(excluded, list) or not all(isinstance(e, str) for e in excluded):
        raise ApiError(422, "invalid excluded", "excluded must be an array of strings")

    preview_dir = job.previews_dir / preview_id
    if not preview_dir.is_dir():
        raise ApiError(404, "unknown preview_id", preview_id)

    slice_id = _new_id("s")
    slice_dir = job.slice_dir(slice_id)
    names, resolution = slicing.finalize_to_webp(preview_dir, slice_dir, excluded, WEBP_QUALITY)

    # Self-consistent slice meta: fps from the originating preview; duration derived
    # from the kept frame count so manifest count/fps/duration agree.
    fps_effective = _preview_fps(preview_dir)
    kept = len(names)
    duration_s = round(kept / fps_effective, 3) if fps_effective > 0 else 0.0
    meta = {
        "slice_id": slice_id,
        "duration_s": duration_s,
        "fps_effective": fps_effective,
        "resolution": resolution,
        "crop_box": _full_frame_box(resolution),  # [x, y, w, h] of the full frame
        "tier_used": None,
        "origin": "user-supplied video",
    }
    _write_slice_meta(job, slice_id, meta)
    log.info("finalize: slice=%s frames=%d fps=%s dur=%.3fs %s",
             slice_id, kept, fps_effective, duration_s, resolution)

    return {
        "slice_id": slice_id,
        "count": kept,
        "frames": _slice_frame_entries(job_id, slice_id, slice_dir),
    }


# ===========================================================================
# 5. POST /api/jobs/{job_id}/slices/{slice_id}/crop
# ===========================================================================
@app.post("/api/jobs/{job_id}/slices/{slice_id}/crop")
async def crop(job_id: str, slice_id: str, body: dict = Body(...)) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    validate_id(slice_id, "slice_id")
    job = store.get(job_id)
    slice_dir = _require_slice(job, slice_id)

    mode = body.get("mode")
    frames = slicing.list_slice_frames(slice_dir)
    if not frames:
        raise ApiError(422, "zero frames", "slice has no frames to crop")

    if mode == "auto":
        box = slicing.auto_crop_box(frames)
    elif mode == "manual":
        box = slicing.validate_manual_box(body.get("box"), frames)
    else:
        raise ApiError(422, "invalid mode", "mode must be 'auto' or 'manual'")

    applied = slicing.apply_crop(slice_dir, box, WEBP_QUALITY)

    meta = _read_slice_meta(job, slice_id)
    meta["crop_box"] = list(applied)
    meta["resolution"] = slicing.slice_resolution(slice_dir)
    _write_slice_meta(job, slice_id, meta)

    return {
        "ok": True,
        "crop_box": list(applied),
        "frames": _slice_frame_entries(job_id, slice_id, slice_dir),
    }


# ===========================================================================
# 6. POST /api/jobs/{job_id}/slices/{slice_id}/erase
# ===========================================================================
@app.post("/api/jobs/{job_id}/slices/{slice_id}/erase")
async def erase(job_id: str, slice_id: str, body: dict = Body(...)) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    validate_id(slice_id, "slice_id")
    job = store.get(job_id)
    slice_dir = _require_slice(job, slice_id)

    box = body.get("box")
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        raise ApiError(422, "invalid box", "box must be [x, y, w, h]")
    try:
        ibox = tuple(int(v) for v in box)
    except (TypeError, ValueError) as exc:
        raise ApiError(422, "invalid box", "box values must be integers") from exc

    frames = slicing.list_slice_frames(slice_dir)
    if not frames:
        raise ApiError(422, "zero frames", "slice has no frames to erase")
    fh, fw = slicing._read(frames[0]).shape[:2]
    x, y, w, h = ibox
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > fw or y + h > fh:
        raise ApiError(422, "box out of bounds", f"box must lie within {fw}x{fh}")

    tier = body.get("tier", "auto")
    if not isinstance(tier, str):
        raise ApiError(422, "invalid tier", "tier must be a string")

    tier_used, _n = erase_region(slice_dir, ibox, tier, WEBP_QUALITY)

    meta = _read_slice_meta(job, slice_id)
    meta["tier_used"] = tier_used
    _write_slice_meta(job, slice_id, meta)

    return {
        "ok": True,
        "tier_used": tier_used,
        "frames": _slice_frame_entries(job_id, slice_id, slice_dir),
    }


# ===========================================================================
# 7. POST /api/jobs/{job_id}/slices/{slice_id}/package
# ===========================================================================
@app.post("/api/jobs/{job_id}/slices/{slice_id}/package")
async def build_package(job_id: str, slice_id: str, body: dict = Body(default={})) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    validate_id(slice_id, "slice_id")
    job = store.get(job_id)
    slice_dir = _require_slice(job, slice_id)

    frames = slicing.list_slice_frames(slice_dir)
    if not frames:
        raise ApiError(422, "zero-frame slice", "a slice needs >=1 frame to package")

    meta = _read_slice_meta(job, slice_id)
    for key in ("duration_s", "fps_effective", "resolution"):
        if meta.get(key) in (None, "", "0x0"):
            raise ApiError(422, "slice meta incomplete", f"missing packager input: {key}")

    job_meta = job.read_meta()
    fallback = packager.sanitize_slug(None, Path(job_meta.get("filename", "package")).stem)
    slug = packager.sanitize_slug(body.get("slug"), fallback)

    package_id = _new_id("pkg")
    pkg_dir = slice_dir / "packages" / package_id
    # headline / accent are accepted but NOT passed to the kernel (brand-neutral);
    # store them as reserved hints alongside the package.
    result = packager.build_and_verify(
        slice_dir=slice_dir,
        pkg_dir=pkg_dir,
        slug=slug,
        duration_s=meta["duration_s"],
        fps_effective=meta["fps_effective"],
        resolution=meta["resolution"],
        origin=meta.get("origin", "user-supplied video"),
        quality=WEBP_QUALITY,
    )
    _store_package_hints(pkg_dir, body, slug, package_id)

    passed = result["verify"]["pass"]
    download_url = (
        f"/api/jobs/{job_id}/slices/{slice_id}/package/download" if passed else None
    )
    preview_url = (
        f"/data/jobs/{job_id}/slices/{slice_id}/packages/{package_id}/index.html"
        if passed
        else None
    )

    return {
        "package_id": package_id,
        "verify": result["verify"],
        "frame_count": result["frame_count"],
        "weight_mb": result["weight_mb"],
        "lane": result["lane"],
        "download_url": download_url,
        "preview_url": preview_url,
    }


# ===========================================================================
# 7b. GET /api/jobs/{job_id}/slices/{slice_id} — load a saved slice's frames
#     so a SAVED SLICES card can re-open into the Clean/Export workspace.
# ===========================================================================
@app.get("/api/jobs/{job_id}/slices/{slice_id}")
async def get_slice(job_id: str, slice_id: str) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    validate_id(slice_id, "slice_id")
    job = store.get(job_id)
    slice_dir = _require_slice(job, slice_id)
    frames = _slice_frame_entries(job_id, slice_id, slice_dir)
    return {"slice_id": slice_id, "count": len(frames), "frames": frames}


# ===========================================================================
# 7c. DELETE /api/jobs/{job_id}/slices/{slice_id} — remove a saved slice
# ===========================================================================
@app.delete("/api/jobs/{job_id}/slices/{slice_id}")
async def delete_slice(job_id: str, slice_id: str) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    validate_id(slice_id, "slice_id")
    job = store.get(job_id)
    slice_dir = _require_slice(job, slice_id)
    shutil.rmtree(slice_dir, ignore_errors=True)
    log.info("deleted slice %s from job %s", slice_id, job_id)
    return {"ok": True}


# ===========================================================================
# 8. GET /api/jobs/{job_id}/slices/{slice_id}/package/download
# ===========================================================================
@app.get("/api/jobs/{job_id}/slices/{slice_id}/package/download")
async def download_package(job_id: str, slice_id: str) -> FileResponse:
    validate_id(job_id, "job_id")
    validate_id(slice_id, "slice_id")
    job = store.get(job_id)
    slice_dir = _require_slice(job, slice_id)

    packages_dir = slice_dir / "packages"
    # API.md §8.1: 404 when no package exists OR when *the latest* package failed
    # its gate. We key on the newest package DIR (by mtime), not the newest zip —
    # a later failed build (which writes no zip) must NOT fall back to an earlier
    # passing one. Only the latest build's gate result governs downloadability.
    pkg_dirs = (
        [d for d in packages_dir.iterdir() if d.is_dir()]
        if packages_dir.is_dir()
        else []
    )
    if not pkg_dirs:
        raise ApiError(404, "no downloadable package", "build a package that passes the gate first")

    latest = max(pkg_dirs, key=lambda d: d.stat().st_mtime)
    zips = list(latest.glob("*-animation.zip"))
    if not zips:
        raise ApiError(
            404,
            "no downloadable package",
            "the latest package failed its gate and is not downloadable",
        )

    zip_path = zips[0]
    return FileResponse(
        path=str(zip_path),
        media_type="application/zip",
        filename=zip_path.name,
    )


# ===========================================================================
# 9. GET /api/share
# ===========================================================================
@app.get("/api/share")
async def get_share() -> dict[str, str | None]:
    return share.share_status()


# ===========================================================================
# Management surface (API.md §12) — list/rename/delete jobs; list/delete packages.
# Thin route layer over app.management (which reuses JobStore/packager/budget).
# ===========================================================================
@app.get("/api/jobs")
async def list_jobs() -> dict[str, Any]:
    return {"jobs": management.list_jobs(store)}


@app.put("/api/jobs/{job_id}")
async def rename_job(job_id: str, body: dict = Body(...)) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    title = body.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ApiError(422, "invalid title", "title must be a non-empty string")
    return management.rename_job(store, job_id, title.strip())


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    return management.delete_job(store, job_id)


@app.get("/api/jobs/{job_id}/packages")
async def list_packages(job_id: str) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    return {"packages": management.list_packages(store, job_id)}


@app.delete("/api/jobs/{job_id}/packages/{package_id}")
async def delete_package(job_id: str, package_id: str) -> dict[str, Any]:
    validate_id(job_id, "job_id")
    validate_id(package_id, "package_id")
    return management.delete_package(store, job_id, package_id)


# ===========================================================================
# Static: /data/...  (read-only frame/thumb serving, traversal-guarded)
# ===========================================================================
@app.get("/data/{subpath:path}")
async def serve_data(subpath: str) -> FileResponse:
    validate_data_subpath(subpath)
    target = (DATA_DIR / subpath).resolve()
    # Defense in depth: the resolved path must stay within DATA_DIR.
    if not _path_is_within(target, DATA_DIR):
        raise ApiError(400, "invalid path", "path escapes data root")
    if not target.is_file():
        raise ApiError(404, "not found", subpath)
    return FileResponse(path=str(target))


# ===========================================================================
# Frontend (frontend/dist) at / with SPA fallback — only if built.
# ===========================================================================
def _mount_frontend() -> None:
    if not FRONTEND_DIST.is_dir() or not (FRONTEND_DIST / "index.html").exists():
        log.info("frontend dist not present at %s; serving API only", FRONTEND_DIST)

        @app.get("/")
        async def _root_placeholder() -> dict[str, str]:
            return {"status": "ok", "frontend": "not built", "api": "/api"}

        return

    assets = FRONTEND_DIST / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    index_html = FRONTEND_DIST / "index.html"

    @app.get("/")
    async def _root() -> FileResponse:
        return FileResponse(str(index_html))

    @app.get("/{full_path:path}")
    async def _spa_fallback(full_path: str) -> Response:
        # Never shadow /api or /data; serve a real static file if it exists, else SPA.
        if full_path.startswith(("api/", "data/", "assets/")):
            raise ApiError(404, "not found", full_path)
        candidate = (FRONTEND_DIST / full_path).resolve()
        if _path_is_within(candidate, FRONTEND_DIST) and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(index_html))

    log.info("frontend mounted from %s", FRONTEND_DIST)


# ===========================================================================
# Small typed helpers.
# ===========================================================================
def _as_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(422, f"invalid {label}", f"{label} must be a number")
    return float(value)


def _preview_fps(preview_dir: Path) -> float:
    meta_path = preview_dir / "preview_meta.json"
    if meta_path.exists():
        try:
            return float(json.loads(meta_path.read_text()).get("fps") or 0.0)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
    return 0.0


def _full_frame_box(resolution: str) -> list[int]:
    if "x" not in resolution:
        return [0, 0, 0, 0]
    try:
        w, h = (int(p) for p in resolution.split("x"))
        return [0, 0, w, h]
    except ValueError:
        return [0, 0, 0, 0]


def _store_package_hints(pkg_dir: Path, body: dict, slug: str, package_id: str) -> None:
    """Persist accepted-but-not-injected headline/accent as reserved hints (API.md §7.3)."""
    hints = {
        "package_id": package_id,
        "slug": slug,
        # Stable creation instant for the management package listing (§12.4); mtime
        # is the legacy fallback for packages built before this field existed.
        "created_at": management.now_iso(),
        "headline": body.get("headline"),
        "accent": body.get("accent"),
    }
    try:
        (pkg_dir / "_hints.json").write_text(json.dumps(hints, indent=2))
    except OSError:  # pragma: no cover - non-fatal
        log.warning("could not write package hints")


# Mount the frontend LAST so its catch-all does not shadow the /api and /data routes.
_mount_frontend()
