#!/usr/bin/env node
// test-kernel.mjs — zero-dependency self-test for the frozen package kernel.
//
// Proves the two kernels agree: build_package.mjs assembles a contract-valid
// package and verify.mjs PASSES it (exit 0); then three independent corruptions
// each make verify.mjs FAIL (exit non-zero). This is the kernel's CI gate.
//
// Node builtins only (node:child_process, node:crypto, node:fs, node:os, node:path).
// Sample frames are produced with ffmpeg (a tiny solid-color WebP each); if ffmpeg
// is unavailable the script exits non-zero with a clear message.
//
// Run:  node package-contract/test-kernel.mjs
// Exit: 0 if every expectation holds; non-zero (and a FAIL line) otherwise.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(__dirname, 'build_package.mjs');
const VERIFY = path.join(__dirname, 'verify.mjs');

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

// --- 2) build a pristine package & assert it PASSES -------------------------
const pristine = buildPackage(path.join(work, 'pkg-pristine'));
const baseline = verify(pristine);
check('pristine package passes verify.mjs (exit 0)', baseline.status === 0,
  `exit=${baseline.status}\n${(baseline.stdout || '').slice(-600)}`);

// --- 3) three independent corruptions, each must FAIL -----------------------

// (a) delete a frame -> G1 (asset closure) + G2 (contiguity) fail.
{
  const dir = path.join(work, 'pkg-del-frame');
  copyDir(pristine, dir);
  const victim = path.join(dir, 'frames', 'frame_002.webp');
  if (!fs.existsSync(victim)) die('expected frame_002.webp in pristine package');
  fs.rmSync(victim);
  const r = verify(dir);
  check('deleting a frame makes verify.mjs FAIL (exit != 0)', r.status !== 0,
    `exit=${r.status}\n${(r.stdout || '').slice(-600)}`);
}

// (b) tamper the manifest fingerprint -> G5 (fingerprint parity) fails.
{
  const dir = path.join(work, 'pkg-tamper-fp');
  copyDir(pristine, dir);
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // Flip the stored fingerprint to a value that cannot match the recompute.
  manifest.fingerprint.value = '0'.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const r = verify(dir);
  check('tampering manifest.fingerprint makes verify.mjs FAIL', r.status !== 0,
    `exit=${r.status}\n${(r.stdout || '').slice(-600)}`);
}

// (c) inject an external http:// asset into index.html -> G3 (self-contained) fails.
//     A plain external (NOT gsap-cdnjs, NOT w3.org) — both of those are permitted.
{
  const dir = path.join(work, 'pkg-http-leak');
  copyDir(pristine, dir);
  const indexPath = path.join(dir, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const inject = '<img src="http://evil.example/tracker.png" alt="">';
  // Insert before </body> if present, else append — either way it lands in the HTML.
  html = html.includes('</body>')
    ? html.replace('</body>', `${inject}\n</body>`)
    : html + `\n${inject}\n`;
  fs.writeFileSync(indexPath, html);
  const r = verify(dir);
  check('injecting an http:// asset makes verify.mjs FAIL', r.status !== 0,
    `exit=${r.status}\n${(r.stdout || '').slice(-600)}`);
}

// --- summary ----------------------------------------------------------------
process.stdout.write(
  failures === 0
    ? '\ntest-kernel: PASS (build passes; all 3 corruptions fail the gate)\n'
    : `\ntest-kernel: FAIL (${failures} expectation(s) not met)\n`
);
process.exit(failures === 0 ? 0 : 1);
