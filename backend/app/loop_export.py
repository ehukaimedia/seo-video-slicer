"""Loop ``loop.webp`` export primitive (remotion-companion-spec §6.7).

Bakes a single **animated** WebP from a contiguous ``frame_NNN.webp`` sequence —
the zero-JS ``<img>`` tier of a loop package (§6.8). The Node kernel stays
zero-dependency and never encodes; this module owns the *bytes*, the kernel owns
copying them in + the ``webp_sha256`` + the ``loop`` manifest block (§6.4a).

Two encoders, selectable per the §6.9 spike (Phase-0 exit criterion):

* ``"pillow"`` (default) — ``Image.save(save_all=True, append_images=[...])``.
* ``"ffmpeg"`` — ``ffmpeg -c:v libwebp_anim`` (already a system prerequisite).

The G8 gate binds ``fps`` to the baked bytes by asserting the SUM of all ANMF
frame durations equals ``frames.count * perFrameMs(fps)`` ms, so this primitive
writes that exact per-frame duration on every input frame. libwebp encoders
*coalesce* byte-identical CONSECUTIVE frames into a single ANMF whose duration is
the SUM of the merged per-frame durations (no flag disables this), so the baked
file may carry FEWER ANMF chunks than input frames — but the duration sum is
invariant. G8 is therefore sum-based, not per-frame-equality based (§6.9).

The per-frame duration uses the FROZEN cross-language formula
``perFrameMs(fps) = floor(1000 / fps + 0.5)`` (half-up, deterministic) — IDENTICAL
to ``verify.mjs`` G8 (CONTRACT-loop.md §2.1). Python's builtin ``round`` is
banker's rounding (half-to-even) and JS ``Math.round`` is half-up; at fps=16
(``1000/16 == 62.5``) they diverge (62 vs 63), so neither may be used.

Style mirrors :mod:`slicing` (the Pillow finalize pattern, ``logging`` not
``print``, ``pathlib``, ``ApiError`` for clear failures, ffmpeg via ``subprocess``
with ``check=False`` + captured stderr).
"""

from __future__ import annotations

import logging
import math
import shutil
import subprocess
from pathlib import Path

from PIL import Image

from .config import WEBP_QUALITY
from .errors import ApiError

log = logging.getLogger("svs.loop_export")


def _frame_duration_ms(fps: float) -> int:
    """Per-frame duration in ms — the FROZEN G8 formula ``floor(1000/fps + 0.5)``.

    Half-up, deterministic, and IDENTICAL to ``verify.mjs`` G8's
    ``Math.floor(1000 / fps + 0.5)`` (CONTRACT-loop.md §2.1). The builtin
    ``round`` is banker's rounding (half-to-even); at fps=16 it returns 62 while
    JS returns 63, which false-fails G8. This formula returns 63 in both.
    """
    if fps <= 0:
        raise ApiError(422, "invalid fps", f"fps must be > 0 (got {fps})")
    return math.floor(1000.0 / fps + 0.5)


def _list_frames(frames_dir: Path) -> list[Path]:
    """Sorted ``frame_*.webp`` paths; raise 422 on a missing/empty dir.

    3-digit zero-padded names make lexicographic sort == numeric order, matching
    the contiguous sequence ``finalize_to_webp`` / ``convert_frames_to_webp`` write.
    """
    if not frames_dir.is_dir():
        raise ApiError(422, "frames dir not found", f"no directory at {frames_dir}")
    frames = sorted(frames_dir.glob("frame_*.webp"))
    if not frames:
        raise ApiError(422, "zero frames", f"no frame_*.webp in {frames_dir}")
    return frames


