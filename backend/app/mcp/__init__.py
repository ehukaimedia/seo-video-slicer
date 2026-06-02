"""MCP server package — agent-invokable front-door over the slicer (spec §7).

Two stdio tools, ``slice_video`` and ``slice_frames``, reuse the SAME pipeline as
the HTTP stack / CLI by importing :mod:`app.slicing` and :mod:`app.packager`
directly (no re-shelling). The server is shipped as the optional extra
``seo-video-slicer[mcp]`` and run with ``python -m app.mcp``.

**Trust model (spec §7.6).** This is a *local* tool invoked over **stdio** by a
*same-user* caller (the agent runs as the user), so it operates with the caller's
own filesystem permissions — there is no remote exposure and no sandbox. Inputs
are still validated (reject ``..`` / NUL / malformed, resolve to absolute, require
existence) to avoid foot-guns and accidental traversal, but the security boundary
is the OS user, not this process. See ``backend/app/mcp/README.md``.

stdout is reserved for JSON-RPC: this package never prints to stdout; all logging
goes to stderr via the :mod:`logging` module.
"""

from __future__ import annotations

from .server import mcp

__all__ = ["mcp"]
