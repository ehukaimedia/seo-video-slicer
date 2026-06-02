#!/usr/bin/env node
// verify.mjs — seo-video-slicer Package Contract quality gate (G1–G7).
//
// ZERO npm dependencies. Node builtins only (node:crypto, node:fs, node:path, node:url).
// Runs INSIDE a built package directory: cwd = the package, OR pass the package path as argv[2].
//
// Authority: package-contract/CONTRACT.md (FROZEN). The FINGERPRINT_RECIPE in §G5 below is
// copied VERBATIM from CONTRACT.md §2 (lines 131–138). Do not edit it — packager and verify.mjs
// must agree byte-for-byte on the fingerprint.
//
// Exit code: 0 if every gate PASSES; 1 if ANY gate FAILS. Warnings never change the exit code.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// FINGERPRINT_RECIPE — copied VERBATIM from CONTRACT.md §2 (lines 131–138).
// The `import crypto from 'node:crypto'` above is part of the recipe: Node's *global*
// crypto is Web Crypto and has no createHash; createHash lives only on node:crypto.
// ─────────────────────────────────────────────────────────────────────────────
function fingerprint(frameBasenames, gsapUrlOrEmpty, templateId) {
  const payload = JSON.stringify({ frames: frameBasenames, gsap: gsapUrlOrEmpty, templateId });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Frozen constants (single source: CONTRACT.md §1, §3, §4, §5).
// ─────────────────────────────────────────────────────────────────────────────
const PACKAGE_SCHEMA = 'seo-video-slicer.package.v1';
const TEMPLATE_ID    = 'seo-video-slicer.scroll.v1';
const FRAME_RE       = /^frame_(\d{3})\.webp$/;            // bare basename, 3-digit zero-pad
const HTML_FRAME_RE  = /\.\/frames\/frame_\d{3}\.webp/g;   // reference form inside index.html

// WEIGHT_BUDGET (CONTRACT.md §4). Only FRAME_COUNT_HARD_MAX is a hard failure.
const FRAME_COUNT_HARD_MAX   = 200;            // count > 200 ⇒ G7 FAIL
const FRAME_COUNT_HARD_MIN   = 1;              // count < 1   ⇒ G7 FAIL (a package always has ≥1 frame)
const TOTAL_BYTES_SOFT_CAP   = 4 * 1024 * 1024; // ~4 MB total ⇒ WARN only
const PER_FRAME_SOFT_CAP     = 256 * 1024;      // 256 KB per WebP ⇒ WARN only
const HERO_LANE_MIN          = 20;
const HERO_LANE_MAX          = 80;

// ─────────────────────────────────────────────────────────────────────────────
// Resolve package root: argv[2] if given, else cwd.
// ─────────────────────────────────────────────────────────────────────────────
const PKG_ROOT   = path.resolve(process.argv[2] || process.cwd());
const INDEX_HTML = path.join(PKG_ROOT, 'index.html');
const MANIFEST   = path.join(PKG_ROOT, 'manifest.json');
const README     = path.join(PKG_ROOT, 'README.md');
const FRAMES_DIR = path.join(PKG_ROOT, 'frames');

// ─────────────────────────────────────────────────────────────────────────────
// Report harness. Each gate returns { ok, lines:[], notes:[], warns:[] }.
// A thrown error inside a gate becomes a FAIL (never an uncaught crash).
// ─────────────────────────────────────────────────────────────────────────────
const results = [];
function runGate(id, title, fn) {
  const r = { id, title, ok: false, lines: [], notes: [], warns: [] };
  try {
    fn(r);
    if (r.ok === undefined) r.ok = true;
  } catch (e) {
    r.ok = false;
    r.lines.push(e && e.message ? e.message : String(e));
  }
  results.push(r);
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared readers / extractors (used by multiple gates; single source of truth).
// ─────────────────────────────────────────────────────────────────────────────
function readText(p, label) {
  if (!fs.existsSync(p)) throw new Error(`${label} not found at ${p}`);
  return fs.readFileSync(p, 'utf8');
}

// Bare frame basenames from frames/, sorted with plain .sort() (CONTRACT.md §2.1/§2.3).
function listFrameBasenames() {
  if (!fs.existsSync(FRAMES_DIR) || !fs.statSync(FRAMES_DIR).isDirectory()) {
    throw new Error(`frames/ directory not found at ${FRAMES_DIR}`);
  }
  return fs.readdirSync(FRAMES_DIR).filter((n) => FRAME_RE.test(n)).sort();
}

// ONE shared GSAP-URL extractor for G3 (allowed external) and G5 (hash input).
// Returns the exact src URL string if a GSAP cdnjs <script src> is present, else "".
function extractGsapUrl(html) {
  const scriptSrcRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = scriptSrcRe.exec(html)) !== null) {
    const url = m[1].trim();
    if (/gsap/i.test(url) && /cdnjs\.cloudflare\.com/i.test(url)) return url;
  }
  return '';
}

