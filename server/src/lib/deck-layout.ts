/**
 * Shared slide-layout model for the deck exports (PDF, Google Slides). Given a
 * slide, it returns positioned boxes in normalized 0..1 slide coordinates that
 * mirror how the app's viewer arranges each layout type (client
 * components/slide/layouts): title/section/quote centered, content/list as
 * left-aligned text with NO image, image-heavy as a dominant image + caption,
 * and two-column as text beside an image. Both renderers draw from this, so the
 * PDF and the Slides output match each other AND the live viewer.
 *
 * Font sizes are a fraction of the slide WIDTH (the app uses `cqi` = %-of-width
 * container units), so each renderer multiplies by its own page width and the
 * relative sizes come out the same.
 */
import type { ExportSlide } from './deck-yaml'

export type ColorRole = 'ink' | 'accent' | 'muted'

/** One paragraph within a text box. */
export interface LayoutRun {
  text: string
  /** Font size as a fraction of slide width. */
  sizeFrac: number
  bold?: boolean
  italic?: boolean
  color?: ColorRole
  bullet?: boolean
  /** Extra gap after this paragraph, as a fraction of slide width. */
  spaceAfterFrac?: number
}

export interface TextBox {
  kind: 'text'
  x: number
  y: number
  w: number
  h: number
  align: 'left' | 'center'
  valign: 'top' | 'middle'
  runs: LayoutRun[]
}
export interface ImageBox {
  kind: 'image'
  x: number
  y: number
  w: number
  h: number
}
export interface RuleBox {
  kind: 'rule'
  x: number
  y: number
  w: number
  h: number
  color: ColorRole
}
export type LayoutBox = TextBox | ImageBox | RuleBox

/** The image slot only appears in these layouts (matching the app: content/
 * list/title/etc. never render an image, even if the slide carries one). */
export const LAYOUT_HAS_IMAGE = new Set(['image-heavy', 'two-column'])

const titleRun = (
  slide: ExportSlide,
  sizeFrac: number,
  color: ColorRole,
  spaceAfterFrac = 0.03,
): LayoutRun[] =>
  slide.title
    ? [{ text: slide.title, sizeFrac, bold: true, color, spaceAfterFrac }]
    : []

const bodyRuns = (slide: ExportSlide, sizeFrac: number): LayoutRun[] => {
  const runs: LayoutRun[] = []
  if (slide.body)
    runs.push({ text: slide.body, sizeFrac, spaceAfterFrac: 0.02 })
  for (const bullet of slide.bullets ?? []) {
    runs.push({ text: bullet, sizeFrac, bullet: true, spaceAfterFrac: 0.012 })
  }
  return runs
}

/** The image's TASL attribution/license credit as one line, or '' — embedded
 * in exports so downstream copies stay license-compliant (IMG-5). */
const attributionCredit = (slide: ExportSlide): string => {
  const a = slide.attribution
  if (!a) return ''
  const parts: string[] = []
  if (a.title) parts.push(`"${a.title}"`)
  if (a.creator) parts.push(`by ${a.creator}`)
  if (a.sourceName) parts.push(`via ${a.sourceName}`)
  if (a.license) parts.push(`— ${a.license}`)
  return parts.join(' ').trim()
}

/** Caption + image attribution/license, joined into one muted footer line
 * (IMG-5 requires the attribution to appear on exported slides). */
const footerText = (slide: ExportSlide): string =>
  [slide.caption, attributionCredit(slide)].filter(Boolean).join('  ·  ')

/** Whether a slide has any caption/attribution footer to show. */
const hasFooter = (slide: ExportSlide): boolean => footerText(slide).length > 0

/** The caption + attribution as a small, muted line tucked directly beneath the
 * image (matching the image's column, not the whole slide), so it reads as a
 * figure credit rather than a banner across the bottom (IMG-5). */
