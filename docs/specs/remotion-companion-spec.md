# Remotion Companion + Claude/Codex MCP Plugin — Specification

**Status:** Draft v2 (pre-implementation) — design approved; revised after adversarial spec review
**Date:** 2026-06-02
**Owner:** ehukaimedia
**Branch:** `feat/remotion-companion` (off `main` @ v0.1.1)
**Extends:** [`docs/specs/seo-video-slicer-spec.md`](seo-video-slicer-spec.md) (the base product) and the **FROZEN** [`package-contract/CONTRACT.md`](../../package-contract/CONTRACT.md) (`seo-video-slicer.package.v1`). This spec adds capabilities **around** the slicer; it never mutates the frozen v1 contract.
**Seeds:** [`docs/playgrounds/specs/remotion-companion-spec.html`](../playgrounds/specs/remotion-companion-spec.html) (the visual Spec Seed)
**Supersedes:** the open decisions in [`docs/plans/remotion-companion-kickoff.md`](../plans/remotion-companion-kickoff.md) — all five are pinned here (§4); one factual error in that doc is corrected (§14.2).

> **Citation note.** Source `file:line` anchors below were current at authoring. Line numbers drift once code is added; treat the **symbol name** (function/constant) as the durable anchor and the line as a hint.

---

## 1. Intent

