# CONTRACT-loop.md — seo-video-slicer Loop Package Contract (`loop.v1`)

**Status:** FROZEN (Phase 0). Sibling to the frozen [`CONTRACT.md`](CONTRACT.md)
(`seo-video-slicer.package.v1` / `scroll.v1`). This file documents the **loop** output
mode and restates **only what differs** from v1; everything shared (frame naming §3,
the weight-budget philosophy §4, the FINGERPRINT_RECIPE §2, the injection contract §5)
is governed by `CONTRACT.md` and referenced, not duplicated. **`CONTRACT.md` is byte-unchanged.**

**Authority:** spec §6 (`docs/specs/remotion-companion-spec.md`). The loop mode never
mutates `seo-video-slicer.package.v1`; it is a **parallel** schema + template id that
coexists with v1. A loop package **cannot** be a `package.v1` manifest — v1 freezes
`schema`, `player.interaction`, and `player.template_id` to scroll values and the gates
enforce them. A parallel schema is the only contract-safe path.

**Naming parallel:** `loop-package.v1 : loop.v1 :: package.v1 : scroll.v1`
(schema : template_id).

---

## 1. Identifiers — the diff from v1

| Identifier | Scroll (frozen v1) | Loop (this contract) |
|---|---|---|
| `manifest.schema` | `seo-video-slicer.package.v1` | `seo-video-slicer.loop-package.v1` |
| `data-template-id` (HTML) / `player.template_id` | `seo-video-slicer.scroll.v1` | `seo-video-slicer.loop.v1` |
| `player.interaction` | `scroll` | `loop` |
| `player.dependencies` | `{ "gsap": "3.12.2 (optional)" }` | `{}` (loop never loads GSAP) |
| template file | `index.template.html` | `index.template.loop.html` |
| README | scroll README | loop README (§5 below) |
| extra gates | — | **G8**, **G9** |

`player.dependencies` is the **honest** value `{}` — the loop player is pure
`requestAnimationFrame` and **never** loads GSAP. The field is kept for v1 shape-parity but
carries no dependency. `gsapUrlOrEmpty` for the fingerprint is therefore always `""`.

---

## 2. FINGERPRINT_RECIPE — reused verbatim

The frozen recipe `fingerprint(frameBasenames, gsapUrlOrEmpty, templateId)`
(`CONTRACT.md` §2) is reused **character-for-character**. For a loop:

- `frameBasenames` — the same bare, sorted `frame_NNN.webp` basenames.
- `gsapUrlOrEmpty` — always `""` (pure rAF, never GSAP).
- `templateId` — `"seo-video-slicer.loop.v1"` (read from the HTML `data-template-id`).

The new `templateId` yields a **distinct, valid** sha256 for free. The recipe stays
**byte-identical between builder and verifier** — the same `fingerprint()` function,
unchanged, in exactly two copies (`build_package.mjs` + `verify.mjs`). No third copy.

> **Gap closed by G8 + G9, not the fingerprint.** `fps` bakes `loop.webp`'s bytes but is
> **not** a fingerprint input, so the frame fingerprint alone cannot detect a re-encoded
> `loop.webp` or a lying `manifest.loop.fps`. G9 binds the recorded sha to the actual
> bytes; G8 binds the actual baked cadence (the ANMF duration **sum**) to
> `manifest.loop.fps`. Together they make `fps ↔ loop.webp bytes ↔ manifest` mutually
> consistent.

### 2.1 `perFrameMs(fps)` — FROZEN cross-language formula

Like the FINGERPRINT_RECIPE, the per-frame duration in milliseconds is **frozen** and must
be **byte-identical** in both the Python baker (`backend/app/loop_export.py`) and the Node
verifier (`verify.mjs` G8):

```
perFrameMs(fps) = floor(1000 / fps + 0.5)   // half-up, deterministic
```

| Language | Code |
|---|---|
| Node   | `const perFrameMs = Math.floor(1000 / fps + 0.5);` |
| Python | `per_frame_ms = math.floor(1000.0 / fps + 0.5)` |

