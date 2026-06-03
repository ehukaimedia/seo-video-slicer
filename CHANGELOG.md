# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Remotion companion + Claude/Codex MCP plugin** — turn the slicer into a headless, agent-invokable output companion for [Remotion](https://www.remotion.dev/):
  - **Headless `slice` CLI** — `seo-video-slicer slice <video|frames-dir> --mode scroll|loop --fps <n> [--start <s>] [--end <s>] --out-dir <dir> [--json] [--no-verify]`: non-interactive, with a deterministic exit-code contract (0 = pass · 1 = gate fail · 2 = input/build error) for CI and agents.
  - **Loop output mode** — a new `seo-video-slicer.loop.v1` template: an auto-advancing, time-based `requestAnimationFrame` player plus an animated `loop.webp` export, shipped as a new `seo-video-slicer.loop-package.v1` schema that never touches the frozen `package.v1`. Gated by two new offline checks: **G8** (animated-WebP structure + a coalescing-robust `fps ↔ duration` binding) and **G9** (`loop.webp` content sha256).
  - **MCP server** (`slice_video` / `slice_frames`, stdio) for Claude Code and Codex, installable via the optional `seo-video-slicer[mcp]` extra, with a thin `/slice` command wrapper and registration docs for both clients.
  - **Remotion recipe** — a runnable `examples/remotion/` project plus docs for `render --sequence → slice → embed` (frames-dir ingest accepts both Remotion's default `element-NNNN.png` and `frame_NNN`).
- **Optional `--max-width` web-weight lever** — downscale video or frames-dir extraction before packaging, preserving aspect ratio and never upscaling. Docs recommend `--max-width 1280` for hero loops that need lighter `loop.webp` bytes.

### Changed

- Loop packages report **`seo.lcp_safe` honestly** (weight-derived from the ~4 MB Core-Web-Vitals soft cap) instead of a hardcoded `true`. The frozen scroll `package.v1` output is unchanged.

## [0.1.1] - 2026-06-02

### Added

- `uvx` zero-clone launch: a release wheel bundles the built UI and the package kernel, so `uvx --from <release-wheel> seo-video-slicer` runs the tool with no clone, no Docker, and no hosted server (ffmpeg + Node remain on-PATH prerequisites).
- A static live demo on GitHub Pages that runs a real exported scroll-player.

### Changed

- Upgraded Vite 5 → 8, clearing the esbuild dev-server advisory (`npm audit` is clean).

## [0.1.0] - 2026-06-01

Initial public release.

### Added

- Video slicer pipeline: import a short video, trim it to the clip you want, slice it into a WebP frame sequence, review and prune frames, clean them, and export a drop-in animation package.
- Two-tier object erase: an OpenCV `INPAINT_NS` baseline that runs with no extra setup, plus an optional higher-quality LaMa pass for users who install the premium model locally.
- Frozen package kernel: each export is a self-contained scroll player (`index.html`) bundled with its frames, a `manifest.json`, and a tamper-evident fingerprint, validated by an offline `verify.mjs` gate enforcing checks G1 through G7.
- "Dark Instrument" Vite/React/TypeScript UI on a Void Black canvas with a single Electric Blue accent, including a Library for managing your slices and exported packages.
- Local sharing: serve the app and packages over localhost, your LAN, or a Tailscale tailnet.
- GitHub Actions CI plus a pytest backend suite and kernel verification tests.
- Cross-platform launch via `start.sh`, `start.command`, and a `Makefile`.
- README, an example animation package, and an animated demo.

[Unreleased]: https://github.com/ehukaimedia/seo-video-slicer/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/ehukaimedia/seo-video-slicer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ehukaimedia/seo-video-slicer/releases/tag/v0.1.0
