# CONTRACT.md — seo-video-slicer Package Contract (FROZEN)

**Status:** FROZEN. This is the single source of truth for THIS workflow. The player
(`index.html`), the gate (`verify.mjs`), and the packager kernel (`packager.py`) all
build to this document. Three independent implementations of these three components
**must agree** wherever this contract says "byte-for-byte" or "verbatim."

**Authority:** spec §8 (`docs/specs/seo-video-slicer-spec.md`, lines 168–198) and the
Frozen Contracts table in `docs/plans/implementation-plan.md`. Where this file restates
those, it is a verbatim lock, not a paraphrase. If they ever disagree, the spec wins and
this file is corrected to match.

**Scope of "byte-for-byte agreement":** It applies to (a) the `fingerprint.value` for a
given frame set + GSAP state + templateId, and (b) the injected `FRAMES` array line in
`index.html`. It does **not** require two builds to produce identical whole `manifest.json`
bytes — `id`, `created_at`, and `source` legitimately vary per build and are deliberately
outside the fingerprint.

**Brand neutrality:** the exported player is brand-NEUTRAL (near-black stage, frames are the
hero, optional restrained system-font headline). It is NOT the app's Impeccable magenta chrome.
Downstream customizes accent/copy via `safe_zones`. The package never imposes a brand accent on
the host site.

**Zero external requests by default:** the default player ships a no-dependency
`requestAnimationFrame` scroll binding and makes **zero** network requests. GSAP ScrollTrigger
from cdnjs is the ONLY external request ever permitted, and it is optional and OFF by default.

---

## 1. PACKAGE_SCHEMA — `manifest.json`

The manifest's `schema` field is the exact string **`"seo-video-slicer.package.v1"`**.
Every field below is required unless marked optional. Shape is locked.

### 1.1 Field table

| Path | Type | Required | Notes |
|---|---|---|---|
| `schema` | string | yes | Exactly `"seo-video-slicer.package.v1"`. |
| `id` | string | yes | Package slug (e.g. `"hero-loop"`). Per-build; NOT in fingerprint. |
| `created_at` | string (ISO-8601) | yes | UTC timestamp. Per-build; NOT in fingerprint. |
| `source.duration_s` | number | yes | Source clip duration in seconds. |
| `source.fps_effective` | number | yes | Effective frames-per-second after slicing. |
| `source.resolution` | string | yes | `"WIDTHxHEIGHT"`, e.g. `"1280x720"`. |
| `source.origin` | string | yes | Provenance, e.g. `"user-supplied video"`. |
| `frames.count` | integer | yes | Number of frame files. MUST equal actual file count (G2). |
| `frames.pattern` | string | yes | Exactly `"frames/frame_NNN.webp"`. |
| `frames.format` | string | yes | Exactly `"webp"`. |
| `frames.quality` | integer | yes | WebP encode quality, 82–90. |
| `player.canonical` | string | yes | Exactly `"index.html"`. |
| `player.interaction` | string | yes | Exactly `"scroll"`. |
| `player.dependencies.gsap` | string | yes | `"3.12.2 (optional)"` when GSAP is wired but off; same default string even when not loaded. The fingerprint reads the URL from `index.html`, NOT this string. |
| `player.reduced_motion` | boolean | yes | `true` — player honors `prefers-reduced-motion`. |
| `player.template_id` | string | yes | Exactly `"seo-video-slicer.scroll.v1"`. Mirrors the `data-template-id` attribute in `index.html`; the fingerprint reads it from the HTML attribute, not from here. |
| `customization.locked_zones` | string[] | yes | See §1.3. Do-not-touch list for downstream. |
| `customization.safe_zones` | string[] | yes | See §1.3. Customizable list for downstream. |
| `seo.lcp_safe` | boolean | yes | `true`. |
| `seo.total_bytes` | integer | yes | Sum of byte sizes of all files in the package. Computed by packager. Informational; NOT in fingerprint; G7 re-measures bytes independently rather than trusting this value. |
| `seo.lazy_loadable` | boolean | yes | `true`. |
| `fingerprint.algorithm` | string | yes | Exactly `"sha256"`. |
| `fingerprint.value` | string | yes | Lowercase hex SHA-256 from FINGERPRINT_RECIPE (§2). |

### 1.2 Canonical example

