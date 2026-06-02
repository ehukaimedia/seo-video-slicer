# API.md — SEO Video Slicer HTTP API + Data-Layout Contract (FROZEN)

**Status:** FROZEN (Phase 1 contract). Backend and frontend both build to this document.
Where the prose below restates the spec, it is a lock, not a paraphrase.

**Authority:** spec §9 (`docs/specs/seo-video-slicer-spec.md`, "Backend Surface") is the
conceptual origin; this file is the **authoritative, unambiguous form** of that surface and
supersedes the §9 sketch wherever they differ (the §9 paths were a pre-implementation outline —
this contract is the built shape: `/api` prefix, richer request/response bodies, named
preview/finalize/crop/erase/package steps). The **package contract** is frozen separately in
`package-contract/CONTRACT.md`; this API never re-specifies package internals — it consumes the
packager kernel.

**Reuse mandate (do NOT reimplement packaging):** the `package` endpoint MUST build the package by
shelling out to `package-contract/build_package.mjs` and MUST validate it by shelling out to
`package-contract/verify.mjs`. It does not re-implement the manifest writer, the fingerprint, the
player injection, or the gates. See §7 (`POST …/package`) and §11 (Packager invocation).

---

## 0. Conventions (apply to every endpoint)

- **Base prefix:** every JSON endpoint is under **`/api`**. Static asset routes (`/data/…`) and the
  built frontend (`/`, `/assets/…`) are **not** prefixed.
- **Content types:** request bodies are `application/json` (UTF-8) except `POST /api/upload`
  (`multipart/form-data`). All JSON responses are `application/json; charset=utf-8`.
- **IDs are server-generated, opaque, filesystem-safe tokens.** `job_id`, `preview_id`,
  `slice_id`, `package_id` match `^[A-Za-z0-9_-]{1,64}$`. Clients treat them as opaque and never
  construct them. The server never interpolates a client string into a filesystem path without
  validating it against this pattern.
- **Path-traversal:** any `{…_id}` or `/data/…` sub-path containing `..`, a leading `/`, a
  backslash, or a null byte is rejected with **400** before any filesystem access.
- **Success status:** `200 OK` for all successful responses (no `201`); the body carries the
  result. `POST …/package` returns **200 even when the quality gate fails** — see §7 and §9.2.
- **Single error shape:** every non-2xx response (including FastAPI validation errors, which the
  app overrides — see §9.1) is the envelope `{ "error": string, "detail"?: string }`. There is no
  other error body anywhere in the API.
- **Authentication:** none. This is a desktop-local app bound to localhost + tailnet + LAN
  (see §8). No tokens, no cookies, no CSRF surface beyond the local trust boundary.
- **Idempotency / mutation:** `crop` and `erase` mutate a slice's frames **in place** on disk
  (same `frame_NNN.webp` filenames). Responses therefore return frame URLs with a cache-busting
  `?v=<mtime>` query (see §3) so the frontend filmstrip re-fetches the new bytes.

---

## 1. Config constants (single source, env-overridable)

Defined once in `backend/app/config.py`; the frontend mirrors the defaults in
`frontend/src/config.ts` (compile-time constants, NOT fetched at runtime — there is no
`/api/config` endpoint). **The backend is the authoritative enforcer**; the frontend mirror is a
UX convenience for the budget meter and trim clamp. No literal `10` / `60` / `82` / `200` /
`4 MB` / `256 KB` appears anywhere outside `config.py` (backend) and `config.ts` (frontend).

| Constant | Default | Env override | Meaning |
|---|---|---|---|
| `DEFAULT_SLICE_SECONDS` | `10` | `SVS_DEFAULT_SLICE_SECONDS` | Out-point auto-set on import (hero sweet spot, spec §5.1). |
| `MAX_SLICE_SECONDS` | `60` | `SVS_MAX_SLICE_SECONDS` | Hard ceiling on `end - start` for `preview`. |
| `WEBP_QUALITY` | `82` | `SVS_WEBP_QUALITY` | WebP encode quality for finalize/package frames. Valid 82–90; passed to the packager as `--quality`. |
| `WEIGHT_BUDGET_BYTES` | `4194304` (≈4 MB) | `SVS_WEIGHT_BUDGET_BYTES` | Total-package SOFT cap (warn only) — mirrors `CONTRACT.md §4`. |
| `PER_FRAME_BUDGET_BYTES` | `262144` (256 KB) | `SVS_PER_FRAME_BUDGET_BYTES` | Per-frame SOFT cap (warn only) — mirrors `CONTRACT.md §4`. |
| `FRAME_COUNT_HARD_MAX` | `200` | `SVS_FRAME_COUNT_HARD_MAX` | Frame-count HARD cap (mirrors `verify.mjs` G7; the packager/gate is the backstop). |
| `HERO_LANE_MIN` / `HERO_LANE_MAX` | `20` / `80` | — | Hero/loop ideal band for the budget meter. |
| `PORT` | `5179` | `SVS_PORT` | Bind port (spec §4). |

