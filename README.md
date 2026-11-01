# joyce-works-rewired

Modern staging rebuild of the **JOYCE.WORKS** landing page.

## Why this repo exists

The live Tumblr landing page currently achieves its scroll choreography with
Skrollr, duplicated full-screen image states, media fallbacks and a separate
mobile redirect. This repo rebuilds the same visual language as a responsive
HTML/CSS/JS experience before anything is migrated back to Tumblr.

## Ground rules

- The live `joyce.works` homepage stays untouched while staging is in progress.
- The persistent hamburger/menu is site chrome and stays independent from
  scroll-driven landing animation.
- Rebuild the original visual intent; do not flatten the site into a generic
  portfolio template.
- Work scene-by-scene and commit at stable checkpoints.
- Desktop establishes the canonical choreography; mobile uses the same content
  and visual system responsively rather than redirecting to a separate page.

## Planned structure

1. **Identity** — psychedelic opening → JOYCE WORKS identity → portrait mask →
   biography reveal.
2. **Disciplines** — Advertising → Strategy → Art staged reveal.
3. **Clients** — responsive client grid + pulsing JOYCE WORKS outline.
4. **CTA** — real Portfolio and Contact links.

## Tumblr migration

The staging site is deliberately plain HTML/CSS/JS. Tumblr-specific dynamic
page blocks, Ask/Submit variables and theme metadata are restored only after the
staging build is stable.
