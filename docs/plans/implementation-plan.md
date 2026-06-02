# SEO Video Slicer — Implementation Plan

**Status:** Plan v1 (executable by the implementation workflow)
**Date:** 2026-06-01
**Authority:** [`docs/specs/seo-video-slicer-spec.md`](../specs/seo-video-slicer-spec.md) — this plan sequences spec §11 (build sequence), §10 (cherry-pick map), §10.1 (do-not-port), §8 (package contract).
**Build philosophy:** Contract-first. Phase 0 locks the package contract + `verify.mjs` gates + reference `index.html` player as a **self-verifying golden fixture**. Every later phase builds to pass that fixture's `verify.mjs`.

---

## How to read this plan

- Each phase has a fixed field set: **Goal · Targets · Cherry-pick anchors · Regression to strip · TDD checkpoints · Acceptance.** Field order is uniform so the workflow can parse it.
- **Cherry-pick anchors** are `file:line` in `smart-image-animations` (verified present). They are *patterns re-implemented clean*, never copy-paste.
- **Regression to strip** cites the exact §10.1 row(s) the phase touches.
- The **Task Graph** at the end is the fan-out unit: discrete task IDs, explicit deps, parallel lanes marked, anti-regression grep gate last.

### Frozen cross-phase contracts (defined in Phase 0, referenced by name elsewhere — never redefined)

| Contract | Frozen value | Consumers |
|---|---|---|
| `PACKAGE_SCHEMA` | `"seo-video-slicer.package.v1"` | manifest writer (P4), verify G5 (P0) |
| `FINGERPRINT_RECIPE` | `sha256( JSON.stringify({ frames: [basename...], gsap: <cdn url or "">, templateId: <data-template-id> }) )` over the player + frame list. The player **must** emit a stable generic `data-template-id="seo-video-slicer.scroll.v1"` so `templateId` resolves identically in both implementations. **Byte-for-byte identical** in P0 `verify.mjs` and P4 packager, or G5 fails. | verify G5 (P0), packager (P4) |
| `LOCKED_ZONES` / `SAFE_ZONES` | per spec §8 manifest schema (locked: frame bytes, zero-pad ordering, cover-fit single-canvas, reduced-motion; safe: accent, copy, scroll distance, easing, container height, framework wrapper) | manifest writer (P4) |
| `WEIGHT_BUDGET` | total soft-cap ≈ **4 MB**; per-frame soft-cap (flag oversized). Single source constant. | verify G7 (P0), budget meter (P1/P6) |
| `FRAME_NAMING` | `frame_NNN.webp`, zero-padded 3-digit, contiguous from `000` | webp/rename (P2), verify G1/G2 |
| `SLICE_CONSTANTS` | `DEFAULT_SLICE_SECONDS = 10`, `MAX_SLICE_SECONDS = 60` — backend config, frontend mirror. **No literal 10/60 anywhere else.** | slice (P1), budget meter (P1/P6) |
| `FRAME_BUDGET` | hero lane 20–80 frames; long-form up to ~200 with warnings; auto-suggest lower fps as duration rises | budget meter (P1/P6), verify G2/G7 |

---

## Phase 0 — Package Contract + verify.mjs + Reference Player (LOCK FIRST)

**Goal:** Produce a hand-built **golden fixture package** that is internally closed and self-verifying: real frames + real `manifest.json` + the reference `index.html` player + `verify.mjs`, where `node verify.mjs` exits 0 **and** the player opens-and-animates offline. This fixture is the reusable acceptance target for P4 (packager output must match its shape), P8 (end-to-end compares against it), and P9 (ships as the sample package + CI subject).

**Targets:**
- `package-contract/verify.mjs` — Node, **zero deps**, gates G1–G7 (below). Exits non-zero on any failure.
- `package-contract/index.html` — the ONE reference player template (placeholder frame list).
- `package-contract/manifest.schema.md` — documents `PACKAGE_SCHEMA`, `FINGERPRINT_RECIPE`, `LOCKED_ZONES`/`SAFE_ZONES`, written once and frozen.
- `fixtures/sample-animation/` — hand-assembled golden package: 5 real WebP frames (`frame_000…frame_004.webp`), `manifest.json`, `index.html`, `verify.mjs`, `README.md`, optional `PROMPT.md`.
- `package-contract/README.template.md` + `PROMPT.template.md` — the ≤200-line README recipe (Iframe / React / Vanilla headings) and the optional drop-in prompt.

