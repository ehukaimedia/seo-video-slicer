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

// Frozen contract constants (CONTRACT.md §1.1, §1.3, §3, §5).
const PACKAGE_SCHEMA = 'seo-video-slicer.package.v1';
const FRAMES_PATTERN = 'frames/frame_NNN.webp';
const FRAMES_FORMAT = 'webp';
const PLAYER_CANONICAL = 'index.html';
const PLAYER_INTERACTION = 'scroll';
const GSAP_DEP_STRING = '3.12.2 (optional)';
const INJECTION_MARKER = '/*__SLICER_FRAMES__*/';
const TEMPLATE_FILENAME = 'index.template.html';
const DEFAULT_QUALITY = 82; // matches CONTRACT.md §1.2 canonical example; valid range 82–90.

// CONTRACT.md §1.3 — frozen string arrays, pasted exactly.
const LOCKED_ZONES = [
  'frames/*.webp bytes',
  'frame_NNN zero-pad ordering',
  'cover-fit single-canvas render',
  'reduced-motion fallback',
  'player data-template-id',
];
const SAFE_ZONES = [
  'accent color',
  'headline/overlay copy',
  'scroll distance',
  'easing',
  'container height',
  'framework wrapper',
];

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
    '       [--id <slug>] [--duration <s>] [--fps <n>] [--resolution WxH] \\',
    '       [--quality <82-90>] [--origin <text>]',
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
function loadTemplate() {
  const templatePath = path.join(__dirname, TEMPLATE_FILENAME);
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
}) {
  return {
    schema: PACKAGE_SCHEMA,
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
      interaction: PLAYER_INTERACTION,
      dependencies: { gsap: GSAP_DEP_STRING },
      reduced_motion: true,
      // §1.1 / §2.4: player.template_id MIRRORS the HTML attribute but is NOT
      // the fingerprint source. The fingerprint reads the attribute from HTML.
      template_id: templateId,
    },
    customization: {
      locked_zones: LOCKED_ZONES,
      safe_zones: SAFE_ZONES,
    },
    seo: {
      lcp_safe: true,
      // Task step 4: sum of FRAME bytes. (CONTRACT.md §1.1 phrases this as "all
      // files"; the value is informational and ungated — G7 re-measures bytes
      // independently — and "all files" is self-referential for manifest.json.)
      total_bytes: totalBytes,
      lazy_loadable: true,
    },
    fingerprint: {
      algorithm: 'sha256',
      value: fpValue,
    },
  };
}

// ---------------------------------------------------------------------------
// Step 5 — README.md (<=200 lines; Iframe / React / Vanilla headings) + PROMPT.md.
// ---------------------------------------------------------------------------
function buildReadme(id) {
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
  const { html: templateHtml, templateId } = loadTemplate();

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

  // Player FRAMES array carries FULL relative paths (./frames/...). This is the
  // #1 divergence trap (§2.2): these are NOT the fingerprint inputs.
  const framePaths = outBasenames.map((b) => `./frames/${b}`);
  const framesArrayBody = buildFramesArrayBody(framePaths);
  const indexHtml = renderHtml(templateHtml, framesArrayBody);

  // --- Step 3: fingerprint, EXACT recipe ---
  // frameBasenames = BARE output basenames, default-sorted (§2.1). gsap from the
  // RENDERED HTML (§2.3); templateId from the template attribute (§2.1/§5.3).
  const frameBasenames = outBasenames.slice().sort(); // already sorted; explicit per §2.3.
  const gsapUrlOrEmpty = detectGsapUrl(indexHtml);
  const fpValue = fingerprint(frameBasenames, gsapUrlOrEmpty, templateId);

  // --- Step 4: manifest ---
  const manifest = buildManifest({
    id,
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    durationS,
    fpsEffective,
    resolution,
    origin,
    frameCount,
    quality,
    totalBytes: frameBytes,
    fpValue,
    templateId,
  });

  // --- Write all package files ---
  fs.writeFileSync(path.join(pkgDir, 'index.html'), indexHtml);
  fs.writeFileSync(
    path.join(pkgDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  fs.writeFileSync(path.join(pkgDir, 'README.md'), buildReadme(id));
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
