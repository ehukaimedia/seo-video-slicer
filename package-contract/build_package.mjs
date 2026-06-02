#!/usr/bin/env node
// build_package.mjs — seo-video-slicer Packager KERNEL (zero external deps).
//
// Assembles a complete, contract-valid WebP-animation PACKAGE from a directory
// of source WebP frames. This is the reference kernel the real backend packager
// reuses. It obeys package-contract/CONTRACT.md verbatim where the contract says
// "byte-for-byte" or "verbatim":
//   - FINGERPRINT_RECIPE (§2) is copied character-for-character below.
//   - PLAYER_INJECTION_CONTRACT (§5) marker substitution is an exact string replace.
//   - PACKAGE_SCHEMA (§1) field shapes + frozen strings are emitted exactly.
//
// Usage:
//   node build_package.mjs --frames <dir> --out <pkgdir> \
//        [--id <slug>] [--duration <s>] [--fps <n>] [--resolution WxH] \
//        [--quality <82-90>] [--origin <text>]
//
// Output package layout:
//   <pkgdir>/frames/frame_000.webp ... frame_NNN.webp   (contiguous, 3-digit pad)
//   <pkgdir>/index.html      (rendered from index.template.html, marker injected)
//   <pkgdir>/manifest.json   (schema seo-video-slicer.package.v1 + fingerprint)
//   <pkgdir>/README.md       (<=200 lines; Iframe / React / Vanilla headings)
//   <pkgdir>/PROMPT.md       (optional drop-in prompt)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// FINGERPRINT_RECIPE — copied VERBATIM, character-for-character, from
// CONTRACT.md §2. Do NOT edit. verify.mjs uses the identical function; any
// drift here silently breaks G5 fingerprint parity.
//   import crypto from 'node:crypto';   // <-- part of the recipe (see §2)
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';