**verify.mjs gates (= acceptance tests, spec §8):**
| Gate | Checks |
|---|---|
| G1 | Every `frame_NNN.webp` referenced by `index.html` exists in `frames/` (asset closure). |
| G2 | Frames zero-padded contiguous `frame_000…frame_NNN`; count == `manifest.frames.count`. |
| G3 | `index.html` self-contained: no `http(s)://…/<local-asset>` leaks, no scratch/localhost paths; relative `./frames/…` only (GSAP CDN is the sole permitted external URL). |
| G4 | `index.html` contains cover-fit render, DPR scaling, preload-with-`onerror`, a `prefers-reduced-motion` block, and a `data-template-id="seo-video-slicer.scroll.v1"` attribute. |
| G5 | `manifest.json` parses; has `schema` (== `PACKAGE_SCHEMA`) + `fingerprint`; fingerprint matches recompute via `FINGERPRINT_RECIPE`. |
| G6 | `README.md` exists, ≤200 lines, has Iframe / React / Vanilla headings. `PROMPT.md` optional. |
| G7 | Total package weight ≤ `WEIGHT_BUDGET`; each WebP ≤ per-frame cap (flag oversized). |

**`index.html` locked techniques (spec §8):** single `<canvas>` cover-fit (`scale = max(cw/iw, ch/ih)`, centered, no blurred bg layer); DPR scaling; parallel preload with `onerror`-tolerant counter (404 never freezes); frame index = scroll progress × (frameCount−1); `prefers-reduced-motion: reduce` → static hero frame; a stable generic `data-template-id="seo-video-slicer.scroll.v1"` attribute (consumed by `FINGERPRINT_RECIPE`); system fonts; inline CSS/JS. **Preferred:** no-dependency rAF/scroll fallback (zero external requests). GSAP ScrollTrigger from cdnjs is the *only* permitted external request and must be optional.

**Cherry-pick anchors:**
- Canvas cover-fit scroll player ← `backend/app/animation_templates.py` (`apple_scroll_zoom` template) — **distill to ONE clean `index.html`**, no template registry.
- `verify.mjs` + fingerprint pattern ← `frontend/public/templates/packages/webp_guided_knowledge_2026/verify.mjs:1-60` — **take the gate/fingerprint structure**, rewrite gates to §8.

**Regression to strip (§10.1):**
- **Multi-doc package ceremony** — source verify.mjs requires `INTEGRATION.md`, `INSTRUCTIONS.llm.md`, and the `webp_guided_knowledge_2026/` doc pile (`VIDEO_PROMPT.md`, `USE_CASES.md`, `VARIANTS.md`, `design-tokens.css`, `component/animation.tsx`). Replace with the lean §8 set: `index.html` + `manifest.json` + `verify.mjs` + `README.md` + optional `PROMPT.md`.
- **Stale schema string** — source uses `smart-image-animations.deliverable-package.v1` and `animation.html` / `data-template-id="webp_guided_knowledge_2026"`. Ours is `seo-video-slicer.package.v1`, player file `index.html`. Strip the stale *value* `webp_guided_knowledge_2026` — keep the `data-template-id` *attribute* with our generic value `seo-video-slicer.scroll.v1` (required by `FINGERPRINT_RECIPE`).
- **GSAP-studio metadata** (`trigger`/`effect`/`easing`/`prompt`) — manifest is the fresh §8 schema; none of these fields.

**TDD checkpoints:**
- `verify.mjs` run against the golden fixture exits **0** (all gates green) — committed as the passing baseline.
- Negative tests: corrupt the fixture 7 ways (remove a frame, break zero-pad, inject an `http://` local asset, strip the reduced-motion block, tamper fingerprint, blow the weight budget, drop a README heading) → each makes exactly the matching gate fail and `verify.mjs` exit non-zero.
- Fingerprint recompute is deterministic and stable across runs.

**Acceptance:**
- Open `fixtures/sample-animation/index.html` directly in a browser (no server) → it animates on scroll, offline, zero external requests (or GSAP-CDN only), reduced-motion shows a static hero frame.
- `node fixtures/sample-animation/verify.mjs` exits 0.
- Contract docs frozen; downstream phases reference contracts by name.

---

## Phase 1 — Backend Core (FastAPI skeleton, upload, slice)

