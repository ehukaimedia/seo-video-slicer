---
name: SEO Video Slicer
description: A lean, single-purpose video slicer — a dark, technical instrument. Void-black canvas, solid panels seamed with hairlines, one Electric Blue accent. Frames grade true against neutral darkness; the chrome is the darkroom.

# Colors are declared in OKLCH (wide-gamut, one source of truth). The tokens
# below mirror the CSS custom properties in frontend/src/styles/theme.css 1:1,
# so the doc and the code agree by construction. theme.css is a verbatim port of
# the system of record: smart-image-animations/frontend/src/app/globals.css.
# This frontmatter supersedes the prior light-editorial port entirely.
colors:
  void-black: "oklch(8% 0 0)"
  panel-deep: "oklch(15% 0 0)"
  hairline: "oklch(22% 0 0)"
  ink-primary: "oklch(98% 0 0)"
  ink-secondary: "oklch(75% 0 0)"
  ink-muted: "oklch(55% 0 0)"
  accent: "oklch(65% 0.20 250)"
  success: "oklch(65% 0.15 150)"
  danger: "oklch(55% 0.20 25)"
  # Accent alpha variants — Electric Blue at low opacity for hover/focus/glow.
  accent-hover: "oklch(65% 0.20 250 / 0.3)"
  accent-focus: "oklch(65% 0.20 250 / 0.15)"
  accent-ring: "oklch(65% 0.20 250 / 0.4)"

typography:
  fontFamily:
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
    mono: "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace"
  display:
    fontFamily: "{typography.fontFamily.sans}"
    fontSize: "clamp(2.5rem, 7vw, 4.5rem)"
    fontWeight: 700
    letterSpacing: "-0.02em"
    lineHeight: 1
  headline:
    fontFamily: "{typography.fontFamily.sans}"
    fontSize: "clamp(1.5rem, 4vw, 2.25rem)"
    fontWeight: 700
    letterSpacing: "-0.02em"
    lineHeight: 1.15
  title:
    fontFamily: "{typography.fontFamily.sans}"
    fontSize: "clamp(1.05rem, 2.5vw, 1.4rem)"
    fontWeight: 600
    letterSpacing: "-0.01em"
    lineHeight: 1.3
  body:
    fontFamily: "{typography.fontFamily.sans}"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.6
  supporting:
    fontFamily: "{typography.fontFamily.sans}"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "{typography.fontFamily.sans}"
    fontSize: "0.9rem"
    fontWeight: 600
  mono-meta:
    fontFamily: "{typography.fontFamily.mono}"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.02em"
  mono-eyebrow:
    fontFamily: "{typography.fontFamily.mono}"
    fontSize: "0.65rem"
    fontWeight: 500
    letterSpacing: "0.1em"
    textTransform: "uppercase"

rounded:
  none: "0"
  sm: "4px"
  md: "8px"
  pill: "999px"
  card: "12px"

spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "32px"
  xl: "48px"

motion:
  ease: "cubic-bezier(0.16, 1, 0.3, 1)"   # --ease-out-expo
  fast: "0.15s"
  base: "0.2s"
  enter: "0.4s"

components:
  glass-card:
    backgroundColor: "{colors.panel-deep}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.card}"
    padding: "{spacing.lg}"
  button-primary:
    backgroundColor: "{colors.ink-primary}"
    textColor: "{colors.void-black}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "14px 28px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
  icon-btn:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.md}"
    padding: "8px"
  input-field:
    backgroundColor: "{colors.panel-deep}"
    textColor: "{colors.ink-primary}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    border: "1px solid {colors.hairline}"
    typography: "{typography.mono-eyebrow}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  check-badge:
    backgroundColor: "{colors.success}"
    textColor: "{colors.void-black}"
    rounded: "{rounded.pill}"
  export-panel:
    backgroundColor: "{colors.panel-deep}"
    textColor: "{colors.ink-primary}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.card}"
    padding: "{spacing.lg}"
---

# Design System: SEO Video Slicer — The Dark Instrument

> **Supersession note.** This document replaces the prior light-editorial port ("The Editorial Darkroom" — warm paper chrome, Editorial Magenta, Cormorant Garamond / Instrument Sans / Space Grotesk webfonts, a scoped dark Media Stage). That system is retired in full. The single source of truth is now `frontend/src/styles/theme.css`, a verbatim port of `smart-image-animations/frontend/src/app/globals.css`. Where the two ever disagree, **theme.css wins** and this doc is wrong. No warm surfaces, no magenta, no serif, and no webfonts survive into this system.