### 1.1 Frame-budget rule (the meter the frontend mirrors)

Both the frontend `BudgetMeter` and the backend `budget.py` compute and enforce the same rule
(spec §5.1; `CONTRACT.md §4` is the package-side backstop):

- **Projected frame count** = `round((end - start) × fps)`.
- **Hero/loop lane:** `HERO_LANE_MIN … HERO_LANE_MAX` (20–80) frames = ideal (green).
- **Scrollytelling lane:** `81 … FRAME_COUNT_HARD_MAX` (200) frames = allowed, with an explicit
  weight warning (amber).
- **Over budget:** `count > FRAME_COUNT_HARD_MAX` (200) is the **hard** rule — `verify.mjs` G7
  fails such a package, so the meter blocks it (red) and the packager refuses to ship it.
- **Weight soft-cap:** projected total approaching `WEIGHT_BUDGET_BYTES` (≈4 MB), or any frame over
  `PER_FRAME_BUDGET_BYTES` (256 KB), raises a warning (advisory, not a block).
- **fps auto-suggest:** as duration rises, `budget.py` suggests the highest fps from `{3, 6, 12}`
  (and custom) that keeps the projected count within the hero/scrollytelling band, so 60 s never
  silently produces ~720 frames. The frontend surfaces this suggestion next to the fps control.

---

## 2. Data layout (under `data/jobs/{job_id}/`)

The data root is `data/` at the repo/runtime root (git-ignored). One directory per job. All paths
are server-owned; clients never address files except through the `/data/…` static route and the
`url` fields the API returns.

```
data/
└── jobs/
    └── {job_id}/
        ├── video.mp4                         # the uploaded source (transcoded/normalized name)
        ├── meta.json                         # job meta: filename, title, created_at, duration_s, width, height, fps
        ├── thumb.jpg                          # poster thumbnail (served as thumb_url)
        ├── previews/
        │   └── {preview_id}/
        │       ├── frame_000.jpg             # ffmpeg fps-filter JPEG preview frames (NOT WebP)
        │       ├── frame_001.jpg
        │       └── … frame_NNN.jpg
        └── slices/
            └── {slice_id}/
                ├── meta.json                 # slice meta (see §2.1) — REQUIRED packager inputs
                ├── frame_000.webp            # finalized WebP frames (q = WEBP_QUALITY), contiguous
                ├── frame_001.webp
                ├── … frame_NNN.webp
                └── packages/
                    └── {package_id}/
                        ├── frames/frame_000.webp … frame_NNN.webp   ┐
                        ├── index.html                               │ a COMPLETE, contract-valid
                        ├── manifest.json                            │ package per CONTRACT.md —
                        ├── README.md                                │ produced by build_package.mjs
                        ├── PROMPT.md                                │ (+ verify.mjs copied in, §11)
                        ├── verify.mjs                               ┘
                        └── {slug}-animation.zip   # the downloadable zip (zips the package dir)
```

**Stage formats are single, not sprawled** (spec §10.1): preview frames are **JPEG only**; slice
and package frames are **WebP only**. The backend never scans for a 4-format set at any stage.

### 2.1 `slices/{slice_id}/meta.json` (REQUIRED — the packager's inputs live here)

`build_package.mjs` requires `--duration`, `--fps`, and `--resolution`; the slice is where those
are recorded at finalize time and updated by crop. Without this file, `package` has no inputs.

```json
{
  "slice_id": "s_a1b2c3",
  "duration_s": 8.0,
  "fps_effective": 12,
  "resolution": "1280x720",
  "crop_box": [0, 0, 1280, 720],
  "tier_used": null,
  "origin": "user-supplied video"
}
```

- `duration_s`, `fps_effective` — carried from the originating `preview` request (`fps`,
  `end - start`), adjusted for excluded frames at finalize.
- `resolution` — `"WIDTHxHEIGHT"` of the current WebP frames; **updated by `crop`** to the
  post-crop dimensions.
- `crop_box` — last applied crop `[x, y, w, h]`; `tier_used` — last erase tier (`null` until an
  erase runs).
- These map directly to the packager CLI: `--duration duration_s`, `--fps fps_effective`,
  `--resolution resolution`, `--origin origin`. `manifest.source.*` in the shipped package is
  derived solely from this file (the API never lets the client set source meta directly).

### 2.2 `jobs/{job_id}/meta.json` (job meta — adds `title` + `created_at`)

The job `meta.json` carries the probe results plus two manager-facing fields used by the
§12 management surface:

```json
{
  "job_id": "j_7Kq2",
  "filename": "veo-clip.mp4",
  "title": "veo-clip.mp4",
  "created_at": "2026-06-01T17:00:00+00:00",
  "duration_s": 8.0,
  "width": 1280,
  "height": 720,
  "fps": 24.0
}
```

- `title` — display name shown in the job manager. **Defaults to `filename` at upload**;
  renamed by `PUT /api/jobs/{job_id}` (§12.2). `GET /api/jobs` and the manager read
  `title` and fall back to `filename` for jobs created before this field existed.
