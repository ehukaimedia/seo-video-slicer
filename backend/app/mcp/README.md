# seo-video-slicer MCP server

An agent-invokable front-door over the slicer (spec §7). Two stdio tools turn a
video **or** a Remotion `--sequence` frames directory into a Core-Web-Vitals-friendly
WebP **package** that passes `package-contract/verify.mjs` and opens offline.

```
Remotion (React → motion)  →  seo-video-slicer (optimize → WebP package)  →  any site / repo
```

The tools reuse the SAME pipeline as the HTTP stack and CLI by importing
`app.slicing` / `app.packager` directly (no re-shelling); the only subprocesses are
the `ffmpeg` and `node` calls the slicer already makes.

## Tools

```
slice_video(path, start?, end?, fps=12, mode="scroll"|"loop")
    -> { package_dir, verify: { pass, gates[] }, loop_webp }

slice_frames(dir, fps=12, mode="scroll"|"loop")
    -> { package_dir, verify: { pass, gates[] }, loop_webp }
```

- `package_dir` — absolute path to the produced package (a persistent temp dir; it
  outlives the call so you can read/copy it). Contains `index.html`, `frames/`,
  `manifest.json`, `README.md`, `PROMPT.md`, `verify.mjs`, and — for `mode="loop"` —
  `loop.webp`.
- `verify.pass` — `true` only if **every** gate passed. `gates[]` is the per-gate
  `{id, pass, detail}` list (G1–G7 for scroll; G1–G9 for loop).
- `loop_webp` — `"loop.webp"` for loop mode, else `null`.

### Error contract (spec §7.3)

- **Gate failure** (a package built but a gate failed) ⇒ the tool call **succeeds**
  and returns `verify.pass = false` with the failing gates. Inspect `verify.gates`.
- **Non-gate failure** (bad/missing path, empty dir, ffmpeg/node missing, build
  crash) ⇒ caught and returned as `{ "error": { "code", "message" } }`. The tool
  never raises an unhandled exception and never writes to stdout.

## Install

The server is an **optional extra** — it is not pulled in by the core install:

```bash
pip install "seo-video-slicer[mcp]"        # from a release wheel
# or, from a checkout:
pip install -e "backend[mcp]"
```

`ffmpeg` and `node` remain **system prerequisites** (shelled out to, not pip deps).

Run it directly over stdio:

```bash
python -m app.mcp
```

## Registration

Both clients speak **stdio**; only the registration file/format differs.

### Claude Code — `.mcp.json` (project scope)

```json
{
  "mcpServers": {
    "seo-video-slicer": {
      "type": "stdio",
      "command": "python",
      "args": ["-m", "app.mcp"]
    }
  }
}
```

Or imperatively: `claude mcp add seo-video-slicer -- python -m app.mcp`.

> Point `command` at the interpreter that has `seo-video-slicer[mcp]` installed
> (e.g. an absolute `.venv/bin/python`) if it is not the one on your `PATH`.

### Codex — `~/.codex/config.toml` (TOML, **not** `.mcp.json`)

```toml
[mcp_servers.seo-video-slicer]
command = "python"
args = ["-m", "app.mcp"]
```

## Trust model (spec §7.6)

This is a **local** tool invoked over **stdio** by a **same-user** caller — the
agent runs as you, so the server operates with **your own filesystem permissions**.
There is **no remote exposure and no sandbox**: the security boundary is the OS
user, not this process.

`slice_video(path)` / `slice_frames(dir)` take **caller-supplied filesystem paths**.
To avoid foot-guns and accidental traversal, inputs are still validated before any
filesystem access — reject `..` segments and NUL bytes, resolve to an absolute path,
and require the path to exist and be of the expected kind (file vs directory). A
rejected path is returned as the structured `{error}`, never an exception.
