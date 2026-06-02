# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/ehukaimedia/seo-video-slicer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ehukaimedia/seo-video-slicer/releases/tag/v0.1.0
