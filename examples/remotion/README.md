# Remotion -> seo-video-slicer example

Render a tiny [Remotion](https://www.remotion.dev/) hero composition to a PNG
sequence, then slice it into a self-contained, Core-Web-Vitals-friendly WebP
**package** with the seo-video-slicer. The whole flow is three commands and runs
on a clean clone.

```
Remotion (React -> motion)  ->  seo-video-slicer (optimize -> WebP package)  ->  any site
```

Remotion is the renderer; the slicer is the web-delivery optimizer and packager.
A raw Remotion MP4 is heavy and poor for a hero moment (LCP, autoplay rules, no
reduced-motion story). The slicer turns the frames into a drop-in package with a
working, offline player.

See the full write-up in [`docs/remotion-recipe.md`](../../docs/remotion-recipe.md).

## Prerequisites

System tools (not pip/npm deps — they are shelled out to):

- **node** + **npx** (the Remotion toolchain) — https://nodejs.org
- **ffmpeg** (media; a slicer prerequisite) — https://ffmpeg.org/download.html
- **python3** (3.10+) — to run the slicer

No global install of the slicer is required: `make setup` installs it into a
local `./.venv` and the example drives it via `python -m app.cli slice ...`.

## The flow: render -> slice -> embed

From this directory (`examples/remotion/`):

```bash
# 0. One-time deps
npm install                 # Remotion (JS) into ./node_modules
make setup                  # creates ./.venv and `pip install -e ../../backend`

# 1. Render the composition to a PNG sequence -> ./out/
make render-sequence
# (equivalently:)
npx remotion render HeroLoop out/ --sequence --image-format=png

# 2. Slice the frames into a gated WebP package -> ./pkg/
make slice-package
# (equivalently:)
.venv/bin/python -m app.cli slice ./out --fps 12 --mode loop --out-dir ./pkg

# 3. Embed: copy ./pkg into your app's static assets (see "Two-tier embed" below)
```

`make all` runs steps 1 and 2 once `npm install` + `make setup` have been done.

### Why `python -m app.cli slice` and not `seo-video-slicer slice`?

On a fresh checkout the `seo-video-slicer` **console script is not on your
PATH**. `make setup` runs `pip install -e ../../backend`, which puts the `app`
package on the venv's import path, so the module form `python -m app.cli slice`
always resolves — no PATH surgery, no global install. The `slice` subcommand and
the `seo-video-slicer slice` console entry are the same code (spec §5.1).

Tune cadence/mode without editing the Makefile:

```bash
make slice-package FPS=24 MODE=scroll
```

## Frames-dir ingest accepts both `element-NNNN` and `frame_NNN`

Remotion's `render --sequence` names frames `element-0000.png` **by default**
(zero-padded; the first index may be non-zero). This example's
`remotion.config.ts` pins the cleaner `frame_[frame].[ext]` pattern, so you get
`frame_0000.png … frame_0089.png` instead.

Either way, the slicer's frames-dir ingest (`convert_frames_to_webp`, spec §8.2)
**accepts both**: it globs `*.png`/`*.jpg`/`*.jpeg`/`*.webp`, sorts **numerically
by the trailing integer** in each filename (so `element-2` precedes
`element-10`, which a naive lexicographic sort gets wrong), and renumbers to a
contiguous `frame_000.webp …` sequence. If you delete the
`setImageSequencePattern` line from `remotion.config.ts`, the default
`element-NNNN.png` output slices identically.

## Frame budget

The slicer's package contract hard-caps a package at **200 frames** (`verify.mjs`
gate G7). The composition is `durationInFrames={90}` at `fps={30}` (3 s of source
motion) — well under the cap. The render fps and the slicer's playback `--fps`
(e.g. 12) are independent: `--fps` re-times the loop, it does not change how many
frames you rendered.

## Two-tier embed

A **loop** package (`--mode loop`) ships **two** ways to embed the same motion.
Pick per your accessibility and JS budget:

| Tier | Markup | Pros | Reduced-motion |
|---|---|---|---|
| **`loop.webp`** | `<img src="loop.webp" loading="lazy">` | Zero JS, simplest drop-in | **Ignored** — an `<img>` cannot honor `prefers-reduced-motion` |
| **`index.html`** (canvas + frames) | `<iframe src="index.html">` or copy the canvas player | DPR-crisp, controllable | **Honored** — renders one static hero frame under `prefers-reduced-motion: reduce` |

```html
<!-- Tier 1: zero-JS animated image (does NOT honor reduced-motion) -->
<img src="/hero/loop.webp" loading="lazy" alt="Animated hero" />

<!-- Tier 2: canvas player (honors prefers-reduced-motion) -->
<iframe src="/hero/index.html" title="Animated hero"
        loading="lazy" style="width:100%;height:100vh;border:0"></iframe>
```

If accessibility matters (it should for a hero), prefer the `index.html` canvas
tier; reach for `loop.webp` only where a zero-JS `<img>` is a hard requirement.

A **scroll** package (`--mode scroll`) ships the scroll player only (no
`loop.webp`); embed via its `index.html`.

## What's in here

```
examples/remotion/
|-- README.md            # this file
|-- package.json         # remotion deps (pinned exact)
|-- remotion.config.ts   # PNG sequence; pins frame_[frame] naming
|-- tsconfig.json        # JSX / TS for the composition
|-- src/
|   |-- index.ts         # registerRoot entry point
|   |-- Root.tsx         # registers the HeroLoop composition (id = "HeroLoop")
|   `-- HeroLoop.tsx      # the self-contained motion (no external assets)
`-- Makefile             # setup / render-sequence / slice-package / clean
```

The composition uses **system fonts and drawn shapes only** — no network fonts,
no image URLs — so both the render and the resulting package are fully
self-contained (slicer gate G3: zero external requests).
