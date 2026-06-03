"""Error model + id/path validation (API.md §0, §9).

Every non-2xx response in this API is the single envelope ``{"error", "detail"?}``.
This module centralizes:

  * :class:`ApiError` — the one exception type handlers raise (carries status +
    message + optional detail); the app installs handlers that render it (and
    FastAPI's own validation/HTTP errors) into the frozen envelope.
  * id / ``/data`` sub-path validators that distinguish a **malformed** id (400)
    from a merely **unknown** one (404), and reject path traversal before any
    filesystem access.
"""

from __future__ import annotations

import math
import re

from .config import ID_PATTERN

_ID_RE = re.compile(ID_PATTERN)


class ApiError(Exception):
    """An HTTP error that renders to the ``{"error", "detail"?}`` envelope.

    Raise this anywhere in a handler/module; ``main`` installs an exception
    handler that turns it into the correct status code + envelope body.
    """

    def __init__(self, status_code: int, error: str, detail: str | None = None) -> None:
        super().__init__(error)
        self.status_code = status_code
        self.error = error
        self.detail = detail

    def body(self) -> dict[str, str]:
        out: dict[str, str] = {"error": self.error}
        if self.detail:
            out["detail"] = self.detail
        return out


# ---------------------------------------------------------------------------
# id / path validation.
# ---------------------------------------------------------------------------
def is_valid_id(value: str) -> bool:
    """True iff ``value`` is a well-formed opaque id (``^[A-Za-z0-9_-]{1,64}$``)."""
    return bool(value) and _ID_RE.match(value) is not None


def validate_id(value: str, label: str) -> str:
    """Return ``value`` if it is a well-formed id, else raise a **400** ApiError.

    A malformed id (traversal, slash, backslash, null byte, too long, empty) is a
    *client* error distinct from an unknown-but-well-formed id (which is 404 and
    only discovered after a filesystem lookup).
    """
    if not is_valid_id(value):
        raise ApiError(400, f"invalid {label}", f"{label} must match {ID_PATTERN}")
    return value


def validate_fps(fps: float | None) -> float:
    """Return ``fps`` if it is a finite number > 0, else raise a **422** ApiError.

    The shared front-door guard for ``--fps`` / ``fps=`` across every public entry
    (CLI, both MCP tools) and the central :func:`packager.build_and_verify` choke
    point. A non-positive or non-finite fps (``0``, negative, ``NaN``, ``inf``,
    ``None``) is a degenerate input that would otherwise bake a ``duration_s=0`` /
    ``fps_effective=0`` package the gates do not catch — reject it BEFORE any
    extraction/encode/build.

    Order is load-bearing: ``None`` is tested first (``math.isfinite(None)`` raises
    ``TypeError``), and ``isfinite`` before ``<= 0`` (``nan <= 0`` is ``False``, so a
    bare ``<= 0`` check would let ``NaN`` slip through).
    """
    if fps is None or not math.isfinite(fps) or fps <= 0:
        raise ApiError(422, "fps must be a positive number", f"got {fps!r}")
    return fps


def validate_data_subpath(subpath: str) -> str:
    """Reject a ``/data/…`` sub-path containing traversal before fs access (400).

    Guards against ``..`` segments, leading ``/``, backslashes, and null bytes
    (API.md §0 / §8.3). Returns the sub-path unchanged when safe.
    """
    if (
        not subpath
        or subpath.startswith("/")
        or "\\" in subpath
        or "\x00" in subpath
        or ".." in subpath.split("/")
    ):
        raise ApiError(400, "invalid path", "path traversal is not permitted")
    return subpath
