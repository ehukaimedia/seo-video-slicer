# SEO Video Slicer — Specification

**Status:** Draft v1 (pre-implementation)
**Date:** 2026-06-01
**Owner:** ehukaimedia
**Supersedes:** the studio bloat of `smart-image-animations` (cherry-picked, not ported wholesale)

---

## 1. Intent

**One sentence:** A premium, single-purpose video slicer that turns a 5–10s clip from *any* source into a drop-in, ready-to-go WebP **animation package** that a frontier model can wire into any repo — eliminating the token burn of generating images from scratch.

**The inversion that defines the product.** `smart-image-animations` made *the animation templates* the product and grew a studio (GSAP generator, MLX/Gemma chat, dashboard) around them. We invert it: **the optimized sliced-image package is the product.** We do not generate the animation. The downstream repo's frontier model (Claude Code, Cursor, etc.) already handles "the backend" — it just needs premium raw material. The slicer is the premium tool; the package is the deliverable.

**Anti-pattern this prevents.** Asking a frontier model to *create* hero-animation imagery from scratch is slow, expensive (massive token/credit burn), and non-deterministic. Shipping a tiny, Core-Web-Vitals-friendly WebP frame sequence + a working reference player means the model spends near-zero tokens and gets enterprise-grade motion on the first try.