## 1. Overview: The Dark Instrument

**Creative North Star: "The Dark Instrument."**

The SEO Video Slicer is a lean, single-purpose tool, and it should read like a precision instrument the moment it opens — a video editor's scrub deck, a developer's terminal, a frame-grading bench. The whole interface lives on **Void Black** (`oklch(8% 0 0)` — not pure black). Panels are **solid Panel Deep** (`oklch(15% 0 0)`), separated from the canvas by **1px Hairline** seams, never by drop shadows. Type is **bold system-sans** for display and **monospace** for every technical readout — frame indices, timecodes, byte weights, format tags. A single accent — **Electric Blue** (`oklch(65% 0.20 250)`) — carries every interactive and active state. There is no second hue.

This is the correct surround for the work. Every professional frame tool — Premiere, DaVinci Resolve, Lightroom — grades images against neutral darkness so the eye reads true color, true exposure, and true edges without a bright or warm surround biasing the judgment. A watermark you are about to erase, a hallucinated frame you are about to exclude, an edge you are pixel-peeping in the lightbox — all of those calls are only trustworthy on a dark stage. So the entire app is the dark stage. There is no light chrome to leak warmth onto the frame; the canvas, the panels, and the preview are one continuous dark surface, and the extracted frame is the only thing in the room with color.

This system explicitly rejects the generic AI-tool visual vocabulary: purple gradients, neon rainbows, glassmorphism-as-decoration, glowing cyan-on-black, SaaS hero-metric layouts, and identical-card feature grids. Depth comes from **hairlines and tone**, not from blur or heavy shadow. Electric Blue is the one voice, used sparingly. A panel is a solid rectangle with a 1px border — nothing floats, nothing frosts.

**Product framing.** The tool does one job in two acts: **slice** (import → trim in/out → extract frames → review/exclude → crop → erase regions) and **package** (assemble the chosen frames + manifest into a downloadable export). The left/main area is the slicer; the right panel is the **Export / Package** panel. The ready state is neutral — a green `pulse-dot` plus `SLICER READY` in mono uppercase. There is no animation-generation, no model engine, no chat in this product.

**Key Characteristics:**
- Void-Black canvas (`oklch(8% 0 0)`), Panel-Deep solid panels (`oklch(15% 0 0)`), Hairline seams (`oklch(22% 0 0)`).
- Three inks: Ink Primary (`oklch(98% 0 0)`) for headings, Ink Secondary (`oklch(75% 0 0)`) for body, Ink Muted (`oklch(55% 0 0)`) for captions/mono labels.
- One accent: Electric Blue (`oklch(65% 0.20 250)`), used on no more than ~10% of any screen. Its rarity is the point.
- Bold system-sans display type (weight 700, `letter-spacing: -0.02em`) — no serif, no webfonts. Monospace for all technical meta.
- Flat by default. Depth via 1px hairline borders; the only sanctioned glow is `glow-glow` (an Electric Blue ambient shadow) on one rare accent moment.
- Motion is `--ease-out-expo` (`cubic-bezier(0.16, 1, 0.3, 1)`), ~200ms, no bounce, no overshoot.

## 2. Colors: The Dark Palette

A near-monochrome dark palette — black canvas, one panel tone, one hairline, three inks — plus exactly one accent and two status colors. No secondary or tertiary accent. The restraint is doctrinal.

### Surfaces

- **Void Black** (`--void-black: oklch(8% 0 0)`): The page background. Deliberately **not** pure black — 8% lightness reads as deep, calibrated darkness, not a dead `#000` void. Everything sits on this.
- **Panel Deep** (`--panel-deep: oklch(15% 0 0)`): Cards, panels, the export panel, input backgrounds. One step up from the canvas. Solid — never translucent, never frosted.
- **Hairline** (`--hairline: oklch(22% 0 0)`): 1px borders, dividers, input strokes, slider tracks. This is how structure is drawn. The dark system articulates with hairlines, not shadows.

### Inks

- **Ink Primary** (`--ink-primary: oklch(98% 0 0)`): Headings and primary text. Also the fill of the white-pill CTA and the dual-range thumb. Near-white, never pure `#fff`.
- **Ink Secondary** (`--ink-secondary: oklch(75% 0 0)`): Body copy, control labels, secondary-button text.
- **Ink Muted** (`--ink-muted: oklch(55% 0 0)`): Captions, helper text, mono labels, badges, the recessed metadata voice (frame counts, weights, "works with").

