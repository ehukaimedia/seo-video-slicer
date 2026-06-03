"""Package orchestration over the frozen Node kernels (API.md §7.3, §11).

This module owns **no** packaging logic. It:

  1. shells ``node build_package.mjs --frames <slice dir> --out <pkg dir> --id …``
     to produce a complete, contract-valid package (frames/, index.html,
     manifest.json, README.md, PROMPT.md);
  2. copies ``verify.mjs`` into the package dir (the kernel does not emit it) so the
     shipped package is self-verifying;
  3. shells ``node verify.mjs`` in the package dir, parses its per-gate stdout
     (§11.2) into ``gates[]`` and maps ``pass ← (exit code == 0)``;
  4. computes the whole-package ``weight_mb`` and the ``lane``; zips the package
     **only when the gate passes** ("refuse to declare success").

It re-derives nothing the kernel owns (fingerprint, manifest, player markers).
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

from . import budget, loop_export
from .config import BUILD_PACKAGE_MJS, FRAME_COUNT_HARD_MAX, VERIFY_MJS, WEBP_QUALITY
from .errors import ApiError, validate_fps

log = logging.getLogger("svs.packager")

#: A verify.mjs gate header line, e.g. ``[PASS] G1  Asset closure …`` (§11.2).
_GATE_HEADER_RE = re.compile(r"^\[(PASS|FAIL)\]\s+(G\d+)\s+(.*)$")

#: Detail lines under a gate header are indented with 8 spaces; ``note``/``WARN``
#: lines use a 3-space prefix and are excluded from ``detail`` (per §7.3 examples).
_DETAIL_PREFIX = "        "  # 8 spaces


def sanitize_slug(raw: str | None, fallback: str) -> str:
    """Sanitize a slug to ``^[a-z0-9-]{1,64}$`` (kebab); fall back to a derived slug."""
    base = (raw or fallback or "package").strip().lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    base = base[:64].strip("-")
    return base or "package"


def _node_available() -> bool:
    from shutil import which

    return which("node") is not None


def build_and_verify(
    slice_dir: Path,
    pkg_dir: Path,
    slug: str,
    duration_s: float,
    fps_effective: float,
    resolution: str,
    origin: str,
    quality: int = WEBP_QUALITY,
    mode: str = "scroll",
) -> dict:
    """Build the package, gate it, and assemble the §7.3 result dict.

    ``mode`` selects the package family (spec §6.4a / §6.4b):

    * ``"scroll"`` (default): byte-for-byte unchanged from today — the existing
      ``build_package.mjs`` invocation with no loop args.
    * ``"loop"``: FIRST fail-fast if the slice has more than
      :data:`config.FRAME_COUNT_HARD_MAX` frames (the same hard cap G7 enforces,
      raised here BEFORE the expensive encode); then bake ``loop.webp`` via
      :func:`loop_export.export_loop_webp` into a tmpfile and hand it to the Node
      builder with ``--mode loop --loop-webp <tmpfile>`` so the kernel copies it
      in, hashes it (``webp_sha256``), and writes the ``loop`` manifest block.

    Design note (spec_deviation): ``build_and_verify`` owns the ``loop_export``
    call internally — callers just pass ``mode="loop"`` — superseding §6.4a's
    ``loop_webp_path`` param idea. The Node loop-builder still owns the hash + the
    ``loop`` block; this module owns only the bytes + the tmpfile lifecycle.

    Returns a dict with ``package_id`` left to the caller; here we return
    ``verify`` (``{pass, gates}``), ``frame_count``, ``weight_mb``, ``lane``,
    ``zip_path`` (a Path when the gate passed, else ``None``), ``package_dir``
    (``str(pkg_dir)``), and ``loop_webp`` (the package-relative ``"loop.webp"``
    for loop mode, else ``None``). Raises 500 if the kernel crashes for a non-gate
    reason (missing template, node not found, etc.); raises 422 for a loop slice
    over the hard frame cap.
    """
    if mode not in ("scroll", "loop"):
        raise ApiError(422, "invalid mode", f"mode must be 'scroll' or 'loop' (got {mode!r})")
    # Central backstop (spec §6.4a): reject a non-positive/non-finite fps that would
    # otherwise bake a duration_s=0 / fps_effective=0 package the gates do not catch.
    # Runs BEFORE any extraction/encode/build so CLI and MCP both pass through it.
    validate_fps(fps_effective)
    if not _node_available():
        raise ApiError(500, "node not found", "Node.js is required to build the package")
    if not BUILD_PACKAGE_MJS.exists():
        raise ApiError(500, "packager kernel missing", str(BUILD_PACKAGE_MJS))
    if not VERIFY_MJS.exists():
        raise ApiError(500, "verify kernel missing", str(VERIFY_MJS))

    pkg_dir.mkdir(parents=True, exist_ok=True)

    # (a0) LOOP FAIL-FAST — before any expensive encode/build (spec §6.8). The
    # >200 hard cap mirrors verify.mjs G7; raise it here so a doomed loop never
    # pays for an encode.
    if mode == "loop":
        slice_frames = sorted(slice_dir.glob("frame_*.webp"))
        if len(slice_frames) > FRAME_COUNT_HARD_MAX:
            raise ApiError(
                422,
                "frame count over budget",
                f"{len(slice_frames)} frames exceeds the hard cap "
                f"of {FRAME_COUNT_HARD_MAX} (G7)",
            )

    # The loop tmpfile lives OUTSIDE pkg_dir so a failed build never strands a
    # stray loop.webp in the package tree. Allocate it up front so a single
    # try/finally spans BOTH the encode and the build — if export_loop_webp
    # raises (e.g. a <2-frame loop), the just-created tmpfile is still cleaned up.
    loop_tmp: Path | None = None
    if mode == "loop":
        fd, tmp_name = tempfile.mkstemp(suffix=".webp", prefix="svs-loop-")
        os.close(fd)
        loop_tmp = Path(tmp_name)

    try:
        if mode == "loop":
            # (a0b) BAKE loop.webp into the tmpfile (loop_export owns the bytes).
            loop_export.export_loop_webp(slice_dir, loop_tmp, fps_effective, quality)

        # (a) BUILD — reuse build_package.mjs verbatim; do not reimplement.
        build_cmd = [
            "node",
            str(BUILD_PACKAGE_MJS),
            "--frames",
            str(slice_dir),
            "--out",
            str(pkg_dir),
            "--id",
            slug,
            "--duration",
            str(duration_s),
            "--fps",
            str(fps_effective),
            "--resolution",
            resolution,
            "--quality",
            str(quality),
            "--origin",
            origin,
        ]
        if mode == "loop":
            # Scroll appends NO extra args (byte-identical output); only loop does.
            build_cmd += ["--mode", "loop", "--loop-webp", str(loop_tmp)]
        build = subprocess.run(
            build_cmd, capture_output=True, text=True, check=False, timeout=300
        )
    finally:
        # The kernel has copied loop.webp into the package by now (or the encode
        # raised); the tmpfile is no longer needed regardless of the outcome.
        if loop_tmp is not None and loop_tmp.exists():
            loop_tmp.unlink()
    if build.returncode != 0:
        log.error("build_package.mjs failed: %s", (build.stderr or "")[-500:])
        raise ApiError(
            500,
            "build_package.mjs crashed",
            (build.stderr or build.stdout or "").strip()[:400],
        )
    log.info("build_package.mjs ok: %s", (build.stdout or "").strip().splitlines()[-1:])

    # (b) MAKE CONTRACT-COMPLETE — copy the frozen gate in (kernel doesn't emit it).
    (pkg_dir / "verify.mjs").write_bytes(VERIFY_MJS.read_bytes())

    # (c) GATE — reuse verify.mjs; exit code -> pass, stdout -> gates[].
    verify = subprocess.run(
        ["node", "verify.mjs"],
        cwd=str(pkg_dir),
        capture_output=True,
        text=True,
        check=False,
        timeout=300,
    )
    gates = parse_verify_output(verify.stdout)
    passed = verify.returncode == 0
    if not gates:
        # No parseable gates at all means verify itself crashed — that's a 500.
        raise ApiError(
            500,
            "verify.mjs crashed",
            (verify.stderr or verify.stdout or "").strip()[:400],
        )

    frame_count = len(list((pkg_dir / "frames").glob("frame_*.webp")))
    weight_mb = package_weight_mb(pkg_dir)
    lane = budget.lane_for_count(frame_count)

    zip_path: Path | None = None
    if passed:
        zip_path = zip_package(pkg_dir, slug)
        log.info("package gate PASSED: %d frames, %.2f MB, lane=%s", frame_count, weight_mb, lane)
    else:
        failed = [g["id"] for g in gates if not g["pass"]]
        log.warning("package gate FAILED (%s): refusing download", ", ".join(failed))

    return {
        "verify": {"pass": passed, "gates": gates},
        "frame_count": frame_count,
        "weight_mb": weight_mb,
        "lane": lane,
        "zip_path": zip_path,
        "package_dir": str(pkg_dir),
        "loop_webp": "loop.webp" if mode == "loop" else None,
    }


def parse_verify_output(stdout: str) -> list[dict]:
    """Parse verify.mjs line-oriented stdout into ordered ``[{id, pass, detail}]`` (§11.2).

    For each ``[PASS|FAIL] G{n}  {title}`` header, accumulate the following
    8-space-indented detail line(s) (excluding ``note``/``WARN`` lines) joined with
    ``"; "``. Gate order G1…G7 is preserved as emitted.
    """
    gates: list[dict] = []
    current: dict | None = None
    detail_lines: list[str] = []

    def flush() -> None:
        nonlocal current, detail_lines
        if current is not None:
            current["detail"] = "; ".join(detail_lines).strip()
            gates.append(current)
        current = None
        detail_lines = []

    for line in stdout.splitlines():
        header = _GATE_HEADER_RE.match(line)
        if header:
            flush()
            token, gate_id, _title = header.groups()
            current = {"id": gate_id, "pass": token == "PASS", "detail": ""}
        elif current is not None and line.startswith(_DETAIL_PREFIX):
            stripped = line[len(_DETAIL_PREFIX) :].strip()
            if stripped:
                detail_lines.append(stripped)
        # Lines that are not headers and not 8-space details (e.g. " note ", " WARN ",
        # separators, RESULT:) are intentionally ignored.
    flush()
    return gates


def package_weight_mb(pkg_dir: Path) -> float:
    """Whole-package weight in MB (2-dp): every file under ``pkg_dir`` EXCEPT the zip.

    Distinct from G7's "total" (which counts frame bytes only). Excludes any built
    ``*-animation.zip`` so re-measuring after a prior build doesn't double-count.
    """
    total = 0
    for path in pkg_dir.rglob("*"):
        if path.is_file() and not path.name.endswith("-animation.zip"):
            total += path.stat().st_size
    return round(total / 1024 / 1024, 2)


def zip_package(pkg_dir: Path, slug: str) -> Path:
    """Zip the whole package dir to ``{slug}-animation.zip`` inside it. Returns the path."""
    zip_path = pkg_dir / f"{slug}-animation.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(pkg_dir.rglob("*")):
            if path.is_file() and path != zip_path:
                zf.write(path, arcname=str(path.relative_to(pkg_dir)))
    return zip_path
