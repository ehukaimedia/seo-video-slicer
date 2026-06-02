# sample-orbs — WebP scroll-animation package

A drop-in, self-contained WebP animation. Open `index.html` in any browser with
**no server** — it animates on scroll. Zero external requests by default
(no network, no build step, no framework required).

This folder IS the product. The frames are pre-optimized; `index.html` already
plays them. Customize only the **safe_zones** in `manifest.json` (accent color,
headline/overlay copy, scroll distance, easing, container height, framework
wrapper). Do **not** touch the **locked_zones** or regenerate the images.

## Copy to public

Copy this whole folder into your site's static assets and reference it by path:

```
cp -R ./sample-orbs ./public/sample-orbs
# served at: /sample-orbs/index.html
```

All asset paths inside are relative (`./frames/frame_NNN.webp`), so the package
works from any sub-path with no rewrites.

## Iframe (Default)

The simplest, fully-isolated integration — drop the folder in `public/` and embed:

```html
<iframe
  src="/sample-orbs/index.html"
  title="sample-orbs animation"
  loading="lazy"
  style="width:100%;height:100vh;border:0"
></iframe>
```

The iframe sandboxes the player's scroll binding and styles from the host page.
Adjust `height` (a safe_zone: container height) to set the scroll distance.

## React / Next

Place the folder under `public/sample-orbs/` and render the iframe from a component:

```jsx
export default function HeroAnimation() {
  return (
    <iframe
      src="/sample-orbs/index.html"
      title="sample-orbs animation"
      loading="lazy"
      style={{ width: '100%', height: '100vh', border: 0 }}
    />
  );
}
```

In Next.js the `public/` folder is served at the site root, so `/sample-orbs/index.html`
resolves with no extra config. For a native component, adapt the player JS from
`index.html` but preserve the locked_zones (cover-fit single-canvas render,
frame_NNN ordering, reduced-motion fallback, the `data-template-id`).

## Inline Vanilla

Serve the folder and link to it, or lift the inline `<canvas>` player out of
`index.html` into your own page. Keep the relative `./frames/` paths and the
`data-template-id="seo-video-slicer.scroll.v1"` attribute on the player root:

```html
<a href="./sample-orbs/index.html">Open the animation</a>
```

```html
<!-- or embed the player root directly, keeping its inline CSS/JS intact -->
<div data-template-id="seo-video-slicer.scroll.v1">
  <!-- canvas + frame loader copied from index.html -->
</div>
```

## Accessibility

The player honors `prefers-reduced-motion: reduce`: when set, animation is
suppressed and a single static hero frame renders so the content still reads.

## Verify

This package validates against the contract with a zero-dependency gate:

```
node verify.mjs
```

It exits non-zero on any failed gate (asset closure, frame naming, self-contained
HTML, player techniques, manifest + fingerprint, this README, weight budget).