def export_loop_webp(
    frames_dir: Path,
    out_path: Path,
    fps: float,
    quality: int = WEBP_QUALITY,
    encoder: str = "pillow",
) -> Path:
    """Bake one animated ``loop.webp`` from the contiguous frame sequence.

    Reads every ``frame_NNN.webp`` in ``frames_dir`` (sorted), writes an infinite
    loop (``loop=0``) at ``floor(1000 / fps + 0.5)`` ms per frame to ``out_path``,
    and returns ``out_path``. Byte-identical consecutive frames may be coalesced
    by the encoder into one ANMF (summed duration); G8 verifies the duration SUM.
    ``encoder`` selects the §6.9 primitive (``"pillow"`` |
    ``"ffmpeg"``). Raises a clear :class:`ApiError` on missing/empty frames, an
    unknown encoder, or an encode failure.
    """
    duration_ms = _frame_duration_ms(fps)
    frames = _list_frames(frames_dir)
    # A 1-frame "loop" cannot be a valid animated WebP: the §6.9 encoder spike
    # showed an animated WebP needs >=2 ANMF-eligible frames (a single frame
    # bakes a still image, not an ANIM container, and G8 has no animation to bind).
    if len(frames) < 2:
        raise ApiError(
            422,
            "too few frames for a loop",
            f"a loop needs >=2 frames (got {len(frames)} in {frames_dir})",
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if encoder == "pillow":
        _export_pillow(frames, out_path, duration_ms, quality)
    elif encoder == "ffmpeg":
        _export_ffmpeg(frames_dir, out_path, fps, quality)
    else:
        raise ApiError(
            422,
            "unknown encoder",
            f"encoder must be 'pillow' or 'ffmpeg' (got {encoder!r})",
        )

    if not out_path.is_file() or out_path.stat().st_size == 0:
        raise ApiError(500, "loop.webp not produced", f"empty/missing {out_path.name}")

    log.info(
        "loop_export: baked %s from %d frame(s) via %s at %dms/frame (fps=%s, q%d)",
        out_path.name,
        len(frames),
        encoder,
        duration_ms,
        fps,
        quality,
    )
    return out_path


def _export_pillow(
    frames: list[Path], out_path: Path, duration_ms: int, quality: int
) -> None:
    """Pillow ``save_all`` baker. Keeps every frame **open** until ``save`` returns.

    ``save_all`` reads the appended images at save time, so the per-frame handles
    must stay open (a ``with``-block-per-frame would close them first and corrupt
    or truncate the animation).
    """
    images: list[Image.Image] = []
    try:
        for frame_path in frames:
            try:
                images.append(Image.open(frame_path))
            except (OSError, ValueError) as exc:
                log.error("loop_export: could not open %s: %s", frame_path.name, exc)
                raise ApiError(
                    500, "frame read failure", f"{frame_path.name}: {exc}"
                ) from exc

        first, rest = images[0], images[1:]
        try:
            first.save(
                out_path,
                format="WEBP",
                save_all=True,
                append_images=rest,
                duration=duration_ms,
                loop=0,
                quality=quality,
                method=6,
            )
        except (OSError, ValueError) as exc:
            log.error("loop_export: Pillow save failed: %s", exc)
            raise ApiError(500, "loop.webp encode failure", str(exc)) from exc
    finally:
        for img in images:
            img.close()


def _export_ffmpeg(
    frames_dir: Path, out_path: Path, fps: float, quality: int
) -> None:
    """ffmpeg ``libwebp_anim`` baker — the §6.9 fallback (mirrors ``extract_preview``)."""
    if shutil.which("ffmpeg") is None:
        raise ApiError(500, "ffmpeg not found", "install ffmpeg")

    cmd = [
        "ffmpeg",
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(frames_dir / "frame_%03d.webp"),
        "-loop",
        "0",
        "-c:v",
        "libwebp_anim",
        "-q:v",
        str(quality),
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=300)
    if proc.returncode != 0:
        log.error("loop_export: ffmpeg failed: %s", (proc.stderr or "")[-500:])
        raise ApiError(500, "loop.webp encode failure", (proc.stderr or "").strip()[:400])
