"""Console entry point for the packaged (uvx / pipx) app.

When installed from the wheel, the built UI and the frozen package kernel ship
*inside* the package (``app/_web`` and ``app/_kernel``). This entry point points
the backend at them via the ``SVS_*`` env vars, keeps runtime data out of
site-packages, then runs uvicorn.

``ffmpeg`` (media) and ``node`` (the frozen kernel) must be on PATH — they are
shelled out to, not importable, so they are system prerequisites, not pip deps.

Run with no clone::

    uvx --from <release-wheel-url> seo-video-slicer
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from shutil import which


def main() -> None:
    pkg_dir = Path(__file__).resolve().parent

    # Point the backend at the bundled assets when they exist (wheel install);
    # otherwise fall back to the repo defaults (running from a source checkout).
    web = pkg_dir / "_web"
    if web.is_dir():
        os.environ.setdefault("SVS_FRONTEND_DIST", str(web))
    kernel = pkg_dir / "_kernel"
    if kernel.is_dir():
        os.environ.setdefault("SVS_KERNEL_DIR", str(kernel))

    # Installed tool: keep jobs/packages out of site-packages.
    os.environ.setdefault("SVS_DATA_DIR", str(Path.home() / ".seo-video-slicer" / "data"))

    port = int(os.environ.get("SVS_PORT", "8000"))
    os.environ["SVS_PORT"] = str(port)

    # System-tool prerequisites. ffmpeg is required to do anything; node is needed
    # only at export time, so a missing node is a warning, a missing ffmpeg is fatal.
    missing = [t for t in ("ffmpeg", "node") if which(t) is None]
    if missing:
        sys.stderr.write(
            "\n  seo-video-slicer needs these tools on your PATH: "
            + ", ".join(missing)
            + "\n  ffmpeg -> https://ffmpeg.org/download.html"
            "\n  node   -> https://nodejs.org  (only needed to export a package)\n\n"
        )
        if "ffmpeg" in missing:
            raise SystemExit(1)

    # Import AFTER the env is set so config resolves the bundled paths.
    from .share import share_status

    urls = share_status(port)
    print("\n  SEO Video Slicer")
    print(f"  ▸ Local:    {urls['local']}")
    if urls.get("lan"):
        print(f"  ▸ LAN:      {urls['lan']}")
    if urls.get("tailscale"):
        print(f"  ▸ Tailnet:  {urls['tailscale']}")
    print(f"\n  Data: {os.environ['SVS_DATA_DIR']}\n  (Ctrl+C to stop)\n")

    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
