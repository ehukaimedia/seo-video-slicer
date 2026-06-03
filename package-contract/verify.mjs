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
const FRAME_RE       = /^frame_(\d{3})\.webp$/;            // bare basename, 3-digit zero-pad
const HTML_FRAME_RE  = /\.\/frames\/frame_\d{3}\.webp/g;   // reference form inside index.html

// WEIGHT_BUDGET (CONTRACT.md §4). Only FRAME_COUNT_HARD_MAX is a hard failure.
const FRAME_COUNT_HARD_MAX   = 200;            // count > 200 ⇒ G7 FAIL
const FRAME_COUNT_HARD_MIN   = 1;              // count < 1   ⇒ G7 FAIL (a package always has ≥1 frame)
const TOTAL_BYTES_SOFT_CAP   = 4 * 1024 * 1024; // ~4 MB total ⇒ WARN only
const PER_FRAME_SOFT_CAP     = 256 * 1024;      // 256 KB per WebP ⇒ WARN only
const LOOP_WEBP_SOFT_CAP     = 4 * 1024 * 1024; // ~4 MB loop.webp ⇒ WARN only (§6.8)
const HERO_LANE_MIN          = 20;
const HERO_LANE_MAX          = 80;

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA_CONFIG (spec §6.4b) — verify.mjs READS manifest.schema once and selects
// a config. The scroll config equals today's frozen PACKAGE_SCHEMA/TEMPLATE_ID
// constants, so the scroll path is logically unchanged. The loop config swaps
// the schema/templateId and adds extra gates G8/G9. Gate IDs G1..G9 stay stable
// (a loop package emits G4 with loop assertions, NOT a separate G4′).
// ─────────────────────────────────────────────────────────────────────────────
const SCHEMA_CONFIG = {
  'seo-video-slicer.package.v1': {
    schema: 'seo-video-slicer.package.v1',
    templateId: 'seo-video-slicer.scroll.v1',
    interaction: 'scroll',
    extraGates: [],
  },
  'seo-video-slicer.loop-package.v1': {
    schema: 'seo-video-slicer.loop-package.v1',
    templateId: 'seo-video-slicer.loop.v1',
    interaction: 'loop',
    extraGates: ['G8', 'G9'],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolve package root: argv[2] if given, else cwd.
// ─────────────────────────────────────────────────────────────────────────────
const PKG_ROOT   = path.resolve(process.argv[2] || process.cwd());
const INDEX_HTML = path.join(PKG_ROOT, 'index.html');
const MANIFEST   = path.join(PKG_ROOT, 'manifest.json');
const README     = path.join(PKG_ROOT, 'README.md');
const FRAMES_DIR = path.join(PKG_ROOT, 'frames');
const LOOP_WEBP  = path.join(PKG_ROOT, 'loop.webp');

// ─────────────────────────────────────────────────────────────────────────────
// Read manifest.schema ONCE and select the SCHEMA_CONFIG (§6.4b). Unknown /
// unreadable schema ⇒ default to the scroll config so G5 reports the mismatch
// (rather than crashing) and the package still fails loudly.
// ─────────────────────────────────────────────────────────────────────────────
function selectConfig() {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    if (m && m.schema && SCHEMA_CONFIG[m.schema]) return SCHEMA_CONFIG[m.schema];
  } catch {
    /* fall through to scroll default */
  }
  return SCHEMA_CONFIG['seo-video-slicer.package.v1'];
}
const CFG = selectConfig();

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
// G4 — required techniques present in index.html (config-keyed presence gate).
//   scroll: cover-fit max(...), DPR, preload onerror, prefers-reduced-motion,
//           data-template-id="seo-video-slicer.scroll.v1".
//   loop (§6.6): the above cover-fit/DPR/onerror/reduced-motion + the loop
//           data-template-id PLUS the positive TIME-DRIVEN markers —
//           requestAnimationFrame AND an elapsed-time term (performance.now()).
//           A regex cannot prove the index formula; G4 proves the time-term is
//           present, the actual time-driven loop is proven in-browser (§12).
// ─────────────────────────────────────────────────────────────────────────────
runGate('G4', 'Required player techniques present', (r) => {
  const html = readText(INDEX_HTML, 'index.html');
  const tidRe = new RegExp(`data-template-id\\s*=\\s*["']${CFG.templateId.replace(/[.]/g, '\\.')}["']`);
  const checks = [
    ['cover-fit (max( … ))',        /\bmax\s*\(/.test(html)],
    ['DPR scaling (devicePixelRatio)', /devicePixelRatio/.test(html)],
    ['preload onerror handler',     /onerror/i.test(html)],
    ['prefers-reduced-motion block', /prefers-reduced-motion\s*:\s*reduce/i.test(html)],
    [`data-template-id="${CFG.templateId}"`, tidRe.test(html)],
  ];
  if (CFG.interaction === 'loop') {
    // Positive time-driven markers — the loop is rAF against elapsed time.
    checks.push(['requestAnimationFrame loop', /requestAnimationFrame/.test(html)]);
    checks.push(['elapsed-time term (performance.now())', /performance\.now\s*\(/.test(html)]);
  }
  const missing = checks.filter(([, present]) => !present).map(([name]) => name);
  if (missing.length) {
    r.ok = false;
    r.lines.push('missing technique marker(s):');
    missing.forEach((name) => r.lines.push(`  - ${name}`));
  } else {
    r.ok = true;
    r.lines.push(`all ${checks.length} technique markers present`);
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
  if (manifest.schema !== CFG.schema) {
    ok = false;
    r.lines.push(`schema mismatch: expected "${CFG.schema}", got ${JSON.stringify(manifest.schema)}`);
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

  if (templateId !== CFG.templateId) {
    ok = false;
    r.lines.push(`data-template-id in index.html is ${JSON.stringify(templateId)}, expected "${CFG.templateId}"`);
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

  // Loop (§6.8): re-measure loop.webp from disk into the total; an oversized
  // loop.webp is a WARN that names the file and never changes the exit code.
  if (CFG.interaction === 'loop' && fs.existsSync(LOOP_WEBP)) {
    const loopSz = fs.statSync(LOOP_WEBP).size;
    total += loopSz;
    if (loopSz > LOOP_WEBP_SOFT_CAP) {
      r.warns.push(`loop.webp ${(loopSz / 1024 / 1024).toFixed(2)} MB over ~${LOOP_WEBP_SOFT_CAP / 1024 / 1024} MB soft cap`);
    }
  }

  // Lane context (informational).
  if (count >= HERO_LANE_MIN && count <= HERO_LANE_MAX) r.notes.push(`hero lane (${count} frames, ideal range ${HERO_LANE_MIN}–${HERO_LANE_MAX})`);
  else if (count > HERO_LANE_MAX && count <= FRAME_COUNT_HARD_MAX) r.notes.push(`scrollytelling lane (${count} frames)`);

  if (oversized.length) r.warns.push(`${oversized.length} frame(s) over ${PER_FRAME_SOFT_CAP / 1024} KB soft cap: ${oversized.slice(0, 6).join(', ')}${oversized.length > 6 ? ' …' : ''}`);
  if (total > TOTAL_BYTES_SOFT_CAP) r.warns.push(`total package bytes ${(total / 1024 / 1024).toFixed(2)} MB over ~${(TOTAL_BYTES_SOFT_CAP / 1024 / 1024)} MB soft cap`);

  if (ok) r.lines.push(`count ${count} within [${FRAME_COUNT_HARD_MIN}, ${FRAME_COUNT_HARD_MAX}]; total ${(total / 1024 / 1024).toFixed(2)} MB`);
  r.ok = ok;
});

// ─────────────────────────────────────────────────────────────────────────────
// Animated-WebP RIFF walker (zero-dep) — shared by G8. Walks top-level RIFF
// chunks: [FourCC:4][size:LE32][payload:size][pad to even]. Returns the VP8X
// flags byte, whether an ANIM chunk is present, and the ANMF frame durations
// (24-bit LE at ANMF-payload offset 12, per the WebP container spec / §6.5 G8).
// ─────────────────────────────────────────────────────────────────────────────
function parseAnimatedWebp(buf) {
  if (buf.length < 12) throw new Error('file too small to be a RIFF/WEBP container');
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('missing RIFF header');
  if (buf.toString('ascii', 8, 12) !== 'WEBP') throw new Error('missing WEBP form type');

  let vp8xFlags = null;
  let hasAnim = false;
  const anmfDurations = [];

  let off = 12;
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const payloadStart = off + 8;
    if (payloadStart + size > buf.length) break; // truncated chunk — stop walking
    if (fourcc === 'VP8X') {
      vp8xFlags = buf[payloadStart]; // first byte holds the feature flags
    } else if (fourcc === 'ANIM') {
      hasAnim = true;
    } else if (fourcc === 'ANMF') {
      // ANMF payload layout: X(3) Y(3) W(3) H(3) Duration(3) ... → Duration at +12.
      const dpo = payloadStart + 12;
      if (dpo + 3 <= buf.length) {
        anmfDurations.push(buf[dpo] | (buf[dpo + 1] << 8) | (buf[dpo + 2] << 16));
      } else {
        anmfDurations.push(null);
      }
    }
    off = payloadStart + size + (size & 1); // chunks are padded to an even size
  }
  return { vp8xFlags, hasAnim, anmfDurations };
}

// ─────────────────────────────────────────────────────────────────────────────
// G8 — loop.webp structure + fps binding (LOOP ONLY). loop.webp is a real
//      ANIMATED WebP (RIFF/WEBP, VP8X with the ANIM flag (0x02), an ANIM chunk).
//      COALESCING-ROBUST: libwebp encoders (Pillow/ffmpeg/img2webp) merge
//      byte-identical CONSECUTIVE frames into a single ANMF whose 24-bit-LE
//      Frame Duration is the SUM of the merged per-frame durations — no flag
//      disables this (encoder spike §6.9). Coalescing only REDUCES the ANMF
//      count, so G8 requires 1 <= ANMF count <= frames.count (more ANMF than
//      frames is impossible/invalid) and binds fps to the bytes via the
//      INVARIANT duration SUM:
//        SUM(ANMF durations) == frames.count * perFrameMs(fps)
//      where perFrameMs(fps) = Math.floor(1000 / fps + 0.5) — the FROZEN
//      half-up formula, IDENTICAL to loop_export.py (CONTRACT-loop.md §2.1;
//      JS Math.round and Python round diverge at fps=16, this does not).
//      A manifest-fps-only edit changes the expected sum; a re-encode or a
//      single-frame duration tamper changes the actual sum — either fails here
//      while G9's sha is the byte lock. FAIL ⇒ non-zero.
// ─────────────────────────────────────────────────────────────────────────────
if (CFG.extraGates.includes('G8')) {
  runGate('G8', 'loop.webp animated-WebP structure + fps↔duration binding', (r) => {
    const manifest = JSON.parse(readText(MANIFEST, 'manifest.json'));
    const frameCount = manifest && manifest.frames ? manifest.frames.count : undefined;
    if (!Number.isFinite(frameCount)) {
      r.ok = false;
      r.lines.push('manifest.frames.count missing/invalid');
      return;
    }

    // ── WHOLE manifest.loop block validation (Finding 2). G8 already consumes
    //    loop.fps; it now validates EVERY loop field that G1–G9 otherwise never
    //    reads, so a manifest cannot LIE about duration_s / webp / loop_count and
    //    still pass. Each is a hard FAIL with a clear message. ──
    const loop = manifest ? manifest.loop : undefined;
    if (!loop || typeof loop !== 'object' || Array.isArray(loop)) {
      r.ok = false;
      r.lines.push('manifest.loop missing or not an object (a loop package must carry the loop block)');
      return;
    }

    // loop.webp — frozen filename "loop.webp" (CONTRACT-loop.md §3). Read the
    // animated WebP FROM the manifest-declared name so a lie ("missing.webp")
    // fails either this assert or the subsequent missing-file check.
    if (loop.webp !== 'loop.webp') {
      r.ok = false;
      r.lines.push(`manifest.loop.webp must be "loop.webp", got ${JSON.stringify(loop.webp)}`);
      return;
    }
    const loopWebpPath = path.join(PKG_ROOT, loop.webp);

    // loop.loop_count — frozen 0 (infinite) (CONTRACT-loop.md §3).
    if (loop.loop_count !== 0) {
      r.ok = false;
      r.lines.push(`manifest.loop.loop_count must be 0 (infinite), got ${JSON.stringify(loop.loop_count)}`);
      return;
    }

    // loop.fps — finite positive number (also closes the fps gate for loop).
    const fps = loop.fps;
    if (!Number.isFinite(fps) || fps <= 0) {
      r.ok = false;
      r.lines.push('manifest.loop.fps missing or not a positive number');
      return;
    }

    // loop.webp_sha256 — lowercase 64-char hex FORMAT check (G9 still compares
    // the VALUE against the actual bytes).
    if (typeof loop.webp_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(loop.webp_sha256)) {
      r.ok = false;
      r.lines.push(`manifest.loop.webp_sha256 must be a lowercase 64-char hex string, got ${JSON.stringify(loop.webp_sha256)}`);
      return;
    }

    // loop.duration_s — recomputed the SAME way the builder does
    //   (build_package.mjs §6.3: loop.duration_s = frames.count / fps),
    //   compared with a tiny epsilon so legitimate packages pass but 999 fails.
    if (!Number.isFinite(loop.duration_s)) {
      r.ok = false;
      r.lines.push(`manifest.loop.duration_s must be a finite number, got ${JSON.stringify(loop.duration_s)}`);
      return;
    }
    const expectedDurationS = frameCount / fps;
    if (Math.abs(loop.duration_s - expectedDurationS) > 1e-6) {
      r.ok = false;
      r.lines.push(`manifest.loop.duration_s ${loop.duration_s} != frames.count ${frameCount} / fps ${fps} = ${expectedDurationS}`);
      return;
    }

    if (!fs.existsSync(loopWebpPath)) {
      r.ok = false;
      r.lines.push(`loop.webp not found at ${loopWebpPath}`);
      return;
    }
    const buf = fs.readFileSync(loopWebpPath);
    const { vp8xFlags, hasAnim, anmfDurations } = parseAnimatedWebp(buf);

    let ok = true;
    if (vp8xFlags === null) {
      ok = false;
      r.lines.push('no VP8X chunk (not an extended-format WebP)');
    } else if (!(vp8xFlags & 0x02)) {
      ok = false;
      r.lines.push(`VP8X present but ANIM flag (0x02) not set (flags byte=0x${vp8xFlags.toString(16)})`);
    }
    if (!hasAnim) {
      ok = false;
      r.lines.push('no ANIM chunk (not an animated WebP)');
    }

    // Structural ANMF count bound: coalescing only REDUCES the count, so a
    // valid loop has 1 <= ANMF count <= frames.count. More ANMF than frames is
    // impossible from a frames.count-frame bake (a tamper); zero ANMF is not
    // animated.
    const anmfCount = anmfDurations.length;
    if (anmfCount < 1) {
      ok = false;
      r.lines.push(`ANMF count 0 (no animation frames)`);
    } else if (anmfCount > frameCount) {
      ok = false;
      r.lines.push(`ANMF count ${anmfCount} > frames.count ${frameCount}`);
    }

    // A truncated ANMF (null duration) cannot contribute to the sum — fail loud
    // rather than NaN-propagate.
    const truncated = [];
    for (let i = 0; i < anmfDurations.length; i++) {
      if (anmfDurations[i] === null) truncated.push(`#${i}`);
    }
    if (truncated.length) {
      ok = false;
      r.lines.push(`${truncated.length} ANMF duration field(s) truncated/unreadable: ${truncated.slice(0, 8).join(', ')}`);
    }

    // FROZEN half-up per-frame formula (IDENTICAL to loop_export.py). Sum-based
    // binding survives coalescing: a coalesced frame's duration is the SUM of
    // the merged per-frame durations, so the TOTAL is invariant.
    const perFrameMs = Math.floor(1000 / fps + 0.5);
    const expectedSum = frameCount * perFrameMs;
    if (!truncated.length) {
      const actualSum = anmfDurations.reduce((a, d) => a + d, 0);
      if (actualSum !== expectedSum) {
        ok = false;
        r.lines.push(`ANMF duration sum ${actualSum} != frames.count ${frameCount} * ${perFrameMs} = ${expectedSum} ms`);
      }
    }

    if (ok) {
      r.lines.push(`animated WebP: VP8X+ANIM, ${anmfCount} ANMF (<= frames.count ${frameCount}, coalescing-robust), duration sum ${expectedSum} ms == ${frameCount} * ${perFrameMs} (fps ${fps})`);
    }
    r.ok = ok;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// G9 — loop.webp content integrity (LOOP ONLY, NEW). sha256(loop.webp bytes)
//      == manifest.loop.webp_sha256 via node:crypto. A re-encode (different
//      bytes) fails here. FAIL ⇒ non-zero.
// ─────────────────────────────────────────────────────────────────────────────
if (CFG.extraGates.includes('G9')) {
  runGate('G9', 'loop.webp content integrity (sha256 == manifest.loop.webp_sha256)', (r) => {
    if (!fs.existsSync(LOOP_WEBP)) {
      r.ok = false;
      r.lines.push(`loop.webp not found at ${LOOP_WEBP}`);
      return;
    }
    const manifest = JSON.parse(readText(MANIFEST, 'manifest.json'));
    const stored = manifest && manifest.loop ? manifest.loop.webp_sha256 : undefined;
    if (!stored) {
      r.ok = false;
      r.lines.push('manifest.loop.webp_sha256 missing');
      return;
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(LOOP_WEBP)).digest('hex');
    if (actual !== stored) {
      r.ok = false;
      r.lines.push('loop.webp sha256 mismatch:');
      r.lines.push(`  actual:   ${actual}`);
      r.lines.push(`  manifest: ${stored}`);
    } else {
      r.ok = true;
      r.lines.push(`sha256 matches (${actual.slice(0, 12)}…)`);
    }
  });
}

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
