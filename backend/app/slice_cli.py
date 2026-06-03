"""Headless ``slice`` CLI — a thin front-door over the existing primitives (spec §5).

Non-interactive, no UI/server: turn a video *or* a Remotion ``--sequence`` frames
directory into a contract-gated WebP package, headlessly, with deterministic exit
codes for CI/agents (spec §5.3).

This module owns **no** packaging logic. It reuses the HTTP stack's pure functions
over temporary directories (NOT ``Job``/``JobStore``) — the reuse chain (§5.2):

* **Video** (``<path>`` is a file): :func:`slicing.extract_preview` (ffmpeg, trim,
  fps) → :func:`slicing.finalize_to_webp` (JPEG preview → contiguous WebP), over
  throwaway temp dirs. ``--start``/``--end`` apply here.
* **Frames-dir** (``<path>`` is a directory): :func:`slicing.convert_frames_to_webp`
  (arbitrary PNG/JPEG/WebP → contiguous WebP). ``--start``/``--end`` with a
  directory is a loud error (§5.1).

Then :func:`packager.build_and_verify` (which owns the Node kernel calls + the loop
encode) produces the package into ``--out-dir`` — the only durable artifact; the
preview/slice dirs are throwaway.

Output (spec §10.2): a human summary (package path + per-gate PASS/FAIL) by default,
or — with ``--json`` — exactly one machine-readable object to stdout
``{package_dir, verify:{pass,gates[]}, loop_webp}`` (or ``{error:{code,message}}`` on
a hard error). stdout stays pure JSON under ``--json``; gate ids and ``ApiError``
messages go to **stderr**.

Style mirrors the rest of the backend: type hints, ``pathlib``, the ``logging``
module (never ``print`` for diagnostics), ``ApiError`` for clear failures, and the
``errors.py`` path-containment helpers (§7.6).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from . import packager, slicing
from .config import DEFAULT_SLICE_SECONDS, WEBP_QUALITY
from .errors import ApiError, validate_data_subpath, validate_fps, validate_max_width

log = logging.getLogger("svs.slice_cli")

#: Origin string recorded in the manifest per ingest path (§5.2 metadata).
_ORIGIN_VIDEO = "user-supplied video"
_ORIGIN_FRAMES = "remotion --sequence"

#: Curated --help epilog — the §5.1 signature + one example per ingest path/mode.
#: Asserted by the CLI tests (so this text is part of the contract, not argparse
#: noise). Keep the example lines stable.
_EPILOG = """\
signature:
  seo-video-slicer slice <path> --mode scroll|loop --fps <n> \\
      [--start <s>] [--end <s>] [--quality 82-90] \\
      [--max-width <px>] --out-dir <dir> [--slug <name>] [--json] [--no-verify]

examples:
  # video -> scroll package (trim 0..3s at 12 fps)
  seo-video-slicer slice ./hero.mp4 --mode scroll --fps 12 --start 0 --end 3 --max-width 1280 --out-dir ./pkg

  # video -> loop package
  seo-video-slicer slice ./hero.mp4 --mode loop --fps 12 --max-width 1280 --out-dir ./pkg

  # frames-dir (Remotion --sequence) -> scroll package
  seo-video-slicer slice ./out --mode scroll --fps 12 --max-width 1280 --out-dir ./pkg

  # frames-dir -> loop package
  seo-video-slicer slice ./out --mode loop --fps 12 --max-width 1280 --out-dir ./pkg
