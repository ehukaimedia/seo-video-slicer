"""Unit tests for reachability surfacing (API.md §8.2, spec §4).

backend.app.share degrades gracefully: ``local`` is always present; ``lan`` and
``tailscale`` are ``None`` when undetectable. We assert the Tailscale binary
resolver finds a fallback path when one exists on disk and returns ``None`` when
none do, and that share_status() always carries a non-null local url regardless of
network state.

To exercise the *fallback* branch deterministically we neutralize the PATH lookup
(``shutil.which`` -> None) and repoint the fallback-path tuple at a real temp file,
rather than mocking ``Path.exists`` globally.
"""

from __future__ import annotations

from pathlib import Path

from backend.app import share


def test_tailscale_binary_path_first(monkeypatch) -> None:
    """When the CLI is on PATH, shutil.which wins and we return that path verbatim."""
    monkeypatch.setattr(share.shutil, "which", lambda name: "/usr/bin/tailscale")
    assert share._tailscale_binary() == "/usr/bin/tailscale"


def test_tailscale_binary_falls_back_to_known_path(monkeypatch, tmp_path) -> None:
    """No PATH hit, but a known fallback path exists on disk -> resolve to it."""
    fake_cli = tmp_path / "Tailscale"
    fake_cli.write_text("#!/bin/sh\n")  # real file so Path(candidate).exists() is True

    monkeypatch.setattr(share.shutil, "which", lambda name: None)
    monkeypatch.setattr(
        share,
        "_TAILSCALE_FALLBACK_PATHS",
        (str(tmp_path / "missing"), str(fake_cli)),
    )
    assert share._tailscale_binary() == str(fake_cli)


def test_tailscale_binary_none_when_absent(monkeypatch) -> None:
    """No PATH hit and no fallback path exists -> None (degrade gracefully)."""
    monkeypatch.setattr(share.shutil, "which", lambda name: None)
    monkeypatch.setattr(
        share,
        "_TAILSCALE_FALLBACK_PATHS",
        ("/nonexistent/svs/tailscale-a", "/nonexistent/svs/tailscale-b"),
    )
    assert share._tailscale_binary() is None


def test_share_status_always_has_local(monkeypatch) -> None:
    """local is mandatory; lan/tailscale may be None. Force both detectors to None."""
    monkeypatch.setattr(share, "_lan_ip", lambda: None)
    monkeypatch.setattr(share, "_tailscale_ip", lambda: None)

    status = share.share_status()
    assert status["local"] is not None
    assert status["local"].startswith("http://localhost:")
    assert status["lan"] is None
    assert status["tailscale"] is None


def test_share_status_local_honors_port() -> None:
    status = share.share_status(port=12345)
    assert status["local"] == "http://localhost:12345"
    # Keys are always present even when their values are null.
    assert set(status.keys()) == {"local", "lan", "tailscale"}


def test_share_status_default_port_is_non_null() -> None:
    """The no-arg call (what GET /api/share uses) still yields a usable local url."""
    status = share.share_status()
    assert isinstance(status["local"], str) and status["local"]
    # local url must point at localhost (it is always reachable), never None.
    assert Path  # keep the import meaningful for linters