function fingerprint(frameBasenames, gsapUrlOrEmpty, templateId) {
  const payload = JSON.stringify({ frames: frameBasenames, gsap: gsapUrlOrEmpty, templateId });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Frozen contract constants shared by ALL modes (CONTRACT.md §1.1, §3, §5).
const FRAMES_PATTERN = 'frames/frame_NNN.webp';
const FRAMES_FORMAT = 'webp';
const PLAYER_CANONICAL = 'index.html';
const GSAP_DEP_STRING = '3.12.2 (optional)';
const INJECTION_MARKER = '/*__SLICER_FRAMES__*/';
const FPS_INJECTION_MARKER = '/*__SLICER_FPS__*/'; // loop template only (§6.6); scroll has no such token.
const DEFAULT_QUALITY = 82; // matches CONTRACT.md §1.2 canonical example; valid range 82–90.

// CONTRACT.md §1.3 — frozen string arrays, pasted exactly (the SCROLL v1 set).
const SCROLL_LOCKED_ZONES = [
  'frames/*.webp bytes',
  'frame_NNN zero-pad ordering',
  'cover-fit single-canvas render',
  'reduced-motion fallback',
  'player data-template-id',
];
const SCROLL_SAFE_ZONES = [
  'accent color',
  'headline/overlay copy',
  'scroll distance',
  'easing',
  'container height',
  'framework wrapper',
];

// CONTRACT-loop.md §10.3 — loop zone arrays = v1 set transformed:
//   locked = v1 + ["loop.webp bytes", "loop fps"]   (both gated by G8/G9)
//   safe   = v1 minus ["scroll distance"] + ["loop container size"]
const LOOP_LOCKED_ZONES = [
  ...SCROLL_LOCKED_ZONES,
  'loop.webp bytes',
  'loop fps',
];
const LOOP_SAFE_ZONES = [
  'accent color',
  'headline/overlay copy',
  'easing',
  'container height',
  'framework wrapper',
  'loop container size',
];

// ---------------------------------------------------------------------------
// MODE_CONFIG (spec §6.4b) — the builder EMITS schema, so it keys on --mode.
// The SCROLL entry is the EXISTING frozen constants VERBATIM so scroll output
// stays byte-identical. The LOOP entry adds the loop.v1 identifiers.
// ---------------------------------------------------------------------------
const MODE_CONFIG = {
  scroll: {
    templateFilename: 'index.template.html',
    schema: 'seo-video-slicer.package.v1',
    playerInteraction: 'scroll',
    dependencies: { gsap: GSAP_DEP_STRING },
    lockedZones: SCROLL_LOCKED_ZONES,
    safeZones: SCROLL_SAFE_ZONES,
  },
  loop: {
    templateFilename: 'index.template.loop.html',
    schema: 'seo-video-slicer.loop-package.v1',
    playerInteraction: 'loop',
    dependencies: {}, // loop never loads GSAP; field kept for v1 shape-parity.
    lockedZones: LOOP_LOCKED_ZONES,
    safeZones: LOOP_SAFE_ZONES,
  },
};

// ---------------------------------------------------------------------------
// CLI parsing (minimal; zero deps).
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function die(msg) {
  process.stderr.write(`build_package: ${msg}\n`);
  process.exit(1);
}

function usage() {
  return [
    'Usage:',
    '  node build_package.mjs --frames <dir> --out <pkgdir> \\',
    '       [--mode scroll|loop] \\',
    '       [--id <slug>] [--duration <s>] [--fps <n>] [--resolution WxH] \\',
    '       [--quality <82-90>] [--origin <text>] \\',
    '       [--loop-webp <path>]   # loop mode only',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Step 1 — read & order source frames.
// Accept any *.webp in the source dir, sort with default lexicographic order
// (no comparator), then renumber to contiguous zero-padded frame_NNN.webp.
// ---------------------------------------------------------------------------
function readSourceFrames(framesDir) {
  let entries;
  try {
    entries = fs.readdirSync(framesDir);
  } catch (e) {
    die(`cannot read --frames dir "${framesDir}": ${e.message}`);
  }
  const webps = entries
    .filter((n) => n.toLowerCase().endsWith('.webp'))
    .sort(); // default lexicographic sort — same ordering verify.mjs uses.
  if (webps.length === 0) {
    die(`no *.webp frames found in "${framesDir}" (a package needs >=1 frame).`);
  }
  return webps;
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

// ---------------------------------------------------------------------------
// Step 2 — render index.html from the template.
// PLAYER_INJECTION_CONTRACT (§5): a single plain string-replace of the exact
// substring INJECTION_MARKER with the JSON array BODY (no surrounding brackets,
// no trailing comma, no whitespace around commas). templateId is READ from the
// template's data-template-id attribute, not hardcoded (§2.1 / §5.3).
// ---------------------------------------------------------------------------
function loadTemplate(templateFilename) {
  const templatePath = path.join(__dirname, templateFilename);
  let html;
  try {
    html = fs.readFileSync(templatePath, 'utf8');
  } catch (e) {
    die(
      `template "${templatePath}" not found (${e.message}). The packager renders ` +
        `index.html FROM this template; it is a required sibling artifact.`
    );
  }
  if (!html.includes(INJECTION_MARKER)) {
    die(
      `template "${templatePath}" is missing the injection marker ` +
        `"${INJECTION_MARKER}" — cannot render the FRAMES array (see CONTRACT.md §5.1).`
    );
  }
  const m = html.match(/data-template-id="([^"]+)"/);
  if (!m) {
    die(
      `template "${templatePath}" has no data-template-id="..." attribute on the ` +
        `player root (required by CONTRACT.md §5.3; anchors the fingerprint).`
    );
  }
  return { html, templateId: m[1] };
}

// §5.2 — array BODY: each element is "./frames/<basename>", double-quoted,
// single-comma separated, NO whitespace, NO trailing comma, NO brackets
// (brackets already exist in the template line `const FRAMES = [...]`).
function buildFramesArrayBody(framePaths) {
  return framePaths.map((p) => JSON.stringify(p)).join(',');
}

function renderHtml(templateHtml, framesArrayBody) {
  // Plain string replace of the exact marker substring; nothing else rewritten.
  return templateHtml.replace(INJECTION_MARKER, framesArrayBody);
}

// ---------------------------------------------------------------------------
// gsap URL detection — §2.3: scan the RENDERED index.html for a GSAP cdnjs
// <script src>; use that URL if present, else "". Mirrors verify.mjs exactly so
// fingerprint parity holds even if a future template opts into GSAP.
// ---------------------------------------------------------------------------
function detectGsapUrl(html) {
  const re = /<script[^>]*\bsrc\s*=\s*(["'])([^"']*?gsap[^"']*?)\1/i;
  const m = html.match(re);
  return m ? m[2] : '';
}

// ---------------------------------------------------------------------------
// Step 4 — manifest.json (PACKAGE_SCHEMA §1).
// ---------------------------------------------------------------------------
function buildManifest({
  cfg,
  id,
  createdAt,
  durationS,
  fpsEffective,
  resolution,
  origin,
  frameCount,
  quality,
  totalBytes,
  fpValue,
  templateId,
  loopBlock, // null for scroll; the §6.3 loop block object for loop mode
}) {
  const manifest = {
    schema: cfg.schema,
    id,
    created_at: createdAt,
    source: {
      duration_s: durationS,
      fps_effective: fpsEffective,
      resolution,
      origin,
    },
    frames: {
      count: frameCount,
      pattern: FRAMES_PATTERN,
      format: FRAMES_FORMAT,
      quality,
    },
    player: {
      canonical: PLAYER_CANONICAL,
      interaction: cfg.playerInteraction,
      dependencies: cfg.dependencies,
      reduced_motion: true,
      // §1.1 / §2.4: player.template_id MIRRORS the HTML attribute but is NOT
      // the fingerprint source. The fingerprint reads the attribute from HTML.
      template_id: templateId,
    },
    customization: {
      locked_zones: cfg.lockedZones,
      safe_zones: cfg.safeZones,
    },
    seo: {
      lcp_safe: true,
      // Task step 4: sum of FRAME bytes (scroll) or FRAME bytes + loop.webp
      // (loop, §6.8). (CONTRACT.md §1.1 phrases this as "all files"; the value
      // is informational and ungated — G7 re-measures bytes independently.)
      total_bytes: totalBytes,
      lazy_loadable: true,
    },
    fingerprint: {
      algorithm: 'sha256',
      value: fpValue,
    },
  };
  // §10.3: the loop block sits after `player` (cosmetic placement — it is not
  // part of the fingerprint; its integrity is gated by G8/G9). Scroll never
  // emits it, preserving byte-identical scroll output.
  if (loopBlock) {
    const ordered = {};
    for (const k of Object.keys(manifest)) {
      ordered[k] = manifest[k];
      if (k === 'player') ordered.loop = loopBlock;
    }
    return ordered;
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Step 5 — README.md (<=200 lines; Iframe / React / Vanilla headings) + PROMPT.md.
// ---------------------------------------------------------------------------
function buildScrollReadme(id) {
  return `# ${id} — WebP scroll-animation package

A drop-in, self-contained WebP animation. Open \`index.html\` in any browser with
**no server** — it animates on scroll. Zero external requests by default
(no network, no build step, no framework required).

This folder IS the product. The frames are pre-optimized; \`index.html\` already
plays them. Customize only the **safe_zones** in \`manifest.json\` (accent color,
headline/overlay copy, scroll distance, easing, container height, framework
wrapper). Do **not** touch the **locked_zones** or regenerate the images.

## Copy to public

Copy this whole folder into your site's static assets and reference it by path:

\`\`\`
cp -R ./${id} ./public/${id}
# served at: /${id}/index.html
\`\`\`

All asset paths inside are relative (\`./frames/frame_NNN.webp\`), so the package
works from any sub-path with no rewrites.

## Iframe (Default)

The simplest, fully-isolated integration — drop the folder in \`public/\` and embed:

\`\`\`html
<iframe
  src="/${id}/index.html"
  title="${id} animation"
  loading="lazy"
  style="width:100%;height:100vh;border:0"
></iframe>
\`\`\`

The iframe sandboxes the player's scroll binding and styles from the host page.
Adjust \`height\` (a safe_zone: container height) to set the scroll distance.

## React / Next

Place the folder under \`public/${id}/\` and render the iframe from a component:

\`\`\`jsx
export default function HeroAnimation() {
  return (
    <iframe
      src="/${id}/index.html"
      title="${id} animation"
      loading="lazy"
      style={{ width: '100%', height: '100vh', border: 0 }}
    />
  );
}
\`\`\`

In Next.js the \`public/\` folder is served at the site root, so \`/${id}/index.html\`
resolves with no extra config. For a native component, adapt the player JS from
\`index.html\` but preserve the locked_zones (cover-fit single-canvas render,
frame_NNN ordering, reduced-motion fallback, the \`data-template-id\`).

## Inline Vanilla

Serve the folder and link to it, or lift the inline \`<canvas>\` player out of
\`index.html\` into your own page. Keep the relative \`./frames/\` paths and the
\`data-template-id="seo-video-slicer.scroll.v1"\` attribute on the player root:

\`\`\`html
<a href="./${id}/index.html">Open the animation</a>
\`\`\`

\`\`\`html
<!-- or embed the player root directly, keeping its inline CSS/JS intact -->
<div data-template-id="seo-video-slicer.scroll.v1">
  <!-- canvas + frame loader copied from index.html -->
</div>
\`\`\`

## Accessibility

The player honors \`prefers-reduced-motion: reduce\`: when set, animation is
suppressed and a single static hero frame renders so the content still reads.

## Verify

This package validates against the contract with a zero-dependency gate:

\`\`\`
node verify.mjs
\`\`\`

It exits non-zero on any failed gate (asset closure, frame naming, self-contained
HTML, player techniques, manifest + fingerprint, this README, weight budget).
`;
}

// ---------------------------------------------------------------------------
// Loop README (CONTRACT-loop.md §G6) — ≤200 lines, MUST contain the Iframe /
// React / Vanilla headings (so the frozen G6 heading regex passes) PLUS a
// two-tier <img src="loop.webp" loading="lazy"> embed section (§6.8). A sample
// carries data-template-id="seo-video-slicer.loop.v1". The scroll README
// generator above is untouched.
// ---------------------------------------------------------------------------
function buildLoopReadme(id) {
  return `# ${id} — WebP loop-animation package (loop.v1)

A drop-in, self-contained WebP **loop**. Open \`index.html\` in any browser with
**no server** — it auto-advances the frame sequence on a time-based
\`requestAnimationFrame\` loop. Zero external requests (no GSAP, no network, no
build step, no framework required). \`data-template-id\` is \`seo-video-slicer.loop.v1\`.

This folder IS the product. The frames are pre-optimized; \`index.html\` already
loops them. Customize only the **safe_zones** in \`manifest.json\` (accent color,
headline/overlay copy, easing, container height, framework wrapper, loop
container size). Do **not** touch the **locked_zones**, the \`loop.webp\` bytes,
the loop \`fps\`, or regenerate the images.

## Two-tier embed — loop.webp vs index.html

A loop package ships **both** the frame sequence (+ canvas \`index.html\`) **and**
\`loop.webp\` (a baked animated WebP). Pick the tier per your needs:

- **\`loop.webp\`** — a zero-JS drop-in. Simplest embed; **ignores**
  \`prefers-reduced-motion\` (it is an \`<img>\`):

  \`\`\`html
  <img src="loop.webp" loading="lazy" alt="${id} loop">
  \`\`\`

- **\`index.html\` (canvas + frames)** — DPR-crisp, controllable, and **honors
  reduced-motion** (renders a single static hero frame). This is the tier that
  satisfies the accessibility rule.

## Copy to public

Copy this whole folder into your site's static assets and reference it by path:

\`\`\`
cp -R ./${id} ./public/${id}
# served at: /${id}/index.html  (canvas tier)
# or embed:  /${id}/loop.webp   (img tier)
\`\`\`

All asset paths inside are relative (\`./frames/frame_NNN.webp\`, \`loop.webp\`), so
the package works from any sub-path with no rewrites.

## Iframe (Default)

The simplest, fully-isolated canvas integration — drop the folder in \`public/\`:

\`\`\`html
<iframe
  src="/${id}/index.html"
  title="${id} loop"
  loading="lazy"
  style="width:100%;height:100vh;border:0"
></iframe>
\`\`\`

The iframe sandboxes the player's loop binding and styles from the host page.
Adjust \`height\` / \`width\` (a safe_zone: loop container size) to fit your layout.

## React / Next

Place the folder under \`public/${id}/\`. For the zero-JS tier, use an \`<img>\`;
for the reduced-motion-aware tier, render the canvas player via an iframe:

\`\`\`jsx
export default function HeroLoop() {
  return (
    <iframe
      src="/${id}/index.html"
      title="${id} loop"
      loading="lazy"
      style={{ width: '100%', height: '100vh', border: 0 }}
    />
  );
}
\`\`\`

In Next.js the \`public/\` folder is served at the site root, so \`/${id}/index.html\`
and \`/${id}/loop.webp\` resolve with no extra config. For a native component, adapt
the player JS from \`index.html\` but preserve the locked_zones (cover-fit
single-canvas render, frame_NNN ordering, reduced-motion fallback, the time-based
loop, the loop.webp bytes/fps, and the \`data-template-id\`).

## Inline Vanilla

Serve the folder and embed the \`<img>\`, or lift the inline \`<canvas>\` loop player
out of \`index.html\`. Keep the relative \`./frames/\` paths and the
\`data-template-id="seo-video-slicer.loop.v1"\` attribute on the player root:

\`\`\`html
<a href="./${id}/index.html">Open the loop</a>
\`\`\`

\`\`\`html
<!-- or embed the player root directly, keeping its inline CSS/JS intact -->
<div data-template-id="seo-video-slicer.loop.v1">
  <!-- canvas + time-based rAF loop copied from index.html -->
</div>
\`\`\`

## Accessibility

The canvas player honors \`prefers-reduced-motion: reduce\`: when set, the loop is
suppressed and a single static hero frame renders so the content still reads. The
\`loop.webp\` \`<img>\` tier cannot honor that preference — prefer the canvas tier
where accessibility matters.

## Verify

This package validates against the loop contract with a zero-dependency gate:

\`\`\`
node verify.mjs
\`\`\`

It exits non-zero on any failed gate (asset closure, frame naming, self-contained
HTML, loop player techniques, manifest + fingerprint, this README, weight budget,
animated-WebP structure + fps binding, and loop.webp content integrity).
`;
}

function buildPrompt() {
  return `# PROMPT.md (optional)

These are ready-made, performance-optimized WebP animation frames, and
\`index.html\` already plays them as a scroll animation. To integrate, copy this
folder to \`public/\` and embed it via the iframe recipe in \`README.md\`, or adapt
the inline player into a native component — but preserve the \`locked_zones\` in
\`manifest.json\` and customize only the \`safe_zones\`. Do not regenerate the images.
`;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));

  const framesDir = typeof args.frames === 'string' ? args.frames : null;
  const outDir = typeof args.out === 'string' ? args.out : null;
  if (!framesDir || !outDir) {
    process.stderr.write(`${usage()}\n`);
    die('both --frames <dir> and --out <pkgdir> are required.');
  }

  // --- Mode selection (spec §6.4b). Default scroll ⇒ byte-identical output. ---
  const mode = typeof args.mode === 'string' && args.mode.trim() ? args.mode.trim() : 'scroll';
  const cfg = MODE_CONFIG[mode];
  if (!cfg) {
    process.stderr.write(`${usage()}\n`);
    die(`unknown --mode "${mode}" (expected "scroll" or "loop").`);
  }
  const loopWebpPath = typeof args['loop-webp'] === 'string' ? args['loop-webp'] : null;
  if (mode === 'loop' && !loopWebpPath) {
    die('loop mode requires --loop-webp <path> (the baked animated WebP).');
  }
  if (mode === 'scroll' && loopWebpPath) {
    die('--loop-webp is only valid with --mode loop.');
  }

  const id =
    typeof args.id === 'string' && args.id.trim()
      ? args.id.trim()
      : path.basename(path.resolve(outDir));

  const durationS = args.duration !== undefined ? Number(args.duration) : 0;
  const fpsEffective = args.fps !== undefined ? Number(args.fps) : 0;
  const resolution =
    typeof args.resolution === 'string' ? args.resolution : '0x0';
  const origin =
    typeof args.origin === 'string' ? args.origin : 'user-supplied video';

  let quality = args.quality !== undefined ? Number(args.quality) : DEFAULT_QUALITY;
  if (!Number.isFinite(quality)) quality = DEFAULT_QUALITY;
  quality = Math.max(82, Math.min(90, Math.round(quality))); // clamp to 82–90.

  // --- Step 1: read & order source frames ---
  const sourceFrames = readSourceFrames(framesDir);
  const frameCount = sourceFrames.length;

  // Renamed OUTPUT basenames: contiguous frame_000.webp .. frame_(N-1).webp.
  const outBasenames = sourceFrames.map((_, i) => `frame_${pad3(i)}.webp`);

  // --- Step 2 (template) loaded early so we can fail loud before writing ---
  const { html: templateHtml, templateId } = loadTemplate(cfg.templateFilename);

  // Validate --loop-webp source exists before writing anything (fail loud).
  if (mode === 'loop' && !fs.existsSync(loopWebpPath)) {
    die(`--loop-webp source "${loopWebpPath}" does not exist.`);
  }

  // Prepare output package dir + frames/.
  const pkgDir = path.resolve(outDir);
  const outFramesDir = path.join(pkgDir, 'frames');
  fs.mkdirSync(outFramesDir, { recursive: true });

  // Copy + rename frames; measure byte sizes.
  let frameBytes = 0;
  for (let i = 0; i < frameCount; i++) {
    const src = path.join(framesDir, sourceFrames[i]);
    const dst = path.join(outFramesDir, outBasenames[i]);
    fs.copyFileSync(src, dst);
    frameBytes += fs.statSync(dst).size;
  }

  // --- Loop-only: copy loop.webp in, hash it, measure it (§6.3/§6.4a). The
  // Node loop-builder OWNS copying the bytes, computing webp_sha256, and writing
  // the loop block — one owner avoids double-compute/drift. ---
  let totalBytes = frameBytes; // scroll: frame bytes only (byte-identical golden).
  let loopBlock = null;
  let loopFps = null; // hoisted so the loop fps injection (below) can read it.
  if (mode === 'loop') {
    loopFps = fpsEffective; // --fps drives the baked cadence (bound by G8) AND the canvas player.
    if (!Number.isFinite(loopFps) || loopFps <= 0) {
      die('loop mode requires a positive --fps (it drives the baked frame duration).');
    }
    const loopDst = path.join(pkgDir, 'loop.webp');
    fs.copyFileSync(loopWebpPath, loopDst);
    const loopBytesBuf = fs.readFileSync(loopDst);
    const webpSha256 = crypto.createHash('sha256').update(loopBytesBuf).digest('hex');
    totalBytes += loopBytesBuf.length; // §6.8: seo.total_bytes includes loop.webp.
    loopBlock = {
      fps: loopFps,
      duration_s: frameCount / loopFps, // §6.3: loop length = frames.count / fps.
      webp: 'loop.webp',
      webp_sha256: webpSha256,
      loop_count: 0, // 0 = infinite.
    };
  }

  // Player FRAMES array carries FULL relative paths (./frames/...). This is the
  // #1 divergence trap (§2.2): these are NOT the fingerprint inputs.
  const framePaths = outBasenames.map((b) => `./frames/${b}`);
  const framesArrayBody = buildFramesArrayBody(framePaths);
  let indexHtml = renderHtml(templateHtml, framesArrayBody);
  // Loop-only: inject the build --fps into the canvas player so the canvas tier
  // and loop.webp share ONE cadence (§6.6.4). Scroll has no FPS marker, so its
  // single-marker render path and byte-identity are untouched.
  if (mode === 'loop') {
    indexHtml = indexHtml.replace(FPS_INJECTION_MARKER, String(loopFps));
  }

  // --- Step 3: fingerprint, EXACT recipe ---
  // frameBasenames = BARE output basenames, default-sorted (§2.1). gsap from the
  // RENDERED HTML (§2.3); templateId from the template attribute (§2.1/§5.3).
  const frameBasenames = outBasenames.slice().sort(); // already sorted; explicit per §2.3.
  const gsapUrlOrEmpty = detectGsapUrl(indexHtml);
  const fpValue = fingerprint(frameBasenames, gsapUrlOrEmpty, templateId);

  // --- Step 4: manifest ---
  const manifest = buildManifest({
    cfg,
    id,
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    durationS,
    fpsEffective,
    resolution,
    origin,
    frameCount,
    quality,
    totalBytes,
    fpValue,
    templateId,
    loopBlock,
  });

  // --- Write all package files ---
  fs.writeFileSync(path.join(pkgDir, 'index.html'), indexHtml);
  fs.writeFileSync(
    path.join(pkgDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  const readme = mode === 'loop' ? buildLoopReadme(id) : buildScrollReadme(id);
  fs.writeFileSync(path.join(pkgDir, 'README.md'), readme);
  fs.writeFileSync(path.join(pkgDir, 'PROMPT.md'), buildPrompt());

  // --- Step 6: print package path + one-line summary ---
  process.stdout.write(`${pkgDir}\n`);
  process.stdout.write(
    `package "${id}": ${frameCount} frames, ${frameBytes} frame-bytes, ` +
      `templateId=${templateId}, gsap=${gsapUrlOrEmpty === '' ? 'none' : gsapUrlOrEmpty}, ` +
      `fingerprint=${fpValue}\n`
  );
}

main();
