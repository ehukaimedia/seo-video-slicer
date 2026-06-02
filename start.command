#!/usr/bin/env bash
#
# SEO Video Slicer — local launcher.
#
# Double-click (Finder) or run from a terminal. It is IDEMPOTENT:
#   * creates a Python venv at ./.venv (only if missing), with
#     --system-site-packages so it inherits the system cv2 / Pillow / numpy;
#   * pip-installs backend/requirements.txt (only if not already satisfied);
#   * npm install + npm run build the frontend (only if dist is missing/stale);
#   * starts uvicorn on :8000 (bound to 0.0.0.0 for LAN / Tailscale reach);
#   * prints the Local / LAN / Tailscale URLs.
#
# Nothing here installs torch or IOPaint — the baseline (OpenCV) erase, crop,
# WebP encode, ffmpeg, and the packager all run on the lean deps alone.

set -euo pipefail

# Resolve the repo root from this script's location (works when double-clicked).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

VENV="$ROOT/.venv"
PY="$VENV/bin/python"
PIP="$VENV/bin/pip"
PORT="${SVS_PORT:-8000}"
export SVS_PORT="$PORT"   # /api/share reports this same port

log() { printf '\033[1;36m[start]\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Python venv (inherits system cv2 / Pillow / numpy via system-site-packages).
# ---------------------------------------------------------------------------
if [ ! -x "$PY" ]; then
  log "creating venv at .venv (--system-site-packages)…"
  python3 -m venv --system-site-packages "$VENV"
else
  log "venv present — skipping create"
fi

# ---------------------------------------------------------------------------
# 2. Backend deps. Skip the install when uvicorn+fastapi already import.
# ---------------------------------------------------------------------------
if "$PY" -c "import fastapi, uvicorn, multipart" >/dev/null 2>&1; then
  log "backend deps already satisfied — skipping pip install"
else
  log "installing backend deps (backend/requirements.txt)…"
  "$PIP" install --upgrade pip >/dev/null
  "$PIP" install -r "$ROOT/backend/requirements.txt"
fi

# Sanity: the inherited native libs must be importable, or finalize/erase fail.
if ! "$PY" -c "import cv2, PIL, numpy" >/dev/null 2>&1; then
  log "WARNING: cv2 / Pillow / numpy not importable in the venv."
  log "         Re-create with --system-site-packages, or pip install opencv-python pillow."
fi

# ---------------------------------------------------------------------------
# 3. Frontend build. Skip when dist/index.html already exists.
# ---------------------------------------------------------------------------
if [ -f "$ROOT/frontend/dist/index.html" ]; then
  log "frontend already built (frontend/dist) — skipping npm build"
else
  log "installing + building frontend…"
  ( cd "$ROOT/frontend" \
      && { [ -d node_modules ] || npm install; } \
      && npm run build )
fi

# ---------------------------------------------------------------------------
# 4. Reachability URLs.
# ---------------------------------------------------------------------------
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
TS_HOST=""
if command -v tailscale >/dev/null 2>&1; then
  TS_HOST="$(tailscale status --json 2>/dev/null \
    | "$PY" -c 'import sys,json;
try:
    d=json.load(sys.stdin); print(d.get("Self",{}).get("DNSName","").rstrip("."))
except Exception:
    pass' 2>/dev/null || true)"
fi

echo
log "SEO Video Slicer is starting on port $PORT"
printf '  Local:     \033[1;32mhttp://localhost:%s\033[0m\n' "$PORT"
[ -n "$LAN_IP" ]  && printf '  LAN:       \033[1;32mhttp://%s:%s\033[0m\n' "$LAN_IP" "$PORT"
[ -n "$TS_HOST" ] && printf '  Tailscale: \033[1;32mhttp://%s:%s\033[0m\n' "$TS_HOST" "$PORT"
echo

# ---------------------------------------------------------------------------
# 5. Run uvicorn from backend/ so `app.main:app` resolves. Foreground.
# ---------------------------------------------------------------------------
cd "$ROOT/backend"
exec "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
