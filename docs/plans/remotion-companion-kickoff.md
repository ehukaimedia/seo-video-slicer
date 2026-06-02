# Kickoff: Remotion companion + Claude/Codex MCP plugin

**Status:** Proposal / brainstorm seed — NOT yet a spec. Resolve the open decisions below first.
**Branch:** `feat/remotion-companion` (off `main` @ v0.1.1).
**Date seeded:** 2026-06-02.

> Read this first, then run the brainstorming skill to confirm intent, then `playground-architect` to write the spec, then implement via workflows. Do **not** start coding until the five decisions are pinned.
>
> **Built at `ultracode` (xhigh + multi-agent workflows).** Orchestrate every substantive phase with the **Workflow tool** — contract-first, fan-out build lanes that own distinct files, then verify/gate phases. Don't hand-build serially. See "Run this at ultracode" below.

---

## The vision

Make **seo-video-slicer** the *output companion* for [Remotion](https://www.remotion.dev/) and an invokable **plugin for Claude Code / Codex**:

```
Remotion (React → motion)  →  seo-video-slicer (optimize → WebP package)  →  any site / repo
```

Remotion is the *renderer*; the slicer is the *web-delivery optimizer + packager*. A raw Remotion MP4 is heavy and poor for a hero/scroll moment (LCP, autoplay limits, no scroll-scrubbing). The slicer already turns video → a Core-Web-Vitals-friendly WebP **package** with a working player. We want an agent to be able to say *"render this with Remotion, then slice it into a scroll (or loop) package"* and have it just work — headlessly.

Two output modes requested: **scrolling** (already shipped — the `index.html` scroll-scrubber) and **WebP video loops** (auto-advancing; the repo's `docs/assets/demo.webp` is already a 232 KB animated-WebP loop — needs a loop player variant + export).

## Why it fits (already-built primitives to reuse — do NOT rebuild)

- `package-contract/build_package.mjs` already takes **a frames dir → a complete, gate-verified package** headlessly (it's how `example/sample-package/` was built). The headless core exists. (Correction: the animated `docs/assets/demo.webp` loop was **not** built by this kernel — the zero-dep Node kernel only assembles frame sequences; the animated-WebP loop export is a separate Python primitive, see the loop mode in `docs/specs/remotion-companion-spec.md`.)
- The backend exposes a clean **HTTP API** (`backend/app/main.py`, see `app-contract/API.md`) for upload → preview → finalize → crop → erase → package.
- The tool is **`uvx`-installable** (a release wheel bundles the UI + kernel; see `backend/pyproject.toml`, `backend/app/cli.py`, `scripts/build-wheel.sh`).
- `package-contract/verify.mjs` gates every package (G1–G7) + a tamper fingerprint. The contract is **frozen** in `package-contract/CONTRACT.md` (`seo-video-slicer.package.v1`).
- Remotion can render a **PNG/JPEG `--sequence`** directly → feed it straight into the kernel and skip the video encode/decode round-trip (lossless + fast).

## Five decisions to pin before speccing

1. **In-repo vs. companion repo.** Add the **headless CLI + loop mode to THIS repo** (core capability). Open question: does the **MCP server** live here (e.g., `mcp/`, published as its own package) or as a sibling repo `seo-video-slicer-mcp`? *Lean: in-repo `mcp/`, published separately, sharing the kernel.* CONFIRM.
2. **Headless CLI signature.** Proposed: `seo-video-slicer slice <video|frames-dir> --in <s> --out <s> --fps <n> --mode scroll|loop --out-dir ./pkg` — non-interactive, prints the package path + verify result, exits non-zero on gate failure. (Today `app/cli.py` only launches the UI; add a `slice` subcommand front-door over the existing primitives.) CONFIRM the flags + that it must run with no UI/server.
3. **Loop vs. scroll output contract.** `…package.v1` is FROZEN. A loop is a **new template** (`seo-video-slicer.scroll.v1` → add `seo-video-slicer.loop.v1`): an auto-advancing rAF player + an **animated-WebP export** alongside the frame sequence. Decide: new `data-template-id`, new fingerprint inputs, and keep it `verify.mjs`-gated. Must NOT mutate v1. CONFIRM the loop contract shape.
4. **Remotion ingest path.** Support both `--sequence` (frames dir, lossless — the sweet spot) and a rendered video. Decide whether to ship a tiny **Remotion recipe** (render `--sequence` → `slice frames` → drop the package into the React app as an embed) in the README/docs. CONFIRM scope.
5. **MCP tool shapes (the plugin surface for Claude + Codex).** Proposed tools: `slice_video(path, in, out, fps, mode) -> {package_dir, verify}` and `slice_frames(dir, fps, mode) -> {package_dir, verify}`. Both Claude Code and Codex speak MCP. Decide transport (stdio for a local tool), and whether to also ship a Claude Code **skill/command** wrapper. CONFIRM.

## Hard constraints (carry over — do not violate)

- **Frozen package contract:** never mutate `seo-video-slicer.package.v1`; new modes are new template ids, each `verify.mjs`-gated with byte-identical fingerprint recipe between builder and verifier.
- **Lean non-goals (spec §2 / PRODUCT.md):** no in-app animation generator, no local LLM, no chat. The MCP/companion is *plumbing around the slicer*, not a new studio.
- **Design system of record:** `DESIGN.md` ("The Dark Instrument") — any new player UI stays dark/Electric-Blue, system fonts, zero external requests (the exported player must open with no server).
- **Prerequisites stay honest:** `ffmpeg` (media) + `node` (the kernel) are system tools; document them. opencv-headless/pillow are pip deps for the wheel.
- **Process:** follow `CONTRIBUTING.md` — feature branch, `make test` + CI green, fill the PR template, keep PRs focused.

## Recommended MVP (smallest thing that makes the whole story real)

1. Headless `slice` subcommand (video **and** frames-dir, `--mode scroll`).
2. A thin **MCP server** (`slice_video` / `slice_frames`) over that.
3. A documented **Remotion → slicer recipe** in the README.

Then fast-follow: **loop mode** (player variant + animated-WebP export, `…loop.v1`).

## Run this at ultracode — workflow orchestration plan

This feature is built at **ultracode** (xhigh + multi-agent workflows). Use the **Workflow tool** for every substantive phase; mirror how the slicer itself was built — **contract-first**, fan-out build lanes that own **distinct files** (no write contention), then a verify/gate phase. Lean toward **adversarial verification**: prove the kernel works (and *see* it in a browser) before fanning out. Run **several workflows in sequence**, reading each result before the next — not one mega-run.

**Process**
1. `superpowers:brainstorming` — confirm the five decisions with the user. (Do this BEFORE any workflow; it determines what fans out.)
2. `playground-architect` — author the spec + a Spec Seed (headless CLI signature, the `…loop.v1` contract, the MCP tool shapes, the Remotion ingest) as a spec playground under `docs/playgrounds/specs/`. Adversarially review it (a small judge/critic workflow) before implementing.
3. Implement via the **contract-first workflows** below.
4. PR per `CONTRIBUTING.md`; `make test` + CI green; verify against a REAL Remotion `--sequence` render.

**Phase 0 — contract-first kernel (one workflow → then SEE it work).** Freeze the loop contract: a new `seo-video-slicer.loop.v1` template (auto-advancing rAF player + an animated-WebP export). Extend `verify.mjs` with loop gates — **keep the v1 scroll path untouched** and the fingerprint recipe byte-identical between builder and verifier. Build a golden loop package and gate it with **negative-corruption tests** (as P0 did for v1). Then **actually open the loop player in a browser (chrome-devtools MCP)** and confirm it loops + has zero external requests, before building anything else.

**Phase 1 — parallel build lanes (one workflow; each agent owns a distinct path):**
  - **headless CLI** — `slice <video|frames-dir> … --mode scroll|loop` over `build_package.mjs` (owns the `backend/app/cli.py` `slice` subcommand + tests).
  - **loop player + animated-WebP export** — to the Phase-0 contract (owns the kernel loop bits).
  - **MCP server** — `slice_video` / `slice_frames` (stdio) returning `{package_dir, verify}` (owns `mcp/`).
  - **Remotion recipe** — `--sequence` → `slice frames` → embed (owns `docs/` + `examples/remotion/`).

**Phase 2 — integrate & verify (one workflow, structured-output verify agent):** run the MCP server end-to-end against a real Remotion `--sequence` render; assert the returned package passes `verify.mjs`; smoke the headless CLI both ways (video + frames); CI green. Report any silent caps / dropped coverage — no silent truncation.

**Quality patterns to reach for:** contract-first kernel → adversarial verify (multiple skeptics per finding) → loop-until-dry for edge cases. Spawn lanes in ONE workflow message so they run concurrently; default to `pipeline()` where stages chain per-item; use a `parallel()` barrier only when a stage needs all prior results. Call the **advisor** before committing to the spec and before each implementation workflow.

## Pointers

- Frozen contract: `package-contract/CONTRACT.md` · kernel: `build_package.mjs`, `verify.mjs`, `index.template.html`.
- API: `app-contract/API.md` · backend: `backend/app/`.
- Packaging/uvx: `backend/pyproject.toml`, `backend/app/cli.py`, `scripts/build-wheel.sh`.
- Design: `DESIGN.md` · Product: `PRODUCT.md` · Spec: `docs/specs/seo-video-slicer-spec.md`.
- Example output: `example/sample-package/` · demo loop: `docs/assets/demo.webp`.