- `created_at` — ISO-8601 UTC instant recorded **at upload time** (e.g.
  `"2026-06-01T17:00:00+00:00"`). It is the sort key for `GET /api/jobs` ("newest first")
  so a later rename never reorders the list (sorting on `meta.json` mtime would, since
  rename rewrites the file). Jobs with no stored `created_at` fall back to the job-dir
  mtime. Each built package records the same field in its `_hints.json` and falls back to
  the package-dir mtime (§12.4).

---

## 3. URL conventions (every `url` / `*_url` field, in one place)

Every file the API exposes is served by the static `/data/…` route. The `frames:[{name,url}]`
shape recurs in four endpoints (`preview`, `finalize`, `crop`, `erase`) and is defined **once
here**. `name` is always the bare basename; `url` is the absolute path under `/data` (relative to
the server origin), with a `?v=<mtime-epoch-seconds>` cache-buster on mutable frames.

| Field | Value (path under server origin) | Appears in |
|---|---|---|
| `thumb_url` (job) | `/data/jobs/{job_id}/thumb.jpg` | `POST /api/upload`, `GET /api/jobs` |
| preview frame `url` | `/data/jobs/{job_id}/previews/{preview_id}/{name}` (`name` = `frame_NNN.jpg`) | `POST …/preview` |
| slice frame `url` | `/data/jobs/{job_id}/slices/{slice_id}/{name}?v={mtime}` (`name` = `frame_NNN.webp`) | `finalize`, `crop`, `erase` |
| `download_url` (slice latest) | `/api/jobs/{job_id}/slices/{slice_id}/package/download` | `POST …/package` |
| `preview_url` | `/data/jobs/{job_id}/slices/{slice_id}/packages/{package_id}/index.html` | `POST …/package` |
| `thumb_url` (package) | `/data/jobs/{job_id}/slices/{slice_id}/packages/{package_id}/frames/frame_000.webp` | `GET …/packages` |
| `download_url` (per-package) | `/data/jobs/{job_id}/slices/{slice_id}/packages/{package_id}/{slug}-animation.zip` | `GET …/packages` |

- The `?v={mtime}` suffix is present **only** on slice-frame URLs (crop/erase mutate bytes in
  place). Preview frames are immutable per `preview_id`, so they carry no `?v`.
- `download_url` and `preview_url` are returned by the package endpoint only when the gate passes
  (`verify.pass === true`); otherwise `download_url` and `preview_url` are `null` (see §7/§9.2).
- **Two `download_url` forms exist.** The `POST …/package` response and `GET …/package/download`
  (§8.1) use the **slice-latest** form, which serves the slice's most-recent passing package.
  The §12.4 `GET …/packages` listing instead exposes a **per-package static zip** path so a row
  always downloads its own package; it is `null` when that package failed its gate (no zip was
  written — §7.3). A package's `thumb_url` is its existing `frames/frame_000.webp` (never copied
  or regenerated); it is `null` only for a package missing that frame.
- A `{name, url}` frames array is always ordered by ascending frame index (`frame_000` first).

---

## 4. Endpoint index

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | POST | `/api/upload` | Upload a video; probe meta; make thumbnail. |
| 2 | GET  | `/api/jobs/{job_id}` | Job meta + its slices. |
| 3 | POST | `/api/jobs/{job_id}/preview` | ffmpeg-extract JPEG preview frames for a trim range. |
| 4 | POST | `/api/jobs/{job_id}/finalize` | Keep selected preview frames → WebP slice. |
| 5 | POST | `/api/jobs/{job_id}/slices/{slice_id}/crop` | Auto or manual crop (in place). |
| 6 | POST | `/api/jobs/{job_id}/slices/{slice_id}/erase` | Two-tier inpaint erase (in place). |
| 7 | POST | `/api/jobs/{job_id}/slices/{slice_id}/package` | Build package via `build_package.mjs`, gate via `verify.mjs`. |
| 8 | GET  | `/api/jobs/{job_id}/slices/{slice_id}/package/download` | Download the package zip. |
| 9 | GET  | `/api/share` | Local / LAN / Tailscale URLs. |
| 10 | GET  | `/api/jobs` | List ALL jobs (newest first) for the manager. |
| 11 | PUT  | `/api/jobs/{job_id}` | Rename a job (set its `title`). |
| 12 | DELETE | `/api/jobs/{job_id}` | Delete a job (remove its dir). |
| 13 | GET  | `/api/jobs/{job_id}/packages` | List all packages built under a job. |
| 14 | DELETE | `/api/jobs/{job_id}/packages/{package_id}` | Delete one built package. |
| — | GET  | `/data/{job_id}/…` | Static frame/thumb serving. |
| — | GET  | `/` and `/assets/…` | Built frontend (`frontend/dist`). |

---

## 5. Job lifecycle endpoints

### 5.1 `POST /api/upload`

Upload a single video. `multipart/form-data`, field name **`file`**.

**Request:** `multipart/form-data`, one part `file` = the video binary
(`video/mp4`, `video/quicktime`, `video/webm`; others rejected with 415).