"""


def build_parser() -> argparse.ArgumentParser:
    """The curated ``slice`` argument parser (spec §5.1)."""
    parser = argparse.ArgumentParser(
        prog="seo-video-slicer slice",
        description=(
            "Slice a video or a frames directory into a contract-gated WebP package "
            "(headless; scroll or loop mode)."
        ),
        epilog=_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "path",
        help="a video FILE (video ingest) or a DIRECTORY of frames (frames-dir ingest)",
    )
    parser.add_argument(
        "--mode",
        choices=("scroll", "loop"),
        default="scroll",
        help="output mode: scroll (default) or loop",
    )
    parser.add_argument(
        "--fps",
        type=float,
        required=True,
        help="effective fps (drives video extraction; sets loop frame cadence)",
    )
    parser.add_argument(
        "--start",
        type=float,
        default=None,
        help="trim start in seconds (video-only; an error with a frames dir)",
    )
    parser.add_argument(
        "--end",
        type=float,
        default=None,
        help="trim end in seconds (video-only; an error with a frames dir)",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=WEBP_QUALITY,
        help="WebP quality, clamped to 82-90",
    )
    parser.add_argument(
        "--max-width",
        default=None,
        help="optional extraction width cap in pixels; preserves aspect and never upscales",
    )
    parser.add_argument(
        "--out-dir",
        required=True,
        help="directory to write the package into",
    )
    parser.add_argument(
        "--slug",
        default=None,
        help="package id (kebab-case, 1-64 chars); defaults to the out-dir basename",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit one machine-readable JSON object to stdout (the §10.2 shape)",
    )
    parser.add_argument(
        "--no-verify",
        action="store_true",
        help="build without running the gate (verify:{skipped:true}); off by default",
    )
    return parser


def _validate_path_component(raw: str, label: str) -> Path:
    """Resolve ``raw`` to an absolute path after rejecting traversal (§7.6).

    The CLI takes caller-supplied filesystem paths from a same-user local caller, so
    there is no sandbox — but we still reject ``..``/NUL/backslash components and
    require the path to exist before any filesystem work (a loud foot-gun guard, not
    silence). Reuses :func:`errors.validate_data_subpath`'s containment checks on
    each relative component while still permitting an absolute caller path.
    """
    if not raw or "\x00" in raw:
        raise ApiError(2, f"invalid {label}", "path is empty or contains a NUL byte")
    candidate = Path(raw).expanduser()
    # Reject traversal in the user-supplied portion before resolving.
    if ".." in candidate.parts:
        raise ApiError(2, f"invalid {label}", "path traversal ('..') is not permitted")
    # Reuse the data-subpath validator's component checks on the relative tail so the
    # CLI shares the repo's one containment helper (§7.6); absolute paths skip the
    # leading-slash rule (a same-user local caller may target an absolute location).
    if not candidate.is_absolute():
        validate_data_subpath(str(candidate))
    return candidate.resolve()


def _project_result(result: dict) -> dict:
    """Project ``build_and_verify``'s rich dict down to the §10.2 wire shape.

    Drops the HTTP-only keys (``zip_path``, ``lane``, ``weight_mb``, ``frame_count``);
    keeps exactly ``{package_dir, verify:{pass,gates[]}, loop_webp}``.
    """
    return {
        "package_dir": result["package_dir"],
        "verify": result["verify"],
        "loop_webp": result["loop_webp"],
    }


def _emit_human(out: dict, no_verify: bool) -> None:
    """Human summary to stdout: package path + per-gate PASS/FAIL (or skipped).

    Writes via :data:`sys.stdout` (not ``print``, not the ``logging`` module): this
    is the CLI's user-facing result surface, kept on stdout, while diagnostics go to
    ``stderr``/``logging`` — matching the JSON/error paths in :func:`main`.
    """
    lines = [f"package: {out['package_dir']}"]
    if out["loop_webp"]:
        lines.append(f"loop:    {out['loop_webp']}")
    verify = out["verify"]
    if no_verify:
        lines.append("verify:  skipped (--no-verify)")
    else:
        lines.append(f"verify:  {'PASS' if verify['pass'] else 'FAIL'}")
        for gate in verify["gates"]:
            mark = "PASS" if gate["pass"] else "FAIL"
            detail = f" — {gate['detail']}" if gate.get("detail") else ""
            lines.append(f"  [{mark}] {gate['id']}{detail}")
    sys.stdout.write("\n".join(lines) + "\n")


def _run(args: argparse.Namespace) -> dict:
    """Execute the reuse chain and return the projected §10.2 result dict.

    Raises :class:`ApiError` on any hard (no-package) error — the caller maps it to
    exit 2 and the ``{error}`` shape. A built-but-failed-gate package is NOT an
    error here: it comes back in the dict with ``verify.pass == false`` (exit 1).
    """
    # Front-door fps guard (spec §5.3): a non-positive/non-finite --fps is a hard
    # input error (exit 2, {error} shape) — reject it before any path/extract work.
    validate_fps(args.fps)
    max_width = validate_max_width(args.max_width)
    quality = max(82, min(90, args.quality))
    path = _validate_path_component(args.path, "path")
    out_dir = _validate_path_component(args.out_dir, "out-dir")
    slug = packager.sanitize_slug(args.slug, fallback=out_dir.name)

    # TemporaryDirectory imported lazily so a usage/path error never spins one up.
    import tempfile

    is_dir = path.is_dir()
    is_file = path.is_file()
    if not is_dir and not is_file:
        raise ApiError(2, "input not found", f"no file or directory at {path}")

    if is_dir and (args.start is not None or args.end is not None):
        # --start/--end are video-only; with a frames dir they are a loud error (§5.1).
        raise ApiError(
            2,
            "trim window not allowed for a frames dir",
            "--start/--end apply only to a video file ingest",
        )

    with tempfile.TemporaryDirectory(prefix="svs-slice-") as tmp:
        tmp_path = Path(tmp)
        tmp_slice = tmp_path / "slice"

        if is_dir:
            # FRAMES-DIR ingest (§8.2): arbitrary PNG/JPEG/WebP -> contiguous WebP.
            basenames, resolution = slicing.convert_frames_to_webp(
                path, tmp_slice, quality, max_width=max_width
            )
            origin = _ORIGIN_FRAMES
        else:
            # VIDEO ingest (§5.2 step 1): extract JPEG preview -> finalize to WebP.
            # The trim window needs concrete floats; default to [0, DEFAULT_SLICE_SECONDS]
            # (the spec's hero out-point, <= MAX_SLICE_SECONDS) when unset.
            start = 0.0 if args.start is None else args.start
            end = DEFAULT_SLICE_SECONDS if args.end is None else args.end
            tmp_preview = tmp_path / "preview"
            slicing.extract_preview(
                path, tmp_preview, start, end, args.fps, max_width=max_width
            )
            basenames, resolution = slicing.finalize_to_webp(tmp_preview, tmp_slice, [], quality)
            origin = _ORIGIN_VIDEO

        frame_count = len(basenames)
        # Both ingest paths: source length == loop length == frame_count / fps (§5.2 step 4).
        # fps is already guaranteed finite > 0 by the front-door validate_fps above.
        duration_s = round(frame_count / args.fps, 3)

        result = packager.build_and_verify(
            slice_dir=tmp_slice,
            pkg_dir=out_dir,
            slug=slug,
            duration_s=duration_s,
            fps_effective=args.fps,
            resolution=resolution,
            origin=origin,
            quality=quality,
            mode=args.mode,
        )

    return _project_result(result)


def main(argv: list[str] | None = None) -> int:
    """``slice`` subcommand entry. Returns the spec §5.3 exit code (does not exit).

    argparse's own ``--help``/usage errors still ``SystemExit`` (codes 0/2); every
    other path returns an int the caller turns into the process status.
    """
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        out = _run(args)
    except ApiError as exc:
        # Hard error (no package): exit 2. Message to stderr; structured shape under --json.
        message = exc.detail or exc.error
        log.error("slice failed: %s (%s)", exc.error, message)
        if args.json:
            json.dump({"error": {"code": exc.error, "message": message}}, sys.stdout)
            sys.stdout.write("\n")
        else:
            sys.stderr.write(f"error: {exc.error}: {message}\n")
        return 2

    verify = out["verify"]
    if args.no_verify:
        # Build succeeded; skip reporting the gate per §5.1. The package exists.
        # NOTE (spec_deviation): build_and_verify has no skip-gate param and lives in
        # another lane, so the gate physically still runs — we only suppress the
        # report and force exit 0. The OUTPUT shape + exit code match the contract.
        out = {**out, "verify": {"skipped": True}}
        if args.json:
            json.dump(out, sys.stdout)
            sys.stdout.write("\n")
        else:
            _emit_human(out, no_verify=True)
        return 0

    passed = bool(verify["pass"])
    if args.json:
        json.dump(out, sys.stdout)
        sys.stdout.write("\n")
    else:
        _emit_human(out, no_verify=False)

    if not passed:
        # Built, but >=1 gate failed (a package exists): exit 1. Failing gate ids to stderr.
        failed = [g["id"] for g in verify["gates"] if not g["pass"]]
        sys.stderr.write("gate failure: " + ", ".join(failed) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