> **Why not `round()`?** Language `round` primitives disagree on the `.5` case. Python's
> builtin `round` is **banker's rounding** (half-to-even); JS `Math.round` is **half-up**.
> At **fps = 16**, `1000/16 == 62.5` → Python `round` = **62**, JS `Math.round` = **63**.
> The baker (Python) would write 62 ms while the verifier (Node) expects 63 ms, and G8 would
> **false-fail** a clean loop. The `floor(x + 0.5)` form is half-up and **deterministic in
> both languages** — 63 ms in both at fps 16 — so it is the single pinned formula. Verified
> at fps 12, 13, 16, 24, 30: the two languages agree on every value.

`loop_export.py` passes this exact integer as Pillow's uniform `duration`; `verify.mjs` G8
uses the identical formula for its expected duration **sum**. Neither file may call a bare
`round`.

---

## 3. Manifest — the `loop` block (outside the fingerprint)

A loop `manifest.json` mirrors v1's shape with the §1 identifiers and adds a top-level
`loop` block (positioned after `player`):

```json
"loop": {
  "fps": 12,
  "duration_s": 2.5,
  "webp": "loop.webp",
  "webp_sha256": "<lowercase hex sha256 of loop.webp bytes>",
  "loop_count": 0
}
```

| Field | Type | Notes |
|---|---|---|
| `loop.fps` | number | fps of the baked animation; **bound to the bytes by G8**. |
| `loop.duration_s` | number | loop length = `frames.count / fps`. |
| `loop.webp` | string | exactly `"loop.webp"`. |
| `loop.webp_sha256` | string | lowercase hex sha256 of `loop.webp` bytes, recorded by the builder, re-checked by G9. |
| `loop.loop_count` | integer | `0` (infinite). |

The `loop` block is **not** part of the frame fingerprint; its integrity is gated by
**G8/G9**. `source.duration_s` for a frames-dir loop equals `frames.count / fps` (a
Remotion frames-dir has no inherent source length, so it equals the loop length).

**Byte ownership.** `backend/app/loop_export.py` (spec §6.7) **produces the `loop.webp`
bytes**; the **Node loop-builder owns** copying it in, computing `webp_sha256`, and writing
the `loop` block + manifest. One owner for the hash + manifest avoids a double-compute/drift
surface.

---

## 4. LOCKED_ZONES / SAFE_ZONES for loop (frozen string arrays)

`locked_zones` = the v1 set **plus** the two loop-immutables (both gated by G8/G9):

```json
[
  "frames/*.webp bytes",
  "frame_NNN zero-pad ordering",
  "cover-fit single-canvas render",
  "reduced-motion fallback",
  "player data-template-id",
  "loop.webp bytes",
  "loop fps"
]
```

`safe_zones` = the v1 set **minus** `"scroll distance"` (a loop does not scroll-scrub)
**plus** `"loop container size"`:

```json
[
  "accent color",
  "headline/overlay copy",
  "easing",
  "container height",
  "framework wrapper",
  "loop container size"
]
```

---

## 5. README (G6 loop README headings)

The loop builder generates a loop-specific `README.md` (the scroll README generator is
untouched). It is **≤200 lines** and MUST contain:

- The **`Iframe`**, **`React`**, and **`Vanilla`** headings (so the frozen G6 heading regex
  still passes — `/^#{1,6}\s.*(iframe|react|vanilla)/im`).
- A **two-tier `<img src="loop.webp" loading="lazy">` embed section** (§6 below): the
  zero-JS `loop.webp` drop-in vs the reduced-motion-aware canvas `index.html`.
- A sample carrying `data-template-id="seo-video-slicer.loop.v1"`.

---

## 6. Two-tier delivery (§6.8)

A loop package ships **both** the frame sequence (+ canvas `index.html`) **and**
`loop.webp`:

- **`loop.webp`** — a zero-JS drop-in: `<img src="loop.webp" loading="lazy">`. Simplest
  embed. **Ignores** `prefers-reduced-motion` (it is an `<img>`).
- **`index.html` (canvas + frames)** — DPR-crisp, controllable, **honors reduced-motion**.
  The tier that satisfies the accessibility rule.