const captionBox = (
  slide: ExportSlide,
  img: { x: number; y: number; w: number; h: number },
): LayoutBox[] => {
  if (!hasFooter(slide)) return []
  const y = img.y + img.h + 0.015
  return [
    {
      kind: 'text',
      x: img.x,
      y,
      w: img.w,
      h: Math.max(0, 1 - y - 0.01),
      align: 'center',
      valign: 'top',
      runs: [{ text: footerText(slide), sizeFrac: 0.011, color: 'muted' }],
    },
  ]
}

/**
 * Computes the layout boxes for a slide. `hasImage` says whether an image was
 * actually fetched, so image-only layouts still reserve space but skip drawing.
 */
export const computeLayout = (slide: ExportSlide): LayoutBox[] => {
  switch (slide.layoutType) {
    case 'title':
      return [
        {
          kind: 'text',
          x: 0.08,
          y: 0,
          w: 0.84,
          h: 1,
          align: 'center',
          valign: 'middle',
          runs: [
            ...titleRun(slide, 0.072, 'ink', slide.caption ? 0.03 : 0),
            ...(slide.caption
              ? [
                  {
                    text: slide.caption,
                    sizeFrac: 0.03,
                    color: 'muted' as const,
                  },
                ]
              : []),
          ],
        },
      ]

    case 'section':
      return [
        { kind: 'rule', x: 0.46, y: 0.4, w: 0.08, h: 0.008, color: 'accent' },
        {
          kind: 'text',
          x: 0.1,
          y: 0.02,
          w: 0.8,
          h: 1,
          align: 'center',
          valign: 'middle',
          runs: titleRun(slide, 0.055, 'ink', 0),
        },
      ]

    case 'quote':
      return [
        {
          kind: 'text',
          x: 0.08,
          y: 0,
          w: 0.84,
          h: 1,
          align: 'center',
          valign: 'middle',
          runs: [
            ...(slide.body
              ? [
                  {
                    text: `“${slide.body}”`,
                    sizeFrac: 0.04,
                    italic: true,
                    spaceAfterFrac: slide.caption ? 0.03 : 0,
                  },
                ]
              : []),
            ...(slide.caption
              ? [
                  {
                    text: slide.caption,
                    sizeFrac: 0.028,
                    color: 'muted' as const,
                  },
                ]
              : []),
          ],
        },
      ]

    case 'image-heavy': {
      const img = {
        x: 0.04,
        y: 0.04,
        w: 0.92,
        h: hasFooter(slide) ? 0.82 : 0.9,
      }
      return [{ kind: 'image', ...img }, ...captionBox(slide, img)]
    }

    case 'two-column': {
      // Image size is fixed; the tiny credit line tucks in the space beneath.
      const img = { x: 0.52, y: 0.1, w: 0.42, h: 0.72 }
      return [
        {
          kind: 'text',
          x: 0.06,
          y: 0,
          w: 0.4,
          h: 1,
          align: 'left',
          valign: 'middle',
          runs: [...titleRun(slide, 0.04, 'accent'), ...bodyRuns(slide, 0.025)],
        },
        { kind: 'image', ...img },
        ...captionBox(slide, img),
      ]
    }

    case 'list':
    case 'content':
      return [
        {
          kind: 'text',
          x: 0.06,
          y: 0,
          w: 0.88,
          h: 1,
          align: 'left',
          valign: 'middle',
          runs: [
            ...titleRun(slide, 0.04, 'accent'),
            ...bodyRuns(slide, 0.0275),
          ],
        },
      ]

    default: {
      // Unknown layout: a safe general arrangement — title, then body/bullets,
      // with the image on the right if the slide has one.
      const hasImg = Boolean(slide.imageRef)
      const img = { x: 0.58, y: 0.13, w: 0.36, h: 0.74 }
      return [
        {
          kind: 'text',
          x: 0.06,
          y: 0.08,
          w: hasImg ? 0.5 : 0.88,
          h: 0.84,
          align: 'left',
          valign: 'top',
          runs: [
            ...titleRun(slide, 0.045, 'accent'),
            ...bodyRuns(slide, 0.028),
          ],
        },
        // The image and its credit only when the slide actually has one.
        ...(hasImg
          ? [{ kind: 'image' as const, ...img }, ...captionBox(slide, img)]
          : []),
      ]
    }
  }
}
