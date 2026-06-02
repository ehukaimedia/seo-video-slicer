"""Two-tier premium erase (spec §6, API.md §7.2).

Tiers:

  * **baseline** — ALWAYS available. ``cv2.inpaint`` with ``INPAINT_NS`` (Navier-
    Stokes, structure-aware — NOT the banned TELEA), an edge-**feathered** mask, and
    a **multi-frame temporal-consistency** pass that blends each frame's inpaint
    toward the temporally-smoothed region so the erase doesn't shimmer.
  * **premium** — only if ``iopaint`` (LaMa / ``simple_lama_inpainting``) imports
    successfully. Neural inpaint; structure-aware fill with the same feather +
    temporal pass.

Selection: ``tier="auto"`` picks premium if importable else baseline; ``tier="premium"``
**falls back to baseline** (never errors) when IOPaint is unavailable. The function
returns the tier actually used. The backend NEVER auto-pip-installs torch — premium
is opt-in via ``requirements-premium.txt``.
"""

from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np

from .config import WEBP_QUALITY
from .errors import ApiError
from .slicing import _read, _write_webp, list_slice_frames

log = logging.getLogger("svs.erase")

#: Inpaint radius (px) for the baseline OpenCV pass.
_INPAINT_RADIUS = 5

#: Feather width (px) over which the mask softens at its edges.
_FEATHER = 9

#: Temporal-blend weight: how strongly each frame's fill is pulled toward the
#: temporally-smoothed (median) region to suppress frame-to-frame shimmer.
_TEMPORAL_BLEND = 0.5


# ---------------------------------------------------------------------------
# Premium availability — a pure import probe, no install, no model download here.
# ---------------------------------------------------------------------------
def premium_available() -> bool:
    """True iff a LaMa neural inpaint backend is importable. Never installs anything."""
    try:  # IOPaint's modern entry point.
        import iopaint  # noqa: F401

        return True
    except Exception:  # pragma: no cover - environment-dependent
        pass
    try:  # The lighter standalone LaMa wrapper.
        import simple_lama_inpainting  # noqa: F401

        return True
    except Exception:  # pragma: no cover
        return False


def resolve_tier(requested: str) -> str:
    """Map a requested tier to the tier that will actually run.

    ``auto`` → premium if available else baseline. ``premium`` → premium if
    available else baseline (graceful fallback, never an error — API.md §7.2).
    ``baseline`` → baseline. An unknown tier value is the caller's 422 to raise.
    """
    if requested not in ("auto", "baseline", "premium"):
        raise ApiError(422, "invalid tier", f"tier must be auto|baseline|premium, got {requested!r}")
    if requested == "baseline":
        return "baseline"
    return "premium" if premium_available() else "baseline"


# ---------------------------------------------------------------------------
# Mask construction — a feathered (soft-edged) rectangular mask.
# ---------------------------------------------------------------------------
def _clamp_box(box: tuple[int, int, int, int], w: int, h: int) -> tuple[int, int, int, int]:
    x, y, bw, bh = (int(v) for v in box)
    x = max(0, min(x, w - 1))
    y = max(0, min(y, h - 1))
    bw = max(1, min(bw, w - x))
    bh = max(1, min(bh, h - y))
    return x, y, bw, bh


def _hard_mask(shape: tuple[int, int], box: tuple[int, int, int, int]) -> np.ndarray:
    x, y, bw, bh = box
    mask = np.zeros(shape, dtype=np.uint8)
    mask[y : y + bh, x : x + bw] = 255
    return mask


def _feathered_alpha(mask: np.ndarray) -> np.ndarray:
    """Float [0,1] alpha with softened edges (Gaussian blur of the hard mask)."""
    k = _FEATHER | 1  # ensure odd kernel size
    blurred = cv2.GaussianBlur(mask, (k, k), 0)
    return (blurred.astype(np.float32) / 255.0)[..., None]