```json
{
  "schema": "seo-video-slicer.package.v1",
  "id": "hero-loop",
  "created_at": "2026-06-01T18:00:00Z",
  "source": {
    "duration_s": 8.0,
    "fps_effective": 12,
    "resolution": "1280x720",
    "origin": "user-supplied video"
  },
  "frames": {
    "count": 48,
    "pattern": "frames/frame_NNN.webp",
    "format": "webp",
    "quality": 82
  },
  "player": {
    "canonical": "index.html",
    "interaction": "scroll",
    "dependencies": { "gsap": "3.12.2 (optional)" },
    "reduced_motion": true,
    "template_id": "seo-video-slicer.scroll.v1"
  },
  "customization": {
    "locked_zones": [
      "frames/*.webp bytes",
      "frame_NNN zero-pad ordering",
      "cover-fit single-canvas render",
      "reduced-motion fallback",
      "player data-template-id"
    ],
    "safe_zones": [
      "accent color",
      "headline/overlay copy",
      "scroll distance",
      "easing",
      "container height",
      "framework wrapper"
    ]
  },
  "seo": { "lcp_safe": true, "total_bytes": 1843200, "lazy_loadable": true },
  "fingerprint": {
    "algorithm": "sha256",
    "value": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

### 1.3 LOCKED_ZONES / SAFE_ZONES (frozen string arrays)

`locked_zones` (downstream must NOT change): exactly
`["frames/*.webp bytes", "frame_NNN zero-pad ordering", "cover-fit single-canvas render", "reduced-motion fallback", "player data-template-id"]`

`safe_zones` (downstream MAY change): exactly
`["accent color", "headline/overlay copy", "scroll distance", "easing", "container height", "framework wrapper"]`

---

## 2. FINGERPRINT_RECIPE (verbatim — packager and verify.mjs share this)

Both `verify.mjs` and the packager MUST use this function **verbatim, character for
character**. The `import` line is part of the recipe: Node's *global* `crypto` is Web Crypto
and has **no** `createHash`; `createHash` lives only on the `node:crypto` module. Omitting the
import throws at runtime.

```js
import crypto from 'node:crypto';