// templateId read from the data-template-id attribute in index.html (CONTRACT.md §2.3).
function extractTemplateId(html) {
  const m = html.match(/data-template-id\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// G1 — asset closure: every ./frames/frame_NNN.webp referenced in index.html exists.
// ─────────────────────────────────────────────────────────────────────────────
runGate('G1', 'Asset closure (referenced frames exist)', (r) => {
  const html = readText(INDEX_HTML, 'index.html');
  const refs = [...new Set((html.match(HTML_FRAME_RE) || []).map((s) => s.replace(/^\.\//, '')))];
  if (refs.length === 0) {
    r.ok = false;
    r.lines.push('no ./frames/frame_NNN.webp references found in index.html');
    return;
  }
  const missing = refs.filter((rel) => !fs.existsSync(path.join(PKG_ROOT, rel)));
  if (missing.length) {
    r.ok = false;
    r.lines.push(`${missing.length} referenced frame(s) missing on disk:`);
    missing.slice(0, 10).forEach((p) => r.lines.push(`  - ${p}`));
    if (missing.length > 10) r.lines.push(`  …and ${missing.length - 10} more`);
  } else {
    r.ok = true;
    r.lines.push(`${refs.length} referenced frame(s), all present`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// G2 — naming / contiguity: frame_000..frame_(N-1), zero-padded, no gaps,
//      count === manifest.frames.count.
// ─────────────────────────────────────────────────────────────────────────────
runGate('G2', 'Frame naming, contiguity & count match', (r) => {
  const all = fs.existsSync(FRAMES_DIR) && fs.statSync(FRAMES_DIR).isDirectory()
    ? fs.readdirSync(FRAMES_DIR)
    : (() => { throw new Error(`frames/ directory not found at ${FRAMES_DIR}`); })();

  const frameFiles = all.filter((n) => FRAME_RE.test(n)).sort();
  const nonFrameWebp = all.filter((n) => /\.webp$/i.test(n) && !FRAME_RE.test(n));

  let ok = true;
  if (frameFiles.length === 0) {
    ok = false;
    r.lines.push('no frame_NNN.webp files found in frames/');
  }
  if (nonFrameWebp.length) {
    ok = false;
    r.lines.push(`misnamed/zero-pad-violating .webp file(s): ${nonFrameWebp.slice(0, 8).join(', ')}`);
  }
  // Contiguity: indices must be exactly 0..length-1.
  const indices = frameFiles.map((n) => parseInt(n.match(FRAME_RE)[1], 10));
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) {
      ok = false;
      const expected = `frame_${String(i).padStart(3, '0')}.webp`;
      r.lines.push(`contiguity break at position ${i}: expected ${expected}, found ${frameFiles[i]}`);
      break;
    }
  }
  // Count must equal manifest.frames.count.
  let manifestCount = null;
  try {
    const manifest = JSON.parse(readText(MANIFEST, 'manifest.json'));
    manifestCount = manifest && manifest.frames ? manifest.frames.count : undefined;
  } catch (e) {
    ok = false;
    r.lines.push(`could not read manifest.frames.count (${e.message})`);
  }
  if (manifestCount !== null) {
    if (manifestCount !== frameFiles.length) {
      ok = false;
      r.lines.push(`count mismatch: manifest.frames.count=${manifestCount} but ${frameFiles.length} frame file(s) on disk`);
    }
  }
  if (ok) {
    r.lines.push(`${frameFiles.length} frame(s) frame_000…frame_${String(frameFiles.length - 1).padStart(3, '0')}, contiguous; count matches manifest`);
  }
  r.ok = ok;
});

// ─────────────────────────────────────────────────────────────────────────────
// G3 — self-contained: no http(s):// asset leaks, no localhost, no scratch/abs paths.
//      Only relative ./frames/ refs. GSAP cdnjs URL is the sole permitted external
//      (flagged as a NOTE, not a failure). W3C namespace URIs (inline SVG) are allowed.
// ─────────────────────────────────────────────────────────────────────────────
runGate('G3', 'Self-contained (no external/scratch asset leaks)', (r) => {
  const html = readText(INDEX_HTML, 'index.html');
  const gsapUrl = extractGsapUrl(html);
  if (gsapUrl) r.notes.push(`optional GSAP external present (CONTRACT permits it): ${gsapUrl}`);

  const leaks = [];

  // (a) http(s):// URLs — allow GSAP cdnjs and W3C XML namespace URIs only.
  const urlRe = /https?:\/\/[^\s"'<>)]+/gi;
  let m;
  while ((m = urlRe.exec(html)) !== null) {
    const url = m[0];
    if (gsapUrl && url === gsapUrl) continue;                 // permitted optional external
    if (/^https?:\/\/(www\.)?w3\.org\//i.test(url)) continue; // inline-SVG / XML namespace, not an asset
    leaks.push(`external URL: ${url}`);
  }

  // (b) localhost / 127.0.0.1 / file:// leaks.
  const hostRe = /\b(?:file:\/\/|localhost|127\.0\.0\.1|0\.0\.0\.0)[^\s"'<>)]*/gi;
  while ((m = hostRe.exec(html)) !== null) leaks.push(`local-host/file path: ${m[0]}`);

  // (c) absolute / scratch filesystem paths to local assets.
  const scratchRe = /["'(]\s*(?:[A-Za-z]:[\\/]|\/Users\/|\/Volumes\/|\/tmp\/|\/private\/var\/|\/var\/folders\/|\/home\/)[^"')]*/g;
  while ((m = scratchRe.exec(html)) !== null) leaks.push(`absolute/scratch path: ${m[0].replace(/^["'(]\s*/, '')}`);

  if (leaks.length) {
    r.ok = false;
    r.lines.push(`${leaks.length} leak(s) found:`);
    [...new Set(leaks)].slice(0, 12).forEach((l) => r.lines.push(`  - ${l}`));
  } else {
    r.ok = true;
    r.lines.push('no external/scratch asset leaks; relative ./frames/ refs only' + (gsapUrl ? ' (+ optional GSAP)' : ''));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// G4 — required techniques present in index.html:
//      cover-fit max(...), DPR (devicePixelRatio), preload onerror,
//      prefers-reduced-motion block, data-template-id="seo-video-slicer.scroll.v1".
// ─────────────────────────────────────────────────────────────────────────────
runGate('G4', 'Required player techniques present', (r) => {
  const html = readText(INDEX_HTML, 'index.html');
  const checks = [
    ['cover-fit (max( … ))',        /\bmax\s*\(/.test(html)],
    ['DPR scaling (devicePixelRatio)', /devicePixelRatio/.test(html)],
    ['preload onerror handler',     /onerror/i.test(html)],
    ['prefers-reduced-motion block', /prefers-reduced-motion\s*:\s*reduce/i.test(html)],
    [`data-template-id="${TEMPLATE_ID}"`, new RegExp(`data-template-id\\s*=\\s*["']${TEMPLATE_ID.replace(/[.]/g, '\\.')}["']`).test(html)],
  ];
  const missing = checks.filter(([, present]) => !present).map(([name]) => name);
  if (missing.length) {
    r.ok = false;
    r.lines.push('missing technique marker(s):');
    missing.forEach((name) => r.lines.push(`  - ${name}`));
  } else {
    r.ok = true;
    r.lines.push('all 5 technique markers present');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// G5 — fingerprint parity. manifest parses; schema === PACKAGE_SCHEMA; fingerprint present;
//      RECOMPUTE via FINGERPRINT_RECIPE over the package (§2.3) and assert equality.
//      Inputs are derived from the PACKAGE itself, NOT from the manifest's own fields:
//        frameBasenames ← frames/ dir (bare, sorted)
//        gsapUrlOrEmpty ← index.html <script src> (or "")
//        templateId     ← index.html data-template-id attribute
// ─────────────────────────────────────────────────────────────────────────────
runGate('G5', 'Manifest schema + recomputed fingerprint parity', (r) => {
  let manifest;
  try {
    manifest = JSON.parse(readText(MANIFEST, 'manifest.json'));
  } catch (e) {
    r.ok = false;
    r.lines.push(`manifest.json unparseable: ${e.message}`);
    return;
  }
  let ok = true;
  if (manifest.schema !== PACKAGE_SCHEMA) {
    ok = false;
    r.lines.push(`schema mismatch: expected "${PACKAGE_SCHEMA}", got ${JSON.stringify(manifest.schema)}`);
  }
  const stored = manifest.fingerprint && manifest.fingerprint.value;
  if (!stored) {
    ok = false;
    r.lines.push('manifest.fingerprint.value missing');
  }

  // Recompute inputs from the package (NOT from the manifest object).
  const html = readText(INDEX_HTML, 'index.html');
  const frameBasenames = listFrameBasenames();           // bare, plain .sort()
  const gsapUrlOrEmpty = extractGsapUrl(html);           // shared with G3
  const templateId     = extractTemplateId(html);        // from HTML attribute

  if (templateId !== TEMPLATE_ID) {
    ok = false;
    r.lines.push(`data-template-id in index.html is ${JSON.stringify(templateId)}, expected "${TEMPLATE_ID}"`);
  }

  const recomputed = fingerprint(frameBasenames, gsapUrlOrEmpty, templateId);
  if (stored && recomputed !== stored) {
    ok = false;
    r.lines.push('fingerprint mismatch:');
    r.lines.push(`  recomputed: ${recomputed}`);
    r.lines.push(`  manifest:   ${stored}`);
    r.lines.push(`  inputs: frames=[${frameBasenames.length} basenames], gsap=${JSON.stringify(gsapUrlOrEmpty)}, templateId=${JSON.stringify(templateId)}`);
  } else if (stored) {
    r.lines.push(`schema ok; fingerprint matches (${recomputed.slice(0, 12)}…)`);
  }
  r.ok = ok;
});

// ─────────────────────────────────────────────────────────────────────────────
// G6 — README.md exists, ≤200 lines, has Iframe / React / Vanilla headings
//      (case-insensitive). PROMPT.md optional (its absence never fails).
// ─────────────────────────────────────────────────────────────────────────────
runGate('G6', 'README present, ≤200 lines, integration headings', (r) => {
  let readme;
  try {
    readme = readText(README, 'README.md');
  } catch (e) {
    r.ok = false;
    r.lines.push(e.message);
    return;
  }
  let ok = true;
  const lineCount = readme.split('\n').length;
  if (lineCount > 200) {
    ok = false;
    r.lines.push(`README.md is ${lineCount} lines (limit 200)`);
  }
  const headings = [
    ['Iframe',  /^#{1,6}\s.*iframe/im],
    ['React',   /^#{1,6}\s.*react/im],
    ['Vanilla', /^#{1,6}\s.*vanilla/im],
  ];
  const missing = headings.filter(([, re]) => !re.test(readme)).map(([n]) => n);
  if (missing.length) {
    ok = false;
    r.lines.push(`missing integration heading(s): ${missing.join(', ')}`);
  }
  if (ok) r.lines.push(`README.md ${lineCount} lines; Iframe / React / Vanilla headings present`);

  if (fs.existsSync(path.join(PKG_ROOT, 'PROMPT.md'))) r.notes.push('PROMPT.md present (optional)');
  else r.notes.push('PROMPT.md absent (optional — not required)');
  r.ok = ok;
});

// ─────────────────────────────────────────────────────────────────────────────
// G7 — weight budget. HARD-FAIL only when count > 200 or < 1 (CONTRACT.md §4).
//      Total > ~4 MB ⇒ WARN. Any frame > 256 KB ⇒ WARN. Bytes measured from disk
//      (NOT trusting manifest.seo.total_bytes — contract §1 line 58).
// ─────────────────────────────────────────────────────────────────────────────
runGate('G7', 'Weight budget (count hard-cap; size soft-caps)', (r) => {
  const frameFiles = listFrameBasenames();
  const count = frameFiles.length;

  let ok = true;
  if (count > FRAME_COUNT_HARD_MAX) {
    ok = false;
    r.lines.push(`frame count ${count} exceeds hard cap ${FRAME_COUNT_HARD_MAX}`);
  }
  if (count < FRAME_COUNT_HARD_MIN) {
    ok = false;
    r.lines.push(`frame count ${count} below minimum ${FRAME_COUNT_HARD_MIN}`);
  }

  // Per-frame + total bytes from disk.
  let total = 0;
  const oversized = [];
  for (const name of frameFiles) {
    const sz = fs.statSync(path.join(FRAMES_DIR, name)).size;
    total += sz;
    if (sz > PER_FRAME_SOFT_CAP) oversized.push(`${name} (${(sz / 1024).toFixed(0)} KB)`);
  }

  // Lane context (informational).
  if (count >= HERO_LANE_MIN && count <= HERO_LANE_MAX) r.notes.push(`hero lane (${count} frames, ideal range ${HERO_LANE_MIN}–${HERO_LANE_MAX})`);
  else if (count > HERO_LANE_MAX && count <= FRAME_COUNT_HARD_MAX) r.notes.push(`scrollytelling lane (${count} frames)`);

  if (oversized.length) r.warns.push(`${oversized.length} frame(s) over ${PER_FRAME_SOFT_CAP / 1024} KB soft cap: ${oversized.slice(0, 6).join(', ')}${oversized.length > 6 ? ' …' : ''}`);
  if (total > TOTAL_BYTES_SOFT_CAP) r.warns.push(`total frame bytes ${(total / 1024 / 1024).toFixed(2)} MB over ~${(TOTAL_BYTES_SOFT_CAP / 1024 / 1024)} MB soft cap`);

  if (ok) r.lines.push(`count ${count} within [${FRAME_COUNT_HARD_MIN}, ${FRAME_COUNT_HARD_MAX}]; total ${(total / 1024 / 1024).toFixed(2)} MB`);
  r.ok = ok;
});

// ─────────────────────────────────────────────────────────────────────────────
// Report.
// ─────────────────────────────────────────────────────────────────────────────
let anyFail = false;
const out = [];
out.push('');
out.push(`seo-video-slicer package gate — ${PKG_ROOT}`);
out.push('─'.repeat(60));
for (const r of results) {
  if (!r.ok) anyFail = true;
  out.push(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.id}  ${r.title}`);
  for (const l of r.lines)  out.push(`        ${l}`);
  for (const n of r.notes)  out.push(`   note  ${n}`);
  for (const w of r.warns)  out.push(`   WARN  ${w}`);
}
out.push('─'.repeat(60));
out.push(anyFail ? 'RESULT: FAIL (one or more gates failed)' : 'RESULT: PASS (all gates passed)');
out.push('');
process.stdout.write(out.join('\n') + '\n');

process.exit(anyFail ? 1 : 0);
