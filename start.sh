#!/usr/bin/env bash
#
# SEO Video Slicer — cross-platform local launcher (Linux + macOS).
#
# Mirrors start.command (the macOS double-click launcher) but is portable to
# Linux. Run it from anywhere:
#
#     bash start.sh            # always works
#     ./start.sh               # after: chmod +x start.sh
#
# It is IDEMPOTENT:
#   * creates a Python venv at ./.venv (only if missing), with
#     --system-site-packages so it inherits the system cv2 / Pillow / numpy;
#   * pip-installs backend/requirements.txt (only if not already satisfied);
#   * npm install + npm run build the frontend (only if dist is missing);
#   * starts uvicorn on :8000 (bound to 0.0.0.0 for LAN / Tailscale reach);
#   * prints the Local / LAN / Tailscale URLs.
#
# Nothing here installs torch or IOPaint — the baseline (OpenCV) erase, crop,
# WebP encode, ffmpeg, and the packager all run on the lean deps alone.
#
# NOTE: to launch by double-click / ./start.sh, mark it executable once:
#     chmod +x start.sh
# This script cannot chmod itself; until then, run it with `bash start.sh`.

set -euo pipefail

# Resolve the repo root from this script's location (works from anywhere, and
# whether invoked as `./start.sh` or `bash start.sh`).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

VENV="$ROOT/.venv"
PY="$VENV/bin/python"
PIP="$VENV/bin/pip"
PORT="${SVS_PORT:-8000}"
export SVS_PORT="$PORT"   # /api/share reports this same port

log() { printf '\033[1;36m[start]\033[0m %s\n' "$*"; }

pid_is_this_app() {
  local pid="$1" cmd cwd
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"

  [[ "$cmd" == *uvicorn* && "$cmd" == *app.main:app* ]] || return 1
  [[ "$cmd" == *"$ROOT"* || "$cwd" == "$ROOT"* ]] || return 1
}

stop_existing_app_server() {
  if ! command -v lsof >/dev/null 2>&1; then
    log "WARNING: lsof not found; cannot check port $PORT before launch"
    return 0
  fi

  local pids pid app_pids foreign_pids still_listening round
  pids="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
  if [ -z "$pids" ]; then
    return 0
  fi

  app_pids=""
  foreign_pids=""
  for pid in $pids; do
    if pid_is_this_app "$pid"; then
      app_pids="$app_pids $pid"
    else
      foreign_pids="$foreign_pids $pid"
    fi
  done

  if [ -n "$foreign_pids" ]; then
    log "ERROR: port $PORT is already used by another process:$foreign_pids"
    ps -p $foreign_pids -o pid=,command= 2>/dev/null || true
    log "Keep port $PORT consistent, or set SVS_PORT to a deliberate alternate port."
    return 1
  fi

  log "port $PORT has an existing SEO Video Slicer server; restarting pid(s):$app_pids"
  kill $app_pids 2>/dev/null || true

  for round in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.2
    still_listening="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
    if [ -z "$still_listening" ]; then
      return 0
    fi
  done

  log "port $PORT is still held by this app; force-killing pid(s): $(echo "$still_listening" | tr '\n' ' ')"
  kill -9 $still_listening 2>/dev/null || true

  for round in 1 2 3 4 5; do
    sleep 0.2
    still_listening="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
    if [ -z "$still_listening" ]; then
      return 0
    fi
  done

  log "ERROR: port $PORT is still in use after cleanup"
  return 1
}

open_guest_window_when_ready() {
  local url="$1"
  [ "${SVS_OPEN_BROWSER:-1}" = "0" ] && return 0
  [ "$(uname -s)" = "Darwin" ] || return 0
  command -v open >/dev/null 2>&1 || return 0

  (
    local round
    for round in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      if ! command -v curl >/dev/null 2>&1 || curl -fsS --max-time 1 "$url" >/dev/null 2>&1; then
        break
      fi
      sleep 0.25
    done

    open -na "Google Chrome" --args --guest "$url" >/dev/null 2>&1 \
      || open "$url" >/dev/null 2>&1 \
      || true
  ) &
}

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
# 4. Restart this app if it already owns the fixed port.
# ---------------------------------------------------------------------------
stop_existing_app_server

# ---------------------------------------------------------------------------
# 5. Reachability URLs. LAN IP detection differs per OS.
# ---------------------------------------------------------------------------
case "$(uname -s)" in
  Darwin)
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    ;;
  *)
    # Linux: prefer `hostname -I` (first addr); fall back to the route lookup.
    LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    if [ -z "${LAN_IP:-}" ]; then
      LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
    fi
    ;;
esac

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
LOCAL_URL="http://localhost:$PORT"
printf '  Local:     \033[1;32m%s\033[0m\n' "$LOCAL_URL"
[ -n "${LAN_IP:-}" ]  && printf '  LAN:       \033[1;32mhttp://%s:%s\033[0m\n' "$LAN_IP" "$PORT"
[ -n "${TS_HOST:-}" ] && printf '  Tailscale: \033[1;32mhttp://%s:%s\033[0m\n' "$TS_HOST" "$PORT"
echo
open_guest_window_when_ready "$LOCAL_URL"

# ---------------------------------------------------------------------------
# 6. Run uvicorn from backend/ so `app.main:app` resolves. Foreground.
# ---------------------------------------------------------------------------
cd "$ROOT/backend"
exec "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
