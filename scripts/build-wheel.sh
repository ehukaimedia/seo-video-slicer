#!/usr/bin/env bash
# Build the distributable wheel for `uvx`/`pipx`: bundle the built UI and the
# frozen package kernel INTO the Python package so it runs with no clone.
#
#   uvx --from <wheel> seo-video-slicer
#
# Output: backend/dist/seo_video_slicer-<version>-py3-none-any.whl
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-python3}"

echo "==> building the frontend (Vite)"
( cd frontend && npm ci && npm run build )

echo "==> bundling UI + kernel into the package"
rm -rf backend/app/_web backend/app/_kernel
cp -r frontend/dist backend/app/_web
mkdir -p backend/app/_kernel
cp package-contract/build_package.mjs \
   package-contract/verify.mjs \
   package-contract/index.template.html \
   package-contract/CONTRACT.md \
   backend/app/_kernel/

echo "==> building the wheel"
"$PY" -m pip install --quiet --upgrade build
( cd backend && rm -rf dist && "$PY" -m build --wheel --outdir dist )

echo "==> done:"
ls -1 backend/dist/*.whl
