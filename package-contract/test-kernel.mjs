#!/usr/bin/env node
// test-kernel.mjs — zero-dependency self-test for the frozen package kernel.
//
// Covers BOTH templates the kernel can build (spec §11.1, §13):
//
//   SCROLL
//     • build a scroll package from ffmpeg-generated frames → verify.mjs PASSES;
//       three independent corruptions each FAIL the matching gate (G2/G1, G5, G3).
//     • GOLDEN BYTE-DIFF: rebuild the committed example/sample-package/ from its
//       own frames + manifest args and assert index.html / README.md / PROMPT.md
//       are byte-identical and manifest.json matches (excluding only the per-build
//       id / created_at lines). Any scroll OUTPUT drift fails. (Stronger than
//       fingerprint parity: catches README bytes, manifest key order, FRAMES
//       injection — exactly what the MODE_CONFIG/SCHEMA_CONFIG refactor touches.)
//
//   LOOP
//     • build a loop package from the sample frames + the committed fixture
//       package-contract/test-fixtures/loop.webp → verify.mjs PASSES every gate.
//     • independent corruptions, each FAILS the MATCHING gate while the
//       gates it is isolated against stay PASS (the teeth of a gating test):
//         delete a frame              → G1/G2 FAIL
//         flip one loop.webp byte     → G9 FAIL, G8 PASS
//         edit manifest.loop.fps      → G8 FAIL, G9 PASS, G5 PASS
//         break one ANMF duration sum → G8 FAIL, G9 PASS, G2 PASS
//       + manifest.loop-block falsification (Finding 2) — G8 now validates the
//       WHOLE loop block, so a lying loop field FAILs G8:
//         loop.duration_s=999         → G8 FAIL, G9 PASS, G5 PASS
//         loop.webp="missing.webp"    → G8 FAIL, G9 PASS, G5 PASS
//         loop.loop_count=7           → G8 FAIL, G9 PASS, G5 PASS
//         loop.webp_sha256 uppercase  → G8 FAIL (bad format); isolates against
//                                       G5/G2 (also fails G9's value compare).
//
// Node builtins only (node:child_process, node:crypto, node:fs, node:os, node:path).
// Scroll sample frames are produced with ffmpeg (a tiny solid-color WebP each);
// if ffmpeg is unavailable the script exits non-zero with a clear message.
//
// Run:  node package-contract/test-kernel.mjs
// Exit: 0 if every expectation holds; non-zero (and a FAIL line) otherwise.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(__dirname, 'build_package.mjs');
const VERIFY = path.join(__dirname, 'verify.mjs');

// Committed inputs for the golden + loop cases (NOT /tmp — must travel with the repo).
const SAMPLE_PKG = path.join(REPO_ROOT, 'example', 'sample-package');
const SAMPLE_FRAMES = path.join(SAMPLE_PKG, 'frames');
const LOOP_FIXTURE = path.join(__dirname, 'test-fixtures', 'loop.webp');
// fps=16 parity fixture: the 30 sample frames baked at 63 ms/frame
// (floor(1000/16 + 0.5) = 63, NOT Python round()=62). Regression test for the
// cross-language rounding defect.
const LOOP_FIXTURE_FPS16 = path.join(__dirname, 'test-fixtures', 'loop-fps16.webp');
// HELD-FRAME coalescing fixture: a 5-frame dir whose first 3 frames are
// byte-identical, baked at 12 fps. libwebp coalesces the 3 held frames into ONE
// ANMF (duration 3*83=249), so ANMF count (3) < frame count (5) while the
// duration SUM (415) == 5*83. Strict per-frame G8 would FALSE-FAIL this.
const HELD_FRAMES = path.join(__dirname, 'test-fixtures', 'held-frames');
const HELD_FIXTURE = path.join(__dirname, 'test-fixtures', 'held-loop.webp');

let failures = 0;
function check(label, cond, extra) {
  if (cond) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failures++;
    process.stdout.write(`  FAIL ${label}${extra ? `\n       ${extra}` : ''}\n`);
  }
}

function die(msg) {
  process.stderr.write(`test-kernel: ${msg}\n`);
  process.exit(2);
}

// Parse verify.mjs stdout into { Gx: true|false } from its `[PASS]/[FAIL] Gx  …`
// lines. Lets a case assert the MATCHING gate FAILed AND the gates it isolates
// against PASSed — exit-code alone cannot prove that.
function parseGates(stdout) {
  const gates = {};
  const re = /^\[(PASS|FAIL)\]\s+(G\d+)\b/;
  for (const line of String(stdout || '').split('\n')) {
    const m = line.match(re);
    if (m) gates[m[2]] = m[1] === 'PASS';
  }
  return gates;
}