**Goal:** Single-process FastAPI app: upload a video, generate a thumbnail, preview-extract JPEG frames, finalize selection, serve static frames. TDD against ffmpeg.

**Targets:**
- `backend/app/main.py` — FastAPI app, CORS, static mount (`/data/...`), router wiring.
- `backend/app/config.py` — `SLICE_CONSTANTS` (`DEFAULT_SLICE_SECONDS=10`, `MAX_SLICE_SECONDS=60`), `WEIGHT_BUDGET`, `FRAME_BUDGET`, paths, port `5179`. One source of truth.
- `backend/app/jobs.py` — `JobStore` + job meta (id, data_dir, source meta). In-memory + on-disk, no DB.
- `backend/app/media/extract.py` — `upload`, `generate_video_thumbnail`, `generate_preview` (ffmpeg `fps` filter → JPEG preview frames), `finalize` (select frames).
- `backend/app/budget.py` — frame-count + projected-weight calculator; fps auto-suggest to keep within `FRAME_BUDGET`.
- Endpoints: `POST /upload`, `GET /jobs/{id}`, `POST /jobs/{id}/slice/preview {start,end,fps}`, `POST /jobs/{id}/slice/finalize {preview_id,selected}`, `GET /data/...`.
- `backend/requirements.txt` (fastapi, uvicorn, opencv-python-headless, pillow, numpy; ffmpeg is system binary).

**Cherry-pick anchors:**
- Frame extraction + preview cleanup ← `slicing.py:12-130` — keep, lean.
- Finalize / select frames ← `slicing.py:66-95` — keep.
- Thumbnail ← `slicing.py:559-587` — keep.

**Regression to strip (§10.1):**
- **Hardcoded `if (end - start) > 10.0` wall** (`slicing.py:14`) → replace with `MAX_SLICE_SECONDS` ceiling + `budget.py` frame/weight check (spec §5.1). No literal 10/60 outside `config.py`.
- **`DEBUG`/`print(...)` logging** (`slicing.py:440,447-449` and passim) → real `logging`, no `print("DEBUG: ...")`.
- **4-format frame sprawl** — preview stage emits **JPEG only**; do not carry `.jpg/.jpeg/.webp/.png` checks. One format per stage.
- **No** `/ai/*`, `/experiences/*`, `/context/*`, model-selection endpoints (spec §9).

**TDD checkpoints (deterministic, pytest):**
- Upload accepts a fixture mp4 → returns `{id}` + thumbnail file exists.
- `slice/preview` with `(start,end,fps)` produces the expected JPEG frame count; out-of-range `end` clamps to `MAX_SLICE_SECONDS`.
- `budget.py`: `(duration × fps)` → frame count + projected bytes; auto-suggest lowers fps when projected frames exceed `FRAME_BUDGET`.
- `finalize` drops excluded indices; remaining frames re-indexed contiguously.

**Acceptance:** app boots on `:5179`; upload → preview → finalize round-trips on a real test clip; budget meter math matches spec §5.1 thresholds; no `print`/DEBUG; no AI endpoints.

---

## Phase 2 — Slicing Ops (crop + watermark enforcer, WebP, rename)

**Goal:** Auto/manual crop with the watermark symmetry enforcer, WebP conversion (q82–90), and zero-padded SEO rename — producing `FRAME_NAMING`-compliant frames.

**Targets:**
- `backend/app/media/crop.py` — manual crop box + OpenCV auto-crop (contour/threshold); **watermark symmetry enforcer** + portrait/landscape safety margin.
- `backend/app/media/webp.py` — Pillow/OpenCV WebP convert at quality 82–90.
- `backend/app/media/rename.py` — zero-padded `frame_NNN.webp` normalization + SEO prefix.
- Endpoints: `POST /jobs/{id}/slices/{sid}/crop {manual_crop|auto}`, `POST /jobs/{id}/slices/{sid}/webp`, `POST /jobs/{id}/slices/{sid}/rename {prefix}`.

**Cherry-pick anchors:**
- Auto-crop + **watermark symmetry enforcer** ← `slicing.py:159-306` (enforcer verified at `slicing.py:261-296`) — keep the OpenCV deterministic crop + symmetry/safety-margin logic.
- WebP convert + zero-pad rename ← `slicing.py:437-510`.

