# Design Decisions

Short records of non-obvious choices, for when we revisit them.

## Slide scaling: container-query units (2026-07-11)

**Problem.** Slides render in an `aspect-video` box that tracks viewport width, but typography was fixed-size (`text-5xl` etc.), so decks looked different at every browser width and broke on mobile.

**Choice.** The slide root is a CSS container (`container-type: inline-size`, Tailwind `@container`), and every size inside — font sizes, paddings, gaps, image-slot minimums — is expressed in `cqi` units (1cqi = 1% of slide width) in [SlideView](../client/src/components/SlideView.tsx) and [SlideMarkdown](../client/src/components/SlideMarkdown.tsx). Layout is therefore proportionally identical at any width, pure CSS, no JS measurement.

**Why not the alternative.** The other candidate was the PowerPoint/reveal.js model: render at a fixed design resolution (e.g. 960×540) and `transform: scale()` the whole slide to fit (needs a ResizeObserver). Rejected for now because transforms distort the real geometry that our hover nav zones, in-place editing box reservation, and scroll-into-view depend on, and it needs JS where container units need none.

**If we switch later.** The fixed-design-resolution model becomes attractive when pixel-exact parity with exports matters (PDF / Google Slides, SPEC §11) — an offscreen/export renderer can adopt it independently without changing the interactive viewer. All scaling values live only in the two components above; a switch means replacing `cqi` values with fixed sizes at the design resolution plus a scale wrapper.

Approximate scale used: title 7cqi, section heading 5.5cqi, content/list headings 4cqi, body 2.75cqi (2.5 in two-column), captions 2cqi, paddings 4–8cqi.

## Z-index tiers (2026-07-11)

Fixed tiers so page chrome always paints above slide content:

| Tier | z-index | Used by |
| --- | --- | --- |
| Slide content & nav hotspots | auto | SlideView, SlideNavZones zones |
| In-slide controls | `z-10` | EditableText (display + field), SlideDeleteButton — must beat the nav hotspots only |
| Sticky page footer | `z-30` | HealthFooter |
| Primary navigation | `z-50` | AppShell / PublicShell headers |

Rule of thumb: nothing inside a slide may exceed `z-10`; nothing outside
page chrome may use `z-30`+. Previously the sticky header sat at `z-10`,
tied with in-slide controls, so slide text could paint over the nav when
scrolled beneath it.