`seo.total_bytes` includes `loop.webp`; **G7 re-measures all package bytes from disk** (it
does not trust `manifest.seo.total_bytes`). The only **hard** fails stay `frames.count > 200`
or `< 1`; an oversized `loop.webp` is a **soft WARN** that names the file and never changes
the exit code.

**`seo.lcp_safe` is weight-derived for loop** (unlike v1 scroll, where it is the frozen literal
`true`). The builder sets `lcp_safe = total_bytes <= ~4 MB` (the §4 soft cap). A loop is a *new*
schema, so the manifest tells the truth: a multi-MB animated WebP (e.g. a full-resolution hero)
honestly reports `lcp_safe: false` instead of asserting CWV-safety it doesn't have. The field is
informational and **ungated** (verify.mjs does not check it), exactly as in v1.

---

## 7. The loop player — required techniques (`index.template.loop.html`)

Dark Instrument (`DESIGN.md`), brand-neutral near-black stage. Must implement all of:

1. Single `<canvas>` cover-fit render — `scale = max(cw/iw, ch/ih)`, centered. No blurred
   background layer.
2. DPR scaling (`devicePixelRatio`) for retina sharpness.
3. Parallel preload with an `onerror`-tolerant counter — a 404 never freezes playback.
4. **Time-based rAF loop:** `frameIndex = Math.floor((elapsed / (1000/fps)) % frameCount)`,
   advancing via `requestAnimationFrame` against `performance.now()`. Zero external requests
   (no GSAP, ever).
5. `prefers-reduced-motion: reduce` ⇒ suppress the animation and render a single static
   hero frame.
6. `data-template-id="seo-video-slicer.loop.v1"` on the player root (anchors G4/G5).
7. System fonts only; inline CSS/JS; opens with no server; zero network requests.

The injection contract is **identical to v1** (`CONTRACT.md` §5): the template carries the
verbatim line `const FRAMES = [/*__SLICER_FRAMES__*/];`, the packager replaces the token
`/*__SLICER_FRAMES__*/` with the comma-separated, double-quoted `./frames/frame_NNN.webp`
paths (no brackets, no trailing comma).

---

## 8. The gates G1–G9 (loop branch)

Gate **ids are reused** — a loop package emits `G4` with loop-specific assertions, **not** a
separate `G4′` — so `packager.parse_verify_output` and acceptance key on a stable set
`G1..G9`.

- **G1 — asset closure** (unchanged): every `./frames/frame_NNN.webp` referenced by
  `index.html` exists in `frames/`.
- **G2 — naming / contiguity** (unchanged): zero-padded contiguous `frame_000…frame_NNN`;
  `count == frames.count`. So `frames.count`, the on-disk count, and G8's ANMF count are one
  integer.
- **G3 — self-contained** (unchanged): no external URLs; relative `./frames/…` only. Loop is
  pure rAF, so the GSAP exception is simply unused.
- **G4 — loop technique check** (loop-specific, **presence gate**): asserts the loop player
  markers — cover-fit `max(`, DPR (`devicePixelRatio`), `onerror`-tolerant preload, a
  `prefers-reduced-motion: reduce` block, `data-template-id="seo-video-slicer.loop.v1"`, and
  the **positive time-driven markers** `requestAnimationFrame` **and** an elapsed-time term
  (`performance.now()`). A regex cannot prove the index *formula*; G4 proves the time-term is
  **present**; the actual time-driven loop is proven in-browser (spec §12).
- **G5 — manifest + fingerprint parity** (config-keyed): `manifest.schema == cfg.schema`
  (`seo-video-slicer.loop-package.v1`); recomputed 3-input fingerprint (with
  `templateId = "seo-video-slicer.loop.v1"`, `gsap = ""`) `== manifest.fingerprint.value`.
- **G6 — docs** (loop README): a loop-specific `README.md` ≤200 lines with the
  `Iframe`/`React`/`Vanilla` headings **plus** the two-tier `<img src="loop.webp">` section.