// Assert: verify exited non-zero, the named gate FAILed, and every gate in
// `mustPass` PASSed (proves the corruption is isolated to the target gate).
function checkGate(label, res, failGate, mustPass = []) {
  const gates = parseGates(res.stdout);
  const exitOk = res.status !== 0;
  const targetFailed = gates[failGate] === false;
  const isolated = mustPass.every((g) => gates[g] === true);
  const cond = exitOk && targetFailed && isolated;
  const extra = cond
    ? undefined
    : `exit=${res.status} ${failGate}=${gates[failGate]} ` +
      mustPass.map((g) => `${g}=${gates[g]}`).join(' ') +
      `\n${(res.stdout || '').slice(-700)}`;
  check(label, cond, extra);
}

// --- temp workspace ---------------------------------------------------------
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'svs-kernel-'));
process.on('exit', () => {
  try {
    fs.rmSync(work, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// --- 1) make a few tiny WebP source frames via ffmpeg -----------------------
function haveFfmpeg() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return r.status === 0;
}
if (!haveFfmpeg()) die('ffmpeg not found on PATH (needed to generate sample frames)');

const srcFrames = path.join(work, 'src-frames');
fs.mkdirSync(srcFrames, { recursive: true });

const FRAME_COUNT = 5;
const colors = ['red', 'green', 'blue', 'yellow', 'magenta'];
for (let i = 0; i < FRAME_COUNT; i++) {
  const out = path.join(srcFrames, `src_${String(i).padStart(3, '0')}.webp`);
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', `color=c=${colors[i % colors.length]}:s=320x180`,
     '-frames:v', '1', out],
    { encoding: 'utf8' }
  );
  if (r.status !== 0 || !fs.existsSync(out)) {
    die(`ffmpeg failed to make sample frame ${i}:\n${(r.stderr || '').slice(-600)}`);
  }
}

// --- helpers ----------------------------------------------------------------
function runNode(scriptArgs, opts = {}) {
  return spawnSync(process.execPath, scriptArgs, { encoding: 'utf8', ...opts });
}

function buildPackage(outDir) {
  const r = runNode([BUILD, '--frames', srcFrames, '--out', outDir, '--id', 'kernel-selftest']);
  if (r.status !== 0) die(`build_package.mjs failed:\n${(r.stderr || r.stdout || '').slice(-800)}`);
  return outDir;
}

// Build a LOOP package from a frames dir + a committed fixture loop.webp at a
// given fps. Defaults: the sample frames + loop.webp (30 ANMF @ 83 ms,
// floor(1000/12+0.5)=83; built from these exact frames).
function buildLoopPackage(outDir, opts = {}) {
  const frames = opts.frames || SAMPLE_FRAMES;
  const fps = opts.fps || '12';
  const fixture = opts.fixture || LOOP_FIXTURE;
  const r = runNode([
    BUILD,
    '--frames', frames,
    '--out', outDir,
    '--id', opts.id || 'loop-selftest',
    '--mode', 'loop',
    '--fps', String(fps),
    '--loop-webp', fixture,
    '--resolution', '1280x720',
    '--origin', 'remotion --sequence',
  ]);
  if (r.status !== 0) die(`build_package.mjs (loop) failed:\n${(r.stderr || r.stdout || '').slice(-800)}`);
  return outDir;
}

// verify.mjs takes the package dir as argv[2] (it does NOT live inside the package).
function verify(pkgDir) {
  return runNode([VERIFY, pkgDir]);
}

// Recursive copy so each corruption operates on an independent package.
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SCROLL — build passes; corruptions each FAIL their matching gate.
// ════════════════════════════════════════════════════════════════════════════
process.stdout.write('\nSCROLL — build → verify (ffmpeg frames)\n');

const pristine = buildPackage(path.join(work, 'pkg-pristine'));
const baseline = verify(pristine);
check('pristine scroll package passes verify.mjs (exit 0)', baseline.status === 0,
  `exit=${baseline.status}\n${(baseline.stdout || '').slice(-600)}`);

// (a) delete a frame -> G2 (contiguity/count) + G1 (asset closure) fail.
{
  const dir = path.join(work, 'pkg-del-frame');
  copyDir(pristine, dir);
  const victim = path.join(dir, 'frames', 'frame_002.webp');
  if (!fs.existsSync(victim)) die('expected frame_002.webp in pristine package');
  fs.rmSync(victim);
  checkGate('scroll: deleting a frame FAILs G2 (contiguity) + G1 (asset closure)',
    verify(dir), 'G2');
  // G1 also fires; assert it independently for clarity.
  const g = parseGates(verify(dir).stdout);
  check('scroll: deleted frame also FAILs G1 (referenced frame missing)', g.G1 === false,
    `G1=${g.G1}`);
}

// (b) tamper the manifest fingerprint -> G5 (fingerprint parity) fails.
{
  const dir = path.join(work, 'pkg-tamper-fp');
  copyDir(pristine, dir);
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.fingerprint.value = '0'.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  checkGate('scroll: tampering manifest.fingerprint FAILs G5 (G1/G2 stay PASS)',
    verify(dir), 'G5', ['G1', 'G2']);
}

// (c) inject an external http:// asset into index.html -> G3 (self-contained) fails.
//     A plain external (NOT gsap-cdnjs, NOT w3.org) — both of those are permitted.
{
  const dir = path.join(work, 'pkg-http-leak');
  copyDir(pristine, dir);
  const indexPath = path.join(dir, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const inject = '<img src="http://evil.example/tracker.png" alt="">';
  html = html.includes('</body>')
    ? html.replace('</body>', `${inject}\n</body>`)
    : html + `\n${inject}\n`;
  fs.writeFileSync(indexPath, html);
  checkGate('scroll: injecting an http:// asset FAILs G3 (G1 stays PASS)',
    verify(dir), 'G3', ['G1']);
}

// ════════════════════════════════════════════════════════════════════════════
// SCROLL GOLDEN BYTE-DIFF (spec §13) — rebuild the committed sample-package from
// its own frames + its manifest's source args and byte-diff every output file.
// Excludes ONLY the per-build `id` / `created_at` lines. Any scroll OUTPUT drift
// (README bytes, manifest key order, FRAMES injection, pinned fingerprint) fails.
// ════════════════════════════════════════════════════════════════════════════
process.stdout.write('\nSCROLL GOLDEN — byte-diff vs example/sample-package\n');
{
  if (!fs.existsSync(SAMPLE_FRAMES)) die(`sample frames not found at ${SAMPLE_FRAMES}`);
  const goldManifest = JSON.parse(fs.readFileSync(path.join(SAMPLE_PKG, 'manifest.json'), 'utf8'));
  const src = goldManifest.source || {};

  const goldDir = path.join(work, 'pkg-golden');
  // Use the SAME id as the golden so only `created_at` differs; pass the golden's
  // own source args so the manifest body (incl. the pinned fingerprint) matches.
  const r = runNode([
    BUILD,
    '--frames', SAMPLE_FRAMES,
    '--out', goldDir,
    '--id', goldManifest.id,
    '--duration', String(src.duration_s),
    '--fps', String(src.fps_effective),
    '--resolution', String(src.resolution),
    '--origin', String(src.origin),
    '--quality', String(goldManifest.frames.quality),
  ]);
  if (r.status !== 0) die(`golden rebuild failed:\n${(r.stderr || r.stdout || '').slice(-800)}`);

  // Byte-identical files: index.html, README.md, PROMPT.md.
  for (const f of ['index.html', 'README.md', 'PROMPT.md']) {
    const a = fs.readFileSync(path.join(SAMPLE_PKG, f));
    const b = fs.readFileSync(path.join(goldDir, f));
    check(`golden: ${f} byte-identical`, a.equals(b),
      `golden ${a.length} bytes vs rebuilt ${b.length} bytes`);
  }

  // manifest.json: byte-diff with ONLY the `id` / `created_at` lines stripped
  // (a line-filtered byte compare — NOT a semantic JSON compare — so it also
  // catches indentation / key-order / fingerprint drift the refactor could add).
  const stripVolatile = (txt) =>
    txt
      .split('\n')
      .filter((l) => !/^\s*"(id|created_at)"\s*:/.test(l))
      .join('\n');
  const goldMan = stripVolatile(fs.readFileSync(path.join(SAMPLE_PKG, 'manifest.json'), 'utf8'));
  const newMan = stripVolatile(fs.readFileSync(path.join(goldDir, 'manifest.json'), 'utf8'));
  check('golden: manifest.json byte-identical (excluding id / created_at lines)',
    goldMan === newMan,
    goldMan === newMan ? undefined : `manifest drift:\n--- golden\n${goldMan}\n--- rebuilt\n${newMan}`);
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP — build a loop package from the sample frames + the committed fixture,
// assert verify.mjs PASSES all gates; then four corruptions each FAIL the
// matching gate (and stay isolated from the gates they must not trip).
// ════════════════════════════════════════════════════════════════════════════
process.stdout.write('\nLOOP — build → verify (committed fixture loop.webp)\n');

for (const [fx, label] of [
  [LOOP_FIXTURE, 'package-contract/test-fixtures/loop.webp'],
  [LOOP_FIXTURE_FPS16, 'package-contract/test-fixtures/loop-fps16.webp'],
  [HELD_FIXTURE, 'package-contract/test-fixtures/held-loop.webp'],
]) {
  if (!fs.existsSync(fx)) die(`committed loop fixture not found at ${fx} (expected ${label})`);
}
if (!fs.existsSync(HELD_FRAMES)) {
  die(`committed held-frames dir not found at ${HELD_FRAMES} (expected package-contract/test-fixtures/held-frames/)`);
}

const loopPristine = buildLoopPackage(path.join(work, 'loop-pristine'));
const loopBaseline = verify(loopPristine);
{
  const g = parseGates(loopBaseline.stdout);
  const allPass = loopBaseline.status === 0 &&
    ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'].every((k) => g[k] === true);
  check('loop package passes verify.mjs ALL gates G1–G9 (exit 0)', allPass,
    `exit=${loopBaseline.status}\n${(loopBaseline.stdout || '').slice(-900)}`);
}

// --- LOOP POSITIVE REGRESSION (the defects this corrective pass fixes) -----

// (P1) fps=16 PARITY (cross-language rounding defect). loop_export bakes
//      floor(1000/16+0.5)=63 ms/frame on the 30 DISTINCT sample frames; G8's
//      expected sum is 30*63=1890. The OLD code diverged: Python round(1000/16)
//      = 62 (banker's) baked 1860, JS Math.round = 63 expected 1890 → G8
//      false-failed. With the FROZEN floor-half-up formula both sides agree on
//      63 and G8 PASSES. The fixture loop-fps16.webp is baked from the fixed
//      loop_export at fps 16.
{
  const dir = buildLoopPackage(path.join(work, 'loop-fps16'), {
    frames: SAMPLE_FRAMES, fps: 16, fixture: LOOP_FIXTURE_FPS16, id: 'loop-fps16',
  });
  const res = verify(dir);
  const g = parseGates(res.stdout);
  check('loop fps=16 PARITY: bytes baked at 63 ms, G8 PASSES (sum 30*63=1890) [regression: Python round gave 62]',
    res.status === 0 && g.G8 === true && g.G9 === true,
    `exit=${res.status} G8=${g.G8} G9=${g.G9}\n${(res.stdout || '').slice(-900)}`);
}

// (P2) HELD-FRAME COALESCING (the whole point of the sum-based G8). The
//      held-frames dir has 3 byte-identical consecutive frames; libwebp
//      coalesces them into ONE ANMF (duration 3*83=249), so ANMF count (3) <
//      frame count (5) while the duration SUM (415) == 5*83. Strict per-frame
//      G8 (count==frames.count AND every duration==perFrameMs) would FALSE-FAIL
//      this legitimate held loop; the coalescing-robust sum-based G8 PASSES.
{
  const dir = buildLoopPackage(path.join(work, 'loop-held'), {
    frames: HELD_FRAMES, fps: 12, fixture: HELD_FIXTURE, id: 'loop-held',
  });
  // Independently confirm coalescing actually happened (ANMF < frame count).
  const buf = fs.readFileSync(path.join(dir, 'loop.webp'));
  let anmf = 0;
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    let off = 12;
    while (off + 8 <= buf.length) {
      const fourcc = buf.toString('ascii', off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (off + 8 + size > buf.length) break;
      if (fourcc === 'ANMF') anmf++;
      off = off + 8 + size + (size & 1);
    }
  }
  const frameCount = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).frames.count;
  check(`loop HELD-FRAME: encoder coalesced byte-identical frames (ANMF ${anmf} < frames ${frameCount})`,
    anmf > 0 && anmf < frameCount, `ANMF=${anmf} frames=${frameCount}`);
  const res = verify(dir);
  const g = parseGates(res.stdout);
  check('loop HELD-FRAME: coalesced loop (ANMF<frames) PASSES sum-based G8 [strict G8 would FALSE-FAIL]',
    res.status === 0 && g.G8 === true && g.G9 === true,
    `exit=${res.status} G8=${g.G8} G9=${g.G9}\n${(res.stdout || '').slice(-900)}`);
}

// --- LOOP NEGATIVE-CORRUPTION ---------------------------------------------

// (1) delete a frame -> G1 (asset closure) + G2 (contiguity/count) fail.
{
  const dir = path.join(work, 'loop-del-frame');
  copyDir(loopPristine, dir);
  const victim = path.join(dir, 'frames', 'frame_010.webp');
  if (!fs.existsSync(victim)) die('expected frame_010.webp in loop package');
  fs.rmSync(victim);
  checkGate('loop: deleting a frame FAILs G2 (contiguity/count)', verify(dir), 'G2');
  const g = parseGates(verify(dir).stdout);
  check('loop: deleted frame also FAILs G1 (referenced frame missing)', g.G1 === false,
    `G1=${g.G1}`);
}

// (2) flip ONE byte deep in loop.webp image data, leave manifest.loop.webp_sha256.
//     -> G9 (content integrity) FAILs; G8 (structure/duration) stays PASS.
//     The last byte is image payload — never a FourCC, size, VP8X flag, or an
//     ANMF duration field — so the RIFF walk and durations are untouched.
{
  const dir = path.join(work, 'loop-flip-byte');
  copyDir(loopPristine, dir);
  const wp = path.join(dir, 'loop.webp');
  const buf = fs.readFileSync(wp);
  buf[buf.length - 1] ^= 0xff; // flip the final byte (deep image data)
  fs.writeFileSync(wp, buf);
  checkGate('loop: flipping a loop.webp byte FAILs G9, G8 stays PASS',
    verify(dir), 'G9', ['G8']);
}

// (3) edit manifest.loop.fps 12 -> 24, leave loop.webp bytes + webp_sha256.
//     -> G8 sum-binding FAILs: bytes sum to 30*83=2490 ms, but fps=24 makes the
//     expected sum 30*floor(1000/24+0.5)=30*42=1260 ms. G9 (bytes unchanged)
//     and G5 (fingerprint is fps-independent) stay PASS.
{
  const dir = path.join(work, 'loop-fps-lie');
  copyDir(loopPristine, dir);
  const mp = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.loop.fps = 24; // bytes are baked at 12 fps (83 ms); manifest now lies.
  fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
  checkGate('loop: editing manifest.loop.fps FAILs G8 (G9 + G5 stay PASS)',
    verify(dir), 'G8', ['G9', 'G5']);
}

// (4) break the baked ANMF DURATION SUM -> G8 sum-binding FAILs while G9 + G2
//     stay PASS. (The old "rename ANMF -> ANMX to reduce the count" corruption
//     is no longer a failure under the coalescing-robust rule: 1 <= count <=
//     frames.count makes a reduced count VALID. So we tamper the SUM instead —
//     the binding the new G8 actually enforces.) Walk to the FIRST ANMF, write
//     a different 24-bit-LE Frame Duration at payload offset 12 (payloadStart =
//     anmfOff+8, so the duration field is at anmfOff+8+12 = anmfOff+20). That
//     shifts the total off frames.count*perFrameMs. Then RECOMPUTE + rewrite
//     manifest.loop.webp_sha256 so G9 stays green — isolating G8's sum check.
{
  const dir = path.join(work, 'loop-anmf-sum');
  copyDir(loopPristine, dir);
  const wp = path.join(dir, 'loop.webp');
  const buf = fs.readFileSync(wp);

  // Walk top-level RIFF chunks to locate the FIRST ANMF FourCC offset (don't
  // hardcode — survives a fixture change). [FourCC:4][size:LE32][payload][pad].
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    die('loop fixture is not a RIFF/WEBP container');
  }
  let anmfOff = -1;
  let off = 12;
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (off + 8 + size > buf.length) break;
    if (fourcc === 'ANMF') { anmfOff = off; break; }
    off = off + 8 + size + (size & 1);
  }
  if (anmfOff < 0) die('no ANMF chunk found in loop fixture (cannot stage G8-sum corruption)');

  // Frame Duration is the 24-bit LE at ANMF payload offset 12. payloadStart =
  // anmfOff + 8 (FourCC[4] + size[4]); the duration field is at +12 within the
  // payload. Read the current value and add 1 ms so the SUM no longer equals
  // frames.count * perFrameMs. Header/size bytes untouched, so the walk stays
  // intact and the count is unchanged (isolating the SUM check, not the count).
  const dpo = anmfOff + 8 + 12;
  const cur = buf[dpo] | (buf[dpo + 1] << 8) | (buf[dpo + 2] << 16);
  const tampered = cur + 1;
  buf[dpo] = tampered & 0xff;
  buf[dpo + 1] = (tampered >> 8) & 0xff;
  buf[dpo + 2] = (tampered >> 16) & 0xff;

  // Recompute the sha so G9 passes — this proves the FAIL is G8's sum check.
  const newSha = crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(wp, buf);
  const mp = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.loop.webp_sha256 = newSha;
  fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');

  checkGate('loop: breaking one ANMF duration (sum) FAILs G8 (G9 + G2 stay PASS)',
    verify(dir), 'G8', ['G9', 'G2']);
}

