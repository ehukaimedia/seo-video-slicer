"""``python -m app.mcp`` — serve the two slice tools over stdio (spec §7.1).

stdout is reserved for the JSON-RPC protocol, so logging is pinned to **stderr**
here (the SDK's stdio transport owns stdout). Then hand control to FastMCP's
default stdio ``run()``.
"""

from __future__ import annotations

import logging
import sys

from .server import mcp


def main() -> None:
    # Diagnostics to STDERR only — stdout is the JSON-RPC channel (spec §7.2).
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    mcp.run()  # transport defaults to "stdio"


if __name__ == "__main__":
    main()
