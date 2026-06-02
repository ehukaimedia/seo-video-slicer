"""Security regression tests for path/id handling."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def test_data_route_rejects_resolved_symlink_escape(
    client: TestClient, data_dir: Path, tmp_path: Path
) -> None:
    """A file reachable via a /data symlink must still stay inside DATA_DIR."""
    outside = tmp_path / "secret.txt"
    outside.write_text("outside data root")

    exposed = data_dir / "jobs" / "leak.txt"
    exposed.parent.mkdir(parents=True, exist_ok=True)
    try:
        exposed.symlink_to(outside)
    except OSError as exc:  # pragma: no cover - platform/permissions dependent
        pytest.skip(f"symlink creation unavailable: {exc}")

    resp = client.get("/data/jobs/leak.txt")
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid path"


def test_data_subpath_validator_rejects_parent_segments() -> None:
    from backend.app.errors import ApiError, validate_data_subpath

    with pytest.raises(ApiError):
        validate_data_subpath("jobs/../secret.txt")