- **G7 — weight** (re-measured from disk): re-measures all package bytes incl. `loop.webp`.
  Hard fails unchanged: `frames.count > 200` **or** `< 1`. Oversized `loop.webp` = **WARN**.
- **G8 — loop.webp structure + fps binding** (NEW, **coalescing-robust**): `loop.webp`
  exists and is a real **animated** WebP — RIFF/WEBP, a `VP8X` chunk with the `ANIM` flag
  (`0x02`), an `ANIM` chunk, and a frame-chunk (`ANMF`) count in the range
  `1 <= count <= manifest.frames.count`. The fps↔bytes binding is the **duration SUM**:
  `SUM(ANMF Frame Durations) == manifest.frames.count * perFrameMs(fps)` (§2.1 formula). This
  **binds fps to the baked bytes**: a manifest-fps-only edit changes the expected sum; a
  re-encode or single-frame duration tamper changes the actual sum — either fails here even
  though G9 is the byte lock. Parsed by walking RIFF chunks with `node:fs` (zero-dep).
  FAIL ⇒ non-zero.
- **G9 — loop.webp content integrity** (NEW): `sha256(loop.webp bytes) ==
  manifest.loop.webp_sha256` via `node:crypto`. A re-encode (different bytes) fails here.
  FAIL ⇒ non-zero.

### 8.1 The G8 ANMF-duration binding (exact layout + coalescing)

`loop.webp` is walked as top-level RIFF chunks `[FourCC:4][size:LE32][payload:size][pad to
even]`. For each `ANMF` chunk the payload layout begins
`X(3) Y(3) W(3) H(3) Duration(3) …`, so the **Frame Duration** is the **24-bit
little-endian** integer at **payload offset 12** (bytes `payloadStart+12 .. +14`). G8 asserts:

1. `VP8X` flags byte has bit `0x02` (ANIM) set.
2. an `ANIM` chunk is present.
3. `1 <= ANMF count <= manifest.frames.count` (a truncated/unreadable duration field also
   fails).
4. `SUM(ANMF Durations) == manifest.frames.count * perFrameMs(fps)` (§2.1; e.g. 30 frames at
   fps 12 ⇒ sum `30 * 83 = 2490` ms).

**Why a SUM, not per-frame equality (the coalescing fix).** The encoder spike (spec §6.9)
proved that **all libwebp encoders** (Pillow `save_all`, `ffmpeg libwebp_anim`, `img2webp`)
**coalesce byte-identical CONSECUTIVE frames** into a single `ANMF` whose Frame Duration is
the **sum** of the merged per-frame durations — and **no encoder flag disables this**. So a
legitimate held-frame loop (a real Remotion case — e.g. a hero that pauses on a frame) bakes
**fewer ANMF chunks than input frames**, and a coalesced chunk's duration is a **multiple**
of `perFrameMs`. A strict rule (`ANMF count == frames.count` **and** every duration
`== perFrameMs`) would **false-fail** that legitimate loop. Coalescing only ever **reduces**
the count and **preserves the total duration**, so:

- the structural bound is `1 <= ANMF count <= frames.count` (more ANMF than frames is
  impossible from a `frames.count`-frame bake — that is tampering), and
- the cadence binding is the **invariant SUM**.

Empirically confirmed on real frames: 30 distinct frames → 30 ANMF, sum `2490`; the same
sequence with 3 byte-identical leading frames → **3 ANMF** (`[249, 83, 83]`), sum still
`5 * 83 = 415` for a 5-frame variant. The sum is invariant under coalescing.

### 8.2 Closure summary

Re-encoding at a different fps changes the bytes (**G9 fails**) and the duration sum (**G8
fails**); editing only `manifest.loop.fps` leaves G9 green but changes G8's **expected sum**
(fails **G8**); tampering any single ANMF duration changes the **actual sum** (fails **G8**,
with G9 catching the byte change unless the sha is also forged — which G8 still catches);
dropping/adding a baked frame moves both the on-disk frame count (G2) and the sum (G8). The
gap §2 names is fully closed. The fps↔bytes binding survives encoder coalescing because it
rests on the duration **sum**, not on a per-frame count or per-frame equality.
