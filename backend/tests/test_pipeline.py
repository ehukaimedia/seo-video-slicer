"""End-to-end pipeline test: upload -> preview -> finalize -> package -> download.

Drives the real FastAPI app in-process via fastapi.testclient.TestClient(app),
exercising the same routes the frontend hits and the same Node kernels the backend
shells (build_package.mjs + verify.mjs). Asserts the package passes its gate
(G1..G7 all present and pass), exposes a download_url, and that the URL streams a
non-empty zip. Hermetic: conftest pins SVS_DATA_DIR to a temp dir before import.
"""

from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient

# Importing here (not at top of conftest) is fine: conftest sets SVS_DATA_DIR and
# fixes sys.path at module load, which pytest executes before collecting this file.
from backend.app.main import app

EXPECTED_GATES = {"G1", "G2", "G3", "G4", "G5", "G6", "G7"}


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def test_full_pipeline_to_passing_package(client: TestClient, test_clip) -> None:
    # 1) UPLOAD — multipart with an explicit video/mp4 MIME (route 415s otherwise).
    with test_clip.open("rb") as fh:
        resp = client.post(
            "/api/upload",
            files={"file": ("clip.mp4", fh.read(), "video/mp4")},
        )
    assert resp.status_code == 200, resp.text
    up = resp.json()
    job_id = up["job_id"]
    assert job_id
    assert up["width"] == 640 and up["height"] == 360
    duration_s = float(up["duration_s"])
    assert duration_s >= 2.0  # generated 3s clip; preview window 0..2 must fit.

    # 2) PREVIEW — 0..2s at 6 fps -> ~12 JPEG preview frames.
    resp = client.post(
        f"/api/jobs/{job_id}/preview",
        json={"start": 0, "end": 2, "fps": 6},
    )
    assert resp.status_code == 200, resp.text
    prev = resp.json()
    preview_id = prev["preview_id"]
    assert prev["count"] >= 1
    assert len(prev["frames"]) == prev["count"]

    # 3) FINALIZE — keep all frames (excluded:[]) -> contiguous WebP slice.
    #    The route requires preview_id alongside excluded.
    resp = client.post(
        f"/api/jobs/{job_id}/finalize",
        json={"preview_id": preview_id, "excluded": []},
    )
    assert resp.status_code == 200, resp.text
    fin = resp.json()
    slice_id = fin["slice_id"]
    assert fin["count"] == prev["count"]

    # 4) PACKAGE — build + gate through the frozen Node kernels.
    resp = client.post(f"/api/jobs/{job_id}/slices/{slice_id}/package", json={})
    assert resp.status_code == 200, resp.text
    pkg = resp.json()

    verify = pkg["verify"]
    assert verify["pass"] is True, f"gate failed: {verify}"
    gate_ids = {g["id"] for g in verify["gates"]}
    assert EXPECTED_GATES.issubset(gate_ids), f"missing gates: {EXPECTED_GATES - gate_ids}"
    assert all(g["pass"] for g in verify["gates"]), verify["gates"]

    assert pkg["frame_count"] == fin["count"]
    assert pkg["lane"] in ("hero", "scrollytelling", "over")
    download_url = pkg["download_url"]
    assert download_url is not None

    # 5) DOWNLOAD — the URL must stream a non-empty, well-formed zip.
    resp = client.get(download_url)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"
    body = resp.content
    assert len(body) > 0
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        names = zf.namelist()
    assert any(n == "index.html" for n in names), names
    assert any(n == "manifest.json" for n in names), names
    assert any(n.startswith("frames/frame_") and n.endswith(".webp") for n in names), names
