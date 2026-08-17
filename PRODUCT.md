# Product

## Register

brand

The surface being designed is a landing page — design IS the product there. The VS Code extension
itself is a product surface, but it lives inside VS Code's own UI and isn't what this file governs.

## Users

Developers who already use VS Code and want AI autocomplete without a subscription or a company
watching them type. Two overlapping groups:

- **People who won't or can't pay for Copilot** — students, hobbyists, people between jobs, people
  in countries where the pricing is punishing. They have an OpenRouter account with free-tier
  models and want that to be enough.
- **People who won't send their code to a vendor by default** — they want the key in their own
  credential store, no telemetry, and a small enough codebase that they could actually read it.

Context of use: they're evaluating quickly, probably from a link, probably skeptical — the
category is full of abandoned side projects and AI-generated slop. The page has seconds to prove
this one was built by someone who cared.

Job to be done: decide whether this is worth installing, then install it.

## Product Purpose

Inline AI autocomplete and multi-location edit prediction for VS Code, running on any
[OpenRouter](https://openrouter.ai) model with the user's own API key.

Built on Continue's autocomplete/NextEdit engine (Apache-2.0), with the inference layer replaced by
OpenRouter and everything else — chat, agents, GUI, telemetry — stripped out.

Success looks like: someone lands on the page, understands in one screen that this is free and uses
their own key, and installs it. Secondary success: they come away believing the engineering is
careful, because that's the honest differentiator against a category full of thin wrappers.

## Brand Personality

**Practical, unguarded, well-made.**

- **Practical** — it tells you what it does and what it costs you (nothing) without a pitch.
- **Unguarded** — it says what doesn't work yet. No hedging, no invented metrics, no fake social
  proof. The honesty IS the trust-building move; this audience detects marketing instantly.
- **Well-made** — the craft is visible in the artifact itself. The page should feel like the tool:
  small, fast, considered, nothing decorative that isn't doing work.

Emotional goal: relief and mild surprise. "Oh — this is just free, and it's mine, and someone
clearly sweated the details."

The governing metaphor is **a tool you own rather than rent**. Your key, your machine, no
subscription, nothing phoning home. Closer to a well-kept workshop than a server rack.

## Anti-references

- **Enterprise SaaS pricing-page energy.** No fabricated metrics ("10x faster"), no "trusted by"
  logo walls, no gradient-purple hero, no row of three identical feature cards, no "Start free
  trial." This is free software and shouldn't cosplay as a Series B startup.
- **Crypto / AI-hype maximalism.** No glowing orbs, no 3D blobs, no "THE FUTURE OF CODE" in caps.
- **Sterile corporate documentation.** Not a grey docs sidebar. It should have a voice.
- **The dark-terminal dev-tool reflex.** Black background, monospace everything, neon cyan accent —
  the single most predictable answer for this category and the visual signature of AI-generated
  dev-tool pages.
- **Editorial-typographic as the escape hatch.** Display serif + italic + small mono labels + ruled
  columns is the second-order reflex, one tier deeper than the first. Also out.

## Design Principles

1. **Practice what you preach.** The product is small, dependency-light, and doesn't phone home.
   The page must be the same: no framework, no CDN calls, no analytics, self-hosted fonts. If the
   page is bloated, the pitch is a lie.
2. **Show the tool working.** The strongest asset is the product doing its job — ghost text
   appearing as you type. Demonstrate it rather than describing it.
3. **Earn the install with specifics.** Vague claims of quality are what everyone writes. Real
   numbers and real engineering decisions — the bundle size, the native-binding bug, the test
   count — are what a skeptical developer actually weighs.
4. **Never overclaim.** State what's verified, and say plainly what isn't. One caught exaggeration
   costs more trust than three honest limitations.
5. **Free should feel generous, not cheap.** "No cost" is the headline benefit, so the page has to
   look like care went into it — otherwise free reads as abandoned.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**.

- Body text ≥4.5:1 contrast; large text ≥3:1. Muted green on a light surface is exactly where this
  slips, so contrast is measured rather than eyeballed.
- Full keyboard operability with visible focus indicators; real `<a href>` links, not click handlers.
- `prefers-reduced-motion: reduce` shows the end state of the typing demo rather than animating.
  Content is never gated behind an animation that may not fire.
- Color is never the sole carrier of meaning.
- Semantic landmarks and a sensible heading order, so screen readers get the same structure sighted
  users do.