**SEO positioning (first-class, it's in the name).** WebP frame-sequences are LCP-safe, lazy-loadable, CLS-free, and a fraction of the weight of shipping video or a heavy JS animation library. The package is engineered to *help* Core Web Vitals, not hurt them.

---

## 2. Non-Goals (the bloat we are deliberately cutting)

From `smart-image-animations`, we **do not** carry:

- ❌ In-app GSAP / ScrollTrigger **animation generator** (`animation_templates.py`, the Studio tab). The package ships ONE deterministic reference player; customization is the downstream model's job.
- ❌ **MLX / Gemma local runtime** (`mlx_runtime.py`, `mlx_server_optimized.py`, `ai.py` model server). No local LLM. No model download for core function.
- ❌ **Chat assistant** / Animation Director (`GlobalChatAssistant.tsx`).
- ❌ **Multi-project dashboard / job gallery** as a product surface. One session = one working clip; a minimal recents list is acceptable, a CRM is not.
- ❌ Benchmark harnesses, prompt-expansion, style-context galleries, "experiences" CRUD.

If a feature is not in service of *slice a video → clean frames → premium package*, it is out.

---

## 3. Users & Success

**User:** a developer/designer who has a short video (Veo, screen capture, product shot, any source) and wants premier scroll/hover animation in their app without burning model tokens drawing it.

**Success is one question:** *Can they drop the exported folder into `public/` of any repo, open `index.html`, and see enterprise-grade scroll animation in 10 seconds — then tell their model "use this" and have it integrate in one pass?* If yes, ship. Five stars is the bar; anything that reads as "a template" or "AI slop" fails.

---

## 4. Form Factor & Stack (lean by construction)

**Runtime:** a local app you launch with one command. Serves a browser UI on `localhost`, reachable over your tailnet (Tailscale) and LAN for review/handoff.

| Layer | Choice | Why |
|---|---|---|
| Backend | **Python + FastAPI** (single process) | ffmpeg + OpenCV + **neural inpaint erase** + WebP need Python; this is the one thing pure Node can't do premium. Lean: ~4 modules, no MLX. |
| Media | **ffmpeg** (extract/trim/cropdetect/delogo), **OpenCV** (crop/contour/erase), **Pillow** (WebP q82–90) | Battle-tested, cherry-picked from source `slicing.py`. |
| Premium erase | **LaMa via IOPaint** when installed; **enhanced OpenCV** (NS + feather + temporal) fallback | Premium quality without forcing a torch install on every user. |
| Frontend | **Vite + React + TypeScript**, built to static assets served by FastAPI | One runtime process, no Next.js bloat. Single-page slicer. |
| Design | **The Dark Instrument** (`DESIGN.md`) — Void-Black canvas, Panel-Deep panels, Hairline seams, one Electric Blue accent | See §7. |
| Sharing | FastAPI binds to localhost + tailnet IP; **share status** endpoint surfaces local/Tailscale/LAN URLs | Cherry-picked `share.ts` / `/share/status` concept. |

**Runner-up rejected:** pure Node/`npx` CLI + ffmpeg.wasm. Rejected because premium erase (neural inpaint) and quality crop are not achievable at this bar in Node/WASM, and Tailscale handoff wants a persistent server. The launch command stays a one-liner so it *feels* as light as `npx`.

**Launch (target UX):**
```
./start.command           # boots FastAPI (serving built UI), prints:
  ▸ Local:    http://localhost:5179
  ▸ Tailnet:  http://<machine>.<tailnet>.ts.net:5179
  ▸ LAN:      http://192.168.x.x:5179
```

---

## 5. The Premium Slicer (feature set we keep & sharpen)

The visual workspace (single page). Cherry-picked from source slicer, re-skinned, de-bloated:

1. **Import** — drag any video (`POST /upload`). Generate thumbnail. Auto-set out-point to the user's default slice length (10s).
2. **Trim** — dual-handle in/out slider bound to the video playhead; live frame-count **and projected package-weight** readout. Duration is governed by §5.1, not a hard 10s wall.
3. **Extract** — ffmpeg `fps` filter → JPEG preview frames (`generate_preview`). FPS presets 3/6/12 + custom; the UI **auto-suggests fps** to keep frame count in the lean budget as duration grows.
4. **Frame review** — filmstrip with per-frame **exclude** toggle (drop hallucinated/bad frames), zoom lightbox for pixel-peeping edges.
5. **Crop** — manual crop box **and** auto-crop (OpenCV contour/threshold). Keep the **watermark symmetry enforcer** + portrait/landscape safety margin (the genuinely clever bit at `slicing.py:261-296`).
6. **Premium erase** — paint/box a region → neural inpaint removal across all frames with edge feather + temporal consistency. §6.
7. **WebP convert** — Pillow/OpenCV WebP q82–90; zero-padded `frame_000.webp …` naming.
8. **SEO rename** — frame prefix normalization for clean, descriptive asset names.
9. **Export Package** — assemble the contract package (§8), zip, download. Surfaces local/Tailscale URLs for handoff.

**Quality numbers (locked):** WebP quality 82–90; effective 6–16 fps (frame-step, not 30/60); zero-padded 3-digit names; cover-fit, single-canvas render in the player. Duration & frame budget per §5.1.

### 5.1 Duration & Frame-Budget Policy

Duration is **configurable, not a hard wall** — and the true governor is **frame count / package weight** (the CWV value prop), not seconds.

- **`DEFAULT_SLICE_SECONDS = 10`** — the hero-animation sweet spot; auto-applied on import.
- **`MAX_SLICE_SECONDS = 60`** — a single config constant (backend env + frontend mirror). Raising it later is a one-line change; never hardcode 10/60 elsewhere. *(Source enforced a hard `> 10.0` raise at `slicing.py:14` — we replace it with this constant + budget check.)*
- **User-settable default** — the user picks their preferred default slice length (≤ ceiling), persisted as a preference.
- **Frame-budget meter (the real safety rail)** — the UI projects, live, the **frame count** and **package weight** for the current `(duration × fps)` and:
  - target **20–80 frames** for hero/loop animations (default lane);
  - allow **up to ~200 frames** for long-form / scrollytelling, with explicit weight warnings;
  - **soft-cap on package weight** (warn approaching a CWV budget, e.g. ~4 MB total / per-frame budget), and **auto-suggest a lower fps** to stay lean as duration rises.
- **Why not just allow 60s at any fps:** 60s × 12fps ≈ 720 frames ≈ ~29 MB — that destroys the lazy-loadable/LCP-safe promise. 60s × 2fps ≈ 120 frames is fine. The meter enforces the package contract regardless of the duration chosen.
- **Future extension:** the constant + budget model means longer ceilings (or per-project overrides) are config, not refactor. `verify.mjs` **G7** (weight budget) is the backstop that keeps any duration honest to the 5-star bar.

---

## 6. Premium Erase (the explicit upgrade)

**Today (source):** `erase_slice_region` uses `cv2.inpaint(..., INPAINT_TELEA)` per frame — fast but smears on textured backgrounds, no edge feathering, no temporal coherence.

**Target — two-tier engine, auto-selected:**

- **Premium tier — LaMa (IOPaint).** Neural inpainting (`iopaint` / `simple-lama-inpainting`), runs locally on Apple MPS/CPU, model auto-downloaded on first use (~200MB). Mask → clean, structure-aware fill. Add **feathered mask edges** and **temporal consistency** (propagate/blend the inpaint region across consecutive frames so the erase doesn't shimmer).
- **Baseline tier — enhanced OpenCV.** Upgrade Telea → `INPAINT_NS` (and/or `cv2.xphoto` if available) with edge-aware feathered masks, adaptive radius, and the same temporal-coherence pass. No torch, instant, offline. Always available so packages build anywhere.

**Selection:** premium if IOPaint importable; else baseline. The UI labels which tier ran. `requirements-premium.txt` keeps torch out of the default install.

**Acceptance:** on a watermarked Veo clip, premium tier removes the watermark with no visible smear or frame-to-frame shimmer at 1× and 2× zoom.

---

## 7. Design — The Dark Instrument (`DESIGN.md` is the system of record)

> **Supersession note.** The light-editorial port ("The Editorial Darkroom" — Warm Ash Cream, Editorial Magenta, Cormorant Garamond / Instrument Sans / Space Grotesk, a scoped dark media stage) is **retired in full.** The design system of record is the dark **"Dark Instrument"** in `DESIGN.md`, backed verbatim by `frontend/src/styles/theme.css`. See `DESIGN.md`. No warm surfaces, no magenta, no serif, no webfonts, and no chrome-vs-stage split survive.

The SEO Video Slicer reads like a precision instrument the moment it opens — a scrub deck / frame-grading bench. The **whole interface** lives on **Void Black** (`oklch(8% 0 0)` — not pure black). Panels are **solid Panel Deep** (`oklch(15% 0 0)`), seamed from the canvas by **1px Hairline** (`oklch(22% 0 0)`), never by drop shadows. A single accent — **Electric Blue** (`oklch(65% 0.20 250)`) — carries every interactive and active state. There is no second hue.

**The design system is adopted, not authored from scratch.** `theme.css` is a **verbatim port of the source system of record** (`smart-image-animations/frontend/src/app/globals.css`) — i.e. we *kept* the source's dark palette and cut only its studio bloat (§2). `DESIGN.md` is the canonical narrative for those tokens; where the two ever disagree, **theme.css wins.**

**`PRODUCT.md` / `DESIGN.md` — authored fresh for this product:**
- **`PRODUCT.md`** is authored **fresh** for seo-video-slicer (our users, purpose, brand voice). We do **not** copy `smart-image-animations/docs/PRODUCT.md` — that describes a *different product* (the studio), even though it shares the dark palette.
- **`DESIGN.md`** is authored for this repo as **"The Dark Instrument"**: it mirrors the `theme.css` tokens 1:1 in its frontmatter, then writes our framing for the lean slicer. The source's `docs/DESIGN.md` is not copied (different product framing); the *tokens* are what carry over, via `theme.css`.

**Tokens (authoritative values — see `DESIGN.md` / `theme.css`):**
- Accent: **Electric Blue** `oklch(65% 0.20 250)` — *the only* accent (The One Accent Rule). Status-only: Success `oklch(65% 0.15 150)`, Danger `oklch(55% 0.20 25)`.
- Surfaces: **Void Black** `oklch(8% 0 0)` page, **Panel Deep** `oklch(15% 0 0)` panels/cards/inputs, **Hairline** `oklch(22% 0 0)` 1px seams.
- Ink: Ink Primary `oklch(98% 0 0)` (headings, white-pill CTA), Ink Secondary `oklch(75% 0 0)` (body), Ink Muted `oklch(55% 0 0)` (captions, mono labels).
- Type: **system-ui sans** (`system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif`) — bold 700, `-0.02em` tracking for display/headlines · **ui-monospace** (`ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace`) for all technical readouts. No serif, no webfonts.
- Motion: `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`; ~0.15/0.2/0.4s. **No bounce/elastic.**
- CTA (`btn-primary`): **white pill** — Ink-Primary fill, Void-Black text, 999px radius; hover `translateY(-1px)` + opacity 0.88. Flat-by-default; the only sanctioned glow is the rare Electric-Blue `glow-glow`.

**Application decision:** the **entire app is the dark stage** — canvas, panels, and the media stage (video preview + filmstrip + lightbox) are one continuous dark surface, so extracted frames grade true against neutral darkness (the pro-tool standard — Premiere/DaVinci/Lightroom). There is no light chrome to leak warmth onto the frame, and there is no scoped dark-stage *exception* — the whole instrument is dark. (The media stage may use the deepest surface, Void Black, against the surrounding Panel-Deep panels, so it still reads as the grading bench — a tone step within one dark system, not a separate light/dark split.)

**Anti-slop bans (per `DESIGN.md`):** no side-stripe borders, no gradient text, no glassmorphism / `backdrop-filter`, no hero-metric template, no identical card grids, no bounce, no second accent hue, no pure `#000`/`#fff`. Structure is drawn with hairlines and tone steps, not drop shadows.

---

## 8. THE PACKAGE CONTRACT (define this FIRST — everything builds to it)

The exported folder is the product. Self-contained, zero external requests, relative paths, works offline.

```
<slug>-animation/
├── frames/
│   ├── frame_000.webp          # zero-padded, lexicographically sortable
│   ├── frame_001.webp
│   └── … frame_NNN.webp        # 20–80 frames, WebP q82–90
├── index.html                  # self-contained canvas scroll-player; OPENS & ANIMATES NOW
├── manifest.json               # the customization contract (locked vs. safe zones) + fingerprint
├── verify.mjs                  # offline quality gate (Node, zero deps) — acceptance tests live here
├── README.md                   # iframe + React/Next + vanilla integration recipes (≤200 lines)
└── PROMPT.md                   # OPTIONAL drop-in LLM instructions (package works without it)
```

**`index.html` (the working player) — locked techniques** (cherry-picked from `animation_templates.py`):
- Single `<canvas>`, **cover-fit** render (`scale = max(cw/iw, ch/ih)`, centered), **no** duplicate blurred background layer.
- **DPR scaling** for retina sharpness.
- **Parallel preload** with `onerror`-tolerant counter (a 404 never freezes).
- Frame index = scroll progress × (frameCount − 1), bound via a pinned scroll container (GSAP ScrollTrigger from cdnjs is the *only* permitted external request; a no-dependency rAF fallback is acceptable and preferred for "zero external requests").
- `prefers-reduced-motion: reduce` → static hero frame; brand still reads.
- Carries a stable `data-template-id="seo-video-slicer.scroll.v1"` on the player root — the `templateId` that anchors the fingerprint (G4/G5). Strip the source's stale value `webp_guided_knowledge_2026`.
- System fonts only; inline CSS/JS; opens with no server.

**`manifest.json` schema (the customization contract):**
```json
{
  "schema": "seo-video-slicer.package.v1",
  "id": "<slug>",
  "created_at": "<iso8601>",
  "source": { "duration_s": 8.0, "fps_effective": 12, "resolution": "1280x720", "origin": "user-supplied video" },
  "frames": { "count": 48, "pattern": "frames/frame_NNN.webp", "format": "webp", "quality": 82 },
  "player": { "canonical": "index.html", "interaction": "scroll", "dependencies": { "gsap": "3.12.2 (optional)" }, "reduced_motion": true },
  "customization": {
    "locked_zones":  ["frames/*.webp bytes", "frame_NNN zero-pad ordering", "cover-fit single-canvas render", "reduced-motion fallback", "player data-template-id"],
    "safe_zones":    ["accent color", "headline/overlay copy", "scroll distance", "easing", "container height", "framework wrapper"]
  },
  "seo": { "lcp_safe": true, "total_bytes": 0, "lazy_loadable": true },
  "fingerprint": { "algorithm": "sha256", "value": "<sha256 of {frames:[zero-padded basenames], gsap:cdn-url-or-empty, templateId}> — byte-identical FINGERPRINT_RECIPE in verify.mjs and the packager (see plan)" }
}
```

**`verify.mjs` gates (= acceptance tests, adapted from source `verify.mjs`):**
- **G1** every frame referenced by `index.html` exists in `frames/` (asset closure).
- **G2** frames are zero-padded, contiguous `frame_000…frame_NNN`, count matches `manifest.frames.count`.
- **G3** `index.html` is self-contained: no `http(s)://…/<local-asset>` leaks, no scratch/localhost paths; relative `./frames/…` only.
- **G4** `index.html` contains cover-fit render, DPR scaling, preload-with-onerror, a `prefers-reduced-motion` block, and a stable `data-template-id="seo-video-slicer.scroll.v1"` attribute (the `templateId` the fingerprint consumes).
- **G5** `manifest.json` parses, has schema + fingerprint; fingerprint matches recomputed value.
- **G6** `README.md` exists, ≤200 lines, has Iframe / React / Vanilla headings. `PROMPT.md` optional.
- **G7** total package weight within budget; each WebP within per-frame budget (flag oversized).

`node verify.mjs` exits non-zero on any failed gate. The export pipeline runs it before declaring success.

**`PROMPT.md` (optional):** one short paragraph — "These are ready-made, performance-optimized WebP animation frames. `index.html` already plays them as a scroll animation. To integrate: copy this folder to `public/`, embed via the iframe recipe in README, or adapt the player into a native component — preserve the locked_zones in manifest.json, customize only safe_zones. Do not regenerate the images."

---

## 9. Backend Surface (lean endpoint set)

```
POST   /upload                              → { id, ... }            (+ thumbnail)
GET    /jobs/{id}                           → job meta
POST   /jobs/{id}/slice/preview             { start, end, fps }      → { preview_id, frames }
POST   /jobs/{id}/slice/finalize            { preview_id, selected } → { slice_id, frames }
POST   /jobs/{id}/slices/{sid}/crop         { manual_crop | auto }   → crop applied
POST   /jobs/{id}/slices/{sid}/erase        { x,y,w,h, tier? }       → { tier_used, erased }   (PREMIUM)
POST   /jobs/{id}/slices/{sid}/webp         → frames converted
POST   /jobs/{id}/slices/{sid}/rename       { prefix }               → renamed
POST   /jobs/{id}/slices/{sid}/package      { slug, accent?, copy? } → builds + zips contract package, runs verify.mjs
GET    /jobs/{id}/slices/{sid}/package/download → package.zip
GET    /share/status                        → { local, tailscale, lan }
GET    /data/...                            → static frame serving
```

Drop from source: all `/ai/*`, `/experiences/*` generation, `/context/*`, model selection.

---

## 10. Cherry-Pick Map (source → here)

| Take | From (`smart-image-animations`) | Action |
|---|---|---|
| Frame extraction, preview cleanup | `backend/app/slicing.py:12-130` | Keep, lean |
| Finalize / select frames | `slicing.py:66-95` | Keep |
| Auto-crop + **watermark symmetry enforcer** | `slicing.py:159-306` | Keep (drop AI/Gemma path; OpenCV only) |
| Erase (inpaint) | `slicing.py:512-556` | **Upgrade → premium two-tier** |
| WebP convert, zero-pad rename | `slicing.py:437-510` | Keep |
| Thumbnail | `slicing.py:559-587` | Keep |
| Package builder + portable relative-path rewrite | `main.py:271-341`, `slicing.py:423-435` | Adapt → §8 contract |
| `verify.mjs` + fingerprint quality gate | `frontend/public/templates/packages/.../verify.mjs` | Adapt → §8 gates |
| Canvas cover-fit scroll player | `animation_templates.py` (apple_scroll_zoom) | Distill → ONE `index.html` |
| Share (local/Tailscale) | `frontend/src/lib/share.ts`, `/share/status` | Keep |
| Slicer UI flow (trim/fps/filmstrip/exclude/crop/erase) | `frontend/src/app/slicer/[jobId]/page.tsx` | Re-skin to Impeccable, de-bloat |
| Impeccable **skill** (audit tooling) | `/AI-Applications/impeccable/` | Port the skill only. **Tokens are `theme.css`** (the Dark Instrument, §7) — *not* Impeccable's light `tokens.css`. |

---

## 10.1 Regression Context — DO NOT Port

We cherry-pick **patterns**, re-implemented clean against this spec. We do **not** copy-paste source code with its accumulated stale context. The new repo is training data for future readers and agents — every leftover is a false fact waiting to be revived. When porting any item in §10, strip the following:

| Regression context in `smart-image-animations` | Where | Action |
|---|---|---|
| **AI/Gemma crop branch** (`from .ai import AIClient`, `ai_client.analyze_image`) | `slicing.py:164,204-221` | Port **only** the OpenCV deterministic crop + watermark enforcer. No MLX/Gemma references anywhere. |
| **Telea inpaint as the primary erase** | `slicing.py:545` | Becomes the *labeled baseline fallback* under §6, not "the way." Don't port it as default. |
| **4-format frame sprawl** (`.jpg/.jpeg/.webp/.png` checked everywhere) | `slicing.py` passim | Standardize: JPEG **preview** frames → **WebP** package frames. One format per stage, not four everywhere. |
| **`DEBUG`/`print(...)` debug logging** | `slicing.py:440,447-449`, etc. | Use real logging or drop. No `print("DEBUG: ...")`. |
| **Legacy `const baseUrl` regex** ("patch from older templates") | `main.py:288` | Dead compat path. Do not port; our paths are relative `./frames/...` by construction. |
| **`resize_factor = 1.0 # Optimize if needed`, commented hints, dead vars** | `slicing.py:211` etc. | Drop dead/aspirational code and comments. |
| **Old "experience" meta fields** (`trigger`, `effect`, `easing`, `prompt`, GSAP) | `slicing.py:374-384` | Our `manifest.json` is a fresh schema (§8). Don't carry GSAP-studio metadata. |
| **Gold-standard multi-doc package ceremony** (`INSTRUCTIONS.llm.md`, `VIDEO_PROMPT.md`, `USE_CASES.md`, `VARIANTS.md`, `design-tokens.css`, `component/animation.tsx`) | `frontend/public/templates/packages/.../` | Our package is the lean §8 contract. Take the **verify.mjs + fingerprint pattern**, not the doc pile. |
| **Source `PRODUCT.md` / `DESIGN.md`** (dark Void-Black/Electric-Blue brand) | `docs/PRODUCT.md`, `docs/DESIGN.md` | Author **fresh** (§7). The *tokens* carry over (theme.css is a verbatim port of source `globals.css`), but the source docs describe a **different product** (the studio) — so our `DESIGN.md`/`PRODUCT.md` re-author the framing for the lean slicer, not copy the source narrative. |
| **MLX/Gemma stack, benchmarks, demos/** (`mlx_*.py`, `bench_*`, `bench_results.json`, `demos/`) | repo-wide | Not ported at all (§2). |
| **Next.js-specific scaffolding & studio routes** (`slicer/[jobId]`, `animation-guide`, dashboard) | `frontend/src/app/...` | We rebuild a single-page Vite/React UI; port the slicer *interactions*, not the Next route tree or studio tabs. |
| **Hardcoded `if (end - start) > 10.0` wall** | `slicing.py:14` | Replaced by `MAX_SLICE_SECONDS` constant + frame-budget check (§5.1). |

**Gate:** the implementation workflow includes a dedicated regression-context reviewer that greps the new repo for `DEBUG`, `Gemma`/`mlx`/`AIClient`, `INPAINT_TELEA` (outside the fallback), `baseUrl`, `trigger/effect/easing`, and dead multi-format checks — and fails if source stale context leaked in.

## 11. Build Sequence (contract-first)

0. **Contract** — write `manifest` schema + `verify.mjs` gates + the reference `index.html` player; lock them. Everything else builds to pass `verify.mjs`.
1. **Backend core** — FastAPI skeleton, upload, slice preview/finalize, static serving (TDD against ffmpeg).
2. **Slicing ops** — crop (+ watermark enforcer), WebP, rename.
3. **Premium erase** — two-tier engine + selection + temporal coherence.
4. **Packager** — build contract package, portable paths, zip, run `verify.mjs`, expose download.
5. **Design port** — copy the Impeccable **skill** (audit tooling); the design tokens are `theme.css` (the Dark Instrument, §7), not Impeccable's light `tokens.css`. Author `PRODUCT.md`/`DESIGN.md` fresh.
6. **Frontend** — Vite/React Dark-Instrument UI (§7, `DESIGN.md`/`theme.css`); wire all endpoints; lightbox.
7. **Share** — local/Tailscale/LAN URL surfacing; launcher.
8. **Polish & gate** — `/impeccable audit`, `npx impeccable detect`, end-to-end: real video → package → opens & animates → `verify.mjs` green.
9. **OSS readiness** — README (token-burn pitch + SEO/CWV framing), LICENSE (permissive), examples, sample package, CI running `verify.mjs`.

---

## 12. Acceptance (the 5-star bar)

- One command launches; localhost + Tailscale + LAN URLs print.
- Drop any ≤10s video → trim → exclude bad frames → crop → premium-erase a watermark → export.
- Exported folder opens (`index.html`) and **animates premier-grade on first open**, offline, zero external requests (or GSAP-from-CDN only).
- `node verify.mjs` passes all gates; `npx impeccable detect` is clean.
- Total package is CWV-friendly (small, lazy-loadable, no CLS).
- A frontier model, given only the folder, integrates it in one pass with near-zero image-generation tokens.
- No smart-image-animations bloat present anywhere.