**Action:** store as `data/jobs/{job_id}/video.mp4`; `ffprobe` for duration/dimensions/fps;
`ffmpeg` a poster `thumb.jpg` (first decodable frame, ~0.5s with a 0.0s fallback to avoid a
black opener; served as `thumb_url`); write `meta.json`, seeding `title` (= `filename`) and
`created_at` (ISO-8601 UTC) for the §12 manager.

**200 response:**
```json
{
  "job_id": "j_7Kq2",
  "filename": "veo-clip.mp4",
  "duration_s": 8.0,
  "width": 1280,
  "height": 720,
  "fps": 24.0,
  "thumb_url": "/data/jobs/j_7Kq2/thumb.jpg"
}
```
| Field | Type | Notes |
|---|---|---|
| `job_id` | string | Opaque server-generated id. |
| `filename` | string | Original client filename (display only). |
| `duration_s` | number | From `ffprobe`. |
| `width`, `height` | integer | Source pixel dimensions. |
| `fps` | number | Source frame rate (informational; the user picks slice fps later). |
| `thumb_url` | string | Per §3. |

**Errors:** `400` no `file` part / traversal; `415` unsupported media type;
`422` unreadable/corrupt video (ffprobe failure); `500` thumbnail/storage failure.

### 5.2 `GET /api/jobs/{job_id}`

Fetch job meta and the list of slices created under it.

**200 response:**
```json
{
  "job_id": "j_7Kq2",
  "filename": "veo-clip.mp4",
  "duration_s": 8.0,
  "width": 1280,
  "height": 720,
  "slices": [
    { "slice_id": "s_a1b2c3", "frame_count": 48, "has_package": true }
  ]
}
```
| Field | Type | Notes |
|---|---|---|
| `slices[].slice_id` | string | Opaque slice id. |
| `slices[].frame_count` | integer | Current WebP frame count in the slice. |
| `slices[].has_package` | boolean | `true` iff at least one package dir exists with a passing build. |

**Errors:** `404` unknown `job_id`.

---

## 6. Slice creation endpoints

### 6.1 `POST /api/jobs/{job_id}/preview`

Extract JPEG preview frames for a trim range via the ffmpeg `fps` filter. Cheap, disposable,
re-runnable; does NOT create a slice.

**Request:**
```json
{ "start": 0.0, "end": 8.0, "fps": 12 }
```
| Field | Type | Required | Constraint |
|---|---|---|---|
| `start` | number | yes | `≥ 0`, `< end`. |
| `end` | number | yes | `≤ duration_s`. |
| `fps` | number | yes | `> 0` (typically 3 / 6 / 12 or custom). |

**Constraint (enforced server-side):** `end - start ≤ MAX_SLICE_SECONDS`. A range exceeding the
ceiling is rejected with **422** (the server does not silently clamp — the frontend clamps the
slider; the backend rejects out-of-contract values so the two never disagree silently).

**Action:** `ffmpeg -ss start -to end -vf fps={fps}` → `previews/{preview_id}/frame_NNN.jpg`.

**200 response:**
```json
{
  "preview_id": "p_3f9",
  "count": 96,
  "frames": [
    { "name": "frame_000.jpg", "url": "/data/jobs/j_7Kq2/previews/p_3f9/frame_000.jpg" }
  ]
}
```
| Field | Type | Notes |
|---|---|---|
| `preview_id` | string | Opaque; addresses this extraction for `finalize`. |
| `count` | integer | Number of preview frames = `frames.length`. |
| `frames` | array | `{name, url}` per §3 (JPEG; no `?v`). |

**Errors:** `404` unknown `job_id`; `422` `end - start > MAX_SLICE_SECONDS`, `start ≥ end`,
`end > duration_s`, or `fps ≤ 0`; `500` ffmpeg failure.

### 6.2 `POST /api/jobs/{job_id}/finalize`

Promote a preview into a durable WebP **slice**: copy the kept frames (drop excluded), convert to
WebP at `WEBP_QUALITY`, re-number to contiguous zero-padded `frame_NNN.webp`, and write the slice
`meta.json` (§2.1).