**Regression to strip (§10.1):**
- **AI/Gemma crop branch** (`from .ai import AIClient`, `ai_client.analyze_image` at `slicing.py:164,204-221`) → port **only** the OpenCV path. No MLX/Gemma/AIClient references anywhere.
- **`resize_factor = 1.0 # Optimize if needed`, commented hints, dead vars** (`slicing.py:211`) → drop.
- **4-format sprawl** — package stage is **WebP only**.
- **`print` enforcer logs** (`slicing.py:269,289,294,297`) → `logging`.

**TDD checkpoints (deterministic):**
- Symmetry enforcer: left-crop > 20px and right-crop < 20px → forces symmetric right crop (the watermark case). Unit-test the exact `min_x/max_x/min_y/max_y` math against fixtures.
- Portrait → forces bottom-side 80px crop when bottom margin < 20; landscape → right-side. Assert numeric outputs.
- WebP output decodes; quality in [82,90]; dimensions match crop box.
- Rename yields contiguous `frame_000…frame_NNN.webp`, lexicographically sortable (verify G2 passes on output).

**Acceptance:** auto-crop removes a Veo right-edge watermark via the enforcer with no AI call; converted frames are valid WebP within budget; renamed frames pass G1/G2/G7 of the contract `verify.mjs`.

---

## Phase 3 — Premium Two-Tier Erase

**Goal:** Replace single-pass Telea with the two-tier erase engine (spec §6): **premium LaMa/IOPaint** when importable, **enhanced OpenCV** baseline otherwise — both with feathered mask edges + temporal coherence. Auto-select and label the tier used.

**Targets:**
- `backend/app/media/erase.py` — `erase_region(...)` dispatcher; tier selection (premium if `iopaint` importable, else baseline); feathered mask builder; temporal-coherence pass (propagate/blend the inpaint region across consecutive frames to kill shimmer).
- `backend/app/media/erase_baseline.py` — enhanced OpenCV: `INPAINT_NS` (and `cv2.xphoto` if available), edge-aware feathered mask, adaptive radius, temporal pass. No torch, offline, always available.
- `backend/app/media/erase_premium.py` — LaMa via `iopaint`/`simple-lama-inpainting`, MPS/CPU, model auto-download on first use.
- `backend/requirements-premium.txt` — torch/iopaint kept **out** of default install.
- Endpoint: `POST /jobs/{id}/slices/{sid}/erase {x,y,w,h, tier?}` → `{tier_used, erased}`.

**Cherry-pick anchors:**
- Erase (inpaint) ← `slicing.py:512-556` — **upgrade**: take the per-frame iterate + mask-rect structure, replace the engine.

**Regression to strip (§10.1):**
- **Telea inpaint as primary erase** (`slicing.py:545`, `cv2.INPAINT_TELEA`) → demoted; baseline uses `INPAINT_NS`. `INPAINT_TELEA` must not appear as the default path (the anti-regression grep allows it **only** inside an explicitly-labeled fallback, or not at all — prefer `INPAINT_NS`).
- **4-format check** (`slicing.py:526`) → WebP-only in package stage.
- **`print` erase logs** (`slicing.py:553,555`) → `logging`.

**TDD checkpoints:**
- *Deterministic (baseline tier):* mask geometry clamps to frame bounds; feather kernel applied; output frame dimensions unchanged; temporal pass blends region consistently across a synthetic 3-frame fixture (assert pixel-region variance below threshold).
- *Smoke (premium tier):* if `iopaint` importable, `erase_region` returns `tier_used="premium"` and writes valid frames; if not importable, returns `tier_used="baseline"` (no crash, no torch import attempted on default install).
- *Visual acceptance (manual, per §6):* on a watermarked Veo clip, premium tier removes the watermark with **no visible smear or frame-to-frame shimmer at 1× and 2× zoom**. Not pixel-exact unit-tested.

**Acceptance:** tier auto-selected and labeled in the response/UI; baseline works on a clean default install (no torch); premium passes the §6 manual no-smear/no-shimmer review when IOPaint present.

---

## Phase 4 — Packager (build contract package, portable paths, zip, run verify.mjs)

**Goal:** Assemble the spec §8 package from a finished slice, write `manifest.json` + relative-path `index.html` + `README.md` + optional `PROMPT.md`, zip it, **run `verify.mjs` and refuse to declare success on failure**, expose download.