# ---------------------------------------------------------------------------
# Per-frame inpaint primitives.
# ---------------------------------------------------------------------------
def _baseline_fill(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """OpenCV Navier-Stokes inpaint (structure-aware; NOT TELEA)."""
    return cv2.inpaint(img, mask, _INPAINT_RADIUS, cv2.INPAINT_NS)


def _premium_fill_factory():
    """Return a ``fill(img, mask)->img`` neural inpainter, or ``None`` if unavailable.

    Tries ``simple_lama_inpainting`` first (lighter API) then IOPaint's model
    manager. Any import/runtime failure returns ``None`` so the caller falls back to
    baseline rather than erroring.
    """
    try:
        from simple_lama_inpainting import SimpleLama  # type: ignore

        lama = SimpleLama()

        def fill(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
            from PIL import Image

            rgb = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            m = Image.fromarray(mask).convert("L")
            out = lama(rgb, m)
            return cv2.cvtColor(np.array(out), cv2.COLOR_RGB2BGR)

        log.info("premium erase: using simple_lama_inpainting")
        return fill
    except Exception:  # pragma: no cover - environment-dependent
        pass

    try:
        from iopaint.model_manager import ModelManager  # type: ignore
        from iopaint.schema import HDStrategy, InpaintRequest  # type: ignore

        model = ModelManager(name="lama", device="cpu")

        def fill(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
            req = InpaintRequest(hd_strategy=HDStrategy.ORIGINAL)
            out = model(img, mask, req)
            return out if out.dtype == np.uint8 else out.astype(np.uint8)

        log.info("premium erase: using iopaint ModelManager(lama)")
        return fill
    except Exception:  # pragma: no cover
        log.warning("premium erase requested but no LaMa backend usable; using baseline")
        return None


# ---------------------------------------------------------------------------
# The two-tier erase with temporal consistency.
# ---------------------------------------------------------------------------
def erase_region(
    slice_dir: Path,
    box: tuple[int, int, int, int],
    tier: str,
    quality: int = WEBP_QUALITY,
) -> tuple[str, int]:
    """Inpaint ``box`` across all slice frames in place. Returns ``(tier_used, n_frames)``.

    Pipeline per tier:
      1. build a hard rectangular mask + a feathered alpha;
      2. fill the region with the tier's inpainter (NS baseline / LaMa premium);
      3. **temporal pass:** compute the per-pixel median of the filled region across
         all frames and blend each frame toward it (weighted by ``_TEMPORAL_BLEND``),
         suppressing shimmer; composite via the feathered alpha so edges are seamless.

    Raises 422 if the slice has no frames, 500 on an inpaint failure.
    """
    frames = list_slice_frames(slice_dir)
    if not frames:
        raise ApiError(422, "zero frames", "slice has no frames to erase")

    tier_used = resolve_tier(tier)
    fill = _premium_fill_factory() if tier_used == "premium" else None
    if tier_used == "premium" and fill is None:
        tier_used = "baseline"
    if fill is None:
        fill = _baseline_fill

    h, w = _read(frames[0]).shape[:2]
    cbox = _clamp_box(box, w, h)
    x, y, bw, bh = cbox
    mask = _hard_mask((h, w), cbox)
    alpha = _feathered_alpha(mask)  # (h, w, 1) float [0,1]

    # Pass 1: inpaint every frame, collect the filled region crops for the median.
    filled: list[np.ndarray] = []
    region_stack: list[np.ndarray] = []
    try:
        for frame_path in frames:
            img = _read(frame_path)
            out = fill(img, mask)
            filled.append(out)
            region_stack.append(out[y : y + bh, x : x + bw].astype(np.float32))
    except Exception as exc:  # pragma: no cover - tier-dependent
        log.error("erase fill failed (%s): %s", tier_used, exc)
        raise ApiError(500, "inpaint failure", str(exc)) from exc

    # Pass 2 (temporal consistency): per-pixel median across frames inside the box,
    # then blend each frame's region toward it; composite back via feathered alpha.
    median_region = np.median(np.stack(region_stack, axis=0), axis=0)
    region_alpha = alpha[y : y + bh, x : x + bw]
    for frame_path, out in zip(frames, filled):
        region = out[y : y + bh, x : x + bw].astype(np.float32)
        smoothed = (1.0 - _TEMPORAL_BLEND) * region + _TEMPORAL_BLEND * median_region
        # Composite the smoothed fill over the original fill using the soft edge so
        # only the masked interior is replaced and the boundary feathers cleanly.
        blended = region * (1.0 - region_alpha) + smoothed * region_alpha
        out[y : y + bh, x : x + bw] = np.clip(blended, 0, 255).astype(np.uint8)
        _write_webp(frame_path, out, quality)

    log.info("erase: tier=%s box=[%d,%d,%d,%d] frames=%d", tier_used, x, y, bw, bh, len(frames))
    return tier_used, len(frames)