**Request:**
```json
{ "preview_id": "p_3f9", "excluded": ["frame_004.jpg", "frame_005.jpg"] }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `preview_id` | string | yes | A preview belonging to this job. |
| `excluded` | string[] | yes (may be `[]`) | Bare preview-frame basenames to drop (hallucinated/bad frames). |

**Action:** kept preview frames (preview set minus `excluded`) → WebP q`WEBP_QUALITY` →
`slices/{slice_id}/frame_NNN.webp`, **re-indexed contiguously from `frame_000`** after exclusion.
Records `fps_effective`, `duration_s`, `resolution` into the slice `meta.json`.

**200 response:**
```json
{
  "slice_id": "s_a1b2c3",
  "count": 48,
  "frames": [
    { "name": "frame_000.webp", "url": "/data/jobs/j_7Kq2/slices/s_a1b2c3/frame_000.webp?v=1717262400" }
  ]
}
```
| Field | Type | Notes |
|---|---|---|
| `slice_id` | string | Opaque; addresses crop/erase/package. |
| `count` | integer | Final WebP frame count (= kept frames). |
| `frames` | array | `{name, url}` per §3 (WebP, with `?v`). |

**Errors:** `404` unknown `job_id` or `preview_id`; `422` `excluded` names not in the preview, or
zero kept frames (a slice needs ≥1 frame); `500` WebP conversion failure.

---

## 7. Slice operation endpoints

All three operate on `slices/{slice_id}/frame_*.webp` **in place** and return the refreshed frame
list (`{name, url}` with bumped `?v`).

### 7.1 `POST …/slices/{slice_id}/crop`

**Request:**
```json
{ "mode": "auto" }
```
or
```json
{ "mode": "manual", "box": [120, 0, 1040, 720] }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `mode` | `"auto"` \| `"manual"` | yes | `auto` = OpenCV contour/threshold + watermark-symmetry enforcer; `manual` requires `box`. |
| `box` | `[x, y, w, h]` (integers) | iff `mode==="manual"` | Crop rectangle; must lie within current frame bounds. |

**Action:** apply the crop to every frame (same filenames); update `slices/{slice_id}/meta.json`
`crop_box` and `resolution` to the post-crop dimensions.

**200 response:**
```json
{
  "ok": true,
  "crop_box": [120, 0, 1040, 720],
  "frames": [
    { "name": "frame_000.webp", "url": "/data/jobs/j_7Kq2/slices/s_a1b2c3/frame_000.webp?v=1717262500" }
  ]
}
```
| Field | Type | Notes |
|---|---|---|
| `ok` | boolean | Always `true` on a 200 (failures are error envelopes, not `ok:false`). |
| `crop_box` | `[x,y,w,h]` | The box actually applied (for `auto`, the computed box). |
| `frames` | array | `{name, url}` per §3 (bumped `?v`). |

**Errors:** `404` unknown job/slice; `422` `mode==="manual"` without a valid in-bounds `box`,
or `box` not 4 integers; `500` OpenCV failure.

### 7.2 `POST …/slices/{slice_id}/erase`

Two-tier inpaint erase (spec §6): premium LaMa/IOPaint when importable, else enhanced-OpenCV
baseline; both feathered + temporally coherent. The tier is auto-selected unless forced.

**Request:**
```json
{ "box": [980, 640, 280, 60], "tier": "auto" }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `box` | `[x, y, w, h]` (integers) | yes | Region to erase, within frame bounds. |
| `tier` | `"auto"` \| `"baseline"` \| `"premium"` | no (default `"auto"`) | `auto` = premium if IOPaint importable else baseline; `premium` requested but **falls back to baseline** if IOPaint is unavailable (never errors on that account — the response reports the tier actually used). |

**Action:** inpaint the `box` across all frames in place; update `meta.json` `tier_used`.

**200 response:**
```json
{
  "ok": true,
  "tier_used": "baseline",
  "frames": [
    { "name": "frame_000.webp", "url": "/data/jobs/j_7Kq2/slices/s_a1b2c3/frame_000.webp?v=1717262600" }
  ]
}
```
| Field | Type | Notes |
|---|---|---|
| `ok` | boolean | Always `true` on a 200. |
| `tier_used` | `"baseline"` \| `"premium"` | The tier that actually ran (never `"auto"`). |
| `frames` | array | `{name, url}` per §3 (bumped `?v`). |

**Errors:** `404` unknown job/slice; `422` `box` missing / not 4 integers / out of bounds, or
invalid `tier` value; `500` inpaint failure.

### 7.3 `POST …/slices/{slice_id}/package`

**The endpoint that reuses the frozen kernel.** It does NOT reimplement packaging. It:
1. shells `node package-contract/build_package.mjs --frames <slice dir> --out <pkg dir> --id {slug}
   --duration {meta.duration_s} --fps {meta.fps_effective} --resolution {meta.resolution}
   --quality {WEBP_QUALITY} --origin {meta.origin}` to produce a complete package (frames/,
   index.html, manifest.json, README.md, PROMPT.md);
2. copies `package-contract/verify.mjs` into the package dir (the kernel does **not** emit it) so
   the shipped package is contract-complete;
3. shells `node verify.mjs` inside the package dir, parses its per-gate stdout (§11.2) into
   `gates`, and zips the package dir to `{slug}-animation.zip`.

Full invocation detail in **§11**.

**Request (all fields optional):**
```json
{ "slug": "hero-loop", "headline": "Built in Hawaiʻi", "accent": "oklch(60% 0.25 350)" }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | no | Package id → mapped to `build_package.mjs --id`. Sanitized to `^[a-z0-9-]{1,64}$` (kebab); default derived from the job filename. |
| `headline` | string | no | **Accepted but not injected at build time.** The package is brand-neutral (`CONTRACT.md` "Brand neutrality"); headline/copy live in downstream `safe_zones`. Stored as a reserved hint in the package record; the frozen kernel has no copy arg. |
| `accent` | string | no | Same as `headline`: accepted, **not** baked into the package (accent is a `safe_zone`). Reserved hint only; not passed to the kernel. |

