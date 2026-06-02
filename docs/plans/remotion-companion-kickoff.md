# Kickoff: Remotion companion + Claude/Codex MCP plugin

**Status:** Proposal / brainstorm seed — NOT yet a spec. Resolve the open decisions below first.
**Branch:** `feat/remotion-companion` (off `main` @ v0.1.1).
**Date seeded:** 2026-06-02.

> Read this first, then run the brainstorming skill to confirm intent, then `playground-architect` to write the spec, then implement via a workflow. Do **not** start coding until the five decisions are pinned.

---

## The vision

Make **seo-video-slicer** the *output companion* for [Remotion](https://www.remotion.dev/) and an invokable **plugin for Claude Code / Codex**:

```
Remotion (React → motion)  →  seo-video-slicer (optimize → WebP package)  →  any site / repo
```

Remotion is the *renderer*; the slicer is the *web-delivery optimizer + packager*. A raw Remotion MP4 is heavy and poor for a hero/scroll moment (LCP, autoplay limits, no scroll-scrubbing). The slicer already turns video → a Core-Web-Vitals-friendly WebP **package** with a working player. We want an agent to be able to say *"render this with Remotion, then slice it into a scroll (or loop) package"* and have it just work — headlessly.

Two output modes requested: **scrolling** (already shipped — the `index.html` scroll-scrubber) and **WebP video loops** (auto-advancing; the repo's `docs/assets/demo.webp` is already a 232 KB animated-WebP loop — needs a loop player variant + export).

## Why it fits (already-built primitives to reuse — do NOT rebuild)

- `package-contract/build_package.mjs` already takes **a frames dir → a complete, gate-verified package** headlessly (it's how `example/sample-package/` and `docs/assets/demo.webp` were built). The headless core exists.
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

## Suggested process for the new session

1. `superpowers:brainstorming` — confirm the five decisions with the user.
2. `playground-architect` — write the spec + a Spec Seed (tool signatures, the loop contract, the MCP shapes).
3. `writing-plans` → a workflow to implement, building to the frozen contract + a new `…loop.v1` template, with `verify.mjs` coverage.
4. PR per `CONTRIBUTING.md`; verify the MCP server against a real Remotion `--sequence` render.

## Pointers

- Frozen contract: `package-contract/CONTRACT.md` · kernel: `build_package.mjs`, `verify.mjs`, `index.template.html`.
- API: `app-contract/API.md` · backend: `backend/app/`.
- Packaging/uvx: `backend/pyproject.toml`, `backend/app/cli.py`, `scripts/build-wheel.sh`.
- Design: `DESIGN.md` · Product: `PRODUCT.md` · Spec: `docs/specs/seo-video-slicer-spec.md`.
- Example output: `example/sample-package/` · demo loop: `docs/assets/demo.webp`.