### Accent & Status

- **Electric Blue** (`--accent: oklch(65% 0.20 250)`): The one accent. Focus rings, active states, the live trim progress/handle border, icon-button hover, the rare `glow-glow`. Never a gradient, never a background wash, never the page color. Scarcity is the design choice.
- **Success** (`--success: oklch(65% 0.15 150)`): The green pulse-dot (ready/idle heartbeat) and the `check-badge` on selected filmstrip frames. A confirmation color, not a decoration.
- **Danger** (`--danger: oklch(55% 0.20 25)`): Destructive actions — delete, remove, the `menu-item-danger`. Used only on actions that remove work.

### Accent Alpha Variants

Electric Blue at reduced opacity carries hover, focus, and glow without introducing a new hue:
- `oklch(65% 0.20 250 / 0.3)` — glass-card hover border.
- `oklch(65% 0.20 250 / 0.15)` — input focus ring (2px), the `glow-glow` ambient shadow.
- `oklch(65% 0.20 250 / 0.4)` — icon-btn / preset-pill hover border, the global outline color.

### Named Rules

**The One Accent Rule.** Electric Blue is the only accent in the system. No supporting accent is ever added, no matter how much a layout "wants" a second color. Success-green and Danger-red are *status* colors — they signal state (ready, selected, destructive), they are not decorative accents. If you need a second emphasis point, reach for scale, weight, or a hairline — never a second hue.

**The Void-Black-Not-Pure-Black Rule.** The canvas is `oklch(8% 0 0)`, never `#000`. Pure black reads as a dead void and makes the hairlines and panels disappear into it. The 8% floor is what gives the dark surface depth and lets the `oklch(15%)` panels sit a readable tone above it. Likewise the brightest ink is `oklch(98% 0 0)`, never `#fff`.

**The Flat-By-Default Rule.** Surfaces are flat solid rectangles at rest, separated by 1px hairlines. If you find yourself adding a drop shadow to articulate a panel, stop — use a hairline border or a tone step instead. The only sanctioned shadow is the Electric Blue `glow-glow`, reserved for one rare accent moment (e.g. the export CTA at the "package ready" state).

**The No-Glassmorphism Rule.** Panels are **solid** Panel Deep with hairlines. No `backdrop-filter`, no translucency-as-decoration, no frosted glass. The legacy class name `glass-card` is a holdover from the source system of record — it describes a *solid panel*, not glass. Do not add blur to it.

**The OKLCH-Only Rule.** All colors are declared in OKLCH. The single exception is structural shadow alpha (`oklch(0% 0 0 / α)` on the dual-range thumb) — a shadow is darkness, not a brand color. Every actual color stays OKLCH and maps to a `--token` in theme.css.

## 3. Typography: System-Sans + Mono

**Display / body font:** `system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif` (`--font-sans`).
**Mono font:** `ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace` (`--font-mono`).

There are **no webfonts** in this product — no `@fontsource`, no Google Fonts, no serif. The interface uses the platform's own system sans and its own ui-monospace. This keeps the tool fast, native-feeling, and consistent with its developer-facing, instrument character. The technical voice — frame indices, timecodes, byte weights — is carried by the mono face, reinforcing the command-line, machine-adjacent feel.

### Hierarchy

- **Display** (sans, weight **700**, `letter-spacing: -0.02em`, `clamp(2.5rem, 7vw, 4.5rem)`, line-height 1): The product name / hero title only — e.g. **"SEO Video Slicer."** set big and tight. Bold and tight reads as a confident product mark, not a marketing headline.
- **Headline** (sans, weight 700, `-0.02em`, `clamp(1.5rem, 4vw, 2.25rem)`): Step headings ("Trim", "Frame Review", "Export").
- **Title** (sans, weight 600, `-0.01em`, `clamp(1.05rem, 2.5vw, 1.4rem)`): Section leads, panel headers.
- **Body** (sans, weight 400, 0.95rem, line-height 1.6): Paragraph copy, control descriptions.
- **Supporting** (sans, weight 400, 0.875rem, line-height 1.6): Captions, helper text, the weight-budget explainer.
- **Label** (sans, weight 600, 0.9rem): CTA labels. Short, declarative ("Export Package", "Erase Region").
- **Mono Meta** (mono, weight 500, 0.75rem): Frame indices (`frame_032`), timecodes (`00:04.2`), projected package weight (`3.1 MB`), fps presets, manifest field names.
- **Mono Eyebrow** (mono, weight 500, 0.65rem, `letter-spacing: 0.1em`, uppercase): Section eyebrows and status lines — e.g. `SLICER READY`, `WHAT'S INCLUDED`, the `badge` and `stat-card` labels.