**200 response (gate passed):**
```json
{
  "package_id": "pkg_x1",
  "verify": {
    "pass": true,
    "gates": [
      { "id": "G1", "pass": true, "detail": "48 referenced frame(s), all present" },
      { "id": "G2", "pass": true, "detail": "48 frames frame_000…frame_047, contiguous; count matches manifest" },
      { "id": "G3", "pass": true, "detail": "no external/scratch asset leaks; relative ./frames/ refs only" },
      { "id": "G4", "pass": true, "detail": "all 5 technique markers present" },
      { "id": "G5", "pass": true, "detail": "schema ok; fingerprint matches (0a1b2c3d4e5f…)" },
      { "id": "G6", "pass": true, "detail": "README.md 96 lines; Iframe / React / Vanilla headings present" },
      { "id": "G7", "pass": true, "detail": "count 48 within [1, 200]; total 1.76 MB" }
    ]
  },
  "frame_count": 48,
  "weight_mb": 1.84,
  "lane": "hero",
  "download_url": "/api/jobs/j_7Kq2/slices/s_a1b2c3/package/download",
  "preview_url": "/data/jobs/j_7Kq2/slices/s_a1b2c3/packages/pkg_x1/index.html"
}
```

**200 response (gate FAILED — still 200, not an error):**
```json
{
  "package_id": "pkg_x2",
  "verify": {
    "pass": false,
    "gates": [
      { "id": "G7", "pass": false, "detail": "frame count 240 exceeds hard cap 200" }
    ]
  },
  "frame_count": 240,
  "weight_mb": 9.1,
  "lane": "over",
  "download_url": null,
  "preview_url": null
}
```
| Field | Type | Notes |
|---|---|---|
| `package_id` | string | Opaque; addresses the package dir. |
| `verify.pass` | boolean | `true` iff `verify.mjs` exited 0 (all gates passed). |
| `verify.gates` | array | One `{id, pass, detail}` per gate G1–G7, parsed from `verify.mjs` stdout (§11.2). `detail` is the gate's human-readable line(s). |
| `frame_count` | integer | Frames in the built package. |
| `weight_mb` | number | Total package weight in MB (2-dp). |
| `lane` | `"hero"` \| `"scrollytelling"` \| `"over"` | Derived from §1.1 (`hero` 20–80, `scrollytelling` 81–200, `over` >200). |
| `download_url` | string \| null | Per §3 — **`null` when `verify.pass === false`** ("refuse to declare success" — a failed package is never offered for download). |
| `preview_url` | string \| null | Per §3 — **`null` when `verify.pass === false`**. |

**Errors:** `404` unknown job/slice; `422` slice has zero frames or `meta.json` missing required
packager inputs; `500` `build_package.mjs` crashed (non-gate failure — e.g. template missing, node
not found). A **gate** failure is NOT a 500: it is a `200` with `verify.pass:false` (above).

---

## 8. Package download, share, static

### 8.1 `GET /api/jobs/{job_id}/slices/{slice_id}/package/download`

Stream the built package zip.

**200 response:** `Content-Type: application/zip`,
`Content-Disposition: attachment; filename="{slug}-animation.zip"`, body = the zip bytes.

**Errors:** `404` no package built for this slice, **or** the latest package failed its gate (a
failed package has no `download_url` and is not downloadable — returns `404`).

### 8.2 `GET /api/share`

Surface the URLs the app is reachable on (spec §4 / §9). Tailscale and LAN are `null` when
unavailable (not on a tailnet / no detectable LAN IP) — never an error.

**200 response:**
```json
{
  "local": "http://localhost:5179",
  "lan": "http://192.168.1.42:5179",
  "tailscale": "http://my-mac.tailnet-name.ts.net:5179"
}
```
| Field | Type | Notes |
|---|---|---|
| `local` | string | Always present (`http://localhost:{PORT}`). |
| `lan` | string \| null | LAN IP URL, or `null` if undetectable. |
| `tailscale` | string \| null | Tailnet hostname URL, or `null` if not on a tailnet. |

**Errors:** none under normal operation (degrades to `null` fields). `500` only on an unexpected
host-detection crash.

### 8.3 Static routes (no `/api` prefix)

- `GET /data/{job_id}/…` — serves frames, thumbs, preview JPEGs, slice WebPs, and built package
  files from `data/jobs/{job_id}/…`. Read-only. Rejects `..`/absolute/backslash sub-paths with
  `400`. `404` for a missing file. (Note: package files are addressed as
  `/data/jobs/{job_id}/slices/{slice_id}/packages/{package_id}/…` — the `preview_url` form.)
- `GET /` and `GET /assets/…` — serve the built frontend from `frontend/dist` (Vite build). `/`
  returns `index.html`; unknown non-`/api`, non-`/data` GET paths fall back to the SPA
  `index.html` (client-side routing). No frontend route shadows `/api` or `/data`.

