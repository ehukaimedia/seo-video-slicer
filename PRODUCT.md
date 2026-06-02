# Product

## Register

product

## Users

Developers and designers shipping motion to real surfaces. They have a short video from any source (Veo, screen capture, a product shot) and want premier scroll and hover animation in their app. Their context is a working repo and a frontier model (Claude Code, Cursor, Codex) already wiring up the front end. They do not want to burn model tokens generating hero imagery from scratch. They want premium raw material the model can integrate in one pass.

## Product Purpose

The slicer turns a short source clip into a drop-in WebP animation package: frames, a self-contained scroll-player `index.html`, `manifest.json`, `verify.mjs`, a README, and an optional `PROMPT.md`. The default slice is ten seconds, configurable up to sixty. A live frame and weight budget governs length, not a fixed wall.

The inversion defines the product. The package is the product, not the animation. We do not generate motion. The downstream model already handles that. It just needs premium frames and a working reference.

The value is token-burn elimination. Asking a frontier model to draw hero imagery from scratch is slow, expensive, and non-deterministic. Shipping a tiny WebP frame sequence plus a player that already works means the model spends near-zero image-generation tokens and gets enterprise-grade motion on the first try.

The SEO framing is first-class. WebP frame sequences are Core Web Vitals friendly: small, lazy-loadable, LCP-safe, and CLS-free. The package helps Core Web Vitals. It does not hurt them.

Success is one test. Drop the folder into any repo, open `index.html`, see enterprise animation in ten seconds, then tell the model "use this" and watch it integrate in one pass. Five stars is the bar. Anything that reads as a template or as slop fails.

## Brand Personality

Three words: precise, premium, restrained.

The product is a professional tool. It states what it does and gets out of the way. It earns trust through craft, not claims.

Words we do not use: seamless, effortless, revolutionary, game-changing, powerful, supercharge, unlock, magical, next-gen, cutting-edge, robust, intuitive, "boost your productivity."

## Anti-references

The interface must be the opposite of AI slop. Avoid these tells:

- Generic AI-tool aesthetic: dark mode with neon accents, purple gradients, glassmorphism, glowing particles.
- Side-stripe borders: a colored left or right border as accent on cards, list items, or callouts.
- Gradient text: `background-clip: text` over a gradient. Use one solid color and earn emphasis through weight or size.
- Glassmorphism as default: decorative blur and glass cards.
- The hero-metric template: big number, small label, supporting stats, gradient accent.
- Identical card grids: same-sized icon-heading-text cards repeated endlessly.
- Bounce and elastic motion: overshoot easing that announces itself.
- Anything that reads as a template. The tool should look made, not generated.

## Voice in copy

Declarative. Short. Every sentence ends with a period. No marketing modifiers, no hype, no hedging. State the fact and stop. No em dashes anywhere. Use commas, colons, semicolons, periods, or parentheses. Labels and microcopy name the action plainly: Import, Trim, Extract, Crop, Erase, Export.

## Accessibility

WCAG 2.1 AA across the app and the exported package.

- Color contrast verified with real contrast checks, not eyeballing.
- Every interactive element is keyboard-navigable with a visible focus state.
- `prefers-reduced-motion: reduce` is respected everywhere. In the exported player it falls back to a static hero frame, and the brand still reads.
- Semantic HTML first. ARIA supplements it, never substitutes for it.

## What we do not build

The product is lean by construction. If a feature does not serve slice a video, clean the frames, ship a premium package, it is out.

- No in-app animation generator. The package ships one deterministic reference player. Customization is the downstream model's job.
- No local LLM runtime. No model download for core function.
- No chat assistant.
- No multi-project dashboard or job gallery as a product surface. One session is one working clip. A minimal recents list is acceptable. A CRM is not.