### Named Rules

**The Bold-Display Rule.** Display and headline type is **bold (700) system-sans with tight tracking (`-0.02em`)**, never serif and never light-weight. The product mark is a bold, tight wordmark. Weight and tracking do the work that the retired serif italic used to do.

**The Mono-Is-The-Machine-Voice Rule.** Anything the machine measures — frame numbers, timecodes, weights, formats, manifest fields — is set in the mono face. Mono is reserved for these technical tokens and small uppercase eyebrows; it is not a body face.

**The 1.6 Leading Rule.** Body line-height is 1.6. This is the load-bearing readability decision — it keeps the dark UI calm and legible rather than cramped.

## 4. Elevation

Flat by default. Depth is conveyed through **tone and hairlines**, not structural shadow. The canvas is Void Black; panels sit one tone above on Panel Deep, seamed with a 1px Hairline. Nothing floats by default. A panel's "edge" is a hairline border, full stop.

### The Rare Glow

- **Glow Glow** (`box-shadow: 0 0 20px oklch(65% 0.20 250 / 0.15)` + `border-color: oklch(65% 0.20 250 / 0.4)`): An Electric Blue ambient glow, the **one** sanctioned moment of elevation-as-emphasis. Reserved for the element that should feel magnetic — typically the export CTA at the "package ready" state. Used sparingly; this is the rare ingredient, not a default.

### Named Rules

**The Hairlines-Not-Shadows Rule.** Structure is drawn with 1px Hairline borders, not drop shadows. If you reach for a shadow to separate a panel from the canvas, you are reaching for Material Design muscle memory — use a hairline or a tone step instead. The only shadows permitted are the rare `glow-glow` and the small structural `box-shadow` on the dual-range thumb (which exists for grip on the dark track, not for decoration).

**The Glow-Is-Rare Rule.** `glow-glow` appears at most once per screen, on the single moment that earns it. Decorative glow is banned everywhere else — it is the AI-tool tell this system rejects.

## 5. Component Vocabulary

All components are defined in `frontend/src/styles/theme.css` against the `--token` custom properties on `:root`. This section names each one and its role; theme.css holds the exact values (ported verbatim from the system of record, except the three app additions noted).

- **`glass-card`** — the base panel. Solid Panel Deep, 1px Hairline, 12px radius, 32px padding; hover lifts the border toward Electric Blue (`/0.3`). The container for every grouped control. (Solid — see The No-Glassmorphism Rule.)
- **`btn-primary`** — the **white pill** CTA. Ink-Primary fill, Void-Black text, 999px radius, weight 600; hover is `translateY(-1px)` + opacity `0.88`. The one decisive action on a screen (e.g. Export Package). The inversion (bright pill on dark) is what makes it read as primary.
- **`btn-secondary`** — transparent pill with a 1px Hairline border; hover brightens the border and the text. Non-destructive alternative actions.
- **`icon-btn`** — square (8px radius) Hairline button for compact icon actions; hover borders and tints Electric Blue.
- **`input-field`** — Panel-Deep field with a Hairline border; focus switches the border to Electric Blue and adds a 2px Electric-Blue focus ring (`/0.15`).
- **`preset-pill`** — small Hairline pill for quick presets (fps, format); hover tints Electric Blue.
- **`dual-range-*`** — the in/out **trim** control: `dual-range-container` / `dual-range-track` (Hairline) / `dual-range-progress` (the selected span, Electric Blue) / `dual-range-input` (thumb = Ink-Primary fill, 2px Electric-Blue border, small structural shadow for grip). The signature slicer control. (`custom-range` is the single-thumb variant for scalar settings.)
- **`pulse-dot`** — the success-green pulsing heartbeat. Paired with `SLICER READY` (mono, uppercase) for the neutral ready state. Respects `prefers-reduced-motion`.
- **`badge`** *(app addition)* — mono, 1px Hairline, Ink-Muted. For ID / format tags (`frame_032`, `MP4`, `16:9`). Neutral by design — not accent-colored.
- **`stat-card`** *(app addition)* — a `glass-card` variant for compact readouts (frame count, total weight): a large mono value over a mono-eyebrow label. Same Panel-Deep + Hairline + hover-border treatment.
- **`check-badge`** *(app addition)* — a Success-green circle (with a Void-Black ring for contrast) marking a **selected** filmstrip frame.
- **`menu-item` / `menu-item-danger`** — dropdown / context-menu rows; the danger variant is Danger-red for destructive entries (delete, remove).
- **`fade-in`** — the standard entrance: opacity + 8px rise over 0.4s ease-out-expo. Respects `prefers-reduced-motion`.
- **`glow-glow`** — the rare Electric-Blue accent glow (see §4).