---

## 9. Error model (authoritative)

### 9.1 The single envelope

Every non-2xx response body is exactly:
```json
{ "error": "human-readable summary", "detail": "optional machine/debug context" }
```
- `error` — required, short, human-readable (e.g. `"unknown job_id"`).
- `detail` — optional, may carry the validation field path or an underlying exception summary.
- **FastAPI's default `{"detail": [...]}` 422 body is overridden** by an app-level exception
  handler that re-shapes validation errors into this envelope, so "single error shape" holds for
  request-validation errors too (the original field info is folded into `detail`).

### 9.2 Status codes

| Status | When |
|---|---|
| `200` | Success — including `POST …/package` with `verify.pass:false` (a gate failure is a successful API call reporting a failed gate, not an HTTP error). |
| `400` | Malformed request, missing required part, or path-traversal in an id / `/data` sub-path. |
| `404` | Unknown `job_id` / `preview_id` / `slice_id` / `package_id`, or a missing static file / undownloadable (failed) package. |
| `415` | Unsupported upload media type. |
| `422` | Semantically invalid request: `end - start > MAX_SLICE_SECONDS`, `start ≥ end`, out-of-bounds `box`, excluded names not in preview, zero-frame slice, corrupt/unprobeable video. |
| `500` | Unexpected server/tool failure: ffmpeg/ffprobe/OpenCV/WebP crash, or `build_package.mjs` crash (non-gate). |

A **gate** failure never produces 4xx/5xx — it is the §7.3 `200` with `verify.pass:false` and
`download_url:null`.

---

## 10. State & concurrency (notes, non-normative)

- Job/slice state is the on-disk layout (§2) plus an in-memory `JobStore` index; no database.
  One session = one working clip; a minimal recents list (from `data/jobs/`) is acceptable.
- `crop`/`erase` mutate frames in place; the `?v=<mtime>` cache-buster (§3) is the contract that
  lets the frontend invalidate stale frame images without a separate "version" field.
- Re-running `preview`/`finalize`/`package` creates a **new** `preview_id`/`slice_id`/`package_id`
  (it does not overwrite a prior one); `crop`/`erase` reuse the slice in place.

---

## 11. Packager invocation (the reuse contract, in full)

The `package` endpoint (§7.3) is a thin orchestrator over the two frozen Node kernels. It owns
**no** packaging logic.

### 11.1 Build + gate steps

```
# (a) BUILD — reuse build_package.mjs (does NOT reimplement manifest/fingerprint/player/zip-internal)
node package-contract/build_package.mjs \
     --frames data/jobs/{job_id}/slices/{slice_id} \
     --out    data/jobs/{job_id}/slices/{slice_id}/packages/{package_id} \
     --id         {sanitized slug} \
     --duration   {slice meta.duration_s} \
     --fps        {slice meta.fps_effective} \
     --resolution {slice meta.resolution} \
     --quality    {WEBP_QUALITY} \
     --origin     {slice meta.origin}

# (b) MAKE CONTRACT-COMPLETE — build_package.mjs writes index.html/manifest.json/README.md/PROMPT.md
#     and frames/, but NOT verify.mjs. Copy the frozen gate in so the shipped zip is self-verifying.
cp package-contract/verify.mjs  data/jobs/{job_id}/slices/{slice_id}/packages/{package_id}/verify.mjs

# (c) GATE — reuse verify.mjs (the single G1–G7 source of truth); parse stdout → gates[]; exit code → pass
node verify.mjs            # run with cwd = the package dir (or pass the dir as argv[2])
```

- `slug` is sanitized to `^[a-z0-9-]{1,64}$` before becoming `--id`. `headline`/`accent` are NOT
  passed (frozen kernel has no such args; they are downstream `safe_zone` concerns — §7.3).
- The backend does NOT re-derive the fingerprint, manifest, or player markers — those come out of
  `build_package.mjs`, and `verify.mjs` independently recomputes/validates them (G5).

### 11.2 Parsing `verify.mjs` output into `gates[]`

`verify.mjs` emits **line-oriented text, not JSON**: one header line per gate
`[PASS|FAIL] G{n}  {title}`, indented detail lines beneath, and a final `RESULT: PASS|FAIL`; it
**exits 0 iff all gates pass, 1 otherwise**. The backend `verify_runner`:

- maps `verify.pass` ← (exit code === 0);
- for each `[PASS|FAIL] G{n}  {title}` line, emits `{ id: "G{n}", pass: (token==="PASS"),
  detail: <the indented detail line(s) for that gate, joined> }`;
- preserves gate order G1…G7.

This is why the §7.3 `gates[]` array is real and not invented: it is a faithful re-shaping of
`verify.mjs`'s actual stdout. The gate semantics (which gate fails when) are frozen in
`package-contract/CONTRACT.md §6` and are not redefined here.

---

## 12. Management surface (jobs & packages)