function fingerprint(frameBasenames, gsapUrlOrEmpty, templateId) {
  const payload = JSON.stringify({ frames: frameBasenames, gsap: gsapUrlOrEmpty, templateId });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
```

(The packager may implement this in Python instead, but it MUST reproduce the **exact same
payload bytes**: `JSON.stringify` with key order `frames`, `gsap`, `templateId`, no whitespace,
double-quoted strings — i.e. `json.dumps(obj, separators=(',', ':'))` over an ordered dict with
that exact key order — then `hashlib.sha256(payload.encode()).hexdigest()`.)

### 2.1 The three inputs — exact definitions

- **`frameBasenames`** — a **sorted array of bare frame file basenames**, e.g.
  `["frame_000.webp", "frame_001.webp", "frame_002.webp"]`.
  - **BARE basenames only.** No directory prefix, no `./`, no `frames/`. The extension `.webp`
    IS included. (This is deliberately **different** from the player's `FRAMES` array, which
    carries full relative paths — see §2.2, the #1 divergence trap.)
  - Sort order: default lexicographic (`Array.prototype.sort()` with no comparator / Python
    `sorted()`). For 3-digit zero-padded names this equals numeric order up to `frame_999`.

- **`gsapUrlOrEmpty`** — the GSAP CDN URL **if and only if the player actually loads GSAP**,
  else the empty string `""`. The default package ships `""` (no GSAP, zero network). This value
  is the URL string present in `index.html`'s GSAP `<script src="...">`, or `""` if absent.

- **`templateId`** — exactly `"seo-video-slicer.scroll.v1"`, read from the
  `data-template-id` attribute on the player root in `index.html`.

### 2.2 #1 DIVERGENCE TRAP — FRAMES paths vs fingerprint basenames

These are two different representations of the same ordered frame list. Do NOT cross them.

| Consumer | Representation | Example element |
|---|---|---|
| Player `FRAMES` array (injected into HTML) | full relative path | `"./frames/frame_000.webp"` |
| `fingerprint(frameBasenames, …)` input | bare basename | `"frame_000.webp"` |

Feeding `"./frames/frame_000.webp"` into the fingerprint silently breaks G5 parity. The
packager derives `frameBasenames` from bare filenames; `verify.mjs` derives them from
`fs.readdirSync('frames')` (basenames already bare) then sorts.

### 2.3 Recompute sources for G5 (where verify.mjs reads each input)

For packager-side and verify-side to agree, `verify.mjs` recomputes over the package as follows:

- `frameBasenames` ← list the `frames/` directory, keep only `frame_NNN.webp` entries, `.sort()`.
- `gsapUrlOrEmpty` ← scan `index.html` for a GSAP CDN `<script src>`; use that URL if present, else `""`.
- `templateId` ← parse the `data-template-id="..."` attribute value from `index.html`.

`verify.mjs` then calls `fingerprint(...)` and compares the result to `manifest.fingerprint.value`.
Mismatch ⇒ **G5 fails** and `verify.mjs` exits non-zero.

### 2.4 Frozen invariants

- Object-literal key order in the payload is **`frames`, `gsap`, `templateId`** and MUST NOT be
  reordered — key order changes the bytes and therefore the hash.
- `JSON.stringify` is called with no replacer and no spacer (compact, no whitespace).
- Output is lowercase hex (`digest('hex')`).

---

## 3. FRAME_NAMING

- Filename pattern: `frame_%03d.webp` → `frame_000.webp`, `frame_001.webp`, …, `frame_NNN.webp`.
- **Zero-indexed**, starting at `frame_000`. Zero-padded to **3 digits**.
- **Contiguous, no gaps.** The set is exactly `frame_000 … frame_(count-1)`.
- All frames live in `frames/`. Format is WebP, quality 82–90.
- `manifest.frames.count` MUST equal the actual number of frame files (G2).

---

## 4. WEIGHT_BUDGET (single source constant)

Two thresholds. Only one is a hard failure; the rest are advisory warnings.

| Rule | Threshold | verify.mjs effect |
|---|---|---|
| **Frame count (HARD)** | `count > 200` ⇒ over budget | **FAILS G7 → exit non-zero** |
| Hero lane | 20–80 frames | informational (in range = ideal) |
| Scrollytelling lane | 81–200 frames | OK; warn if trending high |
| Total package weight (SOFT) | `~4 MB` total | **WARN only** (no exit-code change) |
| Per-frame weight (SOFT) | `> 256 KB` per WebP | **WARN only** — flag oversized frame(s) |

- The **only** condition under which G7 makes `verify.mjs` exit non-zero is **`frames.count > 200`**.
- The `~4 MB` total cap and the `256 KB` per-frame cap are **advisory SOFT caps**: they print a
  warning naming the offending file(s)/total but do not change the exit code, and they are not part
  of the fingerprint.
- These constants are defined once here and mirrored in `backend/app/config.py` (`WEIGHT_BUDGET`,
  `FRAME_BUDGET`). No literal `200` / `4 MB` / `256 KB` anywhere else.

---

## 5. PLAYER_INJECTION_CONTRACT

The packager renders the shipped `index.html` from a template `index.template.html` by a single
deterministic text substitution. Packager and player agree on exactly one marker.

### 5.1 The marker

The template contains this line, verbatim:

```js
    const FRAMES = [/*__SLICER_FRAMES__*/];
```

The packager replaces the token **`/*__SLICER_FRAMES__*/`** (and only that token) with the JSON
array **body** — the comma-separated, double-quoted relative paths, with **no surrounding
brackets** (the brackets already exist in the template) and **no trailing comma**:

```
"./frames/frame_000.webp","./frames/frame_001.webp","./frames/frame_002.webp"
```

Resulting in:

```js
    const FRAMES = ["./frames/frame_000.webp","./frames/frame_001.webp","./frames/frame_002.webp"];
```

### 5.2 Array-body format (frozen)

- Each element: `"./frames/" + basename`, i.e. leading `./frames/`, the `frame_NNN.webp`
  basename, double-quoted.
- Separator: a single comma `,` with **NO surrounding whitespace**; no trailing comma.
- Order: frame index ascending (`frame_000` first). Same order as the sorted basenames.
- Empty edge case (0 frames) is invalid — a package always has ≥1 frame.
- The token is matched as the literal comment `/*__SLICER_FRAMES__*/`. The substitution is a plain
  string replace of that exact substring; nothing else in the template is rewritten.

### 5.3 data-template-id attribute (location + read)

- The player root element carries the attribute **`data-template-id="seo-video-slicer.scroll.v1"`**.
  The player root is the top-level element that hosts the canvas/scroll container (the element the
  player's JS treats as the template anchor).
- `templateId` for the fingerprint (§2) is **read from this attribute's value** in `index.html`.
- The shipped value MUST be exactly `seo-video-slicer.scroll.v1`. The stale value
  `webp_guided_knowledge_2026` is forbidden.

### 5.4 GSAP (optional, off by default)

- Default template ships **no** GSAP script tag ⇒ `gsapUrlOrEmpty = ""`.
- If a build opts into GSAP, the ONLY permitted URL is the GSAP ScrollTrigger CDN on cdnjs, added
  as a `<script src="...">`; that exact URL string becomes `gsapUrlOrEmpty`. No other external
  request is ever permitted.

---

## 6. THE GATES G1–G7 (verbatim, spec §8 lines 187–193)

`node verify.mjs` exits non-zero on any failed gate. Each gate is independently checkable and maps
to a clear pass/fail.

- **G1** — every frame referenced by `index.html` exists in `frames/` (asset closure).
- **G2** — frames are zero-padded, contiguous `frame_000…frame_NNN`, count matches
  `manifest.frames.count`.
- **G3** — `index.html` is self-contained: no `http(s)://…/<local-asset>` leaks, no
  scratch/localhost paths; relative `./frames/…` only (the GSAP cdnjs URL is the sole permitted
  external URL).
- **G4** — `index.html` contains cover-fit render, DPR scaling, preload-with-`onerror`, a
  `prefers-reduced-motion` block, and a stable `data-template-id="seo-video-slicer.scroll.v1"`
  attribute (the `templateId` the fingerprint consumes).
- **G5** — `manifest.json` parses, has `schema` (== `PACKAGE_SCHEMA`) + `fingerprint`; fingerprint
  matches the value recomputed over the package via FINGERPRINT_RECIPE (§2.3).
- **G6** — `README.md` exists, ≤200 lines, has Iframe / React / Vanilla headings. `PROMPT.md`
  optional.
- **G7** — total package weight within budget; each WebP within per-frame budget (flag oversized).
  Per §4: hard-fail only when `frames.count > 200`; total/per-frame caps are warnings.

### 6.1 Pass/fail mapping (clear, independent)

| Gate | FAIL (exit non-zero) when |
|---|---|
| G1 | any path in the player's `FRAMES` array has no matching file in `frames/`. |
| G2 | a gap/missing index, wrong zero-pad, or `count != actual file count`. |
| G3 | any `http(s)://`/`localhost`/scratch/absolute path to a local asset in `index.html` (GSAP cdnjs URL excepted). |
| G4 | any required technique marker absent (cover-fit, DPR, onerror preload, reduced-motion block, or the `data-template-id` attribute). |
| G5 | manifest unparseable, missing `schema`/`fingerprint`, wrong schema string, or recomputed fingerprint ≠ stored value. |
| G6 | `README.md` missing, > 200 lines, or missing any of the Iframe / React / Vanilla headings. |
| G7 | `frames.count > 200`. (Total > ~4 MB or any frame > 256 KB ⇒ warning, not failure.) |

---

## 7. PLAYER REQUIRED TECHNIQUES (locked, spec §8)

The reference `index.html` and every packaged player MUST implement all of:

1. **Single `<canvas>` cover-fit render** — `scale = max(cw/iw, ch/ih)`, image centered. NO
   duplicate blurred background layer.
2. **DPR scaling** — size the canvas backing store by `devicePixelRatio` for retina sharpness.
3. **Parallel preload with `onerror`-tolerant counter** — all frames preloaded concurrently; a 404
   increments the done-counter and never freezes playback.
4. **Frame index = scroll progress × (frameCount − 1)** — clamp to `[0, frameCount-1]`.
5. **rAF scroll binding, no external deps** — default player drives frames via
   `requestAnimationFrame` against scroll progress. Zero network requests by default. GSAP
   ScrollTrigger from cdnjs is the only permitted external request and is optional/off by default.
6. **`prefers-reduced-motion: reduce` → static hero frame** — animation suppressed, a single hero
   frame renders, brand/headline still reads.
7. **`data-template-id="seo-video-slicer.scroll.v1"`** on the player root (anchors G4/G5).
8. **System fonts only; inline CSS/JS; opens with no server.** Brand-neutral near-black stage.

### 7.1 Anti-regression (forbidden — from the old smart-image-animations repo)

The package and player MUST NOT contain any of: `INPAINT_TELEA`; GSAP-studio framing; any
`experience` trigger/effect/easing metadata; the stale schema `smart-image-animations.deliverable-package.v1`;
the stale template id `webp_guided_knowledge_2026`; a blurred background layer; `DEBUG`/`print`
debug output. Default ships rAF with zero network.

---

## 8. Consumer map (who reads what)

| Contract item | Player (`index.html`) | `verify.mjs` | Packager kernel |
|---|---|---|---|
| PACKAGE_SCHEMA (§1) | — | reads/validates (G5) | writes |
| FINGERPRINT_RECIPE (§2) | — | recomputes & compares (G5) | computes & writes |
| FRAME_NAMING (§3) | references via `FRAMES` | checks (G1/G2) | produces |
| WEIGHT_BUDGET (§4) | — | enforces/warns (G7) | reports `total_bytes` |
| PLAYER_INJECTION (§5) | hosts marker + attribute | reads attribute/URL | substitutes marker |
| GATES (§6) | must satisfy | runs | must produce a passing package |
| PLAYER TECHNIQUES (§7) | implements | checks markers (G4) | renders from template |
