"""Slicing operations: preview extraction, finalize→WebP, crop (API.md §6, §7.1).

Cherry-picked CLEAN from ``smart-image-animations/backend/app/slicing.py`` (the
OpenCV auto-crop + watermark-symmetry-enforcer + portrait/landscape safety margin),
with the AI/Gemma crop branch dropped entirely, real ``logging`` instead of
``print("DEBUG: …")``, type hints, and a single format per stage (JPEG preview →
WebP slice — no 4-format sprawl).

Erase lives in :mod:`erase`; packaging in :mod:`packager`. This module never
inpaints and never shells out to the kernel.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .config import MAX_SLICE_SECONDS, WEBP_QUALITY
from .errors import ApiError

log = logging.getLogger("svs.slicing")

#: Edge-pixel threshold below which a side is treated as "uncropped" by the
#: watermark enforcer (ported from the source's ``> 20 / < 20`` heuristic).
_EDGE_EPS = 20

#: Forced crop depth applied by the portrait/landscape watermark safety margin.
_WATERMARK_MARGIN = 80

#: OpenCV threshold for the contour/threshold auto-crop (source used 30).
_AUTOCROP_THRESH = 30

#: Frame-source globs for :func:`convert_frames_to_webp` (broad; also matches the
#: legacy ``frame_*`` and Remotion's ``element-NNNN`` default — spec §8.2).
_FRAME_SRC_GLOBS = ("*.png", "*.jpg", "*.jpeg", "*.webp")

#: Trailing-integer extractor — the LAST run of digits in a basename (stem). Used
#: to sort Remotion's ``element-10`` AFTER ``element-2`` (a naive lexicographic
#: sort breaks; spec §8.2). A file with no trailing integer is an error.
_TRAILING_INT_RE = re.compile(r"(\d+)(?!.*\d)")


def _trailing_int(stem: str) -> int | None:
    """Return the last run of digits in ``stem`` as an int, or ``None`` if none."""
    match = _TRAILING_INT_RE.search(stem)
    return int(match.group(1)) if match else None


def _resize_if_wider(img: Image.Image, max_width: int | None) -> Image.Image:
    """Downscale ``img`` to ``max_width`` when wider; preserve aspect, no upscaling."""
    if max_width is None or img.width <= max_width:
        return img

    target_height = max(1, round(img.height * (max_width / img.width)))
    if target_height > 1 and target_height % 2:
        target_height = max(2, target_height - 1)
    return img.resize((max_width, target_height), Image.Resampling.LANCZOS)


# ---------------------------------------------------------------------------
# Remotion / frames-dir ingest — arbitrary PNG/JPEG/WebP → contiguous WebP (§8.2).
# ---------------------------------------------------------------------------
def convert_frames_to_webp(
    src_dir: Path,
    dst_dir: Path,
    quality: int = WEBP_QUALITY,
    max_width: int | None = None,
) -> tuple[list[str], str]:
    """Convert an arbitrary frames dir → contiguous ``frame_NNN.webp`` (spec §8.2).

    Globs ``*.png``/``*.jpg``/``*.jpeg``/``*.webp`` (broad; also matches the legacy
    ``frame_*`` and Remotion's ``element-NNNN`` default), sorts **numerically by the
    trailing integer** in each filename so ``element-2`` precedes ``element-10`` (a
    naive lexicographic sort breaks), and renumbers to a contiguous
    ``frame_000.webp`` sequence (3-digit, starting at 000 regardless of the source's
    first index) via the existing Pillow primitive
    (``Image.open().convert("RGB").save("WEBP", quality, method=6)``).
    When ``max_width`` is set, downscales frames wider than the cap with LANCZOS,
    preserving aspect ratio and never upscaling narrower sources.

    Returns ``(webp_basenames, "WIDTHxHEIGHT")``. Raises 422 on an empty/usable-frame-
    free dir, any file whose name carries no trailing integer to order on, or an
    ambiguous set where two source files share the same trailing integer (no
    consistent ordering); 500 on a conversion failure.
    """
    if not src_dir.is_dir():
        raise ApiError(404, "frames dir not found", str(src_dir))

    sources: list[Path] = []
    for pattern in _FRAME_SRC_GLOBS:
        sources.extend(src_dir.glob(pattern))
    # De-dupe (a glob can't, but be defensive against case-fold collisions) and drop
    # any directory matches.
    sources = sorted({p for p in sources if p.is_file()}, key=lambda p: p.name)
    if not sources:
        raise ApiError(
            422,
            "no usable frames",
            f"no *.png/*.jpg/*.jpeg/*.webp in {src_dir}",
        )

    keyed: list[tuple[int, Path]] = []
    unordered: list[str] = []
    by_index: dict[int, list[str]] = {}
    for path in sources:
        index = _trailing_int(path.stem)
        if index is None:
            unordered.append(path.name)
        else:
            keyed.append((index, path))
            by_index.setdefault(index, []).append(path.name)
    if unordered:
        raise ApiError(
            422,
            "unorderable frame names",
            "no trailing integer to sort on: " + ", ".join(sorted(unordered)[:10]),
        )

    # Reject ambiguous ingest: when more than one source file maps to the same
    # trailing integer there is no consistent ordering (e.g. element-1.png and
    # other-1.jpg both index 1) — error instead of silently emitting two frames.
    collisions = [(index, names) for index, names in by_index.items() if len(names) > 1]
    if collisions:
        collisions.sort(key=lambda item: item[0])
        groups = "; ".join(
            f"index {index}: {', '.join(sorted(names))}" for index, names in collisions
        )
        raise ApiError(422, "ambiguous frame names", f"duplicate trailing index — {groups}")

    # Numeric sort by the trailing integer (name as a stable tiebreak).
    keyed.sort(key=lambda item: (item[0], item[1].name))

    dst_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    resolution = "0x0"
    for new_index, (_src_index, src) in enumerate(keyed):
        dst = dst_dir / f"frame_{new_index:03d}.webp"
        try:
            with Image.open(src) as img:
                rgb = _resize_if_wider(img.convert("RGB"), max_width)
                rgb.save(dst, "WEBP", quality=quality, method=6)
                if new_index == 0:
                    resolution = f"{rgb.width}x{rgb.height}"
        except (OSError, ValueError) as exc:
            log.error("frames->WebP conversion failed for %s: %s", src.name, exc)
            raise ApiError(500, "WebP conversion failure", str(exc)) from exc
        written.append(dst.name)

    log.info(
        "convert_frames_to_webp: %d source frame(s) -> %d WebP at q%d (%s, max_width=%s)",
        len(keyed),
        len(written),
        quality,
        resolution,
        max_width,
    )
    return written, resolution


# ---------------------------------------------------------------------------
# Preview — ffmpeg fps-filter JPEG extraction (API.md §6.1).
# ---------------------------------------------------------------------------
def extract_preview(
    video_path: Path,
    out_dir: Path,
    start: float,
    end: float,
    fps: float,
    max_width: int | None = None,
) -> list[str]:
    """Extract JPEG preview frames for ``[start, end)`` at ``fps`` into ``out_dir``.

    Returns the sorted list of ``frame_NNN.jpg`` basenames. Validation of the trim
    range against the contract (start<end, end≤duration, duration≤ceiling, fps>0)
    is the caller's job *up to* the ceiling; this enforces the ceiling defensively.
    When ``max_width`` is set, ffmpeg downscales wider frames while preserving
    aspect ratio and never upscaling narrower sources.
    Raises 500 on ffmpeg failure.
    """
    if (end - start) > MAX_SLICE_SECONDS:
        raise ApiError(
            422,
            "slice too long",
            f"end - start ({end - start:.3f}s) exceeds MAX_SLICE_SECONDS ({MAX_SLICE_SECONDS}s)",
        )
    if shutil.which("ffmpeg") is None:
        raise ApiError(500, "ffmpeg not found", "install ffmpeg")

    out_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(out_dir / "frame_%03d.jpg")
    vf = f"fps={fps}"
    if max_width is not None:
        vf = f"{vf},scale='min({max_width},iw)':-2:flags=lanczos"
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start}",
        "-to",
        f"{end}",
        "-i",
        str(video_path),
        "-vf",
        vf,
        "-q:v",
        "2",
        # Zero-index the output (image2 defaults to 1) so basenames are frame_000.jpg…,
        # matching the contract's exclusion-name convention (API.md §6.1/§6.2).
        "-start_number",
        "0",
        pattern,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=300)
    if proc.returncode != 0:
        log.error("ffmpeg preview failed: %s", (proc.stderr or "")[-500:])
        raise ApiError(500, "ffmpeg frame extraction failed", (proc.stderr or "").strip()[:400])

    frames = sorted(p.name for p in out_dir.glob("frame_*.jpg"))
    if not frames:
        raise ApiError(500, "ffmpeg produced no frames", "check fps / trim range")
    log.info(
        "preview: extracted %d frame(s) at fps=%s max_width=%s",
        len(frames),
        fps,
        max_width,
    )
    return frames


# ---------------------------------------------------------------------------
# Finalize — kept preview JPEGs → contiguous WebP slice (API.md §6.2).
# ---------------------------------------------------------------------------
def finalize_to_webp(
    preview_dir: Path,
    slice_dir: Path,
    excluded: list[str],
    quality: int = WEBP_QUALITY,
) -> tuple[list[str], str]:
    """Copy kept preview frames → re-indexed ``frame_NNN.webp`` at ``quality``.

    ``excluded`` are bare preview basenames to drop. The kept set (preview minus
    excluded), in sorted order, is re-numbered contiguously from ``frame_000``.
    Returns ``(webp_basenames, "WIDTHxHEIGHT")``. Raises 422 if an excluded name is
    not in the preview or the kept set is empty; 500 on conversion failure.
    """
    available = sorted(p.name for p in preview_dir.glob("frame_*.jpg"))
    if not available:
        raise ApiError(404, "unknown preview_id", "no preview frames on disk")

    available_set = set(available)
    unknown = [name for name in excluded if name not in available_set]
    if unknown:
        raise ApiError(
            422,
            "excluded names not in preview",
            ", ".join(unknown[:10]),
        )

    excluded_set = set(excluded)
    kept = [name for name in available if name not in excluded_set]
    if not kept:
        raise ApiError(422, "zero kept frames", "a slice needs at least one frame")

    slice_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    resolution = "0x0"
    for index, src_name in enumerate(kept):
        src = preview_dir / src_name
        dst = slice_dir / f"frame_{index:03d}.webp"
        try:
            with Image.open(src) as img:
                rgb = img.convert("RGB")
                rgb.save(dst, "WEBP", quality=quality, method=6)
                if index == 0:
                    resolution = f"{rgb.width}x{rgb.height}"
        except (OSError, ValueError) as exc:
            log.error("WebP conversion failed for %s: %s", src_name, exc)
            raise ApiError(500, "WebP conversion failure", str(exc)) from exc
        written.append(dst.name)

    log.info("finalize: wrote %d WebP frame(s) at q%d (%s)", len(written), quality, resolution)
    return written, resolution


# ---------------------------------------------------------------------------
# Crop — manual + auto (OpenCV contour/threshold) with watermark enforcer.
# ---------------------------------------------------------------------------
def list_slice_frames(slice_dir: Path) -> list[Path]:
    """Sorted ``frame_*.webp`` paths in a slice dir (empty list if none)."""
    if not slice_dir.is_dir():
        return []
    return sorted(slice_dir.glob("frame_*.webp"))


def _read(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise ApiError(500, "OpenCV failure", f"could not read {path.name}")
    return img


def _write_webp(path: Path, img: np.ndarray, quality: int) -> None:
    if not cv2.imwrite(str(path), img, [int(cv2.IMWRITE_WEBP_QUALITY), int(quality)]):
        raise ApiError(500, "OpenCV failure", f"could not write {path.name}")


def auto_crop_box(frames: list[Path]) -> tuple[int, int, int, int]:
    """Compute one consistent crop ``[x, y, w, h]`` across frames via OpenCV.

    Deterministic contour/threshold detection (NO AI branch), then the watermark
    **symmetry enforcer** and the portrait/landscape **safety margin** ported clean
    from the source's clever bit (``slicing.py:261-296``). The returned box is the
    union of detected content bounds, hardened against single-sided watermark crops.
    """
    if not frames:
        raise ApiError(422, "zero frames", "slice has no frames to crop")

    h_orig, w_orig = _read(frames[0]).shape[:2]

    # Sample (every 5th frame for long sets) and union the content bounding boxes.
    sample = frames if len(frames) < 20 else frames[::5]
    min_x, min_y = float("inf"), float("inf")
    max_x, max_y = float("-inf"), float("-inf")
    found = False
    for frame_path in sample:
        img = _read(frame_path)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray, _AUTOCROP_THRESH, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            found = True
            x, y, w, h = cv2.boundingRect(np.vstack(contours))
            min_x, min_y = min(min_x, x), min(min_y, y)
            max_x, max_y = max(max_x, x + w), max(max_y, y + h)

    if not found:
        # Nothing distinct detected — keep the full frame.
        return 0, 0, w_orig, h_orig

    min_x, min_y = int(max(0, min_x)), int(max(0, min_y))
    max_x, max_y = int(min(w_orig, max_x)), int(min(h_orig, max_y))

    # --- Watermark SYMMETRY ENFORCER --------------------------------------
    # A significant crop on one edge but none on the opposite edge usually means a
    # centered subject with a one-sided watermark sidebar. Force the opposite edge
    # to match so the watermark is removed and the composition stays centered.
    left_crop = min_x
    right_crop = w_orig - max_x
    if left_crop > _EDGE_EPS and right_crop < _EDGE_EPS:
        log.info("symmetry enforcer: matching right crop to left (%dpx)", left_crop)
        max_x = w_orig - left_crop
    elif right_crop > _EDGE_EPS and left_crop < _EDGE_EPS:
        log.info("symmetry enforcer: matching left crop to right (%dpx)", right_crop)
        min_x = right_crop

    top_crop = min_y
    bottom_crop = h_orig - max_y
    if top_crop > _EDGE_EPS and bottom_crop < _EDGE_EPS:
        log.info("symmetry enforcer: matching bottom crop to top (%dpx)", top_crop)
        max_y = h_orig - top_crop
    elif bottom_crop > _EDGE_EPS and top_crop < _EDGE_EPS:
        log.info("symmetry enforcer: matching top crop to bottom (%dpx)", bottom_crop)
        min_y = bottom_crop

    # --- Portrait/landscape watermark SAFETY MARGIN -----------------------
    # If no edge crop was detected on the watermark-prone side, force a margin:
    # portrait → bottom, landscape → right (where Veo/Google watermarks sit).
    is_portrait = h_orig > w_orig
    if is_portrait:
        if (h_orig - max_y) < _EDGE_EPS:
            log.info("watermark safety (portrait): forcing %dpx bottom crop", _WATERMARK_MARGIN)
            max_y = max(0, h_orig - _WATERMARK_MARGIN)
    else:
        if (w_orig - max_x) < _EDGE_EPS:
            log.info("watermark safety (landscape): forcing %dpx right crop", _WATERMARK_MARGIN)
            max_x = max(0, w_orig - _WATERMARK_MARGIN)

    x, y = min_x, min_y
    w, h = max_x - min_x, max_y - min_y
    if w <= 0 or h <= 0:
        return 0, 0, w_orig, h_orig
    return x, y, w, h


def apply_crop(
    slice_dir: Path,
    box: tuple[int, int, int, int],
    quality: int = WEBP_QUALITY,
) -> tuple[int, int, int, int]:
    """Crop every frame in place to ``box`` ``[x, y, w, h]`` (re-encoded WebP).

    Clamps the box to frame bounds. Returns the box actually applied. Raises 500 on
    an OpenCV read/write failure, 422 if the box is degenerate after clamping.
    """
    frames = list_slice_frames(slice_dir)
    if not frames:
        raise ApiError(422, "zero frames", "slice has no frames to crop")

    h_orig, w_orig = _read(frames[0]).shape[:2]
    x, y, w, h = (int(v) for v in box)
    x = max(0, min(x, w_orig - 1))
    y = max(0, min(y, h_orig - 1))
    w = max(1, min(w, w_orig - x))
    h = max(1, min(h, h_orig - y))

    for frame_path in frames:
        img = _read(frame_path)
        cropped = img[y : y + h, x : x + w]
        if cropped.size == 0:
            raise ApiError(422, "crop out of bounds", "resulting crop is empty")
        _write_webp(frame_path, cropped, quality)

    log.info("crop: applied [%d,%d,%d,%d] to %d frame(s)", x, y, w, h, len(frames))
    return x, y, w, h


def validate_manual_box(box: object, frames: list[Path]) -> tuple[int, int, int, int]:
    """Validate a manual ``[x, y, w, h]`` against frame bounds. Raises 422 on failure."""
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        raise ApiError(422, "invalid box", "box must be [x, y, w, h] of 4 integers")
    try:
        x, y, w, h = (int(v) for v in box)
    except (TypeError, ValueError) as exc:
        raise ApiError(422, "invalid box", "box values must be integers") from exc
    if not frames:
        raise ApiError(422, "zero frames", "slice has no frames")
    fh, fw = _read(frames[0]).shape[:2]
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > fw or y + h > fh:
        raise ApiError(
            422,
            "box out of bounds",
            f"box [{x},{y},{w},{h}] must lie within {fw}x{fh}",
        )
    return x, y, w, h


def slice_resolution(slice_dir: Path) -> str:
    """Current ``WIDTHxHEIGHT`` of a slice's frames (from the first WebP)."""
    frames = list_slice_frames(slice_dir)
    if not frames:
        return "0x0"
    h, w = _read(frames[0]).shape[:2]
    return f"{w}x{h}"
