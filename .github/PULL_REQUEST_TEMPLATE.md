<!--
Thanks for contributing to SEO Video Slicer!
Keep PRs focused and small. Fill in the sections below and delete any that don't apply.
-->

## Summary

<!-- What does this PR do, and why? One or two sentences. -->

## Type of change

- [ ] Fix (non-breaking change that resolves a bug)
- [ ] Feature (non-breaking change that adds functionality)
- [ ] Docs (documentation only)
- [ ] Refactor (no behavior change)
- [ ] Test (adds or improves tests)
- [ ] Chore (build, tooling, CI, deps)

## Checklist

- [ ] I ran `make test` (pytest + kernel verify) locally and it passes.
- [ ] CI is green on this branch.
- [ ] Follows `DESIGN.md` — "The Dark Instrument" (no light/cream/magenta/serif/webfonts).
- [ ] Does NOT break the frozen package contract — `verify.mjs` still passes and the fingerprint recipe stays byte-identical between `build_package.mjs` and `verify.mjs` (fingerprint parity intact).
- [ ] Updated docs + CHANGELOG if this is user-facing.
- [ ] No new heavy dependencies introduced.
- [ ] Respects the lean non-goals (no in-app animation generator / local LLM / chat assistant / multi-project CRM).

## How verified

<!-- How did you verify this works? Commands run, manual steps, clip used (origin/duration/resolution/fps), screenshots. -->

## Linked issues

<!-- e.g. Closes #123 -->