**Targets:**
- `backend/app/packager.py` — copy frames → `frames/`; render `index.html` from the P0 template with the real frame list; write `manifest.json` (schema, source meta, frames, player, `LOCKED_ZONES`/`SAFE_ZONES`, seo, fingerprint via `FINGERPRINT_RECIPE`); write `README.md` from `README.template.md`; optional `PROMPT.md`; zip.
- `backend/app/verify_runner.py` — shells `node verify.mjs` inside the built package; parses exit code + gate report; package build fails if non-zero.
- Endpoints: `POST /jobs/{id}/slices/{sid}/package {slug,accent?,copy?}` → builds + zips + runs verify; `GET /jobs/{id}/slices/{sid}/package/download` → `package.zip`.

**Cherry-pick anchors:**
- Package builder + portable relative-path rewrite ← `main.py:271-341`, `slicing.py:423-435` — adapt to §8 contract.
- Fingerprint + verify pattern ← P0 `verify.mjs` (reuse the exact `FINGERPRINT_RECIPE`).

**Regression to strip (§10.1):**
- **Legacy `const baseUrl` regex** ("patch from older templates", `main.py:288`) → dead compat path; **do not port**. Paths are relative `./frames/...` by construction.
- **Old "experience" meta fields** (`trigger`/`effect`/`easing`/`prompt`/GSAP, `slicing.py:374-384`) → manifest is the fresh §8 schema; none of these.
- **Multi-doc ceremony** — emit only the §8 file set.

**TDD checkpoints:**
- Built package directory matches the P0 golden fixture **shape** (same file set, same `frame_NNN.webp` pattern).
- `manifest.json` validates against `PACKAGE_SCHEMA`; `LOCKED_ZONES`/`SAFE_ZONES` exactly per §8.
- **Fingerprint parity:** packager-computed fingerprint == `verify.mjs` recompute (G5 green). Regression test asserts both implementations agree on a fixture.
- `index.html` contains only relative `./frames/...` refs (no absolute/scratch paths) — G3 green.
- `verify_runner` propagates a non-zero `verify.mjs` exit as a build failure (negative test).

**Acceptance:** `POST .../package` on a real slice produces a zip whose `node verify.mjs` exits 0; download returns it; a tampered build (e.g. mismatched fingerprint) fails the build, not silently ships.

---

## Phase 5 — Dark Instrument Design Lock (PRODUCT.md/DESIGN.md/theme.css)

**Goal:** Establish the current product brand as a lean, dark technical instrument: `PRODUCT.md` defines the product/non-goals, `DESIGN.md` is the design-system narrative, and `frontend/src/styles/theme.css` is the 1:1 token implementation. **Independent of P1–P4 — runs in parallel.**

**Targets:**
- `PRODUCT.md` (repo root) — authored fresh for seo-video-slicer: developer/designer users, token-burn-free WebP package purpose, expert concise voice, and explicit non-goals.
- `DESIGN.md` (repo root) — the current dark design system of record: Void Black canvas, Panel Deep surfaces, Hairline seams, Ink text tokens, one Electric Blue accent, system sans + ui-mono.
- `frontend/src/styles/theme.css` — the authoritative implementation of those tokens. `DESIGN.md` and `theme.css` must stay aligned.

**Tokens (authoritative, spec §7):** Void Black `oklch(8% 0 0)` canvas; Panel Deep `oklch(15% 0 0)` panels; Hairline `oklch(22% 0 0)` seams; Ink Primary/Secondary/Muted `oklch(98%/75%/55% 0 0)`; Electric Blue `oklch(65% 0.20 250)` as the single accent; Success/Danger reserved for state. Typography is system sans + ui-mono only.

**Cherry-pick anchors:**
- Dark token structure and app-stage rationale from the source project only as a pattern; no copied studio routes, model surfaces, or light editorial artifacts.

**Regression to strip (§10.1):**
- No light-editorial design system as current truth: no warm paper surfaces, magenta accent, serif/webfont stack, or `docs/reference/impeccable-DESIGN.*` artifacts.
- No studio/dashboard/model/chat concepts in product chrome. The app remains slicer + package.

**TDD checkpoints (setup gates, not code tests):**
- `PRODUCT.md` + `DESIGN.md` are non-placeholder (>200 chars, no `[TODO]`).
- `DESIGN.md` and `frontend/src/styles/theme.css` agree on the named tokens.
- A drift grep finds no active light-editorial tokens outside explicit supersession notes.

