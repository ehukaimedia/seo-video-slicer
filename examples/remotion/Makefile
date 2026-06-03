# seo-video-slicer — Remotion example Makefile.
#
# The render -> slice -> embed flow on a CLEAN CLONE. The seo-video-slicer
# console script is NOT on PATH after a bare clone, so `setup` installs the
# backend into a local project venv and `slice-package` drives it via
# `python -m app.cli slice ...` (the module form always resolves once the
# package is installed, regardless of PATH).
#
#   make setup           # create ./.venv + `pip install -e ../../backend`
#   make render-sequence # npx remotion render -> ./out/frame_*.png
#   make slice-package   # python -m app.cli slice ./out --mode loop -> ./pkg
#   make clean           # remove ./out, ./pkg, ./.venv, node_modules
#
# Prerequisites (system tools, NOT pip deps): node + npx, ffmpeg, python3.
# Tune the cadence:  make slice-package FPS=24 MODE=scroll
# Cap hero width:    make slice-package MAX_WIDTH=1280

# Repo backend dir (this Makefile lives in examples/remotion/).
BACKEND   := ../../backend
VENV      := .venv
PY        := $(VENV)/bin/python
PIP       := $(VENV)/bin/pip

# Slicer knobs (override on the command line).
COMP      ?= HeroLoop
OUT       ?= out
PKG       ?= pkg
FPS       ?= 12
MODE      ?= loop
MAX_WIDTH ?=
MAX_WIDTH_ARG := $(if $(MAX_WIDTH),--max-width $(MAX_WIDTH),)

.PHONY: setup render-sequence slice-package all clean

# all: the full pipeline (assumes `make setup` and `npm install` have run).
all: render-sequence slice-package

# Create the project venv and make the slicer importable on a clean clone.
# `pip install -e ../../backend` puts the `app` package on the venv's path so
# `python -m app.cli` works WITHOUT the console script being on PATH.
setup:
	@test -x $(PY) || python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -e $(BACKEND)
	@echo
	@echo "Node deps: run 'npm install' here (Remotion is a JS toolchain)."
	@echo "Slicer ready via: $(PY) -m app.cli slice ..."

# Render the composition to a PNG image sequence in ./out/.
# --sequence emits one PNG per frame; --image-format=png keeps it lossless before
# the slicer re-encodes to WebP. remotion.config.ts pins frame_[frame] naming;
# the default element-NNNN naming is also accepted by the slicer's ingest.
render-sequence:
	npx remotion render $(COMP) $(OUT)/ --sequence --image-format=png

# Slice the rendered frames into a gated WebP package in ./pkg/.
# Uses the venv's interpreter so the install from `make setup` is on the path.
# Signature matches the headless CLI (spec §5.1): positional <path>, --mode,
# --fps, --out-dir.
slice-package:
	$(PY) -m app.cli slice ./$(OUT) --fps $(FPS) --mode $(MODE) $(MAX_WIDTH_ARG) --out-dir ./$(PKG)
	@echo
	@echo "Package: ./$(PKG)  (open ./$(PKG)/index.html offline, or use ./$(PKG)/loop.webp)"

clean:
	rm -rf $(OUT) $(PKG) $(VENV) node_modules
