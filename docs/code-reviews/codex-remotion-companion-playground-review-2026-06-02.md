# Review: Remotion Companion Spec Playground

**Reviewer:** Codex  
**Date:** 2026-06-02  
**Scope:** `docs/playgrounds/specs/remotion-companion-spec.html` as an architecture/spec playground, checked against `docs/specs/remotion-companion-spec.md` and the current source anchors.

## Important Findings

### 1. CLI public interface omits `--no-verify` from the playground

**Confidence:** 95  
**Where:** `docs/playgrounds/specs/remotion-companion-spec.html:543`, `docs/playgrounds/specs/remotion-companion-spec.html:564`  
**Evidence:** The Markdown spec's canonical CLI signature includes `[--json] [--no-verify]` and defines `--no-verify` behavior at `docs/specs/remotion-companion-spec.md:85-98`. The playground's decision table and public interface summary list `--json` but drop `--no-verify`.

**Why it matters:** This playground is presented as the reviewable Spec Seed. Omitting an accepted flag from the public interface can cause the CLI implementation, tests, or MCP/CLI JSON parity checks to miss the skip-verify contract entirely.

**Suggested fix:** Add `[--no-verify]` to the public interface row and include the same semantics as the spec: off by default, disallowed for MCP/CI, and `verify: {"skipped": true}` under `--json`.

### 2. MCP gate failure behavior is blurred with CLI exit-code behavior

**Confidence:** 90  
**Where:** `docs/playgrounds/specs/remotion-companion-spec.html:303-304`, `docs/playgrounds/specs/remotion-companion-spec.html:570-576`  
**Evidence:** The playground says "one command (or one MCP call)" is "non-zero exit on any gate failure" and repeats "non-zero exit on any gate fail" after a data flow that returns `{package_dir, verify, loop_webp?}`. The source spec separates the behaviors: the CLI exits non-zero on gate failure (`docs/specs/remotion-companion-spec.md:98`), while MCP tool calls succeed and return `verify.pass=false` with failing gates (`docs/specs/remotion-companion-spec.md:231`).

**Why it matters:** If an implementer follows the playground literally, the MCP server may raise/abort on a gate failure instead of returning a structured `verify` result. That breaks the agent contract because the agent is supposed to inspect gate output, not lose it behind a failed tool invocation.

**Suggested fix:** Change the playground copy to distinguish: "CLI exits non-zero on gate failure; MCP returns `verify.pass=false` with failing gates and keeps the JSON-RPC/tool call successful."

### 3. `loop_export.py` ownership is assigned to both Phase 0 and Phase 1

**Confidence:** 85  
**Where:** `docs/playgrounds/specs/remotion-companion-spec.html:550-558`, `docs/playgrounds/specs/remotion-companion-spec.html:579-583`  
**Evidence:** The Phase-1 lane isolation table assigns `backend/app/loop_export.py` and `packager.py` mode handling to the `loop.webp export` lane, but the build sequence says Phase 0 freezes the loop kernel with "loop.webp export + reference player." The Markdown spec carries the same tension at `docs/specs/remotion-companion-spec.md:330-344`.

**Why it matters:** The purpose of this section is disjoint-file lane isolation. Assigning the same primitive across phases makes it unclear whether Phase 0 must implement `loop_export.py` or only define/verify the loop contract. That can produce duplicate work or leave Phase 0 without the empirical encoder behavior required for G8.

**Suggested fix:** Pick one owner. A clean split would be: Phase 0 owns the contract, loop template, verifier/builder branches, and the empirical encoder spike; Phase 1 owns the production `backend/app/loop_export.py` and `packager.py` integration. Or, if Phase 0 must produce `loop_export.py`, remove it from the Phase-1 lane and make Phase 1 consume it.

### 4. The known-false kickoff claim remains active outside the playground

**Confidence:** 90  
**Where:** `docs/playgrounds/specs/remotion-companion-spec.html:632-640`, `docs/plans/remotion-companion-kickoff.md:27`  
**Evidence:** The playground correctly identifies the kickoff claim that `build_package.mjs` produced `docs/assets/demo.webp` as false, but the active plan file still contains that claim. The source spec also says this line should be corrected at `docs/specs/remotion-companion-spec.md:380-382`.

**Why it matters:** This is exactly the regression-context drift the playground is trying to prevent. Future agents reading `docs/plans/remotion-companion-kickoff.md` can still infer that the Node kernel encodes animated WebP, which contradicts the intended Python `loop_export.py` primitive.

**Suggested fix:** Edit the kickoff plan line or mark the plan clearly superseded at the top. If the plan is no longer active guidance, archive or retire it according to the playground lifecycle instead of leaving the stale claim live.

## Checks Performed

- Compared the HTML playground against `docs/specs/remotion-companion-spec.md`.
- Spot-checked the listed source anchors against `backend/app/slicing.py`, `backend/app/packager.py`, `backend/app/config.py`, `backend/app/cli.py`, `package-contract/build_package.mjs`, `package-contract/verify.mjs`, and `scripts/build-wheel.sh`.
- Ran a static HTML sanity check for script syntax, duplicate IDs, and broken internal hash links. Result: one script block parsed, no duplicate IDs, no missing hash targets.