**Acceptance:** tokens drive the UI; design framing documents the whole app as the dark grading stage and export instrument.

> **Robustness note:** the orchestration parenthetical says PRODUCT/DESIGN may be "already authored." This phase is correct either way — treat root `PRODUCT.md`/`DESIGN.md` as required gates that must exist and pass `load-context.mjs`; **author fresh per §7 only if absent or placeholder.**

---

## Phase 6 — Frontend UI (Vite/React, Dark Instrument, all endpoints)

**Goal:** Single-page Vite/React/TS slicer that wires every endpoint in the dark instrument system; filmstrip with per-frame exclude; zoom lightbox; live frame/weight budget meter.

**Targets:**
- `frontend/` — Vite + React + TS; built to static assets served by FastAPI (one runtime process, no Next.js).
- `frontend/src/lib/api.ts` — typed client for all §9 endpoints.
- `frontend/src/config.ts` — **mirror** of backend `SLICE_CONSTANTS` (`DEFAULT_SLICE_SECONDS`, `MAX_SLICE_SECONDS`); no literal 10/60.
- Components: `ImportDrop`, `TrimSlider` (dual-handle, live frame-count + projected package-weight), `FpsControl` (presets 3/6/12 + custom + auto-suggest), `CropTool` (manual box + auto), `EraseTool` (paint/box region, tier label), `RenamePanel`, `ExportFlow` (slug/accent/copy → package → verify report → download), `RecentsList` (minimal, not a CRM).
- Media surfaces: `MediaStage` (video preview + canvas), `Filmstrip` (per-frame exclude toggle), `Lightbox` (zoom for pixel-peeping edges) — all against Void Black/Panel Deep so frames grade true.
- `BudgetMeter` — live `(duration × fps)` frame count + projected weight vs `WEIGHT_BUDGET`/`FRAME_BUDGET`; warns + auto-suggests lower fps.

**Cherry-pick anchors:**
- Slicer UI flow (trim/fps/filmstrip/exclude/crop/erase) ← `frontend/src/app/slicer/[jobId]/page.tsx` — port the **interactions**, re-skin to Impeccable, de-bloat.

**Regression to strip (§10.1):**
- **Next.js scaffolding & studio routes** (`slicer/[jobId]`, `animation-guide`, dashboard, studio tabs) → single-page Vite/React; no route tree, no GSAP-studio generator, no chat assistant.
- **Anti-slop bans (§7):** no side-stripe borders, no gradient text, no glassmorphism-as-default, no hero-metric template, no identical card grids, no bounce/elastic.

**TDD checkpoints:**
- Component/integration tests (Vitest + Testing Library): trim slider clamps to `MAX_SLICE_SECONDS`; budget meter recomputes on duration/fps change and triggers fps auto-suggest; filmstrip exclude toggles update the finalize payload; export flow surfaces the `verify.mjs` gate report.
- API client contract test against the running backend (happy path per endpoint).

**Acceptance:** full flow drivable in-browser: import → trim → exclude → crop → erase → export; chrome reads as the dark instrument in `DESIGN.md`; no literal 10/60; no banned patterns.

---

## Phase 7 — Share (local/Tailscale/LAN) + Launcher

**Goal:** Surface local + Tailscale + LAN URLs; one-command launch.

**Targets:**
- `backend/app/share.py` — detect local, Tailscale (tailnet IP/hostname), and LAN IP; `GET /share/status` → `{local, tailscale, lan}`.
- `frontend/src/lib/share.ts` + a Share UI surface showing the three URLs for handoff.
- `start.command` — boots FastAPI (serving built UI), prints the three URLs (target UX in spec §4).

**Cherry-pick anchors:**
- Share (local/Tailscale) ← `frontend/src/lib/share.ts` + `/share/status` — keep the concept, adapt to FastAPI.

**Regression to strip (§10.1):**
- No MLX/model bootstrap in the launcher; no studio/dashboard routes; no `print`/DEBUG.

**TDD checkpoints:**
- `share.py` returns well-formed URLs; gracefully degrades (Tailscale `null` when not on a tailnet) without crashing.
- `start.command` boots, serves built assets, prints all three URL lines.

**Acceptance:** one command launches; localhost + Tailscale + LAN URLs print and resolve; UI shows them for handoff.

---

