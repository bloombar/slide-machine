/**
 * A hand-built presentation to import when Google is not in play (TMPL-8).
 *
 * Every Google-touching feature here has a mock mode so the test suite and a
 * development machine need no credentials, and import is no exception. This is
 * that mode's input.
 *
 * ## It is deliberately messy
 *
 * A tidy fixture would prove nothing: consolidation exists to cope with the
 * same slide rebuilt by hand a dozen times, each copy a few pixels off. So the
 * deck below has three real designs, jitter on every copy of them, one
 * genuinely odd slide that should be approximated rather than becoming a
 * layout of its own, and a logo that repeats. An import of it exercises every
 * pass — which means a demo, an e2e run and a local click-through all show the
 * behaviour the live path has.
 */
import type {
  SourceElement,
  SourcePage,
  SourcePresentation,
} from './source-presentation'

/** A deterministic wobble, so the mock is messy but never flaky. */
const wobble = (n: number): number => ((n * 37) % 7) / 1000 - 0.003

const text = (
  id: string,
  box: { x: number; y: number; w: number; h: number },
  over: Partial<SourceElement> = {},
): SourceElement => ({
  id,
  kind: 'text',
  box,
  runs: [{ text: 'Sample', fontSize: 2.6, color: '#1c2230' }],
  ...over,
})

/** Title above a list — the design most decks are mostly made of. */
const titleAndBullets = (n: number): SourcePage => {
  const j = wobble(n)
  return {
    id: `mock-slide-${n}`,
    elements: [
      text(
        `mock-${n}-title`,
        { x: 0.08 + j, y: 0.09, w: 0.84, h: 0.16 },
        {
          placeholder: 'TITLE',
          runs: [
            { text: 'A topic', fontSize: 5.4, bold: true, color: '#1c2230' },
          ],
        },
      ),
      text(
        `mock-${n}-body`,
        { x: 0.08 + j, y: 0.32 + j, w: 0.84, h: 0.52 },
        {
          placeholder: 'BODY',
          bulleted: true,
          runs: [{ text: 'A point worth making', fontSize: 2.6 }],
        },
      ),
      {
        id: `mock-${n}-logo`,
        kind: 'image',
        box: { x: 0.86, y: 0.87, w: 0.08, h: 0.07 },
        imageUrl: 'https://mock.invalid/logo.png',
      },
    ],
    notes: 'What the lecturer said over this slide.',
  }
}

/** A picture beside its explanation. */
const imageAndCaption = (n: number): SourcePage => {
  const j = wobble(n)
  return {
    id: `mock-slide-${n}`,
    elements: [
      text(
        `mock-${n}-title`,
        { x: 0.08 + j, y: 0.09, w: 0.84, h: 0.16 },
        {
          placeholder: 'TITLE',
          runs: [
            { text: 'A figure', fontSize: 5.4, bold: true, color: '#1c2230' },
          ],
        },
      ),
      {
        id: `mock-${n}-image`,
        kind: 'image',
        box: { x: 0.08 + j, y: 0.32, w: 0.44, h: 0.5 },
        imageUrl: 'https://mock.invalid/figure.png',
      },
      text(`mock-${n}-caption`, { x: 0.56, y: 0.32 + j, w: 0.36, h: 0.5 }),
    ],
  }
}

/** Nothing but a heading, halfway down: a section marker. */
const section = (n: number): SourcePage => ({
  id: `mock-slide-${n}`,
  elements: [
    text(
      `mock-${n}-title`,
      { x: 0.08, y: 0.42 + wobble(n), w: 0.84, h: 0.18 },
      {
        placeholder: 'CENTERED_TITLE',
        runs: [
          { text: 'Part two', fontSize: 6.5, bold: true, color: '#ffffff' },
        ],
      },
    ),
  ],
  background: '#101828',
})

/** One slide like nothing else in the deck, which should be approximated
 * rather than becoming a layout nobody else uses. */
const oddOneOut = (n: number): SourcePage => ({
  id: `mock-slide-${n}`,
  elements: [
    text(
      `mock-${n}-title`,
      { x: 0.31, y: 0.04, w: 0.38, h: 0.12 },
      {
        placeholder: 'TITLE',
        runs: [{ text: 'An aside', fontSize: 3.8 }],
      },
    ),
    text(
      `mock-${n}-body`,
      { x: 0.31, y: 0.62, w: 0.38, h: 0.3 },
      {
        placeholder: 'BODY',
        bulleted: true,
      },
    ),
    {
      id: `mock-${n}-logo`,
      kind: 'image',
      box: { x: 0.86, y: 0.87, w: 0.08, h: 0.07 },
      imageUrl: 'https://mock.invalid/logo.png',
    },
  ],
})

/**
 * The presentation a mock import reads.
 *
 * `presentationId` is echoed back so a caller can tell two mock imports apart,
 * and so an e2e test can assert it imported the thing it asked for.
 */
export const mockPresentation = (
  presentationId: string,
): SourcePresentation => ({
  id: presentationId,
  title: 'Imported sample deck',
  theme: {
    background: '#ffffff',
    text: '#1c2230',
    accent: '#3b5bdb',
    muted: '#667085',
  },
  layouts: [],
  slides: [
    titleAndBullets(1),
    titleAndBullets(2),
    section(3),
    titleAndBullets(4),
    imageAndCaption(5),
    titleAndBullets(6),
    imageAndCaption(7),
    section(8),
    titleAndBullets(9),
    oddOneOut(10),
  ],
})
