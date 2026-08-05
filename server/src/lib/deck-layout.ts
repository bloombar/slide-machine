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
import type { Layout, SlotBox, SlotValue } from '@slide-machine/shared'
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
 * list/title/etc. never render an image, even if the slide carries one).
 * Conventional layouts only — an arranged layout says for itself which of its
 * slots hold pictures. */
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

/** A box's colour, mapped onto the three roles an export can draw in. */
const roleOf = (color: string | undefined): ColorRole | undefined => {
  if (color === 'accent' || color === 'muted') return color
  return color ? 'ink' : undefined
}

/** The paragraphs one slot contributes, whatever kind it holds. */
const runsForSlot = (
  value: SlotValue | undefined,
  box: SlotBox,
): LayoutRun[] => {
  // A box's fontSize is `cqi` — a percent of slide width — and the export
  // model measures type as a fraction of that same width, so this is /100
  // rather than a guess.
  const sizeFrac = (box.fontSize ?? 4) / 100
  const color = roleOf(box.color)
  const bold = (box.fontWeight ?? 400) >= 600 ? true : undefined
  if (!value) return []
  switch (value.kind) {
    case 'text':
    case 'preformatted':
      return value.value ? [{ text: value.value, sizeFrac, bold, color }] : []
    case 'bullets':
      return value.items.map(text => ({
        text,
        sizeFrac,
        bullet: true,
        color,
        spaceAfterFrac: sizeFrac * 0.3,
      }))
    case 'code':
      return value.source
        ? [{ text: value.source, sizeFrac, color: 'muted' }]
        : []
    case 'math':
      return value.tex ? [{ text: value.tex, sizeFrac, color }] : []
    case 'table':
      // Rendered as lines until the table renderer lands (plan Phase 4)
      return value.rows.map(row => ({ text: row.join('  '), sizeFrac, color }))
    default:
      return []
  }
}

/**
 * The boxes an ARRANGED layout asks for (TMPL-4). The template placed every
 * slot itself, so the export draws exactly that instead of the hand-tuned
 * arrangement below — which is what makes a PDF match the screen.
 */
const arrangedLayout = (
  slide: ExportSlide,
  layout: Layout,
): LayoutBox[] | null => {
  const positions = layout.elementPositions ?? {}
  if (!Object.keys(positions).length) return null
  const boxes: LayoutBox[] = []
  // Declaration order decides paint order, exactly as it does on screen.
  for (const spec of layout.slots) {
    const box = positions[spec.name]
    if (!box) continue
    const geometry = { x: box.x, y: box.y, w: box.w, h: box.h }
    if (spec.kind === 'image') {
      boxes.push({ kind: 'image', ...geometry })
      continue
    }
    const runs = runsForSlot(slide.slots?.[spec.name], box)
    if (!runs.length) continue
    boxes.push({
      kind: 'text',
      ...geometry,
      align: box.align === 'center' ? 'center' : 'left',
      valign: box.vAlign === 'center' ? 'middle' : 'top',
      runs,
    })
  }
  return boxes
}

/**
 * Computes the layout boxes for a slide.
 *
 * A template that arranged this layout is drawn from its own boxes; the
 * switch below is the hand-tuned arrangement the built-ins rely on, and stays
 * the fallback for any layout that carries no geometry.
 */
export const computeLayout = (
  slide: ExportSlide,
  layout?: Layout,
): LayoutBox[] => {
  if (layout) {
    const arranged = arrangedLayout(slide, layout)
    if (arranged) return arranged
  }
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