## Phase 8 — Polish & Gate (impeccable audit + end-to-end)

**Goal:** End-to-end on a real video, then the design/quality gates.

**Targets:**
- End-to-end script/checklist: real ≤10s video → trim → exclude bad frames → crop → premium-erase a watermark → export → package `index.html` opens & animates offline → `node verify.mjs` green.
- `/impeccable audit` + `npx impeccable detect` clean on the UI.
- Reduced-motion + DPR + 404-tolerance manually confirmed in the exported player.

**Cherry-pick anchors:** none (integration phase).

**Regression to strip (§10.1):** confirm no leftover bloat surfaced during integration (feeds the final grep gate).

**TDD checkpoints:**
- Full pipeline integration test (where automatable) produces a package matching the P0 golden-fixture shape; `verify.mjs` exits 0.
- `npx impeccable detect` exits clean (no banned patterns).

**Acceptance (spec §12):** exported folder opens and **animates premier-grade on first open**, offline, zero external requests (or GSAP-CDN only); `node verify.mjs` passes all gates; `npx impeccable detect` clean; package is CWV-friendly.

---

## Phase 9 — OSS Readiness

**Goal:** Make the repo shippable: README pitch + SEO/CWV framing, permissive LICENSE, sample package, CI running `verify.mjs`.

**Targets:**
- `README.md` (repo root) — the **token-burn pitch** (frontier model gets enterprise motion at near-zero image-generation tokens) + **SEO/CWV framing** (WebP frame sequences are LCP-safe, lazy-loadable, CLS-free); quickstart (`./start.command`); the package contract; what's intentionally NOT here (non-goals §2).
- `LICENSE` — permissive (MIT/Apache-2.0).
- `examples/sample-package/` — ship the P0 golden fixture as the canonical sample.
- `.github/workflows/verify.yml` — CI runs `node verify.mjs` against the sample package (and any built fixtures); fails the build on any gate failure.
- `requirements.txt` + `requirements-premium.txt` documented (torch opt-in).

**Cherry-pick anchors:** none (use the lean §8 contract, not the source doc pile).

**Regression to strip (§10.1):** README must not reference MLX/Gemma/studio/dashboard; no `INSTRUCTIONS.llm.md`/`VIDEO_PROMPT.md`/`USE_CASES.md` ceremony.

**TDD checkpoints:**
- CI green: `verify.mjs` passes on the shipped sample package.
- README ≤ reasonable length; links resolve; quickstart works from a clean clone.

**Acceptance:** clean clone → `./start.command` → produce a package → `verify.mjs` green; CI enforces it; sample package opens and animates.

---

## Task Graph for the Implementation Workflow

Discrete tasks with dependencies. Tasks in the same lane with no shared deps can fan out in parallel. Format: `ID — task [deps]`.

### Lane A — Contract (must complete before packager/end-to-end)
- **T0.1** — Author `verify.mjs` (gates G1–G7), zero deps. `[]`
- **T0.2** — Distill ONE reference `index.html` player (cover-fit, DPR, preload-onerror, reduced-motion, rAF fallback). `[]`
- **T0.3** — Freeze contracts: `PACKAGE_SCHEMA`, `FINGERPRINT_RECIPE`, `LOCKED_ZONES`/`SAFE_ZONES`, `WEIGHT_BUDGET`, `FRAME_NAMING`. `[]`
- **T0.4** — Hand-assemble golden fixture (`fixtures/sample-animation/`: 5 WebP frames + manifest + player + verify + README). `[T0.1,T0.2,T0.3]`
- **T0.5** — Negative tests: 7 corruptions each fail the matching gate. `[T0.4]`

