"""Reachability surfacing: local / LAN / Tailscale URLs (API.md §8.2, spec §4).

Degrades gracefully: ``local`` is always present; ``lan`` and ``tailscale`` are
``null`` when undetectable (no error). Tailscale is read from ``tailscale ip -4``
when the binary exists, else ``null``.
"""

from __future__ import annotations

import logging
import shutil
import socket
import subprocess
from pathlib import Path

from .config import PORT

# The macOS Tailscale app ships its CLI inside the bundle and does NOT add it to
# PATH, so a PATH-only check reports null on machines that clearly have Tailscale.
_TAILSCALE_FALLBACK_PATHS = (
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
)

log = logging.getLogger("svs.share")


def _local_url(port: int) -> str:
    return f"http://localhost:{port}"


def _lan_ip() -> str | None:
    """Best-effort primary LAN IPv4 via a UDP socket (no packets actually sent)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Connecting a UDP socket just selects a source interface; nothing is sent.
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()
    if not ip or ip.startswith("127."):
        return None
    return ip


def _tailscale_binary() -> str | None:
    """Resolve the Tailscale CLI: PATH first, then the known macOS/Homebrew paths."""
    found = shutil.which("tailscale")
    if found:
        return found
    for candidate in _TAILSCALE_FALLBACK_PATHS:
        if Path(candidate).exists():
            return candidate
    return None


def _tailscale_ip() -> str | None:
    """First Tailscale IPv4 from ``tailscale ip -4``; ``None`` if not on a tailnet."""
    binary = _tailscale_binary()
    if binary is None:
        return None
    try:
        proc = subprocess.run(
            [binary, "ip", "-4"], capture_output=True, text=True, check=False, timeout=5
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    for line in proc.stdout.splitlines():
        candidate = line.strip()
        if candidate and not candidate.startswith("127."):
            return candidate
    return None


def share_status(port: int = PORT) -> dict[str, str | None]:
    """Return ``{local, lan, tailscale}`` URLs; lan/tailscale are ``None`` if absent."""
    lan_ip = _lan_ip()
    ts_ip = _tailscale_ip()
    return {
        "local": _local_url(port),
        "lan": f"http://{lan_ip}:{port}" if lan_ip else None,
        "tailscale": f"http://{ts_ip}:{port}" if ts_ip else None,
    }
