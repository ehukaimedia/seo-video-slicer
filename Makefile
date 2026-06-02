# SEO Video Slicer — developer Makefile.
#
# Thin, OS-agnostic wrappers around the same steps start.sh runs. The venv at
# ./.venv is created with --system-site-packages so it inherits the system
# cv2 / Pillow / numpy (the lean baseline install — no torch, no IOPaint).
#
#   make setup   # create venv, pip install backend deps, npm install frontend
#   make build   # build the frontend (npm run build -> frontend/dist)
#   make run      # start uvicorn on $(SVS_PORT) (default 8000), bound to 0.0.0.0
#   make test    # pytest backend + node kernel verify against the golden package
#   make clean   # remove venv, frontend build/node_modules, and pycache
#
# Override the port:  make run SVS_PORT=9000

SVS_PORT ?= 8000
VENV     := .venv
PY       := $(VENV)/bin/python
PIP      := $(VENV)/bin/pip

.PHONY: setup build run test clean

# Create the venv (idempotent) + install backend and frontend dependencies.
setup:
	@test -x $(PY) || python3 -m venv --system-site-packages $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r backend/requirements.txt
	cd frontend && npm install

# Build the frontend production bundle into frontend/dist.
build:
	cd frontend && npm run build

# Run the API (serves the built frontend). Foreground; Ctrl-C to stop.
run:
	cd backend && ../$(PY) -m uvicorn app.main:app --host 0.0.0.0 --port $(SVS_PORT)

# Backend pytest + the frozen package-kernel verify against the golden fixture.
# pytest exits 5 when it collects no tests — tolerate only that, not real failures.
test:
	$(PY) -m pytest backend || [ $$? -eq 5 ]
	node package-contract/verify.mjs examples/golden-package

# Remove generated artifacts. Leaves source untouched.
clean:
	rm -rf $(VENV)
	rm -rf frontend/dist frontend/node_modules
	find backend -type d -name __pycache__ -prune -exec rm -rf {} +