The manager lets the user browse and curate everything they have sliced: list all jobs, rename
or delete a job, and list or delete the packages built under a job. These endpoints add **no**
new packaging or slicing logic — they enumerate the on-disk layout (§2) and reuse the existing
packager/budget helpers for each package's summary. All ids are validated (§0) before any
filesystem access; every error is the §9 envelope.

**Ordering is `created_at` descending ("newest first")**, not directory mtime — a rename
rewrites `meta.json`, and sorting on mtime would reshuffle the renamed job to the top. Jobs and
packages created before `created_at` existed fall back to their directory mtime so legacy data
still lists in a sensible order (§2.2).

### 12.1 `GET /api/jobs`

List **all** jobs, newest first. Backs the manager grid.

**200 response:**
```json
{
  "jobs": [
    {
      "job_id": "j_7Kq2",
      "title": "Built in Hawaiʻi",
      "created_at": "2026-06-01T17:00:00+00:00",
      "thumb_url": "/data/jobs/j_7Kq2/thumb.jpg",
      "duration_s": 8.0,
      "resolution": "1280x720",
      "slice_count": 2,
      "package_count": 3
    }
  ]
}
```
| Field | Type | Notes |
|---|---|---|
| `job_id` | string | Opaque job id. |
| `title` | string | Display name; `meta.title` or, for legacy jobs, `filename` (§2.2). |
| `created_at` | string | ISO-8601 UTC; the sort key (descending). Dir-mtime fallback for legacy jobs. |
| `thumb_url` | string | Job poster, per §3 (`/data/jobs/{job_id}/thumb.jpg`). |
| `duration_s` | number | From the job meta. |
| `resolution` | string \| null | `"WIDTHxHEIGHT"` from the job meta (`null` if dimensions unknown). |
| `slice_count` | integer | Number of slices under the job. |
| `package_count` | integer | Total built package dirs across all slices (passing **and** failed). |

**Errors:** none under normal operation (an empty install returns `{ "jobs": [] }`).

### 12.2 `PUT /api/jobs/{job_id}`

Rename a job (set its display `title`). Does **not** touch `created_at`, so the list order is
stable across renames.

**Request:**
```json
{ "title": "Hero loop — final" }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Non-empty after trimming; written to `meta.title`. |

**Action:** read `meta.json`, set `title`, write it back.

**200 response:**
```json
{ "ok": true, "title": "Hero loop — final" }
```

**Errors:** `400` malformed `job_id`; `404` unknown `job_id`; `422` missing / empty / non-string
`title`.

### 12.3 `DELETE /api/jobs/{job_id}`

Delete a job and everything under it (`rmtree` of `data/jobs/{job_id}/`).

**200 response:**
```json
{ "ok": true }
```

**Errors:** `400` malformed `job_id`; `404` unknown `job_id`.

### 12.4 `GET /api/jobs/{job_id}/packages`

List every package built under a job, across **all** its slices, newest first. Each row's summary
reuses the existing kernels: `frame_count` from the package's own `frames/`, `weight_mb` from the
packager's whole-package weigher, `lane` from the budget classifier (§1.1).

**200 response:**
```json
{
  "packages": [
    {
      "package_id": "pkg_x1",
      "slice_id": "s_a1b2c3",
      "created_at": "2026-06-01T17:05:00+00:00",
      "frame_count": 48,
      "weight_mb": 1.84,
      "lane": "hero",
      "thumb_url": "/data/jobs/j_7Kq2/slices/s_a1b2c3/packages/pkg_x1/frames/frame_000.webp",
      "download_url": "/data/jobs/j_7Kq2/slices/s_a1b2c3/packages/pkg_x1/hero-loop-animation.zip"
    }
  ]
}
```
| Field | Type | Notes |
|---|---|---|
| `package_id` | string | Opaque package id. |
| `slice_id` | string | The slice this package was built from. |
| `created_at` | string | ISO-8601 UTC (from the package `_hints.json`); the sort key (descending). Pkg-dir mtime fallback. |
| `frame_count` | integer | Frames in **this package's** `frames/` (not the slice's current frames). |
| `weight_mb` | number | Whole-package weight in MB (2-dp), excluding the built zip. |
| `lane` | `"hero"` \| `"scrollytelling"` \| `"over"` | Per §1.1, from `frame_count`. |
| `thumb_url` | string \| null | The package's `frames/frame_000.webp` (per §3); `null` if that frame is missing. |
| `download_url` | string \| null | **Per-package** static zip (per §3); `null` when the package failed its gate (no zip written). |

**Errors:** `400` malformed `job_id`; `404` unknown `job_id` (a job with no packages returns
`{ "packages": [] }`).

### 12.5 `DELETE /api/jobs/{job_id}/packages/{package_id}`

Delete one built package. The path carries no `slice_id` (a `package_id` is unique within a job),
so the server scans the job's slices for the one owning `packages/{package_id}` and `rmtree`s it.

**200 response:**
```json
{ "ok": true }
```

**Errors:** `400` malformed `job_id` / `package_id`; `404` unknown `job_id`, or no package with
that `package_id` under any of the job's slices.