**One sentence:** Make **seo-video-slicer** the *output companion* for [Remotion](https://www.remotion.dev/) and an invokable **plugin for Claude Code / Codex** — a headless `slice` CLI, a **loop** output mode (a new `seo-video-slicer.loop.v1` template), `slice_video` / `slice_frames` MCP tools, and a documented Remotion `--sequence` recipe — so an agent can say *"render this with Remotion, then slice it into a scroll (or loop) package"* and have it just work, headlessly.

**The positioning.**

```
Remotion (React → motion)  →  seo-video-slicer (optimize → WebP package)  →  any site / repo
```

Remotion is the *renderer*; the slicer is the *web-delivery optimizer + packager*. A raw Remotion MP4 is heavy and poor for a hero/scroll moment (LCP, autoplay restrictions, no scroll-scrubbing, no reduced-motion story). The slicer already turns a video into a Core-Web-Vitals-friendly WebP **package** with a working, self-contained player. This feature makes that pipeline **headless** (a CLI), **agent-invokable** (MCP), and adds a second output mode (**loop**) alongside the shipped **scroll** mode.

**Anti-pattern this prevents.** (a) Shipping a raw, heavy Remotion video as a hero (kills LCP, ignores `prefers-reduced-motion`, can't scroll-scrub); and (b) making a human or agent hand-run the upload → preview → finalize → package dance through a UI when it should be one non-interactive command.

**Why it fits (reuse, do not rebuild).** The headless core already exists: `package-contract/build_package.mjs` turns a frames dir into a complete, gate-verified package; `backend/app/slicing.py` extracts and WebP-encodes frames; `backend/app/packager.py` assembles + gates via the Node kernel; `package-contract/verify.mjs` enforces gates G1–G7 with a tamper fingerprint. This spec adds thin front-doors and one new template over those primitives.

---

## 2. Non-Goals (carry over + new)

Inherited and still binding (`seo-video-slicer-spec.md` §2, `PRODUCT.md`):

- ❌ No in-app animation generator. The downstream model (or Remotion) generates motion; the slicer optimizes and packages.
- ❌ No local LLM / model download for core function. No chat assistant. No multi-project dashboard / CRM.

New, specific to this feature:

- ❌ The MCP server and CLI are **plumbing around the slicer**, not a new studio. No new editing surface, no preview UI in the CLI/MCP path.
- ❌ Loop mode is **not** a video editor or a GIF studio. It is exactly: one auto-advancing player + one animated-WebP export, gated like everything else.
- ❌ **Never mutate** `seo-video-slicer.package.v1`. New modes are new template ids / schemas, each `verify.mjs`-gated, with the fingerprint recipe **byte-identical** between builder and verifier.
- ❌ `ffmpeg` and `node` stay **system prerequisites** (shelled out to, not pip deps). The new `mcp` dependency is an **optional extra**, not a core dep.

---

## 3. Users & Success

**Users:** a **Remotion developer** wanting a web-ready, LCP-safe hero package without hand-tuning ffmpeg; an **agent** (Claude Code / Codex) that renders then needs a package in one tool call; a **CI pipeline** that regenerates a package and must fail loudly on a contract violation.

**Success is one question:** *Can an agent run one command (or one MCP tool call) against a video or a Remotion `--sequence` frames directory and get back a package directory that passes `verify.mjs` and opens offline — with a non-zero exit on any gate failure?* The 5-star bar (`seo-video-slicer-spec.md` §12) still governs: anything that reads as "a template" or leaks stale context fails.

---

## 4. Scope & the five decisions (pinned)

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | MCP server runtime / location / distribution | **Python + FastMCP, in-package at `backend/app/mcp/`, shipped as the optional extra `seo-video-slicer[mcp]`, stdio transport** | Reuses `app.packager` / `app.slicing` directly (no re-shelling); inside the `app` namespace so it imports siblings *and* rides the existing wheel. The `mcp` dep installs only when asked. |
| 2 | Headless CLI signature | **`slice <path>` with path auto-detect, `--mode scroll\|loop`, `--fps`, video-only `--start/--end`, `--quality`, optional `--max-width`, `--out-dir`, `--slug`, `--json`, `--no-verify`** | Non-interactive, no UI/server. `--start/--end` avoids the kickoff's `--out`/`--out-dir` footgun. `--json` is the machine contract. Exit-code table in §5.3. |
| 3 | Loop output contract | **New schema `seo-video-slicer.loop-package.v1` + template_id `seo-video-slicer.loop.v1`; the 3-input fingerprint reused verbatim; new gates G8 (loop.webp structure + fps↔duration binding) + G9 (loop.webp content sha)** | `package.v1` cannot represent a loop (it freezes the scroll schema/interaction/template, and the gate enforces them). A parallel schema keeps v1 untouched and both coexist. See §6. |
| 4 | Remotion ingest | **Accept both a video and a PNG/JPEG/WebP frames-dir (numeric-sorted, renumbered, converted to WebP via Pillow); ship a runnable `examples/remotion/` project + a docs recipe** | Remotion `render --sequence` emits `element-NNNN.png`/JPEG; the kernel expects contiguous WebP. A runnable example makes `render → slice → embed` one command on clone. See §8. |
| 5 | MCP tool surface | **`slice_video(path,start,end,fps,mode,max_width?)` and `slice_frames(dir,fps,mode,max_width?)` → `{package_dir, verify:{pass,gates[]}, loop_webp?}`; stdio; plus a thin Claude Code skill/command wrapper** | Mirrors the two ingest paths; the wrapper adds agent ergonomics. See §7. |

**Sequencing note (conscious inversion).** The kickoff's "Recommended MVP" lists loop *last*; its Phase-0 plan lists the loop contract *first*. This spec builds **loop-first** (Phase 0 = freeze the loop kernel) for contract-first de-risking, as the kickoff's workflow plan dictates. Easily resequenced if shipping the scroll end-to-end path first is preferred.

---

## 5. The headless `slice` CLI (Decision 2)

### 5.1 Signature

```
seo-video-slicer slice <path> \
    --mode scroll|loop \
    --fps <n> \
    [--start <s>] [--end <s>] \
    [--quality 82-90] \
    [--max-width <px>] \
    --out-dir <dir> \
    [--slug <name>] \
    [--json] [--no-verify]
```

- `<path>` — **auto-detected**: a *file* ⇒ video ingest; a *directory* ⇒ frames-dir ingest (§8). Clear error if neither, or a directory with no usable frames.
- `--mode` — `scroll` (`seo-video-slicer.scroll.v1`) or `loop` (`seo-video-slicer.loop.v1`, §6). Default `scroll`.
- `--fps` — effective fps. For video, drives extraction; for a frames-dir, sets `source.fps_effective` and the loop frame duration (`perFrameMs(fps) = floor(1000/fps + 0.5)` ms; §6.9, CONTRACT-loop.md §2.1).
- `--start` / `--end` — trim window in seconds. **Video-only**; supplying them with a frames-dir is an error (loud, not silent).
- `--quality` — WebP quality, clamped to 82–90 (`config.WEBP_QUALITY`).
- `--max-width` — optional positive-integer width cap applied during extraction/conversion, before packaging. Preserves aspect ratio, never upscales, and is **off by default**. Docs recommend `--max-width 1280` for web-light heroes.
- `--out-dir` — directory to write the package into (see §7.6 path stance).
- `--slug` — package id; sanitized via `packager.sanitize_slug` (kebab-case, 1–64 chars). Defaults to the out-dir basename.
- `--json` — emit one machine-readable JSON object to stdout (identical to the MCP return shape, §10.2). Without it, a human summary (package path + per-gate PASS/FAIL).
- `--no-verify` — skip gate *enforcement*: the package is built and `verify.mjs` may still run, but its result is not enforced on the exit code. Output shows `verify: {"skipped": true}` and exit `0` on a clean build. **Off by default**; CI and MCP always enforce the gate. (Implementation note: enforcement is suppressed at the CLI boundary; `build_and_verify` itself has no skip-gate flag, so this is not a true fast-path — `verify.mjs` is sub-second anyway.)
- `slice --help` ships a **curated** usage block (the signature above + one example per ingest path and mode), asserted in CLI tests — not raw argparse noise.

### 5.2 Reuse chain (no JobStore, temp dirs)

The CLI reuses the HTTP stack's pure functions over temporary directories — not `Job`/`JobStore`:

1. **Video path:** `slicing.extract_preview(video, tmp_preview, start, end, fps, max_width=None)` → JPEG preview frames (enforces `MAX_SLICE_SECONDS`, optional ffmpeg downscale). Then `slicing.finalize_to_webp(tmp_preview, tmp_slice, excluded=[], quality)` → contiguous WebP frames + `"WIDTHxHEIGHT"`.
2. **Frames-dir path:** `slicing.convert_frames_to_webp(src_dir, tmp_slice, quality, max_width=None)` (§8.2) → contiguous WebP frames + resolution, with optional Pillow LANCZOS downscale.
3. **Package (both):** `packager.build_and_verify(...)` per §6.4a → result dict `{package_dir, verify:{pass,gates[]}, loop_webp, frame_count, weight_mb, lane, zip_path}`.
4. **Metadata, computed once:** `fps_effective = fps`; for both ingest paths `source.duration_s = round(frame_count / fps, 3)` (a Remotion frames-dir has no inherent source length, so it equals the loop length); `resolution` from the first WebP.

The CLI is a new module `backend/app/slice_cli.py`, invoked by a `slice` subcommand added to `backend/app/cli.py` (today UI-only). **Kernel resolution (review fix):** `cli.py` currently sets `SVS_KERNEL_DIR` only inside `main()` just before launching uvicorn — a *different* entry path from a subcommand. Factor that bundled-path resolution into a shared `cli._resolve_bundled_paths()` (sets `SVS_KERNEL_DIR=<pkg>/_kernel` and `SVS_FRONTEND_DIST` when the bundled dirs exist) and call it from **both** `main()` and the `slice` subcommand **before** importing `config`/`packager`, so wheel installs resolve the bundled kernel.

### 5.3 Exit codes (deterministic for CI/agents)

| Code | Meaning | `--json` |
|---|---|---|
| `0` | Built and (unless `--no-verify`) every gate passed | `verify.pass=true` (or `{"skipped":true}`) |
| `1` | Built, but ≥1 gate failed (a package exists) | `verify.pass=false`, failing gate ids in `verify.gates` |
| `2` | Input / ffmpeg / node / build error (no package produced) | `{"error":{"code","message"}}` |

Failing gate ids and `ApiError`-derived messages go to **stderr**. Empty / all-excluded / unreadable input ⇒ code `2`.

---

## 6. Loop output mode & the `loop.v1` contract (Decision 3) — the foundation

This is **Phase 0**. It is frozen first; everything else builds on it. The loop contract is documented in a **new sibling `package-contract/CONTRACT-loop.md`**, leaving every byte of the frozen `CONTRACT.md` prose unchanged.

### 6.1 New identifiers (v1 stays byte-identical)

| Identifier | Scroll (frozen v1) | Loop (new) |
|---|---|---|
| `manifest.schema` | `seo-video-slicer.package.v1` | `seo-video-slicer.loop-package.v1` |
| `data-template-id` (HTML) / `player.template_id` | `seo-video-slicer.scroll.v1` | `seo-video-slicer.loop.v1` |
| `player.interaction` | `scroll` | `loop` |

The naming is parallel: **`loop-package.v1` : `loop.v1` :: `package.v1` : `scroll.v1`** (schema : template_id). A loop package **cannot** be a `package.v1` manifest: v1 freezes `schema`, `player.interaction`, and `player.template_id` to scroll values (`CONTRACT.md` §1.1), and the gate enforces the scroll **HTML `data-template-id`** in G4 and the scroll `schema` in G5. A parallel schema is the only contract-safe path.

### 6.2 Documentation home (do not edit the frozen doc)

`CONTRACT-loop.md` restates only what differs from v1 and references v1 for everything shared (frame naming, weight budget philosophy, the fingerprint function). It freezes: the loop `locked_zones`/`safe_zones` arrays (§10.3), the `player.dependencies` value for loop (§6.3), the loop player required-technique markers (§6.6), the loop README headings (§6.5 G6), and the G8 duration-binding rule (§6.5).

### 6.3 Manifest shape — the `loop` block (outside the fingerprint)

A loop `manifest.json` mirrors v1's shape with the §6.1 identifiers, an **honest** `player.dependencies` (loop never loads GSAP — `"dependencies": {}`; the field is kept for v1 shape-parity but carries no GSAP), and a top-level `loop` block:

```json
"loop": {
  "fps": 12,
  "duration_s": 2.5,
  "webp": "loop.webp",
  "webp_sha256": "<lowercase hex sha256 of loop.webp bytes>",
  "loop_count": 0
}
```

- `fps` — fps of the baked animation; **bound to the bytes by G8** (§6.5).
- `duration_s` — loop length = `frames.count / fps`.
- `webp` — exactly `"loop.webp"`.
- `webp_sha256` — content hash of `loop.webp`, recorded by the builder, re-checked by G9.
- `loop_count` — `0` (infinite).

The `loop` block is **not** part of the frame fingerprint (§6.4); its integrity is gated by G8/G9.

### 6.4 Fingerprint — reused verbatim

The frozen recipe `fingerprint(frameBasenames, gsapUrlOrEmpty, templateId)` (`CONTRACT.md` §2) is reused **character-for-character**. For a loop: same bare sorted basenames, `gsapUrlOrEmpty = ""` (pure rAF, never GSAP), `templateId = "seo-video-slicer.loop.v1"`. The new `templateId` yields a **distinct, valid** sha256 for free; the recipe stays **byte-identical between builder and verifier** (the same function, unchanged). `fingerprint()` stays **exactly two copies** — one in `build_package.mjs`, one in `verify.mjs` — both unchanged. No third copy, no new recipe. Edit only the **canonical `package-contract/` copies**; `backend/app/_kernel/` is a gitignored build artifact regenerated by `scripts/build-wheel.sh`.

> **What the fingerprint does NOT cover, and how it's closed.** `fps` bakes `loop.webp`'s bytes but is *not* a fingerprint input, so the frame fingerprint alone cannot detect a re-encoded `loop.webp` or a lying `manifest.loop.fps`. This is closed not by the fingerprint but by **G8 + G9** (§6.5): G9 binds the manifest's recorded sha to the actual bytes, and G8 binds the actual baked cadence — the ANMF duration **sum** (coalescing-robust, §6.9) — to `manifest.loop.fps`. Together they make `fps ↔ loop.webp bytes ↔ manifest` mutually consistent.

### 6.4a `packager.build_and_verify` changes (the Python ↔ kernel contract)

Today `build_and_verify(slice_dir, pkg_dir, slug, duration_s, fps_effective, resolution, origin, quality=WEBP_QUALITY)` returns `{verify, frame_count, weight_mb, lane, zip_path}` (no `package_dir`, no `loop_webp`, no `mode`). Changes:

- **Signature:** add a single **trailing** param `mode: str = "scroll"` (the trailing default keeps the sole existing caller, `backend/app/main.py`, working unchanged). For loop mode `build_and_verify` **internally** bakes `loop.webp` — it calls `loop_export` after the >200 fail-fast (raising `ApiError(422)` if over budget, *before* any encode) and passes `--loop-webp` to the kernel. Callers pass only `mode="loop"`; there is **no** `loop_webp_path` parameter (the bake is owned internally). An unknown `mode` raises `ApiError(422)`.
- **Build command:** when `mode="loop"`, append `--mode loop` and `--loop-webp <path>` to the `node build_package.mjs` invocation (§6.4b).
- **Return dict:** add `package_dir` (= `str(pkg_dir)`) and `loop_webp` (= the package-relative `loop.webp` path string, or `None` for scroll). Keep `zip_path` for the HTTP caller.
- **Ownership of bytes vs hash:** `backend/app/loop_export.py` (§6.7) **produces the `loop.webp` bytes**; the **Node loop-builder owns** copying it in, computing `webp_sha256`, and writing the `loop` block + manifest. One owner for the hash + manifest avoids a double-compute/drift surface. `build_and_verify` calls `loop_export` first (only for loop mode, and only after the >200 fail-fast check, §6.8), then passes the produced path via `--loop-webp`.

### 6.4b Builder/verifier dispatch (no scroll regression)

The builder **emits** `schema`, so it cannot "branch on schema"; the verifier **reads** `manifest.schema`. So the two sides key differently, on one shared config table:

- **`build_package.mjs`** gains a `--mode scroll|loop` arg (default `scroll`). A `MODE_CONFIG` object maps each mode → `{ templateFilename, schema, playerInteraction, templateId, dependencies, lockedZones, safeZones }`. **The `scroll` entry is the existing frozen constants verbatim** (`index.template.html`, `seo-video-slicer.package.v1`, `scroll`, the current `LOCKED_ZONES`/`SAFE_ZONES`) so the scroll branch produces **byte-identical output**. `loop` selects `index.template.loop.html`, `seo-video-slicer.loop-package.v1`, `loop`, `{}` deps, and the loop zone arrays. The loop branch additionally writes the `loop` block and the loop README (§6.5 G6).
- **`verify.mjs`** reads `manifest.schema` **once** at the top and selects a `SCHEMA_CONFIG` object `{ schema, templateId, templateFilename?, lockedZones, safeZones, extraGates }`. **The scroll config equals today's `PACKAGE_SCHEMA`/`TEMPLATE_ID` constants** so the scroll path is logically unchanged. G4 reads `cfg.templateId` instead of the bare constant; G5 compares `manifest.schema` to `cfg.schema`; `extraGates` adds G8/G9 only for the loop schema.

This is the precise, deterministic shape of "additive branch"; it touches the constant *usage* (now via a config object) but the scroll config values are the existing frozen strings, proven byte-identical by the golden test (§13).

### 6.5 Gates (loop branch)

`verify.mjs` runs the gates below. **Gate ids are reused** (a loop package emits `G4` with loop-specific assertions, not a separate `G4′`), so `packager.parse_verify_output` and acceptance key on a stable set.

- **G1 — asset closure** (unchanged): every frame referenced by `index.html` exists in `frames/`.
- **G2 — contiguity** (unchanged): zero-padded contiguous `frame_000…frame_NNN` via the frozen 3-digit `FRAME_RE`; `count == frames.count`. (So `frames.count`, the on-disk count, and G8's ANMF count are one integer.)
- **G3 — self-contained** (unchanged): no external URLs; relative `./frames/…` only. Loop is pure rAF, so the GSAP exception is simply unused.
- **G4 — loop technique check** (loop-specific, **presence gate**): asserts the loop player markers — cover-fit render, DPR scaling, onerror-tolerant preload, a `prefers-reduced-motion` block, `data-template-id="seo-video-slicer.loop.v1"`, and the **positive time-driven markers**: `requestAnimationFrame` **and** an elapsed-time term (`performance.now()` or a timestamp delta). A regex cannot prove the index *formula*; G4 proves the time-term is **present**, and the actual time-driven loop is additionally proven by the in-browser Phase-0 check (§12) — not by G4 alone.
- **G5 — manifest + fingerprint parity** (config-keyed): `manifest.schema == cfg.schema`; recomputed 3-input fingerprint (with the loop `templateId`) `== manifest.fingerprint.value`.
- **G6 — docs** (loop README): a loop-specific `README.md` ≤200 lines containing the `Iframe` / `React` / `Vanilla` headings (so the frozen heading regex still passes) **plus** a two-tier `<img src="loop.webp">` embed section (§6.8). The loop builder generates it (the scroll README generator is untouched).
- **G7 — weight** (re-measured from disk): re-measures all package bytes from disk (does not trust `manifest.seo.total_bytes`), which now includes `loop.webp`. **Hard fails unchanged from v1 §4:** `frames.count > 200` **or** `frames.count < 1`. `loop.webp` over the per-file soft cap emits a **WARN** that names the file and never changes the exit code (mirroring v1's soft caps).
- **G8 — loop.webp structure + fps binding + whole-`loop`-block validation** (NEW, **coalescing-robust**): first validates the **entire `manifest.loop` block** (it already consumed `loop.fps`), closing the gap where a manifest could **lie** about a loop field that no other gate reads: `manifest.loop` is a present object; `loop.webp === "loop.webp"` (the frozen filename, **and the animated WebP is read from that manifest-declared name** so `"missing.webp"` fails); `loop.loop_count === 0`; `loop.fps` is a finite `> 0` number; `loop.webp_sha256` is a lowercase 64-char hex string (format only — G9 compares the value); and `loop.duration_s ≈ frames.count / loop.fps` (recomputed **the same way the builder computes it**, `build_package.mjs` §6.3 `duration_s = frameCount / fps`, with epsilon `abs(stored − recomputed) <= 1e-6` so `999` fails but legitimate packages pass). Then asserts `loop.webp` is a real **animated** WebP — RIFF/WEBP, a `VP8X` chunk with the `ANIM` flag, an `ANIM` chunk, and an `ANMF` frame-chunk count in the range `1 <= count <= frames.count`. The fps↔bytes binding is the duration **SUM**: walk every ANMF chunk's 24-bit little-endian **Frame Duration** field (ANMF payload offset 12) and assert `SUM(durations) == frames.count * perFrameMs(fps)`, where `perFrameMs(fps) = floor(1000/fps + 0.5)` (the FROZEN half-up formula — Node `Math.floor(1000/fps + 0.5)`, Python `math.floor(1000.0/fps + 0.5)` — IDENTICAL in `verify.mjs` and `loop_export.py`; CONTRACT-loop.md §2.1). The sum is invariant under encoder coalescing (§6.9), so it does **not** require one ANMF per frame. This **binds fps to the baked bytes**: a manifest-fps-only edit changes the expected sum; a re-encode or single-frame duration tamper changes the actual sum — either fails here even though the bytes (and G9) may be otherwise consistent. All `loop`-block validation lives **only** in the loop branch (`schema == loop-package.v1`); the scroll path and `fingerprint()` are byte-untouched. Parsed by walking RIFF chunks with `node:fs` (zero-dep). FAIL ⇒ non-zero.
- **G9 — loop.webp content integrity** (NEW): `sha256(loop.webp bytes) == manifest.loop.webp_sha256` via `node:crypto`. A re-encode (different bytes) fails here. FAIL ⇒ non-zero.

Together: re-encoding at a different fps changes the bytes (G9 fails) and the duration sum (G8 fails); editing only `manifest.loop.fps` leaves G9 green but changes G8's expected sum (G8 fails); tampering any single ANMF duration changes the actual sum (G8 fails); dropping/adding a baked frame moves both the on-disk count (G2) and the sum (G8). The gap §6.4 names is fully closed, and the binding survives encoder coalescing because it rests on the duration **sum**, not a per-frame count.

### 6.6 The loop player (required techniques)

`package-contract/index.template.loop.html` — Dark Instrument (`DESIGN.md`), brand-neutral near-black stage. Must implement all of:

1. Single `<canvas>` cover-fit render (`scale = max(cw/iw, ch/ih)`, centered) — no blurred background layer.
2. DPR scaling for retina sharpness.
3. Parallel preload with an `onerror`-tolerant counter — a 404 never freezes playback.
4. **Time-based rAF loop binding:** `frameIndex = Math.floor((elapsed / (1000/fps)) % frameCount)`, advancing via `requestAnimationFrame` against `performance.now()`. Zero external requests (no GSAP, ever).
5. `prefers-reduced-motion: reduce` ⇒ suppress the animation and render a single static hero frame.
6. `data-template-id="seo-video-slicer.loop.v1"` on the player root (anchors G4/G5).
7. System fonts only; inline CSS/JS; opens with no server; zero network requests.

### 6.7 The `loop.webp` export — a new Python primitive

`backend/app/loop_export.py` builds `loop.webp` from the contiguous WebP frame sequence using **Pillow** `Image.save(out, save_all=True, append_images=[...], duration=floor(1000/fps + 0.5), loop=0, method=6)` (the FROZEN `perFrameMs` formula, §6.9 / CONTRACT-loop.md §2.1). **ffmpeg `-c:v libwebp_anim`** (already a system prerequisite) is the documented fallback selected per §6.9. The Node kernel stays zero-dependency and never encodes. Note: libwebp coalesces byte-identical consecutive frames into one ANMF (summed duration); G8 verifies the duration **sum**, not a per-frame count (§6.9). Export runs in `build_and_verify` (loop mode, post fail-fast); its path is handed to the Node builder via `--loop-webp`.

> **Correction (§14.2):** the kickoff's claim that `build_package.mjs` produced `docs/assets/demo.webp` is false for the `demo.webp` half — the Node kernel only copies frames. `demo.webp` was committed as a pre-built binary. The real export primitive is defined here.

### 6.8 Two-tier delivery + weight accounting

A loop package ships **both** the frame sequence (+ canvas `index.html`) **and** `loop.webp`. This is deliberate; the loop README and docs must state it:

- **`loop.webp`** — a zero-JS drop-in: `<img src="loop.webp" loading="lazy">`. Simplest embed. **Ignores** `prefers-reduced-motion` (it's an `<img>`).
- **`index.html` (canvas + frames)** — DPR-crisp, controllable, **honors reduced-motion**. The tier that satisfies the accessibility rule.

**Weight:** `seo.total_bytes` includes `loop.webp`; G7 re-measures from disk. The only hard fails stay `frames.count > 200` / `< 1`; an oversized `loop.webp` is a soft WARN.

### 6.9 Phase-0 empirical check before cementing G8 — RESOLVED

**Spike outcome (Phase 0, on real frames):**

- **Encoder chosen: Pillow** (`Image.save(save_all=True, append_images=[...], duration=…, loop=0, method=6)`), the default. `ffmpeg libwebp_anim` is the documented fallback — but it does **not** honor a uniform per-frame duration the way the binding needs (it derives timing from `-framerate`/PTS), so Pillow with an explicit integer `duration` is the primitive that writes the exact per-frame value G8 expects.
- **Coalescing is real and unavoidable — G8 is therefore SUM-based.** The spike proved that **all** libwebp encoders (Pillow `save_all`, `ffmpeg libwebp_anim`, `img2webp`) **coalesce byte-identical CONSECUTIVE frames** into a single `ANMF` whose Frame Duration is the **sum** of the merged per-frame durations, and **no flag disables it**. A held-frame loop (a legitimate Remotion case) thus bakes **fewer ANMF chunks than input frames**. The earlier strict rule (`ANMF count == frames.count` AND every duration `== perFrameMs`) would **false-fail** such a loop. G8 instead binds fps to the **invariant duration sum**: `1 <= ANMF count <= frames.count` AND `SUM(durations) == frames.count * perFrameMs(fps)`. (Confirmed: 30 distinct frames → 30 ANMF, sum 2490; 3 leading byte-identical frames in a 5-frame variant → 3 ANMF `[249,83,83]`, sum still 415.)
- **Pinned per-frame formula (cross-language parity).** `perFrameMs(fps) = floor(1000/fps + 0.5)` (half-up, deterministic). Python's builtin `round` is banker's (half-to-even) and JS `Math.round` is half-up; at **fps 16** (`1000/16 == 62.5`) they diverge (62 vs 63) and G8 false-fails a clean loop. The `floor(x + 0.5)` form agrees in both languages (verified at fps 12, 13, 16, 24, 30) and is the FROZEN formula in `loop_export.py` (`math.floor(1000.0/fps + 0.5)`) and `verify.mjs` G8 (`Math.floor(1000/fps + 0.5)`) — see CONTRACT-loop.md §2.1.

This Phase-0 exit criterion (§12) is satisfied: the spike is resolved, the encoder is chosen, and G8 is defined against the real (coalescing) bytes with a deterministic cross-language formula.

---

## 7. The MCP server (Decisions 1 & 5)

### 7.1 Runtime & placement

A **Python** server using **FastMCP** (the official `mcp` SDK), at **`backend/app/mcp/`** — inside the installed `app` namespace so it can `import app.packager` / `app.slicing` directly *and* ride the wheel. It reuses `packager.build_and_verify()` with no extra subprocess beyond the kernel calls the packager already makes. (Runner-up: a Node server shelling out to the CLI — rejected; it re-shells `node→python→node` and duplicates arg handling.)

**Files:** `backend/app/mcp/__init__.py`, `backend/app/mcp/server.py` (the FastMCP instance + the two `@mcp.tool()` functions), and **`backend/app/mcp/__main__.py`** (`from .server import mcp; mcp.run()`) so `python -m app.mcp` works. The wheel already ships subpackages of `app` via `[tool.hatch.build.targets.wheel] packages=["app"]`, so `app.mcp` is included with **no** `pyproject` artifacts/packages change — only the `[mcp]` optional dep is added.

### 7.2 Transport & safety

**stdio.** **stdout is reserved for JSON-RPC** — all logging/diagnostics go to **stderr**. The server never prints to stdout outside the protocol.

### 7.3 Tools & error contract

```
slice_video(path: str, start: float|null, end: float|null, fps: float, mode: "scroll"|"loop", max_width: int|null)
    -> { package_dir: str, verify: VerifyResult, loop_webp: str|null }
slice_frames(dir: str, fps: float, mode: "scroll"|"loop", max_width: int|null)
    -> { package_dir: str, verify: VerifyResult, loop_webp: str|null }

VerifyResult = { pass: bool, gates: [ { id: str, pass: bool, detail: str } ] }
```

- `loop_webp` = the `loop.webp` path when `mode="loop"`, else `null`.
- **Gate failure** (a package built but a gate failed) ⇒ return `verify.pass=false` with the failing gates; the tool call itself succeeds (the agent inspects `verify`).
- **Non-gate failure** (bad/missing path, invalid `fps`/`max_width`, empty dir, ffmpeg/node missing, build crash — `packager` raises `ApiError`) ⇒ the tool **catches it and returns a structured error** `{ error: { code, message } }` (or raises `McpError`); nothing leaks to stdout. The CLI mirrors this mapping (`--json` error shape, exit `2`).

### 7.4 Distribution & registration (both clients)

- **Optional extra:** `pip install seo-video-slicer[mcp]` (adds `mcp` to `[project.optional-dependencies]`).
- **Claude Code** — `.mcp.json` (project scope) or `claude mcp add`:
  ```json
  { "mcpServers": { "seo-video-slicer": { "type": "stdio", "command": "python", "args": ["-m", "app.mcp"] } } }
  ```
- **Codex** — `~/.codex/config.toml` (TOML, *not* `.mcp.json`):
  ```toml
  [mcp_servers.seo-video-slicer]
  command = "python"
  args = ["-m", "app.mcp"]
  ```
- Both transports are stdio; **the registration files/formats differ** and both recipes ship in the README/examples.

### 7.5 Claude Code skill/command wrapper

A thin wrapper that calls the tools and adds ergonomics (summarize gates, point at the package dir, surface `loop_webp`). No logic the tools don't have.

### 7.6 Safety / threat model (path handling)

`slice_video` / `slice_frames` and the CLI `--out-dir` take **caller-supplied filesystem paths**. Trust stance, stated explicitly (not silent): this is a **local tool** invoked over stdio by a same-user caller (the agent runs as the user), so it operates with the caller's own filesystem permissions — there is no remote exposure and no sandbox. To avoid foot-guns and accidental traversal, inputs are still validated: reuse `backend/app/errors.py` `validate_data_subpath` / `validate_id`-style checks to reject `..`, NUL, and malformed components before filesystem access, resolve paths to absolute, and require the input path to exist. The README documents this trust model so a reader sees a decision, not an omission.

---

## 8. The Remotion recipe (Decision 4)

### 8.1 Ingest: both video and frames-dir

`slice <path>` accepts a video (existing pipeline) **or** a directory of frames. Remotion's `render --sequence` emits **PNG** (default, alpha) or JPEG; our kernel requires contiguous **WebP**.

### 8.2 PNG/JPEG → WebP conversion (handles Remotion's real naming)

Remotion `--sequence` names frames `element-NNNN.png` (zero-padded, width depends on total count; the first index may be non-zero) — **not** `frame_*`, and a naive lexicographic sort breaks (`element-10` before `element-2`). The new `slicing.convert_frames_to_webp(src_dir, dst_dir, quality)`:

1. Globs **`*.png` / `*.jpg` / `*.jpeg` / `*.webp`** (broad; also matches legacy `frame_*`).
2. Sorts **numerically by the trailing integer** in each filename (so `element-2` precedes `element-10`).
3. Renumbers to **contiguous `frame_000.webp …`** (3-digit) via the existing Pillow primitive (`Image.open(...).convert("RGB").save(dst, "WEBP", quality=q, method=6)`), optionally downscaling sources wider than `max_width` with LANCZOS first.
4. Errors clearly on an empty dir, or ambiguous/mixed sets where no consistent integer ordering exists.

This is a standalone helper (not folded into `finalize_to_webp`) so Remotion ingest is decoupled from the JPEG-preview path.

### 8.3 The `examples/remotion/` project (runs on a clean clone)

Lives under the existing plural **`examples/`** (the repo also has a singular `example/` holding `sample-package/`; the plural is the right home for new examples). Contents:

```
examples/remotion/
├── README.md            # prerequisites + the render → slice → embed flow
├── package.json         # remotion deps
├── remotion.config.ts   # PNG sequence; pins outputName to frame_[frame] (zero-padded) for clean ingest
├── src/                 # a tiny hero composition (a few-second motion)
└── Makefile             # targets: setup, render-sequence, slice-package
```

**Clean-clone invocation (review fix):** the `seo-video-slicer` console-script is not on `PATH` on a fresh checkout. The `Makefile` makes this explicit: a `setup` target (create/activate the project venv and `pip install -e backend[mcp]`, or `uvx`/`pipx`), and `slice-package` invokes the slicer via the venv (`python -m app.cli slice ...`). The example README lists prerequisites: `node`, `ffmpeg`, Python 3.10+, and `npx remotion`. Documented flow:

```bash
make -C examples/remotion setup
npx remotion render <comp> out/ --sequence --image-format=png   # emits element-NNNN.png by default
python -m app.cli slice ./out --fps 12 --mode loop --out-dir ./pkg
# embed: copy ./pkg into your app's public/ and use index.html (canvas) or loop.webp (<img>)
```

(`remotion.config.ts` may instead pin `frame_[frame]` output; either way the ingest helper handles `element-NNNN` and `frame_NNN`.)

---

## 9. Packaging / wheel changes

- **Bundle the loop template:** `scripts/build-wheel.sh` today `cp`s exactly four files into `backend/app/_kernel/` (`build_package.mjs`, `verify.mjs`, `index.template.html`, `CONTRACT.md`). Extend that `cp` set to also copy **`index.template.loop.html`** and — for parity with the bundled `CONTRACT.md` — **`CONTRACT-loop.md`**. This is the single edit point; forgetting it makes wheel loop builds fail in `loadTemplate()` (the template-missing `die` path).
- **Optional MCP dep:** `[project.optional-dependencies] mcp = ["mcp"]` in `backend/pyproject.toml`.
- **No new console-scripts:** the `slice` subcommand lives under the existing `seo-video-slicer` entry; the MCP server runs via `python -m app.mcp`.
- **Kernel discovery:** unchanged mechanism (`SVS_KERNEL_DIR`), now resolved by the shared `_resolve_bundled_paths()` (§5.2). A Phase-2 check confirms a wheel-installed loop build resolves `index.template.loop.html`.

---

## 10. Public interfaces (consolidated)

### 10.1 CLI — §5.1; exit codes §5.3.

### 10.2 MCP / `--json` shape — §7.3. The CLI `--json` output is the identical object: `{ package_dir, verify: { pass, gates:[{id,pass,detail}] }, loop_webp }` (or `{ error: { code, message } }`).

### 10.3 Loop manifest — canonical example (internally consistent)

```json
{
  "schema": "seo-video-slicer.loop-package.v1",
  "id": "hero-loop",
  "created_at": "2026-06-02T18:00:00Z",
  "source": { "duration_s": 2.5, "fps_effective": 12, "resolution": "1280x720", "origin": "remotion --sequence" },
  "frames": { "count": 30, "pattern": "frames/frame_NNN.webp", "format": "webp", "quality": 82 },
  "player": {
    "canonical": "index.html",
    "interaction": "loop",
    "dependencies": {},
    "reduced_motion": true,
    "template_id": "seo-video-slicer.loop.v1"
  },
  "loop": { "fps": 12, "duration_s": 2.5, "webp": "loop.webp", "webp_sha256": "…", "loop_count": 0 },
  "customization": { "locked_zones": ["…"], "safe_zones": ["…"] },
  "seo": { "lcp_safe": true, "total_bytes": 0, "lazy_loadable": true },
  "fingerprint": { "algorithm": "sha256", "value": "<sha256(frames, \"\", \"seo-video-slicer.loop.v1\")>" }
}
```

`source.duration_s` for a frames-dir = `frames.count / fps` (= 2.5; a Remotion frames-dir has no inherent source length). `seo.lcp_safe` for loop is **weight-derived** — `true` iff `total_bytes ≤ ~4 MB` (the §4 soft cap), *not* the frozen literal `true` of scroll; so a heavy full-resolution loop honestly reports `false` (the field is informational/ungated, as in v1). `locked_zones` for loop = the v1 set **plus** `"loop.webp bytes"` and `"loop fps"` (both downstream-immutable, gated by G8/G9); `safe_zones` drop `"scroll distance"` and may add `"loop container size"`. Exact arrays frozen in `CONTRACT-loop.md`.

### 10.4 Gates — §6.5 (G1–G7 adapted, G8/G9 new).

---

## 11. Ownership boundaries & file map (Phase-1 lane isolation)

| Lane | Owns (creates/edits) | Does NOT touch |
|---|---|---|
| **Loop kernel** (Phase 0) | `package-contract/index.template.loop.html`, `package-contract/CONTRACT-loop.md`, the `MODE_CONFIG`/`SCHEMA_CONFIG` dispatch + loop branch (incl. loop README generator, G8/G9, adapted G4) in `package-contract/build_package.mjs` + `verify.mjs`, **`backend/app/loop_export.py`** (the loop.webp primitive, needed to build & gate the golden loop package), loop + golden cases in `package-contract/test-kernel.mjs` | the scroll config values; the `fingerprint()` body |
| **Headless CLI** (Phase 1) | `backend/app/slice_cli.py`, the `slice` subcommand + shared `_resolve_bundled_paths()` in `backend/app/cli.py`, CLI tests | the kernel; the MCP server |
| **Packager integration** (Phase 1) | the `mode` param (internally bakes `loop.webp` via `loop_export`) + return-dict additions (`package_dir`, `loop_webp`) in `backend/app/packager.py`, packager tests | the loop primitive (Phase 0 owns it); the player template; the CLI front-door |
| **MCP server** | `backend/app/mcp/` (`__init__`, `server`, `__main__`), `[mcp]` extra in `pyproject.toml`, the CC skill wrapper, MCP smoke test | `slicing`/`packager` internals (imports only) |
| **Remotion recipe** | `examples/remotion/`, `slicing.convert_frames_to_webp`, docs recipe | the kernel; the MCP server |

The kernel `--mode` dispatch and `loop_export.py` land in **Phase 0** (they are needed to build and gate the golden loop package). The `packager.py` `mode` integration lands **early in Phase 1** to unblock the CLI/MCP lanes. Lanes otherwise write disjoint files.

## 11.1 Required tests (named)

- `convert_frames_to_webp`: empty dir (error), mixed PNG/JPEG, **numeric sort** on `element-0…element-12`, non-zero first index, duplicate trailing index error, renumber-to-contiguous, `max_width` downscale/no-upscale.
- `loop_export`: **duration sum on real frames** (§6.9: coalescing collapses byte-identical consecutive frames, so assert `SUM(ANMF durations) == frames.count * perFrameMs`, not one-ANMF-per-frame), exact `perFrameMs(fps) = floor(1000/fps + 0.5)`, sha stability.
- Kernel self-test: scroll **golden-package byte-diff** (every output file, excl. `id`/`created_at`; pinned fingerprint within it — §13); loop build→verify pass; **fps=16 parity** (bytes baked at 63 ms, G8 PASSES) and a **held-frame coalesced loop** (ANMF < frames, sum-based G8 PASSES); corrupt frame / `webp_sha256` / ANMF-duration-sum / manifest-fps each fail the matching gate.
- CLI: exit-code matrix (§5.3) — gate pass, gate fail, bad input, invalid `--max-width`, `--no-verify`; video/frames `max_width` manifests; 1080p loop cap makes a lighter `loop.webp`.
- MCP: gate-fail returns `verify.pass=false`; non-gate error returns the structured `error` shape (no stdout leak); `max_width` parity with CLI.

---

## 12. Build sequence — contract-first workflows

**Phase 0 — loop kernel (one workflow → then SEE it).** **Do the encoder spike FIRST (§6.9):** on real frames, characterize how the chosen encoder bakes ANMF chunks and durations — *before* building G8 around it. **Resolved (§6.9):** Pillow is the default; all libwebp encoders **coalesce** byte-identical consecutive frames (fewer ANMF, summed duration), so G8 is **sum-based** (`1 <= ANMF count <= frames.count` AND `SUM(durations) == frames.count * perFrameMs(fps)`) with the FROZEN cross-language `perFrameMs(fps) = floor(1000/fps + 0.5)`. Then freeze `loop.v1`: template + `MODE_CONFIG`/`SCHEMA_CONFIG` dispatch + loop branch (G8/G9, adapted G4, loop README) + `CONTRACT-loop.md` + `loop_export.py` + the reference loop player. **Gate with negative-corruption tests for both templates** (corrupt a frame, the sha, an ANMF duration sum, edit the manifest fps ⇒ the matching gate fails) **plus the positive regressions** (fps=16 cross-language parity; a held-frame coalesced loop where ANMF < frames PASSES the sum-based G8) **and a scroll golden-package byte-diff** (byte-identical output excl. per-build `id`/`created_at`; any scroll drift fails). Then **open the loop player in a browser (chrome-devtools MCP)** and confirm it loops with **zero external requests**. Exit criteria: spike resolved, all gated, golden green, *and* seen looping offline.

**Phase 1 — parallel build lanes (one workflow).** Four disjoint-file lanes per §11.

**Phase 2 — integrate & verify (one workflow).** MCP end-to-end against a **real Remotion `--sequence` render**; assert the returned package passes `verify.mjs`; smoke the CLI both ways × both modes; confirm a **wheel-installed** loop build resolves the bundled template; run the **regression-context grep** (§14.3); `make test` + CI green. A structured-output verify agent reports any silent caps / dropped coverage.

The advisor is consulted before committing this spec and before each implementation workflow.

---

## 13. Acceptance (the 5-star bar)

- **Contract safety:** the **scroll OUTPUT is byte-identical** — `test-kernel.mjs` builds a fixed scroll package from fixed frames and **byte-diffs every output file** (`index.html`, `manifest.json`, `README.md`, `PROMPT.md`) against a committed golden, excluding only the per-build `id`/`created_at` fields; the pinned `manifest.fingerprint.value` is part of that golden. (Fingerprint parity alone is **weaker** than byte-identity — it does not cover README bytes, manifest key order, or the `FRAMES` injection, all of which the `MODE_CONFIG`/`SCHEMA_CONFIG` refactor touches.) `CONTRACT.md` is byte-unchanged. (The `.mjs` files legitimately gain a loop branch; the *scroll output* is what stays fixed.)
- **Loop gates:** build a loop package → `verify.mjs` passes; corrupting a frame, `webp_sha256`, an ANMF duration, or the ANMF count each fails its gate; editing `manifest.loop.fps` alone fails G8.
- **Loop player:** opens offline and loops; **zero** network requests (verified in-browser); reduced-motion shows a static frame.
- **CLI:** `slice <video>` and `slice <frames-dir>`, both modes, produce passing packages; exit codes per §5.3; `--json` returns the §10.2 shape.
- **MCP:** tools over stdio return passing packages and the structured error shape on non-gate failures; registered/callable from Claude Code; Codex recipe documented.
- **Remotion:** `examples/remotion/` renders `--sequence` and slices to a passing package via `make` on a clean clone (with the documented `setup`).
- **CI/tests:** `make test` green (pytest + kernel self-test + frontend build); CI green; §11.1 tests present.
- **Docs:** README + recipe explain the pipeline, the two-tier embed, prerequisites, and **both** client registrations — at the existing polish bar; no stale context (§14.3).

---

## 14. Source anchors, reuse map & corrections

### 14.1 Reuse map (verified accurate at authoring; cite by symbol)

| Use | Symbol (file:line) |
|---|---|
| Frame extraction (ffmpeg, trim, fps) | `slicing.extract_preview` (`backend/app/slicing.py:43`) |
| JPEG→WebP finalize + reindex + resolution | `slicing.finalize_to_webp` (`backend/app/slicing.py:98`) |
| Package assemble + gate (shells kernel) | `packager.build_and_verify` (`backend/app/packager.py:54`) |
| Parse gate output → gates[] | `packager.parse_verify_output` (`backend/app/packager.py:154`) |
| Slug sanitize | `packager.sanitize_slug` (`backend/app/packager.py:40`) |
| Budget constants (200 hard cap, q82–90) | `backend/app/config.py` (`MAX_SLICE_SECONDS`, `WEBP_QUALITY`, `FRAME_COUNT_HARD_MAX`) |
| Path validators (threat model §7.6) | `backend/app/errors.py` (`validate_data_subpath`, `validate_id`) |
| Fingerprint recipe (reuse verbatim) | `fingerprint()` in `package-contract/build_package.mjs:36` + `package-contract/verify.mjs:22` |
| Template load + `data-template-id` read | `loadTemplate()` in `package-contract/build_package.mjs:140` |
| Bundled-kernel env resolution | `cli.py:main` (`backend/app/cli.py:29`) — factor into `_resolve_bundled_paths()` |
| Wheel kernel bundling (4-file `cp`) | `scripts/build-wheel.sh:18` |

### 14.2 Doc corrections (root-cause the drift)

- **`docs/plans/remotion-companion-kickoff.md:27`** claims `build_package.mjs` built **both** `example/sample-package/` **and** `docs/assets/demo.webp`. The **sample-package half is true** (the kernel builds the scroll sample); the **`demo.webp` half is false** (the zero-dep Node kernel cannot emit an animated WebP; `demo.webp` was committed as a pre-built binary). **Done (2026-06-02):** the kickoff line now drops the `demo.webp` claim and points at the real export primitive (§6.7).

### 14.3 Regression-context guard (new code)

Phase 2 greps the new code for stale/forbidden patterns per `CONTRACT.md` §7.1 (`INPAINT_TELEA` outside the fallback, GSAP-studio framing, `experience` trigger/effect/easing metadata, the stale schema/template ids, `DEBUG`/`print` debug output) and fails if any leaked into the CLI / MCP / loop kernel.

---

## 15. Open implementation choices (resolved in the relevant workflow; one can block Phase 0)

- **`loop.webp` encoder (Pillow vs ffmpeg `libwebp_anim`)** — **RESOLVED (§6.9): Pillow is the default.** The Phase-0 spike found that all libwebp encoders coalesce byte-identical consecutive frames (no flag disables it), so G8 is **sum-based** rather than one-ANMF-per-frame; Pillow writes the exact uniform per-frame `perFrameMs(fps) = floor(1000/fps + 0.5)` the binding needs. ffmpeg `libwebp_anim` remains the documented fallback.
- Exact byte layout of `index.template.loop.html` — authored in Phase 0 to the §6.6 markers.
- Final `locked_zones`/`safe_zones` and `player.dependencies` value for loop — frozen in `CONTRACT-loop.md` during Phase 0.
- Whether `remotion.config.ts` pins `frame_[frame]` output or relies on the ingest helper's `element-NNNN` handling — the example pins it for a clean happy path; the helper handles both.
