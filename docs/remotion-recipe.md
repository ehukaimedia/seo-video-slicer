# Recipe: Remotion -> seo-video-slicer (render -> slice -> embed)

**Status:** Phase 1 recipe (Remotion lane)
**Companion:** the runnable [`examples/remotion/`](../examples/remotion/) project
**Spec:** [`docs/specs/remotion-companion-spec.md`](specs/remotion-companion-spec.md) §8

Use [Remotion](https://www.remotion.dev/) to generate motion, then the
seo-video-slicer to optimize and package it for the web:

```
Remotion (React -> motion)  ->  seo-video-slicer (optimize -> WebP package)  ->  any site / repo
```

Remotion renders; the slicer is the web-delivery optimizer + packager. A raw
Remotion MP4 makes a poor hero (heavy, hurts LCP, ignores
`prefers-reduced-motion`, can't scroll-scrub). The slicer turns a frames
directory into a self-contained, gate-verified WebP package with a working
offline player — and `examples/remotion/` makes the whole thing one `make` flow.

## Prerequisites

System tools (shelled out to, **not** pip/npm dependencies):

- **node** + **npx** — the Remotion toolchain (https://nodejs.org)
- **ffmpeg** — media prerequisite (https://ffmpeg.org/download.html)
- **python3** 3.10+ — to run the slicer

## The flow

From `examples/remotion/`:

```bash
npm install                 # Remotion (JS) deps
make setup                  # ./.venv + `pip install -e ../../backend`
make render-sequence        # npx remotion render HeroLoop out/ --sequence --image-format=png
make slice-package          # python -m app.cli slice ./out --fps 12 --mode loop --out-dir ./pkg
# embed: copy ./pkg into your app's public/ and use index.html (canvas) or loop.webp (<img>)
```

The raw commands behind the `make` targets:

```bash
npx remotion render HeroLoop out/ --sequence --image-format=png
.venv/bin/python -m app.cli slice ./out --fps 12 --mode loop --out-dir ./pkg
```

### Clean-clone note: use the module form, not the console script

On a fresh checkout the `seo-video-slicer` **console script is not on PATH**.
`make setup` runs `pip install -e ../../backend`, which puts the `app` package on
the venv's import path, so `python -m app.cli slice ...` resolves without a
global install or PATH edits. The `slice` subcommand is the same code as the
`seo-video-slicer slice` console entry (spec §5.1).

## Ingest accepts both `element-NNNN` and `frame_NNN`

Remotion's `render --sequence` emits `element-0000.png` **by default** (PNG,
zero-padded, first index may be non-zero). The example's `remotion.config.ts`
pins the cleaner `frame_[frame].[ext]` pattern (`frame_0000.png …`).

The slicer's frames-dir ingest (`slicing.convert_frames_to_webp`, spec §8.2)
**accepts both**:

1. Globs `*.png` / `*.jpg` / `*.jpeg` / `*.webp` (also matches legacy `frame_*`).
2. Sorts **numerically by the trailing integer** in each name — so `element-2`
   precedes `element-10` (a naive lexicographic sort breaks this).
3. Renumbers to a contiguous, zero-padded `frame_000.webp …` sequence, converting
   to WebP via Pillow.
4. Errors loudly on an empty dir or names with no trailing integer to order on.

So dropping the `setImageSequencePattern` line and shipping Remotion's default
`element-NNNN.png` slices identically.

## Frame budget

The package contract hard-caps frames at **200** (`verify.mjs` gate G7 fails
above it). Keep `durationInFrames` modest; the example uses **90 @ 30 fps** (3 s).
The slicer's playback `--fps` (e.g. 12) re-times the loop and is independent of
the render fps / frame count.

## Two-tier embed

A **loop** package ships the same motion **two** ways:

| Tier | Markup | Reduced-motion | When |
|---|---|---|---|
| `loop.webp` | `<img src="loop.webp" loading="lazy">` | **Ignored** (it's an `<img>`) | Zero-JS drop-in is a hard requirement |
| `index.html` (canvas + frames) | `<iframe src="index.html">` | **Honored** — static frame under `prefers-reduced-motion: reduce` | The accessible default for a hero |

```html
<!-- Zero-JS, does NOT honor reduced-motion -->
<img src="/hero/loop.webp" loading="lazy" alt="Animated hero" />

<!-- Canvas player, honors prefers-reduced-motion -->
<iframe src="/hero/index.html" title="Animated hero"
        loading="lazy" style="width:100%;height:100vh;border:0"></iframe>
```

Prefer the `index.html` canvas tier when accessibility matters; reach for
`loop.webp` only where a zero-JS `<img>` is required. A **scroll** package
(`--mode scroll`) ships the scroll `index.html` only (no `loop.webp`).

## Self-contained motion

The example composition (`src/HeroLoop.tsx`) uses **system fonts and drawn
shapes only** — no network fonts, no image/URL references — so the render and the
resulting package have **zero external requests** (slicer gate G3). The motion
returns to its frame-0 state at the final frame, so the looped `loop.webp` has no
visible seam.
