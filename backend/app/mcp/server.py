"""FastMCP server: ``slice_video`` / ``slice_frames`` over stdio (spec §7).

Both tools reuse the slicer's pure functions directly (no re-shelling, no
``Job``/``JobStore``) over temporary directories:

* ``slice_video`` — :func:`slicing.extract_preview` (ffmpeg trim+fps → JPEG) then
  :func:`slicing.finalize_to_webp` (→ contiguous WebP) then
  :func:`packager.build_and_verify`.
* ``slice_frames`` — :func:`slicing.convert_frames_to_webp` (Remotion-style
  PNG/JPEG/WebP dir → contiguous WebP) then :func:`packager.build_and_verify`.

ERROR CONTRACT (spec §7.3):

* **Gate failure** — a package built but ≥1 gate failed. ``build_and_verify``
  returns ``verify.pass=false`` *normally* (not an exception), so it flows through
  as a successful tool return; the agent inspects ``verify.gates``.
* **Non-gate failure** — bad/missing path, empty dir, ffmpeg/node missing, an
  ``ApiError`` from any primitive, or any unexpected exception — is CAUGHT and
  returned as the structured ``{"error": {"code", "message"}}`` object. NEVER an
  unhandled exception, and NEVER a write to stdout.

stdout is reserved for JSON-RPC; all diagnostics go to stderr via :mod:`logging`.
The package dir is created with :func:`tempfile.mkdtemp` (NOT a context manager)
so it OUTLIVES the call — the agent reads it afterwards; only the intermediate
preview/slice scratch dirs are cleaned up.

Imports are RELATIVE (``from ..packager import …``) so the module resolves under
both ``app.mcp.server`` (wheel / editable install) and ``backend.app.mcp.server``
(repo-root cwd, as the test suite imports) — path-agnostic by design.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from ..config import MAX_SLICE_SECONDS, WEBP_QUALITY
from ..errors import ApiError, validate_fps
from .. import packager, slicing

log = logging.getLogger("svs.mcp")

mcp = FastMCP("seo-video-slicer")

#: Tempdir prefixes (so any leaked scratch is greppable / cleanable by name).
_PKG_PREFIX = "svs-mcp-pkg-"
_SCRATCH_PREFIX = "svs-mcp-scratch-"


# ---------------------------------------------------------------------------
# Path validation — `validate_data_subpath`/`validate_id`-STYLE checks adapted
# for CALLER-SUPPLIED ABSOLUTE paths (spec §7.6). The `/data` subpath validator
# rejects a leading `/`, so it cannot be used directly on absolute MCP inputs; we
# reuse its *philosophy* (reject `..` / NUL / malformed, resolve to absolute,
# require existence) here.
# ---------------------------------------------------------------------------
def _validate_input_path(raw: str, *, expect: str) -> Path:
    """Resolve + validate a caller-supplied path; raise :class:`ApiError` on bad input.

    ``expect`` is ``"file"`` (a video) or ``"dir"`` (a frames directory). Rejects an
    empty string, NUL bytes, and ``..`` traversal segments BEFORE filesystem access
    (mirroring :func:`errors.validate_data_subpath`), resolves to an absolute path,
    and requires the path to exist and be of the expected kind. The raised
    ``ApiError`` is mapped to the structured ``{error}`` by :func:`_run`.
    """
    if not raw or not isinstance(raw, str):
        raise ApiError(400, "invalid path", "path must be a non-empty string")
    if "\x00" in raw:
        raise ApiError(400, "invalid path", "path must not contain a NUL byte")
    # Reject traversal segments in the *supplied* string (an absolute path is fine;
    # a `..` component is the foot-gun §7.6 guards against).
    if ".." in Path(raw).parts:
        raise ApiError(400, "invalid path", "path traversal ('..') is not permitted")

    resolved = Path(raw).expanduser().resolve()
    if not resolved.exists():
        raise ApiError(404, "path not found", str(resolved))
    if expect == "file" and not resolved.is_file():
        raise ApiError(400, "not a file", f"expected a video file: {resolved}")
    if expect == "dir" and not resolved.is_dir():
        raise ApiError(400, "not a directory", f"expected a frames directory: {resolved}")
    return resolved


def _new_package_dir(slug: str) -> Path:
    """Allocate a persistent package dir (mkdtemp, NOT auto-deleted) so it OUTLIVES
    the tool call — the agent reads ``package_dir`` after the call returns."""
    return Path(tempfile.mkdtemp(prefix=f"{_PKG_PREFIX}{slug}-"))


def _project_result(build_result: dict) -> dict:
    """Project ``build_and_verify``'s dict to the spec §7.3 return shape.

    ``build_and_verify`` returns extra keys (``frame_count``, ``weight_mb``,
    ``lane``, ``zip_path`` — the last a non-JSON-serializable ``Path``). The MCP
    contract is exactly ``{package_dir, verify, loop_webp}``; we build it
    explicitly so nothing un-serializable leaks into the JSON-RPC response.
    """
    return {
        "package_dir": build_result["package_dir"],
        "verify": build_result["verify"],
        "loop_webp": build_result["loop_webp"],
    }


def _run(fn) -> dict:
    """Execute a tool body, enforcing the §7.3 error contract.

    A GATE failure is a *successful* return (``verify.pass=false`` flows through).
    A NON-gate failure — ``ApiError`` or any unexpected exception — is CAUGHT and
    returned as ``{"error": {"code", "message"}}``. Never raises, never touches
    stdout.
    """
    try:
        return fn()
    except ApiError as exc:
        log.warning("tool error (ApiError %s): %s", exc.status_code, exc.error)
        return {"error": {"code": exc.error, "message": exc.detail or exc.error}}
    except Exception as exc:  # noqa: BLE001 — the contract: never an unhandled exception.
        log.exception("tool error (unexpected)")
        return {"error": {"code": "internal_error", "message": str(exc)}}


def _build_from_slice(
    slice_dir: Path, slug: str, fps: float, mode: str, resolution: str, origin: str
) -> dict:
    """Shared tail: ``build_and_verify`` over a contiguous WebP slice + project.

    Metadata is computed once (spec §5.2 step 4): ``duration_s = frame_count / fps``
    (a frames-dir / trimmed clip's loop length), ``fps_effective = fps``.
    """
    frame_count = len(sorted(slice_dir.glob("frame_*.webp")))
    if frame_count < 1:
        raise ApiError(422, "no frames", "the slice produced zero frames")
    # fps is already guaranteed finite > 0 by the front-door validate_fps in each tool.
    duration_s = round(frame_count / fps, 3)
    pkg_dir = _new_package_dir(slug)
    result = packager.build_and_verify(
        slice_dir=slice_dir,
        pkg_dir=pkg_dir,
        slug=slug,
        duration_s=duration_s,
        fps_effective=fps,
        resolution=resolution,
        origin=origin,
        mode=mode,
    )
    return _project_result(result)


@mcp.tool()
def slice_video(
    path: str,
    start: float | None = None,
    end: float | None = None,
    fps: float = 12,
    mode: str = "scroll",
) -> dict:
    """Slice a video file into a verified WebP package (spec §7.3).

    Args:
        path: Absolute path to a video file. Auto-validated (no ``..`` / NUL,
            resolved, must exist and be a file).
        start: Trim window start in seconds (default ``0.0``).
        end: Trim window end in seconds (default ``start + MAX_SLICE_SECONDS``;
            ffmpeg stops at EOF, so a too-long clip is bounded by the source).
        fps: Effective frames-per-second for extraction (drives the loop cadence).
        mode: ``"scroll"`` (default) or ``"loop"``.

    Returns:
        ``{package_dir, verify: {pass, gates[]}, loop_webp}`` on a build (a gate
        failure returns ``verify.pass=false`` — the call still succeeds), or
        ``{error: {code, message}}`` on a non-gate failure (bad path, empty input,
        ffmpeg/node missing, build crash). Never raises, never writes to stdout.
    """

    def _body() -> dict:
        if mode not in ("scroll", "loop"):
            raise ApiError(422, "invalid mode", f"mode must be 'scroll' or 'loop' (got {mode!r})")
        # Front-door fps guard (spec §7.3): a non-positive/non-finite fps is a non-gate
        # failure → {error} shape. Validated before path/ffmpeg work (no video needed).
        validate_fps(fps)
        video = _validate_input_path(path, expect="file")
        begin = start if start is not None else 0.0
        finish = end if end is not None else begin + MAX_SLICE_SECONDS
        slug = packager.sanitize_slug(None, video.stem)
        with tempfile.TemporaryDirectory(prefix=_SCRATCH_PREFIX) as scratch:
            scratch_path = Path(scratch)
            preview_dir = scratch_path / "preview"
            slice_dir = scratch_path / "slice"
            slicing.extract_preview(video, preview_dir, begin, finish, fps)
            _basenames, resolution = slicing.finalize_to_webp(
                preview_dir, slice_dir, excluded=[], quality=WEBP_QUALITY
            )
            return _build_from_slice(
                slice_dir, slug, fps, mode, resolution, origin="mcp:slice_video"
            )

    return _run(_body)


@mcp.tool()
def slice_frames(dir: str, fps: float = 12, mode: str = "scroll") -> dict:
    """Slice a frames directory (Remotion ``--sequence``) into a verified package.

    Args:
        dir: Absolute path to a directory of PNG/JPEG/WebP frames (numeric-sorted,
            renumbered to contiguous WebP — spec §8.2). Auto-validated.
        fps: Effective frames-per-second (sets the loop cadence; a frames-dir has
            no inherent source length, so ``duration_s = frame_count / fps``).
        mode: ``"scroll"`` (default) or ``"loop"``.

    Returns:
        ``{package_dir, verify: {pass, gates[]}, loop_webp}`` on a build (a gate
        failure returns ``verify.pass=false`` — the call still succeeds), or
        ``{error: {code, message}}`` on a non-gate failure. Never raises, never
        writes to stdout.
    """

    def _body() -> dict:
        if mode not in ("scroll", "loop"):
            raise ApiError(422, "invalid mode", f"mode must be 'scroll' or 'loop' (got {mode!r})")
        # Front-door fps guard (spec §7.3): a non-positive/non-finite fps is a non-gate
        # failure → {error} shape. Validated before path/convert work (no frames needed).
        validate_fps(fps)
        frames_dir = _validate_input_path(dir, expect="dir")
        slug = packager.sanitize_slug(None, frames_dir.name)
        with tempfile.TemporaryDirectory(prefix=_SCRATCH_PREFIX) as scratch:
            slice_dir = Path(scratch) / "slice"
            _basenames, resolution = slicing.convert_frames_to_webp(
                frames_dir, slice_dir, quality=WEBP_QUALITY
            )
            return _build_from_slice(
                slice_dir, slug, fps, mode, resolution, origin="mcp:slice_frames"
            )

    return _run(_body)
