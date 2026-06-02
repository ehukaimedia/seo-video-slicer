# Contributing to SEO Video Slicer

Thanks for being here. **SEO Video Slicer** turns a short video into a drop-in WebP animation package, and it gets better when people who use it help shape it. This guide explains how to contribute without surprises.

It's a **local desktop app** — FastAPI backend, Vite + React + TypeScript UI, and a frozen zero-dependency Node package kernel. You don't need to know all three to help.

---

## Ways to contribute

You don't have to write code to make a difference:

- **Open an issue** — found a bug, hit a confusing edge, or have an idea? File it. A clear repro (your OS, the steps, what you expected vs. got) is worth a lot. For anything large or new, **open an issue first** so we can agree on direction before you invest time.
- **Send a pull request** — bug fixes, focused improvements, and good first issues are all welcome. Small and sharp beats large and sprawling.
- **Improve the docs** — README, `DESIGN.md`, `PRODUCT.md`, the `docs/` specs and plans, or this file. If something tripped you up, fixing it for the next person is a genuine contribution.

---

## Local setup

**Prerequisites:** `ffmpeg`, Python 3.10+, and Node 18+. The slicer shells out to ffmpeg for frame extraction, so it has to be on your `PATH`.

```bash
make setup     # create the venv, pip install backend deps, npm install the frontend
make run       # start the API (serves the built UI) on http://localhost:8000
make test      # backend pytest + the kernel verify gate
make build     # build the frontend production bundle into frontend/dist
```

The venv lives at `./.venv` and is created with `--system-site-packages` so it inherits your system OpenCV / Pillow / numpy (the lean baseline — no torch, no IOPaint). Override the port with `make run SVS_PORT=9000`.

Prefer not to use `make`? The same launch is wrapped for you:

```bash
bash start.sh        # Linux / macOS
./start.command      # macOS (double-click works too)
```

---

## Project structure

A quick map so you know where things live:

```
backend/app/        FastAPI backend — slicing, packaging, erase, jobs, share, config
frontend/src/       Vite + React + TypeScript UI (steps, components, state, api)
package-contract/    the FROZEN package kernel — CONTRACT.md, build_package.mjs,
                     verify.mjs, the player template, and the kernel self-test
docs/               specs/, plans/, playgrounds/, assets/
DESIGN.md           the design system of record — "The Dark Instrument"
PRODUCT.md          product scope, voice, and the non-goals that keep it lean
```

---

## Running the tests

There are two test surfaces, and both run in CI:

```bash
# Backend — pytest (26 tests).
.venv/bin/python -m pytest backend

# Package kernel — the negative-corruption self-test (the one CI runs).
node package-contract/test-kernel.mjs
```

`make test` runs pytest **and** `node package-contract/verify.mjs example/sample-package` (the gate against the committed sample package). The kernel self-test above goes further: it builds a package with `build_package.mjs`, proves `verify.mjs` passes it, then corrupts it three ways and proves the matching gate fails. Run that one before touching anything under `package-contract/`.

Please make sure tests pass locally before you open a PR.

---

## The rules that keep this project itself

Three constraints define the project. PRs are reviewed against them, so reading them first saves a round-trip.

### 1. The package contract is FROZEN

[`package-contract/CONTRACT.md`](package-contract/CONTRACT.md) is the single source of truth for the exported package. Any change under `package-contract/` must:

- keep `verify.mjs` (gates **G1–G7**) green, and
- keep the **fingerprint recipe byte-identical** between `build_package.mjs` and `verify.mjs`.

These are two independent implementations that must agree wherever the contract says "byte-for-byte." **CI enforces this** — the kernel self-test will fail if they drift. If a change genuinely needs the contract to evolve, say so explicitly in the issue/PR and update the contract, both kernels, and the tests together.

### 2. Follow the design system

The UI follows [`DESIGN.md`](DESIGN.md) — **"The Dark Instrument"**: a Void Black canvas, one Electric Blue accent, system fonts. Please don't introduce light/cream backgrounds, magenta, serif typefaces, or webfonts. One accent, earned emphasis through weight and hierarchy, nothing decorative.

### 3. Stay lean (the non-goals)

The product is lean by construction (see `PRODUCT.md` §2). The package is the product — we don't generate motion, the downstream model does. So these are **out of scope by design**, and PRs adding them will be declined:

- ❌ an in-app animation generator
- ❌ a local LLM runtime / model download for core function
- ❌ a chat assistant
- ❌ a multi-project dashboard or CRM

If you're unsure whether an idea fits, **open an issue first.** We'd rather talk it through than decline a finished PR.

---

## Code style

Match the surrounding code. Briefly:

- **Python:** type hints on public functions, `pathlib` over string paths, the `logging` module rather than `print`. Keep filesystem access inside the existing path-containment helpers — this app trusts no path it didn't build.
- **TypeScript:** strict mode, no `any` where a real type fits. **Don't add heavy dependencies** — the UI is intentionally lean and the package kernel is **zero-dependency** (Node builtins only). New deps need a reason.

---

## Pull request process

1. **Fork and branch** off the default branch. Use a descriptive branch name.
2. **Keep it focused.** One concern per PR. Unrelated cleanups belong in their own PR.
3. **Fill out the PR template** if one is present, and otherwise describe: what changed, why, and how you tested it.
4. **Reference the issue** it closes or relates to (e.g. `Closes #123`).
5. **Make sure `make test` passes and CI is green.** CI runs backend pytest, the kernel self-test, and the frontend build on every push and PR.
6. **Be kind.** Reviews are a conversation. We assume good faith and aim to keep it a pleasant place to contribute.

---

## Conduct and security

- Be respectful — see our [Code of Conduct](CODE_OF_CONDUCT.md).
- Found a security issue? **Please don't open a public issue.** Follow [SECURITY.md](SECURITY.md) to report it privately. (This is a local desktop app meant for localhost / your LAN / your tailnet, not the public internet — but we still take reports seriously.)

Questions that don't fit an issue? Reach the maintainer at **ehukaimedia@gmail.com**.

Licensed under [MIT](LICENSE). Thanks for contributing.