// --- LOOP MANIFEST-BLOCK FALSIFICATION (Finding 2) -------------------------
// G8 now validates the WHOLE manifest.loop block (it already consumed loop.fps),
// so a manifest that LIES about a loop field G1–G9 never otherwise reads FAILs
// G8. Each case edits ONLY one loop field on an otherwise-pristine package and
// leaves loop.webp bytes untouched — so G9 (byte lock) stays PASS for the three
// field lies, isolating G8 as the gate that catches the manifest lie.

// (5) loop.duration_s = 999 (truth = frames.count/fps = 30/12 = 2.5).
//     -> G8 FAILs the duration recompute; G9 + G5 (fingerprint is loop-block-
//     independent) stay PASS.
{
  const dir = path.join(work, 'loop-duration-lie');
  copyDir(loopPristine, dir);
  const mp = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.loop.duration_s = 999;
  fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
  checkGate('loop: falsifying manifest.loop.duration_s FAILs G8 (G9 + G5 stay PASS)',
    verify(dir), 'G8', ['G9', 'G5']);
}

// (6) loop.webp = "missing.webp" (frozen filename is "loop.webp").
//     -> G8 FAILs the frozen-filename assert; G9 (reads the real loop.webp bytes
//     on disk, sha unchanged) + G5 stay PASS.
{
  const dir = path.join(work, 'loop-webp-lie');
  copyDir(loopPristine, dir);
  const mp = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.loop.webp = 'missing.webp';
  fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
  checkGate('loop: falsifying manifest.loop.webp FAILs G8 (G9 + G5 stay PASS)',
    verify(dir), 'G8', ['G9', 'G5']);
}