### Lane B — Backend (sequential core, parallel ops)
- **T1.1** — FastAPI skeleton + `config.py` (`SLICE_CONSTANTS`, budget, port). `[]`
- **T1.2** — `jobs.py` JobStore + `POST /upload` + thumbnail. `[T1.1]`
- **T1.3** — `media/extract.py` preview/finalize + `budget.py` (fps auto-suggest). `[T1.2]`
- **T1.4** — Slice endpoints (preview/finalize) + static `/data` serving + pytest. `[T1.3]`
- **T2.1** — `media/crop.py` auto-crop + watermark symmetry enforcer (OpenCV only) + tests. `[T1.4]`
- **T2.2** — `media/webp.py` (q82–90) + tests. `[T1.4]`
- **T2.3** — `media/rename.py` zero-pad `FRAME_NAMING` + tests (output passes verify G2). `[T2.2,T0.3]`
- **T3.1** — `media/erase_baseline.py` (INPAINT_NS + feather + temporal) + deterministic tests. `[T2.1]`
- **T3.2** — `media/erase_premium.py` (LaMa/IOPaint, opt-in) + smoke test. `[T3.1]`
- **T3.3** — `media/erase.py` dispatcher (tier select + label) + `requirements-premium.txt`. `[T3.1,T3.2]`
- **T4.1** — `packager.py` build §8 package + render player + write manifest (reuse `FINGERPRINT_RECIPE`). `[T2.3,T3.3,T0.3]`
- **T4.2** — `verify_runner.py` shells `verify.mjs`, fails build on non-zero. `[T4.1,T0.1]`
- **T4.3** — Fingerprint-parity test: packager vs verify.mjs agree on a fixture. `[T4.1,T0.5]`
- **T4.4** — `POST .../package` + `GET .../package/download`. `[T4.2]`

### Lane C — Design (parallel to Lane B; no backend deps)
- **T5.1** — Verify in-repo `.claude/skills/impeccable/` intact; copy tokens to `public/css/tokens.css`. `[]`
- **T5.2** — Author root `PRODUCT.md` (fresh, with `register`). `[]`
- **T5.3** — Author root `DESIGN.md` (port tokens + chrome/dark-stage + media-stage dark tokens). `[T5.1]`
- **T5.4** — Confirm `load-context.mjs` passes (non-placeholder, register present). `[T5.2,T5.3]`

### Lane D — Frontend (needs backend endpoints + design tokens)
- **T6.1** — Vite/React/TS scaffold + `api.ts` + `config.ts` (mirror constants). `[T1.4,T5.4]`
- **T6.2** — Chrome components (Import/Trim/Fps/BudgetMeter/Export/Recents), Impeccable. `[T6.1,T4.4]`
- **T6.3** — Dark media stage (MediaStage/Filmstrip/Lightbox). `[T6.1]`
- **T6.4** — Crop/Erase tools wired to endpoints (tier label). `[T6.2,T6.3,T2.1,T3.3]`
- **T6.5** — Component/integration tests (Vitest). `[T6.4]`

### Lane E — Share + Launch (needs backend core)
- **T7.1** — `share.py` + `GET /share/status` + tests. `[T1.1]`
- **T7.2** — `share.ts` + Share UI surface. `[T7.1,T6.1]`
- **T7.3** — `start.command` boots FastAPI + built UI, prints 3 URLs. `[T7.1,T6.5]`

### Lane F — Polish, OSS, Gate (converge)
- **T8.1** — End-to-end: real video → package → opens/animates offline → `verify.mjs` green. `[T4.4,T6.5,T7.3]`
- **T8.2** — `/impeccable audit` + `npx impeccable detect` clean. `[T6.5,T5.4]`
- **T9.1** — Root `README.md` (token-burn pitch + SEO/CWV framing + non-goals). `[T8.1]`
- **T9.2** — `LICENSE` (permissive) + `examples/sample-package/` (ship golden fixture). `[T0.4]`
- **T9.3** — `.github/workflows/verify.yml` runs `verify.mjs` in CI. `[T9.2]`
- **T_GATE** — **Anti-regression review (FINAL, blocks ship).** Grep first-party code/output and active docs. Fail on any hit that presents retired source behavior as current: `DEBUG`/`print(` in app code; `INPAINT_TELEA` as the default erase path; legacy `baseUrl`; experience metadata `trigger`/`effect`/`easing`; `INSTRUCTIONS.llm.md`/`VIDEO_PROMPT.md` ceremony; dead multi-format `.jpg/.jpeg/.png/.webp` checks; hardcoded `> 10.0` slice wall; stale schema `smart-image-animations.deliverable-package.v1`; stale `data-template-id` value `webp_guided_knowledge_2026`; light-editorial tokens outside explicit supersession notes. `[ALL code phases: T0–T9]`

### Critical path
`T0.1/T0.2/T0.3 → T0.4 → (T4.1 needs T2.3+T3.3) → T4.4 → T8.1 → T9.1 → T_GATE`. Lanes C (design) and E.7.1 (share status) parallelize early; Lane B ops (crop/webp/erase) parallelize after T1.4.
