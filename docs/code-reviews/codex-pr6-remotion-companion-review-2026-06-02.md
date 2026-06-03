# PR #6 Review: Remotion Companion + MCP Plugin

**Reviewer:** Codex  
**Date:** 2026-06-02 HST  
**Branch:** `feat/remotion-companion` vs `main`  
**Verdict:** **BLOCK**

## Ranked Findings

### 1. BLOCKER / Must-Fix — `fps=0` produces a verified scroll package through both CLI and MCP

**Confidence:** 100  
**Files:** `backend/app/slice_cli.py:96`, `backend/app/slice_cli.py:247-260`, `backend/app/mcp/server.py:138-149`

The CLI parser only types `--fps` as `float`; `_run()` converts `fps <= 0` into `duration_s = 0.0` and still calls `packager.build_and_verify(...)` for scroll mode. The MCP path has the same pattern in `_build_from_slice()`. Because scroll verification does not validate `source.fps_effective`, a frames-dir scroll package with `fps_effective: 0` and `duration_s: 0` passes every gate and returns success.

This violates the spec's "effective fps" contract and turns a bad input into a community-visible, verified package.

**Proof command/output:**

```bash
rm -rf /tmp/svs-review-fps0 && python3 -m backend.app.slice_cli \
  example/sample-package/frames --mode scroll --fps 0 \
  --out-dir /tmp/svs-review-fps0 --json
```

```text
{"package_dir": "/private/tmp/svs-review-fps0", "verify": {"pass": true, "gates": [{"id": "G1", "pass": true, "detail": "30 referenced frame(s), all present"}, {"id": "G2", "pass": true, "detail": "30 frame(s) frame_000…frame_029, contiguous; count matches manifest"}, {"id": "G3", "pass": true, "detail": "no external/scratch asset leaks; relative ./frames/ refs only"}, {"id": "G4", "pass": true, "detail": "all 5 technique markers present"}, {"id": "G5", "pass": true, "detail": "schema ok; fingerprint matches (960344e014ee…)"}, {"id": "G6", "pass": true, "detail": "README.md 94 lines; Iframe / React / Vanilla headings present"}, {"id": "G7", "pass": true, "detail": "count 30 within [1, 200]; total 0.95 MB"}]}, "loop_webp": null}
EXIT:0
{
  "schema": "seo-video-slicer.package.v1",
  "duration": 0,
  "fps": 0,
  "verify_exists": true
}
```

MCP direct-call probe:

```text
{'package_dir': '/var/folders/.../svs-mcp-pkg-frames-ovfn_30h', 'verify': {'pass': True, ...}, 'loop_webp': None}
```

**Fix:** Reject non-positive `fps` at every public front door before any build work: CLI, MCP `slice_video`, MCP `slice_frames`, and preferably `packager.build_and_verify`/`build_package.mjs` as a defense-in-depth backstop. CLI should return exit `2` with `{error:{code,message}}`; MCP should return `{error:{code,message}}`.

### 2. BLOCKER / Must-Fix — Loop gates ignore required `manifest.loop` fields, so wrong loop manifests pass G1-G9

**Confidence:** 100  
**Files:** `package-contract/verify.mjs:494-506`, `package-contract/verify.mjs:580-587`, `package-contract/CONTRACT-loop.md:102-108`

`CONTRACT-loop.md` defines `loop.duration_s`, `loop.webp`, `loop.webp_sha256`, and `loop.loop_count`, but `verify.mjs` only consumes `manifest.loop.fps` in G8 and `manifest.loop.webp_sha256` in G9. It always reads the physical `loop.webp` path from the package root, so a manifest can lie about `duration_s`, the WebP filename, or loop count and still pass every gate.

That means "a WRONG loop package can pass the gates" despite G8/G9 otherwise catching fps lies and byte tampering.

**Proof command/output:**

```text
--- /tmp/svs-review-loop-duration
[PASS] G9  loop.webp content integrity (sha256 == manifest.loop.webp_sha256)
        sha256 matches (f8d69ccfe29b…)
RESULT: PASS (all gates passed)
EXIT:0
--- /tmp/svs-review-loop-webpfield
[PASS] G9  loop.webp content integrity (sha256 == manifest.loop.webp_sha256)
        sha256 matches (f8d69ccfe29b…)
RESULT: PASS (all gates passed)
EXIT:0
--- /tmp/svs-review-loop-count
[PASS] G9  loop.webp content integrity (sha256 == manifest.loop.webp_sha256)
        sha256 matches (f8d69ccfe29b…)
RESULT: PASS (all gates passed)
EXIT:0
```

Those three packages were made by editing only:

```text
manifest.loop.duration_s = 999
manifest.loop.webp = "missing.webp"
manifest.loop.loop_count = 7
```

**Fix:** Add loop manifest validation to G8 or G5 for the whole `loop` block: require `loop.webp === "loop.webp"`, `loop.loop_count === 0`, `loop.duration_s === frames.count / loop.fps` within a documented precision rule, `loop.webp_sha256` is lowercase 64-hex, and reject missing/extra-invalid loop fields. Add negative tests for each field.

### 3. IMPORTANT / Must-Fix — Duplicate numeric frame indices are accepted instead of rejected as ambiguous ingest

**Confidence:** 85  
**File:** `backend/app/slicing.py:94-110`

The spec says frames-dir ingest should error on ambiguous/mixed sets where no consistent integer ordering exists. `convert_frames_to_webp()` extracts a trailing integer and sorts `(index, filename)`, but it never rejects duplicate indices. A stale mixed directory with both `element-1.png` and `other-1.jpg` silently becomes two output frames.