// (7) loop.loop_count = 7 (frozen value is 0 = infinite).
//     -> G8 FAILs the loop_count assert; G9 + G5 stay PASS.
{
  const dir = path.join(work, 'loop-count-lie');
  copyDir(loopPristine, dir);
  const mp = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.loop.loop_count = 7;
  fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
  checkGate('loop: falsifying manifest.loop.loop_count FAILs G8 (G9 + G5 stay PASS)',
    verify(dir), 'G8', ['G9', 'G5']);
}

// (8) loop.webp_sha256 FORMAT lie — uppercase the real (correct) hex.
//     G8 requires a LOWERCASE 64-hex string (format check); G9 compares the
//     VALUE. An uppercase sha is the same value with wrong format, so it FAILs
//     BOTH G8 (format) and G9 (G9's exact lowercase-hex compare). It therefore
//     CANNOT isolate against G9 (a format-bad sha that G9 accepts is impossible);
//     isolate against G5 (fingerprint) + G2 (contiguity) instead — both untouched.
{
  const dir = path.join(work, 'loop-sha-format-lie');
  copyDir(loopPristine, dir);
  const mp = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.loop.webp_sha256 = String(m.loop.webp_sha256).toUpperCase();
  fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
  checkGate('loop: bad-format manifest.loop.webp_sha256 (uppercase) FAILs G8 (G5 + G2 stay PASS)',
    verify(dir), 'G8', ['G5', 'G2']);
}

// --- summary ----------------------------------------------------------------
process.stdout.write(
  failures === 0
    ? '\ntest-kernel: PASS (scroll build + golden byte-diff + loop build; all corruptions fail their matching gate)\n'
    : `\ntest-kernel: FAIL (${failures} expectation(s) not met)\n`
);
process.exit(failures === 0 ? 0 : 1);