## 6. Motion

- **Easing:** `--ease-out-expo` = `cubic-bezier(0.16, 1, 0.3, 1)`. Expo-out only.
- **Durations:** ~0.15s for color/background, ~0.2s for borders/transform/opacity on controls, 0.4s for entrances (`fade-in`), 1.6s loop for the `pulse-dot` heartbeat.
- **No bounce, no overshoot, no elastic.** Real objects decelerate smoothly. The trim handles, hover lifts, and entrances never overshoot.
- **Animate `transform` and `opacity` only** — never layout properties (`width`, `height`, `padding`, `margin`).
- **Respect `prefers-reduced-motion`** on every animation (`pulse-dot`, `fade-in` both ship the reduced-motion override).

## 7. Do's and Don'ts

### Do

- **Do** put everything on Void Black (`oklch(8% 0 0)`) with Panel-Deep (`oklch(15% 0 0)`) panels seamed by 1px Hairline (`oklch(22% 0 0)`).
- **Do** use Electric Blue (`oklch(65% 0.20 250)`) as the **one** accent, on ≤10% of any screen. Scarcity makes it read as decisive — see The One Accent Rule.
- **Do** set the ready state as a green `pulse-dot` + `SLICER READY` in mono uppercase — a neutral instrument heartbeat.
- **Do** set all colors in OKLCH, mapped to the `--token` custom properties in theme.css.
- **Do** use bold (700) system-sans with `-0.02em` tracking for display/headlines, and the mono face for all technical readouts.
- **Do** articulate structure with 1px hairlines and tone steps, not drop shadows — see The Hairlines-Not-Shadows Rule.
- **Do** keep panels solid Panel Deep. `glass-card` is a solid panel despite its name.
- **Do** use `--ease-out-expo` (`cubic-bezier(0.16, 1, 0.3, 1)`) at ~200ms, with no bounce.
- **Do** respect `prefers-reduced-motion` on every animation.
- **Do** reserve `glow-glow` for one rare accent moment (e.g. the export CTA at "package ready").

### Don't

- **Don't** use pure black (`#000`) or pure white (`#fff`). Use Void Black and Ink Primary — see The Void-Black-Not-Pure-Black Rule.
- **Don't** introduce a cream, warm, or light surface anywhere. There is no light chrome in this system.
- **Don't** use a serif face, Cormorant Garamond, or any `@fontsource`/webfont. System sans + ui-mono only — see The Bold-Display Rule.
- **Don't** use Editorial Magenta or any second accent hue. Success-green and Danger-red are status, not accents — see The One Accent Rule.
- **Don't** add `backdrop-filter`, translucency, or frosted glass. Panels are solid — see The No-Glassmorphism Rule.
- **Don't** articulate panels with drop shadows. Use hairlines. The only sanctioned glow is the rare `glow-glow`.
- **Don't** use gradients (including `background-clip: text` gradient fill), neon, or glow-on-black decoration. For emphasis use weight, scale, or the one accent.
- **Don't** use `border-left`/`border-right` greater than 1px as a colored stripe on cards, rows, or thumbnails — the recognizable AI-dashboard tell.
- **Don't** use bounce or elastic easing, and don't animate layout properties — use `transform`/`opacity` only.
- **Don't** introduce the dropped features into the UI or the system: no Animation Director / GSAP studio, no MLX/Gemma model engine, no chat. This tool stays lean — slicer + package. The right panel is the **Export / Package** panel, and the status line is a neutral `SLICER READY`, not an engine-connected readout.
- **Don't** edit `theme.css` to diverge from the system of record (`smart-image-animations/.../globals.css`) without updating this doc — theme.css is the source of truth and they must agree.
