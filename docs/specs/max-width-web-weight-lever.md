# Max-Width Web-Weight Lever

**Status:** Implemented  
**Scope:** Headless CLI + MCP extraction only; package kernel and contracts unchanged.

## Decision

Add an opt-in `max_width` cap before packaging:

- CLI: `seo-video-slicer slice ... [--max-width <px>]`
- MCP: `slice_video(..., max_width?)` and `slice_frames(..., max_width?)`

The cap is off by default. For web heroes, docs recommend `--max-width 1280`.

## Behavior

- Applies in the extraction/conversion stage only.
- Preserves aspect ratio.
- Never upscales sources already at or below the cap.
- Video path uses ffmpeg: `fps=<fps>,scale='min(<max_width>,iw)':-2:flags=lanczos`.
- Frames-dir path uses Pillow LANCZOS before saving the contiguous WebP frames.
- `manifest.source.resolution`, `seo.total_bytes`, and loop `seo.lcp_safe` reflect the resulting files automatically.

## Validation

`max_width` must be a positive integer. Invalid values are hard input errors before path, ffmpeg, or package work:

- CLI exits `2`; with `--json`, stdout is `{ "error": { "code", "message" } }`.
- MCP returns `{ "error": { "code", "message" } }`.

## Non-Goals

- No default cap.
- No height or per-axis controls.
- No package-kernel, fingerprint, or gate changes.