**Proof command/output:**

```text
DUPLICATE_INDEX_ACCEPTED ['frame_000.webp', 'frame_001.webp'] 4x4
```

**Fix:** Track seen source indices and raise `ApiError(422, "ambiguous frame names", ...)` when more than one source file maps to the same trailing integer. Add a regression test beside `test_unorderable_names_error`.

## Passing / Spot-Checked Claims

Frozen contract safety:

```text
git diff --exit-code main...feat/remotion-companion -- package-contract/CONTRACT.md
EXIT:0
```

Fingerprint parity:

```text
package-contract/build_package.mjs UNCHANGED_VS_MAIN= True
package-contract/verify.mjs UNCHANGED_VS_MAIN= True
BUILD_EQUALS_VERIFY_CURRENT= True
```

Kernel self-test, including scroll golden byte-diff and loop corruption gates:

```text
SCROLL GOLDEN — byte-diff vs example/sample-package
  ok   golden: index.html byte-identical
  ok   golden: README.md byte-identical
  ok   golden: PROMPT.md byte-identical
  ok   golden: manifest.json byte-identical (excluding id / created_at lines)
...
  ok   loop fps=16 PARITY: bytes baked at 63 ms, G8 PASSES (sum 30*63=1890) [regression: Python round gave 62]
  ok   loop HELD-FRAME: coalesced loop (ANMF<frames) PASSES sum-based G8 [strict G8 would FALSE-FAIL]
  ok   loop: flipping a loop.webp byte FAILs G9, G8 stays PASS
  ok   loop: editing manifest.loop.fps FAILs G8 (G9 + G5 stay PASS)
  ok   loop: breaking one ANMF duration (sum) FAILs G8 (G9 + G2 stay PASS)
test-kernel: PASS (scroll build + golden byte-diff + loop build; all corruptions fail their matching gate)
```

Manual G8/G9 probes:

```text
--- manifest fps edit
[PASS] G5  Manifest schema + recomputed fingerprint parity
[FAIL] G8  loop.webp animated-WebP structure + fps↔duration binding
[PASS] G9  loop.webp content integrity (sha256 == manifest.loop.webp_sha256)
RESULT: FAIL (one or more gates failed)
EXIT_FPS:1
--- loop.webp byte flip
[PASS] G8  loop.webp animated-WebP structure + fps↔duration binding
[FAIL] G9  loop.webp content integrity (sha256 == manifest.loop.webp_sha256)
RESULT: FAIL (one or more gates failed)
EXIT_FLIP:1
--- extra ANMF count
[FAIL] G8  loop.webp animated-WebP structure + fps↔duration binding
[PASS] G9  loop.webp content integrity (sha256 == manifest.loop.webp_sha256)
RESULT: FAIL (one or more gates failed)
EXIT_ANMF:1
```

Cross-language duration parity:

```text
backend/app/loop_export.py
58: return math.floor(1000.0 / fps + 0.5)
package-contract/verify.mjs
551: const perFrameMs = Math.floor(1000 / fps + 0.5);
fps16_py= 63
fps16_js= 63
```

Packaging:

```text
loop_template_bundled_script_has= True contract_loop_bundled_script_has= True
[PASS] G8  loop.webp animated-WebP structure + fps↔duration binding
[PASS] G9  loop.webp content integrity (sha256 == manifest.loop.webp_sha256)
RESULT: PASS (all gates passed)
EXIT:0
```

Backend tests:

```text
python3 -m pytest backend -q
65 passed in 188.96s (0:03:08)

(cd backend && python3 -m pytest -q)
65 passed in 187.63s (0:03:07)
```

CI/security spot-check:

```text
.github/workflows/ci.yml uses fixed setup/install/test commands; no github.event.* interpolation found.
```

## One-Line Verdict

**BLOCK** — frozen scroll safety and the headline G8/G9 corruption checks are strong, but invalid `fps=0` scroll packages and falsified loop manifest fields currently pass as verified artifacts.

---

## Resolution (2026-06-03)

All three findings fixed and independently re-verified (the exact repros above now behave correctly; frozen scroll output byte-identical, `fingerprint()` unchanged, `CONTRACT.md` diff empty, kernel self-test PASS, full backend suite **76 passed**).

1. **`fps≤0` (BLOCKER) — fixed.** New shared `errors.validate_fps()` (rejects `None`/`NaN`/`inf`/`≤0` → `ApiError(422, "fps must be a positive number")`) called at every front door — CLI `_run`, MCP `slice_video`, MCP `slice_frames` — and at the central `packager.build_and_verify` choke point (before any build). `fps=0` now: CLI exit `2` `{error}` no package; MCP `{error}`. The two dead `… if fps>0 else 0.0` masking ternaries are removed. The frozen Node kernel is intentionally not touched (it defaults an omitted `--fps` to 0; the Python choke point is the correct, complete fix). +10 regression tests.
2. **Loop-block fields ignored (BLOCKER) — fixed.** `verify.mjs` G8 (loop branch only; scroll path byte-untouched) now validates the whole `manifest.loop`: `webp === "loop.webp"` (and the animated WebP is read from that manifest-declared name), `loop_count === 0`, `fps` finite `>0`, `webp_sha256` lowercase-64-hex, and `duration_s ≈ frames.count/fps` (recomputed the same way the builder writes it, within `1e-6`). The three falsified packages now FAIL G8. +4 negative kernel cases.
3. **Duplicate frame index (IMPORTANT) — fixed.** `slicing.convert_frames_to_webp` raises `ApiError(422, "ambiguous frame names", …)` (naming the colliding files) when two source files share a trailing index. +1 regression test.
